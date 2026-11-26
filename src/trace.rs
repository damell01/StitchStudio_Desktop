//! Raster logos (PNG, JPEG, WebP, GIF, BMP, TIFF) traced into SVG artwork for
//! stitching, with VectorCraft's Image Trace (vendor/vectorcraft-trace).
//!
//! Embroidery wants a few flat colours, clean closed regions without specks,
//! smooth outlines, and thin lines as single lines (run or satin stitches),
//! so the options here are said in those terms and mapped onto the tracer's:
//! flat art goes through its Flat Logo mode (edges placed to a fraction of a
//! pixel, corners restored, lines and circles exact); anything else, or a
//! request for centre lines, through its Color mode.

use anyhow::{Result, anyhow};
use vectorcraft_trace::{Mode, Palette, Raster, TraceError, TraceParams, TraceResult};

/// File extensions that open as traced images.
pub const IMAGE_FORMATS: [&str; 7] = ["png", "jpg", "jpeg", "webp", "gif", "bmp", "tiff"];

/// Whether `ext` (no dot, any case) is an image this module traces.
pub fn is_image(ext: &str) -> bool {
    let e = ext.to_ascii_lowercase();
    IMAGE_FORMATS.contains(&e.as_str()) || e == "tif"
}

/// How to trace an image for embroidery.
#[derive(Clone, Debug, PartialEq)]
pub struct TraceOptions {
    /// How many thread colours, 2–10; 0 finds them.
    pub colors: u32,
    /// Remove the background during raster preprocessing.
    pub remove_background: bool,
    /// Trace lines no wider than `line_width_mm` as single lines (run or
    /// satin stitches) instead of thin filled shapes.
    pub lines: bool,
    pub line_width_mm: f64,
    /// 0–100: how closely outlines follow the pixels (more detail, more points).
    pub detail: f64,
    /// Areas smaller than this across (mm) are dropped as specks.
    pub speckle_mm: f64,
    /// Width of the traced artwork (mm).
    pub width_mm: f64,
    /// Thread colours to use: each traced colour becomes the nearest of these.
    /// Empty keeps the image's own colours.
    pub threads: Vec<[u8; 3]>,
}

impl Default for TraceOptions {
    fn default() -> Self {
        TraceOptions {
            colors: 0,
            remove_background: true,
            lines: false,
            line_width_mm: 1.5,
            detail: 60.0,
            speckle_mm: 1.0,
            width_mm: 80.0,
            threads: Vec::new(),
        }
    }
}

/// A decoded image, ready to trace (decode once, trace many times).
#[derive(Clone)]
pub struct Image {
    raster: Raster,
}

impl Image {
    pub fn decode(bytes: &[u8]) -> Result<Image> {
        let raster = Raster::decode_to_fit(bytes).map_err(|e| anyhow!("{e}"))?;
        Ok(Image { raster })
    }
    pub fn size(&self) -> (u32, u32) {
        (self.raster.width, self.raster.height)
    }
    /// The image as RGBA bytes (for showing it).
    pub fn rgba(&self) -> &[u8] {
        &self.raster.rgba
    }
}

/// A trace, as SVG text in millimetres.
#[derive(Clone, Debug)]
pub struct Traced {
    pub svg: String,
    /// The thread colours used, most area first.
    pub colors: Vec<[u8; 3]>,
    pub shapes: usize,
    pub lines: usize,
    /// How it was traced, for the person: "flat logo" or "posterized".
    pub method: &'static str,
}

/// The most anchor points a trace may have before it is refused (a photo
/// traced in detail makes far more stitch-objects than anyone could sew).
const MAX_ANCHORS: usize = 60_000;

/// Trace an image file's bytes.
pub fn trace_bytes(bytes: &[u8], o: &TraceOptions) -> Result<Traced> {
    trace(&Image::decode(bytes)?, o)
}

/// Remove only background connected to the image boundary, preserving enclosed
/// white lettering and other interior details. Uses a robust border sample.
pub fn remove_edge_background(r: &Raster, tolerance: u8) -> Raster {
    let width = r.width as usize;
    let height = r.height as usize;
    if width == 0 || height == 0 {
        return r.clone();
    }

    let border = (0..width)
        .chain((height > 1).then_some((height - 1) * width..height * width).into_iter().flatten())
        .chain((1..height.saturating_sub(1)).map(|y| y * width))
        .chain((1..height.saturating_sub(1)).filter(|_| width > 1).map(|y| (y + 1) * width - 1));
    let mut bins = std::collections::BTreeMap::<[u8; 3], (usize, [usize; 3])>::new();
    let mut opaque = 0;
    let mut transparent = 0;
    for position in border.clone() {
        let pixel = &r.rgba[position * 4..][..4];
        if pixel[3] < 32 {
            transparent += 1;
        } else if pixel[3] >= 224 {
            opaque += 1;
            let key = [pixel[0] / 16, pixel[1] / 16, pixel[2] / 16];
            let (count, sums) = bins.entry(key).or_default();
            *count += 1;
            for channel in 0..3 {
                sums[channel] += usize::from(pixel[channel]);
            }
        }
    }

    // Prefer the original alpha mask when a substantial part of the edge is clear.
    if transparent > 0 && transparent * 4 >= opaque {
        return r.clone();
    }
    // Neighboring shades can land in different bins even when they are part of
    // one textured background. Score the local color cluster before selecting
    // a seed, so a solid foreground touching the frame cannot win just because
    // its color is concentrated in one bin.
    let radius = tolerance.min(16);
    let candidates: std::collections::BTreeMap<_, _> = bins
        .into_iter()
        .map(|(key, (count, sums))| (key, (count, sums, sums.map(|total| (total / count) as u8))))
        .collect();
    let Some((count, sums)) = candidates.iter().map(|(&[r, g, b], &(_, _, color))| {
        let mut count = 0;
        let mut sums = [0; 3];
        for red in r.saturating_sub(1)..=(r + 1).min(15) {
            for green in g.saturating_sub(1)..=(g + 1).min(15) {
                for blue in b.saturating_sub(1)..=(b + 1).min(15) {
                    if let Some(&(n, totals, nearby)) = candidates.get(&[red, green, blue])
                        && (0..3).all(|channel| color[channel].abs_diff(nearby[channel]) <= radius)
                    {
                        count += n;
                        for channel in 0..3 {
                            sums[channel] += totals[channel];
                        }
                    }
                }
            }
        }
        (count, sums)
    }).max_by_key(|(count, _)| *count) else {
        return r.clone();
    };
    if count * 5 < opaque {
        return r.clone();
    }
    let background = sums.map(|total| (total / count) as u8);

    let mut removed = vec![false; width * height];
    let mut queue = std::collections::VecDeque::new();
    let mut visit = |position: usize, queue: &mut std::collections::VecDeque<usize>| {
        let pixel = &r.rgba[position * 4..][..4];
        if !removed[position]
            && (pixel[3] < 32 || (pixel[3] >= 224
                && (0..3).all(|channel| pixel[channel].abs_diff(background[channel]) <= tolerance)))
        {
            removed[position] = true;
            queue.push_back(position);
        }
    };
    for position in border {
        visit(position, &mut queue);
    }
    while let Some(position) = queue.pop_front() {
        let x = position % width;
        let y = position / width;
        if x > 0 { visit(position - 1, &mut queue); }
        if x + 1 < width { visit(position + 1, &mut queue); }
        if y > 0 { visit(position - width, &mut queue); }
        if y + 1 < height { visit(position + width, &mut queue); }
    }

    Raster::from_fn(r.width, r.height, |x, y| {
        let position = y as usize * width + x as usize;
        let i = position * 4;
        [r.rgba[i], r.rgba[i + 1], r.rgba[i + 2], if removed[position] { 0 } else { r.rgba[i + 3] }]
    })
}

