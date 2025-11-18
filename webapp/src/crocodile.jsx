import React, { useCallback, useEffect, useMemo, useRef, useState, memo } from "react";
import "./crocodile.css";

/**
 * Crocodile — мини-игра «Крокодил» (classes namespaced)
 * Мини-HUD + тонкий верхний прогресс, без «тяжёлой» рамки вокруг карточки.
 * Все CSS-классы префиксованы cr-.
 */

/* ============================ Константы / утилиты ============================ */

const PROXY_BASE = "https://app.play-team.ru/s3";
const MANIFEST_KEY = "crocodile/manifest.json";
const BACKGROUND_KEY = "crocodile/background.png";
const BACKGROUND_18_KEY = "crocodile/background18.png";
const CROC_IMG_KEY = "crocodile/crocodile.png"; // иллюстрация для приветственного экрана
const PREFETCH_AHEAD = 4;

const RULES_ONCE_KEY = "croco:rulesShown:v2";
const SETTINGS_KEY = "croco:settings:v3";
const LAST_DECK_KEY = "croco:lastDeck:v2";

const SHOW_BG_IMAGE = false;

// путь к файлу со словами на S3
const WORDS_RU_KEY = "words.ru.json";

const isHttp = (s) => /^https?:\/\//i.test(s);
const trimSlash = (s) => s.replace(/\/+$/, "");
const leadSlash = (s) => s.replace(/^\/+/, "");
const joinUrl = (base, key) => `${trimSlash(base)}/${leadSlash(key)}`;
const resolveUrl = (base, maybeKey) => (isHttp(maybeKey) ? maybeKey : joinUrl(base, maybeKey));
const normWord = (w) => String(w || "").trim();
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

/* ---------- локальное хранилище ---------- */
const getLS = (k, d) => {
  try {
    const s = localStorage.getItem(k);
    if (s == null) return d;
    return JSON.parse(s);
  } catch {
    return d;
  }
};
const setLS = (k, v) => {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {}
};
const delLS = (k) => {
  try {
    localStorage.removeItem(k);
  } catch {}
};

/* ---------- таймауты/сети ---------- */
function withTimeout(promise, ms, label = "timeout") {
  let t;
  const timeout = new Promise((_, rej) => (t = setTimeout(() => rej(new Error(label)), ms)));
  return Promise.race([promise.finally(() => clearTimeout(t)), timeout]);
}
async function fetchText(url) {
  const res = await fetch(url, {
    method: "GET",
    mode: "cors",
    cache: "no-cache",
    credentials: "omit",
    referrerPolicy: "no-referrer",
  });
  const text = await res.text().catch(() => "");
  return { ok: res.ok, status: res.status, ct: res.headers.get("content-type") || "", text };
}
async function fetchJsonFlexible(url) {
  const { ok, status, ct, text } = await withTimeout(fetchText(url), 8000, "network timeout");
  if (!ok) throw new Error(`HTTP ${status}${text ? ` — ${text.slice(0, 180)}` : ""}`);
  const ctype = (ct || "").toLowerCase();
  if (ctype.includes("application/json")) {
    try {
      return JSON.parse(text);
    } catch (e) {
      throw new Error(`Invalid JSON — ${e.message}`);
    }
  }
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error(`Unexpected content-type "${ct}" — ${e.message}`);
  }
}
async function loadManifest() {
  const url = `${joinUrl(PROXY_BASE, MANIFEST_KEY)}?t=${Date.now()}`;
  const data = await fetchJsonFlexible(url);
  return data;
}

// Новая функция: тянем слова из файла words.ru.json; если не получилось — пробуем через манифест; иначе пусто
async function loadWordsFromFileOrManifest(manifest, lang = "ru") {
  // 0) прямой файл на S3 (главный источник)
  try {
    const directUrl = `${joinUrl(PROXY_BASE, WORDS_RU_KEY)}?t=${Date.now()}`;
    const d = await fetchJsonFlexible(directUrl);
    const pack = d?.lang === lang ? d : d; // поддержка и без поля lang
    return {
      easy: Array.isArray(pack?.easy) ? pack.easy : [],
      medium: Array.isArray(pack?.medium) ? pack.medium : [],
      hard: Array.isArray(pack?.hard) ? pack.hard : [],
      extreme: Array.isArray(pack?.extreme) ? pack.extreme : [],
    };
  } catch (_) {
    // идём дальше
  }
  // 1) если в манифесте есть карта файлов — используем её
  const key = manifest?.wordsFiles?.[lang] || manifest?.wordsFiles?.ru;
  if (key) {
    const url = `${joinUrl(PROXY_BASE, key)}?t=${Date.now()}`;
    const data = await fetchJsonFlexible(url);
    return {
      easy: Array.isArray(data?.easy) ? data.easy : [],
      medium: Array.isArray(data?.medium) ? data.medium : [],
      hard: Array.isArray(data?.hard) ? data.hard : [],
      extreme: Array.isArray(data?.extreme) ? data.extreme : [],
    };
  }
  // 2) последний шанс: встроенные поля манифеста
  const w = manifest?.words || {};
  return {
    easy: Array.isArray(w.easy) ? w.easy : [],
    medium: Array.isArray(w.medium) ? w.medium : [],
    hard: Array.isArray(w.hard) ? w.hard : [],
    extreme: Array.isArray(w.extreme)
      ? w.extreme
      : Array.isArray(w.hot)
      ? w.hot
      : Array.isArray(w["18plus"])
      ? w["18plus"]
      : [],
  };
}

/* ---------- прелоад картинок ---------- */
const _imgPreloadCache = new Map();
function preloadImage(src) {
  if (!src) return Promise.resolve();
  if (_imgPreloadCache.has(src)) return _imgPreloadCache.get(src);
  const img = new Image();
  img.decoding = "async";
  img.loading = "eager";
  const p = new Promise((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error("image error"));
  });
  img.src = src;
  _imgPreloadCache.set(src, p);
  return p;
}
function preconnectOrigin(href) {
  try {
    const origin = new URL(href).origin;
    for (const rel of ["preconnect", "dns-prefetch"]) {
      const link = document.createElement("link");
      link.rel = rel;
      link.href = origin;
      if (rel === "preconnect") link.crossOrigin = "anonymous";
      document.head.appendChild(link);
    }
  } catch {}
}

/* ---------- дефолтные данные ---------- */
const DEFAULT_IMAGES_BY_WORD = {};
const DEFAULT_META = { tagsByWord: {}, categoryByWord: {} };

