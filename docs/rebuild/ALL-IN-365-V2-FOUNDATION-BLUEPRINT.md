# ALL IN 365 — V2 Foundation Rebuild Blueprint

**Status:** Baseline established; V2 application scaffold started; runtime validation outstanding  
**Baseline date:** 2026-11-09 America/Chicago  
**V2 Repository:** `allinproject/All-In-V2`
**V1 reference repository:** `allinproject/ALL-IN`  
**Implementation branch:** `integration/native-watch-v301`  
**Release constraints:** `main` untouched; PR #2 stays open/draft/unmerged; `releaseReady=false`.

## 1. Executive decision

Build a cleaner V2 mobile application foundation beside the current Native application, then migrate capability-by-capability through proven vertical slices. Do not rewrite the current app in place, reset branches, discard staged/recovered work, or replace the backend as a first move.

The V1 application and V1 Supabase project are read-only reference sources during the rebuild. V2 owns its new account system, database, Coach history, recipe catalog and canonical domain writers from the beginning. Port approved V1 product behavior and product-owned catalog assets selectively; do not build a customer migration or carry over the lone founder/test Coach thread by default.

This is a foundation rebuild, not a change in the product promise. The approved product remains **ALL IN 365 — Live All In. Your whole fitness life in one place.** It serves beginners through endurance athletes and multisport users, strength athletes, cyclists, walkers, and people building healthier routines.

## 2. Refreshed baseline and authority

### GitHub / release boundary

- PR #2 is currently **OPEN / DRAFT / UNMERGED**.
- PR base is `main`; main remains at `193dd471911b74bbfc41cfc6fc3141f0f4e1c367` and is not the implementation source.
- PR head at baseline refresh: `b1a26b1134ccb41d3ff71c1786ec67d2e681d889` on `integration/native-watch-v301`.
- The PR description explicitly preserves the physical Apple Watch, HealthKit, equipment and device acceptance boundaries.
- Keep `releaseReady=false`. Static/source checks do not equal installed-device or provider acceptance.
- The repository currently contains 2,632 tracked tree entries at the referenced head, including the Native application, Supabase source, tests, decisions, checkpoints, and recovery/integrity records.

These are a dated baseline, not permanent facts. Before every consequential implementation change, refresh current integration HEAD and the exact target file(s). Never rely on this document in place of that refresh.

### Existing application inventory

The Native Expo Router application has **95 route source files** at the baseline tree. They span:

- **App/auth:** root routing, sign-in, sign-up, auth callback, forgot/reset password, join/access gate, onboarding and training onboarding.
- **Core tabs:** Today, Train, Coach, Community, Fuel, Profile.
- **Training:** Calendar/day, plans, manual and periodized plans, race plans, plan review, route library/editor, adjusted pace, challenges, strength setup/session, Active Training, completed workout detail/edit/review/share, gear and shoe feedback.
- **Nutrition/Food:** Fuel, Food Log, Nutrition, What Should I Eat, recipe discovery/card, recipe import, Made This, Meal Plan/add/cook/freezer cook, Meal Prep/session, Pantry, prepared-meal review, Shopping/list/receipt/review/finish, hydration and nutrition history import.
- **Recovery/health:** Recovery, daily overview, recovery detail, breathwork, hydration and health-condition context.
- **Community/RaceHub:** community feed, activity, comments, notifications, public profiles, reports, profile and race surfaces.
- **Profile/settings:** preferences, capabilities, connections, health conditions, gear, races, sport goals, progress, analytics layouts, privacy, notifications, referrals, support, data storage, kitchen/local discovery, tutorials and Coach learning.

The exact route manifest at baseline is the `Native/src/app/` tree. V2 must build a route/workspace coverage matrix before declaring migration completeness. A route list is an inventory aid, not proof every screen or control is complete.

### Current technical system

