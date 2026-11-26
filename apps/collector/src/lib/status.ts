import type { CollectedSchedule, NoticeStatus } from '../sources/types.js';

const DAY = 86_400_000;
const dayStartKst = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00+09:00`).getTime();

/** 접수 시작·마감으로 공고 상태를 정한다. 마감이 없으면 시작일(KST) 하루가 끝날 때까지 접수로 본다 */
export function statusFromSchedules(schedules: CollectedSchedule[], now: Date): NoticeStatus | null {
  const start = schedules.find(s => s.kind === 'apply_start');
  if (!start) return null;
  const end = schedules.find(s => s.kind === 'apply_end');
  const startAt = new Date(start.startsAt).getTime();
  const endAt = end
    ? end.allDay ? dayStartKst(end.startsAt) + DAY : new Date(end.startsAt).getTime()
    : dayStartKst(start.startsAt) + DAY;
  const t = now.getTime();
  if (t < startAt) return 'upcoming';
  if (t < endAt) return 'open';
  return 'closed';
}
