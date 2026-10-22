---
name: web-i18n
description: Production-grade internationalization and localization for web apps. Use when adding multiple languages, translating UI, extracting hardcoded strings, handling plurals/gender/ICU messages, locale routing, RTL layouts, localized dates/numbers/currency, hreflang/SEO, or validating translation catalogs. Framework-agnostic guidance for React, Next.js, Vue, Svelte, Astro, Remix, and vanilla JS, with next-intl, react-i18next, FormatJS, and Lingui examples.
license: MIT
---

# Web i18n

Internationalization is architecture, not a translation pass at the end. The goal is a UI that renders correctly for any locale without special cases: no concatenated sentences, no hardcoded formats, no layout that breaks when German is 35% longer or Arabic flips direction.

## When to Use This Skill

Use when the user asks to:

- Add a language, language switcher, or locale routing
- Translate an app, extract strings, or set up a translation workflow
- Fix pluralization, gender, or "1 item / 2 items" bugs
- Format dates, numbers, currency, relative time, or lists per locale
- Support RTL (Arabic, Hebrew, Persian, Urdu)
- Add hreflang, localized metadata, or multilingual sitemaps
- Review an existing i18n setup, missing keys, or translation drift
- Choose between next-intl, react-i18next, FormatJS, Lingui, or a TMS

Related references are in `references/` and scripts in `scripts/`. Read only what the task needs. Paths are relative to this skill's directory (the agent runtime prints it when the skill is loaded).

## Non-negotiables

1. **Never build a sentence by concatenating translated fragments.** Translate the whole message with placeholders: `"{count} new messages"`, not `t('new') + ' ' + count + ' ' + t('messages')`.
2. **Never use English text as the key.** Keys are stable identifiers (`inbox.unreadCount`), so copy edits do not break lookups or invalidate every translation.
3. **Every user-facing string is externalized**, including `aria-label`, `alt`, `title`, `placeholder`, validation errors, empty states, toasts, emails, push notifications, and PDF output.
4. **Never hardcode formats.** No `toFixed(2) + '$'`, no manual `MM/DD/YYYY`, no English month names, no `24h` assumptions. Use `Intl`.
5. **A locale is a BCP 47 tag**, not a language. `pt-BR` and `pt-PT`, `zh-Hans` and `zh-Hant`, `es-MX` and `es-ES` are different products. Store the full tag.
6. **Locale state must be request-scoped on the server.** Never put the current locale in a module-level mutable variable during SSR; concurrent requests will leak languages into each other.
7. **Translations are untrusted input if they come from a TMS, community, or CMS.** Never pass them to `innerHTML`/`dangerouslySetInnerHTML` without sanitizing.

## Workflow

### 1. Audit before changing code

- Detect the stack, router, and existing i18n library before proposing anything.
- Find hardcoded strings:
  ```bash
  node scripts/scan-hardcoded.mjs src
  ```
  Treat output as candidates, not gospel: skip test fixtures, constants, URLs, and developer-facing logs.
- Inventory every locale currently shipped and where catalogs live.
- Identify the highest-risk areas first: auth, checkout, errors, emails, and legal copy.

### 2. Decide the architecture (write it down)

Answer these before writing code:

| Decision | Default | Notes |
| --- | --- | --- |
| Locale strategy | Path prefix `/es/` | Best SEO and cacheability. Subdomains/ccTLDs only with a reason. |
| Default locale | Source language | Do not auto-redirect first-time visitors into a guessed locale without an override. |
| Locale detection | URL → cookie → `Accept-Language` → default | URL wins so shared links never change language. |
| Catalog format | JSON per locale per namespace | Lazy-load namespaces; never ship all locales to the client. |
| Message syntax | ICU MessageFormat | Portable across libraries and TMSs; supports plural/select/ordinal. |
| Key style | `feature.component.element` | Stable, greppable, no English text. |
| Translation source of truth | TMS or repo, not both | Pick one; sync one direction in CI. |
| Fallback | Locale chain `es-MX → es → en` | Log fallbacks in development to catch gaps. |

### 3. Externalize and structure messages

- Replace strings with semantic keys and move copy to the base locale catalog.
- Use one key per full sentence. If a sentence contains a link or bold word, use rich-text interpolation instead of splitting it.
- Keep placeholders named (`{userName}`), never positional (`{0}`).
- Do not put HTML in catalogs unless the library explicitly supports typed tags.
- Group by product surface, not by page: `checkout.json`, `auth.json`, `errors.json`.

See `references/icu.md` for plural, select, ordinal, and rich-text rules.

### 4. Wire locale routing and rendering

- Derive the locale from the route, validate it against the supported list, and 404 unknown locales rather than silently falling back.
- Provide a language switcher that preserves the current path and query string.
- Set `<html lang="...">` and `<html dir="...">` on the server-rendered document.
- Load only the active locale's catalog plus the default fallback.
- Make the same catalog available to server and client rendering; avoid duplicate or diverging translation logic.

Framework-specific setup and pitfalls: `references/frameworks.md`.
Routing, detection, hreflang, and sitemaps: `references/routing-seo.md`.

### 5. Handle locale-sensitive values

