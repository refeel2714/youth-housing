import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { publicRoutes, type PublicDeps } from './routes/public.js';

export function createApp(deps: PublicDeps = {}) {
  const app = new Hono();

  // 웹은 같은 출처. 토스 미니앱 WebView 는 다른 출처라 TOSS_APP_ORIGIN 만 허용한다.
  const origins = [process.env.APP_ORIGIN, process.env.TOSS_APP_ORIGIN].filter((o): o is string => !!o);
  if (origins.length > 0) app.use('/api/*', cors({ origin: origins, credentials: true }));

  app.get('/health', c => c.json({ ok: true }));
  app.route('/api', publicRoutes(deps));
  app.onError((err, c) => {
    console.error(err);
    return c.json({ error: '서버 오류가 났습니다' }, 500);
  });
  // TODO: auth(카카오·토스), me, ics, admin(검수 화면), notify, 웹 정적 파일 서빙(static.ts)
  return app;
}

export const app = createApp();
