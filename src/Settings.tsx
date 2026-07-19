import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

interface Settings {
  deepl_api_key: string;
  ocr_lang: string;
  translate_to: string;
  shortcut: string;
  ocr_mode: string;
  gemini_api_key: string;
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

function Settings() {
  const [settings, setSettings] = useState<Settings>({
    deepl_api_key: "",
    ocr_lang: "por",
    translate_to: "EN",
    shortcut: "Ctrl+Shift+S",
    ocr_mode: "online",
    gemini_api_key: "",
  });
  const [saved, setSaved] = useState(false);
  const [showDeeplKey, setShowDeeplKey] = useState(false);
  const [deeplKeyTemp, setDeeplKeyTemp] = useState("");
  const [showGeminiKey, setShowGeminiKey] = useState(false);
  const [geminiKeyTemp, setGeminiKeyTemp] = useState("");
  const [selectedModifiers, setSelectedModifiers] = useState<string[]>(["Ctrl", "Shift"]);
  const [selectedKey, setSelectedKey] = useState("S");

  useEffect(() => {
    loadSettings();
  }, []);

  useEffect(() => {
    const shortcut = [...selectedModifiers, selectedKey].join("+");
    setSettings((prev) => ({ ...prev, shortcut }));
  }, [selectedModifiers, selectedKey]);

  async function loadSettings() {
    try {
      const s = await invoke<Settings>("load_settings");
      setSettings(s);
      setDeeplKeyTemp(s.deepl_api_key);
      setGeminiKeyTemp(s.gemini_api_key);
      const parts = s.shortcut.split("+");
      const modifiers = parts.filter((p) => modifierKeys.includes(p as any));
      const key = parts.find((p) => !modifierKeys.includes(p as any)) || "S";
      setSelectedModifiers(modifiers);
      setSelectedKey(key);
    } catch (err) {
      console.error("Erro ao carregar settings:", err);
    }
  }

  async function saveSettings() {
    try {
      await invoke("save_settings", {
        settings: {
          ...settings,
          deepl_api_key: deeplKeyTemp,
          gemini_api_key: geminiKeyTemp,
        },
      });
      setSettings((prev) => ({
        ...prev,
        deepl_api_key: deeplKeyTemp,
        gemini_api_key: geminiKeyTemp,
      }));
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      console.error("Erro ao salvar:", err);
    }
  }

  function toggleModifier(mod: string) {
    setSelectedModifiers((prev) =>
      prev.includes(mod) ? prev.filter((m) => m !== mod) : [...prev, mod]
    );
  }

  const babyBlue = "#89CFF0";
  const darkBg = "#111118";
  const cardBg = "#1a1a24";
  const border = "rgba(137, 207, 240, 0.15)";
  const inputBg = "rgba(255,255,255,0.04)";
  const textPrimary = "#e8e8f0";
  const textSecondary = "#8888aa";

  return (
    <div
      style={{
        width: "100%",
        height: "100vh",
        background: darkBg,
        color: textPrimary,
        fontFamily: "'Segoe UI', system-ui, -apple-system, sans-serif",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      {/* Header fixo */}
      <div
        style={{
          padding: "24px 32px 16px",
          borderBottom: `1px solid ${border}`,
          flexShrink: 0,
        }}
      >
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: babyBlue }}>
          ⚙️ Configurações
        </h1>
        <p style={{ margin: "4px 0 0", fontSize: 14, color: textSecondary }}>
          Personalize o SnippSnap do seu jeito
        </p>
      </div>
      {/* Conteúdo scrollável */}
      <div
        style={{
          flex: 1,
          overflowY: "auto",
          overflowX: "hidden",
          padding: "24px 32px",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 20, maxWidth: 600 }}>
          {/* MODO DE OCR */}
          <div
            style={{
              background: cardBg,
              borderRadius: 12,
              border: `1px solid ${border}`,
              padding: 20,
            }}
          >
            <h2 style={{ margin: "0 0 4px", fontSize: 15, fontWeight: 600, color: textPrimary }}>
              🤖 Modo de OCR
            </h2>
            <p style={{ margin: "0 0 14px", fontSize: 13, color: textSecondary }}>
              Escolha como o texto será extraído das imagens
            </p>
            <div style={{ display: "flex", gap: 12 }}>
              <button
                onClick={() => setSettings((p) => ({ ...p, ocr_mode: "online" }))}
                style={{
                  flex: 1,
                  padding: "12px 0",
                  background: settings.ocr_mode === "online"
                    ? "rgba(137, 207, 240, 0.15)"
                    : inputBg,
                  border: settings.ocr_mode === "online"
                    ? `1.5px solid ${babyBlue}`
                    : "1px solid rgba(255,255,255,0.1)",
                  borderRadius: 8,
                  color: settings.ocr_mode === "online" ? babyBlue : textSecondary,
                  fontSize: 14,
                  fontWeight: settings.ocr_mode === "online" ? 600 : 400,
                  cursor: "pointer",
                  transition: "all 0.15s",
                  outline: "none",
                }}
              >
                ☁️ Online (Gemini)
              </button>
              <button
                onClick={() => setSettings((p) => ({ ...p, ocr_mode: "local" }))}
                style={{
                  flex: 1,
                  padding: "12px 0",
                  background: settings.ocr_mode === "local"
                    ? "rgba(137, 207, 240, 0.15)"
                    : inputBg,
                  border: settings.ocr_mode === "local"
                    ? `1.5px solid ${babyBlue}`
                    : "1px solid rgba(255,255,255,0.1)",
                  borderRadius: 8,
                  color: settings.ocr_mode === "local" ? babyBlue : textSecondary,
                  fontSize: 14,
                  fontWeight: settings.ocr_mode === "local" ? 600 : 400,
                  cursor: "pointer",
                  transition: "all 0.15s",
                  outline: "none",
                }}
              >
                💻 Local (Tesseract)
              </button>
            </div>
            <p style={{ margin: "10px 0 0", fontSize: 12, color: textSecondary, lineHeight: 1.4 }}>
              {settings.ocr_mode === "online"
                ? "☁️ Recomendado. Requer chave da API Gemini. Rápido e sem instalação."
                : "💻 Para uso offline. Requer o Tesseract instalado no sistema (você assume a configuração)."}
            </p>
          </div>

          {/* GEMINI API KEY */}
          <div
            style={{
              background: cardBg,
              borderRadius: 12,
              border: `1px solid ${border}`,
              padding: 20,
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                cursor: "pointer",
                userSelect: "none",
              }}
              onClick={() => setShowGeminiKey(!showGeminiKey)}
            >
              <div>
                <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: textPrimary }}>
                  ☁️ Gemini API Key
                </h2>
                <p style={{ margin: "2px 0 0", fontSize: 13, color: textSecondary }}>
                  {showGeminiKey
                    ? "Clique para recolher"
                    : geminiKeyTemp
                    ? "✅ Chave configurada"
                    : "❌ Nenhuma chave"}
                </p>
              </div>
              <span
                style={{
                  color: babyBlue,
                  fontSize: 18,
                  transition: "transform 0.2s",
                  transform: showGeminiKey ? "rotate(180deg)" : "rotate(0deg)",
                }}
              >
                ▼
              </span>
            </div>
            {showGeminiKey && (
              <div style={{ marginTop: 14 }}>
                <input
                  type="password"
                  placeholder="Cole sua Gemini API Key aqui..."
                  value={geminiKeyTemp}
                  onChange={(e) => setGeminiKeyTemp(e.target.value)}
                  style={{
                    width: "100%",
                    padding: "10px 14px",
                    background: inputBg,
                    border: `1px solid ${border}`,
                    borderRadius: 8,
                    color: textPrimary,
                    fontSize: 14,
                    fontFamily: "monospace",
                    outline: "none",
                    boxSizing: "border-box",
                  }}
                />
                <p style={{ margin: "6px 0 0", fontSize: 12, color: textSecondary }}>
                  Obtenha sua chave em{" "}
                  <a
                    href="https://aistudio.google.com/"
                    target="_blank"
                    rel="noreferrer"
                    style={{ color: babyBlue, textDecoration: "none" }}
                  >
                    aistudio.google.com
                  </a>
                  {" "}(é gratuita)
                </p>
              </div>
            )}
          </div>

