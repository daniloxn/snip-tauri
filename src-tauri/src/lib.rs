use rdev::{listen, Event, EventType, Key};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::{sync::Mutex, time::UNIX_EPOCH};
use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    window, Emitter, Manager, WebviewWindowBuilder,
};

static LAST_OCR_RESULT: Mutex<String> = Mutex::new(String::new());
static ALT_PRESSED: Mutex<bool> = Mutex::new(false);
static SHIFT_PRESSED: Mutex<bool> = Mutex::new(false);

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AppSettings {
    pub deepl_api_key: String,
    pub ocr_lang: String,
    pub translate_to: String,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            deepl_api_key: String::new(),
            ocr_lang: "por".to_string(),
            translate_to: "en".to_string(),
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
    let path = settings_path(&app);
    let json = serde_json::to_string_pretty(&settings).unwrap();
    fs::write(&path, json).unwrap();
}

// Printando as cordenadas selecionada.
#[tauri::command]
fn log_coords(x: i32, y: i32, w: i32, h: i32) {
    println!(
        "📍 Coordenadas da captura -> x:{} y:{} w:{} h:{}",
        x, y, w, h
    );
}

// Função para mostrar a janela
#[tauri::command]
fn show_window(app: tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

// Função para fechar todas as overlay quando a tecla ESC for pressionada.
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

#[tauri::command]
fn translate_text(app: tauri::AppHandle, text: String) -> Result<String, String> {
    let settings = load_settings(app.clone());

    if settings.deepl_api_key.is_empty() {
        return Err(
            "DeepL API Key não configurada. Vá em Configurações e adicione sua chave.".to_string(),
        );
    }

    let target_lang = settings.translate_to.to_uppercase();

    let client = reqwest::blocking::Client::new();
    let response = client
        .post("https://api-free.deepl.com/v2/translate")
        .header(
            "Authorization",
            format!("DeepL-Auth-Key {}", settings.deepl_api_key),
        )
        .json(&serde_json::json!({
            "text": [text],
            "target_lang": target_lang,
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
fn capture_and_ocr(
    app: tauri::AppHandle,
    x: i32,
    y: i32,
    w: i32,
    h: i32,
) -> Result<String, String> {
    use screenshots::Screen;
    use std::process::Command;
    use std::time::{SystemTime, UNIX_EPOCH};

    // 1. Descobre qual tela
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

    // 2. Captura a área
    let image = target
        .capture_area(rel_x, rel_y, w as u32, h as u32)
        .map_err(|e| e.to_string())?;

    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs();

    let temp_path = std::env::temp_dir().join(format!("snipp_{}.png", timestamp));

    // 3. Salva temporariamente
    image.save(&temp_path).map_err(|e| e.to_string())?;

    let tesseract_path = r"C:\Program Files\Tesseract-OCR\tesseract.exe";
    let tessdata = r"C:\Program Files\Tesseract-OCR\tessdata";
    let settings = load_settings(app.clone());
    // 4. Roda o Tesseract
    let output = Command::new(tesseract_path)
        .arg(temp_path.to_string_lossy().to_string())
        .arg("stdout")
        .arg("-l")
        .arg(&settings.ocr_lang)
        .env("TESSDATA_PREFIX", tessdata)
        .output()
        .map_err(|e| {
            format!(
                "Erro ao executar Tesseract: {}. Instalou e marcou Add to PATH?",
                e
            )
        })?;

    // 5. Apaga o temp
    let _ = std::fs::remove_file(&temp_path);

    // 6. Retorna o texto
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

#[tauri::command]
fn show_result_window(app: tauri::AppHandle, text: String) {
    if let Ok(mut last) = LAST_OCR_RESULT.lock() {
        *last = text;
    }

    // Se a janela já existe, só traz pra frente
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
    // 1. Salva o texto
    if let Ok(mut last) = LAST_OCR_RESULT.lock() {
        *last = text;
    }

    // 2. Fecha todos os overlays
    for label in app.webview_windows().keys() {
        if label.starts_with("overlay-") {
            if let Some(window) = app.get_webview_window(label) {
                let _ = window.close();
            }
        }
    }

    // 3. Abre ou mostra a janela de resultado
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
fn capture_region_and_translate(
    app: tauri::AppHandle,
    x: i32,
    y: i32,
    w: i32,
    h: i32,
) -> Result<String, String> {
    use screenshots::Screen;
    use std::process::Command;
    use std::time::{SystemTime, UNIX_EPOCH};

    // 1. Carrega settings
    let settings = load_settings(app.clone());

    // 2. Descobre qual tela
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

    // 3. Captura a área
    let image = target
        .capture_area(rel_x, rel_y, w as u32, h as u32)
        .map_err(|e| e.to_string())?;

    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs();
    let temp_path = std::env::temp_dir().join(format!("snipp_{}.png", timestamp));
    image.save(&temp_path).map_err(|e| e.to_string())?;

    // 4. OCR
    let tesseract = r"C:\Program Files (x86)\Tesseract-OCR\tesseract.exe";
    let tessdata = r"C:\Program Files (x86)\Tesseract-OCR\tessdata";

    let ocr_output = Command::new(tesseract)
        .arg(temp_path.to_string_lossy().to_string())
        .arg("stdout")
        .arg("-l")
        .arg(&settings.ocr_lang)
        .env("TESSDATA_PREFIX", tessdata)
        .output()
        .map_err(|e| format!("Erro ao executar Tesseract: {}", e))?;

    let _ = std::fs::remove_file(&temp_path);

    let ocr_text = if ocr_output.status.success() {
        String::from_utf8_lossy(&ocr_output.stdout)
            .trim()
            .to_string()
    } else {
        return Err("Erro no OCR".to_string());
    };

    if ocr_text.is_empty() {
        return Err("(nenhum texto encontrado)".to_string());
    }

    println!("📝 OCR: {}", ocr_text);

    // 5. Tradução (se tiver API Key)
    let translated_text = if !settings.deepl_api_key.is_empty() {
        let target_lang = settings.translate_to.to_uppercase();
        let client = reqwest::blocking::Client::new();
        match client
            .post("https://api-free.deepl.com/v2/translate")
            .header(
                "Authorization",
                format!("DeepL-Auth-Key {}", settings.deepl_api_key),
            )
            .json(&serde_json::json!({ "text": [ocr_text], "target_lang": target_lang }))
            .send()
        {
            Ok(resp) if resp.status().is_success() => {
                #[derive(serde::Deserialize)]
                struct DeepLResponse {
                    translations: Vec<Translation>,
                }
                #[derive(serde::Deserialize)]
                struct Translation {
                    text: String,
                }
                match resp.json::<DeepLResponse>() {
                    Ok(r) => r
                        .translations
                        .first()
                        .map(|t| t.text.clone())
                        .unwrap_or_default(),
                    Err(_) => "(erro ao traduzir)".to_string(),
                }
            }
            _ => "(erro ao traduzir)".to_string(),
        }
    } else {
        String::new()
    };

    if !translated_text.is_empty() {
        println!("🌐 Traduzido: {}", translated_text);
    }

    // 6. Salva os resultados
    let result = format!("OCR:{}\nTRAD:{}\n", ocr_text, translated_text);
    if let Ok(mut last) = LAST_OCR_RESULT.lock() {
        *last = result;
    }

    // 7. Fecha todos os overlays
    for label in app.webview_windows().keys() {
        if label.starts_with("overlay-") {
            if let Some(window) = app.get_webview_window(label) {
                let _ = window.close();
            }
        }
    }

    // 8. Abre janela de resultado
    std::thread::sleep(std::time::Duration::from_millis(200));

    if let Some(window) = app.get_webview_window("result") {
        let _ = window.show();
        let _ = window.set_focus();
    } else {
        let _ = tauri::WebviewWindowBuilder::new(
            &app,
            "result",
            tauri::WebviewUrl::App("/result".into()),
        )
        .inner_size(520.0, 640.0)
        .min_inner_size(400.0, 400.0)
        .resizable(true)
        .decorations(true)
        .center()
        .title("Snipp - Resultado")
        .build();
    }

    Ok(ocr_text)
}

pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            // Esconde a janela ao iniciar
            if let Some(window) = app.get_webview_window("main") {
                let _ =
                    window.navigate(tauri::Url::parse("http://localhost:1420/settings").unwrap());
                let _ = window.set_size(tauri::LogicalSize::new(480.0, 640.0));
                let _ = window.set_resizable(false);
                let _ = window.center();
                let _ = window.show();
                let _ = window.set_focus();
            }

            // 4. Fechar = minimizar pro tray (não sair)
            if let Some(window) = app.get_webview_window("main") {
                let app_handle = app.handle().clone();
                window.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        let _ = app_handle.get_webview_window("main").map(|w| w.hide());
                    }
                });
            }

            // Menu do tray
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

            // 🎯 KEYHOOK - thread separada escutando o teclado
            let app_handle = app.handle().clone();
            std::thread::spawn(move || {
                listen(move |event| match event.event_type {
                    EventType::KeyPress(Key::Alt) | EventType::KeyPress(Key::ControlRight) => {
                        println!("ALT PRESSIONADO");
                        let mut ctrl = ALT_PRESSED.lock().unwrap();
                        *ctrl = true;
                    }
                    EventType::KeyRelease(Key::Alt) | EventType::KeyRelease(Key::ControlRight) => {
                        println!("CTRL SOLTO");
                        let mut ctrl = ALT_PRESSED.lock().unwrap();
                        *ctrl = false;
                    }
                    EventType::KeyPress(Key::ShiftLeft) | EventType::KeyPress(Key::ShiftRight) => {
                        println!("SHIFT PRESSIONADO");
                        let mut shift = SHIFT_PRESSED.lock().unwrap();
                        *shift = true;
                    }
                    EventType::KeyRelease(Key::ShiftLeft)
                    | EventType::KeyRelease(Key::ShiftRight) => {
                        println!("SHIFT SOLTO");
                        let mut shift = SHIFT_PRESSED.lock().unwrap();
                        *shift = false;
                    }
                    EventType::KeyPress(Key::KeyT) => {
                        let ctrl = *ALT_PRESSED.lock().unwrap();
                        let shift = *SHIFT_PRESSED.lock().unwrap();
                        if ctrl && shift {
                            println!("Atalho detectado! Criando overlay");

                            {
                                let mut c = ALT_PRESSED.lock().unwrap();
                                *c = false;
                            }

                            {
                                let mut s = SHIFT_PRESSED.lock().unwrap();
                                *s = false;
                            }

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
                                        .inner_size(size.width as f64, size.height as f64)
                                        .transparent(true)
                                        .decorations(false)
                                        .always_on_top(true)
                                        .build();
                                    }
                                }
                            }
                        }
                    }
                    _ => {}
                })
                .unwrap();
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            show_window,
            close_overlay_windows,
            capture_and_ocr,
            log_coords,
            load_settings,
            save_settings,
            translate_text,
            show_result_window,
            get_last_ocr_result,
            close_result_window,
            show_result,
            capture_region_and_translate
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