// Shared preprocessing pipeline for tracing and future pixel preview.
fn flat_palette(r: &Raster) -> bool {
    let mut counts = [0usize; 4096];
    let mut total = 0usize;
    for p in r.rgba.chunks_exact(4) {
        if p[3] < 128 { continue; }
        let key = ((p[0] as usize >> 4) << 8) | ((p[1] as usize >> 4) << 4) | (p[2] as usize >> 4);
        counts[key] += 1;
        total += 1;
    }
    counts.sort_unstable_by(|a,b| b.cmp(a));
    total > 0 && counts[..12].iter().sum::<usize>() as f64 / total as f64 >= 0.90
}

#[test]
fn flat_art_cleanup_preserves_one_pixel_ink() {
    let r = Raster::from_fn(100, 100, |x,_| if x == 50 {[20,20,20,255]} else {[230,140,50,255]});
    assert!(flat_palette(&r));
    let out = prepare_raster(&r,false,32,true);
    assert_eq!(out.rgba,r.rgba);
}

// Recognize high-contrast neutral ink on light paper. Do not apply this
// to colored artwork, transparent originals, or photographic gray ramps.
fn monochrome_ink(r:&Raster)->Option<Raster>{
    let mut dark=0usize;let mut light=0usize;let mut middle=0usize;let mut colored=0usize;let mut clear=0usize;
    for p in r.rgba.chunks_exact(4){
        if p[3]<224{clear+=1;continue}
        let lo=*p[..3].iter().min()?;let hi=*p[..3].iter().max()?;
        if hi-lo>22{colored+=1;}
        let gray=(u16::from(p[0])+u16::from(p[1])+u16::from(p[2]))/3;
        if gray<100{dark+=1;}else if gray>220{light+=1;}else{middle+=1;}
    }
    let n=dark+light+middle;
    if n==0||dark*100<n*2||light*100<n*35||middle*100>n*12||colored*1000>n*3||clear*100>n {return None}
    let mut edge=0usize;let mut white=0usize;
    for y in 0..r.height{for x in 0..r.width{
        if x!=0&&y!=0&&x+1!=r.width&&y+1!=r.height{continue}
        let i=(y as usize*r.width as usize+x as usize)*4;let p=&r.rgba[i..i+4];edge+=1;
        if p[3]>=224&&p[..3].iter().all(|&v|v>=220){white+=1}
    }}
    if edge==0||white*100<edge*95{return None}
    Some(Raster::from_fn(r.width,r.height,|x,y|{
        let i=(y as usize*r.width as usize+x as usize)*4;let p=&r.rgba[i..i+4];
        let gray=(u16::from(p[0])+u16::from(p[1])+u16::from(p[2]))/3;
        if p[3]>=128&&gray<160{[12,12,12,255]}else{[0,0,0,0]}
    }))
}

#[test]
fn monochrome_logo_removes_enclosed_paper_but_keeps_ink(){
    let r=Raster::from_fn(80,80,|x,y|if (10..70).contains(&x)&&(10..70).contains(&y)&&(!(25..55).contains(&x)||!(25..55).contains(&y)){[20,20,20,255]}else{[250,250,250,255]});
    let out=prepare_raster(&r,true,32,true);
    assert_eq!(out.rgba[(40*80+40)*4+3],0);
    assert_eq!(out.rgba[(15*80+15)*4+3],255);
    assert_eq!(out.rgba[3],0);
    let color=Raster::from_fn(80,80,|x,y|if (10..70).contains(&x)&&(10..70).contains(&y){[170,30,50,255]}else{[250,250,250,255]});
    assert!(monochrome_ink(&color).is_none());
}

fn prepare_raster(r:&Raster,remove_background:bool,tolerance:u8,cleanup:bool)->Raster{
    prepare_raster_with_mode(r, remove_background, tolerance, cleanup).0
}

fn prepare_raster_with_mode(
    r: &Raster, remove_background: bool, tolerance: u8, cleanup: bool,
) -> (Raster, bool) {
    if remove_background && let Some(ink) = monochrome_ink(r) {
        return (ink, true);
    }

    // Suppress fabric texture before edge flood fill, preserving the original alpha.
    // A predominantly flat palette is typical of logos and cartoons.
    // Skip destructive median passes for such artwork, especially thin ink lines.
    let cleaned=if cleanup && !flat_palette(r) {median_texture(&median_texture(r,false),false)}else{r.clone()};
    let raster = if remove_background { remove_edge_background(&cleaned, tolerance) } else { cleaned };
    (raster, false)
}

#[test]
fn preparation_preserves_enclosed_light_region(){
    let r=Raster::from_fn(40,40,|x,y|{
        if (8..32).contains(&x)&&(8..32).contains(&y){
            if (15..25).contains(&x)&&(15..25).contains(&y){[245,245,245,255]}else{[160,10,30,255]}
        }else{[245,245,245,255]}
    });
    let out=prepare_raster(&r,true,32,true);
    assert_eq!(out.rgba[3],0);
    assert_eq!(out.rgba[(20*40+20)*4+3],255);
}

#[test]
fn edge_removal_uses_actual_sample_color_and_preserves_partial_alpha() {
    let raster = Raster::from_fn(12, 12, |x, y| match (x, y) {
        (5, 0..=6) => [180, 32, 30, 255],
        (6, 0..=6) => [180, 32, 30, 180],
        _ => [15, 31, 47, 255],
    });
    let result = remove_edge_background(&raster, 0);
    assert_eq!(result.rgba[3], 0);
    assert_eq!(result.rgba[5 * 4 + 3], 255);
    assert_eq!(result.rgba[6 * 4 + 3], 180);
}

#[test]
fn edge_removal_respects_transparent_artwork_touching_the_frame() {
    let raster = Raster::from_fn(16, 16, |x, y| {
        if x <= 9 || y <= 3 { [25, 25, 25, 255] } else { [0, 0, 0, 0] }
    });
    assert_eq!(remove_edge_background(&raster, 32).rgba, raster.rgba);
}

#[test]
fn edge_removal_prefers_textured_background_over_solid_foreground() {
    let raster = Raster::from_fn(40, 40, |x, y| {
        if y < 6 {
            [22, 36, 90, 255]
        } else {
            let shade = [105, 121, 137][((x + y) % 3) as usize];
            [shade, shade, shade, 255]
        }
    });

    let result = remove_edge_background(&raster, 32);
    assert_eq!(&result.rgba[..4], &[22, 36, 90, 255]);
    assert_eq!(result.rgba.chunks_exact(4).filter(|pixel| pixel[3] == 0).count(), 40 * 34);
}

