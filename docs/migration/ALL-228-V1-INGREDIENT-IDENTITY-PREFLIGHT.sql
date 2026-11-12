-- ALL-228 / ALL-218 — V1 ingredient identity source-readiness audit.
-- READ ONLY. Not canonical V2 identity mapping; do not copy V1 macros or yields.
-- Distinguish identity, aliases, preparation-state and nutrition evidence.
SELECT count(*) AS source_profiles,
       count(DISTINCT profile_key) AS unique_source_keys,
       count(*) FILTER (WHERE calories IS NULL OR protein_g IS NULL OR carbs_g IS NULL OR fat_g IS NULL) AS incomplete_four_macros,
       count(*) FILTER (WHERE metadata->>'source_url' IS NULL AND metadata->>'source_id' IS NULL) AS missing_checked_source_url_and_id,
       count(*) FILTER (WHERE jsonb_typeof(metadata->'aliases')='array') AS alias_array_present
FROM public.allin_ingredient_profiles;

SELECT coalesce(metadata->>'review_status','<missing>') AS source_review_status,
       count(*) AS profiles
FROM public.allin_ingredient_profiles
GROUP BY 1 ORDER BY profiles DESC, source_review_status;

WITH labels AS (
 SELECT profile_key, lower(regexp_replace(btrim(label),'[[:space:]]+',' ','g')) AS token
 FROM public.allin_ingredient_profiles
 WHERE nullif(btrim(label),'') IS NOT NULL
), aliases AS (
 SELECT p.profile_key,
        lower(regexp_replace(btrim(a.value #>> '{}'),'[[:space:]]+',' ','g')) AS token
 FROM public.allin_ingredient_profiles p
 CROSS JOIN LATERAL jsonb_array_elements(
   CASE WHEN jsonb_typeof(p.metadata->'aliases')='array'
        THEN p.metadata->'aliases' ELSE '[]'::jsonb END) a
 WHERE nullif(btrim(a.value #>> '{}'),'') IS NOT NULL
), names AS (
 SELECT * FROM labels UNION ALL SELECT * FROM aliases
)
SELECT token,array_agg(DISTINCT profile_key ORDER BY profile_key) AS candidate_profiles
FROM names GROUP BY token HAVING count(DISTINCT profile_key)>1
ORDER BY token;

-- Zero collisions here DOES NOT establish reviewed canonical identities.
-- Aliases require explicit locale/preparation scope; prepared/raw/cooked are
-- distinct profile states; provider identity is a source reference, not a V2 PK.
-- Legacy review_status and numeric macro presence are not authority for
-- calculation_ready. Never infer missing nutrient zeros or cooking yield.
