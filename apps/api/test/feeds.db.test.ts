// 캘린더 구독 통합 테스트. TEST_DATABASE_URL 이 있을 때만 돈다(마이그레이션·시드를 넣은 DB).
import type { FeedCreated, NoticeListResponse } from '@yh/schema';
import postgres from 'postgres';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('calendar feeds (DB)', () => {
  const sql = postgres(url ?? '', { max: 2, onnotice: () => {} });
  const app = createApp({ sql: () => sql, showUnverified: false });
  const ids: Record<string, string> = {};
  const created: string[] = [];

  const send = (method: string, path: string, body?: unknown, key?: string) =>
    app.request(path, {
      method,
      headers: { 'content-type': 'application/json', ...(key ? { authorization: `Bearer ${key}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const create = async (body: unknown) => {
    const res = await send('POST', '/api/feeds', body);
    expect(res.status).toBe(201);
    const feed = (await res.json()) as FeedCreated;
    created.push(feed.token);
    return feed;
  };
  const ics = async (token: string) => {
    const res = await app.request(`/ics/${token}.ics`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/calendar');
    return res.text();
  };

  beforeAll(async () => {
    const conn = await sql.reserve();
    await conn.file(fileURLToPath(new URL('../../../supabase/dev-fixtures.sql', import.meta.url)));
    conn.release();
    for (const r of await sql<{ id: string; external_id: string }[]>`select id, external_id from notices where external_id like 'DEV-%'`) {
      ids[r.external_id] = r.id;
    }
  });
  afterAll(async () => {
    await sql`delete from calendar_feeds where token = any(${created}::text[])`;
    await sql.end();
  });

  it('관심 공고는 모든 일정, 관심 지역은 접수 시작·마감만', async () => {
    const feed = await create({ noticeIds: [ids['DEV-001']], regionCodes: ['41000'], alarmDays: [1] });
    expect(feed.url).toMatch(new RegExp(`/ics/${feed.token}\\.ics$`));
    expect(feed.key.length).toBeGreaterThanOrEqual(40);
    const body = await ics(feed.token);
    expect(body).toContain('X-WR-CALNAME:청년주택 일정');
    // DEV-001(동대문): 공고·접수·서류 발표·당첨·계약 전부
    expect(body).toMatch(/SUMMARY:\[계약\] \[예시\] 동대문구/);
    expect(body).toMatch(/SUMMARY:\[당첨 발표\] \[예시\] 동대문구/);
    // 경기(수원·고양): 접수 시작·마감만
    expect(body).toMatch(/SUMMARY:\[접수 마감\] \[예시\] 수원영통/);
    expect(body).not.toMatch(/SUMMARY:\[서류 제출\] \[예시\] 수원영통/);
    // 서울 다른 구(마포)는 안 들어감
    expect(body).not.toContain('마포구');
    // 접수 시작(시각 있음)에는 알림, 당첨 발표에는 없음
    expect(body).toContain('BEGIN:VALARM');
    expect(body).toContain(`/notices/${ids['DEV-001']}`);
    const [row] = await sql<{ last_fetched_at: Date | null }[]>`select last_fetched_at from calendar_feeds where token = ${feed.token}`;
    expect(row!.last_fetched_at).not.toBeNull();
  });

  it('키로만 수정·삭제, 수정하면 다음 받기부터 반영', async () => {
    const feed = await create({ noticeIds: [ids['DEV-001']] });
    expect((await send('PUT', `/api/feeds/${feed.token}`, { noticeIds: [ids['DEV-002']] }, 'wrong-key-wrong-key-wrong')).status).toBe(404);
    expect((await send('PUT', `/api/feeds/${feed.token}`, { noticeIds: [ids['DEV-002']] })).status).toBe(404);
    expect((await send('PUT', `/api/feeds/${feed.token}`, { noticeIds: [ids['DEV-002']], alarmDays: [] }, feed.key)).status).toBe(204);
    const body = await ics(feed.token);
    expect(body).toContain('마포구');
    expect(body).not.toContain('동대문구');
    expect(body).not.toContain('BEGIN:VALARM');
    expect((await send('DELETE', `/api/feeds/${feed.token}`, undefined, 'nope-nope-nope-nope-nope')).status).toBe(404);
    expect((await send('DELETE', `/api/feeds/${feed.token}`, undefined, feed.key)).status).toBe(204);
    expect((await app.request(`/ics/${feed.token}.ics`)).status).toBe(404);
  });

  it('취소 공고는 구독에서 빠진다', async () => {
    const feed = await create({ noticeIds: [ids['DEV-004']] });
    expect(await ics(feed.token)).toContain('연수구');
    await sql`update notices set status = 'cancelled' where external_id = 'DEV-004'`;
    expect(await ics(feed.token)).not.toContain('연수구');
    await sql`update notices set status = 'upcoming' where external_id = 'DEV-004'`;
  });

  it('잘못된 요청', async () => {
    expect((await send('POST', '/api/feeds', { noticeIds: ['x'] })).status).toBe(400);
    expect((await send('POST', '/api/feeds', { regionCodes: ['seoul'] })).status).toBe(400);
    expect((await send('POST', '/api/feeds', { alarmDays: [30] })).status).toBe(400);
    expect((await send('POST', '/api/feeds', { extra: 1 })).status).toBe(400);
    expect((await app.request('/api/feeds', { method: 'POST', body: 'not json' })).status).toBe(400);
    expect((await app.request('/ics/short.ics')).status).toBe(404);
    expect((await app.request('/ics/AAAAAAAAAAAAAAAAAAAAAAAA.ics')).status).toBe(404);
  });

  it('목록 ids 필터(관심 공고 화면)', async () => {
    const res = await app.request(`/api/notices?status=open,upcoming,closed&ids=${ids['DEV-001']},${ids['DEV-005']}`);
    const body = (await res.json()) as NoticeListResponse;
    expect(body.items.map(i => i.id).sort()).toEqual([ids['DEV-001'], ids['DEV-005']].sort());
    expect((await app.request('/api/notices?ids=abc')).status).toBe(400);
  });
});
