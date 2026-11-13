-- ALL-222 staging-only source parity fixture.
-- Applied as temporary staging migration 20261113170455:
--   all222_temp_staging_private_health_owner_parity_only
-- This does not authorize deployment in canonical V2 or production.
-- It must remain separate from the canonical foundation migration ledger.
create table allin_private.v2_health_considerations (
 user_id uuid primary key references auth.users(id) on delete cascade,
 conditions jsonb not null default '[]'::jsonb check (jsonb_typeof(conditions)='array'),
 limitations jsonb not null default '[]'::jsonb check (jsonb_typeof(limitations)='array'),
 coach_opt_in boolean not null default false,
 version bigint not null default 1 check (version >= 1),
 updated_at timestamptz not null default now()
);
comment on table allin_private.v2_health_considerations is 'Private owner-scoped health considerations, no direct API access; consent is opt-in and revocable.';
alter table allin_private.v2_health_considerations enable row level security;
revoke all on allin_private.v2_health_considerations from public, anon, authenticated, service_role;
