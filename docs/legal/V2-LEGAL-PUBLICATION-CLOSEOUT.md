# ALL IN 365 V2 — Founder Beta Legal Publication Closeout

**Status:** ACTIONABLE / NOT PUBLISHED  
**Owner:** Durben Ventures LLC  
**Source authority:** [V1 Founder Beta Legal Package (Working Draft), updated Nov 4, 2026](https://linear.app/allin365/document/all-in-365-founder-beta-legal-package-working-draft-1d9f1385d84c)  
**Tracking:** [ALL-219](https://linear.app/allin365/issue/ALL-219/v1-v2-legal-business-plan-and-brand-authority-transfer) → [ALL-209](https://linear.app/allin365/issue/ALL-209/v2-slice-1-v2-native-signupsign-in-legal-gate-and-session-lifecycle)  
**Scope:** V2 only. V1 is read-only. No real signup before approval/publication.

## Locked decisions / verified implementation

- Reuse V1 legal documents as the text baseline; do **not** create an unrelated replacement package.
- Operator: **Durben Ventures LLC**. Product: **ALL IN 365**. Website: **https://allin365.app**.
- Founder's current commercial direction: **seven-day trial, $9.99/month**, but do not imply billing is operational during founder beta.
- V2 account policy requires an explicit **age 18 confirmation**.
- V2 Supabase project: **xarhuczrtzuiljmtdaeu**, independent of V1.
- Signup/legal routes require **three published, effective** legal records: `terms`, `privacy`, `founder_beta_terms`. Each carries key, exact version, title, full markdown, content hash, publication status and effective timestamp in `public.v2_legal_documents`.
- `public.v2_legal_acceptances` records authenticated user, the three exact versions, age confirmation, timestamp, and idempotent action ID. The client checks the current published snapshot before signup/acceptance; server-side writer checks authenticated expected owner.
- Legal documents are **not yet published**. The current V1 source is **working draft**. Neither source reuse nor this checklist constitutes counsel approval.

## Exact completion sequence

- [ ] **Recover the complete actual V1 document text**, not merely the Linear description/snippet; establish an immutable source copy and source timestamp for Terms, Privacy and Founder Beta Terms. The Linear connector's document search currently exposes a truncated content preview; do not reconstruct or invent unseen paragraphs.
- [ ] **Prepare three V2 review copies**, preserving V1 paragraphs and creating a short redline of every factual or policy adjustment. Review the complete V1 source, not an AI-written substitute.
- [ ] **Verify business identity**: LLC/operator, postal/legal notice address if required, current support/privacy email, domain and contact routing. A company Gmail is noted in the draft; confirm whether it remains the designated legal contact.
- [ ] **Confirm beta scope**: invitation/eligibility, testing risks, support, feedback rights, termination, whether beta is free, and how beta transitions to the seven-day trial / $9.99 monthly plan. Do not present current paid billing as active until implemented.
- [ ] **Check Terms**: acceptable use, account responsibility, service changes, service availability, intellectual property, cancellation and refund language, dispute procedures, applicable law and health/fitness/AI limits.
- [ ] **Check Privacy** against real V2 data flows: authenticated profile/onboarding, Training, nutrition/food, Coach conversations and learned preferences, device/Health data *only when connected*, location/weather permissions, photos/community visibility, analytics/crash logs, notifications, processors, retention, export/deletion, support/security and minors. Avoid claiming future integrations currently operate.
- [ ] **Check Founder Beta Terms**: separate beta conditions, data persistence/wipe policy, production transition, feedback permissions, non-medical advice, risks, and the exact pricing boundary.
- [ ] **Confirm external processing**: Supabase/Auth, Resend transactional email, model/AI provider(s), device/analytics/crash services and hosting only where actually used. Identify vendor role and transfer disclosure accurately; do not state unverified processor or retention terms.
- [ ] **Obtain human legal/privacy review and explicit founder approval** of exact final texts and effective dates. Record reviewer, date, version and approved source hashes; no default or inferred approval.
- [ ] **Publish the three exact immutable versions** in V2 only, using controlled migration/admin release (not authenticated client direct writes). Review current DB state first, ensure a single effective version of each key and archive/supersede prior versions without destroying acceptance history. No publication before approvals.
- [ ] **Verify public legal read** of all three exact full bodies, version metadata and content hashes. Confirm stale/incomplete documents fail closed.
- [ ] **Run native signed-out signup and returning-user acceptance** against approved published versions: each of three scroll/read/check, age confirmation, exact receipt, email-confirmed path, retry, restart, older-client snapshot rejection and account isolation. Save evidence.
- [ ] **Expose current Terms and Privacy from in-app Settings and website** before beta invitation, with reviewable version/effective date; test links and accessibility.
- [ ] **Close ALL-219 legal-transfer work** after approved texts and provenance live in V2 repo, then **ALL-209 legal/signup gate** only after real-device acceptance. Record completion evidence and maintain any public paid-launch obligations separately in ALL-72.

## Acceptance / stop conditions

**Legal source-complete** = exact V1 text recovered, reconciled V2 redline, reviewed, founder-approved and versioned in V2 source.  
**Published** = all three approved versions available via the actual V2 legal read contract and linked from required surfaces.  
**Signup-ready** = publication **plus** tested V2 registered-user receipt and real-device journey.  
**Paid-launch-ready** is a *separate* gate; do not conflate founder-beta legal acceptance with subscription compliance or implemented billing.

Do not open signup through placeholder texts, invent legal clauses, mutate V1 data, claim an attorney reviewed documents without evidence, or downgrade safeguards to unblock the screen.


## 2026-11-11 — Evidence audit and exact remaining dependencies

**V1 publication evidence:** V1 Linear ALL-84 records a founder statement that all three documents were completed, but the verified website origin `/terms` screenshot on 2026-11-08 instead displayed a **draft/status page**, explicitly saying app/store terms were not yet published. Treat authorship and web publication as separate facts; do not substitute that page for actual legal content.

**V1 legal source retrieval:** The canonical Linear document is discoverable by ID `ca258284-4afc-4fbd-9d56-9d2b00ce5750`, but `list_documents` returns only the first 500 characters and `get_document`/`fetch` yield empty results through the current connector. Available Drive/Library/code searches do not locate a complete verified copy. This is an access/retrieval blocker, **not** proof the documents were never written. Preserve the source link and request full text through the existing Linear document UI or a supported export when available; do not ask the founder to rewrite legal clauses.

**Public link verification:** Both `https://allin365.app/terms` and the previously working V1 origin `https://all-in-365.sugary-bean-1546.chatgpt.site/terms` were inaccessible through the current automated web check; this does not prove they are globally down or publish final text. Do not change DNS/hosting in this legal slice. V2 can publish its own approved text into the versioned legal database independently, but web-based public terms links still need a verified working destination before external beta.

**V2 source inspection:** Existing V2 `app/sign-up.tsx` and `app/legal-acceptance.tsx` load three published legal records, show exact markdown text and per-document review checkboxes, require age 18 and revalidate the publication snapshot before writing acceptance. V2 database schema enforces the three keys and owner-bound acceptance records. This is implementation evidence only, not full UI/device test or current publication evidence.

**Founder beta vs paid launch:** Retain current proposed seven-day trial / $9.99/month as commercial direction; the beta document must separately identify when/if charges start and how migration to paid subscriptions works. The beta legal release must not claim implemented subscription billing or privacy deletion/export processes that remain unverified.

**Next executable path:** (1) obtain exact complete canonical V1 text; (2) redline against actual V2 facts, preserve original text and version evidence; (3) approve via founder + appropriate legal/privacy review; (4) publish three immutable V2 records under a controlled, reviewable change; (5) validate full text/version/receipts and links in app and on device. Each stage stays open until evidence is attached.
