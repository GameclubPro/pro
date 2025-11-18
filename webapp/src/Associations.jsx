import React, { useEffect, useMemo, useRef, useState } from "react";

/**
 * «Скажи иначе» (Alias) — версия без внешних зависимостей.
 * Обновлено по фичам:
 * - темы через CSS-переменные, ActionBar снизу, свайпы, удерживание для показа слова
 * - пульсирующий таймер с цветом на финише
 * - звуки: тики 10–4, бипы 3-2-1, успех/ошибка/пас
 * - streak (серия): опция +1 очко или +5 секунд за 3 подряд
 * - тай-брейк: sudden death 15с при ничьей
 * - grace-окно 1.5с: можно засчитать, если слово было раскрыто в момент нуля
 * - пресеты: Party / Classic / Hardcore (Hardcore — пас отключён)
 */

const DEFAULT_WORDS = [
  // Быт / предметы
  "Телефон","Зонт","Молоко","Автобус","Ключ","Хлеб","Кресло","Река","Снег","Аптека","Лампа","Кошелёк","Рюкзак","Кофе","Стул","Стол",
  "Диван","Окно","Дверь","Ковер","Плита","Холодильник","Чайник","Кастрюля","Тарелка","Вилка","Ложка","Нож","Очки","Зеркало","Щётка",
  // Природа / места
  "Лес","Море","Гора","Пляж","Пустыня","Озеро","Водопад","Пещера","Остров","Поле","Тундра","Джунгли","Саванна",
  // Животные
  "Собака","Кошка","Лев","Тигр","Заяц","Медведь","Дельфин","Акула","Орел","Сова","Жираф","Зебра","Панда","Кит","Черепаха",
  // Путешествия / транспорт
  "Самолёт","Поезд","Метро","Автострада","Паром","Такси","Билет","Аэропорт","Вокзал","Компас","Карта",
  // Технологии / работа
  "Интернет","Пароль","Редактор","Мышь","Клавиатура","Монитор","Сервер","База данных","Робот","Алгоритм","Шифр","Браузер",
  // Наука / абстракции
  "Микроскоп","Гипотеза","Инерция","Периметр","Парадокс","Эволюция","Катализатор","Диффузия","Галактика","Орбита","Термосфера",
  // Культура / досуг
  "Театр","Музей","Фестиваль","Журнал","Роман","Фильм","Пьеса","Картина","Сцена","Аплодисменты",
  // Еда
  "Пицца","Шоколад","Яблоко","Банан","Суп","Сыр","Йогурт","Виноград","Апельсин","Салат",
];

