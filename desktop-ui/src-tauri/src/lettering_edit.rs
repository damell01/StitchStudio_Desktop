use crate::{Preview, Workspace, editable_base, preview};
use zigzag::document::{Align, Document, TextSpec};

#[derive(serde::Deserialize,serde::Serialize)]
pub(crate) struct LetteringSettings {
    pub text: String,
    pub font: String,
    pub size: f64,
    pub spacing: f64,
    pub arc: f64,
    pub bold: bool,
    pub italic: bool,
    pub color: [u8; 3],
    pub align: String,
    #[serde(default)] pub kind: Option<String>,
    #[serde(default)] pub leading: Option<f64>,
    #[serde(default)] pub h_scale: Option<f64>,
    #[serde(default)] pub v_scale: Option<f64>,
    #[serde(default)] pub kern: Option<Vec<(usize,f64)>>,
    #[serde(default)] pub path: Option<String>,
    #[serde(default)] pub path_offset: Option<f64>,
    #[serde(default)] pub path_flip: Option<bool>,
    #[serde(default)] pub effect_color: Option<[u8;3]>,
    #[serde(default)] pub inner_color: Option<[u8;3]>,
    #[serde(default)] pub outer_width: Option<f64>,
    #[serde(default)] pub inner_width: Option<f64>,
    #[serde(default)] pub shadow_x: Option<f64>,
    #[serde(default)] pub shadow_y: Option<f64>,
}

impl LetteringSettings {
    pub fn spec(self) -> Result<TextSpec, String> {
        if self.text.trim().is_empty() || self.text.chars().count() > 120
            || self.text.chars().any(|c| c.is_control() && !matches!(c, '\n' | '\r' | '\t')) {
            return Err("Enter up to 120 characters of lettering.".into());
        }
        if !(0.5..=80.0).contains(&self.size) || !(0.0..=5.0).contains(&self.spacing)
            || !(-300.0..=300.0).contains(&self.arc) {
            return Err("Check the capital height, letter spacing and arc radius.".into());
        }
        if !zigzag::document::font_families().contains(&self.font) {
            return Err("Choose an installed font.".into());
        }
        let align = Align::parse(&self.align).ok_or("Choose a lettering alignment.")?;
        let h_scale=self.h_scale.unwrap_or(100.0);let v_scale=self.v_scale.unwrap_or(100.0);
        let kern=self.kern.unwrap_or_default();
        if !(25.0..=250.0).contains(&h_scale)||!(25.0..=250.0).contains(&v_scale)||kern.len()>120||kern.iter().any(|(i,v)|*i>=self.text.chars().count()||!(-10.0..=10.0).contains(v)){return Err("Check lettering scale and character spacing.".into())}
        let path = match self.path.as_deref().map(str::trim) {
            Some(d) if !d.is_empty() => {
                if d.len()>4096 || !d.starts_with(['M','m']) {return Err("Enter a valid SVG baseline beginning with M.".into())}
                let parsed=zigzag::bezier::from_svg_d(d);
                if parsed.is_empty(){return Err("The baseline has no path.".into())}
                Some(zigzag::bezier::transform(&parsed,[10.0,0.0,0.0,10.0,0.0,0.0]))
            },
            _ => None,
        };
        let path_offset=self.path_offset.unwrap_or(0.0);
        if !(0.0..=1.0).contains(&path_offset){return Err("Baseline start must be between 0 and 100 percent.".into())}
        let kind = match self.kind.as_deref() {
            None => zigzag::params::Kind::Satin,
            Some("puff" | "double_outline" | "shadow" | "gradient") => zigzag::params::Kind::Satin,
            Some("bean") => zigzag::params::Kind::Run,
            Some(k) => zigzag::params::Kind::parse(k).filter(|k| matches!(k, zigzag::params::Kind::Satin | zigzag::params::Kind::Fill | zigzag::params::Kind::Applique | zigzag::params::Kind::Run | zigzag::params::Kind::Ripple | zigzag::params::Kind::Contour | zigzag::params::Kind::Cross | zigzag::params::Kind::Meander | zigzag::params::Kind::Blanket)).ok_or("Unsupported lettering effect")?,
        };
        let outer_width=self.outer_width.unwrap_or(2.4);
        let inner_width=self.inner_width.unwrap_or(1.0);
        let shadow_x=self.shadow_x.unwrap_or(1.5);
        let shadow_y=self.shadow_y.unwrap_or(1.5);
        if !(0.5..=6.0).contains(&outer_width) || !(0.3..=4.0).contains(&inner_width)
            || !(-10.0..=10.0).contains(&shadow_x) || !(-10.0..=10.0).contains(&shadow_y)
            || (self.kind.as_deref()==Some("double_outline") && inner_width>=outer_width) {
            return Err("Check outline widths (inner must be smaller) and shadow offsets.".into());
        }
        let effect=match self.kind.as_deref() {
            Some("double_outline")=>Some("outline".to_string()),
            Some("shadow")=>Some("shadow".to_string()),
            Some("gradient")=>Some("gradient".to_string()),
            _=>None,
        };
        let leading = self.leading.unwrap_or(1.5);
        if !(0.5..=5.0).contains(&leading) { return Err("Line spacing must be between 0.5 and 5 cap heights.".into()); }
        Ok(TextSpec {
            kind, leading, puff: self.kind.as_deref() == Some("puff"), bean: self.kind.as_deref() == Some("bean"),
            effect, effect_color:self.effect_color.unwrap_or([28,35,55]),
            inner_color:self.inner_color.unwrap_or([245,245,245]),
            outer_width,inner_width,shadow_x,shadow_y,
            text: self.text, font: self.font, size_mm: self.size, spacing_mm: self.spacing,
            arc_mm: self.arc, bold: self.bold, italic: self.italic, color: self.color, align,
            h_scale,v_scale,kern,path,path_offset,path_flip:self.path_flip.unwrap_or(false),..Default::default()
        })
    }
}

