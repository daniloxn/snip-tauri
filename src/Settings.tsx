import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";

interface Settings {
  deepl_api_key: string;
  ocr_lang: string;
  translate_to: string;
}

function SettingsPage() {
  const [settings, setSettings] = useState<Settings>({
    deepl_api_key: "",
    ocr_lang: "por",
    translate_to: "en",
  });
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    invoke<Settings>("load_settings").then(setSettings).catch(console.error);
  }, []);

  function save() {
    invoke("save_settings", { settings })
      .then(() => {
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      })
      .catch(console.error);
  }

  return (
    <div style={{ padding: 32, fontFamily: "Segoe UI, sans-serif" }}>
      <h1 style={{ fontSize: 22, marginBottom: 24 }}>⚙️ Configurações</h1>

      <label style={{ display: "block", marginBottom: 16 }}>
        <strong>DeepL API Key</strong>
        <input
          type="password"
          value={settings.deepl_api_key}
          onChange={(e) =>
            setSettings({ ...settings, deepl_api_key: e.target.value })
          }
          style={inputStyle}
          placeholder="sua chave aqui"
        />
      </label>

      <label style={{ display: "block", marginBottom: 16 }}>
        <strong>Idioma do OCR</strong>
        <select
          value={settings.ocr_lang}
          onChange={(e) =>
            setSettings({ ...settings, ocr_lang: e.target.value })
          }
          style={inputStyle}
        >
          <option value="por">Português</option>
          <option value="eng">Inglês</option>
          <option value="spa">Espanhol</option>
          <option value="fra">Francês</option>
        </select>
      </label>

      <label style={{ display: "block", marginBottom: 24 }}>
        <strong>Traduzir para</strong>
        <select
          value={settings.translate_to}
          onChange={(e) =>
            setSettings({ ...settings, translate_to: e.target.value })
          }
          style={inputStyle}
        >
          <option value="en">Inglês</option>
          <option value="pt">Português</option>
          <option value="es">Espanhol</option>
          <option value="fr">Francês</option>
          <option value="de">Alemão</option>
          <option value="it">Italiano</option>
        </select>
      </label>

      <button onClick={save} style={buttonStyle}>
        {saved ? "✅ Salvo!" : "Salvar configurações"}
      </button>

      <p style={{ marginTop: 16, fontSize: 13, color: "#888" }}>
        O app continua rodando em segundo plano. Use Ctrl+Shift+T para capturar.
      </p>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  display: "block",
  width: "100%",
  marginTop: 4,
  padding: "8px 12px",
  fontSize: 14,
  border: "1px solid #ccc",
  borderRadius: 6,
  boxSizing: "border-box",
};

const buttonStyle: React.CSSProperties = {
  padding: "10px 24px",
  fontSize: 15,
  background: "#e54676",
  color: "#fff",
  border: "none",
  borderRadius: 6,
  cursor: "pointer",
};

export default SettingsPage;