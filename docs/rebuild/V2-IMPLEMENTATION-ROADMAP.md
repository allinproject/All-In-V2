# ALL IN 365 V2 — Foundation & Delivery Roadmap

**Status:** Foundation underway; V2 backend baseline applied; full mobile build/runtime validation outstanding.  
**V2 source:** `allinproject/All-In-V2`, branch `integration/v2-foundation`  
**V2 backend:** Supabase project `xarhuczrtzuiljmtdaeu` (All-In-V2)  
**Tracking:** Linear project `ALL IN 365 — V2 Rebuild`

## 1. Product and architecture decisions (locked)

- V2 is an independent application and backend. V2 Supabase is canonical from the first V2 account onward.
- V1 is read-only source material for approved behavior, code, product-owned catalog data, legal/business documents, website assets and design specifications.
- The founder is the only V1 user. Create a fresh founder account in V2; do not migrate V1 Auth/passwords, the single 16-message test Coach thread, or personal profile/training/Food Log rows by default.
- Do not replay V1's accumulated migration history wholesale. Design a clean V2 schema using the proven V1 domain requirements and invariants.
- Approved App Art handoff v2 is closed. Implement it; do not loop through repeated visual approvals or regenerate already-approved screen designs.
- One canonical writer per domain. Coach can propose; it cannot bypass user approval or the owning feature writer.
- All work is small, traceable and independently testable. No feature is "done" on source inspection alone.

## 2. Current foundation — verified

### GitHub

- Repository: https://github.com/allinproject/All-In-V2
- Active implementation branch: `integration/v2-foundation`
- Latest refreshed branch head during roadmap review: `054ab62fdf71da5050622f0274ef48bfdcf82f6d`.
- App source is in `apps/mobile-v2/`.
- V1 reference repository remains `allinproject/ALL-IN`.

### V2 mobile source

- Expo Router app shell with sign-in, sign-up, legal acceptance, onboarding holding and protected home routes.
- Persistent Supabase client/AuthProvider scaffold configured for V2.
- V2 access gate uses `v2_my_profile_state`, not V1 RPC names.
- Signup requires exactly three published V2 legal documents, review acknowledgements, age confirmation and fresh V2 account creation.
- Shared design tokens use the approved palette and the starter routes consume those tokens.
- Auth/access pure tests exist, but dependency installation, lockfile, TypeScript, Expo bundling, live signup and device tests remain outstanding.

### V2 Supabase

Two migrations are applied:

1. `v2_auth_profile_legal_foundation`
2. `v2_tighten_profile_privileges_and_legal_versions`

Current V2 tables:
- `v2_profiles`
- `v2_profile_settings`
- `v2_onboarding_progress`
- `v2_legal_documents`
- `v2_legal_acceptances`
- private idempotency ledger `allin_private.v2_profile_settings_actions`

Verified in an isolated rolled-back SQL transaction:
- Auth user insert creates profile/settings/onboarding rows.
- Owner A and owner B see only their own profile.
- Direct legal acceptance table insertion is denied.
- Versioned settings patch saves once and exact retry returns the original version.
- Reusing an action ID with a different payload is rejected.
- A stale expected version is rejected.
- Legal acceptance cannot be recorded while no current legal versions are published.
- Profile update privilege is limited to display name/avatar columns.
- Temporary Auth users and records were rolled back; no V2 users or personal records remain.

### Security note requiring closure

Supabase reports RLS disabled on `allin_private.v2_profile_settings_actions`. Current effective privileges were separately checked: `anon` and `authenticated` have no USAGE on `allin_private` and no SELECT on this table, so the public API path is currently closed. Still close the scanner advisory with a reviewed V2 migration and re-test the `SECURITY DEFINER` writer path before adding more private tables.

Supabase's suggested SQL is:

```sql
ALTER TABLE "allin_private"."v2_profile_settings_actions" ENABLE ROW LEVEL SECURITY;
```

Do not run it alone without validating the intended owner/function behavior and policy model; it is tracked as a dedicated security task.

### Legal status

V2 contains zero published legal documents. This is intentional. The V1 Founder Beta Legal Package is a working draft, not approved final text. V2 signup must remain closed until Terms, Privacy and Founder Beta Terms are reviewed, finalized, seeded as V2 versions and published. The UI already fails closed.

## 3. V1 assets preserved for selective porting

