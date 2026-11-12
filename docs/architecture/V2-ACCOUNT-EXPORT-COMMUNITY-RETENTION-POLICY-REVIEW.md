# ALL-251 / ALL-244 — Community relationship export and retention policy review

**Status: Proposed product/privacy contract, NOT final legal approval or authority to change production retention.**

## Ownership and exportable information

A relationship connects two people, but its internal synchronization state is not a user-facing record. Preserve the following separation in the **existing** canonical account export:

- **Outgoing follows/requests:** The athlete's own directed state and relevant dates.
- **Incoming follow requests:** The athlete's recipient-facing requests, except any pair blocked by either athlete. Historical blocked requests must not disclose the other athlete's private blocking decision.
- **Outgoing blocks:** Blocks that the exporting athlete initiated. **Never expose incoming block decisions**, including inferred equivalents.
- **Own action history:** Export `action_id`, action type, the athlete's target and action timestamp only. Never export `payload_sha256`, `expected_version`, `result_version`, shared lock ordering, or another person's private moderation decisions.
- **Shared pair-revision CAS rows:** Keep server-only. This is an internal version/locking mechanism, not an independent personal history. It is absent from inline and paginated user exports. Do not add a raw pair-revision collection.

The account archive still contains the athlete's user-visible actions. The omitted shared CAS value cannot be used to reconstruct an individual's complete social history and must not be claimed as such. Legal privacy review must decide whether a separate, non-identifying explanation of shared relationship synchronization is required.

## Retention and deletion (conservative implementation rule)

1. Preserve pair revisions while they are needed for active-account transaction ordering and replay safety. **Do not automatically purge an inactive pair by age:** removing CAS state can create stale-version/ABA acceptance and duplicate-action risks.
2. The existing Community schema references both profiles with `ON DELETE CASCADE`. Deleting either account should erase its shared pair-revision rows, follows, blocks and related actor/target action receipts in the same controlled account-deletion lifecycle. Cross-owner cascade must be regression-tested. Avoid retaining a copy in another unrestricted table.
3. Action receipts remain protected, access-restricted operational records while the account exists. Their final retention duration, audit exceptions, legal-hold requirements, and any legally required post-deletion minimal receipt belong to ALL-219/251 privacy/legal acceptance—not a guessed number of days.
4. All future Community content or events with user identity must register the exact owner and counterparty privacy rules in the canonical ALL-251 source inventory before release; new columns/tables fail closed.
5. Never represent a successfully exported user-owned view as permission to expose private third-party state. No service-role credentials or raw pair CAS records may reach the app.

## Verification / release gates

- Two independently authenticated account snapshots; blocked pair in either direction; unblocked owner history; account deletion cascade; service-only reader permissions.
- Exact parity between the inline snapshot and paginated reader: **no raw CAS or replay hashes**, blocked incoming requests removed in both.
- Recorded legal/privacy decision on the user-export scope and retention before changing `complete=false`.
- Production migration/deployment and deletion-worker activation still require separate approval.

No live policy, bucket, account, or retention schedule is modified by this review.
