// DB enum과 같은 값. 바꿀 때는 마이그레이션도 함께 바꾼다.
import { z } from 'zod';

export const HOUSING_TYPES = ['youth_safe_public', 'youth_safe_private', 'happy_house', 'youth_purchase_rental', 'other'] as const;
export const SCHEDULE_KINDS = ['announce', 'apply_start', 'apply_end', 'doc_submit', 'doc_result', 'winner', 'contract', 'move_in'] as const;
export const TARGET_GROUPS = ['youth', 'student', 'newlywed', 'general'] as const;
export const NOTICE_STATUSES = ['upcoming', 'open', 'closed', 'cancelled'] as const;
export const PARSE_STATUSES = ['pending', 'llm_parsed', 'verified', 'rejected'] as const;
export const HOMELESS_SCOPES = ['self', 'household', 'none'] as const;
export const INCOME_BASES = ['median', 'urban_worker'] as const;
export const WATCH_TARGETS = ['notice', 'complex', 'region'] as const;
export const NOTIFY_CHANNELS = ['email', 'toss'] as const;

export type HousingType = (typeof HOUSING_TYPES)[number];
export type ScheduleKind = (typeof SCHEDULE_KINDS)[number];
export type TargetGroup = (typeof TARGET_GROUPS)[number];
export type HomelessScope = (typeof HOMELESS_SCOPES)[number];
export type IncomeBasis = (typeof INCOME_BASES)[number];

/** 시군구 5자리 코드. 시도 전체는 뒤 세 자리가 000 */
export const regionCode = z.string().regex(/^[0-9]{5}$/);

/** eligibility_rules.extra 에 들어갈 수 있는 키 */
export const ruleExtra = z
  .object({
    studentOnly: z.boolean().optional(),     // 대학생·취업준비생 등 학생만
    unmarriedOnly: z.boolean().optional(),   // 미혼만
    marriedOnly: z.boolean().optional(),     // 기혼(신혼)만
    householderOnly: z.boolean().optional(), // 세대주만
  })
  .strict();
export type RuleExtra = z.infer<typeof ruleExtra>;

/** 판정에 쓰는 규칙(eligibility_rules 한 행) */
export const eligibilityRule = z.object({
  targetGroup: z.enum(TARGET_GROUPS),
  variant: z.string().default(''),
  ageMin: z.number().int().nullable(),
  ageMax: z.number().int().nullable(),
  ageRefDate: z.string().date().nullable(),
  residenceCodes: z.array(regionCode).nullable(),
  homelessScope: z.enum(HOMELESS_SCOPES).nullable(),
  incomeBasis: z.enum(INCOME_BASES).nullable(),
  incomeYear: z.number().int().nullable(),
  incomePctByHousehold: z.record(z.string(), z.number()).nullable(),
  assetMax: z.number().nullable(),
  carValueMax: z.number().nullable(),
  extra: ruleExtra.default({}),
  sourceClause: z.string().nullable(),
  verified: z.boolean(),
});
export type EligibilityRule = z.infer<typeof eligibilityRule>;

/** 사용자 조건. 금액은 구간 코드만 둔다(packages/eligibility/src/bands.ts) */
export const profile = z.object({
  birthYear: z.number().int().min(1950).max(2015).optional(),
  birthMonth: z.number().int().min(1).max(12).optional(),
  regionCode: regionCode.optional(),
  homelessScope: z.enum(HOMELESS_SCOPES).optional(),
  isHouseholder: z.boolean().optional(),
  householdSize: z.number().int().min(1).max(8).optional(),
  incomeBand: z.string().optional(),
  assetBand: z.string().optional(),
  carBand: z.string().optional(),
  isStudent: z.boolean().optional(),
  isMarried: z.boolean().optional(),
});
export type Profile = z.infer<typeof profile>;

export const incomeStandard = z.object({
  year: z.number().int(),
  basis: z.enum(INCOME_BASES),
  variant: z.string(),
  householdSize: z.number().int(),
  monthlyAmount: z.number(), // 원, 100% 기준 월액
});
export type IncomeStandard = z.infer<typeof incomeStandard>;
