use super::{OpenedProject, Workspace, project_recovery};
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::Mutex,
};
use tauri::Manager;
use uuid::Uuid;

const FIRST: &str = "primary";
const LIMIT: usize = 6;

pub(super) struct WorkspaceTabs {
    active: String,
    order: Vec<String>,
    parked: HashMap<String, Workspace>,
}

impl Default for WorkspaceTabs {
    fn default() -> Self {
        Self {
            active: FIRST.into(),
            order: vec![FIRST.into()],
            parked: HashMap::new(),
        }
    }
}

#[derive(serde::Serialize)]
struct Tab {
    id: String,
    name: String,
    has_design: bool,
}

#[derive(serde::Serialize)]
pub(super) struct TabList {
    active: String,
    tabs: Vec<Tab>,
}

fn describe(id: &str, workspace: &Workspace) -> Tab {
    let current = workspace
        .current
        .as_ref()
        .filter(|design| design.stitch_count() > 0);
    Tab {
        id: id.into(),
        name: current
            .map(|d| d.name.clone())
            .unwrap_or_else(|| "Untitled design".into()),
        has_design: current.is_some(),
    }
}

impl WorkspaceTabs {
    pub(super) fn active(&self) -> &str {
        &self.active
    }

    fn list(&self, workspace: &Workspace) -> TabList {
        let tabs = self
            .order
            .iter()
            .filter_map(|id| {
                let slot = if id == &self.active {
                    workspace
                } else {
                    self.parked.get(id)?
                };
                Some(describe(id, slot))
            })
            .collect();
        TabList {
            active: self.active.clone(),
            tabs,
        }
    }

    fn ensure_idle(&self, workspace: &Workspace) -> Result<(), String> {
        if workspace.simplify_job.is_some() {
            return Err("Wait for the current stitch preview to finish.".into());
        }
        Ok(())
    }

    fn add(
        &mut self,
        workspace: &mut Workspace,
        id: String,
        next: Workspace,
    ) -> Result<(), String> {
        self.ensure_idle(workspace)?;
        if self.order.len() >= LIMIT {
            return Err("Close a project tab before adding another. Up to six can be open.".into());
        }
        if self.order.contains(&id) {
            return Err("This project tab is already open.".into());
        }
        let previous = std::mem::replace(workspace, next);
        let old = std::mem::replace(&mut self.active, id.clone());
        self.parked.insert(old, previous);
        self.order.push(id);
        Ok(())
    }

    fn select(&mut self, workspace: &mut Workspace, id: &str) -> Result<(), String> {
        if id == self.active {
            return Ok(());
        }
        self.ensure_idle(workspace)?;
        let next = self
            .parked
            .remove(id)
            .ok_or("This project tab is no longer open.")?;
        let previous = std::mem::replace(workspace, next);
        let old = std::mem::replace(&mut self.active, id.to_owned());
        self.parked.insert(old, previous);
        Ok(())
    }

    fn close(&mut self, workspace: &mut Workspace, id: &str) -> Result<(), String> {
        self.ensure_idle(workspace)?;
        if self.order.len() == 1 {
            return Err("Keep at least one project tab open.".into());
        }
        let index = self
            .order
            .iter()
            .position(|value| value == id)
            .ok_or("This project tab is no longer open.")?;
        if id == self.active {
            let next = self.order[if index > 0 { index - 1 } else { 1 }].clone();
            self.select(workspace, &next)?;
        }
        self.parked.remove(id);
        self.order.remove(index);
        Ok(())
    }
}

pub(super) fn recovery_directory(root: &Path, id: &str) -> Result<PathBuf, String> {
    if id == FIRST {
        return Ok(root.to_owned());
    }
    if !Uuid::parse_str(id).is_ok_and(|value| value.to_string() == id) {
        return Err("Invalid recovery project.".into());
    }
    Ok(root.join("workspace-recovery").join(id))
}

#[tauri::command]
pub(super) fn workspace_tabs(
    tabs: tauri::State<'_, Mutex<WorkspaceTabs>>,
    state: tauri::State<'_, Mutex<Workspace>>,
) -> Result<TabList, String> {
    let tabs = tabs.lock().map_err(|error| error.to_string())?;
    let workspace = state.lock().map_err(|error| error.to_string())?;
    Ok(tabs.list(&workspace))
}

#[derive(serde::Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub(super) enum TabAction {
    New,
    Select { id: String },
    Close { id: String },
}

