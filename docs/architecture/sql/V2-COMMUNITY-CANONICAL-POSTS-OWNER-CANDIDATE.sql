-- ALL-244/222 REVIEW ONLY: single canonical approved Community post ledger.
-- NOT a migration. No feed or publishing endpoint granted. Do not represent
-- workouts/food as complete until their source domains approve exact owner links.
-- A post is created only after athlete explicitly elects to share one source.
-- Updates edit the same row ID; no repost-on-edit or EventHub duplicate rows.
CREATE TABLE allin_private.v2_community_posts (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES public.v2_profiles(user_id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('workout','food','update')),
  audience text NOT NULL CHECK (audience IN ('public','followers','private')),
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 500),
  -- Existing source identifiers are reserved for approved cross-domain
  -- ownership contracts. Do not create independent workout/meal records here.
  source_id uuid,
  body text NOT NULL DEFAULT '' CHECK (length(body)<=4000),
  post_version bigint NOT NULL DEFAULT 1 CHECK (post_version>=1),
  published_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT community_post_source_kind CHECK (
    (kind='update' AND source_id IS NULL) OR
    (kind IN ('workout','food') AND source_id IS NOT NULL)
  ),
  CONSTRAINT community_post_source_unique UNIQUE (owner_id,kind,source_id)
);
CREATE INDEX v2_community_posts_owner_time_idx
  ON allin_private.v2_community_posts(owner_id,published_at DESC,id DESC);
ALTER TABLE allin_private.v2_community_posts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON allin_private.v2_community_posts
  FROM PUBLIC,anon,authenticated,service_role;
COMMENT ON TABLE allin_private.v2_community_posts IS
  'Review-only one-post-per-explicit-share candidate; canonical source ownership pending.';

