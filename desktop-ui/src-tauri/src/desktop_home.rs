use super::{
    Workspace, project_recovery,
    workspace_tabs::{WorkspaceTabs, recovery_directory},
};
use std::sync::Mutex;
use tauri::Manager;

#[derive(serde::Serialize)]
pub(super) struct WorkspaceOverview {
    current: Option<String>,
    recovery: bool,
}

#[tauri::command]
pub(super) fn workspace_overview(
    app: tauri::AppHandle,
    state: tauri::State<'_, Mutex<Workspace>>,
    tabs: tauri::State<'_, Mutex<WorkspaceTabs>>,
) -> Result<WorkspaceOverview, String> {
    let tabs = tabs.lock().map_err(|error| error.to_string())?;
    let workspace = state.lock().map_err(|error| error.to_string())?;
    let current = workspace
        .current
        .as_ref()
        .filter(|design| design.blocks.iter().any(|block| !block.runs.is_empty()))
        .map(|design| design.name.clone());
    let recovery = app.path().app_local_data_dir().is_ok_and(|root| {
        recovery_directory(&root, tabs.active())
            .is_ok_and(|directory| project_recovery::available(&directory))
    });
    Ok(WorkspaceOverview { current, recovery })
}

fn start_blank(workspace: &mut Workspace) {
    if workspace
        .current
        .as_ref()
        .is_some_and(|design| design.blocks.is_empty())
    {
        return;
    }
    workspace.checkpoint_named("Start blank design");
    let mut document = zigzag::document::Document::empty();
    document.name = "Untitled design".into();
    workspace.current = Some(document.plan());
    workspace.source = Some(document);
    workspace.plan_cache = Default::default();
    workspace.simplify_draft = None;
    workspace.digitizer_draft = None;
}

#[tauri::command]
pub(super) fn new_blank_design(state: tauri::State<'_, Mutex<Workspace>>) -> Result<(), String> {
    let mut workspace = state.lock().map_err(|error| error.to_string())?;
    if workspace.simplify_job.is_some() {
        return Err("Wait for the current stitch preview to finish.".into());
    }
    start_blank(&mut workspace);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use zigzag::{document::Document, formats::dst::write_dst};

    #[test]
    fn starting_blank_preserves_the_previous_design_for_undo() {
        let mut workspace = Workspace::default();
        let document = Document::from_svg(
            r#"<svg xmlns="http://www.w3.org/2000/svg" width="20mm" height="20mm"><rect width="40" height="40" fill="red"/></svg>"#,
            "Existing project", None,
        ).unwrap();
        let original = document.plan();
        let bytes = write_dst(&original);
        workspace.source = Some(document);
        workspace.current = Some(original);
        start_blank(&mut workspace);
        assert_eq!(workspace.current.as_ref().unwrap().stitch_count(), 0);
        assert_eq!(workspace.undo_labels, ["Start blank design"]);
        assert_eq!(write_dst(&workspace.undo[0].0), bytes);
        assert_eq!(
            workspace.undo[0].1.as_ref().unwrap().name,
            "Existing project"
        );
    }
}
