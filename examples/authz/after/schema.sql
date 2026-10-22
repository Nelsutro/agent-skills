-- Migrations after applying the skill's guidance.

create table invoices (
  id uuid primary key,
  organization_id uuid not null,
  amount_cents bigint not null,
  status text not null default 'open'
);

alter table invoices enable row level security;
alter table invoices force row level security;

create policy invoices_tenant_isolation on invoices
  for all
  using (organization_id = current_setting('app.tenant_id', true)::uuid)
  with check (organization_id = current_setting('app.tenant_id', true)::uuid);

create table projects (
  id uuid primary key,
  organization_id uuid not null,
  name text not null
);

alter table projects enable row level security;
alter table projects force row level security;

create policy projects_tenant_isolation on projects
  for all
  using (organization_id = current_setting('app.tenant_id', true)::uuid)
  with check (organization_id = current_setting('app.tenant_id', true)::uuid);

-- Reference data shared by every tenant.
create table countries (
  id text primary key,
  name text not null
);
