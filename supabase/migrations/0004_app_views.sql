-- Read models for the app screens. Each returns only what that role may see.

-- Driver: stops of MY live route, with what is needed to reach the site (never before assignment).
create or replace function public.driver_route_stops(p_route uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not app.is_assigned_driver(p_route) then perform app.fail('not_authorized'); end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
      'stop_id', s.id, 'seq', s.seq, 'status', s.status, 'exception_kind', s.exception_kind,
      'branch_name', b.name, 'org_name', o.name, 'address', b.address, 'entrance_notes', b.entrance_notes,
      'contact_name', b.contact_name, 'contact_phone', b.contact_phone,
      'lat', public.st_y(b.location::public.geometry), 'lng', public.st_x(b.location::public.geometry),
      'expected', (select jsonb_agg(jsonb_build_object('material_id', rm.material_id, 'est_g', rm.est_g, 'containers', rm.containers))
                   from public.request_materials rm where rm.request_id = s.request_id),
      'weigh', (select jsonb_build_object('version_id', v.id, 'version', v.version, 'status', v.status,
                       'lines', (select jsonb_agg(jsonb_build_object('material_id', wl.material_id, 'net_g', wl.net_g)) from public.weigh_lines wl where wl.version_id = v.id))
                from public.weigh_versions v where v.stop_id = s.id and v.status <> 'superseded')
    ) order by s.seq)
    from public.route_stops s join public.branches b on b.id = s.branch_id join public.organizations o on o.id = b.org_id
    where s.route_id = p_route), '[]'::jsonb);
end $$;

-- Driver: my routes (live and past) with the station name.
create or replace function public.driver_my_routes()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(x order by x->>'starts_at' desc), '[]'::jsonb) from (
    select jsonb_build_object('route_id', r.id, 'code', r.code, 'status', r.status, 'starts_at', r.starts_at,
      'expected_duration_min', r.expected_duration_min, 'distance_m', r.distance_m, 'pay_fils', r.pay_fils,
      'est_total_g', r.est_total_g, 'station_name', o.name, 'station_address', st.address,
      'station_lat', public.st_y(st.location::public.geometry), 'station_lng', public.st_x(st.location::public.geometry),
      'active', a.active,
      'receipt', (select jsonb_build_object('status', rc.status, 'signed_total_g', rc.signed_total_g, 'station_net_g', rc.station_net_g, 'diff_g', rc.diff_g)
                  from public.station_receipts rc where rc.route_id = r.id and rc.status <> 'superseded' order by rc.attempt desc limit 1)) as x
    from public.assignments a join public.routes r on r.id = a.route_id
    join public.stations st on st.id = r.station_id join public.organizations o on o.id = st.org_id
    where a.driver_id = auth.uid()) q;
$$;

-- Institution: weights waiting for MY organisation's signature, exactly as they will be signed.
create or replace function public.institution_pending_signoffs()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'version_id', v.id, 'version', v.version, 'data_hash', v.data_hash, 'occurred_at', v.occurred_at,
      'branch_name', b.name, 'route_code', r.code, 'driver_name', p.full_name, 'scale_identifier', sc.identifier,
      'correction_reason', v.correction_reason,
      'lines', (select jsonb_agg(jsonb_build_object('material_id', wl.material_id, 'name_ar', m.name_ar, 'name_en', m.name_en,
                         'method', wl.method, 'gross_g', wl.gross_g, 'tare_g', wl.tare_g, 'net_g', wl.net_g) order by m.code)
                from public.weigh_lines wl join public.material_types m on m.id = wl.material_id where wl.version_id = v.id)
    ) order by v.occurred_at), '[]'::jsonb)
  from public.weigh_versions v
  join public.route_stops s on s.id = v.stop_id
  join public.branches b on b.id = s.branch_id
  join public.routes r on r.id = s.route_id
  join public.profiles p on p.id = v.recorded_by
  join public.driver_scales sc on sc.id = v.scale_id
  where v.status = 'awaiting_signature' and s.status = 'arrived'
    and app.is_member(b.org_id, 'org_owner', 'branch_manager', 'handover_staff');
$$;

-- Institution: history of my collections with measured (signed) weights and station outcome kept separate.
create or replace function public.institution_collections()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'stop_id', s.id, 'branch_name', b.name, 'route_code', r.code, 'route_status', r.status, 'stop_status', s.status,
      'completed_at', s.completed_at, 'exception_kind', s.exception_kind,
      'signed_net_g', (select sum(wl.net_g) from public.weigh_versions v join public.weigh_lines wl on wl.version_id = v.id
                       where v.stop_id = s.id and v.status = 'signed')
    ) order by s.completed_at desc nulls first), '[]'::jsonb)
  from public.route_stops s join public.branches b on b.id = s.branch_id join public.routes r on r.id = s.route_id
  where app.is_member(b.org_id);
$$;

-- Station: inbound and recent routes for MY station.
create or replace function public.station_routes()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(x order by x->>'starts_at' desc), '[]'::jsonb) from (
    select public.station_shipment(r.id) || jsonb_build_object(
      'receipt', (select jsonb_build_object('receipt_id', rc.id, 'status', rc.status, 'station_net_g', rc.station_net_g, 'diff_g', rc.diff_g)
                  from public.station_receipts rc where rc.route_id = r.id and rc.status <> 'superseded' order by rc.attempt desc limit 1),
      'case_reasons', (select c.reasons from public.reconciliation_cases c where c.route_id = r.id and c.status = 'open' limit 1)) as x
    from public.routes r
    where app.is_station_member(r.station_id) and r.status not in ('planning','cancelled')) q;
$$;

