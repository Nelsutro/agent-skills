# RTL and bidirectional UI

RTL is not "mirror the whole page." Direction affects layout, icons, punctuation, and text runs independently.

## Document direction

```html
<html lang="ar" dir="rtl">
```

- Set `dir` on `<html>` during SSR, derived from the locale.
- `dir="auto"` on an element lets the browser infer direction from its first strong character. Use it for user-generated content, not for the app shell.
- Do not set `direction: rtl` on `body` only; `<html>` is the root for inheritance, scrollbars, and form controls.
- Locales that are RTL: `ar`, `he`, `fa`, `ur`, `ps`, `sd`, `ug`, `yi`, `dv`. Do not assume all of them behave identically (fonts, digits, punctuation differ).

## Logical CSS

Replace physical properties with logical ones everywhere:

| Physical | Logical |
| --- | --- |
| `margin-left` / `margin-right` | `margin-inline-start` / `margin-inline-end` |
| `padding-left` / `padding-right` | `padding-inline-start` / `padding-inline-end` |
| `left` / `right` (positioned) | `inset-inline-start` / `inset-inline-end` |
| `border-left` / `border-right` | `border-inline-start` / `border-inline-end` |
| `text-align: left/right` | `text-align: start/end` |
| `float: left/right` | `float: inline-start/inline-end` |
| `width` / `height` | `inline-size` / `block-size` (when it is inline-axis size) |

Shorthands:

```css
/* Instead of margin: 0 12px 0 24px */
margin-inline: 24px 12px;

/* Instead of padding-left/right */
padding-inline: 16px;

/* Instead of border-left */
border-inline-start: 1px solid var(--border);
```

Tailwind CSS has logical utilities:

```
ms-4 me-2 ps-6 pe-2 start-0 end-4 text-start border-s
```

Use `rtl:` / `ltr:` variants only for genuinely direction-specific overrides, not as a substitute for logical properties.

## Flexbox and grid

- `flex-direction: row` follows the writing direction, so it flips automatically. Do not add `row-reverse` for RTL.
- `justify-content: flex-start` follows the direction; `start`/`end` are clearer.
- Grid columns follow the direction, but explicit `grid-column: 1 / 3` does not. Use named areas or logical placements.
- Absolute positioning with `left`/`right` does not flip. Use `inset-inline-*`.
- `transform: translateX(...)` does not flip. Use `translate` with a direction-aware value or `inset-inline` instead.

## Icons and imagery

Mirror:

- Arrows and chevrons (back/forward, next/previous)
- Progress and step indicators
- Sliders and range tracks
- Text-alignment icons
- List/indent icons

Do not mirror:

- Logos and brand marks
- Clocks and media controls (play, pause)
- Checkmarks and mathematical symbols
- Numbers, charts' numeric axes
- Photographs and illustrations of people or objects
- Code blocks and keyboard shortcuts displayed as text

For asymmetric illustrations, provide an RTL variant or keep a direction-neutral composition.

## Bidirectional text

Mixing Arabic/Hebrew with Latin text, numbers, or punctuation can reorder visually. Use isolation:

```html
<p>تمت إضافة <bdi>John Smith</bdi> إلى المشروع</p>
```

```css
.username {
  unicode-bidi: isolate;
}
```

Guidelines:

- Wrap user names, file names, email addresses, code, and URLs in `<bdi>`.
- Use `dir="auto"` on user-provided text blocks.
- Do not rely on spaces or LRM/RLM marks to fix order; isolate instead.
- Punctuation at the boundary of two directions may appear on the wrong side. Test with real mixed content.
- Parentheses and quotes can render mirrored in RTL; verify with the target font.

## Numbers, dates, and digits

- Do not force Arabic-Indic digits. Decide per locale and product policy.
- `ar` with `Intl.NumberFormat` produces Arabic-Indic digits in many environments; if you need Latin digits, use `ar-u-nu-latn`. Be explicit.
- Hebrew typically uses Latin digits.
- Currency placement, separators, and percent signs follow the locale, not the direction.
- Phone numbers, postal codes, and IDs should be isolated and often kept LTR within RTL text.

## Forms and controls

- Labels, help text, and validation messages align with `text-align: start`.
- Input direction: use `dir="auto"` for free-text fields (names, addresses) so the user's script is respected; use `dir="ltr"` for email, URL, code, and phone fields.
- Do not reverse the physical order of fields in a row unless the design requires it; flexbox handles it.
- Checkbox and radio alignment follows logical properties.
- Select dropdowns and native date pickers render per browser locale; test them.

## Fonts and typography

- Use fonts with proper Arabic/Hebrew coverage (Noto Sans Arabic, Noto Naskh Arabic, IBM Plex Sans Arabic, Vazirmatn for Persian, Noto Sans Hebrew).
- Line height usually needs more leading for Arabic scripts; do not reuse the Latin scale blindly.
- Letter-spacing on Arabic breaks joining letters. Never apply positive tracking to Arabic script.
- Avoid faux italic and faux bold; use real weights.
- Font size and weight interact with script x-height; test at the same nominal size.

## Layout and components to audit

- Navigation bars, breadcrumbs, tabs, pagination
- Tables: column order, alignment of numbers vs text
- Modals, drawers, toasts anchored to a corner
- Carousels and sliders (direction of movement)
- Progress bars and steppers
- Charts: axis direction, legend order, tooltips
- Code editors and diff views (usually stay LTR)
- Email templates (Outlook/Gmail have poor logical property support; use table-based fallbacks)

## Testing

- Render with `dir="rtl"` and inspect every route, not just the home page.
- Screenshot tests for RTL at mobile and desktop widths.
- Check that scrollbars, modals, and fixed elements are not clipped.
- Test mixed Arabic + English + numbers in the same sentence.
- Verify icons: directional ones mirrored, non-directional ones not.
- Check focus rings and keyboard navigation order (DOM order should match visual order).
- Use a real Arabic/Hebrew locale, not pseudo-RTL only.

## Anti-patterns

- A global `isRTL` boolean passed through every component instead of CSS logical properties
- `transform: scaleX(-1)` on a container to "mirror" the UI
- Reversing arrays of elements in JS to flip layout
- Hardcoded `left`/`right` in inline styles and email templates
- Forcing Latin digits or Arabic-Indic digits everywhere
- Letter-spacing on Arabic text
- Translating Arabic copy without checking shaping and diacritics