fn plan_text(document: &mut Document, spec: &TextSpec, center: [f64; 2], cache: &mut zigzag::design::PlanCache) -> Result<zigzag::design::Design, String> {
    if center.iter().any(|v| !v.is_finite() || v.abs() > 500.0) {
        return Err("Place lettering within 500 mm of the hoop center.".into());
    }
    let index = document.add_lettering(spec, (center[0], center[1])).map_err(|e| e.to_string())?;
    document.sync().map_err(|e| e.to_string())?;
    let design = document.plan_cached(cache);
    if design.per_shape.get(index).copied().unwrap_or(0) == 0 {
        return Err("These letters produced no stitches. Try a larger size or a different font.".into());
    }
    Ok(design)
}

pub(super) fn apply(workspace: &mut Workspace, spec: &TextSpec, placement: Option<[f64; 2]>) -> Result<Preview, String> {
    let name = spec.text.lines().find(|line| !line.trim().is_empty()).unwrap_or("Lettering").trim();
    let mut document = if placement.is_some() {
        editable_base(workspace, name)?
    } else {
        let mut document = Document::empty();
        document.name = name.to_owned();
        document
    };
    let design = plan_text(&mut document, spec, placement.unwrap_or([0.0, 0.0]), &mut workspace.plan_cache)?;
    super::validate_resized_design(&design)?;
    let result = preview(&design);
    if workspace.current.is_none(){workspace.current=Some(Document::empty().plan());}
    workspace.checkpoint_named("Insert lettering");
    workspace.current = Some(design);
    workspace.source = Some(document);
    Ok(result)
}

#[tauri::command]
pub(crate) async fn preview_lettering(settings: LetteringSettings) -> Result<Preview, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let spec = settings.spec()?;
        let design = plan_text(&mut Document::empty(), &spec, [0.0, 0.0], &mut zigzag::design::PlanCache::default())?;
        Ok(preview(&design))
    }).await.map_err(|error| error.to_string())?
}

