-- 0006 — evidence files (driver documents, scale-check proof) in a private Storage bucket.
-- Files live under driver/<user id>/…; only that driver can add them and only that driver and Lamma staff can read them.
-- Nobody can replace or delete a file through the API: evidence is append-only.

create or replace function public.add_driver_document(p_kind text, p_file_path text, p_expires_on date)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v uuid;
begin
  if not exists (select 1 from public.drivers where id = auth.uid()) then perform app.fail('not_a_driver'); end if;
  if p_file_path is not null and p_file_path not like 'driver/' || auth.uid()::text || '/%' then perform app.fail('invalid_path'); end if;
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
  if p_evidence_path is not null and p_evidence_path not like 'driver/' || auth.uid()::text || '/%' then perform app.fail('invalid_path'); end if;
  insert into public.driver_scales(driver_id, identifier, scale_type, capacity_g, precision_g, check_valid_until, check_evidence_path)
  values (auth.uid(), p_identifier, p_type, p_capacity_g, p_precision_g, p_check_valid_until, p_evidence_path) returning id into v;
  return v;
end $$;

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
    'driver_documents', coalesce((select jsonb_agg(jsonb_build_object('id', dd.id, 'driver', p.full_name, 'kind', dd.kind, 'expires_on', dd.expires_on, 'file_path', dd.file_path))
                               from public.driver_documents dd join public.profiles p on p.id = dd.driver_id where dd.status = 'pending'), '[]'::jsonb),
    'driver_scales', coalesce((select jsonb_agg(jsonb_build_object('id', sc.id, 'driver', p.full_name, 'identifier', sc.identifier, 'capacity_g', sc.capacity_g, 'precision_g', sc.precision_g, 'check_valid_until', sc.check_valid_until, 'evidence_path', sc.check_evidence_path))
                               from public.driver_scales sc join public.profiles p on p.id = sc.driver_id where sc.status = 'pending'), '[]'::jsonb));
end $$;

do $outer$ begin
  if to_regnamespace('storage') is null then return; end if;
  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('evidence', 'evidence', false, 10485760, array['image/jpeg','image/png','image/webp','application/pdf'])
  on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
  drop policy if exists evidence_driver_insert on storage.objects;
  drop policy if exists evidence_read on storage.objects;
  create policy evidence_driver_insert on storage.objects for insert to authenticated
    with check (bucket_id = 'evidence' and (storage.foldername(name))[1] = 'driver'
                and (storage.foldername(name))[2] = (select auth.uid())::text
                and exists (select 1 from public.drivers d where d.id = (select auth.uid())));
  create policy evidence_read on storage.objects for select to authenticated
    using (bucket_id = 'evidence' and (((storage.foldername(name))[1] = 'driver' and (storage.foldername(name))[2] = (select auth.uid())::text)
                                       or app.is_lamma()));
end $outer$;
