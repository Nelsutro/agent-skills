# Validation architecture

Validation is a boundary, not a component. The same rules must run on the client for fast feedback and on the server for truth. The only way to keep them aligned is to share the schema and parse at the edge.

## The boundary

Every submission crosses a trust boundary. On the server, treat the payload as unknown:

```ts
const parsed = CheckoutSchema.safeParse(Object.fromEntries(formData))
if (!parsed.success) {
  return {
    ok: false,
    values: Object.fromEntries(formData),
    errors: parsed.error.flatten().fieldErrors,
  }
}
```

Rules:

- Parse `FormData` or the request body into a plain object first.
- Use `safeParse` so validation failures become data, not exceptions.
- Return the parsed value, not the raw input.
- Reject or strip unknown keys deliberately.
- Keep authorization outside the schema.

## Schema design

- One schema per form, exported from a shared module.
- Use `z.coerce` for `FormData` strings that represent numbers or booleans.
- Trim strings at the boundary.
- Bound every string, number, and array. Unbounded input is a denial-of-service risk.
- Use `.strict()` when extra keys could change behavior.
- Use refinements for cross-field rules, not duplicated checks in the UI.
- Keep messages stable identifiers or translatable keys if the app is localized.

```ts
const SignupSchema = z
  .object({
    email: z.string().trim().email(),
    password: z.string().min(12).max(200),
    confirmPassword: z.string(),
  })
  .refine((value) => value.password === value.confirmPassword, {
    path: ['confirmPassword'],
    message: 'passwords_do_not_match',
  })
```

## Error shape

Use the same shape for client and server errors:

```ts
type FieldErrors = Record<string, string[] | undefined>

type FormState = {
  ok: boolean
  values?: Record<string, string>
  errors?: FieldErrors
  message?: string
}
```

- Field errors are arrays so multiple rules can fail at once.
- Form-level errors use `message`.
- Never return a bare string for a field error.
- Never leak stack traces, SQL errors, or internal identifiers.
- Map database unique-constraint errors to a field error when possible.

## Async validation

Async checks such as "email already exists" are not schema validation. They race, they leak account existence, and they are not authoritative.

- Check uniqueness on submit, inside the transaction that writes the record.
- If you provide an async hint, debounce it, cancel stale requests, and never block submit forever.
- Do not reveal whether an account exists on login or password reset.
- Treat the final database constraint as the source of truth.

## Authorization

Validation answers "is this shape acceptable?" Authorization answers "may this actor do this to this object?"

Keep them separate:

```ts
const parsed = InvoiceSchema.parse(input)
const ctx = await requireTenant(request)
await assertCan(ctx, 'invoice:write', parsed.id)
```

Never accept `tenantId`, `userId`, `role`, `price`, or `status` from the form and use them in an authorization decision.

## Idempotency

A form submit is a command. Retries are normal. Make commands idempotent:

- Generate an idempotency key when the form is rendered.
- Store it with a unique constraint scoped to the actor or tenant.
- On conflict, return the existing result instead of creating a duplicate.
- Do not rely on a disabled button; requests can be replayed outside the UI.
- For payments, use the payment provider's idempotency key as well.

```ts
await db.order.create({
  data: { ...parsed.data, userId: ctx.userId, idempotencyKey },
})
```

If the unique constraint fires, look up the existing row and return it.

## Preserving input

A failed submit must not erase work.

- Return the submitted values, excluding secrets.
- Rehydrate `defaultValues` from the server state.
- Never return passwords, tokens, or full payment details.
- For file inputs, return metadata and require re-selection only if the file was not stored.

## Multi-step forms

- Model steps as server-validated states, not client-only booleans.
- Persist a draft with an owner, tenant, and expiry.
- Validate the fields for the current step and the invariants for previous steps.
- Make step transitions idempotent.
- Do not let the client choose a step it is not authorized to enter.
- On final submit, revalidate the full schema and authorization.

## Progressive enhancement

If the product requires forms to work without JavaScript:

- Use a real `<form method="post" action="...">`.
- Return a full HTML response with errors and preserved values on failure.
- Use client JavaScript only to enhance pending state, validation hints, and focus management.
- Test the no-JS path in CI or a browser check.

## Review questions

- Where is the schema defined, and who imports it?
- What happens if the client sends an extra key?
- What happens if the request is replayed?
- What happens if the user double-clicks?
- What happens if validation fails after a slow request?
- Are secrets excluded from returned values?
- Is authorization checked before any write?
