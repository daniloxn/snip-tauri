import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";

async function closeAllOverlays() {
  await invoke("close_overlay_windows");
}

function Overlay() {
  const [ocrText, setOcrText] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [drawing, setDrawing] = useState(false);
  const [coords, setCoords] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const start = useRef({ x: 0, y: 0 });
  const end = useRef({ x: 0, y: 0 });

  // Redimensiona e desenha o fundo ao montar
  useEffect(() => {
    const canvas = canvasRef.current!;
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    drawOverlay();
  }, []);

  // ESC pra fechar
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") closeAllOverlays();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  function drawOverlay() {
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
      // Recorta a área selecionada (deixa transparente de verdade)
      ctx.globalCompositeOperation = "destination-out";
      ctx.fillStyle = "rgba(0, 0, 0, 1)";
      ctx.fillRect(x, y, w, h);

      // Borda vermelha
      ctx.globalCompositeOperation = "source-over";
      ctx.strokeStyle = "red";
      ctx.lineWidth = 1;
      ctx.strokeRect(x, y, w, h);
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
  }

  function onMouseMove(e: React.MouseEvent) {
    if (!drawing) return;
    end.current = getCanvasPos(e);
    drawOverlay();
  }

  async function onMouseUp() {
    if (!drawing) return;
    setDrawing(false);

    const relX = Math.min(start.current.x, end.current.x);
    const relY = Math.min(start.current.y, end.current.y);
    const w = Math.abs(end.current.x - start.current.x);
    const h = Math.abs(end.current.y - start.current.y);

    if (w < 5 || h < 5) return;

    const absX = relX + window.screenLeft;
    const absY = relY + window.screenTop;

    try {
      const text = await invoke<string>("capture_and_ocr", {
        x: Math.round(absX),
        y: Math.round(absY),
        w: Math.round(w),
        h: Math.round(h),
      });
      if (text && !text.startsWith("(")) {
        try {
          const translated = await invoke<string>("translate_text", { text });
          setOcrText(`📖 ${text}\n\n🌐 ${translated}`);
        } catch (err){
          // Se a tradução falhar, mostra só o OCR mesmo
          setOcrText(`📖 ${text}\n\n❌ Erro na tradução: ${err}`);
        }
      } else {
        setOcrText(text);
      }
    } catch (err) {
      console.error("❌ Erro:", err);
      setOcrText(`Erro: ${err}`);
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
            padding: "12px 24px",
            borderRadius: 8,
            fontFamily: "monospace",
            fontSize: 18,
            zIndex: 9999,
          }}
        >
          📐 x: {coords.x} y: {coords.y} w: {coords.w} h: {coords.h}
        </div>
      )}
      {ocrText && (
        <div
          style={{
            position: "fixed",
            bottom: 80,
            left: "50%",
            transform: "translateX(-50%)",
            background: "rgba(0,0,0,0.9)",
            color: "#fff",
            padding: "16px 24px",
            borderRadius: 8,
            fontFamily: "monospace",
            fontSize: 16,
            zIndex: 9999,
            maxWidth: "80vw",
            maxHeight: 200,
            overflow: "auto",
            whiteSpace: "pre-wrap",
          }}
        >
          📄 {ocrText}
        </div>
      )}
    </>
  );
}

export default Overlay;