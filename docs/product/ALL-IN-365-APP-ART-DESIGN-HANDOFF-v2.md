# ALL IN 365 — App Art & Visual Design Handoff v2

Date: 2026-10-26
Status: VISUAL REVIEW COMPLETE — DESIGN-APPROVED TARGETS ONLY. This is not evidence of implementation, merge, publish, backend integration, or device validation.

## 0. Phase status / authority

The dedicated App Art review phase is complete. The user has explicitly approved the current visual direction and does not want previously approved screens repeatedly regenerated or re-approved.

Operational rule:
- **APPROVED = CLOSED.** Do not reopen, regenerate, or redesign an approved surface unless the user explicitly requests a change or a real implementation conflict requires resolution.
- New implementation work should use this document as the consolidated visual/product-design target.
- Preserve newer working implementation when reconciling this handoff with newer App Build state.
- Do not treat generated presentation-board details that conflict with the locked rules below as authoritative. The locked rules below supersede incidental image-generation drift.

## 1. Canonical product language

- Product: **ALL IN 365**
- Philosophy: **Live All In.**
- Positioning: **Your whole fitness life in one place.**
- AI identity: **Coach**
- Social: **Community**
- Race-centered community: **RaceHub**
- Broad activity domain: **Training**
- Nutrition domain: **Nutrition** broadly; **Food** for logging/meals; **Fuel** for training/race fueling; **Meal Prep** for planned batch cooking
- Other product terms: **Gear, Collections, Progress, Recovery**
- Sport names: **Run, Strength, Ride, Swim, Hike, Hybrid**
- Avoid: AI365, generic “elite,” “beast mode,” “no excuses,” or similar hype language.

## 2. Canonical navigation — locked

Bottom navigation is exactly:

**Today / Fuel / Train / Community / Coach**

- Profile is accessed from the top-right avatar/header, not the bottom nav.
- Do not reintroduce old bottom tabs such as Profile, Training, Nutrition, Recovery, or Progress.
- Subscreens may use back navigation and local tabs, but the primary app IA remains unchanged.

## 3. Global visual system — locked

Canonical palette:
- background/black: `#0B0B0B`
- surface: `#151515`
- surfaceRaised: `#1D1D1D`
- warm white: `#F7F4EC`
- muted text: `#AAA69D`
- border: `#30302E`
- gold: `#B79A57`
- goldSoft: `#D1BC86`
- danger red: `#D56F6F`

Spacing:
- xs 6
- sm 10
- md 16
- lg 22
- xl 30

Radius:
- 10 / 16 / 22

Locked rules:
- **No green accent system.** Green must not be the generic success/activity color.
- No rainbow sport-color system.
- Use charcoal, warm white, restrained gold, and red for destructive/alert states.
- Sport differentiation comes from icons, labels, hierarchy, imagery, and restrained neutral/gold variation.
- One dominant CTA per section.
- Primary action buttons are **solid gold** where a prominent CTA is appropriate.
- Premium charcoal cards, useful numbers, strong spacing, restrained decoration.
- Cinematic dark athletic photography with warm grading; favor landscapes, training environments, course imagery, food imagery, and distant silhouettes when appropriate.
- Never imply a stock athlete is the user.
- Preserve the premium editorial/cinematic identity; do not regress to generic dashboard UI.

## 4. Coach identity and global access — locked

### Identity
- The product calls the AI simply **Coach**.
- **No user-selected/custom Coach name.** Remove prior custom-name concepts.
- Coach should not be represented by a human mascot or stock person.

### Coach icon / decal
Use one consistent Coach mark everywhere:
- **warm-white circular background using the design-system warm white `#F7F4EC`**
- **gold Coach logo/mark**
- same visual identity on:
  - floating Coach button
  - Coach bottom-tab selected state/icon treatment
  - Coach message/avatar identity marker
  - other Coach-specific identity surfaces where needed

The purpose is instant recognition against the black/gold app.

