-- Row level security: default deny. All sensitive writes go through SECURITY DEFINER RPCs (0003).
-- Never trust a role / organization id sent by the client: everything is derived from auth.uid().

-- ---------- helper predicates (definer, to avoid policy recursion) ----------
create or replace function app.is_lamma(variadic p_roles text[] default '{}')
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.memberships m
    join public.organizations o on o.id = m.org_id
    where m.user_id = auth.uid() and m.status = 'approved'
      and o.kind = 'lamma' and o.status = 'approved'
      and (cardinality(p_roles) = 0 or m.role = any(p_roles) or m.role = 'lamma_super'));
$$;

create or replace function app.is_member(p_org uuid, variadic p_roles text[] default '{}')
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.memberships m
    join public.organizations o on o.id = m.org_id and o.status = 'approved'
    where m.user_id = auth.uid() and m.org_id = p_org and m.status = 'approved'
      and (cardinality(p_roles) = 0 or m.role = any(p_roles)));
$$;

create or replace function app.is_approved_driver()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.drivers d where d.id = auth.uid() and d.status = 'approved');
$$;

create or replace function app.is_assigned_driver(p_route uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.assignments a
                 where a.route_id = p_route and a.driver_id = auth.uid() and a.active);
$$;

create or replace function app.is_station_member(p_station uuid, variadic p_roles text[] default '{}')
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.stations s where s.id = p_station and app.is_member(s.org_id, variadic p_roles));
$$;

create or replace function app.can_see_route(p_route uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select app.is_lamma()
      or app.is_assigned_driver(p_route)
      or exists (select 1 from public.routes r where r.id = p_route and (
            app.is_station_member(r.station_id)
            or (r.status = 'published' and app.is_approved_driver()
                and exists (select 1 from public.driver_areas da
                            where da.driver_id = auth.uid() and da.service_area_id = r.service_area_id))))
      or exists (select 1 from public.route_stops s join public.branches b on b.id = s.branch_id
                 where s.route_id = p_route and app.is_member(b.org_id));
$$;

-- a stop is visible to ops, to the assigned driver, and to the institution that owns that branch (only that stop)
create or replace function app.can_see_stop(p_stop uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.route_stops s join public.branches b on b.id = s.branch_id
                 where s.id = p_stop
                   and (app.is_lamma() or app.is_assigned_driver(s.route_id) or app.is_member(b.org_id)));
$$;

-- a driver sees branch details only while holding a live route that visits it
create or replace function app.driver_sees_branch(p_branch uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.route_stops s
                 join public.assignments a on a.route_id = s.route_id and a.active
                 join public.routes r on r.id = s.route_id
                 where s.branch_id = p_branch and a.driver_id = auth.uid()
                   and r.status in ('assigned','in_progress','en_route_to_station','awaiting_station_receipt','needs_review'));
$$;

create or replace function app.is_service()
returns boolean language sql stable set search_path = '' as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '') = 'service_role';
$$;

create or replace function app.audit(p_action text, p_entity text, p_id uuid, p_details jsonb default '{}')
returns void language sql security definer set search_path = '' as $$
  insert into public.audit_events(actor_id, action, entity, entity_id, details)
  values (auth.uid(), p_action, p_entity, p_id, p_details);
$$;

-- ---------- immutability of evidence ----------
create or replace function app.forbid_change() returns trigger language plpgsql as $$
begin
  raise exception 'immutable_record: % on % is not allowed', tg_op, tg_table_name using errcode = 'P0001';
end $$;

create trigger weigh_lines_immutable before update or delete on public.weigh_lines for each row execute function app.forbid_change();
create trigger signoffs_immutable before update or delete on public.collection_signoffs for each row execute function app.forbid_change();
create trigger receipt_lines_immutable before update or delete on public.receipt_lines for each row execute function app.forbid_change();
create trigger journal_entries_immutable before update or delete on public.journal_entries for each row execute function app.forbid_change();
create trigger journal_lines_immutable before update or delete on public.journal_lines for each row execute function app.forbid_change();
create trigger audit_immutable before update or delete on public.audit_events for each row execute function app.forbid_change();

