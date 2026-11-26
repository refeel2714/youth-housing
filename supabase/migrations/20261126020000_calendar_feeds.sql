-- 로그인 없이 쓰는 캘린더 구독(.ics). 관심 공고·관심 지역은 기기에 두고, 구독을 켜면 그 목록을 여기에 같이 올린다.
-- - token: 구독 주소(/ics/<token>.ics)에 들어가는 읽기용 비밀값. 캘린더 앱이 이 주소로 몇 시간마다 다시 받아 간다.
-- - edit_key_hash: 목록 수정·구독 끊기용 비밀값의 sha256. 원문은 만든 기기에만 있다.
-- - user_id: 로그인이 붙으면 기기의 구독을 계정에 연결한다(이메일 알림은 같은 선택 기준을 watches 로 옮겨 쓴다).
create table calendar_feeds (
  id              uuid primary key default gen_random_uuid(),
  token           text not null unique check (token ~ '^[A-Za-z0-9_-]{20,64}$'),
  edit_key_hash   bytea not null,
  user_id         uuid references users(id) on delete cascade,
  notice_ids      uuid[] not null default '{}',          -- 관심 공고: 모든 일정
  region_codes    text[] not null default '{}',          -- 관심 지역: 그 지역 공고의 접수 시작·마감
  alarm_days      smallint[] not null default '{1}',     -- 일정 며칠 전 오전 9시 알림(캘린더 앱이 울림)
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  last_fetched_at timestamptz,                           -- 오래 안 받아 간 구독 정리용
  check (cardinality(notice_ids) <= 200),
  check (cardinality(region_codes) <= 50),
  check (cardinality(alarm_days) <= 3 and 0 <= all(alarm_days) and 14 >= all(alarm_days))
);
create index calendar_feeds_user_idx on calendar_feeds (user_id) where user_id is not null;
create trigger calendar_feeds_updated before update on calendar_feeds for each row execute function set_updated_at();
alter table calendar_feeds enable row level security;
