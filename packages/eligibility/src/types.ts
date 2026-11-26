// 판정 패키지는 순수 함수만 둔다. 외부 의존성·Node API·DB import 금지.
// @yh/schema 에서는 타입만 가져온다.
import type { EligibilityRule, IncomeStandard, Profile } from '@yh/schema';

export type { EligibilityRule, IncomeStandard, Profile };

export type Verdict = 'pass' | 'fail' | 'unknown';
export type CheckName = 'age' | 'region' | 'homeless' | 'income' | 'asset' | 'car' | 'extra';

export interface CheckResult {
  check: CheckName;
  v: Verdict;
  /** 화면에 보여줄 한 줄 사유. 규칙이 없으면(해당 없음) null */
  message: string | null;
}

export interface JudgeContext {
  /** 규칙이 참조하는 연도·기준의 기준액 표 */
  incomeStandards: IncomeStandard[];
  /** 'YYYY-MM-DD'. 규칙에 기준일이 없을 때 나이 계산 기준 */
  today: string;
}

export interface JudgeResult {
  result: Verdict;
  reasons: CheckResult[];
}
