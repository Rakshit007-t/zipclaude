# ZipRIGHT — Final Frontend Engineering Report

**Scope:** the "MAISON" V2 frontend rebuild + Phase-1 premium redesign, through
the final Opus closeout pass. Backend, APIs, and business logic were **frozen**
throughout — this report covers the frontend (`zipfend/`) only.

Companion docs: [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md) ·
[UI_COMPONENT_GUIDELINES.md](UI_COMPONENT_GUIDELINES.md) ·
[UX_DECISIONS.md](UX_DECISIONS.md) ·
[NEXT_ENGINEERING_TASKS.md](NEXT_ENGINEERING_TASKS.md)

---

## 1. What was delivered

**A. Full V2 "MAISON" rebuild** — all 43 screens re-skinned onto an editorial
design language (bone/espresso, single copper accent, Fraunces + Instrument
Sans), a mobile-first full-bleed shell, and a 24-component UI kit. Zero
blue/violet (grep-verified). Legacy `ProductCard.jsx` / `BottomSheet.jsx` /
`BottomNav.tsx` deleted.

**B. Social-commerce platform layer** — a real Firestore social graph:
follow/followers, user search, block/report ([`services/social.ts`](services/social.ts)),
DMs with text/image/voice/typing/seen/presence ([`services/messages.ts`](services/messages.ts)),
posting + a discoverable fashion feed ("The Salon") with an editorial seed
collection ([`services/salonSeed.ts`](services/salonSeed.ts)), likes/comments/saves/shares,
and cursor pagination.

**C. Navigation & IA** — five plain-English dock tabs (Home · Shop · Studio ·
Social · You); the Studio launcher as a focused AI toolkit; the Salon as the
one-tap front door of the Social tab. Full jargon sweep (Atelier→Studio,
Circle→Friends). No duplicated navigation.

**D. Phase-1 premium redesign** (this session) — screen-by-screen, each
audited against Apple/Linear/Stripe/Nike/Instagram/Pinterest/Arc, redesigned,
typechecked, built, walked through live, and frozen:

| # | Screen | Headline change |
|---|--------|-----------------|
| 1 | Home | Design system built; greeting→display-1; killed a like-toast |
| 2 | Virtual Try-On | Rebuilt to one hero canvas + glass dock; added the missing **Buy** CTA; gestures; fixed an AnimatePresence node-leak; copper Buy; share fallback |
| 3 | Smart Fit | Removed `alert()` + debug logs; segmented progress; fixed a confusing exit; input a11y |
| 4 | Fit Profile | 9 unlabelled inputs → aria-labelled; tokens |
| 5 | AI Stylist | Already exemplary; press-token consistency |
| 6 | Product Page | Removed 3 debug logs; title→display-2 |
| 7 | Seller Dashboard | Click-only rows → keyboard buttons; tokens |
| — | App-wide | Stripped **all** debug `console.log`s from product/service paths |

## 2. Architecture

- **Stack:** Vite 6 + React 19 + React Router 7 (HashRouter) + Tailwind v4
  (CSS-first `@theme`) + Firebase (Auth + Firestore) + `motion` (Framer) +
  Recharts + MediaPipe (LiveTryOn). TypeScript throughout; `tsc --noEmit`
  clean. **Deliberately NOT Next.js** (user decision).
- **Routing:** all screens `React.lazy` + `Suspense` → one chunk per route.
- **State:** React context for the two cross-cutting concerns
  ([`UserProfileContext`](contexts/UserProfileContext.tsx),
  [`ToastContext`](contexts/ToastContext.tsx)); everything else is local +
  service modules. No Redux/Zustand — intentionally lean.
- **Persistence model:** local-first. The closet, style journey, and demo
  session are localStorage-authoritative with best-effort Firestore mirroring,
  so the UI never blocks on the network and demo/investor sessions work fully
  offline of a real account. Firestore is the cloud source of truth for
  signed-in users.
