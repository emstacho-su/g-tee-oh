# Screen review rubric

The automated critic judges every screenshot against two lists: the global checks (G1 to G10), which apply to every screen, and the solver-browser design rules (R1 to R12), of which each screen family gets the subset named in `families.json`. The rules come from the 2026-10-28 comparison of g-tee-oh with the product it emulates (feature level only; nothing product-specific lives here). A screen passes when no check fails in any of its four variants (dark and light, 1440 and 390 pixels wide). The owner's own review notes from earlier rounds are applied on top of this file and are not stored in the repo.

## What not to flag

- Synthetic data values, the "synthetic" banner and mocked api content: the pictures come from the mocked api.
- The dark theme's base colour: judge dark only on legibility and contrast (the neutral base landed in S43).
- Anything the acceptance criterion in the manifest says is intended for that screen.
- A rule that the screen's family does not list, unless the failure is severe enough to count as a global check.

## Global checks

- **G1 Legible in both themes.** Text and controls keep contrast against their ground in dark and light; nothing disappears when the theme flips.
- **G2 Fits a phone.** At 390 pixels wide there is no horizontal page scroll, no clipped control, and the primary action is reachable without scrolling past decoration. A wide table or canvas scrolls inside its own frame, not the page. Landscape-only layouts rotate or stack.
- **G3 Condensed by default.** The default view shows what the user needs for the next decision; detail expands and collapses in place rather than opening a pop-out that needs an explicit exit. No wall of text, no every-section-open feedback.
- **G4 No raw identifiers.** No slugs, hashes, internal keys, enum tokens or developer words such as "index" or "token" in copy. Poker jargon that a trainer user may not know gets a tooltip.
- **G5 Tables only for comparison.** A table appears when rows are compared across columns; a read-only table that restates one object is a card or a short list. Compact rows beat verbose grids.
- **G6 One vocabulary.** The same thing has the same name, unit and number format on every screen (percent with the same precision, big blinds written the same way, positions and spot names consistent).
- **G7 Tactile look outside the solver surfaces.** Shell, home, settings, library, drills and progress use the tactile style and the owner's palette with pressable buttons; solver surfaces (matrix, felt, cards) keep their own colours.
- **G8 Statistics explain themselves.** Any number that is a statistic (a score, a rating, a frequency, an EV loss, a count by label) has its definition one tooltip or one line away where it appears.
- **G9 States say what to do next.** Empty, loading, refused, error and paused states name the cause in words and offer the next action.
- **G10 Visible focus and state.** Focus rings, pressed and selected states are visible; nothing relies on colour alone (a shape, letter or label accompanies colour).

## Solver-browser design rules

- **R1 Read along a line, not a tree.** The position carousel is the only navigation; acted cards list every option the player had; no tree diagram.
- **R2 The matrix is the primary object.** Lenses (strategy, EV, EV gap to best, range weight) switch in place with the heading naming the lens; the side panel annotates the matrix; dialogs are for choosing, not reading.
- **R3 Click the thing itself to filter.** The action table doubles as legend and filter; active filters show as chips above the matrix with a Clear control; shares read as percent and combo count together.
- **R4 Pairs and pot types, not action tokens.** The spot is named by its position pair in action order and its pot type, the same way on every screen; common spots are two clicks away.
- **R5 Returning is half of studying.** The last spot is restored on entry; recent and starred spots are one click away; a trainer mistake opens the node where it happened.
- **R6 The opponent's range first.** At a node and at a decision the first question is who is ahead; hero's matrix with the dealt hand marked is shown after the decision, never by default while deciding.
- **R7 Units are lenses, not settings.** Sizes in big blinds or percent of pot and EV in big blinds or per pot flip with a hotkey and apply everywhere alike.
- **R8 Sizes belong to the tree.** Nobody types a size in study; the library is a finite catalog browsed by facets with counts; a drill is a saved query over it; the sizing convention is named before the walk.
- **R9 The trainer is a keyboard instrument.** One fixed key per action kind, digits for sizes, one key for next hand, one for repeat, one chord into Study; keys never shift with the number of buttons.
- **R10 Play fast, review later.** A non-blocking mark per decision, a running tally, a planned session length that ends by itself, and a worst-first log where every row reopens Study or a drill.
- **R11 Two numbers for self-grading.** How much EV the choice cost and how often the solver takes it, side by side, with the five label definitions in a tooltip where the counts appear and one vocabulary from the result chip to the lifetime totals.
- **R12 Speed per node switch.** A node change redraws the canvas and tables only; secondary panels mount lazily and only when they have data; nothing on screen suggests a blocked render.
