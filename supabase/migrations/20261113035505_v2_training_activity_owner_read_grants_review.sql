-- ALL-222/243/246 / Step 2: REVIEW-ONLY exact reader grants.
-- NOT approved for hosted deployment, PR merge, or app feature activation.
-- Canonical owner/session checks stay inside both existing SECURITY DEFINER
-- read functions; no table SELECT, mutation, writer, private helper, or public
-- anonymous execution is granted here.
-- This follows the versioned owner schema and complete-coverage owner readers.
REVOKE ALL ON FUNCTION public.v2_training_day_read_candidate(uuid,date)
 FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.v2_completed_activity_detail_candidate(uuid,uuid)
 FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.v2_training_day_read_candidate(uuid,date)
 TO authenticated;
GRANT EXECUTE ON FUNCTION public.v2_completed_activity_detail_candidate(uuid,uuid)
 TO authenticated;
