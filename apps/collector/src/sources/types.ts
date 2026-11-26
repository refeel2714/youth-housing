/** 수집처 하나의 구현. 목록 → 상세 → 본문(raw_text) */
export interface Source {
  code: 'LH_API' | 'SEOUL_HOUSING' | 'SH';
  run(): Promise<void>;
}
