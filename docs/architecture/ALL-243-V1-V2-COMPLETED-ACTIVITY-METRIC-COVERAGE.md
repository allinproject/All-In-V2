# ALL-243 — V1 to V2 Completed Activity metric coverage gate

**Status:** Audited V1 native scalar display baseline imported; exhaustive registry/source adapter validation remains **open**. This is not a V2 ingestion/deployment certification.
**Checked:** 2026-11-11.
**V1 sources:** `allinproject/ALL-IN` `integration/native-watch-v301`:
- `Native/src/data/completedActivityPresentation.ts` — 17 actual sport-specific Overview/Details scalar card arrays
- `Native/src/data/workoutDetailClient.ts` — V1 source-to-display scalar mapping
- `Native/src/data/completedActivityStructuredData.ts` — route/splits/laps/segments parsing
- `Native/src/app/training/workout/[id].tsx` — actual Overview, Details and Coach tabs
- `docs/decisions/2026-10-29-sport-specific-completed-activity-screens.md` — locked full requirements including more than scalar cards
- `docs/decisions/2026-10-29-customizable-analytics-layouts.md` — sport/tab-specific reorder/pin/hide/reset

## Concrete imported baseline

`apps/mobile-v2/src/features/training/v1CompletedActivityBaseline.ts` is a direct transcription of the **17 V1 presentation configurations**, preserving all Overview and Details label arrays. `v1AllDetailsMetrics(sport)` unions Overview and Details so an Overview metric is never absent from Details just because V1 hid duplicated cards across tabs. The accompanying automated test checks all 17 sport baselines and special expectations.

**Important:** V1 scalar display labels are *not* a complete metric registry. The following structured and specialized categories are still required even where absent from the native scalar lists:

| Sport family | Required structured or detailed coverage (source-backed only) |
| --- | --- |
| Outdoor run, walk | route/map with privacy, pace/speed trend, mile/km splits, heart-rate trend/zones and Zone 2, cadence/steps, running dynamics where measured |
| Hike, ruck | route, ascent/descent, elevation profile, source-backed intervals; explicit pack-weight provenance for ruck |
| Outdoor ride | route/segments, speed/power/HR/cadence trends and zones, normalized/weighted power only if defensibly sourced and defined, power-target interval execution |
| Indoor trainer | interval-by-interval target/actual, time-in-range, power/cadence/HR traces, trainer source/verification state, ERG/resistance history only if captured |
| Treadmill | calibrated-versus-device distance separation, pace/speed and incline time series, intervals, HR zones, machine/source provenance |
| Strength | every recorded exercise and set, reps, load and unit, bodyweight/unknown distinction, RIR/RPE, rest duration, order, notes, substitutions, defensible volume/records |
| Pool swim | source-backed pool length, lengths, sets/laps, rest and pace/100, strokes, SWOLF (when measured), available HR |
| Open-water swim | real GPS route and quality, split pace, HR, stroke data where present; no synthetic pool-length stats |
| Elliptical | machine-reported resistance/ramp, cadence/stride rate, heart-rate zones, source-native distance and watts only where supported |
| Stair stepper | steps/floors, step-rate and level/resistance traces and HR; no invented distance or elevation |
| HIIT, Yoga/Mobility | authored blocks/pose timing, effort and optional recorded HR; no invented competition or distance metrics |
| Hybrid/multisport | every separately typed sport leg and transition, per-leg metrics, total vs moving time and provider/device handoff provenance |
| Other | all supported source-backed generic facts, never mislabel as a specific sport |

## Required acceptance matrix columns for each metric

Before ALL-243 can be marked integrated/validated, every metric in **the full V1 registry and Detail Gap Audit**, locked decisions, and canonical provider acquisition must have:
1. Semantic metric key, sport/subtype and scalar/series/segment/route/strength-set classification
2. Physical/source unit, canonical unit, display-unit conversion and invalid/unknown/explicit-zero policy
3. Allowed providers, capabilities, provenance and source identity; capture/derived/estimated type and quality
4. Read/ingest mapping, canonical database owner and least-privilege reader
5. Overview priority, **Details section**, availability/hidden behavior, customization availability and any non-hideable integrity data
6. Fixtures proving true measured, absent/unknown, conflicting, manual, imported, duplicate and corrected readings
7. Verified Coach context and optional comparable history where appropriate

## Source-backed Details read-model slice — 2026-11-11