- **Mobile:** Expo / React Native / TypeScript, Expo Router. Existing package scripts include TypeScript, Native build/SDK, workout, recipe, auth, Coach, navigation, recovery, community, and domain-specific regression gates.
- **Backend/data:** V1 has a large accumulated Supabase/PostgreSQL schema and migration history. V2 Supabase is intentionally empty and becomes the new canonical backend. Build a clean V2 schema, RLS, authenticated RPCs and Edge Functions from reviewed domain requirements; do not wholesale replay the V1 migration chain.
- **Coach:** V1 behavior is the source for the V2 Coach port. At transfer inventory, V1 Supabase reports `allin-coach` ACTIVE v18 with JWT verification enabled and source SHA-256 `da56531e252d924a0915b1168f923f51985a004fd6d4c91bb1a8e341f90fefe3`. The staged V13 repository candidate is not the live v18 source. Port the exact v18 source plus required modules, adapt it to V2 schema/RPCs/secrets, and preserve its safety, provider, privacy, rate/cost and action contracts. V2 creates new Coach threads; no meaningful V1 Coach history is required.
- **Canonical domain ownership:** Training, Food Log, recipe versions, Pantry, Shopping, Meal Prep, Community, Profile and Recovery already have domain-specific readers/writers and database guards. Reuse those owners; do not bypass them with direct table writes.
- **Device/integrations:** Apple Watch, HealthKit, Bluetooth HR and FTMS equipment have source-level foundations with remaining physical/device acceptance. Garmin/Coros are post-beta integrations. Machine control remains disabled per command until physical evidence authorizes it.
- **Tests:** Current Native verification is broad and includes focused mounted/client/source/database contracts. Treat a test as evidence only for its actual source SHA, environment and boundaries. Mocked client tests are not live account, installed device, provider, or database acceptance.

## 3. Product workspace map and retained behavior

V2 should present a coherent system, not a collection of unrelated feature rewrites.

| Workspace | V2 scope | Existing behavior/contracts to retain |
|---|---|---|
| Today | Daily overview, plan/activity/food/recovery context, customizable optional widgets | Date-correct state; one canonical view of the day; actions route to owning workspace |
| Train | Calendar, Plans, Progress, sport-specific launch, Active Training and Completed Activity | Planned reference validation; one session/workout identity; explicit Start/Pause/Resume/Finish/Cancel; no duplicate activity |
| Coach | One persistent conversation with typed screen/object context and explicit proposed actions | Thread continuity; settled facts distinct from saved app data; no fake writes; approval before canonical mutation |
| Fuel / Nutrition | Food Log, Nutrition goals/history, hydration and contextual fueling | Canonical food records; user corrections; no duplicate logging; pantry-only meal suggestions unless user asks otherwise |
| Recipes | All / Favorites / Mine; discovery, recipe cards, import, Cook Now and Coach Analysis | Catalog immutability; working-copy edits; explicit Use once vs Save My Version; validated nutrition/yield; no implicit Meal Prep mutation |
| Pantry / Shopping / Meal Prep | Inventory, purchase projection, prep, cooking review, Prepared Meals | One canonical inventory and shopping system; raw/cooked/prepared state; occurrence ownership; explicit completion; no duplicate stock or food logs |
| Recovery | Readiness, recovery activities, plans, daily detail | Explicitly sourced values; avoid inventing medical or readiness facts; use canonical recovery writers |
| Community / Discover / RaceHub | Activity posts, follows, profiles, races, discovery and social interactions | Privacy defaults; explicit sharing; canonical activity linkage; avoid duplicate posts |
| Profile / Settings | Identity, goals, preferences, connections, health conditions, gear, privacy, referrals, data controls | One canonical profile/settings owner; preserve privacy, account isolation, unit preference and consent |
| Integrations | Apple Watch, HealthKit, sensors, equipment, future Garmin/Coros | Integrations enrich canonical events; devices never create a second workout identity; machine control stays independently gated |

Product decisions, design language, business constraints and detailed behavior remain sourced from existing project decisions, Linear acceptance contracts and current canonical code. This blueprint does not supersede those authorities.

## 4. Architecture diagnosis — what is actually wrong

The working product is broad and valuable, but the accumulated implementation has high coordination cost: many interdependent route files, domain clients, recovery adapters, server RPCs, feature-specific test runners, staged candidate files and historical checkpoints. Repeated corrective rewrites make it difficult to know which copy owns behavior and which tests prove it.

