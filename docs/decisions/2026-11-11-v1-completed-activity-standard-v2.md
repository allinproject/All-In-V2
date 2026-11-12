# ALL IN 365 V2 — Completed Activity must preserve the V1 standard

**Status:** Founder-approved UX requirement (2026-11-11); implementation still depends on ALL-243 canonical Completed Activity owner.
**Do not infer that V2 storage, metrics or Coach analysis are deployed from this document.**

## Source authority

V1 `allinproject/ALL-IN`, branch `integration/native-watch-v301`:
- `docs/decisions/2026-10-29-sport-specific-completed-activity-screens.md` (locked sport-specific layouts)
- `docs/decisions/2026-10-29-completed-activity-import-landing.md` (imported activity / review)
- `Native/src/app/training/workout/[id].tsx` (actual Overview / Details / Coach implementation)
- `Native/src/data/completedActivityPresentation.ts` (sport-aware metric priorities)

V2 ownership remains `ALL-243` (one completed activity/metric registry), with Training `ALL-246` and Coach `ALL-231` as consumers/producers of their own domains.

## Visible navigation: no reduced screen

**Overview | Details | Coach** — these are the founder-approved tab labels. Do not use the V2 interim UX labels **Advanced Stats** and **Analysis**, although deep metrics and analysis capabilities are preserved. Only eligible verified Indoor Trainer/Stair challenges add **Leaderboard**.

- **Overview** — actual activity title, sport, completion date/time, source; short sport-priority statistics; route/map where privacy permits; interval or structured execution summary where available; shoes/bike/context and allowed edits. Do not force the user to fill fields before entering.
- **Details** — all genuinely available, supported metrics for that sport, including sourced zones/time series, split/lap/interval structure, terrain/elevation, cadence, power, stroke, recorded sets/reps/load, indoor-machine measurements and provenance. Hide absent metrics; missing is not zero.
- **Coach** — an evidence-based activity analysis: purpose, exact planned-vs-actual comparison when matched, meaningful execution and source limitations, comparable history, recovery/training interpretation and actionable next steps. Provide an exact-activity-context follow-up conversation. Coach does not directly mutate Training plans; proposed changes require review and approval.
- **Post-completion editing** — start and finish workouts without mandatory gear/terrain prompts. Edit road/trail metadata, assign/change/clear shoes or bike, effort and notes at leisure from the completed activity. Preserve source measurements and provenance. Mileage reconciliation depends on one canonical activity-gear assignment ledger, including imported duplicate/edit/delete behavior. No second gear mileage truth.
- **Sharing** — Community reuse only the allowed public subset with route/privacy controls; never leak private Coach analysis, medical data, recovery readiness or hidden location.

### Sport-priority hierarchy (representative)

| Sport | Overview first | Details |
| --- | --- | --- |
| Outdoor run | route, distance, duration, pace, HR/elevation when present, shoes | splits/laps, pace, HR zones, cadence/dynamics/elevation if sourced |
| Trail run | running measurements with real terrain/elevation context; confirmed trail classification | elevation profile, ascent/descent, route and recorded pace/HR |
| Outdoor ride | route, distance/time, speed, power/HR/cadence where measured, bike | power/HR/cadence/speed trends, elevation, segments |
| Indoor trainer | interval execution, duration, power/cadence/HR when present | target-versus-actual interval graphs and verified equipment context; no GPS map |
| Strength | exercises, sets, reps/load/volume and validated achievements | individual completed sets and corrections, substitutions/RIR/RPE when entered |
| Hike / ruck | route, duration, elevation, distance and confirmed pack weight for ruck | vertical profile, explicit pack load, navigation and sourced physiology |
| Pool swim | distance, duration, pace/100, pool length/laps | lengths/sets, rest, stroke/SWOLF where actually recorded |
| Yoga/mobility | duration and recorded blocks/notes | no fabricated pace or competitive performance score |
| Multisport | overall time and ordered sport legs | each leg and transition independently |

Additional sports follow the full V1 locked configuration, not this abbreviated table. User display customization is sport-specific and presentation-only.


