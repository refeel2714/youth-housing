import { describe, expect, it } from 'vitest';
import { LoginLimiter, cleanName, signSession, verifySession } from '../src/admin/auth.js';
import { emptyRule, emptySchedule, formatIncomePct, formFromBody, parseIncomePct, parseNoticeForm, type NoticeForm } from '../src/admin/form.js';
import { expandRegionCodes, selectedRegionCodes } from '../src/admin/queries.js';

const cfg = { password: 'testpass123', secret: '0123456789abcdef0123' };

describe('관리자 세션', () => {
  it('서명한 쿠키는 이름을 돌려주고, 위조·만료는 거부', () => {
    const t = signSession(cfg, '리필', 1_000);
    expect(verifySession(cfg, t, 2_000)).toBe('리필');
    expect(verifySession(cfg, t, 1_000 + 13 * 3600_000)).toBeNull();
    expect(verifySession({ ...cfg, secret: 'another-secret-value' }, t, 2_000)).toBeNull();
    const [payload] = t.split('.');
    const forged = Buffer.from(JSON.stringify({ n: 'x', e: 9e15 })).toString('base64url');
    expect(verifySession(cfg, t.replace(payload!, forged), 2_000)).toBeNull();
    expect(verifySession(cfg, 'garbage', 2_000)).toBeNull();
  });
  it('이름 정리', () => {
    expect(cleanName('  리필 ')).toBe('리필');
    expect(cleanName('')).toBeNull();
    expect(cleanName('가'.repeat(21))).toBeNull();
  });
  it('로그인 실패 제한', () => {
    const l = new LoginLimiter(3, 1000);
    for (let i = 0; i < 3; i++) l.fail('ip', 0);
    expect(l.blocked('ip', 10)).toBe(true);
    expect(l.blocked('ip', 2000)).toBe(false);
  });
});

describe('소득 비율 입력', () => {
  it('숫자 하나는 1~8인 모두', () => {
    expect(parseIncomePct('100')).toEqual({ 1: 100, 2: 100, 3: 100, 4: 100, 5: 100, 6: 100, 7: 100, 8: 100 });
  });
  it('가구원별·범위', () => {
    const m = parseIncomePct('1:120, 2:110, 3-8:100');
    expect(m).toMatchObject({ 1: 120, 2: 110, 3: 100, 8: 100 });
    expect(formatIncomePct(m as Record<string, number>)).toBe('1:120, 2:110, 3-8:100');
    expect(formatIncomePct(parseIncomePct('70') as Record<string, number>)).toBe('70');
  });
  it('잘못된 입력', () => {
    for (const s of ['abc', '9:100', '3-1:100', '1:0', '1:']) expect(parseIncomePct(s)).toBe('error');
    expect(parseIncomePct('')).toBeNull();
  });
});

const ctx = { regionCodes: new Set(['11000', '11590', '41000', '41110', '41117']) };
const base = (): NoticeForm => ({
  title: '동작구 청년안심주택', housingType: 'youth_safe_public', urlOriginal: 'https://example.com/a', urlApply: '',
  publishedAt: '2026-11-20', cancelled: false, regionCodes: ['11590'], reviewNote: '', schedules: [], rules: [],
});

