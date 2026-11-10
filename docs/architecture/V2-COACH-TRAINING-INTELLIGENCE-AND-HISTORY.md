# V2 Coach — Training Intelligence, Athlete History, Predictions and Race/Route Coherence

Founder-approved direction: Coach is an intelligent training partner that knows the athlete's actual history and creates/adapts coherent plans across all sports the athlete combines. It must not behave like a generic workout-template chatbot.

Status: architecture contract and first deterministic source slice; not an end-to-end validated planner or production Coach.

## 1. Canonical authority and reasoning order

Coach is not the owner of Training, Athlete History, Progress, Recovery, Health, Gear, Race or Route facts. Each domain owns its data and canonical readers/writers. Coach orchestrates reads and may propose changes; only the owning domain can apply an approved change.

Reasoning precedence:
1. Current canonical object identity, plan revision, completed sessions and measured facts.
2. Active explicit athlete restrictions, preferences and approved training structure.
3. Relevant complete history with source, event time, coverage and confidence.
4. Current recovery/availability/environment and task-relevant Health context.
5. Reviewed sport-science evidence modules and deterministic guardrails.
6. Model judgment, with material unknowns left unknown.

Explicit current corrections override stale inference, but conversation text alone must not silently mutate canonical state. Active exercise restrictions are hard constraints. Generic templates must never override a user's saved plan.

## 2. Evidence and research coverage

V1 has a substantial reviewed Coach research base: 17 Evidence Registry domains. October 2026 research handoffs include Concurrent/Hybrid Training, Training Load/Fatigue/Adaptation, Strength Programming, Recovery & Sleep, Return to Training, Environment, Race Tactics, Sport Nutrition and Technique.

Core rules:
- Concurrent endurance + strength is valid; it is not automatically an interference problem.
- Primary-goal hierarchy determines priority; secondary goals are fitted around it.
- Running impact, cycling aerobic load, swimming technical/local load and strength muscular/load exposure remain distinct. Never convert miles, bike time, swim distance or lifting tonnage into fake universal equivalencies.
- Session order and spacing depend on priority, intensity, local muscular overlap, mechanical impact, next key session, recovery and availability. No universal "always lift first" or fixed spacing rule.
- Strength is a first-class modality for endurance users. Dose and exercise selection must fit the goal and current endurance block.
- Protect key sessions; reduce optional/supporting work before sacrificing primary sport-specific work.
- Load is multidimensional. Do not create an opaque readiness score or infer injury/overtraining from one HRV, ACWR or wearable reading.
- Day-of adaptation uses athlete report, comparable performance and repeated recovery trends; an isolated signal does not rewrite the block.
- Return-to-training is criterion/symptom/clearance aware. Never invent injury clearance or rehabilitation.

Research handoffs are reviewed evidence/implementation guidance, not proof every recommendation is connected to a live generator. V2 must preserve provenance and connect guidance to deterministic primitives and scenario evaluations.

## 3. Whole-athlete history contract

"Complete history" means canonical records are queryable with coverage awareness—not every row dumped into every prompt.

Task-relevant history includes:
- Planned, completed, skipped, cancelled and imported sessions across supported sports.
- Activity source, canonical identity, date/time/timezone, sport-specific metrics, duration, distance/elevation, HR/power/pace where trusted, session RPE, intensity distribution and key-session status.
- Strength exercise history: exercise/variation, sets/reps/load, RPE/RIR, substitutions, actual completed working weights and progression.
- Goals, races, official/manual/workout result provenance, target changes and outcomes.
- Accepted plan versions, Coach proposals, accepted/rejected edits, availability/schedule changes.
- Exercise restrictions, equipment constraints, pain/illness/return constraints and preferences with active status/provenance.
- Sleep, recovery, HRV/resting HR, subjective fatigue/soreness/stress and fueling where available and authorized.
- Gear, routes and course exposure where they materially change advice.
- Responses to prior adaptations: what changed, when, why and subsequent outcome.

Retrieval contract:
- Intent-gated canonical readers: current plan + calendar; recent comparable sessions; longer trends; relevant older race/strength/recovery episodes; active restrictions.
- Return source identity, event time, retrieval time, owner, revision, confidence and data coverage by sport/time window.
- Exact active restrictions and current approved plan always enter context as structured facts.
- New canonical state supersedes stale snapshots. Conflicts are surfaced, never blended into fabricated truth.
- Patterns are correlation evidence, not causation, diagnosis or permanent athlete traits.
- Health data is least-privilege and task relevant.
- Never claim complete history when device/provider sync coverage is unknown.

