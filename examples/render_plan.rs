//! Render an SVG's automatic stitch plan as an SVG of needle paths.
use zigzag::document::Document;
fn main() {
    let a: Vec<String> = std::env::args().collect();
    let mut doc = Document::from_svg(&std::fs::read_to_string(&a[1]).unwrap(), "p", None).unwrap();
    for s in &mut doc.shapes { s.params.kind = None; }
    zigzag::design::auto_stitch_types(&mut doc.shapes);
    let d = zigzag::design::plan("p", &doc.shapes, &doc.plan_options());
    let b = d.bounds();
    let mut svg = format!(r#"<svg xmlns="http://www.w3.org/2000/svg" viewBox="{} {} {} {}" width="700" style="background:#fff">"#, b.min.x, b.min.y, b.width(), b.height());
    for blk in &d.blocks { let c = blk.color; for run in &blk.runs {
        let pts: Vec<String> = run.pts.iter().map(|p| format!("{:.1},{:.1}", p.x, p.y)).collect();
        svg += &format!(r#"<polyline fill="none" stroke="rgb({},{},{})" stroke-width="2.4" stroke-linejoin="round" points="{}"/>"#, c[0], c[1], c[2], pts.join(" "));
    }}
    std::fs::write(&a[2], svg + "</svg>").unwrap();
}
