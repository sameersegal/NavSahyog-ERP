// Field-Dashboard Home (§3.6.4). Default landing page for every
// authenticated user. Composition is capability-gated, not role-
// gated — adding a future role with only `.read` caps automatically
// lands on the observer branch with no edit here.
//
// Doer (any `.write` cap) sees:
//   greeting · health score · today's mission · focus areas · capture FAB
// Observer (`.read` only) sees:
//   greeting · health score · focus areas · sibling-compare grid
//
// Data: one round-trip to /api/dashboard/home per preset change. URL
// state (`?window=`, `?scope=`) preserves preset + scope across
// refresh / share-link / back-button.
//
// First-cut limits (called out in this PR's description):
//   * Observer's compare grid is a placeholder linking to /dashboard
//     pending the mobile-fit design call (full grid × 30 districts
//     doesn't fit a phone without horizontal scroll / progressive
//     disclosure — that decision wants a mock first).
//   * Mission's "natural write path" routing collapses to a small
//     decision table: image/video → /capture, attendance → village
//     page (VC) or /capture (AF+), som → /achievements.

import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  api,
  can,
  HOME_WINDOWS,
  isGeoLevel,
  type GeoLevel,
  type HomeMissionKind,
  type HomeResponse,
  type HomeWindow,
  type User,
} from '../api';
import { useAuth } from '../auth';
import { useI18n } from '../i18n';

export function Home() {
  const { t } = useI18n();
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [data, setData] = useState<HomeResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Preset + scope come from the URL so refresh / deep-link / back
  // preserve state. Bad values fail closed to defaults — server
  // resolves to the user's scope floor when scope is omitted.
  const windowKey = useMemo<HomeWindow>(() => {
    const raw = searchParams.get('window');
    return isHomeWindow(raw) ? raw : '7d';
  }, [searchParams]);
  const scope = useMemo(() => parseScopeParam(searchParams.get('scope')), [searchParams]);

  useEffect(() => {
    if (!user) return;
    setData(null);
    setError(null);
    api
      .dashboardHome({ window: windowKey, scope: scope ?? undefined })
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : 'failed'));
  }, [user, windowKey, scope?.level, scope?.id]);

  function setWindow(next: HomeWindow) {
    const sp = new URLSearchParams(searchParams);
    if (next === '7d') sp.delete('window'); else sp.set('window', next);
    setSearchParams(sp, { replace: true });
  }

  if (!user) return null;
  if (error) return <p className="text-danger">{error}</p>;
  if (!data) return <p className="text-muted-fg">{t('common.loading')}</p>;

  const hasAnyWrite = user.capabilities.some((cap) => cap.endsWith('.write'));
  const canFab = can(user, 'media.write') || can(user, 'attendance.write');

  return (
    <div className="space-y-5 pb-20">
      <Greeting user={user} scopeLabel={t(`home.scope_level.${data.scope.level}`)} />

      <PresetSwitch value={windowKey} onChange={setWindow} />

      <HealthScoreCard score={data.health_score} />

      {hasAnyWrite && data.mission && (
        <MissionCard mission={data.mission} user={user} />
      )}

      <FocusAreas areas={data.focus_areas} window={windowKey} />

      {!hasAnyWrite && <CompareGridPlaceholder window={windowKey} />}

      {canFab && <CaptureFab />}
    </div>
  );
}

// ---- helpers ------------------------------------------------------

function isHomeWindow(v: unknown): v is HomeWindow {
  return typeof v === 'string' && (HOME_WINDOWS as readonly string[]).includes(v);
}

function parseScopeParam(
  raw: string | null,
): { level: GeoLevel; id: number | null } | null {
  if (!raw) return null;
  const [rawLevel, rawId] = raw.split(':');
  if (!rawLevel || !isGeoLevel(rawLevel)) return null;
  if (rawLevel === 'india') return { level: 'india', id: null };
  const id = Number(rawId);
  if (!Number.isInteger(id) || id <= 0) return null;
  return { level: rawLevel, id };
}

