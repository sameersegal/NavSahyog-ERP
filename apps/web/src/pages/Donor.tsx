// Donor-facing public infographic for Jal Vriddhi ponds. Lives
// outside the auth wall (App.tsx routes `/donor` regardless of
// session state) and reads from the no-auth `/api/public/ponds`
// endpoint.
//
// Map library: Leaflet 1.9.4 loaded from a CDN at runtime so the
// main app bundle stays untouched — the donor surface is the only
// consumer and we don't want to ship Leaflet to every authenticated
// VC dashboard. Loaded once per page, idempotent across re-mounts.

import { useEffect, useRef, useState, type ReactNode } from 'react';

type LeafletGlobal = {
  map: (el: HTMLElement, opts: Record<string, unknown>) => LeafletMap;
  tileLayer: (url: string, opts: Record<string, unknown>) => LeafletTileLayer;
  layerGroup: () => LeafletLayerGroup;
  circleMarker: (
    latlng: [number, number],
    opts: Record<string, unknown>,
  ) => LeafletMarker;
};
type LeafletMap = {
  fitBounds: (b: Array<[number, number]>, opts?: Record<string, unknown>) => void;
};
type LeafletTileLayer = { addTo: (m: LeafletMap) => LeafletTileLayer };
type LeafletLayerGroup = {
  addTo: (m: LeafletMap) => LeafletLayerGroup;
  clearLayers: () => void;
};
type LeafletMarker = {
  bindPopup: (html: string) => LeafletMarker;
  addTo: (g: LeafletLayerGroup) => LeafletMarker;
};

declare global {
  interface Window { L?: LeafletGlobal }
}

type PondStatus = 'planned' | 'dug' | 'active' | 'inactive';

type PublicPond = {
  id: number;
  latitude: number;
  longitude: number;
  status: PondStatus;
  notes: string | null;
  farmer_first_name: string;
  plot_identifier: string | null;
  village: string;
  cluster: string;
  district: string;
  state: string;
  zone: string;
  created_at: number;
};

type PublicPondsResponse = {
  stats: {
    total: number;
    by_status: Record<PondStatus, number>;
    by_state: Array<{ state: string; count: number }>;
    villages: number;
    districts: number;
    states: number;
  };
  ponds: PublicPond[];
};

const STATUS_COLOR: Record<PondStatus, string> = {
  active:   '#10b981',
  dug:      '#f59e0b',
  planned:  '#3b82f6',
  inactive: '#94a3b8',
};
const STATUS_LABEL: Record<PondStatus, string> = {
  active:   'Filled & active',
  dug:      'Construction underway',
  planned:  'Agreement signed',
  inactive: 'Out of service',
};

const LEAFLET_CSS = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
const LEAFLET_JS  = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';

function loadLeaflet(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve();
  if (window.L) return Promise.resolve();
  return new Promise((resolve, reject) => {
    if (!document.querySelector(`link[href="${LEAFLET_CSS}"]`)) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = LEAFLET_CSS;
      document.head.appendChild(link);
    }
    const existing = document.querySelector<HTMLScriptElement>(
      `script[src="${LEAFLET_JS}"]`,
    );
    if (existing) {
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () => reject(new Error('leaflet load failed')));
      return;
    }
    const script = document.createElement('script');
    script.src = LEAFLET_JS;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('leaflet load failed'));
    document.head.appendChild(script);
  });
}

