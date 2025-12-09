import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { Check, ChevronDown, Settings, Sparkles, Volume2, X, Plus, Trash2 } from "lucide-react";
import "./choice.css";

const STORAGE_KEYS = {
  settings: "pt_choice_settings_v1",
  stats: "pt_choice_stats_v1",
  roster: "pt_choice_roster_v1",
  custom: "pt_choice_custom_v1",
  daily: "pt_choice_daily_v1",
};

const DEFAULT_SETTINGS = {
  mode: "free",
  sound: true,
  haptics: true,
  difficulty: "normal",
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

const CHOICE_MODES = [
  { id: "solo", label: "Каждому своё", desc: "Именной список участников", badge: "🧑‍🚀" },
  { id: "free", label: "Быстрый старт", desc: "Без списка, просто вопросы", badge: "✨" },
];

const CHOICE_DIFFICULTIES = [
  { id: "normal", label: "Обычный", emoji: "🙂" },
  { id: "spicy", label: "Острый", emoji: "🌶️" },
  { id: "insane", label: "П@#$%ц", emoji: "💀" },
  { id: "apocalypse", label: "Апокалипсис", emoji: "☄️" },
];

const RAW_PACKS = [
  {
    id: "health",
    rating: "12+",
    tone: "calm",
    vibe: "bright",
    items: [
      ["", "30 минут бега каждый день без права пропуска", "Три жёсткие тренировки в неделю до отказа", [50, 50]],
      ["", "Год без сахара и алкоголя вообще", "Год без кофеина и быстрых углеводов", [50, 50]],
      ["", "Ледяной душ каждое утро", "Ложиться спать строго в 22:00, без исключений", [50, 50]],
      ["", "Есть только то, что приготовил сам", "Интервальное 18/6, но ешь что угодно", [50, 50]],
      ["", "Только лестницы, никаких лифтов", "Только готовка дома, никакой доставки", [50, 50]],
      ["", "Переехать в горы без удобств", "Остаться в городе, но 15к шагов в день", [50, 50]],
      ["", "Сократить экран до 1 часа в день", "Забирать себе +2 часа сна ежедневно", [50, 50]],
      ["", "Год без мяса и фастфуда", "Год без хлеба, сахара и молочки", [50, 50]],
    ],
  },
  {
    id: "money",
    rating: "12+",
    tone: "ethics",
    vibe: "bright",
    items: [
      ["Срыв сделки", "Отменить релиз и потерять бонус", "Релизить сырой продукт ради прибыли", [50, 50]],
      ["Власть или свобода", "Стать публичным лидом под прожектором", "Остаться в тени, но без влияния", [50, 50]],
      ["Хрупкий контракт", "Подписать с токсичным клиентом за x2 деньги", "Отказать и спасать репутацию", [50, 50]],
      ["Рывок", "Сжечь 6 месяцев на стартап с шансом x10", "Остаться в корпорации и расти медленно", [50, 50]],
      ["Команда или деньги", "Разделить бонус со всей командой", "Забрать весь бонус себе", [50, 50]],
      ["Карьера vs семья", "Работа за океаном вдали от близких", "Остаться рядом, но минус рост", [50, 50]],
      ["Нерв на пределе", "Фриланс с качелями дохода", "Фикс, но вечные совещания", [50, 50]],
      ["Мораль", "Открыть код ради комьюнити", "Спрятать, чтобы обойти конкурентов", [50, 50]],
    ],
  },
  {
    id: "love",
    rating: "12+",
    tone: "calm",
    vibe: "warm",
    items: [
      ["", "Остаться вместе, но видеть друг друга 1 день в неделю", "Разъехаться на год и проверять связь", [50, 50]],
      ["", "Сказать правду, risking большой конфликт", "Умолчать и хранить тайну", [50, 50]],
      ["", "Съехаться сразу, рискуя бытом", "Жить раздельно год, терпя дистанцию", [50, 50]],
      ["", "Общий бюджет до копейки", "Строгие раздельные финансы", [50, 50]],
      ["", "Удалить соцсети вдвоём", "Оставить соцсети, но терять время друг с другом", [50, 50]],
      ["", "Завести ребёнка в ближайший год", "Отложить семью на 5 лет ради целей", [50, 50]],
      ["", "Переехать к партнёру в его город", "Попросить переехать к себе, рискуя его карьерой", [50, 50]],
      ["", "Открытые отношения на полгода", "Жёсткая моногамия и контроль", [50, 50]],
    ],
  },
  {
    id: "ethics",
    rating: "16+",
    tone: "ethics",
    vibe: "deep",
    items: [
      ["", "Сдать друга ради спасения проекта", "Прикрыть друга и уронить дедлайн", [50, 50]],
      ["", "Скрыть баг и пройти релиз", "Признаться и остановить запуск", [50, 50]],
      ["", "Уволить токсичного гения", "Держать его ради результата", [50, 50]],
      ["", "Собрать максимум данных о пользователях", "Отказаться и проиграть конкуренцию", [50, 50]],
      ["", "Взять деньги от сомнительного клиента", "Отказать и потерять прибыль", [50, 50]],
      ["", "Подписать NDA и молчать", "Слить информацию журналистам", [50, 50]],
      ["", "Отдать часть бонуса команде", "Оставить всё себе, но потерять доверие", [50, 50]],
      ["", "Взять кредит ради помощи семье", "Отказать и оставить их решать самим", [50, 50]],
    ],
  },
  {
    id: "tech",
    rating: "12+",
    tone: "future",
    vibe: "cool",
    items: [
      ["", "Имплант памяти ради суперспособностей", "Полный цифровой детокс на год", [50, 50]],
      ["", "8 часов в метавселенной ежедневно", "Только офлайн-комьюнити без гаджетов", [50, 50]],
      ["", "Отдать свои данные ради удобства", "Полная приватность, но без сервисов", [50, 50]],
      ["", "Доверить автопилоту детей", "Водить только самому, но потерять время", [50, 50]],
      ["", "Домашний робот, но он слышит всё", "Без роботов, но без лишних часов свободы", [50, 50]],
      ["", "Жить с AR-очками 24/7", "Жить без смартфона вообще", [50, 50]],
      ["", "Отдать ДНК в исследование", "Не отдавать и упустить лечение", [50, 50]],
      ["", "Дом на Марсе", "Дом у океана, но навсегда на Земле", [50, 50]],
    ],
  },
  {
    id: "travel",
    rating: "12+",
    tone: "bright",
    vibe: "party",
    items: [
      ["", "Каждый год новая страна, без дома", "Дом мечты, но максимум одна поездка в год", [50, 50]],
      ["", "Продать всё и жить в фургоне", "Остаться в офисе, но два отпуска в год", [50, 50]],
      ["", "2 месяца в Азии без связи", "2 недели в Норвегии, но в люксе", [50, 50]],
      ["", "Соло-путешествие на год", "Только с компанией, но короткие поездки", [50, 50]],
      ["", "Учить язык в стране год без работы", "Онлайн-курс, но без погружения", [50, 50]],
      ["", "Переехать в город мечты в одиночестве", "Остаться рядом с друзьями, жертвуя мечтой", [50, 50]],
      ["", "Фестиваль каждый месяц", "Уютные вечера дома всегда", [50, 50]],
      ["", "Год в Исландии", "Год на Бали", [50, 50]],
    ],
  },
  {
    id: "party",
    rating: "12+",
    tone: "party",
    vibe: "party",
    items: [
      ["", "Выходить на караоке каждую неделю", "Вести танцевальный тикток каждый день", [50, 50]],
      ["", "Всегда есть ультраострое", "Всегда без специй, даже в гости", [50, 50]],
      ["", "Всегда новый плейлист, никаких старых треков", "Только вечные любимые, без нового", [50, 50]],
      ["", "Приходить на свидания в образе супергероя", "Ходить на работу в пижаме", [50, 50]],
      ["", "Вечеринка без телефона вообще", "Телефон с собой, но без общения", [50, 50]],
      ["", "Всегда отвечать загадкой", "Говорить только сухие факты", [50, 50]],
      ["", "Быть мемом недели", "Остаться незаметным навсегда", [50, 50]],
      ["", "Только эксперименты в еде", "Только проверенная классика", [50, 50]],
    ],
  },
  {
    id: "social",
    rating: "12+",
    tone: "calm",
    vibe: "deep",
    items: [
      ["", "Удалить соцсети и потерять аудиторию", "Вести блог на миллион и жить на публике", [50, 50]],
      ["", "Отдавать 10% дохода на благотворительность", "Волонтёрить каждые выходные", [50, 50]],
      ["", "Модерировать токсичный чат соседей", "Игнорировать всех ради тишины", [50, 50]],
      ["", "Говорить о политике открыто", "Молчать, чтобы не потерять друзей", [50, 50]],
      ["", "Полностью без анонимности", "Анонимно, но с подозрением к тебе", [50, 50]],
      ["", "Стать ментором и отдавать время", "Прокачивать только себя", [50, 50]],
      ["", "Честный фидбек всегда, даже больно", "Держать при себе ради комфорта", [50, 50]],
      ["", "Работать в НКО за меньшие деньги", "Коммерция и донаты по минимуму", [50, 50]],
    ],
  },
  {
    id: "city",
    rating: "12+",
    tone: "life",
    vibe: "calm",
    items: [
      ["", "Питер: сырость, но дух", "Москва: скорость, но пробки", [50, 50]],
      ["", "20 этаж с видом, соседи неизвестны", "Дом за городом, но всё далеко", [50, 50]],
      ["", "Без машины, всё рядом", "Дальше от центра, но с авто", [50, 50]],
      ["", "Жить среди соседей-друзей", "Полная анонимность и тишина", [50, 50]],
      ["", "Минимализм: 30 вещей", "Уютный хомяк, полный дом вещей", [50, 50]],
      ["", "Коворкинг и шум, но движ", "Домашний офис, но одиночество", [50, 50]],
      ["", "Метро 24/7, но шум", "Тихий вело-город, но без ночной жизни", [50, 50]],
      ["", "Рядом с родителями", "Своя свобода в другом районе", [50, 50]],
    ],
  },
  {
    id: "wild",
    rating: "12+",
    tone: "adventure",
    vibe: "cool",
    items: [
      ["", "Неделя без интернета в глуши", "Неделя без горячей воды в городе", [50, 50]],
      ["", "Прыгнуть с парашютом", "Ночь в лесу в одиночку", [50, 50]],
      ["", "Скалолазание каждые выходные", "Дайвинг каждые выходные", [50, 50]],
      ["", "Жить при +35 круглый год", "Жить при -15 круглый год", [50, 50]],
      ["", "Год без самолётов, только поезд", "Только самолёты, никаких поездов", [50, 50]],
      ["", "Продать всё и уехать с двумя рюкзаками", "Остаться, но отдавать половину дохода на помощь", [50, 50]],
      ["", "Год без лифтов", "Год без доставки еды", [50, 50]],
      ["", "Жить с капсульным сном", "Делить комнату с другом", [50, 50]],
    ],
  },
  {
    id: "calm",
    rating: "0+",
    tone: "calm",
    vibe: "calm",
    items: [
      ["", "Медитация 20 минут в день", "Дневник каждый вечер без пропусков", [50, 50]],
      ["", "Год без новостей", "Один проверенный источник, но ежедневно", [50, 50]],
      ["", "Вечер без экранов", "Утро без экранов", [50, 50]],
      ["", "Отключить все уведомления", "Фильтровать, но знать всё", [50, 50]],
      ["", "25 часов работы в неделю", "40 часов, но 6 недель отпуска", [50, 50]],
      ["", "Жить без кофеина", "Жить без сахара", [50, 50]],
      ["", "Походы каждую субботу", "Музеи каждое воскресенье", [50, 50]],
      ["", "Тишина час утром", "Тишина час перед сном", [50, 50]],
    ],
  },
];

const PACK_DIFFICULTY = {
  health: "normal",
  money: "spicy",
  love: "spicy",
  ethics: "apocalypse",
  tech: "insane",
  future: "insane",
  travel: "normal",
  party: "spicy",
  social: "normal",
  city: "normal",
  wild: "insane",
  calm: "normal",
  life: "normal",
  custom: "normal",
};

const buildDilemmas = () => {
  const items = [];
  RAW_PACKS.forEach((pack) => {
    pack.items.forEach((row, idx) => {
      const [rawPrompt, left, right, baseline = pack.baseline || [50, 50]] = row;
      const prompt = typeof rawPrompt === "string" ? rawPrompt.trim() : "";
      items.push({
        id: `${pack.id}-${idx + 1}`,
        prompt: prompt || null,
        left,
        right,
        baseline,
        difficulty: PACK_DIFFICULTY[pack.id] || "normal",
      });
    });
  });
  return items;
};

const BASE_DILEMMAS = buildDilemmas();
const QUESTION_BUCKETS = (() => {
  const buckets = {};
  CHOICE_DIFFICULTIES.forEach((d) => {
    buckets[d.id] = [];
  });
  BASE_DILEMMAS.forEach((q) => {
    const level = buckets[q.difficulty] ? q.difficulty : "normal";
    buckets[level].push(q);
  });
  return buckets;
})();

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
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
};
const randomItem = (arr) => arr[Math.floor(Math.random() * arr.length)];
const todayKey = () => new Date().toISOString().slice(0, 10);

