// Typed access to the backend. Every write is a server RPC; the client never decides roles or states.
import { errorCode } from '@lamma/domain';
import { supabase } from './supabase';

export class ApiError extends Error {
  constructor(public code: string, message: string) { super(message); }
}
async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new ApiError(errorCode(error.message), error.message);
  return data as T;
}
async function table<T>(name: string, build?: (q: any) => any): Promise<T[]> {
  let q = supabase.from(name).select('*');
  if (build) q = build(q);
  const { data, error } = await q;
  if (error) throw new ApiError(errorCode(error.message), error.message);
  return (data ?? []) as T[];
}

export interface Membership { org_id: string; org_name: string; kind: 'institution' | 'station' | 'lamma'; role: string; org_status: string; membership_status: string; status_reason: string | null; station_id: string | null }
export interface Contexts { profile: { full_name: string; locale: 'ar' | 'en' } | null; memberships: Membership[]; driver: { status: string; status_reason: string | null } | null }
export interface Material { id: string; code: string; name_ar: string; name_en: string; active: boolean; bulk_density_g_per_l: number | null; density_source: string | null }
export interface Area { id: string; code: string; name_ar: string; name_en: string; city: string; active: boolean }
export interface Threshold { service_area_id: string; material_id: string; min_g: number }
export const POLICY_KEYS = ['base_pay_fils', 'per_stop_pay_fils', 'per_km_pay_fils', 'application_window_min', 'early_start_min', 'service_min_per_stop', 'unload_min', 'max_route_min', 'max_stops', 'plan_capacity_g', 'plan_capacity_l', 'tolerance_g', 'tolerance_bps'] as const;
export type PolicyKey = (typeof POLICY_KEYS)[number];
export type AreaPolicy = { service_area_id: string; auto_publish: boolean } & Record<PolicyKey, number | string | null>;
export interface DriverDocument { id: string; kind: string; expires_on: string | null; status: string; file_path: string | null }
export interface DriverScale { id: string; identifier: string; scale_type: string | null; capacity_g: number; precision_g: number; check_valid_until: string | null; status: string; check_evidence_path: string | null }
export interface StationMaterial { station_id: string; material_id: string; accepted: boolean; conditions: string | null }
export interface PriceVersion { id: string; station_id: string; material_id: string; price_fils_per_kg: string; valid_from: string; valid_to: string | null }
export interface RouteCard { route_id: string; code: string; est_total_g: number; required_capacity_g: number; required_capacity_l: number | null; stops_count: number; station_name: string; starts_at: string; distance_m: number; distance_is_estimate: boolean; area_name_ar: string; area_name_en: string; expected_duration_min: number; pay_fils: string; my_application_status: string | null; my_application_reasons: string[] | null }
export interface MyRoute { route_id: string; code: string; status: string; starts_at: string; expected_duration_min: number; distance_m: number; pay_fils: string; est_total_g: number; station_name: string; station_address: string | null; station_lat: number | null; station_lng: number | null; active: boolean; receipt: { status: string; signed_total_g: number; station_net_g: number; diff_g: number } | null }
export interface DriverStop { stop_id: string; seq: number; status: 'pending' | 'arrived' | 'collected' | 'exception'; exception_kind: string | null; branch_name: string; org_name: string; address: string | null; entrance_notes: string | null; contact_name: string | null; contact_phone: string | null; lat: number | null; lng: number | null; expected: { material_id: string; est_g: number | null; containers: number | null }[] | null; weigh: { version_id: string; version: number; status: 'awaiting_signature' | 'signed'; lines: { material_id: string; net_g: number }[] } | null }
export interface PendingSignoff { version_id: string; version: number; data_hash: string; occurred_at: string; branch_name: string; route_code: string; driver_name: string; scale_identifier: string; correction_reason: string | null; lines: { material_id: string; name_ar: string; name_en: string; method: string; gross_g: number | null; tare_g: number | null; net_g: number }[] }
export interface Collection { stop_id: string; branch_name: string; route_code: string; route_status: string; stop_status: string; completed_at: string | null; exception_kind: string | null; signed_net_g: number | null }
export interface StationRoute { route_id: string; code: string; status: string; starts_at: string; expected_arrival: string; planned_estimate_g: number; driver_name: string | null; vehicle_plate: string | null; stops_collected: number; stops_exception: number; stops_open: number; signed_total_g: number; signed_by_material: { material_id: string; signed_g: number }[]; receipt: { receipt_id: string; status: string; station_net_g: number; diff_g: number } | null; case_reasons: string[] | null }
export interface ReceiptResult { receipt_id: string; status: 'confirmed' | 'under_review'; diff_g: number; reasons?: string[]; duplicate: boolean }
export interface ReviewQueue { organizations: { id: string; kind: string; name: string }[]; station_licenses: { id: string; name: string; authority: string | null; number: string | null; expires_on: string | null }[]; drivers: { id: string; name: string }[]; vehicles: { id: string; driver: string; type: string; plate: string; capacity_g: number; capacity_l: number }[]; driver_documents: { id: string; driver: string; kind: string; expires_on: string | null; file_path: string | null }[]; driver_scales: { id: string; driver: string; identifier: string; capacity_g: number; precision_g: number; check_valid_until: string | null; evidence_path: string | null }[] }
export interface Overview { routes: { route_id: string; code: string; status: string; starts_at: string; est_total_g: number; pay_fils: string; station_name: string; stops: number; applications: number; driver_name: string | null }[]; cases: { case_id: string; route_code: string; reasons: string[]; has_receipt: boolean; signed_total_g: number | null; station_net_g: number | null; diff_g: number | null }[]; requests_waiting: number; requests_need_reschedule: number; collected_signed_g: number; station_accepted_g: number }
export interface Branch { id: string; org_id: string; name: string; address: string | null; service_area_id: string | null }
export interface PickupRequest { id: string; branch_id: string; status: string; created_at: string }
export interface Vehicle { id: string; vehicle_type: string; plate: string; capacity_g: number; capacity_l: number; status: string }
export interface Notice { id: string; kind: string; payload: Record<string, unknown>; created_at: string; read_at: string | null }
export interface WeighLineInput { material_id: string; method: 'gross_tare' | 'net_direct'; gross_g?: number; tare_g?: number; net_g: number }

