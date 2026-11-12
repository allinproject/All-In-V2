# ALL IN 365 — Completed Workout Metric Registry + Detail UX v1

Date: 2026-10-28
Status: implementation handoff / design-approved target. Not a claim of integrated backend acquisition or device validation. `releaseReady=false`.

## Goal
ALL IN 365 should capture and preserve every trustworthy sport-relevant metric provided by a supported source, while keeping completed-workout detail easy to understand.

Core rule:

> **Store everything trustworthy. Show the important few first. Put every useful source-backed metric in Advanced Stats. Explain meaning in Analysis. Never fabricate unsupported data.**

The detail family remains:
- **Overview** — what happened
- **Advanced Stats** — all trustworthy sport-specific detail
- **Analysis** — what it means

Strength keeps a dedicated result treatment.

---

## 1. Universal data rules

1. Every metric must retain canonical provenance where available: source/provider, capture type, units, and source quality.
2. Missing remains unknown. Never display zero when a source omitted a metric.
3. Derived metrics must identify the calculation authority/version; provider-derived and ALL IN-derived values are not silently interchangeable.
4. Do not recompute provider-specific proprietary metrics and pretend they are equivalent.
5. Raw device/provider identifiers stay private; UI may show a human-readable source/sensor label.
6. Metrics that depend on compatible sensors appear only when recorded.
7. Historical edits to zones/FTP/max HR must not silently rewrite historical interpretation unless an explicit recalculation policy exists.
8. Manual workouts may contain only manually supplied or safely derived facts; no invented GPS, pace, elevation, dynamics, or sensor metrics.
9. A source quality problem should suppress or qualify a metric rather than create false precision.
10. Sport-specific metrics are registry-driven, not hard-coded as one universal workout schema.

---

## 2. Presentation hierarchy

### Overview
Default target: **4–8 primary facts**, not a metric wall.

Order:
1. activity identity + date/time + completion state
2. map/route hero when meaningful and available; otherwise sport-appropriate hero/summary
3. four primary stat tiles
4. optional secondary highlights (up to four)
5. planned vs actual if linked to a plan
6. achievement/PR callout when trustworthy
7. compact splits/laps/sets preview
8. gear/sensors
9. subjective notes / RPE
10. source/data-quality summary
11. explicit Community share state/action

Primary defaults adapt by sport. The user may later pin/reorder a small set of Overview metrics, but ALL IN must retain sensible defaults.

### Advanced Stats
Organize into sections. Hide empty sections entirely.

Potential sections:
- Performance
- Heart Rate
- Power
- Pace / Speed
- Terrain / Elevation
- Technique / Dynamics
- Splits / Laps / Intervals
- Zones
- Conditions
- Gear / Sensors
- Source / Data Quality

Prefer charts before large grids where a time/distance series exists.

### Analysis
Analysis is interpretation, not duplicate statistics.

Coach may explain:
- plan adherence
- pacing/power/HR execution
- terrain/environment context
- interval consistency
- technique trends when evidence is sufficient
- comparison to recent comparable activities
- training impact in bounded language
- useful next-step takeaway

Coach must not infer injury/medical diagnosis or treat one wearable metric as proof of readiness.

---

## 3. Universal workout fields

Supported when available:
- activity type/subtype
- title
- local date/start time
- elapsed time
- moving/active time
- paused/rest time where relevant
- distance
- active/device energy estimate, labeled as estimate
- average/max heart rate
- heart-rate zones/time in zone
- user RPE / effort
- notes
- source/provider
- recording device
- sensors
- gear
- planned workout linkage
- planned-vs-actual status
- weather/conditions when captured or reviewed
- route/map where meaningful
- laps/segments/splits when source-backed
- achievements/PRs only from confirmed comparable data

---

## 4. Run / Trail Run

### Overview defaults
- Distance
- Time (moving for ordinary training when trustworthy; elapsed prominently for race context)
- Average pace
- Average HR when available; otherwise elevation gain or RPE

Secondary:
- elevation gain
- best pace / fastest split
- RPE
- planned-vs-actual
- PR / best effort
- shoes

### Advanced Stats
Performance:
- elapsed time
- moving time
- average pace
- best/fastest pace
- grade-adjusted pace (only with a reviewed ALL IN definition or trusted provider value)
- pace zones/time in zone
- run/walk time where available

Heart Rate:
- average HR
- max HR
- HR chart
- HR zones/time in zone
- HR recovery only if source captures a valid post-exercise value and contract is reviewed

Terrain:
- elevation gain/loss
- min/max/current altitude series where available
- grade series/distribution
- elevation profile

