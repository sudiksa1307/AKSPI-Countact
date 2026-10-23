# Countact landing page: project notes

## Deployment
- Public website: https://akspi-countact.vercel.app
- The active landing page is `public/index.html`.

## What this is
- `countact-site.html` is a single-file static landing page for Countact, a concept dispenser that releases one sealed lens strip per press and keeps a separate count for each eye.
- All CSS and JS are inline. Images are base64 data URIs, so keep edits to text lines and avoid reformatting the long image lines.
- The page is a concept, not a shipped product. Keep the "concept simulation" and "proposed design" wording wherever it appears.

## Key structure (by id/class)
- Hero: `.hero`, `.media > .dw2` (dispenser overlay with `.scr` display, `.pin` hotspots, `#fx` flying strips), `#tip`, `.read`.
- Intro overlay IIFE at the top of the body script (sessionStorage key `ct-intro`). `#replay` in the footer replays it.
- Dispenser state: global `c={L:5,R:6}`. `render()`, `disp(x,w)`, `tip()`, origin map `FP`.
- Phone app chip (`.ph`, `.flow` svg) is added by script in the hero `.media`. `window.__pulse(x)` runs after a dispense on the hero dispenser. `window.__chip()` syncs the numbers.
- How it works: `#kcScroll` (340vh) holds the sticky `#kcStick` with the scroll-driven dispenser. The static `.steps` cards are hidden when `html.sx` is set (JS on, reduced motion off).
- Section entrances: `html.rv`, with `.fu` on headings and `.il` on illustrations, played once through IntersectionObserver.

## Rules for changes
- Respect `prefers-reduced-motion`. Animations must be disabled or fall back to the static layout.
- Do not edit the read-only upload copy. Work on a copy and publish the result to `/mnt/user-data/outputs/`.
- Test in headless Chromium (`/opt/pw-browsers/chromium`): check for page errors, the pulse, and the scroll steps 0→3 with count 5→4.

## Owner
- Jason Lukose. Keep copy plain and sales-ready. Do not add claims beyond what the concept supports.