          {/* ATALHO */}
          <div
            style={{
              background: cardBg,
              borderRadius: 12,
              border: `1px solid ${border}`,
              padding: 20,
            }}
          >
            <h2 style={{ margin: "0 0 4px", fontSize: 15, fontWeight: 600, color: textPrimary }}>
              ⌨️ Atalho de captura
            </h2>
            <p style={{ margin: "0 0 14px", fontSize: 13, color: textSecondary }}>
              Escolha a combinação de teclas para abrir a overlay
            </p>
            <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
              {modifierKeys.map((mod) => (
                <button
                  key={mod}
                  onClick={() => toggleModifier(mod)}
                  style={{
                    flex: 1,
                    padding: "10px 0",
                    background: selectedModifiers.includes(mod)
                      ? "rgba(137, 207, 240, 0.15)"
                      : inputBg,
                    border: selectedModifiers.includes(mod)
                      ? `1.5px solid ${babyBlue}`
                      : "1px solid rgba(255,255,255,0.1)",
                    borderRadius: 8,
                    color: selectedModifiers.includes(mod) ? babyBlue : textSecondary,
                    fontSize: 13,
                    fontWeight: selectedModifiers.includes(mod) ? 600 : 400,
                    cursor: "pointer",
                    transition: "all 0.15s",
                    outline: "none",
                  }}
                >
                  {mod === "Win" ? "⊞ Win" : mod}
                </button>
              ))}
            </div>
            <select
              value={selectedKey}
              onChange={(e) => setSelectedKey(e.target.value)}
              style={{
                width: "100%",
                padding: "10px 14px",
                background: inputBg,
                border: `1px solid ${border}`,
                borderRadius: 8,
                color: textPrimary,
                fontSize: 15,
                fontFamily: "'Fira Code', 'Cascadia Code', monospace",
                outline: "none",
                cursor: "pointer",
                textAlign: "center",
                fontWeight: 600,
              }}
            >
              {mainKeys.map((k) => (
                <option key={k.value} value={k.value}>
                  {k.label}
                </option>
              ))}
            </select>
            <div
              style={{
                marginTop: 12,
                textAlign: "center",
                padding: "8px 0",
                fontSize: 13,
                color: textSecondary,
              }}
            >
              Atalho atual:{" "}
              <span
                style={{
                  color: babyBlue,
                  fontFamily: "'Fira Code', monospace",
                  fontWeight: 600,
                  fontSize: 15,
                }}
              >
                {[...selectedModifiers, selectedKey].join(" + ")}
              </span>
            </div>
          </div>

