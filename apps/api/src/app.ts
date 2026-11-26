import { Hono } from 'hono';
import { publicRoutes } from './routes/public.js';

export const app = new Hono();

app.get('/health', c => c.json({ ok: true }));
app.route('/api', publicRoutes);
// TODO: auth(카카오·토스), me, ics, admin(검수 화면), notify, 웹 정적 파일 서빙(static.ts)
