# لمّة | Lamma

One mobile app (Expo / React Native) for every party: institution, independent driver, sorting station, Lamma operations.
Backend: PostgreSQL + PostGIS on Supabase (Auth, RLS, RPC). Weights are integer grams, money is integer fils (JOD, 3 decimals), times are UTC.

```
apps/mobile            the single app (Expo Router, Arabic RTL default, English second)
packages/domain        units, state machine, route planner (pure TypeScript, tested)
supabase/migrations    schema, RLS, business RPCs, read models
backend/worker         planning → automatic publication → assignment job
backend/dev            LOCAL ONLY: demo seed + dev gateway (stand-in for Supabase HTTP)
tests/db               SQL integration tests as real end-user roles
tests/e2e              browser journey across all roles + real screenshots
docs                   status, owner actions, test report, master prompt
```

## Run locally (no cloud account needed)
Requires Node 22 and PostgreSQL 16 with PostGIS on localhost (user `postgres`).

```bash
npm install
export PGPASSWORD=postgres
npm test                                   # 23 tests: 9 domain + 14 database
npx tsx backend/dev/seed.ts                # fictional demo data in database lamma_dev
LAMMA_DEV_GATEWAY=1 DEV_PASSWORD=lamma-dev npx tsx backend/dev/gateway.ts &
cd apps/mobile && cp .env.example .env.local   # set URL http://localhost:54321, any anon key
npx expo start --web                       # or: npx expo export -p web
```
Demo sign-ins (password = `DEV_PASSWORD`): `admin@`, `station@`, `owner1..6@`, `driver1..3@demo.lamma.test`.
End-to-end run with screenshots: `node tests/e2e/serve.mjs apps/mobile/dist & node tests/e2e/journey.mjs`.

## Production path
1. Create a Supabase project, enable PostGIS, apply `supabase/migrations` in order.
2. Create the first admin (service role, SQL editor): `select app.bootstrap_admin('<auth user id>');` — works once only.
3. Put `EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_ANON_KEY` in EAS environment. Never ship the service-role key.
4. Schedule `npm run worker:plan` (needs `DATABASE_URL`, `PLAN_START_LEAD_MIN`, `PLAN_DETOUR_FACTOR`, `PLAN_AVG_SPEED_KMH`).
See `docs/OWNER_ACTIONS.md` and `PROJECT_STATUS.md` for what is done, tested, and still open.
