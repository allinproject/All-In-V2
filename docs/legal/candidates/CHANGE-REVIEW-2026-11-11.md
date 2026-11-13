# ALL IN 365 V2 — proposed legal amendments: review sheet

**Status:** REVIEW CANDIDATES; no V2 publication or signup enablement.  
**Prepared:** 2026-11-11  
**Source:** [Original verbatim V1 legal webpage snapshot](../V1-WEBSITE-FOUNDER-BETA-LEGAL-SOURCE-2026-11-11.md).  
**Reviewer:** not yet recorded. **Founder approval:** not yet recorded.  
**V2 project:** Supabase `xarhuczrtzuiljmtdaeu`, GitHub `allinproject/All-In-V2`, branch `integration/v2-foundation`.

## Document candidates and exact modification scopes

### Terms of Use
- Source file: [Terms of Use `terms-of-use-v1`](../review/terms-terms-of-use-v1.md)
- Proposed amended file: [Terms of Use V2 candidate](./terms-of-use-v2-candidate.md)
- Modifications: `Version` is a non-final candidate label; one paragraph in **Account Deletion**. The V1 paragraph promised an in-app account-deletion entry point; the candidate directs beta deletion/privacy requests to the existing contact address and describes future in-app controls conditionally. Other sections remain as copied from the V1 webpage.
- Approval question: Is email-based request handling operational and acceptable for this founder beta and distribution channel? If App Store policy requires in-app deletion for the intended distribution, build/test the feature before distributing; editing this policy does not waive platform requirements.

### Privacy Policy
- Source file: [Privacy Policy `privacy-policy-v1`](../review/privacy-privacy-policy-v1.md)
- Proposed amended file: [Privacy Policy V2 candidate](./privacy-policy-v2-candidate.md)
- Modifications: `Version` is a non-final candidate label; one paragraph in each of **Coach and AI**, **Data Retention**, and **Account Deletion**:
  - **Coach** — V1 present-tense provider processing becomes conditional on the V2 Coach integration and processing being enabled and verified; OpenAI API remains the intended provider.
  - **Backups** — removed the unsupported assertion that V2 already uses scheduled daily database backups; backup schedules and retention depend on actual verified provider configuration.
  - **Deletion** — removed the unsupported assertion that `Privacy & Data` in the V2 app already offers a cancellable, queued deletion workflow. Instead directs requests to the designated contact during founder beta, subject to identity verification and applicable law.
- Approval questions: verify vendor/data-sharing facts, actual backup/restore configuration, tested privacy request intake, retention and deletion implementation, and whether all mandatory state/privacy rights notices are satisfied.

### Founder Beta Terms
- Source file: [Founder Beta Terms `founder-beta-terms-v1`](../review/founder_beta_terms-founder-beta-terms-v1.md)
- **No change proposed to original text.** This source already states that beta participation does not authorize charges and requires separate age 18, Terms, Privacy, and Founder Beta acknowledgement. Its reviewed version should be selected independently when other documents are approved.

## Verified platform and backup requirements — 2026-11-11

**Important correction:** The email-based deletion wording in the V2 candidate Terms/Privacy is an interim description of a contact route, **not** sufficient to close App Store review readiness. Apple's official [5.1.1(v) account-deletion guideline](https://developer.apple.com/help/app-review/guideline-reference/5-1-1-account-deletion/) requires apps with account creation to allow deletion initiation inside the app. Apple says standard apps generally cannot require users to email support or complete a support chat to delete their account. Deliver a genuine native deletion path under existing [ALL-251](https://linear.app/allin365/issue/ALL-251/v2-profile-privacy-and-account-lifecycle-preferences-export-deletion), including deletion consequences, authentication, privacy worker/retention, owner and retry safety, and installed-device acceptance **before** app distribution that requires the Apple review gate. Policy changes cannot waive this requirement.

**Backup claim:** Supabase's [database backup guide](https://supabase.com/docs/guides/platform/backups) says automatic daily backups are provided for Pro/Team/Enterprise plans, while the Free plan is not guaranteed such backups. Current V2 project billing tier, backup status and retention have **not** been verified. Keep the candidate's configuration-conditional wording; get actual dashboard evidence before any specific schedule claim. Do not buy/upgrade plans without founder authorization.

