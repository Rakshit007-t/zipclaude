# ZipRIGHT Design System — "MAISON"

Editorial-luxury fashion-tech. Warm bone canvas, espresso ink, one copper
accent, brass reserved for reward moments. Print-like flatness: hairlines
carry structure, shadows are whispers. **Fraunces** (display serif) speaks;
**Instrument Sans** works.

All tokens live in [`design/tokens.css`](design/tokens.css); the semantic
utility classes below live in [`index.css`](index.css). The dark theme flips
via the `dark` class on `<html>` (driven by the app theme toggle), **not** the
OS media query — the `@custom-variant dark` line in tokens.css is what makes
`dark:` utilities follow the toggle. Do not remove it.

---

## 1. Color tokens

Every color is a CSS var with a light value and a dark ("Atelier night") value.
Consumed in Tailwind as `bg-*`, `text-*`, `border-*` via the `@theme` block.

| Token | Light | Dark | Use |
|-------|-------|------|-----|
| `surface-0` | `#f4f1ea` bone | `#12100d` | Page background |
| `surface-1` | `#fcfbf7` paper | `#1a1815` | Cards |
| `surface-2` | `#ece8de` | `#23201b` | Inset / input |
| `surface-3` | `#e0dbce` | `#2d2a23` | Deepest inset |
| `line` | ink @ 10% | bone @ 8% | Hairline borders |
| `line-strong` | ink @ 24% | bone @ 20% | Emphasis borders |
| `ink` | `#191613` espresso | `#f1ede3` | Primary text |
| `ink-soft` | ink @ 64% | bone @ 66% | Secondary text |
| `ink-faint` | ink @ 42% | bone @ 42% | Tertiary / hints |
| `ink-invert` | `#f6f4ed` | `#14120f` | Text on ink surfaces |
| `brand` | `#b95b23` burnt copper | `#e89b6b` candlelit copper | The one accent |
| `brand-strong` | `#9e4a17` | `#f2b08a` | Accent pressed/hover |
| `brand-soft` | copper @ 10% | copper @ 14% | Accent tint backgrounds |
| `brand-on-media` | `#e89b6b` **fixed** | `#e89b6b` **fixed** | Copper over photos/video — never theme-flips, because media is always dark |
| `on-brand` | `#ffffff` | `#2a1608` | Text on a copper fill |
| `brass` | `#9c7c33` | `#d6ae5f` | **Reward moments only**: streaks, scores, ZipCoins |
| `success` | `#237a50` | `#5fce8f` | + `-soft` |
| `warning` | `#9a6b1f` | `#e4b04d` | + `-soft` |
| `danger` | `#c73e2e` oxide red | `#f2705c` | + `-soft` |
| `info` | `#2e7d74` muted teal | `#7cc7bd` | The coolest note allowed — **no blue anywhere** |
| `scrim` | ink @ 55% | black @ 65% | Modal/sheet backdrops |

**Rule:** zero blue, zero violet. Copper is the only accent. Any hardcoded hex
in a screen is a bug except `brand-on-media`'s `#e89b6b` (a fixed alias for
photo overlays) and the three semantic fit-status dots.

## 2. Typography

- `--font-display`: **Fraunces** (serif) — headings, numbers, editorial voice.
- `--font-sans`: **Instrument Sans** — body, controls, labels.

**Type scale** (semantic classes — reach for these, never hand-roll
`font-display text-[Npx]`):

| Class | Size / weight | Role |
|-------|---------------|------|
| `.display-1` | 34px / 300 | Hero / screen opener |
| `.display-2` | 26px / 300 | Screen title |
| `.title-1` | 22px / 500 | Section header |
| `.title-2` | 18px / 500 | Card & sheet title |
| `.eyebrow` | 11px / 600 uppercase, 0.16em tracking | The MAISON micro-label above headings |

Exceptions kept manual **on purpose**: large data numerals (a 9.5rem size
result, KPI counters, prices) and headings on inverted (`bg-ink`) surfaces
where the token's baked-in `text-ink` would be wrong.

## 3. Spacing & shape

- Spacing: Tailwind's default scale (the v4 dynamic scale — any `p-*`/`gap-*`
  number resolves to `n × 0.25rem`). Screens use a 6-unit (`px-6` = 24px)
  page gutter as the default rhythm.
- Radius: `--radius-card` 1rem, `--radius-ctl` 0.875rem, `--radius-sheet`
  1.75rem. Pills use `rounded-full`. Two-tier control language: **pills**
  (full) for primary controls, **tiles** (`rounded-2xl`) for secondary grids.

## 4. Elevation

Shadows are whispers, not drop shadows.

| Token | Class | Use |
|-------|-------|-----|
| `--elev-lift` | `shadow-lift` | Cards that float slightly |
| `--elev-float` | `shadow-float` | Sheets, dropdowns, popovers |
| `--elev-glow` | `shadow-glow` | Copper glow under the primary/accent CTA |

## 5. Motion

Driven by `motion/react` (Framer). Exported from the kit
([`components/ui/motion.tsx`](components/ui/motion.tsx)): `springs`,
`durations`, `fadeUp`, `fade`, `scaleIn`, `reveal`, `staggerChildren`,
`PageTransition`, `StaggerList`, `StaggerItem`.

- Easing tokens: `--ease-swift` (confident decel, `cubic-bezier(0.22,1,0.36,1)`)
  and `--ease-out-back` (playful settle).
- **Press feedback** — three tiers replace all ad-hoc `active:scale-*`:
  | Class | Scale | Target |
  |-------|-------|--------|
  | `.press-icon` | 0.90 | Small icon buttons |
  | `.press` | 0.96 | Controls, chips |
  | `.press-soft` | 0.98 | Cards, large surfaces |
- **Reduced motion**: honored globally. CSS animations/transitions collapse to
  0.01ms under `prefers-reduced-motion`; JS motion respects `useReducedMotion`.

## 6. Media scrims

MAISON forbids decorative gradients — scrims are the **only** sanctioned ones:
`.scrim-b` (bottom-up), `.scrim-t` (top-down), `.scrim-cover-b` (full-bleed,
darkens the caption zone). Use over any photo/video where text sits on the image.

## 7. Guarantees

- Full-bleed mobile shell, single `overflow-x-hidden` container. No element may
  create horizontal scroll at 320/375/390/430px.
- Fixed bars use `phone-fixed-bottom` (clamps to the 430px shell, centered) and
  `pb-safe` / `pt-safe` for iPhone safe areas.
