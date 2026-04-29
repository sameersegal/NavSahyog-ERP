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

import { useEffect, useMemo, useRef, useState } from 'react';
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
  if (!data) return <HomeSkeleton />;

  const hasAnyWrite = user.capabilities.some((cap) => cap.endsWith('.write'));
  const canFab = can(user, 'media.write') || can(user, 'attendance.write');

  return (
    <div className="space-y-5 pb-20">
      <Greeting user={user} scopeLabel={t(`home.scope_level.${data.scope.level}`)} />

      <PresetSwitch value={windowKey} onChange={setWindow} />

      <HealthScoreCard score={data.health_score} />

      {/* Village-scope users (VCs) need a permanent path into their
          village page — that's where attendance + children + media
          gallery live. The Mission card covers the "today's nudge"
          case but is conditional on a live mission, so on a quiet
          day a VC would otherwise have no clickable way in. */}
      {user.scope_level === 'village' && user.scope_id !== null && (
        <MyVillageCard villageId={user.scope_id} />
      )}

      {hasAnyWrite && data.mission && (
        <MissionCard mission={data.mission} user={user} />
      )}

      <FocusAreas
        areas={data.focus_areas}
        window={windowKey}
        variant={hasAnyWrite ? 'doer' : 'observer'}
      />

      {!hasAnyWrite && data.focus_areas.length > 0 && (
        <CompareAllLink window={windowKey} scope={data.scope} />
      )}

      {canFab && <CaptureFab user={user} />}
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
      return `/village/${user.scope_id}?tab=attendance`;
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

type FocusArea = HomeResponse['focus_areas'][number];

// Top-3 direct-child scopes ranked by Health Score ascending. Same
// data either way; rendering is capability-shape:
//   * doer    — compact row, action copy ("needs photos · 45%") to
//               match the Mission framing.
//   * observer — multi-KPI strip per row, comparison-shaped.
function FocusAreas({
  areas,
  window: windowKey,
  variant,
}: {
  areas: FocusArea[];
  window: HomeWindow;
  variant: 'doer' | 'observer';
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
              className="block bg-card border border-border rounded-lg px-3 py-2.5 min-h-[44px] hover:bg-card-hover"
            >
              {variant === 'doer'
                ? <DoerFocusRow area={a} />
                : <ObserverFocusRow area={a} />}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

function DoerFocusRow({ area }: { area: FocusArea }) {
  const { t } = useI18n();
  // Action copy uses the dominant gap kind: "needs photos · 45%".
  // Falls back to the Health Score with no qualifier when every KPI
  // is at target (rare on Home but cheap to handle honestly).
  const copy = area.dominant_gap_kind
    ? t(`home.focus.gap.${area.dominant_gap_kind}`, {
        value: pctValue(area, area.dominant_gap_kind),
      })
    : t('home.focus.no_gap');
  return (
    <div className="flex items-baseline justify-between gap-2">
      <div className="min-w-0">
        <div className="font-medium truncate">{area.name}</div>
        <div className="text-xs text-muted-fg truncate">{copy}</div>
      </div>
      <HealthScorePill score={area.health_score} />
    </div>
  );
}

function ObserverFocusRow({ area }: { area: FocusArea }) {
  const { t } = useI18n();
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <div className="min-w-0">
          <div className="font-medium truncate">{area.name}</div>
          <div className="text-xs text-muted-fg truncate">
            {t(`home.scope_level.${area.level}`)}
          </div>
        </div>
        <HealthScorePill score={area.health_score} />
      </div>
      {/* Four KPI tiles in one row. tabular-nums keeps the percent
          column width even for "—%" so rows align across the list. */}
      <dl className="grid grid-cols-4 gap-1 text-xs">
        <KpiTile label={t('home.focus.kpi.attendance')} pct={area.attendance_pct} />
        <KpiTile label={t('home.focus.kpi.image')}      pct={area.image_pct} />
        <KpiTile label={t('home.focus.kpi.video')}      pct={area.video_pct} />
        <KpiTile label={t('home.focus.kpi.som')}        pct={area.som_pct} />
      </dl>
    </div>
  );
}

function KpiTile({ label, pct }: { label: string; pct: number | null }) {
  return (
    <div className="bg-card-hover/40 rounded px-1.5 py-1">
      <dt className="text-[10px] uppercase tracking-wide text-muted-fg leading-tight">
        {label}
      </dt>
      <dd className="text-sm font-medium tabular-nums leading-tight">
        {pct === null ? '—' : `${pct}%`}
      </dd>
    </div>
  );
}

function HealthScorePill({ score }: { score: number }) {
  const tone =
    score >= 80 ? 'bg-primary/15 text-primary border-primary/30'
    : score >= 50 ? 'bg-card-hover text-fg border-border'
    : 'bg-danger/10 text-danger border-danger/30';
  return (
    <span
      className={`text-sm font-semibold tabular-nums px-2 py-0.5 rounded-full border shrink-0 ${tone}`}
    >
      {score}
    </span>
  );
}

function pctValue(area: FocusArea, kind: HomeMissionKind): number {
  switch (kind) {
    case 'attendance': return area.attendance_pct ?? 0;
    case 'image':      return area.image_pct ?? 0;
    case 'video':      return area.video_pct ?? 0;
    case 'som':        return area.som_pct ?? 0;
  }
}

// Single-line link that follows observer Focus Areas. Replaces the
// pre-symmetric "Compare grid is in design" placeholder — the full
// sibling-compare grid lives on /dashboard now (D19, revised). Scope
// + preset preserved so the dashboard lands already filtered.
function CompareAllLink({
  window: windowKey,
  scope,
}: {
  window: HomeWindow;
  scope: HomeResponse['scope'];
}) {
  const { t } = useI18n();
  const qs = `scope=${scopeQueryString(scope.level, scope.id)}&window=${windowKey}`;
  return (
    <Link
      to={`/dashboard?${qs}`}
      className="block text-sm text-primary hover:underline px-3 min-h-[44px] flex items-center"
    >
      {t('home.compare.cta_all')}
    </Link>
  );
}

function MyVillageCard({ villageId }: { villageId: number }) {
  const { t } = useI18n();
  return (
    <Link
      to={`/village/${villageId}?tab=attendance`}
      className="block bg-card border border-border rounded-lg p-4 hover:bg-card-hover min-h-[44px]"
    >
      <div className="flex items-baseline justify-between gap-2">
        <div className="text-xs text-muted-fg uppercase tracking-wide">
          {t('home.village.title')}
        </div>
        <div className="text-xs text-muted-fg">
          {t('home.village.cta')}
        </div>
      </div>
      <p className="text-sm mt-1">{t('home.village.subtitle')}</p>
    </Link>
  );
}

// FAB: tap = primary action (attendance), long-press = options menu.
//
//   * VC has a single village, so the primary tap routes straight to
//     /village/<id>?tab=attendance. AF+ have no implicit village, so
//     they fall back to /capture (where they pick one) — long-press
//     menu still offers the alternates.
//   * Long-press surfaces Attendance / Achievements (SoM) / Capture
//     media, scoped to the user's caps. Same trigger pattern works on
//     touch (touchstart) and pointer (mousedown) — we use Pointer
//     Events with a 500 ms timer.
//   * The browser's contextmenu (long-press on iOS Safari, right-
//     click on desktop) is suppressed to avoid a duplicate menu.
const LONG_PRESS_MS = 500;

function CaptureFab({ user }: { user: User }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const longPressTimerRef = useRef<number | null>(null);
  const longPressFiredRef = useRef(false);

  const isVcVillage =
    user.scope_level === 'village' && user.scope_id !== null;
  const primaryHref = isVcVillage
    ? `/village/${user.scope_id}?tab=attendance`
    : '/capture';

  const canAttendance = isVcVillage && can(user, 'attendance.write');
  const canSom = can(user, 'achievement.write');
  const canMedia = can(user, 'media.write');

  function clearTimer() {
    if (longPressTimerRef.current !== null) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }

  function onPointerDown(e: React.PointerEvent) {
    // Only the primary button on mouse / pen; touch always.
    if (e.pointerType !== 'touch' && e.button !== 0) return;
    longPressFiredRef.current = false;
    clearTimer();
    longPressTimerRef.current = window.setTimeout(() => {
      longPressFiredRef.current = true;
      setMenuOpen(true);
      longPressTimerRef.current = null;
    }, LONG_PRESS_MS);
  }

  function onPointerUpOrCancel() {
    clearTimer();
  }

  function onClick(e: React.MouseEvent) {
    // The long-press path opens the menu; swallow the synthetic click
    // that follows so we don't navigate underneath it.
    if (longPressFiredRef.current) {
      e.preventDefault();
      longPressFiredRef.current = false;
      return;
    }
    e.preventDefault();
    navigate(primaryHref);
  }

  function onContextMenu(e: React.MouseEvent) {
    // Suppress the platform menu — our long-press handler owns this
    // gesture. Without this, iOS Safari shows the link-share sheet
    // and Chrome desktop shows the right-click menu.
    e.preventDefault();
    setMenuOpen(true);
    longPressFiredRef.current = true;
  }

  // Outside-click + Escape close, mirroring UserMenu / MoreMenu.
  useEffect(() => {
    if (!menuOpen) return;
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setMenuOpen(false);
    }
    document.addEventListener('mousedown', handle);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handle);
      document.removeEventListener('keydown', handleKey);
    };
  }, [menuOpen]);

  useEffect(() => () => clearTimer(), []);

  return (
    <div ref={ref} className="fixed bottom-4 right-4 sm:bottom-6 sm:right-6 z-20">
      {menuOpen && (
        <div
          role="menu"
          aria-label={t('home.fab.menu_label')}
          className="absolute bottom-full right-0 mb-2 w-56 bg-card text-fg border border-border rounded-lg shadow-lg overflow-hidden"
        >
          {canAttendance && (
            <FabMenuItem
              to={`/village/${user.scope_id}?tab=attendance`}
              onSelect={() => setMenuOpen(false)}
              label={t('home.fab.menu.attendance')}
            />
          )}
          {canSom && (
            <FabMenuItem
              to="/achievements"
              onSelect={() => setMenuOpen(false)}
              label={t('home.fab.menu.achievements')}
            />
          )}
          {canMedia && (
            <FabMenuItem
              to="/capture"
              onSelect={() => setMenuOpen(false)}
              label={t('home.fab.menu.capture')}
            />
          )}
        </div>
      )}
      <a
        href={primaryHref}
        onClick={onClick}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUpOrCancel}
        onPointerCancel={onPointerUpOrCancel}
        onPointerLeave={onPointerUpOrCancel}
        onContextMenu={onContextMenu}
        aria-label={t('home.fab.label')}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        className="select-none touch-none flex items-center gap-2 bg-primary text-primary-fg rounded-full shadow-lg px-4 py-3 min-h-[56px] hover:opacity-90"
      >
        <span aria-hidden="true" className="text-xl leading-none">+</span>
        <span className="text-sm font-medium">{t('home.fab.label')}</span>
      </a>
    </div>
  );
}

