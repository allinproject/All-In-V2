# V2 Ingredient Database — Physical ERD & Security Proposal

**Status:** Proposed physical model for ALL-222 owner review; NOT deployed or migration-approved  
**Domain owner:** ALL-228 — V2 Ingredient Database  
**Consumers:** ALL-225 Calculator, ALL-218 Cookbook, ALL-226 Provider adapters, ALL-247 Fuel, ALL-248 Kitchen, ALL-235 Coach  
**Repository:** allinproject/All-In-V2  
**Branch reviewed:** integration/v2-foundation  
**Reviewed branch head:** 054e08fb5fbd91e6d1caffe863c423e3c95b0fdc  
**Supabase project:** xarhuczrtzuiljmtdaeu  
**Current applied migrations:** seven, through 20261110124420  
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

Migration 007 has now installed pg_cron 1.6.4 and scheduled the private purge helper hourly as postgres (`allin-v2-provider-cache-expired-purge`, minute 17 UTC, 5,000-row bound). Metadata and grant checks passed; the first scheduled run succeeded at 7:17 AM Central on 2026-11-10. The cache was empty, so no expired rows required deletion. ALL-227 still owns quota telemetry, cross-isolate throttling and provider deployment gates. This does not change the ingredient-domain proposal: cache rows remain source responses/candidates only, never canonical reviewed food profiles.

## 11. Beta decision recommendations and release gates — 2026-11-10

**Proposal only.** These are review recommendations for ALL-222/ALL-228, NOT founder/owner approval, executed schema, grant policy, or a direction to create a migration. They deliberately preserve the established canonical ownership model.

| Open owner decision | Recommended narrow beta default | Approval/evidence required before DDL |
|---|---|---|
| Preparation and locale | Use explicit `raw`, `cooked`, `cooked_drained`, `dry`, `as_sold`, `prepared` values; region and language are alias/source attributes, not silent preparation conversions | Ingredient owner approves states, exceptional country/product identity rules and state transitions |
| Launch nutrient minimum | Version a core required set: energy kcal, protein g, carbohydrate g and total fat g. Preserve optional nutrients as explicit values or absent/unknown; avoid false zero micronutrients | Nutrition owner approves exact energy/carb naming, units, conversion source and completeness version; label-only branded records need an explicit coverage status |
| Brand identity | Separate `branded_product` from `generic_food`, preserve exact GTIN including leading zeros; source identity uniqueness by provider + type + external ID | Ingredient/provider owner approves source type policy and no silent merges |
| Default profile | For a specific ingredient, preparation state and basis family, publish exactly one approved default. If multiple incompatible defaults exist, fail closed instead of picking first or latest | Owner approves priority/version rules, transitions and conflict resolution, including mass vs volume vs exact item |
| Review/publication | Keep candidate/needs_review segregated. For beta, allow a controlled seed/release operator workflow **only**, with no authenticated-athlete publication endpoint | ALL-222 approves designated operator identity, key custody, authorization, audit record and rollback procedure before any writer |
| Candidate staging | First reuse existing private provider-cache payloads for bounded discovery; no duplicate raw source store. Durable pending queue only after a concrete review workflow demonstrates the need | Provider/catalog owners approve queue necessity, TTL, PII minimization and operator visibility |
| Measurement units | Begin with g, ml and exact each-item basis; allow household conversions only with reviewed ingredient-and-state-specific mass/density/item evidence | Nutrition/cooking owners approve unit codes, evidence validity and conversion precedence |
| Review/seed retention | Preserve only minimal immutable source mapping, review actor/action time, reason, digest and seed-run counts; no provider API secrets or full duplicate payload archive | Privacy/security owner approves exact retention and deletion windows, lawful need and operator visibility |
| Merge and source withdrawal | Keep canonical identity stable. New source digest creates review-required revision; existing validated nutrition remains auditable. A merge retains redirect/history; retired sources cannot silently poison already logged records | Owner defines controlled transition/rollback, historical calculator snapshot support and source-license obligations |

### Pre-DDL acceptance slices already testable

- **Read adapter**: `apps/mobile-v2/src/features/cookbook/localIngredientProfiles.ts` resolves exact unique aliases and reviewed state/basis-specific profiles. Candidate, ambiguity, missing nutrient, competing defaults and unsupported conversion fail closed. It does not fetch from Supabase or providers.
- **Seed reconciliation**: `apps/mobile-v2/src/features/cookbook/ingredientSeedPreview.ts` yields deterministic candidate-only insert/unchanged/conflict/review-changed-source actions. It checks existing mapping integrity and rejects a changed source digest combined with a different approved V2 mapping.
- Both are **pure in-memory fixture contracts**, not proof of SQL/RLS. Once owner approvals exist, first deploy a minimal canonical **read** schema with explicit denial of direct athlete writes and verify anon/two-user RLS. Only then add a controlled seed publication path, bulk snapshot reconciliation and local recipe-open integration with zero upstream calls.

