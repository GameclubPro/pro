// TruthOrDare.jsx
import { useMemo, useRef, useState } from "react";

export default function TruthOrDare({ goBack, onProgress }) {
  const tg = typeof window !== "undefined" ? window?.Telegram?.WebApp : undefined;

  // Экран: intro | playing
  const [phase, setPhase] = useState("intro");
  // Режим: romantic | spicy
  const [mode, setMode] = useState(() => localStorage.getItem("tod_mode") || "romantic");
  // Активная карточка
  const [current, setCurrent] = useState(null); // { kind: 'truth'|'dare', text: string }

  // Индексы уже показанных — чтобы не повторяться
  const usedRef = useRef({
    romantic: { truth: new Set(), dare: new Set() },
    spicy: { truth: new Set(), dare: new Set() },
  });

  const pools = useMemo(() => {
    const romanticTruth = [
      "Какое твоё самое тёплое воспоминание о нас?",
      "Когда ты впервые понял(а), что мы — «мы»?",
      "Что из моего характера ты ценишь больше всего?",
      "О чём ты мечтаешь, но пока не рассказывал(а) мне?",
      "Каким ты видишь наш идеальный совместный выходной?",
      "Какой мой маленький жест делает тебя счастливее?",
      "Какая песня ассоциируется у тебя с нами?",
      "Что ты хотел(а) бы делать вместе чаще?",
      "Какое правило в отношениях для тебя важнее всего?",
      "Какой момент из нашего прошлого тебе хочется прожить снова?",
      "Каким ты видишь наш дом мечты?",
      "Какой комплимент тебе хотелось бы слышать чаще от меня?",
    ];
    const romanticDare = [
      "Обними меня крепко и не отпускай 20 секунд.",
      "Скажи три искренних комплимента подряд.",
      "Выбери песню и танцуй со мной 30 секунд.",
      "Сделай мне тёплый напиток или подай воду красиво.",
      "Напиши мне короткое любовное сообщение прямо сейчас.",
      "Сделай совместное селфи и поставь в избранное.",
      "Сделай мне лёгкий массаж плеч/шеи 1 минуту.",
      "Расскажи тост о нас, как на празднике.",
      "Поделись одной благодарностью за сегодня.",
      "Выбери фильм/сериал для нашего следующего вечера.",
      "Спрячь записку с нежными словами, я её найду позже.",
      "Сделай сердечко руками и скажи «люблю» смешным голосом.",
    ];
    const spicyTruth = [
      "Какая наша самая романтично-озорная память?",
      "Что тебя сильнее всего во мне привлекает?",
      "Где бы ты хотел(а) свидание «не как обычно»?",
      "Что из нежностей тебе нравится больше всего получать?",
      "Какой флирт от меня тебя всегда обезоруживает?",
      "Какая твоя «маленькая слабость», о которой я должен(должна) знать?",
      "Какая вещь на мне/во мне выглядит особенно притягательно?",
      "Расскажи о самом смелом комплименте, который хотел(а) бы мне сказать.",
      "Назови черту характера, из‑за которой ты «таешь».",
      "Какая романтическая фантазия у тебя в топ‑3?",
      "Какой идеальный спонтанный сюрприз для тебя?",
      "Что тебя мгновенно настраивает на романтику?",
    ];
    const spicyDare = [
      "Прошепчи мне на ухо тёплую фразу (любой комплимент).",
      "Поцелуй меня в лоб/нос/щёку — твой выбор.",
      "Скажи мне 3 вещи, которые тебя заводят во мне (мягко).",
      "Сделай «сердечный» хай‑файв: ладонь к ладони и задержи взгляд 10 сек.",
      "Опиши меня тремя «вкусными» прилагательными.",
      "Придумай и объяви мини‑свидание на 15 минут прямо сейчас.",
      "Сделай мне «мурашечный» массаж головы/кистей 1 минуту.",
      "Скажи, за что ты сейчас особенно благодарен(на) мне, глядя в глаза.",
      "Выбери трек и устрой 20‑секундный танец‑флирт.",
      "Скажи «Я тебя хочу видеть счастливым(ой)» и объясни чем ты поможешь.",
      "Назначь «секретный» знак для нас на сегодня (жест/слово).",
      "Сделай загадочный взгляд и подмигни — три раза!",
    ];
    return {
      romantic: { truth: romanticTruth, dare: romanticDare },
      spicy: { truth: spicyTruth, dare: spicyDare },
    };
  }, []);

  const poolFor = (k) => pools[mode][k];

  const pickRandom = (kind, replace = false) => {
    const list = poolFor(kind);
    const used = usedRef.current[mode][kind];

    // если показана карточка и replace=true — убираем её из учёта (чтоб можно было «Другое»)
    if (replace && current?.kind === kind) {
      // ничего делать не надо для used — текущая уже учтена
    }

    // если исчерпали колоду — сброс
    if (used.size >= list.length) used.clear();

    // выбираем индекс, которого нет в used
    let idx;
    const tries = 50;
    for (let i = 0; i < tries; i++) {
      const r = Math.floor(Math.random() * list.length);
      if (!used.has(r)) { idx = r; break; }
    }
    if (idx === undefined) {
      // На всякий случай — если не нашли, сбросить и взять первый
      used.clear();
      idx = 0;
    }

    used.add(idx);
    const text = list[idx];
    setCurrent({ kind, text });

    try {
      tg?.HapticFeedback?.impactOccurred?.("rigid");
    } catch {}
  };

  const startGame = () => {
    try {
      tg?.HapticFeedback?.notificationOccurred?.("success");
    } catch {}
    setPhase("playing");
    setCurrent(null);
  };

  const finishCard = () => {
    // засчитываем прогресс за выполненную карточку
    onProgress?.();
    setCurrent(null);
    try {
      tg?.HapticFeedback?.impactOccurred?.("light");
    } catch {}
  };

  const toggleMode = () => {
    const next = mode === "romantic" ? "spicy" : "romantic";
    setMode(next);
    localStorage.setItem("tod_mode", next);
    try { tg?.HapticFeedback?.impactOccurred?.("soft"); } catch {}
  };

  return (
    <div className="tod">
      {phase === "intro" ? (
        <Intro mode={mode} onToggleMode={toggleMode} onStart={startGame} />
      ) : (
        <Playground
          mode={mode}
          current={current}
          onPickTruth={() => pickRandom("truth")}
          onPickDare={() => pickRandom("dare")}
          onAnother={() => current && pickRandom(current.kind, true)}
          onDone={finishCard}
          onToggleMode={toggleMode}
        />
      )}
      <Styles />
    </div>
  );
}

