import { Hono } from 'hono';
import { requireAuth } from '../auth';
import { requireCap } from '../policy';
import { villageIdsInScope } from '../scope';
import { err } from '../lib/errors';
import {
  isGeoLevel,
  GEO_JOIN,
  type GeoLevel,
} from '../lib/geo';
import type { Bindings, Variables } from '../types';

// L2.5.2 — typeahead + sibling lookups for the dashboard scope
// picker (§3.6.1 navigation enhancements; mvp/level-2.5.md L2.5.2).
// Both endpoints reuse `villageIdsInScope()` so the response is
// already scope-filtered — a District admin's /geo/search never
// returns villages in another district, and a Cluster admin's
// /geo/siblings at zone level returns [] rather than all zones.

const geo = new Hono<{ Bindings: Bindings; Variables: Variables }>();
geo.use('*', requireAuth);

// Parent FK column for each non-root level. Used to scope
// "siblings" to nodes sharing the same parent. Zone has no parent
// table (India is virtual), so its siblings are all zones reachable
// via scope.
const PARENT_FK: Record<Exclude<GeoLevel, 'india' | 'zone'>, string> = {
  state: 'zone_id',
  region: 'state_id',
  district: 'region_id',
  cluster: 'district_id',
  village: 'cluster_id',
};

// Search match limit. 20 is enough to present a usable dropdown
// without scrolling; clients can re-query with a tighter `q` if
// their result list is clipped.
const SEARCH_LIMIT = 20;

// Strip SQL LIKE wildcards from user input so a query of "50%"
// doesn't turn into a "match anything" wildcard. The backtick-escape
// for the literal `_` / `%` uses `!` as the escape char, declared
// via ESCAPE '!' in the query.
function escapeLike(q: string): string {
  return q.replace(/[!%_]/g, (ch) => '!' + ch);
}

// GET /api/geo/search?q=<query>&limit=20
//
// Typeahead across villages + clusters, scope-filtered. Results
// carry a `path` hint (e.g. "Belur · Anandpur") so operators can
// disambiguate identically-named nodes. Villages rank above
// clusters in the combined result — VCs think in villages first,
// and deep-link to a village is the common case.
geo.get('/search', requireCap('dashboard.read'), async (c) => {
  const raw = (c.req.query('q') ?? '').trim();
  if (raw.length < 2) return c.json({ results: [] });
  const limitRaw = Number(c.req.query('limit') ?? SEARCH_LIMIT);
  const limit = Number.isInteger(limitRaw) && limitRaw > 0 && limitRaw <= 50
    ? limitRaw
    : SEARCH_LIMIT;

  const user = c.get('user');
  const scope = await villageIdsInScope(c.env.DB, user);
  if (scope.length === 0) return c.json({ results: [] });

  const like = `%${escapeLike(raw)}%`;
  const placeholders = scope.map(() => '?').join(',');

  // Villages: direct match on name, scope-checked via v.id IN (...).
  const villagesRs = await c.env.DB.prepare(
    `SELECT v.id AS id, v.name AS name, c.name AS parent_name
     FROM village v
     JOIN cluster c ON c.id = v.cluster_id
     WHERE v.name LIKE ? ESCAPE '!'
       AND v.id IN (${placeholders})
     ORDER BY v.name
     LIMIT ?`,
  )
    .bind(like, ...scope, limit)
    .all<{ id: number; name: string; parent_name: string }>();

  // Clusters: scope-check is "at least one village in scope under
  // this cluster". EXISTS is cheap; the pattern mirrors what
  // dashboard.ts's effectiveVillages() does for single-row gates.
  const clustersRs = await c.env.DB.prepare(
    `SELECT c.id AS id, c.name AS name, d.name AS parent_name
     FROM cluster c
     JOIN district d ON d.id = c.district_id
     WHERE c.name LIKE ? ESCAPE '!'
       AND EXISTS (
         SELECT 1 FROM village v
         WHERE v.cluster_id = c.id
           AND v.id IN (${placeholders})
       )
     ORDER BY c.name
     LIMIT ?`,
  )
    .bind(like, ...scope, limit)
    .all<{ id: number; name: string; parent_name: string }>();

  const results = [
    ...villagesRs.results.map((r) => ({
      level: 'village' as GeoLevel,
      id: r.id,
      name: r.name,
      path: r.parent_name,
    })),
    ...clustersRs.results.map((r) => ({
      level: 'cluster' as GeoLevel,
      id: r.id,
      name: r.name,
      path: r.parent_name,
    })),
  ].slice(0, limit);
  return c.json({ results });
});

