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


// Original built-in polygon alphabets, independent of system fonts.
fn alphabet_path(c:char)->Option<&'static str>{
 Some(match c{
 'A'=>"M0 100 L25 0 H75 L100 100 H73 L65 72 H35 L27 100 Z M43 48 H57 L50 20 Z",
 'B'=>"M0 0 H65 L90 15 V40 L75 50 L95 62 V85 L75 100 H0 Z M25 20 V40 H55 L65 35 V25 L55 20 Z M25 60 V80 H60 L70 74 V66 L60 60 Z",
 'C'=>"M25 0 H95 V25 H35 L25 35 V65 L35 75 H95 V100 H25 L0 75 V25 Z",
 'D'=>"M0 0 H60 L95 28 V72 L60 100 H0 Z M25 25 V75 H50 L70 60 V40 L50 25 Z",
 'E'=>"M0 0 H95 V24 H27 V38 H80 V62 H27 V76 H95 V100 H0 Z",
 'F'=>"M0 0 H95 V25 H27 V40 H80 V65 H27 V100 H0 Z",
 'G'=>"M25 0 H95 V25 H35 L25 35 V65 L35 75 H70 V62 H50 V40 H95 V100 H25 L0 75 V25 Z",
 'H'=>"M0 0 H27 V37 H73 V0 H100 V100 H73 V63 H27 V100 H0 Z",
 'I'=>"M10 0 H90 V23 H64 V77 H90 V100 H10 V77 H36 V23 H10 Z",
 'J'=>"M35 0 H100 V75 L75 100 H25 L0 75 V55 H27 V65 L37 75 H63 L73 65 V25 H35 Z",
 'K'=>"M0 0 H27 V38 L65 0 H100 L55 48 L100 100 H65 L27 60 V100 H0 Z",
 'L'=>"M0 0 H28 V75 H95 V100 H0 Z",
 'M'=>"M0 0 H27 L50 43 L73 0 H100 V100 H75 V45 L50 85 L25 45 V100 H0 Z",
 'N'=>"M0 0 H27 L73 58 V0 H100 V100 H73 L27 42 V100 H0 Z",
 'O'=>"M25 0 H75 L100 25 V75 L75 100 H25 L0 75 V25 Z M35 25 L25 35 V65 L35 75 H65 L75 65 V35 L65 25 Z",
 'P'=>"M0 0 H75 L100 25 V48 L75 72 H27 V100 H0 Z M27 24 V48 H64 L75 38 V34 L64 24 Z",
 'Q'=>"M25 0 H75 L100 25 V72 L85 87 L100 100 H68 L60 92 H25 L0 70 V25 Z M35 25 L25 35 V62 L35 70 H65 L75 60 V35 L65 25 Z",
 'R'=>"M0 0 H75 L100 25 V48 L75 67 L100 100 H66 L43 70 H27 V100 H0 Z M27 24 V46 H64 L75 35 L64 24 Z",
 'S'=>"M25 0 H95 V25 H35 L27 32 L35 40 H75 L100 65 V75 L75 100 H5 V75 H65 L73 68 L65 60 H25 L0 35 V25 Z",
 'T'=>"M0 0 H100 V25 H64 V100 H36 V25 H0 Z",
 'U'=>"M0 0 H27 V65 L37 75 H63 L73 65 V0 H100 V75 L75 100 H25 L0 75 Z",
 'V'=>"M0 0 H29 L50 65 L71 0 H100 L66 100 H34 Z",
 'W'=>"M0 0 H24 L34 65 L50 24 L66 65 L76 0 H100 L84 100 H60 L50 72 L40 100 H16 Z",
 'X'=>"M0 0 H32 L50 29 L68 0 H100 L67 50 L100 100 H68 L50 71 L32 100 H0 L33 50 Z",
 'Y'=>"M0 0 H32 L50 35 L68 0 H100 L64 63 V100 H36 V63 Z",
 'Z'=>"M0 0 H100 V23 L37 75 H100 V100 H0 V77 L63 25 H0 Z",
 _=>return None})
}
fn applique_alphabet(text:&str,style:&str,height:f64,color:[u8;3])->Result<Document,String>{
 if !(20.0..=100.0).contains(&height)||text.is_empty()||text.chars().count()>16||!text.chars().all(|c|c.is_ascii_alphabetic()||c==' '){return Err("Use 1–16 A–Z letters and a height of 20–100 mm.".into())}
 let scale=match style{"block"=>1.0,"collegiate"=>0.82,"wide"=>1.18,_=>return Err("Unknown alphabet".into())};
 let mut body=String::new();let mut x=0.;
 for (i,c) in text.to_ascii_uppercase().chars().enumerate(){
  if c==' '{x+=55.;continue}
  let d=alphabet_path(c).ok_or("Unsupported letter")?;
  let _=write!(body,r##"<path id="letter-{i}" transform="translate({x} 0) scale({scale} 1)" fill="#{:02x}{:02x}{:02x}" fill-rule="evenodd" d="{d}"/>"##,color[0],color[1],color[2]);
  x+=100.*scale+15.;
 }
 if body.is_empty(){return Err("Enter at least one letter".into())}
 let svg=format!(r#"<svg xmlns="http://www.w3.org/2000/svg" width="{}mm" height="{height}mm" viewBox="0 0 {x} 100">{body}</svg>"#,x*height/100.);
 let mut doc=Document::from_svg(&svg,"Appliqué lettering",None).map_err(|e|e.to_string())?;
 for shape in &mut doc.shapes{shape.params.kind=Some(Kind::Applique);}
 Ok(doc)
}
#[tauri::command]
pub(crate) async fn preview_applique_letters(text:String,style:String,height:f64,color:[u8;3])->Result<crate::Preview,String>{
 tauri::async_runtime::spawn_blocking(move||Ok(crate::preview(&applique_alphabet(&text,&style,height,color)?.plan()))).await.map_err(|e|e.to_string())?
}
#[tauri::command]
pub(crate) async fn insert_applique_letters(text:String,style:String,height:f64,color:[u8;3],app:tauri::AppHandle)->Result<crate::Preview,String>{
 use tauri::Manager;
 tauri::async_runtime::spawn_blocking(move||{
  let mut doc=applique_alphabet(&text,&style,height,color)?;
  let svg=doc.to_svg().map_err(|e|e.to_string())?;
  let state=app.state::<std::sync::Mutex<crate::Workspace>>();let mut w=state.lock().map_err(|e|e.to_string())?;
  crate::insert_editable_artwork(&mut w,&svg,"Appliqué lettering",0.,0.,false)
 }).await.map_err(|e|e.to_string())?
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