- **Coach:** Exact V1 deployed `allin-coach` v18, ACTIVE, JWT verification enabled, source SHA-256 `da56531e252d924a0915b1168f923f51985a004fd6d4c91bb1a8e341f90fefe3`, is stored as a 22-file immutable reference under `docs/migration/reference/coach-v18/`. It is not yet adapted or deployed. Staged V13 is not the live source.
- **Cookbook:** V1 baseline: 1,019 recipes; 1,293 selectors; 5,876 selector options; 408 ingredient profiles; 2,855 component mappings. Preserve all status/provenance: only one source recipe was `tested/published`; 886 were `draft/published` and 20 `draft/unpublished`. Do not assume published/active equals cookbook-ready.
- **Design:** Full approved App Art handoff v2, current design authority, UI Component & Asset spec, Badge system spec, and historical V1 visual-QA checkpoint are copied to `docs/product/` and `docs/migration/reference/`. The v2 handoff's APPROVED = CLOSED rule is authoritative.
- **Business:** Product/brand operating summary and the November 3 $8,991 first-year gross-sales estimate are copied. That estimate is not actuals, net income or a complete operating plan. The October 22 $5/month referral handoff is retained as historical only; $9.99/month is current founder pricing.
- **Legal:** V1 working-draft source has been identified; final review/approval and V2 publication remain open.
- **Website:** Domain `https://allin365.app` is identified, but current website editor/hosting/source not yet confirmed. Connected Wix listing returned no sites.
- **Figma:** Approved design handoff is available; editable file key/page hierarchy not yet located.

## 4. Delivery phases and hard gates

### Phase 0 — Engineering foundation and architecture

**Goal:** Make V2 reproducible, secure and understandable before growing the schema.

Deliver:
- V2 domain map and ownership table (Auth/Profile, Coach, Cookbook, Training, Food Log, Pantry/Shopping/Meal Prep, Recovery, Community, Integrations).
- Per-domain data classification, read/write surfaces, owner key, canonical writer, idempotency strategy, RLS policy matrix and retention/privacy expectations.
- Supabase migration conventions, local/reset/reseed workflow, generated DB types, dev/test/prod environment separation and secrets inventory.
- Private-schema RLS/security remediation; function search_path/grants review.
- CI for dependency install, typecheck, focused tests, SQL migration replay, lint and Expo bundle.

**Gate:** clean V2 database can be recreated from migrations; all exposed tables have reviewed RLS/grants; private tables are not API-exposed; same commit produces repeatable typecheck/test/build results.

### Phase 1 — V2 Auth, legal and first-run profile

**Goal:** Founder can create one fresh V2 account under approved legal terms.

Deliver:
- Final Terms, Privacy and Founder Beta Terms; version/hash/effective date.
- Fresh signup, email confirmation/resend, password reset, session restore, logout and account-switch invalidation.
- V2 profile bootstrap, settings, onboarding state and completion writer.
- Legal acceptance is immutable, exact-version, idempotent and visible to the owner.
- Abuse controls and email delivery/redirect configuration.

**Gate:** two synthetic V2 users cannot read or mutate each other's profile/settings/legal receipt; current legal versions required before private app access; restart/session recovery passes on a physical iPhone. No real signup until legal approval.

### Phase 2 — Coach v18 port

**Goal:** Preserve V1 Coach capability without its V1 backend dependencies.

Deliver:
- Dependency map for all V18 imports, RPCs, tables, storage, environment variables, model/provider usage and rate/cost controls.
- V2-owned conversation/thread/message schema and writer/readers.
- Port safety, deterministic bypasses, context assembly, memory boundaries, privacy, timeout/retry/degraded-provider behavior and usage telemetry.
- Typed proposed-action contract; no canonical mutation without explicit approval.
- Test fixtures for common sports/training, nutrition, recipes, profile context, error paths and prompt injection.

**Gate:** authenticated Coach request on V2 creates one message and durable thread history; restart restores it; owner isolation and limits pass; provider failure is safe; no V1 runtime RPC/table/secret dependency remains.

### Phase 3 — Cookbook and ingredient-first nutrition foundation

**Goal:** Move product-owned recipe content and the latest V1 ingredient-first calculator, not stored recipe macro totals.

