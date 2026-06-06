# Landing Page Refresh Implementation Plan

## Overview

Replace the boilerplate "10x Astro Starter" landing page with a proper WVMap product landing page translated from the v0 Next.js design, and restyle all auth pages to match the new design system. All copy is in Polish and targets the launch community of Polish climate advocates.

## Current State Analysis

- `src/pages/index.astro` renders `Welcome.astro` — a "10x Astro Starter" cosmic-theme placeholder.
- The v0 design at `landing-page-from-v0-inspiration/v0-wvmap-landing-page-main/` is a complete Next.js app with all Polish copy, sections, and the ArgumentMapMockup component.
- `lucide-react` (v1.14.0) is already installed.
- `src/components/ui/button.tsx` (CVA-based) is already present.
- CSS custom properties in `src/styles/global.css` (`--primary`, `--foreground`, `--border`, `--muted`, etc.) map directly to the Tailwind utility classes used in v0 — no CSS changes needed.
- Auth pages (`signin.astro`, `signup.astro`, `confirm-email.astro`) use the cosmic theme (`bg-cosmic`, `bg-white/10`, `border-white/10`, purple gradients). Auth form components (`FormField`, `SubmitButton`, `ServerError`) hardcode cosmic-specific classes.

### Key Discoveries

- All landing sections are fully static — no React islands needed. Header has no mobile menu (MVP decision), so `LandingHeader` is a pure `.astro` file.
- `argument-map-mockup.tsx` — no hooks or events, translates to pure `.astro`
- v0 uses Next.js `Link` — replace with `<a>` in Astro
- CTA buttons: "Zacznij budować swoją mapę" / "Załóż darmowe konto" → `/auth/signup`; "Zaloguj się" → `/auth/signin`; "Stwórz mapę" in header → `/auth/signup`
- `FormField.tsx` hardcodes `bg-white/10 text-white border-white/20 placeholder-white/40 text-blue-100/80` — needs replacement with CSS-var-based classes
- `SubmitButton.tsx` hardcodes `bg-purple-600 hover:bg-purple-500` — needs `bg-primary text-primary-foreground hover:bg-primary/90`
- `ServerError.tsx` hardcodes `bg-red-900/30 border-red-500/30 text-red-300` — needs `bg-destructive/10 border-destructive/30 text-destructive`
- `SignUpForm.tsx` has inline hint `text-blue-100/50` — needs `text-muted-foreground`
- `SignUpForm.tsx` availability indicator `text-green-400` is acceptable; keep as-is

## Desired End State

`/` renders the full WVMap landing page in Polish. Auth pages (`/auth/signin`, `/auth/signup`, `/auth/confirm-email`) use the landing page design system (clean card on white background, CSS variable colors, Polish headings and labels). Sign-in page has "Nie masz konta? Zarejestruj się"; sign-up page has "Masz już konto? Zaloguj się". `/coming-soon` exists for unimplemented routes.

## What We're NOT Doing

- No mobile responsive header — desktop-only for MVP
- No "Zarejestruj się" button in the header — only "Zaloguj się" and "Stwórz mapę"
- No dark mode toggle
- No SEO / Open Graph meta tags
- No analytics
- No FAQ, privacy policy, or terms pages (all → `/coming-soon`)
- Not deleting `Welcome.astro` / `Topbar.astro` (leave for post-merge cleanup)
- Not translating form validation error messages (keep English for now)

## Implementation Approach

All landing sections are static Astro components — no React islands. Auth form components get their hardcoded cosmic classes replaced with CSS-variable-based equivalents. Auth page shells get restyled card containers and Polish headings.

---

## Phase 1: Landing Section Components

### Overview

Create `src/components/landing/` with all section components translated from v0 into static `.astro` files. No React islands.

### Changes Required

#### 1. ArgumentMapMockup

**File:** `src/components/landing/ArgumentMapMockup.astro`

**Intent:** Static HTML rendering of the Toulmin map mockup shown in the hero. Translated directly from `argument-map-mockup.tsx` — no interactivity, just layout and styling.

