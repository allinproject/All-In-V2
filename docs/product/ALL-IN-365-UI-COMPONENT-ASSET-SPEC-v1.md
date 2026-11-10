# ALL IN 365 — UI Component & Asset Spec v1

Date: 2026-10-28
Status: DESIGN-APPROVED PRODUCTION TARGET — implementation reference only; not proof of build, merge, device validation, or release readiness.

## 0. Purpose and authority

This file converts the approved ALL IN 365 App Art direction into a production UI system for App Build. It does not reopen approved screens or change canonical product behavior.

Authority order when details conflict:
1. newer explicit user-approved product decisions / live implementation backlog;
2. `/ALL IN/App Art/ALL-IN-App-Art-Design-Handoff-v2.md`;
3. this component/asset spec;
4. presentation boards and incidental generated-image details.

Core closure rule: **APPROVED = CLOSED.** Use this system to implement approved surfaces consistently. Reopen product design only for a truly new screen/flow, a user-requested change, or a genuine implementation conflict.

## 1. Foundation tokens

### Color
- background / black: `#0B0B0B`
- surface: `#151515`
- surfaceRaised: `#1D1D1D`
- warm white: `#F7F4EC`
- muted text: `#AAA69D`
- border: `#30302E`
- gold: `#B79A57`
- goldSoft: `#D1BC86`
- danger: `#D56F6F`

Rules:
- no generic green success system;
- no rainbow sport-color system;
- sport identity comes from iconography, label, hierarchy, imagery and restrained gold/neutral treatment;
- destructive/error states may use danger red;
- do not invent additional semantic colors without a concrete accessibility/meaning need.

### Spacing
- xs: 6
- sm: 10
- md: 16
- lg: 22
- xl: 30

Use multiples/combinations of this scale rather than arbitrary one-off spacing. Tight dense controls may use xs/sm; major screen section separation should generally use lg/xl.

### Radius
- compact: 10
- standard: 16
- feature/hero: 22

Do not create a large family of unrelated corner radii.

### Borders and dividers
- default border: 1 px using `#30302E`
- prefer spacing and surface contrast over excessive divider lines
- gold borders are reserved for selected/high-value emphasis, not every card

### Elevation
Dark UI elevation should be subtle. Prefer:
- surface change (`#151515` -> `#1D1D1D`)
- border contrast
- restrained shadow only where native layering needs additional separation

Avoid glossy/neon/glowing dashboard styling.

## 2. Typography behavior

Use the approved app type system from implementation/platform defaults where exact family is not separately locked. Priorities:
- excellent legibility
- compact athletic/editorial hierarchy
- stable Dynamic Type behavior
- numeric alignment where metrics benefit from it

Hierarchy roles:
- Display / Hero: short, high-impact page or hero statement
- Screen Title: primary screen identity
- Section Title: major local grouping
- Card Title: one-line primary object name
- Body: readable explanatory copy
- Label: form/control/category label
- Metric XL: primary workout/nutrition/performance number
- Metric Supporting: unit/context/secondary metric
- Caption: provenance, timestamps, hints, source labels

Rules:
- avoid ALL CAPS for long text;
- short editorial hero phrases may use uppercase intentionally;
- tab/button labels should remain concise;
- numbers must not visually jump when values update during active workouts where fixed-width/tabular numerals are available.

## 3. Core interactive components

### Primary button
- solid gold fill
- dark/black label with strong contrast
- standard radius 16 unless compact context requires 10
- one dominant primary CTA per section/surface
- supports default / pressed / disabled / loading
- loading keeps button width stable

Use for actions such as Start Cooking, Start Workout, Save, Continue, Confirm when that action is the clear primary path.

### Secondary button
- charcoal/surfaceRaised background or restrained border
- warm-white text
- should not visually compete with the primary action

### Destructive button
- danger red emphasis
- explicit destructive language where practical (Delete, Remove, Discard)
- never style a destructive confirmation like a routine primary gold action

### Text / tertiary action
- warm-white or gold text depending hierarchy
- no card/button chrome when simple inline navigation is clearer

### Icon button
- minimum accessible touch target even when visible glyph is smaller
- clear selected/pressed state
- no unlabeled ambiguous icons for destructive or irreversible actions

### Floating Coach button
- warm-white circular background `#F7F4EC`
- gold Coach mark
- optional small `!` proactive indicator only under approved proactive rules
- never obstruct keyboard, active workout controls, destructive controls, bottom nav or critical data
- absent/redundant on Coach tab

## 4. Navigation components

### Bottom navigation
Exactly:
**Today / Fuel / Train / Community / Coach**