**Legal review:** A human reviewer must evaluate adequacy of privacy contact-only handling prior to distributing any build, including applicable privacy law and store policies. Drafts remain candidates, not signed or published terms.

## Publication and engineering stop conditions

- The live V2 legal table was empty when checked on 2026-11-11. No `v2_legal_documents` rows should be inserted, published, or backdated until final legal review and founder authorization are captured.
- Site version identifiers on V1 do not authorize changing text under the same version. Candidates deliberately use distinct non-final labels and must receive final immutable version identifiers, effective dates and hashes on approval.
- Current V2 has no dedicated account-deletion request queue or Coach persistent conversation tables among the eight current private/public domain tables. A platform backup schedule cannot be confirmed from PostgreSQL metadata.
- Separate App Store/account deletion, accessibility, consent/device, privacy export, backup/recovery, purchase/renewal and broader public release requirements are **not** closed by editing policy text.
- The original source and all three review copies must remain unchanged for audit.

## Approval record to complete

| Field | Required value |
|---|---|
| Approved Terms file and version | Pending |
| Approved Privacy file and version | Pending |
| Approved Founder Beta file and version | Pending |
| Legal/privacy reviewer and date | Pending |
| Founder approval and date | Pending |
| Effective date for each file | Pending |
| Exact UTF-8 content SHA-256 for each approved file | Pending |
| V2 database publish evidence | Pending |
| Native signup, 18+, version/receipt and account-isolation test evidence | Pending |

Only after all required review fields are complete should a controlled V2-only publication be prepared and tested. Preserve the ability to supersede, rather than overwrite, existing published versions.


## 2026-11-12 — founder principle approval and current technical correction

