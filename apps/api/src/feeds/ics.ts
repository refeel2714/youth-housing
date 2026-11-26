// iCalendar(RFC 5545) 문자열 만들기. 외부 라이브러리 없이 필요한 만큼만.
// - 종일 일정은 DATE 값(시간대 없음)으로, 한국시간 날짜를 그대로 쓴다. 끝 날짜는 다음 날(배타).
// - 시각이 있는 일정은 UTC(Z)로 쓴다. 캘린더 앱이 기기 시간대로 보여 준다.
// - 줄은 75바이트(UTF-8)에서 접고, 접힌 줄은 공백 하나로 시작한다. 한글이 중간에 잘리지 않게 문자 단위로 자른다.

export interface IcsEvent {
  uid: string;
  startsAt: Date;
  endsAt: Date | null;
  allDay: boolean;
  summary: string;
  description?: string;
  url?: string | null;
  /** 일정 며칠 전 오전 9시(종일) 또는 그 시각 기준(시각 있음) 알림. 빈 배열이면 알림 없음 */
  alarmDays?: number[];
  /** 일정이 바뀌었을 때 캘린더 앱이 새로 받도록 */
  lastModified?: Date;
}

export interface IcsCalendar {
  name: string;
  description?: string;
  /** 캘린더 앱에 권하는 새로 받기 간격(분) */
  refreshMinutes?: number;
  events: IcsEvent[];
  now?: Date;
}

const KST_MS = 9 * 3_600_000;
const DAY_MS = 86_400_000;

/** TEXT 값 이스케이프: \ ; , 줄바꿈 */
export const escapeText = (s: string) =>
  s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

/** 75바이트 넘는 줄 접기 */
export function foldLine(line: string): string {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const out: string[] = [];
  let cur = '';
  let bytes = 0;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    const limit = out.length === 0 ? 75 : 74; // 이어지는 줄은 앞의 공백 1바이트
    if (bytes + n > limit) {
      out.push(cur);
      cur = '';
      bytes = 0;
    }
    cur += ch;
    bytes += n;
  }
  out.push(cur);
  return out.join('\r\n ');
}

const pad = (n: number) => String(n).padStart(2, '0');

/** 20261208T010000Z */
export function utcStamp(d: Date): string {
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}

/** 한국시간 날짜 20261208 (+days) */
export function kstDate(d: Date, plusDays = 0): string {
  const k = new Date(d.getTime() + KST_MS + plusDays * DAY_MS);
  return `${k.getUTCFullYear()}${pad(k.getUTCMonth() + 1)}${pad(k.getUTCDate())}`;
}

/**
 * 알림 시점(일정 시작 기준 상대값).
 * 종일: 시작일 00:00(현지) 기준이라 d일 전 9시 = -(24d - 9)시간. 당일이면 +9시간.
 * 시각 있음: d일 전, 당일이면 1시간 전.
 */
export function alarmTrigger(days: number, allDay: boolean): string {
  if (allDay) {
    const h = days * 24 - 9;
    return h <= 0 ? `PT${-h}H` : `-PT${h}H`;
  }
  return days === 0 ? '-PT1H' : `-P${days}D`;
}

function eventLines(e: IcsEvent, stamp: string): string[] {
  const l = ['BEGIN:VEVENT', `UID:${e.uid}`, `DTSTAMP:${stamp}`];
  if (e.allDay) {
    l.push(`DTSTART;VALUE=DATE:${kstDate(e.startsAt)}`);
    l.push(`DTEND;VALUE=DATE:${kstDate(e.endsAt ?? e.startsAt, 1)}`);
    l.push('TRANSP:TRANSPARENT'); // 종일 일정이 '바쁨'으로 잡히지 않게
  } else {
    l.push(`DTSTART:${utcStamp(e.startsAt)}`);
    // 끝 시각이 없으면 30분짜리로 둔다(마감 시각 등)
    const end = e.endsAt && e.endsAt > e.startsAt ? e.endsAt : new Date(e.startsAt.getTime() + 30 * 60_000);
    l.push(`DTEND:${utcStamp(end)}`);
  }
  l.push(`SUMMARY:${escapeText(e.summary)}`);
  if (e.description) l.push(`DESCRIPTION:${escapeText(e.description)}`);
  if (e.url) l.push(`URL:${e.url}`);
  if (e.lastModified) l.push(`LAST-MODIFIED:${utcStamp(e.lastModified)}`);
  for (const d of [...new Set(e.alarmDays ?? [])].sort((a, b) => b - a)) {
    l.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${escapeText(e.summary)}`,
      `TRIGGER:${alarmTrigger(d, e.allDay)}`, 'END:VALARM');
  }
  l.push('END:VEVENT');
  return l;
}

export function buildIcs(cal: IcsCalendar): string {
  const stamp = utcStamp(cal.now ?? new Date());
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//youth-housing//calendar feed//KO',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(cal.name)}`,
    'X-WR-TIMEZONE:Asia/Seoul',
  ];
  if (cal.description) lines.push(`X-WR-CALDESC:${escapeText(cal.description)}`);
  if (cal.refreshMinutes) {
    lines.push(`REFRESH-INTERVAL;VALUE=DURATION:PT${cal.refreshMinutes}M`, `X-PUBLISHED-TTL:PT${cal.refreshMinutes}M`);
  }
  for (const e of cal.events) lines.push(...eventLines(e, stamp));
  lines.push('END:VCALENDAR');
  return lines.map(foldLine).join('\r\n') + '\r\n';
}
