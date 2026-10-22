# Locale routing, detection, and SEO

## URL strategy

| Strategy | Example | Pros | Cons |
| --- | --- | --- | --- |
| Path prefix | `example.com/es/precios` | One domain, easy CDN, best default | Slightly longer URLs |
| Subdomain | `es.example.com` | Clean separation, separate infra | Splits domain authority, more setup |
| ccTLD | `example.es` | Strong local signal | Expensive, separate properties |
| Query param | `example.com/?lang=es` | Trivial to add | Weak SEO, cache confusion, ugly |

**Default to path prefixes.** They keep all locales on one origin, cache cleanly, and are trivial to hreflang. Use subdomains or ccTLDs only for legal, organizational, or market reasons.

Keep the default locale prefix behavior consistent:

- `prefixDefaultLocale: true` → `/en/...` and `/es/...`. Simplest and most explicit.
- `false` → `/...` for default, `/es/...` for others. Acceptable, but be consistent and canonicalize the duplicate (`/en/` → `/`).

Never serve the same content on `/es/` and `?lang=es`. Pick one canonical URL per locale.

## Detection and negotiation

Recommended order:

1. **URL prefix** — authoritative. A shared link must never change language.
2. **User preference cookie** — set by the language switcher.
3. **`Accept-Language`** — best-effort for first-time visitors.
4. **Default locale**.

Algorithm:

```
request /            -> 302 to /{negotiated}
request /es/precios  -> render es
request /xx/...      -> 404 (do not silently render default on an unknown prefix)
```

Negotiation must respect the supported set and fall back through the locale chain:

```
es-MX -> es -> en
pt-BR -> pt -> en
zh-Hant-TW -> zh-Hant -> zh -> en
```

Use the browser's quality values, not the first header entry:

```ts
function negotiate(acceptLanguage: string, supported: string[], fallback: string) {
  const ranked = acceptLanguage
    .split(',')
    .map((part) => {
      const [tag, ...params] = part.trim().split(';')
      const q = params.find((p) => p.trim().startsWith('q='))
      return { tag: tag.toLowerCase(), q: q ? Number(q.split('=')[1]) : 1 }
    })
    .sort((a, b) => b.q - a.q)

  for (const { tag } of ranked) {
    if (supported.includes(tag)) return tag
    const base = tag.split('-')[0]
    const match = supported.find((s) => s === base || s.startsWith(base + '-'))
    if (match) return match
  }
  return fallback
}
```

Rules:

- Do not auto-redirect to a guessed locale on every request. Redirect once at the root, then stop.
- Always give an explicit language switcher; never trap the user in a guessed language.
- Persist the choice in a cookie (`NEXT_LOCALE`, `locale`) with `Path=/`, `SameSite=Lax`, long `Max-Age`.
- If you negotiate on `Accept-Language`, send `Vary: Accept-Language`. Prefer redirecting to a URL so the response itself is cacheable.
- Do not redirect based on IP in a way that overrides the URL or cookie. IP geolocation is unreliable (VPNs, travel, shared networks).
- Serve the default locale at the root for crawlers rather than an `Accept-Language`-dependent 302 loop. Use `x-default` for that.

## HTML document

```html
<html lang="es-MX" dir="ltr">
```

- `lang` must be a valid BCP 47 tag matching the rendered content, not the user's browser language.
- Set it during SSR. Setting it in `useEffect` causes a flash and is invisible to crawlers that do not execute JS.
- `dir` is `ltr` or `rtl`; derive it from the locale, not from a per-component flag.
- For mixed inline content (names, user comments), use `<bdi>` or `dir="auto"` locally.

## hreflang

Every localized page should declare all its alternates, including itself:

```html
<link rel="alternate" hreflang="en" href="https://example.com/en/pricing" />
<link rel="alternate" hreflang="es" href="https://example.com/es/precios" />
<link rel="alternate" hreflang="pt-BR" href="https://example.com/pt-BR/precos" />
<link rel="alternate" hreflang="x-default" href="https://example.com/en/pricing" />
```

Rules:

