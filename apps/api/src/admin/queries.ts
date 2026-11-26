// 검수 화면 쿼리. 공개 조회(src/queries.ts)와 달리 parse_status 와 상관없이 모든 공고를 다룬다.
import type { Sql } from '@yh/db';
import type { HousingType, NoticeStatus } from '@yh/schema/constants';
import { visible, type Visibility } from '../queries.js';
import { emptyRule, formatIncomePct, wonToMan, EXTRA_KEYS, type NoticeForm, type NoticeInput, type RuleForm } from './form.js';

export type QueueTab = 'queue' | 'recheck' | 'verified' | 'rejected';
export const QUEUE_TABS: QueueTab[] = ['queue', 'recheck', 'verified', 'rejected'];
export type ParseStatus = 'pending' | 'llm_parsed' | 'verified' | 'rejected';

export interface RegionRow { code: string; sido: string; sigungu: string | null }

const tabWhere = (sql: Sql, tab: QueueTab) => {
  switch (tab) {
    case 'queue': return sql`n.parse_status in ('pending', 'llm_parsed')`;
    case 'recheck': return sql`n.parse_status = 'verified' and n.content_hash is distinct from n.verified_content_hash`;
    case 'verified': return sql`n.parse_status = 'verified'`;
    case 'rejected': return sql`n.parse_status = 'rejected'`;
  }
};

export async function queueCounts(sql: Sql): Promise<Record<QueueTab, number>> {
  const [r] = await sql<Record<QueueTab, string>[]>`
    select
      count(*) filter (where parse_status in ('pending', 'llm_parsed')) as queue,
      count(*) filter (where parse_status = 'verified' and content_hash is distinct from verified_content_hash) as recheck,
      count(*) filter (where parse_status = 'verified') as verified,
      count(*) filter (where parse_status = 'rejected') as rejected
    from notices`;
  return { queue: Number(r!.queue), recheck: Number(r!.recheck), verified: Number(r!.verified), rejected: Number(r!.rejected) };
}

export interface QueueItem {
  id: string;
  title: string;
  housingType: HousingType;
  parseStatus: ParseStatus;
  sourceName: string;
  publishedAt: string | null;
  applyStart: string | null;   // KST YYYY-MM-DD
  applyEnd: string | null;
  scheduleCount: number;
  ruleCount: number;
  collectedAt: string;         // KST YYYY-MM-DD HH:MM
  verifiedBy: string | null;
  verifiedAt: string | null;
  reviewNote: string | null;
  /** 지금 공개 화면(앱)에 나오는지 */
  exposed: boolean;
}

const kstDate = (sql: Sql, col: string) => sql`to_char(${sql.unsafe(col)} at time zone 'Asia/Seoul', 'YYYY-MM-DD')`;
const kstDateTime = (sql: Sql, col: string) => sql`to_char(${sql.unsafe(col)} at time zone 'Asia/Seoul', 'YYYY-MM-DD HH24:MI')`;

/** 대기열은 접수 시작이 빠른(급한) 순, 나머지는 최근 순 */
export async function listQueue(sql: Sql, tab: QueueTab, q: string | null, limit: number, offset: number, v: Visibility):
  Promise<{ items: QueueItem[]; hasMore: boolean }> {
  const like = q ? `%${q.replace(/[\\%_]/g, m => `\\${m}`)}%` : null;
  const rows = await sql<{
    id: string; title: string; housing_type: HousingType; parse_status: ParseStatus; source_name: string;
    published_at: string | null; apply_start: string | null; apply_end: string | null; schedule_count: number;
    rule_count: number; collected_at: string; verified_by: string | null; verified_at: string | null; review_note: string | null;
    exposed: boolean;
  }[]>`
    select n.id, n.title, n.housing_type, n.parse_status, src.name as source_name,
           to_char(n.published_at, 'YYYY-MM-DD') as published_at,
           (select ${kstDate(sql, 's.starts_at')} from schedules s
             where s.notice_id = n.id and s.kind = 'apply_start' order by s.seq limit 1) as apply_start,
           (select ${kstDate(sql, 's.starts_at')} from schedules s
             where s.notice_id = n.id and s.kind = 'apply_end' order by s.seq desc limit 1) as apply_end,
           (select count(*)::int from schedules s where s.notice_id = n.id) as schedule_count,
           (select count(*)::int from eligibility_rules r where r.notice_id = n.id) as rule_count,
           ${kstDateTime(sql, 'n.created_at')} as collected_at,
           n.verified_by, ${kstDateTime(sql, 'n.verified_at')} as verified_at, n.review_note,
           (${visible(sql, v)}) as exposed
    from notices n join sources src on src.id = n.source_id
    where ${tabWhere(sql, tab)}
      and (${like}::text is null or n.title ilike ${like} or n.external_id = ${q})
    order by
      ${tab === 'queue'
        ? sql`(select min(s.starts_at) from schedules s where s.notice_id = n.id and s.kind in ('apply_start', 'apply_end')) nulls last, n.created_at`
        : tab === 'recheck' ? sql`n.updated_at desc` : sql`coalesce(n.verified_at, n.updated_at) desc`},
      n.id
    limit ${limit + 1} offset ${offset}`;
  return {
    hasMore: rows.length > limit,
    items: rows.slice(0, limit).map(r => ({
      id: r.id, title: r.title, housingType: r.housing_type, parseStatus: r.parse_status, sourceName: r.source_name,
      publishedAt: r.published_at, applyStart: r.apply_start, applyEnd: r.apply_end, scheduleCount: r.schedule_count,
      ruleCount: r.rule_count, collectedAt: r.collected_at, verifiedBy: r.verified_by, verifiedAt: r.verified_at,
      reviewNote: r.review_note, exposed: r.exposed,
    })),
  };
}