export const api = {
  myContexts: () => rpc<Contexts>('my_contexts'),
  materials: () => table<Material>('material_types', (q) => q.eq('active', true).order('code')),
  areas: () => table<Area>('service_areas', (q) => q.eq('active', true).order('code')),
  notices: () => table<Notice>('notifications', (q) => q.order('created_at', { ascending: false }).limit(30)),
  // registration requests
  registerInstitution: (a: { name: string; type: string; branch: string; area: string; address: string; lat: number; lng: number }) =>
    rpc<string>('register_institution', { p_name: a.name, p_institution_type: a.type, p_branch_name: a.branch, p_service_area: a.area, p_address: a.address, p_lat: a.lat, p_lng: a.lng }),
  registerDriver: (areas: string[]) => rpc<null>('register_driver', { p_areas: areas }),
  registerStation: (a: { name: string; area: string; address: string; lat: number; lng: number; authority: string; number: string; expires: string | null }) =>
    rpc<string>('register_station', { p_name: a.name, p_service_area: a.area, p_address: a.address, p_lat: a.lat, p_lng: a.lng, p_license_authority: a.authority, p_license_number: a.number, p_license_expires_on: a.expires }),
  // institution
  branches: (org: string) => table<Branch>('branches', (q) => q.eq('org_id', org).order('name')),
  requests: (branchIds: string[]) => table<PickupRequest>('pickup_requests', (q) => q.in('branch_id', branchIds).order('created_at', { ascending: false }).limit(20)),
  submitRequest: (branch: string, lines: { material_id: string; est_g: number | null; containers: number | null }[], notes: string | null) =>
    rpc<string>('submit_pickup_request', { p_branch: branch, p_lines: lines, p_notes: notes }),
  cancelRequest: (id: string, reason: string) => rpc<null>('cancel_pickup_request', { p_request: id, p_reason: reason }),
  pendingSignoffs: () => rpc<PendingSignoff[]>('institution_pending_signoffs'),
  signWeights: (version: string, hash: string, locale: 'ar' | 'en') => rpc<string>('sign_weights', { p_version: version, p_data_hash: hash, p_locale: locale }),
  collections: () => rpc<Collection[]>('institution_collections'),
  // driver
  availableRoutes: () => rpc<RouteCard[]>('driver_available_routes'),
  vehicles: () => table<Vehicle>('vehicles', (q) => q.order('created_at')),
  applyToRoute: (route: string, vehicle: string) => rpc<{ status: string; reasons: string[] }>('apply_to_route', { p_route: route, p_vehicle: vehicle }),
  myRoutes: () => rpc<MyRoute[]>('driver_my_routes'),
  routeStops: (route: string) => rpc<DriverStop[]>('driver_route_stops', { p_route: route }),
  startRoute: (route: string) => rpc<null>('start_route', { p_route: route }),
  arriveStop: (stop: string) => rpc<null>('arrive_stop', { p_stop: stop }),
  recordWeights: (stop: string, eventId: string, lines: WeighLineInput[], reason: string | null) =>
    rpc<{ version_id: string; version: number }>('record_weights', { p_stop: stop, p_client_event_id: eventId, p_occurred_at: new Date().toISOString(), p_lines: lines, p_correction_reason: reason }),
  completeStop: (stop: string) => rpc<{ route_status: string; next_stop_id: string | null; next_is_station: boolean }>('complete_stop', { p_stop: stop }),
  stopException: (stop: string, kind: string, note: string) => rpc<{ route_status: string }>('report_stop_exception', { p_stop: stop, p_kind: kind, p_note: note }),
  arriveStation: (route: string) => rpc<null>('arrive_station', { p_route: route }),
  // station
  stationRoutes: () => rpc<StationRoute[]>('station_routes'),
  submitReceipt: (route: string, eventId: string, lines: { material_id: string; net_g: number; accepted_g: number; rejected_g: number; reject_reason: string | null }[]) =>
    rpc<ReceiptResult>('submit_station_receipt', { p_route: route, p_client_event_id: eventId, p_lines: lines }),
  confirmReviewed: (receipt: string) => rpc<null>('confirm_reviewed_receipt', { p_receipt: receipt }),
  // lamma operations
  reviewQueue: () => rpc<ReviewQueue>('admin_review_queue'),
  review: (entity: string, id: string, decision: 'approved' | 'rejected', reason: string | null) => rpc<null>('admin_review', { p_entity: entity, p_id: id, p_decision: decision, p_reason: reason }),
  overview: () => rpc<Overview>('admin_overview'),
  resolveCase: (id: string, outcome: 'accept_receipt' | 'reweigh', note: string) => rpc<null>('resolve_case', { p_case: id, p_outcome: outcome, p_note: note }),
  // configuration (lamma operations)
  allAreas: () => table<Area>('service_areas', (q) => q.order('code')),
  allMaterials: () => table<Material>('material_types', (q) => q.order('code')),
  upsertArea: (a: { id: string | null; code: string; name_ar: string; name_en: string; city: string; active: boolean }) =>
    rpc<string>('admin_upsert_area', { p_id: a.id, p_code: a.code, p_name_ar: a.name_ar, p_name_en: a.name_en, p_city: a.city, p_active: a.active }),
  upsertMaterial: (m: { id: string | null; code: string; name_ar: string; name_en: string; density: number | null; source: string | null; active: boolean }) =>
    rpc<string>('admin_upsert_material', { p_id: m.id, p_code: m.code, p_name_ar: m.name_ar, p_name_en: m.name_en, p_density_g_per_l: m.density, p_density_source: m.source, p_active: m.active }),
  thresholds: (area: string) => table<Threshold>('collection_thresholds', (q) => q.eq('service_area_id', area)),
  setThreshold: (area: string, material: string, minG: number) => rpc<null>('admin_set_threshold', { p_area: area, p_material: material, p_min_g: minG }),
  areaPolicy: (area: string) => table<AreaPolicy>('area_policies', (q) => q.eq('service_area_id', area)),
  setAreaPolicy: (area: string, policy: Record<string, unknown>) => rpc<null>('admin_set_area_policy', { p_area: area, p_policy: policy }),
  requiredDocuments: () => table<{ kind: string }>('required_driver_documents', (q) => q.order('kind')),
  setRequiredDocument: (kind: string, required: boolean) => rpc<null>('admin_set_required_document', { p_kind: kind, p_required: required }),
  // driver equipment
  addVehicle: (v: { type: string; plate: string; capacityG: number; capacityL: number }) =>
    rpc<string>('add_vehicle', { p_type: v.type, p_plate: v.plate, p_capacity_g: v.capacityG, p_capacity_l: v.capacityL }),
  driverDocuments: () => table<DriverDocument>('driver_documents', (q) => q.order('created_at')),
  addDriverDocument: (kind: string, expires: string | null, path: string | null) => rpc<string>('add_driver_document', { p_kind: kind, p_file_path: path, p_expires_on: expires }),
  driverScales: () => table<DriverScale>('driver_scales', (q) => q.order('created_at')),
  addDriverScale: (sc: { identifier: string; type: string | null; capacityG: number; precisionG: number; validUntil: string | null; path: string | null }) =>
    rpc<string>('add_driver_scale', { p_identifier: sc.identifier, p_type: sc.type, p_capacity_g: sc.capacityG, p_precision_g: sc.precisionG, p_check_valid_until: sc.validUntil, p_evidence_path: sc.path }),
  // station materials and prices
  stationMaterials: (station: string) => table<StationMaterial>('station_materials', (q) => q.eq('station_id', station)),
  setStationMaterial: (station: string, material: string, accepted: boolean, conditions: string | null) =>
    rpc<null>('station_set_material', { p_station: station, p_material: material, p_accepted: accepted, p_conditions: conditions }),
  stationPrices: (station: string) => table<PriceVersion>('price_versions', (q) => q.eq('station_id', station).is('valid_to', null)),
  setStationPrice: (station: string, material: string, filsPerKg: number) =>
    rpc<string>('station_set_price', { p_station: station, p_material: material, p_price_fils_per_kg: filsPerKg }),
  assignRoute: (route: string) => rpc<string | null>('assign_route', { p_route: route, p_ignore_window: true }),
};
