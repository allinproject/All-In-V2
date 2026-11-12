# ALL IN 365 — V2 Business & Launch Operating Plan (Working)

**Status:** Working planning authority — NOT a reviewed financial forecast, operating budget, financing commitment or permission to launch.  
**Owner/operator:** Durben Ventures LLC. **Product:** ALL IN 365.  
**Prepared:** 2026-11-12 for Linear ALL-219.  
**Precedence:** Newer explicit founder decisions and current feature-specific Linear contracts override historical V1 transfers. Financial estimates below are *not* actuals.

## 1. Product and customer

**Positioning:** "Your whole fitness life in one place." **Philosophy:** "Live All In." Inclusive supporting line: "Start where you are, go as far as you want."

Help beginners, walkers, runners, endurance/ultra athletes, strength athletes, cyclists, multisport participants and people improving nutrition/recovery manage their fitness in one coherent experience. Differentiation is a persistent context-aware Coach paired with athlete-owned training, completed activity, nutrition, recovery, and Community/RaceHub—not a claim that unbuilt integrations already work. User autonomy, consent for plan changes, privacy, reliability, and usable manual controls are product requirements.

**Unvalidated commercial hypotheses:** Users value consolidating fragmented tools; weekly Coach value and reliable logging improve retention; content-led acquisition converts to trials. These hypotheses need actual beta evidence, not advertising claims.

## 2. Commercial terms and boundaries

| Item | Current decision / evidence | Publication status |
|---|---|---|
| Subscription | $9.99/month after seven-day free trial | Founder product decision; storefront, entitlement and legal implementation require verification |
| Free tier and ads | No perpetual free tier; no ads | Product decision |
| Annual | $50/year appeared as a placeholder | **Not approved** for launch; do not advertise or configure as live |
| Founder beta | Small first cohort ~25–30, possible expansion up to ~100 | Planning scope, not proof enrollment is open |
| Founder beta charging | Separate beta acknowledgment; prior beta terms say participation does not authorize charges | Exact approved contract and stores must be reconciled before charging |
| Referral | Milestones at 5, 10, 25; apparel at 5 | Mechanics, fraud prevention, fulfillment cost and 10/25 rewards need confirmation; do not promise unspecified rewards |
| AI | Target average variable AI spend below $1 per active user/month | Target, not measured current cost |
| Merchandise | Print-on-demand direction, no inventory commitment | Optional later, not assumed subscription revenue |

**Revenue recognition note:** Subscription gross charges, paid active subscriber-months, free trials, beta access, collected cash, recognized revenue, refunds and net proceeds are different measures. Finance reporting must not treat them as interchangeable.

## 3. Historical source projection (NOT current forecast)

The 2026-11-03 first-year projection assumed **900 paid subscriber-months × $9.99 = $8,991 gross billings/sales**, with months 1–2 at zero paid subscribers and month 12 at 200 paid subscriber equivalents. The source excludes app-store fees, refunds, taxes, payment failures, AI/infrastructure, support, marketing and all other expenses. It does **not** establish available cash, sustainable profit, cash runway, actual demand, or a launch date.

Source: [First-Year Gross Sales Projection](./FIRST-YEAR-REVENUE-PROJECTION-2026-11-03.md). The [2026-10-22 referral/subscription transfer](./REFERRAL-SUBSCRIPTION-HANDOFF-2026-10-22-HISTORICAL.md) is historical: its $5/month price is superseded.

## 4. Unit economics (inputs to collect, not invented)

For a given month, measure:

- **Paying subscriber equivalents (P):** successfully paid subscriber-months, adjusted for refunds/partial periods as defined by finance reporting.
- **Gross subscription billings:** P × actual weighted billed price; $9.99 is the current nominal monthly rate, not necessarily net proceeds.
- **Store/payment fees, taxes collected/remitted, refunds/chargebacks:** from authoritative processor/store reports, by channel.
- **AI processing:** real cost by provider/model/feature, active and paying users, cached/retrieved usage; monitor average and high-cost tails.
- **Infrastructure:** Supabase/database, storage, media/CDN, push/email, observability, hosting, backups, domains, third-party licenses, build/distribution.
- **Operations:** support, compliance/legal, security, incident response, accessibility, accounting, insurance, moderation and merchandise fulfillment (where applicable).
- **Acquisition:** attributable production/content spend, referral reward cost, paid campaigns only if separately approved.

