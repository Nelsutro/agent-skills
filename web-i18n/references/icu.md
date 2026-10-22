# ICU MessageFormat

ICU MessageFormat is the portable message syntax used by FormatJS, next-intl, Lingui, i18next (ICU mode), Phrase, Crowdin, Lokalise, and Weblate. Learn it once and the knowledge transfers.

## Core syntax

```json
{
  "greeting": "Hello, {name}",
  "files": "{count, plural, =0 {No files} one {# file} other {# files}}",
  "invite": "{gender, select, female {She} male {He} other {They}} invited you",
  "rank": "{place, selectordinal, one {#st} two {#nd} few {#rd} other {#th}} place",
  "price": "Total: {amount, number, ::currency/USD}",
  "due": "Due {date, date, medium} at {date, time, short}"
}
```

| Form | Meaning |
| --- | --- |
| `{name}` | Simple argument |
| `{n, number}` | Locale-formatted number |
| `{n, number, percent}` | Percent |
| `{n, number, ::currency/EUR}` | Currency skeleton |
| `{d, date, short}` / `medium` / `long` / `full` | Date |
| `{d, time, short}` | Time |
| `{n, plural, ...}` | Cardinal plural |
| `{n, selectordinal, ...}` | Ordinal |
| `{v, select, ...}` | Enum/branch (gender, status, plan) |

## Plural rules

The `plural` argument selects a **CLDR plural category**, not a number:

- `zero`, `one`, `two`, `few`, `many`, `other`
- `other` is mandatory in every language.
- Exact matches `=0`, `=1`, `=2` are allowed and take precedence over categories.
- `#` inside a plural branch renders the number with the message's locale formatting. Prefer `#` over repeating `{count}`.
- Categories differ by language. Never assume `one` and `other` are enough.

Examples:

| Locale | Categories used |
| --- | --- |
| `en`, `de`, `es`, `it` | `one`, `other` |
| `fr` | `one`, `many`, `other` (and `one` includes 0) |
| `pl`, `ru`, `uk` | `one`, `few`, `many`, `other` |
| `ar` | `zero`, `one`, `two`, `few`, `many`, `other` |
| `ja`, `zh`, `ko`, `th`, `vi` | `other` only |
| `cy` | `zero`, `one`, `two`, `few`, `many`, `other` |

Do not translate a plural message by copying the English branches. Translators need to add the categories their language requires. Provide the full list of possible categories in the TMS brief, and allow branches to be added.

### Offset

```json
"guests": "{count, plural, offset:1 =0 {Nobody came} =1 {Only {host}} one {{host} and # guest} other {{host} and # guests}}"
```

`offset` subtracts from `#`, which is useful for "you and N others". Use sparingly; it is easy to get wrong.

## Select (gender, status, variants)

`select` branches on an exact string value. Keys are case-sensitive and must not contain whitespace or punctuation that breaks ICU identifiers.

```json
"assigned": "{role, select, owner {You own this} admin {An admin owns this} other {Assigned}}"
```

For grammatical gender, pass a **semantic** value (`female`, `male`, `neutral`, `unknown`) rather than a localized word. The translator decides the wording for each branch.

Some languages need agreement beyond the subject (adjective endings, articles, cases). Expose the required grammatical features as separate arguments, or restructure the copy to avoid agreement. Do not encode grammar in the key.

## Ordinals

`selectordinal` uses ordinal plural categories, which also vary by language:

```json
"position": "{n, selectordinal, one {#st} two {#nd} few {#rd} other {#th}}"
```

English needs `one`/`two`/`few`/`other`; many languages use only `other`. For "1st, 2nd, 3rd" in a language with a different system, translators must be able to rewrite the branch.

## Number and date skeletons

Skeletons after `::` are ICU number/date skeletons:

```json
"compact": "{n, number, ::compact-short}",
"percent": "{n, number, ::percent}",
"currency": "{n, number, ::currency/JPY}",
```

Support varies by library version. If a skeleton is unsupported, format the value in code with `Intl.NumberFormat` and pass the resulting string:

```ts
t('price', { amount: new Intl.NumberFormat(locale, {
  style: 'currency', currency, currencyDisplay: 'narrowSymbol'
}).format(value) })
```

Date/time arguments in ICU are limited and do not carry a time zone. For anything user-facing with time zones, format with `Intl.DateTimeFormat` using an explicit `timeZone` and pass a string.

## Apostrophes and escaping

ICU uses the apostrophe as a quoting character:

- `'{'` renders a literal `{`.
- `''` renders a literal `'`.
- An apostrophe only starts quoting when followed by `{`, `}`, or `#`.

This bites languages that use apostrophes heavily (French, Italian, Catalan). `"l'utilisateur"` is safe, but `"l'{utilisateur}"` would try to quote. When in doubt, double the apostrophe or use the library's `ignoreTag`/apostrophe mode setting. Always compile catalogs in CI to catch this.

## Rich text and tags

ICU itself has no HTML. Libraries add tag support:

- next-intl: `<link>...</link>` with `t.rich`
- react-intl: `<b>...</b>` with rich text elements in `values`
- i18next: `<1>...</1>` or named `<link>...</link>` with `<Trans>`

Keep tags balanced, use named tags rather than numeric indexes, and never interpolate raw HTML from a catalog.

```json
"signup.terms": "I agree to the <link>Terms</link> and <privacy>Privacy Policy</privacy>."
```

```tsx
t.rich('signup.terms', {
  link: (chunks) => <a href="/terms">{chunks}</a>,
  privacy: (chunks) => <a href="/privacy">{chunks}</a>,
})
```

## Argument naming

- Use `camelCase` identifiers: `{userName}`, `{itemCount}`.
- Never use positional placeholders (`{0}`) for new code; they obscure intent and are hard to validate.
- Keep one meaning per name. `{name}` should always mean the same kind of value in a catalog.
- Do not reuse a name for both a plural count and a select value.

## Validation

Parse every catalog with the ICU parser before shipping:

```bash
npx formatjs compile-folder --ast messages/en messages/compiled/en
```

Or programmatically:

```ts
import { parse } from '@formatjs/icu-messageformat-parser'
parse(message, { requiresOtherClause: true })
```

Rules to enforce:

1. Syntax parses.
2. Every `plural` has an `other` branch.
3. Placeholder names match the base locale exactly.
4. No argument is used in a branch where it is undefined.
5. No empty messages.
6. Tags are balanced and known to the renderer.

`scripts/check-locales.mjs` implements checks 1–5 without dependencies (it uses the FormatJS parser when available).
