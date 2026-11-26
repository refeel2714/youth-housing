// 관리자 인증(운영자 한두 명용). 토스 빌드와 무관한 서버 렌더링 화면 전용.
// - ADMIN_PASSWORD 하나로 로그인하고, 이름은 검수자 표기(verified_by)로만 쓴다.
// - 세션은 DB 없이 SESSION_SECRET 으로 서명한 쿠키(만료 12시간).
// - 둘 중 하나라도 비어 있으면 관리자 화면은 꺼진다.
import { createHmac, timingSafeEqual } from 'node:crypto';

export const ADMIN_COOKIE = 'yh_admin';
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

export interface AdminConfig {
  password: string;
  secret: string;
}

export function adminConfigFromEnv(env = process.env): AdminConfig | null {
  const password = env.ADMIN_PASSWORD ?? '';
  const secret = env.SESSION_SECRET ?? '';
  if (password.length < 8 || secret.length < 16) return null;
  return { password, secret };
}

const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64url');
const unb64 = (s: string) => Buffer.from(s, 'base64url').toString('utf8');
const mac = (secret: string, data: string) => createHmac('sha256', secret).update(data).digest('base64url');

function safeEqual(a: string, b: string): boolean {
  // 길이가 달라도 같은 시간이 걸리도록 해시끼리 비교
  const ha = createHmac('sha256', 'cmp').update(a).digest();
  const hb = createHmac('sha256', 'cmp').update(b).digest();
  return timingSafeEqual(ha, hb);
}

export const checkPassword = (cfg: AdminConfig, input: string) => safeEqual(cfg.password, input);

export function signSession(cfg: AdminConfig, name: string, now = Date.now()): string {
  const payload = b64(JSON.stringify({ n: name, e: now + SESSION_TTL_MS }));
  return `${payload}.${mac(cfg.secret, payload)}`;
}

/** 서명·만료가 맞으면 검수자 이름 */
export function verifySession(cfg: AdminConfig, token: string | undefined, now = Date.now()): string | null {
  if (!token) return null;
  const [payload, sig] = token.split('.');
  if (!payload || !sig || !safeEqual(mac(cfg.secret, payload), sig)) return null;
  try {
    const { n, e } = JSON.parse(unb64(payload)) as { n?: unknown; e?: unknown };
    if (typeof n !== 'string' || typeof e !== 'number' || e < now) return null;
    return n;
  } catch {
    return null;
  }
}

/** 검수자 이름: 앞뒤 공백 제거, 1~20자, 제어문자 제외 */
export function cleanName(raw: string): string | null {
  const name = raw.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return name.length >= 1 && name.length <= 20 ? name : null;
}

/** 로그인 실패 제한: 같은 IP 에서 15분에 10번 */
export class LoginLimiter {
  private fails = new Map<string, number[]>();
  constructor(private max = 10, private windowMs = 15 * 60 * 1000) {}

  blocked(key: string, now = Date.now()): boolean {
    const list = (this.fails.get(key) ?? []).filter(t => t > now - this.windowMs);
    this.fails.set(key, list);
    return list.length >= this.max;
  }
  fail(key: string, now = Date.now()): void {
    this.fails.set(key, [...(this.fails.get(key) ?? []), now]);
    if (this.fails.size > 1000) this.fails.clear(); // 메모리 보호
  }
  reset(key: string): void {
    this.fails.delete(key);
  }
}
