// 수집 배치 진입점. COLLECT_SOURCES 의 소스를 차례로 돌려 공고를 적재하고 sources.last_* 를 갱신한다.
// 수집이 끝나면 ANTHROPIC_API_KEY 가 있을 때 새로 들어오거나 바뀐 공고 본문을 Claude 로 정리한다(parse/run.ts).
// 사용: pnpm --filter @yh/collector start            (DB 적재 + 자동 정리)
//       pnpm --filter @yh/collector start -- --dry-run (DB 없이 수집 결과만 출력, regions 는 시드 파일에서 읽음. 정리는 안 함)
// 자동 정리만 끄려면 PARSE_AFTER_COLLECT=0, 정리만 따로 돌리려면 pnpm --filter @yh/collector parse
import { closeDb, db } from '@yh/db';
import { RegionResolver } from './lib/regions.js';
import { seedRegions } from './lib/seed-regions.js';
import { claudeExtractor, DEFAULT_MODEL } from './parse/claude.js';
import { parsePending } from './parse/run.js';
import { lhApi } from './sources/lh-api.js';
import { seoulHousing } from './sources/seoul-housing.js';
import type { Source, SourceContext } from './sources/types.js';
import { getSource, loadRegions, markRun, saveNotice, type SaveResult } from './store.js';

const sources: Source[] = [lhApi, seoulHousing];

const dryRun = process.argv.includes('--dry-run');
const enabled = (process.env.COLLECT_SOURCES ?? '').split(',').map(s => s.trim()).filter(Boolean);
const log = (msg: string) => console.log(msg);

async function main(): Promise<number> {
  const sql = dryRun ? null : db();
  const regions = new RegionResolver(sql ? await loadRegions(sql) : await seedRegions());
  const ctx: SourceContext = { regions, now: new Date(), log };
  let failed = 0;

  for (const s of sources.filter(s => enabled.length === 0 || enabled.includes(s.code))) {
    const row = sql ? await getSource(sql, s.code) : { id: 0, enabled: true };
    if (!row) { log(`[${s.code}] sources 행 없음. seed.sql 을 먼저 넣으세요`); failed++; continue; }
    if (!row.enabled) { log(`[${s.code}] 꺼져 있음(sources.enabled=false)`); continue; }

    log(`[${s.code}] 수집 시작`);
    const counts: Record<SaveResult | 'error', number> = { inserted: 0, updated: 0, unchanged: 0, error: 0 };
    let error: string | null = null;
    try {
      for await (const n of s.collect(ctx)) {
        if (!sql) {
          log(JSON.stringify({ ...n, rawText: n.rawText.slice(0, 300) + (n.rawText.length > 300 ? '…' : '') }, null, 2));
          counts.inserted++;
          continue;
        }
        try {
          counts[await saveNotice(sql, row.id, n)]++;
        } catch (e) {
          counts.error++;
          log(`  저장 실패 ${n.externalId} ${n.title}: ${(e as Error).message}`);
        }
      }
      if (counts.error > 0) error = `${counts.error}건 저장 실패`;
    } catch (e) {
      error = (e as Error).stack ?? String(e);
      log(`[${s.code}] 수집 중단: ${(e as Error).message}`);
    }
    if (sql) await markRun(sql, row.id, error);
    if (error) failed++;
    log(`[${s.code}] 신규 ${counts.inserted} · 갱신 ${counts.updated} · 그대로 ${counts.unchanged} · 실패 ${counts.error}`);
  }

  if (sql && process.env.PARSE_AFTER_COLLECT !== '0') {
    if (!process.env.ANTHROPIC_API_KEY) {
      log('[parse] ANTHROPIC_API_KEY 가 없어 본문 자동 정리를 건너뜀');
    } else {
      const model = process.env.PARSE_MODEL || DEFAULT_MODEL;
      const limit = Number(process.env.PARSE_MAX_PER_RUN ?? 30);
      try {
        // 정리 실패는 수집 결과(종료 코드)에 넣지 않는다. 다음 실행에서 다시 시도한다
        await parsePending(sql, {
          extractor: claudeExtractor({ model }), model, regions, log,
          limit: Number.isFinite(limit) && limit > 0 ? limit : 30, now: ctx.now,
        });
      } catch (e) {
        log(`[parse] 중단: ${(e as Error).message}`);
      }
    }
  }
  return failed;
}

try {
  const failed = await main();
  log(failed ? `collector done (실패 소스 ${failed})` : 'collector done');
  process.exitCode = failed ? 1 : 0;
} finally {
  await closeDb();
}