// =============== Стили (темы, кнопки, карточки, ActionBar, разделители) ===============
const STYLE = `
:root{
  --bg:#0b0d12; --surface:#11151b; --text:#e8edf3; --muted:#95a1b3;
  --accent:#22c55e; --warn:#f59e0b; --danger:#ef4444;
  --radius:14px; --gap:12px; --shadow:0 6px 24px rgba(0,0,0,.18);
}
@media (prefers-color-scheme: light){
  :root{ --bg:#f6f8fb; --surface:#ffffff; --text:#0f1720; --muted:#5b677a;
         --accent:#16a34a; --warn:#d97706; --danger:#dc2626; }
}
.section{ color:var(--text); }
body{ background:var(--bg); color:var(--text); font:500 16px/1.5 system-ui,-apple-system,Segoe UI,Roboto,Arial; }
.sectionHeader{ display:flex; align-items:center; justify-content:space-between; gap:10px; padding:0 12px; }
.sectionTitle{ margin:0; font-size:20px; }
.roomMeta{ display:flex; gap:6px; align-items:center; flex-wrap:wrap; }
.roomRow{ display:flex; gap:var(--gap); align-items:center; }
.roomButtons{ display:flex; gap:10px; flex-wrap:wrap; }
.roomCard{ background:color-mix(in srgb, var(--surface) 92%, transparent);
  border:1px solid color-mix(in srgb, var(--text) 10%, transparent);
  border-radius:var(--radius); padding:14px; box-shadow:var(--shadow); }

.input{ width:100%; padding:10px 12px; border-radius:12px; border:1px solid color-mix(in srgb, var(--text) 16%, transparent);
  background:color-mix(in srgb, var(--surface) 96%, transparent); color:var(--text); }
.input:focus{ outline:2px solid color-mix(in srgb, var(--accent) 70%, transparent); outline-offset:2px; }

.btn{ display:inline-flex; align-items:center; justify-content:center; gap:8px;
  padding:12px 16px; border-radius:12px; border:1px solid color-mix(in srgb, var(--text) 10%, transparent);
  background:color-mix(in srgb, var(--surface) 85%, transparent); color:var(--text);
  font-weight:800; cursor:pointer; user-select:none; touch-action:manipulation; transition:transform .08s ease, background .15s ease, border-color .15s ease, opacity .15s ease; }
.btn.tiny{ padding:8px 10px; font-weight:700; }
.btn:hover{ background:color-mix(in srgb, var(--surface) 80%, transparent); }
.btn:active{ transform:translateY(1px); }
.btn:focus-visible{ outline:2px solid color-mix(in srgb, var(--accent) 80%, transparent); outline-offset:2px; }
.btn.primary{ background:var(--accent); color:#07140a; border-color:transparent; }
.btn.primary:hover{ opacity:.95; }
.btn.warn{ background:color-mix(in srgb, var(--danger) 85%, transparent); color:#18090a; border-color:transparent; }
.btn[disabled]{ opacity:.5; cursor:not-allowed; }

.chip{ display:inline-flex; align-items:center; gap:6px; padding:6px 10px; border-radius:999px;
  background:color-mix(in srgb, var(--text) 10%, transparent); font-weight:700; }

.actionBar{
  position:sticky; bottom:0; inset-inline:0; z-index:10;
  backdrop-filter:saturate(1.2) blur(10px);
  background:color-mix(in srgb, var(--surface) 88%, transparent);
  border-top:1px solid color-mix(in srgb, var(--text) 8%, transparent);
  padding:10px 12px; display:grid; grid-template-columns:1fr 1fr 1fr; gap:10px;
}
@media (min-width: 720px){
  .actionBar{ grid-template-columns:repeat(3, 220px); justify-content:center; }
}

.wordCard{ margin-top:12px; padding:16px 14px; border-radius:12px;
  border:1px solid color-mix(in srgb, var(--text) 10%, transparent);
  background:color-mix(in srgb, var(--surface) 85%, transparent); user-select:none; }
.wordText{ font-weight:900; font-size:28px; letter-spacing:.3px; padding:10px 12px; border-radius:10px;
  background:color-mix(in srgb, var(--surface) 95%, transparent);
  border:1px solid color-mix(in srgb, var(--text) 12%, transparent);
  min-height:56px; display:grid; place-items:center; transition:transform 140ms ease, opacity 140ms ease; }

.hint{ color:var(--muted); }

.divider{ height:1px; background:color-mix(in srgb, var(--text) 8%, transparent); margin:12px 0; }

.playerItem{ display:flex; align-items:center; justify-content:space-between; gap:10px; padding:8px 0; border-bottom:1px dashed color-mix(in srgb, var(--text) 8%, transparent); }
.playerItem:last-child{ border-bottom:none; }
.playerDot{ width:10px; height:10px; border-radius:999px; background:color-mix(in srgb, var(--text) 16%, transparent); display:inline-block; }
.playerDot[data-alive="true"]{ background:var(--accent); }

@keyframes pulse { from{opacity:1} to{opacity:.6} }
`;

// =============== Вспомогательные ===============
function shuffle(array) {
  const a = array.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function useTelegramHaptics() {
  const tg = typeof window !== "undefined" ? window?.Telegram?.WebApp : undefined;
  return {
    success: () => { try { tg?.HapticFeedback?.notificationOccurred?.("success"); } catch {} },
    light:   () => { try { tg?.HapticFeedback?.impactOccurred?.("light"); } catch {} },
    medium:  () => { try { tg?.HapticFeedback?.impactOccurred?.("medium"); } catch {} },
    select:  () => { try { tg?.HapticFeedback?.selectionChanged?.(); } catch {} },
  };
}

// ====== WebAudio эффекты: тики/бипы/успех/ошибка/пас + вибро-фолбэк ======
function useFX() {
  const ctxRef = useRef(null);
  const unlockedRef = useRef(false);

  const ensureCtx = () => {
    if (!ctxRef.current) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) ctxRef.current = new AC();
    }
    return ctxRef.current;
  };

  // на первый пользовательский тап — разблокировать
  const unlock = () => {
    const ctx = ensureCtx();
    if (!ctx || unlockedRef.current) return;
    try {
      const g = ctx.createGain(); g.gain.value = 0; g.connect(ctx.destination);
      const o = ctx.createOscillator(); o.connect(g); o.start(); o.stop(ctx.currentTime + 0.01);
      unlockedRef.current = true;
    } catch {}
  };

  const beep = (freq = 880, dur = 0.07, vol = 0.02, type = "sine") => {
    const ctx = ensureCtx(); if (!ctx) return;
    const o = ctx.createOscillator(); const g = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, ctx.currentTime);
    g.gain.setValueAtTime(vol, ctx.currentTime);
    o.connect(g); g.connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + dur);
  };

  const tick = () => beep(700, 0.05, 0.02, "square");
  const countdown = () => beep(1200, 0.08, 0.03, "square");
  const ok = () => beep(1100, 0.09, 0.035, "triangle");
  const err = () => beep(300, 0.12, 0.04, "sawtooth");
  const pass = () => beep(500, 0.06, 0.025, "triangle");

  const vibrate = (pattern) => { try { navigator?.vibrate?.(pattern); } catch {} };

  return { unlock, tick, countdown, ok, err, pass, vibrate };
}

