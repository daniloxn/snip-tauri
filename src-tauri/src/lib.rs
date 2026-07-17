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

struct TesseractPaths {
    exe: PathBuf,
    tessdata: PathBuf,
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

    // Descobre qual monitor contém o ponto (x, y)
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

    // Captura só a área selecionada
    let image = target
        .capture_area(rel_x, rel_y, w as u32, h as u32)
        .map_err(|e| e.to_string())?;

    // Salva em arquivo temporário com nome único
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs();
    let temp_path = std::env::temp_dir().join(format!("snipp_{}.png", timestamp));

    image.save(&temp_path).map_err(|e| e.to_string())?;

    println!("📸 Capturado: {}", temp_path.display());
    Ok(temp_path)
}

fn run_ocr(
    app: &tauri::AppHandle,
    image_path: &std::path::Path,
    ocr_lang: &str,
) -> Result<String, String> {
    use std::process::Command;

    let tess_paths = app.state::<TesseractPaths>();

    let output = Command::new(&tess_paths.exe)
        .arg(image_path.to_string_lossy().to_string())
        .arg("stdout")
        .arg("-l")
        .arg(ocr_lang)
        .env("TESSDATA_PREFIX", &tess_paths.tessdata)
        .output()
        .map_err(|e| format!("Erro ao executar Tesseract: {}", e))?;

    println!("🔍 Debug OCR:");
    println!("   exe: {:?}", tess_paths.exe);
    println!("   tessdata: {:?}", tess_paths.tessdata);
    println!("   imagem: {:?}", image_path);
    println!("   lang: {}", ocr_lang);
    println!("   tessdata existe? {}", tess_paths.tessdata.exists());
    println!("   exe existe? {}", tess_paths.exe.exists());
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
fn capture_and_ocr(
    app: tauri::AppHandle,
    x: i32,
    y: i32,
    w: i32,
    h: i32,
    lang: Option<String>,
) -> Result<String, String> {
    let path = capture_area(x, y, w, h)?;
    let ocr_lang = lang.unwrap_or_else(|| "por".to_string());
    let text = run_ocr(&app, &path, &ocr_lang)?;
    let _ = std::fs::remove_file(&path);
    Ok(text)
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

pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            // Resolve caminhos do Tesseract
            let (tesseract_exe, tesseract_tessdata) = {
                // Lista de lugares pra procurar, em ordem de prioridade
                let mut candidates: Vec<(PathBuf, PathBuf)> = Vec::new();

                // 1) Pasta binaries/ do lado do executável (funciona no .exe se colocar junto)
                if let Ok(exe) = std::env::current_exe() {
                    if let Some(exe_dir) = exe.parent() {
                        candidates.push((
                            exe_dir.join("binaries/tesseract.exe"),
                            exe_dir.join("binaries/tessdata"),
                        ));
                    }
                }

                // 2) Resource dir (caminho que o Tauri usa em produção)
                if let Ok(resource) = app.path().resource_dir() {
                    candidates.push((
                        resource.join("binaries/tesseract.exe"),
                        resource.join("binaries/tessdata"),
                    ));
                }

                // 3) Pasta src-tauri/binaries/ relativa ao diretório atual (funciona no dev)
                if let Ok(cwd) = std::env::current_dir() {
                    candidates.push((
                        cwd.join("src-tauri/binaries/tesseract.exe"),
                        cwd.join("src-tauri/binaries/tessdata"),
                    ));
                }

                // 4) Instalação padrão do Windows
                candidates.push((
                    PathBuf::from(r"C:\Program Files\Tesseract-OCR\tesseract.exe"),
                    PathBuf::from(r"C:\Program Files\Tesseract-OCR\tessdata"),
                ));

                // Procura o primeiro que existe
                let mut found = None;
                for (exe_path, tess_path) in &candidates {
                    if exe_path.exists() && tess_path.exists() {
                        println!("✅ Tesseract encontrado em: {:?}", exe_path);
                        found = Some((exe_path.clone(), tess_path.clone()));
                        break;
                    }
                }

                found.unwrap_or_else(|| {
                    eprintln!("⚠️ Tesseract não encontrado em nenhum lugar!");
                    eprintln!("   Crie a pasta src-tauri/binaries/ com tesseract.exe e tessdata/");
                    // Retorna o último candidato mesmo assim — o erro vai aparecer naturalmente
                    candidates.last().cloned().unwrap()
                })
            };

            app.manage(TesseractPaths {
                exe: tesseract_exe,
                tessdata: tesseract_tessdata,
            });

            println!(
                "🔧 Usando Tesseract: {:?}",
                app.state::<TesseractPaths>().exe
            );
            println!(
                "🔧 Usando tessdata: {:?}",
                app.state::<TesseractPaths>().tessdata
            );

            // Configura a janela principal — a rota é decidida pelo frontend
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_size(tauri::LogicalSize::new(480.0, 640.0));
                let _ = window.set_resizable(false);
                let _ = window.center();
                let _ = window.show();
                let _ = window.set_focus();
            }

            // Fechar = minimizar pro tray (não sair)
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
            log_coords,
            load_settings,
            save_settings,
            translate_text_cmd,
            capture_and_ocr,
            show_result_window,
            get_last_ocr_result,
            close_result_window,
            show_result
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