- Absolute URLs, including protocol and host.
- One entry per locale, self-referencing included.
- `x-default` points to the locale-neutral or default page (often the language selector or English).
- Use region subtags only when content actually differs by region (`es-MX` vs `es-ES`). Do not invent regions to look global.
- `hreflang` must match the canonical URL for that locale.
- Do not put `noindex` on localized pages that are listed in hreflang.
- Do not point multiple locales at the same URL, and do not point hreflang at redirects.
- Reciprocity matters: if `es` links to `en`, `en` must link back to `es`.

## Canonical

Each localized page self-canonicalizes:

```html
<link rel="canonical" href="https://example.com/es/precios" />
```

- Never canonicalize every locale to the English page; that removes translations from the index.
- Strip tracking parameters and normalize trailing slashes before emitting the canonical.
- If you serve `/en/` and `/`, pick one canonical and 301 the other.

## Sitemaps

Use `xhtml:link` alternates so crawlers discover the locale cluster:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<urlset
  xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
  xmlns:xhtml="http://www.w3.org/1999/xhtml">
  <url>
    <loc>https://example.com/en/pricing</loc>
    <xhtml:link rel="alternate" hreflang="en" href="https://example.com/en/pricing"/>
    <xhtml:link rel="alternate" hreflang="es" href="https://example.com/es/precios"/>
    <xhtml:link rel="alternate" hreflang="x-default" href="https://example.com/en/pricing"/>
  </url>
  <url>
    <loc>https://example.com/es/precios</loc>
    <xhtml:link rel="alternate" hreflang="en" href="https://example.com/en/pricing"/>
    <xhtml:link rel="alternate" hreflang="es" href="https://example.com/es/precios"/>
    <xhtml:link rel="alternate" hreflang="x-default" href="https://example.com/en/pricing"/>
  </url>
</urlset>
```

- Include every indexable locale URL, not only the default.
- Do not list `noindex`, redirecting, or 404 URLs.
- For large sites, split by locale into a sitemap index.
- Keep `lastmod` meaningful; do not bump it on every deploy.

## Metadata

Localize everything a crawler or social platform reads:

```ts
title: t('meta.title')
description: t('meta.description')
openGraph: {
  locale: 'es_MX',        // underscore form for OG
  alternateLocale: ['en_US', 'pt_BR'],
  title: t('meta.title'),
  description: t('meta.description'),
}
```

- OG `locale` uses `language_TERRITORY` with an underscore.
- Localize alt text for OG images, or generate per-locale images.
- Localize JSON-LD (`inLanguage`, `name`, `description`), and keep URLs consistent with canonical/hreflang.
- Do not translate `@type` or schema keys.

## Localized slugs

Localized slugs (`/es/precios` vs `/en/pricing`) improve relevance but add complexity:

- Keep a slug map per locale for every routable entity.
- Handle slug changes with 301s, never 404s.
- Never use the same slug in two locales for different content.
- If slugs are generated dynamically, ensure stable generation and uniqueness.
- Have an explicit fallback when a translation of a content page does not exist: 404, or serve the default locale with a visible notice and `noindex`. Do not silently show mixed-language content.

## Caching and headers

- Locale in the path → cacheable per URL with no `Vary` needed.
- Locale negotiated by header → `Vary: Accept-Language`; expect cache fragmentation and lower hit rates.
- Send `Content-Language: es-MX` matching the rendered page.
- Do not cache a response that embeds the user's locale cookie into HTML.
- CDN rules should include the locale segment in the cache key.
- Redirects should be cacheable (`301` for permanent URL changes, `302` for root negotiation).

## Common SEO failures

- Only the default locale is in the sitemap.
- hreflang points to non-canonical or redirecting URLs.
- hreflang is missing `x-default`.
- `lang` is `en` on every page because it is hardcoded in the template.
- Machine translations are indexed without review and cannibalize the default locale.
- The language switcher uses JavaScript-only navigation that crawlers cannot follow (use real `<a href>`).
- `noindex` is applied to `/es/` because the content is "duplicate".
- `Vary` is missing when language is negotiated by header.