-- weigh version header: only the status may change, and only forward
create or replace function app.weigh_version_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then raise exception 'immutable_record: weigh_versions cannot be deleted'; end if;
  if (to_jsonb(new) - 'status') <> (to_jsonb(old) - 'status') then
    raise exception 'immutable_record: weigh version data cannot be edited; record a new version';
  end if;
  if not ((old.status = 'awaiting_signature' and new.status in ('signed','superseded'))
       or (old.status = 'signed' and new.status = 'superseded')) then
    raise exception 'invalid_transition: weigh version % -> %', old.status, new.status;
  end if;
  return new;
end $$;
create trigger weigh_versions_guard before update or delete on public.weigh_versions for each row execute function app.weigh_version_guard();

-- every journal entry must balance (checked at commit)
create or replace function app.journal_balanced() returns trigger language plpgsql as $$
declare d bigint; c bigint;
begin
  select coalesce(sum(debit_fils),0), coalesce(sum(credit_fils),0) into d, c
  from public.journal_lines where entry_id = new.entry_id;
  if d <> c then raise exception 'unbalanced_journal_entry: debit % <> credit %', d, c; end if;
  return null;
end $$;
create constraint trigger journal_lines_balanced after insert on public.journal_lines
  deferrable initially deferred for each row execute function app.journal_balanced();

-- profile row for every new auth user (no role is ever granted by sign-up)
create or replace function app.on_auth_user_created() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles(id, full_name, phone)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name',''), new.phone)
  on conflict (id) do nothing;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function app.on_auth_user_created();

-- ---------- privileges ----------
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
grant usage on schema public, app to authenticated;
grant select on all tables in schema public to authenticated;
grant update (full_name, phone, locale) on public.profiles to authenticated;
grant update (read_at) on public.notifications to authenticated;
grant insert, update on public.branches to authenticated;
grant execute on function app.is_lamma(text[]), app.is_member(uuid, text[]), app.is_approved_driver(),
  app.is_assigned_driver(uuid), app.is_station_member(uuid, text[]), app.can_see_route(uuid),
  app.can_see_stop(uuid), app.driver_sees_branch(uuid) to authenticated;

do $$ declare t text; begin
  for t in select tablename from pg_tables where schemaname = 'public' and tablename <> 'spatial_ref_sys' loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- ---------- policies ----------
create policy profiles_read on public.profiles for select to authenticated using (id = auth.uid() or app.is_lamma());
create policy profiles_update_own on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

create policy orgs_read on public.organizations for select to authenticated
  using (app.is_member(id) or created_by = auth.uid() or app.is_lamma());
create policy memberships_read on public.memberships for select to authenticated
  using (user_id = auth.uid() or app.is_lamma() or app.is_member(org_id, 'org_owner', 'station_manager'));

create policy areas_read on public.service_areas for select to authenticated using (true);
create policy materials_read on public.material_types for select to authenticated using (true);
create policy thresholds_read on public.collection_thresholds for select to authenticated using (true);
create policy reqdocs_read on public.required_driver_documents for select to authenticated using (true);
create policy area_policies_read on public.area_policies for select to authenticated using (app.is_lamma());

create policy branches_read on public.branches for select to authenticated
  using (app.is_member(org_id) or app.is_lamma() or app.driver_sees_branch(id));
create policy branches_insert on public.branches for insert to authenticated
  with check (app.is_member(org_id, 'org_owner', 'branch_manager'));
create policy branches_update on public.branches for update to authenticated
  using (app.is_member(org_id, 'org_owner', 'branch_manager'))
  with check (app.is_member(org_id, 'org_owner', 'branch_manager'));

