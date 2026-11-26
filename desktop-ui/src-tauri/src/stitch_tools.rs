use crate::{Preview, Workspace, formats, preview, validate_export, validate_resized_design};
use std::sync::Mutex;
use tauri::Manager;
use zigzag::{
    boolean::PathOp,
    checks::{self, Level},
    design::Design,
    document::{Document, SwatchSetting, swatch_values},
    geom::P,
    params::Kind,
    svg::{self, Geometry},
};

#[derive(serde::Serialize)]
pub(super) struct DesignIssue {
    uid: Option<usize>,
    label: Option<String>,
    severity: &'static str,
    message: String,
}

#[tauri::command]
pub(super) async fn design_issues(
    width: f64,
    height: f64,
    app: tauri::AppHandle,
) -> Result<Vec<DesignIssue>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<Mutex<Workspace>>();
        let (source, plan) = {
            let workspace = state.lock().map_err(|e| e.to_string())?;
            (
                workspace.source.clone(),
                workspace.current.clone().ok_or("Open a design first.")?,
            )
        };
        let mut issues = Vec::new();
        if width.is_finite() && height.is_finite() && width > 0. && height > 0. {
            let bounds = plan.bounds();
            if !bounds.is_empty()
                && (bounds.min.x < -width * 5.
                    || bounds.max.x > width * 5.
                    || bounds.min.y < -height * 5.
                    || bounds.max.y > height * 5.)
            {
                issues.push(DesignIssue {
                    uid: None,
                    label: None,
                    severity: "error",
                    message: "Stitches extend beyond the usable hoop field.".into(),
                });
            }
        }
        let audit = crate::measure_stitches(&plan);
        if audit.long > 0 {
            issues.push(DesignIssue {
                uid: None,
                label: None,
                severity: "warning",
                message: format!(
                    "{} stitch segments exceed 12 mm. Inspect them before sewing.",
                    audit.long
                ),
            });
        }
        if let Some(document) = source {
            let mut found = checks::check(&document.shapes, &plan, &document.plan_options(), None);
            found.sort_by_key(|issue| std::cmp::Reverse(issue.level));
            issues.extend(found.into_iter().take(120).map(|issue| {
                let shape = issue.shape.and_then(|index| document.shapes.get(index));
                DesignIssue {
                    uid: shape.map(|shape| shape.uid),
                    label: shape.map(|shape| shape.label.clone()),
                    severity: match issue.level {
                        Level::Error => "error",
                        Level::Warning => "warning",
                        Level::Info => "info",
                    },
                    message: issue.message,
                }
            }));
        }
        Ok(issues)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[derive(serde::Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub(super) enum PathEdit {
    Unite,
    MinusFront,
    Intersect,
    Exclude,
    OutlineStroke,
    Offset { millimeters: f64 },
    RoundCorners { millimeters: f64 },
    SimplifyOutline { millimeters: f64 },
}

fn eligible_selection(doc: &Document, uids: &[usize]) -> Result<Vec<usize>, String> {
    if uids.is_empty() || uids.len() > 32 {
        return Err("Select between one and 32 editable objects.".into());
    }
    let mut indices = Vec::new();
    let mut points = 0;
    for (index, shape) in doc.shapes.iter().enumerate() {
        if !uids.contains(&shape.uid) {
            continue;
        }
        if doc.records_text(index)
            || doc
                .layer_properties(&shape.id)
                .is_some_and(|layer| layer.locked || layer.hidden)
            || matches!(
                shape.params.kind,
                Some(Kind::Manual | Kind::Skip | Kind::Applique)
            )
            || shape.params.stop == Some(true)
            || shape.params.trim == Some(true)
        {
            return Err(
                "Select visible, unlocked artwork without lettering or fixed machine commands."
                    .into(),
            );
        }
        indices.push(index);
        points += match &shape.geometry {
            Geometry::Fill { rings, .. } => rings.iter().map(Vec::len).sum::<usize>(),
            Geometry::Stroke { lines, .. } => lines.iter().map(|(line, _)| line.len()).sum(),
        };
    }
    if indices.len() != uids.len() || points > 40_000 {
        return Err("The selection changed or is too complex. Try fewer objects.".into());
    }
    Ok(indices)
}

fn edit_paths(
    document: &mut Document,
    uids: &[usize],
    operation: PathEdit,
) -> Result<&'static str, String> {
    let indices = eligible_selection(document, uids)?;
    let (label, op) = match operation {
        PathEdit::Unite => ("Unite artwork", PathOp::Unite),
        PathEdit::MinusFront => ("Subtract front artwork", PathOp::MinusFront),
        PathEdit::Intersect => ("Intersect artwork", PathOp::Intersect),
        PathEdit::Exclude => ("Exclude artwork overlap", PathOp::Exclude),
        PathEdit::OutlineStroke => {
            document
                .outline_stroke(&indices)
                .map_err(|e| e.to_string())?;
            return Ok("Outline stroke");
        }
        PathEdit::Offset { millimeters } => {
            if !millimeters.is_finite() || millimeters.abs() < 0.1 || millimeters.abs() > 20. {
                return Err(
                    "Enter a nonzero offset between 0.1 and 20 mm in either direction.".into(),
                );
            }
            document
                .offset_path(&indices, millimeters * 10.)
                .map_err(|e| e.to_string())?;
            return Ok("Offset path");
        }
        PathEdit::RoundCorners { millimeters } => {
            if !(0.1..=15.).contains(&millimeters) {
                return Err("Enter a corner radius between 0.1 and 15 mm.".into());
            }
            let count = document
                .round_corners(
                    &indices,
                    millimeters * 10.,
                    zigzag::bezier::CornerKind::Round,
                    &[],
                )
                .map_err(|e| e.to_string())?;
            if count == 0 {
                return Err("No sharp corners were found on the selected paths.".into());
            }
            return Ok("Round corners");
        }
        PathEdit::SimplifyOutline { millimeters } => {
            if !(0.02..=0.5).contains(&millimeters) {
                return Err("Enter an outline tolerance between 0.02 and 0.5 mm.".into());
            }
            let count = document
                .simplify_paths(&indices, millimeters * 10.)
                .map_err(|e| e.to_string())?;
            if count == 0 {
                return Err("No points can be removed at this tolerance.".into());
            }
            return Ok("Simplify outline");
        }
    };
    document
        .pathfinder(&indices, op)
        .map_err(|e| e.to_string())?;
    Ok(label)
}

#[tauri::command]
pub(super) async fn apply_path_tool(
    uids: Vec<usize>,
    operation: PathEdit,
    app: tauri::AppHandle,
) -> Result<Preview, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<Mutex<Workspace>>();
        let mut workspace = state.lock().map_err(|e| e.to_string())?;
        let mut document = workspace
            .source
            .clone()
            .ok_or("Open editable artwork first.")?;
        let label = edit_paths(&mut document, &uids, operation)?;
        let plan = document.plan_cached(&mut workspace.plan_cache);
        validate_resized_design(&plan)?;
        let result = preview(&plan);
        workspace.checkpoint_named(label);
        workspace.source = Some(document);
        workspace.current = Some(plan);
        Ok(result)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[derive(serde::Deserialize)]
pub(super) struct SwatchRequest {
    uid: usize,
    setting: SwatchSetting,
    from: f64,
    to: f64,
    steps: usize,
    columns: usize,
}

fn make_swatch_plan(
    mut source: Document,
    request: &SwatchRequest,
) -> Result<(Design, Vec<f64>), String> {
    let index = eligible_selection(&source, &[request.uid])?[0];
    let kind = source.shapes[index].params.kind.unwrap_or(Kind::Fill);
    let (min, max) = request.setting.limits();
    if !request.setting.applies(kind) {
        return Err("This stitch type does not use that setting.".into());
    }
    if !(min..=max).contains(&request.from)
        || !(min..=max).contains(&request.to)
        || request.from >= request.to
        || !(2..=6).contains(&request.steps)
        || !(1..=request.steps).contains(&request.columns)
    {
        return Err(format!(
            "Enter an increasing range from {min} to {max}, and 2–6 swatches."
        ));
    }
    let bounds = svg::shapes_bounds(&source.shapes[index..=index]);
    if bounds.is_empty() || bounds.width().max(bounds.height()) > 2_000. {
        return Err("Select a representative object up to 200 mm across.".into());
    }
    let fragments = source.copy(&[index]).map_err(|e| e.to_string())?;
    let mut sheet = Document::empty();
    sheet.name = "Test swatches".into();
    sheet.settings.fabric = source.settings.fabric.clone();
    sheet.settings.hat_order = false;
    let seed = sheet
        .paste(&fragments, P::default())
        .map_err(|e| e.to_string())?;
    let values = swatch_values(request.from, request.to, request.steps);
    if values.windows(2).any(|pair| pair[0] == pair[1]) {
        return Err("Choose a wider range so each swatch uses a different value.".into());
    }
    let labels: Vec<_> = values
        .iter()
        .map(|value| zigzag::params::fmt_num(*value))
        .collect();
    sheet
        .add_test_swatches(&seed, request.setting, &values, &labels, request.columns)
        .map_err(|e| e.to_string())?;
    sheet.delete_many(&seed).map_err(|e| e.to_string())?;
    let mut plan = sheet.plan();
    validate_resized_design(&plan)?;
    let center = plan.bounds().center();
    for point in plan
        .blocks
        .iter_mut()
        .flat_map(|b| &mut b.runs)
        .flat_map(|r| &mut r.pts)
    {
        *point = *point - center;
    }
    Ok((plan, values))
}

fn snapshot(app: &tauri::AppHandle) -> Result<Document, String> {
    app.state::<Mutex<Workspace>>()
        .lock()
        .map_err(|e| e.to_string())?
        .source
        .clone()
        .ok_or("Open editable artwork to make test swatches.".into())
}

#[derive(serde::Serialize)]
pub(super) struct SwatchPreview {
    revision: String,
    plan: Preview,
    values: Vec<f64>,
    width: f64,
    height: f64,
}

#[tauri::command]
pub(super) async fn preview_test_swatches(
    request: SwatchRequest,
    app: tauri::AppHandle,
) -> Result<SwatchPreview, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let document = snapshot(&app)?;
        let revision = document.rev().to_string();
        let (plan, values) = make_swatch_plan(document, &request)?;
        let bounds = plan.bounds();
        Ok(SwatchPreview {
            revision,
            plan: preview(&plan),
            values,
            width: bounds.width() / 10.,
            height: bounds.height() / 10.,
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub(super) async fn export_test_swatches(
    request: SwatchRequest,
    revision: String,
    width: f64,
    height: f64,
    format: String,
    app: tauri::AppHandle,
) -> Result<bool, String> {
    let extension = format.clone();
    let bytes = tauri::async_runtime::spawn_blocking(move || {
        let document = snapshot(&app)?;
        if document.rev().to_string() != revision {
            return Err("The design changed. Preview the test swatches again.".into());
        }
        let (plan, _) = make_swatch_plan(document, &request)?;
        validate_export(&plan, &extension, width, height)?;
        formats::write_format(&plan, &extension).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())??;
    let Some(file) = rfd::AsyncFileDialog::new()
        .add_filter("Embroidery", &[format.as_str()])
        .set_file_name(format!("Test swatches.{format}"))
        .save_file()
        .await
    else {
        return Ok(false);
    };
    let mut path = file.path().to_owned();
    match path.extension().and_then(|extension| extension.to_str()) {
        None => {
            path.set_extension(&format);
        }
        Some(extension) if extension.eq_ignore_ascii_case(&format) => {}
        _ => return Err(format!("Use a .{format} filename.")),
    }
    std::fs::write(path, bytes).map_err(|e| e.to_string())?;
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn artwork() -> Document {
        Document::from_svg(
            r#"<svg xmlns="http://www.w3.org/2000/svg" width="40mm" height="30mm" viewBox="0 0 40 30"><rect id="base" fill="navy" x="3" y="3" width="12" height="9"/><rect id="front" fill="navy" x="9" y="5" width="12" height="9"/></svg>"#,
            "Sample", None,
        ).unwrap()
    }

    #[test]
    fn swatch_sheet_is_centered_and_exports_independently() {
        let source = artwork();
        let before = source.to_svg().unwrap();
        let request = SwatchRequest {
            uid: source.shapes[0].uid,
            setting: SwatchSetting::Spacing,
            from: 0.32,
            to: 0.48,
            steps: 3,
            columns: 2,
        };
        let (sheet, values) = make_swatch_plan(source.clone(), &request).unwrap();
        assert_eq!(values, [0.32, 0.40, 0.48]);
        assert!(sheet.bounds().center().len() < 0.01);
        assert!(sheet.stitch_count() > 0);
        assert_eq!(source.to_svg().unwrap(), before);
        let bytes = formats::write_format(&sheet, "dst").unwrap();
        assert!(formats::read::read_stitch_file(&bytes, "dst").is_ok());
    }

    #[test]
    fn pathfinder_uses_shared_geometry_and_rejects_ineligible_objects() {
        let mut document = artwork();
        let uids: Vec<_> = document.shapes.iter().map(|shape| shape.uid).collect();
        document.shapes[1].params.stop = Some(true);
        assert!(edit_paths(&mut document, &uids, PathEdit::Unite).is_err());
        assert_eq!(document.shapes.len(), 2);
        document.shapes[1].params.stop = None;
        edit_paths(&mut document, &uids, PathEdit::Unite).unwrap();
        assert_eq!(document.shapes.len(), 1);
        assert!(document.plan().stitch_count() > 0);
    }
}