Rules:
- persistent on primary phone destinations where appropriate
- selected state uses approved restrained gold emphasis
- Profile is not a bottom tab
- do not introduce old Profile/Training/Nutrition/Recovery tabs

### Top bar / header
Standard anatomy:
- optional back control
- screen title / context
- optional compact trailing action(s)
- Profile avatar on primary root screens where specified

Avoid stuffing global actions into every header.

### Local tabs / segmented control
Use only when sibling views genuinely belong together, e.g. Fuel / Recipes / Pantry or Overview / Advanced Stats / Analysis.
- clear selected state
- no rainbow category treatment
- preserve state when drilling in and returning

### Back behavior
- return to the previous meaningful state, not merely close a card
- preserve parent scroll/filter/search/config state where the canonical flow requires it
- linked subrecipes push onto a stack and back returns to configured parent recipe

## 5. Cards and rows

### Standard card
- surface `#151515` or raised `#1D1D1D`
- radius 16
- strong internal spacing
- one clear object/idea per card

### Feature card
- radius 22
- may include imagery, large metric or editorial hierarchy
- use sparingly for Today hero/training, Recipe hero, major progress/race surfaces

### Metric card
Anatomy:
- label
- large number
- unit/context
- optional trend/source note

Unknown data stays unknown; do not fill with inferred or fake values to make the UI look complete.

### List row
Anatomy:
- optional leading icon/image
- primary label
- optional secondary/supporting value
- optional trailing affordance

Use rows for settings, Pantry items, exercises, gear, notifications and history where a full card would be excessive.

### Swipe action
Where already approved, destructive swipe action uses danger red and explicit Remove/Delete semantics.

## 6. Form controls

### Text field
- clear label above or persistent contextual label
- placeholder is not a substitute for a durable label where ambiguity is possible
- error text appears near the field
- preserve entered values after non-destructive validation failure

### Search field
- supports typeahead where canonical screen requires it
- clear button
- state preserved on drill-in/back where specified

### Select / picker
- use native-friendly picker/sheet behavior
- show current value clearly
- do not hide meaningful alternatives behind unlabeled chevrons when user must make a decision

### Toggle
Use only for true binary settings. Do not use toggles as a generic substitute for navigation or multi-option preference selection.

### Radio / single-select and checkbox / multi-select
- explicit labels
- large tap targets
- do not rely on color alone for selected state

## 7. Sheets, dialogs and confirmations

### Bottom sheet
Preferred for compact contextual choices, filters, substitutions, quick add and secondary configuration.
- clear title
- easy dismissal when safe
- preserve parent state

### Full-screen task flow
Use for multi-step/high-attention tasks such as recipe import review, historical import review, workout execution, Meal Prep execution and substantial onboarding.

### Confirmation dialog
Use for destructive/irreversible actions only when needed.
- state exactly what will happen
- destructive action visually distinct
- safe cancel path

Do not interrupt normal safe actions with unnecessary confirmation modals.

## 8. Feedback and state components

### Loading
- use skeletons for content-shaped loading where it improves perceived stability
- use compact spinner/progress for short action execution
- preserve surrounding layout so content does not jump unnecessarily

### Empty state
Must answer:
1. what is empty?
2. why might that be?
3. what is the useful next action?

Examples:
- no Training plan -> Need a plan?
- empty Food Log day -> Log Food
- no badges in filtered category -> explain filter/state rather than fake examples

### Offline state
- preserve local/in-progress work where architecture supports it
- say what is available offline and what will sync later
- never imply cloud save succeeded when only local persistence exists

### Error state
- human-readable problem
- retry when retry is meaningful
- preserve user-entered work
- expose technical detail only when useful for support/debugging, not as normal UX

### Stale/sync state
- distinguish syncing / last updated / reconnect needed / failed sync
- do not silently present stale health/workout/race data as current

### Permission denied
- explain why the permission helps the exact task
- allow manual/non-permission path where product supports one
- do not dead-end the entire app because one optional permission is denied

### Toast / transient confirmation
Use for reversible/simple confirmations such as Saved, Added, Updated. Do not use toast as the only confirmation for a critical irreversible action.

## 9. Imagery system

### Brand photography
Direction:
- cinematic dark athletic photography
- warm grading
- training environments, courses, landscapes, food and useful equipment imagery
- distant silhouettes are acceptable
- avoid generic stock-fitness ad energy
- never imply a stock athlete is the actual user

### Image overlays
- use dark gradient/overlay where text sits on image
- maintain text contrast across image variation
- avoid heavy gold filters over photography