**Contract:** Pure `.astro`, no props. All class names preserved from v0.

---

#### 2. HeroSection

**File:** `src/components/landing/HeroSection.astro`

**Intent:** Full-width hero with Polish headline, subline, "Zacznij budować swoją mapę" CTA, and `ArgumentMapMockup` in a two-column grid on large screens.

**Contract:** Imports `ArgumentMapMockup.astro`. CTA `<a href="/auth/signup">` styled with `bg-primary text-primary-foreground` classes to match the Button default variant. `id="hero"` on the section.

---

#### 3. ProblemSolutionSection

**File:** `src/components/landing/ProblemSolutionSection.astro`

**Intent:** Two-card grid: "Problem: Chaos" (red icon) and "Rozwiązanie: Struktura" (primary icon). Translated from `problem-solution-section.tsx`.

**Contract:** Pure Astro, no props. Icons inlined as SVG elements (copy `<path>` from lucide source for `MessageSquareX` and `GitBranch`).

---

#### 4. HowItWorksSection

**File:** `src/components/landing/HowItWorksSection.astro`

**Intent:** Four-step numbered grid with `id="jak-to-dziala"` for nav scroll anchor.

**Contract:** Pure Astro, no props. Inline SVG icons for PenLine, UserPlus, Scale, FileCheck. Step numbers (01–04) and connector lines preserved.

---

#### 5. FeaturesSection

**File:** `src/components/landing/FeaturesSection.astro`

**Intent:** Three-feature card grid (Integralność danych, Wymuszona reewaluacja, Blokada turowa).

**Contract:** Pure Astro, no props. Inline SVG icons for Shield, RefreshCw, Timer.

---

#### 6. CtaSection

**File:** `src/components/landing/CtaSection.astro`

**Intent:** Bottom CTA block with "Załóż darmowe konto" button.

**Contract:** CTA `<a href="/auth/signup">` styled to match primary button. Pure Astro.

---

#### 7. LandingFooter

**File:** `src/components/landing/LandingFooter.astro`

**Intent:** Copyright line and two footer links.

**Contract:** "Polityka prywatności" and "Regulamin" both link to `/coming-soon`. Pure Astro.

---

#### 8. LandingHeader

**File:** `src/components/landing/LandingHeader.astro`

**Intent:** Sticky top nav bar — logo on the left, nav links in the center, auth CTAs on the right. Desktop-only; no mobile menu.

**Contract:** Nav links: "Jak to działa" → `#jak-to-dziala`, "FAQ" → `/coming-soon`. No "Mapa" link. Right side: "Zaloguj się" `<a href="/auth/signin">` (ghost/muted style) and "Stwórz mapę" `<a href="/auth/signup">` (primary button style). Pure `.astro`, no React, no `client:` directive. Sticky with `position: sticky; top: 0; z-index: 50` and backdrop blur.

---

### Success Criteria

#### Automated Verification

- Build passes: `npm run build`
- Lint passes: `npm run lint`

#### Manual Verification

- All eight component files exist under `src/components/landing/`
- No Next.js imports remain in any component

---

## Phase 2: Wire Index and Add Coming-Soon Page

### Overview

Update `index.astro` to render the landing page. Create `/coming-soon` page.

### Changes Required

#### 1. index.astro

**File:** `src/pages/index.astro`

**Intent:** Replace `<Welcome />` with the full landing page.

**Contract:**

```astro
---
import Layout from "@/layouts/Layout.astro";
import LandingHeader from "@/components/landing/LandingHeader.astro";
import HeroSection from "@/components/landing/HeroSection.astro";
import ProblemSolutionSection from "@/components/landing/ProblemSolutionSection.astro";
import HowItWorksSection from "@/components/landing/HowItWorksSection.astro";
import FeaturesSection from "@/components/landing/FeaturesSection.astro";
import CtaSection from "@/components/landing/CtaSection.astro";
import LandingFooter from "@/components/landing/LandingFooter.astro";
---
<Layout title="WVMap">
  <div class="flex min-h-screen flex-col">
    <LandingHeader />
    <main class="flex-1">
      <HeroSection />
      <ProblemSolutionSection />
      <HowItWorksSection />
      <FeaturesSection />
      <CtaSection />
    </main>
    <LandingFooter />
  </div>
</Layout>
```

