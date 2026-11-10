# V2 Ingredient Database — Physical ERD & Security Proposal

**Status:** Proposed physical model for ALL-222 owner review; NOT deployed or migration-approved  
**Domain owner:** ALL-228 — V2 Ingredient Database  
**Consumers:** ALL-225 Calculator, ALL-218 Cookbook, ALL-226 Provider adapters, ALL-247 Fuel, ALL-248 Kitchen, ALL-235 Coach  
**Repository:** allinproject/All-In-V2  
**Branch reviewed:** integration/v2-foundation  
**Reviewed branch head:** 820936636cfc48ddfd26a995aabe332882be60b4  
**Supabase project:** xarhuczrtzuiljmtdaeu  
**Current applied migrations:** six, through 20261110122952  
**Last reconciled:** 2026-11-10

> This is a first physical-schema proposal for a future V2 domain. It deliberately does not create or deploy tables. ALL-222 and the ALL-228 owner must approve the exact columns, constraints, role model and writer boundary before a migration is authored. The existing Auth/Profile/Legal foundation remains the only deployed business schema.

## 1. Binding product/data decisions

1. V2 owns stable ingredient identity. USDA FDC IDs, OFF IDs and GTINs are source identifiers, not canonical V2 primary keys.
2. Common/generic foods and branded packaged products are distinct identity kinds. An exact scanned branded product must not be silently replaced by a generic food.
3. One ingredient identity can have multiple preparation-specific profiles (raw, cooked, cooked-and-drained, dry, as-sold, prepared). A calculator request must resolve the matching state; no silent substitution.
4. A profile has an explicit nutrient basis: mass, volume or exact item/each. The amount and unit are stored, not inferred from a label or serving description.
5. Nutrient facts are normalized by nutrient code and canonical unit. A missing nutrient is absent/unknown, never an invented zero. A known measured zero is stored as numeric zero.
6. Source quality, nutrient completeness, identity confidence, preparation state and review lifecycle are separate dimensions. A label-reviewed product can still have incomplete micronutrients.
7. Candidate search results are not calculation-ready. They require identity, basis and preparation-state review before a profile can be published for calculator use.
8. The public ingredient catalog is product-owned shared reference data. Users can read approved records but cannot edit canonical facts. User custom foods and user-entered corrections belong to ALL-247, not the shared catalog.
9. Provider response caching remains owned by the existing allin_private.v2_provider_cache and its service-role-only RPCs. Do not create another cache or store provider credentials in database rows or mobile code.
10. Routine recipe open/reopen, serving changes, amount edits and nutrition recalculation use local V2 records only. If the required local profile exists, the operation makes zero USDA/OFF requests.
11. Recipe content, authored recipe macros, selector changes, Pantry lots, prepared portions and cooking-yield evidence remain under their separate canonical owners.
12. A seed can be rerun deterministically without duplicating V2 ingredients, source identities, aliases or profiles. Seed provenance and importer versions are retained.

## 2. Proposed physical ERD

The following is the recommended logical-to-physical shape for the ingredient domain. It is a proposal, not a deployed database ERD.

| Entity | Primary key | Main relationships |
|---|---|---|
| public.v2_ingredients | id | Parent of aliases, profiles, source records and measurement conversions; optional self-reference for merge target |
| public.v2_ingredient_aliases | id | Many aliases map to one canonical ingredient |
| public.v2_ingredient_nutrition_profiles | id | Many preparation/basis-specific profiles belong to one ingredient |
| public.v2_nutrient_definitions | code | Shared nutrient vocabulary |
| public.v2_ingredient_profile_nutrients | profile_id + nutrient_code | Join profile to each known nutrient value |
| public.v2_ingredient_source_records | id | Provider/manual source identity mapped to an ingredient |
| public.v2_ingredient_profile_sources | profile_id + source_record_id | Many-to-many profile/source evidence |
| public.v2_ingredient_measure_conversions | id | Ingredient/state-specific reviewed conversion evidence |
| allin_private.v2_ingredient_review_events | id | Private immutable review history |
| allin_private.v2_ingredient_seed_runs | id | Private deterministic bootstrap/import provenance |