Deliver:
- V2 recipe catalog stores ingredients, quantities/units, instructions, serving/yield, selectors and source provenance — no recipe-level calorie/macro fields or nutrition JSON.
- Port V1's current deterministic ingredient-first nutrition calculator and Cooking Yield evidence engine. Calculate derived per-serving output from current ingredient profiles and actual recipe state.
- Port USDA FoodData Central generic ingredient search/details and Open Food Facts exact branded/barcode discovery through V2 server-side adapters; keep API keys server-side and provider provenance explicit.
- Reproducible versioned catalog seed; stable IDs/source mapping; deterministic re-runs without duplication. Exclude legacy recipe macro JSON and selector macro deltas.
- Separate cookbook-readiness/publication status from mere import/published flags.
- Recipe card/detail, search/filter, version history and user-owned My Versions. Nutrition shown on a recipe is calculated output, never imported recipe macro data.
- Coach recipe proposal review: Use once / Save My Version / Cancel.
- V2 canonical save RPC with exact owner/action/payload/base-revision binding, idempotency and stale-write refusal.

**Gate:** selected catalog counts and relationships reconcile; representative recipe nutrition/yield/method tests pass; cancel/use-once do not save; explicit save occurs once; history reappears after restart.

### Phase 4 — Core whole-fitness workspaces

Implement each workspace as a vertical slice with route inventory, canonical domain model, writers/readers, empty/loading/error states, mounted interactions, owner isolation and journey tests.

1. Today and global navigation.
2. Train: calendar/day, plan review, active session, completion and activity identity.
3. Fuel: Food Log, nutrition history/goals and hydration.
4. Kitchen: Cookbook, Pantry, Shopping, Meal Prep, Prepared Meals.
5. Recovery: daily state, recovery sessions and history.
6. Community/RaceHub: privacy, follows, posts, race profiles and activity linkage.
7. Profile/Settings: goals, preferences, equipment, privacy, connections and account lifecycle.

**Gate per workspace:** every screen and control has a clear owner and acceptance; one user action causes one canonical mutation; retries and cancellation are safe; no regressions in another workspace.

### Phase 5 — Platform, integrations and commercial operations

- Apple Watch and HealthKit; route/GPS/HR; sensor and FTMS equipment behind their existing independent physical-control gates.
- Garmin/Coros only when the post-beta integration decision is reached.
- Music and notification integration, deep links, background/task lifecycle and offline behavior.
- Subscription entitlement, seven-day trial, $9.99/month, referral eligibility/rewards, App Store/StoreKit compliance and billing lifecycle. No ads/free tier; do not carry forward old $5 pricing.
- Website source/owner confirmed; legal/privacy links, support contact, domain, analytics, email and deployment process.

**Gate:** actual device/provider evidence, purchase/cancel/restore tests, privacy and account deletion flows, and support/website readiness.

### Phase 6 — Full acceptance and beta

- Route/screen inventory is complete.
- Every button, field, menu, navigation edge, empty/error/loading state and workflow is tested.
- Migration/seed is repeatable; RLS and cross-account tests cover every private domain.
- Performance, accessibility, crash, network degradation, restore and offline cases pass.
- Fresh install and upgrade path, privacy deletion/export, legal acceptance and billing acceptance pass.
- Founder beta checklist is signed off; no "release ready" based on source-only results.

## 5. Current next actions (ordered)

1. Close the private-table RLS advisory safely; verify internal SECURITY DEFINER writers still work.
2. Establish reproducible npm lockfile/install/typecheck/Expo build/CI for the exact V2 branch.
3. Finish V2 domain/security architecture matrix before adding Coach/Cookbook tables.
4. Finish legal source review and create approved V2 legal versions; keep signup gated until then.
5. Map all V1 Coach v18 dependencies and build the V2 Coach schema before adapting/deploying its Edge Function.
6. Design V2 Cookbook schema and readiness states; then build deterministic catalog export/seed.
7. Complete the first end-to-end founder journey; only then expand the remaining workspaces.

## 6. Explicit non-goals

- No V1 account/password migration or personal-history import by default.
- No wholesale migration of V1's ~958 migration files.
- No copied V1 RLS weaknesses, broad grants, service-role keys in the mobile app, or provider credentials in client code.
- No repeated approval of already-approved designs.
- No website DNS change/public deployment until current owner/source is identified and separately approved.
- No claim of build/test/device/provider acceptance without recorded evidence.


## Cookbook / nutrition architecture decision — 2026-11-10