Running dynamics, source-backed only:
- cadence average/max
- stride length
- ground contact time
- ground contact time balance
- vertical oscillation
- vertical ratio
- running power average/max
- running power zones if a reviewed zone source exists
- step speed loss / percentage if supported by source

Structure:
- splits
- laps
- intervals/recoveries
- segment efforts when canonical segment data exists
- each row may include distance, elapsed/moving time, pace, GAP, HR, elevation delta, cadence, power when recorded

Context:
- route/map
- surface/terrain where known
- weather/temperature/wind/precipitation when reviewed
- shoes/gear
- planned vs actual structured targets

### Trail-specific emphasis
Overview may elevate elevation gain and elapsed time above average pace. Advanced Stats should emphasize elevation profile, climb/descent behavior, grade, altitude and terrain rather than pretending road pace is always the primary outcome.

---

## 5. Walk

Overview:
- distance
- duration
- pace
- HR or steps/cadence when available

Advanced:
- moving/elapsed time
- pace/speed
- HR and zones
- cadence/step count when recorded
- elevation gain/loss
- route/map
- splits
- calories estimate
- weather
- gear

No running dynamics unless source explicitly records valid metrics for walking and product review approves interpretation.

---

## 6. Hike / Ruck

Overview:
- distance
- elapsed time
- elevation gain
- HR or altitude

Advanced:
- moving/elapsed time
- ascent/descent
- elevation profile
- min/max altitude
- grade
- vertical speed when valid
- pace/speed as secondary
- HR/zones
- route
- checkpoints/splits
- weather/temperature
- terrain/context
- pack weight for ruck when recorded
- gear/pack/shoes

For ruck, preserve pack weight as a contextual load fact; do not fabricate an equivalent running pace or calorie correction without a reviewed model.

---

## 7. Ride / Gravel / MTB / E-bike

### Overview defaults
- Distance
- Duration
- Average speed
- Elevation gain

If real power data is present, power may replace elevation or speed according to sport/user preference.

### Advanced Stats
Performance:
- elapsed/moving time
- avg/max speed
- distance
- elevation gain/loss
- grade
- route/map

Heart Rate:
- avg/max HR
- HR chart
- zones/time in zone

Cadence:
- avg/max cadence
- cadence chart/distribution

Power, only from real power source unless explicitly labeled estimated:
- avg/max power
- power chart
- power zones/time in zone
- FTP context/source
- work/kJ when source/calculation is valid
- weighted/normalized-style power only under a clearly defined reviewed calculation or provider value
- intensity/load metrics only with named calculation authority

Advanced cycling dynamics when sensor/source supports them:
- left/right balance
- seated/standing distribution
- power phase
- platform center offset
- torque effectiveness
- pedal smoothness
- force data

Structure/context:
- laps
- intervals
- segments
- bike/gear
- sensors
- conditions
- planned-vs-actual

### MTB/Gravel emphasis
Elevation, route, grade and terrain can outrank average speed. Do not compare MTB speed simplistically to road rides.

### E-bike
Keep assistance/e-bike classification visible. Do not blend e-bike speed/power comparisons with conventional cycling without explicit comparability rules.

---

## 8. Indoor Ride

Overview:
- duration
- distance if source provides it
- avg power when real
- avg HR

Advanced:
- power avg/max/chart/zones
- cadence avg/max/chart
- HR/zones
- FTP context
- work/kJ
- intervals/laps
- trainer/sensor source
- speed/distance only when source-backed

No fake route, elevation or GPS.

---

## 9. Pool Swim

Overview:
- distance
- duration
- pace per 100 yd/m
- lengths/laps

Advanced:
- pool length
- moving/swim time
- rest time
- pace per 100
- lengths/laps
- sets/intervals
- stroke type
- stroke count
- stroke rate
- distance per stroke when source supports it
- SWOLF
- HR avg/max/zones when captured reliably
- drill/manual lengths
- calories estimate
- planned-vs-actual set structure

SWOLF must preserve pool length and stroke context; do not compare scores across incompatible pool lengths/stroke types as though directly equivalent.

---

## 10. Open-Water Swim

Overview:
- distance
- elapsed time
- pace per 100
- HR when available

Advanced:
- moving/elapsed time
- pace chart
- HR/zones
- stroke rate/count where reliable
- distance per stroke
- route/map
- splits/laps
- water temperature when captured
- GPS/source quality
- calories estimate

Do not silently treat unreliable GPS or stroke detection as exact.

---

## 11. Strength

