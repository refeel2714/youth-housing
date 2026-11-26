// --dry-run 용: DB 없이 supabase/seed.sql 의 regions 행을 읽는다.
import { readFile } from 'node:fs/promises';
import type { RegionRow } from './regions.js';

const SEED = new URL('../../../../supabase/seed.sql', import.meta.url);

export function parseSeedRegions(sql: string): RegionRow[] {
  const rows: RegionRow[] = [];
  const re = /\('(\d{5})',\s*'([^']+)',\s*(?:'([^']+)'|null)\s*\)/g;
  for (const m of sql.matchAll(re)) rows.push({ code: m[1]!, sido: m[2]!, sigungu: m[3] ?? null });
  return rows;
}

export async function seedRegions(): Promise<RegionRow[]> {
  return parseSeedRegions(await readFile(SEED, 'utf8'));
}