Do not assume that every current implementation is bad or that the database must be rebuilt. The first job of V2 is to reduce coupling and make ownership obvious.

### Retain and reuse

1. Proven V1 domain behavior and contracts as reference; V2 owns a fresh Supabase Auth project and new account/session model.
2. Proven V1 domain models and data ownership rules for recipes, Coach, workouts, plans, Food Log, Pantry, Meal Prep, Shopping, Profile and Recovery; selectively seed only approved product-owned catalog/reference data.
3. Proven authenticated RPCs, RLS policies, idempotency/version guards and private function boundaries.
4. The live Coach service and its prompt/safety/runtime boundary until a separately validated backend migration is justified.
5. Proven domain algorithms and contracts from the current app: recipe nutrition/yield, Training identity/recovery, canonical Food writers, privacy, and integrations.
6. Product decisions, screen/interaction specifications, migration records, test evidence and recovery manifests.
7. Current Native application as the reference/fallback during V2 acceptance.

### Rebuild deliberately

1. App shell, routing, dependency boundaries and feature-module composition.
2. Presentation-to-domain separation so screens do not own business rules or backend mutation logic.
3. Consistent auth/session hydration, loading/error/retry handling and account-change invalidation.
4. Typed service contracts and explicit domain ports/adapters.
5. A predictable Coach presentation and typed proposal/approval lifecycle.
6. Feature-level test fixtures and a small set of canonical end-to-end acceptance journeys.
7. Developer workflow: one authoritative implementation file per concern, clear test ownership, and no candidate/recovery copy silently treated as production source.

### Replace only with evidence

Port approved V1 behavior and product-owned assets into the clean V2 architecture. The V2 schema is intentionally new; design its canonical domain owners from the reviewed product contracts rather than replaying historical migrations. Personal V1 records and the single founder/test Coach thread are not imported by default. Every product-owned catalog import must be reproducible, versioned and integrity-checked.

## 5. Target V2 architecture

Use a small modular application with explicit boundaries. Start with only the modules required by the first vertical slice; do not scaffold every workspace before the first proof.

### Proposed repository shape

```text
/apps/
  mobile-v2/                 # New Expo app shell and navigation
/packages/
  app-core/                  # startup, config, lifecycle, typed results
  auth/                      # Supabase auth/session adapter and guards
  design-system/              # tokens, primitives, shared interaction states
  domain-contracts/            # stable DTOs and IDs shared by features
  feature-coach/               # Coach thread UI, context and proposal flow
  feature-recipes/             # recipe read/review UI; canonical save adapter
  platform/                    # storage, network, logging, device adapters
  supabase-adapter/            # only approved backend/Edge/RPC adapters
/docs/
  rebuild/
```

This is the target boundary, not an instruction to create every package at once. Keep V2 initially isolated from the existing `Native/` app's dependency tree and release pipeline. Choose the workspace/package manager only after checking current repo tooling and lockfile constraints; do not silently migrate the existing Native package manager.

### Dependency direction

```text
screens / navigation
        ↓
feature use-cases (Coach, Recipes)
        ↓
domain contracts + ports
        ↓
adapters (auth, Coach API, canonical recipe writer)
        ↓
new V2 Supabase / ported V1 Coach behavior / V2 canonical data
```

- Screens render state and dispatch typed intents; they do not contain SQL/RPC details.
- Use-cases own orchestration, validation sequencing and explicit approval requirements.
- Domain contracts own IDs, request/result types and invariants, not duplicated persistence.
- Adapters own transport, auth propagation, response validation and error normalization.
- Supabase remains the authority for identity, authorization, canonical state, idempotency and durable history.
- No import cycles. Feature modules must not reach into another feature's private implementation; share a public contract or call the owning use-case.
- No "god" global store. Use scoped state for session, Coach thread and feature workflows; durable truth remains with the owning backend/domain.

### Core runtime rules

