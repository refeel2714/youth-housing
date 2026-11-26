// 비로그인 공개 조회: 캘린더 월 보기, 공고 목록·상세, 30초 진단 묶음, 지역 목록
import { db, type Sql } from '@yh/db';
import type { CalendarResponse, NoticeListResponse } from '@yh/schema';
import { Hono } from 'hono';
import {
  currentMonthKst, isUuid, monthRange, parseCursor, parseLimit, parseRegions, parseStatuses, parseTypes,
} from '../lib/params.js';
import { calendar, eligibilityBundle, getNotice, listNotices, listRegions, type AutoPublish, type Visibility } from '../queries.js';

export interface PublicDeps {
  sql?: () => Sql;
  /** 미검수 공고도 전부 보여 줄지(개발용). 기본은 PUBLIC_SHOW_UNVERIFIED=1 */
  showUnverified?: boolean;
  /** 미검수라도 접수 일정이 있으면 공개(queries.ts). 기본은 AUTO_PUBLISH, 없으면 'all' */
  autoPublish?: AutoPublish;
}

export function autoPublishFromEnv(raw = process.env.AUTO_PUBLISH): AutoPublish {
  return raw === 'api' || raw === 'off' ? raw : 'all';
}

export function publicRoutes(deps: PublicDeps = {}) {
  const sql = deps.sql ?? db;
  const showUnverified = deps.showUnverified ?? process.env.PUBLIC_SHOW_UNVERIFIED === '1';
  const v: Visibility = { showUnverified, autoPublish: deps.autoPublish ?? autoPublishFromEnv() };
  const r = new Hono();
  const bad = (msg: string) => Response.json({ error: msg }, { status: 400 });

  // GET /calendar?month=2026-12&regions=11000,41000&types=happy_house
  r.get('/calendar', async c => {
    const month = c.req.query('month') ?? currentMonthKst();
    const range = monthRange(month);
    if (!range) return bad('month는 YYYY-MM 형식이어야 합니다');
    const regions = parseRegions(c.req.query('regions'));
    const types = parseTypes(c.req.query('types'));
    if (regions === undefined) return bad('regions가 올바르지 않습니다');
    if (types === undefined) return bad('types가 올바르지 않습니다');
    const items = await calendar(sql(), range.from, range.to, { regions, types, ...v });
    c.header('Cache-Control', 'public, max-age=60');
    return c.json({ month, items } satisfies CalendarResponse);
  });

  // GET /notices?status=open,upcoming&regions=&types=&q=&limit=20&cursor=
  r.get('/notices', async c => {
    const regions = parseRegions(c.req.query('regions'));
    const types = parseTypes(c.req.query('types'));
    const statuses = parseStatuses(c.req.query('status'));
    const limit = parseLimit(c.req.query('limit'));
    const offset = parseCursor(c.req.query('cursor'));
    if (regions === undefined) return bad('regions가 올바르지 않습니다');
    if (types === undefined) return bad('types가 올바르지 않습니다');
    if (statuses === undefined) return bad('status가 올바르지 않습니다');
    if (limit === null) return bad('limit은 1~50 사이여야 합니다');
    if (offset === null) return bad('cursor가 올바르지 않습니다');
    const q = c.req.query('q')?.trim().slice(0, 50) || null;
    const { items, hasMore } = await listNotices(sql(), { regions, types, statuses, q, limit, offset, ...v });
    c.header('Cache-Control', 'public, max-age=60');
    return c.json({ items, nextCursor: hasMore ? String(offset + limit) : null } satisfies NoticeListResponse);
  });

  r.get('/notices/:id', async c => {
    const id = c.req.param('id');
    if (!isUuid(id)) return c.json({ error: '공고를 찾을 수 없습니다' }, 404);
    const notice = await getNotice(sql(), id, v);
    if (!notice) return c.json({ error: '공고를 찾을 수 없습니다' }, 404);
    c.header('Cache-Control', 'public, max-age=60');
    return c.json(notice);
  });

  // GET /eligibility — 30초 진단용 공고·규칙·기준표 묶음. 사용자 조건은 받지 않는다(판정은 기기에서)
  r.get('/eligibility', async c => {
    c.header('Cache-Control', 'public, max-age=300');
    return c.json(await eligibilityBundle(sql(), v));
  });

  r.get('/regions', async c => {
    c.header('Cache-Control', 'public, max-age=86400');
    return c.json({ items: await listRegions(sql()) });
  });

  return r;
}
