// SketchBattle.jsx — bottom-fixed toolbar + canvas fills remaining height (upgraded)
import { useEffect, useMemo, useRef, useState } from "react";

/**
 * Скетч-баттл (мобайл) — PRO
 * - Pointer Events + pressure
 * - Сглаживание (quadratic) + упрощение (RDP)
 * - Превью кисти, пипетка (long-press)
 * - Undo/Redo + edge-swipe: слева→Undo, справа→Redo
 * - Кольцевой таймер с миганием на последних 5 сек
 * - Скрытие UI во время рисования (возврат через 600мс)
 * - Палитра пресетов + недавние
 * - Автосейв/restored localStorage
 * - Превью миниатюра + PNG/WebP экспорт
 * - Long-press на ластик => Очистить всё (confirm)
 * - Адаптация под Telegram themeParams
 * - “3 подсказки — выбери одну” перед стартом
 * - Подтверждение выхода во время раунда
 */

export default function SketchBattle({ goBack, onProgress }) {
  const tg = typeof window !== "undefined" ? window?.Telegram?.WebApp : undefined;

  // ---------- Game state ----------
  const [phase, setPhase] = useState("setup"); // setup | play | result
  const [duration, setDuration] = useState(30);
  const [prompt, setPrompt] = useState(() => randomPrompt());
  const [promptOptions, setPromptOptions] = useState(() => randomPromptOptions());
  const [timeLeft, setTimeLeft] = useState(duration);
  const [guessed, setGuessed] = useState(null);

  // ---------- Drawing ----------
  const canvasRef = useRef(null);
  const wrapRef = useRef(null);
  const topbarRef = useRef(null);
  const toolbarRef = useRef(null);

  const [color, setColor] = useState("#ffffff");
  const [recentColors, setRecentColors] = useState(["#000000", "#ffffff"]);
  const [size, setSize] = useState(8);
  const [tool, setTool] = useState("brush"); // brush | eraser
  const [strokes, setStrokes] = useState([]); // [{tool,color,size,points:[{x,y,pressure}]}]
  const [redoStack, setRedoStack] = useState([]);
  const [isDrawing, setIsDrawing] = useState(false);

  // UI/preview
  const [tbH, setTbH] = useState(76);
  const [uiHidden, setUiHidden] = useState(false);
  const [preview, setPreview] = useState(null);
  const [cursorPreview, setCursorPreview] = useState({ x: 0, y: 0, r: 4, show: false });

  // DPR/RAF
  const dpr = useMemo(
    () => (typeof window !== "undefined" ? Math.min(3, window.devicePixelRatio || 1) : 1),
    []
  );
  const rafId = useRef(null);
  const queuedSeg = useRef(null);
  const strokesRef = useRef(strokes);
  useEffect(() => {
    strokesRef.current = strokes;
  }, [strokes]);

  // Long-press helpers (пипетка и ластик)
  const pipetteTO = useRef(null);
  const eraserTO = useRef(null);

  // Edge-swipe жесты
  const gestureRef = useRef({ side: null, startX: 0, moved: false });

  // ---------- Theme (Telegram) ----------
  useEffect(() => {
    if (!tg?.themeParams) return;
    const t = tg.themeParams;
    const root = document.documentElement.style;
    if (t.button_color) root.setProperty("--btn", t.button_color);
    if (t.button_text_color) root.setProperty("--btn-text", t.button_text_color);
    if (t.bg_color) root.setProperty("--bg", t.bg_color);
    if (t.text_color) root.setProperty("--text", t.text_color);
    if (t.hint_color) root.setProperty("--hint", t.hint_color);
    if (t.secondary_bg_color) root.setProperty("--surface", t.secondary_bg_color);
  }, [tg]);

  // ---------- Size / layout ----------
  useEffect(() => {
    const cnv = canvasRef.current;
    const wrap = wrapRef.current;
    if (!cnv || !wrap) return;

    const computeToolbarHeight = () => {
      const h = (toolbarRef.current?.offsetHeight || 0) + safeBottom();
      setTbH(h || 76);
    };

    const computeSize = () => {
      computeToolbarHeight();

      const MAX_STAGE_W = 360;
      const vw = Math.min(wrap.clientWidth, MAX_STAGE_W);

      const vv = window.visualViewport;
      const fullH = vv ? vv.height : window.innerHeight;

      const topbarH = topbarRef.current?.offsetHeight || 0;
      const toolbarHeight = (toolbarRef.current?.offsetHeight || 0) + safeBottom();
      const paddings = 12 + 12;

      const availableH = Math.max(220, fullH - topbarH - toolbarHeight - paddings - 6);

      const idealH = Math.round(vw * 0.66);
      const h = Math.min(idealH, Math.floor(availableH));
      const w = vw;

      cnv.width = Math.max(1, Math.round(w * dpr));
      cnv.height = Math.max(1, Math.round(h * dpr));
      cnv.style.width = `${w}px`;
      cnv.style.height = `${h}px`;

      const ctx = cnv.getContext("2d");
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      redraw(ctx, strokesRef.current);
    };

    computeSize();

    const ro = new ResizeObserver(computeSize);
    ro.observe(wrap);

    const onVV = () => computeSize();
    window.visualViewport?.addEventListener("resize", onVV, { passive: true });
    window.addEventListener("orientationchange", computeSize, { passive: true });

    return () => {
      ro.disconnect();
      window.visualViewport?.removeEventListener("resize", onVV);
      window.removeEventListener("orientationchange", computeSize);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dpr, phase]);

  // ---------- Timer ----------
  useEffect(() => {
    if (phase !== "play") return;
    setTimeLeft(duration);
    const id = setInterval(() => {
      setTimeLeft((t) => {
        const next = t - 1;
        if (next <= 5 && next > 0) {
          try {
            tg?.HapticFeedback?.impactOccurred?.("rigid");
          } catch {}
        }
        if (next <= 0) {
          clearInterval(id);
          finishRound();
          return 0;
        }
        return next;
      });
    }, 1000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, duration]);

  // beforeunload (подтверждение выхода во время раунда)
  useEffect(() => {
    if (phase !== "play") return;
    const onBeforeUnload = (e) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [phase]);

  // ---------- Pointer + rAF ----------
  const pointer = useRef({ x: 0, y: 0, pressure: 1 });

  const posFromPointer = (e) => {
    const cnv = canvasRef.current;
    const rect = cnv.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const pressure = Math.max(0.1, e.pressure || 1);
    return { x, y, pressure };
  };

  const scheduleSegment = (p1, p2, s) => {
    queuedSeg.current = { p1, p2, s };
    if (rafId.current) return;
    rafId.current = requestAnimationFrame(() => {
      const seg = queuedSeg.current;
      queuedSeg.current = null;
      rafId.current = null;
      if (!seg) return;
      const ctx = canvasRef.current.getContext("2d");
      drawSegment(ctx, seg.p1, seg.p2, seg.s);
    });
  };

  const startStroke = (e) => {
    if (phase !== "play") return;
    const p = posFromPointer(e);
    pointer.current = p;

    // edge-swipe режим, если старт у кромки и не перо/мышь с правкой
    const vw = window.innerWidth;
    const side = p.x < 20 ? "left" : p.x > vw - 20 ? "right" : null;
    gestureRef.current = { side, startX: e.clientX, moved: false };

    // пипетка long-press (450мс). Если сработает — рисование не стартуем.
    clearTimeout(pipetteTO.current);
    pipetteTO.current = setTimeout(() => {
      if (tool !== "eraser") {
        pickColorAt(p.x, p.y);
        try {
          tg?.HapticFeedback?.impactOccurred?.("light");
        } catch {}
      }
    }, 450);

    // если edge-swipe активен — не начинаем штрих сразу
    if (side) return;

    setIsDrawing(true);
    setUiHidden(true);
    e.currentTarget.setPointerCapture?.(e.pointerId);
    setRedoStack([]); // новый штрих сбрасывает redo
    setStrokes((arr) => [...arr, { tool, color, size, points: [p] }]);
    setCursorPreview({ x: p.x, y: p.y, r: size * (p.pressure || 1) / 2, show: true });
  };

  const moveStroke = (e) => {
    // отменяем пипетку, если есть движение
    if (pipetteTO.current) {
      clearTimeout(pipetteTO.current);
      pipetteTO.current = null;
    }

    const p = posFromPointer(e);
    const g = gestureRef.current;

    // edge-swipe: фиксируем существенное движение
    if (g.side && !g.moved && Math.abs(e.clientX - g.startX) > 40) {
      g.moved = true;
    }

    // если edge-swipe активен — ничего не рисуем
    if (g.side) return;

    if (!isDrawing) return;
    const lastStroke = strokesRef.current[strokesRef.current.length - 1];
    if (!lastStroke) return;
    const prev = lastStroke.points.at(-1) || pointer.current;
    lastStroke.points.push(p);
    scheduleSegment(prev, p, lastStroke);
    setCursorPreview({ x: p.x, y: p.y, r: size * (p.pressure || 1) / 2, show: true });
  };

  const endStroke = (e) => {
    // отменить таймер пипетки, если он ещё тикает
    if (pipetteTO.current) {
      clearTimeout(pipetteTO.current);
      pipetteTO.current = null;
    }

    const g = gestureRef.current;
    // обработка edge-swipe жеста
    if (g.side && g.moved) {
      if (g.side === "left") {
        doUndo();
      } else if (g.side === "right") {
        doRedo();
      }
      gestureRef.current = { side: null, startX: 0, moved: false };
      return;
    }
    gestureRef.current = { side: null, startX: 0, moved: false };

    if (!isDrawing) return;
    setIsDrawing(false);
    setTimeout(() => setUiHidden(false), 600);
    setCursorPreview((c) => ({ ...c, show: false }));

    // финальное сглаживание/упрощение штриха
    setStrokes((arr) => {
      const next = [...arr];
      const last = next[next.length - 1];
      if (last?.points?.length > 1) {
        last.points = simplify(smooth(last.points));
        const ctx = canvasRef.current.getContext("2d");
        clearCanvas(ctx);
        redraw(ctx, next);
      }
      return next;
    });
  };

  // ---------- Actions ----------
  const start = () => {
    setPhase("play");
    setGuessed(null);
    setStrokes([]);
    setRedoStack([]);
    setPreview(null);
    // если пользователь выбрал подсказку — оставляем; иначе берём текущую или первую из опций
    setPrompt((p) => p || promptOptions[0] || randomPrompt());
    try {
      tg?.HapticFeedback?.impactOccurred?.("medium");
    } catch {}
  };

  const finishRound = () => {
    // предпросмотр для экрана результата
    const cnv = canvasRef.current;
    try {
      setPreview(cnv?.toDataURL("image/png") || null);
    } catch {
      setPreview(null);
    }
    setPhase("result");
    try {
      tg?.HapticFeedback?.notificationOccurred?.("success");
    } catch {}
    onProgress?.();
  };

  const doUndo = () => {
    if (!strokesRef.current.length) return;
    setStrokes((arr) => {
      const next = arr.slice(0, -1);
      setRedoStack((rs) => [...rs, arr.at(-1)]);
      const ctx = canvasRef.current.getContext("2d");
      clearCanvas(ctx);
      redraw(ctx, next);
      return next;
    });
    try {
      tg?.HapticFeedback?.selectionChanged?.();
    } catch {}
  };

  const doRedo = () => {
    setRedoStack((rs) => {
      if (!rs.length) return rs;
      const last = rs.at(-1);
      const left = rs.slice(0, -1);
      setStrokes((arr) => {
        const next = [...arr, last];
        const ctx = canvasRef.current.getContext("2d");
        clearCanvas(ctx);
        redraw(ctx, next);
        return next;
      });
      try {
        tg?.HapticFeedback?.selectionChanged?.();
      } catch {}
      return left;
    });
  };

  const clearAll = () => {
    const ctx = canvasRef.current.getContext("2d");
    clearCanvas(ctx);
    setStrokes([]);
    setRedoStack([]);
  };

  const confirmClearAll = () => {
    if (strokesRef.current.length === 0) return;
    if (window.confirm("Очистить холст?")) clearAll();
  };

  // long-press на ластик => очистить всё
  const onEraserDown = () => {
    setTool("eraser");
    clearTimeout(eraserTO.current);
    eraserTO.current = setTimeout(() => confirmClearAll(), 500);
  };
  const onEraserUp = () => {
    clearTimeout(eraserTO.current);
  };

  // экспорт PNG с белым фоном
  const exportPNG = async () => {
    const file = await toImageFile("image/png", "png");
    if (!file) return;
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({
        title: "Скетч-баттл",
        text: `Наш скетч: «${prompt}»`,
        files: [file],
      });
      return;
    }
    const url = URL.createObjectURL(file);
    const a = document.createElement("a");
    a.href = url;
    a.download = file.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  };

  const exportWebP = async () => {
    const file = await toImageFile("image/webp", "webp");
    if (!file) return;
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({
        title: "Скетч-баттл",
        text: `Наш скетч: «${prompt}»`,
        files: [file],
      });
      return;
    }
    const url = URL.createObjectURL(file);
    const a = document.createElement("a");
    a.href = url;
    a.download = file.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  };

  const toImageFile = (mime, ext) =>
    new Promise(async (resolve) => {
      try {
        const cnv = canvasRef.current;
        const tmp = document.createElement("canvas");
        tmp.width = cnv.width;
        tmp.height = cnv.height;
        const tctx = tmp.getContext("2d");
        tctx.fillStyle = "#ffffff";
        tctx.fillRect(0, 0, tmp.width, tmp.height);
        tctx.drawImage(cnv, 0, 0);
        tmp.toBlob(
          (blob) => {
            if (!blob) return resolve(null);
            const file = new File([blob], `sketch-${Date.now()}.${ext}`, { type: mime });
            resolve(file);
          },
          mime,
          0.95
        );
      } catch {
        resolve(null);
      }
    });

  // back с подтверждением во время раунда
  const handleBack = () => {
    if (phase === "play") {
      const ok = window.confirm("Раунд идёт. Выйти и потерять рисунок?");
      if (!ok) return;
    }
    goBack?.();
  };

  // палитра: клик по цвету
  const applyColor = (c) => {
    setColor(c);
    setRecentColors((arr) => {
      const next = [c, ...arr.filter((x) => x.toLowerCase() !== c.toLowerCase())].slice(0, 6);
      localStorage.setItem("sb_recent_colors_v1", JSON.stringify(next));
      return next;
    });
  };

  // пипетка: взять цвет из текущего пикселя
  const pickColorAt = (x, y) => {
    const ctx = canvasRef.current.getContext("2d");
    const px = ctx.getImageData(Math.round(x * dpr), Math.round(y * dpr), 1, 1).data;
    const hex = `#${[0, 1, 2].map((i) => px[i].toString(16).padStart(2, "0")).join("")}`;
    applyColor(hex);
  };

  // ---------- Autosave / Restore ----------
  useEffect(() => {
    // restore
    try {
      const raw = localStorage.getItem("sb_state_v1");
      if (raw) {
        const { strokes: s, prompt: pr, duration: du, phase: ph, color: c, size: sz, recentColors: rc } = JSON.parse(raw);
        if (Array.isArray(s)) setStrokes(s);
        if (Array.isArray(rc)) setRecentColors(rc);
        if (pr) setPrompt(pr);
        if (du) setDuration(du);
        if (c) setColor(c);
        if (sz) setSize(sz);
        if (ph === "play") setPhase("play");
      }
      const r = localStorage.getItem("sb_recent_colors_v1");
      if (r) setRecentColors(JSON.parse(r));
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const payload = {
      strokes: strokesRef.current,
      prompt,
      duration,
      phase,
      color,
      size,
      recentColors,
    };
    try {
      localStorage.setItem("sb_state_v1", JSON.stringify(payload));
    } catch {}
  }, [strokes, prompt, duration, phase, color, size, recentColors]);

  // ---------- Render ----------
  return (
    <div className={`sb ${uiHidden ? "uiHidden" : ""}`} style={{ "--tbH": `${tbH}px` }}>
      {phase === "setup" && (
        <section className="screen">
          <header className="hdr">
            <div className="emoji" aria-hidden>
              ✍️
            </div>
            <h1>Скетч-баттл</h1>
            <p className="hint">Выбери подсказку и длительность — рисуй, а другие угадывают!</p>
          </header>

          <div className="panel">
            <label className="lbl">Выбери одну из 3 подсказок</label>
            <div className="row wrap">
              {promptOptions.map((opt) => (
                <button
                  key={opt}
                  className={`chip pickable ${opt === prompt ? "on" : ""}`}
                  onClick={() => setPrompt(opt)}
                >
                  {opt}
                </button>
              ))}
              <button
                className="btn small ghost"
                onClick={() => {
                  const next = randomPromptOptions();
                  setPromptOptions(next);
                  setPrompt(next[0]);
                }}
              >
                Случайно
              </button>
            </div>
          </div>

          <div className="panel">
            <label className="lbl">
              Длительность: <b>{duration} сек</b>
            </label>
            <input
              type="range"
              min={15}
              max={90}
              step={5}
              value={duration}
              onChange={(e) => setDuration(Number(e.target.value))}
              className="range"
            />
          </div>

          <div className="cta">
            <button className="btn cta" onClick={start}>
              Начать
            </button>
            <button className="btn back" onClick={handleBack}>
              Назад
            </button>
          </div>
        </section>
      )}

      {phase === "play" && (
        <section className="screen play">
          <header className="topbar" ref={topbarRef}>
            <div className="left">
              <div className={`timerRing ${timeLeft <= 5 ? "urgent" : ""}`} style={{ "--p": 1 - timeLeft / duration }}>
                <span>⏳ {timeLeft}s</span>
              </div>
              <span className="chip hide-sm">Тема: {prompt}</span>
            </div>
            <div className="right">
              <button className="btn small ghost" onClick={finishRound}>
                Готово
              </button>
            </div>
          </header>

          <div
            className="canvasWrap"
            ref={wrapRef}
            onPointerDown={startStroke}
            onPointerMove={moveStroke}
            onPointerUp={endStroke}
            onPointerCancel={endStroke}
          >
            <canvas ref={canvasRef} className="canvas" />
            {/* превью кружка кисти */}
            {cursorPreview.show && (
              <div
                className="cursorPreview"
                style={{
                  transform: `translate(${cursorPreview.x - cursorPreview.r}px, ${cursorPreview.y - cursorPreview.r}px)`,
                  width: `${cursorPreview.r * 2}px`,
                  height: `${cursorPreview.r * 2}px`,
                }}
              />
            )}
          </div>

          {/* Bottom fixed toolbar */}
          <nav className="toolbarFixed" ref={toolbarRef}>
            <div className="toolbarInner">
              <button
                className={`tool ${tool === "brush" ? "on" : ""}`}
                onClick={() => setTool("brush")}
                title="Кисть"
              >
                🖌️
              </button>

              <button
                className={`tool ${tool === "eraser" ? "on" : ""}`}
                onPointerDown={onEraserDown}
                onPointerUp={onEraserUp}
                onPointerCancel={onEraserUp}
                title="Ластик (long-press — очистить)"
              >
                🧽
              </button>

              <label className="pick" title="Цвет">
                <input
                  className="col"
                  type="color"
                  value={color}
                  onChange={(e) => applyColor(e.target.value)}
                />
              </label>

              <div className="sizeBox" title="Толщина">
                <input
                  className="th"
                  type="range"
                  min={2}
                  max={28}
                  value={size}
                  onChange={(e) => setSize(Number(e.target.value))}
                />
                <span className="dot" style={{ width: size, height: size }} />
              </div>

              <button className="tool ghost" onClick={doUndo} disabled={!strokes.length} title="Отмена">
                ↩︎
              </button>
              <button className="tool ghost" onClick={doRedo} disabled={!redoStack.length} title="Повтор">
                ↪︎
              </button>

              <button className="tool" onClick={exportPNG} title="Экспорт PNG">
                ⬇️
              </button>

              {/* Палитра пресетов */}
              <div className="swatches">
                {["#000000", "#ffffff", "#FF4757", "#FFA502", "#2ED573", "#1E90FF", "#A55EEA"].map((c) => (
                  <button key={c} className="sw" style={{ background: c }} onClick={() => applyColor(c)} aria-label={c} />
                ))}
              </div>

              {/* Недавние цвета */}
              {recentColors?.length > 0 && (
                <div className="recent">
                  {recentColors.map((c) => (
                    <button key={c} className="sw sm" style={{ background: c }} onClick={() => applyColor(c)} aria-label={c} />
                  ))}
                </div>
              )}
            </div>
          </nav>
        </section>
      )}

      {phase === "result" && (
        <section className="screen">
          <header className="hdr">
            <div className="emoji" aria-hidden>
              🎉
            </div>
            <h1>Угадали?</h1>
            <p className="hint">Подсказка была: «{prompt}»</p>
          </header>

          {preview && (
            <div className="panel">
              <img
                src={preview}
                alt="Превью рисунка"
                style={{ width: "100%", borderRadius: 12, border: "1px solid rgba(0,0,0,.08)" }}
              />
            </div>
          )}

          <div className="cta">
            <button className={`btn ${guessed === true ? "cta" : ""}`} onClick={() => setGuessed(true)}>
              Да, угадали
            </button>
            <button className={`btn ${guessed === false ? "cta" : ""}`} onClick={() => setGuessed(false)}>
              Нет
            </button>
          </div>

          <div className="panel">
            <div className="row">
              <button className="btn" onClick={exportPNG}>
                Скачать/поделиться PNG
              </button>
              <button className="btn" onClick={exportWebP}>
                Поделиться WebP
              </button>
              <button
                className="btn ghost"
                onClick={() => {
                  setPromptOptions(randomPromptOptions());
                  setPrompt(randomPrompt());
                  setPhase("setup");
                }}
              >
                Новый раунд
              </button>
              <button className="btn back" onClick={handleBack}>
                Закрыть
              </button>
            </div>
          </div>
        </section>
      )}

      <Styles />
    </div>
  );

  /* ================= Helpers ================= */

  function safeBottom() {
    try {
      const v = getComputedStyle(document.documentElement).getPropertyValue("env(safe-area-inset-bottom)");
      return v && !isNaN(parseInt(v)) ? parseInt(v) : 0;
    } catch {
      return 0;
    }
  }

  function clearCanvas(ctx) {
    const cnv = ctx.canvas;
    ctx.clearRect(0, 0, cnv.width, cnv.height);
  }

  function redraw(ctx, strokes) {
    clearCanvas(ctx);
    for (const s of strokes) drawStroke(ctx, s);
  }

  // Сглаживание: усреднение до промежуточных точек для quad curve
  function smooth(points) {
    if (points.length < 3) return points;
    const out = [points[0]];
    for (let i = 1; i < points.length - 1; i++) {
      const p = points[i],
        n = points[i + 1];
      out.push({ x: (p.x + n.x) / 2, y: (p.y + n.y) / 2, pressure: p.pressure ?? 1 });
    }
    out.push(points.at(-1));
    return out;
  }

  // Упрощение: лёгкий Ramer–Douglas–Peucker
  function simplify(points, eps = 0.8) {
    if (points.length < 3) return points;
    const dist = (a, b, p) =>
      Math.abs((b.x - a.x) * (a.y - p.y) - (a.x - p.x) * (b.y - a.y)) / Math.hypot(b.x - a.x, b.y - a.y);
    const rdp = (pts) => {
      let dmax = 0,
        idx = 0;
      for (let i = 1; i < pts.length - 1; i++) {
        const d = dist(pts[0], pts.at(-1), pts[i]);
        if (d > dmax) {
          dmax = d;
          idx = i;
        }
      }
      if (dmax > eps) {
        const L = rdp(pts.slice(0, idx + 1));
        const R = rdp(pts.slice(idx));
        return L.slice(0, -1).concat(R);
      }
      return [pts[0], pts.at(-1)];
    };
    return rdp(points);
  }

  function drawStroke(ctx, s) {
    const pts = s.points;
    if (!pts?.length) return;
    ctx.save();
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.globalCompositeOperation = s.tool === "eraser" ? "destination-out" : "source-over";
    ctx.strokeStyle = s.tool === "eraser" ? "rgba(0,0,0,1)" : s.color || "#fff";
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length - 1; i++) {
      const midX = (pts[i].x + pts[i + 1].x) / 2,
        midY = (pts[i].y + pts[i + 1].y) / 2;
      ctx.lineWidth = s.size * (pts[i].pressure || 1);
      ctx.quadraticCurveTo(pts[i].x, pts[i].y, midX, midY);
    }
    ctx.lineTo(pts.at(-1).x, pts.at(-1).y);
    ctx.stroke();
    ctx.restore();
  }

  function drawSegment(ctx, p1, p2, s) {
    if (!p1 || !p2) return;
    const w = s.size * (((p1.pressure || 1) + (p2.pressure || 1)) / 2);
    ctx.save();
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.lineWidth = w;
    ctx.globalCompositeOperation = s.tool === "eraser" ? "destination-out" : "source-over";
    ctx.strokeStyle = s.tool === "eraser" ? "rgba(0,0,0,1)" : s.color || "#fff";
    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.stroke();
    ctx.restore();
  }
}

/* ================= Data ================= */

const PROMPTS = [
  "Кот на скейтборде",
  "Подводная лодка",
  "Пицца с крыльями",
  "Горящий костёр",
  "Космонавт",
  "Гора с флагом",
  "Робот-повар",
  "Лампа-джинн",
  "Ракета",
  "Кактус",
  "Самокат",
  "Солнечные очки",
  "Зонтик под дождём",
  "Планета с кольцами",
  "Лис в наушниках",
];

function randomPrompt() {
  return PROMPTS[Math.floor(Math.random() * PROMPTS.length)];
}

function randomPromptOptions() {
  // три различных подсказки
  const pool = [...PROMPTS];
  const out = [];
  while (out.length < 3 && pool.length) {
    const i = Math.floor(Math.random() * pool.length);
    out.push(pool.splice(i, 1)[0]);
  }
  return out;
}

/* ================= Styles ================= */

function Styles() {
  return (
    <style
      dangerouslySetInnerHTML={{
        __html: `
/* Root */
.sb { min-height: 100dvh; padding: 12px; color: var(--text); }

/* Common blocks */
.screen {
  width: 100%;
  max-width: 380px;
  margin: 0 auto;
  display: grid;
  gap: 12px;
}
.hdr { text-align: center; margin-top: 2px; }
.hdr .emoji { font-size: 28px; filter: drop-shadow(0 6px 12px rgba(0,0,0,.15)); }
.hdr h1 { margin: 8px 0 4px; font-size: clamp(20px, 5.2vw, 26px); letter-spacing: .2px; }
.hint { color: var(--hint); font-size: 13px; }

.panel {
  background: color-mix(in srgb, var(--surface) 100%, transparent);
  border: 1px solid color-mix(in srgb, var(--text) 10%, transparent);
  border-radius: 16px;
  padding: 12px;
  box-shadow: 0 10px 28px rgba(0,0,0,.10);
}
.lbl { display:block; font-size: 13px; color: var(--hint); margin-bottom: 8px; }
.row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.row.wrap { flex-wrap: wrap; }
.prompt { font-weight: 900; padding: 8px 10px; border-radius: 10px; background: color-mix(in srgb, var(--surface) 80%, transparent); border: 1px solid color-mix(in srgb, var(--text) 10%, transparent); }

/* Chips */
.chip {
  font-size: 12px; padding: 6px 10px; border-radius: 999px;
  background: color-mix(in srgb, var(--surface) 70%, transparent);
  border: 1px solid color-mix(in srgb, var(--text) 10%, transparent);
  color: var(--text);
}
.chip.pickable { cursor: pointer; }
.chip.on { outline: 2px solid color-mix(in srgb, var(--text) 18%, transparent); }

/* Buttons */
.cta { display:flex; gap: 10px; justify-content: center; }
.btn {
  min-height: 44px;
  padding: 10px 14px; border-radius: 12px; font-weight: 900; letter-spacing:.2px;
  border: 1px solid color-mix(in srgb, var(--text) 12%, transparent);
  background: color-mix(in srgb, var(--surface) 85%, transparent);
  color: var(--text);
  transition: transform .12s ease, box-shadow .12s ease, background .12s ease;
}
.btn.small { min-height: 36px; padding: 8px 10px; font-weight: 800; }
.btn:hover { transform: translateY(-1px); box-shadow: 0 10px 30px rgba(0,0,0,.10); }
.btn.ghost { background: color-mix(in srgb, var(--surface) 85%, transparent); }
.btn.back { background: color-mix(in srgb, var(--surface) 92%, transparent); }
.btn.cta { background: var(--btn, #0ea5e9); color: var(--btn-text, #fff); }

/* Top bar */
.topbar {
  display:flex; gap:8px; justify-content: space-between; align-items:center;
  position: sticky; top: 0;
  padding: 8px 10px;
  border-radius: 12px;
  background: color-mix(in srgb, var(--surface) 100%, transparent);
  border: 1px solid color-mix(in srgb, var(--text) 10%, transparent);
  backdrop-filter: blur(8px);
  z-index: 5;
}
.left, .right { display:flex; gap:8px; align-items:center; }
.hide-sm { display:none; }
@media (min-width: 480px) { .hide-sm { display:inline-flex; } }

/* Кольцевой таймер */
.timerRing{
  --p:0;
  display:inline-flex; align-items:center; gap:8px; padding:6px 10px; border-radius:999px;
  background:
    conic-gradient(var(--btn,#0ea5e9) calc(var(--p)*360deg), transparent 0) border-box,
    color-mix(in srgb, var(--surface) 70%, transparent) padding-box;
  border: 1px solid color-mix(in srgb, var(--text) 10%, transparent);
}
.timerRing.urgent { animation: pulse .8s infinite; }
@keyframes pulse {
  0%,100% { filter: brightness(1); }
  50% { filter: brightness(1.25); }
}

/* Canvas wrap */
.canvasWrap {
  user-select: none; touch-action: none;
  max-width: 360px; margin: 0 auto;
  border-radius: 16px; overflow: hidden; position: relative;
  background: #111; border: 1px solid color-mix(in srgb, var(--text) 12%, transparent);
  box-shadow: inset 0 0 0 1px rgba(255,255,255,.02), 0 10px 28px rgba(0,0,0,.12);
}
.canvas { display:block; width:100%; height:auto; }

/* Превью кисти */
.cursorPreview {
  position: absolute; pointer-events: none; border-radius: 999px;
  border: 1px solid rgba(255,255,255,.8); box-shadow: 0 0 0 1px rgba(0,0,0,.3);
  background: transparent;
}

/* PLAY paddings */
.screen.play {
  padding-top: 4px;
  padding-bottom: calc(var(--tbH, 76px) + env(safe-area-inset-bottom) + 8px);
}

/* Bottom FIXED toolbar */
.toolbarFixed {
  position: fixed;
  left: 0; right: 0;
  bottom: 0;
  padding-bottom: env(safe-area-inset-bottom);
  z-index: 20;
  background: color-mix(in srgb, var(--bg) 60%, transparent);
  backdrop-filter: blur(10px);
  border-top: 1px solid color-mix(in srgb, var(--text) 10%, transparent);
}
.toolbarInner {
  width: 100%;
  max-width: 360px;
  margin: 8px auto;
  padding: 8px 10px;
  display: grid;
  grid-template-columns: repeat(7, minmax(0,1fr));
  grid-auto-rows: 48px;
  gap: 8px;
  background: color-mix(in srgb, var(--surface) 100%, transparent);
  border: 1px solid color-mix(in srgb, var(--text) 10%, transparent);
  border-radius: 14px;
  box-shadow: 0 10px 28px rgba(0,0,0,.10);
}
@media (max-width: 360px) {
  .toolbarInner { grid-template-columns: repeat(5, minmax(0,1fr)); }
}

.tool {
  min-width: 44px; height: 44px; border-radius: 12px;
  border: 1px solid color-mix(in srgb, var(--text) 12%, transparent);
  background: color-mix(in srgb, var(--surface) 85%, transparent);
  font-size: 18px;
}
.tool.on { outline: 2px solid color-mix(in srgb, var(--text) 20%, transparent); }
.tool:disabled { opacity:.5; }
.pick { display:inline-grid; place-items:center; }
.col { width: 44px; height: 44px; padding:0; border: none; background: transparent; }
.sizeBox { display:flex; align-items:center; gap:8px; min-width: 0; }
.th { width: 100%; max-width: 160px; }
.dot { display:inline-block; border-radius: 999px; background:#fff; border:1px solid rgba(0,0,0,.15); }

/* Палитры */
.swatches { grid-column: 1 / -1; display:flex; gap:8px; justify-content:center; }
.recent { grid-column: 1 / -1; display:flex; gap:6px; justify-content:center; opacity:.9; }
.sw { width:28px; height:28px; border-radius:999px; border:1px solid rgba(0,0,0,.15); }
.sw.sm { width:22px; height:22px; }

/* Range common */
.range { width: 100%; max-width: 360px; appearance: none; height: 6px; border-radius: 999px;
  background: linear-gradient(90deg, rgba(var(--accent-rgb,14,165,233),.9), rgba(var(--accent-rgb,14,165,233),.35));
}
.range::-webkit-slider-thumb { appearance:none; width: 22px; height: 22px; border-radius: 50%; background: var(--btn,#0ea5e9); border: 2px solid color-mix(in srgb, #fff 70%, transparent); }

/* Hide UI while drawing */
.sb.uiHidden .topbar, .sb.uiHidden .toolbarFixed { opacity:.15; pointer-events:none; transition:opacity .2s; }
        `,
      }}
    />
  );
}
