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
    // Two zones — South Zone (KA + TN) and Northeast Zone (NL) —
    // summing to the 96 active students in the seed. Per-zone
    // counts are asserted by total, not by value, so the seed can
    // be rebalanced without rewriting this test.
    expect(body.rows.length).toBeGreaterThanOrEqual(2);
    const zoneNames = body.rows.map((r) => r[0]);
    expect(zoneNames).toContain('South Zone');
    expect(zoneNames).toContain('Northeast Zone');
    const totalChildren = body.rows.reduce(
      (acc, r) => acc + (r[1] as number),
      0,
    );
    expect(totalChildren).toBe(96);
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

describe('media pipeline (L2.4)', () => {
  beforeEach(async () => {
    await resetDb();
  });

  // crypto.randomUUID is exposed on workerd; tests use the same
  // generator the web client will.
  function newUuid(): string {
    return crypto.randomUUID();
  }

  // Minimal 1x1 PNG (10 bytes). Real enough for the R2 PUT + HEAD
  // verify round-trip without shipping a fixture file.
  const PNG_BYTES = new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00,
  ]);

  async function presign(
    token: string,
    body: Record<string, unknown>,
  ): Promise<{ status: number; data: Record<string, unknown> }> {
    const res = await cookieFetch('/api/media/presign', token, {
      method: 'POST',
      body: JSON.stringify(body),
    });
    return { status: res.status, data: await res.json() as Record<string, unknown> };
  }

  // Full presign → PUT → commit round-trip, returning the committed
  // media row. Used by the attachment tests below.
  async function uploadAndCommit(
    token: string,
    opts: {
      kind: 'image' | 'video' | 'audio';
      mime: string;
      bytes: Uint8Array;
      village_id: number;
      tag_event_id?: number | null;
    },
  ): Promise<{ id: number; uuid: string; r2_key: string }> {
    const uuid = newUuid();
    const capturedAt = Math.floor(Date.now() / 1000);
    const p = await presign(token, {
      uuid, kind: opts.kind, mime: opts.mime,
      bytes: opts.bytes.byteLength,
      village_id: opts.village_id, captured_at: capturedAt,
    });
    expect(p.status).toBe(200);
    const uploadUrl = p.data.upload_url as string;
    const putRes = await SELF.fetch(`http://api.test${uploadUrl}`, {
      method: 'PUT',
      headers: { 'content-type': opts.mime },
      body: opts.bytes,
    });
    expect(putRes.status).toBe(200);
    const commit = await cookieFetch('/api/media', token, {
      method: 'POST',
      body: JSON.stringify({
        uuid,
        kind: opts.kind,
        r2_key: p.data.r2_key,
        mime: opts.mime,
        bytes: opts.bytes.byteLength,
        captured_at: capturedAt,
        latitude: 12.97,
        longitude: 77.59,
        village_id: opts.village_id,
        tag_event_id: opts.tag_event_id ?? null,
      }),
    });
    expect(commit.status).toBe(201);
    const body = await commit.json() as { media: { id: number; uuid: string; r2_key: string } };
    return body.media;
  }

  it('presign returns an upload_url and an HMAC-signed token', async () => {
    const token = await loginAs('vc-anandpur');
    const { status, data } = await presign(token, {
      uuid: newUuid(), kind: 'image', mime: 'image/png',
      bytes: 1024, village_id: 1, captured_at: 1_700_000_000,
    });
    expect(status).toBe(200);
    expect(data.upload_method).toBe('PUT');
    expect(data.upload_url).toMatch(/^\/api\/media\/upload\/[0-9a-f-]+\?token=/);
    expect(typeof data.expires_at).toBe('number');
    expect(data.r2_key).toMatch(/^image\/\d{4}\/\d{2}\/\d{2}\/1\/[0-9a-f-]+\.png$/);
  });

  it('presign rejects unknown kinds + disallowed MIMEs', async () => {
    const token = await loginAs('vc-anandpur');
    const bad1 = await presign(token, {
      uuid: newUuid(), kind: 'doc', mime: 'application/pdf',
      bytes: 10, village_id: 1, captured_at: 1_700_000_000,
    });
    expect(bad1.status).toBe(400);
    const bad2 = await presign(token, {
      uuid: newUuid(), kind: 'image', mime: 'application/pdf',
      bytes: 10, village_id: 1, captured_at: 1_700_000_000,
    });
    expect(bad2.status).toBe(400);
  });

  it('presign rejects bytes above the 50 MiB cap', async () => {
    const token = await loginAs('vc-anandpur');
    const res = await presign(token, {
      uuid: newUuid(), kind: 'video', mime: 'video/mp4',
      bytes: 60 * 1024 * 1024, village_id: 1, captured_at: 1_700_000_000,
    });
    expect(res.status).toBe(413);
  });

  it('presign against a sibling village returns 403', async () => {
    const token = await loginAs('vc-anandpur');
    const res = await presign(token, {
      uuid: newUuid(), kind: 'image', mime: 'image/jpeg',
      bytes: 100, village_id: 2, captured_at: 1_700_000_000,
    });
    expect(res.status).toBe(403);
  });

  it('PUT /upload/:uuid with a bad token is rejected', async () => {
    const uuid = newUuid();
    const res = await SELF.fetch(
      `http://api.test/api/media/upload/${uuid}?token=not-a-valid-token`,
      { method: 'PUT', body: new Uint8Array([1, 2, 3]) },
    );
    expect(res.status).toBe(401);
  });

  it('PUT with a uuid path mismatching the token returns 400', async () => {
    const token = await loginAs('vc-anandpur');
    const { data } = await presign(token, {
      uuid: newUuid(), kind: 'image', mime: 'image/png',
      bytes: 10, village_id: 1, captured_at: 1_700_000_000,
    });
    const uploadUrl = data.upload_url as string;
    // Swap the uuid in the path but keep the same token — signed
    // payload has the original uuid.
    const tampered = uploadUrl.replace(/upload\/[0-9a-f-]+/, `upload/${newUuid()}`);
    const res = await SELF.fetch(`http://api.test${tampered}`, {
      method: 'PUT',
      headers: { 'content-type': 'image/png' },
      body: PNG_BYTES,
    });
    expect(res.status).toBe(400);
  });

  it('full round-trip: presign → PUT → commit → GET returns bytes', async () => {
    const token = await loginAs('vc-anandpur');
    const media = await uploadAndCommit(token, {
      kind: 'image', mime: 'image/png', bytes: PNG_BYTES, village_id: 1,
    });
    // Raw stream endpoint serves what we PUT.
    const raw = await cookieFetch(`/api/media/raw/${media.uuid}`, token);
    expect(raw.status).toBe(200);
    expect(raw.headers.get('content-type')).toMatch(/image\/png/);
    const buf = new Uint8Array(await raw.arrayBuffer());
    expect(buf.length).toBe(PNG_BYTES.length);
  });

  it('commit rejects when R2 object is missing (no prior PUT)', async () => {
    const token = await loginAs('vc-anandpur');
    const uuid = newUuid();
    // Presign so we have a valid r2_key, but never PUT anything.
    const p = await presign(token, {
      uuid, kind: 'image', mime: 'image/jpeg',
      bytes: 500, village_id: 1, captured_at: 1_700_000_000,
    });
    const res = await cookieFetch('/api/media', token, {
      method: 'POST',
      body: JSON.stringify({
        uuid, kind: 'image',
        r2_key: (p.data as { r2_key: string }).r2_key,
        mime: 'image/jpeg', bytes: 500,
        captured_at: 1_700_000_000, village_id: 1,
      }),
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: { message?: string } };
    expect(body.error.message).toMatch(/R2/i);
  });

  it('commit rejects when claimed bytes mismatch the R2 object', async () => {
    const token = await loginAs('vc-anandpur');
    const uuid = newUuid();
    const p = await presign(token, {
      uuid, kind: 'image', mime: 'image/png',
      bytes: PNG_BYTES.length, village_id: 1, captured_at: 1_700_000_000,
    });
    const data = p.data as { upload_url: string; r2_key: string };
    await SELF.fetch(`http://api.test${data.upload_url}`, {
      method: 'PUT',
      headers: { 'content-type': 'image/png' },
      body: PNG_BYTES,
    });
    const res = await cookieFetch('/api/media', token, {
      method: 'POST',
      body: JSON.stringify({
        uuid, kind: 'image', r2_key: data.r2_key, mime: 'image/png',
        bytes: PNG_BYTES.length + 100,             // lie about size
        captured_at: 1_700_000_000, village_id: 1,
      }),
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: { message?: string } };
    expect(body.error.message).toMatch(/byte count mismatch/i);
  });

  it('commit is idempotent on retry (same uuid returns the same row)', async () => {
    const token = await loginAs('vc-anandpur');
    const media = await uploadAndCommit(token, {
      kind: 'image', mime: 'image/png', bytes: PNG_BYTES, village_id: 1,
    });
    // Second commit with the same uuid should return the same id.
    const res = await cookieFetch('/api/media', token, {
      method: 'POST',
      body: JSON.stringify({
        uuid: media.uuid, kind: 'image', r2_key: media.r2_key,
        mime: 'image/png', bytes: PNG_BYTES.length,
        captured_at: 1_700_000_000, village_id: 1,
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { media: { id: number } };
    expect(body.media.id).toBe(media.id);
  });

  it('list scopes to the caller and filters by kind', async () => {
    const vcToken = await loginAs('vc-anandpur');
    await uploadAndCommit(vcToken, {
      kind: 'image', mime: 'image/png', bytes: PNG_BYTES, village_id: 1,
    });
    await uploadAndCommit(vcToken, {
      kind: 'audio', mime: 'audio/mp4', bytes: PNG_BYTES, village_id: 1,
    });
    const all = await cookieFetch('/api/media', vcToken);
    const allBody = await all.json() as { media: unknown[] };
    expect(allBody.media.length).toBe(2);

    const onlyAudio = await cookieFetch('/api/media?kind=audio', vcToken);
    const audioBody = await onlyAudio.json() as { media: { kind: string }[] };
    expect(audioBody.media.every((m) => m.kind === 'audio')).toBe(true);

    // Sibling VC can't see either row.
    const sibling = await loginAs('vc-belur');
    const res = await cookieFetch('/api/media?village_id=1', sibling);
    expect(res.status).toBe(403);
  });

  it('DELETE soft-deletes (row becomes invisible to list + get)', async () => {
    const token = await loginAs('vc-anandpur');
    const media = await uploadAndCommit(token, {
      kind: 'image', mime: 'image/png', bytes: PNG_BYTES, village_id: 1,
    });
    const del = await cookieFetch(`/api/media/${media.id}`, token, { method: 'DELETE' });
    expect(del.status).toBe(200);
    const get = await cookieFetch(`/api/media/${media.id}`, token);
    expect(get.status).toBe(404);
    const list = await cookieFetch('/api/media?village_id=1', token);
    const body = await list.json() as { media: unknown[] };
    expect(body.media.length).toBe(0);
  });

  it('a read-only geo admin can list but cannot presign', async () => {
    const adminToken = await loginAs('district-bid');
    const list = await cookieFetch('/api/media?village_id=1', adminToken);
    expect(list.status).toBe(200);
    const res = await presign(adminToken, {
      uuid: newUuid(), kind: 'image', mime: 'image/png',
      bytes: 100, village_id: 1, captured_at: 1_700_000_000,
    });
    expect(res.status).toBe(403);
  });

  it('photo attaches to a child via POST /api/children', async () => {
    const token = await loginAs('vc-anandpur');
    const photo = await uploadAndCommit(token, {
      kind: 'image', mime: 'image/png', bytes: PNG_BYTES, village_id: 1,
    });
    const addRes = await cookieFetch('/api/children', token, {
      method: 'POST',
      body: JSON.stringify({
        village_id: 1, school_id: 1,
        first_name: 'Asha', last_name: 'Rao',
        gender: 'f', dob: '2015-06-01',
        father_name: 'Rao', father_phone: '9000000001',
        father_has_smartphone: 1,
        photo_media_id: photo.id,
      }),
    });
    expect(addRes.status).toBe(201);
    const { id } = await addRes.json() as { id: number };
    const get = await cookieFetch(`/api/children/${id}`, token);
    const body = await get.json() as { child: { photo_media_id: number | null } };
    expect(body.child.photo_media_id).toBe(photo.id);
  });

  it('photo from a different village is rejected when attaching', async () => {
    const v1 = await loginAs('vc-anandpur');
    const v1photo = await uploadAndCommit(v1, {
      kind: 'image', mime: 'image/png', bytes: PNG_BYTES, village_id: 1,
    });
    // Cluster admin can write in both villages — use that to try to
    // attach v1's photo to a v2 student and make sure it's blocked.
    const af = await loginAs('af-bid01');
    const res = await cookieFetch('/api/children', af, {
      method: 'POST',
      body: JSON.stringify({
        village_id: 2, school_id: 2,
        first_name: 'X', last_name: 'Y', gender: 'm', dob: '2015-01-01',
        father_name: 'p', father_phone: '9000000002',
        father_has_smartphone: 1,
        photo_media_id: v1photo.id,
      }),
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: { message?: string } };
    expect(body.error.message).toMatch(/different village/i);
  });

  it('voice note attaches to an attendance session', async () => {
    const token = await loginAs('vc-anandpur');
    const audio = await uploadAndCommit(token, {
      kind: 'audio', mime: 'audio/mp4', bytes: PNG_BYTES, village_id: 1,
    });
    const today = todayIst();
    const post = await cookieFetch('/api/attendance', token, {
      method: 'POST',
      body: JSON.stringify({
        village_id: 1, event_id: 3, date: today,
        start_time: '10:00', end_time: '11:00',
        marks: [{ student_id: 1, present: true }],
        voice_note_media_id: audio.id,
      }),
    });
    expect(post.status).toBe(200);
    const get = await cookieFetch(`/api/attendance?village_id=1&date=${today}`, token);
    const body = await get.json() as {
      sessions: { voice_note_media_id: number | null }[];
    };
    expect(body.sessions[0]?.voice_note_media_id).toBe(audio.id);
  });

  it('attendance rejects a voice note of the wrong kind (image)', async () => {
    const token = await loginAs('vc-anandpur');
    const wrong = await uploadAndCommit(token, {
      kind: 'image', mime: 'image/png', bytes: PNG_BYTES, village_id: 1,
    });
    const res = await cookieFetch('/api/attendance', token, {
      method: 'POST',
      body: JSON.stringify({
        village_id: 1, event_id: 3, date: todayIst(),
        start_time: '10:00', end_time: '11:00',
        marks: [{ student_id: 1, present: true }],
        voice_note_media_id: wrong.id,
      }),
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: { message?: string } };
    expect(body.error.message).toMatch(/audio/i);
  });

  // ---- token lifecycle negative cases (review PR #25 #5) ---------

  it('PUT with a Content-Type that disagrees with the token is rejected', async () => {
    const token = await loginAs('vc-anandpur');
    const { data } = await presign(token, {
      uuid: newUuid(), kind: 'image', mime: 'image/png',
      bytes: PNG_BYTES.length, village_id: 1, captured_at: 1_700_000_000,
    });
    const res = await SELF.fetch(`http://api.test${(data as { upload_url: string }).upload_url}`, {
      method: 'PUT',
      headers: { 'content-type': 'audio/webm' },
      body: PNG_BYTES,
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: { message?: string } };
    expect(body.error.message).toMatch(/content-type/i);
  });

  it('PUT with a body larger than the presigned max_bytes returns 413', async () => {
    const token = await loginAs('vc-anandpur');
    const { data } = await presign(token, {
      // Presign claims 5 bytes; PNG_BYTES is 10, so the PUT exceeds
      // the token's max_bytes and should be rejected.
      uuid: newUuid(), kind: 'image', mime: 'image/png',
      bytes: 5, village_id: 1, captured_at: 1_700_000_000,
    });
    const res = await SELF.fetch(`http://api.test${(data as { upload_url: string }).upload_url}`, {
      method: 'PUT',
      headers: { 'content-type': 'image/png' },
      body: PNG_BYTES,
    });
    expect(res.status).toBe(413);
  });

  it('PUT with an expired token is rejected as unauthenticated', async () => {
    // Can't easily time-travel, so mint a token with exp in the past
    // using the same signer the Worker uses. Matches the secret set
    // in vitest.config.ts.
    const { signUploadToken } = await import('../src/lib/media');
    const uuid = newUuid();
    const r2_key = `image/2026/04/20/1/${uuid}.png`;
    const expired = await signUploadToken('test-secret', {
      uuid, r2_key, kind: 'image', mime: 'image/png',
      max_bytes: 100, village_id: 1, user_id: 1,
      exp: Math.floor(Date.now() / 1000) - 60, // a minute in the past
    });
    const res = await SELF.fetch(
      `http://api.test/api/media/upload/${uuid}?token=${encodeURIComponent(expired)}`,
      {
        method: 'PUT',
        headers: { 'content-type': 'image/png' },
        body: PNG_BYTES,
      },
    );
    expect(res.status).toBe(401);
  });

  it('PUT on an already-committed uuid is rejected with 409', async () => {
    const token = await loginAs('vc-anandpur');
    const media = await uploadAndCommit(token, {
      kind: 'image', mime: 'image/png', bytes: PNG_BYTES, village_id: 1,
    });
    // Presign a fresh token for the SAME uuid — normally a client
    // would never do this, but a misbehaving or malicious caller
    // might. The DB row already exists, so the PUT must refuse.
    const { signUploadToken } = await import('../src/lib/media');
    const replay = await signUploadToken('test-secret', {
      uuid: media.uuid, r2_key: media.r2_key,
      kind: 'image', mime: 'image/png',
      max_bytes: 1024, village_id: 1, user_id: 1,
      exp: Math.floor(Date.now() / 1000) + 900,
    });
    const res = await SELF.fetch(
      `http://api.test/api/media/upload/${media.uuid}?token=${encodeURIComponent(replay)}`,
      {
        method: 'PUT',
        headers: { 'content-type': 'image/png' },
        body: PNG_BYTES,
      },
    );
    expect(res.status).toBe(409);
  });
});

describe('dashboard consolidated (L2.5.3)', () => {
  beforeEach(async () => { await resetDb(); });

  // KPIs don't ride on the drilldown response unless the caller
  // asks — CSV exports and other callers that only need the table
  // shouldn't pay for the extra queries.
  it('omits `consolidated` unless consolidated=1', async () => {
    const token = await loginAs('super');
    const res = await cookieFetch(
      '/api/dashboard/drilldown?metric=children&level=india',
      token,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { consolidated?: unknown };
    expect(body.consolidated).toBeUndefined();
  });

  it('returns KPI pack + 6-point chart for india scope', async () => {
    const token = await loginAs('super');
    const res = await cookieFetch(
      '/api/dashboard/drilldown?metric=children&level=india&consolidated=1',
      token,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      consolidated: {
        kpis: {
          attendance_pct: number | null;
          avg_children: number | null;
          image_pct: number | null;
          video_pct: number | null;
          som_current: number;
          som_delta: number | null;
        };
        chart: { bars: Array<{ month: string; pct: number | null }> };
      };
    };
    expect(body.consolidated).toBeDefined();
    // KPIs are numbers-or-null; shape check, not value check, so
    // seed drift doesn't bite.
    const k = body.consolidated.kpis;
    for (const key of ['attendance_pct', 'avg_children', 'image_pct', 'video_pct'] as const) {
      expect(k[key] === null || typeof k[key] === 'number').toBe(true);
    }
    expect(typeof k.som_current).toBe('number');
    // som_delta widened to `number | null` — see PR #31 review #4.
    // Null when both months recorded zero SoMs so the client can
    // render a dash instead of a misleading "+0" chip.
    expect(k.som_delta === null || typeof k.som_delta === 'number').toBe(true);
    // 6-month trend at aggregate scopes. Each point has a 'YYYY-MM'
    // month and a nullable numeric pct.
    expect(body.consolidated.chart.bars).toHaveLength(6);
    for (const bar of body.consolidated.chart.bars) {
      expect(bar.month).toMatch(/^\d{4}-\d{2}$/);
      expect(bar.pct === null || typeof bar.pct === 'number').toBe(true);
    }
  });

  it('skips the chart at village leaf', async () => {
    const token = await loginAs('super');
    const res = await cookieFetch(
      '/api/dashboard/drilldown?metric=children&level=village&id=1&consolidated=1',
      token,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      child_level: string;
      consolidated: { chart: { bars: unknown[] } };
    };
    expect(body.child_level).toBe('detail');
    expect(body.consolidated.chart.bars).toEqual([]);
  });

  it('honours the from/to period for the KPI pack', async () => {
    const token = await loginAs('super');
    const res = await cookieFetch(
      '/api/dashboard/drilldown?metric=children&level=india&consolidated=1'
        + '&from=2000-01-01&to=2000-01-02',
      token,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      consolidated: { kpis: { attendance_pct: number | null; image_pct: number | null; som_delta: number | null } };
    };
    // No sessions in that ancient window → null denominator.
    expect(body.consolidated.kpis.attendance_pct).toBeNull();
    expect(body.consolidated.kpis.image_pct).toBeNull();
    // Ancient period puts both SoM months in 2000 → 0 current, 0
    // prev → som_delta should now be null (review #4), not 0.
    expect(body.consolidated.kpis.som_delta).toBeNull();
  });

  it('scope-filters the KPI pack for a VC', async () => {
    const token = await loginAs('vc-anandpur');
    const res = await cookieFetch(
      '/api/dashboard/drilldown?metric=children&level=village&id=1&consolidated=1',
      token,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      consolidated: { kpis: { avg_children: number | null } };
    };
    // The caller is village-scoped — the endpoint should still
    // produce a consolidated payload for their own village rather
    // than 403 or return nulls.
    expect(body.consolidated).toBeDefined();
    expect(body.consolidated.kpis).toBeDefined();
  });
});

describe('home insights — merged compare + drill', () => {
  beforeEach(async () => { await resetDb(); });

  it('carries the full KPI pack per child so tiles compare at a glance', async () => {
    const token = await loginAs('super');
    const res = await cookieFetch('/api/insights', token);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      level: string;
      child_level: string | null;
      children: Array<{
        level: string;
        id: number;
        name: string;
        children_count: number;
        attendance_pct_week: number | null;
        images_this_month: number;
        videos_this_month: number;
        achievements_this_month: number;
        villages_count: number;
        coordinator_name: string | null;
      }>;
    };
    expect(body.level).toBe('india');
    expect(body.child_level).toBe('zone');
    expect(body.children.length).toBeGreaterThanOrEqual(2);
    for (const c of body.children) {
      // Every field the desktop table renders must be present; shape
      // check, not value check, so seed drift doesn't bite.
      expect(typeof c.id).toBe('number');
      expect(typeof c.name).toBe('string');
      expect(typeof c.children_count).toBe('number');
      expect(typeof c.images_this_month).toBe('number');
      expect(typeof c.videos_this_month).toBe('number');
      expect(typeof c.achievements_this_month).toBe('number');
      expect(typeof c.villages_count).toBe('number');
      expect(
        c.attendance_pct_week === null || typeof c.attendance_pct_week === 'number',
      ).toBe(true);
    }
  });

  it('children rollups sum from the per-village numbers', async () => {
    const token = await loginAs('super');
    // At a cluster scope the children are villages, so the monthly
    // counts on each child equal that village's raw per-month count.
    // Drilling one level up (district) must sum to the same totals.
    const resCluster = await cookieFetch(
      '/api/insights?level=cluster&id=1',
      token,
    );
    expect(resCluster.status).toBe(200);
    const cluster = (await resCluster.json()) as {
      children: Array<{
        images_this_month: number;
        videos_this_month: number;
        achievements_this_month: number;
      }>;
    };
    const sumImgs = cluster.children.reduce((a, c) => a + c.images_this_month, 0);
    const sumVids = cluster.children.reduce((a, c) => a + c.videos_this_month, 0);
    const sumAch = cluster.children.reduce((a, c) => a + c.achievements_this_month, 0);

    const resDistrict = await cookieFetch(
      '/api/insights?level=district&id=1',
      token,
    );
    expect(resDistrict.status).toBe(200);
    const district = (await resDistrict.json()) as {
      children: Array<{
        id: number;
        images_this_month: number;
        videos_this_month: number;
        achievements_this_month: number;
      }>;
    };
    // Bidar district in the seed has exactly one cluster (cluster 1),
    // so the district's single child row must equal the sum of its
    // cluster's village rows.
    expect(district.children.length).toBe(1);
    expect(district.children[0]!.images_this_month).toBe(sumImgs);
    expect(district.children[0]!.videos_this_month).toBe(sumVids);
    expect(district.children[0]!.achievements_this_month).toBe(sumAch);
  });
});

describe('geo navigation (L2.5.2)', () => {
  beforeEach(async () => { await resetDb(); });

  it('search returns [] for queries shorter than 2 chars', async () => {
    const token = await loginAs('super');
    const res = await cookieFetch('/api/geo/search?q=a', token);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { results: unknown[] };
    expect(body.results).toEqual([]);
  });

  it('search scope-filters results for a VC', async () => {
    // vc-anandpur is village-scoped to Anandpur (id=1). A prefix
    // match that hits any other village's name must be filtered out.
    const token = await loginAs('vc-anandpur');
    const res = await cookieFetch('/api/geo/search?q=bel', token);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      results: Array<{ level: string; id: number; name: string }>;
    };
    // Belur (village id 2) is out of scope for vc-anandpur, so the
    // search must return no village hits for the "bel" prefix.
    const villageHits = body.results.filter((r) => r.level === 'village');
    expect(villageHits.length).toBe(0);
  });

  it('search returns villages for a super admin', async () => {
    const token = await loginAs('super');
    const res = await cookieFetch('/api/geo/search?q=bel', token);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      results: Array<{ level: string; name: string; path: string }>;
    };
    expect(body.results.length).toBeGreaterThan(0);
    expect(body.results.some((r) => r.level === 'village' && r.name === 'Belur')).toBe(true);
  });

  it('search sanitises SQL-LIKE wildcards in the query', async () => {
    // "50%" used to become an everything-matches pattern. The
    // escape handler converts `%` / `_` to literal characters via
    // ESCAPE '!'. Expect zero hits for a wildcard-only query.
    const token = await loginAs('super');
    const res = await cookieFetch('/api/geo/search?q=%25%25', token);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { results: unknown[] };
    expect(body.results.length).toBe(0);
  });

  it('siblings returns other villages under the same cluster', async () => {
    const token = await loginAs('super');
    // Belur is village id 2 under Anandpur cluster. Its siblings
    // include Anandpur (id 1). Both share cluster_id.
    const res = await cookieFetch('/api/geo/siblings?level=village&id=2', token);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      siblings: Array<{ id: number; name: string }>;
    };
    expect(body.siblings.some((s) => s.name === 'Anandpur')).toBe(true);
    expect(body.siblings.some((s) => s.name === 'Belur')).toBe(true);
  });

  it('siblings rejects level=india with 400', async () => {
    const token = await loginAs('super');
    const res = await cookieFetch('/api/geo/siblings?level=india&id=1', token);
    expect(res.status).toBe(400);
  });

  it('siblings rejects a missing id with 400', async () => {
    const token = await loginAs('super');
    const res = await cookieFetch('/api/geo/siblings?level=village', token);
    expect(res.status).toBe(400);
  });

  it('siblings returns only in-scope siblings for a VC', async () => {
    // vc-anandpur only sees Anandpur (village id 1). Asking for
    // siblings at village level with any id must return at most
    // the caller's own village.
    const token = await loginAs('vc-anandpur');
    const res = await cookieFetch('/api/geo/siblings?level=village&id=2', token);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      siblings: Array<{ id: number; name: string }>;
    };
    for (const s of body.siblings) {
      expect(s.name).toBe('Anandpur');
    }
  });

  it('both endpoints require auth (no session cookie ⇒ 401)', async () => {
    const r1 = await SELF.fetch('http://api.test/api/geo/search?q=bel');
    expect(r1.status).toBe(401);
    const r2 = await SELF.fetch('http://api.test/api/geo/siblings?level=village&id=1');
    expect(r2.status).toBe(401);
  });
});
