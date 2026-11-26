import { judge } from './judge.js';
import type { EligibilityRule, JudgeContext, JudgeResult, Profile, Verdict } from './types.js';

/** 공고 하나의 최종 판정. 규칙이 없으면 'none'(자격 정보 정리 전) */
export type NoticeVerdict = Verdict | 'none';

export interface RuleJudgement extends JudgeResult {
  rule: EligibilityRule;
}

export interface NoticeJudgement {
  result: NoticeVerdict;
  /** 대상군(× 공급구분)별 판정. pass → unknown → fail 순 */
  rules: RuleJudgement[];
}

const ORDER: Record<Verdict, number> = { pass: 0, unknown: 1, fail: 2 };

/**
 * 공고의 규칙 여러 개(청년·대학생·신혼부부, 특별/일반 공급 등) 중 하나라도 넣을 수 있으면 그 공고는 지원 가능.
 * 하나라도 pass → pass, 아니면 하나라도 unknown → unknown, 전부 fail → fail.
 */
export function judgeNotice(rules: EligibilityRule[], p: Profile, ctx: JudgeContext): NoticeJudgement {
  if (rules.length === 0) return { result: 'none', rules: [] };
  const judged = rules
    .map(rule => ({ rule, ...judge(rule, p, ctx) }))
    .sort((a, b) => ORDER[a.result] - ORDER[b.result]);
  return { result: judged[0]!.result, rules: judged };
}

/** 판정에서 '확인 필요(unknown)' 를 만든 사유와 '불가(fail)' 사유만 추린다(결과 화면 요약용) */
export function keyReasons(j: RuleJudgement): string[] {
  const want = j.result === 'fail' ? 'fail' : 'unknown';
  const msgs = j.reasons.filter(r => r.v === want && r.message).map(r => r.message!);
  return msgs;
}