**Founder-approved policy principles (not exact-document approval):** On 2026-11-12, the founder approved five durable implementation rules in [ALL-219](https://linear.app/allin365/issue/ALL-219/v1-v2-legal-business-plan-and-brand-authority-transfer): (1) health information and progress photos private by default with user-directed sharing; (2) user-requested exports and deletion, with full lifecycle implemented and tested before fulfillment promises; (3) Coach may use only authorized relevant data and actual AI processor/data use must be disclosed truthfully; (4) founder-beta participation never authorizes a subscription charge; (5) age 18+ and distinct recorded current Terms, Privacy and Founder Beta acceptance. The V2 product authority records the same decision.

**This approval does NOT satisfy any pending document-specific fields in the table above.** Final Terms/Privacy/Founder Beta text, qualified legal/privacy review, founder signoff of exact versions, effective dates and hashes, controlled publication, native device verification, any deletion executor activation and opening signup remain **pending**. Do not backfill those fields or publish under this policy approval.

**Superseded snapshot claims requiring correction before final wording:** On 2026-11-12, verified live V2 backend now includes deletion request, processor config and execution audit tables and owner-bound request/cancel RPCs. The native Account screen allows users to submit, inspect and cancel eligible **deletion requests**, and export a **limited** account JSON snapshot. However, the live deletion execution configuration is **false**; no tested actual erasure is established, and export is not a full archive. The earlier sheet's claim that no request queue exists is historical only. The two current proposed candidate texts saying in-app deletion controls 'may be introduced' are stale and must be reconciled to the request-only reality, with explicit distinction from unfinished irreversible deletion. Do not alter verbatim V1 sources or assume future deletion completion. The prior email-only candidate is not sufficient as a general Apple account-deletion compliance claim.

**Deployed legal authority constraints:** Latest read-only live checks show zero legal documents/acceptances; published legal text is public-readable only when effective and published; users cannot directly insert or modify legal documents; legal acceptance reads are account-scoped; no ordinary user execution grant for privileged deletion-processing functions. This is source/schema/grant evidence, **not** device tests or final legal compliance.

**Backups and processors:** Connected Supabase organization identifies a Pro plan, but a verified V2 project backup schedule/restore and service-specific retention evidence remain outstanding. Deployed AI/data processor inventory and support mailbox delivery/reply workflow require verification. Retain proposed conditional wording; do not invent assured backup frequency, retention or deletion turnaround.

**Next permissible work:** prepare narrowly scoped factual candidate revisions for counsel/founder review, inventory current V2 processing and links, and complete non-destructive tests. No legal rows, signup opening, production deployment, paid billing or deletion execution may follow merely from the five policy-principle approvals.


## 2026-11-12 — candidate factual correction after policy-principle approval

The earlier 2026-11-11 deletion paragraphs and their descriptions above are **historical**. After confirming current native and deployed V2 request-intake functionality and the disabled deletion executor, we made a **minimal factual revision to the unapproved candidate paragraphs only**:

- [Terms candidate](./terms-of-use-v2-candidate.md): describes currently implemented signed-in request, status and pending-cancellation interface, distinguishes receipt from completed erasure, and explicitly says secure deletion processing is not enabled. This supersedes the earlier “may be added” statement; other Terms sections are unchanged.
- [Privacy candidate](./privacy-policy-v2-candidate.md): likewise describes existing request intake but explicitly disclaims immediate or validated permanent deletion. This supersedes the earlier email-only/future-workflow description; other Privacy sections are unchanged.
- The existing designated privacy contact remains an **unverified operational support route** until mailbox intake, identity verification and handling are demonstrated. Do not treat new wording as proof of a supported deletion SLA or as a substitute for ALL-251 processing implementation.
- **Status of both revisions:** proposed factual candidates only; no legal/privacy reviewer signature, no founder approval of the exact document text, no effective date/hash assignment, no Supabase legal publication, no signup opening and no production deployment. The verbatim V1 review copies remain untouched. Preserve the five founder-approved *principles* separately from final-document approval.

**Release review note:** The current native request-intake feature is not itself full Apple account-deletion compliance without a tested user-accessible deletion outcome and applicable store/reviewer requirements. Before any legal publish, revalidate factual wording against the installed, deployed version rather than treating today's in-development snapshot as automatically launch-ready.


## 2026-11-12 — operational facts and qualified reviewer intake

**Purpose:** Review preparation and evidence only. Neither a technical audit nor a lawyer outreach draft equals qualified legal/privacy review. The existing five founder-approved product principles remain separate from approval of exact legal wording.

### Operational facts supported by sources

| Topic | Evidence and status | What must still be demonstrated before approval |
|---|---|---|
| V2 operator/product | Founder product authority: Durben Ventures LLC; ALL IN 365; 18+ founder beta; separate paid authorization. | Confirm registration/business contact and notices as written in legal text. |
| V2 legal lifecycle | 2026-11-12 read-only live V2 Supabase: **0 published legal records and 0 acceptance receipts**; legal documents may be read by anon/authenticated only when published+effective; clients have no legal-document write grants; owner-only acceptance reads. | Publish only after reviewed exact immutable text, effective dates, versions and hashes; test installed app legal flow and receipts. |
| Account deletion | Live schema includes owner-scoped request/audit/config; `execution_enabled=false`; in-app request/status/pending cancellation exists; no deployed Supabase Edge Functions. | Actual irreversible processing and data/storage/third-party coverage, permissions, safety, retention and E2E verification under ALL-251. |
| Export | Current native route provides a bounded authenticated JSON snapshot, not comprehensive activity/media/provider export. | Define allowed scope, complete coverage/portability obligations and installed-device confirmation. |
| Backups | Connected Supabase organization reports Pro. Supabase public documentation, updated 2026-11-05, says Pro project databases have daily backups with access to last 7 days, unless PITR applies: https://supabase.com/docs/guides/platform/backups . | Verify THIS project `xarhuczrtzuiljmtdaeu` backup dashboard/history, PITR configuration, retained restore points, restore acceptance and whether any object storage/other vendors are covered; plan eligibility alone is not proof. |
| Coach/AI | V2 Privacy candidate intentionally identifies OpenAI API as intended; no complete deployed data-flow/provider evidence obtained in this review. | Verify actual V2 provider/runtime integration, transmitted field categories, health-data consent, logging/retention, third-party terms, enablement and public claims with appropriate implementation owners. |
| Contact routes | Policy candidate lists `durbenventures@gmail.com` and `https://allin365.app`; connected Gmail account is accessible and a legal-review inquiry was saved as a draft. Automated 2026-11-12 public reads of `https://allin365.app/terms` and historical origin `/terms` failed through web retrieval; this does NOT establish worldwide downtime. | Verify human-operated privacy request intake and replies, website domain/links from real devices, security/identity verification and response escalation. |
| Lawyer review | Gmail search of relevant counsel/review terms returned no evidence of a completed qualified review; search absence is not proof none exists elsewhere. LegalCORPS (Minnesota business-law legal aid) publicly offers brief clinics and potentially eligible limited-scope attorney representation: https://legalcorps.org/businesses-entrepreneurs/ . | Secure actual counsel engagement, confirm practitioner competence with mobile privacy/AI/health data, scope and confidentiality, get review of exact three documents and all redlines, and preserve documented written disposition. |

### Qualified legal/privacy review acceptance evidence — mandatory

1. **Reviewer identity/qualification:** real name, firm/organization, active bar jurisdiction/status where applicable, and relevant consumer apps/privacy/AI/health-data experience; verify independently. A general business clinic consultation is not automatically an in-depth privacy/document review.
2. **Engagement and scope:** date, representation/engagement or clinic advice record, covered Terms/Privacy/Founder Beta revisions, jurisdictions and distribution (founder beta, Apple/Google, paid trial/subscription), conflict/confidentiality arrangements, limitations and fee/eligibility confirmation.
3. **Privacy factual map:** vendor/subprocessor register, authorized Health/Apple Health data types, Coach inputs and provider handling, photo visibility, Community, location/diagnostics, deletion/export/retention and backup practices, actual contact route and consumer rights. Mark unverifiable statements as conditional or block publishing.
4. **Review output:** dated written review or redline for **each** exact candidate, issues raised, accepted revisions, outstanding conditions, and final counsel disposition; do not label “counsel approved” merely because an email or appointment exists.
5. **Founder final text approval:** explicit separate approval of exact immutable Terms, Privacy, Founder Beta files, named versions, effective dates and SHA-256. The 2026-11-12 approval of five *principles* does not fill this requirement.
6. **Release evidence:** controlled V2-only legal publication, public/Settings links and signed-out/in signup/consent version receipts, 18+ screen, account isolation and device validation. No action on production data or public signup until approvals and required engineering gates clear.

### Outreach status and next handoff

- A **Gmail draft only** was created to `info@legalcorps.org`, subject “Request for pro bono/limited-scope legal and privacy review — ALL IN 365 founder beta,” asking about a qualified privacy/mobile-app reviewer, eligibility/cost, and handling of all three documents. **Not sent**; no attorney retained, no appointment booked and no review obtained.
- LegalCORPS published service eligibility may involve a $50 placement fee for some limited-scope matters and income criteria, while brief advice clinics and certain partner routes have other terms. Confirm eligibility/actual fees before commitment: https://legalcorps.org/businesses-entrepreneurs/ . No paid engagement was authorized.
- Reviewer should receive the source snapshot, current three review copies, amended candidate redlines, this sheet, and the current V2 factual accuracy dossier using a secure, consented transfer. Avoid sending private user data or keys.
- Preserve unapproved status and existing ALL-219 / ALL-251 / ALL-209 dependencies until exact independent reviewer feedback is recorded. **No legal signoff is presently evidenced.**


## 2026-11-13 — superseding founder authorization (V2 founder-beta use)

The founder explicitly authorized using the three existing legal documents in the V2 app as **founder-approved**, without requiring attorney review first. This updates the older unfulfilled founder-approval field and removes outside counsel sign-off as a founder-imposed prerequisite for integration. It is **not** a representation that independent legal/privacy review occurred, and it does not validate inaccurate operational claims or waive applicable law, Apple rules, account security, privacy/data obligations, or other release gates. Source: [ALL-219 founder decision](https://linear.app/allin365/issue/ALL-219/v1-v2-legal-business-plan-and-brand-authority-transfer), 2026-11-13.

Approval scope: existing Terms of Use, Privacy Policy, and Founder Beta Terms, reusing the recovered canonical V1 wording with only necessary factually accurate V2-specific revisions. Original review copies remain unchanged. Before publication, select the latest corrected candidate for each, ensure backup, deletion/export, processors and billing claims are truthful to actual V2 behavior, record the exact immutable content hashes, versions and effective timestamps, and use the established privileged publication process. The native signup and Profile/Account legal viewer must display those versions; preserve separate opt-in and 18+ confirmations and signed-in owner-bound acceptance receipts. Do not claim publication, real signup availability or device validation until verified independently.
