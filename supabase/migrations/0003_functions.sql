-- Business RPCs. Every state transition is validated here, on the server, from auth.uid().
-- Error messages start with a stable code (before ':') that the app translates.

create or replace function app.fail(p_code text, p_detail text default '') returns void
language plpgsql as $$ begin raise exception '%: %', p_code, p_detail using errcode = 'P0001'; end $$;

create or replace function app.notify(p_org uuid, p_user uuid, p_kind text, p_payload jsonb, p_key text)
returns void language sql security definer set search_path = '' as $$
  insert into public.notifications(org_id, user_id, kind, payload, dedupe_key)
  values (p_org, p_user, p_kind, p_payload, p_key) on conflict (dedupe_key) do nothing;
$$;

create or replace function app.point(p_lat double precision, p_lng double precision) returns geography
language sql immutable set search_path = '' as $$
  select case when p_lat is null or p_lng is null then null
              else public.st_setsrid(public.st_makepoint(p_lng, p_lat), 4326)::public.geography end;
$$;

-- ======================= registration (requests only; nothing is auto-approved) =======================
create or replace function public.register_institution(
  p_name text, p_institution_type text, p_branch_name text, p_service_area uuid,
  p_address text, p_lat double precision, p_lng double precision)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_org uuid;
begin
  if auth.uid() is null then perform app.fail('not_authenticated'); end if;
  insert into public.organizations(kind, name, institution_type, created_by)
  values ('institution', p_name, p_institution_type, auth.uid()) returning id into v_org;
  insert into public.memberships(user_id, org_id, role, status) values (auth.uid(), v_org, 'org_owner', 'approved');
  insert into public.branches(org_id, service_area_id, name, address, location)
  values (v_org, p_service_area, p_branch_name, p_address, app.point(p_lat, p_lng));
  perform app.audit('register_institution', 'organization', v_org);
  return v_org;
end $$;

create or replace function public.register_station(
  p_name text, p_service_area uuid, p_address text, p_lat double precision, p_lng double precision,
  p_license_authority text, p_license_number text, p_license_expires_on date)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_org uuid; v_station uuid;
begin
  if auth.uid() is null then perform app.fail('not_authenticated'); end if;
  insert into public.organizations(kind, name, created_by) values ('station', p_name, auth.uid()) returning id into v_org;
  insert into public.memberships(user_id, org_id, role, status) values (auth.uid(), v_org, 'station_manager', 'approved');
  insert into public.stations(org_id, service_area_id, address, location, license_authority, license_number, license_expires_on)
  values (v_org, p_service_area, p_address, app.point(p_lat, p_lng), p_license_authority, p_license_number, p_license_expires_on)
  returning id into v_station;
  perform app.audit('register_station', 'station', v_station);
  return v_station;
end $$;

create or replace function public.register_driver(p_areas uuid[])
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then perform app.fail('not_authenticated'); end if;
  insert into public.drivers(id) values (auth.uid()) on conflict (id) do nothing;
  insert into public.driver_areas(driver_id, service_area_id)
  select auth.uid(), a from unnest(p_areas) a on conflict do nothing;
  perform app.audit('register_driver', 'driver', auth.uid());
end $$;

create or replace function public.add_vehicle(p_type text, p_plate text, p_capacity_g integer, p_capacity_l integer)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v uuid;
begin
  if not exists (select 1 from public.drivers where id = auth.uid()) then perform app.fail('not_a_driver'); end if;
  insert into public.vehicles(driver_id, vehicle_type, plate, capacity_g, capacity_l)
  values (auth.uid(), p_type, p_plate, p_capacity_g, p_capacity_l) returning id into v;
  return v;
end $$;

create or replace function public.add_driver_document(p_kind text, p_file_path text, p_expires_on date)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v uuid;
begin
  if not exists (select 1 from public.drivers where id = auth.uid()) then perform app.fail('not_a_driver'); end if;
  insert into public.driver_documents(driver_id, kind, file_path, expires_on)
  values (auth.uid(), p_kind, p_file_path, p_expires_on) returning id into v;
  return v;
end $$;

