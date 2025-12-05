import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import {
  Award,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Sparkles,
  Trophy,
  Trash2,
  Users,
  Zap,
  Eye,
  EyeOff,
  Settings,
  X,
  Volume2,
} from "lucide-react";
import "./quiz.css";

const STORAGE_KEYS = {
  settings: "pt_quiz_settings_v1",
  roster: "pt_quiz_roster_v1",
};

const PALETTE = [
  "#8b5cf6",
  "#22d3ee",
  "#fb7185",
  "#10b981",
  "#f59e0b",
  "#6366f1",
  "#ec4899",
  "#06b6d4",
];

const EMOJIS = ["⚡️", "🔥", "🌊", "🍀", "🌟", "🛰️", "🎯", "🧠", "🚀", "💎"];

const DEFAULT_SETTINGS = {
  mode: "teams", // teams | solo
  roundSeconds: 45,
  targetScore: 12,
  difficulty: "adaptive", // easy | medium | hard | adaptive
  selectedCategories: ["general", "culture", "science", "tech", "numbers", "sport"],
  sound: true,
};

const QUESTION_PACK = [
  { id: "q-capital", text: "Столица Канады", answer: "Оттава", options: ["Оттава", "Торонто", "Монреаль", "Ванкувер"], cat: "general", diff: 1 },
  { id: "q-ocean", text: "Самый большой океан", answer: "Тихий", options: ["Тихий", "Атлантический", "Индийский", "Северный Ледовитый"], cat: "general", diff: 1 },
  { id: "q-rings", text: "У какой планеты яркие кольца?", answer: "Сатурн", options: ["Сатурн", "Юпитер", "Марс", "Уран"], cat: "science", diff: 1 },
  { id: "q-water", text: "Формула воды", answer: "H₂O", options: ["H₂O", "CO₂", "O₂", "NaCl"], cat: "science", diff: 1 },
  { id: "q-lisa", text: "Автор «Моны Лизы»", answer: "Леонардо да Винчи", options: ["Леонардо да Винчи", "Микеланджело", "Рембрандт", "Пикассо"], cat: "culture", diff: 1 },
  { id: "q-pi", text: "Число π ≈", answer: "3.14", options: ["3.14", "2.71", "1.41", "4.20"], cat: "numbers", diff: 1 },
  { id: "q-flag", text: "Флаг Японии — круг какого цвета?", answer: "Красный", options: ["Красный", "Синий", "Зелёный", "Чёрный"], cat: "culture", diff: 1 },
  { id: "q-bytes", text: "1024 МБ это", answer: "1 ГБ", options: ["1 ГБ", "100 МБ", "10 ГБ", "512 МБ"], cat: "tech", diff: 1 },
  { id: "q-ram", text: "ОЗУ по-английски", answer: "RAM", options: ["RAM", "SSD", "HDD", "CPU"], cat: "tech", diff: 1 },
  { id: "q-oscar", text: "Главная кинопремия", answer: "Оскар", options: ["Оскар", "Грэмми", "Эмми", "Ника"], cat: "culture", diff: 1 },
  { id: "q-f1", text: "Главная серия автогонок", answer: "Формула‑1", options: ["Формула‑1", "NASCAR", "IndyCar", "WRC"], cat: "sport", diff: 1 },
  { id: "q-btc", text: "Первая криптовалюта", answer: "Биткоин", options: ["Биткоин", "Эфир", "Tether", "Litecoin"], cat: "tech", diff: 1 },
  { id: "q-cloud", text: "AWS, GCP, Azure — это", answer: "Облако", options: ["Облако", "Браузеры", "Антивирусы", "Игры"], cat: "tech", diff: 1 },
  { id: "q-speed", text: "Скорость света ~ км/с", answer: "300 000", options: ["300 000", "30 000", "3 000", "3 000 000"], cat: "numbers", diff: 2 },
  { id: "q-quant", text: "Минимальный пакет энергии", answer: "Квант", options: ["Квант", "Бит", "Пиксель", "Ньютон"], cat: "science", diff: 2 },
  { id: "q-ether", text: "Валюта сети Ethereum", answer: "ETH", options: ["ETH", "BTC", "SOL", "USDT"], cat: "tech", diff: 2 },
  { id: "q-aurora", text: "Полярное сияние по-латински", answer: "Аврора", options: ["Аврора", "Люмен", "Неон", "Орион"], cat: "science", diff: 2 },
  { id: "q-louvre", text: "Главный музей Парижа", answer: "Лувр", options: ["Лувр", "Метрополитен", "Тейт", "Уффици"], cat: "culture", diff: 1 },
  { id: "q-coffee", text: "30 мл кофе под давлением", answer: "Эспрессо", options: ["Эспрессо", "Американо", "Латте", "Флэт уайт"], cat: "culture", diff: 1 },
  { id: "q-valorant", text: "Тактический шутер от Riot", answer: "Valorant", options: ["Valorant", "CS2", "Apex", "Overwatch"], cat: "culture", diff: 2 },
  { id: "q-http429", text: "HTTP код «Too Many Requests»", answer: "429", options: ["429", "408", "503", "302"], cat: "tech", diff: 3 },
  { id: "q-osmium", text: "Самый плотный химический элемент", answer: "Осмий", options: ["Осмий", "Платина", "Иридий", "Уран"], cat: "science", diff: 4 },
  { id: "q-venus-day", text: "Планета с самыми длинными сутками", answer: "Венера", options: ["Венера", "Марс", "Юпитер", "Меркурий"], cat: "science", diff: 3 },
  { id: "q-kilimanjaro", text: "Самая высокая вершина Африки", answer: "Килиманджаро", options: ["Килиманджаро", "Эльбрус", "Джомолунгма", "Монблан"], cat: "general", diff: 3 },
  { id: "q-chess", text: "Количество клеток на шахматной доске", answer: "64", options: ["64", "81", "72", "100"], cat: "numbers", diff: 2 },
  { id: "q-ramanujan", text: "Число, известное как «такси-каб» Харди — Рамануджана", answer: "1729", options: ["1729", "108", "1337", "4096"], cat: "numbers", diff: 4 },
  { id: "q-docker", text: "Инструмент для контейнеризации приложений", answer: "Docker", options: ["Docker", "Ansible", "Kubernetes", "Terraform"], cat: "tech", diff: 2 },
  { id: "q-orwell", text: "Автор романа «1984»", answer: "Джордж Оруэлл", options: ["Джордж Оруэлл", "Олдос Хаксли", "Рэй Брэдбери", "Артур Кларк"], cat: "culture", diff: 2 },
];

