import { Hono } from 'hono';
import { cors } from 'hono/cors';
import auth from './routes/auth';
import villages from './routes/villages';
import schools from './routes/schools';
import children from './routes/children';
import events from './routes/events';
import attendance from './routes/attendance';
import achievements from './routes/achievements';
import dashboard from './routes/dashboard';
import { err } from './lib/errors';
import type { Bindings, Variables } from './types';

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// CORS: explicit allowlist driven by the ALLOWED_ORIGINS Worker
// var (comma-separated). Same-origin requests carry no `Origin`
// header from the browser and are unaffected. Anything from an
// origin not on the list gets no ACAO header back, so the
// browser refuses the credentialed request.
app.use('*', async (c, next) => {
  const allowed = (c.env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return cors({
    origin: (origin) => (allowed.includes(origin) ? origin : null),
    credentials: true,
    allowHeaders: ['Content-Type'],
    allowMethods: ['GET', 'POST', 'PATCH', 'OPTIONS'],
  })(c, next);
});

app.get('/', (c) => c.json({ ok: true, service: 'navsahyog-api', level: 1 }));

app.route('/auth', auth);
app.route('/api/villages', villages);
app.route('/api/schools', schools);
app.route('/api/children', children);
app.route('/api/events', events);
app.route('/api/attendance', attendance);
app.route('/api/achievements', achievements);
app.route('/api/dashboard', dashboard);

app.onError((e, c) => {
  console.error(e);
  return err(c, 'internal_error', 500, e.message);
});

app.notFound((c) => err(c, 'not_found', 404));

export default app;
