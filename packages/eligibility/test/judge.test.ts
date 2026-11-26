import { describe, expect, it } from 'vitest';
import { ageRange, judge, type EligibilityRule, type JudgeContext, type Profile } from '../src/index.js';

// 테스트용 가짜 기준액(실제 고시 금액 아님): 1인 월 200만 원, 2인 월 300만 원
const ctx: JudgeContext = {
  today: '2026-11-26',
  incomeStandards: [
    { year: 2026, basis: 'median', variant: 'default', householdSize: 1, monthlyAmount: 2_000_000 },
    { year: 2026, basis: 'median', variant: 'default', householdSize: 2, monthlyAmount: 3_000_000 },
  ],
};

const base: EligibilityRule = {
  targetGroup: 'youth', variant: '',
  ageMin: 19, ageMax: 39, ageRefDate: '2026-08-01',
  residenceCodes: null, homelessScope: null,
  incomeBasis: null, incomeYear: null, incomePctByHousehold: null,
  assetMax: null, carValueMax: null, extra: {}, sourceClause: null, verified: true,
};
const rule = (over: Partial<EligibilityRule>): EligibilityRule => ({ ...base, ...over });
const check = (r: EligibilityRule, p: Profile, name: string) => judge(r, p, ctx).reasons.find(x => x.check === name)!;

describe('나이', () => {
  it('생월이 없으면 1살 폭', () => expect(ageRange({ birthYear: 2000 }, '2026-08-01')).toEqual([25, 26]));
  it('생일이 지났으면 그 해 나이', () => expect(ageRange({ birthYear: 2000, birthMonth: 3 }, '2026-08-01')).toEqual([26, 26]));
  it('생일 전이면 한 살 적게', () => expect(ageRange({ birthYear: 2000, birthMonth: 10 }, '2026-08-01')).toEqual([25, 25]));
  it('기준일과 같은 달이면 모름', () => expect(ageRange({ birthYear: 2000, birthMonth: 8 }, '2026-08-01')).toEqual([25, 26]));

  it('상한 경계에 걸치면 unknown', () => {
    // 1986년생, 기준일 2026-08-01 → 만 39 또는 40세
    expect(check(base, { birthYear: 1986 }, 'age').v).toBe('unknown');
  });
  it('생월이 있으면 경계가 확정된다', () => {
    expect(check(base, { birthYear: 1986, birthMonth: 12 }, 'age').v).toBe('pass'); // 만 39
    expect(check(base, { birthYear: 1986, birthMonth: 2 }, 'age').v).toBe('fail');  // 만 40
  });
  it('하한 미만이면 fail', () => expect(check(base, { birthYear: 2010 }, 'age').v).toBe('fail'));
  it('출생연도가 없으면 unknown', () => expect(check(base, {}, 'age').v).toBe('unknown'));
  it('기준일이 없으면 today 를 쓴다', () => {
    const r = rule({ ageRefDate: null });
    expect(check(r, { birthYear: 1987, birthMonth: 12 }, 'age').message).toContain('2026-11-26');
  });
});

describe('소득', () => {
  const r = rule({ incomeBasis: 'median', incomeYear: 2026, incomePctByHousehold: { '1': 120, '2': 110 } });
  // 1인 한도: 월 240만 원 = 연 2,880만 원

  it('구간 전체가 한도 이하면 pass', () => expect(check(r, { householdSize: 1, incomeBand: 'i0' }, 'income').v).toBe('pass'));
  it('구간이 한도에 걸치면 unknown', () => expect(check(r, { householdSize: 1, incomeBand: 'i1' }, 'income').v).toBe('unknown'));
  it('구간 전체가 한도 초과면 fail', () => expect(check(r, { householdSize: 1, incomeBand: 'i2' }, 'income').v).toBe('fail'));
  it('가구원 수가 없으면 unknown', () => expect(check(r, { incomeBand: 'i0' }, 'income').v).toBe('unknown'));
  it('공고에 없는 가구원 수면 unknown', () => expect(check(r, { householdSize: 3, incomeBand: 'i0' }, 'income').v).toBe('unknown'));
  it('기준액 연도가 없으면 unknown', () => {
    const r2 = rule({ incomeBasis: 'median', incomeYear: 2025, incomePctByHousehold: { '1': 120 } });
    expect(check(r2, { householdSize: 1, incomeBand: 'i0' }, 'income').v).toBe('unknown');
  });
  it('사유에 퍼센트와 기준이 들어간다', () => {
    expect(check(r, { householdSize: 2, incomeBand: 'i1' }, 'income').message).toMatch(/기준중위소득 2인 가구 약 \d+~\d+% → 기준 110% 이하/);
  });
});

