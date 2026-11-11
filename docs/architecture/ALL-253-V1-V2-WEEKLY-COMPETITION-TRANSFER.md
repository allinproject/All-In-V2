# ALL-253 — V1 Indoor Weekly Challenge → V2 Canonical Backend Transfer

**Status:** implementation mapping and review-only acceptance contract. Not an approved DDL migration, not a deployed competition, no publish/finalize authorization.  
**Owners:** ALL-253 Competition; ALL-222 security/ownership; ALL-246 Training; ALL-243 Completed Activity; ALL-245 device verification.  
**Evidence (2026-11-11):** read-only catalog and `pg_get_functiondef` inspected in V1 Supabase `impulecgsgaruvniuttc`; confirmed separate V2 `xarhuczrtzuiljmtdaeu` has zero challenge, attempt, leaderboard, achievement tables or related functions.

## Preserve V1 behavior without restoring V1 accounts or migrations

- Exactly one global Indoor Trainer challenge for each `America/Chicago` challenge week, scheduled Monday around 03:00 Central, including DST transition. One common authored interval structure and one designated scored effort; defensible individualized target power frozen at registration from trusted cycling capability.
- Multiple valid completed attempts per rider per week. Each attempt refers to **one distinct canonical Completed Activity**, whose Training execution (if any), imported sources, cycling power evidence and frozen prescription are separately linked. Same activity/source replay does not create a second attempt.
- One **best valid verified** weekly result per athlete; later worse attempts do not lower standing. Final ranking and Champion/Top 5/Top 10 achievements are frozen at close subject to an audited revocation/reconciliation path.
- Raw watts never determine cross-athlete rank. Manual, estimated, HR-only and unsupported power can be regular workouts but cannot become verified leaderboard evidence.
- Coach may suggest replacing a compatible planned hard ride, but must show an accepted plan-revision preview. Challenge browsing or joining does not start a session or silently alter a plan.

## Verified V1 table/function reference

| V1 object | Actual V1 shape / behavior | V2 owning integration contract |
|---|---|---|
| `public.allin_weekly_challenges` | `id`, unique `week_start`, `timezone`, `status`, template/generator/scoring/prescription versions, shared `workout_definition`, `scored_effort_definition`, `open_at`, `close_at`, publish/close/finalize timestamps | ALL-253 global immutable versioned challenge; immutable after publication |
| `public.allin_weekly_challenge_attempts` | `challenge_id`, `user_id`, unique `(challenge_id,workout_id)`, optional `training_session_id`, frozen prescription/baseline, verification class/status, source equipment, telemetry fingerprint, integrity checks, score | ALL-253 attempt; replace `workout_id` reference only with **ALL-243 approved canonical Completed Activity ID** and exact owner-link consistency; optionally bind ALL-246 session ID |
| `public.allin_weekly_challenge_leaderboard` | PK `(challenge_id,user_id)`, `best_attempt_id`, `best_score`, live/final rank and final timestamp | ALL-253 backend-maintained projection; no client write or user-submitted score |
| `public.allin_weekly_challenge_achievements` | `(challenge_id,user_id)`, tier, final rank, award and revoke metadata | ALL-253 final verified award, read by Profile/Community without duplicate award ledger |
| `allin_private.weekly_challenge_cycling_capability_snapshots` | owner, FTP watts, source, effective/expiry period, evidence/version | ALL-245 supplies trusted cycling capability, ALL-253 freezes exact snapshot used for that attempt |
| `allin_private.weekly_challenge_power_source_qualifications` | owner, equipment ID, source class, status, evidence and qualification/revocation timestamps | ALL-245 validates source/capability, ALL-253 derives eligibility; no client self-qualification |
| `allin_private.weekly_challenge_config` | private singleton with independent `generation_enabled`, `publication_enabled`, `finalization_enabled`, scoring/prescription versions | V2 private kill switches default **FALSE**, promotion only after real-device acceptance |
| `allin_private.weekly_challenge_audit` and `weekly_challenge_session_events` | append-only challenge lifecycle and session-integrity evidence | V2 private auditable action/idempotent event authority, no raw telemetry duplication |
| `allin_private.ensure_weekly_indoor_challenge` and `run_weekly_challenge_lifecycle` | DST-safe local-time server generation and transitions | service-only scheduler, explicitly gated; no exposure to app client |
| `allin_private.recompute_weekly_challenge_score`, `verify_weekly_challenge_attempt`, `review_weekly_challenge_top10` | deterministic score/verification/final integrity review | V2 private server recompute from canonical evidence; immutable scoring definition version |

