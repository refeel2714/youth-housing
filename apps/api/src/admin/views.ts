// 검수 화면 HTML(서버 렌더링). 운영자 데스크톱 기준, 상자 없이 줄과 여백으로 나눈다.
// 왼쪽: 수집 원문, 오른쪽: 고칠 필드. 원문을 보며 일정·자격 조건을 맞춘 뒤 승인한다.
import {
  HOMELESS_SCOPES, HOUSING_TYPE_LABELS, HOUSING_TYPES, INCOME_BASES, SCHEDULE_KIND_LABELS, SCHEDULE_KINDS,
  TARGET_GROUP_LABELS, TARGET_GROUPS, type HousingType,
} from '@yh/schema/constants';
import { html, raw } from 'hono/html';
import { emptyRule, emptySchedule, type FieldErrors, type NoticeForm, type RuleForm, type ScheduleForm } from './form.js';
import type { LoadedNotice, NoticeMeta, ParseStatus, QueueItem, QueueTab, RegionRow, UnitRow } from './queries.js';

type H = ReturnType<typeof html>;

const TAB_LABELS: Record<QueueTab, string> = {
  queue: '검수 대기', recheck: '다시 확인', verified: '공개 중', rejected: '반려',
};
const PARSE_LABELS: Record<ParseStatus, string> = {
  pending: '대기', llm_parsed: '자동 파싱됨', verified: '공개 중', rejected: '반려',
};
const HOMELESS_LABELS: Record<string, string> = { self: '본인 무주택', household: '세대 전원 무주택', none: '조건 없음' };
const INCOME_LABELS: Record<string, string> = { median: '기준중위소득', urban_worker: '도시근로자 월평균소득' };
const EXTRA_LABELS: Record<string, string> = {
  studentOnly: '학생만', unmarriedOnly: '미혼만', marriedOnly: '기혼만', householderOnly: '세대주만',
};

