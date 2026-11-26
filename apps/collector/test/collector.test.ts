import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { findDate, parseDate, toKstIso } from '../src/lib/dates.js';
import { htmlToText } from '../src/lib/html.js';
import { RegionResolver } from '../src/lib/regions.js';
import { extractSchedules } from '../src/lib/schedule-text.js';
import { parseSeedRegions } from '../src/lib/seed-regions.js';
import { statusFromSchedules } from '../src/lib/status.js';
import { datasets, detailToText, housingTypeOf, isYouthRelevant } from '../src/sources/lh-api.js';
import { parseAttachments, toNotice, type SeoulListResponse } from '../src/sources/seoul-housing.js';

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const seedSql = readFileSync(new URL('../../../supabase/seed.sql', import.meta.url), 'utf8');
const regions = new RegionResolver(parseSeedRegions(seedSql));
const seoulList = JSON.parse(fixture('seoul-list.json')) as SeoulListResponse;
const [priv, pub] = seoulList.resultList;

describe('dates', () => {
  it.each([
    ['2026-11-26', '2026-11-26', null],
    ['2026.07.31.(화)', '2026-07-31', null],
    ['2026. 08. 11. (화) 10:00', '2026-08-11', '10:00'],
    ['‘26. 11. 30. (월) 09:00', '2026-11-30', '09:00'],
    ["'26. 12. 01. (화) 16:00", '2026-12-01', '16:00'],
    ['20261126', '2026-11-26', null],
    ['2026년 3월 5일', '2026-03-05', null],
  ])('%s', (input, date, time) => {
    expect(parseDate(input)).toEqual({ date, time });
  });

  it('없는 날짜는 버린다', () => {
    expect(parseDate('2026.02.30')).toBeNull();
    expect(findDate('추후 개별 연락')).toBeNull();
  });

  it('KST ISO', () => {
    expect(toKstIso({ date: '2026-08-11', time: '10:00' })).toBe('2026-08-11T10:00:00+09:00');
    expect(toKstIso({ date: '2026-08-11', time: null })).toBe('2026-08-11T00:00:00+09:00');
  });
});

describe('htmlToText', () => {
  it('인라인 태그는 붙이고 블록 태그로 줄을 나눈다', () => {
    expect(htmlToText('<p><span>■ </span><span>청약</span><span>: 2026.</span></p><p>&nbsp;</p><p>둘째&amp;줄</p>'))
      .toBe('■ 청약: 2026.\n둘째&줄');
  });
});

describe('extractSchedules', () => {
  it('민간 공고: 같은 날 시간 범위, "추후 개별 연락"은 건너뜀', () => {
    const s = extractSchedules(htmlToText(priv!.content!));
    expect(s.map(x => [x.kind, x.start.date, x.start.time, x.end?.date ?? null, x.end?.time ?? null])).toEqual([
      ['announce', '2026-11-26', null, null, null],
      ['apply_start', '2026-11-30', '09:00', null, null],
      ['apply_end', '2026-11-30', '17:00', null, null],
      ['doc_result', '2026-12-01', '16:00', null, null],
    ]);
  });

  it('공공 공고: 접수 기간·서류제출 기간·당첨자 발표', () => {
    const s = extractSchedules(htmlToText(pub!.content!));
    expect(s.map(x => [x.kind, x.start.date, x.start.time, x.end?.date ?? null])).toEqual([
      ['announce', '2026-07-31', null, null],
      ['apply_start', '2026-08-11', '10:00', null],
      ['apply_end', '2026-08-13', '17:00', null],
      ['doc_result', '2026-08-21', null, null],
      ['doc_submit', '2026-08-31', null, '2026-09-02'],
      ['winner', '2026-12-11', null, null],
    ]);
  });
});

describe('regions', () => {
  it('시드에서 서울·경기·인천 시군구를 읽는다', () => {
    const rows = parseSeedRegions(seedSql);
    expect(rows.filter(r => r.sido === '서울특별시' && r.sigungu).length).toBe(25);
    expect(rows.filter(r => r.sido === '경기도' && r.sigungu).length).toBe(55);
    expect(rows.filter(r => r.sido === '인천광역시' && r.sigungu).length).toBe(11);
    expect(new Set(rows.map(r => r.code)).size).toBe(rows.length);
  });

  it.each([
    ['서울특별시 동대문구 망우로 46', undefined, ['11230', '11000']],
    ['동대문구 망우로 46', '서울특별시', ['11230', '11000']],
    ['경기도 수원시 장안구 파장동', undefined, ['41111', '41000']],
    ['경기 남양주시 별내동', undefined, ['41360', '41000']],
    ['경기도 양주시 옥정동', undefined, ['41630', '41000']],
    ['인천광역시 검단구 원당대로', undefined, ['28290', '28000']],
    ['경기도 어딘가', undefined, ['41000']],
  ])('%s', (addr, def, codes) => {
    expect(regions.resolveAddress(addr, def)).toEqual(codes);
  });
});

