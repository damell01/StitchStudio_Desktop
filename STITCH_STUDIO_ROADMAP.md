# Stitch Studio desktop roadmap

Target branch: Dev. Preserve main and the upstream Apache-2.0 notices. Audit vendored dependencies and assets before distribution.

## Design
DM Sans (bundle only with verified license); forest #234536, sage #73977B, ivory #F7F8F5, white #FFFFFF, text #202C26, border #DDE4DE. Dark mode, compact native menus, resizable panels, keyboard navigation, large canvas. Keep thread colors independent of UI theme.

## Milestone 1: baseline
- [x] Apply initial native editor theme and window branding.
- [ ] Build and test existing Rust engine on Windows and macOS using required Rust 1.95 or newer.
- [ ] Audit public library APIs, GUI-only operations, dependency licenses and fixtures.
- [ ] Establish SVG-to-PES regression tests and physical Poolin stitch-outs.
- [ ] Prototype Tauri bridge alongside existing egui editor; compare responsiveness and feature coverage before migration.

## Milestone 2: desktop workspace
Welcome dashboard, recent files, design studio, native menus, project tabs, undo/redo, layers, properties, rulers, hoops, autosave and recovery. React/TypeScript/Tauri is the proposed replacement UI, not yet implemented. Preserve existing editor until parity is verified.

## Milestone 3: digitizing and production
Image import and tracing, cleanup, region classification, stitch selection, fabric presets, underlay, pull compensation, sequencing, cancellation and progress. Use actual engine results, never placeholder stitches. Simulator, inspector, density repair, PES/DST/EXP/JEF/VP3 exports and round-trip tests where readers exist.

## Milestone 4: specialty studios
Lettering, monograms, font manager (BX feasibility investigation), patches, applique, quilting, manual stitch editing, advanced fills and hoop splitting. Test each feature against physical samples.

## Milestone 5: productivity
Design library, thread library, machine and hoop manager, garment previews, customer proofs, batch converter, pricing, production worksheets, CSV personalization, setup assistant, settings and help.

## Milestone 6: distribution
Signed macOS and Windows installers, updater, documentation, accessible UI, offline project editing, secure licensing, trial, subscription and lifetime purchase. All paid features included. No mandatory cloud processing or AI. Disable unnecessary network services by default in the replacement app.

## Acceptance gates
Builds and tests pass on both platforms; export matches canonical simulator sequence; files reopen where supported; physical stitch-out approved; no silent failures; long tasks remain responsive; project files stay local; dependency and asset licenses reviewed. No release claims before verification.
