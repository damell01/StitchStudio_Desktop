//! Embedded offline OCR and editable lettering reconstruction.
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct RecognizedLine {
    pub text: String,
    pub confidence: f64,
    pub rect: [f64; 4],
    pub font: String,
    pub enabled: bool,
}

pub fn recognize_rgba(w: u32, h: u32, rgba: &[u8]) -> anyhow::Result<Vec<RecognizedLine>> {
    use ocrs::{ImageSource, OcrEngine, OcrEngineParams, TextItem};
    use rten::Model;
    let mut rgb = Vec::with_capacity(rgba.len()/4*3);
    for px in rgba.chunks_exact(4) {
        let a = u16::from(px[3]);
        for &v in &px[..3] {
            rgb.push(((u16::from(v)*a + 255*(255-a))/255) as u8);
        }
    }
    let engine = OcrEngine::new(OcrEngineParams {
        detection_model: Some(Model::load(include_bytes!(concat!(env!("OUT_DIR"), "/text-detection.rten")).to_vec())?),
        recognition_model: Some(Model::load(include_bytes!(concat!(env!("OUT_DIR"), "/text-recognition.rten")).to_vec())?),
        ..Default::default()
    })?;
    let input = engine.prepare_input(ImageSource::from_bytes(&rgb, (w,h))?)?;
    let words = engine.detect_words(&input)?;
    let regions = engine.find_text_lines(&input, &words);
    let recognized = engine.recognize_text(&input, &regions)?;
    let fonts = crate::document::font_families();
    let mut lines = Vec::new();
    for text in recognized.into_iter().flatten() {
        let rect = text.bounding_rect();
        let value = text.to_string();
        if value.trim().is_empty() || rect.width() <= 0 || rect.height() <= 0 { continue; }
        let mut line = RecognizedLine {
            text: value,
            // This backend does not expose a calibrated confidence score.
            confidence: -1.0,
            rect: [rect.left() as f64, rect.top() as f64, rect.right() as f64, rect.bottom() as f64],
            font: crate::document::default_font(),
            enabled: false,
        };
        line.font = recommend_font(&line, &fonts);
        lines.push(line);
    }
    Ok(lines)
}

fn recommend_font(line: &RecognizedLine, fonts: &[String]) -> String {
    use crate::{document::{Document, TextSpec}, svg::shapes_bounds};
    let aspect = (line.rect[2]-line.rect[0])/(line.rect[3]-line.rect[1]);
    let mut best = (f64::INFINITY, line.font.clone());
    // A small, common installed-font shortlist avoids measuring hundreds
    // of fonts on the OCR worker. Match proportions, not font identity.
    for font in std::iter::once(&line.font).chain(fonts.iter().filter(|f|
        ["Arial", "Arial Narrow", "Helvetica", "Times New Roman", "Georgia",
         "DejaVu Sans", "DejaVu Serif", "Liberation Sans", "Liberation Serif",
         "Poppins", "Inter", "Verdana", "Courier New"].contains(&f.as_str()))) {
        let mut doc = Document::empty();
        let spec = TextSpec { text: line.text.clone(), font: font.clone(),
            spacing_mm: 0.0, ..TextSpec::default() };
        if let Ok(i) = doc.add_lettering(&spec, (0.0,0.0)) {
            let b = shapes_bounds(std::slice::from_ref(&doc.shapes[i]));
            if b.width() > 0.0 && b.height() > 0.0 {
                let score = ((b.width()/b.height())/aspect).ln().abs();
                if score < best.0 { best = (score, font.clone()); }
            }
        }
    }
    best.1
}


pub fn replace_lettering(doc: &mut crate::document::Document, lines: &[RecognizedLine], mm_per_px: f64) -> anyhow::Result<()> {
    use crate::{document::TextSpec, svg::shapes_bounds};
    let fonts = crate::document::font_families();
    let mut candidate = doc.clone();
    for line in lines.iter().filter(|l| l.enabled) {
        anyhow::ensure!(line.text.chars().count() <= 120 && !line.text.trim().is_empty() && fonts.contains(&line.font), "Check recognized text and installed font.");
        let [x0,y0,x1,y1] = line.rect.map(|v| v*mm_per_px*10.0);
        anyhow::ensure!([x0,y0,x1,y1].iter().all(|v| v.is_finite() && v.abs() <= 10000.0) && x1>x0 && y1>y0, "Invalid text region");
        let (x0,y0,x1,y1) = (x0-candidate.offset.x,y0-candidate.offset.y,x1-candidate.offset.x,y1-candidate.offset.y);
        let pad = ((y1-y0)*0.12).max(1.0);
        let indices: Vec<_> = candidate.shapes.iter().enumerate().filter_map(|(i,s)| {
            let b = shapes_bounds(std::slice::from_ref(s));
            (!candidate.records_text(i) && !b.is_empty() &&
             b.min.x >= x0-pad && b.max.x <= x1+pad &&
             b.min.y >= y0-pad && b.max.y <= y1+pad).then_some(i)
        }).collect();
        anyhow::ensure!(!indices.is_empty(), "No isolated traced shapes for '{}'. Uncheck this region or adjust trace settings.", line.text);
        let color = candidate.shapes[indices[0]].color;
        let center = ((x0+x1)/20.0,(y0+y1)/20.0);
        let mut spec = TextSpec { text: line.text.clone(), font: line.font.clone(), color,
            size_mm: ((y1-y0)/10.0).max(0.5), spacing_mm: 0.0, ..Default::default() };
        candidate.delete_many(&indices)?;
        let i = candidate.add_lettering(&spec, center)?;
        let b = shapes_bounds(std::slice::from_ref(&candidate.shapes[i]));
        if b.width()>0.0 && b.height()>0.0 {
            spec.h_scale=(100.0*(x1-x0)/b.width()).clamp(25.0,250.0);
            spec.v_scale=(100.0*(y1-y0)/b.height()).clamp(25.0,250.0);
            candidate.set_lettering(i,&spec)?;
        }
    }
    *doc = candidate;
    Ok(())
}
