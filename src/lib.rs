use rdev::{listen, EventType, Key};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::sync::Arc;
use std::sync::Mutex;
use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Manager,
};

static LAST_OCR_RESULT: Mutex<String> = Mutex::new(String::new());

struct ShortcutState(Arc<Mutex<String>>);

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AppSettings {
    pub deepl_api_key: String,
    pub ocr_lang: String,
    pub translate_to: String,
    pub shortcut: String,
    pub ocr_mode: String, // "online" ou "local"
    pub gemini_api_key: String,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            deepl_api_key: String::new(),
            ocr_lang: "por".to_string(),
            translate_to: "en".to_string(),
            shortcut: "Ctrl+Shift+S".to_string(),
            ocr_mode: "online".to_string(),
            gemini_api_key: String::new(),
        }
    }
}

fn settings_path(app: &tauri::AppHandle) -> PathBuf {
    let dir = app.path().app_config_dir().unwrap();
    std::fs::create_dir_all(&dir).unwrap();
    dir.join("settings.json")
}

#[tauri::command]
fn load_settings(app: tauri::AppHandle) -> AppSettings {
    let path = settings_path(&app);
    if path.exists() {
        let content = fs::read_to_string(&path).unwrap_or_default();
        serde_json::from_str(&content).unwrap_or_default()
    } else {
        AppSettings::default()
    }
}

#[tauri::command]
fn save_settings(app: tauri::AppHandle, settings: AppSettings) {
    // Atualiza o atalho em tempo real pro keyhook
    if let Some(state) = app.try_state::<ShortcutState>() {
        *state.0.lock().unwrap() = settings.shortcut.clone();
    }
    let path = settings_path(&app);
    let json = serde_json::to_string_pretty(&settings).unwrap();
    fs::write(&path, json).unwrap();
}

#[tauri::command]
fn log_coords(x: i32, y: i32, w: i32, h: i32) {
    println!(
        "📍 Coordenadas da captura -> x:{} y:{} w:{} h:{}",
        x, y, w, h
    );
}

#[tauri::command]
fn show_window(app: tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

#[tauri::command]
fn close_overlay_windows(app: tauri::AppHandle) {
    let labels: Vec<String> = app
        .webview_windows()
        .keys()
        .filter(|l| l.starts_with("overlay"))
        .cloned()
        .collect();
    for label in labels {
        if let Some(window) = app.get_webview_window(&label) {
            let _ = window.close();
        }
    }
}

fn translate_text(text: &str, api_key: &str, target_lang: &str) -> Result<String, String> {
    let client = reqwest::blocking::Client::new();
    let response = client
        .post("https://api-free.deepl.com/v2/translate")
        .header("Authorization", format!("DeepL-Auth-Key {}", api_key))
        .json(&serde_json::json!({
            "text": [text],
            "target_lang": target_lang.to_uppercase(),
        }))
        .send()
        .map_err(|e| format!("Erro ao chamar DeepL: {}", e))?;
    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().unwrap_or_default();
        return Err(format!("DeepL retornou erro {}: {}", status, body));
    }
    #[derive(serde::Deserialize)]
    struct DeepLResponse {
        translations: Vec<Translation>,
    }
    #[derive(serde::Deserialize)]
    struct Translation {
        text: String,
    }
    let result: DeepLResponse = response
        .json()
        .map_err(|e| format!("Erro ao parsear resposta do DeepL: {}", e))?;
    let translated = result
        .translations
        .first()
        .map(|t| t.text.clone())
        .unwrap_or_default();
    println!("🌐 Traduzido: {}", translated);
    Ok(translated)
}

#[tauri::command]
fn translate_text_cmd(
    app: tauri::AppHandle,
    text: String,
    target_lang: Option<String>,
) -> Result<String, String> {
    let settings = load_settings(app.clone());
    if settings.deepl_api_key.is_empty() {
        return Err("DeepL API Key não configurada.".to_string());
    }
    let lang = target_lang.unwrap_or(settings.translate_to);
    translate_text(&text, &settings.deepl_api_key, &lang)
}

