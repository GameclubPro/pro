import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import io from "socket.io-client";
import "./Auction.css";

const INITIAL_BANK = 1_000_000;
const CODE_ALPHABET_RE = /[^A-HJKMNPQRSTUVWXYZ23456789]/g;
const BID_PRESETS = [1_000, 5_000, 10_000, 25_000, 50_000];
const AUCTION_GAME = "AUCTION";

const PHASE_LABEL = {
  lobby: "Лобби",
  in_progress: "Торги",
  finished: "Итоги",
};

function normalizeCode(value = "") {
  return value.toUpperCase().replace(CODE_ALPHABET_RE, "").slice(0, 6);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

const EMPTY_ARRAY = Object.freeze([]);
const EMPTY_OBJECT = Object.freeze({});

function ensureArray(value) {
  return Array.isArray(value) ? value : EMPTY_ARRAY;
}

function ensurePlainObject(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value;
  }
  return EMPTY_OBJECT;
}

const SERVER_ERROR_MESSAGES = {
  initData_required: "Открой игру из Telegram — нет initData.",
  bad_signature: "Подпись Telegram не сошлась. Запусти игру заново из бота.",
  stale_init_data: "Сессия Telegram устарела. Открой игру заново из Telegram.",
  code_already_in_use: "Код комнаты уже используется",
  room_not_found: "Комната не найдена",
  room_full: "Комната заполнена",
  game_in_progress: "Игра уже идёт",
  wrong_game: "Эта ссылка для другой игры",
};
function mapServerError(code, status, fallback) {
  if (status === 429) return "Слишком много попыток. Попробуйте чуть позже.";
  if (status === 401 && (!code || code === "failed")) {
    return SERVER_ERROR_MESSAGES.stale_init_data;
  }
  if (!code) return fallback;
  return SERVER_ERROR_MESSAGES[code] || fallback;
}

function playerDisplayName(player) {
  if (!player) return "Игрок";
  return (
    player.user?.first_name ||
    player.user?.username ||
    (player.id != null ? `Игрок ${player.id}` : "Игрок")
  );
}

