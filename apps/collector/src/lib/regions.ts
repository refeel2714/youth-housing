// 주소·본문 문자열에서 regions 코드 찾기. 시군구 코드와 그 시도 코드(XX000)를 함께 돌려준다.
export interface RegionRow {
  code: string;
  sido: string;
  sigungu: string | null;
}

const SIDO_ALIASES: Record<string, string[]> = {
  서울특별시: ['서울특별시', '서울시', '서울'],
  인천광역시: ['인천광역시', '인천시', '인천'],
  경기도: ['경기도', '경기'],
};

export class RegionResolver {
  private bySido = new Map<string, RegionRow[]>();
  private sidoCode = new Map<string, string>();

  constructor(rows: RegionRow[]) {
    for (const r of rows) {
      if (r.sigungu === null) {
        this.sidoCode.set(r.sido, r.code);
        continue;
      }
      const list = this.bySido.get(r.sido) ?? [];
      list.push(r);
      this.bySido.set(r.sido, list);
    }
    // "수원시 장안구"가 "수원시"보다 먼저 맞도록 긴 이름부터
    for (const list of this.bySido.values()) list.sort((a, b) => b.sigungu!.length - a.sigungu!.length);
  }

  private sidoIn(text: string): string[] {
    const found: string[] = [];
    for (const sido of this.sidoCode.keys()) {
      const aliases = SIDO_ALIASES[sido] ?? [sido];
      if (aliases.some(a => text.includes(a))) found.push(sido);
    }
    return found;
  }

  /**
   * 주소 하나 → 가장 구체적인 시군구 코드 + 시도 코드.
   * defaultSido: 주소에 시도가 없을 때(서울주거포털 "동대문구 망우로") 쓸 시도
   */
  resolveAddress(address: string, defaultSido?: string): string[] {
    const text = address.replace(/\s+/g, ' ');
    const sidos = this.sidoIn(text);
    const candidates = sidos.length > 0 ? sidos : defaultSido ? [defaultSido] : [];
    for (const sido of candidates) {
      const list = this.bySido.get(sido) ?? [];
      // "수원시 장안구" 또는 "장안구"만 적힌 경우 모두
      const hit = list.find(r => text.includes(r.sigungu!)) ??
        list.find(r => r.sigungu!.includes(' ') && text.includes(r.sigungu!.split(' ').pop()!));
      const sidoCode = this.sidoCode.get(sido);
      if (hit) return sidoCode ? [hit.code, sidoCode] : [hit.code];
      if (sidos.length > 0 && sidoCode) return [sidoCode];
    }
    return [];
  }

  /** 시도 이름만으로(LH 목록의 CNP_CD_NM) */
  sidoCodeOf(name: string): string | undefined {
    for (const [sido, code] of this.sidoCode) {
      if ((SIDO_ALIASES[sido] ?? [sido]).some(a => name.includes(a))) return code;
    }
    return undefined;
  }
}

/** 여러 주소 결과를 합쳐 중복 없이 */
export function mergeCodes(...lists: string[][]): string[] {
  return [...new Set(lists.flat())].sort();
}
