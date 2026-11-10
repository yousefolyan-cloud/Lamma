import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { greatCircleProvider } from '../../packages/domain/src/index';
import { runPlanning } from '../../backend/worker/plan';
import { approvedDriver, buildWorld, createDb, kg, type Db } from './harness';

let db: Db;
beforeEach(async () => { db = await createDb(); });
afterEach(async () => { await db.destroy(); });
const cfg = { startLeadMin: 90, distance: greatCircleProvider({ detourFactor: 1.3, speedKmh: 30 }) };
const fullPolicy = { plan_capacity_g: kg(300), plan_capacity_l: 12000, max_stops: 8, max_route_min: 240, service_min_per_stop: 10, unload_min: 20 };

describe('automatic planning and publication', () => {
  it('neighbouring sites reaching the threshold are grouped and published automatically; re-running the job creates nothing new', async () => {
    const w = await buildWorld(db, { institutions: 4 });
    await db.rpc(w.admin, 'admin_set_area_policy', [w.area, fullPolicy]);
    const est = [20, 25, 30, 4]; // the 4th is below the 15 kg threshold
    for (let i = 0; i < 4; i++) await db.rpc(w.institutions[i].owner, 'submit_pickup_request',
      [w.institutions[i].branch, JSON.stringify([{ material_id: w.pet, est_g: kg(est[i]) }]), null, null, null]);

    const [a, b] = await Promise.all([runPlanning(db.service, cfg), runPlanning(db.service, cfg)]); // two overlapping runs
    expect(a.areas[0].published.length + b.areas[0].published.length).toBe(1);
    const third = await runPlanning(db.service, cfg);
    expect(third.areas[0].published).toHaveLength(0);
    expect(third.areas[0].skipped).toEqual([{ requestId: expect.any(String), reason: 'not_ready' }]);

    const [route] = await db.admin(`select * from public.routes`);
    expect(route).toMatchObject({ status: 'published', est_total_g: kg(75), est_total_l: 2500, distance_is_estimate: true, planner_version: 'planner-ci-2opt-v1', pay_fils: '13000' });
    expect(await db.admin(`select 1 from public.route_stops where route_id = $1`, [route.id])).toHaveLength(3);
    expect((await db.admin(`select status, count(*)::int n from public.pickup_requests group by 1 order by 1`))).toEqual([{ status: 'scheduled', n: 3 }, { status: 'submitted', n: 1 }]);

    // a driver applies; the next job run assigns (application window is 0 in this fixture)
    const d = await approvedDriver(db, w, 'd');
    await db.rpc(d.id, 'apply_to_route', [route.id, d.vehicle]);
    expect((await runPlanning(db.service, cfg)).assigned).toBe(1);
    expect((await runPlanning(db.service, cfg)).assigned).toBe(0);
  });

  it('incomplete policy or paused auto-publish blocks publication with a stated reason — nothing is invented', async () => {
    const w = await buildWorld(db, { institutions: 1 });
    await db.rpc(w.institutions[0].owner, 'submit_pickup_request', [w.institutions[0].branch, JSON.stringify([{ material_id: w.pet, est_g: kg(40) }]), null, null, null]);
    expect((await runPlanning(db.service, cfg)).areas[0].blocked).toBe('policy_incomplete:plan_capacity_g,max_stops,max_route_min,service_min_per_stop,unload_min');
    await db.rpc(w.admin, 'admin_set_area_policy', [w.area, fullPolicy]);
    await expect(db.rpc(w.admin, 'admin_set_area_policy', [w.area, { auto_publish: false }])).rejects.toThrow('reason_required');
    await db.rpc(w.admin, 'admin_set_area_policy', [w.area, { auto_publish: false, auto_publish_paused_reason: 'صيانة' }]);
    expect((await runPlanning(db.service, cfg)).areas[0].blocked).toBe('auto_publish_paused');
    expect(await db.admin(`select 1 from public.routes`)).toHaveLength(0);
    await db.rpc(w.admin, 'admin_set_area_policy', [w.area, { auto_publish: true }]);
    expect((await runPlanning(db.service, cfg)).areas[0].published).toHaveLength(1);
  });
});
