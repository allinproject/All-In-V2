-- ALL-228/ALL-222: protected, READ-ONLY canonical mapping reader capability.
-- REVIEW-ONLY SQL candidate, NOT a migration. DO NOT apply to production.
-- Depends on the existing canonical catalog candidate; no new catalog, view,
-- SECURITY DEFINER function, credentials, workload login or publisher role.
-- The owner must approve and migrate this separately after recovery acceptance.
--
-- Only a separately authenticated, least-privileged server-side workload login
-- may be granted this NOLOGIN role by controlled credential provisioning.
-- Never grant it to anon/authenticated/service_role or expose via Data API.
DO $$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='allin_v2_ingredient_catalog_reader') THEN
   CREATE ROLE allin_v2_ingredient_catalog_reader NOLOGIN NOINHERIT NOBYPASSRLS;
 END IF;
END $$;

GRANT USAGE ON SCHEMA public TO allin_v2_ingredient_catalog_reader;
GRANT SELECT ON TABLE
 public.v2_ingredients,
 public.v2_ingredient_source_records,
 public.v2_ingredient_profile_sources,
 public.v2_ingredient_nutrition_profiles
TO allin_v2_ingredient_catalog_reader;

-- Candidate food rows must be visible to this precise service reader ONLY;
-- athlete policies remain calculation_ready-only and no writable policy exists.
-- This access must not be inherited by or granted to user-facing roles.
CREATE POLICY v2_ingredient_catalog_reader_select
 ON public.v2_ingredients FOR SELECT TO allin_v2_ingredient_catalog_reader USING (true);
CREATE POLICY v2_source_catalog_reader_select
 ON public.v2_ingredient_source_records FOR SELECT TO allin_v2_ingredient_catalog_reader USING (true);
CREATE POLICY v2_profile_source_catalog_reader_select
 ON public.v2_ingredient_profile_sources FOR SELECT TO allin_v2_ingredient_catalog_reader USING (true);
CREATE POLICY v2_profile_catalog_reader_select
 ON public.v2_ingredient_nutrition_profiles FOR SELECT TO allin_v2_ingredient_catalog_reader USING (true);

-- Deliberately no GRANT INSERT/UPDATE/DELETE, no BYPASSRLS, no workload LOGIN,
-- no grant to PUBLIC/anon/authenticated/service_role, no calculation_ready.