### Floating Coach
- Persistent floating Coach button on every user-facing screen except where redundant on the Coach tab itself.
- Respect safe areas; never cover keyboard, workout controls, bottom navigation, destructive controls, or critical content.
- Opens the same single persistent Coach conversation.
- Current screen/task/date/workout context travels into the conversation.
- Manual UI remains first-class.

### Proactive Coach attention badge
- Small `!` may appear on the floating Coach button for useful, timely, rate-limited prompts.
- Never interrupt with a modal.
- Dismissible/snoozable; do not nag.
- Never infer “not logged” means “did not happen.”
- No active training plan is an approved reason to show the badge.

### No redundant generic Ask Coach controls
- Do not scatter generic Ask Coach cards/buttons across Today, Fuel, Recipes, Strength, Meal Prep, Shopping, Profile, etc.
- The floating Coach is the universal entry.
- Specific contextual links are allowed when they communicate a real purpose, e.g. Why this target?, Review fuel plan, Explain adjustment, Optimize prep, Why did this change?, View with Coach.

### Coach parity
Anything a user can reasonably do manually should also be achievable through Coach using the same canonical actions, data, permissions, validation, and safety boundaries.

Direct UI may still be required for:
- camera/barcode interaction
- OS/device permissions
- destructive confirmation
- ambiguity review
- sensitive/irreversible confirmation

Community posting always remains explicit; Coach never autonomously posts.

## 5. Coach tab — locked direction

Core principle:
**conversation first, context second, actions third, settings tucked away.**

Top-to-bottom hierarchy:
1. compact Coach header/settings
2. optional current-context card only when relevant
3. optional timely Coach prompt, one at a time, dismiss/snooze
4. persistent conversation — largest area
5. reviewed action cards inline with relevant messages
6. sticky composer

Requirements:
- one persistent Coach identity/thread across app
- normal conversation history scrolling
- clear user vs Coach messages
- preserve unsent text where practical
- no model/provider/tier/token/cost telemetry in user UI
- current context only when task-relevant; do not dump full health/pantry/history/raw records
- context can be cleared/switched and must expire/change with task
- unknown state remains unknown, never fabricated

Reviewed action states:
- proposed
- awaiting approval
- running
- completed
- failed
- superseded/cancelled

Examples of reviewed actions:
- Use This Fuel Plan
- Adjust Workout
- Move Workout
- Add Workout
- Add Missing Items
- Open Recipe
- Add to Meal Prep
- Log Food
- Update Preference
- View Progress
- Save Training Plan

Coach-specific settings:
- response length: concise / normal / detailed
- communication style
- tone/directness
- proactive suggestion level
- Coach-specific nudge preferences

What Coach Has Learned:
- training/scheduling/food/equipment/coaching preferences and repeated user-stated behaviors
- user can correct/remove
- human-language provenance such as “You told Coach this,” “Learned from repeated choices,” “Imported from confirmed training history”
- no raw confidence percentages/database provenance in normal view

No-plan Coach state:
- one prominent **Make a Training Plan** action
- conversational plan building asks only for missing information
- disappears when an active plan exists

With-plan state:
- no permanent plan-management dashboard buttons
- user asks Coach to change the plan
- Coach proposes the smallest effective change, reviews/gets approval, then writes to Train

## 6. Training-plan behavior — locked

- Train with no active plan -> clear **Need a plan?** CTA.
- Train with active plan -> no Need a plan CTA.
- Coach with no active plan -> prominent **Make a Training Plan**.
- Coach with active plan -> hide plan-creation action.
- No permanent Edit Plan / Adjust Plan controls as primary plan-management UX.
- Conceptual split: **Coach creates/adjusts; Train displays/executes.**

## 7. Today — locked

Canonical target:
- cinematic mountain/sunrise hero upper area
- ALL IN 365 + Live All In.
- greeting such as Good morning, Matt
- short premium motivational line
- Today + date + View Plan
- optional compact Today’s Focus only when useful
- Today’s Training premium card supporting multiple workouts
- shared gold circular calorie tracker: Eaten / Burned / Remaining when known
- Food Logged photo strip: Breakfast / Lunch / Dinner / Snacks + View All
- floating Coach
- canonical bottom nav
- no generic Coach Insight/Ask Coach tile
- **no daily checklist/gamified task list**