## 4. Training plan synthesis across 1, 2, 3+ sports

Coach must propose a complete weekly/periodized design, not a running template with extra sports appended.

Required inputs: primary/secondary/maintenance goal hierarchy; target event/date and verified demands; completed history and current load by sport; strength progression; training age/capacity; availability; restrictions/pain/return constraints; equipment; recovery patterns; relevant fueling/energy-availability constraints; accepted plan/version.

Planning sequence:
1. Select primary adaptation and priority sessions.
2. Preserve required sport-specific exposures and technical/discipline specificity.
3. Create session intents with purpose, intensity and quantified dose only where evidence supports it.
4. Place high-value sessions first; account for local overlap, impact, same-day order, recovery spacing and life constraints.
5. Include strength as a real modality with goal-specific strength/hypertrophy/power/maintenance/support programming.
6. Resolve 3+ sport combinations without treating each sport as an add-on. Explain protected, reduced, maintained and optional work.
7. Plan progression, recovery/deload, specificity, taper and post-event return as appropriate.
8. Validate restrictions, session density, recovery conflicts, fixed commitments and required sport exposure.
9. Present rationale, uncertainty and trade-offs. Save only through Training's review/apply flow.

Required scenarios:
- Runner + strength: protect key/long running sessions and fit appropriate strength around impact/lower-body recovery.
- Runner + bike + strength: preserve distinct run mechanical stress, bike aerobic work and strength local/systemic stress; bike is not a run-equivalent.
- Triathlon: preserve swim/bike/run exposures, define primary race/weakness priority by phase, include strength when it fits.
- Strength primary + endurance secondary: protect main lift progression and fit supportive endurance.
- Marathon/ultra primary + strength secondary: protect sport-specific durability and key runs; retain appropriate strength dose.
- Hybrid event: practice event-specific transitions and combined demands.

Unsupported or missing critical data leads to a question or bounded draft, never a fabricated complete plan.

## 5. Day-to-day adaptation

Coach checks today's planned session, recent completed response, athlete report, repeated fatigue/soreness/sleep patterns and next key session. It proposes the smallest useful adjustment while preserving the plan's purpose.

- Normal/unknown isolated signals do not justify an automatic rewrite.
- One difficult workout does not rewrite the whole block.
- Repeated adverse patterns prompt review of total load, recovery, fueling and life stress.
- Pain/illness uses the safety/return pathway; no diagnosis or invented clearance.
- Missed work is not crammed into later days as punishment.
- Cross-training substitution preserves purpose only partially; explain what remains and what is lost.
- Accepted plan remains unchanged until athlete reviews/applies a versioned proposal.

## 6. Prediction engine — V1 audit

V1 has running prediction snapshot persistence and a Progress reader for mile, 5K, 10K, half-marathon and marathon, with confidence and basis. A separate implementation handoff includes `performancePrediction.ts` and tests using recent race/PR/workout evidence and conservative Riegel-style extrapolation.

The dated handoff explicitly said the prediction algorithm/tests were added outside the live app and live wiring remained required. Therefore the live V1 prediction engine is not verified complete. V2 must recover/port the algorithm, test it, connect it to canonical history and persist model-versioned snapshots with evidence fingerprints. Ultra predictions remain excluded.

Multi-sport prediction is separate future work. Cycling FTP/power, swimming time trials, rowing, hiking/rucking and strength estimates each need their own validated model and input thresholds. Never force running equivalencies onto other sports. Hide estimates when evidence is insufficient.

## 7. Race plans, race strategies and routes

V1 contains real building blocks:
- Periodized race-plan validation with baseline/availability/recovery checks, distinct phases, taper, race-week identity and no past workouts.
- Race specificity from verified surface, hilliness and technicality.
- Race strategy attached to the canonical race workout, with course-version invalidation and source validation for aid information.
- Route provider validation/ranking for sport, distance, elevation, shape, terrain, access, closure, connectivity and facilities; explicit preview/save/attach.
- Route execution packages distinguish provider facts, user input, Coach estimates and unknowns.

