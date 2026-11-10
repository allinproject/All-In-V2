# ALL IN 365 — Badge System Spec v1

Date: 2026-10-27
Status: DESIGN-APPROVED PRODUCT TARGET — not implementation or device-validation evidence.

## Core distinction
- **Badge** — durable collectible achievement unlocked by a meaningful, verifiable accomplishment.
- **PR** — best performance. Lives in Personal Records / Progress; may decorate a workout or Community post, but is not part of the collectible badge catalog.
- **Milestone** — cumulative progress such as lifetime distance, completed sessions, races, or prepared meals. Lives in Progress and may trigger a celebration, but does not automatically become badge clutter.

The badge system should feel like a trophy case, not a points economy.

## Visual direction
- charcoal / near-black surfaces
- warm-white type
- restrained metallic muted-gold badge treatment
- locked badges use charcoal/graphite with reduced contrast
- earned badges use gold emphasis without rainbow category colors
- category identity comes from iconography and labels, not arbitrary sport colors
- special/founding/event badges may receive a slightly more ceremonial gold-soft treatment while remaining in the same visual family

Badge Home supports total earned count, recent badges, category browse, Earned/Locked filtering, and badge detail with requirement, earned date, evidence/source where useful, related badges, and deterministic progress where meaningful.

## Canonical badge categories

### Run
Single-activity capability achievements from trustworthy completed-activity evidence:
- First verified run
- 5K
- 10K
- Half Marathon
- Marathon
- 50K
- 50 Mile
- 100K
- 100 Mile

These are completion achievements, not PRs. A faster 5K updates Personal Records, not the 5K badge.

### Ride
- First verified ride
- 10 miles
- 25 miles
- 50 miles
- 100K
- 100 miles / Century

### Swim
- First verified swim
- 500 m
- 1,000 m
- 1 mile
- 3,000 m
- 5,000 m

Pool/open-water provenance remains available where relevant; do not invent split or stroke evidence.

### Hike / Ruck
- First verified hike/ruck
- 5 miles
- 10 miles
- 20 miles
- Marathon-distance hike/ruck
- 50K hike/ruck

Pack-weight achievements require actual recorded pack-weight evidence and are never inferred from a generic hike.

### Strength
Strength badges require trustworthy exercise-level data when a badge depends on loads/reps.

Safe badge families:
- first confirmed strength session
- verified canonical-lift achievement badges only where exact exercise identity plus completed load/rep evidence exists

A new heaviest set, estimated 1RM, or rep-load best is a **PR**, not a badge. High-count session totals belong under Milestones. Never award a lift badge from a generic Apple Health strength event or estimated load.

### Race
Race badges represent race participation/completion and prefer official or user-confirmed race-result evidence:
- First Race
- First 5K Race
- First 10K Race
- First Half Marathon
- First Marathon
- First 50K
- First 50 Mile
- First 100K
- First 100 Mile
- First Triathlon / Duathlon / other supported race format when canonical race type exists

Race completion badges are distinct from sport-distance capability badges. DNF/DNS/DQ are race-history states, not failure badges.

### Consistency
Reward sustainable execution, not compulsive streaks. Use plan-aware reviewed completion rather than raw daily app activity.

Potential ladder:
- 4 weeks of reviewed plan consistency
- 12 weeks
- 26 weeks
- 52 weeks

Moved/substituted/rest/recovery days count according to canonical training-plan rules. Do not reward “never miss a day” behavior or penalize appropriate recovery.

### Meal Prep
Reflect real completed prep sessions, not food restriction or macro perfection:
- First completed Meal Prep
- First multi-recipe prep session
- First freezer-kit assembly completed correctly
- First full prep planned + shopped + cooked + reconciled through ALL IN

High-count totals such as 25 prep sessions or 100 prepared meals belong under Milestones, not a giant badge ladder.

### Special / Event
Reserved for genuinely distinctive achievements:
- Founding Member / Founding Beta
- official ALL IN challenge/event completion
- limited seasonal/community event with explicit criteria
- future partner/event badges with verified eligibility

Special badges must not become paid status symbols. Purchase/subscription tier alone does not imply athletic achievement.

