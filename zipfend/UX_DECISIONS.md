# ZipRIGHT — UX Decisions & Rationale

Why the product is shaped the way it is. Each decision is recorded so nobody
re-litigates a settled call, and so the *intent* survives future refactors.

---

## Identity & design language

**"MAISON" — editorial luxury, not another sportswear app.**
Fashion-tech defaults to loud gradients, neon, and blue "tech" accents.
ZipRIGHT deliberately goes the other way: warm bone/espresso, a single burnt-
copper accent, serif display type, hairline structure, print-like flatness.
This is a trust signal — it reads as a considered *atelier*, which matters when
you're asking users to hand over body measurements and photos.

**Copper, never blue/violet.** An earlier violet accent tested as "cheap/techy"
with the founder. Copper is warm, editorial, and ownable. The rule is absolute:
zero blue, zero violet; teal (`info`) is the coolest note allowed. `brand-on-media`
is a fixed copper alias for text over photos (media is always dark, so it must
not theme-flip).

**Brass is sacred.** Brass is reserved exclusively for reward moments (streaks,
Style Score, ZipCoins) so those moments stay special and never blur into the
everyday accent.

## Navigation & information architecture

**Five plain-English dock tabs: Home · Shop · Studio · Social · You.**
After a multi-round navigation audit we removed jargon that a first-time user
can't parse: "Atelier" → **Studio**, "Circle" → **Friends/Social**. Wayfinding
must be literal even when the brand voice is poetic. (The tagline "The Fit
Atelier" survives on Splash/Welcome/About — identity is allowed to be poetic;
*navigation* isn't.)

**The Z "Studio" launcher is an AI toolkit, not a grab-bag.** It holds exactly
the four AI features — Virtual Try-On, AI Stylist, Find My Size, Avatar — each
with a value-statement subtitle ("See any outfit on you"), not an internal name.
The Salon row was removed from it because the Social dock tab reaches the same
place one tap away — no duplicated navigation.

**The Salon (fashion feed) is the front door of the Social tab.** Opening
Friends lands you *on the feed* with a Salon | Friends switcher, because a
social-commerce product's feed must be discoverable in one tap, not buried. The
feed is seeded with an editorial "opening collection" (house account) so a
brand-new user never hits an empty "be the first" dead end — and every seed look
is fully shoppable, so the feed proves the shopping loop from first launch.

## The flagship: Virtual Try-On

**One hero canvas + one control surface.** The screen was rebuilt from four
scattered control zones into a single immersive outfit canvas plus one glass
dock, because the outfit must be the hero and nothing should compete with it.
Hierarchy, top to bottom of the dock: fit → size → Try again → Save → **Buy**.

**Buy is copper, and it exists.** The original screen had *no* Buy button
despite being the flagship commerce moment — a conversion hole. Buy is now the
one copper CTA with a soft glow: unmistakable, and it can't be confused with the
neutral controls around it.

**Gesture-first with visible fallbacks.** Swipe the photo to change size,
double-tap to zoom — but the size pills and a zoom control still exist for
keyboard/AT users. A stable on-screen hint teaches the swipe (the old hint was
inverted: it only showed when you were *off* the recommended size, but you
*start* on it, so first-timers never learned it existed).

**No fake affordances.** We deleted the Front/Side/Back view buttons (they set
state nothing read — there's no 3D model) and the "fit heatmap" (a decorative
gradient pretending to be data). Honest chrome beats a fake feature. This is a
standing rule everywhere: if it can't be made real, it comes out.

## Interaction philosophy

**Subtle over noisy.** Premium apps don't interrupt for every tap. Likes give a
filling heart, not a "Liked ❤️" toast. Saves flip the CTA to "Saved," not a
toast. Toasts are reserved for errors and meaningful confirmations (e.g. a coin
reward). Several stray "Liked/Added" toasts were removed this pass.

**Every clickable thing does something real, or it's removed.** No dead UI: mail
addresses are `mailto:` links, share buttons have a clipboard fallback so they
don't silently no-op on desktop, and click-only `<div>`s were promoted to real
keyboard-reachable buttons.

**Optimistic, local-first state.** The closet (wishlist/cart/wardrobe) writes to
localStorage instantly and mirrors to Firestore best-effort, so the UI never
blocks on the network and demo sessions work fully. This is why like/save/cart
feel instant everywhere.

## Onboarding & forms

**Show forward motion.** Multi-step flows (Smart Fit, Create Look) use a
segmented progress bar, not just "Step 1 of 3" text — users need to feel
progress. Smart Fit's confusing step-4 exit (an X that dumped you back into the
camera) now exits cleanly.

**Reduce entry friction.** Number inputs use `inputMode="numeric"` +
`enterKeyHint` + Enter-to-advance so mobile keyboards help. Every field has an
accessible name even though labels render as styled eyebrows.

**cm-only height in Smart Fit is deliberate** (India-first market); a ft/in
toggle exists in the fuller Fit Profile form. Flagged in the roadmap, not a bug.

## Deliberate constraints (do not "fix" without asking)

- Entry screens (Splash/Welcome/Login) are **theme-fixed dark** — a cinematic
  brand moment, intentionally not theme-aware.
- Virtual Try-On / LiveTryOn / Salon feed are **force-dark** immersive surfaces;
  they use `brand-on-media` copper, which correctly does not flip with theme.
- `Settings.tsx` is a **~130 KB monolith kept intentionally un-split** — its
  dense interdependent view-state is safer as one unit than prematurely
  decomposed. Treat with care.
- Home's reel gesture system uses raw pointer events + direct transforms (not a
  motion lib) for 60fps on low-end devices — a performance decision, not an
  oversight.
- No real 3D try-on without garment assets; try-on accuracy improves only via
  the feedback loop. These expectations are already set — restate, don't
  re-litigate.