**Contribution per paying subscriber-month** = collected subscription receipts **minus** variable store/payment charges, variable AI, variable hosting/storage, refunds, variable support, and attributable referral/fulfillment expense (after treating taxes consistently). Do not count a trial user as a payer. **Monthly operating surplus/deficit** = total contribution **minus** fixed operating and required compliance expenses.

The below-$1 AI target is **not** the entire cost-to-serve target. Evaluate high-usage cohorts, nonpaying beta users, long Coach conversations and media processing independently. Design graceful limits, budgeting and abuse safeguards without hidden user-facing charges.

**Runway:** opening unrestricted operating cash ÷ average monthly net cash burn (only if burn is positive), with payment timing and founder funding assumptions separately disclosed. Current values are unknown; no runway estimate is authorized.

## 5. Planning scenarios, without fabricated adoption rates

Maintain three scenarios **only after actual input owners are identified**:

| Scenario | Acquisition | Trial→paid | Churn | Revenue | Cost/risk |
|---|---|---|---|---|---|
| Conservative | Founder beta/referrals only | Measured cohort results or labeled assumption | Measured or sensitivity-tested | Actual paid subscriber-months × realized price | High relative support, compliance and AI costs |
| Base | Repeatable organic/content pipeline proven | Observed cohorts | Observed cohorts | Same method | Budgeted operational and infrastructure costs |
| Upside | Incremental channels demonstrably converting | Observed cohorts | Observed cohorts | Same method | Additional moderation, scaling and support reserve |

Do not fill scenarios with unsupported conversion, CAC, retention or net margin percentages. Monthly cash flow must explicitly include the seven-day trial-to-first-charge lag, billing failures and refund timing.

## 6. Acquisition, activation and retention

**Pre-beta:** Establish product/legal truth, run internal end-to-end account and workout tests, prepare website/social identities and a truthful waitlist or invitation message. No public signup promise until legal, billing, data deletion and device gates pass. No marketing claim that a capability is integrated merely because source code exists.

**Founder beta:** First ~25–30 invited testers, expandable only after reliability and privacy feedback; represent experienced athletes and beginners. Record consent and beta terms; avoid charging beta participants absent a separately approved lawful flow. Focus on first successful sign-in, first useful workout/training/calendar action, first Coach value, clear support channel, crashes, data correctness and deletion/export handling.

**Post-beta:** Grow content-led acquisition (real training/meal prep demonstrations), customer referrals, accessible onboarding and clear plan/trial disclosures. Test messaging by actual user segment, rather than one elite-athlete narrative. Avoid paid acquisition until contribution margins, measurement and spending authorization are understood.

**Retention:** Review day 1/7/30 retention, trial activation, connected user rate, time-to-first-value, free-trial-to-paid conversion, billing failures, cancellation reasons, recovery/win-back and weekly Coach value. Segment beginners, running/endurance, strength, cycling/multisport and nutrition; protect privacy and minimize analytics collection.

## 7. Operations and ownership checklist

| Area | Accountable owner/authority | Gate / evidence required |
|---|---|---|
| Legal and privacy | Founder + qualified reviewer | Approved immutable Terms, Privacy, Founder Beta versions, effective dates, website and app references; ALL-219 |
| Privacy rights/account deletion | Existing V2 lifecycle owner ALL-251 | Actual in-app initiation, tested auth/worker/retention/receipts; not email-only as an App Store substitute |
| Signup/security | V2 Auth owner ALL-209 | Verified published policies, consent receipt and device tests before opening |
| Billing | V2 subscriptions owner ALL-252 | Store contract, trial/renewal/cancel/refund, entitlement reconciliation, sandbox and real device validation |
| Coach | Canonical Coach and domain owners | Persisted context, authorized read/write, user-approved mutations, bounded spend, safety validation |
| Reliability/data | V2 engineering and database owners | Restore/backup evidence, migration verification, monitored auth and owner isolation |
| Customer support | Founder to designate | Working contact route, response workflow, escalation and deletion request handoff |
| Finance/accounting | Founder to designate | Store statement reconciliation, sales taxes and business records |
| Brand/communications | Founder | Accurate public claims, logo/icon and typography, consistent terms |
| Launch decision | Founder | Explicit go/no-go checklist and sign-off; no silent launch |

