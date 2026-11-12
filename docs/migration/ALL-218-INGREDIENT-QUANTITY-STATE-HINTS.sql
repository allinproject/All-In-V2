-- ALL-218 / ALL-229 ingredient state triage. V1 READ ONLY.
-- Lexical hints in authored amounts; not normalized preparation-state evidence.
-- "No marker" does not mean an ingredient is raw or that its true state is unknown:
-- names, recipe methods and preparation metadata may convey state elsewhere.
-- Do NOT infer yield factors, replace authored amounts, or publish recipes from this report.

WITH ingredient_lines AS (
 SELECT r.id,
        ing.value AS line,
        COALESCE(ing.value->>'amount', ing.value->>'quantity',
                 ing.value #>>'{}','') AS amount_text
 FROM public.allin_recipes r
 CROSS JOIN LATERAL jsonb_array_elements(
   CASE WHEN jsonb_typeof(r.ingredients)='array'
        THEN r.ingredients ELSE '[]'::jsonb END
 ) ing
), markers AS (
 SELECT id, amount_text,
        (amount_text ~* '(raw|uncooked|as.purchased|dry)') AS raw_marker,
        (amount_text ~* '(cooked|prepared|drained|finished)') AS cooked_marker
 FROM ingredient_lines
)
SELECT COUNT(*) AS source_ingredient_lines,
       COUNT(*) FILTER(WHERE raw_marker AND cooked_marker) AS raw_and_cooked_hints,
       COUNT(*) FILTER(WHERE raw_marker AND NOT cooked_marker) AS raw_only_hints,
       COUNT(*) FILTER(WHERE cooked_marker AND NOT raw_marker) AS cooked_only_hints,
       COUNT(*) FILTER(WHERE NOT raw_marker AND NOT cooked_marker) AS no_explicit_state_hints,
       COUNT(DISTINCT id) FILTER(WHERE raw_marker AND cooked_marker) AS recipes_with_both_hints_on_a_line
FROM markers;

-- Standard recipe cards require finished edible quantities reviewed against
-- exact canonical ingredient + preparation-specific profile (ALL-228).
-- Freezer kits preserve raw/dry assembly (ALL-229).
-- Cooking yield must be exact reviewed evidence (ALL-225/229), never a regex.