const CSS = `
:root{--bg:#fff;--fill:#f2f4f6;--line:#e5e8eb;--hair:#f2f4f6;--text:#191f28;--sub:#4e5968;--muted:#8b95a1;
--primary:#3182f6;--danger:#f04452;--ok:#03b26c;--warn:#c27803;color-scheme:light;
font-family:Pretendard,-apple-system,BlinkMacSystemFont,'Apple SD Gothic Neo','Noto Sans KR','Malgun Gothic',sans-serif;
font-variant-numeric:tabular-nums;color:var(--text);background:var(--bg);font-size:14px;line-height:1.5}
@media (prefers-color-scheme:dark){:root{--bg:#101113;--fill:#1d1f22;--line:#2c2f33;--hair:#1d1f22;--text:#e8eaed;
--sub:#b0b8c1;--muted:#7e8894;color-scheme:dark}}
*{box-sizing:border-box}body{margin:0;background:var(--bg)}a{color:var(--primary);text-decoration:none}
a:hover{text-decoration:underline}
header.top{display:flex;align-items:center;gap:16px;padding:12px 24px;border-bottom:1px solid var(--line)}
header.top h1{font-size:16px;margin:0}header.top .who{margin-left:auto;color:var(--sub)}
main{padding:20px 24px;max-width:1400px;margin:0 auto}
nav.tabs{display:flex;gap:20px;border-bottom:1px solid var(--line);margin-bottom:12px}
nav.tabs a{padding:8px 0;color:var(--sub);border-bottom:2px solid transparent}
nav.tabs a.on{color:var(--text);font-weight:700;border-color:var(--text)}
nav.tabs .n{color:var(--muted);margin-left:4px;font-weight:400}
.rows{list-style:none;margin:0;padding:0}.rows li{border-bottom:1px solid var(--hair);padding:12px 0}
.rows .t{font-weight:600;color:var(--text)}.meta{color:var(--muted);font-size:13px}
.meta span+span::before{content:'·';margin:0 6px}
.badge{display:inline-block;font-size:12px;padding:1px 6px;border-radius:6px;background:var(--fill);color:var(--sub);margin-right:6px}
.badge.verified{color:var(--ok)}.badge.rejected{color:var(--danger)}.badge.warn{color:var(--warn)}
input,select,textarea{font:inherit;color:inherit;background:var(--fill);border:1px solid transparent;border-radius:8px;padding:6px 8px;min-width:0}
input:focus,select:focus,textarea:focus{outline:none;border-color:var(--primary)}
textarea{width:100%;resize:vertical}
button{font:inherit;border:0;border-radius:8px;padding:8px 14px;cursor:pointer;background:var(--fill);color:var(--text)}
button.primary{background:var(--primary);color:#fff;font-weight:600}button.danger{color:var(--danger)}
button.link{background:none;padding:4px 0;color:var(--primary)}
.search{display:flex;gap:8px;margin:0 0 8px}
.split{display:grid;grid-template-columns:minmax(0,5fr) minmax(0,7fr);gap:32px;align-items:start}
@media (max-width:1000px){.split{grid-template-columns:1fr}}
.source{position:sticky;top:12px;max-height:calc(100vh - 24px);overflow:auto;padding-right:8px}
.source pre{white-space:pre-wrap;word-break:break-all;font:inherit;font-size:13px;color:var(--sub);margin:0}
.source mark{background:#fff3c4;color:#191f28}
h2{font-size:15px;margin:28px 0 8px;padding-top:16px;border-top:1px solid var(--line)}h2:first-child{margin-top:0;border-top:0;padding-top:0}
h3{font-size:14px;margin:0 0 8px}
.field{display:grid;grid-template-columns:120px minmax(0,1fr);gap:8px 12px;align-items:center;margin-bottom:8px}
.field>label{color:var(--sub)}.field input[type=text],.field input[type=url],.field select{width:100%}
.err{color:var(--danger);font-size:12px}.err-box{color:var(--danger);margin:0 0 12px}
.notice{padding:8px 0;color:var(--warn)}.flash{padding:8px 0;color:var(--ok)}
table.sched{width:100%;border-collapse:collapse}table.sched td,table.sched th{padding:4px 6px 4px 0;text-align:left;vertical-align:top}
table.sched th{color:var(--muted);font-weight:400;font-size:12px}
table.sched input[type=date]{width:140px}table.sched input[type=time]{width:96px}table.sched input.note{width:100%}
.rule{padding:12px 0;border-bottom:1px solid var(--hair)}
.rule .grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px 12px}
.rule .grid label{display:flex;flex-direction:column;gap:2px;color:var(--sub);font-size:12px}
.rule .grid label input,.rule .grid label select{width:100%}.rule .wide{grid-column:span 2}.rule .full{grid-column:1/-1}
.checks{display:flex;gap:12px;flex-wrap:wrap;align-items:center}.checks label{display:flex;gap:4px;align-items:center;white-space:nowrap;color:var(--text)!important;font-size:13px!important;flex-direction:row!important}
details.regions summary{cursor:pointer;color:var(--sub);padding:4px 0}
.regiongrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:2px 8px;padding:4px 0 8px}
.regiongrid label{display:flex;gap:4px;align-items:center;font-size:13px}
.actions{position:sticky;bottom:0;background:var(--bg);border-top:1px solid var(--line);padding:12px 0;margin-top:24px;
display:flex;gap:8px;flex-wrap:wrap;align-items:center}.actions .gap{flex:1}
.hint{color:var(--muted);font-size:12px}
table.units{border-collapse:collapse;font-size:13px}table.units td,table.units th{padding:4px 12px 4px 0;text-align:left}
table.units th{color:var(--muted);font-weight:400}
.login{max-width:320px;margin:15vh auto;display:flex;flex-direction:column;gap:10px}
.login h1{font-size:18px;margin:0 0 8px}
.pager{display:flex;gap:16px;padding:12px 0}
`;

