# Authorization models

Authentication answers "who are you"; authorization answers "what may you do, on which object, in which tenant".

## RBAC

Roles map to permissions. Keep roles coarse and permissions explicit.

```ts
type Role = 'owner' | 'admin' | 'member' | 'viewer'
type Permission = `${Resource}:${Action}`
type Resource = 'invoice' | 'project' | 'member' | 'settings' | 'billing'
type Action = 'read' | 'write' | 'delete' | 'invite' | 'remove' | 'manage'
```

Rules:

- Check permissions, not role names, in handlers. Roles are bundles; permissions are the contract.
- Keep the matrix in one file, exported and tested.
- Owner is not "admin plus everything by accident"; define it explicitly.
- Unknown role or permission → deny.
- Changing the matrix is a security change; require review.

## Custom roles

If tenants can define roles, store them per tenant:

```sql
create table roles (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  permissions text[] not null default '{}',
  unique (tenant_id, name)
);

create table memberships (
  tenant_id uuid not null,
  user_id uuid not null,
  role_id uuid not null references roles(id),
  primary key (tenant_id, user_id)
);
```

- Validate permission strings against a closed allowlist; never accept arbitrary strings.
- Prevent privilege escalation: a non-owner cannot grant a permission they do not have, cannot edit the owner role, and cannot remove the last owner.
- Cache role → permissions carefully; invalidate on change.

## ABAC

Attribute-based checks use properties of the subject, resource, action, and environment:

```ts
type Policy = {
  effect: 'allow' | 'deny'
  actions: string[]
  resource: string
  condition: (ctx: AuthzContext, resource: Resource) => boolean
}
```

Use for rules like "members can edit their own drafts", "viewers cannot export", "support can read but not write during impersonation". Keep conditions pure and testable. Deny overrides allow.

Do not build a general-purpose policy language unless you need one. A typed function per resource is easier to audit:

```ts
function canUpdateInvoice(ctx: TenantContext, invoice: Invoice): boolean {
  if (invoice.organizationId !== ctx.tenantId) return false
  if (ctx.permissions.has('invoice:write')) return true
  return invoice.createdBy === ctx.userId && ctx.permissions.has('invoice:write:own')
}
```

## ReBAC / relationship-based

For sharing and nested resources ("can view because they are a member of the project's team"), relationship tuples are a better fit than flat roles.

Options:

- **OpenFGA / Zanzibar-style**: `document:1#viewer@user:alice`
- **Oso / Cedar / OPA**: policy engines with a decision API
- **Casbin**: policy files or database-backed models

Use only if relationships are genuinely complex. Every external decision point adds latency and failure modes; fail closed.

## Permission naming

- `resource:action`, lowercase, plural resources, no wildcards in stored grants.
- Actions describe intent (`write`, `manage`, `export`), not HTTP verbs.
- Avoid `admin:all`; enumerate.
- Keep a stable list; removals are breaking changes.
- Document what each permission implies, especially `manage`.

## Enforcement points

1. **Route/middleware**: authenticated? member of the tenant? not suspended?
2. **Service/policy**: permission for the action, plus object ownership/tenant.
3. **Data access**: tenant filter.
4. **Database**: RLS.
5. **UI**: hide/disable, purely cosmetic.

Do not skip layer 2 because layer 3 exists. A missing filter should be caught by tests and RLS, not by luck.

## Object-level checks

```ts
// Bad: route-level only
assertCan(ctx, 'invoice:read')
return db.invoice.findUnique({ where: { id } })

// Good: object scoped to tenant + permission
const invoice = await db.invoice.findFirst({ where: { id, organizationId: ctx.tenantId } })
if (!invoice) throw new NotFoundError()
assertCan(ctx, 'invoice:read')
return invoice
```

For updates and deletes, re-read with the tenant scope inside the same transaction as the write, or use a conditional write:

```sql
update invoices
set status = $1
where id = $2 and organization_id = $3
returning *
```

If `rowCount === 0`, return 404. Never "update by id then check after".

## Roles at the edge

- An "active tenant" belongs to the session; switching verifies membership.
- A user can be owner in tenant A and viewer in tenant B. Test both.
- Service accounts/API keys are tenant-scoped, with their own permissions and rotation.
- Impersonation is a separate, audited capability. Never let impersonation silently switch tenant.

## Invitations

- Generate a random token (≥128 bits), store only its hash.
- Bind the token to tenant, email, role, inviter, and expiry.
- Single use; revoke on accept, on role change, or on removal.
- Validate the accepting user's email (case-insensitive, normalized).
- Validate the requested role at accept time against the inviter's permissions.
- Do not allow inviting an existing member to escalate their role; require an explicit role change.
- Rate-limit invitations and resends.
- Log invite, accept, revoke, and role change.

## Audit events

```json
{
  "tenantId": "...",
  "actorUserId": "...",
  "action": "member.role_changed",
  "resourceType": "membership",
  "resourceId": "...",
  "before": { "role": "member" },
  "after": { "role": "admin" },
  "result": "success",
  "ip": "...",
  "userAgent": "..."
}
```

- Append-only; tenant admins cannot edit or delete.
- No secrets, tokens, or unnecessary PII.
- Include denied attempts for sensitive actions.
- Make it queryable per tenant and per actor.

## Anti-patterns

- Role checks scattered across handlers
- `isAdmin` boolean passed from the client
- Wildcards (`*`) in stored permissions
- Permission named after a UI page instead of an action
- Treating "member" as "can do everything except billing"
- Letting a tenant admin grant permissions they do not hold
- Removing the last owner without a transfer flow
- Policies that fail open when the engine is unavailable
- Impersonation without audit
- Checking permissions after performing the mutation
