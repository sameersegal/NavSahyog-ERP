// Per-file route metadata. Walked at build time by
// scripts/gen-matrix.mjs to produce requirements/generated/*.md
// — the matrix that replaces the manual §2.3 / §6.1 cross-cuts.
//
// Keep this file dependency-free (the generator parses it
// statically, but routes import it at runtime via TS — so no
// `import type` only).

export type CRAStage =
  | 'create-only'           // single-stage write (e.g. attendance)
  | 'create-review'         // two-stage (Creator → Reviewer)
  | 'create-review-approve' // three-stage (Creator → Reviewer → Approver)
  | 'read-only';            // no writes

export type OfflineMode =
  | 'required'    // must work offline (queued via outbox)
  | 'eligible'    // works offline if connectivity drops mid-flow, not primary
  | 'cached'      // GETs served from local cache when offline
  | 'online-only';

export type RouteMeta = {
  // Bounded context this resource belongs to. See the matrix
  // header for the canonical list (identity, masters,
  // beneficiaries, programs, media, dashboard, sync).
  context:
    | 'identity'
    | 'masters'
    | 'beneficiaries'
    | 'programs'
    | 'media'
    | 'dashboard'
    | 'sync';
  // Resource label as it appears in URLs (singular or plural to
  // match the route file name).
  resource: string;
  cra: CRAStage;
  offline: {
    write?: OfflineMode;
    read?: OfflineMode;
  };
  // Spec / decision references this route file implements. Plain
  // text — readers navigate via requirements/README.md.
  refs: readonly string[];
};
