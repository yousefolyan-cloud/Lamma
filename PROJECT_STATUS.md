# لمّة | Lamma — PROJECT_STATUS (2026-11-11)

Legend: ✅ implemented and tested here · 🟡 implemented, not tested on a real device / real Supabase · ⛔ not built yet

## ✅ Implemented and tested (commands run in this workspace)
- `npm test` → 26 passing (9 domain, 17 database). Database tests run as the real `authenticated` role with a JWT `sub`.
- Browser end-to-end `tests/e2e/journey.mjs` → "E2E OK": the real app (web build) driven as driver, 3 institution delegates, station clerk and admin, against the real SQL. 20 real screenshots in `docs/screenshots/`.
- Configuration screens (2026-11-11): Lamma settings tab (areas, materials, per-area thresholds, pay/timing/tolerance policy, required driver documents), station materials & prices tab, driver vehicle / scale / document tab. Migration `0005_config.sql` adds `admin_upsert_area`, `admin_upsert_material`, `admin_set_required_document` (ops only, audited). Browser run `tests/e2e/config.mjs` → "CONFIG E2E OK" (screenshots 21–28).
- Evidence photos (2026-11-11): driver attaches a photo to a document or scale check (`expo-image-picker`), stored in the private Storage bucket `evidence` under `driver/<user id>/`; Lamma staff open it from the approvals screen through a 2-minute signed link. Migration `0006_storage.sql`: bucket + policies (own folder insert, own/Lamma read, no update/delete), path check in `add_driver_document` / `add_driver_scale`. Policies tested locally against a stand-in `storage.objects`; NOT yet exercised against the hosted Storage API or on a phone.
- `tsc --noEmit` clean for domain, tests, backend and the app; `expo export -p web` builds.
- Journey: pickup request → route published → driver sees the 8 card fields → apply (eligibility) → atomic assignment → start → arrive → weigh (gross/tare/net per material) → institution signs on its own account (bound to the data hash) → auto-advance → "shipment on the way" → arrive at station → station compares against SIGNED weights → "confirm receipt" completes the route (only path) → balanced ledger entries. Mismatch / rejection → review case, route stays open.
- One app, role switcher from server-approved contexts, role UI re-mounted on switch. Arabic RTL default + English.

## 🟡 Implemented but not verified where it matters
- Native iOS/Android build: not built (no Apple/EAS account here). Only the web build was run. SecureStore session storage, fonts and RTL on a real phone are untested.
- Real Supabase project `lamma` (ref `vpzqhjaccdtnzplsvyyl`, eu-central-1): all migrations (0001–0005) applied on 2026-11-11; 0001–0004 verified against the local reference by fingerprint (63 functions, 293 columns, 40 policies, 189 constraints, 66 indexes, 9 triggers, RLS on 36 tables, 0 functions executable by `anon`: all identical). NOT yet done there: no users, no admin bootstrap, no reference data (areas, materials, policies), and the app has not been run against it (this workspace cannot reach `*.supabase.co` over HTTPS; only the management connector works). Client values are in `apps/mobile/.env.production.example`.
- Known Supabase advisor items left: PostGIS lives in `public`, so `spatial_ref_sys` (public coordinate-system reference data, owned by `supabase_admin`) has no RLS and `st_estimatedextent` is callable; neither exposes Lamma data. The "SECURITY DEFINER callable by authenticated" warnings are by design: every RPC checks the caller's role itself.
- Planning worker: tested through the DB tests; no scheduler is deployed. Distances are great-circle ESTIMATES (flagged in the UI); no road-distance provider is wired.
- Auth is email + password. Phone OTP needs an SMS provider that serves Jordan (owner decision).

## ⛔ Not built yet (real gaps, not hidden)
- Photos for station scale tickets, stop evidence and drawn signatures; QR handover code.
- Offline outbox and sync centre (server side is idempotent via client event ids; the app does not queue offline yet).
- Monthly reports and Arabic PDF, certificates, auditor role screens, recycling evidence chain, impact/credits module.
- Payouts and settlements (ledger records sale + driver payable only), accounting export.
- Staff & branch management, support tickets, push notifications, background location, account deletion & data export, MFA.
- Route cancellation / re-assignment / driver withdrawal after assignment, recurring pickups, corrections after a stop is completed.
- App Store assets, privacy manifest review, legal drafts, cost table, CI, remaining docs (ARCHITECTURE, ROLE_PERMISSIONS, DATA_MODEL, API_SPEC, BUSINESS_RULES, SECURITY_AND_PRIVACY, OPERATIONS_RUNBOOK, APP_STORE_RELEASE_CHECKLIST).

## Decisions and assumptions
- Visual design (owner choice 2026-11-11): palette 'fresh' from the Canva brand board (green #198751 / #2DB36E, mint #E8F6EF, amber #F2A225, white); white headers, pill buttons, logo on sign-in. Typeface: Tajawal (owner choice).
- Demo numbers in `backend/dev/seed.ts` (thresholds, pay 10 + 1/stop JOD, prices, density) are fictional fixtures. Nothing is hard-coded in the product: missing policy blocks publication.
- No approved weight tolerance → tolerance is zero and any difference goes to review.
- Assignment rule `assignment-v1`: fewest routes in the last 30 days, then earliest application.
- Bundle id `com.lamma.app` is a placeholder until the owner confirms it.
- Expo SDK 58 / React Native 0.88 / Expo Router 58 (versions from `expo/bundledNativeModules.json`).

## Next steps (in order)
1. Owner: sign up in the app once so the first admin can be bootstrapped (`select app.bootstrap_admin('<user id>')`). Then enter real reference data from the Settings tab (areas, materials, thresholds, pay policy) and station prices: none is invented.
2. Owner: create the Expo project and connect the GitHub repo (base directory `apps/mobile`), then put its id in `app.json` → `extra.eas.projectId`; `eas.json` already has development / preview (APK) / production profiles.
3. Offline outbox for the driver round; photos; QR handover.
4. Reports/PDF, payouts and settlements, account deletion.
5. EAS development build on a real iPhone, then store preparation.