/* ---------- перетасовка ---------- */
const shuffle = (arr) => {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

/* ---------- пары слово+медиа ---------- */
const toPairs = (words, difficulty, resolver, meta) =>
  (words || []).map((w, idx) => {
    const word = normWord(w);
    const url = resolver(word);
    const category = meta?.categoryByWord?.[word] || "";
    const tags = meta?.tagsByWord?.[word] || [];
    return {
      id: `pair_${difficulty}_${idx}_${word}`,
      kind: "pair",
      text: word,
      difficulty,
      mediaKind: url ? "image" : "none",
      url: url || "",
      category,
      tags,
    };
  });

/* ---------- i18n (RU only) ---------- */
const T = {
  brand: "Крокодил",
  tagline: "Никаких слов — только жесты!",
  start: "Начать",
  next: "Далее",
  difficulty: "Сложность",
  easy: "Лёгк.",
  medium: "Ср.",
  hard: "Слож.",
  extreme: "Жара 18+",
  filters: "Фильтры",
  mode: "Режим",
  chooseMode: "Выберите режим игры",
  timed: "Раунд по времени",
  ncards: "N карточек",
  free: "Свободная игра",
  seconds: "сек",
  cardsN: "карточек",
  teams: "Команды",
  players: "Игроки",
  eachSelf: "Каждый сам за себя",
  player: "Игрок",
  team: "Команда",
  participantsSetup: "Участники",
  countShort: "Кол-во",
  namesTitle: "Имена / названия",
  score: "Счёт",
  guessed: "Угадано",
  skipped: "Пропущено",
  undo: "Назад",
  skip: "Пропустить",
  gotIt: "Угадали",
  pause: "Пауза",
  resume: "Продолжить",
  finish: "Завершить",
  results: "Итоги",
  totalCards: "Всего карточек",
  roundHistory: "История раунда",
  settings: "Настройки",
  sounds: "Звуки",
  haptics: "Вибрация",
  oneHand: "Крупные кнопки",
  penalties: "Штрафы",
  skipMinus: "−1 за пропуск",
  comboRule: "+2 за серию из 3",
  hints: "Хинты",
  firstLetter: "Первая буква",
  category: "Категория",
  heat: "Тепло/холодно",
  rules: "Правила",
  rulesShort:
    "Покажи слово жестами. Нельзя говорить/издавать звуки. Команда угадывает — получает очки.",
  loading: "Загрузка…",
  retry: "Повторить",
  offlinePlay: "Играть с дефолтным паком",
  manifestErr: "Ошибка манифеста",
  details: "Подробнее",
  copyUrl: "Скопировать URL",
  copied: "Скопировано",
  ok: "Ок",
  cancel: "Отмена",
  share: "Поделиться результатом",
  rulesOnce: "Экран «Правила» показывается 1 раз",
  close: "Закрыть",
  back: "Назад",
  playAgain: "Сыграть ещё",
  ringTimer: "Осталось времени",
  ringDeck: "Прогресс колоды",
  categories: "Категории",
  apply: "Применить",
  clear: "Сброс",
  lastDeck: "Быстрый старт (последняя колода)",
  ignoreTheme: "Игнорировать тему Telegram",
  themeRescue: "Вернуть тему по умолчанию",
  settingsTitle: "Настройки игры",
  openRules: "Открыть правила",
  scoringMode: "Режим подсчёта",
  byTeams: "Командами",
  deckBalance: "Баланс сложностей",
  whoStarts: "Кто ходит первым?",
  randomPick: "Случайно выбран",
  startsRound: "Начинает раунд",
  nextUp: "Следующая команда",
};

/* ---------- звуки ---------- */
function makeBeep() {
  let ctx;
  return (freq = 880, ms = 120) => {
    try {
      // eslint-disable-next-line no-undef
      ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "square";
      o.frequency.value = freq;
      o.connect(g);
      g.connect(ctx.destination);
      o.start();
      g.gain.setValueAtTime(0.0001, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + ms / 1000);
      setTimeout(() => {
        try {
          o.stop();
          o.disconnect();
          g.disconnect();
        } catch {}
      }, ms + 30);
    } catch {}
  };
}
const beep = makeBeep();

/* ---------- иконки ---------- */
const Icon = memo(({ name, size = 20, className = "", strokeW = 2 }) => {
  const p = {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: strokeW,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    "aria-hidden": true,
    focusable: false,
    style: { width: size, height: size, display: "block" },
    className,
  };
  switch (name) {
    case "back":
      return (
        <svg {...p}>
          <path d="M15 6l-6 6 6 6" />
        </svg>
      );
    case "settings":
      return (
        <svg {...p}>
          <path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" />
          <path d="M19.4 15a2 2 0 0 0 .2 2.1l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a2 2 0 0 0-2.1-.2 2 2 0 0 0-1.1 1.7V21a2 2 0 1 1-4 0v-.2a2 2 0 0 0-1.1-1.7 2 2 0 0 0-2.1.2l-.1.1A 2 2 0 1 1 4.3 17l.1-.1a2 2 0 0 0 .2-2.1 2 2 0 0 0-1.7-1.1H3a2 2 0 1 1 0-4h.1a2 2 0 0 0 1.7-1.1 2 2 0 0 0-.2-2.1l-.1-.1A 2 2 0 1 1 19.4 15Z" />
        </svg>
      );
    case "rules":
      return (
        <svg {...p}>
          <path d="M5 4h11a2 2 0 0 1 2 2v12H7a2 2 0 0 0-2 2V4Z" />
          <path d="M7 7h8M7 11h10M7 15h6" />
        </svg>
      );
    case "skip":
      return (
        <svg {...p}>
          <path d="M7 7l10 5-10 5V7z" />
          <path d="M19 5v14" />
        </svg>
      );
    case "check":
      return (
        <svg {...p}>
          <path d="M20 6L9 17l-5-5" />
        </svg>
      );
    case "timer":
      return (
        <svg {...p}>
          <rect x="3.5" y="3.5" width="17" height="17" rx="2" />
        </svg>
      );
    case "warning":
      return (
        <svg {...p}>
          <path d="M12 2l10 18H2L12 2z" />
          <path d="M12 9v5M12 18h.01" />
        </svg>
      );
    case "spinner":
      return (
        <svg {...p} className={`cr-spinner ${className || ""}`} viewBox="0 0 50 50">
          <circle cx="25" cy="25" r="20" stroke="currentColor" strokeWidth="4" fill="none" strokeLinecap="round" />
        </svg>
      );
    default:
      return null;
  }
});

/* ---------- (оставлен про запас) квадратный прогресс вокруг карточки — больше не используем ---------- */
const SquareProgress = memo(function SquareProgress({ value = 0, stroke = 10, radius = 18, kind = "", label = "" }) {
  const clamped = clamp(value, 0, 1);
  return (
    <svg className={`cr-sqprog ${kind}`} aria-label={label} role="img" viewBox="0 0 100 100" preserveAspectRatio="none">
      <rect className="cr-sqtrack" x="5" y="5" width="90" height="90" rx={radius} pathLength="1" />
      <rect
        className="cr-sqvalue"
        x="5"
        y="5"
        width="90"
        height="90"
        rx={radius}
        pathLength="1"
        style={{ strokeDasharray: 1, strokeDashoffset: 1 - clamped }}
      />
    </svg>
  );
});

/* ---------- лёгкий конфетти слой ---------- */
function Confetti({ burstKey }) {
  const [items, setItems] = useState([]);
  useEffect(() => {
    if (!burstKey) return;
    const n = 18;
    const arr = Array.from({ length: n }).map((_, i) => ({
      id: `${burstKey}-${i}-${Math.random().toString(36).slice(2)}`,
      x: Math.random() * 100,
      d: 1200 + Math.random() * 800,
      r: 4 + Math.random() * 6,
      rot: Math.random() * 360,
      delay: Math.random() * 100,
    }));
    setItems(arr);
    const t = setTimeout(() => setItems([]), 2200);
    return () => clearTimeout(t);
  }, [burstKey]);
  return (
    <div className="cr-confetti-layer" aria-hidden>
      {items.map((p) => (
        <span
          key={p.id}
          className="cr-confetti"
          style={{
            left: `${p.x}%`,
            width: p.r * 2,
            height: p.r * 2,
            animationDuration: `${p.d}ms`,
            animationDelay: `${p.delay}ms`,
            transform: `rotate(${p.rot}deg)`,
          }}
        />
      ))}
    </div>
  );
}

/* ============================ Главный компонент ============================ */

export default function Crocodile({ goBack, onProgress, title = "Крокодил" }) {
  // Показывать ли старую AppBar — отключено
  const SHOW_APPBAR = false;

  /* ---------- fix 100vh on mobile ---------- */
  useEffect(() => {
    const setVh = () => {
      const vh = Math.max(window.innerHeight, document.documentElement.clientHeight) * 0.01;
      document.documentElement.style.setProperty("--vh", `${vh}px`);
    };
    setVh();
    window.addEventListener("resize", setVh);
    window.addEventListener("orientationchange", setVh);
    return () => {
      window.removeEventListener("resize", setVh);
      window.removeEventListener("orientationchange", setVh);
    };
  }, []);

  /* ---------- Telegram WebApp ---------- */
  const tg = typeof window !== "undefined" ? window?.Telegram?.WebApp : undefined;
  const haptic = useCallback((style = "light") => tg?.HapticFeedback?.impactOccurred?.(style), [tg]);

  /* ---------- локализация: RU-only ---------- */
  const t = useCallback((k) => T[k] || k, []);

  /* ---------- настройки ---------- */
  const defaultSettings = {
    sounds: true,
    haptics: true,
    oneHand: true,
    skipPenalty: -1,
    comboEvery: 3,
    comboBonus: 2,
    timerSeconds: 60,
    nCards: 20,
    quotas: { easy: 0.5, medium: 0.35, hard: 0.15, extreme: 0 },
    categories: [],
    showHints: false,
    ignoreTheme: getLS(SETTINGS_KEY, {})?.ignoreTheme ?? false,
    playBy: "teams", // "teams" | "ffa"
  };
  const [settings, setSettings] = useState(() => ({ ...defaultSettings, ...getLS(SETTINGS_KEY, {}) }));
  useEffect(() => setLS(SETTINGS_KEY, settings), [settings]);

  /* ---------- фильтры сложностей ---------- */
  const [useEasy, setUseEasy] = useState(true);
  const [useMedium, setUseMedium] = useState(false);
  const [useHard, setUseHard] = useState(false);
  const [useExtreme, setUseExtreme] = useState(false);

  /* ---------- модальные окна ---------- */
  const [rulesOpen, setRulesOpen] = useState(false);
  const [starterOpen, setStarterOpen] = useState(false);
  const [starterIndex, setStarterIndex] = useState(null);

  // Межходовая модалка
  const [handoverOpen, setHandoverOpen] = useState(false);
  const [nextTeamIndex, setNextTeamIndex] = useState(null);

  /* ---------- загрузка данных ---------- */
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [remoteWords, setRemoteWords] = useState(null);
  const [remoteImagesByWord, setRemoteImagesByWord] = useState(null);
  const [remoteMeta, setRemoteMeta] = useState(null);

  /* ---------- игра ---------- */
  const [phase, setPhase] = useState("idle"); // idle | playing | finished
  const [turnsPlayed, setTurnsPlayed] = useState(0);
  const [mode, setMode] = useState("timed"); // timed | ncards | free
  const [setupStep, setSetupStep] = useState(1);
  const [teamsCount, setTeamsCount] = useState(2);
  const [teamNames, setTeamNames] = useState(["A", "B", "C", "D"]);
  const [teamScores, setTeamScores] = useState([0, 0, 0, 0]);
  const [currentTeam, setCurrentTeam] = useState(0);
  const [deck, setDeck] = useState([]);
  const [index, setIndex] = useState(0);
  const [resultsByIndex, setResultsByIndex] = useState({});
  const [guessed, setGuessed] = useState(0);
  const [skipped, setSkipped] = useState(0);
  const [streak, setStreak] = useState(0);
  const [timeLeft, setTimeLeft] = useState(settings.timerSeconds);
  const [timerActive, setTimerActive] = useState(false);
  const timerRef = useRef(null);
  const [burstKey, setBurstKey] = useState("");
  const [imageLoaded, setImageLoaded] = useState(false);
  const [countdown, setCountdown] = useState(0);

  /* ---------- фон и тема ---------- */
  const bgUrl = resolveUrl(PROXY_BASE, useExtreme ? BACKGROUND_18_KEY : BACKGROUND_KEY);
  const crocHeroUrl = resolveUrl(PROXY_BASE, CROC_IMG_KEY);

  /* ---------- источники данных ---------- */
  const wordsSource = useMemo(
    () => remoteWords || { easy: [], medium: [], hard: [], extreme: [] },
    [remoteWords]
  );

  const imagesByWord = useMemo(() => {
    const map = remoteImagesByWord || DEFAULT_IMAGES_BY_WORD;
    const norm = {};
    Object.entries(map || {}).forEach(([k, v]) => {
      if (!v) return;
      const key = normWord(k);
      norm[key] = resolveUrl(PROXY_BASE, v);
    });
    return norm;
  }, [remoteImagesByWord]);

  const meta = useMemo(() => remoteMeta || DEFAULT_META, [remoteMeta]);
  const resolveImageForWord = (w) => imagesByWord[normWord(w)] || "";

  /* ---------- Тема/контраст ---------- */
  const hexToRgb = (h) => {
    if (!h) return null;
    if (h.startsWith("rgb")) {
      const m = h.match(/rgba?\(([^)]+)\)/i);
      if (!m) return null;
      const [r, g, b] = m[1]
        .split(",")
        .slice(0, 3)
        .map((x) => parseFloat(x));
      return [r, g, b];
    }
    const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(h);
    return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : null;
  };
  const luminance = (rgb) => {
    if (!rgb) return 0;
    const [r, g, b] = rgb;
    const a = [r, g, b].map((v) => {
      const x = v / 255;
      return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2];
  };
  const contrast = (c1, c2) => {
    const L1 = luminance(hexToRgb(c1));
    const L2 = luminance(hexToRgb(c2));
    const [hi, lo] = L1 > L2 ? [L1, L2] : [L2, L1];
    return (hi + 0.05) / (lo + 0.05);
  };
  const isLight = (bg) => luminance(hexToRgb(bg || "#fff")) >= 0.6;

  const setDefaultTheme = useCallback(() => {
    const root = document.documentElement;
    root.dataset.theme = "dark";
    // Основная палитра (кибер-неон)
    root.style.setProperty("--bg", "#0b1310");
    root.style.setProperty("--text", "#eaf6ef");
    root.style.setProperty("--muted", "#8ea59a");
    root.style.setProperty("--accent", "#21e57a");
    root.style.setProperty("--success", "#18c26e");
    root.style.setProperty("--warn", "#ffd25c");
    root.style.setProperty("--danger", "#ff6b6b");
    // Слои
    root.style.setProperty("--surface", "rgba(24,38,32,.50)");
    root.style.setProperty("--surface-2", "rgba(24,38,32,.72)");
    root.style.setProperty("--glass", "rgba(14,22,19,.74)");
    root.style.setProperty("--glass-border-color", "rgba(44,78,66,.42)");
    root.style.setProperty("--progress-track", "rgba(44,78,66,.34)");
    root.style.setProperty("--appbar-bg", "rgba(10,18,15,.86)");
    root.style.setProperty("--appbar-border", "rgba(44,78,66,.24)");
    root.style.setProperty("--btn-bg", "#11231c");
    root.style.setProperty("--btn-ghost-bg", "rgba(255,255,255,.04)");
    root.style.setProperty("--chip-bg", "rgba(16,28,23,.55)");
    root.style.setProperty("--chip-border", "rgba(44,78,66,.36)");
    root.style.setProperty("--input-border", "rgba(44,78,66,.40)");
    root.style.setProperty("--input-bg", "rgba(12,22,18,.48)");
    root.style.setProperty("--footer-grad", "linear-gradient(180deg, rgba(11,19,15,0), rgba(11,19,15,.92))");
    root.style.setProperty("--score-bg", "rgba(16,26,22,.55)");
    root.style.setProperty("--score-border", "rgba(44,78,66,.36)");
    root.style.setProperty("--history-bg", "rgba(16,26,22,.45)");
    root.style.setProperty("--history-border", "rgba(44,78,66,.28)");
    root.style.setProperty("--modal-bg", "#0f1a16");
    root.style.setProperty("--bg-img-opacity", "0.18");
    root.style.setProperty("--media-fallback-bg", "#132820");
    // Focus-ring
    root.style.setProperty(
      "--ring",
      "0 0 0 3px color-mix(in oklab, var(--accent) 38%, transparent), 0 0 0 8px color-mix(in oklab, var(--accent) 12%, transparent)"
    );
    root.style.setProperty("--neon-blur", "14px");
  }, []);

  const applyThemeFromTelegram = useCallback(
    (tp) => {
      if (!tp) return;
      const root = document.documentElement;
      const nextBg = tp.bg_color || getComputedStyle(root).getPropertyValue("--bg")?.trim() || "#0e1311";
      let nextText = tp.text_color || getComputedStyle(root).getPropertyValue("--text")?.trim() || "#e7f0ec";
      if (!isFinite(contrast(nextBg, nextText)) || contrast(nextBg, nextText) < 4.5) {
        nextText = isLight(nextBg) ? "#101614" : "#ecf4f1";
      }
      root.style.setProperty("--bg", nextBg);
      root.style.setProperty("--text", nextText);
      if (tp?.hint_color) root.style.setProperty("--muted", tp.hint_color);
      if (tp?.link_color) root.style.setProperty("--accent", tp.link_color);
      if (tp?.button_color) root.style.setProperty("--success", tp.button_color);
      const light = isLight(nextBg);
      root.dataset.theme = light ? "light" : "dark";
      if (light) {
        root.style.setProperty("--surface", "rgba(0,0,0,.04)");
        root.style.setProperty("--surface-2", "rgba(0,0,0,.06)");
        root.style.setProperty("--glass", "rgba(255,255,255,.78)");
        root.style.setProperty("--glass-border-color", "rgba(0,0,0,.10)");
        root.style.setProperty("--progress-track", "rgba(0,0,0,.10)");
        root.style.setProperty("--appbar-bg", "rgba(255,255,255,.85)");
        root.style.setProperty("--appbar-border", "rgba(0,0,0,.08)");
        root.style.setProperty("--btn-bg", "#f3f6f4");
        root.style.setProperty("--btn-ghost-bg", "rgba(0,0,0,.04)");
        root.style.setProperty("--chip-bg", "rgba(0,0,0,.04)");
        root.style.setProperty("--chip-border", "rgba(0,0,0,.12)");
        root.style.setProperty("--input-border", "rgba(0,0,0,.12)");
        root.style.setProperty("--input-bg", "rgba(0,0,0,.04)");
        root.style.setProperty("--footer-grad", "linear-gradient(180deg, rgba(255,255,255,0), rgba(255,255,255,.90))");
        root.style.setProperty("--score-bg", "rgba(0,0,0,.04)");
        root.style.setProperty("--score-border", "rgba(0,0,0,.08)");
        root.style.setProperty("--history-bg", "rgba(0,0,0,.03)");
        root.style.setProperty("--history-border", "rgba(0,0,0,.08)");
        root.style.setProperty("--modal-bg", "#ffffff");
        root.style.setProperty("--bg-img-opacity", "0.10");
        root.style.setProperty("--media-fallback-bg", "#eef3f0");
      } else {
        setDefaultTheme();
      }
    },
    [setDefaultTheme]
  );

  useEffect(() => {
    if (!tg || settings.ignoreTheme) {
      setDefaultTheme();
      return;
    }
    try {
      tg.ready?.();
      const apply = () => applyThemeFromTelegram(tg.themeParams);
      apply();
      tg.onEvent?.("themeChanged", apply);
      return () => tg.offEvent?.("themeChanged", apply);
    } catch {
      setDefaultTheme();
    }
  }, [tg, settings.ignoreTheme, setDefaultTheme, applyThemeFromTelegram]);

  // Авто-резервная тема при плохом контрасте
  useEffect(() => {
    const root = document.documentElement;
    const bg = getComputedStyle(root).getPropertyValue("--bg")?.trim() || "#0e1311";
    const text = getComputedStyle(root).getPropertyValue("--text")?.trim() || "#e7f0ec";
    const ratio = contrast(bg, text);
    if (!isFinite(ratio) || ratio < 3) {
      setDefaultTheme();
    }
  });

  /* ---------- прелоад фона и иллюстрации ---------- */
  useEffect(() => {
    if (SHOW_BG_IMAGE) preloadImage(bgUrl);
  }, [bgUrl]);

  useEffect(() => {
    preconnectOrigin(PROXY_BASE);
    preloadImage(crocHeroUrl);
  }, [crocHeroUrl]);

  /* ---------- загрузка манифеста + слов ---------- */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setLoadError("");
      try {
        const manifest = await loadManifest().catch(() => null);
        // images
        const m = manifest?.imagesByWord || {};
        const byWord = {};
        Object.entries(m).forEach(([k, v]) => {
          if (v) byWord[normWord(k)] = v;
        });
        setRemoteImagesByWord(Object.keys(byWord).length ? byWord : DEFAULT_IMAGES_BY_WORD);
        // meta
        setRemoteMeta(manifest?.meta || DEFAULT_META);
        // слова
        const words = await loadWordsFromFileOrManifest(manifest, "ru");
        setRemoteWords(words);
      } catch (e) {
        setLoadError(`${t("manifestErr")}: ${String(e.message).slice(0, 260)}`);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t]);

  /* ---------- показать "Правила" 1 раз ---------- */
  useEffect(() => {
    const shown = getLS(RULES_ONCE_KEY, false);
    if (!shown) {
      setRulesOpen(true);
      setLS(RULES_ONCE_KEY, true);
    }
  }, []);

  /* ---------- вспомогательные ---------- */
  const isFFA = settings.playBy === "ffa";
  const maxParticipants = isFFA ? 8 : 4; // FFA: 2–8, Teams: 2–4
  const minParticipants = 2;

  const allowedCounts = useMemo(
    () => Array.from({ length: maxParticipants - minParticipants + 1 }, (_, i) => i + minParticipants),
    [maxParticipants]
  );

  // держим массив имён нужной длины
  useEffect(() => {
    setTeamsCount((n) => clamp(n, minParticipants, maxParticipants));
  }, [maxParticipants]);

  useEffect(() => {
    setTeamNames((prev) => {
      const n = teamsCount;
      const next = prev.slice(0, n);
      while (next.length < n) {
        const i = next.length;
        next.push(settings.playBy === "teams" ? String.fromCharCode(65 + i) : `${T.player} ${i + 1}`);
      }
      return next;
    });
  }, [teamsCount, settings.playBy]);

  const displayName = useCallback(
    (i) => {
      const nm = (teamNames[i] || "").trim();
      if (nm) return nm;
      return settings.playBy === "teams" ? String.fromCharCode(65 + i) : `${t("player")} ${i + 1}`;
    },
    [teamNames, settings.playBy, t]
  );

  /* ---------- сборка колоды ---------- */
  const buildDeck = useCallback(
    (total = null) => {
      const selected = [];
      const add = (arr, diff) => selected.push(...toPairs(arr, diff, resolveImageForWord, meta));
      if (useEasy && wordsSource.easy?.length) add(wordsSource.easy, "easy");
      if (useMedium && wordsSource.medium?.length) add(wordsSource.medium, "medium");
      if (useHard && wordsSource.hard?.length) add(wordsSource.hard, "hard");
      if (useExtreme && wordsSource.extreme?.length) add(wordsSource.extreme, "extreme");
      if (!selected.length) return [];

      // Фильтры
      const hasCat = !!settings.categories?.length;
      let filtered = selected.filter((p) => {
        let okCat = true;
        if (hasCat) {
          okCat =
            (p.category && settings.categories.includes(p.category)) ||
            p.tags?.some((tag) => settings.categories.includes(tag));
        }
        return okCat;
      });
      if (!filtered.length) filtered = selected.slice();

      // Если включён extreme — гарантируем хотя бы 1 карту extreme
      if (useExtreme) {
        const hasExtremeInFiltered = filtered.some((p) => p.difficulty === "extreme");
        const hasExtremeInSelected = selected.some((p) => p.difficulty === "extreme");
        if (!hasExtremeInFiltered && hasExtremeInSelected) {
          filtered.push(...selected.filter((p) => p.difficulty === "extreme"));
          const map = new Map();
          filtered.forEach((x) => map.set(x.id, x));
          filtered = Array.from(map.values());
        }
      }

      let next = shuffle(filtered);

      // Префетч и сохранение в LS, если total не задан
      if (!total || total <= 0) {
        next.slice(0, PREFETCH_AHEAD).forEach((c) => c.url && preloadImage(c.url));
        setLS(LAST_DECK_KEY, { at: Date.now(), deck: next });
        return next;
      }

      // Баланс по квотам
      const baseQ = settings.quotas || {};
      const weights = {};
      let sumW = 0;
      const enabledForWeights = [];
      if (useEasy) enabledForWeights.push("easy");
      if (useMedium) enabledForWeights.push("medium");
      if (useHard) enabledForWeights.push("hard");
      if (useExtreme) enabledForWeights.push("extreme");
      enabledForWeights.forEach((k) => {
        let w = Number(baseQ[k] || 0);
        if (k === "extreme" && useExtreme && w <= 0) w = 0.15;
        weights[k] = w;
        sumW += w;
      });
      if (sumW <= 0) {
        enabledForWeights.forEach((k) => (weights[k] = 1));
        sumW = enabledForWeights.length;
      }
      enabledForWeights.forEach((k) => (weights[k] = weights[k] / sumW));

      const byDiffPool = Object.fromEntries(enabledForWeights.map((k) => [k, next.filter((d) => d.difficulty === k)]));
      let counts = Object.fromEntries(enabledForWeights.map((k) => [k, Math.floor((weights[k] || 0) * total)]));
      let used = enabledForWeights.reduce((acc, k) => acc + counts[k], 0);
      let remain = Math.max(0, total - used);
      const orderByWeight = [...enabledForWeights].sort((a, b) => (weights[b] || 0) - (weights[a] || 0));
      for (let i = 0; i < remain; i++) counts[orderByWeight[i % orderByWeight.length]]++;

      const pick = [];
      enabledForWeights.forEach((k) => {
        const pool = byDiffPool[k] || [];
        if (pool.length) pick.push(...pool.slice(0, counts[k] || 0));
      });

      if (pick.length < total) {
        const usedIds = new Set(pick.map((x) => x.id));
        const rest = filtered.filter((x) => !usedIds.has(x.id));
        pick.push(...rest.slice(0, total - pick.length));
      }

      next = shuffle(pick);
      next.slice(0, PREFETCH_AHEAD).forEach((c) => c.url && preloadImage(c.url));
      setLS(LAST_DECK_KEY, { at: Date.now(), deck: next });
      return next;
    },
    [meta, resolveImageForWord, settings.categories, settings.quotas, useEasy, useHard, useMedium, useExtreme, wordsSource]
  );

  /* ---------- старт / флоу ---------- */
  const startGame = useCallback(() => {
    const isFFA = settings.playBy === "ffa";
    const totalForMode = isFFA ? settings.nCards : mode === "ncards" ? settings.nCards : null;

    let nextDeck = buildDeck(totalForMode);
    if (!nextDeck.length) {
      const all = [];
      const add = (arr, diff) => all.push(...toPairs(arr, diff, resolveImageForWord, meta));
      if (wordsSource.easy?.length) add(wordsSource.easy, "easy");
      if (wordsSource.medium?.length) add(wordsSource.medium, "medium");
      if (wordsSource.hard?.length) add(wordsSource.hard, "hard");
      if (useExtreme && wordsSource.extreme?.length) add(wordsSource.extreme, "extreme");

      nextDeck = shuffle(all).slice(0, totalForMode || all.length);
      if (!nextDeck.length) {
        haptic("rigid");
        alert("Пустая колода. Проверьте файл words.ru.json / фильтры / сложности.");
        return;
      }
    }

    if (settings.haptics) haptic("medium");
    setDeck(nextDeck);
    setIndex(0);
    setResultsByIndex({});
    setGuessed(0);
    setSkipped(0);
    setStreak(0);
    setTeamScores(Array.from({ length: teamsCount }, () => 0));
    setImageLoaded(false);
    setTimerActive(false);
    setCountdown(0);
    setTurnsPlayed(0);

    const needStarterModal = isFFA || (settings.playBy === "teams" && mode === "timed");
    if (needStarterModal) {
      const rand = Math.floor(Math.random() * Math.max(teamsCount, 1));
      setCurrentTeam(rand);
      setStarterIndex(rand);
      setStarterOpen(true);
      onProgress?.();
      return;
    }

    setCurrentTeam(0);
    if (mode === "timed") {
      setTimeLeft(settings.timerSeconds);
      setCountdown(3);
    } else {
      setTimerActive(false);
    }
    setPhase("playing");
    onProgress?.();
  }, [
    buildDeck,
    haptic,
    mode,
    onProgress,
    settings.haptics,
    settings.nCards,
    settings.timerSeconds,
    settings.playBy,
    wordsSource,
    meta,
    resolveImageForWord,
    useExtreme,
    teamsCount,
  ]);

  const confirmStarterAndBegin = useCallback(() => {
    setStarterOpen(false);
    if (!(settings.playBy === "ffa") && mode === "timed") {
      setTimeLeft(settings.timerSeconds);
      setCountdown(3);
    } else {
      setTimerActive(false);
      setCountdown(0);
    }
    setPhase("playing");
  }, [mode, settings.timerSeconds, settings.playBy]);

  const confirmNextAndBegin = useCallback(() => {
    setHandoverOpen(false);
    if (nextTeamIndex == null) return;
    setCurrentTeam(nextTeamIndex);
    setTimeLeft(settings.timerSeconds);
    setCountdown(3);
    setTimerActive(false);
  }, [nextTeamIndex, settings.timerSeconds]);

  const finishGame = useCallback(() => {
    setTimerActive(false);
    if (settings.haptics) haptic("light");
    setPhase("finished");
  }, [haptic, settings.haptics]);

  /* ---------- глобальный замок свайпов TWA ---------- */
  useEffect(() => {
    if (!tg?.disableVerticalSwipes) return;
    const needLock = phase === "playing" || starterOpen;
    if (needLock) tg.expand?.();
    tg.disableVerticalSwipes(needLock);
    return () => {
      tg.disableVerticalSwipes(false);
    };
  }, [tg, phase, starterOpen]);

  // Анти pull-to-refresh во время раунда
  useEffect(() => {
    if (phase !== "playing") return;
    let startY = 0;
    const onStart = (e) => {
      if (e.touches?.length) startY = e.touches[0].clientY;
    };
    const onMove = (e) => {
      if (!e.touches?.length) return;
      const el = document.scrollingElement || document.documentElement;
      const dy = e.touches[0].clientY - startY;
      const atTop = el.scrollTop <= 0;
      const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 1;
      if ((atTop && dy > 0) || (atBottom && dy < 0)) e.preventDefault();
    };
    document.addEventListener("touchstart", onStart, { passive: false });
    document.addEventListener("touchmove", onMove, { passive: false });
    return () => {
      document.removeEventListener("touchstart", onStart);
      document.removeEventListener("touchmove", onMove);
    };
  }, [phase]);

  /* ---------- Keyboard shortcuts ---------- */
  useEffect(() => {
    if (phase !== "playing") return;
    const onKey = (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        markGuessed();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        skipCard();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---------- 3-2-1 countdown ---------- */
  useEffect(() => {
    if (countdown <= 0) return;
    const tmo = setTimeout(() => setCountdown((c) => Math.max(0, c - 1)), 1000);
    if (settings.sounds) beep(700 + countdown * 60, 120);
    if (settings.haptics) haptic("light");
    return () => clearTimeout(tmo);
  }, [countdown, haptic, settings.haptics, settings.sounds]);

  useEffect(() => {
    if (!(settings.playBy !== "ffa") || phase !== "playing" || mode !== "timed") return;
    if (countdown > 0) setTimerActive(false);
    else setTimerActive(true);
  }, [countdown, mode, phase, settings.playBy]);

  /* ---------- таймер ---------- */
  const autoSwitchTurn = useCallback(() => {
    setCurrentTeam((i) => (i + 1) % Math.max(1, teamsCount));
    setStreak(0);
  }, [teamsCount]);

  useEffect(() => {
    if (settings.playBy === "ffa") return; // В FFA таймер отключён
    if (!timerActive || mode !== "timed" || phase !== "playing") return;

    const tick = () => {
      setTimeLeft((tsec) => {
        const next = tsec - 1;

        if (next > 0 && next <= 10) {
          if (settings.sounds) beep(900, 110);
          if (settings.haptics) haptic("light");
        }

        if (next <= 0) {
          if (settings.sounds) beep(600, 5000);
          if (settings.haptics) haptic("rigid");

          setStreak(0);
          setTurnsPlayed((tp) => {
            const played = tp + 1;
            const allDone = played >= teamsCount;
            if (allDone) {
              setTimerActive(false);
              finishGame();
            } else {
              const nextIdx = (currentTeam + 1) % Math.max(1, teamsCount);
              setTimerActive(false);
              setNextTeamIndex(nextIdx);
              setHandoverOpen(true);
            }
            return played;
          });

          return settings.timerSeconds;
        }

        return next;
      });
    };

    timerRef.current = setInterval(tick, 1000);
    return () => clearInterval(timerRef.current);
  }, [
    haptic,
    mode,
    phase,
    settings.haptics,
    settings.sounds,
    settings.timerSeconds,
    timerActive,
    autoSwitchTurn,
    settings.playBy,
    teamsCount,
    finishGame,
    currentTeam,
  ]);

  /* ---------- действия над картой ---------- */
  const registerHistory = useCallback((idx, kind, points) => {
    setResultsByIndex((prev) => ({ ...prev, [idx]: kind, [`points_${idx}`]: points }));
  }, []);

  const pushScore = useCallback((teamIdx, delta) => {
    setTeamScores((arr) => arr.map((s, i) => (i === teamIdx ? s + delta : s)));
  }, []);

  const moveNext = useCallback(() => {
    const next = index + 1;
    if (next < deck.length) {
      setIndex(next);
      setImageLoaded(false);
      deck.slice(next, next + PREFETCH_AHEAD).forEach((c) => c.url && preloadImage(c.url));
    } else {
      finishGame();
    }
  }, [deck, finishGame, index]);

  const applyComboIfAny = useCallback(
    (nextStreak) => {
      if (nextStreak > 0 && nextStreak % (settings.comboEvery || 3) === 0) {
        pushScore(currentTeam, settings.comboBonus || 2);
      }
    },
    [currentTeam, pushScore, settings.comboBonus, settings.comboEvery]
  );

  const markGuessed = useCallback(
    (opts = { bonus: 0 }) => {
      const base = 1 + (opts.bonus || 0);
      setGuessed((g) => g + 1);
      setStreak((s) => {
        const ns = s + 1;
        applyComboIfAny(ns);
        return ns;
      });
      pushScore(currentTeam, base);
      registerHistory(index, "guessed", base);
      if (settings.haptics) haptic("medium");
      setBurstKey(`b-${Date.now()}`);
      moveNext();
    },
    [applyComboIfAny, currentTeam, haptic, index, moveNext, pushScore, registerHistory, settings.haptics]
  );

  const markGuessedBy = useCallback(
    (byIdx, opts = { bonus: 0 }) => {
      const base = 1 + (opts.bonus || 0);
      setGuessed((g) => g + 1);
      setStreak((s) => {
        const ns = s + 1;
        applyComboIfAny(ns);
        return ns;
      });
      pushScore(byIdx, base);
      registerHistory(index, "guessed", base);
      setResultsByIndex((prev) => ({ ...prev, [`by_${index}`]: byIdx }));
      if (settings.haptics) haptic("medium");
      setBurstKey(`b-${Date.now()}`);
      setCurrentTeam(byIdx);
      moveNext();
    },
    [applyComboIfAny, haptic, index, moveNext, pushScore, registerHistory, settings.haptics]
  );

  const skipCard = useCallback(() => {
    const penalty = settings.skipPenalty || -1;
    setSkipped((s) => s + 1);
    setStreak(0);
    pushScore(currentTeam, penalty);
    registerHistory(index, "skipped", penalty);
    if (settings.haptics) haptic("light");
    moveNext();
  }, [currentTeam, haptic, index, moveNext, pushScore, registerHistory, settings.haptics, settings.skipPenalty]);

  /* ---------- текущие данные ---------- */
  const current = deck[index];
  const deckProgress = deck.length ? Math.min(1, index / deck.length) : 0;
  const ringValue =
    settings.playBy === "ffa" ? deckProgress : mode === "timed" ? timeLeft / settings.timerSeconds : deckProgress;
  const ringTone =
    settings.playBy !== "ffa" && mode === "timed"
      ? ringValue > 2 / 3
        ? "cr-ok"
        : ringValue > 1 / 3
        ? "cr-mid"
        : "cr-low"
      : "";
  const ringPanic =
    settings.playBy !== "ffa" && mode === "timed" && timeLeft <= 10 && phase === "playing" ? "cr-panic" : "";

  /* ---------- прелоад следующего блока ---------- */
  useEffect(() => {
    const urls = deck
      .slice(index, index + PREFETCH_AHEAD)
      .map((c) => c?.url)
      .filter(Boolean);
    urls.forEach(preloadImage);
  }, [deck, index]);

  /* ---------- extreme toggle ---------- */
  const onExtremeToggle = () => setUseExtreme((v) => !v);

  /* ---------- формат чисел (RU only) ---------- */
  const nf = useMemo(() => new Intl.NumberFormat("ru-RU"), []);

  /* ---------- ВЫЧИСЛЕНИЕ ПОБЕДИТЕЛЯ ---------- */
  const winnerIndex = useMemo(
    () =>
      teamScores.length
        ? teamScores.reduce((best, _, i, arr) => (arr[i] > arr[best] ? i : best), 0)
        : 0,
    [teamScores]
  );

  /* ============================ Рендер ============================ */

  const handleBack = () => {
    if (typeof goBack === "function") goBack();
    else {
      try {
        window.history?.back?.();
      } catch {}
    }
  };

  return (
    <section className="cr-root" aria-label={t("brand")}>
      {/* Фоновый слой */}
      {SHOW_BG_IMAGE && <div className="cr-bg-layer" aria-hidden style={{ backgroundImage: `url("${bgUrl}")` }} />}

      {/* AppBar (по умолчанию скрыта) */}
      {SHOW_APPBAR && (
        <header className="cr-appbar" role="banner">
          <div className="cr-appbar-inner">
            <div className="cr-appbar-left">
              <button className="cr-icon-btn" onClick={handleBack} aria-label={t("back")} title={t("back")}>
                <Icon name="back" />
              </button>
              <div className="cr-brand-wrap">
                <h1 className="cr-brand cr-h2">{title}</h1>
              </div>
            </div>
            <div className="cr-appbar-right">
              {loadError && <span className="cr-badge cr-warn" title="Фолбэк на дефолтные данные">offline</span>}
            </div>
          </div>
        </header>
      )}

      {/* Ошибки загрузки */}
      {!loading && loadError && (
        <div className="cr-alert cr-warn" role="alert">
          <div className="cr-alert-row">
            <Icon name="warning" />
            <div>
              <div className="cr-strong">{t("manifestErr")}</div>
              <div className="cr-muted">{loadError}</div>
              <div className="cr-small cr-mt6">URL: {joinUrl(PROXY_BASE, MANIFEST_KEY)}</div>
            </div>
          </div>
          <div className="cr-row cr-mt10">
            <button className="cr-btn cr-ghost" onClick={() => location.reload()}>
              {t("retry")}
            </button>
            <button
              className="cr-btn cr-tiny"
              onClick={() => {
                navigator.clipboard?.writeText(joinUrl(PROXY_BASE, MANIFEST_KEY));
                alert(t("copied"));
              }}
            >
              {t("copyUrl")}
            </button>
          </div>
        </div>
      )}

      {/* IDLE */}
      {phase === "idle" && (
        <main className="cr-panel cr-glass cr-welcome" role="region" aria-label="Welcome">
          {/* ---- Единый HERO ---- */}
          <div className="cr-hero-one">
            <div className="cr-emoji">🎭</div>
            <div className="cr-title cr-h2">{t("tagline")}</div>
            <div className="cr-subtitle cr-muted">{t("rulesShort")}</div>
            <img
              className="cr-hero-ill"
              src={crocHeroUrl}
              alt="Крокодил — иллюстрация"
              decoding="async"
              loading="eager"
              fetchpriority="high"
              referrerPolicy="no-referrer"
              draggable={false}
            />
          </div>

          {/* Шаг 1: выбор режима игры */}
          {setupStep === 1 && (
            <>
              <section className="cr-card cr-glass cr-centered-title" aria-label={t("chooseMode")}>
                <div className="cr-card-title">{t("chooseMode")}</div>
                <div className="cr-mode-grid">
                  <ModeTile
                    active={settings.playBy === "ffa"}
                    onClick={() => setSettings((s) => ({ ...s, playBy: "ffa" }))}
                    icon="check"
                    label={t("eachSelf")}
                    sub={t("players")}
                  />
                  <ModeTile
                    active={settings.playBy === "teams"}
                    onClick={() => setSettings((s) => ({ ...s, playBy: "teams" }))}
                    icon="check"
                    label={t("byTeams")}
                    sub={t("teams")}
                  />
                </div>
              </section>

              <footer className="cr-welcome-footer" role="contentinfo">
                <div className="cr-welcome-footer-inner">
                  <button
                    className="cr-btn cr-ghost cr-xl cr-wide"
                    onClick={() => setRulesOpen(true)}
                    aria-label={t("rules")}
                    title={t("rules")}
                  >
                    <Icon name="rules" /> {t("rules")}
                  </button>
                  <button
                    className="cr-btn cr-primary cr-xl cr-wide cr-neon"
                    onClick={() => setSetupStep(2)}
                    aria-label={t("next")}
                    title={t("next")}
                  >
                    {t("next")}
                  </button>
                </div>
              </footer>
            </>
          )}

          {/* Шаг 2: участники и сложность */}
          {setupStep === 2 && (
            <>
              {/* Участники */}
              <section className="cr-card cr-glass" aria-label={t("participantsSetup")}>
                <div className="cr-card-title">
                  {t("participantsSetup")} • {settings.playBy === "teams" ? t("teams") : t("players")}
                </div>

                <div
                  className="cr-count-select-row"
                  role="group"
                  aria-label={`${t("countShort")} ${settings.playBy === "teams" ? t("teams") : t("players")}`}
                >
                  <PillSelect
                    label={`${t("countShort")} ${settings.playBy === "teams" ? t("teams") : t("players")}`}
                    value={teamsCount}
                    onChange={(v) => setTeamsCount(Number(v))}
                    options={allowedCounts.map((n) => ({ value: n, label: String(n) }))}
                  />
                </div>

                <div className="cr-muted cr-small cr-mt8">{t("namesTitle")}</div>
                <div className="cr-team-grid cr-mt8">
                  {[...Array(teamsCount)].map((_, i) => (
                    <input
                      key={i}
                      className="cr-input"
                      value={teamNames[i] || ""}
                      onChange={(e) =>
                        setTeamNames((ns) => {
                          const a = [...ns];
                          a[i] = e.target.value.slice(0, 16);
                          return a;
                        })
                      }
                      aria-label={`${settings.playBy === "teams" ? t("team") : t("player")} ${i + 1}`}
                      placeholder={`${settings.playBy === "teams" ? t("team") : t("player")} ${i + 1}`}
                    />
                  ))}
                </div>
              </section>

              {/* Сложность */}
              <section className="cr-card cr-glass" aria-label={t("difficulty")}>
                <div className="cr-card-title">{t("difficulty")}</div>
                <div className="cr-chips cr-one-line">
                  <DiffChip active={useEasy} label={t("easy")} tone="easy" onClick={() => setUseEasy(!useEasy)} />
                  <DiffChip active={useMedium} label={t("medium")} tone="medium" onClick={() => setUseMedium(!useMedium)} />
                  <DiffChip active={useHard} label={t("hard")} tone="hard" onClick={() => setUseHard(!useHard)} />
                </div>
                <div className="cr-chips cr-chips-separated">
                  <DiffChip active={useExtreme} label={t("extreme")} tone="extreme" onClick={onExtremeToggle} />
                </div>
                <div className="cr-muted cr-small cr-mt8">
                  {t("deckBalance")}: {Math.round((settings.quotas.easy || 0) * 100)}/
                  {Math.round((settings.quotas.medium || 0) * 100)}/{Math.round((settings.quotas.hard || 0) * 100)}
                </div>
              </section>

              <div className="cr-row cr-between">
                <button className="cr-btn" onClick={() => setSetupStep(1)}>
                  {t("back")}
                </button>
                <button className="cr-btn cr-primary cr-xl cr-neon" onClick={() => startGame()}>
                  {t("start")}
                </button>
              </div>
            </>
          )}
        </main>
      )}

      {/* PLAYING */}
      {phase === "playing" && current && (
        <main className="cr-panel cr-glass cr-play" role="region" aria-live="polite">
          {/* === Мини-HUD + тонкий верхний прогресс === */}
          <header className="cr-topbar">
            <div className="cr-topbar-row">
              <div className="cr-topbar-left">
                <span className="cr-topbar-team">
                  {(settings.playBy === "teams" ? t("team") : t("player"))} {currentTeam + 1}
                </span>
                <b className="cr-topbar-name">{displayName(currentTeam)}</b>
                <span className={`cr-pill cr-${current.difficulty}`}>{diffLabel(t, current.difficulty)}</span>
              </div>
              <div className="cr-topbar-right">
                {settings.playBy !== "ffa" && mode === "timed" && (
                  <span className={`cr-timer-badge ${timeLeft <= 10 ? "cr-danger" : ""}`}>
                    <Icon name="timer" /> {timeLeft}
                  </span>
                )}
                <span className="cr-score-mini">{t("score")}: {teamScores[currentTeam]}</span>
              </div>
            </div>
            <div className={`cr-top-progress ${ringTone} ${ringPanic}`}>
              <div
                className="cr-top-progress-fill"
                style={{
                  width: `${
                    clamp(
                      (settings.playBy !== "ffa" && mode === "timed")
                        ? (timeLeft / settings.timerSeconds)
                        : deckProgress,
                      0, 1
                    ) * 100
                  }%`
                }}
              />
            </div>
          </header>

          {/* Карта — без квадратного кольца, только содержимое */}
          <div className="cr-square-card-wrap">
            <div className="cr-card-main cr-square" aria-label={current.text}>
              <div className={`cr-media ${imageLoaded ? "cr-loaded" : "cr-loading"}`}>
                {!imageLoaded && <div className="cr-skeleton" aria-hidden />}
                {current.url ? (
                  <img
                    src={current.url}
                    alt={`Иллюстрация: ${current.text}`}
                    loading="eager"
                    decoding="async"
                    fetchpriority="high"
                    referrerPolicy="no-referrer"
                    draggable={false}
                    onLoad={() => setImageLoaded(true)}
                    onError={() => setImageLoaded(true)}
                  />
                ) : (
                  <div className="cr-media-fallback">
                    <span className="cr-no-media">{current.text}</span>
                  </div>
                )}
              </div>

              {/* Всегда показываем текст снизу */}
              <div className="cr-word-display" role="heading" aria-level={2}>
                {current.text}
              </div>

              <Confetti burstKey={burstKey} />
            </div>

            {/* 3-2-1 — только не в FFA */}
            {settings.playBy !== "ffa" && mode === "timed" && countdown > 0 && (
              <div className="cr-countdown-overlay" role="alert" aria-live="assertive">
                <div className="cr-countdown-number">{countdown}</div>
              </div>
            )}
          </div>

          {/* FFA: панель имён */}
          {settings.playBy === "ffa" && (
            <div className="cr-guessers-bar" role="group" aria-label="Кто угадал">
              {[...Array(teamsCount)]
                .map((_, i) => i)
                .filter((i) => i !== currentTeam)
                .map((i) => (
                  <button
                    key={i}
                    className="cr-name-btn"
                    onClick={() => markGuessedBy(i)}
                    aria-label={`Угадал ${displayName(i)}`}
                  >
                    {displayName(i)}
                  </button>
                ))}
            </div>
          )}

          {/* Sticky Footer */}
          <footer className={`cr-sticky-footer ${settings.oneHand ? "cr-one-hand" : ""}`} role="contentinfo">
            {settings.playBy === "ffa" ? (
              <div className="cr-footer-inner cr-ffa">
                <button className="cr-btn cr-danger cr-xl" onClick={() => skipCard()} aria-label={t("skip")}>
                  <Icon name="skip" /> {t("skip")}
                </button>
              </div>
            ) : (
              <div className="cr-footer-inner">
                <button className="cr-btn cr-danger cr-xl" onClick={() => skipCard()} aria-label={t("skip")}>
                  <Icon name="skip" /> {t("skip")}
                </button>
                <button className="cr-btn cr-success cr-xl cr-neon" onClick={() => markGuessed()} aria-label={t("gotIt")}>
                  <Icon name="check" /> {t("gotIt")}
                </button>
                <button className="cr-btn cr-danger cr-xl" onClick={finishGame} aria-label={t("finish")}>
                  {t("finish")}
                </button>
              </div>
            )}
          </footer>
        </main>
      )}

      {/* FINISHED — упрощённый блок итогов с «Победителем» */}
      {phase === "finished" && (
        <main className="cr-panel cr-glass cr-finish" role="region" aria-label={t("results")}>
          <div className="cr-title cr-h2">{t("results")}</div>

          {/* Победитель */}
          <section className="cr-winner">
            <div className="cr-trophy" aria-hidden>🏆</div>
            <div className="cr-winner-name">{displayName(winnerIndex)}</div>
            <div className="cr-winner-score">{nf.format(teamScores[winnerIndex] || 0)}</div>
          </section>

          {/* Остальные места */}
          <div className="cr-score-grid">
            {[...Array(teamsCount)].map((_, i) => i)
              .filter((i) => i !== winnerIndex)
              .map((i) => (
                <div key={i} className="cr-score-card">
                  <div className="cr-label">
                    {(settings.playBy === "teams" ? t("team") : t("player"))} {i + 1}: {displayName(i)}
                  </div>
                  <div className="cr-value">{nf.format(teamScores[i] || 0)}</div>
                </div>
              ))}
          </div>

          {/* Короткая сводка */}
          <div className="cr-stats3">
            <Stat label={t("totalCards")} value={deck.length} />
            <Stat label={t("guessed")} value={guessed} />
            {skipped > 0 && <Stat label={t("skipped")} value={skipped} />}
          </div>

          {/* История под details (убираем лишнее с экрана) */}
          <details className="cr-card cr-glass cr-mt12">
            <summary className="cr-card-title">{t("roundHistory")}</summary>
            <div className="cr-list cr-scroll-y" style={{ maxHeight: 220 }}>
              {deck.map((d, i) => {
                const kind = resultsByIndex[i];
                const pts = resultsByIndex[`points_${i}`];
                const byIdx = resultsByIndex[`by_${i}`];
                return (
                  <div key={d.id || i} className={`cr-history-row ${kind ? `cr-${kind}` : "cr-none"}`}>
                    <span className={`cr-pill cr-${d.difficulty}`}>{diffLabel(t, d.difficulty)}</span>
                    <span className="cr-w">
                      {d.text} {byIdx != null && <span className="cr-muted cr-small">→ {displayName(byIdx)}</span>}
                    </span>
                    <span className="cr-muted">{kind ? (kind === "guessed" ? t("gotIt") : t("skip")) : "-"}</span>
                    <span className={`cr-pts ${pts > 0 ? "cr-pos" : pts < 0 ? "cr-neg" : ""}`}>{pts ? (pts > 0 ? `+${pts}` : pts) : ""}</span>
                  </div>
                );
              })}
            </div>
          </details>

          <div className="cr-cta-row">
            <button className="cr-btn cr-primary cr-neon" onClick={() => startGame()}>
              {t("playAgain")}
            </button>
            <button className="cr-btn" onClick={() => { setPhase("idle"); setSetupStep(1); }}>
              {t("back")}
            </button>
          </div>
        </main>
      )}

      {/* Правила */}
      {rulesOpen && (
        <Modal onClose={() => setRulesOpen(false)} ariaLabel={t("rules")}>
          <div className="cr-modal-title cr-h3">{t("rules")}</div>
          <ul className="cr-modal-body">
            <li>{t("rulesShort")}</li>
            <li>
              <b>{t("gotIt")}</b> — зелёная кнопка; <b>{t("skip")}</b> — «⏭».
            </li>
            <li>
              {t("comboRule")}. {t("skipMinus")}.
            </li>
            <li>{t("rulesOnce")}.</li>
          </ul>
          <div className="cr-modal-actions">
            <button className="cr-btn cr-primary cr-neon" onClick={() => setRulesOpen(false)}>
              {t("ok")}
            </button>
          </div>
        </Modal>
      )}

      {/* Между ходами: «Следующая команда» */}
      {handoverOpen && (
        <Modal
          onClose={() => {
            /* блокируем закрытие ESC для явного подтверждения */
          }}
          ariaLabel={t("nextUp")}
        >
          <div className="cr-modal-title cr-h3">{t("nextUp")}</div>
          <div className="cr-modal-body cr-solo-center">
            <div className="cr-first-turn-name">{displayName(nextTeamIndex ?? 0)}</div>
          </div>
          <div className="cr-modal-actions">
            <button className="cr-btn cr-primary cr-neon" onClick={confirmNextAndBegin}>
              {t("ok")}
            </button>
          </div>
        </Modal>
      )}

      {/* Модалка «Начинает раунд» */}
      {starterOpen && (
        <Modal
          onClose={() => {}}
          ariaLabel={t("startsRound")}
        >
          <div className="cr-starter">
            <div className="cr-starter-ill" aria-hidden>⏱️</div>
            <div className="cr-modal-title cr-h3 cr-center">{t("startsRound")}</div>
            <div className="cr-modal-body cr-starter-body">
              <div className="cr-starter-name">{displayName(starterIndex ?? 0)}</div>
              <ol className="cr-starter-instr">
                <li>Показывай слово только жестами: говорить и издавать звуки нельзя.</li>
                <li>Угадали — нажми кнопку с именем игрока, который угадал. Сложно — «{t("skip")}» ({t("skipMinus")}).</li>
                <li>Готов? Нажми «Старт».</li>
              </ol>
            </div>
            <div className="cr-modal-actions cr-center">
              <button className="cr-btn cr-primary cr-xl cr-neon" onClick={confirmStarterAndBegin}>
                <Icon name="timer" /> Старт
              </button>
            </div>
          </div>
        </Modal>
      )}
    </section>
  );
}

/* ============================ Подкомпоненты ============================ */

const ModeTile = memo(function ModeTile({ active, onClick, icon, label, sub }) {
  return (
    <button className={`cr-mode-tile ${active ? "cr-active" : ""}`} onClick={onClick} aria-pressed={active}>
      <Icon name={icon} />
      <div className="cr-col">
        <div className="cr-label">{label}</div>
        {sub && <div className="cr-muted cr-small">{sub}</div>}
      </div>
    </button>
  );
});

function DiffChip({ active, label, onClick, tone }) {
  return (
    <button className={`cr-chip cr-diff ${active ? "cr-active" : ""} cr-${tone}`} aria-pressed={active} onClick={onClick}>
      <span className="cr-dot" /> {label}
    </button>
  );
}

function Stat({ label, value }) {
  return (
    <div className="cr-stat">
      <div className="cr-stat-label">{label}</div>
      <div className="cr-stat-value">{value}</div>
    </div>
  );
}

function Toggle({ label, checked, onChange, disabled }) {
  return (
    <label className={`cr-toggle ${disabled ? "cr-disabled" : ""}`}>
      <input type="checkbox" checked={!!checked} onChange={(e) => onChange?.(e.target.checked)} disabled={disabled} />
      <span className="cr-knob" />
      <span>{label}</span>
    </label>
  );
}

function Selector({ label, options, value, onChange, multi = false }) {
  return (
    <label className="cr-selector">
      <span className="cr-muted cr-small">{label}</span>
      {!multi ? (
        <select className="cr-input" value={value} onChange={(e) => onChange?.(e.target.value)}>
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      ) : (
        <select
          className="cr-input"
          value={value}
          multiple
          onChange={(e) => {
            const vals = Array.from(e.target.selectedOptions).map((o) => o.value);
            onChange?.(vals);
          }}
        >
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      )}
    </label>
  );
}

/** Стильный pill-select для выбора количества игроков/команд */
function PillSelect({ label, options, value, onChange }) {
  return (
    <label className="cr-pill-select">
      <span className="cr-muted cr-small">{label}</span>
      <span className="cr-pill-select-wrap">
        <select
          className="cr-pill-select-control"
          aria-label={label}
          value={value}
          onChange={(e) => onChange?.(e.target.value)}
        >
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <span className="cr-pill-select-arrow" aria-hidden>
          <svg width="18" height="18" viewBox="0 0 24 24">
            <path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      </span>
    </label>
  );
}

function HeatBar({ value, onChange }) {
  return (
    <div className="cr-heat-bar" title="тепло/холодно">
      <input
        type="range"
        min="0"
        max="1"
        step="0.01"
        value={value}
        onChange={(e) => onChange?.(Number(e.target.value))}
        aria-label="тепло/холодно"
      />
      <div className="cr-heat-fill" style={{ width: `${value * 100}%` }} />
    </div>
  );
}

/** Модалка */
function Modal({ children, onClose, ariaLabel = "Диалог" }) {
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onClose?.();
    };
    window.addEventListener("keydown", onKey, { passive: true });
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const stop = (e) => {
    e.stopPropagation();
  };

  return (
    <div className="cr-modal-backdrop" role="dialog" aria-modal="true" aria-label={ariaLabel} onClick={() => onClose?.()}>
      <div className="cr-modal-card" onClick={stop}>
        {children}
      </div>
    </div>
  );
}

/* ============================ Вспомогательные ============================ */
function diffLabel(t, d) {
  if (d === "easy") return t("easy");
  if (d === "medium") return t("medium");
  if (d === "hard") return t("hard");
  return t("extreme");
}