`apps/mobile-v2/src/features/training/completedActivityDetailProjection.ts` adds a **read-only, backend-agnostic Details presentation projection**. It accepts only metrics already supplied by the future canonical owner with semantic keys, display labels/values and nonempty source/provenance metadata. It does **not** acquire or certify those measurements independently, does **not** calculate missing values or touch the database, and rejects conflicting duplicate metric keys until upstream source reconciliation is resolved.

It orders the actual supplied scalar labels using the imported V1 17-sport baseline while **retaining all additional source-backed metric keys** in Details rather than silently dropping them. All legitimately available recorded metrics remain in the projection even if a user chooses to hide an optional metric in the personalized display. Required safety/source rows cannot be hidden by that layout. A separate bounded `sections` list carries only present, source-attested structured detail **descriptors** (splits, routes, time series, Strength sets, swim sets, multisport legs); actual route/sensor/health payload access remains the responsibility of the privacy-safe canonical reader.

`completedActivityDetailProjection.test.ts` tests preservation of extra Zone 2 metrics, missing-data absence, pin/hide without source mutation, structured data presence, conflicts and sport requirements. **This is neither completed schema nor a live workout screen.** Full per-metric capability/provenance checks and every structured series reader remain explicit ALL-243 acceptance gaps.

## Screen composition slice — 2026-11-11

Added the **reusable** `completedActivityScreenModel.ts` and `CompletedActivityScreenContent.tsx` to the canonical V2 Training feature, using only the supplied canonical-owner evidence. The screen restores V1's **Overview / Details / Coach** tab names, sport-appropriate top metrics, complete source-backed Details, optional Coach interpretation without fake summaries, optional metadata editing (including post-workout gear and road/trail), and optional Customize panel for both data tabs. `completedActivityScreenModel.test.ts` covers no invented measurements, sport isolation, all available metric retention, Coach optionality, and non-hideable provenance. GitHub node smoke run `43026158061` passed.

**Integration boundary:** This component is deliberately **not routed** in the live app. V2 currently lacks an approved deployed ALL-243 canonical completed-activity reader/DB. The eventual parent must read an actual authorized activity, verify session ownership, bind a valid source/metric evidence projection, pass `onSaveLayout` through existing `saveOwnedCompletedActivityLayouts` (versioned owner-guarded and idempotent), and pass an exact-activity-context `onOpenCoach` plus guarded post-completion metadata editor. The screen's structured section descriptors are **not actual time series/map graphs**; real privacy-safe readers and chart rendering remain required. No sample numerical statistics should be inserted as real athlete data.

**Verification limits:** Node-only smoke passed; no full Expo/TypeScript/device acceptance has been evidenced for this component, and no backend/schema work occurred.

## Fail-closed canonical activity read boundary — 2026-11-11

Added `apps/mobile-v2/src/features/training/completedActivityOwnerRead.ts` and its Node contract tests. This consumes **only** a canonical reader's returned owner-scoped activity, metric definitions/versions, sources and structured-section descriptors. It makes **no network calls or storage writes** by itself; there is not yet a live Completed Activity query endpoint or deployed schema. The eventual ALL-243 backend reader must enforce authenticated RLS, expected owner, per-metric registry/source eligibility, numeric/unit conversion, provider deduplication and private series access. Client checks are defense in depth, **not backend authorization**.

The adapter verifies expected owner and activity identity, screens the caller's active account before and after an asynchronous fetch, checks metric definition versions/sport applicability/allowed measurement kind/source link, keeps source-reported zero distinct from missing values, excludes unresolved unverified readings, and refuses duplicate metric codes that require upstream source reconciliation. It converts only **already formatted, source-attested** metric values to the existing three-tab presentation input; it cannot fabricate sensor readings or Coach analysis.

Tests cover valid owner-bound reads, account switching during a request, foreign/wrong activity identities, cancelled views, invalid/missing definitions/sources, duplicate/conflicting metrics, low-quality or rejected inputs, and present-but-zero vs absent. GitHub Actions smoke run `43026872609` passed. **No actual backend RPC, deployed tables, signed-in mobile read or device verification was completed** by this slice.

## Canonical sport/subtype compatibility gate — 2026-11-11

The canonical ALL-243 proposal uses sport identities such as `running`, `cycling`, `swimming`, `rucking`, `stair`. The imported V1 presentation baseline uses display categories such as `outdoor_run`, `outdoor_ride`, `pool_swim`, `open_water_swim`, `stairs`. Without an explicit adapter, the owner-read boundary would reject valid canonical activities.

