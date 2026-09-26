use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};
use std::str::FromStr;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{Emitter, Manager};

#[cfg(windows)]
pub mod win_ocr {
    use windows::{
        core::HSTRING,
        Globalization::Language,
        Graphics::Imaging::BitmapDecoder,
        Media::Ocr::OcrEngine,
        Storage::Streams::{DataWriter, InMemoryRandomAccessStream},
    };

    pub fn run_windows_ocr(png_bytes: &[u8], lang_tag: Option<&str>) -> Result<String, String> {
        let stream = InMemoryRandomAccessStream::new()
            .map_err(|e| format!("Falha ao criar stream WinRT: {}", e))?;

        let writer = DataWriter::CreateDataWriter(&stream)
            .map_err(|e| format!("Falha ao criar DataWriter: {}", e))?;

        writer
            .WriteBytes(png_bytes)
            .map_err(|e| format!("Falha ao escrever bytes no DataWriter: {}", e))?;

        writer
            .StoreAsync()
            .map_err(|e| format!("Falha ao armazenar buffer: {}", e))?
            .get()
            .map_err(|e| format!("Falha no StoreAsync: {}", e))?;

        writer
            .FlushAsync()
            .map_err(|e| format!("Falha ao descarregar buffer: {}", e))?
            .get()
            .map_err(|e| format!("Falha no FlushAsync: {}", e))?;

        stream
            .Seek(0)
            .map_err(|e| format!("Falha ao posicionar stream: {}", e))?;

        let decoder = BitmapDecoder::CreateAsync(&stream)
            .map_err(|e| format!("Falha ao decodificar imagem: {}", e))?
            .get()
            .map_err(|e| format!("Falha ao obter decoder: {}", e))?;

        let software_bitmap = decoder
            .GetSoftwareBitmapAsync()
            .map_err(|e| format!("Falha ao obter SoftwareBitmap: {}", e))?
            .get()
            .map_err(|e| format!("Falha no GetSoftwareBitmapAsync: {}", e))?;

        let engine = if let Some(tag) = lang_tag {
            let trimmed = tag.trim();
            if !trimmed.is_empty() && trimmed != "auto" {
                let win_lang = Language::CreateLanguage(&HSTRING::from(trimmed))
                    .map_err(|e| format!("Idioma inválido '{}': {}", trimmed, e))?;
                if OcrEngine::IsLanguageSupported(&win_lang).unwrap_or(false) {
                    OcrEngine::TryCreateFromLanguage(&win_lang)
                        .map_err(|e| format!("Falha ao criar motor OCR para '{}': {}", trimmed, e))?
                } else {
                    OcrEngine::TryCreateFromUserProfileLanguages()
                        .map_err(|e| format!("Falha ao inicializar OCR do usuário: {}", e))?
                }
            } else {
                OcrEngine::TryCreateFromUserProfileLanguages()
                    .map_err(|e| format!("Falha ao inicializar OCR do usuário: {}", e))?
            }
        } else {
            OcrEngine::TryCreateFromUserProfileLanguages()
                .map_err(|e| format!("Falha ao inicializar OCR do usuário: {}", e))?
        };

        let ocr_op = engine
            .RecognizeAsync(&software_bitmap)
            .map_err(|e| format!("Falha ao disparar OCR: {}", e))?;

        let ocr_result = ocr_op
            .get()
            .map_err(|e| format!("Falha ao processar OCR: {}", e))?;

        let text = ocr_result
            .Text()
            .map_err(|e| format!("Falha ao extrair texto: {}", e))?
            .to_string();

        let trimmed = text.trim().to_string();
        if trimmed.is_empty() {
            Ok("(nenhum texto encontrado)".to_string())
        } else {
            Ok(trimmed)
        }
    }

    #[derive(serde::Serialize, Clone, Debug)]
    pub struct OcrLanguageInfo {
        pub tag: String,
        pub display_name: String,
    }

    pub fn get_available_languages() -> Vec<OcrLanguageInfo> {
        let mut list = Vec::new();
        if let Ok(languages) = OcrEngine::AvailableRecognizerLanguages() {
            for lang in languages {
                if let Ok(tag_hstring) = lang.LanguageTag() {
                    let tag = tag_hstring.to_string();
                    let display_name = lang
                        .DisplayName()
                        .map(|d| d.to_string())
                        .unwrap_or_else(|_| tag.clone());
                    if !tag.is_empty() {
                        list.push(OcrLanguageInfo { tag, display_name });
                    }
                }
            }
        }
        list
    }
}