### Key foreign-key relationships

- Ingredient aliases, nutrition profiles, source records and conversions reference v2_ingredients.id.
- Ingredient profile nutrient values reference both nutrition_profiles.id and nutrient_definitions.code.
- Ingredient profile sources reference both nutrition_profiles.id and source_records.id.
- A conversion references its ingredient, may reference the exact profile/state it supports, and may reference the source record that proves it.
- Review events reference the ingredient and any affected profile/source record; they are private operational audit data.
- Seed runs are private import metadata and do not become nutrition facts.

## 3. Table-by-table proposed contract

### 3.1 public.v2_ingredients — stable canonical identity

Proposed columns:
- id UUID primary key.
- canonical_key TEXT not null unique: deterministic, stable V2 identity key; never derived solely from an external source ID.
- canonical_name TEXT not null; normalized_name TEXT not null.
- identity_kind TEXT not null: generic_food or branded_product.
- food_group TEXT null: controlled category vocabulary.
- status TEXT not null: active, retired, merged.
- merged_into_ingredient_id UUID null references v2_ingredients(id).
- created_at and updated_at.

Constraints/indexes:
- canonical_key is unique and immutable after first publication.
- status='merged' requires a valid non-self merge target; active/retired rows have no merge target.
- Search indexes on normalized name and canonical name; use an approved text-search strategy, not a client-generated fuzzy identity.
- No user owner column: these are shared product-owned reference records, not user custom foods.

### 3.2 public.v2_ingredient_aliases — exact name resolution

Proposed columns:
- id UUID primary key; ingredient_id UUID not null references v2_ingredients(id).
- normalized_alias TEXT not null; locale TEXT not null default 'en'.
- preparation_state TEXT null: null means the alias is not state-specific; a non-null state is an exact state hint, not permission to use a mismatched profile.
- alias_kind TEXT not null: canonical synonym, common name, source description, reviewed abbreviation or another explicitly admitted kind.
- status TEXT not null: active, retired, superseded.
- Source/review provenance and timestamps.

Constraints/indexes:
- Unique for the same ingredient + normalized alias + locale + state scope (use a NULL-safe expression/index for the optional state).
- Do not make normalized_alias globally unique across ingredients: ambiguity is valid data and must fail closed at resolution time.
- Resolver evaluates exact normalized text and compatible scope, then requires exactly one canonical ingredient. Zero is missing; more than one is ambiguous. Never select the first row or ask a language model to guess.
- Token reordering is allowed only under the existing exact-token-set rule and only if exactly one candidate remains.

### 3.3 public.v2_ingredient_nutrition_profiles — preparation/basis-specific nutrition

Proposed columns:
- id UUID primary key; ingredient_id UUID not null references v2_ingredients(id).
- preparation_state TEXT not null: initial controlled values include raw, cooked, cooked_drained, dry, as_sold, prepared. Extend only with domain review.
- basis_quantity NUMERIC not null and > 0; basis_unit TEXT not null: g, ml, each.
- basis_label TEXT not null: display evidence such as 100 g, 100 mL, or one exact item.
- coverage_status TEXT not null: partial, label_only, launch_core_complete, expanded_profile. This records completeness, not source trust.
- review_status TEXT not null: candidate, needs_review, reviewed, calculation_ready, retired, superseded.
- source_quality TEXT not null: controlled source trust class, separate from coverage.
- profile_revision INTEGER not null and > 0.
- required_nutrient_set_version TEXT not null, making readiness/completeness reproducible as the launch nutrient contract evolves.
- is_default BOOLEAN not null default false; effective_at, reviewed_at, created_at and updated_at.

