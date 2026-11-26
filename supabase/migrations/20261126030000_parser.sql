-- 공고 본문 자동 정리(Claude 파서).
-- parsed_hash: 일정·자격 조건을 마지막으로 맞춘 본문의 content_hash.
--   파서가 정리했거나 관리자가 검수 화면에서 저장하면 그때의 content_hash 를 넣는다.
--   미검수 공고 중 content_hash 와 다른 것(새 공고, 본문이 바뀐 공고)만 파서가 다시 정리한다.
--   그래서 관리자가 고친 조건을 파서가 덮지 않는다. 관리자가 "다시 자동 정리"를 누르면 null 로 비운다.
alter table notices add column parsed_hash text;

create index notices_parse_queue on notices (created_at)
  where parse_status in ('pending', 'llm_parsed') and raw_text is not null;
