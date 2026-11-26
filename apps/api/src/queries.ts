// 공개 조회 쿼리. 화면에는 검수 완료(verified) 공고만 보인다.
// PUBLIC_SHOW_UNVERIFIED=1 이면 미검수(pending·llm_parsed)도 보여 준다(개발·수집 결과 확인용, 운영 금지).
import type { Sql } from '@yh/db';
import type {
  CalendarItem, EligibilityRule, HousingType, IncomeStandard, NoticeDetail, NoticeStatus,
  NoticeSummary, NoticeUnitView, RegionView, ScheduleView,
} from '@yh/schema';

export interface PublicFilter {
  regions: string[] | null;
  types: HousingType[] | null;
  showUnverified: boolean;
}

/** parse_status 조건. rejected 는 언제나 뺀다 */
const visible = (sql: Sql, f: PublicFilter) =>
  f.showUnverified ? sql`n.parse_status <> 'rejected'` : sql`n.parse_status = 'verified'`;

const filters = (sql: Sql, f: PublicFilter) => sql`
  ${visible(sql, f)}
  and (${f.regions}::text[] is null or n.region_codes && ${f.regions}::text[])
  and (${f.types}::housing_type[] is null or n.housing_type = any(${f.types}::housing_type[]))`;

/** 한국시간 날짜 문자열 */
const kstDate = (sql: Sql, col: string) =>
  sql`to_char(${sql.unsafe(col)} at time zone 'Asia/Seoul', 'YYYY-MM-DD')`;

/**
 * 수집기가 하루 한 번만 status 를 갱신하므로, 접수 시작·마감 일정이 있으면 지금 시각으로 다시 계산한다.
 * 마감이 날짜만 있으면 그날(KST) 24시까지 접수 중으로 본다(collector/lib/status.ts 와 같은 규칙).
 */
const statusExpr = (sql: Sql) => sql`
  case
    when n.status = 'cancelled' then 'cancelled'
    when ap.start_at is null then n.status::text
    when now() < ap.start_at then 'upcoming'
    when now() < ap.end_at then 'open'
    else 'closed'
  end`;

const applyLateral = (sql: Sql) => sql`
  left join lateral (
    select
      (select s.starts_at from schedules s where s.notice_id = n.id and s.kind = 'apply_start' order by s.seq limit 1) as start_at,
      coalesce(
        (select case when s.all_day
                     then ((s.starts_at at time zone 'Asia/Seoul')::date + 1)::timestamp at time zone 'Asia/Seoul'
                     else s.starts_at end
           from schedules s where s.notice_id = n.id and s.kind = 'apply_end' order by s.seq desc limit 1),
        (select ((s.starts_at at time zone 'Asia/Seoul')::date + 1)::timestamp at time zone 'Asia/Seoul'
           from schedules s where s.notice_id = n.id and s.kind = 'apply_start' order by s.seq limit 1)
      ) as end_at
  ) ap on true`;

interface ScheduleRow {
  id: string; kind: ScheduleView['kind']; seq: number; starts_at: Date; ends_at: Date | null;
  start_date: string; end_date: string; all_day: boolean; note: string | null;
}
const scheduleView = (r: ScheduleRow): ScheduleView => ({
  id: r.id, kind: r.kind, seq: r.seq,
  startsAt: r.starts_at.toISOString(), endsAt: r.ends_at?.toISOString() ?? null,
  startDate: r.start_date, endDate: r.end_date, allDay: r.all_day, note: r.note,
});

/** 기간 [from, to) 에 걸치는 일정 */
export async function calendar(sql: Sql, from: Date, to: Date, f: PublicFilter): Promise<CalendarItem[]> {
  const rows = await sql<(ScheduleRow & {
    notice_id: string; title: string; housing_type: HousingType; status: NoticeStatus;
    url_original: string; url_apply: string | null;
  })[]>`
    select s.id, s.kind, s.seq, s.starts_at, s.ends_at, s.all_day, s.note,
           ${kstDate(sql, 's.starts_at')} as start_date,
           ${kstDate(sql, 'coalesce(s.ends_at, s.starts_at)')} as end_date,
           n.id as notice_id, n.title, n.housing_type, ${statusExpr(sql)} as status,
           n.url_original, n.url_apply
    from schedules s
    join notices n on n.id = s.notice_id
    ${applyLateral(sql)}
    where ${filters(sql, f)}
      and s.starts_at < ${to}
      and coalesce(s.ends_at, s.starts_at) >= ${from}
    order by s.starts_at, s.kind, n.title`;
  return rows.map(r => ({
    ...scheduleView(r), scheduleId: r.id, noticeId: r.notice_id, title: r.title,
    housingType: r.housing_type, status: r.status, urlOriginal: r.url_original, urlApply: r.url_apply,
  })).map(({ id: _id, ...rest }) => rest);
}

