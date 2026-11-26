// 공고 본문 자동 정리만 따로 돌린다(수집 없이).
// 사용: pnpm --filter @yh/collector parse                     (정리 안 된 미검수 공고, 기본 30건)
//       pnpm --filter @yh/collector parse -- --limit 100
//       pnpm --filter @yh/collector parse -- --id <공고 uuid>   (그 공고만 다시 정리)
//       pnpm --filter @yh/collector parse -- --dry-run          (DB 에 쓰지 않고 결과만 출력. API 는 호출함)
import { closeDb, db } from '@yh/db';
import { RegionResolver } from './lib/regions.js';
import { claudeExtractor, DEFAULT_MODEL } from './parse/claude.js';
import { parsePending } from './parse/run.js';
import { loadRegions } from './store.js';

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const ids = args.flatMap((a, i) => (a === '--id' && args[i + 1] ? [args[i + 1]!] : []));
const limit = Number(flag('--limit') ?? process.env.PARSE_MAX_PER_RUN ?? 30);

if (!process.env.ANTHROPIC_API_KEY) {
  console.log('ANTHROPIC_API_KEY 가 없어 자동 정리를 건너뜁니다(.env 에 넣어 주세요)');
  process.exit(1);
}

try {
  const sql = db();
  const model = process.env.PARSE_MODEL || DEFAULT_MODEL;
  const counts = await parsePending(sql, {
    extractor: claudeExtractor({ model }),
    model,
    regions: new RegionResolver(await loadRegions(sql)),
    limit: Number.isFinite(limit) && limit > 0 ? limit : 30,
    ids,
    dryRun: args.includes('--dry-run'),
    log: m => console.log(m),
  });
  process.exitCode = counts.failed > 0 && counts.parsed + counts.cached === 0 ? 1 : 0;
} finally {
  await closeDb();
}
