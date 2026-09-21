#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
use std::{
    fs,
    io::{Read, Write},
    net::{TcpListener, TcpStream},
    process::{Child, Command, Stdio},
    sync::Mutex,
    time::{Duration, Instant},
};
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

struct Backend(Mutex<Option<Child>>);
impl Backend {
    fn stop(&self) {
        if let Some(mut child) = self.0.lock().unwrap().take() {
            // The backend gets its own process group, including its frozen
            // Python child and FFmpeg, so closing the app cannot orphan them.
            #[cfg(unix)]
            unsafe {
                libc::kill(-(child.id() as i32), libc::SIGTERM);
            }
            #[cfg(not(unix))]
            {
                let _ = child.kill();
            }
            let deadline = Instant::now() + Duration::from_secs(8);
            while Instant::now() < deadline {
                if child.try_wait().ok().flatten().is_some() {
                    return;
                }
                std::thread::sleep(Duration::from_millis(100));
            }
            #[cfg(unix)]
            unsafe {
                libc::kill(-(child.id() as i32), libc::SIGKILL);
            }
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}
impl Drop for Backend {
    fn drop(&mut self) {
        self.stop();
    }
}

fn main() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .setup(|app| {
            let data = app.path().app_data_dir()?;
            fs::create_dir_all(&data)?;
            let listener = TcpListener::bind("127.0.0.1:0")?;
            let port = listener.local_addr()?.port();
            drop(listener);
            let mut executable = std::env::current_exe()?
                .parent()
                .unwrap()
                .join("jalaseh-backend");
            if !executable.exists() {
                executable = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                    .join("binaries/jalaseh-backend-aarch64-apple-darwin");
            }
            let log = fs::OpenOptions::new()
                .create(true)
                .append(true)
                .open(data.join("backend.log"))?;
            let mut command = Command::new(executable);
            #[cfg(unix)]
            {
                use std::os::unix::process::CommandExt;
                command.process_group(0);
            }
            let child = command
                .args([
                    "--port",
                    &port.to_string(),
                    "--data",
                    &data.to_string_lossy(),
                ])
                .stdout(Stdio::from(log.try_clone()?))
                .stderr(Stdio::from(log))
                .spawn()?;
            app.manage(Backend(Mutex::new(Some(child))));
            let start = Instant::now();
            let address = format!("127.0.0.1:{port}");
            loop {
                let ready =
                    TcpStream::connect_timeout(&address.parse()?, Duration::from_millis(200))
                        .and_then(|mut stream| {
                            stream.set_read_timeout(Some(Duration::from_secs(1)))?;
                            stream.write_all(
                                b"GET /api/health HTTP/1.0\r\nHost: localhost\r\n\r\n",
                            )?;
                            let mut response = [0; 64];
                            let n = stream.read(&mut response)?;
                            Ok(String::from_utf8_lossy(&response[..n]).contains("200 OK"))
                        })
                        .unwrap_or(false);
                if ready {
                    break;
                }
                if start.elapsed() > Duration::from_secs(90) {
                    return Err(
                        "Backend failed to start; see backend.log in the app data directory".into(),
                    );
                }
                std::thread::sleep(Duration::from_millis(200));
            }
            WebviewWindowBuilder::new(
                app,
                "main",
                WebviewUrl::External(format!("http://127.0.0.1:{port}").parse()?),
            )
            .title("جلسه · Jalaseh")
            .inner_size(1280.0, 850.0)
            .min_inner_size(760.0, 600.0)
            .build()?;
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("Unable to launch Jalaseh");
    app.run(|handle, event| {
        if let tauri::RunEvent::Exit = event {
            handle.state::<Backend>().stop();
        }
    });
}
