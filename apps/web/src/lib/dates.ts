// 날짜는 모두 한국시간 'YYYY-MM-DD' 문자열로 다룬다. 기기 시간대와 무관하게 같은 결과가 나오도록 UTC 계산만 쓴다.
const DAY = 86_400_000;
const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

const toUtc = (d: string) => Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10)));
const fromUtc = (t: number) => new Date(t).toISOString().slice(0, 10);

export function todayKst(now = new Date()): string {
  return fromUtc(now.getTime() + 9 * 3_600_000);
}

export function addDays(d: string, n: number): string {
  return fromUtc(toUtc(d) + n * DAY);
}

export function addMonths(month: string, n: number): string {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7)) - 1 + n;
  return fromUtc(Date.UTC(y, m, 1)).slice(0, 7);
}

export function isMonth(v: string | null): v is string {
  return !!v && /^\d{4}-(0[1-9]|1[0-2])$/.test(v);
}

export function weekday(d: string): number {
  return new Date(toUtc(d)).getUTCDay();
}

/** 일요일 시작 주 단위 달력. 앞뒤 달 날짜로 칸을 채운다 */
export function monthGrid(month: string): { date: string; inMonth: boolean }[][] {
  const first = `${month}-01`;
  const start = addDays(first, -weekday(first));
  const last = addDays(`${addMonths(month, 1)}-01`, -1);
  const end = addDays(last, 6 - weekday(last));
  const weeks: { date: string; inMonth: boolean }[][] = [];
  for (let d = start; d <= end; d = addDays(d, 7)) {
    weeks.push(Array.from({ length: 7 }, (_, i) => {
      const date = addDays(d, i);
      return { date, inMonth: date.startsWith(month) };
    }));
  }
  return weeks;
}

/** [start, end] 안의 날짜들(최대 62일) */
export function eachDate(start: string, end: string): string[] {
  const out: string[] = [];
  for (let d = start; d <= end && out.length < 62; d = addDays(d, 1)) out.push(d);
  return out;
}

/** '11.27(금)' */
export function fmtDate(d: string, withYear = false): string {
  const md = `${Number(d.slice(5, 7))}.${Number(d.slice(8, 10))}(${WEEKDAYS[weekday(d)]})`;
  return withYear ? `${d.slice(0, 4)}.${md}` : md;
}

/** ISO 시각 → 한국시간 'HH:mm' */
export function fmtTime(iso: string): string {
  return new Date(new Date(iso).getTime() + 9 * 3_600_000).toISOString().slice(11, 16);
}

export function fmtMonth(month: string): string {
  return `${month.slice(0, 4)}년 ${Number(month.slice(5, 7))}월`;
}

/** target 까지 남은 날. 오늘이면 0, 지났으면 음수 */
export function daysUntil(target: string, today: string): number {
  return Math.round((toUtc(target) - toUtc(today)) / DAY);
}

export function ddayLabel(n: number): string {
  return n === 0 ? 'D-DAY' : n > 0 ? `D-${n}` : `D+${-n}`;
}
