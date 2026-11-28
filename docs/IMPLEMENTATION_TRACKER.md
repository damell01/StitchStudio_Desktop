# Stitch Studio Desktop implementation tracker and audit

Baseline `Dev` commit `4075876`. The checkout contains a shared Rust engine, a legacy egui application, and the React/Tauri desktop target. Native and browser tests exercise different boundaries. See [desktop setup and commands](DESKTOP.md), [competitor research](COMPETITORS.md) and [physical testing](SEW_OUT.md).

## Production-readiness batch (November 28, 2026)

| Brief priority | Integrated change | Acceptance still open |
| --- | --- | --- |
| Editor usability and lettering | The selection toolbar opens inline lettering with live stitch previews and controls for font, spacing, and thread color. Advanced lettering settings remain in the Text inspector. | Full visual and accessibility audit, nested semantic grouping, varied real-logo OCR and performance on Windows and Intel Mac. |
| Stitch generation and quality | Check the path to a pinned fill exit. Use a covered detour within the travel limit or retain the last stitch and flag the exit for review. | Per-fabric and size validation, representative logo benchmarks and machine sew-outs. |
| Premium library and import | A shared authored catalog supplies gallery art, native preview, opening and insertion. The Premium artwork filter exposes grouped boutique designs. Nested SVG ZIP import keeps source artwork and reports duplicate and skipped members. | Visual review of older templates, more original collections and physical template approval. |
| Simplify performance | Reuse the original stitch footprint while evaluating Maximum and Fast Stitch candidates. A digital fixture with 17,290 points produced identical scores for four candidates. Scoring took 1.08 seconds with reuse versus 2.29 seconds in one local debug run. | Measure end-to-end Simplify time and candidate quality on user artwork and production hardware. |
| Export and production | Authored templates generate stitches that can be encoded and read back as DST and PES. The sew-out guide includes a controlled comparison of original and optimized plans. | Installer and native desktop checks for this batch, controlled Poolin sew-outs for lettering, foam and appliqué, and updater verification. |

The grouped boutique samples were planned at nominal template widths of 55 and
80 mm. This is a digital planning check. Stitch counts refer to planned needle
points and trims refer to the plan. Physical trim behavior depends on the machine.

| Template | Points at 55 / 80 mm | Planned trims at 55 / 80 mm |
| --- | ---: | ---: |
| Vintage game day ribbon trio | 1,896 / 3,532 | 12 / 14 |
| Heirloom rocking horse and ribbon | 2,524 / 5,156 | 7 / 12 |
| Heirloom goose ribbon crest | 2,075 / 5,572 | 12 / 17 |

The release backlog continues to include advanced specialty stitch validation,
broader library approval, project and recovery stress tests, pricing presets,
and a separate review of the optional assistant.

## Advanced lettering effects audit (November 26, 2026)

The React/Tauri editor and shared Rust planner now have **committed** source paths for the following effects on branch `Dev`. They are **not yet qualified** by green CI or machine sew-outs:

| Effect | Committed implementation | Acceptance still required |
| --- | --- | --- |
| Foam/puff satin | Dense satin and open-column foam cap stitches; persisted `foam_caps` in native shape parameters; inline editor warning | Test appropriate foam thickness, cap sealing, tiny corners, trim/stop handling and Poolin sew-outs |
| Two-color double outline | Two separate, SVG-text-derived satin-stroke layers, independently editable widths and thread colors | Confirm glyph-stroke import with installed fonts, overlap/density around counters, all text paths and save/edit/delete behaviors |
| Offset drop shadow | Separate filled-letter stitch layer, adjustable x/y offset and thread color | Confirm offset on arcs/custom paths, preserve layering on text updates, minimize hidden overlap and machine travel |
| Satin color blend | Two physical thread groups with overlapping satin strips and reduced density; editable second color | Validate thread-change order, even gradient transitions, wider columns, density hot spots and source-to-export fidelity |
| Existing styles | Satin, tatami, running, triple-pass bean, appliqué, ripple, contour, cross, meander and blanket; monogram/circular lettering layouts | Font-size/fabric fixtures and full editing/reopen/undo tests, including failures and bounds checks |

