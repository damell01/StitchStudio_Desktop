use crate::Workspace;
use serde_json::{Value, json};
use std::{
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
    time::Duration,
};
use tauri::Manager;

#[derive(Default)]
pub(super) struct AgentBridge(Mutex<Option<Connection>>);

struct Connection {
    endpoint: String,
    stop: Arc<AtomicBool>,
    pending: Arc<Mutex<Option<String>>>,
}

impl Drop for Connection {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Release);
    }
}

fn tool_text(value: Value, error: bool) -> Value {
    json!({"content":[{"type":"text","text":value.to_string()}],"isError":error})
}

fn rpc(
    request: Value,
    summary: impl FnOnce() -> Value,
    pending: &Mutex<Option<String>>,
) -> Option<Value> {
    let id = request.get("id").cloned();
    let method = request["method"].as_str().unwrap_or("");
    let error =
        |code, message| json!({"jsonrpc":"2.0","id":id,"error":{"code":code,"message":message}});
    if request["jsonrpc"] != "2.0" || method.is_empty() {
        return Some(error(-32600, "Invalid JSON-RPC request"));
    }
    if id.is_none() {
        return None;
    } // Notifications never queue an edit.
    let result = match method {
        "initialize" => {
            let requested = request["params"]["protocolVersion"].as_str().unwrap_or("");
            let supported = ["2024-11-05", "2025-03-26", "2025-06-18", "2025-11-25"];
            let version = if supported.contains(&requested) {
                requested
            } else {
                "2025-06-18"
            };
            json!({"protocolVersion":version,"capabilities":{"tools":{}},
                "serverInfo":{"name":"Stitch Studio","version":env!("CARGO_PKG_VERSION")},
                "instructions":"Inspect the active design or queue one edit. The user reviews edits in the desktop assistant."})
        }
        "ping" => json!({}),
        "tools/list" => json!({"tools":[
            {"name":"design_summary","description":"Read stitch totals and editable object names for the active design.",
                "inputSchema":{"type":"object","properties":{},"additionalProperties":false}},
            {"name":"propose_edit","description":"Queue a single design edit for the user to review. Examples: Center design, Simplify design, Change navy to red.",
                "inputSchema":{"type":"object","properties":{"command":{"type":"string","maxLength":160}},"required":["command"],"additionalProperties":false}}
        ]}),
        "tools/call" => match request["params"]["name"].as_str() {
            Some("design_summary") => tool_text(summary(), false),
            Some("propose_edit") => {
                let command = request["params"]["arguments"]["command"]
                    .as_str()
                    .unwrap_or("")
                    .trim();
                if command.is_empty()
                    || command.len() > 160
                    || command.chars().any(char::is_control)
                {
                    tool_text(
                        json!({"message":"Enter one design command up to 160 characters."}),
                        true,
                    )
                } else if let Ok(mut slot) = pending.lock() {
                    if slot.is_some() {
                        tool_text(
                            json!({"message":"There is already an edit waiting for review."}),
                            true,
                        )
                    } else {
                        *slot = Some(command.to_owned());
                        tool_text(
                            json!({"message":"Queued. Open the Studio assistant to review the edit."}),
                            false,
                        )
                    }
                } else {
                    tool_text(json!({"message":"The editor is busy."}), true)
                }
            }
            _ => tool_text(json!({"message":"Unknown tool."}), true),
        },
        _ => return Some(error(-32601, "Method not found")),
    };
    Some(json!({"jsonrpc":"2.0","id":id,"result":result}))
}

fn summary(app: &tauri::AppHandle) -> Value {
    let state = app.state::<Mutex<Workspace>>();
    let Ok(workspace) = state.try_lock() else {
        return json!({"status":"busy"});
    };
    let Some(plan) = workspace.current.as_ref() else {
        return json!({"status":"no active design"});
    };
    let bounds = plan.bounds();
    let objects: Vec<_> = workspace
        .source
        .iter()
        .flat_map(|doc| &doc.shapes)
        .take(60)
        .map(|shape| {
            json!({"label":shape.label.chars().take(100).collect::<String>(), "color":shape.color,
            "kind":shape.params.kind.map(|kind|kind.name())})
        })
        .collect();
    json!({"name":plan.name.chars().take(100).collect::<String>(),"stitches":plan.stitch_count(),
        "trims":plan.trim_count(),"color_blocks":plan.blocks.len(),
        "width_mm":if bounds.is_empty(){0.}else{bounds.width()/10.},
        "height_mm":if bounds.is_empty(){0.}else{bounds.height()/10.},"preview_objects":objects})
}

