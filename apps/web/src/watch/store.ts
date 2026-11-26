// 관심 공고·관심 지역(로그인 없이 기기 저장). 캘린더 구독을 켜면 같은 목록을 서버 구독에 올리고,
// 목록이 바뀔 때마다 구독도 갈아 끼운다. 구독 키는 이 기기에만 있다.
// 로그인이 붙으면 이 목록을 서버 watches 로, 구독은 계정에 연결하는 쪽만 추가한다(이 모듈은 로그인과 무관).
import { platform } from '@platform';
import { FEED_LIMITS, type FeedSelection } from '@yh/schema/constants';
import { useSyncExternalStore } from 'react';
import { api, ApiError } from '../api/client';

const KEY = 'yh.watch.v1';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOKEN = /^[A-Za-z0-9_-]{20,128}$/;

export interface WatchedNotice { id: string; title: string; addedAt: string }
export interface Feed { token: string; key: string; url: string }
export interface WatchState {
  notices: WatchedNotice[];
  regions: string[];
  /** 캘린더 앱 알림: 일정 며칠 전(0=당일) 오전 9시 */
  alarmDays: number[];
  feed: Feed | null;
  /** 구독에 아직 못 올린 변경이 있음(오프라인 등). 다음에 열 때 다시 올린다 */
  dirty: boolean;
}

export const ALARM_OPTIONS = [
  { days: 0, label: '당일' },
  { days: 1, label: '하루 전' },
  { days: 3, label: '3일 전' },
  { days: 7, label: '일주일 전' },
] as const;

export const emptyWatch = (): WatchState => ({ notices: [], regions: [], alarmDays: [1], feed: null, dirty: false });

/** 저장소 값을 믿지 않고 항목별로 걸러 낸다 */
export function sanitizeWatch(raw: unknown): WatchState {
  const v = (raw ?? {}) as Record<string, unknown>;
  const seen = new Set<string>();
  const notices = (Array.isArray(v.notices) ? v.notices : [])
    .filter((n): n is WatchedNotice => !!n && typeof n === 'object'
      && typeof (n as WatchedNotice).id === 'string' && UUID.test((n as WatchedNotice).id)
      && typeof (n as WatchedNotice).title === 'string')
    .map(n => ({ id: n.id.toLowerCase(), title: n.title.slice(0, 200), addedAt: typeof n.addedAt === 'string' ? n.addedAt : '' }))
    .filter(n => !seen.has(n.id) && !!seen.add(n.id))
    .slice(0, FEED_LIMITS.notices);
  const regions = [...new Set((Array.isArray(v.regions) ? v.regions : [])
    .filter((c): c is string => typeof c === 'string' && /^[0-9]{5}$/.test(c)))].slice(0, FEED_LIMITS.regions);
  const alarmDays = Array.isArray(v.alarmDays)
    ? [...new Set(v.alarmDays.filter((d): d is number => ALARM_OPTIONS.some(o => o.days === d)))].slice(0, FEED_LIMITS.alarms)
    : [1];
  const f = v.feed as Feed | null | undefined;
  const feed = f && typeof f === 'object' && TOKEN.test(f.token) && TOKEN.test(f.key) && typeof f.url === 'string' && /^https?:\/\//.test(f.url)
    ? { token: f.token, key: f.key, url: f.url } : null;
  return { notices, regions, alarmDays, feed, dirty: feed !== null && v.dirty === true };
}

export const selectionOf = (s: WatchState): FeedSelection => ({
  noticeIds: s.notices.map(n => n.id), regionCodes: s.regions, alarmDays: s.alarmDays,
});

/** 시도 전체를 고르면 그 시도의 시군구는 뺀다(겹쳐 받을 필요가 없음). 시군구를 고르면 시도 전체는 푼다 */
export function toggleRegionIn(regions: string[], code: string): string[] {
  if (regions.includes(code)) return regions.filter(c => c !== code);
  const sido = code.slice(0, 2);
  const isSido = code.endsWith('000');
  const rest = regions.filter(c => (isSido ? c.slice(0, 2) !== sido : c !== `${sido}000`));
  return [...rest, code];
}

// ── 저장소 ───────────────────────────────────────────
let current: WatchState | undefined;
const listeners = new Set<() => void>();

