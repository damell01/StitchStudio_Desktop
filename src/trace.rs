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
    /// Leave out the white background (and other white areas).
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
    let w=r.width as usize; let h=r.height as usize;
    if w==0 || h==0 {return r.clone();}
    let mut bins=std::collections::BTreeMap::<[u8;3],usize>::new();
    for y in 0..h {for x in 0..w {
        if x!=0 && y!=0 && x+1!=w && y+1!=h {continue}
        let i=(y*w+x)*4;
        if r.rgba[i+3]<32 {continue}
        let key=[r.rgba[i]/16,r.rgba[i+1]/16,r.rgba[i+2]/16];
        *bins.entry(key).or_default()+=1;
    }}
    let opaque_border:usize=bins.values().sum();
    let border=w.saturating_mul(2).saturating_add(h.saturating_mul(2)).saturating_sub(4).max(1);
    // Already transparent artwork must not lose opaque foreground touching an edge.
    if opaque_border*2<border{return r.clone();}
    let bg=bins.into_iter().filter(|(_,n)|*n*5>=opaque_border).max_by_key(|(_,n)|*n).map(|(c,_)|c.map(|v|v*16+8));
    let mut seen=vec![false;w*h];let mut queue=std::collections::VecDeque::new();
    let matches=|p:usize| {let i=p*4;r.rgba[i+3]<32 || bg.is_some_and(|c|(0..3).all(|k|r.rgba[i+k].abs_diff(c[k])<=tolerance))};
    let mut push=|p:usize,seen:&mut Vec<bool>,q:&mut std::collections::VecDeque<usize>|{if !seen[p]&&matches(p){seen[p]=true;q.push_back(p)}};
    for x in 0..w {push(x,&mut seen,&mut queue);push((h-1)*w+x,&mut seen,&mut queue)}
    for y in 0..h {push(y*w,&mut seen,&mut queue);push(y*w+w-1,&mut seen,&mut queue)}
    while let Some(p)=queue.pop_front(){let x=p%w;let y=p/w;
        if x>0{push(p-1,&mut seen,&mut queue)}if x+1<w{push(p+1,&mut seen,&mut queue)}
        if y>0{push(p-w,&mut seen,&mut queue)}if y+1<h{push(p+w,&mut seen,&mut queue)}
    }
    Raster::from_fn(r.width,r.height,|x,y|{let p=y as usize*w+x as usize;let i=p*4;[r.rgba[i],r.rgba[i+1],r.rgba[i+2],if seen[p]{0}else{r.rgba[i+3]}]})
}

// Shared preprocessing pipeline for tracing and future pixel preview.
fn prepare_raster(r:&Raster,remove_background:bool,tolerance:u8,cleanup:bool)->Raster{
    // Suppress fabric texture before edge flood fill, preserving the original alpha.
    let cleaned=if cleanup {median_texture(&median_texture(r,false),false)}else{r.clone()};
    if remove_background {remove_edge_background(&cleaned,tolerance)}else{cleaned}
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

/// Return the same preprocessed pixels used by automatic tracing, before cropping.
pub fn prepared_pixels(bytes:&[u8],remove_background:bool,tolerance:u8,cleanup:bool)->Result<(u32,u32,Vec<u8>)>{
    let image=Image::decode(bytes)?;
    let r=prepare_raster(&image.raster,remove_background,tolerance,cleanup);
    Ok((r.width,r.height,r.rgba.to_vec()))
}

pub fn trace_prepared_bytes(bytes:&[u8],o:&TraceOptions,tolerance:u8,cleanup:bool)->Result<Traced>{
    let image=Image::decode(bytes)?;
    let raster=prepare_raster(&image.raster,o.remove_background,tolerance,cleanup);
    let mut options=o.clone();options.remove_background=false;
    if cleanup {options.speckle_mm=options.speckle_mm.max(0.6); if options.colors==0 {options.colors=5;}}
    let raster=trim_transparent_margin(&raster);
    // Preserve clean outlines by preferring logo tracing; retry complex artwork with fewer anchors.
    let prepared=Image{raster};
    match trace(&prepared,&options) {
        Ok(t)=>Ok(t),
        Err(first)=>{
            let mut fallback=options.clone();
            fallback.detail=fallback.detail.min(40.0);
            fallback.speckle_mm=fallback.speckle_mm.max(1.5);
            if fallback.colors==0 {fallback.colors=6;}
            trace(&prepared,&fallback).map_err(|second|anyhow!("Automatic trace failed: {first}; simplified retry: {second}"))
        }
    }
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
        let mut k=0;
        let center=(y as usize*r.width as usize+x as usize)*4;
        if r.rgba[center+3]<32{return [0,0,0,0];}
        for dy in -1i64..=1 { for dx in -1i64..=1 {
            let xx=(i64::from(x)+dx).clamp(0,i64::from(r.width)-1) as usize;
            let yy=(i64::from(y)+dy).clamp(0,i64::from(r.height)-1) as usize;
            let i=(yy*r.width as usize+xx)*4;
            for ch in 0..3 {channels[ch][k]=if r.rgba[i+3]<32{r.rgba[center+ch]}else{r.rgba[i+ch]};}
            k+=1;
        }}
        for ch in &mut channels {ch.sort_unstable();}
        let mut rgb=[channels[0][4],channels[1][4],channels[2][4]];
        let lo=*rgb.iter().min().unwrap();
        let hi=*rgb.iter().max().unwrap();
        if remove_white && lo>=218 && hi-lo<=20 {rgb=[255;3];}
        let alpha=r.rgba[(y as usize*r.width as usize+x as usize)*4+3];
        [rgb[0],rgb[1],rgb[2],alpha]
    })
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
        snap_curves_to_lines: true,
        fills: true,
        strokes: o.lines,
        stroke_width: px(o.line_width_mm).max(1.0),
        ..TraceParams::default()
    };
    let logo_params = TraceParams {
        mode: Mode::Logo,
        colors: colors.unwrap_or(8),
        paths: detail,
        corners: 50.0,
        // Logo mode drops areas under noise/10 px².
        noise: (speck_area * 10.0).round().clamp(0.0, 1e7) as u32,
        ignore_white: o.remove_background,
        snap_curves_to_lines: true,
        ..TraceParams::default()
    };

    // Flat Logo first (it has no centre lines); anything that isn't flat art
    // is posterized instead.
    let (result, method) = if o.lines {
        (run(r, &color_params(colors))?, "posterized")
    } else {
        match vectorcraft_trace::trace_within(r, &logo_params, MAX_ANCHORS) {
            Ok(t) => (t, "flat logo"),
            Err(TraceError::NotFlat { .. }) => (run(r, &color_params(colors))?, "posterized"),
            Err(e) => return Err(explain(e)),
        }
    };
    Ok(to_svg(
        &result,
        r,
        mm,
        &o.threads,
        o.remove_background,
        method,
    ))
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
    method: &'static str,
) -> Traced {
    let (w, h) = (f64::from(r.width), f64::from(r.height));
    let mut body = String::new();
    let mut used: Vec<([u8; 3], usize)> = Vec::new();
    let (mut shapes, mut lines) = (0, 0);
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
        if d.is_empty() || (remove_white && white && p.stroke.is_some()) {
            continue;
        }
        let c = nearest(p.color, threads);
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
    fn garbage_is_an_error() {
        assert!(trace_bytes(b"not an image", &TraceOptions::default()).is_err());
    }
}