export default function Auction({
  apiBase,
  initData,
  goBack,
  onProgress,
  setBackHandler,
  autoJoinCode,
  onInviteConsumed,
}) {
  const [socket, setSocket] = useState(null);
  const socketRef = useRef(null);
  const [connecting, setConnecting] = useState(false);

  const [room, setRoom] = useState(null);
  const [players, setPlayers] = useState([]);
  const [selfInfo, setSelfInfo] = useState(null);
  const [viewerIsOwner, setViewerIsOwner] = useState(false);
  const [auctionState, setAuctionState] = useState(null);

  const [creating, setCreating] = useState(false);
  const [joining, setJoining] = useState(false);
  const [codeInput, setCodeInput] = useState("");
  const [error, setError] = useState("");
  const [toastStack, setToastStack] = useState([]);

  const [busyBid, setBusyBid] = useState(false);
  const [myBid, setMyBid] = useState("");

  const deadlineAtRef = useRef(null);
  const [nowTick, setNowTick] = useState(0);
  const toastTimersRef = useRef(new Map());
  const lastSubscribedCodeRef = useRef(null);
  const lastSubscriptionSocketIdRef = useRef(null);
  const progressSentRef = useRef(false);
  const lastBidAtRef = useRef(0);

  const moneyFormatter = useMemo(() => new Intl.NumberFormat("ru-RU"), []);
  const sanitizedAutoCode = useMemo(
    () => normalizeCode(autoJoinCode || ""),
    [autoJoinCode]
  );

  const phase = auctionState?.phase || "lobby";
  const myPlayerId = selfInfo?.roomPlayerId ?? null;

  const balances = useMemo(
    () => ensurePlainObject(auctionState?.balances),
    [auctionState?.balances]
  );
  const basketTotals = useMemo(
    () => ensurePlainObject(auctionState?.basketTotals),
    [auctionState?.basketTotals]
  );
  const myBalance =
    myPlayerId != null ? balances[myPlayerId] ?? null : null;

  const currentBids = useMemo(
    () => ensurePlainObject(auctionState?.currentBids),
    [auctionState?.currentBids]
  );
  const myRoundBid = useMemo(() => {
    if (myPlayerId == null) return null;
    const value = currentBids[myPlayerId];
    return typeof value === "number" ? value : null;
  }, [currentBids, myPlayerId]);

  const currentSlot = auctionState?.currentSlot || null;
  const baseBid = currentSlot?.basePrice || 0;
  const slotIndex =
    currentSlot && typeof currentSlot.index === "number"
      ? currentSlot.index + 1
      : null;

  const slotMax = useMemo(() => {
    const raw =
      auctionState?.maxSlots ??
      auctionState?.rules?.maxSlots ??
      auctionState?.totalSlots ??
      (Array.isArray(auctionState?.slots)
        ? auctionState.slots.length
        : null);
    const num = Number(raw);
    return Number.isFinite(num) ? num : null;
  }, [
    auctionState?.maxSlots,
    auctionState?.rules?.maxSlots,
    auctionState?.totalSlots,
    auctionState?.slots,
  ]);

  const initialBank =
    auctionState?.rules?.initialBalance || INITIAL_BANK;

  const safePlayers = useMemo(
    () => ensureArray(players).filter(Boolean),
    [players]
  );

  const netWorths = useMemo(() => {
    const fromState = ensurePlainObject(auctionState?.netWorths);
    const ids = new Set([
      ...safePlayers.map((p) => p.id).filter((id) => id != null),
      ...Object.keys(balances).map((k) => Number(k)),
      ...Object.keys(basketTotals).map((k) => Number(k)),
    ]);
    const map = {};
    ids.forEach((pid) => {
      if (!Number.isFinite(pid)) return;
      const from = fromState[pid];
      const worth =
        typeof from === "number"
          ? from
          : (balances[pid] || 0) + (basketTotals[pid] || 0);
      map[pid] = worth;
    });
    return map;
  }, [auctionState?.netWorths, safePlayers, balances, basketTotals]);

  const myBasketTotal =
    myPlayerId != null ? basketTotals[myPlayerId] ?? 0 : null;

  const myNetWorth = useMemo(() => {
    if (myPlayerId == null) return null;
    const from = netWorths[myPlayerId];
    if (typeof from === "number") return from;
    const balance = myBalance ?? 0;
    const basket = basketTotals[myPlayerId] ?? 0;
    return balance + basket;
  }, [myBalance, myPlayerId, netWorths, basketTotals]);

  const currentPlayer = useMemo(
    () => safePlayers.find((p) => p.id === myPlayerId) || null,
    [safePlayers, myPlayerId]
  );

  const ownerPlayer = useMemo(
    () => safePlayers.find((p) => p.user?.id === room?.ownerId) || null,
    [safePlayers, room?.ownerId]
  );

  const isOwner = useMemo(() => {
    if (viewerIsOwner) return true;
    if (!room || !selfInfo) return false;
    return room.ownerId === selfInfo.userId;
  }, [viewerIsOwner, room, selfInfo]);

  const totalPlayers = safePlayers.length || 0;

  const readyCount = useMemo(() => {
    if (!room) return 0;
    return safePlayers.filter((p) => {
      const isHost = room.ownerId != null && p.user?.id === room.ownerId;
      return isHost || p.ready;
    }).length;
  }, [safePlayers, room]);

  const readyPercent = totalPlayers
    ? Math.round((readyCount / Math.max(totalPlayers, 1)) * 100)
    : 0;

  const safeHistory = useMemo(
    () =>
      ensureArray(auctionState?.history).filter(
        (slot) => slot && typeof slot.index === "number"
      ),
    [auctionState?.history]
  );
  const lastFinishedSlot = useMemo(
    () => (safeHistory.length ? safeHistory[safeHistory.length - 1] : null),
    [safeHistory]
  );

  const winners = useMemo(
    () => ensureArray(auctionState?.winners),
    [auctionState?.winners]
  );

  const totalBank = useMemo(() => {
    return Object.values(netWorths).reduce(
      (sum, value) => sum + (Number(value) || 0),
      0
    );
  }, [netWorths]);

  const secsLeft = useMemo(() => {
    if (!deadlineAtRef.current) return null;
    const diff = Math.ceil(
      (deadlineAtRef.current - Date.now()) / 1000
    );
    return Math.max(0, diff);
  }, [nowTick]);

  const timePerSlot =
    auctionState?.rules?.timePerSlotSec || 0;

  const progressPct = useMemo(() => {
    if (secsLeft == null || !timePerSlot) return null;
    const spent = Math.max(0, timePerSlot - secsLeft);
    return Math.min(100, Math.round((spent / timePerSlot) * 100));
  }, [secsLeft, timePerSlot]);

  const showLanding = !room;
  const showLobby = !showLanding && phase === "lobby";
  const showGame = !showLanding && phase === "in_progress";
  const showResults = !showLanding && phase === "finished";

  // ---------- TOASTS ----------

  const dismissToast = useCallback((id) => {
    if (!id) return;
    setToastStack((prev) => prev.filter((t) => t.id !== id));
    const timer = toastTimersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      toastTimersRef.current.delete(id);
    }
  }, []);

  const pushToast = useCallback(
    (payload = {}) => {
      if (!payload.text) return null;
      const id =
        payload.id ||
        `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      const duration = payload.duration ?? 2800;
      const entry = { ...payload, id };

      setToastStack((prev) =>
        [...prev.filter((t) => t.id !== id), entry].slice(-3)
      );

      if (duration > 0) {
        const timer = setTimeout(() => dismissToast(id), duration);
        toastTimersRef.current.set(id, timer);
      }
      return id;
    },
    [dismissToast]
  );

  const pushError = useCallback(
    (message) => {
      const text = message || "Что-то пошло не так";
      setError(text);
      pushToast({ type: "error", text, duration: 3600 });
    },
    [pushToast]
  );

  const clearError = useCallback(() => setError(""), []);

  // ---------- SOCKET SUBSCRIBE ----------

  const subscribeToRoom = useCallback(
    (rawCode, options = {}) => {
      const sock = socketRef.current;
      const code = normalizeCode(rawCode);
      if (!code || !sock) return;
      const force = options.force ?? false;
      const socketId = sock.id ?? null;
      const alreadySame =
        lastSubscribedCodeRef.current === code &&
        lastSubscriptionSocketIdRef.current === socketId &&
        socketId != null;

      if (!force && alreadySame) return;

      lastSubscribedCodeRef.current = code;
      sock.emit("room:subscribe", { code, game: AUCTION_GAME });
      sock.emit("auction:sync", { code, game: AUCTION_GAME });
      if (socketId) {
        lastSubscriptionSocketIdRef.current = socketId;
      }
    },
    []
  );

  // ---------- EXIT / BACK ----------

  const leaveRoom = useCallback(async () => {
    const code = room?.code;
    if (!code) return;
    try {
      await fetch(`${apiBase}/api/rooms/${code}/leave`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Telegram-Init-Data": initData || "",
        },
        body: JSON.stringify({ game: AUCTION_GAME }),
      }).catch(() => {});
    } catch {
      // ignore
    }

    try {
      socket?.emit("room:leave", { code, game: AUCTION_GAME });
    } catch {
      // ignore
    }

    setRoom(null);
    setPlayers([]);
    setSelfInfo(null);
    setViewerIsOwner(false);
    setAuctionState(null);
    lastSubscribedCodeRef.current = null;
    lastSubscriptionSocketIdRef.current = null;
    progressSentRef.current = false;
  }, [apiBase, initData, room?.code, socket]);

  const handleExit = useCallback(async () => {
    if (phase === "in_progress") {
      const ok =
        typeof window === "undefined"
          ? true
          : window.confirm("Торги идут. Выйти из комнаты?");
      if (!ok) return;
    }
    try {
      await leaveRoom();
    } finally {
      goBack?.();
    }
  }, [phase, leaveRoom, goBack]);

  // ---------- EFFECTS ----------

  // Таймер раунда
  useEffect(() => {
    const ms = auctionState?.timeLeftMs;
    if (ms == null) {
      deadlineAtRef.current = null;
      return;
    }
    deadlineAtRef.current = Date.now() + Math.max(0, ms);
  }, [auctionState?.timeLeftMs, phase]);

  useEffect(() => {
    if (!deadlineAtRef.current) return;
    const timer = setInterval(() => {
      setNowTick((tick) => (tick + 1) % 1_000_000);
    }, 250);
    return () => clearInterval(timer);
  }, [auctionState?.phase, auctionState?.timeLeftMs]);

  // Создание socket.io
  useEffect(() => {
    if (!apiBase) return;
    const instance = io(apiBase, {
      transports: ["websocket"],
      auth: { initData: initData || "" },
    });

    socketRef.current = instance;
    setSocket(instance);
    setConnecting(true);

    instance.on("connect", () => {
      setConnecting(false);
      const code = lastSubscribedCodeRef.current;
      if (code) {
        subscribeToRoom(code, { force: true });
      }
    });

    instance.on("disconnect", () => {
      setConnecting(true);
      lastSubscriptionSocketIdRef.current = null;
    });

    instance.on("connect_error", (err) => {
      setConnecting(false);
      pushError(
        `Не удалось подключиться: ${err?.message || "ошибка соединения"}`
      );
    });

    instance.on("toast", (payload) => {
      if (!payload?.text) return;
      if (payload.type === "error") {
        pushError(payload.text);
        return;
      }
      pushToast(payload);
    });

    instance.on("room:state", (payload) => {
      if (!payload) return;
      setRoom(payload.room || null);
      setPlayers(payload.players || []);
      if (typeof payload.viewerIsOwner === "boolean") {
        setViewerIsOwner(payload.viewerIsOwner);
      }
      clearError();
    });

    instance.on("private:self", (payload) => {
      if (!payload) return;
      setSelfInfo(payload);
    });

    instance.on("auction:state", (state) => {
      if (!state) return;
      setAuctionState(state);
      clearError();
    });

    return () => {
      socketRef.current = null;
      try {
        instance.off("toast");
        instance.off("room:state");
        instance.off("private:self");
        instance.off("auction:state");
        instance.off("connect");
        instance.off("disconnect");
        instance.off("connect_error");
        instance.disconnect();
      } catch {
        // ignore
      }
    };
  }, [apiBase, initData, pushError, pushToast, clearError]);

  // Подписка по коду комнаты
  useEffect(() => {
    if (!room?.code) return;
    subscribeToRoom(room.code);
  }, [room?.code, subscribeToRoom]);

  // Обработчик системной "назад"
  useEffect(() => {
    if (!setBackHandler) return;
    const handler = () => {
      handleExit();
    };
    setBackHandler(handler);
    return () => setBackHandler(null);
  }, [setBackHandler, handleExit]);

  // Автовход по ссылке (autoJoinCode)
  useEffect(() => {
    if (!socket) return;
    if (!sanitizedAutoCode) return;
    joinRoom(sanitizedAutoCode, { fromInvite: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socket, sanitizedAutoCode]);

  // Очистка таймеров тостов
  useEffect(
    () => () => {
      toastTimersRef.current.forEach((timeout) =>
        clearTimeout(timeout)
      );
      toastTimersRef.current.clear();
    },
    []
  );

  // Событие завершения
  useEffect(() => {
    if (phase !== "finished") {
      progressSentRef.current = false;
      return;
    }
    if (progressSentRef.current) return;
    progressSentRef.current = true;
    try {
      onProgress?.();
    } catch {
      // ignore
    }
  }, [phase, onProgress]);

  // Предзаполнение инпута кодом из авто-приглашения
  useEffect(() => {
    if (!sanitizedAutoCode || room || codeInput) return;
    setCodeInput(sanitizedAutoCode);
  }, [sanitizedAutoCode, room, codeInput]);

  // ---------- API / ACTIONS ----------

  async function createRoom() {
    if (!initData) {
      pushError("Нет initData из Telegram");
      return;
    }
    setCreating(true);
    clearError();
    try {
      const resp = await fetch(`${apiBase}/api/rooms`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Telegram-Init-Data": initData,
        },
        body: JSON.stringify({ game: AUCTION_GAME }),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        const code = data?.error || data?.message || "failed";
        pushError(mapServerError(code, resp.status, "Не удалось создать комнату"));
        return;
      }
      setRoom(data.room || null);
      setPlayers(data.players || []);
      setViewerIsOwner(true);
      if (data.room?.code) {
        setCodeInput(data.room.code);
        subscribeToRoom(data.room.code, { force: true });
      }
    } catch {
      pushError("Не удалось создать комнату, попробуйте ещё раз");
    } finally {
      setCreating(false);
    }
  }

  async function joinRoom(rawCode, options = {}) {
    if (!initData) {
      pushError("Нет initData из Telegram");
      return;
    }
    const code = normalizeCode(rawCode || codeInput);
    if (!code) {
      pushError("Введите код комнаты");
      return;
    }
    setJoining(true);
    clearError();
    try {
      const resp = await fetch(
        `${apiBase}/api/rooms/${code}/join`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Telegram-Init-Data": initData,
          },
          body: JSON.stringify({ game: AUCTION_GAME }),
        }
      );
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        const codeErr = data?.error || data?.message || "failed";
        pushError(mapServerError(codeErr, resp.status, "Не удалось войти в комнату"));
        return;
      }
      setRoom(data.room || null);
      setPlayers(data.players || []);
      setViewerIsOwner(!!data.viewerIsOwner);
      setCodeInput(code);
      subscribeToRoom(code, { force: true });

      if (options.fromInvite && onInviteConsumed) {
        try {
          onInviteConsumed(code);
        } catch {
          // ignore
        }
      }
    } catch {
      pushError("Не удалось войти в комнату");
    } finally {
      setJoining(false);
    }
  }

  function toggleReady() {
    if (!socket || !room || !selfInfo) return;
    if (isOwner) return;
    const ready = !!currentPlayer?.ready;
    socket.emit(
      "ready:set",
      { code: room.code, ready: !ready, game: AUCTION_GAME },
      (resp) => {
        if (!resp || !resp.ok) {
          pushError("Не удалось изменить статус");
        }
      }
    );
  }

  function handleStartAuction() {
    if (!socket || !room || !isOwner) return;
    socket.emit(
      "auction:start",
      { code: room.code, game: AUCTION_GAME },
      (resp) => {
        if (!resp || !resp.ok) {
          const map = {
            room_not_found: "Комната не найдена",
            forbidden_not_owner: "Только владелец может начать игру",
            need_at_least_2_players: "Нужно минимум 2 игрока",
            need_ready_players: "Нужно, чтобы все отметились «готов»",
            already_started: "Аукцион уже запущен",
            wrong_game: "Это комната другого режима",
          };
          pushError(
            map[resp?.error] || "Не удалось запустить аукцион"
          );
        }
      }
    );
  }

  const pauseAuction = useCallback(() => {
    if (!socket || !room || !isOwner) return;
    socket.emit(
      "auction:pause",
      { code: room.code, game: AUCTION_GAME },
      () => {}
    );
  }, [socket, room, isOwner]);

  const resumeAuction = useCallback(() => {
    if (!socket || !room || !isOwner) return;
    socket.emit(
      "auction:resume",
      { code: room.code, game: AUCTION_GAME },
      () => {}
    );
  }, [socket, room, isOwner]);

  const forceNext = useCallback(() => {
    if (!socket || !room || !isOwner) return;
    socket.emit(
      "auction:next",
      { code: room.code, game: AUCTION_GAME },
      () => {}
    );
  }, [socket, room, isOwner]);

  function setBidRelative(delta = 0) {
    setMyBid((prev) => {
      const numericPrev =
        Number(String(prev).replace(/\s/g, "")) || 0;
      const baseline =
        numericPrev > 0 ? numericPrev : baseBid > 0 ? baseBid : 0;
      const max = myBalance ?? initialBank;
      const next = delta === 0 ? baseline : baseline + delta;
      return String(clamp(next, 0, max));
    });
  }

  function sendPass() {
    setMyBid("");
    sendBid(0);
  }

  function sendBid(forcedAmount) {
    if (!socket || !room || !selfInfo) return;
    if (!auctionState || auctionState.phase !== "in_progress") return;

    const now = Date.now();
    if (now - lastBidAtRef.current < 800) {
      pushToast({ type: "error", text: "Ставки слишком часто" });
      return;
    }
    lastBidAtRef.current = now;

    const raw =
      forcedAmount != null
        ? String(forcedAmount)
        : String(myBid || "").replace(/\s/g, "");
    const amount = raw === "" ? 0 : Number(raw);

    if (!Number.isFinite(amount) || amount < 0) {
      pushError("Введите корректную сумму");
      return;
    }
    if (myBalance != null && amount > myBalance) {
      pushError("Ставка превышает ваш баланс");
      return;
    }
    if (amount > 0 && baseBid > 0 && amount < baseBid) {
      pushError(
        `Минимальная ставка ${moneyFormatter.format(baseBid)}$`
      );
      return;
    }

    setBusyBid(true);
    socket.emit(
      "auction:bid",
      { code: room.code, amount, game: AUCTION_GAME },
      (resp) => {
        setBusyBid(false);
        if (!resp || !resp.ok) {
          const map = {
            room_not_found: "Комната не найдена",
            not_running: "Аукцион ещё не запущен",
            not_player: "Вы не в комнате",
            not_participant: "Вы не участвуете",
            bad_amount: "Неверная сумма",
            not_enough_money: "Недостаточно денег",
            paused: "Пауза",
            bid_below_base: "Ставка ниже базовой",
            wrong_game: "Это комната другого режима",
          };
          pushError(
            map[resp?.error] || "Не удалось принять ставку"
          );
        } else {
          clearError();
        }
      }
    );
  }

  async function copyRoomCode() {
    if (!room?.code) return;
    try {
      if (
        typeof navigator !== "undefined" &&
        navigator.clipboard?.writeText
      ) {
        await navigator.clipboard.writeText(room.code);
        pushToast({ type: "info", text: "Код скопирован" });
      } else {
        pushToast({ type: "info", text: `Код: ${room.code}` });
      }
    } catch {
      pushToast({ type: "error", text: "Не удалось скопировать" });
    }
  }

  async function shareRoomCode() {
    if (!room?.code) return;
    const base =
      typeof window !== "undefined"
        ? window.location?.origin || ""
        : "";
    const shareUrl = base
      ? `${base.replace(/\/+$/, "")}/?join=${encodeURIComponent(
          room.code
        )}&game=auction`
      : "";

    try {
      if (
        typeof navigator !== "undefined" &&
        navigator.share
      ) {
        await navigator.share({
          text: `Код комнаты: ${room.code}`,
          url: shareUrl || undefined,
        });
      } else if (
        typeof navigator !== "undefined" &&
        navigator.clipboard?.writeText
      ) {
        await navigator.clipboard.writeText(
          shareUrl || room.code
        );
      }
      pushToast({ type: "info", text: "Ссылка скопирована" });
    } catch {
      pushToast({ type: "error", text: "Не удалось поделиться" });
    }
  }

  // ---------- RENDER ----------

  const renderLanding = () => (
    <div className="screen screen--landing">
      <motion.div
        className="landing-card"
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25 }}
      >
        <div className="landing-card__head">
          <div className="landing-logo">AUCTION</div>
          <p className="landing-tagline">
            Простой аукцион для вашей компании прямо в Telegram.
          </p>
          <div className="landing-chips">
            <span className="pill pill--soft">
              <span>👥</span> до 16 игроков
            </span>
            <span className="pill pill--soft">
              <span>⚡</span> быстрые раунды
            </span>
          </div>
        </div>

        <div className="landing-form">
          <label className="field">
            <span className="field-label">Код комнаты</span>
            <input
              className="text-input text-input--large"
              type="text"
              inputMode="text"
              autoComplete="off"
              maxLength={6}
              placeholder="Например, 3F9K2B"
              value={codeInput}
              onChange={(e) =>
                setCodeInput(normalizeCode(e.target.value))
              }
            />
          </label>

          {error && (
            <div className="field-error">{error}</div>
          )}

          <button
            type="button"
            className="btn btn--primary"
            onClick={() => joinRoom()}
            disabled={joining || !codeInput}
          >
            {joining ? "Подключаем..." : "Войти по коду"}
          </button>

          <button
            type="button"
            className="btn btn--ghost"
            onClick={createRoom}
            disabled={creating}
          >
            {creating
              ? "Создаём комнату..."
              : "Создать новую комнату"}
          </button>

          {connecting && (
            <div className="landing-connect">
              Подключаемся к серверу...
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );

  const renderHeader = () => {
    if (!room) return null;
    const phaseLabel = PHASE_LABEL[phase] || "Аукцион";
    const roomTitle = (room.name || "").trim() || "Аукцион";
    const playersOnline = safePlayers.length || 0;
    const playersLabel =
      playersOnline === 1
        ? "игрок"
        : playersOnline >= 5 || playersOnline === 0
        ? "игроков"
        : "игрока";

    return (
      <header className="app-header">
        <button
          type="button"
          className="icon-btn icon-btn--ghost"
          aria-label="Выйти"
          onClick={handleExit}
        >
          ←
        </button>
        <div className="app-header__center">
          <div className="app-header__eyebrow">
            <span className="chip chip--phase">{phaseLabel}</span>
            <span className="app-header__meta">
              <span className="app-header__pulse" aria-hidden="true" />
              {playersOnline} {playersLabel}
            </span>
          </div>
          <h1 className="app-header__room" title={roomTitle}>
            {roomTitle}
          </h1>
          <div className="app-header__code-row">
            <button
              type="button"
              className="app-header__code"
              onClick={copyRoomCode}
            >
              <span className="app-header__code-label">Код</span>
              <span className="app-header__code-value">
                {room.code || "------"}
              </span>
            </button>
            <span className="app-header__hint">
              нажми, чтобы скопировать
            </span>
          </div>
        </div>
        <button
          type="button"
          className="icon-btn icon-btn--ghost"
          aria-label="Поделиться"
          onClick={shareRoomCode}
        >
          📤
        </button>
      </header>
    );
  };

  const renderLobbyContent = () => {
    if (!showLobby) return null;

    const readyTarget = Math.max(totalPlayers || 1, 1);
    const myReady = !!currentPlayer?.ready;
    const canStart =
      readyCount >= readyTarget && totalPlayers >= 2;

    const primaryLabel = isOwner
      ? "Начать игру"
      : myReady
      ? "Я не готов"
      : "Я готов";

    const primaryAction = () => {
      if (isOwner) {
        if (!canStart) return;
        handleStartAuction();
      } else {
        toggleReady();
      }
    };

    const sortedPlayers = safePlayers
      .slice()
      .sort(
        (a, b) =>
          Number(b.ready) - Number(a.ready)
      );

    return (
      <div className="screen-body lobby-layout">
        <section className="card card--lobby-top">
          <div className="card-row">
            <div>
              <span className="label">Комната</span>
              <h2 className="title">
                Лобби · {totalPlayers} игрок
                {totalPlayers === 1 ? "" : "ов"}
              </h2>
            </div>
            {ownerPlayer && (
              <div className="host-tag">
                <span className="host-tag__icon">👑</span>
                <div className="host-tag__text">
                  <span className="label tiny">
                    Хост
                  </span>
                  <span className="host-tag__name">
                    {playerDisplayName(ownerPlayer)}
                  </span>
                </div>
              </div>
            )}
          </div>

          <div className="lobby-stats">
            <div className="lobby-stat">
              <span className="lobby-stat__label">
                Готовность
              </span>
              <span className="lobby-stat__value">
                {readyCount}/{readyTarget}
              </span>
              <div className="progress">
                <div
                  className="progress__fill"
                  style={{
                    width: `${Math.max(6, readyPercent)}%`,
                  }}
                />
              </div>
            </div>
            <div className="lobby-stat">
              <span className="lobby-stat__label">
                Банк на игрока
              </span>
              <span className="lobby-stat__value">
                {moneyFormatter.format(initialBank)}$
              </span>
            </div>
            <div className="lobby-stat">
              <span className="lobby-stat__label">
                Лотов
              </span>
              <span className="lobby-stat__value">
                {slotMax != null ? slotMax : "—"}
              </span>
            </div>
          </div>

          <p className="lobby-hint">
            {isOwner
              ? readyCount < 2
                ? "Нужно минимум 2 игрока, чтобы начать."
                : canStart
                ? "Все готовы, можно запускать."
                : "Ждём, пока все отметят готовность."
              : myReady
              ? "Вы отметили, что готовы. Ждём остальных."
              : "Нажмите «Я готов», когда будете готовы к торгам."}
          </p>
        </section>

        <section className="card card--lobby-players">
          <div className="card-row card-row--tight">
            <div>
              <span className="label">Игроки</span>
              <h3 className="title-small">
                Состав лобби
              </h3>
            </div>
            <span className="pill pill--tiny">
              {readyCount}/{readyTarget} готовы
            </span>
          </div>
          <div className="lobby-players-list">
            {sortedPlayers.map((p) => {
              const name = playerDisplayName(p);
              const avatar =
                p.user?.photo_url || p.user?.avatar || null;
              const isHost =
                ownerPlayer?.id === p.id;
              return (
                <div
                  key={p.id}
                  className={[
                    "lobby-player",
                    p.ready ? "lobby-player--ready" : "",
                    isHost ? "lobby-player--host" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                >
                  <div className="lobby-player__avatar">
                    {avatar ? (
                      <img src={avatar} alt={name} />
                    ) : (
                      name.slice(0, 1)
                    )}
                  </div>
                  <div className="lobby-player__body">
                    <div className="lobby-player__name">
                      {name}
                      {isHost && (
                        <span className="chip chip--host">
                          Хост
                        </span>
                      )}
                    </div>
                    <div className="lobby-player__tags">
                      {p.ready ? "готов" : "ожидаем"}
                    </div>
                  </div>
                  <div className="lobby-player__status">
                    <span
                      className={
                        p.ready
                          ? "status-dot status-dot--ok"
                          : "status-dot"
                      }
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <div className="bottom-bar bottom-bar--lobby">
          <div className="bottom-bar__meta">
            <strong className="bottom-bar__value">
              {readyCount}/{readyTarget}
            </strong>
          </div>
          <button
            type="button"
            className="btn btn--primary btn--compact"
            onClick={primaryAction}
            disabled={isOwner && !canStart}
          >
            {primaryLabel}
          </button>
        </div>
      </div>
    );
  };

  const renderGameContent = () => {
    if (!showGame) return null;

    const paused = !!auctionState?.paused;
    const growth =
      auctionState?.currentStep || auctionState?.growth || 0;

    return (
      <div className="screen-body game-layout">
        <section className="card card--lot">
          <div className="card-row">
            <div>
              <span className="label">Текущий лот</span>
              <h2 className="title">
                {currentSlot?.name || "Без названия"}
              </h2>
            </div>
            <div className="lot-index">
              <span className="lot-index__num">
                {slotIndex != null
                  ? `#${slotIndex}`
                  : "—"}
              </span>
              <span className="lot-index__suffix">
                {slotMax ? `из ${slotMax}` : ""}
              </span>
            </div>
          </div>

          <div className="lot-meta-row">
            <div className="lot-meta">
              <span className="lot-meta__label">
                Тип
              </span>
              <span className="lot-meta__value">
                {currentSlot?.type === "lootbox"
                  ? "кейс 🎁"
                  : "лот 🎯"}
              </span>
            </div>
            <div className="lot-meta">
              <span className="lot-meta__label">
                Базовая ставка
              </span>
              <span className="lot-meta__value">
                {moneyFormatter.format(baseBid || 0)}$
              </span>
            </div>
            <div className="lot-meta">
              <span className="lot-meta__label">
                Шаг
              </span>
              <span className="lot-meta__value">
                {growth > 0
                  ? `+${moneyFormatter.format(
                      growth
                    )}$`
                  : "—"}
              </span>
            </div>
          </div>

          <div className="lot-balance-row">
            <div className="lot-balance-card">
              <span className="lot-balance-card__label">
                Ваша ставка
              </span>
              <span className="lot-balance-card__value">
                {myRoundBid != null
                  ? `${moneyFormatter.format(
                      myRoundBid
                    )}$`
                  : "—"}
              </span>
            </div>
            <div className="lot-balance-card">
              <span className="lot-balance-card__label">
                Ваш баланс
              </span>
              <span className="lot-balance-card__value">
                {myBalance != null
                  ? `${moneyFormatter.format(
                      myBalance
                    )}$`
                  : "—"}
              </span>
            </div>
            <div className="lot-balance-card">
              <span className="lot-balance-card__label">
                Состояние (баланс + покупки)
              </span>
              <span className="lot-balance-card__value">
                {myNetWorth != null
                  ? `${moneyFormatter.format(myNetWorth)}$`
                  : "—"}
              </span>
              <span className="muted">
                Баланс {moneyFormatter.format(myBalance ?? 0)}$ · Покупки{" "}
                {moneyFormatter.format(myBasketTotal ?? 0)}$
              </span>
            </div>
          </div>

          <div className="timer">
            <div className="timer__value">
              {secsLeft != null ? secsLeft : "—"}
            </div>
            <div className="timer__body">
              <span className="timer__label">
                Время на ход
              </span>
              <span className="timer__text">
                {paused
                  ? "Пауза"
                  : timePerSlot
                  ? `${timePerSlot} сек. на лот`
                  : "Ожидание"}
              </span>
              {progressPct != null && (
                <div className="progress">
                  <div
                    className="progress__fill"
                    style={{
                      width: `${progressPct}%`,
                    }}
                  />
                </div>
              )}
            </div>
          </div>

          {lastFinishedSlot && (
            <div className="lot-last">
              <span className="label tiny">
                Прошлый лот
              </span>
              <div className="lot-last__content">
                <span className="lot-last__name">
                  #{(lastFinishedSlot.index ?? 0) + 1} ·{" "}
                  {lastFinishedSlot.name}
                </span>
                <span className="lot-last__meta">
                  {lastFinishedSlot.winnerPlayerId !=
                  null
                    ? `${playerDisplayName(
                        safePlayers.find(
                          (p) =>
                            p.id ===
                            lastFinishedSlot.winnerPlayerId
                        )
                      )} · `
                    : ""}
                  {moneyFormatter.format(
                    lastFinishedSlot.winBid || 0
                  )}
                  $
                </span>
              </div>
            </div>
          )}
        </section>

        <section className="card card--bid">
          <div className="card-row card-row--tight">
            <span className="label">
              Ставка
            </span>
            <span className="muted">
              Баланс:{" "}
              {myBalance != null
                ? `${moneyFormatter.format(
                    myBalance
                  )}$`
                : "—"}
            </span>
          </div>

          <div className="quick-bids">
            {BID_PRESETS.map((step) => (
              <button
                key={step}
                type="button"
                className="pill pill--ghost"
                onClick={() => setBidRelative(step)}
                disabled={
                  myBalance == null || myBalance <= 0
                }
              >
                +{moneyFormatter.format(step)}
              </button>
            ))}
            <button
              type="button"
              className="pill pill--ghost"
              onClick={() =>
                setBidRelative(myBalance || 0)
              }
              disabled={
                myBalance == null || myBalance <= 0
              }
            >
              All-in
            </button>
            <button
              type="button"
              className="pill pill--ghost"
              onClick={sendPass}
            >
              Пас
            </button>
          </div>

          <div className="bid-input-row">
            <input
              className="text-input"
              inputMode="numeric"
              placeholder="Сумма ставки"
              value={myBid}
              onChange={(e) =>
                setMyBid(
                  e.target.value.replace(/[^\d]/g, "")
                )
              }
            />
          </div>

          <div className="bid-actions">
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => setMyBid("")}
            >
              Сбросить
            </button>
            <button
              type="button"
              className="btn btn--primary"
              onClick={() => sendBid()}
              disabled={busyBid || myBalance == null}
            >
              {busyBid
                ? "Отправляем..."
                : "Сделать ставку"}
            </button>
          </div>

          {isOwner && (
            <div className="owner-controls">
              <button
                type="button"
                className="pill pill--ghost"
                onClick={
                  paused ? resumeAuction : pauseAuction
                }
              >
                {paused ? "Продолжить" : "Пауза"}
              </button>
              <button
                type="button"
                className="pill pill--ghost"
                onClick={forceNext}
              >
                Следующий лот
              </button>
            </div>
          )}
        </section>
      </div>
    );
  };

  const renderResultsContent = () => {
    if (!showResults) return null;

    const sorted = safePlayers
      .slice()
      .sort(
        (a, b) =>
          (netWorths[b.id] ?? 0) -
          (netWorths[a.id] ?? 0)
      );

    return (
      <div className="screen-body results-layout">
        <section className="card">
          <div className="card-row">
            <div>
              <span className="label">Финиш</span>
              <h2 className="title">Итоги аукциона</h2>
            </div>
          </div>

          <div className="results-list">
            {sorted.map((p) => {
              const name = playerDisplayName(p);
              const avatar =
                p.user?.photo_url || p.user?.avatar || null;
              const balance = balances[p.id] ?? 0;
              const basketValue = basketTotals[p.id] ?? 0;
              const netWorth =
                netWorths[p.id] ?? balance + basketValue;
              const isWinner = winners.includes(p.id);
              return (
                <div
                  key={p.id}
                  className={[
                    "result-row",
                    isWinner ? "result-row--winner" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                >
                  <div className="result-row__left">
                    <div className="result-row__avatar">
                      {avatar ? (
                        <img src={avatar} alt={name} />
                      ) : (
                        name.slice(0, 1)
                      )}
                    </div>
                    <div className="result-row__info">
                      <span className="result-row__name">
                        {name}
                      </span>
                      <span className="result-row__money">
                        {moneyFormatter.format(netWorth)}
                        $
                      </span>
                      <span className="result-row__meta muted">
                        Баланс {moneyFormatter.format(balance)}$ · Покупки{" "}
                        {moneyFormatter.format(basketValue)}$
                      </span>
                    </div>
                  </div>
                  {isWinner && (
                    <span className="chip chip--winner">
                      Победитель
                    </span>
                  )}
                </div>
              );
            })}
          </div>

          <div className="results-actions">
            {isOwner && (
              <button
                type="button"
                className="btn btn--primary"
                onClick={handleStartAuction}
              >
                Ещё раунд
              </button>
            )}
            <button
              type="button"
              className="btn btn--ghost"
              onClick={handleExit}
            >
              В меню
            </button>
          </div>
        </section>
      </div>
    );
  };

  const renderToastStack = () => {
    if (!toastStack.length) return null;
    return (
      <div
        className="toast-stack"
        role="status"
        aria-live="polite"
      >
        <AnimatePresence initial={false}>
          {toastStack.map((item) => (
            <motion.div
              key={item.id}
              className={[
                "toast",
                item.type === "error"
                  ? "toast--error"
                  : "",
              ]
                .filter(Boolean)
                .join(" ")}
              initial={{ opacity: 0, y: -8, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -8, scale: 0.96 }}
              transition={{ duration: 0.18 }}
            >
              <span className="toast__text">
                {item.text}
              </span>
              <button
                type="button"
                className="toast__close"
                onClick={() => dismissToast(item.id)}
                aria-label="Закрыть уведомление"
              >
                ×
              </button>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    );
  };

  const appClassName = [
    "auction-app",
    showLanding ? "auction-app--landing" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={appClassName}>
      {showLanding ? (
        renderLanding()
      ) : (
        <div className="screen-wrapper">
          {renderHeader()}
          <main className="screen-main">
            {renderLobbyContent()}
            {renderGameContent()}
            {renderResultsContent()}
          </main>
        </div>
      )}
      {renderToastStack()}
    </div>
  );
}
