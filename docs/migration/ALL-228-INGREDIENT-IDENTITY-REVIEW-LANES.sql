-- ALL-228 source-identity human review lanes, READ-ONLY V1.
-- Exclusive classification for triage. Source statuses are NOT V2 approval.
-- The names source_and_preparation_verification and source_evidence_review
-- indicate unresolved work, not that the source/food identity is verified.
WITH profiles AS (
 SELECT profile_key,metadata->>'review_status' AS review_status,
        (metadata->>'source_url' IS NOT NULL
         OR metadata->>'source_id' IS NOT NULL) AS has_checked_source_reference
 FROM public.allin_ingredient_profiles
), lanes AS (
 SELECT profile_key, CASE
  WHEN review_status='duplicate_candidate_do_not_use' THEN 'duplicate_retirement_review'
  WHEN review_status IS NULL THEN 'missing_review_state'
  WHEN review_status='identity_only_not_calculation_ready'
    OR review_status='known_ingredient_identity' THEN 'identity_only_review'
  WHEN review_status LIKE 'provisional%'
    OR review_status LIKE '%unverified%' THEN 'provisional_reference_review'
  WHEN NOT has_checked_source_reference THEN 'source_evidence_review'
  ELSE 'source_and_preparation_verification'
 END AS review_lane
 FROM profiles
)
SELECT review_lane,count(*) AS source_profiles
FROM lanes GROUP BY review_lane ORDER BY review_lane;
-- All 408 candidates are unapproved; lane classification never assigns a
-- canonical V2 id or generic/branded kind, raw/cooked state, nutrients or yields.
