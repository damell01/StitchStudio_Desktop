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
        line.font = recommend_font(line, &fonts, w, h, &rgb);
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

// Compare normalized ink silhouettes rather than selecting a font on aspect
// alone. Coarse cells and row/column projections tolerate antialiasing and
// modest tracking differences without requiring a cloud model.
const MASK_W:usize=64;
const MASK_H:usize=24;
fn source_mask(rect:[f64;4],w:u32,h:u32,rgb:&[u8])->Vec<f64>{
    let mut mask=vec![0.0;MASK_W*MASK_H];
    if w==0||h==0{return mask}
    for y in 0..MASK_H {for x in 0..MASK_W {
        let mut ink=0.0;
        for dy in [0.25,0.75] {for dx in [0.25,0.75] {
            let px=(rect[0]+(x as f64+dx)/MASK_W as f64*(rect[2]-rect[0])).clamp(0.0,(w-1) as f64) as usize;
            let py=(rect[1]+(y as f64+dy)/MASK_H as f64*(rect[3]-rect[1])).clamp(0.0,(h-1) as f64) as usize;
            let i=(py*w as usize+px)*3;
            if i+2<rgb.len(){ink+=1.0-(rgb[i] as f64*0.299+rgb[i+1] as f64*0.587+rgb[i+2] as f64*0.114)/255.0;}
        }}
        mask[y*MASK_W+x]=ink/4.0;
    }}
    // Normalize local contrast and infer polarity from the region border.
    // White lettering on dark artwork must not be matched as negative ink.
    let border:Vec<_>=(0..MASK_H).flat_map(|y|(0..MASK_W).filter(move |&x|x==0||y==0||x+1==MASK_W||y+1==MASK_H).map(move |x|y*MASK_W+x)).map(|i|mask[i]).collect();
    let background=border.iter().sum::<f64>()/border.len().max(1) as f64;
    if background>0.5 {for v in &mut mask{*v=1.0-*v;}}
    let floor=mask.iter().copied().fold(f64::INFINITY,f64::min);
    let ceiling=mask.iter().copied().fold(0.0_f64,f64::max);
    if ceiling-floor>0.05 {for v in &mut mask{*v=((*v-floor)/(ceiling-floor)).clamp(0.0,1.0);}}
    mask
}
// Count enclosed background regions in a normalized glyph silhouette.
fn enclosed_openings(mask:&[f64])->usize {
    let mut visited=vec![false;MASK_W*MASK_H];
    let mut count=0;
    for start in 0..visited.len() {
        if visited[start]||mask[start]>=0.5 {continue;}
        let mut stack=vec![start];visited[start]=true;
        let mut edge=false;let mut area=0;
        while let Some(i)=stack.pop(){
            area+=1;
            let x=i%MASK_W;let y=i/MASK_W;
            edge|=x==0||y==0||x+1==MASK_W||y+1==MASK_H;
            for j in [if x>0{Some(i-1)}else{None},if x+1<MASK_W{Some(i+1)}else{None},if y>0{Some(i-MASK_W)}else{None},if y+1<MASK_H{Some(i+MASK_W)}else{None}].into_iter().flatten(){
                if !visited[j]&&mask[j]<0.5 {visited[j]=true;stack.push(j);}
            }
        }
        if !edge&&area>=4 {count+=1;}
    }
    count
}
fn mask_distance(a:&[f64],b:&[f64])->f64{
    let sum_a=a.iter().sum::<f64>().max(1.0);
    let sum_b=b.iter().sum::<f64>().max(1.0);
    let pixel=a.iter().zip(b).map(|(x,y)|(x/sum_a-y/sum_b).abs()).sum::<f64>();
    let rows=(0..MASK_H).map(|y|{let start=y*MASK_W;let end=start+MASK_W;(a[start..end].iter().sum::<f64>()/sum_a-b[start..end].iter().sum::<f64>()/sum_b).abs()}).sum::<f64>();
    let cols=(0..MASK_W).map(|x|{let p=(0..MASK_H).map(|y|a[y*MASK_W+x]).sum::<f64>();let q=(0..MASK_H).map(|y|b[y*MASK_W+x]).sum::<f64>();(p/sum_a-q/sum_b).abs()}).sum::<f64>();
    pixel*0.35+rows*0.4+cols*0.25 + 0.08*enclosed_openings(a).abs_diff(enclosed_openings(b)).min(5) as f64
}

