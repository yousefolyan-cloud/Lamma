-- لمّة | Lamma — core schema (phase 1 + vertical slice)
-- Units: weights in integer grams (_g), money in integer fils (1 JOD = 1000 fils), times in UTC (timestamptz).
create extension if not exists postgis;
create extension if not exists btree_gist;

create schema if not exists app;

-- ---------- identity & tenancy ----------
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  phone text,
  locale text not null default 'ar' check (locale in ('ar','en')),
  created_at timestamptz not null default now()
);

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('institution','station','lamma')),
  name text not null check (length(trim(name)) > 0),
  institution_type text,
  status text not null default 'pending' check (status in ('pending','approved','rejected','suspended')),
  status_reason text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
-- only one platform (lamma) organization may exist
create unique index organizations_single_lamma on public.organizations ((kind)) where kind = 'lamma';

create table public.memberships (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  role text not null check (role in (
    'org_owner','branch_manager','handover_staff',
    'station_manager','station_receiver','station_accountant',
    'lamma_super','lamma_ops','lamma_finance','lamma_support','lamma_impact',
    'auditor')),
  status text not null default 'pending' check (status in ('pending','approved','revoked')),
  created_at timestamptz not null default now(),
  unique (user_id, org_id, role)
);
create index memberships_user on public.memberships (user_id) where status = 'approved';

-- ---------- reference data (admin managed; nothing hard-coded) ----------
create table public.service_areas (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name_ar text not null,
  name_en text not null,
  city text not null,
  active boolean not null default false,
  boundary geography(Polygon, 4326)
);

create table public.material_types (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name_ar text not null,
  name_en text not null,
  -- bulk density used ONLY for volume planning; null = unknown (volume not estimated)
  bulk_density_g_per_l integer check (bulk_density_g_per_l > 0),
  density_source text,
  active boolean not null default true
);

create table public.collection_thresholds (
  service_area_id uuid not null references public.service_areas(id) on delete cascade,
  material_id uuid not null references public.material_types(id) on delete cascade,
  min_g integer not null check (min_g > 0),
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now(),
  primary key (service_area_id, material_id)
);

-- operating policy per area. Null = "not approved yet"; the system never invents a value.
create table public.area_policies (
  service_area_id uuid primary key references public.service_areas(id) on delete cascade,
  auto_publish boolean not null default true,
  auto_publish_paused_reason text,
  base_pay_fils bigint check (base_pay_fils >= 0),
  per_stop_pay_fils bigint check (per_stop_pay_fils >= 0),
  per_km_pay_fils bigint check (per_km_pay_fils >= 0),
  application_window_min integer check (application_window_min >= 0),
  early_start_min integer check (early_start_min >= 0),
  service_min_per_stop integer check (service_min_per_stop > 0),
  unload_min integer check (unload_min >= 0),
  max_route_min integer check (max_route_min > 0),
  max_stops integer check (max_stops > 0),
  -- planning vehicle class: a route is never built beyond these limits
  plan_capacity_g integer check (plan_capacity_g > 0),
  plan_capacity_l integer check (plan_capacity_l > 0),
  -- weight matching tolerance between signed field weights and the station scale
  tolerance_g integer check (tolerance_g >= 0),
  tolerance_bps integer check (tolerance_bps between 0 and 10000),
  tolerance_approved_by uuid references auth.users(id),
  updated_at timestamptz not null default now()
);

create table public.required_driver_documents (
  kind text primary key
);