The latest V1 app's ingredient-first nutrition calculator is the V2 authority. Do not bring across old recipe-level nutrition blobs or selector macro deltas. Port the pure arithmetic kernel in `Native/src/lib/recipeAdaptationNutritionEvidence.ts`, recipe-open calculation/estimate pipeline in `Native/src/data/recipeNutritionOnOpen.ts`, source coverage checks, and Cooking Yield admission/intelligence modules. Keep food identity lookup, source review, quantity conversion and arithmetic as separate steps.

V1's currently deployed `search-food-products` Edge Function is ACTIVE v7/JWT-protected (SHA-256 `6ffc6825214f20bb484078b47c35b79f43f6fcfce5447c9f7473ac1fc6267346`) and includes USDA generic FDC search plus Open Food Facts/Search-a-licious branded text discovery. V1 `lookup-food-barcode` uses an exact GTIN path with USDA Branded first and Open Food Facts product v3 fallback. Port these as V2-owned functions; do not call V1 endpoints at runtime or copy V1 secrets.

Detailed design and official provider requirements: [V2 Cookbook Ingredient-first Nutrition Calculator](../architecture/V2-COOKBOOK-INGREDIENT-FIRST-NUTRITION-CALCULATOR.md). Work is tracked by ALL-225 (calculator/yield), ALL-226 (USDA/OFF providers), then ALL-218 (catalog seed without recipe macro fields).


## Founder-approved ingredient database rule — 2026-11-10

The V2 Ingredient Database is a first-class reusable product system, not simply the provider cache. It is the calculator's normal source of nutrition truth. Recipe opens, reopens, serving-count changes, quantity edits and ordinary recipe recalculations must perform **zero USDA/Open Food Facts HTTP calls** when ingredient profiles are already available locally.

- Bootstrap common generic ingredient profiles from reviewed USDA FoodData Central bulk datasets and/or controlled batch imports; preserve FDC ID, data type, nutrient basis, source/licence and retrieval provenance.
- Keep stable V2 ingredient identities and aliases separate from provider IDs. Exact unique aliases resolve locally; ambiguity goes to review rather than guesswork.
- Store nutrients per explicitly declared basis (100 g, 100 mL, exact each/item etc.); unknown nutrient values remain null. No universal piece weights, density or cooking conversion assumptions.
- Store preparation state and review/readiness lifecycle. Search candidates are not calculator-ready until identity/state/source/basis/coverage review passes.
- Keep provider response cache separate from durable reviewed ingredient profiles.
- Use USDA only for true local-catalog gaps and controlled batch refresh. Open Food Facts is for branded/packaged products and GTIN identity; its quality and licence metadata remain visible.
- Source refresh is globally budgeted, queued and backed off based on USDA rate headers/429 and separate OFF limits. No search-as-you-type.
- When an ingredient is missing, show a clear partial/manual-review state; never make recipe open depend on upstream APIs or invent nutrition.

The architecture and implementation plan live in [V2 Cookbook ingredient-first calculator spec](../architecture/V2-COOKBOOK-INGREDIENT-FIRST-NUTRITION-CALCULATOR.md). Schema ownership and policy are established by ALL-222; ingredient DB/import implementation is tracked as ALL-228; calculator integration is ALL-225; provider discovery/refresh is ALL-226/ALL-227.


## Founder-approved cooked-recipe quantity and Pantry-aware raw Shopping decision — 2026-11-10

Standard Cookbook recipe-card ingredient quantities represent the finished cooked/prepared edible amount required by the meal. Raw/as-purchased amounts are derived only when a recipe is put into the Meal Plan. Freezer kits are the sole explicit exception: they remain raw/dry assembly workflows with their existing freeze/defrost/cook lifecycle.

Meal Plan scales cooked ingredient demand for planned servings, consumes compatible usable cooked/prepared Pantry inventory first, converts only the remaining cooked target to raw/dry/as-purchased amount using exact reviewed Cooking Yield evidence, then deducts compatible raw/dry Pantry stock. Shopping receives only the final as-purchased shortage after these two state-specific coverage steps. Keep cooked and raw inventory separate; never deduct cooked ounces from a raw-ounce purchase requirement. No usable yield evidence means a clear manual-review demand, not a guessed purchase amount.

Before V2 catalog publication every standard recipe needs an audit of cooked/prepared ingredient quantities, explicit unit/state, serving reconciliation, yield metadata and review state. Freezer kits are counted separately as exempt. Report compliant/corrected/freezer-kit-exempt/yield-missing/manual-review counts; do not auto-rewrite uncertain recipes.