V1 uniqueness observed: one `week_start` across Indoor Trainer challenges; unique `(challenge_id,workout_id)` for attempts; `(challenge_id,user_id)` leaderboard PK. Retain equivalent constraints and add explicit owner/source binding when V2 canonical activity keys are approved.

## Exact V1 challenge-score-v1 parity

Read directly from V1 `allin_private.weekly_challenge_scoring_definition_v1()` and `weekly_challenge_score_breakdown_v1()`:

- Completion: `20 * clamp(completionFraction, 0, 1)`.
- Interval execution: `30 * clamp(prescribedExecutionIndex, 0, 1)`; V1 definition specifies `toleranceFraction=0.10` and minimum telemetry coverage `0.90`.
- Scored effort: `50 * clamp(scoredEffortRelativeToFtp / 2, 0, 1)`; minimum coverage `0.95`. Uses frozen rider FTP; no raw watt comparison.
- Sum is rounded to three decimals; component values also rounded to three. Missing completion/execution inputs contribute zero; missing scored-effort is represented as null in breakdown and zero contribution (not verified eligibility).
- V1 declared ties: **score descending → scoredEffortRelativeToFtp descending → prescribedExecutionIndex descending → completedAt ascending → attemptId ascending**. Final database determinism and precision must be tested against PostgreSQL NUMERIC, not JavaScript floats.
- Source-level QA parity-only helpers: `apps/mobile-v2/src/features/training/weeklyChallengeScoringParity.ts` and `weeklyChallengeScoringParity.test.ts`. They are **not production scoring**, not a server verification substitute, and never justify awarding ranking from client-submitted scores.

## Canonical V2 mapping gates (must approve before DDL)

1. ALL-222/243 approve concrete `public.v2_completed_activities` PK, owner and source/provenance contract. One activity is the source of actual metrics; competition may store a *frozen adjudication snapshot* and a pointer, but **no duplicate Activity table, telemetry series or synthetic Cycling history**.
2. ALL-222/246 approve `v2_training_session_instances` identity and accepted revision-session/slot when a planned workout was explicitly replaced by the Weekly Challenge. Imported-only Completed Activity can be valid without fake active Training execution.
3. ALL-245 approves verified, stable power source class, actual equipment ID and source fingerprint; reject source swaps, stale capability, unknown calibration, unsupported/manual estimates and electric assistance. Actual hardware acceptance is still required for globally ranked eligibility.
4. ALL-253 owns service-only attempt registration, telemetry adjudication, versioned scoring, leaderboard refresh, final integrity review, award/revoke and deterministic cron. Authenticated user can read their own attempt and privacy-safe public leaderboard only through approved owner RLS/reader; **no direct attempt/leaderboard/achievement writes**.
5. RLS must be on for any exposed public owner/private rows; explicit grants, revoked default function EXECUTE, service-only scheduler and narrowly scoped security-definer routines with fixed search path, canonical owner/authorization checks and audit. Competing athletes' raw telemetry, FTP and health data must never be exposed by leaderboard reads.
6. Default `generation_enabled=false`, `publication_enabled=false`, `finalization_enabled=false`. No production cron, live ranking or achievements until isolated replay plus authenticated cross-owner tests, concurrent unique-week/unique-attempt tests, replay/incomplete import/edited-history tests, DST and live hardware power-qualification tests all pass.

## Engineering acceptance slices

1. **Done in V2 source:** prelaunch read guard `weeklyChallengePrelaunch.ts` + owner/time/power source tests; parity QA fixture + tie-break tests.
2. **Next:** adopt an owner-approved V2 competition ERD, write a *review-only* SQL candidate and verify with isolated Postgres, including owner/anon RLS, unique Monday challenge and source idempotency, service-only score authority.
3. Connect approved canonical Training and Completed Activity writer/reader, then verified source evidence from ALL-245, with device/offline/reconnect and import dedup.
4. Connect challenge selection (original vs Light/Recommended/Harder/Weekly Challenge), Coach preview/apply, TrainerRoad-style interval visualization, Completed Activity Leaderboard, final integrity and achievement UI.
5. Complete physical trainer acceptance and end-to-end competition QA; only then explicitly enable generation/publication/finalization after owner approval.

**Never copy V1 personal rows, replay its 938 migrations, or enable production challenge publication as a shortcut.**
