# ALL-247 — Fuel canonical backend contract and acceptance plan

**Status:** Review-only implementation specification; not a deployed schema, API, or completed test.  
**Owner:** ALL-247 (Fuel). **Architecture approval gate:** ALL-222.  
**Related owners:** ALL-228 ingredients; ALL-225 calculator; ALL-248 prepared meals; ALL-239 goals; ALL-235 Coach; ALL-251 account export/deletion; ALL-250 Today.

## 1. One writer, one source of consumed truth

Fuel owns **actual consumption** and associated corrections. A planned recipe, meal-prep batch, shopping purchase, Coach suggestion, imported candidate or food photo does **not** imply consumption. Today, Progress and Coach consume the same versioned Fuel reader; they must not build a shadow Food Log or re-calculate unreviewed macros.

Proposed aggregate contracts (names are conceptual until ALL-222 approves the physical table/RPC matrix):

| Aggregate | Owner/key | Mandatory facts | Write operations |
| --- | --- | --- | --- |
| Consumed food event | authenticated athlete; stable entry ID | local consumption date/time and timezone, meal slot, food/recipe/prepared-portion reference or private custom food, exact quantity and unit, source identity, nutrition quality/coverage, creation/revision | add, correct, move date/slot, delete/tombstone |
| Hydration event | authenticated athlete; stable event ID | consumed volume, original unit, timestamp/timezone, provenance, optional category, revision | add, correct, move, delete |
| Daily numeric nutrition preference | athlete; effective-date/revision | opt-in and applicable energy/macro targets, goal-source/revision, exercise-adjustment authority | review, change, disable |
| Behavior-first food evidence | athlete; recorded action ID | chosen behavior/goal reference, date, user-confirmed evidence, revision | record, correct, remove |

Behavior-goal **definitions** remain ALL-239-owned; Fuel only owns optional evidence. Historical targets must remain versioned so later changes do not rewrite past meaning.

## 2. Typed writer boundary (review candidate)

Each client-originated mutation MUST take `expected_user_id` (compared to `auth.uid()` before any lookup), `action_id` (client-generated idempotency UUID), a typed operation, exact target ID when updating, `expected_revision`, and a validated payload. No generic database writer, wildcard service-role pathway or direct client table mutation.

- Apply under a single transaction; enforce owner authorization, quantity/unit validity and source identity; check expected revision before changes.
- Exact action replay returns the original committed ID/revision/result. Same action ID with different payload or owner fails closed, including after account switching. Concurrent writes cannot silently double-log.
- Tombstone or equivalent auditable deletion must remove an entry from derived intake immediately while following ALL-251 privacy/deletion policy.
- Prepared-meal completion and Food Log consumption are **separate intents**. A reviewed portion consumed creates exactly one Fuel event via Fuel's writer, linked to the existing prepared-batch/portion identity under ALL-248; retries, schedule changes and meal-prep completions cannot auto-create a second event.
- Coach receives a typed proposal/preview. Only explicit confirmation invokes the same Fuel writer, and success wording requires its authoritative receipt/readback.

**Schema not yet approved:** object/table names; FK targets; role grants; RLS predicates; RPC signatures, triggers, indexes, tombstone retention and media access. These require ALL-222 review before SQL migration.

## 3. Nutrition integrity and history

- Persist measured/user-entered quantities with source unit, basis, and reviewed conversion identity. Never assume raw/cooked, volume/mass, density or fractional-serving conversion when missing.
- A nutrition field has both a **value** (possibly zero or null) and evidence status: official/verified branded label; reviewed generic composition; reviewed prepared portion; user-entered custom; provisional estimate; unknown. A reviewed label does not imply complete micronutrients.
- Store or resolve nutrient basis/review revision for historical reproducibility; an upstream product/profile update cannot silently rewrite a logged exact-branded item into a generic substitute.
- Coverage is separate from accuracy. Missing entries or nutrients remain unknown, never zero; the UI must not label an unlogged day '0 consumed' or automatically classify it as non-adherence.
- Distinguish logged total from **complete-day estimate**. Daily energy remaining is only numeric when the user opted into a numeric goal and the relevant input/budget and exercise-adjustment authority are sufficiently known. Otherwise show partial/unknown, not fabricated 'left to eat'.
- Preserve per-event timezone/instant and athlete-selected day attribution; DST crossings, travel, late imports and moved entries must not duplicate or lose intake.
- Support behavior-only Fuel usage without requiring weighing, logging, macros or calorie goals.

## 4. Readers and integration

- Canonical day/history reader: authenticated scoped day range, explicit partial/unknown coverage, stable pagination, event revision, nutrition provenance, hydration and opt-in goal state; bounded response.
- Today Daily Extended: compact burned/eaten/remaining preview from authoritative Training/energy and Fuel owners, not a separate formula; Today Food preview may show only 3–4 *actual* small photo thumbnails with authorized storage reads. Detail link preserves day and entry ID.
- Coach, Progress and Recovery: bounded coverage/provenance-aware reads; no confident micronutrient deficiency/excess claims based on incomplete labels.
- Imports preserve provider/event identity, user consent, reviewed status and dedupe key. Imported candidates are not actual intake until accepted under the canonical policy; never create Community posts.
- Register exact Fuel tables, user-owned custom foods, private food media and event history in existing ALL-251 export/deletion/retention registries as each schema ships. Do not add a second export system.

## 5. Focused acceptance fixtures required BEFORE live implementation signoff

1. Account A creates/edits/reads; Account B JWT with A ID or A expected owner is denied before lookup; unauthenticated and unauthorized service access denied.
2. Insert then exact retry = one event, same result; altered-payload action-ID reuse denied; concurrent duplicate attempt remains single.
3. Stale revision rejects correction/move/delete; successful revision increments and updates daily aggregates without orphan or duplicate.
4. 0 g carbohydrate in verified record is zero, unknown carbohydrate remains null; an entirely unlogged or partial day is not represented as zero.
5. Fractional recipe portions, unit/basis mismatch and raw-vs-cooked conversions return deterministic values or explicit unsupported/unknown status.
6. Meal preparation without consumed confirmation creates no Food Log; explicit consumed portion logged once; repeat completion cannot duplicate.
7. Entries across midnight, DST and timezone changes land on the intended day; move between dates adjusts both summaries exactly once.
8. Custom private foods and photos are invisible to second account; photo deletion, account export and full deletion cover dependent media and entries.
9. Imported duplicate provider events reconcile by stable provenance without auto-posts; Coach suggestion alone does not log; successful Coach apply requires a verified canonical receipt.
10. Behavior-only user sees no forced calorie targets, false missing-data warnings or invented intake; numeric-goal user sees partial versus complete-day totals accurately.

## 6. Execution order and approval gates

1. Reconcile existing V2 nutrition/import/prepared-meal source and ALL-222 owner matrix (no competing model).
2. Have ALL-222 approve physical Food/Hydration/goal-evidence tables, owner/retention policy, exact RPC & RLS matrix and ALL-251 registry additions.
3. Implement one small reversible migration and deterministic RPC tests for Food event add/edit/move/delete with two account identities and idempotency.
4. Add hydration, then coverage-aware aggregate reader and numeric/behavior-goal integration, then prepared-meal/Coach/import adapters.
5. Verify on populated staging and device, including account export/deletion and Today preview; promote only through existing release gates.

**Not yet done:** database schema/migration, authenticated end-to-end tests, mobile wiring or production deployment. Do not mark ALL-247 complete from this document.
