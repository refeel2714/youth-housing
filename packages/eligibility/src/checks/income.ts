import { compareBandToMax, findBand, INCOME_BANDS } from '../bands.js';
import type { CheckResult, EligibilityRule, JudgeContext, Profile } from '../types.js';

const BASIS_LABEL = { median: '기준중위소득', urban_worker: '도시근로자 월평균소득' } as const;

export function checkIncome(rule: EligibilityRule, p: Profile, ctx: JudgeContext): CheckResult {
  if (rule.incomeBasis === null) return { check: 'income', v: 'pass', message: null };
  const basis = BASIS_LABEL[rule.incomeBasis];
  const unknown = (why: string): CheckResult => ({ check: 'income', v: 'unknown', message: `소득: ${why}` });

  if (p.householdSize === undefined) return unknown('가구원 수를 입력하면 확인할 수 있어요');
  const band = findBand(INCOME_BANDS, p.incomeBand);
  if (!band) return unknown('연소득 구간을 입력하면 확인할 수 있어요');

  const pct = rule.incomePctByHousehold?.[String(p.householdSize)];
  if (pct === undefined) return unknown(`${p.householdSize}인 가구 기준이 공고에 없어요. 원문을 확인해 주세요`);
  const std = ctx.incomeStandards.find(
    s => s.year === rule.incomeYear && s.basis === rule.incomeBasis && s.variant === 'default' && s.householdSize === p.householdSize,
  );
  if (!std) return unknown('기준액 정보가 아직 없어요. 원문을 확인해 주세요');

  // 연소득 구간을 월액으로 바꿔 기준액과 비교
  const limitAnnual = (std.monthlyAmount * pct) / 100 * 12;
  const v = compareBandToMax(band, limitAnnual);
  const lo = Math.round((band.min / 12 / std.monthlyAmount) * 100);
  const hi = band.max === null ? null : Math.round(((band.max - 1) / 12 / std.monthlyAmount) * 100);
  const mine = hi === null ? `약 ${lo}% 이상` : lo === hi ? `약 ${lo}%` : `약 ${lo}~${hi}%`;
  const verdict = v === 'pass' ? '충족' : v === 'fail' ? '초과' : '구간에 걸쳐 있어 확인 필요';
  return {
    check: 'income',
    v,
    message: `소득: ${basis} ${p.householdSize}인 가구 ${mine} → 기준 ${pct}% 이하 ${verdict}`,
  };
}
