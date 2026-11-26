// 미검수 공고 본문을 Claude 로 정리해 일정·자격 규칙을 채운다.
// - 대상: parse_status 가 pending·llm_parsed 이고 본문(content_hash)이 parsed_hash 와 다른 공고.
//   검수 완료·내린 공고, 관리자가 검수 화면에서 저장한 뒤 본문이 그대로인 공고는 건드리지 않는다.
// - 자격 규칙은 통째로 바꾸고 verified=false 로 둔다(앱에는 "자동 정리" 로 보임).
// - 일정은 수집기가 뽑은 것을 믿고, 그 공고에 아직 없는 종류만 더한다(서울 공고처럼 본문에만 일정이 있는 경우).
// - 같은 본문·프롬프트·모델로 이미 정리한 결과(notice_parses)가 있으면 API 를 다시 부르지 않는다.
import { createHash } from 'node:crypto';
import Anthropic from '@anthropic-ai/sdk';
import type { Sql } from '@yh/db';
import type { RegionResolver } from '../lib/regions.js';
import { statusFromSchedules } from '../lib/status.js';
import type { CollectedSchedule, NoticeStatus } from '../sources/types.js';
import { ParseError, type Extractor, type ParseOutput } from './claude.js';
import { convertExtraction, type Converted } from './convert.js';
import { extraction as extractionSchema, PROMPT_VERSION } from './extraction.js';

export interface ParseOptions {
  extractor: Extractor;
  /** 캐시 키에 넣을 모델 이름(PARSE_MODEL) */
  model: string;
  regions: RegionResolver;
  limit: number;
  /** 이 공고만(검수 화면·수동 실행용). 지정하면 parsed_hash 가 같아도 다시 정리한다 */
  ids?: string[];
  /** 대상 후보를 이 공고들로 좁힌다(ids 와 달리 정리된 공고는 그대로 건너뜀. 테스트용) */
  scope?: string[];
  /** DB 에 쓰지 않고 결과만 로그로 */
  dryRun?: boolean;
  now?: Date;
  log: (msg: string) => void;
}

export interface ParseCounts { parsed: number; cached: number; skipped: number; failed: number }

interface QueueRow {
  id: string; title: string; published_at: string | null; raw_text: string; content_hash: string | null;
}

export function inputHash(model: string, n: { title: string; raw_text: string }): string {
  return createHash('sha256').update(PROMPT_VERSION).update('\n').update(model).update('\n')
    .update(n.title).update('\n').update(n.raw_text).digest('hex');
}

async function queue(sql: Sql, o: ParseOptions): Promise<QueueRow[]> {
  const ids = o.ids && o.ids.length > 0 ? o.ids : null;
  // 접수 중·예정 공고를 먼저, 그다음 최근 수집 순
  return sql<QueueRow[]>`
    select n.id, n.title, to_char(n.published_at, 'YYYY-MM-DD') as published_at, n.raw_text, n.content_hash
    from notices n
    where n.parse_status in ('pending', 'llm_parsed')
      and n.raw_text is not null and length(btrim(n.raw_text)) > 0
      and ${ids ? sql`n.id = any(${ids}::uuid[])` : sql`n.content_hash is distinct from n.parsed_hash`}
      ${o.scope ? sql`and n.id = any(${o.scope}::uuid[])` : sql``}
    order by case when n.status in ('open', 'upcoming') then 0 else 1 end, n.created_at desc
    limit ${o.limit}`;
}

async function cachedOutput(sql: Sql, noticeId: string, hash: string): Promise<ParseOutput | null> {
  const [row] = await sql<{ model: string; output: { extraction?: unknown } }[]>`
    select model, output from notice_parses
    where notice_id = ${noticeId} and input_hash = ${hash} and output ? 'extraction'
    order by created_at desc limit 1`;
  const ok = row ? extractionSchema.safeParse(row.output.extraction) : null;
  return row && ok?.success ? { model: row.model, extraction: ok.data, usage: { input: 0, output: 0 } } : null;
}

/** 같은 kind 안에서 seq 를 이어 붙인다(이미 있는 종류는 건너뛰므로 보통 1부터) */
function withSeq(list: CollectedSchedule[]) {
  const count = new Map<string, number>();
  return list.map(s => {
    const seq = (count.get(s.kind) ?? 0) + 1;
    count.set(s.kind, seq);
    return { ...s, seq };
  });
}

type SaveResult = 'saved' | 'stale';

