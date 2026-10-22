-- Seeded migrations with tenant isolation gaps.

create table invoices (
  id uuid primary key,
  organization_id uuid not null,
  amount_cents bigint not null,
  status text not null default 'open'
);

alter table invoices enable row level security;

create policy invoices_read on invoices
  for select
  using (true);

create table projects (
  id uuid primary key,
  organization_id uuid not null,
  name text not null
);
