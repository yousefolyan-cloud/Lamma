// Planning worker: readiness → routes → automatic publication → due assignments.
// Runs as a scheduled job (cron) with the service role; safe to run twice (publish_route reserves requests atomically).
import { greatCircleProvider, planRoutes, type Candidate, type DistanceProvider, type StationOption } from '../../packages/domain/src/index';

export type ServiceQuery = <R = any>(text: string, params?: unknown[]) => Promise<R[]>;
export interface PlanningConfig {
  /** minutes between "now" and the start of a newly published route */
  startLeadMin: number;
  distance: DistanceProvider;
  now?: () => Date;
}
export interface PlanningReport {
  areas: { areaId: string; published: string[]; skipped: { requestId: string; reason: string }[]; blocked?: string }[];
  assigned: number;
}

const ammanMinuteOfDay = (t: Date) => {
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Amman', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(t);
  return Number(p.find((x) => x.type === 'hour')!.value) * 60 + Number(p.find((x) => x.type === 'minute')!.value);
};
const toMin = (t: string | null) => (t ? Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5)) : null);

export async function runPlanning(q: ServiceQuery, cfg: PlanningConfig): Promise<PlanningReport> {
  const now = (cfg.now ?? (() => new Date()))();
  const report: PlanningReport = { areas: [], assigned: 0 };
  const areas = await q<any>(`select a.id, p.* from public.service_areas a left join public.area_policies p on p.service_area_id = a.id where a.active`);
  for (const a of areas) {
    const entry: PlanningReport['areas'][number] = { areaId: a.id, published: [], skipped: [] };
    report.areas.push(entry);
    if (a.service_area_id == null) { entry.blocked = 'policy_missing'; continue; }
    if (!a.auto_publish) { entry.blocked = 'auto_publish_paused'; continue; }
    const need = ['base_pay_fils', 'application_window_min', 'plan_capacity_g', 'max_stops', 'max_route_min', 'service_min_per_stop', 'unload_min'];
    const missing = need.filter((k) => a[k] == null);
    if (missing.length) { entry.blocked = 'policy_incomplete:' + missing.join(','); continue; }   // never fill gaps with invented numbers

    const cands = await q<any>(`select * from public.planning_candidates($1)`, [a.id]);
    const stations = await q<any>(
      `select s.id, st_y(s.location::geometry) lat, st_x(s.location::geometry) lng, s.opens_at::text, s.closes_at::text,
              coalesce(json_object_agg(pv.material_id, pv.price_fils_per_kg) filter (where pv.id is not null), '{}') prices
       from public.stations s join public.organizations o on o.id = s.org_id and o.status = 'approved'
       left join public.station_materials sm on sm.station_id = s.id and sm.accepted
       left join public.price_versions pv on pv.station_id = s.id and pv.material_id = sm.material_id
            and pv.valid_from <= now() and (pv.valid_to is null or pv.valid_to > now())
       where s.license_verified and s.location is not null and (s.license_expires_on is null or s.license_expires_on >= current_date)
       group by s.id`);
    const stationOptions: StationOption[] = stations.map((s) => ({
      stationId: s.id, lat: s.lat, lng: s.lng, accepts: Object.keys(s.prices),
      priceFilsPerKg: Object.fromEntries(Object.entries(s.prices).map(([k, v]) => [k, Number(v)])),
      opensAtMin: toMin(s.opens_at), closesAtMin: toMin(s.closes_at) }));
    const candidates: Candidate[] = cands.map((c) => ({
      requestId: c.request_id, lat: c.lat, lng: c.lng, estG: c.est_g, estL: c.est_l, ready: c.ready, materials: c.materials,
      windowStart: c.window_start, windowEnd: c.window_end, waitingSince: c.waiting_since }));
    const startsAt = new Date(now.getTime() + cfg.startLeadMin * 60000);
    const plan = planRoutes({ candidates, stations: stationOptions, startsAt, distance: cfg.distance, minuteOfDay: ammanMinuteOfDay,
      policy: { planCapacityG: a.plan_capacity_g, planCapacityL: a.plan_capacity_l, maxStops: a.max_stops, maxRouteMin: a.max_route_min,
                serviceMinPerStop: a.service_min_per_stop, unloadMin: a.unload_min } });
    entry.skipped.push(...plan.skipped);
    for (const r of plan.routes) {
      try {
        const [row] = await q<{ id: string }>(`select public.publish_route($1) as id`, [JSON.stringify({
          service_area_id: a.id, station_id: r.stationId, starts_at: r.startsAt.toISOString(), expected_duration_min: r.durationMin,
          distance_m: r.distanceM, distance_is_estimate: r.distanceIsEstimate, required_capacity_l: r.estL, planner_version: plan.plannerVersion,
          stops: r.stops.map((s) => ({ request_id: s.requestId, seq: s.seq })) })]);
        entry.published.push(row!.id);
      } catch (e: any) {
        // e.g. another run already reserved these requests: record and move on, never duplicate
        for (const s of r.stops) entry.skipped.push({ requestId: s.requestId, reason: String(e.message).split(':')[0]! });
      }
    }
  }
  const [d] = await q<{ n: number }>(`select public.assign_due_routes() as n`);
  report.assigned = d!.n;
  return report;
}

export function distanceFromEnv(env: NodeJS.ProcessEnv): DistanceProvider {
  const detourFactor = Number(env.PLAN_DETOUR_FACTOR), speedKmh = Number(env.PLAN_AVG_SPEED_KMH);
  if (!Number.isFinite(detourFactor) || !Number.isFinite(speedKmh)) {
    throw new Error('PLAN_DETOUR_FACTOR and PLAN_AVG_SPEED_KMH must be set (operating assumptions; there is no built-in default)');
  }
  return greatCircleProvider({ detourFactor, speedKmh });
}
