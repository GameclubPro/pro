import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import Confetti from "react-canvas-confetti";
import {
  Activity,
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  ArrowRightLeft,
  Check,
  CheckCircle2,
  Clock,
  Flag,
  Gauge,
  ListChecks,
  Pause,
  Play,
  RefreshCw,
  RotateCcw,
  Settings,
  Shuffle,
  Sparkles,
  Timer,
  User,
  Users,
  Volume2,
  VolumeX,
  Wand2,
  X,
  XCircle,
} from "lucide-react";
import {
  appendCustomWords,
  buildWordPool,
  normalizePacks,
  parseWords,
  removeCustomWordAt,
} from "./crocodile-helpers";
import "./crocodile.css";
import "./associations.css";

const STORAGE_KEYS = {
  settings: "pt_explain_settings_v1",
  roster: "pt_explain_roster_v1",
  custom: "pt_explain_custom_v1",
};

const DEFAULT_SETTINGS = {
  roundSeconds: 70,
  passLimit: 3,
  reward: 1,
  passPenalty: 0,
  foulPenalty: 1,
  autoDifficulty: true,
  difficulty: ["easy", "medium", "hard"],
  sound: true,
  autoRotate: true,
};

const PALETTE = [
  "#22d3ee",
  "#8b5cf6",
  "#fb7185",
  "#10b981",
  "#f59e0b",
  "#6366f1",
  "#ec4899",
  "#06b6d4",
];

const EMOJIS = ["🧩", "🔥", "💡", "🚀", "🎯", "🧠", "⚡️", "💎", "🌟", "🤝"];

const TIPS = [
  "Избегай корней и однокоренных — подбирай метафоры.",
  "Сравни слово с фильмом, местом или ощущением.",
  "Меняй угол: расскажи функцию, форму и контекст использования.",
  "Если застыл — пасни и забирай следующее слово.",
  "Ищи противоположности и ассоциации, а не перевод.",
  "Дроби на категории: кто? что делает? зачем? где встречается?",
];

const randomId = () =>
  (typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `id-${Date.now()}-${Math.random().toString(16).slice(2)}`);

const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

const persist = (key, value) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore */
  }
};

const readPersisted = (key, fallback) => {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return parsed || fallback;
  } catch {
    return fallback;
  }
};

const initialRoster = () =>
  Array.from({ length: 4 }).map((_, idx) => ({
    id: `p-${idx}`,
    name: `Игрок ${idx + 1}`,
    emoji: EMOJIS[idx % EMOJIS.length],
    color: PALETTE[idx % PALETTE.length],
    score: 0,
  }));

const levelScore = (level) => {
  if (level === "easy") return 1;
  if (level === "medium") return 2;
  if (level === "hard") return 3;
  return 2;
};

const pickWord = (pool, used, streak, autoDifficulty) => {
  const usedSet = new Set(used);
  let available = pool.filter((w) => !usedSet.has(w.id));
  if (!available.length) available = pool;
  if (!available.length) return null;
  if (autoDifficulty) {
    const target = clamp(1 + Math.floor(streak / 2), 1, 3);
    const scored = available.map((w) => ({
      w,
      score: Math.abs(levelScore(w.level) - target),
    }));
    const best = Math.min(...scored.map((s) => s.score));
    available = scored.filter((s) => s.score === best).map((s) => s.w);
  }
  return available[Math.floor(Math.random() * available.length)];
};

