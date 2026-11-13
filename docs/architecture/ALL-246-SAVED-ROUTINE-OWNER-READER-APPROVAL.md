# ALL-246 — canonical Saved Routine owner reader approval gate

**Status:** REVIEW ONLY; no V2 Routine table, deployed API, grant, migration, or hosted approval.
**Owner:** ALL-246 Training, security/DDL gate ALL-222; Completed Activity source ALL-243; account lifecycle ALL-251; Coach action governance ALL-240.
**Deployment target:** Existing canonical V2 project `xarhuczrtzuiljmtdaeu` only after release approval; never create a parallel Coach/Workout/Template database.

## Verified physical state

2026-11-13 read-only `list_tables` confirms no Saved Routine table in `public` or `allin_private`. Public tables remain Profile/Settings/Onboarding/Legal; private tables include action ledgers, provider cache and account lifecycle objects. These reads were NOT migrations or grant changes.

## Proposed Training-owned aggregate (requires ALL-222 approval BEFORE DDL)

Treat Saved Routine as a **versioned private Training template**, not an actual Completed Activity, a planned calendar session, or a Coach memory. Model:
- Stable canonical `routineId`, immutable `ownerId`, creation/update/deletion lifecycle and optional favorite metadata.
- Immutable `routineVersion` with owner-scoped ordered authored exercise/interval blocks. Exact version references survive later edits and session launches; update-original versus duplicate-as-new must be explicit.
- A resolved, typed `TrainingSport` from the shared V2 sport registry, never a caller-defined sport string.
- Blocks use authoritative exercise IDs once ALL-258 publishes them; custom exercise names must have an explicitly owned definition. Strength set prescriptions, interval phase/duration/distance/units/effort, equipment, notes and group identity are templates, NOT measured performances.
- Optional source Completed Activity ID + version only through ALL-243 owner-certified read of **prescribed pre-workout structure**; source measured data is not automatically reused as future targets.
- No independent accepted-plan/session/completion history, universal Coach writer or extra routine data store. Account deletion/export and retention must include each routine/version under ALL-251.

## Read contract already committed in mobile-v2

`routines/savedRoutineOwnerReader.ts` exposes:
1. `authenticateOwner(expectedOwnerId, sessionGeneration)`: real current-actor validation before and after I/O, not a client's claimed identity.
2. `readListPage({expectedOwnerId,sessionGeneration,cursor,limit:100})` returns account-bound summaries, unique routine IDs, immutable snapshot token, unambiguous final `hasMore=false,nextCursor=null`; page size max 100, at most 50 pages for now. Missing, changed, duplicate or looping pages are **unavailable**, never an empty account.
3. `readVersion({expectedOwnerId,sessionGeneration,routineId,version})` returns only the exact owner-certified immutable version with complete ordered blocks; a stale/deleted/revoked version is **unavailable**, never auto-upgraded to the newest revision.
4. The consumer checks exact account, session generation, routine identity/revision and structure both before presenting data and after awaited reads. The signed-in user's JWT/session and database RLS, not these UI checks, must enforce authorization.

`routines/SavedRoutineLibraryContent.tsx` supplies My Routines and exact-version review. `RoutesRoutinesContent.tsx` accepts an **optional** injected owner reader; no service is wired from `app/train.tsx` until the real endpoint has been approved and validated.

## Server authorization / privacy requirements

- Choose canonical Training table(s) and immutable child version/blocks or verified JSONB structure in ALL-222's physical ERD; prohibit conflicting duplicate aggregate stores.
- Every user-owned exposed table must enable RLS, revoke unnecessary default grants for `PUBLIC`, `anon`, `authenticated`, `service_role`; only approve explicit least-privilege authenticated **SELECT** for same-owner views. No generic client INSERT/UPDATE/DELETE and no service-role key in Expo.
- If SECURITY DEFINER is used, require reviewed narrow function owner, fixed `search_path`, explicit `auth.uid()`/expected-owner enforcement, PUBLIC EXECUTE revoke, exact role grants and RLS-bypass review. Prefer secure invoker patterns where possible.
- Implement a stable snapshot/page token, bounded cursor, exact version semantics and authoritative evidence of pagination completeness. Never certify a partial result as an empty library.
- End-to-end prove User A can list/open own routines and User B cannot list, guess IDs, open by version or infer existence; verify anon, revoked session, account switch mid-request, repeated/invalid cursor, race between edit and read, stale version, soft-delete, partial network, export/deletion, and restored versions.
- Approved writer must enforce expected owner/revision, action/idempotency key, same-owner typed references and explicit user intent, with no silent overwrite of accepted Training or canonical activity.

## Release prerequisites / actual next changes

1. ALL-222/246 approve aggregate/table, server reader/writer auth shape, RLS/grants and migration ordering, including ALL-251 export/deletion. No SQL execution is implied by this document.
2. Author canonical versioned Training migration and narrow read endpoints within that architecture; test local isolated Postgres with real roles/JWT and two real users. No authenticated access on an unreviewed endpoint.
3. Plug approved service implementation into `RoutesRoutinesContent` via Train only after passing denial tests; compile and run Training tests, typecheck and installed-device acceptance; verify account-switch cancels in-flight reads.
4. Connect versioned writer, saved-routine review, Start Workout to **existing** ALL-246 session lifecycle; Coach suggestions remain optional proposal-only under ALL-240.

**Current milestone:** UI/adapter and unit test source authored, not yet executed; hosted Saved Routine read unavailable.