function scopeQueryString(level: GeoLevel, id: number | null): string {
  return id === null ? level : `${level}:${id}`;
}

// Mission tap routes to the natural write path (§3.6.4). For VCs
// attendance lives at the village page; AF+ pick a village in
// /capture (which exposes the same flow once a village is selected).
function missionHref(kind: HomeMissionKind, user: User): string {
  if (kind === 'som') return '/achievements';
  if (kind === 'attendance') {
    if (user.scope_level === 'village' && user.scope_id) {
      return `/village/${user.scope_id}`;
    }
    return '/capture';
  }
  // image / video
  return '/capture';
}

// ---- blocks -------------------------------------------------------

function Greeting({ user, scopeLabel }: { user: User; scopeLabel: string }) {
  const { t } = useI18n();
  // Greeting uses just the first name to keep the line short on
  // mobile. The scope chip carries the level the user can see.
  const firstName = user.full_name.split(/\s+/)[0] ?? user.full_name;
  return (
    <header className="flex items-baseline justify-between gap-3 flex-wrap">
      <h1 className="text-xl font-semibold">
        {t('home.greeting', { name: firstName })}
      </h1>
      <span className="text-xs px-2 py-0.5 rounded-full bg-card border border-border text-muted-fg">
        {scopeLabel}
      </span>
    </header>
  );
}

function PresetSwitch({
  value,
  onChange,
}: {
  value: HomeWindow;
  onChange: (next: HomeWindow) => void;
}) {
  const { t } = useI18n();
  return (
    <div
      role="radiogroup"
      aria-label={t('home.preset.label')}
      className="inline-flex rounded-lg border border-border overflow-hidden"
    >
      {HOME_WINDOWS.map((w) => (
        <button
          key={w}
          role="radio"
          aria-checked={value === w}
          onClick={() => onChange(w)}
          className={
            'px-3 py-1.5 text-sm min-h-[44px] sm:min-h-0 ' +
            (value === w
              ? 'bg-primary text-primary-fg font-medium'
              : 'bg-card text-fg hover:bg-card-hover')
          }
        >
          {t(`home.preset.${w}`)}
        </button>
      ))}
    </div>
  );
}

function HealthScoreCard({
  score,
}: {
  score: HomeResponse['health_score'];
}) {
  const { t } = useI18n();
  if (score.current === null) {
    return (
      <section className="bg-card border border-border rounded-lg p-4">
        <div className="text-xs text-muted-fg uppercase tracking-wide">
          {t('home.health.title')}
        </div>
        <div className="text-3xl font-semibold mt-1">—</div>
        <p className="text-sm text-muted-fg mt-1">{t('home.health.no_data')}</p>
      </section>
    );
  }
  const tone =
    score.current >= 80 ? 'text-primary'
    : score.current >= 50 ? 'text-fg'
    : 'text-danger';
  const arrow =
    score.delta === null ? null
    : score.delta > 0 ? '▲'
    : score.delta < 0 ? '▼'
    : '•';
  const trendColor =
    score.delta === null || score.delta === 0 ? 'text-muted-fg'
    : score.delta > 0 ? 'text-primary'
    : 'text-danger';
  return (
    <section className="bg-card border border-border rounded-lg p-4">
      <div className="flex items-baseline justify-between gap-2">
        <div className="text-xs text-muted-fg uppercase tracking-wide">
          {t('home.health.title')}
        </div>
        {arrow && (
          <div className={`text-xs ${trendColor}`}>
            {arrow}{' '}
            {score.delta === null
              ? t('home.health.no_prior')
              : score.delta > 0
                ? `+${score.delta}`
                : score.delta}
          </div>
        )}
      </div>
      <div className={`text-4xl font-semibold mt-1 tabular-nums ${tone}`}>
        {score.current}
        <span className="text-base text-muted-fg font-normal">/100</span>
      </div>
      <p className="text-xs text-muted-fg mt-1">{t('home.health.subtitle')}</p>
    </section>
  );
}

