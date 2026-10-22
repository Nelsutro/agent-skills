# Accessible forms

Accessibility is not a coat of paint. It changes the markup, the error flow, and the submit behavior.

## Labels and names

Every control needs an accessible name.

```html
<label for="email">Email</label>
<input id="email" name="email" type="email" autocomplete="email" />
```

- Associate labels with `for` and `id`.
- Do not use placeholder text as the only label.
- Use `aria-label` only when a visible label is impossible.
- Use `aria-labelledby` when the label is composed of existing text.
- Group related controls with `<fieldset>` and `<legend>`.

## Required fields

- Mark required fields in visible text, not only with an asterisk.
- Keep `required` for native semantics, but do not rely on it for validation.
- If a field is optional, say so when most fields are required.
- Do not use color alone to indicate required or invalid.

## Descriptions

Use `aria-describedby` for hints and errors:

```html
<label for="password">Password</label>
<input
  id="password"
  name="password"
  type="password"
  aria-describedby="password-hint password-error"
  aria-invalid="true"
/>
<p id="password-hint">At least 12 characters.</p>
<p id="password-error" role="alert">Password is too short.</p>
```

- Keep hint and error IDs stable.
- Do not put the same text in both a tooltip and a description.
- Do not describe a field only with an icon.

## Error summary

After a failed submit:

- Render a summary at the top of the form.
- Link each error to the field.
- Move focus to the summary or the first invalid field.
- Announce the summary with `role="alert"` or a live region.
- Keep the user's values.

```html
<div role="alert" tabindex="-1" id="form-errors">
  <h2>There are 2 problems with this form</h2>
  <ul>
    <li><a href="#email">Enter a valid email address</a></li>
    <li><a href="#password">Password must be at least 12 characters</a></li>
  </ul>
</div>
```

Use `tabindex="-1"` so the summary can receive focus without joining the tab order.

## Live regions

- Use `role="alert"` for errors that appear after an action.
- Use `aria-live="polite"` for status messages such as "Saving..." or "Saved".
- Do not announce every keystroke.
- Avoid duplicate announcements from both a field error and a summary.
- Keep the live region in the DOM before the message appears.

## Focus management

- Move focus to the error summary or first invalid field after a failed submit.
- Do not move focus on every validation change.
- Return focus to the submit button after a successful inline action.
- Keep the focus ring visible.
- Do not use `outline: none` without a replacement.

## Autofill

Use the correct `autocomplete` tokens:

| Field | Token |
| --- | --- |
| Name | `name` |
| Email | `email` |
| Username | `username` |
| Current password | `current-password` |
| New password | `new-password` |
| One-time code | `one-time-code` |
| Street address | `street-address` |
| Postal code | `postal-code` |
| Country | `country-name` |
| Credit card number | `cc-number` |
| Credit card expiry | `cc-exp` |
| Credit card security code | `cc-csc` |

Do not block paste in password or code fields.

## Target size and spacing

- Controls should be large enough to tap comfortably.
- Keep labels clickable.
- Do not put controls so close that touch targets overlap.
- Avoid custom controls that lose keyboard behavior.

## Color and contrast

- Error text must meet contrast requirements.
- Do not use red/green as the only signal.
- Keep focus indicators visible against the background.
- Test in forced-colors mode when possible.

## Motion and timing

- Do not auto-submit on a timer.
- Do not expire a session without warning and a way to recover.
- Avoid unnecessary animations during submit.
- Respect `prefers-reduced-motion`.

## Screen reader checklist

- The form has a heading and a purpose.
- Each field announces its label, type, required state, and error.
- The error summary is announced once.
- The pending state is announced without flooding.
- Success is announced.
- The form can be completed with a keyboard only.

## Common failures

- `<input placeholder="Email">` with no label.
- `<span class="error">Invalid</span>` with no association.
- `aria-invalid` set but no error text.
- Error text present but no live region or focus move.
- Submit disabled while the form is invalid.
- `div` used as a button.
- Custom select without keyboard support.
- Error color removed in dark mode.
- Form reset after a failed submit.
