// 로그인 없는 캘린더 구독.
//   POST   /api/feeds          { noticeIds, regionCodes, alarmDays } → 201 { token, key, url }
//   PUT    /api/feeds/:token   Authorization: Bearer <key>, 같은 본문 → 204
//   DELETE /api/feeds/:token   Authorization: Bearer <key> → 204
//   GET    /ics/:token.ics     캘린더 앱이 몇 시간마다 받아 가는 iCalendar
import { db, type Sql } from '@yh/db';
import { feedSelection, SCHEDULE_KIND_LABELS, type FeedCreated, type FeedSelection } from '@yh/schema';
import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { LoginLimiter } from '../admin/auth.js';
import { clientIp, publicBaseUrl } from '../lib/request.js';
import type { Visibility } from '../queries.js';
import { buildIcs, type IcsEvent } from './ics.js';
import { ALARM_KINDS, createFeed, deleteFeed, feedSchedules, loadFeed, updateFeed, type FeedScheduleRow } from './store.js';

export interface FeedDeps {
  sql?: () => Sql;
  visibility: Visibility;
  /** 공고 상세 링크의 앞부분. 기본은 APP_ORIGIN, 없으면 이 서버 주소 */
  appUrl?: string;
}

const TOKEN_RE = /^[A-Za-z0-9_-]{20,64}$/;
const KEY_RE = /^[A-Za-z0-9_-]{20,128}$/;

const bearer = (c: Context) => {
  const m = /^Bearer\s+(\S+)$/.exec(c.req.header('authorization') ?? '');
  return m && KEY_RE.test(m[1]!) ? m[1]! : null;
};

async function readSelection(c: Context): Promise<FeedSelection | null> {
  try {
    const r = feedSelection.safeParse(await c.req.json());
    if (!r.success) return null;
    return { ...r.data, noticeIds: [...new Set(r.data.noticeIds.map(s => s.toLowerCase()))], regionCodes: [...new Set(r.data.regionCodes)] };
  } catch {
    return null;
  }
}

export const feedUrl = (base: string, token: string) => `${base}/ics/${token}.ics`;

export function feedApiRoutes(deps: FeedDeps) {
  const sql = deps.sql ?? db;
  // 구독 만들기는 같은 IP 에서 한 시간에 20번(아무나 행을 쌓지 못하게)
  const limiter = new LoginLimiter(20, 60 * 60 * 1000);
  const r = new Hono();
  r.use('*', bodyLimit({ maxSize: 32 * 1024, onError: c => c.json({ error: '요청이 너무 큽니다' }, 413) }));
  const bad = (c: Context) => c.json({ error: '관심 목록 형식이 올바르지 않습니다' }, 400);
  const notFound = (c: Context) => c.json({ error: '구독을 찾을 수 없습니다' }, 404);

  r.post('/', async c => {
    const ip = clientIp(c);
    if (limiter.blocked(ip)) return c.json({ error: '잠시 뒤에 다시 해 주세요' }, 429);
    const sel = await readSelection(c);
    if (!sel) return bad(c);
    limiter.fail(ip);
    const { token, key } = await createFeed(sql(), sel);
    return c.json({ token, key, url: feedUrl(publicBaseUrl(c), token) } satisfies FeedCreated, 201);
  });

  r.put('/:token', async c => {
    const token = c.req.param('token');
    const key = bearer(c);
    if (!TOKEN_RE.test(token) || !key) return notFound(c);
    const sel = await readSelection(c);
    if (!sel) return bad(c);
    return (await updateFeed(sql(), token, key, sel)) ? c.body(null, 204) : notFound(c);
  });

  r.delete('/:token', async c => {
    const token = c.req.param('token');
    const key = bearer(c);
    if (!TOKEN_RE.test(token) || !key) return notFound(c);
    return (await deleteFeed(sql(), token, key)) ? c.body(null, 204) : notFound(c);
  });

  return r;
}

export function icsRoutes(deps: FeedDeps) {
  const sql = deps.sql ?? db;
  const r = new Hono();
  r.get('/:file', async c => {
    const token = c.req.param('file').replace(/\.ics$/, '');
    if (!TOKEN_RE.test(token)) return c.text('구독을 찾을 수 없습니다', 404);
    const feed = await loadFeed(sql(), token);
    if (!feed) return c.text('구독을 찾을 수 없습니다', 404);
    const rows = await feedSchedules(sql(), feed, deps.visibility);
    const appUrl = (deps.appUrl ?? process.env.APP_ORIGIN ?? publicBaseUrl(c)).replace(/\/$/, '');
    const body = buildIcs({
      name: '청년주택 일정',
      description: '관심 공고와 관심 지역의 청년주택 일정',
      refreshMinutes: 360,
      events: rows.map(row => toEvent(row, appUrl, feed.alarmDays)),
    });
    c.header('Content-Type', 'text/calendar; charset=utf-8');
    c.header('Content-Disposition', 'inline; filename="youth-housing.ics"');
    c.header('Cache-Control', 'private, max-age=900');
    c.header('X-Robots-Tag', 'noindex');
    return c.body(body);
  });
  return r;
}

export function toEvent(row: FeedScheduleRow, appUrl: string, alarmDays: number[]): IcsEvent {
  const label = `${SCHEDULE_KIND_LABELS[row.kind]}${row.seq > 1 ? ` ${row.seq}차` : ''}`;
  const detail = `${appUrl}/notices/${row.notice_id}`;
  const desc = [
    row.title,
    row.note,
    row.url_apply && row.kind !== 'announce' ? `신청: ${row.url_apply}` : null,
    `공고 원문: ${row.url_original}`,
    `일정·자격 보기: ${detail}`,
    row.verified ? null : '자동 수집된 일정이에요. 신청 전에 공고 원문을 확인해 주세요.',
  ].filter(Boolean).join('\n');
  return {
    uid: `${row.schedule_id}@youth-housing`,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    allDay: row.all_day,
    summary: `[${label}] ${row.title}`,
    description: desc,
    url: detail,
    alarmDays: ALARM_KINDS.includes(row.kind) ? alarmDays : [],
    lastModified: row.updated_at,
  };
}
