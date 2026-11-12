# ALL-251 — Hosted staging acceptance for complete private export

**Current status (2026-11-12):** The founder approved and created a separate temporary Supabase staging project. Initial private-bucket provisioning and database-role isolation checks passed; full real-media/authenticated-Edge/KMS/device acceptance is still open. This is a review runbook, **not** production deployment or legal approval.

## Existing source of truth

Extend only the existing ALL-251 export request/authorization, PostgreSQL pinned canonical reader, `trainingExportPrivateMediaPages.mjs`, encrypted archive persistence, authenticated download handler and Profile download verifier. Never create a separate account export store or a public Storage link.

Current canonical source inventory reports **`complete=false`**. It must remain false until every reviewed user-owned domain, all private media and approved Community export semantics are recorded and verified. Synthetic CI uses `complete=true` only to exercise the staging transport.

## Staging prerequisites

1. Explicit approval for a **separate** Supabase project, including owner, region, costs, permitted synthetic data, least-privilege credentials and retention. Verify it is NOT V1 `impulecgsgaruvniuttc` or live V2 `xarhuczrtzuiljmtdaeu`.
2. Review exact ordered migrations, private Storage bucket policies, Auth/service grants and server-only encryption key-provider lifecycle; do not enable destructive deletion.
3. Create synthetic A/B accounts with independent active Auth sessions, a revoked session, and overlapping follow/block edges. Populate Training/Coach/EventHub/Billing plus relevant Food/Fuel/Progress domains **only as their canonical owner schemas become approved**. Avoid importing real personal data.
4. Stage private source objects: ready activity time-series and routes, cross-owner object names, missing/changed bytes, unknown media/photo bucket, duplicate path, >limit object, request cancellation and checksum-corrupted source.
5. Stage one encrypted account archive with all approved source pages, explicitly classified `private_media` binary chunks, private archive manifest, KMS-bound key and per-page integrity receipts. Confirm no public URL/service key leaks.
6. Download through actual authenticated Edge endpoint on both user sessions, then deny B reading A; deny expired/revoked requests, account switch and interrupted downloads. Validate the final digest and reconstruct each media file **byte-for-byte** on iOS and Android.
7. Prove purge of expired/cancelled archives via the Storage API, durable purge audit, orphan detection and retry alerts. Exercise synthetic account deletion with backup/PITR restore and verify no remaining source bytes.
8. Sign off Community pair-CAS privacy proposal, retention/legal-hold treatment, and actual release wording. Only then consider changing canonical `complete`, migration approval, or download availability.

## Implemented isolated acceptance

- The canonical reader and full disposable PostgreSQL replay cover owner/session isolation and snapshot consistency.
- `trainingExportPrivateMediaPages.node.test.mjs` checks bounded media-byte encryption and reconstruction, tampering, unreviewed paths and cross-owner access.
- `scripts/test-v2-account-export-real-local-storage.mjs` exercises actual **localhost** Supabase Storage API buckets, anonymous read denial, PostgreSQL catalog inventory, encrypted archive readback and cleanup in CI. It explicitly refuses non-loopback URLs.
- `docs/architecture/V2-ACCOUNT-EXPORT-COMMUNITY-RETENTION-POLICY-REVIEW.md` records the proposed minimum-disclosure policy and outstanding legal retention decision.

These are not a substitute for the independently approved **hosted** staging and native-device acceptance. Never describe review-only file handling as a shipped feature.

## Temporary hosted staging — verified baseline (2026-11-12)

- **Isolated target:** `All-In-V2-Temporary-Staging` (`fbtgknlxjyeqrxemskbl`), Longrunlog, us-east-1, ACTIVE_HEALTHY at review time. Supabase quoted an additional **$10/month**. **Never** use live V2 `xarhuczrtzuiljmtdaeu` or V1 `impulecgsgaruvniuttc` as a test target.
- **Approved temporary migration already applied ONLY to this staging project:** `all251_temporary_staging_private_buckets_no_client_policies`. Exactly two private `storage.buckets` records, `v2-private-workout-objects` and `v2-private-account-exports`, `public=false`, MIME `application/octet-stream`, 16 MiB per object. No additional Storage object access policies were granted.
- **Live staging PostgreSQL readback:** `anon` and `authenticated` roles each saw **zero** private buckets and zero objects under RLS. `service_role` saw **exactly two private buckets**. This checks metadata isolation, NOT a network-level byte upload/download or real Auth bearer session.
- **Existing staging state:** no user accounts or deployed Edge Functions at initial baseline. Do not claim cross-owner production Auth, Stage KMS, device file-save, or hosted binary readback acceptance from this configuration-only proof.
- **Deletion safeguard:** An enabled one-time reminder for 2026-11-13, 10:14 AM America/Chicago, automation `Automation_fdfda9a82d9c81919613bb5d53d1c48a`, names **only** staging `fbtgknlxjyeqrxemskbl`. The connected Supabase tool **does not expose project deletion**. A human must delete the temporary project using the Supabase dashboard; verify deletion before claiming billing has stopped.
- **Next execution:** Bind the server-side authenticated service client, a real key provider and approved complete source inventory; then test actual hosted file bytes, owner A/B sessions, revoked session, encrypted download, tampering, expiry, retention, PITR and iOS/Android download/share as outlined above. Never switch the canonical `complete=false` flag or grant production permissions until these pass.