- **Services layer** (`services/`): `closet`, `social`, `messages`, `salonSeed`,
  `styleJourney`, `stylistService`, `tryonService`, `ziprightApi`,
  `recommendationAnalytics`, `BrandAPI`, `demoProducts`. Screens never call
  Firebase/HTTP directly for domain logic — they go through a service.

## 3. Design system

See [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md). Highlights: 14 semantic color pairs
(light/dark, theme flips on `html.dark`), a 4-step type scale
(`display-1/2`, `title-1/2`) + eyebrow, three press tiers
(`press-icon/press/press-soft`), three elevation tokens, sanctioned media
scrims, and Framer motion helpers. The system was *completed and systematized*
this pass — hand-rolled headings and 100+ ad-hoc `active:scale-*` values were
migrated onto tokens (see §7 for what remains).

## 4. Accessibility

- Every icon-only button carries an `aria-label`; toggles expose `aria-pressed`;
  expanders `aria-expanded`; the stylist log is `role="log"` + `aria-live`.
- **Inputs:** all form fields now have accessible names (Fit Profile's 9
  previously-unlabelled inputs and Smart Fit's height input were fixed).
- **Keyboard:** click-only `<div>`s were promoted to real buttons (Seller
  Dashboard product rows; Friends inbox). Gestures always have a
  non-gesture equivalent.
- **Reduced motion:** honored globally via CSS + `useReducedMotion`.
- Remaining a11y debt is catalogued in [NEXT_ENGINEERING_TASKS.md](NEXT_ENGINEERING_TASKS.md)
  (focus-trap on Sheet/Modal is the main one).

## 5. Responsiveness

Full-bleed mobile shell, single `overflow-x-hidden` container. Verified across
the full journey at 320/375/390/430px: **zero horizontal overflow anywhere**,
fixed bars clamp to the shell, safe-area padding applied. Desktop renders the
430px shell centered with flanks.

## 6. Performance

- Route-level code splitting; per-route chunks are small (most < 15 kB gz).
- Motion is `transform`/`opacity` only; gestures are ref-tracked (no
  re-renders). Skeletons are GPU shimmer.
- **Known issue:** the shared `index` chunk is **~933 kB** (~250 kB gz) — it
  bundles Firebase + Framer + Recharts. This is the top perf opportunity
  (vendor `manualChunks` splitting) — see NEXT_ENGINEERING_TASKS (High).
- LiveTryOn is 133 kB (MediaPipe) — acceptable, lazy-loaded only on that route.

## 7. Animations

One motion language: spring entrances (`StaggerList`), morphing sheets, the
three-tier press system, cinematic loading states. Reduced-motion safe. A
production lesson is documented: `AnimatePresence mode="wait"` on rapidly-keyed
elements leaks nodes — avoid it (see UI_COMPONENT_GUIDELINES).

## 8. Remaining technical debt

Full, prioritized list in [NEXT_ENGINEERING_TASKS.md](NEXT_ENGINEERING_TASKS.md).
Headlines:
- **Perf:** vendor chunk splitting (933 kB main bundle).
- **Consistency:** ~30 multi-prop-transition `active:scale-95` cases were left
  intentionally (swapping to the token would drop their border/color
  transitions) — normalize press *depth* to 0.96 repo-wide with a codemod.
- **A11y:** focus-trap + focus-return on Sheet/Modal.
- **Backend-dependent:** try-on render, seller dashboard analytics, and brand
  size-chart APIs are stubbed/frozen and degrade gracefully; they light up when
  the backend runs.

## 9. Future roadmap

- Vendor chunk splitting + route prefetch on idle.
- Real brand size-chart integration (`BrandAPI` is a stub).
- ft/in height toggle in Smart Fit for non-metric markets.
- Achievement/reward celebration moments (brass is reserved and unused for
  peak moments).
- Settings decomposition (only once it's safe — see UX_DECISIONS).
- Push notifications for DMs/gifts/follows.

---

*Every change this session is committed atomically on
`recovery/foundation-freeze`, each screen frozen as its own green
(typecheck + build) checkpoint. V1 is preserved at commit `4f104c8c`.*