Use `Intl` (or the framework's wrapper), never manual formatting:

```ts
new Intl.NumberFormat(locale, { style: 'currency', currency }).format(amount)
new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone }).format(date)
new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(-3, 'day')
new Intl.ListFormat(locale, { type: 'conjunction' }).format(items)
new Intl.PluralRules(locale).select(count)
new Intl.Collator(locale).compare(a, b)
```

- Store timestamps in UTC; render in the user's time zone, not the server's.
- Currency is not the same as locale: a French user may pay in USD.
- Sort/search with `Intl.Collator`, not `<` or `localeCompare()` without a locale.
- Case conversion: `toLocaleUpperCase(locale)`, because Turkish `i` becomes `İ`.

### 6. Design for expansion and RTL

- Assume +30–40% text length (German, Finnish, Russian) and no fixed-width buttons or single-line labels.
- Let containers grow, allow wrapping, and test with pseudo-localization:
  ```bash
  node scripts/pseudo-localize.mjs locales/en.json --out locales/en-XA.json
  ```
- Use logical CSS properties (`margin-inline-start`, `padding-inline`, `inset-inline`) instead of `left`/`right`.
- Mirror directional icons (arrows, chevrons, progress), not logos, clocks, media controls, or checkmarks.
- Wrap user-generated inline content in `<bdi>` or `dir="auto"`.

Full RTL checklist: `references/rtl.md`.

### 7. Set up translation QA in CI

At minimum, fail the build when catalogs are structurally invalid:

```bash
node scripts/check-locales.mjs locales --base en
```

It checks missing/extra keys, empty values, placeholder mismatches, and broken ICU syntax. Add ICU compilation via your library's CLI when available:

```bash
npx formatjs compile-folder --ast locales/en locales/compiled/en
```

Add tests for plural categories, date/number output with a fixed time zone, and RTL rendering. See `references/testing.md`.

## Key decisions and traps

### Library selection

| Need | Choose |
| --- | --- |
| Next.js App Router, server components | `next-intl` |
| React SPA, mature ecosystem, many plugins | `react-i18next` |
| ICU-first, framework-agnostic, CLI extraction | `FormatJS` (`react-intl`) |
| Compile-time catalogs, small runtime, type safety | `Lingui` |
| Vue | `vue-i18n` |
| Svelte | `svelte-i18n` or `paraglide` |
| Astro | built-in i18n routing + your message library |
| Vanilla / minimal | `Intl` + a tiny catalog loader |

Do not introduce a second i18n library into an app that already has one. Extend the existing setup.

### Pluralization

Plural categories are language-specific. English has `one`/`other`; Arabic has `zero`/`one`/`two`/`few`/`many`/`other`; Japanese has only `other`. Never write `count === 1 ? ... : ...`.

```json
"inbox.unread": "{count, plural, =0 {No unread messages} one {# unread message} other {# unread messages}}"
```

### Gender and grammatical agreement

Use `select` on a gender variable, and keep the variable's value language-neutral (`female`, `male`, `neutral`, `unknown`), not localized words:

```json
"profile.greeting": "{gender, select, female {Bienvenida, {name}} male {Bienvenido, {name}} other {Bienvenido/a, {name}}}"
```

If a language needs agreement on adjectives, nouns, or articles, expose the grammatical gender/case as an argument instead of hacking the string.

### Rich text

Do not split `"Read our " + link + " terms"` into three keys. Use tag interpolation:

```json
"signup.terms": "I agree to the <link>Terms of Service</link>"
```

```tsx
t.rich('signup.terms', { link: (chunks) => <a href="/terms">{chunks}</a> })
```

### SEO

- One indexable URL per locale; never serve machine-translated content behind the same URL.
- Self-referencing `hreflang` plus `x-default`; absolute URLs; include every locale.
- Localize `<title>`, meta description, OG tags, and structured data.
- Do not combine `hreflang` with `noindex` on localized pages.

Details in `references/routing-seo.md`.

### Caching

- Locale in the path makes CDN caching straightforward. If you negotiate by header, send `Vary: Accept-Language` and expect cache fragmentation.
- Do not cache personalized language preference in a shared CDN response.
- Keep `Content-Language` consistent with the rendered locale.

## Review checklist

Before declaring i18n done:

- [ ] No hardcoded user-facing strings in components, emails, or errors
- [ ] No sentence concatenation; every message is a full translatable unit
- [ ] Keys are semantic and stable; no English text as keys
- [ ] Every placeholder exists in every locale; ICU syntax compiles
- [ ] Plurals use `Intl.PluralRules`/ICU, not `count === 1`
- [ ] Gender/agreement handled via `select`, not `"/a"` suffixes
- [ ] Dates, numbers, currency, relative time use `Intl` with explicit locale/time zone
- [ ] `<html lang>` and `dir` are correct on first paint (SSR), not set in an effect
- [ ] Locale switcher preserves path/query and works with deep links
- [ ] Unknown locale returns 404, not a silent fallback
- [ ] Layout survives +35% expansion and RTL
- [ ] `hreflang`, canonical, sitemap, and localized metadata are correct
- [ ] Catalog validation runs in CI
- [ ] Fallback behavior is intentional and observable

## Anti-patterns

- `t('hello') + ', ' + name` — fragmented sentences
- `key={englishText}` — translated text as key
- `count === 1 ? 'item' : 'items'` — English-only plural logic
- `new Date().toLocaleDateString()` without locale or time zone
- `value.toFixed(2)` for money
- `locale === 'ar' && { direction: 'rtl' }` scattered across components instead of a document-level `dir`
- Setting `<html lang>` inside `useEffect` — causes a flash and breaks crawlers
- Loading every locale into the initial bundle
- Auto-redirecting by IP with no way to override
- Translating proper nouns, product names, code identifiers, or URLs
- Machine-translating strings and shipping them unreviewed
- Assuming one catalog file scales past a few hundred keys
