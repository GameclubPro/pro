import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import Confetti from "react-canvas-confetti";
import {
  Activity,
  Check,
  Pause,
  Play,
  RefreshCw,
  Settings,
  Sparkles,
  Trash2,
  Trophy,
  Users,
  Wand2,
  Zap,
  X,
  Volume2,
} from "lucide-react";
import "./crocodile.css";

const STORAGE_KEYS = {
  settings: "pt_crocodile_settings_v3",
  roster: "pt_crocodile_roster_v3",
  custom: "pt_crocodile_custom_v3",
};

const DEFAULT_SETTINGS = {
  mode: "teams",
  roundSeconds: 60,
  wordsPerTeam: 10,
  difficulty: "mixed", // easy | medium | hard | mixed | custom
  autoDifficulty: true,
  hints: true,
  sound: true,
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

const EMOJIS = ["🦎", "🔥", "🌊", "🍀", "🌟", "🚀", "🎯", "🧠", "⚡️", "💎"];

const TIPS = [
  "Говорить нельзя — только жесты и мимика.",
  "Покажи количество слов пальцами, если их несколько.",
  "Разбей слово на части: покажи корень и суффикс руками.",
  "Используй предметы вокруг как реквизит.",
  "Не застревай: пропусти и возьмите следующее слово.",
  "Двигайся крупно, силуэт читается лучше мелких деталей.",
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

const ADVANCE_DELAY_MS = 1500;

const randomId = () =>
  (typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `id-${Date.now()}-${Math.random().toString(16).slice(2)}`);

const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

const parseWords = (text) =>
  (text || "")
    .split(/\r?\n/)
    .map((w) => w.trim())
    .filter(Boolean);

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

const initialRoster = (mode = "teams") => {
  const count = mode === "teams" ? 2 : 4;
  return Array.from({ length: count }).map((_, idx) => ({
    id: `p-${idx}`,
    name: mode === "teams" ? `Команда ${idx + 1}` : `Игрок ${idx + 1}`,
    emoji: EMOJIS[idx % EMOJIS.length],
    color: PALETTE[idx % PALETTE.length],
    score: 0,
  }));
};

const buildWordPool = (settings, customWords) => {
  const withLabel = (words, level) => words.map((w) => ({ id: `${level}-${w}`, word: w, level }));
  const pool = [];
  if (settings.difficulty === "easy") pool.push(...withLabel(PACKS.easy, "easy"));
  else if (settings.difficulty === "medium") pool.push(...withLabel(PACKS.medium, "medium"));
  else if (settings.difficulty === "hard") pool.push(...withLabel(PACKS.hard, "hard"));
  else if (settings.difficulty === "custom") pool.push(...withLabel(customWords, "custom"));
  else {
    pool.push(
      ...withLabel(PACKS.easy, "easy"),
      ...withLabel(PACKS.medium, "medium"),
      ...withLabel(PACKS.hard, "hard")
    );
    if (customWords.length) pool.push(...withLabel(customWords, "custom"));
  }
  return pool.length
    ? pool
    : [{ id: "fallback-лампа", word: "лампа", level: "easy" }];
};

const levelScore = (level) => {
  if (level === "easy") return 1;
  if (level === "medium") return 2;
  if (level === "hard") return 3;
  return 2;
};

const pickWord = (pool, used, streak, autoDifficulty) => {
  const usedSet = new Set(used);
  let available = pool.filter((w) => !usedSet.has(w.id));
  if (!available.length) {
    available = pool;
  }
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

const evaluateWinner = (roster) => {
  if (!roster.length) return [];
  const max = Math.max(...roster.map((r) => r.score));
  return roster.filter((r) => r.score === max);
};

const findNextActive = (perTeam, currentIdx, limit) => {
  const len = perTeam.length || 1;
  for (let step = 1; step <= len; step += 1) {
    const idx = (currentIdx + step) % len;
    if (perTeam[idx] < limit) return idx;
  }
  return null;
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

const reducer = (state, action) => {
  switch (action.type) {
    case "SET_SETTING": {
      const settings = { ...state.settings, [action.key]: action.value };
      return {
        ...state,
        settings,
        timerMs:
          action.key === "roundSeconds"
            ? action.value * 1000
            : state.timerMs,
      };
    }
    case "SET_MODE": {
      const settings = { ...state.settings, mode: action.mode };
      const roster = initialRoster(action.mode);
      return {
        ...state,
        settings,
        roster,
        perTeam: roster.map(() => 0),
        activeIndex: 0,
        stage: "setup",
        timerMs: settings.roundSeconds * 1000,
      };
    }
    case "SET_ROSTER": {
      return {
        ...state,
        roster: action.roster,
        perTeam: action.roster.map(() => 0),
        activeIndex: 0,
      };
    }
    case "SET_CUSTOM": {
      return { ...state, customText: action.value };
    }
    case "START_MATCH": {
      const roster = state.roster.map((r) => ({ ...r, score: 0 }));
      const perTeam = roster.map(() => 0);
      return {
        ...state,
        roster,
        perTeam,
        used: [],
        streak: 0,
        stage: "switch",
        activeIndex: 0,
        timerMs: state.settings.roundSeconds * 1000,
        running: false,
        isPaused: false,
        word: null,
        lastResult: null,
        winner: [],
        reason: null,
      };
    }
    case "SET_WORD": {
      return { ...state, word: action.word, tip: action.tip, lastResult: null };
    }
    case "BEGIN_ROUND": {
      return {
        ...state,
        stage: "round",
        running: true,
        isPaused: false,
        timerMs: state.settings.roundSeconds * 1000,
        lastResult: null,
      };
    }
    case "TICK": {
      if (state.stage !== "round" || !state.running) return state;
      const next = Math.max(0, state.timerMs - action.delta);
      return { ...state, timerMs: next };
    }
    case "PAUSE": {
      if (state.stage !== "round") return state;
      return { ...state, running: false, isPaused: true };
    }
    case "RESUME": {
      if (state.stage !== "round") return state;
      return { ...state, running: true, isPaused: false };
    }
    case "STOP_TIMER": {
      return { ...state, running: false, isPaused: false };
    }
    case "ANSWER": {
      const streak = action.kind === "correct" ? state.streak + 1 : 0;
      return {
        ...state,
        roster: action.roster || state.roster,
        perTeam: action.perTeam || state.perTeam,
        used: action.used || state.used,
        streak,
        lastResult: action.kind,
        word: action.word ?? state.word,
      };
    }
    case "NEXT_TURN": {
      return {
        ...state,
        stage: "switch",
        activeIndex: action.nextIndex ?? state.activeIndex,
        timerMs: state.settings.roundSeconds * 1000,
        running: false,
        isPaused: false,
        word: null,
        lastResult: null,
      };
    }
    case "SUMMARY": {
      return {
        ...state,
        stage: "summary",
        running: false,
        winner: action.winner || [],
        reason: action.reason || null,
      };
    }
    case "RESTART": {
      return {
        ...state,
        stage: "setup",
        running: false,
        isPaused: false,
        word: null,
        used: [],
        perTeam: state.roster.map(() => 0),
        streak: 0,
        lastResult: null,
        activeIndex: 0,
        timerMs: state.settings.roundSeconds * 1000,
        winner: [],
        reason: null,
      };
    }
    default:
      return state;
  }
};

export default function Crocodile({ goBack, onProgress, setBackHandler }) {
  const savedSettings = useMemo(() => readPersisted(STORAGE_KEYS.settings, DEFAULT_SETTINGS), []);
  const savedRoster = useMemo(() => readPersisted(STORAGE_KEYS.roster, null), []);
  const savedCustom = useMemo(
    () =>
      readPersisted(
        STORAGE_KEYS.custom,
        "ледокол\nкейс-стадия\nмаршмеллоу тест"
      ),
    []
  );

  const [state, dispatch] = useReducer(reducer, null, () => {
    const roster =
      Array.isArray(savedRoster) && savedRoster.length
        ? savedRoster
        : initialRoster(savedSettings?.mode || DEFAULT_SETTINGS.mode);
    return {
      settings: { ...DEFAULT_SETTINGS, ...savedSettings },
      roster,
      perTeam: roster.map(() => 0),
      stage: "setup",
      activeIndex: 0,
      timerMs: (savedSettings?.roundSeconds || DEFAULT_SETTINGS.roundSeconds) * 1000,
      running: false,
      isPaused: false,
      word: null,
      used: [],
      streak: 0,
      lastResult: null,
      winner: [],
      tip: TIPS[0],
      customText: String(savedCustom || ""),
      reason: null,
    };
  });

  const haptic = useHaptics();
  const chime = useChime(state.settings.sound);
  const progressGiven = useRef(false);
  const advanceTimeoutRef = useRef(null);
  const confettiRef = useRef(null);

  const customWords = useMemo(() => parseWords(state.customText), [state.customText]);
  const wordPool = useMemo(() => buildWordPool(state.settings, customWords), [state.settings, customWords]);
  const wordsLimit = clamp(state.settings.wordsPerTeam, 3, 30);
  const wordsPlayed = state.perTeam.reduce((sum, n) => sum + n, 0);
  const wordsTotal = wordsLimit * Math.max(state.roster.length, 1);
  const wordsLeft = Math.max(0, wordsTotal - wordsPlayed);
  const timePct = clamp(state.timerMs / (state.settings.roundSeconds * 1000), 0, 1);
  const roundNumber = wordsPlayed + 1;

  const current = state.roster[state.activeIndex] || state.roster[0];

  useEffect(() => {
    persist(STORAGE_KEYS.settings, state.settings);
  }, [state.settings]);

  useEffect(() => {
    persist(STORAGE_KEYS.roster, state.roster);
  }, [state.roster]);

  useEffect(() => {
    persist(STORAGE_KEYS.custom, state.customText);
  }, [state.customText]);

  useEffect(() => {
    if (state.stage !== "round" || !state.running) return undefined;
    let prev = performance.now();
    const id = setInterval(() => {
      const now = performance.now();
      const delta = now - prev;
      prev = now;
      dispatch({ type: "TICK", delta });
    }, 150);
    return () => clearInterval(id);
  }, [state.stage, state.running]);

  useEffect(() => {
    if (!setBackHandler) return undefined;
    setBackHandler(() => {
      if (state.stage === "round") {
        dispatch({ type: state.running ? "PAUSE" : "RESUME" });
        return;
      }
      goBack?.();
    });
    return () => setBackHandler(null);
  }, [setBackHandler, state.stage, state.running, goBack]);

  useEffect(() => {
    if (state.stage === "summary" && !progressGiven.current) {
      progressGiven.current = true;
      onProgress?.();
    }
  }, [state.stage, onProgress]);

  useEffect(() => {
    return () => {
      if (advanceTimeoutRef.current) {
        clearTimeout(advanceTimeoutRef.current);
      }
    };
  }, []);

  const fireConfetti = useCallback(() => {
    if (!confettiRef.current) return;
    confettiRef.current({
      particleCount: 180,
      spread: 70,
      origin: { y: 0.3 },
      colors: ["#22d3ee", "#8b5cf6", "#10b981", "#f59e0b"],
    });
  }, []);

  const handleStart = () => {
    if (state.roster.length < 2 || !wordPool.length) return;
    haptic("medium");
    dispatch({ type: "START_MATCH" });
    progressGiven.current = false;
  };

  const handleBeginRound = () => {
    haptic("light");
    const next = pickWord(wordPool, state.used, state.streak, state.settings.autoDifficulty);
    const nextTip = TIPS[Math.floor(Math.random() * TIPS.length)];
    dispatch({ type: "SET_WORD", word: next, tip: nextTip });
    dispatch({ type: "BEGIN_ROUND" });
  };

  const processAnswer = useCallback(
    (kind) => {
      if (state.stage !== "round") return;
      if (advanceTimeoutRef.current) return;
      dispatch({ type: "STOP_TIMER" });
      const isCorrect = kind === "correct";
      const nextRoster = state.roster.map((r, idx) =>
        idx === state.activeIndex && isCorrect ? { ...r, score: (r.score || 0) + 1 } : r
      );
      const nextPerTeam = state.perTeam.map((n, idx) =>
        idx === state.activeIndex ? n + 1 : n
      );
      const nextUsed =
        state.word?.id && !state.used.includes(state.word.id)
          ? [...state.used, state.word.id]
          : state.used;
      dispatch({
        type: "ANSWER",
        kind: isCorrect ? "correct" : "skip",
        roster: nextRoster,
        perTeam: nextPerTeam,
        used: nextUsed,
      });
      const allDone = nextPerTeam.every((n) => n >= wordsLimit);
      const nextIdx = findNextActive(nextPerTeam, state.activeIndex, wordsLimit);
      advanceTimeoutRef.current = setTimeout(() => {
        if (allDone) {
          const winner = evaluateWinner(nextRoster);
          dispatch({ type: "SUMMARY", winner, reason: "words" });
          fireConfetti();
        } else {
          dispatch({
            type: "NEXT_TURN",
            nextIndex: nextIdx ?? state.activeIndex,
          });
        }
        advanceTimeoutRef.current = null;
      }, ADVANCE_DELAY_MS);
    },
    [state.stage, state.perTeam, state.activeIndex, state.roster, state.word, state.used, wordsLimit, fireConfetti]
  );

  useEffect(() => {
    if (state.stage !== "round") return;
    if (state.timerMs <= 0) {
      processAnswer("skip");
    }
  }, [state.timerMs, state.stage, processAnswer]);

  const mark = (isCorrect) => {
    if (!state.word) return;
    if (isCorrect) {
      haptic("medium");
      chime();
    } else {
      haptic("light");
    }
    processAnswer(isCorrect ? "correct" : "skip");
  };

  const restart = (keepRoster = true) => {
    haptic("light");
    progressGiven.current = false;
    if (!keepRoster) {
      const nextRoster = initialRoster(state.settings.mode);
      dispatch({ type: "SET_ROSTER", roster: nextRoster });
    }
    dispatch({ type: "RESTART" });
  };

  const canStart = state.roster.length >= 2 && wordPool.length > 0;
  const secondsLeft = Math.ceil(state.timerMs / 1000);

  return (
    <div className={`croco ${state.stage === "switch" ? "is-switch" : ""}`}>
      <div className="croco-bg" aria-hidden>
        <span className="blob one" />
        <span className="blob two" />
      </div>
      <div className="croco-wrap">
        {state.stage === "setup" && (
          <Setup
            settings={state.settings}
            roster={state.roster}
            customText={state.customText}
            onChangeSetting={(key, value) => dispatch({ type: "SET_SETTING", key, value })}
            onChangeRoster={(next) => dispatch({ type: "SET_ROSTER", roster: next })}
            onChangeCustom={(value) => dispatch({ type: "SET_CUSTOM", value })}
            onStart={handleStart}
            wordPool={wordPool}
            customWords={customWords}
            canStart={canStart}
          />
        )}

        {state.stage === "switch" && (
          <div className="switch-shell">
            <SwitchCard
              key={current?.id}
              current={current}
              mode={state.settings.mode}
              round={roundNumber}
              totalRounds={wordsTotal}
              wordsRemaining={wordsLeft}
              onBegin={handleBeginRound}
            />
          </div>
        )}

        {state.stage === "round" && (
          <Round
            current={current}
            mode={state.settings.mode}
            word={state.word}
            tip={state.tip}
            hints={state.settings.hints}
            wordsLeft={wordsLeft}
            wordsTotal={wordsTotal}
            timePct={timePct}
            seconds={secondsLeft}
            running={state.running}
            isPaused={state.isPaused}
            onPauseToggle={() =>
              dispatch({ type: state.running ? "PAUSE" : "RESUME" })
            }
            onAnswer={mark}
            onExit={goBack}
            lastResult={state.lastResult}
          />
        )}

        {state.stage === "summary" && (
          <Summary
            roster={state.roster}
            winners={state.winner || []}
            wordsPerTeam={wordsLimit}
            onRematch={() => restart(true)}
            onReset={() => restart(false)}
            onMenu={goBack}
          />
        )}
      </div>

      <Confetti
        refConfetti={(instance) => {
          confettiRef.current = instance;
        }}
        style={{ position: "fixed", inset: 0, zIndex: 20, pointerEvents: "none" }}
      />
    </div>
  );
}

function Setup({
  settings,
  roster,
  customText,
  onChangeSetting,
  onChangeRoster,
  onChangeCustom,
  onStart,
  wordPool,
  customWords,
  canStart,
}) {
  const [localRoster, setLocalRoster] = useState(roster);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const modeIsTeams = settings.mode === "teams";
  const minPlayers = 2;
  const timerPct = clamp(((settings.roundSeconds - 20) / (120 - 20)) * 100, 0, 100);
  const wordsPct = clamp(((settings.wordsPerTeam - 3) / (30 - 3)) * 100, 0, 100);
  const portalTarget = typeof document !== "undefined" ? document.body : null;

  useEffect(() => {
    setLocalRoster(roster);
  }, [roster]);

  const updateRoster = (next) => {
    setLocalRoster(next);
    onChangeRoster(next);
  };

  const changeName = (id, name) => {
    updateRoster(localRoster.map((r) => (r.id === id ? { ...r, name } : r)));
  };

  const shuffleColor = (id) => {
    updateRoster(
      localRoster.map((r) =>
        r.id === id
          ? {
              ...r,
              color: PALETTE[Math.floor(Math.random() * PALETTE.length)],
              emoji: EMOJIS[Math.floor(Math.random() * EMOJIS.length)],
            }
          : r
      )
    );
  };

  const addMember = () => {
    const idx = localRoster.length;
    updateRoster([
      ...localRoster,
      {
        id: `p-${idx}-${Date.now()}`,
        name: modeIsTeams ? `Команда ${idx + 1}` : `Игрок ${idx + 1}`,
        emoji: EMOJIS[idx % EMOJIS.length],
        color: PALETTE[idx % PALETTE.length],
        score: 0,
      },
    ]);
  };

  const removeMember = (id) => {
    if (localRoster.length <= minPlayers) return;
    updateRoster(localRoster.filter((r) => r.id !== id));
  };

  const switchMode = (mode) => {
    onChangeSetting("mode", mode);
    updateRoster(initialRoster(mode));
  };

  const adjustSetting = (key, delta, min, max) => {
    onChangeSetting(key, clamp((settings?.[key] || 0) + delta, min, max));
  };

  const settingsModal = (
    <AnimatePresence>
      {settingsOpen && (
        <motion.div
          className="croco-settings-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          onClick={() => setSettingsOpen(false)}
        >
          <motion.div
            className="croco-settings-window"
            initial={{ y: 30, opacity: 0, scale: 0.98 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 14, opacity: 0, scale: 0.98 }}
            transition={{ type: "tween", ease: "easeOut", duration: 0.22 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="settings-head">
              <div>
                <div className="settings-title">Настройки матча</div>
                <div className="muted">таймер, слова, подсказки</div>
              </div>
              <motion.button
                className="settings-close"
                whileTap={{ scale: 0.95 }}
                whileHover={{ rotate: 4 }}
                onClick={() => setSettingsOpen(false)}
                aria-label="Закрыть настройки"
              >
                <X size={16} />
              </motion.button>
            </div>

            <div className="settings-grid">
              <div className="setting-card accent">
                <div className="setting-card-top">
                  <span className="pill">Таймер</span>
                  <div className="setting-number">{settings.roundSeconds}s</div>
                </div>
                <div className="meter">
                  <div className="meter-track">
                    <div className="meter-fill" style={{ width: `${timerPct}%` }} />
                    <span className="meter-thumb" style={{ left: `${timerPct}%` }} />
                  </div>
                  <div className="meter-scale">
                    <span>20с</span>
                    <span>120с</span>
                  </div>
                </div>
                <div className="setting-actions">
                  <button onClick={() => adjustSetting("roundSeconds", -5, 20, 120)}>−5с</button>
                  <button onClick={() => adjustSetting("roundSeconds", 5, 20, 120)}>+5с</button>
                </div>
              </div>

              <div className="setting-card glass">
                <div className="setting-card-top">
                  <span className="pill">Слова на команду</span>
                  <div className="setting-number">{settings.wordsPerTeam}</div>
                </div>
                <div className="meter">
                  <div className="meter-track alt">
                    <div className="meter-fill alt" style={{ width: `${wordsPct}%` }} />
                    <span className="meter-thumb" style={{ left: `${wordsPct}%` }} />
                  </div>
                  <div className="meter-scale">
                    <span>3</span>
                    <span>30</span>
                  </div>
                </div>
              <div className="setting-actions">
                <button onClick={() => adjustSetting("wordsPerTeam", -1, 3, 30)}>−1</button>
                <button onClick={() => adjustSetting("wordsPerTeam", 1, 3, 30)}>+1</button>
              </div>
            </div>
          </div>

          <div className="settings-block">
            <div className="section-header">
              <div className="section-title">Колода слов</div>
              <span className="pill">Всего: {wordPool.length}</span>
            </div>
              <div className="pack-grid">
                {[
                  { key: "easy", label: "Лайт", desc: "простые" },
                  { key: "medium", label: "Стандарт", desc: "живые" },
                  { key: "hard", label: "Хард", desc: "сложные" },
                  { key: "mixed", label: "Микс", desc: "все" },
                  { key: "custom", label: "Свои", desc: "только импорт" },
                ].map((p) => (
                  <button
                    key={p.key}
                    className={`pack-chip ${settings.difficulty === p.key ? "pack-active" : ""}`}
                    onClick={() => onChangeSetting("difficulty", p.key)}
                  >
                    <div className="pack-top">
                      <span>{p.label}</span>
                      {settings.difficulty === p.key && <span className="pill">выбрано</span>}
                    </div>
                    <small>{p.desc}</small>
                  </button>
                ))}
              </div>
              <textarea
                className="croco-textarea"
                value={customText}
                onChange={(e) => onChangeCustom(e.target.value)}
                rows={5}
                placeholder="Каждое слово — с новой строки"
              />
              <div className="small-meta">
                {customWords.length} своих слов. Всего в колоде: {wordPool.length}.
              </div>
            </div>

            <div className="settings-toggles">
              <button
                className={`toggle-chip ${settings.hints ? "on" : ""}`}
                onClick={() => onChangeSetting("hints", !settings.hints)}
              >
                <Sparkles size={16} />
                Подсказки и табу
                <span className="toggle-dot" />
              </button>
              <button
                className={`toggle-chip ${settings.autoDifficulty ? "on" : ""}`}
                onClick={() => onChangeSetting("autoDifficulty", !settings.autoDifficulty)}
              >
                <Activity size={16} />
                Авто-сложность
                <span className="toggle-dot" />
              </button>
              <button
                className={`toggle-chip ${settings.sound ? "on" : ""}`}
                onClick={() => onChangeSetting("sound", !settings.sound)}
              >
                <Volume2 size={16} />
                Звук и вибро
                <span className="toggle-dot" />
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );

  return (
    <>
      {portalTarget ? createPortal(settingsModal, portalTarget) : settingsModal}

      <div className="panel">
        <div className="panel-head">
          <div className="eyebrow">Крокодил</div>
          <div className="panel-title">Собери состав и жми старт</div>
        </div>

        <div className="chips-row">
          <button
            className={`seg ${modeIsTeams ? "seg-active" : ""}`}
            onClick={() => switchMode("teams")}
          >
            <Users size={16} />
            Команды
          </button>
          <button
            className={`seg ${!modeIsTeams ? "seg-active" : ""}`}
            onClick={() => switchMode("solo")}
          >
            <Zap size={16} />
            Соло
          </button>
        </div>

        <div className="section-header">
          <div>
            <div className="section-title">Состав</div>
          </div>
          <motion.button
            className="settings-gear"
            onClick={() => setSettingsOpen(true)}
            whileTap={{ scale: 0.92 }}
            whileHover={{ rotate: -4 }}
            aria-label="Открыть настройки"
          >
            <span className="gear-inner">
              <Settings size={18} />
            </span>
            <span className="gear-glow" />
          </motion.button>
        </div>
        <div className="roster-list">
          {localRoster.map((item) => (
            <div className="roster-row" key={item.id}>
              <button
                className="avatar-btn"
                style={{ background: item.color }}
                onClick={() => shuffleColor(item.id)}
                aria-label="Сменить цвет"
              >
                {item.emoji}
              </button>
              <input
                value={item.name}
                onChange={(e) => changeName(item.id, e.target.value)}
                maxLength={18}
                aria-label="Имя"
              />
              <button
                className="icon-btn"
                onClick={() => removeMember(item.id)}
                disabled={localRoster.length <= minPlayers}
                aria-label="Удалить"
                title="Удалить"
              >
                <Trash2 size={16} />
              </button>
            </div>
          ))}
          <button className="ghost-line" onClick={addMember}>
            <Sparkles size={16} />
            Добавить {modeIsTeams ? "команду" : "игрока"}
          </button>
        </div>

        <motion.button className="cta" whileTap={{ scale: 0.98 }} onClick={onStart} disabled={!canStart}>
          <Sparkles size={18} />
          Старт
        </motion.button>
        {!canStart && (
          <div className="small-meta danger">
            Нужно минимум 2 участника и хотя бы одно слово.
          </div>
        )}
      </div>
    </>
  );
}

function SwitchCard({ current, mode, round, totalRounds, wordsRemaining, onBegin }) {
  return (
    <AnimatePresence mode="popLayout">
      <motion.div
        key={current?.id}
        className="card hero switch-card"
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -20 }}
        transition={{ duration: 0.2 }}
      >
        <div className="eyebrow">
          Раунд {round} • осталось {Math.max(totalRounds - round + 1, 0)}
        </div>
        <div className="hero-main">
          <div className="bubble" style={{ background: current?.color }}>
            {current?.emoji}
          </div>
          <div>
            <div className="hero-label">Ход {mode === "teams" ? "команды" : "игрока"}</div>
            <div className="hero-title">{current?.name}</div>
            <div className="hero-sub">Осталось слов: {wordsRemaining}</div>
          </div>
        </div>
        <div className="hero-cta">
          <motion.button
            className="play-circle"
            whileTap={{ scale: 0.95 }}
            whileHover={{ scale: 1.03 }}
            onClick={onBegin}
            aria-label="Погнали"
            title="Погнали"
          >
            <Play size={32} />
          </motion.button>
          <div className="hero-cta-caption">Покажи слово</div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}

function Round({
  current,
  mode,
  word,
  tip,
  hints,
  wordsLeft,
  wordsTotal,
  timePct,
  seconds,
  running,
  isPaused,
  onPauseToggle,
  onAnswer,
  onExit,
  lastResult,
}) {
  return (
    <div className="round">
      <div className="round-meta">
        <div className="bubble small" style={{ background: current?.color }}>
          {current?.emoji}
        </div>
        <div className="round-name">{current?.name}</div>
        <span className="dot" />
        <div className="round-mode">{mode === "teams" ? "Команды" : "Соло"}</div>
        <span className="pill">Слова: {wordsTotal - wordsLeft + 1}/{wordsTotal}</span>
        {onExit && (
          <motion.button
            className="round-exit"
            whileTap={{ scale: 0.97 }}
            whileHover={{ translateY: -1 }}
            onClick={onExit}
          >
            <X size={14} />
            Выйти
          </motion.button>
        )}
      </div>

      <TimerPacman pct={timePct} seconds={seconds} running={running} current={current} />

      <WordCard word={word} tip={tip} hints={hints} lastResult={lastResult} />

      <div className="actions-grid">
        <motion.button
          className="option-btn"
          whileTap={{ scale: 0.98 }}
          onClick={() => onAnswer(true)}
          disabled={!word}
        >
          <Check size={18} />
          Угадали
        </motion.button>
        <motion.button
          className="option-btn secondary"
          whileTap={{ scale: 0.98 }}
          onClick={() => onAnswer(false)}
          disabled={!word}
        >
          <RefreshCw size={18} />
          Пропуск
        </motion.button>
        <motion.button
          className="option-btn ghost"
          whileTap={{ scale: 0.98 }}
          onClick={onPauseToggle}
        >
          {isPaused ? (
            <>
              <Play size={16} /> Продолжить
            </>
          ) : (
            <>
              <Pause size={16} /> Пауза
            </>
          )}
        </motion.button>
      </div>

      {isPaused && (
        <div className="pause">
          <div className="pause-card">
            <Pause size={20} />
            <div>Пауза</div>
            <motion.button className="cta wide" whileTap={{ scale: 0.97 }} onClick={onPauseToggle}>
              Продолжить
            </motion.button>
          </div>
        </div>
      )}
    </div>
  );
}

function TimerPacman({ pct, seconds, running, current }) {
  const safePct = clamp(pct ?? 0, 0, 1);
  const remainingPct = Math.round(safePct * 100);
  const trackInsetPct = 4;
  const travelPct = 100 - trackInsetPct * 2;
  const pacLeftPct = trackInsetPct + (remainingPct * travelPct) / 100;
  const remainingWidthPct = Math.max(0, pacLeftPct - trackInsetPct);
  const pacLeft = `${pacLeftPct}%`;

  const label =
    remainingPct <= 0 ? "время вышло" : running ? "время идёт" : "пауза";

  return (
    <div className="pacman-timer">
      <div className="pacman-meta">
        <div className="timer-num">{seconds}s</div>
        <div className="timer-sub">{label}</div>
      </div>

      <div
        className={`pacman-track ${running ? "is-running" : "is-paused"}`}
        aria-hidden
      >
        {current?.emoji && (
          <div
            className="pacman-team-icon"
            style={{
              background: current?.color || "#111826",
              left: `calc(${trackInsetPct}% - 14px)`,
            }}
            title={current?.name}
          >
            {current?.emoji}
          </div>
        )}

        <div
          className="pacman-remaining"
          style={{ left: `${trackInsetPct}%`, width: `${remainingWidthPct}%` }}
        />

        <motion.div
          className={`pacman ${running ? "is-running" : "is-paused"}`}
          style={{ left: pacLeft }}
          animate={{ left: pacLeft }}
          transition={{ duration: 0.2, ease: "easeOut" }}
        >
          <div className="pacman-trail" />
          <div className="pacman-body" />
          <div className="pacman-eye" />
        </motion.div>
      </div>
    </div>
  );
}

function WordCard({ word, tip, hints, lastResult }) {
  return (
    <motion.div
      className="word-card"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      layout
    >
      <div className="word-top">
        <span className="pill">
          <Activity size={14} /> {word?.level || "..."}
        </span>
        {lastResult && (
          <span className={`pill ${lastResult === "correct" ? "pill-success" : "pill-warn"}`}>
            {lastResult === "correct" ? "зачёт" : "пропуск"}
          </span>
        )}
      </div>
      <div className="word-main">{word?.word || "Готовимся..."}</div>
      <div className="word-sub">Покажи без слов, звуков и букв. Жестикулируй крупно.</div>
      {hints && tip && (
        <div className="hint-bubble">
          <Sparkles size={14} />
          {tip}
        </div>
      )}
    </motion.div>
  );
}

function Summary({ roster, winners, wordsPerTeam, onRematch, onReset, onMenu }) {
  const topScore = Math.max(...roster.map((r) => r.score));
  return (
    <motion.div
      className="panel"
      initial={{ opacity: 0, y: 30 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
    >
      <div className="panel-head">
        <div className="eyebrow">Матч окончен</div>
        <div className="panel-title">Слов на команду: {wordsPerTeam}</div>
      </div>

      <div className="winners">
        <Trophy size={20} />
        <div>Победили: {winners.map((w) => w.name).join(", ") || "—"}</div>
      </div>

      <div className="score-table">
        {roster
          .slice()
          .sort((a, b) => b.score - a.score)
          .map((r) => (
            <div className="score-row" key={r.id}>
              <div className="bubble small" style={{ background: r.color }}>
                {r.emoji}
              </div>
              <div className="score-name">{r.name}</div>
              <div className={`score-value ${r.score === topScore ? "lead" : ""}`}>{r.score}</div>
            </div>
          ))}
      </div>

      <div className="row summary-actions">
        <motion.button className="btn secondary wide" whileTap={{ scale: 0.97 }} onClick={onRematch}>
          <RefreshCw size={16} />
          Реванш
        </motion.button>
        <motion.button className="btn primary wide" whileTap={{ scale: 0.97 }} onClick={onReset}>
          <Wand2 size={16} />
          Новый состав
        </motion.button>
      </div>
      <button className="ghost-btn wide" onClick={onMenu}>
        В меню
      </button>
    </motion.div>
  );
}