Do not create shadow ownership systems: use current V2 feature issues, engineering gates and the existing brand/product authority.

## 8. Risks and decisions still open

1. **Legal approval:** Terms, Privacy, Founder Beta original source and V2 candidate redlines require human privacy/legal review, verified processing facts, founder signoff and controlled version publication.
2. **Account deletion:** In-app flow and backend destruction/retention are not proven; do not treat an Account menu entry as compliance.
3. **Backups/recovery:** Actual backup entitlement, schedule, restore acceptance and retention unverified; make no daily-backup promise.
4. **Processor inventory:** Confirm deployed AI, cloud, health data, analytics, subscription, email and push flows before final privacy text.
5. **Cost baseline:** Collect actual vendor plans, store fee treatment, taxes, required legal/accounting/insurance and support assumptions. No startup funds are assumed available by default.
6. **Economics:** Measure gross-to-net subscription receipts, AI cost per active user, infra cost per active user, trial conversion, churn, refunds and acquisition costs from observed cohorts.
7. **Annual and referrals:** Explicit approval of annual offering and unspecified reward tiers; confirm merchandising, fraud/abuse and fulfillment economics.
8. **Competitive validation:** Inventory actual alternatives and compare workflows/prices/permissions only with dated source evidence; no fabricated market-size or differentiation claims.
9. **Launch channels:** Confirm website, support mailbox and storefront legal URLs before invitation/ads; do not imply public accessibility merely because routes exist.
10. **Founder decision log:** Record final effective decisions in existing Linear or canonical V2 documents, with dates; preserve superseded historical sources for audit.

## 9. Release gates and next verification

1. Collect feature/data-processing map from current deployed V2 and reconcile against original V1 legal documents and proposed candidate amendments.
2. Complete ALL-251 in-app deletion and test data lifecycle; verify backup schedule/restore and actual service-provider processing.
3. Obtain qualified legal/privacy review and founder approval. Create final immutable exact text/hash/version/effective-date records; preserve historical source text.
4. Controlled V2-only legal publish, verified Settings/website URLs and signed consent receipts, then authenticated signup and installed-device testing. Do not touch V1/main or open signup prematurely.
5. Capture actual operating vendor costs and founder cash constraints; replace unknowns with source-dated figures and prepare controlled monthly cashflow sensitivity model.
6. Run a small founder beta and review the named reliability, activation, retention, safety, economics and accessibility measures before expanding.

## Source provenance

- [V2 brand and product authority](../product/ALL-IN-365-BRAND-AND-PRODUCT-OPERATING-AUTHORITY.md), itself citing V1 Durable Product & Launch and V1 Brand Authority dated 2026-10-31.
- [Founder Beta Legal Package — original source recovered from V1 website 2026-11-11](../legal/V1-WEBSITE-FOUNDER-BETA-LEGAL-SOURCE-2026-11-11.md). Status: website snapshot, **not** approved V2 legal publication.
- [Legal candidate redline / approval sheet, 2026-11-11](../legal/candidates/CHANGE-REVIEW-2026-11-11.md). Status: unapproved.
- [Historical first-year gross projection, prepared 2026-11-03](./FIRST-YEAR-REVENUE-PROJECTION-2026-11-03.md).
- [Historical referral and subscription handoff, 2026-10-22](./REFERRAL-SUBSCRIPTION-HANDOFF-2026-10-22-HISTORICAL.md).
- [ALL-219 V2 authority/acceptance contract](https://linear.app/allin365/issue/ALL-219/v1-v2-legal-business-plan-and-brand-authority-transfer).

No prospective number, legal assertion or unverified live integration in this working document is authorized as a final representation.
