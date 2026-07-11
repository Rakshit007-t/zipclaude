# ZipRIGHT — Next Engineering Tasks (Handoff for Codex / Antigravity)

Prioritized backlog to continue ZipRIGHT frontend work without rediscovering
context. Repo root: `zipright-mvpcopy/`; frontend app: `zipfend/`. Branch:
`recovery/foundation-freeze`. Read [FINAL_FRONTEND_ENGINEERING_REPORT.md](FINAL_FRONTEND_ENGINEERING_REPORT.md),
[DESIGN_SYSTEM.md](DESIGN_SYSTEM.md), and [UX_DECISIONS.md](UX_DECISIONS.md)
first — several "don't touch" constraints live there.

**Guardrails:** backend / APIs / business logic are frozen. Never introduce
blue/violet. Never add a decorative feature or fake affordance. Preserve every
existing feature. Verify with `npm run typecheck` + `npm run build` (from
`zipfend/`) after every change.

---

## 🔴 CRITICAL (correctness / launch-blocking)

*(None open in the frontend as of this handoff — typecheck + production build
are green, no console errors on any journey, no horizontal overflow at any
breakpoint, no `alert()` or debug `console.log` in product paths.)*

The only launch-blockers are backend-side and out of frontend scope:
1. **Try-on render backend** — `/tryon-*` returns "Failed to fetch" without the
   service running ([`services/tryonService.ts`](services/tryonService.ts)). Frontend
   degrades gracefully (product image + Try again). Stand up the service.
2. **Seller dashboard analytics + brand size-charts** — `getSellerDashboard`
   hangs and `BrandAPI` is a stub. Wire the real endpoints.
3. **Secrets hygiene** — confirm the exposed Gemini key was rotated and that
   `.env` / Firebase config aren't committed. Verify before any public deploy.

## 🟠 HIGH (performance + a11y with real user impact)

1. **Split the 933 kB main bundle.** `dist/assets/index-*.js` bundles Firebase +
   Framer + Recharts into the shared chunk. Add `build.rollupOptions.output.
   manualChunks` in [`vite.config`](vite.config.ts) to split `firebase`,
   `motion`, `recharts` into vendor chunks. Target: main < 400 kB.
   *Verify:* `npm run build` chunk sizes; app still boots.
2. **Focus-trap + focus-return on `Sheet` and `Modal`.**
   ([`components/ui/Sheet.tsx`](components/ui/Sheet.tsx),
   [`Modal.tsx`](components/ui/Modal.tsx)) — trap Tab within an open overlay,
   restore focus to the trigger on close, close on Esc. This fixes the largest
   remaining a11y gap and benefits every screen using sheets.
3. **Route prefetch on idle.** Prefetch the likely-next lazy chunk (Home→Product,
   Login→Home) with `requestIdleCallback` to cut perceived nav latency.

## 🟡 MEDIUM (consistency + polish)

1. **Press-depth codemod.** ~30 `active:scale-95` cases (mostly buttons with
   `transition-[transform,border-color,...]`) were left because swapping to the
   `.press` token would drop their multi-prop transitions. Write a codemod that
   changes only the *scale value* `active:scale-95` → `active:scale-[0.96]`
   (the token depth) while preserving each element's `transition-*`. Files with
   the most: `Recommendation.tsx`, `Marketplace.tsx`, seller screens.
   *Verify:* grep shows a single press depth (0.90 / 0.96 / 0.98) app-wide.
2. **Remaining hand-rolled headings.** A handful of `font-display text-[Npx]`
   remain on inverted surfaces / data numerals (intentional) — audit and
   confirm each is genuinely an exception, migrate the rest to `display-*`/`title-*`.
3. **`viewsCount` / analytics dedupe review.** Confirm the Salon view-count
   session-dedupe (a Set ref in `CommunityFeed.tsx`) covers all counters.
4. **Empty/error/offline state audit.** Verify every list screen (Wishlist,
   Cart, Marketplace, Salon, Friends tabs) has a designed `EmptyState` and
   `ErrorState` — most do; confirm no raw "No data" strings remain.
5. **ft/in height toggle in Smart Fit** ([`SmartFitScan.tsx`](screens/SmartFitScan.tsx))
   for non-metric markets (Fit Profile already has it; reuse that unit logic).

## 🟢 LOW (nice-to-have / future delight)

1. **Reward celebrations.** Brass is reserved and currently under-used — add a
   tasteful confetti/scale moment on profile completion, first post, streak
   milestones (`services/styleJourney.ts` already emits events).
2. **Settings decomposition.** The ~130 kB `Settings.tsx` monolith can be split
   *only* once safe — see UX_DECISIONS. Do it behind tests, not opportunistically.
3. **Pose-guide SVG** in Smart Fit is crude; a polished silhouette would lift the
   camera step. Cosmetic.
4. **Skeleton coverage** on the few remaining spinner-only loads (Product Page
   AI result) → content-shaped skeletons.
5. **Haptics** on key interactions (`navigator.vibrate`) where supported.

---

## Testing checklist (run before any release)

- [ ] `npm run typecheck` clean
- [ ] `npm run build` succeeds; note chunk sizes
- [ ] Console clean across every journey (no errors, no debug logs)
- [ ] No horizontal overflow at 320 / 375 / 390 / 430 px
- [ ] Light **and** dark theme on every screen (toggle flips `html.dark`)
- [ ] Reduced-motion: animations collapse, nothing breaks
- [ ] Auth: phone-OTP demo (`123456`), Google sign-in, demo session, **logout**
- [ ] Closet: like/save/cart persist across reload and reflect in Wishlist/Cart
- [ ] Keyboard-only pass of the primary flows; focus visible; sheets trap focus
      (after HIGH #2)

## Launch checklist

- [ ] Rotate/confirm all API keys; no secrets in the repo
- [ ] Firebase security rules reviewed for the new `social`/`messages`/`looks`/
      `reports` collections
- [ ] Vendor chunks split (HIGH #1); Lighthouse mobile ≥ 90 perf
- [ ] Error boundary + offline banner verified on a throttled/offline device
- [ ] Analytics/consent wired for EU/India (DPDP) compliance
- [ ] First-time-user walkthrough signed off: first launch → onboarding → Smart
      Fit → Fit Profile → Home → Salon → Try-On → Buy → Seller onboarding →
      dashboard → logout

## Map for a new engineer

- **Screens:** `zipfend/screens/*.tsx` (43). Routes in `zipfend/App.tsx`.
- **UI kit:** `zipfend/components/ui/` (barrel `index.ts`). Never inline a primitive.
- **Design tokens:** `zipfend/design/tokens.css` + semantic utilities in
  `zipfend/index.css`.
- **Domain logic:** `zipfend/services/*`. **Never** call Firebase/HTTP directly
  from a screen for domain state — add/extend a service.
- **Cross-cutting state:** `zipfend/contexts/` (profile, toast).
- **Boot:** `npm run dev` in `zipfend/` (tsx server on :3000).
