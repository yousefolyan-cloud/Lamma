import { describe, expect, it } from 'vitest';
import { canTransition, compareWeights, errorCode, formatJod, formatKg, greatCircleProvider, materialValueFils, netFromGrossTare, parseKgToGrams, planRoutes, type Candidate, type StationOption } from './index';

describe('units', () => {
  it('parses and prints kg / JOD with exactly three decimals, including Arabic digits', () => {
    expect(parseKgToGrams('18.25')).toBe(18250);
    expect(parseKgToGrams('١٨٫٢٥')).toBe(18250);
    expect(parseKgToGrams('0.001')).toBe(1);
    for (const bad of ['', '-1', '1.2345', 'abc', '1e3', '1..2']) expect(parseKgToGrams(bad), bad).toBeNull();
    expect(formatKg(18250 + 23500 + 28250)).toBe('70.000');
    expect(formatJod(12950n)).toBe('12.950');
    expect(formatJod(5)).toBe('0.005');
    expect(formatJod(-1500)).toBe('-1.500');
  });
  it('money never drifts: integer fils, half-up, where floats would be wrong', () => {
    expect(materialValueFils(70000, 185)).toBe(12950n);
    expect(materialValueFils(69400, 185)).toBe(12839n);
    expect(materialValueFils(1, 500)).toBe(1n);   // 0.5 fils rounds up
    expect(materialValueFils(1, 499)).toBe(0n);
    expect(0.1 + 0.2).not.toBe(0.3);              // the reason floats are banned here
    const parts = [18250, 23500, 28250].map((g) => materialValueFils(g, 185));
    expect(parts.reduce((a, b) => a + b)).toBe(3376n + 4348n + 5226n); // per-stop rounding is explicit, not hidden
    expect(() => materialValueFils(-1, 5)).toThrow();
    expect(() => netFromGrossTare(400, 400)).toThrow();
    expect(netFromGrossTare(18650, 400)).toBe(18250);
  });
  it('weight comparison uses only an approved tolerance', () => {
    expect(compareWeights(70000, 70000, null)).toMatchObject({ diffG: 0, within: true });
    expect(compareWeights(70000, 69990, null)).toMatchObject({ diffG: -10, within: false, toleranceG: 0 });
    expect(compareWeights(70000, 69700, { toleranceG: 300 })).toMatchObject({ within: true });
    expect(compareWeights(70000, 69600, { toleranceG: 300, toleranceBps: 50 })).toMatchObject({ within: false, toleranceG: 350 });
  });
  it('state machine: only the station completes a route', () => {
    expect(canTransition('awaiting_station_receipt', 'completed', 'station')).toBe(true);
    for (const from of ['assigned', 'in_progress', 'en_route_to_station', 'awaiting_station_receipt', 'needs_review'] as const)
      expect(canTransition(from, 'completed', 'driver')).toBe(false);
    expect(canTransition('en_route_to_station', 'completed', 'station')).toBe(false);
    expect(errorCode('signature_required: the current weights are not signed')).toBe('signature_required');
    expect(errorCode('Network request failed')).toBe('unknown_error');
  });
});