interface SummaryRow {
  id: string; title: string; housing_type: HousingType; status: NoticeStatus; published_at: string | null;
  region_codes: string[]; region_names: string[]; source_name: string;
  url_original: string; url_apply: string | null;
  apply_start: ScheduleRow | null; apply_end: ScheduleRow | null;
}

const scheduleJson = (sql: Sql, kind: 'apply_start' | 'apply_end') => sql`
  (select json_build_object(
            'id', s.id, 'kind', s.kind, 'seq', s.seq, 'starts_at', s.starts_at, 'ends_at', s.ends_at,
            'start_date', ${kstDate(sql, 's.starts_at')}, 'end_date', ${kstDate(sql, 'coalesce(s.ends_at, s.starts_at)')},
            'all_day', s.all_day, 'note', s.note)
     from schedules s where s.notice_id = n.id and s.kind = ${kind}
     order by s.seq ${kind === 'apply_end' ? sql`desc` : sql``} limit 1)`;

const summarySelect = (sql: Sql) => sql`
  select n.id, n.title, n.housing_type, ${statusExpr(sql)} as status,
         to_char(n.published_at, 'YYYY-MM-DD') as published_at,
         n.region_codes,
         coalesce((select array_agg(coalesce(r.sigungu, r.sido) order by r.code)
                     from regions r
                    where r.code = any(n.region_codes)
                      -- 더 좁은 지역이 같이 붙어 있으면 넓은 쪽(시도 전체, 구가 있는 시)은 이름에서 뺀다
                      and not exists (
                            select 1 from regions r2
                             where r2.code = any(n.region_codes) and r2.code <> r.code and r2.sido = r.sido
                               and (r.sigungu is null or r2.sigungu like r.sigungu || ' %'))), '{}') as region_names,
         regexp_replace(src.name, '\s*(분양임대공고\s*)?API$', '') as source_name, n.url_original, n.url_apply,
         ${scheduleJson(sql, 'apply_start')} as apply_start,
         ${scheduleJson(sql, 'apply_end')} as apply_end
  from notices n
  join sources src on src.id = n.source_id
  ${applyLateral(sql)}`;

const jsonSchedule = (j: ScheduleRow | null): ScheduleView | null =>
  j ? scheduleView({ ...j, starts_at: new Date(j.starts_at), ends_at: j.ends_at ? new Date(j.ends_at) : null }) : null;

const summaryView = (r: SummaryRow): NoticeSummary => ({
  id: r.id, title: r.title, housingType: r.housing_type, status: r.status, publishedAt: r.published_at,
  regionCodes: r.region_codes, regionNames: r.region_names, sourceName: r.source_name,
  urlOriginal: r.url_original, urlApply: r.url_apply,
  applyStart: jsonSchedule(r.apply_start), applyEnd: jsonSchedule(r.apply_end),
});

export interface ListOptions extends PublicFilter {
  statuses: NoticeStatus[] | null;
  q: string | null;
  limit: number;
  offset: number;
}

/** 접수 중(마감 임박 순) → 접수 예정(시작 빠른 순) → 마감(최근 순) */
export async function listNotices(sql: Sql, o: ListOptions): Promise<{ items: NoticeSummary[]; hasMore: boolean }> {
  const like = o.q ? `%${o.q.replace(/[\\%_]/g, m => `\\${m}`)}%` : null;
  const rows = await sql<(SummaryRow & { sort_status: number })[]>`
    select * from (
      ${summarySelect(sql)}
      where ${filters(sql, o)}
        and (${like}::text is null or n.title ilike ${like})
    ) t
    where (${o.statuses}::text[] is null or t.status = any(${o.statuses}::text[]))
    order by
      case t.status when 'open' then 0 when 'upcoming' then 1 when 'closed' then 2 else 3 end,
      case t.status
        when 'open'     then extract(epoch from (t.apply_end->>'starts_at')::timestamptz)
        when 'upcoming' then extract(epoch from (t.apply_start->>'starts_at')::timestamptz)
        else -extract(epoch from coalesce((t.apply_end->>'starts_at')::timestamptz, t.published_at::timestamptz))
      end nulls last,
      t.published_at desc nulls last, t.id
    limit ${o.limit + 1} offset ${o.offset}`;
  return { items: rows.slice(0, o.limit).map(summaryView), hasMore: rows.length > o.limit };
}

