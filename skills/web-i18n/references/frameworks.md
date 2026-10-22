# Framework setup

Pick the library that matches the router and rendering model. Do not run two i18n libraries in one app.

## Next.js App Router with next-intl

Recommended for App Router because it supports server components, static rendering, and typed messages.

```
app/
  [locale]/
    layout.tsx
    page.tsx
  api/
i18n/
  routing.ts
  request.ts
messages/
  en.json
  es.json
middleware.ts
```

`i18n/routing.ts`:

```ts
import { defineRouting } from 'next-intl/routing'

export const routing = defineRouting({
  locales: ['en', 'es', 'pt-BR'],
  defaultLocale: 'en',
  localePrefix: 'always',
})
```

`middleware.ts`:

```ts
import createMiddleware from 'next-intl/middleware'
import { routing } from './i18n/routing'

export default createMiddleware(routing)

export const config = {
  matcher: ['/((?!api|_next|_vercel|.*\\..*).*)'],
}
```

`i18n/request.ts`:

```ts
import { getRequestConfig } from 'next-intl/server'
import { hasLocale } from 'next-intl'
import { routing } from './routing'

export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale
  const locale = hasLocale(routing.locales, requested)
    ? requested
    : routing.defaultLocale

  return {
    locale,
    messages: (await import(`../messages/${locale}.json`)).default,
  }
})
```

Layout:

```tsx
import { NextIntlClientProvider, hasLocale } from 'next-intl'
import { notFound } from 'next/navigation'
import { setRequestLocale } from 'next-intl/server'
import { routing } from '@/i18n/routing'

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }))
}

export default async function LocaleLayout({ children, params }) {
  const { locale } = await params
  if (!hasLocale(routing.locales, locale)) notFound()
  setRequestLocale(locale)

  return (
    <html lang={locale} dir={locale === 'ar' || locale === 'he' ? 'rtl' : 'ltr'}>
      <body>
        <NextIntlClientProvider>{children}</NextIntlClientProvider>
      </body>
    </html>
  )
}
```

Pitfalls:

- `params` is a Promise in Next.js 15+. Always `await params` in layouts, pages, and `generateMetadata`.
- Call `setRequestLocale(locale)` in every statically rendered page/layout, or static rendering falls back to dynamic.
- Do not read `cookies()` or `headers()` in the root layout if you want static rendering; use middleware for detection.
- Keep `NextIntlClientProvider` messages small. By default it serializes all messages; pass only the namespaces client components need.
- `useTranslations` only works in client components below the provider; server components use `getTranslations`.
- For rich text, use `t.rich` and return React nodes, never HTML strings.
- Localized `<Link>` comes from `@/i18n/navigation` (`createNavigation(routing)`), not `next/link`.

Metadata:

```ts
export async function generateMetadata({ params }) {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'meta' })
  return {
    title: t('title'),
    description: t('description'),
    alternates: {
      languages: { en: '/en', es: '/es', 'x-default': '/en' },
    },
  }
}
```

## React SPA with react-i18next

```ts
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import HttpBackend from 'i18next-http-backend'
import LanguageDetector from 'i18next-browser-languagedetector'

i18n
  .use(HttpBackend)
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    fallbackLng: 'en',
    supportedLngs: ['en', 'es', 'pt-BR'],
    ns: ['common', 'checkout'],
    defaultNS: 'common',
    interpolation: { escapeValue: false },
    returnNull: false,
    detection: {
      order: ['path', 'cookie', 'navigator'],
      caches: ['cookie'],
    },
  })
```

```tsx
const { t } = useTranslation('checkout')
return <h1>{t('title', { count })}</h1>
```

Pitfalls:

