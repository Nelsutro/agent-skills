# Translation workflow

A catalog that is not maintained is worse than no catalog: it grows stale, falls back silently, and ships mixed-language UI.

## Source of truth

Pick exactly one:

1. **Repo-first** — catalogs live in git; translators get PRs or a sync branch from a TMS.
2. **TMS-first** — the translation management system owns strings; the app pulls compiled catalogs at build time.

Never let both sides edit independently. Define the direction:

- Source locale: edited only in the repo.
- Target locales: edited only in the TMS.
- Sync: CI exports source → TMS, imports translations → repo (or fetch at build).

## Key naming

Pattern: `domain.component.element`, lowercase, dot-separated.

```
checkout.summary.total
checkout.summary.taxIncluded
auth.login.submit
auth.errors.invalidCredentials
common.actions.cancel
```

Rules:

- Semantic and stable. `checkout.submit` survives copy changes; `"Pay now"` does not.
- Never reuse a key for a different meaning across contexts. `common.actions.close` is fine only if every use means the same action.
- Do not encode the English copy in the key (`button.pay_now` is acceptable; `button.click_here_to_pay_now` is not).
- Avoid keys that include counts or test data.
- Keep hierarchy shallow (3–4 segments). Deep nesting makes extraction and review harder.
- Sort keys consistently to reduce merge conflicts.

## Context for translators

Every non-obvious string needs context. Provide:

- Where it appears (screen, component)
- What it does (button, label, error, empty state)
- Character/space constraints (button width, tab label)
- Whether it is a sentence fragment, a title, or a full sentence
- The value and meaning of each placeholder
- Screenshots for visual context
- Notes for ambiguous terms (`book` verb vs noun, `account` billing vs profile)

In ICU/JSON catalogs, use the library's description mechanism:

```ts
msg({ id: 'checkout.submit', description: 'Primary CTA on the checkout summary; max ~24 chars' })
```

For plain JSON, keep a sibling `_meta` file or use TMS descriptions.

## Placeholders and code

- Never translate placeholder names: `{userName}` stays `{userName}`.
- Never translate code, URLs, file paths, API names, or product names marked as do-not-translate.
- Protect inline tags (`<link>`, `<b>`) and keep them balanced.
- Do not add punctuation inside placeholders.
- If a language needs a different word order, translators must reorder placeholders, not split the message.

## Plural and gender briefs

Tell translators:

- Which plural categories their language requires
- That `other` is mandatory
- That they may add branches (`zero`, `two`, `few`, `many`)
- The meaning of `=0`/`=1` exact matches
- The gender values and what each represents
- Whether the product voice is formal or informal (`tú` vs `usted`, `du` vs `Sie`)

Do not send an English plural message with only `one`/`other` and expect Arabic or Polish to be correct.

## String freeze and release

- Freeze source strings before a translation cycle; late changes create orphan keys.
- Rename keys only with a migration that maps old → new; never silently drop translations.
- Track coverage per locale and per namespace.
- Block releases only on critical namespaces (auth, checkout, errors, legal), not on 100% coverage of everything.
- Treat missing translations as a visible development warning, not a silent English fallback in production.

## Machine translation

- MT is a draft, not a release. Require human review for UI, legal, medical, financial, and marketing copy.
- Never index unreviewed MT at scale; it cannibalizes the source locale and damages trust.
- Post-edit for terminology, placeholders, length, and tone.
- Keep a glossary so product terms stay consistent across locales and vendors.

## QA levels

1. **Automated**: key parity, placeholder parity, ICU parse, empty values, tag balance.
2. **Linguistic**: native review for grammar, gender, plurals, tone, terminology.
3. **In-context**: screenshot/visual review with pseudo-localization and the longest locale.
4. **Functional**: switch locale, deep links, forms, emails, errors, PDFs.
5. **Market**: local conventions (date format, currency, address, phone, legal).

## Glossary and style guide

Maintain per locale:

- Product and feature names (translated or not)
- Formality level
- Date/number/currency conventions
- Capitalization rules (English title case does not transfer)
- Punctuation conventions (French spacing before `:`, `?`, `!`; Spanish inverted `¿`/`¡`)
- Preferred terminology and banned terms
- Tone and reading level

## Files and namespaces

```
messages/
  en/
    common.json
    auth.json
    checkout.json
    errors.json
  es/
    common.json
    auth.json
    checkout.json
    errors.json
```

- One namespace per product surface.
- Lazy-load by route; keep the initial payload small.
- Avoid a single 5,000-key `translation.json`.
- Keep the base locale complete; target locales may lag.
- Do not commit compiled artifacts and source catalogs in the same directory.

## CI flow

```yaml
- run: node scripts/check-locales.mjs messages --base en
- run: node scripts/pseudo-localize.mjs messages/en/common.json --out messages/en-XA/common.json
- run: npx formatjs compile-folder --ast messages/en messages/compiled/en
- run: npm test -- i18n
```

Optional:

- Detect new hardcoded strings with `scan-hardcoded.mjs` and fail on regressions in touched files.
- Diff key counts and warn when a target locale loses keys.
- Post coverage as a PR comment.

## Roles

- **Developer**: externalizes strings, provides keys and context, keeps catalogs valid.
- **Translator**: owns target-locale copy, plural/gender branches, terminology.
- **Reviewer**: native linguistic QA plus in-context review.
- **Owner**: decides locales, fallback policy, and release gates.

## Anti-patterns

- Translating in a spreadsheet with no keys
- Letting developers edit target locales by hand in production repos
- Shipping `TODO` or empty strings
- Reusing one key for unrelated meanings
- Sending strings without screenshots or context
- Treating MT output as final
- Measuring success only by coverage percentage, not by quality
- Changing English copy without updating the key's meaning or description
