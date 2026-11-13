-- ALL-230 / ALL-12: EXACT V1 scoped 17 FK constraints, CANDIDATE for OFFLINE restore.
-- Generated directly from original V1 pg_constraint/pg_get_constraintdef.
-- No production/staging execution authorized. Local offline target ONLY.
-- PRECONDITION: real Auth rows and profile-goals schema separately restored
-- with approved provenance; NEVER create placeholder auth.users identities.
-- A failed constraint must rollback ALL writes. Explicit BEGIN and COMMIT.
BEGIN;
ALTER TABLE allin_coach_learnings ADD CONSTRAINT allin_coach_learnings_superseded_by_fkey FOREIGN KEY (superseded_by) REFERENCES allin_coach_learnings(id);
ALTER TABLE allin_coach_learnings ADD CONSTRAINT allin_coach_learnings_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE allin_coach_thread_facts ADD CONSTRAINT allin_coach_thread_facts_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE allin_coach_thread_state ADD CONSTRAINT allin_coach_thread_state_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE allin_coaching_records ADD CONSTRAINT allin_coaching_records_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE allin_training ADD CONSTRAINT allin_training_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE allin_training_plan_versions ADD CONSTRAINT allin_training_plan_versions_goal_id_fkey FOREIGN KEY (goal_id) REFERENCES allin_profile_goals(id) ON DELETE SET NULL;
ALTER TABLE allin_training_plan_versions ADD CONSTRAINT allin_training_plan_versions_supersedes_plan_id_fkey FOREIGN KEY (supersedes_plan_id) REFERENCES allin_training_plan_versions(id) ON DELETE SET NULL;
ALTER TABLE allin_training_plan_versions ADD CONSTRAINT allin_training_plan_versions_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE allin_training_sessions ADD CONSTRAINT allin_training_sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE allin_workout_plan_links ADD CONSTRAINT allin_workout_plan_links_plan_id_fkey FOREIGN KEY (plan_id) REFERENCES allin_training_plan_versions(id) ON DELETE RESTRICT;
ALTER TABLE allin_workout_plan_links ADD CONSTRAINT allin_workout_plan_links_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE allin_workout_plan_links ADD CONSTRAINT allin_workout_plan_links_workout_id_fkey FOREIGN KEY (workout_id) REFERENCES allin_coaching_records(id) ON DELETE CASCADE;
ALTER TABLE allin_workout_sync_sources ADD CONSTRAINT allin_workout_sync_sources_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE allin_workout_sync_sources ADD CONSTRAINT allin_workout_sync_sources_workout_id_fkey FOREIGN KEY (workout_id) REFERENCES allin_coaching_records(id) ON DELETE CASCADE;
ALTER TABLE allin_workout_user_overrides ADD CONSTRAINT allin_workout_user_overrides_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE allin_workout_user_overrides ADD CONSTRAINT allin_workout_user_overrides_workout_id_fkey FOREIGN KEY (workout_id) REFERENCES allin_coaching_records(id) ON DELETE CASCADE;
COMMIT;
