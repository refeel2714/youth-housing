// 검수 화면 폼 ↔ 저장값. 화면은 문자열 그대로 다시 그릴 수 있게 NoticeForm(문자열) 으로 다루고,
// 저장 직전에 parseNoticeForm 으로 검사해 NoticeInput(타입 있는 값) 을 만든다.
// 날짜·시각은 한국시간으로 입력받는다(KST 는 서머타임이 없어 +09:00 고정).
import {
  HOMELESS_SCOPES, HOUSING_TYPES, INCOME_BASES, SCHEDULE_KINDS, TARGET_GROUPS,
  type HomelessScope, type HousingType, type IncomeBasis, type ScheduleKind, type TargetGroup,
} from '@yh/schema/constants';

export const EXTRA_KEYS = ['studentOnly', 'unmarriedOnly', 'marriedOnly', 'householderOnly'] as const;
export type ExtraKey = (typeof EXTRA_KEYS)[number];

export interface ScheduleForm {
  kind: string;
  date: string;     // YYYY-MM-DD
  time: string;     // HH:MM, 비면 종일
  endDate: string;
  endTime: string;
  note: string;
  del: boolean;
}

export interface RuleForm {
  targetGroup: string;
  variant: string;
  ageMin: string;
  ageMax: string;
  ageRefDate: string;
  residenceCodes: string;   // 쉼표로 구분한 지역 코드
  homelessScope: string;    // '' = 조건 없음
  incomeBasis: string;      // '' = 소득 조건 없음
  incomeYear: string;
  incomePct: string;        // "100" 또는 "1:120, 2:110, 3-8:100"
  assetMaxMan: string;      // 만원
  carMaxMan: string;        // 만원
  extra: Record<ExtraKey, boolean>;
  sourceClause: string;
  del: boolean;
}

export interface NoticeForm {
  title: string;
  housingType: string;
  urlOriginal: string;
  urlApply: string;
  publishedAt: string;
  cancelled: boolean;
  regionCodes: string[];
  reviewNote: string;
  schedules: ScheduleForm[];
  rules: RuleForm[];
}

export interface ScheduleInput {
  kind: ScheduleKind;
  seq: number;
  startsAt: Date;
  endsAt: Date | null;
  allDay: boolean;
  note: string | null;
}

export interface RuleInput {
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
  extra: Partial<Record<ExtraKey, true>>;
  sourceClause: string | null;
}

export interface NoticeInput {
  title: string;
  housingType: HousingType;
  urlOriginal: string;
  urlApply: string | null;
  publishedAt: string | null;
  cancelled: boolean;
  /** 화면에서 고른 지역. 시도·상위 시 코드는 저장할 때 붙인다 */
  regionCodes: string[];
  reviewNote: string | null;
  schedules: ScheduleInput[];
  rules: RuleInput[];
}

export type FieldErrors = Record<string, string>;

export const emptySchedule = (): ScheduleForm => ({ kind: '', date: '', time: '', endDate: '', endTime: '', note: '', del: false });
export const emptyRule = (): RuleForm => ({
  targetGroup: 'youth', variant: '', ageMin: '', ageMax: '', ageRefDate: '', residenceCodes: '', homelessScope: '',
  incomeBasis: '', incomeYear: '', incomePct: '', assetMaxMan: '', carMaxMan: '',
  extra: { studentOnly: false, unmarriedOnly: false, marriedOnly: false, householderOnly: false },
  sourceClause: '', del: false,
});

// ── 요청 본문 → NoticeForm ─────────────────────────────

type Body = Record<string, unknown>;
const str = (b: Body, k: string): string => {
  const v = b[k];
  const one = Array.isArray(v) ? v[0] : v;
  return typeof one === 'string' ? one.trim() : '';
};
const strs = (b: Body, k: string): string[] => {
  const v = b[k];
  const list = Array.isArray(v) ? v : v === undefined ? [] : [v];
  return list.filter((x): x is string => typeof x === 'string').map(x => x.trim()).filter(Boolean);
};
const flag = (b: Body, k: string) => str(b, k) !== '';
const count = (b: Body, k: string) => Math.min(Math.max(Number(str(b, k)) || 0, 0), 60);

