import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildWorld, createDb, expectError, newUser, type Db } from './harness';

let db: Db;
beforeEach(async () => { db = await createDb(); });
afterEach(async () => { await db.destroy(); });

describe('configuration from inside the app', () => {
  it('only Lamma operations can create or change areas, materials and required documents; every change is audited', async () => {
    const w = await buildWorld(db, { institutions: 1 });
    const owner = w.institutions[0]!.owner;
    const outsider = await newUser(db, 'outsider');

    for (const u of [owner, outsider, w.stationUser]) {
      await expectError(db.rpc(u, 'admin_upsert_area', [null, 'X', 'س', 'X', 'Amman', true]), 'not_authorized');
      await expectError(db.rpc(u, 'admin_upsert_material', [null, 'X', 'س', 'X', null, null, true]), 'not_authorized');
      await expectError(db.rpc(u, 'admin_set_required_document', ['x', true]), 'not_authorized');
      await expectError(db.as(u, `insert into public.service_areas(code, name_ar, name_en, city) values ('Y','ي','Y','Amman')`), 'permission denied');
      await expectError(db.as(u, `update public.material_types set active = false`), 'permission denied');
    }

    const area = await db.rpc<string>(w.admin, 'admin_upsert_area', [null, ' AREA-2 ', 'منطقة ثانية', 'Second zone', 'Amman', null]);
    expect(await db.admin(`select code, active from public.service_areas where id = $1`, [area])).toEqual([{ code: 'AREA-2', active: false }]);
    await db.rpc(w.admin, 'admin_upsert_area', [area, 'AREA-2', 'منطقة ثانية', 'Second zone', 'Amman', true]);
    expect((await db.admin(`select active from public.service_areas where id = $1`, [area]))[0].active).toBe(true);
    await expectError(db.rpc(w.admin, 'admin_upsert_area', [null, 'AREA-2', 'ا', 'A', 'Amman', true]), 'code_taken');
    await expectError(db.rpc(w.admin, 'admin_upsert_area', [null, 'Z', '', 'A', 'Amman', true]), 'missing_fields');

    // a density figure is never stored without its source
    await expectError(db.rpc(w.admin, 'admin_upsert_material', [null, 'HDPE', 'بلاستيك', 'HDPE', 40, ' ', true]), 'density_source_required');
    const mat = await db.rpc<string>(w.admin, 'admin_upsert_material', [null, 'HDPE', 'بلاستيك', 'HDPE', null, null, true]);
    expect((await db.admin(`select bulk_density_g_per_l from public.material_types where id = $1`, [mat]))[0].bulk_density_g_per_l).toBeNull();
    await expectError(db.rpc(w.admin, 'admin_upsert_material', [mat, 'PET', 'بلاستيك', 'HDPE', null, null, true]), 'code_taken');

    await db.rpc(w.admin, 'admin_set_required_document', ['vehicle_registration', true]);
    await db.rpc(w.admin, 'admin_set_required_document', ['vehicle_registration', true]);
    expect(await db.admin(`select kind from public.required_driver_documents order by kind`)).toEqual([{ kind: 'driving_licence' }, { kind: 'vehicle_registration' }]);
    await db.rpc(w.admin, 'admin_set_required_document', ['vehicle_registration', false]);
    expect(await db.admin(`select kind from public.required_driver_documents`)).toHaveLength(1);

    const audit = await db.admin<{ action: string; n: string }>(`select action, count(*)::text n from public.audit_events
      where action in ('upsert_area','upsert_material','set_required_document') and actor_id = $1 group by action order by action`, [w.admin]);
    expect(audit).toEqual([{ action: 'set_required_document', n: '3' }, { action: 'upsert_area', n: '2' }, { action: 'upsert_material', n: '1' }]);
  });

  it('the settings screens read what they need under RLS and nothing more', async () => {
    const w = await buildWorld(db, { institutions: 1 });
    const owner = w.institutions[0]!.owner;
    // pay policy is visible to Lamma only; station prices to that station's manager and Lamma, never to an institution
    expect(await db.as(w.admin, `select * from public.area_policies`)).toHaveLength(1);
    expect(await db.as(owner, `select * from public.area_policies`)).toHaveLength(0);
    expect(await db.as(w.stationUser, `select * from public.price_versions where valid_to is null`)).toHaveLength(2);
    expect(await db.as(owner, `select * from public.price_versions`)).toHaveLength(0);
    // a new price closes the old version instead of rewriting it
    await db.rpc(w.stationUser, 'station_set_price', [w.station, w.pet, 200]);
    const versions = await db.admin(`select price_fils_per_kg::int p, valid_to is null open from public.price_versions where material_id = $1 order by valid_from`, [w.pet]);
    expect(versions).toEqual([{ p: 185, open: false }, { p: 200, open: true }]);
    await expectError(db.rpc(owner, 'station_set_price', [w.station, w.pet, 1]), 'not_authorized');
    // a driver's equipment starts as pending and only that driver (and Lamma) sees it
    const d = await newUser(db, 'driver');
    await db.rpc(d, 'register_driver', [[w.area]]);
    await db.rpc(d, 'add_vehicle', ['pickup', '11-22333', 800000, 3000]);
    await db.rpc(d, 'add_driver_scale', ['SC-1', null, 150000, 50, null, null]);
    await db.rpc(d, 'add_driver_document', ['driving_licence', null, '2030-01-01']);
    for (const t of ['vehicles', 'driver_scales', 'driver_documents']) {
      expect(await db.as(d, `select status from public.${t}`), t).toEqual([{ status: 'pending' }]);
      expect(await db.as(owner, `select * from public.${t}`), t).toHaveLength(0);
    }
    await expectError(db.rpc(owner, 'add_vehicle', ['pickup', '1', 1, 1]), 'not_a_driver');
  });
  it('evidence files: a driver uploads only into their own folder; only that driver and Lamma can read; nothing can be replaced or deleted', async () => {
    const w = await buildWorld(db, { institutions: 1 });
    const owner = w.institutions[0]!.owner;
    const d1 = await newUser(db, 'driver-1'); const d2 = await newUser(db, 'driver-2');
    await db.rpc(d1, 'register_driver', [[w.area]]); await db.rpc(d2, 'register_driver', [[w.area]]);
    const put = (u: string, name: string) => db.as(u, `insert into storage.objects(bucket_id, name) values ('evidence', $1)`, [name]);
    const mine = `driver/${d1}/licence.jpg`;
    await put(d1, mine);
    await expectError(put(d2, `driver/${d1}/x.jpg`), 'row-level security');      // someone else's folder
    await expectError(put(d1, `other/${d1}/x.jpg`), 'row-level security');       // outside the driver area
    await expectError(put(owner, `driver/${owner}/x.jpg`), 'row-level security'); // not a driver
    await expectError(db.as(d1, `insert into storage.objects(bucket_id, name) values ('other', $1)`, [mine]), '');
    expect(await db.as(d1, `select name from storage.objects`)).toEqual([{ name: mine }]);
    expect(await db.as(w.admin, `select name from storage.objects`)).toEqual([{ name: mine }]);
    for (const u of [d2, owner, w.stationUser]) expect(await db.as(u, `select name from storage.objects`)).toHaveLength(0);
    // append-only: no update / delete policy exists, so both touch zero rows
    await db.as(d1, `update storage.objects set name = name || '.bak'`); await db.as(d1, `delete from storage.objects`);
    expect(await db.admin(`select name from storage.objects`)).toEqual([{ name: mine }]);
    // a document row can only point at the caller's own folder
    await expectError(db.rpc(d2, 'add_driver_document', ['driving_licence', mine, null]), 'invalid_path');
    await expectError(db.rpc(d2, 'add_driver_scale', ['S', null, 1000, 10, null, mine]), 'invalid_path');
    await db.rpc(d1, 'add_driver_document', ['driving_licence', mine, '2030-01-01']);
    const q = await db.rpc<{ driver_documents: { file_path: string }[] }>(w.admin, 'admin_review_queue');
    expect(q.driver_documents.map((x) => x.file_path)).toContain(mine);
  });
});
