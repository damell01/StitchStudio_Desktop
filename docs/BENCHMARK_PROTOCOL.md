# Controlled embroidery benchmark

Use this protocol to compare a Stitch Studio revision with earlier revisions or other applications. Keep tool versions, feature editions, settings, input hashes, and generated artifacts with the results.

## Shared inputs

| Fixture | Source and purpose |
| --- | --- |
| Flat raster motif | [artwork.bmp](../tests/fixtures/digitizer/artwork.bmp). Check background removal, retained colors, and narrow details. |
| Transparent raster motif | [artwork.png](../tests/fixtures/digitizer/artwork.png). Check transparent padding and the rendered extent. |
| Rotated phone JPEG | [phone-rotated.jpg](../tests/fixtures/digitizer/phone-rotated.jpg). Check that the canvas orientation agrees with the exported design. |
| Curved vector, interior cutout, and two colors | [orbit-badge.svg](fixtures/orbit-badge.svg). Check vector import, stencil openings, object edits, stitch order, and physical size. |

For each submitted result record the input SHA-256. Use the source as supplied for the first pass. Record a resave or conversion as a separate preparation step and keep the derived file. Use the committed samples for repeatability. Add owned photos and customer artwork only when you have permission to share the resulting sample.

## Digital workflow

1. Record the Git revision or product and edition, OS and version, CPU, RAM, export format, nominal and usable hoop dimensions, fabric preset, stabilization settings, and any settings that alter the stitch plan.
2. Use a finished width of **60 mm** for raster conversion. Preserve the vector fixture’s authored scale and report its stitched width separately. Use a verified hoop with space for the planned design. Use the same export format where available. Prefer DST for comparing movement on one compatible machine and PES as a separate format test when embedded palette information matters.
3. For raster input, use the default first-pass workflow. Record the automated conversion method and any explicit size or color settings. Record missing features as unavailable. For the vector fixture, import the vector and use the documented vector workflow. In the editing run, move one color object 5 mm horizontally, undo, and export the initial design again. Capture before and after previews.
4. Record the time from confirmation of input to the first stitch preview and the time from export confirmation to a completed file. Test performance with the same machine and build class, perform one warm-up and at least three measured runs, and retain individual samples and the median. Time user corrections separately from automatic processing.
5. Keep the exported bytes and confirm the format in an independent viewer or decoder. Record dimensions, orientation, color stops, jumps, trims, and unexpected movement. A counter from a plan or a tool's viewer needs its origin recorded. For count comparisons, use the same decoder and convention.
6. Compare editable outline and export position before and after undo. Check differences in units and coordinate rounding. ZIP exact source files, project files where present, settings snapshots, exports, screenshots, and the results table.

Record auto-conversion, manual corrections, and specialty photo stitching as separate workflows. A viewer that accepts an export establishes a digital read-back result. Machine execution requires the physical pass.

## Stitch Studio commands

From the repository root, use the release build for performance reporting. The existing Rust benchmark times trace and planning for its own generated fixtures and exercises the supported round-trip export formats. Report its numbers separately from UI timings and the shared-input comparison.

```sh
cargo run --release --locked --example digitizing_benchmark
cargo test --locked --test digitizer_formats
cargo run --locked --bin zigzag -- info docs/fixtures/orbit-badge.svg
```

The automated results cover the Rust CLI, engine, or format layer as indicated by the command. Use the installed desktop app to collect native file-picker, rendering, and export timings.

## Vector fixture smoke result

The repository CLI at revision `d6eb2c3` planned the orbit badge at **58.0 × 37.8 mm** with **2,547 stitch points**, two color blocks, and two planned trims. Exporting to DST and PES and opening both exports through the same CLI yielded the same bounds and **2,562 stitch points** in each. Record artwork plans and export read-back counts as separate measurements. This smoke run exercised the project's own writer and reader and left independent decoding and physical sew-out open.

## Physical workflow

Use the [sew-out worksheet](SEW_OUT.md). Run the same design on the same machine with the same hoop orientation, speed, fabric lot, stabilizer, needle, tension, and thread. Validate the test area with a known-good design before the first sample. Record placements, sample order, machine stop reasons, thread breaks, visible backtracking, elapsed time, and the exact export used. Label results by run ID and photograph both faces with a ruler. For repeats, rotate which application runs first and use a new scrap for each sew-out.

Compare cutout retention, registration, coverage, puckering, and observed size. Keep software processing time, operator time, and machine time separate.

## Result record

| Run ID | App, edition, revision and OS | Fixture and hash | Workflow and settings | Preview and export times | Decoded bounds and command counts | Machine result and evidence |
| --- | --- | --- | --- | --- | --- | --- |
| | | | | | | |

Cross-product timings and physical measurements are open until evidence is attached. The [competitor comparison](COMPETITORS.md) records documented capabilities.