export async function loadRegions(sql: Sql): Promise<RegionRow[]> {
  return sql<RegionRow[]>`select code, sido, sigungu from regions order by code`;
}

/**
 * 고른 지역에 시도 코드(XX000)와 상위 시 코드(영통구 → 수원시)를 붙인다.
 * 공개 캘린더의 지역 필터가 시도·시 코드로도 걸리게 하려는 것(수집기와 같은 모양).
 */
export function expandRegionCodes(selected: string[], regions: RegionRow[]): string[] {
  const out = new Set<string>();
  for (const code of selected) {
    const r = regions.find(x => x.code === code);
    if (!r) continue;
    out.add(code);
    const sido = regions.find(x => x.sido === r.sido && x.sigungu === null);
    if (sido) out.add(sido.code);
    if (r.sigungu?.includes(' ')) {
      const city = regions.find(x => x.sido === r.sido && x.sigungu === r.sigungu!.split(' ')[0]);
      if (city) out.add(city.code);
    }
  }
  return [...out].sort();
}

/**
 * 저장된 region_codes → 화면 체크 상태. 자동으로 붙는 상위 코드(시도, 상위 시)는
 * 그 아래 지역이 같이 있으면 빼서 보여 준다.
 */
export function selectedRegionCodes(stored: string[], regions: RegionRow[]): string[] {
  const set = new Set(stored);
  return stored.filter(code => {
    const r = regions.find(x => x.code === code);
    if (!r) return true;
    return !regions.some(x => x.code !== code && set.has(x.code) && x.sido === r.sido &&
      (r.sigungu === null ? x.sigungu !== null : x.sigungu?.startsWith(r.sigungu + ' ')));
  }).sort();
}

export interface NoticeMeta {
  id: string;
  externalId: string;
  sourceName: string;
  parseStatus: ParseStatus;
  status: NoticeStatus;
  rawText: string | null;
  contentHash: string | null;
  bodyChangedSinceApproval: boolean;
  verifiedAt: string | null;
  verifiedBy: string | null;
  collectedAt: string;
  updatedAt: string;
}

export interface UnitRow {
  targetGroup: string; unitType: string | null; areaM2: string | null; deposit: string | null;
  monthlyRent: string | null; supplyCount: number | null; complexName: string | null; note: string | null;
}

export interface LoadedNotice {
  meta: NoticeMeta;
  form: NoticeForm;
  units: UnitRow[];
  latestParse: { model: string; createdAt: string; output: unknown } | null;
}