create policy drivers_read on public.drivers for select to authenticated using (id = auth.uid() or app.is_lamma());
create policy driver_areas_read on public.driver_areas for select to authenticated using (driver_id = auth.uid() or app.is_lamma());
create policy vehicles_read on public.vehicles for select to authenticated using (driver_id = auth.uid() or app.is_lamma());
create policy driver_docs_read on public.driver_documents for select to authenticated using (driver_id = auth.uid() or app.is_lamma());
create policy driver_scales_read on public.driver_scales for select to authenticated using (driver_id = auth.uid() or app.is_lamma());

create policy stations_read on public.stations for select to authenticated
  using (app.is_member(org_id) or app.is_lamma()
         or exists (select 1 from public.routes r where r.station_id = stations.id and app.is_assigned_driver(r.id)));
create policy station_materials_read on public.station_materials for select to authenticated
  using (app.is_station_member(station_id) or app.is_lamma());
create policy prices_read on public.price_versions for select to authenticated
  using (app.is_station_member(station_id, 'station_manager', 'station_accountant') or app.is_lamma());

create policy requests_read on public.pickup_requests for select to authenticated
  using (app.is_lamma() or exists (select 1 from public.branches b where b.id = branch_id and app.is_member(b.org_id)));
create policy request_materials_read on public.request_materials for select to authenticated
  using (exists (select 1 from public.pickup_requests r where r.id = request_id));

create policy routes_read on public.routes for select to authenticated using (app.can_see_route(id));
create policy route_prices_read on public.route_prices for select to authenticated
  using (app.is_lamma('lamma_ops', 'lamma_finance')
         or exists (select 1 from public.routes r where r.id = route_id
                    and app.is_station_member(r.station_id, 'station_manager', 'station_accountant')));
create policy stops_read on public.route_stops for select to authenticated using (app.can_see_stop(id));
create policy applications_read on public.route_applications for select to authenticated
  using (driver_id = auth.uid() or app.is_lamma());
create policy evaluations_read on public.eligibility_evaluations for select to authenticated
  using (exists (select 1 from public.route_applications a where a.id = application_id));
create policy assignments_read on public.assignments for select to authenticated
  using (driver_id = auth.uid() or app.is_lamma()
         or exists (select 1 from public.routes r where r.id = route_id and app.is_station_member(r.station_id)));

create policy weigh_versions_read on public.weigh_versions for select to authenticated using (app.can_see_stop(stop_id));
create policy weigh_lines_read on public.weigh_lines for select to authenticated
  using (exists (select 1 from public.weigh_versions v where v.id = version_id));
create policy signoffs_read on public.collection_signoffs for select to authenticated
  using (exists (select 1 from public.weigh_versions v where v.id = weigh_version_id));

create policy receipts_read on public.station_receipts for select to authenticated
  using (app.is_station_member(station_id) or app.is_lamma() or app.is_assigned_driver(route_id));
create policy receipt_lines_read on public.receipt_lines for select to authenticated
  using (exists (select 1 from public.station_receipts r where r.id = receipt_id));
create policy cases_read on public.reconciliation_cases for select to authenticated
  using (app.is_lamma() or app.is_assigned_driver(route_id)
         or exists (select 1 from public.routes r where r.id = route_id and app.is_station_member(r.station_id)));

create policy ledger_accounts_read on public.ledger_accounts for select to authenticated using (app.is_lamma('lamma_finance'));
create policy journal_entries_read on public.journal_entries for select to authenticated using (app.is_lamma('lamma_finance'));
create policy journal_lines_read on public.journal_lines for select to authenticated using (app.is_lamma('lamma_finance'));

create policy notifications_read on public.notifications for select to authenticated
  using (user_id = auth.uid() or (org_id is not null and app.is_member(org_id)));
create policy notifications_mark_read on public.notifications for update to authenticated
  using (user_id = auth.uid() or (org_id is not null and app.is_member(org_id)))
  with check (user_id = auth.uid() or (org_id is not null and app.is_member(org_id)));
create policy audit_read on public.audit_events for select to authenticated using (app.is_lamma('lamma_impact'));
