# ALL-251 — Privileged Storage credential and upload-route acceptance

Status: **NOT ACCEPTED.** Review / staging evidence only. The operational
account-deletion worker and complete-account export must remain disabled.

## Authoritative evidence

- Hosted synthetic two-account run:
  [ALL-251 run 43427895858](https://github.com/allinproject/All-In-V2/actions/runs/43427895858).
  Controlled lease-first POST, PUT replacement, byte SHA-256 readback,
  pending-upload deletion fence, and other-owner independence **passed**.
  Raw `sb_secret_` Storage POST succeeded **after** owner's deletion request.
  Therefore the exclusive privileged writer guarantee **failed**.
- Cleanup verified independently: no remaining synthetic Auth users, Storage
  objects, deletion requests, or upload leases in temporary staging after run.
- Supabase security contract: `service_role`/secret keys bypass Storage RLS.
  New secret keys may be separated per service for rotation, but **each retains
  full service-role authority**; extra keys do not create bucket-level scopes.
  See https://supabase.com/docs/guides/getting-started/api-keys and
  https://supabase.com/docs/guides/storage/security/access-control
- Supabase-generated S3 access key pairs bypass Storage RLS; user JWT S3 session
  tokens use Storage RLS instead.
  See https://supabase.com/docs/guides/storage/s3/authentication
- Signed upload URLs cannot be revoked individually. Revoke an old signing key
  to invalidate its URLs; Auth key rotation is not enough.
  See https://supabase.com/docs/guides/storage/security/signing-keys
- TUS resumable upload URLs can remain valid up to 24 hours and upload
  completion can occur after initiation. Do not treat preflight or a deleted
  client session as evidence that all in-flight uploads are finished.
  See https://supabase.com/docs/guides/storage/uploads/resumable-uploads
- Supabase recommends treating the internal `storage` schema as read-only.
  Do **not** add unsupported mutation triggers there to override provider
  behavior. See https://supabase.com/docs/guides/storage/schema/design

## Route inventory and required control

| Route / credential | Known owning surface | Current evidence | Release requirement |
| --- | --- | --- | --- |
| Application upload, replacement | `v2-private-storage-writer` Edge shell, `trainingPrivilegedStorageWriter.mjs` | Server-side lease, privileged bytes readback and settlement passed staging; Edge writer is default OFF | Keep exactly scoped owner/bucket/path, live JWT, no key in clients; enable only after exclusive credential custody and full race acceptance |
| Private encrypted export archive/page writes | Existing `trainingExportSupabaseArchive.mjs`, `trainingPrivilegedAccountExportBarrier.mjs` | Reuses canonical writer; local tests, no production acceptance | Do not allow old direct upload callback or a second writer on deployment; require approved export-request/session |
| Direct Storage REST with project secret/service-role key | Project's privileged API; GitHub temporary test harness | **Confirmed bypass** of deletion lease after pending deletion | Remove all untrusted holders and alternate direct upload workflows; rotate/revoke credentials no longer needed; independently test remaining custodians. No SQL/RLS-only fix |
| Other Edge functions using elevated key | Coach, billing, device, Stripe and other server functions; inspect live deployment and their complete dependency graphs | Several entrypoints read `SUPABASE_SERVICE_ROLE_KEY`; current runtime source inventory does not demonstrate full deployed key isolation | Migrate to user-scoped/least-privilege APIs where possible, otherwise document explicit trusted purpose. Audit deployed bundles and prevent arbitrary Storage API calls |
| Protected GitHub staging jobs | `v2-all251-temporary-auth-smoke.yml`, `v2-all251-temporary-hosted-storage.yml`, `v2-all251-hosted-privileged-writer.yml` | Staging secret is referenced by these workflows; bypass probe restricted to manual + protected environment | Restrict environment approvals, audit and remove unused secrets after testing, no scheduled or automatic raw-bypass probes |
| Native mobile, web clients, untrusted external tools | Publishable Auth JWT expected | No approved client direct private Storage upload path | Never ship secret/service-role/S3 keys; do not mint signed upload tokens until their deletion-state completion fence is accepted |
| Generated privileged S3 access keys / presigned S3 operations | Supabase Storage dashboard, external S3 tools, CI and operator credentials | **NOT INSPECTABLE** through available project read-only SQL/source; no proof keys absent | Operator audits dashboard, lists/revokes unused key pairs, validates enabled protocol and all external holders. Disable unrestricted S3 access when unnecessary |
| User-scoped S3 session token | S3 API with user JWT | RLS-scoped in documented model; no V2 accepted writer | Forbid pending-deletion writes through approved RLS and upload lifecycle. Test S3 multipart begin/complete and delayed completion before accepting |
| Signed uploads, signed URL minting | Storage signing key and server/user API | No accepted V2 minting pathway; previously issued URLs cannot be inferred from source | No issuance in production until bounded durable lease and completion tracking; inventory outstanding tokens; rotate/revoke signing key if untrusted outstanding URLs exist |
| TUS resumable, SDK upsert, multi-part finalization | Storage `/upload/resumable`, signed TUS and direct upload hostname | Not yet tested on hosted V2 | No issuance or resumption unless authenticated scoped upload and authoritative completion/lease fencing proven. Ensure stale pending uploads cannot recreate deleted bytes |
| Studio/CLI/admin/manual Storage writes | Supabase administrators and support/automation accounts | Credential holders and permissions outside current connector visibility | Inventory authorized operators/PATs, remove unused credentials, require change control and explicit incident/test exception |

## Source inventory versus credential custody

The repository's
`scripts/test-all251-runtime-storage-writer-inventory.mjs` fails CI if a new
runtime Storage REST, direct upload, signed upload, S3 or TUS write pattern is
introduced without a reviewed canonical writer. Source scanning is a guard
against accidental introduction, **not** evidence that service-role credentials
or external API clients have been revoked or cannot bypass the app.

Temporary staging has a separate protected GitHub environment and synthetic
users only. It must never use live V1/V2 production service keys. The dedicated
direct-privileged bypass workflow is manual-only.

## Required acceptance before any deletion-worker activation

1. Prove **all** service-role/secret credentials, S3 keypairs, signing-key
   holders, external workers, GitHub Actions secrets, Studio/CLI operators
   and deployed Edge function integrations have been inventoried. Record
   owner, purpose, reach, last use, and rotation/revocation decision in a
   restricted credential register; never store key material in Git/Linear.
2. Restrict privileged Storage write capability to the canonical trusted
   writer's custody. Other backends should use user-scoped JWT/RLS where
   possible. **Multiple Supabase secret keys remain equally privileged** and
   cannot, alone, prove exclusivity.
3. Explicitly deny unapproved signed upload URL issuance, direct S3 use and
   resumable/multipart completion. Audit/revoke old signing keys if issued
   URLs might remain live. No upload lease may auto-expire after a timeout.
4. Rerun real two-user hosted HTTP acceptance with a pending account deletion:
   controlled A writes denied, B writes continue, raw privileged REST, S3,
   signed and resumable bypass probes **all** denied by enforceable
   authorization, late completion rejected, and all synthetic objects and
   identities removed with independently verified byte absence.
5. Approve the release only after the operational readiness function obtains
   durable provider-level evidence of complete private Storage and upload
   barrier enforcement. Until then it must return
   `completePrivateStorage=false`, `uploadBarrierEnforced=false` and the
   operational worker must be disabled.

## 2026-11-13 — Why the metadata fence does not prove the trusted writer

**Fail-closed release finding, supported by hosted schema inspection.** Temporary
staging now has a `BEFORE INSERT / UPDATE` Storage object **metadata** trigger
requiring an owner-scoped open write lease. That can reject unleased metadata
writes, but does **not** guarantee only the approved application writer can
upload. The existing `v2_begin_privileged_storage_write_review` and settle
RPCs grant execution to `service_role` and require **no independent
writer-held cryptographic proof**. Anyone possessing an unrestricted project
secret could request their own matching lease and directly call Storage, then
settle without performing the canonical writer's content readback.

This is not hypothetical authorization proof: the SQL contracts visibly grant
that ability. We have **not** exercised a forged-lease hosted upload and are
not claiming one succeeded. A service role with the key also has unrelated
broad Auth/Data API authority, so isolating just the UI workflow is
insufficient. Supabase recommends treating its internal `storage` schema as
read-only; the staging review-only metadata trigger is not an approved,
vendor-supported universal object-byte barrier.

**Required remedies and explicit trust model:**

1. **Preferred for strict exclusivity:** keep protected private file bytes in
   a **separate provider credential/security boundary** whose privileged
   credentials are held only by the existing canonical write/cleanup service.
   All other V2 service-role keys must be incapable of reaching that provider.
   Reuse the canonical owner/delete/lease/checkpoint system and adapt only its
   Storage transport; do not duplicate ownership or account deletion. This
   needs founder approval for cost, recovery, operations and migration before
   creating a new project or bucket.
2. **Same-project defense in depth, not a replacement for (1):** add a
   writer-only independently provisioned attestation secret or signing key
   inaccessible to `service_role` callers. The canonical begin/settle RPCs
   should verify owner/bucket/path/operation/one-time nonce/short validity and
   bound byte digest (including settlement), reject replay, revoke or replace
   the old un-attested RPC signatures, and ensure the privileged writer alone
   holds attestation material. The private database secret/key verifier must
   not be readable via exposed Data API schemas or untrusted functions.
   Still test raw HTTP, privileged REST and signed/S3/TUS completion because
   authorization at metadata insert is not equivalent to authority over
   underlying provider bytes.
3. **No premature pass:** A successful local SQL metadata trigger test is
   insufficient. Prove with genuine hosted two-owner credentials that direct
   privileged upload attempts cannot mint a lease, complete a signed/resumable
   upload, overwrite a deleted object, or settle another writer's lease,
   while authorized writes and complete byte cleanup still pass. All external
   secrets, service-role holders, signing URLs and S3 credentials must be
   reviewed and outstanding writes drained. If any credential or upload
   protocol bypass remains, keep `uploadBarrierEnforced=false` and account
   deletion disabled.

### Architecture decision still required

Supabase master keys are intentionally unrestricted within a project. If the
product requires a **provider-enforced guarantee** that even another privileged
credential cannot upload after account deletion starts, a single shared
project-wide secret with RLS is insufficient. Evaluate isolating private
Storage behind a separate, controlled credential boundary/provider or using
an authenticated scoped Storage design plus custody controls. Do **not**
introduce a second source of truth or deploy a new project without an approved
architecture/recovery/cost decision.

## 2026-11-13 credential audit — observed inventory and disposition

Audited **temporary staging only** (`fbtgknlxjyeqrxemskbl`) through current
connected project metadata, publishable-key listings, Edge deployment source,
24-hour Storage operation logs, repository workflows and security advisors.
No private credential material is recorded here.

| Credential / route | Observed evidence | Disposition / next proof |
| --- | --- | --- |
| Modern publishable keys | Two enabled entries: `default` and `all251_temp_staging_publishable_key` | **KEEP pending usage verification**; public keys do not themselves bypass RLS; removal is unrelated to privileged upload isolation |
| Legacy anon key | One enabled legacy `anon` API key | **KEEP pending compatibility audit**; it is not a privileged upload credential |
| Staging modern secret key | `ALL251_TEMP_STAGING_SECRET_KEY` is referenced by exactly three reviewed staging GitHub workflows | **KEEP for the current protected acceptance workflow** until a replacement test mechanism exists; credential value, full key-list, holder count and revocation status are unavailable through connected actions |
| GitHub `v2-all251-temporary-auth-smoke.yml` | Protected `all251-temporary-staging` environment; push and manual trigger | **RETAIN** as currently used by staging testing; review whether automatic privileged test coverage is still required before disabling |
| GitHub `v2-all251-temporary-hosted-storage.yml` | Protected staging environment, manual trigger | **RETAIN** while hosted Storage acceptance is in progress |
| GitHub `v2-all251-hosted-privileged-writer.yml` | Protected staging environment, **manual-only** direct bypass probe | **RETAIN disabled from push** until negative bypass tests have been superseded; do not run casually |
| Deployed `v2-coach` Edge function (v2) | Active, `verify_jwt=true`; deployed source references `SUPABASE_SERVICE_ROLE_KEY`, no direct Storage upload observed in inspected source | **PRESERVE**; audit actual credential custody and replace elevated access where possible before any rotation |
| Deployed `v2-account-export-download` Edge function (v5) | Active, `verify_jwt=true`; no direct Storage writer observed | **PRESERVE**; this is a read/download flow, not evidence of unrestricted upload |
| `v2-private-storage-writer` Edge function | Not deployed in inspected staging | **KEEP OFF** until exclusive credential scope and hosted race tests pass |
| Generated S3 access key pairs | Key-pair inventory/permissions not returned by connected Supabase actions | **UNKNOWN — DO NOT CLAIM DISABLED**; owner must review Storage S3 credentials and revoke only unused keys once holders are reconciled |
| Storage signing keys / outstanding signed upload URLs | Signing-key inventory and issued URL records unavailable from connected actions | **UNKNOWN**; review issuance and rotate only after active signed URLs/consumers are identified |
| TUS/multipart or external CLI/Studio writers | No positive owner inventory exposed by connector; source inventory is not equivalent to provider credential inventory | **UNKNOWN**; check operator accounts, S3 clients, upload completions and external integration credentials |
| Raw Storage REST privileged path | Real hosted test demonstrated a post-deletion-request upload succeeded using the staging secret | **FAILED EXCLUSIVE ENFORCEMENT**; cannot mark upload barrier accepted until unauthorized privileged credential holders and paths are eliminated |

**Operational log corroboration:** The past-24-hour staging Storage log aggregate
reported 17 `service_role` POST object uploads, 3 PUT replacements, and 16
deletions (plus read/list activity). These totals include acceptance testing,
are not attributable to unique credential holders, and are **not proof** that
unobserved external credentials or active S3/signed URLs do not exist.

**Staging state at audit:** Two private buckets, zero Auth users, zero Stored
objects, zero active write leases and zero custom `storage.objects` policies;
`service_role` has `BYPASSRLS`. The connected Supabase security advisor
was inspected, but its generic private-schema RLS findings do not establish
that all project-level privileged credential holders are accounted for.

**Credential removal decision:** No key or external access is proven unused.
Revoking any project-wide secret could disrupt existing Coach/Auth/hosted test
workflows. Therefore **no credential was revoked or disabled** in this audit;
the manual-only raw bypass probe remains restricted. Access changes require
the restricted Supabase dashboard/GitHub environment administrator to inventory
real keyholders, identify last use, replace working consumers, revoke abandoned
keys, and confirm that the old credential fails when exercised.

**Residual gate:** Key rotation or additional project secret keys **do not**
make service-role Storage access owner-scoped. Do not set
`uploadBarrierEnforced=true` or enable account deletion without an approved
architecture and live negative hosted bypass acceptance.


## 2026-11-13 — GitHub Actions staging environment and secret consumer audit

Scoped to current `integration/v2-foundation` workflow files (14 total). A
workflow's `environment:` and branch `if:` are **source declarations**;
they do not prove server-side GitHub environment protection rules, secret
storage scope, required reviewers, trusted runner permissions or who can
change/re-run workflows. The connected GitHub API cannot read private
environment/Actions secret settings, so protection-rule state is **UNKNOWN**.

| Workflow | Secret references | Trigger | Continued need |
| --- | --- | --- | --- |
| `v2-all251-temporary-auth-smoke.yml` | `ALL251_TEMP_STAGING_SECRET_KEY`, `ALL251_TEMP_STAGING_PUBLISHABLE_KEY` | Manual **and limited push** to exact workflow/test script on integration branch | **KEEP while hosted two-account Auth and unleased-Storage-denial acceptance is active**; push-triggered privileged access should require reviewed protected environment settings or be switched to manual-only after owner approval |
| `v2-all251-hosted-privileged-writer.yml` | Same two ALL-251 key references | **Manual-only** integration-branch acceptance | **KEEP for final hosted lease and bypass regression**, manually approved; do not auto-trigger |
| `v2-all251-temporary-hosted-storage.yml` | Same two key references (mapped to alternative env variable names) | **Manual-only** integration-branch private media/export Storage test | **KEEP until private byte export/recovery acceptance is finalized**; retire with staging project |
| `v2-all228-temporary-hosted-workload.yml` | `ALL228_TEMP_STAGING_PGPASS_LINE` (separate PostgreSQL pooler password, NOT the ALL-251 Storage secret) | **Manual-only** integration branch | **KEEP until ALL-228 hosted ingestion workload evidence closes**; review deletion deadline independently |
| `v2-all251-temporary-hosted-http.yml` | `ALL251_OWNER_A_TOKEN`, `ALL251_OWNER_B_TOKEN`, `ALL251_REVOKED_TOKEN`; plus nonsecret environment variables | **Manual-only** integration branch | **Review for retirement or regeneration**: per-user JWTs are ephemeral and may have expired; do not assume old tokens or user IDs still exist. Remove only after HTTP acceptance evidence and dependencies reconciled |

All five workflows declare `environment: all251-temporary-staging` and
`if: github.ref == 'refs/heads/integration/v2-foundation'`.
Other current V2 workflows inspected do not reference a secret or declare
that staging environment. The exact staging Storage secret is referenced in
**three** workflow files, not five. GitHub source scanner has a CI guard
covering this three-workflow allowlist and disallows an automatic bypass-probe.

**Protect/verify before enabling any production writer:**
1. In GitHub repository Settings → Environments → `all251-temporary-staging`,
   verify deployment branch policy is selected branches only, limited to
   `integration/v2-foundation`. Check required reviewer approval and
   self-review allowance (where plan permits); if missing, configure approval
   and recheck manual and push-triggered workflows.
2. In that environment's Secrets inventory, verify which names are
   environment-level versus repository/organization-level. Ensure the
   staging `ALL251_TEMP_STAGING_SECRET_KEY` is not also exposed as an
   unprotected repository/org secret. Audit authorized writers/admins and
   change history. Do **not** copy secret values into issue or chat.
3. Explicitly decide whether the automated Auth smoke should remain enabled:
   while needed, code edits to its test or workflow can result in staging
   secret access. Prefer manual-only while privileged bypass remediation is
   in progress unless reviewer gates are independently verified.
4. Confirm `ALL228_TEMP_STAGING_PGPASS_LINE` and persisted owner JWT token
   secrets still have active acceptance consumers; remove stale secrets only
   after the relevant issue owners confirm acceptance completion.
5. After ALL-251/ALL-228 staging acceptance completes, revoke unused
   temporary secrets (plus any corresponding Supabase key credentials) and
   remove the temporary project according to its existing deletion reminder.

**No credential or workflow was disabled by this source audit.** It is unsafe
to assume a masked secret's provider scope, to revoke the working staging key
before dependent hosted tests finish, or to delete other chats' active fixtures.
A read-only staging DB check during this audit showed **two Auth users, zero
objects and zero open write leases**, indicating active concurrent staging
test work; no account cleanup was performed.


## 2026-11-13 — Current deployed Storage boundary and alternate-route evidence reconciliation

This is a later **read-only evidence update**, not a release approval. Keep earlier
historical bypass observations as historical; do not interpret them as the
latest outcome or erase the failure that motivated containment.

- Current staging project `fbtgknlxjyeqrxemskbl`: 0 Auth users, 0 Storage
  objects, and 0 unsettled leases at this read; no concurrent fixtures to
  delete. `storage.objects` has no ordinary custom RLS policies, but the
  enabled `v2_privileged_storage_metadata_write_fence_review` trigger checks
  INSERT and selected UPDATE metadata fields. This trigger is an experimental
  deployed *review* safeguard in Supabase-managed Storage schema, not proof
  of provider-supported lifecycle enforcement. Do not disable or change it
  opportunistically.
- Later real hosted [two-account acceptance run 43427895858](https://github.com/allinproject/All-In-V2/actions/runs/43427895858)
  at SHA `70bb8c4b45fcb18ed4e1b5eceb539fd86d3de3ce` completed green:
  owner leases, positive private POST/PUT + SHA-256 byte readbacks, pending
  deletion lease fence, B account independence, and **the tested raw
  privileged Storage POST rejection**. This supersedes the older *outcome for
  that particular tested direct REST route only*. It does not negate the
  earlier observed bypass on a previous configuration; do not generalize to
  all credentials, S3, signed URL or TUS routes, nor to a newly deployed
  configuration. The separate current Auth smoke run 43433891934 passed the
  negative unleased POST guard and verified cleanup.
- Alternate-route inventory remains: raw modern `sb_secret_`/legacy
  `service_role` REST clients; generated S3 credentials and user-JWT S3;
  signed upload issuance/outstanding URLs (separate Storage signing key);
  TUS/resumable and multipart/signed completion after deletion; Studio,
  CLI, additional Edge backends, external credential holders and GitHub
  runners. The repository runtime scanner and current provider metadata
  do not supply **live negative acceptance for each route**. Previously
  user-reviewed dashboard screenshots showed S3 protocol enabled with
  **zero generated S3 key pairs**, and **one active ES256 Storage URL-signing
  key** with unknown outstanding URLs; these facts do not prove all S3 or
  signed upload paths are closed. Never silently rotate or revoke an
  in-use signing key.
- GitHub environment protection remains a separate hard gate. The latest
  owner-provided environment screenshot documented **no required reviewers,
  no deployment-branch restriction, and admin bypass allowed** for
  `all251-temporary-staging`. This review found no authoritative evidence
  that those settings have been remediated; connected GitHub repository
  reads cannot inspect those protected settings. Do **not** trigger another
  privileged staging workflow merely because the database is empty.
- The deployed `v2-private-storage-writer` Edge Function is absent, and
  operational account deletion/complete export remain OFF. Only the scoped
  lease-aware test has positive hosted evidence. **Release stays NOT
  ACCEPTED** until an operator can verify credential custody, GitHub
  environment protection, and explicit route-by-route negative acceptance.

For ALL-12, these Storage service tests measure no recovery data-loss window
and no recovery time from a snapshot cutoff: **RPO/RTO remain unmeasured**.
An isolated outbound-disabled restore target, consistent source snapshot
cutoff, finished data/Auth/Storage restore and owner-integrity readback are
required before a credible RPO or RTO can be reported. Do not convert CI
job duration or simple sign-in latency into disaster-recovery RTO.


## 2026-11-13 — Approved no-new-infrastructure signed-writer candidate

The founder chose the **existing-project, no-additional-infrastructure**
approach. This approves continuing review-only implementation, **not**
deployment or an unsupported claim that unrestricted Supabase credentials
cannot access provider bytes.

- `docs/architecture/sql/V2-ALL251-ATTESTED-PRIVILEGED-STORAGE-WRITER-REVIEW.sql`
  adds a distinct private HMAC signing key, durable nonce ledger, byte SHA-256
  lease binding, and attested begin/settle RPCs. In the *same transaction*
  it revokes the old service-role callable unsigned begin/settle grants.
  Without a separately provisioned 32-byte writer key, it **fails closed**.
- `trainingPrivilegedStorageWriterAttestor.mjs` signs exact owner, bucket,
  path, action, operation, byte digest, lease ID (for settlement), timestamp
  and unique nonce. The existing canonical writer and account-export barrier
  reuse this authority via optional injection. The default-off Edge writer
  requires a distinct, server-only `ALLIN_WRITER_ATTESTATION_SECRET_B64`
  before it will use the signed RPCs.
- **Shared-hosting limitation (verified 2026-11-13):** Supabase hosted Edge
Functions share project-level configured secrets and injected service keys.
There is no independently isolated per-Edge-Function secret scope in a single
Supabase project. A signer set through the project's Edge Functions → Secrets
would be available to other hosted Edge functions, so it **cannot** be
described as independent writer-only custody and must **not** be used as proof
of the exclusive upload barrier. See Supabase
[Edge secrets documentation](https://supabase.com/docs/guides/functions/secrets).
An out-of-project trusted signer/runtime, or a consciously accepted
same-project defense-in-depth trust model, requires separate approval and
release evidence; no new infrastructure is authorized automatically.

The signing secret must be generated out-of-band with a CSPRNG, placed in
  secure private database provisioning and the **dedicated writer only**.
  It must **not** be copied to the project-wide service key, GitHub
  environment shared test secrets, mobile apps, build artifacts, or this
  repository. DB signing table and nonce ledger must be unreadable by
  `service_role`; proof validation is done by a restricted SECURITY DEFINER
  routine. Credential rotation/recovery must be designed separately.
- Activation sequence: fully validated local rollback replay; deploy
  compatible server writer and provision matching independent signing key
  under an approved staging release with recovery; atomically install signed
  begin/settle and revoke *both* old unsigned service-role RPC grants; verify
  old and forged requests denied and fresh signed writes accepted. Verify
  failures leave durable leases unresolved and never report deletion success.
- **Residual exposure:** an unrestricted master service-role credential still
  has provider-level broad privilege, and an operator with database owner
  access may change the signer table/metadata trigger. Signed or resumable
  URLs and direct S3/TUS protocol completion require independent acceptance.
  Do not set `uploadBarrierEnforced=true` from attested-RPC success alone.

No signer key, migration or function was applied to hosted staging or
production as part of this implementation slice.


## 2026-11-13 — Real hosted signed-writer A/B baseline acceptance preparation

The previous HTTP route matrix [run #43473709582](https://github.com/allinproject/All-In-V2/actions/runs/43473709582) returned pre- and post-deletion privileged REST 400 with no successful write. Read-only hosted Storage log aggregation for 17:30–17:40 UTC identified `AccessDenied` on six HTTP POST 400 and two POST 403 responses; these are **not** evidence of a deletion-specific freeze. Source checks alone never certify a hosted provider boundary.

The updated hosted test in [draft PR #18](https://github.com/allinproject/All-In-V2/pull/18) now executes the **existing canonical `createPrivilegedStorageWriter` plus `createAttestedPrivilegedStorageLeaseAuthority`**, not an unreviewed client bypass. Before A's deletion request it must upload two distinct synthetic FIT-like byte payloads for authenticated owners A and B, independently download both, and compare SHA-256. After A's actual authenticated deletion request, it must reject A's signed writer action while accepting and independently re-reading B's new bytes. It still probes raw privileged REST, signed URLs, TUS, uncredentialed S3, precreated delayed operations, and cleans all synthetic users and object paths. Credentialed S3 SigV4/multipart is explicitly **UNTESTED** unless a separately reviewed generated S3 credential path becomes available; it cannot be inferred from unsigned S3.

**Verified staging prerequisites at review time:** V2 temporary staging had 0 Auth users, 0 Storage objects and 0 open leases, three enabled request/Auth/metadata safeguards, deletion execution OFF. Its legacy unsigned service-role lease grants were revoked, and its attested lease RPCs **were not installed**. No dedicated 32-byte private signing key is provisioned for the hosted test. The script now checks for an exact protected `ALL251_TEMP_STAGING_WRITER_SIGNER_B64` value before creating users. It refuses missing or malformed signer material and never falls back to an unsigned lease or generic privileged upload.

**Required next *separately reviewed* staging operations before a real hosted acceptance:** reconcile the canonical `V2-ALL251-ATTESTED-PRIVILEGED-STORAGE-WRITER-REVIEW.sql` with the deployed DB and concurrently changing integration branch; verify backup/recovery and old RPC revocation; provision a random HMAC key into the **private** DB signer table and a protected, authorized writer test runner, never the app, repo, logs or browser; verify it is not accessible to unrelated backend secret consumers; run the protected hosted suite with two disposable A/B sessions, exact independent real byte readbacks, A post-freeze rejection and B continuity; independently inspect and purge every synthetic file/session; separately test real credentialed S3/multipart and delayed signed/TUS completion. The signer in the existing shared GitHub environment is a **staging acceptance credential, not by itself provider-level exclusive custody**.

**Current status: NOT PASSED / BLOCKED on missing reviewed hosted signer + attested RPC.** The no-secret CI syntax and invariant test passed, but no new protected hosted write acceptance was run, no shared staging migration, credential or production change was made, and `uploadBarrierEnforced=false`, `completePrivateStorage=false` and deletion worker OFF remain authoritative.
