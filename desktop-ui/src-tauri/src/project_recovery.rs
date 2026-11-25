use std::{path::Path, sync::Mutex};

use super::{OpenedProject, Project, Workspace, open_project_path, write_project};

const CURRENT_NAME: &str = "recovery.stitchstudio";
const PREVIOUS_NAME: &str = "recovery.previous";

pub(super) fn save(directory: &Path, project: &Project) -> Result<(), String> {
    project.validate()?;
    std::fs::create_dir_all(directory).map_err(|error| error.to_string())?;
    let current = directory.join(CURRENT_NAME);
    // Parsing JSON alone does not establish that a snapshot can be opened.
    // Preserve the known-good backup when the latest snapshot is damaged.
    if let Ok(previous) = Project::load(&current)
        && previous.validate().is_ok()
    {
        write_project(&directory.join(PREVIOUS_NAME), &previous)?;
    }
    write_project(&current, project)
}

pub(super) fn open(directory: &Path, state: &Mutex<Workspace>) -> Result<Option<OpenedProject>, String> {
    let mut last_error = None;
    for name in [CURRENT_NAME, PREVIOUS_NAME] {
        let path = directory.join(name);
        match path.try_exists() {
            Ok(false) => continue,
            Err(error) => {
                last_error = Some(error.to_string());
                continue;
            }
            Ok(true) => match open_project_path(&path, state) {
                Ok(project) => return Ok(Some(project)),
                Err(error) => last_error = Some(error),
            },
        }
    }
    match last_error {
        Some(error) => Err(format!("Unable to open the recovery copies: {error}")),
        None => Ok(None),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{ProjectBlock, ProjectRun};

    fn project(name: &str) -> Project {
        Project {
            source_svg: None,
            source_offset: None,
            version: 1,
            name: name.into(),
            width: 100.0,
            height: 100.0,
            format: "dst".into(),
            blocks: vec![ProjectBlock {
                color: [23, 44, 55],
                runs: vec![ProjectRun { points: vec![[0.0, 0.0], [1.0, 2.0]], trim_before: false }],
            }],
        }
    }

    #[test]
    fn open_falls_back_after_an_interrupted_write() {
        let directory = tempfile::tempdir().unwrap();
        save(directory.path(), &project("first")).unwrap();
        save(directory.path(), &project("second")).unwrap();
        std::fs::write(directory.path().join(CURRENT_NAME), b"{\"version\":").unwrap();

        let workspace = Mutex::new(Workspace::default());
        let restored = open(directory.path(), &workspace).unwrap().unwrap();
        assert_eq!(restored.plan.name, "first");
    }

    #[test]
    fn unusable_current_project_does_not_replace_the_good_backup() {
        let directory = tempfile::tempdir().unwrap();
        save(directory.path(), &project("first")).unwrap();
        let mut damaged = project("invalid");
        damaged.version = 999;
        write_project(&directory.path().join(PREVIOUS_NAME), &project("known good")).unwrap();
        write_project(&directory.path().join(CURRENT_NAME), &damaged).unwrap();

        save(directory.path(), &project("replacement")).unwrap();
        let workspace = Mutex::new(Workspace::default());
        assert_eq!(open(directory.path(), &workspace).unwrap().unwrap().plan.name, "replacement");
        assert_eq!(
            Project::load(&directory.path().join(PREVIOUS_NAME)).unwrap().name,
            "known good"
        );
    }

    #[test]
    fn bad_recovery_copies_leave_the_open_work_intact() {
        let directory = tempfile::tempdir().unwrap();
        let mut malformed = project("malformed SVG");
        malformed.source_svg = Some("<svg><broken".into());
        write_project(&directory.path().join(CURRENT_NAME), &malformed).unwrap();
        write_project(&directory.path().join(PREVIOUS_NAME), &malformed).unwrap();
        let workspace = Mutex::new(Workspace::default());
        project("open work").restore(&workspace).unwrap();
        assert!(open(directory.path(), &workspace).is_err());
        assert_eq!(workspace.into_inner().unwrap().current.unwrap().name, "open work");
    }
}
