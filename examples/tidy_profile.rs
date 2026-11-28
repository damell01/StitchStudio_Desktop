//! Measure the island clean-up on templates: trims and stitches before/after.
use zigzag::{boolean, document::Document, geom::{FillRule, Polyline}, svg::Geometry};
fn signed(r: &Polyline) -> f64 { let n=r.len(); (0..n).map(|i| zigzag::geom::cross(r[i], r[(i+1)%n])).sum::<f64>()*0.5 }
fn tidy(rings: &[Polyline], rule: FillRule, r: f64, amin: f64) -> Vec<Polyline> {
    let grown = boolean::offset(rings, rule, r);
    let closed = boolean::offset(&grown, FillRule::NonZero, -r);
    let big = closed.iter().map(signed).fold(0.0f64, |a, s| if s.abs() > a.abs() { s } else { a });
    closed.into_iter().filter(|ring| { let s = signed(ring); s.abs() >= amin || (s.signum() != big.signum() && s.abs() >= amin * 0.5) }).collect()
}
fn main() {
    let r: f64 = std::env::var("R").ok().and_then(|v| v.parse().ok()).unwrap_or(5.0);
    let amin: f64 = std::env::var("AMIN").ok().and_then(|v| v.parse().ok()).unwrap_or(150.0);
    let (mut s0, mut t0, mut s1, mut t1) = (0, 0, 0, 0);
    for path in std::env::args().skip(1) {
        let doc = Document::from_svg(&std::fs::read_to_string(&path).unwrap(), &path, None).unwrap();
        let opt = doc.plan_options();
        let before = zigzag::design::plan("b", &doc.shapes, &opt);
        let mut shapes = doc.shapes.clone();
        let mut area0 = 0.0; let mut area1 = 0.0;
        for s in &mut shapes { if let Geometry::Fill { rings, rule } = &s.geometry {
            area0 += boolean::normalize(rings, *rule).iter().map(signed).sum::<f64>().abs();
            let t = tidy(rings, *rule, r, amin);
            area1 += t.iter().map(signed).sum::<f64>().abs();
            s.geometry = Geometry::Fill { rings: t, rule: FillRule::NonZero }; } }
        let after = zigzag::design::plan("a", &shapes, &opt);
        if let Ok(dir) = std::env::var("RENDER") {
            for (tag, d) in [("before", &before), ("after", &after)] {
                let b = d.bounds();
                let mut svg = format!(r#"<svg xmlns="http://www.w3.org/2000/svg" viewBox="{} {} {} {}" width="600" style="background:#fff">"#, b.min.x, b.min.y, b.width(), b.height());
                for blk in &d.blocks { let c = blk.color; for run in &blk.runs {
                    let pts: Vec<String> = run.pts.iter().map(|p| format!("{:.1},{:.1}", p.x, p.y)).collect();
                    svg += &format!(r#"<polyline fill="none" stroke="rgb({},{},{})" stroke-width="2.2" stroke-linejoin="round" points="{}"/>"#, c[0], c[1], c[2], pts.join(" "));
                } }
                svg += "</svg>";
                let name = path.rsplit('/').next().unwrap().trim_end_matches(".svg");
                std::fs::write(format!("{dir}/{name}-{tag}.svg"), svg).unwrap();
            }
        }
        s0 += before.stitch_count(); t0 += before.trim_count(); s1 += after.stitch_count(); t1 += after.trim_count();
        println!("{:>6}->{:<6} st  {:>4}->{:<4} trims  area {:+.1}%  {}", before.stitch_count(), after.stitch_count(), before.trim_count(), after.trim_count(), (area1/area0-1.0)*100.0, path.rsplit('/').next().unwrap());
    }
    println!("TOTAL {s0}->{s1} stitches, {t0}->{t1} trims");
}
