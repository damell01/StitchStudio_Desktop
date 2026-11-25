use std::fmt::Write as _;
use zigzag::document::Document;
use zigzag::params::Kind;
use zigzag::svg::{Geometry, shapes_bounds};

fn outline(shape: &str) -> Result<&'static str, String> {
    match shape {
        "circle" => Ok("M50 5 A45 45 0 0 1 50 95 A45 45 0 0 1 50 5 Z"),
        "shield" => Ok("M10 10 H90 V48 Q90 75 50 95 Q10 75 10 48 Z"),
        "heart" => Ok("M50 90 C-20 45 10 -10 50 25 C90 -10 120 45 50 90 Z"),
        "rounded" => Ok("M15 5 H85 Q95 5 95 15 V85 Q95 95 85 95 H15 Q5 95 5 85 V15 Q5 5 15 5 Z"),
        _ => Err("Unknown shape".into()),
    }
}

fn square_svg(size_mm: f64, art: &str) -> String {
    format!(r#"<svg xmlns="http://www.w3.org/2000/svg" width="{size_mm}mm" height="{size_mm}mm" viewBox="0 0 100 100">{art}</svg>"#)
}

pub(crate) fn build_document(shape: &str, style: &str, width_mm: f64) -> Result<Document, String> {
    if !(20.0..=200.0).contains(&width_mm) {
        return Err("Choose a width between 20 and 200 mm".into());
    }
    let path = outline(shape)?;
    let body = format!(r##"<path id="body" d="{path}" fill="#73977b"/>"##);
    let nominal = zigzag::svg::load(square_svg(100.0, &body).as_bytes())
        .map_err(|error| error.to_string())?;
    // Presets can leave margins inside the viewBox. Size the actual outline.
    let viewport_mm = width_mm * 1000.0 / shapes_bounds(&nominal).width();
    let (artwork, kind) = match style {
        "applique" => (body, Kind::Applique),
        "patch" => (
            format!(r##"{body}<path id="border" d="{path}" fill="none" stroke="#234536" stroke-width="4"/>"##),
            Kind::Fill,
        ),
        _ => return Err("Unknown workflow".into()),
    };
    let mut document = Document::from_svg(&square_svg(viewport_mm, &artwork), style, None)
        .map_err(|error| error.to_string())?;
    for shape in &mut document.shapes {
        shape.params.kind = Some(if shape.id == "border" { Kind::Satin } else { kind });
    }
    Ok(document)
}

fn applique_cut_svg(shape: &str, width_mm: f64) -> Result<String, String> {
    let document = build_document(shape, "applique", width_mm)?;
    let bounds = shapes_bounds(&document.shapes);
    let width = bounds.width() / 10.0;
    let height = bounds.height() / 10.0;
    let mut path = String::new();
    for shape in &document.shapes {
        let Geometry::Fill { rings, .. } = &shape.geometry else { continue };
        for ring in rings.iter().filter(|ring| ring.len() >= 3) {
            for (index, point) in ring.iter().enumerate() {
                let command = if index == 0 { 'M' } else { 'L' };
                let x = (point.x - bounds.min.x) / 10.0;
                let y = (point.y - bounds.min.y) / 10.0;
                let _ = write!(path, "{command}{x:.6} {y:.6}");
            }
            path.push('Z');
        }
    }
    if path.is_empty() {
        return Err("This design has no closed cutting outline".into());
    }
    Ok(format!(
        r#"<svg xmlns="http://www.w3.org/2000/svg" width="{width:.6}mm" height="{height:.6}mm" viewBox="0 0 {width:.6} {height:.6}"><path d="{path}" fill="none" stroke="black" stroke-width="0.1"/></svg>"#
    ))
}

#[tauri::command]
pub(crate) async fn export_applique_cut_svg(shape: String, width: f64) -> Result<bool, String> {
    let svg = applique_cut_svg(&shape, width)?;
    let Some(destination) = rfd::AsyncFileDialog::new()
        .add_filter("SVG cutting outline", &["svg"])
        .set_file_name(format!("applique-{shape}-cut.svg"))
        .save_file()
        .await
    else {
        return Ok(false);
    };
    let mut path = destination.path().to_owned();
    match path.extension().and_then(|extension| extension.to_str()) {
        None => { path.set_extension("svg"); }
        Some(extension) if extension.eq_ignore_ascii_case("svg") => {}
        Some(_) => return Err("Use a .svg filename for the cutting outline".into()),
    }
    tauri::async_runtime::spawn_blocking(move || std::fs::write(path, svg))
        .await
        .map_err(|error| error.to_string())?
        .map_err(|error| error.to_string())?;
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cut_outline_matches_placement_geometry_and_requested_width() {
        for shape in ["circle", "shield", "heart", "rounded"] {
            let document = build_document(shape, "applique", 65.0).unwrap();
            let bounds = shapes_bounds(&document.shapes);
            let svg = applique_cut_svg(shape, 65.0).unwrap();
            let cut = zigzag::svg::load(svg.as_bytes()).unwrap();
            let cut_bounds = shapes_bounds(&cut);
            assert!((bounds.width() - 650.0).abs() < 0.5, "{shape}");
            assert!((bounds.width() - cut_bounds.width()).abs() < 0.01, "{shape}");
            assert!((bounds.height() - cut_bounds.height()).abs() < 0.01, "{shape}");
            assert_eq!(document.plan().blocks.len(), 3, "{shape}");
        }
    }

    #[test]
    fn invalid_cut_requests_return_errors() {
        assert!(applique_cut_svg("unknown", 65.0).is_err());
        assert!(applique_cut_svg("heart", f64::NAN).is_err());
        assert!(applique_cut_svg("circle", 0.0).is_err());
    }
}
