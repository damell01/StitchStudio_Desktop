use super::{Preview, Workspace, assistant_motif::validate_plan, editable_base, preview};
use std::sync::Mutex;
use tauri::Manager;
use zigzag::{
    bezier, document::Document, geom::P, params::Kind, stitch::satin::rails_from_subpaths,
};

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) enum Drawing {
    Pen,
    Manual,
    SatinBrush,
    SatinColumn,
    Rectangle,
    Ellipse,
}

fn drawing_points(points: Vec<[f64; 2]>, field: [f64; 2]) -> Result<Vec<P>, String> {
    if !field.iter().all(|v| (10.0..=1200.0).contains(v))
        || !(2..=2048).contains(&points.len())
        || points.iter().any(|[x, y]| {
            !x.is_finite() || !y.is_finite() || x.abs() > field[0] / 2.0 || y.abs() > field[1] / 2.0
        })
    {
        return Err("Draw at least two points inside the hoop.".into());
    }
    Ok(points
        .into_iter()
        .map(|[x, y]| P::new(x * 10.0, y * 10.0))
        .collect())
}

fn add(
    document: &mut Document,
    tool: Drawing,
    points: Vec<[f64; 2]>,
    field: [f64; 2],
) -> Result<usize, String> {
    let pts = drawing_points(points, field)?;
    let color = [105, 69, 162];
    match tool {
        Drawing::SatinColumn => return Err("Draw two rails for the satin column.".into()),
        Drawing::Pen => document.add_drawing(&pts, false, color, Kind::Run),
        Drawing::Manual => document.add_drawing(&pts, false, color, Kind::Manual),
        Drawing::SatinBrush => {
            let path = vec![bezier::SubPath {
                anchors: pts.iter().map(|&p| bezier::Anchor::corner(p)).collect(),
                closed: false,
            }];
            document.add_drawing_stroke(&path, color, Kind::Satin, 2.5)
        }
        Drawing::Rectangle | Drawing::Ellipse => {
            let a = pts[0];
            let b = pts[1];
            let (left, top, right, bottom) =
                (a.x.min(b.x), a.y.min(b.y), a.x.max(b.x), a.y.max(b.y));
            if (right - left).min(bottom - top) < 10.0 {
                return Err("Draw a shape at least 1 mm wide and tall.".into());
            }
            let path = if matches!(tool, Drawing::Rectangle) {
                format!("M {left} {top} H {right} V {bottom} H {left} Z")
            } else {
                let (rx, ry, cy) = (
                    (right - left) / 2.0,
                    (bottom - top) / 2.0,
                    (top + bottom) / 2.0,
                );
                format!(
                    "M {left} {cy} A {rx} {ry} 0 1 1 {right} {cy} A {rx} {ry} 0 1 1 {left} {cy} Z"
                )
            };
            document.add_drawing_path(&bezier::from_svg_d(&path), color, Kind::Fill)
        }
    }
    .map_err(|error| error.to_string())
}

fn add_column(
    doc: &mut Document,
    subpaths: Vec<Vec<[f64; 2]>>,
    field: [f64; 2],
) -> Result<usize, String> {
    if !(2..=10).contains(&subpaths.len()) {
        return Err("Draw two rails and up to eight connecting rungs.".into());
    }
    let lines = subpaths
        .into_iter()
        .map(|line| drawing_points(line, field).map(|points| (points, false)))
        .collect::<Result<Vec<_>, _>>()?;
    let rails = rails_from_subpaths(&lines).ok_or("Draw two nearby rails of similar length.")?;
    if rails.sync.len() != lines.len() - 2 {
        return Err("Each rung must cross both rails, in sewing order.".into());
    }
    let path = lines
        .into_iter()
        .map(|(points, closed)| bezier::SubPath {
            anchors: points.into_iter().map(bezier::Anchor::corner).collect(),
            closed,
        })
        .collect();
    doc.add_drawing_path(&path, [105, 69, 162], Kind::Satin)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub(super) async fn draw_canvas_shape(
    tool: Drawing,
    points: Vec<[f64; 2]>,
    field: [f64; 2],
    subpaths: Option<Vec<Vec<[f64; 2]>>>,
    app: tauri::AppHandle,
) -> Result<Preview, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<Mutex<Workspace>>();
        let mut workspace = state.lock().map_err(|error| error.to_string())?;
        let mut document = editable_base(&workspace, "Canvas drawing")?;
        let index = if matches!(tool, Drawing::SatinColumn) {
            add_column(&mut document, subpaths.unwrap_or_default(), field)?
        } else {
            add(&mut document, tool, points, field)?
        };
        let design = document.plan_cached(&mut workspace.plan_cache);
        if design.per_shape.get(index).copied().unwrap_or_default() == 0 {
            return Err("This drawing was too small to generate stitches.".into());
        }
        validate_plan(&workspace, field, &design)?;
        let result = preview(&design);
        if workspace.current.is_none() {
            workspace.current = Some(Document::empty().plan());
        }
        workspace.checkpoint_named("Draw on canvas");
        workspace.source = Some(document);
        workspace.current = Some(design);
        Ok(result)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn draws_explicit_satin_rails_with_a_connecting_rung() {
        let mut doc = Document::empty();
        let paths = vec![
            vec![[0., 0.], [20., 0.]],
            vec![[0., 4.], [20., 4.]],
            vec![[9., -1.], [9., 5.]],
        ];
        let index = add_column(&mut doc, paths, [130., 180.]).unwrap();
        let rails = zigzag::design::satin_rails(&doc.shapes[index])
            .remove(0)
            .unwrap();
        assert_eq!(rails.sync.len(), 1);
        assert!(doc.plan().per_shape[index] > 0);
    }

    #[test]
    fn draws_paths_shapes_and_manual_needle_points() {
        for (tool, kind) in [
            (Drawing::Pen, Kind::Run),
            (Drawing::Manual, Kind::Manual),
            (Drawing::SatinBrush, Kind::Satin),
            (Drawing::Rectangle, Kind::Fill),
            (Drawing::Ellipse, Kind::Fill),
        ] {
            let mut document = Document::empty();
            let index = add(
                &mut document,
                tool,
                vec![[0.0, 0.0], [12.0, 8.0], [22.0, 5.0]],
                [130.0, 180.0],
            )
            .unwrap();
            assert_eq!(document.shapes[index].params.kind, Some(kind));
            assert!(document.plan().per_shape[index] > 0);
        }
    }
}
