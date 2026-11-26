// LH 분양임대공고 API(공공데이터포털, B552555). 수도권(서울·경기·인천) 임대 공고만.
// 목록(lhLeaseNoticeInfo1) → 상세(lhLeaseNoticeDtlInfo1: 단지·일정·첨부) 순서로 부른다.
// 응답은 [{dsSch:[…]}, {dsList:[…], resHeader:[…]}] 처럼 "데이터셋 이름 → 배열" 객체들의 배열이다.
// 필드 이름은 공공데이터포털 활용가이드(공고문 조회 2026-07-08판, 상세정보 조회 2026-11-23판) 기준.
import { parseDate, todayKst, toKstIso } from '../lib/dates.js';
import { httpJson } from '../lib/http.js';
import { mergeCodes, type RegionResolver } from '../lib/regions.js';
import { extractSchedules } from '../lib/schedule-text.js';
import { statusFromSchedules } from '../lib/status.js';
import type { HousingType } from '@yh/schema';
import type { CollectedNotice, CollectedSchedule, NoticeStatus, Source, SourceContext } from './types.js';

const BASE = 'https://apis.data.go.kr/B552555';
/** 공고유형: 06 임대주택, 13 주거복지(매입·전세임대 등) */
const UPP_TYPES = ['06', '13'];
/** 지역코드(CNP_CD): 서울 11, 인천 28, 경기 41 */
const AREAS = ['11', '28', '41'];
/** 청년이 신청할 수 있는 유형만 남긴다(유형명·공고명 기준). 국민·영구임대 등은 제외 */
const YOUTH_RE = /청년|행복주택|대학생|신혼|매입임대|전세임대|통합공공|든든전세|희망타운/;

export type LhRow = Record<string, string | number | null | undefined>;

/** 응답 배열의 데이터셋을 이름별로 모은다 */
export function datasets(res: unknown): Record<string, LhRow[]> {
  const out: Record<string, LhRow[]> = {};
  const parts = Array.isArray(res) ? res : [res];
  for (const part of parts) {
    if (!part || typeof part !== 'object') continue;
    for (const [k, v] of Object.entries(part as Record<string, unknown>)) {
      if (Array.isArray(v)) out[k] = [...(out[k] ?? []), ...(v as LhRow[])];
    }
  }
  return out;
}

const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v).trim());

export function housingTypeOf(row: LhRow): HousingType {
  const t = `${str(row.AIS_TP_CD_NM)} ${str(row.PAN_NM)}`;
  if (/행복주택/.test(t)) return 'happy_house';
  if (/청년/.test(t) && /매입/.test(t)) return 'youth_purchase_rental';
  return 'other';
}

export function isYouthRelevant(row: LhRow): boolean {
  return YOUTH_RE.test(`${str(row.AIS_TP_CD_NM)} ${str(row.PAN_NM)}`);
}

function statusOf(panSs: string, schedules: CollectedSchedule[], now: Date): NoticeStatus {
  if (/취소/.test(panSs)) return 'cancelled';
  const fromDates = statusFromSchedules(schedules, now);
  if (fromDates) return fromDates;
  if (/접수중/.test(panSs)) return 'open';
  if (/마감|완료|종료/.test(panSs)) return 'closed';
  return 'upcoming';
}

/**
 * 상세 응답 dsSplScdl(공급일정) 필드 → 일정. 활용가이드(분양임대공고별 상세정보 조회, 2026-11-23판) 기준.
 * 공급유형(SPL_INF_TP_CD)마다 쓰는 필드가 달라 아는 이름을 모두 둔다. 값이 빈 필드는 건너뛴다.
 */
export const LH_SCHEDULE_FIELDS: { kind: CollectedSchedule['kind']; start: string; end?: string; label: string }[] = [
  { kind: 'apply_start', start: 'SBSC_ACP_ST_DT', label: '접수기간시작일' },
  { kind: 'apply_end', start: 'SBSC_ACP_CLSG_DT', label: '접수기간종료일' },
  { kind: 'apply_start', start: 'UST_ACP_ST_DTTM', label: '접수기간시작일' },   // 전세임대
  { kind: 'apply_end', start: 'UST_ACP_CLSG_DTTM', label: '접수기간종료일' },
  { kind: 'apply_start', start: 'ACP_ST_DT', label: '접수기간시작일' },         // 기존주택전세임대
  { kind: 'apply_end', start: 'ACP_ED_DT', label: '접수기간종료일' },
  { kind: 'doc_result', start: 'PPR_SBM_OPE_ANC_DT', label: '서류제출대상자발표일' },
  { kind: 'doc_submit', start: 'PPR_ACP_ST_DT', end: 'PPR_ACP_CLSG_DT', label: '서류접수기간' },
  { kind: 'winner', start: 'PZWR_ANC_DT', label: '당첨자발표일' },
  { kind: 'doc_submit', start: 'PZWR_PPR_SBM_ST_DT', end: 'PZWR_PPR_SBM_ED_DT', label: '당첨자서류제출기간' },
  { kind: 'contract', start: 'CTRT_ST_DT', end: 'CTRT_ED_DT', label: '계약기간' },
];