const formatSeconds = (ms) => {
  const total = Math.ceil(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return m ? `${m}:${String(s).padStart(2, "0")}` : `${s}c`;
};

const useHaptics = () => {
  const fire = useCallback((style = "light") => {
    const tg = window?.Telegram?.WebApp;
    try {
      tg?.HapticFeedback?.impactOccurred?.(style);
    } catch {
      /* noop */
    }
  }, []);
  return fire;
};

const useChime = (enabled) => {
  const audioRef = useRef(null);
  useEffect(() => {
    if (!enabled) return;
    const src =
      "data:audio/wav;base64,UklGRoQAAABXQVZFZm10IBAAAAABAAEAgD4AAAB9AAACABAAZGF0YVgAAAAA//8AAP//AAD//wAA//8AAP//AAD//wAA//8AAP//AAD//wAA//8AAP//AAD//wAA//8AAP//AAD//wAA";
    audioRef.current = new Audio(src);
    audioRef.current.volume = 0.25;
  }, [enabled]);
  const play = useCallback(() => {
    if (!enabled) return;
    const a = audioRef.current;
    if (a) {
      a.currentTime = 0;
      a.play().catch(() => {});
    }
  }, [enabled]);
  return play;
};

const useBeep = (enabled) => {
  const ctxRef = useRef(null);
  const play = useCallback(
    (duration = 0.4, freq = 880) => {
      if (!enabled) return;
      try {
        if (!ctxRef.current) {
          const Ctx = window.AudioContext || window.webkitAudioContext;
          ctxRef.current = new Ctx();
        }
        const ctx = ctxRef.current;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.18, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration * 0.9);
        osc.connect(gain).connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + duration);
      } catch {
        /* ignore */
      }
    },
    [enabled]
  );
  return {
    short: () => play(0.4, 880),
    long: () => play(1.1, 760),
  };
};

