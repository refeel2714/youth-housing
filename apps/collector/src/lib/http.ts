// 국내 공공 사이트 호출용 fetch. 타임아웃·재시도·요청 간격을 한 곳에서 둔다.
const UA = 'Mozilla/5.0 (compatible; youth-housing-collector/0.1)';

export interface HttpOptions {
  method?: 'GET' | 'POST';
  form?: Record<string, string | number>;
  timeoutMs?: number;
  retries?: number;
}

let last = 0;
const MIN_INTERVAL_MS = Number(process.env.COLLECT_INTERVAL_MS ?? 700);

async function politeWait(): Promise<void> {
  const wait = last + MIN_INTERVAL_MS - Date.now();
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  last = Date.now();
}

export async function httpText(url: string, opts: HttpOptions = {}): Promise<string> {
  const { method = opts.form ? 'POST' : 'GET', form, timeoutMs = 20_000, retries = 2 } = opts;
  let err: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    await politeWait();
    try {
      const res = await fetch(url, {
        method,
        headers: {
          'User-Agent': UA,
          Accept: 'application/json, text/html;q=0.9, */*;q=0.8',
          ...(form ? { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' } : {}),
        },
        body: form ? new URLSearchParams(Object.fromEntries(Object.entries(form).map(([k, v]) => [k, String(v)]))) : undefined,
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} ${url.replace(/serviceKey=[^&]+/i, 'serviceKey=***')}`);
      return await res.text();
    } catch (e) {
      err = e;
      if (attempt < retries) await new Promise(r => setTimeout(r, 1500 * (attempt + 1)));
    }
  }
  throw err;
}

export async function httpJson<T>(url: string, opts: HttpOptions = {}): Promise<T> {
  const text = await httpText(url, opts);
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`JSON 아님: ${text.slice(0, 200)}`);
  }
}