#[tauri::command]
pub(super) fn change_workspace_tab(
    action: TabAction,
    tabs: tauri::State<'_, Mutex<WorkspaceTabs>>,
    state: tauri::State<'_, Mutex<Workspace>>,
) -> Result<TabList, String> {
    let mut tabs = tabs.lock().map_err(|error| error.to_string())?;
    let mut workspace = state.lock().map_err(|error| error.to_string())?;
    match action {
        TabAction::New => tabs.add(
            &mut workspace,
            Uuid::new_v4().to_string(),
            Workspace::default(),
        )?,
        TabAction::Select { id } => tabs.select(&mut workspace, &id)?,
        TabAction::Close { id } => tabs.close(&mut workspace, &id)?,
    }
    Ok(tabs.list(&workspace))
}

#[derive(serde::Serialize)]
pub(super) struct RecoveryEntry {
    id: String,
    name: String,
}

#[tauri::command]
pub(super) fn recoverable_workspace_tabs(
    app: tauri::AppHandle,
) -> Result<Vec<RecoveryEntry>, String> {
    let root = app
        .path()
        .app_local_data_dir()
        .map_err(|error| error.to_string())?;
    let mut directories = vec![(FIRST.to_owned(), root.clone())];
    if let Ok(entries) = std::fs::read_dir(root.join("workspace-recovery")) {
        directories.extend(entries.flatten().take(128).filter_map(|entry| {
            if !entry.file_type().ok()?.is_dir() {
                return None;
            }
            let id = entry.file_name().into_string().ok()?;
            let directory = recovery_directory(&root, &id).ok()?;
            Some((id, directory))
        }));
    }
    Ok(directories
        .into_iter()
        .filter(|(_, path)| project_recovery::available(path))
        .map(|(id, path)| {
            let metadata = path.join("name.txt");
            let name = if metadata.metadata().is_ok_and(|m| m.len() <= 400) {
                std::fs::read_to_string(metadata)
                    .unwrap_or_default()
                    .trim()
                    .to_string()
            } else {
                String::new()
            };
            RecoveryEntry {
                id,
                name: if name.is_empty() {
                    "Recovery copy".into()
                } else {
                    name
                },
            }
        })
        .collect())
}

#[derive(serde::Serialize)]
pub(super) struct RecoveredTab {
    tabs: TabList,
    project: OpenedProject,
}

#[tauri::command]
pub(super) async fn restore_workspace_tab(
    id: String,
    app: tauri::AppHandle,
) -> Result<RecoveredTab, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = app
            .path()
            .app_local_data_dir()
            .map_err(|error| error.to_string())?;
        let directory = recovery_directory(&root, &id)?;
        let staged = Mutex::new(Workspace::default());
        let project = project_recovery::open(&directory, &staged)?
            .ok_or("This recovery copy is no longer available.")?;
        let restored = staged.into_inner().map_err(|error| error.to_string())?;
        let tabs = app.state::<Mutex<WorkspaceTabs>>();
        let mut tabs = tabs.lock().map_err(|error| error.to_string())?;
        let state = app.state::<Mutex<Workspace>>();
        let mut workspace = state.lock().map_err(|error| error.to_string())?;
        tabs.add(&mut workspace, id, restored)?;
        Ok(RecoveredTab {
            tabs: tabs.list(&workspace),
            project,
        })
    })
    .await
    .map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use zigzag::document::Document;

    #[test]
    fn switching_keeps_each_project_and_its_own_undo_history() {
        let mut tabs = WorkspaceTabs::default();
        let mut workspace = Workspace::default();
        let mut document = Document::empty();
        document.name = "First".into();
        workspace.current = Some(document.plan());
        workspace.source = Some(document);
        workspace.checkpoint_named("First edit");
        let second = Uuid::new_v4().to_string();
        tabs.add(&mut workspace, second.clone(), Workspace::default())
            .unwrap();
        assert!(workspace.undo.is_empty());
        let mut doc = Document::empty();
        doc.name = "Second".into();
        workspace.current = Some(doc.plan());
        workspace.checkpoint_named("Second edit");
        tabs.select(&mut workspace, FIRST).unwrap();
        assert_eq!(workspace.current.as_ref().unwrap().name, "First");
        assert_eq!(workspace.undo_labels, ["First edit"]);
        tabs.select(&mut workspace, &second).unwrap();
        assert_eq!(workspace.current.as_ref().unwrap().name, "Second");
        assert_eq!(workspace.undo_labels, ["Second edit"]);
        tabs.close(&mut workspace, &second).unwrap();
        assert_eq!(workspace.undo_labels, ["First edit"]);
    }

    #[test]
    fn recovery_locations_are_separate_and_ids_cannot_escape_the_root() {
        let root = Path::new("/example");
        assert_eq!(recovery_directory(root, FIRST).unwrap(), root);
        let id = Uuid::new_v4().to_string();
        assert_eq!(
            recovery_directory(root, &id).unwrap(),
            root.join("workspace-recovery").join(&id)
        );
        assert!(recovery_directory(root, "../escape").is_err());
    }
}
