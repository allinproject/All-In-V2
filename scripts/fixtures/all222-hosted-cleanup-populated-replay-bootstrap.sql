-- Disposable PostgreSQL ONLY; use after the all222 cancellation bootstrap + candidate.
-- Synthetic Auth attributes exist in real GoTrue but must be seeded in the
-- disposable bootstrap to exercise exact cleanup guards.
ALTER TABLE auth.users ADD COLUMN email text;
ALTER TABLE auth.users ADD COLUMN raw_app_meta_data jsonb NOT NULL DEFAULT '{}'::jsonb;
INSERT INTO auth.users(id,email,raw_app_meta_data) VALUES
 ('4eac09be-9845-48db-9348-474e5c08e6e8',
  'all222-terminate-active-11111111-1111-4111-8111-111111111111@example.invalid',
  '{"all222_disposable":true,"all222_fixture":"terminate-active"}');
INSERT INTO allin_private.v2_privileged_storage_write_leases_review
 (lease_id,owner_id,bucket_id,object_path,operation,writer_sha256_review,expires_at,cancelled_at)
VALUES
 ('4a5c3ccc-ed0a-40fa-8e77-8324c992956e',
  '4eac09be-9845-48db-9348-474e5c08e6e8',
  'v2-private-workout-objects',
  '4eac09be-9845-48db-9348-474e5c08e6e8/all222-positive-11111111-1111-4111-8111-111111111111-terminate-active.bin',
  'create',repeat('a',64),now()+interval '30 minutes',now());