Constraints/indexes:
- each basis is valid only for an exact one-item basis (basis_quantity=1) with a confirmed item identity/label. No generic “serving” is treated as a gram quantity.
- g and ml basis values are explicit and never interchanged by label. A 100 mL product profile cannot be read as 100 g without reviewed density/measurement conversion.
- Only one default calculation_ready profile per ingredient + preparation state + basis family. Multiple non-default/source-specific profiles may be retained.
- State mismatch, unknown basis or incomplete launch-core nutrients makes a profile unavailable to the calculator.
- Profile status transitions are writer-validated; mobile cannot change review status or profile facts.
- A profile is calculation-ready only when identity and preparation state are confirmed, basis is exact, the current launch-core nutrient set is present, and required provenance/review evidence exists.

### 3.4 public.v2_nutrient_definitions and public.v2_ingredient_profile_nutrients

Nutrient definitions:
- Stable TEXT code primary key (for example energy_kcal, protein_g, carbohydrate_g, total_fat_g, dietary_fiber_g, saturated_fat_g, sodium_mg, potassium_mg, calcium_mg, iron_mg).
- display_name, canonical_unit, display group/order and launch_core BOOLEAN.
- FDC/OFF provider nutrient IDs map to these canonical codes through adapter-owned, versioned normalization; external nutrient IDs never become canonical keys.

Profile nutrient values:
- Composite primary key (profile_id, nutrient_code); FK to nutrition profile and nutrient definition.
- amount NUMERIC not null and >= 0.
- One row means the nutrient value is known on that profile's exact declared basis. No row means unknown/not supplied. A known zero remains an explicit row with amount=0.
- The unit is inherited from the referenced nutrient definition; no per-row unit ambiguity.
- Do not store a JSON nutrition blob as the authoritative normalized profile and do not create recipe-level macro columns.

### 3.5 public.v2_ingredient_source_records and public.v2_ingredient_profile_sources

Source record fields:
- Stable UUID and nullable ingredient_id FK (null only for a retained, unassigned source candidate if that lifecycle is approved).
- provider TEXT: usda_fdc, open_food_facts, manufacturer_label, reviewed_manual or another explicitly approved provider/source type.
- external_record_id TEXT not null; source_data_type TEXT not null (FDC Foundation/SR Legacy/Branded, OFF product, label review, etc.).
- Optional exact GTIN with preserved leading zeros; validate check digit in the ingestion boundary.
- source_description, brand_owner, source_quality, source_license, attribution and source URL.
- source_revision, source_modified_at, retrieved_at, payload_sha256.
- mapping_status: candidate, mapped, rejected, superseded.

Constraints/indexes:
- Unique external source identity on (provider, source data type, external record ID); preserve multiple provider records for one V2 ingredient.
- A GTIN is an exact product identity hint, not permission to merge products or generic foods.
- Never store API keys, bearer tokens or full raw provider responses here. The existing private provider cache stores bounded response payloads separately.
- Source mapping changes are reviewed/versioned; do not overwrite a historical source identity in place.

Profile-source join:
- Composite key (profile_id, source_record_id).
- evidence_role: primary, corroborating, label-verification or superseded.
- A profile's primary source must be an explicitly linked source record. A source candidate alone is never a profile.

### 3.6 public.v2_ingredient_measure_conversions — reviewed quantity evidence

Proposed columns:
- id UUID primary key; ingredient_id UUID not null references v2_ingredients(id).
- Optional profile FK and preparation state to constrain context.
- from_quantity NUMERIC not null and > 0; from_unit TEXT not null.
- result_grams NUMERIC not null and > 0: exact conversion target for the declared input quantity.
- conversion_kind TEXT: food-specific item weight, household volume/density, label serving conversion, measured portion or another reviewed type.
- source_record_id UUID null, evidence note/reference and review status.
- measured_at/reviewed timestamps as appropriate.

Rules:
- A cup/tablespoon/mL-to-grams conversion must be ingredient- and preparation-specific and have verified density or direct weight evidence.
- An each/item conversion must be exact for that product/form and cannot be generalized to all ingredients in a category.
- A conversion is calculation-usable only when reviewed and context-compatible. Unverified provider serving strings are not conversion rows.
- Do not create recipe cooking-yield conversions here. Cooking Yield (ALL-225/ALL-229) remains its own evidence owner.

### 3.7 Private review and seed operations

