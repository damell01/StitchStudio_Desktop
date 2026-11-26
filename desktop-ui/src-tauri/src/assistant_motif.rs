use super::{Preview, Workspace, editable_base, preview, validate_resized_design};
use std::sync::Mutex;
use tauri::Manager;
use zigzag::{
    design::auto_stitch_types,
    document::{Document, Placement},
    params::Kind,
    svg::{Geometry, shapes_bounds},
};

#[derive(Clone, Copy, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
enum Position {
    Center,
    Above,
    Below,
    Left,
    Right,
    TopLeft,
    TopRight,
    BottomLeft,
    BottomRight,
    Sides,
    TopCorners,
    BottomCorners,
}

impl Position {
    fn offsets(self) -> &'static [(i8, i8)] {
        match self {
            Self::Center => &[(0, 0)],
            Self::Above => &[(0, -1)],
            Self::Below => &[(0, 1)],
            Self::Left => &[(-1, 0)],
            Self::Right => &[(1, 0)],
            Self::TopLeft => &[(-1, -1)],
            Self::TopRight => &[(1, -1)],
            Self::BottomLeft => &[(-1, 1)],
            Self::BottomRight => &[(1, 1)],
            Self::Sides => &[(-1, 0), (1, 0)],
            Self::TopCorners => &[(-1, -1), (1, -1)],
            Self::BottomCorners => &[(-1, 1), (1, 1)],
        }
    }
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Motif {
    name: String,
    svg: String,
    color: Option<[u8; 3]>,
    width: f64,
    position: Position,
    applique: bool,
    anchor: [f64; 4],
    field: [f64; 2],
}

impl Motif {
    fn validate(&self) -> Result<(), String> {
        let min_width = if self.applique { 20.0 } else { 5.0 };
        if !(min_width..=150.0).contains(&self.width)
            || self.svg.is_empty()
            || self.svg.len() > 4_000_000
            || self.name.trim().is_empty()
            || self.name.chars().count() > 160
            || self.name.chars().any(char::is_control)
            || !self
                .anchor
                .iter()
                .all(|v| v.is_finite() && v.abs() <= 1200.0)
            || self.anchor[2] < 0.0
            || self.anchor[3] < 0.0
            || !self.field.iter().all(|v| (10.0..=1200.0).contains(v))
        {
            return Err("Invalid motif, size or hoop placement.".into());
        }
        Ok(())
    }

    fn add_to(&self, doc: &mut Document) -> Result<(), String> {
        self.validate()?;
        let [anchor_x, anchor_y, anchor_w, anchor_h] = self.anchor;
        for &(horizontal, vertical) in self.position.offsets() {
            let indices = doc
                .add_svg(
                    &self.svg,
                    Placement {
                        width_mm: Some(self.width),
                        center_mm: Some((0.0, 0.0)),
                        ..Default::default()
                    },
                )
                .map_err(|error| error.to_string())?;
            if indices.is_empty() || indices.len() > 500 {
                return Err("This artwork must have between 1 and 500 editable shapes.".into());
            }

            let shapes: Vec<_> = indices
                .iter()
                .map(|&index| doc.shapes[index].clone())
                .collect();
            let bounds = shapes_bounds(&shapes);
            let center = bounds.center();
            let w = bounds.width() / 10.0;
            let h = bounds.height() / 10.0;
            let gap = 2.0;
            let x = anchor_x
                + anchor_w / 2.0
                + f64::from(horizontal) * (anchor_w / 2.0 + w / 2.0 + gap);
            let y =
                anchor_y + anchor_h / 2.0 + f64::from(vertical) * (anchor_h / 2.0 + h / 2.0 + gap);
            if ![w, h, x, y].iter().all(|v| v.is_finite())
                || x.abs() + w / 2.0 + 1.0 > self.field[0] / 2.0
                || y.abs() + h / 2.0 + 1.0 > self.field[1] / 2.0
            {
                return Err("The motif would extend beyond the usable hoop area. Try a smaller width or another placement.".into());
            }

            let body = if self.applique {
                indices.iter().copied().filter(|&index| {
                    matches!(&doc.shapes[index].geometry, Geometry::Fill { rings, .. } if !rings.is_empty())
                }).max_by(|&a, &b| {
                    fill_area(&doc.shapes[a].geometry).total_cmp(&fill_area(&doc.shapes[b].geometry))
                })
            } else {
                None
            };
            if self.applique && body.is_none() {
                return Err("Appliqué requires a closed area for the fabric piece.".into());
            }
            for &index in &indices {
                let shape = &mut doc.shapes[index];
                if let Some(color) = self.color {
                    shape.color = color;
                }
                if Some(index) == body {
                    shape.params.kind = Some(Kind::Applique);
                } else if shape.params.kind.is_none() {
                    auto_stitch_types(std::slice::from_mut(shape));
                }
            }
            doc.transform(
                &indices,
                [1.0, 0.0, 0.0, 1.0, x * 10.0 - center.x, y * 10.0 - center.y],
            )
            .map_err(|error| error.to_string())?;
        }
        Ok(())
    }
}

