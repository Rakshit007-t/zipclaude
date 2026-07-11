# ZipRIGHT UI Component Guidelines

The MAISON kit lives in [`components/ui/`](components/ui) and is the **only**
place screens import primitives from:

```ts
import { Button, Card, Sheet, SectionHeader } from '../components/ui';
```

Everything is exported through the barrel ([`components/ui/index.ts`](components/ui/index.ts)).
Never re-implement one of these inline in a screen — extend the primitive instead.

---

## Layout & chrome

| Component | Purpose | Key props / notes |
|-----------|---------|-------------------|
| **AppBar** | Top bar with title + back + trailing slot | `title` (string or node), `onBack`, `hideBack`, `trailing`. Back defaults to `navigate(-1)`. |
| **Wordmark** | The ZipRIGHT logotype | `size` (`sm`/`md`/`lg`) |
| **SectionHeader** | Eyebrow + display title + optional action | `eyebrow`, `title`, `action:{label,onClick}`. The repeating rhythm of every list screen. |
| **Eyebrow** | Uppercase letterspaced micro-label | Wraps the `.eyebrow` class |
| **Divider** | Hairline rule (optionally center-faded) | — |
| **ListRow** | Settings/menu row: icon + title + subtitle + chevron | `icon`, `title`, `subtitle`, `onClick` |
| **OfflineBanner** | Auto-showing offline notice | Mounted once at app root |
| **ScreenFallback** | Suspense fallback for lazy routes | Used in `App.tsx` `<Suspense>` |

## Actions & inputs

| Component | Purpose | Key props / notes |
|-----------|---------|-------------------|
| **Button** | Primary action | `variant`: `primary` (ink) · `accent` (copper) · `outline` · `ghost`. `size`, `fullWidth`, `loading`, `disabled`, `icon`, `trailingIcon`. Primary = ink fill; accent = copper for conversion moments. |
| **IconButton** | Icon-only action | Has a required accessible label |
| **Chip** | Selectable pill (sizes, tags) | `selected`, `onClick` |
| **SegmentedControl** | 2–3 mutually exclusive options | `value`, `onChange`, `options:[{value,label,icon?}]`, `aria-label` |
| **Input / Field / TextArea** | Text entry | Always pass `aria-label` (or wire a `<label htmlFor>`); the shared `fieldCls` pattern gives the focus ring. |
| **Badge** | Status/count marker | `variant` (`brand`/`neutral`/…), `size` |

## Surfaces & overlays

| Component | Purpose | Key notes |
|-----------|---------|-----------|
| **Card** | Bordered content surface | `surface-1` + `border-line`; add `shadow-lift` when it should float |
| **Sheet** | Bottom sheet (spring slide-up + scrim) | `open`, `onClose`, `title`. The default for contextual actions/detail. |
| **Modal** | Centered dialog | For confirm/blocking decisions only |

## Feedback & state

| Component | Purpose | Key notes |
|-----------|---------|-----------|
| **Skeleton / SkeletonText** | Content-shaped loading | GPU shimmer (`transform` only); never a blocking spinner overlay for lists |
| **Spinner** | Inline/indeterminate loading | `size`, `className` for color |
| **ProgressRing** | Circular determinate progress | — |
| **CountUp** | Animated number count-up | KPIs, scores |
| **EmptyState** | Empty list/inbox | `icon`, `title`, `description`, `action` |
| **ErrorState** | Error surface with retry | `onRetry` |
| **Toast** | Transient feedback | Via `useToast().showToast(msg, 'success'|'error'|'info')` from `contexts/ToastContext`. **Errors + meaningful confirmations only** — never for likes/taps (the filled heart is the feedback). |

## Motion helpers (from `motion.tsx`)

`motion`, `AnimatePresence`, `useReducedMotion`, `springs`, `durations`,
`fadeUp`, `fade`, `scaleIn`, `reveal`, `staggerChildren`, `PageTransition`,
`StaggerList`, `StaggerItem`. Prefer `StaggerList`/`StaggerItem` for list entrances.

**AnimatePresence gotcha (learned in production):** do **not** use
`mode="wait"` around a keyed element that changes faster than its exit
animation — it deadlocks Framer and leaks stale nodes (this froze the Try-On
fit pill). For rapid-change content, key the element and use `initial`/`animate`
only (no `exit`, no wait) so it re-mounts and fades in cleanly.

## Component rules

1. **Accessibility is not optional.** Every icon-only button needs an
   `aria-label`; every input needs an accessible name; toggles need
   `aria-pressed`; expanders need `aria-expanded`; anything clickable must be a
   `<button>` (or have `role`+`tabIndex`+`onKeyDown`) — never a bare
   `onClick` `<div>`.
2. **Press feedback** uses `.press-icon` / `.press` / `.press-soft`, never a
   raw `active:scale-*`.
3. **Headings** use `.display-1/2` / `.title-1/2`; body uses default sans.
4. **One accent.** Copper (`brand` / `brand-on-media`). Brass only for rewards.
