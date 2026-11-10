# ALL IN 365 V2

The independent ALL IN 365 V2 application repository.

## Current milestone

V2 foundation and existing-user authentication. The application uses a separate Expo app at `apps/mobile-v2/` and the dedicated V2 Supabase project. Do not import the legacy Native app's UI/routes or create a second identity system.

## Project resources

- Linear: https://linear.app/allin365/project/all-in-365-v2-rebuild-1a9ab6dddfca
- V2 Supabase: https://supabase.com/dashboard/project/xarhuczrtzuiljmtdaeu
- V1 reference repository: https://github.com/allinproject/ALL-IN

## Safety boundaries

- V2 development uses the V2 Supabase project. Never point V2 at V1 production by default.
- No production user data, secrets, service-role keys, or bulk data copies in this repository.
- Any future account continuity/data migration requires a separately reviewed and tested migration/cutover plan.
- Keep V1 available as reference/fallback until each V2 capability is independently accepted.
