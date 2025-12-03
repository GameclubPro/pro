import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowLeft,
  Check,
  Flame,
  Heart,
  Lightbulb,
  Plus,
  Share2,
  Shuffle,
  SlidersHorizontal,
  Sparkles,
  Star,
  Trophy,
  Volume2,
  VolumeX,
  Zap,
} from "lucide-react";
import "./choice.css";

const STORAGE_KEYS = {
  settings: "pt_choice_settings_v1",
  stats: "pt_choice_stats_v1",
  custom: "pt_choice_custom_v1",
  daily: "pt_choice_daily_v1",
};

const THEMES = {
  health: { label: "ЗОЖ", icon: "💪" },
  money: { label: "Карьера", icon: "💼" },
  love: { label: "Отношения", icon: "💞" },
  ethics: { label: "Мораль", icon: "⚖️" },
  tech: { label: "Технологии", icon: "🤖" },
  future: { label: "Будущее", icon: "🚀" },
  travel: { label: "Путешествия", icon: "✈️" },
  party: { label: "Фан", icon: "🎉" },
  social: { label: "Социум", icon: "🌐" },
  city: { label: "Город", icon: "🏙️" },
  wild: { label: "Экстрим", icon: "🧭" },
  calm: { label: "Осознанность", icon: "🧘" },
  life: { label: "Быт", icon: "🏠" },
  custom: { label: "Свои", icon: "✨" },
};

