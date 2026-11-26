use super::{
    Preview, Workspace,
    assistant_motif::{Motif, validate_plan},
    editable_base,
    lettering_edit::LetteringSettings,
    preview,
};
use std::{fmt::Write, sync::Mutex};
use tauri::Manager;
use zigzag::{
    document::{Document, Placement},
    geom::Bounds,
    params::Kind,
    svg::shapes_bounds,
};

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Composition {
    lettering: Option<LetteringSettings>,
    frame: Option<Frame>,
    accents: Vec<Motif>,
    width: Option<f64>,
    field: [f64; 2],
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
enum FrameStyle {
    Round,
    Oval,
    Rounded,
    Scalloped,
}

#[derive(serde::Deserialize)]
struct Frame {
    style: FrameStyle,
    color: [u8; 3],
}

fn rectangle(bounds: Bounds) -> [f64; 4] {
    [
        bounds.min.x / 10.0,
        bounds.min.y / 10.0,
        bounds.width() / 10.0,
        bounds.height() / 10.0,
    ]
}

fn bounds(document: &Document, indices: &[usize]) -> Bounds {
    let shapes: Vec<_> = indices
        .iter()
        .map(|&i| document.shapes[i].clone())
        .collect();
    shapes_bounds(&shapes)
}

fn frame_path(style: &FrameStyle, width: f64, height: f64) -> String {
    let (rx, ry) = (width / 2.0, height / 2.0);
    match style {
        FrameStyle::Round | FrameStyle::Oval => {
            format!("M -{rx} 0 A {rx} {ry} 0 1 1 {rx} 0 A {rx} {ry} 0 1 1 -{rx} 0 Z")
        }
        FrameStyle::Rounded => {
            let r = 5.0_f64.min(ry * 0.3).min(rx * 0.3);
            let u = rx - r;
            let v = ry - r;
            format!(
                "M -{u} -{ry} H {u} Q {rx} -{ry} {rx} -{v} V {v} Q {rx} {ry} {u} {ry} H -{u} Q -{rx} {ry} -{rx} {v} V -{v} Q -{rx} -{ry} -{u} -{ry} Z"
            )
        }
        FrameStyle::Scalloped => {
            let n = ((width + height) / 6.0).round().clamp(16.0, 64.0) as usize;
            let step = std::f64::consts::TAU / n as f64;
            let mut path = format!("M {rx:.4} 0");
            for index in 0..n {
                let middle = (index as f64 + 0.5) * step;
                let next = (index as f64 + 1.0) * step;
                let _ = write!(
                    path,
                    " Q {:.4} {:.4} {:.4} {:.4}",
                    (rx + 2.0) * middle.cos(),
                    (ry + 2.0) * middle.sin(),
                    rx * next.cos(),
                    ry * next.sin()
                );
            }
            path.push_str(" Z");
            path
        }
    }
}

impl Frame {
    fn add(&self, document: &mut Document, content: Bounds) -> Result<(), String> {
        let pad = 7.0;
        let (mut w, mut h) = (content.width() / 10.0 + pad, content.height() / 10.0 + pad);
        if matches!(
            self.style,
            FrameStyle::Round | FrameStyle::Oval | FrameStyle::Scalloped
        ) {
            // Enclose the corners of the content rectangle, including wide lettering.
            w *= std::f64::consts::SQRT_2;
            h *= std::f64::consts::SQRT_2;
        }
        if matches!(self.style, FrameStyle::Round) {
            w = w.max(h);
            h = w;
        }
        let path = frame_path(&self.style, w, h);
        let [r, g, b] = self.color;
        let view_w = w + 8.0;
        let view_h = h + 8.0;
        let left = -view_w / 2.0;
        let top = -view_h / 2.0;
        let svg = format!(
            r##"<svg xmlns="http://www.w3.org/2000/svg" width="{view_w}mm" height="{view_h}mm" viewBox="{left} {top} {view_w} {view_h}">
            <path id="Patch_border" d="{path}" fill="none" stroke="#{r:02x}{g:02x}{b:02x}" stroke-width="2" stroke-linejoin="round"/>
            </svg>"##
        );
        let center = content.center();
        let indices = document
            .add_svg(
                &svg,
                Placement {
                    center_mm: Some((center.x / 10.0, center.y / 10.0)),
                    ..Default::default()
                },
            )
            .map_err(|error| error.to_string())?;
        if indices.len() != 1 {
            return Err("Could not create the border.".into());
        }
        document.shapes[indices[0]].params.kind = Some(Kind::Satin);
        Ok(())
    }
}

fn prepare(workspace: &Workspace, composition: Composition) -> Result<Document, String> {
    let Composition {
        lettering,
        frame,
        accents,
        width,
        field,
    } = composition;
    if accents.len() > 6
        || (lettering.is_none() && accents.is_empty())
        || !field.iter().all(|v| (20.0..=1200.0).contains(v))
        || width.is_some_and(|w| !(25.0..=300.0).contains(&w))
    {
        return Err("Check the composition size and hoop dimensions.".into());
    }
    let spec = lettering.map(LetteringSettings::spec).transpose()?;
    let name = spec
        .as_ref()
        .map(|s| s.text.as_str())
        .unwrap_or("Assistant design");
    let mut document = editable_base(workspace, name)?;
    let original: std::collections::HashSet<_> =
        document.shapes.iter().map(|shape| shape.uid).collect();
    let originals = |doc: &Document| {
        doc.shapes
            .iter()
            .enumerate()
            .filter_map(|(i, shape)| original.contains(&shape.uid).then_some(i))
            .collect::<Vec<_>>()
    };
    let additions = |doc: &Document| {
        doc.shapes
            .iter()
            .enumerate()
            .filter_map(|(i, shape)| (!original.contains(&shape.uid)).then_some(i))
            .collect::<Vec<_>>()
    };
    let anchor = if let Some(spec) = spec {
        let index = document
            .add_lettering(&spec, (0.0, 0.0))
            .map_err(|error| error.to_string())?;
        Some(rectangle(bounds(&document, &[index])))
    } else {
        None
    };
    for (index, mut accent) in accents.into_iter().enumerate() {
        let current = additions(&document);
        accent.anchor = anchor.unwrap_or_else(|| {
            if current.is_empty() {
                [0.0; 4]
            } else {
                rectangle(bounds(&document, &current))
            }
        });
        // Use a temporary layout area. Fit the complete design to the real hoop below.
        accent.field = [1200.0, 1200.0];
        if index > 0 && matches!(accent.position, super::assistant_motif::Position::Center) {
            accent.position = super::assistant_motif::Position::Right;
            accent.anchor = rectangle(bounds(&document, &current));
        }
        accent.add_to(&mut document)?;
    }
    let content = bounds(&document, &additions(&document));
    if let Some(frame) = frame {
        frame.add(&mut document, content)?;
    }
    let indices = additions(&document);
    let output = bounds(&document, &indices);
    let [_, _, natural_width, natural_height] = rectangle(output);
    let scale = width.map(|value| value / natural_width).unwrap_or(1.0);
    if !(0.25..=4.0).contains(&scale) || natural_height <= 0.0 {
        return Err("Choose a design width closer to the artwork size.".into());
    }
    let half_w = natural_width * scale / 2.0;
    let half_h = natural_height * scale / 2.0;
    let existing = originals(&document);
    let centers = if existing.is_empty() {
        vec![(0.0, 0.0)]
    } else {
        let [x, y, w, h] = rectangle(bounds(&document, &existing));
        let (cx, cy) = (x + w / 2.0, y + h / 2.0);
        vec![
            (x + w + half_w + 3.0, cy),
            (x - half_w - 3.0, cy),
            (cx, y + h + half_h + 3.0),
            (cx, y - half_h - 3.0),
        ]
    };
    let (cx,cy) = centers.into_iter().find(|(x,y)| {
        x.abs()+half_w+1.0 <= field[0]/2.0 && y.abs()+half_h+1.0 <= field[1]/2.0
    }).ok_or("There is not enough clear space in the hoop. Choose a smaller design or open an empty workspace.")?;
    let c = output.center();
    document
        .transform(
            &indices,
            [
                scale,
                0.0,
                0.0,
                scale,
                cx * 10.0 - c.x * scale,
                cy * 10.0 - c.y * scale,
            ],
        )
        .map_err(|error| error.to_string())?;
    Ok(document)
}

#[tauri::command]
pub(super) async fn assistant_compose(
    composition: Composition,
    apply: bool,
    app: tauri::AppHandle,
) -> Result<Preview, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<Mutex<Workspace>>();
        let mut workspace = state.lock().map_err(|error| error.to_string())?;
        let field = composition.field;
        let document = prepare(&workspace, composition)?;
        let design = document.plan_cached(&mut workspace.plan_cache);
        validate_plan(&workspace, field, &design)?;
        let result = preview(&design);
        if apply {
            if workspace.current.is_none() {
                workspace.current = Some(Document::empty().plan());
            }
            workspace.checkpoint_named("Create embroidery design");
            workspace.source = Some(document);
            workspace.current = Some(design);
        }
        Ok(result)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn composes_vector_art_and_border_at_the_requested_width() {
        let mut workspace = Workspace::default();
        let mut existing = Document::empty();
        existing.add_svg(r#"<svg xmlns="http://www.w3.org/2000/svg" width="10mm" height="10mm"><rect width="30" height="30" fill="black"/></svg>"#,
            Placement { center_mm:Some((-40.0,0.0)), ..Default::default() }).unwrap();
        let original = existing.shapes[0].uid;
        let original_center = bounds(&existing, &[0]).center();
        workspace.current = Some(existing.plan());
        workspace.source = Some(existing);
        let request = serde_json::from_value(serde_json::json!({
            "width": 40, "field":[130,180], "frame":{"style":"scalloped","color":[105,69,162]},
            "accents": [{
                "name":"Heart", "width":25, "position":"center", "applique":false,
                "svg":"<svg xmlns='http://www.w3.org/2000/svg' width='30mm' height='30mm'><path d='M0 15 Q0 -5 15 9 Q30 -5 30 15 L15 33 Z' fill='red'/></svg>",
                "anchor":[0,0,0,0], "field":[130,180]
            }]
        })).unwrap();
        let document = prepare(&workspace, request).unwrap();
        assert_eq!(document.shapes.len(), 3);
        assert_eq!(document.shapes[0].uid, original);
        assert_eq!(bounds(&document, &[0]).center(), original_center);
        assert_eq!(document.shapes[2].params.kind, Some(Kind::Satin));
        let added = bounds(&document, &[1, 2]);
        assert!((added.width() / 10.0 - 40.0).abs() < 0.1);
        assert!(added.min.x > bounds(&document, &[0]).max.x);
        validate_plan(&workspace, [130.0, 180.0], &document.plan()).unwrap();
    }
}
