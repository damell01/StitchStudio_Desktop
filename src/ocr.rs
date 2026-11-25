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
    let mut lines = Vec::new();
    for text in recognized.into_iter().flatten() {
        let rect = text.bounding_rect();
        let value = text.to_string();
        if value.trim().is_empty() || rect.width() <= 0 || rect.height() <= 0 { continue; }
        let line = RecognizedLine {
            text: value,
            // This backend does not expose a calibrated confidence score.
            confidence: -1.0,
            rect: [rect.left() as f64, rect.top() as f64, rect.right() as f64, rect.bottom() as f64],
            font: crate::document::default_font(),
            enabled: false,
        };
        lines.push(line);
    }
    let mut lines = group_lines(lines);
    let fonts = crate::document::font_families();
    for line in &mut lines {
        line.font = recommend_font(line, &fonts);
    }
    Ok(lines)
}

// OCR detectors frequently split widely tracked logo lettering into separate
// characters. Group only adjacent boxes with similar height and baseline.
fn group_lines(mut input: Vec<RecognizedLine>) -> Vec<RecognizedLine> {
    input.retain(|l| l.text.chars().any(|c| c.is_alphanumeric()) &&
        l.rect.iter().all(|v| v.is_finite()) && l.rect[2]>l.rect[0] && l.rect[3]>l.rect[1]);
    input.sort_by(|a,b| a.rect[1].total_cmp(&b.rect[1]));
    let mut rows: Vec<Vec<RecognizedLine>> = Vec::new();
    for line in input {
        let h = line.rect[3]-line.rect[1];
        let cy=(line.rect[1]+line.rect[3])/2.0;
        if let Some(row)=rows.iter_mut().find(|row| {
            let a=&row[0].rect; let ah=a[3]-a[1];
            (cy-(a[1]+a[3])/2.0).abs() <= 0.35*h.min(ah) &&
                h/ah >= 0.55 && h/ah <= 1.8
        }) { row.push(line); } else { rows.push(vec![line]); }
    }
    let mut output: Vec<RecognizedLine> = Vec::new();
    for mut row in rows {
        row.sort_by(|a,b| a.rect[0].total_cmp(&b.rect[0]));
        let mut merged: Vec<RecognizedLine> = Vec::new();
        for line in row {
            if let Some(last)=merged.last_mut() {
                let h=(last.rect[3]-last.rect[1]).min(line.rect[3]-line.rect[1]);
                let gap=line.rect[0]-last.rect[2];
                // Overlapping OCR candidates must never produce duplicate stitches.
                if gap < -0.12*h {
                    if line.text.chars().count()>last.text.chars().count() { *last=line; }
                    continue;
                }
                if gap <= 1.1*h {
                    if gap > 0.48*h && last.text.chars().count()>1 && line.text.chars().count()>1 { last.text.push(' '); }
                    last.text.push_str(line.text.trim());
                    last.rect=[last.rect[0].min(line.rect[0]),last.rect[1].min(line.rect[1]),last.rect[2].max(line.rect[2]),last.rect[3].max(line.rect[3])];
                    continue;
                }
            }
            merged.push(line);
        }
        output.extend(merged.into_iter().filter(|l| l.text.chars().filter(|c| c.is_alphanumeric()).count()>=2));
    }
    output.sort_by(|a,b| a.rect[1].total_cmp(&b.rect[1]).then(a.rect[0].total_cmp(&b.rect[0])));
    output
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
            spacing_mm: 0.0, bold: false, ..TextSpec::default() };
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
        let pad = ((y1-y0)*0.08).max(0.5);
        anyhow::ensure!(y1-y0 >= 18.0, "Lettering below 1.8 mm needs manual digitizing or a larger design");
        let indices: Vec<_> = candidate.shapes.iter().enumerate().filter_map(|(i,s)| {
            let b = shapes_bounds(std::slice::from_ref(s));
            (!candidate.records_text(i) && !b.is_empty() &&
             b.min.x >= x0-pad && b.max.x <= x1+pad &&
             b.min.y >= y0-pad && b.max.y <= y1+pad).then_some(i)
        }).collect();
        anyhow::ensure!(!indices.is_empty(), "No isolated traced shapes for '{}'. Uncheck this region or adjust trace settings.", line.text);
        let mut ink = crate::geom::Bounds::empty();
        for &i in &indices {
            let b=shapes_bounds(std::slice::from_ref(&candidate.shapes[i]));
            ink.add(b.min); ink.add(b.max);
        }
        anyhow::ensure!(ink.width() >= (x1-x0)*0.65 && ink.height() >= (y1-y0)*0.65, "OCR region does not cover the original lettering sufficiently");
        // Reject partial intersections with unselected shapes, including
        // previously reconstructed lettering. Thin adjacent rules stay intact.
        for (i,shape) in candidate.shapes.iter().enumerate() {
            if indices.contains(&i) { continue; }
            let b=shapes_bounds(std::slice::from_ref(shape));
            let overlap_x=(b.max.x.min(x1)-b.min.x.max(x0)).max(0.0);
            let overlap_y=(b.max.y.min(y1)-b.min.y.max(y0)).max(0.0);
            anyhow::ensure!(overlap_x*overlap_y < (x1-x0)*(y1-y0)*0.06, "Text overlaps other artwork; original retained");
        }
        let color = candidate.shapes[indices[0]].color;
        let center = (ink.center().x/10.0,ink.center().y/10.0);
        let small = ink.height() < 40.0;
        let mut spec = TextSpec { text: line.text.clone(), font: line.font.clone(), color,
            size_mm: (ink.height()/10.0).max(0.5), spacing_mm: 0.0, bold: false, ..Default::default() };
        candidate.delete_many(&indices)?;
        let i = candidate.add_lettering(&spec, center)?;
        let b = shapes_bounds(std::slice::from_ref(&candidate.shapes[i]));
        if b.width()>0.0 && b.height()>0.0 {
            let target_width=ink.width();
            let count=line.text.chars().count().saturating_sub(1);
            if count>0 && target_width>b.width() { spec.spacing_mm=((target_width-b.width())/10.0/count as f64).clamp(0.0,5.0); }
            spec.v_scale=(100.0*ink.height()/b.height()).clamp(25.0,250.0);
            candidate.set_lettering(i,&spec)?;
            let fitted=shapes_bounds(std::slice::from_ref(&candidate.shapes[i]));
            if fitted.width()>0.0 { spec.h_scale=(100.0*target_width/fitted.width()).clamp(25.0,250.0); }
            candidate.set_lettering(i,&spec)?;
        }
        if small {
            // Avoid heavy foundations and excessive pull on small satin letters.
            let p=&mut candidate.shapes[i].params;
            p.spacing=Some(0.45);
            p.pull=Some(0.0);
            p.satin_underlay=Some(0);
            p.short_stitches=Some(true);
        }
        candidate.sync()?;
    }
    *doc = candidate;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn line(text:&str,x:f64,y:f64,w:f64,h:f64)->RecognizedLine {
        RecognizedLine{text:text.into(),confidence:-1.0,rect:[x,y,x+w,y+h],font:String::new(),enabled:false}
    }
    #[test]
    fn tracked_letters_group_without_joining_adjacent_rows() {
        let rows=group_lines(vec![line("L",0.,10.,10.,20.),line("I",17.,10.,5.,20.),line("T",30.,10.,10.,20.),line("SEED",0.,50.,70.,30.),line("x",100.,0.,5.,5.)]);
        assert_eq!(rows.iter().map(|r|r.text.as_str()).collect::<Vec<_>>(),vec!["LIT","SEED"]);
    }
}