### Required external dependencies at the gate

1. **Owner decision:** Explicitly approve/adjust the above nine choices in ALL-222 and ALL-228; do not treat these recommendations as consent.
2. **Data source evidence:** Pin licensed USDA bulk snapshot/version/hash, selected V1 ingredient references and provider license/attribution before bulk import; record unmapped and rejected source rows.
3. **Build gate:** ALL-224 real Windows lockfile, clean install, TypeScript/Expo and live integration tests.
4. **Acceptance:** No athlete can publish shared ingredient facts; candidate data is never calculation-ready; exact identity/state/units are enforced; local recipe read and recalculation remain available without provider HTTP requests.

## 12. USDA initial-source candidate snapshot — official release verified, archive bytes pending

**Source investigation 2026-11-10:** USDA's [official downloadable datasets](https://fdc.nal.usda.gov/download-datasets/) list **Foundation Foods October 2026** and **Branded October 2026** as the latest bulk release categories; the [inventory/update log](https://fdc.nal.usda.gov/log/) identifies the **2026-10-29 v16.0** update. [USDA documentation](https://fdc.nal.usda.gov/faq/) confirms that SR Legacy's final release was April 2018, and that Branded product API records update monthly between twice-yearly bulk downloads.

**Proposed initial bootstrap sources (not yet locked or ingested):**