/// Return the same preprocessed pixels used by automatic tracing, before cropping.
pub fn prepared_pixels(bytes:&[u8],remove_background:bool,tolerance:u8,cleanup:bool)->Result<(u32,u32,Vec<u8>)>{
    let image=Image::decode(bytes)?;
    let r=prepare_raster(&image.raster,remove_background,tolerance,cleanup);
    Ok((r.width,r.height,r.rgba.to_vec()))
}

pub fn trace_prepared_bytes(bytes:&[u8],o:&TraceOptions,tolerance:u8,cleanup:bool)->Result<Traced>{
    PreparedArtwork::new(bytes, o.remove_background, tolerance, cleanup)?.trace(o)
}

/// The prepared pixel input shared by competing automatic trace strategies.
pub struct PreparedArtwork {
    image: Image,
    monochrome: bool,
    cleanup: bool,
}

impl PreparedArtwork {
    pub fn new(bytes: &[u8], remove_background: bool, tolerance: u8, cleanup: bool) -> Result<Self> {
        let image = Image::decode(bytes)?;
        let (raster, monochrome) = prepare_raster_with_mode(&image.raster, remove_background, tolerance, cleanup);
        if !raster.rgba.chunks_exact(4).any(|pixel| pixel[3] >= 32) {
            return Err(anyhow!("No foreground remains after background removal. Disable removal or lower sensitivity."));
        }
        Ok(Self { image: Image { raster: trim_transparent_margin(&raster) }, monochrome, cleanup })
    }

    pub fn trace(&self, options: &TraceOptions) -> Result<Traced> {
        trace_prepared_image(&self.image, options, self.monochrome, self.cleanup)
    }

    /// Pixel dimensions after trimming transparent margins.
    pub fn size(&self) -> (u32, u32) {
        self.image.size()
    }

    pub fn digitize(&self, name: &str, options: &TraceOptions) -> Result<crate::document::Document> {
        digitize_trace(self.trace(options)?, name, options)
    }

    /// Check spatial fidelity against the same prepared pixels for both drafts.
    pub fn preserves_fidelity(
        &self, baseline: &crate::document::Document, candidate: &crate::document::Document,
    ) -> bool {
        let score = |document: &crate::document::Document| {
            spatial_error(&document.to_svg().ok()?, &self.image.raster, self.monochrome)
        };
        let Some((before, after)) = score(baseline).zip(score(candidate)) else { return false; };
        after <= before + 0.004 && after <= before * 1.08 + 0.001
    }
}

fn trace_prepared_image(prepared: &Image, o: &TraceOptions, monochrome: bool, cleanup: bool) -> Result<Traced> {
    let mut options=o.clone();options.remove_background=monochrome;
    let flat = flat_palette(&prepared.raster);
    if flat { options.speckle_mm=options.speckle_mm.min(0.35); options.detail=options.detail.max(80.0); } else if cleanup {options.speckle_mm=options.speckle_mm.max(0.6); options.detail=options.detail.min(65.0);}
    // Keep small detached punctuation and serif details; do not use the
    // aggressive generic speckle retry for detected ink logos.
    if monochrome {options.speckle_mm=options.speckle_mm.min(0.18);options.detail=options.detail.max(85.0);}
    // Avoid global hue merging: it destroys intentional shading in character artwork.
    // On flat artwork, attempt mixed fill/centerline tracing before
    // simplifying the palette. This preserves thin outlines as strokes.
    let prefer_lines = flat && options.colors == 0 && !options.lines;
    let mut failures = Vec::new();
    // Try the requested fidelity first, then progressively simplify.
    // Empty successful traces are also retried, rather than ending import.
    for attempt in 0..5 {
        let mut candidate = options.clone();
        // Prefer continuous filled contours for flat art; mixed centerlines are a fallback.
        if prefer_lines && attempt == 1 { candidate.lines = true; }
        if attempt == 2 {
            candidate.detail = candidate.detail.min(50.0);
            candidate.speckle_mm = candidate.speckle_mm.max(0.8);
        } else if attempt == 3 {
            candidate.detail = candidate.detail.min(35.0);
            candidate.speckle_mm = candidate.speckle_mm.max(1.5);
            if candidate.colors == 0 { candidate.colors = 6; }
        } else if attempt == 4 {
            // Tiny uploaded marks can all fall below the normal noise cutoff.
            // Retry the prepared pixels as fine artwork before giving up.
            candidate.detail = candidate.detail.max(85.0);
            candidate.speckle_mm = candidate.speckle_mm.min(0.08);
            candidate.lines = true;
        }
        match trace(prepared, &candidate) {
            Ok(t) if t.shapes + t.lines > 0 => {
                // Complex illustrations often contain tiny anti-alias islands.
                // Compare one physically scaled cleanup candidate, not a blind
                // reduction in colors or a destructive global hue merge.
                if attempt==0 && cleanup && !monochrome && options.colors==0 && options.threads.is_empty()
                    && !options.lines && t.shapes>40 && t.shapes<600 {
                    let mut simplified=candidate.clone();
                    simplified.speckle_mm=simplified.speckle_mm.max(0.85);
                    // Respect the user's detail setting; change only island threshold.
                    if simplified.speckle_mm>candidate.speckle_mm {
                        if let Ok(next)=trace(&prepared,&simplified) {
                            let baseline_regions=t.shapes+t.lines;
                            let next_regions=next.shapes+next.lines;
                            let same_palette=t.colors.iter().all(|&a|next.colors.iter().any(|&b|crate::formats::perceptual_distance(a,b)<=12.0));
                            if next_regions>0 && next_regions*100<=baseline_regions*85 && same_palette {
                                if let (Some(before),Some(after))=(spatial_error(&t.svg,&prepared.raster,false),spatial_error(&next.svg,&prepared.raster,false)) {
                                    if after<=before+0.004 && after<=before*1.08+0.001 {return Ok(next)}
                                }
                            }
                        }
                    }
                }
                return Ok(t)
            },
            Ok(_) => failures.push("No stitchable regions".to_string()),
            Err(e) => failures.push(e.to_string()),
        }
    }
    Err(anyhow!("Automatic digitizing found no usable regions: {}. Try a larger finished width or keep the background.", failures.join("; ")))
}

#[test]
fn automatic_trace_retries_tiny_detached_marks() {
    let raster = Raster::from_fn(128, 128, |x,y| {
        if (10..14).contains(&x) && (10..14).contains(&y)
            || (112..116).contains(&x) && (108..112).contains(&y)
        {
            [18, 25, 40, 255]
        } else {
            [0, 0, 0, 0]
        }
    });
    let image = Image { raster };
    let options = TraceOptions { width_mm: 5., speckle_mm: 0.35, detail: 85., ..Default::default() };
    assert!(trace(&image, &options).map_or(true, |t| t.shapes+t.lines==0));
    let traced = trace_prepared_image(&image, &options, false, true).unwrap();
    assert!(traced.shapes + traced.lines > 0);
}


