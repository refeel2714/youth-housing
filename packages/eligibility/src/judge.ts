import { checkAge } from './checks/age.js';
import { checkAsset, checkCar } from './checks/asset.js';
import { checkExtra } from './checks/extra.js';
import { checkHomeless } from './checks/homeless.js';
import { checkIncome } from './checks/income.js';
import { checkRegion } from './checks/region.js';
import type { EligibilityRule, JudgeContext, JudgeResult, Profile } from './types.js';

/**
 * 공고 × 대상군 규칙 하나에 대한 판정.
 * 하나라도 fail → fail, 전부 pass → pass, 그 외 → unknown.
 * 검수 전 규칙(verified=false, 본문에서 자동 정리한 조건)도 같은 기준으로 판정한다.
 * 화면은 rule.verified 를 보고 "자동 정리된 조건 기준"임을 따로 알린다(isAutoRule).
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
    : reasons.every(r => r.v === 'pass')
      ? 'pass'
      : 'unknown';
  return { result, reasons };
}

/** 운영자가 검수하지 않은(자동 정리된) 규칙 */
export const isAutoRule = (rule: EligibilityRule) => !rule.verified;
