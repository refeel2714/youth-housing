import type { ScheduleView } from '@yh/schema/constants';
import { fmtDate, fmtTime } from './dates';

/** 일정 한 줄 표기: '11.27(금)', '11.21(토) 10:00', '12.3(목) ~ 12.7(월)' */
export function fmtSchedule(s: Pick<ScheduleView, 'startDate' | 'endDate' | 'startsAt' | 'endsAt' | 'allDay'>): string {
  const start = s.allDay ? fmtDate(s.startDate) : `${fmtDate(s.startDate)} ${fmtTime(s.startsAt)}`;
  if (!s.endsAt) return start;
  if (s.endDate === s.startDate) return s.allDay ? start : `${start} ~ ${fmtTime(s.endsAt)}`;
  const end = s.allDay ? fmtDate(s.endDate) : `${fmtDate(s.endDate)} ${fmtTime(s.endsAt)}`;
  return `${start} ~ ${end}`;
}

/** 원 → '3,100만 원', '14만 원', '2억 5,100만 원' */
export function fmtWon(won: number | null): string {
  if (won === null) return '-';
  if (won < 10_000) return `${won.toLocaleString('ko-KR')}원`;
  const man = Math.round(won / 10_000);
  const eok = Math.floor(man / 10_000);
  const rest = man % 10_000;
  if (eok === 0) return `${rest.toLocaleString('ko-KR')}만 원`;
  return rest === 0 ? `${eok}억 원` : `${eok}억 ${rest.toLocaleString('ko-KR')}만 원`;
}
