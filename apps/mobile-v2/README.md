# V2 mobile application

This is the independent ALL IN 365 V2 Expo application.

## Current scope

- V2 sign-in screen and session adapter scaffold; fresh V2 account creation is a separate, upcoming slice.
- Persistent local session storage.
- Fail-closed legal acceptance and onboarding access gate.
- No Coach writes, recipe writes, or data migration yet.

## Backend warning

The dedicated V2 Supabase project (`xarhuczrtzuiljmtdaeu`) is currently empty and does not contain existing V1 users or history. The founder will create a fresh V2 account; V1 account credentials and Coach history are not being migrated. Signup remains disabled until the V2 schema and approved legal package are ready. Never place V1 production secrets or service-role keys in this repository.

## Local checks

1. Copy `.env.example` to `.env` only for isolated V2-development tests.
2. Install dependencies with the approved npm workflow (Node >=22.13).
3. Run `npm run test:auth` and `npm run typecheck`.
4. Start with `npm run start`.

Fresh V2 signup, live authentication, Coach operation, cookbook seed, canonical history and device installation are not yet validated.