- One authenticated account context per app session. All pending async work is owner/generation-bound and stale responses are ignored.
- Explicit signed-out, loading, ready, retryable-error and terminal-error states. No false success on uncertain network outcomes.
- Stable request/action IDs for mutations. A replay must return the original/newest canonical outcome, never create a duplicate.
- Read-your-write confirmation: after a canonical mutation, read back by returned canonical ID/version before showing saved/history success.
- No background automatic re-send of an uncertain Coach approval unless the existing canonical idempotency contract expressly supports that exact replay.
- Logging contains correlation IDs and safe diagnostics, never auth tokens, private health content, or sensitive user payloads.

## 6. Domain ownership and backend map

| Concern | Authoritative owner | V2 rule |
|---|---|---|
| Identity / session | New V2 Supabase Auth | Create a fresh founder account; no V1 password migration or customer-base import |
| Profile / preferences | Existing profile RPCs and policies | Read and patch through existing owner/version contracts |
| Coach messages / thread | Existing persistent Coach APIs/service | Preserve thread ID and message/history semantics; no second chat store |
| Coach proposed action | Existing typed proposal/action contract | Proposal is not a write; validate action kind/object/version and require explicit user approval |
| Recipe catalog | Existing canonical catalog/read API | Catalog is read-only from user's perspective |
| Saved recipe version | Existing `allin_save_recipe_my_version` (or exact current canonical owner verified in source) | Reuse owner-scoped, versioned, idempotent save path; do not create a Coach recipe table |
| Food Log / Pantry / Meal Prep / Shopping | Existing domain RPCs and versioned writers | Use the owning domain writer only; no generic direct table mutations |
| Training | Existing canonical Training RPC/session model | One workout/session identity across phone, Watch and Health |
| Community | Existing privacy-aware writers | Explicit sharing; no auto-publish |
| Recovery / health | Existing scoped records and consent boundaries | No invented facts or cross-account reads |
| Apple / equipment | Existing adapters and canonical event linkage | Device observations do not become a second canonical event |

V1 backend inventory is a reference only. V2 must create its own schema, RLS, RPCs, secrets and Edge Functions. Do not wholesale replay the V1 migration chain. At transfer inventory V1 has `allin-coach` ACTIVE v18 with JWT verification and deployed SHA-256 `da56531e252d924a0915b1168f923f51985a004fd6d4c91bb1a8e341f90fefe3`; the staged V13 repository candidate is not the live v18 source. Port the exact v18 source and adapt its dependencies to V2 before deployment.

## 7. Migration boundaries and rollout

1. **Parallel foundation:** build V2 app, V2 Auth and V2 backend independently; V1 remains read-only reference.
2. **Source transfer:** capture exact live Coach v18 and validated V1 domain contracts; seed only product-owned cookbook/reference data.
3. **One explicit mutation:** add one reviewed Coach recipe proposal and route its approved action to the V2 canonical writer.
4. **Acceptance before expansion:** prove fresh founder sign-up/session restore, Coach request safety, catalog correctness, idempotent save, persistent V2 history and account isolation.
5. **Workspace-by-workspace migration:** move one feature journey at a time. Keep the old journey available until the V2 replacement passes its own contract and device acceptance.
6. **No dual-write migration:** never write the same business event to both old and V2 stores. Both apps call the same canonical owner.
7. **No data migration in the first slice:** preserve existing rows as-is; no backfill, destructive cleanup or migration replay.
8. **Controlled cutover:** only after the new journey has traceable acceptance should its entry point be enabled for beta users. Do not remove old code until no active route, deep link, background task, device bridge or history reader depends on it.

## 8. First vertical slice — prove V2 can work

**Milestone:** the founder creates a fresh V2 account, signs in, starts a new V2 Coach conversation using ported V1 Coach behavior, asks for a recipe, receives a structured proposal, explicitly approves it, saves through the V2 canonical writer exactly once, and sees the saved recipe in durable V2 history.

### Slice A — V2 boot and existing-user auth

- New V2 app launches without depending on legacy Native route components.
- Founder creates a fresh account in the dedicated V2 Supabase project after the V2 legal/signup and schema gates are implemented.
- Session restore, expired session, sign-out and account switch are deterministic.
- No new signup, legal onboarding, profile schema or auth provider is introduced in this slice unless required by the existing gate.