create or replace function public.add_driver_scale(
  p_identifier text, p_type text, p_capacity_g integer, p_precision_g integer, p_check_valid_until date, p_evidence_path text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v uuid;
begin
  if not exists (select 1 from public.drivers where id = auth.uid()) then perform app.fail('not_a_driver'); end if;
  insert into public.driver_scales(driver_id, identifier, scale_type, capacity_g, precision_g, check_valid_until, check_evidence_path)
  values (auth.uid(), p_identifier, p_type, p_capacity_g, p_precision_g, p_check_valid_until, p_evidence_path) returning id into v;
  return v;
end $$;

-- ======================= Lamma operations: reviews & configuration =======================
create or replace function public.admin_review(p_entity text, p_id uuid, p_decision text, p_reason text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  if not app.is_lamma('lamma_ops') then perform app.fail('not_authorized'); end if;
  if p_decision not in ('approved','rejected','suspended') then perform app.fail('invalid_decision'); end if;
  if p_decision <> 'approved' and coalesce(trim(p_reason),'') = '' then perform app.fail('reason_required'); end if;
  case p_entity
    when 'organization' then
      update public.organizations set status = p_decision, status_reason = p_reason where id = p_id and kind <> 'lamma';
    when 'driver' then
      update public.drivers set status = p_decision, status_reason = p_reason where id = p_id;
    when 'vehicle' then
      if p_decision = 'suspended' then perform app.fail('invalid_decision'); end if;
      update public.vehicles set status = p_decision where id = p_id;
    when 'driver_document' then
      if p_decision = 'suspended' then perform app.fail('invalid_decision'); end if;
      update public.driver_documents set status = p_decision, reviewed_by = auth.uid() where id = p_id;
    when 'driver_scale' then
      if p_decision = 'suspended' then perform app.fail('invalid_decision'); end if;
      update public.driver_scales set status = p_decision where id = p_id;
    when 'station_license' then
      update public.stations set license_verified = (p_decision = 'approved'),
             license_verified_by = case when p_decision = 'approved' then auth.uid() end where id = p_id;
    when 'membership' then
      update public.memberships set status = case p_decision when 'approved' then 'approved' else 'revoked' end
      where id = p_id and role not like 'lamma_%' and role <> 'auditor';
    else perform app.fail('invalid_entity');
  end case;
  get diagnostics n = row_count;
  if n = 0 then perform app.fail('not_found'); end if;
  perform app.audit('review_' || p_entity, p_entity, p_id, jsonb_build_object('decision', p_decision, 'reason', p_reason));
end $$;

create or replace function public.admin_set_threshold(p_area uuid, p_material uuid, p_min_g integer)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not app.is_lamma('lamma_ops') then perform app.fail('not_authorized'); end if;
  insert into public.collection_thresholds(service_area_id, material_id, min_g, updated_by)
  values (p_area, p_material, p_min_g, auth.uid())
  on conflict (service_area_id, material_id) do update set min_g = excluded.min_g, updated_by = auth.uid(), updated_at = now();
  perform app.audit('set_threshold', 'service_area', p_area, jsonb_build_object('material', p_material, 'min_g', p_min_g));
end $$;

create or replace function public.admin_set_area_policy(p_area uuid, p_policy jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare v_has_tol boolean := (p_policy ? 'tolerance_g') or (p_policy ? 'tolerance_bps');
begin
  if not app.is_lamma('lamma_ops') then perform app.fail('not_authorized'); end if;
  insert into public.area_policies(service_area_id) values (p_area) on conflict do nothing;
  update public.area_policies set
    auto_publish = coalesce((p_policy->>'auto_publish')::boolean, auto_publish),
    auto_publish_paused_reason = case when p_policy ? 'auto_publish_paused_reason' then p_policy->>'auto_publish_paused_reason' else auto_publish_paused_reason end,
    base_pay_fils = case when p_policy ? 'base_pay_fils' then (p_policy->>'base_pay_fils')::bigint else base_pay_fils end,
    per_stop_pay_fils = case when p_policy ? 'per_stop_pay_fils' then (p_policy->>'per_stop_pay_fils')::bigint else per_stop_pay_fils end,
    per_km_pay_fils = case when p_policy ? 'per_km_pay_fils' then (p_policy->>'per_km_pay_fils')::bigint else per_km_pay_fils end,
    application_window_min = case when p_policy ? 'application_window_min' then (p_policy->>'application_window_min')::int else application_window_min end,
    early_start_min = case when p_policy ? 'early_start_min' then (p_policy->>'early_start_min')::int else early_start_min end,
    service_min_per_stop = case when p_policy ? 'service_min_per_stop' then (p_policy->>'service_min_per_stop')::int else service_min_per_stop end,
    unload_min = case when p_policy ? 'unload_min' then (p_policy->>'unload_min')::int else unload_min end,
    max_route_min = case when p_policy ? 'max_route_min' then (p_policy->>'max_route_min')::int else max_route_min end,
    max_stops = case when p_policy ? 'max_stops' then (p_policy->>'max_stops')::int else max_stops end,
    plan_capacity_g = case when p_policy ? 'plan_capacity_g' then (p_policy->>'plan_capacity_g')::int else plan_capacity_g end,
    plan_capacity_l = case when p_policy ? 'plan_capacity_l' then (p_policy->>'plan_capacity_l')::int else plan_capacity_l end,
    tolerance_g = case when p_policy ? 'tolerance_g' then (p_policy->>'tolerance_g')::int else tolerance_g end,
    tolerance_bps = case when p_policy ? 'tolerance_bps' then (p_policy->>'tolerance_bps')::int else tolerance_bps end,
    tolerance_approved_by = case when v_has_tol then auth.uid() else tolerance_approved_by end,
    updated_at = now()
  where service_area_id = p_area;
  if (select auto_publish = false and coalesce(trim(auto_publish_paused_reason),'') = '' from public.area_policies where service_area_id = p_area) then
    perform app.fail('reason_required', 'pausing auto publish needs a reason');
  end if;
  perform app.audit('set_area_policy', 'service_area', p_area, p_policy);
end $$;

-- ======================= station configuration =======================
create or replace function public.station_set_material(p_station uuid, p_material uuid, p_accepted boolean, p_conditions text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not app.is_station_member(p_station, 'station_manager') then perform app.fail('not_authorized'); end if;
  insert into public.station_materials(station_id, material_id, accepted, conditions)
  values (p_station, p_material, p_accepted, p_conditions)
  on conflict (station_id, material_id) do update set accepted = excluded.accepted, conditions = excluded.conditions;
  perform app.audit('station_set_material', 'station', p_station, jsonb_build_object('material', p_material, 'accepted', p_accepted));
end $$;

-- a new price is a new version; past receipts keep the price snapshot they were made with
create or replace function public.station_set_price(p_station uuid, p_material uuid, p_price_fils_per_kg bigint)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v uuid; v_now timestamptz := clock_timestamp();
begin
  if not app.is_station_member(p_station, 'station_manager', 'station_accountant') then perform app.fail('not_authorized'); end if;
  update public.price_versions set valid_to = v_now
  where station_id = p_station and material_id = p_material and valid_to is null and valid_from < v_now;
  insert into public.price_versions(station_id, material_id, price_fils_per_kg, valid_from, created_by)
  values (p_station, p_material, p_price_fils_per_kg, v_now, auth.uid()) returning id into v;
  perform app.audit('station_set_price', 'station', p_station, jsonb_build_object('material', p_material, 'price', p_price_fils_per_kg));
  return v;
end $$;

-- ======================= institution: pickup requests =======================
create or replace function public.submit_pickup_request(
  p_branch uuid, p_lines jsonb, p_window_start timestamptz default null, p_window_end timestamptz default null, p_notes text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_branch public.branches; v_req uuid;
begin
  select * into v_branch from public.branches where id = p_branch and active;
  if not found or not app.is_member(v_branch.org_id, 'org_owner', 'branch_manager', 'handover_staff') then
    perform app.fail('not_authorized');
  end if;
  if v_branch.service_area_id is null
     or not exists (select 1 from public.service_areas a where a.id = v_branch.service_area_id and a.active) then
    perform app.fail('out_of_coverage');
  end if;
  if v_branch.location is null then perform app.fail('branch_location_missing'); end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then perform app.fail('lines_required'); end if;
  if exists (select 1 from public.pickup_requests where branch_id = p_branch and status in ('submitted','scheduled','assigned')) then
    perform app.fail('open_request_exists');
  end if;
  insert into public.pickup_requests(branch_id, window_start, window_end, notes, created_by)
  values (p_branch, p_window_start, p_window_end, p_notes, auth.uid()) returning id into v_req;
  insert into public.request_materials(request_id, material_id, est_g, containers, fill_level)
  select v_req, (l->>'material_id')::uuid, (l->>'est_g')::int, (l->>'containers')::int, l->>'fill_level'
  from jsonb_array_elements(p_lines) l;
  if exists (select 1 from public.request_materials rm join public.material_types m on m.id = rm.material_id
             where rm.request_id = v_req and not m.active) then perform app.fail('material_not_accepted'); end if;
  perform app.audit('submit_pickup_request', 'pickup_request', v_req);
  return v_req;
end $$;

create or replace function public.cancel_pickup_request(p_request uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_org uuid; v_status text;
begin
  select b.org_id, r.status into v_org, v_status from public.pickup_requests r
  join public.branches b on b.id = r.branch_id where r.id = p_request for update of r;
  if not found or not app.is_member(v_org, 'org_owner', 'branch_manager') then perform app.fail('not_authorized'); end if;
  if v_status <> 'submitted' then perform app.fail('invalid_state', 'only a request that is not yet scheduled can be cancelled in the app'); end if;
  update public.pickup_requests set status = 'cancelled', updated_at = now() where id = p_request;
  perform app.audit('cancel_pickup_request', 'pickup_request', p_request, jsonb_build_object('reason', p_reason));
end $$;

-- ======================= planning =======================
-- Requests the planner may consider. "ready" = at least one material meets the area threshold.
-- Missing estimate or missing threshold => not ready (needs update), never assumed.
create or replace function public.planning_candidates(p_area uuid)
returns table (request_id uuid, branch_id uuid, lat double precision, lng double precision,
               est_g integer, est_l integer, ready boolean, needs_update boolean,
               window_start timestamptz, window_end timestamptz, materials uuid[], waiting_since timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not (app.is_service() or app.is_lamma('lamma_ops')) then perform app.fail('not_authorized'); end if;
  return query
  select r.id, b.id, public.st_y(b.location::public.geometry), public.st_x(b.location::public.geometry),
         sum(rm.est_g)::int,
         case when bool_and(m.bulk_density_g_per_l is not null and rm.est_g is not null)
              then ceil(sum(rm.est_g::numeric / m.bulk_density_g_per_l))::int end,
         coalesce(bool_or(rm.est_g >= t.min_g), false) and bool_and(rm.est_g is not null),
         bool_or(rm.est_g is null),
         r.window_start, r.window_end, array_agg(rm.material_id order by rm.material_id), r.created_at
  from public.pickup_requests r
  join public.branches b on b.id = r.branch_id
  join public.organizations o on o.id = b.org_id and o.status = 'approved'
  join public.request_materials rm on rm.request_id = r.id
  join public.material_types m on m.id = rm.material_id
  left join public.collection_thresholds t on t.service_area_id = b.service_area_id and t.material_id = rm.material_id
  where b.service_area_id = p_area and r.status = 'submitted' and b.active
    and not exists (select 1 from public.route_stops s where s.request_id = r.id and s.active)
  group by r.id, b.id;
end $$;

-- Atomically reserve requests and publish a route. Refuses to publish with missing pay policy,
-- unverified station, unaccepted material or missing price: no invented numbers.
create or replace function public.publish_route(p jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_area uuid := (p->>'service_area_id')::uuid;
  v_station uuid := (p->>'station_id')::uuid;
  v_starts timestamptz := (p->>'starts_at')::timestamptz;
  v_pol public.area_policies; v_route uuid; v_n int; v_locked int; v_est_g int; v_est_l int;
  v_req_g int; v_pay bigint; v_dist int := (p->>'distance_m')::int; v_code text;
begin
  if not (app.is_service() or app.is_lamma('lamma_ops')) then perform app.fail('not_authorized'); end if;
  select * into v_pol from public.area_policies where service_area_id = v_area;
  if not found or v_pol.base_pay_fils is null or v_pol.application_window_min is null then
    perform app.fail('pay_policy_missing');
  end if;
  if app.is_service() and not v_pol.auto_publish then perform app.fail('auto_publish_paused'); end if;
  if not exists (select 1 from public.service_areas where id = v_area and active) then perform app.fail('area_inactive'); end if;
  if not exists (select 1 from public.stations s join public.organizations o on o.id = s.org_id
                 where s.id = v_station and o.status = 'approved' and s.license_verified
                   and (s.license_expires_on is null or s.license_expires_on >= (v_starts at time zone 'Asia/Amman')::date)) then
    perform app.fail('station_not_approved');
  end if;

  v_n := jsonb_array_length(p->'stops');
  if v_n is null or v_n = 0 then perform app.fail('stops_required'); end if;
  if v_pol.max_stops is not null and v_n > v_pol.max_stops then perform app.fail('too_many_stops'); end if;

  -- lock the requests in a stable order; all must still be free
  select count(*) into v_locked from (
    select r.id from public.pickup_requests r
    join public.branches b on b.id = r.branch_id
    where r.id in (select (s->>'request_id')::uuid from jsonb_array_elements(p->'stops') s)
      and r.status = 'submitted' and b.service_area_id = v_area
    order by r.id for update of r) q;
  if v_locked <> v_n then perform app.fail('request_not_available'); end if;

  if exists (select 1 from public.request_materials rm
             where rm.request_id in (select (s->>'request_id')::uuid from jsonb_array_elements(p->'stops') s)
               and rm.est_g is null) then perform app.fail('estimate_missing'); end if;
  if exists (select 1 from public.request_materials rm
             where rm.request_id in (select (s->>'request_id')::uuid from jsonb_array_elements(p->'stops') s)
               and not exists (select 1 from public.station_materials sm
                               where sm.station_id = v_station and sm.material_id = rm.material_id and sm.accepted)) then
    perform app.fail('station_does_not_accept_material');
  end if;
  if exists (select 1 from public.request_materials rm
             where rm.request_id in (select (s->>'request_id')::uuid from jsonb_array_elements(p->'stops') s)
               and not exists (select 1 from public.price_versions pv
                               where pv.station_id = v_station and pv.material_id = rm.material_id
                                 and pv.valid_from <= now() and (pv.valid_to is null or pv.valid_to > now()))) then
    perform app.fail('price_missing');
  end if;

  select sum(rm.est_g)::int,
         case when bool_and(m.bulk_density_g_per_l is not null) then ceil(sum(rm.est_g::numeric / m.bulk_density_g_per_l))::int end
    into v_est_g, v_est_l
  from public.request_materials rm join public.material_types m on m.id = rm.material_id
  where rm.request_id in (select (s->>'request_id')::uuid from jsonb_array_elements(p->'stops') s);

  v_req_g := coalesce((p->>'required_capacity_g')::int, v_est_g);
  if v_req_g < v_est_g then perform app.fail('capacity_below_estimate'); end if;
  v_pay := v_pol.base_pay_fils + coalesce(v_pol.per_stop_pay_fils, 0) * v_n
         + round(coalesce(v_pol.per_km_pay_fils, 0) * v_dist / 1000.0)::bigint;
  v_code := 'LM-' || to_char(v_starts at time zone 'Asia/Amman', 'YYMMDD') || '-' || lpad(nextval('public.route_code_seq')::text, 4, '0');

  insert into public.routes(code, service_area_id, station_id, starts_at, expected_duration_min, distance_m,
      distance_is_estimate, est_total_g, est_total_l, required_capacity_g, required_capacity_l, pay_fils, pay_terms,
      assign_after, planner_version)
  values (v_code, v_area, v_station, v_starts, (p->>'expected_duration_min')::int, v_dist,
      coalesce((p->>'distance_is_estimate')::boolean, true), v_est_g, v_est_l, v_req_g,
      coalesce((p->>'required_capacity_l')::int, v_est_l), v_pay, 'route_fee',
      now() + make_interval(mins => v_pol.application_window_min), coalesce(p->>'planner_version', 'manual'))
  returning id into v_route;

  insert into public.route_stops(route_id, seq, branch_id, request_id)
  select v_route, (s->>'seq')::int, r.branch_id, r.id
  from jsonb_array_elements(p->'stops') s join public.pickup_requests r on r.id = (s->>'request_id')::uuid;

  insert into public.route_prices(route_id, material_id, price_fils_per_kg, price_version_id)
  select v_route, pv.material_id, pv.price_fils_per_kg, pv.id
  from public.price_versions pv
  join public.station_materials sm on sm.station_id = pv.station_id and sm.material_id = pv.material_id and sm.accepted
  where pv.station_id = v_station and pv.valid_from <= now() and (pv.valid_to is null or pv.valid_to > now());

  update public.pickup_requests set status = 'scheduled', updated_at = now()
  where id in (select request_id from public.route_stops where route_id = v_route);
  perform app.audit('publish_route', 'route', v_route, jsonb_build_object('stops', v_n, 'by_service', app.is_service()));
  return v_route;
end $$;

-- The 8 mandatory card fields, with no institution identity before assignment.
create or replace function public.driver_available_routes()
returns table (route_id uuid, code text, est_total_g integer, required_capacity_g integer, required_capacity_l integer,
               stops_count integer, station_name text, starts_at timestamptz, distance_m integer, distance_is_estimate boolean,
               area_name_ar text, area_name_en text, expected_duration_min integer, pay_fils bigint,
               my_application_status text, my_application_reasons text[])
language sql stable security definer set search_path = '' as $$
  select r.id, r.code, r.est_total_g, r.required_capacity_g, r.required_capacity_l,
         (select count(*)::int from public.route_stops s where s.route_id = r.id and s.active),
         o.name, r.starts_at, r.distance_m, r.distance_is_estimate, a.name_ar, a.name_en,
         r.expected_duration_min, r.pay_fils, ap.status, ap.reasons
  from public.routes r
  join public.service_areas a on a.id = r.service_area_id
  join public.stations st on st.id = r.station_id
  join public.organizations o on o.id = st.org_id
  left join public.route_applications ap on ap.route_id = r.id and ap.driver_id = auth.uid()
  where r.status = 'published' and app.is_approved_driver()
    and exists (select 1 from public.driver_areas da where da.driver_id = auth.uid() and da.service_area_id = r.service_area_id)
  order by r.starts_at;
$$;

-- ======================= driver: apply (eligibility) =======================
create or replace function public.apply_to_route(p_route uuid, p_vehicle uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_route public.routes; v_app uuid; v_reasons text[] := '{}'; v_checks jsonb; v_scale uuid;
  v_day date; v_period tstzrange; v_driver_ok boolean; v_vehicle public.vehicles; v_status text;
begin
  if auth.uid() is null then perform app.fail('not_authenticated'); end if;
  select * into v_route from public.routes where id = p_route;
  if not found or v_route.status <> 'published' then perform app.fail('route_not_open'); end if;
  if exists (select 1 from public.route_applications where route_id = p_route and driver_id = auth.uid()) then
    perform app.fail('already_applied');
  end if;
  v_day := (v_route.starts_at at time zone 'Asia/Amman')::date;
  v_period := tstzrange(v_route.starts_at, v_route.starts_at + make_interval(mins => v_route.expected_duration_min));

  select exists (select 1 from public.drivers where id = auth.uid() and status = 'approved') into v_driver_ok;
  if not v_driver_ok then v_reasons := array_append(v_reasons, 'driver_not_approved'); end if;
  if not exists (select 1 from public.driver_areas where driver_id = auth.uid() and service_area_id = v_route.service_area_id) then
    v_reasons := array_append(v_reasons, 'outside_service_area');
  end if;
  if exists (select 1 from public.required_driver_documents rd
             where not exists (select 1 from public.driver_documents d
                               where d.driver_id = auth.uid() and d.kind = rd.kind and d.status = 'approved'
                                 and (d.expires_on is null or d.expires_on >= v_day))) then
    v_reasons := array_append(v_reasons, 'document_missing_or_expired');
  end if;
  select * into v_vehicle from public.vehicles where id = p_vehicle and driver_id = auth.uid();
  if not found then perform app.fail('vehicle_not_found'); end if;
  if v_vehicle.status <> 'approved' then v_reasons := array_append(v_reasons, 'vehicle_not_approved'); end if;
  if v_vehicle.capacity_g < v_route.required_capacity_g then v_reasons := array_append(v_reasons, 'vehicle_weight_capacity_too_small'); end if;
  if v_route.required_capacity_l is not null and v_vehicle.capacity_l < v_route.required_capacity_l then
    v_reasons := array_append(v_reasons, 'vehicle_volume_capacity_too_small');
  end if;
  select s.id into v_scale from public.driver_scales s
  where s.driver_id = auth.uid() and s.status = 'approved'
    and s.check_valid_until is not null and s.check_valid_until >= v_day
  order by s.capacity_g desc limit 1;
  if v_scale is null then v_reasons := array_append(v_reasons, 'no_valid_scale'); end if;
  if exists (select 1 from public.assignments a where a.driver_id = auth.uid() and a.active and a.period && v_period) then
    v_reasons := array_append(v_reasons, 'overlapping_route');
  end if;

  v_status := case when cardinality(v_reasons) = 0 then 'eligible_pending_assignment' else 'ineligible' end;
  v_checks := jsonb_build_object('reasons', v_reasons, 'route_version', v_route.version,
     'vehicle_capacity_g', v_vehicle.capacity_g, 'vehicle_capacity_l', v_vehicle.capacity_l,
     'required_capacity_g', v_route.required_capacity_g, 'required_capacity_l', v_route.required_capacity_l,
     'scale_id', v_scale, 'route_day', v_day);
  insert into public.route_applications(route_id, driver_id, vehicle_id, scale_id, status, reasons, decided_at)
  values (p_route, auth.uid(), p_vehicle, v_scale, v_status, v_reasons, case when v_status = 'ineligible' then now() end)
  returning id into v_app;
  insert into public.eligibility_evaluations(application_id, policy_version, passed, checks)
  values (v_app, 'eligibility-v1', v_status <> 'ineligible', v_checks);
  perform app.audit('apply_to_route', 'route_application', v_app, jsonb_build_object('status', v_status));
  return jsonb_build_object('application_id', v_app, 'status', v_status, 'reasons', to_jsonb(v_reasons));
end $$;

create or replace function public.withdraw_application(p_application uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.route_applications set status = 'withdrawn', decided_at = now()
  where id = p_application and driver_id = auth.uid() and status in ('submitted','eligible_pending_assignment');
  if not found then perform app.fail('invalid_state'); end if;
end $$;

-- ======================= assignment (atomic, one driver per route, no overlaps) =======================
-- Declared rule (assignment-v1): among eligible applicants pick the driver with the fewest routes in the
-- last 30 days (fair distribution), then the earliest application, then the application id.
create or replace function public.assign_route(p_route uuid, p_ignore_window boolean default false)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_route public.routes; v_cand record; v_assignment uuid; v_period tstzrange;
begin
  if not (app.is_service() or app.is_lamma('lamma_ops')) then perform app.fail('not_authorized'); end if;
  select * into v_route from public.routes where id = p_route for update;
  if not found then perform app.fail('not_found'); end if;
  if v_route.status <> 'published' then return null; end if;      -- already assigned / closed: idempotent no-op
  if now() < v_route.assign_after and not (p_ignore_window and app.is_lamma('lamma_ops')) then
    perform app.fail('application_window_open');
  end if;
  v_period := tstzrange(v_route.starts_at, v_route.starts_at + make_interval(mins => v_route.expected_duration_min));

  for v_cand in
    select ap.*, (select count(*) from public.assignments a
                  where a.driver_id = ap.driver_id and a.created_at > now() - interval '30 days') as recent
    from public.route_applications ap
    where ap.route_id = p_route and ap.status = 'eligible_pending_assignment'
    order by recent, ap.applied_at, ap.id
  loop
    -- re-validate what may have changed since the application
    if not exists (select 1 from public.drivers where id = v_cand.driver_id and status = 'approved')
       or not exists (select 1 from public.vehicles where id = v_cand.vehicle_id and status = 'approved')
       or not exists (select 1 from public.driver_scales where id = v_cand.scale_id and status = 'approved') then
      update public.route_applications set status = 'ineligible', reasons = array_append(reasons, 'no_longer_eligible'), decided_at = now()
      where id = v_cand.id;
      continue;
    end if;
    begin
      insert into public.assignments(route_id, driver_id, vehicle_id, scale_id, application_id, period)
      values (p_route, v_cand.driver_id, v_cand.vehicle_id, v_cand.scale_id, v_cand.id, v_period)
      returning id into v_assignment;
    exception when exclusion_violation then
      update public.route_applications set status = 'ineligible', reasons = array_append(reasons, 'overlapping_route'), decided_at = now()
      where id = v_cand.id;
      continue;
    end;
    update public.route_applications set status = 'selected', decided_at = now() where id = v_cand.id;
    update public.route_applications set status = 'not_selected', decided_at = now()
    where route_id = p_route and status = 'eligible_pending_assignment';
    update public.routes set status = 'assigned' where id = p_route;
    update public.pickup_requests set status = 'assigned', updated_at = now()
    where id in (select request_id from public.route_stops where route_id = p_route and active);
    perform app.notify(null, v_cand.driver_id, 'route_assigned', jsonb_build_object('route_id', p_route, 'code', v_route.code),
                       'route_assigned:' || p_route || ':' || v_cand.driver_id);
    perform app.notify(null, ap.driver_id, 'route_not_selected', jsonb_build_object('route_id', p_route, 'code', v_route.code),
                       'route_not_selected:' || p_route || ':' || ap.driver_id)
    from public.route_applications ap where ap.route_id = p_route and ap.status = 'not_selected';
    perform app.audit('assign_route', 'route', p_route,
      jsonb_build_object('driver', v_cand.driver_id, 'policy', 'assignment-v1', 'recent_routes', v_cand.recent));
    return v_assignment;
  end loop;
  return null;   -- nobody eligible yet: route stays published
end $$;

create or replace function public.assign_due_routes()
returns integer language plpgsql security definer set search_path = '' as $$
declare r record; n integer := 0;
begin
  if not app.is_service() then perform app.fail('not_authorized'); end if;
  for r in select id from public.routes where status = 'published' and assign_after <= now() order by starts_at loop
    if public.assign_route(r.id) is not null then n := n + 1; end if;
  end loop;
  return n;
end $$;

-- ======================= driver: run the route =======================
create or replace function app.route_for_driver(p_route uuid, p_expected text[])
returns public.routes language plpgsql security definer set search_path = '' as $$
declare v public.routes;
begin
  select * into v from public.routes where id = p_route for update;
  if not found or not app.is_assigned_driver(p_route) then perform app.fail('not_authorized'); end if;
  if not (v.status = any(p_expected)) then perform app.fail('invalid_state', 'route is ' || v.status); end if;
  return v;
end $$;

create or replace function public.start_route(p_route uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v public.routes; v_early int;
begin
  v := app.route_for_driver(p_route, array['assigned']);
  select coalesce(early_start_min, 0) into v_early from public.area_policies where service_area_id = v.service_area_id;
  if now() < v.starts_at - make_interval(mins => coalesce(v_early, 0)) then perform app.fail('too_early'); end if;
  update public.routes set status = 'in_progress', started_at = now() where id = p_route;
  perform app.audit('start_route', 'route', p_route);
end $$;

create or replace function public.arrive_stop(p_stop uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_stop public.route_stops; v_route public.routes;
begin
  select * into v_stop from public.route_stops where id = p_stop;
  if not found then perform app.fail('not_authorized'); end if;
  v_route := app.route_for_driver(v_stop.route_id, array['in_progress']);
  if v_stop.status = 'arrived' then return; end if;
  if v_stop.status <> 'pending' then perform app.fail('invalid_state'); end if;
  if exists (select 1 from public.route_stops s where s.route_id = v_stop.route_id and s.seq < v_stop.seq
             and s.status in ('pending','arrived')) then perform app.fail('previous_stop_open'); end if;
  update public.route_stops set status = 'arrived', arrived_at = now() where id = p_stop;
end $$;

create or replace function app.weigh_hash(p_stop uuid, p_version int, p_lines jsonb)
returns text language sql immutable set search_path = '' as $$
  select encode(sha256(convert_to(p_stop::text || '|' || p_version || '|' || coalesce((
    select string_agg(concat_ws(':', l->>'material_id', l->>'method', coalesce(l->>'gross_g',''), coalesce(l->>'tare_g',''), l->>'net_g'), ';'
                      order by l->>'material_id')
    from jsonb_array_elements(p_lines) l), ''), 'UTF8')), 'hex');
$$;

-- Field weighing with the driver's scale. Every call creates a NEW immutable version; an earlier
-- version (even a signed one) becomes "superseded" and the new one needs a fresh signature.
create or replace function public.record_weights(
  p_stop uuid, p_client_event_id uuid, p_occurred_at timestamptz, p_lines jsonb,
  p_correction_reason text default null, p_lat double precision default null,
  p_lng double precision default null, p_accuracy_m real default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_stop public.route_stops; v_route public.routes; v_asg public.assignments; v_scale public.driver_scales;
  v_existing public.weigh_versions; v_ver int; v_id uuid; v_hash text; l jsonb; v_net int;
begin
  select * into v_existing from public.weigh_versions where client_event_id = p_client_event_id;
  if found then   -- idempotent retry (offline sync / double tap)
    if v_existing.recorded_by <> auth.uid() then perform app.fail('not_authorized'); end if;
    return jsonb_build_object('version_id', v_existing.id, 'version', v_existing.version, 'data_hash', v_existing.data_hash, 'duplicate', true);
  end if;
  select * into v_stop from public.route_stops where id = p_stop for update;
  if not found then perform app.fail('not_authorized'); end if;
  v_route := app.route_for_driver(v_stop.route_id, array['in_progress']);
  if v_stop.status <> 'arrived' then perform app.fail('invalid_state', 'stop is ' || v_stop.status); end if;
  select * into v_asg from public.assignments where route_id = v_route.id and active;
  select * into v_scale from public.driver_scales where id = v_asg.scale_id;
  if v_scale.status <> 'approved' then perform app.fail('no_valid_scale'); end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then perform app.fail('lines_required'); end if;

  select coalesce(max(version), 0) + 1 into v_ver from public.weigh_versions where stop_id = p_stop;
  if v_ver > 1 and coalesce(trim(p_correction_reason), '') = '' then perform app.fail('reason_required'); end if;
  update public.weigh_versions set status = 'superseded' where stop_id = p_stop and status <> 'superseded';

  v_hash := app.weigh_hash(p_stop, v_ver, p_lines);
  insert into public.weigh_versions(stop_id, version, client_event_id, recorded_by, scale_id, occurred_at, lat, lng, accuracy_m, correction_reason, data_hash)
  values (p_stop, v_ver, p_client_event_id, auth.uid(), v_scale.id, p_occurred_at, p_lat, p_lng, p_accuracy_m, p_correction_reason, v_hash)
  returning id into v_id;
  for l in select * from jsonb_array_elements(p_lines) loop
    v_net := (l->>'net_g')::int;
    if v_net is null or v_net <= 0 then perform app.fail('invalid_weight'); end if;
    if coalesce((l->>'gross_g')::int, v_net) > v_scale.capacity_g then perform app.fail('exceeds_scale_capacity'); end if;
    if not exists (select 1 from public.route_prices rp where rp.route_id = v_route.id and rp.material_id = (l->>'material_id')::uuid) then
      perform app.fail('material_not_accepted');
    end if;
    insert into public.weigh_lines(version_id, material_id, method, gross_g, tare_g, net_g)
    values (v_id, (l->>'material_id')::uuid, l->>'method', (l->>'gross_g')::int, (l->>'tare_g')::int, v_net);
  end loop;
  perform app.notify(b.org_id, null, 'weights_awaiting_signature',
      jsonb_build_object('stop_id', p_stop, 'version_id', v_id, 'route_code', v_route.code), 'sign:' || v_id)
  from public.branches b where b.id = v_stop.branch_id;
  perform app.audit('record_weights', 'weigh_version', v_id, jsonb_build_object('version', v_ver));
  return jsonb_build_object('version_id', v_id, 'version', v_ver, 'data_hash', v_hash, 'duplicate', false);
end $$;

-- Sign-off by the establishment owner / registered delegate, on THEIR account, bound to the exact
-- data version shown to them (hash). The driver can never sign for the institution.
create or replace function public.sign_weights(p_version uuid, p_data_hash text, p_signature_path text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_ver public.weigh_versions; v_org uuid; v_role text; v_id uuid;
  c_statement constant text := 'أؤكد بصفتي صاحب المنشأة أو المفوّض المعتمد أن أوزان المواد المسلّمة المعروضة أمامي صحيحة.';
begin
  select * into v_ver from public.weigh_versions where id = p_version for update;
  if not found then perform app.fail('not_authorized'); end if;
  select b.org_id into v_org from public.route_stops s join public.branches b on b.id = s.branch_id where s.id = v_ver.stop_id;
  select m.role into v_role from public.memberships m
  join public.organizations o on o.id = m.org_id and o.status = 'approved'
  where m.user_id = auth.uid() and m.org_id = v_org and m.status = 'approved'
    and m.role in ('org_owner','branch_manager','handover_staff') limit 1;
  if v_role is null or auth.uid() = v_ver.recorded_by then perform app.fail('not_authorized'); end if;
  if v_ver.status = 'superseded' then perform app.fail('stale_version', 'weights were updated; review the new version'); end if;
  if v_ver.status = 'signed' then perform app.fail('already_signed'); end if;
  if p_data_hash is distinct from v_ver.data_hash then perform app.fail('stale_version', 'signed data does not match the current version'); end if;
  insert into public.collection_signoffs(weigh_version_id, signer_user_id, signer_org_id, signer_role, statement_version, statement_text, data_hash, signature_path)
  values (p_version, auth.uid(), v_org, v_role, 'signoff-v1', c_statement, v_ver.data_hash, p_signature_path) returning id into v_id;
  update public.weigh_versions set status = 'signed' where id = p_version;
  perform app.audit('sign_weights', 'weigh_version', p_version);
  return v_id;
end $$;

create or replace function app.after_stop_closed(p_route uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare v_route public.routes; v_collected int; v_case uuid;
begin
  select * into v_route from public.routes where id = p_route;
  if exists (select 1 from public.route_stops where route_id = p_route and status in ('pending','arrived')) then
    return v_route.status;
  end if;
  select count(*) into v_collected from public.route_stops where route_id = p_route and status = 'collected';
  if v_collected = 0 then
    update public.routes set status = 'needs_review' where id = p_route;
    insert into public.reconciliation_cases(route_id, reasons) values (p_route, array['no_collections']);
    return 'needs_review';
  end if;
  update public.routes set status = 'en_route_to_station' where id = p_route;
  -- "shipment on the way": logically once (dedupe key); lives in the in-app inbox even if push fails
  perform app.notify(s.org_id, null, 'shipment_on_the_way', jsonb_build_object('route_id', p_route, 'code', v_route.code),
                     'shipment:' || p_route)
  from public.stations s where s.id = v_route.station_id;
  return 'en_route_to_station';
end $$;

create or replace function public.complete_stop(p_stop uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_stop public.route_stops; v_route public.routes; v_status text; v_next uuid;
begin
  select * into v_stop from public.route_stops where id = p_stop for update;
  if not found then perform app.fail('not_authorized'); end if;
  if v_stop.status = 'collected' and app.is_assigned_driver(v_stop.route_id) then
    select status into v_status from public.routes where id = v_stop.route_id;
  else
    v_route := app.route_for_driver(v_stop.route_id, array['in_progress']);
    if v_stop.status <> 'arrived' then perform app.fail('invalid_state'); end if;
    if not exists (select 1 from public.weigh_versions v join public.collection_signoffs so on so.weigh_version_id = v.id
                   where v.stop_id = p_stop and v.status = 'signed' and so.data_hash = v.data_hash) then
      perform app.fail('signature_required', 'the current weights are not signed by the establishment');
    end if;
    update public.route_stops set status = 'collected', completed_at = now() where id = p_stop;
    update public.pickup_requests set status = 'collected', updated_at = now() where id = v_stop.request_id;
    v_status := app.after_stop_closed(v_stop.route_id);
  end if;
  select id into v_next from public.route_stops where route_id = v_stop.route_id and status in ('pending','arrived') order by seq limit 1;
  return jsonb_build_object('route_status', v_status, 'next_stop_id', v_next, 'next_is_station', v_next is null);
end $$;

create or replace function public.report_stop_exception(p_stop uuid, p_kind text, p_note text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_stop public.route_stops; v_route public.routes; v_status text;
begin
  if p_kind not in ('closed','no_materials','contaminated','prohibited','no_access','delegate_absent',
                    'signature_refused','scale_failure','over_capacity','other') then perform app.fail('invalid_kind'); end if;
  select * into v_stop from public.route_stops where id = p_stop for update;
  if not found then perform app.fail('not_authorized'); end if;
  v_route := app.route_for_driver(v_stop.route_id, array['in_progress']);
  if v_stop.status not in ('pending','arrived') then perform app.fail('invalid_state'); end if;
  update public.weigh_versions set status = 'superseded' where stop_id = p_stop and status = 'awaiting_signature';
  update public.route_stops set status = 'exception', exception_kind = p_kind, exception_note = p_note,
         active = false, completed_at = now() where id = p_stop;
  update public.pickup_requests set status = 'needs_reschedule', updated_at = now() where id = v_stop.request_id;
  perform app.notify(o.id, null, 'stop_exception', jsonb_build_object('stop_id', p_stop, 'kind', p_kind, 'code', v_route.code), 'stop_exception:' || p_stop)
  from public.organizations o where o.kind = 'lamma';
  perform app.audit('stop_exception', 'route_stop', p_stop, jsonb_build_object('kind', p_kind, 'note', p_note));
  v_status := app.after_stop_closed(v_stop.route_id);
  return jsonb_build_object('route_status', v_status);
end $$;

-- The driver can only say "I arrived". There is no driver action that completes a route.
create or replace function public.arrive_station(p_route uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform app.route_for_driver(p_route, array['en_route_to_station']);
  update public.routes set status = 'awaiting_station_receipt' where id = p_route;
  perform app.audit('arrive_station', 'route', p_route);
end $$;

-- ======================= station: shipment view, receipt, confirmation =======================
create or replace function app.signed_totals(p_route uuid)
returns table (material_id uuid, signed_g integer) language sql stable security definer set search_path = '' as $$
  select wl.material_id, sum(wl.net_g)::int
  from public.route_stops s
  join public.weigh_versions v on v.stop_id = s.id and v.status = 'signed'
  join public.collection_signoffs so on so.weigh_version_id = v.id and so.data_hash = v.data_hash
  join public.weigh_lines wl on wl.version_id = v.id
  where s.route_id = p_route and s.status = 'collected'
  group by wl.material_id;
$$;

create or replace function public.station_shipment(p_route uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v public.routes; v_out jsonb;
begin
  select * into v from public.routes where id = p_route;
  if not found or not (app.is_station_member(v.station_id) or app.is_lamma()) then perform app.fail('not_authorized'); end if;
  select jsonb_build_object(
    'route_id', v.id, 'code', v.code, 'status', v.status, 'starts_at', v.starts_at,
    'expected_arrival', v.starts_at + make_interval(mins => v.expected_duration_min),
    'planned_estimate_g', v.est_total_g,
    'driver_name', (select p.full_name from public.assignments a join public.profiles p on p.id = a.driver_id where a.route_id = v.id and a.active),
    'vehicle_plate', (select ve.plate from public.assignments a join public.vehicles ve on ve.id = a.vehicle_id where a.route_id = v.id and a.active),
    'stops_collected', (select count(*) from public.route_stops where route_id = v.id and status = 'collected'),
    'stops_exception', (select count(*) from public.route_stops where route_id = v.id and status = 'exception'),
    'stops_open', (select count(*) from public.route_stops where route_id = v.id and status in ('pending','arrived')),
    'signed_total_g', coalesce((select sum(signed_g) from app.signed_totals(v.id)), 0),
    'signed_by_material', coalesce((select jsonb_agg(jsonb_build_object('material_id', t.material_id, 'signed_g', t.signed_g) order by t.material_id)
                                    from app.signed_totals(v.id) t), '[]'::jsonb))
  into v_out;
  return v_out;
end $$;

create or replace function app.finalize_receipt(p_receipt uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_rc public.station_receipts; v_route public.routes; v_total bigint; v_driver uuid;
  v_entry uuid; a_recv uuid; a_sales uuid; a_cost uuid; a_pay uuid;
begin
  select * into v_rc from public.station_receipts where id = p_receipt for update;
  select * into v_route from public.routes where id = v_rc.route_id for update;
  update public.station_receipts set status = 'confirmed', confirmed_at = now() where id = p_receipt;
  update public.routes set status = 'completed', completed_at = now() where id = v_route.id;
  update public.pickup_requests set status = 'delivered_to_station', updated_at = now()
  where id in (select request_id from public.route_stops where route_id = v_route.id and status = 'collected');
  update public.assignments set active = false where route_id = v_route.id and active returning driver_id into v_driver;

  -- ledger: material sale (receivable, not cash) and driver payable. Payout/settlement states are separate.
  select coalesce(sum(value_fils), 0) into v_total from public.receipt_lines where receipt_id = p_receipt;
  insert into public.ledger_accounts(kind, owner_id) values ('station_receivable', v_rc.station_id), ('material_sales', null),
         ('driver_cost', null), ('driver_payable', v_driver) on conflict (kind, owner_id) do nothing;
  select id into a_recv from public.ledger_accounts where kind = 'station_receivable' and owner_id = v_rc.station_id;
  select id into a_sales from public.ledger_accounts where kind = 'material_sales' and owner_id is null;
  select id into a_cost from public.ledger_accounts where kind = 'driver_cost' and owner_id is null;
  select id into a_pay from public.ledger_accounts where kind = 'driver_payable' and owner_id = v_driver;
  if v_total > 0 then
    insert into public.journal_entries(kind, ref_type, ref_id, created_by) values ('material_sale', 'station_receipt', p_receipt, auth.uid()) returning id into v_entry;
    insert into public.journal_lines(entry_id, account_id, debit_fils, credit_fils) values (v_entry, a_recv, v_total, 0), (v_entry, a_sales, 0, v_total);
  end if;
  if v_route.pay_fils > 0 then
    insert into public.journal_entries(kind, ref_type, ref_id, created_by) values ('driver_fee', 'route', v_route.id, auth.uid()) returning id into v_entry;
    insert into public.journal_lines(entry_id, account_id, debit_fils, credit_fils) values (v_entry, a_cost, v_route.pay_fils, 0), (v_entry, a_pay, 0, v_route.pay_fils);
  end if;

  perform app.notify(null, v_driver, 'route_completed', jsonb_build_object('route_id', v_route.id, 'code', v_route.code), 'completed:driver:' || v_route.id);
  perform app.notify(o.id, null, 'route_completed', jsonb_build_object('route_id', v_route.id, 'code', v_route.code), 'completed:lamma:' || v_route.id)
  from public.organizations o where o.kind = 'lamma';
  perform app.notify(b.org_id, null, 'collection_received_by_station', jsonb_build_object('stop_id', s.id, 'code', v_route.code), 'completed:stop:' || s.id)
  from public.route_stops s join public.branches b on b.id = s.branch_id where s.route_id = v_route.id and s.status = 'collected';
  perform app.audit('confirm_receipt', 'route', v_route.id, jsonb_build_object('receipt', p_receipt, 'value_fils', v_total));
end $$;

-- "تأكيد الاستلام": the ONLY way a route becomes completed.
create or replace function public.submit_station_receipt(
  p_route uuid, p_client_event_id uuid, p_lines jsonb, p_ticket_path text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_route public.routes; v_existing public.station_receipts; v_pol public.area_policies;
  v_reasons text[] := '{}'; v_signed_total int; v_net_total int; v_diff int; v_tol int; v_tol_base int; v_bps int;
  v_id uuid; v_attempt int; r record; v_has_policy boolean;
begin
  select * into v_existing from public.station_receipts where client_event_id = p_client_event_id;
  if found then
    if not app.is_station_member(v_existing.station_id, 'station_manager', 'station_receiver') then perform app.fail('not_authorized'); end if;
    return jsonb_build_object('receipt_id', v_existing.id, 'status', v_existing.status, 'duplicate', true);
  end if;
  select * into v_route from public.routes where id = p_route for update;
  if not found or not app.is_station_member(v_route.station_id, 'station_manager', 'station_receiver') then perform app.fail('not_authorized'); end if;
  if v_route.status <> 'awaiting_station_receipt' then perform app.fail('invalid_state', 'route is ' || v_route.status); end if;
  if exists (select 1 from public.station_receipts where route_id = p_route and status in ('under_review','review_cleared')) then
    perform app.fail('review_pending');
  end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' then perform app.fail('lines_required'); end if;

  -- evidence completeness
  if exists (select 1 from public.route_stops where route_id = p_route and status in ('pending','arrived')) then
    v_reasons := array_append(v_reasons, 'stops_open');
  end if;
  if exists (select 1 from public.route_stops s where s.route_id = p_route and s.status = 'collected'
             and not exists (select 1 from public.weigh_versions v join public.collection_signoffs so on so.weigh_version_id = v.id
                             where v.stop_id = s.id and v.status = 'signed' and so.data_hash = v.data_hash)) then
    v_reasons := array_append(v_reasons, 'missing_signature');
  end if;

  select * into v_pol from public.area_policies where service_area_id = v_route.service_area_id;
  v_has_policy := v_pol.tolerance_approved_by is not null and (v_pol.tolerance_g is not null or v_pol.tolerance_bps is not null);
  v_tol_base := case when v_has_policy then coalesce(v_pol.tolerance_g, 0) else 0 end;
  v_bps := case when v_has_policy then coalesce(v_pol.tolerance_bps, 0) else 0 end;

  select coalesce(sum(signed_g), 0) into v_signed_total from app.signed_totals(p_route);
  select coalesce(sum((l->>'net_g')::int), 0) into v_net_total from jsonb_array_elements(p_lines) l;
  v_diff := v_net_total - v_signed_total;
  v_tol := greatest(v_tol_base, (v_signed_total::bigint * v_bps / 10000)::int);
  if abs(v_diff) > v_tol then v_reasons := array_append(v_reasons, 'weight_mismatch'); end if;

  select coalesce(max(attempt), 0) + 1 into v_attempt from public.station_receipts where route_id = p_route;
  insert into public.station_receipts(route_id, attempt, station_id, receiver_user_id, client_event_id, status,
      signed_total_g, station_net_g, diff_g, tolerance_g_applied, ticket_path)
  values (p_route, v_attempt, v_route.station_id, auth.uid(), p_client_event_id, 'under_review',
      v_signed_total, v_net_total, v_diff, v_tol, p_ticket_path) returning id into v_id;

  for r in
    select coalesce(st.material_id, li.material_id) as material_id, coalesce(st.signed_g, 0) as signed_g,
           coalesce(li.net_g, 0) as net_g, coalesce(li.accepted_g, 0) as accepted_g, coalesce(li.rejected_g, 0) as rejected_g,
           li.reject_reason, rp.price_fils_per_kg
    from app.signed_totals(p_route) st
    full join (select (l->>'material_id')::uuid as material_id, (l->>'net_g')::int as net_g,
                      coalesce((l->>'accepted_g')::int, (l->>'net_g')::int) as accepted_g,
                      coalesce((l->>'rejected_g')::int, 0) as rejected_g, l->>'reject_reason' as reject_reason
               from jsonb_array_elements(p_lines) l) li on li.material_id = st.material_id
    left join public.route_prices rp on rp.route_id = p_route and rp.material_id = coalesce(st.material_id, li.material_id)
  loop
    if r.price_fils_per_kg is null and not ('unpriced_material' = any(v_reasons)) then v_reasons := array_append(v_reasons, 'unpriced_material'); end if;
    if r.rejected_g > 0 and not ('partial_rejection' = any(v_reasons)) then v_reasons := array_append(v_reasons, 'partial_rejection'); end if;
    if abs(r.net_g - r.signed_g) > greatest(v_tol_base, (r.signed_g::bigint * v_bps / 10000)::int)
       and not ('weight_mismatch' = any(v_reasons)) then v_reasons := array_append(v_reasons, 'weight_mismatch'); end if;
    insert into public.receipt_lines(receipt_id, material_id, signed_g, net_g, accepted_g, rejected_g, reject_reason, price_fils_per_kg, value_fils)
    values (v_id, r.material_id, r.signed_g, r.net_g, r.accepted_g, r.rejected_g, r.reject_reason, coalesce(r.price_fils_per_kg, 0),
            -- fils = grams * fils/kg / 1000, rounded half-up, integer arithmetic only
            (r.accepted_g::bigint * coalesce(r.price_fils_per_kg, 0) + 500) / 1000);
  end loop;

  if cardinality(v_reasons) = 0 then
    perform app.finalize_receipt(v_id);
    return jsonb_build_object('receipt_id', v_id, 'status', 'confirmed', 'diff_g', v_diff, 'duplicate', false);
  end if;

  update public.routes set status = 'needs_review' where id = p_route;
  insert into public.reconciliation_cases(route_id, receipt_id, reasons) values (p_route, v_id, v_reasons);
  perform app.notify(o.id, null, 'receipt_needs_review', jsonb_build_object('route_id', p_route, 'code', v_route.code, 'reasons', v_reasons), 'review:' || v_id)
  from public.organizations o where o.kind = 'lamma';
  perform app.audit('receipt_under_review', 'route', p_route, jsonb_build_object('receipt', v_id, 'reasons', v_reasons, 'diff_g', v_diff));
  return jsonb_build_object('receipt_id', v_id, 'status', 'under_review', 'diff_g', v_diff, 'reasons', to_jsonb(v_reasons), 'duplicate', false);
end $$;

-- Lamma operations documents the resolution. Original readings are never altered.
--   accept_receipt : the station's receipt stands; the station may now press "confirm receipt".
--   reweigh        : the receipt is superseded; the station weighs again and submits a new receipt.
create or replace function public.resolve_case(p_case uuid, p_outcome text, p_note text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_case public.reconciliation_cases;
begin
  if not app.is_lamma('lamma_ops') then perform app.fail('not_authorized'); end if;
  if p_outcome not in ('accept_receipt','reweigh') then perform app.fail('invalid_decision'); end if;
  if coalesce(trim(p_note), '') = '' then perform app.fail('reason_required'); end if;
  select * into v_case from public.reconciliation_cases where id = p_case for update;
  if not found or v_case.status <> 'open' then perform app.fail('invalid_state'); end if;
  if v_case.receipt_id is null then perform app.fail('invalid_state', 'case has no receipt; handle manually'); end if;
  if p_outcome = 'accept_receipt' and v_case.reasons && array['stops_open','missing_signature','unpriced_material'] then
    perform app.fail('evidence_incomplete', 'missing evidence cannot be waived by accepting the receipt');
  end if;
  update public.reconciliation_cases set status = 'resolved', resolution_note = p_outcome || ': ' || p_note,
         resolved_by = auth.uid(), resolved_at = now() where id = p_case;
  update public.station_receipts set status = case p_outcome when 'accept_receipt' then 'review_cleared' else 'superseded' end
  where id = v_case.receipt_id;
  update public.routes set status = 'awaiting_station_receipt' where id = v_case.route_id;
  perform app.audit('resolve_case', 'reconciliation_case', p_case, jsonb_build_object('outcome', p_outcome, 'note', p_note));
end $$;

create or replace function public.confirm_reviewed_receipt(p_receipt uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v public.station_receipts;
begin
  select * into v from public.station_receipts where id = p_receipt for update;
  if not found or not app.is_station_member(v.station_id, 'station_manager', 'station_receiver') then perform app.fail('not_authorized'); end if;
  if v.status = 'confirmed' then return; end if;
  if v.status <> 'review_cleared' then perform app.fail('invalid_state'); end if;
  perform app.finalize_receipt(p_receipt);
end $$;

-- ======================= bootstrap of the first admin (service role only, no public endpoint) =======================
create or replace function app.bootstrap_admin(p_user uuid, p_org_name text default 'لمّة | Lamma')
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_org uuid;
begin
  if exists (select 1 from public.memberships where role = 'lamma_super' and status = 'approved') then
    perform app.fail('already_bootstrapped');
  end if;
  insert into public.organizations(kind, name, status) values ('lamma', p_org_name, 'approved')
  on conflict ((kind)) where kind = 'lamma' do update set status = 'approved' returning id into v_org;
  insert into public.memberships(user_id, org_id, role, status) values (p_user, v_org, 'lamma_super', 'approved');
  return v_org;
end $$;

-- Lamma super admin invites staff (finance, ops, support, impact) — never self-service.
create or replace function public.admin_grant_staff_role(p_user uuid, p_role text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_org uuid;
begin
  if not app.is_lamma() or not exists (select 1 from public.memberships m join public.organizations o on o.id = m.org_id
       where m.user_id = auth.uid() and o.kind = 'lamma' and m.role = 'lamma_super' and m.status = 'approved') then
    perform app.fail('not_authorized');
  end if;
  if p_role not in ('lamma_ops','lamma_finance','lamma_support','lamma_impact') then perform app.fail('invalid_role'); end if;
  select id into v_org from public.organizations where kind = 'lamma';
  insert into public.memberships(user_id, org_id, role, status) values (p_user, v_org, p_role, 'approved')
  on conflict (user_id, org_id, role) do update set status = 'approved';
  perform app.audit('grant_staff_role', 'membership', p_user, jsonb_build_object('role', p_role));
end $$;

-- ---------- execute privileges ----------
-- revoke the default PUBLIC execute from OUR functions only (extension functions such as PostGIS keep theirs)
do $$ declare f record; begin
  for f in select p.oid::regprocedure as sig from pg_proc p
           where p.pronamespace in ('public'::regnamespace, 'app'::regnamespace)
             and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e') loop
    execute format('revoke execute on function %s from public, anon', f.sig);
  end loop;
end $$;
grant execute on function app.is_lamma(text[]), app.is_member(uuid, text[]), app.is_approved_driver(),
  app.is_assigned_driver(uuid), app.is_station_member(uuid, text[]), app.can_see_route(uuid),
  app.can_see_stop(uuid), app.driver_sees_branch(uuid), app.is_service() to authenticated;
grant execute on function
  public.register_institution(text, text, text, uuid, text, double precision, double precision),
  public.register_station(text, uuid, text, double precision, double precision, text, text, date),
  public.register_driver(uuid[]), public.add_vehicle(text, text, integer, integer),
  public.add_driver_document(text, text, date), public.add_driver_scale(text, text, integer, integer, date, text),
  public.admin_review(text, uuid, text, text), public.admin_set_threshold(uuid, uuid, integer),
  public.admin_set_area_policy(uuid, jsonb), public.admin_grant_staff_role(uuid, text),
  public.station_set_material(uuid, uuid, boolean, text), public.station_set_price(uuid, uuid, bigint),
  public.submit_pickup_request(uuid, jsonb, timestamptz, timestamptz, text), public.cancel_pickup_request(uuid, text),
  public.planning_candidates(uuid), public.publish_route(jsonb), public.driver_available_routes(),
  public.apply_to_route(uuid, uuid), public.withdraw_application(uuid), public.assign_route(uuid, boolean),
  public.start_route(uuid), public.arrive_stop(uuid),
  public.record_weights(uuid, uuid, timestamptz, jsonb, text, double precision, double precision, real),
  public.sign_weights(uuid, text, text), public.complete_stop(uuid), public.report_stop_exception(uuid, text, text),
  public.arrive_station(uuid), public.station_shipment(uuid),
  public.submit_station_receipt(uuid, uuid, jsonb, text), public.resolve_case(uuid, text, text),
  public.confirm_reviewed_receipt(uuid)
  to authenticated;
grant execute on function public.planning_candidates(uuid), public.publish_route(jsonb),
  public.assign_route(uuid, boolean), public.assign_due_routes() to service_role;
