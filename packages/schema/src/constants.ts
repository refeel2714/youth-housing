// zod 없이 쓰는 상수·화면 표기·API 응답 타입. 웹 번들은 '@yh/schema/constants' 만 import 한다.
// DB enum과 같은 값. 바꿀 때는 마이그레이션도 함께 바꾼다.
import type { EligibilityRule, IncomeStandard } from './index.js';
export type { EligibilityRule, IncomeStandard };

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
export type NoticeStatus = (typeof NOTICE_STATUSES)[number];

// ── 화면 표기 ──────────────────────────────────────────

export const HOUSING_TYPE_LABELS: Record<HousingType, string> = {
  youth_safe_public: '청년안심주택(공공)',
  youth_safe_private: '청년안심주택(민간)',
  happy_house: '행복주택',
  youth_purchase_rental: '청년 매입임대',
  other: '기타 임대',
};

export const SCHEDULE_KIND_LABELS: Record<ScheduleKind, string> = {
  announce: '공고',
  apply_start: '접수 시작',
  apply_end: '접수 마감',
  doc_submit: '서류 제출',
  doc_result: '서류 발표',
  winner: '당첨 발표',
  contract: '계약',
  move_in: '입주',
};

export const NOTICE_STATUS_LABELS: Record<NoticeStatus, string> = {
  upcoming: '접수 예정',
  open: '접수 중',
  closed: '마감',
  cancelled: '취소',
};

export const TARGET_GROUP_LABELS: Record<TargetGroup, string> = {
  youth: '청년',
  student: '대학생',
  newlywed: '신혼부부',
  general: '일반',
};

// ── 공개 API 응답(apps/api/src/routes/public.ts) ─────────
/** 날짜는 한국시간 YYYY-MM-DD, 시각은 ISO(UTC) */
export interface CalendarItem {
  scheduleId: string;
  kind: ScheduleKind;
  seq: number;
  startsAt: string;
  endsAt: string | null;
  startDate: string;
  endDate: string;
  allDay: boolean;
  note: string | null;
  noticeId: string;
  title: string;
  housingType: HousingType;
  status: NoticeStatus;
  urlOriginal: string;
  urlApply: string | null;
}
export interface CalendarResponse { month: string; items: CalendarItem[] }

export interface ScheduleView {
  id: string;
  kind: ScheduleKind;
  seq: number;
  startsAt: string;
  endsAt: string | null;
  startDate: string;
  endDate: string;
  allDay: boolean;
  note: string | null;
}

export interface NoticeSummary {
  id: string;
  title: string;
  housingType: HousingType;
  status: NoticeStatus;
  publishedAt: string | null;
  regionCodes: string[];
  regionNames: string[];
  sourceName: string;
  urlOriginal: string;
  urlApply: string | null;
  applyStart: ScheduleView | null;
  applyEnd: ScheduleView | null;
}
export interface NoticeListResponse { items: NoticeSummary[]; nextCursor: string | null }

export interface NoticeUnitView {
  id: string;
  targetGroup: TargetGroup;
  unitType: string | null;
  areaM2: number | null;
  deposit: number | null;
  monthlyRent: number | null;
  supplyCount: number | null;
  note: string | null;
  complex: { id: string; name: string; address: string | null; nearestStation: string | null } | null;
}

export interface NoticeDetail extends NoticeSummary {
  schedules: ScheduleView[];
  units: NoticeUnitView[];
  rules: EligibilityRule[];
  /** rules 가 참조하는 연도·기준의 소득 기준표(화면 판정용) */
  incomeStandards: IncomeStandard[];
}

export interface RegionView { code: string; sido: string; sigungu: string | null }

/** 30초 진단 묶음(GET /api/eligibility). 판정은 화면에서 @yh/eligibility 로 한다 */
export interface EligibilityNotice extends NoticeSummary {
  rules: EligibilityRule[];
}
export interface EligibilityBundleResponse {
  items: EligibilityNotice[];
  /** items 의 규칙들이 참조하는 소득 기준표 */
  incomeStandards: IncomeStandard[];
}
