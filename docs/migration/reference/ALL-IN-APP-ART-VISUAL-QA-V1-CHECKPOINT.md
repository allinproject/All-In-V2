# ALL IN 365 — App Art Implementation Visual QA Checkpoint

Date: 2026-10-28
Status: IMPLEMENTATION QA — design authority unchanged; this file records observed drift in the current GitHub integration branch.

Source implementation reviewed:
- Repository: `allinproject/ALL-IN`
- Branch: `integration/native-watch-v301`
- Head observed: `0a5b8f138f41d4620fa7e5892c6183a2a5216ce6`

Design authority:
- `/ALL IN/App Art/ALL-IN-App-Art-Design-Handoff-v2.md`
- `/ALL IN/App Art/ALL-IN-UI-Component-Asset-Spec-v1.md`
- `/ALL IN/App Art/ALL-IN-Badge-System-Spec-v1.md`

## What is aligned

1. Core design tokens are correctly present in `Native/src/theme.ts`:
   - black/background `#0B0B0B`
   - surface `#151515`
   - raised surface `#1D1D1D`
   - warm white `#F7F4EC`
   - muted text `#AAA69D`
   - border `#30302E`
   - gold `#B79A57`
   - goldSoft `#D1BC86`
   - danger red `#D56F6F`
   - spacing and radius tokens also match the approved system.

2. Bottom navigation correctly exposes exactly Today / Fuel / Train / Community / Coach.
   - The existing profile route is hidden from the tab bar with `href: null`, which is acceptable because Profile is intentionally reached elsewhere.

3. The implementation already contains a shared Coach access host and centralized screen shell components, which gives App Build a useful place to fix visual drift globally rather than screen-by-screen.

## Priority visual/product drift

### P0 — Today composition is not the approved Today experience

Current implementation is a utility/dashboard shell with:
- simple `Today` title/date header
- calendar button
- Customize Today control
- training card
- three separate calorie rings
- stacked quick actions including Start Workout / Log Food / Ask Coach
- utility support cards

Required approved direction:
- cinematic mountain/sunrise hero upper area
- ALL IN 365 + `Live All In.`
- greeting/motivation
- Today/date/View Plan hierarchy
- premium Today's Training area supporting multiple workouts
- shared gold calorie tracker treatment
- Food Logged photo/meal-preview treatment
- contextual recovery when useful
- floating Coach
- no generic Coach Insight / Ask Coach tile
- no generic dashboard regression

Action:
Recompose Today using the approved shell while preserving working data/actions beneath it. Do not discard functioning Today data, layout persistence, refresh behavior, or routing merely to restyle the screen.

### P0 — Floating Coach visual identity is wrong

Current `CoachAccessHost` renders Coach as a solid-gold pill/button with a `✦` and the word `Coach`, inside a reserved bottom strip.

Approved Coach identity:
- persistent floating circular control
- warm-white `#F7F4EC` circular background
- gold Coach mark/logo
- same mark used for selected Coach tab and Coach conversation identity
- visually floats above content while respecting safe areas and critical controls
- no generic solid-gold Coach pill as the global identity

Action:
Replace the current gold pill treatment with the approved warm-white circle + gold mark. Preserve the existing persistent-thread navigation/context behavior.

### P0 — Remove redundant generic Ask Coach control from Today

Current Today quick actions include `Ask Coach`.

Approved rule:
- floating Coach is the universal generic Coach entry
- contextual Coach links are allowed only when they communicate a specific purpose

Action:
Remove the generic Today `Ask Coach` quick action once floating Coach is correctly implemented.

### P1 — Fuel hierarchy is still utility-first rather than approved Fuel composition

Current Fuel begins with `Food that fits the day.` and pushes Coach/Pantry/Shopping List into a `More food tools` disclosure, followed immediately by editable Meal Prep queue controls.

Approved Fuel direction:
- premium/cinematic Fuel identity and hierarchy
- clear Log Food primary action
- direct access to Recipes/Pantry/Shopping as approved
- shared calorie tracker
- Meals Today / View Log
- My Next Meal Prep summary
- Prepared Meals Available
- quick utilities only after the core daily food surfaces
- deeper Meal Prep editing belongs in Meal Prep, not as the dominant Fuel landing experience

Action:
Keep existing working Meal Prep queue code, but demote detailed queue editing to Meal Prep. Fuel should summarize and route rather than become the queue editor.

### P1 — Primary screen shell is too generic for hero-led approved surfaces

`NativeScreen` provides a standard eyebrow + 32px title treatment. This is useful for deep utility/detail screens, but it must not become the default composition for hero-led surfaces such as Fuel or other approved editorial/cinematic landings.

Action:
Retain `NativeScreen` for utility/detail screens. Add/reuse a hero-capable shell for approved top-level surfaces instead of forcing every screen through the same generic header pattern.

### P1 — Tab icon treatment is placeholder text, not production iconography

Current tab icons are text labels (`TODAY`, `FUEL`, `TRAIN`, `FEED`, `COACH`) rendered in the icon slot.

Approved direction:
- production icon family
- restrained warm-white/muted states
- gold selected treatment
- Coach selected state uses the canonical Coach mark treatment

Action:
Replace text-in-icon placeholders with the final icon set. Keep labels below as normal tab labels.

## QA rule going forward

App Art is now in implementation-QA mode.

For each implementation surface:
1. preserve working behavior and validated data flows;
2. compare against the approved App Art handoff + component/asset spec;
3. classify drift as P0 (identity/navigation/core composition), P1 (hierarchy/component/system consistency), or P2 (polish);
4. hand only concrete implementation changes to App Build;
5. do not reopen approved product decisions unless implementation reveals a genuine conflict.

## Current conclusion

The native implementation has the correct foundational palette/tokens and the correct five-tab navigation, but the top-level visual composition is still partially from an earlier utility-style implementation. The highest-value App Art work is therefore not new concept design; it is bringing the existing working native surfaces into the approved premium cinematic system without weakening current functionality.

> Historical note: this checkpoint records observations against V1 branch `integration/native-watch-v301` at its own 2026-10-28 HEAD. It is a source/QA reference, not evidence of V2 implementation or current V2 parity. Re-run equivalent visual QA against V2 source and current device builds.