const initialChoiceRoster = (mode = "free") => {
  if (mode === "solo") {
    return Array.from({ length: 2 }).map((_, idx) => ({
      id: `c-${idx}`,
      name: `Игрок ${idx + 1}`,
      emoji: EMOJIS[idx % EMOJIS.length],
      color: PALETTE[idx % PALETTE.length],
    }));
  }
  return [];
};

const useHaptics = (enabled) =>
  useCallback(
    (style = "light") => {
      if (!enabled) return;
      try {
        window?.Telegram?.WebApp?.HapticFeedback?.impactOccurred?.(style);
      } catch {
        /* noop */
      }
    },
    [enabled]
  );

const useClickSound = (enabled) => {
  const ref = useRef(null);
  useEffect(() => {
    if (!enabled) return;
    const src =
      "data:audio/wav;base64,UklGRoQAAABXQVZFZm10IBAAAAABAAEAgD4AAAB9AAACABAAZGF0YVgAAAAA//8AAP//AAD//wAA//8AAP//AAD//wAA//8AAP//AAD//wAA//8AAP//AAD//wAA//8AAP//AAD//wAA";
    const a = new Audio(src);
    a.volume = 0.35;
    ref.current = a;
  }, [enabled]);

  return useCallback(() => {
    if (!enabled) return;
    const a = ref.current;
    if (!a) return;
    try {
      a.currentTime = 0;
      a.play();
    } catch {
      /* noop */
    }
  }, [enabled]);
};