          {/* DEEPL API KEY */}
          <div
            style={{
              background: cardBg,
              borderRadius: 12,
              border: `1px solid ${border}`,
              padding: 20,
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                cursor: "pointer",
                userSelect: "none",
              }}
              onClick={() => setShowDeeplKey(!showDeeplKey)}
            >
              <div>
                <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: textPrimary }}>
                  🔑 DeepL API Key
                </h2>
                <p style={{ margin: "2px 0 0", fontSize: 13, color: textSecondary }}>
                  {showDeeplKey
                    ? "Clique para recolher"
                    : deeplKeyTemp
                    ? "✅ Chave configurada"
                    : "❌ Nenhuma chave"}
                </p>
              </div>
              <span
                style={{
                  color: babyBlue,
                  fontSize: 18,
                  transition: "transform 0.2s",
                  transform: showDeeplKey ? "rotate(180deg)" : "rotate(0deg)",
                }}
              >
                ▼
              </span>
            </div>
            {showDeeplKey && (
              <div style={{ marginTop: 14 }}>
                <input
                  type="password"
                  placeholder="Cole sua DeepL API Key aqui..."
                  value={deeplKeyTemp}
                  onChange={(e) => setDeeplKeyTemp(e.target.value)}
                  style={{
                    width: "100%",
                    padding: "10px 14px",
                    background: inputBg,
                    border: `1px solid ${border}`,
                    borderRadius: 8,
                    color: textPrimary,
                    fontSize: 14,
                    fontFamily: "monospace",
                    outline: "none",
                    boxSizing: "border-box",
                  }}
                />
                <p style={{ margin: "6px 0 0", fontSize: 12, color: textSecondary }}>
                  Obtenha sua chave em{" "}
                  <a
                    href="https://www.deepl.com/pt-BR/your-account/keys"
                    target="_blank"
                    rel="noreferrer"
                    style={{ color: babyBlue, textDecoration: "none" }}
                  >
                    deepl.com/your-account/keys
                  </a>
                </p>
              </div>
            )}
          </div>

          {/* IDIOMAS */}
          <div
            style={{
              background: cardBg,
              borderRadius: 12,
              border: `1px solid ${border}`,
              padding: 20,
            }}
          >
            <h2 style={{ margin: "0 0 14px", fontSize: 15, fontWeight: 600, color: textPrimary }}>
              🌐 Idiomas
            </h2>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div>
                <label style={{ fontSize: 13, color: textSecondary, display: "block", marginBottom: 4 }}>
                  Idioma do OCR
                </label>
                <select
                  value={settings.ocr_lang}
                  onChange={(e) => setSettings((p) => ({ ...p, ocr_lang: e.target.value }))}
                  style={{
                    width: "100%",
                    padding: "10px 14px",
                    background: inputBg,
                    border: `1px solid ${border}`,
                    borderRadius: 8,
                    color: textPrimary,
                    fontSize: 14,
                    outline: "none",
                    cursor: "pointer",
                  }}
                >
                  <option value="por">Português</option>
                  <option value="eng">Inglês</option>
                  <option value="spa">Espanhol</option>
                  <option value="fra">Francês</option>
                  <option value="deu">Alemão</option>
                  <option value="ita">Italiano</option>
                </select>
              </div>
              <div>
                <label style={{ fontSize: 13, color: textSecondary, display: "block", marginBottom: 4 }}>
                  Traduzir para
                </label>
                <select
                  value={settings.translate_to}
                  onChange={(e) => setSettings((p) => ({ ...p, translate_to: e.target.value }))}
                  style={{
                    width: "100%",
                    padding: "10px 14px",
                    background: inputBg,
                    border: `1px solid ${border}`,
                    borderRadius: 8,
                    color: textPrimary,
                    fontSize: 14,
                    outline: "none",
                    cursor: "pointer",
                  }}
                >
                  <option value="EN">Inglês</option>
                  <option value="PT">Português</option>
                  <option value="ES">Espanhol</option>
                  <option value="FR">Francês</option>
                  <option value="DE">Alemão</option>
                  <option value="IT">Italiano</option>
                </select>
              </div>
            </div>
          </div>

          {/* SALVAR */}
          <button
            onClick={saveSettings}
            style={{
              padding: "14px 0",
              background: babyBlue,
              color: "#0a0a12",
              border: "none",
              borderRadius: 50,
              fontSize: 16,
              fontWeight: 700,
              cursor: "pointer",
              transition: "all 0.2s",
              boxShadow: `0 4px 20px rgba(137, 207, 240, 0.3)`,
              marginBottom: 16,
            }}
          >
            {saved ? "✅ Salvo!" : "💾 Salvar configurações"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default Settings;