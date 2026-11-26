import { describe, expect, it } from 'vitest';
import { isAutoRule, judgeNotice, keyReasons, type EligibilityRule, type JudgeContext, type Profile } from '../src/index.js';

const ctx: JudgeContext = {
  today: '2026-11-26',
  incomeStandards: [{ year: 2026, basis: 'median', variant: 'default', householdSize: 1, monthlyAmount: 2_000_000 }],
};
const base: EligibilityRule = {
  targetGroup: 'youth', variant: '',
  ageMin: 19, ageMax: 39, ageRefDate: '2026-08-01',
  residenceCodes: null, homelessScope: 'household',
  incomeBasis: null, incomeYear: null, incomePctByHousehold: null,
  assetMax: null, carValueMax: null, extra: {}, sourceClause: null, verified: true,
};
const youth = base;
const student: EligibilityRule = { ...base, targetGroup: 'student', extra: { studentOnly: true } };
const newlywed: EligibilityRule = { ...base, targetGroup: 'newlywed', ageMin: null, ageMax: null, extra: { marriedOnly: true } };
const me: Profile = { birthYear: 1998, birthMonth: 5, homelessScope: 'household', isStudent: false, isMarried: false };

describe('공고 판정', () => {
  it('규칙이 없으면 none', () => expect(judgeNotice([], me, ctx).result).toBe('none'));
  it('하나라도 pass 면 pass, pass 규칙이 맨 앞', () => {
    const j = judgeNotice([student, youth], me, ctx);
    expect(j.result).toBe('pass');
    expect(j.rules[0]!.rule.targetGroup).toBe('youth');
  });
  it('pass 가 없고 unknown 이 있으면 unknown', () =>
    expect(judgeNotice([student, newlywed], { ...me, isMarried: undefined }, ctx).result).toBe('unknown'));
  it('전부 fail 이면 fail', () =>
    expect(judgeNotice([student, newlywed], me, ctx).result).toBe('fail'));
  it('주택 보유자는 무주택 요건 공고 전부 fail', () =>
    expect(judgeNotice([youth, student], { ...me, homelessScope: 'none' }, ctx).result).toBe('fail'));
});

describe('요약 사유', () => {
  it('fail 이면 fail 사유만', () => {
    const j = judgeNotice([youth], { ...me, birthYear: 1980 }, ctx);
    expect(keyReasons(j.rules[0]!)).toEqual([expect.stringContaining('벗어남')]);
  });
  it('unknown 이면 확인 필요 사유', () => {
    const j = judgeNotice([youth], { ...me, homelessScope: undefined }, ctx);
    expect(keyReasons(j.rules[0]!)).toEqual([expect.stringContaining('주택 보유 여부')]);
  });
  it('검수 전(자동 정리) 규칙도 판정하고, 규칙에서 자동 여부를 알 수 있다', () => {
    const j = judgeNotice([{ ...youth, verified: false }], me, ctx);
    expect(j.result).toBe('pass');
    expect(isAutoRule(j.rules[0]!.rule)).toBe(true);
  });
  it('pass 면 사유 없음', () => expect(keyReasons(judgeNotice([youth], me, ctx).rules[0]!)).toEqual([]));
});
