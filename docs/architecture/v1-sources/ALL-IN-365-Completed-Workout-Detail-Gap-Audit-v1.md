# ALL IN 365 — Completed Workout Detail Gap Audit v1

Date: 2026-10-28
Status: cross-subsystem implementation handoff. Not integrated or release-ready.

## Current working foundation

Current Native completed activity detail already has:
- one top-level `Overview | Advanced Stats | Analysis` navigation row for non-strength activities;
- strength kept on its dedicated result path;
- Overview rendering available primary recorded metrics such as Distance, Duration, Average HR and Effort;
- Advanced Stats rendering the full metric grid currently returned by the canonical detail contract;
- explicit Coach handoff only from Analysis;
- gear/source/community state;
- owner/request/stale-screen protections from the existing workout-detail flow.

Current limitation: chart, map/route series, splits/laps, richer sport-specific metric acquisition, planned-vs-actual detail and richer Strength set/PR results are not yet part of the current workout-detail contract.

## Newly locked implementation authority

Use:
`/ALL IN/App Build/Handoffs/ALL-IN-365-Completed-Workout-Metric-Registry-v1.md`

as the metric/display registry for expansion. Do not replace the existing Training or App Art navigation authority; extend it.

## Gap matrix

### 1. Canonical metric normalization — OPEN / highest priority
Need a normalized completed-workout detail contract capable of representing:
- scalar metrics;
- time/distance series;
- splits/laps/intervals with semantic type;
- route/map geometry reference;
- zones/distributions;
- source/sensor provenance;
- planned targets + comparable actuals;
- achievements/PR facts;
- strength result sets/exercise history;
- multisport legs/transitions.

Must preserve:
- absent != zero;
- measured vs provider-derived vs ALL IN-derived vs user-reported vs estimated;
- canonical units + display units;
- calculation authority/version for derived metrics.

Do not make UI parse raw HealthKit/FIT/provider payloads.

### 2. Apple Health / HealthKit ingestion completeness — OPEN
First supported source should map every HealthKit workout metric ALL IN can legitimately read into canonical workout detail rather than only summary metrics.

Priority families:
- duration/moving/elapsed where available;
- distance/energy;
- heart rate series + avg/max;
- elevation/route where permission/source supports it;
- running cadence, stride length, ground-contact time, vertical oscillation, running power when exposed by supported Apple workout samples;
- cycling cadence/power when recorded;
- swim distance/laps/strokes/SWOLF/sets where source APIs support trustworthy extraction;
- workout segments/laps where exposed.

Missing Apple fields stay unknown. Do not recreate Apple-only calculations from unrelated samples without a reviewed rule.

### 3. FIT/direct-provider ingestion registry — FUTURE integration boundary
Garmin/COROS/direct connectors after beta/application approval should map into the same canonical registry, not create provider-specific detail screens.

Support provider-specific optional fields only when present, e.g.:
- Garmin running dynamics (including GCT balance/vertical ratio/step-speed-loss where present);
- Garmin cycling dynamics (power phase, PCO, left/right balance, seated/standing, torque effectiveness, pedal smoothness, force);
- provider-specific swim/drill details;
- COROS-specific supported metrics.

Provider-specific proprietary metrics retain provenance and names where needed; never claim ALL IN independently reproduced them.

### 4. Series/charts — OPEN
Backend/detail contract must expose bounded, downsample-able series suitable for mobile charts without returning giant raw provider payloads.

Minimum chart families:
- run: pace/GAP, HR, elevation, cadence, power;
- ride: power, HR, speed, cadence, elevation;
- swim: pace, HR, stroke/SWOLF by set/length when valid;
- hike/ruck: elevation/grade, HR, pace/speed;
- row: pace/500, stroke rate, HR, power.

Need one consistent timestamp/distance-axis model so charts, split selection and map scrub can synchronize later.

### 5. Splits/laps/intervals — OPEN
Create canonical segment model with semantic kinds:
`auto_split | manual_lap | interval_work | interval_recovery | pool_length | swim_set | route_segment | race_checkpoint | transition`.

Sport-specific columns render from registry. Never infer work/recovery semantics just from odd/even laps without reviewed plan/source evidence.

### 6. Route/map — OPEN
Completed detail should show map only for location-relevant sports and only when canonical route exists and privacy permits display.

Need:
- route geometry abstraction;
- start/end privacy handling where applicable;
- chart/map synchronization later;
- Community map visibility remains a separate explicit share choice.

### 7. Planned vs actual — OPEN
Link current planned-workout facts into completed detail and compare only comparable dimensions.

Overview should show a compact adherence summary; Advanced may show target/actual per segment or dimension.

Avoid opaque compliance score. Existing completed/modified/missed/unplanned calendar state remains authoritative.

### 8. Strength result model — OPEN
Current strength execution exists, but completed detail still needs richer result representation:
- exercise identity;
- sets/reps/load/RPE/RIR/set type;
- total and per-exercise volume;
- heaviest/best sets;
- estimated 1RM with named formula/version;
- PRs only from trustworthy comparable history;
- rest times when recorded;
- planned-vs-actual and previous comparable session.

Null load, explicit zero and bodyweight remain distinct.

### 9. Multisport — OPEN
One workout, multiple discipline legs + transitions. Do not flatten into one metric grid. Each leg invokes its native sport registry.

### 10. UI rendering from registry — OPEN
Replace ad-hoc metric rendering with registry-driven sections:
- Overview priority;
- Advanced section;
- formatter/unit;
- chart eligibility;
- split eligibility;
- comparison eligibility;
- quality/source requirement.

UI hides empty sections.

### 11. Analysis wiring — POST-DATA
Coach Analysis should consume compact canonical summaries and selected comparative facts, not raw sensor dumps. Do not wire richer Coach claims before underlying detail/provenance exists.

## Recommended implementation order

1. canonical metric + provenance types
2. canonical segment/split + series types
3. extend read RPC/detail contract in backward-compatible form
4. HealthKit mapping into canonical facts
5. registry-driven Advanced Stats renderer
6. maps + charts + split tables
7. planned-vs-actual surface
8. strength result expansion
9. multisport legs
10. compact Coach Analysis context
11. direct Garmin/COROS/provider expansions after connector approval
12. Overview customization later

## Beta definition of done

For beta, do not wait for every future vendor-specific metric. Require:
- all metrics currently available from the first supported canonical source(s) are preserved and visible somewhere appropriate;
- Run/Walk/Hike/Ride/Swim/Strength/Yoga/Other have correct non-fabricated detail;
- charts/splits/maps appear when actual data exists;
- planned-vs-actual works for linked plans;
- source/provenance is inspectable;
- Strength results are useful enough for lifters;
- generic fallback does not invent sport semantics;
- inaccessible or unsupported provider data is clearly absent rather than simulated.

Garmin/COROS advanced vendor-specific fields may follow after direct integrations, but the registry/data model must already have an extension path so adding them does not require another redesign.
