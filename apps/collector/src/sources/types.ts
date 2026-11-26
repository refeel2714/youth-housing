// 수집처 공통 타입. 소스는 목록 → 상세 → 본문(raw_text)까지 만들어 CollectedNotice로 넘기고,
// DB 적재는 store.ts 가 한 곳에서 한다.
import type { HousingType, ScheduleKind } from '@yh/schema';
import type { RegionResolver } from '../lib/regions.js';

export type SourceCode = 'LH_API' | 'SEOUL_HOUSING' | 'SH';
export type NoticeStatus = 'upcoming' | 'open' | 'closed' | 'cancelled';

export interface CollectedSchedule {
  kind: ScheduleKind;
  startsAt: string;      // ISO, +09:00
  endsAt: string | null;
  allDay: boolean;
  note: string | null;   // 원문 라벨
}

export interface CollectedNotice {
  externalId: string;
  title: string;
  housingType: HousingType;
  urlOriginal: string;
  urlApply: string | null;
  publishedAt: string | null;  // YYYY-MM-DD
  status: NoticeStatus;
  regionCodes: string[];
  rawText: string;
  schedules: CollectedSchedule[];
}

export interface SourceContext {
  regions: RegionResolver;
  now: Date;
  log: (msg: string) => void;
}

export interface Source {
  code: SourceCode;
  /** 수집해서 하나씩 넘긴다. 한 건 실패는 소스가 로그만 남기고 건너뛴다 */
  collect(ctx: SourceContext): AsyncIterable<CollectedNotice>;
}
