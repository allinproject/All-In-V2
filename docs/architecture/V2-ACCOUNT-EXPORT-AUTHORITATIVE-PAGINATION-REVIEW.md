# ALL-251 — Authoritative account export pagination, Stage-1 review

**Status:** Review-only implementation and disposable validation. No hosted migration, Edge activation, Storage bucket, or release approval.

## Owning workflow

This extends the **existing** ALL-251 account export request, session authorization, private archive, and Profile export. It is not a second download API or a new source of truth. The source of truth for covered `user_id` relations is still `V2-ACCOUNT-EXPORT-TRAINING-INTEGRATION-REVIEW-CANDIDATE.sql`, plus the existing Training fragment.

The review-only `V2-ACCOUNT-EXPORT-PAGINATED-READER-REVIEW-CANDIDATE.sql` asserts exact catalog equality: all **42** owner-scoped tables already allowlisted by the canonical export must exist; new ones must be reviewed. It includes `auth.users` (restricted identity fields) and four owner-visible directional Community views: outgoing follows, incoming follow requests, owner-initiated blocks and owner action receipts. Pair-CAS revisions and incoming blocks are deliberately excluded. Unknown directional Community tables fail closed even without `user_id`.

The server-only `trainingExportCanonicalPgReader.mjs` uses one dedicated **REPEATABLE READ, READ ONLY PostgreSQL transaction** for inventory and every stage-time page. No client-defined SQL, table, owner, or session is trusted. Each page invokes the existing signed-in Auth session and approved durable export request gate, and is limited to 25 rows and 1 MB. Offset cursors are currently bounded (2 million rows) and **must not be represented as unlimited-size performance guarantees**. Page boundaries are stable only while that same transaction remains open.

The existing `v2-training-account-export-worker-candidate.mjs` supports the new pinned adapter. It authorizes the owner and session, opens the pinned snapshot once for staging, then stores encrypted pages in the existing private archive. The later download reads the frozen private manifest rather than querying fresh, mutable account tables, and rechecks Auth/request authorization before each page. This prevents a new database transaction from silently changing the staged snapshot ID.

## Why the reader deliberately reports incomplete

The SQL catalog returns `complete=false`, even when all 42 tables exist and are paginatable. This is a **necessary privacy/release gate**, not a defect to bypass:

- Unresolved Community pair revision export/redaction and private third-party block decisions
- Full private Storage object **bytes**, checksum, ownership, and retention—not just SQL metadata
- Owner-controlled data from future schema domains and cross-domain media references
- Signed-in client download, server-only key-management lifecycle, restore and cancellation acceptance
- Formal all-domain privacy/legal scope approval and staging/production migration review

The runtime worker **refuses to stage a complete archive** while the canonical inventory is incomplete. Do not flip the flag solely to make CI green.

## Evidence and remaining acceptance

The first local Supabase acceptance [run #43236016844](https://github.com/allinproject/All-In-V2/actions/runs/43236016844) passed: the 42-table catalog plus five additional sources; 53 Coach messages over three owner pages; service-only permission; correct session/request; Community owner/block separation; and rollback-only fixtures. Node smoke includes registry equality against the existing snapshot source, transaction scoping, bounded page requests, failure rollback, worker staging and encrypted frozen-manifest download. The follow-up unknown-table and privacy negative tests have their own CI run.

**Still required before claiming full end-to-end archive acceptance:** independent-session mutation tests around the long-lived snapshot, populated multi-domain fixtures (not just empty tables and Coach/Goals/Community samples), approved Storage objects and KMS in staging, all-domain large history (>5 MB across actual sources), two physical devices' download/cleanup behavior, and privacy/legal approval. V2's hosted processor remains OFF. No production changes are authorized here.

## Updated owner-source verification — 2026-11-12

The existing canonical reader is **not** being replaced or duplicated. Its source registry must match the 42-user-owned-table allowlist in the ALL-251 snapshot, with five explicitly reviewed account/Community collections. Future `user_id` or directional Community tables block export until registered and privacy-reviewed.

[Disposable foundation CI #43238767766](https://github.com/allinproject/All-In-V2/actions/runs/43238767766) at `991d4376` **PASSED** the 47-source inventory, 53-record Coach pagination, and independent 32-record Completed Activity pagination under one owner/snapshot, excluding a separate athlete's records.

[Disposable foundation CI #43239503738](https://github.com/allinproject/All-In-V2/actions/runs/43239503738) at `ef1e718` **PASSED** an additional independent-PostgreSQL-session mutation regression: a concurrent append does not appear in an already-pinned REPEATABLE READ source, but is visible in a fresh snapshot after commit. A follow-up hardening waits for a PostgreSQL `PgSleep` wait event to prove the first session pinned its snapshot before the competing write, and adds per-record owner provenance assertions for all 47 collections. These last safeguards require **their own exact-commit CI pass**, not an inferred pass from the earlier runs.

**Release boundary:** The actual SQL inventory intentionally returns `complete:false` because private Storage bytes/media and Community pair-revision/third-party privacy rules are unresolved. The ALL-251 worker refuses a complete downloadable archive while that condition holds. This code validates current V2 review-candidate sources, **not yet uncreated future Nutrition, Cookbook, Progress or gear-related owner tables**. Once those schemas are introduced, add exact identities and payload/retention/Storage contracts in this same canonical owner reader. Do not enable hosted migrations, live Storage, or Edge download on the strength of these test passes.

## Stage-1 data-source reconciliation — 2026-11-12

The owner inventory must recognize alternate ownership keys (owner_id, athlete_id, actor_id, created_by_user_id), not only user_id. Review-only Billing candidates include owner-scoped checkout attempts and purchases and join-only verified events. The existing ALL-251 export candidate now proposes redacted billing projections, excluding internal provider IDs. Exact two-owner database acceptance remains required before treating this domain as validated.

Owner-visible Community relationships are outgoing follows, recipient-visible follow requests, actor-owned block decisions and action receipts. Incoming block decisions and shared pair-revision CAS state remain undisclosed pending an explicit privacy/legal owner decision. The canonical Community post ledger uses owner_id and must receive a separate owner-only data export contract before activation.

Private Storage coverage now has a server-only Training media audit using the existing evidence reader and recursive owner-scoped object listing. It verifies exact object identity, privacy, byte length, checksum and rejects unknown public or owner-unreferenced objects. That is not complete media coverage; Community photos, Nutrition photos, Progress media, and future data sources still require schema-specific contracts.

The inventory deliberately returns complete:false. No production migration, Storage bucket, Edge endpoint, key release, deletion-worker activation or live account exposure is authorized.
