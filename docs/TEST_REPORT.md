# Test report — 2026-11-11

| Suite | Command | Result |
|---|---|---|
| Domain (units, state machine, planner) | `npx vitest run packages` | 9 passed |
| Database (journey, isolation, signatures, concurrency, planning job) | `PGPASSWORD=postgres npx vitest run tests/db` | 23 passed |
| Types | `tsc --noEmit` (domain, tests+backend, app) | clean |
| Web build | `npx expo export -p web` | exported |
| Browser end-to-end, 6 people, 20 screenshots | `node tests/e2e/journey.mjs` | E2E OK |

Acceptance cases from the owner's flow that are covered by automated tests:
- 18.250 + 23.500 + 28.250 = 70.000 kg, station weighs 70.000 → closed once, receipts correct, retry does not double-close.
- Station weight outside tolerance → difference shown, not Completed, resolution documented, original readings intact.
- Weight without signature / signature on an old version → not accepted; the driver cannot bypass or sign.
- Weight change after signature invalidates it and requires a new signature; previous versions kept.
- Threshold reached → automatic planning and publication; repeated/parallel job runs never create two routes for the same requests.
- Too-small truck (weight or volume), no valid scale, overlapping round → not assigned, specific reason.
- Last stop → one "shipment on the way" notice in the station inbox.
- Station is the last stop; the driver account cannot complete the route.
- Institution A cannot read or act on institution B (tables, RPCs, ids). Sign-up grants no role.
- Two drivers applying at once → exactly one assignment. Price change does not alter an issued receipt. JOD keeps 3 decimals in integer fils. Ledger entries balance and are immutable.

Not tested: real iPhone/Android, VoiceOver, Dynamic Type, camera, location, push, offline, real Supabase, PDF.
