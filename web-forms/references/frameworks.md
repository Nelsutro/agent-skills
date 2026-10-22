# Framework patterns

The principles are the same everywhere: validate on the server, share the schema, preserve input, make errors accessible, and make submit idempotent. The wiring differs.

## Next.js App Router

```tsx
export default function Page() {
  return (
    <form action={signupAction} noValidate>
      <Field name="email" label="Email" />
      <SubmitButton />
    </form>
  )
}
```

- Server Actions are the default for mutations.
- Use `useActionState` for returned errors and pending state.
- Use `revalidatePath` or `revalidateTag` after a successful write.
- Never import server-only modules into a client component.
- Do not put secrets in `NEXT_PUBLIC_*`.

## React Router

```tsx
export async function action({ request }: ActionFunctionArgs) {
  const formData = await request.formData()
  const parsed = SignupSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) {
    return { ok: false, errors: parsed.error.flatten().fieldErrors }
  }
  await createUser(parsed.data)
  return redirect('/welcome')
}
```

- Actions run on the server in framework mode.
- Use `useNavigation` for pending state.
- Use `useFetcher` for forms that should not navigate.
- Return field errors, not thrown strings.

## Remix and Conform

- Remix actions receive a `Request`; parse `formData` at the top.
- Conform is a good fit for progressive enhancement and schema integration.
- Use `useActionData` for errors and `useNavigation` for pending state.
- Keep the schema in a shared module.
- Test the no-JS path; Remix supports it by default.

## SvelteKit

```ts
export const actions = {
  default: async ({ request }) => {
    const formData = await request.formData()
    const parsed = SignupSchema.safeParse(Object.fromEntries(formData))
    if (!parsed.success) {
      return fail(400, {
        values: Object.fromEntries(formData),
        errors: parsed.error.flatten().fieldErrors,
      })
    }
    await createUser(parsed.data)
    return { ok: true }
  },
}
```

- Use `use:enhance` for pending UI and client validation.
- Return `fail(400, ...)` with values and errors.
- Do not trust `event.locals` without verifying the session.

## Vue

- Use VeeValidate with a Zod or Valibot schema for client UX.
- Post to a server endpoint that parses the same schema.
- Use `useField` and `useForm` for field state.
- Map server errors with `setErrors`.
- Keep the submit idempotency key in the payload and enforce it on the server.

## Astro

- Prefer native HTML forms posting to an endpoint or action.
- Hydrate only the interactive parts.
- Parse `FormData` on the server with the shared schema.
- Render errors server-side with preserved values.
- Add client-side validation as an enhancement, not a requirement.

## Plain HTML

```html
<form method="post" action="/signup" novalidate>
  <label for="email">Email</label>
  <input id="email" name="email" type="email" autocomplete="email" required />
  <button type="submit">Create account</button>
</form>
```

- Native forms are the baseline; they work without JavaScript.
- `novalidate` is optional. If you keep native validation, still validate on the server.
- Return a full HTML response with errors and values on failure.
- Use `aria-invalid` and `aria-describedby` in the server-rendered response.

## Progressive enhancement checklist

- The form has a real `action` and `method`.
- The server returns errors in HTML, not only JSON.
- Values are preserved after a failed submit.
- Focus moves to the error summary after a failed submit.
- The submit button has a pending state when JavaScript is available.
- The no-JS path is tested.

## Framework selection traps

- Do not add React Hook Form to a SvelteKit app.
- Do not add Conform to a codebase that already uses React Hook Form consistently.
- Do not mix server actions and API routes for the same form.
- Do not duplicate the schema across client and server bundles.
- Do not assume a framework's client-side router guard is authorization.
