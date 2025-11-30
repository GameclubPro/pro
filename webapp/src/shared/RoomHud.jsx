import { memo, useEffect, useMemo, useRef, useState } from "react";

/**
 * Shared HUD for room-based games (Mafia / Auction).
 * Keeps the original Mafia styling (mf-hud) and optional controls.
 */
export function HUD({
  code,
  isOwner,
  phase,
  phaseLabel,
  dayNumber,
  timer,
  onCopy,
  onShare,
  onRefresh,
  onLeave,
  canStart, // unused in HUD, retained for API compatibility
  onStart, // unused in HUD, retained for API compatibility
  endedLabel,
  iAmReady,
  onToggleReady,
  children,
}) {
  const prevPhaseRef = useRef(phase);
  const [justStarted, setJustStarted] = useState(false);
  const isLobby = String(phase || "").toUpperCase() === "LOBBY";

  useEffect(() => {
    const prev = prevPhaseRef.current;
    if (prev === "LOBBY" && !isLobby) {
      setJustStarted(true);
      const t = setTimeout(() => setJustStarted(false), 1200);
      prevPhaseRef.current = phase;
      return () => clearTimeout(t);
    }
    prevPhaseRef.current = phase;
  }, [phase, isLobby]);

  const showCopy = typeof onCopy === "function";
  const showShare = typeof onShare === "function";
  const showRefresh = typeof onRefresh === "function";
  const showLeave = typeof onLeave === "function";

  return (
    <section
      className={`mf-hud ${!isLobby ? "started" : "lobby"} ${
        justStarted ? "just-started" : ""
      }`}
      aria-label={`Состояние: ${phaseLabel || labelByKey(phase)}`}
    >
      {isLobby && (
        <div className="mf-hud-row">
          <div className="mf-code" role="group" aria-label="Код комнаты">
            <span className="mf-code-label">код</span>
            <span className="mf-code-value" dir="ltr">
              {code || "—"}
            </span>
            {showCopy && (
              <button
                className="mf-chip ghost"
                onClick={onCopy}
                aria-label="Скопировать код"
                type="button"
                title="Скопировать код"
              >
                📄
              </button>
            )}
            {showShare && (
              <button
                className="mf-chip ghost"
                onClick={onShare}
                aria-label="Поделиться"
                type="button"
                title="Поделиться"
              >
                ✈️
              </button>
            )}
          </div>

          {(showRefresh || showLeave) && (
            <div className="mf-hud-actions" role="group" aria-label="Действия">
              {showRefresh && (
                <button
                  className="mf-chip ghost"
                  onClick={onRefresh}
                  aria-label="Обновить"
                  type="button"
                  title="Обновить"
                >
                  ⟳
                </button>
              )}
              {showLeave && (
                <button
                  className="mf-chip danger"
                  onClick={onLeave}
                  aria-label="Выйти"
                  type="button"
                  title="Выйти"
                >
                  ⏏
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {children}

      {!isLobby &&
        (String(phase).toUpperCase() === "ENDED" ? (
          <FinalBanner label={endedLabel || timer?.winner || "Игра завершена"} />
        ) : (
          <GameStage
            phase={phase}
            dayNumber={dayNumber}
            timer={timer}
            animate={justStarted}
          />
        ))}

      {!isLobby && (
        <div className="mf-hud-hint" role="note">
          {phase === "NIGHT" && "Ночь: действуйте выборочно и по очереди"}
          {phase === "DAY" && "День: обсуждение и поиск мафии"}
          {phase === "VOTE" && "Голосование: выберите игрока, которого нужно изгнать"}
        </div>
      )}
    </section>
  );
}

export function Chip({ text, tone }) {
  return <span className={`mf-chip ${tone || ""}`}>{text}</span>;
}

export const TimerHUD = memo(function TimerHUD({ timer, className = "" }) {
  const endsAtMs = toMs(timer?.endsAt) || 0;
  const serverAtMs = toMs(timer?.serverTime) || 0;
  const animKey = endsAtMs;
  const skewRef = useRef(0);

  useEffect(() => {
    skewRef.current = serverAtMs ? Date.now() - serverAtMs : 0;
  }, [animKey, serverAtMs]);

  const initialLeft = useMemo(() => {
    if (!endsAtMs) return 0;
    const nowAligned = Date.now() - skewRef.current;
    return Math.max(0, endsAtMs - nowAligned);
  }, [animKey, endsAtMs]);

  const [, setTick] = useState(0);
  useEffect(() => {
    if (!endsAtMs) return;
    const id = setInterval(() => setTick((t) => (t + 1) & 1023), 1000);
    return () => clearInterval(id);
  }, [animKey, endsAtMs]);

  const msLeft = Math.max(0, endsAtMs - (Date.now() - (skewRef.current || 0)));
  const leftText = fmtMs(msLeft);
  const critical = msLeft <= 5000;
  const cls = ["mf-timer", critical ? "critical" : "", className].filter(Boolean).join(" ");

  return (
    <div
      className={cls}
      role="timer"
      aria-live="polite"
      aria-atomic="true"
      aria-label={`Осталось времени: ${leftText}`}
    >
      <span className="mf-timer-icon" aria-hidden="true">
        ⏳
      </span>
      <span className="mf-timer-text">{leftText}</span>
      <div className="mf-timer-bar" aria-hidden="true">
        <i style={{ "--msLeft": `${initialLeft}ms` }} />
      </div>
    </div>
  );
});

export function GameStage({ phase, dayNumber, timer, animate = false }) {
  const ph = String(phase || "").toUpperCase();
  const stage = [
    { key: "NIGHT", label: "Ночь", icon: "🌘" },
    { key: "DAY", label: "День", icon: "☀️" },
    { key: "VOTE", label: "Голос", icon: "⚖️" },
  ];

  return (
    <div
      className={`mf-gamestage${animate ? " animate" : ""}`}
      role="group"
      aria-label="Этап игры"
    >
      <div className="mf-gs-tiles">
        {stage.map((s) => {
          const active = ph === s.key;
          return (
            <div
              key={s.key}
              className={`mf-gs-pill ${active ? "active" : "idle"}`}
              aria-current={active ? "true" : undefined}
              aria-label={`${s.label}${active ? " (текущая фаза)" : ""}`}
            >
              <span className="ico" aria-hidden="true">
                {s.icon}
              </span>
              <span className="txt">{s.label}</span>
            </div>
          );
        })}
      </div>

      <div className="mf-gs-bottom">
        {timer ? (
          <TimerHUD timer={timer} className="mf-gs-timer-card" />
        ) : (
          <div className="mf-timer mf-gs-timer-card skeleton" aria-hidden="true">
            <span className="mf-timer-icon">⏳</span>
            <span className="mf-timer-text">—</span>
            <div className="mf-timer-bar">
              <i />
            </div>
          </div>
        )}

        <div className="mf-gs-daycard" aria-label="День игры">
          <div className="label">День</div>
          <div className="val">{dayNumber != null ? dayNumber : 1}</div>
        </div>
      </div>
    </div>
  );
}

export function FinalBanner({ label }) {
  const txt = String(label || "").trim();
  const winMafia = /мафия/i.test(txt);
  return (
    <div
      className={`mf-final-banner ${winMafia ? "win-mafia" : "win-city"}`}
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      <div className="txt">{txt || "Игра завершена"}</div>
      <div className="sub">Спасибо за игру!</div>
    </div>
  );
}

function labelByKey(r) {
  switch (String(r || "").toUpperCase()) {
    case "MAFIA":
      return "мафия";
    case "DON":
      return "дон";
    case "DOCTOR":
      return "доктор";
    case "SHERIFF":
      return "шериф";
    case "BODYGUARD":
      return "телохранитель";
    case "PROSTITUTE":
      return "проститутка";
    case "JOURNALIST":
      return "журналист";
    case "SNIPER":
      return "снайпер";
    case "CIVIL":
      return "мирный";
    case "NIGHT":
      return "ночь";
    case "DAY":
      return "день";
    case "VOTE":
      return "голосование";
    case "LOBBY":
      return "лобби";
    case "ENDED":
      return "конец игры";
    default:
      return "";
  }
}

function toMs(v) {
  return typeof v === "number" ? v : v ? new Date(v).getTime() : 0;
}
function fmtMs(ms) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

export default HUD;
