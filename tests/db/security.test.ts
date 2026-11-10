import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { approvedDriver, assignTo, buildWorld, collectStop, createDb, expectError, kg, newUser, publishedRoute, stopsOf, type Db } from './harness';

let db: Db;
beforeEach(async () => { db = await createDb(); });
afterEach(async () => { await db.destroy(); });

const weigh = (db: Db, driver: string, stop: string, material: string, netKg: number, reason: string | null = null, ev = randomUUID()) =>
  db.rpc<{ version_id: string; data_hash: string; version: number; duplicate: boolean }>(driver, 'record_weights',
    [stop, ev, new Date().toISOString(), JSON.stringify([{ material_id: material, method: 'net_direct', net_g: kg(netKg) }]), reason, null, null, null]);

describe('tenant isolation (real end-user role, not service role)', () => {
  it('institution A cannot read, sign or request for institution B — by table, by RPC, or by guessing ids', async () => {
    const w = await buildWorld(db);
    const [a, b] = w.institutions;
    const driver = await approvedDriver(db, w, 'd');
    const { route } = await publishedRoute(db, w);
    await assignTo(db, route, driver);
    await db.rpc(driver.id, 'start_route', [route]);
    const stops = await stopsOf(db, route);
    const stopB = stops.find((s) => s.branch_id === b.branch)!;
    const stopA = stops.find((s) => s.branch_id === a.branch)!;

    for (const t of ['organizations', 'branches', 'pickup_requests', 'request_materials', 'route_stops', 'memberships']) {
      const rows = await db.as(a.owner, `select * from public.${t}`);
      expect(rows.length, t).toBe(1); // exactly their own row, never the other two institutions'
    }
    expect(await db.as(a.owner, `select * from public.branches where id = $1`, [b.branch])).toHaveLength(0);
    expect(await db.as(a.owner, `select * from public.route_stops where id = $1`, [stopB.id])).toHaveLength(0);
    await expectError(db.rpc(a.owner, 'submit_pickup_request', [b.branch, JSON.stringify([{ material_id: w.pet, est_g: 1000 }]), null, null, null]), 'not_authorized');
    await expectError(db.as(a.owner, `insert into public.branches(org_id, name) values ($1, 'x')`, [b.org]), 'row-level security');
    await expectError(db.as(a.owner, `update public.organizations set status = 'approved'`), 'permission denied');

    // weights of B: A can neither see them nor sign them
    await db.rpc(driver.id, 'arrive_stop', [stopA.id]);
    const recA = await weigh(db, driver.id, stopA.id, w.pet, 18);
    expect(await db.as(b.owner, `select * from public.weigh_versions`)).toHaveLength(0);
    expect(await db.as(b.owner, `select * from public.weigh_lines`)).toHaveLength(0);
    await expectError(db.rpc(b.owner, 'sign_weights', [recA.version_id, recA.data_hash, null]), 'not_authorized');
    // the institution sees its own stop, but not the finance ledger, other stops, or prices
    expect(await db.as(a.owner, `select * from public.weigh_lines`)).toHaveLength(1);
    for (const t of ['price_versions', 'route_prices', 'journal_lines', 'audit_events', 'area_policies', 'drivers', 'vehicles']) {
      expect((await db.as(a.owner, `select * from public.${t}`)).length, t).toBe(0);
    }
    // station staff see the shipment totals but no institution identity or branch
    expect(await db.as(w.stationUser, `select * from public.branches`)).toHaveLength(0);
    expect(await db.as(w.stationUser, `select * from public.route_stops`)).toHaveLength(0);
    await expectError(db.rpc(a.owner, 'station_shipment', [route]), 'not_authorized');
  });

  it('signing up grants nothing: no admin, no approvals, no operating before review', async () => {
    const w = await buildWorld(db);
    const stranger = await newUser(db, 'stranger');
    expect(await db.as(stranger, `select * from public.organizations`)).toHaveLength(0);
    expect(await db.as(stranger, `select * from public.routes`)).toHaveLength(0);
    await expectError(db.rpc(stranger, 'admin_review', ['driver', stranger, 'approved', null]), 'not_authorized');
    await expectError(db.rpc(stranger, 'admin_grant_staff_role', [stranger, 'lamma_ops']), 'not_authorized');
    await expectError(db.rpc(stranger, 'publish_route', [JSON.stringify({})]), 'not_authorized');
    await expectError(db.rpc(stranger, 'assign_route', [randomUUID(), true]), 'not_authorized');
    await expectError(db.as(stranger, `insert into public.memberships(user_id, org_id, role, status) select $1, id, 'lamma_super', 'approved' from public.organizations`, [stranger]), 'permission denied');
    await expectError(db.as(stranger, `select app.bootstrap_admin($1)`, [stranger]), 'permission denied');
    await expectError(db.as(stranger, `select public.assign_due_routes()`), 'permission denied');

    // pending driver: registered but not approved → sees no routes and is found ineligible with a clear reason
    await db.rpc(stranger, 'register_driver', [[w.area]]);
    const vehicle = await db.rpc<string>(stranger, 'add_vehicle', ['pickup', 'X', kg(900), 7000]);
    const { route } = await publishedRoute(db, w);
    expect(await db.as(stranger, `select * from public.driver_available_routes()`)).toHaveLength(0);
    const res = await db.rpc<any>(stranger, 'apply_to_route', [route, vehicle]);
    expect(res.status).toBe('ineligible');
    expect(res.reasons).toEqual(expect.arrayContaining(['driver_not_approved', 'vehicle_not_approved', 'document_missing_or_expired', 'no_valid_scale']));

    // pending institution cannot request collection; pending/unverified station cannot receive routes
    const owner = await newUser(db, 'pending-owner');
    const org = await db.rpc<string>(owner, 'register_institution', ['مؤسسة قيد المراجعة', 'office', 'فرع', w.area, null, 31.9, 35.9]);
    expect(await db.as(owner, `select status from public.organizations`)).toEqual([{ status: 'pending' }]);
    const [{ id: branch }] = await db.admin(`select id from public.branches where org_id = $1`, [org]);
    await expectError(db.rpc(owner, 'submit_pickup_request', [branch, JSON.stringify([{ material_id: w.pet, est_g: 1000 }]), null, null, null]), 'not_authorized');
    const su = await newUser(db, 'new-station');
    await db.rpc(su, 'register_station', ['محطة جديدة', w.area, null, 31.9, 35.9, null, null, null]);
    expect(await db.admin(`select license_verified from public.stations where org_id in (select id from public.organizations where created_by = $1)`, [su])).toEqual([{ license_verified: false }]);
  });
});

