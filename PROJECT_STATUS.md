# لمّة | Lamma — PROJECT_STATUS (2026-11-10)

## Done and tested (23 tests passing: `PGPASSWORD=postgres npm test`, needs local Postgres 16 + PostGIS)
- `supabase/migrations/0001_schema.sql` tables (grams, fils, UTC), `0002_security.sql` RLS default-deny + immutability triggers, `0003_functions.sql` business RPCs.
- Full journey in SQL: pickup request → publish_route → apply_to_route (eligibility) → assign_route (atomic) → start_route → arrive_stop → record_weights → sign_weights (institution account, hash-bound) → complete_stop → shipment notice → arrive_station → submit_station_receipt (only path to `completed`) → reconciliation (resolve_case / confirm_reviewed_receipt) → balanced ledger.
- `packages/domain`: units (fils/grams), state machine, planner (cheapest insertion + 2-opt, weight/volume/time constraints).
- `backend/worker/plan.ts`: automatic planning/publication/assignment job (idempotent).
- `tests/db/*`: run as real `authenticated` role with JWT sub (tests/db/shim.sql emulates Supabase auth).

## Not started
- `apps/mobile` (Expo + Expo Router + TypeScript, Arabic RTL default, one app for all roles: institution / driver / station / Lamma admin with role switcher).
- Supabase project (apply migrations), auth (phone OTP / email), storage buckets + policies, push.
- Reports/PDF, payouts & settlement, offline outbox, account deletion, admin UI for areas/materials, docs set (README, ARCHITECTURE, ROLE_PERMISSIONS, OWNER_ACTIONS, APP_STORE_RELEASE_CHECKLIST...).

## Next steps
1. Scaffold `apps/mobile` with create-expo-app, supabase-js, i18n (ar/en), design tokens (dark green, warm light background).
2. Screens over the existing RPCs: driver available routes (8 card fields) → apply → active route → weigh → wait for signature; institution request + sign weights; station inbound + receipt compare + confirm; admin reviews + cases.
3. Local dev backend: PostgREST against the local DB to run the app on web and take real screenshots.
4. Never invent figures; all thresholds/pay/tolerances come from admin config.
Master prompt: `docs/master-prompt-ar.txt`.
