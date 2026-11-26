// LH 분양임대공고 API(공공데이터포털, B552555). 수도권(서울·경기·인천) 임대 공고만.
// 목록(lhLeaseNoticeInfo1) → 상세(lhLeaseNoticeDtlInfo1: 단지·일정·첨부) 순서로 부른다.
// 응답은 [{dsSch:[…]}, {dsList:[…], resHeader:[…]}] 처럼 "데이터셋 이름 → 배열" 객체들의 배열이다.
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
 * 상세 응답의 일정 데이터셋 → 일정. 필드 이름은 활용가이드 기준으로 LH_SCHEDULE_FIELDS 에 모아 둔다.
 * 표에 없는 데이터셋·필드는 raw_text 로만 남기고 LLM 파싱 단계에서 다룬다.
 */
export const LH_SCHEDULE_FIELDS: { kind: CollectedSchedule['kind']; start: string; end?: string; label: string }[] = [
  // TODO(활용가이드 확인 후 확정)
];

function schedulesFromDetail(ds: Record<string, LhRow[]>): CollectedSchedule[] {
  const out: CollectedSchedule[] = [];
  for (const rows of Object.values(ds)) {
    for (const row of rows) {
      for (const f of LH_SCHEDULE_FIELDS) {
        const s = parseDate(str(row[f.start]));
        if (!s) continue;
        const e = f.end ? parseDate(str(row[f.end])) : null;
        out.push({ kind: f.kind, startsAt: toKstIso(s), endsAt: e ? toKstIso(e) : null, allDay: s.time === null, note: f.label });
      }
    }
  }
  return out;
}

/** 상세 응답 전체를 "데이터셋 / 필드: 값" 텍스트로. 검수·LLM 파싱 입력 */
export function detailToText(ds: Record<string, LhRow[]>): string {
  const lines: string[] = [];
  for (const [name, rows] of Object.entries(ds)) {
    if (name === 'resHeader' || name === 'dsSch') continue;
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
  for (const rows of Object.values(ds)) {
    for (const row of rows) {
      for (const [k, v] of Object.entries(row)) {
        if (/ADR|ADDR/i.test(k) && !/CTRT|PLC/i.test(k)) addrs.push(str(v)); // 계약장소 주소는 제외
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
  const posted = parseDate(str(listRow.PAN_NT_ST_DT) || str(listRow.PAN_DT));
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
    urlOriginal: str(listRow.DTL_URL) || 'https://apply.lh.or.kr/',
    urlApply: 'https://apply.lh.or.kr/',
    publishedAt: posted?.date ?? null,
    status: statusOf(str(listRow.PAN_SS), schedules, ctx.now),
    regionCodes: regionCodesOf(listRow, ds, ctx.regions),
    rawText: `[목록]\n${listText}\n\n${detailText}`,
    schedules,
  };
}

const dot = (ymd: string) => ymd.replaceAll('-', '.');

export const lhApi: Source = {
  code: 'LH_API',
  async *collect(ctx) {
    const key = process.env.LH_API_KEY;
    if (!key) throw new Error('LH_API_KEY 가 없습니다(공공데이터포털 일반 인증키, Decoding 값)');
    const lookbackDays = Number(process.env.LH_LOOKBACK_DAYS ?? 60);
    const from = dot(todayKst(new Date(ctx.now.getTime() - lookbackDays * 86_400_000)));
    const to = dot(todayKst(new Date(ctx.now.getTime() + 365 * 86_400_000)));
    const seen = new Set<string>();

    for (const upp of UPP_TYPES) {
      for (const area of AREAS) {
        for (let page = 1; page <= 20; page++) {
          const q = new URLSearchParams({
            serviceKey: key, PG_SZ: '100', PAGE: String(page),
            UPP_AIS_TP_CD: upp, CNP_CD: area, PAN_NT_ST_DT: from, CLSG_DT: to,
          });
          const ds = datasets(await httpJson(`${BASE}/lhLeaseNoticeInfo1/lhLeaseNoticeInfo1?${q}`));
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