#[tauri::command]
pub(crate) fn lettering_settings(uid:usize,state:tauri::State<'_,std::sync::Mutex<Workspace>>) -> Result<Option<LetteringSettings>,String>{
 let w=state.lock().map_err(|e|e.to_string())?;
 let Some(doc)=w.source.as_ref() else{return Ok(None)};
 let Some(index)=doc.shapes.iter().position(|s|s.uid==uid) else{return Ok(None)};
 Ok(doc.lettering(index).map(|s|LetteringSettings{text:s.text,font:s.font,size:s.size_mm,spacing:s.spacing_mm,arc:s.arc_mm,bold:s.bold,italic:s.italic,color:s.color,align:s.align.name().into(),kind:Some(if s.effect.as_deref() == Some("outline") {"double_outline".into()} else if s.effect.as_deref() == Some("shadow") {"shadow".into()} else if s.effect.as_deref() == Some("gradient") {"gradient".into()} else if s.puff && s.kind == zigzag::params::Kind::Satin {"puff".into()} else if s.bean && s.kind == zigzag::params::Kind::Run {"bean".into()} else {s.kind.name().into()}),leading:Some(s.leading),h_scale:Some(s.h_scale),v_scale:Some(s.v_scale),kern:Some(s.kern),path:Some(s.path.as_ref().map(|p|zigzag::bezier::to_svg_d(&zigzag::bezier::transform(p,[0.1,0.0,0.0,0.1,0.0,0.0]))).unwrap_or_default()),path_offset:Some(s.path_offset),path_flip:Some(s.path_flip),effect_color:Some(s.effect_color),inner_color:Some(s.inner_color),outer_width:Some(s.outer_width),inner_width:Some(s.inner_width),shadow_x:Some(s.shadow_x),shadow_y:Some(s.shadow_y)}))
}
#[tauri::command]
pub(crate) async fn update_lettering(uid:usize,settings:LetteringSettings,app:tauri::AppHandle)->Result<Preview,String>{
 use tauri::Manager;
 tauri::async_runtime::spawn_blocking(move||{
 let effect_color_present=settings.effect_color.is_some();let inner_color_present=settings.inner_color.is_some();
 let outer_present=settings.outer_width.is_some();let inner_present=settings.inner_width.is_some();
 let shadow_x_present=settings.shadow_x.is_some();let shadow_y_present=settings.shadow_y.is_some();
 let has_leading=settings.leading.is_some();let has_kind=settings.kind.is_some();let scale_x=settings.h_scale.is_some();let scale_y=settings.v_scale.is_some();let has_kern=settings.kern.is_some();let has_path=settings.path.is_some();let has_offset=settings.path_offset.is_some();let has_flip=settings.path_flip.is_some();let next=settings.spec()?;
 let state=app.state::<std::sync::Mutex<Workspace>>();
 let mut w=state.lock().map_err(|e|e.to_string())?;
 let mut doc=w.source.clone().ok_or("No editable design")?;
 let index=super::editor_parity::editable_index(&doc,uid)?;
 let mut spec=doc.lettering(index).ok_or("Selected object is not editable text")?;
 let original_bounds=zigzag::svg::shapes_bounds(std::slice::from_ref(&doc.shapes[index]));
 let wording_only=spec.text!=next.text && spec.font==next.font && (spec.size_mm-next.size_mm).abs()<0.001 && (spec.spacing_mm-next.spacing_mm).abs()<0.001 && (spec.arc_mm-next.arc_mm).abs()<0.001 && (!scale_x||(spec.h_scale-next.h_scale).abs()<0.001) && (!scale_y||(spec.v_scale-next.v_scale).abs()<0.001);
 spec.text=next.text;spec.font=next.font;spec.size_mm=next.size_mm;spec.spacing_mm=next.spacing_mm;spec.arc_mm=next.arc_mm;spec.bold=next.bold;spec.italic=next.italic;spec.color=next.color;spec.align=next.align;if has_kind{spec.kind=next.kind;spec.bean=next.bean;spec.puff=next.puff;spec.effect=next.effect}
 if effect_color_present{spec.effect_color=next.effect_color}if inner_color_present{spec.inner_color=next.inner_color}
 if outer_present{spec.outer_width=next.outer_width}if inner_present{spec.inner_width=next.inner_width}
 if shadow_x_present{spec.shadow_x=next.shadow_x}if shadow_y_present{spec.shadow_y=next.shadow_y}if has_leading{spec.leading=next.leading}if scale_x{spec.h_scale=next.h_scale}if scale_y{spec.v_scale=next.v_scale}if has_kern{spec.kern=next.kern}if has_path{spec.path=next.path}if has_offset{spec.path_offset=next.path_offset}if has_flip{spec.path_flip=next.path_flip}
 doc.set_lettering(index,&spec).map_err(|e|e.to_string())?;
 if wording_only && !original_bounds.is_empty(){
  let fitted=zigzag::svg::shapes_bounds(std::slice::from_ref(&doc.shapes[index]));
  if fitted.width()>original_bounds.width() && original_bounds.width()>0.0 {
   spec.h_scale=(spec.h_scale*original_bounds.width()/fitted.width()).clamp(25.0,250.0);
   doc.set_lettering(index,&spec).map_err(|e|e.to_string())?;
   let fitted=zigzag::svg::shapes_bounds(std::slice::from_ref(&doc.shapes[index]));
   if fitted.width()>original_bounds.width()*1.05{return Err("Text is too long for its current area. Adjust size or width explicitly.".into())}
  }
 }
 doc.sync().map_err(|e|e.to_string())?;
 let design=doc.plan_cached(&mut w.plan_cache);
 super::validate_resized_design(&design)?;
 if design.per_shape.get(index).copied().unwrap_or_default()==0{return Err("Updated lettering produced no stitches".into())}
 let result=preview(&design);w.checkpoint_named("Update lettering");w.current=Some(design);w.source=Some(doc);Ok(result)
 }).await.map_err(|e|e.to_string())?
}
#[tauri::command]
pub(crate) async fn insert_lettering_settings(settings:LetteringSettings,placement:Option<[f64;2]>,app:tauri::AppHandle)->Result<Preview,String>{
 use tauri::Manager;
 tauri::async_runtime::spawn_blocking(move||{let spec=settings.spec()?;let state=app.state::<std::sync::Mutex<Workspace>>();let mut w=state.lock().map_err(|e|e.to_string())?;apply(&mut w,&spec,Some(placement.unwrap_or([0.0,0.0])))}).await.map_err(|e|e.to_string())?
}
#[cfg(test)]
mod tests {
    use super::*;
    use crate::{Project, insert_editable_artwork};
    use std::sync::Mutex;
    use zigzag::{formats::dst::write_dst, params::Kind};

