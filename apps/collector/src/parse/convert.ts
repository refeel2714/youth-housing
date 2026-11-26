// Claude 응답(Extraction) → DB 에 넣을 일정·자격 규칙. 순수 함수만 둔다(테스트 대상).
// 응답 모양은 structured outputs 가 보장하지만 값의 범위·형식은 여기서 한 번 더 거른다.
// 이상한 값은 고치지 않고 버리고, 버린 이유를 warnings 에 남긴다(검수 화면 "자동 정리 결과"에 같이 보인다).
import type { RuleExtra, TargetGroup, HomelessScope, IncomeBasis } from '@yh/schema';
import { toKstIso } from '../lib/dates.js';
import type { RegionResolver } from '../lib/regions.js';
import type { CollectedSchedule } from '../sources/types.js';
import type { ExtractedRule, ExtractedSchedule, Extraction } from './extraction.js';

export interface RuleRow {
  targetGroup: TargetGroup;
  variant: string;
  ageMin: number | null;
  ageMax: number | null;
  ageRefDate: string | null;
  residenceCodes: string[] | null;
  homelessScope: HomelessScope | null;
  incomeBasis: IncomeBasis | null;
  incomeYear: number | null;
  incomePctByHousehold: Record<string, number> | null;
  assetMax: number | null;
  carValueMax: number | null;
  extra: RuleExtra;
  sourceClause: string | null;
}

export interface Converted {
  schedules: CollectedSchedule[];
  rules: RuleRow[];
  warnings: string[];
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-4]):[0-5]\d$/;