### Recipe imagery
- food should look realistic and appetizing, not hyper-saturated or synthetic
- consistent crop behavior in Browse cards
- larger hero crop on Recipe Detail
- missing image uses a branded neutral placeholder, not a fake food image

### User activity imagery
- user-provided images should retain authenticity
- crop non-destructively where possible
- do not overlay fake metrics on the source image unless the UI surface explicitly presents those metrics separately/clearly

### Recommended crop families
Implementation may adapt by device, but keep consistent families:
- hero / editorial: wide landscape
- recipe card: landscape/near-square depending list density
- meal/photo strip: compact square/rounded rectangle
- avatar: circle
- badge: square-safe vector area

## 10. Iconography

Use one coherent icon family with consistent optical weight.

Required semantic families include:
- Today / home context
- Fuel / food
- Train
- Community
- Coach
- Run
- Strength
- Ride
- Swim
- Hike/Ruck
- Hybrid
- Race / RaceHub
- Recipe / Cook Now / Meal Prep
- Pantry / Fridge / Freezer / Spices / Supplies
- Shopping / receipt / barcode
- Gear / shoe / bike / pack
- Weather / temperature / wind / precipitation
- Recovery / sleep / heart / trend
- PR / Milestone / Badge
- privacy / visibility / connection / sync
- notification / alert
- Help & Support

Rules:
- no arbitrary category colors;
- selected state can use gold;
- destructive icons can use danger red;
- ensure icons remain legible at Watch sizes.

## 11. Badge asset system

Canonical behavior/taxonomy remains in `/ALL IN/App Art/ALL-IN-Badge-System-Spec-v1.md`.

Asset rules:
- consistent collectible silhouette/family across categories
- earned = restrained metallic muted-gold emphasis
- locked = charcoal/graphite, reduced contrast
- category identity via central symbol/label, not rainbow colors
- Special/Founding/Event may use slightly more ceremonial goldSoft treatment while staying in the same family
- badge art must survive small Profile grids and larger Badge Detail presentation
- do not create new badge art unless a canonical badge achievement exists

Production deliverables per badge:
- vector master
- small grid rendering
- detail rendering
- locked variant
- earned variant
- accessibility label / canonical name

## 12. Motion and micro-interactions

Motion should communicate state, not decorate every surface.

### General
- short, restrained transitions
- respect Reduce Motion
- no constant pulsing/glowing UI
- preserve battery on Watch and during active workouts

### Approved useful motion targets
- tab/screen transition
- bottom-sheet presentation
- button loading -> completion
- workout complete confirmation
- badge-earned reveal
- Coach proactive `!` attention treatment (subtle and rate-limited)
- skeleton -> content transition
- rest timer completion / interval transition on Watch primarily via haptic + clear visual state

### Badge earned
- concise gold reveal/scale/fade
- no casino/confetti aesthetic
- grouped recognition when many historical badges unlock together

## 13. Accessibility and interaction standards

- support Dynamic Type / text scaling without clipping critical controls
- do not communicate selected/error/locked state with color alone
- maintain adequate contrast for warm white/muted text/gold on dark surfaces
- accessible labels for icon-only controls
- touch targets sized for reliable use during movement where applicable
- VoiceOver order should match visual/task hierarchy
- workout actions must remain operable with sweaty hands / motion / glanceable attention constraints
- Watch screens should prioritize large tap targets and avoid dense tiny text

## 14. Responsive phone behavior

Design for current supported iPhone sizes without bespoke redesign per device.

Rules:
- content width uses safe margins derived from spacing scale
- cards generally stretch to available width
- avoid fixed heights for text-heavy cards
- hero imagery may crop responsively but must preserve focal point
- bottom actions respect home indicator/safe area
- floating Coach repositions around keyboard, bottom sheets and workout controls
- long labels wrap or truncate intentionally; never overlap controls
- landscape phone is not a separate primary design system unless a specific workout/media use case requires it

Small-phone priority order:
1. task-critical action
2. primary metric/content
3. supporting context
4. decorative imagery

Decorative content is the first thing to compress/remove.

## 15. Apple Watch component rules

The Watch uses the same brand but is not a miniature phone dashboard.

### Visual
- near-black background
- warm-white text
- restrained gold selected/action state
- red reserved for real alerts/destructive states
- large glanceable numbers
- minimal decoration

### Interaction
- one primary action per state when possible
- crown/swipe/page navigation should reduce tap complexity
- haptics only for actionable events
- avoid animation loops
- do not require phone connectivity for core cached workout execution where canonical architecture supports offline execution

### Core reusable Watch components
- workout launcher row/tile
- metric page
- current step/interval card
- HR-zone alert
- route/off-course cue
- Strength set grid/entry
- rest timer
- media-control quick surface
- pause/resume/finish controls
- completion summary