const CATEGORIES = {
  general: { label: "Общее", icon: "✨", hint: "Сюрпризы из разных областей", from: "#22d3ee", to: "#8b5cf6" },
  culture: { label: "Культура", icon: "🎬", hint: "Кино, музыка и арт", from: "#f472b6", to: "#f97316" },
  science: { label: "Наука", icon: "🔬", hint: "Физика, биология, космос", from: "#34d399", to: "#10b981" },
  tech: { label: "Технологии", icon: "💻", hint: "IT, гаджеты и интернет", from: "#67e8f9", to: "#22d3ee" },
  numbers: { label: "Цифры", icon: "🔢", hint: "Математика и логика", from: "#fcd34d", to: "#f59e0b" },
  sport: { label: "Спорт", icon: "🏅", hint: "Команды, кубки и рекорды", from: "#facc15", to: "#fb7185" },
};

const DIFFICULTY_PRESETS = [
  { id: "easy", label: "Лёгкий", desc: "Минимум коварных вопросов", from: "#4ade80", to: "#22d3ee", badge: "🙂" },
  { id: "medium", label: "Средний", desc: "Сбалансированный темп", from: "#22d3ee", to: "#a855f7", badge: "⚡️" },
  { id: "hard", label: "Сложный", desc: "Больше хитрых формулировок", from: "#fb7185", to: "#f59e0b", badge: "🔥" },
  { id: "adaptive", label: "Адаптивный", desc: "Сложность растёт с серией", from: "#fbbf24", to: "#22d3ee", badge: "🧠" },
];

const ADVANCE_DELAY_MS = 1600;

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

const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

const sanitizeSettings = (raw = {}) => {
  const base = { ...DEFAULT_SETTINGS, ...(raw || {}) };
  const validCats = Object.keys(CATEGORIES);
  const availableDifficulties = DIFFICULTY_PRESETS.map((d) => d.id);
  const selectedCategories = Array.isArray(base.selectedCategories)
    ? base.selectedCategories.filter((c) => validCats.includes(c))
    : validCats;
  const difficulty = availableDifficulties.includes(base.difficulty)
    ? base.difficulty
    : base.autoDifficulty === false
    ? "medium"
    : "adaptive";

  return {
    mode: base.mode === "solo" ? "solo" : "teams",
    roundSeconds: clamp(Number(base.roundSeconds) || DEFAULT_SETTINGS.roundSeconds, 20, 90),
    targetScore: clamp(Number(base.targetScore) || DEFAULT_SETTINGS.targetScore, 5, 30),
    difficulty,
    selectedCategories: selectedCategories.length ? selectedCategories : validCats,
    sound: !!base.sound,
  };
};

