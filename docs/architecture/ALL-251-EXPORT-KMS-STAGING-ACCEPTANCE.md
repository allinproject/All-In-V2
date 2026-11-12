# ALL-251 — Server-side export key management acceptance

**Scope:** existing Profile account-export lifecycle only. The owner/session/request
approval gate is canonical. The Edge download endpoint remains OFF and the full
export inventory is intentionally `complete=false`. No new customer data store.

## Provider choice

Use a customer-managed symmetric AWS KMS key with `GenerateDataKey(AES_256)`
and `Decrypt` via the server-only `createAwsKmsExportKeyProvider`. The adapter
is in `supabase/functions/_shared/trainingExportAwsKms.mjs`; it accepts
`KMSClient`, `GenerateDataKeyCommand`, and `DecryptCommand` from the official
AWS SDK v3. It exposes the existing `unwrapDataKey` dependency to
`createAccountExportKeyLease`. Never initialize it in mobile or browser code.

No KMS key, IAM role, AWS account, or billable resource has been provisioned.
As of 2026-11-12, AWS lists a customer-managed key at **$1 per key/month**
(prorated) plus API usage above the applicable request free tier; rotation can
increase that base charge. The AWS cost requires explicit founder approval
before creating resources. Do not make a separate provider account merely for
the temporary staging project, which has a deletion reminder for 2026-11-13.

## Required production contract (not deployed)

- Use an approved **server-only identity** with least-privilege
  `kms:GenerateDataKey` and `kms:Decrypt` on one exact symmetric KMS key ARN;
  no wildcard KMS grants or shared application credentials.
- Require KMS encryption context `purpose=account-export-v2`,
  `keyVersion=1`, and a SHA-256 scope digest bound to owner and export request.
  Do not log plaintext owner IDs in KMS encryption context; AWS CloudTrail
  records that context.
- Generate a unique AES-256 data key for **each approved export request**.
  Persist only the KMS-wrapped data key, exact KMS key ARN/version, purpose,
  owner/request identity and short expiry in the owning private export-request
  schema. Never store the plaintext key, mobile secret, or public download URL.
  Secure database retention, deletion and backup recovery must be reviewed
  before introducing any production columns.
- On EVERY unwrap, recheck owner, active Auth session, exact approved request,
  cancellation, expiry, key ARN and version **both before and after** KMS.
  A racing revocation must zero the unwrapped key and deny the archive.
- Treat AWS outage/timeout, access denied, disabled key, wrong context,
  key version mismatch, missing lease, or malformed ciphertext as failures.
  Never fall back to a hardcoded, database, test or mobile encryption key.
- Rotation: create a new key version only with an explicit writer contract and
  acceptance. Keep prior KMS key material accessible until every encrypted
  archive under it has expired and verified retention cleanup completed.
  Revoking an export request does not require destruction of the master key.
- The archive worker and HTTP endpoint MUST stay disabled until full-domain
  owner-data inventory, durable lease writer, server IAM identity, verified
  provider connection, and hosted owner/B/revoked-session HTTP tests are complete.

## Test evidence levels

**Isolated:** `trainingExportAwsKms.node.test.mjs` uses an in-memory
cryptographic fake implementing the SDK command protocol. It validates
GenerateDataKey and Decrypt, identical authenticated context, exact key ARN,
rotation and revocation, AWS outage failure, and canonical lease revalidation.
This does **not** demonstrate calls to an actual AWS KMS service.

**Hosted acceptance (not yet executed):** for a small temporary synthetic
fixture, prove provider `GenerateDataKey` and `Decrypt` with the exact
approved ARN and grant policy, unique request identity binding, denied B and
revoked requests, tampered encrypted page denial, then securely delete all
synthetic fixtures and verify zero orphan private objects. No production users,
tokens, data or long-lived AWS secrets in Actions logs.

## Sources

- https://docs.aws.amazon.com/kms/latest/developerguide/encrypt_context.html
- https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/client/kms/
- https://aws.amazon.com/kms/pricing/
- https://supabase.com/docs/guides/database/vault

Supabase Vault is an encrypted **database-resident** secret store and has
different isolation/recovery properties from an external provider-managed
KMS; do not silently substitute Vault for the requested KMS gate.