Proposed private operational records:
- allin_private.v2_ingredient_review_events: immutable audit events for candidate/profile/source review, state transition, rationale, prior/new revision, operator/system actor reference and event time.
- allin_private.v2_ingredient_seed_runs: deterministic seed version, source snapshot date/hash, importer version, start/end, terminal status and reconciled counts (inserted, updated, unchanged, rejected, unmapped).
- Candidate queue/staging is only added when a real operator review workflow requires durable pending candidates; do not duplicate v2_provider_cache or build a second raw provider payload store.
- Actor identity/role for internal catalog review is not currently defined by the V2 Auth/Profile work. ALL-222 must identify the designated business/operations owner and approve a narrowly scoped reviewer capability before any persistent review writer is exposed; ALL-251 contributes user account lifecycle, privacy and consent semantics but does not itself establish an internal operator role. Do not guess that every authenticated athlete is an ingredient reviewer. Until the operator role is approved, profile publication remains a controlled release/migration process with database-owner credentials; no athlete-facing mutation RPC exists.

## 4. Relationships and lifecycle

- Ingredient identity is stable across providers and profile revisions.
- An ingredient may have many aliases, source records, preparation-specific nutrition profiles and measurement conversions.
- A profile has one or more linked source records and zero or more known nutrient rows. A missing nutrient row is unknown, not zero.
- A source record may support multiple reviewed profiles only when its evidence legitimately supports each preparation/basis identity; the mapping must be explicit.
- A merge preserves the retired ingredient ID and redirect target. Alias/source/profile history is not silently deleted.
- A profile refresh creates a new revision or supersedes an old one with traceable provenance. It does not mutate a historical calculator result's source facts.
- Calculator output is derived from the current profile IDs/revisions, ingredient IDs, preparation states, exact quantities, serving count, measured finished batch mass (only if actually measured) and calculator version. It is not an authored catalog row.
- User custom food and manual Food Log corrections are separate private user-owned records (ALL-247), not shared ingredient mutations.
- Cookbook ingredient lines/selectors reference canonical ingredient IDs (ALL-218); they do not copy nutrients.
- Pantry lots and raw/cooked stock remain separate stateful inventory (ALL-248/ALL-229); they do not own canonical ingredient nutrition.
- Cooking Yield evidence remains separate and keyed by food/form/method/doneness/handling (ALL-225/ALL-229).

## 5. Proposed read/write and security matrix

This domain has no user-specific owner column on canonical ingredient facts. It is a shared product-owned reference catalog.

| Object | Classification | RLS | Authenticated direct access | Anon | Service/operator boundary |
|---|---|---|---|---|---|
| public.v2_ingredients | Shared canonical reference | Enabled | SELECT active canonical identities only | No access | Controlled seed/review writer |
| public.v2_ingredient_aliases | Shared canonical reference | Enabled | SELECT active aliases that resolve to active identities | No access | Controlled seed/review writer |
| public.v2_ingredient_nutrition_profiles | Shared nutrition facts | Enabled | SELECT only calculation_ready profiles | No access | Controlled review/version writer |
| public.v2_nutrient_definitions | Shared product reference | Enabled | SELECT all published definitions | No access | Migration-controlled definition changes |
| public.v2_ingredient_profile_nutrients | Shared nutrition facts | Enabled | SELECT only values belonging to visible calculation-ready profiles | No access | Controlled profile writer |
| public.v2_ingredient_source_records | Shared provenance metadata | Enabled | SELECT mapped/approved provenance for visible profiles | No access | Controlled source mapping |
| public.v2_ingredient_profile_sources | Shared provenance relationship | Enabled | SELECT links for visible profiles | No access | Controlled profile writer |
| public.v2_ingredient_measure_conversions | Shared conversion evidence | Enabled | SELECT reviewed, context-compatible conversions only | No access | Controlled review writer |
| allin_private.v2_ingredient_review_events | Private operational/audit | Enabled; no policies | No schema/table access | No access | Migration/owner-function only; never athlete-readable |
| allin_private.v2_ingredient_seed_runs | Private operational/import provenance | Enabled; no policies | No schema/table access | No access | Migration/owner-function only; no direct Data API access |

