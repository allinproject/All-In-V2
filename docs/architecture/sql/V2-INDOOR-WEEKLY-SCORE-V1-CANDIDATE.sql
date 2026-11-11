-- ALL-253 REVIEW ONLY. V1 challenge-score-v1 SQL parity candidate for V2.
-- NOT A MIGRATION. No grants to clients. No score submission RPC.
-- Sole source reference: V1 allin_private.weekly_challenge_score_breakdown_v1
-- inspected 2026-11-11. The trusted competition service must derive all
-- arguments from canonical Completed Activity power samples, frozen baseline,
-- interval coverage and verified source evidence; never accept client values.
CREATE OR REPLACE FUNCTION allin_private.v2_indoor_weekly_score_breakdown_v1(
  p_completion numeric,
  p_execution numeric,
  p_relative_ftp numeric
) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path=''
AS $score$
SELECT jsonb_build_object(
  'version','challenge-score-v1',
  'completionFraction',round(greatest(0::numeric,least(1::numeric,coalesce(p_completion,0))),5),
  'prescribedExecutionIndex',round(greatest(0::numeric,least(1::numeric,coalesce(p_execution,0))),5),
  'scoredEffortRelativeToFtp',CASE WHEN p_relative_ftp IS NULL THEN NULL ELSE round(p_relative_ftp,5) END,
  'completionPoints',round(20*greatest(0::numeric,least(1::numeric,coalesce(p_completion,0))),3),
  'executionPoints',round(30*greatest(0::numeric,least(1::numeric,coalesce(p_execution,0))),3),
  'scoredEffortPoints',round(50*greatest(0::numeric,least(1::numeric,coalesce(p_relative_ftp,0)/2)),3),
  'score',round(
    20*greatest(0::numeric,least(1::numeric,coalesce(p_completion,0)))+
    30*greatest(0::numeric,least(1::numeric,coalesce(p_execution,0)))+
    50*greatest(0::numeric,least(1::numeric,coalesce(p_relative_ftp,0)/2)),3
  )
);
$score$;
REVOKE ALL ON FUNCTION allin_private.v2_indoor_weekly_score_breakdown_v1(numeric,numeric,numeric)
  FROM PUBLIC,anon,authenticated;
COMMENT ON FUNCTION allin_private.v2_indoor_weekly_score_breakdown_v1(numeric,numeric,numeric) IS
  'Review-only exact V1 NUMERIC score breakdown; args must come only from trusted server reconciliation, not clients.';
