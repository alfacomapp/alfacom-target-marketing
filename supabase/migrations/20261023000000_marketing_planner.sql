-- Private financial data. The browser has no direct table grants.
create table if not exists public.marketing_members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('admin', 'planner')),
  allowed_stores text[] not null default array['kendari','raha']::text[],
  created_at timestamptz not null default now(),
  check (allowed_stores <@ array['kendari','raha']::text[])
);

create table if not exists public.marketing_reports (
  id bigint generated always as identity primary key,
  store_code text not null check (store_code in ('kendari', 'raha')),
  period date not null,
  source_file text not null,
  source_period text not null default '',
  revenue numeric(16,0) not null check (revenue > 0),
  hpp numeric(16,0) not null,
  gross_profit numeric(16,0) not null,
  operating_expenses_reported numeric(16,0) not null,
  investor_paid numeric(16,0) check (investor_paid >= 0),
  other_income numeric(16,0) not null default 0,
  other_expense numeric(16,0) not null default 0,
  net_reported numeric(16,0),
  commission numeric(16,0) not null default 0,
  delivery numeric(16,0) not null default 0,
  other_operating_cost numeric(16,0) not null,
  lines jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (store_code, period),
  check (period = date_trunc('month', period)::date),
  check (abs(revenue - hpp - gross_profit) <= 2),
  check (abs(operating_expenses_reported - coalesce(investor_paid, 0) - commission - delivery - other_operating_cost) <= 2),
  check (net_reported is null or abs(net_reported - gross_profit + operating_expenses_reported - other_income + other_expense) <= 2)
);

create table if not exists public.marketing_scenarios (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  store_code text not null check (store_code in ('kendari', 'raha')),
  name text not null check (char_length(name) between 1 and 120),
  inputs jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists marketing_scenarios_user_created_idx on public.marketing_scenarios(user_id, created_at desc);

alter table public.marketing_members enable row level security;
alter table public.marketing_reports enable row level security;
alter table public.marketing_scenarios enable row level security;
revoke all on public.marketing_members, public.marketing_reports, public.marketing_scenarios from anon, authenticated;
grant all on public.marketing_members, public.marketing_reports, public.marketing_scenarios to service_role;
grant usage, select on sequence public.marketing_reports_id_seq to service_role;

comment on column public.marketing_reports.investor_paid is 'NULL = belum ada akun pembayaran bagi hasil di laporan; bukan berarti kewajiban nol.';
