// 쿼리 문자열 해석. 잘못된 값은 throw 대신 null 을 돌려주고 라우트에서 400 으로 답한다.
import { HOUSING_TYPES, NOTICE_STATUSES, type HousingType, type NoticeStatus } from '@yh/schema';

/** 'YYYY-MM' → 그 달 1일 00:00 KST ~ 다음 달 1일 00:00 KST */
export function monthRange(month: string): { from: Date; to: Date } | null {
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(month);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const pad = (n: number) => String(n).padStart(2, '0');
  const ny = mo === 12 ? y + 1 : y;
  const nm = mo === 12 ? 1 : mo + 1;
  return {
    from: new Date(`${y}-${pad(mo)}-01T00:00:00+09:00`),
    to: new Date(`${ny}-${pad(nm)}-01T00:00:00+09:00`),
  };
}

/** 지금 한국시간 기준 'YYYY-MM' */
export function currentMonthKst(now = new Date()): string {
  return new Date(now.getTime() + 9 * 3_600_000).toISOString().slice(0, 7);
}

/** 쉼표 목록. 비어 있으면 null(필터 끔), 허용 밖 값이 있으면 undefined(잘못된 요청) */
function csv<T extends string>(raw: string | undefined, ok: (v: string) => v is T): T[] | null | undefined {
  if (!raw) return null;
  const vals = [...new Set(raw.split(',').map(v => v.trim()).filter(Boolean))];
  if (vals.length === 0) return null;
  return vals.every(ok) ? vals : undefined;
}

export const parseRegions = (raw?: string) =>
  csv(raw, (v): v is string => /^[0-9]{5}$/.test(v));
export const parseTypes = (raw?: string) =>
  csv(raw, (v): v is HousingType => (HOUSING_TYPES as readonly string[]).includes(v));
export const parseStatuses = (raw?: string) =>
  csv(raw, (v): v is NoticeStatus => (NOTICE_STATUSES as readonly string[]).includes(v));

export function parseLimit(raw: string | undefined, def = 20, max = 50): number | null {
  if (!raw) return def;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 && n <= max ? n : null;
}

/** 목록 다음 페이지 표시. 지금은 offset 을 그대로 쓴다 */
export function parseCursor(raw: string | undefined): number | null {
  if (!raw) return 0;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 && n <= 10_000 ? n : null;
}

export const isUuid = (v: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