fn recommend_font(line: &RecognizedLine, fonts: &[String], w:u32,h:u32,rgb:&[u8]) -> String {
    use crate::{document::{Document, TextSpec}, svg::shapes_bounds};
    let aspect = (line.rect[2]-line.rect[0])/(line.rect[3]-line.rect[1]);
    let mut best = (f64::INFINITY, line.font.clone());
    let source = source_mask(line.rect,w,h,rgb);
    // A small, common installed-font shortlist avoids measuring hundreds
    // of fonts on the OCR worker. Match silhouettes and proportions.
    for font in std::iter::once(&line.font).chain(fonts.iter().filter(|f|
        ["Arial", "Arial Narrow", "Helvetica", "Times New Roman", "Georgia",
         "DejaVu Sans", "DejaVu Serif", "Liberation Sans", "Liberation Serif",
         "Poppins", "Inter", "Verdana", "Courier New", "Bodoni MT", "Didot", "Garamond", "Baskerville", "Palatino Linotype", "Book Antiqua"].contains(&f.as_str()))) {
        let mut doc = Document::empty();
        let spec = TextSpec { text: line.text.clone(), font: font.clone(),
            spacing_mm: 0.0, bold: false, ..TextSpec::default() };
        if let Ok(i) = doc.add_lettering(&spec, (0.0,0.0)) {
            let b = shapes_bounds(std::slice::from_ref(&doc.shapes[i]));
            if b.width() > 0.0 && b.height() > 0.0 {
                let ratio = ((b.width()/b.height())/aspect).ln().abs();
                let visual = match &doc.shapes[i].geometry {
                    crate::svg::Geometry::Fill{rings,rule} => {
                        let mut mask=vec![0.0; MASK_W*MASK_H];
                        for y in 0..MASK_H {for x in 0..MASK_W {
                            let p=crate::geom::P::new(b.min.x+(x as f64+0.5)/MASK_W as f64*b.width(),b.min.y+(y as f64+0.5)/MASK_H as f64*b.height());
                            mask[y*MASK_W+x]=if crate::geom::point_inside(rings,*rule,p){1.0}else{0.0};
                        }}
                        mask_distance(&source,&mask)
                    }, _ => 1.0,
                };
                let score = visual + ratio*0.18;
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
        // Compare the traced and reconstructed outline topology using the
        // same normalized sampling grid as font recommendation.
        let outline_mask=|doc:&crate::document::Document, ids:&[usize], bounds:crate::geom::Bounds|{
            let mut mask=vec![0.0;MASK_W*MASK_H];
            for y in 0..MASK_H {for x in 0..MASK_W {
                let p=crate::geom::P::new(bounds.min.x+(x as f64+0.5)*bounds.width()/MASK_W as f64,
                    bounds.min.y+(y as f64+0.5)*bounds.height()/MASK_H as f64);
                if ids.iter().any(|&j|match &doc.shapes[j].geometry {
                    crate::svg::Geometry::Fill{rings,rule}=>crate::geom::point_inside(rings,*rule,p),
                    _=>false,
                }) {mask[y*MASK_W+x]=1.0;}
            }}
            mask
        };
        let original_openings=enclosed_openings(&outline_mask(&candidate,&indices,ink.clone()));
        let color = candidate.shapes[indices[0]].color;
        anyhow::ensure!(indices.iter().all(|&i|candidate.shapes[i].color==color && !candidate.layer_properties(&candidate.shapes[i].id).is_some_and(|l|l.locked||l.hidden)), "Text region contains multiple colors or protected artwork; original retained");
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
            // Small text needs a light foundation, not a blanket removal
            // of underlay on stretchy or textured fabric.
            let fabric=candidate.plan_options().fabric;
            let id=candidate.shapes[i].id.clone();
            for shape in candidate.shapes.iter_mut().filter(|s|s.id==id) {
                let p=&mut shape.params;
                p.spacing=Some(fabric.satin_spacing.clamp(0.38,0.45));
                p.pull=Some(fabric.satin_pull.min(if original_openings>0 {0.10} else {0.15}));
                p.split=Some(3.0);
                p.satin_underlay=Some(if fabric.id=="standard" && ink.height()<25.0 {0} else {crate::params::underlay::CENTER});
                p.short_stitches=Some(true);
            }
        }
        candidate.sync()?;
        // Check the reconstructed region before committing it. A font
        // substitution must not collapse the original line dimensions.
        let fitted=shapes_bounds(std::slice::from_ref(&candidate.shapes[i]));
        anyhow::ensure!(!fitted.is_empty() &&
            (fitted.width()-ink.width()).abs()<= (ink.width()*0.15).max(5.0) &&
            (fitted.height()-ink.height()).abs()<= (ink.height()*0.15).max(3.0),
            "Reconstructed lettering does not fit the original region");
        let id=&candidate.shapes[i].id;
        let rebuilt:Vec<_>=candidate.shapes.iter().enumerate().filter(|(_,s)|&s.id==id).map(|(j,_)|j).collect();
        let rebuilt_mask=outline_mask(&candidate,&rebuilt,fitted.clone());
        let openings=enclosed_openings(&rebuilt_mask);
        anyhow::ensure!(openings>=original_openings.saturating_sub(1),
            "Reconstructed lettering loses enclosed openings; original retained");
        let plan=candidate.plan();
        anyhow::ensure!(plan.per_shape.get(i).is_some_and(|&n|n>0),
            "Reconstructed lettering generated no stitches");
        // Inspect actual continuous sewn segments, not jumps between runs.
        // Sample only deep interior background cells to tolerate edge pull.
        if openings>0 {
            let mut background=vec![false;MASK_W*MASK_H];
            let mut seen=vec![false;MASK_W*MASK_H];
            for start in 0..seen.len(){
                if seen[start]||rebuilt_mask[start]>=0.5{continue;}
                let mut stack=vec![start];let mut region=Vec::new();let mut edge=false;seen[start]=true;
                while let Some(k)=stack.pop(){
                    region.push(k);let x=k%MASK_W;let y=k/MASK_W;
                    edge|=x==0||y==0||x+1==MASK_W||y+1==MASK_H;
                    for j in [if x>0{Some(k-1)}else{None},if x+1<MASK_W{Some(k+1)}else{None},if y>0{Some(k-MASK_W)}else{None},if y+1<MASK_H{Some(k+MASK_W)}else{None}].into_iter().flatten(){
                        if !seen[j]&&rebuilt_mask[j]<0.5{seen[j]=true;stack.push(j);}
                    }
                }
                if !edge&&region.len()>=9{
                    for k in region{
                        if [k-1,k+1,k-MASK_W,k+MASK_W].iter().all(|&j|rebuilt_mask[j]<0.5){background[k]=true;}
                    }
                }
            }
            let mut crossed=vec![false;background.len()];
            for block in &plan.blocks{
                if block.color!=color{continue;}
                for run in &block.runs{
                    for w in run.pts.windows(2){
                        let n=(w[0].dist(w[1])/0.5).ceil().clamp(1.0,2048.0) as usize;
                        for j in 0..=n{
                            let p=w[0].lerp(w[1],j as f64/n as f64);
                            let x=(p.x-fitted.min.x)/fitted.width()*MASK_W as f64;
                            let y=(p.y-fitted.min.y)/fitted.height()*MASK_H as f64;
                            if x>=0.0&&y>=0.0&&x<MASK_W as f64&&y<MASK_H as f64{
                                let k=y as usize*MASK_W+x as usize;
                                if background[k]{crossed[k]=true;}
                            }
                        }
                    }
                }
            }
            let total=background.iter().filter(|&&v|v).count();
            let covered=crossed.iter().filter(|&&v|v).count();
            anyhow::ensure!(total<4||covered*4<=total,
                "Generated stitches cross too much of the enclosed lettering space; original retained");
        }
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
    fn enclosed_letter_openings_are_distinguished_from_open_gaps(){
        let mut mask=vec![0.0;MASK_W*MASK_H];
        for y in 5..19 {for x in 20..40 {
            if y==5||y==18||x==20||x==39 {mask[y*MASK_W+x]=1.0;}
        }}
        assert_eq!(enclosed_openings(&mask),1);
        mask[5*MASK_W+30]=0.0;
        assert_eq!(enclosed_openings(&mask),0);
    }
    #[test]
    fn font_mask_handles_reversed_text_polarity() {
        let mut dark=vec![255u8;64*24*3];
        for y in 4..20 {for x in 25..39 {let i=(y*64+x)*3;dark[i..i+3].fill(0);}}
        let light:Vec<_>=dark.iter().map(|v|255-*v).collect();
        let a=source_mask([0.,0.,64.,24.],64,24,&dark);
        let b=source_mask([0.,0.,64.,24.],64,24,&light);
        assert!(mask_distance(&a,&b)<0.001);
    }
    #[test]
    fn tracked_letters_group_without_joining_adjacent_rows() {
        let rows=group_lines(vec![line("L",0.,10.,10.,20.),line("I",17.,10.,5.,20.),line("T",30.,10.,10.,20.),line("SEED",0.,50.,70.,30.),line("x",100.,0.,5.,5.)]);
        assert_eq!(rows.iter().map(|r|r.text.as_str()).collect::<Vec<_>>(),vec!["LIT","SEED"]);
    }
}
