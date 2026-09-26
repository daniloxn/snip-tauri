import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

interface Settings {
  deepl_api_key: string;
  ocr_lang: string;
  translate_to: string;
  shortcut: string;
  selection_shortcut: string;
  ocr_mode: string;
  gemini_api_key: string;
}

interface OcrLanguageInfo {
  tag: string;
  display_name: string;
}

interface HistoryItem {
  id: string;
  timestamp: string;
  original_text: string;
  translated_text: string;
  ocr_lang: string;
  target_lang: string;
}

const modifierKeys = ["Ctrl", "Shift", "Alt", "Win"] as const;
const mainKeys = [
  { label: "A", value: "A" },
  { label: "B", value: "B" },
  { label: "C", value: "C" },
  { label: "D", value: "D" },
  { label: "E", value: "E" },
  { label: "F", value: "F" },
  { label: "G", value: "G" },
  { label: "H", value: "H" },
  { label: "I", value: "I" },
  { label: "J", value: "J" },
  { label: "K", value: "K" },
  { label: "L", value: "L" },
  { label: "M", value: "M" },
  { label: "N", value: "N" },
  { label: "O", value: "O" },
  { label: "P", value: "P" },
  { label: "Q", value: "Q" },
  { label: "R", value: "R" },
  { label: "S", value: "S" },
  { label: "T", value: "T" },
  { label: "U", value: "U" },
  { label: "V", value: "V" },
  { label: "W", value: "W" },
  { label: "X", value: "X" },
  { label: "Y", value: "Y" },
  { label: "Z", value: "Z" },
  { label: "Espaço", value: "Space" },
  { label: "Enter", value: "Enter" },
  { label: "Tab", value: "Tab" },
  { label: "Esc", value: "Escape" },
  { label: "Delete", value: "Delete" },
  ...Array.from({ length: 12 }, (_, i) => ({
    label: `F${i + 1}`,
    value: `F${i + 1}`,
  })),
];

const TARGET_LANGUAGES = [
  { code: "pt-BR", label: "Português (Brasil)", flag: "🇧🇷" },
  { code: "en-US", label: "Inglês (EUA)", flag: "🇺🇸" },
  { code: "es-ES", label: "Espanhol", flag: "🇪🇸" },
  { code: "fr-FR", label: "Francês", flag: "🇫🇷" },
  { code: "de-DE", label: "Alemão", flag: "🇩🇪" },
  { code: "it-IT", label: "Italiano", flag: "🇮🇹" },
  { code: "ja-JP", label: "Japonês", flag: "🇯🇵" },
  { code: "zh-CN", label: "Chinês (Simplificado)", flag: "🇨🇳" },
  { code: "ru-RU", label: "Russo", flag: "🇷🇺" },
];

