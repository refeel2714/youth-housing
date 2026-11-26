// API fetch 래퍼. 웹은 같은 출처(VITE_API_BASE 비움), 토스 미니앱은 API 전체 주소를 넣어 빌드한다.
import type {
  CalendarResponse, EligibilityBundleResponse, FeedCreated, FeedSelection, HousingType, NoticeDetail, NoticeListResponse,
  NoticeStatus, RegionView,
} from '@yh/schema/constants';

const BASE = (import.meta.env.VITE_API_BASE ?? '').replace(/\/$/, '');

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

async function fail(res: Response): Promise<never> {
  const body = (await res.json().catch(() => null)) as { error?: string } | null;
  throw new ApiError(res.status, body?.error ?? `요청 실패(${res.status})`);
}

async function get<T>(path: string, params: Record<string, string | undefined>, signal?: AbortSignal): Promise<T> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) qs.set(k, v);
  const q = qs.toString();
  const res = await fetch(`${BASE}/api${path}${q ? `?${q}` : ''}`, { signal, credentials: 'include' });
  if (!res.ok) return fail(res);
  return res.json() as Promise<T>;
}

/** 본문 있는 요청. 응답 본문이 없으면(204) undefined */
async function send<T>(method: string, path: string, body?: unknown, key?: string): Promise<T> {
  const res = await fetch(`${BASE}/api${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(key ? { authorization: `Bearer ${key}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) return fail(res);
  return (res.status === 204 ? undefined : res.json()) as Promise<T>;
}

export interface Filter { regions: string[]; types: HousingType[] }
const csv = (xs: string[]) => (xs.length ? xs.join(',') : undefined);

export const api = {
  calendar: (month: string, f: Filter, signal?: AbortSignal) =>
    get<CalendarResponse>('/calendar', { month, regions: csv(f.regions), types: csv(f.types) }, signal),
  notices: (o: Filter & { status: NoticeStatus[]; ids?: string[]; q?: string; cursor?: string; limit?: number }, signal?: AbortSignal) =>
    get<NoticeListResponse>('/notices', {
      status: csv(o.status), regions: csv(o.regions), types: csv(o.types), ids: o.ids && csv(o.ids), q: o.q, cursor: o.cursor,
      limit: o.limit ? String(o.limit) : undefined,
    }, signal),
  /** 30초 진단 묶음. 내 조건은 보내지 않고 화면에서 판정한다 */
  eligibility: (signal?: AbortSignal) => get<EligibilityBundleResponse>('/eligibility', {}, signal),
  regions: (signal?: AbortSignal) => get<{ items: RegionView[] }>('/regions', {}, signal),
  notice: (id: string, signal?: AbortSignal) => get<NoticeDetail>(`/notices/${encodeURIComponent(id)}`, {}, signal),
  /** 캘린더 구독. key 는 만들 때 한 번만 받고 기기에 둔다 */
  createFeed: (sel: FeedSelection) => send<FeedCreated>('POST', '/feeds', sel),
  updateFeed: (token: string, key: string, sel: FeedSelection) => send<void>('PUT', `/feeds/${token}`, sel, key),
  deleteFeed: (token: string, key: string) => send<void>('DELETE', `/feeds/${token}`, undefined, key),
};