**Next effect work:** stitch-safe single and triple outlines, sketch/scribble fills (not just running borders), motifs and repeatable pattern brushes, realistic chenille-style simulations, decorative gradients with more than two threads, combining multiple effects on one editable text object, foam-aware underlay/placement/stop sequencing, and machine-specific quality guidance. Do not label simulations as genuine chenille machine support.

**Important:** CI checks for `dbd8884` were queued during this audit, not confirmed passing. Native code and UI paths exist, and regression tests were added, but build acceptance, undo/delete/reopen audits, performance tests and Poolin EOM physical sew-outs are still outstanding. All desktop work remains on `Dev`; no payments are in scope.

## Current Dev update

| Workstream | Implemented and checked | Open acceptance work |
| --- | --- | --- |
| Automatic digitizing | Artwork selection starts generation. Geometry selects satin, fill or running stitches. Cleanup preserves thin ink, and automatic alternatives need to pass a spatial fidelity check. Merged contours survive reopening an editable project. | More detailed artwork and lettering benchmarks, underlay tuning across materials, and physical sew-outs. |
| Editor | Compact docks open on wide windows. Smaller windows open one drawer at a time. The camera bar can sit above or below the canvas. Editable project layers preserve names, locks, visibility and sew order. Hidden layers are excluded from stitch planning. | App-wide accessibility and theme audit and native workflow verification. |
| Professional tools | Selected-object editor for Bézier handles and fixed needle points. Move, insert, or erase points with undo on apply. | Satin-column drawing, advanced fill tools and full specialty wizard acceptance. |
| Machine file editing | DST, PES, PEC, EXP, JEF and VP3 pass independent import fixtures. Canvas handles, numeric changes and hoop fit use stitch-aware resizing. Checks cover run boundaries, legacy undo, project reopen and DST/PES re-export. PEN remains export-only. | Complex fill and underlay reconstruction, original lettering and object recovery, and Poolin EOM sew-outs. |
| Garment preview | Flat and rotatable hoodie views save a 1200 × 880 PNG using current fabric and placement. Both paths passed Chromium download checks. | Native Windows and macOS download verification and additional 3D garments. |
| Offline assistant | Editor chat turns recognized phrases into local commands. Quick actions, a review-and-apply step, and paired stitch previews support edits including hoop fit, named thread replacement, and sewing-time targets. | Expand phrasing and editing coverage. Verify recommendations with physical sew-outs. |

The current `digitizing_benchmark` run encoded and reopened all six formats on three generated designs. The badge used 8,553 needle points, the thin edge design used 4,562, and the textured oval used 5,364. The textured oval had four planned trims and 207.29 mm of DST jump travel. The earlier table below records a different planner revision. These are digital measurements.

## ZigZag tools in the desktop editor

The desktop editor uses the shared ZigZag engine. Its **Stitches** inspector opens object-linked Design Issues and exports a separate, labeled Test Swatches sheet. Its **Edit** inspector exposes Unite, Subtract Front, Intersect, Exclude, Outline Stroke, Offset Path, Round Corners and Simplify Outline for eligible selections. Simplify Outline reduces vector points. The Simplify design dialog evaluates stitch count, coverage and trims.

