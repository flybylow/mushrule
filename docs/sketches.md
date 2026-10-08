# HTML sketches

Prototypes in `sketches/`. They are the source of the React app, kept for reference. Do not treat them as the live tool.

| File | What it proved |
|---|---|
| `000_pattern-reader_original.html` | First image → sequence scan |
| `001_pattern-reader_cuneiform-surface-scan.html` | Cuneiform tablet as default source; edge-detect channel |
| `002_pattern-reader_strudel-output.html` | Sequence → Strudel `note()` / `.s()` text |
| `003_pattern-reader_strudel-clay-vars*.html` | Clay/sensor variables in the generated pattern |
| `004_pattern-reader_resonant*.html` | Auto timbre, sensor sine sim, export JSON — last copy-paste generation |

`004` still has an “Open in Strudel” button. That path is a dead end for live iteration. The React app embeds Strudel instead.

The tablet JPEG lives in `004` as a base64 `img.src`. The app asset is that same file, extracted once.