describe('planner', () => {
  const t0 = new Date('2026-11-12T06:00:00Z');
  const dist = greatCircleProvider({ detourFactor: 1.3, speedKmh: 30 });
  const policy = { planCapacityG: 100_000, planCapacityL: 4000, maxStops: 10, maxRouteMin: 240, serviceMinPerStop: 10, unloadMin: 20 };
  const station: StationOption = { stationId: 'S', lat: 31.99, lng: 35.99, accepts: ['PET', 'ALU'], priceFilsPerKg: { PET: 185, ALU: 650 } };
  const c = (id: string, lat: number, lng: number, kg: number, extra: Partial<Candidate> = {}): Candidate =>
    ({ requestId: id, lat, lng, estG: kg * 1000, estL: kg * 30, ready: true, materials: ['PET'], waitingSince: new Date(t0.getTime() - 86400e3), ...extra });

  it('groups nearby ready sites into one route, orders them along the way, and ends at the station', () => {
    const res = planRoutes({ startsAt: t0, policy, stations: [station], distance: dist,
      candidates: [c('far', 31.98, 35.98, 20), c('near', 31.95, 35.95, 25), c('mid', 31.965, 35.965, 30)] });
    expect(res.routes).toHaveLength(1);
    expect(res.routes[0]!.stops.map((s) => s.requestId)).toEqual(['near', 'mid', 'far']);
    expect(res.routes[0]).toMatchObject({ estG: 75000, estL: 2250, distanceIsEstimate: true, stationId: 'S' });
    expect(res.routes[0]!.durationMin).toBeGreaterThan(3 * 10 + 20);
    expect(res.plannerVersion).toBe('planner-ci-2opt-v1');
  });
  it('never exceeds weight OR volume capacity; splits into more routes instead', () => {
    const byWeight = planRoutes({ startsAt: t0, policy: { ...policy, planCapacityL: null }, stations: [station], distance: dist,
      candidates: [c('a', 31.95, 35.95, 60), c('b', 31.951, 35.951, 60), c('c', 31.952, 35.952, 30)] });
    expect(byWeight.routes.every((r) => r.estG <= 100_000)).toBe(true);
    expect(byWeight.routes.length).toBe(2);
    // plastic fills the truck by volume long before weight
    const byVolume = planRoutes({ startsAt: t0, policy: { ...policy, planCapacityL: 1500 }, stations: [station], distance: dist,
      candidates: [c('a', 31.95, 35.95, 30), c('b', 31.951, 35.951, 30)] });
    expect(byVolume.routes).toHaveLength(2);
    expect(byVolume.routes.every((r) => (r.estL ?? 0) <= 1500)).toBe(true);
  });
  it('explains what it leaves out instead of guessing', () => {
    const res = planRoutes({ startsAt: t0, policy, stations: [station], distance: dist, candidates: [
      c('ok', 31.95, 35.95, 20),
      c('unknown', 31.95, 35.95, 0, { estG: null, estL: null }),
      c('below-threshold', 31.95, 35.95, 3, { ready: false }),
      c('glass', 31.95, 35.95, 20, { materials: ['GLASS'] }),
      c('too-big', 31.95, 35.95, 500),
      c('late-window', 31.95, 35.95, 20, { windowEnd: new Date(t0.getTime() - 60000) }),
    ] });
    expect(res.routes.flatMap((r) => r.stops.map((s) => s.requestId))).toEqual(['ok']);
    expect(Object.fromEntries(res.skipped.map((s) => [s.requestId, s.reason]))).toEqual({
      unknown: 'estimate_missing', 'below-threshold': 'not_ready', glass: 'no_station_accepts_materials',
      'too-big': 'exceeds_capacity_alone', 'late-window': 'time_window_unreachable' });
  });
  it('respects the maximum route duration, station opening hours and a waiting time window', () => {
    const tight = planRoutes({ startsAt: t0, policy: { ...policy, maxRouteMin: 60 }, stations: [station], distance: dist,
      candidates: [c('a', 31.95, 35.95, 10), c('b', 31.80, 35.80, 10)] });
    expect(tight.routes.every((r) => r.durationMin <= 60)).toBe(true);
    const closed = planRoutes({ startsAt: t0, policy, stations: [{ ...station, opensAtMin: 12 * 60, closesAtMin: 13 * 60 }], distance: dist, candidates: [c('a', 31.95, 35.95, 10)] });
    expect(closed.routes).toHaveLength(0);
    expect(closed.skipped[0]!.reason).toBe('station_closed');
    const waits = planRoutes({ startsAt: t0, policy, stations: [station], distance: dist,
      candidates: [c('a', 31.95, 35.95, 10, { windowStart: new Date(t0.getTime() + 45 * 60000) })] });
    expect(waits.routes[0]!.stops[0]!.arriveAt.getTime()).toBe(t0.getTime() + 45 * 60000);
  });
  it('picks a station that accepts every material, preferring the better conservative value', () => {
    const cheap: StationOption = { ...station, stationId: 'cheap', priceFilsPerKg: { PET: 100 } , accepts: ['PET'] };
    const res = planRoutes({ startsAt: t0, policy, stations: [cheap, station], distance: dist, candidates: [c('a', 31.95, 35.95, 20)] });
    expect(res.routes[0]!.stationId).toBe('S');
    const mixed = planRoutes({ startsAt: t0, policy, stations: [cheap], distance: dist, candidates: [c('a', 31.95, 35.95, 20, { materials: ['PET', 'ALU'] })] });
    expect(mixed.routes).toHaveLength(0);
  });
});
