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
  autoDifficulty: true,
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
  general: { label: "Общее", icon: "✨" },
  culture: { label: "Культура", icon: "🎬" },
  science: { label: "Наука", icon: "🔬" },
  tech: { label: "Технологии", icon: "💻" },
  numbers: { label: "Цифры", icon: "🔢" },
  sport: { label: "Спорт", icon: "🏅" },
};

const MAX_ROUNDS = 20;
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
      const settings = { ...state.settings, [action.key]: action.value };
      return { ...state, settings, timerMs: settings.roundSeconds * 1000 };
    }
    case "SET_MODE": {
      const settings = { ...state.settings, mode: action.mode };
      const roster =
        state.roster.length && state.roster[0]?.mode === action.mode
          ? state.roster
          : initialRoster(action.mode);
      return {
        ...state,
        settings,
        roster,
        perTeamQuestions: roster.map(() => 0),
        timerMs: settings.roundSeconds * 1000,
        stage: "setup",
      };
    }
    case "SET_ROSTER": {
      return { ...state, roster: action.roster, perTeamQuestions: action.roster.map(() => 0) };
    }
    case "RESET_SCORES": {
      const roster = state.roster.map((r) => ({ ...r, score: 0 }));
      const perTeamQuestions = roster.map(() => 0);
      return { ...state, roster, round: 1, used: [], streak: 0, perTeamQuestions, questionsPlayed: 0 };
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
      const streak = isCorrect ? state.streak + 1 : 0;
      const perTeamQuestions = action.nextPerTeam || state.perTeamQuestions;
      return {
        ...state,
        roster,
        used,
        streak,
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
      const nextRound = state.round + 1;
      return {
        ...state,
        stage: "switch",
        activeIndex: nextIndex,
        round: nextRound,
        timerMs: state.settings.roundSeconds * 1000,
        running: false,
        isPaused: false,
        question: null,
        lastResult: null,
        streak: 0,
        questionsPlayed: action.questionsPlayed ?? state.questionsPlayed,
        perTeamQuestions: action.nextPerTeam || state.perTeamQuestions,
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

const pickQuestion = (used, streak, autoDifficulty) => {
  const usedSet = new Set(used);
  const target = autoDifficulty ? clamp(1 + Math.floor(streak / 3), 1, 4) : 2;
  const unused = QUESTION_PACK.filter((q) => !usedSet.has(q.id));
  const pool = unused.length ? unused : QUESTION_PACK;
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
  return roster.filter((r) => r.score === max);
};

export default function Quiz({ goBack, onProgress, setBackHandler }) {
  const savedSettings = useMemo(() => readPersisted(STORAGE_KEYS.settings, DEFAULT_SETTINGS), []);
  const savedRoster = useMemo(() => readPersisted(STORAGE_KEYS.roster, null), []);
  const [state, dispatch] = useReducer(reducer, null, () => ({
    settings: { ...DEFAULT_SETTINGS, ...savedSettings },
    roster: Array.isArray(savedRoster) && savedRoster.length ? savedRoster : initialRoster(savedSettings?.mode || "teams"),
    perTeamQuestions: (Array.isArray(savedRoster) && savedRoster.length ? savedRoster : initialRoster(savedSettings?.mode || "teams")).map(() => 0),
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
  }));

  const haptic = useHaptics();
  const chime = useChime(state.settings.sound);
  const progressGiven = useRef(false);
  const questionsLimit = state.settings.targetScore;
  const advanceTimeoutRef = useRef(null);

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
    const q = pickQuestion(state.used, state.streak, state.settings.autoDifficulty);
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
      dispatch({
        type: "ANSWER",
        kind,
        qid: state.question?.id,
        nextRoster,
        nextQuestions: nextQuestionsPlayed,
        nextPerTeam,
      });
      const allDone = nextPerTeam.every((n) => n >= questionsLimit);
      const nextIdx = findNextActive(nextPerTeam, state.activeIndex);
      advanceTimeoutRef.current = setTimeout(() => {
        if (allDone) {
          const winner = evaluateWinner(nextRoster);
          dispatch({ type: "SUMMARY", winner, reason: "questions" });
        } else {
          dispatch({
            type: "NEXT_TURN",
            questionsPlayed: nextQuestionsPlayed,
            nextPerTeam,
            nextIndex: nextIdx ?? state.activeIndex,
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

  return (
    <div className="quiz">
      <div className="quiz-bg" aria-hidden>
        <span className="blob one" />
        <span className="blob two" />
      </div>
      <div className="quiz-wrap">
        {state.stage === "setup" && (
          <Setup
            settings={state.settings}
            roster={state.roster}
            onChangeSetting={(key, value) => dispatch({ type: "SET_SETTING", key, value })}
            onChangeRoster={(next) => dispatch({ type: "SET_ROSTER", roster: next })}
            onStart={handleStart}
          />
        )}

        {state.stage === "switch" && (
          <SwitchCard
            key={current?.id}
            current={current}
            mode={state.settings.mode}
            round={state.round}
            onBegin={handleBeginRound}
            remainingRounds={MAX_ROUNDS - state.round + 1}
          />
        )}

        {state.stage === "round" && (
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
          />
        )}

        {state.stage === "summary" && (
          <Summary
            roster={state.roster}
            winners={state.winner || []}
            questions={state.settings.targetScore}
            onRematch={() => restart(true)}
            onReset={() => restart(false)}
            onMenu={goBack}
          />
        )}
      </div>
    </div>
  );
}

function Setup({ settings, roster, onChangeSetting, onChangeRoster, onStart }) {
  const [localRoster, setLocalRoster] = useState(roster);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const modeIsTeams = settings.mode === "teams";
  const minPlayers = 2;
  const timerPct = clamp(((settings.roundSeconds - 20) / (90 - 20)) * 100, 0, 100);
  const questionsPct = clamp(((settings.targetScore - 5) / (30 - 5)) * 100, 0, 100);
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
                  <span className="pill">Вопросы</span>
                  <div className="setting-number">{settings.targetScore}</div>
                </div>
                <div className="meter">
                  <div className="meter-track alt">
                    <div className="meter-fill alt" style={{ width: `${questionsPct}%` }} />
                    <span className="meter-thumb" style={{ left: `${questionsPct}%` }} />
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
                className={`toggle-chip ${settings.autoDifficulty ? "on" : ""}`}
                onClick={() => onChangeSetting("autoDifficulty", !settings.autoDifficulty)}
              >
                <Sparkles size={16} />
                Адаптивная сложность
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
  return (
    <AnimatePresence mode="popLayout">
      <motion.div
        key={current?.id}
        className="card hero"
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -20 }}
        transition={{ duration: 0.2 }}
      >
        <div className="eyebrow">Раунд {round} • осталось {remainingRounds}</div>
        <div className="hero-main">
          <div className="bubble" style={{ background: current?.color }}>
            {current?.emoji}
          </div>
          <div>
            <div className="hero-label">Ход {mode === "teams" ? "команды" : "игрока"}</div>
            <div className="hero-title">{current?.name}</div>
          </div>
        </div>
        <div className="hero-sub">Жми, чтобы стартовать таймер и взять первый вопрос.</div>
        <motion.button className="cta wide" whileTap={{ scale: 0.97 }} onClick={onBegin}>
          <Play size={18} />
          Погнали
        </motion.button>
      </motion.div>
    </AnimatePresence>
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

      <TimerPacman pct={timePct} seconds={seconds} running={running} />

      <QuestionCard question={question} reveal={reveal} onReveal={onReveal} />

      <div className="options" role="list">
        {options.map((opt) => {
          const isSelected = selected === opt;
          const isCorrect = opt === question?.answer;
          const stateClass = hasChoice
            ? isCorrect
              ? "opt-correct"
              : isSelected
              ? "opt-wrong"
              : ""
            : "";
          return (
            <motion.button
              key={opt}
              className={`option ${stateClass}`}
              whileTap={{ scale: 0.98 }}
              onClick={() => handleOption(opt)}
              disabled={hasChoice}
              role="listitem"
            >
              <span className="opt-text">{opt}</span>
              {hasChoice && (
                <span className="opt-status">
                  {isCorrect ? "Правильный ответ" : isSelected ? "Неверно" : ""}
                </span>
              )}
            </motion.button>
          );
        })}
      </div>

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

function TimerPacman({ pct, seconds, running }) {
  const remaining = clamp(pct, 0, 1);
  const remainingPct = Math.round(remaining * 100);
  const eatenPct = 100 - remainingPct;
  const pacLeftPct = Math.min(100, Math.max(0, eatenPct));
  const pacLeft = `calc(${pacLeftPct}% - 12px)`;
  return (
    <div className="pacman-timer">
      <div className="pacman-meta">
        <div className="timer-num">{seconds}s</div>
        <div className="timer-sub">{running ? "время идёт" : "пауза"}</div>
      </div>
      <div className="pacman-track" aria-hidden>
        <div className="pacman-remaining" style={{ left: `${eatenPct}%`, width: `${remainingPct}%` }} />
        <div className="pacman-dotline" />
        <motion.div
          className="pacman"
          style={{ left: pacLeft }}
          animate={{ left: pacLeft }}
          transition={{ duration: 0.18, ease: "easeOut" }}
        />
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

function Summary({ roster, winners, questions, onRematch, onReset, onMenu }) {
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
        <div className="panel-title">Всего вопросов: {questions}</div>
      </div>

      <div className="winners">
        <Trophy size={20} />
        <div>
          Победили: {winners.map((w) => w.name).join(", ")}
        </div>
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