---

#### 2. coming-soon.astro

**File:** `src/pages/coming-soon.astro`

**Intent:** Minimal Polish-language "not yet available" page for all unimplemented routes.

**Contract:** Uses `Layout` with `title="Wkrótce — WVMap"`. Centered card (`bg-card border-border`) with heading "Wkrótce", one-line description in Polish, and a back link to `/` ("Wróć na stronę główną"). Uses CSS-var colors, no cosmic theme.

---

### Success Criteria

#### Automated Verification

- Build passes: `npm run build`
- Lint passes: `npm run lint`

#### Manual Verification

- `/` renders the WVMap landing page with all seven visible sections
- `/coming-soon` renders with a back link to `/`
- No "10x Astro Starter" text on `/`

---

## Phase 3: Auth Page Restyling

### Overview

Replace cosmic-theme styling in all auth pages and their shared form components with the landing page design system (clean light card, CSS custom properties). Translate page headings and the cross-link text to Polish.

### Changes Required

#### 1. FormField component

**File:** `src/components/auth/FormField.tsx`

**Intent:** Replace all hardcoded cosmic classes with CSS-variable-based equivalents so inputs look native to the landing page design system.

**Contract:** Replace `inputBase` string:
- `bg-white/10` → `bg-background`
- `text-white` → `text-foreground`
- `placeholder-white/40` → `placeholder:text-muted-foreground`
- Error border: `border-destructive/60 focus:ring-destructive/40`
- Default border: `border-input focus:ring-ring/50`

Replace label class `text-blue-100/80` → `text-foreground text-sm font-medium`.
Replace icon span class `text-white/40` → `text-muted-foreground`.

---

#### 2. SubmitButton component

**File:** `src/components/auth/SubmitButton.tsx`

**Intent:** Replace hardcoded purple button classes with the `Button` component's default variant (which already maps to `--primary`).

**Contract:** Remove the `className` override `bg-purple-600 px-4 py-2 font-medium text-white transition-colors hover:bg-purple-500` from the `Button` call — let the default variant apply. Add `size="lg"` and `className="w-full"`.

---

#### 3. ServerError component

**File:** `src/components/auth/ServerError.tsx`

**Intent:** Replace cosmic red classes with design-system destructive colors.

**Contract:** `bg-red-900/30 border-red-500/30 text-red-300` → `bg-destructive/10 border-destructive/30 text-destructive`.

---

#### 4. SignUpForm — password hint color

**File:** `src/components/auth/SignUpForm.tsx`

**Intent:** Fix the inline hint color that still references the cosmic palette.

**Contract:** Replace `text-blue-100/50` (password length hint) → `text-muted-foreground`.

---

#### 5. signin.astro

**File:** `src/pages/auth/signin.astro`

**Intent:** Restyle page shell and translate headings. Keep the "Nie masz konta? Zarejestruj się" cross-link.

**Contract:** Replace the outer wrapper from cosmic to:
```astro
<div class="flex min-h-screen items-center justify-center bg-background p-4">
  <div class="w-full max-w-sm rounded-2xl border border-border bg-card p-8 shadow-sm">
    <h1 class="mb-6 text-center text-2xl font-bold text-foreground">Zaloguj się</h1>
    <SignInForm serverError={error} client:load />
    <p class="mt-4 text-center text-sm text-muted-foreground">
      Nie masz konta?{" "}
      <a href="/auth/signup" class="text-primary underline-offset-4 hover:underline">Zarejestruj się</a>
    </p>
  </div>
</div>
```
Update `title` to `"Zaloguj się — WVMap"`.

---

#### 6. signup.astro

**File:** `src/pages/auth/signup.astro`

**Intent:** Restyle page shell and translate headings.

