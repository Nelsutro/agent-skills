# React forms

Use the project's existing form stack. If it has no stack, prefer React Hook Form with a shared Zod schema for client-heavy forms, and server actions with `useActionState` for server-driven forms.

## Shared schema

```ts
export const SignupSchema = z.object({
  email: z.string().trim().email(),
  name: z.string().trim().min(1).max(120),
  password: z.string().min(12).max(200),
})

export type SignupInput = z.infer<typeof SignupSchema>
```

Import the same schema in the client component and the server action. Do not create a second validator.

## React Hook Form + Zod

```tsx
const form = useForm<SignupInput>({
  resolver: zodResolver(SignupSchema),
  defaultValues: { email: '', name: '', password: '' },
})

return (
  <form onSubmit={form.handleSubmit(onSubmit)} noValidate>
    <Field
      label="Email"
      error={form.formState.errors.email?.message}
      {...form.register('email')}
    />
    <button type="submit" disabled={form.formState.isSubmitting}>
      {form.formState.isSubmitting ? 'Creating account...' : 'Create account'}
    </button>
  </form>
)
```

- `noValidate` disables browser bubbles so your accessible errors are the only source of feedback.
- Keep the submit button enabled while the form is invalid; let validation run on submit.
- Disable only while submitting.
- Use `form.setError` to map server errors back to fields.
- Do not call `form.reset()` after a failed submit.

## Server actions

```tsx
const [state, action, pending] = useActionState(signupAction, initialState)

return (
  <form action={action} noValidate>
    <Field
      name="email"
      label="Email"
      defaultValue={state.values?.email}
      error={state.errors?.email?.[0]}
    />
    <SubmitButton pending={pending} />
  </form>
)
```

`useActionState` gives you the returned state and a pending flag. Use it instead of duplicating loading state.

```tsx
function SubmitButton({ pending }: { pending: boolean }) {
  return (
    <button type="submit" disabled={pending} aria-busy={pending}>
      {pending ? 'Saving...' : 'Save'}
    </button>
  )
}
```

A child using `useFormStatus` works too, but `useActionState` is usually simpler.

## Server error mapping

Return errors keyed by field:

```ts
if (error.code === 'P2002' && error.meta?.target?.includes('email')) {
  return { ok: false, errors: { email: ['email_in_use'] } }
}
```

Then:

```tsx
useEffect(() => {
  if (!state.errors) return
  for (const [field, messages] of Object.entries(state.errors)) {
    form.setError(field as keyof SignupInput, { message: messages?.[0] })
  }
}, [state, form])
```

Do not show raw server messages to users. Map them to safe copy.

## Default values and controlled inputs

- Prefer uncontrolled inputs with `defaultValue`; they are simpler and work with `FormData`.
- Use `Controller` for custom components that do not forward refs.
- Use `useWatch` only for values the UI actually needs.
- Avoid storing every keystroke in a global store.

## Field arrays

```tsx
const { fields, append, remove } = useFieldArray({ control: form.control, name: 'items' })
```

- Give each row a stable server-compatible identifier.
- Validate the array length and each item on the server.
- Do not trust the array order or IDs from the client.
- Recompute prices and eligibility on the server.

## Multi-step

- Keep step state in the URL or a server draft, not only in component state.
- Validate the current step on the server before advancing.
- Persist drafts with an owner and expiry.
- Make the final submit idempotent.

## Optimistic UI

`useOptimistic` is appropriate for reversible, low-risk updates. It must never be the source of truth for money, permissions, or irreversible writes.

- Keep the previous state.
- Reconcile on the server response.
- Roll back on error.
- Do not show a success state before the server confirms it.

## Accessibility wiring

```tsx
function Field({ label, error, id, ...props }: FieldProps) {
  const inputId = id ?? props.name
  const errorId = `${inputId}-error`

  return (
    <div>
      <label htmlFor={inputId}>{label}</label>
      <input
        id={inputId}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        {...props}
      />
      {error ? <p id={errorId} role="alert">{error}</p> : null}
    </div>
  )
}
```

- Use `role="alert"` for errors that appear after submit.
- Keep descriptions associated with `aria-describedby`.
- Do not rely on `placeholder` as a label.

## Testing React forms

- Test the action separately from the component.
- Test the component with a failing action and assert values are preserved.
- Test keyboard submission and error focus.
- Test double click with a delayed action.
- Test no-JS behavior if the product supports it.

Use the project's existing test runner. Do not add a second one for the skill.
