# ADR-0016 — "Pearl & Ink" interface and motion system

_Status: accepted · Date: 2026-10-23_

## Decision
- **Two surfaces.** The *ink* stage (shell sidebar, sign-in, two-step, invite) is near-black with film grain and a slow light aura. The *paper* workspace (#f6f6f3) keeps dense operational data high-contrast and calm for all-day use.
- **One signature material: pearl.** A silver → shell → periwinkle gradient used only for the active navigation marker, the brand mark, the rule that draws under every page title, and the sign-in rail. The historic `teal-*` utilities are remapped in the theme to a periwinkle-indigo action scale, so links, focus rings and selected states change in one place.
- **Type.** Onest Variable (self-hosted via @fontsource; CSP `font-src 'self'` unchanged). Display titles are weight ≈340 with tight tracking and an ink→graphite gradient fill painted on the glyph line itself (a transformed child would hide a parent's `background-clip:text`). Secondary text (`slate-500`) is deepened to keep ≥ 4.5:1 on paper.
- **Motion.** Springs are CSS `linear()` curves sampled from a mass-spring model (`--ease-spring`, `--ease-spring-soft`, `--ease-spring-snappy`), so no animation library or extra JavaScript is needed.
  - **One orchestrated moment per page:** the title rises line-by-line out of a mask and a hairline draws beneath it.
  - **Sign-in:** a "clinic day" rail draws across the stage while the day's checks pop onto it.
  - **Responsive motion only:** spring press on buttons, spring open on dialogs and drawers, lift and a pearl edge on clickable metric tiles, and a count-up on dashboard numbers (the server renders the final value; JavaScript only animates when motion is allowed).
- **Reduced motion is a first-class path.** Every animation collapses to 1 ms under `prefers-reduced-motion`, and the e2e suite runs in that mode (`contextOptions.reducedMotion`) so no assertion races an animation.
- **Custom CSS lives in `@layer components`** so Tailwind utilities can still override layout properties (an unlayered `display:block` broke a flex row during development).

## Evidence
- e2e 45/45, including axe WCAG 2.1 AA on 22 pages with 0 serious or critical issues.
- Load test PASS with p95 search 203 ms and page 153 ms. First-load JavaScript is unchanged at 194–241 KB gzip (the motion is CSS).
- Screenshots were reviewed mid-animation and at rest (sign-in desktop and mobile, home, dashboard, find, calendar, RCM, compliance, dialog).