`completedActivitySportAdapter.ts` now supplies a **reviewable, tested mapping** from canonical sport + explicit subtype to the correct V1 display policy; `completedActivityOwnerRead.ts` uses that mapping while validating metric definition applicability to the actual canonical sport. Road/trail remains **editable post-workout metadata**, not a pre-workout prompt or a different workout identity. Trail runs use the outdoor run statistic policy with recorded terrain preserved for the screen; indoor trainer/treadmill and pool/open water use separate appropriate policies. Unknown or incompatible subtypes are refused instead of silently reclassified.

**Rowing remains a coverage gap:** the canonical V2 sport list includes rowing but V1's 17 display categories do not have a rowing-specific policy. The mapping explicitly falls back to `other` without claiming rowing-specific stats are implemented; resolve this with a sport-appropriate metric registry and approved presentation. For outdoor/indoor rowing, capture actual stroke rate, distance/split, watts and machine telemetry only where sourced.

Tested the mapping and amended owner-read/screen-model assertions (including retained Road/Trail) in GitHub smoke `43027684119` (success). **This is not a deployed schema, workout query or permission to invent a rowing screen.**

## Recovered original V1 registry and gap audit — authoritative source audit (2026-11-11)

**Previously missing source files recovered from the founder's personal Library, not the V1 Git tree:**
**Exact archived original text is now in V2 Git, with source-to-repository byte-for-byte readback verified** (reference only; current V2 decisions take precedence on labels/ownership/deployment):
- [V1 original metric registry](../architecture/v1-sources/ALL-IN-365-Completed-Workout-Metric-Registry-v1.md)
- [V1 original detail gap audit](../architecture/v1-sources/ALL-IN-365-Completed-Workout-Detail-Gap-Audit-v1.md)


- `ALL-IN-365-Completed-Workout-Metric-Registry-v1.md` (2026-10-28, 27 sections)
- `ALL-IN-365-Completed-Workout-Detail-Gap-Audit-v1.md` (2026-10-28, implementation handoff)

Both are design/implementation targets, **not** proof that any source adapter, charts, metrics or final UI was shipped in V1. The V1 handoff's tab names `Advanced Stats / Analysis` are superseded by the founder's later locked V2 **Details / Coach** labels; the detailed measurement requirements are **not** superseded.

### Exact additional V1 coverage to preserve

| Registry source family | Explicit metric/source contract beyond the basic scalar baseline | Current V2 coverage boundary |
| --- | --- | --- |
| Running/trail dynamics | GCT balance, vertical ratio, step-speed loss where device reports it, grade-adjusted pace with a reviewed authority/version, HR recovery from a valid capture, pace/power-zone definition snapshots | Typed metric registry proposed; actual provider capability and series mapping pending |
| Cycling and indoor power | Left/right pedal balance, seated/standing, power phase, platform center offset, torque effectiveness, pedal smoothness/force, FTP snapshot, work (kJ), verified normalized/weighted power calculations | Native provider-specific telemetry and comparison/derived-authority contracts pending |
| Pool swim | Actual pool length/unit, stroke context for SWOLF, swim/rest durations, sets, drills/manual lengths; do not compare different pool lengths/stroke types blindly | Typed segments proposed; measured source/quality and lap/set reader pending |
| Outdoor/open-water swim | GPS route and quality, source-backed pace trend, strokes, water temperature where captured; no synthetic pool lengths | Evidence object/route candidate; actual private route service/quality pending |
| Rowing (indoor/on-water) | Pace per 500m, stroke rate avg/max, supported distance per stroke/power, splits, drag factor from machine only, explicit indoor vs water context | **First-class canonical `rowing` exists but presentation currently falls back to `other`; needs approved rowing display and definition fixtures** |
| Strength and functional/HIIT | Set type, ordered movements, rest/tempo, grouping, exercise-specific PR and estimated 1RM with method/version, score *type* (time/rounds/reps/load) | Typed sets proposed; verified PR calculation/comparable history and chart detail pending |
| Winter sports | Alpine ski/snowboard runs, vertical/descent, speed, GPS; XC ski distance/HR/elevation/cadence/legitimate power | **V1 approved requirement absent from 15-code canonical sport CHECK; requires sport-owner decision, not accidental `other` relabeling** |
| Team/court/racket sports | Soccer/basketball/hockey/tennis/etc. duration/effort, sourced HR and justified active movement/period/set score, avoid false precision from poor indoor GPS | **No explicit canonical taxonomy; decide stable sport identities/subtypes and source/comparison eligibility before building a dedicated detail** |
| Universal source and charts | Measured/provider-derived/ALL IN-derived/user-reported/estimated distinctions; source and sensor quality; original units; calculation version; synchronized series and segment axes with real gaps | SQL candidates and read-only DTO are partial, **not an exhaustive metric dictionary or live chart/route ingestion** |

