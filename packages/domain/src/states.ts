// Explicit state machines. The server enforces them (SQL); the app uses the same tables to decide what to show.
export type RouteStatus = 'planning' | 'published' | 'assigned' | 'in_progress' | 'en_route_to_station'
  | 'awaiting_station_receipt' | 'completed' | 'needs_review' | 'cancelled' | 'abandoned';
export type Actor = 'system' | 'ops' | 'driver' | 'station';

export const ROUTE_TRANSITIONS: Record<RouteStatus, Partial<Record<RouteStatus, Actor[]>>> = {
  planning: { published: ['system', 'ops'], cancelled: ['ops'] },
  published: { assigned: ['system', 'ops'], cancelled: ['ops'] },
  assigned: { in_progress: ['driver'], published: ['system', 'ops'], cancelled: ['ops'] },
  in_progress: { en_route_to_station: ['system'], needs_review: ['system'], abandoned: ['ops'] },
  en_route_to_station: { awaiting_station_receipt: ['driver'] },
  awaiting_station_receipt: { completed: ['station'], needs_review: ['station'] },
  needs_review: { awaiting_station_receipt: ['ops'] },
  completed: {}, cancelled: {}, abandoned: {},
};

export function canTransition(from: RouteStatus, to: RouteStatus, actor: Actor): boolean {
  return ROUTE_TRANSITIONS[from][to]?.includes(actor) ?? false;
}

export type ApplicationStatus = 'submitted' | 'eligibility_check' | 'eligible_pending_assignment' | 'selected'
  | 'not_selected' | 'ineligible' | 'withdrawn' | 'expired';
export type StopStatus = 'pending' | 'arrived' | 'collected' | 'exception';
export type RequestStatus = 'draft' | 'submitted' | 'scheduled' | 'assigned' | 'collected' | 'delivered_to_station'
  | 'reconciled' | 'closed' | 'cancelled' | 'needs_reschedule';

/** Stable error codes raised by the backend ("code: detail"). */
export function errorCode(message: string | undefined | null): string {
  const m = /^([a-z_]+)(?::|$)/.exec((message ?? '').trim());
  return m?.[1] ?? 'unknown_error';
}
