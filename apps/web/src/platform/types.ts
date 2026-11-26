/** 웹·토스에서 달라지는 부분만 모은 인터페이스 */
export interface Platform {
  name: 'web' | 'toss';
  /** 로그인 시작(웹: 카카오, 토스: 토스 로그인) */
  login(): Promise<void>;
  /** 공고 원문·신청 사이트 열기(웹: 새 탭, 토스: 외부 브라우저) */
  openExternal(url: string): void;
  /** 비로그인 조건 저장소 */
  storage: { get(key: string): string | null; set(key: string, value: string): void };
}
