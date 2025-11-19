// src/Auction.jsx
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import io from "socket.io-client";
import "./Auction.css";

const INITIAL_BANK = 1_000_000;
const CODE_ALPHABET_RE = /[^A-HJKMNPQRSTUVWXYZ23456789]/g;
const BID_PRESETS = [1_000, 5_000, 10_000, 25_000, 50_000];

const PHASE_LABEL = {
  lobby: "ожидание",
  in_progress: "идёт раунд",
  finished: "итоги",
};

function normalizeCode(value = "") {
  return value.toUpperCase().replace(CODE_ALPHABET_RE, "").slice(0, 6);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function getPointerY(event) {
  if (!event) return 0;
  if (typeof event.clientY === "number") return event.clientY;
  if (event.touches?.length) return event.touches[0].clientY;
  if (event.changedTouches?.length) return event.changedTouches[0].clientY;
  return 0;
}

function parseCustomSlots(input) {
  return String(input || "")
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [name, price, typeRaw] = line.split("|").map((part) => part.trim());
      const slot = {
        name: name || "Без названия",
        type: String(typeRaw || "lot").toLowerCase() === "lootbox" ? "lootbox" : "lot",
      };
      const base = Number(price);
      if (Number.isFinite(base) && base > 0) {
        slot.basePrice = Math.floor(base);
      }
      return slot;
    });
}