### Granular completion gates from the recovered V1 Detail Gap Audit

- [ ] Source-authoritative normalized metric dictionary and unit/calculation versions; no absent-to-zero fallback.
- [ ] Apple Health/HealthKit supported acquisition map with exact value/source-quality eligibility; Garmin/COROS advanced vendor attributes may follow beta.
- [ ] Bounded, privacy-safe series/route readers, legitimate gaps, downsampling and timestamp/distance-axis selection; real charts only.
- [ ] Typed semantic auto splits, manual laps, work/rest intervals, pool lengths/sets, route segments, checkpoints and transitions.
- [ ] Source/quality-aware planned-versus-actual, PRs/records, strength set details, multisport leg readers and Coach exact-activity evidence.
- [ ] Real installed Overview/Details/Coach plus accessibility, compact/large phone, high text scale, dark/light, and actual user-source evidence acceptance.

**Do not declare 17 scalar display baselines equivalent to complete V1 registry coverage.** The existing V2 physical owner can extend its single versioned dictionary and the same canonical activity with typed segments and private source objects. Do not create a second activity store, duplicate registry, third-party provider truth, or infer metrics from a sport label.

### 2026-11-11 owner-reader and presentation regression additions

- Exact canonical 15-sport activity and metric scope codes now match the proposed SQL registry. No global `all`, display-only `outdoor_run`, or inherited/prototype object property may masquerade as a canonical sport.
- Source-backed evidence now retains both per-metric and parent-source quality (`trusted` versus `partial`) from the owner read through Overview/Details. Unknown or unverified facts remain absent; the final visible UI label for partial quality still needs device acceptance.
- Canonical unit is nonempty and bounded by the proposed SQL definition contract; absent/blank/oversized unit fixtures fail closed. Registry definitions require explicit sport applicability.
- All **15 canonical sport identities** have source-backed duration owner-reader-to-screen fixtures; all **17 V1 presentation sport families** have an extended/recovered-registry Details retention fixture (synthetic pre-authorized metric evidence, **not** provider-ingestion proof).
- These checks extend the existing `completedActivityOwnerRead.test.ts`, `completedActivitySportAdapter.test.ts`, `completedActivityScreenModel.test.ts`, and `completedActivityDetailProjection.test.ts`; no additional test system, activity store, or metric registry was created.

**CI limit:** These newest changes are committed but there is no independently inspected complete green Node/TypeScript run for their exact integration SHA. The earlier clean 18-migration / 30-candidate Supabase replay remains validated at [43138298262](https://github.com/allinproject/All-In-V2/actions/runs/43138298262); that older replay is not evidence of these newer mobile tests.

## Current evidence / outstanding gaps

- [x] Exact 17-sport **V1 native scalar** Overview/Details baseline is in V2 and unit-test guarded.
- [x] Reviewed V1 locked structured-stat and customization decisions; preserved in this coverage gate and existing founder-approved V2 spec.
- [x] Reusable sport/tab layout logic and settings persistence committed to V2, with passing smoke tests in earlier slices.
- [x] **Recovered and read** the named original V1 Metric Registry and Detail Gap Audit in the founder's Library (2026-10-28); preserved their measurement/sport coverage and remaining acceptance gates above. Files were not part of inspected V1 Git tree, so do not invent Git paths or confuse recovery with implementation.
- [ ] Obtain ALL-222/ALL-243 approval for the V2 physical canonical activity/metric/storage/source model; existing V2 ERD is a **proposal**, not live database.
- [ ] Implement complete ingest and source-backed scalar/time-series/structured metric preservation, mapping each registry key into native Details.
- [ ] Implement actual V2 **Overview / Details / Coach** screen and connect authenticated layout editor/save (not yet live).
- [ ] Prove coverage using manual, import, Watch/HealthKit, strength, multisport, nullable and two-account test fixtures, plus physical device UI.
- [ ] Ensure Coach analysis uses only canonical facts/plan revision and preview-to-apply safeguards for plan changes.

**UX contract:** Overview gives sport-specific highlights, Details shows **every available supported statistic** (organized, collapsible, customizable), Coach interprets exact activity evidence. Missing data never becomes a manufactured zero or made-up chart. No pre-run gear prompts.
