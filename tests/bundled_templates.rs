//! Every template bundled in the desktop library must load in the stitch engine and
//! produce machine stitches. Prints stitch counts so heavy designs are easy to spot.
use std::path::{Path, PathBuf};
use zigzag::document::Document;

fn svgs(dir: &Path, out: &mut Vec<PathBuf>) {
    for entry in std::fs::read_dir(dir).unwrap() {
        let path = entry.unwrap().path();
        if path.is_dir() { svgs(&path, out) } else if path.extension().is_some_and(|e| e == "svg") { out.push(path) }
    }
}

#[test]
fn bundled_templates_plan_into_stitches() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("desktop-ui/src/bundled-artwork/expanded");
    let mut files = Vec::new();
    svgs(&root, &mut files);
    files.sort();
    assert!(files.len() >= 100, "expected the bundled collection, found {}", files.len());
    let mut failures = Vec::new();
    for file in &files {
        let name = file.strip_prefix(&root).unwrap().display().to_string();
        let started = std::time::Instant::now();
        let xml = std::fs::read_to_string(file).unwrap();
        match Document::from_svg(&xml, &name, None) {
            Ok(doc) => {
                let design = doc.plan();
                let stitches = design.stitch_count();
                println!("{stitches:>7} stitches {:>3} colors {:>5} ms  {name}", design.blocks.len(), started.elapsed().as_millis());
                if stitches == 0 { failures.push(format!("{name}: no stitches")) }
            }
            Err(error) => failures.push(format!("{name}: {error:#}")),
        }
    }
    assert!(failures.is_empty(), "{} templates failed:\n{}", failures.len(), failures.join("\n"));
}

#[test]
fn tidy_islands_never_adds_trims_or_moves_painterly_templates() {
    use zigzag::document::TidyIslands;
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("desktop-ui/src/bundled-artwork/expanded/curated");
    let mut files = Vec::new();
    svgs(&root, &mut files);
    files.sort();
    let (mut trims0, mut trims1, mut st0, mut st1) = (0, 0, 0, 0);
    for file in files.iter().take(8) {
        let mut doc = Document::from_svg(&std::fs::read_to_string(file).unwrap(), "t", None).unwrap();
        let before = doc.plan();
        doc.tidy_islands(None, &TidyIslands::GENTLE).unwrap();
        let after = doc.plan();
        let (a, b) = (before.bounds(), after.bounds());
        assert!(a.min.dist(b.min) < 15.0 && a.max.dist(b.max) < 15.0, "{}: outline moved", file.display());
        assert_eq!(before.blocks.len(), after.blocks.len(), "{}: thread colors changed", file.display());
        trims0 += before.trim_count(); trims1 += after.trim_count();
        st0 += before.stitch_count(); st1 += after.stitch_count();
    }
    // The bundled files are already tidied (scripts: tidy_svg_files), so a
    // second pass must be stable: no extra trims, no drift.
    println!("trims {trims0} -> {trims1}, stitches {st0} -> {st1}");
    assert!(trims1 <= trims0, "tidy added trims: {trims0} -> {trims1}");
    assert!(st1 * 100 >= st0 * 90 && st1 * 100 <= st0 * 108, "stitch count drifted: {st0} -> {st1}");
}

#[test]
fn tidy_islands_merges_hairline_gaps_and_drops_specks_but_leaves_clean_shapes() {
    use zigzag::document::TidyIslands;
    // One red fill made of 10 squares 0.6 mm apart plus a 0.5 mm speck; one clean blue circle.
    let mut d = String::new();
    for k in 0..10 { let x = k as f64 * 3.6; d += &format!("M{x} 0h3v3h-3z"); }
    d += "M60 20h0.5v0.5h-0.5z";
    let svg = format!(r##"<svg xmlns="http://www.w3.org/2000/svg" width="80mm" height="40mm" viewBox="0 0 80 40"><path id="red" fill="#c00" d="{d}"/><circle id="dot" cx="70" cy="30" r="1.5" fill="#00c"/></svg>"##);
    let mut doc = Document::from_svg(&svg, "t", None).unwrap();
    let before = doc.plan();
    assert_eq!(doc.tidy_islands(None, &TidyIslands::GENTLE).unwrap(), 1, "only the fragmented fill changes");
    let after = doc.plan();
    assert!(after.trim_count() < before.trim_count(), "{} -> {}", before.trim_count(), after.trim_count());
    let zigzag::svg::Geometry::Fill { rings, .. } = &doc.shapes.iter().find(|s| s.id.starts_with("red")).unwrap().geometry else { panic!() };
    assert_eq!(rings.len(), 1, "squares merged into one outline, speck gone");
}
