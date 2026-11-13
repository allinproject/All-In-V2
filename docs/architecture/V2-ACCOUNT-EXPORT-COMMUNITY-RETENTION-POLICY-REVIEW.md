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

## 2026-11-13 implementation decision — export minimization and deletion boundaries

**Approved technical direction for review; not a substitute for ALL-219
privacy/legal acceptance or permission to activate hosted deletion.**

- **Posts:** Export the athlete-authored `community.my_posts` collection
  (including private and followers-only posts) *only* through the approved
  private, server-side, session- and request-bound owner archive; the normal
  Community feed is not an export source. Preserve content, source ID, edit
  version and timestamps. An arbitrary viewer must never receive this owner
  archive. Post source/media references require their own byte-coverage check.
- **Comments/replies/reactions:** There is **no approved canonical comment or
  reaction owner table in the current V2 Community source contract**. Do not
  create an export collection or declare content completeness from post rows
  alone. If Community comments are introduced, the canonical writer must
  capture both author and target/post ownership, parent-post audience, block
  state, moderation/retention policy, edit/tombstone history, and referenced
  media. A comment authored by one athlete on another's post is authored
  content for the first athlete, **not unrestricted content owned by the post
  owner**. Any private third-party text or moderation decision stays
  restricted. Export and deletion gates fail closed until independently tested.
- **Relationships:** The athlete may export **outgoing** follow states and
  outgoing blocks. Incoming *pending* or *approved* requests are only
  recipient-visible where neither direction has blocked the pair. Never export
  incoming blocks or raw counterpart CAS state. Use field-allowlisted
  projections, not `to_jsonb` of the entire relationship row. Owner-specific
  action receipts expose only action, target, ID and time.
- **Deletion:** The established cascade erases the deleting athlete's own
  posts, directed follows and blocks, pair revisions involving the athlete,
  and action receipts where the athlete is either actor or target. The
  survivor's unrelated posts and unrelated relationship histories remain
  intact. A comment authored by a deleting athlete must be deleted or
  irreversibly de-identified pursuant to an approved author/counterparty
  policy—**never** left with an identifying author ID or readable original
  private body by default. Do not purge shared CAS rows by age while both
  accounts are active. Do not execute a production delete until external
  media, Auth sessions, retention holds and backups are reconciled.
- **Retention:** Active Community content and necessary relationship CAS
  state remain only for the life of the corresponding account/relationship
  under the existing privacy design; no automatic age-based purge of active
  CAS. Deleted-account content must be absent from active owner tables and
  accessible private Storage after authorized deletion completion. Backup,
  abuse-report/moderation, deletion execution audit and legal-hold records
  remain **separate, least-privilege retention domains** pending a legally
  approved purpose and duration; none may be silently reused as the Community
  feed or user export. No arbitrary retention-day count is authorized here.

**Validation evidence/remaining gate:** Existing isolated two-account
post-export replay validates paginated owner A content, foreign owner and
session denial, unknown graph detection, and Auth→profile→post cascade. The
existing relationship privacy replay validates both block directions, actor
receipts, and Auth cascade. The canonical paginated reader now returns
explicit allowlisted outgoing follow/block fields rather than raw table rows;
its full-domain populated replay must pass before acceptance. **Comments
remain unimplemented and therefore not validated.** Legal sign-off for
post-deletion audit/backups/holds remains pending. The whole account export
must continue reporting `complete=false`.

## 2026-11-13 — Canonical comments/replies, retention and media acceptance

The **single** `allin_private.v2_community_posts` canonical post owner now
defines a **review-only** `v2_community_comments` author-owned child ledger.
The post reference is a real FK; a reply's parent-comment FK is scoped to
the same post. A comment author is not necessarily the post owner. A
commenter leaving removes that author's comments, **not** another
commenter's reply: the surviving reply's parent ID is cleared. Deleting the
post removes its comments and replies, including other authors' contributions
on that deleted parent. These semantics require explicit user-facing deletion
notice and legal/retention approval before releasing a writer.

- **Authorship:** An author-only `community.my_comments` projection is
  staged in the existing paginated reader. Only the author's ID, own body,
  post and reply IDs, revision/edit/deleted timestamps are included; parent
  post content, other authors' bodies, moderation details and internal
  relationship state are not included. It is **NOT registered**, and the
  complete user export stays false.
