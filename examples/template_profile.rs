//! Profile where a template's stitches and trims come from.
//!   cargo run --release --example template_profile -- <svg>...
use zigzag::document::Document;
fn main() {
    for path in std::env::args().skip(1) {
        let xml = std::fs::read_to_string(&path).unwrap();
        let doc = Document::from_svg(&xml, &path, None).unwrap();
        let d = doc.plan();
        let mut small = (0usize, 0usize); // (shapes, stitches) for shapes under 2 mm across
        let mut sizes: Vec<(f64, usize)> = Vec::new();
        for (i, shape) in doc.shapes.iter().enumerate() {
            let b = zigzag::svg::shapes_bounds(std::slice::from_ref(shape));
            let span = b.width().max(b.height());
            let n = d.per_shape.get(i).copied().unwrap_or(0);
            sizes.push((span, n));
            if span < 20.0 { small.0 += 1; small.1 += n; }
        }
        sizes.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap());
        let tiny = sizes.iter().filter(|s| s.0 < 10.0).count();
        if std::env::var("GAPS").is_ok() { println!("gaps <1mm,<2,<4,<8,<20,>20: {:?}", gap_histogram(&d)); }
        println!("{:>6} st {:>4} trims {:>4} shapes | <2mm: {:>4} shapes {:>5} st | <1mm: {:>4} | {}",
            d.stitch_count(), d.trim_count(), doc.shapes.len(), small.0, small.1, tiny, path.rsplit('/').next().unwrap());
    }
}

#[allow(dead_code)]
pub fn gap_histogram(d: &zigzag::design::Design) -> [usize; 6] {
    let mut h = [0; 6];
    for b in &d.blocks {
        let mut prev: Option<zigzag::geom::P> = None;
        for r in &b.runs {
            if r.trim_before && let (Some(p), Some(q)) = (prev, r.pts.first()) {
                let g = p.dist(*q);
                let k = if g < 10.0 { 0 } else if g < 20.0 { 1 } else if g < 40.0 { 2 } else if g < 80.0 { 3 } else if g < 200.0 { 4 } else { 5 };
                h[k] += 1;
            }
            prev = r.pts.last().copied();
        }
    }
    h
}
