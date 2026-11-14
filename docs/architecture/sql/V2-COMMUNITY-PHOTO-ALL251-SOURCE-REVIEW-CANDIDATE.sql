-- ALL-244 / ALL-251 REVIEW ONLY, NOT A MIGRATION.
-- Server-owned canonical Community photo source for the EXISTING account
-- export/deletion inventory and checkpoint workflows. This is NOT a new
-- export system or permission to register Community in an active archive.
-- The calling worker must validate real Auth identity and the exact owner
-- and approved export/deletion request before invoking this function.
-- Require one pinned repeatable-read snapshot; never paginate photo evidence
-- across independent HTTP requests or silently truncate pending sources.
CREATE OR REPLACE FUNCTION allin_private.v2_all251_community_photo_sources_review(
 p_owner_id uuid
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=''
AS $photo_source_review$
DECLARE
 v_total bigint;
 v_rows jsonb;
BEGIN
 IF p_owner_id IS NULL OR
   pg_catalog.current_setting('transaction_isolation') <> 'repeatable read'
 THEN RAISE EXCEPTION 'Pinned Community photo owner snapshot required'
   USING ERRCODE='42501'; END IF;
 -- Reject oversized inventories rather than truncating. Include pending and
 -- delete_pending rows: they must block completed export/deletion approval.
 SELECT count(*) INTO v_total
 FROM allin_private.v2_community_post_photos p
 WHERE p.owner_id=p_owner_id;
 IF v_total>128 THEN
   RAISE EXCEPTION 'Community photo inventory too large for bounded snapshot'
     USING ERRCODE='42501'; END IF;
 -- Explicit canonical post join proves ownership, not just an owner prefix.
 SELECT COALESCE(pg_catalog.jsonb_agg(
   pg_catalog.jsonb_build_object(
    'id',p.id,'post_id',p.post_id,'owner_id',p.owner_id,
    'post_owner_id',post.owner_id,'post_version',p.post_version,
    'bucket_id',p.bucket_id,'object_path',p.object_path,
    'content_type',p.content_type,'byte_length',p.byte_length,
    'width',p.width,'height',p.height,'sha256',p.sha256,
    'lifecycle',p.lifecycle,'verified_at',p.verified_at
   ) ORDER BY p.id
 ),'[]'::jsonb) INTO v_rows
 FROM allin_private.v2_community_post_photos p
 JOIN allin_private.v2_community_posts post
 ON post.id=p.post_id AND post.owner_id=p.owner_id
 WHERE p.owner_id=p_owner_id;
 IF pg_catalog.jsonb_array_length(v_rows)<>v_total
 THEN RAISE EXCEPTION 'Community post/photo owner graph incomplete'
   USING ERRCODE='42501'; END IF;
 RETURN pg_catalog.jsonb_build_object(
   'ownerId',p_owner_id,'complete',true,'rows',v_rows,
   'reviewOnly',true,'completeUserExport',false,
   'accountDeletionReady',false
 );
END;
$photo_source_review$;
REVOKE ALL ON FUNCTION allin_private.v2_all251_community_photo_sources_review(uuid)
 FROM PUBLIC,anon,authenticated,service_role;
-- No GRANT EXECUTE, no Storage writer, no operational export registration,
-- no deletion authorizations and no policy deployment.
