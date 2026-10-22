---
name: web-forms
description: Production-grade web forms end to end. Use when building or reviewing signup, login, checkout, settings, onboarding, contact, multi-step, or admin forms; validating with Zod, Valibot, Yup, or server actions; handling field errors, pending states, double submits, file uploads, accessibility, autofill, or schema/form drift. Framework-agnostic guidance for React, Next.js, React Router, Remix, SvelteKit, Vue, Astro, and plain HTML.
license: MIT
---

# Web forms

A form is a distributed system with a text box. The browser can lie, the network can fail, the user can double-click, and the server is the only place where a decision is authoritative. The goal is a form that is correct, accessible, fast, and boring to maintain: one schema, one source of truth, one submit path.

## When to Use This Skill

Use when the user asks to:

- Build or review signup, login, checkout, settings, onboarding, contact, or admin forms
- Add validation with Zod, Valibot, Yup, or a framework-native parser
- Map server errors to fields and preserve user input after a failed submit
- Fix double submits, duplicate records, or missing pending states
- Make form errors accessible to screen readers and keyboard users
- Add multi-step, draft, autosave, or conditional fields
- Add file uploads to a form
- Compare a form schema with the fields actually rendered
- Choose between React Hook Form, server actions, React Router actions, Conform, or native HTML validation

Related references are in `references/` and scripts in `scripts/`. Read only what the task needs. Paths are relative to this skill's directory.

## Non-negotiables

1. **Validate on the server.** Client validation is UX. The server parses and rejects every submission, including requests that never touched the UI.
2. **Use one schema.** The same schema validates on the client and the server. Two hand-written validators will drift.
3. **Parse, do not merely validate.** Return typed data from the boundary, not the raw `FormData` or request body. Unknown keys are rejected or stripped deliberately.
4. **Never trust field names, hidden inputs, or IDs.** Prices, roles, tenant IDs, user IDs, and status values come from the session or database, not from the form.
5. **Preserve input after an error.** A failed submit must not erase the user's work. Return field values or use the framework's form state.
6. **Make errors accessible.** Every invalid field has a programmatic label and description, `aria-invalid`, and an error message associated with it. Errors are announced, not only colored red.
7. **Submit is idempotent.** A double click, retry, or duplicate request must not create two orders, invitations, or charges. Use a server-side idempotency key or a unique constraint.
8. **Show pending state.** Disable the submit control while the request is in flight and expose `aria-busy` or a status message. Do not rely on a spinner alone.
9. **No sensitive values in hidden fields.** Hidden inputs are user-editable. Recompute prices, permissions, tenant scope, and ownership on the server.
10. **Uploads are hostile.** Validate size, count, real content type, and ownership on the server. Never trust the filename or extension.

## Workflow

### 1. Inventory the form before writing code

- Identify the submit path: server action, route handler, API call, or native form post.
- List every field, its type, whether it is required, and where its value comes from.
- Mark fields that must never be client-controlled: price, currency, tenant, role, owner, status, timestamps.
- Find the existing schema, validation library, and error shape. Extend them instead of introducing a second system.
- Check whether the form must work without JavaScript.

### 2. Define the schema at the boundary

```ts
const CheckoutSchema = z.object({
  email: z.string().trim().email(),
  name: z.string().trim().min(1).max(120),
  quantity: z.coerce.number().int().min(1).max(20),
  coupon: z.string().trim().max(40).optional(),
})

type CheckoutInput = z.infer<typeof CheckoutSchema>
```

- Put the schema in a shared module imported by both client and server.
- Use coercion for values that arrive as strings from `FormData`.
- Use `.strict()` or an explicit allowlist when unexpected keys are dangerous.
- Keep authorization out of the schema; check it separately with the authenticated context.
- Never encode business rules only in HTML attributes (`min`, `max`, `pattern`, `required`).

Details: `references/validation-architecture.md`.

### 3. Build the server boundary

```ts
export async function checkoutAction(prevState: FormState, formData: FormData) {
  const parsed = CheckoutSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) {
    return {
      ok: false,
      values: Object.fromEntries(formData),
      errors: parsed.error.flatten().fieldErrors,
    }
  }

  const session = await requireSession()
  const idempotencyKey = String(formData.get('idempotencyKey') ?? '')
  const order = await createOrder({
    ...parsed.data,
    userId: session.userId,
    priceCents: await priceFor(parsed.data.quantity),
    idempotencyKey,
  })

  return { ok: true, orderId: order.id }
}
```

- Authenticate and authorize before writing.
- Derive tenant and owner from the session, never from the form.
- Recompute prices and eligibility from trusted data.
- Return a stable error shape: `{ ok, values, errors, message }`.
- Use a transaction for multi-row writes.
- Enforce idempotency with a unique key, not with a disabled button.

### 4. Wire the client state

- Use React Hook Form with the shared schema when the project already uses it.
- Use `useActionState` for server actions and `useFormStatus` for pending UI.
- Keep server errors and client errors in the same field-keyed shape.
- Preserve values returned by the server; do not reset the form on a validation error.
- Reset only after a confirmed success.
- Treat `defaultValue` and uncontrolled inputs as the default; use controlled inputs only when the UI needs them.

React patterns: `references/react.md`. Other frameworks: `references/frameworks.md`.

### 5. Make it accessible

