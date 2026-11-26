// 30초 자격 진단: 판정에 쓰는 조건만 빠르게 고른다. 금액은 구간으로만 받고 기기에만 저장한다.
import { ASSET_BANDS, CAR_BANDS, INCOME_BANDS, type Profile } from '@yh/eligibility';
import type { RegionView } from '@yh/schema/constants';
import { useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { useFilter } from '../lib/filter';
import { useAsync } from '../lib/useAsync';
import { getProfile, OUTSIDE_METRO, saveProfile } from '../profile/store';

const THIS_YEAR = Number(new Date().toISOString().slice(0, 4));
/** 만 16~50세 정도. 청년 주택은 대부분 만 19~39세 */
const YEARS = Array.from({ length: 35 }, (_, i) => THIS_YEAR - 16 - i);
const SIDOS = [
  { code: '11000', label: '서울' },
  { code: '41000', label: '경기' },
  { code: '28000', label: '인천' },
  { code: OUTSIDE_METRO, label: '그 외' },
];
const HOMELESS: { v: NonNullable<Profile['homelessScope']>; label: string; hint: string }[] = [
  { v: 'household', label: '우리 세대 모두 집 없어요', hint: '주민등록등본에 같이 오른 가족 모두 무주택' },
  { v: 'self', label: '나는 없고, 같이 사는 가족은 있어요', hint: '예: 부모님 명의 집에 같이 살아요' },
  { v: 'none', label: '내 명의 집이 있어요', hint: '분양권·입주권 포함' },
];

export function Diagnose() {
  const nav = useNavigate();
  const f = useFilter();
  const [p, setP] = useState<Profile>(() => getProfile() ?? {});
  const set = <K extends keyof Profile>(k: K, v: Profile[K] | undefined) =>
    setP(prev => {
      const next = { ...prev };
      if (v === undefined) delete next[k]; else next[k] = v;
      return next;
    });
  const sido = p.regionCode ? (SIDOS.find(s => s.code.slice(0, 2) === p.regionCode!.slice(0, 2))?.code ?? '') : '';

  const submit = () => {
    saveProfile(p);
    f.setMine(true);
    nav('/diagnose/result');
  };

  return (
    <main className="page diagnose">
      <header className="page-head">
        <h1>30초 자격 진단</h1>
      </header>
      <p className="muted small lead">
        아는 것만 골라도 돼요. 비워 둔 항목은 ‘확인 필요’로 보여 드려요.
        입력한 조건은 이 기기에만 저장되고 서버로 보내지 않아요.
      </p>

      <form onSubmit={e => { e.preventDefault(); submit(); }}>
        <Field label="태어난 해">
          <div className="inline">
            <select
              aria-label="출생연도"
              value={p.birthYear ?? ''}
              onChange={e => set('birthYear', e.target.value ? Number(e.target.value) : undefined)}
            >
              <option value="">연도 선택</option>
              {YEARS.map(y => <option key={y} value={y}>{y}년</option>)}
            </select>
            <select
              aria-label="태어난 달(선택)"
              value={p.birthMonth ?? ''}
              onChange={e => set('birthMonth', e.target.value ? Number(e.target.value) : undefined)}
            >
              <option value="">월(선택)</option>
              {Array.from({ length: 12 }, (_, i) => i + 1).map(m => <option key={m} value={m}>{m}월</option>)}
            </select>
          </div>
          <Hint>달까지 넣으면 만 나이 경계(예: 만 39세)를 정확히 판단해요.</Hint>
        </Field>

        <Field label="사는 곳">
          <Chips
            label="시도"
            options={SIDOS.map(s => ({ v: s.code, label: s.label }))}
            value={sido || undefined}
            onChange={v => set('regionCode', v)}
          />
          {sido && sido !== OUTSIDE_METRO && (
            <SigunguSelect sido={sido} value={p.regionCode} onChange={v => set('regionCode', v)} />
          )}
          <Hint>주민등록상 주소 기준. 거주 요건이 있는 공고(예: 인천 거주자)를 가려요.</Hint>
        </Field>

        <Field label="집이 있나요?">
          <div className="options" role="group" aria-label="주택 보유">
            {HOMELESS.map(o => (
              <button
                key={o.v}
                type="button"
                className="option"
                aria-pressed={p.homelessScope === o.v}
                onClick={() => set('homelessScope', p.homelessScope === o.v ? undefined : o.v)}
              >
                <span>{o.label}</span>
                <span className="muted small">{o.hint}</span>
              </button>
            ))}
          </div>
          <Chips
            label="세대주 여부"
            options={[{ v: true, label: '세대주예요' }, { v: false, label: '세대원이에요' }]}
            value={p.isHouseholder}
            onChange={v => set('isHouseholder', v)}
          />
        </Field>

        <Field label="가구원 수 (나 포함)">
          <div className="stepper">
            <button type="button" aria-label="한 명 줄이기" disabled={!p.householdSize || p.householdSize <= 1}
              onClick={() => set('householdSize', Math.max(1, (p.householdSize ?? 1) - 1))}>−</button>
            <output aria-live="polite">{p.householdSize ? `${p.householdSize}명` : '선택'}</output>
            <button type="button" aria-label="한 명 늘리기" disabled={(p.householdSize ?? 0) >= 8}
              onClick={() => set('householdSize', Math.min(8, (p.householdSize ?? 0) + 1))}>+</button>
          </div>
          <Hint>주민등록등본에 같이 오른 사람 수예요. 혼자 살면 1명.</Hint>
        </Field>

        <Field label="연소득 (세전, 가구원 합산)">
          <Chips label="연소득" options={INCOME_BANDS.map(b => ({ v: b.code, label: b.label }))}
            value={p.incomeBand} onChange={v => set('incomeBand', v)} />
          <Hint>월급만 있다면 월 세전 급여 × 12. 소득 기준은 가구원 수에 따라 달라져요.</Hint>
        </Field>

        <Field label="총자산">
          <Chips label="총자산" options={ASSET_BANDS.map(b => ({ v: b.code, label: b.label }))}
            value={p.assetBand} onChange={v => set('assetBand', v)} />
          <Hint>예금·적금, 전월세 보증금, 주식, 부동산 등을 더한 금액(빚 빼기 전).</Hint>
        </Field>

        <Field label="자동차">
          <Chips label="자동차 가액" options={CAR_BANDS.map(b => ({ v: b.code, label: b.label }))}
            value={p.carBand} onChange={v => set('carBand', v)} />
        </Field>

        <Field label="나는">
          <Chips label="혼인 여부" options={[{ v: false, label: '미혼' }, { v: true, label: '기혼' }]}
            value={p.isMarried} onChange={v => set('isMarried', v)} />
          <Chips label="학생 여부" options={[{ v: true, label: '대학생·취업준비생' }, { v: false, label: '학생 아님' }]}
            value={p.isStudent} onChange={v => set('isStudent', v)} />
        </Field>

        <div className="sticky-cta">
          <button type="submit" className="btn btn-primary btn-block" disabled={Object.keys(p).length === 0}>
            지원 가능한 공고 보기
          </button>
        </div>
      </form>
    </main>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <fieldset className="card field">
      <legend>{label}</legend>
      {children}
    </fieldset>
  );
}

function Hint({ children }: { children: ReactNode }) {
  return <p className="muted small hint">{children}</p>;
}

/** 하나만 고르는 칩. 고른 칩을 다시 누르면 비운다 */
function Chips<T extends string | boolean>({ label, options, value, onChange }: {
  label: string; options: { v: T; label: string }[]; value: T | undefined; onChange: (v: T | undefined) => void;
}) {
  return (
    <div className="chips wrap" role="group" aria-label={label}>
      {options.map(o => (
        <button key={String(o.v)} type="button" className="chip" aria-pressed={value === o.v}
          onClick={() => onChange(value === o.v ? undefined : o.v)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

function SigunguSelect({ sido, value, onChange }: { sido: string; value: string | undefined; onChange: (v: string) => void }) {
  const res = useAsync(s => api.regions(s), []);
  const items: RegionView[] = (res.data?.items ?? []).filter(r => r.sigungu && r.code.slice(0, 2) === sido.slice(0, 2));
  return (
    <select
      aria-label="시군구(선택)"
      value={value && value !== sido ? value : ''}
      onChange={e => onChange(e.target.value || sido)}
      disabled={res.status !== 'ok'}
    >
      <option value="">{res.status === 'loading' ? '불러오는 중…' : '구·시까지 고르기(선택)'}</option>
      {items.map(r => <option key={r.code} value={r.code}>{r.sigungu}</option>)}
    </select>
  );
}
