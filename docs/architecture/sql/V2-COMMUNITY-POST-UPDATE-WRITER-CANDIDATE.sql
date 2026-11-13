-- ALL-244 review-only canonical text-update writer. No live API grants.
-- Athlete-created updates only until Training/Food owners can validate source.
-- Do NOT expose until moderation, abuse limits and legal retention are owned.
CREATE OR REPLACE FUNCTION public.v2_community_create_update_post(
 p_actor_id uuid,p_post_id uuid,p_audience text,p_title text,p_body text,
 p_explicit_share boolean
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $post_create$
DECLARE v_actor uuid:=auth.uid();
        v_row allin_private.v2_community_posts%ROWTYPE;
        v_created boolean:=false;
BEGIN
 IF v_actor IS NULL OR p_actor_id IS DISTINCT FROM v_actor OR
    NOT EXISTS(SELECT 1 FROM auth.users u JOIN public.v2_profiles p
      ON p.user_id=u.id WHERE u.id=v_actor)
 THEN RAISE EXCEPTION 'community_post_account_unavailable' USING ERRCODE='42501'; END IF;
 IF p_explicit_share IS DISTINCT FROM true OR p_post_id IS NULL OR
    p_audience IS NULL OR p_audience NOT IN('public','followers','private') OR
    p_title IS NULL OR length(btrim(p_title)) NOT BETWEEN 1 AND 500 OR
    p_body IS NULL OR length(p_body)>4000
 THEN RAISE EXCEPTION 'invalid_community_post_intent' USING ERRCODE='22023'; END IF;

 INSERT INTO allin_private.v2_community_posts
 (id,owner_id,kind,audience,title,body,source_id)
 VALUES (p_post_id,v_actor,'update',p_audience,btrim(p_title),p_body,NULL)
 ON CONFLICT(id) DO NOTHING RETURNING true INTO v_created;

 SELECT * INTO v_row FROM allin_private.v2_community_posts
 WHERE id=p_post_id FOR UPDATE;
 IF v_row.id IS NULL OR v_row.owner_id IS DISTINCT FROM v_actor OR
    v_row.kind IS DISTINCT FROM 'update' OR
    v_row.audience IS DISTINCT FROM p_audience OR
    v_row.title IS DISTINCT FROM btrim(p_title) OR
    v_row.body IS DISTINCT FROM p_body OR v_row.post_version<>1
 THEN RAISE EXCEPTION 'community_post_id_conflict' USING ERRCODE='23505'; END IF;

 RETURN jsonb_build_object('ownerId',v_actor,'postId',p_post_id,
   'version',v_row.post_version,'created',COALESCE(v_created,false));
END;
$post_create$;

CREATE OR REPLACE FUNCTION public.v2_community_edit_update_post(
 p_actor_id uuid,p_post_id uuid,p_expected_version bigint,
 p_audience text,p_title text,p_body text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $post_edit$
DECLARE v_actor uuid:=auth.uid();v_version bigint;
BEGIN
 IF v_actor IS NULL OR p_actor_id IS DISTINCT FROM v_actor OR
   NOT EXISTS(SELECT 1 FROM auth.users u JOIN public.v2_profiles p
      ON p.user_id=u.id WHERE u.id=v_actor)
 THEN RAISE EXCEPTION 'community_post_account_unavailable' USING ERRCODE='42501'; END IF;
 IF p_post_id IS NULL OR p_expected_version IS NULL OR p_expected_version<1 OR
   p_audience IS NULL OR p_audience NOT IN('public','followers','private') OR
   p_title IS NULL OR length(btrim(p_title)) NOT BETWEEN 1 AND 500 OR
   p_body IS NULL OR length(p_body)>4000
 THEN RAISE EXCEPTION 'invalid_community_post_edit' USING ERRCODE='22023'; END IF;

 UPDATE allin_private.v2_community_posts
 SET audience=p_audience,title=btrim(p_title),body=p_body,
     post_version=post_version+1,updated_at=now()
 WHERE id=p_post_id AND owner_id=v_actor AND kind='update'
 AND post_version=p_expected_version
 RETURNING post_version INTO v_version;
 IF v_version IS NULL THEN
   RAISE EXCEPTION 'community_post_missing_or_stale' USING ERRCODE='40001';
 END IF;
 RETURN jsonb_build_object('ownerId',v_actor,'postId',p_post_id,
   'version',v_version,'edited',true);
END;
$post_edit$;

REVOKE ALL ON FUNCTION public.v2_community_create_update_post(
 uuid,uuid,text,text,text,boolean) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.v2_community_edit_update_post(
 uuid,uuid,bigint,text,text,text) FROM PUBLIC,anon,authenticated,service_role;

-- Review-only comment creation uses the SAME canonical posts and comments
-- ledger. No new comment feed, owner store, or default client EXECUTE grant.
CREATE OR REPLACE FUNCTION public.v2_community_create_comment(
 p_actor_id uuid,p_comment_id uuid,p_post_id uuid,p_parent_comment_id uuid,
 p_body text,p_explicit_comment boolean
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $comment_create$
DECLARE
 v_actor uuid:=auth.uid();
 v_post allin_private.v2_community_posts%ROWTYPE;
 v_parent allin_private.v2_community_comments%ROWTYPE;
 v_row allin_private.v2_community_comments%ROWTYPE;
 v_created boolean:=false;
 v_approved boolean;
 v_visibility text;
BEGIN
 IF v_actor IS NULL OR v_actor IS DISTINCT FROM p_actor_id
  OR NOT EXISTS(SELECT 1 FROM auth.users u
    JOIN public.v2_profiles p ON p.user_id=u.id WHERE u.id=v_actor)
 THEN RAISE EXCEPTION 'community_comment_account_unavailable' USING ERRCODE='42501'; END IF;
 IF p_explicit_comment IS DISTINCT FROM true OR p_comment_id IS NULL
   OR p_post_id IS NULL OR p_body IS NULL
   OR length(btrim(p_body)) NOT BETWEEN 1 AND 4000
   OR p_parent_comment_id IS NOT DISTINCT FROM p_comment_id
 THEN RAISE EXCEPTION 'invalid_community_comment_intent' USING ERRCODE='22023'; END IF;
 SELECT * INTO v_post FROM allin_private.v2_community_posts
 WHERE id=p_post_id FOR SHARE;
 IF v_post.id IS NULL THEN
  RAISE EXCEPTION 'community_post_unavailable' USING ERRCODE='42501'; END IF;
 IF EXISTS(SELECT 1 FROM allin_private.v2_community_blocks b
   WHERE (b.blocker_id=v_actor AND b.blocked_id=v_post.owner_id)
      OR (b.blocker_id=v_post.owner_id AND b.blocked_id=v_actor))
 THEN RAISE EXCEPTION 'community_comment_blocked' USING ERRCODE='42501'; END IF;
 SELECT COALESCE((SELECT profile_visibility
     FROM allin_private.v2_community_visibility
     WHERE user_id=v_post.owner_id),'private') INTO v_visibility;
 SELECT EXISTS(SELECT 1 FROM allin_private.v2_community_follows f
  WHERE f.follower_id=v_actor AND f.followed_id=v_post.owner_id
    AND f.state='approved') INTO v_approved;
 IF v_actor<>v_post.owner_id AND NOT (
   v_post.audience<>'private' AND
   (v_approved OR (v_post.audience='public' AND v_visibility='public'))
 ) THEN RAISE EXCEPTION 'community_comment_audience_denied'
    USING ERRCODE='42501'; END IF;
 IF p_parent_comment_id IS NOT NULL THEN
  SELECT * INTO v_parent FROM allin_private.v2_community_comments
  WHERE id=p_parent_comment_id AND post_id=p_post_id
    AND deleted_at IS NULL FOR SHARE;
  IF v_parent.id IS NULL OR EXISTS(
    SELECT 1 FROM allin_private.v2_community_blocks b
    WHERE (b.blocker_id=v_actor AND b.blocked_id=v_parent.author_id)
       OR (b.blocker_id=v_parent.author_id AND b.blocked_id=v_actor))
  THEN RAISE EXCEPTION 'community_comment_parent_unavailable'
    USING ERRCODE='42501'; END IF;
 END IF;
 INSERT INTO allin_private.v2_community_comments
   (id,post_id,author_id,parent_comment_id,body)
 VALUES(p_comment_id,p_post_id,v_actor,p_parent_comment_id,btrim(p_body))
 ON CONFLICT(id) DO NOTHING RETURNING true INTO v_created;
 SELECT * INTO v_row FROM allin_private.v2_community_comments
 WHERE id=p_comment_id FOR UPDATE;
 IF v_row.id IS NULL OR v_row.author_id IS DISTINCT FROM v_actor
    OR v_row.post_id IS DISTINCT FROM p_post_id
    OR v_row.parent_comment_id IS DISTINCT FROM p_parent_comment_id
    OR v_row.body IS DISTINCT FROM btrim(p_body)
    OR v_row.revision<>1 OR v_row.deleted_at IS NOT NULL
 THEN RAISE EXCEPTION 'community_comment_id_conflict' USING ERRCODE='23505'; END IF;
 RETURN jsonb_build_object('authorId',v_actor,'postId',p_post_id,
   'commentId',p_comment_id,'revision',v_row.revision,
   'created',COALESCE(v_created,false));
END;
$comment_create$;
REVOKE ALL ON FUNCTION public.v2_community_create_comment(
 uuid,uuid,uuid,uuid,text,boolean)
 FROM PUBLIC,anon,authenticated,service_role;