export async function loadNotice(sql: Sql, id: string, regions: RegionRow[]): Promise<LoadedNotice | null> {
  const [n] = await sql<{
    id: string; external_id: string; source_name: string; parse_status: ParseStatus; status: NoticeStatus;
    title: string; housing_type: string; url_original: string; url_apply: string | null; published_at: string | null;
    region_codes: string[]; raw_text: string | null; content_hash: string | null; changed: boolean;
    verified_at: string | null; verified_by: string | null; review_note: string | null;
    collected_at: string; updated_at: string;
  }[]>`
    select n.id, n.external_id, src.name as source_name, n.parse_status, n.status, n.title, n.housing_type,
           n.url_original, n.url_apply, to_char(n.published_at, 'YYYY-MM-DD') as published_at, n.region_codes,
           n.raw_text, n.content_hash,
           (n.parse_status = 'verified' and n.content_hash is distinct from n.verified_content_hash) as changed,
           ${kstDateTime(sql, 'n.verified_at')} as verified_at, n.verified_by, n.review_note,
           ${kstDateTime(sql, 'n.created_at')} as collected_at, ${kstDateTime(sql, 'n.updated_at')} as updated_at
    from notices n join sources src on src.id = n.source_id
    where n.id = ${id}`;
  if (!n) return null;

  const [schedules, rules, units, parses] = await Promise.all([
    sql<{ kind: string; date: string; time: string; end_date: string | null; end_time: string | null; all_day: boolean; note: string | null }[]>`
      select kind, ${kstDate(sql, 'starts_at')} as date,
             to_char(starts_at at time zone 'Asia/Seoul', 'HH24:MI') as time,
             ${kstDate(sql, 'ends_at')} as end_date,
             to_char(ends_at at time zone 'Asia/Seoul', 'HH24:MI') as end_time,
             all_day, note
      from schedules where notice_id = ${id} order by starts_at, kind, seq`,
    sql<{
      target_group: string; variant: string; age_min: number | null; age_max: number | null; age_ref_date: string | null;
      residence_codes: string[] | null; homeless_scope: string | null; income_basis: string | null; income_year: number | null;
      income_pct_by_household: Record<string, number> | null; asset_max: string | null; car_value_max: string | null;
      extra: Record<string, unknown>; source_clause: string | null;
    }[]>`
      select target_group, variant, age_min, age_max, to_char(age_ref_date, 'YYYY-MM-DD') as age_ref_date,
             residence_codes, homeless_scope, income_basis, income_year, income_pct_by_household,
             asset_max, car_value_max, extra, source_clause
      from eligibility_rules where notice_id = ${id} order by target_group, variant`,
    sql<{
      target_group: string; unit_type: string | null; area_m2: string | null; deposit: string | null;
      monthly_rent: string | null; supply_count: number | null; complex_name: string | null; note: string | null;
    }[]>`
      select u.target_group, u.unit_type, u.area_m2, u.deposit, u.monthly_rent, u.supply_count, c.name as complex_name, u.note
      from notice_units u left join complexes c on c.id = u.complex_id
      where u.notice_id = ${id} order by c.name nulls last, u.target_group, u.area_m2 nulls last`,
    sql<{ model: string; created_at: string; output: unknown }[]>`
      select model, ${kstDateTime(sql, 'created_at')} as created_at, output
      from notice_parses where notice_id = ${id} order by created_at desc limit 1`,
  ]);

  const form: NoticeForm = {
    title: n.title, housingType: n.housing_type, urlOriginal: n.url_original, urlApply: n.url_apply ?? '',
    publishedAt: n.published_at ?? '', cancelled: n.status === 'cancelled',
    regionCodes: selectedRegionCodes(n.region_codes, regions), reviewNote: n.review_note ?? '',
    schedules: schedules.map(s => ({
      kind: s.kind, date: s.date, time: s.all_day ? '' : s.time,
      endDate: s.end_date ?? '',
      endTime: s.all_day || !s.end_time ? '' : s.end_time,
      note: s.note ?? '', del: false,
    })),
    rules: rules.map((r): RuleForm => ({
      ...emptyRule(),
      targetGroup: r.target_group, variant: r.variant,
      ageMin: r.age_min?.toString() ?? '', ageMax: r.age_max?.toString() ?? '', ageRefDate: r.age_ref_date ?? '',
      residenceCodes: (r.residence_codes ?? []).join(', '), homelessScope: r.homeless_scope ?? '',
      incomeBasis: r.income_basis ?? '', incomeYear: r.income_year?.toString() ?? '',
      incomePct: formatIncomePct(r.income_pct_by_household),
      assetMaxMan: wonToMan(r.asset_max === null ? null : Number(r.asset_max)),
      carMaxMan: wonToMan(r.car_value_max === null ? null : Number(r.car_value_max)),
      extra: Object.fromEntries(EXTRA_KEYS.map(k => [k, r.extra?.[k] === true])) as RuleForm['extra'],
      sourceClause: r.source_clause ?? '',
    })),
  };

  return {
    meta: {
      id: n.id, externalId: n.external_id, sourceName: n.source_name, parseStatus: n.parse_status, status: n.status,
      rawText: n.raw_text, contentHash: n.content_hash, bodyChangedSinceApproval: n.changed,
      verifiedAt: n.verified_at, verifiedBy: n.verified_by, collectedAt: n.collected_at, updatedAt: n.updated_at,
    },
    form,
    units: units.map(u => ({
      targetGroup: u.target_group, unitType: u.unit_type, areaM2: u.area_m2, deposit: u.deposit,
      monthlyRent: u.monthly_rent, supplyCount: u.supply_count, complexName: u.complex_name, note: u.note,
    })),
    latestParse: parses[0] ? { model: parses[0].model, createdAt: parses[0].created_at, output: parses[0].output } : null,
  };
}