These are integrity primitives, not proof that generated strategies/routes are coherent. V2 acceptance must test plans/strategies against athlete history, all sports, race/course demands, effort uncertainty, fueling tolerance, aid facts/cutoffs, weather assumptions, route access/closure/continuity/elevation, plan intent and course-version changes. Cover marathon, trail ultra (strategy allowed; ultra prediction remains excluded), cycling, triathlon/duathlon and unknown course. Unverified facts remain unknown. Route preview cannot mutate a plan; save/attach requires explicit approval and exact plan revision.

A concrete V1 scope limitation: the current `raceStrategyFlow.isScheduledGoalRace` recognizes only a canonical scheduled `outdoor_run` on the goal race date. Route generation has run and cycling candidate tests, but that does not establish a complete cycling or triathlon race-execution strategy. V2 must define sport-specific execution contracts (run, bike, swim, triathlon/duathlon transitions where supported) rather than labeling a run-only race package as universal.

## 8. V2 first deterministic Training slice

Committed: `apps/mobile-v2/src/features/training/trainingPlanSynthesis.ts` with focused tests. This shared schedule/constraint layer:
- accepts Coach-proposed session intents; does not invent prescriptions;
- supports declared sports and goal hierarchy;
- preserves distinct aerobic/mechanical/local/technical demand dimensions;
- blocks active restrictions, duplicate identity and unavailable fixed days;
- flags same-day/adjacent high-demand sessions;
- requires declared sport exposures;
- proposes review-only day adaptations while preserving the accepted plan.

The tests are committed but have not yet executed in a reproducible V2 install. This module is not wired to the V2 database, Coach UI, canonical Training writer, Athlete History or a complete periodized planner. Do not mark multi-sport plan generation complete until those steps and end-to-end scenarios pass.


## 9. Race-course evidence intake, full-horizon calendar and missed-session adaptation

### Race-course information is an input to plan generation

When an athlete requests a race plan, Coach/Training first resolves the canonical race identity and event date, then acquires the course evidence **before claiming to produce a course-specific plan**.

Preferred evidence order:
1. Official race/organizer website and linked official course pages/files.
2. Official organizer GPX/course file or organizer-published elevation/aid-station chart.
3. User-supplied GPX/route file, screenshots, PDFs, links or explicitly confirmed manual facts.
4. Verified routing provider only as a clearly labeled fallback/corroboration—not as proof of the official race course.

The intake must capture field-level provenance and version:
- Course identity, distance, route/geometry/file reference.
- Elevation gain and loss, elevation profile/source resolution when available.
- Surface/terrain and technicality.
- Aid-station names, exact course distances and services (water, electrolytes, food, gels, medical, drop bags, crew, etc.) only when published or confirmed.
- Event date, course revision/version, event rules/cutoffs when available.
- Source URL, provider/file identity, retrieval time, confirmation status and data freshness.

The athlete may provide or correct route/course/aid facts. Manual aid entries require explicit confirmation. A user GPX can establish route geometry/elevation, but it does not automatically establish official aid station locations/services. Conflicts between official site, uploaded file and user statements must be surfaced; do not silently select one.

Coach must not invent aid stations, elevation, course surface, cutoffs or route characteristics. Missing fields remain explicit unknowns. A plan may still be created as a bounded/provisional general preparation plan, but must not label workouts course-specific until verified course demands are present. Race fueling/aid strategy must use only verified or user-confirmed station data.

Course version changes invalidate affected route segments, elevation-specific sessions, race execution cues and station-linked fueling reminders. Reacquire/review before reattaching strategy.

### Complete plan duration and start-date choice

When a goal has a target race date, ask the athlete for the exact date they want the training plan to begin. Do not silently assume today, next Monday or a standard template start. Confirm athlete-local date, availability and any ramp/return-to-training constraints.

The accepted plan horizon covers every calendar date from the user-selected first training date **through and including race day**. Every date has an explicit state (planned session, rest/recovery, unavailable, event/race, or intentionally unplanned); no gaps caused by an arbitrary 8/10/12-week template. The opening partial week begins on the selected date, not the previous Monday. The final week ends on the exact race date. Retain the calendar's week grouping separately from the exact daily date range.

