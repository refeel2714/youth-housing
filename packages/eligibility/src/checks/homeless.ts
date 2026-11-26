import type { CheckResult, EligibilityRule, Profile } from '../types.js';

// profile.homelessScope: household = 세대원 전원 무주택, self = 본인만 무주택, none = 본인이 주택 보유
const RANK = { none: 0, self: 1, household: 2 } as const;

export function checkHomeless(rule: EligibilityRule, p: Profile): CheckResult {
  if (rule.homelessScope === null || rule.homelessScope === 'none') return { check: 'homeless', v: 'pass', message: null };
  const need = rule.homelessScope === 'household' ? '세대원 전원 무주택' : '본인 무주택';
  if (!p.homelessScope) return { check: 'homeless', v: 'unknown', message: `주택: 주택 보유 여부를 입력하면 확인할 수 있어요 (기준 ${need})` };
  const ok = RANK[p.homelessScope] >= RANK[rule.homelessScope];
  return { check: 'homeless', v: ok ? 'pass' : 'fail', message: `주택: ${need} ${ok ? '충족' : '미충족'}` };
}
