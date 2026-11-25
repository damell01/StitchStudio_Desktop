//! Discover packaged AI assets without requiring user-installed software.
use std::path::PathBuf;

#[derive(Debug, Clone)]
pub struct Bundle {
    pub model: PathBuf,
    pub server: PathBuf,
}

impl Bundle {
    pub fn discover() -> Option<Self> {
        let exe = std::env::current_exe().ok()?;
        let dir = exe.parent()?;
        let mut roots = vec![dir.join("ai")];
        if let Some(parent) = dir.parent() {
            roots.push(parent.join("Resources").join("ai"));
        }
        for root in roots {
            let model = root.join("model.gguf");
            let server = root.join("runtime").join(if cfg!(windows) {
                "llama-server.exe"
            } else {
                "llama-server"
            });
            if model.is_file() && server.is_file() {
                return Some(Self { model, server });
            }
        }
        None
    }

    /// Arguments for a private loopback-only inference worker.
    pub fn command(&self, port: u16) -> std::process::Command {
        let mut cmd = std::process::Command::new(&self.server);
        cmd.arg("--model").arg(&self.model)
            .args(["--host", "127.0.0.1", "--port"])
            .arg(port.to_string())
            .args(["--ctx-size", "2048", "--parallel", "1"]);
        cmd
    }
}
