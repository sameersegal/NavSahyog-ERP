import { env, SELF } from 'cloudflare:test';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { applySchemaAndSeed, loginAs, resetDb } from './setup';

// Mirrors apps/api/src/lib/time.ts — kept duplicated in the test
// file so a test never imports from a worker runtime module at
// vitest collection time.
function todayIst(): string {
  const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;
  return new Date(Date.now() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

beforeAll(async () => {
  // Apply schema once; each `it` cleans and re-seeds so tests are
  // independent but the DDL is paid for once.
  await applySchemaAndSeed(env.DB);
});

async function cookieFetch(path: string, token: string, init: RequestInit = {}) {
  return SELF.fetch(`http://api.test${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      cookie: `nsf_session=${token}`,
      ...(init.headers ?? {}),
    },
  });
}

describe('auth', () => {
  it('rejects bad credentials with the canonical error shape', async () => {
    const res = await SELF.fetch('http://api.test/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ user_id: 'super', password: 'wrong' }),
    });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      error: { code: 'unauthenticated', message: 'invalid credentials' },
    });
  });

  it('/auth/me after login returns the session user with capabilities', async () => {
    const token = await loginAs('vc-anandpur');
    const res = await cookieFetch('/auth/me', token);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      user: { user_id: string; role: string; capabilities: string[] };
    };
    expect(body.user.user_id).toBe('vc-anandpur');
    expect(body.user.role).toBe('vc');
    // Capabilities come from policy.ts; assert a few key ones so a
    // regression in the server→client contract surfaces here.
    expect(body.user.capabilities).toContain('child.write');
    expect(body.user.capabilities).toContain('attendance.read');
  });
});

describe('scope enforcement', () => {
  it('a VC accessing a sibling village returns 403', async () => {
    const token = await loginAs('vc-anandpur');
    // Anandpur is village 1; Belur is village 2.
    const res = await cookieFetch('/api/children?village_id=2', token);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: { code: 'forbidden' } });
  });

  it('a VC can list children in their own village', async () => {
    const token = await loginAs('vc-anandpur');
    const res = await cookieFetch('/api/children?village_id=1', token);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { children: unknown[] };
    expect(body.children.length).toBeGreaterThan(0);
  });

  it('an AF can reach any village in their cluster', async () => {
    const token = await loginAs('af-bid01');
    for (const villageId of [1, 2, 3]) {
      const res = await cookieFetch(`/api/children?village_id=${villageId}`, token);
      expect(res.status).toBe(200);
    }
  });
});

describe('attendance', () => {
  beforeEach(async () => {
    await resetDb();
  });

  // IST date offset by `days`, matching the client helper.
  function dateOffset(days: number): string {
    const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;
    const ms = Date.now() + IST_OFFSET_MS - days * 24 * 60 * 60 * 1000;
    return new Date(ms).toISOString().slice(0, 10);
  }

  // Default payload used by the positive-path tests. Pulled out so
  // we don't repeat the HH:MM / event_id plumbing in every case.
  function body(overrides: Record<string, unknown> = {}) {
    return {
      village_id: 1,
      event_id: 3, // Board Games — activity
      start_time: '10:00',
      end_time: '11:00',
      marks: [{ student_id: 1, present: true }],
      ...overrides,
    };
  }

  it('rejects dates outside the today/-1/-2 window', async () => {
    const token = await loginAs('vc-anandpur');
    const res = await cookieFetch('/api/attendance', token, {
      method: 'POST',
      body: JSON.stringify(body({ date: '2020-01-01' })),
    });
    expect(res.status).toBe(400);
    const b = (await res.json()) as { error: { code: string; message?: string } };
    expect(b.error.code).toBe('bad_request');
    expect(b.error.message).toMatch(/3 days|window|today-2/i);
  });

  it('rejects a future date', async () => {
    const token = await loginAs('vc-anandpur');
    const res = await cookieFetch('/api/attendance', token, {
      method: 'POST',
      body: JSON.stringify(body({ date: '2099-01-01' })),
    });
    expect(res.status).toBe(400);
    const b = (await res.json()) as { error: { message?: string } };
    expect(b.error.message).toMatch(/future/i);
  });

  it('accepts today-1 (yesterday) and today-2', async () => {
    const token = await loginAs('vc-anandpur');
    for (const offset of [0, 1, 2]) {
      const res = await cookieFetch('/api/attendance', token, {
        method: 'POST',
        body: JSON.stringify(body({ date: dateOffset(offset), event_id: 3 + offset })),
      });
      expect(res.status).toBe(200);
    }
  });

  it('rejects a malformed date', async () => {
    const token = await loginAs('vc-anandpur');
    const res = await cookieFetch('/api/attendance', token, {
      method: 'POST',
      body: JSON.stringify(body({ date: 'not-a-date' })),
    });
    expect(res.status).toBe(400);
    const b = (await res.json()) as { error: { message?: string } };
    expect(b.error.message).toMatch(/yyyy-mm-dd/i);
  });

  it('requires event_id', async () => {
    const token = await loginAs('vc-anandpur');
    const { event_id, ...rest } = body();
    void event_id;
    const res = await cookieFetch('/api/attendance', token, {
      method: 'POST',
      body: JSON.stringify(rest),
    });
    expect(res.status).toBe(400);
    const b = (await res.json()) as { error: { message?: string } };
    expect(b.error.message).toMatch(/event_id/);
  });

  it('rejects an unknown event_id', async () => {
    const token = await loginAs('vc-anandpur');
    const res = await cookieFetch('/api/attendance', token, {
      method: 'POST',
      body: JSON.stringify(body({ event_id: 9999 })),
    });
    expect(res.status).toBe(400);
    const b = (await res.json()) as { error: { message?: string } };
    expect(b.error.message).toMatch(/event/);
  });

  it('rejects malformed start_time / end_time', async () => {
    const token = await loginAs('vc-anandpur');
    const bad = await cookieFetch('/api/attendance', token, {
      method: 'POST',
      body: JSON.stringify(body({ start_time: '10am' })),
    });
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { error: { message?: string } }).error.message)
      .toMatch(/start_time/);
  });

  it('rejects end_time < start_time', async () => {
    const token = await loginAs('vc-anandpur');
    const res = await cookieFetch('/api/attendance', token, {
      method: 'POST',
      body: JSON.stringify(body({ start_time: '11:00', end_time: '10:00' })),
    });
    expect(res.status).toBe(400);
    const b = (await res.json()) as { error: { message?: string } };
    expect(b.error.message).toMatch(/end_time/);
  });

  it('happy path: VC submits today and dashboard reflects it', async () => {
    const token = await loginAs('vc-anandpur');
    const list = await cookieFetch('/api/children?village_id=1', token);
    const { children } = (await list.json()) as {
      children: Array<{ id: number }>;
    };
    const marks = children.map((c, i) => ({
      student_id: c.id,
      present: i % 2 === 0,
    }));
    const presentCount = marks.filter((m) => m.present).length;

    const post = await cookieFetch('/api/attendance', token, {
      method: 'POST',
      body: JSON.stringify(body({ marks })),
    });
    expect(post.status).toBe(200);

    // Drill to cluster level (metric=attendance) — one row per village
    // under the cluster. VC scope narrows it to just Anandpur.
    const dash = await cookieFetch(
      '/api/dashboard/drilldown?metric=attendance&level=cluster&id=1',
      token,
    );
    expect(dash.status).toBe(200);
    const payload = (await dash.json()) as {
      child_level: string;
      headers: string[];
      rows: Array<Array<string | number>>;
      period: { from: string; to: string };
    };
    expect(payload.child_level).toBe('village');
    expect(payload.period.from).toMatch(/^\d{4}-\d{2}-01$/);
    expect(payload.period.to).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const anandpur = payload.rows.find((r) => r[0] === 'Anandpur');
    expect(anandpur).toBeDefined();
    const [, pct, fraction] = anandpur!;
    // pct is present_days / marked_days * 100. Only one date in window.
    expect(pct).toBe(Math.round((presentCount / marks.length) * 100));
    expect(fraction).toBe(`${presentCount}/${marks.length}`);
  });

  it('two sessions in the same day coexist and re-submission replaces marks', async () => {
    const token = await loginAs('vc-anandpur');
    const first = await cookieFetch('/api/attendance', token, {
      method: 'POST',
      body: JSON.stringify(body({
        event_id: 3,
        marks: [{ student_id: 1, present: true }, { student_id: 2, present: false }],
      })),
    });
    expect(first.status).toBe(200);
    const second = await cookieFetch('/api/attendance', token, {
      method: 'POST',
      body: JSON.stringify(body({
        event_id: 4,
        start_time: '14:00',
        end_time: '15:00',
        marks: [{ student_id: 1, present: false }],
      })),
    });
    expect(second.status).toBe(200);

    const get = await cookieFetch('/api/attendance?village_id=1', token);
    const g = (await get.json()) as {
      sessions: Array<{ event_id: number; marks: { student_id: number; present: boolean }[] }>;
    };
    expect(g.sessions).toHaveLength(2);

    // Re-submit the first (same village, date, event_id) with new
    // marks — the session row is reused (UPSERT) and marks replace.
    const replay = await cookieFetch('/api/attendance', token, {
      method: 'POST',
      body: JSON.stringify(body({
        event_id: 3,
        marks: [{ student_id: 1, present: false }, { student_id: 2, present: true }],
      })),
    });
    expect(replay.status).toBe(200);

    const get2 = await cookieFetch('/api/attendance?village_id=1', token);
    const g2 = (await get2.json()) as {
      sessions: Array<{ event_id: number; marks: { student_id: number; present: boolean }[] }>;
    };
    expect(g2.sessions).toHaveLength(2);
    const replayed = g2.sessions.find((s) => s.event_id === 3);
    expect(replayed?.marks.find((m) => m.student_id === 1)?.present).toBe(false);
    expect(replayed?.marks.find((m) => m.student_id === 2)?.present).toBe(true);
  });

  it('resubmission drops students that are no longer in the payload', async () => {
    // Regression cover for the DELETE-then-INSERT pattern in the POST
    // handler: if a resubmission omits a student that was on the
    // previous submission, the stale mark must not linger.
    const token = await loginAs('vc-anandpur');
    const first = await cookieFetch('/api/attendance', token, {
      method: 'POST',
      body: JSON.stringify(body({
        marks: [
          { student_id: 1, present: true },
          { student_id: 2, present: true },
        ],
      })),
    });
    expect(first.status).toBe(200);
    const subset = await cookieFetch('/api/attendance', token, {
      method: 'POST',
      body: JSON.stringify(body({
        marks: [{ student_id: 1, present: false }],
      })),
    });
    expect(subset.status).toBe(200);

    const get = await cookieFetch('/api/attendance?village_id=1', token);
    const g = (await get.json()) as {
      sessions: Array<{ event_id: number; marks: { student_id: number; present: boolean }[] }>;
    };
    const session = g.sessions.find((s) => s.event_id === 3);
    expect(session?.marks.map((m) => m.student_id)).toEqual([1]);
  });

  it('dashboard counts a student once across multiple sessions', async () => {
    const token = await loginAs('vc-anandpur');
    // Two sessions; student 1 present in both, student 2 present only in first.
    await cookieFetch('/api/attendance', token, {
      method: 'POST',
      body: JSON.stringify(body({
        event_id: 3,
        marks: [
          { student_id: 1, present: true },
          { student_id: 2, present: true },
        ],
      })),
    });
    await cookieFetch('/api/attendance', token, {
      method: 'POST',
      body: JSON.stringify(body({
        event_id: 4,
        start_time: '14:00',
        end_time: '15:00',
        marks: [
          { student_id: 1, present: true },
          { student_id: 2, present: false },
        ],
      })),
    });
    const dash = await cookieFetch(
      '/api/dashboard/drilldown?metric=attendance&level=cluster&id=1',
      token,
    );
    const b = (await dash.json()) as {
      rows: Array<Array<string | number>>;
    };
    const anandpur = b.rows.find((r) => r[0] === 'Anandpur');
    // Distinct student-days: student 1 present in both sessions → 1
    // distinct present-day. Student 2 present somewhere that day → 1
    // distinct present-day. Both marked → 2 distinct marked-days.
    expect(anandpur).toEqual(['Anandpur', 100, '2/2']);
  });
});

describe('events', () => {
  it('lists seeded events grouped by kind', async () => {
    const token = await loginAs('vc-anandpur');
    const res = await cookieFetch('/api/events', token);
    expect(res.status).toBe(200);
    const { events } = (await res.json()) as {
      events: Array<{ id: number; name: string; kind: 'event' | 'activity' }>;
    };
    expect(events.length).toBeGreaterThan(0);
    expect(events.some((e) => e.kind === 'event')).toBe(true);
    expect(events.some((e) => e.kind === 'activity')).toBe(true);
  });
});

describe('children write — role allow-list', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('super_admin can add a child with a minimal but valid profile', async () => {
    const token = await loginAs('super');
    const res = await cookieFetch('/api/children', token, {
      method: 'POST',
      body: JSON.stringify({
        village_id: 1,
        school_id: 1,
        first_name: 'Test',
        last_name: 'Child',
        gender: 'o',
        dob: '2018-06-15',
        // At least one parent is required per §3.2.2. A parent without
        // a phone is allowed (the smartphone rule only engages once a
        // phone exists).
        father_name: 'Test Parent',
      }),
    });
    expect(res.status).toBe(201);
  });

  it('rejects a dob that is not YYYY-MM-DD', async () => {
    const token = await loginAs('vc-anandpur');
    const res = await cookieFetch('/api/children', token, {
      method: 'POST',
      body: JSON.stringify({
        village_id: 1,
        school_id: 1,
        first_name: 'Test',
        last_name: 'Child',
        gender: 'm',
        dob: 1234567890,
        father_name: 'Test Parent',
      }),
    });
    expect(res.status).toBe(400);
  });
});

describe('children full profile (L2.1)', () => {
  beforeEach(async () => {
    await resetDb();
  });

  const minimal = {
    village_id: 1,
    school_id: 1,
    first_name: 'Ananya',
    last_name: 'Test',
    gender: 'f' as const,
    dob: '2018-06-15',
  };

  it('requires at least one parent name', async () => {
    const token = await loginAs('vc-anandpur');
    const res = await cookieFetch('/api/children', token, {
      method: 'POST',
      body: JSON.stringify(minimal),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).toMatch(/parent/i);
  });

  it('accepts a parent without a phone (smartphone rule only triggers on phone)', async () => {
    const token = await loginAs('vc-anandpur');
    const res = await cookieFetch('/api/children', token, {
      method: 'POST',
      body: JSON.stringify({ ...minimal, father_name: 'Ravi' }),
    });
    expect(res.status).toBe(201);
  });

  it('rejects a malformed Indian phone', async () => {
    const token = await loginAs('vc-anandpur');
    const res = await cookieFetch('/api/children', token, {
      method: 'POST',
      body: JSON.stringify({
        ...minimal,
        father_name: 'Ravi',
        // 9 digits → invalid.
        father_phone: '987654321',
      }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).toMatch(/father_phone/);
  });

  it('requires alt contact when neither parent has a smartphone', async () => {
    const token = await loginAs('vc-anandpur');
    const res = await cookieFetch('/api/children', token, {
      method: 'POST',
      body: JSON.stringify({
        ...minimal,
        father_name: 'Ravi',
        father_phone: '9876543210',
        father_has_smartphone: false,
      }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).toMatch(/alt contact/i);
  });

  it('alt contact must be complete (name + phone + relationship)', async () => {
    const token = await loginAs('vc-anandpur');
    const res = await cookieFetch('/api/children', token, {
      method: 'POST',
      body: JSON.stringify({
        ...minimal,
        father_name: 'Ravi',
        father_phone: '9876543210',
        father_has_smartphone: false,
        alt_contact_name: 'Neighbour',
        alt_contact_phone: '9123456780',
        // relationship omitted
      }),
    });
    expect(res.status).toBe(400);
  });

  it('happy path: parent with smartphone — alt contact not required', async () => {
    const token = await loginAs('vc-anandpur');
    const res = await cookieFetch('/api/children', token, {
      method: 'POST',
      body: JSON.stringify({
        ...minimal,
        father_name: 'Ravi',
        father_phone: '9876543210',
        father_has_smartphone: true,
      }),
    });
    expect(res.status).toBe(201);
  });

  it('happy path: no smartphone, alt contact supplied', async () => {
    const token = await loginAs('vc-anandpur');
    const res = await cookieFetch('/api/children', token, {
      method: 'POST',
      body: JSON.stringify({
        ...minimal,
        father_name: 'Ravi',
        father_phone: '9876543210',
        father_has_smartphone: false,
        alt_contact_name: 'Neighbour',
        alt_contact_phone: '9123456780',
        alt_contact_relationship: 'neighbour',
      }),
    });
    expect(res.status).toBe(201);
    const created = (await res.json()) as { id: number };
    const detail = await cookieFetch(`/api/children/${created.id}`, token);
    expect(detail.status).toBe(200);
    const detailBody = (await detail.json()) as {
      child: {
        father_name: string;
        father_phone: string;
        alt_contact_relationship: string;
      };
    };
    expect(detailBody.child.father_name).toBe('Ravi');
    // Phone is canonicalised to `+91XXXXXXXXXX` on write so the
    // same number written with and without prefix stores identically.
    expect(detailBody.child.father_phone).toBe('+919876543210');
    expect(detailBody.child.alt_contact_relationship).toBe('neighbour');
  });

  it('GET /api/children/:id scope-checks the village', async () => {
    // Belur VC can't read an Anandpur student.
    const belur = await loginAs('vc-belur');
    // Student 1 is seeded in Anandpur (village 1).
    const res = await cookieFetch('/api/children/1', belur);
    expect(res.status).toBe(403);
  });

  it('PATCH /api/children/:id updates editable fields', async () => {
    const token = await loginAs('vc-anandpur');
    const res = await cookieFetch('/api/children/1', token, {
      method: 'PATCH',
      body: JSON.stringify({
        father_name: 'Updated Name',
        father_phone: '9812345670',
        father_has_smartphone: true,
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      child: { father_name: string; father_has_smartphone: number };
    };
    expect(body.child.father_name).toBe('Updated Name');
    expect(body.child.father_has_smartphone).toBe(1);
  });

  it('PATCH rejects a sibling-village attempt (403)', async () => {
    const token = await loginAs('vc-belur');
    // Student 1 belongs to Anandpur (village 1), not Belur.
    const res = await cookieFetch('/api/children/1', token, {
      method: 'PATCH',
      body: JSON.stringify({ first_name: 'Hack' }),
    });
    expect(res.status).toBe(403);
  });

  it('PATCH with only core fields preserves the profile block', async () => {
    // Regression: a previous implementation wiped parent + alt-contact
    // columns to NULL whenever the PATCH body omitted them.
    const token = await loginAs('vc-anandpur');

    // Seed student 2 with a full profile (no-smartphone path so alt
    // contact is also populated).
    const put = await cookieFetch('/api/children/2', token, {
      method: 'PATCH',
      body: JSON.stringify({
        father_name: 'Mohan',
        father_phone: '9876543210',
        father_has_smartphone: false,
        mother_name: 'Sita',
        mother_phone: '9812345670',
        mother_has_smartphone: false,
        alt_contact_name: 'Raju',
        alt_contact_phone: '9123456780',
        alt_contact_relationship: 'uncle',
      }),
    });
    expect(put.status).toBe(200);

    // Now PATCH only a core field; profile block must survive.
    const core = await cookieFetch('/api/children/2', token, {
      method: 'PATCH',
      body: JSON.stringify({ first_name: 'Renamed' }),
    });
    expect(core.status).toBe(200);

    const detail = await cookieFetch('/api/children/2', token);
    const body = (await detail.json()) as {
      child: {
        first_name: string;
        father_name: string | null;
        father_phone: string | null;
        mother_name: string | null;
        alt_contact_relationship: string | null;
      };
    };
    expect(body.child.first_name).toBe('Renamed');
    expect(body.child.father_name).toBe('Mohan');
    expect(body.child.father_phone).toBe('+919876543210');
    expect(body.child.mother_name).toBe('Sita');
    expect(body.child.alt_contact_relationship).toBe('uncle');
  });

  it('PATCH with explicit null clears a single profile field', async () => {
    // The inverse of the preservation test — a client passing
    // `null` explicitly (vs. omitting the key) clears that field.
    const token = await loginAs('vc-anandpur');
    // Student 3 starts with a father + alt contact.
    await cookieFetch('/api/children/3', token, {
      method: 'PATCH',
      body: JSON.stringify({
        father_name: 'Arun',
        father_phone: '9876543210',
        father_has_smartphone: true,
      }),
    });
    // Clear alt_contact_relationship explicitly (which is already
    // null, but we want to prove the `null` path is honoured and
    // passes validation because an smartphone parent exists).
    const res = await cookieFetch('/api/children/3', token, {
      method: 'PATCH',
      body: JSON.stringify({ alt_contact_relationship: null }),
    });
    expect(res.status).toBe(200);
  });

  it('graduate sets graduated_at + reason; a second attempt is rejected', async () => {
    const token = await loginAs('vc-anandpur');
    const today = todayIst();
    const first = await cookieFetch('/api/children/1/graduate', token, {
      method: 'POST',
      body: JSON.stringify({ graduated_at: today, graduation_reason: 'pass_out' }),
    });
    expect(first.status).toBe(200);
    const body = (await first.json()) as {
      child: { graduated_at: string; graduation_reason: string };
    };
    expect(body.child.graduated_at).toBe(today);
    expect(body.child.graduation_reason).toBe('pass_out');

    const second = await cookieFetch('/api/children/1/graduate', token, {
      method: 'POST',
      body: JSON.stringify({ graduated_at: today }),
    });
    expect(second.status).toBe(400);
  });

  it('a graduated child is excluded from the active list and from attendance', async () => {
    const token = await loginAs('vc-anandpur');
    await cookieFetch('/api/children/1/graduate', token, {
      method: 'POST',
      body: JSON.stringify({}),
    });

    const list = await cookieFetch('/api/children?village_id=1', token);
    const listBody = (await list.json()) as { children: Array<{ id: number }> };
    expect(listBody.children.some((c) => c.id === 1)).toBe(false);

    const withGraduated = await cookieFetch(
      '/api/children?village_id=1&include_graduated=1',
      token,
    );
    const withBody = (await withGraduated.json()) as {
      children: Array<{ id: number; graduated_at: string | null }>;
    };
    const graduatedRow = withBody.children.find((c) => c.id === 1);
    expect(graduatedRow?.graduated_at).not.toBeNull();

    // Submitting attendance that includes the graduated student fails.
    const postRes = await cookieFetch('/api/attendance', token, {
      method: 'POST',
      body: JSON.stringify({
        village_id: 1,
        event_id: 3,
        start_time: '10:00',
        end_time: '11:00',
        marks: [{ student_id: 1, present: true }],
      }),
    });
    expect(postRes.status).toBe(400);
    const graduatedBody = (await postRes.json()) as { error: { message?: string } };
    expect(graduatedBody.error.message).toMatch(/graduated/);
  });

  it('graduate rejects a future date and pre-join date', async () => {
    const token = await loginAs('vc-anandpur');
    const future = await cookieFetch('/api/children/1/graduate', token, {
      method: 'POST',
      body: JSON.stringify({ graduated_at: '2099-01-01' }),
    });
    expect(future.status).toBe(400);

    const preJoin = await cookieFetch('/api/children/1/graduate', token, {
      method: 'POST',
      body: JSON.stringify({ graduated_at: '2020-01-01' }),
    });
    expect(preJoin.status).toBe(400);
  });
});

describe('geo-admin tiers (read-only by construction)', () => {
  // The seeded geo tree is one zone → one state → one region → one
  // district → one cluster → three villages. Each geo admin role
  // anchors to the one seeded row at its level. Cross-district
  // isolation is covered by the "VC accessing a sibling village"
  // test above (the policy layer is the same gate).
  const tiers = [
    { user: 'district-bid', role: 'district_admin' },
    { user: 'region-sk', role: 'region_admin' },
    { user: 'state-ka', role: 'state_admin' },
    { user: 'zone-sz', role: 'zone_admin' },
  ];

  for (const tier of tiers) {
    describe(`${tier.role} (${tier.user})`, () => {
      it('reads every village that rolls up to its scope', async () => {
        const token = await loginAs(tier.user);
        // All 3 seeded villages roll up to this admin's scope.
        for (const villageId of [1, 2, 3]) {
          const res = await cookieFetch(
            `/api/children?village_id=${villageId}`,
            token,
          );
          expect(res.status).toBe(200);
        }
      });

      it('cannot write children (403)', async () => {
        const token = await loginAs(tier.user);
        const res = await cookieFetch('/api/children', token, {
          method: 'POST',
          body: JSON.stringify({
            village_id: 1,
            school_id: 1,
            first_name: 'Not',
            last_name: 'Allowed',
            gender: 'o',
            dob: '2018-06-15',
          }),
        });
        expect(res.status).toBe(403);
      });

      it('cannot write attendance (403)', async () => {
        const token = await loginAs(tier.user);
        const res = await cookieFetch('/api/attendance', token, {
          method: 'POST',
          body: JSON.stringify({
            village_id: 1,
            marks: [{ student_id: 1, present: true }],
          }),
        });
        expect(res.status).toBe(403);
      });

      it('/auth/me reports the expected read-only capability set', async () => {
        const token = await loginAs(tier.user);
        const res = await cookieFetch('/auth/me', token);
        expect(res.status).toBe(200);
        const body = (await res.json()) as {
          user: { role: string; capabilities: string[] };
        };
        expect(body.user.role).toBe(tier.role);
        expect(body.user.capabilities).toContain('dashboard.read');
        expect(body.user.capabilities).not.toContain('child.write');
        expect(body.user.capabilities).not.toContain('attendance.write');
      });

      it('sees all in-scope villages on the drill-down dashboard', async () => {
        const token = await loginAs(tier.user);
        // Drill at cluster=1 — the single seeded cluster holds all 3
        // villages. Every read-only geo tier has the whole tree in
        // scope for the L1 seed, so the row set is complete.
        const res = await cookieFetch(
          '/api/dashboard/drilldown?metric=children&level=cluster&id=1',
          token,
        );
        expect(res.status).toBe(200);
        const body = (await res.json()) as {
          rows: Array<Array<string | number>>;
          drill_ids: (number | null)[];
        };
        const names = body.rows.map((r) => r[0]).sort();
        expect(names).toEqual(['Anandpur', 'Belur', 'Chandragiri']);
        // All three have non-null village ids to drill into.
        expect(body.drill_ids.filter((x) => x !== null)).toHaveLength(3);
      });
    });
  }
});

describe('achievements (L2.3)', () => {
  beforeEach(async () => {
    await resetDb();
  });

  function thisMonthDay(day: number): string {
    const d = String(day).padStart(2, '0');
    return `${todayIst().slice(0, 7)}-${d}`;
  }

  it('VC creates a gold with a medal count', async () => {
    const token = await loginAs('vc-anandpur');
    const res = await cookieFetch('/api/achievements', token, {
      method: 'POST',
      body: JSON.stringify({
        student_id: 1,
        description: 'Math olympiad',
        date: thisMonthDay(10),
        type: 'gold',
        gold_count: 2,
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      achievement: { id: number; type: string; gold_count: number; silver_count: number | null };
    };
    expect(body.achievement.type).toBe('gold');
    expect(body.achievement.gold_count).toBe(2);
    expect(body.achievement.silver_count).toBeNull();
  });

  it('POST rejects gold without gold_count', async () => {
    const token = await loginAs('vc-anandpur');
    const res = await cookieFetch('/api/achievements', token, {
      method: 'POST',
      body: JSON.stringify({
        student_id: 1,
        description: 'Bad',
        date: thisMonthDay(10),
        type: 'gold',
      }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).toMatch(/gold_count required/);
  });

  it('POST rejects mismatched medal counts (silver on type=gold)', async () => {
    const token = await loginAs('vc-anandpur');
    const res = await cookieFetch('/api/achievements', token, {
      method: 'POST',
      body: JSON.stringify({
        student_id: 1,
        description: 'Bad',
        date: thisMonthDay(10),
        type: 'gold',
        gold_count: 1,
        silver_count: 1,
      }),
    });
    expect(res.status).toBe(400);
  });

  it('second SoM in the same month replaces the first', async () => {
    const token = await loginAs('vc-anandpur');
    // Student 2 has no seeded SoM this month (seed gives student 2 a
    // gold). First POST goes through the INSERT branch — 201. Second
    // POST, same student, same month, hits the DO UPDATE branch — 200.
    const first = await cookieFetch('/api/achievements', token, {
      method: 'POST',
      body: JSON.stringify({
        student_id: 2,
        description: 'Initial description',
        date: thisMonthDay(5),
        type: 'som',
      }),
    });
    expect(first.status).toBe(201);
    const firstId = ((await first.json()) as { achievement: { id: number } }).achievement.id;

    const second = await cookieFetch('/api/achievements', token, {
      method: 'POST',
      body: JSON.stringify({
        student_id: 2,
        description: 'Updated description',
        date: thisMonthDay(12),
        type: 'som',
      }),
    });
    // A replace isn't a creation: the route returns 200 (not 201)
    // whenever the UPSERT took the DO UPDATE path.
    expect(second.status).toBe(200);
    const secondId = ((await second.json()) as { achievement: { id: number } }).achievement.id;
    // Same underlying row — the partial unique index collided and we
    // performed an UPDATE via UPSERT rather than an INSERT.
    expect(secondId).toBe(firstId);

    const list = await cookieFetch(
      `/api/achievements?village_id=1&from=${thisMonthDay(1)}&to=${thisMonthDay(28)}&type=som`,
      token,
    );
    const body = (await list.json()) as {
      achievements: Array<{ id: number; description: string; date: string }>;
    };
    const mine = body.achievements.filter((a) => a.id === firstId);
    expect(mine).toHaveLength(1);
    expect(mine[0]?.description).toBe('Updated description');
  });

  it('rejects achievement on a graduated student', async () => {
    const adminToken = await loginAs('super');
    // Graduate student 1 via the dedicated graduate endpoint.
    const grad = await cookieFetch('/api/children/1/graduate', adminToken, {
      method: 'POST',
      body: JSON.stringify({
        graduated_at: thisMonthDay(1),
        graduation_reason: 'pass_out',
      }),
    });
    expect(grad.status).toBe(200);

    const vcToken = await loginAs('vc-anandpur');
    const res = await cookieFetch('/api/achievements', vcToken, {
      method: 'POST',
      body: JSON.stringify({
        student_id: 1,
        description: 'Post-grad award',
        date: thisMonthDay(15),
        type: 'som',
      }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).toMatch(/graduated/);
  });

  it('VC cannot create achievement in sibling village (403)', async () => {
    const token = await loginAs('vc-anandpur');
    // Student 8 is in Belur (village 2).
    const res = await cookieFetch('/api/achievements', token, {
      method: 'POST',
      body: JSON.stringify({
        student_id: 8,
        description: 'Should fail',
        date: thisMonthDay(10),
        type: 'som',
      }),
    });
    expect(res.status).toBe(403);
  });

  it('PATCH allows editing description/date but not type', async () => {
    const token = await loginAs('vc-anandpur');
    const create = await cookieFetch('/api/achievements', token, {
      method: 'POST',
      body: JSON.stringify({
        student_id: 1,
        description: 'Original',
        date: thisMonthDay(10),
        type: 'gold',
        gold_count: 1,
      }),
    });
    const id = ((await create.json()) as { achievement: { id: number } }).achievement.id;

    const patch = await cookieFetch(`/api/achievements/${id}`, token, {
      method: 'PATCH',
      body: JSON.stringify({
        description: 'Edited',
        gold_count: 3,
      }),
    });
    expect(patch.status).toBe(200);
    const body = (await patch.json()) as {
      achievement: { description: string; gold_count: number; type: string };
    };
    expect(body.achievement.description).toBe('Edited');
    expect(body.achievement.gold_count).toBe(3);
    expect(body.achievement.type).toBe('gold');
  });

  it('GET defaults to scope-wide list ordered by date desc', async () => {
    const token = await loginAs('af-bid01');
    const res = await cookieFetch('/api/achievements', token);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      achievements: Array<{ date: string; village_id: number }>;
    };
    // Seed contains 7 achievements across all three villages in the cluster.
    expect(body.achievements.length).toBeGreaterThanOrEqual(7);
    // Ordered date desc.
    for (let i = 1; i < body.achievements.length; i++) {
      expect(body.achievements[i - 1]!.date >= body.achievements[i]!.date).toBe(true);
    }
  });

  it('district_admin (read-only) cannot POST', async () => {
    const token = await loginAs('district-bid');
    const res = await cookieFetch('/api/achievements', token, {
      method: 'POST',
      body: JSON.stringify({
        student_id: 1,
        description: 'Should fail',
        date: thisMonthDay(10),
        type: 'som',
      }),
    });
    expect(res.status).toBe(403);
  });

  // Review #24 blocker: previously surfaced as a raw 500 from the
  // partial unique index. Now pre-checked in the route so callers
  // see a structured 409.
  it('PATCH of a SoM date into a month that already has one returns 409', async () => {
    const token = await loginAs('vc-anandpur');
    // Seed has student 1 SoM this month. Create a second SoM for
    // student 1 in the _previous_ month via super_admin direct insert
    // — simpler path: create one next month's SoM on student 2 (no
    // collision), then PATCH its date into this month where student 2
    // already has no SoM. Actually: cleaner to stage two SoM rows for
    // the same student in different months, then move one onto the
    // other's month.
    const nextMonth = thisMonthDay(15);
    // Month 1 SoM for student 2.
    const a = await cookieFetch('/api/achievements', token, {
      method: 'POST',
      body: JSON.stringify({
        student_id: 2,
        description: 'Month 1 SoM',
        date: thisMonthDay(5),
        type: 'som',
      }),
    });
    expect(a.status).toBe(201);
    const firstId = ((await a.json()) as { achievement: { id: number } }).achievement.id;

    // Different YYYY-MM for the second SoM row: pick a January date
    // in the same year as `nextMonth` to guarantee it's a distinct
    // month regardless of when the test runs.
    const otherMonth = nextMonth.slice(0, 4) + '-01-15';
    const b = await cookieFetch('/api/achievements', token, {
      method: 'POST',
      body: JSON.stringify({
        student_id: 2,
        description: 'Other month SoM',
        date: otherMonth,
        type: 'som',
      }),
    });
    expect(b.status).toBe(201);
    const secondId = ((await b.json()) as { achievement: { id: number } }).achievement.id;
    expect(secondId).not.toBe(firstId);

    // Now PATCH the January row's date into the current month — same
    // student, same target YYYY-MM as `firstId`. Should 409, not 500.
    const patch = await cookieFetch(`/api/achievements/${secondId}`, token, {
      method: 'PATCH',
      body: JSON.stringify({ date: thisMonthDay(20) }),
    });
    expect(patch.status).toBe(409);
    const body = (await patch.json()) as { error: { code: string; message?: string } };
    expect(body.error.code).toBe('conflict');
  });
});

describe('dashboard drill-down (L2.3)', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('india level: children rolls up to a single zone row', async () => {
    const token = await loginAs('super');
    const res = await cookieFetch(
      '/api/dashboard/drilldown?metric=children&level=india',
      token,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      level: string;
      child_level: string;
      crumbs: Array<{ level: string; name: string }>;
      headers: string[];
      rows: Array<Array<string | number>>;
    };
    expect(body.level).toBe('india');
    expect(body.child_level).toBe('zone');
    expect(body.crumbs).toEqual([{ level: 'india', id: null, name: 'India' }]);
    expect(body.headers).toEqual(['Zone', 'Children']);
    // One zone (South Zone) with 20 seeded active students.
    expect(body.rows).toHaveLength(1);
    expect(body.rows[0]).toEqual(['South Zone', 20]);
  });

  it('cluster level: achievements tallies seeded SoM / gold / silver', async () => {
    const token = await loginAs('super');
    const today = todayIst();
    const monthStart = today.slice(0, 7) + '-01';
    const res = await cookieFetch(
      `/api/dashboard/drilldown?metric=achievements&level=cluster&id=1&from=${monthStart}&to=${today}`,
      token,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      child_level: string;
      headers: string[];
      rows: Array<Array<string | number>>;
      period: { from: string; to: string };
    };
    expect(body.child_level).toBe('village');
    expect(body.headers).toEqual(['Village', 'Total', 'SoM', 'Gold', 'Silver']);
    expect(body.period.from).toBe(monthStart);
    // Seed: 3 SoM + 2 gold + 2 silver = 7 total in the current month.
    const totals = body.rows.reduce((acc, r) => acc + (r[1] as number), 0);
    expect(totals).toBe(7);
  });

  it('village level: children shows per-student detail and no drill', async () => {
    const token = await loginAs('vc-anandpur');
    const res = await cookieFetch(
      '/api/dashboard/drilldown?metric=children&level=village&id=1',
      token,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      child_level: string;
      headers: string[];
      rows: Array<Array<string | number>>;
      drill_ids: (number | null)[];
    };
    expect(body.child_level).toBe('detail');
    expect(body.headers[0]).toBe('First name');
    expect(body.drill_ids.every((x) => x === null)).toBe(true);
    expect(body.rows.length).toBeGreaterThan(0);
  });

  it('rejects out-of-scope level/id combination (403)', async () => {
    const token = await loginAs('vc-anandpur');
    // VC for Anandpur (village 1) asking for Belur (village 2).
    const res = await cookieFetch(
      '/api/dashboard/drilldown?metric=children&level=village&id=2',
      token,
    );
    expect(res.status).toBe(403);
  });

  it('unknown id returns 404', async () => {
    const token = await loginAs('super');
    const res = await cookieFetch(
      '/api/dashboard/drilldown?metric=children&level=zone&id=9999',
      token,
    );
    expect(res.status).toBe(404);
  });

  it('rejects bad metric with 400', async () => {
    const token = await loginAs('super');
    const res = await cookieFetch(
      '/api/dashboard/drilldown?metric=bogus&level=india',
      token,
    );
    expect(res.status).toBe(400);
  });

  it('crumbs drop India for non-global users (cosmetic, review #24)', async () => {
    const clusterAdmin = await loginAs('cluster-bid01');
    const res = await cookieFetch(
      '/api/dashboard/drilldown?metric=children&level=cluster&id=1',
      clusterAdmin,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { crumbs: Array<{ level: string; name: string }> };
    expect(body.crumbs.map((c) => c.level)).toEqual(['cluster']);
    expect(body.crumbs[0]!.name).toBe('Bidar Cluster 1');

    // Super admin still sees India at the root of the same drill.
    const admin = await loginAs('super');
    const res2 = await cookieFetch(
      '/api/dashboard/drilldown?metric=children&level=cluster&id=1',
      admin,
    );
    const body2 = (await res2.json()) as { crumbs: Array<{ level: string }> };
    expect(body2.crumbs.map((c) => c.level)).toEqual([
      'india', 'zone', 'state', 'region', 'district', 'cluster',
    ]);
  });

  it('CSV export returns text/csv with attachment disposition', async () => {
    const token = await loginAs('super');
    const res = await cookieFetch(
      '/api/dashboard/drilldown.csv?metric=children&level=cluster&id=1',
      token,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/text\/csv/);
    const disposition = res.headers.get('content-disposition') ?? '';
    expect(disposition).toMatch(/attachment; filename=/);
    expect(disposition).toMatch(/children_cluster_Bidar_Cluster_1/);
    const body = await res.text();
    // Headers + rows only. Per decisions.md D5 the CSV mirrors the
    // on-screen table; context lives in the filename, not inline.
    expect(body.split(/\r\n/)[0]).toBe('Village,Children');
    expect(body).toMatch(/Anandpur,\d+/);
  });
});