Security rules:
- Public schema tables receive explicit RLS and explicit grants. No blanket client write grants.
- Authenticated clients are read-only consumers of approved shared reference data. There is no owner-scoped UPDATE policy because the athlete is not the owner/editor of canonical facts.
- Candidate/unreviewed profiles are not visible as calculation-ready data; user-initiated search results remain visibly review-required responses.
- No authenticated SECURITY DEFINER mutation RPC is proposed. This avoids expanding the current advisor warning surface and prevents every signed-in athlete from publishing canonical facts.
- Do not add a permissive policy to private audit/seed tables to silence a no-policy advisor notice. Keep schema USAGE and table grants revoked for anon/authenticated; use a narrowly scoped owner function only if a later reviewed operator workflow needs one.
- The current ALL IN product has no finalized operator role. Until ALL-251 defines authorized review actors and audit identity, changes to shared source/profile facts use controlled migrations/seed/release tooling with elevated credentials, never mobile client calls.
- USDA credentials remain Supabase Edge Function secrets. OFF requests use the required descriptive User-Agent. Provider function responses are candidate discovery, not trusted profile writes.

## 6. Function and event boundary

Current V2 already has:
- allin_private.v2_provider_cache with RLS/no direct Data API grants.
- Service-role-only v2_provider_cache_get/put RPCs.
- Edge Functions v2-search-usda-ingredients, v2-search-openfoodfacts-products and v2-lookup-food-barcode.

The provider functions return candidate data with source, quality, licence, exact provider identity, basis and review_required=true. They do not make the candidate a canonical ingredient profile. Keep this distinction.

Future domain operations, only after ALL-251/operator approval:
- Resolve exact local alias/profile for calculation.
- Explicit candidate search/discovery.
- Create/review/approve a canonical ingredient and profile.
- Supersede/retire/merge with audit history.
- Publish a deterministic seed batch and reconcile source identities.

For any future mutation endpoint:
- It must be server-side; no provider secret or service-role key in the mobile bundle.
- It must identify an authorized reviewer/service actor, not trust a client-supplied status.
- Use an idempotency/action key for retried import/review commands and compare exact target/payload on replay.
- Use expected profile/ingredient revision for stale mutation refusal.
- Record actor, action, source evidence, prior/new status and profile revision in the private event ledger.
- Do not add public SECURITY DEFINER RPCs until the need and actor contract are reviewed.

## 7. Calculator compatibility and migration order

Current V2 code facts:
- recipeNutritionCalculator.ts is pure arithmetic. It accepts only reviewed matching profiles with mass in grams or exact one-item basis; no identity lookup, alias matching, provider call, persistence, serving conversion or inferred cooking yield occurs inside the calculator.
- foodDataCentral.ts normalizes Foundation/SR Legacy data into a 100 g candidate; it preserves missing values as null and marks the candidate unreviewed.
- OFF/GTIN Edge Functions distinguish branded exact product lookup from generic USDA search and preserve source quality/licence. Search results remain candidates.
- Existing provider cache and cache RPCs own external response caching; do not duplicate.
- The generated mobile database type currently covers the five existing public foundation tables and six RPCs. Ingredient tables do not yet exist and must not be added to generated types before an approved migration.

Implementation sequence after ALL-222 approval:
1. Finalize profile basis/unit and nutrient registry contract with ALL-225; reconcile the current calculator's grams/each interface and define the explicit adapter that converts reviewed household measures into grams before calculation.
2. Finalize review actor and publication boundary with ALL-251. If no operator capability is authorized for beta, keep controlled bootstrap/review scripts as the only writer.
3. Finalize source identity/provenance, preparation-state vocabulary and exact alias resolution with ALL-226/ALL-228.
4. Author one small migration for nutrient definitions and canonical identity/profile read model; a second migration may add conversions/review audit only if required by the first usable slice. Do not create recipe, Pantry, Food Log or cooking-yield tables here.
5. Add anon/two-user security tests, direct-write denial, candidate-not-ready visibility tests, alias ambiguity tests, state mismatch tests and source/profile revision tests.
6. Deterministically bootstrap the selected generic records using USDA Foundation first and SR Legacy only where reviewed coverage justifies it. Candidates do not become ready automatically. Preserve source snapshot, importer version, source IDs and counts.
7. Generate database types only after migration approval/application; run clean reset/replay, typecheck and integration tests under ALL-224.
8. Integrate ALL-225 calculator read adapter and prove zero provider HTTP calls for local ready profiles. Provider failure must not break existing local calculation.