function page(title: string, body: H | string, reviewer?: string): H {
  return html`<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>${title} · 청년주택 검수</title><style>${raw(CSS)}</style></head>
<body>${reviewer
    ? html`<header class="top"><h1><a href="/admin" style="color:inherit">청년주택 공고 검수</a></h1>
<span class="who">${reviewer}</span>
<form method="post" action="/admin/logout" style="margin:0"><button class="link" type="submit">로그아웃</button></form></header>`
    : ''}
<main>${body}</main></body></html>`;
}

export function loginPage(o: { error?: string; name?: string; disabled?: boolean }): H {
  if (o.disabled) {
    return page('검수 꺼짐', html`<div class="login"><h1>관리자 화면이 꺼져 있습니다</h1>
<p class="hint">서버 환경변수 ADMIN_PASSWORD(8자 이상)와 SESSION_SECRET(16자 이상)을 넣으면 켜집니다.</p></div>`);
  }
  return page('로그인', html`<form class="login" method="post" action="/admin/login">
<h1>청년주택 공고 검수</h1>
${o.error ? html`<p class="err-box">${o.error}</p>` : ''}
<input name="name" placeholder="이름(검수자 표기)" value="${o.name ?? ''}" maxlength="20" required autocomplete="username">
<input name="password" type="password" placeholder="관리자 비밀번호" required autocomplete="current-password">
<button class="primary" type="submit">로그인</button></form>`);
}

const typeLabel = (t: string) => HOUSING_TYPE_LABELS[t as HousingType] ?? t;

export function queuePage(o: {
  reviewer: string; tab: QueueTab; counts: Record<QueueTab, number>; items: QueueItem[];
  q: string; offset: number; limit: number; hasMore: boolean; flash?: string;
}): H {
  const qs = (extra: Record<string, string | number>) =>
    '?' + new URLSearchParams({ tab: o.tab, ...(o.q ? { q: o.q } : {}), ...Object.fromEntries(Object.entries(extra).map(([k, v]) => [k, String(v)])) }).toString();
  const body = html`
${o.flash ? html`<p class="flash">${o.flash}</p>` : ''}
<nav class="tabs">${(Object.keys(TAB_LABELS) as QueueTab[]).map(t => html`<a href="/admin?tab=${t}" class="${t === o.tab ? 'on' : ''}">${TAB_LABELS[t]}<span class="n">${o.counts[t]}</span></a>`)}</nav>
<form class="search" method="get" action="/admin"><input type="hidden" name="tab" value="${o.tab}">
<input name="q" value="${o.q}" placeholder="제목 또는 공고 번호" style="width:280px"><button type="submit">찾기</button></form>
${o.tab === 'recheck' ? html`<p class="hint">검수 뒤 수집기가 원문 본문이 바뀐 것을 가져온 공고입니다. 바뀐 내용을 확인하고 다시 저장하면 목록에서 빠집니다.</p>` : ''}
${o.items.length === 0 ? html`<p class="meta" style="padding:24px 0">공고가 없습니다.</p>` : ''}
<ul class="rows">${o.items.map(i => html`<li>
<a class="t" href="/admin/notices/${i.id}">${i.title}</a>
<div class="meta"><span><span class="badge ${i.parseStatus}">${PARSE_LABELS[i.parseStatus]}</span>${i.sourceName}</span>
<span>${typeLabel(i.housingType)}</span>
${i.publishedAt ? html`<span>공고 ${i.publishedAt}</span>` : ''}
<span>${i.applyStart || i.applyEnd ? `접수 ${i.applyStart ?? '?'} ~ ${i.applyEnd ?? '?'}` : '접수 일정 없음'}</span>
<span>일정 ${i.scheduleCount} · 자격 ${i.ruleCount}</span>
<span>수집 ${i.collectedAt}</span>
${i.verifiedBy ? html`<span>${i.parseStatus === 'rejected' ? '반려' : '검수'} ${i.verifiedBy} ${i.verifiedAt ?? ''}</span>` : ''}
${i.reviewNote ? html`<span>메모: ${i.reviewNote}</span>` : ''}</div></li>`)}</ul>
<div class="pager">${o.offset > 0 ? html`<a href="/admin${qs({ offset: Math.max(o.offset - o.limit, 0) })}">← 이전</a>` : ''}
${o.hasMore ? html`<a href="/admin${qs({ offset: o.offset + o.limit })}">다음 →</a>` : ''}</div>`;
  return page(TAB_LABELS[o.tab], body, o.reviewer);
}

