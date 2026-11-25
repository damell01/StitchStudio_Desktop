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

const COMMANDS: &[&str] = &["center my design", "fit to hoop", "group thread colors",
    "optimize stitches", "check design", "zoom to fit", "select all", "clear selection",
    "flip horizontally", "flip vertically", "rotate left", "rotate right",
    "make selection fill", "make selection satin", "make selection run"];

/// Run one constrained request on a background thread. The child is always
/// reaped, including on startup or HTTP failure.
pub fn infer(prompt: &str) -> anyhow::Result<String> {
    use std::io::{Read, Write};
    use std::net::{TcpListener, TcpStream};
    use std::time::{Duration, Instant};
    let bundle = Bundle::discover().ok_or_else(|| anyhow::anyhow!("Bundled AI assets missing"))?;
    let listener = TcpListener::bind(("127.0.0.1", 0))?;
    let port = listener.local_addr()?.port();
    drop(listener);
    struct Worker(std::process::Child);
    impl Drop for Worker {
        fn drop(&mut self) { let _ = self.0.kill(); let _ = self.0.wait(); }
    }
    let mut worker = Worker(bundle.command(port)
        .stdin(std::process::Stdio::null()).stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null()).spawn()?);
    let deadline = Instant::now() + Duration::from_secs(90);
    let mut stream = loop {
        if worker.0.try_wait()?.is_some() { anyhow::bail!("Local AI worker exited"); }
        if Instant::now() >= deadline { anyhow::bail!("Local AI startup timed out"); }
        if let Ok(mut s) = TcpStream::connect(("127.0.0.1", port)) {
            s.set_read_timeout(Some(Duration::from_secs(2)))?;
            s.write_all(b"GET /health HTTP/1.0\r\nHost: localhost\r\nConnection: close\r\n\r\n")?;
            let mut response = String::new();
            if s.read_to_string(&mut response).is_ok() && response.starts_with("HTTP/1.1 200") {
                break TcpStream::connect(("127.0.0.1", port))?;
            }
        }
        std::thread::sleep(Duration::from_millis(250));
    };
    stream.set_read_timeout(Some(Duration::from_secs(60)))?;
    stream.set_write_timeout(Some(Duration::from_secs(5)))?;
    let body = serde_json::json!({
        "messages":[{"role":"system","content":format!("Choose exactly one command from this list, or NONE if unsupported, ambiguous, negated or multiple edits: {}. Output only the command.", COMMANDS.join("; "))},{"role":"user","content":prompt}],
        "temperature":0, "max_tokens":64, "stream":false
    }).to_string();
    write!(stream, "POST /v1/chat/completions HTTP/1.0\r\nHost: localhost\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}", body.len(), body)?;
    let mut response = String::new();
    stream.take(1024 * 1024).read_to_string(&mut response)?;
    let (header, body) = response.split_once("\r\n\r\n").ok_or_else(|| anyhow::anyhow!("Invalid inference response"))?;
    anyhow::ensure!(header.starts_with("HTTP/1.1 200") || header.starts_with("HTTP/1.0 200"), "Inference failed");
    let value: serde_json::Value = serde_json::from_str(body)?;
    let answer = value["choices"][0]["message"]["content"].as_str().unwrap_or("").trim().to_ascii_lowercase();
    anyhow::ensure!(COMMANDS.contains(&answer.as_str()), "No supported command identified");
    Ok(answer)
}
