/* eslint-disable no-empty */
import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import Mafia from "./Mafia/Mafia";
import "./App.css";
import Crocodile from "./crocodile";
import Associations from "./Associations";
import Quiz from "./quiz";
import Questions from "./questions"; // «36 вопросов»
import TruthOrDare from "./TruthOrDare"; // Правда/Действие
import Compatibility from "./compatibility"; // «Совместимость»
import Choice from "./choice"; // «Выбор»
import SketchBattle from "./SketchBattle"; // «Скетч-баттл»
import Auction from "./Auction.tsx"; // 💰 «Аукцион»
import KnyazCourt from "./KnyazCourt.jsx"; // 🏰 «Княжий суд»

/**
 * Play Team — Telegram WebApp
 * Режимы:
 *  - "shell" — домашний экран и секции (оболочка со своим UI и стилями)
 *  - "game:<name>" — полноэкранная игра, никаких элементов оболочки
 *
 * Поддерживаемые игры:
 *  - mafia | auction | crocodile | associations | quiz | questions | truthordare | compatibility | choice | sketch | knyaz
 */

const DEFAULT_API_BASE = "https://api.play-team.ru";
const API_BASE = (() => {
  if (typeof window !== "undefined" && window.__APP_API_BASE__) return String(window.__APP_API_BASE__);
  if (typeof import.meta !== "undefined" && import.meta?.env?.VITE_API_BASE) return String(import.meta.env.VITE_API_BASE);
  if (typeof process !== "undefined" && process?.env?.VITE_API_BASE) return String(process.env.VITE_API_BASE);
  return DEFAULT_API_BASE;
})();
// ⚠️ Укажи юзернейм своего бота БЕЗ @ (например, PlayTeamBot)
const BOT_USERNAME = (() => {
  if (typeof window !== "undefined" && window.__BOT_USERNAME__) return String(window.__BOT_USERNAME__);
  if (typeof import.meta !== "undefined" && import.meta?.env?.VITE_BOT_USERNAME) return String(import.meta.env.VITE_BOT_USERNAME);
  if (typeof process !== "undefined" && process?.env?.BOT_USERNAME) return String(process.env.BOT_USERNAME);
  return "PlayTeamBot";
})();
// Сделаем юзернейм бота доступным из Mafia.jsx:
if (typeof window !== "undefined") {
  window.__BOT_USERNAME__ = BOT_USERNAME;
}
const STARTAPP_PAYLOAD = "home";
const GAME_MAFIA = "mafia";
const GAME_AUCTION = "auction";
const normalizeGameName = (raw) => {
  const v = String(raw || "").trim().toLowerCase();
  if (v === GAME_AUCTION) return GAME_AUCTION;
  if (v === GAME_MAFIA) return GAME_MAFIA;
  return null;
};
const parseStartPayload = (raw = "") => {
  const value = String(raw || "").trim();
  const auctionMatch = value.match(/^auction-([A-Za-z0-9_-]{4,})$/i);
  if (auctionMatch) return { code: auctionMatch[1].toUpperCase(), game: GAME_AUCTION };
  const joinMatch = value.match(/^join-([A-Za-z0-9_-]{4,})$/i);
  if (joinMatch) return { code: joinMatch[1].toUpperCase(), game: GAME_MAFIA };
  return { code: null, game: null };
};

