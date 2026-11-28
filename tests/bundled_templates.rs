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
