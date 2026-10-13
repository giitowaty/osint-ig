//! Powłoka desktopowa OSINT-IG.
//!
//! Uruchamia silnik (serwer Node spakowany jako sidecar) na wolnym porcie
//! 127.0.0.1, przekazuje jego log na żywo do UI (zdarzenie `engine-log`)
//! i zamyka go razem z aplikacją.

use std::net::TcpListener;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, RunEvent, State};
use tauri_plugin_opener::OpenerExt;
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

struct Engine {
    port: u16,
    child: Mutex<Option<CommandChild>>,
    /// Bufor ostatnich linii: start silnika wyprzedza załadowanie UI,
    /// więc front pobiera historię komendą `engine_logs`.
    logs: Mutex<Vec<EngineLog>>,
    seq: AtomicU64,
}

const LOG_BUFFER: usize = 500;

#[derive(Clone, Serialize)]
struct EngineLog {
    seq: u64,
    stream: &'static str,
    line: String,
}

/// Historia logu silnika (od startu aplikacji, ostatnie 500 linii).
#[tauri::command]
fn engine_logs(engine: State<'_, Engine>) -> Vec<EngineLog> {
    engine.logs.lock().unwrap().clone()
}

/// Adres API silnika dla frontu.
#[tauri::command]
fn api_base(engine: State<'_, Engine>) -> String {
    format!("http://127.0.0.1:{}", engine.port)
}

/// Otwiera link w przeglądarce systemowej (tylko http/https).
#[tauri::command]
fn open_external(app: AppHandle, url: String) -> Result<(), String> {
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return Err(format!("Niedozwolony adres: {url}"));
    }
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|e| e.to_string())
}

fn free_port() -> u16 {
    TcpListener::bind("127.0.0.1:0")
        .and_then(|l| l.local_addr())
        .map(|a| a.port())
        .unwrap_or(8765)
}

fn emit(app: &AppHandle, stream: &'static str, line: impl Into<String>) {
    let engine = app.state::<Engine>();
    let entry = EngineLog {
        seq: engine.seq.fetch_add(1, Ordering::Relaxed) + 1,
        stream,
        line: line.into(),
    };
    {
        let mut logs = engine.logs.lock().unwrap();
        if logs.len() >= LOG_BUFFER {
            logs.remove(0);
        }
        logs.push(entry.clone());
    }
    let _ = app.emit("engine-log", entry);
}

fn start_engine(app: &AppHandle, port: u16) -> Result<CommandChild, String> {
    let cmd = app
        .shell()
        .sidecar("osint-server")
        .map_err(|e| format!("Brak pliku silnika (sidecar): {e}"))?
        .env("PORT", port.to_string())
        .env("HOST", "127.0.0.1")
        .env("OSINT_SIDECAR", "1");
    let (mut rx, child) = cmd
        .spawn()
        .map_err(|e| format!("Nie udało się uruchomić silnika: {e}"))?;

    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(bytes) => {
                    for line in String::from_utf8_lossy(&bytes).lines() {
                        emit(&handle, "stdout", line);
                    }
                }
                CommandEvent::Stderr(bytes) => {
                    for line in String::from_utf8_lossy(&bytes).lines() {
                        emit(&handle, "stderr", line);
                    }
                }
                CommandEvent::Error(err) => emit(&handle, "stderr", format!("Silnik: {err}")),
                CommandEvent::Terminated(p) => {
                    emit(
                        &handle,
                        "status",
                        format!(
                            "Silnik zakończył pracę (kod {:?}, sygnał {:?})",
                            p.code, p.signal
                        ),
                    );
                    break;
                }
                _ => {}
            }
        }
    });
    Ok(child)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // OSINT_PORT: stały port silnika (testy end-to-end, debugowanie); domyślnie losowy wolny.
    let port = std::env::var("OSINT_PORT")
        .ok()
        .and_then(|v| v.parse::<u16>().ok())
        .unwrap_or_else(free_port);
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
        .manage(Engine {
            port,
            child: Mutex::new(None),
            logs: Mutex::new(Vec::new()),
            seq: AtomicU64::new(0),
        })
        .invoke_handler(tauri::generate_handler![api_base, open_external, engine_logs])
        .setup(move |app| {
            let handle = app.handle().clone();
            match start_engine(&handle, port) {
                Ok(child) => {
                    *app.state::<Engine>().child.lock().unwrap() = Some(child);
                    emit(&handle, "status", format!("Uruchamiam silnik na 127.0.0.1:{port}…"));
                }
                // Okno i tak startuje: UI pokaże błąd z podpowiedzią w panelu Aktywność.
                Err(e) => {
                    eprintln!("{e}");
                    emit(&handle, "stderr", e);
                }
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("błąd podczas budowania aplikacji Tauri")
        .run(|app, event| {
            if let RunEvent::Exit = event {
                if let Some(child) = app.state::<Engine>().child.lock().unwrap().take() {
                    let _ = child.kill();
                }
            }
        });
}