fn capture_area(x: i32, y: i32, w: i32, h: i32) -> Result<std::path::PathBuf, String> {
    use screenshots::Screen;
    use std::time::{SystemTime, UNIX_EPOCH};

    let screens = Screen::all().map_err(|e| e.to_string())?;
    let target = screens
        .iter()
        .find(|s| {
            let dx = s.display_info.x as i32;
            let dy = s.display_info.y as i32;
            let dw = s.display_info.width as i32;
            let dh = s.display_info.height as i32;
            x >= dx && x < dx + dw && y >= dy && y < dy + dh
        })
        .ok_or_else(|| format!("Nenhuma tela no ponto ({}, {})", x, y))?;

    let rel_x = x - target.display_info.x as i32;
    let rel_y = y - target.display_info.y as i32;

    let image = target
        .capture_area(rel_x, rel_y, w as u32, h as u32)
        .map_err(|e| e.to_string())?;

    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs();
    let temp_path = std::env::temp_dir().join(format!("snipp_{}.png", timestamp));
    image.save(&temp_path).map_err(|e| e.to_string())?;
    println!("📸 Capturado: {}", temp_path.display());
    Ok(temp_path)
}

fn run_ocr(image_path: &std::path::Path, ocr_lang: &str) -> Result<String, String> {
    use std::process::Command;
    let tesseract = r"C:\Program Files\Tesseract-OCR\tesseract.exe";
    let tessdata = r"C:\Program Files\Tesseract-OCR\tessdata";
    let output = Command::new(tesseract)
        .arg(image_path.to_string_lossy().to_string())
        .arg("stdout")
        .arg("-l")
        .arg(ocr_lang)
        .env("TESSDATA_PREFIX", tessdata)
        .output()
        .map_err(|e| format!("Erro ao executar Tesseract: {}", e))?;
    if output.status.success() {
        let text = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if text.is_empty() {
            Ok("(nenhum texto encontrado)".to_string())
        } else {
            println!("📝 OCR: {}", text);
            Ok(text)
        }
    } else {
        let err = String::from_utf8_lossy(&output.stderr);
        Err(format!("Erro no OCR: {}", err))
    }
}