/// Trace raster artwork into editable geometry with automatic stitch parameters.
pub fn digitize_raster(
    bytes: &[u8], name: &str, options: &TraceOptions, tolerance: u8, cleanup: bool,
) -> Result<crate::document::Document> {
    PreparedArtwork::new(bytes, options.remove_background, tolerance, cleanup)?.digitize(name, options)
}

fn digitize_trace(trace: Traced, name: &str, options: &TraceOptions) -> Result<crate::document::Document> {
    use crate::params::Kind;
    use crate::svg::Geometry;

    let mut document = crate::document::Document::from_svg(&trace.svg, name, None)?;
    if options.colors == 0 {
        consolidate_traced_fills(&mut document)?;
    }
    // The SVG importer populates fallback stitch kinds. This artwork comes
    // from our own tracer, so those defaults are free to change.
    let wide_strokes: Vec<_> = document.shapes.iter().enumerate()
        .filter_map(|(index, shape)| match shape.geometry {
            Geometry::Stroke { width, .. } if width > 55.0 => Some(index),
            _ => None,
        }).collect();
    if !wide_strokes.is_empty() {
        document.outline_stroke(&wide_strokes)?;
    }
    // Small neutral ink shapes in text-like rows retain their individual
    // contours. Detect geometry rather than guessing the actual characters.
    if options.remove_background && trace.colors.len()==1 && trace.colors[0].iter().all(|&v|v<55) {
        let bounds:Vec<_>=document.shapes.iter().map(|s|crate::svg::shapes_bounds(std::slice::from_ref(s))).collect();
        let candidates:Vec<_>=bounds.iter().enumerate().filter(|(_,b)|!b.is_empty()&&b.height()>=8.0&&b.height()<=55.0&&b.width()>=2.0&&b.width()<=65.0).map(|(i,_)|i).collect();
        for &i in &candidates {
            let b=&bounds[i];
            let peers=candidates.iter().filter(|&&j|j!=i && (bounds[j].max.y-b.max.y).abs()<=b.height()*0.28 && (bounds[j].height()-b.height()).abs()<=b.height()*0.35 && (bounds[j].center().x-b.center().x).abs()<=b.height()*8.0).count();
            if peers>=3 {document.shapes[i].groups.push("tl-small-ink-detail".into());}
        }
    }
    for shape in &mut document.shapes {
        // An unoutlined, degenerate wide stroke keeps its default, rather
        // than converting only its transient in-memory geometry to fill.
        if !matches!(shape.geometry, Geometry::Stroke { width, .. } if width > 55.0) {
            shape.params.kind = None;
        }
    }
    crate::design::auto_stitch_types(&mut document.shapes);
    for shape in &mut document.shapes {
        shape.params.kind.get_or_insert(Kind::Fill);
    }
    document.settings.hat_order = document.shapes.len() <= 1000;
    Ok(document)
}

/// Consolidate adjacent same-color areas when the union removes a contour.
/// Write the new outlines to the editable SVG so a save, undo or resize
/// continues to use the same geometry and sewing order.
fn consolidate_traced_fills(document: &mut crate::document::Document) -> Result<()> {
    use crate::geom::FillRule;
    use crate::params::Kind;
    use crate::svg::Geometry;

    let mut retained = None;
    let mut outline = None;
    let mut edits = Vec::new();
    let mut removed = Vec::new();
    for (index, shape) in document.shapes.iter().enumerate() {
        if let Some(previous) = retained {
            let prev: &crate::svg::Shape = &document.shapes[previous];
            if prev.color == shape.color
                && prev.params.kind == Some(Kind::Fill)
                && shape.params.kind == Some(Kind::Fill)
                && let Geometry::Fill { rings: a, rule: ar } = &prev.geometry
                && let Geometry::Fill { rings: b, rule: br } = &shape.geometry
            {
                let (a, ar) = outline.as_ref().map_or((a, *ar), |rings| (rings, FillRule::EvenOdd));
                let union = crate::boolean::pathfinder(
                    &[(a.clone(), ar), (b.clone(), *br)],
                    crate::boolean::PathOp::Unite,
                );
                if !union.is_empty() && union.len() < a.len() + b.len() {
                    outline = Some(union);
                    removed.push(index);
                    continue;
                }
            }
            if let Some(rings) = outline.take() {
                edits.push((previous, crate::bezier::from_rings(&rings, 0.0)));
            }
        }
        retained = Some(index);
    }
    if let Some((previous, rings)) = retained.zip(outline) {
        edits.push((previous, crate::bezier::from_rings(&rings, 0.0)));
    }
    if !removed.is_empty() {
        document.set_paths(&edits)?;
        document.delete_many(&removed)?;
    }
    Ok(())
}

/// Optional texture cleanup for photographed or rendered embroidery artwork.
/// Median filtering suppresses isolated thread highlights without averaging edges.
pub fn trace_cleaned_bytes(bytes: &[u8], o: &TraceOptions) -> Result<Traced> {
    let image = Image::decode(bytes)?;
    let r = &image.raster;
    let cleaned = median_texture(r,o.remove_background);
    let mut options=o.clone();
    options.speckle_mm=options.speckle_mm.max(0.6);
    trace(&Image{raster:cleaned}, &options)
}

// Fit the requested embroidery width to visible artwork, not transparent padding.
fn trim_transparent_margin(r:&Raster)->Raster {
    let (mut l,mut t,mut right,mut bottom)=(r.width,r.height,0,0);
    for y in 0..r.height {for x in 0..r.width {
        if r.rgba[(y as usize*r.width as usize+x as usize)*4+3]>=32 {
            l=l.min(x);t=t.min(y);right=right.max(x+1);bottom=bottom.max(y+1);
        }
    }}
    if l>=right||t>=bottom{return r.clone();}
    Raster::from_fn(right-l,bottom-t,|x,y|{
        let i=((y+t) as usize*r.width as usize+(x+l) as usize)*4;
        [r.rgba[i],r.rgba[i+1],r.rgba[i+2],r.rgba[i+3]]
    })
}

#[test]
fn transparent_padding_does_not_shrink_finished_artwork(){
    let r=Raster::from_fn(100,80,|x,y|if (20..60).contains(&x)&&(10..40).contains(&y){[200,0,0,255]}else{[0,0,0,0]});
    let out=trim_transparent_margin(&r);
    assert_eq!((out.width,out.height),(40,30));
}