Strength does **not** use the endurance chart-first layout.

### Overview
- duration
- exercises completed
- total working sets
- total reps
- session volume/load when meaningful
- PR count
- user RPE

### Exercise result cards
For each exercise:
- exact exercise identity
- planned vs actual exercise state
- set number/type
- load
- reps
- RPE/RIR
- completion state
- notes
- rest time when recorded
- tempo when recorded
- superset/circuit grouping

### Advanced results
- per-exercise volume
- total session volume
- heaviest set
- best rep set
- estimated 1RM, clearly labeled as estimate + method/version
- rep/load PRs
- volume PRs
- previous comparable performance
- set-by-set historical comparison
- rest-time distribution
- planned vs actual sets/reps/load/RPE

Never convert missing load to zero; bodyweight and unknown load are distinct states.

---

## 12. HIIT / Circuit / Functional / CrossFit-style

Overview:
- duration
- rounds/sets
- work completed
- RPE
- HR when available

Advanced:
- work/rest duration
- round/lap breakdown
- movement sequence
- reps/load where recorded
- HR avg/max/zones
- interval consistency
- calories estimate
- planned vs actual
- modifications/substitutions

Preserve workout scoring type when canonical: rounds + reps, time, load, distance, calories, etc. Do not force every functional workout into one score.

---

## 13. Rowing / Indoor Row

Overview:
- distance
- duration
- average pace / 500 m
- stroke rate

Advanced:
- pace/500 chart
- avg/max stroke rate
- distance per stroke when supported
- power when supported
- HR/zones
- splits
- work/calories where source-backed
- drag factor when source provides it
- indoor/water classification

---

## 14. Ski / Snow / Nordic

### Alpine ski / snowboard
Overview:
- duration
- distance
- vertical/descent
- runs

Advanced:
- moving/elapsed
- run count
- ascent/descent
- avg/max speed
- elevation/altitude
- route
- HR/zones
- temperature/weather
- run-by-run segments

### Cross-country ski
Use endurance structure:
- distance/time/pace-speed
- HR/zones
- elevation
- cadence/stroke data if source supports it
- power if source/device legitimately records it
- laps/splits
- route

---

## 15. Team / Field / Court / Racket

Examples: soccer, basketball, hockey, lacrosse, football, tennis, pickleball, volleyball.

Overview:
- duration
- user RPE
- avg/max HR when recorded
- sport-specific score/context if manually linked and reviewed

Advanced, only when valid sensor/source exists:
- active time
- HR/zones
- distance
- speed
- sprint/high-speed efforts
- movement/work-rest patterns
- laps/periods/sets/games
- GPS route/heatmap where appropriate

Consumer GPS-derived field/court movement must not be presented with elite optical-tracking precision. If location accuracy is poor/indoors, suppress misleading distance/speed metrics.

---

## 16. Yoga / Mobility / Pilates / Mind & Body

Overview:
- duration
- session type
- RPE/effort
- optional HR

Advanced:
- avg/max HR when useful
- authored blocks/poses when structured
- guided vs free session
- subjective difficulty
- mobility/pain/niggle notes
- calories only as device estimate

Do not force distance, pace, power, elevation, zones, or maps onto these activities.

---

## 17. Multisport / Triathlon / Hybrid endurance

One canonical workout with child legs and transitions.

Overview:
- total elapsed time
- total distance where meaningful
- each discipline summary
- transition times

Advanced:
- independent Swim / T1 / Bike / T2 / Run sections
- each leg gets its native sport metric registry
- overall HR/context where useful
- planned-vs-actual per leg
- transition duration
- sensor continuity/source notes

Never collapse Swim + Bike + Run into one average pace/speed metric.

---

## 18. Generic / Other sport fallback

Overview:
- duration
- RPE
- HR if available
- calories estimate when source provides it

Advanced:
- any source-backed metrics explicitly registered for that activity type
- manual laps/segments when meaningful

A new sport should be added to the registry before exposing novel metric semantics. Generic fallback must not guess.

---

## 19. Charts

Charts appear only with series data.

Priority by sport:
- Run: pace/GAP, HR, elevation, cadence, power
- Ride: power, HR, speed, cadence, elevation
- Swim: pace, HR, stroke rate/SWOLF by length/set when valid
- Hike/Ruck: elevation/grade, HR, pace/speed
- Row: pace/500, stroke rate, HR, power
- Team sports: HR and movement only if source quality supports it

