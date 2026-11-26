/** 웹·토스에서 달라지는 부분만 모은 인터페이스 */
export interface Platform {
  name: 'web' | 'toss';
  /** 로그인 시작(웹: 카카오, 토스: 토스 로그인) */
  login(): Promise<void>;
  /** 비로그인 조건 저장소 */
  storage: { get(key: string): string | null; set(key: string, value: string): void };
}
