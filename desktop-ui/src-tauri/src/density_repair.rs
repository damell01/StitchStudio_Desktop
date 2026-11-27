use std::sync::Mutex;

use tauri::Manager;
use zigzag::{design::Design, document::Document, params::Kind, svg::Geometry};

use crate::{Preview, Workspace, local_coverage_preserved, optimization_quality, preview,
    production_not_worse, same_stitch_plan, validate_resized_design};

type Cell = [i32; 2];

pub(super) struct DensityDraft {
    id: u64,
    original: Design,
    source_svg: String,
    document: Document,
    repaired: Design,
    label: &'static str,
}

#[derive(serde::Serialize)]
pub(super) struct DensityReview {
    id: u64,
    before: Preview,
    after: Preview,
    hits_before: usize,
    hits_after: usize,
    footprint_overlap: f64,
}

fn cell_hits(design: &Design, [x, y]: Cell) -> usize {
    design.blocks.iter().flat_map(|block| &block.runs).flat_map(|run| &run.pts)
        .filter(|point| (point.x / 10.0).floor() == f64::from(x)
            && (point.y / 10.0).floor() == f64::from(y))
        .count()
}

fn candidate(source: &Document, original: &Design, cell: Cell, uids: &[usize]) -> Option<(Document, Design, usize, f64)> {
    let base_hits = cell_hits(original, cell);
    if base_hits < 24 || original.stitch_count() > 100_000 || source.shapes.len() > 350 { return None; }
    let mut best: Option<(Document, Design, usize, f64)> = None;
    for step in [0.02, 0.04, 0.06] {
        let mut document = source.clone();
        let fabric = document.plan_options().fabric;
        let mut changed = false;
        for (index, shape) in source.shapes.iter().enumerate() {
            if !uids.contains(&shape.uid) || source.records_text(index)
                || shape.groups.iter().any(|group| group.starts_with("tl-lettering-") || group == "tl-small-ink-detail")
                || shape.params.kind.unwrap_or(Kind::Fill) != Kind::Fill
                || shape.params.stop == Some(true) || shape.params.trim == Some(true)
                || source.layer_properties(&shape.id).is_some_and(|layer| layer.hidden || layer.locked)
                || source.shapes.iter().filter(|part| part.id == shape.id).count() != 1 { continue; }
            let Geometry::Fill { rings, rule } = &shape.geometry else { continue; };
            let b = zigzag::svg::shapes_bounds(std::slice::from_ref(shape));
            let x = f64::from(cell[0]) * 10.0;
            let y = f64::from(cell[1]) * 10.0;
            if b.min.x > x + 10.0 || b.max.x < x || b.min.y > y + 10.0 || b.max.y < y
                || b.width().min(b.height()) < 50.0 { continue; }
            let covers_cell = [2.5, 5.0, 7.5].into_iter().any(|dx| [2.5, 5.0, 7.5].into_iter().any(|dy|
                zigzag::geom::point_inside(rings, *rule, zigzag::geom::P::new(x + dx, y + dy))));
            if !covers_cell { continue; }
            let spacing = shape.params.fill_spacing(&fabric);
            let ceiling = (fabric.fill_spacing * 1.15).clamp(0.40, 0.60);
            let next = (spacing + step).min(ceiling);
            if next > spacing + 0.001 {
                document.shapes[index].params.spacing = Some(next);
                changed = true;
            }
        }
        if !changed || document.sync().is_err() { continue; }
        let design = document.plan();
        let hits = cell_hits(&design, cell);
        if hits >= base_hits || design.trim_count() > original.trim_count()
            || design.stitch_count() >= original.stitch_count()
            || !original.blocks.iter().map(|block| block.color).eq(design.blocks.iter().map(|block| block.color))
            || original.per_shape.len() != design.per_shape.len()
            || original.per_shape.iter().zip(&design.per_shape).any(|(&a, &b)| a > 0 && b == 0)
            || validate_resized_design(&design).is_err()
            || !production_not_worse(original, &design)
            || !local_coverage_preserved(original, &design) { continue; }
        let overlap = optimization_quality(original, &design, 800.0, 3.0).coverage;
        if overlap >= 95.0 && best.as_ref().is_none_or(|(_, old, previous_hits, _)|
            (hits, design.stitch_count()) < (*previous_hits, old.stitch_count())) {
            best = Some((document, design, hits, overlap));
        }
    }
    best
}

