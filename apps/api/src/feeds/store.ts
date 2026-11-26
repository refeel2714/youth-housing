// 캘린더 구독 저장과 일정 고르기.
// feedSchedules 의 선택 기준(관심 공고는 모든 일정, 관심 지역은 접수 시작·마감)은
// 로그인 뒤 이메일 알림 대상 선정(notify/plan)에서도 같은 기준으로 watches 에 대해 쓰도록 한 곳에 둔다.
import type { Sql } from '@yh/db';
import type { FeedSelection, ScheduleKind } from '@yh/schema';
import { createHash, randomBytes } from 'node:crypto';
import { visible, type Visibility } from '../queries.js';

/** 관심 지역으로 들어오는 일정 종류(관심 공고는 전부) */
export const REGION_KINDS: ScheduleKind[] = ['apply_start', 'apply_end'];
/** 캘린더 앱 알림을 거는 일정 종류(챙겨서 해야 할 일이 있는 날) */
export const ALARM_KINDS: ScheduleKind[] = ['apply_start', 'apply_end', 'doc_submit', 'contract'];

export const hashKey = (key: string) => createHash('sha256').update(key, 'utf8').digest();
const randomToken = (bytes: number) => randomBytes(bytes).toString('base64url');

export interface StoredFeed extends FeedSelection { id: string }

export async function createFeed(sql: Sql, sel: FeedSelection): Promise<{ token: string; key: string }> {
  const token = randomToken(18); // 24자
  const key = randomToken(32);
  await sql`
    insert into calendar_feeds (token, edit_key_hash, notice_ids, region_codes, alarm_days)
    values (${token}, ${hashKey(key)}, ${sel.noticeIds}::uuid[], ${sel.regionCodes}::text[], ${sel.alarmDays}::smallint[])`;
  return { token, key };
}

/** 키가 맞으면 목록을 갈아 끼운다. 구독이 없거나 키가 틀리면 false */
export async function updateFeed(sql: Sql, token: string, key: string, sel: FeedSelection): Promise<boolean> {
  const rows = await sql`
    update calendar_feeds
       set notice_ids = ${sel.noticeIds}::uuid[], region_codes = ${sel.regionCodes}::text[], alarm_days = ${sel.alarmDays}::smallint[]
     where token = ${token} and edit_key_hash = ${hashKey(key)}
    returning id`;
  return rows.length > 0;
}

export async function deleteFeed(sql: Sql, token: string, key: string): Promise<boolean> {
  const rows = await sql`delete from calendar_feeds where token = ${token} and edit_key_hash = ${hashKey(key)} returning id`;
  return rows.length > 0;
}

/** 캘린더 앱이 받아 갈 때. 받은 시각은 한 시간에 한 번만 갱신한다(쓰기 줄이기) */
export async function loadFeed(sql: Sql, token: string): Promise<StoredFeed | null> {
  const [row] = await sql<{ id: string; notice_ids: string[]; region_codes: string[]; alarm_days: number[] }[]>`
    select id, notice_ids, region_codes, alarm_days from calendar_feeds where token = ${token}`;
  if (!row) return null;
  await sql`
    update calendar_feeds set last_fetched_at = now()
     where id = ${row.id} and (last_fetched_at is null or last_fetched_at < now() - interval '1 hour')`;
  return { id: row.id, noticeIds: row.notice_ids, regionCodes: row.region_codes, alarmDays: row.alarm_days };
}

export interface FeedScheduleRow {
  schedule_id: string; kind: ScheduleKind; seq: number; starts_at: Date; ends_at: Date | null; all_day: boolean;
  note: string | null; notice_id: string; title: string; url_original: string; url_apply: string | null;
  verified: boolean; watched: boolean; updated_at: Date;
}

/**
 * 구독에 들어갈 일정. 화면에 보이는 공고(visible)만, 취소 공고 제외.
 * 기간: 끝난 지 pastDays 일 안 된 일정 ~ 1년 뒤까지(오래된 일정이 캘린더에 쌓이지 않게).
 */
export async function feedSchedules(
  sql: Sql, sel: Pick<FeedSelection, 'noticeIds' | 'regionCodes'>, v: Visibility, pastDays = 60,
): Promise<FeedScheduleRow[]> {
  if (sel.noticeIds.length === 0 && sel.regionCodes.length === 0) return [];
  return sql<FeedScheduleRow[]>`
    select s.id as schedule_id, s.kind, s.seq, s.starts_at, s.ends_at, s.all_day, s.note,
           n.id as notice_id, n.title, n.url_original, n.url_apply, n.parse_status = 'verified' as verified,
           n.id = any(${sel.noticeIds}::uuid[]) as watched, n.updated_at
    from schedules s
    join notices n on n.id = s.notice_id
    where ${visible(sql, v)}
      and n.status <> 'cancelled'
      and (n.id = any(${sel.noticeIds}::uuid[])
           or (n.region_codes && ${sel.regionCodes}::text[] and s.kind = any(${REGION_KINDS}::schedule_kind[])))
      and coalesce(s.ends_at, s.starts_at) >= now() - make_interval(days => ${pastDays})
      and s.starts_at < now() + interval '1 year'
    order by s.starts_at, n.title, s.kind
    limit 2000`;
}
