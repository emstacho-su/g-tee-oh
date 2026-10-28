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
| dark | text | surface | 14.64 | 4.5 | pass | body text | #efe4d6 (e7d7c1 cream, lifted) | #1c1210 (735751 umber, deepened) |
| dark | text | surface-raised | 13.39 | 4.5 | pass | body text | #efe4d6 (e7d7c1 cream, lifted) | #281a17 (735751 umber, deepened less) |
| dark | text | surface-sunken | 15.40 | 4.5 | pass | body text | #efe4d6 (e7d7c1 cream, lifted) | #140c0a (735751 umber, deepened most) |
| dark | text-muted | surface | 7.52 | 4.5 | pass | secondary text | #b9a196 (a78a7f taupe, lifted) | #1c1210 (735751 umber, deepened) |
| dark | text-muted | surface-raised | 6.88 | 4.5 | pass | secondary text | #b9a196 (a78a7f taupe, lifted) | #281a17 (735751 umber, deepened less) |
| dark | text-muted | surface-sunken | 7.91 | 4.5 | pass | secondary text | #b9a196 (a78a7f taupe, lifted) | #140c0a (735751 umber, deepened most) |
| dark | accent | surface | 6.10 | 4.5 | pass | links and accent text | #e0766c (bf4342 brick, lifted) | #1c1210 (735751 umber, deepened) |
| dark | accent | surface-raised | 5.58 | 4.5 | pass | links and accent text | #e0766c (bf4342 brick, lifted) | #281a17 (735751 umber, deepened less) |
| dark | accent | surface-sunken | 6.42 | 4.5 | pass | links and accent text | #e0766c (bf4342 brick, lifted) | #140c0a (735751 umber, deepened most) |
| dark | danger | surface | 7.56 | 4.5 | pass | error text | #f08a7e (bf4342 brick, lifted further) | #1c1210 (735751 umber, deepened) |
| dark | danger | surface-raised | 6.91 | 4.5 | pass | error text | #f08a7e (bf4342 brick, lifted further) | #281a17 (735751 umber, deepened less) |
| dark | danger | surface-sunken | 7.95 | 4.5 | pass | error text | #f08a7e (bf4342 brick, lifted further) | #140c0a (735751 umber, deepened most) |
| dark | success | surface | 9.36 | 4.5 | pass | success text | #9cc48f (no palette hue: the olive, lifted (O-363)) | #1c1210 (735751 umber, deepened) |
| dark | success | surface-raised | 8.56 | 4.5 | pass | success text | #9cc48f (no palette hue: the olive, lifted (O-363)) | #281a17 (735751 umber, deepened less) |
| dark | success | surface-sunken | 9.85 | 4.5 | pass | success text | #9cc48f (no palette hue: the olive, lifted (O-363)) | #140c0a (735751 umber, deepened most) |
| dark | warning | surface | 9.36 | 4.5 | pass | warning text | #e4b066 (no palette hue: the ochre, lifted (O-363)) | #1c1210 (735751 umber, deepened) |
| dark | warning | surface-raised | 8.56 | 4.5 | pass | warning text | #e4b066 (no palette hue: the ochre, lifted (O-363)) | #281a17 (735751 umber, deepened less) |
| dark | warning | surface-sunken | 9.85 | 4.5 | pass | warning text | #e4b066 (no palette hue: the ochre, lifted (O-363)) | #140c0a (735751 umber, deepened most) |
| dark | accent-text | accent | 6.10 | 4.5 | pass | primary button label | #1c1210 (735751 umber, deepened) | #e0766c (bf4342 brick, lifted) |
| dark | accent-text | danger | 7.56 | 4.5 | pass | danger button label | #1c1210 (735751 umber, deepened) | #f08a7e (bf4342 brick, lifted further) |
| dark | border-strong | surface | 5.76 | 3 | pass | control edge | #a78a7f (--p-taupe, the palette value) | #1c1210 (735751 umber, deepened) |
| dark | border-strong | surface-raised | 5.27 | 3 | pass | control edge | #a78a7f (--p-taupe, the palette value) | #281a17 (735751 umber, deepened less) |
| dark | border-strong | surface-sunken | 6.06 | 3 | pass | control edge | #a78a7f (--p-taupe, the palette value) | #140c0a (735751 umber, deepened most) |
| dark | focus | surface | 13.02 | 3 | pass | focus ring | #e7d7c1 (--p-cream, the palette value) | #1c1210 (735751 umber, deepened) |
| dark | focus | surface-raised | 11.91 | 3 | pass | focus ring | #e7d7c1 (--p-cream, the palette value) | #281a17 (735751 umber, deepened less) |
| dark | focus | surface-sunken | 13.70 | 3 | pass | focus ring | #e7d7c1 (--p-cream, the palette value) | #140c0a (735751 umber, deepened most) |
| dark | heat-ink-low | heat-1 | 6.91 | 4.5 | pass | heat map cell label | #fbf7f1 (e7d7c1 cream, lifted) | #7e4739 (735751 umber hue, OKLCH lightness 0.46) |
| dark | heat-ink-low | heat-2 | 4.70 | 4.5 | pass | heat map cell label | #fbf7f1 (e7d7c1 cream, lifted) | #9d5f4f (735751 umber hue, OKLCH lightness 0.55) |
| dark | heat-ink-high | heat-3 | 6.19 | 4.5 | pass | heat map cell label | #1c1210 (735751 umber, deepened) | #c48777 (735751 umber hue, OKLCH lightness 0.68) |
| dark | heat-ink-high | heat-4 | 9.27 | 4.5 | pass | heat map cell label | #1c1210 (735751 umber, deepened) | #e1ac9f (735751 umber hue, OKLCH lightness 0.79) |
| dark | heat-ink-high | heat-5 | 13.42 | 4.5 | pass | heat map cell label | #1c1210 (735751 umber, deepened) | #f7d5cc (735751 umber hue, OKLCH lightness 0.90) |

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
| dark | Fold (action) | #3b82f6 | surface | 4.99 | 3 | pass |
| dark | Fold (action) | #3b82f6 | surface-raised | 4.57 | 3 | pass |
| dark | Check (action) | #22c55e | surface | 8.06 | 3 | pass |
| dark | Check (action) | #22c55e | surface-raised | 7.37 | 3 | pass |
| dark | Call (action) | #22c55e | surface | 8.06 | 3 | pass |
| dark | Call (action) | #22c55e | surface-raised | 7.37 | 3 | pass |
| dark | Limp (action) | #84cc16 | surface | 9.30 | 3 | pass |
| dark | Limp (action) | #84cc16 | surface-raised | 8.50 | 3 | pass |
| dark | Straddle (action) | #a78bfa | surface | 6.75 | 3 | pass |
| dark | Straddle (action) | #a78bfa | surface-raised | 6.17 | 3 | pass |
| dark | Bet (action) | #ef4444 | surface | 4.88 | 3 | pass |
| dark | Bet (action) | #ef4444 | surface-raised | 4.46 | 3 | pass |
| dark | Raise (action) | #ef4444 | surface | 4.88 | 3 | pass |
| dark | Raise (action) | #ef4444 | surface-raised | 4.46 | 3 | pass |
| dark | All-in (action) | #e879f9 | surface | 7.46 | 3 | pass |
| dark | All-in (action) | #e879f9 | surface-raised | 6.83 | 3 | pass |
| dark | raise and bet size shade 1 | #ef4444 | surface | 4.88 | 3 | pass |
| dark | raise and bet size shade 1 | #ef4444 | surface-raised | 4.46 | 3 | pass |
| dark | raise and bet size shade 2 | #f87171 | surface | 6.64 | 3 | pass |
| dark | raise and bet size shade 2 | #f87171 | surface-raised | 6.07 | 3 | pass |
| dark | raise and bet size shade 3 | #fca5a5 | surface | 9.68 | 3 | pass |
| dark | raise and bet size shade 3 | #fca5a5 | surface-raised | 8.85 | 3 | pass |
| dark | raise and bet size shade 4 | #fecaca | surface | 12.70 | 3 | pass |
| dark | raise and bet size shade 4 | #fecaca | surface-raised | 11.61 | 3 | pass |
| dark | felt | #15803d | surface | 3.66 | 3 | pass |
| dark | felt | #15803d | surface-raised | 3.35 | 3 | pass |
| dark | felt none | #15803d | surface | 3.66 | 3 | pass |
| dark | felt none | #15803d | surface-raised | 3.35 | 3 | pass |
| dark | felt felt-tier-III | #2563eb | surface | 3.55 | 3 | pass |
| dark | felt felt-tier-III | #2563eb | surface-raised | 3.25 | 3 | pass |
| dark | felt felt-tier-V | #e11d48 | surface | 3.91 | 3 | pass |
| dark | felt felt-tier-V | #e11d48 | surface-raised | 3.58 | 3 | pass |
| dark | felt felt-tier-VII | #8244f0 | surface | 3.53 | 3 | pass |
| dark | felt felt-tier-VII | #8244f0 | surface-raised | 3.23 | 3 | pass |
| dark | table ink | #ffffff | felt #15803d | 5.02 | 4.5 | pass |
| dark | table ink | #ffffff | felt none #15803d | 5.02 | 4.5 | pass |
| dark | table ink | #ffffff | felt felt-tier-III #2563eb | 5.17 | 4.5 | pass |
| dark | table ink | #ffffff | felt felt-tier-V #e11d48 | 4.70 | 4.5 | pass |
| dark | table ink | #ffffff | felt felt-tier-VII #8244f0 | 5.21 | 4.5 | pass |

Solver failures: none.