For a race 36 weeks away, create the full approximately 36-week progression (plus the race-day date as required by the inclusive calendar), not a short plan that stops early. Validate:
- start date < or = race date and selected start is not elapsed without explicit rebuild;
- every calendar date exists exactly once; race day appears exactly once and is the final date;
- phase sequence is appropriate to the horizon (foundation/base, build, race-specific, recovery/deload, peak, taper, race week where duration supports them);
- all planned sessions and rest/unavailable days have valid daily identities;
- no training is scheduled after race day;
- no past workouts are backfilled;
- long plans contain meaningful progression and recovery, not repeated identical weeks or a simple linear ramp.

### Missed session / unavailable day reflow

When an athlete says they cannot get to the gym, skipped a run, missed a swim/ride or has to change availability, Coach must fetch the current accepted plan revision and whole-athlete history, then review the **remaining plan through the goal event**, not only answer for that day.

- Mark the missed activity as skipped only after the athlete confirms it was not completed; preserve actual imported/completed activities.
- Never automatically move the missed session to tomorrow or stack it onto another hard/key day.
- Reassess the remaining days against availability, recent actual load, fatigue/soreness/sleep, next key session, sport-specific exposures and race countdown.
- Preserve primary goal and critical sport-specific sessions where safe. Remove/adjust optional/supporting load before adding more load to the week.
- A schedule-only miss is not lost fitness. Do not invent make-up volume.
- Repeated fatigue, soreness, pain/illness or underperformance triggers broader load/return-to-training review; do not diagnose or invent clearance.
- A cross-training replacement must explain which adaptation is retained and which sport-specific adaptation is lost.
- The full proposed changes are versioned and previewed; accepted calendar stays unchanged until the athlete approves through Training's canonical writer.
- Future fixed commitments, race day and completed history cannot be silently moved or rewritten.

### V2 source slices added

- `trainingPlanLifecycle.ts`: inclusive exact-date race calendar plus missed-session reflow proposal, with no make-up auto-rescheduling or canonical write.
- `raceCourseEvidence.ts`: field-level source/provenance and aid-station validation; course gaps remain partial/unverified.
- Both have focused tests registered in `test:training-logic`; the suite is not yet executed in a reproducible dependency install.


## 10. Nutrition intelligence is part of whole-athlete Coach

Coach nutrition must be based on the same primary/secondary/maintenance goal hierarchy and complete multi-sport calendar as Training. Do not create a nutrition-only copy of sport priorities.

Coordinate three distinct owners:
1. Daily Sport Nutrition Intelligence — training-aware daily energy/macronutrient/meal timing guidance and recovery meals.
2. Existing reviewed Endurance Fueling Brain — the sole numeric owner for prolonged-session carbohydrate/hour, fluid/hour and sodium precision.
3. Cookbook/Ingredient Database + Nutrition Calculator — authoritative composition and derived nutrition for meal recommendations.

Coach recommends meals from the user's V2 Cookbook, food preferences, hard allergies/exclusions, Food Log, Pantry, budget, schedule and cooking constraints. The calculator—not model prose—provides recipe/meal nutrient values. Missing food log data is unknown, not zero. A suggested meal is not a consumed meal; no Food Log write until confirmed.

Nutrition must support running, trail/ultra, cycling, swimming, strength, multisport/triathlon, hiking/rucking, and other supported training patterns. Primary/secondary sport priority governs recommendations. Do not simply sum the maximum calorie needs of each sport or use cross-sport equivalency ratios. Periodize carbohydrates around actual key sessions and total workload, preserve adequate energy availability and support protein distribution for strength/concurrent training.

Race fueling uses canonical event/course/aid station information. Never invent station services, fluid/sodium targets or GI tolerance. Preserve existing Fuel navigation (five approved actions) and contextual UI; no new permanent Sports Nutrition tab. Training-aware target changes must be explained and continue to respect the fixed vs adaptive daily budget mode.

Existing V1 inventory: reviewed Sport Nutrition, Competition Nutrition, Supplements and hydration/GI research; 17-domain Evidence Registry; staged v13 sportNutritionContext builder and numerous sport-specific/context/safety tests; versioned Endurance Fueling evidence planner with preferences, plans, feedback and prompt decision persistence. These are significant assets, but research/design/staged code do not prove production workflow integration.

See Linear ALL-235 for acceptance.

## Founder request — review of Coach nutrition and prior coaching — 2026-11-09