- Every input has a visible `<label>` or an equivalent accessible name.
- Required fields are marked in text, not only with an asterisk.
- Errors are associated with `aria-describedby` and set `aria-invalid`.
- A form-level error summary links to the invalid fields and receives focus after submit.
- Async errors are announced with `role="alert"` or a polite live region.
- Do not disable the submit button just because the form is invalid; let the user submit and see the errors. Disable it only while a request is pending.
- Keep focus order logical and do not steal focus on every keystroke.
- Use `autocomplete` values for identity, address, and payment fields.

Full checklist: `references/accessibility.md`.

### 6. Handle uploads deliberately

- Accept a narrow allowlist of types and a maximum size and count.
- Validate the real content type on the server, not the filename or browser-reported MIME.
- Prefer direct-to-storage presigned uploads for large files; never buffer unbounded bodies in memory.
- Scope storage keys by tenant and owner; never accept a client-supplied path.
- Strip EXIF where appropriate and generate derived images asynchronously.
- Clean up orphaned uploads and failed multipart sessions.

Details: `references/uploads.md`.

### 7. Test the boundaries

At minimum:

- Schema accepts valid input and rejects each required field.
- The server action rejects unauthenticated and unauthorized submissions.
- A validation error preserves values and returns field-keyed errors.
- A duplicate submit with the same idempotency key creates one record.
- A slow request shows pending state and prevents a second submit.
- The form works with JavaScript disabled if the product requires it.
- Errors are announced and associated with the correct fields.
- Uploads reject oversized, wrong-type, and spoofed files.

Full matrix: `references/testing.md`.

Run the checks:

```bash
node scripts/scan-forms.mjs src
node scripts/check-form-schema.mjs src --schema src/schema.ts --form src/CheckoutForm.tsx
```

Both scripts support `--json` and `--fail-on`. They are heuristics; review the output.

## Framework matrix

| Stack | Default submit path | Validation | Notes |
| --- | --- | --- | --- |
| Next.js App Router | Server Action | Zod + `useActionState` | Do not put secrets in client components |
| React Router | Route action | Zod + `useNavigation` | Actions run on the server; use `useFetcher` for inline forms |
| Remix | Route action | Zod + Conform | Progressive enhancement is the default |
| SvelteKit | Form action | Zod/Valibot | Use `use:enhance` only when needed |
| Vue | API call or server endpoint | VeeValidate + Zod | Keep the schema shared with the server |
| Astro | Endpoint or action | Zod | Prefer native HTML posts; hydrate only interactive parts |
| Plain HTML | Native POST | Server-side parser | Best baseline; add JS as an enhancement |

Do not introduce a form library into a codebase that already has a working pattern. Extend the existing one.

## Key decisions and traps

### Client-only validation

`required`, `pattern`, and `minLength` are hints. A request can omit them. If the server does not parse the payload, the form is not validated.

### Schema/form drift

A field can be in the schema but missing from the UI, or in the UI but absent from the schema. Both are bugs. Run `check-form-schema.mjs` after changing either side.

### Error shape drift

Pick one shape and keep it everywhere:

```ts
type FormState = {
  ok: boolean
  values?: Record<string, string>
  errors?: Record<string, string[]>
  message?: string
}
```

Do not return `{ error: 'Invalid email' }` from one action and `{ errors: { email: [...] } }` from another.

### Double submits

Disabling the button is not enough: the request may already be in flight, the user may retry, or a proxy may replay it. Use a server-side idempotency key backed by a unique constraint.

### Hidden fields

Hidden inputs are not hidden from the user. Anything that affects money, permissions, ownership, or state must be recomputed or loaded from trusted storage.

### Reset on error

Calling `form.reset()` after a failed submit destroys the user's work. Return the submitted values and rehydrate the form.

### Multi-step forms

- Validate each step on the server, not only the final step.
- Persist drafts with an owner and expiry.
- Make step navigation idempotent.
- Do not let the client decide which step is allowed next.

### File uploads

A file input is not validation. Check the real type, size, dimensions, and ownership on the server. Treat SVG as executable content.

## Review checklist

- [ ] The server parses every submission with the shared schema
- [ ] Client validation is treated as UX only
- [ ] Every field has an accessible name
- [ ] Errors are associated with fields and announced
- [ ] Invalid submits preserve user input
- [ ] Submit has pending and disabled state
- [ ] Duplicate submits are idempotent on the server
- [ ] Sensitive values are not trusted from hidden inputs
- [ ] Tenant, owner, role, and price are derived server-side
- [ ] Multi-step forms validate and authorize each step
- [ ] Uploads validate real type, size, count, and ownership
- [ ] The form works without JavaScript when required
- [ ] Schema and rendered fields match
- [ ] Tests cover auth, validation, duplicate submit, and a11y

## Anti-patterns

- `if (!email.includes('@'))` on the client with no server check
- `required` as the only validation
- `form.reset()` after a failed submit
- Disabling submit as the only double-submit protection
- Returning a plain string instead of field-keyed errors
- Reading `tenantId`, `price`, `role`, or `userId` from `FormData`
- Rendering errors without `aria-describedby`
- Using placeholder text as the only label
- Disabling submit while the form is invalid
- Trusting a file extension or `Content-Type` header
- Building a multi-step form entirely in client state with no server validation
- Duplicating the schema in a client file and a server file
- Using `dangerouslySetInnerHTML` for error messages

## Scripts

- `scan-forms.mjs` — flags common form defects: missing names/labels, client-only validation, unannounced errors, missing pending state, unbounded uploads, and unsafe error HTML.
- `check-form-schema.mjs` — compares schema keys with rendered field names and reports missing, extra, and required/optional drift.