/** ACP_DTTM "2017.01.06 10:00 ~ 2017.01.06 16:00" → 시각까지 있는 접수 시작·마감 */
function acceptRange(v: string): CollectedSchedule[] {
  const m = /^(.*?)\s*~\s*(.*)$/.exec(v.trim());
  const s = parseDate(m ? m[1] : v);
  if (!s) return [];
  const out: CollectedSchedule[] = [
    { kind: 'apply_start', startsAt: toKstIso(s), endsAt: null, allDay: s.time === null, note: '신청일시' },
  ];
  if (m) {
    const e = parseDate(m[2]) ?? (/^\d{1,2}:\d{2}/.test(m[2]!.trim()) ? { date: s.date, time: m[2]!.trim().slice(0, 5).padStart(5, '0') } : null);
    if (e) out.push({ kind: 'apply_end', startsAt: toKstIso(e), endsAt: null, allDay: e.time === null, note: '신청일시' });
  }
  return out;
}

/** 데이터셋 중 라벨 표(…Nm)·요청 에코(dsSch)·헤더는 뺀다 */
function dataRows(ds: Record<string, LhRow[]>): [string, LhRow[]][] {
  return Object.entries(ds).filter(([k]) => !k.endsWith('Nm') && k !== 'dsSch' && k !== 'resHeader');
}

export function schedulesFromDetail(ds: Record<string, LhRow[]>): CollectedSchedule[] {
  const out: CollectedSchedule[] = [];
  const seen = new Set<string>();
  const push = (s: CollectedSchedule) => {
    const key = `${s.kind}|${s.startsAt}|${s.endsAt}`;
    if (!seen.has(key)) { seen.add(key); out.push(s); }
  };
  const rows = ds.dsSplScdl ?? [];
  for (const row of rows) {
    // 시각이 있는 신청일시가 있으면 날짜만 있는 접수기간 필드보다 우선
    const timed = acceptRange(str(row.ACP_DTTM));
    for (const f of LH_SCHEDULE_FIELDS) {
      if (timed.length && (f.kind === 'apply_start' || (f.kind === 'apply_end' && timed.length > 1))) continue;
      const s = parseDate(str(row[f.start]));
      if (!s) continue;
      const e = f.end ? parseDate(str(row[f.end])) : null;
      push({ kind: f.kind, startsAt: toKstIso(s), endsAt: e && e.date !== s.date ? toKstIso(e) : null, allDay: s.time === null, note: f.label });
    }
    timed.forEach(push);
  }
  // 같은 날 같은 종류가 날짜만 있는 것과 시각까지 있는 것으로 둘이면 시각 있는 쪽만 남긴다
  const timedDays = new Set(out.filter(s => !s.allDay).map(s => `${s.kind}|${s.startsAt.slice(0, 10)}`));
  const merged = out.filter(s => !s.allDay || !timedDays.has(`${s.kind}|${s.startsAt.slice(0, 10)}`));
  // 단지가 여럿이면 같은 종류 일정이 단지별로 다를 수 있다. 시간순으로 정렬해 seq 가 차수 순서가 되게 한다
  return merged.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
}

