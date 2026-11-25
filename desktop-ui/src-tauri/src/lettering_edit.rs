use crate::{Preview, Workspace, editable_base, preview};
use zigzag::document::{Align, Document, TextSpec};

#[derive(serde::Deserialize)]
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
}

impl LetteringSettings {
    pub fn spec(self) -> Result<TextSpec, String> {
        if self.text.trim().is_empty() || self.text.chars().count() > 120
            || self.text.chars().any(|c| c.is_control() && !matches!(c, '\n' | '\r' | '\t')) {
            return Err("Enter up to 120 characters of lettering.".into());
        }
        if !(3.0..=80.0).contains(&self.size) || !(0.0..=5.0).contains(&self.spacing)
            || !(-300.0..=300.0).contains(&self.arc) {
            return Err("Check the capital height, letter spacing and arc radius.".into());
        }
        if !zigzag::document::font_families().contains(&self.font) {
            return Err("Choose an installed font.".into());
        }
        let align = Align::parse(&self.align).ok_or("Choose a lettering alignment.")?;
        Ok(TextSpec {
            text: self.text, font: self.font, size_mm: self.size, spacing_mm: self.spacing,
            arc_mm: self.arc, bold: self.bold, italic: self.italic, color: self.color, align,
            ..Default::default()
        })
    }
}

fn plan_text(document: &mut Document, spec: &TextSpec, center: [f64; 2]) -> Result<zigzag::design::Design, String> {
    if center.iter().any(|v| !v.is_finite() || v.abs() > 500.0) {
        return Err("Place lettering within 500 mm of the hoop center.".into());
    }
    let index = document.add_lettering(spec, (center[0], center[1])).map_err(|e| e.to_string())?;
    let design = document.plan();
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
    let design = plan_text(&mut document, spec, placement.unwrap_or([0.0, 0.0]))?;
    let result = preview(&design);
    workspace.checkpoint();
    workspace.current = Some(design);
    workspace.source = Some(document);
    Ok(result)
}

#[tauri::command]
pub(crate) async fn preview_lettering(settings: LetteringSettings) -> Result<Preview, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let spec = settings.spec()?;
        let design = plan_text(&mut Document::empty(), &spec, [0.0, 0.0])?;
        Ok(preview(&design))
    }).await.map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{Project, insert_editable_artwork};
    use std::sync::Mutex;
    use zigzag::{formats::dst::write_dst, params::Kind};

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
