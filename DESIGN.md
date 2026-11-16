# FortyAU design system

Abstracted from **fortyau.com** on 2026-11-16. All 79 pages in the sitemap and all 9 stylesheets were read. The tokens and class usage were tallied across every page, and the six page types were rendered (home, service, case study, news index, article, team). The tokens below are the site's own named CSS variables unless marked **added**.

Code: [`public/tokens.css`](public/tokens.css) (tokens, base, shared components). The dashboard's layout is in [`public/style.css`](public/style.css).

## Character

A dark, quiet "night sky" with one warm light. Deep violet-black surfaces, hairline borders instead of fills, a single star-yellow accent used sparingly, and big confident grotesque headlines with **one or two words in italic serif**. Small mono caps carry every label and piece of metadata. A faint film grain sits over everything.

## Color

| Token | Value | Use |
| --- | --- | --- |
| `--void` | `#0f0c1a` | Footer, final CTA, deepest wells |
| `--cosmos` | `#161228` | Page background |
| `--nebula` | `#1e1a35` | Raised or banded surfaces |
| `--cloud` | `#2a2548` | Hover fills, glows |
| `--text-1` | `#f4eeff` | Headings, primary text (16:1) |
| `--text-2` | `#d8c9f0` | Body copy (11.7:1) |
| `--text-muted` | `#9a8fc4` | **Added.** Small secondary text (6.2:1) |
| `--text-3` | `#6b5f96` | Decoration only: index numerals, rules (3.2:1) |
| `--star` | `#fad542` | The brand yellow: primary button, labels, metrics, `<em>` |
| `--pale-blue` | `#9cc4de` | Secondary accent: icons, secondary data |
| `--border` / `--border-hard` | white 8% / 14% | Hairlines |
| `--good` / `--bad` | `#7fdcae` / `#ff8a8a` | **Added** for status UIs; AA on every surface |

Rules:
- **Yellow is a spotlight, not a paint.** Use it for one thing per region: a label, a metric, an accent word, the primary button. Never for body text or large fills (the "dim" variants at 14% are the most fill it gets).
- **No light theme.** The brand is dark-only.
- **Accessibility fix:** the site sets small mono labels in `--text-3`, which fails WCAG AA. Use `--text-muted` for any text people need to read.

## Type

Loaded from Google Fonts: `Bricolage Grotesque` 400/700/800, `Instrument Serif` italic, `JetBrains Mono` 400/700.

| Role | Font | Spec |
| --- | --- | --- |
| Display / H1 | Bricolage 800 | `clamp(36px, 5vw, 64px)`, line-height 1.02, tracking −0.035em |
| H2 | Bricolage 800 | `clamp(24px, 2.6vw, 32px)`, tracking −0.02em |
| H3 / card title | Bricolage 700 | 19–26px, tracking −0.01 to −0.02em |
| Body | Bricolage 400 | 16px / 1.6; long-form 18px / 1.85 in `--text-2` |
| Accent | Instrument Serif italic | `<em>` inside a headline, always `--star` |
| Label | JetBrains Mono 700 | 12px, caps, tracking 0.2em, `--star`, with a 28px leading rule |
| Meta / caption | JetBrains Mono 400 | 10–12px, caps, tracking 0.08–0.18em |

The headline pattern is a plain statement plus one italic serif word: "From *idea* to final delivery", "Want to build *something* like this?", "What went *live*".

## Space, shape, motion

- **Spacing:** 4, 8, 12, 16, 24, 32, 48, 64, 80, 96, 120, 160 (`--space-micro` … `--space-7xl`). Sections breathe: 64–160px vertical.
- **Radius:** 4px (buttons, tags), 6px, 10px (cards). Nothing pill-shaped except progress bars.
- **Containers:** 1200px default, 880px narrow (reading), 1440px wide; gutter `clamp(20px, 4vw, 48px)`.
- **Motion:** 0.2s hover, 0.4s surface changes, 0.75s scroll reveals that rise 28px and stagger 0.08s. Respect `prefers-reduced-motion`.

## Components

| Component | Class | Notes |
| --- | --- | --- |
| Section label | `.section-label` | Yellow mono caps after a 28px rule; numbered on the dashboard ("01 · Shipped") |
| Card | `.card` | 1px `--border`, 10px radius, **no fill**; title, mono index, body in `--text-2` |
| Segmented grid | `.gap-grid-segmented` | Cells share 1px dividers inside one rounded border (service and related-work grids) |
| Metric | `.metric-value` + `.mono-label` | Big 800-weight yellow number over a mono caption (case-study pages) |
| Tag | `.tag`, `.tag-star` | 10px mono caps in a hairline box |
| Buttons | `.btn-primary` / `.btn-secondary` / `.btn-ghost` | Yellow solid with dark text; hairline outline; mono underline link |
| Grain | `.grain` | Fixed fractal-noise overlay at 4.5% opacity |
| Glow | `.glow` | Soft radial violet and star light behind heroes and CTAs |
| Rows | `.row` (dashboard) | From the news archive: date block, title, mono meta, arrow link |

## Logo

`public/logo.svg` is the "40AU" yellow-mark-plus-white-wordmark lockup from the site's nav. Use it on dark surfaces only, at 20–24px tall.
