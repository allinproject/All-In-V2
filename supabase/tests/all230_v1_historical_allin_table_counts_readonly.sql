-- ALL-230 / ALL-12: original V1 public.allin_* 183 table coverage counts.
-- Full aggregate, not full encrypted source snapshot or provider import proof.
-- Generated from read-only V1 catalog on 2026-11-13. This query fails closed
-- if public.allin_* current base table membership drifts from this manifest.
-- Read-only metadata/counts. No row payloads, private values or owner IDs.
WITH rows AS (
  SELECT 'allin_account_entitlements'::text AS table_name, count(*)::bigint AS rows FROM public.allin_account_entitlements
  UNION ALL
  SELECT 'allin_action_idempotency'::text AS table_name, count(*)::bigint AS rows FROM public.allin_action_idempotency
  UNION ALL
  SELECT 'allin_admin_audit_events'::text AS table_name, count(*)::bigint AS rows FROM public.allin_admin_audit_events
  UNION ALL
  SELECT 'allin_ai_cost_policy'::text AS table_name, count(*)::bigint AS rows FROM public.allin_ai_cost_policy
  UNION ALL
  SELECT 'allin_ai_deterministic_events'::text AS table_name, count(*)::bigint AS rows FROM public.allin_ai_deterministic_events
  UNION ALL
  SELECT 'allin_ai_model_response_samples'::text AS table_name, count(*)::bigint AS rows FROM public.allin_ai_model_response_samples
  UNION ALL
  SELECT 'allin_ai_model_route_history'::text AS table_name, count(*)::bigint AS rows FROM public.allin_ai_model_route_history
  UNION ALL
  SELECT 'allin_ai_model_routes'::text AS table_name, count(*)::bigint AS rows FROM public.allin_ai_model_routes
  UNION ALL
  SELECT 'allin_ai_monthly_rollups'::text AS table_name, count(*)::bigint AS rows FROM public.allin_ai_monthly_rollups
  UNION ALL
  SELECT 'allin_ai_policy_decisions'::text AS table_name, count(*)::bigint AS rows FROM public.allin_ai_policy_decisions
  UNION ALL
  SELECT 'allin_ai_usage_events'::text AS table_name, count(*)::bigint AS rows FROM public.allin_ai_usage_events
  UNION ALL
  SELECT 'allin_analytics_layouts'::text AS table_name, count(*)::bigint AS rows FROM public.allin_analytics_layouts
  UNION ALL
  SELECT 'allin_app_capabilities'::text AS table_name, count(*)::bigint AS rows FROM public.allin_app_capabilities
  UNION ALL
  SELECT 'allin_app_capability_audit'::text AS table_name, count(*)::bigint AS rows FROM public.allin_app_capability_audit
  UNION ALL
  SELECT 'allin_backup_restore_drills'::text AS table_name, count(*)::bigint AS rows FROM public.allin_backup_restore_drills
  UNION ALL
  SELECT 'allin_billing_events'::text AS table_name, count(*)::bigint AS rows FROM public.allin_billing_events
  UNION ALL
  SELECT 'allin_breathwork_sessions'::text AS table_name, count(*)::bigint AS rows FROM public.allin_breathwork_sessions
  UNION ALL
  SELECT 'allin_cancellation_feedback'::text AS table_name, count(*)::bigint AS rows FROM public.allin_cancellation_feedback
  UNION ALL
  SELECT 'allin_client_crash_events'::text AS table_name, count(*)::bigint AS rows FROM public.allin_client_crash_events
  UNION ALL
  SELECT 'allin_coach_learnings'::text AS table_name, count(*)::bigint AS rows FROM public.allin_coach_learnings
  UNION ALL
  SELECT 'allin_coach_messages'::text AS table_name, count(*)::bigint AS rows FROM public.allin_coach_messages
  UNION ALL
  SELECT 'allin_coach_profile_prompts'::text AS table_name, count(*)::bigint AS rows FROM public.allin_coach_profile_prompts
  UNION ALL
  SELECT 'allin_coach_regression_fixtures'::text AS table_name, count(*)::bigint AS rows FROM public.allin_coach_regression_fixtures
  UNION ALL
  SELECT 'allin_coach_regression_results'::text AS table_name, count(*)::bigint AS rows FROM public.allin_coach_regression_results
  UNION ALL
  SELECT 'allin_coach_regression_runs'::text AS table_name, count(*)::bigint AS rows FROM public.allin_coach_regression_runs
  UNION ALL
  SELECT 'allin_coach_signal_state'::text AS table_name, count(*)::bigint AS rows FROM public.allin_coach_signal_state
  UNION ALL
  SELECT 'allin_coach_thread_facts'::text AS table_name, count(*)::bigint AS rows FROM public.allin_coach_thread_facts
  UNION ALL
  SELECT 'allin_coach_thread_state'::text AS table_name, count(*)::bigint AS rows FROM public.allin_coach_thread_state
  UNION ALL
  SELECT 'allin_coaching_records'::text AS table_name, count(*)::bigint AS rows FROM public.allin_coaching_records
  UNION ALL
  SELECT 'allin_community_action_recovery_journal'::text AS table_name, count(*)::bigint AS rows FROM public.allin_community_action_recovery_journal
  UNION ALL
  SELECT 'allin_community_blocks'::text AS table_name, count(*)::bigint AS rows FROM public.allin_community_blocks
  UNION ALL
  SELECT 'allin_community_group_memberships'::text AS table_name, count(*)::bigint AS rows FROM public.allin_community_group_memberships
  UNION ALL
  SELECT 'allin_community_group_posts'::text AS table_name, count(*)::bigint AS rows FROM public.allin_community_group_posts
  UNION ALL
  SELECT 'allin_community_groups'::text AS table_name, count(*)::bigint AS rows FROM public.allin_community_groups
  UNION ALL
  SELECT 'allin_community_local_settings'::text AS table_name, count(*)::bigint AS rows FROM public.allin_community_local_settings
  UNION ALL
  SELECT 'allin_community_mutes'::text AS table_name, count(*)::bigint AS rows FROM public.allin_community_mutes
  UNION ALL
  SELECT 'allin_community_reports'::text AS table_name, count(*)::bigint AS rows FROM public.allin_community_reports
  UNION ALL
  SELECT 'allin_cooking_yield_diagnostics_daily'::text AS table_name, count(*)::bigint AS rows FROM public.allin_cooking_yield_diagnostics_daily
  UNION ALL
  SELECT 'allin_cooking_yield_observations'::text AS table_name, count(*)::bigint AS rows FROM public.allin_cooking_yield_observations
  UNION ALL
  SELECT 'allin_endurance_distance_performances'::text AS table_name, count(*)::bigint AS rows FROM public.allin_endurance_distance_performances
  UNION ALL
  SELECT 'allin_energy_preferences'::text AS table_name, count(*)::bigint AS rows FROM public.allin_energy_preferences
  UNION ALL
  SELECT 'allin_engagement_state'::text AS table_name, count(*)::bigint AS rows FROM public.allin_engagement_state
  UNION ALL
  SELECT 'allin_favorites'::text AS table_name, count(*)::bigint AS rows FROM public.allin_favorites
  UNION ALL
  SELECT 'allin_follows'::text AS table_name, count(*)::bigint AS rows FROM public.allin_follows
  UNION ALL
  SELECT 'allin_food_data_issues'::text AS table_name, count(*)::bigint AS rows FROM public.allin_food_data_issues
  UNION ALL
  SELECT 'allin_food_day_status'::text AS table_name, count(*)::bigint AS rows FROM public.allin_food_day_status
  UNION ALL
  SELECT 'allin_food_entries'::text AS table_name, count(*)::bigint AS rows FROM public.allin_food_entries
  UNION ALL
  SELECT 'allin_food_hero_assets'::text AS table_name, count(*)::bigint AS rows FROM public.allin_food_hero_assets
  UNION ALL
  SELECT 'allin_food_hero_categories'::text AS table_name, count(*)::bigint AS rows FROM public.allin_food_hero_categories
  UNION ALL
  SELECT 'allin_food_product_cache'::text AS table_name, count(*)::bigint AS rows FROM public.allin_food_product_cache
  UNION ALL
  SELECT 'allin_food_receipt_aliases'::text AS table_name, count(*)::bigint AS rows FROM public.allin_food_receipt_aliases
  UNION ALL
  SELECT 'allin_food_reuse_actions'::text AS table_name, count(*)::bigint AS rows FROM public.allin_food_reuse_actions
  UNION ALL
  SELECT 'allin_food_search_cache'::text AS table_name, count(*)::bigint AS rows FROM public.allin_food_search_cache
  UNION ALL
  SELECT 'allin_food_shortcuts'::text AS table_name, count(*)::bigint AS rows FROM public.allin_food_shortcuts
  UNION ALL
  SELECT 'allin_fueling_evidence_versions'::text AS table_name, count(*)::bigint AS rows FROM public.allin_fueling_evidence_versions
  UNION ALL
  SELECT 'allin_fueling_feedback'::text AS table_name, count(*)::bigint AS rows FROM public.allin_fueling_feedback
  UNION ALL
  SELECT 'allin_fueling_plans'::text AS table_name, count(*)::bigint AS rows FROM public.allin_fueling_plans
  UNION ALL
  SELECT 'allin_fueling_preferences'::text AS table_name, count(*)::bigint AS rows FROM public.allin_fueling_preferences
  UNION ALL
  SELECT 'allin_fueling_prompt_decisions'::text AS table_name, count(*)::bigint AS rows FROM public.allin_fueling_prompt_decisions
  UNION ALL
  SELECT 'allin_gear_mileage_contributions'::text AS table_name, count(*)::bigint AS rows FROM public.allin_gear_mileage_contributions
  UNION ALL
  SELECT 'allin_health_days'::text AS table_name, count(*)::bigint AS rows FROM public.allin_health_days
  UNION ALL
  SELECT 'allin_hydration_events'::text AS table_name, count(*)::bigint AS rows FROM public.allin_hydration_events
  UNION ALL
  SELECT 'allin_incident_postmortems'::text AS table_name, count(*)::bigint AS rows FROM public.allin_incident_postmortems
  UNION ALL
  SELECT 'allin_incidents'::text AS table_name, count(*)::bigint AS rows FROM public.allin_incidents
  UNION ALL
  SELECT 'allin_ingredient_profiles'::text AS table_name, count(*)::bigint AS rows FROM public.allin_ingredient_profiles
  UNION ALL
  SELECT 'allin_integration_health'::text AS table_name, count(*)::bigint AS rows FROM public.allin_integration_health
  UNION ALL
  SELECT 'allin_longest_distance_achievements'::text AS table_name, count(*)::bigint AS rows FROM public.allin_longest_distance_achievements
  UNION ALL
  SELECT 'allin_longest_distance_current'::text AS table_name, count(*)::bigint AS rows FROM public.allin_longest_distance_current
  UNION ALL
  SELECT 'allin_longest_distance_sports'::text AS table_name, count(*)::bigint AS rows FROM public.allin_longest_distance_sports
  UNION ALL
  SELECT 'allin_meal_prep_queue_items'::text AS table_name, count(*)::bigint AS rows FROM public.allin_meal_prep_queue_items
  UNION ALL
  SELECT 'allin_meal_prep_recovery_journal'::text AS table_name, count(*)::bigint AS rows FROM public.allin_meal_prep_recovery_journal
  UNION ALL
  SELECT 'allin_meal_prep_share_actions'::text AS table_name, count(*)::bigint AS rows FROM public.allin_meal_prep_share_actions
  UNION ALL
  SELECT 'allin_meal_workspace'::text AS table_name, count(*)::bigint AS rows FROM public.allin_meal_workspace
  UNION ALL
  SELECT 'allin_notification_events'::text AS table_name, count(*)::bigint AS rows FROM public.allin_notification_events
  UNION ALL
  SELECT 'allin_notification_preferences'::text AS table_name, count(*)::bigint AS rows FROM public.allin_notification_preferences
  UNION ALL
  SELECT 'allin_nutrition_targets'::text AS table_name, count(*)::bigint AS rows FROM public.allin_nutrition_targets
  UNION ALL
  SELECT 'allin_onboarding_progress'::text AS table_name, count(*)::bigint AS rows FROM public.allin_onboarding_progress
  UNION ALL
  SELECT 'allin_operational_errors'::text AS table_name, count(*)::bigint AS rows FROM public.allin_operational_errors
  UNION ALL
  SELECT 'allin_operational_retention_policy'::text AS table_name, count(*)::bigint AS rows FROM public.allin_operational_retention_policy
  UNION ALL
  SELECT 'allin_partner_attributions'::text AS table_name, count(*)::bigint AS rows FROM public.allin_partner_attributions
  UNION ALL
  SELECT 'allin_partners'::text AS table_name, count(*)::bigint AS rows FROM public.allin_partners
  UNION ALL
  SELECT 'allin_price_contributions'::text AS table_name, count(*)::bigint AS rows FROM public.allin_price_contributions
  UNION ALL
  SELECT 'allin_privacy_coverage_registry'::text AS table_name, count(*)::bigint AS rows FROM public.allin_privacy_coverage_registry
  UNION ALL
  SELECT 'allin_privacy_data_inventory'::text AS table_name, count(*)::bigint AS rows FROM public.allin_privacy_data_inventory
  UNION ALL
  SELECT 'allin_privacy_deletion_receipts'::text AS table_name, count(*)::bigint AS rows FROM public.allin_privacy_deletion_receipts
  UNION ALL
  SELECT 'allin_privacy_export_field_policy'::text AS table_name, count(*)::bigint AS rows FROM public.allin_privacy_export_field_policy
  UNION ALL
  SELECT 'allin_privacy_requests'::text AS table_name, count(*)::bigint AS rows FROM public.allin_privacy_requests
  UNION ALL
  SELECT 'allin_privacy_worker_control'::text AS table_name, count(*)::bigint AS rows FROM public.allin_privacy_worker_control
  UNION ALL
  SELECT 'allin_privacy_worker_jobs'::text AS table_name, count(*)::bigint AS rows FROM public.allin_privacy_worker_jobs
  UNION ALL
  SELECT 'allin_private_health_conditions'::text AS table_name, count(*)::bigint AS rows FROM public.allin_private_health_conditions
  UNION ALL
  SELECT 'allin_private_recipes'::text AS table_name, count(*)::bigint AS rows FROM public.allin_private_recipes
  UNION ALL
  SELECT 'allin_product_funnel_events'::text AS table_name, count(*)::bigint AS rows FROM public.allin_product_funnel_events
  UNION ALL
  SELECT 'allin_product_usage_daily'::text AS table_name, count(*)::bigint AS rows FROM public.allin_product_usage_daily
  UNION ALL
  SELECT 'allin_profile_goals'::text AS table_name, count(*)::bigint AS rows FROM public.allin_profile_goals
  UNION ALL
  SELECT 'allin_profile_invites'::text AS table_name, count(*)::bigint AS rows FROM public.allin_profile_invites
  UNION ALL
  SELECT 'allin_profile_photos'::text AS table_name, count(*)::bigint AS rows FROM public.allin_profile_photos
  UNION ALL
  SELECT 'allin_profile_races'::text AS table_name, count(*)::bigint AS rows FROM public.allin_profile_races
  UNION ALL
  SELECT 'allin_profiles'::text AS table_name, count(*)::bigint AS rows FROM public.allin_profiles
  UNION ALL
  SELECT 'allin_progress_photos'::text AS table_name, count(*)::bigint AS rows FROM public.allin_progress_photos
  UNION ALL
  SELECT 'allin_push_delivery_attempts'::text AS table_name, count(*)::bigint AS rows FROM public.allin_push_delivery_attempts
  UNION ALL
  SELECT 'allin_push_devices'::text AS table_name, count(*)::bigint AS rows FROM public.allin_push_devices
  UNION ALL
  SELECT 'allin_race_course_profiles'::text AS table_name, count(*)::bigint AS rows FROM public.allin_race_course_profiles
  UNION ALL
  SELECT 'allin_race_event_urls'::text AS table_name, count(*)::bigint AS rows FROM public.allin_race_event_urls
  UNION ALL
  SELECT 'allin_race_events'::text AS table_name, count(*)::bigint AS rows FROM public.allin_race_events
  UNION ALL
  SELECT 'allin_race_groups'::text AS table_name, count(*)::bigint AS rows FROM public.allin_race_groups
  UNION ALL
  SELECT 'allin_race_memberships'::text AS table_name, count(*)::bigint AS rows FROM public.allin_race_memberships
  UNION ALL
  SELECT 'allin_race_posts'::text AS table_name, count(*)::bigint AS rows FROM public.allin_race_posts
  UNION ALL
  SELECT 'allin_race_provider_results'::text AS table_name, count(*)::bigint AS rows FROM public.allin_race_provider_results
  UNION ALL
  SELECT 'allin_race_result_matches'::text AS table_name, count(*)::bigint AS rows FROM public.allin_race_result_matches
  UNION ALL
  SELECT 'allin_race_result_poll_jobs'::text AS table_name, count(*)::bigint AS rows FROM public.allin_race_result_poll_jobs
  UNION ALL
  SELECT 'allin_race_result_provider_mappings'::text AS table_name, count(*)::bigint AS rows FROM public.allin_race_result_provider_mappings
  UNION ALL
  SELECT 'allin_race_strategies'::text AS table_name, count(*)::bigint AS rows FROM public.allin_race_strategies
  UNION ALL
  SELECT 'allin_race_url_submissions'::text AS table_name, count(*)::bigint AS rows FROM public.allin_race_url_submissions
  UNION ALL
  SELECT 'allin_recipe_component_mappings'::text AS table_name, count(*)::bigint AS rows FROM public.allin_recipe_component_mappings
  UNION ALL
  SELECT 'allin_recipe_cooking_notes'::text AS table_name, count(*)::bigint AS rows FROM public.allin_recipe_cooking_notes
  UNION ALL
  SELECT 'allin_recipe_discovery_dismissals'::text AS table_name, count(*)::bigint AS rows FROM public.allin_recipe_discovery_dismissals
  UNION ALL
  SELECT 'allin_recipe_favorites'::text AS table_name, count(*)::bigint AS rows FROM public.allin_recipe_favorites
  UNION ALL
  SELECT 'allin_recipe_feedback'::text AS table_name, count(*)::bigint AS rows FROM public.allin_recipe_feedback
  UNION ALL
  SELECT 'allin_recipe_image_allowed_hosts'::text AS table_name, count(*)::bigint AS rows FROM public.allin_recipe_image_allowed_hosts
  UNION ALL
  SELECT 'allin_recipe_my_versions'::text AS table_name, count(*)::bigint AS rows FROM public.allin_recipe_my_versions
  UNION ALL
  SELECT 'allin_recipe_rating_prompts'::text AS table_name, count(*)::bigint AS rows FROM public.allin_recipe_rating_prompts
  UNION ALL
  SELECT 'allin_recipe_selection_presets'::text AS table_name, count(*)::bigint AS rows FROM public.allin_recipe_selection_presets
  UNION ALL
  SELECT 'allin_recipe_selector_options'::text AS table_name, count(*)::bigint AS rows FROM public.allin_recipe_selector_options
  UNION ALL
  SELECT 'allin_recipe_selectors'::text AS table_name, count(*)::bigint AS rows FROM public.allin_recipe_selectors
  UNION ALL
  SELECT 'allin_recipes'::text AS table_name, count(*)::bigint AS rows FROM public.allin_recipes
  UNION ALL
  SELECT 'allin_recovery_morning_snapshots'::text AS table_name, count(*)::bigint AS rows FROM public.allin_recovery_morning_snapshots
  UNION ALL
  SELECT 'allin_referral_codes'::text AS table_name, count(*)::bigint AS rows FROM public.allin_referral_codes
  UNION ALL
  SELECT 'allin_referral_reward_catalog'::text AS table_name, count(*)::bigint AS rows FROM public.allin_referral_reward_catalog
  UNION ALL
  SELECT 'allin_referral_rewards'::text AS table_name, count(*)::bigint AS rows FROM public.allin_referral_rewards
  UNION ALL
  SELECT 'allin_referrals'::text AS table_name, count(*)::bigint AS rows FROM public.allin_referrals
  UNION ALL
  SELECT 'allin_release_manual_gates'::text AS table_name, count(*)::bigint AS rows FROM public.allin_release_manual_gates
  UNION ALL
  SELECT 'allin_release_safety_snapshots'::text AS table_name, count(*)::bigint AS rows FROM public.allin_release_safety_snapshots
  UNION ALL
  SELECT 'allin_retention_outreach'::text AS table_name, count(*)::bigint AS rows FROM public.allin_retention_outreach
  UNION ALL
  SELECT 'allin_retention_preferences'::text AS table_name, count(*)::bigint AS rows FROM public.allin_retention_preferences
  UNION ALL
  SELECT 'allin_run_performances'::text AS table_name, count(*)::bigint AS rows FROM public.allin_run_performances
  UNION ALL
  SELECT 'allin_run_pr_achievements'::text AS table_name, count(*)::bigint AS rows FROM public.allin_run_pr_achievements
  UNION ALL
  SELECT 'allin_run_pr_current'::text AS table_name, count(*)::bigint AS rows FROM public.allin_run_pr_current
  UNION ALL
  SELECT 'allin_run_pr_distances'::text AS table_name, count(*)::bigint AS rows FROM public.allin_run_pr_distances
  UNION ALL
  SELECT 'allin_running_prediction_snapshots'::text AS table_name, count(*)::bigint AS rows FROM public.allin_running_prediction_snapshots
  UNION ALL
  SELECT 'allin_security_definer_allowlist'::text AS table_name, count(*)::bigint AS rows FROM public.allin_security_definer_allowlist
  UNION ALL
  SELECT 'allin_shared_prices'::text AS table_name, count(*)::bigint AS rows FROM public.allin_shared_prices
  UNION ALL
  SELECT 'allin_social_comments'::text AS table_name, count(*)::bigint AS rows FROM public.allin_social_comments
  UNION ALL
  SELECT 'allin_social_food_snapshots'::text AS table_name, count(*)::bigint AS rows FROM public.allin_social_food_snapshots
  UNION ALL
  SELECT 'allin_social_kudos'::text AS table_name, count(*)::bigint AS rows FROM public.allin_social_kudos
  UNION ALL
  SELECT 'allin_social_meal_prep_snapshots'::text AS table_name, count(*)::bigint AS rows FROM public.allin_social_meal_prep_snapshots
  UNION ALL
  SELECT 'allin_social_posts'::text AS table_name, count(*)::bigint AS rows FROM public.allin_social_posts
  UNION ALL
  SELECT 'allin_social_pr_snapshots'::text AS table_name, count(*)::bigint AS rows FROM public.allin_social_pr_snapshots
  UNION ALL
  SELECT 'allin_social_profiles'::text AS table_name, count(*)::bigint AS rows FROM public.allin_social_profiles
  UNION ALL
  SELECT 'allin_social_race_links'::text AS table_name, count(*)::bigint AS rows FROM public.allin_social_race_links
  UNION ALL
  SELECT 'allin_social_workout_links'::text AS table_name, count(*)::bigint AS rows FROM public.allin_social_workout_links
  UNION ALL
  SELECT 'allin_stair_weekly_challenge_achievements'::text AS table_name, count(*)::bigint AS rows FROM public.allin_stair_weekly_challenge_achievements
  UNION ALL
  SELECT 'allin_stair_weekly_challenge_attempts'::text AS table_name, count(*)::bigint AS rows FROM public.allin_stair_weekly_challenge_attempts
  UNION ALL
  SELECT 'allin_stair_weekly_challenge_leaderboard'::text AS table_name, count(*)::bigint AS rows FROM public.allin_stair_weekly_challenge_leaderboard
  UNION ALL
  SELECT 'allin_stair_weekly_challenges'::text AS table_name, count(*)::bigint AS rows FROM public.allin_stair_weekly_challenges
  UNION ALL
  SELECT 'allin_storage_cleanup_jobs'::text AS table_name, count(*)::bigint AS rows FROM public.allin_storage_cleanup_jobs
  UNION ALL
  SELECT 'allin_strength_session_sets'::text AS table_name, count(*)::bigint AS rows FROM public.allin_strength_session_sets
  UNION ALL
  SELECT 'allin_strength_sessions'::text AS table_name, count(*)::bigint AS rows FROM public.allin_strength_sessions
  UNION ALL
  SELECT 'allin_support_case_events'::text AS table_name, count(*)::bigint AS rows FROM public.allin_support_case_events
  UNION ALL
  SELECT 'allin_support_cases'::text AS table_name, count(*)::bigint AS rows FROM public.allin_support_cases
  UNION ALL
  SELECT 'allin_support_diagnostics'::text AS table_name, count(*)::bigint AS rows FROM public.allin_support_diagnostics
  UNION ALL
  SELECT 'allin_support_priority_policy'::text AS table_name, count(*)::bigint AS rows FROM public.allin_support_priority_policy
  UNION ALL
  SELECT 'allin_training'::text AS table_name, count(*)::bigint AS rows FROM public.allin_training
  UNION ALL
  SELECT 'allin_training_equipment_samples'::text AS table_name, count(*)::bigint AS rows FROM public.allin_training_equipment_samples
  UNION ALL
  SELECT 'allin_training_plan_route_attachments'::text AS table_name, count(*)::bigint AS rows FROM public.allin_training_plan_route_attachments
  UNION ALL
  SELECT 'allin_training_plan_versions'::text AS table_name, count(*)::bigint AS rows FROM public.allin_training_plan_versions
  UNION ALL
  SELECT 'allin_training_routes'::text AS table_name, count(*)::bigint AS rows FROM public.allin_training_routes
  UNION ALL
  SELECT 'allin_training_sessions'::text AS table_name, count(*)::bigint AS rows FROM public.allin_training_sessions
  UNION ALL
  SELECT 'allin_user_connections'::text AS table_name, count(*)::bigint AS rows FROM public.allin_user_connections
  UNION ALL
  SELECT 'allin_user_race_results'::text AS table_name, count(*)::bigint AS rows FROM public.allin_user_race_results
  UNION ALL
  SELECT 'allin_user_recipe_ratings'::text AS table_name, count(*)::bigint AS rows FROM public.allin_user_recipe_ratings
  UNION ALL
  SELECT 'allin_user_recipes'::text AS table_name, count(*)::bigint AS rows FROM public.allin_user_recipes
  UNION ALL
  SELECT 'allin_weather_gear_feedback'::text AS table_name, count(*)::bigint AS rows FROM public.allin_weather_gear_feedback
  UNION ALL
  SELECT 'allin_weekly_challenge_achievements'::text AS table_name, count(*)::bigint AS rows FROM public.allin_weekly_challenge_achievements
  UNION ALL
  SELECT 'allin_weekly_challenge_attempts'::text AS table_name, count(*)::bigint AS rows FROM public.allin_weekly_challenge_attempts
  UNION ALL
  SELECT 'allin_weekly_challenge_leaderboard'::text AS table_name, count(*)::bigint AS rows FROM public.allin_weekly_challenge_leaderboard
  UNION ALL
  SELECT 'allin_weekly_challenges'::text AS table_name, count(*)::bigint AS rows FROM public.allin_weekly_challenges
  UNION ALL
  SELECT 'allin_weight_entries'::text AS table_name, count(*)::bigint AS rows FROM public.allin_weight_entries
  UNION ALL
  SELECT 'allin_workout_deletion_receipts'::text AS table_name, count(*)::bigint AS rows FROM public.allin_workout_deletion_receipts
  UNION ALL
  SELECT 'allin_workout_plan_links'::text AS table_name, count(*)::bigint AS rows FROM public.allin_workout_plan_links
  UNION ALL
  SELECT 'allin_workout_plan_match_candidates'::text AS table_name, count(*)::bigint AS rows FROM public.allin_workout_plan_match_candidates
  UNION ALL
  SELECT 'allin_workout_plan_match_controls'::text AS table_name, count(*)::bigint AS rows FROM public.allin_workout_plan_match_controls
  UNION ALL
  SELECT 'allin_workout_sync_sources'::text AS table_name, count(*)::bigint AS rows FROM public.allin_workout_sync_sources
  UNION ALL
  SELECT 'allin_workout_user_overrides'::text AS table_name, count(*)::bigint AS rows FROM public.allin_workout_user_overrides
), catalog AS (
 SELECT count(*)::bigint AS allin_tables
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public' AND c.relkind='r' AND c.relname LIKE 'allin_%'
)
SELECT jsonb_build_object(
 'scope','public.allin_base_tables',
 'sourceProjectRef','impulecgsgaruvniuttc',
 'observedUtc',clock_timestamp(),
 'manifestTables',(SELECT count(*) FROM rows),
 'liveCatalogTables',(SELECT allin_tables FROM catalog),
 'membershipMatches',(SELECT allin_tables=183 FROM catalog),
 'nonemptyTableCount',(SELECT count(*) FROM rows WHERE rows>0),
 'totalRows',(SELECT sum(rows) FROM rows),
 'nonemptyTableCounts',(SELECT coalesce(jsonb_agg(jsonb_build_object('table',table_name,'rows',rows) ORDER BY table_name),'[]'::jsonb) FROM rows WHERE rows>0),
 'importProviderJobHistoryProven',false,
 'fullV1SchemaAndStorageCoverageProven',false,
 'ownerRestrictionCertificationAuthorized',false
) AS historical_public_table_inventory;
