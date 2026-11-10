# ALL IN 365 V2 mobile foundation

This is a new, isolated Expo application path. It intentionally does not import the legacy `Native/` application's route components or stores.

## First slice status

- V2 app shell and routes: scaffolded.
- Supabase Auth adapter: uses the existing project's public URL/publishable key and persistent Expo SQLite-backed localStorage.
- Existing-account email/password sign-in, session restore and sign-out: implemented in source.
- Auth route-state unit tests: added.
- Real credentials, device install and live existing-account acceptance: not yet run.

## Local setup

1. Copy `.env.example` to `.env` and fill it with the same existing ALL IN 365 Supabase project URL and publishable key used by the current Native app. Do not add service-role keys.
2. Install dependencies from this directory with the repository-approved npm workflow.
3. Run `npm run typecheck`, `npm run test:auth`, then `npm run start`.

Do not add production credentials to the repository. V2 currently exposes only a minimal authenticated shell; no Coach or recipe write is claimed yet.
