// 서울주거포털 청년안심주택 모집공고(soco.seoul.go.kr/youth).
// 목록 화면이 부르는 JSON(bbsListJson.json)에 본문 HTML까지 들어 있어 목록 한 번 + 첨부 목록용 상세 한 번만 부른다.
import { parseDate, todayKst, toKstIso } from '../lib/dates.js';
import { htmlToText } from '../lib/html.js';
import { httpJson, httpText } from '../lib/http.js';
import { mergeCodes, type RegionResolver } from '../lib/regions.js';
import { extractSchedules } from '../lib/schedule-text.js';
import { statusFromSchedules } from '../lib/status.js';
import type { CollectedNotice, CollectedSchedule, Source, SourceContext } from './types.js';

export const SEOUL_BASE = 'https://soco.seoul.go.kr';
const BBS_ID = 'BMSR00015';
const MENU_NO = '400008';
const SEOUL = '서울특별시';

export interface SeoulListItem {
  boardId: number;
  nttSj: string;
  content: string | null;
  atchFileId: string | null;
  optn1: string | null; // 공고게시일
  optn2: string | null; // 1 공공, 2 민간
  optn3: string | null; // 담당부서/사업자
  optn4: string | null; // 청약신청일
  optn5: string | null; // 1 최초, 2 추가
  delAt?: string | null;
  useAt?: string | null;
}

export interface SeoulListResponse {
  pagingInfo: { totRow: number; totPage: number; pageIndex: number };
  resultList: SeoulListItem[];
}

export interface Attachment {
  name: string;
  url: string;
}

export const viewUrl = (boardId: number) =>
  `${SEOUL_BASE}/youth/bbs/${BBS_ID}/view.do?boardId=${boardId}&menuNo=${MENU_NO}`;

/** 상세 화면 HTML에서 첨부파일(이름, 내려받기 주소) */
export function parseAttachments(html: string): Attachment[] {
  const out: Attachment[] = [];
  const re = /<a\b[^>]*href="(\/[^"]*fileDown\.do\?[^"]+)"[^>]*>([^<]+)<\/a>/gi;
  for (const m of html.matchAll(re)) {
    const url = SEOUL_BASE + m[1]!.replace(/&amp;/g, '&');
    if (!out.some(a => a.url === url)) out.push({ name: m[2]!.trim(), url });
  }
  return out;
}

/** 본문 링크 중 청약 신청 사이트(포털 자신 제외) */
function applyUrl(contentHtml: string): string | null {
  for (const m of contentHtml.matchAll(/<a\b[^>]*href="(https?:\/\/[^"]+)"/gi)) {
    const url = m[1]!.replace(/&amp;/g, '&');
    if (!url.includes('soco.seoul.go.kr')) return url;
  }
  return null;
}

function regionCodesOf(text: string, title: string, regions: RegionResolver): string[] {
  const lines = text.split('\n').filter(l => /위치|주소|소재지/.test(l));
  const codes = mergeCodes(...lines.map(l => regions.resolveAddress(l, SEOUL)));
  if (codes.some(c => !c.endsWith('000'))) return codes;
  // 위치 줄이 없으면 제목의 "OO구"라도
  const fromTitle = regions.resolveAddress(title, SEOUL).filter(c => !c.endsWith('000'));
  return mergeCodes(fromTitle, codes, regions.sidoCodeOf(SEOUL) ? [regions.sidoCodeOf(SEOUL)!] : []);
}

export function toNotice(
  item: SeoulListItem,
  attachments: Attachment[],
  ctx: Pick<SourceContext, 'regions' | 'now'>,
): CollectedNotice {
  const html = item.content ?? '';
  const text = htmlToText(html);
  const schedules: CollectedSchedule[] = extractSchedules(text).map(s => ({
    kind: s.kind,
    startsAt: toKstIso(s.start),
    endsAt: s.end ? toKstIso(s.end) : null,
    allDay: s.start.time === null,
    note: s.label,
  }));

  // 본문에서 못 찾은 핵심 일정은 목록 칸(게시일·청약신청일)으로 채운다
  const posted = parseDate(item.optn1);
  const applyDay = parseDate(item.optn4);
  if (posted && !schedules.some(s => s.kind === 'announce')) {
    schedules.unshift({ kind: 'announce', startsAt: toKstIso(posted), endsAt: null, allDay: true, note: '공고게시일' });
  }
  if (applyDay && !schedules.some(s => s.kind === 'apply_start')) {
    schedules.push({ kind: 'apply_start', startsAt: toKstIso(applyDay), endsAt: null, allDay: true, note: '청약신청일' });
  }

  const kind = item.optn2 === '1' ? '공공' : item.optn2 === '2' ? '민간' : '';
  const round = item.optn5 === '1' ? '최초' : item.optn5 === '2' ? '추가' : '';
  const rawText = [
    `제목: ${item.nttSj}`,
    `구분: ${[kind, round].filter(Boolean).join(' ') || '-'}`,
    `공고게시일: ${item.optn1 ?? '-'}`,
    `청약신청일: ${item.optn4 ?? '-'}`,
    `담당부서/사업자: ${item.optn3 ?? '-'}`,
    '',
    text,
    ...(attachments.length ? ['', '첨부파일:', ...attachments.map(a => `- ${a.name} ${a.url}`)] : []),
  ].join('\n');

  const cancelled = /취소\s*공고|공고\s*취소/.test(item.nttSj);
  return {
    externalId: String(item.boardId),
    title: item.nttSj.trim(),
    housingType: item.optn2 === '1' ? 'youth_safe_public' : item.optn2 === '2' ? 'youth_safe_private' : 'other',
    urlOriginal: viewUrl(item.boardId),
    urlApply: applyUrl(html),
    publishedAt: posted?.date ?? null,
    status: cancelled ? 'cancelled' : statusFromSchedules(schedules, ctx.now) ?? 'upcoming',
    regionCodes: regionCodesOf(text, item.nttSj, ctx.regions),
    rawText,
    schedules,
  };
}

async function listPage(page: number): Promise<SeoulListResponse> {
  return httpJson<SeoulListResponse>(`${SEOUL_BASE}/youth/pgm/home/yohome/bbsListJson.json`, {
    form: { bbsId: BBS_ID, pageIndex: page, searchAdresGu: '', searchCondition: '', searchKeyword: '', optn2: '', optn5: '' },
  });
}

export const seoulHousing: Source = {
  code: 'SEOUL_HOUSING',
  async *collect(ctx) {
    const lookbackDays = Number(process.env.SEOUL_LOOKBACK_DAYS ?? 90);
    const cutoff = todayKst(new Date(ctx.now.getTime() - lookbackDays * 86_400_000));
    const maxPages = Number(process.env.SEOUL_MAX_PAGES ?? 20);

    for (let page = 1; page <= maxPages; page++) {
      const res = await listPage(page);
      const items = res.resultList.filter(i => i.delAt !== 'Y' && i.useAt !== 'N');
      let fresh = 0;
      for (const item of items) {
        if ((item.optn1 ?? '9999') < cutoff) continue;
        fresh++;
        let attachments: Attachment[] = [];
        try {
          attachments = parseAttachments(await httpText(viewUrl(item.boardId)));
        } catch (e) {
          ctx.log(`  첨부 목록 실패 boardId=${item.boardId}: ${(e as Error).message}`);
        }
        yield toNotice(item, attachments, ctx);
      }
      // 목록은 게시일 내림차순. 한 쪽 전체가 기준일보다 오래되면 멈춘다
      if (fresh === 0 || page >= res.pagingInfo.totPage) break;
    }
  },
};