Routing:
- Today’s Focus -> Coach with today context if shown
- calorie/nutrition card -> selected-day Food Log
- Recovery -> Recovery detail
- workout row -> workout detail/start
- View Plan/calendar -> Train current day

Food Logged behavior:
- populated day -> meal/photo previews + View All
- View All -> detailed Food Log for the selected date
- empty day -> clear Log Food CTA instead of fake/empty meal cards

## 8. Fuel — locked

Canonical target:
- cinematic mountain/lake hero
- “Fuel — GOOD FOOD TODAY. STRONGER TOMORROW.”
- one internal tab row only: Fuel / Recipes / Pantry
- Log Food primary action
- Shopping List action
- shared gold circular Today’s Calories tracker matching Today
- Meals Today photo strip + View Log
- My Next Meal Prep
- Prepared Meals Available with fridge/freezer states/counts
- Quick Utilities: Scan Ingredient, Recently Cooked
- floating Coach
- canonical bottom nav
- no duplicate Recipes/Pantry navigation
- no generic Ask Coach tile

Fuel landing ownership remains simple; deeper Pantry/Shopping/Meal Prep belong in their own screens.

## 9. Shared calorie tracker — locked

Today, Fuel, and Food Log use the same circular gold tracker:
- gold ring/circle
- charcoal / warm white / gold
- Eaten / Burned / Remaining when mathematically available
- unknown remains unknown
- no green state styling

## 10. Food Log — locked

- centered date navigation: `‹ Monday, October 26 ›`
- one-day arrows; future disabled unless later supported
- selected-date scoped reads/writes/actions
- shared gold circular calorie tracker
- Breakfast / Lunch / Dinner / Snacks
- entries + Add Food
- empty historical day -> Log Food
- Recent / Frequent / Saved / Quick Add
- repeat/copy
- PreparedBatch quick logging
- custom foods and saved meals
- restaurant/branded search
- barcode
- servings
- typed natural-language/Coach-assisted draft
- meal photo
- label photo
- camera/library
- AI/photo results are draft-first and reviewed before save
- edit / move / delete
- Finish Day / Reopen
- coverage-aware micronutrients
- optional training-aware note with specific Coach link

## 11. Recipes — locked

Recipe Browse:
- search/typeahead
- category filters separate from text search
- favorites
- pagination/state preservation
- My Cookbook

Recipe Detail:
- hero image
- title/category/servings/time/macros
- favorite
- truthful ratings
- **Cook Now + Meal Prep as equal primary paths**
- no Add to Shopping List directly on the recipe card
- pantry-aware ingredients
- readable instructions
- variants recalculate quantities/macros/cost
- storage/reheat
- floating Coach

Ingredient customization:
- rows static normally
- real alternatives get subtle chevron
- linked subrecipe name opens subrecipe
- separate chevron opens alternatives
- no “Change” label
- macros update live
- configuration persists downstream
- swipe left -> red X / Remove

Subrecipe stack:
- child pushes on stack
- back returns parent preserving state

## 12. Cook Now / Meal Prep — locked

Cook Now:
Recipe -> Cook Now -> Check Ingredients -> Start Cooking
- Have / Need / uncertain pantry state
- Add Missing only when truly missing
- substitutions supported
- uncertain pantry does not hard-block cooking
- actual-use review after cooking
- Pantry deduction at reviewed actual-use confirmation
- cooking does **not** auto-create Food Log entry

When Cook Now is invoked on a recipe already in the scheduled Meal Prep, ask whether the user is:
- starting the scheduled Meal Prep, or
- cooking one meal now

Meal Prep lifecycle:
recipe -> servings/config -> Pantry reservations -> Shopping shortages -> scheduled prep -> actual use -> Pantry deduction -> PreparedBatch -> Food Log

- queue is not schedule
- multiple recipes
- total quantities
- pantry coverage
- equipment conflicts
- Optimize My Prep
- prep timeline
- finish reconciliation
- Nothing cooked -> no deduction/no batch
- partial completion -> only reviewed actual use and finished batches

