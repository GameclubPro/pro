import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import Confetti from "react-canvas-confetti";
import {
  Activity,
  BookOpen,
  Check,
  Clock3,
  Flame,
  GaugeCircle,
  History as HistoryIcon,
  Info,
  LayoutGrid,
  Pause,
  PartyPopper,
  Play,
  Plus,
  RefreshCw,
  SkipForward,
  Settings2,
  Sparkles,
  Target,
  Trash2,
  Trophy,
  Users,
  Wand2,
} from "lucide-react";
import "./crocodile.css";

const STORAGE_KEYS = {
  settings: "pt_crocodile_settings_v2",
  roster: "pt_crocodile_roster_v2",
  custom: "pt_crocodile_custom_v2",
};

const DEFAULT_SETTINGS = {
  mode: "teams",
  difficulty: "mixed",
  roundSeconds: 60,
  targetScore: 12,
  hints: true,
};

const PALETTE = ["#1dd1a1", "#7c3aed", "#f59e0b", "#ef4444", "#06b6d4", "#f472b6"];

const DEFAULT_ROSTER = [
  { id: "team-lime", name: "Лайм", emoji: "🦎", color: PALETTE[0], score: 0 },
  { id: "team-flame", name: "Огонь", emoji: "🔥", color: PALETTE[3], score: 0 },
];

const TIPS = [
  "Говорить нельзя, но можно рисовать в воздухе и показывать предметы вокруг.",
  "Двигайся крупно: силуэт тела воспринимается быстрее маленьких жестов.",
  "Начни с категории: спорт, животное, техника — а потом уточняй.",
  "Не застревай — если сложное слово, жми «Пропуск» и берите следующее.",
  "Уточняй количество слов: покажи пальцами, разбивай на части.",
  "Используй эмоции и мимику — это ускоряет догадки команды.",
];
const PACKS = {
  easy: [
    "зебра",
    "пицца",
    "чемодан",
    "лимон",
    "пальто",
    "робот",
    "звезда",
    "поезд",
    "жук",
    "торт",
    "самокат",
    "лампа",
    "пират",
    "гитара",
    "динозавр",
    "арбуз",
    "компас",
    "фея",
    "сова",
    "радуга",
    "футбол",
    "морковь",
    "скейт",
    "панда",
    "комета",
    "космонавт",
    "салат",
    "йога",
    "жонглёр",
    "плед",
  ],
  medium: [
    "телескоп",
    "камчатка",
    "практикант",
    "молния",
    "вулкан",
    "квиток",
    "дирижёр",
    "горнолыжник",
    "интерфейс",
    "коллекционер",
    "балкон",
    "экспонат",
    "город-сад",
    "звукозапись",
    "архивариус",
    "танкер",
    "альбатрос",
    "перископ",
    "батут",
    "органайзер",
    "лаборатория",
    "будильник",
    "фехтовальщик",
    "сковорода",
    "океанариум",
    "снегоход",
    "калейдоскоп",
    "инкогнито",
    "фотокарточка",
    "квест-комната",
  ],
  hard: [
    "детокс",
    "марципан",
    "киберпанк",
    "голограмма",
    "капсула времени",
    "нетворкинг",
    "ретрит",
    "экзоскелет",
    "терминатор",
    "неодимовый магнит",
    "микродозинг",
    "палеонтолог",
    "суперпозиция",
    "антигравитация",
    "ретранслятор",
    "навигация",
    "гидропонка",
    "песочные часы",
    "синхрофазотрон",
    "купол дрона",
    "невесомость",
    "логист",
    "интроспекция",
    "криптография",
    "аэроэкспресс",
    "эклектика",
    "панорама",
    "энергетик",
    "гиперкроссфит",
    "монолит",
  ],
};

const randomId = () =>
  (typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `id-${Date.now()}-${Math.random().toString(16).slice(2)}`);

const parseWords = (text) =>
  (text || "")
    .split(/\r?\n/)
    .map((w) => w.trim())
    .filter(Boolean);

const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