export function Donor() {
  const [data, setData] = useState<PublicPondsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<PondStatus | 'all'>('all');
  const mapEl = useRef<HTMLDivElement | null>(null);
  const mapInst = useRef<LeafletMap | null>(null);
  const markerLayer = useRef<LeafletLayerGroup | null>(null);

  useEffect(() => {
    fetch('/api/public/ponds')
      .then((r) => {
        if (!r.ok) throw new Error(`http ${r.status}`);
        return r.json() as Promise<PublicPondsResponse>;
      })
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : 'failed'));
  }, []);

  useEffect(() => {
    let cancelled = false;
    loadLeaflet()
      .then(() => {
        if (cancelled || !mapEl.current || mapInst.current) return;
        const L = window.L;
        if (!L) return;
        const map = L.map(mapEl.current, {
          center: [16.5, 80.5],
          zoom: 5,
          scrollWheelZoom: true,
          zoomControl: true,
        });
        L.tileLayer(
          'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
          {
            attribution:
              '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
            maxZoom: 19,
          },
        ).addTo(map);
        mapInst.current = map;
        markerLayer.current = L.layerGroup().addTo(map);
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'leaflet failed'));
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const L = window.L;
    if (!L || !data || !markerLayer.current || !mapInst.current) return;
    markerLayer.current.clearLayers();
    const filtered = filter === 'all'
      ? data.ponds
      : data.ponds.filter((p) => p.status === filter);
    const bounds: Array<[number, number]> = [];
    for (const p of filtered) {
      const marker = L.circleMarker([p.latitude, p.longitude], {
        radius: 8,
        color: '#ffffff',
        weight: 2,
        fillColor: STATUS_COLOR[p.status],
        fillOpacity: 0.9,
      });
      const popup = popupHtml(p);
      marker.bindPopup(popup).addTo(markerLayer.current);
      bounds.push([p.latitude, p.longitude]);
    }
    if (bounds.length > 0) {
      mapInst.current.fitBounds(bounds, { padding: [40, 40], maxZoom: 7 });
    }
  }, [data, filter]);

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 text-center bg-gray-50">
        <div>
          <p className="text-lg font-semibold">Could not load donor map</p>
          <p className="text-sm text-gray-500 mt-1">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <header className="bg-emerald-700 text-white">
        <div className="max-w-6xl mx-auto px-4 py-6 md:py-8">
          <div className="text-xs uppercase tracking-widest opacity-80">
            Jal Vriddhi · Live Donor View
          </div>
          <h1 className="text-2xl md:text-3xl font-bold mt-1">
            Every pond on the map.
          </h1>
          <p className="text-sm md:text-base mt-2 opacity-90 max-w-2xl">
            NavSahyog partners with farmers across India to dig and revive
            small water-storage ponds. Each marker below is a real pond on a
            real farm — agreement signed, GPS captured, photo on file.
          </p>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-6 space-y-6">
        <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Kpi label="Ponds" value={data?.stats.total} />
          <Kpi
            label="Filled & active"
            value={data?.stats.by_status.active}
            hint="water flowing"
            accent={STATUS_COLOR.active}
          />
          <Kpi label="Villages reached" value={data?.stats.villages} />
          <Kpi label="States" value={data?.stats.states} />
        </section>

        <section className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-gray-500">Showing:</span>
          <FilterChip active={filter === 'all'} onClick={() => setFilter('all')}>
            All ({data?.stats.total ?? 0})
          </FilterChip>
          {(['active', 'dug', 'planned', 'inactive'] as const).map((s) => (
            <FilterChip
              key={s}
              active={filter === s}
              dotColor={STATUS_COLOR[s]}
              onClick={() => setFilter(s)}
            >
              {STATUS_LABEL[s]} ({data?.stats.by_status[s] ?? 0})
            </FilterChip>
          ))}
        </section>

        <section className="rounded-lg overflow-hidden shadow-sm border border-gray-200 bg-white">
          <div
            ref={mapEl}
            className="h-[480px] md:h-[560px] w-full"
            aria-label="Map of pond locations"
          />
        </section>

        {data && data.stats.by_state.length > 0 && (
          <section className="bg-white rounded-lg border border-gray-200 p-4">
            <h2 className="text-base font-semibold mb-3">
              Where the work is happening
            </h2>
            <ul className="space-y-2">
              {data.stats.by_state.map((row) => {
                const pct = data.stats.total
                  ? Math.round((row.count / data.stats.total) * 100)
                  : 0;
                return (
                  <li key={row.state} className="text-sm">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="font-medium">{row.state}</span>
                      <span className="text-gray-500">
                        {row.count} ponds · {pct}%
                      </span>
                    </div>
                    <div className="mt-1 h-2 rounded-full bg-gray-100 overflow-hidden">
                      <div
                        className="h-full bg-emerald-500"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        <footer className="text-xs text-gray-500 text-center pt-4 pb-2">
          Aggregate view — individual farmer details are kept private.
        </footer>
      </main>
    </div>
  );
}

function popupHtml(p: PublicPond): string {
  const color = STATUS_COLOR[p.status];
  const label = STATUS_LABEL[p.status];
  const lines = [
    `<div style="font-weight:600;font-size:14px;">${esc(p.farmer_first_name)}'s pond</div>`,
    `<div style="color:#6b7280;font-size:12px;">${esc(p.village)}, ${esc(p.district)}, ${esc(p.state)}</div>`,
    `<div style="margin-top:6px;display:inline-block;padding:2px 8px;border-radius:9999px;background:${color};color:#fff;font-size:11px;font-weight:500;">${esc(label)}</div>`,
  ];
  if (p.plot_identifier) {
    lines.push(`<div style="margin-top:6px;font-size:12px;color:#374151;">${esc(p.plot_identifier)}</div>`);
  }
  if (p.notes) {
    lines.push(`<div style="margin-top:4px;font-size:12px;color:#4b5563;font-style:italic;">${esc(p.notes)}</div>`);
  }
  return `<div style="font-family:system-ui,sans-serif;min-width:200px;">${lines.join('')}</div>`;
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function Kpi({
  label, value, hint, accent,
}: {
  label: string;
  value: number | undefined;
  hint?: string;
  accent?: string;
}) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-3">
      <div className="text-xs uppercase tracking-wide text-gray-500">{label}</div>
      <div
        className="text-2xl md:text-3xl font-bold mt-1 tabular-nums"
        style={accent ? { color: accent } : undefined}
      >
        {value ?? '—'}
      </div>
      {hint && <div className="text-xs text-gray-400 mt-0.5">{hint}</div>}
    </div>
  );
}

function FilterChip({
  active, onClick, dotColor, children,
}: {
  active: boolean;
  onClick: () => void;
  dotColor?: string;
  children: ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      type="button"
      className={[
        'inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs border transition-colors',
        active
          ? 'bg-gray-900 text-white border-gray-900'
          : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-100',
      ].join(' ')}
    >
      {dotColor && (
        <span
          className="inline-block w-2.5 h-2.5 rounded-full"
          style={{ background: dotColor }}
          aria-hidden="true"
        />
      )}
      {children}
    </button>
  );
}