Rules:
1. synchronize chart scrubber across compatible series and map position when possible;
2. preserve units;
3. show gaps rather than interpolating missing sensor data as recorded truth;
4. clearly distinguish smoothed/derived series;
5. chart overlays must use compatible scales or separate views; do not create unreadable multi-axis spaghetti charts.

---

## 20. Splits / laps / intervals

Use one canonical segment model with semantic type:
- auto split
- manual lap
- interval work
- interval recovery
- pool length/set
- route segment
- race checkpoint
- transition

Each sport selects meaningful columns. Users should be able to tap a row and correlate it with the chart/map when those data exist.

---

## 21. Planned vs actual

When a completed workout is linked to a plan, Overview should answer "Did I do what was planned?" without requiring Analysis.

Compare only comparable planned dimensions:
- duration
- distance
- structured intervals
- pace/speed target
- HR-zone target
- power target
- RPE target
- strength exercise/set/rep/load target

Show:
- completed as planned / modified / materially short / materially over
- exact planned and actual values
- modified structure summary

Do not reduce compliance to one opaque score. Analysis may explain why a deviation could be reasonable.

---

## 22. Source + sensor provenance UX

Compact Overview label examples:
- Apple Watch
- Garmin + chest strap
- Garmin + power meter
- Manual
- Imported FIT

Advanced Source/Data Quality may expose:
- primary recorder
- HR source
- power source
- cadence/dynamics source
- GPS source/quality status
- pool/manual correction state
- user-edited fields
- estimated vs measured/recorded distinction

Never expose private raw provider IDs.

---

## 23. Overview customization

Post-beta or when low-risk:
- allow users to pin/reorder a small bounded number of Overview metrics by sport;
- defaults remain sport-aware;
- unavailable favorites disappear gracefully for workouts lacking that data;
- customization must not change canonical storage or Coach reasoning data.

Suggested bound: 4 primary + up to 4 secondary visible facts.

---

## 24. Metric-registry implementation shape

Recommended registry data shape (conceptual):

- sport family
- activity subtype
- metric key
- canonical unit family
- source requirement
- measurement kind: measured | provider_derived | allin_derived | user_reported | estimated
- overview priority
- advanced section
- chart eligibility
- split eligibility
- comparison eligibility
- planned-target compatibility
- data-quality requirement
- derivation authority/version
- display label/format
- privacy class

The UI must render from the registry + canonical workout facts rather than each screen inventing its own metric list.

---

## 25. Current implementation gap

Current Native completed-activity detail already has the correct top navigation and shows available primary facts, but chart/split/route samples, richer sport-specific acquisition, planned-vs-actual detail and complete result models remain incomplete.

Therefore this handoff is an implementation target, not a claim that these metrics are already available from current backend contracts.

Do not fabricate missing metrics merely to fill the design.

---

## 26. External benchmark findings used for this target

Current platform expectations verified October 28, 2026:

- Apple running views include HR, pace, cadence, stride length, ground contact time, vertical oscillation, elevation, running power, segments and splits.
- Garmin running dynamics include cadence, ground contact time/balance, running power, stride length, vertical oscillation/ratio and newer supported step-speed-loss metrics.
- Garmin cycling dynamics can include seated/standing, power phase, platform center offset, left/right balance, torque effectiveness, pedal smoothness and force data with compatible sensors.
- Garmin swim analysis includes stroke type/count and SWOLF; drills require special handling rather than blind automatic detection.
- Strava presents elevation, pace/speed, HR, splits/laps, segments, pace zones and cycling power zones, with deeper analysis behind the simple activity summary.
- TrainingPeaks emphasizes planned-vs-completed compliance alongside basic workout metrics and peak-performance context.

These are benchmark expectations, not instructions to copy proprietary algorithms or provider UX.

---

## 27. Acceptance requirements

A completed-workout detail implementation is not considered complete until:

1. every supported sport family maps to a registry entry;
2. Overview renders only bounded priority metrics;
3. Advanced Stats exposes all available registered metrics without unrelated fields;
4. no absent metric becomes zero;
5. charts only render from real series data;
6. split/lap rows preserve semantic type;
7. source/provenance is retained;
8. strength preserves null-vs-zero/bodyweight semantics;
9. multisport preserves each leg and transitions;
10. planned-vs-actual uses comparable targets only;
11. imported/manual/provider workouts do not fabricate unsupported metrics;
12. compact/narrow phone, large phone, 200% text/zoom, keyboard/accessibility and dark/light themes remain usable;
13. real-device source tests cover Apple Health/HealthKit first, with Garmin/COROS/direct integrations added only when their contracts become available;
14. Analysis never silently mutates Training or Community state.