### V1 strengths verified from available source/research
- Broad, reviewed sport-nutrition evidence exists across daily Sport Nutrition, Competition Nutrition, Supplements, Cross-Training, Recovery and the 17-domain Evidence Registry.
- Existing sport nutrition context builder covers running, trail/ultra, cycling, swimming, strength, multisport/brick, hike/ruck, elliptical/stairs and yoga/mobility.
- Tests cover key sport contexts, two-a-days, hot/humid conditions, explicit unknown sweat/sodium, GI tolerance, restrictions/allergies and energy-availability safeguards.
- The Endurance Fueling Brain has a versioned reviewed evidence planner, athlete preferences, plans, prompt decisions and post-session feedback. Its numeric targets remain the canonical authority.
- Recipe Coach can analyze a specific recipe against current goals/training/recovery, and the Food Log / Cookbook / Pantry / Shopping infrastructure provides practical execution surfaces.
- Research safeguards: no RED-S diagnosis, no universal hydration/sodium, no inferred sweat rate, no default extreme carb target, no calorie/macro arithmetic duplicated by independent sport modules.

### Specific V1 gaps/risks
- `sportNutritionContext.ts` uses `explicitSport(message)` with ordered keyword matches and returns one sport. It only resolves `multisport` for explicit triathlon/multisport/brick language. A natural question mentioning running + strength may resolve as only one sport, depending on keyword order. This is insufficient for whole-day multi-sport nutrition.
- `SportNutritionContext` is a session-level DTO with one sport and one attached planned-workout context. It does not itself represent the complete primary/secondary sport hierarchy and total daily/weekly workload.
- The module deliberately marks pre-session timing, post-session intake, fuel access and hydration/GI inputs as pass-through only; it explicitly forbids this context builder from generating meal recommendations or numeric targets. That is a safe boundary but it means a separate integrated meal recommendation/daily nutrition capability must exist and be wired.
- V1 research/UI handoffs explicitly say they do not prove live integration. Sport-specific context and many tests do not prove a coherent production workflow from athlete history/calendar → daily meal suggestions → Cookbook/Ingredient DB calculation → Pantry/Shopping → feedback learning.
- Recipe Coach analysis is an existing focused recipe-review workflow, not proof that Coach can propose a complete day's meals or periodize nutrition against a multi-sport plan.
- Food Log records actual intake; absent/incomplete logging must not be treated as no intake or evidence of under-fueling. Keep estimate/provenance/incomplete states visible.
- The current UI handoff explicitly rejects adding another top-level nutrition tab and retains five Fuel actions. Keep those navigation decisions.

### V2 design response
Use three coordinated owners: Daily Sport Nutrition Intelligence; existing Endurance Fueling Brain for exact prolonged-session numeric fueling; Cookbook/Ingredient Database + deterministic Nutrition Calculator for actual meal composition. Coach selects/explains meals and uses Pantry/Shopping, but never invents recipe nutrition or logs consumption before confirmation. See ALL-235 for complete inputs, sport scenarios, UI and safety acceptance.

### Review scope honesty
This audit covers the current conversation/project context, indexed project/library research handoffs and inspected V1 source/tests. It does not claim review of every archived ChatGPT chat in the user's account; archived chats not exposed/indexed in this project are not independently accessible to this session. The user can supply/export those records for a true conversation-by-conversation review.


## 11. Gear, environment and outdoor-session intelligence

Coach must use the actual planned session, official race/course, terrain, scheduled weather, daylight/UV, athlete-owned gear, preferences and history to suggest useful equipment.

- Trail races/plans identify terrain, technicality, elevation and surface from verified course evidence. Suggest local trail routes/exposures appropriate to the athlete's ability, planned purpose, route distance/elevation and current access/closures. Do not suggest random nearby trails merely because the race is a trail event.
- Suggest trail-appropriate footwear for verified trail/technical sessions; road footwear for road sessions. Consider athlete's owned shoes, role tags, mileage inspection state, comfort feedback and rotation preference. Never auto-assign, buy, retire or claim shoe rotation prevents injury.
- For cold/wet/windy/hot sessions, give context-specific clothing and safety suggestions (layers, gloves, hat/ear coverage, visibility, traction, airflow) using scheduled-session forecast, not just current weather.
- For long outdoor daytime sessions in strong sun, use trusted UV/daylight/forecast evidence to suggest sunscreen, sunglasses/hat and reapplication planning. Never assume full sun or daytime from "outdoor" alone. Unknown UV remains unknown.
- Prefer gear the athlete already owns. Ask/offer alternatives when inventory is unknown; no shopping upsell.
- Missing route/weather/time/UV evidence means no false-specific recommendation. Severe weather safety alerts outrank optional gear tips.