function validDate(s: string | null): s is string {
  if (!s || !DATE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** 24:00 은 다음 날 00:00 대신 23:59 로 둔다(마감 시각 표기) */
const normTime = (t: string | null) => (t && TIME.test(t) ? (t === '24:00' ? '23:59' : t) : null);

function convertSchedule(s: ExtractedSchedule, warn: (m: string) => void): CollectedSchedule | null {
  if (!validDate(s.date)) { warn(`일정 날짜 형식 오류(${s.label}: ${s.date})`); return null; }
  const time = normTime(s.time);
  const startsAt = toKstIso({ date: s.date, time });
  let endsAt: string | null = null;
  if (s.endDate !== null) {
    if (!validDate(s.endDate)) warn(`일정 끝 날짜 형식 오류(${s.label}: ${s.endDate})`);
    else {
      // 종일 일정의 끝 날짜는 그날 00:00 으로 넣는다(수집기 규칙과 같게)
      // 시작에 시각이 있는데 끝 시각이 없으면 그날 끝(23:59)까지로 본다
      const end = toKstIso({ date: s.endDate, time: time ? normTime(s.endTime) ?? '23:59' : null });
      if (new Date(end) >= new Date(startsAt)) endsAt = end;
      else warn(`일정 끝이 시작보다 빠름(${s.label})`);
    }
  }
  return { kind: s.kind, startsAt, endsAt, allDay: time === null, note: s.label.slice(0, 100) || null };
}

/** 같은 종류·같은 시각 중복 제거, 시간순 */
function dedupeSchedules(list: CollectedSchedule[]): CollectedSchedule[] {
  const seen = new Set<string>();
  return list
    .filter(s => {
      const k = `${s.kind}|${s.startsAt}|${s.endsAt ?? ''}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
}

function convertRule(r: ExtractedRule, regions: RegionResolver, warn: (m: string) => void): RuleRow | null {
  const label = `${r.targetGroup}${r.variant ? `/${r.variant}` : ''}`;
  const int = (n: number | null) => (n === null || !Number.isFinite(n) ? null : Math.round(n));
  const age = (raw: number | null, what: string) => {
    const n = int(raw);
    if (n === null) return null;
    if (n < 10 || n > 80) { warn(`${label}: 나이 ${what} ${n} 무시`); return null; }
    return n;
  };
  let ageMin = age(r.ageMin, '하한');
  let ageMax = age(r.ageMax, '상한');
  if (ageMin !== null && ageMax !== null && ageMin > ageMax) {
    warn(`${label}: 나이 하한 > 상한, 둘 다 무시`);
    ageMin = null; ageMax = null;
  }

  const residence: string[] = [];
  for (const name of r.residence) {
    const codes = regions.resolveAddress(name);
    // resolveAddress 는 [시군구, 시도] 또는 [시도]. 가장 좁은 코드 하나만 거주 요건으로 쓴다
    if (codes[0]) residence.push(codes[0]);
    else warn(`${label}: 거주 요건 지역 "${name}"을(를) 코드로 못 바꿈`);
  }
  // 지역 이름을 하나도 못 바꿨는데 요건은 있다면, 조건 없음으로 판정되지 않게 규칙을 버린다
  if (r.residence.length > 0 && residence.length === 0) {
    warn(`${label}: 거주 요건을 옮기지 못해 이 규칙을 뺌`);
    return null;
  }

  let incomeBasis = r.incomeBasis;
  let incomeYear = int(r.incomeYear);
  let pct: Record<string, number> | null = null;
  if (incomeBasis !== null) {
    const entries = r.incomePct.map(p => ({ ...p, householdSize: Math.round(p.householdSize) })).filter(p => p.householdSize >= 1 && p.householdSize <= 8 && p.pct > 0 && p.pct <= 300);
    if (incomeYear === null || incomeYear < 2015 || incomeYear > 2035 || entries.length === 0) {
      warn(`${label}: 소득 기준(연도·%)이 불완전해 이 규칙을 뺌`);
      return null;
    }
    pct = Object.fromEntries(entries.sort((a, b) => a.householdSize - b.householdSize).map(p => [String(p.householdSize), p.pct]));
  } else {
    incomeYear = null;
    incomeBasis = null;
  }

  const money = (raw: number | null, what: string) => {
    const n = int(raw);
    if (n === null) return null;
    // 만원 단위로 잘못 옮긴 값(예: 34500)을 걸러낸다
    if (n < 1_000_000 || n > 5_000_000_000) { warn(`${label}: ${what} ${n}원은 범위를 벗어나 무시`); return null; }
    return n;
  };

  const extra: RuleExtra = {};
  if (r.studentOnly) extra.studentOnly = true;
  if (r.unmarriedOnly) extra.unmarriedOnly = true;
  if (r.marriedOnly) extra.marriedOnly = true;
  if (r.householderOnly) extra.householderOnly = true;
  if (extra.unmarriedOnly && extra.marriedOnly) {
    warn(`${label}: 미혼만·기혼만이 함께 있어 둘 다 뺌`);
    delete extra.unmarriedOnly; delete extra.marriedOnly;
  }

  return {
    targetGroup: r.targetGroup,
    variant: r.variant.trim().slice(0, 40),
    ageMin, ageMax,
    ageRefDate: r.ageRefDate === null ? null : validDate(r.ageRefDate) ? r.ageRefDate : (warn(`${label}: 나이 기준일 형식 오류`), null),
    residenceCodes: residence.length > 0 ? [...new Set(residence)].sort() : null,
    homelessScope: r.homelessScope,
    incomeBasis, incomeYear,
    incomePctByHousehold: pct,
    assetMax: money(r.assetMaxWon, '자산 상한'),
    carValueMax: money(r.carValueMaxWon, '자동차 상한'),
    extra,
    sourceClause: r.sourceClause.trim().slice(0, 500) || null,
  };
}

export function convertExtraction(x: Extraction, regions: RegionResolver): Converted {
  const warnings: string[] = [];
  const warn = (m: string) => { warnings.push(m); };
  const schedules = dedupeSchedules(x.schedules.map(s => convertSchedule(s, warn)).filter((s): s is CollectedSchedule => s !== null));

  // (대상군, 공급구분)은 DB 에서 유일. 겹치면 뒤의 것에 번호를 붙인다
  const rules: RuleRow[] = [];
  const keys = new Set<string>();
  for (const r of x.rules) {
    const row = convertRule(r, regions, warn);
    if (!row) continue;
    let variant = row.variant;
    for (let i = 2; keys.has(`${row.targetGroup}|${variant}`); i++) variant = `${row.variant || '구분'} ${i}`;
    keys.add(`${row.targetGroup}|${variant}`);
    rules.push({ ...row, variant });
  }
  return { schedules, rules, warnings };
}