## 8. Required acceptance tests

- Stable V2 identity when an FDC ID/OFF ID or brand description changes.
- Exact provider source identity is unique; a GTIN retains leading zeros and check-digit validation.
- Candidate and needs-review data cannot be read as a calculation-ready profile.
- Exact alias resolves only when it maps to one ingredient; duplicate/ambiguous aliases fail closed.
- Raw, cooked, cooked-drained, dry, as-sold and prepared profiles never substitute for each other.
- Profile basis 100 mL never acts as 100 g; exact item basis is exactly one identified item.
- A missing nutrient has no row and remains unknown; a true zero is a row with numeric zero.
- Label-reviewed does not imply complete micronutrients; branded and generic source classes remain distinct.
- Source refresh creates a new version or controlled supersession; previous provenance remains auditable.
- A direct authenticated INSERT/UPDATE/DELETE to shared ingredient facts is denied.
- Anon cannot read the V2 ingredient catalog.
- User A cannot mutate or publish canonical facts; the user-facing app has read-only access.
- A provider timeout/rate limit returns retryable candidate discovery failure and does not break local ready-profile lookup/calculation.
- Recipe open/reopen, amount changes, serving changes and calculation with all profiles present produce zero USDA/OFF HTTP calls.
- Seed rerun with the same snapshot/importer version creates no duplicates and reconciles inserted/updated/unchanged/rejected/unmapped counts deterministically.
- No recipe macro columns, custom user foods, Pantry inventory or cooking-yield records appear in this schema.

## 9. Decisions required before DDL

1. Confirm controlled preparation-state vocabulary and whether regional/locale variants affect identity or are represented as aliases.
2. Confirm launch nutrient definitions/units and versioned calculation-ready minimum set.
3. Confirm if branded GTIN products are separate v2_ingredients identity_kind='branded_product' rows (recommended) and the exact source identity uniqueness contract.
4. Confirm profile default selection/preference when multiple valid source profiles exist for one ingredient/preparation state.
5. Confirm the designated business/operations reviewer identity, privilege and publication workflow through ALL-222; coordinate account lifecycle and privacy implications with ALL-251. No athlete-facing canonical mutation is recommended.
6. Confirm whether pending candidates are transient responses or need private persisted review staging. Do not store a second copy of raw provider responses.
7. Confirm exact household-unit code list and how reviewed volume/density/item conversions enter the calculator.
8. Confirm retention and deletion behavior for private review/seed audit records.
9. Confirm source mapping and merge/supersession behavior when USDA/OFF records change or are withdrawn.

Until these decisions are approved, do not create an ingredient migration, publish candidates, expose a write RPC or claim Ingredient Database implementation is complete.


## 10. Provider-cache implementation verified after proposal — 2026-11-10

The shared cache used by the proposed source-record layer is already a separate deployed infrastructure object. Migration 003 created the private cache/RPCs; migration 006 added `v2_provider_cache_prune_expired(integer)`, applied as database version `20261110122952`. The purge is service_role-only, bounded to 1–5,000 expired rows per call, and uses `FOR UPDATE SKIP LOCKED`. Live rollback-only verification passed and confirmed fresh rows survive; direct private table access remains denied to service_role.

There is no scheduled invocation yet: pg_cron/pg_net/pgmq are absent. ALL-227 owns selecting and verifying an approved scheduled-maintenance path, quota telemetry and provider deployment gates. This does not change the ingredient-domain proposal: cache rows remain source responses/candidates only, never canonical reviewed food profiles.