describe('검수 폼 검사', () => {
  it('일정: 한국시간, 종일·시각, 같은 종류는 차수', () => {
    const f = base();
    f.schedules = [
      { ...emptySchedule(), kind: 'doc_submit', date: '2026-12-20', endDate: '2026-12-22' },
      { ...emptySchedule(), kind: 'apply_start', date: '2026-12-08', time: '10:00' },
      { ...emptySchedule(), kind: 'doc_submit', date: '2026-12-15' },
      { ...emptySchedule() },                                            // 빈 행
      { ...emptySchedule(), kind: 'winner', date: '2026-12-30', del: true },
    ];
    const r = parseNoticeForm(f, ctx, { approve: true });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const s = r.value.schedules;
    expect(s.map(x => `${x.kind}:${x.seq}`)).toEqual(['apply_start:1', 'doc_submit:1', 'doc_submit:2']);
    expect(s[0]!.startsAt.toISOString()).toBe('2026-12-08T01:00:00.000Z');
    expect(s[0]!.allDay).toBe(false);
    expect(s[2]).toMatchObject({ allDay: true, startsAt: new Date('2026-12-19T15:00:00Z'), endsAt: new Date('2026-12-21T15:00:00Z') });
  });
  it('일정 오류: 끝이 시작보다 빠름, 시각 일정의 끝 시각 누락', () => {
    const f = base();
    f.schedules = [
      { ...emptySchedule(), kind: 'doc_submit', date: '2026-12-20', endDate: '2026-12-19' },
      { ...emptySchedule(), kind: 'apply_start', date: '2026-12-08', time: '10:00', endDate: '2026-12-10' },
      { ...emptySchedule(), kind: 'nope', date: '2026-02-30' },
    ];
    const r = parseNoticeForm(f, ctx, { approve: false });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(Object.keys(r.errors).sort()).toEqual(['s0.endDate', 's1.endTime', 's2.date', 's2.kind']);
  });
  it('승인은 일정·지역이 있어야 한다(임시 저장은 괜찮음)', () => {
    const f = { ...base(), regionCodes: [] };
    expect(parseNoticeForm(f, ctx, { approve: false }).ok).toBe(true);
    const r = parseNoticeForm(f, ctx, { approve: true });
    expect(!r.ok && Object.keys(r.errors).sort()).toEqual(['region', 'schedules']);
  });
  it('자격 조건: 만원 → 원, 소득 기준은 연도·비율 필수, 중복 대상 거부', () => {
    const f = base();
    f.rules = [
      { ...emptyRule(), ageMin: '19', ageMax: '39', homelessScope: 'self', incomeBasis: 'urban_worker', incomeYear: '2025',
        incomePct: '100', assetMaxMan: '33,700', carMaxMan: '3708', residenceCodes: '11000, 41110',
        extra: { ...emptyRule().extra, unmarriedOnly: true } },
    ];
    const r = parseNoticeForm(f, ctx, { approve: false });
    expect(r.ok && r.value.rules[0]).toMatchObject({
      ageMin: 19, ageMax: 39, homelessScope: 'self', incomeYear: 2025, assetMax: 337_000_000, carValueMax: 37_080_000,
      residenceCodes: ['11000', '41110'], extra: { unmarriedOnly: true },
    });
    f.rules.push({ ...emptyRule(), incomeBasis: 'median' }, { ...emptyRule(), residenceCodes: '99999', ageMin: '40', ageMax: '30' });
    const bad = parseNoticeForm(f, ctx, { approve: false });
    expect(!bad.ok && Object.keys(bad.errors).sort()).toEqual([
      'r1.incomePct', 'r1.incomeYear', 'r1.variant', 'r2.ageMax', 'r2.residenceCodes', 'r2.variant',
    ]);
  });
  it('요청 본문 → 폼(번호 붙은 행, 체크박스, 지역 여러 개)', () => {
    const f = formFromBody({
      title: ' 제목 ', housingType: 'happy_house', urlOriginal: 'https://x.test', region: ['11590', '11590', '41117'],
      s_count: '2', 's0.kind': 'announce', 's0.date': '2026-11-20', 's1.kind': '', 'r_count': '1',
      'r0.targetGroup': 'youth', 'r0.studentOnly': '1', cancelled: '1',
    });
    expect(f).toMatchObject({ title: '제목', cancelled: true, regionCodes: ['11590', '41117'] });
    expect(f.schedules).toHaveLength(2);
    expect(f.rules[0]!.extra).toMatchObject({ studentOnly: true, marriedOnly: false });
  });
});

describe('지역 코드', () => {
  const regions = [
    { code: '11000', sido: '서울특별시', sigungu: null }, { code: '11590', sido: '서울특별시', sigungu: '동작구' },
    { code: '41000', sido: '경기도', sigungu: null }, { code: '41110', sido: '경기도', sigungu: '수원시' },
    { code: '41117', sido: '경기도', sigungu: '수원시 영통구' },
  ];
  it('저장할 때 시도·상위 시를 붙이고, 화면에서는 가장 좁은 것만 체크', () => {
    const stored = expandRegionCodes(['11590', '41117'], regions);
    expect(stored).toEqual(['11000', '11590', '41000', '41110', '41117']);
    expect(selectedRegionCodes(stored, regions)).toEqual(['11590', '41117']);
    expect(selectedRegionCodes(['11000'], regions)).toEqual(['11000']);
  });
});