Battery-efficiency requirements in the live backlog remain authoritative.

## 16. Exercise-video media slot

Beta/future exercise detail must reserve the approved top media region without pretending the video library exists.

States:
- video available -> thumbnail/player entry
- video unavailable in beta -> neutral exercise-illustration/media placeholder or omit media chrome cleanly
- loading -> skeleton
- failed -> retry/fallback without blocking the exercise log

Rules:
- workout logging never depends on video playback
- no broken player box
- do not label placeholder as a real demonstration
- production video should show clear technique framing and remain subordinate to logging controls during an active session

## 17. Launch / authentication shell

Splash is locked:
- black/near-black background
- ALL IN 365 wordmark
- `Live All In.`
- **no runner, landscape, or decorative hero graphic**

Authentication/account surfaces use the same component system:
- Sign In
- Create Account
- Forgot/Reset Password
- email verification/status where required
- subscription/trial entry where applicable

Do not turn auth into a separate visual brand.

## 18. Subscription / billing components

Use existing business authority for exact price/trial terms; design system only defines presentation.

Needed states:
- trial offer
- monthly/yearly choice
- active trial
- active subscription
- renewal date/state
- restore purchase
- payment/billing issue
- cancellation management entry
- expired/no entitlement state where required

Rules:
- pricing/renewal language must be explicit
- no dark patterns
- no fake urgency
- annual/monthly selection should be obvious
- destructive/cancel flow must not visually masquerade as a routine gold primary CTA

## 19. Help & Support components

Standard Help & Support surface may include:
- Help / FAQ entry
- Contact Support
- Report a Problem
- diagnostic/support context sharing only when explicitly reviewed/allowed
- app version/build information where useful

Do not expose secrets/tokens/raw sensitive health data in routine support UI.

## 20. Notification Center components

Notification Center is an in-app history surface, not a replacement for OS notifications.

Notification row may include:
- icon/type
- concise title
- one-line context
- timestamp
- unread/read state
- optional destination

Types may include canonical product events such as:
- Coach prompt
- training adjustment/reminder
- race result/match
- PR/badge/milestone recognition
- gear/shoe threshold
- Meal Prep/shop timing
- connection/sync issue

Rules:
- do not over-notify
- no fake red urgency for routine fitness events
- privacy-sensitive content must respect lock-screen and user notification settings

## 21. Visual QA checklist for App Build

A screen is not visually accepted just because the route renders.

Check:
1. canonical five-tab navigation preserved;
2. black/charcoal/warm-white/gold palette preserved;
3. no stray green success treatment;
4. spacing uses the shared scale and feels consistent;
5. primary CTA hierarchy is obvious;
6. card radii/elevation consistent;
7. typography hierarchy matches importance;
8. empty/loading/error/offline states exist where needed;
9. unknown values are not fabricated;
10. Coach button/icon identity is consistent and unobtrusive;
11. safe areas/keyboard/bottom nav do not cover controls;
12. small phone + large phone layouts do not clip/overlap;
13. Dynamic Type/accessibility does not break critical paths;
14. imagery uses approved cinematic/realistic treatment;
15. Watch screens remain glanceable and battery-conscious;
16. destructive actions use danger semantics and clear confirmation when needed;
17. imported/review flows distinguish draft/unknown/confirmed states;
18. public/community sharing remains explicit;
19. no incidental presentation-board element overrides canonical written rules;
20. implementation conflict is escalated rather than silently redesigned.

## 22. Production asset checklist

App Art/Build should maintain:
- ALL IN 365 wordmark variants appropriate for dark/light usage where needed
- Coach mark master + small-size variants
- bottom-nav icon set
- sport icon set
- utility icon set
- badge master library
- neutral image placeholders
- recipe image crop guidance
- profile avatar placeholder
- Watch-size icon variants
- launch/splash assets with no decorative hero graphic

Do not duplicate near-identical assets across features when one semantic asset can be shared.

## 23. Definition of design-complete

For the current approved product scope, App Art is design-complete when:
- major screens/flows are governed by the App Art handoff;
- production components/assets follow this spec;
- canonical badge behavior follows the Badge System Spec;
- sport-specific details follow the Sport Intelligence Design Handoff and newer backlog authority;
- implementation receives visual QA against real rendered screens;
- no known genuinely new surface lacks a design rule.

Remaining App Art work after this point should primarily be:
- visual QA of implemented screens;
- creation/export of actual production icons/badge assets as implementation reaches them;
- resolution of genuine implementation conflicts;
- design for truly new future features.

It should **not** be another broad concept-board approval cycle.