# Murray's Game — Design Inspiration Report
Award-winning brutalism + pixel/retro directions, and how to apply them.

> Method: five parallel research agents (brutalism, pixel/retro, fonts, accessibility,
> party-game UX), cross-checked. Direct page-fetch was 403-blocked in the research
> environment, so findings are corroborated from multiple search snippets plus official
> GitHub/Google Fonts repos. Low-confidence items flagged inline.

## 1. Neo-brutalism
Examples: Gumroad (trend-defining: thick black outlines, flat pastel fills, hard offset
shadows), Figma refresh, Tony's Chocolonely, MrBeast snacks; Awwwards Brutalism collection
(+ "Brutalism" longread, Honorable Mention).
Tokens: solid high-contrast flat colour, no gradients, thick borders (3-4px solid #000),
hard non-blurred offset shadows (box-shadow:4px 4px 0 #000 small / 8px 8px 0 large),
square/low radius, oversized grotesque headlines, chunky press feedback (element shifts
toward its shadow on hover/active).
Palettes: yellow #FFDB33 + pink/lavender on white w/ #000; muted set #f9b409 #f9d16a
#2a687a #72a25e #c3b49e #3c3434.
Sources: nngroup.com/articles/neobrutalism · github.com/khangtrannn/ng-brutalism ·
freefrontend.com/css-neobrutalism · awwwards.com/awwwards/collections/brutalism ·
colorswall.com/palette/225856

## 2. Pixel / retro-game
Examples: Awwwards pixel sites (Active Theory "Deliciously Dark Escape", Detective
Moustachio, Miu Miu fragrance game, "The Pixel" SOTD); Balatro (Apple Design Award 2025)
pairs pixel art w/ clean UI + juicy feedback; Stardew/Celeste/Shovel Knight.
Tokens: image-rendering:pixelated; CRT scanlines via repeating linear-gradient
(background-size:100% 8px) or ::before overlay; pixel type at multiples of 8px.
Palettes (hex):
- PICO-8 (16): #000000 #1D2B53 #7E2553 #008751 #AB5236 #5F574F #C2C3C7 #FFF1E8 #FF004D
  #FFA300 #FFEC27 #00E436 #29ADFF #83769C #FF77A8 #FFCCAA  (lospec.com/palette-list/pico-8)
- Game Boy DMG (4): #9BBC0F #8BAC0F #306230 #0F380F  (emulation convention, not exact hardware)
- DawnBringer 16 for richer work (lospec.com/palette-list/dawnbringer-16)
Sources: awwwards.com/inspiration/deliciously-dark-escape-pixel-art-webgl-game ·
theosoti.com/short/crispy-images · aleclownes.com/2017/02/01/crt-display ·
halabaojia.com/...balatro-visual-design-analysis · medium.com/@tkalamees/why-pixel-art-endured

## 3. Fonts (free on Google Fonts)
| Role | Brutalist | Pixel/retro |
|---|---|---|
| Display/wordmark | Anton, Archivo Black, Syne, Big Shoulders | Press Start 2P, Pixelify Sans |
| UI/body (readable) | Archivo, Space Grotesk, Inter | VT323, DotGothic16 (only pixel faces OK for runs) |
| Mono/HUD | Space Mono | Silkscreen (tiny labels) |
Caveat: keep Anton/pixel fonts out of long body; never render pixel fonts < ~16px or off
integer scale; always pair a pixel display with a non-pixel body.
Sources: fonts.google.com/specimen/{Archivo, Space+Grotesk, Press+Start+2P, VT323, Silkscreen, Pixelify+Sans}

## 4. Accessibility guardrails
- Contrast: body >= 4.5:1; large text (>=24px / 18.5px bold) >= 3:1; UI borders + focus rings
  >= 3:1 (fixes "is this a button?"). w3.org/WAI/WCAG21 1.4.3, 1.4.11
- Don't rely on colour alone for teams - pair colour with a shape/icon (Kahoot). kahoot/support
- Motion: no flashing > 3x/sec; gate CRT/scanline/glitch behind prefers-reduced-motion with a
  static fallback. WCAG 2.3.1 · MDN prefers-reduced-motion
- Tap targets >= 44x44 (Apple HIG / WCAG 2.5.5).
- Timer must not steal screen-reader focus (Kahoot finding); keep it aria-polite.
  colorado.edu/digital-accessibility/kahoot-accessibility-summary

## 5. Party-game UX patterns
- Join: short room code in huge type + QR + copy-link (three paths), projected big.
  jackboxgames.com/how-to-play · blooketlab.com/blooket-join
- Players/teams as colour-coded bordered "sticker" cards; instant feedback (Jackbox).
- Hero word = full-bleed bordered card, one massive word, nothing competing (Balatro).
- Timer/scoreboard: bold, juicy colour-shift + pulse as the round escalates.

## Recommendation: restrained neo-brutalism (pixel as accent)
Full pixel-art is a legibility tax on a word game. Neo-brutalism is the better base -
distinctive, shipped-proven, trivial in CSS, and the app is already halfway there (accent
offset-shadows on buttons). It keeps the cool/muted non-rainbow palette: brutalism's structure
comes from black borders + hard shadows, not loud colour. Optional pixel face on timer/HUD
numerals for arcade energy without hurting readability.

### Starter tokens
--ink:#14181D (text/borders/shadows); paper #E7EAED desk / #FBFCFD cards
--border:3px solid var(--ink); --shadow-sm:4px 4px 0; --shadow-md:6px 6px 0; --shadow-lg:8px 8px 0
--radius:4-6px; press: :active translate(3px,3px) + shadow->1px
Team accents (muted): #3B6EA5 #B15E86 #3E8E72 #6B5B9A #C2683F #2E8B8B + pair each with a shape
Type: Anton/Pixelify Sans display · Archivo/Space Grotesk UI · Space Mono / Silkscreen HUD
