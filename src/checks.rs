//! Design checks: the size and width rules experienced digitizers apply,
//! reported per object so the editor (and agents) can point at the problem.

use crate::design::{Design, PlanOptions, satin_rails};
use crate::geom::{Bounds, Polyline};
use crate::params::Kind;
use crate::stitch::satin;
use crate::svg::{Geometry, Shape};

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum Level {
    Info,
    Warning,
    Error,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Issue {
    /// Index into the shape list, or `None` for whole-design issues.
    pub shape: Option<usize>,
    pub level: Level,
    pub message: String,
}

fn ring_bounds(rings: &[Polyline]) -> Bounds {
    let mut b = Bounds::empty();
    rings.iter().flatten().for_each(|&p| b.add(p));
    b
}

/// What the checks measure of one shape, kept between runs: checking runs
/// after every replan, and these walk every point of the shape.
#[derive(Clone, Copy)]
enum Facts {
    Fill {
        parts: usize,
        small_parts: usize,
        /// A hole under 1 mm across.
        narrow_gap: bool,
    },
    /// Widest and mean width, mm.
    Satin(Option<(f64, f64)>),
}

/// `measure`'s result for a shape's geometry (and `settings`, when they
/// matter), from the last time it was asked if it was.
fn facts(geometry: &Geometry, settings: Option<&str>, measure: impl FnOnce() -> Facts) -> Facts {
    use std::hash::{Hash, Hasher};
    static MEMO: std::sync::OnceLock<std::sync::Mutex<std::collections::HashMap<u64, Facts>>> =
        std::sync::OnceLock::new();
    let key = {
        let mut h = std::collections::hash_map::DefaultHasher::new();
        crate::design::geometry_key(geometry).hash(&mut h);
        settings.hash(&mut h);
        h.finish()
    };
    let memo = MEMO.get_or_init(Default::default);
    if let Some(f) = memo.lock().ok().and_then(|m| m.get(&key).copied()) {
        return f;
    }
    let f = measure();
    if let Ok(mut m) = memo.lock() {
        if m.len() > 4096 {
            m.clear();
        }
        m.insert(key, f);
    }
    f
}

/// Sampled geometric coverage gaps, in design millimeters (not physical fabric prediction).
#[derive(Clone, Debug)]
pub struct CoverageGap {
    pub shape: usize,
    pub inside: usize,
    pub missing: usize,
    pub points: Vec<[f64;2]>,
}
pub fn coverage_gaps(shapes:&[Shape],design:&Design,_opt:&PlanOptions)->Vec<CoverageGap>{
    let mut out=Vec::new();
    // Sample the interior of intended filled artwork against sewn segments.
    // This is a geometric gap warning, not a physical thread-width simulation.
    if shapes.len() <= 350 && design.stitch_count() <= 100_000 {
        use std::collections::HashMap;
        let mut sewn:HashMap<([u8;3],i32,i32),Vec<crate::geom::P>>=HashMap::new();
        let mut sample_budget=1_000_000usize;
        'sampling: for block in &design.blocks {
            for run in &block.runs {
                for pair in run.pts.windows(2) {
                    let n = (pair[0].dist(pair[1])/1.5).ceil().clamp(1.0,200.0) as usize;
                    for k in 0..=n {
                        if sample_budget==0{break 'sampling}
                        sample_budget-=1;
                        let p = pair[0].lerp(pair[1], k as f64/n as f64);
                        let cell=sewn.entry((block.color,(p.x/4.0).floor() as i32,(p.y/4.0).floor() as i32)).or_default();
                        // Retain spatially distinct samples rather than letting repeated
                        // penetrations at one location exhaust the cell capacity.
                        if !cell.iter().any(|q|q.dist(p)<0.5){cell.push(p);}
                    }
                }
            }
        }
        // Inspect only the geometry that actually needs sewing after overlap removal.
        let effective=crate::design::effective_geometry(shapes,&design.sew_order,_opt);
        let mut budget=120_000usize;
        for (i,s) in shapes.iter().enumerate() {
            if budget==0 || sample_budget==0 {break}
            if design.covered.get(i).copied().unwrap_or(false) || !matches!(s.params.kind.unwrap_or(Kind::Fill),Kind::Fill|Kind::Satin) {continue}
            let kind=s.params.kind.unwrap_or(Kind::Fill);
            if (kind==Kind::Fill&&s.params.fill_spacing(&_opt.fabric)>0.65)
                || (kind==Kind::Satin&&(s.params.colors.is_some()||s.params.satin_spacing(&_opt.fabric)>0.65)){continue}
            let Geometry::Fill{rings,rule}=effective.get(i).unwrap_or(&s.geometry) else{continue};
            let b=ring_bounds(rings);
            if b.is_empty() || b.width().min(b.height())<12.0 {continue}
            let mut inside=0usize;let mut missing=0usize;let mut points=Vec::new();
            let step=2.5_f64.max((b.width()*b.height()/4000.0).sqrt());
            let mut y=b.min.y+step/2.0;
            while y<b.max.y && budget>0 {
                let mut x=b.min.x+step/2.0;
                while x<b.max.x && budget>0 {
                    budget-=1;
                    let p=crate::geom::P::new(x,y);
                    if crate::geom::point_inside(rings,*rule,p) {
                        inside+=1;
                        let cx=(x/4.0).floor() as i32;let cy=(y/4.0).floor() as i32;
                        if !(-1..=1).any(|dx|(-1..=1).any(|dy|sewn.get(&(s.color,cx+dx,cy+dy)).is_some_and(|points|points.iter().any(|q|q.dist(p)<=3.0)))) {missing+=1;if points.len()<4000{points.push([x/10.0,y/10.0]);}}
                    }
                    x+=step;
                }
                y+=step;
            }
            if budget>0 && inside>=12 && missing>=4 && missing*100>inside*12 {
                out.push(CoverageGap{shape:i,inside,missing,points});
            }
        }
    }
    out
}

/// Run all checks. `hoop_mm` is the hoop's (width, height). (`_opt`: the
/// options the design was planned with; what overlaps cover comes from the
/// plan itself.)
pub fn check(
    shapes: &[Shape],
    design: &Design,
    _opt: &PlanOptions,
    hoop_mm: Option<(f64, f64)>,
) -> Vec<Issue> {
    let mut out = Vec::new();
    let mut add = |shape: Option<usize>, level: Level, message: String| {
        out.push(Issue {
            shape,
            level,
            message,
        })
    };

    if let Some((w, h)) = hoop_mm {
        let b = design.bounds();
        if !b.is_empty() && (b.width() > w * 10.0 || b.height() > h * 10.0) {
            add(
                None,
                Level::Error,
                format!(
                    "Design is {:.1} × {:.1} mm; the hoop sews {:.0} × {:.0} mm.",
                    b.width() / 10.0,
                    b.height() / 10.0,
                    w,
                    h
                ),
            );
        } else if !b.is_empty()
            && (b.min.x < -w * 5.0 || b.max.x > w * 5.0 || b.min.y < -h * 5.0 || b.max.y > h * 5.0)
        {
            add(
                None,
                Level::Error,
                "Design extends outside the hoop sewing area. Center or reposition it before export.".into(),
            );
        }
    }

    // Index planner notes once rather than scanning all notes for every object.
    let mut notes_by_shape = vec![Vec::new(); shapes.len()];
    for (si, note) in &design.notes {
        if let Some(notes) = notes_by_shape.get_mut(*si) {
            notes.push(note);
        }
    }
    for (i, s) in shapes.iter().enumerate() {
        let kind = s.params.kind.unwrap_or(Kind::Fill);
        if kind == Kind::Skip {
            continue;
        }
        // Planner notes say what it did instead (e.g. filled part of a satin): informational.
        for &note in &notes_by_shape[i] {
            let level = if note.starts_with("Couldn't") {
                Level::Warning
            } else {
                Level::Info
            };
            add(Some(i), level, note.clone());
        }
        match (&s.geometry, kind) {
            (Geometry::Fill { rings, rule }, Kind::Fill) => {
                if design.covered.get(i).copied().unwrap_or(false) {
                    add(
                        Some(i),
                        Level::Info,
                        "Completely covered by objects sewn on top; it won't be stitched.".into(),
                    );
                    continue;
                }
                let b = ring_bounds(rings);
                let (w, h) = (b.width() / 10.0, b.height() / 10.0);
                if w.max(h) < 1.5 {
                    add(
                        Some(i),
                        Level::Warning,
                        format!(
                            "Only {:.1} mm across: too small to fill. Make it bigger or use Run.",
                            w.max(h)
                        ),
                    );
                    continue;
                }
                let Facts::Fill {
                    parts,
                    small_parts,
                    narrow_gap,
                } = facts(&s.geometry, None, || {
                    let comps = satin::components(rings, *rule);
                    Facts::Fill {
                        parts: comps.len(),
                        small_parts: comps
                            .iter()
                            .filter(|c| ring_bounds(c).height() < 40.0)
                            .count(),
                        narrow_gap: comps.iter().flat_map(|c| c.iter().skip(1)).any(|hole| {
                            let hb = ring_bounds(std::slice::from_ref(hole));
                            hb.width().min(hb.height()) < 10.0
                        }),
                    }
                })
                else {
                    continue;
                };
                if parts >= 3 && small_parts * 2 > parts {
                    add(
                        Some(i),
                        Level::Warning,
                        "Looks like small lettering (under 4 mm tall). Fill won't read at this size: use Satin and keep letters at least 5 mm tall."
                            .into(),
                    );
                } else if w.min(h) < 2.5 {
                    add(
                        Some(i),
                        Level::Warning,
                        format!(
                            "Only {:.1} mm wide: Satin looks cleaner than Fill on narrow shapes.",
                            w.min(h)
                        ),
                    );
                }
                if narrow_gap {
                    add(
                        Some(i),
                        Level::Warning,
                        "Has a gap under 1 mm wide; thread will close it up.".into(),
                    );
                }
            }
            (_, Kind::Satin) => {
                let Facts::Satin(Some((max, mean))) =
                    facts(&s.geometry, Some(&format!("{:?}", s.params)), || {
                        let widths: Vec<f64> = satin_rails(s)
                            .iter()
                            .filter_map(|r| r.as_ref().ok())
                            .flat_map(|r| satin::pairs(r, 10.0).into_iter().map(|(a, b)| a.dist(b)))
                            .collect();
                        Facts::Satin((!widths.is_empty()).then(|| {
                            (
                                widths.iter().copied().fold(0.0, f64::max) / 10.0,
                                widths.iter().sum::<f64>() / widths.len() as f64 / 10.0,
                            )
                        }))
                    })
                else {
                    continue;
                };
                match s.params.satin_split() {
                    Some(split) if max > split => add(
                        Some(i),
                        Level::Info,
                        format!(
                            "Satin up to {max:.1} mm wide: stitches longer than {split:.1} mm are split so they don't snag."
                        ),
                    ),
                    None if max > 7.0 => add(
                        Some(i),
                        Level::Warning,
                        format!(
                            "Satin up to {max:.1} mm wide: stitches over ~7 mm get loose and snag. Turn on auto split or use Fill."
                        ),
                    ),
                    _ => {}
                }
                if mean < 1.0 {
                    add(
                        Some(i),
                        Level::Warning,
                        format!(
                            "Satin only {mean:.1} mm wide on average: too narrow to look smooth. Use Run."
                        ),
                    );
                }
            }
            _ => {}
        }
    }
    for gap in coverage_gaps(shapes,design,_opt) {
        add(Some(gap.shape),Level::Warning,format!("Possible underfilled artwork: {}% of sampled interior locations have no nearby same-color sewn path. Inspect letter strokes, fill spacing and pull compensation; this is a geometric estimate, not a physical sew-out.",gap.missing*100/gap.inside));
    }
    // Compare nearby similarly sized solid glyph-like objects. This is a
    // settings consistency advisory, not a font recognition or weight test.
    if shapes.len()<=350 {
        let mut chord_budget=250_000usize;
        for (i,s) in shapes.iter().enumerate(){
            let Geometry::Fill{rings,..}=&s.geometry else{continue};
            let b=ring_bounds(rings);
            if b.is_empty()||b.height()<15.0||b.width()>b.height()*1.8{continue}
            let kind=s.params.kind.unwrap_or(Kind::Fill);
            if !matches!(kind,Kind::Fill|Kind::Satin){continue}
            let spacing=if kind==Kind::Satin{s.params.satin_spacing(&_opt.fabric)}else{s.params.fill_spacing(&_opt.fabric)};
            // Estimate average stroke thickness from filled area and boundary length.
            // This is a screening metric, not a local satin rail measurement.
            let mut area=0.0_f64;
            let mut perimeter=0.0_f64;
            for ring in rings {
                if ring.len()<3{continue}
                let mut signed=0.0;
                for k in 0..ring.len(){
                    let a=ring[k];let b=ring[(k+1)%ring.len()];
                    signed+=a.x*b.y-b.x*a.y;
                    perimeter+=a.dist(b);
                }
                area+=signed*0.5;
            }
            let stroke=if perimeter>0.0{2.0*area.abs()/perimeter/10.0}else{0.0};
            if stroke>0.0&&stroke<0.8&&kind==Kind::Fill{
                add(Some(i),Level::Info,format!("Thin lettering-like fill: estimated stroke thickness {stroke:.2} mm. Inspect satin or running-stitch suitability and avoid excessive density."));
            }
            // Sample horizontal and vertical interior chords. The shorter
            // axis is a conservative local-width proxy, not a satin rail.
            if let Geometry::Fill{rule,..}=&s.geometry {
                let step=3.0_f64.max((b.width()*b.height()/256.0).sqrt());
                let mut widths=Vec::new();
                let mut y=b.min.y+step/2.0;
                while y<b.max.y && chord_budget>0 {
                    let mut x=b.min.x+step/2.0;
                    while x<b.max.x && chord_budget>0 {
                        chord_budget-=1;
                        let p=crate::geom::P::new(x,y);
                        if crate::geom::point_inside(rings,*rule,p){
                            let mut spans=[0.0_f64;2];
                            for (axis,(dx,dy)) in [(1.0,0.0),(0.0,1.0)].into_iter().enumerate(){
                                for sign in [-1.0,1.0]{
                                    for k in 1..=40{
                                        if chord_budget==0{break}
                                        chord_budget-=1;
                                        let d=k as f64*1.0;
                                        if !crate::geom::point_inside(rings,*rule,crate::geom::P::new(x+dx*d*sign,y+dy*d*sign)){break}
                                        spans[axis]+=1.0;
                                    }
                                }
                            }
                            widths.push((spans[0].min(spans[1])+1.0)/10.0);
                        }
                        x+=step;
                    }
                    y+=step;
                }
                if chord_budget>0&&widths.len()>=12{
                    widths.sort_by(|a,b|a.total_cmp(b));
                    let narrow=widths[widths.len()/10];
                    let wide=widths[widths.len()*9/10];
                    if narrow<0.8&&wide>narrow*2.5{
                        add(Some(i),Level::Info,format!("Variable lettering stroke widths: sampled narrow sections about {narrow:.1} mm and wider sections about {wide:.1} mm. Inspect thin details and junctions separately."));
                    }
                }
            }
            let mut peers=Vec::new();
            let mut other_kind=0usize;
            let mut same_kind=0usize;
            for (j,q) in shapes.iter().enumerate(){
                if i==j||q.color!=s.color{continue}
                let Geometry::Fill{rings,..}=&q.geometry else{continue};
                let c=ring_bounds(rings);
                if c.is_empty()||c.height()<b.height()*0.8||c.height()>b.height()*1.25||c.width()>c.height()*1.8|| (c.center().y-b.center().y).abs()>b.height()*0.2 || (c.center().x-b.center().x).abs()>b.height()*4.0{continue}
                let k=q.params.kind.unwrap_or(Kind::Fill);
                if !matches!(k,Kind::Fill|Kind::Satin){continue}
                if k!=kind{other_kind+=1;continue}
                same_kind+=1;
                peers.push(if k==Kind::Satin{q.params.satin_spacing(&_opt.fabric)}else{q.params.fill_spacing(&_opt.fabric)});
            }
            if other_kind>=3&&other_kind>same_kind*2 {
                add(Some(i),Level::Info,"Possible mixed lettering stitch types: nearby similar objects predominantly use a different fill or satin technique. Inspect visual weight; narrow and wide glyphs may legitimately need different stitch types.".into());
            }
            if peers.len()<3{continue}
            peers.sort_by(|a,b|a.total_cmp(b));
            let median=peers[peers.len()/2];
            if median>0.0&&(spacing/median<0.8||spacing/median>1.25){
                add(Some(i),Level::Warning,format!("Possible inconsistent lettering density: row spacing {spacing:.2} mm versus nearby similar objects {median:.2} mm. Check intended font weight and stitch coverage before adjusting."));
            }
        }
    }
    // Inspect the actual planned needle movements, not just source geometry.
    // Run boundaries represent travel/trim decisions and are not sewn segments.
    let mut long = 0usize;
    let mut tiny = 0usize;
    let mut total = 0usize;
    let mut longest = 0.0_f64;
    let mut invalid = 0usize;
    let mut repeated = 0usize;
    let mut worst = 0usize;
    let mut hotspots = 0usize;
    let mut max_penetrations = 0usize;
    // Accumulate penetrations across runs and colors as well: overlap
    // hotspots are invisible when each run is measured in isolation.
    let mut cells = std::collections::HashMap::<(i64,i64),usize>::new();
    let mut locations = std::collections::HashMap::<(i64,i64),usize>::new();
    for block in &design.blocks {
        for run in &block.runs {
            let mut edges = std::collections::HashMap::new();
            let mut penetrations = std::collections::HashMap::new();
            for p in &run.pts {
                if !p.x.is_finite() || !p.y.is_finite() { continue; }
                let key = (p.x.round() as i64, p.y.round() as i64);
                *locations.entry(key).or_default() += 1;
                *cells.entry(((p.x/10.0).floor() as i64,(p.y/10.0).floor() as i64)).or_default() += 1;
                let count = penetrations.entry(key).or_insert(0usize);
                *count += 1;
                max_penetrations = max_penetrations.max(*count);
                if *count == 10 { hotspots += 1; }
            }
            invalid += run.pts.iter().filter(|p| !p.x.is_finite() || !p.y.is_finite()).count();
            for pair in run.pts.windows(2) {
                let length = pair[0].dist(pair[1]) / 10.0;
                total += 1;
                longest = longest.max(length);
                if length > 12.0 { long += 1; }
                if length < 0.2 { tiny += 1; }
                if length >= 0.2 && length.is_finite() {
                    let count = edges.entry(segment_key(pair[0], pair[1])).or_insert(0usize);
                    *count += 1;
                    worst = worst.max(*count);
                    if *count == 5 { repeated += 1; }
                }
            }
        }
    }
    if invalid > 0 {
        add(None, Level::Error, format!("{invalid} stitch coordinates are invalid. Regenerate the stitch plan before export."));
    }
    for (i, shape) in shapes.iter().enumerate() {
        if shape.params.kind != Some(Kind::Skip)
            && !design.covered.get(i).copied().unwrap_or(false)
            && design.per_shape.get(i).copied().unwrap_or(0) == 0 {
            add(Some(i), Level::Warning, "Object generated no stitches. Inspect its geometry or stitch type.".into());
        }
    }
    let dense_cells=cells.values().filter(|&&n|n>=25).count();
    let peak=cells.values().copied().max().unwrap_or(0);
    if dense_cells>0 {
        add(None,Level::Warning,format!("{dense_cells} one-square-millimeter cells contain at least 25 planned points (peak {peak}). Inspect layered fills and tight corners; this is a review threshold, not a universal fabric limit."));
    }
    let repeated_locations=locations.values().filter(|&&n|n>=10).count();
    if repeated_locations>hotspots {
        add(None,Level::Warning,format!("{repeated_locations} needle locations accumulate ten or more planned penetrations across the complete design. Inspect overlap and repeated travel."));
    }
    if hotspots > 0 {
        add(None, Level::Warning, format!("{hotspots} needle locations receive at least ten penetrations within a run (maximum {max_penetrations}). Inspect dense corners, tie stitches and repeated travel before sewing."));
    }
    if repeated > 0 {
        add(None, Level::Warning, format!("{repeated} stitch segments are traversed at least five times within a run (maximum {worst}). Inspect hole boundaries, travel routes and intentional reinforcement before sewing."));
    }
    if long > 0 {
        add(None, Level::Warning, format!(
            "{long} sewn movements exceed 12 mm (longest {longest:.1} mm). Inspect long stitches and machine format limits before export."
        ));
    }
    if tiny >= 30 && tiny.saturating_mul(10) > total {
        add(None, Level::Warning, format!(
            "{tiny} of {total} sewn movements are under 0.2 mm. Inspect dense areas for repeated needle penetration; some tie stitches are intentional."
        ));
    }
    if !shapes.is_empty() && design.stitch_count() == 0
        && shapes.iter().any(|s| s.params.kind != Some(Kind::Skip)) {
        add(None, Level::Error, "No stitches were generated for the design. Review object settings before exporting.".into());
    }
    out.sort_by_key(|i| std::cmp::Reverse(i.level));
    out
}

// Coordinates are in tenths of a millimetre. Match at machine resolution,
// irrespective of direction, to detect repeated travel along the same edge.
fn segment_key(a: crate::geom::P, b: crate::geom::P) -> ((i64,i64),(i64,i64)) {
    let quantize = |p: crate::geom::P| (p.x.round() as i64, p.y.round() as i64);
    let a = quantize(a);
    let b = quantize(b);
    if a <= b { (a,b) } else { (b,a) }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::design::plan;
    use crate::geom::{FillRule, P};
    use crate::params::Params;
    use crate::svg::Part;

    fn shape(geometry: Geometry, kind: Kind) -> Shape {
        Shape {
            id: String::new(),
            part: Part::Fill,
            label: String::new(),
            color: [0, 0, 0],
            paint: [0, 0, 0],
            geometry,
            params: Params {
                kind: Some(kind),
                ..Params::default()
            },
            uid: 0,
            groups: Vec::new(),
        }
    }

    fn rect(x: f64, y: f64, w: f64, h: f64) -> Polyline {
        vec![
            P::new(x, y),
            P::new(x + w, y),
            P::new(x + w, y + h),
            P::new(x, y + h),
        ]
    }

    fn issues(shapes: &[Shape], hoop: Option<(f64, f64)>) -> Vec<Issue> {
        let opt = PlanOptions::default();
        let d = plan("t", shapes, &opt);
        check(shapes, &d, &opt, hoop)
    }

    #[test]
    fn repeated_segment_key_ignores_direction() {
        let a = P::new(10.0, 15.0);
        let b = P::new(30.0, 40.0);
        assert_eq!(segment_key(a,b), segment_key(b,a));
        assert_eq!(segment_key(a,b), segment_key(P::new(10.1,15.1),b));
    }

    #[test]
    fn flags_narrow_fill_and_small_lettering() {
        let narrow = shape(
            Geometry::Fill {
                rings: vec![rect(0.0, 0.0, 200.0, 15.0)],
                rule: FillRule::NonZero,
            },
            Kind::Fill,
        );
        let i = issues(&[narrow], None);
        assert!(
            i.iter().any(|x| x.message.contains("Satin looks cleaner")),
            "{i:?}"
        );

        let letters: Vec<Polyline> = (0..5)
            .map(|k| rect(k as f64 * 30.0, 0.0, 20.0, 30.0))
            .collect();
        let text = shape(
            Geometry::Fill {
                rings: letters,
                rule: FillRule::NonZero,
            },
            Kind::Fill,
        );
        let i = issues(&[text], None);
        assert!(
            i.iter().any(|x| x.message.contains("small lettering")),
            "{i:?}"
        );
    }

    #[test]
    fn flags_wide_satin_and_hoop_overflow() {
        let mut wide = shape(
            Geometry::Stroke {
                lines: vec![(vec![P::new(0.0, 0.0), P::new(300.0, 0.0)], false)],
                width: 90.0,
            },
            Kind::Satin,
        );
        let i = issues(std::slice::from_ref(&wide), Some((10.0, 10.0)));
        assert_eq!(i[0].level, Level::Error, "hoop overflow sorts first: {i:?}");
        assert!(i.iter().any(|x| x.message.contains("are split")));
        wide.params.split = Some(0.0);
        let i = issues(&[wide], None);
        assert!(i.iter().any(|x| x.message.contains("loose and snag")));
    }

    #[test]
    fn blocks_off_center_design_outside_sewing_area() {
        let off_center = shape(
            Geometry::Fill {
                rings: vec![rect(70.0, -20.0, 40.0, 40.0)],
                rule: FillRule::NonZero,
            },
            Kind::Fill,
        );
        let i = issues(&[off_center], Some((10.0, 10.0)));
        assert!(i.iter().any(|x| x.level == Level::Error && x.message.contains("outside the hoop")));
    }

    #[test]
    fn reports_fully_covered_objects() {
        let under = shape(
            Geometry::Fill {
                rings: vec![rect(10.0, 10.0, 50.0, 50.0)],
                rule: FillRule::NonZero,
            },
            Kind::Fill,
        );
        let over = shape(
            Geometry::Fill {
                rings: vec![rect(0.0, 0.0, 100.0, 100.0)],
                rule: FillRule::NonZero,
            },
            Kind::Fill,
        );
        let i = issues(&[under, over], None);
        assert!(
            i.iter()
                .any(|x| x.shape == Some(0) && x.message.contains("Completely covered")),
            "{i:?}"
        );
    }
}