## 13. Freezer Kit — locked behavior for implementation

Freezer Kit is a distinct raw/pre-cook state, not a ready meal.

Rules:
- **zero pre-cooking during freezer-kit assembly**
- do not brown meat, cook rice/pasta, roast vegetables, etc. during assembly
- distinguish components at minimum:
  - Main freezer bag
  - Spice packet / small bag
  - Keep for cook day
  - Finish / serve with
- Pantry deduction follows actual assembly/use timing
- supplies such as freezer bags can be Pantry inventory and contribute shortages to Shopping List
- freezer kit is not eligible for ready-to-eat What Should I Eat results
- cook-day flow resurfaces remaining cook-day/finishing ingredients and checks Pantry readiness
- only after actual cooking does lineage transition into ready PreparedBatch servings

## 14. Pantry + Shopping List — locked

Pantry:
- user-facing name always **Pantry**
- one inventory with location filters: All / Pantry / Fridge / Freezer / Spices
- dedicated screen; Fuel does not dump full inventory
- search
- Add / Scan
- concise item rows
- amount when useful
- reserved amount only when relevant
- low/expiring cues only when source confidence is adequate
- consistent canonical naming
- includes food plus supported Supplies category

What Should I Eat:
- recommends only genuinely available Pantry food + eligible ready PreparedBatches
- no web-recipe suggestions requiring missing ingredients
- Shopping List items/hypothetical purchases are not available inventory

Shopping List:
- title exactly Shopping List
- merged recipe-generated needs + manual household/non-food extras
- group by aisle/category
- quantity/package rounding
- preferred store/branch pricing when reliable
- basket totals and store split when useful
- compare Aldi/Walmart or other configured stores when data exists
- multi-store split only when savings justify extra trip
- Add item / Scan Receipt / Finish Shopping
- checking an item does not pretend exact Pantry quantity is known until reconciliation

Receipt review:
- parsed grocery/non-food lines only
- flag uncertain items/prices
- never display/store card/payment credentials
- user confirms/corrects before Pantry/list updates

## 15. Strength — locked

Core rule: serious lifter logbook first, Coach intelligence second.

Active workout:
- exercise + intent
- planned target + last comparable performance
- all planned sets in one grid
- edit/fill rows as user goes
- autosave in-progress
- no required Log Set after every set
- one **Complete Exercise** after final set
- advance to next exercise
- optional RIR/RPE, not both required
- recommended rest + optional Start Timer
- timer preference: Off / Ask Me / Auto-start
- specific Coach affordance only, e.g. Why this target?

Supports:
- canonical exercise identity
- Search / Recent / Favorites / custom / Replace / Substitute
- set types only when intentional
- planned vs actual
- unilateral semantics
- session role/conflict
- specific technique/performance tips
- hidden exercise taxonomy
- explosive quality
- runner durability metadata
- short post-workout feedback
- strength/rep-load/e1RM trends with estimates labeled
- substitution preserving intent/equipment/constraints
- no fake muscle or injury-risk score
- plate calculator concept
- Start Empty Workout concept

## 16. Strength-history onboarding/import — locked

Prompt: “Do you already track your lifting somewhere?”
- No, start fresh
- Yes, import what I have

Import methods:
- photo paper/notebook log
- screenshots/images
- CSV/export when supported
- manual recent lifts/working weights
- future direct supported integrations

AI/photo extraction:
- draft only
- review/correct before canonical save

Baseline anchors when history incomplete:
- lifts/exercises
- recent working weights
- sets/reps
- RPE/RIR usage
- current program/style
- equipment access
- preferred/avoided exercises

Badge backfill only from trustworthy confirmed underlying data.

## 17. Historical health/workout import — locked

Optional onboarding/import flow after supported source connection.

Import when source quality/permissions support it:
- past workouts/training history
- bodyweight/body-composition history
- relevant wellness/training context
- eligible historical achievements
- Coach factual context

Requirements:
- source-aware dedupe (e.g. Garmin -> Apple Health plus direct source)
- review/summary after import
- missing detail stays unknown
- no invented fields
- no retroactive Community posts
- provenance retained
- imported data distinguished from explicit user statements when useful