/** 상세 응답 전체를 "데이터셋 / 필드: 값" 텍스트로. 검수·LLM 파싱 입력 */
export function detailToText(ds: Record<string, LhRow[]>): string {
  const lines: string[] = [];
  for (const [name, rows] of dataRows(ds)) {
    rows.forEach((row, i) => {
      lines.push(`[${name}${rows.length > 1 ? ` #${i + 1}` : ''}]`);
      for (const [k, v] of Object.entries(row)) {
        const s = str(v);
        if (s) lines.push(`${k}: ${s}`);
      }
    });
  }
  return lines.join('\n');
}

function regionCodesOf(listRow: LhRow, ds: Record<string, LhRow[]>, regions: RegionResolver): string[] {
  const sido = regions.sidoCodeOf(str(listRow.CNP_CD_NM));
  const addrs: string[] = [];
  for (const [name, rows] of dataRows(ds)) {
    if (name === 'dsCtrtPlc') continue; // 접수처·계약장소 주소는 단지 위치가 아니다
    for (const row of rows) {
      for (const [k, v] of Object.entries(row)) {
        if (/ADR$/.test(k) && !/DTL_ADR$/.test(k)) addrs.push(str(v));
      }
    }
  }
  const codes = mergeCodes(...addrs.map(a => regions.resolveAddress(a)));
  return mergeCodes(codes, sido ? [sido] : []);
}

export function toNotice(listRow: LhRow, detail: unknown, ctx: Pick<SourceContext, 'regions' | 'now'>): CollectedNotice {
  const ds = datasets(detail);
  const detailText = detailToText(ds);
  let schedules = schedulesFromDetail(ds);
  if (schedules.length === 0) {
    schedules = extractSchedules(detailText).map(s => ({
      kind: s.kind, startsAt: toKstIso(s.start), endsAt: s.end ? toKstIso(s.end) : null, allDay: s.start.time === null, note: s.label,
    }));
  }
  const posted = parseDate(str(listRow.PAN_DT) || str(listRow.PAN_NT_ST_DT));
  if (posted && !schedules.some(s => s.kind === 'announce')) {
    schedules.unshift({ kind: 'announce', startsAt: toKstIso(posted), endsAt: null, allDay: true, note: '공고게시일' });
  }
  const closing = parseDate(str(listRow.CLSG_DT));
  if (closing && !schedules.some(s => s.kind === 'apply_end')) {
    schedules.push({ kind: 'apply_end', startsAt: toKstIso(closing), endsAt: null, allDay: true, note: '공고마감일' });
  }

  const listText = Object.entries(listRow)
    .filter(([k, v]) => str(v) && !['RNUM', 'ALL_CNT'].includes(k))
    .map(([k, v]) => `${k}: ${str(v)}`)
    .join('\n');

  return {
    externalId: str(listRow.PAN_ID),
    title: str(listRow.PAN_NM),
    housingType: housingTypeOf(listRow),
    urlOriginal: str(listRow.DTL_URL) || str(listRow.DTL_URL_MOB) || 'https://apply.lh.or.kr/',
    urlApply: 'https://apply.lh.or.kr/',
    publishedAt: posted?.date ?? null,
    status: statusOf(str(listRow.PAN_SS), schedules, ctx.now),
    regionCodes: regionCodesOf(listRow, ds, ctx.regions),
    rawText: `[목록]\n${listText}\n\n${detailText}`,
    schedules,
  };
}

const compact = (ymd: string) => ymd.replaceAll('-', '');

export const lhApi: Source = {
  code: 'LH_API',
  async *collect(ctx) {
    const key = process.env.LH_API_KEY;
    if (!key) throw new Error('LH_API_KEY 가 없습니다(공공데이터포털 일반 인증키, Decoding 값)');
    const lookbackDays = Number(process.env.LH_LOOKBACK_DAYS ?? 60);
    // 게시일 기간 검색(필수, YYYYMMDD). 기본값은 가이드 초기값과 같은 "최근 60일 ~ 오늘"
    const from = compact(todayKst(new Date(ctx.now.getTime() - lookbackDays * 86_400_000)));
    const to = compact(todayKst(ctx.now));
    const seen = new Set<string>();

    for (const upp of UPP_TYPES) {
      for (const area of AREAS) {
        for (let page = 1; page <= 20; page++) {
          const q = new URLSearchParams({
            serviceKey: key, PG_SZ: '100', PAGE: String(page),
            UPP_AIS_TP_CD: upp, CNP_CD: area, PAN_ST_DT: from, PAN_ED_DT: to,
          });
          const ds = datasets(await httpJson(`${BASE}/lhLeaseNoticeInfo1/lhLeaseNoticeInfo1?${q}`));
          const code = str(ds.resHeader?.[0]?.SS_CODE);
          if (code && code !== 'Y') throw new Error(`LH 목록 오류 SS_CODE=${code} (UPP=${upp}, CNP=${area})`);
          const rows = ds.dsList ?? [];
          for (const row of rows) {
            const id = str(row.PAN_ID);
            if (!id || seen.has(id) || !isYouthRelevant(row)) continue;
            seen.add(id);
            let detail: unknown = [];
            try {
              const dq = new URLSearchParams({
                serviceKey: key,
                SPL_INF_TP_CD: str(row.SPL_INF_TP_CD),
                CCR_CNNT_SYS_DS_CD: str(row.CCR_CNNT_SYS_DS_CD),
                PAN_ID: id,
                UPP_AIS_TP_CD: str(row.UPP_AIS_TP_CD) || upp,
                AIS_TP_CD: str(row.AIS_TP_CD),
              });
              detail = await httpJson(`${BASE}/lhLeaseNoticeDtlInfo1/getLeaseNoticeDtlInfo1?${dq}`);
            } catch (e) {
              ctx.log(`  상세 실패 PAN_ID=${id}: ${(e as Error).message}`);
            }
            yield toNotice(row, detail, ctx);
          }
          const total = Number(rows[0]?.ALL_CNT ?? 0);
          if (rows.length < 100 || page * 100 >= total) break;
        }
      }
    }
  },
};
