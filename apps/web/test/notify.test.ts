// L4.0c — soft "Update available" event dispatch from
// `notifyFromResponse`. Exercises both signals (426 → upgrade
// required, X-Server-Build newer than local → server-build observed).
//
// `BUILD_ID` falls back to today + ".dev" in tests (no Vite define),
// so we use deliberately-future and deliberately-past dates to
// exercise the comparator without depending on the test wall clock.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { SERVER_BUILD_HEADER } from '@navsahyog/shared';
import {
  SERVER_BUILD_OBSERVED_EVENT,
  UPGRADE_REQUIRED_EVENT,
  notifyFromResponse,
  _resetNotifyState,
} from '../src/lib/events';

afterEach(() => {
  _resetNotifyState();
});

function responseWith(
  status: number,
  headers: Record<string, string> = {},
): Response {
  return new Response(null, { status, headers });
}

describe('notifyFromResponse', () => {
  it('fires UPGRADE_REQUIRED_EVENT on a 426', () => {
    const handler = vi.fn();
    window.addEventListener(UPGRADE_REQUIRED_EVENT, handler);
    notifyFromResponse(responseWith(426));
    window.removeEventListener(UPGRADE_REQUIRED_EVENT, handler);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('fires SERVER_BUILD_OBSERVED_EVENT when X-Server-Build is newer', () => {
    const handler = vi.fn();
    window.addEventListener(SERVER_BUILD_OBSERVED_EVENT, handler);
    // Local build falls back to today's date (.dev). Use a build
    // dated decades in the future to guarantee it's strictly newer
    // regardless of when the test runs.
    const future = '2099-01-01.future';
    notifyFromResponse(
      responseWith(200, { [SERVER_BUILD_HEADER]: future }),
    );
    window.removeEventListener(SERVER_BUILD_OBSERVED_EVENT, handler);
    expect(handler).toHaveBeenCalledTimes(1);
    const evt = handler.mock.calls[0]![0] as CustomEvent<{
      serverBuild: string;
    }>;
    expect(evt.detail.serverBuild).toBe(future);
  });

  it('does not fire when X-Server-Build is older or equal to the local build', () => {
    const handler = vi.fn();
    window.addEventListener(SERVER_BUILD_OBSERVED_EVENT, handler);
    notifyFromResponse(
      responseWith(200, { [SERVER_BUILD_HEADER]: '2000-01-01.old' }),
    );
    window.removeEventListener(SERVER_BUILD_OBSERVED_EVENT, handler);
    expect(handler).not.toHaveBeenCalled();
  });

  it('does not fire when the header is absent', () => {
    const handler = vi.fn();
    window.addEventListener(SERVER_BUILD_OBSERVED_EVENT, handler);
    notifyFromResponse(responseWith(200));
    window.removeEventListener(SERVER_BUILD_OBSERVED_EVENT, handler);
    expect(handler).not.toHaveBeenCalled();
  });

  it('de-dupes — second observation of the same build does not refire', () => {
    const handler = vi.fn();
    window.addEventListener(SERVER_BUILD_OBSERVED_EVENT, handler);
    const future = '2099-02-02.future';
    notifyFromResponse(responseWith(200, { [SERVER_BUILD_HEADER]: future }));
    notifyFromResponse(responseWith(200, { [SERVER_BUILD_HEADER]: future }));
    notifyFromResponse(responseWith(200, { [SERVER_BUILD_HEADER]: future }));
    window.removeEventListener(SERVER_BUILD_OBSERVED_EVENT, handler);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('refires when an even newer build appears', () => {
    const handler = vi.fn();
    window.addEventListener(SERVER_BUILD_OBSERVED_EVENT, handler);
    notifyFromResponse(
      responseWith(200, { [SERVER_BUILD_HEADER]: '2099-01-01.a' }),
    );
    notifyFromResponse(
      responseWith(200, { [SERVER_BUILD_HEADER]: '2099-02-01.b' }),
    );
    window.removeEventListener(SERVER_BUILD_OBSERVED_EVENT, handler);
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('fires both events when a 426 carries a newer X-Server-Build', () => {
    const upgrade = vi.fn();
    const observed = vi.fn();
    window.addEventListener(UPGRADE_REQUIRED_EVENT, upgrade);
    window.addEventListener(SERVER_BUILD_OBSERVED_EVENT, observed);
    notifyFromResponse(
      responseWith(426, { [SERVER_BUILD_HEADER]: '2099-03-01.c' }),
    );
    window.removeEventListener(UPGRADE_REQUIRED_EVENT, upgrade);
    window.removeEventListener(SERVER_BUILD_OBSERVED_EVENT, observed);
    expect(upgrade).toHaveBeenCalledTimes(1);
    expect(observed).toHaveBeenCalledTimes(1);
  });
});
