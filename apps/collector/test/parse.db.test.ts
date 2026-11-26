// 자동 정리 통합 테스트. TEST_DATABASE_URL 이 있을 때만 돈다(store.db.test.ts 와 같은 DB).
// Claude 는 부르지 않고 가짜 extractor 를 끼운다.
import { readFileSync } from 'node:fs';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { RegionResolver } from '../src/lib/regions.js';
import { ParseError, type Extractor } from '../src/parse/claude.js';
import type { Extraction } from '../src/parse/extraction.js';
import { parsePending } from '../src/parse/run.js';
import { toNotice, type SeoulListResponse } from '../src/sources/seoul-housing.js';
import { getSource, loadRegions, saveNotice } from '../src/store.js';

const url = process.env.TEST_DATABASE_URL;
const list = JSON.parse(readFileSync(new URL('./fixtures/seoul-list.json', import.meta.url), 'utf8')) as SeoulListResponse;
// store.db.test.ts 와 동시에 돌므로 다른 external_id 를 쓴다
const EXT = '990001';
const item = () => ({ ...list.resultList[0]!, boardId: Number(EXT) });

const result: Extraction = {
  schedules: [
    { kind: 'apply_start', date: '2026-12-01', time: '10:00', endDate: null, endTime: null, label: '청약 신청' },
    { kind: 'contract', date: '2026-12-20', time: null, endDate: null, endTime: null, label: '계약' },
  ],
  rules: [{
    targetGroup: 'youth', variant: '', ageMin: 19, ageMax: 39, ageRefDate: '2026-11-26', residence: [],
    homelessScope: 'self', incomeBasis: 'urban_worker', incomeYear: 2025,
    incomePct: [1, 2, 3, 4, 5, 6, 7, 8].map(h => ({ householdSize: h, pct: 100 })),
    assetMaxWon: 337_000_000, carValueMaxWon: null,
    studentOnly: false, unmarriedOnly: true, marriedOnly: false, householderOnly: false, sourceClause: '청년 계층',
  }],
  notes: null,
};

describe.skipIf(!url)('parsePending (DB)', () => {
  const sql = postgres(url ?? '', { max: 2, onnotice: () => {} });
  let sourceId = 0;
  let regions: RegionResolver;
  let calls = 0;
  let scope: string[] = [];
  const now = new Date('2026-11-26T12:00:00+09:00');
  const fake: Extractor = async () => { calls++; return { model: 'fake-model', extraction: result, usage: { input: 1, output: 1 } }; };
  const run = (extractor: Extractor = fake, extra: { ids?: string[] } = {}) =>
    parsePending(sql, { extractor, model: 'fake-model', regions, limit: 50, now, log: () => {}, scope, ...extra });
  const row = async () => (await sql`
    select id, parse_status, parsed_hash, content_hash, status from notices where external_id = ${EXT}`)[0]!;
  const kinds = async () => (await sql`
    select s.kind, s.seq from schedules s join notices n on n.id = s.notice_id
    where n.external_id = ${EXT} order by s.kind::text, s.seq`).map(r => `${r.kind}:${r.seq}`);

  beforeAll(async () => {
    sourceId = (await getSource(sql, 'SEOUL_HOUSING'))!.id;
    regions = new RegionResolver(await loadRegions(sql));
  });
  beforeEach(async () => {
    calls = 0;
    // 테스트 공고만 새로 넣고, 정리 대상도 그 공고로 좁힌다(scope)
    await sql`delete from notices where external_id = ${EXT}`;
    await saveNotice(sql, sourceId, toNotice(item(), [], { regions, now }));
    scope = [(await row()).id as string];
  });
  afterAll(async () => {
    await sql`delete from notices where external_id = ${EXT}`;
    await sql.end();
  });

  it('규칙을 넣고 없는 종류의 일정만 더한다', async () => {
    const before = await kinds();
    expect(await run()).toMatchObject({ parsed: 1, failed: 0 });
    const n = await row();
    expect(n.parse_status).toBe('llm_parsed');
    expect(n.parsed_hash).toBe(n.content_hash);
    const rules = await sql`select target_group, age_max, income_pct_by_household, extra, verified from eligibility_rules where notice_id = ${n.id}`;
    expect(rules).toEqual([{ target_group: 'youth', age_max: 39, income_pct_by_household: expect.objectContaining({ 1: 100 }), extra: { unmarriedOnly: true }, verified: false }]);
    // 수집기가 이미 뽑은 apply_start 는 그대로, contract 만 추가
    expect(await kinds()).toEqual([...before, 'contract:1'].sort());
    const [p] = await sql`select model, output from notice_parses where notice_id = ${n.id}`;
    expect(p!.model).toBe('fake-model');
    expect(p!.output).toHaveProperty('warnings', []);
  });

  it('다시 돌려도 본문이 그대로면 건너뛴다', async () => {
    await run();
    expect(await run()).toMatchObject({ parsed: 0, cached: 0 });
    expect(calls).toBe(1);
  });

  it('관리자가 저장한 공고(parsed_hash = 본문)는 덮지 않는다', async () => {
    await sql`update notices set parsed_hash = content_hash where external_id = ${EXT}`;
    expect(await run()).toMatchObject({ parsed: 0 });
    expect(calls).toBe(0);
  });

  it('다시 자동 정리(parsed_hash 비움)하면 같은 입력은 이전 결과를 재사용한다', async () => {
    await run();
    await sql`update notices set parsed_hash = null where external_id = ${EXT}`;
    expect(await run()).toMatchObject({ parsed: 0, cached: 1 });
    expect(calls).toBe(1);
  });

  it('검수 완료·내린 공고는 정리하지 않는다', async () => {
    await sql`update notices set parse_status = 'verified' where external_id = ${EXT}`;
    expect(await run()).toMatchObject({ parsed: 0 });
    await sql`update notices set parse_status = 'rejected' where external_id = ${EXT}`;
    expect(await run()).toMatchObject({ parsed: 0 });
    expect(calls).toBe(0);
  });

  it('정리하는 동안 관리자가 저장하면 결과를 버린다', async () => {
    const racing: Extractor = async i => {
      await sql`update notices set parsed_hash = content_hash where external_id = ${EXT}`;
      return fake(i);
    };
    expect(await run(racing)).toMatchObject({ parsed: 0, skipped: 1 });
    expect(await sql`select 1 from eligibility_rules r join notices n on n.id = r.notice_id where n.external_id = ${EXT}`).toHaveLength(0);
  });

  it('다시 해도 안 될 실패는 기록하고 다음에 건너뛴다, 일시 오류는 다시 시도', async () => {
    const flaky: Extractor = async () => { calls++; throw new Error('network'); };
    expect(await run(flaky)).toMatchObject({ failed: 1 });
    expect((await row()).parsed_hash).toBeNull();
    const hopeless: Extractor = async () => { calls++; throw new ParseError('본문이 너무 김'); };
    expect(await run(hopeless)).toMatchObject({ failed: 1 });
    const n = await row();
    expect(n.parsed_hash).toBe(n.content_hash);
    expect(await run(hopeless)).toMatchObject({ failed: 0 });
  });

  it('접수 일정이 없던 공고에 접수 일정이 생기면 상태를 다시 계산한다', async () => {
    await sql`delete from schedules s using notices n where n.id = s.notice_id and n.external_id = ${EXT} and s.kind in ('apply_start', 'apply_end')`;
    await sql`update notices set status = 'closed' where external_id = ${EXT}`;
    await run();
    expect((await row()).status).toBe('upcoming');
    expect(await kinds()).toContain('apply_start:1');
  });
});