static LAST_OCR_RESULT: Mutex<String> = Mutex::new(String::new());

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AppSettings {
    pub deepl_api_key: String,
    pub ocr_lang: String,
    pub translate_to: String,
    pub shortcut: String,
    #[serde(default = "default_selection_shortcut")]
    pub selection_shortcut: String,
    pub ocr_mode: String, // "online" ou "local"
    pub gemini_api_key: String,
}

fn default_selection_shortcut() -> String {
    "Ctrl+Shift+D".to_string()
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct HistoryItem {
    pub id: String,
    pub timestamp: String,
    pub original_text: String,
    pub translated_text: String,
    pub ocr_lang: String,
    pub target_lang: String,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            deepl_api_key: String::new(),
            ocr_lang: "auto".to_string(),
            translate_to: "pt-BR".to_string(),
            shortcut: "Ctrl+Shift+S".to_string(),
            selection_shortcut: "Ctrl+Shift+D".to_string(),
            ocr_mode: "local".to_string(),
            gemini_api_key: String::new(),
        }
    }
}

fn settings_path(app: &tauri::AppHandle) -> PathBuf {
    let dir = app.path().app_config_dir().unwrap();
    std::fs::create_dir_all(&dir).unwrap();
    dir.join("settings.json")
}

fn history_path(app: &tauri::AppHandle) -> PathBuf {
    let dir = app.path().app_config_dir().unwrap();
    std::fs::create_dir_all(&dir).unwrap();
    dir.join("history.json")
}

#[tauri::command]
fn get_history(app: tauri::AppHandle) -> Vec<HistoryItem> {
    let path = history_path(&app);
    if path.exists() {
        let content = fs::read_to_string(&path).unwrap_or_default();
        serde_json::from_str(&content).unwrap_or_default()
    } else {
        Vec::new()
    }
}

#[tauri::command]
fn clear_history(app: tauri::AppHandle) -> Result<(), String> {
    let path = history_path(&app);
    let empty: Vec<HistoryItem> = Vec::new();
    let json = serde_json::to_string_pretty(&empty).map_err(|e| e.to_string())?;
    fs::write(&path, json).map_err(|e| e.to_string())?;
    Ok(())
}

fn save_history_item(app: &tauri::AppHandle, item: HistoryItem) {
    let path = history_path(app);
    let mut list: Vec<HistoryItem> = if path.exists() {
        let content = fs::read_to_string(&path).unwrap_or_default();
        serde_json::from_str(&content).unwrap_or_default()
    } else {
        Vec::new()
    };

    // Mantém as últimas 100 capturas, inserindo a mais recente no topo
    list.insert(0, item);
    if list.len() > 100 {
        list.truncate(100);
    }

    if let Ok(json) = serde_json::to_string_pretty(&list) {
        let _ = fs::write(&path, json);
    }
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

    let _ = app.global_shortcut().unregister_all();
    if let Ok(shortcut) = Shortcut::from_str(&settings.shortcut) {
        if let Err(e) = app.global_shortcut().register(shortcut) {
            eprintln!("Erro ao registrar atalho de recorte: {}", e);
        }
    }
    if let Ok(sel_shortcut) = Shortcut::from_str(&settings.selection_shortcut) {
        if let Err(e) = app.global_shortcut().register(sel_shortcut) {
            eprintln!("Erro ao registrar atalho de seleção: {}", e);
        }
    }
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
    let _ = app.emit("reset-overlay", ());
    let labels: Vec<String> = app
        .webview_windows()
        .keys()
        .filter(|l| l.starts_with("overlay"))
        .cloned()
        .collect();
    for label in labels {
        if let Some(window) = app.get_webview_window(&label) {
            let _ = window.hide();
        }
    }
}

#[tauri::command]
fn read_clipboard() -> Result<String, String> {
    let mut clipboard = arboard::Clipboard::new().map_err(|e| format!("Falha ao acessar área de transferência: {}", e))?;
    let text = clipboard.get_text().unwrap_or_default();
    Ok(text)
}

