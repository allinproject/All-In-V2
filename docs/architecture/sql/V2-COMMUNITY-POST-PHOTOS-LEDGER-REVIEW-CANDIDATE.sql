-- ALL-244 / ALL-251 REVIEW ONLY. NOT a Supabase migration or permission to upload.
-- Extends the SINGLE canonical allin_private.v2_community_posts ownership model.
-- A DB cascade removes REFERENCES, NOT external object bytes. Account deletion
-- must remain OFF until the canonical Storage checkpoint independently proves
-- byte absence, in-flight lease settlement, export and recoverability.
CREATE TABLE allin_private.v2_community_post_photos (
  id uuid PRIMARY KEY,
  post_id uuid NOT NULL
    REFERENCES allin_private.v2_community_posts(id) ON DELETE CASCADE,
  -- Explicit owner FK keeps an exhaustive owner inventory, including private
  -- and unpublished/failed media; post_id + owner_id cannot disagree.
  owner_id uuid NOT NULL REFERENCES public.v2_profiles(user_id) ON DELETE CASCADE,
  bucket_id text NOT NULL CHECK (bucket_id='v2-private-community-photos'),
  object_path text NOT NULL UNIQUE
    CHECK (length(object_path) BETWEEN 1 AND 1024 AND
           object_path !~ '[[:cntrl:]]' AND
           object_path NOT LIKE '%..%' AND
           position(chr(92) in object_path)=0),
  content_type text NOT NULL CHECK (content_type='image/png'),
  byte_length bigint NOT NULL CHECK (byte_length BETWEEN 1 AND 8388608),
  width integer NOT NULL CHECK (width BETWEEN 1 AND 200000),
  height integer NOT NULL CHECK (height BETWEEN 1 AND 200000),
  sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  -- Only verified sanitized bytes can appear as pending; no public signed URL
  -- or external file URL is part of this private ledger.
  lifecycle text NOT NULL DEFAULT 'pending'
    CHECK (lifecycle IN ('pending','verified','delete_pending')),
  post_version bigint NOT NULL CHECK (post_version>=1),
  created_at timestamptz NOT NULL DEFAULT now(),
  verified_at timestamptz,
  CONSTRAINT v2_community_photo_verified_state CHECK (
    (lifecycle='verified' AND verified_at IS NOT NULL) OR
    (lifecycle<>'verified' AND verified_at IS NULL)
  ),
  CONSTRAINT v2_community_photo_pixel_limit CHECK (
    width::bigint * height::bigint <= 20000000
  ),
  CONSTRAINT v2_community_photo_object_owner CHECK (
    object_path = owner_id::text || '/posts/' || post_id::text || '/' || id::text || '.png'
  )
);
-- Prevent attaching another owner's file to a post: composite FK targets
-- the existing canonical post identity and ownership, never a shadow owner.
ALTER TABLE allin_private.v2_community_posts
  ADD CONSTRAINT v2_community_posts_id_owner_unique UNIQUE(id,owner_id);
ALTER TABLE allin_private.v2_community_post_photos
  ADD CONSTRAINT v2_community_photo_canonical_post_owner
  FOREIGN KEY(post_id,owner_id)
  REFERENCES allin_private.v2_community_posts(id,owner_id)
  ON DELETE CASCADE;

CREATE INDEX v2_community_post_photos_owner_scan
 ON allin_private.v2_community_post_photos(owner_id,created_at,id);
CREATE INDEX v2_community_post_photos_post
 ON allin_private.v2_community_post_photos(post_id,id);
ALTER TABLE allin_private.v2_community_post_photos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON allin_private.v2_community_post_photos
 FROM PUBLIC,anon,authenticated,service_role;
COMMENT ON TABLE allin_private.v2_community_post_photos IS
 'Review-only canonical post photo metadata; never grants upload/read; deletion of SQL rows does not prove provider byte absence.';
-- NO direct inserts, owner RPC, public feed reader, Storage policies,
-- bucket creation, upload activation or deletion worker enablement here.
