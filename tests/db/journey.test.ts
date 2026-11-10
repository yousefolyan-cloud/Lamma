import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { approvedDriver, assignTo, buildWorld, collectStop, createDb, expectError, kg, publishedRoute, stopsOf, type Db } from './harness';

let db: Db;
beforeEach(async () => { db = await createDb(); });
afterEach(async () => { await db.destroy(); });

describe('full journey: readiness → route → application → weighing & sign-off → station confirms', () => {
  it('three signed stops of 18.250 + 23.500 + 28.250 kg = 70.000 kg; station weighs 70.000 and confirms once', async () => {
    const w = await buildWorld(db);
    const driver = await approvedDriver(db, w, 'd1');
    const { route } = await publishedRoute(db, w);

    // driver sees the 8 mandatory card fields and no institution identity
    const [card] = await db.as(driver.id, `select * from public.driver_available_routes()`);
    expect(card).toMatchObject({ est_total_g: kg(75), required_capacity_g: kg(75), stops_count: 3, station_name: 'محطة فرز تجريبية',
      distance_m: 14500, area_name_ar: 'منطقة تجريبية', expected_duration_min: 120, pay_fils: '13000' });
    expect(card.starts_at).toBeInstanceOf(Date);
    expect(await db.as(driver.id, `select * from public.branches`)).toHaveLength(0);

    // applying is a request, not a grab
    const { application, assignment } = await assignTo(db, route, driver);
    expect(application.status).toBe('eligible_pending_assignment');
    expect(assignment).toBeTruthy();
    expect(await db.as(driver.id, `select * from public.branches`)).toHaveLength(3); // now, and only now, visible

    await db.rpc(driver.id, 'start_route', [route]);
    const stops = await stopsOf(db, route);
    const r1 = await collectStop(db, w, driver.id, stops[0], 18.25);
    expect(r1).toMatchObject({ route_status: 'in_progress', next_stop_id: stops[1].id, next_is_station: false }); // auto-advance
    const r2 = await collectStop(db, w, driver.id, stops[1], 23.5);
    expect(r2.next_stop_id).toBe(stops[2].id);
    const r3 = await collectStop(db, w, driver.id, stops[2], 28.25);
    expect(r3).toMatchObject({ route_status: 'en_route_to_station', next_stop_id: null, next_is_station: true });

    // "shipment on the way" exists exactly once in the station inbox
    const inbox = await db.as(w.stationUser, `select kind from public.notifications where kind = 'shipment_on_the_way'`);
    expect(inbox).toHaveLength(1);
    const shipment = await db.rpc<any>(w.stationUser, 'station_shipment', [route]);
    expect(shipment).toMatchObject({ signed_total_g: kg(70), planned_estimate_g: kg(75), stops_collected: 3, driver_name: 'd1' });

    // the station cannot confirm before the driver arrives; the driver can never complete
    await expectError(db.rpc(w.stationUser, 'submit_station_receipt', [route, randomUUID(), JSON.stringify([{ material_id: w.pet, net_g: kg(70) }]), null]), 'invalid_state');
    await db.rpc(driver.id, 'arrive_station', [route]);
    await expectError(db.as(driver.id, `update public.routes set status = 'completed' where id = $1`, [route]), 'permission denied');
    await expectError(db.rpc(driver.id, 'submit_station_receipt', [route, randomUUID(), JSON.stringify([{ material_id: w.pet, net_g: kg(70) }]), null]), 'not_authorized');
    expect((await db.admin(`select status from public.routes where id = $1`, [route]))[0].status).toBe('awaiting_station_receipt');

    const ev = randomUUID();
    const rc = await db.rpc<any>(w.stationUser, 'submit_station_receipt', [route, ev, JSON.stringify([{ material_id: w.pet, net_g: kg(70) }]), null]);
    expect(rc).toMatchObject({ status: 'confirmed', diff_g: 0, duplicate: false });
    // double tap / retry: same event id never closes or bills twice
    const again = await db.rpc<any>(w.stationUser, 'submit_station_receipt', [route, ev, JSON.stringify([{ material_id: w.pet, net_g: kg(70) }]), null]);
    expect(again).toMatchObject({ receipt_id: rc.receipt_id, duplicate: true });
    await expectError(db.rpc(w.stationUser, 'submit_station_receipt', [route, randomUUID(), JSON.stringify([{ material_id: w.pet, net_g: kg(70) }]), null]), 'invalid_state');

    const [r] = await db.admin(`select status, completed_at from public.routes where id = $1`, [route]);
    expect(r.status).toBe('completed');
    expect(await db.admin(`select 1 from public.station_receipts where route_id = $1 and status = 'confirmed'`, [route])).toHaveLength(1);

    // money: 70.000 kg × 0.185 JOD/kg = 12.950 JOD; driver fee 10 + 3×1 = 13.000 JOD — integer fils, balanced entries
    const lines = await db.admin(`select a.kind, l.debit_fils, l.credit_fils from public.journal_lines l join public.ledger_accounts a on a.id = l.account_id order by a.kind`);
    expect(lines).toEqual([
      { kind: 'driver_cost', debit_fils: '13000', credit_fils: '0' },
      { kind: 'driver_payable', debit_fils: '0', credit_fils: '13000' },
      { kind: 'material_sales', debit_fils: '0', credit_fils: '12950' },
      { kind: 'station_receivable', debit_fils: '12950', credit_fils: '0' },
    ]);
    // completing a route never claims recycling, payment or carbon
    expect((await db.admin(`select distinct status from public.pickup_requests`)).map((x) => x.status)).toEqual(['delivered_to_station']);
    expect(await db.admin(`select 1 from public.ledger_accounts where kind = 'cash'`)).toHaveLength(0);

    // a later price change does not touch the receipt already issued
    await db.rpc(w.stationUser, 'station_set_price', [w.station, w.pet, 90]);
    const [line] = await db.admin(`select price_fils_per_kg, value_fils from public.receipt_lines where receipt_id = $1`, [rc.receipt_id]);
    expect(line).toEqual({ price_fils_per_kg: '185', value_fils: '12950' });
    await expectError(db.admin(`update public.receipt_lines set value_fils = 1 where receipt_id = $1`, [rc.receipt_id]), 'immutable_record');
  });

  it('station weight differs and no tolerance policy is approved → shown, NOT completed; resolution is documented and readings stay intact', async () => {
    const w = await buildWorld(db);
    const driver = await approvedDriver(db, w, 'd2');
    const { route } = await publishedRoute(db, w);
    await assignTo(db, route, driver);
    await db.rpc(driver.id, 'start_route', [route]);
    const stops = await stopsOf(db, route);
    await collectStop(db, w, driver.id, stops[0], 18.25);
    await collectStop(db, w, driver.id, stops[1], 23.5);
    await collectStop(db, w, driver.id, stops[2], 28.25);
    await db.rpc(driver.id, 'arrive_station', [route]);

    const rc = await db.rpc<any>(w.stationUser, 'submit_station_receipt', [route, randomUUID(), JSON.stringify([{ material_id: w.pet, net_g: kg(69.4) }]), null]);
    expect(rc).toMatchObject({ status: 'under_review', diff_g: -600, reasons: ['weight_mismatch'] });
    expect((await db.admin(`select status from public.routes where id = $1`, [route]))[0].status).toBe('needs_review');
    expect(await db.admin(`select 1 from public.journal_entries`)).toHaveLength(0);
    // the station cannot push it through; neither can the driver
    await expectError(db.rpc(w.stationUser, 'confirm_reviewed_receipt', [rc.receipt_id]), 'invalid_state');
    await expectError(db.rpc(w.stationUser, 'submit_station_receipt', [route, randomUUID(), JSON.stringify([{ material_id: w.pet, net_g: kg(70) }]), null]), 'invalid_state');
    // the driver sees the difference and the case (can dispute)
    expect(await db.as(driver.id, `select diff_g from public.station_receipts where route_id = $1`, [route])).toEqual([{ diff_g: -600 }]);

    const [c] = await db.as(w.admin, `select id, reasons from public.reconciliation_cases where route_id = $1`, [route]);
    await expectError(db.rpc(w.stationUser, 'resolve_case', [c.id, 'accept_receipt', 'x']), 'not_authorized');
    await expectError(db.rpc(w.admin, 'resolve_case', [c.id, 'accept_receipt', '  ']), 'reason_required');
    await db.rpc(w.admin, 'resolve_case', [c.id, 'accept_receipt', 'فرق ناتج عن رطوبة الأكياس، موثّق بصورة تذكرة الميزان']);
    await db.rpc(w.stationUser, 'confirm_reviewed_receipt', [rc.receipt_id]);
    expect((await db.admin(`select status from public.routes where id = $1`, [route]))[0].status).toBe('completed');
    // original signed readings were not rewritten: still 70.000 kg signed, 69.400 received
    const [t] = await db.admin(`select sum(net_g)::int as g from public.weigh_lines`);
    expect(t.g).toBe(kg(70));
    const [rr] = await db.admin(`select signed_total_g, station_net_g from public.station_receipts where id = $1`, [rc.receipt_id]);
    expect(rr).toEqual({ signed_total_g: kg(70), station_net_g: kg(69.4) });
    // sale is booked on what the station accepted: 69.400 × 185 = 12 839 fils
    expect((await db.admin(`select sum(debit_fils)::int as d from public.journal_lines l join public.ledger_accounts a on a.id = l.account_id where a.kind = 'station_receivable'`))[0].d).toBe(12839);
  });

  it('an approved tolerance policy lets a small scale difference pass; partial rejection always goes to review; re-weigh path works', async () => {
    const w = await buildWorld(db, { institutions: 1, tolerance: { g: 300, bps: 50 } });
    const driver = await approvedDriver(db, w, 'd3');
    const first = await publishedRoute(db, w, [20]);
    await assignTo(db, first.route, driver);
    await db.rpc(driver.id, 'start_route', [first.route]);
    await collectStop(db, w, driver.id, (await stopsOf(db, first.route))[0], 20);
    await db.rpc(driver.id, 'arrive_station', [first.route]);
    const rejected = await db.rpc<any>(w.stationUser, 'submit_station_receipt', [first.route, randomUUID(),
      JSON.stringify([{ material_id: w.pet, net_g: kg(19.8), accepted_g: kg(18.8), rejected_g: kg(1), reject_reason: 'contaminated' }]), null]);
    expect(rejected).toMatchObject({ status: 'under_review', reasons: ['partial_rejection'] });
    const [c] = await db.as(w.admin, `select id from public.reconciliation_cases where route_id = $1`, [first.route]);
    await db.rpc(w.admin, 'resolve_case', [c.id, 'reweigh', 'إعادة وزن بحضور السائق']);
    const second = await db.rpc<any>(w.stationUser, 'submit_station_receipt', [first.route, randomUUID(), JSON.stringify([{ material_id: w.pet, net_g: kg(19.8) }]), null]);
    expect(second).toMatchObject({ status: 'confirmed', diff_g: -200 });
    expect((await db.admin(`select status, attempt from public.station_receipts where route_id = $1 order by attempt`, [first.route])))
      .toEqual([{ status: 'superseded', attempt: 1 }, { status: 'confirmed', attempt: 2 }]);
  });
});
