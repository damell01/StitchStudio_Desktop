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
                Level::Warning,
                "Design fits the hoop but isn't centered in it.".into(),
            );
        }
    }

    // Check the actual planned needle movements, not just vector geometry.
    // Run boundaries represent travel/trim events, not sewn stitches.
    let (mut sewn, mut short, mut long, mut invalid) = (0usize, 0usize, 0usize, 0usize);
    let mut trims = 0usize;
    for block in &design.blocks {
        for run in &block.runs {
            trims += usize::from(run.trim_before);
            invalid += run.pts.iter().filter(|p| !p.x.is_finite() || !p.y.is_finite()).count();
            for pair in run.pts.windows(2) {
                let distance = pair[0].dist(pair[1]);
                if !distance.is_finite() { continue; }
                sewn += 1;
                if distance < 2.0 { short += 1; }
                if distance > 120.0 { long += 1; }
            }
        }
    }
    if invalid > 0 {
        add(None, Level::Error, format!("{invalid} non-finite needle positions; regenerate the design before exporting."));
    }
    if sewn == 0 && shapes.iter().any(|s| s.params.kind != Some(Kind::Skip)) {
        add(None, Level::Warning, "No sewn stitches were generated for this design.".into());
    }
    if long > 0 {
        add(None, Level::Warning, format!("{long} sewn stitches exceed 12 mm; inspect for snagging and split long stitches before exporting."));
    }
    if sewn >= 50 && short as f64 / sewn as f64 > 0.15 {
        add(None, Level::Warning, format!("{short} of {sewn} sewn stitches are under 0.2 mm; inspect dense corners, tie-ins and tiny details for thread buildup."));
    }
    if trims >= 10 && sewn > 0 && trims as f64 / sewn as f64 > 0.02 {
        add(None, Level::Info, format!("{trims} planned trims for {sewn} sewn stitches; review routing and separated objects."));
    }

    for (i, s) in shapes.iter().enumerate() {
        let kind = s.params.kind.unwrap_or(Kind::Fill);
        if kind == Kind::Skip {
            continue;
        }
        // Explicit overrides can defeat the fabric-aware defaults. Flag
        // them without silently changing an artist's intended settings.
        if matches!(kind, Kind::Fill | Kind::Satin) {
            if let Some(spacing) = s.params.spacing {
                if !spacing.is_finite() || spacing <= 0.0 {
                    add(Some(i), Level::Error, "Invalid stitch spacing; reset to the fabric default.".into());
                } else if spacing < 0.20 {
                    add(Some(i), Level::Warning, format!(
                        "Explicit spacing of {spacing:.2} mm is very dense; increase spacing or restore automatic fabric settings."
                    ));
                }
            }
            if let Some(pull) = s.params.pull {
                if !pull.is_finite() || pull < 0.0 {
                    add(Some(i), Level::Error, "Invalid pull compensation; reset to the fabric default.".into());
                } else if pull > 0.8 {
                    add(Some(i), Level::Warning, format!(
                        "Pull compensation of {pull:.2} mm is unusually large; inspect outlines and lettering gaps."
                    ));
                }
            }
        }
        // Planner notes say what it did instead (e.g. filled part of a satin): informational.
        for (si, note) in &design.notes {
            if *si == i {
                // An object the planner had to leave out is a warning.
                let level = if note.starts_with("Couldn't") {
                    Level::Warning
                } else {
                    Level::Info
                };
                add(Some(i), level, note.clone());
            }
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
    out.sort_by_key(|i| std::cmp::Reverse(i.level));
    out
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
    fn checks_actual_stitch_lengths_not_travel_between_runs() {
        use crate::design::{Block, Run};
        let mut d = Design::default();
        d.blocks.push(Block { color: [0,0,0], runs: vec![
            Run { pts: vec![P::new(0.0,0.0), P::new(130.0,0.0)], trim_before: false },
            Run { pts: vec![P::new(500.0,0.0), P::new(520.0,0.0)], trim_before: true },
        ]});
        let issues = check(&[], &d, &PlanOptions::default(), None);
        assert!(issues.iter().any(|i| i.message.contains("1 sewn stitches exceed 12 mm")));
        d.blocks[0].runs[0].pts[1] = P::new(20.0,0.0);
        assert!(!check(&[], &d, &PlanOptions::default(), None).iter().any(|i| i.message.contains("exceed 12 mm")));
    }

    #[test]
    fn flags_dense_explicit_spacing_and_excessive_pull() {
        let mut s = shape(Geometry::Fill {
            rings: vec![rect(0.0, 0.0, 100.0, 100.0)],
            rule: FillRule::NonZero,
        }, Kind::Fill);
        s.params.spacing = Some(0.15);
        s.params.pull = Some(1.0);
        let i = issues(&[s], None);
        assert!(i.iter().any(|x| x.shape == Some(0) && x.message.contains("very dense")));
        assert!(i.iter().any(|x| x.shape == Some(0) && x.message.contains("unusually large")));
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
