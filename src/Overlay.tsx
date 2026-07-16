import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

async function closeAllOverlays() {
  await invoke("close_overlay_windows");
}

function Overlay() {
  const [ocrResult, setOcrResult] = useState<string | null>(null);
  const [translatedResult, setTranslatedResult] = useState<string | null>(null);
  const [ocrLang, setOcrLang] = useState("por");
  const [translateLang, setTranslateLang] = useState("EN");
  const [translating, setTranslating] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [drawing, setDrawing] = useState(false);
  const [coords, setCoords] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const start = useRef({ x: 0, y: 0 });
  const end = useRef({ x: 0, y: 0 });
  const lastCapture = useRef({ absX: 0, absY: 0, w: 0, h: 0 });
  const animRef = useRef<number | null>(null);
  const pulse = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current!;
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    drawOverlay(0);
  }, []);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") closeAllOverlays();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  function startAnimation() {
    function loop() {
      pulse.current = (pulse.current + 0.03) % (Math.PI * 2);
      drawOverlay(pulse.current);
      animRef.current = requestAnimationFrame(loop);
    }
    animRef.current = requestAnimationFrame(loop);
  }

  function stopAnimation() {
    if (animRef.current !== null) {
      cancelAnimationFrame(animRef.current);
      animRef.current = null;
    }
  }

  function drawOverlay(phase: number) {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = "rgba(0, 0, 0, 0.3)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const x = Math.min(start.current.x, end.current.x);
    const y = Math.min(start.current.y, end.current.y);
    const w = Math.abs(end.current.x - start.current.x);
    const h = Math.abs(end.current.y - start.current.y);

    if (w > 0 || h > 0) {
      ctx.clearRect(x, y, w, h);

      ctx.fillStyle = "rgba(137, 207, 240, 0.12)";
      ctx.fillRect(x, y, w, h);

      const glowIntensity = 10 + Math.sin(phase) * 8;
      ctx.shadowColor = "#89CFF0";
      ctx.shadowBlur = glowIntensity;
      ctx.strokeStyle = "#89CFF0";
      ctx.lineWidth = 2.5;
      ctx.strokeRect(x, y, w, h);

      ctx.shadowBlur = 0;

      const cornerLen = 12;
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 2.5;

      ctx.beginPath();
      ctx.moveTo(x, y + cornerLen);
      ctx.lineTo(x, y);
      ctx.lineTo(x + cornerLen, y);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(x + w - cornerLen, y);
      ctx.lineTo(x + w, y);
      ctx.lineTo(x + w, y + cornerLen);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(x, y + h - cornerLen);
      ctx.lineTo(x, y + h);
      ctx.lineTo(x + cornerLen, y + h);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(x + w - cornerLen, y + h);
      ctx.lineTo(x + w, y + h);
      ctx.lineTo(x + w, y + h - cornerLen);
      ctx.stroke();
    }
  }

  function getCanvasPos(e: React.MouseEvent) {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function onMouseDown(e: React.MouseEvent) {
    start.current = getCanvasPos(e);
    end.current = start.current;
    setDrawing(true);
    setCoords(null);
    startAnimation();
  }

  function onMouseMove(e: React.MouseEvent) {
    if (!drawing) return;
    end.current = getCanvasPos(e);

    const w = Math.abs(end.current.x - start.current.x);
    const h = Math.abs(end.current.y - start.current.y);
    setCoords({
      x: Math.min(start.current.x, end.current.x),
      y: Math.min(start.current.y, end.current.y),
      w,
      h,
    });
  }

  async function doCapture(x: number, y: number, w: number, h: number, lang: string) {
    try {
      const text = await invoke<string>("capture_and_ocr", {
        x: Math.round(x),
        y: Math.round(y),
        w: Math.round(w),
        h: Math.round(h),
        lang,
      });

      setOcrResult(text);
      setTranslatedResult(null);

      try {
        setTranslating(true);
        const translated = await invoke<string>("translate_text_cmd", {
          text,
          targetLang: translateLang,
        });
        setTranslatedResult(translated);
      } catch {
        // mantém só o OCR
      } finally {
        setTranslating(false);
      }
    } catch (err) {
      console.error("❌ Erro:", err);
      setOcrResult(`Erro: ${err}`);
      setTranslatedResult(null);
    }
  }

  async function onMouseUp() {
    if (!drawing) return;
    setDrawing(false);
    stopAnimation();

    const relX = Math.min(start.current.x, end.current.x);
    const relY = Math.min(start.current.y, end.current.y);
    const w = Math.abs(end.current.x - start.current.x);
    const h = Math.abs(end.current.y - start.current.y);

    if (w < 5 || h < 5) return;

    const absX = relX + window.screenLeft;
    const absY = relY + window.screenTop;

    lastCapture.current = { absX, absY, w, h };

    await doCapture(absX, absY, w, h, ocrLang);
  }

  async function handleOcrLangChange(newLang: string) {
    setOcrLang(newLang);
    const { absX, absY, w, h } = lastCapture.current;
    if (w > 0 && h > 0) {
      await doCapture(absX, absY, w, h, newLang);
    }
  }

  async function handleTranslateLangChange(newLang: string) {
    setTranslateLang(newLang);
    if (ocrResult) {
      try {
        setTranslating(true);
        const translated = await invoke<string>("translate_text_cmd", {
          text: ocrResult,
          targetLang: newLang,
        });
        setTranslatedResult(translated);
      } catch {
        setTranslatedResult(null);
      } finally {
        setTranslating(false);
      }
    }
  }

  return (
    <>
      <canvas
        ref={canvasRef}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          width: "100vw",
          height: "100vh",
          cursor: "crosshair",
          background: "transparent",
        }}
      />

      {coords && (
        <div
          style={{
            position: "fixed",
            bottom: 20,
            left: "50%",
            transform: "translateX(-50%)",
            background: "rgba(0,0,0,0.8)",
            color: "#fff",
            padding: "8px 16px",
            borderRadius: 8,
            fontFamily: "monospace",
            fontSize: 14,
            zIndex: 9999,
            pointerEvents: "none",
          }}
        >
          {coords.w} × {coords.h} px
        </div>
      )}

      {(ocrResult || translatedResult) && (
        <div
          style={{
            position: "fixed",
            bottom: 80,
            left: "50%",
            transform: "translateX(-50%)",
            width: "90vw",
            maxWidth: 800,
            background: "rgba(20, 20, 30, 0.95)",
            backdropFilter: "blur(12px)",
            borderRadius: 12,
            border: "1px solid rgba(137, 207, 240, 0.25)",
            boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
            zIndex: 9999,
            overflow: "hidden",
            fontFamily: "'Segoe UI', system-ui, -apple-system, sans-serif",
          }}
        >
          {/* Barra de idiomas */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "8px 16px",
              borderBottom: "1px solid rgba(255,255,255,0.08)",
            }}
          >
            <select
              value={ocrLang}
              onChange={(e) => handleOcrLangChange(e.target.value)}
              style={{
                flex: 1,
                background: "rgba(255,255,255,0.06)",
                color: "#e0e0e0",
                border: "1px solid rgba(255,255,255,0.1)",
                borderRadius: 6,
                padding: "6px 10px",
                fontSize: 13,
                fontFamily: "inherit",
                cursor: "pointer",
                outline: "none",
              }}
            >
              <option value="por">Português</option>
              <option value="eng">Inglês</option>
              <option value="spa">Espanhol</option>
              <option value="fra">Francês</option>
              <option value="deu">Alemão</option>
              <option value="ita">Italiano</option>
            </select>

            <span style={{ color: "#555", fontSize: 14 }}>→</span>

            <select
              value={translateLang}
              onChange={(e) => handleTranslateLangChange(e.target.value)}
              style={{
                flex: 1,
                background: "rgba(255,255,255,0.06)",
                color: "#e0e0e0",
                border: "1px solid rgba(255,255,255,0.1)",
                borderRadius: 6,
                padding: "6px 10px",
                fontSize: 13,
                fontFamily: "inherit",
                cursor: "pointer",
                outline: "none",
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

          {/* Cabeçalho com abas */}
          <div
            style={{
              display: "flex",
              borderBottom: "1px solid rgba(255,255,255,0.08)",
            }}
          >
            <div
              style={{
                flex: 1,
                padding: "10px 16px",
                color: ocrResult ? "#89CFF0" : "#888",
                fontSize: 13,
                fontWeight: 600,
                letterSpacing: "0.5px",
                textTransform: "uppercase",
                textAlign: "center",
                borderBottom: ocrResult ? "2px solid #89CFF0" : "2px solid transparent",
                transition: "all 0.2s",
              }}
            >
              📄 Texto Original
            </div>
            <div
              style={{
                padding: "10px 0",
                color: "#555",
                fontSize: 18,
                display: "flex",
                alignItems: "center",
              }}
            >
              │
            </div>
            <div
              style={{
                flex: 1,
                padding: "10px 16px",
                color: translatedResult ? "#89CFF0" : "#888",
                fontSize: 13,
                fontWeight: 600,
                letterSpacing: "0.5px",
                textTransform: "uppercase",
                textAlign: "center",
                borderBottom: translatedResult ? "2px solid #89CFF0" : "2px solid transparent",
                transition: "all 0.2s",
              }}
            >
              🌐 Tradução {translating && "⏳"}
            </div>
          </div>

          {/* Corpo com dois painéis */}
          <div style={{ display: "flex", minHeight: 80, maxHeight: 200 }}>
            <div
              style={{
                flex: 1,
                padding: "14px 18px",
                color: "#e0e0e0",
                fontSize: 15,
                lineHeight: "1.5",
                overflow: "auto",
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
              }}
            >
              {ocrResult || "—"}
            </div>

            <div
              style={{
                width: 1,
                background: "rgba(255,255,255,0.08)",
                margin: "12px 0",
              }}
            />

            <div
              style={{
                flex: 1,
                padding: "14px 18px",
                color: "#89CFF0",
                fontSize: 15,
                lineHeight: "1.5",
                overflow: "auto",
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
              }}
            >
              {translatedResult || (translating ? "Traduzindo..." : "—")}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default Overlay;