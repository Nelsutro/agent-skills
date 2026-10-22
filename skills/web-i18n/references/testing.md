# Testing i18n

Test the parts that break silently: catalog structure, plural categories, locale-sensitive formatting, direction, and routing.

## Automated catalog checks

Run on every PR:

```bash
node scripts/check-locales.mjs messages --base en
```

It catches:

- Missing keys in a target locale
- Keys that no longer exist in the base
- Empty values
- Placeholder set mismatches (including plural/select variables)
- Unbalanced braces and invalid ICU structure
- Missing `other` branch in plurals

Extend with the real ICU parser when available:

```ts
import { parse } from '@formatjs/icu-messageformat-parser'

test.each(Object.entries(catalog))('%s parses', (_key, message) => {
  expect(() => parse(message, { requiresOtherClause: true })).not.toThrow()
})
```

## Unit tests

### Rendering and interpolation

```ts
expect(t('inbox.unread', { count: 0 })).toBe('No unread messages')
expect(t('inbox.unread', { count: 1 })).toBe('1 unread message')
expect(t('inbox.unread', { count: 5 })).toBe('5 unread messages')
```

Cover every branch the message defines, not just 0/1/2.

### Plural categories by locale

```ts
const cases = {
  en: { 0: 'other', 1: 'one', 2: 'other' },
  pl: { 1: 'one', 2: 'few', 5: 'many', 22: 'few', 25: 'many' },
  ar: { 0: 'zero', 1: 'one', 2: 'two', 3: 'few', 11: 'many', 100: 'other' },
  ja: { 0: 'other', 1: 'other', 5: 'other' },
}

for (const [locale, expected] of Object.entries(cases)) {
  const rules = new Intl.PluralRules(locale)
  for (const [n, category] of Object.entries(expected)) {
    expect(rules.select(Number(n))).toBe(category)
  }
}
```

### Dates, numbers, and currency

Pin locale and time zone; never depend on the machine.

```ts
const format = (value: number, locale: string) =>
  new Intl.NumberFormat(locale, { style: 'currency', currency: 'EUR' }).format(value)

expect(format(1234.5, 'de-DE')).toMatch(/1\.234,50/)
expect(format(1234.5, 'en-US')).toMatch(/1,234\.50/)

const date = new Date('2026-01-15T12:00:00Z')
expect(new Intl.DateTimeFormat('en-GB', {
  dateStyle: 'short', timeZone: 'UTC',
}).format(date)).toBe('15/01/2026')
```

Test at least one RTL locale, one decimal-comma locale, and one CJK locale.

### Rich text

Render the message to a component tree and assert:

- The link points to the right href
- Text outside and inside the tag is correct
- No HTML string is injected

```tsx
render(<Terms />)
expect(screen.getByRole('link', { name: 'Terms' })).toHaveAttribute('href', '/terms')
```

## Integration tests

- Switching locale updates the URL, `<html lang>`, and visible copy.
- A deep link to `/es/checkout` renders Spanish on first paint (SSR), not after hydration.
- The switcher preserves path and query string: `/es/precios?plan=pro` → `/en/pricing?plan=pro`.
- Unknown locale (`/xx/`) returns 404.
- A missing key in a target locale falls back according to policy and logs a warning in development.
- Reloading keeps the explicit choice (cookie), and does not get overridden by `Accept-Language`.
- Server-rendered and client-rendered output match (no hydration warnings).

## E2E and visual tests

Playwright:

```ts
test('RTL layout and locale switch', async ({ page }) => {
  await page.goto('/ar/')
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl')
  await expect(page.locator('html')).toHaveAttribute('lang', 'ar')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()

  await page.getByRole('button', { name: /english/i }).click()
  await expect(page).toHaveURL(/\/en\//)
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr')
})
```

Visual regression matrix:

| Case | Why |
| --- | --- |
| `en-US` baseline | Reference |
| `de-DE` | Long compounds, expansion |
| `fr-FR` | Long sentences, punctuation spacing |
| `es-MX` | Accents, expansion |
| `ar` | RTL, shaping, different font metrics |
| `he` | RTL, mixed digits |
| `ja` | CJK line breaking, no spaces |
| `en-XA` pseudo-locale | Catches truncation and concatenation before translation |
| `ru` | Cyrillic width, plural forms |

Screenshot mobile and desktop. Check:

- Buttons and tabs do not clip
- Text does not overflow cards
- Nav items wrap instead of colliding
- Tables stay readable
- Fixed-width badges and chips still fit
- Icons are mirrored correctly in RTL

## Accessibility tests

- `<html lang>` matches the content language.
- Reading order in the DOM matches visual order in RTL.
- `aria-label` and `alt` are translated, not English.
- Form errors are announced and localized.
- Focus order is not reversed accidentally.
- Screen reader pronunciation: run an axe scan with the locale set, and spot-check with a screen reader if available.

## Performance checks

- Only the active locale is loaded on first render.
- Namespaces are code-split per route.
- Changing locale does not reload the whole app unnecessarily.
- Compiled catalogs are used in production (FormatJS AST, Lingui compile, paraglide functions).
- The default locale is not duplicated into every chunk.

## CI recipe

```yaml
name: i18n
on: [pull_request]
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: npm ci
      - run: node scripts/check-locales.mjs messages --base en
      - run: npx formatjs compile-folder --ast messages/en messages/compiled/en
      - run: npm test -- --run i18n
```

## What not to test

- Exact whitespace in every translation (brittle).
- Every locale for every component (combinatorial explosion).
- Third-party `Intl` output character-by-character (test behavior, not CLDR data).
- Snapshot files of entire pages in every locale (noise; use targeted visual diffs).
