# ZipRIGHT UI/UX Redesign Plan

> Date: 2026-07-08 · Phase: Frontend-only redesign · Status: **AWAITING APPROVAL**
>
> Backend is frozen and treated as a stable production contract. Nothing in this plan
> touches APIs, business logic, schemas, routing contracts, auth logic, the Size Engine,
> the AI Stylist, Seller APIs, or the Try-On engine.

---

## 1. Current Frontend Analysis

**Stack (already ideal for a premium 2026 app — no new heavy dependencies needed):**
React 19 · Vite 6 · Tailwind CSS v4 · `motion` v12 (installed but barely used) ·
React Router 7 (HashRouter) · Recharts · Firebase SDK · MediaPipe tasks-vision · PWA.
Layout: a 430px mobile shell centered on desktop.

**What's working:** dark fashion-forward identity (near-black + gold), complete feature
set, consistent bottom-nav shell with a distinctive "Z" action menu, theme toggle
plumbing, safe-area handling, ErrorBoundary + Toast context.

**Systemic UX problems found:**

1. **No design system.** Only 2 shared components exist (`BottomNav`, `ErrorBoundary`).
   Every one of the 39 screens hand-rolls its own buttons, cards, inputs, and modals with
   hardcoded hex values. Even the brand gold is inconsistent — `#B5853F` and `#C9A06C`
   are both used as "the" accent, sometimes in the same file.
2. **Monolithic screens, eager loading.** `Settings.tsx` is 133KB, `Recommendation.tsx`
   67KB, `FitProfile.tsx` 59KB, `AddProduct.tsx` 45KB — and *all 39 screens are imported
   eagerly* in `App.tsx`, so the first paint pays for the entire app.
3. **Loading UX is a single spinner.** No skeleton loaders anywhere; screens pop in.
4. **The splash screen exists but is never routed.** `Splash.tsx` is orphaned — cold
   starts jump straight into redirects.
5. **`motion` is installed but unused.** Animations are ad-hoc CSS keyframes and
   `active:scale-95`; no shared transitions, no gesture physics, no page transitions.
6. **Light theme is half-broken.** The toggle exists, but most screens hardcode dark hex
   backgrounds, so "light mode" renders dark screens with light chrome.
7. **Accessibility gaps.** 9–10px uppercase labels, `text-white/50` body copy (fails
   WCAG AA), no visible focus states, no `prefers-reduced-motion` handling, several
   sub-44px touch targets.
8. **No shared empty/error/offline states** — each screen improvises or shows nothing.
9. **Dead gamification plumbing.** `zipPoints` and `unreadFriends` badges are wired into
   the nav but hardcoded to `0` — the hooks for progression exist with nothing behind them.

## 2. Complete Screen Inventory (39 screens + shell)

| Group | Screens (route) |
|---|---|
| **Entry & Auth** | Splash (orphaned), Welcome (`/welcome`), Login (`/login`) |
| **Core shopper** | Home (`/home`), AddProduct (`/add-product` — size-recommend entry), Recommendation (`/recommendation`), Marketplace (`/marketplace`), ProductFeed (`/feed`), Wishlist (`/wishlist`), Cart (`/cart`), RecentScans (`/recent-scans`) |
| **Fit** | FitProfile (`/fit-profile`), SmartFitScan (`/smart-fit-scan`) |
| **Try-On suite** | FashionStudio (`/fashion-studio`), TryOnStudio (`/tryon-studio`), LiveTryOn (`/live-tryon`), AIStudio (`/ai-studio`), AvatarIntro (`/avatar-intro`), AvatarView (`/avatar-view`) |
| **AI Stylist** | StylistChat (`/stylist`) |
| **Social** | CommunityFeed (`/community`), CreateLook (`/create-look`), FriendsScreen (`/friends`), GiftLook (`/gift-look`), GiftInbox (`/gift-inbox`) |
| **Seller** | SellerDashboard, SellerCatalog, SellerAddProduct, SellerEditProduct (`/:id`), SellerIntegration, SellerIntegrationSandbox (all under `/seller/*`) |
| **Admin** | AdminAnalytics (`/admin/analytics`) |
| **Info/legal** | FAQs, AboutUs, TermsOfUse, PrivacyPolicy, PrivacyCenter |
| **Utility** | ComingSoon (checkout, payment, voice, lookbook, etc.), BottomNav, ErrorBoundary, Toasts |