/* ==== Helpers для одноразового инвайта ==== */
const INVITE_STORAGE_KEY = `pt_consumed_invites_v1_${BOT_USERNAME}`; // чтобы не конфликтовало между ботами
function readConsumedInvites() {
  try {
    return JSON.parse(localStorage.getItem(INVITE_STORAGE_KEY) || "{}");
  } catch {
    return {};
  }
}
function writeConsumedInvites(map) {
  try {
    localStorage.setItem(INVITE_STORAGE_KEY, JSON.stringify(map));
  } catch { /* noop */ }
}
function stripInviteFromUrl() {
  try {
    const u = new URL(location.href);
    u.searchParams.delete("join");
    u.searchParams.delete("game");
    u.searchParams.delete("tgWebAppStartParam");
    const hash = new URLSearchParams(u.hash.replace(/^#/, ""));
    hash.delete("join");
    hash.delete("game");
    hash.delete("tgWebAppStartParam");
    u.hash = hash.toString() ? `#${hash.toString()}` : "";
    history.replaceState(null, "", u.toString());
  } catch { /* noop */ }
}

/* ВКЛЮЧЁН фолбэк автопоиска активной комнаты */
const ENABLE_ACTIVE_ROOM_AUTOPROBE = true;

export default function App() {
  // ---- Core ----
  const [user, setUser] = useState(null);
  const [status, setStatus] = useState("⏳ Проверяем API…");

  // route = { kind: 'shell' } | { kind: 'game', name: 'mafia'|'auction'|'crocodile'|'associations'|'quiz'|'questions'|'truthordare'|'compatibility'|'choice'|'sketch' }
  const [route, setRoute] = useState({ kind: "shell" });
  const [section, setSection] = useState("home"); // home | party | local | love

  // геймификация
  const [level, setLevel] = useState(() => Number(localStorage.getItem("pt_level") || 1));
  const [games, setGames] = useState(() => Number(localStorage.getItem("pt_games") || 0));

  const [themeTick, setThemeTick] = useState(0);
  const fullscreenAttemptsRef = useRef(0);

  // Telegram WebApp API (если открыто в вебвью Telegram)
  const tg = typeof window !== "undefined" ? window?.Telegram?.WebApp : undefined;

  const syncTelegramLayout = useCallback(() => {
    if (typeof window === "undefined" || typeof document === "undefined") return;
    const root = document.documentElement;
    if (!root?.style?.setProperty) return;

    const toNum = (v) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

    const vh = toNum(tg?.viewportHeight) || window.innerHeight || 0;
    const vsh = toNum(tg?.viewportStableHeight) || vh;

    const safe = tg?.safeAreaInset || {};
    const content = tg?.contentSafeAreaInset || {};

    const safeTop = toNum(safe.top);
    const safeRight = toNum(safe.right);
    const safeBottom = toNum(safe.bottom);
    const safeLeft = toNum(safe.left);

    const contentTop = toNum(content.top);
    const contentRight = toNum(content.right);
    const contentBottom = toNum(content.bottom);
    const contentLeft = toNum(content.left);

    root.style.setProperty("--pt-viewport-height", `${vh}px`);
    root.style.setProperty("--pt-viewport-stable-height", `${vsh}px`);

    root.style.setProperty("--pt-safe-area-inset-top", `${safeTop}px`);
    root.style.setProperty("--pt-safe-area-inset-right", `${safeRight}px`);
    root.style.setProperty("--pt-safe-area-inset-bottom", `${safeBottom}px`);
    root.style.setProperty("--pt-safe-area-inset-left", `${safeLeft}px`);

    root.style.setProperty("--pt-content-safe-area-inset-top", `${contentTop}px`);
    root.style.setProperty("--pt-content-safe-area-inset-right", `${contentRight}px`);
    root.style.setProperty("--pt-content-safe-area-inset-bottom", `${contentBottom}px`);
    root.style.setProperty("--pt-content-safe-area-inset-left", `${contentLeft}px`);

    root.style.setProperty("--pt-layout-inset-top", `${Math.max(contentTop, safeTop)}px`);
    root.style.setProperty("--pt-layout-inset-right", `${Math.max(contentRight, safeRight)}px`);
    root.style.setProperty("--pt-layout-inset-bottom", `${Math.max(contentBottom, safeBottom)}px`);
    root.style.setProperty("--pt-layout-inset-left", `${Math.max(contentLeft, safeLeft)}px`);
  }, [tg]);

  useEffect(() => {
    syncTelegramLayout();
    if (typeof window === "undefined") return;

    const handleResize = () => syncTelegramLayout();
    window.addEventListener("resize", handleResize, { passive: true });
    window.visualViewport?.addEventListener?.("resize", handleResize, { passive: true });
    return () => {
      window.removeEventListener("resize", handleResize);
      window.visualViewport?.removeEventListener?.("resize", handleResize);
    };
  }, [syncTelegramLayout]);

  // Доп. источник initData: некоторые клиенты прокидывают tgWebAppData в URL
  const initFromUrl =
    typeof window !== "undefined"
      ? (
          new URLSearchParams(location.search).get("tgWebAppData") ||
          new URLSearchParams(location.hash.slice(1)).get("tgWebAppData") ||
          ""
        )
      : "";

  // NEW: поддержка запуска через ?startapp=... → Telegram добавляет tgWebAppStartParam в URL
  const startParamFromUrl =
    typeof window !== "undefined"
      ? (
          new URLSearchParams(location.search).get("tgWebAppStartParam") ||
          new URLSearchParams(location.hash.slice(1)).get("tgWebAppStartParam") ||
          ""
        )
      : "";

  // --- Инвайт-код: реактивное состояние, обновляется из всех источников ---
  const [inviteCode, setInviteCode] = useState(null);
  const [inviteGame, setInviteGame] = useState(null); // 'mafia' | 'auction' | null

  // Одноразовый инвайт: локальная карта "поглощённых"
  const consumedInvitesRef = useRef({});
  useEffect(() => {
    consumedInvitesRef.current = readConsumedInvites();
  }, []);
  const isInviteConsumed = useCallback((code) => !!(code && consumedInvitesRef.current?.[code]), []);
  const applyInvite = useCallback(
    (code, game = null) => {
      const normalizedCode = (code || "").toUpperCase();
      if (!normalizedCode) return;
      if (isInviteConsumed(normalizedCode)) return;
      const normalizedGame = normalizeGameName(game);
      if (normalizedCode === inviteCode && normalizedGame === inviteGame) return;
      setInviteCode(normalizedCode);
      setInviteGame(normalizedGame);
    },
    [inviteCode, inviteGame, isInviteConsumed]
  );
  const consumeInvite = useCallback((code) => {
    if (!code) return;
    const map = { ...(consumedInvitesRef.current || {}), [code]: Date.now() };
    consumedInvitesRef.current = map;
    writeConsumedInvites(map);
    // Важно: сразу чистим URL, чтобы рефреш/повторное открытие не тащило обратно.
    stripInviteFromUrl();
    setInviteCode(null);
    setInviteGame(null);
  }, []);

  // Если есть WebApp API, tgWebAppData в URL или tgWebAppStartParam — считаем, что это запуск из Telegram
  const isProbablyTelegram = !!tg || !!initFromUrl || !!startParamFromUrl;

  const activeProbeRef = useRef(false); // ← чтобы не дёргать автопоиск комнаты многократно

  // ---- Theming (цвета оболочки) ----
  const { theme, scheme } = useMemo(() => {
    const p = tg?.themeParams || {};
    const scheme = (tg?.colorScheme === "light" || tg?.colorScheme === "dark") ? tg.colorScheme : "dark";

    const fallbackLight = { bg: "#f7f8fa", text: "#0f1419", hint: "#6b7785", link: "#0a84ff", button: "#0ea5e9", button_text: "#111827", surface: "rgba(0,0,0,.05)", surfaceHigh: "rgba(0,0,0,.08)" };
    const fallbackDark  = { bg: "#0b0e13", text: "#e9edf4", hint: "#b7c0c9", link: "#7dd3fc", button: "#0ea5e9", button_text: "#ffffff", surface: "rgba(255,255,255,.08)", surfaceHigh: "rgba(255,255,255,.16)" };
    const fb = scheme === "light" ? fallbackLight : fallbackDark;
    const hex = (v, fbv) => (v ? `#${String(v).replace(/^#/, "")}` : fbv);

    const theme = {
      bg: hex(p.bg_color, fb.bg),
      text: hex(p.text_color, fb.text),
      hint: hex(p.hint_color, fb.hint),
      link: hex(p.link_color, fb.link),
      button: hex(p.button_color, fb.button),
      button_text: hex(p.button_text_color, fb.button_text),
      surface: hex(p.secondary_bg_color, fb.surface),
      surfaceHigh: fb.surfaceHigh,
    };
    return { theme, scheme };
  }, [tg?.themeParams, tg?.colorScheme, themeTick]);

  const accentRGB = useMemo(() => {
    const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(theme.button || "");
    return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [14, 165, 233];
  }, [theme.button]);

  const cssVars = useMemo(
    () => ({
      "--bg": theme.bg,
      "--text": theme.text,
      "--hint": theme.hint,
      "--link": theme.link,
      "--btn": theme.button,
      "--btn-text": theme.button_text,
      "--surface": theme.surface,
      "--surface-high": theme.surfaceHigh,
      "--accent-rgb": `${accentRGB[0]} ${accentRGB[1]} ${accentRGB[2]}`,
    }),
    [theme, accentRGB]
  );

  // ---- Telegram lifecycle ----
  useEffect(() => {
    if (!tg) return;

    // 1) Сначала читаем пользователя — это синхронно и не зависит от других вызовов
    setUser(tg.initDataUnsafe?.user || null);

    // Подстраховка: на следующий кадр ещё раз перечитаем (редкая гонка на старте клиента)
    const raf = requestAnimationFrame(() => {
      const u = tg.initDataUnsafe?.user || null;
      setUser((prev) => prev || u || null);
    });

    // 2) Остальное — по отдельности, чтобы падение одного не срывало setUser
    const ensureFullscreen = () => {
      try { if (!tg.isExpanded) tg.expand(); } catch {}
      try {
        if (fullscreenAttemptsRef.current >= 5) return;
        if (!tg?.requestFullscreen || typeof tg.requestFullscreen !== "function") {
          fullscreenAttemptsRef.current = 5;
          return;
        }
        if (tg.isFullscreen) {
          fullscreenAttemptsRef.current = 5;
          return;
        }
        fullscreenAttemptsRef.current += 1;
        tg.requestFullscreen();
      } catch {}
    };

    try { tg.ready(); } catch {}
    ensureFullscreen();
    try { tg.setHeaderColor?.("secondary_bg_color"); } catch {}
    syncTelegramLayout();

    const handler = () => setThemeTick((v) => v + 1);
    const viewportHandler = () => { ensureFullscreen(); syncTelegramLayout(); };
    const interactionHandler = () => ensureFullscreen();
    tg?.onEvent?.("themeChanged", handler);
    tg?.onEvent?.("viewportChanged", viewportHandler);
    tg?.onEvent?.("safeAreaChanged", syncTelegramLayout);
    tg?.onEvent?.("contentSafeAreaChanged", syncTelegramLayout);
    window.addEventListener("pointerdown", interactionHandler, { passive: true });
    window.addEventListener("keydown", interactionHandler);

    // Некоторые клиенты Telegram применяют viewport не сразу — повторим несколько раз.
    const t1 = setTimeout(ensureFullscreen, 100);
    const t2 = setTimeout(ensureFullscreen, 500);
    return () => {
      tg?.offEvent?.("themeChanged", handler);
      tg?.offEvent?.("viewportChanged", viewportHandler);
      tg?.offEvent?.("safeAreaChanged", syncTelegramLayout);
      tg?.offEvent?.("contentSafeAreaChanged", syncTelegramLayout);
      window.removeEventListener("pointerdown", interactionHandler);
      window.removeEventListener("keydown", interactionHandler);
      clearTimeout(t1);
      clearTimeout(t2);
      cancelAnimationFrame(raf);
    };
  }, [tg, syncTelegramLayout]);

  /* ---------- Надёжное получение initData с ретраями ---------- */
  const [resolvedInitData, setResolvedInitData] = useState("");
  useEffect(() => {
    if (!tg && !initFromUrl) return;

    let cancelled = false;
    let tries = 0;

    const pump = () => {
      if (cancelled) return;
      const id = (tg?.initData || "") || initFromUrl || "";
     	if (id) {
        setResolvedInitData(id);
        return;
      }
      // ждём, пока Telegram заполнит initData после ready()
      if (tries++ < 40) setTimeout(pump, 100); // максимум ~4 секунды
    };

    pump();
    return () => { cancelled = true; };
  }, [tg, initFromUrl]);

  /* ---------- Верификация на сервере после появления initData ---------- */
  useEffect(() => {
    if (!resolvedInitData) return;
    // Если уже есть user из initDataUnsafe — серверная верификация не обязательна,
    // но пусть заполнит user, если раньше не успели
    if (user?.id) return;

    fetch(`${API_BASE}/auth/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ initData: resolvedInitData }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.ok && data.user) {
          // ✅ сервер возвращает snake_case (parseUser из initData)
          setUser({
            id: data.user.id,
            first_name: data.user.first_name ?? null,
            username: data.user.username ?? null,
            photo_url: data.user.photo_url ?? null,
          });
        }
      })
      .catch(() => {});
  }, [resolvedInitData, user]);

  /* ---------- Источники инвайт-кода: URL / hash (join=XXXX) ---------- */
  useEffect(() => {
    if (typeof window === "undefined") return;
    const q = new URLSearchParams(location.search).get("join");
    const gq = new URLSearchParams(location.search).get("game");
    const h = new URLSearchParams(location.hash.slice(1)).get("join");
    const gh = new URLSearchParams(location.hash.slice(1)).get("game");
    const next = (q || h || "").trim();
    const up = (next || "").toUpperCase();
    if (up) applyInvite(up, gq || gh || null);
  }, []); // один раз при монтировании

  /* ---------- Источники инвайт-кода: tgWebAppStartParam из URL (при ?startapp=...) ---------- */
  useEffect(() => {
    if (!startParamFromUrl) return;
    const { code, game } = parseStartPayload(startParamFromUrl);
    if (code) applyInvite(code, game);
  }, [startParamFromUrl, applyInvite]);

  /* ---------- Источники инвайт-кода: start_param из initDataUnsafe (может появиться позже) ---------- */
  useEffect(() => {
    const sp = tg?.initDataUnsafe?.start_param || "";
    const { code, game } = parseStartPayload(sp);
    if (code) applyInvite(code, game);
  }, [tg?.initDataUnsafe?.start_param, applyInvite]);

  /* ---------- Источники инвайт-кода: разбор строки resolvedInitData ---------- */
  useEffect(() => {
    if (!resolvedInitData) return;
    const sp = new URLSearchParams(resolvedInitData).get("start_param") || "";
    const { code, game } = parseStartPayload(sp);
    if (code) applyInvite(code, game);
  }, [resolvedInitData, applyInvite]);

  // ---- Делегирование BackButton + управление системными жестами TG ----
  const backHandlerRef = useRef(null);            // сюда игры кладут свой обработчик
  const backProxyRef = useRef(null);              // стабильная ссылка для onClick/offClick

  const setBackHandler = (fn) => {
    backHandlerRef.current = typeof fn === "function" ? fn : null;
  };

  const closeGame = () => setRoute({ kind: "shell" });

  useEffect(() => {
    if (!tg?.BackButton) return;

    // единый прокси-обработчик (стабильный), который вызывает
    // либо игровой обработчик, либо дефолтный closeGame
    if (!backProxyRef.current) {
      backProxyRef.current = () => {
        try { tg.HapticFeedback?.impactOccurred?.("light"); } catch {}
        const fn = backHandlerRef.current || closeGame;
        fn?.();
      };
    }

    if (route.kind === "game") {
      tg.BackButton.show();
      tg.BackButton.onClick(backProxyRef.current);

      // Системные жесты/закрытие
      tg.disableVerticalSwipes?.();
      tg.enableClosingConfirmation?.();
    } else {
      tg.BackButton.hide();
      tg.BackButton.offClick(backProxyRef.current);

      tg.enableVerticalSwipes?.();
      tg.disableClosingConfirmation?.();

      // очистим кастомный обработчик на выходе из игры
      backHandlerRef.current = null;
    }

    return () => {
      // на всякий случай при размонтировании/смене роута убираем хэндлер
      tg.BackButton?.offClick?.(backProxyRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route.kind, tg]);

  // ---- API health ----
  useEffect(() => {
    fetch(`${API_BASE}/health`)
      .then((r) => setStatus(r.ok ? "✅ API доступен" : "❌ Ошибка API"))
      .catch(() => setStatus("❌ Сервер недоступен"));
  }, []);

  // ---- Helpers ----
  const bumpProgress = () => {
    const nextGames = games + 1;
    const nextLevel = Math.max(1, Math.floor(nextGames / 5) + 1);
    setGames(nextGames);
    setLevel(nextLevel);
    localStorage.setItem("pt_games", String(nextGames));
    localStorage.setItem("pt_level", String(nextLevel));
  };

  const openGame = (name) => setRoute({ kind: "game", name });

  // initData, который будем пробрасывать в игры/сокеты по необходимости
  const effectiveInitData = resolvedInitData || tg?.initData || initFromUrl || "";
  const mafiaAutoJoin = inviteGame === GAME_AUCTION ? null : inviteCode;
  const auctionAutoJoin = inviteGame === GAME_AUCTION ? inviteCode : null;

  /* ---------- ФОЛБЭК: если уже добавили в комнату через /start, а WebApp открыт без ?join/ start_param ---------- */
  useEffect(() => {
    if (!ENABLE_ACTIVE_ROOM_AUTOPROBE) return;
    // Условия запуска:
    //  - точно Telegram
    //  - ещё нет inviteCode
    //  - сейчас оболочка (игра не открыта)
    //  - есть валидный initData (для авторизации запроса)
    if (activeProbeRef.current) return;
    if (!isProbablyTelegram) return;
    if (inviteCode) return;
    if (route.kind === "game") return;
    const id = effectiveInitData;
    if (!id) return;

    activeProbeRef.current = true;
    let aborted = false;
    (async () => {
      try {
        const resp = await fetch(`${API_BASE}/api/self/active-room`, {
          method: "GET",
          headers: { "Accept": "application/json", "X-Telegram-Init-Data": id },
        });
        if (!resp.ok) return;
        const data = await resp.json();
        const code = (data?.code || "").toString().trim().toUpperCase();
        const game = normalizeGameName(data?.game);
        if (!aborted && code) {
          applyInvite(code, game);
        }
      } catch {
        /* silent */
      }
    })();
    return () => { aborted = true; };
  }, [isProbablyTelegram, inviteCode, route.kind, effectiveInitData, applyInvite]);

  // ---- Автопереход в «Мафию», если найден инвайт-код ----
  useEffect(() => {
    if (inviteCode) setRoute({ kind: "game", name: inviteGame || "mafia" });
  }, [inviteCode, inviteGame]);

  // ---- Guard: если открыто НЕ в Telegram (и нет tgWebAppData/tgWebAppStartParam), показываем кнопку "Открыть в Telegram"
  if (typeof window !== "undefined" && !isProbablyTelegram) {
    // в guard-е (когда не Telegram): сохраняем инвайт-код в startapp
    const startPayload = inviteCode
      ? `${inviteGame === GAME_AUCTION ? "auction" : "join"}-${inviteCode}`
      : STARTAPP_PAYLOAD;
    const deepLink = `https://t.me/${BOT_USERNAME}?startapp=${encodeURIComponent(startPayload)}`;
    return (
      <div className="app" data-scheme={scheme} style={cssVars}>
        <GlobalReset />
        <div className="tgLayout">
          <div style={{ padding: 16, display: "grid", gap: 12 }}>
            <h2 style={{ margin: 0 }}>Открой игру в Telegram</h2>
            <p style={{ margin: 0, opacity: 0.8 }}>
              Кажется, приложение запущено в браузере. Чтобы войти, открой его через Telegram.
            </p>
            <a
              className="dockCTA"
              href={deepLink}
              rel="noopener noreferrer"
              style={{
                display: "inline-grid",
                placeItems: "center",
                textDecoration: "none",
                width: "100%",
                maxWidth: 360,
                height: 52,
                borderRadius: 16,
                border: "1px solid color-mix(in srgb, var(--text) 12%, transparent)",
                background: "color-mix(in srgb, var(--surface) 85%, transparent)"
              }}
            >
              Открыть в Telegram
            </a>
          </div>
        </div>
      </div>
    );
  }

  // ---- Render ----
  return (
    <div className="app" data-scheme={scheme} style={cssVars}>
      <GlobalReset />
      <div className="tgLayout">
        {route.kind === "shell" ? (
          <Shell
            scheme={scheme}
            user={user}
            status={status}
            games={games}
            level={level}
            section={section}
            setSection={setSection}
            onOpenGame={openGame}
          />
        ) : (
          <GameCanvas>
            {route.name === "mafia" && (
              <Mafia
                apiBase={API_BASE}
                initData={effectiveInitData}
                goBack={closeGame}
                onProgress={bumpProgress}
                setBackHandler={setBackHandler}  // <-- делегируем управление BackButton в игру
                autoJoinCode={mafiaAutoJoin}     // <-- прокидываем код инвайта
                onInviteConsumed={consumeInvite} // <-- одноразовый инвайт: после входа пометить и очистить URL
              />
            )}
            {route.name === "auction" && (
              <Auction
                apiBase={API_BASE}
                initData={effectiveInitData}
                goBack={closeGame}
                onProgress={bumpProgress}
                setBackHandler={setBackHandler}
                autoJoinCode={auctionAutoJoin}
                onInviteConsumed={consumeInvite}
              />
            )}
            {route.name === "crocodile" && (
              <Crocodile goBack={closeGame} onProgress={bumpProgress} setBackHandler={setBackHandler} />
            )}
            {route.name === "associations" && (
              <Associations goBack={closeGame} onProgress={bumpProgress} setBackHandler={setBackHandler} />
            )}
            {route.name === "quiz" && (
              <Quiz goBack={closeGame} onProgress={bumpProgress} setBackHandler={setBackHandler} />
            )}
            {route.name === "questions" && (
              <Questions goBack={closeGame} onProgress={bumpProgress} setBackHandler={setBackHandler} />
            )}
            {route.name === "truthordare" && (
              <TruthOrDare goBack={closeGame} onProgress={bumpProgress} setBackHandler={setBackHandler} />
            )}
            {route.name === "compatibility" && (
              <Compatibility goBack={closeGame} onProgress={bumpProgress} setBackHandler={setBackHandler} />
            )}
            {route.name === "choice" && (
              <Choice goBack={closeGame} onProgress={bumpProgress} setBackHandler={setBackHandler} />
            )}
            {route.name === "knyaz" && (
              <KnyazCourt goBack={closeGame} onProgress={bumpProgress} setBackHandler={setBackHandler} />
            )}
            {route.name === "sketch" && (
              <SketchBattle goBack={closeGame} onProgress={bumpProgress} setBackHandler={setBackHandler} />
            )}
          </GameCanvas>
        )}
      </div>
    </div>
  );
}

/* ===================== SHELL (оболочка) ===================== */

function Shell({ scheme, user, status, level, games, section, setSection, onOpenGame }) {
  return (
    <div className="shell">
      <ShellBackdrop scheme={scheme} />
      <div className="wrap">
        <Header user={user} status={status} level={level} games={games} />

        {/* HOME */}
        {section === "home" && (
          <div className="grid" role="list">
            <CategoryCard
              emoji="🎉"
              title="Мультиплеер"
              subtitle="комнаты и роли"
              participants="4–12"
              gradient="linear-gradient(135deg, rgba(14,165,233,.9), rgba(99,102,241,.9))"
              onClick={() => setSection("party")}
            />
            <CategoryCard
              emoji="🎮"
              title="На одном устройстве"
              subtitle="быстрые мини-игры"
              participants="2–12"
              gradient="linear-gradient(135deg, rgba(34,197,94,.95), rgba(20,184,166,.9))"
              onClick={() => setSection("local")}
            />
            <CategoryCard
              emoji="💞"
              title="Для влюблённых"
              subtitle="вопросы и челленджи"
              participants="2"
              gradient="linear-gradient(135deg, rgba(244,114,182,.95), rgba(250,204,21,.9))"
              onClick={() => setSection("love")}
            />
          </div>
        )}

        {/* PARTY */}
        {section === "party" && (
          <Section
            title="Мультиплеер"
            back={() => setSection("home")}
            items={[
              { icon: "🕵️‍♂️", name: "Мафия", desc: "день/ночь, роли, голосование", action: () => onOpenGame("mafia") },
              { icon: "💰", name: "Аукцион", desc: "торги и лутбоксы", action: () => onOpenGame("auction") },
              { icon: "🚪", name: "Бункер", desc: "спор и отбор (в разработке)", action: () => null },
              { icon: "🧠", name: "Викторина (командная)", desc: "раунды, очки, блиц", action: () => null },
              { icon: "📣", name: "Alias/Шляпа", desc: "объясни слово без слов", action: () => null },
            ]}
          />
        )}

        {/* LOCAL */}
        {section === "local" && (
          <Section
            title="На одном устройстве"
            back={() => setSection("home")}
            items={[
              { icon: "🎭", name: "Крокодил", desc: "покажи — не говори", action: () => onOpenGame("crocodile") },
              { icon: "🧩", name: "Обьясни слово", desc: "угадай по намёкам", action: () => onOpenGame("associations") },
              { icon: "🏰", name: "Княжий суд", desc: "допросы и приговор", action: () => onOpenGame("knyaz") },
              { icon: "❓", name: "Блиц-викторина", desc: "быстро и на счёт", action: () => onOpenGame("quiz") },
              { icon: "✍️", name: "Скетч-баттл", desc: "рисуй за 30 сек", action: () => onOpenGame("sketch") },
              { icon: "⚖️", name: "Выбор", desc: "два варианта — один выбор", action: () => onOpenGame("choice") },
            ]}
          />
        )}

        {/* LOVE */}
        {section === "love" && (
          <Section
            title="Для влюблённых"
            back={() => setSection("home")}
            items={[
              { icon: "💬", name: "36 вопросов", desc: "сближает мягко и честно", action: () => onOpenGame("questions") },
              { icon: "🔥", name: "Правда/Действие", desc: "романтика или перчинка", action: () => onOpenGame("truthordare") },
              { icon: "🧩", name: "Совместимость", desc: "мини-квесты на совпадения", action: () => onOpenGame("compatibility") },
            ]}
          />
        )}

        <BottomBar
          onHome={() => setSection("home")}
          onInvite={() => {
            // Используем deep link, чтобы WebApp открылся внутри Telegram с валидным initData
            const shareUrl = `https://t.me/${BOT_USERNAME}?startapp=${encodeURIComponent(STARTAPP_PAYLOAD)}`;
            const tg = window?.Telegram?.WebApp;
            try {
              tg?.HapticFeedback?.impactOccurred?.("medium");
              if (tg?.openTelegramLink) tg.openTelegramLink(shareUrl);
              else window.open(shareUrl, "_blank", "noopener,noreferrer");
            } catch {
              window.open(shareUrl, "_blank", "noopener,noreferrer");
            }
          }}
          onRating={() => {
            const url = `${window.location.origin}/leaderboard`;
            const tg = window?.Telegram?.WebApp;
            tg?.HapticFeedback?.impactOccurred?.("light");
            window.open(url, "_blank", "noopener,noreferrer");
          }}
        />
      </div>
    </div>
  );
}

/* ===================== GAME CANVAS (fullscreen) ===================== */

function GameCanvas({ children }) {
  // Свайп-закрытие отключено. Закрытие — через системную BackButton TG (делегируется в игры) или кнопки в игре.
  return (
    <div className="gameCanvas" role="application" aria-label="Игра">
      <div className="gameStage">{children}</div>
      <GameCanvasStyles />
    </div>
  );
}

/* ===================== UI элементов оболочки ===================== */

function Header({ user, status, level, games }) {
  const initials = (user?.first_name || "Гость").slice(0, 1).toUpperCase();
  // Telegram numeric id, если вдруг пришло что-то иное — не используем прокси
  const tgId = user?.id && /^\d+$/.test(String(user.id)) ? String(user.id) : null;

  return (
    <header className="shell-header" role="banner" aria-label="Профиль">
      <div className="profile">
        <div className="avatar" aria-hidden>
          <AvatarImg tgId={tgId} photoUrl={user?.photo_url || ""} initials={initials} />
        </div>
        <div className="who">
          <div className="name" title={user?.first_name || "Гость"}>{user?.first_name || "Гость"}</div>
          <div className="meta">
            <span className="chip">Уровень {level}</span>
            <span className="sep">•</span>
            <span className="chip">Игр: {games}</span>
          </div>
        </div>
      </div>
      <div className="status" aria-live="polite">{status}</div>
    </header>
  );
}

// Надёжная картинка аватара: пробуем прокси /avatar/:tgId → fallback на photo_url → инициалы
function AvatarImg({ tgId, photoUrl, initials }) {
  const triedProxy = useRef(false);
  const [src, setSrc] = useState(() => (tgId ? `${API_BASE}/avatar/${tgId}` : (photoUrl || "")));

  useEffect(() => {
    if (tgId) {
      setSrc(`${API_BASE}/avatar/${tgId}`);
      triedProxy.current = true;
    } else {
      setSrc(photoUrl || "");
      triedProxy.current = false;
    }
  }, [tgId, photoUrl]);

  if (!src) {
    return <span>{initials}</span>;
  }

  return (
    <img
      src={src}
      alt=""
      referrerPolicy="no-referrer"
      decoding="async"
      loading="eager"
      onError={() => {
        if (triedProxy.current && photoUrl) {
          // Прокси не сработал — пробуем прямую ссылку из Telegram
          setSrc(photoUrl);
          triedProxy.current = false;
        } else {
          // Совсем не загрузилось — показываем инициалы
          setSrc("");
        }
      }}
      style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
    />
  );
}

function Section({ title, back, items }) {
  return (
    <section className="shell-section" aria-label={title}>
      <div className="sectionHeader">
        <button className="btn back" onClick={back} aria-label="Назад">
          <span className="ico" aria-hidden>←</span> Назад
        </button>
        <h2 className="sectionTitle" title={title}>{title}</h2>
      </div>
      <div className="list" role="list">
        {items.map((it) => (
          <button key={it.name} className="listItem" onClick={it.action} aria-label={it.name} role="listitem">
            <span className="listIcon" aria-hidden>{it.icon}</span>
            <span className="listText">
              <b className="listTitle" title={it.name}>{it.name}</b>
              <small className="hint listDesc" title={it.desc}>{it.desc}</small>
            </span>
            <span className="chev" aria-hidden>›</span>
          </button>
        ))}
      </div>
    </section>
  );
}

function CategoryCard({ emoji, title, subtitle, onClick, gradient, participants }) {
  const ref = useRef(null);
  const rafRef = useRef(null);
  const targetRef = useRef({ mx: 0, my: 0 });

  const setTilt = (mx, my) => {
    const el = ref.current; if (!el) return;
    el.style.setProperty("--mx", String(mx.toFixed(3)));
    el.style.setProperty("--my", String(my.toFixed(3)));
  };
  const loop = () => {
    const el = ref.current; if (!el) return;
    const g = getComputedStyle(el);
    const curX = parseFloat(g.getPropertyValue("--mx") || "0") || 0;
    const curY = parseFloat(g.getPropertyValue("--my") || "0") || 0;
    const nextX = curX + (targetRef.current.mx - curX) * 0.18;
    const nextY = curY + (targetRef.current.my - curY) * 0.18;
    setTilt(nextX, nextY);
    rafRef.current = requestAnimationFrame(() => {
      if (Math.abs(nextX - targetRef.current.mx) < 0.001 && Math.abs(nextY - targetRef.current.my) < 0.001) {
        cancelAnimationFrame(rafRef.current); rafRef.current = null; return;
      }
      loop();
    });
  };
  const handleMove = (e) => {
    const el = ref.current; if (!el) return;
    const rect = el.getBoundingClientRect();
    const t = e.touches?.[0];
    const x = (t ? t.clientX : e.clientX) - rect.left;
    const y = (t ? t.clientY : e.clientY) - rect.top;
    targetRef.current = { mx: (x / rect.width) * 2 - 1, my: (y / rect.height) * 2 - 1 };
    if (!rafRef.current) loop();
  };
  const handleLeave = () => { targetRef.current = { mx: 0, my: 0 }; if (!rafRef.current) loop(); };

  return (
    <button
      ref={ref}
      className="card"
      style={{ "--card-gradient": gradient }}
      onClick={onClick}
      onMouseMove={handleMove}
      onMouseLeave={handleLeave}
      onTouchMove={handleMove}
      onTouchEnd={handleLeave}
      aria-label={title}
      role="listitem"
    >
      {participants && (
        <span className="cardPill" aria-label={`Участники ${participants}`} title={`Участники ${participants}`}>
          👥 {participants}
        </span>
      )}
      <div className="cardEmoji" aria-hidden>{emoji}</div>
      <div className="cardTitle" title={title}>{title}</div>
      <div className="cardSub" title={subtitle}>{subtitle}</div>
    </button>
  );
}

function BottomBar({ onHome, onInvite, onRating }) {
  return (
    <div className="bottom" role="toolbar" aria-label="Быстрые действия">
      <button className="dockBtn" onClick={onHome} aria-label="Домой">
        <span className="ico" aria-hidden>🏠</span>
      </button>
      <button className="dockCTA" onClick={onInvite} aria-label="Пригласить друзей">
        🤝 Пригласить друзей
      </button>
      <button className="dockBtn" onClick={onRating} aria-label="Рейтинг">
        <span className="ico" aria-hidden>🏆</span>
      </button>
    </div>
  );
}

function ShellBackdrop({ scheme }) {
  return (
    <div className="backdrop" data-scheme={scheme} aria-hidden>
      <span className="bg-layer" />
      <span className="orb orb-1" />
      <span className="orb orb-2" />
      <span className="orb orb-3" />
      <span className="grain" />
    </div>
  );
}

/* ===================== STYLES ===================== */

function GlobalReset() {
  return (
    <style
      dangerouslySetInnerHTML={{
        __html: `
* { box-sizing: border-box; }
html, body, #root { height: 100%; }
:root {
  color-scheme: light dark;
  --pt-viewport-height: var(--tg-viewport-height, 100dvh);
  --pt-viewport-stable-height: var(--tg-viewport-stable-height, 100dvh);

  --pt-safe-area-inset-top: var(--tg-safe-area-inset-top, env(safe-area-inset-top, 0px));
  --pt-safe-area-inset-right: var(--tg-safe-area-inset-right, env(safe-area-inset-right, 0px));
  --pt-safe-area-inset-bottom: var(--tg-safe-area-inset-bottom, env(safe-area-inset-bottom, 0px));
  --pt-safe-area-inset-left: var(--tg-safe-area-inset-left, env(safe-area-inset-left, 0px));

  --pt-content-safe-area-inset-top: var(--tg-content-safe-area-inset-top, var(--pt-safe-area-inset-top));
  --pt-content-safe-area-inset-right: var(--tg-content-safe-area-inset-right, var(--pt-safe-area-inset-right));
  --pt-content-safe-area-inset-bottom: var(--tg-content-safe-area-inset-bottom, var(--pt-safe-area-inset-bottom));
  --pt-content-safe-area-inset-left: var(--tg-content-safe-area-inset-left, var(--pt-safe-area-inset-left));

  --pt-layout-inset-top: var(--pt-content-safe-area-inset-top);
  --pt-layout-inset-right: var(--pt-content-safe-area-inset-right);
  --pt-layout-inset-bottom: var(--pt-content-safe-area-inset-bottom);
  --pt-layout-inset-left: var(--pt-content-safe-area-inset-left);
}
body {
  margin: 0;
  background: var(--bg, #000);
  color: var(--text, #fff);
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
  font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Inter, Helvetica, Arial, "Apple Color Emoji", "Segoe UI Emoji";
}
button { font: inherit; cursor: pointer; background: none; border: 0; color: inherit; }
a { color: var(--link, #0a84ff); text-decoration: none; }
@media (prefers-reduced-motion: reduce) { * { animation-duration: .01ms !important; transition-duration: .01ms !important; } }

/* Общий контейнер */
.app { min-height: var(--pt-viewport-height); width: 100%; position: relative; overflow: hidden; background: var(--bg); }

/* Единый layout-контейнер: учитывает верхнюю панель Telegram и safe-area */
.tgLayout {
  min-height: var(--pt-viewport-height);
  width: 100%;
  box-sizing: border-box;
  padding-top: var(--pt-layout-inset-top);
}

/* ===== SHELL ONLY (всё, что ниже префиксировано .shell и не влияет на игры) ===== */
.shell .backdrop { position: fixed; inset: 0; pointer-events: none; z-index: 0; overflow: hidden; }
.shell .bg-layer {
  position: absolute; inset: 0;
  background:
    radial-gradient(1200px 600px at -10% -20%, color-mix(in lab, rgb(var(--accent-rgb)) 10%, transparent), transparent 60%),
    radial-gradient(1000px 500px at 110% -10%, color-mix(in lab, rgb(var(--accent-rgb)) 8%, transparent), transparent 55%),
    radial-gradient(900px 450px at 50% 120%, color-mix(in lab, rgb(var(--accent-rgb)) 6%, transparent), transparent 60%),
    var(--bg);
}
.shell .backdrop[data-scheme="light"] .bg-layer {
  background:
    radial-gradient(900px 450px at -10% -20%, color-mix(in lab, rgb(var(--accent-rgb)) 6%, transparent), transparent 60%),
    radial-gradient(800px 400px at 110% -10%, color-mix(in lab, rgb(var(--accent-rgb)) 4%, transparent), transparent 55%),
    radial-gradient(700px 350px at 50% 120%, color-mix(in lab, rgb(var(--accent-rgb)) 3%, transparent), transparent 60%),
    var(--bg);
}
.shell .orb { position: absolute; width: 60vmax; height: 60vmax; }
.shell .backdrop[data-scheme="dark"] .orb { opacity: .16; filter: blur(60px); }
.shell .backdrop[data-scheme="light"] .orb { opacity: .08; filter: blur(70px); }
.shell .orb-1 { left: -10vmax; top: -10vmax; background: radial-gradient(circle at 30% 30%, rgba(99,102,241,1), transparent 60%); animation: move1 18s linear infinite alternate; }
.shell .orb-2 { right: -15vmax; top: -5vmax; background: radial-gradient(circle at 70% 20%, rgba(14,165,233,1), transparent 60%); animation: move2 22s linear infinite alternate; }
.shell .orb-3 { left: 10vmax; bottom: -10vmax; background: radial-gradient(circle at 50% 50%, rgba(236,72,153,1), transparent 60%); animation: move3 26s linear infinite alternate; }
@keyframes move1 { to { transform: translate(10vmax, 6vmax) scale(1.08); } }
@keyframes move2 { to { transform: translate(-6vmax, 8vmax) scale(1.06); } }
@keyframes move3 { to { transform: translate(-8vmax, -6vmax) scale(1.06); } }
.shell .grain { position:absolute; inset:-50%; background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='4' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3CfeComponentTransfer%3E%3CfeFuncA type='table' tableValues='0 0 0 0 0 0 0 0.05 0.10'%3E%3C/feFuncA%3E%3C/feComponentTransfer%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E"); opacity: .10; mix-blend-mode: overlay; }

.shell .wrap {
  position: relative;
  padding-inline: clamp(10px, 4vw, 18px);
  padding-top: 0;
  padding-bottom: calc(max(clamp(82px, 12vh, 112px), var(--pt-layout-inset-bottom)) + 6px);
  width: 100%;
  margin: 0 auto;
}

/* Header */
.shell .shell-header {
  display: grid; grid-template-columns: 1fr auto; align-items: center; gap: clamp(10px, 2.2vw, 14px);
  margin: clamp(10px, 2vh, 14px) 0 clamp(8px, 1.6vh, 12px);
  padding: clamp(8px, 1.6vh, 12px) clamp(10px, 2.2vw, 14px);
  background: color-mix(in srgb, var(--surface) 100%, transparent);
  border: 1px solid color-mix(in srgb, var(--text) 10%, transparent);
  border-radius: 16px;
  box-shadow: 0 1px 0 color-mix(in srgb, var(--text) 6%, transparent) inset, 0 10px 30px rgba(0,0,0,.10);
  backdrop-filter: blur(10px);
}
.shell .profile { display:flex; align-items:center; gap: clamp(8px, 2vw, 12px); min-width:0; }
.shell .avatar { width: clamp(38px, 6vw, 44px); height: clamp(38px, 6vw, 44px); border-radius: 12px; overflow:hidden; display:grid; place-items:center; color:#000; font-weight:800; font-size: clamp(16px, 2.4vw, 18px);
  background: conic-gradient(from 220deg at 50% 50%, #60a5fa, #a78bfa, #22d3ee, #60a5fa);
  border: 1px solid color-mix(in srgb, var(--text) 12%, transparent);
  box-shadow: 0 6px 20px rgba(0,0,0,.12);
}
.shell .avatar img { width:100%; height:100%; object-fit:cover; display:block; }
.shell .who { min-width:0; }
.shell .name { font-size: clamp(16px, 2.6vw, 20px); font-weight: 900; letter-spacing:.2px; line-height:1.1; color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.shell .meta { display:flex; align-items:center; gap:8px; margin-top:3px; }
.shell .chip { font-size: 12px; padding: 4px 8px; border-radius: 999px; letter-spacing:.2px; color: var(--text);
  background: color-mix(in srgb, var(--surface) 70%, transparent);
  border: 1px solid color-mix(in srgb, var(--text) 10%, transparent);
}
.shell .sep { opacity:.6; }
.shell .status { font-size: 12px; color: var(--hint); text-align:right; }

/* Grid карточек */
.shell .grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 260px), 1fr));
  gap: clamp(12px, 3vw, 16px);
  margin-top: clamp(6px, 1vh, 12px);
  max-width: 1024px;
  margin-inline: auto;
  justify-items: center;
  align-items: stretch;
}

/* Category card */
.shell .card {
  --mx: 0; --my: 0;
  width: 100%;
  max-width: 360px;
  position: relative; text-align: left;
  padding: clamp(14px, 3.2vw, 18px);
  border-radius: 18px;
  background:
    linear-gradient(180deg, color-mix(in srgb, var(--surface) 90%, transparent), color-mix(in srgb, var(--surface) 40%, transparent)),
    var(--card-gradient, linear-gradient(135deg, rgba(99,102,241,.95), rgba(236,72,153,.95)));
  color: #fff;
  border: 1px solid color-mix(in srgb, var(--text) 10%, transparent);
  box-shadow: 0 10px 24px rgba(0,0,0,.10), 0 22px 60px rgba(var(--accent-rgb), .16);
  backdrop-filter: blur(10px);
  transition: transform .25s ease, box-shadow .25s ease, filter .25s ease;
  transform: perspective(1000px) rotateX(calc(var(--my) * 8deg)) rotateY(calc(var(--mx) * -8deg)) translateZ(0);
  will-change: transform;
  overflow: hidden;
}
.shell .card:hover { box-shadow: 0 14px 40px rgba(0,0,0,.12), 0 30px 90px rgba(var(--accent-rgb), .20); }
.shell .card:active { transform: scale(.99) translateZ(0); }
.shell .cardEmoji { font-size: clamp(24px, 4.6vw, 30px); line-height: 1; filter: drop-shadow(0 6px 12px rgba(0,0,0,.15)); }
.shell .cardTitle { margin-top: 8px; font-weight: 900; font-size: clamp(18px, 3vw, 20px); letter-spacing: .2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.shell .cardSub { margin-top: 4px; font-size: clamp(12px, 2.4vw, 13.5px); color: color-mix(in srgb, #ffffff 92%, transparent); }
.shell .cardPill { position: absolute; top: 10px; right: 10px; z-index: 2; font-size: 12px; padding: 4px 8px; border-radius: 999px;
  background: rgba(0,0,0,.30); border: 1px solid rgba(255,255,255,.25); color: #fff; backdrop-filter: blur(6px); box-shadow: 0 6px 20px rgba(0,0,0,.12); display: inline-flex; align-items: center; gap: 4px; }

/* Section list */
.shell .shell-section { margin-top: 8px; }
.shell .sectionHeader { display:flex; align-items:center; gap:10px; margin: clamp(10px, 1.8vh, 12px) 0; }
.shell .sectionTitle { font-size: 18px; font-weight: 900; margin: 0; letter-spacing:.2px; color: var(--text); }
.shell .btn.back { background: transparent; padding: 8px 12px; border-radius: 10px; border: 1px solid color-mix(in srgb, var(--text) 12%, transparent); color: var(--text); }
.shell .btn.back .ico { display:inline-block; line-height:1; vertical-align:middle; margin-right:6px; }
.shell .list { display: grid; gap: 10px; }
.shell .listItem {
  display:grid; grid-template-columns: 40px 1fr 18px; align-items:center; column-gap:12px;
  padding: 12px; border-radius: 16px; text-align:left; min-width: 0;
  background: color-mix(in srgb, var(--surface) 100%, transparent);
  border: 1px solid color-mix(in srgb, var(--text) 10%, transparent);
  color: var(--text);
  transition: transform .16s ease, background .16s ease, border-color .16s ease, box-shadow .16s ease; position: relative; overflow: hidden;
}
.shell .listItem::before{ content:""; position:absolute; left:0; top:0; bottom:0; width:3px; background: linear-gradient(180deg, rgba(var(--accent-rgb), .95), rgba(var(--accent-rgb), .25)); border-radius: 16px 0 0 16px; opacity:.9; }
.shell .listItem:hover{ background: color-mix(in srgb, var(--surface) 85%, transparent); border-color: color-mix(in srgb, var(--text) 14%, transparent); box-shadow: 0 10px 30px rgba(0,0,0,.10); }
.shell .listIcon { width: 40px; height: 40px; border-radius: 12px; display: grid; place-items: center; background: color-mix(in srgb, var(--surface) 80%, transparent); border: 1px solid color-mix(in srgb, var(--text) 12%, transparent); font-size: 22px; }
.shell .listText { display:grid; gap: 2px; line-height: 1.15; min-width: 0; }
.shell .listTitle { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-weight: 800; color: var(--text); }
.shell .listDesc { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; color: var(--hint); }
.shell .chev { opacity: .6; font-size: 22px; text-align: right; }

/* Bottom dock */
.shell .bottom {
  position: fixed; left: 0; right: 0;
  bottom: max(10px, var(--pt-layout-inset-bottom));
  padding-inline: clamp(8px, 3.6vw, 10px);
  display:grid; grid-template-columns: clamp(50px, 15vw, 60px) 1fr clamp(50px, 15vw, 60px);
  gap: clamp(8px, 2.6vw, 10px);
  z-index: 50; pointer-events: none;
}
.shell .dockBtn, .shell .dockCTA {
  pointer-events: auto;
  height: clamp(50px, 7.5vh, 56px);
  border-radius: 16px; font-weight: 800;
  transition: transform .16s ease, box-shadow .16s ease, background .16s ease, color .16s ease, border-color .16s ease;
  border: 1px solid color-mix(in srgb, var(--text) 12%, transparent);
  box-shadow: 0 8px 24px rgba(0,0,0,.10);
}
.shell .dockBtn { background: color-mix(in srgb, var(--surface) 85%, transparent); display: grid; place-items: center; color: var(--text); }
.shell .dockBtn .ico { display:inline-grid; place-items:center; line-height:1; font-size: clamp(20px, 4.6vw, 22px); }
.shell .dockCTA { display: grid; place-items: center; text-align: center; letter-spacing: .2px; font-size: clamp(14px, 3.8vw, 16px); }
.shell .dockCTA:hover { transform: translateY(-1px); box-shadow: 0 12px 36px rgba(0,0,0,.12), 0 16px 50px rgba(var(--accent-rgb), .14); }

@media (max-width: 360px) {
  .shell .chip { font-size: 11px; padding: 3px 7px; }
  .shell .card { border-radius: 16px; }
}

/* ===== GAME CANVAS (изолированный слой) ===== */
.gameCanvas {
  position: fixed;
  inset: var(--pt-layout-inset-top) var(--pt-layout-inset-right) var(--pt-layout-inset-bottom) var(--pt-layout-inset-left);
  z-index: 1000;
  background: var(--bg, #000);
  display: block;
  transform: translateZ(0);
  overscroll-behavior: none;
  touch-action: manipulation;
}
.gameStage {
  position: relative; inset: 0;
  width: 100%; height: 100%;
  overflow: auto; -webkit-overflow-scrolling: touch;
  overscroll-behavior: none;
  touch-action: manipulation;
}
      `,
      }}
    />
  );
}

function GameCanvasStyles() {
  // отдельный тег оставлен на случай будущих до-настроек; пока пусто.
  return <style>{``}</style>;
}
