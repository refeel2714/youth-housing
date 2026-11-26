// 수집 배치 진입점. COLLECT_SOURCES 의 소스를 차례로 돌리고 sources.last_* 를 갱신한다.
import type { Source } from './sources/types.js';

const sources: Source[] = [
  // TODO: lh-api.ts, seoul-housing.ts, sh.ts
];

const enabled = (process.env.COLLECT_SOURCES ?? '').split(',').map(s => s.trim()).filter(Boolean);
for (const s of sources.filter(s => enabled.length === 0 || enabled.includes(s.code))) {
  console.log(`collect ${s.code}`);
  await s.run();
}
console.log('collector done');
