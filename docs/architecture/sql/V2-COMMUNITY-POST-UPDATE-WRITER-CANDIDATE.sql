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
