-- ALL-251 temporary staging only; canonical V2 owner-deletion state dependency.
-- Source of truth: migrations 20261111120805 and 20261111121605.
-- Scope intentionally excludes deletion intake and all deletion-worker RPCs.
-- Neither enables deletion nor changes live V2.
create table allin_private.v2_account_deletion_requests (
  user_id uuid primary key references auth.users(id) on delete cascade,
  request_id uuid not null unique default gen_random_uuid(),
  status text not null default 'requested' check (status in ('requested','processing','completed','rejected')),
  requested_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz,
  constraint v2_account_delete_resolved_consistency check (
    (status in ('requested','processing') and resolved_at is null)
    or (status in ('completed','rejected') and resolved_at is not null)
  )
);
alter table allin_private.v2_account_deletion_requests enable row level security;
revoke all on allin_private.v2_account_deletion_requests from public,anon,authenticated,service_role;
comment on table allin_private.v2_account_deletion_requests is
 'V2 owner deletion request intake only. No worker or automatic destructive operation is enabled. Admin processing pending separate tested approval.';

alter table allin_private.v2_account_deletion_requests
 drop constraint v2_account_deletion_requests_status_check;
alter table allin_private.v2_account_deletion_requests
 add constraint v2_account_deletion_requests_status_check
 check(status in ('requested','processing','completed','rejected','cancelled'));
alter table allin_private.v2_account_deletion_requests
 drop constraint v2_account_delete_resolved_consistency;
alter table allin_private.v2_account_deletion_requests
 add constraint v2_account_delete_resolved_consistency check (
 (status in ('requested','processing') and resolved_at is null)
 or (status in ('completed','rejected','cancelled') and resolved_at is not null));
-- No client/service direct table grants and no RLS policies.
-- The existing protected export-session function reads this state as its owner.
