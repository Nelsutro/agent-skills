# Postgres row-level security

RLS is a database-enforced tenant filter. It is the strongest defense against a forgotten `where` clause, but it is easy to configure in a way that silently does nothing.

## Minimal working setup

```sql
alter table invoices enable row level security;
alter table invoices force row level security;

create policy invoices_tenant_isolation on invoices
  for all
  to app_user
  using (organization_id = current_setting('app.tenant_id', true)::uuid)
  with check (organization_id = current_setting('app.tenant_id', true)::uuid);
```

Set the tenant per transaction:

```sql
begin;
select set_config('app.tenant_id', $1, true);
-- all statements here are constrained by RLS
commit;
```

`set_config(..., true)` is the function form of `SET LOCAL`: it lasts until the transaction ends. Outside a transaction it lasts for the session and will leak to the next request on a pooled connection.

## The bypass traps

1. **Table owner bypasses RLS** unless `FORCE ROW LEVEL SECURITY` is set. If your app connects as the migration owner, `ENABLE` alone does nothing.
2. **Superusers and roles with `BYPASSRLS` always bypass**, even with `FORCE`. The app role must not have these attributes.
3. **No policy means deny** for normal roles, but table owners bypass by default.
4. **`SECURITY DEFINER` functions** run with the owner's privileges. Set a safe `search_path` and avoid unnecessary definer functions.
5. **Views** can bypass RLS depending on `security_invoker` (Postgres 15+) and ownership. Test views explicitly.
6. **Partitioned tables** need policies on the parent; verify partitions inherit as expected.
7. **Foreign tables / FDWs** do not automatically enforce policies.

Check the actual role:

```sql
select current_user, session_user;
select rolname, rolsuper, rolbypassrls
from pg_roles
where rolname = current_user;
```

Create a dedicated app role:

```sql
create role app_user nologin;
grant select, insert, update, delete on all tables in schema public to app_user;
alter default privileges in schema public grant select, insert, update, delete on tables to app_user;
```

## Policy predicates

- `USING` filters rows for `SELECT`, `UPDATE`, and `DELETE`.
- `WITH CHECK` validates rows for `INSERT` and `UPDATE`.
- For `UPDATE`, `USING` decides which rows are visible/updatable and `WITH CHECK` decides whether the new row is allowed.
- Always provide both for tenant-owned tables; otherwise an update can move a row into another tenant.
- Use `FOR ALL` only when the predicate is identical for every command; otherwise define per-command policies.

```sql
create policy invoices_select on invoices for select to app_user
  using (organization_id = current_setting('app.tenant_id', true)::uuid);

create policy invoices_insert on invoices for insert to app_user
  with check (organization_id = current_setting('app.tenant_id', true)::uuid);

create policy invoices_update on invoices for update to app_user
  using (organization_id = current_setting('app.tenant_id', true)::uuid)
  with check (organization_id = current_setting('app.tenant_id', true)::uuid);

create policy invoices_delete on invoices for delete to app_user
  using (organization_id = current_setting('app.tenant_id', true)::uuid);
```

If `app.tenant_id` is unset, `current_setting(..., true)` returns null, the comparison is null, and the row is denied. That is the correct fail-closed behavior.

## Multiple tenants in one query

RLS is per connection/transaction. If one request legitimately needs two tenants, open separate transactions with separate settings, or use a policy that allows an explicit list:

```sql
using (organization_id = any (string_to_array(current_setting('app.tenant_ids', true), ',')::uuid[]))
```

Only do this for trusted operator paths, and never let a client control the list.

## Roles and admin access

- The request path uses `app_user` with RLS enforced.
- Migrations and maintenance use a separate owner role, not the app role.
- Admin/operator tooling uses a dedicated role with explicit tenant filters and audit; avoid blanket `BYPASSRLS`.
- Tenant admins are application-level roles, not Postgres roles.

## Performance

- Index the tenant column as the leading column: `(organization_id)`, `(organization_id, created_at)`.
- Policy predicates should be index-friendly; avoid functions on the column.
- `current_setting` is stable within a statement; in hot paths, wrapping it in a subquery can help the planner treat it as an initplan: `(select current_setting('app.tenant_id', true)::uuid)`.
- `EXPLAIN (ANALYZE, BUFFERS)` a tenant-scoped query and verify the index is used and the predicate appears.
- Test with realistic tenant sizes; a permissive policy can hide N+1 and full scans.

## Transactions and pooling

- PgBouncer in transaction mode: `SET LOCAL` / `set_config(..., true)` is safe because it is transaction-scoped. Session-level `SET` is not.
- Never `SET app.tenant_id` at connection checkout and assume it stays correct for the request.
- If you use a connection per tenant, document and enforce it.
- Nested transactions/savepoints keep the local setting until the outer transaction ends.

## Supabase

Supabase exposes JWT-based helpers. Prefer claims over a client-supplied tenant:

```sql
create policy invoices_tenant_isolation on invoices
  for all
  to authenticated
  using (
    organization_id = (auth.jwt() -> 'app_metadata' ->> 'organization_id')::uuid
  )
  with check (
    organization_id = (auth.jwt() -> 'app_metadata' ->> 'organization_id')::uuid
  );
```

Or verify membership with a helper:

```sql
create or replace function is_org_member(org uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from memberships
    where organization_id = org and user_id = auth.uid()
  );
$$;

create policy invoices_member_access on invoices
  for all to authenticated
  using (is_org_member(organization_id))
  with check (is_org_member(organization_id));
```

Rules:

- `anon` and `authenticated` roles must be covered by policies; tables without policies are inaccessible to them.
- The service-role key bypasses RLS. Never use it in request handlers; only in trusted jobs, with explicit tenant filters and audit.
- `security definer` helpers must set `search_path` and be reviewed.
- Test with a real user JWT, not the service role.

## Testing RLS

Connect as the app role, not the owner:

```sql
begin;
select set_config('app.tenant_id', 'tenant-a', true);
select count(*) from invoices; -- must only see tenant A
rollback;

begin;
select set_config('app.tenant_id', 'tenant-b', true);
select * from invoices where id = 'tenant-a-invoice'; -- must return 0 rows
rollback;

begin;
select set_config('app.tenant_id', 'tenant-a', true);
insert into invoices (organization_id) values ('tenant-b'); -- must fail WITH CHECK
rollback;
```

Also test:

- No `app.tenant_id` set → zero rows, no error.
- Update that tries to change `organization_id` → denied.
- Delete across tenants → zero rows.
- Table owner vs app role behavior.
- `FORCE` is actually enabled (`pg_class.relforcerowsecurity`).
- Views and functions.

## Diagnostic queries

```sql
-- Tables with RLS disabled
select n.nspname, c.relname
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where c.relkind = 'r'
  and n.nspname = 'public'
  and not c.relrowsecurity;

-- Tables with RLS enabled but not forced
select n.nspname, c.relname
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where c.relrowsecurity and not c.relforcerowsecurity;

-- Policies
select schemaname, tablename, policyname, roles, cmd, qual, with_check
from pg_policies
where schemaname = 'public';
```

## Anti-patterns

- `ENABLE` without `FORCE` while the app connects as owner
- App role with `BYPASSRLS` or superuser
- `USING (true)` to make tests pass
- Session-level `SET` on pooled connections
- Policy only on `SELECT`, leaving writes unscoped
- `WITH CHECK` missing, allowing tenant changes on update
- Service-role key in the request path
- `SECURITY DEFINER` without `search_path`
- Testing RLS as the table owner
- Assuming RLS protects storage, queues, or search indexes (it does not)
