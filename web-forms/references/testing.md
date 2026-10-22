# Testing forms

Test the boundaries, not just the happy path. A form that renders is not a form that works.

## Test layers

| Layer | What to test |
| --- | --- |
| Schema | Valid input, each required field, bounds, cross-field rules, coercion |
| Server action | Auth, authorization, validation, idempotency, transactions, error mapping |
| Component | Labels, errors, pending state, value preservation, keyboard submit |
| End-to-end | Real browser, real network, no-JS path, uploads |
| Accessibility | Names, descriptions, error announcement, focus, keyboard order |

## Schema tests

```ts
test('rejects an invalid email', () => {
  const result = SignupSchema.safeParse({ email: 'nope', name: 'Ada', password: 'correct horse battery' })
  expect(result.success).toBe(false)
})
```

Cover:

- Empty strings and whitespace-only strings.
- Minimum and maximum lengths.
- Numbers as strings from `FormData`.
- Required and optional fields.
- Cross-field refinements.
- Unknown keys, if the schema is strict.
- Unicode, emoji, and right-to-left text.

## Server action tests

- Unauthenticated request is rejected.
- Authenticated but unauthorized request is rejected.
- Tenant or owner is derived from the session, not the payload.
- Invalid input returns field errors and preserved values.
- Database unique-constraint errors map to a field error.
- Successful write returns a safe result.
- Multi-row writes roll back on failure.
- Duplicate idempotency key returns the existing result.
- Sensitive values are not returned.

## Component tests

- Submit with invalid input shows errors.
- Errors are associated with fields.
- Values remain after a failed submit.
- Submit is disabled while pending.
- Double click triggers one request.
- Server errors map to the right fields.
- Keyboard-only submit works.
- Error summary receives focus.
- Success resets the form only after confirmation.

## End-to-end tests

- Slow network shows pending state.
- Network failure shows a recoverable error.
- Browser back/forward does not duplicate a submission.
- Refresh after success does not repeat the write.
- No-JS submit works if required.
- Upload rejects oversized and wrong-type files.
- Multi-step form validates each step.
- Session expiry during submit is handled.

## Idempotency tests

```ts
const first = await checkoutAction(state, formDataWithKey('key-1'))
const second = await checkoutAction(state, formDataWithKey('key-1'))
expect(first.orderId).toBe(second.orderId)
expect(await countOrders()).toBe(1)
```

Also test:

- Same key, different payload.
- Same payload, different key.
- Concurrent requests with the same key.
- A retry after a timeout.

## Accessibility tests

Use automated checks for names and ARIA, but verify manually:

- Tab through the form.
- Submit with the keyboard.
- Confirm the error summary is announced.
- Confirm focus moves to the summary or first invalid field.
- Confirm errors are not conveyed by color alone.
- Test at 200% zoom.
- Test with a screen reader if possible.

## Upload tests

- File too large.
- Wrong content type with a valid-looking extension.
- Empty file.
- Too many files.
- Path traversal filename.
- Duplicate completion.
- Cross-tenant attachment.
- Expired signed URL.
- Malicious SVG.
- Orphan cleanup.

## Test data

- Use factories with valid defaults.
- Override only the field under test.
- Keep tests independent; do not rely on order.
- Use a transaction or a unique tenant per test.
- Never use production data.
- Never assert on raw database errors.

## CI

- Run schema and action tests on every pull request.
- Run browser tests for critical forms.
- Run the form scanners as a warning first, then as a gate once clean.
- Keep the no-JS and upload tests in the critical path if the product depends on them.

## Common gaps

- Only testing the happy path.
- Testing the component but not the action.
- Testing the action but not authorization.
- Mocking the schema and therefore not testing it.
- Testing double-click only by disabling the button.
- Testing errors by text but not by association.
- Testing uploads with a fake `File` that never reaches the server.