export async function getNotice(sql: Sql, id: string, showUnverified: boolean): Promise<NoticeDetail | null> {
  const f: PublicFilter = { regions: null, types: null, showUnverified };
  const [row] = await sql<SummaryRow[]>`${summarySelect(sql)} where n.id = ${id} and ${visible(sql, f)}`;
  if (!row) return null;

  const [schedules, units, rules] = await Promise.all([
    sql<ScheduleRow[]>`
      select s.id, s.kind, s.seq, s.starts_at, s.ends_at, s.all_day, s.note,
             ${kstDate(sql, 's.starts_at')} as start_date,
             ${kstDate(sql, 'coalesce(s.ends_at, s.starts_at)')} as end_date
      from schedules s where s.notice_id = ${id} order by s.starts_at, s.kind, s.seq`,
    sql<{
      id: string; target_group: NoticeUnitView['targetGroup']; unit_type: string | null; area_m2: string | null;
      deposit: string | null; monthly_rent: string | null; supply_count: number | null; note: string | null;
      complex_id: string | null; complex_name: string | null; address: string | null; nearest_station: string | null;
    }[]>`
      select u.id, u.target_group, u.unit_type, u.area_m2, u.deposit, u.monthly_rent, u.supply_count, u.note,
             c.id as complex_id, c.name as complex_name, c.address, c.nearest_station
      from notice_units u left join complexes c on c.id = u.complex_id
      where u.notice_id = ${id}
      order by c.name nulls last, u.target_group, u.area_m2 nulls last, u.unit_type`,
    sql<{
      target_group: EligibilityRule['targetGroup']; variant: string; age_min: number | null; age_max: number | null;
      age_ref_date: string | null; residence_codes: string[] | null; homeless_scope: EligibilityRule['homelessScope'];
      income_basis: EligibilityRule['incomeBasis']; income_year: number | null;
      income_pct_by_household: Record<string, number> | null; asset_max: string | null; car_value_max: string | null;
      extra: EligibilityRule['extra']; source_clause: string | null; verified: boolean;
    }[]>`
      select target_group, variant, age_min, age_max, to_char(age_ref_date, 'YYYY-MM-DD') as age_ref_date,
             residence_codes, homeless_scope, income_basis, income_year, income_pct_by_household,
             asset_max, car_value_max, extra, source_clause, verified
      from eligibility_rules where notice_id = ${id} order by target_group, variant`,
  ]);

  const num = (v: string | null) => (v === null ? null : Number(v));
  const ruleViews: EligibilityRule[] = rules.map(r => ({
    targetGroup: r.target_group, variant: r.variant, ageMin: r.age_min, ageMax: r.age_max,
    ageRefDate: r.age_ref_date, residenceCodes: r.residence_codes, homelessScope: r.homeless_scope,
    incomeBasis: r.income_basis, incomeYear: r.income_year, incomePctByHousehold: r.income_pct_by_household,
    assetMax: num(r.asset_max), carValueMax: num(r.car_value_max), extra: r.extra ?? {},
    sourceClause: r.source_clause, verified: r.verified,
  }));

  const keys = [...new Set(ruleViews.filter(r => r.incomeBasis && r.incomeYear).map(r => `${r.incomeYear}:${r.incomeBasis}`))];
  const incomeStandards = keys.length === 0 ? [] : await sql<{
    year: number; basis: IncomeStandard['basis']; variant: string; household_size: number; monthly_amount: string;
  }[]>`
    select year, basis, variant, household_size, monthly_amount from income_standards
    where (year::text || ':' || basis::text) = any(${keys}::text[])
    order by year, basis, variant, household_size`;

  return {
    ...summaryView(row),
    schedules: schedules.map(scheduleView),
    units: units.map(u => ({
      id: u.id, targetGroup: u.target_group, unitType: u.unit_type, areaM2: num(u.area_m2),
      deposit: num(u.deposit), monthlyRent: num(u.monthly_rent), supplyCount: u.supply_count, note: u.note,
      complex: u.complex_id
        ? { id: u.complex_id, name: u.complex_name!, address: u.address, nearestStation: u.nearest_station }
        : null,
    })),
    rules: ruleViews,
    incomeStandards: incomeStandards.map(s => ({
      year: s.year, basis: s.basis, variant: s.variant, householdSize: s.household_size, monthlyAmount: Number(s.monthly_amount),
    })),
  };
}

export async function listRegions(sql: Sql): Promise<RegionView[]> {
  return sql<RegionView[]>`select code, sido, sigungu from regions order by code`;
}