const opt = (value: string, label: string, cur: string) =>
  html`<option value="${value}" ${cur === value ? raw('selected') : ''}>${label}</option>`;
const err = (e: FieldErrors, k: string) => (e[k] ? html`<div class="err">${e[k]}</div>` : '');
const checked = (b: boolean) => (b ? raw('checked') : '');

function scheduleRow(s: ScheduleForm, i: number | '__I__', e: FieldErrors): H {
  const p = `s${i}.`;
  return html`<tr>
<td><select name="${p}kind"><option value="">종류</option>${SCHEDULE_KINDS.map(k => opt(k, SCHEDULE_KIND_LABELS[k], s.kind))}</select>${err(e, p + 'kind')}</td>
<td><input type="date" name="${p}date" value="${s.date}">${err(e, p + 'date')}</td>
<td><input type="time" name="${p}time" value="${s.time}">${err(e, p + 'time')}</td>
<td><input type="date" name="${p}endDate" value="${s.endDate}">${err(e, p + 'endDate')}</td>
<td><input type="time" name="${p}endTime" value="${s.endTime}">${err(e, p + 'endTime')}</td>
<td><input class="note" name="${p}note" value="${s.note}" maxlength="200">${err(e, p + 'note')}</td>
<td><label title="삭제"><input type="checkbox" name="${p}del" value="1" ${checked(s.del)}> 삭제</label></td></tr>`;
}

function ruleBlock(r: RuleForm, i: number | '__I__', e: FieldErrors): H {
  const p = `r${i}.`;
  const lbl = (k: string, title: string, input: H, cls = '') =>
    html`<label class="${cls}">${title}${input}${err(e, p + k)}</label>`;
  const text = (k: keyof RuleForm, ph = '', type = 'text') =>
    html`<input type="${type}" name="${p}${k}" value="${String(r[k])}" placeholder="${ph}">`;
  return html`<div class="rule">
<div class="grid">
${lbl('targetGroup', '대상', html`<select name="${p}targetGroup">${TARGET_GROUPS.map(t => opt(t, TARGET_GROUP_LABELS[t], r.targetGroup))}</select>`)}
${lbl('variant', '구분(같은 대상이 여럿일 때)', text('variant', '예: 1순위'))}
${lbl('ageMin', '나이 최소(만)', text('ageMin', '19', 'number'))}
${lbl('ageMax', '나이 최대(만)', text('ageMax', '39', 'number'))}
${lbl('ageRefDate', '나이 기준일', text('ageRefDate', '', 'date'))}
${lbl('homelessScope', '무주택', html`<select name="${p}homelessScope">${opt('', '조건 없음/모름', r.homelessScope)}${HOMELESS_SCOPES.filter(h => h !== 'none').map(h => opt(h, HOMELESS_LABELS[h]!, r.homelessScope))}</select>`)}
${lbl('residenceCodes', '거주 요건 지역 코드', text('residenceCodes', '예: 11000, 41110'), 'wide')}
${lbl('incomeBasis', '소득 기준', html`<select name="${p}incomeBasis">${opt('', '소득 조건 없음', r.incomeBasis)}${INCOME_BASES.map(b => opt(b, INCOME_LABELS[b]!, r.incomeBasis))}</select>`)}
${lbl('incomeYear', '기준 연도', text('incomeYear', '2026', 'number'))}
${lbl('incomePct', '비율(%) — 전체 또는 가구원별', text('incomePct', '100 또는 1:120, 2:110, 3-8:100'), 'wide')}
${lbl('assetMaxMan', '총자산 상한(만원)', text('assetMaxMan', '33700'))}
${lbl('carMaxMan', '자동차 상한(만원)', text('carMaxMan', '3708'))}
<div class="full checks">${Object.entries(EXTRA_LABELS).map(([k, label]) =>
    html`<label><input type="checkbox" name="${p}${k}" value="1" ${checked(r.extra[k as keyof RuleForm['extra']])}> ${label}</label>`)}
${err(e, p + 'extra')}
<span class="gap" style="flex:1"></span><label><input type="checkbox" name="${p}del" value="1" ${checked(r.del)}> 이 조건 삭제</label></div>
<label class="full">근거 원문(공고 문구를 붙여 두기)<textarea name="${p}sourceClause" rows="2">${r.sourceClause}</textarea>${err(e, p + 'sourceClause')}</label>
</div></div>`;
}