/* ================= screens ================= */

function Intro({ mode, onToggleMode, onStart }) {
  return (
    <section className="tod-intro" aria-label="Правда или Действие — старт">
      <div className="tod-intro-card">
        <div className="tod-emoji" aria-hidden>🔥</div>
        <h1 className="tod-title">Правда / Действие</h1>
        <p className="tod-sub">
          Лёгкий способ добавить романтики и улыбок. Выберите режим и нажмите <b>«Начать»</b>.
        </p>

        <div className="tod-mode">
          <span className="tod-mode-label">Режим:</span>
          <button
            className={`tod-chip ${mode === "romantic" ? "active" : ""}`}
            onClick={() => mode !== "romantic" && onToggleMode()}
            aria-pressed={mode === "romantic"}
          >
            💗 Романтика
          </button>
          <button
            className={`tod-chip ${mode === "spicy" ? "active" : ""}`}
            onClick={() => mode !== "spicy" && onToggleMode()}
            aria-pressed={mode === "spicy"}
          >
            🌶 Перчинка
          </button>
        </div>

        <button className="tod-cta" onClick={onStart} aria-label="Начать игру">Начать</button>
      </div>
    </section>
  );
}

function Playground({ mode, current, onPickTruth, onPickDare, onAnother, onDone, onToggleMode }) {
  return (
    <section className="tod-play" aria-label="Правда или Действие — игра">
      <header className="tod-bar">
        <span className="tod-badge">{mode === "romantic" ? "💗 Романтика" : "🌶 Перчинка"}</span>
        <button className="tod-mini" onClick={onToggleMode} aria-label="Сменить режим">Сменить режим</button>
      </header>

      {!current ? (
        <div className="tod-choices">
          <button className="tod-btn truth" onClick={onPickTruth} aria-label="Выбрать Правду">
            <span className="ico" aria-hidden>💬</span>
            <span className="txt">Правда</span>
          </button>
          <button className="tod-btn dare" onClick={onPickDare} aria-label="Выбрать Действие">
            <span className="ico" aria-hidden>🎯</span>
            <span className="txt">Действие</span>
          </button>
        </div>
      ) : (
        <div className="tod-card" role="region" aria-live="polite">
          <div className="tod-card-kind" data-kind={current.kind}>
            {current.kind === "truth" ? "Правда" : "Действие"}
          </div>
          <div className="tod-card-text">{current.text}</div>

          <div className="tod-actions">
            <button className="tod-ghost" onClick={onAnother} aria-label="Другое задание">Другое</button>
            <button className="tod-primary" onClick={onDone} aria-label="Готово, следующее">Готово</button>
          </div>
        </div>
      )}
    </section>
  );
}

/* ================= styles ================= */

