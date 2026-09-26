import { useEffect, useRef, useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

async function closeAllOverlays() {
  await invoke("close_overlay_windows");
}

function cleanUnwrappedText(raw: string): string {
  return raw
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.replace(/[\r\n]+/g, " ").trim())
    .join("\n\n");
}

function Overlay() {
  const [ocrResult, setOcrResult] = useState<string | null>(null);
  const [translatedResult, setTranslatedResult] = useState<string | null>(null);
  const [ocrLang, setOcrLang] = useState("auto");
  const [translateLang, setTranslateLang] = useState("EN");
  const [translating, setTranslating] = useState(false);
  const [runningOcr, setRunningOcr] = useState(false);
  const [unwrapLines, setUnwrapLines] = useState(true);
  const [copiedBadge, setCopiedBadge] = useState<string | null>(null);
  const [isMinimized, setIsMinimized] = useState(false);
  const [isPinned, setIsPinned] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [drawing, setDrawing] = useState(false);
  const [coords, setCoords] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const start = useRef({ x: 0, y: 0 });
  const end = useRef({ x: 0, y: 0 });
  const lastCapture = useRef({ absX: 0, absY: 0, w: 0, h: 0 });
  const animRef = useRef<number | null>(null);
  const pulse = useRef(0);

  // Referência para estado mais recente para acesso seguro em atalhos
  const latestState = useRef({ ocrResult, translatedResult, unwrapLines });
  useEffect(() => {
    latestState.current = { ocrResult, translatedResult, unwrapLines };
  }, [ocrResult, translatedResult, unwrapLines]);

  const drawOverlay = useCallback((phase: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Fundo semitransparente escuro
    ctx.fillStyle = "rgba(0, 0, 0, 0.35)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const x = Math.min(start.current.x, end.current.x);
    const y = Math.min(start.current.y, end.current.y);
    const w = Math.abs(end.current.x - start.current.x);
    const h = Math.abs(end.current.y - start.current.y);

    if (w > 0 || h > 0) {
      // Recorte translúcido da área selecionada
      ctx.clearRect(x, y, w, h);

      ctx.fillStyle = "rgba(137, 207, 240, 0.08)";
      ctx.fillRect(x, y, w, h);

      const glowIntensity = 8 + Math.sin(phase) * 6;
      ctx.shadowColor = "#89CFF0";
      ctx.shadowBlur = glowIntensity;
      ctx.strokeStyle = "#89CFF0";
      ctx.lineWidth = 2;
      ctx.strokeRect(x, y, w, h);

      ctx.shadowBlur = 0;

      // Cantoneiras brancas nítidas
      const cornerLen = 14;
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
  }, []);

  const resetAll = useCallback(() => {
    if (animRef.current !== null) {
      cancelAnimationFrame(animRef.current);
      animRef.current = null;
    }
    setDrawing(false);
    start.current = { x: 0, y: 0 };
    end.current = { x: 0, y: 0 };
    setCoords(null);
    setOcrResult(null);
    setTranslatedResult(null);
    setRunningOcr(false);
    setTranslating(false);
    setCopiedBadge(null);
    setIsMinimized(false);
    setIsPinned(false);

    const canvas = canvasRef.current;
    if (canvas) {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      drawOverlay(0);
    }
  }, [drawOverlay]);

  function togglePin() {
    setIsPinned((prev) => {
      const next = !prev;
      const canvas = canvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext("2d");
        if (ctx) {
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          if (!next) {
            drawOverlay(pulse.current);
          }
        }
      }
      return next;
    });
  }

  // Inicialização e dimensionamento de tela
  useEffect(() => {
    const canvas = canvasRef.current!;
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    drawOverlay(0);

    const handleResize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      drawOverlay(pulse.current);
    };
    window.addEventListener("resize", handleResize);

    // Carrega idiomas preferidos das configurações salvas
    const syncSettings = () => {
      invoke<{ ocr_lang: string; translate_to: string }>("load_settings")
        .then((s) => {
          if (s?.ocr_lang) setOcrLang(s.ocr_lang);
          if (s?.translate_to) setTranslateLang(s.translate_to);
        })
        .catch(() => {});
    };

    syncSettings();

    // Escuta evento nativo de reabertura para zerar o canvas e recarregar configurações
    const unlistenReset = listen("reset-overlay", () => {
      resetAll();
      syncSettings();
    });

    // Escuta atalho de tradução direta de seleção
    const unlistenSelection = listen("translate-selection", async () => {
      resetAll();
      try {
        let text = "";
        try {
          text = await invoke<string>("read_clipboard");
        } catch {
          if (navigator.clipboard && navigator.clipboard.readText) {
            text = await navigator.clipboard.readText();
          }
        }
        text = (text || "").trim();
        if (text) {
          setOcrResult(text);
          setTranslating(true);
          const textToTranslate = unwrapLines ? cleanUnwrappedText(text) : text;
          const translated = await invoke<string>("translate_text_cmd", {
            text: textToTranslate,
            targetLang: translateLang,
          });
          setTranslatedResult(translated);
        } else {
          setOcrResult("Nenhum texto copiado na área de transferência.");
        }
      } catch (err: any) {
        setOcrResult("Não foi possível ler a área de transferência.");
      } finally {
        setTranslating(false);
      }
    });

    return () => {
      window.removeEventListener("resize", handleResize);
      unlistenReset.then((unlisten) => unlisten());
      unlistenSelection.then((unlisten) => unlisten());
    };
  }, [drawOverlay, resetAll, translateLang, unwrapLines]);

  async function copyText(text: string, label: string) {
    if (!text || text === "—" || text === "(nenhum texto encontrado)") return;
    try {
      try {
        await invoke("copy_to_clipboard", { text });
      } catch {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(text);
        } else {
          const textarea = document.createElement("textarea");
          textarea.value = text;
          document.body.appendChild(textarea);
          textarea.select();
          document.execCommand("copy");
          document.body.removeChild(textarea);
        }
      }
      setCopiedBadge(label);
      setTimeout(() => setCopiedBadge(null), 1800);
    } catch (err) {
      console.error("Falha ao copiar:", err);
    }
  }

  // Atalhos de teclado
  useEffect(() => {
    async function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        closeAllOverlays();
        return;
      }

      if (e.key === "Enter") {
        const { translatedResult, ocrResult, unwrapLines } = latestState.current;
        const target = translatedResult || ocrResult;
        if (target && target !== "(nenhum texto encontrado)") {
          e.preventDefault();
          const processed = unwrapLines ? cleanUnwrappedText(target) : target;
          await copyText(processed, "Copiado!");
          setTimeout(() => {
            closeAllOverlays();
          }, 160);
        }
        return;
      }

      if (e.altKey && (e.key === "c" || e.key === "C")) {
        e.preventDefault();
        const { ocrResult, unwrapLines } = latestState.current;
        if (ocrResult) {
          const processed = unwrapLines ? cleanUnwrappedText(ocrResult) : ocrResult;
          copyText(processed, "Original copiado!");
        }
        return;
      }

      if (
        (e.key === "c" || e.key === "C") &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.altKey &&
        document.activeElement?.tagName !== "SELECT" &&
        document.activeElement?.tagName !== "INPUT"
      ) {
        const { translatedResult, ocrResult, unwrapLines } = latestState.current;
        const target = translatedResult || ocrResult;
        if (target) {
          e.preventDefault();
          const processed = unwrapLines ? cleanUnwrappedText(target) : target;
          copyText(processed, "Tradução copiada!");
        }
      }
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

  function getCanvasPos(e: React.MouseEvent) {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function onMouseDown(e: React.MouseEvent) {
    // Ao iniciar novo clique na tela, reseta qualquer captura e linhas anteriores
    start.current = getCanvasPos(e);
    end.current = start.current;
    setDrawing(true);
    setCoords(null);
    setOcrResult(null);
    setTranslatedResult(null);
    setCopiedBadge(null);
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
      setRunningOcr(true);
      setOcrResult(null);
      setTranslatedResult(null);

      const text = await invoke<string>("capture_and_ocr", {
        x: Math.round(x),
        y: Math.round(y),
        w: Math.round(w),
        h: Math.round(h),
        lang,
      });

      setRunningOcr(false);
      setOcrResult(text);

      if (text && text !== "(nenhum texto encontrado)" && !text.startsWith("Erro")) {
        try {
          setTranslating(true);
          const textToTranslate = unwrapLines ? cleanUnwrappedText(text) : text;
          const translated = await invoke<string>("translate_text_cmd", {
            text: textToTranslate,
            targetLang: translateLang,
          });
          setTranslatedResult(translated);
        } catch (error: any) {
          const msg = typeof error === "string" ? error : error?.message || "Erro na tradução";
          setTranslatedResult(msg);
        } finally {
          setTranslating(false);
        }
      }
    } catch (err) {
      setRunningOcr(false);
      console.error("❌ Erro no OCR:", err);
      setOcrResult(`Erro: ${err}`);
      setTranslatedResult(null);
    }
  }

  async function onMouseUp() {
    if (!drawing) return;
    setDrawing(false);
    stopAnimation();

    const dpr = window.devicePixelRatio || 1;
    const relX = Math.min(start.current.x, end.current.x);
    const relY = Math.min(start.current.y, end.current.y);
    const w = Math.abs(end.current.x - start.current.x);
    const h = Math.abs(end.current.y - start.current.y);

    if (w < 8 || h < 8) {
      // Clique acidental sem arrasto: limpa a tela mantendo overlay pronto
      start.current = { x: 0, y: 0 };
      end.current = { x: 0, y: 0 };
      drawOverlay(0);
      return;
    }

    const absX = Math.round((relX + window.screenLeft) * dpr);
    const absY = Math.round((relY + window.screenTop) * dpr);
    const physW = Math.round(w * dpr);
    const physH = Math.round(h * dpr);

    lastCapture.current = { absX, absY, w: physW, h: physH };

    await doCapture(absX, absY, physW, physH, ocrLang);
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
    if (ocrResult && ocrResult !== "(nenhum texto encontrado)") {
      try {
        setTranslating(true);
        const textToTranslate = unwrapLines ? cleanUnwrappedText(ocrResult) : ocrResult;
        const translated = await invoke<string>("translate_text_cmd", {
          text: textToTranslate,
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

  const displayOcr = ocrResult
    ? unwrapLines
      ? cleanUnwrappedText(ocrResult)
      : ocrResult
    : "";
  const displayTrad = translatedResult
    ? unwrapLines
      ? cleanUnwrappedText(translatedResult)
      : translatedResult
    : "";

  const hasResult = Boolean(ocrResult || translatedResult || runningOcr);

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
          cursor: isPinned ? "default" : "crosshair",
          background: "transparent",
          zIndex: 1,
          display: isPinned ? "none" : "block",
          pointerEvents: isPinned ? "none" : "auto",
        }}
      />

      {/* Dimensões em tempo real durante seleção */}
      {coords && drawing && (
        <div
          style={{
            position: "fixed",
            top: 24,
            left: "50%",
            transform: "translateX(-50%)",
            background: "rgba(10, 10, 18, 0.85)",
            border: "1px solid rgba(137, 207, 240, 0.3)",
            backdropFilter: "blur(8px)",
            color: "#89CFF0",
            padding: "5px 14px",
            borderRadius: 20,
            fontFamily: "'Fira Code', monospace",
            fontSize: 12,
            fontWeight: 600,
            zIndex: 9999,
            pointerEvents: "none",
            boxShadow: "0 4px 16px rgba(0,0,0,0.4)",
          }}
        >
          {coords.w} × {coords.h} px
        </div>
      )}

      {/* Card Flutuante de Resultado: Não interfere na seleção e permite minimizar */}
      {hasResult && (
        <div
          style={{
            position: "fixed",
            bottom: isMinimized ? 16 : 28,
            right: 28,
            width: isMinimized ? 320 : "min(720px, calc(100vw - 56px))",
            background: "rgba(12, 15, 23, 0.94)",
            backdropFilter: "blur(24px) saturate(180%)",
            borderRadius: 12,
            border: "1px solid rgba(56, 189, 248, 0.22)",
            boxShadow: "0 20px 50px rgba(0, 0, 0, 0.7), 0 0 24px rgba(56, 189, 248, 0.12)",
            zIndex: 10,
            overflow: "hidden",
            fontFamily: "'Inter', system-ui, -apple-system, sans-serif",
            transition: "all 0.2s cubic-bezier(0.16, 1, 0.3, 1)",
          }}
        >
          {/* Barra Superior Compacta */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "8px 14px",
              background: "rgba(255, 255, 255, 0.02)",
              borderBottom: "1px solid rgba(255, 255, 255, 0.06)",
            }}
          >
            {/* Seletor de Idiomas Rápido */}
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <select
                value={ocrLang}
                onChange={(e) => handleOcrLangChange(e.target.value)}
                style={selectStyle}
              >
                <option value="auto">🌐 Detecção Auto</option>
                <option value="pt-BR">Português (BR)</option>
                <option value="en-US">Inglês (US)</option>
                <option value="es-ES">Espanhol</option>
                <option value="fr-FR">Francês</option>
                <option value="de-DE">Alemão</option>
                <option value="it-IT">Italiano</option>
              </select>

              <span style={{ color: "#38bdf8", fontSize: 13, fontWeight: 700 }}>→</span>

              <select
                value={translateLang}
                onChange={(e) => handleTranslateLangChange(e.target.value)}
                style={{ ...selectStyle, color: "#38bdf8", borderColor: "rgba(56, 189, 248, 0.35)", fontWeight: 600 }}
              >
                <option value="pt-BR">🇧🇷 Português (BR)</option>
                <option value="en-US">🇺🇸 Inglês (US)</option>
                <option value="es-ES">🇪🇸 Espanhol</option>
                <option value="fr-FR">🇫🇷 Francês</option>
                <option value="de-DE">🇩🇪 Alemão</option>
                <option value="it-IT">🇮🇹 Italiano</option>
                <option value="ja-JP">🇯🇵 Japonês</option>
                <option value="zh-CN">🇨🇳 Chinês</option>
              </select>
            </div>

            {/* Ações de Controle: Unwrap, Minimizar, Fechar */}
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <button
                onClick={() => setUnwrapLines(!unwrapLines)}
                title="Junta quebras de linha em parágrafo contínuo"
                style={{
                  background: unwrapLines ? "rgba(56, 189, 248, 0.15)" : "rgba(255, 255, 255, 0.04)",
                  color: unwrapLines ? "#38bdf8" : "#94a3b8",
                  border: unwrapLines ? "1px solid rgba(56, 189, 248, 0.3)" : "1px solid rgba(255, 255, 255, 0.08)",
                  borderRadius: 6,
                  padding: "4px 8px",
                  fontSize: 11,
                  fontWeight: 600,
                  cursor: "pointer",
                  transition: "all 0.15s ease",
                }}
              >
                {unwrapLines ? "🔗 Fluido" : "↩️ Quebras"}
              </button>

              <button
                onClick={togglePin}
                title={isPinned ? "Desafixar card (voltar ao modo recorte)" : "Fixar card na tela (permite clicar em outros programas)"}
                style={{
                  ...iconBtnStyle,
                  background: isPinned ? "rgba(56, 189, 248, 0.2)" : "rgba(255, 255, 255, 0.04)",
                  color: isPinned ? "#38bdf8" : "#94a3b8",
                  borderColor: isPinned ? "rgba(56, 189, 248, 0.4)" : "rgba(255, 255, 255, 0.08)",
                }}
              >
                📌
              </button>

              <button
                onClick={() => setIsMinimized(!isMinimized)}
                title={isMinimized ? "Expandir card" : "Minimizar card para não atrapalhar"}
                style={iconBtnStyle}
              >
                {isMinimized ? "▲" : "▼"}
              </button>

              <button
                onClick={closeAllOverlays}
                title="Fechar overlay (Esc)"
                style={{ ...iconBtnStyle, color: "#f87171" }}
              >
                ✕
              </button>
            </div>
          </div>

          {/* Conteúdo Expansível */}
          {!isMinimized && (
            <>
              {/* Abas e Ações de Cópia */}
              <div
                style={{
                  display: "flex",
                  borderBottom: "1px solid rgba(255, 255, 255, 0.06)",
                  background: "rgba(0, 0, 0, 0.2)",
                }}
              >
                <div
                  style={{
                    flex: 1,
                    padding: "8px 14px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    borderRight: "1px solid rgba(255, 255, 255, 0.06)",
                  }}
                >
                  <span style={sectionLabelStyle}>
                    Original {runningOcr && "⏳"}
                  </span>
                  {ocrResult && ocrResult !== "(nenhum texto encontrado)" && (
                    <button
                      onClick={() => copyText(displayOcr, "Original copiado!")}
                      title="Copiar texto original (Alt + C)"
                      style={copyMiniBtnStyle}
                    >
                      📋 Alt+C
                    </button>
                  )}
                </div>

                <div
                  style={{
                    flex: 1,
                    padding: "8px 14px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                  }}
                >
                  <span style={{ ...sectionLabelStyle, color: "#38bdf8" }}>
                    Tradução {translating && "⏳"}
                  </span>
                  {translatedResult && (
                    <button
                      onClick={() => copyText(displayTrad, "Tradução copiada!")}
                      title="Copiar tradução (Enter / C)"
                      style={{
                        ...copyMiniBtnStyle,
                        background: "rgba(56, 189, 248, 0.16)",
                        color: "#38bdf8",
                        borderColor: "rgba(56, 189, 248, 0.35)",
                      }}
                    >
                      ✨ Enter
                    </button>
                  )}
                </div>
              </div>

              {/* Textos Lado a Lado */}
              <div style={{ display: "flex", minHeight: 74, maxHeight: 180 }}>
                <div style={textAreaStyle}>
                  {runningOcr ? (
                    <span style={{ color: "#38bdf8", fontStyle: "italic", fontSize: 12 }}>
                      Reconhecendo texto via WinRT...
                    </span>
                  ) : (
                    displayOcr || "—"
                  )}
                </div>

                <div style={{ width: 1, background: "rgba(255, 255, 255, 0.06)" }} />

                <div style={{ ...textAreaStyle, color: "#e0f2fe", fontWeight: 500 }}>
                  {translating ? (
                    <span style={{ color: "#38bdf8", fontStyle: "italic", fontSize: 12 }}>
                      Traduzindo...
                    </span>
                  ) : (
                    displayTrad || (runningOcr ? "Aguardando OCR..." : "—")
                  )}
                </div>
              </div>

              {/* Rodapé com Dicas de Atalho */}
              <div
                style={{
                  padding: "6px 14px",
                  background: "rgba(6, 8, 14, 0.8)",
                  borderTop: "1px solid rgba(255, 255, 255, 0.06)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  fontSize: 11,
                  color: "#64748b",
                }}
              >
                <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                  <span>
                    <kbd style={kbdStyle}>Enter</kbd> Copiar & Fechar
                  </span>
                  <span>
                    <kbd style={kbdStyle}>C</kbd> Copiar Tradução
                  </span>
                  <span>
                    <kbd style={kbdStyle}>Esc</kbd> Fechar
                  </span>
                  {isPinned && (
                    <span style={{ color: "#38bdf8", fontWeight: 700, background: "rgba(56, 189, 248, 0.12)", padding: "1px 6px", borderRadius: 4 }}>
                      📌 Fixado na tela
                    </span>
                  )}
                </div>

                {copiedBadge && (
                  <div
                    style={{
                      background: "#10b981",
                      color: "#ffffff",
                      fontWeight: 700,
                      fontSize: 10,
                      padding: "2px 8px",
                      borderRadius: 4,
                      boxShadow: "0 0 10px rgba(16, 185, 129, 0.4)",
                    }}
                  >
                    ✓ {copiedBadge}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </>
  );
}

const selectStyle: React.CSSProperties = {
  background: "rgba(255, 255, 255, 0.04)",
  color: "#f1f5f9",
  border: "1px solid rgba(255, 255, 255, 0.12)",
  borderRadius: 6,
  padding: "4px 8px",
  fontSize: 11,
  fontWeight: 500,
  cursor: "pointer",
  outline: "none",
};

const iconBtnStyle: React.CSSProperties = {
  background: "rgba(255, 255, 255, 0.04)",
  color: "#94a3b8",
  border: "1px solid rgba(255, 255, 255, 0.08)",
  borderRadius: 6,
  padding: "3px 8px",
  fontSize: 11,
  cursor: "pointer",
  outline: "none",
  transition: "all 0.15s ease",
};

const copyMiniBtnStyle: React.CSSProperties = {
  background: "rgba(255, 255, 255, 0.05)",
  color: "#cbd5e1",
  border: "1px solid rgba(255, 255, 255, 0.1)",
  borderRadius: 5,
  padding: "2px 7px",
  fontSize: 10,
  fontWeight: 600,
  cursor: "pointer",
  display: "flex",
  alignItems: "center",
  gap: 4,
  fontFamily: "'JetBrains Mono', monospace",
  transition: "all 0.15s ease",
};

const sectionLabelStyle: React.CSSProperties = {
  color: "#64748b",
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
};

const textAreaStyle: React.CSSProperties = {
  flex: 1,
  padding: "12px 14px",
  color: "#cbd5e1",
  fontSize: 13,
  lineHeight: "1.55",
  overflowY: "auto",
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
};

const kbdStyle: React.CSSProperties = {
  background: "rgba(255, 255, 255, 0.08)",
  color: "#e2e8f0",
  padding: "1px 5px",
  borderRadius: 4,
  border: "1px solid rgba(255, 255, 255, 0.14)",
  fontSize: 10,
  fontFamily: "'JetBrains Mono', monospace",
  marginRight: 4,
  fontWeight: 600,
};

export default Overlay;