describe('자산·자동차', () => {
  const r = rule({ assetMax: 337_000_000, carValueMax: 37_080_000 });
  it('자산 한도 이하', () => expect(check(r, { assetBand: 'a3' }, 'asset').v).toBe('pass'));
  it('자산 구간 걸침', () => expect(check(r, { assetBand: 'a4' }, 'asset').v).toBe('unknown'));
  it('자산 초과', () => expect(check(r, { assetBand: 'a5' }, 'asset').v).toBe('fail'));
  it('차량 없음은 pass', () => expect(check(r, { carBand: 'c0' }, 'car').v).toBe('pass'));
  it('차량 구간 걸침', () => expect(check(r, { carBand: 'c3' }, 'car').v).toBe('unknown'));
  it('없는 구간 코드는 unknown', () => expect(check(r, { assetBand: 'zz' }, 'asset').v).toBe('unknown'));
});

describe('지역·무주택·기타', () => {
  it('시도 전체 요건은 그 시도의 구를 포함', () =>
    expect(check(rule({ residenceCodes: ['11000'] }), { regionCode: '11440' }, 'region').v).toBe('pass'));
  it('다른 시도면 fail', () =>
    expect(check(rule({ residenceCodes: ['11000'] }), { regionCode: '41000' }, 'region').v).toBe('fail'));
  it('구 요건인데 사용자가 시도만 입력하면 unknown', () =>
    expect(check(rule({ residenceCodes: ['11440'] }), { regionCode: '11000' }, 'region').v).toBe('unknown'));
  it('세대 무주택 요건에 본인만 무주택이면 fail', () =>
    expect(check(rule({ homelessScope: 'household' }), { homelessScope: 'self' }, 'homeless').v).toBe('fail'));
  it('본인 무주택 요건에 세대 무주택이면 pass', () =>
    expect(check(rule({ homelessScope: 'self' }), { homelessScope: 'household' }, 'homeless').v).toBe('pass'));
  it('미혼 요건에 기혼이면 fail', () =>
    expect(check(rule({ extra: { unmarriedOnly: true } }), { isMarried: true }, 'extra').v).toBe('fail'));
  it('요건 정보가 없으면 unknown', () =>
    expect(check(rule({ extra: { studentOnly: true } }), {}, 'extra').v).toBe('unknown'));
});

describe('최종 판정', () => {
  const full: Profile = {
    birthYear: 1998, birthMonth: 5, regionCode: '11440', homelessScope: 'household',
    householdSize: 1, incomeBand: 'i0', assetBand: 'a1', carBand: 'c0', isMarried: false,
  };
  const r = rule({
    residenceCodes: ['11000'], homelessScope: 'household',
    incomeBasis: 'median', incomeYear: 2026, incomePctByHousehold: { '1': 120 },
    assetMax: 337_000_000, carValueMax: 37_080_000, extra: { unmarriedOnly: true },
  });

  it('모두 충족 + 검수됨 → pass', () => expect(judge(r, full, ctx).result).toBe('pass'));
  it('검수 전(자동 정리) 규칙도 모두 충족하면 pass', () => expect(judge({ ...r, verified: false }, full, ctx).result).toBe('pass'));
  it('하나라도 fail 이면 fail', () => expect(judge(r, { ...full, assetBand: 'a5' }, ctx).result).toBe('fail'));
  it('fail 이 있으면 unknown 보다 fail 이 우선', () =>
    expect(judge({ ...r, verified: false }, { ...full, incomeBand: undefined, assetBand: 'a5' }, ctx).result).toBe('fail'));
  it('조건을 하나도 안 넣으면 unknown', () => expect(judge(r, {}, ctx).result).toBe('unknown'));
  it('해당 없는 항목의 사유는 null', () => expect(check(base, full, 'income').message).toBeNull());
});