fn fill_area(geometry: &Geometry) -> f64 {
    let Geometry::Fill { rings, .. } = geometry else {
        return 0.0;
    };
    rings
        .iter()
        .map(|ring| {
            ring.iter()
                .zip(ring.iter().cycle().skip(1))
                .map(|(a, b)| a.x * b.y - a.y * b.x)
                .sum::<f64>()
                .abs()
        })
        .fold(0.0, f64::max)
}

fn prepare(workspace: &Workspace, motif: &Motif) -> Result<Document, String> {
    motif.validate()?;
    let mut document = editable_base(workspace, &motif.name)?;
    motif.add_to(&mut document)?;
    Ok(document)
}

fn validate_plan(
    workspace: &Workspace,
    motif: &Motif,
    design: &zigzag::design::Design,
) -> Result<(), String> {
    validate_resized_design(design)?;
    let fits = |candidate: &zigzag::design::Design| {
        candidate
            .blocks
            .iter()
            .flat_map(|block| &block.runs)
            .flat_map(|run| &run.pts)
            .all(|point| {
                point.x.abs() <= motif.field[0] * 5.0 && point.y.abs() <= motif.field[1] * 5.0
            })
    };
    if workspace.current.as_ref().is_none_or(fits) && !fits(design) {
        return Err("The generated stitches extend outside the usable hoop area.".into());
    }
    Ok(())
}

