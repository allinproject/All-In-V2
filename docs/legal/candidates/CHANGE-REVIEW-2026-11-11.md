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
