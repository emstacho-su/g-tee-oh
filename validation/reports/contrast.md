# Colour contrast report (R3.13, O-346, O-365)

Written by `node scripts/check-contrast.mjs --write` (`just contrast-write`) from web/src/styles.css; `just contrast` checks that every pair passes and that this file is current. Do not edit by hand.

Minimums are WCAG 2 level AA: 4.5:1 for text (1.4.3), 3:1 for control edges and the focus ring (1.4.11). The source column names the palette hue each colour was derived from (owner palette, the --p-* primitives of styles.css: #8c1c13, #bf4342, #e7d7c1, #a78a7f, #735751).

## Gating pairs

| Theme | Foreground | Background | Ratio | Minimum | Result | Use | Foreground value and source | Background value and source |
|---|---|---|---|---|---|---|---|---|
| light | text | surface | 14.07 | 4.5 | pass | body text | #2b1a16 (735751 umber, deepened) | #f3ebdf (e7d7c1 cream, lifted) |
| light | text | surface-raised | 15.59 | 4.5 | pass | body text | #2b1a16 (735751 umber, deepened) | #fbf7f1 (e7d7c1 cream, lifted further) |
| light | text | surface-sunken | 11.80 | 4.5 | pass | body text | #2b1a16 (735751 umber, deepened) | #e7d7c1 (--p-cream, the palette value) |
| light | text-muted | surface | 5.53 | 4.5 | pass | secondary text | #735751 (--p-umber, the palette value) | #f3ebdf (e7d7c1 cream, lifted) |
| light | text-muted | surface-raised | 6.13 | 4.5 | pass | secondary text | #735751 (--p-umber, the palette value) | #fbf7f1 (e7d7c1 cream, lifted further) |
| light | text-muted | surface-sunken | 4.64 | 4.5 | pass | secondary text | #735751 (--p-umber, the palette value) | #e7d7c1 (--p-cream, the palette value) |
| light | accent | surface | 7.75 | 4.5 | pass | links and accent text | #8c1c13 (--p-oxblood, the palette value) | #f3ebdf (e7d7c1 cream, lifted) |
| light | accent | surface-raised | 8.59 | 4.5 | pass | links and accent text | #8c1c13 (--p-oxblood, the palette value) | #fbf7f1 (e7d7c1 cream, lifted further) |
| light | accent | surface-sunken | 6.50 | 4.5 | pass | links and accent text | #8c1c13 (--p-oxblood, the palette value) | #e7d7c1 (--p-cream, the palette value) |
| light | danger | surface | 6.29 | 4.5 | pass | error text | #a1271b (8c1c13 oxblood, lightened toward bf4342 brick) | #f3ebdf (e7d7c1 cream, lifted) |
| light | danger | surface-raised | 6.97 | 4.5 | pass | error text | #a1271b (8c1c13 oxblood, lightened toward bf4342 brick) | #fbf7f1 (e7d7c1 cream, lifted further) |
| light | danger | surface-sunken | 5.28 | 4.5 | pass | error text | #a1271b (8c1c13 oxblood, lightened toward bf4342 brick) | #e7d7c1 (--p-cream, the palette value) |
| light | success | surface | 6.19 | 4.5 | pass | success text | #36602f (no palette hue: an olive toned to 735751 umber (O-363)) | #f3ebdf (e7d7c1 cream, lifted) |
| light | success | surface-raised | 6.85 | 4.5 | pass | success text | #36602f (no palette hue: an olive toned to 735751 umber (O-363)) | #fbf7f1 (e7d7c1 cream, lifted further) |
| light | success | surface-sunken | 5.19 | 4.5 | pass | success text | #36602f (no palette hue: an olive toned to 735751 umber (O-363)) | #e7d7c1 (--p-cream, the palette value) |
| light | warning | surface | 6.01 | 4.5 | pass | warning text | #7a4f10 (no palette hue: an ochre toned to 735751 umber (O-363)) | #f3ebdf (e7d7c1 cream, lifted) |
| light | warning | surface-raised | 6.66 | 4.5 | pass | warning text | #7a4f10 (no palette hue: an ochre toned to 735751 umber (O-363)) | #fbf7f1 (e7d7c1 cream, lifted further) |
| light | warning | surface-sunken | 5.04 | 4.5 | pass | warning text | #7a4f10 (no palette hue: an ochre toned to 735751 umber (O-363)) | #e7d7c1 (--p-cream, the palette value) |
| light | accent-text | accent | 8.59 | 4.5 | pass | primary button label | #fbf7f1 (e7d7c1 cream, lifted) | #8c1c13 (--p-oxblood, the palette value) |
| light | accent-text | danger | 6.97 | 4.5 | pass | danger button label | #fbf7f1 (e7d7c1 cream, lifted) | #a1271b (8c1c13 oxblood, lightened toward bf4342 brick) |
| light | border-strong | surface | 5.53 | 3 | pass | control edge | #735751 (--p-umber, the palette value) | #f3ebdf (e7d7c1 cream, lifted) |
| light | border-strong | surface-raised | 6.13 | 3 | pass | control edge | #735751 (--p-umber, the palette value) | #fbf7f1 (e7d7c1 cream, lifted further) |
| light | border-strong | surface-sunken | 4.64 | 3 | pass | control edge | #735751 (--p-umber, the palette value) | #e7d7c1 (--p-cream, the palette value) |
| light | focus | surface | 4.34 | 3 | pass | focus ring | #bf4342 (--p-brick, the palette value) | #f3ebdf (e7d7c1 cream, lifted) |
| light | focus | surface-raised | 4.80 | 3 | pass | focus ring | #bf4342 (--p-brick, the palette value) | #fbf7f1 (e7d7c1 cream, lifted further) |
| light | focus | surface-sunken | 3.63 | 3 | pass | focus ring | #bf4342 (--p-brick, the palette value) | #e7d7c1 (--p-cream, the palette value) |
| light | heat-ink-low | heat-1 | 7.32 | 4.5 | pass | heat map cell label | #2b1a16 (735751 umber, deepened) | #d1a195 (735751 umber hue, OKLCH lightness 0.75) |
| light | heat-ink-low | heat-2 | 5.00 | 4.5 | pass | heat map cell label | #2b1a16 (735751 umber, deepened) | #b87f70 (735751 umber hue, OKLCH lightness 0.65) |
| light | heat-ink-high | heat-3 | 4.70 | 4.5 | pass | heat map cell label | #fbf7f1 (e7d7c1 cream, lifted) | #9d5f4f (735751 umber hue, OKLCH lightness 0.55) |
| light | heat-ink-high | heat-4 | 7.29 | 4.5 | pass | heat map cell label | #fbf7f1 (e7d7c1 cream, lifted) | #7d4234 (735751 umber hue, OKLCH lightness 0.45) |
| light | heat-ink-high | heat-5 | 10.96 | 4.5 | pass | heat map cell label | #fbf7f1 (e7d7c1 cream, lifted) | #5b2a1e (735751 umber hue, OKLCH lightness 0.35) |
| dark | text | surface | 15.59 | 4.5 | pass | body text | #ececec (no palette hue: a neutral off-white (O-430)) | #141414 (no palette hue: a neutral near-black ground (O-430)) |
| dark | text | surface-raised | 14.11 | 4.5 | pass | body text | #ececec (no palette hue: a neutral off-white (O-430)) | #1e1e1e (no palette hue: a neutral gray, one step above the ground (O-430)) |
| dark | text | surface-sunken | 16.34 | 4.5 | pass | body text | #ececec (no palette hue: a neutral off-white (O-430)) | #0e0e0e (no palette hue: a neutral near-black, below the ground (O-430)) |
| dark | text-muted | surface | 7.75 | 4.5 | pass | secondary text | #a8a8a8 (no palette hue: a neutral light gray (O-430)) | #141414 (no palette hue: a neutral near-black ground (O-430)) |
| dark | text-muted | surface-raised | 7.01 | 4.5 | pass | secondary text | #a8a8a8 (no palette hue: a neutral light gray (O-430)) | #1e1e1e (no palette hue: a neutral gray, one step above the ground (O-430)) |
| dark | text-muted | surface-sunken | 8.12 | 4.5 | pass | secondary text | #a8a8a8 (no palette hue: a neutral light gray (O-430)) | #0e0e0e (no palette hue: a neutral near-black, below the ground (O-430)) |
| dark | accent | surface | 6.12 | 4.5 | pass | links and accent text | #e0766c (bf4342 brick, lifted) | #141414 (no palette hue: a neutral near-black ground (O-430)) |
| dark | accent | surface-raised | 5.54 | 4.5 | pass | links and accent text | #e0766c (bf4342 brick, lifted) | #1e1e1e (no palette hue: a neutral gray, one step above the ground (O-430)) |
| dark | accent | surface-sunken | 6.41 | 4.5 | pass | links and accent text | #e0766c (bf4342 brick, lifted) | #0e0e0e (no palette hue: a neutral near-black, below the ground (O-430)) |
| dark | danger | surface | 7.58 | 4.5 | pass | error text | #f08a7e (bf4342 brick, lifted further) | #141414 (no palette hue: a neutral near-black ground (O-430)) |
| dark | danger | surface-raised | 6.86 | 4.5 | pass | error text | #f08a7e (bf4342 brick, lifted further) | #1e1e1e (no palette hue: a neutral gray, one step above the ground (O-430)) |
| dark | danger | surface-sunken | 7.94 | 4.5 | pass | error text | #f08a7e (bf4342 brick, lifted further) | #0e0e0e (no palette hue: a neutral near-black, below the ground (O-430)) |
| dark | success | surface | 9.39 | 4.5 | pass | success text | #9cc48f (no palette hue: the olive, lifted (O-363)) | #141414 (no palette hue: a neutral near-black ground (O-430)) |
| dark | success | surface-raised | 8.50 | 4.5 | pass | success text | #9cc48f (no palette hue: the olive, lifted (O-363)) | #1e1e1e (no palette hue: a neutral gray, one step above the ground (O-430)) |
| dark | success | surface-sunken | 9.84 | 4.5 | pass | success text | #9cc48f (no palette hue: the olive, lifted (O-363)) | #0e0e0e (no palette hue: a neutral near-black, below the ground (O-430)) |
| dark | warning | surface | 9.39 | 4.5 | pass | warning text | #e4b066 (no palette hue: the ochre, lifted (O-363)) | #141414 (no palette hue: a neutral near-black ground (O-430)) |
| dark | warning | surface-raised | 8.49 | 4.5 | pass | warning text | #e4b066 (no palette hue: the ochre, lifted (O-363)) | #1e1e1e (no palette hue: a neutral gray, one step above the ground (O-430)) |
| dark | warning | surface-sunken | 9.84 | 4.5 | pass | warning text | #e4b066 (no palette hue: the ochre, lifted (O-363)) | #0e0e0e (no palette hue: a neutral near-black, below the ground (O-430)) |
| dark | accent-text | accent | 6.12 | 4.5 | pass | primary button label | #141414 (no palette hue: the neutral near-black ground (O-430)) | #e0766c (bf4342 brick, lifted) |
| dark | accent-text | danger | 7.58 | 4.5 | pass | danger button label | #141414 (no palette hue: the neutral near-black ground (O-430)) | #f08a7e (bf4342 brick, lifted further) |
| dark | border-strong | surface | 4.99 | 3 | pass | control edge | #858585 (no palette hue: a neutral gray (O-430); control edges (CONTROL_EDGE_CLASS), checked at 3:1) | #141414 (no palette hue: a neutral near-black ground (O-430)) |
| dark | border-strong | surface-raised | 4.52 | 3 | pass | control edge | #858585 (no palette hue: a neutral gray (O-430); control edges (CONTROL_EDGE_CLASS), checked at 3:1) | #1e1e1e (no palette hue: a neutral gray, one step above the ground (O-430)) |
| dark | border-strong | surface-sunken | 5.23 | 3 | pass | control edge | #858585 (no palette hue: a neutral gray (O-430); control edges (CONTROL_EDGE_CLASS), checked at 3:1) | #0e0e0e (no palette hue: a neutral near-black, below the ground (O-430)) |
| dark | focus | surface | 15.59 | 3 | pass | focus ring | #ececec (no palette hue: the neutral off-white of --text, apart from the red hero ring (O-432)) | #141414 (no palette hue: a neutral near-black ground (O-430)) |
| dark | focus | surface-raised | 14.11 | 3 | pass | focus ring | #ececec (no palette hue: the neutral off-white of --text, apart from the red hero ring (O-432)) | #1e1e1e (no palette hue: a neutral gray, one step above the ground (O-430)) |
| dark | focus | surface-sunken | 16.34 | 3 | pass | focus ring | #ececec (no palette hue: the neutral off-white of --text, apart from the red hero ring (O-432)) | #0e0e0e (no palette hue: a neutral near-black, below the ground (O-430)) |
| dark | heat-ink-low | heat-1 | 7.07 | 4.5 | pass | heat map cell label | #fafafa (no palette hue: a neutral white (O-430)) | #7e4739 (735751 umber hue, OKLCH lightness 0.46) |
| dark | heat-ink-low | heat-2 | 4.81 | 4.5 | pass | heat map cell label | #fafafa (no palette hue: a neutral white (O-430)) | #9d5f4f (735751 umber hue, OKLCH lightness 0.55) |
| dark | heat-ink-high | heat-3 | 6.21 | 4.5 | pass | heat map cell label | #141414 (no palette hue: the neutral near-black ground (O-430)) | #c48777 (735751 umber hue, OKLCH lightness 0.68) |
| dark | heat-ink-high | heat-4 | 9.30 | 4.5 | pass | heat map cell label | #141414 (no palette hue: the neutral near-black ground (O-430)) | #e1ac9f (735751 umber hue, OKLCH lightness 0.79) |
| dark | heat-ink-high | heat-5 | 13.46 | 4.5 | pass | heat map cell label | #141414 (no palette hue: the neutral near-black ground (O-430)) | #f7d5cc (735751 umber hue, OKLCH lightness 0.90) |
| dark | focus | focus-halo | 14.11 | 9 | pass | two-colour focus ring (C40) | #ececec (no palette hue: the neutral off-white of --text, apart from the red hero ring (O-432)) | #1e1e1e (no palette hue: a neutral gray, one step above the ground (O-430)) |

Failures: none.

## Solver surface colours (gating, O-389)

Action colours and the bet and raise size shades (web/src/theme/action-style.ts), the theme felt and every cosmetic felt (styles.css) at 3:1 on the grounds the table and the matrix sit on (1.4.11), and the table's white text at 4.5:1 on every felt (1.4.3). Every action also carries a pattern or a printed label (A7 section 4), so colour is never the only signal.

| Theme | Colour | Value | Ground | Ratio | Minimum | Result |
|---|---|---|---|---|---|---|
| light | Fold (action) | #2563eb | surface | 4.37 | 3 | pass |
| light | Fold (action) | #2563eb | surface-raised | 4.84 | 3 | pass |
| light | Check (action) | #15803d | surface | 4.24 | 3 | pass |
| light | Check (action) | #15803d | surface-raised | 4.70 | 3 | pass |
| light | Call (action) | #15803d | surface | 4.24 | 3 | pass |
| light | Call (action) | #15803d | surface-raised | 4.70 | 3 | pass |
| light | Limp (action) | #4d7c0f | surface | 4.22 | 3 | pass |
| light | Limp (action) | #4d7c0f | surface-raised | 4.68 | 3 | pass |
| light | Straddle (action) | #6d28d9 | surface | 6.01 | 3 | pass |
| light | Straddle (action) | #6d28d9 | surface-raised | 6.66 | 3 | pass |
| light | Bet (action) | #dc2626 | surface | 4.08 | 3 | pass |
| light | Bet (action) | #dc2626 | surface-raised | 4.52 | 3 | pass |
| light | Raise (action) | #dc2626 | surface | 4.08 | 3 | pass |
| light | Raise (action) | #dc2626 | surface-raised | 4.52 | 3 | pass |
| light | All-in (action) | #86198f | surface | 6.97 | 3 | pass |
| light | All-in (action) | #86198f | surface-raised | 7.72 | 3 | pass |
| light | raise and bet size shade 1 | #dc2626 | surface | 4.08 | 3 | pass |
| light | raise and bet size shade 1 | #dc2626 | surface-raised | 4.52 | 3 | pass |
| light | raise and bet size shade 2 | #b91c1c | surface | 5.47 | 3 | pass |
| light | raise and bet size shade 2 | #b91c1c | surface-raised | 6.06 | 3 | pass |
| light | raise and bet size shade 3 | #991b1b | surface | 7.03 | 3 | pass |
| light | raise and bet size shade 3 | #991b1b | surface-raised | 7.79 | 3 | pass |
| light | raise and bet size shade 4 | #7f1d1d | surface | 8.47 | 3 | pass |
| light | raise and bet size shade 4 | #7f1d1d | surface-raised | 9.39 | 3 | pass |
| light | felt | #166534 | surface | 6.03 | 3 | pass |
| light | felt | #166534 | surface-raised | 6.68 | 3 | pass |
| light | felt none | #166534 | surface | 6.03 | 3 | pass |
| light | felt none | #166534 | surface-raised | 6.68 | 3 | pass |
| light | felt felt-tier-III | #1e40af | surface | 7.38 | 3 | pass |
| light | felt felt-tier-III | #1e40af | surface-raised | 8.17 | 3 | pass |
| light | felt felt-tier-V | #9f1239 | surface | 6.78 | 3 | pass |
| light | felt felt-tier-V | #9f1239 | surface-raised | 7.51 | 3 | pass |
| light | felt felt-tier-VII | #5b21b6 | surface | 7.60 | 3 | pass |
| light | felt felt-tier-VII | #5b21b6 | surface-raised | 8.42 | 3 | pass |
| light | table ink | #ffffff | felt #166534 | 7.13 | 4.5 | pass |
| light | table ink | #ffffff | felt none #166534 | 7.13 | 4.5 | pass |
| light | table ink | #ffffff | felt felt-tier-III #1e40af | 8.72 | 4.5 | pass |
| light | table ink | #ffffff | felt felt-tier-V #9f1239 | 8.02 | 4.5 | pass |
| light | table ink | #ffffff | felt felt-tier-VII #5b21b6 | 8.98 | 4.5 | pass |
| dark | Fold (action) | #3b82f6 | surface | 5.01 | 3 | pass |
| dark | Fold (action) | #3b82f6 | surface-raised | 4.53 | 3 | pass |
| dark | Check (action) | #22c55e | surface | 8.08 | 3 | pass |
| dark | Check (action) | #22c55e | surface-raised | 7.32 | 3 | pass |
| dark | Call (action) | #22c55e | surface | 8.08 | 3 | pass |
| dark | Call (action) | #22c55e | surface-raised | 7.32 | 3 | pass |
| dark | Limp (action) | #84cc16 | surface | 9.33 | 3 | pass |
| dark | Limp (action) | #84cc16 | surface-raised | 8.44 | 3 | pass |
| dark | Straddle (action) | #a78bfa | surface | 6.77 | 3 | pass |
| dark | Straddle (action) | #a78bfa | surface-raised | 6.13 | 3 | pass |
| dark | Bet (action) | #ef4444 | surface | 4.90 | 3 | pass |
| dark | Bet (action) | #ef4444 | surface-raised | 4.43 | 3 | pass |
| dark | Raise (action) | #ef4444 | surface | 4.90 | 3 | pass |
| dark | Raise (action) | #ef4444 | surface-raised | 4.43 | 3 | pass |
| dark | All-in (action) | #e879f9 | surface | 7.49 | 3 | pass |
| dark | All-in (action) | #e879f9 | surface-raised | 6.77 | 3 | pass |
| dark | raise and bet size shade 1 | #ef4444 | surface | 4.90 | 3 | pass |
| dark | raise and bet size shade 1 | #ef4444 | surface-raised | 4.43 | 3 | pass |
| dark | raise and bet size shade 2 | #f87171 | surface | 6.66 | 3 | pass |
| dark | raise and bet size shade 2 | #f87171 | surface-raised | 6.03 | 3 | pass |
| dark | raise and bet size shade 3 | #fca5a5 | surface | 9.71 | 3 | pass |
| dark | raise and bet size shade 3 | #fca5a5 | surface-raised | 8.78 | 3 | pass |
| dark | raise and bet size shade 4 | #fecaca | surface | 12.73 | 3 | pass |
| dark | raise and bet size shade 4 | #fecaca | surface-raised | 11.52 | 3 | pass |
| dark | felt | #15803d | surface | 3.67 | 3 | pass |
| dark | felt | #15803d | surface-raised | 3.32 | 3 | pass |
| dark | felt none | #15803d | surface | 3.67 | 3 | pass |
| dark | felt none | #15803d | surface-raised | 3.32 | 3 | pass |
| dark | felt felt-tier-III | #2563eb | surface | 3.56 | 3 | pass |
| dark | felt felt-tier-III | #2563eb | surface-raised | 3.23 | 3 | pass |
| dark | felt felt-tier-V | #e11d48 | surface | 3.92 | 3 | pass |
| dark | felt felt-tier-V | #e11d48 | surface-raised | 3.55 | 3 | pass |
| dark | felt felt-tier-VII | #8244f0 | surface | 3.54 | 3 | pass |
| dark | felt felt-tier-VII | #8244f0 | surface-raised | 3.20 | 3 | pass |
| dark | table ink | #ffffff | felt #15803d | 5.02 | 4.5 | pass |
| dark | table ink | #ffffff | felt none #15803d | 5.02 | 4.5 | pass |
| dark | table ink | #ffffff | felt felt-tier-III #2563eb | 5.17 | 4.5 | pass |
| dark | table ink | #ffffff | felt felt-tier-V #e11d48 | 4.70 | 4.5 | pass |
| dark | table ink | #ffffff | felt felt-tier-VII #8244f0 | 5.21 | 4.5 | pass |

Solver failures: none.

## Neutral dark base (gating, O-430)

The dark grounds, edges, text, heat inks, overlay and every shadow layer are gray and black: each colour they hold, resolved, at 10% HSL saturation or less. The palette reds stay as accent, focus and danger and are not listed.

| Token | Colours | Highest HSL saturation | Maximum | Result |
|---|---|---|---|---|
| surface | #141414 | 0.0% | 10% | pass |
| surface-raised | #1e1e1e | 0.0% | 10% | pass |
| surface-sunken | #0e0e0e | 0.0% | 10% | pass |
| border | #444444 | 0.0% | 10% | pass |
| border-strong | #858585 | 0.0% | 10% | pass |
| text | #ececec | 0.0% | 10% | pass |
| text-muted | #a8a8a8 | 0.0% | 10% | pass |
| accent-text | #141414 | 0.0% | 10% | pass |
| focus | #ececec | 0.0% | 10% | pass |
| focus-halo | #1e1e1e | 0.0% | 10% | pass |
| heat-ink-low | #fafafa | 0.0% | 10% | pass |
| heat-ink-high | #141414 | 0.0% | 10% | pass |
| overlay | rgb(0 0 0) | 0.0% | 10% | pass |
| shadow-raised | rgb(255 255 255), rgb(0 0 0), rgb(0 0 0), rgb(0 0 0) | 0.0% | 10% | pass |
| shadow-press-rest | rgb(255 255 255), rgb(0 0 0), rgb(0 0 0), rgb(0 0 0) | 0.0% | 10% | pass |
| shadow-press-hover | rgb(255 255 255), rgb(0 0 0), rgb(0 0 0), rgb(0 0 0) | 0.0% | 10% | pass |
| shadow-press-down | rgb(0 0 0), rgb(255 255 255), rgb(0 0 0) | 0.0% | 10% | pass |

Neutral failures: none.

## Focus ring on the solver fills (gating, O-432)

Dark only. Where the focus ring is drawn over a fill (a range matrix cell, the marked roll band), the ring or the halo of the ground inside it reaches 3:1 on the fill (1.4.11); on the felt, where the active seat ring has no halo, the ring itself does.

| Theme | Fill | Value | Ring | Ratio | Minimum | Result |
|---|---|---|---|---|---|---|
| dark | Fold (action) | #3b82f6 | ring #ececec, halo #1e1e1e | 4.53 | 3 | pass |
| dark | Check (action) | #22c55e | ring #ececec, halo #1e1e1e | 7.32 | 3 | pass |
| dark | Call (action) | #22c55e | ring #ececec, halo #1e1e1e | 7.32 | 3 | pass |
| dark | Limp (action) | #84cc16 | ring #ececec, halo #1e1e1e | 8.44 | 3 | pass |
| dark | Straddle (action) | #a78bfa | ring #ececec, halo #1e1e1e | 6.13 | 3 | pass |
| dark | Bet (action) | #ef4444 | ring #ececec, halo #1e1e1e | 4.43 | 3 | pass |
| dark | Raise (action) | #ef4444 | ring #ececec, halo #1e1e1e | 4.43 | 3 | pass |
| dark | All-in (action) | #e879f9 | ring #ececec, halo #1e1e1e | 6.77 | 3 | pass |
| dark | raise and bet size shade 1 | #ef4444 | ring #ececec, halo #1e1e1e | 4.43 | 3 | pass |
| dark | raise and bet size shade 2 | #f87171 | ring #ececec, halo #1e1e1e | 6.03 | 3 | pass |
| dark | raise and bet size shade 3 | #fca5a5 | ring #ececec, halo #1e1e1e | 8.78 | 3 | pass |
| dark | raise and bet size shade 4 | #fecaca | ring #ececec, halo #1e1e1e | 11.52 | 3 | pass |
| dark | EV step -1 | #593d3a | ring #ececec, halo #1e1e1e | 8.25 | 3 | pass |
| dark | EV step -2 | #7c4744 | ring #ececec, halo #1e1e1e | 6.26 | 3 | pass |
| dark | EV step -3 | #a0514d | ring #ececec, halo #1e1e1e | 4.70 | 3 | pass |
| dark | EV step -4 | #f2827c | ring #ececec, halo #1e1e1e | 6.56 | 3 | pass |
| dark | EV step -5 | #ffb0a9 | ring #ececec, halo #1e1e1e | 9.55 | 3 | pass |
| dark | EV neutral | #333333 | ring #ececec, halo #1e1e1e | 10.69 | 3 | pass |
| dark | EV step +1 | #37465a | ring #ececec, halo #1e1e1e | 8.13 | 3 | pass |
| dark | EV step +2 | #3e5a7d | ring #ececec, halo #1e1e1e | 6.00 | 3 | pass |
| dark | EV step +3 | #446da2 | ring #ececec, halo #1e1e1e | 4.49 | 3 | pass |
| dark | EV step +4 | #71aaf3 | ring #ececec, halo #1e1e1e | 6.94 | 3 | pass |
| dark | EV step +5 | #a2caff | ring #ececec, halo #1e1e1e | 9.87 | 3 | pass |
| dark | --heat-1 | #7e4739 | ring #ececec, halo #1e1e1e | 6.24 | 3 | pass |
| dark | --heat-2 | #9d5f4f | ring #ececec, halo #1e1e1e | 4.25 | 3 | pass |
| dark | --heat-3 | #c48777 | ring #ececec, halo #1e1e1e | 5.62 | 3 | pass |
| dark | --heat-4 | #e1ac9f | ring #ececec, halo #1e1e1e | 8.42 | 3 | pass |
| dark | --heat-5 | #f7d5cc | ring #ececec, halo #1e1e1e | 12.18 | 3 | pass |
| dark | felt | #15803d | ring #ececec (active seat) | 4.25 | 3 | pass |
| dark | felt none | #15803d | ring #ececec (active seat) | 4.25 | 3 | pass |
| dark | felt felt-tier-III | #2563eb | ring #ececec (active seat) | 4.38 | 3 | pass |
| dark | felt felt-tier-V | #e11d48 | ring #ececec (active seat) | 3.98 | 3 | pass |
| dark | felt felt-tier-VII | #8244f0 | ring #ececec (active seat) | 4.41 | 3 | pass |

Focus ring failures: none.
