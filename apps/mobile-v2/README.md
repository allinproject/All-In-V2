# V2 mobile application

This is the independent ALL IN 365 V2 Expo application.

## Current scope

- Existing-account sign-in screen and session adapter scaffold.
- Persistent local session storage.
- Fail-closed legal acceptance and onboarding access gate.
- No Coach writes, recipe writes, or data migration yet.

## Backend warning

The dedicated V2 Supabase project (`xarhuczrtzuiljmtdaeu`) is currently empty and does not contain existing V1 users or history. Do not assume existing credentials work against it. Do not connect this app to V2 for real-user sign-in until the identity and data-continuity strategy is approved. Never place V1 production secrets or service-role keys in this repository.

## Local checks

1. Copy `.env.example` to `.env` only for isolated V2-development tests.
2. Install dependencies with the approved npm workflow (Node >=22.13).
3. Run `npm run test:auth` and `npm run typecheck`.
4. Start with `npm run start`.

Real-user authentication, Coach continuity, canonical history and device installation are not yet validated.