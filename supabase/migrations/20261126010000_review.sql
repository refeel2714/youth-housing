-- 관리자 검수: 승인 당시 본문 해시(수집기가 본문 변경을 넣으면 "다시 확인"으로 띄움)와 검수 메모(반려 사유 등)
alter table notices add column verified_content_hash text;
alter table notices add column review_note text;

-- 이미 검수된 공고는 지금 본문을 승인본으로 본다
update notices set verified_content_hash = content_hash where parse_status = 'verified';

create index notices_recheck_idx on notices (updated_at)
  where parse_status = 'verified' and content_hash is distinct from verified_content_hash;
