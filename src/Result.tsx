import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

function ResultPage() {
  const [text, setText] = useState("");
  const [translated, setTranslated] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    invoke<string>("get_last_ocr_result")
      .then((raw) => {
        const lines = raw.split("\n");
        const ocrLine = lines.find(l => l.startsWith("OCR:"));
        const tradLine = lines.find(l => l.startsWith("TRAD:"));

        setText(ocrLine?.replace("OCR:", "") || "");
        setTranslated(tradLine?.replace("TRAD:", "") || null);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div style={styles.container}>
        <div style={styles.loading}>Processando...</div>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <span style={styles.icon}>⬡</span>
        <span style={styles.title}>Snipp — Tradutor</span>
      </div>

      <div style={styles.card}>
        <div style={styles.label}>📖 Texto original</div>
        <div style={styles.text}>{text}</div>
      </div>

      {translated && (
        <div style={{ ...styles.card, borderColor: "#4a9eff" }}>
          <div style={styles.label}>🌐 Tradução</div>
          <div style={styles.text}>{translated}</div>
        </div>
      )}

      {!translated && (
        <div style={{ ...styles.card, borderColor: "#666" }}>
          <div style={{ ...styles.label, color: "#999" }}>
            ⚠️ Tradução indisponível (configure a API Key)
          </div>
        </div>
      )}

      <button style={styles.button} onClick={() => invoke("close_result_window")}>
        Fechar
      </button>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    padding: 24,
    fontFamily: "'Segoe UI', system-ui, sans-serif",
    background: "#0a0e1e",
    minHeight: "100vh",
    color: "#e0e8f0",
    display: "flex",
    flexDirection: "column",
    gap: 16,
  },
  header: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    marginBottom: 8,
  },
  icon: {
    fontSize: 22,
    color: "#4a9eff",
    fontWeight: 600,
  },
  title: {
    fontSize: 18,
    fontWeight: 600,
    color: "#e0e8f0",
  },
  card: {
    background: "rgba(20, 28, 58, 0.8)",
    border: "1px solid #2a3a6a",
    borderRadius: 10,
    padding: 16,
  },
  label: {
    fontSize: 12,
    fontWeight: 600,
    color: "#6ab0ff",
    marginBottom: 8,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  text: {
    fontSize: 15,
    lineHeight: 1.5,
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
    color: "#e0e8f0",
  },
  loading: {
    textAlign: "center",
    color: "#6ab0ff",
    fontSize: 16,
    marginTop: 40,
  },
  button: {
    marginTop: 8,
    padding: "10px 20px",
    fontSize: 14,
    fontWeight: 600,
    background: "#4a9eff",
    color: "#fff",
    border: "none",
    borderRadius: 8,
    cursor: "pointer",
    alignSelf: "center",
  },
};

export default ResultPage;