## Details completeness — founder reaffirmation 2026-11-11

The **Details** tab is the exhaustive per-activity statistics surface, not an arbitrary fixed selection or shortened "advanced stats" card. ALL source-backed metrics discussed/approved in V1 must be covered by a **versioned, auditable sport-specific metric registry**, with source adapters, unit/quality/provenance policy and a rendering owner. The current summary and implementation sample are **illustrative only**, not a ceiling on metrics. Carry forward the entire authoritative V1 per-sport metric catalog, not just those implemented in the early V1 native screen.

For every activity, Details exposes *every metric actually available* from its authenticated source, plus properly labeled supported derived values, without forcing users to hunt through separate pages or falsely inventing unsupported values. Include relevant:

- Timing: total elapsed, moving/active, paused/rest, intervals, split/lap/segment times and prescribed-vs-actual execution when recorded.
- Distance/pace/speed: overall and time-series data, min/max/average when meaningful and sourced, split/lap pace, pace/speed zones and distributions, treadmill calibration with explicit provenance.
- Heart rate: average/max/min if captured, trace, zone durations, time in Zone 2, sensor/quality gaps; historical zone definition as appropriate.
- Elevation/location/environment: route/map with privacy, ascent/descent, profiles/high-low elevation, grade/incline, sourced temperature/weather, terrain and technical trail context when recorded.
- Running/walking/hiking/rucking: cadence, steps, stride length, contact time, vertical oscillation, running power/economy signals only where measured, pack weight for ruck only if entered/supplied.
- Cycling and trainer: watts (average, max and eligible weighted/normalized/FTP-relative metrics), watts/kg only with compatible recorded weight provenance, power zones/distributions, cadence, resistance/ERG/simulation, speed, gearing/other telemetry only if actually reported, interval target/execution and source continuity.
- Swimming: pool length, lengths/laps/sets, pace per 50/100, swim rest and splits, stroke type/count/rate/distance per stroke, SWOLF only when supported, open-water GPS/context separately.
- Strength: each exercise and every recorded set (reps, load and unit, bodyweight handling, RIR/RPE, rest, volume), ordered history, substitutions, plan comparison and verified PRs.
- Stairs/elliptical/other machines: actual machine levels, steps/floors, stride/step rate, ramp/incline, resistance, machine distance/power only where supplied; no fabricated conversions.
- Hybrid/multisport: separate metrics for every leg/segment and transition, preserving source changes and total-versus-moving time.
- Where valid: energy/active calories, effort/feedback, supported achievements, wearable/equipment/source metadata, capture quality, correction history and relevant annotations.

**Completeness acceptance:** Inventory the V1 metric registry and Completed Workout Detail Gap Audit as well as the V1 locked sport screens; build a traceable coverage matrix of each metric -> canonical definition -> allowed sources -> persistence/quality -> Details location -> automated fixture. Any missing metric remains explicitly tracked until closed. Present all *recorded* eligible fields even if not part of the default Overview; provide collapsible sections and per-sport customization so completeness does not become an unreadable wall. Source-less metrics are absent/unknown, never zero. No invented charts, computed physiology, rankings or measurement certainty. The user controls display priority, not the truth of recorded measurements. Details remains named **Details**.

## Explicit V1 sport contract carry-forward — parity review