V1 assets to preserve: canonical shoe inventory/mileage/assigned-workout history, shoe role recommendation, structured user feedback, route validation and NWS forecast/alert source. V1 shoe context is mainly triggered by shoe-related requests; V2 needs context-aware recommendation during plan/session preparation.

## 12. Low-noise proactive notifications

Preserve V1's existing notification event ledger, preferences/push gate, terminal/expiry integrity, dedupe, delivery bridge, consume-after-action and relevance scoring. Do not create a second notification system.

Notification policy:
- relevance over volume; default calm.
- one actionable notification per decision/event, deduped across retries/devices.
- respect user category preferences, quiet hours, local timezone, push permission, opt-outs, snooze/decline/dismiss and in-app action/completion.
- batch low-priority insights into Today/in-app digest; push only for timely action.
- no generic motivation spam, shame, streak pressure, every-workout prompts or repeated declined reminders.
- separate critical/time-sensitive, actionable today and optional insights. Severe weather/urgent safety may outrank optional coaching, but never bypass system push permission or explicit user opt-out.
- candidate events: key session prep, relevant scheduled weather/gear/UV, race/course update, pending plan reflow approval, long-session fueling prompt, repeated recovery pattern, gear inspection threshold and user-configured meal prep reminders.
- allow category tuning and explain why a notification was sent.

## 13. Smart Recovery and activity-personalized mobility

Recovery must be based on what the athlete **actually completed**, current cumulative load and what is next—not simply the next uncompleted session.

V1 finding: `recoveryStretchCatalog.ts` chooses a small fixed set by looking at the next uncompleted item in today's Training snapshot (run/ride/strength/default); its Coach state includes that single activity plus sleep, HRV, resting HR and hydration. A separate proposal contract requires user approval before applying a stretch-set change. This is useful but too shallow for longitudinal, whole-athlete personalization.

V2 requirements:
- retrieve recent completed activities, sport/session details and actual strength exercise/muscle-group history separately from upcoming plans;
- account for trail/elevation/terrain, run impact, cycling posture, actual strength movements/sets/load/RPE, swim shoulder/upper-body demand, multisport and two-a-days;
- enforce active exercise restrictions, pain/illness/return-to-training rules and user's mobility preferences;
- offer rest, easy movement, gentle mobility, breathing or no intervention when appropriate; stretching is not mandatory and must not be claimed to prevent injury or accelerate recovery;
- distinguish pain/illness from ordinary soreness; safety/return policies override;
- explain briefly why suggested items match completed training; ask optional helpful/not-helpful/discomfort feedback;
- preserve proposal/review/approval before modifying a saved Recovery plan;
- wearable data is contextual, not a diagnosis or automatic readiness verdict.

## 14. V1 audit summary — gear, notifications and recovery

- Gear: real owned-shoe inventory/mileage/history and role-based recommendation primitives exist; current Coach Gear context is primarily shoe-query-triggered. Context-aware cold/UV/clothing/gear prep is not proven end-to-end.
- Routes/environment: V1 has run/cycling route validation and NWS scheduled weather/alert evidence. Local trail recommendation must be course/goal/ability-specific, not merely nearest route.
- Notifications: V1 has a substantial event/dedupe/preferences/delivery/relevance system. V2 should extend it with coaching categories and intelligent batching rather than replacing it.
- Recovery: V1 fixed stretch catalog and activity-type rules exist, but selection currently looks at the next uncompleted item rather than rich completed exercise/load history. V2 must correct that.

Tracked in ALL-236 Gear/Environment, ALL-237 Notification Intelligence and ALL-238 Smart Recovery under ALL-217.


## 15. Additional V1 gaps found in full Coach self-review and whole-athlete simulation

### Non-race goal planning is not solved by race-plan intelligence