describe('weights and sign-off', () => {
  it('no signature → stop cannot be completed; driver cannot sign; stale version is rejected; a correction needs a new signature and keeps history', async () => {
    const w = await buildWorld(db);
    const driver = await approvedDriver(db, w, 'd');
    const { route } = await publishedRoute(db, w);
    await assignTo(db, route, driver);
    await db.rpc(driver.id, 'start_route', [route]);
    const [s1, s2] = await stopsOf(db, route);
    const inst = w.institutions.find((i) => i.branch === s1.branch_id)!;

    await expectError(db.rpc(driver.id, 'arrive_stop', [s2.id]), 'previous_stop_open'); // order is enforced
    await db.rpc(driver.id, 'arrive_stop', [s1.id]);
    await expectError(db.rpc(driver.id, 'complete_stop', [s1.id]), 'signature_required');

    const ev = randomUUID();
    const v1 = await weigh(db, driver.id, s1.id, w.pet, 18.25, null, ev);
    const dup = await weigh(db, driver.id, s1.id, w.pet, 18.25, null, ev); // offline retry
    expect(dup).toMatchObject({ version_id: v1.version_id, duplicate: true });
    expect(await db.admin(`select 1 from public.weigh_versions`)).toHaveLength(1);

    await expectError(db.rpc(driver.id, 'sign_weights', [v1.version_id, v1.data_hash, null]), 'not_authorized');
    await expectError(db.rpc(driver.id, 'complete_stop', [s1.id]), 'signature_required');
    await expectError(db.rpc(inst.owner, 'sign_weights', [v1.version_id, 'tampered-hash', null]), 'stale_version');

    // driver corrects the reading before signature: a reason is mandatory, v1 is kept as superseded
    await expectError(weigh(db, driver.id, s1.id, w.pet, 18.75), 'reason_required');
    const v2 = await weigh(db, driver.id, s1.id, w.pet, 18.75, 'قراءة خاطئة للميزان');
    await expectError(db.rpc(inst.owner, 'sign_weights', [v1.version_id, v1.data_hash, null]), 'stale_version');
    await db.rpc(inst.owner, 'sign_weights', [v2.version_id, v2.data_hash, null]);
    await expectError(db.rpc(inst.owner, 'sign_weights', [v2.version_id, v2.data_hash, null]), 'already_signed');

    // changing weights AFTER signature invalidates it: stop cannot complete until v3 is signed
    const v3 = await weigh(db, driver.id, s1.id, w.pet, 19, 'إضافة كيس نُسي');
    await expectError(db.rpc(driver.id, 'complete_stop', [s1.id]), 'signature_required');
    expect(await db.admin(`select version, status from public.weigh_versions order by version`)).toEqual([
      { version: 1, status: 'superseded' }, { version: 2, status: 'superseded' }, { version: 3, status: 'awaiting_signature' }]);
    expect(await db.admin(`select 1 from public.collection_signoffs`)).toHaveLength(1); // the old signature record is preserved
    await db.rpc(inst.owner, 'sign_weights', [v3.version_id, v3.data_hash, null]);
    expect((await db.rpc<any>(driver.id, 'complete_stop', [s1.id])).next_stop_id).toBe(s2.id);
    // after completion the stop is closed for silent edits
    await expectError(weigh(db, driver.id, s1.id, w.pet, 30, 'x'), 'invalid_state');

    // evidence is immutable even for the database owner; invalid numbers are refused by constraints
    await expectError(db.admin(`update public.weigh_lines set net_g = 1`), 'immutable_record');
    await expectError(db.admin(`delete from public.collection_signoffs`), 'immutable_record');
    await expectError(db.admin(`update public.weigh_versions set data_hash = 'x'`), 'immutable_record');
    await db.rpc(driver.id, 'arrive_stop', [s2.id]);
    await expectError(db.rpc(driver.id, 'record_weights', [s2.id, randomUUID(), new Date().toISOString(),
      JSON.stringify([{ material_id: w.pet, method: 'gross_tare', gross_g: 500, tare_g: 900, net_g: -400 }]), null, null, null, null]), 'invalid_weight');
    await expectError(db.rpc(driver.id, 'record_weights', [s2.id, randomUUID(), new Date().toISOString(),
      JSON.stringify([{ material_id: w.pet, method: 'gross_tare', gross_g: 5000, tare_g: 400, net_g: 5000 }]), null, null, null, null]), 'weigh_lines_check');
  });

  it('delegate refuses to sign → documented exception, request goes back for rescheduling, never counted as collected', async () => {
    const w = await buildWorld(db);
    const driver = await approvedDriver(db, w, 'd');
    const { route, requests } = await publishedRoute(db, w);
    await assignTo(db, route, driver);
    await db.rpc(driver.id, 'start_route', [route]);
    const [s1, s2, s3] = await stopsOf(db, route);
    await db.rpc(driver.id, 'arrive_stop', [s1.id]);
    await weigh(db, driver.id, s1.id, w.pet, 18);
    await db.rpc(driver.id, 'report_stop_exception', [s1.id, 'signature_refused', 'رفض المفوّض التوقيع']);
    await collectStop(db, w, driver.id, s2, 23.5);
    await collectStop(db, w, driver.id, s3, 28.25);
    const ship = await db.rpc<any>(w.stationUser, 'station_shipment', [route]);
    expect(ship).toMatchObject({ signed_total_g: kg(51.75), stops_collected: 2, stops_exception: 1 });
    expect((await db.admin(`select status from public.pickup_requests where id = $1`, [requests[0]]))[0].status).toBe('needs_reschedule');
    await db.rpc(driver.id, 'arrive_station', [route]);
    const rc = await db.rpc<any>(w.stationUser, 'submit_station_receipt', [route, randomUUID(), JSON.stringify([{ material_id: w.pet, net_g: kg(51.75) }]), null]);
    expect(rc.status).toBe('confirmed');
  });
});

