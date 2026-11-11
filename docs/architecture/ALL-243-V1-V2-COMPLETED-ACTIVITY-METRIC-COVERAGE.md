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

## Current evidence / outstanding gaps

- [x] Exact 17-sport **V1 native scalar** Overview/Details baseline is in V2 and unit-test guarded.
- [x] Reviewed V1 locked structured-stat and customization decisions; preserved in this coverage gate and existing founder-approved V2 spec.
- [x] Reusable sport/tab layout logic and settings persistence committed to V2, with passing smoke tests in earlier slices.
- [ ] Locate/import the separately referenced **ALL-IN-365-Completed-Workout-Metric-Registry-v1.md** and Completed Workout Detail Gap Audit (not found as paths in the authoritative V1 integration Git tree on this check). Search other sanctioned V1 project files/Linear attachments; do not assert their content from their titles.
- [ ] Obtain ALL-222/ALL-243 approval for the V2 physical canonical activity/metric/storage/source model; existing V2 ERD is a **proposal**, not live database.
- [ ] Implement complete ingest and source-backed scalar/time-series/structured metric preservation, mapping each registry key into native Details.
- [ ] Implement actual V2 **Overview / Details / Coach** screen and connect authenticated layout editor/save (not yet live).
- [ ] Prove coverage using manual, import, Watch/HealthKit, strength, multisport, nullable and two-account test fixtures, plus physical device UI.
- [ ] Ensure Coach analysis uses only canonical facts/plan revision and preview-to-apply safeguards for plan changes.

**UX contract:** Overview gives sport-specific highlights, Details shows **every available supported statistic** (organized, collapsible, customizable), Coach interprets exact activity evidence. Missing data never becomes a manufactured zero or made-up chart. No pre-run gear prompts.