function Styles() {
  return (
    <style
      dangerouslySetInnerHTML={{
        __html: `
.tod { min-height: 100%; display:grid; place-items:center; padding: clamp(14px, 3.6vw, 18px); color: var(--text); }

/* Intro */
.tod-intro { width: 100%; max-width: 640px; margin: 0 auto; }
.tod-intro-card {
  background: color-mix(in srgb, var(--surface) 94%, transparent);
  border: 1px solid color-mix(in srgb, var(--text) 12%, transparent);
  border-radius: 18px;
  padding: clamp(14px, 4.5vw, 20px);
  text-align: center;
  box-shadow: 0 10px 30px rgba(0,0,0,.12);
}
.tod-emoji { font-size: clamp(32px, 6vw, 40px); filter: drop-shadow(0 6px 14px rgba(0,0,0,.2)); }
.tod-title { margin: 10px 0 6px; font-size: clamp(20px, 5.4vw, 24px); font-weight: 900; letter-spacing:.2px; }
.tod-sub { margin: 0; color: var(--hint); font-size: clamp(13px, 3.6vw, 14px); }

.tod-mode { display:flex; flex-wrap:wrap; gap: 8px; align-items:center; justify-content:center; margin: 14px 0 16px; }
.tod-mode-label { color: var(--hint); font-size: 13px; margin-right: 2px; }
.tod-chip {
  font-weight: 800; font-size: 13px; padding: 8px 12px; border-radius: 999px;
  background: color-mix(in srgb, var(--surface) 82%, transparent);
  border: 1px solid color-mix(in srgb, var(--text) 12%, transparent);
}
.tod-chip.active {
  background: color-mix(in srgb, rgb(var(--accent-rgb)) 14%, transparent);
  border-color: color-mix(in srgb, rgb(var(--accent-rgb)) 22%, transparent);
}

.tod-cta {
  width: 100%;
  height: clamp(50px, 7.4vh, 56px);
  border-radius: 14px;
  font-weight: 900; letter-spacing:.2px;
  background: var(--btn); color: var(--btn-text);
  border: 1px solid color-mix(in srgb, var(--text) 10%, transparent);
  box-shadow: 0 10px 28px rgba(0,0,0,.18), 0 18px 54px rgba(var(--accent-rgb), .18);
}

/* Play */
.tod-play { width: 100%; max-width: 720px; margin: 0 auto; display:grid; gap: 14px; }
.tod-bar { display:flex; align-items:center; justify-content:space-between; }
.tod-badge {
  font-size: 12px; padding: 6px 10px; border-radius: 999px; font-weight: 800;
  background: color-mix(in srgb, var(--surface) 80%, transparent);
  border: 1px solid color-mix(in srgb, var(--text) 12%, transparent);
}
.tod-mini { font-size: 12px; padding: 6px 10px; border-radius: 10px; color: var(--text);
  background: transparent; border: 1px solid color-mix(in srgb, var(--text) 12%, transparent); }

.tod-choices { display:grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 2px; }
.tod-btn {
  height: clamp(120px, 22vh, 160px);
  border-radius: 18px;
  display:grid; place-items:center; gap: 8px;
  font-weight: 900; letter-spacing:.2px;
  box-shadow: 0 10px 28px rgba(0,0,0,.16);
  border: 1px solid color-mix(in srgb, var(--text) 12%, transparent);
  background: color-mix(in srgb, var(--surface) 96%, transparent);
}
.tod-btn .ico { font-size: clamp(26px, 6vw, 32px); }
.tod-btn .txt { font-size: clamp(16px, 4.6vw, 18px); }
.tod-btn.truth { background: linear-gradient(180deg, color-mix(in srgb, var(--surface) 90%, transparent), color-mix(in srgb, var(--surface) 60%, transparent)); }
.tod-btn.dare { background: linear-gradient(180deg, color-mix(in srgb, var(--surface) 90%, transparent), color-mix(in srgb, var(--surface) 60%, transparent)); }

.tod-card {
  margin-top: 2px;
  background: color-mix(in srgb, var(--surface) 94%, transparent);
  border: 1px solid color-mix(in srgb, var(--text) 12%, transparent);
  border-radius: 18px;
  padding: clamp(14px, 4.2vw, 18px);
  box-shadow: 0 10px 30px rgba(0,0,0,.12);
  display:grid; gap: 12px;
}
.tod-card-kind {
  font-size: 12px; font-weight: 800; letter-spacing:.3px;
  padding: 6px 10px; border-radius: 999px; width:max-content;
  background: color-mix(in srgb, var(--surface) 80%, transparent);
  border: 1px solid color-mix(in srgb, var(--text) 12%, transparent);
}
.tod-card-kind[data-kind="truth"] { color: #60a5fa; }
.tod-card-kind[data-kind="dare"] { color: #f59e0b; }

.tod-card-text { font-size: clamp(16px, 4.8vw, 20px); line-height: 1.35; }

.tod-actions { display:grid; grid-template-columns: 1fr 1.2fr; gap: 10px; }
.tod-ghost {
  height: clamp(48px, 7vh, 54px);
  border-radius: 12px; font-weight: 800;
  background: transparent; color: var(--text);
  border: 1px solid color-mix(in srgb, var(--text) 12%, transparent);
}
.tod-primary {
  height: clamp(48px, 7vh, 54px);
  border-radius: 12px; font-weight: 900; letter-spacing:.2px;
  background: var(--btn); color: var(--btn-text);
  border: 1px solid color-mix(in srgb, var(--text) 10%, transparent);
}

@media (max-width: 380px) {
  .tod-actions { grid-template-columns: 1fr; }
  .tod-choices { grid-template-columns: 1fr; }
}
        `,
      }}
    />
  );
}