fn serve(
    server: tiny_http::Server,
    path: String,
    authority: String,
    stop: Arc<AtomicBool>,
    pending: Arc<Mutex<Option<String>>>,
    snapshot: impl Fn() -> Value,
) {
    use tiny_http::{Header, Method, Response};
    while !stop.load(Ordering::Acquire) {
        let Ok(Some(mut request)) = server.recv_timeout(Duration::from_millis(250)) else {
            continue;
        };
        let host_ok = request
            .headers()
            .iter()
            .any(|h| h.field.equiv("Host") && h.value.as_str() == authority);
        let browser = request.headers().iter().any(|h| h.field.equiv("Origin"));
        if browser || !host_ok || request.url() != path {
            let _ = request.respond(Response::empty(404));
            continue;
        }
        if request.method() != &Method::Post {
            let _ = request.respond(Response::empty(405));
            continue;
        }
        let content_type = request.headers().iter().any(|h| {
            h.field.equiv("Content-Type")
                && h.value.as_str().split(';').next() == Some("application/json")
        });
        if !content_type || request.body_length().is_none_or(|length| length > 8_192) {
            let _ = request.respond(Response::empty(400));
            continue;
        }
        let body: Result<Value, _> = serde_json::from_reader(request.as_reader());
        let reply = match body {
            Ok(body) => rpc(body, &snapshot, &pending),
            Err(_) => Some(
                json!({"jsonrpc":"2.0","id":null,"error":{"code":-32700,"message":"Invalid JSON"}}),
            ),
        };
        if let Some(reply) = reply {
            let header =
                Header::from_bytes("Content-Type", "application/json").expect("valid JSON header");
            let _ = request.respond(Response::from_string(reply.to_string()).with_header(header));
        } else {
            let _ = request.respond(Response::empty(202));
        }
    }
}

#[tauri::command]
pub(super) fn start_agent_bridge(app: tauri::AppHandle) -> Result<String, String> {
    let bridge = app.state::<AgentBridge>();
    let mut state = bridge.0.lock().map_err(|e| e.to_string())?;
    if let Some(session) = state.as_ref() {
        return Ok(session.endpoint.clone());
    }
    let server = tiny_http::Server::http(("127.0.0.1", 0))
        .map_err(|_| "Could not start the local agent connection.")?;
    let authority = server
        .server_addr()
        .to_ip()
        .ok_or("Could not allocate a local port.")?
        .to_string();
    let path = format!("/mcp/{}", uuid::Uuid::new_v4().simple());
    let endpoint = format!("http://{authority}{path}");
    let stop = Arc::new(AtomicBool::new(false));
    let pending = Arc::new(Mutex::new(None));
    let (worker_stop, worker_pending, worker_app) = (stop.clone(), pending.clone(), app.clone());
    std::thread::Builder::new()
        .name("stitch-studio-agent".into())
        .spawn(move || {
            serve(server, path, authority, worker_stop, worker_pending, || {
                summary(&worker_app)
            })
        })
        .map_err(|_| "Could not start the local agent connection.")?;
    *state = Some(Connection {
        endpoint: endpoint.clone(),
        stop,
        pending,
    });
    Ok(endpoint)
}

#[tauri::command]
pub(super) fn agent_bridge_endpoint(
    bridge: tauri::State<'_, AgentBridge>,
) -> Result<Option<String>, String> {
    Ok(bridge
        .0
        .lock()
        .map_err(|e| e.to_string())?
        .as_ref()
        .map(|c| c.endpoint.clone()))
}

#[tauri::command]
pub(super) fn stop_agent_bridge(bridge: tauri::State<'_, AgentBridge>) -> Result<(), String> {
    bridge.0.lock().map_err(|e| e.to_string())?.take();
    Ok(())
}

#[tauri::command]
pub(super) fn agent_bridge_edit(
    consume: bool,
    bridge: tauri::State<'_, AgentBridge>,
) -> Result<Option<String>, String> {
    let state = bridge.0.lock().map_err(|e| e.to_string())?;
    let Some(session) = state.as_ref() else {
        return Ok(None);
    };
    let mut slot = session.pending.lock().map_err(|e| e.to_string())?;
    Ok(if consume { slot.take() } else { slot.clone() })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn agent_can_queue_one_change_and_only_through_a_request() {
        let pending = Mutex::new(None);
        let mut request = json!({"jsonrpc":"2.0","method":"tools/call",
            "params":{"name":"propose_edit","arguments":{"command":"Center design"}}});
        assert!(rpc(request.clone(), || json!({}), &pending).is_none());
        assert!(pending.lock().unwrap().is_none());
        request["id"] = json!(1);
        assert_eq!(
            rpc(request.clone(), || json!({}), &pending).unwrap()["result"]["isError"],
            false
        );
        request["params"]["arguments"]["command"] = json!("Undo");
        assert_eq!(
            rpc(request, || json!({}), &pending).unwrap()["result"]["isError"],
            true
        );
        assert_eq!(*pending.lock().unwrap(), Some("Center design".into()));
    }
}