- **Audience:** A future comment writer/reader must recheck active
  authenticated session, parent-post audience, profile visibility, follow
  approval and **both directions of blocks** inside the same authorization
  boundary. Deleting or privatizing a post revokes external comment reads;
  the author export must never become a public comments feed. A parent reply
  cannot point to a different post. Unreviewed moderation/reports, likes,
  media URLs and comment mentions are not auto-exportable.
- **Deletion:** User deletion requires Auth/session revocation and
  verified removal of authored comments, action receipts, relevant pair CAS
  state and private media. A post owner's deletion removes its posts and
  their comments. Unrelated surviving author content elsewhere must not be
  deleted merely because the author interacted with a deleted person.
  The controlled worker stays OFF pending full graph and object-byte proof.
- **Retention decision pending:** No time limit is invented. The product
  rule is immediate removal from active tables and accessible private media
  when an authorized account deletion completes, subject to documented
  legal holds. Exact retention periods and access rules for backup copies,
  moderation/abuse evidence, support, audit proof and held data require
  **ALL-219 legal/privacy approval**. Legal approval has not been given by
  these source changes.
- **Private media completeness:** The existing authenticated ALL-251
  Storage integrity adapters prove checksummed **Training route/series**
  bytes only. The canonical Community post/comment schemas currently
  introduce **no approved attachment reference, bucket, source-key index,
  file-size or checksum contract**. Community image/video/voice attachments
  therefore remain unsupported and **must not** be reported as absent
  user data if a later schema/bucket is added. Any future Community media
  must have owner and parent post/comment linkage, exact private object
  path and digest, permission/redaction rules, paginated exhaustive
  owner-object scan, corrupt/missing/orphan detection, encrypted source-byte
  archive, account deletion/restore and two-owner denial. Unknown media
  buckets fail closed in the current media verifier.

**Technical evidence:** isolated PostgreSQL Community canonical post/comment
schema tests; A/B author-only comment projection through test-only inventory;
snapshot verification and redaction regression. **Not yet release
acceptance:** real Auth-backed comment writer and audience reader,
moderation policy, live media byte coverage, legal retention sign-off,
KMS-backed complete archive or positive hosted account export. Keep the
existing system and its `complete=false` gate.

## 2026-11-13 — Comment edit/delete and moderation decision checkpoint

**Implemented review-only SQL, no client grants or hosted deployment:**

- Comment authors can edit only their own visible, undeleted comment
  using the expected current revision. Stale writes and edits of hidden/held
  records fail; existing post identity and reply thread identity do not change.
- Explicit author deletion permanently replaces the active comment body
  with `[deleted]`, increments revision, timestamps deletion, and
  rejects resurrection. An exact duplicate delete may return the same
  result. Other authors' replies remain their own records.
- The canonical comment reader filters deleted and `held`/`hidden` comments
  **inside SQL**. It still checks post audience, approved follows, and both
  block directions. A held parent cannot receive a new reply.
- Moderation may mark comments `visible`, `held`, or `hidden` **only
  through future reviewed trusted operations**. No moderator identity,
  authority, report-triage workflow, appeal process, automated classifier,
  rate limit or audit-retention period is approved by this checkpoint.
  There is intentionally no exposed moderation RPC or public
  `UPDATE` grant. No user-facing feature should claim operational
  reporting/appeals until these are defined and tested.
- Before approving retention or actual deletion, counsel/privacy review must
  decide: notices for author-deleted versus moderator-hidden bodies, whether
  appeal/audit records need purpose-limited copies, abuse-evidence retention,
  backup expiration and legal holds, and how a post owner's deletion affects
  other authors' replies. This checkpoint does **not** set a duration or
  authorize retaining deleted private body text in a second store.

**Media:** No canonical Community attachment source with owner,
post/comment identity, private bucket/path, byte checksum and deletion
provenance has been approved. The existing ALL-251 Storage verifier remains
Training-only and rejects a new Community bucket; do not add a speculative
media table or treat absent references as proof there are no future media
files. An approved Community media source must be extended through the
existing canonical post/comment and Storage writer, then pass complete
owner-only enumeration, physical-byte checksums, KMS archive, cross-owner
denial, deletion and independent restore.

**Release state:** Review-only SQL and isolated PostgreSQL tests are not
hosted owner-session, rate-limit, moderation, legal or media acceptance.
Keep account-export complete=false and deletion worker disabled.
