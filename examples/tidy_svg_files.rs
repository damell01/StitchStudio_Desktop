//! Tidy fragmented fills in SVG files in place (see Document::tidy_islands).
//!   cargo run --release --example tidy_svg_files -- <svg>...
use zigzag::document::{Document, TidyIslands};
fn main() -> anyhow::Result<()> {
    for path in std::env::args().skip(1) {
        let xml = std::fs::read_to_string(&path)?;
        let mut doc = Document::from_svg(&xml, &path, None)?;
        let before = doc.plan();
        let changed = doc.tidy_islands(None, &TidyIslands::GENTLE)?;
        if changed == 0 { println!("unchanged  {path}"); continue; }
        let after = doc.plan();
        let out = doc.to_svg()?;
        std::fs::write(&path, &out)?;
        println!("{:>5}->{:<5} trims {:>6}->{:<6} stitches {:>7}->{:<7} bytes  {}", before.trim_count(), after.trim_count(), before.stitch_count(), after.stitch_count(), xml.len(), out.len(), path.rsplit('/').next().unwrap());
    }
    Ok(())
}

