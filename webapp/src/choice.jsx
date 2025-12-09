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
      ["Что вычеркнешь ради тонуса?", "Год без сахара", "Год без кофе", [56, 44]],
      ["Как начинаешь утро?", "Тренировка 40 минут", "Лишний час сна", [52, 48]],
      ["Какой режим берёшь?", "Подъём в 6:00, ранние вечера", "Ночной ритм до 2:00", [61, 39]],
      ["Ради здоровья", "10 000 шагов ежедневно", "Всегда машина, но время на себя", [58, 42]],
      ["Про еду", "Готовить дома 90% времени", "Есть вне дома, не готовить", [47, 53]],
      ["Про комфорт", "Холодный душ каждое утро", "Тёплая ванна, но без кофеина", [45, 55]],
      ["На годы вперёд", "Алкоголь навсегда в стоп-листе", "Алкоголь только по пятницам, но без сахара", [62, 38]],
      ["Спорт-план", "30 минут ежедневно", "3 тяжёлые тренировки в неделю", [50, 50]],
      ["Рабочее место", "Работать стоя за столом", "Идеальное кресло, но весь день сидя", [49, 51]],
      ["Локация жизни", "Эко-деревня и чистый воздух", "Центр города и ночная жизнь", [46, 54]],
      ["Привычки", "Жить без фастфуда", "Жить без газировки", [55, 45]],
      ["Сон", "Строгий график 23:00–7:00", "Флекс-режим, но хронический недосып", [68, 32]],
    ],
  },
  {
    id: "money",
    rating: "12+",
    tone: "ethics",
    vibe: "bright",
    items: [
      ["Формат недели", "4 дня по 10 часов", "6 дней по 6 часов", [57, 43]],
      ["Стабильность или риск", "Фикс 250к и тихо", "Фриланс 350к ±", [52, 48]],
      ["Карьера", "Стартап с шансом на x10", "Синьор в корпорации", [44, 56]],
      ["Публичность", "Быть медийным лидом", "Тихий архитектор с влиянием", [48, 52]],
      ["Любимая vs деньги", "Любимая работа за средние деньги", "Нелюбимая за большие", [59, 41]],
      ["Формат офиса", "Удалёнка навсегда", "Офис, но топовая команда", [55, 45]],
      ["Где жить", "Работа за рубежом, далеко от семьи", "Остаться рядом, карьерный рост медленнее", [47, 53]],
      ["Климат", "Переезд в холодный город с высоким доходом", "Тёплый климат, доход ниже", [50, 50]],
      ["Пауза", "Карьерный отпуск на год", "Продолжить и расти", [41, 59]],
      ["Опенсорс", "Открыть код ради комьюнити", "Спрятать ради преимущества", [63, 37]],
      ["Смена курса", "Учиться с нуля в новой профессии", "Остаться в сильной позиции", [45, 55]],
      ["Ритм", "Митинги весь день, но продвижение", "Глубокая работа без роста", [38, 62]],
    ],
  },
  {
    id: "love",
    rating: "12+",
    tone: "calm",
    vibe: "warm",
    items: [
      ["Отношения", "Любовь на расстоянии", "Рядом, но мало времени", [36, 64]],
      ["Честность", "Сказать правду и рискнуть конфликтом", "Промолчать ради мира", [68, 32]],
      ["План vs спонтан", "Планировать заранее", "Жить спонтанно, как партнёр", [49, 51]],
      ["Съехаться?", "Жить вместе сразу", "Год раздельно, потом съехаться", [53, 47]],
      ["Бюджет", "Общий бюджет", "Раздельные финансы", [55, 45]],
      ["Переезд", "Уехать к партнёру", "Партнёр переезжает к тебе", [46, 54]],
      ["Формат отношений", "Открытые отношения", "Классические", [21, 79]],
      ["Дом", "Завести питомца", "Путешествовать без привязки", [58, 42]],
      ["Свадьба", "Праздник на 20 человек", "На 200 человек", [62, 38]],
      ["Цифровая диета", "Удалить соцсети вдвоём", "Оставить соцсети, но меньше времени вместе", [48, 52]],
      ["Семья", "Дети скоро", "Отложить на 5 лет", [42, 58]],
      ["Карьерный шаг", "Поменять карьеру ради партнёра", "Сохранить свою траекторию", [33, 67]],
    ],
  },
  {
    id: "ethics",
    rating: "16+",
    tone: "ethics",
    vibe: "deep",
    items: [
      ["Лояльность", "Сдать друга ради команды", "Рискнуть проектом ради друга", [29, 71]],
      ["Честность", "Сообщить о читерстве коллеги", "Промолчать ради команды", [64, 36]],
      ["Команда", "Уволить слабое звено", "Дать шанс и потерять дедлайн", [47, 53]],
      ["ИИ на работе", "Заменить 5 людей ИИ", "Оставить команду, продукт медленнее", [55, 45]],
      ["Данные", "Собирать больше данных пользователей", "Отказаться и отстать от конкурентов", [42, 58]],
      ["Этика денег", "Взять заказ от сомнительного клиента", "Отказаться и потерять прибыль", [28, 72]],
      ["Семья", "Взять кредит ради помощи родителям", "Оставить им решать самим", [61, 39]],
      ["Дедлайн", "Не говорить о критичном баге", "Остановить релиз и признаться", [68, 32]],
      ["Громкое дело", "Подписать NDA и молчать", "Говорить с журналистами", [52, 48]],
      ["Реклама", "Продвигать продукт с спорными нюансами", "Отказаться от кампании", [34, 66]],
      ["Бонус", "Отдать часть бонуса команде", "Оставить всё себе", [73, 27]],
      ["Характер", "Взять токсичного, но гениального", "Взять средний, но добрый", [22, 78]],
    ],
  },
  {
    id: "tech",
    rating: "12+",
    tone: "future",
    vibe: "cool",
    items: [
      ["Гаджеты", "Имплант памяти", "Цифровой детокс каждую весну", [44, 56]],
      ["Метаверс", "8 часов в метавселенной", "Оффлайн комьюнити каждый день", [23, 77]],
      ["Приватность", "Полная аналитика данных о себе", "Полная приватность, но без сервисов", [41, 59]],
      ["Дом", "Домашний робот +2 часа свободы", "Без робота, но +2 часа дохода", [52, 48]],
      ["Автопилот", "Доверить автопилоту детей", "Водить только самому", [35, 65]],
      ["Новый дом", "Дом на Марсе", "Дом у океана на Земле", [27, 73]],
      ["Еда", "Подписка на порошковую еду", "Всегда готовить вручную", [19, 81]],
      ["Связь", "Жить без смартфона", "Всегда с AR-очками", [33, 67]],
      ["Исследования", "Отдать ДНК в исследование", "Не участвовать вообще", [46, 54]],
      ["Ассистент", "Голосовой ассистент слушает всё", "Приватность, но всё вручную", [39, 61]],
      ["Энергия", "Своя солнечная ферма", "Квартира в городе, но сервисы", [58, 42]],
      ["Робот-компаньон", "Жить с роботом", "Только люди, никакой роботики дома", [18, 82]],
    ],
  },
  {
    id: "travel",
    rating: "12+",
    tone: "bright",
    vibe: "party",
    items: [
      ["Свобода или дом", "Каждый год новая страна", "Дом мечты, но меньше поездок", [55, 45]],
      ["Отпуска", "Один длинный отпуск", "Три мини-отпуска", [37, 63]],
      ["Локация", "Жить у моря", "Жить в горах", [54, 46]],
      ["Мобильность", "Фургон и жизнь в дороге", "Офис, но 2 отпуска в год", [42, 58]],
      ["Работа", "Работать на круизном лайнере", "Стартап дома", [24, 76]],
      ["Азия vs север", "2 месяца в Азии", "2 недели в Норвегии", [48, 52]],
      ["Формат", "Соло-путешествие", "Только с компанией", [51, 49]],
      ["Язык", "Год учить язык в стране", "Онлайн без переезда", [63, 37]],
      ["Переезд", "Город мечты, но один", "Близко к друзьям", [43, 57]],
      ["Городской стиль", "Город с метро 24/7", "Тихий вело-город", [57, 43]],
      ["Север/юг", "Год в Исландии", "Год в Бали", [46, 54]],
      ["Экстрим", "Походы с палаткой", "Комфортные отели", [39, 61]],
    ],
  },
  {
    id: "party",
    rating: "12+",
    tone: "party",
    vibe: "party",
    items: [
      ["Кухня", "Всегда есть острое", "Всегда без специй", [33, 67]],
      ["Музыка", "Каждый день новый плейлист", "Вечные любимые треки", [58, 42]],
      ["Кофе", "Только лёд-латте по утрам", "Только горячий, но без сахара", [46, 54]],
      ["Образ", "Плащ супергероя на свидания", "Пижама на работу", [27, 73]],
      ["Сцена", "Караоке раз в неделю", "Танцы тикток каждый день", [41, 59]],
      ["Гаджеты", "Вечеринка без телефона", "С телефоном, но без общения", [69, 31]],
      ["Стиль общения", "Всегда отвечать загадкой", "Говорить только фактами", [14, 86]],
      ["Популярность", "Быть мемом недели", "Остаться незаметным", [53, 47]],
      ["Еда", "Всегда экспериментальные блюда", "Классика без риска", [35, 65]],
      ["Обувь", "Всю жизнь в кроссах", "Только классические туфли", [72, 28]],
      ["Формат отдыха", "Фестиваль каждый месяц", "Уютные вечера дома", [38, 62]],
      ["Соцсети", "Селфи с незнакомцем в день", "Всегда звать друга для фото", [44, 56]],
    ],
  },
  {
    id: "social",
    rating: "12+",
    tone: "calm",
    vibe: "deep",
    items: [
      ["Онлайн", "Удалить соцсети", "Вести блог на миллион", [47, 53]],
      ["Помощь", "Отдавать 10% дохода", "Волонтёрить по выходным", [52, 48]],
      ["Соседи", "Активно в соседском чате", "Игнор ради тишины", [29, 71]],
      ["Обучение", "Учить соседских детей кодить", "Организовывать двор-спорт", [55, 45]],
      ["Гражданская активность", "Ходить на выборы всегда", "Локальные инициативы вместо выборов", [42, 58]],
      ["Комьюнити", "Модерировать чат", "Быть пассивным, но без негатива", [33, 67]],
      ["Политота", "Говорить открыто", "Держать при себе", [61, 39]],
      ["Анонимность", "Полностью без анонимности", "Анонимно, но меньше доверия", [46, 54]],
      ["Менторство", "Стать ментором", "Прокачивать только себя", [64, 36]],
      ["Тосты", "Тост на каждой встрече", "Молчать и слушать", [32, 68]],
      ["Работа", "Работать в НКО за меньше", "Коммерция и донаты", [58, 42]],
      ["Обратная связь", "Всегда давать фидбек честно", "Держать при себе ради комфорта", [49, 51]],
    ],
  },
  {
    id: "city",
    rating: "12+",
    tone: "life",
    vibe: "calm",
    items: [
      ["Куда переехать", "Питер: сырость, но дух", "Москва: пробки, но скорость", [51, 49]],
      ["Высота", "20 этаж, вид", "Дом за городом", [57, 43]],
      ["Локация", "Без машины, всё рядом", "Дальше, но с авто", [65, 35]],
      ["Соседи", "Соседи-друзья", "Анонимность", [48, 52]],
      ["Вид", "На парк", "На небоскрёбы", [55, 45]],
      ["Транспорт", "Метро 24/7", "Идеальный транспорт днём", [62, 38]],
      ["Социализация", "Общие кухни и посиделки", "Кофейни каждый день", [31, 69]],
      ["Работа", "Коворкинг", "Домашний офис", [36, 64]],
      ["Стиль жизни", "Минимализм 30 вещей", "Уютный хомяк", [45, 55]],
      ["Семья", "Рядом с родителями", "Своя свобода в другом районе", [44, 56]],
      ["Масштаб", "Мегаполис", "Средний город", [58, 42]],
      ["Ритм", "Короткие, но насыщенные будни", "Длинные, спокойные вечера", [52, 48]],
    ],
  },
  {
    id: "wild",
    rating: "12+",
    tone: "adventure",
    vibe: "cool",
    items: [
      ["Комфорт", "Неделя без интернета", "Неделя без горячей воды", [52, 48]],
      ["Выживание", "Остров с лучшим другом", "Отель с токсичными людьми", [69, 31]],
      ["Спорт", "Скалолазание по выходным", "Дайвинг по выходным", [47, 53]],
      ["Экстрим", "Прыжок с парашютом", "Ночь в лесу с палаткой", [61, 39]],
      ["Работа", "Спасатель", "Пожарный", [43, 57]],
      ["Климат", "Жить при +35", "Жить при -15", [46, 54]],
      ["Ресурсы", "Неделя на минимальном бюджете", "Меньше сна, но комфорт", [34, 66]],
      ["Радикально", "Продать всё, два рюкзака", "Остаться, но помогать другим", [28, 72]],
      ["Лифт", "Год без лифтов", "Год без доставки еды", [57, 43]],
      ["Сон", "Спать в капсуле", "Делить комнату с другом", [52, 48]],
      ["Питание", "Только фермерские продукты", "Только магазин у дома", [55, 45]],
      ["Скорость", "Жизнь без самолётов", "Только самолёты, никакого поезда", [37, 63]],
    ],
  },
  {
    id: "calm",
    rating: "0+",
    tone: "calm",
    vibe: "calm",
    items: [
      ["Привычка", "Медитация 10 минут в день", "Дневник каждый вечер", [44, 56]],
      ["Инфо-диета", "Год без новостей", "Один проверенный источник", [48, 52]],
      ["Экран-тайм", "Вечер без экранов", "Утро без экранов", [41, 59]],
      ["Уведомления", "Отключить все", "Фильтровать, но знать всё", [64, 36]],
      ["Работа/отдых", "25 часов в неделю", "40 часов, но 6 недель отпуска", [45, 55]],
      ["Кофе/сахар", "Жить без кофеина", "Жить без сахара", [31, 69]],
      ["Выходные", "Походы каждую субботу", "Музеи каждое воскресенье", [53, 47]],
      ["Про хобби", "Своя теплица", "Домашняя студия музыки", [57, 43]],
      ["Тишина", "Час тишины утром", "Час тишины перед сном", [52, 48]],
      ["Соцсети", "По расписанию", "Без ограничений, но мониторинг", [66, 34]],
      ["Темп", "Жить медленнее, меньше задач", "Жить быстрее, больше впечатлений", [47, 53]],
      ["Фокус", "Одно дело в день", "Многозадачность ради прогресса", [38, 62]],
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
      const [, left, right, baseline = pack.baseline || [50, 50]] = row;
      items.push({
        id: `${pack.id}-${idx + 1}`,
        prompt: null,
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
          prompt: null,
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
  const promptTitle = modeIsSolo && activeMember?.name?.trim()
    ? `${activeMember.name.trim()}, что бы ты выбрал?`
    : "Что бы ты выбрал?";
  const promptQuestion = "Выбери вариант";
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
                    color: "#c3d2e1",
                    fontSize: "clamp(15px, 2.6vw, 18px)",
                    fontWeight: 700,
                    marginBottom: 4,
                  }}
                >
                  {promptTitle}
                </div>
                <div style={{ fontSize: "clamp(22px, 4vw, 28px)", fontWeight: 800, lineHeight: 1.15 }}>{promptQuestion}</div>
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
