// DB 적재 통합 테스트. TEST_DATABASE_URL 이 있을 때만 돈다(마이그레이션·시드를 넣은 빈 DB).
// 예: TEST_DATABASE_URL=postgres://postgres@localhost:5432/yh pnpm --filter @yh/collector test
import { readFileSync } from 'node:fs';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RegionResolver } from '../src/lib/regions.js';
import { toNotice, type SeoulListResponse } from '../src/sources/seoul-housing.js';
import { getSource, loadRegions, markRun, saveNotice } from '../src/store.js';

const url = process.env.TEST_DATABASE_URL;
const list = JSON.parse(readFileSync(new URL('./fixtures/seoul-list.json', import.meta.url), 'utf8')) as SeoulListResponse;

describe.skipIf(!url)('store (DB)', () => {
  const sql = postgres(url ?? '', { max: 2, onnotice: () => {} });
  let sourceId = 0;
  let regions: RegionResolver;
  const now = new Date('2026-11-26T12:00:00+09:00');

  beforeAll(async () => {
    await sql`delete from notices where external_id = '6889'`; // 테스트가 넣는 행만 지운다
    sourceId = (await getSource(sql, 'SEOUL_HOUSING'))!.id;
    regions = new RegionResolver(await loadRegions(sql));
  });
  afterAll(() => sql.end());

  const notice = () => toNotice(list.resultList[0]!, [], { regions, now });
  const schedules = () => sql`
    select s.kind, s.seq, s.starts_at, s.all_day from schedules s
    join notices n on n.id = s.notice_id where n.external_id = '6889' order by s.starts_at, s.kind`;

  it('새 공고를 넣고, 같은 내용이면 그대로', async () => {
    expect(await saveNotice(sql, sourceId, notice())).toBe('inserted');
    expect(await saveNotice(sql, sourceId, notice())).toBe('unchanged');
    const [n] = await sql`select parse_status, status, region_codes, content_hash from notices where external_id = '6889'`;
    expect(n).toMatchObject({ parse_status: 'pending', status: 'upcoming', region_codes: ['11000', '11230'] });
    expect((await schedules()).map(s => s.kind)).toEqual(['announce', 'apply_start', 'apply_end', 'doc_result']);
  });

  it('미검수 공고는 본문이 바뀌면 일정을 다시 맞춘다', async () => {
    await sql`update notices set parse_status = 'llm_parsed' where external_id = '6889'`;
    const n = notice();
    n.rawText += '\n정정: 서류심사 발표 삭제';
    n.schedules = n.schedules.filter(s => s.kind !== 'doc_result');
    expect(await saveNotice(sql, sourceId, n)).toBe('updated');
    const [row] = await sql`select parse_status from notices where external_id = '6889'`;
    expect(row!.parse_status).toBe('pending');
    expect((await schedules()).map(s => s.kind)).toEqual(['announce', 'apply_start', 'apply_end']);
  });

  it('검수 완료 공고는 상태·본문만 바꾸고 일정은 그대로', async () => {
    await sql`update notices set parse_status = 'verified', verified_at = now() where external_id = '6889'`;
    const before = await schedules();
    const n = notice();
    n.rawText += '\n또 정정';
    n.status = 'open';
    n.schedules = [];
    expect(await saveNotice(sql, sourceId, n)).toBe('updated');
    const [row] = await sql`select parse_status, status, raw_text from notices where external_id = '6889'`;
    expect(row).toMatchObject({ parse_status: 'verified', status: 'open' });
    expect(row!.raw_text).toContain('또 정정');
    expect(await schedules()).toEqual(before);
  });

  it('sources 실행 기록', async () => {
    await markRun(sql, sourceId, null);
    await markRun(sql, sourceId, '1건 저장 실패');
    const [s] = await sql`select last_run_at, last_success_at, last_error from sources where id = ${sourceId}`;
    expect(s!.last_success_at).not.toBeNull();
    expect(s!.last_error).toBe('1건 저장 실패');
  });
});
