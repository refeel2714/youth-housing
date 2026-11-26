// postgres.js 연결. api·collector 에서만 import 한다(web 금지).
import postgres from 'postgres';

let client: postgres.Sql | undefined;

export function db(): postgres.Sql {
  if (!client) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL is not set');
    // Supavisor 세션 모드(5432) 기준. 트랜잭션 모드(6543)를 쓰면 prepare: false 필요
    client = postgres(url, { max: 5, idle_timeout: 30 });
  }
  return client;
}

export async function closeDb(): Promise<void> {
  await client?.end();
  client = undefined;
}

export type Sql = postgres.Sql;