## Explicitly excluded badge types
Do not create collectible badges for:
- likes received
- follower count
- comments given/received
- generic posting frequency
- app login streaks
- generic food-logging streaks
- calorie-target streaks
- protein-target streaks
- weight-loss streaks
- sleep-duration streaks
- HRV/recovery-score streaks
- “no rest days” / pain / suffering / overtraining behavior
- arbitrary Coach-message counts
- purchases or subscription duration

Community actions may have ordinary product feedback/recognition, but popularity is not an athletic accomplishment.

## Evidence and provenance
Every badge defines its evidence class:
1. verified connected-source activity/result
2. canonical manual activity/result with required fields
3. reviewed historical import
4. official/user-confirmed race result
5. canonical Meal Prep completion/reconciliation
6. explicit ALL IN event eligibility

Rules:
- unknown stays unknown
- no badge from estimated metrics when the badge claims a verified achievement
- source removal or workout correction may invalidate a badge only when its qualifying evidence no longer exists
- imported history can backfill eligible badges after review
- backfilled badges never auto-create retroactive Community posts
- retries/resync must not duplicate awards or celebrations

## Celebration and sharing
When a badge is newly earned:
- show a concise in-app celebration
- offer View Badge / View All Badges
- optional Share to Community
- never auto-post
- if several badges unlock from one import/session, group the celebration rather than fire a cascade of modals
- backfilled historical imports summarize newly recognized achievements rather than replay years of celebrations

## Profile / Progress placement
Private Profile > Progress contains:
- Progress Overview
- Badges, PRs & Milestones
- Body Progress

Inside **Badges, PRs & Milestones**:
- Badges = collectible trophy-case view
- PRs = current bests/history where supported
- Milestones = cumulative counters/history

Public profile may show selected/eligible earned badges only according to privacy settings. Private source/provenance details remain private.

## Anti-gamification principle
The system should make an athlete think, “I earned that,” not “I clicked enough things to unlock that.”

A badge should normally pass all four tests:
1. meaningful to the athlete
2. based on trustworthy evidence
3. difficult enough that earning it feels distinct
4. safe to encourage repeatedly

If it fails those tests, keep it as a metric, milestone, notification, or ordinary app feedback rather than a badge.


## Approved milestone catalog

Milestones are cumulative progress counters/history. They may trigger a lightweight celebration, but they remain separate from collectible badges and PRs.

### Run lifetime distance
- 100 miles
- 250 miles
- 500 miles
- 1,000 miles
- 2,500 miles
- 5,000 miles
- 10,000 miles

### Ride lifetime distance
- 250 miles
- 500 miles
- 1,000 miles
- 2,500 miles
- 5,000 miles
- 10,000 miles

### Swim lifetime distance
- 10 miles
- 25 miles
- 50 miles
- 100 miles
- 250 miles
- 500 miles

### Hike / Ruck lifetime distance
- 50 miles
- 100 miles
- 250 miles
- 500 miles
- 1,000 miles

### Strength completed sessions
- 10 sessions
- 25 sessions
- 50 sessions
- 100 sessions
- 250 sessions
- 500 sessions

### Race-completion totals
Overall:
- 5 races
- 10 races
- 25 races
- 50 races
- 100 races

By supported race family where enough history exists:
- 5 completions
- 10 completions
- 25 completions

Examples include marathons and ultras. These are cumulative milestones, not new race-completion badges.

### Training consistency totals
- 25 planned sessions completed
- 50
- 100
- 250
- 500
- 1,000

Plan-aware completion rules apply. Moved/substituted/recovery/rest days must follow canonical training-plan semantics rather than a naive streak counter.

### Meal Prep totals
Completed prep sessions:
- 10
- 25
- 50
- 100
- 250

Prepared meals created:
- 50
- 100
- 250
- 500
- 1,000

### Community boundary
Do not create milestones for followers, likes, comments, post count, or other popularity metrics.

### Final approved mental model
- **Badge:** I did something meaningful.
- **PR:** I did something better than I ever have before.
- **Milestone:** Look how far I have accumulated over time.