#[tauri::command]
fn copy_to_clipboard(text: String) -> Result<(), String> {
    if let Ok(mut clipboard) = arboard::Clipboard::new() {
        let _ = clipboard.set_text(&text);
    }
    println!("📋 Copiado para o clipboard ({} caracteres)", text.len());
    Ok(())
}

fn translate_text(text: &str, deepl_key: &str, gemini_key: &str, target_lang: &str) -> Result<String, String> {
    let trimmed = text.trim();
    if trimmed.is_empty() || trimmed == "(nenhum texto encontrado)" {
        return Ok(String::new());
    }

    if !deepl_key.is_empty() {
        let clean_lang = target_lang.trim().to_uppercase();
        let normalized_target = match clean_lang.as_str() {
            "EN" | "EN-US" => "EN-US".to_string(),
            "EN-GB" => "EN-GB".to_string(),
            "PT" | "PT-BR" => "PT-BR".to_string(),
            "PT-PT" => "PT-PT".to_string(),
            "ES" | "ES-ES" => "ES".to_string(),
            "FR" | "FR-FR" => "FR".to_string(),
            "DE" | "DE-DE" => "DE".to_string(),
            "IT" | "IT-IT" => "IT".to_string(),
            other => other.split('-').next().unwrap_or(other).to_string(),
        };

        let client = reqwest::blocking::Client::new();
        let res = client
            .post("https://api-free.deepl.com/v2/translate")
            .header("Authorization", format!("DeepL-Auth-Key {}", deepl_key))
            .json(&serde_json::json!({
                "text": [trimmed],
                "target_lang": normalized_target,
            }))
            .send();
            
        if let Ok(response) = res {
            if response.status().is_success() {
                if let Ok(json) = response.json::<serde_json::Value>() {
                    if let Some(arr) = json["translations"].as_array() {
                        if !arr.is_empty() {
                            if let Some(t) = arr[0]["text"].as_str() {
                                println!("🌐 Traduzido (DeepL): {}", t);
                                return Ok(t.to_string());
                            }
                        }
                    }
                }
            }
        }
        println!("⚠️ DeepL falhou, tentando fallback (Google Translate)...");
    }

    {
        let client = reqwest::blocking::Client::new();
        let tl = target_lang.to_lowercase().split('-').next().unwrap_or("en").to_string();
        let url = format!(
            "https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl={}&dt=t&q={}",
            tl,
            urlencoding::encode(trimmed)
        );
        let res = client.get(&url).send();
        if let Ok(response) = res {
            if response.status().is_success() {
                if let Ok(json) = response.json::<serde_json::Value>() {
                    let mut full_text = String::new();
                    if let Some(arr) = json[0].as_array() {
                        for item in arr {
                            if let Some(part) = item[0].as_str() {
                                full_text.push_str(part);
                            }
                        }
                        if !full_text.is_empty() {
                            println!("🌐 Traduzido (Google): {}", full_text);
                            return Ok(full_text);
                        }
                    }
                }
            }
        }
        println!("⚠️ Google Translate falhou, tentando fallback (Gemini)...");
    }

    if !gemini_key.is_empty() {
        let client = reqwest::blocking::Client::new();
        let prompt = format!("Traduza o seguinte texto para o idioma '{}'. Retorne APENAS a tradução final, sem aspas, sem explicações:\n\n{}", target_lang, trimmed);
        
        let models = ["gemini-2.5-flash", "gemini-1.5-flash"];
        for model in models {
            let res = client
                .post(format!(
                    "https://generativelanguage.googleapis.com/v1beta/models/{}:generateContent?key={}",
                    model, gemini_key
                ))
                .json(&serde_json::json!({
                    "contents": [{
                        "parts": [{"text": prompt}]
                    }]
                }))
                .send();

            if let Ok(response) = res {
                if response.status().is_success() {
                    if let Ok(json) = response.json::<serde_json::Value>() {
                        if let Some(cands) = json["candidates"].as_array() {
                            if !cands.is_empty() {
                                if let Some(t) = cands[0]["content"]["parts"][0]["text"].as_str() {
                                    let t = t.trim().to_string();
                                    println!("🌐 Traduzido (Gemini - {}): {}", model, t);
                                    return Ok(t);
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    Err("Todas as APIs de tradução falharam.".to_string())
}

#[tauri::command]
fn translate_text_cmd(
    app: tauri::AppHandle,
    text: String,
    target_lang: Option<String>,
) -> Result<String, String> {
    let settings = load_settings(app.clone());
    let lang = target_lang.unwrap_or(settings.translate_to);
    let result = translate_text(&text, &settings.deepl_api_key, &settings.gemini_api_key, &lang)?;
    
    // Salva no histórico se não for vazio
    let original_trimmed = text.trim();
    let result_trimmed = result.trim();
    if !original_trimmed.is_empty() && !result_trimmed.is_empty() {
        let item = HistoryItem {
            id: chrono::Local::now().timestamp_millis().to_string(),
            timestamp: chrono::Local::now().format("%d/%m/%Y %H:%M").to_string(),
            original_text: original_trimmed.to_string(),
            translated_text: result_trimmed.to_string(),
            ocr_lang: settings.ocr_lang,
            target_lang: lang,
        };
        save_history_item(&app, item);
    }

    Ok(result)
}

fn capture_area_to_png_bytes(x: i32, y: i32, w: i32, h: i32) -> Result<Vec<u8>, String> {
    use screenshots::Screen;

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

    let disp_w = target.display_info.width as i32;
    let disp_h = target.display_info.height as i32;

    let rel_x = x - target.display_info.x as i32;
    let rel_y = y - target.display_info.y as i32;

    // Adiciona padding vertical e horizontal para garantir baseline do OCR e contornar limite mínimo de 40x40 do WinRT
    let pad_y = if h < 60 { 20 } else { 8 };
    let pad_x = if w < 60 { 20 } else { 8 };

    let mut crop_x = (rel_x - pad_x).max(0);
    let mut crop_y = (rel_y - pad_y).max(0);
    let mut crop_w = (w + pad_x * 2).min(disp_w - crop_x);
    let mut crop_h = (h + pad_y * 2).min(disp_h - crop_y);

    // Garante dimensões mínimas absolutas de 60px respeitando o monitor
    if crop_w < 60 {
        crop_w = 60.min(disp_w);
        if crop_x + crop_w > disp_w {
            crop_x = (disp_w - crop_w).max(0);
        }
    }
    if crop_h < 60 {
        crop_h = 60.min(disp_h);
        if crop_y + crop_h > disp_h {
            crop_y = (disp_h - crop_h).max(0);
        }
    }

    let image = target
        .capture_area(crop_x, crop_y, crop_w as u32, crop_h as u32)
        .map_err(|e| e.to_string())?;

    // Se a altura for pequena (< 80px), faz um upscale 2x suave para facilitar a leitura de caracteres pequenos
    let processed_image = if crop_h < 80 {
        use screenshots::image::imageops::{resize, FilterType};
        resize(&image, crop_w as u32 * 2, crop_h as u32 * 2, FilterType::Lanczos3)
    } else {
        image
    };

    let mut png_bytes = Vec::new();
    processed_image
        .write_to(
            &mut std::io::Cursor::new(&mut png_bytes),
            screenshots::image::ImageFormat::Png,
        )
        .map_err(|e| format!("Erro ao codificar PNG em memória: {}", e))?;

    println!("📸 Capturado em RAM: {} bytes (crop: {}x{} original: {}x{})", png_bytes.len(), crop_w, crop_h, w, h);
    Ok(png_bytes)
}

fn run_ocr_online(image_bytes: &[u8], api_key: &str) -> Result<String, String> {
    use base64::Engine;
    let b64 = base64::engine::general_purpose::STANDARD.encode(image_bytes);

    let client = reqwest::blocking::Client::new();
    let models = ["gemini-2.5-flash", "gemini-1.5-flash"];
    let mut last_error = String::new();

    for model in models {
        let response = client
            .post(format!(
                "https://generativelanguage.googleapis.com/v1beta/models/{}:generateContent?key={}",
                model, api_key
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
            .send();

        match response {
            Ok(res) => {
                if res.status().is_success() {
                    if let Ok(result) = res.json::<serde_json::Value>() {
                        let text = result["candidates"][0]["content"]["parts"][0]["text"]
                            .as_str()
                            .unwrap_or("(nenhum texto encontrado)")
                            .to_string();
                        println!("☁️ OCR Online ({}): {}", model, text);
                        return Ok(text.trim().to_string());
                    }
                } else {
                    let status = res.status();
                    let body = res.text().unwrap_or_default();
                    last_error = format!("Gemini ({}) retornou erro {}: {}", model, status, body);
                    println!("⚠️ Fallback OCR: {}", last_error);
                }
            }
            Err(e) => {
                last_error = format!("Erro na requisição ({}) : {}", model, e);
            }
        }
    }

    Err(last_error)
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
    let png_bytes = capture_area_to_png_bytes(x, y, w, h)?;
    let settings = load_settings(app.clone());
    let ocr_lang = lang.unwrap_or(settings.ocr_lang);

    let text = if settings.ocr_mode == "online" {
        if settings.gemini_api_key.is_empty() {
            return Err(
                "Gemini API Key não configurada. Vá em Configurações > OCR > Chave da API."
                    .to_string(),
            );
        }
        run_ocr_online(&png_bytes, &settings.gemini_api_key)?
    } else {
        #[cfg(windows)]
        {
            win_ocr::run_windows_ocr(&png_bytes, Some(&ocr_lang))?
        }
        #[cfg(not(windows))]
        {
            return Err("OCR local suportado atualmente apenas no Windows".to_string());
        }
    };

    Ok(text)
}

#[tauri::command]
fn get_available_ocr_languages() -> Vec<win_ocr::OcrLanguageInfo> {
    #[cfg(windows)]
    {
        win_ocr::get_available_languages()
    }
    #[cfg(not(windows))]
    {
        Vec::new()
    }
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

pub fn run() {
    tauri::Builder::default()
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    if event.state() == ShortcutState::Pressed {
                        let settings = load_settings(app.clone());
                        let target_sel = Shortcut::from_str(&settings.selection_shortcut).ok();

                        if Some(shortcut) == target_sel.as_ref() {
                            println!("📝 Atalho de Tradução Direta de Seleção detectado!");
                            let _ = app.emit("translate-selection", ());
                            for (label, window) in app.webview_windows() {
                                if label.starts_with("overlay") {
                                    let _ = window.show();
                                    let _ = window.set_focus();
                                }
                            }
                        } else {
                            println!("🎯 Atalho de Recorte detectado! Exibindo overlay...");
                            let _ = app.emit("reset-overlay", ());
                            for (label, window) in app.webview_windows() {
                                if label.starts_with("overlay") {
                                    let _ = window.show();
                                    let _ = window.set_focus();
                                }
                            }
                        }
                    }
                })
                .build(),
        )
        .setup(|app| {
            println!("🚀 Inicializando Snip-Tauri com Windows.Media.Ocr nativo...");

            let saved = load_settings(app.handle().clone());

            if let Some(window) = app.get_webview_window("main") {
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

            if let Ok(monitors) = app.handle().available_monitors() {
                for (i, monitor) in monitors.iter().enumerate() {
                    let pos = monitor.position();
                    let size = monitor.size();
                    let label = format!("overlay-{}", i);
                    
                    let window = tauri::WebviewWindowBuilder::new(
                        app.handle(),
                        &label,
                        tauri::WebviewUrl::App("/overlay".into()),
                    )
                    .position(pos.x as f64, pos.y as f64)
                    .inner_size(size.width as f64, size.height as f64)
                    .transparent(true)
                    .decorations(false)
                    .always_on_top(true)
                    .visible(false)
                    .build();
                    
                    if let Ok(w) = window {
                        let _ = w.hide();
                    }
                }
            }

            let show = tauri::menu::MenuItem::with_id(app, "show", "Abrir Janela", true, None::<&str>)?;
            let quit = tauri::menu::MenuItem::with_id(app, "quit", "Sair", true, None::<&str>)?;
            let menu = tauri::menu::Menu::with_items(app, &[&show, &quit])?;

            tauri::tray::TrayIconBuilder::new()
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

            if let Ok(shortcut) = Shortcut::from_str(&saved.shortcut) {
                let _ = app.handle().global_shortcut().register(shortcut);
            }
            if let Ok(sel_shortcut) = Shortcut::from_str(&saved.selection_shortcut) {
                let _ = app.handle().global_shortcut().register(sel_shortcut);
            }

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
            get_available_ocr_languages,
            copy_to_clipboard,
            read_clipboard,
            get_history,
            clear_history,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