function regionPicker(selected: string[], regions: RegionRow[], e: FieldErrors): H {
  const set = new Set(selected);
  const sidos = regions.filter(r => r.sigungu === null);
  const name = (r: RegionRow) => r.sigungu ?? `${r.sido} 전체`;
  const summary = regions.filter(r => set.has(r.code)).map(r => (r.sigungu ? `${r.sigungu}` : `${r.sido} 전체`)).join(', ');
  return html`<div>${summary ? html`<div>${summary}</div>` : html`<div class="hint">고른 지역 없음</div>`}
${sidos.map(s => {
    const list = regions.filter(r => r.sido === s.sido);
    const any = list.some(r => set.has(r.code));
    return html`<details class="regions" ${any ? raw('open') : ''}><summary>${s.sido}</summary><div class="regiongrid">
${list.map(r => html`<label><input type="checkbox" name="region" value="${r.code}" ${checked(set.has(r.code))}> ${name(r)} <span class="hint">${r.code}</span></label>`)}
</div></details>`;
  })}
<div class="hint">구까지 고르면 시도·상위 시 코드는 저장할 때 자동으로 붙습니다.</div>${err(e, 'region')}</div>`;
}

function unitsTable(units: UnitRow[]): H | string {
  if (units.length === 0) return '';
  const won = (v: string | null) => (v === null ? '' : `${Math.round(Number(v) / 10000).toLocaleString('ko-KR')}만`);
  return html`<h2>공급 세대(수집값, 읽기 전용)</h2><table class="units"><tr><th>단지</th><th>대상</th><th>주택형</th><th>면적</th><th>보증금</th><th>월세</th><th>호수</th></tr>
${units.map(u => html`<tr><td>${u.complexName ?? ''}</td><td>${TARGET_GROUP_LABELS[u.targetGroup as keyof typeof TARGET_GROUP_LABELS] ?? u.targetGroup}</td>
<td>${u.unitType ?? ''}</td><td>${u.areaM2 ?? ''}</td><td>${won(u.deposit)}</td><td>${won(u.monthlyRent)}</td><td>${u.supplyCount ?? ''}</td></tr>`)}</table>`;
}

/** 원문에서 날짜·금액·나이·비율처럼 검수에 필요한 숫자를 표시 */
function highlight(text: string): H {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const re = /(\d{2,4}\s*[.\-/년]\s*\d{1,2}\s*[.\-/월]\s*\d{1,2}\s*일?|\d{1,2}\s*:\s*\d{2}|만\s*\d{1,2}\s*세|\d{1,3}(?:,\d{3})+\s*(?:천)?원|\d+(?:\.\d+)?\s*%|\d+\s*만\s*원)/g;
  return html`${raw(esc(text).replace(re, m => `<mark>${m}</mark>`))}`;
}

