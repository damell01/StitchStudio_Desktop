use super::{Preview, Workspace, preview, validate_resized_design};
use std::sync::Mutex;
use tauri::Manager;
use zigzag::{
    bezier,
    design::{outline_at, outline_param, satin_rails},
    document::Document,
    geom::{P, polyline_length},
    params::{Kind, Params},
    stitch::satin,
    svg::{Geometry, Shape, shapes_bounds},
};

pub(super) fn editable_index(doc: &Document, uid: usize) -> Result<usize, String> {
    let index = doc
        .shapes
        .iter()
        .position(|shape| shape.uid == uid)
        .ok_or("Object is no longer in this design.")?;
    if doc
        .layer_properties(&doc.shapes[index].id)
        .is_some_and(|layer| layer.hidden || layer.locked)
    {
        return Err("Show and unlock the object first.".into());
    }
    Ok(index)
}

fn generated(shape: &Shape) -> bool {
    !matches!(shape.params.kind, Some(Kind::Manual | Kind::Skip))
}

fn paste_settings(doc: &mut Document, source: &Params, uids: Vec<usize>) -> Result<(), String> {
    if !(1..=500).contains(&uids.len()) {
        return Err("Select between one and 500 objects.".into());
    }
    let indices = uids
        .into_iter()
        .map(|uid| editable_index(doc, uid))
        .collect::<Result<Vec<_>, _>>()?;
    if indices.iter().any(|&i| !generated(&doc.shapes[i])) {
        return Err("Select generated artwork to paste stitch settings.".into());
    }
    for i in indices {
        let shape = &mut doc.shapes[i];
        let own = &shape.params;
        let kind = source
            .kind
            .filter(|kind| {
                matches!(shape.geometry, Geometry::Fill { .. })
                    || matches!(kind, Kind::Run | Kind::Satin | Kind::Blanket)
            })
            .or(own.kind);
        shape.params = Params {
            kind,
            thread: own.thread,
            order: own.order,
            start: own.start,
            end: own.end,
            trim: own.trim,
            stop: own.stop,
            colors: own.colors.clone(),
            sett: own.sett.clone(),
            ..source.clone()
        };
    }
    Ok(())
}

pub(super) fn regenerate(
    workspace: &mut Workspace,
    mut doc: Document,
    label: &str,
) -> Result<Preview, String> {
    doc.sync().map_err(|error| error.to_string())?;
    let design = doc.plan_cached(&mut workspace.plan_cache);
    validate_resized_design(&design)?;
    let result = preview(&design);
    workspace.checkpoint_named(label);
    workspace.source = Some(doc);
    workspace.current = Some(design);
    Ok(result)
}

#[derive(Default)]
pub(super) struct StitchSettingsClipboard(Mutex<Option<Params>>);

#[tauri::command]
pub(super) fn copy_object_stitch_settings(
    uid: usize,
    state: tauri::State<'_, Mutex<Workspace>>,
    clipboard: tauri::State<'_, StitchSettingsClipboard>,
) -> Result<(), String> {
    let params = {
        let workspace = state.lock().map_err(|error| error.to_string())?;
        let doc = workspace
            .source
            .as_ref()
            .ok_or("Open editable artwork first.")?;
        let shape = &doc.shapes[editable_index(doc, uid)?];
        if !generated(shape) {
            return Err("Select generated artwork to copy stitch settings.".into());
        }
        shape.params.clone()
    };
    *clipboard.0.lock().map_err(|error| error.to_string())? = Some(params);
    Ok(())
}

#[tauri::command]
pub(super) async fn paste_object_stitch_settings(
    uids: Vec<usize>,
    app: tauri::AppHandle,
) -> Result<Preview, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let clipboard = app.state::<StitchSettingsClipboard>();
        let settings = clipboard
            .0
            .lock()
            .map_err(|error| error.to_string())?
            .clone()
            .ok_or("Copy an object's stitch settings first.")?;
        let state = app.state::<Mutex<Workspace>>();
        let mut workspace = state.lock().map_err(|error| error.to_string())?;
        let mut doc = workspace
            .source
            .clone()
            .ok_or("Open editable artwork first.")?;
        paste_settings(&mut doc, &settings, uids)?;
        regenerate(&mut workspace, doc, "Paste stitch settings")
    })
    .await
    .map_err(|error| error.to_string())?
}

#[derive(serde::Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub(super) enum ObjectStitchEdit {
    Angle { degrees: f64 },
    Entry { point: Option<[f64; 2]> },
    Exit { point: Option<[f64; 2]> },
    Reverse,
    Outlines,
    RestoreText,
}