describe('publishing and assignment under concurrency', () => {
  it('the same ready requests are never published into two routes, even when the job runs twice at once', async () => {
    const w = await buildWorld(db);
    const { payload } = await publishedRoute(db, w);
    await expectError(db.service(`select public.publish_route($1)`, [JSON.stringify(payload)]), 'request_not_available');
    // parallel duplicate run on fresh requests
    const w2reqs: string[] = [];
    await db.admin(`update public.pickup_requests set status = 'closed'`);
    await db.admin(`update public.route_stops set active = false`);
    for (const i of w.institutions) w2reqs.push(await db.rpc<string>(i.owner, 'submit_pickup_request', [i.branch, JSON.stringify([{ material_id: w.pet, est_g: kg(20) }]), null, null, null]));
    const p2 = JSON.stringify({ ...payload, stops: w2reqs.map((r, i) => ({ request_id: r, seq: i + 1 })) });
    const results = await Promise.allSettled([1, 2, 3, 4].map(() => db.service(`select public.publish_route($1)`, [p2])));
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await db.admin(`select 1 from public.routes where status = 'published'`)).toHaveLength(2);
  });

  it('refuses to publish with invented numbers: no pay policy, no price, unverified station, unknown estimate', async () => {
    const w = await buildWorld(db);
    const req = await db.rpc<string>(w.institutions[0].owner, 'submit_pickup_request', [w.institutions[0].branch, JSON.stringify([{ material_id: w.alu, containers: 3 }]), null, null, null]);
    const p = { service_area_id: w.area, station_id: w.station, starts_at: new Date(Date.now() + 3600e3).toISOString(), expected_duration_min: 60, distance_m: 5000, stops: [{ request_id: req, seq: 1 }] };
    await expectError(db.service(`select public.publish_route($1)`, [JSON.stringify(p)]), 'estimate_missing'); // unknown weight is not zero
    const cands = await db.service(`select * from public.planning_candidates($1)`, [w.area]);
    expect(cands[0]).toMatchObject({ ready: false, needs_update: true });
    await db.admin(`update public.request_materials set est_g = 20000`);
    await db.admin(`update public.price_versions set valid_to = now() where material_id = $1`, [w.alu]);
    await expectError(db.service(`select public.publish_route($1)`, [JSON.stringify(p)]), 'price_missing');
    await db.rpc(w.stationUser, 'station_set_price', [w.station, w.alu, 650]);
    await db.rpc(w.admin, 'admin_review', ['station_license', w.station, 'rejected', 'انتهت الرخصة']);
    await expectError(db.service(`select public.publish_route($1)`, [JSON.stringify(p)]), 'station_not_approved');
    await db.rpc(w.admin, 'admin_review', ['station_license', w.station, 'approved', null]);
    await db.admin(`update public.area_policies set base_pay_fils = null`);
    await expectError(db.service(`select public.publish_route($1)`, [JSON.stringify(p)]), 'pay_policy_missing');
  });

  it('two drivers apply at the same moment: both are evaluated, exactly one is assigned, the other is told', async () => {
    const w = await buildWorld(db);
    const d1 = await approvedDriver(db, w, 'd1');
    const d2 = await approvedDriver(db, w, 'd2');
    const { route } = await publishedRoute(db, w);
    const apps = await Promise.all([d1, d2].map((d) => db.rpc<any>(d.id, 'apply_to_route', [route, d.vehicle])));
    expect(apps.map((a) => a.status)).toEqual(['eligible_pending_assignment', 'eligible_pending_assignment']);
    await expectError(db.rpc(d1.id, 'apply_to_route', [route, d1.vehicle]), 'already_applied');
    expect((await db.admin(`select status from public.routes where id = $1`, [route]))[0].status).toBe('published'); // applying is not grabbing

    const runs = await Promise.all([1, 2, 3, 4, 5].map(() => db.service<{ r: string | null }>(`select public.assign_route($1) as r`, [route])));
    expect(runs.filter((r) => r[0].r !== null)).toHaveLength(1);
    expect(await db.admin(`select 1 from public.assignments where route_id = $1`, [route])).toHaveLength(1);
    const statuses = (await db.admin(`select status from public.route_applications where route_id = $1 order by status`, [route])).map((x) => x.status);
    expect(statuses).toEqual(['not_selected', 'selected']);
    // each driver sees only their own application
    expect(await db.as(d1.id, `select 1 from public.route_applications`)).toHaveLength(1);
    expect(await db.as(d2.id, `select kind from public.notifications`)).toHaveLength(1);
  });

  it('eligibility: small truck, no valid scale, or an overlapping route → not assigned, with a specific reason', async () => {
    const w = await buildWorld(db, { institutions: 6 });
    const small = await approvedDriver(db, w, 'small', { capacityKg: 50 });
    const lowVolume = await approvedDriver(db, w, 'lowvol', { capacityL: 500 });
    const noScale = await approvedDriver(db, w, 'noscale', { scale: false });
    const busy = await approvedDriver(db, w, 'busy');
    const fresh = await approvedDriver(db, w, 'fresh');
    const first = await publishedRoute(db, { ...w, institutions: w.institutions.slice(0, 3) });
    expect((await db.rpc<any>(small.id, 'apply_to_route', [first.route, small.vehicle])).reasons).toEqual(['vehicle_weight_capacity_too_small']);
    expect((await db.rpc<any>(lowVolume.id, 'apply_to_route', [first.route, lowVolume.vehicle])).reasons).toEqual(['vehicle_volume_capacity_too_small']);
    expect((await db.rpc<any>(noScale.id, 'apply_to_route', [first.route, noScale.vehicle])).reasons).toEqual(['no_valid_scale']);
    expect((await assignTo(db, first.route, busy)).assignment).toBeTruthy();

    // second route overlaps in time: `busy` is refused for overlap; `fresh` gets it
    const second = await publishedRoute(db, { ...w, institutions: w.institutions.slice(3, 6) });
    const busyApp = await db.rpc<any>(busy.id, 'apply_to_route', [second.route, busy.vehicle]);
    expect(busyApp).toMatchObject({ status: 'ineligible', reasons: ['overlapping_route'] });
    expect(await db.service(`select public.assign_route($1) as r`, [second.route])).toEqual([{ r: null }]); // nobody eligible yet → stays open
    expect((await assignTo(db, second.route, fresh)).assignment).toBeTruthy();
    // the database itself refuses a double booking, whatever the code path
    await expectError(db.admin(`insert into public.assignments(route_id, driver_id, vehicle_id, scale_id, application_id, period)
       select $1, driver_id, vehicle_id, scale_id, application_id, period from public.assignments where route_id = $2`, [second.route, first.route]), 'assignments_');
    // evaluations are recorded with policy version and inputs
    const evals = await db.as(w.admin, `select policy_version, passed from public.eligibility_evaluations`);
    expect(evals).toHaveLength(6);
    expect(evals.every((e) => e.policy_version === 'eligibility-v1')).toBe(true);
  });

  it('the ledger refuses unbalanced or edited entries', async () => {
    await buildWorld(db);
    await db.admin(`insert into public.ledger_accounts(kind) values ('cash'), ('material_sales')`);
    await expectError(db.admin(`with e as (insert into public.journal_entries(kind, ref_type, ref_id) values ('t','t',gen_random_uuid()) returning id)
      insert into public.journal_lines(entry_id, account_id, debit_fils) select e.id, a.id, 1500 from e, public.ledger_accounts a where a.kind = 'cash'`), 'unbalanced_journal_entry');
    expect(await db.admin(`select 1 from public.journal_entries`)).toHaveLength(0);
  });
});
