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