async function save(
  sql: Sql, n: QueueRow, out: ParseOutput, conv: Converted, hash: string, now: Date, force: boolean,
): Promise<SaveResult> {
  return sql.begin(async tx => {
    const [cur] = await tx<{ content_hash: string | null; parsed_hash: string | null; parse_status: string; status: NoticeStatus }[]>`
      select content_hash, parsed_hash, parse_status, status from notices where id = ${n.id} for update`;
    // 정리하는 동안 본문이 바뀌었거나, 검수·관리자 저장이 먼저 끝났으면 버린다
    if (!cur || cur.content_hash !== n.content_hash || !['pending', 'llm_parsed'].includes(cur.parse_status)) return 'stale';
    if (!force && cur.parsed_hash !== null && cur.parsed_hash === cur.content_hash) return 'stale';

    await tx`
      insert into notice_parses (notice_id, model, prompt_version, input_hash, output)
      values (${n.id}, ${out.model}, ${PROMPT_VERSION}, ${hash},
              ${tx.json({ extraction: out.extraction, warnings: conv.warnings, usage: out.usage } as never)})`;

    await tx`delete from eligibility_rules where notice_id = ${n.id}`;
    for (const r of conv.rules) {
      await tx`
        insert into eligibility_rules (notice_id, target_group, variant, age_min, age_max, age_ref_date, residence_codes,
                                       homeless_scope, income_basis, income_year, income_pct_by_household,
                                       asset_max, car_value_max, extra, source_clause, verified)
        values (${n.id}, ${r.targetGroup}, ${r.variant}, ${r.ageMin}, ${r.ageMax}, ${r.ageRefDate}, ${r.residenceCodes},
                ${r.homelessScope}, ${r.incomeBasis}, ${r.incomeYear},
                ${r.incomePctByHousehold === null ? null : tx.json(r.incomePctByHousehold)},
                ${r.assetMax}, ${r.carValueMax}, ${tx.json(r.extra as never)}, ${r.sourceClause}, false)`;
    }

    const existing = await tx<{ kind: CollectedSchedule['kind']; starts_at: Date; ends_at: Date | null; all_day: boolean }[]>`
      select kind, starts_at, ends_at, all_day from schedules where notice_id = ${n.id}`;
    const haveKinds = new Set(existing.map(s => s.kind));
    const added = withSeq(conv.schedules.filter(s => !haveKinds.has(s.kind)));
    for (const s of added) {
      await tx`
        insert into schedules (notice_id, kind, seq, starts_at, ends_at, all_day, note)
        values (${n.id}, ${s.kind}, ${s.seq}, ${s.startsAt}, ${s.endsAt}, ${s.allDay}, ${s.note})
        on conflict (notice_id, kind, seq) do nothing`;
    }

    let status = cur.status;
    if (cur.status !== 'cancelled' && added.some(s => s.kind === 'apply_start' || s.kind === 'apply_end')) {
      const all: CollectedSchedule[] = [
        ...existing.map(s => ({
          kind: s.kind, startsAt: s.starts_at.toISOString(), endsAt: s.ends_at?.toISOString() ?? null, allDay: s.all_day, note: null,
        })),
        ...added,
      ];
      status = statusFromSchedules(all, now) ?? cur.status;
    }
    await tx`
      update notices set parse_status = 'llm_parsed', parsed_hash = ${cur.content_hash}, status = ${status}
      where id = ${n.id}`;
    return 'saved';
  });
}

/** 다시 시도해도 안 될 실패(본문이 너무 김 등)는 parsed_hash 를 채워 다음 실행에서 건너뛴다 */
async function markGiveUp(sql: Sql, n: QueueRow, model: string, hash: string, reason: string): Promise<void> {
  await sql.begin(async tx => {
    await tx`
      insert into notice_parses (notice_id, model, prompt_version, input_hash, output)
      values (${n.id}, ${model}, ${PROMPT_VERSION}, ${hash}, ${tx.json({ error: reason })})`;
    await tx`update notices set parsed_hash = content_hash where id = ${n.id} and content_hash is not distinct from ${n.content_hash}`;
  });
}

export async function parsePending(sql: Sql, o: ParseOptions): Promise<ParseCounts> {
  const counts: ParseCounts = { parsed: 0, cached: 0, skipped: 0, failed: 0 };
  const rows = await queue(sql, o);
  const now = o.now ?? new Date();
  if (rows.length === 0) { o.log('[parse] 정리할 공고 없음'); return counts; }
  o.log(`[parse] ${rows.length}건 정리 시작(${o.model}, 프롬프트 ${PROMPT_VERSION})`);

  for (const n of rows) {
    const hash = inputHash(o.model, n);
    let out = await cachedOutput(sql, n.id, hash);
    const fromCache = out !== null;
    if (!out) {
      try {
        out = await o.extractor({ title: n.title, publishedAt: n.published_at, rawText: n.raw_text });
      } catch (e) {
        counts.failed++;
        const msg = (e as Error).message;
        o.log(`  실패 ${n.title}: ${msg}`);
        const permanent = e instanceof ParseError || e instanceof Anthropic.BadRequestError;
        if (permanent && !o.dryRun) await markGiveUp(sql, n, o.model, hash, msg);
        // 키가 틀렸으면 나머지도 다 실패하므로 멈춘다
        if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) break;
        continue;
      }
    }
    const conv = convertExtraction(out.extraction, o.regions);
    const summary = `일정 ${conv.schedules.length} · 자격 ${conv.rules.length}${conv.warnings.length ? ` · 경고 ${conv.warnings.length}` : ''}`;
    if (o.dryRun) {
      o.log(`  ${n.title}: ${summary}`);
      o.log(JSON.stringify({ ...conv, notes: out.extraction.notes }, null, 2));
      counts.parsed++;
      continue;
    }
    const r = await save(sql, n, out, conv, hash, now, Boolean(o.ids?.length));
    if (r === 'stale') { counts.skipped++; o.log(`  건너뜀 ${n.title}: 정리 중에 본문·검수 상태가 바뀜`); continue; }
    if (fromCache) counts.cached++; else counts.parsed++;
    o.log(`  ${n.title}: ${summary}${fromCache ? ' (이전 결과 재사용)' : ''}`);
  }
  o.log(`[parse] 정리 ${counts.parsed} · 재사용 ${counts.cached} · 건너뜀 ${counts.skipped} · 실패 ${counts.failed}`);
  return counts;
}