function statusLine(m: NoticeMeta): H {
  return html`<div class="meta"><span><span class="badge ${m.parseStatus}">${PARSE_LABELS[m.parseStatus]}</span>${m.sourceName} ${m.externalId}</span>
<span>수집 ${m.collectedAt}</span><span>마지막 변경 ${m.updatedAt}</span>
${m.verifiedBy ? html`<span>${m.parseStatus === 'rejected' ? '반려' : '검수'} ${m.verifiedBy} ${m.verifiedAt ?? ''}</span>` : ''}</div>`;
}

export function noticePage(o: {
  reviewer: string; loaded: LoadedNotice; form: NoticeForm; regions: RegionRow[]; errors: FieldErrors;
  seenHash: string | null; flash?: string;
}): H {
  const { meta, units, latestParse } = o.loaded;
  const f = o.form;
  const e = o.errors;
  const schedules = [...f.schedules, emptySchedule(), emptySchedule()];
  const rules = f.rules.length > 0 ? f.rules : [];
  const verified = meta.parseStatus === 'verified';
  const hasErrors = Object.keys(e).length > 0;

  const body = html`
<p><a href="/admin">← 목록</a></p>
${o.flash ? html`<p class="flash">${o.flash}</p>` : ''}
<h1 style="font-size:18px;margin:4px 0">${f.title || '(제목 없음)'}</h1>
${statusLine(meta)}
${meta.bodyChangedSinceApproval ? html`<p class="notice">검수 뒤 원문 본문이 바뀌었습니다. 왼쪽 원문을 다시 보고 일정·자격 조건을 맞춘 뒤 저장해 주세요.</p>` : ''}
${hasErrors ? html`<p class="err-box">입력을 확인해 주세요. ${e.schedules ?? ''}</p>` : ''}
<div class="split" style="margin-top:16px">
<section class="source">
<h2>수집 원문</h2>
<p><a href="${f.urlOriginal}" target="_blank" rel="noopener noreferrer">원문 페이지 열기 ↗</a>
${f.urlApply ? html` · <a href="${f.urlApply}" target="_blank" rel="noopener noreferrer">신청 페이지 ↗</a>` : ''}</p>
${meta.rawText ? html`<pre>${highlight(meta.rawText)}</pre>` : html`<p class="hint">수집된 본문이 없습니다. 원문 페이지에서 확인해 주세요.</p>`}
${latestParse ? html`<details style="margin-top:16px"><summary class="meta">자동 파싱 결과 (${latestParse.model}, ${latestParse.createdAt})</summary>
<pre>${JSON.stringify(latestParse.output, null, 2)}</pre></details>` : ''}
${unitsTable(units)}
</section>

<form method="post" action="/admin/notices/${meta.id}" id="edit">
<input type="hidden" name="seen_hash" value="${o.seenHash ?? ''}">
<h2>기본 정보</h2>
<div class="field"><label>제목</label><div><input type="text" name="title" value="${f.title}" maxlength="200">${err(e, 'title')}</div></div>
<div class="field"><label>주택 유형</label><div><select name="housingType">${HOUSING_TYPES.map(t => opt(t, HOUSING_TYPE_LABELS[t], f.housingType))}</select>${err(e, 'housingType')}</div></div>
<div class="field"><label>원문 주소</label><div><input type="url" name="urlOriginal" value="${f.urlOriginal}">${err(e, 'urlOriginal')}</div></div>
<div class="field"><label>신청 주소</label><div><input type="url" name="urlApply" value="${f.urlApply}" placeholder="없으면 비움">${err(e, 'urlApply')}</div></div>
<div class="field"><label>공고일</label><div><input type="date" name="publishedAt" value="${f.publishedAt}">${err(e, 'publishedAt')}</div></div>
<div class="field"><label>취소</label><div><label><input type="checkbox" name="cancelled" value="1" ${checked(f.cancelled)}> 취소·철회된 공고</label></div></div>
<div class="field" style="align-items:start"><label>지역</label>${regionPicker(f.regionCodes, o.regions, e)}</div>

<h2>일정 <span class="hint">한국시간. 시각을 비우면 종일. 끝 날짜는 기간이 있는 일정만(서류 제출 기간 등). 빈 행은 무시합니다.</span></h2>
<table class="sched"><thead><tr><th>종류</th><th>날짜</th><th>시각</th><th>끝 날짜</th><th>끝 시각</th><th>메모</th><th></th></tr></thead>
<tbody id="sched-rows">${schedules.map((s, i) => scheduleRow(s, i, e))}</tbody></table>
<input type="hidden" name="s_count" id="s_count" value="${schedules.length}">
<button type="button" class="link" data-add="sched">+ 일정 행 추가</button>
<template id="sched-tpl">${scheduleRow(emptySchedule(), '__I__', {})}</template>

<h2>자격 조건 <span class="hint">비운 칸은 "조건 없음"으로 판정합니다. 공고에 없는 조건만 비워 두세요.</span></h2>
<div id="rule-rows">${rules.map((r, i) => ruleBlock(r, i, e))}</div>
${rules.length === 0 ? html`<p class="hint" id="no-rules">아직 자격 조건이 없습니다. 판정에 쓰려면 대상별로 추가해 주세요.</p>` : ''}
<input type="hidden" name="r_count" id="r_count" value="${rules.length}">
<button type="button" class="link" data-add="rule">+ 자격 조건 추가</button>
<template id="rule-tpl">${ruleBlock(emptyRule(), '__I__', {})}</template>

<h2>검수 메모</h2>
<textarea name="reviewNote" rows="2" maxlength="500" placeholder="반려 사유, 원문과 다른 점 등(공개 화면에는 안 보임)">${f.reviewNote}</textarea>${err(e, 'reviewNote')}

<div class="actions">
${verified
    ? html`<button class="primary" name="action" value="approve">수정 저장(공개 유지)</button>
<button name="action" value="unpublish" formnovalidate>공개 내리기(검수 대기로)</button>`
    : html`<button class="primary" name="action" value="approve">승인하고 공개</button>
<button name="action" value="save">임시 저장</button>`}
<span class="gap"></span>
${meta.parseStatus === 'rejected'
    ? html`<span class="hint">반려된 공고입니다. 승인하면 다시 공개됩니다.</span>`
    : html`<button class="danger" name="action" value="reject" formnovalidate data-confirm="반려할까요? 공개 화면에서 빠지고 수집기가 다시 대기열에 올리지 않습니다.">반려</button>`}
</div>
</form>
</div>
<script>${raw(SCRIPT)}</script>`;
  return page(f.title || '공고', body, o.reviewer);
}

