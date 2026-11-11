# ALL-263 — V2 Tutorial Rebuild Inventory and Migration Gates

Status: inventory and sequencing only; **no tutorials shipped or considered V2 validated**. Source comparison: V1 `allinproject/ALL-IN` `integration/native-watch-v301`, V2 `allinproject/All-In-V2` `integration/v2-foundation`, reviewed 2026-11-10.

## Inventory: V1 feature tutorial IDs → V2 owner

V1 canonical ten IDs are defined in `Native/src/data/featureTutorialClient.ts` and displayed by `Native/src/app/profile/tutorials.tsx`. The guided app tour is separate (V1 Help describes a 13-step tour). Do not copy their V1 route paths, status model or remote procedure calls into V2 without verifying V2 ownership.

| V1 ID / tour | V2 tutorial destination / scope | Migration decision | Readiness gate |
| --- | --- | --- | --- |
| First-run app tour (13 steps in V1) | V2 onboarding → Today, cross-workspace orientation | **Rewrite** and replay from V2 Help | Actual post-onboarding routes and controls; no placeholder claims |
| `food-nutrition` | Fuel, Nutrition, Food Log, Cookbook, Pantry, Shopping, Meal Plan, Meal Prep, Prepared Meals, Cook Now | **Split/rewrite** into manageable real-world tasks | ALL-218/225/228/229/248 and live Fuel surfaces |
| `community-racehub` | Community, EventHub, discovery, events, visibility | **Rewrite**; EventHub naming supersedes old RaceHub-specific V1 routes | ALL-244 canonical Community/EventHub |
| `progress` | Progress overview, goals, sport-specific trends, PRs, Recovery context | **Rewrite** | ALL-249; real historical data and analyses |
| `profile-settings` | Profile and Account; Sports & Interests, Weekly Routine, Kitchen, Coach Preferences, What Coach Knows, notifications, privacy, connections | **Rewrite** reflecting approved Profile placement | ALL-251/254 and individual saved working screens |
| `analytics-layouts` | Profile → Analytics Layouts only, when implemented | **Rewrite** and check actual supported metrics/screens | V2 analytics layout support, no borrowed V1 deep links |
| `training-lifecycle` | Today → Train Calendar → launch → active session → finished activity | **Rewrite** by actual sport, may split into subguides | ALL-246; real finish/cancel lifecycle |
| `voice-commands` | Profile → Help → supported Siri/voice functions | **Conditional rewrite**; hide if no supported commands | Actual V2 App Intents/device capability verification |
| `strength-logging` | Strength workout launch/log/edit/finish/cancel/resume | **Rewrite** | ALL-258 and executable V2 logging |
| `watch-training` | Phone/Watch preparation, start/pause/finish, disconnected recovery | **Conditional rewrite**; no simulated Watch claims | Native Watch integration and device acceptance |
| `gear-tracking` | Profile → Gear: shoes, bikes, defaults, activity assignment | **Rewrite** | Real V2 Gear inventory and ownership |

## Added V2 tutorial gaps (not V1 catalog IDs)

- Coach: one persistent conversation, what context Coach knows, authorized proposals, explicit action approvals, learning correction/forget, and Coach Preferences consumption (ALL-210/217/240/241).
- Weekly Routine: recurring preferences versus dated Training/Shopping/Meal Prep events; opt-in reminders and suppression (ALL-237/248/251/254).
- Kitchen: home/work equipment, Coach-learned explicit equipment corrections, feasible Cook Now and Meal Prep instructions.
- Recovery: recovery guidance, activity context and user controls.
- Food outcomes: Meal Prep batch/yield, safe Pantry deductions, Prepared Meals and logging once.
- Account safety: privacy, optional integrations and permission prompts.
- Today and Daily Extended: actual navigation and contextual due actions.

## Verified current V2 boundary

- The V2 route tree has `/onboarding-required`, `/profile`, `/profile/sports`, `/profile/kitchen`, `/profile/coach-preferences`, `/profile/edit`, and `/train` among its current screens.
- V2 `app/onboarding-required.tsx` has six preference-oriented onboarding steps: focus, training pattern, availability, Coach, food safety and proactivity. This is **not** the V1 13-step guided app tour.
- V2 `src/navigation/V2WorkspaceEntry.tsx` explicitly marks Fuel, Community and Coach as workspaces without connected features. **Do not provide interactive tutorials for these placeholders.**
- V2 has no `/profile/tutorials` route, V2 tutorial host, or V2 tutorial persistence in the inspected tree. V1 `allin_my_profile_state`, `allin_patch_profile_settings_section`, `progress_preferences.feature_tutorials` must not be blindly transplanted.

## Work sequence / gates

1. Keep this catalog authoritative for V2 tutorial migration. Update entries as domain screens change.
2. Design the smallest Help / Tutorials shell and a *versioned* tutorial manifest referencing **actual V2 route and UI anchor IDs**; show only implemented and validated entries. Missing features are marked upcoming internally, never presented as usable controls.
3. Build the reusable accessible tour runtime: Back, Next, Skip, Exit and replay; no automatic writes to domain data; account/session isolation; clean interruption handling; no duplicated navigation source of truth.
4. Port each workflow **after** the owning screen and actions are integrated. Each step is exercised against the actual screen on device, including adverse states and back/exit.
5. Track per-tutorial phases: inventoried → drafted → coded → integrated → device-validated. Only the final phase permits release-facing claims.
6. UI code revisions affecting a route, anchor or behavior invalidate/review relevant tutorials before release (coordinate ALL-254).

Do not confuse tutorial progress state with Coach learning or app onboarding completion. If tutorial progress is eventually persisted, use a reviewed V2 owner-guarded versioned settings/domain contract instead of creating a parallel onboarding state.

## Non-goals for this inventory slice

No UI buttons, tutorials, progress mutations, backend migrations, or tests were added by this document. It deliberately avoids claiming first-run or feature tutorials work in current V2.
