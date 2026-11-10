// Fictional demo data for LOCAL development only (never run against production).
// Recreates the `lamma_dev` database from the real migrations and walks routes through the real RPCs.
import { Pool } from 'pg';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const base = { host: 'localhost', port: +(process.env.PGPORT ?? 5432), user: process.env.PGUSER ?? 'postgres', password: process.env.PGPASSWORD };
const root = join(__dirname, '..', '..');
const kg = (v: number) => Math.round(v * 1000);

async function main() {
  const boot = new Pool({ ...base, database: 'postgres' });
  await boot.query('drop database if exists lamma_dev with (force)'); await boot.query('create database lamma_dev'); await boot.end();
  const pool = new Pool({ ...base, database: 'lamma_dev' });
  await pool.query(readFileSync(join(root, 'tests/db/shim.sql'), 'utf8'));
  for (const f of readdirSync(join(root, 'supabase/migrations')).sort()) await pool.query(readFileSync(join(root, 'supabase/migrations', f), 'utf8'));
  await pool.query(`grant all on all tables in schema public to service_role; grant usage on schema app to service_role; grant execute on function app.is_service() to service_role`);
  const admin = async (t: string, p: unknown[] = []) => (await pool.query(t, p)).rows;
  const run = async (claims: object, role: string, t: string, p: unknown[]) => { const c = await pool.connect(); try {
      await c.query(`select set_config('request.jwt.claims', $1, false)`, [JSON.stringify(claims)]); await c.query(`set role ${role}`); return (await c.query(t, p)).rows;
    } finally { await c.query('reset role'); await c.query(`select set_config('request.jwt.claims', '', false)`); c.release(); } };
  const rpc = async (u: string, fn: string, a: unknown[] = []) => (await run({ sub: u, role: 'authenticated' }, 'authenticated', `select public.${fn}(${a.map((_, i) => '$' + (i + 1)).join(',')}) r`, a))[0].r;
  const service = (t: string, p: unknown[] = []) => run({ role: 'service_role' }, 'service_role', t, p);
  const user = async (email: string, name: string) => (await admin(`insert into auth.users(email, raw_user_meta_data) values ($1,$2) returning id`, [email, { full_name: name }]))[0].id as string;

  const boss = await user('admin@demo.lamma.test', 'مشرف لمّة (تجريبي)');
  await admin(`select app.bootstrap_admin($1)`, [boss]);
  const [area] = await admin(`insert into public.service_areas(code,name_ar,name_en,city,active) values ('AMM-DEMO','عمّان – منطقة تجريبية','Amman – demo zone','Amman',true) returning id`);
  const [pet] = await admin(`insert into public.material_types(code,name_ar,name_en,bulk_density_g_per_l,density_source) values ('PET','بلاستيك PET','PET plastic',30,'قيمة تجريبية غير معتمدة') returning id`);
  const [alu] = await admin(`insert into public.material_types(code,name_ar,name_en) values ('ALU','علب ألمنيوم','Aluminium cans') returning id`);
  await admin(`insert into public.required_driver_documents(kind) values ('driving_licence')`);
  await rpc(boss, 'admin_set_threshold', [area.id, pet.id, kg(15)]);
  await rpc(boss, 'admin_set_threshold', [area.id, alu.id, kg(10)]);
  // DEMO values only — real thresholds, pay and tolerances are set by Lamma operations
  await rpc(boss, 'admin_set_area_policy', [area.id, { base_pay_fils: 10000, per_stop_pay_fils: 1000, application_window_min: 0, early_start_min: 600,
    plan_capacity_g: kg(300), plan_capacity_l: 12000, max_stops: 8, max_route_min: 240, service_min_per_stop: 10, unload_min: 20 }]);

  const st = await user('station@demo.lamma.test', 'موظف محطة (تجريبي)');
  const station = await rpc(st, 'register_station', ['محطة الفرز التجريبية', area.id, 'عمّان – موقع تجريبي', 31.905, 35.975, 'جهة ترخيص تجريبية', 'DEMO-0001', '2030-01-01']);
  const [{ org_id }] = await admin(`select org_id from public.stations where id=$1`, [station]);
  await rpc(boss, 'admin_review', ['organization', org_id, 'approved', null]); await rpc(boss, 'admin_review', ['station_license', station, 'approved', null]);
  for (const [m, price] of [[pet.id, 185], [alu.id, 650]] as const) { await rpc(st, 'station_set_material', [station, m, true, null]); await rpc(st, 'station_set_price', [station, m, price]); }

  const names = ['مطعم الياسمين (تجريبي)', 'فندق الواحة (تجريبي)', 'مدرسة النخيل (تجريبي)', 'مكتب الأفق (تجريبي)', 'مقهى الزاوية (تجريبي)', 'مطعم البيدر (تجريبي)'];
  const inst: { owner: string; branch: string }[] = [];
  for (let i = 0; i < names.length; i++) {
    const owner = await user(`owner${i + 1}@demo.lamma.test`, `مفوّض ${i + 1} (تجريبي)`);
    const org = await rpc(owner, 'register_institution', [names[i], 'demo', 'الفرع الرئيسي', area.id, 'عمّان – عنوان تجريبي', 31.95 + i * 0.004, 35.90 + i * 0.005]);
    if (i < 5) await rpc(boss, 'admin_review', ['organization', org, 'approved', null]);   // the 6th stays pending for the review queue
    inst.push({ owner, branch: (await admin(`select id from public.branches where org_id=$1`, [org]))[0].id });
  }
  const drivers: { id: string; vehicle: string }[] = [];
  for (let i = 1; i <= 3; i++) {
    const id = await user(`driver${i}@demo.lamma.test`, `سائق ${i} (تجريبي)`);
    await rpc(id, 'register_driver', [[area.id]]);
    const vehicle = await rpc(id, 'add_vehicle', ['بيك أب', `DEMO-${i}`, kg(i === 3 ? 50 : 800), 6000]);
    const doc = await rpc(id, 'add_driver_document', ['driving_licence', null, '2030-01-01']);
    const scale = await rpc(id, 'add_driver_scale', [`SC-DEMO-${i}`, 'ميزان معلّق', kg(150), 50, '2030-01-01', null]);
    if (i < 3) for (const [e, x] of [['driver', id], ['vehicle', vehicle], ['driver_document', doc], ['driver_scale', scale]]) await rpc(boss, 'admin_review', [e, x, 'approved', null]);
    drivers.push({ id, vehicle });
  }
  const request = (i: number, lines: object[]) => rpc(inst[i]!.owner, 'submit_pickup_request', [inst[i]!.branch, JSON.stringify(lines), null, null, null]);
  const publish = async (reqs: string[], inMin: number) => (await service(`select public.publish_route($1) r`, [JSON.stringify({ service_area_id: area.id, station_id: station,
    starts_at: new Date(Date.now() + inMin * 60000).toISOString(), expected_duration_min: 110, distance_m: 14500, distance_is_estimate: true, planner_version: 'demo-seed',
    stops: reqs.map((r, i) => ({ request_id: r, seq: i + 1 })) })]))[0].r as string;

  // Route A: completed yesterday-style journey (70.000 kg signed, station confirmed)
  const a = await publish([await request(0, [{ material_id: pet.id, est_g: kg(20), containers: 3 }]), await request(1, [{ material_id: pet.id, est_g: kg(25), containers: 4 }]), await request(2, [{ material_id: pet.id, est_g: kg(30), containers: 5 }])], 5);
  await rpc(drivers[0]!.id, 'apply_to_route', [a, drivers[0]!.vehicle]); await service(`select public.assign_route($1)`, [a]);
  await rpc(drivers[0]!.id, 'start_route', [a]);
  const stops = await admin(`select id, branch_id from public.route_stops where route_id=$1 order by seq`, [a]);
  const w = [18.25, 23.5, 28.25];
  for (let i = 0; i < 3; i++) {
    await rpc(drivers[0]!.id, 'arrive_stop', [stops[i].id]);
    const rec = await rpc(drivers[0]!.id, 'record_weights', [stops[i].id, randomUUID(), new Date().toISOString(), JSON.stringify([{ material_id: pet.id, method: 'gross_tare', gross_g: kg(w[i]!) + 400, tare_g: 400, net_g: kg(w[i]!) }]), null, null, null, null]);
    await rpc(inst.find((x) => x.branch === stops[i].branch_id)!.owner, 'sign_weights', [rec.version_id, rec.data_hash, null, 'ar']);
    await rpc(drivers[0]!.id, 'complete_stop', [stops[i].id]);
  }
  await rpc(drivers[0]!.id, 'arrive_station', [a]);
  await rpc(st, 'submit_station_receipt', [a, randomUUID(), JSON.stringify([{ material_id: pet.id, net_g: kg(70) }]), null]);

  // Route B: published and open for applications (driver1 and driver2 can apply in the app)
  await publish([await request(3, [{ material_id: pet.id, est_g: kg(22), containers: 3 }, { material_id: alu.id, est_g: kg(12), containers: 2 }]), await request(4, [{ material_id: pet.id, est_g: kg(18), containers: 2 }]),
                 await request(0, [{ material_id: alu.id, est_g: kg(14), containers: 2 }])], 30);
  console.log('lamma_dev seeded. Accounts: admin@ / station@ / owner1..6@ / driver1..3@demo.lamma.test (shared DEV_PASSWORD)');
  await pool.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
