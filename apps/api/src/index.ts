import { Hono } from 'hono';
import { cors } from 'hono/cors';
import auth from './routes/auth';
import villages from './routes/villages';
import schools from './routes/schools';
import children from './routes/children';
import attendance from './routes/attendance';
import dashboard from './routes/dashboard';
import type { Bindings, Variables } from './types';

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

app.use(
  '*',
  cors({
    origin: (origin) => origin ?? '*',
    credentials: true,
    allowHeaders: ['Content-Type'],
    allowMethods: ['GET', 'POST', 'OPTIONS'],
  }),
);

app.get('/', (c) => c.json({ ok: true, service: 'navsahyog-api', level: 1 }));

app.route('/auth', auth);
app.route('/api/villages', villages);
app.route('/api/schools', schools);
app.route('/api/children', children);
app.route('/api/attendance', attendance);
app.route('/api/dashboard', dashboard);

app.onError((err, c) => {
  console.error(err);
  return c.json({ error: 'internal_error', message: err.message }, 500);
});

app.notFound((c) => c.json({ error: 'not_found' }, 404));

export default app;