function read(): WatchState {
  try { return sanitizeWatch(JSON.parse(platform.storage.get(KEY) ?? 'null')); } catch { return emptyWatch(); }
}

export function getWatch(): WatchState {
  if (current === undefined) {
    current = read();
    if (current.dirty) scheduleSync(0);
  }
  return current;
}

function commit(next: WatchState, sync = false) {
  current = next;
  platform.storage.set(KEY, JSON.stringify(next));
  listeners.forEach(l => l());
  if (sync && next.feed) scheduleSync();
}

export function useWatch(): WatchState {
  return useSyncExternalStore(l => { listeners.add(l); return () => listeners.delete(l); }, getWatch);
}

export const isWatched = (s: WatchState, id: string) => s.notices.some(n => n.id === id.toLowerCase());

export function toggleNotice(n: { id: string; title: string }) {
  const s = getWatch();
  const id = n.id.toLowerCase();
  const notices = isWatched(s, id)
    ? s.notices.filter(x => x.id !== id)
    : [{ id, title: n.title, addedAt: new Date().toISOString() }, ...s.notices].slice(0, FEED_LIMITS.notices);
  commit({ ...s, notices, dirty: !!s.feed }, true);
}

export function removeNotice(id: string) {
  const s = getWatch();
  commit({ ...s, notices: s.notices.filter(x => x.id !== id), dirty: !!s.feed }, true);
}

export function toggleRegion(code: string) {
  const s = getWatch();
  commit({ ...s, regions: toggleRegionIn(s.regions, code).slice(0, FEED_LIMITS.regions), dirty: !!s.feed }, true);
}

export function toggleAlarm(days: number) {
  const s = getWatch();
  const on = s.alarmDays.includes(days);
  if (!on && s.alarmDays.length >= FEED_LIMITS.alarms) return;
  const alarmDays = on ? s.alarmDays.filter(d => d !== days) : [...s.alarmDays, days].sort((a, b) => a - b);
  commit({ ...s, alarmDays, dirty: !!s.feed }, true);
}

// ── 서버 구독 ────────────────────────────────────────
let timer: ReturnType<typeof setTimeout> | undefined;
let syncing: Promise<void> | null = null;

function scheduleSync(delay = 800) {
  clearTimeout(timer);
  timer = setTimeout(() => { void syncNow(); }, delay);
}

/** 지금 목록을 구독에 올린다. 구독이 서버에서 사라졌으면(404) 기기에서도 지운다 */
export async function syncNow(): Promise<void> {
  if (syncing) { await syncing; }
  const s = getWatch();
  if (!s.feed || !s.dirty) return;
  const sentAt = current;
  syncing = api.updateFeed(s.feed.token, s.feed.key, selectionOf(s)).then(
    // 올리는 사이에 또 바뀌었으면 dirty 를 남겨 다음 예약에서 다시 올린다
    () => { if (current === sentAt) commit({ ...getWatch(), dirty: false }); },
    (e: unknown) => {
      if (e instanceof ApiError && e.status === 404) commit({ ...getWatch(), feed: null, dirty: false });
    },
  ).finally(() => { syncing = null; });
  await syncing;
}

export async function subscribe(): Promise<Feed> {
  const s = getWatch();
  if (s.feed) return s.feed;
  const created = await api.createFeed(selectionOf(s));
  const feed = { token: created.token, key: created.key, url: created.url };
  const latest = getWatch();
  // 만드는 사이에 목록이 바뀌었으면 한 번 더 올린다
  const changed = JSON.stringify(selectionOf(latest)) !== JSON.stringify(selectionOf(s));
  commit({ ...latest, feed, dirty: changed }, changed);
  return feed;
}

export async function unsubscribe(): Promise<void> {
  const s = getWatch();
  if (!s.feed) return;
  try {
    await api.deleteFeed(s.feed.token, s.feed.key);
  } catch (e) {
    if (!(e instanceof ApiError && e.status === 404)) throw e;
  }
  commit({ ...getWatch(), feed: null, dirty: false });
}

/** 캘린더 앱별 추가 주소 */
export function feedLinks(url: string) {
  const webcal = url.replace(/^https?:/, 'webcal:');
  return {
    webcal,
    google: `https://calendar.google.com/calendar/render?cid=${encodeURIComponent(webcal)}`,
    https: url,
  };
}