**Contract:** Same card structure as `signin.astro`. Heading: "Zarejestruj się". Cross-link: "Masz już konto? <a href='/auth/signin'>Zaloguj się</a>". Title: `"Zarejestruj się — WVMap"`.

---

#### 7. confirm-email.astro

**File:** `src/pages/auth/confirm-email.astro`

**Intent:** Restyle page shell to match the new design system. Keep emoji + conditional content logic.

**Contract:** Same card structure (`bg-background` outer, `bg-card border-border` card). Replace heading gradient `from-blue-200 to-purple-200 bg-clip-text text-transparent` with `text-foreground`. Replace description `text-blue-100/80` → `text-muted-foreground`. Replace link `text-purple-300` → `text-primary`. Translate static text to Polish where not already (headings are already in English via the `content` object — translate both variants' `heading`, `description`, `linkText` to Polish).

---

### Success Criteria

#### Automated Verification

- Build passes: `npm run build`
- Lint passes: `npm run lint`
- TypeScript passes (no type errors in modified components)

#### Manual Verification

- `/auth/signin` renders a clean white card with no cosmic/purple gradient styling
- `/auth/signup` same
- `/auth/confirm-email` same (test both DEV and the prod branch of the conditional)
- Sign-in page shows "Nie masz konta? Zarejestruj się" in Polish
- Sign-up page shows "Masz już konto? Zaloguj się" in Polish
- Form inputs have visible borders and dark text on white background
- Submit button uses primary color from landing page
- Error messages visible and styled correctly
- Actual sign-in and sign-up flows still work end-to-end

---

## Testing Strategy

### Manual Testing Steps

1. `npm run dev`
2. Visit `/` — scroll all sections, verify copy and layout
3. Click "Zacznij budować swoją mapę" → `/auth/signup` ✓
4. Click "Zaloguj się" in header → `/auth/signin` ✓
5. Click "FAQ" in header → `/coming-soon` ✓
6. Click footer links → `/coming-soon` ✓
7. `/auth/signin` — verify card styling, fill + submit valid credentials
8. `/auth/signup` — verify card styling, fill + submit, check "Masz już konto?" link
9. `/auth/confirm-email` — verify styling (toggle DEV flag to test both states)
10. Verify no purple gradients or cosmic styling remain on any auth page

## References

- v0 inspiration: `landing-page-from-v0-inspiration/v0-wvmap-landing-page-main/`
- Button component: `src/components/ui/button.tsx`
- Global CSS variables: `src/styles/global.css`
- Layout: `src/layouts/Layout.astro`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands.

### Phase 1: Landing Section Components

#### Automated

- [x] 1.1 Build passes: `npm run build` — 1a3e6ce
- [x] 1.2 Lint passes: `npm run lint` — 1a3e6ce

#### Manual

- [x] 1.3 All eight component files exist under `src/components/landing/`
- [x] 1.4 No Next.js imports remain in any component

### Phase 2: Wire Index and Add Coming-Soon Page

#### Automated

- [x] 2.1 Build passes: `npm run build` — 82a9430
- [x] 2.2 Lint passes: `npm run lint` — 82a9430

#### Manual

- [x] 2.3 `/` renders WVMap landing page with all sections — 82a9430
- [x] 2.4 CTA buttons route to correct auth pages — 82a9430
- [x] 2.5 Nav + footer unimplemented links go to `/coming-soon` — 82a9430
- [x] 2.6 `/coming-soon` renders with back link — 82a9430
- [x] 2.7 No "10x Astro Starter" text remains — 82a9430

### Phase 3: Auth Page Restyling

#### Automated

- [x] 3.1 Build passes: `npm run build` — d82803a
- [x] 3.2 Lint passes: `npm run lint` — d82803a
- [x] 3.3 TypeScript passes — d82803a

#### Manual

- [x] 3.4 `/auth/signin` has clean white card, no cosmic styling, Polish headings
- [x] 3.5 `/auth/signup` same
- [x] 3.6 `/auth/confirm-email` same, both DEV/prod content variants
- [x] 3.7 Sign-in and sign-up flows work end-to-end
- [x] 3.8 Form validation errors render correctly in new palette
