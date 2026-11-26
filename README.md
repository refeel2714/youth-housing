# youth-housing

청년 임대주택 공고 일정 + 자격 판정 서비스 (웹 먼저, 같은 코드로 토스 미니앱 빌드).

## 구조

| 경로 | 내용 |
| --- | --- |
| `apps/web` | Vite + React SPA. `VITE_TARGET=web\|toss` 로 `src/platform` 구현 교체 |
| `apps/api` | Hono 서버(조회·인증·알림·검수 화면, 웹 정적 파일 서빙) |
| `apps/collector` | 공고 수집·LLM 파싱 배치 |
| `packages/eligibility` | 자격 판정 순수 함수. 브라우저·서버 공용, 외부 의존성 없음 |
| `packages/schema` | DB enum과 같은 상수, zod 스키마, 타입 |
| `packages/db` | postgres.js 연결(api·collector 전용, web import 금지) |
| `supabase/` | 마이그레이션(적용된 파일은 수정 금지, 새 파일로만 변경)과 시드 |

## 개발

```sh
pnpm install
pnpm test            # 판정 경계값 테스트
pnpm typecheck
pnpm dev:api         # :8080
pnpm dev:web         # :5173, /api 는 :8080 으로 프록시
pnpm --filter @yh/web build:toss   # 토스 미니앱용 빌드(dist-toss)
```

DB: `supabase link` 후 `supabase db push`, 시드는 처음 한 번 `psql "$DIRECT_URL" -f supabase/seed.sql`.
환경변수는 `.env.example` 참고.
