-- 0005 — configuration managed by Lamma operations from inside the app.
-- Reference data (areas, materials, required driver documents) is never seeded with invented values:
-- an operations user enters it here and every change is audited.

create or replace function public.admin_upsert_area(
  p_id uuid, p_code text, p_name_ar text, p_name_en text, p_city text, p_active boolean)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v uuid;
begin
  if not app.is_lamma('lamma_ops') then perform app.fail('not_authorized'); end if;
  if coalesce(trim(p_code),'') = '' or coalesce(trim(p_name_ar),'') = '' or coalesce(trim(p_name_en),'') = ''
     or coalesce(trim(p_city),'') = '' then perform app.fail('missing_fields'); end if;
  if p_id is null then
    if exists (select 1 from public.service_areas where code = trim(p_code)) then perform app.fail('code_taken'); end if;
    insert into public.service_areas(code, name_ar, name_en, city, active)
    values (trim(p_code), trim(p_name_ar), trim(p_name_en), trim(p_city), coalesce(p_active, false)) returning id into v;
  else
    if exists (select 1 from public.service_areas where code = trim(p_code) and id <> p_id) then perform app.fail('code_taken'); end if;
    update public.service_areas set code = trim(p_code), name_ar = trim(p_name_ar), name_en = trim(p_name_en),
      city = trim(p_city), active = coalesce(p_active, active) where id = p_id returning id into v;
    if v is null then perform app.fail('not_found'); end if;
  end if;
  perform app.audit('upsert_area', 'service_area', v, jsonb_build_object('code', trim(p_code), 'active', p_active));
  return v;
end $$;

create or replace function public.admin_upsert_material(
  p_id uuid, p_code text, p_name_ar text, p_name_en text, p_density_g_per_l integer, p_density_source text, p_active boolean)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v uuid;
begin
  if not app.is_lamma('lamma_ops') then perform app.fail('not_authorized'); end if;
  if coalesce(trim(p_code),'') = '' or coalesce(trim(p_name_ar),'') = '' or coalesce(trim(p_name_en),'') = '' then
    perform app.fail('missing_fields');
  end if;
  if p_density_g_per_l is not null and p_density_g_per_l <= 0 then perform app.fail('invalid_density'); end if;
  -- a density figure must say where it came from; without a source it is not stored
  if p_density_g_per_l is not null and coalesce(trim(p_density_source),'') = '' then perform app.fail('density_source_required'); end if;
  if p_id is null then
    if exists (select 1 from public.material_types where code = trim(p_code)) then perform app.fail('code_taken'); end if;
    insert into public.material_types(code, name_ar, name_en, bulk_density_g_per_l, density_source, active)
    values (trim(p_code), trim(p_name_ar), trim(p_name_en), p_density_g_per_l, nullif(trim(p_density_source),''), coalesce(p_active, true))
    returning id into v;
  else
    if exists (select 1 from public.material_types where code = trim(p_code) and id <> p_id) then perform app.fail('code_taken'); end if;
    update public.material_types set code = trim(p_code), name_ar = trim(p_name_ar), name_en = trim(p_name_en),
      bulk_density_g_per_l = p_density_g_per_l, density_source = nullif(trim(p_density_source),''),
      active = coalesce(p_active, active) where id = p_id returning id into v;
    if v is null then perform app.fail('not_found'); end if;
  end if;
  perform app.audit('upsert_material', 'material_type', v, jsonb_build_object('code', trim(p_code), 'active', p_active));
  return v;
end $$;

create or replace function public.admin_set_required_document(p_kind text, p_required boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not app.is_lamma('lamma_ops') then perform app.fail('not_authorized'); end if;
  if coalesce(trim(p_kind),'') = '' then perform app.fail('missing_fields'); end if;
  if p_required then
    insert into public.required_driver_documents(kind) values (trim(p_kind)) on conflict do nothing;
  else
    delete from public.required_driver_documents where kind = trim(p_kind);
  end if;
  perform app.audit('set_required_document', 'required_driver_document', null, jsonb_build_object('kind', trim(p_kind), 'required', p_required));
end $$;

revoke execute on function public.admin_upsert_area(uuid, text, text, text, text, boolean),
  public.admin_upsert_material(uuid, text, text, text, integer, text, boolean),
  public.admin_set_required_document(text, boolean) from public, anon;
grant execute on function public.admin_upsert_area(uuid, text, text, text, text, boolean),
  public.admin_upsert_material(uuid, text, text, text, integer, text, boolean),
  public.admin_set_required_document(text, boolean) to authenticated;
