// 수집 결과 적재. 공고는 (source_id, external_id)로 upsert 한다.
// - 검수 완료(verified) 공고: 상태(status)만 갱신. 본문이 바뀌면 raw_text·content_hash 만 바꾸고
//   updated_at > verified_at 으로 검수 화면에서 "다시 확인"이 보이게 한다(일정·규칙은 손대지 않음).
// - 그 외: 본문이 바뀌면 parse_status 를 pending 으로 되돌리고 일정을 다시 넣는다.
import { createHash } from 'node:crypto';
import type { Sql } from '@yh/db';
import type { RegionRow } from './lib/regions.js';
import type { CollectedNotice, SourceCode } from './sources/types.js';

export type SaveResult = 'inserted' | 'updated' | 'unchanged';

export function contentHash(n: CollectedNotice): string {
  return createHash('sha256').update(n.title).update('\n').update(n.rawText).digest('hex');
}

export async function loadRegions(sql: Sql): Promise<RegionRow[]> {
  return sql<RegionRow[]>`select code, sido, sigungu from regions`;
}

export async function getSource(sql: Sql, code: SourceCode): Promise<{ id: number; enabled: boolean } | undefined> {
  const [row] = await sql<{ id: number; enabled: boolean }[]>`select id, enabled from sources where code = ${code}`;
  return row;
}

export async function markRun(sql: Sql, sourceId: number, error: string | null): Promise<void> {
  if (error === null) {
    await sql`update sources set last_run_at = now(), last_success_at = now(), last_error = null where id = ${sourceId}`;
  } else {
    await sql`update sources set last_run_at = now(), last_error = ${error.slice(0, 2000)} where id = ${sourceId}`;
  }
}

/** 같은 kind 가 여러 번이면 seq 1,2,… */
function withSeq(n: CollectedNotice) {
  const count = new Map<string, number>();
  return n.schedules.map(s => {
    const seq = (count.get(s.kind) ?? 0) + 1;
    count.set(s.kind, seq);
    return { ...s, seq };
  });
}

export async function saveNotice(sql: Sql, sourceId: number, n: CollectedNotice): Promise<SaveResult> {
  const hash = contentHash(n);
  return sql.begin(async tx => {
    const [cur] = await tx<{ id: string; content_hash: string | null; parse_status: string; status: string }[]>`
      select id, content_hash, parse_status, status from notices
      where source_id = ${sourceId} and external_id = ${n.externalId}
      for update`;

    let noticeId: string;
    let result: SaveResult;

    if (!cur) {
      const [row] = await tx<{ id: string }[]>`
        insert into notices (source_id, external_id, title, housing_type, url_original, url_apply,
                             published_at, status, region_codes, raw_text, content_hash)
        values (${sourceId}, ${n.externalId}, ${n.title}, ${n.housingType}, ${n.urlOriginal}, ${n.urlApply},
                ${n.publishedAt}, ${n.status}, ${n.regionCodes}, ${n.rawText}, ${hash})
        returning id`;
      noticeId = row!.id;
      result = 'inserted';
    } else if (cur.parse_status === 'verified') {
      const changed = cur.content_hash !== hash;
      if (!changed && cur.status === n.status) return 'unchanged';
      await tx`
        update notices set status = ${n.status}
          ${changed ? tx`, raw_text = ${n.rawText}, content_hash = ${hash}` : tx``}
        where id = ${cur.id}`;
      return 'updated';
    } else {
      const changed = cur.content_hash !== hash;
      if (!changed && cur.status === n.status) return 'unchanged';
      await tx`
        update notices set
          title = ${n.title}, housing_type = ${n.housingType}, url_original = ${n.urlOriginal},
          url_apply = ${n.urlApply}, published_at = ${n.publishedAt}, status = ${n.status},
          region_codes = ${n.regionCodes}, raw_text = ${n.rawText}, content_hash = ${hash}
          ${changed && cur.parse_status !== 'rejected' ? tx`, parse_status = 'pending'` : tx``}
        where id = ${cur.id}`;
      if (!changed) return 'updated';
      noticeId = cur.id;
      result = 'updated';
    }

    // 미검수 공고의 일정은 수집 결과로 맞춘다(알림은 verified 공고에만 생기므로 지워도 안전)
    const rows = withSeq(n);
    for (const s of rows) {
      await tx`
        insert into schedules (notice_id, kind, seq, starts_at, ends_at, all_day, note)
        values (${noticeId}, ${s.kind}, ${s.seq}, ${s.startsAt}, ${s.endsAt}, ${s.allDay}, ${s.note})
        on conflict (notice_id, kind, seq) do update set
          starts_at = excluded.starts_at, ends_at = excluded.ends_at,
          all_day = excluded.all_day, note = excluded.note`;
    }
    const keep = rows.map(s => `${s.kind}:${s.seq}`);
    await tx`
      delete from schedules
      where notice_id = ${noticeId}
        and not ((kind::text || ':' || seq::text) = any(${keep}::text[]))`;
    return result;
  });
}
