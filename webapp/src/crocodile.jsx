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
import {
  appendCustomWords,
  buildWordPool,
  normalizePacks,
  parseWords,
  removeCustomWordAt,
} from "./crocodile-helpers";
import crocoHead from "../crocohead.png";
import crocoHands from "../crocohands.png";
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
  difficulty: ["easy", "medium", "hard"], // выбранные паки: easy | medium | hard | custom
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

const PACK_STICKERS = {
  easy: "🌱",
  medium: "⚡️",
  hard: "🔥",
  custom: "🎨",
};

const ADVANCE_DELAY_MS = 1500;

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
  const { short: shortBeep, long: longBeep } = useBeep(state.settings.sound);
  const progressGiven = useRef(false);
  const advanceTimeoutRef = useRef(null);
  const confettiRef = useRef(null);
  const [timeoutPrompt, setTimeoutPrompt] = useState(false);
  const lastBeepSecondRef = useRef(null);

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
    if (state.stage !== "round") {
      setTimeoutPrompt(false);
      lastBeepSecondRef.current = null;
    }
  }, [state.stage]);

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
    (kind, options = {}) => {
      const immediate = options.immediate || timeoutPrompt;
      if (state.stage !== "round") return;
      if (advanceTimeoutRef.current) {
        clearTimeout(advanceTimeoutRef.current);
        advanceTimeoutRef.current = null;
      }
      setTimeoutPrompt(false);
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
      const proceed = () => {
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
      };

      if (immediate) {
        proceed();
      } else {
        advanceTimeoutRef.current = setTimeout(proceed, ADVANCE_DELAY_MS);
      }
    },
    [state.stage, state.perTeam, state.activeIndex, state.roster, state.word, state.used, wordsLimit, fireConfetti, timeoutPrompt]
  );

  useEffect(() => {
    if (state.stage !== "round" || !state.running) return;
    if (state.timerMs <= 0 && !timeoutPrompt) {
      dispatch({ type: "STOP_TIMER" });
      setTimeoutPrompt(true);
    }
  }, [state.timerMs, state.stage, state.running, timeoutPrompt]);

  useEffect(() => {
    if (state.stage !== "round" || !state.running) {
      lastBeepSecondRef.current = null;
      return;
    }
    const secs = Math.ceil(state.timerMs / 1000);
    if (secs <= 10 && secs > 0) {
      if (lastBeepSecondRef.current !== secs) {
        lastBeepSecondRef.current = secs;
        if (secs === 1) longBeep();
        else shortBeep();
      }
    } else if (secs > 10) {
      lastBeepSecondRef.current = null;
    }
  }, [state.timerMs, state.stage, state.running, shortBeep, longBeep]);

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

  const handleTimeoutAnswer = (isCorrect) => {
    setTimeoutPrompt(false);
    processAnswer(isCorrect ? "correct" : "skip", { immediate: true });
  };

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
            showTimeoutPrompt={timeoutPrompt}
            onTimeoutAnswer={handleTimeoutAnswer}
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
  const selectedPacks = useMemo(
    () => normalizePacks(settings.difficulty, customWords.length > 0),
    [settings.difficulty, customWords.length]
  );
  const [customExpanded, setCustomExpanded] = useState(selectedPacks.includes("custom"));
  const [customInput, setCustomInput] = useState("");
  const modeIsTeams = settings.mode === "teams";
  const minPlayers = 2;
  const timerPct = clamp(((settings.roundSeconds - 20) / (120 - 20)) * 100, 0, 100);
  const wordsPct = clamp(((settings.wordsPerTeam - 3) / (30 - 3)) * 100, 0, 100);
  const portalTarget = typeof document !== "undefined" ? document.body : null;

  useEffect(() => {
    setLocalRoster(roster);
  }, [roster]);

  useEffect(() => {
    setCustomExpanded(selectedPacks.includes("custom"));
  }, [selectedPacks]);

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

  const togglePack = (key) => {
    const next = selectedPacks.includes(key)
      ? selectedPacks.length > 1
        ? selectedPacks.filter((p) => p !== key)
        : selectedPacks
      : [...selectedPacks, key];
    onChangeSetting("difficulty", next);
    if (key === "custom") setCustomExpanded(next.includes("custom"));
  };

  const handleAddCustom = () => {
    const nextText = appendCustomWords(customText, customInput);
    if (nextText === (customText || "")) {
      setCustomInput("");
      return;
    }
    onChangeCustom(nextText);
    setCustomInput("");
    setCustomExpanded(true);
  };

  const handleRemoveCustom = (index) => {
    const nextText = removeCustomWordAt(customText, index);
    if (nextText !== (customText || "")) {
      onChangeCustom(nextText);
    }
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
                <div className="settings-slider-row">
                  <input
                    type="range"
                    min={20}
                    max={120}
                    step={5}
                    value={settings.roundSeconds}
                    onChange={(e) => onChangeSetting("roundSeconds", Number(e.target.value))}
                    className="settings-slider"
                    style={{ "--slider-progress": `${timerPct}%` }}
                  />
                  <div className="meter-scale">
                    <span>20с</span>
                    <span>120с</span>
                  </div>
                </div>
              </div>

              <div className="setting-card glass">
                <div className="setting-card-top">
                  <span className="pill">Слова на команду</span>
                  <div className="setting-number">{settings.wordsPerTeam}</div>
                </div>
                <div className="settings-slider-row">
                  <input
                    type="range"
                    min={3}
                    max={30}
                    step={1}
                    value={settings.wordsPerTeam}
                    onChange={(e) => onChangeSetting("wordsPerTeam", Number(e.target.value))}
                    className="settings-slider"
                    style={{ "--slider-progress": `${wordsPct}%` }}
                  />
                  <div className="meter-scale">
                    <span>3</span>
                    <span>30</span>
                  </div>
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
                  { key: "easy", label: "Лайт" },
                  { key: "medium", label: "Стандарт" },
                  { key: "hard", label: "Хард" },
                  { key: "custom", label: "Свои" },
                ].map((p) => {
                  const active = selectedPacks.includes(p.key);
                  return (
                    // несколько паков можно выбрать одновременно
                    <button
                      key={p.key}
                      className={`pack-chip ${active ? "pack-active" : ""}`}
                      onClick={() => togglePack(p.key)}
                      aria-pressed={active}
                    >
                      <div className="pack-top">
                        <span className="pack-sticker" aria-hidden>{PACK_STICKERS[p.key]}</span>
                        <span className="pack-label">{p.label}</span>
                        {active && (
                          <span className="pill check-pill" aria-label="Пак выбран">
                            <Check size={14} />
                          </span>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
              {customExpanded && (
                <div className="custom-block">
                  <div className="custom-add-row">
                    <input
                      className="croco-textarea custom-input"
                      value={customInput}
                      onChange={(e) => setCustomInput(e.target.value)}
                      placeholder="Новое слово"
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          handleAddCustom();
                        }
                      }}
                    />
                    <motion.button
                      className="add-chip"
                      whileTap={{ scale: 0.96 }}
                      onClick={handleAddCustom}
                      aria-label="Добавить слово"
                    >
                      +
                    </motion.button>
                  </div>
                  <div className="custom-chips">
                    {customWords.map((word, idx) => (
                      <span key={`${word}-${idx}`} className="custom-chip">
                        <span className="chip-word">{word}</span>
                        <button
                          className="chip-remove"
                          onClick={() => handleRemoveCustom(idx)}
                          aria-label={`Удалить слово ${word}`}
                        >
                          <X size={12} />
                        </button>
                      </span>
                    ))}
                    {!customWords.length && <div className="custom-empty">Добавь слова через +</div>}
                  </div>
                  <div className="small-meta">
                    {customWords.length} своих слов. Всего в колоде: {wordPool.length}. Каждое слово добавляется отдельной кнопкой.
                  </div>
                </div>
              )}
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

      <div className="setup-shell">
        <div className="croco-head" aria-hidden="true">
          <img src={crocoHead} alt="" />
        </div>

        <div className="panel setup-panel">
          <div className="setup-content">
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

            <div className="roster-shell">
              <div className="croco-hands" aria-hidden="true">
                <img src={crocoHands} alt="" />
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
        </div>
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
  showTimeoutPrompt,
  onTimeoutAnswer,
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

      <TimerPacman
        pct={timePct}
        seconds={seconds}
        running={running}
        current={current}
        dimmed={showTimeoutPrompt}
      />

      <WordCard word={word} tip={tip} hints={hints} lastResult={lastResult} />

      <div className="actions-grid">
        <motion.button
          className="option-btn"
          whileTap={{ scale: 0.98 }}
          onClick={() => onAnswer(true)}
          disabled={!word || showTimeoutPrompt}
        >
          <Check size={18} />
          Угадали
        </motion.button>
        <motion.button
          className="option-btn secondary"
          whileTap={{ scale: 0.98 }}
          onClick={() => onAnswer(false)}
          disabled={!word || showTimeoutPrompt}
        >
          <RefreshCw size={18} />
          Пропуск
        </motion.button>
        <motion.button
          className="option-btn ghost"
          whileTap={{ scale: 0.98 }}
          onClick={onPauseToggle}
          disabled={showTimeoutPrompt}
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

      {showTimeoutPrompt && (
        <div className="timeout-overlay">
          <div className="timeout-card">
            <div className="timeout-title">Время вышло</div>
            <div className="timeout-sub">Команда успела угадать?</div>
            <div className="timeout-actions">
              <motion.button
                className="option-btn"
                whileTap={{ scale: 0.98 }}
                onClick={() => onTimeoutAnswer(true)}
              >
                <Check size={18} />
                Угадали
              </motion.button>
              <motion.button
                className="option-btn secondary"
                whileTap={{ scale: 0.98 }}
                onClick={() => onTimeoutAnswer(false)}
              >
                <RefreshCw size={18} />
                Не угадали
              </motion.button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function TimerPacman({ pct, seconds, running, current, dimmed = false }) {
  const safePct = clamp(pct ?? 0, 0, 1);
  const remainingPct = Math.round(safePct * 100);
  const trackInsetPct = 4;
  const travelPct = 100 - trackInsetPct * 2;
  const pacLeftPct = trackInsetPct + (remainingPct * travelPct) / 100;
  const remainingWidthPct = Math.max(0, pacLeftPct - trackInsetPct);
  const pacLeft = `${pacLeftPct}%`;

  const label =
    remainingPct <= 0 ? "время вышло" : running ? "время идёт" : "пауза";

  const pacmanClass = `pacman ${running ? "is-running" : "is-paused"} ${dimmed ? "is-dimmed" : ""}`;
  const trackClass = `pacman-track ${running ? "is-running" : "is-paused"} ${dimmed ? "is-dimmed" : ""}`;

  return (
    <div className="pacman-timer">
      <div className="pacman-meta">
        <div className="timer-num">{seconds}s</div>
        <div className="timer-sub">{label}</div>
      </div>

      <div className={trackClass} aria-hidden>
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
          className={pacmanClass}
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
