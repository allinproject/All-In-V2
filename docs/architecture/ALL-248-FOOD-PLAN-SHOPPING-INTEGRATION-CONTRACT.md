# ALL-248 — Food Plan → Pantry → Shopping → Meal Prep → Food Log

**Status:** founder-approved behavior, partially implemented pure mobile projection; **not** an installed Meal Plan or Shopping backend.  
**Canonical owner:** ALL-248 Kitchen; actual consumed Food Log remains ALL-247; source recipe/ingredient identities remain ALL-218/228; security/data ownership ALL-222.  
**Source of behavioral authority:** November V1 `Native/src/app/meal-plan.tsx`, `weeklyMealPlanClient.ts`, `weeklyMealPlanShoppingProjection.ts`, `meal-prep.tsx`, plus ALL-55/189/190 and founder November 12 instructions.

## Athlete journey

1. **Cook Now** on Recipe Details prepares **one serving to eat now**, never a multi-serving Meal Prep entry. Ingredient actual-use review must not corrupt scheduled reservations or silently record consumption.
2. **Add to Plan** navigates to the one Food Plan, where an athlete chooses each eating date and meal slot. A single recipe may appear on six days; each occurrence is one intended serving. Separate canonical foods (banana/apple/identified protein bar), saved Food, prepared meals and recipes all participate, and more than one food can occupy a slot.
3. Saving a plan creates *intent*, **not** a Food Log, physical purchase, Pantry deduction or Meal Prep completion. Calendar changes recalculate the attributable Shopping demand and release no-longer-needed reservations via the owning writer.
4. Ingredient-demand inputs are exact reviewed per-serving recipe lines or canonical individual-food portions. Quantity is multiplied by planned occurrences; already verified ready Prepared Meal coverage reduces fresh cooking need. Food identities include state and unit: cooked rice is not dry rice; a banana is not an apple; brand-specific bars cannot be silently substituted.
5. Respect already reserved Pantry stock and only project genuinely available compatible lots. Unknown identity, package serving, unit, raw→cooked yield or availability requires review, **not a fabricated number, zero, or a guess**. Aggregate the same ingredient across all eligible planned occurrences.
6. Only missing quantities contribute to the single canonical Shopping List, alongside user-added items; retain source occurrence IDs. Ingredient trim buffers, exact package-rounding, manual extras and mutation lifecycle are handled downstream by the existing ALL-248 Shopping owner, not the pure projection. Shopping checkbox means *in cart*, not purchased. Reviewed Checkout/receipt and explicit Add Purchases to Pantry update inventory.
7. Food Plan includes a **Start Meal Prep** entry to its **separate** multi-recipe workspace. Six planned occurrences of one recipe yield six portions needing cooking, less genuine prepared coverage. The session uses recipe-authored quantities and generates adapted step-by-step instructions and equipment-aware timing; it does not simply repeat the one-serving directions six times. Start/Resume on Today is linked to an actual scheduled or active session. A preferred prep weekday in Profile can suggest scheduling but is not evidence that a session exists.
8. Finishing Meal Prep reviews actual ingredients/portions, deducts only confirmed Pantry usage, creates ready Prepared Meals and releases unused reservations. Consumption and logging remain separate. `Siri, log my lunch` resolves all canonical foods/recipes/available prepared items scheduled for that specific local day and slot, obtains explicit review/voice confirmation where permitted, then invokes the **same** idempotent Food Log and prepared-inventory writers. Repeats must not double-log or double-deduct. `Mark lunch complete` is a distinct Plan-only action.
9. Teach the five-step user journey in the dedicated V2 tutorial, with replay under Help. First-run tutorial must use real screens and no fake success states; don't expand the tutorial until owning screens are integrated.

## Implemented source slice (read-only)

- `apps/mobile-v2/app/fuel.tsx`: existing authenticated Fuel route with Food Log | Recipes | Food Plan, nested Plan | Shopping | Pantry. Data-not-connected panels are deliberate—not fake empty inventory.
- `apps/mobile-v2/src/features/kitchen/foodPlanShoppingProjection.ts`: pure projection over already reviewed canonical plan occurrences, exact food/ingredient quantities, verified prepared coverage and compatible Pantry lots. Returns provenance/need/shortage/unresolved. No DB schema or writer, no estimated nutrition, no inventory mutations, no package assumptions.
- `apps/mobile-v2/src/features/kitchen/foodPlanShoppingProjection.test.ts`: seven focused regressions, invoked in the existing `test:calculator` npm script; a change to `src/features/kitchen/**` triggers existing no-deploy smoke workflow.
- `apps/mobile-v2/src/features/fuel/`: existing guarded owner-scoped food reader/writer and manual diary UI; not to be duplicated or prematurely activated.

## Canonical integration gates not yet satisfied

1. Under ALL-222/248, settle a single physical owner schema and typed owner-guarded read + versioned/idempotent plan writer for day/slot/source occurrence identities. No generic meal-plan JSON blob and no duplicate store. Integrate with ALL-228/218 canonical food and recipe identities.
2. Pantry owner reader returns lots with usable quantity, reserved quantity, raw/cooked/preparation state and compatible unit; reviewed purchase writer and Shopping provenance writer join the same inventory/plan transaction boundary. Handle simultaneous plan edits, buying and cooking without stealing other reservations.
3. Canonical Shopping projection must resolve raw/cooked yield using reviewed ALL-229 evidence and only then run actual trim allowances/package rounding, stock reservations and provenance-aware change updates; protect manual Shopping extras.
4. Privacy/export/deletion registration, RLS, cross-owner denial, two-account tests, time-zone/day contract, exact-retry, conflicting-version/CAS, partial/unavailable data, no double deduction and signed device validation required before live activation.
5. No live Supabase deployment or data mutation was authorized by this document. The V2 database inspection on November 12 did not locate Kitchen tables/RPCs in public or allin_private; refresh current live state before any schema work, especially if another concurrent workstream has deployed new objects.

**Quality gate:** source tests passing does not imply UI, live RPC, or physical-device acceptance. Only founder-approved functional exceptions may remove V1 capabilities from the V2 parity matrix (ALL-270).
