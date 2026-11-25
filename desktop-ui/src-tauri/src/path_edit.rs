use crate::{Preview, Workspace, preview};
use std::hash::{DefaultHasher, Hash, Hasher};
use zigzag::{
    bezier::{Anchor, BezPath, SubPath},
    document::Document,
    geom::P,
    params::Kind,
};

const MAX_NODES: usize = 12_000;
const MAX_MM: f64 = 5_000.0;

#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
pub(super) struct Node {
    p: [f64; 2],
    incoming: [f64; 2],
    outgoing: [f64; 2],
}

#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
pub(super) struct Path {
    closed: bool,
    nodes: Vec<Node>,
}

#[derive(serde::Serialize)]
pub(super) struct ObjectPath {
    revision: String,
    manual: bool,
    paths: Vec<Path>,
}

fn millimeters(p: P) -> [f64; 2] {
    [p.x / 10.0, p.y / 10.0]
}

fn design_units([x, y]: [f64; 2]) -> P {
    P::new(x * 10.0, y * 10.0)
}

fn load_path(document: &Document, uid: usize) -> Result<(usize, ObjectPath), String> {
    let index = document
        .shapes
        .iter()
        .position(|shape| shape.uid == uid)
        .ok_or("The selected object is no longer available.")?;
    if document.lettering(index).is_some() {
        return Err("Use Edit lettering to change this text object.".into());
    }
    let shape = &document.shapes[index];
    if document
        .layer_properties(&shape.id)
        .is_some_and(|layer| layer.locked || layer.hidden)
    {
        return Err("Unlock and show this layer before editing its points.".into());
    }
    let manual = shape.params.kind == Some(Kind::Manual);
    let path = document
        .edit_path(index)
        .map_err(|error| error.to_string())?;
    if path.is_empty() || path.iter().map(|part| part.anchors.len()).sum::<usize>() > MAX_NODES {
        return Err(
            "This object has no editable points or exceeds the 12,000-point editing limit.".into(),
        );
    }
    let mut revision = DefaultHasher::new();
    uid.hash(&mut revision);
    shape.id.hash(&mut revision);
    shape.color.hash(&mut revision);
    manual.hash(&mut revision);
    let paths = path
        .into_iter()
        .map(|part| {
            part.closed.hash(&mut revision);
            part.anchors.len().hash(&mut revision);
            let nodes = part
                .anchors
                .into_iter()
                .map(|anchor| {
                    let node = Node {
                        p: millimeters(anchor.p),
                        incoming: millimeters(anchor.h_in),
                        outgoing: millimeters(anchor.h_out),
                    };
                    for coordinate in node.p.into_iter().chain(node.incoming).chain(node.outgoing) {
                        coordinate.to_bits().hash(&mut revision);
                    }
                    node
                })
                .collect();
            Path {
                closed: part.closed,
                nodes,
            }
        })
        .collect();
    Ok((
        index,
        ObjectPath {
            revision: format!("{:016x}", revision.finish()),
            manual,
            paths,
        },
    ))
}

fn checked_path(current: &ObjectPath, paths: Vec<Path>) -> Result<BezPath, String> {
    if paths.len() != current.paths.len()
        || paths.iter().map(|part| part.nodes.len()).sum::<usize>() > MAX_NODES
    {
        return Err("Keep the original path sections and use at most 12,000 points.".into());
    }
    paths
        .into_iter()
        .zip(&current.paths)
        .map(|(part, original)| {
            let minimum = if part.closed && original.nodes.len() >= 3 {
                3
            } else {
                2
            };
            if part.closed != original.closed || part.nodes.len() < minimum {
                return Err(format!(
                    "Keep at least {minimum} points in this path section."
                ));
            }
            let anchors = part
                .nodes
                .into_iter()
                .map(|node| {
                    let valid = node
                        .p
                        .into_iter()
                        .chain(node.incoming)
                        .chain(node.outgoing)
                        .all(|value| value.is_finite() && value.abs() <= MAX_MM);
                    if !valid {
                        return Err("Enter point coordinates between −5,000 and 5,000 mm.".into());
                    }
                    if current.manual && (node.p != node.incoming || node.p != node.outgoing) {
                        return Err("Fixed needle positions use straight segments.".into());
                    }
                    Ok(Anchor {
                        p: design_units(node.p),
                        h_in: design_units(node.incoming),
                        h_out: design_units(node.outgoing),
                    })
                })
                .collect::<Result<_, String>>()?;
            Ok(SubPath {
                closed: part.closed,
                anchors,
            })
        })
        .collect()
}

fn apply_path(
    workspace: &mut Workspace,
    uid: usize,
    revision: &str,
    paths: Vec<Path>,
) -> Result<Preview, String> {
    let mut document = workspace
        .source
        .clone()
        .ok_or("Open editable artwork or an embroidery design first.")?;
    let (index, current) = load_path(&document, uid)?;
    if current.revision != revision {
        return Err(
            "This object changed. Close and reopen the point editor to load the current points."
                .into(),
        );
    }
    if current.paths == paths {
        return workspace
            .current
            .as_ref()
            .map(preview)
            .ok_or_else(|| "Open a design first.".into());
    }
    let edited = checked_path(&current, paths)?;
    document
        .set_path(index, &edited)
        .map_err(|error| error.to_string())?;
    if !document.shapes.iter().any(|shape| shape.uid == uid) {
        return Err(
            "The edit would remove the selected object. Keep points separated and try again."
                .into(),
        );
    }
    let design = document.plan_cached(&mut workspace.plan_cache);
    if !(1..=2_000_000).contains(&design.stitch_count()) {
        return Err("The edit produced an empty or excessively large stitch plan.".into());
    }
    let result = preview(&design);
    workspace.checkpoint_named(if current.manual {
        "Edit stitch points"
    } else {
        "Edit artwork nodes"
    });
    workspace.source = Some(document);
    workspace.current = Some(design);
    Ok(result)
}

