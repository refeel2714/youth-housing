// /admin — 공고 검수 화면(서버 렌더링). 토스 빌드에는 들어가지 않는다.
// CSRF: 쿠키는 SameSite=Strict, POST 는 Origin(없으면 Referer)이 같은 호스트일 때만 받는다.
import { db, type Sql } from '@yh/db';
import { Hono, type Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { isUuid } from '../lib/params.js';
import {
  ADMIN_COOKIE, LoginLimiter, SESSION_TTL_MS, adminConfigFromEnv, checkPassword, cleanName, signSession, verifySession,
  type AdminConfig,
} from './auth.js';
import { formFromBody, parseNoticeForm } from './form.js';
import { QUEUE_TABS, listQueue, loadNotice, loadRegions, queueCounts, saveNotice, setReviewState, type QueueTab } from './queries.js';
import { loginPage, noticePage, notFoundPage, queuePage } from './views.js';

export interface AdminDeps {
  sql?: () => Sql;
  /** 없으면 환경변수(ADMIN_PASSWORD, SESSION_SECRET). null 이면 꺼짐 */
  config?: AdminConfig | null;
}

type Env = { Variables: { reviewer: string } };

const FLASH: Record<string, string> = {
  saved: '임시 저장했습니다.', approved: '승인했습니다. 공개 화면에 나옵니다.', rejected: '반려했습니다.',
  unpublished: '공개를 내리고 검수 대기로 돌렸습니다.',
};

function sameOrigin(c: Context): boolean {
  const host = new URL(c.req.url).host;
  const from = c.req.header('origin') ?? c.req.header('referer');
  if (!from) return false;
  try {
    return new URL(from).host === host;
  } catch {
    return false;
  }
}

const clientIp = (c: Context) =>
  c.req.header('fly-client-ip') ?? c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local';

export function adminRoutes(deps: AdminDeps = {}) {
  const sql = deps.sql ?? db;
  const cfg = deps.config === undefined ? adminConfigFromEnv() : deps.config;
  const limiter = new LoginLimiter();
  const r = new Hono<Env>();

  r.use('*', async (c, next) => {
    c.header('Cache-Control', 'no-store');
    c.header('X-Frame-Options', 'DENY');
    c.header('Referrer-Policy', 'same-origin');
    c.header('X-Robots-Tag', 'noindex');
    if (!cfg) return c.html(loginPage({ disabled: true }), 503);
    if (c.req.method === 'POST' && !sameOrigin(c)) return c.text('잘못된 요청입니다', 403);
    await next();
  });

  r.get('/login', c => c.html(loginPage({})));

  r.post('/login', async c => {
    const ip = clientIp(c);
    const body = await c.req.parseBody();
    const name = cleanName(typeof body.name === 'string' ? body.name : '');
    const password = typeof body.password === 'string' ? body.password : '';
    if (limiter.blocked(ip)) return c.html(loginPage({ error: '시도가 너무 많습니다. 15분 뒤에 다시 해 주세요.' }), 429);
    if (!name) return c.html(loginPage({ error: '이름을 1~20자로 넣어 주세요.' }), 400);
    if (!checkPassword(cfg!, password)) {
      limiter.fail(ip);
      return c.html(loginPage({ error: '비밀번호가 맞지 않습니다.', name }), 401);
    }
    limiter.reset(ip);
    setCookie(c, ADMIN_COOKIE, signSession(cfg!, name), {
      httpOnly: true, sameSite: 'Strict', path: '/admin', maxAge: SESSION_TTL_MS / 1000,
      secure: new URL(c.req.url).protocol === 'https:' || c.req.header('x-forwarded-proto') === 'https',
    });
    return c.redirect('/admin', 303);
  });

  r.post('/logout', c => {
    deleteCookie(c, ADMIN_COOKIE, { path: '/admin' });
    return c.redirect('/admin/login', 303);
  });

  // 여기부터 로그인 필요
  r.use('*', async (c, next) => {
    const reviewer = verifySession(cfg!, getCookie(c, ADMIN_COOKIE));
    if (!reviewer) return c.redirect('/admin/login', 303);
    c.set('reviewer', reviewer);
    await next();
  });

  r.get('/', async c => {
    const tabRaw = c.req.query('tab') ?? 'queue';
    const tab: QueueTab = (QUEUE_TABS as string[]).includes(tabRaw) ? (tabRaw as QueueTab) : 'queue';
    const q = c.req.query('q')?.trim().slice(0, 50) ?? '';
    const offset = Math.min(Math.max(Number(c.req.query('offset')) || 0, 0), 10_000);
    const limit = 30;
    const [counts, list] = await Promise.all([queueCounts(sql()), listQueue(sql(), tab, q || null, limit, offset)]);
    return c.html(queuePage({
      reviewer: c.get('reviewer'), tab, counts, items: list.items, hasMore: list.hasMore, q, offset, limit,
      flash: FLASH[c.req.query('done') ?? ''],
    }));
  });

  r.get('/notices/:id', async c => {
    const id = c.req.param('id');
    const regions = await loadRegions(sql());
    const loaded = isUuid(id) ? await loadNotice(sql(), id, regions) : null;
    if (!loaded) return c.html(notFoundPage(c.get('reviewer')), 404);
    return c.html(noticePage({
      reviewer: c.get('reviewer'), loaded, form: loaded.form, regions, errors: {},
      seenHash: loaded.meta.contentHash, flash: FLASH[c.req.query('done') ?? ''],
    }));
  });

  r.post('/notices/:id', async c => {
    const id = c.req.param('id');
    const reviewer = c.get('reviewer');
    if (!isUuid(id)) return c.html(notFoundPage(reviewer), 404);
    const body = await c.req.parseBody({ all: true });
    const action = typeof body.action === 'string' ? body.action : 'save';
    const form = formFromBody(body);
    const back = (done: string) => c.redirect(`/admin/notices/${id}?done=${done}`, 303);

    if (action === 'reject' || action === 'unpublish') {
      const ok = await setReviewState(sql(), id, action === 'reject' ? 'rejected' : 'pending', form.reviewNote.slice(0, 500) || null, reviewer);
      if (!ok) return c.html(notFoundPage(reviewer), 404);
      return action === 'reject' ? c.redirect('/admin?done=rejected', 303) : back('unpublished');
    }
    if (action !== 'save' && action !== 'approve') return c.text('잘못된 요청입니다', 400);

    const regions = await loadRegions(sql());
    const loaded = await loadNotice(sql(), id, regions);
    if (!loaded) return c.html(notFoundPage(reviewer), 404);
    // 공개 중인 공고는 "수정 저장(approve)"로만 바꾼다(임시 저장으로 미확인 규칙이 공개되지 않게)
    const mode = loaded.meta.parseStatus === 'verified' ? 'approve' : action;

    const seenHash = typeof body.seen_hash === 'string' && body.seen_hash ? body.seen_hash : null;
    const parsed = parseNoticeForm(form, { regionCodes: new Set(regions.map(x => x.code)) }, { approve: mode === 'approve' });
    if (!parsed.ok) {
      return c.html(noticePage({ reviewer, loaded, form, regions, errors: parsed.errors, seenHash }), 422);
    }
    const res = await saveNotice(sql(), id, parsed.value, regions, { action: mode, reviewer, seenHash });
    if (res === 'not_found') return c.html(notFoundPage(reviewer), 404);
    return mode === 'approve' && loaded.meta.parseStatus !== 'verified'
      ? c.redirect('/admin?done=approved', 303)
      : back(mode === 'approve' ? 'approved' : 'saved');
  });

  return r;
}