| Area | ZigZag capabilities to expose more fully in Stitch Studio Desktop |
| --- | --- |
| Drawing | Pen, satin brush, rectangle, ellipse and manual needle placement are available in Draw. Freehand smooth and erase brushes and snapping new geometry to anchors and intersections remain open. |
| Path editing | Path Tools can smooth selected outlines and join the nearest ends of two matching open running paths. Corner handles, chamfer/inverted styles, live outline simplification, compound-path release and a cleanup preview remain open. |
| Stitch controls | Object stitch tools include drag handles for fill angle and sewing entry and exit, reversing open stitch paths, copying settings and selecting matching stitch types. The Sewing Commands dialog sets explicit trims and stops. Draw → Satin column accepts two rails and optional connecting rungs. Advanced stitch settings include satin variants and underlay, contour and ripple spirals, cross-stitch cell size, running passes, and editable tartan stripes. More per-type controls and machine sew-outs remain open. |
| Digitizing and routing | Direct minimum-detail sizing, optional cap sewing order and gap-connection controls, object-linked quality navigation from the digitizer, editable trace compare, and benchmarks for very small lettering, multicolor artwork, gradients and photographs. The current digitizer already has automatic trace, color choices and a stitch goal. |
| Lettering | Desktop provides system fonts, arc settings, lettering preview and round-trip conversion between text and outlines that retain text metadata. New lettering can follow an open path selected on the canvas. Direct canvas typing, richer multiline editing, and changing the source path of existing lettering remain open. |
| Thread and view | Sewing-order labels, satin rail and rung overlays, a dual-unit snapping measure tool, thread order and substitution are available. More thread kits, related-thread selection and flexible typed units remain open. |
| Workspace | Up to six project tabs keep separate stitch plans, undo history, viewport settings, and disk recovery copies. Recovery restores the project data. Restoring the entire tab session after relaunch and floating inspectors remain open. |
| Machine output | Expose compatible device-transfer workflows only after model-specific testing. ZigZag's Skitch workflow is specific to that machine family. Complete desktop batch export and verify the existing machine output on the Poolin EOM. |

MCP is available in the legacy studio and bridge. Stitch Studio Desktop has a separate opt-in MCP connection for design summaries and proposals. Its built-in assistant matches common commands locally and uses the packaged model to interpret unfamiliar phrasing. The editor tools above operate directly through the desktop application. Native installer checks verify the model file and runtime. Real-model response quality and external-client interoperability still need release testing.

## Phase and acceptance tracker