function playerDisplayName(player) {
  if (!player) return "Игрок";
  return player.user?.first_name || player.user?.username || `Игрок ${player.id}`;
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
  const [connecting, setConnecting] = useState(true);

  const [room, setRoom] = useState(null);
  const [players, setPlayers] = useState([]);
  const [selfInfo, setSelfInfo] = useState(null);
  const [auctionState, setAuctionState] = useState(null);

  const [creating, setCreating] = useState(false);
  const [joining, setJoining] = useState(false);
  const [codeInput, setCodeInput] = useState("");
  const [error, setError] = useState("");
  const [toastStack, setToastStack] = useState([]);
  const [criticalAlert, setCriticalAlert] = useState(null);

  const [busyBid, setBusyBid] = useState(false);
  const [myBid, setMyBid] = useState("");

  const [cfgOpen, setCfgOpen] = useState(false);
  const [cfgStep, setCfgStep] = useState(0);
  const [cfgRules, setCfgRules] = useState({ timePerSlotSec: 9, maxSlots: 30 });
  const [cfgSlotsText, setCfgSlotsText] = useState("");

  const [selectedPlayerId, setSelectedPlayerId] = useState(null);
  const [playersModalOpen, setPlayersModalOpen] = useState(false);
  const [playersFilterReady, setPlayersFilterReady] = useState(false);
  const [playersSort, setPlayersSort] = useState("default");
  const [historyModalOpen, setHistoryModalOpen] = useState(false);
  const [basketOpen, setBasketOpen] = useState(false);
  const [sheetDrag, setSheetDrag] = useState(0);

  const deadlineAtRef = useRef(null);
  const [nowTick, setNowTick] = useState(0);
  const toastTimersRef = useRef(new Map());
  const sheetDragStartRef = useRef(null);
  const progressSentRef = useRef(false);
  const lastSubscribedCodeRef = useRef(null);
  const lastSubscriptionSocketIdRef = useRef(null);

  const moneyFormatter = useMemo(() => new Intl.NumberFormat("ru-RU"), []);
  const sanitizedAutoCode = useMemo(() => normalizeCode(autoJoinCode || ""), [autoJoinCode]);

  const phase = auctionState?.phase || "lobby";
  const myPlayerId = selfInfo?.roomPlayerId ?? null;

  const balances = auctionState?.balances || {};
  const myBalance = myPlayerId != null ? balances[myPlayerId] ?? null : null;

  const currentSlot = auctionState?.currentSlot || null;
  const baseBid = currentSlot?.basePrice || 0;

  const myRoundBid = useMemo(() => {
    if (myPlayerId == null) return null;
    const value = auctionState?.currentBids?.[myPlayerId];
    return typeof value === "number" ? value : null;
  }, [auctionState, myPlayerId]);

  const safePlayers = useMemo(() => players.filter(Boolean), [players]);

  const currentPlayer = useMemo(
    () => safePlayers.find((p) => p.id === myPlayerId) || null,
    [safePlayers, myPlayerId]
  );

  const isOwner = useMemo(() => {
    if (!room || !selfInfo) return false;
    return room.ownerId === selfInfo.userId;
  }, [room, selfInfo]);

  const everyoneReadyExceptOwner = useMemo(() => {
    if (!room || !safePlayers.length) return false;
    return safePlayers
      .filter((p) => p.user?.id !== room.ownerId)
      .every((p) => p.ready);
  }, [room, safePlayers]);

  const playerNameById = useMemo(() => {
    const map = new Map();
    safePlayers.forEach((p) => map.set(p.id, playerDisplayName(p)));
    (auctionState?.players || []).forEach((p) => {
      if (!map.has(p.id)) map.set(p.id, p.name);
    });
    return map;
  }, [safePlayers, auctionState]);

  const openBasketForPlayer = useCallback(
    (playerId) => {
      if (playerId == null) return;
      setSelectedPlayerId(playerId);
      setPlayersModalOpen(false);
      setSheetDrag(0);
      sheetDragStartRef.current = null;
      setBasketOpen(true);
    },
    [setSelectedPlayerId]
  );

  const closeBasket = useCallback(() => {
    setBasketOpen(false);
    setSheetDrag(0);
    sheetDragStartRef.current = null;
  }, []);

  const closeConfigWizard = useCallback(() => {
    setCfgOpen(false);
    setCfgStep(0);
  }, []);

  const handleSheetDragStart = useCallback((event) => {
    sheetDragStartRef.current = getPointerY(event);
  }, []);

  const handleSheetDragMove = useCallback(
    (event) => {
      if (sheetDragStartRef.current == null) return;
      const delta = Math.max(0, getPointerY(event) - sheetDragStartRef.current);
      if (event.cancelable) {
        event.preventDefault();
      }
      setSheetDrag(delta);
    },
    []
  );

  const handleSheetDragEnd = useCallback(() => {
    if (sheetDrag > 90) {
      closeBasket();
    }
    sheetDragStartRef.current = null;
    setSheetDrag(0);
  }, [closeBasket, sheetDrag]);

  const winsByPlayerId = useMemo(() => {
    const map = new Map();
    (auctionState?.history || []).forEach((slot) => {
      if (slot.winnerPlayerId == null) return;
      map.set(slot.winnerPlayerId, (map.get(slot.winnerPlayerId) || 0) + 1);
    });
    return map;
  }, [auctionState]);

  const baskets = auctionState?.baskets || {};
  const basketTotals = auctionState?.basketTotals || {};

  const selectedPlayerIdEffective = useMemo(() => {
    if (selectedPlayerId != null) return selectedPlayerId;
    if (myPlayerId != null) return myPlayerId;
    return safePlayers[0]?.id ?? null;
  }, [selectedPlayerId, myPlayerId, safePlayers]);

  const selectedPlayer = useMemo(
    () => safePlayers.find((p) => p.id === selectedPlayerIdEffective) || null,
    [safePlayers, selectedPlayerIdEffective]
  );

  const selectedBasket = useMemo(() => {
    if (selectedPlayerIdEffective == null) return [];
    const data =
      baskets[selectedPlayerIdEffective] ||
      baskets[String(selectedPlayerIdEffective)] ||
      [];
    return Array.isArray(data) ? data : [];
  }, [baskets, selectedPlayerIdEffective]);

  const selectedBasketTotal =
    selectedPlayerIdEffective != null
      ? basketTotals[selectedPlayerIdEffective] ??
        basketTotals[String(selectedPlayerIdEffective)] ??
        0
      : 0;

  const dismissToast = useCallback((id) => {
    if (!id) return;
    setToastStack((prev) => prev.filter((toast) => toast.id !== id));
    const timer = toastTimersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      toastTimersRef.current.delete(id);
    }
  }, []);

  const pushToast = useCallback(
    (payload = {}) => {
      if (!payload?.text) return null;
      const id = payload.id || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      const duration = payload.duration ?? 3200;
      const entry = { ...payload, id };
      setToastStack((prev) => [...prev.filter((toast) => toast.id !== id), entry].slice(-4));
      if (duration > 0) {
        const timer = setTimeout(() => dismissToast(id), duration);
        toastTimersRef.current.set(id, timer);
      }
      return id;
    },
    [dismissToast]
  );

  const pushError = useCallback(
    (message, options = {}) => {
      setError(message || "");
      if (!message) return;
      pushToast({ type: "error", text: message, duration: options.duration ?? 3800 });
      if (options.critical) {
        setCriticalAlert({
          id: Date.now(),
          text: message,
          actionLabel: options.actionLabel || "OK",
          onAction: options.onAction || null,
        });
      }
    },
    [pushToast]
  );

  const clearError = useCallback(() => setError(""), []);
  const closeCriticalAlert = useCallback(() => setCriticalAlert(null), []);

  const compactHistory = useMemo(
    () => (auctionState?.history || []).slice(-6).reverse(),
    [auctionState?.history]
  );
  const fullHistory = useMemo(
    () => (auctionState?.history || []).slice().reverse(),
    [auctionState?.history]
  );

  const liveBidFeed = useMemo(() => {
    const feed = Array.isArray(auctionState?.bidFeed) ? auctionState.bidFeed : [];
    if (feed.length) {
      return feed
        .slice(-3)
        .reverse()
        .map((entry, index) => {
          const playerId = entry.playerId ?? entry.id ?? index;
          return {
            id: entry.id || `${playerId}-${index}`,
            playerId,
            amount: Number(entry.amount) || 0,
            label:
              entry.label ||
              playerNameById.get(playerId) ||
              (playerId != null ? `Игрок ${playerId}` : "Ставка"),
          };
        });
    }
    const current = auctionState?.currentBids || {};
    return Object.entries(current)
      .map(([id, amount]) => ({
        id,
        playerId: Number(id),
        amount: Number(amount) || 0,
        label: playerNameById.get(Number(id)) || `Игрок ${id}`,
      }))
      .filter((entry) => entry.amount > 0)
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 3);
  }, [auctionState?.bidFeed, auctionState?.currentBids, playerNameById]);

  const readyCount = useMemo(() => {
    if (!room) return 0;
    return safePlayers.filter((p) => p.ready && p.user?.id !== room.ownerId).length;
  }, [safePlayers, room]);

  const nonHostPlayers = useMemo(() => {
    if (!room) return Math.max(safePlayers.length - 1, 0);
    return Math.max(safePlayers.length - 1, 0);
  }, [safePlayers.length, room]);

  const readyPercent = nonHostPlayers
    ? Math.round((readyCount / Math.max(nonHostPlayers, 1)) * 100)
    : 0;

  const modalPlayers = useMemo(() => {
    const base = safePlayers.slice();
    const filtered = playersFilterReady ? base.filter((p) => p.ready) : base;
    const next = filtered.slice();
    next.sort((a, b) => {
      if (playersSort === "balance") {
        return (balances[b.id] ?? 0) - (balances[a.id] ?? 0);
      }
      if (playersSort === "wins") {
        return (winsByPlayerId.get(b.id) || 0) - (winsByPlayerId.get(a.id) || 0);
      }
      const aId = typeof a.id === "number" ? a.id : Number(a.id) || 0;
      const bId = typeof b.id === "number" ? b.id : Number(b.id) || 0;
      return aId - bId;
    });
    return next;
  }, [safePlayers, playersFilterReady, playersSort, balances, winsByPlayerId]);

  const headerProgress = useMemo(() => {
    if (showLobby) return readyPercent;
    if (showGame) return progressPct ?? 0;
    if (showResult) return 100;
    return 0;
  }, [showLobby, readyPercent, showGame, progressPct, showResult]);

  const cfgPreviewSlots = useMemo(() => parseCustomSlots(cfgSlotsText), [cfgSlotsText]);
  useEffect(() => {
    if (!currentSlot) {
      setMyBid("");
      return;
    }
    if (currentSlot.basePrice) {
      setMyBid(String(currentSlot.basePrice));
    }
  }, [currentSlot?.index, currentSlot?.basePrice]);

  useEffect(() => {
    const ms = auctionState?.timeLeftMs;
    if (ms == null) {
      deadlineAtRef.current = null;
      return;
    }
    deadlineAtRef.current = Date.now() + Math.max(0, ms);
  }, [auctionState?.timeLeftMs]);

  useEffect(() => {
    if (!deadlineAtRef.current) return;
    const timer = setInterval(
      () => setNowTick((tick) => (tick + 1) % 1_000_000),
      250
    );
    return () => clearInterval(timer);
  }, [auctionState?.phase, auctionState?.timeLeftMs]);

  const secsLeft = useMemo(() => {
    if (!deadlineAtRef.current) return null;
    const diff = Math.ceil((deadlineAtRef.current - Date.now()) / 1000);
    return Math.max(0, diff);
  }, [nowTick]);

  const timePerSlot = auctionState?.rules?.timePerSlotSec || Number(cfgRules.timePerSlotSec) || 0;

  const progressPct = useMemo(() => {
    if (secsLeft == null || !timePerSlot) return null;
    const spent = Math.max(0, timePerSlot - secsLeft);
    return Math.min(100, Math.round((spent / timePerSlot) * 100));
  }, [secsLeft, timePerSlot]);

  const countdownStep = useMemo(() => {
    if (secsLeft == null || !timePerSlot) return null;
    const slice = Math.max(1, Math.round(timePerSlot / 3));
    if (secsLeft > slice * 2) return 3;
    if (secsLeft > slice) return 2;
    if (secsLeft >= 0) return 1;
    return null;
  }, [secsLeft, timePerSlot]);

  const subscribeToRoom = useCallback(
    (rawCode, options = {}) => {
      const code = normalizeCode(rawCode);
      if (!code || !socket) return;
      const force = options.force ?? false;
      const socketId = socket.id ?? null;
      const alreadySame =
        lastSubscribedCodeRef.current === code &&
        lastSubscriptionSocketIdRef.current === socketId &&
        socketId != null;
      if (!force && alreadySame) return;
      lastSubscribedCodeRef.current = code;
      socket.emit("room:subscribe", { code });
      socket.emit("auction:sync", { code });
      if (socketId) {
        lastSubscriptionSocketIdRef.current = socketId;
      }
    },
    [socket]
  );

  useEffect(() => {
    if (!room?.code) return;
    subscribeToRoom(room.code);
  }, [room?.code, subscribeToRoom]);
  useEffect(() => {
    if (!apiBase) return;
    const instance = io(apiBase, {
      transports: ["websocket"],
      auth: { initData: initData || "" },
    });

    setSocket(instance);

    instance.on("connect_error", (err) => {
      setConnecting(false);
      pushError(`Не удалось подключиться: ${err.message}`, {
        critical: true,
        actionLabel: "Выйти",
        onAction: handleExit,
      });
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
      try {
        instance.off("toast");
        instance.off("room:state");
        instance.off("private:self");
        instance.off("auction:state");
        instance.disconnect();
      } catch {}
    };
  }, [apiBase, initData, pushError, pushToast]);

  useEffect(() => {
    if (!socket) return;
    const handleConnect = () => {
      setConnecting(false);
      const code = lastSubscribedCodeRef.current;
      if (code) subscribeToRoom(code, { force: true });
    };
    const handleDisconnect = () => {
      setConnecting(true);
      lastSubscriptionSocketIdRef.current = null;
    };
    socket.on("connect", handleConnect);
    socket.on("disconnect", handleDisconnect);
    return () => {
      socket.off("connect", handleConnect);
      socket.off("disconnect", handleDisconnect);
    };
  }, [socket, subscribeToRoom]);

  useEffect(() => {
    if (!setBackHandler) return;
    const handler = () => {
      handleExit();
    };
    setBackHandler(handler);
    return () => setBackHandler(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setBackHandler, room?.code]);

  useEffect(() => {
    if (!socket) return;
    if (!sanitizedAutoCode) return;
    joinRoom(sanitizedAutoCode, { fromInvite: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socket, sanitizedAutoCode]);

  useEffect(
    () => () => {
      toastTimersRef.current.forEach((timeout) => clearTimeout(timeout));
      toastTimersRef.current.clear();
    },
    []
  );

  useEffect(() => {
    if (phase !== "finished") {
      progressSentRef.current = false;
      return;
    }
    if (progressSentRef.current) return;
    progressSentRef.current = true;
    try {
      onProgress?.();
    } catch {}
  }, [phase, onProgress]);

  useEffect(() => {
    if (!safePlayers.length) {
      setSelectedPlayerId(null);
      return;
    }
    if (!safePlayers.some((p) => p.id === selectedPlayerId)) {
      setSelectedPlayerId(selfInfo?.roomPlayerId ?? safePlayers[0].id);
    }
  }, [safePlayers, selectedPlayerId, selfInfo?.roomPlayerId]);

  useEffect(() => {
    if (!sanitizedAutoCode || room || codeInput) return;
    setCodeInput(sanitizedAutoCode);
  }, [sanitizedAutoCode, room, codeInput]);

  useEffect(() => {
    if (!basketOpen) return;
    if (selectedPlayerIdEffective == null) {
      setBasketOpen(false);
    }
  }, [basketOpen, selectedPlayerIdEffective]);

  useEffect(() => {
    if (!basketOpen) return undefined;
    if (typeof window === "undefined") return undefined;
    const handler = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeBasket();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [basketOpen, closeBasket]);

  useEffect(() => {
    if (!basketOpen) return undefined;
    if (typeof document === "undefined") return undefined;
    const { style } = document.body;
    const prev = style.overflow;
    style.overflow = "hidden";
    return () => {
      style.overflow = prev;
    };
  }, [basketOpen]);

  useEffect(() => {
    if (basketOpen) return;
    setSheetDrag(0);
    sheetDragStartRef.current = null;
  }, [basketOpen]);
  async function createRoom() {
    if (!initData) {
      pushError("Нет initData от Telegram");
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
        body: JSON.stringify({}),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        const code = data?.error || "failed";
        pushError(
          code === "code_already_in_use" ? "Код комнаты уже занят" : "Не удалось создать комнату"
        );
        return;
      }
      setRoom(data.room || null);
      setPlayers(data.players || []);
      if (data.room?.code) {
        setCodeInput(data.room.code);
        subscribeToRoom(data.room.code, { force: true });
      }
    } catch {
      pushError("Ошибка сети при создании комнаты");
    } finally {
      setCreating(false);
    }
  }

  async function joinRoom(rawCode, options = {}) {
    if (!initData) {
      pushError("Нет initData от Telegram");
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
      const resp = await fetch(`${apiBase}/api/rooms/${code}/join`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Telegram-Init-Data": initData,
        },
        body: JSON.stringify({}),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        const codeErr = data?.error || "failed";
        const map = {
          room_not_found: "Комната не найдена",
          room_full: "Комната заполнена",
          game_in_progress: "Игра уже началась",
        };
        pushError(map[codeErr] || "Не удалось войти");
        return;
      }
      setRoom(data.room || null);
      setPlayers(data.players || []);
      setCodeInput(code);
      subscribeToRoom(code, { force: true });
      if (options.fromInvite && onInviteConsumed) {
        try {
          onInviteConsumed(code);
        } catch {}
      }
    } catch {
      pushError("Ошибка сети при входе в комнату");
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
      { code: room.code, ready: !ready },
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
      { code: room.code },
      (resp) => {
        if (!resp || !resp.ok) {
          const map = {
            room_not_found: "Комната не найдена",
            forbidden_not_owner: "Только хост может стартовать",
            need_at_least_2_players: "Нужно минимум два игрока",
            need_ready_players: "Ждём готовность игроков",
            already_started: "Игра уже идёт",
          };
          pushError(map[resp?.error] || "Не удалось запустить аукцион");
        }
      }
    );
  }

  function configureAuction() {
    if (!socket || !room || !isOwner) return;
    const slots = parseCustomSlots(cfgSlotsText);
    socket.emit(
      "auction:configure",
      {
        code: room.code,
        rules: {
          timePerSlotSec: clamp(Number(cfgRules.timePerSlotSec) || 25, 5, 120),
          maxSlots: clamp(Number(cfgRules.maxSlots) || 30, 1, 60),
        },
        slots,
      },
      (resp) => {
        if (!resp || !resp.ok) {
          pushError(resp?.errorText || "Не удалось применить настройки");
        } else {
          pushToast({ type: "info", text: "Настройки обновлены" });
          clearError();
          setCfgOpen(false);
          setCfgStep(0);
        }
      }
    );
  }

  const pauseAuction = useCallback(() => {
    if (!socket || !room || !isOwner) return;
    socket.emit("auction:pause", { code: room.code }, () => {});
  }, [socket, room, isOwner]);

  const resumeAuction = useCallback(() => {
    if (!socket || !room || !isOwner) return;
    socket.emit("auction:resume", { code: room.code }, () => {});
  }, [socket, room, isOwner]);

  const forceNext = useCallback(() => {
    if (!socket || !room || !isOwner) return;
    socket.emit("auction:next", { code: room.code }, () => {});
  }, [socket, room, isOwner]);

  function setBidRelative(delta = 0) {
    setMyBid((prev) => {
      const numericPrev = Number(String(prev).replace(/\s/g, "")) || 0;
      const baseline = numericPrev > 0 ? numericPrev : baseBid > 0 ? baseBid : 0;
      const max = myBalance ?? INITIAL_BANK;
      const next = delta === 0 ? baseline : baseline + delta;
      return String(clamp(next, 0, max));
    });
  }

  function sendPass() {
    setMyBid("0");
    sendBid(0);
  }

  function sendBid(forcedAmount) {
    if (!socket || !room || !selfInfo) return;
    if (!auctionState || auctionState.phase !== "in_progress") return;

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
      pushError(`Минимальная ставка ${moneyFormatter.format(baseBid)}$`);
      return;
    }

    setBusyBid(true);
    socket.emit(
      "auction:bid",
      { code: room.code, amount },
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
            paused: "Аукцион на паузе",
          };
          pushError(map[resp?.error] || "Не удалось принять ставку");
        } else {
          setMyBid("");
          clearError();
        }
      }
    );
  }

  async function leaveRoom() {
    const code = room?.code;
    if (!code) return;
    try {
      await fetch(`${apiBase}/api/rooms/${code}/leave`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Telegram-Init-Data": initData || "",
        },
        body: JSON.stringify({}),
      }).catch(() => {});
    } catch {}
    try {
      socket?.emit("room:leave", { code });
    } catch {}
    setRoom(null);
    setPlayers([]);
    setSelfInfo(null);
    setAuctionState(null);
    lastSubscribedCodeRef.current = null;
    lastSubscriptionSocketIdRef.current = null;
    progressSentRef.current = false;
  }

  async function handleExit() {
    try {
      await leaveRoom();
    } finally {
      goBack?.();
    }
  }

  async function copyRoomCode() {
    if (!room?.code) return;
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(room.code);
      }
      pushToast({ type: "info", text: "Код скопирован" });
    } catch {
      pushToast({ type: "error", text: "Не удалось скопировать" });
    }
  }

  const showLanding = !room;
  const showLobby = phase === "lobby";
  const showGame = phase === "in_progress";
  const showResult = phase === "finished";

  const primaryActionLabel = isOwner
    ? showLobby
      ? "Старт"
      : showGame
      ? "Далее"
      : "Реванш"
    : currentPlayer?.ready
    ? "Не готов"
    : "Я готов";

  const primaryActionDisabled = isOwner
    ? showLobby && !everyoneReadyExceptOwner
    : !currentPlayer;

  const primaryActionHandler = isOwner
    ? showLobby || showResult
      ? handleStartAuction
      : forceNext
    : toggleReady;
  const renderLanding = () => (
    <div className="landing-screen">
      <div className="landing-card">
        <span className="badge">AUCTION</span>
        <h1>Команды через ставки</h1>
        <p className="muted">Создай комнату и отправь код друзьям.</p>
        <div className="landing-actions">
          <button
            type="button"
            className="accent-btn"
            onClick={createRoom}
            disabled={creating}
          >
            {creating ? "Создаём…" : "Создать комнату"}
          </button>
          <div className="join-inline">
            <label htmlFor="auction-join-code" className="sr-only">
              Код комнаты
            </label>
            <input
              id="auction-join-code"
              className="text-input"
              maxLength={6}
              placeholder="Ввести код"
              value={codeInput}
              onChange={(e) => setCodeInput(normalizeCode(e.target.value))}
              inputMode="latin"
              autoCapitalize="characters"
            />
            <button
              type="button"
              className="ghost-btn"
              onClick={() => joinRoom(codeInput)}
              disabled={joining}
            >
              {joining ? "Подключаем…" : "Подключиться"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  const renderTopBar = () => (
    <header className="auction-topbar">
      <div className="topbar-row">
        <div className="topbar-left">
          <div className="logo-chip">AU</div>
          <div className="room-info">
            <span className="app-title">auction</span>
            <button type="button" className="pill room-code" onClick={copyRoomCode}>
              {room?.code || "------"}
            </button>
          </div>
        </div>
        <div className="topbar-center">
          <span className="phase-label">{PHASE_LABEL[phase]}</span>
          {showLobby ? (
            <span className="phase-subtitle">
              {readyCount}/{Math.max(nonHostPlayers, 1) || 1} готовы
            </span>
          ) : (
            slotMax && (
              <span className="phase-subtitle">
                Лот {slotIndex}/{slotMax}
              </span>
            )
          )}
          <div className="phase-meta">
            <div className="phase-timer">
              <strong>{secsLeft != null ? secsLeft : "--"}</strong>
              <span>сек</span>
            </div>
            {auctionState?.paused && <span className="pill ghost">Пауза</span>}
          </div>
        </div>
        <div className="topbar-balance">
          <span>баланс</span>
          <strong>{myBalance != null ? `${moneyFormatter.format(myBalance)}$` : "-"}</strong>
        </div>
        <div className="topbar-actions">
          <button
            type="button"
            className="icon-btn ghost"
            onClick={() => {
              setCfgStep(0);
              setCfgOpen(true);
            }}
            disabled={!isOwner}
            aria-label="Настройки комнаты"
          >
            ⚙
          </button>
          <button
            type="button"
            className="icon-btn ghost"
            onClick={() => setPlayersModalOpen(true)}
            aria-label="Чат и игроки"
          >
            💬
          </button>
          <button type="button" className="icon-btn" onClick={handleExit} aria-label="Назад">
            ↩
          </button>
        </div>
      </div>
      <div className="phase-progress" role="presentation" aria-hidden="true">
        <div style={{ width: `${clamp(headerProgress, 0, 100)}%` }} />
      </div>
    </header>
  );

  const renderLotCard = () => {
    if (!showGame) return null;
    const icon = currentSlot?.type === "lootbox" ? "🎁" : "📦";
    const typeLabel = currentSlot?.type === "lootbox" ? "Кейс" : "Лот";
    const growth = auctionState?.currentStep || auctionState?.growth || 0;
    return (
      <section className="panel stage-card lot-card">
        <header className="stage-head">
          <div>
            <span className="label">Активный этап</span>
            <h3>{currentSlot?.name || "Ждём слот"}</h3>
            <span className="muted tiny">{typeLabel}</span>
          </div>
          <div className="lot-pill">
            <span>
              #{slotIndex}
              {slotMax ? ` / ${slotMax}` : ""}
            </span>
          </div>
        </header>
        {currentSlot ? (
          <>
            <div className="lot-preview">
              <div className={`lot-icon ${currentSlot.type || "lot"}`}>{icon}</div>
              <div className="lot-meta">
                <span className="muted tiny">Базовая ставка</span>
                <strong>{moneyFormatter.format(baseBid)}$</strong>
                {growth > 0 && (
                  <span className="muted tiny">Шаг +{moneyFormatter.format(growth)}$</span>
                )}
              </div>
            </div>
            <div className="lot-pricing">
              <div>
                <span className="muted tiny">Моя ставка</span>
                <strong className="balance-text">
                  {myRoundBid != null ? `${moneyFormatter.format(myRoundBid)}$` : "—"}
                </strong>
              </div>
              <div>
                <span className="muted tiny">Баланс</span>
                <strong className="balance-text">
                  {myBalance != null ? `${moneyFormatter.format(myBalance)}$` : "—"}
                </strong>
              </div>
            </div>
            <div className="timer timer-large">
              <div className="timer-value">{countdownStep != null ? countdownStep : "—"}</div>
              {secsLeft != null && <div className="muted small">{secsLeft} c</div>}
              {progressPct != null && (
                <div className="timer-bar">
                  <div style={{ width: `${progressPct}%` }} />
                </div>
              )}
            </div>
            {liveBidFeed.length > 0 && (
              <div className="live-ticker" aria-live="polite">
                {liveBidFeed.map((entry) => (
                  <div key={entry.id} className="ticker-row">
                    <span className="ticker-name">{entry.label}</span>
                    <strong className="ticker-value">{moneyFormatter.format(entry.amount)}$</strong>
                  </div>
                ))}
              </div>
            )}
            <div className="bid-form">
              <div className="quick-bids rail">
                {BID_PRESETS.map((step) => (
                  <button
                    key={step}
                    type="button"
                    className="pill ghost"
                    onClick={() => setBidRelative(step)}
                    disabled={myBalance == null || myBalance <= 0}
                  >
                    +{moneyFormatter.format(step)}
                  </button>
                ))}
                <button
                  type="button"
                  className="pill ghost"
                  onClick={() => sendBid(myBalance || 0)}
                  disabled={myBalance == null || myBalance <= 0}
                >
                  All-in
                </button>
                <button type="button" className="pill ghost" onClick={sendPass}>
                  Пас
                </button>
              </div>
              <input
                className="text-input"
                inputMode="numeric"
                placeholder="Ставка"
                value={myBid}
                onChange={(e) => setMyBid(e.target.value.replace(/[^\d]/g, ""))}
              />
              <div className="bid-actions">
                <button type="button" className="ghost-btn" onClick={() => setBidRelative(0)}>
                  Сбросить
                </button>
                <button
                  type="button"
                  className="accent-btn"
                  onClick={() => sendBid()}
                  disabled={busyBid || myBalance == null}
                >
                  {busyBid ? "Отправляем…" : "Сделать ставку"}
                </button>
              </div>
            </div>
            {isOwner && (
              <div className="owner-row owner-inline">
                <button
                  type="button"
                  className="pill ghost"
                  onClick={auctionState?.paused ? resumeAuction : pauseAuction}
                >
                  {auctionState?.paused ? "Продолжить" : "Пауза"}
                </button>
                <button type="button" className="pill ghost" onClick={forceNext}>
                  Следующий
                </button>
              </div>
            )}
          </>
        ) : (
          <p className="muted">Настраиваем слот в комнате.</p>
        )}
      </section>
    );
  };  const renderLobbyCard = () => {
    if (!showLobby) return null;
    return (
      <section className="panel stage-card lobby-card">
        <header className="stage-head">
          <div>
            <span className="label">Комната</span>
            <h3>{room?.name || room?.code || "Лобби"}</h3>
          </div>
          {isOwner && (
            <button
              type="button"
              className="pill ghost"
              onClick={() => {
                setCfgStep(0);
                setCfgOpen(true);
              }}
            >
              Настройки
            </button>
          )}
        </header>
        <div className="lobby-status">
          <div className="ready-meter">
            <div className="ready-ring">
              <svg viewBox="0 0 120 120">
                <circle className="track" cx="60" cy="60" r="50" />
                <circle
                  className="progress"
                  cx="60"
                  cy="60"
                  r="50"
                  strokeDasharray={314}
                  strokeDashoffset={314 - (314 * readyPercent) / 100}
                />
              </svg>
              <div className="ready-value">
                <strong>{readyCount}</strong>
                <span>готовы</span>
              </div>
            </div>
            <span className="muted small">
              {nonHostPlayers > 0
                ? `из ${nonHostPlayers}`
                : `${safePlayers.length} игрок${safePlayers.length === 1 ? "" : "ов"}`}
            </span>
          </div>
          <div className="lobby-actions">
            {!isOwner ? (
              <button
                type="button"
                className="accent-btn"
                onClick={toggleReady}
                disabled={!currentPlayer}
              >
                {currentPlayer?.ready ? "Я не готов" : "Я готов"}
              </button>
            ) : (
              <>
                <button
                  type="button"
                  className="accent-btn"
                  onClick={handleStartAuction}
                  disabled={!everyoneReadyExceptOwner}
                >
                  {everyoneReadyExceptOwner ? "Стартуем" : "Ждём игроков"}
                </button>
                <button
                  type="button"
                  className="ghost-btn"
                  onClick={() => {
                    setCfgStep(0);
                    setCfgOpen(true);
                  }}
                >
                  Настроить
                </button>
              </>
            )}
          </div>
        </div>
      </section>
    );
  };  const renderResultsCard = () => {
    if (!showResult) return null;
    return (
      <section className="panel">
        <div className="panel-head">
          <div>
            <span className="label">Финиш</span>
            <h3>Итоги</h3>
          </div>
        </div>
        <div className="results">
          {safePlayers
            .slice()
            .sort((a, b) => (balances[b.id] ?? 0) - (balances[a.id] ?? 0))
            .map((p) => {
              const name = playerDisplayName(p);
              const avatar = p.user?.photo_url || p.user?.avatar || null;
              const balance = balances[p.id] ?? 0;
              const winner = auctionState?.winners?.includes(p.id);
              return (
                <div key={p.id} className={"result-card" + (winner ? " winner" : "")}>
                  <div className="result-avatar">
                    {avatar ? <img src={avatar} alt={name} /> : name.slice(0, 1)}
                  </div>
                  <div className="result-body">
                    <strong>{name}</strong>
                    <span className="muted">{moneyFormatter.format(balance)}$</span>
                  </div>
                </div>
              );
            })}
        </div>
        <div className="owner-row">
          {isOwner && (
            <button type="button" className="accent-btn" onClick={handleStartAuction}>
              Ещё раунд
            </button>
          )}
          <button type="button" className="ghost-btn" onClick={handleExit}>
            Меню
          </button>
        </div>
      </section>
    );
  };

  const renderBasketSheet = () => {
    if (!selectedPlayer || !basketOpen) return null;
    const avatarUrl = selectedPlayer.user?.photo_url || selectedPlayer.user?.avatar || null;
    const playerBalance = balances[selectedPlayer.id] ?? null;
    const playerBasket = selectedBasket;
    const lootboxes = playerBasket.filter((item) => item.type === 'lootbox').length;
    const latest = playerBasket[playerBasket.length - 1] || null;
    const typeIcon = (slot) => (slot.type === "lootbox" ? "🎁" : "📦");
    return (
      <div className="basket-sheet" role="dialog" aria-modal="true">
        <button
          type="button"
          className="sheet-backdrop"
          aria-label="Закрыть корзину"
          onClick={closeBasket}
        />
        <div
          className="basket-card"
          style={{ transform: `translateY(${sheetDrag}px)` }}
          onPointerDown={handleSheetDragStart}
          onPointerMove={handleSheetDragMove}
          onPointerUp={handleSheetDragEnd}
          onPointerCancel={handleSheetDragEnd}
          onTouchStart={handleSheetDragStart}
          onTouchMove={handleSheetDragMove}
          onTouchEnd={handleSheetDragEnd}
        >
          <div className="sheet-handle" />
          <div className="basket-head">
            <div>
              <span className="label">Корзина игрока</span>
              <h3>{playerDisplayName(selectedPlayer)}</h3>
            </div>
            <button type="button" className="icon-btn ghost" onClick={closeBasket} aria-label="Закрыть">
              ?
            </button>
          </div>
          <div className="basket-owner">
            <div className="basket-avatar">
              {avatarUrl ? (
                <img src={avatarUrl} alt={playerDisplayName(selectedPlayer)} />
              ) : (
                playerDisplayName(selectedPlayer).slice(0, 1)
              )}
            </div>
            <div className="basket-meta">
              <span>Баланс</span>
              <strong>{playerBalance != null ? `${moneyFormatter.format(playerBalance)}$` : '-'}</strong>
            </div>
            <div className="basket-meta">
              <span>Потрачено</span>
              <strong>{moneyFormatter.format(selectedBasketTotal || 0)}$</strong>
            </div>
            <div className="basket-meta">
              <span>Последний лот</span>
              <strong>{latest ? latest.name : '—'}</strong>
            </div>
            <div className="basket-meta">
              <span>Кейсы</span>
              <strong>{lootboxes}</strong>
            </div>
          </div>
          {playerBasket.length === 0 ? (
            <p className="muted center">Пока без трофеев.</p>
          ) : (
            <div className="basket-list">
              {playerBasket.map((item) => (
                <div key={`${item.index}-${item.name}`} className="basket-row">
                  <div className="basket-row-main">
                    <span className="basket-icon">{typeIcon(item)}</span>
                    <div>
                      <strong>{item.name}</strong>
                      <span className="muted tiny">#{(item.index ?? 0) + 1}</span>
                    </div>
                  </div>
                  <div className="basket-row-value">
                    <strong>{moneyFormatter.format(item.paid || 0)}$</strong>
                    <span className="muted tiny">{moneyFormatter.format(item.value || 0)}$</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  };    const renderHistoryTimeline = () => {
    if (!compactHistory.length) return null;
    return (
      <section className="panel timeline-card">
        <div className="panel-head">
          <div>
            <span className="label">История</span>
            <h3>Последние лоты</h3>
          </div>
          <button type="button" className="pill ghost" onClick={() => setHistoryModalOpen(true)}>
            Подробнее
          </button>
        </div>
        <div className="timeline">
          {compactHistory.map((slot) => {
            const winner =
              slot.winnerPlayerId != null ? playerNameById.get(slot.winnerPlayerId) : null;
            return (
              <button
                key={slot.index}
                type="button"
                className="timeline-row"
                onClick={() => setHistoryModalOpen(true)}
              >
                <div className="timeline-dot" />
                <div className="timeline-body">
                  <strong>
                    #{slot.index + 1} · {slot.type === "lootbox" ? "🎁" : "📦"}
                  </strong>
                  <span>{slot.name}</span>
                  <span className="muted tiny">
                    {winner ? `${winner} · ${moneyFormatter.format(slot.winBid || 0)}$` : "—"}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </section>
    );
  };
  const renderPlayersGridSection = () => {
    if (!safePlayers.length) return null;
    return (
      <section className="panel players-grid-card">
        <div className="panel-head players-grid-head">
          <div>
            <span className="label">Игроки</span>
            <h3>{safePlayers.length}</h3>
          </div>
          <button
            type="button"
            className="icon-btn ghost"
            aria-label="Показать всех игроков"
            onClick={() => setPlayersModalOpen(true)}
          >
            🧲
          </button>
        </div>
        <div className="players-grid">
          {safePlayers.map((p) => {
            const name = playerDisplayName(p);
            const balance = balances[p.id] ?? null;
            const wins = winsByPlayerId.get(p.id) || 0;
            const avatarUrl = p.user?.photo_url || p.user?.avatar || null;
            const isSelected = selectedPlayerIdEffective === p.id;
            const isHostTile = p.user?.id === room?.ownerId;
            const playerBasket = baskets[p.id] || baskets[String(p.id)] || [];
            const cases = Array.isArray(playerBasket)
              ? playerBasket.filter((item) => item.type === "lootbox").length
              : 0;
            const lastItem =
              Array.isArray(playerBasket) && playerBasket.length
                ? playerBasket[playerBasket.length - 1]
                : null;
            return (
              <button
                key={p.id}
                type="button"
                className={
                  "player-card" +
                  (p.ready ? " ready" : "") +
                  (isSelected ? " selected" : "") +
                  (isHostTile ? " host" : "")
                }
                onClick={() => openBasketForPlayer(p.id)}
              >
                <div className="player-card__avatar">
                  {avatarUrl ? <img src={avatarUrl} alt={name} /> : name.slice(0, 1)}
                </div>
                <div className="player-card__body">
                  <strong>{name}</strong>
                  <span className="player-card__balance">
                    {balance != null ? `${moneyFormatter.format(balance)}$` : "-"}
                  </span>
                  <div className="player-card__meta">
                    <span>{lastItem ? lastItem.name : "Без побед"}</span>
                    <span>{cases} кейс.</span>
                  </div>
                </div>
                <div className="player-card__badges">
                  {p.ready && <span className="player-badge">Готов</span>}
                  {wins > 0 && <span className="player-badge ghost">+{wins}</span>}
                  {isHostTile && <span className="player-badge ghost">Host</span>}
                </div>
              </button>
            );
          })}
        </div>
      </section>
    );
  };

  const renderPlayersModal = () => {
    if (!playersModalOpen) return null;
    return (
      <div className="sheet-overlay" role="dialog" aria-modal="true">
        <button
          type="button"
          className="sheet-backdrop"
          aria-label="Закрыть список игроков"
          onClick={() => setPlayersModalOpen(false)}
        />
        <div className="players-modal">
          <div className="sheet-handle" />
          <header className="players-modal-head">
            <strong>Игроки</strong>
            <button type="button" className="icon-btn ghost" onClick={() => setPlayersModalOpen(false)}>
              ✕
            </button>
          </header>
          <div className="players-modal-filters">
            <label className="toggle">
              <input
                type="checkbox"
                checked={playersFilterReady}
                onChange={(e) => setPlayersFilterReady(e.target.checked)}
              />
              <span>Только готовые</span>
            </label>
            <select value={playersSort} onChange={(e) => setPlayersSort(e.target.value)}>
              <option value="default">По порядку</option>
              <option value="balance">По балансу</option>
              <option value="wins">По победам</option>
            </select>
          </div>
          <div className="players-modal-list">
            {modalPlayers.map((player) => {
              const balance = balances[player.id] ?? null;
              const wins = winsByPlayerId.get(player.id) || 0;
              const avatarUrl = player.user?.photo_url || player.user?.avatar || null;
              return (
                <div key={player.id} className="players-modal-row">
                  <div className="players-modal-main">
                    <div className="player-card__avatar small">
                      {avatarUrl ? <img src={avatarUrl} alt={playerDisplayName(player)} /> : playerDisplayName(player).slice(0, 1)}
                    </div>
                    <div>
                      <strong>{playerDisplayName(player)}</strong>
                      <span className="muted tiny">
                        {balance != null ? `${moneyFormatter.format(balance)}$` : "-"} · победы {wins}
                      </span>
                    </div>
                  </div>
                  <div className="players-modal-actions">
                    <button
                      type="button"
                      className="pill ghost"
                      onClick={() => openBasketForPlayer(player.id)}
                    >
                      Корзина
                    </button>
                    {player.id === myPlayerId && !isOwner && (
                      <button type="button" className="pill ghost" onClick={toggleReady}>
                        {player.ready ? "Не готов" : "Готов"}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  };

  const renderHistoryModal = () => {
    if (!historyModalOpen) return null;
    return (
      <div className="sheet-overlay" role="dialog" aria-modal="true">
        <button
          type="button"
          className="sheet-backdrop"
          aria-label="Закрыть историю"
          onClick={() => setHistoryModalOpen(false)}
        />
        <div className="history-modal">
          <div className="sheet-handle" />
          <header className="players-modal-head">
            <strong>История лотов</strong>
            <button type="button" className="icon-btn ghost" onClick={() => setHistoryModalOpen(false)}>
              ✕
            </button>
          </header>
          <div className="history-modal-list">
            {fullHistory.map((slot) => {
              const winner =
                slot.winnerPlayerId != null ? playerNameById.get(slot.winnerPlayerId) : null;
              return (
                <div key={`${slot.index}-${slot.name}`} className="history-modal-row">
                  <div>
                    <strong>
                      #{slot.index + 1} · {slot.type === "lootbox" ? "🎁" : "📦"}
                    </strong>
                    <span>{slot.name}</span>
                  </div>
                  <div className="muted tiny">
                    {winner ? `${winner} · ${moneyFormatter.format(slot.winBid || 0)}$` : "—"}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  };

  const renderConfigWizard = () => {
    if (!cfgOpen) return null;
    const steps = ["rules", "slots"];
    const safeStep = Math.min(cfgStep, steps.length - 1);
    const current = steps[safeStep];
    const progress = Math.round(((safeStep + 1) / steps.length) * 100);
    return (
      <div className="sheet-overlay" role="dialog" aria-modal="true">
        <button
          type="button"
          className="sheet-backdrop"
          aria-label="Закрыть настройки"
          onClick={closeConfigWizard}
        />
        <div className="config-sheet">
          <div className="sheet-handle" />
          <header className="config-head">
            <span>Настройки комнаты</span>
            <div className="progress-track">
              <div style={{ width: `${progress}%` }} />
            </div>
          </header>
          {current === "rules" ? (
            <div className="wizard-step">
              <label className="field">
                <span>Время на лот, сек</span>
                <input
                  className="text-input"
                  inputMode="numeric"
                  value={cfgRules.timePerSlotSec}
                  onChange={(e) =>
                    setCfgRules((prev) => ({
                      ...prev,
                      timePerSlotSec: e.target.value.replace(/[^\d]/g, ""),
                    }))
                  }
                />
              </label>
              <label className="field">
                <span>Максимум слотов</span>
                <input
                  className="text-input"
                  inputMode="numeric"
                  value={cfgRules.maxSlots}
                  onChange={(e) =>
                    setCfgRules((prev) => ({
                      ...prev,
                      maxSlots: e.target.value.replace(/[^\d]/g, ""),
                    }))
                  }
                />
              </label>
            </div>
          ) : (
            <div className="wizard-step">
              <label className="field">
                <span>Слоты списком</span>
                <textarea
                  className="text-input"
                  rows={4}
                  placeholder="Лут | 90000 | lot"
                  value={cfgSlotsText}
                  onChange={(e) => setCfgSlotsText(e.target.value)}
                />
              </label>
              <div className="wizard-preview">
                {cfgPreviewSlots.length === 0 ? (
                  <span className="muted tiny">Нет предпросмотра</span>
                ) : (
                  cfgPreviewSlots.slice(0, 5).map((slot, idx) => (
                    <div key={`${slot.name}-${idx}`} className="wizard-preview-row">
                      <span>{slot.name}</span>
                      <span className="muted tiny">{slot.type === "lootbox" ? "Кейс" : "Лот"}</span>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
          <footer className="wizard-footer">
            <button
              type="button"
              className="ghost-btn"
              onClick={() =>
                safeStep === 0 ? closeConfigWizard() : setCfgStep((step) => Math.max(0, step - 1))
              }
            >
              Назад
            </button>
            {safeStep < steps.length - 1 ? (
              <button type="button" className="accent-btn" onClick={() => setCfgStep((step) => Math.min(steps.length - 1, step + 1))}>
                Далее
              </button>
            ) : (
              <button type="button" className="accent-btn" onClick={configureAuction}>
                Применить
              </button>
            )}
          </footer>
        </div>
      </div>
    );
  };

  const renderToastStack = () => {
    if (!toastStack.length) return null;
    return (
      <div className="toast-stack" role="status" aria-live="polite">
        {toastStack.map((item) => (
          <div key={item.id} className={`auction-toast ${item.type || "info"}`}>
            <span>{item.text}</span>
            <button type="button" onClick={() => dismissToast(item.id)} aria-label="Скрыть уведомление">
              ✕
            </button>
          </div>
        ))}
      </div>
    );
  };

  const renderCriticalAlert = () => {
    if (!criticalAlert) return null;
    return (
      <div className="critical-alert" role="alertdialog" aria-modal="true">
        <div className="sheet-backdrop" onClick={closeCriticalAlert} />
        <div className="critical-card">
          <strong>Что-то пошло не так</strong>
          <p>{criticalAlert.text}</p>
          <button
            type="button"
            className="accent-btn"
            onClick={() => {
              criticalAlert.onAction?.();
              closeCriticalAlert();
            }}
          >
            {criticalAlert.actionLabel || "OK"}
          </button>
        </div>
      </div>
    );
  };

  const renderDock = () => {
    if (showLanding) return null;
    return (
      <nav className="auction-dock" aria-label="Основные действия">
        <button
          type="button"
          className="dock-icon"
          aria-label="Игроки"
          onClick={() => setPlayersModalOpen(true)}
        >
          👥
        </button>
        <button
          type="button"
          className="dock-cta"
          onClick={primaryActionHandler}
          disabled={primaryActionDisabled}
        >
          {primaryActionLabel}
        </button>
        <button
          type="button"
          className="dock-icon"
          aria-label="История"
          onClick={() => setHistoryModalOpen(true)}
        >
          🕘
        </button>
        <button type="button" className="dock-icon" aria-label="Выход" onClick={handleExit}>
          ↩
        </button>
      </nav>
    );
  };

  const renderOwnerFab = () => {
    if (!isOwner || showLanding) return null;
    const ownerLabel = showLobby ? "Старт" : showResult ? "Реванш" : "Следующий";
    const ownerAction = showLobby || showResult ? handleStartAuction : forceNext;
    return (
      <button type="button" className="owner-fab" onClick={ownerAction}>
        {ownerLabel}
      </button>
    );
  };

  const activeStageCard = showLobby
    ? renderLobbyCard()
    : showGame
    ? renderLotCard()
    : renderResultsCard();

  return (
    <div className="auction-app">
      <div className="ambient" aria-hidden="true" />
      {showLanding ? (
        renderLanding()
      ) : (
        <>
          {renderTopBar()}
          <div className="stage-layout">
            <div className="stage-primary">{activeStageCard}</div>
            <div className="stage-rail">
              {renderHistoryTimeline()}
              {renderPlayersGridSection()}
            </div>
          </div>
          {renderDock()}
          {renderOwnerFab()}
        </>
      )}
      {renderToastStack()}
      {renderCriticalAlert()}
      {renderBasketSheet()}
      {renderPlayersModal()}
      {renderHistoryModal()}
      {renderConfigWizard()}
    </div>
  );
}
