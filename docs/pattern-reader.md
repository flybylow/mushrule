# Pattern Reader

React + Vite app. Source: `src/pages/pattern-reader/`.

```bash
npm run dev
```

URL: [http://localhost:5174/](http://localhost:5174/)

Port is **5174** so it does not collide with Arty’s Vite on 5173.

## One engine

Playback is in-process Strudel. Do **not** also call `@strudel/web` `initStrudel()` / `evaluate()` / `hush()` — that starts a second scheduler.

The engine is `StrudelMirror` from `@strudel/codemirror`. Prebake is local (`evalScope` + synths + Dirt samples) — do **not** use `@strudel/repl`’s full `prebake()` here. That one waits on hydra / soundfonts / several remote banks; if any of those hang, `evaluate` never starts and playback is silent.

`@strudel/embed` / an iframe of strudel.cc stays out (cross-origin, no Update).

`@strudel/repl` is AGPL-3.0-or-later.

## Base + overlay (one song)

Both Code panes are live editors. **Update** / **Ctrl+Enter** evaluates them together:

```
setcpm(bpm/4)
$: <left>
$: <right>
```

`$:` registers each pane as a pattern so Strudel **stacks** them. The right pane never replaces the left. If the overlay used to contain `setcpm`, that used to take over the whole program — that rule is gone.

- **Generated (left)** — rewritten when you change a track (bank, steps, scale, root). Sensor ticks do **not** rewrite it. **From image** reseeds and evaluates. Each block is marked `// R1`, `// R2`, … so the bank dropdown maps to `.s("…")` in that block.
- **Overlay (right)** — extra pattern on top. Empty = left plays alone.
- Active mini-notation nodes outline in **both** editors, same as strudel.cc. The engine is a hidden StrudelMirror; the visible panes are two `initEditor` views. Highlight locations are remapped from the composed `$:` source onto each pane.

Do **not** re-evaluate on every cycle. That hushes the scheduler and drops the left part.

JSON export includes `userBase`, `userOverlay`, and `strudelCode`.

## Tempo (cycles, not steps)

Strudel’s `setcpm(n)` is **cycles per minute**. One cycle is the whole mini-notation string. Do **not** multiply by step count. Slider is 4/4 BPM: `setcpm(bpm / 4)`. Default 40 BPM = 10 cpm.

## Tracks (one row per region)

Each drawn region is a sequence track. They stack under **Sequence**. Click a row to select it; the matching color lights on the image. Click the name (`R1`) to rename it — that updates the `// R1` marker in generated code. A new track picks a random pitched or rhythm sample (not `auto`); later tracks avoid a bank already in use when they can. `auto` stays in the dropdown. Loading a preset keeps saved banks and only randomizes tracks that were still `auto`.

**Bank, steps, threshold, and mute are per track.** Scale, root, and pitch direction sit in the Sequence header (replacing the old “Sequence — n tracks” title). Axis and channel stay under Scan. The Tuning fold is gone.

Pitched notes walk the chosen scale by **step index**. Sequence header: **↑** rises left → right, **−** stays on the root (neutral), **↓** falls. Other automatic note/sound mappings: **root** sets the octave floor; **scale** picks the interval set; **gain** comes from each cell’s scanned brightness; **decay** comes from auto-timbre only when the bank is `auto`; rhythm banks (`bd` / `sd` / `hh` / `cp`) skip `note()` entirely.

Between the bank dropdown and mute: steps (`−` / dropdown / `+`, any count from 1–64) and a sliders icon for that row’s threshold (slider, then `−` / number / `+`, 0–255). A newly drawn track opens that threshold row. Changing the step count keeps the full pattern in memory: `+` appends rests if that length is new, `−` hides the tail but does not delete it. Switching 16 → 32 → 16 → 32 restores the second half. Playback and the grid use only the current step count. Threshold, axis, and channel still re-scan the visible steps and leave the hidden tail alone. Scan and Sensor simulation fold closed by default.

The old Regions list is the track list. JSON export includes `bank`, `muted`, `steps`, and `thresh` on each region.

**Mute** is the speaker on each track. Outline = audible, slash = muted. The generated pane keeps the full `note()` / `.s()` / `.gain()` block. Each track is its own `$:` pattern (Strudel’s pattern id). Mute does **not** delete that block — the engine evaluates `_$: ` instead of `$: ` for that id (`Pattern.p` treats a leading `_` as silence). That is the same mute flag as strudel.cc. If every track is muted, evaluate still runs (silence), so the previous sound does not keep playing. The yellow playhead is hidden on muted rows so a lit cell is not mistaken for a sounding hit.

## Presets

**Presets** in the top nav opens a split panel (same slot as Code — one at a time). Left: named snapshots in `localStorage` (`pattern-reader.presets.v1`). Right: the selected preset — patterns, sample/bank per track, overlay, and metadata.

A preset is the whole session minus the source image: scan/tuning settings, every track (geometry, sequence, bank, mute), generated left pane, and overlay. **Save** makes a new row. **Update** overwrites the selected one (keeps `createdAt`). **Load** or double-click applies it. The image is not stored (quota); UV regions land on whatever is loaded.

Two tabs (Cursor’s browser and Chrome, for example) do **not** share the live pattern or the audio engine. Each has its own clock. They **do** share `localStorage` presets — last save wins; the other tab refreshes its preset list. Vite HMR also reaches every tab on localhost, so an agent reload can cut audio in the tab you are listening to. Use one tab for playing.

Live updates (`+` / `−`, cell toggles) debounce ~40ms and coalesce while evaluate is running, then re-read the latest editor. Dirt samples (`gong`, `bd`, …) are preloaded so the first hit is not dropped while the wav is still fetching.

Metadata is not one field:

- **Created** (`createdAt`) — first Save, never changes.
- **Saved** (`updatedAt`) — last Save/Update.
- **Tempo** — the BPM slider plus `cpm` (`bpm / 4`), the cycle rate the engine actually uses. There is no separate “samples per minute”; cpm is that rate.

## Generated DSL rules

Strudel’s mini-notation parser rejects `|`, arrows, em dashes, degree symbols. Rhythm banks emit `s("bd ~ ~ bd")` matching the lit cells — not `.euclid()`, which placed onsets that often missed the visual hits (and then `.gain("0")` silenced them). Synths and pitched banks emit `note("...").s("gong")`. A sample fires at the start of the step the playhead enters.

Default image: `src/pages/pattern-reader/assets/tablet.jpg` (extracted from the HTML sketches).