function FabMenuItem({
  to,
  onSelect,
  label,
}: {
  to: string;
  onSelect: () => void;
  label: string;
}) {
  return (
    <Link
      to={to}
      role="menuitem"
      onClick={onSelect}
      className="block px-4 py-2.5 text-sm hover:bg-card-hover"
    >
      {label}
    </Link>
  );
}

// Skeleton matching the §3.6.4 doer layout (greeting · preset switch
// · health card · mission card · 3 focus rows). Keeps the page from
// jumping on data arrival. Observer Home reuses the same skeleton —
// the focus rows stand in for the compare-grid placeholder too.
function HomeSkeleton() {
  const { t } = useI18n();
  return (
    <div className="space-y-5" aria-busy="true" aria-label={t('common.loading')}>
      <div className="flex items-baseline justify-between gap-3">
        <div className="h-6 w-32 bg-card-hover rounded animate-pulse" />
        <div className="h-5 w-16 bg-card-hover rounded-full animate-pulse" />
      </div>
      <div className="h-9 w-44 bg-card-hover rounded-lg animate-pulse" />
      <div className="bg-card border border-border rounded-lg p-4 h-28 animate-pulse" />
      <div className="bg-card border border-primary/20 rounded-lg p-4 h-24 animate-pulse" />
      <div className="space-y-2">
        <div className="h-3 w-24 bg-card-hover rounded animate-pulse" />
        {Array.from({ length: 3 }).map((_, i) => (
          <div
            key={i}
            className="bg-card border border-border rounded-lg h-14 animate-pulse"
          />
        ))}
      </div>
    </div>
  );
}