See the detailed contract in `docs/architecture/V2-COOKBOOK-INGREDIENT-FIRST-NUTRITION-CALCULATOR.md`. The V2 vertical slice is tracked as ALL-229.


## Coach training intelligence, athlete history, predictions and race/route quality — 2026-11-10

The founder requires Coach to be more than a memory-enabled chatbot: it must synthesize coherent, evidence-grounded plans; coordinate multiple simultaneous sports; adapt safely from daily user input; understand the athlete's relevant full history; and produce coherent race and route plans.

### Research assets recovered

The V1 Library contains reviewed research/implementation handoffs:
- `ALL-IN-Coach-Research-Audit-Implementation-Roadmap-v1.md`: 17 reviewed evidence domains and a recommendation to consolidate shared deterministic decision primitives and connect them to task-gated Coach knowledge. It explicitly distinguishes research breadth from implementation/deployment.
- `ALL-IN-Concurrent-Hybrid-Training-Research-v1-Handoff.md`: running/cycling/swimming/strength/mixed modality, session priority/order/spacing, systemic vs mechanical/local load, energy availability, primary vs secondary goals and no fake modality conversions.
- `ALL-IN-Training-Load-Fatigue-Adaptation-Research-v1-Handoff.md`: multi-dimensional load, sport-specific load decomposition, subjective/performance/recovery signal weighting, individual longitudinal response and smallest effective adjustment.
- `ALL-IN-Strength-Programming-Intelligence-Research-v1-Handoff.md`: goal-first strength programming for maximal strength, hypertrophy, power, sport support, return, plateau and fatigue.
- `Training-Planning-Prediction-Handoff.md` (2026-10-21): documents outside-live-app `performancePrediction.ts`, `multiGoalConflict.ts` and `trainingPlanBuilder.ts`, with live wiring still required at the time of that handoff.

### V1 source reality checked

- There are plan proposal validators, a reviewed race-plan outline/phase expander and whole-goal plan contracts. The current race-plan outline uses a conservative progression ceiling heuristic and scales reviewed sessions. It validates reviewed baseline, availability, recovery, session limits, long-session limits, phases, recovery/taper and race-week integrity. This is important safety/structure, but it is not yet evidence that Coach is a validated exercise-science optimizer for every mixed-sport athlete.
- Session and conflict guards model cross-sport priorities and replacement-only substitutions. The codebase has an all-sport session journey and multisport progress summary. These are useful primitives; 3+ sport schedule synthesis still needs explicit scenario-based validation.
- Coach task-gated canonical context refreshes Training plan/day, Progress evidence, completed workouts, race and Recovery on relevant tasks. It does not mean every historical workout/strength set/restriction is currently retrieved as one complete longitudinal profile on every plan decision.
- V1 supports running prediction snapshot persistence/history and strict standard-running-distance payload validation. Ultra predictions are rejected. The prediction handoff says the algorithm and builder existed outside the live app and live wiring remained required. Until recovered and validated, V1's prediction engine is **not considered fully live/complete**.
- Periodized race-plan validation, race-specificity decisions, Race Strategy attached to a canonical race workout/course version, and provider route geometry validation/ranking/explicit attach exist. Those contracts do not by themselves prove the generated strategy/plan is coherent for a particular athlete; end-to-end scenario evaluation is required.

### V2 execution tracks

- ALL-230: Coach must honor established workout structure, schedule and hard exercise restrictions.
- ALL-231: evidence-grounded plan synthesis for running+strength, running+cycling+strength, triathlon+strength, primary/secondary goals, phase and whole-week load arbitration.
- ALL-232: complete queryable longitudinal athlete history and bounded task-relevant retrieval with provenance, data-quality/coverage and latest canonical state.
- ALL-233: recover/port and validate the performance prediction algorithm; sport-specific predictions only when model/evidence support them; running ultra predictions remain excluded.
- ALL-234: audit Coach race strategy, full race plans and route plans for physiological/operational coherence, verified course/aid facts, route safety, race execution and end-to-end acceptance.

### Durable Coach principles

