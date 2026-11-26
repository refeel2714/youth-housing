// API fetch 래퍼. 웹은 같은 출처(VITE_API_BASE 비움), 토스 미니앱은 API 전체 주소를 넣어 빌드한다.
import type {
  CalendarResponse, HousingType, NoticeDetail, NoticeListResponse, NoticeStatus,
} from '@yh/schema/constants';

const BASE = (import.meta.env.VITE_API_BASE ?? '').replace(/\/$/, '');

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

async function get<T>(path: string, params: Record<string, string | undefined>, signal?: AbortSignal): Promise<T> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) qs.set(k, v);
  const q = qs.toString();
  const res = await fetch(`${BASE}/api${path}${q ? `?${q}` : ''}`, { signal, credentials: 'include' });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new ApiError(res.status, body?.error ?? `요청 실패(${res.status})`);
  }
  return res.json() as Promise<T>;
}

export interface Filter { regions: string[]; types: HousingType[] }
const csv = (xs: string[]) => (xs.length ? xs.join(',') : undefined);

export const api = {
  calendar: (month: string, f: Filter, signal?: AbortSignal) =>
    get<CalendarResponse>('/calendar', { month, regions: csv(f.regions), types: csv(f.types) }, signal),
  notices: (o: Filter & { status: NoticeStatus[]; q?: string; cursor?: string }, signal?: AbortSignal) =>
    get<NoticeListResponse>('/notices', {
      status: csv(o.status), regions: csv(o.regions), types: csv(o.types), q: o.q, cursor: o.cursor,
    }, signal),
  notice: (id: string, signal?: AbortSignal) => get<NoticeDetail>(`/notices/${encodeURIComponent(id)}`, {}, signal),
};
