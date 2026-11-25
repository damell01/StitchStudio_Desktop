# Stitch Studio product parity
Status: baseline inventory, not certification. Every item requires desktop integration and tests before being marked complete.
Sources:
- https://embrilliance.com/product/essentials
- https://embrilliance.com/products/enthusiast
- https://embrilliance.com/stitchartist
- https://embrilliance.com/product/density-repair-kit
- https://embrilliance.com/product/thumbnailer
- https://embrilliance.com/start/selectionguide
- https://embrilliance.com/downloads

## P0: Core workflow
- [ ] Automatic raster/vector digitizing, background removal, adaptive satin/fill/run, palette and routing optimization; benchmark flat logos, lettering, textured mockups.
- [ ] Merge designs including ZIP, editable projects, notes, undo/redo, selection, groups, alignment, distribution, mirror, repeat, precise position.
- [ ] Density-aware scaling for native objects and imported stitches; preserve patterns, limit short/long stitches, gap compensation.
- [ ] Color changes, overlap-aware sequencing and hidden stitch removal.
- [ ] Machine profiles, custom hoops, fit/center, basting, multi-position splitting and registration marks.
- [ ] Stitch-level selection/editing, split runs, jumps/trims, export validation, actual command simulation.
- [ ] Lettering: multiline, circle, spiral, monograms, envelopes, baseline, spacing, slant, left/right/center-out sequencing, convert to stitches.
- [ ] BX compatibility and glyph mapping from stitch collections; font search and licensed native font assets.

## P1: Professional digitizing
- [ ] Point/freehand/Bezier drawing, primitives, holes, line-area selection, column control, inclines, entry/exit, ties, underlay, branching.
- [ ] Running variants, manual, tatami, satin borders/columns, applique, stipple, motif runs/fills, cross stitch, freestanding lace.
- [ ] Decorative knots, echo/contour, foam, fringe, whip, curved/gradient/feather fills, emboss, eyelets.
- [ ] Custom motifs and emboss patterns, carving and break lines, patch edge effects.
- [ ] Boolean geometry, offset, outline reconstruction, reusable styles, deferred regeneration, multiple designs per workspace.
- [ ] Applique fabric preview, cut files, patch workflows, original parametric design library.
- [ ] Independent quality analysis: density heatmap, wireframe, per-color density, short stitch filtering, overlap/clump repair, global pile underlay and fabric advisor. Review patents before commercial implementation.

## P2: Interoperability and organization
- [ ] Read/write coverage matrix: CND CSD DST DSZ EMB EMD EXP HUS JAN JEF PCS PCM PES PHB PHC PHD PHX SEW SHV TAP VIP VP3 XXX; variants and proprietary formats subject to documented lawful interoperability.
- [ ] Cutter SVG PLT FCM STUDIO; EMF WMF compatible AI input; PNG preview and actual-size print.
- [ ] Thread palette import/CSV, color conversion and inventory (deprioritized by owner).
- [ ] In-app and OS-level thumbnails, recent files, backup/restore fonts and projects.
- [ ] Machine transfer including supported Brother/Baby Lock Wi-Fi and Poolin workflows; legacy media where practical.
- [ ] Font creation/publishing, native reusable shapes and text-warp effects; no copying proprietary assets.

## Release gates
- [ ] Windows/macOS clean builds, installers, signing, update/rollback, offline usage.
- [ ] Regression fixtures and physical sew-outs across machine formats and fabrics.
- [ ] Accessible keyboard navigation, beginner defaults, optional advanced tools, responsive lavender UI.
- [ ] Crash recovery, resource limits, secure file parsing, license/attribution review.
- [ ] Verify offline editing and export on a clean installation.
