// 캘린더·목록이 같이 쓰는 지역·유형·내 조건 맞춤 필터. 기기 저장소에 남겨 두고 다음에 열 때 그대로 쓴다.
import { platform } from '@platform';
import { HOUSING_TYPES, type HousingType } from '@yh/schema/constants';
import { useCallback, useState } from 'react';
import type { Filter } from '../api/client';

export const SIDO_OPTIONS = [
  { code: '', label: '전체' },
  { code: '11000', label: '서울' },
  { code: '41000', label: '경기' },
  { code: '28000', label: '인천' },
] as const;

/** 유형 칩. 청년안심주택은 공공·민간을 한 칩으로 묶는다 */
export const TYPE_CHIPS: { label: string; types: HousingType[] }[] = [
  { label: '청년안심주택', types: ['youth_safe_public', 'youth_safe_private'] },
  { label: '행복주택', types: ['happy_house'] },
  { label: '매입임대', types: ['youth_purchase_rental'] },
];

const KEY = 'yh.filter.v1';
/** mine: 30초 진단 결과로 '어려움' 공고를 숨김 */
interface Stored { sido: string; types: HousingType[]; mine: boolean }

function load(): Stored {
  try {
    const v = JSON.parse(platform.storage.get(KEY) ?? 'null') as Partial<Stored> | null;
    const sido = SIDO_OPTIONS.some(o => o.code === v?.sido) ? v!.sido! : '';
    const types = (v?.types ?? []).filter((t): t is HousingType => (HOUSING_TYPES as readonly string[]).includes(t));
    return { sido, types, mine: v?.mine === true };
  } catch {
    return { sido: '', types: [], mine: false };
  }
}

export function useFilter() {
  const [state, setState] = useState<Stored>(load);
  const update = useCallback((next: Stored) => {
    setState(next);
    platform.storage.set(KEY, JSON.stringify(next));
  }, []);
  const filter: Filter = { regions: state.sido ? [state.sido] : [], types: state.types };
  return {
    sido: state.sido,
    types: state.types,
    mine: state.mine,
    filter,
    key: `${state.sido}|${state.types.join(',')}`,
    setSido: (sido: string) => update({ ...state, sido }),
    setMine: (mine: boolean) => update({ ...state, mine }),
    hasTypes: (ts: HousingType[]) => ts.every(t => state.types.includes(t)),
    toggleTypes: (ts: HousingType[]) => {
      const on = ts.every(t => state.types.includes(t));
      update({ ...state, types: on ? state.types.filter(x => !ts.includes(x)) : [...new Set([...state.types, ...ts])] });
    },
    clearTypes: () => update({ ...state, types: [] }),
  };
}