/** Hono parseBody({ all: true }) 결과. 행은 s0.kind, r0.ageMin 처럼 번호를 붙여 보낸다 */
export function formFromBody(b: Body): NoticeForm {
  const schedules: ScheduleForm[] = [];
  for (let i = 0; i < count(b, 's_count'); i++) {
    const p = `s${i}.`;
    schedules.push({
      kind: str(b, p + 'kind'), date: str(b, p + 'date'), time: str(b, p + 'time'),
      endDate: str(b, p + 'endDate'), endTime: str(b, p + 'endTime'), note: str(b, p + 'note'), del: flag(b, p + 'del'),
    });
  }
  const rules: RuleForm[] = [];
  for (let i = 0; i < count(b, 'r_count'); i++) {
    const p = `r${i}.`;
    rules.push({
      targetGroup: str(b, p + 'targetGroup'), variant: str(b, p + 'variant'),
      ageMin: str(b, p + 'ageMin'), ageMax: str(b, p + 'ageMax'), ageRefDate: str(b, p + 'ageRefDate'),
      residenceCodes: str(b, p + 'residenceCodes'), homelessScope: str(b, p + 'homelessScope'),
      incomeBasis: str(b, p + 'incomeBasis'), incomeYear: str(b, p + 'incomeYear'), incomePct: str(b, p + 'incomePct'),
      assetMaxMan: str(b, p + 'assetMaxMan'), carMaxMan: str(b, p + 'carMaxMan'),
      extra: Object.fromEntries(EXTRA_KEYS.map(k => [k, flag(b, p + k)])) as Record<ExtraKey, boolean>,
      sourceClause: str(b, p + 'sourceClause'), del: flag(b, p + 'del'),
    });
  }
  return {
    title: str(b, 'title'), housingType: str(b, 'housingType'), urlOriginal: str(b, 'urlOriginal'),
    urlApply: str(b, 'urlApply'), publishedAt: str(b, 'publishedAt'), cancelled: flag(b, 'cancelled'),
    regionCodes: [...new Set(strs(b, 'region'))], reviewNote: str(b, 'reviewNote'), schedules, rules,
  };
}

