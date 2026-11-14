-- ALL-251 staging review. The deployed attestation verifier already supports
-- cancel and records it through the same nonce uniqueness check as begin/settle.
-- This change preserves existing cleanup and account deletion fences.
ALTER TABLE allin_private.v2_privileged_storage_writer_nonces_review
 DROP CONSTRAINT v2_privileged_storage_writer_nonces_review_action_check,
 ADD CONSTRAINT v2_privileged_storage_writer_nonces_review_action_check
 CHECK (action IN ('begin', 'settle', 'cancel'));