export default function Associations({ goBack, onProgress, setBackHandler }) {
  const savedSettings = useMemo(() => readPersisted(STORAGE_KEYS.settings, DEFAULT_SETTINGS), []);
  const savedRoster = useMemo(() => readPersisted(STORAGE_KEYS.roster, null), []);
  const savedCustom = useMemo(() => readPersisted(STORAGE_KEYS.custom, ""), []);

  const [settings, setSettings] = useState({ ...DEFAULT_SETTINGS, ...savedSettings });
  const [roster, setRoster] = useState(() => {
    const stored = Array.isArray(savedRoster) && savedRoster.length ? savedRoster : initialRoster();
    return stored.map((p, idx) => ({ score: 0, ...p, id: p.id || `p-${idx}` }));
  });
  const [customText, setCustomText] = useState(String(savedCustom || ""));
  const [stage, setStage] = useState("setup"); // setup | round | summary
  const [pair, setPair] = useState(() => {
    const [a, b] = Array.isArray(savedRoster) && savedRoster.length >= 2 ? savedRoster : initialRoster();
    return { explainerId: a?.id, guesserId: b?.id };
  });
  const [roundNumber, setRoundNumber] = useState(1);
  const [timerMs, setTimerMs] = useState(settings.roundSeconds * 1000);
  const [running, setRunning] = useState(false);
  const [currentWord, setCurrentWord] = useState(null);
  const [used, setUsed] = useState([]);
  const [results, setResults] = useState([]);
  const [passCount, setPassCount] = useState(0);
  const [streak, setStreak] = useState(0);
  const [lastAction, setLastAction] = useState(null);
  const [reason, setReason] = useState(null);
  const [tip, setTip] = useState(TIPS[0]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const progressGiven = useRef(false);
  const roundEndedRef = useRef(false);
  const lastBeepSecondRef = useRef(null);

  const haptic = useHaptics();
  const chime = useChime(settings.sound);
  const { short: shortBeep, long: longBeep } = useBeep(settings.sound);
  const confettiRef = useRef(null);

  const customWords = useMemo(() => parseWords(customText), [customText]);
  const normalizedPacks = useMemo(
    () => normalizePacks(settings.difficulty, customWords.length > 0),
    [settings.difficulty, customWords.length]
  );
  const wordPool = useMemo(
    () => buildWordPool({ ...settings, difficulty: normalizedPacks }, customWords),
    [settings, normalizedPacks, customWords]
  );

  const explainer = roster.find((p) => p.id === pair.explainerId);
  const guesser = roster.find((p) => p.id === pair.guesserId);
  const canStart = roster.length >= 2 && wordPool.length > 0;
  const timePct = clamp(timerMs / (settings.roundSeconds * 1000 || 1), 0, 1);
  const canPass = passCount < settings.passLimit;

  useEffect(() => {
    persist(STORAGE_KEYS.settings, settings);
  }, [settings]);

  useEffect(() => {
    persist(STORAGE_KEYS.roster, roster);
  }, [roster]);

  useEffect(() => {
    persist(STORAGE_KEYS.custom, customText);
  }, [customText]);

  useEffect(() => {
    // keep pair valid after roster edits
    if (!roster.length) return;
    const explainerExists = roster.some((r) => r.id === pair.explainerId);
    const guesserExists = roster.some((r) => r.id === pair.guesserId);
    const same = pair.explainerId && pair.explainerId === pair.guesserId;
    if (explainerExists && guesserExists && !same) return;
    const [a, b] = roster;
    setPair({ explainerId: a?.id, guesserId: b?.id || a?.id });
  }, [roster, pair.explainerId, pair.guesserId]);

  useEffect(() => {
    if (!setBackHandler) return undefined;
    setBackHandler(() => {
      if (stage === "round") {
        setRunning((r) => !r);
        return;
      }
      goBack?.();
    });
    return () => setBackHandler(null);
  }, [setBackHandler, stage, goBack]);

  useEffect(() => {
    if (stage !== "round" || !running) return undefined;
    let prev = performance.now();
    const id = setInterval(() => {
      const now = performance.now();
      const delta = now - prev;
      prev = now;
      setTimerMs((ms) => Math.max(0, ms - delta));
    }, 140);
    return () => clearInterval(id);
  }, [stage, running]);

  useEffect(() => {
    if (stage !== "round" || !running) return;
    const seconds = Math.ceil(timerMs / 1000);
    if (seconds <= 10 && lastBeepSecondRef.current !== seconds) {
      lastBeepSecondRef.current = seconds;
      shortBeep();
      haptic("light");
    }
    if (timerMs <= 0 && !roundEndedRef.current) {
      roundEndedRef.current = true;
      longBeep();
      finishRound("time");
    }
  }, [timerMs, stage, running, shortBeep, longBeep, haptic]);

  useEffect(() => {
    if (stage === "summary" && !progressGiven.current) {
      progressGiven.current = true;
      onProgress?.();
    }
  }, [stage, onProgress]);

  const fireConfetti = useCallback(() => {
    if (!confettiRef.current) return;
    confettiRef.current({
      particleCount: 160,
      spread: 70,
      origin: { y: 0.3 },
      colors: ["#22d3ee", "#8b5cf6", "#10b981", "#f59e0b"],
    });
  }, []);

  const startRound = () => {
    if (!canStart) return;
    const first = pickWord(wordPool, used, streak, settings.autoDifficulty);
    progressGiven.current = false;
    setCurrentWord(first);
    setResults([]);
    setPassCount(0);
    setStreak(0);
    setTimerMs(settings.roundSeconds * 1000);
    setStage("round");
    setRunning(true);
    setReason(null);
    roundEndedRef.current = false;
    lastBeepSecondRef.current = null;
    setTip(TIPS[Math.floor(Math.random() * TIPS.length)]);
    chime();
    haptic("medium");
  };

  const rotatePair = useCallback(() => {
    if (roster.length < 2) return;
    const currentIdx = roster.findIndex((r) => r.id === pair.explainerId);
    const nextExplainer = roster[(currentIdx + 1) % roster.length];
    const nextGuesser = roster[(currentIdx + 2) % roster.length] || roster[0];
    setPair({ explainerId: nextExplainer.id, guesserId: nextGuesser.id });
  }, [roster, pair.explainerId]);

  const applyScore = useCallback(
    (deltaExplainer = 0, deltaGuesser = 0) => {
      setRoster((prev) =>
        prev.map((p) => {
          if (p.id === pair.explainerId) return { ...p, score: (p.score || 0) + deltaExplainer };
          if (p.id === pair.guesserId) return { ...p, score: (p.score || 0) + deltaGuesser };
          return p;
        })
      );
    },
    [pair.explainerId, pair.guesserId]
  );

  const goNextWord = useCallback(
    (nextStreak = 0) => {
      const next = pickWord(wordPool, used, nextStreak, settings.autoDifficulty);
      setStreak(nextStreak);
      setCurrentWord(next);
      setTip(TIPS[Math.floor(Math.random() * TIPS.length)]);
    },
    [settings.autoDifficulty, used, wordPool]
  );

  const addResult = useCallback(
    (status) => {
      if (!currentWord) return;
      const entry = {
        id: randomId(),
        word: currentWord.word,
        level: currentWord.level,
        status,
        at: Date.now(),
      };
      setResults((prev) => [...prev, entry]);
      setUsed((prev) => (prev.includes(currentWord.id) ? prev : [...prev, currentWord.id]));
      setLastAction(entry);
      setTimeout(() => setLastAction(null), 1200);
    },
    [currentWord]
  );

  const handleCorrect = () => {
    if (stage !== "round" || !currentWord) return;
    addResult("guessed");
    applyScore(settings.reward, settings.reward);
    fireConfetti();
    haptic("heavy");
    goNextWord(streak + 1);
  };

  const handlePass = () => {
    if (stage !== "round" || !currentWord || !canPass) return;
    addResult("pass");
    if (settings.passPenalty) applyScore(-settings.passPenalty, 0);
    setPassCount((p) => p + 1);
    haptic("light");
    goNextWord(0);
  };

  const handlePenalty = () => {
    if (stage !== "round" || !currentWord) return;
    addResult("penalty");
    applyScore(-settings.foulPenalty, 0);
    haptic("medium");
    goNextWord(0);
  };

  const finishRound = useCallback(
    (why = "time") => {
      if (roundEndedRef.current && stage === "summary") return;
      roundEndedRef.current = true;
      setRunning(false);
      setStage("summary");
      setReason(why);
      setTimerMs(0);
      setCurrentWord(null);
    },
    [stage]
  );

  const resetMatch = () => {
    setUsed([]);
    setResults([]);
    setRoundNumber(1);
    setPassCount(0);
    setStreak(0);
    setTimerMs(settings.roundSeconds * 1000);
    setStage("setup");
    setCurrentWord(null);
    setReason(null);
    roundEndedRef.current = false;
    lastBeepSecondRef.current = null;
    setRoster((prev) => prev.map((p) => ({ ...p, score: 0 })));
  };

  const nextRound = () => {
    setRoundNumber((n) => n + 1);
    setResults([]);
    setPassCount(0);
    setStreak(0);
    setReason(null);
    roundEndedRef.current = false;
    lastBeepSecondRef.current = null;
    if (settings.autoRotate) rotatePair();
    startRound();
  };

  const addPlayer = () => {
    const idx = roster.length + 1;
    const emoji = EMOJIS[idx % EMOJIS.length];
    const color = PALETTE[idx % PALETTE.length];
    setRoster((prev) => [...prev, { id: randomId(), name: `Игрок ${idx}`, emoji, color, score: 0 }]);
  };

  const updatePlayer = (id, patch) => {
    setRoster((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  };

  const removePlayer = (id) => {
    if (roster.length <= 2) return;
    setRoster((prev) => prev.filter((p) => p.id !== id));
  };

  const togglePack = (pack) => {
    setSettings((prev) => {
      const set = new Set(normalizePacks(prev.difficulty, customWords.length > 0));
      if (set.has(pack)) set.delete(pack);
      else set.add(pack);
      const next = Array.from(set);
      return { ...prev, difficulty: next.length ? next : prev.difficulty };
    });
  };

  const toggleSound = () => {
    setSettings((s) => ({ ...s, sound: !s.sound }));
  };

  const soundToggleIcon = settings.sound ? <Volume2 size={18} /> : <VolumeX size={18} />;

  const summaryStats = useMemo(() => {
    const guessed = results.filter((r) => r.status === "guessed").length;
    const passed = results.filter((r) => r.status === "pass").length;
    const fouls = results.filter((r) => r.status === "penalty").length;
    return { guessed, passed, fouls };
  }, [results]);

  const streakLabel = streak >= 3 ? "поток" : streak >= 1 ? "серия" : null;

  const renderRoster = () => (
    <div className="roster-block panel">
      <div className="panel-head">
        <p className="eyebrow">Состав</p>
        <div className="section-header">
          <h3 className="section-title">Кто играет</h3>
          <div className="pill ghost">
            <Users size={16} />
            {roster.length}
          </div>
        </div>
      </div>
      <div className="roster-list">
        {roster.map((p, idx) => (
          <div className="roster-row" key={p.id}>
            <button
              className="avatar-btn"
              style={{ background: p.color }}
              onClick={() => updatePlayer(p.id, { emoji: EMOJIS[(idx + 1) % EMOJIS.length] })}
            >
              {p.emoji}
            </button>
            <input
              value={p.name}
              onChange={(e) => updatePlayer(p.id, { name: e.target.value })}
              placeholder="Имя"
            />
            <div className="roster-actions">
              <button className="icon-btn" onClick={() => updatePlayer(p.id, { color: PALETTE[(idx + 1) % PALETTE.length] })}>
                <RefreshCw size={16} />
              </button>
              <button className="icon-btn" disabled={roster.length <= 2} onClick={() => removePlayer(p.id)}>
                <X size={16} />
              </button>
            </div>
          </div>
        ))}
      </div>
      <button className="ghost-line" onClick={addPlayer}>
        <Sparkles size={16} />
        Добавить игрока
      </button>
    </div>
  );

  const renderWordControls = () => (
    <div className="panel">
      <div className="panel-head">
        <p className="eyebrow">Слова</p>
        <div className="section-header">
          <h3 className="section-title">Наборы</h3>
          <div className="pill ghost">
            <ListChecks size={16} />
            {wordPool.length} слов
          </div>
        </div>
      </div>
      <div className="chips-row">
        {["easy", "medium", "hard"].map((pack) => {
          const active = normalizedPacks.includes(pack);
          return (
            <button
              key={pack}
              className={`seg ${active ? "seg-active" : ""}`}
              onClick={() => togglePack(pack)}
            >
              <Sparkles size={16} />
              {pack === "easy" && "Базовые"}
              {pack === "medium" && "Продвинутые"}
              {pack === "hard" && "Сложные"}
            </button>
          );
        })}
        <button
          className={`seg ${normalizedPacks.includes("custom") ? "seg-active" : ""}`}
          onClick={() => togglePack("custom")}
        >
          <Wand2 size={16} />
          Свои
        </button>
      </div>
      <div className="custom-words">
        <div className="section-header">
          <h4 className="section-title">Свои слова</h4>
          <span className="muted">{customWords.length} шт.</span>
        </div>
        <textarea
          value={customText}
          onChange={(e) => setCustomText(e.target.value)}
          rows={4}
          placeholder="Каждое слово с новой строки"
        />
        <div className="custom-actions">
          <button
            className="btn ghost"
            onClick={() => setCustomText(appendCustomWords(customText, "биндер, катамаран, фильтр\nчерника\nнейроcеть"))}
          >
            <Sparkles size={16} />
            Добавить примеры
          </button>
          <button
            className="btn ghost"
            disabled={!customWords.length}
            onClick={() => setCustomText(removeCustomWordAt(customText, customWords.length - 1))}
          >
            <X size={16} />
            Удалить последнее
          </button>
        </div>
      </div>
    </div>
  );

  const renderSettings = () => (
    <div className="panel">
      <div className="panel-head">
        <p className="eyebrow">Настройки</p>
        <h3 className="panel-title">Раунд</h3>
      </div>
      <div className="grid two">
        <label className="field">
          <div className="label">Время на раунд</div>
          <div className="slider-row">
            <input
              type="range"
              min="30"
              max="120"
              step="5"
              value={settings.roundSeconds}
              onChange={(e) => setSettings((s) => ({ ...s, roundSeconds: Number(e.target.value) }))}
            />
            <div className="pill ghost">
              <Clock size={14} />
              {settings.roundSeconds} c
            </div>
          </div>
        </label>
        <label className="field">
          <div className="label">Лимит пасов</div>
          <div className="slider-row">
            <input
              type="range"
              min="0"
              max="6"
              step="1"
              value={settings.passLimit}
              onChange={(e) => setSettings((s) => ({ ...s, passLimit: Number(e.target.value) }))}
            />
            <div className="pill ghost">
              <Gauge size={14} />
              {settings.passLimit}
            </div>
          </div>
        </label>
        <label className="field">
          <div className="label">Штраф за однокоренное</div>
          <div className="slider-row">
            <input
              type="range"
              min="1"
              max="3"
              step="1"
              value={settings.foulPenalty}
              onChange={(e) => setSettings((s) => ({ ...s, foulPenalty: Number(e.target.value) }))}
            />
            <div className="pill ghost">
              -{settings.foulPenalty}
            </div>
          </div>
        </label>
        <label className="field">
          <div className="label">Пасс штраф</div>
          <div className="slider-row">
            <input
              type="range"
              min="0"
              max="2"
              step="1"
              value={settings.passPenalty}
              onChange={(e) => setSettings((s) => ({ ...s, passPenalty: Number(e.target.value) }))}
            />
            <div className="pill ghost">
              {settings.passPenalty ? `-${settings.passPenalty}` : "без штрафа"}
            </div>
          </div>
        </label>
      </div>
      <div className="toggles">
        <button
          className={`toggle ${settings.autoDifficulty ? "on" : ""}`}
          onClick={() => setSettings((s) => ({ ...s, autoDifficulty: !s.autoDifficulty }))}
        >
          <div className="dot" />
          Авто-сложность
        </button>
        <button
          className={`toggle ${settings.autoRotate ? "on" : ""}`}
          onClick={() => setSettings((s) => ({ ...s, autoRotate: !s.autoRotate }))}
        >
          <div className="dot" />
          Ротация ролей
        </button>
        <button className={`toggle ${settings.sound ? "on" : ""}`} onClick={toggleSound}>
          <div className="dot" />
          Звук {soundToggleIcon}
        </button>
      </div>
    </div>
  );

  const renderPairPicker = () => (
    <div className="panel">
      <div className="panel-head">
        <p className="eyebrow">Роли</p>
        <h3 className="section-title">Кто объясняет</h3>
      </div>
      <div className="pair-grid">
        <div className="pair-card">
          <div className="pair-title">Объясняет</div>
          <div className="pair-pill">
            <User size={16} />
            <select
              value={pair.explainerId}
              onChange={(e) => setPair((p) => ({ ...p, explainerId: e.target.value }))}
            >
              {roster.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.emoji} {p.name}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="pair-card">
          <div className="pair-title">Угадывает</div>
          <div className="pair-pill">
            <Users size={16} />
            <select
              value={pair.guesserId}
              onChange={(e) => setPair((p) => ({ ...p, guesserId: e.target.value }))}
            >
              {roster.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.emoji} {p.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>
      <div className="pair-actions">
        <button className="btn ghost" onClick={() => setPair((p) => ({ explainerId: p.guesserId, guesserId: p.explainerId }))}>
          <ArrowRightLeft size={16} />
          Поменять
        </button>
        <button className="btn ghost" onClick={rotatePair}>
          <Shuffle size={16} />
          Случайная пара
        </button>
      </div>
    </div>
  );

  const renderSetup = () => (
    <div className="explain-grid">
      <div className="panel setup-panel">
        <div className="setup-head">
          <div>
            <p className="eyebrow">Объясни слово</p>
            <h1 className="panel-title">Помоги напарнику отгадать как можно больше</h1>
          </div>
          <button className="settings-fab" onClick={() => setSettingsOpen(true)} aria-label="Настройки">
            <Settings size={16} />
          </button>
        </div>
        <div className="setup-content">
          <p className="muted">
            Один объясняет, второй угадывает. Нельзя использовать однокоренные и однозвучные подсказки. Таймер тикает —
            зарабатывайте очки сериями.
          </p>
          <div className="cta-row">
            <button className="btn primary" onClick={startRound} disabled={!canStart}>
              <Play size={18} />
              Старт раунда
            </button>
          </div>
          {!canStart && (
            <div className="warning">
              <AlertCircle size={16} />
              Нужно минимум 2 игрока и хоть один набор слов
            </div>
          )}
        </div>
      </div>
    </div>
  );

  const renderRound = () => (
    <div className="round-shell">
      <div className="panel round-meta">
        <div className="round-meta-main">
          <div className="round-pill">Раунд {roundNumber}</div>
          <div className="round-pill ghost">
            <Activity size={14} />
            {streakLabel ? `${streakLabel}: ${streak}` : "начинаем"}
          </div>
        </div>
        <div className="round-roles">
          <div className="role-pill">
            <span className="dot" style={{ background: explainer?.color || "#22d3ee" }} />
            {explainer?.emoji} {explainer?.name || "Объясняет"}
          </div>
          <ArrowRight size={14} />
          <div className="role-pill">
            <span className="dot" style={{ background: guesser?.color || "#22d3ee" }} />
            {guesser?.emoji} {guesser?.name || "Угадывает"}
          </div>
        </div>
        <div className="round-stats">
          <div className="pill ghost">
            <Timer size={14} />
            {formatSeconds(timerMs)}
          </div>
          <div className="pill ghost">
            <ListChecks size={14} />
            {results.length} слов
          </div>
          <div className="pill ghost">
            <X size={14} />
            Пасы: {passCount}/{settings.passLimit}
          </div>
        </div>
      </div>

      <div className="panel word-panel">
        <div className="timer-bar">
          <div className="timer-fill" style={{ width: `${timePct * 100}%` }} />
        </div>
        <div className="word-wrap">
          <div className="word-label">Покажи экран объясняющему</div>
          <div className="word-card">
            <span className="word-text">{currentWord?.word || "..."}</span>
            <span className="word-level">{currentWord?.level}</span>
          </div>
        </div>
        <div className="actions">
          <button className="btn primary" onClick={handleCorrect}>
            <CheckCircle2 size={18} />
            Угадано
          </button>
          <button className="btn ghost" onClick={handlePass} disabled={!canPass}>
            <RefreshCw size={18} />
            Пас
          </button>
          <button className="btn danger" onClick={handlePenalty}>
            <AlertCircle size={18} />
            Штраф
          </button>
        </div>
        <div className="secondary-actions">
          <button className="icon-btn" onClick={() => setRunning((r) => !r)}>
            {running ? <Pause size={16} /> : <Play size={16} />}
          </button>
          <button className="icon-btn" onClick={() => finishRound("manual")}>
            <Flag size={16} />
          </button>
          <button className="icon-btn" onClick={() => goBack?.()}>
            <ArrowLeft size={16} />
          </button>
        </div>
        <div className="tip small">
          <Wand2 size={14} />
          {tip}
        </div>
      </div>

      <div className="panel log-panel">
        <div className="section-header">
          <h4 className="section-title">Ход раунда</h4>
          <div className="pill ghost">
            <Clock size={14} />
            {formatSeconds(timerMs)}
          </div>
        </div>
        <div className="log-list">
          {results.length === 0 && <div className="muted">Пока нет действий</div>}
          {results.map((r) => (
            <div className={`log-row ${r.status}`} key={r.id}>
              <div className="log-word">{r.word}</div>
              <div className="log-meta">
                {r.status === "guessed" && <Check size={14} />}
                {r.status === "pass" && <RefreshCw size={14} />}
                {r.status === "penalty" && <XCircle size={14} />}
                <span className="muted">{r.level}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      <AnimatePresence>
        {!running && stage === "round" && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="pause-overlay"
          >
            <div className="panel pause-card">
              <h3>Пауза</h3>
              <p className="muted">Продолжить раунд или завершить досрочно.</p>
              <div className="actions">
                <button className="btn primary" onClick={() => setRunning(true)}>
                  <Play size={16} />
                  Продолжить
                </button>
                <button className="btn ghost" onClick={() => finishRound("manual")}>
                  <Flag size={16} />
                  Завершить
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );

  const renderSummary = () => (
    <div className="panel summary-panel">
      <div className="section-header">
        <h3 className="section-title">Итоги раунда {roundNumber}</h3>
        <div className="pill ghost">
          <Timer size={14} />
          {reason === "time" ? "Время" : "Стоп"}
        </div>
      </div>
      <div className="stat-grid">
        <div className="stat-card">
          <div className="stat-label">Угадано</div>
          <div className="stat-value">{summaryStats.guessed}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Пасы</div>
          <div className="stat-value">{summaryStats.passed}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Штрафы</div>
          <div className="stat-value">{summaryStats.fouls}</div>
        </div>
      </div>
      <div className="scores">
        <h4 className="section-title">Счёт игроков</h4>
        <div className="score-list">
          {roster.map((p) => (
            <div className="score-row" key={p.id}>
              <div className="role-pill">
                <span className="dot" style={{ background: p.color }} />
                {p.emoji} {p.name}
              </div>
              <div className="score">{p.score}</div>
            </div>
          ))}
        </div>
      </div>
      <div className="log-list compact">
        {results.length === 0 && <div className="muted">За раунд нет действий</div>}
        {results.map((r) => (
          <div className={`log-row ${r.status}`} key={r.id}>
            <div className="log-word">{r.word}</div>
            <div className="log-meta">
              {r.status === "guessed" && <Check size={14} />}
              {r.status === "pass" && <RefreshCw size={14} />}
              {r.status === "penalty" && <XCircle size={14} />}
              <span className="muted">{r.level}</span>
            </div>
          </div>
        ))}
      </div>
      <div className="actions">
        <button className="btn primary" onClick={nextRound}>
          <Play size={16} />
          Следующий раунд
        </button>
        <button className="btn ghost" onClick={() => setStage("setup")}>
          <ArrowLeft size={16} />
          К настройкам
        </button>
      </div>
    </div>
  );

  return (
    <div className="croco explain">
      <div className="croco-bg">
        <div className="blob one" />
        <div className="blob two" />
      </div>
      <div className="croco-wrap">
        {stage === "setup" && renderSetup()}
        {stage === "round" && renderRound()}
        {stage === "summary" && renderSummary()}
      </div>
      <AnimatePresence>
        {settingsOpen && (
          <motion.div
            className="settings-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <motion.div
              className="panel settings-sheet"
              initial={{ y: 30, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 20, opacity: 0 }}
            >
              <div className="sheet-head">
                <p className="eyebrow">Настройки</p>
                <button className="icon-btn" onClick={() => setSettingsOpen(false)} aria-label="Закрыть">
                  <X size={16} />
                </button>
              </div>
              <div className="sheet-body">
                {renderSettings()}
                {renderWordControls()}
                {renderPairPicker()}
                {renderRoster()}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
      <Confetti
        refConfetti={(instance) => {
          confettiRef.current = instance;
        }}
        style={{
          position: "fixed",
          pointerEvents: "none",
          inset: 0,
          zIndex: 30,
        }}
      />
      <AnimatePresence>
        {lastAction && (
          <motion.div
            key={lastAction.id}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className={`toast ${lastAction.status}`}
          >
            {lastAction.status === "guessed" && <CheckCircle2 size={16} />}
            {lastAction.status === "pass" && <RefreshCw size={16} />}
            {lastAction.status === "penalty" && <AlertCircle size={16} />}
            {lastAction.word}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
