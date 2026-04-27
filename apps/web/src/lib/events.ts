// Window-event names dispatched across the sync platform (L4.0a/b).
//
// Centralised here so the dispatch site (api.ts on 4xx, drain.ts on
// 426) and the listen site (lib/sync-state.tsx) agree on the spelling
// without a circular dependency between api.ts and the lib/* modules.

export const UPGRADE_REQUIRED_EVENT = 'navsahyog:upgrade_required';