All routes and their auth guards stay **exactly as they are** — the redesign changes what
renders, never where it lives or what data it calls.

---

## 3. The Redesign, Phase by Phase

Ordering principle: foundation first, then the highest-traffic surfaces, then feature
suites one at a time, gamification only once the system exists to express it. **One phase
ships (and is verified) before the next begins.**

### Phase 0 — Design System Foundation *(no visual change to users yet)*

Create `zipfend/design/` with tokens + `zipfend/components/ui/` primitives:

- **Tokens** (Tailwind v4 `@theme` CSS variables): color system (near-black surface scale,
  ONE canonical gold `--brand` with hover/subtle variants, semantic success/warning/danger/info,
  full light-theme palette so the toggle finally works), typography scale (display serif for
  fashion-editorial headlines + refined sans for UI; 8-step scale replacing the ad-hoc 9px–5xl
  spread), 4pt spacing scale, radius scale (`sm`→`full`), elevation/shadow scale, glass
  (backdrop-blur) recipes, motion tokens (durations 150/250/400ms, spring configs,
  `prefers-reduced-motion` variants).
- **Primitives**: `Button` (primary/secondary/ghost/destructive, loading state, press
  physics), `Card`, `Input`/`TextArea`/`Select` (labels, error states), `Chip`, `Badge`,
  `Sheet` (modern bottom sheet with drag-to-dismiss), `Modal`, `Skeleton`, `EmptyState`,
  `ErrorState`, `OfflineBanner`, `AppBar` (page header with back), `ProgressRing`,
  `Toast` restyle.
- **Motion helpers**: shared `PageTransition` wrapper, stagger-children list presets,
  shared-element hooks via `motion` layoutId.
- **Performance**: convert all 39 screen imports in `App.tsx` to `React.lazy` +
  `Suspense` with skeleton fallbacks (biggest single perf win available; pure mechanical
  change, zero logic edits).

**Why:** every later phase composes these pieces; without tokens, "consistent" is
impossible. Lazy loading cuts initial JS by an order of magnitude for first paint.

### Phase 1 — Entry: Splash → Welcome → Login *(first impression)*

Route the orphaned splash properly (animated wordmark → auth check), rebuild Welcome as a
cinematic hero (full-bleed fashion imagery, staggered type reveal, single clear CTA), and
restyle Login's methods with the new inputs, inline validation, and a fluid transition
into Home. **Why:** the first 10 seconds set the "premium product" perception; today it's
two static text screens. No auth logic changes — same Firebase calls, same demo-user path.

### Phase 2 — Home + Navigation shell

Redesign Home as a personalized editorial feed (greeting, Fit-Profile completeness card,
try-on shortcuts, recent activity) with scroll-linked header effects. Rebuild BottomNav
with the new tokens, springy tab transitions, and a redesigned Z-menu as a proper
gesture-driven bottom sheet. **Why:** Home + nav are touched in every session; this is
where "smooth and modern" is felt most, and the Z-menu is the app's signature interaction.

### Phase 3 — Size flow: AddProduct → Recommendation

