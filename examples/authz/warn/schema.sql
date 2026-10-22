-- RLS enabled but not forced: a warning, not an error.

create table notes (
  id uuid primary key,
  organization_id uuid not null,
  body text not null
);

alter table notes enable row level security;

create policy notes_tenant_isolation on notes
  using (organization_id = current_setting('app.tenant_id', true)::uuid);