// 행 추가(템플릿 복제)와 반려 확인. 서버는 s_count·r_count 까지 읽는다.
const SCRIPT = `
document.querySelectorAll('[data-add]').forEach(function(btn){btn.addEventListener('click',function(){
  var k=btn.getAttribute('data-add');var countEl=document.getElementById(k==='sched'?'s_count':'r_count');
  var i=Number(countEl.value);var tpl=document.getElementById(k+'-tpl').innerHTML.split('__I__').join(String(i));
  var box=document.getElementById(k==='sched'?'sched-rows':'rule-rows');
  if(k==='sched'){var tb=document.createElement('tbody');tb.innerHTML=tpl;box.appendChild(tb.firstElementChild);}
  else{var d=document.createElement('div');d.innerHTML=tpl;box.appendChild(d.firstElementChild);var n=document.getElementById('no-rules');if(n)n.remove();}
  countEl.value=String(i+1);});});
document.querySelectorAll('[data-confirm]').forEach(function(b){b.addEventListener('click',function(ev){
  if(!window.confirm(b.getAttribute('data-confirm')))ev.preventDefault();});});
`;

export function notFoundPage(reviewer: string): H {
  return page('없음', html`<p>공고를 찾을 수 없습니다. <a href="/admin">목록으로</a></p>`, reviewer);
}
