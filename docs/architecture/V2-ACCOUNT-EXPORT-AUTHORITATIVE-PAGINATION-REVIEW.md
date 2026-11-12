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