// ── 값 변환 ───────────────────────────────────────────

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export function isDate(s: string): boolean {
  if (!DATE_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export const kst = (date: string, time = '00:00') => new Date(`${date}T${time}:00+09:00`);

function isHttpUrl(s: string): boolean {
  try {
    const u = new URL(s);
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
}

/** "100" → 1~8인 모두 100, "1:120, 2:110, 3-8:100" → 가구원 수별 */
export function parseIncomePct(raw: string): Record<string, number> | null | 'error' {
  const s = raw.replace(/%/g, '').trim();
  if (s === '') return null;
  const pct = (v: string) => (/^\d{1,3}(\.\d)?$/.test(v) && Number(v) > 0 && Number(v) <= 300 ? Number(v) : null);
  const all = pct(s);
  if (all !== null) return Object.fromEntries([1, 2, 3, 4, 5, 6, 7, 8].map(n => [String(n), all]));
  const out: Record<string, number> = {};
  for (const part of s.split(/[,\s]+/).filter(Boolean)) {
    const m = /^([1-8])(?:-([1-8]))?(?:인)?[:=](.+)$/.exec(part);
    if (!m) return 'error';
    const from = Number(m[1]);
    const to = m[2] ? Number(m[2]) : from;
    const v = pct(m[3]!);
    if (v === null || to < from) return 'error';
    for (let n = from; n <= to; n++) out[String(n)] = v;
  }
  return Object.keys(out).length > 0 ? out : 'error';
}

/** parseIncomePct 의 반대. 이어진 같은 값은 범위로 묶는다 */
export function formatIncomePct(m: Record<string, number> | null): string {
  if (!m) return '';
  const keys = Object.keys(m).map(Number).filter(n => n >= 1 && n <= 8).sort((a, b) => a - b);
  if (keys.length === 8 && keys.every(k => m[String(k)] === m['1'])) return String(m['1']);
  const parts: string[] = [];
  for (let i = 0; i < keys.length; ) {
    let j = i;
    while (j + 1 < keys.length && keys[j + 1] === keys[j]! + 1 && m[String(keys[j + 1])] === m[String(keys[i])]) j++;
    const range = i === j ? `${keys[i]}` : `${keys[i]}-${keys[j]}`;
    parts.push(`${range}:${m[String(keys[i])]}`);
    i = j + 1;
  }
  return parts.join(', ');
}

/** 만원 → 원 */
function manToWon(raw: string): number | null | 'error' {
  const s = raw.replace(/,/g, '').trim();
  if (s === '') return null;
  if (!/^\d+(\.\d{1,4})?$/.test(s)) return 'error';
  return Math.round(Number(s) * 10000);
}
export const wonToMan = (won: number | null) => (won === null ? '' : String(won / 10000));

function intOrNull(raw: string, min: number, max: number): number | null | 'error' {
  if (raw === '') return null;
  if (!/^\d+$/.test(raw)) return 'error';
  const n = Number(raw);
  return n >= min && n <= max ? n : 'error';
}

// ── 검사 ─────────────────────────────────────────────

export interface ParseContext {
  /** regions 테이블 코드 */
  regionCodes: ReadonlySet<string>;
}

export function parseNoticeForm(f: NoticeForm, ctx: ParseContext, opts: { approve: boolean }):
  { ok: true; value: NoticeInput } | { ok: false; errors: FieldErrors } {
  const e: FieldErrors = {};

  if (f.title.length < 2 || f.title.length > 200) e.title = '제목은 2~200자로 넣어 주세요';
  if (!(HOUSING_TYPES as readonly string[]).includes(f.housingType)) e.housingType = '주택 유형을 골라 주세요';
  if (!isHttpUrl(f.urlOriginal)) e.urlOriginal = '원문 주소가 올바르지 않습니다';
  if (f.urlApply && !isHttpUrl(f.urlApply)) e.urlApply = '신청 주소가 올바르지 않습니다';
  if (f.publishedAt && !isDate(f.publishedAt)) e.publishedAt = '날짜는 YYYY-MM-DD 로 넣어 주세요';
  const badRegion = f.regionCodes.find(c => !ctx.regionCodes.has(c));
  if (badRegion) e.region = `없는 지역 코드입니다: ${badRegion}`;
  if (f.reviewNote.length > 500) e.reviewNote = '메모는 500자까지입니다';

  // 일정: 종류·날짜가 모두 빈 행은 빈칸으로 보고 건너뛴다
  const schedules: Omit<ScheduleInput, 'seq'>[] = [];
  f.schedules.forEach((s, i) => {
    const p = `s${i}.`;
    if (s.del || (!s.kind && !s.date && !s.endDate && !s.note)) return;
    const before = Object.keys(e).length;
    if (!(SCHEDULE_KINDS as readonly string[]).includes(s.kind)) e[p + 'kind'] = '종류를 골라 주세요';
    if (!isDate(s.date)) e[p + 'date'] = '날짜를 넣어 주세요';
    if (s.time && !TIME_RE.test(s.time)) e[p + 'time'] = '시각은 HH:MM';
    if (s.endDate && !isDate(s.endDate)) e[p + 'endDate'] = '날짜가 올바르지 않습니다';
    if (s.endTime && !TIME_RE.test(s.endTime)) e[p + 'endTime'] = '시각은 HH:MM';
    if (s.note.length > 200) e[p + 'note'] = '메모는 200자까지';
    if (Object.keys(e).length > before) return;

    const allDay = s.time === '' && s.endTime === '';
    const startsAt = kst(s.date, s.time || '00:00');
    let endsAt: Date | null = null;
    if (s.endDate || s.endTime) {
      if (!allDay && !s.endTime) { e[p + 'endTime'] = '끝 시각을 넣어 주세요'; return; }
      endsAt = kst(s.endDate || s.date, s.endTime || '00:00');
      if (endsAt < startsAt) { e[p + 'endDate'] = '끝이 시작보다 빠릅니다'; return; }
      if (endsAt.getTime() === startsAt.getTime()) endsAt = null;
    }
    schedules.push({ kind: s.kind as ScheduleKind, startsAt, endsAt, allDay, note: s.note || null });
  });

  // 같은 종류는 시작 순서대로 1차, 2차…
  schedules.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  const seqOf = new Map<string, number>();
  const withSeq: ScheduleInput[] = schedules.map(s => {
    const seq = (seqOf.get(s.kind) ?? 0) + 1;
    seqOf.set(s.kind, seq);
    return { ...s, seq };
  });

  const rules: RuleInput[] = [];
  const seenRule = new Set<string>();
  f.rules.forEach((r, i) => {
    const p = `r${i}.`;
    if (r.del) return;
    const before = Object.keys(e).length;
    if (!(TARGET_GROUPS as readonly string[]).includes(r.targetGroup)) e[p + 'targetGroup'] = '대상을 골라 주세요';
    if (r.variant.length > 40) e[p + 'variant'] = '40자까지';
    const key = `${r.targetGroup}:${r.variant}`;
    if (seenRule.has(key)) e[p + 'variant'] = '같은 대상·구분이 이미 있습니다. 구분을 다르게 넣어 주세요';
    seenRule.add(key);

    const ageMin = intOrNull(r.ageMin, 0, 99);
    const ageMax = intOrNull(r.ageMax, 0, 99);
    if (ageMin === 'error') e[p + 'ageMin'] = '0~99';
    if (ageMax === 'error') e[p + 'ageMax'] = '0~99';
    if (typeof ageMin === 'number' && typeof ageMax === 'number' && ageMin > ageMax) e[p + 'ageMax'] = '최소보다 작습니다';
    if (r.ageRefDate && !isDate(r.ageRefDate)) e[p + 'ageRefDate'] = 'YYYY-MM-DD';

    const codes = r.residenceCodes.split(/[,\s]+/).filter(Boolean);
    const badCode = codes.find(c => !ctx.regionCodes.has(c));
    if (badCode) e[p + 'residenceCodes'] = `없는 지역 코드: ${badCode}`;

    if (r.homelessScope && !(HOMELESS_SCOPES as readonly string[]).includes(r.homelessScope)) e[p + 'homelessScope'] = '골라 주세요';
    let incomeBasis: IncomeBasis | null = null;
    let incomeYear: number | null = null;
    let pct: Record<string, number> | null = null;
    if (r.incomeBasis) {
      if (!(INCOME_BASES as readonly string[]).includes(r.incomeBasis)) e[p + 'incomeBasis'] = '골라 주세요';
      else incomeBasis = r.incomeBasis as IncomeBasis;
      const y = intOrNull(r.incomeYear, 2000, 2100);
      if (typeof y !== 'number') e[p + 'incomeYear'] = '기준 연도를 넣어 주세요';
      else incomeYear = y;
      const parsed = parseIncomePct(r.incomePct);
      if (parsed === 'error') e[p + 'incomePct'] = '예: 100 또는 1:120, 2:110, 3-8:100';
      else if (parsed === null) e[p + 'incomePct'] = '기준 비율을 넣어 주세요';
      else pct = parsed;
    } else if (r.incomePct || r.incomeYear) {
      e[p + 'incomeBasis'] = '소득 기준을 골라 주세요';
    }
    const assetMax = manToWon(r.assetMaxMan);
    const carValueMax = manToWon(r.carMaxMan);
    if (assetMax === 'error') e[p + 'assetMaxMan'] = '만원 단위 숫자';
    if (carValueMax === 'error') e[p + 'carMaxMan'] = '만원 단위 숫자';
    if (r.extra.unmarriedOnly && r.extra.marriedOnly) e[p + 'extra'] = '미혼만·기혼만을 함께 고를 수 없습니다';
    if (r.sourceClause.length > 4000) e[p + 'sourceClause'] = '4000자까지';
    if (Object.keys(e).length > before) return;

    rules.push({
      targetGroup: r.targetGroup as TargetGroup, variant: r.variant,
      ageMin: ageMin as number | null, ageMax: ageMax as number | null, ageRefDate: r.ageRefDate || null,
      residenceCodes: codes.length > 0 ? [...new Set(codes)] : null,
      homelessScope: (r.homelessScope || null) as HomelessScope | null,
      incomeBasis, incomeYear, incomePctByHousehold: pct,
      assetMax: assetMax as number | null, carValueMax: carValueMax as number | null,
      extra: Object.fromEntries(EXTRA_KEYS.filter(k => r.extra[k]).map(k => [k, true])),
      sourceClause: r.sourceClause || null,
    });
  });

  if (opts.approve) {
    if (withSeq.length === 0) e.schedules = '승인하려면 일정이 하나 이상 있어야 합니다';
    if (f.regionCodes.length === 0 && !e.region) e.region = '승인하려면 지역을 하나 이상 골라 주세요';
  }

  if (Object.keys(e).length > 0) return { ok: false, errors: e };
  return {
    ok: true,
    value: {
      title: f.title, housingType: f.housingType as HousingType, urlOriginal: f.urlOriginal,
      urlApply: f.urlApply || null, publishedAt: f.publishedAt || null, cancelled: f.cancelled,
      regionCodes: f.regionCodes, reviewNote: f.reviewNote || null, schedules: withSeq, rules,
    },
  };
}
