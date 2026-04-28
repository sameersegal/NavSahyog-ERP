// Window-event names dispatched across the sync platform (L4.0a/b/c).
//
// Centralised here so dispatch sites (api.ts on 4xx, drain.ts on 426)
// and listen sites (lib/sync-state.tsx) agree on spellings without a
// circular dependency between api.ts and the lib/* modules.

import { SERVER_BUILD_HEADER, parseBuildDate } from '@navsahyog/shared';
import { BUILD_ID } from './build';

export const UPGRADE_REQUIRED_EVENT = 'navsahyog:upgrade_required';

// Fired when any response carries an `X-Server-Build` header whose
// build-date is strictly newer than the client's BUILD_ID. The
// SyncStateProvider listens for it and surfaces the soft, dismissible
// "Update available" banner. The detail carries the parsed server
// build for the banner copy.
export const SERVER_BUILD_OBSERVED_EVENT = 'navsahyog:server_build_observed';

export type ServerBuildObservedDetail = {
  serverBuild: string; // raw header value
};

const LOCAL_BUILD_DATE = parseBuildDate(BUILD_ID);

// Most recent server build we've already announced. Prevents the
// event bus from getting spammed when every response on a page
// carries the same header.
let lastAnnouncedServerBuild: string | null = null;

// Inspect a response and dispatch the appropriate sync events.
// Used by api.ts (regular online API calls) and lib/drain.ts
// (outbox replay) so both code paths surface upgrade signals
// without duplicating the dispatch logic.
export function notifyFromResponse(res: Response): void {
  if (typeof window === 'undefined') return;
  if (res.status === 426) {
    window.dispatchEvent(new CustomEvent(UPGRADE_REQUIRED_EVENT));
  }
  const serverBuild = res.headers.get(SERVER_BUILD_HEADER);
  if (!serverBuild) return;
  if (serverBuild === lastAnnouncedServerBuild) return;
  const serverDate = parseBuildDate(serverBuild);
  if (!serverDate || !LOCAL_BUILD_DATE) return;
  if (serverDate <= LOCAL_BUILD_DATE) return;
  lastAnnouncedServerBuild = serverBuild;
  window.dispatchEvent(
    new CustomEvent<ServerBuildObservedDetail>(SERVER_BUILD_OBSERVED_EVENT, {
      detail: { serverBuild },
    }),
  );
}

// Test hook — clears the de-dupe state so each test sees a fresh
// announcement.
export function _resetNotifyState(): void {
  lastAnnouncedServerBuild = null;
}