-- Lamma operations: everything waiting for a decision.
create or replace function public.admin_review_queue()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not app.is_lamma('lamma_ops') then perform app.fail('not_authorized'); end if;
  return jsonb_build_object(
    'organizations', coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'kind', o.kind, 'name', o.name, 'created_at', o.created_at) order by o.created_at)
                               from public.organizations o where o.status = 'pending'), '[]'::jsonb),
    'station_licenses', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'name', o.name, 'authority', s.license_authority, 'number', s.license_number, 'expires_on', s.license_expires_on))
                               from public.stations s join public.organizations o on o.id = s.org_id where not s.license_verified and o.status <> 'rejected'), '[]'::jsonb),
    'drivers', coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'name', p.full_name, 'created_at', d.created_at) order by d.created_at)
                               from public.drivers d join public.profiles p on p.id = d.id where d.status = 'pending'), '[]'::jsonb),
    'vehicles', coalesce((select jsonb_agg(jsonb_build_object('id', v.id, 'driver', p.full_name, 'type', v.vehicle_type, 'plate', v.plate, 'capacity_g', v.capacity_g, 'capacity_l', v.capacity_l))
                               from public.vehicles v join public.profiles p on p.id = v.driver_id where v.status = 'pending'), '[]'::jsonb),
    'driver_documents', coalesce((select jsonb_agg(jsonb_build_object('id', dd.id, 'driver', p.full_name, 'kind', dd.kind, 'expires_on', dd.expires_on))
                               from public.driver_documents dd join public.profiles p on p.id = dd.driver_id where dd.status = 'pending'), '[]'::jsonb),
    'driver_scales', coalesce((select jsonb_agg(jsonb_build_object('id', sc.id, 'driver', p.full_name, 'identifier', sc.identifier, 'capacity_g', sc.capacity_g, 'precision_g', sc.precision_g, 'check_valid_until', sc.check_valid_until))
                               from public.driver_scales sc join public.profiles p on p.id = sc.driver_id where sc.status = 'pending'), '[]'::jsonb));
end $$;

create or replace function public.admin_overview()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not app.is_lamma() then perform app.fail('not_authorized'); end if;
  return jsonb_build_object(
    'routes', coalesce((select jsonb_agg(jsonb_build_object('route_id', r.id, 'code', r.code, 'status', r.status, 'starts_at', r.starts_at,
                 'est_total_g', r.est_total_g, 'pay_fils', r.pay_fils, 'station_name', o.name,
                 'stops', (select count(*) from public.route_stops s where s.route_id = r.id),
                 'applications', (select count(*) from public.route_applications a where a.route_id = r.id),
                 'driver_name', (select p.full_name from public.assignments a join public.profiles p on p.id = a.driver_id where a.route_id = r.id order by a.created_at desc limit 1)) order by r.starts_at desc)
               from public.routes r join public.stations st on st.id = r.station_id join public.organizations o on o.id = st.org_id), '[]'::jsonb),
    'cases', coalesce((select jsonb_agg(jsonb_build_object('case_id', c.id, 'route_code', r.code, 'reasons', c.reasons, 'opened_at', c.opened_at,
                 'has_receipt', c.receipt_id is not null, 'signed_total_g', rc.signed_total_g, 'station_net_g', rc.station_net_g, 'diff_g', rc.diff_g) order by c.opened_at)
               from public.reconciliation_cases c join public.routes r on r.id = c.route_id
               left join public.station_receipts rc on rc.id = c.receipt_id where c.status = 'open'), '[]'::jsonb),
    'requests_waiting', (select count(*) from public.pickup_requests where status = 'submitted'),
    'requests_need_reschedule', (select count(*) from public.pickup_requests where status = 'needs_reschedule'),
    -- real figures from the database only
    'collected_signed_g', coalesce((select sum(wl.net_g) from public.weigh_versions v join public.weigh_lines wl on wl.version_id = v.id
                                    join public.route_stops s on s.id = v.stop_id where v.status = 'signed' and s.status = 'collected'), 0),
    'station_accepted_g', coalesce((select sum(rl.accepted_g) from public.receipt_lines rl join public.station_receipts rc on rc.id = rl.receipt_id where rc.status = 'confirmed'), 0));
end $$;

-- who am I: every context this account may act in (drives the role switcher). Nothing here is client-controlled.
create or replace function public.my_contexts()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'profile', (select jsonb_build_object('full_name', p.full_name, 'locale', p.locale) from public.profiles p where p.id = auth.uid()),
    'memberships', coalesce((select jsonb_agg(jsonb_build_object('org_id', o.id, 'org_name', o.name, 'kind', o.kind, 'role', m.role,
                       'org_status', o.status, 'membership_status', m.status, 'status_reason', o.status_reason,
                       'station_id', (select s.id from public.stations s where s.org_id = o.id)) order by o.created_at)
                    from public.memberships m join public.organizations o on o.id = m.org_id where m.user_id = auth.uid()), '[]'::jsonb),
    'driver', (select jsonb_build_object('status', d.status, 'status_reason', d.status_reason) from public.drivers d where d.id = auth.uid()));
$$;

grant execute on function public.driver_route_stops(uuid), public.driver_my_routes(), public.institution_pending_signoffs(),
  public.institution_collections(), public.station_routes(), public.admin_review_queue(), public.admin_overview(),
  public.my_contexts() to authenticated;
do $$ declare f record; begin
  for f in select p.oid::regprocedure as sig from pg_proc p
           where p.pronamespace = 'public'::regnamespace and p.proname in ('driver_route_stops','driver_my_routes','institution_pending_signoffs',
                 'institution_collections','station_routes','admin_review_queue','admin_overview','my_contexts') loop
    execute format('revoke execute on function %s from public, anon', f.sig);
  end loop;
end $$;
