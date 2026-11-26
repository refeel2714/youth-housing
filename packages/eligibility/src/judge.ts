import { checkAge } from './checks/age.js';
import { checkAsset, checkCar } from './checks/asset.js';
import { checkExtra } from './checks/extra.js';
import { checkHomeless } from './checks/homeless.js';
import { checkIncome } from './checks/income.js';
import { checkRegion } from './checks/region.js';
import type { EligibilityRule, JudgeContext, JudgeResult, Profile } from './types.js';

/**
 * 공고 × 대상군 규칙 하나에 대한 판정.
 * 하나라도 fail → fail, 전부 pass 이고 검수된 규칙 → pass, 그 외 → unknown.
 * 검수 전 규칙(verified=false)은 pass 를 내지 않는다.
 */
export function judge(rule: EligibilityRule, p: Profile, ctx: JudgeContext): JudgeResult {
  const reasons = [
    checkAge(rule, p, ctx),
    checkRegion(rule, p),
    checkHomeless(rule, p),
    checkIncome(rule, p, ctx),
    checkAsset(rule, p),
    checkCar(rule, p),
    checkExtra(rule, p),
  ];
  const result = reasons.some(r => r.v === 'fail')
    ? 'fail'
    : reasons.every(r => r.v === 'pass') && rule.verified
      ? 'pass'
      : 'unknown';
  return { result, reasons };
}