| Phase | Working implementation and evidence | Remaining acceptance work |
| --- | --- | --- |
| 1.1 Import and automatic generation | Raster/SVG selection and file drop, one-page PDF auto-run and multipage selection, serialized tracing and debounced regeneration. Editor import and the digitizer share raster tracing and automatic stitch selection. JPEG EXIF orientation is applied before tracing. Browser tests cover file selection, drop, debouncing, stale draft invalidation, and selected failure handling through mocked IPC. | Native drag-and-drop and PDF checks on Windows/macOS, real per-stage progress, cancellation inside Rust, all input types and animated-file semantics. |
| 1.2–1.4 Analysis, cleanup and tracing | Raster trace pipeline, edge flood fill, texture cleanup override, transparent padding trim and processed preview. Rust tests cover an enclosed light region, exact sample color, foreground touching the frame and existing transparency. | Automatic texture and line detection, gradient/shadow workflows, recognition of ambiguous boundary-touching foreground, expanded fidelity fixtures, restoration with larger TIFF inputs. |
| 1.5–1.9 Stitch types, density, underlay, sequencing, fabric | Existing engine selects satin for some narrow regions, adapts fill directions, generates underlay and routes around overlaps. Searchable fabric presets in the digitizer and editor apply planner settings and show needle and stabilizer guidance. Draft heatmap shows 512 densest 1 mm² DST tiles. | Geometry-aware selection for additional stitch types, fabric-specific density corrections, underlay and compensation policies, overlap-aware routing benchmarks, physical validation of fabric presets. |
| 1.10 Validation | Draft rejects empty, non-finite and out-of-range stitch plans. Review displays size-independent plan counts, DST jumps, sewn path length, planner notes and stitch-length measurements. Export checks selected hoop bounds. | Format-specific jump, trim and stop validation, quality repair with source retention, estimate verification and native/physical validation. |
| 2.1–2.6 Workspace and beginner UX | Existing lavender theme, menus, workspace, tour and inspector. Streamlined digitizer with inline status, optional advanced settings and comparison modes. Compact windows, remembered editor panel widths, tooltips and native artwork, template and export dialogs. The editor now uses a full-window canvas, an editing command bar, optional overlay panels, a plum color treatment, and keyboard focus mode. Ctrl/Cmd+K searches navigation and context-specific editing actions. | Audit every menu action and placeholder page, true stage updates and realistic digitizer preview, command palette keyboard and focus tests, workspace persistence, dark mode and accessibility review. |
| 3.1 Camera | Existing editor has cursor-anchored zoom and SVG-coordinate panning. Browser regression checks viewBox changes and unchanged rendered stitch points and confirms camera interaction sends no transform command. | Additional trackpad and pinch checks, physical actual-size calibration, native export byte-for-byte regression. |
| 3.2–3.6 Editing | Numeric transforms, editable artwork regeneration, centering and mirroring retain source geometry, object settings and undo history where available. The canvas supports direct selection, dragging, quarter-turn rotation, drag-resizing from corner or side handles, duplication, and deletion. | Marquee, locking/grouping, booleans/drawing and per-stitch editing. Imported stitch resize and recoloring need source-aware semantics. |
| 3.7–3.8 Simulation and previews | Planned stitch playback with exact point stepping, scrubbing and selectable speeds. Editor and digitizer thread views render stitch paths. The digitizer also has a separate density view. The garment mockup overlays real stitches on shaded T-shirt, hoodie, cap and shorts previews in toddler, kids and adult sizes at approximate garment scale. | DST and PES export review shows paged records from the encoded data. Other formats and canonical per-format simulation, stop and trim indicators, realistic thread and fabric, complex-design performance. |
| 4.1–4.2 Lettering and fonts | Tauri has system-font lettering and local folder imports. The font picker and manager have search and pagination. Font versions with dimensions in the name sort by physical size. | Native and physical tests, more advanced layouts, mapping of machine alphabet designs, duplicate management and valid BX decoding. |
| 4.3–4.5 Specialty tools | Engine includes appliqué/fill/contour and other patterns. Tauri offers preset shapes for patches and appliqué and exports sized SVG cutting outlines. | Physical stop verification, freeform pieces and border settings, specialty algorithms and physical samples. |
| 4.6–4.9 Merging and libraries | Templates and local character artwork stay editable in source-backed projects. Personal machine files can be imported, searched and inserted from Design Library. Template previews run actual Rust stitch planning. The Insert design dialog previews searchable templates and positions them in the design. Fifteen licensed Twemoji designs round-trip at two sizes in DST and PES. Mixed artwork and machine stitch paths retain editable sources. Lettering can be inserted at hoop center or at an offset. Nested ZIP imports route readable machine designs to Design Library or editable Stitch Studio projects to My editable templates. Saved project templates can be previewed, opened as a new design, or added to the active workspace. | More garment shapes and 3D drape, broader licensed inventory, full machine-command provenance, metadata and thumbnail caching, and inventory features. |
| 4.10–4.11 Machines and formats | Configurable profiles/hoops, metric engine, inch labels in setup, hoop-aware export and printable thread list. Independent DST/PES/PEC/EXP/JEF/VP3 fixtures test import geometry and thread/run boundaries. | Poolin EOM field/format confirmation, broader third-party files, PEN and other proprietary imports, batch exports and verified transfer. |
| 5.1–5.2 Projects and recovery | Source SVG, source coordinate offset, stitch paths and hoop/format state. Older v1 files load without an offset. Project files are replaced atomically and recovery can fall back to the previous copy. | Native qualification, original and processed source assets, machine/fabric/library metadata, save-dirty prompts and broader cross-version tests. Recovery regression tests cover interrupted writes and invalid snapshots. |
| 5.3–5.5 Performance, input validation, accessibility | Raster generation off the UI thread. Automatic draft jobs serialized. PDF worker loads on demand. SVG engine refuses linked raster files. Input and project size limits checked. | Representative memory and stress tests, mid-job cancellation, generalized native limits, ZIP validation, screen-reader and reduced-motion audit. |
| 5.6–5.8 Tests, benchmarks and builds | Engine tests, Playwright workflow regressions, three generated benchmark fixtures, lockfiles, Tauri Windows NSIS/macOS bundle CI, local packaging docs. | More native integration coverage, Windows and macOS install/run checks, signing/notarization, release qualification and physical sew-outs. |
| 6 Research | Vendor documentation and selected user reports reviewed in [competitor comparison](COMPETITORS.md). | More representative forum/tutorial review and controlled competitor comparisons. |
| 7 Final audit | Source, build scripts, recent history, visible workflow and CI failures inspected. | Screen-by-screen native audit, all acceptance tests, signing and sew-outs. Full release and suite parity remain open. |

