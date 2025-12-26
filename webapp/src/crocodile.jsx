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
  PACKS,
  removeCustomWordAt,
} from "./crocodile-helpers";
import crocoHead from "../crocohead.png";
import crocoHandsLeft from "../crocohandsleft.png";
import crocoHandsRight from "../crocohandsright.png";
import crocoLegs from "../crocolegs.png";
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

const useHaptics = (enabled) => {
  const fire = useCallback((style = "light") => {
    if (!enabled) return;
    const tg = window?.Telegram?.WebApp;
    try {
      tg?.HapticFeedback?.impactOccurred?.(style);
    } catch {
      /* noop */
    }
  }, [enabled]);
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
        streaks: roster.map(() => 0),
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
        streaks: action.roster.map(() => 0),
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
        streaks: roster.map(() => 0),
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
      const nextStreaks =
        state.streaks && state.streaks.length
          ? state.streaks.map((value, idx) =>
              idx === state.activeIndex
                ? action.kind === "correct"
                  ? value + 1
                  : 0
                : value
            )
          : state.roster.map((_, idx) =>
              idx === state.activeIndex ? (action.kind === "correct" ? 1 : 0) : 0
            );
      return {
        ...state,
        roster: action.roster || state.roster,
        perTeam: action.perTeam || state.perTeam,
        used: action.used || state.used,
        streaks: nextStreaks,
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
        streaks: state.roster.map(() => 0),
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
      streaks: roster.map(() => 0),
      stage: "setup",
      activeIndex: 0,
      timerMs: (savedSettings?.roundSeconds || DEFAULT_SETTINGS.roundSeconds) * 1000,
      running: false,
      isPaused: false,
      word: null,
      used: [],
      lastResult: null,
      winner: [],
      tip: TIPS[0],
      customText: String(savedCustom || ""),
      reason: null,
    };
  });
  const [lastStage, setLastStage] = useState("setup");

  const haptic = useHaptics(state.settings.sound);
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
  const wordsRemaining = Math.max(0, wordsLimit - (state.perTeam[state.activeIndex] ?? 0));
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
    if (state.stage !== "switch") {
      setLastStage(state.stage);
    }
  }, [state.stage]);

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
      const activeMatch = state.stage === "round" || state.stage === "switch";
      if (!activeMatch) {
        goBack?.();
        return;
      }
      const shouldLeave = window.confirm("Матч не окончен. Выйти?");
      if (shouldLeave) {
        goBack?.();
        return;
      }
      if (state.stage === "round" && state.running) {
        dispatch({ type: "PAUSE" });
      }
    });
    return () => setBackHandler(null);
  }, [setBackHandler, goBack, state.stage, state.running]);

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
    const currentStreak = state.streaks?.[state.activeIndex] ?? 0;
    const next = pickWord(wordPool, state.used, currentStreak, state.settings.autoDifficulty);
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
  const isSwitching = state.stage === "switch";
  const visibleStage = isSwitching ? lastStage : state.stage;

  return (
    <div className="croco" data-stage={visibleStage}>
      <div className="croco-bg" aria-hidden>
        <span className="blob one" />
        <span className="blob two" />
      </div>
      <div className="croco-wrap pt-safe">
        {visibleStage === "setup" && (
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

        {visibleStage === "round" && (
          <Round
            current={current}
            word={state.word}
            wordsLeft={wordsLeft}
            wordsTotal={wordsTotal}
            timePct={timePct}
            seconds={secondsLeft}
            running={state.running}
            isPaused={state.isPaused}
            isMasked={isSwitching}
            onPauseToggle={() =>
              dispatch({ type: state.running ? "PAUSE" : "RESUME" })
            }
            onAnswer={mark}
            showTimeoutPrompt={timeoutPrompt}
            onTimeoutAnswer={handleTimeoutAnswer}
          />
        )}

        {visibleStage === "summary" && (
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

      <AnimatePresence>
        {isSwitching && (
          <motion.div
            className="switch-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.14, ease: "easeOut" }}
          >
            <motion.div
              className="switch-shell"
              initial={{ scale: 0.97, opacity: 0, y: 8 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.98, opacity: 0, y: 6 }}
              transition={{ type: "tween", ease: "easeOut", duration: 0.18 }}
            >
              <SwitchCard
                key={current?.id}
                current={current}
                mode={state.settings.mode}
                round={roundNumber}
                totalRounds={wordsTotal}
                wordsRemaining={wordsRemaining}
                onBegin={handleBeginRound}
              />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

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
  const [activeSettings, setActiveSettings] = useState("match");
  const selectedPacks = useMemo(
    () => normalizePacks(settings.difficulty, customWords.length > 0),
    [settings.difficulty, customWords.length]
  );
  const [customInput, setCustomInput] = useState("");
  const packCounts = useMemo(
    () => ({
      easy: PACKS.easy.length,
      medium: PACKS.medium.length,
      hard: PACKS.hard.length,
      custom: customWords.length,
    }),
    [customWords.length]
  );
  const modeIsTeams = settings.mode === "teams";
  const minPlayers = 2;
  const timerPct = clamp(((settings.roundSeconds - 20) / (120 - 20)) * 100, 0, 100);
  const wordsPct = clamp(((settings.wordsPerTeam - 3) / (30 - 3)) * 100, 0, 100);
  const portalTarget = typeof document !== "undefined" ? document.body : null;

  useEffect(() => {
    setLocalRoster(roster);
  }, [roster]);

  useEffect(() => {
    if (settingsOpen) setActiveSettings("match");
  }, [settingsOpen]);

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
  };

  const handleAddCustom = () => {
    const nextText = appendCustomWords(customText, customInput);
    if (nextText === (customText || "")) {
      setCustomInput("");
      return;
    }
    onChangeCustom(nextText);
    setCustomInput("");
    if (!selectedPacks.includes("custom")) {
      togglePack("custom");
    }
  };

  const handleRemoveCustom = (index) => {
    const nextText = removeCustomWordAt(customText, index);
    if (nextText !== (customText || "")) {
      onChangeCustom(nextText);
    }
  };

  const updateSettingNumber = (key, value, min, max) => {
    if (Number.isNaN(value)) return;
    onChangeSetting(key, clamp(value, min, max));
  };

  const resetSettings = () => {
    onChangeSetting("roundSeconds", DEFAULT_SETTINGS.roundSeconds);
    onChangeSetting("wordsPerTeam", DEFAULT_SETTINGS.wordsPerTeam);
    onChangeSetting("difficulty", DEFAULT_SETTINGS.difficulty);
    onChangeSetting("autoDifficulty", DEFAULT_SETTINGS.autoDifficulty);
    onChangeSetting("hints", DEFAULT_SETTINGS.hints);
    onChangeSetting("sound", DEFAULT_SETTINGS.sound);
    onChangeCustom("");
    setCustomInput("");
  };

  const packOptions = [
    { key: "easy", label: "Лайт", meta: "Разогрев, простые слова" },
    { key: "medium", label: "Стандарт", meta: "Баланс сложности" },
    { key: "hard", label: "Хард", meta: "Для опытных" },
    {
      key: "custom",
      label: "Свои",
      meta: customWords.length ? "Ваши слова" : "Добавь свои",
    },
  ];

  const showCustom = selectedPacks.includes("custom") || customWords.length > 0;

  const settingsModal = (
    <AnimatePresence>
      {settingsOpen && (
        <motion.div
          className="croco-settings-overlay croco-settings-overlay--crocodile"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          onClick={() => setSettingsOpen(false)}
        >
          <motion.div
            className="croco-settings-window croco-settings-window--crocodile"
            initial={{ y: 30, opacity: 0, scale: 0.98 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 14, opacity: 0, scale: 0.98 }}
            transition={{ type: "tween", ease: "easeOut", duration: 0.22 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="croco-settings-shell">
              <div className="croco-settings-head">
                <div className="croco-settings-head-copy">
                  <div className="croco-settings-title">Настройки</div>
                  <div className="croco-settings-subtitle">Матч / Колода / Эффекты</div>
                </div>
                <motion.button
                  className="croco-settings-close"
                  whileTap={{ scale: 0.95 }}
                  whileHover={{ rotate: 4 }}
                  onClick={() => setSettingsOpen(false)}
                  aria-label="Закрыть настройки"
                >
                  <X size={16} />
                </motion.button>
              </div>

              <div className="croco-settings-body">
                <nav className="croco-settings-nav" aria-label="Разделы">
                  <button
                    className={`croco-settings-tab ${activeSettings === "match" ? "is-active" : ""}`}
                    onClick={() => setActiveSettings("match")}
                    aria-pressed={activeSettings === "match"}
                    aria-controls="croco-settings-match"
                  >
                    <span className="croco-settings-tab-ico">
                      <Activity size={16} />
                    </span>
                    <span className="croco-settings-tab-text">
                      <span className="croco-settings-tab-title">Матч</span>
                      <span className="croco-settings-tab-sub">Темп и таймер</span>
                    </span>
                  </button>
                  <button
                    className={`croco-settings-tab ${activeSettings === "words" ? "is-active" : ""}`}
                    onClick={() => setActiveSettings("words")}
                    aria-pressed={activeSettings === "words"}
                    aria-controls="croco-settings-words"
                  >
                    <span className="croco-settings-tab-ico">
                      <Wand2 size={16} />
                    </span>
                    <span className="croco-settings-tab-text">
                      <span className="croco-settings-tab-title">Колода</span>
                      <span className="croco-settings-tab-sub">Пакеты и слова</span>
                    </span>
                  </button>
                  <button
                    className={`croco-settings-tab ${activeSettings === "effects" ? "is-active" : ""}`}
                    onClick={() => setActiveSettings("effects")}
                    aria-pressed={activeSettings === "effects"}
                    aria-controls="croco-settings-effects"
                  >
                    <span className="croco-settings-tab-ico">
                      <Volume2 size={16} />
                    </span>
                    <span className="croco-settings-tab-text">
                      <span className="croco-settings-tab-title">Эффекты</span>
                      <span className="croco-settings-tab-sub">Звук и авто-сложность</span>
                    </span>
                  </button>
                </nav>

                <div className="croco-settings-content">
                  <section
                    id="croco-settings-match"
                    className={`croco-settings-section ${activeSettings === "match" ? "is-active" : ""}`}
                  >
                    <div className="croco-settings-section-head">
                      <div>
                        <div className="croco-settings-section-title">Ритм матча</div>
                        <div className="croco-settings-section-sub">Таймер и лимит слов</div>
                      </div>
                      <div className="croco-settings-kpi">
                        <span className="croco-settings-kpi-label">Сейчас</span>
                        <span className="croco-settings-kpi-value">
                          {settings.roundSeconds}s / {settings.wordsPerTeam} слов
                        </span>
                      </div>
                    </div>

                    <div className="croco-settings-cards">
                      <div className="croco-setting-card is-accent">
                        <div className="croco-setting-row">
                          <div className="croco-setting-label">Время раунда</div>
                          <div className="croco-setting-value">
                            <input
                              type="number"
                              min={20}
                              max={120}
                              step={5}
                              inputMode="numeric"
                              value={settings.roundSeconds}
                              onChange={(e) =>
                                updateSettingNumber("roundSeconds", Number(e.target.value), 20, 120)
                              }
                              className="croco-setting-input"
                              aria-label="Время раунда"
                            />
                            <span className="croco-setting-unit">сек</span>
                          </div>
                        </div>
                        <input
                          type="range"
                          min={20}
                          max={120}
                          step={5}
                          value={settings.roundSeconds}
                          onChange={(e) =>
                            onChangeSetting("roundSeconds", Number(e.target.value))
                          }
                          className="croco-range"
                          style={{ "--range-progress": `${timerPct}%` }}
                        />
                        <div className="croco-range-scale">
                          <span>20</span>
                          <span>120</span>
                        </div>
                      </div>

                      <div className="croco-setting-card">
                        <div className="croco-setting-row">
                          <div className="croco-setting-label">Слова на команду</div>
                          <div className="croco-setting-value">
                            <input
                              type="number"
                              min={3}
                              max={30}
                              step={1}
                              inputMode="numeric"
                              value={settings.wordsPerTeam}
                              onChange={(e) =>
                                updateSettingNumber("wordsPerTeam", Number(e.target.value), 3, 30)
                              }
                              className="croco-setting-input"
                              aria-label="Слова на команду"
                            />
                            <span className="croco-setting-unit">шт</span>
                          </div>
                        </div>
                        <input
                          type="range"
                          min={3}
                          max={30}
                          step={1}
                          value={settings.wordsPerTeam}
                          onChange={(e) =>
                            onChangeSetting("wordsPerTeam", Number(e.target.value))
                          }
                          className="croco-range"
                          style={{ "--range-progress": `${wordsPct}%` }}
                        />
                        <div className="croco-range-scale">
                          <span>3</span>
                          <span>30</span>
                        </div>
                      </div>
                    </div>
                    <div className="croco-settings-info">
                      <span className="croco-info-dot" aria-hidden />
                      Чем меньше время, тем динамичнее раунд.
                    </div>
                  </section>

                  <section
                    id="croco-settings-words"
                    className={`croco-settings-section ${activeSettings === "words" ? "is-active" : ""}`}
                  >
                    <div className="croco-settings-section-head">
                      <div>
                        <div className="croco-settings-section-title">Колода слов</div>
                        <div className="croco-settings-section-sub">Пакеты и свои слова</div>
                      </div>
                      <div className="croco-settings-total">
                        <span className="croco-settings-total-label">Активно</span>
                        <span className="croco-settings-total-value">{wordPool.length}</span>
                      </div>
                    </div>

                    <div className="croco-settings-pack-grid">
                      {packOptions.map((p) => {
                        const active = selectedPacks.includes(p.key);
                        const count = packCounts[p.key] ?? 0;
                        return (
                          <button
                            key={p.key}
                            className={`croco-pack-card${active ? " is-active" : ""}${
                              p.key === "custom" && !count ? " is-empty" : ""
                            }`}
                            onClick={() => togglePack(p.key)}
                            aria-pressed={active}
                          >
                            <div className="croco-pack-top">
                              <span className="croco-pack-sticker" aria-hidden>
                                {PACK_STICKERS[p.key]}
                              </span>
                              <span className="croco-pack-text">
                                <span className="croco-pack-title">{p.label}</span>
                                <span className="croco-pack-meta">{p.meta}</span>
                              </span>
                              <span className="croco-pack-count">{count}</span>
                            </div>
                            {active && (
                              <span className="croco-pack-check" aria-hidden>
                                <Check size={14} />
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>

                    {showCustom && (
                      <div className="croco-custom-shell">
                        <div className="croco-custom-head">
                          <div className="croco-custom-title">Свои слова</div>
                          <div className="croco-custom-sub">
                            Каждое слово добавляется отдельно
                          </div>
                        </div>
                        <div className="croco-custom-row">
                          <input
                            className="croco-custom-input"
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
                            className="croco-custom-add"
                            whileTap={{ scale: 0.96 }}
                            onClick={handleAddCustom}
                            aria-label="Добавить слово"
                          >
                            +
                          </motion.button>
                        </div>
                        <div className="croco-custom-chips">
                          {customWords.map((word, idx) => (
                            <span key={`${word}-${idx}`} className="croco-custom-chip">
                              <span className="croco-chip-word">{word}</span>
                              <button
                                className="croco-chip-remove"
                                onClick={() => handleRemoveCustom(idx)}
                                aria-label={`Удалить слово ${word}`}
                              >
                                <X size={12} />
                              </button>
                            </span>
                          ))}
                          {!customWords.length && (
                            <div className="croco-custom-empty">Добавь слова через +</div>
                          )}
                        </div>
                        <div className="croco-custom-meta">
                          {customWords.length} своих слов. В активной колоде: {wordPool.length}.
                        </div>
                      </div>
                    )}
                  </section>

                  <section
                    id="croco-settings-effects"
                    className={`croco-settings-section ${activeSettings === "effects" ? "is-active" : ""}`}
                  >
                    <div className="croco-settings-section-head">
                      <div>
                        <div className="croco-settings-section-title">Эффекты</div>
                        <div className="croco-settings-section-sub">Звук и динамика</div>
                      </div>
                    </div>

                    <div className="croco-toggle-grid">
                      <button
                        className={`croco-toggle ${settings.autoDifficulty ? "is-on" : ""}`}
                        onClick={() => onChangeSetting("autoDifficulty", !settings.autoDifficulty)}
                        aria-pressed={settings.autoDifficulty}
                      >
                        <div className="croco-toggle-top">
                          <Activity size={16} />
                          <div className="croco-toggle-title">Авто-сложность</div>
                        </div>
                        <div className="croco-toggle-sub">
                          Чем дольше серия, тем сложнее слова.
                        </div>
                        <span className="croco-toggle-dot" />
                      </button>
                      <button
                        className={`croco-toggle ${settings.sound ? "is-on" : ""}`}
                        onClick={() => onChangeSetting("sound", !settings.sound)}
                        aria-pressed={settings.sound}
                      >
                        <div className="croco-toggle-top">
                          <Volume2 size={16} />
                          <div className="croco-toggle-title">Звук и вибро</div>
                        </div>
                        <div className="croco-toggle-sub">
                          Эффекты таймера и успеха раунда.
                        </div>
                        <span className="croco-toggle-dot" />
                      </button>
                    </div>
                  </section>
                </div>
              </div>

              <div className="croco-settings-footer">
                <button className="croco-settings-reset" onClick={resetSettings}>
                  <RefreshCw size={16} />
                  Сбросить
                </button>
                <div className="croco-settings-footnote">Сохраняется автоматически</div>
                <motion.button
                  className="croco-settings-done"
                  whileTap={{ scale: 0.97 }}
                  onClick={() => setSettingsOpen(false)}
                >
                  Готово
                </motion.button>
              </div>
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
        <div className="setup-panel-wrap">
          <div className="croco-head" aria-hidden="true">
            <img src={crocoHead} alt="" />
          </div>
          <div className="croco-hands hold-panel" aria-hidden="true">
            <img src={crocoHandsLeft} alt="" className="hand hand-left" />
            <img src={crocoHandsRight} alt="" className="hand hand-right" />
          </div>
          <div className="croco-legs" aria-hidden="true">
            <img src={crocoLegs} alt="" />
          </div>

          <div className="panel setup-panel">
            <div className="setup-content">
              <div className="panel-head with-gear">
                <div>
                  <div className="eyebrow">Крокодил</div>
                  <div className="panel-title">Собери состав и жми старт</div>
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

              <div className="roster-shell">
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
  word,
  wordsLeft,
  wordsTotal,
  timePct,
  seconds,
  running,
  isPaused,
  isMasked = false,
  onPauseToggle,
  onAnswer,
  showTimeoutPrompt,
  onTimeoutAnswer,
}) {
  const safeWordsTotal = Math.max(1, Number(wordsTotal) || 1);
  const currentWordNumber = Math.min(
    safeWordsTotal,
    Math.max(1, safeWordsTotal - Math.max(0, wordsLeft) + 1)
  );
  const roundProgress = `${currentWordNumber}/${safeWordsTotal}`;

  return (
    <div className="round">
      <div className="round-stack">
        <div className="round-team" aria-live="polite">
          <span
            className="round-team-badge"
            style={{ background: current?.color || "#111826" }}
            aria-hidden
          >
            {current?.emoji || "🦎"}
          </span>
          <span className="round-team-name">{current?.name || "Команда"}</span>
        </div>
        <TimerPacman
          pct={timePct}
          seconds={seconds}
          running={running}
          current={current}
          roundProgress={roundProgress}
          dimmed={showTimeoutPrompt}
          onTogglePause={onPauseToggle}
        />

        <WordCard word={word} masked={isMasked} />
      </div>

      <div className="actions-bar">
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
        </div>
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

function TimerPacman({
  pct,
  seconds,
  running,
  current,
  roundProgress,
  dimmed = false,
  onTogglePause,
}) {
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
        <div className="timer-stack">
          <div className="timer-num">{seconds}s</div>
          <div className="timer-sub">{label}</div>
        </div>
        <div className="pacman-round round-pill">{`Слова ${roundProgress}`}</div>
        <motion.button
          className={`pacman-pause ${running ? "" : "is-paused"}`}
          whileTap={{ scale: 0.9 }}
          onClick={() => onTogglePause?.()}
          aria-label={running ? "Поставить на паузу" : "Возобновить"}
        >
          {running ? <Pause size={16} /> : <Play size={16} />}
        </motion.button>
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

function WordCard({ word, masked = false }) {
  const mainText = masked ? "Смена хода" : word?.word || "Готовимся...";

  return (
    <motion.div
      className={`croco-word-card${masked ? " is-masked" : ""}`}
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      layout
    >
      <div className="croco-word-visual" aria-hidden="true">
        <img src={crocoHead} alt="" className="croco-word-visual-img" />
      </div>
      <div className="croco-word-footer">
        <div className="croco-word-main">{mainText}</div>
      </div>
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
