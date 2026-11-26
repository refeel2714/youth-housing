import type { CheckResult, EligibilityRule, Profile } from '../types.js';

const isSido = (code: string) => code.endsWith('000');
const sidoOf = (code: string) => code.slice(0, 2);

/** 규칙 지역 코드 하나가 사용자 지역을 포함하는지 */
function covers(ruleCode: string, userCode: string): 'pass' | 'fail' | 'unknown' {
  if (ruleCode === userCode) return 'pass';
  if (sidoOf(ruleCode) !== sidoOf(userCode)) return 'fail';
  if (isSido(ruleCode)) return 'pass';      // 규칙이 시도 전체
  if (isSido(userCode)) return 'unknown';   // 사용자가 시도만 입력
  return 'fail';
}

export function checkRegion(rule: EligibilityRule, p: Profile): CheckResult {
  if (!rule.residenceCodes || rule.residenceCodes.length === 0) return { check: 'region', v: 'pass', message: null };
  if (!p.regionCode) return { check: 'region', v: 'unknown', message: '거주지: 사는 지역을 입력하면 확인할 수 있어요' };
  const results = rule.residenceCodes.map(c => covers(c, p.regionCode!));
  if (results.includes('pass')) return { check: 'region', v: 'pass', message: '거주지: 거주 요건 충족' };
  if (results.includes('unknown')) return { check: 'region', v: 'unknown', message: '거주지: 구·군까지 입력하면 확인할 수 있어요' };
  return { check: 'region', v: 'fail', message: '거주지: 거주 요건 지역이 아니에요' };
}
