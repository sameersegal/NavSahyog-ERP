// Manifest pull (L4.1a — D32 replace-snapshot, supersedes §6.9 deltas).
//
// Fetches `GET /api/sync/manifest` and reseeds the read-cache stores.
// Single-flight via an in-module promise so a burst of triggers (login
// + online event firing simultaneously) only runs one network call.
//
// Triggers (wired by SyncStateProvider):
//   * App-start when the user is authenticated.
//   * `online` window event firing.
//   * Manual "Sync now" from the Outbox UI (after a successful drain
//     reaches done).
//
// Failure mode: a network failure leaves the prior cache in place.
// A 401 means the session expired — the AuthProvider will already
// redirect to /login on the next API call, and logout will wipe
// the cache there. We do not wipe here on error.

import {
  BUILD_ID_HEADER,
  type ManifestResponse,
} from '@navsahyog/shared';
import { BUILD_ID } from './build';
import { notifyFromResponse } from './events';
import { replaceSnapshot } from './cache';

let inFlight: Promise<ManifestResponse | null> | null = null;

export async function pullManifest(): Promise<ManifestResponse | null> {
  if (inFlight) return inFlight;
  inFlight = doPull().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function doPull(): Promise<ManifestResponse | null> {
  let res: Response;
  try {
    res = await fetch('/api/sync/manifest', {
      method: 'GET',
      credentials: 'include',
      headers: {
        [BUILD_ID_HEADER]: BUILD_ID,
      },
    });
  } catch {
    return null;
  }
  // Surface server-build / 426 signals the same way regular API
  // calls do — the chrome's update banner relies on this.
  notifyFromResponse(res);
  if (!res.ok) return null;
  let body: ManifestResponse;
  try {
    body = (await res.json()) as ManifestResponse;
  } catch {
    return null;
  }
  await replaceSnapshot({
    villages: body.villages,
    students: body.students,
    generatedAt: body.generated_at,
  });
  return body;
}