export default function SettingsView() {
  const [activeTab, setActiveTab] = useState<"general" | "shortcuts" | "history">("general");
  const [historyList, setHistoryList] = useState<HistoryItem[]>([]);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const [settings, setSettings] = useState<Settings>({
    deepl_api_key: "",
    ocr_lang: "auto",
    translate_to: "pt-BR",
    shortcut: "Ctrl+Shift+S",
    selection_shortcut: "Ctrl+Shift+D",
    ocr_mode: "local",
    gemini_api_key: "",
  });

  const [availableLanguages, setAvailableLanguages] = useState<OcrLanguageInfo[]>([]);
  const [saved, setSaved] = useState(false);
  const [showDeeplKey, setShowDeeplKey] = useState(false);
  const [deeplKeyTemp, setDeeplKeyTemp] = useState("");
  const [showGeminiKey, setShowGeminiKey] = useState(false);
  const [geminiKeyTemp, setGeminiKeyTemp] = useState("");

  const [selectedModifiers, setSelectedModifiers] = useState<string[]>(["Ctrl", "Shift"]);
  const [selectedKey, setSelectedKey] = useState("S");
  const [selectedSelModifiers, setSelectedSelModifiers] = useState<string[]>(["Ctrl", "Shift"]);
  const [selectedSelKey, setSelectedSelKey] = useState("D");

  useEffect(() => {
    loadSettings();
    invoke<OcrLanguageInfo[]>("get_available_ocr_languages")
      .then((langs) => {
        if (langs && langs.length > 0) setAvailableLanguages(langs);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const shortcut = [...selectedModifiers, selectedKey].join("+");
    setSettings((prev) => ({ ...prev, shortcut }));
  }, [selectedModifiers, selectedKey]);

  useEffect(() => {
    const selection_shortcut = [...selectedSelModifiers, selectedSelKey].join("+");
    setSettings((prev) => ({ ...prev, selection_shortcut }));
  }, [selectedSelModifiers, selectedSelKey]);

  async function loadSettings() {
    try {
      const s = await invoke<Settings>("load_settings");
      setSettings(s);
      setDeeplKeyTemp(s.deepl_api_key || "");
      setGeminiKeyTemp(s.gemini_api_key || "");

      const parts = (s.shortcut || "Ctrl+Shift+S").split("+");
      setSelectedModifiers(parts.filter((p) => modifierKeys.includes(p as any)));
      setSelectedKey(parts.find((p) => !modifierKeys.includes(p as any)) || "S");

      const selParts = (s.selection_shortcut || "Ctrl+Shift+D").split("+");
      setSelectedSelModifiers(selParts.filter((p) => modifierKeys.includes(p as any)));
      setSelectedSelKey(selParts.find((p) => !modifierKeys.includes(p as any)) || "D");
    } catch (err) {
      console.error("Erro ao carregar settings:", err);
    }
  }

  async function loadHistory() {
    try {
      const items = await invoke<HistoryItem[]>("get_history");
      setHistoryList(items || []);
    } catch (err) {
      console.error("Erro ao carregar histórico:", err);
    }
  }

  async function handleClearHistory() {
    try {
      await invoke("clear_history");
      setHistoryList([]);
    } catch (err) {
      console.error("Erro ao limpar histórico:", err);
    }
  }

  async function copyHistoryText(text: string, id: string) {
    try {
      await invoke("copy_to_clipboard", { text });
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 1600);
    } catch (err) {
      console.error("Erro ao copiar:", err);
    }
  }

  useEffect(() => {
    if (activeTab === "history") {
      loadHistory();
    }
  }, [activeTab]);

  async function saveSettings() {
    try {
      const updatedSettings = {
        ...settings,
        deepl_api_key: deeplKeyTemp.trim(),
        gemini_api_key: geminiKeyTemp.trim(),
      };
      await invoke("save_settings", { settings: updatedSettings });
      setSettings(updatedSettings);
      setSaved(true);
      setTimeout(() => setSaved(false), 2400);
    } catch (err) {
      console.error("Erro ao salvar:", err);
    }
  }

  function toggleModifier(mod: string) {
    setSelectedModifiers((prev) =>
      prev.includes(mod) ? prev.filter((m) => m !== mod) : [...prev, mod]
    );
  }

  function toggleSelModifier(mod: string) {
    setSelectedSelModifiers((prev) =>
      prev.includes(mod) ? prev.filter((m) => m !== mod) : [...prev, mod]
    );
  }

  return (
    <div
      style={{
        width: "100%",
        height: "100vh",
        background: "radial-gradient(ellipse 90% 80% at 50% -20%, rgba(56, 189, 248, 0.08), transparent), #090a0f",
        color: "#f8fafc",
        fontFamily: "'Inter', system-ui, -apple-system, sans-serif",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      {/* Header Impeccable */}
      <header
        style={{
          padding: "18px 32px 0",
          borderBottom: "1px solid rgba(255, 255, 255, 0.07)",
          background: "rgba(13, 15, 22, 0.8)",
          backdropFilter: "blur(20px)",
          flexShrink: 0,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <div
              style={{
                width: 38,
                height: 38,
                borderRadius: 10,
                background: "linear-gradient(135deg, #38bdf8 0%, #0284c7 100%)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 20,
                boxShadow: "0 0 20px rgba(56, 189, 248, 0.35)",
              }}
            >
              ⚡
            </div>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 18, fontWeight: 800, letterSpacing: "-0.03em", color: "#f8fafc" }}>
                  Snipp
                </span>
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    padding: "2px 8px",
                    borderRadius: 999,
                    background: "rgba(56, 189, 248, 0.12)",
                    color: "#38bdf8",
                    border: "1px solid rgba(56, 189, 248, 0.25)",
                    letterSpacing: "0.02em",
                  }}
                >
                  PRO v0.2
                </span>
              </div>
              <p style={{ margin: "2px 0 0", fontSize: 12, color: "#94a3b8", fontWeight: 400 }}>
                OCR Nativo em RAM e Tradução Neural Instantânea
              </p>
            </div>
          </div>

          <button
            onClick={saveSettings}
            style={{
              padding: "8px 20px",
              background: saved ? "#10b981" : "linear-gradient(135deg, #38bdf8 0%, #0284c7 100%)",
              color: saved ? "#ffffff" : "#041426",
              border: "none",
              borderRadius: 8,
              fontSize: 13,
              fontWeight: 700,
              cursor: "pointer",
              transition: "all 0.2s cubic-bezier(0.16, 1, 0.3, 1)",
              boxShadow: saved ? "0 0 20px rgba(16, 185, 129, 0.4)" : "0 0 20px rgba(56, 189, 248, 0.35)",
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            {saved ? "✓ Salvo!" : "💾 Salvar Configurações"}
          </button>
        </div>

        {/* Tab Navigation */}
        <div style={{ display: "flex", gap: 4 }}>
          {[
            { id: "general", label: "Geral & Motores", icon: "⚙️" },
            { id: "shortcuts", label: "Teclas de Atalho", icon: "⌨️" },
            { id: "history", label: "Histórico", icon: "🗂️", badge: historyList.length },
          ].map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                style={{
                  background: "transparent",
                  border: "none",
                  borderBottom: isActive ? "2px solid #38bdf8" : "2px solid transparent",
                  color: isActive ? "#38bdf8" : "#94a3b8",
                  fontWeight: isActive ? 700 : 500,
                  fontSize: 13,
                  padding: "10px 16px",
                  cursor: "pointer",
                  transition: "all 0.15s ease",
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                <span>{tab.icon}</span>
                {tab.label}
                {tab.badge !== undefined && tab.badge > 0 && (
                  <span
                    style={{
                      background: "rgba(56, 189, 248, 0.15)",
                      color: "#38bdf8",
                      borderRadius: 10,
                      fontSize: 11,
                      padding: "1px 7px",
                      fontWeight: 700,
                    }}
                  >
                    {tab.badge}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </header>

      {/* Main Body */}
      <main
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "28px 32px",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
        }}
      >
        <div style={{ width: "100%", maxWidth: 720, display: "flex", flexDirection: "column", gap: 20 }}>
          {/* TAB 1: GERAL & MOTORES */}
          {activeTab === "general" && (
            <>
              {/* Card Idiomas */}
              <section
                style={{
                  background: "rgba(18, 22, 34, 0.7)",
                  border: "1px solid rgba(255, 255, 255, 0.08)",
                  borderRadius: 14,
                  padding: 22,
                  boxShadow: "0 10px 30px rgba(0, 0, 0, 0.35)",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
                  <div
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: 6,
                      background: "rgba(56, 189, 248, 0.1)",
                      color: "#38bdf8",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 14,
                    }}
                  >
                    🌐
                  </div>
                  <div>
                    <h2 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: "#f8fafc", letterSpacing: "-0.01em" }}>
                      Idiomas do Sistema
                    </h2>
                    <p style={{ margin: "2px 0 0", fontSize: 12, color: "#94a3b8" }}>
                      Valores padrão ao ativar recorte ou captura de área
                    </p>
                  </div>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                  <div>
                    <label style={{ fontSize: 12, fontWeight: 600, color: "#94a3b8", display: "block", marginBottom: 6 }}>
                      Idioma de Origem (OCR)
                    </label>
                    <select
                      value={settings.ocr_lang}
                      onChange={(e) => setSettings((p) => ({ ...p, ocr_lang: e.target.value }))}
                      style={{
                        width: "100%",
                        padding: "10px 14px",
                        background: "rgba(9, 11, 17, 0.8)",
                        border: "1px solid rgba(255, 255, 255, 0.12)",
                        borderRadius: 8,
                        color: "#f8fafc",
                        fontSize: 13,
                        fontWeight: 500,
                        outline: "none",
                        cursor: "pointer",
                      }}
                    >
                      <option value="auto">🌐 Detecção Automática (Perfil do Windows)</option>
                      {availableLanguages.length > 0 ? (
                        availableLanguages.map((l) => (
                          <option key={l.tag} value={l.tag}>
                            {l.display_name} ({l.tag})
                          </option>
                        ))
                      ) : (
                        <>
                          <option value="pt-BR">Português (Brasil)</option>
                          <option value="en-US">Inglês (EUA)</option>
                          <option value="es-ES">Espanhol</option>
                          <option value="fr-FR">Francês</option>
                          <option value="de-DE">Alemão</option>
                          <option value="it-IT">Italiano</option>
                        </>
                      )}
                    </select>
                  </div>

                  <div>
                    <label style={{ fontSize: 12, fontWeight: 600, color: "#94a3b8", display: "block", marginBottom: 6 }}>
                      Traduzir Para (Padrão)
                    </label>
                    <select
                      value={settings.translate_to}
                      onChange={(e) => setSettings((p) => ({ ...p, translate_to: e.target.value }))}
                      style={{
                        width: "100%",
                        padding: "10px 14px",
                        background: "rgba(9, 11, 17, 0.8)",
                        border: "1px solid rgba(56, 189, 248, 0.35)",
                        borderRadius: 8,
                        color: "#38bdf8",
                        fontSize: 13,
                        fontWeight: 700,
                        outline: "none",
                        cursor: "pointer",
                      }}
                    >
                      {TARGET_LANGUAGES.map((lang) => (
                        <option key={lang.code} value={lang.code}>
                          {lang.flag} {lang.label} ({lang.code})
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </section>

              {/* Card Modo de OCR */}
              <section
                style={{
                  background: "rgba(18, 22, 34, 0.7)",
                  border: "1px solid rgba(255, 255, 255, 0.08)",
                  borderRadius: 14,
                  padding: 22,
                  boxShadow: "0 10px 30px rgba(0, 0, 0, 0.35)",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
                  <div
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: 6,
                      background: "rgba(56, 189, 248, 0.1)",
                      color: "#38bdf8",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 14,
                    }}
                  >
                    🧠
                  </div>
                  <div>
                    <h2 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: "#f8fafc", letterSpacing: "-0.01em" }}>
                      Motor de Extração OCR
                    </h2>
                    <p style={{ margin: "2px 0 0", fontSize: 12, color: "#94a3b8" }}>
                      Escolha a tecnologia responsável por reconhecer caracteres
                    </p>
                  </div>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <button
                    onClick={() => setSettings((p) => ({ ...p, ocr_mode: "local" }))}
                    style={{
                      padding: "16px 18px",
                      background:
                        settings.ocr_mode === "local"
                          ? "linear-gradient(180deg, rgba(56, 189, 248, 0.14) 0%, rgba(56, 189, 248, 0.04) 100%)"
                          : "rgba(9, 11, 17, 0.6)",
                      border:
                        settings.ocr_mode === "local"
                          ? "1.5px solid #38bdf8"
                          : "1px solid rgba(255, 255, 255, 0.08)",
                      borderRadius: 10,
                      textAlign: "left",
                      cursor: "pointer",
                      transition: "all 0.2s cubic-bezier(0.16, 1, 0.3, 1)",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                      <span style={{ fontSize: 13, fontWeight: 700, color: settings.ocr_mode === "local" ? "#38bdf8" : "#f8fafc" }}>
                        💻 Windows WinRT (Nativo)
                      </span>
                      {settings.ocr_mode === "local" && (
                        <span style={{ fontSize: 10, padding: "2px 6px", background: "rgba(56, 189, 248, 0.2)", color: "#38bdf8", borderRadius: 4, fontWeight: 700 }}>
                          RECOMENDADO
                        </span>
                      )}
                    </div>
                    <p style={{ margin: "6px 0 0", fontSize: 11, color: "#94a3b8", lineHeight: 1.4 }}>
                      Tempo de resposta inferior a 50ms, zero chamadas à internet, segurança e privacidade 100% locais.
                    </p>
                  </button>

                  <button
                    onClick={() => setSettings((p) => ({ ...p, ocr_mode: "online" }))}
                    style={{
                      padding: "16px 18px",
                      background:
                        settings.ocr_mode === "online"
                          ? "linear-gradient(180deg, rgba(56, 189, 248, 0.14) 0%, rgba(56, 189, 248, 0.04) 100%)"
                          : "rgba(9, 11, 17, 0.6)",
                      border:
                        settings.ocr_mode === "online"
                          ? "1.5px solid #38bdf8"
                          : "1px solid rgba(255, 255, 255, 0.08)",
                      borderRadius: 10,
                      textAlign: "left",
                      cursor: "pointer",
                      transition: "all 0.2s cubic-bezier(0.16, 1, 0.3, 1)",
                    }}
                  >
                    <span style={{ fontSize: 13, fontWeight: 700, color: settings.ocr_mode === "online" ? "#38bdf8" : "#f8fafc" }}>
                      ☁️ Google Gemini 2.0
                    </span>
                    <p style={{ margin: "6px 0 0", fontSize: 11, color: "#94a3b8", lineHeight: 1.4 }}>
                      Modelo multimodal de alta precisão para caligrafia mista, diagramas e caracteres matemáticos complexos.
                    </p>
                  </button>
                </div>
              </section>

              {/* Card Chaves de API */}
              <section
                style={{
                  background: "rgba(18, 22, 34, 0.7)",
                  border: "1px solid rgba(255, 255, 255, 0.08)",
                  borderRadius: 14,
                  padding: 22,
                  boxShadow: "0 10px 30px rgba(0, 0, 0, 0.35)",
                }}
              >
                <div style={{ marginBottom: 16 }}>
                  <h2 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: "#f8fafc", letterSpacing: "-0.01em" }}>
                    Provedores de Tradução & Chaves
                  </h2>
                  <p style={{ margin: "2px 0 0", fontSize: 12, color: "#94a3b8" }}>
                    O Snipp inclui tradução gratuita integrada. Você pode adicionar suas chaves pessoais para recursos extras.
                  </p>
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  {/* DeepL */}
                  <div
                    style={{
                      background: "rgba(9, 11, 17, 0.6)",
                      borderRadius: 10,
                      border: "1px solid rgba(255, 255, 255, 0.07)",
                      padding: 14,
                    }}
                  >
                    <div
                      style={{ display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer" }}
                      onClick={() => setShowDeeplKey(!showDeeplKey)}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <span style={{ fontSize: 13, fontWeight: 600, color: "#f8fafc" }}>DeepL API Pro/Free</span>
                        {deeplKeyTemp ? (
                          <span style={{ fontSize: 10, padding: "2px 8px", background: "rgba(16, 185, 129, 0.15)", color: "#10b981", borderRadius: 4, fontWeight: 700 }}>
                            ● CHAVE CONFIGURADA
                          </span>
                        ) : (
                          <span style={{ fontSize: 10, padding: "2px 8px", background: "rgba(255, 255, 255, 0.06)", color: "#94a3b8", borderRadius: 4, fontWeight: 500 }}>
                            Usando Google Translate Fallback
                          </span>
                        )}
                      </div>
                      <span style={{ color: "#38bdf8", fontSize: 12, fontWeight: 600 }}>
                        {showDeeplKey ? "Fechar ▲" : "Configurar ▼"}
                      </span>
                    </div>

                    {showDeeplKey && (
                      <div style={{ marginTop: 12 }}>
                        <input
                          type="password"
                          placeholder="Cole sua Authentication Key (ex: xxxxxxxx-xxxx-...:fx)"
                          value={deeplKeyTemp}
                          onChange={(e) => setDeeplKeyTemp(e.target.value)}
                          style={{
                            width: "100%",
                            padding: "10px 14px",
                            background: "rgba(0, 0, 0, 0.5)",
                            border: "1px solid rgba(56, 189, 248, 0.25)",
                            borderRadius: 6,
                            color: "#f8fafc",
                            fontSize: 13,
                            fontFamily: "'JetBrains Mono', monospace",
                            outline: "none",
                            boxSizing: "border-box",
                          }}
                        />
                      </div>
                    )}
                  </div>

                  {/* Gemini */}
                  <div
                    style={{
                      background: "rgba(9, 11, 17, 0.6)",
                      borderRadius: 10,
                      border: "1px solid rgba(255, 255, 255, 0.07)",
                      padding: 14,
                    }}
                  >
                    <div
                      style={{ display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer" }}
                      onClick={() => setShowGeminiKey(!showGeminiKey)}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <span style={{ fontSize: 13, fontWeight: 600, color: "#f8fafc" }}>Google Gemini Flash API</span>
                        {geminiKeyTemp ? (
                          <span style={{ fontSize: 10, padding: "2px 8px", background: "rgba(16, 185, 129, 0.15)", color: "#10b981", borderRadius: 4, fontWeight: 700 }}>
                            ● ATIVA
                          </span>
                        ) : (
                          <span style={{ fontSize: 10, padding: "2px 8px", background: "rgba(255, 255, 255, 0.06)", color: "#94a3b8", borderRadius: 4, fontWeight: 500 }}>
                            Opcional
                          </span>
                        )}
                      </div>
                      <span style={{ color: "#38bdf8", fontSize: 12, fontWeight: 600 }}>
                        {showGeminiKey ? "Fechar ▲" : "Configurar ▼"}
                      </span>
                    </div>

                    {showGeminiKey && (
                      <div style={{ marginTop: 12 }}>
                        <input
                          type="password"
                          placeholder="Cole sua API Key do Google AI Studio"
                          value={geminiKeyTemp}
                          onChange={(e) => setGeminiKeyTemp(e.target.value)}
                          style={{
                            width: "100%",
                            padding: "10px 14px",
                            background: "rgba(0, 0, 0, 0.5)",
                            border: "1px solid rgba(56, 189, 248, 0.25)",
                            borderRadius: 6,
                            color: "#f8fafc",
                            fontSize: 13,
                            fontFamily: "'JetBrains Mono', monospace",
                            outline: "none",
                            boxSizing: "border-box",
                          }}
                        />
                      </div>
                    )}
                  </div>
                </div>
              </section>
            </>
          )}

          {/* TAB 2: TECLAS DE ATALHO */}
          {activeTab === "shortcuts" && (
            <>
              {/* Atalho Snip */}
              <section
                style={{
                  background: "rgba(18, 22, 34, 0.7)",
                  border: "1px solid rgba(255, 255, 255, 0.08)",
                  borderRadius: 14,
                  padding: 22,
                  boxShadow: "0 10px 30px rgba(0, 0, 0, 0.35)",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
                  <div>
                    <h2 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: "#f8fafc" }}>
                      ✂️ Atalho de Recorte de Tela (Snip)
                    </h2>
                    <p style={{ margin: "2px 0 0", fontSize: 12, color: "#94a3b8" }}>
                      Congela a tela com overlay translúcido para desenhar o retângulo de captura
                    </p>
                  </div>

                  <div
                    style={{
                      padding: "6px 14px",
                      background: "rgba(56, 189, 248, 0.1)",
                      border: "1px solid rgba(56, 189, 248, 0.25)",
                      borderRadius: 8,
                      fontFamily: "'JetBrains Mono', monospace",
                      fontSize: 13,
                      fontWeight: 700,
                      color: "#38bdf8",
                      boxShadow: "0 0 12px rgba(56, 189, 248, 0.15)",
                    }}
                  >
                    {[...selectedModifiers, selectedKey].join(" + ")}
                  </div>
                </div>

                <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
                  {modifierKeys.map((mod) => {
                    const isSelected = selectedModifiers.includes(mod);
                    return (
                      <button
                        key={mod}
                        onClick={() => toggleModifier(mod)}
                        style={{
                          flex: 1,
                          padding: "10px 0",
                          background: isSelected ? "rgba(56, 189, 248, 0.16)" : "rgba(9, 11, 17, 0.6)",
                          border: isSelected ? "1.5px solid #38bdf8" : "1px solid rgba(255, 255, 255, 0.08)",
                          borderRadius: 8,
                          color: isSelected ? "#38bdf8" : "#94a3b8",
                          fontSize: 13,
                          fontWeight: isSelected ? 700 : 500,
                          cursor: "pointer",
                          transition: "all 0.15s ease",
                        }}
                      >
                        {mod === "Win" ? "⊞ Win" : mod}
                      </button>
                    );
                  })}
                </div>

                <select
                  value={selectedKey}
                  onChange={(e) => setSelectedKey(e.target.value)}
                  style={{
                    width: "100%",
                    padding: "10px 14px",
                    background: "rgba(9, 11, 17, 0.8)",
                    border: "1px solid rgba(255, 255, 255, 0.12)",
                    borderRadius: 8,
                    color: "#f8fafc",
                    fontSize: 13,
                    fontWeight: 600,
                    outline: "none",
                    cursor: "pointer",
                    textAlign: "center",
                  }}
                >
                  {mainKeys.map((k) => (
                    <option key={k.value} value={k.value}>
                      Tecla {k.label}
                    </option>
                  ))}
                </select>
              </section>

              {/* Atalho Seleção Direta */}
              <section
                style={{
                  background: "rgba(18, 22, 34, 0.7)",
                  border: "1px solid rgba(255, 255, 255, 0.08)",
                  borderRadius: 14,
                  padding: 22,
                  boxShadow: "0 10px 30px rgba(0, 0, 0, 0.35)",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
                  <div>
                    <h2 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: "#f8fafc" }}>
                      📝 Tradução Direta de Seleção / Clipboard
                    </h2>
                    <p style={{ margin: "2px 0 0", fontSize: 12, color: "#94a3b8" }}>
                      Lê o texto selecionado na área de transferência e abre o card flutuante instantaneamente
                    </p>
                  </div>

                  <div
                    style={{
                      padding: "6px 14px",
                      background: "rgba(56, 189, 248, 0.1)",
                      border: "1px solid rgba(56, 189, 248, 0.25)",
                      borderRadius: 8,
                      fontFamily: "'JetBrains Mono', monospace",
                      fontSize: 13,
                      fontWeight: 700,
                      color: "#38bdf8",
                      boxShadow: "0 0 12px rgba(56, 189, 248, 0.15)",
                    }}
                  >
                    {[...selectedSelModifiers, selectedSelKey].join(" + ")}
                  </div>
                </div>

                <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
                  {modifierKeys.map((mod) => {
                    const isSelected = selectedSelModifiers.includes(mod);
                    return (
                      <button
                        key={mod}
                        onClick={() => toggleSelModifier(mod)}
                        style={{
                          flex: 1,
                          padding: "10px 0",
                          background: isSelected ? "rgba(56, 189, 248, 0.16)" : "rgba(9, 11, 17, 0.6)",
                          border: isSelected ? "1.5px solid #38bdf8" : "1px solid rgba(255, 255, 255, 0.08)",
                          borderRadius: 8,
                          color: isSelected ? "#38bdf8" : "#94a3b8",
                          fontSize: 13,
                          fontWeight: isSelected ? 700 : 500,
                          cursor: "pointer",
                          transition: "all 0.15s ease",
                        }}
                      >
                        {mod === "Win" ? "⊞ Win" : mod}
                      </button>
                    );
                  })}
                </div>

                <select
                  value={selectedSelKey}
                  onChange={(e) => setSelectedSelKey(e.target.value)}
                  style={{
                    width: "100%",
                    padding: "10px 14px",
                    background: "rgba(9, 11, 17, 0.8)",
                    border: "1px solid rgba(255, 255, 255, 0.12)",
                    borderRadius: 8,
                    color: "#f8fafc",
                    fontSize: 13,
                    fontWeight: 600,
                    outline: "none",
                    cursor: "pointer",
                    textAlign: "center",
                  }}
                >
                  {mainKeys.map((k) => (
                    <option key={k.value} value={k.value}>
                      Tecla {k.label}
                    </option>
                  ))}
                </select>
              </section>
            </>
          )}

          {/* TAB 3: HISTÓRICO */}
          {activeTab === "history" && (
            <section
              style={{
                background: "rgba(18, 22, 34, 0.7)",
                border: "1px solid rgba(255, 255, 255, 0.08)",
                borderRadius: 14,
                padding: 22,
                boxShadow: "0 10px 30px rgba(0, 0, 0, 0.35)",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
                <div>
                  <h2 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: "#f8fafc" }}>
                    Histórico de Capturas Recentes
                  </h2>
                  <p style={{ margin: "2px 0 0", fontSize: 12, color: "#94a3b8" }}>
                    Registros gravados localmente na máquina
                  </p>
                </div>

                {historyList.length > 0 && (
                  <button
                    onClick={handleClearHistory}
                    style={{
                      background: "rgba(239, 68, 68, 0.12)",
                      color: "#f87171",
                      border: "1px solid rgba(239, 68, 68, 0.25)",
                      borderRadius: 6,
                      padding: "6px 14px",
                      fontSize: 12,
                      fontWeight: 600,
                      cursor: "pointer",
                      transition: "all 0.15s ease",
                    }}
                  >
                    🗑️ Limpar tudo
                  </button>
                )}
              </div>

              {historyList.length === 0 ? (
                <div
                  style={{
                    padding: "48px 20px",
                    textAlign: "center",
                    color: "#94a3b8",
                    border: "1px dashed rgba(255, 255, 255, 0.1)",
                    borderRadius: 10,
                  }}
                >
                  <div style={{ fontSize: 32, marginBottom: 8 }}>📭</div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: "#f8fafc" }}>Histórico Vazio</div>
                  <div style={{ fontSize: 12, marginTop: 4 }}>
                    Pressione {settings.shortcut} para capturar texto na tela. As traduções aparecerão aqui.
                  </div>
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  {historyList.map((item) => (
                    <div
                      key={item.id}
                      style={{
                        background: "rgba(9, 11, 17, 0.8)",
                        border: "1px solid rgba(255, 255, 255, 0.08)",
                        borderRadius: 10,
                        padding: 16,
                        display: "flex",
                        flexDirection: "column",
                        gap: 10,
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 11, color: "#94a3b8" }}>
                        <span>🕒 {item.timestamp}</span>
                        <span
                          style={{
                            background: "rgba(56, 189, 248, 0.12)",
                            color: "#38bdf8",
                            padding: "2px 8px",
                            borderRadius: 4,
                            fontWeight: 700,
                            fontFamily: "'JetBrains Mono', monospace",
                          }}
                        >
                          {item.ocr_lang} → {item.target_lang}
                        </span>
                      </div>

                      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                        <div
                          style={{
                            background: "rgba(255, 255, 255, 0.03)",
                            padding: "10px 12px",
                            borderRadius: 6,
                            fontSize: 13,
                            color: "#cbd5e1",
                            whiteSpace: "pre-wrap",
                            wordBreak: "break-word",
                            lineHeight: 1.45,
                          }}
                        >
                          <span style={{ fontSize: 10, fontWeight: 700, color: "#64748b", display: "block", marginBottom: 3 }}>ORIGINAL</span>
                          {item.original_text}
                        </div>

                        <div
                          style={{
                            background: "rgba(56, 189, 248, 0.06)",
                            border: "1px solid rgba(56, 189, 248, 0.2)",
                            padding: "10px 12px",
                            borderRadius: 6,
                            fontSize: 13,
                            color: "#38bdf8",
                            whiteSpace: "pre-wrap",
                            wordBreak: "break-word",
                            lineHeight: 1.45,
                          }}
                        >
                          <span style={{ fontSize: 10, fontWeight: 700, color: "rgba(56, 189, 248, 0.7)", display: "block", marginBottom: 3 }}>TRADUÇÃO</span>
                          {item.translated_text}
                        </div>
                      </div>

                      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                        <button
                          onClick={() => copyHistoryText(item.original_text, `${item.id}-orig`)}
                          style={{
                            background: "rgba(255, 255, 255, 0.05)",
                            color: "#94a3b8",
                            border: "1px solid rgba(255, 255, 255, 0.1)",
                            borderRadius: 6,
                            padding: "5px 10px",
                            fontSize: 11,
                            cursor: "pointer",
                            transition: "all 0.15s ease",
                          }}
                        >
                          {copiedId === `${item.id}-orig` ? "✓ Copiado" : "Copiar Original"}
                        </button>

                        <button
                          onClick={() => copyHistoryText(item.translated_text, `${item.id}-trad`)}
                          style={{
                            background: "rgba(56, 189, 248, 0.15)",
                            color: "#38bdf8",
                            border: "1px solid rgba(56, 189, 248, 0.3)",
                            borderRadius: 6,
                            padding: "5px 10px",
                            fontSize: 11,
                            fontWeight: 700,
                            cursor: "pointer",
                            transition: "all 0.15s ease",
                          }}
                        >
                          {copiedId === `${item.id}-trad` ? "✓ Copiado" : "Copiar Tradução"}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}
        </div>
      </main>
    </div>
  );
}