fn median_texture(r:&Raster,remove_white:bool)->Raster {
    Raster::from_fn(r.width, r.height, |x,y| {
        let mut channels = [[0u8;9];3];
        let mut matching = [false; 9];
        let mut k=0;
        let center=(y as usize*r.width as usize+x as usize)*4;
        if r.rgba[center+3]<32{return [0,0,0,0];}
        let original: [u8; 3] = r.rgba[center..center + 3].try_into().unwrap();
        for dy in -1i64..=1 { for dx in -1i64..=1 {
            let xx=(i64::from(x)+dx).clamp(0,i64::from(r.width)-1) as usize;
            let yy=(i64::from(y)+dy).clamp(0,i64::from(r.height)-1) as usize;
            let i=(yy*r.width as usize+xx)*4;
            let visible = r.rgba[i+3] >= 32;
            for ch in 0..3 {channels[ch][k]=if visible {r.rgba[i+ch]} else {original[ch]};}
            // Clamped boundary samples repeat the center and cannot establish a line.
            matching[k] = visible && i != center
                && (0..3).all(|ch| original[ch].abs_diff(r.rgba[i + ch]) <= 24);
            k+=1;
        }}
        for ch in &mut channels {ch.sort_unstable();}
        let mut rgb=[channels[0][4],channels[1][4],channels[2][4]];
        // A high-contrast pixel with support on opposite sides may be part
        // of a one-pixel outline. Preserve it while removing isolated flecks.
        if (0..3).any(|ch| original[ch].abs_diff(rgb[ch]) >= 32)
            && (0..4).any(|sample| matching[sample] && matching[8 - sample])
        {
            rgb = original;
        }
        let lo=*rgb.iter().min().unwrap();
        let hi=*rgb.iter().max().unwrap();
        if remove_white && lo>=218 && hi-lo<=20 {rgb=[255;3];}
        let alpha=r.rgba[(y as usize*r.width as usize+x as usize)*4+3];
        [rgb[0],rgb[1],rgb[2],alpha]
    })
}

#[test]
fn texture_cleanup_preserves_thin_ink_and_removes_isolated_noise() {
    let raster = Raster::from_fn(48, 48, |x, y| {
        if x == 22 || (x, y) == (8, 15) {
            return [20, 18, 30, 255];
        }
        [145 + ((x * 41 + y * 17) % 64) as u8,
         114 + ((x * 19 + y * 31) % 64) as u8,
         88 + ((x * 51 + y * 7) % 64) as u8, 255]
    });
    assert!(!flat_palette(&raster));
    let processed = prepare_raster(&raster, false, 32, true);
    let pixel = |x: usize, y: usize| &processed.rgba[(y * 48 + x) * 4..(y * 48 + x) * 4 + 4];
    assert!((2..46).all(|y| pixel(22, y) == [20, 18, 30, 255]));
    assert!(pixel(8, 15)[0] >= 145);
}

#[test]
fn consolidated_fills_survive_project_reopening_without_reordering_layers() {
    use crate::document::Document;
    let svg = r##"<svg xmlns="http://www.w3.org/2000/svg" width="60mm" height="50mm" viewBox="0 0 60 50">
        <path id="first" d="M4 4 H30 V47 H4Z M9 9 V38 H20 V9Z" fill="#a11936"/>
        <rect id="overlap" x="27" y="8" width="15" height="38" fill="#a11936"/>
        <rect id="intervening" x="36" y="8" width="16" height="30" fill="#323375"/>
        <rect id="upper" x="40" y="3" width="14" height="15" fill="#a11936"/>
    </svg>"##;
    let mut document = Document::from_svg(svg, "overlapping fills", None).unwrap();
    consolidate_traced_fills(&mut document).unwrap();
    let xml = document.to_svg().unwrap();
    let restored = Document::from_svg(&xml, &document.name, None).unwrap();
    let layers: Vec<_> = restored.shapes.iter().map(|shape| shape.color).collect();
    assert_eq!(layers, [[161, 25, 54], [50, 51, 117], [161, 25, 54]]);
    let crate::svg::Geometry::Fill { rings, rule } = &restored.shapes[0].geometry else {
        panic!("expected editable fill geometry");
    };
    assert_eq!(rings.len(), 2, "the interior opening was lost");
    let components = crate::stitch::satin::components(rings, *rule);
    assert_eq!(components.len(), 1);
    assert_eq!(components[0].len(), 2, "the second contour no longer represents a hole");
    let dst = |doc: &Document| crate::formats::write_format(&doc.plan(), "dst").unwrap();
    assert_eq!(dst(&document), dst(&restored));
}

