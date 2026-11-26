import type { CheckResult, EligibilityRule, Profile, Verdict } from '../types.js';

type Item = { need: boolean | undefined; have: boolean | undefined; want: boolean; label: string };

export function checkExtra(rule: EligibilityRule, p: Profile): CheckResult {
  const e = rule.extra ?? {};
  const items: Item[] = [
    { need: e.studentOnly, have: p.isStudent, want: true, label: '학생' },
    { need: e.unmarriedOnly, have: p.isMarried, want: false, label: '미혼' },
    { need: e.marriedOnly, have: p.isMarried, want: true, label: '기혼' },
    { need: e.householderOnly, have: p.isHouseholder, want: true, label: '세대주' },
  ].filter(i => i.need === true);
  if (items.length === 0) return { check: 'extra', v: 'pass', message: null };

  let v: Verdict = 'pass';
  const parts: string[] = [];
  for (const i of items) {
    if (i.have === undefined) { if (v === 'pass') v = 'unknown'; parts.push(`${i.label} 여부 입력 필요`); }
    else if (i.have !== i.want) { v = 'fail'; parts.push(`${i.label} 요건 미충족`); }
    else parts.push(`${i.label} 요건 충족`);
  }
  return { check: 'extra', v, message: `기타: ${parts.join(', ')}` };
}