-- ---------- institutions ----------
create table public.branches (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  service_area_id uuid references public.service_areas(id),
  name text not null,
  address text,
  entrance_notes text,
  contact_name text,
  contact_phone text,
  location geography(Point, 4326),
  storage_capacity_l integer check (storage_capacity_l > 0),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index branches_org on public.branches (org_id);
create index branches_loc on public.branches using gist (location);

-- ---------- drivers ----------
create table public.drivers (
  id uuid primary key references auth.users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','approved','rejected','suspended')),
  status_reason text,
  created_at timestamptz not null default now()
);
create table public.driver_areas (
  driver_id uuid not null references public.drivers(id) on delete cascade,
  service_area_id uuid not null references public.service_areas(id) on delete cascade,
  primary key (driver_id, service_area_id)
);
create table public.vehicles (
  id uuid primary key default gen_random_uuid(),
  driver_id uuid not null references public.drivers(id) on delete cascade,
  vehicle_type text not null,
  plate text not null,
  capacity_g integer not null check (capacity_g > 0),
  capacity_l integer not null check (capacity_l > 0),
  status text not null default 'pending' check (status in ('pending','approved','rejected','retired')),
  created_at timestamptz not null default now()
);
create table public.driver_documents (
  id uuid primary key default gen_random_uuid(),
  driver_id uuid not null references public.drivers(id) on delete cascade,
  kind text not null,
  file_path text,
  expires_on date,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  reviewed_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
create table public.driver_scales (
  id uuid primary key default gen_random_uuid(),
  driver_id uuid not null references public.drivers(id) on delete cascade,
  identifier text not null,
  scale_type text,
  capacity_g integer not null check (capacity_g > 0),
  precision_g integer not null check (precision_g > 0),
  check_valid_until date,
  check_evidence_path text,
  status text not null default 'pending' check (status in ('pending','approved','rejected','retired')),
  created_at timestamptz not null default now()
);

-- ---------- stations ----------
create table public.stations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null unique references public.organizations(id) on delete cascade,
  service_area_id uuid references public.service_areas(id),
  address text,
  location geography(Point, 4326),
  license_authority text,
  license_number text,
  license_expires_on date,
  license_file_path text,
  -- "licensed" is only ever set by an authorised Lamma reviewer, never by upload
  license_verified boolean not null default false,
  license_verified_by uuid references auth.users(id),
  opens_at time,
  closes_at time,
  created_at timestamptz not null default now()
);
create table public.station_materials (
  station_id uuid not null references public.stations(id) on delete cascade,
  material_id uuid not null references public.material_types(id),
  accepted boolean not null default true,
  conditions text,
  primary key (station_id, material_id)
);
create table public.price_versions (
  id uuid primary key default gen_random_uuid(),
  station_id uuid not null references public.stations(id) on delete cascade,
  material_id uuid not null references public.material_types(id),
  price_fils_per_kg bigint not null check (price_fils_per_kg >= 0),
  valid_from timestamptz not null default now(),
  valid_to timestamptz,
  created_by uuid references auth.users(id),
  check (valid_to is null or valid_to > valid_from),
  exclude using gist (station_id with =, material_id with =, tstzrange(valid_from, valid_to) with &&)
);

-- ---------- pickup requests ----------
create table public.pickup_requests (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches(id),
  status text not null default 'submitted' check (status in (
    'draft','submitted','scheduled','assigned','collected','delivered_to_station',
    'reconciled','closed','cancelled','needs_reschedule')),
  window_start timestamptz,
  window_end timestamptz,
  notes text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (window_end is null or window_start is null or window_end > window_start)
);
create index pickup_requests_branch on public.pickup_requests (branch_id, status);
create table public.request_materials (
  request_id uuid not null references public.pickup_requests(id) on delete cascade,
  material_id uuid not null references public.material_types(id),
  -- ESTIMATE declared by the institution. Null = unknown (never treated as zero or as ready)
  est_g integer check (est_g > 0),
  containers integer check (containers > 0),
  fill_level text,
  primary key (request_id, material_id)
);

-- ---------- routes ----------
create sequence public.route_code_seq;
create table public.routes (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  service_area_id uuid not null references public.service_areas(id),
  station_id uuid not null references public.stations(id),
  status text not null default 'published' check (status in (
    'planning','published','assigned','in_progress','en_route_to_station',
    'awaiting_station_receipt','completed','needs_review','cancelled','abandoned')),
  version integer not null default 1,
  starts_at timestamptz not null,
  expected_duration_min integer not null check (expected_duration_min > 0),
  distance_m integer not null check (distance_m >= 0),
  distance_is_estimate boolean not null default true,
  est_total_g integer not null check (est_total_g > 0),
  est_total_l integer,
  required_capacity_g integer not null check (required_capacity_g > 0),
  required_capacity_l integer,
  pay_fils bigint not null check (pay_fils >= 0),
  pay_terms text,
  assign_after timestamptz not null,
  planner_version text not null,
  published_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz
);
create index routes_area_status on public.routes (service_area_id, status);
create index routes_station on public.routes (station_id, status);

create table public.route_prices (
  route_id uuid not null references public.routes(id) on delete cascade,
  material_id uuid not null references public.material_types(id),
  price_fils_per_kg bigint not null check (price_fils_per_kg >= 0),
  price_version_id uuid not null references public.price_versions(id),
  primary key (route_id, material_id)
);

create table public.route_stops (
  id uuid primary key default gen_random_uuid(),
  route_id uuid not null references public.routes(id) on delete cascade,
  seq integer not null check (seq > 0),
  branch_id uuid not null references public.branches(id),
  request_id uuid not null references public.pickup_requests(id),
  status text not null default 'pending' check (status in ('pending','arrived','collected','exception')),
  exception_kind text,
  exception_note text,
  active boolean not null default true,
  arrived_at timestamptz,
  completed_at timestamptz,
  unique (route_id, seq)
);
-- a pickup request can be reserved by at most one live route stop
create unique index route_stops_one_active_request on public.route_stops (request_id) where active;
create index route_stops_branch on public.route_stops (branch_id);

create table public.route_applications (
  id uuid primary key default gen_random_uuid(),
  route_id uuid not null references public.routes(id) on delete cascade,
  driver_id uuid not null references public.drivers(id),
  vehicle_id uuid not null references public.vehicles(id),
  scale_id uuid references public.driver_scales(id),
  status text not null default 'submitted' check (status in (
    'submitted','eligibility_check','eligible_pending_assignment','selected',
    'not_selected','ineligible','withdrawn','expired')),
  reasons text[] not null default '{}',
  applied_at timestamptz not null default now(),
  decided_at timestamptz,
  unique (route_id, driver_id)
);
create table public.eligibility_evaluations (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.route_applications(id) on delete cascade,
  policy_version text not null,
  passed boolean not null,
  checks jsonb not null,
  evaluated_at timestamptz not null default now()
);
create table public.assignments (
  id uuid primary key default gen_random_uuid(),
  route_id uuid not null references public.routes(id),
  driver_id uuid not null references public.drivers(id),
  vehicle_id uuid not null references public.vehicles(id),
  scale_id uuid not null references public.driver_scales(id),
  application_id uuid not null references public.route_applications(id),
  period tstzrange not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  -- one driver cannot hold two overlapping live routes
  exclude using gist (driver_id with =, period with &&) where (active)
);
create unique index assignments_one_active_per_route on public.assignments (route_id) where active;

-- ---------- field weights, sign-off, chain of custody ----------
create table public.weigh_versions (
  id uuid primary key default gen_random_uuid(),
  stop_id uuid not null references public.route_stops(id),
  version integer not null,
  status text not null default 'awaiting_signature' check (status in ('awaiting_signature','signed','superseded')),
  client_event_id uuid not null unique,          -- generated on the device (idempotency)
  recorded_by uuid not null references auth.users(id),
  scale_id uuid not null references public.driver_scales(id),
  occurred_at timestamptz not null,              -- device clock
  synced_at timestamptz not null default now(),  -- server clock
  lat double precision, lng double precision, accuracy_m real,
  correction_reason text,
  data_hash text not null,
  unique (stop_id, version)
);
create unique index weigh_versions_one_current on public.weigh_versions (stop_id) where status <> 'superseded';

create table public.weigh_lines (
  version_id uuid not null references public.weigh_versions(id) on delete cascade,
  material_id uuid not null references public.material_types(id),
  method text not null check (method in ('gross_tare','net_direct')),
  gross_g integer,
  tare_g integer,
  net_g integer not null check (net_g > 0),
  primary key (version_id, material_id),
  check ((method = 'gross_tare' and gross_g is not null and tare_g is not null and tare_g >= 0 and gross_g - tare_g = net_g)
      or (method = 'net_direct' and gross_g is null and tare_g is null))
);

create table public.collection_signoffs (
  id uuid primary key default gen_random_uuid(),
  weigh_version_id uuid not null unique references public.weigh_versions(id),
  signer_user_id uuid not null references auth.users(id),
  signer_org_id uuid not null references public.organizations(id),
  signer_role text not null,
  statement_version text not null,
  statement_text text not null,
  data_hash text not null,                       -- hash of exactly what was shown and agreed
  signature_path text,                           -- private storage path of the drawn signature (optional)
  signed_at timestamptz not null default now()
);

-- ---------- station receipt & reconciliation ----------
create table public.station_receipts (
  id uuid primary key default gen_random_uuid(),
  route_id uuid not null references public.routes(id),
  attempt integer not null,
  station_id uuid not null references public.stations(id),
  receiver_user_id uuid not null references auth.users(id),
  client_event_id uuid not null unique,
  status text not null check (status in ('confirmed','under_review','review_cleared','superseded')),
  signed_total_g integer not null,
  station_net_g integer not null check (station_net_g >= 0),
  diff_g integer not null,
  tolerance_g_applied integer,
  ticket_path text,
  created_at timestamptz not null default now(),
  confirmed_at timestamptz,
  unique (route_id, attempt)
);
create unique index station_receipts_one_confirmed on public.station_receipts (route_id) where status = 'confirmed';
create table public.receipt_lines (
  receipt_id uuid not null references public.station_receipts(id) on delete cascade,
  material_id uuid not null references public.material_types(id),
  signed_g integer not null,
  net_g integer not null check (net_g >= 0),
  accepted_g integer not null check (accepted_g >= 0),
  rejected_g integer not null check (rejected_g >= 0),
  reject_reason text,
  price_fils_per_kg bigint not null,
  value_fils bigint not null,
  primary key (receipt_id, material_id),
  check (accepted_g + rejected_g = net_g),
  check (rejected_g = 0 or reject_reason is not null)
);
create table public.reconciliation_cases (
  id uuid primary key default gen_random_uuid(),
  route_id uuid not null references public.routes(id),
  receipt_id uuid references public.station_receipts(id),
  reasons text[] not null,
  status text not null default 'open' check (status in ('open','resolved')),
  resolution_note text,
  resolved_by uuid references auth.users(id),
  opened_at timestamptz not null default now(),
  resolved_at timestamptz,
  check (status = 'open' or (resolution_note is not null and resolved_by is not null))
);

-- ---------- finance: balanced, append-only ledger ----------
create table public.ledger_accounts (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('station_receivable','material_sales','driver_cost','driver_payable','cash')),
  owner_id uuid,
  unique nulls not distinct (kind, owner_id)
);
create table public.journal_entries (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  ref_type text not null,
  ref_id uuid not null,
  reverses uuid references public.journal_entries(id),
  memo text,
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (kind, ref_type, ref_id)
);
create table public.journal_lines (
  id bigint generated always as identity primary key,
  entry_id uuid not null references public.journal_entries(id),
  account_id uuid not null references public.ledger_accounts(id),
  debit_fils bigint not null default 0 check (debit_fils >= 0),
  credit_fils bigint not null default 0 check (credit_fils >= 0),
  check ((debit_fils = 0) <> (credit_fils = 0))
);

-- ---------- notifications, audit ----------
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references public.organizations(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  kind text not null,
  payload jsonb not null default '{}',
  dedupe_key text not null unique,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  check ((org_id is null) <> (user_id is null))
);
create table public.audit_events (
  id bigint generated always as identity primary key,
  actor_id uuid,
  action text not null,
  entity text not null,
  entity_id uuid,
  details jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index audit_entity on public.audit_events (entity, entity_id);
