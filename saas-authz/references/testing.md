# Testing tenant isolation and authorization

Happy-path tests do not catch authorization bugs. Test the boundary from the attacker's perspective.

## Test fixtures

Create at least:

- Tenant A and Tenant B
- Alice: owner of A, viewer in B
- Bob: admin in A
- Carol: member in A
- Dave: not a member of A
- Objects in each tenant with known IDs: `a-invoice`, `b-invoice`, `a-project`, `b-project`
- A global object (country, plan) that both tenants may read

```ts
const fixtures = {
  tenants: { a: 'tenant-a', b: 'tenant-b' },
  users: {
    alice: { id: 'user-alice', memberships: [{ tenant: 'tenant-a', role: 'owner' }, { tenant: 'tenant-b', role: 'viewer' }] },
    bob: { id: 'user-bob', memberships: [{ tenant: 'tenant-a', role: 'admin' }] },
    carol: { id: 'user-carol', memberships: [{ tenant: 'tenant-a', role: 'member' }] },
    dave: { id: 'user-dave', memberships: [] },
  },
  invoices: { a: 'a-invoice', b: 'b-invoice' },
}
```

## The access matrix

For each endpoint, test actor × action × object × expected result.

| Actor | Action | Object | Expected |
| --- | --- | --- | --- |
| Alice (owner A) | read | `a-invoice` | 200 |
| Alice (owner A) | read | `b-invoice` | 404 |
| Alice (viewer B) | read | `b-invoice` | 200 |
| Alice (viewer B) | update | `b-invoice` | 403 |
| Alice (owner A) | update | `b-invoice` | 404 |
| Bob (admin A) | delete | `a-invoice` | 200 |
| Bob (admin A) | billing | tenant A | 403 |
| Carol (member A) | invite | tenant A | 403 |
| Dave (no membership) | read | `a-invoice` | 403/404 |
| Unauthenticated | read | `a-invoice` | 401 |

Rules:

- Cross-tenant object access should return 404, not 403, to avoid confirming existence.
- Permission failures within the tenant may return 403.
- No membership should fail at the tenant gate before object lookup.

## Mandatory cases

1. **Read by ID across tenants** — `GET /invoices/b-invoice` as tenant A returns 404.
2. **Update by ID across tenants** — no row changes; 404.
3. **Delete by ID across tenants** — no row changes; 404.
4. **List** — returns only the caller's tenant, including pagination and search filters.
5. **Bulk operations** — `updateMany`/`deleteMany`, imports, and exports cannot cross tenants.
6. **Role escalation** — member cannot call admin endpoints; admin cannot call owner-only endpoints.
7. **Self-escalation** — user cannot change their own role or grant themselves a permission.
8. **Last owner** — removing/demoting the last owner is rejected or transfers ownership.
9. **Removed member** — existing session loses access immediately (or within the documented revocation window).
10. **Tenant switch** — switching updates the session server-side; a stale token for tenant A cannot access B.
11. **Invitation replay** — used, expired, wrong email, wrong tenant, or revoked token fails.
12. **Invitation role** — accepting cannot grant a role higher than the inviter could grant.
13. **API keys** — a key scoped to tenant A cannot access B, even with a valid resource ID.
14. **Background job** — a job for tenant A cannot read B, even if the payload is tampered with.
15. **Cache** — tenant A's cached response is never served to B.
16. **Storage** — signed URL for A's file cannot be reused for B; path traversal is rejected.
17. **Search** — results are filtered by tenant before ranking/pagination.
18. **Export/PDF/email** — contains only the tenant's data and is addressed to the right tenant.
19. **Admin/impersonation** — audited, time-boxed, cannot silently switch tenant.
20. **RLS** — a raw query without `app.tenant_id` returns zero rows.

## RLS tests

Run as the application role, not the table owner:

```sql
begin;
select set_config('app.tenant_id', 'tenant-a', true);
select count(*) from invoices;                    -- only A
select * from invoices where id = 'b-invoice';    -- 0 rows
update invoices set status = 'paid' where id = 'b-invoice'; -- 0 rows
rollback;

begin;
select set_config('app.tenant_id', 'tenant-a', true);
insert into invoices (organization_id) values ('tenant-b'); -- must fail WITH CHECK
rollback;
```

Also test:

- Tenant setting unset → zero rows, no data leak.
- Update that changes `organization_id` → rejected.
- `FORCE` is enabled: `select relforcerowsecurity from pg_class where relname = 'invoices';`
- The app role is not superuser and lacks `BYPASSRLS`.
- Views and `security definer` functions respect the policy.
- Pooled connections: two concurrent transactions with different tenants do not leak.

## Unit tests for policies

```ts
describe('invoice permissions', () => {
  it('allows owners to delete in their tenant', () => {
    expect(can(ctx({ role: 'owner', tenant: 'a' }), 'invoice:delete')).toBe(true)
  })

  it('denies a member', () => {
    expect(can(ctx({ role: 'member', tenant: 'a' }), 'invoice:delete')).toBe(false)
  })

  it('denies an unknown role', () => {
    expect(can(ctx({ role: 'unknown' as Role, tenant: 'a' }), 'invoice:read')).toBe(false)
  })
})
```

Test the matrix exhaustively; it is small and high-value.

## Integration tests

Use a real database (Testcontainers, a local Postgres, or a Supabase test project). Do not mock the tenant filter.

```ts
test('tenant A cannot read tenant B invoice', async () => {
  const res = await request(app)
    .get('/invoices/b-invoice')
    .set('Cookie', sessionFor('alice', 'tenant-a'))
  expect(res.status).toBe(404)
})

test('viewer cannot update', async () => {
  const res = await request(app)
    .patch('/invoices/b-invoice')
    .set('Cookie', sessionFor('alice', 'tenant-b'))
    .send({ status: 'paid' })
  expect(res.status).toBe(403)
})
```

## Property-based tests

Generate random IDs and tenants; assert that no combination returns another tenant's data:

```ts
fc.assert(
  fc.asyncProperty(fc.uuid(), fc.uuid(), async (invoiceId, tenantId) => {
    const rows = await repo.invoices(ctxFor(tenantId)).listByIds([invoiceId])
    return rows.every((row) => row.organizationId === tenantId)
  }),
)
```

## CI

```yaml
- run: node saas-authz/scripts/scan-tenant-scope.mjs src
- run: node saas-authz/scripts/check-rls.mjs db/migrations
- run: npm test -- --run authz
- run: npm run test:integration -- authz
```

The scripts are heuristics; the integration tests are the source of truth.

## Failure injection

- Deny by default: remove the permission and confirm 403, not 500.
- Simulate a missing tenant context and confirm rejection.
- Simulate a policy engine timeout and confirm fail-closed.
- Simulate a stale JWT after membership removal.
- Simulate a queue redelivery and confirm idempotency does not cross tenants.

## What not to test

- Only the happy path with one tenant.
- Only the UI (hidden buttons are not authorization).
- Mocked ORM calls that assume the filter is applied.
- Snapshot tests of policy files without executing them.
- RLS as the table owner and calling it verified.
