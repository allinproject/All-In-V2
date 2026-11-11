# ALL-250 — Today & Global Navigation acceptance checklist

**Status:** implementation in progress; **not** accepted for beta/release.
**Authority:** `allinproject/All-In-V2` `integration/v2-foundation`, Linear ALL-250.
**Scope:** the existing authenticated `/home` Today, shared five-tab navigation and canonical owner read projections. No duplicate Today workout/food/recovery writer.

## Founder-approved display contract

1. Today's **Training is first**. When the canonical planned session identity and pre-start owner route exist, tapping it goes straight to the correct pre-start experience. Until then, the currently mounted hero opens the exact athlete-local day in Train's calendar. Do not fabricate rest, missed or completed sessions.
2. **Daily Extended is second**: burned, eaten, left to eat. An explicit `View more` carries the exact date and the `daily` section intent to the existing Fuel workspace. Do not recalculate Fuel's remaining total from incomplete records or display unavailable values as zero.
3. **Food Log is third**, subordinate in size to Training and calorie summary. Up to **four small square, equal-width food photos left-to-right**, with concise labels, no wrapping into a second row; max 88px per tile, responsive fit on narrow phones, and a count for remaining entries. Each photo/fallback links to the same day's Food Log; `View log` does likewise. Missing verified photos get labelled placeholders, never invented imagery.
4. **Progress is fourth**, contextual to the athlete's selected sports/goals, not runner-only. Source-backed PRs and performance trends only when the Progress owner verifies coverage.
5. **Recovery is fifth**, current personalized recovery context only when Recovery owner supplies it. Never invent readiness, diagnosis, or stretch recommendations.
6. **Meal Prep / Cook Now** are contextual, not a permanent sixth section. Display only verified due items from the canonical Kitchen owner, and never imply a cooking action happened without that owner's write/readback.
7. Weather belongs in the **top-right** of Today, but must remain explicitly unavailable until the weather/location source is approved. Profile/settings remains accessible.
8. Approved styling: near-black, white/warm off-white, muted gold; five bottom tabs (Today, Fuel, Train, Community, Coach). No extra nav tab or shadow data store.

## Safety and data checks

- Authenticated screen is keyed by account identity and session generation. Legal/onboarding access gates remain.
- Every source read is owned and date-scoped, with `unavailable/loading/error` distinct from a **verified empty** set.
- Cross-owner, out-of-day, malformed, duplicate or stale evidence cannot appear in Today.
- Date-only navigation survives tab focus, background/foreground, and midnight while screen remains open. Device-local day is a **fallback**; athlete-timezone authority is not implemented or approved yet.
- Food photo URLs must come from verified canonical media evidence; do not manufacture image links. Test signed URL expiration/security before live integration.
- No potentially destructive actions, workout completion writes, nutrition logs or kitchen state writes originate in these read-only cards.

## Test and acceptance matrix

| Scenario | Expected result | Evidence |
|---|---|---|
| Cold start, signed out / pending legal or onboarding | Existing auth redirects, no private data | Existing auth-route tests; device acceptance pending |
| Open Today with no canonical readers | Explicitly unavailable, not zero or rest | Static wiring checks; device pending |
| Foreground after crossing midnight | Exact local day updated | `todayEntry.test.ts` focused cases; device pending |
| Leave Today open past midnight | Timer advances day; foreground listener repairs suspended timers | `todayEntry.test.ts` duration cases; device pending |
| DST or local clock shift | Tomorrow derived from calendar date, not fixed 24h | Pure helper tests; timezone/device pending |
| Planned run plus independently completed ride | Both represented without conflating | `todayTrainingCard.test.ts` |
| Linked completion and explicit rest | No duplicate planned workout; rest only explicit | `todayTrainingCard.test.ts` |
| Daily energy partial/wrong owner/stale | No misleading zero or stale metrics | `todayEnergyGlance.test.ts` |
| Four logged foods on narrow device | Exactly one compact picture row | `todayNavigationWiring.test.mjs`; rendered-device pending |
| Photo missing or invalid media | Labelled fallback; no fabricated image | `todayFoodLog.test.ts` |
| Tap any food tile or View Log | Exact date plus `section=food-log` | `todayNavigationWiring.test.mjs` |
| Tap Daily Extended View more | Exact date plus `section=daily` | `todayFuelNavigation.test.ts` |
| Progress or Recovery stale/another owner | Hide unverifiable data | `todayWellnessGlances.test.ts` |
| Kitchen reminder due/completed/unknown | Only explicitly due verified item shown | `todayKitchenDue.test.ts` |
| VoiceOver / TalkBack | Five section headings, labelled tiles, accessible links | Static checks; installed device pending |

## Remaining genuine blockers

- **Canonical Training and Completed Activity reads** in V2, including accepted plan identity and correct pre-start routing.
- **Canonical Fuel daily totals and Food Log/media** read APIs, and actual Daily Extended/Food Log detail UI replacing the current contextual Fuel shell.
- **Progress, Recovery and Kitchen owner read APIs** with explicit freshness/version/owner guarantees.
- Athlete-selected timezone authority (if/when approved in the existing profile preferences owner), weather source and location consent, and domain-specific source coverage.
- Real `npm`/TypeScript/Expo suite, mounted screen tests, narrow-iPhone and accessibility test, founder visual approval. Isolated JS source-level tests **are not** a substitute.
- No deployment, external signup opening or release gate change by this document.

Keep ALL-250 **In Progress** until all acceptance criteria are evidenced. Other chats own Coach/ALL-210 and other domain backend work; integrate approved contracts rather than duplicating them.