V1's whole-athlete simulation explicitly marks several non-race goal journeys failed/not shown:
- 36-month bench press target: race-centric planner rejects strength goals; no generic long-horizon strength goal model.
- 18-month stair-stepper goal: race-centric planner rejects stair goals and requires native steps/stairs/floors metric/device source.
- 24-month 100-mile cycling target: horizon fixture exists, but distance-specific cycling progression is not shown.
- Yoga/Mobility: basic recorder exists, but full guided execution is a known partial gap.
V2 needs typed sport-specific goal schemas/builders for race, lift/strength benchmark, cycling, swimming and other native device metrics. Do not force stair/elliptical/ruck/hike into running miles or invented equivalencies. ALL-239 owns this.

### Coach action authorization is fragmented

V1's 2026-10-31 self-review identified that Coach reads are more unified than its mutation/proposal mechanisms. Recipe, Recovery, Food/Shopping/Meal Prep, Training and Today use different proposal/write paths. The recommended missing contract is a bounded machine-readable action-capability manifest per current turn: exact target identity/revision, action type, permissions, preview/apply mode and canonical owner writer. This is not permission for a universal model writer. Also remove legacy freeform screenContext from supported entry points in favor of typed identity/versioned context. ALL-240 owns this.

### Whole-athlete evaluation is not the same as unit-test presence

V1's 2026-11-06 acceptance matrix marks major goal/sport journeys unverified, blocked or failed; source presence is not execution. It identifies remaining gaps in actual sport plan creation, Watch/Health/device execution, Food/Pantry/Recipe/Meal Prep, Coach action/apply, notifications, accessibility, offline/retry, account switching and full end-to-end behavior. V2 needs one evidence-backed quality program spanning Coach model behavior, canonical readers/writers, providers, devices, app lifecycle and cost. ALL-241 owns this.

### Data boundary and graceful degradation must survive the port

Preserve V1 strengths:
- one persistent Coach, task-relevant rather than full-app prompt dump;
- canonical domain ownership, bounded object identity and versioned typed context;
- learned/settled facts kept distinct from canonical app truth;
- explicit provenance separating facts, estimates, predictions, inference and recommendations;
- graceful degradation when context or settled-state readers fail;
- one capability manifest to constrain safe proposals;
- canonical router/limits/telemetry and cost regression review;
- user consent and least-privilege for Health, location, device, push and notifications.
Coach should say when data is unavailable, never invent completeness, and never claim a domain write succeeded before readback.

### Additional V2 scope
Tracked under ALL-239 (non-race goals), ALL-240 (action capability), ALL-241 (end-to-end Coach evaluation).


## 16. Coach behavior for athletes without race or performance goals

Coach must be useful when the athlete's starting point is a plain-language intention such as “I want to eat better,” “I want to get in shape,” “I want to lose some weight,” “I want to build muscle,” “I want to work toward a six-pack,” “I want to be more active,” or “I want to feel healthier.” These are valid goals under ALL-239, not unsupported race-plan requests.

- Coach asks what the user means and what fits their life, only as needed; it does not force a long onboarding questionnaire.
- Start with one or two practical, low-friction actions selected with the athlete. Examples: a short walking routine, a manageable beginner strength schedule, a few home-cooked meals, more consistent meal timing or adding produce to meals.
- Do not assume exercise history, gym/equipment access, budget, cooking ability, food preferences or available time. Read relevant profile/context and ask one useful next question when essential.
- A broad intention can remain qualitative. Coach does not invent a numeric baseline, deadline, daily calorie target, target weight or macro budget.
- “Eat better” does not automatically mean weight loss or calorie tracking. Discover the user's definition and offer behavior-first support.
- Weight-loss/physique goals coordinate nutrition, strength/activity and recovery sustainably. Weight measurements, photos, calories and macros are optional. Never promise a six-pack, claim spot reduction, automatically tighten calorie goals or add training volume when progress slows.
- Behavior and measurable refinements are proposals to the existing ALL-239 Goal owner. Accepted physical plans remain Training-owned; consumed intake remains Fuel-owned; Progress reads the same goal revision and real evidence.
- Missed or unlogged habits are not evidence of failure. No punitive streaks, guilt, forced reminders or rewards for restriction/overtraining.
- Coach distinguishes canonical logged evidence from user self-report and unavailable data; it does not claim progress it cannot observe.

This is not a new Coach mode, habit engine or lifestyle-specific goal database. It is the normal persistent Coach adapting its response and next action to the athlete's stated goal.