fn edit_object(
    doc: &mut Document,
    uid: usize,
    action: ObjectStitchEdit,
) -> Result<&'static str, String> {
    let i = editable_index(doc, uid)?;
    let shape = &mut doc.shapes[i];
    match action {
        ObjectStitchEdit::Angle { degrees }
            if degrees.is_finite()
                && matches!(shape.geometry, Geometry::Fill { .. })
                && shape.params.kind.unwrap_or(Kind::Fill) == Kind::Fill =>
        {
            shape.params.angle = Some(degrees.rem_euclid(180.0));
            Ok("Change fill direction")
        }
        ObjectStitchEdit::Entry { point } | ObjectStitchEdit::Exit { point }
            if generated(shape) =>
        {
            let fraction = point
                .map(|[x, y]| {
                    if ![x, y]
                        .iter()
                        .all(|value| value.is_finite() && value.abs() <= 1200.0)
                    {
                        return Err("Invalid stitch position.");
                    }
                    outline_param(&shape.geometry, P::new(x * 10.0, y * 10.0))
                        .ok_or("This object has no usable outline.")
                })
                .transpose()?;
            let entry = matches!(action, ObjectStitchEdit::Entry { .. });
            if entry {
                shape.params.start = fraction;
            } else {
                shape.params.end = fraction;
            }
            Ok(if entry {
                "Change sewing entry"
            } else {
                "Change sewing exit"
            })
        }
        ObjectStitchEdit::Reverse if matches!(shape.geometry, Geometry::Stroke { .. }) => {
            let start = shape
                .params
                .start
                .and_then(|t| outline_at(&shape.geometry, t));
            let end = shape
                .params
                .end
                .and_then(|t| outline_at(&shape.geometry, t));
            let (changed, _) = doc
                .edit_paths_with(&[i], |path| {
                    Some(path.iter().map(bezier::reversed).collect())
                })
                .map_err(|error| error.to_string())?;
            if changed == 0 {
                return Err("This path cannot be reversed.".into());
            }
            let i = editable_index(doc, uid)?;
            let shape = &mut doc.shapes[i];
            shape.params.start = end.and_then(|point| outline_param(&shape.geometry, point));
            shape.params.end = start.and_then(|point| outline_param(&shape.geometry, point));
            Ok("Reverse stitch path")
        }
        ObjectStitchEdit::Outlines => {
            doc.expand_lettering(i).map_err(|error| error.to_string())?;
            Ok("Convert lettering to outlines")
        }
        ObjectStitchEdit::RestoreText => {
            doc.restore_lettering(i)
                .map_err(|error| error.to_string())?;
            Ok("Restore editable text")
        }
        _ => Err("This stitch control is unavailable for the selected object.".into()),
    }
}

#[tauri::command]
pub(super) async fn edit_object_stitch_controls(
    uid: usize,
    action: ObjectStitchEdit,
    app: tauri::AppHandle,
) -> Result<Preview, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<Mutex<Workspace>>();
        let mut workspace = state.lock().map_err(|error| error.to_string())?;
        let mut doc = workspace
            .source
            .clone()
            .ok_or("Open editable artwork first.")?;
        let label = edit_object(&mut doc, uid, action)?;
        regenerate(&mut workspace, doc, label)
    })
    .await
    .map_err(|error| error.to_string())?
}

type Point = [f64; 2];

#[derive(serde::Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub(super) struct Guides {
    order: Vec<(usize, Point)>,
    rails: Vec<[Vec<Point>; 2]>,
    rungs: Vec<[Point; 2]>,
    entry: Option<Point>,
    exit: Option<Point>,
    pinned_entry: bool,
    pinned_exit: bool,
    center: Option<Point>,
    angle: Option<f64>,
    text_form: Option<&'static str>,
    reverses: bool,
}

fn mm(point: P) -> Point {
    [point.x / 10.0, point.y / 10.0]
}