export type SaveAction = 'save' | 'approve';

/**
 * 공고 필드·일정·규칙 저장.
 * - approve: 검수 완료로 바꾸고, 검수자가 본 본문 해시(seenHash)를 승인본으로 남긴다.
 *   검수 중에 수집기가 본문을 바꿨다면 해시가 달라 곧바로 "다시 확인"에 뜬다. 규칙도 모두 확인됨으로 둔다.
 * - save: 상태는 그대로(검수 완료 공고는 approve 로만 저장한다).
 * 일정은 (kind, seq) 로 upsert 해서 id 를 유지한다(나중에 붙을 알림이 지워지지 않게).
 */
export async function saveNotice(
  sql: Sql, id: string, input: NoticeInput, regions: RegionRow[],
  o: { action: SaveAction; reviewer: string; seenHash: string | null },
): Promise<'ok' | 'not_found'> {
  const regionCodes = expandRegionCodes(input.regionCodes, regions);
  return sql.begin(async tx => {
    const [cur] = await tx<{ status: NoticeStatus }[]>`select status from notices where id = ${id} for update`;
    if (!cur) return 'not_found' as const;

    const status: NoticeStatus = input.cancelled ? 'cancelled' : cur.status === 'cancelled' ? 'upcoming' : cur.status;
    const approve = o.action === 'approve';
    await tx`
      update notices set
        title = ${input.title}, housing_type = ${input.housingType}, url_original = ${input.urlOriginal},
        url_apply = ${input.urlApply}, published_at = ${input.publishedAt}, status = ${status},
        region_codes = ${regionCodes}, review_note = ${input.reviewNote}
        ${approve ? tx`, parse_status = 'verified', verified_at = now(), verified_by = ${o.reviewer},
                       verified_content_hash = ${o.seenHash}` : tx``}
      where id = ${id}`;

    for (const s of input.schedules) {
      await tx`
        insert into schedules (notice_id, kind, seq, starts_at, ends_at, all_day, note)
        values (${id}, ${s.kind}, ${s.seq}, ${s.startsAt}, ${s.endsAt}, ${s.allDay}, ${s.note})
        on conflict (notice_id, kind, seq) do update set
          starts_at = excluded.starts_at, ends_at = excluded.ends_at, all_day = excluded.all_day, note = excluded.note`;
    }
    const keep = input.schedules.map(s => `${s.kind}:${s.seq}`);
    await tx`
      delete from schedules
      where notice_id = ${id} and not ((kind::text || ':' || seq::text) = any(${keep}::text[]))`;
    // TODO(알림): 일정 날짜가 바뀌면 pending 알림의 send_at 다시 계산(알림 생성 루프가 생길 때)

    await tx`delete from eligibility_rules where notice_id = ${id}`;
    for (const r of input.rules) {
      await tx`
        insert into eligibility_rules (notice_id, target_group, variant, age_min, age_max, age_ref_date, residence_codes,
                                       homeless_scope, income_basis, income_year, income_pct_by_household,
                                       asset_max, car_value_max, extra, source_clause, verified)
        values (${id}, ${r.targetGroup}, ${r.variant}, ${r.ageMin}, ${r.ageMax}, ${r.ageRefDate}, ${r.residenceCodes},
                ${r.homelessScope}, ${r.incomeBasis}, ${r.incomeYear},
                ${r.incomePctByHousehold === null ? null : tx.json(r.incomePctByHousehold)},
                ${r.assetMax}, ${r.carValueMax}, ${tx.json(r.extra)}, ${r.sourceClause}, ${approve})`;
    }
    return 'ok' as const;
  });
}

/** 반려(메모만 저장) 또는 검수 대기로 되돌리기(공개 내리기) */
export async function setReviewState(
  sql: Sql, id: string, to: 'rejected' | 'pending', note: string | null, reviewer: string,
): Promise<boolean> {
  const rows = await sql`
    update notices set parse_status = ${to}, review_note = ${note},
      verified_at = ${to === 'rejected' ? sql`now()` : null},
      verified_by = ${to === 'rejected' ? reviewer : null},
      verified_content_hash = null
    where id = ${id} returning id`;
  return rows.length > 0;
}
