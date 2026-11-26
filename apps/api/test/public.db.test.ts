// 공개 API 통합 테스트. TEST_DATABASE_URL 이 있을 때만 돈다(마이그레이션·시드를 넣은 DB).
// supabase/dev-fixtures.sql 을 넣고(DEV-% 공고를 갈아 끼움) 라우트를 호출한다.
// 예: TEST_DATABASE_URL=postgres://postgres@localhost:5432/yh pnpm --filter @yh/api test
import { judgeNotice } from '@yh/eligibility';
import type { CalendarResponse, EligibilityBundleResponse, NoticeDetail, NoticeListResponse } from '@yh/schema';
import postgres from 'postgres';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { currentMonthKst } from '../src/lib/params.js';

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('public routes (DB)', () => {
  const sql = postgres(url ?? '', { max: 2, onnotice: () => {} });
  const app = createApp({ sql: () => sql, showUnverified: false });
  const get = async <T>(path: string) => {
    const res = await app.request(path);
    expect(res.status, path).toBe(200);
    return (await res.json()) as T;
  };
  const dev = <T extends { title: string }>(xs: T[]) => xs.filter(x => x.title.startsWith('[예시]'));

  beforeAll(async () => {
    const conn = await sql.reserve(); // 파일 안에 begin/commit 이 있어 한 연결에서 돌린다
    await conn.file(fileURLToPath(new URL('../../../supabase/dev-fixtures.sql', import.meta.url)));
    conn.release();
    // 미검수 공고 하나: 기본 설정에서는 보이면 안 된다
    await sql`
      insert into notices (source_id, external_id, title, housing_type, url_original, region_codes, parse_status)
      select id, 'DEV-PENDING', '[예시] 미검수 공고', 'happy_house', 'https://example.invalid', '{11000}', 'pending'
      from sources where code = 'LH_API'`;
  });
  afterAll(async () => {
    await sql`delete from notices where external_id = 'DEV-PENDING'`;
    await sql.end();
  });

  it('캘린더: 이번 달 일정, 한국시간 날짜, 미검수 제외', async () => {
    const month = currentMonthKst();
    const body = await get<CalendarResponse>(`/api/calendar?month=${month}`);
    const items = dev(body.items);
    expect(items.length).toBeGreaterThan(0);
    for (const it of items) {
      expect(it.startDate.slice(0, 7) <= month && it.endDate.slice(0, 7) >= month).toBe(true);
    }
    expect(items.some(i => i.title === '[예시] 미검수 공고')).toBe(false);
    // 종일 일정은 00:00 KST(= 전날 15:00Z)
    const allDay = items.find(i => i.allDay)!;
    expect(allDay.startsAt).toMatch(/T15:00:00\.000Z$/);
  });

  it('캘린더: 여러 날 일정은 걸친 달에도 나온다', async () => {
    const [row] = await sql<{ m: string }[]>`
      select to_char(coalesce(s.ends_at, s.starts_at) at time zone 'Asia/Seoul', 'YYYY-MM') as m
      from schedules s join notices n on n.id = s.notice_id
      where n.external_id = 'DEV-003' and s.kind = 'doc_submit'`;
    const body = await get<CalendarResponse>(`/api/calendar?month=${row!.m}`);
    expect(body.items.some(i => i.title.includes('수원영통') && i.kind === 'doc_submit')).toBe(true);
  });

  it('캘린더: 지역·유형 필터', async () => {
    const month = currentMonthKst();
    const seoul = dev((await get<CalendarResponse>(`/api/calendar?month=${month}&regions=11000`)).items);
    expect(seoul.every(i => !i.title.includes('수원') && !i.title.includes('인천') && !i.title.includes('고양'))).toBe(true);
    const happy = dev((await get<CalendarResponse>(`/api/calendar?month=${month}&types=happy_house`)).items);
    expect(happy.every(i => i.housingType === 'happy_house')).toBe(true);
    expect((await app.request('/api/calendar?regions=seoul')).status).toBe(400);
  });

  it('목록: 접수 중 → 예정 → 마감, 상태는 지금 시각으로 다시 계산', async () => {
    // 수집 때 저장된 status 가 틀려도(마감 공고를 open 으로) 일정 기준으로 마감이 된다
    await sql`update notices set status = 'open' where external_id = 'DEV-005'`;
    const body = await get<NoticeListResponse>('/api/notices?limit=50');
    const items = dev(body.items);
    const order = items.map(i => i.status);
    expect(order).toEqual([...order].sort((a, b) => rank(a) - rank(b)));
    expect(items.find(i => i.title.includes('강남구'))!.status).toBe('closed');
    // 접수 중끼리는 마감 빠른 순: 수원(내일) → 동대문(3일 뒤)
    const open = items.filter(i => i.status === 'open').map(i => i.title);
    expect(open.indexOf('[예시] 수원영통 행복주택 예비입주자 모집'))
      .toBeLessThan(open.indexOf('[예시] 동대문구 청년안심주택(공공) 입주자 모집'));
    expect(items.find(i => i.title.includes('수원'))!.regionNames).toEqual(['수원시 영통구']);
  });

  it('목록: 상태·검색 필터와 다음 페이지', async () => {
    const open = dev((await get<NoticeListResponse>('/api/notices?status=open')).items);
    expect(open.length).toBeGreaterThan(0);
    expect(open.every(i => i.status === 'open')).toBe(true);
    const q = await get<NoticeListResponse>(`/api/notices?q=${encodeURIComponent('마포구')}`);
    expect(q.items.map(i => i.title)).toEqual(['[예시] 마포구 청년안심주택(민간) 추가 모집']);
    const p1 = await get<NoticeListResponse>('/api/notices?limit=2');
    expect(p1.nextCursor).toBe('2');
    const p2 = await get<NoticeListResponse>('/api/notices?limit=2&cursor=2');
    expect(p2.items[0]!.id).not.toBe(p1.items[0]!.id);
  });

  it('상세: 일정·세대·규칙·소득 기준표', async () => {
    const [{ id }] = await sql<{ id: string }[]>`select id from notices where external_id = 'DEV-001'`;
    const d = await get<NoticeDetail>(`/api/notices/${id}`);
    expect(d.schedules.map(s => s.kind)).toEqual(['announce', 'apply_start', 'apply_end', 'doc_result', 'winner', 'contract']);
    expect(d.units).toHaveLength(3);
    expect(d.units[0]!.complex?.name).toBe('[예시] 청량리역 청년주택');
    expect(d.rules[0]).toMatchObject({ targetGroup: 'youth', ageMin: 19, ageMax: 39, assetMax: 251000000, incomeYear: 2026 });
    expect(d.incomeStandards.length).toBe(8);
    expect(d.incomeStandards.every(s => s.basis === 'median' && s.year === 2026)).toBe(true);
  });

  it('상세: 미검수·없는 공고는 404', async () => {
    const [{ id }] = await sql<{ id: string }[]>`select id from notices where external_id = 'DEV-PENDING'`;
    expect((await app.request(`/api/notices/${id}`)).status).toBe(404);
    expect((await app.request('/api/notices/not-a-uuid')).status).toBe(404);
    const preview = createApp({ sql: () => sql, showUnverified: true });
    expect((await preview.request(`/api/notices/${id}`)).status).toBe(200);
  });

  it('진단 묶음: 접수 중·예정·최근 마감 공고와 규칙, 기준표', async () => {
    const body = await get<EligibilityBundleResponse>('/api/eligibility');
    const items = dev(body.items);
    const byExt = (part: string) => items.find(i => i.title.includes(part));
    expect(items.some(i => i.title === '[예시] 미검수 공고')).toBe(false);
    expect(byExt('강남구')?.status).toBe('closed'); // 25일 전 마감 → 포함
    expect(byExt('수원영통')!.rules.map(r => r.targetGroup).sort()).toEqual(['student', 'youth']);
    expect(byExt('고양')!.rules).toEqual([]);
    expect(body.incomeStandards.some(s => s.basis === 'median' && s.year === 2026 && s.householdSize === 1)).toBe(true);
  });

  it('진단 묶음으로 판정: 마포 거주 1인 청년', async () => {
    const body = await get<EligibilityBundleResponse>('/api/eligibility');
    const ctx = { incomeStandards: body.incomeStandards, today: new Date().toISOString().slice(0, 10) };
    const me = {
      birthYear: 1998, birthMonth: 5, regionCode: '11440', homelessScope: 'household' as const, householdSize: 1,
      incomeBand: 'i1', assetBand: 'a0', carBand: 'c0', isMarried: false, isStudent: false,
    };
    const verdict = (part: string) => {
      const n = dev(body.items).find(i => i.title.includes(part))!;
      return judgeNotice(n.rules, me, ctx).result;
    };
    expect(verdict('동대문구')).toBe('pass');
    expect(verdict('마포구')).toBe('pass');
    expect(verdict('수원영통')).toBe('pass'); // 청년: 2025년도 도시근로자 기준표로 판정(대학생 규칙은 학생 아님)
    expect(verdict('인천 연수구')).toBe('fail');  // 인천 거주 요건
    expect(verdict('고양')).toBe('none');        // 규칙 정리 전
  });
});

function rank(s: string) {
  return ({ open: 0, upcoming: 1, closed: 2, cancelled: 3 } as Record<string, number>)[s] ?? 9;
}