| Data type | Release | Official file | Intended treatment |
|---|---|---|---|
| Foundation Foods | 2026-10-29 / v16.0 | `https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_foundation_food_json_2026-10-29.zip` | First generic-food source **candidates**; exact FDC ID/data type and raw/cooked state review |
| SR Legacy | 2018-04 (final) | `https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_sr_legacy_food_json_2018-04.zip` | Supplementary generic candidates for reviewed gaps; preserve historical source class |
| Branded | 2026-10 | Official [download listing](https://fdc.nal.usda.gov/download-datasets/) | Separate branded candidates; no generic auto-merges, no package-to-generic substitution |
| Open Food Facts | Provider-controlled versioned source | Not part of USDA archive | Distinct community-sourced product candidate, quality and source license/review preserved |

**Byte verification status:** Downloading the official Foundation ZIP did **not** succeed in this session. Therefore there is **no verified SHA-256, actual record count, extracted contents audit, final importer field mapping, or approved seed file**. Never substitute an older release's checksum. Before any imported source is trusted, obtain the official archive, compute and store SHA-256, record byte length and archive member names, review FDC nutrient IDs/method/basis and snapshot a versioned manifest. This is a prospective source selection, **not** proof that data were downloaded.

**Licensing:** USDA [states FoodData Central data are public domain under CC0 1.0](https://fdc.nal.usda.gov/api-guide/), and asks for source attribution. Cite USDA/FoodData Central in the published ingredient source metadata; verify independent rights for other providers such as OFF rather than transferring USDA licensing assumptions to them.

**Required import review and reconciliation:** The existing dry-run `ingredientSeedPreview.ts` accepts candidates with exact provider+data-type+ID and payload hash; candidates remain unreviewed. Do not publish an automatically chosen USDA nutrient profile, assume SR Legacy is newer than Foundation, or turn missing values into zero. Store full, verified source-mapping/provenance and reviewed nutrient completeness only through the approved ALL-228 writer after ALL-222 authorization.

## 13. Guarded Windows archive acquisition — helper ready, ZIP not acquired

A source-only Windows PowerShell helper now exists at `scripts/prepare-v2-usda-foundation-snapshot.ps1` to complete the blocked official October 2026 Foundation Foods download. It writes to an **explicit user-chosen directory outside the Git checkout**, downloads only the official HTTPS ZIP, validates it can be opened as an archive, enumerates member filenames/sizes, computes the actual archive SHA-256 and writes a versioned local manifest. It does not extract or import ingredients, create or approve a nutrition profile, access Supabase, call providers beyond the official download, or deploy anything.

From the V2 repository root on Windows, the intended manual invocation is:

```powershell
.\scripts\prepare-v2-usda-foundation-snapshot.ps1 -DestinationDirectory "$env:USERPROFILE\Downloads\ALL-IN-365-USDA"
```

**No automatic invocation** as part of npm install, CI, or the app. The helper intentionally refuses to overwrite a previously created manifest or to use an in-repository destination; if an archive or manifest exists, preserve it and inspect before any retry. Do not run this until the Windows PC source-acquisition checkpoint is available. A separate low-cost static safety test is registered in the existing dependency-free smoke workflow; [run 42886098954](https://github.com/allinproject/All-In-V2/actions/runs/42886098954) passed. This checks source guardrails, **not** PowerShell execution or archive bytes.

**Still required:** Execute on Windows with network access, confirm manifest SHA-256 and archive member names/lengths, inspect official JSON structure and count source food IDs/nutrients, approve source snapshot and canonical catalog schema/review roles, then implement the controlled canonical importer and two-user/RLS acceptance. Source archive status remains **not acquired** in this conversation.

## 14. Independent local archive-manifest verification — source-only checkpoint

After the Windows acquisition helper creates a ZIP and manifest, independently verify the **actual downloaded bytes** using Node 22+ from the V2 repository root:

```powershell
node .\scripts\verify-v2-usda-foundation-manifest.mjs "$env:USERPROFILE\Downloads\ALL-IN-365-USDA\foundation-2026-10-29-manifest.json" "$env:USERPROFILE\Downloads\ALL-IN-365-USDA\FoodData_Central_foundation_food_json_2026-10-29.zip"
```

The verifier is read-only. It checks pinned USDA Foundation 2026-10-29 source identity and candidate-only status, manifest SHA-256/byte length, actual archive SHA-256 and length, member metadata safety, duplicate member names, and existence of a nonempty JSON member. The acquisition script separately opens the ZIP. The independent verifier also rejects a file without a ZIP local-file header, but does **not** independently decompress, validate ZIP central directory entries or inspect food JSON. It is **not** proof of published or reviewed nutrition. Both acquisition and verification must succeed before recording source bytes as verified; real ZIP acquisition remains outstanding.

Synthetic tampering/manifest tests are included in existing dependency-free smoke CI, not a full Windows/PowerShell execution or ingredient import.

## ALL-228 identity preflight implementation — 2026-11-12 (review only; NOT schema approval)

The existing proposed canonical Ingredient Database continues to own identities. Do not create a second ingredient store in Cookbook, Coach, Food Log or staging.

**Actual source audit:** `docs/migration/ALL-228-V1-INGREDIENT-IDENTITY-PREFLIGHT.sql` executed read-only against V1: 408 source profile rows and distinct source keys; 352 profiles with an aliases array; 162 with at least one missing value among legacy calories/protein/carbs/fat; 232 without a `metadata.source_url` or `metadata.source_id` in the checked fields; and **zero exact normalized alias/canonical-label collisions** across different V1 profile keys using case/whitespace normalization. A zero-collision source snapshot is not identity approval. Source review statuses include 161 `identity_only_not_calculation_ready`, 114 `source_record_transcribed`, 68 missing status and 53 `provisional_source_reference_not_final_verified`.

**Implemented read-only source identity projection:** `docs/migration/ALL-228-REVIEW-ONLY-INGREDIENT-IDENTITY-PROJECTION.sql` returns only source identity/provenance/alias metadata. Executed SQL: 408 records, 408 unique source profile keys, zero projected macro fields. All 408 deliberately retain `identity_kind:null`, `preparation_state:null`, `canonical_v2_id:null` in the source-review view. These are unanswered review questions, **not 408 newly approved V2 food identities**, and not evidence that profiles can be merged or that USDA has been ingested.

**Implemented candidate identity preflight:** `scripts/review-v2-ingredient-identities.cjs` and `.test.cjs` are a temporary *offline validation/check* on **separately reviewed** candidate JSON objects. They do not assign stable V2 IDs, write any database, call a provider, grant reviewer credentials or resolve ambiguous aliases. Required review fields: source profile key; proposed canonical name, identity kind `generic_food|branded_product`, preparation state `raw|cooked|cooked_drained|dry|as_sold|prepared`, locale, aliases; reviewed brand identity for branded goods; full external record tuple `provider+source_data_type+external_record_id` if present. GTINs stay strings with leading zeros. If an exact alias+locale+state belongs to different source identities, or an external source identity maps to competing candidates, surface a conflict rather than merging. Same food may have distinct raw/cooked profiles; ingredient identity and state-specific nutrition profile remain separate levels. Zero issues means **only structural preflight**; every output still has `calculationReady:false`, `publicationApproved:false`, `validForAutomaticMerge:false`.

The identity candidate preflight uses the existing targeted Cookbook no-deploy CI workflow rather than creating a competing job; script/test changes are path-triggered. The latest 12 committed tests passed in an isolated JavaScript harness, **not confirmed GitHub Actions/Node CI**. All code lives on `integration/v2-foundation`, no schema migration or seed applied. Real USDA Foundation source archive remains unacquired/unvalidated per the ALL-228 PC checkpoint. Ingredient source-ownership review, final physical schema/RLS review under ALL-222, source revisions and approved canonical writer are outstanding. This is progress on identity review **not final identity certification**.


## USDA October 2026 Foundation Foods archive — ACTUAL BYTE VERIFICATION (2026-11-12)

**This updates the earlier 'not acquired / DNS failed' checkpoint above, without granting schema, seed, identity or nutrient approval.** The official [USDA download listing](https://fdc.nal.usda.gov/download-datasets/) names Foundation Foods October 2026 JSON (~681K ZIP, ~9M uncompressed). A separate hosted Python environment successfully downloaded the actual file directly from the exact official [2026-10-29 ZIP URL](https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_foundation_food_json_2026-10-29.zip) twice, with matching independent SHA-256, HTTP 200 and content type application/zip.

| Verification property | Observed actual source bytes |
|---|---|
| Archive bytes | 696,866 |
| Archive SHA-256 | `dd414cc9f1a132626bad354ef6655972c78b44aff14f16114dc899708663c579` |
| ZIP members | Exactly 1, safe filename `FoodData_Central_foundation_food_json_2026-10-29.json` |
| Uncompressed JSON bytes | 9,349,340 |
| Member CRC32 | `8a8cde99` |
| Full ZIP CRC check | Passed (`ZipFile.testzip() is None`) |
| Uncompressed JSON SHA-256 | `990e7731dcec30cecbbb212896a0fe4333f38c65ce7f525e2b679f0dc27658a1` |
| JSON root | `FoundationFoods` |
| Actual food records / distinct FDC IDs | 424 / 424 |
| `dataType` | All 424 equal `Foundation` |
| Missing food descriptions / foods without nutrient entries | 0 / 0 |
| Total per-food nutrient entries | 22,138 |

The evidence record is versioned at `docs/evidence/ALL-228-USDA-FOUNDATION-2026-10-29-SOURCE-VERIFICATION.json`; it matches the manifest contract already used by `scripts/verify-v2-usda-foundation-manifest.mjs`. **The full 696,866 ZIP bytes were verified in an isolated hosted environment but are not deposited in this Git repository, the V2 Supabase project, or the user's PC.** The committed record provides a reference SHA against which any subsequent on-PC download can be checked, rather than pretending a locally retained archive exists.

**Remaining acceptance:** official ZIP byte integrity and JSON structural inventory are verified; individual nutrient mappings, approved ingredient identities/preparation state/source rights, canonical database writer and RLS (ALL-222), USDA profile review, seed idempotency, application integration, and production migration are **not** verified or authorized. No USDA records were ingested or marked calculation-ready. If the official URL later serves different bytes, treat it as source change requiring new evidence and review—not a silent manifest replacement.


## ALL-228 USDA↔V1 identity candidate reconciliation — 2026-11-12

A **complete review-only 424-record reconciliation** was executed against the **actual pinned USDA Foundation Foods October 2026 archive** (SHA-256 `dd414cc9f1a132626bad354ef6655972c78b44aff14f16114dc899708663c579`) and the committed **408-profile V1 macro-free identity source snapshot**. The existing and canonical offline owner is `scripts/reconcile-usda-foundation-identities.py`. It verifies the real archive hash/JSON structure before matching; the result is committed in `docs/evidence/ALL-228-USDA-FOUNDATION-V1-IDENTITY-RECONCILIATION-2026-11-12.json`. The temporary overlapping JS matching helpers were retired in favor of this owner.

**Exclusive USDA record outcomes (sum = 424):**

| Human review lane | USDA foods | Meaning |
|---|---:|---|
| `source_fdc_reference_review` | 8 | V1 profile source URL explicitly references FDC ID in this snapshot; verify food identity, form and basis |
| `exact_name_review` | 3 | FDC description exactly equals normalized V1 label or alias; still needs source/state review |
| `similar_name_review` | 110 | Token overlap (Jaccard ≥ 0.42, top three); **weak suggestions only**, not equality |
| `no_candidate` | 303 | No link established by these rules; **not evidence of an unavailable food** |

The eight explicit FDC URL review pairs are `328841:milk_cottage_2pct`, `790577:red_onion_raw`, `2346407:cabbage_green_raw`, `2644285:black_beans_canned_drained`, `2644288:chickpeas_canned_drained_rinsed`, `2644289:beans_kidney_canned_drained`, `2685580:tomato_paste_canned_unsalted`, `2685581:tomatoes_crushed_canned`. These links are stronger than text similarity but still not proof of matched ingredient preparation state, nutrient basis, salt/added-sugar form, provenance rights or calculation-ready coverage.

The complete committed report was reread and checked: 424 records, 424 distinct FDC IDs, status counts match the summary, every record has `canonicalIdentityApproved:false` and `nutrientProfileApproved:false`. The canonical Python source was executed successfully in an isolated hosted Python runtime on the real USDA archive and exact committed 408-profile snapshot; the full artifact is **not** a seeded database or approved mapping. A preceding exploratory lexical audit yielded different counts; those were superseded by this source-ID-aware canonical run. The canonical test file includes source-URL review cases; GitHub Actions status for the exact newest branch commit is not independently confirmed.

**Remaining reviews before canonical identities can be accepted:** resolve alias and food-form ambiguity; verify raw/cooked/dried/drained/state-specific identities; branded/generic distinction; exact primary source and nutrient-basis evidence (including the Foundation archive record IDs and any other USDA/OFF source needed); reviewer authority and ALL-222 physical RLS/write contracts; deterministic seed acceptance and app validation. Do not auto-promote 424 USDA source records or 408 V1 source profiles to V2 approved identity rows. No live V2 schema, data, publication or `main` changes were authorized.

## ALL-228 — eight source-evidence bindings applied to the existing review contract (2026-11-12)

**Read-only candidate review contract, not a migration or canonical writer**: `docs/evidence/ALL-228-EIGHT-REVIEWED-SOURCE-BINDINGS-2026-11-12.json` applies the existing `docs/evidence/ALL-228-EIGHT-DIRECT-FDC-FOOD-FORM-NUTRIENT-BASIS-2026-11-12.json` evidence to all eight direct FDC source references. The existing ALL-228 `scripts/review-v2-ingredient-identities.cjs` now exports `reviewSourceBindings()`; this joins records by V1 source key and checks exact USDA Foundation `external_record_id`, official HTTPS source URI, source food description, archived SHA-256, per-100 g basis, explicit nutrient energy ID, alternate 2047/2048 method and pending ALL-225 energy selection. It refuses duplicate or missing source keys, mismatched portions, source-file tampering, early readiness/approval, and inferred household/purchase/cooking yields. The **original** candidate `review()` and the proposed database ownership remain the sole canonical identity-review pathway; no duplicate nutrition/profile storage was introduced.

The eight proposed state *review scopes* (not accepted state assignments) are raw for `red_onion_raw`/`cabbage_green_raw`, cooked_drained for the three canned rinsed legumes, prepared for cottage cheese/canned tomato paste/canned crushed tomatoes. All are **generic-food suggestions only**; V1 labels/aliases do not automatically resolve to approved identities or erase USDA qualifiers. Specifically, black beans/chickpeas are sodium-added canned/drained/rinsed; kidney beans are *dark red, sodium-added, sugar-added* canned/drained/rinsed; tomato paste is *without salt added*, not sodium-free. Cottage cheese is composite generic 2% milkfat. Red onion/cabbage are raw, not cooked or untrimmed purchase mass. No USDA archive evidence supports the legacy 89-g chopped-cabbage cup measure.

The bindings carry exact source FDC IDs (as external identifiers, never V2 primary keys), source form qualifications, per-100-g basis and the energy method/source ID independently of a canonical nutritional fact. Two records use legacy USDA energy ID 1008/208; six use Atwater-specific 2048/958 and alternative general 2047/957. Choosing the canonical energy calculation remains **ALL-225's separate policy decision**. The proposed `reviewState:'needs_review'`, `calculationReady:false`, `approvedForPublication:false`, `authorizedToWrite:false` are invariant. No aliases, cup/item weights, yields, nutrient values, V2 IDs, roles, RLS grants, or production records were changed.

Validation: exact fetched branch review script and review evidence bindings passed structurally **8/8, zero issues**; all **15/15 committed test callbacks** passed in an isolated JavaScript execution harness. The existing no-deploy Cookbook workflow has path triggers for both evidence and binding files. An actual Node/GitHub Actions run of the newest revision has not been confirmed. **Still outstanding:** qualified human/domain acceptance of eight alias scopes and proposed states, complete nutrient coverage/provenance and calorie-method decision under ALL-225, ALL-222 physical/writer/RLS acceptance, and real V2 seed + installed-app tests. This is approved source evidence applied to *review contracts*, not eight approved calculation-ready profiles.
