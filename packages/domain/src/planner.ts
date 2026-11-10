// Route planner v1 ("planner-ci-2opt-v1"):
//   oldest-first seeding → cheapest feasible insertion under weight, volume, stop-count, duration and
//   time-window constraints → 2-opt local improvement → station choice among stations accepting every material.
// It returns a good FEASIBLE plan with the reasons for anything left out. It does not claim global optimality.
// Distances come from a DistanceProvider; the built-in great-circle provider is an ESTIMATE and is flagged as such.

export interface LatLng { lat: number; lng: number }
export interface Candidate extends LatLng {
  requestId: string;
  estG: number | null;          // null = unknown → never planned
  estL: number | null;          // null = volume unknown for at least one material
  ready: boolean;               // threshold reached (decided by the backend from admin thresholds)
  materials: string[];
  windowStart?: Date | null;
  windowEnd?: Date | null;
  waitingSince: Date;
}
export interface StationOption extends LatLng {
  stationId: string;
  accepts: string[];
  priceFilsPerKg: Record<string, number>;
  opensAtMin?: number | null;   // minutes from local midnight
  closesAtMin?: number | null;
}
export interface PlanPolicy {
  planCapacityG: number;
  planCapacityL: number | null;
  maxStops: number;
  maxRouteMin: number;
  serviceMinPerStop: number;
  unloadMin: number;
}
export interface Leg { meters: number; minutes: number }
export interface DistanceProvider {
  isEstimate: boolean;
  leg(a: LatLng, b: LatLng): Leg;
}
export interface PlannedRoute {
  stationId: string;
  stops: { requestId: string; seq: number; arriveAt: Date }[];
  startsAt: Date;
  distanceM: number;
  durationMin: number;
  estG: number;
  estL: number | null;
  distanceIsEstimate: boolean;
}
export type SkipReason = 'not_ready' | 'estimate_missing' | 'exceeds_capacity_alone' | 'no_station_accepts_materials'
  | 'time_window_unreachable' | 'route_too_long_alone' | 'station_closed';
export interface PlanResult { routes: PlannedRoute[]; skipped: { requestId: string; reason: SkipReason }[]; plannerVersion: string }

export const PLANNER_VERSION = 'planner-ci-2opt-v1';

/** Great-circle estimate. `detourFactor` and `speedKmh` are operating assumptions supplied by configuration. */
export function greatCircleProvider(cfg: { detourFactor: number; speedKmh: number }): DistanceProvider {
  if (!(cfg.detourFactor >= 1) || !(cfg.speedKmh > 0)) throw new RangeError('invalid distance configuration');
  const R = 6371000, rad = (d: number) => (d * Math.PI) / 180;
  return {
    isEstimate: true,
    leg(a, b) {
      const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
      const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
      const meters = 2 * R * Math.asin(Math.sqrt(h)) * cfg.detourFactor;
      return { meters, minutes: meters / 1000 / cfg.speedKmh * 60 };
    },
  };
}

interface Draft { stops: Candidate[]; station: StationOption }

function evaluate(d: Draft, startsAt: Date, policy: PlanPolicy, dist: DistanceProvider, minuteOfDay: (t: Date) => number) {
  let meters = 0, minutes = 0, g = 0, l: number | null = 0;
  const arrivals: Date[] = [];
  let feasible = true, reason: SkipReason | null = null;
  for (let i = 0; i < d.stops.length; i++) {
    const s = d.stops[i]!;
    if (i > 0) { const leg = dist.leg(d.stops[i - 1]!, s); meters += leg.meters; minutes += leg.minutes; }
    let arrive = new Date(startsAt.getTime() + minutes * 60000);
    if (s.windowStart && arrive < s.windowStart) { minutes += (s.windowStart.getTime() - arrive.getTime()) / 60000; arrive = s.windowStart; }
    if (s.windowEnd && arrive > s.windowEnd) { feasible = false; reason = 'time_window_unreachable'; }
    arrivals.push(arrive);
    minutes += policy.serviceMinPerStop;
    g += s.estG ?? 0;
    l = l === null || s.estL === null ? null : l + s.estL;
  }
  const last = dist.leg(d.stops[d.stops.length - 1]!, d.station);
  meters += last.meters; minutes += last.minutes;
  const atStation = minuteOfDay(new Date(startsAt.getTime() + minutes * 60000));
  if (d.station.opensAtMin != null && d.station.closesAtMin != null && (atStation < d.station.opensAtMin || atStation > d.station.closesAtMin)) {
    feasible = false; reason ??= 'station_closed';
  }
  minutes += policy.unloadMin;
  if (g > policy.planCapacityG || (policy.planCapacityL != null && l != null && l > policy.planCapacityL)) { feasible = false; reason ??= 'exceeds_capacity_alone'; }
  if (minutes > policy.maxRouteMin) { feasible = false; reason ??= 'route_too_long_alone'; }
  if (d.stops.length > policy.maxStops) feasible = false;
  return { feasible, reason, meters, minutes, g, l, arrivals };
}