const deriveRoundInfo = (perTeamQuestions = [], targetScore = DEFAULT_SETTINGS.targetScore, rosterSize) => {
  const cap = Math.max(1, Number(targetScore) || DEFAULT_SETTINGS.targetScore);
  const teamsCount =
    typeof rosterSize === "number" && rosterSize > 0
      ? rosterSize
      : Array.isArray(perTeamQuestions) && perTeamQuestions.length
      ? perTeamQuestions.length
      : 0;
  const answeredByTeam =
    teamsCount > 0
      ? Array.from({ length: teamsCount }).map((_, idx) =>
          clamp(Number(perTeamQuestions?.[idx]) || 0, 0, cap)
        )
      : [0];
  const roundsCompleted = Math.min(...answeredByTeam);
  const totalAsked = answeredByTeam.reduce((sum, n) => sum + n, 0);
  const currentRound = Math.min(cap, roundsCompleted + 1);
  const roundsRemaining = Math.max(0, cap - roundsCompleted);
  return { currentRound, roundsCompleted, roundsRemaining, totalAsked };
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
      "data:audio/wav;base64,UklGRoQAAABXQVZFZm10IBAAAAABAAEAgD4AAAB9AAACABAAZGF0YVgAAAAA//8AAP//AAD//wAA//8AAP//AAD//wAA//8AAP//AAD//wAA//8AAP//AAD//wAA";
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

const reducer = (state, action) => {
  switch (action.type) {
    case "SET_SETTING": {
      const settings = sanitizeSettings({ ...state.settings, [action.key]: action.value });
      return { ...state, settings, timerMs: settings.roundSeconds * 1000 };
    }
    case "SET_MODE": {
      const settings = sanitizeSettings({ ...state.settings, mode: action.mode });
      const roster = initialRoster(action.mode);
      return {
        ...state,
        settings,
        roster,
        perTeamQuestions: roster.map(() => 0),
        streaks: roster.map(() => 0),
        timerMs: settings.roundSeconds * 1000,
        stage: "setup",
      };
    }
    case "SET_ROSTER": {
      return {
        ...state,
        roster: action.roster,
        perTeamQuestions: action.roster.map(() => 0),
        streaks: action.roster.map(() => 0),
      };
    }
    case "RESET_SCORES": {
      const roster = state.roster.map((r) => ({ ...r, score: 0 }));
      const perTeamQuestions = roster.map(() => 0);
      return {
        ...state,
        roster,
        round: 1,
        used: [],
        streak: 0,
        streaks: roster.map(() => 0),
        perTeamQuestions,
        questionsPlayed: 0,
      };
    }
    case "START_MATCH": {
      const roster = state.roster.map((r) => ({ ...r, score: 0 }));
      const perTeamQuestions = roster.map(() => 0);
      return {
        ...state,
        roster,
        stage: "switch",
        activeIndex: 0,
        round: 1,
        used: [],
        streak: 0,
        streaks: roster.map(() => 0),
        question: null,
        timerMs: state.settings.roundSeconds * 1000,
        running: false,
        isPaused: false,
        lastResult: null,
        winner: null,
        questionsPlayed: 0,
        perTeamQuestions,
      };
    }
    case "SET_QUESTION": {
      return { ...state, question: action.question, reveal: false };
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
    case "REVEAL": {
      return { ...state, reveal: !state.reveal };
    }
    case "ANSWER": {
      const isCorrect = action.kind === "correct";
      const roster =
        action.nextRoster ||
        state.roster.map((r, idx) =>
          idx === state.activeIndex && isCorrect ? { ...r, score: r.score + 1 } : r
        );
      const used = state.used.includes(action.qid) ? state.used : [...state.used, action.qid];
      const perTeamQuestions = action.nextPerTeam || state.perTeamQuestions;
      const nextStreaks =
        action.nextStreaks ||
        state.streaks.map((v, idx) => (idx === state.activeIndex ? (isCorrect ? v + 1 : 0) : v));
      const streak = nextStreaks[state.activeIndex] || 0;
      return {
        ...state,
        roster,
        used,
        streak,
        streaks: nextStreaks,
        lastResult: isCorrect ? "correct" : "skip",
        questionsPlayed: action.nextQuestions ?? state.questionsPlayed + 1,
        perTeamQuestions,
      };
    }
    case "NEXT_TURN": {
      const nextIndex =
        typeof action.nextIndex === "number"
          ? action.nextIndex
          : (state.activeIndex + 1) % state.roster.length;
      const perTeamQuestions = action.nextPerTeam || state.perTeamQuestions;
      const { currentRound } = deriveRoundInfo(
        perTeamQuestions,
        state.settings.targetScore,
        state.roster.length
      );
      return {
        ...state,
        stage: "switch",
        activeIndex: nextIndex,
        round: currentRound,
        timerMs: state.settings.roundSeconds * 1000,
        running: false,
        isPaused: false,
        question: null,
        lastResult: null,
        streak: state.streaks[nextIndex] || 0,
        questionsPlayed: action.questionsPlayed ?? state.questionsPlayed,
        perTeamQuestions,
      };
    }
    case "SUMMARY": {
      return {
        ...state,
        stage: "summary",
        running: false,
        winner: action.winner,
        reason: action.reason,
      };
    }
    case "RESTART": {
      return {
        ...state,
        stage: "setup",
        running: false,
        isPaused: false,
        question: null,
        used: [],
        streak: 0,
        streaks: state.roster.map(() => 0),
        round: 1,
        timerMs: state.settings.roundSeconds * 1000,
        lastResult: null,
        winner: null,
        questionsPlayed: 0,
        perTeamQuestions: state.roster.map(() => 0),
      };
    }
    case "STOP_TIMER": {
      return { ...state, running: false, isPaused: false };
    }
    default:
      return state;
  }
};

const pickQuestion = (used, streak, difficulty, selectedCategories) => {
  const usedSet = new Set(used);
  const allowedCats =
    Array.isArray(selectedCategories) && selectedCategories.length
      ? selectedCategories
      : Object.keys(CATEGORIES);
  const byCategory = QUESTION_PACK.filter((q) => allowedCats.includes(q.cat));
  const basePool = byCategory.length ? byCategory : QUESTION_PACK;
  const target =
    difficulty === "easy"
      ? 1
      : difficulty === "medium"
      ? 2
      : difficulty === "hard"
      ? 3.5
      : clamp(1 + Math.floor(streak / 3), 1, 4);

  const unused = basePool.filter((q) => !usedSet.has(q.id));
  const pool = unused.length ? unused : basePool;
  const scored = pool.map((q) => ({ q, score: Math.abs(q.diff - target) }));
  const best = Math.min(...scored.map((s) => s.score));
  const candidates = scored.filter((s) => s.score === best).map((s) => s.q);
  const base = candidates[Math.floor(Math.random() * candidates.length)];
  return base;
};

const shuffle = (arr) => arr
  .map((v) => ({ v, r: Math.random() }))
  .sort((a, b) => a.r - b.r)
  .map((p) => p.v);

const buildOptions = (question) => {
  if (Array.isArray(question.options) && question.options.length >= 4) {
    return shuffle(question.options);
  }
  const answersPool = QUESTION_PACK.map((q) => q.answer).filter((a) => a && a !== question.answer);
  const uniques = Array.from(new Set(answersPool));
  const distractors = shuffle(uniques).slice(0, 3);
  const all = shuffle([question.answer, ...distractors]);
  return all;
};

const evaluateWinner = (roster) => {
  if (!roster.length) return [];
  const max = Math.max(...roster.map((r) => r.score));
  if (max <= 0) return [];
  return roster.filter((r) => r.score === max);
};

export default function Quiz({ goBack, onProgress, setBackHandler }) {
  const savedSettings = useMemo(
    () => sanitizeSettings(readPersisted(STORAGE_KEYS.settings, DEFAULT_SETTINGS)),
    []
  );
  const savedRoster = useMemo(() => readPersisted(STORAGE_KEYS.roster, null), []);
  const [state, dispatch] = useReducer(reducer, null, () => {
    const baseRoster =
      Array.isArray(savedRoster) && savedRoster.length
        ? savedRoster
        : initialRoster(savedSettings?.mode || "teams");
    return {
      settings: savedSettings,
      roster: baseRoster,
      perTeamQuestions: baseRoster.map(() => 0),
      streaks: baseRoster.map(() => 0),
      stage: "setup",
      activeIndex: 0,
      timerMs: (savedSettings?.roundSeconds || DEFAULT_SETTINGS.roundSeconds) * 1000,
      running: false,
      isPaused: false,
      round: 1,
      question: null,
      used: [],
      streak: 0,
      lastResult: null,
      winner: null,
      reveal: false,
      questionsPlayed: 0,
    };
  });
  const [lastStage, setLastStage] = useState("setup");

  const haptic = useHaptics();
  const chime = useChime(state.settings.sound);
  const progressGiven = useRef(false);
  const questionsLimit = state.settings.targetScore;
  const advanceTimeoutRef = useRef(null);
  const roundInfo = useMemo(
    () => deriveRoundInfo(state.perTeamQuestions, state.settings.targetScore, state.roster.length),
    [state.perTeamQuestions, state.settings.targetScore, state.roster.length]
  );

  const findNextActive = (perTeam, currentIdx) => {
    const len = state.roster.length || 1;
    for (let step = 1; step <= len; step += 1) {
      const idx = (currentIdx + step) % len;
      if (perTeam[idx] < questionsLimit) return idx;
    }
    return null;
  };
  useEffect(() => {
    return () => {
      if (advanceTimeoutRef.current) {
        clearTimeout(advanceTimeoutRef.current);
        advanceTimeoutRef.current = null;
      }
    };
  }, []);

  // Persist settings & roster
  useEffect(() => {
    persist(STORAGE_KEYS.settings, state.settings);
  }, [state.settings]);
  useEffect(() => {
    persist(STORAGE_KEYS.roster, state.roster);
  }, [state.roster]);
  useEffect(() => {
    if (state.stage !== "switch") {
      setLastStage(state.stage);
    }
  }, [state.stage]);

  // Timer loop — использует реальное время, чтобы не зависеть от фоновой вкладки
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

  // Time is over
  useEffect(() => {
    if (state.stage !== "round") return;
    if (state.timerMs <= 0) {
      processAnswer("skip");
    }
  }, [
    state.timerMs,
    state.stage,
    state.questionsPlayed,
    questionsLimit,
    state.roster,
    state.perTeamQuestions,
    state.activeIndex,
  ]);

  // Back handler
  useEffect(() => {
    if (!setBackHandler) return;
    setBackHandler(() => {
      if (state.stage === "round") {
        dispatch({ type: state.running ? "PAUSE" : "RESUME" });
        return;
      }
      goBack?.();
    });
  }, [setBackHandler, state.stage, state.running, goBack]);

  // Progress ping
  useEffect(() => {
    if (state.stage === "summary" && !progressGiven.current) {
      progressGiven.current = true;
      onProgress?.();
    }
  }, [state.stage, onProgress]);

  const current = state.roster[state.activeIndex] || state.roster[0];

  const handleStart = () => {
    haptic("medium");
    dispatch({ type: "START_MATCH" });
  };

  const handleBeginRound = () => {
    haptic("light");
    const activeStreak = state.streaks?.[state.activeIndex] || 0;
    const q = pickQuestion(
      state.used,
      activeStreak,
      state.settings.difficulty,
      state.settings.selectedCategories
    );
    dispatch({ type: "SET_QUESTION", question: { ...q, options: buildOptions(q) } });
    dispatch({ type: "BEGIN_ROUND" });
  };

  const processAnswer = useCallback(
    (kind) => {
      if (state.stage !== "round") return;
      if (advanceTimeoutRef.current) return;
      dispatch({ type: "STOP_TIMER" });
      const nextQuestionsPlayed = state.questionsPlayed + 1;
      const nextRoster = state.roster.map((r, idx) =>
        idx === state.activeIndex && kind === "correct" ? { ...r, score: r.score + 1 } : r
      );
      const nextPerTeam = state.perTeamQuestions.map((n, idx) =>
        idx === state.activeIndex ? n + 1 : n
      );
      const nextStreaks = state.streaks.map((v, idx) =>
        idx === state.activeIndex ? (kind === "correct" ? v + 1 : 0) : v
      );
      dispatch({
        type: "ANSWER",
        kind,
        qid: state.question?.id,
        nextRoster,
        nextQuestions: nextQuestionsPlayed,
        nextPerTeam,
        nextStreaks,
      });
      const topScore = Math.max(0, ...nextRoster.map((r) => r.score));
      const hasScoreWinner = topScore >= 1 && topScore >= questionsLimit;
      const allDone = nextPerTeam.every((n) => n >= questionsLimit);
      const nextIdx = findNextActive(nextPerTeam, state.activeIndex);
      advanceTimeoutRef.current = setTimeout(() => {
        if (hasScoreWinner || allDone) {
          const winner = evaluateWinner(nextRoster);
          dispatch({ type: "SUMMARY", winner, reason: hasScoreWinner ? "score" : "questions" });
        } else {
          dispatch({
            type: "NEXT_TURN",
            questionsPlayed: nextQuestionsPlayed,
            nextPerTeam,
            nextIndex: typeof nextIdx === "number" ? nextIdx : state.activeIndex,
          });
        }
        advanceTimeoutRef.current = null;
      }, ADVANCE_DELAY_MS);
    },
    [
      state.stage,
      state.questionsPlayed,
      state.roster,
      state.perTeamQuestions,
      state.streaks,
      state.activeIndex,
      state.question?.id,
      questionsLimit,
      findNextActive,
    ]
  );

  const mark = (kind) => {
    if (kind === "correct") {
      haptic("medium");
      chime();
    } else {
      haptic("light");
    }
    processAnswer(kind);
  };

  const restart = (keepRoster = true) => {
    haptic("light");
    progressGiven.current = false;
    dispatch({ type: "RESTART" });
    if (!keepRoster) {
      dispatch({ type: "SET_ROSTER", roster: initialRoster(state.settings.mode) });
    } else {
      dispatch({ type: "RESET_SCORES" });
    }
  };

  const safeRoundSeconds = clamp(state.settings.roundSeconds, 20, 90);
  const timePct = clamp(state.timerMs / (safeRoundSeconds * 1000), 0, 1);
  const isSwitching = state.stage === "switch";
  const visibleStage = isSwitching ? lastStage : state.stage;

  return (
    <div className="quiz">
      <div className="quiz-bg" aria-hidden>
        <span className="blob one" />
        <span className="blob two" />
      </div>
      <div className="quiz-wrap">
        {visibleStage === "setup" && (
          <Setup
            settings={state.settings}
            roster={state.roster}
            onChangeSetting={(key, value) => dispatch({ type: "SET_SETTING", key, value })}
            onChangeRoster={(next) => dispatch({ type: "SET_ROSTER", roster: next })}
            onStart={handleStart}
          />
        )}

        {visibleStage === "round" && (
          <Round
            current={current}
            mode={state.settings.mode}
            question={state.question}
            reveal={state.reveal}
            onReveal={() => dispatch({ type: "REVEAL" })}
            timePct={timePct}
            seconds={Math.ceil(state.timerMs / 1000)}
            onAnswer={(isCorrect) => mark(isCorrect ? "correct" : "skip")}
            running={state.running}
            isPaused={state.isPaused}
            onResume={() => dispatch({ type: "RESUME" })}
            onExit={goBack}
            roster={state.roster}
            targetScore={state.settings.targetScore}
            perTeam={state.perTeamQuestions}
            activeIndex={state.activeIndex}
            roundNumber={roundInfo.currentRound}
          />
        )}

        {visibleStage === "summary" && (
          <Summary
            roster={state.roster}
            winners={state.winner || []}
            roundsPlayed={roundInfo.roundsCompleted}
            roundsTotal={state.settings.targetScore}
            questionsPlayed={state.questionsPlayed}
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
                round={roundInfo.currentRound}
                onBegin={handleBeginRound}
                remainingRounds={roundInfo.roundsRemaining}
              />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Setup({ settings, roster, onChangeSetting, onChangeRoster, onStart }) {
  const [localRoster, setLocalRoster] = useState(roster);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const modeIsTeams = settings.mode === "teams";
  const minPlayers = modeIsTeams ? 2 : 1;
  const allCategories = Object.keys(CATEGORIES);
  const selectedCategories =
    Array.isArray(settings.selectedCategories) && settings.selectedCategories.length
      ? settings.selectedCategories
      : allCategories;
  const isAllSelected = selectedCategories.length === allCategories.length;
  const timerPct = clamp(((settings.roundSeconds - 20) / (90 - 20)) * 100, 0, 100);
  const roundsPct = clamp(((settings.targetScore - 5) / (30 - 5)) * 100, 0, 100);
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

  const toggleCategory = (cat) => {
    const has = selectedCategories.includes(cat);
    const next = has
      ? selectedCategories.filter((c) => c !== cat)
      : [...selectedCategories, cat];
    onChangeSetting("selectedCategories", next.length ? next : [cat]);
  };

  const selectAllCategories = () => {
    onChangeSetting("selectedCategories", allCategories);
  };

  const setDifficulty = (value) => {
    onChangeSetting("difficulty", value);
  };

  const settingsModal = (
    <AnimatePresence>
      {settingsOpen && (
        <motion.div
          className="settings-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          onClick={() => setSettingsOpen(false)}
        >
          <motion.div
            className="settings-window"
            initial={{ y: 30, opacity: 0, scale: 0.98 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 14, opacity: 0, scale: 0.98 }}
            transition={{ type: "tween", ease: "easeOut", duration: 0.22 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="settings-head">
              <div>
                <div className="settings-title">Настройки матча</div>
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
                    <span>90с</span>
                  </div>
                </div>
                <div className="setting-actions">
                  <button onClick={() => adjustSetting("roundSeconds", -5, 20, 90)}>−5с</button>
                  <button onClick={() => adjustSetting("roundSeconds", 5, 20, 90)}>+5с</button>
                </div>
              </div>

              <div className="setting-card glass">
                <div className="setting-card-top">
                  <span className="pill">Раунды до победы</span>
                  <div className="setting-number">{settings.targetScore}</div>
                </div>
                <div className="meter">
                  <div className="meter-track alt">
                    <div className="meter-fill alt" style={{ width: `${roundsPct}%` }} />
                    <span className="meter-thumb" style={{ left: `${roundsPct}%` }} />
                  </div>
                  <div className="meter-scale">
                    <span>5</span>
                    <span>30</span>
                  </div>
                </div>
                <div className="setting-actions">
                  <button onClick={() => adjustSetting("targetScore", -1, 5, 30)}>−1</button>
                  <button onClick={() => adjustSetting("targetScore", 1, 5, 30)}>+1</button>
                </div>
              </div>
            </div>

            <div className="settings-toggles">
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
          <div className="eyebrow">Блиц-викторина</div>
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
            <div className="section-title">Категории</div>
            <div className="section-sub">Отметь темы, которые хотите видеть</div>
          </div>
          <div className="section-actions">
            <button
              className="ghost-btn compact"
              onClick={selectAllCategories}
              disabled={isAllSelected}
            >
              Все темы
            </button>
          </div>
        </div>

        <div className="category-grid">
          {Object.entries(CATEGORIES).map(([key, meta]) => {
            const active = selectedCategories.includes(key);
            return (
              <motion.button
                key={key}
                className={`cat-card ${active ? "on" : ""}`}
                whileTap={{ scale: 0.98 }}
                whileHover={{ y: -1 }}
                onClick={() => toggleCategory(key)}
                style={{ "--cat-from": meta.from, "--cat-to": meta.to }}
                aria-pressed={active}
              >
                <span className="cat-icon">{meta.icon}</span>
                <div className="cat-text">
                  <div className="cat-name">{meta.label}</div>
                  <div className="cat-hint">{meta.hint}</div>
                </div>
                <span className={`cat-check ${active ? "on" : ""}`} aria-hidden>
                  ✓
                </span>
              </motion.button>
            );
          })}
        </div>

        <div className="section-header">
          <div>
            <div className="section-title">Сложность</div>
            <div className="section-sub">Лёгкий, средний, сложный или адаптивный</div>
          </div>
        </div>

        <div className="difficulty-grid">
          {DIFFICULTY_PRESETS.map((item) => {
            const active = settings.difficulty === item.id;
            return (
              <motion.button
                key={item.id}
                className={`difficulty-card ${active ? "active" : ""}`}
                whileTap={{ scale: 0.98 }}
                whileHover={{ y: -1 }}
                onClick={() => setDifficulty(item.id)}
                style={{ "--diff-from": item.from, "--diff-to": item.to }}
                aria-pressed={active}
              >
                <div className="difficulty-head">
                  <span className="difficulty-chip">{item.badge}</span>
                  <div className="difficulty-labels">
                    <div className="difficulty-label">{item.label}</div>
                    <div className="difficulty-desc">{item.desc}</div>
                  </div>
                </div>
                <span className={`difficulty-active ${active ? "on" : ""}`}>
                  {active ? "Выбрано" : "Нажми, чтобы выбрать"}
                </span>
              </motion.button>
            );
          })}
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
            <Plus size={16} />
            Добавить {modeIsTeams ? "команду" : "игрока"}
          </button>
        </div>

        <motion.button className="cta" whileTap={{ scale: 0.98 }} onClick={onStart}>
          <Sparkles size={18} />
          Старт
        </motion.button>
      </div>
    </>
  );
}

function SwitchCard({ current, mode, round, onBegin, remainingRounds }) {
  const remainLabel =
    remainingRounds > 1 ? `Осталось раундов: ${remainingRounds}` : "Финальный раунд";
  return (
    <div className="switch-card-panel">
      <div className="eyebrow">Раунд {round} • {remainLabel}</div>
      <div className="hero-main">
        <div className="bubble" style={{ background: current?.color }}>
          {current?.emoji}
        </div>
        <div>
          <div className="hero-label">Ход {mode === "teams" ? "команды" : "игрока"}</div>
          <div className="hero-title">{current?.name}</div>
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
      </div>
    </div>
  );
}

function Round({
  current,
  mode,
  question,
  reveal,
  onReveal,
  timePct,
  seconds,
  onAnswer,
  running,
  isPaused,
  onResume,
  onExit,
  roster,
  targetScore,
  perTeam,
  activeIndex = 0,
  roundNumber,
}) {
  const [selected, setSelected] = useState(null); // value
  useEffect(() => {
    setSelected(null);
  }, [question?.id]);

  const handleOption = (opt) => {
    if (selected || !question) return;
    const isCorrect = opt === question.answer;
    setSelected(opt);
    onAnswer?.(isCorrect);
  };

  const options = Array.isArray(question?.options) && question.options.length
    ? question.options
    : [question?.answer].filter(Boolean);
  const hasChoice = selected != null;
  const cap = Math.max(1, Number(targetScore) || 1);
  const totalAsked = (perTeam || []).reduce((sum, n) => sum + (Number(n) || 0), 0);
  const progressItems = (roster || []).map((item, idx) => {
    const answered = perTeam?.[idx] ?? 0;
    const correctPct = clamp(Math.min(item.score, cap) / cap, 0, 1) * 100;
    const askedPct = clamp(Math.min(answered, cap) / cap, 0, 1) * 100;
    return {
      ...item,
      answered,
      correctPct,
      askedPct,
      isActive: idx === activeIndex,
    };
  });

  return (
    <div className="round">
      <div className="round-meta">
        <div className="bubble small" style={{ background: current?.color }}>
          {current?.emoji}
        </div>
        <div className="round-name">{current?.name}</div>
        <span className="dot" />
        <div className="round-mode">{mode === "teams" ? "Команды" : "Соло"}</div>
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
        roundNumber={roundNumber}
        totalLabel={`Игра до ${cap} раундов`}
        playedLabel={`Вопросов: ${totalAsked}`}
      />

      <QuestionCard question={question} reveal={reveal} onReveal={onReveal} />

      <div className="options" role="list">
        {options.map((opt, idx) => {
          const isSelected = selected === opt;
          const isCorrect = opt === question?.answer;
          const stateClass = hasChoice
            ? isCorrect
              ? "opt-correct"
              : isSelected
              ? "opt-wrong"
              : ""
            : "";
          const label = String.fromCharCode(65 + idx);
          return (
            <motion.button
              key={opt}
              className={`option ${stateClass}`}
              whileTap={{ scale: 0.98 }}
              onClick={() => handleOption(opt)}
              disabled={hasChoice}
              role="listitem"
            >
              <span className="opt-label">{label}</span>
              <span className="opt-body">
                <span className="opt-text">{opt}</span>
                {hasChoice && (
                  <span className="opt-status">
                    {isCorrect ? "Правильный ответ" : isSelected ? "Неверно" : ""}
                  </span>
                )}
              </span>
            </motion.button>
          );
        })}
      </div>

      {!!progressItems.length && (
        <div className="score-rail" role="list">
          {progressItems.map((item) => (
            <div
              className={`score-chip ${item.isActive ? "is-active" : ""}`}
              key={item.id}
              role="listitem"
            >
              <div className="score-chip-head">
                <span className="score-chip-avatar" style={{ background: item.color }}>
                  {item.emoji}
                </span>
                <div className="score-chip-info">
                  <div className="score-chip-name">{item.name}</div>
                  <div className="score-chip-track" aria-label={`Прогресс ${item.name}`}>
                    <span className="score-chip-asked" style={{ width: `${item.askedPct}%` }} />
                    <span className="score-chip-fill" style={{ width: `${item.correctPct}%` }} />
                  </div>
                </div>
                <span className="score-chip-value">{item.score}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {isPaused && (
        <div className="pause">
          <div className="pause-card">
            <Pause size={20} />
            <div>Пауза</div>
            <motion.button className="cta wide" whileTap={{ scale: 0.97 }} onClick={onResume}>
              Продолжить
            </motion.button>
          </div>
        </div>
      )}
    </div>
  );
}

function TimerPacman({ pct, seconds, running, current, roundNumber, totalLabel, playedLabel }) {
  const safePct = clamp(pct ?? 0, 0, 1);
  const remainingPct = Math.round(safePct * 100);
  // 100% — старт справа, 0% — финиш слева
  const trackInsetPct = 4;
  const travelPct = 100 - trackInsetPct * 2;
  const pacLeftPct = trackInsetPct + (remainingPct * travelPct) / 100; // короче путь, не упирается в края
  const remainingWidthPct = Math.max(0, pacLeftPct - trackInsetPct);
  const pacLeft = `${pacLeftPct}%`; // центр пакмана сидит на процентной шкале

  const label =
    remainingPct <= 0 ? "время вышло" : running ? "время идёт" : "пауза";

  return (
    <div className="pacman-timer">
      <div className="pacman-meta">
        <div className="timer-num">{seconds}s</div>
        <div className="timer-sub">{label}</div>
        {typeof roundNumber === "number" && (
          <span className="round-pill dark">Раунд {roundNumber}</span>
        )}
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

        {/* часть с пилюлями — оставшееся время */}
        <div
          className="pacman-remaining"
          style={{ left: `${trackInsetPct}%`, width: `${remainingWidthPct}%` }}
        />

        {/* сам пакман */}
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

function QuestionCard({ question, reveal, onReveal }) {
  const cat = CATEGORIES[question?.cat] || CATEGORIES.general;
  return (
    <motion.div
      className="question"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      layout
    >
      <div className="question-top">
        <span className="pill">
          {cat.icon} {cat.label}
        </span>
        <button className="ghost-btn" onClick={onReveal} aria-label="Показать ответ">
          {reveal ? <EyeOff size={16} /> : <Eye size={16} />}
        </button>
      </div>
      <div className="question-text">{question?.text || "Готовимся..."}</div>
      {reveal && <div className="answer">Ответ: {question?.answer}</div>}
    </motion.div>
  );
}

function Summary({
  roster,
  winners,
  roundsPlayed,
  roundsTotal,
  questionsPlayed,
  onRematch,
  onReset,
  onMenu,
}) {
  const topScore = roster.length ? Math.max(...roster.map((r) => r.score)) : 0;
  const leaderScore = topScore > 0 ? topScore : null;
  const safeRoundsTotal = Math.max(1, Number(roundsTotal) || 1);
  const playedRounds = Math.min(Math.max(0, Number(roundsPlayed) || 0), safeRoundsTotal);
  const askedQuestions = Math.max(0, Number(questionsPlayed) || 0);
  const winnerLine = winners.length
    ? `Победили: ${winners.map((w) => w.name).join(", ")}`
    : "Ничья: правильных ответов нет";
  return (
    <motion.div
      className="panel"
      initial={{ opacity: 0, y: 30 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
    >
      <div className="panel-head">
        <div className="eyebrow">Матч окончен</div>
        <div className="panel-title">
          Сыграно раундов: {playedRounds} / {safeRoundsTotal} • Вопросов: {askedQuestions}
        </div>
      </div>

      <div className="winners">
        <Trophy size={20} />
        <div>{winnerLine}</div>
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
              <div className={`score-value ${leaderScore !== null && r.score === leaderScore ? "lead" : ""}`}>
                {r.score}
              </div>
            </div>
          ))}
      </div>

      <div className="row summary-actions">
        <motion.button className="btn secondary wide" whileTap={{ scale: 0.97 }} onClick={onRematch}>
          <RefreshCw size={16} />
          Реванш
        </motion.button>
        <motion.button className="btn primary wide" whileTap={{ scale: 0.97 }} onClick={onReset}>
          <Award size={16} />
          Новый состав
        </motion.button>
      </div>
      <button className="ghost-btn wide" onClick={onMenu}>
        В меню
      </button>
    </motion.div>
  );
}
