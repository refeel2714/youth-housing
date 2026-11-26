// 공고문 날짜 표기를 KST 기준 Date로 바꾼다.
// 지원 예: 2026-11-26, 2026.07.31, 2026. 08. 11.(화) 10:00, ‘26. 11. 30. (월) 09:00, 20261126

export interface KstDateTime {
  date: string;        // YYYY-MM-DD
  time: string | null; // HH:MM, 없으면 null
}

const YMD = /(?:(\d{4})|[‘'’`](\d{2}))\s*[.\-/년]\s*(\d{1,2})\s*[.\-/월]\s*(\d{1,2})\s*(?:일|\.)?/;
const TIME = /^\s*(?:\([^)]*\)\s*)?(\d{1,2}):(\d{2})/;

const pad = (n: number) => String(n).padStart(2, '0');

function valid(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCMonth() === m - 1;
}

/** 문자열 안의 첫 날짜(+바로 뒤 시각)를 찾는다. 찾은 끝 위치도 돌려준다 */
export function findDate(s: string, from = 0): { value: KstDateTime; end: number } | null {
  const sub = s.slice(from);
  const m = YMD.exec(sub);
  if (!m) return null;
  const y = m[1] ? Number(m[1]) : 2000 + Number(m[2]);
  const mo = Number(m[3]);
  const d = Number(m[4]);
  if (!valid(y, mo, d)) return null;
  let end = from + m.index + m[0].length;
  let time: string | null = null;
  const t = TIME.exec(s.slice(end));
  if (t) {
    const hh = Number(t[1]);
    const mm = Number(t[2]);
    if (hh <= 24 && mm < 60) {
      time = `${pad(hh)}:${pad(mm)}`;
      end += t[0].length;
    }
  }
  return { value: { date: `${y}-${pad(mo)}-${pad(d)}`, time }, end };
}

export function parseDate(s: string | null | undefined): KstDateTime | null {
  if (!s) return null;
  const compact = /^\s*(\d{4})(\d{2})(\d{2})\s*$/.exec(s);
  if (compact) {
    const [y, m, d] = [Number(compact[1]), Number(compact[2]), Number(compact[3])];
    return valid(y, m, d) ? { date: `${y}-${pad(m)}-${pad(d)}`, time: null } : null;
  }
  return findDate(s)?.value ?? null;
}

/** KST 날짜·시각 → timestamptz에 넣을 ISO 문자열(+09:00) */
export function toKstIso(v: KstDateTime): string {
  return `${v.date}T${v.time ?? '00:00'}:00+09:00`;
}

/** 오늘 날짜(KST) YYYY-MM-DD */
export function todayKst(now = new Date()): string {
  return new Date(now.getTime() + 9 * 3600_000).toISOString().slice(0, 10);
}