- `keySeparator` defaults to `.` and `nsSeparator` to `:`. Keys containing dots or colons will be split. Either rename keys or set separators to `false`.
- `escapeValue: false` is standard in React because React escapes, but it means catalogs must never be injected with `dangerouslySetInnerHTML`.
- Use `<Trans>` for embedded links/components, not string concatenation.
- Lazy-load namespaces; the backend plugin fetches one file per namespace per language.
- In SSR, create a fresh i18next instance per request. A shared module singleton leaks the language between concurrent users.
- `i18next-parser` extracts keys from `t()` calls. Dynamic keys (`t(variable)`) cannot be extracted; list them in the parser config.

## FormatJS / react-intl

```tsx
import { IntlProvider, FormattedMessage, useIntl } from 'react-intl'
import en from './compiled/en.json'

<IntlProvider locale={locale} messages={en} defaultLocale="en">
  <App />
</IntlProvider>
```

```tsx
const intl = useIntl()
intl.formatMessage({ id: 'cart.items' }, { count })
```

Workflow:

```bash
npx formatjs extract 'src/**/*.{ts,tsx}' --out-file temp.json
npx formatjs compile temp.json --ast --out-file compiled/en.json
```

Pitfalls:

- Use explicit `id`s and keep `defaultMessage` as the source copy. Auto-generated ids from `defaultMessage` change when copy changes and silently orphan translations.
- Compile to AST for production to skip parsing at runtime.
- `IntlProvider` must wrap every component that calls `useIntl`.
- Rich text: pass React elements in `values` and reference them as `<tag>...</tag>`; do not split messages.

## Lingui

```tsx
import { msg } from '@lingui/core/macro'
import { Trans } from '@lingui/react/macro'

const title = msg`Checkout`
;<Trans>You have {count} items</Trans>
```

- Macros are extracted at build time and compiled into small runtime catalogs.
- Requires the Lingui SWC/Babel plugin and a compile step (`lingui compile`).
- Great when bundle size and type safety matter; less flexible for runtime-edited copy.

## Vue

```ts
import { createI18n } from 'vue-i18n'
import en from './locales/en.json'

const i18n = createI18n({
  legacy: false,
  locale: 'en',
  fallbackLocale: 'en',
  messages: { en },
})
```

- Use Composition API mode (`legacy: false`).
- vue-i18n uses pipe plural syntax (`"no items | one item | {count} items"`), which is **not** ICU. If your TMS expects ICU, enable/verify the message compiler format or normalize at the boundary.
- Load locale messages lazily with dynamic imports.

## Svelte

- `svelte-i18n`: runtime dictionaries, `$_('key')`, locale store.
- `paraglide` (inlang): compile-time functions, tree-shaken, type-safe. Preferred for new SvelteKit apps.
- Keep locale in the URL for SSR and SEO.

## Astro

Astro has built-in i18n routing:

```js
// astro.config.mjs
export default defineConfig({
  i18n: {
    defaultLocale: 'en',
    locales: ['en', 'es', 'pt-BR'],
    routing: { prefixDefaultLocale: true },
  },
})
```

Use `getRelativeLocaleUrl(locale, path)` for links, and your message library for strings. Astro islands need the locale passed as a prop; do not rely on a global.

## Vanilla JS

```ts
const catalogs = new Map<string, Record<string, string>>()

async function load(locale: string) {
  if (!catalogs.has(locale)) {
    catalogs.set(locale, await fetch(`/locales/${locale}.json`).then((r) => r.json()))
  }
  return catalogs.get(locale)!
}
```

Use `Intl` directly for numbers/dates/plurals, and a small ICU renderer (`@formatjs/intl-messageformat`) if you need plural/select. Do not hand-roll plural logic.

## SSR and hydration

- Locale must be known on the server and serialized to the client. Never detect it only in `useEffect`.
- Date and number output can differ between server and browser if the time zone differs. Pass an explicit `timeZone` or format on the server only.
- Hydration mismatches are usually a symptom of a module-level locale singleton or a client-only locale detector. Fix the source, do not add `suppressHydrationWarning`.
- Set `<html lang>` and `dir` in the server-rendered document.
- Make sure the fallback chain is identical on server and client, or the first render will differ.