// =============== Таймер с цветом и «пульсом» в конце ===============
function TimeBar({ total, left }) {
  const pct = Math.max(0, Math.min(100, (left / total) * 100));
  const danger = left <= Math.max(5, Math.ceil(total * 0.15));
  return (
    <div aria-label="Полоса времени" style={{
      height: 12, width: "100%",
      background: "color-mix(in srgb, var(--text) 12%, transparent)",
      borderRadius: 999, overflow: "hidden",
    }}>
      <div style={{
        height: "100%",
        width: `${pct}%`,
        transition: "width 180ms ease",
        background: danger
          ? "linear-gradient(90deg, var(--danger), var(--warn))"
          : "linear-gradient(90deg, var(--accent), color-mix(in srgb, var(--accent) 60%, transparent))",
        animation: danger ? "pulse 800ms infinite alternate" : "none",
      }} />
    </div>
  );
}

// =============== Свайпы (← пас / → отгадано) ===============
function useSwipe(onLeft, onRight, threshold = 40) {
  const start = useRef({ x: 0, y: 0 });
  return {
    onTouchStart: (e) => {
      const t = e.touches[0];
      start.current = { x: t.clientX, y: t.clientY };
    },
    onTouchEnd: (e) => {
      const t = e.changedTouches[0];
      const dx = t.clientX - start.current.x;
      const dy = t.clientY - start.current.y;
      if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > threshold) (dx > 0 ? onRight : onLeft)();
    }
  };
}

// =============== Карточка слова: удерживать, чтобы показать ===============
function WordCard({ word, revealed, setRevealed, onGuess, onPass, passDisabled }) {
  const holdTimer = useRef(null);
  const swipeBind = useSwipe(
    () => { if (!passDisabled) onPass(); },
    () => onGuess()
  );

  const pressStart = () => {
    clearTimeout(holdTimer.current);
    holdTimer.current = setTimeout(() => setRevealed(true), 120); // peek
  };
  const pressEnd = () => {
    clearTimeout(holdTimer.current);
    holdTimer.current = null;
    setRevealed(false);
  };

  return (
    <div
      className="wordCard"
      {...swipeBind}
      onMouseDown={pressStart} onMouseUp={pressEnd} onMouseLeave={pressEnd}
      onTouchStart={pressStart} onTouchEnd={pressEnd}
      aria-label="Слово (удерживайте, чтобы показать; свайп ← Пас / → Отгадано)"
    >
      <div className="hint" style={{ fontSize: 12, marginBottom: 8 }}>
        УДЕРЖИВАЙТЕ, чтобы показать слово • Свайп: ← Пас / → Отгадано
      </div>
      <div
        className="wordText"
        style={{ transform: revealed ? "scale(1)" : "scale(.98)", opacity: revealed ? 1 : .2 }}
        aria-live="polite"
      >
        {revealed ? word : "•••••••"}
      </div>
    </div>
  );
}

