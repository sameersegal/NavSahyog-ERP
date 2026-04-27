// Single error-response shape across the API. Spec §5.
//
//   { error: { code: string, message?: string } }
//
// `code` is a stable, machine-readable identifier; `message` is a
// human-readable hint that may change without notice. Clients
// should branch on `code`, not `message`.

import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

export type ErrorCode =
  | 'bad_request'
  | 'unauthenticated'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'upgrade_required'
  | 'internal_error';

export type ErrorBody = {
  error: { code: ErrorCode; message?: string };
};

export function err(
  c: Context,
  code: ErrorCode,
  status: ContentfulStatusCode,
  message?: string,
): Response {
  const body: ErrorBody = { error: message ? { code, message } : { code } };
  return c.json(body, status);
}
