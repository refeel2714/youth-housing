import { beforeAll, describe, expect, it } from 'vitest';
import { RegionResolver } from '../src/lib/regions.js';
import { seedRegions } from '../src/lib/seed-regions.js';
import { convertExtraction } from '../src/parse/convert.js';
import { extraction, type ExtractedRule, type Extraction } from '../src/parse/extraction.js';
import { userPrompt } from '../src/parse/extraction.js';
import { z } from 'zod/v4';

let regions: RegionResolver;
beforeAll(async () => { regions = new RegionResolver(await seedRegions()); });

const rule = (o: Partial<ExtractedRule> = {}): ExtractedRule => ({
  targetGroup: 'youth', variant: '', ageMin: 19, ageMax: 39, ageRefDate: '2026-11-20',
  residence: [], homelessScope: 'household', incomeBasis: 'urban_worker', incomeYear: 2025,
  incomePct: [{ householdSize: 1, pct: 120 }, { householdSize: 2, pct: 110 }, { householdSize: 3, pct: 100 }],
  assetMaxWon: 345_000_000, carValueMaxWon: 38_030_000,
  studentOnly: false, unmarriedOnly: true, marriedOnly: false, householderOnly: false,
  sourceClause: '만 19세 이상 39세 이하 미혼 무주택자', ...o,
});
const x = (o: Partial<Extraction> = {}): Extraction => ({ schedules: [], rules: [rule()], notes: null, ...o });

describe('convertExtraction', () => {
  it('자격 규칙을 DB 모양으로 바꾼다', () => {
    const { rules, warnings } = convertExtraction(x(), regions);
    expect(warnings).toEqual([]);
    expect(rules).toEqual([{
      targetGroup: 'youth', variant: '', ageMin: 19, ageMax: 39, ageRefDate: '2026-11-20', residenceCodes: null,
      homelessScope: 'household', incomeBasis: 'urban_worker', incomeYear: 2025,
      incomePctByHousehold: { 1: 120, 2: 110, 3: 100 }, assetMax: 345_000_000, carValueMax: 38_030_000,
      extra: { unmarriedOnly: true }, sourceClause: '만 19세 이상 39세 이하 미혼 무주택자',
    }]);
  });

  it('거주 요건 지역 이름을 가장 좁은 코드로', () => {
    const { rules } = convertExtraction(x({ rules: [rule({ residence: ['서울특별시', '경기도 성남시'] })] }), regions);
    expect(rules[0]!.residenceCodes).toEqual(['11000', expect.stringMatching(/^41/)]);
    expect(rules[0]!.residenceCodes![1]).not.toBe('41000');
  });

  it('거주 요건을 하나도 못 옮기면 규칙을 뺀다(조건 없음으로 판정되지 않게)', () => {
    const r = convertExtraction(x({ rules: [rule({ residence: ['제주특별자치도'] })] }), regions);
    expect(r.rules).toEqual([]);
    expect(r.warnings.join()).toContain('거주 요건');
  });

  it('소득 기준이 불완전하면 규칙을 뺀다', () => {
    expect(convertExtraction(x({ rules: [rule({ incomeYear: null })] }), regions).rules).toEqual([]);
    expect(convertExtraction(x({ rules: [rule({ incomePct: [] })] }), regions).rules).toEqual([]);
  });

  it('소득 조건이 없으면 연도·%도 비운다', () => {
    const [r] = convertExtraction(x({ rules: [rule({ incomeBasis: null, incomeYear: 2025 })] }), regions).rules;
    expect(r).toMatchObject({ incomeBasis: null, incomeYear: null, incomePctByHousehold: null });
  });

  it('만원 단위로 잘못 옮긴 금액·이상한 나이는 버리고 경고', () => {
    const r = convertExtraction(x({ rules: [rule({ assetMaxWon: 34500, ageMin: 3, ageMax: 39 })] }), regions);
    expect(r.rules[0]).toMatchObject({ assetMax: null, ageMin: null, ageMax: 39 });
    expect(r.warnings).toHaveLength(2);
  });

  it('미혼만·기혼만이 같이 오면 둘 다 뺀다', () => {
    const [r] = convertExtraction(x({ rules: [rule({ unmarriedOnly: true, marriedOnly: true })] }), regions).rules;
    expect(r!.extra).toEqual({});
  });

  it('같은 대상군·구분이 겹치면 번호를 붙인다', () => {
    const { rules } = convertExtraction(x({ rules: [rule(), rule({ ageMax: 34 })] }), regions);
    expect(rules.map(r => r.variant)).toEqual(['', '구분 2']);
  });

  it('일정: 시각 있는 일정, 종일 기간, 잘못된 날짜', () => {
    const { schedules, warnings } = convertExtraction(x({
      rules: [],
      schedules: [
        { kind: 'apply_end', date: '2026-12-03', time: '17:00', endDate: null, endTime: null, label: '청약 신청' },
        { kind: 'apply_start', date: '2026-12-01', time: '10:00', endDate: null, endTime: null, label: '청약 신청' },
        { kind: 'doc_submit', date: '2026-12-08', time: null, endDate: '2026-12-10', endTime: null, label: '서류 제출' },
        { kind: 'winner', date: '2026-13-01', time: null, endDate: null, endTime: null, label: '당첨자 발표' },
        { kind: 'apply_start', date: '2026-12-01', time: '10:00', endDate: null, endTime: null, label: '청약 신청(중복)' },
      ],
    }), regions);
    expect(schedules).toEqual([
      { kind: 'apply_start', startsAt: '2026-12-01T10:00:00+09:00', endsAt: null, allDay: false, note: '청약 신청' },
      { kind: 'apply_end', startsAt: '2026-12-03T17:00:00+09:00', endsAt: null, allDay: false, note: '청약 신청' },
      { kind: 'doc_submit', startsAt: '2026-12-08T00:00:00+09:00', endsAt: '2026-12-10T00:00:00+09:00', allDay: true, note: '서류 제출' },
    ]);
    expect(warnings).toEqual([expect.stringContaining('당첨자 발표')]);
  });

  it('시각 있는 기간 일정의 끝 시각이 없으면 그날 23:59', () => {
    const { schedules } = convertExtraction(x({
      rules: [],
      schedules: [{ kind: 'doc_submit', date: '2026-12-08', time: '10:00', endDate: '2026-12-10', endTime: null, label: '서류' }],
    }), regions);
    expect(schedules[0]!.endsAt).toBe('2026-12-10T23:59:00+09:00');
  });
});

describe('extraction 스키마', () => {
  it('structured outputs 용 JSON 스키마로 바꿀 수 있고 모든 필드가 required', () => {
    const json = z.toJSONSchema(extraction) as { required: string[]; properties: Record<string, unknown> };
    expect(json.required).toEqual(['schedules', 'rules', 'notes']);
  });
  it('프롬프트에 본문을 자르지 않고 넣는다', () => {
    const body = '가'.repeat(5000);
    expect(userPrompt({ title: 't', publishedAt: null, rawText: body })).toContain(body);
  });
});