// GET /api/geo/siblings?level=<level>&id=<id>
//
// Siblings at the same level sharing the same parent. Used by the
// breadcrumb chevron so an operator can jump Zone A → Zone B
// without walking back to India. Scope-filtered: a sibling is
// returned only if its subtree contains at least one in-scope
// village.
geo.get('/siblings', requireCap('dashboard.read'), async (c) => {
  const rawLevel = c.req.query('level');
  const rawId = c.req.query('id');
  if (!isGeoLevel(rawLevel) || rawLevel === 'india') {
    return err(c, 'bad_request', 400, 'level required (non-india)');
  }
  const id = rawId ? Number(rawId) : NaN;
  if (!Number.isInteger(id) || id <= 0) {
    return err(c, 'bad_request', 400, 'id required');
  }

  const user = c.get('user');
  const scope = await villageIdsInScope(c.env.DB, user);
  if (scope.length === 0) return c.json({ siblings: [] });
  const placeholders = scope.map(() => '?').join(',');

  // Walk up the GEO_JOIN chain filtered to in-scope villages, then
  // DISTINCT on the column matching `rawLevel`. For non-zone
  // levels we additionally require the parent FK to match the
  // clicked node's parent. For zone, there's no parent FK — the
  // "siblings of Zone N" are all reachable zones.
  const alias: Record<GeoLevel, string> = {
    india: '', zone: 'z', state: 'st', region: 'r',
    district: 'd', cluster: 'c', village: 'v',
  };
  const selfAlias = alias[rawLevel];

  // Matches the table name 1:1 (geo tables are singular: zone,
  // state, region, district, cluster, village). Used only in the
  // subquery that resolves the parent id for the clicked node.
  const table: Record<GeoLevel, string> = {
    india: '', zone: 'zone', state: 'state', region: 'region',
    district: 'district', cluster: 'cluster', village: 'village',
  };

  let parentClause = '';
  const bindings: (string | number)[] = [];
  if (rawLevel !== 'zone') {
    const fk = PARENT_FK[rawLevel as keyof typeof PARENT_FK];
    parentClause = `AND ${selfAlias}.${fk} = (SELECT ${fk} FROM ${table[rawLevel]} WHERE id = ?)`;
    bindings.push(id);
  }
  const sql = `
    SELECT DISTINCT ${selfAlias}.id AS id, ${selfAlias}.name AS name
    ${GEO_JOIN}
    WHERE v.id IN (${placeholders})
      ${parentClause}
    ORDER BY ${selfAlias}.name
  `;
  const rs = await c.env.DB.prepare(sql)
    .bind(...scope, ...bindings)
    .all<{ id: number; name: string }>();
  return c.json({ siblings: rs.results });
});

// L3.1 — full geo tree dump for the Master-Creations user-create
// scope picker. The form needs to resolve a scope_id against the
// role's derived scope_level (zone / state / region / district /
// cluster / village), and the seed has only ~30 rows total — one
// admin-only dump is simpler than six per-level endpoints. Gated
// on `user.write` since the only consumer is the admin form.
geo.get('/all', requireCap('user.write'), async (c) => {
  const tables = ['zone', 'state', 'region', 'district', 'cluster', 'village'] as const;
  const out: Record<string, Array<{ id: number; name: string }>> = {};
  for (const table of tables) {
    const rs = await c.env.DB
      .prepare(`SELECT id, name FROM ${table} ORDER BY name COLLATE NOCASE`)
      .all<{ id: number; name: string }>();
    out[table] = rs.results;
  }
  return c.json({ levels: out });
});

export default geo;
