# ALL IN 365 V2 — legal accuracy review and approval dossier

**Date:** November 11, 2026  
**Status:** TECHNICAL REVIEW COMPLETE FOR CURRENT V2 BASELINE; FOUNDER / LEGAL / PRIVACY APPROVAL OUTSTANDING  
**Source:** [Full website snapshot](./V1-WEBSITE-FOUNDER-BETA-LEGAL-SOURCE-2026-11-11.md), copied directly from [the live founder-beta legal page](https://all-in-365.sugary-bean-1546.chatgpt.site/terms) on 2026-11-11.  
**Do not publish yet:** The source wording is preserved verbatim in `docs/legal/review/`. The original website's version IDs are evidence of web labeling, not proof that exact text was reviewed and approved for V2.

## Authoritative V2 acceptance contract (observed in app source and live V2 database)

V2 `app/sign-up.tsx` and `app/legal-acceptance.tsx` show all three complete published documents, distinct unchecked review controls, and an explicit 18+ checkbox, then re-read the exact published document snapshot before acceptance. V2 has `public.v2_legal_documents` keyed `terms`, `privacy`, `founder_beta_terms`, and owner-bound `public.v2_legal_acceptances` for all three exact versions, timestamp and age acknowledgment. A **read-only SQL check on 2026-11-11 returned zero rows** in `v2_legal_documents`: there is **no legal publication**. A schema table inventory found no privacy/deletion-specific or Coach tables in the current V2 public/private schemas; that is not an exhaustive inventory of edge functions, storage, or third-party platform capabilities.

Web source versions for review:
- Terms: `terms-of-use-v1`; exact section source: [terms](./review/terms-terms-of-use-v1.md)
- Privacy: `privacy-policy-v1`; exact section source: [privacy](./review/privacy-privacy-policy-v1.md)
- Founder Beta: `founder-beta-terms-v1`; exact section source: [founder-beta](./review/founder_beta_terms-founder-beta-terms-v1.md)

## Disposition per document

| Document | Current finding | Remaining approval action |
|---|---|---|
| Terms of Use | Covers V2 concept, fitness and AI caution, 18+, content separation, no payment authorization. Several features are described as service scope rather than verified enabled features. `Account Deletion` promises an in-app initiation method when account creation is offered. | Confirm actual V2 app deletion path or adjust future-tense availability claims before inviting testers; ensure no implied presently available unbuilt service. Human legal review of liability, indemnification, governing-law and consumer provisions. |
| Privacy Policy | Contains particularly consequential **present-tense** claims about scheduled daily database backups and explicit **in-app Privacy & Data deletion request, cancellation and queued-processing** workflow. V2 SQL inventory did not show deletion workflow tables; current source evidence has not established these experiences. `Coach uses OpenAI's API` refers to intended/previous integration while V2 Coach service port and conversation persistence have not been fully accepted. | Verify actual backup schedule and storage/retention; implement/test promised deletion/Privacy & Data flow **or** explicitly revise the V2 language to the truth before publication; verify AI processor and actual data sent/retained; verify live feature-specific collection, Apple Health access, notices, consent, third-party services and user-rights contact. |
| Founder Beta Terms | Correctly separates voluntary beta participation from future paid subscription authorization and requires separate 18+/Terms/Privacy/Beta acknowledgments. However the same privacy/deletion claims are incorporated by reference and future actual beta invitation scope is not yet verified. | Confirm beta is free unless a separate checkout is presented, distinguish seven-day trial and $9.99/month as intended future paid offer, confirm beta account/data continuity and disclosure of service limits; review with human counsel. |

## Exact technical assertions requiring investigation before approval

1. **Data deletion user journey:** The published privacy section currently says users can submit a deletion request inside `Privacy & Data`, cancel before separately confirming, and that confirmation queues processing. No corresponding owner-scoped deletion tables appeared in the live V2 database survey. Do not claim this functionality is ready; validate app route, RPC/edge contract and real deletion E2E when built.
2. **Backups:** The policy says the service uses scheduled **daily** database backups. A read-only app-database query cannot prove platform backup configuration; obtain provider/dashboard evidence of V2 backup plan/frequency/retention. Do not replace with a made-up period.
3. **Coach/OpenAI:** The policy specifically names OpenAI API processing. Verify exact V2 Coach deployment, provider agreement/processing scope and persistent thread data paths before treating this as a current production fact. V1 deployed behavior alone is not V2.
4. **Sensitive data permissions:** Do not imply automatic Apple Health import or public posting of progress photos; actual permissions, owner isolation, sharing and storage must be tested before claiming active capabilities.
5. **Web legal contact/host:** The website origin `/terms` is now confirmed to serve all three full texts. The source lists `allin365.app` as official website. Verify the apex URL and exact live legal links independently, but don't overwrite that domain or publish new copy blindly.
6. **Account authenticity and notices:** Identify the exact operator, accessible support/privacy email, source text effective dates, chosen version IDs and change-notice process. Content hash, website source and approved V2 database must agree. Store no acceptance against an unapproved draft.
7. **No hidden paywall:** Founder beta agreement does not authorize a charge. Current commercial direction is seven-day free trial and $9.99/month upon a separate paid offer; no automatic beta-to-paid charge.

## Required review decision and evidence

Founder and appropriate legal/privacy reviewer must sign off the final three **full, exact** markdown bodies, noting all deviations from the recovered V1 website version. Approval record should specify author, reviewer, date, source URL, version IDs, SHA-256 hashes, effective dates, and any implementation obligations that must be completed before beta or general availability.

**Do not silently revise the recovered snapshot**. Write separately named V2 candidate documents only after determining the accurate factual replacement language. Version IDs in the currently live website documents should not be reused for different text without an explicit documented versioning decision; modified text requires a distinct immutable version.

## Publishing and acceptance order

1. Resolve factual mismatches above and obtain explicit legal/privacy and founder approval.
2. Prepare three reviewed exact V2 payloads from the approved content (no website footer, no source-snapshot metadata).
3. Controlled DB publication into existing `v2_legal_documents` only; first inspect current rows and permissions, ensure one current effective document per key, check content hashes, preserve immutable historical versions and receipts.
4. Verify the signed-out signup fetch, three separate checkboxes and age control, exact published text/version snapshot, session/email confirmation, legal receipt, stale-document behavior and cross-account isolation on an installed development build. Leave signup closed until evidence passes.
5. Surface working current legal links from the canonical app settings/privacy screen and web site. Preserve separate public/paid launch compliance in ALL-72; do not close ALL-209 solely because legal rows exist.

**State as of this review:** source recovery done, accuracy blockers identified, formal approval pending, V2 database has no published legal rows, signup deliberately closed.


## 2026-11-12 — newer ALL-251 account-lifecycle source reconciliation

**This is a later source-code observation, not a retrospective correction to the November 11 database inventory.** The current V2 integration branch now contains `apps/mobile-v2/app/profile/account-deletion.tsx` and `apps/mobile-v2/app/profile/account-export.tsx`:

- The account deletion screen implements an authenticated, account-bound **request intake/status/cancel** UI. It reads `v2_my_account_deletion_request`, calls `v2_request_account_deletion` after explicit `DELETE MY ACCOUNT` confirmation, and cancels a specific still-requested ID with `v2_cancel_account_deletion_request`. It reconciles uncertain write outcomes by re-reading owner-bound status, instead of blindly retrying a possibly committed request.
- **Crucial limitation displayed in the UI itself:** “The secure deletion processor is not enabled yet, and this beta flow is not validated for public release.” Request intake is **not** evidence of actual durable erasure, full downstream purge, retention guarantees or platform compliance. Verify current deployed RPCs, worker processing and authenticated installed-device end-to-end results with ALL-251 before approval or distribution.
- The account export screen supports owner-bound `v2_export_my_account_snapshot` to a temporary JSON file on iOS/Android with explicit confirmation and cleanup. It explicitly describes this as **not** a complete archive of all activities, media or connected providers. Do not describe it as complete portability/export functionality without an approved scope and verified backend/device evidence.
- This newly observed UI changes the older claim that there is no V2 account-deletion initiation interface. It does **not** resolve the policy candidate's email-only interim description or the missing processor/retention/backup/privacy review gates. Legal reviewers must reconcile the final text against the actual shipped deletion/request lifecycle rather than freeze either earlier wording.
- Evidence scope: V2 GitHub source inspection on 2026-11-12; **not** a fresh Supabase deployment inventory, production query, legal approval, actual account deletion, document publication, or device acceptance. Preserve original recovered V1 legal text and unapproved candidate redlines unchanged.


## 2026-11-12 — read-only deployed V2 backend evidence (ALL-219)

**Project inspected:** Supabase `xarhuczrtzuiljmtdaeu`, status `ACTIVE_HEALTHY`, Postgres 17.11.0.018. Checked with current project/schema metadata and read-only SQL; no schema, user data, service configuration, Auth account or publication was changed.

| Live observation | Result | Interpretation / remaining action |
|---|---|---|
| `public.v2_legal_documents` total/published | **0 / 0** | No final Terms, Privacy, or Founder Beta publication; signup remains gated |
| `public.v2_legal_acceptances` | **0 rows** | No real device acceptance evidence; avoid inferring user tests |
| Privacy/delete tables | `allin_private.v2_account_deletion_requests`, `v2_account_deletion_processor_config`, `v2_account_deletion_execution_audit` present with RLS enabled | Intake and execution ledger infrastructure exist; this supersedes November 11 absence-of-table observations |
| `v2_account_deletion_processor_config.execution_enabled` | **false** | Deletion execution is currently **disabled**; do not claim requests are actually erased |
| Pending/processing deletion requests | **0** | No live pending demand at the instant of query, not evidence processing works |
| Storage buckets | **0** | Presently no bucket objects registered; future buckets must be checked before any deletion release |
| Edge Functions | **0 deployed** | No Supabase Edge worker is present; another non-Edge processor is not thereby ruled out |
| Related database RPCs | request, read, cancel, claim, record completion/failure, verify completion, export, accept legal are present | Function presence is **not** installed-app/worker execution acceptance |
| Supabase organization billing | Organization `urcroanxnjhinzpsfxku` reports plan `pro` | **Does not demonstrate** V2 daily backup actually ran, schedule, age, restore viability or retention; verify explicit V2 project backup dashboard and restore evidence |

**Read-only function-body check:** `public.v2_claim_account_deletion_for_processing` checks the enabled configuration, rejects nonempty storage buckets, checks user-owned table cascade coverage, and locks/claims one exact pending request. These are protective source conditions, not proof of end-to-end deletion and not a reason to turn the processor on. The function is `SECURITY DEFINER`; its caller privileges, grants, auth handling, and downstream privileged executor must be reviewed in ALL-251 before enabling.

**Legal drafting implication:** Neither the original statement of operational daily backups nor a claim that deletion requests currently cause erasure is supported by these observations. Account-bound request intake is now supported in the source and live schema, but execution remains explicitly OFF. Obtain current processing facts and human/founder approval before choosing final Terms/Privacy wording. No candidate or original legal text was changed by this evidence audit.


## 2026-11-12 — legal permissions and draft factual reconciliation

**Live V2 Supabase, read-only SQL, 2026-11-12.** This evidence supplements, rather than supersedes, installed-device and service-role authorization testing.

| Object | Verified role privileges / policy | Boundary |
|---|---|---|
| `public.v2_legal_documents` | RLS enabled; `anon` and `authenticated` have SELECT only; RLS SELECT predicate requires `status='published'` and `effective_at <= now()`; neither has INSERT, UPDATE or DELETE. | Supports public exact-effective-text review without a client publisher; does not authorize an admin publication or guarantee unique current versions. |
| `public.v2_legal_acceptances` | RLS enabled; authenticated SELECT restricted by `auth.uid() = user_id`; no direct client INSERT, UPDATE or DELETE grants; no anonymous SELECT. | Owner-read and server-owned write direction verified at privilege/policy level; test receipt RPC authorization and retries independently. |
| `v2_accept_legal_documents` | SECURITY DEFINER; authenticated EXECUTE true, anon false, service_role false. | Inspect internal exact-version/owner/auth checks and test live signed-in sessions before claiming end-to-end acceptance. |
| `v2_my_account_deletion_request`, `v2_request_account_deletion`, `v2_cancel_account_deletion_request`, `v2_export_my_account_snapshot` | SECURITY DEFINER; authenticated EXECUTE true, anon false, service_role false. | Only account-owner-safe internal checks and installed-app validation can establish authorization; executable roles alone cannot. |
| `v2_claim_account_deletion_for_processing`, `v2_record_account_deletion_completion`, `v2_record_account_deletion_failure`, `v2_verify_account_deletion_completion` | SECURITY DEFINER; service_role EXECUTE true, anon/authenticated false. | Privileged processing APIs are not exposed to ordinary app users. Execution remains explicitly disabled; review authorization and worker ownership under ALL-251 before enablement. |

**Reviewer-facing mismatch discovered:** The unapproved `docs/legal/candidates/privacy-policy-v2-candidate.md` and `terms-of-use-v2-candidate.md` currently say an in-app account-deletion workflow *may be introduced*. The current V2 native `app/profile/account-deletion.tsx` and deployed owner-scoped request RPCs **already provide a request-intake/status/cancellation interface**, but the processor is disabled and no erased-account acceptance is established. During review, replace this temporal mismatch with accurate, separately scoped statements about **request intake currently implemented** versus **permanent erasure still unvalidated/unavailable**. Do not imply that email-only processing is sufficient for App Store submission, that a queued request is actually fulfilled, or that the exported JSON is a full account archive. Neither candidate was silently edited or approved.

**Further hard gates:** actual website link and support inbox verification, processor/subprocessor and retention inventory, privacy/legal reviewer approval, exact founder approval, immutable publication, and consent/device validation. The Supabase organization Pro plan alone remains insufficient evidence of an actual V2 backup schedule and restore. No SQL writes, legal publication, user deletion, plan changes or signup enablement occurred in this audit.