#[tauri::command]
pub(super) async fn preview_density_repair(cell: Cell, uids: Vec<usize>, app: tauri::AppHandle) -> Result<DensityReview, String> {
    tauri::async_runtime::spawn_blocking(move || {
        if uids.is_empty() || uids.len() > 350 { return Err("Select editable fill objects near the hotspot.".into()); }
        let tabs = app.state::<Mutex<crate::workspace_tabs::WorkspaceTabs>>();
        let state = app.state::<Mutex<Workspace>>();
        let (tab, source, original) = {
            let tabs = tabs.lock().map_err(|error| error.to_string())?;
            let w = state.lock().map_err(|error| error.to_string())?;
            (tabs.active().to_owned(), w.source.clone().ok_or("Density repair needs editable artwork.")?,
                w.current.clone().ok_or("Open a design first.")?)
        };
        let source_svg = source.to_svg().map_err(|error| error.to_string())?;
        let (document, repaired, hits_after, footprint_overlap) = candidate(&source, &original, cell, &uids)
            .ok_or("No local repair passed the density, coverage and stitching checks.")?;
        let tabs = tabs.lock().map_err(|error| error.to_string())?;
        let mut w = state.lock().map_err(|error| error.to_string())?;
        if tabs.active() != tab.as_str() || !matches_source(&w, &original, &source_svg) {
            return Err("The design changed. Generate a new repair preview.".into());
        }
        let before = preview(&original);
        let after = preview(&repaired);
        let hits_before = cell_hits(&original, cell);
        let id = stage(&mut w, original, source_svg, document, repaired, "Repair local density");
        Ok(DensityReview { id, before, after, hits_before, hits_after, footprint_overlap })
    }).await.map_err(|error| error.to_string())?
}

pub(super) fn matches_source(workspace: &Workspace, original: &Design, source_svg: &str) -> bool {
    workspace.current.as_ref().is_some_and(|plan| same_stitch_plan(plan, original))
        && workspace.source.as_ref().and_then(|source| source.to_svg().ok()).as_deref() == Some(source_svg)
}

pub(super) fn stage(workspace: &mut Workspace, original: Design, source_svg: String, document: Document, repaired: Design, label: &'static str) -> u64 {
    workspace.next_draft_id = workspace.next_draft_id.wrapping_add(1);
    let id = workspace.next_draft_id;
    workspace.density_draft = Some(DensityDraft { id, original, source_svg, document, repaired, label });
    id
}

#[tauri::command]
pub(super) fn apply_density_repair(id: u64, state: tauri::State<'_, Mutex<Workspace>>) -> Result<Preview, String> {
    let mut workspace = state.lock().map_err(|error| error.to_string())?;
    let draft = workspace.density_draft.as_ref().filter(|draft| draft.id == id)
        .ok_or("Generate a quality repair preview first.")?;
    if !matches_source(&workspace, &draft.original, &draft.source_svg) {
        return Err("The design changed. Generate a new repair preview.".into());
    }
    let draft = workspace.density_draft.take().ok_or("The preview is unavailable.")?;
    let result = preview(&draft.repaired);
    workspace.checkpoint_named(draft.label);
    workspace.source = Some(draft.document);
    workspace.current = Some(draft.repaired);
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    use zigzag::{design::{Block, Run}, geom::P};

    #[test]
    fn needle_cells_use_half_open_millimeter_coordinates() {
        let plan = Design {
            blocks: vec![Block { color: [0; 3], runs: vec![Run {
                pts: vec![P::new(-10.0, 0.0), P::new(-0.5, 9.9), P::new(0.0, 0.0), P::new(0.0, 10.0)],
                trim_before: false,
            }] }],
            ..Design::default()
        };
        assert_eq!(cell_hits(&plan, [-1, 0]), 2);
        assert_eq!(cell_hits(&plan, [0, 0]), 1);
        assert_eq!(cell_hits(&plan, [0, 1]), 1);
    }

    #[test]
    fn a_preview_cannot_replace_changed_source_with_the_same_stitch_plan() {
        let source = Document::empty();
        let original = source.plan();
        let svg = source.to_svg().unwrap();
        let mut w = Workspace { current: Some(original.clone()), source: Some(source), ..Workspace::default() };
        assert!(matches_source(&w, &original, &svg));
        w.source.as_mut().unwrap().settings.fabric = "denim".into();
        assert!(!matches_source(&w, &original, &svg));
    }
}