The core conversion funnel. Break the two monoliths into stepped, focused sub-components:
paste-link/scan entry with live extraction progress, then a redesigned recommendation
reveal — animated size result, **Fit Confidence Score** visualized as a ring (the engine
already returns confidence/risk/reason; today it's buried in text), size-chart comparison,
clear "how did it fit?" feedback prompt (feeds the existing `/size-feedback` endpoint —
closing the calibration loop the backend already supports). **Why:** this is the product's
reason to exist; reducing friction here directly drives conversion and feeds the
calibration engine more data.

### Phase 4 — Try-On suite: TryOnStudio, FashionStudio, LiveTryOn, AIStudio

Unified studio design language: full-bleed canvas, controls in bottom sheets, quality
picker as segmented control, job progress as a cinematic generation experience (the
backend already streams real % progress — visualize it), before/after compare gesture,
result gallery with shared-element zoom. Job-resume (already in localStorage) surfaces as
a "your look is ready" card. **Why:** try-on is the wow feature and the most-shared
artifact; generation waits (~34s) currently feel broken instead of anticipatory.

### Phase 5 — Fit Profile + SmartFitScan

Split the 59KB FitProfile monolith into a guided, sectioned editor with a **Wardrobe/Profile
completion meter**; redesign SmartFitScan's camera flow with clear pose guidance overlays
and celebratory completion. **Why:** profile completeness directly improves recommendation
quality — making progress visible motivates completion (measured gamification, not
childish).

### Phase 6 — AI Stylist chat

Modern conversational UI: streaming-feel message reveal, stylist "thinking" state, rich
outfit cards in responses, quick-reply chips, session history. **Why:** the stylist is a
retention driver; today it's a bare chat box that undersells a working local-LLM pipeline.

### Phase 7 — Shopping surfaces: Marketplace, ProductFeed, Wishlist, Cart, RecentScans

Pinterest-grade product grids (masonry, image-first cards, skeleton grids), wishlist with
satisfying save micro-interaction, cart integrations preserved as-is functionally.
**Why:** browsing surfaces carry engagement between AI sessions; image-led layouts fit
fashion content dramatically better than the current list rows.

### Phase 8 — Social: CommunityFeed, CreateLook, Friends, GiftLook, GiftInbox

Instagram-quality feed cards, look composer with drag interactions, gift flows with
delightful reveal animations. **Why:** social features drive organic acquisition; gifting
a look is a unique mechanic that deserves a signature moment.

### Phase 9 — Seller suite (6 screens) + AdminAnalytics

Linear/Stripe-dashboard treatment: stat cards with animated counters, Recharts restyled to
tokens, catalog as a proper data table with bulk states, import wizard with progress
steps, integration screens with clear connection status and sync history timeline.
**Seller achievements/milestones** (first product, first sync, first 100 recommendations)
rendered from existing analytics data. **Why:** sellers judge platform credibility by
dashboard polish; this is B2B trust, which is conversion.

### Phase 10 — Settings/Profile + info/legal pages

Break up the 133KB Settings monolith into grouped, searchable sections; profile header
with avatar; theme toggle that finally works both ways; restyle the 5 legal/info pages
with the reading-optimized type scale. **Why:** Settings is the current worst-maintained
surface and where the broken light theme is most visible.

### Phase 11 — Gamification layer (frontend-only, cross-cutting)

All computed client-side from data the app already has (localStorage + existing Firestore
reads the frontend already performs — zero backend changes):

- **Style Score / Style Level** — composite of profile completeness, try-ons generated,
  feedback given; shown on Home + Profile.
- **Fashion Streaks** — consecutive days with a try-on/scan/stylist chat; the nav's dead
  `zipPoints` badge comes alive.
- **AI Style Achievements** — first try-on, 10 looks, wardrobe complete, stylist
  conversations; tasteful toast + collection page (extends Settings/Profile).
- **Daily Fashion Inspiration** — Home card rotating from existing stylist/product data.
- **Fit Confidence Score** — already returned by the size engine; surfaced in Phase 3,
  aggregated on the profile here.
- Seller-side milestones shipped in Phase 9.

**Why last:** progression UI is only credible once the surfaces it decorates are premium.
Tone: Nike Run Club, not Duolingo — muted gold, no mascots.

### Phase 12 — States & accessibility hardening

Sweep every screen for the shared `EmptyState`/`ErrorState`/`OfflineBanner`/`Skeleton`
usage, success moments, WCAG AA contrast, focus rings, 44px targets, reduced-motion
verification, and a final performance audit (bundle analysis, image lazy-loading,
`content-visibility` on long lists). **Why:** edge states are where "polished" is proven;
this pass guarantees no screen was left behind.

---

## 4. Verification Protocol (every phase)

1. `npm run typecheck` and `npm run build` pass.
2. Manual walkthrough of every flow the phase touched **plus** its adjacent flows in the
   dev preview — confirming every pre-existing feature still works.
3. Responsive check: 375px, 430px shell, desktop-centered.
4. Both themes verified (dark AND light).
5. Accessibility: contrast, focus order, touch targets, reduced-motion.
6. Animation budget: transform/opacity only on the hot path; no layout thrash; 60fps in
   DevTools performance trace.

## 5. Hard Guarantees

- Zero changes under `zipfin-backend/` for the entire phase.
- Zero changes to `services/ziprightApi.ts` / `stylistService.ts` request contracts
  (visual-layer additions like typed helpers for existing responses are allowed; endpoints,
  payloads, and auth headers are not touched).
- Every route keeps its path and auth guard.
- No feature is removed; ComingSoon placeholders stay until a real replacement exists.
- localStorage keys already in use (`zipright_theme`, `zipright_active_tryon_job`,
  `zipright_demo_user`) are preserved verbatim.
