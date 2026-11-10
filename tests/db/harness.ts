// Test harness: a throw-away Postgres database with the real migrations applied.
// Calls run as the `authenticated` role with a JWT `sub`, exactly like PostgREST does on Supabase,
// so RLS and RPC authorization are exercised for real (never with the service role by accident).
import { Pool, type PoolClient } from 'pg';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const base = { host: process.env.PGHOST ?? 'localhost', port: +(process.env.PGPORT ?? 5432), user: process.env.PGUSER ?? 'postgres', password: process.env.PGPASSWORD ?? 'postgres' };
const root = join(__dirname, '..', '..');

export type Db = Awaited<ReturnType<typeof createDb>>;

export async function createDb() {
  const name = 'lamma_t_' + randomUUID().slice(0, 8);
  const boot = new Pool({ ...base, database: 'postgres', max: 1 });
  await boot.query(`create database ${name}`);
  const pool = new Pool({ ...base, database: name, max: 8 });
  pool.on('error', () => {}); boot.on('error', () => {});
  await pool.query(readFileSync(join(root, 'tests/db/shim.sql'), 'utf8'));
  const dir = join(root, 'supabase/migrations');
  for (const f of readdirSync(dir).sort()) await pool.query(readFileSync(join(dir, f), 'utf8'));
  await pool.query(`grant all on all tables in schema public to service_role; grant usage on schema app to service_role;
                    grant execute on function app.is_service() to service_role`);

  async function withClaims<T>(claims: object, role: string, fn: (c: PoolClient) => Promise<T>): Promise<T> {
    const c = await pool.connect();
    try {
      await c.query(`select set_config('request.jwt.claims', $1, false)`, [JSON.stringify(claims)]);
      await c.query(`set role ${role}`);
      return await fn(c);
    } finally {
      await c.query('reset role').catch(() => {});
      await c.query(`select set_config('request.jwt.claims', '', false)`).catch(() => {});
      c.release();
    }
  }
  return {
    name, pool,
    /** superuser: only for fixtures that have no product path yet (areas, materials) and for assertions */
    admin: async <R = any>(text: string, params: unknown[] = []) => (await pool.query(text, params)).rows as R[],
    /** run SQL as an end user */
    as: async <R = any>(userId: string, text: string, params: unknown[] = []) =>
      withClaims({ sub: userId, role: 'authenticated' }, 'authenticated', async (c) => (await c.query(text, params)).rows as R[]),
    /** call an RPC as an end user and return its scalar result */
    rpc: async <R = any>(userId: string, fn: string, args: unknown[] = []) =>
      withClaims({ sub: userId, role: 'authenticated' }, 'authenticated', async (c) =>
        (await c.query(`select public.${fn}(${args.map((_, i) => '$' + (i + 1)).join(',')}) as r`, args)).rows[0].r as R),
    /** backend worker (service role key) */
    service: async <R = any>(text: string, params: unknown[] = []) =>
      withClaims({ role: 'service_role' }, 'service_role', async (c) => (await c.query(text, params)).rows as R[]),
    async destroy() { await pool.end(); await boot.query(`drop database if exists ${name} with (force)`); await boot.end(); },
  };
}

export async function newUser(db: Db, name: string) {
  const [u] = await db.admin<{ id: string }>(`insert into auth.users(email, raw_user_meta_data) values ($1, $2) returning id`,
    [`${name}-${randomUUID().slice(0, 6)}@example.test`, { full_name: name }]);
  return u.id;
}

export const kg = (v: number) => Math.round(v * 1000);

/** A fictional, fully approved world built through the real RPCs wherever one exists. */
export async function buildWorld(db: Db, opts: { institutions?: number; tolerance?: { g?: number; bps?: number } } = {}) {
  const admin = await newUser(db, 'admin');
  await db.admin(`select app.bootstrap_admin($1)`, [admin]);
  const [area] = await db.admin<{ id: string }>(`insert into public.service_areas(code, name_ar, name_en, city, active) values ('AMM-DEMO','منطقة تجريبية','Demo zone','Amman', true) returning id`);
  const [pet] = await db.admin<{ id: string }>(`insert into public.material_types(code, name_ar, name_en, bulk_density_g_per_l, density_source) values ('PET','بلاستيك PET','PET plastic', 30, 'demo') returning id`);
  const [alu] = await db.admin<{ id: string }>(`insert into public.material_types(code, name_ar, name_en) values ('ALU','ألمنيوم','Aluminium') returning id`);
  await db.admin(`insert into public.required_driver_documents(kind) values ('driving_licence')`);
  await db.rpc(admin, 'admin_set_threshold', [area.id, pet.id, kg(15)]);
  await db.rpc(admin, 'admin_set_area_policy', [area.id, { base_pay_fils: 10000, per_stop_pay_fils: 1000, application_window_min: 0, early_start_min: 600, ...(opts.tolerance ? { tolerance_g: opts.tolerance.g ?? 0, tolerance_bps: opts.tolerance.bps ?? 0 } : {}) }]);

  // station
  const stationUser = await newUser(db, 'station-manager');
  const station = await db.rpc<string>(stationUser, 'register_station', ['محطة فرز تجريبية', area.id, 'عمّان', 31.95, 35.93, 'جهة تجريبية', 'LIC-TEST', '2030-01-01']);
  const [{ org_id: stationOrg }] = await db.admin(`select org_id from public.stations where id = $1`, [station]);
  await db.rpc(admin, 'admin_review', ['organization', stationOrg, 'approved', null]);
  await db.rpc(admin, 'admin_review', ['station_license', station, 'approved', null]);
  await db.rpc(stationUser, 'station_set_material', [station, pet.id, true, null]);
  await db.rpc(stationUser, 'station_set_material', [station, alu.id, true, null]);
  await db.rpc(stationUser, 'station_set_price', [station, pet.id, 185]);
  await db.rpc(stationUser, 'station_set_price', [station, alu.id, 650]);

  // institutions
  const institutions: { owner: string; org: string; branch: string }[] = [];
  for (let i = 0; i < (opts.institutions ?? 3); i++) {
    const owner = await newUser(db, `owner-${i}`);
    const org = await db.rpc<string>(owner, 'register_institution', [`مؤسسة تجريبية ${i + 1}`, 'restaurant', 'الفرع الرئيسي', area.id, 'عمّان', 31.95 + i * 0.004, 35.91 + i * 0.004]);
    await db.rpc(admin, 'admin_review', ['organization', org, 'approved', null]);
    const [{ id: branch }] = await db.admin(`select id from public.branches where org_id = $1`, [org]);
    institutions.push({ owner, org, branch });
  }
  return { admin, area: area.id, pet: pet.id, alu: alu.id, station, stationOrg, stationUser, institutions };
}