## 18. Train + completed activity — locked

Train remains calendar-first.

Core:
- month calendar first
- selected day -> scheduled/completed details
- manual Add Workout
- Coach plan/adjust path
- planned vs completed linked
- active workout deep links

Completed Activity Detail:
- top tabs exactly **Overview | Advanced Stats | Analysis**
- adaptive by sport
- Run pace contextualized with terrain/elevation/conditions/effort
- Ride power only when real power data exists
- Swim set-specific structure where supported
- Hike/Ruck includes terrain and pack weight when applicable
- Strength uses dedicated result treatment for exercises/sets/reps/load/volume/PRs

Workout posting:
- explicit review before Community
- no repeat post prompt if already posted
- edits do not bump feed chronology

## 19. Sport intelligence visual architecture — locked

One adaptive Training architecture, not separate mini-apps.

Supported intelligence registry includes:
- Run
- Ride
- Swim
- Hike/Ruck
- Strength
- Hybrid
- Team/Field/Court support where useful
- Mobility/Recovery support where useful

Public athlete categories remain Run / Strength / Ride / Swim / Hike / Hybrid.

## 20. Gear Management — locked

- gear inventory for shoes, bikes, packs/general equipment
- add/edit gear
- running shoe mileage and retirement threshold
- bike mileage where supported
- assign from workout
- manual usage correction when needed
- usage history
- retire action
- reminders/alerts
- Coach recommendations may use current mileage, race/activity context, conditions, and preferences
- retirement estimates must remain recommendations, not fake certainty

## 21. Weather & Gear guidance — locked

Dedicated conditions/recommendation flow can include:
- workout date/time/location context
- forecast/feels-like/wind/precipitation/temperature
- activity-specific recommendations
- layer guide
- shoes/gear from actual inventory where relevant
- hydration/fueling link when conditions/duration justify it
- meaningful weather alerts
- save recommendation to workout
- quick reference for planned activity
- post-activity feedback to improve preferences
- settings/threshold preferences
- Coach can explain or modify recommendations

Weather/gear guidance should be contextual, not a new primary bottom tab.

## 22. Recovery — locked

Recovery is a detail surface reachable from Today/Coach/Profile context, not a primary bottom tab.

Can include when trustworthy data exists:
- sleep duration/stages/trends
- HRV
- resting HR
- user-entered mood/stress/soreness
- training load/recent context
- recovery/readiness presentation
- history/trends
- settings/source controls

Rules:
- no medical-diagnosis framing
- no fake certainty from consumer wearable data
- Coach explains context and practical next steps
- unknown/missing remains unknown
- user can manually add supported recovery context

## 23. Profile — locked architecture

All Profile sections use the same approved visual template:
- same black/charcoal/warm-white/gold styling
- same header/back pattern
- same card/row proportions
- same icon treatment
- same spacing/typography hierarchy
- solid-gold primary actions
- simple section -> deeper detail screens
- Coach parity without clutter

Main Profile sections:
1. **About Me**
2. **Training**
3. **Nutrition**
4. **Progress**
5. **Data & Privacy**

### About Me
Owns durable personal identity/preferences including shopping-store preferences where appropriate.

### Training
Use the same Profile-section template for:
- Goals & Races
- Sports & Training Focus
- Training Preferences
- Equipment & Gear

Goals/races/sport focus belong here rather than cluttering generic About Me.

### Nutrition
Same template for dietary/allergy/fueling/kitchen/food preference areas.

### Progress
Keep concise; approved structure centers on:
- Progress Overview
- Badges, PRs & Milestones
- Body Progress

Do not create redundant “Training History” and duplicate “Milestones” sections here. Detailed data belongs in Data & Privacy where appropriate.

### Data & Privacy
Owns:
- Connections / Integrations / Health sources
- Imported Data
- Privacy & Visibility
- Data Controls
- App & Account

Health/integrations belong here, not as a separate top-level Profile category.

### Referrals
Profile must include a clear place for **Referrals** using the same visual system. Referral rewards remain a business/product feature, not a new bottom-nav destination.

