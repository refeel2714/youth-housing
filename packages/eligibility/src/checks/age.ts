import type { CheckResult, EligibilityRule, JudgeContext, Profile } from '../types.js';

/** 기준일의 만 나이가 될 수 있는 범위 [lo, hi]. 생일을 모르면 폭이 1살 */
export function ageRange(p: Profile, refDate: string): [number, number] | null {
  if (p.birthYear === undefined) return null;
  const refYear = Number(refDate.slice(0, 4));
  const refMonth = Number(refDate.slice(5, 7));
  const full = refYear - p.birthYear; // 생일이 지났을 때
  if (p.birthMonth === undefined || p.birthMonth === refMonth) return [full - 1, full];
  return p.birthMonth < refMonth ? [full, full] : [full - 1, full - 1];
}

export function checkAge(rule: EligibilityRule, p: Profile, ctx: JudgeContext): CheckResult {
  if (rule.ageMin === null && rule.ageMax === null) return { check: 'age', v: 'pass', message: null };
  const ref = rule.ageRefDate ?? ctx.today;
  const limit = `만 ${rule.ageMin ?? ''}~${rule.ageMax ?? ''}세`;
  const r = ageRange(p, ref);
  if (!r) return { check: 'age', v: 'unknown', message: `나이: 출생연도를 입력하면 확인할 수 있어요 (기준 ${limit})` };
  const [lo, hi] = r;
  const min = rule.ageMin ?? -Infinity;
  const max = rule.ageMax ?? Infinity;
  const shown = lo === hi ? `만 ${lo}세` : `만 ${lo}~${hi}세`;
  if (lo >= min && hi <= max) return { check: 'age', v: 'pass', message: `나이: ${ref} 기준 ${shown} → ${limit} 충족` };
  if (hi < min || lo > max) return { check: 'age', v: 'fail', message: `나이: ${ref} 기준 ${shown} → ${limit} 벗어남` };
  return { check: 'age', v: 'unknown', message: `나이: ${ref} 기준 ${shown} → 생일에 따라 달라져요 (기준 ${limit})` };
}