describe('서울주거포털', () => {
  const now = new Date('2026-11-26T12:00:00+09:00');

  it('민간 추가모집 공고', () => {
    const atts = parseAttachments(fixture('seoul-view-files.html'));
    const n = toNotice(priv!, atts, { regions, now });
    expect(n).toMatchObject({
      externalId: '6889',
      title: '[민간임대] 회기역 하트리움 추가모집공고',
      housingType: 'youth_safe_private',
      urlOriginal: 'https://soco.seoul.go.kr/youth/bbs/BMSR00015/view.do?boardId=6889&menuNo=400008',
      urlApply: 'https://www.doojin2030.co.kr/',
      publishedAt: '2026-11-26',
      status: 'upcoming',
      regionCodes: ['11000', '11230'],
    });
    expect(n.schedules.find(s => s.kind === 'apply_start')).toEqual({
      kind: 'apply_start', startsAt: '2026-11-30T09:00:00+09:00', endsAt: null, allDay: false, note: '청약신청',
    });
    expect(n.rawText).toContain('첨부파일:\n- 민간_261126_회기역_하트리움_청년안심주택 추가모집공고문.pdf https://soco.seoul.go.kr/coHouse/cmmn/file/fileDown.do?atchFileId=bc4bd28b5422432ebed557718c6263ab&fileSn=1');
    expect(atts).toHaveLength(1);
  });

  it('공공 모집공고: 위치가 없으면 서울 전체 코드, 접수 끝난 공고는 closed', () => {
    const n = toNotice(pub!, [], { regions, now });
    expect(n.housingType).toBe('youth_safe_public');
    expect(n.regionCodes).toEqual(['11000']);
    expect(n.status).toBe('closed');
    expect(n.urlApply).toBe('https://www.i-sh.co.kr/app/index.do');
    expect(toNotice(pub!, [], { regions, now: new Date('2026-08-12T09:00:00+09:00') }).status).toBe('open');
  });

  it('본문에 일정이 없으면 목록 칸(게시일·청약신청일)으로 채운다', () => {
    const n = toNotice({ ...priv!, content: '<p>첨부 공고문 참조</p>' }, [], { regions, now });
    expect(n.schedules.map(s => [s.kind, s.startsAt, s.allDay])).toEqual([
      ['announce', '2026-11-26T00:00:00+09:00', true],
      ['apply_start', '2026-11-30T00:00:00+09:00', true],
    ]);
  });
});

describe('status', () => {
  const sch = (kind: 'apply_start' | 'apply_end', startsAt: string, allDay: boolean) =>
    ({ kind, startsAt, endsAt: null, allDay, note: null });

  it('마감일만 날짜면 그날 끝까지 접수', () => {
    const s = [sch('apply_start', '2026-12-01T00:00:00+09:00', true), sch('apply_end', '2026-12-03T00:00:00+09:00', true)];
    expect(statusFromSchedules(s, new Date('2026-12-03T23:00:00+09:00'))).toBe('open');
    expect(statusFromSchedules(s, new Date('2026-12-04T00:00:00+09:00'))).toBe('closed');
    expect(statusFromSchedules(s, new Date('2026-11-30T23:59:00+09:00'))).toBe('upcoming');
  });

  it('접수 일정이 없으면 null', () => {
    expect(statusFromSchedules([], new Date())).toBeNull();
  });
});

describe('LH 응답 다루기', () => {
  it('데이터셋을 이름별로 모은다', () => {
    const ds = datasets([{ dsSch: [{ PAGE: '1' }] }, { dsList: [{ PAN_ID: 'A' }, { PAN_ID: 'B' }], resHeader: [{ SS_CODE: 'Y' }] }]);
    expect(ds.dsList).toHaveLength(2);
    expect(detailToText(ds)).toBe('[dsList #1]\nPAN_ID: A\n[dsList #2]\nPAN_ID: B');
  });

  it('청년 관련 유형만', () => {
    expect(isYouthRelevant({ AIS_TP_CD_NM: '행복주택', PAN_NM: '남양주별내 행복주택 입주자 모집' })).toBe(true);
    expect(isYouthRelevant({ AIS_TP_CD_NM: '국민임대', PAN_NM: '수원 국민임대 예비입주자 모집' })).toBe(false);
    expect(housingTypeOf({ AIS_TP_CD_NM: '행복주택', PAN_NM: 'x' })).toBe('happy_house');
    expect(housingTypeOf({ AIS_TP_CD_NM: '매입임대', PAN_NM: '2026년 청년 매입임대주택 입주자 모집' })).toBe('youth_purchase_rental');
  });
});