function estValue(stops: Candidate[], st: StationOption): number {
  // conservative: split a request's estimate evenly across its materials only to rank stations; never shown as revenue
  return stops.reduce((sum, c) => sum + c.materials.reduce((v, m) => v + ((c.estG ?? 0) / c.materials.length) * (st.priceFilsPerKg[m] ?? 0), 0), 0);
}

export function planRoutes(input: {
  candidates: Candidate[]; stations: StationOption[]; policy: PlanPolicy; startsAt: Date;
  distance: DistanceProvider; minuteOfDay?: (t: Date) => number; deadlineMs?: number;
}): PlanResult {
  const { stations, policy, startsAt, distance } = input;
  const minuteOfDay = input.minuteOfDay ?? ((t: Date) => t.getUTCHours() * 60 + t.getUTCMinutes());
  const deadline = Date.now() + (input.deadlineMs ?? 2000);
  const skipped: PlanResult['skipped'] = [];
  const pool: Candidate[] = [];
  for (const c of input.candidates) {
    if (c.estG == null) skipped.push({ requestId: c.requestId, reason: 'estimate_missing' });
    else if (!c.ready) skipped.push({ requestId: c.requestId, reason: 'not_ready' });
    else pool.push(c);
  }
  pool.sort((a, b) => a.waitingSince.getTime() - b.waitingSince.getTime() || a.requestId.localeCompare(b.requestId));

  const stationsFor = (stops: Candidate[]) => stations.filter((s) => stops.every((c) => c.materials.every((m) => s.accepts.includes(m) && s.priceFilsPerKg[m] != null)));
  const best = (stops: Candidate[]) => {
    let out: { d: Draft; ev: ReturnType<typeof evaluate> } | null = null; let firstReason: SkipReason | null = null;
    const options = stationsFor(stops);
    if (options.length === 0) return { out: null, reason: 'no_station_accepts_materials' as SkipReason };
    for (const st of options) {
      const d = { stops, station: st }; const ev = evaluate(d, startsAt, policy, distance, minuteOfDay);
      if (!ev.feasible) { firstReason ??= ev.reason; continue; }
      if (!out || estValue(stops, st) > estValue(stops, out.d.station) || (estValue(stops, st) === estValue(stops, out.d.station) && ev.meters < out.ev.meters)) out = { d, ev };
    }
    return { out, reason: firstReason };
  };

  const routes: PlannedRoute[] = [];
  const remaining = [...pool];
  while (remaining.length > 0) {
    const seed = remaining.shift()!;
    let cur = best([seed]);
    if (!cur.out) { skipped.push({ requestId: seed.requestId, reason: cur.reason ?? 'route_too_long_alone' }); continue; }
    let current = cur.out;
    // cheapest feasible insertion
    for (;;) {
      if (Date.now() > deadline) break;
      let pick: { idx: number; res: NonNullable<ReturnType<typeof best>['out']> } | null = null;
      for (let i = 0; i < remaining.length; i++) {
        for (let pos = 0; pos <= current.d.stops.length; pos++) {
          const trial = [...current.d.stops.slice(0, pos), remaining[i]!, ...current.d.stops.slice(pos)];
          const r = best(trial).out;
          if (r && (!pick || r.ev.meters < pick.res.ev.meters)) pick = { idx: i, res: r };
        }
      }
      if (!pick) break;
      current = pick.res; remaining.splice(pick.idx, 1);
    }
    // 2-opt on the stop order (the station stays last)
    let improved = true;
    while (improved && Date.now() <= deadline) {
      improved = false;
      const s = current.d.stops;
      for (let i = 0; i < s.length - 1 && !improved; i++) for (let j = i + 1; j < s.length && !improved; j++) {
        const trial = [...s.slice(0, i), ...s.slice(i, j + 1).reverse(), ...s.slice(j + 1)];
        const r = best(trial).out;
        if (r && r.ev.meters < current.ev.meters - 1) { current = r; improved = true; }
      }
    }
    routes.push({
      stationId: current.d.station.stationId, startsAt,
      stops: current.d.stops.map((c, i) => ({ requestId: c.requestId, seq: i + 1, arriveAt: current.ev.arrivals[i]! })),
      distanceM: Math.round(current.ev.meters), durationMin: Math.ceil(current.ev.minutes),
      estG: current.ev.g, estL: current.ev.l === null ? null : Math.ceil(current.ev.l), distanceIsEstimate: distance.isEstimate,
    });
  }
  return { routes, skipped, plannerVersion: PLANNER_VERSION };
}