#[tauri::command]
pub(super) fn artwork_path(
    uid: usize,
    state: tauri::State<'_, std::sync::Mutex<Workspace>>,
) -> Result<ObjectPath, String> {
    let workspace = state.lock().map_err(|error| error.to_string())?;
    let document = workspace
        .source
        .as_ref()
        .ok_or("Open editable artwork or an embroidery design first.")?;
    load_path(document, uid).map(|(_, path)| path)
}

#[tauri::command]
pub(super) async fn update_artwork_path(
    uid: usize,
    revision: String,
    paths: Vec<Path>,
    app: tauri::AppHandle,
) -> Result<Preview, String> {
    use tauri::Manager;
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<std::sync::Mutex<Workspace>>();
        let mut workspace = state.lock().map_err(|error| error.to_string())?;
        apply_path(&mut workspace, uid, &revision, paths)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use zigzag::formats::dst::write_dst;

    fn workspace() -> Workspace {
        let svg = r##"<svg xmlns="http://www.w3.org/2000/svg" width="40mm" height="30mm" viewBox="0 0 40 30">
          <path id="artwork" d="M 2 2 C 8 0 10 3 12 9 L 2 9 Z" fill="#cc7722"/>
          <path id="stitches_1_1_manual_trim" d="M 13 21 L 15 21 L 17 21 L 19 21" fill="none" stroke="#334466"/>
          <path id="stitches_1_2_manual_stop" d="M 22 21 L 24 21 L 26 21 L 28 21" fill="none" stroke="#334466"/>
          <path id="stitches_2_1_manual" d="M 22 25 L 24 25 L 26 25 L 28 25" fill="none" stroke="#334466"/>
        </svg>"##;
        let document = Document::from_svg(svg, "Point editing", None).unwrap();
        Workspace {
            current: Some(document.plan()),
            source: Some(document),
            ..Default::default()
        }
    }

    #[test]
    fn moves_vector_nodes_and_handles_with_named_undo_and_rejects_stale_edits() {
        let mut workspace = workspace();
        let document = workspace.source.as_ref().unwrap();
        let uid = document.shapes[0].uid;
        let (_, mut loaded) = load_path(document, uid).unwrap();
        assert!(!loaded.manual);
        assert_ne!(
            loaded.paths[0].nodes[0].p,
            loaded.paths[0].nodes[0].outgoing
        );
        let before = write_dst(workspace.current.as_ref().unwrap());
        let node = &mut loaded.paths[0].nodes[0];
        node.p[0] += 1.0;
        node.incoming[0] += 1.0;
        node.outgoing[0] += 2.0;
        apply_path(&mut workspace, uid, &loaded.revision, loaded.paths.clone()).unwrap();
        assert_eq!(workspace.undo_labels, ["Edit artwork nodes"]);
        assert_eq!(write_dst(&workspace.undo[0].0), before);
        let after = write_dst(workspace.current.as_ref().unwrap());
        assert_ne!(after, before);
        assert!(
            apply_path(&mut workspace, uid, &loaded.revision, loaded.paths)
                .err()
                .unwrap()
                .contains("changed")
        );
        assert_eq!(write_dst(workspace.current.as_ref().unwrap()), after);
        assert_eq!(workspace.undo.len(), 1);
    }

    #[test]
    fn erases_one_fixed_needle_position_without_changing_other_runs_or_boundaries() {
        let mut workspace = workspace();
        let document = workspace.source.as_ref().unwrap();
        let uid = document
            .shapes
            .iter()
            .find(|shape| shape.id.contains("1_1"))
            .unwrap()
            .uid;
        let (_, mut loaded) = load_path(document, uid).unwrap();
        assert!(loaded.manual);
        let before = workspace.current.clone().unwrap();
        let original_count = before.stitch_count();
        loaded.paths[0].nodes.remove(1);
        apply_path(&mut workspace, uid, &loaded.revision, loaded.paths).unwrap();
        let after = workspace.current.as_ref().unwrap();
        assert_eq!(workspace.undo_labels, ["Edit stitch points"]);
        assert_eq!(after.stitch_count(), original_count - 1);
        assert_eq!(after.blocks.len(), before.blocks.len());
        for (after_block, before_block) in after.blocks.iter().zip(before.blocks) {
            assert_eq!(
                (after_block.color, after_block.runs.len()),
                (before_block.color, before_block.runs.len())
            );
            for (after_run, before_run) in after_block.runs.iter().zip(before_block.runs) {
                assert_eq!(after_run.trim_before, before_run.trim_before);
                if before_run.pts.len() == after_run.pts.len() {
                    assert_eq!(before_run.pts, after_run.pts);
                }
            }
        }
    }
}