### Coach parity
Coach can update supported Profile information conversationally using the same canonical write rules and confirmations.

## 24. Birthday / gender — locked

Birthday:
- editable date of birth
- age calculated
- can support age-relevant/masters logic

Gender identity:
- optional and inclusive
- suggested: Woman, Man, Non-binary, Another identity, Prefer to self-describe, Prefer not to say
- never infer biological/hormonal context from gender identity
- separate explicit optional contexts when relevant, e.g. menstrual cycle, menopause/perimenopause, pregnancy/postpartum

## 25. Progress / badges / achievements — locked

Concepts:
- **Badge** = lasting achievement
- **PR** = activity performance
- **Milestone** = cumulative progress

Visual treatment:
- earned: restrained gold
- locked: muted charcoal
- tap -> what earned it / date / source

Distance badges include meaningful ladders for Run/Ride/Swim/Hike/Ruck and race-completion badges distinct from training-distance achievements.

Strength badges:
- actual completed load milestones by canonical lift
- rep PRs and relative strength can be secondary
- estimated 1RM must be labeled and is not a verified badge

Rules:
- no invented badges
- no achievement from missing/ambiguous data
- imported historical achievements can populate Profile but never create retroactive Community posts

## 26. Community / RaceHub — locked

Community:
- Following and RaceHub remain the core community model
- no free-form unrelated posting
- posts originate from supported workout/meal-prep flows
- edit headline/comment without bump
- explicit sharing remains non-negotiable
- invite friends via share link
- follow/mute/block/report/privacy controls

RaceHub:
- race detail/info/course/participants/results/community content as appropriate
- no generic Groups product; RaceHub is the group-style structure
- privacy controls must prevent hidden race history from being inferred

Community athlete profile:
- public/sanitized athlete view
- posts / races / stats where privacy allows
- user taps View All races -> completed race history
- completed race rows can show finish time/pace/place where legitimately available

## 27. Race results / public history — locked behavior

Preferred hierarchy:
1. Official/authorized timing result
2. User-confirmed official/manual result
3. Wearable race workout, clearly labeled and not silently treated as official

Official result and wearable workout remain separate linked records.

Example:
- Official chip time: 8:47:12
- Watch elapsed: 8:49:03

Both can be shown with clear labels.

Automatic reconciliation:
- tied to canonical event/distance
- preliminary -> final revisions supported
- stale preliminary result must not overwrite newer final
- name-only matching never auto-confirms
- strong provider identity/bib/event evidence required for automatic attachment

Ambiguous match:
- **We found a possible race result**
- show only necessary public review fields
- actions: **This is me / Not me**
- confirmed linkage becomes durable

Manual fallback:
- user can add/edit race result
- Finished / DNF / DNS / DQ / Pending / Unknown
- finish time required for manual Finished
- manual source labeled User entered until verified/reconciled
- later official result should merge/reconcile rather than silently destroy manual record

Privacy:
- Public / Followers only / Private
- hidden race history cannot be inferred from RaceHub membership or result lookup

## 28. What Should I Eat — locked

- use only available Pantry items + eligible ready PreparedBatches
- allow meal-type and practical preference filters
- may show Pantry vs Meal Prep source
- no suggestions requiring hypothetical purchases
- can open recipe / Cook Now / log prepared meal where supported
- Coach can provide the same functionality conversationally

## 29. Onboarding — locked direction

Initial onboarding should be short, progressive, and resumable.

Important rules:
- do not front-load every durable setting
- skipped optional fields remain unknown
- do not force profile-completion percentage
- no blanket OS permission prompts on first launch
- ask Health/notifications/camera/location permissions only in context
- existing users are not forced through new-user onboarding
- after onboarding, land on Today with at most one useful next action
- deeper personalization happens progressively through Profile/Coach when it materially improves a workflow

**Coach is always called Coach. Do not ask the user to name it.**

## 30. Visual-review closure / implementation handoff

The user has approved the current App Art direction broadly and explicitly asked to stop repeated approval cycles.