**Pass evidence:** fresh V2 founder account; cold launch/session restore; sign-out/sign-in; no cross-account cache/thread leakage.

### Slice B — persistent Coach continuity

- V2 starts a new persistent Coach thread for the authenticated owner.
- Sending a message uses the ported V1 v18 Coach behavior through one V2 Edge Function adapter.
- New thread identity is preserved across navigation, app restart and token refresh.
- Thread-scoped settled facts remain separate from durable profile memory and canonical app records.

**Pass evidence:** message appears once, is returned by canonical history read, and remains after process restart. Account change suppresses the prior owner's pending response.

### Slice C — typed recipe proposal and explicit approval

- Coach proposes a structured recipe action referencing a valid recipe/base identity and proposal payload.
- Proposal screen displays exactly what will happen: **Use once** or **Save My Version** (and update existing version only where applicable).
- Opening/reviewing/dismissing a proposal makes no canonical write.
- Stale, malformed, unsupported or wrong-owner proposals fail closed.

**Pass evidence:** no row/write before approval; explicit approval is required; UI reflects the exact reviewed proposal and destination.

### Slice D — exactly-once canonical save

- Approval is bound to exact owner, action ID, proposal fingerprint, recipe/base revision and selected operation.
- Use the existing canonical recipe version writer and its idempotency/version semantics. Do not invent a parallel writer.
- Retry only the exact same action and payload under the supported idempotency contract.
- Validate the server receipt and returned canonical ID/version; uncertain outcomes stay visibly unconfirmed until read-back reconciliation.

**Pass evidence:** one canonical saved version after first approval; repeated delivery/retry does not create another; stale revision is refused without altering the newer record.

### Slice E — history and restart

- Re-read the saved recipe through the canonical history/library reader.
- Show the saved result in the correct existing area (My Cookbook / relevant history) with correct owner and identity.
- Cold restart and re-authentication display the same canonical item; no client-only fake history.
- Cancel/decline leaves no saved item.

**Pass evidence:** backend read-back equals the approved payload; history persists across restart; account B cannot see account A's private saved item.

### First-slice test pyramid

- Pure contract tests: DTO validation, approval state machine, ownership, action fingerprint and stale revision.
- Adapter tests: auth propagation, endpoint mapping, receipt parsing, idempotent replay and error normalization.
- Mounted UI tests: loading, proposal preview, approve/cancel, double-tap, uncertain network outcome and account switch.
- Backend integration: real authenticated test accounts against an isolated/authorized target; verify canonical writer, RLS and history read-back.
- Device acceptance: install, cold start, session restore, app termination during request and restart. A mocked simulator is not equivalent to signed device acceptance.

## 9. Build sequence after the blueprint

1. Verify V2 Expo tooling and package compatibility; create the isolated V2 app shell.
2. Design the V2 auth/profile/legal schema and signup gate.
3. Port exact V1 Coach v18 behavior and its dependencies to the V2 backend.
4. Import and validate product-owned Cookbook catalog/reference data.
5. Complete fresh founder signup/session restoration.
4. Add one persistent Coach thread adapter and conversation screen.
5. Add typed recipe proposal/review/approval.
6. Wire the existing exactly-once canonical writer and history reader.
7. Run focused tests after each slice, then the end-to-end acceptance journey.
8. Only then decide the next vertical slice. Do not build all screens or migrate all backend domains before the first journey works.

## 10. Explicit non-goals and safety rails

- No reset, force-push, history rewrite, or deletion of recovery copies.
- No edits to `main`; no merge, ready-for-review conversion or release flag change.
- No PR #2 merge; PR #2 remains open/draft/unmerged.
- No production migration, live-user fixture, provider change, Edge Function deployment, billing change or paid CI run as part of baseline creation.
- No customer-base migration, V1 password credential import, V1 Coach-thread history import, or automatic founder personal workout/Food Log migration.
- V2 creates new canonical account, Coach, recipe-user-version, workout, Food Log and Pantry records in the V2 backend.
- No generic write API that bypasses domain ownership.
- No indiscriminate rewrite of the 958-migration history.
- No claimed device/provider acceptance from source tests.
- No deletion of the existing Native app or fallback before V2 proves parity for the specific journey.