function MissionCard({
  mission,
  user,
}: {
  mission: NonNullable<HomeResponse['mission']>;
  user: User;
}) {
  const { t } = useI18n();
  const isCount = mission.kind === 'som';
  const pct = isCount
    ? Math.round((mission.current / Math.max(1, mission.target)) * 100)
    : Math.min(100, mission.current);
  return (
    <Link
      to={missionHref(mission.kind, user)}
      className="block bg-card border border-primary/30 rounded-lg p-4 hover:bg-card-hover min-h-[44px]"
    >
      <div className="flex items-baseline justify-between gap-2">
        <div className="text-xs text-primary uppercase tracking-wide font-medium">
          {t('home.mission.title')}
        </div>
        <div className="text-xs text-muted-fg">
          {t('home.mission.cta')}
        </div>
      </div>
      <p className="text-base font-medium mt-1">
        {t(`home.mission.copy.${mission.kind}`, {
          current: mission.current,
          target: mission.target,
        })}
      </p>
      <div className="mt-2 flex items-center gap-2">
        <div className="flex-1 h-2 bg-card-hover rounded-full overflow-hidden">
          <div
            className="h-full bg-primary"
            style={{ width: `${pct}%` }}
            aria-hidden="true"
          />
        </div>
        <div className="text-xs text-muted-fg tabular-nums shrink-0">
          {mission.current}
          {isCount ? '' : '%'}
          {' / '}
          {mission.target}
          {isCount ? '' : '%'}
        </div>
      </div>
    </Link>
  );
}

function FocusAreas({
  areas,
  window: windowKey,
}: {
  areas: HomeResponse['focus_areas'];
  window: HomeWindow;
}) {
  const { t } = useI18n();
  if (areas.length === 0) return null;
  return (
    <section className="space-y-2">
      <h2 className="text-xs text-muted-fg uppercase tracking-wide">
        {t('home.focus.title')}
      </h2>
      <ul className="space-y-2">
        {areas.map((a) => (
          <li key={`${a.level}-${a.id}`}>
            <Link
              to={`/dashboard?scope=${scopeQueryString(a.level, a.id)}&window=${windowKey}`}
              className="flex items-baseline justify-between gap-2 bg-card border border-border rounded-lg px-3 py-2.5 min-h-[44px] hover:bg-card-hover"
            >
              <div className="min-w-0">
                <div className="font-medium truncate">{a.name}</div>
                <div className="text-xs text-muted-fg">
                  {t(`home.scope_level.${a.level}`)}
                </div>
              </div>
              <div className="text-right shrink-0">
                <div className="text-base font-semibold tabular-nums">
                  {a.value}%
                </div>
                <div className="text-xs text-muted-fg">
                  {t('home.focus.metric.attendance')}
                </div>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

function CompareGridPlaceholder({ window: windowKey }: { window: HomeWindow }) {
  const { t } = useI18n();
  return (
    <section className="bg-card border border-dashed border-border rounded-lg p-4 space-y-2">
      <h2 className="text-xs text-muted-fg uppercase tracking-wide">
        {t('home.compare.title')}
      </h2>
      <p className="text-sm text-muted-fg">{t('home.compare.placeholder')}</p>
      <Link
        to={`/dashboard?window=${windowKey}`}
        className="inline-block text-sm text-primary hover:underline"
      >
        {t('home.compare.cta_dashboard')}
      </Link>
    </section>
  );
}

function CaptureFab() {
  const { t } = useI18n();
  return (
    <Link
      to="/capture"
      aria-label={t('home.fab.label')}
      className="fixed bottom-4 right-4 sm:bottom-6 sm:right-6 z-20 flex items-center gap-2 bg-primary text-primary-fg rounded-full shadow-lg px-4 py-3 min-h-[56px] hover:opacity-90"
    >
      <span aria-hidden="true" className="text-xl leading-none">+</span>
      <span className="text-sm font-medium">{t('home.fab.label')}</span>
    </Link>
  );
}