fn guides(
    doc: &Document,
    plan: &zigzag::design::Design,
    uid: Option<usize>,
    order: bool,
    rails: bool,
) -> Guides {
    let mut output = Guides::default();
    if order {
        let valid = plan.sew_order.iter().filter_map(|&index| {
            let shape = doc.shapes.get(index)?;
            (plan.per_shape.get(index).copied().unwrap_or(0) > 0).then_some(shape)
        });
        output.order = valid
            .enumerate()
            .take(650)
            .filter_map(|(i, shape)| {
                let bounds = shapes_bounds(std::slice::from_ref(shape));
                (!bounds.is_empty()).then(|| (i + 1, mm(bounds.center())))
            })
            .collect();
    }
    let Some(index) = uid.and_then(|id| editable_index(doc, id).ok()) else {
        return output;
    };
    let shape = &doc.shapes[index];
    output.reverses = matches!(shape.geometry, Geometry::Stroke { .. });
    output.text_form = if doc.lettering(index).is_some() {
        Some("text")
    } else if doc.records_text(index) {
        Some("outlines")
    } else {
        None
    };
    if generated(shape) {
        output.entry = outline_at(&shape.geometry, shape.params.start.unwrap_or(0.0)).map(mm);
        output.exit = outline_at(&shape.geometry, shape.params.end.unwrap_or(0.49)).map(mm);
        output.pinned_entry = shape.params.start.is_some();
        output.pinned_exit = shape.params.end.is_some();
    }
    if shape.params.kind.unwrap_or(Kind::Fill) == Kind::Fill
        && matches!(shape.geometry, Geometry::Fill { .. })
    {
        let b = shapes_bounds(std::slice::from_ref(shape));
        if !b.is_empty() {
            output.center = Some(mm(b.center()));
            output.angle = Some(shape.params.fill_angle());
        }
    }
    if rails && shape.params.kind == Some(Kind::Satin) {
        for r in satin_rails(shape).into_iter().flatten().take(32) {
            let step = ((polyline_length(&r.a) + polyline_length(&r.b)) / 100.0).max(22.0);
            output.rungs.extend(
                satin::pairs(&r, step)
                    .into_iter()
                    .map(|(a, b)| [mm(a), mm(b)]),
            );
            let outline = |points: &[P]| {
                let stride = points.len().div_ceil(500).max(1);
                let mut line = points
                    .iter()
                    .step_by(stride)
                    .copied()
                    .map(mm)
                    .collect::<Vec<_>>();
                if let Some(end) = points.last().copied().map(mm) {
                    if line.last() != Some(&end) {
                        line.push(end);
                    }
                }
                line
            };
            output.rails.push([outline(&r.a), outline(&r.b)]);
        }
    }
    output
}

#[tauri::command]
pub(super) async fn object_stitch_guides(
    uid: Option<usize>,
    order: bool,
    rails: bool,
    app: tauri::AppHandle,
) -> Result<Guides, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<Mutex<Workspace>>();
        let workspace = state.lock().map_err(|error| error.to_string())?;
        Ok(match (&workspace.source, &workspace.current) {
            (Some(doc), Some(plan)) => guides(doc, plan, uid, order, rails),
            _ => Guides::default(),
        })
    })
    .await
    .map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample() -> Document {
        Document::from_svg(r#"<svg xmlns="http://www.w3.org/2000/svg" width="60mm" height="40mm" viewBox="0 0 60 40">
            <rect id="source_fill" x="1" y="1" width="20" height="15" fill="red"/>
            <path id="target_satin" d="M30 2 L40 2 L48 5" stroke-width="3" stroke="blue" fill="none"/>
            </svg>"#, "Guide fixture", None).unwrap()
    }

    #[test]
    fn copies_spacing_without_overwriting_target_sewing_or_incompatible_type() {
        let mut doc = sample();
        let target = doc.shapes[1].uid;
        let params = &mut doc.shapes[1].params;
        params.start = Some(0.3);
        params.order = Some(4);
        params.stop = Some(true);
        params.thread = Some([10, 20, 30]);
        let clip = Params {
            kind: Some(Kind::Fill),
            spacing: Some(0.4),
            ..Default::default()
        };
        paste_settings(&mut doc, &clip, vec![target]).unwrap();
        let params = &doc.shapes[1].params;
        assert_eq!(params.kind, Some(Kind::Satin));
        assert_eq!(params.spacing, Some(0.4));
        assert_eq!(params.start, Some(0.3));
        assert_eq!(params.order, Some(4));
        assert_eq!(params.stop, Some(true));
        assert_eq!(params.thread, Some([10, 20, 30]));
    }

    #[test]
    fn places_sewing_points_and_renders_guides_from_the_current_plan() {
        let mut doc = sample();
        let fill = doc.shapes[0].uid;
        let satin = doc.shapes[1].uid;
        let start = outline_at(&doc.shapes[0].geometry, 0.35).unwrap();
        edit_object(
            &mut doc,
            fill,
            ObjectStitchEdit::Entry {
                point: Some(mm(start)),
            },
        )
        .unwrap();
        edit_object(&mut doc, fill, ObjectStitchEdit::Angle { degrees: 215.0 }).unwrap();
        let design = doc.plan();
        let fill_guides = guides(&doc, &design, Some(fill), true, true);
        assert_eq!(fill_guides.angle, Some(35.0));
        assert!(fill_guides.pinned_entry);
        assert_eq!(fill_guides.order.len(), 2);
        assert!((fill_guides.entry.unwrap()[0] - mm(start)[0]).abs() < 0.02);
        let satin_guides = guides(&doc, &design, Some(satin), false, true);
        assert!(!satin_guides.rails.is_empty());
        assert!(!satin_guides.rungs.is_empty());
        let was = outline_at(&doc.shapes[1].geometry, 0.0).unwrap();
        edit_object(&mut doc, satin, ObjectStitchEdit::Reverse).unwrap();
        let now = outline_at(
            &doc.shapes
                .iter()
                .find(|shape| shape.uid == satin)
                .unwrap()
                .geometry,
            0.0,
        )
        .unwrap();
        assert!(was.dist(now) > 50.0);
    }
}