const MODE_OPTIONS = [
  { id: "classic", title: "Классика", desc: "баланс фан + смысл", icon: Sparkles },
  { id: "hard", title: "Хард", desc: "мораль и выбор боли", icon: Flame },
  { id: "local", title: "Лайфстайл", desc: "про быт и отношения", icon: Heart },
  { id: "party", title: "Пати", desc: "абсурд и мемы", icon: Zap },
  { id: "calm", title: "Спокойно", desc: "без жёстких углов", icon: Lightbulb },
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

const PALETTES = {
  health: ["#16a34a", "#22d3ee"],
  money: ["#22d3ee", "#6366f1"],
  love: ["#ec4899", "#f97316"],
  ethics: ["#8b5cf6", "#22d3ee"],
  tech: ["#38bdf8", "#6366f1"],
  future: ["#22d3ee", "#84cc16"],
  travel: ["#06b6d4", "#0ea5e9"],
  party: ["#f97316", "#ec4899"],
  social: ["#f59e0b", "#ef4444"],
  city: ["#6366f1", "#06b6d4"],
  wild: ["#ef4444", "#f59e0b"],
  calm: ["#14b8a6", "#22d3ee"],
  life: ["#0ea5e9", "#10b981"],
  custom: ["#a855f7", "#f472b6"],
};

const buildDilemmas = () => {
  const items = [];
  RAW_PACKS.forEach((pack) => {
    pack.items.forEach((row, idx) => {
      const [prompt, left, right, baseline = pack.baseline || [50, 50], tone = pack.tone, note = null] = row;
      items.push({
        id: `${pack.id}-${idx + 1}`,
        prompt,
        left,
        right,
        theme: pack.id,
        rating: pack.rating,
        tone,
        vibe: pack.vibe,
        baseline,
        note: note || pack.note || null,
      });
    });
  });
  return items;
};

const BASE_DILEMMAS = buildDilemmas();
const BASE_MAP = new Map(BASE_DILEMMAS.map((q) => [q.id, q]));

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

const paletteFor = (theme, vibe) => {
  if (vibe === "party") return ["#f97316", "#ec4899"];
  if (vibe === "calm") return ["#14b8a6", "#22c55e"];
  if (vibe === "deep") return ["#312e81", "#0ea5e9"];
  return PALETTES[theme] || ["#22d3ee", "#8b5cf6"];
};

const buildMissions = (daily) => [
  { id: "m-answers", text: "Ответь на 12 дилемм", target: 12, value: daily.answered || 0 },
  { id: "m-rare", text: "Сделай 3 редких выбора", target: 3, value: daily.rare || 0 },
  { id: "m-hard", text: "Закрой 5 жёстких вопросов", target: 5, value: daily.hard || 0 },
];

export default function Choice({ goBack, onProgress, setBackHandler }) {
  const [settings, setSettings] = useState(() =>
    readPersisted(STORAGE_KEYS.settings, {
      mode: "classic",
      autoNext: false,
      sound: true,
      haptics: true,
      selectedThemes: Object.keys(THEMES),
    })
  );
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
  const [form, setForm] = useState({ prompt: "", left: "", right: "" });
  const touchStartX = useRef(null);
  const autoNextRef = useRef(null);
  const progressGiven = useRef(false);

  const haptic = useHaptics(settings.haptics);
  const clickSound = useClickSound(settings.sound);

  const questionMap = useMemo(() => {
    const map = new Map(BASE_MAP);
    customList.forEach((c) => map.set(c.id, c));
    return map;
  }, [customList]);

  const pool = useMemo(() => {
    const customs = customList.map((c, idx) => ({
      ...c,
      id: c.id || `custom-${idx}`,
      theme: "custom",
      rating: c.rating || "12+",
      tone: c.tone || "party",
      vibe: c.vibe || "calm",
      baseline: c.baseline || [50, 50],
    }));
    const merged = [...BASE_DILEMMAS, ...customs];
    const themeSet = new Set(settings.selectedThemes || []);
    const matchesMode = (q) => {
      if (settings.mode === "hard") return q.tone === "ethics" || q.rating === "16+";
      if (settings.mode === "party") return q.tone === "party" || q.theme === "party";
      if (settings.mode === "local") return ["health", "life", "money", "love", "city", "social", "calm"].includes(q.theme);
      if (settings.mode === "calm") return q.tone === "calm" || q.vibe === "calm";
      return true;
    };
    const filtered = merged.filter((q) => {
      const themeOk = !themeSet.size || themeSet.has(q.theme);
      return themeOk && matchesMode(q);
    });
    return filtered.length ? filtered : merged;
  }, [settings.selectedThemes, settings.mode, customList]);

  const missions = useMemo(() => buildMissions(daily), [daily]);

  const themeStats = useMemo(() => {
    const res = {};
    Object.entries(stats.perQuestion || {}).forEach(([id, counts]) => {
      const q = questionMap.get(id);
      if (!q) return;
      res[q.theme] = (res[q.theme] || 0) + (counts?.a || 0) + (counts?.b || 0);
    });
    return res;
  }, [stats.perQuestion, questionMap]);

  const topThemes = useMemo(
    () => Object.entries(themeStats).sort((a, b) => b[1] - a[1]).slice(0, 3),
    [themeStats]
  );

  const rareRate = stats.answered ? Math.round((stats.rare / stats.answered) * 100) : 0;

  const pickNext = useCallback(
    (force = false) => {
      if (!pool.length) return;
      setReveal(false);
      setResult(null);
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
    [pool]
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
    if (!pool.length) return;
    haptic("medium");
    clickSound();
    setUsedIds([]);
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
          prompt: current.prompt,
          theme: current.theme,
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
          hard: (isToday ? d.hard : 0) + (current.tone === "ethics" || current.rating === "16+" ? 1 : 0),
        };
      });

      if (settings.autoNext) {
        if (autoNextRef.current) clearTimeout(autoNextRef.current);
        autoNextRef.current = setTimeout(() => pickNext(), 1200);
      }
    },
    [current, reveal, stats.perQuestion, settings.autoNext, pickNext, haptic, clickSound]
  );

  const handleShare = async () => {
    if (!current || !result) return;
    const leftPicked = result.side === 0;
    const text = `Игра «Выбор»: ${current.prompt}\nЯ выбрал: ${leftPicked ? current.left : current.right} (${leftPicked ? result.pctA : result.pctB}% со мной)\nПопробуй тоже.`;
    try {
      if (navigator?.share) {
        await navigator.share({ title: "Мой выбор", text });
      } else if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        setToast("Скопировано в буфер обмена");
      } else {
        setToast("Поделиться не вышло :(");
      }
    } catch {
      setToast("Поделиться не вышло :(");
    }
  };

  const handleSkip = () => {
    haptic("soft");
    clickSound();
    pickNext();
  };

  const handleThemeToggle = (key) => {
    setSettings((s) => {
      const set = new Set(s.selectedThemes || []);
      if (set.has(key)) {
        set.delete(key);
      } else {
        set.add(key);
      }
      return { ...s, selectedThemes: Array.from(set) };
    });
  };

  const handleAddCustom = () => {
    const prompt = form.prompt.trim();
    const left = form.left.trim();
    const right = form.right.trim();
    if (!prompt || !left || !right) {
      setToast("Нужны вопрос и оба варианта");
      return;
    }
    const item = {
      id: `custom-${Date.now().toString(36)}`,
      prompt,
      left,
      right,
      theme: "custom",
      rating: "12+",
      tone: "party",
      vibe: "calm",
      baseline: [50, 50],
    };
    setCustomList((list) => [item, ...list].slice(0, 50));
    setForm({ prompt: "", left: "", right: "" });
    setToast("Добавили в колоду");
  };

  const handleTouchStart = (e) => {
    touchStartX.current = e.touches?.[0]?.clientX || null;
  };
  const handleTouchEnd = (e) => {
    if (touchStartX.current === null) return;
    const delta = (e.changedTouches?.[0]?.clientX || 0) - touchStartX.current;
    if (Math.abs(delta) > 45) {
      handleAnswer(delta > 0 ? 1 : 0);
    }
    touchStartX.current = null;
  };

  const palette = paletteFor(current?.theme, current?.vibe);
  const leftBg = `linear-gradient(135deg, ${palette[0]}, rgba(4, 16, 23, 0.12))`;
  const rightBg = `linear-gradient(135deg, ${palette[1]}, rgba(4, 16, 23, 0.12))`;

  return (
    <div className="choice">
      <div className="choice-bg">
        <div className="blob a" />
        <div className="blob b" />
        <div className="grain" />
      </div>
      <div className="choice-shell">
        <div className="choice-top">
          <button className="ghost" onClick={() => (stage === "intro" ? goBack?.() : setStage("intro"))}>
            <ArrowLeft size={18} />
            <span>Назад</span>
          </button>
          <div className="top-metrics">
            <span>Ответов: {stats.answered || 0}</span>
            <span>Редких: {stats.rare || 0}</span>
            <span>Стрик: {stats.streak || 0}</span>
          </div>
          <div className="top-actions">
            <button
              className="icon"
              onClick={() => setSettings((s) => ({ ...s, sound: !s.sound }))}
              aria-label="Звук"
            >
              {settings.sound ? <Volume2 size={18} /> : <VolumeX size={18} />}
            </button>
            <button
              className="icon"
              onClick={() => setSettings((s) => ({ ...s, haptics: !s.haptics }))}
              aria-label="Вибро"
            >
              <Sparkles size={18} />
            </button>
          </div>
        </div>

        {stage === "intro" ? (
          <Landing
            onStart={startGame}
            themes={THEMES}
            selectedThemes={settings.selectedThemes}
            onToggleTheme={handleThemeToggle}
          />
        ) : (
          <div className="choice-layout">
            <div className="choice-main">
              <div className="eyebrow-row">
                <span className="eyebrow-chip">
                  {THEMES[current?.theme]?.icon} {THEMES[current?.theme]?.label || "Тема"}
                </span>
                <span className="eyebrow-chip">{current?.rating || "12+"}</span>
                <span className="eyebrow-chip">{settings.mode}</span>
              </div>

              <div className="question-card">
                <div className="question-head">
                  <div>
                    <p className="label">Дилемма</p>
                    <h2>{current?.prompt}</h2>
                    {current?.note ? <p className="muted">{current.note}</p> : null}
                  </div>
                  <div className="streak-pill">
                    <Star size={16} />
                    <span>Серия {stats.streak || 0}</span>
                  </div>
                </div>

                <div
                  className={`split ${reveal ? "is-reveal" : ""}`}
                  onTouchStart={handleTouchStart}
                  onTouchEnd={handleTouchEnd}
                >
                  <AnimatePresence mode="wait">
                    <motion.button
                      key={`${current?.id}-left`}
                      className={`side left ${result?.side === 0 ? "picked" : ""}`}
                      style={{ background: leftBg }}
                      onClick={() => handleAnswer(0)}
                      initial={{ y: 20, opacity: 0 }}
                      animate={{ y: 0, opacity: 1 }}
                      exit={{ y: -10, opacity: 0 }}
                    >
                      <div className="side-label">{current?.left}</div>
                      <div className="side-sub">свайп влево</div>
                      {reveal ? (
                        <motion.div
                          className="pct"
                          initial={{ scale: 0.8, opacity: 0 }}
                          animate={{ scale: 1, opacity: 1 }}
                        >
                          {result?.pctA}%
                        </motion.div>
                      ) : null}
                    </motion.button>
                  </AnimatePresence>

                  <AnimatePresence mode="wait">
                    <motion.button
                      key={`${current?.id}-right`}
                      className={`side right ${result?.side === 1 ? "picked" : ""}`}
                      style={{ background: rightBg }}
                      onClick={() => handleAnswer(1)}
                      initial={{ y: 20, opacity: 0 }}
                      animate={{ y: 0, opacity: 1 }}
                      exit={{ y: -10, opacity: 0 }}
                    >
                      <div className="side-label">{current?.right}</div>
                      <div className="side-sub">свайп вправо</div>
                      {reveal ? (
                        <motion.div
                          className="pct"
                          initial={{ scale: 0.8, opacity: 0 }}
                          animate={{ scale: 1, opacity: 1 }}
                        >
                          {result?.pctB}%
                        </motion.div>
                      ) : null}
                    </motion.button>
                  </AnimatePresence>
                </div>

                {reveal ? (
                  <div className="bars">
                    <div className="bar">
                      <div className="bar-fill" style={{ width: `${result?.pctA || 0}%` }} />
                      <span>{current?.left}</span>
                    </div>
                    <div className="bar">
                      <div className="bar-fill alt" style={{ width: `${result?.pctB || 0}%` }} />
                      <span>{current?.right}</span>
                    </div>
                    {result?.rare ? <div className="rare">Редкий выбор! +1 к серии</div> : null}
                  </div>
                ) : (
                  <p className="hint">Нажми или свайпай сторону. Потом увидишь проценты.</p>
                )}

                <div className="actions">
                  <button className="ghost" onClick={handleSkip}>
                    <Shuffle size={16} />
                    Пропуск
                  </button>
                  <button className="ghost" onClick={() => setSettings((s) => ({ ...s, autoNext: !s.autoNext }))}>
                    <SlidersHorizontal size={16} />
                    Авто-next: {settings.autoNext ? "вкл" : "выкл"}
                  </button>
                  <button className="ghost" onClick={handleShare}>
                    <Share2 size={16} />
                    Поделиться
                  </button>
                  <button className="primary" onClick={() => pickNext(true)}>
                    Дальше
                  </button>
                </div>
              </div>

              <div className="badge-row">
                <Badge icon={<Trophy size={16} />} label="Лучшая серия" value={`${stats.bestStreak || 0}`} />
                <Badge icon={<Sparkles size={16} />} label="Редких ответов" value={`${rareRate}%`} />
                <Badge icon={<Heart size={16} />} label="День" value={`${daily.answered || 0}/12`} />
              </div>

              <History history={stats.history} questionMap={questionMap} />
            </div>

            <aside className="choice-side">
              <Panel title="Режим" subtitle="под настроение">
                <div className="mode-grid">
                  {MODE_OPTIONS.map((m) => {
                    const Icon = m.icon;
                    const active = settings.mode === m.id;
                    return (
                      <button
                        key={m.id}
                        className={`mode ${active ? "active" : ""}`}
                        onClick={() => setSettings((s) => ({ ...s, mode: m.id }))}
                      >
                        <Icon size={16} />
                        <div>
                          <div className="mode-title">{m.title}</div>
                          <div className="mode-sub">{m.desc}</div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </Panel>

              <Panel title="Темы" subtitle="микс по вкусу">
                <div className="chips">
                  {Object.entries(THEMES).map(([key, value]) => {
                    const active = (settings.selectedThemes || []).includes(key);
                    return (
                      <button
                        key={key}
                        className={`chip ${active ? "chip-active" : ""}`}
                        onClick={() => handleThemeToggle(key)}
                      >
                        <span>{value.icon}</span>
                        {value.label}
                      </button>
                    );
                  })}
                </div>
              </Panel>

              <Panel title="Миссии дня" subtitle={daily.date}>
                <div className="missions">
                  {missions.map((m) => (
                    <div key={m.id} className="mission">
                      <div className="mission-head">
                        <span>{m.text}</span>
                        <span className="muted">
                          {m.value}/{m.target}
                        </span>
                      </div>
                      <div className="mission-bar">
                        <div
                          className="mission-fill"
                          style={{ width: `${clamp((m.value / m.target) * 100, 0, 100)}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </Panel>

              <Panel title="Бейджи" subtitle="динамика">
                <div className="badges">
                  <Badge icon={<Flame size={14} />} label="Текущая серия" value={`${stats.streak || 0}`} />
                  <Badge icon={<Star size={14} />} label="Лучший процент" value={`${rareRate}% редких`} />
                  {topThemes.map(([theme, count]) => (
                    <Badge
                      key={theme}
                      icon={<Check size={14} />}
                      label={THEMES[theme]?.label || theme}
                      value={`${count} ответов`}
                    />
                  ))}
                </div>
              </Panel>

              <Panel title="Своя дилемма" subtitle="бережная модерация">
                <div className="custom-form">
                  <input
                    type="text"
                    placeholder="Вопрос"
                    value={form.prompt}
                    onChange={(e) => setForm((f) => ({ ...f, prompt: e.target.value }))}
                  />
                  <input
                    type="text"
                    placeholder="Вариант A"
                    value={form.left}
                    onChange={(e) => setForm((f) => ({ ...f, left: e.target.value }))}
                  />
                  <input
                    type="text"
                    placeholder="Вариант B"
                    value={form.right}
                    onChange={(e) => setForm((f) => ({ ...f, right: e.target.value }))}
                  />
                  <button className="primary" onClick={handleAddCustom}>
                    <Plus size={16} />
                    Добавить
                  </button>
                </div>
              </Panel>
            </aside>
          </div>
        )}
      </div>
      <Toast text={toast} onClose={() => setToast("")} />
    </div>
  );
}

function Landing({ onStart, themes, selectedThemes, onToggleTheme }) {
  const selectedCount = selectedThemes?.length || 0;
  const rules = [
    "Выбери один из двух вариантов — свайпом или кнопкой",
    "После ответа показываем проценты по сторонам",
    "Редкий выбор увеличивает серию",
    "Жми «Играть», чтобы начать раунд с выбранными патчами",
  ];
  return (
    <div className="landing landing-compact">
      <div className="landing-card hero">
        <p className="label">Выбор</p>
        <h1>Выбери патчи вопросов</h1>
        <p className="muted">Отметь наборы, которые хотите видеть в игре. Потом жми «Играть».</p>
        <div className="pack-meta muted">Выбрано: {selectedCount || "0"}</div>
        <div className="chips pack-chips">
          {Object.entries(themes).map(([key, value]) => {
            const active = (selectedThemes || []).includes(key);
            return (
              <button
                key={key}
                className={`chip ${active ? "chip-active" : ""}`}
                onClick={() => onToggleTheme?.(key)}
              >
                <span>{value.icon}</span>
                {value.label}
              </button>
            );
          })}
        </div>
        <div className="hero-actions compact">
          <button className="primary large" onClick={onStart}>
            <Zap size={18} />
            Играть
          </button>
        </div>
      </div>

      <div className="card-ghost rules">
        <p className="eyebrow">Правила</p>
        <ul>
          {rules.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function Panel({ title, subtitle, children }) {
  return (
    <div className="panel">
      <div className="panel-head">
        <div>
          <p className="eyebrow">{subtitle}</p>
          <h3>{title}</h3>
        </div>
      </div>
      {children}
    </div>
  );
}

function Badge({ icon, label, value }) {
  return (
    <div className="badge">
      <div className="badge-icon">{icon}</div>
      <div>
        <div className="badge-label">{label}</div>
        <div className="badge-value">{value}</div>
      </div>
    </div>
  );
}

function History({ history }) {
  if (!history?.length) return null;
  return (
    <div className="panel ghost">
      <div className="panel-head">
        <p className="eyebrow">Последние</p>
        <h3>История ответов</h3>
      </div>
      <div className="history">
        {history.map((item) => (
          <div key={item.id + item.side + item.pctA} className="history-row">
            <div className="history-title">{item.prompt}</div>
            <div className="history-meta">
              <span>{item.side === 0 ? "Лево" : "Право"}</span>
              <span className="muted">
                {item.pctA}% / {item.pctB}%
              </span>
            </div>
          </div>
        ))}
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