## Digital baseline and comparison

Run `cargo run --locked --example digitizing_benchmark` from the root. The runner generates the same 128-pixel original fixtures each time. It records trace and planning time, geometry count, stitch and color counts, DST commands, jump travel and 1 mm² penetration counts. It encodes then reads five formats and checks that each decode yields nonempty stitch blocks.

| Fixture | Trace + plan before → after | Shapes | Points | Colors | Planned trims | DST jumps | DST jump travel | Peak penetrations/mm² |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Flat badge with enclosed light region | 114 → 111 ms | 10 | 12,085 | 4 | 7 | 38 | 407.38 mm | 21 |
| Thin diagonal touching image edge | 59 → 64 ms | 2 | 6,446 | 2 | 0 | 8 | 89.42 mm | 11 |
| Textured oval | 147 → 140 ms | 2 | 7,143 | 2 | 2 | 9 | 106.30 mm | 14 |

The stitch metrics stayed the same on these three fixtures. Timings are single debug runs and vary by machine. The background change addresses edge cases checked by direct pixel assertions. The benchmark does not measure visual fidelity, peak process memory, machine-specific stops, or sew-out quality. Expand the fixtures to include transparent artwork, lettering at multiple scales, patch and appliqué samples and more intricate drawings.

## Verification status

- Baseline engine suite passed with 158 tests and one ignored, counting the CLI bridge tests. The updated engine passed 166 tests with one ignored, including six raster format-to-export cases, EXIF rotation, malformed input and an SVG-to-PES round trip.
- TypeScript and Vite production build passed. Six Chromium workflow tests cover mocked Tauri workflows, including compact full-canvas editing, step-by-step playback, a real PDF render, template preview, font size sorting, and library insertion.
- The baseline macOS CI build failed at Tauri context generation because the PNG app icon was missing. Desktop bundle configuration now references the repository’s existing PNG, ICO and ICNS assets.
- Local Tauri compilation on the Linux development image is blocked at missing GTK development dependencies. Native workflow logs and artifacts are available through [Desktop production checks](https://github.com/damell01/StitchStudio_Desktop/actions/workflows/desktop-production-checks.yml).
- The legacy egui GUI suite also runs separately. The missing export glyph was removed. A Linux run still reported 10 legacy interaction test failures after 149 passes and 3 skips.
- There are no physical machine results. Verify the Poolin EOM and fabric settings using the [sew-out worksheet](SEW_OUT.md).


## Expanded design and production roadmap (November 26)

Acceptance requires working native operations, undo where applicable, saved-project round trips, and tests. Existing implementations should be extended rather than duplicated.

| Workstream | Acceptance criteria |
| --- | --- |
| Smart compositions | Editable theme layouts, names, motif repetition, relative placement and collision/hoop checks |
| Variations | Non-destructive alternatives for palette, lettering, applique and production cost |
| Effects | Editable outlines, shadows, decorative fills, pattern brush and thread blending |
| Geometry | Mirror drawing, linked duplicates, replacement, envelope warp, knockout and version history |
| Garment placement | Garment-specific size guidance, placement preview and compatible hoop checks |
| Production | Compare stitch count, trims, colors, thread length, estimated time and cost before applying |
| Batch personalization | CSV names, per-name fit checks, preview and collision-safe export |
| Specialty | Puff, patches, applique, in-the-hoop and lace with explicit machine stops |
| Multi-hoop | Split with registration marks, overlap and seam review; physical verification required |
| Learning | Contextual explanations, fabric guidance and reversible repair suggestions |
| Native imports | Drop artwork, fonts and machine files; report unsupported BX honestly |
| Release | Windows/macOS native checks, regression fixtures and Poolin sew-outs |

No payment implementation is in scope.