#[tauri::command]
pub(super) async fn preview_assistant_motif(
    motif: Motif,
    app: tauri::AppHandle,
) -> Result<Preview, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<Mutex<Workspace>>();
        let mut workspace = state.lock().map_err(|error| error.to_string())?;
        let document = prepare(&workspace, &motif)?;
        let design = document.plan_cached(&mut workspace.plan_cache);
        validate_plan(&workspace, &motif, &design)?;
        Ok(preview(&design))
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub(super) async fn insert_assistant_motif(
    motif: Motif,
    app: tauri::AppHandle,
) -> Result<Preview, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<Mutex<Workspace>>();
        let mut workspace = state.lock().map_err(|error| error.to_string())?;
        let document = prepare(&workspace, &motif)?;
        let design = document.plan_cached(&mut workspace.plan_cache);
        validate_plan(&workspace, &motif, &design)?;
        let result = preview(&design);
        if workspace.current.is_none() {
            workspace.current = Some(Document::empty().plan());
        }
        workspace.checkpoint_named("Add design motif");
        workspace.current = Some(design);
        workspace.source = Some(document);
        Ok(result)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub(super) async fn trace_assistant_motif(
    group: String,
    file: String,
    width: f64,
) -> Result<String, String> {
    if !(5.0..=150.0).contains(&width) {
        return Err("Invalid motif width.".into());
    }
    let is_svg = file.to_ascii_lowercase().ends_with(".svg");
    let bytes = super::character_image(group, file).await?;
    if is_svg {
        if bytes.len() > 4_000_000 {
            return Err("SVG motif exceeds the 4 MB artwork limit.".into());
        }
        return String::from_utf8(bytes).map_err(|_| "SVG artwork must use UTF-8.".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let options = zigzag::trace::TraceOptions {
            width_mm: width,
            ..Default::default()
        };
        zigzag::trace::trace_prepared_bytes(&bytes, &options, 32, false)
            .map(|trace| trace.svg)
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}


#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Composition {
    name: String,
    field: [f64; 2],
    motifs: Vec<Motif>,
    lettering: Vec<CompositionText>,
}
#[derive(serde::Deserialize)]
struct CompositionText {
    settings: super::lettering_edit::LetteringSettings,
    center: [f64; 2],
}
fn prepare_composition(workspace: &Workspace, composition: Composition) -> Result<(Document, [f64; 2]), String> {
    if composition.name.trim().is_empty() || composition.name.len()>160
        || !composition.field.iter().all(|v| (10.0..=1200.0).contains(v))
        || composition.motifs.len()+composition.lettering.len()>24
        || composition.motifs.is_empty() && composition.lettering.is_empty() {
        return Err("Choose a valid composition with up to 24 elements.".into());
    }
    let mut doc=editable_base(workspace,&composition.name)?;
    for mut motif in composition.motifs {
        motif.field=composition.field;
        motif.add_to(&mut doc)?;
    }
    for text in composition.lettering {
        if !text.center.iter().all(|v| v.is_finite() && v.abs()<=500.0) {
            return Err("Invalid lettering position.".into());
        }
        let spec=text.settings.spec()?;
        doc.add_lettering(&spec,(text.center[0],text.center[1])).map_err(|e|e.to_string())?;
    }
    Ok((doc,composition.field))
}
#[tauri::command]
pub(super) async fn compose_assistant_design(composition: Composition, apply: bool, app: tauri::AppHandle) -> Result<Preview,String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state=app.state::<Mutex<Workspace>>();
        let mut workspace=state.lock().map_err(|e|e.to_string())?;
        let (doc,field)=prepare_composition(&workspace,composition)?;
        let design=doc.plan_cached(&mut workspace.plan_cache);
        validate_resized_design(&design)?;
        if design.blocks.iter().flat_map(|b| &b.runs).flat_map(|r| &r.pts)
            .any(|p|p.x.abs()>field[0]*5.0 || p.y.abs()>field[1]*5.0) {
            return Err("Composition exceeds the hoop. Reduce its size or adjust placement.".into());
        }
        let result=preview(&design);
        if apply {
            if workspace.current.is_none() {workspace.current=Some(Document::empty().plan());}
            workspace.checkpoint_named("Create assistant composition");
            workspace.current=Some(design);
            workspace.source=Some(doc);
        }
        Ok(result)
    }).await.map_err(|e|e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample() -> Motif {
        Motif {
            name: "Square".into(),
            svg: r#"<svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="100mm"><rect width="100" height="100" fill="blue"/></svg>"#.into(),
            color: Some([121, 68, 171]), width: 24.0, position: Position::Sides,
            applique: true, anchor: [-10.0, -5.0, 20.0, 10.0], field: [130.0, 180.0],
        }
    }

    #[test]
    fn adds_two_editable_appliques_with_sewing_stages() {
        let motif = sample();
        let document = prepare(&Workspace::default(), &motif).unwrap();
        assert_eq!(document.shapes.len(), 2);
        for (shape, right) in document.shapes.iter().zip([false, true]) {
            assert_eq!(shape.color, [121, 68, 171]);
            assert_eq!(shape.params.kind, Some(Kind::Applique));
            let x = shapes_bounds(std::slice::from_ref(shape)).center().x;
            assert!((x - if right { 240.0 } else { -240.0 }).abs() < 0.1);
        }
        let design = document.plan();
        let dst = zigzag::formats::dst::write_dst(&design);
        let round_trip = zigzag::formats::read::read_stitch_file(&dst, "dst").unwrap();
        assert!(round_trip.blocks.len() >= 5);
    }

    #[test]
    fn rejects_outside_hoop_without_mutating_workspace() {
        let mut motif = sample();
        motif.field = [40.0, 40.0];
        let workspace = Workspace::default();
        assert!(prepare(&workspace, &motif).is_err());
        assert!(workspace.source.is_none() && workspace.current.is_none());
    }
}