export default function Crocodile({ goBack, onProgress, setBackHandler }) {
  const [stage, setStage] = useState("welcome"); // welcome | setup | round | summary
  const [settings, setSettings] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEYS.settings) || "null");
      return saved ? { ...DEFAULT_SETTINGS, ...saved } : DEFAULT_SETTINGS;
    } catch {
      return DEFAULT_SETTINGS;
    }
  });
  const [roster, setRoster] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEYS.roster) || "null");
      return Array.isArray(saved) && saved.length ? saved : DEFAULT_ROSTER;
    } catch {
      return DEFAULT_ROSTER;
    }
  });
  const [customText, setCustomText] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEYS.custom) || "ледокол\nкейс-стадия\nмаршмеллоу тест";
    } catch {
      return "ледокол\nкейс-стадия\nмаршмеллоу тест";
    }
  });
  const [currentWord, setCurrentWord] = useState(null);
  const [usedWords, setUsedWords] = useState([]);
  const usedRef = useRef([]);
  const [turnIndex, setTurnIndex] = useState(0);
  const [timerMs, setTimerMs] = useState(settings.roundSeconds * 1000);
  const [running, setRunning] = useState(false);
  const [turnStatus, setTurnStatus] = useState("idle"); // idle | running | paused | timeup
  const [history, setHistory] = useState([]);
  const [winner, setWinner] = useState(null);
  const [toast, setToast] = useState("");
  const [tip, setTip] = useState(TIPS[0]);
  const [rulesOpen, setRulesOpen] = useState(false);
  const confettiInstance = useRef(null);
  const progressGiven = useRef(false);

  const customWords = useMemo(() => parseWords(customText), [customText]);

  const wordPool = useMemo(() => {
    const base = [];
    const withLabel = (words, level) => words.map((w) => ({ id: `${level}-${w}`, word: w, level }));
    if (settings.difficulty === "easy") base.push(...withLabel(PACKS.easy, "easy"));
    else if (settings.difficulty === "medium") base.push(...withLabel(PACKS.medium, "medium"));
    else if (settings.difficulty === "hard") base.push(...withLabel(PACKS.hard, "hard"));
    else if (settings.difficulty === "custom") base.push(...withLabel(customWords, "custom"));
    else {
      base.push(...withLabel(PACKS.easy, "easy"), ...withLabel(PACKS.medium, "medium"), ...withLabel(PACKS.hard, "hard"));
      if (customWords.length) base.push(...withLabel(customWords, "custom"));
    }
    return base;
  }, [customWords, settings.difficulty]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.settings, JSON.stringify(settings));
  }, [settings]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.roster, JSON.stringify(roster));
  }, [roster]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.custom, customText);
  }, [customText]);

  useEffect(() => {
    if (!setBackHandler) return undefined;
    const handler = () => {
      if (stage === "round" && running) {
        const ok = window.confirm("Выйти? Текущий раунд остановится.");
        if (!ok) return;
      }
      goBack?.();
    };
    setBackHandler(handler);
    return () => setBackHandler(null);
  }, [goBack, running, setBackHandler, stage]);

  useEffect(() => {
    if (stage !== "round" || !running) return undefined;
    const tick = setInterval(() => {
      setTimerMs((prev) => {
        const next = Math.max(0, prev - 200);
        if (next === 0) {
          setRunning(false);
          setTurnStatus("timeup");
        }
        return next;
      });
    }, 200);
    return () => clearInterval(tick);
  }, [running, stage]);

  const parsedTime = useMemo(() => {
    const total = settings.roundSeconds * 1000;
    const pct = clamp(Math.round((timerMs / total) * 100), 0, 100);
    const sec = Math.round(timerMs / 1000);
    const mm = String(Math.floor(sec / 60)).padStart(2, "0");
    const ss = String(sec % 60).padStart(2, "0");
    return { pct, label: `${mm}:${ss}` };
  }, [settings.roundSeconds, timerMs]);

  const canStart = useMemo(() => {
    const enoughPlayers = roster.length >= 2;
    const hasWords = wordPool.length > 0;
    return enoughPlayers && hasWords;
  }, [roster.length, wordPool.length]);

  const currentPerformer = roster[turnIndex] || roster[0];
  const nextPerformer = roster[(turnIndex + 1) % Math.max(roster.length, 1)];

  const resetWords = () => {
    usedRef.current = [];
    setUsedWords([]);
  };

  const pickWord = () => {
    const pool = wordPool.length
      ? wordPool
      : [
          { id: "fallback-лампа", word: "лампа", level: "easy" },
          { id: "fallback-окно", word: "окно", level: "easy" },
        ];
    let available = pool.filter((w) => !usedRef.current.includes(w.id));
    if (!available.length) {
      usedRef.current = [];
      setUsedWords([]);
      available = pool;
    }
    const next = available[Math.floor(Math.random() * available.length)];
    usedRef.current = [...usedRef.current, next.id];
    setUsedWords(usedRef.current);
    setCurrentWord(next);
    setTip(TIPS[Math.floor(Math.random() * TIPS.length)]);
  };

  const startGame = (quick = false) => {
    if (!canStart) {
      setStage("setup");
      setToast("Добавьте игроков и слова");
      setTimeout(() => setToast(""), 1800);
      return;
    }
    setRoster((prev) => prev.map((p) => ({ ...p, score: 0 })));
    setHistory([]);
    setWinner(null);
    resetWords();
    setTurnIndex(0);
    setTimerMs(settings.roundSeconds * 1000);
    setTurnStatus("running");
    setRunning(true);
    setStage("round");
    if (quick) {
      setToast("Быстрый старт запущен");
      setTimeout(() => setToast(""), 1800);
    }
    pickWord();
    progressGiven.current = false;
    window.navigator?.vibrate?.(10);
  };

  const handleGuess = () => {
    if (!currentWord) return;
    const performer = currentPerformer;
    const entry = {
      id: randomId(),
      word: currentWord.word,
      result: "guessed",
      at: Date.now(),
      by: performer?.name || "Команда",
      difficulty: currentWord.level,
      left: parsedTime.label,
    };
    setHistory((h) => [entry, ...h].slice(0, 80));
    setRoster((prev) =>
      prev.map((p, idx) =>
        idx === turnIndex ? { ...p, score: (p.score || 0) + 1 } : p
      )
    );
    window.navigator?.vibrate?.(12);
    pickWord();
  };

  const handleSkip = () => {
    if (!currentWord) return;
    const performer = currentPerformer;
    const entry = {
      id: randomId(),
      word: currentWord.word,
      result: "skipped",
      at: Date.now(),
      by: performer?.name || "Команда",
      difficulty: currentWord.level,
      left: parsedTime.label,
    };
    setHistory((h) => [entry, ...h].slice(0, 80));
    window.navigator?.vibrate?.(5);
    pickWord();
  };

  const nextTurn = () => {
    setTurnIndex((idx) => (idx + 1) % Math.max(roster.length, 1));
    setTimerMs(settings.roundSeconds * 1000);
    setTurnStatus("running");
    setRunning(true);
    pickWord();
  };

  useEffect(() => {
    const leading = roster.find((p) => p.score >= settings.targetScore);
    if (leading) {
      setWinner(leading);
      setStage("summary");
      setRunning(false);
      fireConfetti();
      if (!progressGiven.current) {
        onProgress?.();
        progressGiven.current = true;
      }
    }
  }, [onProgress, roster, settings.targetScore]);

  const fireConfetti = () => {
    if (!confettiInstance.current) return;
    confettiInstance.current({
      particleCount: 180,
      spread: 70,
      origin: { y: 0.3 },
      colors: ["#7c3aed", "#22d3ee", "#10b981", "#f59e0b"],
    });
  };

  const summaryScoreboard = useMemo(
    () => [...roster].sort((a, b) => b.score - a.score),
    [roster]
  );

  const packLabel = {
    easy: "Лайт",
    medium: "Стандарт",
    hard: "Хард",
    mixed: "Микс",
    custom: "Свои слова",
  }[settings.difficulty];

  return (
    <div className="croco">
      <div className="croco-bg">
        <div className="blob one" />
        <div className="blob two" />
      </div>

      <div className="croco-shell">
        <header className="croco-appbar">
          <div className="croco-appbar-title">
            <span className="dot" />
            Крокодил
          </div>
          <div className="croco-appbar-meta">
            <div className="pill">
              <Users size={14} /> {settings.mode === "teams" ? "Команды" : "Игроки"} ·{" "}
              {roster.length}
            </div>
            <div className="pill">
              <Clock3 size={14} /> {settings.roundSeconds} c
            </div>
            <div className="pill">
              <Target size={14} /> до {settings.targetScore}
            </div>
            <button
              className="croco-icon ghost"
              aria-label="Настроить игру"
              title="Настроить игру"
              onClick={() => setStage("setup")}
            >
              <Settings2 size={18} />
            </button>
          </div>
        </header>

        <AnimatePresence mode="wait">
          {stage === "welcome" && (
            <motion.section
              key="welcome"
              className="croco-hero"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.35 }}
            >
              <div className="hero-stack">
                <div className="hero-card neon">
                  <div className="hero-content">
                    <p className="eyebrow">Никаких слов — только жесты</p>
                    <h1>Покажи слово. Команда угадывает — получает очки.</h1>
                    <p className="muted">Покажи слово жестами. Таймер и очки готовы.</p>
                  <div className="hero-actions">
                    <button className="croco-btn primary" onClick={() => startGame(true)}>
                      <Sparkles size={18} /> Быстрый старт
                    </button>
                  </div>
                </div>
                </div>

                <div className="rules-wide" onClick={() => setRulesOpen(true)}>
                  <div className="rules-title">
                    <BookOpen size={16} /> Правила
                  </div>
                  <p className="muted">
                    Только жесты, можно пропускать сложные слова. Играем до {settings.targetScore} очков.
                  </p>
                </div>
              </div>
            </motion.section>
          )}

          {stage === "setup" && (
            <motion.section
              key="setup"
              className="croco-setup"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.25 }}
            >
              <div className="setup-grid">
                <div className="croco-card">
                  <div className="card-header">
                    <div className="title">
                      <Users size={18} /> Режим
                    </div>
                    <div className="hint">Передавайте телефон и меняйте выступающего</div>
                  </div>
                  <div className="segmented">
                    {[
                      { key: "teams", label: "Команды" },
                      { key: "solo", label: "Индивидуально" },
                    ].map((item) => (
                      <button
                        key={item.key}
                        className={`seg-btn ${settings.mode === item.key ? "active" : ""}`}
                        onClick={() => setSettings((s) => ({ ...s, mode: item.key }))}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                  <div className="roster">
                    {roster.map((team, idx) => (
                      <div key={team.id} className="roster-item">
                        <div
                          className="avatar"
                          style={{ background: team.color || "#0f172a" }}
                        >
                          {team.emoji || "🎯"}
                        </div>
                        <input
                          value={team.name}
                          onChange={(e) =>
                            setRoster((prev) =>
                              prev.map((p, i) =>
                                i === idx ? { ...p, name: e.target.value } : p
                              )
                            )
                          }
                        />
                        <button
                          className="croco-icon ghost"
                          onClick={() =>
                            setRoster((prev) => prev.filter((_, i) => i !== idx))
                          }
                          disabled={roster.length <= 2}
                          title="Удалить"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    ))}
                    <button
                      className="croco-btn ghost"
                      onClick={() =>
                        setRoster((prev) => [
                          ...prev,
                          {
                            id: randomId(),
                            name: `Команда ${prev.length + 1}`,
                            emoji: ["🧊", "⚡️", "🌿", "🎯"][prev.length % 4],
                            color: PALETTE[prev.length % PALETTE.length],
                            score: 0,
                          },
                        ])
                      }
                    >
                      <Plus size={16} /> Добавить {settings.mode === "teams" ? "команду" : "игрока"}
                    </button>
                  </div>
                </div>

                <div className="croco-card">
                  <div className="card-header">
                    <div className="title">
                      <GaugeCircle size={18} /> Пак слов
                    </div>
                    <div className="hint">Можно смешивать сложности и добавлять свои</div>
                  </div>
                  <div className="chips">
                    {[
                      { key: "easy", label: "Лайт", desc: "простые" },
                      { key: "medium", label: "Стандарт", desc: "живые" },
                      { key: "hard", label: "Хард", desc: "сложные" },
                      { key: "mixed", label: "Микс", desc: "все" },
                      { key: "custom", label: "Свои", desc: "импорт" },
                    ].map((p) => (
                      <button
                        key={p.key}
                        className={`chip ${settings.difficulty === p.key ? "active" : ""}`}
                        onClick={() => setSettings((s) => ({ ...s, difficulty: p.key }))}
                      >
                        <span>{p.label}</span>
                        <small>{p.desc}</small>
                      </button>
                    ))}
                  </div>
                  <textarea
                    value={customText}
                    onChange={(e) => setCustomText(e.target.value)}
                    rows={5}
                    className="input ghost"
                    placeholder="Каждое слово — с новой строки"
                  />
                  <div className="hint">
                    {customWords.length} своих слов. Всего в колоде: {wordPool.length}.
                  </div>
                </div>

                <div className="croco-card">
                  <div className="card-header">
                    <div className="title">
                      <Clock3 size={18} /> Раунд
                    </div>
                  </div>
                  <div className="slider">
                    <label>Длительность: {settings.roundSeconds} сек</label>
                    <input
                      type="range"
                      min={30}
                      max={120}
                      step={5}
                      value={settings.roundSeconds}
                      onChange={(e) =>
                        setSettings((s) => ({
                          ...s,
                          roundSeconds: Number(e.target.value),
                        }))
                      }
                    />
                  </div>
                  <div className="slider">
                    <label>Победа: {settings.targetScore} очков</label>
                    <input
                      type="range"
                      min={5}
                      max={30}
                      step={1}
                      value={settings.targetScore}
                      onChange={(e) =>
                        setSettings((s) => ({
                          ...s,
                          targetScore: Number(e.target.value),
                        }))
                      }
                    />
                  </div>
                  <label className="toggle">
                    <input
                      type="checkbox"
                      checked={settings.hints}
                      onChange={(e) =>
                        setSettings((s) => ({ ...s, hints: e.target.checked }))
                      }
                    />
                    <span>Показывать подсказки/табу</span>
                  </label>
                  <div className="actions-row">
                    <button
                      className="croco-btn primary"
                      disabled={!canStart}
                      onClick={() => startGame()}
                    >
                      <Play size={18} /> Стартовать
                    </button>
                    <button className="croco-btn ghost" onClick={() => setStage("welcome")}>
                      Назад
                    </button>
                  </div>
                  {!canStart && (
                    <div className="hint danger">
                      Нужно минимум 2 участника и хотя бы одно слово в колоде.
                    </div>
                  )}
                </div>
              </div>
            </motion.section>
          )}

          {stage === "round" && (
            <motion.section
              key="round"
              className="croco-game"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
            >
              <div className="game-main">
                <div className="turn-head">
                  <div className="team-chip" style={{ background: currentPerformer?.color }}>
                    <span className="emoji">{currentPerformer?.emoji || "🎯"}</span>
                    <div>
                      <div className="label">Сейчас выступает</div>
                      <div className="name">{currentPerformer?.name || "Команда"}</div>
                    </div>
                  </div>
                  <div className="next">
                    Следующий: {nextPerformer?.name || "—"}
                  </div>
                </div>

                <div className="timer">
                  <div className="timer-top">
                    <div className="pill ghost">
                      <Clock3 size={14} /> {parsedTime.label}
                    </div>
                    <div className="pill ghost">
                      <Flame size={14} /> очки: {currentPerformer?.score || 0}
                    </div>
                    <div className="pill ghost">
                      <HistoryIcon size={14} /> {Math.max(wordPool.length - usedWords.length, 0)} осталось
                    </div>
                  </div>
                  <div className="timer-bar">
                    <i style={{ "--pct": `${parsedTime.pct}%` }} />
                  </div>
                </div>

                <div className="word-card">
                  <div className="badge">
                    <Activity size={14} /> {currentWord?.level || "..."}
                  </div>
                  <div className="word">{currentWord?.word || "Готовьте жесты"}</div>
                  <div className="sub">
                    Покажи без слов, звуков и букв. Если сложно — пропусти.
                  </div>
                </div>
                {settings.hints && (
                  <div className="tip-card">
                    <Sparkles size={16} /> {tip}
                  </div>
                )}

                <div className="actions-row wide">
                  <button
                    className="croco-btn success big"
                    onClick={handleGuess}
                    disabled={!currentWord || turnStatus === "paused" || turnStatus === "timeup"}
                  >
                    <Check size={18} /> Угадали
                  </button>
                  <button
                    className="croco-btn ghost big"
                    onClick={handleSkip}
                    disabled={!currentWord || turnStatus === "paused" || turnStatus === "timeup"}
                  >
                    <SkipForward size={18} /> Пропуск
                  </button>
                  <button
                    className="croco-btn outline big"
                    onClick={() => {
                      if (turnStatus === "paused") {
                        setRunning(true);
                        setTurnStatus("running");
                      } else {
                        setRunning(false);
                        setTurnStatus("paused");
                      }
                    }}
                  >
                    {turnStatus === "paused" ? (
                      <>
                        <Play size={18} /> Продолжить
                      </>
                    ) : (
                      <>
                        <Pause size={18} /> Пауза
                      </>
                    )}
                  </button>
                </div>

                <div className="footer-row">
                  <button className="croco-btn ghost" onClick={() => nextTurn()}>
                    <RefreshCw size={16} /> Следующий ход
                  </button>
                  <button className="croco-btn ghost" onClick={() => setStage("setup")}>
                    Настройки
                  </button>
                </div>

                {turnStatus === "timeup" && (
                  <div className="overlay">
                    <div className="overlay-card">
                      <p className="muted">Время!</p>
                      <h3>Меняйте выступающего</h3>
                      <button className="croco-btn primary" onClick={nextTurn}>
                        <Play size={16} /> Новый ход
                      </button>
                    </div>
                  </div>
                )}
              </div>

              <aside className="game-side">
                <div className="croco-card small">
                  <div className="card-header">
                    <div className="title">
                      <Trophy size={16} /> Счёт
                    </div>
                  </div>
                  <div className="score-list">
                    {roster.map((team) => {
                      const pct = clamp(
                        Math.round((team.score / settings.targetScore) * 100),
                        0,
                        100
                      );
                      return (
                        <div key={team.id} className="score-row">
                          <div className="left">
                            <span className="avatar" style={{ background: team.color }}>
                              {team.emoji}
                            </span>
                            <div>
                              <div className="name">{team.name}</div>
                              <div className="muted">до {settings.targetScore}</div>
                            </div>
                          </div>
                          <div className="score">{team.score}</div>
                          <div className="line">
                            <i style={{ "--pct": `${pct}%` }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="croco-card small">
                  <div className="card-header">
                    <div className="title">
                      <HistoryIcon size={16} /> История
                    </div>
                  </div>
                  <div className="history">
                    {history.length === 0 && (
                      <div className="muted">Ещё нет событий — сыграйте раунд.</div>
                    )}
                    {history.slice(0, 10).map((item) => (
                      <div key={item.id} className={`history-row ${item.result}`}>
                        <div>
                          <div className="word">{item.word}</div>
                          <div className="muted">
                            {item.by} · {item.left}
                          </div>
                        </div>
                        <span className="pill ghost">
                          {item.result === "guessed" ? "✓" : "↻"} {item.difficulty}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </aside>
            </motion.section>
          )}

          {stage === "summary" && (
            <motion.section
              key="summary"
              className="croco-summary"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
          >
            <div className="summary-card">
                <div className="pill success">
                  <PartyPopper size={16} /> Матч завершён
                </div>
                <h2>
                  Победил(а): {winner?.emoji} {winner?.name}
                </h2>
                <p className="muted">
                  Отлично сыграли! Можно продолжать с текущими настройками или собрать новую
                  команду.
                </p>
                <div className="summary-grid">
                  {summaryScoreboard.map((team) => (
                    <div key={team.id} className="summary-row">
                      <div className="left">
                        <span className="avatar" style={{ background: team.color }}>
                          {team.emoji}
                        </span>
                        <div>
                          <div className="name">{team.name}</div>
                          <div className="muted">Очков: {team.score}</div>
                        </div>
                      </div>
                      <div className="score">{team.score}</div>
                    </div>
                  ))}
                </div>
                <div className="actions-row">
                  <button className="croco-btn primary" onClick={() => startGame()}>
                    <Play size={18} /> Ещё раунд
                  </button>
                  <button className="croco-btn ghost" onClick={() => setStage("setup")}>
                    <Wand2 size={18} /> Настроить заново
                  </button>
                </div>
              </div>
            </motion.section>
          )}
        </AnimatePresence>

        {toast && <div className="toast">{toast}</div>}
      </div>

      <AnimatePresence>
        {rulesOpen && (
          <motion.div
            className="modal-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <motion.div
              className="modal-card"
              initial={{ opacity: 0, y: 20, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 10, scale: 0.98 }}
            >
              <div className="modal-head">
                <div className="title">
                  <Info size={16} /> Правила
                </div>
                <button className="croco-icon ghost" onClick={() => setRulesOpen(false)}>
                  ✕
                </button>
              </div>
              <ul className="rules-list">
                <li>Только жесты и мимика, без слов и звуков.</li>
                <li>Сложно? Жми «Пропуск» и берите следующее слово.</li>
                <li>За угадывание +1 очко. Играем до {settings.targetScore}.</li>
              </ul>
              <div className="actions-row">
                <button className="croco-btn ghost" onClick={() => setRulesOpen(false)}>
                  Понятно
                </button>
                <button
                  className="croco-btn primary"
                  onClick={() => {
                    setRulesOpen(false);
                    setStage("setup");
                  }}
                >
                  Настроить
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <Confetti
        refConfetti={(instance) => {
          confettiInstance.current = instance;
        }}
        style={{ position: "fixed", inset: 0, zIndex: 20, pointerEvents: "none" }}
      />
    </div>
  );
}