export default function Choice({ goBack, onProgress, setBackHandler }) {
  const savedSettings = useMemo(
    () =>
      readPersisted(STORAGE_KEYS.settings, {
        mode: "free",
        sound: true,
        haptics: true,
        difficulty: "normal",
      }),
    []
  );
  const [settings, setSettings] = useState(savedSettings);
  const [roster, setRoster] = useState(() => {
    const saved = readPersisted(STORAGE_KEYS.roster, null);
    if (Array.isArray(saved) && saved.length) return saved;
    return initialChoiceRoster(savedSettings?.mode || "free");
  });
  const [stats, setStats] = useState(() =>
    readPersisted(STORAGE_KEYS.stats, { answered: 0, rare: 0, streak: 0, bestStreak: 0, perQuestion: {}, history: [] })
  );
  const [customList, setCustomList] = useState(() => readPersisted(STORAGE_KEYS.custom, []));
  const [daily, setDaily] = useState(() => {
    const saved = readPersisted(STORAGE_KEYS.daily, null);
    const key = todayKey();
    return saved?.date === key ? saved : { date: key, answered: 0, rare: 0, hard: 0 };
  });
  const [stage, setStage] = useState("intro");
  const [current, setCurrent] = useState(null);
  const [usedIds, setUsedIds] = useState([]);
  const [result, setResult] = useState(null);
  const [reveal, setReveal] = useState(false);
  const [toast, setToast] = useState("");
  const [turnIndex, setTurnIndex] = useState(0);
  const touchStartY = useRef(null);
  const autoNextRef = useRef(null);
  const progressGiven = useRef(false);

  const haptic = useHaptics(settings.haptics);
  const clickSound = useClickSound(settings.sound);
  const handleSettingChange = useCallback((key, value) => {
    setSettings((s) => ({ ...s, [key]: value }));
  }, []);
  const handleModeChange = useCallback((modeId) => {
    const allowed = CHOICE_MODES.some((m) => m.id === modeId) ? modeId : "free";
    setSettings((s) => ({ ...s, mode: allowed }));
    setRoster(initialChoiceRoster(allowed));
  }, []);
  const handleDifficultyChange = useCallback((id) => {
    const allowed = CHOICE_DIFFICULTIES.some((d) => d.id === id) ? id : "normal";
    setSettings((s) => ({ ...s, difficulty: allowed }));
  }, []);

  const pool = useMemo(() => {
    const customs = customList.map((c, idx) => ({
      ...c,
      id: c.id || `custom-${idx}`,
      baseline: c.baseline || [50, 50],
      difficulty: c.difficulty || "normal",
    }));
    const merged = [...BASE_DILEMMAS, ...customs];
    const difficultyOk = CHOICE_DIFFICULTIES.some((d) => d.id === settings.difficulty)
      ? settings.difficulty
      : "normal";
    const filtered = merged.filter((q) => q.difficulty === difficultyOk);
    return filtered.length ? filtered : merged;
  }, [settings.difficulty, customList]);
  const modeIsSolo = settings.mode === "solo";
  const minPlayers = modeIsSolo ? 2 : 0;

  const pickNext = useCallback(
    (force = false) => {
      if (!pool.length) return;
      setReveal(false);
      setResult(null);
      setTurnIndex((idx) => {
        if (!modeIsSolo || !roster.length) return 0;
        return force ? 0 : (idx + 1) % roster.length;
      });
      setUsedIds((prevUsed) => {
        const used = force ? [] : prevUsed;
        const available = pool.filter((q) => !used.includes(q.id));
        const source = !available.length ? pool : available;
        const next = randomItem(source);
        setCurrent(next);
        const updated = force || !available.length ? [next.id] : [...used, next.id];
        return updated.slice(-pool.length);
      });
    },
    [pool, modeIsSolo, roster.length]
  );

  useEffect(() => {
    if (stage !== "play") return;
    pickNext(true);
  }, [stage, pool, pickNext]);

  useEffect(() => {
    if (!setBackHandler) return undefined;
    setBackHandler(() => {
      if (stage === "play") {
        setStage("intro");
        setReveal(false);
        setResult(null);
        return;
      }
      goBack?.();
    });
    return () => setBackHandler(null);
  }, [setBackHandler, stage, goBack]);

  useEffect(() => persist(STORAGE_KEYS.settings, settings), [settings]);
  useEffect(() => persist(STORAGE_KEYS.stats, stats), [stats]);
  useEffect(() => persist(STORAGE_KEYS.custom, customList), [customList]);
  useEffect(() => persist(STORAGE_KEYS.daily, daily), [daily]);
  useEffect(() => persist(STORAGE_KEYS.roster, roster), [roster]);

  useEffect(() => {
    if (progressGiven.current) return;
    if (stats.answered >= 5) {
      onProgress?.();
      progressGiven.current = true;
    }
  }, [stats.answered, onProgress]);

  useEffect(
    () => () => {
      if (autoNextRef.current) clearTimeout(autoNextRef.current);
    },
    []
  );

  const startGame = () => {
    if (settings.mode === "solo" && roster.length < 2) {
      setToast("Добавь минимум 2 участника");
      return;
    }
    if (!pool.length) {
      setToast("Нет вопросов — выбери темы");
      return;
    }
    haptic("medium");
    clickSound();
    setUsedIds([]);
    setTurnIndex(0);
    setStage("play");
  };

  const handleAnswer = useCallback(
    (side) => {
      if (!current || reveal) return;
      haptic("light");
      clickSound();
      const baseline = current.baseline || [50, 50];
      const baseWeight = current.weight || 160;
      const prev = stats.perQuestion?.[current.id] || { a: 0, b: 0 };
      const aVotes = baseWeight * (baseline[0] / 100) + (side === 0 ? 1 : 0) + prev.a;
      const bVotes = baseWeight * (baseline[1] / 100) + (side === 1 ? 1 : 0) + prev.b;
      const total = Math.max(1, aVotes + bVotes);
      const pctA = Math.round((aVotes / total) * 100);
      const pctB = 100 - pctA;
      const rarePick = (side === 0 ? pctA : pctB) < 45;
      setResult({ side, pctA, pctB, rare: rarePick });
      setReveal(true);

      setStats((s) => {
        const perQuestion = {
          ...(s.perQuestion || {}),
          [current.id]: { a: prev.a + (side === 0 ? 1 : 0), b: prev.b + (side === 1 ? 1 : 0) },
        };
        const streak = rarePick ? (s.streak || 0) + 1 : 0;
        const historyItem = {
          id: current.id,
          prompt: current.prompt || null,
          left: current.left,
          right: current.right,
          side,
          pctA,
          pctB,
        };
        const history = [historyItem, ...(s.history || [])].slice(0, 8);
        return {
          ...s,
          answered: (s.answered || 0) + 1,
          rare: (s.rare || 0) + (rarePick ? 1 : 0),
          streak,
          bestStreak: Math.max(s.bestStreak || 0, streak),
          perQuestion,
          history,
        };
      });

      setDaily((d) => {
        const isToday = d.date === todayKey();
        return {
          date: todayKey(),
          answered: (isToday ? d.answered : 0) + 1,
          rare: (isToday ? d.rare : 0) + (rarePick ? 1 : 0),
          hard:
            (isToday ? d.hard : 0) +
            (current.difficulty === "insane" || current.difficulty === "apocalypse" ? 1 : 0),
        };
      });

      if (autoNextRef.current) clearTimeout(autoNextRef.current);
      autoNextRef.current = setTimeout(() => pickNext(), 1000);
    },
    [current, reveal, stats.perQuestion, pickNext, haptic, clickSound]
  );

  // --- Roster handlers (intro only)
  const changeName = (id, name) => {
    setRoster((list) => list.map((r) => (r.id === id ? { ...r, name } : r)));
  };
  const shuffleColor = (id) => {
    if (!modeIsSolo) return;
    setRoster((list) =>
      list.map((r) =>
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
    if (!modeIsSolo) return;
    setRoster((list) => {
      const idx = list.length;
      return [
        ...list,
        {
          id: `c-${idx}-${Date.now()}`,
          name: modeIsSolo ? `Игрок ${idx + 1}` : `Участник ${idx + 1}`,
          emoji: EMOJIS[idx % EMOJIS.length],
          color: PALETTE[idx % PALETTE.length],
        },
      ];
    });
  };
  const removeMember = (id) => {
    if (!modeIsSolo) return;
    setRoster((list) => {
      if (list.length <= minPlayers) return list;
      return list.filter((r) => r.id !== id);
    });
  };

  const handleTouchStart = (e) => {
    touchStartY.current = e.touches?.[0]?.clientY || null;
  };
  const handleTouchEnd = (e) => {
    if (touchStartY.current === null) return;
    const delta = (e.changedTouches?.[0]?.clientY || 0) - touchStartY.current;
    if (Math.abs(delta) > 45) {
      handleAnswer(delta > 0 ? 1 : 0); // вниз — нижний вариант
    }
    touchStartY.current = null;
  };

  const leftBg = "linear-gradient(135deg, #ef4444, #f97316)";
  const rightBg = "linear-gradient(135deg, #22d3ee, #3b82f6)";
  const activeMember = useMemo(() => {
    if (!modeIsSolo || !roster.length) return null;
    const idx = ((turnIndex % roster.length) + roster.length) % roster.length;
    return roster[idx];
  }, [modeIsSolo, roster, turnIndex]);
  const promptTitle = (() => {
    const name = modeIsSolo && activeMember?.name?.trim() ? activeMember.name.trim() : "";
    const story = current?.prompt?.trim();
    if (name && story) return `${name}, ${story}`;
    if (name) return `${name}, сделай выбор`;
    if (story) return story;
    return "Сделай выбор";
  })();
  const promptStyle = { "--prompt-from": "#ef4444", "--prompt-to": "#3b82f6" };

  return (
    <div className="choice">
      <div className="choice-bg">
        <div className="blob a" />
        <div className="blob b" />
        <div className="grain" />
      </div>
      <div className="choice-wrap">
        {stage === "intro" ? (
          <Landing
            onStart={startGame}
            onBack={() => goBack?.()}
            settings={settings}
            onChangeSetting={handleSettingChange}
            onModeChange={handleModeChange}
            onDifficultyChange={handleDifficultyChange}
            roster={roster}
            onShuffleColor={shuffleColor}
            onChangeName={changeName}
            onAddMember={addMember}
            onRemoveMember={removeMember}
          />
        ) : (
          <div className="play-vertical">
            <div className="play-head">
              <div className="prompt-card" style={promptStyle}>
                <div
                  style={{
                    color: "#f8fbff",
                    fontSize: "clamp(15px, 2.6vw, 18px)",
                    fontWeight: 800,
                    marginBottom: 4,
                  }}
                >
                  {promptTitle}
                </div>
              </div>
            </div>
            <div className="vertical-split" onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd}>
              <AnimatePresence mode="wait">
                <motion.button
                  key={`${current?.id}-top`}
                  className={`option-block top ${result?.side === 0 ? "picked" : ""}`}
                  style={{ background: leftBg }}
                  onClick={() => handleAnswer(0)}
                  initial={{ y: 20, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  exit={{ y: -10, opacity: 0 }}
                >
                  <div className="option-label">{current?.left}</div>
                </motion.button>
              </AnimatePresence>

              <div className="choice-or" aria-hidden="true">
                или
              </div>

              <AnimatePresence mode="wait">
                <motion.button
                  key={`${current?.id}-bottom`}
                  className={`option-block bottom ${result?.side === 1 ? "picked" : ""}`}
                  style={{ background: rightBg }}
                  onClick={() => handleAnswer(1)}
                  initial={{ y: 20, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  exit={{ y: -10, opacity: 0 }}
                >
                  <div className="option-label">{current?.right}</div>
                </motion.button>
              </AnimatePresence>
            </div>
          </div>
        )}
      </div>
      <Toast text={toast} onClose={() => setToast("")} />
    </div>
  );
}

function Landing({
  onStart,
  onBack,
  settings,
  onChangeSetting,
  onModeChange,
  onDifficultyChange,
  roster,
  onShuffleColor,
  onChangeName,
  onAddMember,
  onRemoveMember,
}) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [difficultyMenuOpen, setDifficultyMenuOpen] = useState(false);
  const difficultyTriggerRef = useRef(null);
  const difficultyMenuRef = useRef(null);
  const modeIsSolo = settings.mode === "solo";
  const minPlayers = modeIsSolo ? 2 : 1;
  const portalTarget = typeof document !== "undefined" ? document.body : null;
  const currentDifficulty = CHOICE_DIFFICULTIES.find((d) => d.id === settings.difficulty) || CHOICE_DIFFICULTIES[0];

  useEffect(() => {
    if (!difficultyMenuOpen) return undefined;
    const handleClick = (e) => {
      if (difficultyTriggerRef.current?.contains(e.target)) return;
      if (difficultyMenuRef.current?.contains(e.target)) return;
      setDifficultyMenuOpen(false);
    };
    const handleKey = (e) => {
      if (e.key === "Escape") setDifficultyMenuOpen(false);
    };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("touchstart", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("touchstart", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [difficultyMenuOpen]);

  const settingsModal = (
    <AnimatePresence>
      {settingsOpen && (
        <motion.div
          className="choice-settings-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          onClick={() => setSettingsOpen(false)}
        >
          <motion.div
            className="choice-settings-window"
            initial={{ y: 30, opacity: 0, scale: 0.98 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 14, opacity: 0, scale: 0.98 }}
            transition={{ type: "tween", ease: "easeOut", duration: 0.22 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="choice-settings-head">
              <div>
                <div className="choice-settings-title">Настройки подборки</div>
                <div className="choice-settings-sub">Свободный режим без команд — только вопросы</div>
              </div>
              <motion.button
                className="choice-settings-close"
                whileTap={{ scale: 0.95 }}
                whileHover={{ rotate: 4 }}
                onClick={() => setSettingsOpen(false)}
                aria-label="Закрыть настройки"
              >
                <X size={16} />
              </motion.button>
            </div>

            <div className="choice-settings-toggles">
              <button
                className={`choice-toggle-chip ${settings.sound ? "on" : ""}`}
                onClick={() => onChangeSetting?.("sound", !settings.sound)}
              >
                <Volume2 size={16} />
                Звук
                <span className="choice-toggle-dot" />
              </button>
              <button
                className={`choice-toggle-chip ${settings.haptics ? "on" : ""}`}
                onClick={() => onChangeSetting?.("haptics", !settings.haptics)}
              >
                <Sparkles size={16} />
                Вибро
                <span className="choice-toggle-dot" />
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );

  return (
    <div className="choice-home">
      {portalTarget ? createPortal(settingsModal, portalTarget) : settingsModal}

      <div className="choice-panel choice-hero-panel">
        <div className="choice-panel-head">
          <div>
            <p className="choice-eyebrow">Свободный режим</p>
            <div className="choice-panel-title">Выбор без команд</div>
            <p className="choice-panel-sub">Просто пачки вопросов, никаких участников. Залетайте в раунд и отвечайте.</p>
          </div>
        </div>

        <div className="choice-chips-row">
          {CHOICE_MODES.map((mode) => {
            const active = settings.mode === mode.id;
            return (
              <button
                key={mode.id}
                className={`choice-seg ${active ? "choice-seg-active" : ""}`}
                onClick={() => onModeChange?.(mode.id)}
                aria-pressed={active}
              >
                <span className="choice-seg-icon">{mode.badge}</span>
                <span className="choice-seg-text">
                  <span className="choice-seg-title">{mode.label}</span>
                </span>
              </button>
            );
          })}
        </div>

        <div className="choice-section-header">
          <div>
            <div className="choice-section-title">Сложность</div>
          </div>
          <div className="choice-diff-pill">
            <motion.button
              ref={difficultyTriggerRef}
              className={`choice-diff-pill-btn ${difficultyMenuOpen ? "open" : ""}`}
              whileTap={{ scale: 0.97 }}
              whileHover={{ y: -1 }}
              onClick={() => setDifficultyMenuOpen((prev) => !prev)}
              aria-haspopup="listbox"
              aria-expanded={difficultyMenuOpen}
              type="button"
            >
              <span className="choice-diff-emoji tiny">{currentDifficulty?.emoji}</span>
              <span className="choice-diff-pill-label">{currentDifficulty?.label}</span>
              <ChevronDown size={14} className="choice-diff-caret" />
            </motion.button>
            <AnimatePresence>
              {difficultyMenuOpen ? (
                <motion.div
                  ref={difficultyMenuRef}
                  className="choice-diff-menu"
                  role="listbox"
                  initial={{ opacity: 0, y: -6, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -6, scale: 0.98 }}
                  transition={{ duration: 0.16 }}
                >
                  {CHOICE_DIFFICULTIES.map((d) => {
                    const active = settings.difficulty === d.id;
                    return (
                      <button
                        key={d.id}
                        className={`choice-diff-menu-item ${active ? "on" : ""}`}
                        onClick={() => {
                          onDifficultyChange?.(d.id);
                          setDifficultyMenuOpen(false);
                        }}
                        aria-pressed={active}
                        role="option"
                        type="button"
                      >
                        <span className="choice-diff-emoji tiny">{d.emoji}</span>
                        <div className="choice-diff-menu-labels">
                          <span className="choice-diff-menu-title">{d.label}</span>
                          {active ? <span className="choice-diff-menu-tag">Текущий уровень</span> : null}
                        </div>
                        {active ? <Check size={14} /> : null}
                      </button>
                    );
                  })}
                </motion.div>
              ) : null}
            </AnimatePresence>
          </div>
        </div>

        {modeIsSolo ? (
          <>
            <div className="choice-section-header">
              <div>
                <div className="choice-section-title">Состав</div>
              </div>
            </div>
            <div className="choice-roster-list">
              {roster.map((item) => (
                <div className="choice-roster-row" key={item.id}>
                  <button
                    className="choice-avatar-btn"
                    style={{ background: item.color }}
                    onClick={() => onShuffleColor(item.id)}
                    aria-label="Сменить цвет"
                  >
                    {item.emoji}
                  </button>
                  <input
                    value={item.name}
                    onChange={(e) => onChangeName(item.id, e.target.value)}
                    maxLength={18}
                    aria-label="Имя"
                  />
                  <button
                    className="choice-icon-btn"
                    onClick={() => onRemoveMember(item.id)}
                    disabled={roster.length <= minPlayers}
                    aria-label="Удалить"
                    title="Удалить"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
              <button className="choice-ghost-line" onClick={onAddMember}>
                <Plus size={16} />
                Добавить участника
              </button>
            </div>
          </>
        ) : null}

        <div className="choice-hero-actions">
          <button className="choice-gear hero" onClick={() => setSettingsOpen(true)} aria-label="Настройки">
            <span className="choice-gear-inner">
              <Settings size={18} />
            </span>
            <span className="choice-gear-glow" />
          </button>
          <button className="choice-primary" onClick={onStart}>
            <Sparkles size={18} />
            Играть
          </button>
        </div>
      </div>
    </div>
  );
}

function Toast({ text, onClose }) {
  useEffect(() => {
    if (!text) return;
    const id = setTimeout(onClose, 1600);
    return () => clearTimeout(id);
  }, [text, onClose]);

  return (
    <AnimatePresence>
      {text ? (
        <motion.div
          className="toast"
          initial={{ y: 40, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 40, opacity: 0 }}
        >
          {text}
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
