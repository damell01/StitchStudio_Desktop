//! Automatic stitch selection on SVG artwork: what each object becomes, and the
//! resulting stitches and trims.  cargo run --release --example stitch_selection_profile -- <svg>...
use zigzag::{document::Document, params::Kind};
fn main() {
    let (mut st, mut tr, mut runs, mut satins, mut fills) = (0, 0, 0, 0, 0);
    for path in std::env::args().skip(1) {
        let mut doc = Document::from_svg(&std::fs::read_to_string(&path).unwrap(), &path, None).unwrap();
        for s in &mut doc.shapes { s.params.kind = None; }
        zigzag::design::auto_stitch_types(&mut doc.shapes);
        for s in &doc.shapes { match s.params.kind { Some(Kind::Run) => runs += 1, Some(Kind::Satin) => satins += 1, _ => fills += 1 } }
        let d = zigzag::design::plan("p", &doc.shapes, &doc.plan_options());
        st += d.stitch_count(); tr += d.trim_count();
        if std::env::var("EACH").is_ok() { println!("{:>6} st {:>4} trims  {}", d.stitch_count(), d.trim_count(), path.rsplit('/').next().unwrap()); }
    }
    println!("objects: {runs} running, {satins} satin, {fills} fill | {st} stitches, {tr} trims");
}