#[test]
fn alternate_trace_with_same_extent_and_colors_must_preserve_geometry() {
    use crate::document::Document;
    let artwork = PreparedArtwork {
        image: Image { raster: Raster::from_fn(64, 32, |x, y| {
            if x < 8 || x >= 56 || (10..22).contains(&y) { [194, 28, 56, 255] }
            else { [0, 0, 0, 0] }
        }) },
        monochrome: false,
        cleanup: false,
    };
    let doc = |middle| {
        Document::from_svg(&format!(r##"<svg xmlns="http://www.w3.org/2000/svg" width="64" height="32">
            <path fill="#c21c38" d="M0 0 H8 V32 H0Z M56 0 H64 V32 H56Z {middle}"/>
        </svg>"##), "same-color artwork", None).unwrap()
    };
    let baseline = doc("M8 10 H56 V22 H8Z");
    let missing_detail = doc("");
    assert!(artwork.preserves_fidelity(&baseline, &baseline));
    assert!(!artwork.preserves_fidelity(&baseline, &missing_detail));
}

#[test]
fn generated_artwork_replaces_import_defaults_with_mixed_stitch_types() {
    use crate::params::Kind;
    let trace = Traced {
        svg: r##"<svg xmlns="http://www.w3.org/2000/svg" width="60mm" height="40mm" viewBox="0 0 60 40">
            <rect id="narrow" x="2" y="2" width="21" height="2" fill="#a11936"/>
            <rect id="wide" x="7" y="8" width="24" height="24" fill="#262d61"/>
            <path id="fine" d="M38 12 L57 4" fill="none" stroke="#165c40" stroke-width="0.6"/>
        </svg>"##.into(),
        colors: vec![[161, 25, 54], [38, 45, 97], [22, 92, 64]],
        shapes: 2,
        lines: 1,
        method: "test",
    };
    let doc = digitize_trace(trace, "mixed geometry", &TraceOptions::default()).unwrap();
    let kinds = |doc: &crate::document::Document| {
        doc.shapes.iter().map(|shape| shape.params.kind).collect::<Vec<_>>()
    };
    assert_eq!(kinds(&doc), [Some(Kind::Satin), Some(Kind::Fill), Some(Kind::Run)]);
    let reopened = crate::document::Document::from_svg(&doc.to_svg().unwrap(), &doc.name, None).unwrap();
    assert_eq!(kinds(&doc), kinds(&reopened));
    assert!(doc.plan().stitch_count() > 0);
}

/// Trace `img` with `o`.
pub fn trace(img: &Image, o: &TraceOptions) -> Result<Traced> {
    let r = &img.raster;
    let width_mm = if o.width_mm.is_finite() && o.width_mm > 1.0 {
        o.width_mm
    } else {
        80.0
    };
    // Millimetres per pixel.
    let mm = width_mm / f64::from(r.width.max(1));
    let px = |v_mm: f64| (v_mm / mm).max(0.0);
    let detail = if o.detail.is_finite() {
        o.detail.clamp(0.0, 100.0)
    } else {
        60.0
    };
    let speck_area = px(o.speckle_mm.max(0.0)).powi(2);
    let colors = if (2..=10).contains(&o.colors) {
        Some(o.colors)
    } else {
        None
    };

    let color_params = |method_colors: Option<u32>| TraceParams {
        mode: Mode::Color,
        palette: if method_colors.is_some() {
            Palette::Limited
        } else {
            Palette::Automatic
        },
        colors: method_colors.unwrap_or(6),
        color_detail: 85.0,
        paths: detail,
        corners: 60.0,
        noise: speck_area.round().clamp(0.0, 1e6) as u32,
        ignore_white: o.remove_background,
        snap_curves_to_lines: false,
        fills: true,
        strokes: o.lines,
        stroke_width: px(o.line_width_mm).max(1.0),
        ..TraceParams::default()
    };
    // Estimate meaningful hue diversity independently of shading. Complex
    // illustrations need more thread colors than simple two-tone logos.
    let mut hue_bins = [0usize; 12];
    let mut opaque = 0usize;
    for p in r.rgba.chunks_exact(4) {
        if p[3] < 128 { continue; }
        opaque += 1;
        let (r,g,b) = (p[0] as f64,p[1] as f64,p[2] as f64);
        let max = r.max(g).max(b);
        let min = r.min(g).min(b);
        let delta = max-min;
        if delta < 35.0 || max < 45.0 { continue; }
        let h = if max == r { ((g-b)/delta).rem_euclid(6.0) }
            else if max == g { (b-r)/delta+2.0 } else { (r-g)/delta+4.0 };
        hue_bins[((h*2.0).floor() as usize).min(11)] += 1;
    }
    let diverse = hue_bins.iter().filter(|&&n| n > opaque / 100).count() >= 4;
    // Use the actual foreground palette to detect loss of meaningful accents.
    // A bounded histogram avoids letting antialiasing dominate the decision.
    let mut bins = [0usize; 4096];
    for p in r.rgba.chunks_exact(4) {
        if p[3] < 128 { continue; }
        let k = ((p[0] as usize >> 4) << 8) | ((p[1] as usize >> 4) << 4) | (p[2] as usize >> 4);
        bins[k] += 1;
    }
    let significant = bins.iter().filter(|&&n| n > opaque / 50).count();
    let auto_colors = if diverse || significant > 8 { 10 } else { 8 };
    let logo_params = TraceParams {
        mode: Mode::Logo,
        colors: colors.unwrap_or(auto_colors),
        paths: detail,
        corners: 50.0,
        // Logo mode drops areas under noise/10 px².
        noise: (speck_area * 5.0).round().clamp(0.0, 1e7) as u32,
        ignore_white: o.remove_background,
        snap_curves_to_lines: false,
        ..TraceParams::default()
    };

    // Flat Logo first (it has no centre lines); anything that isn't flat art
    // is posterized instead.
    let (mut result, method) = if o.lines {
        (run(r, &color_params(colors.or(Some(auto_colors))))?, "posterized")
    } else {
        match vectorcraft_trace::trace_within(r, &logo_params, MAX_ANCHORS) {
            Ok(t) => (t, "flat logo"),
            Err(TraceError::NotFlat { .. }) | Err(TraceError::TooComplex { .. }) => (run(r, &color_params(colors.or(Some(auto_colors))))?, "posterized"),
            Err(e) => return Err(explain(e)),
        }
    };
    // For automatic flat artwork, compare a richer candidate when the
    // source palette is poorly represented. Bound the work to one retry.
    if colors.is_none() && !o.lines && o.threads.is_empty() && auto_colors < 10 && significant >= 4 {
        let score = |t: &TraceResult| -> f64 {
            let palette: Vec<_> = t.paths.iter().map(|p| p.color).collect::<std::collections::HashSet<_>>().into_iter().collect();
            if palette.is_empty() { return f64::INFINITY; }
            let mut error = 0.0;
            let mut weight = 0.0;
            for (k, &n) in bins.iter().enumerate() {
                if n == 0 || n < opaque / 200 { continue; }
                let c = [(((k >> 8) & 15)*16+8) as u8, (((k >> 4) & 15)*16+8) as u8, ((k & 15)*16+8) as u8];
                let d = palette.iter().map(|&p| crate::formats::perceptual_distance(c,p)).fold(f64::INFINITY,f64::min);
                error += d * n as f64;
                weight += n as f64;
            }
            error / weight.max(1.0)
        };
        let baseline = score(&result);
        if baseline.is_finite() && baseline > 0.0 {
            let mut richer = if method == "flat logo" { logo_params.clone() } else { color_params(Some(10)) };
            richer.colors = 10;
            if let Ok(candidate) = run(r, &richer) {
                if !candidate.paths.is_empty() && candidate.paths.len() <= result.paths.len().saturating_mul(2) && score(&candidate) < baseline * 0.75 {
                    let baseline_svg = to_svg(&result, r, mm, &o.threads, o.remove_background, true, method);
                    let candidate_svg = to_svg(&candidate, r, mm, &o.threads, o.remove_background, true, method);
                    // Never trade spatial fidelity for a better palette alone.
                    if let (Some(before), Some(after)) = (
                        spatial_error(&baseline_svg.svg, r, o.remove_background),
                        spatial_error(&candidate_svg.svg, r, o.remove_background),
                    ) {
                        if after <= before { result = candidate; }
                    }
                }
            }
        }
    }
    Ok(to_svg(
        &result,
        r,
        mm,
        &o.threads,
        o.remove_background,
        o.colors == 0,
        method,
    ))
}


/** Compare the rendered trace against the source at a bounded resolution.
 * Foreground and background errors are balanced so large empty margins
 * cannot hide missing details. Returns None if rendering is unavailable.
 */
fn spatial_error(svg: &str, r: &Raster, remove_white: bool) -> Option<f64> {
    let longest = r.width.max(r.height);
    if longest == 0 || r.width == 0 || r.height == 0 { return None; }
    let scale = (192.0 / f64::from(longest)).min(1.0);
    let w = (f64::from(r.width) * scale).round().max(1.0) as u32;
    let h = (f64::from(r.height) * scale).round().max(1.0) as u32;
    let tree = usvg::Tree::from_str(svg, &usvg::Options::default()).ok()?;
    let size = tree.size();
    let mut pixmap = resvg::tiny_skia::Pixmap::new(w, h)?;
    let transform = resvg::tiny_skia::Transform::from_scale(
        w as f32 / size.width(), h as f32 / size.height());
    resvg::render(&tree, transform, &mut pixmap.as_mut());
    let mut errors = [0.0_f64; 2];
    let mut counts = [0_u64; 2];
    for y in 0..h {
        for x in 0..w {
            let sx = (((2 * u64::from(x) + 1) * u64::from(r.width)) / (2 * u64::from(w))) as usize;
            let sy = (((2 * u64::from(y) + 1) * u64::from(r.height)) / (2 * u64::from(h))) as usize;
            let i = (sy * r.width as usize + sx) * 4;
            let p = &r.rgba[i..i+4];
            let white = p[..3].iter().map(|&v| (255.0 - f64::from(v)).powi(2)).sum::<f64>() <= 900.0;
            let a = if remove_white && white { 0.0 } else { f64::from(p[3]) / 255.0 };
            let q = &pixmap.data()[((y*w+x)*4) as usize..((y*w+x)*4+4) as usize];
            let b = f64::from(q[3]) / 255.0;
            let group = usize::from(a >= 0.5);
            // tiny-skia pixels are premultiplied RGBA.
            let color = (0..3).map(|k| (f64::from(p[k])*a/255.0 - f64::from(q[k])/255.0).abs()).sum::<f64>() / 3.0;
            errors[group] += 0.5 * (a-b).abs() + 0.5 * color;
            counts[group] += 1;
        }
    }
    let mut sum = 0.0;
    let mut groups = 0;
    for k in 0..2 {
        if counts[k] > 0 { sum += errors[k] / counts[k] as f64; groups += 1; }
    }
    Some(sum / f64::from(groups))
}

fn run(r: &Raster, p: &TraceParams) -> Result<TraceResult> {
    vectorcraft_trace::trace_within(r, p, MAX_ANCHORS).map_err(explain)
}

fn explain(e: TraceError) -> anyhow::Error {
    match e {
        TraceError::TooComplex { .. } => anyhow!(
            "this image has too much detail to stitch. Try fewer colours, less detail or a bigger speck size, or start from a simpler logo"
        ),
        e => anyhow!("{e}"),
    }
}

fn nearest(c: [u8; 3], threads: &[[u8; 3]]) -> [u8; 3] {
    threads
        .iter()
        .copied()
        .min_by(|a, b| {
            crate::formats::perceptual_distance(c, *a)
                .total_cmp(&crate::formats::perceptual_distance(c, *b))
        })
        .unwrap_or(c)
}

/// SVG path data for a kurbo path, numbers to 3 decimal places.
fn svg_d(path: &kurbo::BezPath) -> String {
    use crate::bezier::write_num;
    use kurbo::PathEl;
    let mut d = String::new();
    let pt = |d: &mut String, p: kurbo::Point| {
        write_num(d, p.x);
        d.push(' ');
        write_num(d, p.y);
    };
    for el in path.elements() {
        if !d.is_empty() {
            d.push(' ');
        }
        match *el {
            PathEl::MoveTo(p) => {
                d.push('M');
                pt(&mut d, p);
            }
            PathEl::LineTo(p) => {
                d.push('L');
                pt(&mut d, p);
            }
            PathEl::QuadTo(a, p) => {
                d.push('Q');
                pt(&mut d, a);
                d.push(' ');
                pt(&mut d, p);
            }
            PathEl::CurveTo(a, b, p) => {
                d.push('C');
                pt(&mut d, a);
                d.push(' ');
                pt(&mut d, b);
                d.push(' ');
                pt(&mut d, p);
            }
            PathEl::ClosePath => d.push('Z'),
        }
    }
    d
}

fn to_svg(
    t: &TraceResult,
    r: &Raster,
    mm: f64,
    threads: &[[u8; 3]],
    remove_white: bool,
    consolidate: bool,
    method: &'static str,
) -> Traced {
    let (w, h) = (f64::from(r.width), f64::from(r.height));
    let mut body = String::new();
    let mut used: Vec<([u8; 3], usize)> = Vec::new();
    let (mut shapes, mut lines) = (0, 0);
    // Consolidate perceptually close thread shades, preferring the color
    // covering the most artwork. Keep neutral and chromatic colors separate.
    let mut palette: Vec<([u8; 3], usize)> = Vec::new();
    for p in &t.paths {
        if let Some(entry) = palette.iter_mut().find(|e| e.0 == p.color) {
            entry.1 += p.pixels;
        } else { palette.push((p.color, p.pixels)); }
    }
    palette.sort_by_key(|e| std::cmp::Reverse(e.1));
    let neutral = |c: [u8; 3]| c.iter().max().unwrap() - c.iter().min().unwrap() < 24;
    let mut representatives: Vec<[u8; 3]> = Vec::new();
    let mut mapping = std::collections::HashMap::new();
    for (c, _) in palette {
        let match_color = representatives.iter().copied().find(|&q| {
            neutral(c) == neutral(q) &&
            // Preserve dark ink and near-white highlights even when adjacent shades are close.
            (c.iter().max().unwrap() < &55) == (q.iter().max().unwrap() < &55) &&
            (c.iter().min().unwrap() > &225) == (q.iter().min().unwrap() > &225) &&
            c.iter().zip(q.iter()).map(|(&a,&b)| (f64::from(a)-f64::from(b)).powi(2)).sum::<f64>() <= 22.0_f64.powi(2)
        }).unwrap_or(c);
        if !representatives.contains(&match_color) { representatives.push(match_color); }
        mapping.insert(c, match_color);
    }
    let ink_mask = remove_white && r.rgba.chunks_exact(4).all(|px|px[3]<128 || px[..3].iter().all(|&v|v<32));
    for (k, p) in t.paths.iter().enumerate() {
        // Thousandths of a pixel: plenty, and a third the size of kurbo's
        // full-precision numbers (every parse, undo step and save is faster).
        let d = svg_d(&p.path.to_bezpath());
        // White parts of lines (inside lettering, say) are background too.
        // (Within 30 levels of white, as the tracer's own Ignore White.)
        let white = p
            .color
            .iter()
            .map(|&v| (255.0 - f64::from(v)).powi(2))
            .sum::<f64>()
            <= 900.0;
        if d.is_empty() || (remove_white && white && (p.stroke.is_some() || ink_mask)) {
            continue;
        }
        let c = nearest(if consolidate && threads.is_empty() { *mapping.get(&p.color).unwrap_or(&p.color) } else { p.color }, threads);
        match used.iter_mut().find(|(u, _)| *u == c) {
            Some(u) => u.1 += p.pixels,
            None => used.push((c, p.pixels)),
        }
        let hex = format!("#{:02x}{:02x}{:02x}", c[0], c[1], c[2]);
        match p.stroke {
            Some(sw) => {
                lines += 1;
                let cap = if p.square_caps { "square" } else { "round" };
                body.push_str(&format!(
                    "  <path id=\"trace_line_{k}\" d=\"{d}\" fill=\"none\" stroke=\"{hex}\" stroke-width=\"{sw:.2}\" stroke-linecap=\"{cap}\" stroke-linejoin=\"round\"/>\n"
                ));
            }
            None => {
                shapes += 1;
                body.push_str(&format!(
                    "  <path id=\"trace_{k}\" d=\"{d}\" fill=\"{hex}\"/>\n"
                ));
            }
        }
    }
    used.sort_by_key(|u| std::cmp::Reverse(u.1));
    let svg = format!(
        "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"{:.2}mm\" height=\"{:.2}mm\" viewBox=\"0 0 {w} {h}\">\n{body}</svg>\n",
        w * mm,
        h * mm,
    );
    Traced {
        svg,
        colors: used.into_iter().map(|u| u.0).collect(),
        shapes,
        lines,
        method,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A red disc and a blue bar on white, drawn in code.
    fn logo(w: u32, h: u32) -> Image {
        let raster = Raster::from_fn(w, h, |x, y| {
            let (fx, fy) = (x as f64 - w as f64 * 0.35, y as f64 - h as f64 * 0.5);
            if fx * fx + fy * fy < (h as f64 * 0.3).powi(2) {
                [220, 30, 40, 255]
            } else if x > w * 7 / 10 && x < w * 9 / 10 && y > h / 5 && y < h * 4 / 5 {
                [20, 60, 200, 255]
            } else {
                [255, 255, 255, 255]
            }
        });
        Image { raster }
    }

    #[test]
    fn a_flat_logo_traces_to_its_colours_at_the_asked_size() {
        let t = trace(&logo(200, 100), &TraceOptions::default()).unwrap();
        assert_eq!(t.method, "flat logo");
        assert_eq!(t.colors.len(), 2, "{:?}", t.colors);
        assert_eq!(t.shapes, 2);
        assert!(
            t.svg.contains("width=\"80.00mm\" height=\"40.00mm\""),
            "{}",
            t.svg
        );
        // It opens as a document with two filled objects.
        let d = crate::document::Document::from_svg(&t.svg, "logo", None).unwrap();
        assert_eq!(d.shapes.len(), 2);
        let b = crate::svg::shapes_bounds(&d.shapes);
        assert!(b.width() > 400.0 && b.width() < 800.0, "{b:?}");
    }

    #[test]
    fn colours_snap_to_the_threads_given() {
        let threads = vec![[0, 0, 0], [200, 0, 0], [0, 0, 180]];
        let o = TraceOptions {
            threads: threads.clone(),
            ..TraceOptions::default()
        };
        let t = trace(&logo(200, 100), &o).unwrap();
        assert!(
            t.colors.iter().all(|c| threads.contains(c)),
            "{:?}",
            t.colors
        );
        assert!(t.svg.contains("#c80000") && t.svg.contains("#0000b4"));
    }

    #[test]
    fn keeping_the_background_traces_white_too() {
        let o = TraceOptions {
            remove_background: false,
            ..TraceOptions::default()
        };
        let t = trace(&logo(200, 100), &o).unwrap();
        assert!(t.colors.contains(&[255, 255, 255]), "{:?}", t.colors);
    }

    #[test]
    fn thin_lines_become_stroked_lines() {
        // A 3 px black line on white, with a solid block.
        let raster = Raster::from_fn(200, 100, |x, y| {
            if (48..51).contains(&y) && (10..120).contains(&x) {
                [0, 0, 0, 255]
            } else if (160..164).contains(&x) && (30..70).contains(&y) {
                // A thin white bar cut into the block: background, not a line.
                [255, 255, 255, 255]
            } else if x > 140 && x < 190 && y > 20 && y < 80 {
                [0, 0, 0, 255]
            } else {
                [255, 255, 255, 255]
            }
        });
        let o = TraceOptions {
            lines: true,
            // 200 px = 80 mm: 3 px is 1.2 mm.
            line_width_mm: 2.0,
            ..TraceOptions::default()
        };
        let t = trace(&Image { raster }, &o).unwrap();
        assert!(t.lines >= 1, "{}", t.svg);
        assert!(
            !t.colors.iter().any(|c| c.iter().all(|&v| v > 200)),
            "no white lines: {:?}",
            t.colors
        );
        assert!(t.shapes >= 1, "{}", t.svg);
        let d = crate::document::Document::from_svg(&t.svg, "lines", None).unwrap();
        assert!(
            d.shapes
                .iter()
                .any(|s| matches!(s.geometry, crate::svg::Geometry::Stroke { .. }))
        );
    }

    #[test]
    fn a_photo_is_posterized_not_refused() {
        let raster = Raster::from_fn(96, 64, |x, y| {
            [(x * 2) as u8, (255 - y * 3) as u8, ((x + y) * 2) as u8, 255]
        });
        let o = TraceOptions {
            colors: 4,
            remove_background: false,
            ..TraceOptions::default()
        };
        let t = trace(&Image { raster }, &o).unwrap();
        assert_eq!(t.method, "posterized");
        assert!(
            !t.colors.is_empty() && t.colors.len() <= 4,
            "{:?}",
            t.colors
        );
    }

    #[test]
    fn edge_background_preserves_enclosed_white(){
        let r=Raster::from_fn(20,20,|x,y|if x<3||y<3||x>=17||y>=17||(x>=8&&x<12&&y>=8&&y<12){[250,250,250,255]}else{[180,20,40,255]});
        let out=remove_edge_background(&r,24);
        assert_eq!(out.rgba[3],0);
        assert_eq!(out.rgba[(10*20+10)*4+3],255);
        assert_eq!(out.rgba[(5*20+5)*4+3],255);
    }
    #[test]
    fn transparent_logo_keeps_edge_foreground(){
        let r=Raster::from_fn(30,30,|x,y|if x<3&&(10..20).contains(&y){[180,20,40,255]}else{[0,0,0,0]});
        let out=remove_edge_background(&r,32);
        assert_eq!(out.rgba[(15*30)*4+3],255);
    }
    #[test]
    fn median_does_not_bleed_transparent_background_into_foreground(){
        let r=Raster::from_fn(5,5,|x,y|if x==2&&y==2{[180,20,40,255]}else{[255,255,255,0]});
        let out=median_texture(&r,false);
        assert_eq!(&out.rgba[(2*5+2)*4..(2*5+2)*4+4],&[180,20,40,255]);
    }
    #[test]
    fn spatial_score_penalizes_shifted_artwork() {
        let r = Raster::from_fn(64, 32, |x, _| {
            if x < 24 { [255, 0, 0, 255] } else { [0, 0, 0, 0] }
        });
        let good = r##"<svg xmlns="http://www.w3.org/2000/svg" width="64" height="32"><rect width="24" height="32" fill="#ff0000"/></svg>"##;
        let bad = r##"<svg xmlns="http://www.w3.org/2000/svg" width="64" height="32"><rect x="32" width="24" height="32" fill="#ff0000"/></svg>"##;
        assert!(spatial_error(good, &r, false).unwrap() < 0.01);
        assert!(spatial_error(bad, &r, false).unwrap() > 0.2);
    }

    #[test]
    fn garbage_is_an_error() {
        assert!(trace_bytes(b"not an image", &TraceOptions::default()).is_err());
    }
}

#[test]
fn clean_character_palette_retains_distinct_shades(){
 let r=Raster::from_fn(160,100,|x,y|{
 if !(10..150).contains(&x)||!(10..90).contains(&y){return [0,0,0,0]}
 match x {10..=44=>[20,70,150,255],45..=79=>[90,170,240,255],80..=114=>[245,210,150,255],_=>[35,30,40,255]}
 });
 let r=trim_transparent_margin(&prepare_raster(&r,true,32,false));
 let t=trace(&Image{raster:r},&TraceOptions{remove_background:false,colors:4,..Default::default()}).unwrap();
 assert!(t.colors.len()>=4,"distinct colors lost: {:?}",t.colors);
 assert!(t.shapes>=4);
}
