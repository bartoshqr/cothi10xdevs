# Landing Page Refresh — Plan Brief

> Full plan: `context/changes/landing-page-refresh/plan.md`

## What & Why

Replace the "10x Astro Starter" boilerplate with a WVMap product landing page in Polish, and restyle all auth pages to match the new design system. The landing page is the first thing Polish climate advocates see — it needs to pitch the product. Auth pages currently clash visually (cosmic theme vs clean card design).

## Starting Point

`index.astro` renders a cosmic-theme "10x Astro Starter" placeholder. A complete v0 Next.js design (`landing-page-from-v0-inspiration/`) provides all Polish copy and the ArgumentMapMockup visual. Auth pages (`signin.astro`, `signup.astro`, `confirm-email.astro`) and their shared form components use hardcoded purple/cosmic classes that don't map to the CSS variable design system.

## Desired End State

`/` shows the full WVMap landing page (header, hero, problem/solution, how it works, features, CTA, footer — all in Polish). Auth pages show clean white cards using CSS custom properties. Sign-in has "Nie masz konta? Zarejestruj się"; sign-up has "Masz już konto? Zaloguj się". All unimplemented routes (FAQ, privacy, terms) resolve to `/coming-soon`.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) |
| --- | --- | --- |
| Header interactivity | Pure `.astro`, no mobile menu | MVP is desktop-only — no React island needed |
| Icons in `.astro` files | Inline SVG paths | Static Astro files can't import lucide-react directly |
| Header auth CTAs | "Zaloguj się" + "Stwórz mapę" only | Matches v0 design; "Zarejestruj się" lives on the sign-in page |
| "Zarejestruj się" placement | Cross-link on sign-in page | "Nie masz konta? Zarejestruj się" is the standard pattern |
| Unimplemented routes | All → `/coming-soon` | FAQ, privacy policy, terms not built in this slice |
| Auth form restyling | Replace hardcoded cosmic classes with CSS vars | Shared components (`FormField`, `SubmitButton`, `ServerError`) own the visual — one change fixes all three pages |
| Auth page headings | Translate to Polish | Consistent with landing page language |
| "Mapa" nav link | Removed | Just scrolled to hero mockup; adds no value |

## Scope

**In scope:** 8 landing components, `index.astro`, `coming-soon.astro`, 3 auth `.astro` shells, `FormField.tsx`, `SubmitButton.tsx`, `ServerError.tsx`, one inline fix in `SignUpForm.tsx`

**Out of scope:** Mobile responsive header, dark mode, SEO/OG meta, form validation error translation, deleting `Welcome.astro`/`Topbar.astro`

## Architecture / Approach

All landing sections are pure `.astro` (static, no hydration). Auth form components get surgical class replacements — logic untouched. Auth page shells get new card containers and Polish headings. No new dependencies.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Landing sections | 8 `.astro` components translated from v0 | Lucide SVG paths must be inlined manually |
| 2. Wire index + coming-soon | `/` shows landing page; dead routes resolve | Straightforward assembly |
| 3. Auth restyling | Auth pages match landing design system | Form flow must still work after class changes |

**Prerequisites:** None — lucide-react, Button component, and CSS variables are already in place.  
**Estimated effort:** ~1 session across 3 phases.

## Open Risks & Assumptions

- `SubmitButton` uses `useFormStatus` from `react-dom` — removing the className override must not break the pending spinner styling
- `confirm-email.astro` has two content variants (DEV auto-confirm vs prod email) — both need to look correct after restyling

## Success Criteria (Summary)

- `/` renders full WVMap landing page with no boilerplate; all CTAs route correctly
- All auth pages use clean card design matching the landing page palette
- Sign-in/sign-up flows work end-to-end after restyling