export async function approvedDriver(db: Db, w: { admin: string; area: string }, name: string, o: { capacityKg?: number; capacityL?: number; scale?: boolean } = {}) {
  const id = await newUser(db, name);
  await db.rpc(id, 'register_driver', [[w.area]]);
  const vehicle = await db.rpc<string>(id, 'add_vehicle', ['pickup', 'TEST-' + name, kg(o.capacityKg ?? 800), o.capacityL ?? 6000]);
  const doc = await db.rpc<string>(id, 'add_driver_document', ['driving_licence', null, '2030-01-01']);
  await db.rpc(w.admin, 'admin_review', ['driver', id, 'approved', null]);
  await db.rpc(w.admin, 'admin_review', ['vehicle', vehicle, 'approved', null]);
  await db.rpc(w.admin, 'admin_review', ['driver_document', doc, 'approved', null]);
  let scale: string | null = null;
  if (o.scale !== false) {
    scale = await db.rpc<string>(id, 'add_driver_scale', ['SC-' + name, 'hanging', kg(150), 50, '2030-01-01', null]);
    await db.rpc(w.admin, 'admin_review', ['driver_scale', scale, 'approved', null]);
  }
  return { id, vehicle, scale };
}

type World = Awaited<ReturnType<typeof buildWorld>>;

/** institutions declare readiness, backend publishes one route visiting all of them */
export async function publishedRoute(db: Db, w: World, estKg: number[] = [20, 25, 30], startsInMin = 60) {
  const requests: string[] = [];
  for (let i = 0; i < estKg.length; i++) {
    requests.push(await db.rpc<string>(w.institutions[i].owner, 'submit_pickup_request',
      [w.institutions[i].branch, JSON.stringify([{ material_id: w.pet, est_g: kg(estKg[i]), containers: 2 }]), null, null, null]));
  }
  const payload = { service_area_id: w.area, station_id: w.station, starts_at: new Date(Date.now() + startsInMin * 60000).toISOString(),
    expected_duration_min: 120, distance_m: 14500, distance_is_estimate: true, planner_version: 'test',
    stops: requests.map((r, i) => ({ request_id: r, seq: i + 1 })) };
  const [{ r: route }] = await db.service<{ r: string }>(`select public.publish_route($1) as r`, [JSON.stringify(payload)]);
  return { route, requests, payload };
}

export async function assignTo(db: Db, route: string, driver: { id: string; vehicle: string }) {
  const res = await db.rpc<{ status: string; reasons: string[] }>(driver.id, 'apply_to_route', [route, driver.vehicle]);
  const [{ r }] = await db.service<{ r: string | null }>(`select public.assign_route($1) as r`, [route]);
  return { application: res, assignment: r };
}

/** driver weighs, the institution's delegate signs on their own account, driver completes the stop */
export async function collectStop(db: Db, w: World, driver: string, stop: { id: string; branch_id: string }, netKg: number, material?: string) {
  const inst = w.institutions.find((i) => i.branch === stop.branch_id)!;
  await db.rpc(driver, 'arrive_stop', [stop.id]);
  const rec = await db.rpc<{ version_id: string; data_hash: string }>(driver, 'record_weights',
    [stop.id, randomUUID(), new Date().toISOString(), JSON.stringify([{ material_id: material ?? w.pet, method: 'gross_tare', gross_g: kg(netKg) + 400, tare_g: 400, net_g: kg(netKg) }]), null, null, null, null]);
  await db.rpc(inst.owner, 'sign_weights', [rec.version_id, rec.data_hash, null, 'ar']);
  return db.rpc<{ route_status: string; next_stop_id: string | null; next_is_station: boolean }>(driver, 'complete_stop', [stop.id]);
}

export async function stopsOf(db: Db, route: string) {
  return db.admin<{ id: string; branch_id: string; seq: number; status: string }>(`select id, branch_id, seq, status from public.route_stops where route_id = $1 order by seq`, [route]);
}

export async function expectError(p: Promise<unknown>, code: string) {
  try { await p; } catch (e: any) {
    if (!String(e.message).includes(code)) throw new Error(`expected error "${code}" but got: ${e.message}`);
    return;
  }
  throw new Error(`expected error "${code}" but the call succeeded`);
}