The locked [V1 sport-specific decision](https://github.com/allinproject/ALL-IN/blob/integration/native-watch-v301/docs/decisions/2026-10-29-sport-specific-completed-activity-screens.md) names the following distinct Details surfaces. They are **required scope for ALL-243**, not optional generic metric cards. The detailed metric registry/adapter/quality/fixture inventory below remains **unapproved and must be populated from real sources**, not guessed from sport labels.

| Activity context | Required when actually sourced | Never infer or display as sourced |
| --- | --- | --- |
| Treadmill run | speed/pace and incline timeline, authored interval target versus execution, HR zones, recorded cadence and machine/calibration provenance | outdoor GPS route from a treadmill-only record; corrected distance as original machine measurement |
| Elliptical | duration, HR trend/zones, actual cadence/stride rate, resistance/ramp timeline, equipment-reported distance **only when present** | running mileage/pace inferred from elliptical movement |
| Stair stepper/climber | actual steps/floors, step rate, machine resistance/level, HR zones and machine source | distance or elevation gain derived merely from step/floor count |
| Open-water swim | GPS route, distance, elapsed time, pace-per-100 and supported swim stroke/HR/splits with GPS-quality context | fabricated pool length or pool lap/set structure |
| Pool swim | pool length, actual lengths/sets/laps, pace-per-100, rest, stroke rate/count, measured SWOLF, HR when source quality permits | open-water GPS route or inferred GPS distance |
| Hiking and rucking | vertical/elevation profile, navigation/route, actual pace/HR; explicit recorded pack weight for rucking | inferred pack weight or load-adjusted result without a recorded load |
| Yoga and mobility | duration, optional authored blocks/poses, actual block timing and notes, HR only when measured | invented performance score, pace, competition rank or physiological readiness |
| Multisport/hybrid | one activity with ordered sport legs, source-specific metrics per leg, measured transition time, device handoff quality | flattening all legs into one sport or duplicating the single physical activity |
| Indoor trainer | actual versus authored interval execution, measured power/cadence/HR, valid power zones, verified trainer context and continuity | GPS route, raw-watt global rank or permanent achievement from an unverified attempt |
| Strength | complete per-exercise set ledger, load/reps/rest/RPE/RIR when recorded, substitutions and validated comparable PRs | distance/pace/elevation hero cards or unsupported inferred training volume |

**Acceptance trace for each row:** (1) versioned canonical metric code + unit or typed segment/set field, (2) exact provider/device/manual capability and owner identity, (3) source/quality and correction contract, (4) private persistence and retention policy, (5) sport-specific Details renderer section and customization behavior, and (6) a positive source-backed and negative missing-source fixture. No row is considered fully implemented merely because this decision is documented or its candidate SQL compiles.

**Non-negotiable privacy:** Cross-source sensor metadata, location/route, user physiology, medical context and private trainer challenge baselines cannot leak through the Community share subset. Present manually corrected values as corrected facts with origin preserved, never as untouched sensor readings.

## Canonical registry-to-screen boundary — 2026-11-11

The completed activity backend uses the **canonical** sport codes (`running`, `cycling`, `swimming`, `strength`, etc.), never presentation labels (`outdoor_run`, `pool_swim`, `hybrid`) or an unrestricted `all` scope. Registry `sport_scope` entries must match the exact canonical SQL sport vocabulary; a genuinely cross-sport definition explicitly enumerates its supported sports. Every published metric definition has a stable version and a real, bounded canonical unit; a missing unit is not an invitation to fabricate one in the UI.

The owner reader must preserve *both* the measurement's quality and its source's quality when rendering Overview/Details or passing evidence to Coach. `partial` remains distinguishable from `trusted`; `unverified`/rejected source facts cannot be promoted to validated measurements. Recorded measured zero remains distinct from absent/unknown. The read model preserves provenance and confidence; final on-screen partial-confidence labels still require installed UI acceptance.

Source-backed sport scope, unit, source identity and confidence are **not mutable display preferences**. The athlete may customize ordering, pinning and optional visibility, but never change a metric's declared sport, provenance, unit or trust status.

## Implementation gates

1. ALL-243 canonical schema/metric registry/source merge and least-privilege user reads approved and deployed.
2. Athlete-owned, account-switch-safe Completed Activity query exposed; use real data only.
3. Overview/Details/Coach rendering respects sport capability and provenance.
4. Coach context binds exact canonical activity and matched plan revision, with historical evidence and non-diagnostic scope.
5. Post-finish gear assignment/terrain edits integrated with existing Personal Gear defaults and single mileage ledger; no mandatory pre-workout gear UI.
6. Validate imported/manual/Watch, duplicate sources, offline/error, two accounts, accessibility and real device.

**Product principle:** Get the athlete moving first; Completed Activity answers what happened; Coach explains what it means; Progress describes change over time.
