// 검수 화면 통합 테스트. TEST_DATABASE_URL 이 있을 때만 돈다(마이그레이션·시드를 넣은 DB).
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';

const url = process.env.TEST_DATABASE_URL;
const ORIGIN = 'http://localhost';

describe.skipIf(!url)('admin routes (DB)', () => {
  const sql = postgres(url ?? '', { max: 2, onnotice: () => {} });
  const app = createApp({ sql: () => sql, showUnverified: false,
    admin: { config: { password: 'testpass123', secret: '0123456789abcdef0123' } } });
  let cookie = '';
  let id = '';

  const post = (path: string, form: Record<string, string | string[]>, withOrigin = true) => {
    const body = new URLSearchParams();
    for (const [k, v] of Object.entries(form)) for (const x of [v].flat()) body.append(k, x);
    return app.request(`${ORIGIN}${path}`, {
      method: 'POST', body,
      headers: { 'content-type': 'application/x-www-form-urlencoded', cookie, ...(withOrigin ? { origin: ORIGIN } : {}) },
    });
  };
  const get = (path: string) => app.request(`${ORIGIN}${path}`, { headers: { cookie } });

  beforeAll(async () => {
    await sql`delete from notices where external_id like 'ADMIN-TEST-%'`;
    const [row] = await sql<{ id: string }[]>`
      insert into notices (source_id, external_id, title, housing_type, url_original, region_codes, raw_text, content_hash, parse_status)
      select id, 'ADMIN-TEST-1', '[검수테스트] 동작구 청년안심주택', 'youth_safe_public', 'https://example.invalid/a',
             '{11000,11590}', '청약신청 2026.12.08 10:00', 'h1', 'pending'
      from sources where code = 'SEOUL_HOUSING' returning id`;
    id = row!.id;
    await sql`insert into schedules (notice_id, kind, seq, starts_at, all_day) values (${id}, 'apply_start', 1, '2026-12-08 10:00+09', false)`;
  });
  afterAll(async () => {
    await sql`delete from notices where external_id like 'ADMIN-TEST-%'`;
    await sql.end();
  });

  it('로그인 전에는 로그인 화면으로, 다른 출처 POST 는 거부', async () => {
    const res = await get('/admin');
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('/admin/login');
    expect((await post('/admin/login', { name: 'a', password: 'testpass123' }, false)).status).toBe(403);
    expect((await post('/admin/login', { name: 'a', password: 'wrong-password' })).status).toBe(401);
  });

  it('로그인 → 대기열에 미검수 공고', async () => {
    const res = await post('/admin/login', { name: '검수자', password: 'testpass123' });
    expect(res.status).toBe(303);
    cookie = res.headers.get('set-cookie')!.split(';')[0]!;
    const page = await (await get('/admin?tab=queue&q=검수테스트')).text();
    expect(page).toContain('[검수테스트] 동작구 청년안심주택');
    const edit = await (await get(`/admin/notices/${id}`)).text();
    expect(edit).toContain('청약신청');
    expect(edit).toContain('value="10:00"');
  });

  it('미검수라도 접수 일정이 있으면 앱에 자동 공개(자동 수집 표시), 목록에서 내리기·되살리기', async () => {
    const res = await app.request(`/api/notices/${id}`);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { verified: boolean }).verified).toBe(false);
    const off = createApp({ sql: () => sql, showUnverified: false, autoPublish: 'off' });
    expect((await off.request(`/api/notices/${id}`)).status).toBe(404);
    const apiOnly = createApp({ sql: () => sql, showUnverified: false, autoPublish: 'api' });
    expect((await apiOnly.request(`/api/notices/${id}`)).status).toBe(404); // 서울주거포털은 크롤링 소스
    expect(await (await get('/admin?tab=queue&q=검수테스트')).text()).toContain('앱에 노출 중');

    const hide = await post(`/admin/notices/${id}/hide`, { back: '/admin?tab=queue&q=x' });
    expect(hide.status).toBe(303);
    expect(hide.headers.get('location')).toBe('/admin?tab=queue&q=x&done=rejected');
    expect((await app.request(`/api/notices/${id}`)).status).toBe(404);
    const restore = await post(`/admin/notices/${id}/hide`, { restore: '1', back: 'https://evil.example/' });
    expect(restore.headers.get('location')).toBe('/admin?done=restored');
    expect((await app.request(`/api/notices/${id}`)).status).toBe(200);
  });

  const form = (extra: Record<string, string | string[]> = {}) => ({
    title: '[검수테스트] 동작구 청년안심주택', housingType: 'youth_safe_public', urlOriginal: 'https://example.invalid/a',
    publishedAt: '2026-11-20', region: ['11590'], seen_hash: 'h1',
    s_count: '2', 's0.kind': 'apply_start', 's0.date': '2026-12-08', 's0.time': '10:00',
    's1.kind': 'apply_end', 's1.date': '2026-12-10', 's1.time': '17:00',
    r_count: '1', 'r0.targetGroup': 'youth', 'r0.ageMin': '19', 'r0.ageMax': '39', 'r0.incomeBasis': 'urban_worker',
    'r0.incomeYear': '2025', 'r0.incomePct': '1:120, 2-8:100', 'r0.assetMaxMan': '33700',
    ...extra,
  });

  it('잘못된 입력은 422 로 다시 그리고 저장하지 않는다', async () => {
    const res = await post(`/admin/notices/${id}`, form({ action: 'approve', 's1.date': '2026-13-01' }));
    expect(res.status).toBe(422);
    expect(await res.text()).toContain('날짜를 넣어 주세요');
    const [n] = await sql`select parse_status from notices where id = ${id}`;
    expect(n!.parse_status).toBe('pending');
  });

  it('미검수 저장은 본 본문 해시를 parsed_hash 로 남겨 자동 정리가 덮지 않게, "다시 자동 정리"는 비운다', async () => {
    await sql`update notices set parse_status = 'llm_parsed' where id = ${id}`;
    const res = await post(`/admin/notices/${id}`, form({ action: 'save' }));
    expect(res.status).toBe(303);
    expect(await (await get(`/admin/notices/${id}`)).text()).toContain('자동으로 정리한 조건');
    const [n] = await sql`select parse_status, parsed_hash from notices where id = ${id}`;
    expect(n).toMatchObject({ parse_status: 'llm_parsed', parsed_hash: 'h1' });
    const [r] = await sql`select verified from eligibility_rules where notice_id = ${id}`;
    expect(r!.verified).toBe(false);
    const again = await post(`/admin/notices/${id}`, { action: 'reparse' });
    expect(again.headers.get('location')).toBe(`/admin/notices/${id}?done=reparse`);
    const [m] = await sql`select parsed_hash from notices where id = ${id}`;
    expect(m!.parsed_hash).toBeNull();
  });

  it('승인: 일정 upsert(id 유지)·규칙·지역 확장·공개 API 노출', async () => {
    const [before] = await sql<{ id: string }[]>`select id from schedules where notice_id = ${id} and kind = 'apply_start'`;
    const res = await post(`/admin/notices/${id}`, form({ action: 'approve' }));
    expect(res.status).toBe(303);
    const [n] = await sql`select parse_status, verified_by, verified_content_hash, region_codes from notices where id = ${id}`;
    expect(n).toMatchObject({ parse_status: 'verified', verified_by: '검수자', verified_content_hash: 'h1', region_codes: ['11000', '11590'] });
    const s = await sql`select id, kind, starts_at from schedules where notice_id = ${id} order by starts_at`;
    expect(s.map(x => x.kind)).toEqual(['apply_start', 'apply_end']);
    expect(s[0]!.id).toBe(before!.id);
    expect((s[1]!.starts_at as Date).toISOString()).toBe('2026-12-10T08:00:00.000Z');
    const [r] = await sql`select asset_max, income_pct_by_household, verified from eligibility_rules where notice_id = ${id}`;
    expect(r).toMatchObject({ asset_max: '337000000', verified: true });
    expect(r!.income_pct_by_household).toMatchObject({ 1: 120, 2: 100, 8: 100 });
    const body = (await (await app.request(`/api/notices/${id}`)).json()) as { verified: boolean };
    expect(body.verified).toBe(true);
  });

  it('본문이 바뀌면 "다시 확인"에 뜨고, 다시 저장하면 빠진다', async () => {
    await sql`update notices set content_hash = 'h2' where id = ${id}`;
    expect(await (await get('/admin?tab=recheck&q=검수테스트')).text()).toContain('[검수테스트]');
    expect(await (await get(`/admin/notices/${id}`)).text()).toContain('검수 뒤 원문 본문이 바뀌었습니다');
    const res = await post(`/admin/notices/${id}`, form({ action: 'save', seen_hash: 'h2', 's1.del': '1' }));
    expect(res.status).toBe(303);
    const [n] = await sql`select parse_status, verified_content_hash from notices where id = ${id}`;
    expect(n).toMatchObject({ parse_status: 'verified', verified_content_hash: 'h2' }); // 공개 중은 save 도 승인 저장
    expect((await sql`select kind from schedules where notice_id = ${id}`).map(x => x.kind)).toEqual(['apply_start']);
    expect(await (await get('/admin?tab=recheck&q=검수테스트')).text()).not.toContain('[검수테스트]');
  });

  it('반려하면 공개 API 에서 빠진다', async () => {
    const res = await post(`/admin/notices/${id}`, { action: 'reject', reviewNote: '중복 공고' });
    expect(res.status).toBe(303);
    const [n] = await sql`select parse_status, review_note from notices where id = ${id}`;
    expect(n).toMatchObject({ parse_status: 'rejected', review_note: '중복 공고' });
    expect((await app.request(`/api/notices/${id}`)).status).toBe(404);
  });
});