- Current user-approved Training plan and hard restrictions outrank generic templates, model defaults and stale conversation summaries.
- Plan generation begins from primary/secondary goal hierarchy, actual multi-sport history/load, current plan, availability, recovery and exercise restrictions.
- Do not convert run/cycle/swim/strength loads with fake universal ratios; preserve modality-specific mechanical, local and systemic stress components.
- Multi-day planning and daily adjustment are separate: an individual missed/poor session does not automatically rewrite the entire block; proposed changes preview/review through Training's canonical writer.
- Coach should retrieve the relevant complete history from canonical owner systems, not dump all data into every prompt. Include source, date, revision, confidence and known coverage gaps.
- Unknown working weights, unavailable history, insufficient prediction data or unverified course details remain unknown. Coach must ask or present a bounded alternative, not invent.
- A plan may look structurally valid but still be bad training. Acceptance therefore includes expert/human review of realistic scenarios, not only schema tests.


## Coach training intelligence and evidence audit — 2026-11-10

Founder direction: Coach must create coherent plans for runners who strength train, runners who also bike/lift, and athletes combining three or more sports. It must adapt day by day to athlete input without silently rewriting the accepted block. Coach must use canonical whole-athlete history, not just recent chat summaries.

See [V2 Coach Training Intelligence and History](../architecture/V2-COACH-TRAINING-INTELLIGENCE-AND-HISTORY.md).

V1 source audit:
- Research: 17 reviewed Coach Evidence Registry domains plus dedicated concurrent/hybrid, training load/fatigue/adaptation and strength programming handoffs. Reviewed guidance is not proof of live plan-generator integration.
- Multi-sport: V1 has cross-sport session/canonical activity and conflict/adaptation guards, sport-specific context and race-plan outlines. The recovered plan-builder handoff is a single-primary-modality skeleton, not a complete validated runner+bike+strength or triathlon synthesizer.
- History: V1 Coach has task-gated canonical context readers and Progress/Strength/Race/Completed Activity summaries. That does not establish a complete longitudinal athlete-history retrieval contract with provenance and sport/time coverage.
- Predictions: V1 has running snapshot persistence/readers for mile/5K/10K/half/marathon and a separate algorithm/test handoff. That handoff described the algorithm as outside the live app and said live wiring remained required. Do not claim the V1 prediction engine was fully wired; ultra predictions remain excluded.
- Race/route: V1 has real periodized plan, race strategy/course-version and route-provider validation primitives. End-to-end physiological/operational coherence remains to be audited.

V2 deterministic Training slice committed: `apps/mobile-v2/src/features/training/trainingPlanSynthesis.ts` + tests. It accepts Coach-proposed intents, preserves distinct sport demand, schedules across declared goals/sports, blocks restrictions/duplicates/unavailable fixed days, flags high-demand density and proposes review-only day adaptations. Source tests are committed but not yet executed. The slice does not yet prescribe session dose, connect Athlete History, write canonical plans, generate complete periodization or pass end-to-end scenarios.

Linear: ALL-230 plan/restriction reliability; ALL-231 plan synthesis; ALL-232 athlete history; ALL-233 prediction; ALL-234 race/route coherence. ALL-232 supplies evidence to ALL-231/ALL-233/ALL-234. ALL-222 owns schema/security. ALL-217 owns Coach runtime port.


## Race-course intake, full-horizon calendar and missed-session adaptation — 2026-11-10

Founder-approved requirements:
- A race plan request triggers course evidence acquisition from the official race website/organizer first, or user-supplied GPX/files/links/confirmed manual information. Capture route, elevation gain/loss, surface/technicality, event date/version and aid stations with field-level provenance, retrieval date and confirmation. Never invent stations or course facts; missing details remain unknown and any unsupported course-specific plan remains provisional.
- Ask the user for the exact first training date. Build the entire daily calendar from that selected date through and including race day, including long horizons such as 36 weeks; include rest/unavailable states, phase progression, recovery weeks, peak/taper and no post-race work. Do not silently start next Monday or use a short template.
- When a workout is missed or availability changes, review the remaining accepted plan through race day using whole-athlete history and current recovery. Mark skipped only when confirmed, do not cram/move the missed workout automatically, protect key sessions, and present versioned changes for athlete approval.

V2 source: `trainingPlanLifecycle.ts` provides the exact-date inclusive calendar and missed-session reflow proposal; `raceCourseEvidence.ts` validates field-level course/aid provenance. Their tests are part of `test:training-logic`, not yet executed. See [Coach Training Intelligence and History](../architecture/V2-COACH-TRAINING-INTELLIGENCE-AND-HISTORY.md) sections 9.