// ============================ ГЛАВНЫЙ КОМПОНЕНТ ============================
export default function Associations({ goBack }) {
  const haptics = useTelegramHaptics();
  const fx = useFX();

  // -------- Настройки
  const [roundSeconds, setRoundSeconds] = useState(60);
  const [targetScore, setTargetScore] = useState(30);
  const [passPenalty, setPassPenalty] = useState(-1);
  const [forbidPass, setForbidPass] = useState(false);
  const [useCustomWords, setUseCustomWords] = useState(false);
  const [customWordsRaw, setCustomWordsRaw] = useState("");

  // Streak options
  const [streakEnabled, setStreakEnabled] = useState(true);
  const [streakMode, setStreakMode] = useState("time"); // "time" | "score"
  const STREAK_THRESHOLD = 3;
  const STREAK_TIME_BONUS = 5; // секунд

  // Grace
  const GRACE_MS = 1500;
  const graceDeadlineRef = useRef(0);
  const revealedAtZeroRef = useRef(false);

  // Команды
  const [teams, setTeams] = useState([
    { name: "Красные", score: 0 },
    { name: "Синие",   score: 0 },
  ]);
  const [activeTeam, setActiveTeam] = useState(0);
  const teamsRef = useRef(teams);
  useEffect(() => { teamsRef.current = teams; }, [teams]);

  // Игра
  const [phase, setPhase] = useState("setup"); // setup | round | between | result | tiebreak
  const [deck, setDeck] = useState([]);
  const [discard, setDiscard] = useState([]);
  const [current, setCurrent] = useState(null);
  const [revealed, setRevealed] = useState(false);
  const [streak, setStreak] = useState(0);

  // Таймер
  const [left, setLeft] = useState(roundSeconds);
  const [running, setRunning] = useState(false);
  const tickRef = useRef(null);
  const endAtRef = useRef(null);

  // Лог текущего раунда
  const [log, setLog] = useState([]); // { word, kind: 'guess'|'pass'|'violation' }

  // Подготовка слов
  const words = useMemo(() => {
    if (!useCustomWords) return DEFAULT_WORDS;
    const lines = customWordsRaw.split(/[\,\n;]+/).map((s) => s.trim()).filter(Boolean);
    return lines.length ? lines : DEFAULT_WORDS;
  }, [useCustomWords, customWordsRaw]);

  // Взять следующее слово
  const draw = () => {
    setDeck((prevDeck) => {
      let d = prevDeck;
      let needClearDiscard = false;
      if (d.length === 0) { d = shuffle(discard); needClearDiscard = true; }
      if (d.length === 0) { d = shuffle(words); }
      const [head, ...rest] = d;
      setCurrent(head ?? null);
      if (needClearDiscard) setDiscard([]);
      return rest;
    });
  };

  // ======= Таймер с компенсацией дрейфа + звуки + grace
  const stopTimer = () => {
    setRunning(false);
    if (tickRef.current) clearInterval(tickRef.current);
    tickRef.current = null;
    endAtRef.current = null;
  };

  const startTimer = (seconds) => {
    fx.unlock(); // разблокировать аудио после первого клика
    const dur = typeof seconds === "number" ? seconds : left;
    const endAt = Date.now() + dur * 1000;
    endAtRef.current = endAt;
    setLeft(dur);
    setRunning(true);
    if (tickRef.current) clearInterval(tickRef.current);
    const prevLeft = { v: dur };

    tickRef.current = setInterval(() => {
      const now = Date.now();
      const s = Math.max(0, Math.round((endAtRef.current - now) / 1000));
      setLeft(s);

      // тики 10–4 c, бипы 3–1
      if (s < prevLeft.v) {
        if (s <= 3 && s > 0) { fx.countdown(); haptics.select(); }
        else if (s <= 10 && s >= 4) { fx.tick(); }
      }
      prevLeft.v = s;

      if (s <= 0) {
        // запомним, было ли слово раскрыто (значит объяснение уже начато)
        revealedAtZeroRef.current = revealed;
        // ставим дедлайн grace-окна
        graceDeadlineRef.current = revealed ? now + GRACE_MS : 0;
        stopTimer();
        // тай-брейк или обычная пауза — проверим ниже в useEffect по phase/teams
        setPhase("between");
        haptics.success();
      }
    }, 200);
  };

  // При смене длительности — обновляем left во время раунда
  useEffect(() => {
    if (phase === "round" || phase === "tiebreak") setLeft(roundSeconds);
  }, [roundSeconds, phase]);

  // ======= Пресеты
  const applyPreset = (kind) => {
    if (kind === "Party") {
      setRoundSeconds(45); setPassPenalty(0); setForbidPass(false);
      setStreakEnabled(true); setStreakMode("time");
    }
    if (kind === "Classic") {
      setRoundSeconds(60); setPassPenalty(-1); setForbidPass(false);
      setStreakEnabled(true); setStreakMode("score");
    }
    if (kind === "Hardcore") {
      setRoundSeconds(45); setPassPenalty(-1); setForbidPass(true);
      setStreakEnabled(true); setStreakMode("time");
    }
    haptics.select();
  };

  // Старт игры
  const startGame = () => {
    setTeams((ts) => ts.map((t) => ({ ...t, score: 0 })));
    setActiveTeam(0);
    setDeck(shuffle(words));
    setDiscard([]);
    setLog([]);
    setRevealed(false);
    setStreak(0);
    setPhase("round");
    setLeft(roundSeconds);
    draw();
    startTimer(roundSeconds);
    haptics.success();
  };

  // Следующий раунд — смена команды
  const nextRound = () => {
    setActiveTeam((i) => (i === 0 ? 1 : 0));
    setLog([]);
    setRevealed(false);
    setStreak(0);
    const isTiebreak = phase === "tiebreak";
    const dur = isTiebreak ? 15 : roundSeconds;
    setPhase(isTiebreak ? "tiebreak" : "round");
    setLeft(dur);
    draw();
    startTimer(dur);
  };

  // Проверка ничьей и переход в тай-брейк после остановки таймера
  useEffect(() => {
    if (phase !== "between") return;
    const [a, b] = teamsRef.current.map(t => t.score);
    const atOrAbove = a >= targetScore || b >= targetScore;
    if (atOrAbove && a === b) {
      // sudden death — короткие раунды до развилки
      setPhase("tiebreak");
      setLeft(15);
      startTimer(15);
    }
  }, [phase, targetScore]);

  // Модификация счёта с проверкой победы (учитываем ничью -> тай-брейк)
  const addScore = (teamIndex, delta) => {
    setTeams((ts) => {
      const next = ts.map((t, i) =>
        i === teamIndex ? { ...t, score: Math.max(0, t.score + delta) } : t
      );
      const [a, b] = next.map(t => t.score);
      const anyReached = a >= targetScore || b >= targetScore;

      if (anyReached) {
        if (a === b) {
          // не завершаем прямо сейчас — sudden death в useEffect при between
          // но если мы ещё в раунде — дадим доиграть и проверим по окончании таймера
        } else {
          stopTimer();
          setPhase("result");
        }
      }
      return next;
    });
  };

  // ======= Действия + streak
  const handleStreakReward = () => {
    if (!streakEnabled) return;
    if (streak + 1 >= STREAK_THRESHOLD) {
      if (streakMode === "score") {
        addScore(activeTeam, +1);
      } else {
        // бонус времени
        if (endAtRef.current && running) {
          endAtRef.current += STREAK_TIME_BONUS * 1000;
        }
      }
      setStreak(0);
    } else {
      setStreak((s) => s + 1);
    }
  };

  const onGuess = () => {
    // Разрешить в grace-окно, если слово было раскрыто в момент нуля
    const now = Date.now();
    const inGrace = phase === "between" && graceDeadlineRef.current && now <= graceDeadlineRef.current;
    const canAccept = phase === "round" || phase === "tiebreak" || inGrace;
    if (!canAccept || !current) return;

    setLog((l) => [...l, { word: current, kind: "guess" }]);
    addScore(activeTeam, +1);
    setDiscard((d) => [current, ...d]);
    draw();
    fx.ok(); haptics.medium();
    handleStreakReward();
  };

  const onPass = () => {
    if (forbidPass) { fx.err(); haptics.light(); return; }
    if (phase !== "round" && phase !== "tiebreak") return;
    if (!current) return;
    setLog((l) => [...l, { word: current, kind: "pass" }]);
    if (passPenalty !== 0) addScore(activeTeam, passPenalty);
    setDiscard((d) => [current, ...d]);
    setStreak(0);
    draw();
    fx.pass(); haptics.light();
  };

  const onViolation = () => {
    if (phase !== "round" && phase !== "tiebreak") return;
    if (!current) return;
    setLog((l) => [...l, { word: current, kind: "violation" }]);
    addScore(activeTeam, -1);
    setDiscard((d) => [current, ...d]);
    setStreak(0);
    draw();
    fx.err(); haptics.light();
  };

  // Хоткеи
  useEffect(() => {
    const onKey = (e) => {
      const k = e.key.toLowerCase();
      if (k === " ") {
        e.preventDefault();
        running ? stopTimer() : startTimer();
        haptics.select();
      }
      if (phase === "round" || phase === "tiebreak") {
        if (k === "g") onGuess();
        if (k === "p") onPass();
        if (k === "v") onViolation();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase, running, current, passPenalty, activeTeam, forbidPass, streakEnabled, streakMode]);

  // Очистка таймера при размонтировании
  useEffect(() => () => stopTimer(), []);

  // Каркас
  const wrap = { maxWidth: 880, margin: "0 auto", padding: "12px 12px 90px" };
  const appbar = {
    position: "sticky", top: 0, zIndex: 5, backdropFilter: "saturate(1.2) blur(10px)",
    background: "color-mix(in srgb, var(--surface) 75%, transparent)",
    borderBottom: "1px solid color-mix(in srgb, var(--text) 8%, transparent)",
    padding: "10px 0",
  };
  const card = {
    border: "1px solid color-mix(in srgb, var(--text) 10%, transparent)",
    background: "color-mix(in srgb, var(--surface) 92%, transparent)",
    borderRadius: 14,
    padding: 14,
    boxShadow: "0 6px 24px rgba(0,0,0,.18)"
  };

  // Сводка раунда
  const guessCount = log.filter(e => e.kind === "guess").length;
  const passCount = log.filter(e => e.kind === "pass").length;
  const violCount = log.filter(e => e.kind === "violation").length;

  const isTiebreak = phase === "tiebreak";

  return (
    <section className="section" aria-label="Скажи иначе (Alias)">
      <style>{STYLE}</style>

      {/* APP BAR */}
      <div style={appbar}>
        <div className="sectionHeader" style={{ margin: 0 }}>
          {goBack && (
            <button className="btn back" onClick={goBack} aria-label="Назад">
              ← Назад
            </button>
          )}
          <h2 className="sectionTitle" style={{ display: "flex", alignItems: "center", gap: 8 }}>
            Скажи иначе <span className="chip" title="Alias">{isTiebreak ? "Sudden Death" : "Alias"}</span>
          </h2>
          <div className="roomMeta">
            <span className="chip" title="Цель">🎯 {targetScore}</span>
            <span className="chip" title="Таймер">⏱️ {isTiebreak ? 15 : roundSeconds}s</span>
          </div>
        </div>
      </div>

      <div style={wrap}>
        {/* SETUP */}
        {phase === "setup" && (
          <div className="roomCard" style={card} role="group" aria-label="Настройки игры">
            <p className="hint" style={{ marginTop: 0 }}>
              Объясняйте слова напарнику <b>без однокоренных</b>. Выберите пресет или настроить вручную.
            </p>

            {/* Пресеты */}
            <div className="roomButtons" style={{ marginTop: 6 }}>
              <button className="btn" onClick={() => applyPreset("Party")}>🎉 Party (45с, без штрафа)</button>
              <button className="btn" onClick={() => applyPreset("Classic")}>🎲 Classic (60с, −1)</button>
              <button className="btn warn" onClick={() => applyPreset("Hardcore")}>🔥 Hardcore (45с, −1, без пасов)</button>
            </div>

            <div className="divider" />

            {/* Команды */}
            <div className="roomRow" style={{ gap: 8, alignItems: "stretch" }}>
              <div style={{ flex: 1 }}>
                <div className="roomCodeLabel">Команда A</div>
                <input
                  className="input"
                  value={teams[0].name}
                  onChange={(e) => setTeams((t) => [{ ...t[0], name: e.target.value }, t[1]])}
                  aria-label="Название команды A"
                />
              </div>
              <div style={{ flex: 1 }}>
                <div className="roomCodeLabel">Команда B</div>
                <input
                  className="input"
                  value={teams[1].name}
                  onChange={(e) => setTeams((t) => [t[0], { ...t[1], name: e.target.value }])}
                  aria-label="Название команды B"
                />
              </div>
            </div>

            {/* Настройки раунда */}
            <div style={{ display: "grid", gap: 12, marginTop: 12 }}>
              <div className="chip" style={{ width: "fit-content" }}>
                Длительность раунда: {roundSeconds} сек
              </div>
              <input
                type="range" min={30} max={120} step={5}
                value={roundSeconds}
                onChange={(e) => setRoundSeconds(Number(e.target.value))}
                aria-label="Длительность раунда"
              />

              <div className="chip" style={{ width: "fit-content" }}>
                Целевой счёт: {targetScore}
              </div>
              <input
                type="range" min={10} max={60} step={5}
                value={targetScore}
                onChange={(e) => setTargetScore(Number(e.target.value))}
                aria-label="Целевой счёт"
              />

              <div className="roomRow" style={{ gap: 8, flexWrap: "wrap" }}>
                <label className="chip" htmlFor="passPenalty">
                  Пас: {passPenalty === 0 ? "без штрафа" : "−1 очко"}
                </label>
                <select
                  id="passPenalty"
                  className="input"
                  style={{ maxWidth: 180 }}
                  value={passPenalty}
                  onChange={(e) => setPassPenalty(Number(e.target.value))}
                  aria-label="Штраф за пас"
                >
                  <option value={0}>Без штрафа</option>
                  <option value={-1}>−1 очко</option>
                </select>

                <label className="chip" style={{ gap: 8 }}>
                  <input type="checkbox" checked={forbidPass} onChange={(e) => setForbidPass(e.target.checked)} />
                  Запретить пас
                </label>
              </div>

              {/* Streak */}
              <div className="roomRow" style={{ gap: 8, flexWrap:"wrap" }}>
                <label className="chip" style={{ gap: 8 }}>
                  <input type="checkbox" checked={streakEnabled} onChange={(e) => setStreakEnabled(e.target.checked)} />
                  Серия (3 подряд)
                </label>
                <select
                  className="input"
                  style={{ maxWidth: 220 }}
                  value={streakMode}
                  onChange={(e) => setStreakMode(e.target.value)}
                  aria-label="Награда за серию"
                >
                  <option value="time">Бонус времени +5с</option>
                  <option value="score">Бонус очко +1</option>
                </select>
              </div>

              <details style={{ marginTop: 6 }}>
                <summary className="chip">Собственная колода (опционально)</summary>
                <label className="hint" style={{ display: "block", margin: "6px 0" }}>
                  По одному слову в строке или разделяйте запятыми/точкой с запятой.
                </label>
                <textarea
                  className="input" rows={5}
                  value={customWordsRaw}
                  onChange={(e) => setCustomWordsRaw(e.target.value)}
                  placeholder="яблоко, телефон, музей, ..."
                  aria-label="Пользовательская колода"
                />
                <div style={{ marginTop: 6 }}>
                  <label style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                    <input
                      type="checkbox"
                      checked={useCustomWords}
                      onChange={(e) => setUseCustomWords(e.target.checked)}
                    />
                    Использовать пользовательские слова
                  </label>
                </div>
              </details>

              <div className="roomButtons" style={{ marginTop: 4 }}>
                <button className="btn primary" onClick={startGame} aria-label="Начать игру">
                  ▶️ Начать
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ROUND / TIEBREAK */}
        {(phase === "round" || phase === "tiebreak") && (
          <>
            <div className="roomCard" style={card} role="group" aria-label={isTiebreak ? "Тай-брейк" : "Раунд"}>
              <div className="roomRow" style={{ justifyContent: "space-between" }}>
                <div>
                  <div className="roomCodeLabel">{isTiebreak ? "Sudden Death" : "Идёт раунд"}</div>
                  <div className="roomCode">
                    {teams[activeTeam].name} • очки: {teams[activeTeam].score}
                  </div>
                </div>
                <div className="roomActions" style={{ display: "grid", gap: 6, textAlign: "right" }}>
                  <div className="chip" aria-live="polite">Осталось: {left} c</div>
                  <div>
                    <button
                      className="btn tiny"
                      onClick={() => { running ? stopTimer() : startTimer(); fx.unlock(); haptics.select(); }}
                      aria-label={running ? "Пауза" : "Продолжить"}
                      aria-pressed={running}
                    >
                      {running ? "⏸️ Пауза" : "▶️ Старт"}
                    </button>
                  </div>
                </div>
              </div>

              <TimeBar total={isTiebreak ? 15 : roundSeconds} left={left} />

              {/* Карточка слова: удерживание + свайпы */}
              <WordCard
                word={current}
                revealed={revealed}
                setRevealed={setRevealed}
                onGuess={onGuess}
                onPass={onPass}
                passDisabled={forbidPass}
              />

              <div className="divider" />

              {/* Компактная сводка раунда */}
              <div className="roomMeta" aria-label="Сводка раунда" style={{ gap: 10 }}>
                <span className="chip" title="Отгадано">✅ {guessCount}</span>
                <span className="chip" title="Пас">⏭️ {passCount}</span>
                <span className="chip" title="Нарушения">🚫 {violCount}</span>
                {streakEnabled && (
                  <span className="chip" title="Серия">🔥 {streak}/{STREAK_THRESHOLD}</span>
                )}
              </div>

              {/* События раунда */}
              {log.length > 0 && (
                <div style={{ marginTop: 8 }}>
                  <div style={{ display: "grid", gap: 6 }}>
                    {log.map((e, i) => (
                      <div key={i} className="playerItem" role="listitem">
                        <span className="playerDot" data-alive={e.kind === "guess"} />
                        <div style={{ flex: 1 }}>
                          <div className="playerName" style={{ fontWeight: 700 }}>{e.word}</div>
                          <div className="playerRole hint" style={{ fontSize: 13 }}>
                            {e.kind === "guess" && "Отгадано +1"}
                            {e.kind === "pass" && (passPenalty !== 0 ? "Пас −1" : "Пас 0")}
                            {e.kind === "violation" && "Нарушение −1"}
                          </div>
                        </div>
                        <div style={{ fontWeight: 800 }}>
                          {e.kind === "guess" ? "✅" : e.kind === "pass" ? "⏭️" : "🚫"}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="hint" style={{ marginTop: 10, fontSize: 12 }}>
                Шорткаты: Space — старт/пауза · G — отгадано · P — пас · V — нарушение.
                На телефоне: удерживайте слово, чтобы увидеть; свайп ← Пас / → Отгадано.
              </div>
            </div>

            {/* ActionBar снизу */}
            <div className="actionBar" role="toolbar" aria-label="Действия">
              <button className="btn" onClick={onPass} aria-label="Пас" disabled={forbidPass}>
                ⏭️ Пас{passPenalty !== 0 ? " (−1)" : ""}{forbidPass ? " ⛔" : ""}
              </button>
              <button className="btn primary" onClick={onGuess} aria-label="Отгадано">
                ✅ Отгадано
              </button>
              <button className="btn warn" onClick={onViolation} aria-label="Нарушение">
                🚫 Нарушение
              </button>
            </div>
          </>
        )}

        {/* BETWEEN (перерыв) */}
        {phase === "between" && (
          <div className="roomCard" style={card} role="group" aria-label="Перерыв между раундами">
            <h3 style={{ marginTop: 0 }}>Время!</h3>
            <div className="roomMeta">
              <span className="chip">{teams[0].name}: {teams[0].score}</span>
              <span className="chip">{teams[1].name}: {teams[1].score}</span>
            </div>
            <div className="divider" />
            <div style={{ display: "grid", gap: 8 }}>
              <div className="roomMeta" style={{ gap: 10 }}>
                <span className="chip">✅ {guessCount}</span>
                <span className="chip">⏭️ {passCount}</span>
                <span className="chip">🚫 {violCount}</span>
              </div>
              {log.length === 0 ? (
                <div className="hint">Без событий</div>
              ) : (
                <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.6 }}>
                  {log.map((e, i) => (
                    <li key={i}>
                      <b>{e.word}</b>: {e.kind === "guess" ? "+1" : e.kind === "pass" ? (passPenalty || 0) : "−1"}
                    </li>
                  ))}
                </ul>
              )}
              <div className="roomButtons" style={{ marginTop: 8 }}>
                <button className="btn primary" onClick={nextRound} aria-label="Следующая команда">
                  ⤴️ Следующий раунд { /* в тай-брейке — тоже просто смена команды */ }
                </button>
                <button className="btn" onClick={() => { setPhase("setup"); stopTimer(); }} aria-label="В меню">
                  ⏹️ В меню
                </button>
              </div>
              {graceDeadlineRef.current > Date.now() && (
                <div className="hint" style={{ fontSize: 12 }}>
                  Grace-окно активно: можно засчитать последнее слово, если оно уже объяснялось.
                </div>
              )}
            </div>
          </div>
        )}

        {/* RESULT */}
        {phase === "result" && (
          <div className="roomCard" style={card} role="group" aria-label="Итоги матча">
            <h3 style={{ marginTop: 0 }}>Победа!</h3>
            <div className="roomMeta">
              <span className="chip">{teams[0].name}: {teams[0].score}</span>
              <span className="chip">{teams[1].name}: {teams[1].score}</span>
            </div>
            <p className="hint" style={{ marginTop: 10 }}>
              Хотите сыграть ещё раз или поменять настройки?
            </p>
            <div className="roomButtons" style={{ marginTop: 8 }}>
              <button className="btn primary" onClick={() => setPhase("setup")} aria-label="Сыграть ещё">
                🔁 Сыграть ещё
              </button>
              {goBack && (
                <button className="btn" onClick={goBack} aria-label="В меню">
                  ⤴️ В меню
                </button>
              )}
            </div>
          </div>
        )}

        {/* Общий счёт */}
        <div className="roomCard" style={{ ...card, marginTop: 12 }} aria-label="Счёт">
          <div className="roomRow" style={{ justifyContent: "space-between" }}>
            <div>
              <div className="roomCodeLabel">Счёт</div>
              <div className="roomCode">
                {teams[0].name}: {teams[0].score} • {teams[1].name}: {teams[1].score}
              </div>
            </div>
            {phase !== "setup" && (
              <div className="roomActions" style={{ display: "flex", gap: 8 }}>
                <button
                  className="btn tiny"
                  onClick={() => { stopTimer(); setPhase("setup"); }}
                  aria-label="Завершить матч"
                >
                  ⏹️ Завершить
                </button>
                <button
                  className="btn tiny"
                  onClick={() => {
                    setTeams((ts) => ts.map((t) => ({ ...t, score: 0 })));
                    setActiveTeam(0);
                  }}
                  aria-label="Сбросить счёт"
                >
                  🔄 Сбросить счёт
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