    #[test]
    fn lettering_effects_survive_text_edit_and_sync() {
        for kind in [Kind::Satin, Kind::Fill, Kind::Run, Kind::Ripple, Kind::Contour, Kind::Applique, Kind::Cross, Kind::Meander, Kind::Blanket] {
            let mut doc = Document::empty();
            let spec = TextSpec { text: "AB".into(), size_mm: 25.0, kind, ..Default::default() };
            let plan = plan_text(&mut doc, &spec, [0.0,0.0], &mut zigzag::design::PlanCache::default()).unwrap();
            assert!(plan.per_shape.iter().any(|&n| n > 0));
            let index = doc.shapes.iter().enumerate().find(|(i,_)|doc.lettering(*i).is_some()).unwrap().0;
            assert_eq!(doc.lettering(index).unwrap().kind, kind);
            let mut updated = doc.lettering(index).unwrap();
            updated.text = "CD".into();
            doc.set_lettering(index,&updated).unwrap();
            doc.sync().unwrap();
            assert_eq!(doc.lettering(index).unwrap().kind,kind);
            assert!(doc.plan().per_shape.iter().any(|&n| n > 0));
        }
    }

    #[test]
    fn adding_lettering_keeps_vectors_manual_runs_and_undo_and_reopens() {
        let xml = r##"<svg xmlns="http://www.w3.org/2000/svg" width="20mm" height="20mm" viewBox="0 0 20 20">
            <circle id="badge" cx="5" cy="5" r="4" fill="purple"/>
            <path id="needle_manual" d="M10 10L12 15L18 12" fill="none" stroke="blue"/>
        </svg>"##;
        let mut workspace = Workspace::default();
        insert_editable_artwork(&mut workspace, xml, "My badge", -23.0, -5.0, false).unwrap();
        let before = write_dst(workspace.current.as_ref().unwrap());
        let spec = TextSpec { text: "AB\nCD".into(), size_mm: 8.0, ..Default::default() };
        apply(&mut workspace, &spec, Some([15.0, 9.0])).unwrap();
        let source = workspace.source.as_ref().unwrap();
        assert_eq!(source.name, "My badge");
        assert_eq!(source.shapes.len(), 3);
        assert!(source.shapes.iter().any(|s| s.params.kind == Some(Kind::Manual)));
        let index = source.shapes.iter().enumerate().find(|(i,_)| source.lettering(*i).is_some()).unwrap().0;
        assert_eq!(source.lettering(index).unwrap().text, spec.text);
        let center = zigzag::svg::shapes_bounds(&source.shapes[index..=index]).center();
        assert!((center.x - 150.0).abs() < 1.1 && (center.y - 90.0).abs() < 1.1);
        assert_eq!(write_dst(&workspace.undo.last().unwrap().0), before);
        let expected = write_dst(workspace.current.as_ref().unwrap());
        let saved = Project::capture(&workspace, 100.0, 100.0, "dst".into()).unwrap().unwrap();
        let restored = Mutex::new(Workspace::default());
        saved.restore(&restored).unwrap();
        let reopened = restored.into_inner().unwrap().source.unwrap();
        assert_eq!(reopened.lettering(index).unwrap().text, spec.text);
        assert_eq!(write_dst(&reopened.plan()), expected);
        assert!(apply(&mut workspace, &spec, Some([f64::NAN, 0.0])).is_err());
        assert_eq!(write_dst(workspace.current.as_ref().unwrap()), expected);
        assert_eq!(workspace.undo.len(), 1);
    }
}