-- ALL-244/251 REVIEW ONLY: comments/replies extend this SAME post owner.
-- Author ownership and parent-post ownership are different privacy concepts.
-- No user writer, feed grant, media acceptance or export registration follows.
CREATE TABLE allin_private.v2_community_comments (
  id uuid PRIMARY KEY,
  post_id uuid NOT NULL REFERENCES allin_private.v2_community_posts(id)
    ON DELETE CASCADE,
  author_id uuid NOT NULL REFERENCES public.v2_profiles(user_id)
    ON DELETE CASCADE,
  parent_comment_id uuid,
  body text NOT NULL CHECK (length(btrim(body)) BETWEEN 1 AND 4000),
  revision bigint NOT NULL DEFAULT 1 CHECK (revision>0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  -- The same parent must belong to the SAME canonical post. When its
  -- author leaves, detach surviving replies rather than cascading into
  -- another author's content. Deleting the post still cascades all comments.
  CONSTRAINT v2_community_comments_post_identity UNIQUE(post_id,id),
  CONSTRAINT v2_community_comments_parent_not_self
    CHECK (parent_comment_id IS NULL OR parent_comment_id<>id),
  CONSTRAINT v2_community_comments_parent_same_post
    FOREIGN KEY(post_id,parent_comment_id)
    REFERENCES allin_private.v2_community_comments(post_id,id)
    ON DELETE SET NULL (parent_comment_id)
);
CREATE INDEX v2_community_comments_author_time
  ON allin_private.v2_community_comments(author_id,created_at,id);
CREATE INDEX v2_community_comments_post_time
  ON allin_private.v2_community_comments(post_id,created_at,id);
ALTER TABLE allin_private.v2_community_comments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON allin_private.v2_community_comments
  FROM PUBLIC,anon,authenticated,service_role;
COMMENT ON TABLE allin_private.v2_community_comments IS
  'ALL-244 review-only comments/replies: author-owned, parent-post-scoped, no client API or approved media/export yet.';

-- One SQL SELECT statement for server-side authorization. Never fetch all
-- posts and filter after data has crossed the client/API boundary. Private
-- profile: public posts are not visible to an unapproved follower. An
-- approved follower can see public/followers audience, but never private.
-- A block in EITHER direction returns no post content even to past followers.
CREATE OR REPLACE FUNCTION public.v2_community_posts_read(
  p_owner_id uuid
) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=''
AS $community_posts_read$
WITH viewer AS (
  SELECT auth.uid() AS uid
), validity AS (
  SELECT v.uid,
    (v.uid IS NOT NULL AND EXISTS(
       SELECT 1 FROM auth.users u JOIN public.v2_profiles p
       ON p.user_id=u.id WHERE u.id=v.uid
    )) AS viewer_active,
    EXISTS(SELECT 1 FROM auth.users u JOIN public.v2_profiles p
      ON p.user_id=u.id WHERE u.id=p_owner_id) AS owner_active
  FROM viewer v
), permission AS (
  SELECT x.uid, x.viewer_active, x.owner_active,
    x.uid=p_owner_id AS self,
    EXISTS(SELECT 1 FROM allin_private.v2_community_blocks b
       WHERE (b.blocker_id=x.uid AND b.blocked_id=p_owner_id)
          OR (b.blocker_id=p_owner_id AND b.blocked_id=x.uid)) AS blocked,
    EXISTS(SELECT 1 FROM allin_private.v2_community_follows f
       WHERE f.follower_id=x.uid AND f.followed_id=p_owner_id
         AND f.state='approved') AS approved,
    COALESCE((
      SELECT profile_visibility FROM allin_private.v2_community_visibility
      WHERE user_id=p_owner_id
    ),'private') AS visibility
  FROM validity x
), allowed AS (
 SELECT p.id,p.owner_id,p.title,p.kind,p.audience,p.published_at,
        p.body,p.updated_at
 FROM allin_private.v2_community_posts p CROSS JOIN permission perm
 WHERE p.owner_id=p_owner_id
   AND perm.viewer_active AND perm.owner_active
   AND NOT perm.blocked
   AND (
       perm.self
       OR (p.audience <> 'private' AND
           (perm.approved OR
             (perm.visibility='public' AND p.audience='public')))
   )
), sorted AS (
 SELECT *,row_number() OVER(ORDER BY published_at DESC,id DESC) AS ordinal
 FROM allowed ORDER BY published_at DESC,id DESC LIMIT 101
)
SELECT jsonb_build_object(
  'ownerId',p_owner_id,'viewerId',perm.uid,
  'complete',(SELECT count(*)<=100 FROM sorted),
  'nextCursor',CASE WHEN (SELECT count(*)>100 FROM sorted)
    THEN 'additional-page-required' ELSE NULL END,
  'blocked',perm.blocked,
  'posts',COALESCE((
    SELECT jsonb_agg(
      jsonb_build_object(
        'id',s.id,'ownerId',s.owner_id,'title',s.title,
        'kind',s.kind,'audience',s.audience,'body',s.body,
        'publishedAt',s.published_at,'updatedAt',s.updated_at
      ) ORDER BY s.published_at DESC,s.id DESC
    ) FROM sorted s WHERE s.ordinal<=100
  ),'[]'::jsonb)
)
FROM permission perm
WHERE perm.viewer_active AND perm.owner_active
  AND p_owner_id IS NOT NULL
$community_posts_read$;

REVOKE ALL ON FUNCTION public.v2_community_posts_read(uuid)
  FROM PUBLIC,anon,authenticated,service_role;

-- Pagination is NOT deployed. A response with more than 100 authorized rows
-- is explicitly incomplete, and the client must reject it rather than imply
-- the extra posts do not exist. A reviewed owner-cursor contract is required
-- before granting API access.

-- Review-only comment reader: one post, one server-side ACL. Never fetch
-- unreviewed comment bytes and filter in the mobile app afterward. The
-- parent post owner controls audience; each comment author independently
-- controls blocks in both directions. No direct client EXECUTE is granted.
CREATE OR REPLACE FUNCTION public.v2_community_comments_read(
 p_post_id uuid
) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=''
AS $comments_read$
WITH viewer AS (
 SELECT auth.uid() AS uid
), post AS (
 SELECT p.id,p.owner_id,p.audience
 FROM allin_private.v2_community_posts p WHERE p.id=p_post_id
), permission AS (
 SELECT v.uid,p.id,p.owner_id,
  (v.uid IS NOT NULL AND EXISTS(
    SELECT 1 FROM auth.users u JOIN public.v2_profiles pr
      ON pr.user_id=u.id WHERE u.id=v.uid
  )) AS viewer_active,
  EXISTS(SELECT 1 FROM auth.users u JOIN public.v2_profiles pr
    ON pr.user_id=u.id WHERE u.id=p.owner_id) AS owner_active,
  EXISTS(SELECT 1 FROM allin_private.v2_community_blocks b
    WHERE (b.blocker_id=v.uid AND b.blocked_id=p.owner_id)
       OR (b.blocker_id=p.owner_id AND b.blocked_id=v.uid)) AS blocked,
  (v.uid=p.owner_id OR
    (p.audience<>'private' AND (
      EXISTS(SELECT 1 FROM allin_private.v2_community_follows f
        WHERE f.follower_id=v.uid AND f.followed_id=p.owner_id
          AND f.state='approved')
      OR (p.audience='public' AND
        COALESCE((SELECT profile_visibility
          FROM allin_private.v2_community_visibility
          WHERE user_id=p.owner_id),'private')='public')
    ))) AS can_view
 FROM viewer v CROSS JOIN post p
), allowed AS (
 SELECT c.id,c.author_id,c.parent_comment_id,c.body,
   c.revision,c.created_at,c.updated_at
 FROM allin_private.v2_community_comments c CROSS JOIN permission perm
 WHERE c.post_id=p_post_id AND c.deleted_at IS NULL
   AND perm.viewer_active AND perm.owner_active
   AND NOT perm.blocked AND perm.can_view
   AND NOT EXISTS(
     SELECT 1 FROM allin_private.v2_community_blocks b
     WHERE (b.blocker_id=perm.uid AND b.blocked_id=c.author_id)
        OR (b.blocker_id=c.author_id AND b.blocked_id=perm.uid)
   )
), sorted AS (
 SELECT *,row_number() OVER(ORDER BY created_at,id) AS ordinal
 FROM allowed ORDER BY created_at,id LIMIT 101
)
SELECT pg_catalog.jsonb_build_object(
 'postId',p_post_id,'viewerId',perm.uid,
 'complete',(SELECT count(*)<=100 FROM sorted),
 'nextCursor',CASE WHEN (SELECT count(*)>100 FROM sorted)
   THEN 'additional-page-required' ELSE NULL END,
 'comments',COALESCE((
   SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
     'id',s.id,'authorId',s.author_id,'parentCommentId',s.parent_comment_id,
     'body',s.body,'revision',s.revision,'createdAt',s.created_at,
     'updatedAt',s.updated_at
   ) ORDER BY s.created_at,s.id) FROM sorted s WHERE s.ordinal<=100
 ),'[]'::jsonb)
)
FROM permission perm
WHERE perm.viewer_active AND perm.owner_active
 AND NOT perm.blocked AND perm.can_view
$comments_read$;
REVOKE ALL ON FUNCTION public.v2_community_comments_read(uuid)
 FROM PUBLIC,anon,authenticated,service_role;

-- This 100-comment cap is intentionally an incomplete-preview marker.
-- A reviewed cursor and moderation/rate-limited writer are required before
-- any client grant or production launch.
