import type { Context } from 'hono';

/** Fly 프록시 뒤에서의 클라이언트 IP(로그인·구독 생성 횟수 제한용) */
export const clientIp = (c: Context) =>
  c.req.header('fly-client-ip') ?? c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local';

/** 이 서버의 바깥 주소. PUBLIC_BASE_URL 이 있으면 그것, 없으면 요청 주소(프록시가 준 https 반영) */
export function publicBaseUrl(c: Context, env = process.env): string {
  if (env.PUBLIC_BASE_URL) return env.PUBLIC_BASE_URL.replace(/\/$/, '');
  const u = new URL(c.req.url);
  const proto = c.req.header('x-forwarded-proto') === 'https' ? 'https:' : u.protocol;
  return `${proto}//${u.host}`;
}