fn baseline_svg(document: &Document, uid: usize) -> Result<String, String> {
    use zigzag::{bezier,svg::Geometry};
    let index = super::editor_parity::editable_index(document,uid)?;
    if !matches!(document.shapes[index].geometry,Geometry::Stroke{..}) {
        return Err("Choose an open stroke, such as a path drawn with the Pen.".into());
    }
    let path = document.edit_path(index).map_err(|error|error.to_string())?;
    let [part] = path.as_slice() else {return Err("Choose a stroke with one open path.".into());};
    if part.closed||part.anchors.len()<2 {
        return Err("Choose an open path with at least two points.".into());
    }
    let svg=bezier::to_svg_d(&bezier::transform(&path,[0.1,0.0,0.0,0.1,0.0,0.0]));
    if svg.len()>4096{return Err("Simplify this path before using it for lettering.".into());}
    Ok(svg)
}

#[tauri::command]
pub(crate) fn lettering_baseline(uid: usize, state: tauri::State<'_,std::sync::Mutex<Workspace>>) -> Result<String,String> {
    let workspace=state.lock().map_err(|error|error.to_string())?;
    let document=workspace.source.as_ref().ok_or("Open editable artwork first.")?;
    baseline_svg(document,uid)
}

#[cfg(test)]
mod baseline_tests {
    use super::*;

    #[test]
    fn picks_a_bezier_baseline_in_design_mm_without_moving_its_source() {
        let mut doc=Document::empty();
        let path=zigzag::bezier::from_svg_d("M-120 60 Q0 -30 120 60");
        let index=doc.add_drawing_path(&path,[25,25,25],zigzag::params::Kind::Run).unwrap();
        let uid=doc.shapes[index].uid;
        let before=doc.to_svg().unwrap();
        let svg=baseline_svg(&doc,uid).unwrap();
        let derived=zigzag::bezier::from_svg_d(&svg);
        assert_eq!(derived[0].anchors[0].p,zigzag::geom::P::new(-12.0,6.0));
        assert_eq!(derived[0].anchors[1].p,zigzag::geom::P::new(12.0,6.0));
        assert_eq!(doc.to_svg().unwrap(),before);
    }
}