Implementation teams should now:
- stop generating duplicate visual-review boards for approved surfaces
- build against this consolidated target
- preserve locked color/navigation/Coach rules
- preserve explicit Community sharing/privacy rules
- preserve canonical data/state-machine rules
- flag only genuine conflicts or truly new screens for product/design review
- never treat presentation-board incidental details as stronger than this written handoff

This document supersedes App Art v1 where the two differ, specifically including:
- Coach is not user-named
- warm-white (`#F7F4EC`) Coach badge background + gold mark
- solid-gold prominent Profile/action CTAs
- final five-section Profile architecture
- Health/integrations under Data & Privacy
- Training goals/races/sport focus under Training
- shopping/store preferences available under About Me/profile preference structure
- Referrals accessible from Profile
- no duplicate checklist/gamification on Today
- visual-review phase closed; approved surfaces must not be repeatedly reopened

## Amendment — Recipe Import on Recipes screen

- The canonical **Recipes** screen exposes a visible **Import Recipe** action.
- Flow: **Recipes -> Import Recipe -> paste/share supported URL or source -> extraction preview -> review/correct -> Save to My Cookbook**.
- Import extracts available title, ingredients/quantities, directions, servings, time, reported nutrition, source attribution/URL, source image, tags, and equipment.
- Preserve attribution and source amounts; normalized units may be added without destroying original values.
- Extraction is draft-first. Uncertain or missing fields remain reviewable/unknown; do not invent missing facts.
- Once saved, the imported recipe behaves like any other canonical recipe for Recipe Detail, Cook Now, Meal Prep, Pantry/Shopping, variants, nutrition, and Coach parity.

## Amendment — Canonical Badge System

Badge visual shell is approved; canonical taxonomy and behavior are defined in `/ALL IN/App Art/ALL-IN-Badge-System-Spec-v1.md`.

Key rules:
- Badge = durable collectible achievement; PR = best performance; Milestone = cumulative progress. Keep them separate.
- Use charcoal/warm-white/muted-gold collectible treatment; no rainbow category colors and no green success system.
- Focus badges on verified sport capability, race completion, sustainable plan consistency, meaningful Meal Prep accomplishments, and limited special/event achievements.
- Do not create badges for likes/followers/comments, login/logging streaks, calorie/protein/weight-loss streaks, sleep/HRV/recovery streaks, no-rest-day behavior, Coach-message counts, purchases, or subscription duration.
- Imported history may backfill eligible badges from trustworthy reviewed evidence, but must never create retroactive Community posts.
- Newly earned badges may offer optional Community sharing; never auto-post.

## Amendment — Approved system / edge surfaces

The final system-surface pass is approved and closed.

Approved families:
- Subscription & billing states
- Help & Support
- Notification Center
- global loading/empty/offline/error/permission/destructive-confirmation patterns
- Apple Watch workout UI direction
- Launch / onboarding shell
- exercise-video future/placeholder state
- badge-art visual family

Specific launch correction:
- Splash = black/near-black background + ALL IN 365 wordmark + `Live All In.`
- **No runner, landscape, or decorative hero graphic on splash.**

Apple Watch approved direction includes launcher, Run setup/live view, HR-zone alert, navigation, Ride view, Strength set logging, rest timer, music controls, and workout completion. Keep Watch glanceable, high-contrast, battery-conscious, and less dense than the phone UI.

These are design-approved targets only, not claims that the corresponding phone/watch surfaces are implemented or device-tested.


## Amendment — Production UI Component & Asset Spec

Implementation-level visual consistency is now governed by:

`/ALL IN/App Art/ALL-IN-UI-Component-Asset-Spec-v1.md`

This production spec defines the reusable component system, iconography, imagery treatment, motion, responsive behavior, system states, Watch component rules, exercise-video placeholder treatment, subscription/support/notification components, accessibility expectations, and visual-QA checklist.

It does **not** reopen approved screens. Where conflicts occur, newer explicit product decisions and this handoff remain stronger than presentation-board incidental details. App Art work should now focus on production assets and visual QA of the real implementation rather than another broad concept-review cycle.