## 11. Baseline gaps to close before the first code slice

- Refresh exact integration branch HEAD and exact file bytes immediately before creating V2 files; preserve concurrent commits.
- Inventory V1-to-V2 asset sources (live Coach v18, Cookbook product catalog, legal package, business/brand authority, website and Figma design files).
- Capture the exact V1 Coach v18 deployed bundle and map its dependencies; do not use staged V13 as a substitute.
- Inspect V1 catalog relationships and seed a reproducible product-owned data import; exclude founder-only records unless separately approved.
- Identify the approved isolated authenticated integration-test environment. Do not create a paid Supabase branch or write production fixtures just to make tests convenient.
- Record ownership and exact acceptance evidence in Linear before implementation; each new work item must be a small independently verifiable slice.

**Definition of success:** V2 is not a prettier blank shell. It must complete the fresh-founder-account → new persistent Coach thread → recipe proposal → explicit approval → exactly-once V2 recipe save → durable V2 history journey. V1 supplies validated behavior and product-owned catalog assets, not a customer base to migrate.


## V2 infrastructure decision — 2026-11-10

- Canonical V2 source repository: https://github.com/allinproject/All-In-V2
- V2 Linear project: https://linear.app/allin365/project/all-in-365-v2-rebuild-1a9ab6dddfca
- Dedicated V2 Supabase project: `xarhuczrtzuiljmtdaeu` (All-In-V2, us-west-2).
- Initial V2 Supabase inspection: ACTIVE_HEALTHY and empty, with zero tables returned in `public` and `allin_private`, zero migrations, and zero Edge Functions.
- **Important unresolved architecture decision:** the empty V2 Supabase project does not currently contain V1 users or canonical history. A V2 app pointed at it cannot transparently authenticate existing V1 users or read their current records. Do not configure production sign-in to V2 or claim account continuity until the founder approves the identity/data strategy. Options include keeping V1 Supabase as the production auth/data authority while V2 UI is built, or planning a separately validated user/data migration and cutover to V2. A split Auth/data setup is also possible but must be explicitly designed and tested.
- The V2 Supabase project is isolated development infrastructure until that decision is resolved. Do not copy production rows, Auth users, secrets or migrations into it automatically.
- The first scaffold was staged in V1's integration branch for continuity, then copied into this dedicated V2 repository. All further V2 source changes belong here.


## Founder decision and V1 asset transfer — 2026-11-10

V2 Supabase is the new canonical backend, not a staging mirror that must preserve a V1 customer base. The founder is the only V1 user. Create a fresh founder account in V2. V1 Supabase is retained as a read-only source for selected product assets and validated behavior.

V1 database inventory at initial review: one profile; `allin_recipes` 1,019 rows; `allin_recipe_selectors` 1,293; selector options 5,876; ingredient profiles 408; recipe component mappings 2,855. V1 Coach has one owner and one thread with 16 message rows (8 user / 8 assistant); founder confirms no meaningful Coach conversation needs migration, so exclude that test thread. One training row and one food-entry row exist; do not import personal founder history by default.

V1 live `allin-coach` is ACTIVE v18, `verify_jwt=true`, deployed bundle SHA-256 `da56531e252d924a0915b1168f923f51985a004fd6d4c91bb1a8e341f90fefe3`. The staged v13 repository code is not the deployed v18 source. Port exact v18 behavior and dependencies, adapting schema and RPC calls to V2 before deployment.

Legal package is a working draft; do not treat it as final approval. V1-to-V2 transfer categories and acceptance checks live in [V1-to-V2 Asset Transfer Inventory](../migration/V1-TO-V2-ASSET-TRANSFER-INVENTORY.md). Website owner and canonical Figma file(s) remain to be identified. Do not assume Wix owns the website or guess Figma file IDs.