fn run_ocr_online(image_path: &std::path::Path, api_key: &str) -> Result<String, String> {
    let image_bytes =
        std::fs::read(image_path).map_err(|e| format!("Erro ao ler imagem: {}", e))?;

    let b64 = base64::encode(&image_bytes);

    let client = reqwest::blocking::Client::new();
    let response = client
        .post(format!(
            "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key={}",
            api_key
        ))
        .json(&serde_json::json!({
            "contents": [{
                "parts": [
                    { "text": "Extraia todo o texto desta imagem. Retorne apenas o texto extraído, sem comentários." },
                    { "inline_data": {
                        "mime_type": "image/png",
                        "data": b64
                    }}
                ]
            }]
        }))
        .send()
        .map_err(|e| format!("Erro na requisição: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().unwrap_or_default();
        return Err(format!("Gemini retornou erro {}: {}", status, body));
    }

    let result: serde_json::Value = response
        .json()
        .map_err(|e| format!("Erro no parse: {}", e))?;

    let text = result["candidates"][0]["content"]["parts"][0]["text"]
        .as_str()
        .unwrap_or("(nenhum texto encontrado)")
        .to_string();

    println!("☁️ OCR Online: {}", text);
    Ok(text.trim().to_string())
}

#[tauri::command]
fn capture_and_ocr(
    app: tauri::AppHandle,
    x: i32,
    y: i32,
    w: i32,
    h: i32,
    lang: Option<String>,
) -> Result<String, String> {
    let path = capture_area(x, y, w, h)?;
    let settings = load_settings(app.clone());
    let ocr_lang = lang.unwrap_or(settings.ocr_lang);

    let text = if settings.ocr_mode == "online" {
        if settings.gemini_api_key.is_empty() {
            return Err(
                "Gemini API Key não configurada. Vá em Configurações > OCR > Chave da API."
                    .to_string(),
            );
        }
        run_ocr_online(&path, &settings.gemini_api_key)?
    } else {
        run_ocr(&path, &ocr_lang)?
    };

    let _ = std::fs::remove_file(&path);
    Ok(text)
}

#[tauri::command]
fn show_result_window(app: tauri::AppHandle, text: String) {
    if let Ok(mut last) = LAST_OCR_RESULT.lock() {
        *last = text;
    }
    if let Some(window) = app.get_webview_window("result") {
        let _ = window.show();
        let _ = window.set_focus();
        return;
    }
    let _ =
        tauri::WebviewWindowBuilder::new(&app, "result", tauri::WebviewUrl::App("/result".into()))
            .inner_size(520.0, 640.0)
            .min_inner_size(400.0, 400.0)
            .resizable(true)
            .decorations(true)
            .center()
            .title("Snipp - Resultado")
            .build();
}

#[tauri::command]
fn get_last_ocr_result() -> String {
    LAST_OCR_RESULT.lock().unwrap().clone()
}

#[tauri::command]
fn close_result_window(app: tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("result") {
        let _ = window.close();
    }
}

#[tauri::command]
fn show_result(app: tauri::AppHandle, text: String) {
    if let Ok(mut last) = LAST_OCR_RESULT.lock() {
        *last = text;
    }
    for label in app.webview_windows().keys() {
        if label.starts_with("overlay-") {
            if let Some(window) = app.get_webview_window(label) {
                let _ = window.close();
            }
        }
    }
    if let Some(window) = app.get_webview_window("result") {
        let _ = window.show();
        let _ = window.set_focus();
        return;
    }
    let _ =
        tauri::WebviewWindowBuilder::new(&app, "result", tauri::WebviewUrl::App("/result".into()))
            .inner_size(520.0, 640.0)
            .min_inner_size(400.0, 400.0)
            .resizable(true)
            .decorations(true)
            .center()
            .title("Snipp - Resultado")
            .build();
}

fn parse_shortcut(shortcut: &str) -> (bool, bool, bool, bool, Option<Key>) {
    let parts: Vec<&str> = shortcut.split('+').collect();
    let mut ctrl = false;
    let mut alt = false;
    let mut shift = false;
    let mut meta = false;
    let mut key = None;

    for part in parts {
        match part.trim() {
            "Ctrl" => ctrl = true,
            "Alt" => alt = true,
            "Shift" => shift = true,
            "Win" | "Meta" | "Super" => meta = true,
            "Space" => key = Some(Key::Space),
            "Enter" => key = Some(Key::Return),
            "Tab" => key = Some(Key::Tab),
            "Escape" | "Esc" => key = Some(Key::Escape),
            "BackSpace" | "Back" => key = Some(Key::Backspace),
            "CapsLock" => key = Some(Key::CapsLock),
            "Delete" | "Del" => key = Some(Key::Delete),
            "Insert" => key = Some(Key::Insert),
            "Home" => key = Some(Key::Home),
            "End" => key = Some(Key::End),
            "PageUp" => key = Some(Key::PageUp),
            "PageDown" => key = Some(Key::PageDown),
            "Up" => key = Some(Key::UpArrow),
            "Down" => key = Some(Key::DownArrow),
            "Left" => key = Some(Key::LeftArrow),
            "Right" => key = Some(Key::RightArrow),
            "A" => key = Some(Key::KeyA),
            "B" => key = Some(Key::KeyB),
            "C" => key = Some(Key::KeyC),
            "D" => key = Some(Key::KeyD),
            "E" => key = Some(Key::KeyE),
            "F" => key = Some(Key::KeyF),
            "G" => key = Some(Key::KeyG),
            "H" => key = Some(Key::KeyH),
            "I" => key = Some(Key::KeyI),
            "J" => key = Some(Key::KeyJ),
            "K" => key = Some(Key::KeyK),
            "L" => key = Some(Key::KeyL),
            "M" => key = Some(Key::KeyM),
            "N" => key = Some(Key::KeyN),
            "O" => key = Some(Key::KeyO),
            "P" => key = Some(Key::KeyP),
            "Q" => key = Some(Key::KeyQ),
            "R" => key = Some(Key::KeyR),
            "S" => key = Some(Key::KeyS),
            "T" => key = Some(Key::KeyT),
            "U" => key = Some(Key::KeyU),
            "V" => key = Some(Key::KeyV),
            "W" => key = Some(Key::KeyW),
            "X" => key = Some(Key::KeyX),
            "Y" => key = Some(Key::KeyY),
            "Z" => key = Some(Key::KeyZ),
            "F1" => key = Some(Key::F1),
            "F2" => key = Some(Key::F2),
            "F3" => key = Some(Key::F3),
            "F4" => key = Some(Key::F4),
            "F5" => key = Some(Key::F5),
            "F6" => key = Some(Key::F6),
            "F7" => key = Some(Key::F7),
            "F8" => key = Some(Key::F8),
            "F9" => key = Some(Key::F9),
            "F10" => key = Some(Key::F10),
            "F11" => key = Some(Key::F11),
            "F12" => key = Some(Key::F12),
            _ => {}
        }
    }

    (ctrl, alt, shift, meta, key)
}

pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                let _ =
                    window.navigate(tauri::Url::parse("http://localhost:1420/settings").unwrap());
                let _ = window.set_size(tauri::LogicalSize::new(480.0, 640.0));
                let _ = window.set_resizable(false);
                let _ = window.center();
                let _ = window.show();
                let _ = window.set_focus();
            }

            if let Some(window) = app.get_webview_window("main") {
                let app_handle = app.handle().clone();
                window.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        let _ = app_handle.get_webview_window("main").map(|w| w.hide());
                    }
                });
            }

            let show = MenuItem::with_id(app, "show", "Abrir Janela", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Sair", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &quit])?;

            TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => {
                        let _ = show_window(app.clone());
                    }
                    "quit" => {
                        app.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let tauri::tray::TrayIconEvent::DoubleClick { .. } = event {
                        let app = tray.app_handle();
                        let _ = show_window(app.clone());
                    }
                })
                .build(app)?;

            // ─── Inicializa ShortcutState com o atalho salvo ───
            let saved_shortcut = load_settings(app.handle().clone()).shortcut;
            app.manage(ShortcutState(Arc::new(Mutex::new(saved_shortcut))));

            // 🎯 KEYHOOK - thread separada escutando o teclado
            let shortcut_arc = app.state::<ShortcutState>().0.clone();
            let app_handle = app.handle().clone();
            std::thread::spawn(move || {
                let mut ctrl_pressed = false;
                let mut alt_pressed = false;
                let mut shift_pressed = false;
                let mut meta_pressed = false;

                if let Err(e) = listen(move |event| {
                    let current = shortcut_arc.lock().unwrap().clone();
                    let (need_ctrl, need_alt, need_shift, need_meta, need_key) =
                        parse_shortcut(&current);

                    match event.event_type {
                        EventType::KeyPress(key) => match key {
                            Key::ControlLeft | Key::ControlRight => ctrl_pressed = true,
                            Key::Alt | Key::AltGr => alt_pressed = true,
                            Key::ShiftLeft | Key::ShiftRight => shift_pressed = true,
                            Key::MetaLeft | Key::MetaRight => meta_pressed = true,
                            _ => {
                                if let Some(expected_key) = need_key {
                                    if ctrl_pressed == need_ctrl
                                        && alt_pressed == need_alt
                                        && shift_pressed == need_shift
                                        && meta_pressed == need_meta
                                        && key == expected_key
                                    {
                                        println!(
                                            "🎯 Atalho '{}' detectado! Criando overlay",
                                            current
                                        );
                                        ctrl_pressed = false;
                                        alt_pressed = false;
                                        shift_pressed = false;
                                        meta_pressed = false;

                                        if app_handle.get_webview_window("overlay").is_none() {
                                            if let Ok(monitors) = app_handle.available_monitors() {
                                                for (i, monitor) in monitors.iter().enumerate() {
                                                    let pos = monitor.position();
                                                    let size = monitor.size();
                                                    let label = format!("overlay-{}", i);
                                                    let _ = tauri::WebviewWindowBuilder::new(
                                                        &app_handle,
                                                        &label,
                                                        tauri::WebviewUrl::App("/overlay".into()),
                                                    )
                                                    .position(pos.x as f64, pos.y as f64)
                                                    .inner_size(
                                                        size.width as f64,
                                                        size.height as f64,
                                                    )
                                                    .transparent(true)
                                                    .decorations(false)
                                                    .always_on_top(true)
                                                    .build();
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        },
                        EventType::KeyRelease(key) => match key {
                            Key::ControlLeft | Key::ControlRight => ctrl_pressed = false,
                            Key::Alt | Key::AltGr => alt_pressed = false,
                            Key::ShiftLeft | Key::ShiftRight => shift_pressed = false,
                            Key::MetaLeft | Key::MetaRight => meta_pressed = false,
                            _ => {}
                        },
                        _ => {}
                    }
                }) {
                    eprintln!("❌ Erro no rdev: {:?}", e);
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            show_window,
            close_overlay_windows,
            log_coords,
            load_settings,
            save_settings,
            translate_text_cmd,
            capture_and_ocr,
            show_result_window,
            get_last_ocr_result,
            close_result_window,
            show_result,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
