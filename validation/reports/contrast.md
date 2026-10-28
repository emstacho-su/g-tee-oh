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

## Solver surface colours (information for S38, not gating)

Action colours (web/src/theme/action-style.ts) and the table felt against the grounds, at the 3:1 non-text guide. Every action also carries a pattern or a printed label (A7 section 4), so colour is never the only signal.

| Theme | Colour | Value | Ground | Ratio | At least 3:1 |
|---|---|---|---|---|---|
| light | Fold (action) | #60a5fa | surface | 2.15 | no |
| light | Fold (action) | #60a5fa | surface-raised | 2.38 | no |
| light | Check (action) | #4ade80 | surface | 1.47 | no |
| light | Check (action) | #4ade80 | surface-raised | 1.63 | no |
| light | Call (action) | #4ade80 | surface | 1.47 | no |
| light | Call (action) | #4ade80 | surface-raised | 1.63 | no |
| light | Limp (action) | #a3e635 | surface | 1.28 | no |
| light | Limp (action) | #a3e635 | surface-raised | 1.41 | no |
| light | Straddle (action) | #c084fc | surface | 2.23 | no |
| light | Straddle (action) | #c084fc | surface-raised | 2.48 | no |
| light | Bet (action) | #f87171 | surface | 2.34 | no |
| light | Bet (action) | #f87171 | surface-raised | 2.59 | no |
| light | Raise (action) | #f87171 | surface | 2.34 | no |
| light | Raise (action) | #f87171 | surface-raised | 2.59 | no |
| light | All-in (action) | #7f1d1d | surface | 8.47 | yes |
| light | All-in (action) | #7f1d1d | surface-raised | 9.39 | yes |
| light | felt | #166534 | surface | 6.03 | yes |
| light | felt | #166534 | surface-raised | 6.68 | yes |
| dark | Fold (action) | #3b82f6 | surface | 4.99 | yes |
| dark | Fold (action) | #3b82f6 | surface-raised | 4.57 | yes |
| dark | Check (action) | #22c55e | surface | 8.06 | yes |
| dark | Check (action) | #22c55e | surface-raised | 7.37 | yes |
| dark | Call (action) | #22c55e | surface | 8.06 | yes |
| dark | Call (action) | #22c55e | surface-raised | 7.37 | yes |
| dark | Limp (action) | #84cc16 | surface | 9.30 | yes |
| dark | Limp (action) | #84cc16 | surface-raised | 8.50 | yes |
| dark | Straddle (action) | #a855f7 | surface | 4.64 | yes |
| dark | Straddle (action) | #a855f7 | surface-raised | 4.24 | yes |
| dark | Bet (action) | #ef4444 | surface | 4.88 | yes |
| dark | Bet (action) | #ef4444 | surface-raised | 4.46 | yes |
| dark | Raise (action) | #ef4444 | surface | 4.88 | yes |
| dark | Raise (action) | #ef4444 | surface-raised | 4.46 | yes |
| dark | All-in (action) | #991b1b | surface | 2.21 | no |
| dark | All-in (action) | #991b1b | surface-raised | 2.02 | no |
| dark | felt | #14532d | surface | 2.02 | no |
| dark | felt | #14532d | surface-raised | 1.84 | no |
