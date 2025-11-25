import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import io from "socket.io-client";
import "./Auction.css";

const INITIAL_BANK = 1_000_000;
const CODE_ALPHABET_RE = /[^A-HJKMNPQRSTUVWXYZ23456789]/g;
const BID_PRESETS = [1_000, 5_000, 10_000, 25_000, 50_000];
const AUCTION_GAME = "AUCTION";
const MIN_SLOTS = 10;
const MAX_SLOTS = 50;
const MIN_BUDGET = 100_000;
const MAX_BUDGET = 5_000_000;
const BUDGET_STEP = 50_000;
const COUNTDOWN_STEP_MS = 4_000;
const COUNTDOWN_START_FROM = 3;
const PHASE_LABEL: Record<string, string> = {
  lobby: "╨Ы╨╛╨▒╨▒╨╕",
  in_progress: "╨в╨╛╤А╨│╨╕",
  finished: "╨Ш╤В╨╛╨│╨╕",
};

const PHASE_EMOJI: Record<string, string> = {
  lobby: "ЁЯСе",
  in_progress: "тЪФя╕П",
  finished: "ЁЯПБ",
};

function normalizeCode(value = "") {
  return value.toUpperCase().replace(CODE_ALPHABET_RE, "").slice(0, 6);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

const EMPTY_ARRAY: any[] = Object.freeze([]);
const EMPTY_OBJECT: Record<string, unknown> = Object.freeze({});

function ensureArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : EMPTY_ARRAY;
}

function ensurePlainObject<T extends object>(value: unknown): T {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as T;
  }
  return EMPTY_OBJECT as T;
}

const SERVER_ERROR_MESSAGES: Record<string, string> = {
  initData_required: "╨Ю╤В╨║╤А╨╛╨╣ ╨╕╨│╤А╤Г ╨╕╨╖ Telegram тАФ ╨╜╨╡╤В initData.",
  bad_signature: "╨Я╨╛╨┤╨┐╨╕╤Б╤М Telegram ╨╜╨╡ ╤Б╨╛╤И╨╗╨░╤Б╤М. ╨Ч╨░╨┐╤Г╤Б╤В╨╕ ╨╕╨│╤А╤Г ╨╖╨░╨╜╨╛╨▓╨╛ ╨╕╨╖ ╨▒╨╛╤В╨░.",
  stale_init_data: "╨б╨╡╤Б╤Б╨╕╤П Telegram ╤Г╤Б╤В╨░╤А╨╡╨╗╨░. ╨Ю╤В╨║╤А╨╛╨╣ ╨╕╨│╤А╤Г ╨╖╨░╨╜╨╛╨▓╨╛ ╨╕╨╖ Telegram.",
  code_already_in_use: "╨Ъ╨╛╨┤ ╨║╨╛╨╝╨╜╨░╤В╤Л ╤Г╨╢╨╡ ╨╕╤Б╨┐╨╛╨╗╤М╨╖╤Г╨╡╤В╤Б╤П",
  room_not_found: "╨Ъ╨╛╨╝╨╜╨░╤В╨░ ╨╜╨╡ ╨╜╨░╨╣╨┤╨╡╨╜╨░",
  room_full: "╨Ъ╨╛╨╝╨╜╨░╤В╨░ ╨╖╨░╨┐╨╛╨╗╨╜╨╡╨╜╨░",
  game_in_progress: "╨Ш╨│╤А╨░ ╤Г╨╢╨╡ ╨╕╨┤╤С╤В",
  wrong_game: "╨н╤В╨░ ╤Б╤Б╤Л╨╗╨║╨░ ╨┤╨╗╤П ╨┤╤А╤Г╨│╨╛╨╣ ╨╕╨│╤А╤Л",
};

function mapServerError(code: string | undefined, status: number, fallback: string) {
  if (status === 429) return "╨б╨╗╨╕╤И╨║╨╛╨╝ ╨╝╨╜╨╛╨│╨╛ ╨┐╨╛╨┐╤Л╤В╨╛╨║. ╨Я╨╛╨┐╤А╨╛╨▒╤Г╨╣╤В╨╡ ╤З╤Г╤В╤М ╨┐╨╛╨╖╨╢╨╡.";
  if (status === 401 && (!code || code === "failed")) {
    return SERVER_ERROR_MESSAGES.stale_init_data;
  }
  if (!code) return fallback;
  return SERVER_ERROR_MESSAGES[code] || fallback;
}

function playerDisplayName(player: any) {
  if (!player) return "╨Ш╨│╤А╨╛╨║";
  return (
    player.user?.first_name ||
    player.user?.username ||
    (player.id != null ? `╨Ш╨│╤А╨╛╨║ ${player.id}` : "╨Ш╨│╤А╨╛╨║")
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
}: {
  apiBase: string;
  initData?: string;
  goBack?: () => void;
  onProgress?: () => void;
  setBackHandler?: (fn: (() => void) | null) => void;
  autoJoinCode?: string;
  onInviteConsumed?: (code: string) => void;
}) {
  const [socket, setSocket] = useState<any>(null);
  const socketRef = useRef<any>(null);
  const [connecting, setConnecting] = useState(false);

  const [room, setRoom] = useState<any>(null);
  const [players, setPlayers] = useState<any[]>([]);
  const [selfInfo, setSelfInfo] = useState<any>(null);
  const [viewerIsOwner, setViewerIsOwner] = useState(false);
  const [auctionState, setAuctionState] = useState<any>(null);

  const [creating, setCreating] = useState(false);
  const [joining, setJoining] = useState(false);
  const [codeInput, setCodeInput] = useState("");
  const [error, setError] = useState("");
  const [toastStack, setToastStack] = useState<
    { id: string; text: string; type?: "error" | "info"; duration?: number }[]
  >([]);

  const [busyBid, setBusyBid] = useState(false);
  const [myBid, setMyBid] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSlots, setSettingsSlots] = useState<number>(30);
  const [settingsBudget, setSettingsBudget] = useState<number>(INITIAL_BANK);
  const [savingSettings, setSavingSettings] = useState(false);
  const [settingsDirty, setSettingsDirty] = useState(false);
  const [basketPlayerId, setBasketPlayerId] = useState<number | null>(null);
  const lastSyncedSettingsRef = useRef({
    slots: settingsSlots,
    budget: settingsBudget,
  });

  const deadlineAtRef = useRef<number | null>(null);
  const pauseLeftRef = useRef<number | null>(null);
  const [nowTick, setNowTick] = useState(() => Date.now());
  const toastTimersRef = useRef<Map<string, any>>(new Map());
  const lastSubscribedCodeRef = useRef<string | null>(null);
  const lastSubscriptionSocketIdRef = useRef<string | null>(null);
  const progressSentRef = useRef(false);
  const lastBidAtRef = useRef(0);

  const moneyFormatter = useMemo(() => new Intl.NumberFormat("ru-RU"), []);
  const sanitizedAutoCode = useMemo(
    () => normalizeCode(autoJoinCode || ""),
    [autoJoinCode]
  );

  const phase: "lobby" | "in_progress" | "finished" | string =
    auctionState?.phase || "lobby";
  const paused = !!auctionState?.paused;
  const isBiddingLocked = paused || phase !== "in_progress";
  const myPlayerId = selfInfo?.roomPlayerId ?? null;

  const balances = useMemo(
    () => ensurePlainObject<Record<number, number>>(auctionState?.balances),
    [auctionState?.balances]
  );
  const basketTotals = useMemo(
    () => ensurePlainObject<Record<number, number>>(auctionState?.basketTotals),
    [auctionState?.basketTotals]
  );
  const baskets = useMemo(() => {
    const source = ensurePlainObject<Record<string, any[]>>(auctionState?.baskets);
    const map: Record<number, any[]> = {};
    Object.entries(source).forEach(([pid, items]) => {
      const id = Number(pid);
      if (!Number.isFinite(id)) return;
      map[id] = ensureArray<any>(items);
    });
    return map;
  }, [auctionState?.baskets]);
  const myBalance = myPlayerId != null ? balances[myPlayerId] ?? null : null;
  const safePlayers = useMemo(
    () => ensureArray<any>(players).filter(Boolean),
    [players]
  );

  const currentBids = useMemo(
    () => ensurePlainObject<Record<number, number>>(auctionState?.currentBids),
    [auctionState?.currentBids]
  );
  const myRoundBid = useMemo(() => {
    if (myPlayerId == null) return null;
    const value = currentBids[myPlayerId];
    return typeof value === "number" ? value : null;
  }, [currentBids, myPlayerId]);
  const leadingBid = useMemo(() => {
    let topAmount: number | null = null;
    let topPlayerId: number | null = null;
    Object.entries(currentBids || {}).forEach(([pid, val]) => {
      const num = Number(val);
      if (!Number.isFinite(num) || num < 0) return;
      if (topAmount == null || num > topAmount) {
        topAmount = num;
        topPlayerId = Number(pid);
      }
    });
    return topAmount != null && topPlayerId != null
      ? { amount: topAmount, playerId: topPlayerId }
      : null;
  }, [currentBids]);

  const leadingPlayerName = useMemo(() => {
    if (!leadingBid?.playerId) return null;
    const p = safePlayers.find((pl) => pl.id === leadingBid.playerId);
    return p ? playerDisplayName(p) : null;
  }, [leadingBid?.playerId, safePlayers]);

  const currentSlot = auctionState?.currentSlot || null;
  const baseBid = currentSlot?.basePrice || 0;
  const slotIndex =
    currentSlot && typeof currentSlot.index === "number"
      ? currentSlot.index + 1
      : null;
  const lotEmoji = useMemo(() => {
    const name = currentSlot?.name || "";
    const match = name.match(/([\u{1F300}-\u{1FAFF}])/u);
    if (match?.[0]) return match[0];
    return currentSlot?.type === "lootbox" ? "ЁЯОБ" : "ЁЯПЖ";
  }, [currentSlot?.name, currentSlot?.type]);

  const heroBidText = useMemo(() => {
    if (leadingBid?.amount != null) {
      return leadingPlayerName
        ? `${moneyFormatter.format(leadingBid.amount)}$ ┬╖ ${leadingPlayerName}`
        : `${moneyFormatter.format(leadingBid.amount)}$`;
    }
    return `╨С╨░╨╖╨░ ${moneyFormatter.format(baseBid)}$`;
  }, [baseBid, leadingBid?.amount, leadingPlayerName, moneyFormatter]);

  const quickBidButtons = useMemo(
    () => [
      ...BID_PRESETS.map((step, idx) => ({
        key: `${idx + 1}`,
        label: `+${moneyFormatter.format(step)}$`,
        action: () => setBidRelative(step),
        disabled: isBiddingLocked || busyBid || myBalance == null || myBalance <= 0,
      })),
      {
        key: "A",
        label: "╨Т╤Б╤С",
        action: () => setBidRelative(myBalance || 0),
        disabled: isBiddingLocked || busyBid || myBalance == null || myBalance <= 0,
      },
      { key: "P", label: "╨Я╨░╤Б", action: sendPass, disabled: isBiddingLocked || busyBid },
    ],
    [busyBid, isBiddingLocked, moneyFormatter, myBalance, sendPass, setBidRelative]
  );

  const countdownStepMs = useMemo(() => {
    const raw = Number(auctionState?.countdownStepMs);
    return Number.isFinite(raw) && raw > 0 ? raw : COUNTDOWN_STEP_MS;
  }, [auctionState?.countdownStepMs]);

  const countdownStartFrom = useMemo(() => {
    const raw = Number(auctionState?.countdownStartFrom);
    return Number.isFinite(raw) && raw > 0 ? raw : COUNTDOWN_START_FROM;
  }, [auctionState?.countdownStartFrom]);

  const countdownLeft = useMemo(() => {
    if (countdownStepMs <= 0) return null;
    if (paused) {
      const ms = pauseLeftRef.current ?? (auctionState?.timeLeftMs ?? null);
      if (ms == null) return null;
      return Math.max(0, Math.ceil(ms / countdownStepMs));
    }
    if (!deadlineAtRef.current) return null;
    const diffMs = deadlineAtRef.current - nowTick;
    return Math.max(0, Math.ceil(diffMs / countdownStepMs));
  }, [auctionState?.timeLeftMs, countdownStepMs, nowTick, paused]);

  const heroCountdown =
    !paused && countdownLeft != null && countdownLeft >= 0
      ? Math.min(countdownStartFrom, countdownLeft)
      : null;
  const countdownStepSec = countdownStepMs / 1000;
  const slotMax = useMemo(() => {
    const raw =
      auctionState?.maxSlots ??
      auctionState?.rules?.maxSlots ??
      auctionState?.totalSlots ??
      (Array.isArray(auctionState?.slots) ? auctionState.slots.length : null);
    const num = Number(raw);
    return Number.isFinite(num) && num > 0 ? num : null;
  }, [
    auctionState?.maxSlots,
    auctionState?.rules?.maxSlots,
    auctionState?.totalSlots,
    auctionState?.slots,
  ]);

  const initialBank = auctionState?.rules?.initialBalance || INITIAL_BANK;
  const slotsProgress = useMemo(
    () =>
      ((clamp(settingsSlots, MIN_SLOTS, MAX_SLOTS) - MIN_SLOTS) /
        (MAX_SLOTS - MIN_SLOTS)) *
      100,
    [settingsSlots]
  );
  const budgetProgress = useMemo(
    () =>
      ((clamp(settingsBudget, MIN_BUDGET, MAX_BUDGET) - MIN_BUDGET) /
        (MAX_BUDGET - MIN_BUDGET)) *
      100,
    [settingsBudget]
  );

  useEffect(() => {
    if (settingsOpen) return;
    const nextSlots =
      slotMax && slotMax > 0
        ? slotMax
        : Array.isArray(auctionState?.slots)
        ? auctionState.slots.length || 30
        : 30;
    setSettingsSlots(clamp(nextSlots, MIN_SLOTS, MAX_SLOTS));
  }, [slotMax, auctionState?.slots, settingsOpen]);

  useEffect(() => {
    if (settingsOpen) return;
    setSettingsBudget(
      clamp(initialBank || INITIAL_BANK, MIN_BUDGET, MAX_BUDGET)
    );
  }, [initialBank, settingsOpen]);

  useEffect(() => {
    const nextSlots = clamp(
      Math.round(
        Number(
          slotMax ??
            (Array.isArray(auctionState?.slots)
              ? auctionState.slots.length
              : null) ??
            lastSyncedSettingsRef.current.slots ??
            MIN_SLOTS
        ) || MIN_SLOTS
      ),
      MIN_SLOTS,
      MAX_SLOTS
    );
    const nextBudget = clamp(
      Math.round(
        Number(
          auctionState?.rules?.initialBalance ??
            initialBank ??
            lastSyncedSettingsRef.current.budget ??
            MIN_BUDGET
        ) || MIN_BUDGET
      ),
      MIN_BUDGET,
      MAX_BUDGET
    );
    const { slots: prevSlots, budget: prevBudget } =
      lastSyncedSettingsRef.current;
    if (prevSlots !== nextSlots || prevBudget !== nextBudget) {
      lastSyncedSettingsRef.current = { slots: nextSlots, budget: nextBudget };
      if (!settingsOpen || !settingsDirty) {
        setSettingsSlots(nextSlots);
        setSettingsBudget(nextBudget);
        setSettingsDirty(false);
      }
    }
  }, [
    auctionState?.rules?.initialBalance,
    auctionState?.slots,
    initialBank,
    slotMax,
    settingsDirty,
    settingsOpen,
  ]);

  const netWorths = useMemo(() => {
    const fromState = ensurePlainObject<Record<number, number>>(
      auctionState?.netWorths
    );
    const ids = new Set<number>([
      ...safePlayers.map((p) => p.id).filter((id) => id != null),
      ...Object.keys(balances).map((k) => Number(k)),
      ...Object.keys(basketTotals).map((k) => Number(k)),
    ]);
    const map: Record<number, number> = {};
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

  const basketPlayer = useMemo(
    () =>
      basketPlayerId != null
        ? safePlayers.find((p) => p.id === basketPlayerId) || null
        : null,
    [basketPlayerId, safePlayers]
  );
  const basketItems = useMemo(
    () =>
      basketPlayerId != null ? baskets[basketPlayerId] || EMPTY_ARRAY : EMPTY_ARRAY,
    [basketPlayerId, baskets]
  );

  const safeHistory = useMemo(
    () =>
      ensureArray<any>(auctionState?.history).filter(
        (slot) => slot && typeof slot.index === "number"
      ),
    [auctionState?.history]
  );
  const lastFinishedSlot = useMemo(
    () => (safeHistory.length ? safeHistory[safeHistory.length - 1] : null),
    [safeHistory]
  );

  const winners = useMemo(
    () => ensureArray<number>(auctionState?.winners),
    [auctionState?.winners]
  );

  const totalBank = useMemo(() => {
    return Object.values(netWorths).reduce(
      (sum, value) => sum + (Number(value) || 0),
      0
    );
  }, [netWorths]);

  const showLanding = !room;
  const showLobby = !showLanding && phase === "lobby";
  const showGame = !showLanding && phase === "in_progress";
  const showResults = !showLanding && phase === "finished";

  // ---------- TO╨РSTS ----------

  const dismissToast = useCallback((id: string) => {
    if (!id) return;
    setToastStack((prev) => prev.filter((t) => t.id !== id));
    const timer = toastTimersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      toastTimersRef.current.delete(id);
    }
  }, []);

  const pushToast = useCallback(
    (payload: { id?: string; text: string; type?: "error" | "info"; duration?: number }) => {
      if (!payload.text) return null;
      const id =
        payload.id || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
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
    (message?: string) => {
      const text = message || "╨з╤В╨╛-╤В╨╛ ╨┐╨╛╤И╨╗╨╛ ╨╜╨╡ ╤В╨░╨║";
      setError(text);
      pushToast({ type: "error", text, duration: 3600 });
    },
    [pushToast]
  );

  const clearError = useCallback(() => setError(""), []);

  // ---------- SOCKET SUBSCRIBE ----------

  const subscribeToRoom = useCallback(
    (rawCode: string, options: { force?: boolean } = {}) => {
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
          : window.confirm("╨в╨╛╤А╨│╨╕ ╨╕╨┤╤Г╤В. ╨Т╤Л╨╣╤В╨╕ ╨╕╨╖ ╨║╨╛╨╝╨╜╨░╤В╤Л?");
      if (!ok) return;
    }
    try {
      await leaveRoom();
    } finally {
      goBack?.();
    }
  }, [phase, leaveRoom, goBack]);

  useEffect(() => {
    if (basketPlayerId != null && !safePlayers.some((p) => p.id === basketPlayerId)) {
      setBasketPlayerId(null);
    }
  }, [basketPlayerId, safePlayers]);

  // ---------- EFFECTS ----------

  // ╨в╨░╨╣╨╝╨╡╤А ╤А╨░╤Г╨╜╨┤╨░
  useEffect(() => {
    const rawLeft = auctionState?.timeLeftMs;
    const rawServerNow =
      auctionState?.serverNowMs ??
      auctionState?.serverNow ??
      auctionState?.syncedAt ??
      null;
    const serverNowMs =
      typeof rawServerNow === "number" && Number.isFinite(rawServerNow)
        ? rawServerNow
        : null;
    const rawDeadline =
      paused || phase !== "in_progress"
        ? null
        : auctionState?.slotDeadlineAtMs ?? auctionState?.slotDeadlineAt ?? null;
    const slotDeadlineMs =
      typeof rawDeadline === "number" && Number.isFinite(rawDeadline)
        ? rawDeadline
        : null;

    if (rawLeft == null && slotDeadlineMs == null) {
      deadlineAtRef.current = null;
      pauseLeftRef.current = null;
      return;
    }

    let leftMs: number | null = null;

    if (!paused && slotDeadlineMs != null && serverNowMs != null) {
      leftMs = Math.max(0, slotDeadlineMs - serverNowMs);
    }

    if (leftMs == null && rawLeft != null) {
      const numeric = Number(rawLeft);
      if (Number.isFinite(numeric)) {
        leftMs = Math.max(0, numeric);
      }
    }

    if (leftMs == null) {
      deadlineAtRef.current = null;
      pauseLeftRef.current = null;
      return;
    }

    if (!paused && serverNowMs != null) {
      const transitLag = Math.max(0, Date.now() - serverNowMs);
      leftMs = Math.max(0, leftMs - transitLag);
    }

    if (paused) {
      pauseLeftRef.current = leftMs;
      deadlineAtRef.current = null;
      setNowTick(Date.now());
      return;
    }

    pauseLeftRef.current = null;
    deadlineAtRef.current = Date.now() + leftMs;
    setNowTick(Date.now());
  }, [
    auctionState?.timeLeftMs,
    auctionState?.slotDeadlineAtMs,
    auctionState?.slotDeadlineAt,
    auctionState?.serverNowMs,
    auctionState?.serverNow,
    auctionState?.syncedAt,
    paused,
    phase,
  ]);

  useEffect(() => {
    if (!deadlineAtRef.current || paused) return;
    const tick = () => setNowTick(Date.now());
    tick();
    const timer = setInterval(tick, 200);
    return () => clearInterval(timer);
  }, [
    auctionState?.phase,
    auctionState?.timeLeftMs,
    auctionState?.slotDeadlineAtMs,
    auctionState?.slotDeadlineAt,
    auctionState?.serverNowMs,
    paused,
  ]);

  // ╨б╨╛╨╖╨┤╨░╨╜╨╕╨╡ socket.io
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

    instance.on("connect_error", (err: any) => {
      setConnecting(false);
      pushError(
        `╨Э╨╡ ╤Г╨┤╨░╨╗╨╛╤Б╤М ╨┐╨╛╨┤╨║╨╗╤О╤З╨╕╤В╤М╤Б╤П: ${err?.message || "╨╛╤И╨╕╨▒╨║╨░ ╤Б╨╛╨╡╨┤╨╕╨╜╨╡╨╜╨╕╤П"}`
      );
    });

    instance.on("toast", (payload: any) => {
      if (!payload?.text) return;
      if (payload.type === "error") {
        pushError(payload.text);
        return;
      }
      pushToast(payload);
    });

    instance.on("room:state", (payload: any) => {
      if (!payload) return;
      setRoom(payload.room || null);
      setPlayers(payload.players || []);
      if (typeof payload.viewerIsOwner === "boolean") {
        setViewerIsOwner(payload.viewerIsOwner);
      }
      clearError();
    });

    instance.on("private:self", (payload: any) => {
      if (!payload) return;
      setSelfInfo(payload);
    });

    instance.on("auction:state", (state: any) => {
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
  }, [apiBase, initData, pushError, pushToast, clearError, subscribeToRoom]);

  // ╨Я╨╛╨┤╨┐╨╕╤Б╨║╨░ ╨┐╨╛ ╨║╨╛╨┤╤Г ╨║╨╛╨╝╨╜╨░╤В╤Л
  useEffect(() => {
    if (!room?.code) return;
    subscribeToRoom(room.code);
  }, [room?.code, subscribeToRoom]);

  // ╨Ю╨▒╤А╨░╨▒╨╛╤В╤З╨╕╨║ ╤Б╨╕╤Б╤В╨╡╨╝╨╜╨╛╨╣ "╨╜╨░╨╖╨░╨┤"
  useEffect(() => {
    if (!setBackHandler) return;
    const handler = () => {
      handleExit();
    };
    setBackHandler(handler);
    return () => setBackHandler(null);
  }, [setBackHandler, handleExit]);

  // ╨Р╨▓╤В╨╛╨▓╤Е╨╛╨┤ ╨┐╨╛ ╤Б╤Б╤Л╨╗╨║╨╡ (autoJoinCode)
  useEffect(() => {
    if (!socket) return;
    if (!sanitizedAutoCode) return;
    joinRoom(sanitizedAutoCode, { fromInvite: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socket, sanitizedAutoCode]);

  // ╨Ю╤З╨╕╤Б╤В╨║╨░ ╤В╨░╨╣╨╝╨╡╤А╨╛╨▓ ╤В╨╛╤Б╤В╨╛╨▓
  useEffect(
    () => () => {
      toastTimersRef.current.forEach((timeout) => clearTimeout(timeout));
      toastTimersRef.current.clear();
    },
    []
  );

  // ╨б╨╛╨▒╤Л╤В╨╕╨╡ ╨╖╨░╨▓╨╡╤А╤И╨╡╨╜╨╕╤П
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

  // ╨Я╤А╨╡╨┤╨╖╨░╨┐╨╛╨╗╨╜╨╡╨╜╨╕╨╡ ╨╕╨╜╨┐╤Г╤В╨░ ╨║╨╛╨┤╨╛╨╝ ╨╕╨╖ ╨░╨▓╤В╨╛-╨┐╤А╨╕╨│╨╗╨░╤И╨╡╨╜╨╕╤П
  useEffect(() => {
    if (!sanitizedAutoCode || room || codeInput) return;
    setCodeInput(sanitizedAutoCode);
  }, [sanitizedAutoCode, room, codeInput]);

  // ---------- API / ACTIONS ----------

  async function createRoom() {
    if (!initData) {
      pushError("╨Э╨╡╤В initData ╨╕╨╖ Telegram");
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
        const code = (data as any)?.error || (data as any)?.message || "failed";
        pushError(
          mapServerError(code, resp.status, "╨Э╨╡ ╤Г╨┤╨░╨╗╨╛╤Б╤М ╤Б╨╛╨╖╨┤╨░╤В╤М ╨║╨╛╨╝╨╜╨░╤В╤Г")
        );
        return;
      }
      setRoom((data as any).room || null);
      setPlayers((data as any).players || []);
      setViewerIsOwner(true);
      if ((data as any).room?.code) {
        setCodeInput((data as any).room.code);
        subscribeToRoom((data as any).room.code, { force: true });
      }
    } catch {
      pushError("╨Э╨╡ ╤Г╨┤╨░╨╗╨╛╤Б╤М ╤Б╨╛╨╖╨┤╨░╤В╤М ╨║╨╛╨╝╨╜╨░╤В╤Г, ╨┐╨╛╨┐╤А╨╛╨▒╤Г╨╣╤В╨╡ ╨╡╤Й╤С ╤А╨░╨╖");
    } finally {
      setCreating(false);
    }
  }

  async function joinRoom(rawCode?: string, options: { fromInvite?: boolean } = {}) {
    if (!initData) {
      pushError("╨Э╨╡╤В initData ╨╕╨╖ Telegram");
      return;
    }
    const code = normalizeCode(rawCode || codeInput);
    if (!code) {
      pushError("╨Т╨▓╨╡╨┤╨╕╤В╨╡ ╨║╨╛╨┤ ╨║╨╛╨╝╨╜╨░╤В╤Л");
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
        body: JSON.stringify({ game: AUCTION_GAME }),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        const codeErr =
          (data as any)?.error || (data as any)?.message || "failed";
        pushError(
          mapServerError(codeErr, resp.status, "╨Э╨╡ ╤Г╨┤╨░╨╗╨╛╤Б╤М ╨▓╨╛╨╣╤В╨╕ ╨▓ ╨║╨╛╨╝╨╜╨░╤В╤Г")
        );
        return;
      }
      setRoom((data as any).room || null);
      setPlayers((data as any).players || []);
      setViewerIsOwner(!!(data as any).viewerIsOwner);
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
      pushError("╨Э╨╡ ╤Г╨┤╨░╨╗╨╛╤Б╤М ╨▓╨╛╨╣╤В╨╕ ╨▓ ╨║╨╛╨╝╨╜╨░╤В╤Г");
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
      (resp: any) => {
        if (!resp || !resp.ok) {
          pushError("╨Э╨╡ ╤Г╨┤╨░╨╗╨╛╤Б╤М ╨╕╨╖╨╝╨╡╨╜╨╕╤В╤М ╤Б╤В╨░╤В╤Г╤Б");
        }
      }
    );
  }

  function handleStartAuction() {
    if (!socket || !room || !isOwner) return;
    socket.emit(
      "auction:start",
      { code: room.code, game: AUCTION_GAME },
      (resp: any) => {
        if (!resp || !resp.ok) {
          const map: Record<string, string> = {
            room_not_found: "╨Ъ╨╛╨╝╨╜╨░╤В╨░ ╨╜╨╡ ╨╜╨░╨╣╨┤╨╡╨╜╨░",
            forbidden_not_owner: "╨в╨╛╨╗╤М╨║╨╛ ╨▓╨╗╨░╨┤╨╡╨╗╨╡╤Ж ╨╝╨╛╨╢╨╡╤В ╨╜╨░╤З╨░╤В╤М ╨╕╨│╤А╤Г",
            need_at_least_2_players: "╨Э╤Г╨╢╨╜╨╛ ╨╝╨╕╨╜╨╕╨╝╤Г╨╝ 2 ╨╕╨│╤А╨╛╨║╨░",
            need_ready_players: "╨Э╤Г╨╢╨╜╨╛, ╤З╤В╨╛╨▒╤Л ╨▓╤Б╨╡ ╨╛╤В╨╝╨╡╤В╨╕╨╗╨╕╤Б╤М ┬л╨│╨╛╤В╨╛╨▓┬╗",
            already_started: "╨Р╤Г╨║╤Ж╨╕╨╛╨╜ ╤Г╨╢╨╡ ╨╖╨░╨┐╤Г╤Й╨╡╨╜",
            wrong_game: "╨н╤В╨╛ ╨║╨╛╨╝╨╜╨░╤В╨░ ╨┤╤А╤Г╨│╨╛╨│╨╛ ╤А╨╡╨╢╨╕╨╝╨░",
          };
          pushError(map[resp?.error] || "╨Э╨╡ ╤Г╨┤╨░╨╗╨╛╤Б╤М ╨╖╨░╨┐╤Г╤Б╤В╨╕╤В╤М ╨░╤Г╨║╤Ж╨╕╨╛╨╜");
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
      const numericPrev = Number(String(prev).replace(/\s/g, "")) || 0;
      const baseline =
        numericPrev > 0 ? numericPrev : baseBid > 0 ? baseBid : 0;
      const max = myBalance ?? initialBank;
      const next = delta === 0 ? baseline : baseline + delta;
      return String(clamp(next, 0, max));
    });
  }

  const openSettings = useCallback(() => {
    const { slots, budget } = lastSyncedSettingsRef.current;
    setSettingsSlots(slots);
    setSettingsBudget(budget);
    setSettingsDirty(false);
    setSettingsOpen(true);
  }, []);

  const closeSettings = useCallback(() => {
    const { slots, budget } = lastSyncedSettingsRef.current;
    setSettingsSlots(slots);
    setSettingsBudget(budget);
    setSettingsDirty(false);
    setSettingsOpen(false);
  }, []);

  const handleSlotsChange = useCallback((value: number) => {
    setSettingsSlots(clamp(Math.round(value), MIN_SLOTS, MAX_SLOTS));
    setSettingsDirty(true);
  }, []);

  const handleBudgetChange = useCallback((value: number) => {
    const snapped = Math.round(value / BUDGET_STEP) * BUDGET_STEP;
    setSettingsBudget(clamp(snapped, MIN_BUDGET, MAX_BUDGET));
    setSettingsDirty(true);
  }, []);

  const applySettings = useCallback((slots: number, budget: number) => {
    const nextSlots = clamp(
      Math.round(Number(slots) || MIN_SLOTS),
      MIN_SLOTS,
      MAX_SLOTS
    );
    const nextBudget = clamp(
      Math.round(Number(budget) || MIN_BUDGET),
      MIN_BUDGET,
      MAX_BUDGET
    );
    setSettingsSlots(nextSlots);
    setSettingsBudget(nextBudget);
    setAuctionState((prev: any) => ({
      ...(prev || {}),
      maxSlots: nextSlots,
      totalSlots: nextSlots,
      rules: {
        ...(prev?.rules || {}),
        maxSlots: nextSlots,
        initialBalance: nextBudget,
      },
    }));
    lastSyncedSettingsRef.current = { slots: nextSlots, budget: nextBudget };
    setSettingsDirty(false);
  }, []);

  const saveSettings = useCallback(() => {
    if (!socket || !room || !isOwner) {
      pushError("╨Э╨░╤Б╤В╤А╨╛╨╣╨║╨╕ ╤Б╨╡╨╣╤З╨░╤Б ╨╜╨╡╨┤╨╛╤Б╤В╤Г╨┐╨╜╤Л.");
      return;
    }
    const nextSlots = clamp(
      Math.round(Number(settingsSlots) || 0),
      MIN_SLOTS,
      MAX_SLOTS
    );
    const nextBudget = clamp(
      Math.round(Number(settingsBudget) || 0),
      MIN_BUDGET,
      MAX_BUDGET
    );
    const previous = { ...lastSyncedSettingsRef.current };

    applySettings(nextSlots, nextBudget);
    setSavingSettings(true);
    setSettingsOpen(false);
    const timeoutId = setTimeout(() => {
      setSavingSettings(false);
      pushToast({
        type: "info",
        text: "╨Я╤А╨╕╨╝╨╡╨╜╨╕╨╗╨╕ ╨╗╨╛╨║╨░╨╗╤М╨╜╨╛, ╨╢╨┤╤С╨╝ ╨╛╤В╨▓╨╡╤В ╤Б╨╡╤А╨▓╨╡╤А╨░.",
        duration: 3200,
      });
    }, 4500);
    socket.emit(
      "auction:configure",
      {
        code: room.code,
        game: AUCTION_GAME,
        rules: { maxSlots: nextSlots, initialBalance: nextBudget },
      },
      (resp: any) => {
        clearTimeout(timeoutId);
        setSavingSettings(false);
        if (!resp || !resp.ok) {
          applySettings(previous.slots, previous.budget);
          pushError("╨Э╨╡ ╤Г╨┤╨░╨╗╨╛╤Б╤М ╤Б╨╛╤Е╤А╨░╨╜╨╕╤В╤М ╨╜╨░╤Б╤В╤А╨╛╨╣╨║╨╕.");
          return;
        }
        pushToast({ text: "╨Э╨░╤Б╤В╤А╨╛╨╣╨║╨╕ ╨╛╨▒╨╜╨╛╨▓╨╗╨╡╨╜╤Л" });
      }
    );
  }, [
    socket,
    room,
    isOwner,
    settingsSlots,
    settingsBudget,
    applySettings,
    pushError,
    pushToast,
  ]);

  function sendPass() {
    setMyBid("");
    sendBid(0);
  }

  function sendBid(forcedAmount?: number | null) {
    if (!socket || !room || !selfInfo) return;
    if (!auctionState || auctionState.phase !== "in_progress") return;
    if (paused) {
      pushToast({ type: "info", text: "Game is paused" });
      return;
    }

    const now = Date.now();
    if (now - lastBidAtRef.current < 800) {
      pushToast({ type: "error", text: "╨б╤В╨░╨▓╨║╨╕ ╤Б╨╗╨╕╤И╨║╨╛╨╝ ╤З╨░╤Б╤В╨╛" });
      return;
    }
    lastBidAtRef.current = now;

    const raw =
      forcedAmount != null
        ? String(forcedAmount)
        : String(myBid || "").replace(/\s/g, "");
    const amount = raw === "" ? 0 : Number(raw);

    if (!Number.isFinite(amount) || amount < 0) {
      pushError("╨Т╨▓╨╡╨┤╨╕╤В╨╡ ╨║╨╛╤А╤А╨╡╨║╤В╨╜╤Г╤О ╤Б╤Г╨╝╨╝╤Г");
      return;
    }
    if (myBalance != null && amount > myBalance) {
      pushError("╨б╤В╨░╨▓╨║╨░ ╨┐╤А╨╡╨▓╤Л╤И╨░╨╡╤В ╨▓╨░╤И ╨▒╨░╨╗╨░╨╜╤Б");
      return;
    }
    if (amount > 0 && baseBid > 0 && amount < baseBid) {
      pushError(`╨Ь╨╕╨╜╨╕╨╝╨░╨╗╤М╨╜╨░╤П ╤Б╤В╨░╨▓╨║╨░ ${moneyFormatter.format(baseBid)}$`);
      return;
    }

    setBusyBid(true);
    socket.emit(
      "auction:bid",
      { code: room.code, amount, game: AUCTION_GAME },
      (resp: any) => {
        setBusyBid(false);
        if (!resp || !resp.ok) {
          const map: Record<string, string> = {
            room_not_found: "╨Ъ╨╛╨╝╨╜╨░╤В╨░ ╨╜╨╡ ╨╜╨░╨╣╨┤╨╡╨╜╨░",
            not_running: "╨Р╤Г╨║╤Ж╨╕╨╛╨╜ ╨╡╤Й╤С ╨╜╨╡ ╨╖╨░╨┐╤Г╤Й╨╡╨╜",
            not_player: "╨Т╤Л ╨╜╨╡ ╨▓ ╨║╨╛╨╝╨╜╨░╤В╨╡",
            not_participant: "╨Т╤Л ╨╜╨╡ ╤Г╤З╨░╤Б╤В╨▓╤Г╨╡╤В╨╡",
            bad_amount: "╨Э╨╡╨▓╨╡╤А╨╜╨░╤П ╤Б╤Г╨╝╨╝╨░",
            not_enough_money: "╨Э╨╡╨┤╨╛╤Б╤В╨░╤В╨╛╤З╨╜╨╛ ╨┤╨╡╨╜╨╡╨│",
            paused: "╨Я╨░╤Г╨╖╨░",
            bid_below_base: "╨б╤В╨░╨▓╨║╨░ ╨╜╨╕╨╢╨╡ ╨▒╨░╨╖╨╛╨▓╨╛╨╣",
            wrong_game: "╨н╤В╨╛ ╨║╨╛╨╝╨╜╨░╤В╨░ ╨┤╤А╤Г╨│╨╛╨│╨╛ ╤А╨╡╨╢╨╕╨╝╨░",
          };
          pushError(map[resp?.error] || "╨Э╨╡ ╤Г╨┤╨░╨╗╨╛╤Б╤М ╨┐╤А╨╕╨╜╤П╤В╤М ╤Б╤В╨░╨▓╨║╤Г");
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
        pushToast({ type: "info", text: "╨Ъ╨╛╨┤ ╤Б╨║╨╛╨┐╨╕╤А╨╛╨▓╨░╨╜" });
      } else {
        pushToast({ type: "info", text: `╨Ъ╨╛╨┤: ${room.code}` });
      }
    } catch {
      pushToast({ type: "error", text: "╨Э╨╡ ╤Г╨┤╨░╨╗╨╛╤Б╤М ╤Б╨║╨╛╨┐╨╕╤А╨╛╨▓╨░╤В╤М" });
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
      if (typeof navigator !== "undefined" && navigator.share) {
        await navigator.share({
          text: `╨Ъ╨╛╨┤ ╨║╨╛╨╝╨╜╨░╤В╤Л: ${room.code}`,
          url: shareUrl || undefined,
        });
      } else if (
        typeof navigator !== "undefined" &&
        navigator.clipboard?.writeText
      ) {
        await navigator.clipboard.writeText(shareUrl || room.code);
      }
      pushToast({ type: "info", text: "╨б╤Б╤Л╨╗╨║╨░ ╤Б╨║╨╛╨┐╨╕╤А╨╛╨▓╨░╨╜╨░" });
    } catch {
      pushToast({ type: "error", text: "╨Э╨╡ ╤Г╨┤╨░╨╗╨╛╤Б╤М ╨┐╨╛╨┤╨╡╨╗╨╕╤В╤М╤Б╤П" });
    }
  }

  // ---------- RENDER ----------

  const renderLanding = () => (
    <div className="screen screen--landing">
      <motion.div
        className="landing-card"
        initial={{ opacity: 0, y: 24, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.35 }}
      >
        <div className="landing-card__head">
          <div className="landing-logo">
            <span className="landing-logo__primary">NEON</span>
            <span className="landing-logo__secondary">AUCTION</span>
          </div>
          <p className="landing-tagline">
            ╨Ь╨╛╨╗╨╜╨╕╨╡╨╜╨╛╤Б╨╜╤Л╨╡ ╤В╨╛╤А╨│╨╕ ╨┤╨╗╤П ╨▓╨░╤И╨╡╨╣ ╨║╨╛╨╝╨░╨╜╨┤╤Л ╨┐╤А╤П╨╝╨╛ ╨▓ Telegram.
          </p>
          <div className="landing-chips">
            <span className="pill pill--soft">
              <span>ЁЯСе</span> ╨┤╨╛ 16 ╨╕╨│╤А╨╛╨║╨╛╨▓
            </span>
            <span className="pill pill--soft">
              <span>тЪб</span> ╨▒╤Л╤Б╤В╤А╤Л╨╡ ╤А╨░╤Г╨╜╨┤╤Л
            </span>
            <span className="pill pill--soft">
              <span>ЁЯТ░</span> ╤Б╤В╨░╤А╤В╨╛╨▓╤Л╨╣ ╨▒╨░╨╜╨║{" "}
              {moneyFormatter.format(initialBank)}$
            </span>
          </div>
        </div>

        <div className="landing-form">
          <label className="field">
            <span className="field-label">╨Ъ╨╛╨┤ ╨║╨╛╨╝╨╜╨░╤В╤Л</span>
            <input
              className="text-input text-input--large"
              type="text"
              inputMode="text"
              autoComplete="off"
              maxLength={6}
              placeholder="╨Э╨░╨┐╤А╨╕╨╝╨╡╤А, 3F9K2B"
              value={codeInput}
              onChange={(e) => setCodeInput(normalizeCode(e.target.value))}
            />
          </label>

          {error && <div className="field-error">{error}</div>}

          <button
            type="button"
            className="btn btn--primary"
            onClick={() => joinRoom()}
            disabled={joining || !codeInput}
          >
            {joining ? "╨Я╨╛╨┤╨║╨╗╤О╤З╨░╨╡╨╝..." : "╨Т╨╛╨╣╤В╨╕ ╨┐╨╛ ╨║╨╛╨┤╤Г"}
          </button>

          <button
            type="button"
            className="btn btn--ghost"
            onClick={createRoom}
            disabled={creating}
          >
            {creating ? "╨б╨╛╨╖╨┤╨░╤С╨╝ ╨║╨╛╨╝╨╜╨░╤В╤Г..." : "╨б╨╛╨╖╨┤╨░╤В╤М ╨╜╨╛╨▓╤Г╤О ╨║╨╛╨╝╨╜╨░╤В╤Г"}
          </button>

          {connecting && (
            <div className="landing-connect">╨Я╨╛╨┤╨║╨╗╤О╤З╨░╨╡╨╝╤Б╤П ╨║ ╤Б╨╡╤А╨▓╨╡╤А╤Г...</div>
          )}
        </div>
      </motion.div>
    </div>
  );

  const renderHeader = () => {
    if (!room) return null;
    if (phase === "in_progress") return null; // ╤Б╨║╤А╤Л╨▓╨░╨╡╨╝ header ╨▓╨╛ ╨▓╤А╨╡╨╝╤П ╨╕╨│╤А╤Л

    const phaseLabel = PHASE_LABEL[phase] || "╨Р╤Г╨║╤Ж╨╕╨╛╨╜";
    const phaseEmoji = PHASE_EMOJI[phase] || "ЁЯОо";
    const playersOnline = safePlayers.length || 0;
    const playersLabel =
      playersOnline === 1
        ? "╨╕╨│╤А╨╛╨║"
        : playersOnline >= 5 || playersOnline === 0
        ? "╨╕╨│╤А╨╛╨║╨╛╨▓"
        : "╨╕╨│╤А╨╛╨║╨░";

    return (
      <header className="app-header">
        <button
          type="button"
          className="icon-btn icon-btn--ghost"
          aria-label="╨Я╨╛╨┤╨╡╨╗╨╕╤В╤М╤Б╤П"
          onClick={shareRoomCode}
        >
          ЁЯУи
        </button>
        <div className="app-header__center">
          <div className="app-header__eyebrow">
            <span className="chip chip--phase">
              <span className="chip__icon" aria-hidden="true">
                {phaseEmoji}
              </span>
              {phaseLabel}
            </span>
            <span className="app-header__meta">
              <span className="app-header__pulse" aria-hidden="true" />
              {playersOnline} {playersLabel}
            </span>
          </div>
          <div className="app-header__code-row">
            <button
              type="button"
              className="app-header__code"
              onClick={copyRoomCode}
            >
              <span className="app-header__code-label">╨Ъ╨╛╨┤</span>
              <span className="app-header__code-value">
                {room.code || "------"}
              </span>
            </button>
          </div>
        </div>
        <button
          type="button"
          className="icon-btn icon-btn--ghost app-header__close"
          aria-label="╨Т╤Л╨╣╤В╨╕"
          onClick={handleExit}
        >
          ├Ч
        </button>
      </header>
    );
  };

  const renderLobbyContent = () => {
    if (!showLobby) return null;

    const readyTarget = Math.max(totalPlayers || 1, 1);
    const myReady = !!currentPlayer?.ready;
    const canStart = readyCount >= readyTarget;

    const primaryLabel = isOwner
      ? "╨Э╨░╤З╨░╤В╤М ╨╕╨│╤А╤Г"
      : myReady
      ? "╨п ╨╜╨╡ ╨│╨╛╤В╨╛╨▓"
      : "╨п ╨│╨╛╤В╨╛╨▓";

    const primaryClassName = [
      "btn",
      "btn--compact",
      "bottom-bar__primary",
      isOwner ? "btn--power" : myReady ? "btn--ready" : "btn--not-ready",
    ]
      .filter(Boolean)
      .join(" ");

    const primaryIcon = isOwner ? (
      <span className="btn__icon btn__icon--power" aria-hidden="true">
        <svg viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path
            d="M10 2v6m3.95-4.95a7 7 0 1 1-7.9 0"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </svg>
      </span>
    ) : myReady ? (
      <span className="btn__icon btn__icon--ready" aria-hidden="true">
        <svg viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path
            d="M5 10.5l3 3 7-8"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
    ) : (
      <span className="btn__icon btn__icon--not-ready" aria-hidden="true">
        <svg viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path
            d="M10 4v6m0 4.5h.01"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
          <circle
            cx="10"
            cy="10"
            r="8"
            stroke="currentColor"
            strokeWidth="2"
          />
        </svg>
      </span>
    );

    const primaryAction = () => {
      if (isOwner) {
        if (!canStart) return;
        handleStartAuction();
      } else {
        toggleReady();
      }
    };

    // ╨┐╨╛╤А╤П╨┤╨╛╨║ ╨╕╨│╤А╨╛╨║╨╛╨▓ ╨▒╨╛╨╗╤М╤И╨╡ ╨╜╨╡ ╨╖╨░╨▓╨╕╤Б╨╕╤В ╨╛╤В ready тАФ ╨╛╨╜╨╕ ╨╜╨╡ ╨┐╤А╤Л╨│╨░╤О╤В
    const sortedPlayers = safePlayers.slice();
    const slotsDisplay =
      slotMax ??
      (Array.isArray(auctionState?.slots) && auctionState.slots.length > 0
        ? auctionState.slots.length
        : 30);

    return (
      <div className="screen-body lobby-layout">
        <section className="card card--lobby-top">
          <div className="card-row">
            <div className="lobby-header-main">
              <span className="label">╨Ъ╨╛╨╝╨╜╨░╤В╨░</span>
              <div className="lobby-header-main__row">
                <span className="lobby-header-main__players">
                  {totalPlayers} ╨╕╨│╤А╨╛╨║
                  {totalPlayers === 1 ? "" : "╨╛╨▓"}
                </span>
                <span className="lobby-header-main__code">
                  #{room?.code || "------"}
                </span>
              </div>
              <div className="lobby-header-progress">
                <div className="lobby-header-progress__top">
                  <span className="lobby-header-progress__label">
                    ╨У╨╛╤В╨╛╨▓╨╜╨╛╤Б╤В╤М
                  </span>
                  <span className="lobby-header-progress__value">
                    {readyCount}/{readyTarget}
                  </span>
                </div>
                <div className="progress progress--inline">
                  <div
                    className="progress__fill"
                    style={{
                      width: `${Math.max(6, readyPercent)}%`,
                    }}
                  />
                </div>
              </div>
            </div>
            {isOwner && (
              <button
                type="button"
                className="icon-btn icon-btn--ghost lobby-settings"
                aria-label="╨Э╨░╤Б╤В╤А╨╛╨╣╨║╨╕ ╨║╨╛╨╝╨╜╨░╤В╤Л"
                onClick={openSettings}
              >
                тЪЩя╕П
              </button>
            )}
          </div>

          <div className="lobby-stats">
            <div className="lobby-stat">
              <span className="lobby-stat__label">╨С╨░╨╜╨║ ╨╜╨░ ╨╕╨│╤А╨╛╨║╨░</span>
              <span className="lobby-stat__value">
                {moneyFormatter.format(initialBank)}$
              </span>
            </div>
            <div className="lobby-stat">
              <span className="lobby-stat__label">╨Ы╨╛╤В╨╛╨▓</span>
              <span className="lobby-stat__value">
                {slotsDisplay}
              </span>
            </div>
          </div>

          <p className="lobby-hint">
            {isOwner
              ? canStart
                ? "All set тАФ you can start even solo."
                : "Waiting for players to press ready."
              : myReady
              ? "You are ready, waiting for others."
              : "Press Ready to join from the start."}
          </p>
        </section>

        <section className="card card--lobby-players">
          <div className="card-row card-row--tight">
            <div>
              <span className="label">╨Ш╨│╤А╨╛╨║╨╕</span>
              <h3 className="title-small">╨б╨╛╤Б╤В╨░╨▓ ╨╗╨╛╨▒╨▒╨╕</h3>
            </div>
            <span className="pill pill--tiny">
              {readyCount}/{readyTarget} ╨│╨╛╤В╨╛╨▓╤Л
            </span>
          </div>
          <div className="lobby-players-list">
            {sortedPlayers.map((p) => {
              const name = playerDisplayName(p);
              const avatar = p.user?.photo_url || p.user?.avatar || null;
              const isHost = ownerPlayer?.id === p.id;
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
                    <div className="lobby-player__name">{name}</div>
                    <div className="lobby-player__tags">
                      {p.ready ? "╨У╨╛╤В╨╛╨▓" : "╨Ю╨╢╨╕╨┤╨░╨╜╨╕╨╡"}
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
                  {isHost && (
                    <span
                      className="chip chip--host"
                      aria-label="╨е╨╛╤Б╤В"
                      title="╨е╨╛╤Б╤В ╨║╨╛╨╝╨╜╨░╤В╤Л"
                    >
                      ЁЯСС
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        <div className="bottom-bar bottom-bar--lobby">
          <button
            type="button"
            className={primaryClassName}
            onClick={primaryAction}
            disabled={isOwner && !canStart}
          >
            {primaryIcon}
            {primaryLabel}
          </button>
        </div>
      </div>
    );
  };

  const renderGameContent = () => {
    if (!showGame) return null;
    return (
      <div className="screen-body game-layout">
        <section className="lot-hero card card--lot" aria-label="╨У╨╗╨░╨▓╨╜╤Л╨╣ ╨╗╨╛╤В">
          <div className="lot-hero__index">
            <div className="lot-index__meta">
              <span className="lot-index__num">
                {slotIndex != null ? `#${slotIndex}` : "-"}
              </span>
              <span className="lot-index__suffix">
                {slotMax ? `╨╕╨╖ ${slotMax}` : ""}
              </span>
            </div>
            <span className="lot-index__balance" aria-label="╨С╨░╨╗╨░╨╜╤Б">
              ЁЯТ▓ {myBalance != null ? moneyFormatter.format(myBalance) : "-"}
            </span>
          </div>
          <div className="lot-hero__name">
            {currentSlot?.name || "╨Э╨╡╤В ╨╜╨░╨╖╨▓╨░╨╜╨╕╤П"}
          </div>
          <div className="lot-hero__emoji-wrap">
            <AnimatePresence initial={false} mode="popLayout">
              {heroCountdown != null && (
                <motion.div
                  key={`${slotIndex ?? "lot"}-${heroCountdown}`}
                  className="lot-hero__timer"
                  initial={{ opacity: 0, scale: 0.6, y: -12 }}
                  animate={{
                    opacity: [0, 1, 1, 0],
                    scale: [0.6, 1, 1, 0.9],
                    y: [-12, 0, 0, 8],
                  }}
                  exit={{ opacity: 0, scale: 0.8, y: 10, transition: { duration: 0.12 } }}
                  transition={{
                    duration: countdownStepSec,
                    times: [0, 0.15, 0.85, 1],
                    ease: "easeInOut",
                  }}
                  aria-hidden="true"
                >
                  {heroCountdown}
                </motion.div>
              )}
            </AnimatePresence>
            <div className="lot-hero__emoji" aria-hidden="true">
              {lotEmoji}
            </div>
          </div>
          <div className="lot-hero__bid">
            {heroBidText}
          </div>
        </section>

        <section className="card card--bid">
          <span className="label">╨б╤В╨░╨▓╨║╨╕</span>

          {isBiddingLocked && (
            <div className="callout">
              {paused
                ? "Game is paused - bids are temporarily locked."
                : "Bids are available only while the round is running."}
            </div>
          )}

          <p className="bid-inline-hint">
            ╨Ш╤Б╨┐╨╛╨╗╤М╨╖╤Г╨╣╤В╨╡ ╨▒╤Л╤Б╤В╤А╤Л╨╡ ╨║╨╜╨╛╨┐╨║╨╕ ╨╕╨╗╨╕ ╨▓╨▓╨╡╨┤╨╕╤В╨╡ ╤Б╤Г╨╝╨╝╤Г ╨▓╤А╤Г╤З╨╜╤Г╤О.
          </p>

          <div className="bid-input-row">
            <input
              className="text-input"
              inputMode="numeric"
              placeholder="╨Т╨▓╨╡╨┤╨╕╤В╨╡ ╤Б╤В╨░╨▓╨║╤Г"
              value={myBid}
              onChange={(e) =>
                setMyBid(e.target.value.replace(/[^\d]/g, ""))
              }
            />
            <div className="quick-bids" aria-label="╨С╤Л╤Б╤В╤А╤Л╨╡ ╤Б╤В╨░╨▓╨║╨╕">
              {quickBidButtons.map((btn) => (
                <button
                  key={btn.key}
                  type="button"
                  className="quick-bid"
                  onClick={() => btn.action()}
                  disabled={btn.disabled}
                >
                  <span className="quick-bid__label">{btn.label}</span>
                  <span className="quick-bid__key">{btn.key}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="bid-actions">
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => setMyBid("")}
            >
              ╨Ю╤З╨╕╤Б╤В╨╕╤В╤М
            </button>
            <button
              type="button"
              className="btn btn--primary"
              onClick={() => sendBid()}
              disabled={busyBid || myBalance == null || isBiddingLocked}
            >
              {busyBid ? "╨Ю╤В╨┐╤А╨░╨▓╨╗╤П╨╡╨╝..." : "╨Ю╤В╨┐╤А╨░╨▓╨╕╤В╤М ╤Б╤В╨░╨▓╨║╤Г"}
            </button>
          </div>

          {isOwner && (
            <div className="owner-controls">
              <button
                type="button"
                className="pill pill--ghost"
                onClick={paused ? resumeAuction : pauseAuction}
              >
                {paused ? "╨Я╤А╨╛╨┤╨╛╨╗╨╢╨╕╤В╤М" : "╨Я╨░╤Г╨╖╨░"}
              </button>
              <button
                type="button"
                className="pill pill--ghost"
                onClick={forceNext}
              >
                ╨б╨╗╨╡╨┤╤Г╤О╤Й╨╕╨╣ ╨╗╨╛╤В
              </button>
            </div>
          )}
        </section>

                                                <section className="card card--players-live">
          <div className="card-row card-row--tight">
            <div>
              <span className="label">Игроки</span>
              <h3 className="title-small">Ставки и банк</h3>
              <p className="muted">Тап по игроку — откроется его корзина</p>
            </div>
            <span className="pill pill--tiny">{safePlayers.length} игроков</span>
          </div>

          <div className="lobby-players-list lobby-players-list--ingame">
            {safePlayers.length === 0 && (
              <div className="empty-note">Никого нет, ждём подключения.</div>
            )}
            {safePlayers.map((p) => {
              const name = playerDisplayName(p);
              const avatar = p.user?.photo_url || p.user?.avatar || "";
              const balance = balances[p.id] ?? 0;
              const bidValue = Number(currentBids[p.id] ?? 0) || null;
              const isHost = ownerPlayer?.id === p.id;
              const isLeading = leadingBid?.playerId === p.id;

              return (
                <button
                  key={p.id}
                  type="button"
                  className={[
                    "lobby-player",
                    "lobby-player-btn",
                    isHost ? "lobby-player--host" : "",
                    isLeading ? "lobby-player--ready" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  onClick={() => setBasketPlayerId(p.id)}
                >
                  <div className="lobby-player__avatar" aria-hidden>
                    {avatar ? <img src={avatar} alt={name} /> : name.slice(0, 1)}
                  </div>
                  <div className="lobby-player__body">
                    <div className="lobby-player__name">{name}</div>
                    <div className="lobby-player__tags">
                      {bidValue && bidValue > 0
                        ? `Ставка ${moneyFormatter.format(bidValue)}$ · Банк ${moneyFormatter.format(balance)}$`
                        : `Банк ${moneyFormatter.format(balance)}$`}
                    </div>
                  </div>
                  {isHost && (
                    <span className="chip chip--host" aria-label="Хост" title="Хост комнаты">
                      👑
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </section>{lastFinishedSlot && (
          <section className="card card--last">
            <span className="label tiny">╨Я╤А╨╛╤И╨╗╤Л╨╣ ╨╗╨╛╤В</span>
            <div className="lot-last__content">
              <span className="lot-last__name">
                #{(lastFinishedSlot.index ?? 0) + 1} тАФ {lastFinishedSlot.name}
              </span>
              <span className="lot-last__meta">
                {lastFinishedSlot.winnerPlayerId != null
                  ? `${playerDisplayName(
                      safePlayers.find(
                        (p) => p.id === lastFinishedSlot.winnerPlayerId
                      )
                    )} тАв `
                  : ""}
                {moneyFormatter.format(lastFinishedSlot.winBid || 0)}$
              </span>
            </div>
          </section>
        )}
      </div>
    );
  };

  const renderResultsContent = () => {
    if (!showResults) return null;

    const sorted = safePlayers
      .slice()
      .sort((a, b) => (netWorths[b.id] ?? 0) - (netWorths[a.id] ?? 0));

    return (
      <div className="screen-body results-layout">
        <section className="card">
          <div className="card-row">
            <div>
              <span className="label">╨д╨╕╨╜╨╕╤И</span>
              <h2 className="title">╨Ш╤В╨╛╨│╨╕ ╨░╤Г╨║╤Ж╨╕╨╛╨╜╨░</h2>
            </div>
          </div>

          <div className="results-list">
            {sorted.map((p) => {
              const name = playerDisplayName(p);
              const avatar = p.user?.photo_url || p.user?.avatar || null;
              const balance = balances[p.id] ?? 0;
              const basketValue = basketTotals[p.id] ?? 0;
              const netWorth = netWorths[p.id] ?? balance + basketValue;
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
                      <span className="result-row__name">{name}</span>
                      <span className="result-row__money">
                        {moneyFormatter.format(netWorth)}$
                      </span>
                      <span className="result-row__meta muted">
                        ╨С╨░╨╗╨░╨╜╤Б {moneyFormatter.format(balance)}$ ┬╖ ╨Я╨╛╨║╤Г╨┐╨║╨╕{" "}
                        {moneyFormatter.format(basketValue)}$
                      </span>
                    </div>
                  </div>
                  {isWinner && (
                    <span className="chip chip--winner">╨Я╨╛╨▒╨╡╨┤╨╕╤В╨╡╨╗╤М</span>
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
                ╨Х╤Й╤С ╤А╨░╤Г╨╜╨┤
              </button>
            )}
            <button
              type="button"
              className="btn btn--ghost"
              onClick={handleExit}
            >
              ╨Т ╨╝╨╡╨╜╤О
            </button>
          </div>
        </section>
      </div>
    );
  };

  const renderBasketModal = () => {
    if (!basketPlayer) return null;
    const name = playerDisplayName(basketPlayer);
    const avatar = basketPlayer.user?.photo_url || basketPlayer.user?.avatar || "";
    const basketValue = basketTotals[basketPlayer.id] ?? 0;
    const balance = balances[basketPlayer.id] ?? 0;
    const worth = netWorths[basketPlayer.id] ?? balance + basketValue;

    return (
      <div
        className="basket-modal"
        role="dialog"
        aria-modal="true"
        onClick={() => setBasketPlayerId(null)}
      >
        <div className="basket-panel" onClick={(e) => e.stopPropagation()}>
          <div className="basket-head">
            <div className="basket-head__avatar" aria-hidden>
              {avatar ? <img src={avatar} alt={name} /> : name.slice(0, 1)}
            </div>
            <div className="basket-head__info">
              <div className="basket-head__name">{name}</div>
              <div className="basket-head__meta">
                <span>╨Ъ╨╛╤А╨╖╨╕╨╜╨░: {moneyFormatter.format(basketValue)}$</span>
                <span>╨С╨░╨╗╨░╨╜╤Б: {moneyFormatter.format(balance)}$</span>
                <span>╨б╨╛╤Б╤В╨╛╤П╨╜╨╕╨╡: {moneyFormatter.format(worth)}$</span>
              </div>
            </div>
            <button
              type="button"
              className="icon-btn icon-btn--ghost basket-close"
              aria-label="╨Ч╨░╨║╤А╤Л╤В╤М ╨║╨╛╤А╨╖╨╕╨╜╤Г"
              onClick={() => setBasketPlayerId(null)}
            >
              ├Ч
            </button>
          </div>

          <div className="basket-items">
            {basketItems.length === 0 && (
              <div className="basket-empty">╨Ъ╨╛╤А╨╖╨╕╨╜╨░ ╨┐╤Г╤Б╤В╨░╤П.</div>
            )}
              {basketItems.map((item, idx) => {
              const key = `${item.index ?? idx}-${item.name ?? idx}`;
              const paid = Number(item.paid ?? 0) || 0;
              const base = Number(item.basePrice ?? 0) || 0;
              const value = Number(item.value ?? (paid || base)) || 0;
              const effect = item.effect;
              const effectClass =
                effect?.kind === "penalty"
                  ? "basket-item__effect--bad"
                  : effect?.kind === "money"
                  ? "basket-item__effect--good"
                  : "";

              return (
                <div className="basket-item" key={key}>
                  <div className="basket-item__head">
                    <span className="basket-item__tag">
                      {item.type === "lootbox" ? "╨Ы╤Г╤В╨▒╨╛╨║╤Б" : "╨Ы╨╛╤В"}
                    </span>
                    <span className="basket-item__price">
                      {moneyFormatter.format(value)}$
                    </span>
                  </div>
                  <div className="basket-item__title">{item.name || "╨С╨╡╨╖ ╨╜╨░╨╖╨▓╨░╨╜╨╕╤П"}</div>
                  <div className="basket-item__meta">
                    <span>╨Ю╨┐╨╗╨░╤З╨╡╨╜╨╛: {moneyFormatter.format(paid)}$</span>
                    {base > 0 && (
                      <span>╨б╤В╨░╤А╤В: {moneyFormatter.format(base)}$</span>
                    )}
                  </div>
                  {effect && (
                    <div
                      className={["basket-item__effect", effectClass]
                        .filter(Boolean)
                        .join(" ")}
                    >
                      {effect.kind === "penalty"
                        ? `╨и╤В╤А╨░╤Д ${moneyFormatter.format(Math.abs(effect.delta || 0))}$`
                        : effect.kind === "money"
                        ? `╨С╨╛╨╜╤Г╤Б ${moneyFormatter.format(Math.abs(effect.delta || 0))}$`
                        : "╨Я╤Г╤Б╤В╨╛"}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  };

  const renderSettingsModal = () => {
    if (!settingsOpen) return null;
    return (
      <div
        className="modal-backdrop"
        onClick={() => (!savingSettings ? closeSettings() : null)}
      >
        <div
          className="modal"
          onClick={(e) => e.stopPropagation()}
          role="dialog"
          aria-modal="true"
        >
          <div className="modal__head">
            <h3 className="modal__title">╨Э╨░╤Б╤В╤А╨╛╨╣╨║╨╕ ╨║╨╛╨╝╨╜╨░╤В╤Л</h3>
            <button
              type="button"
              className="icon-btn icon-btn--ghost"
              aria-label="╨Ч╨░╨║╤А╤Л╤В╤М"
              onClick={closeSettings}
              disabled={savingSettings}
            >
              X
            </button>
          </div>
          <div className="settings-panel">
            <div className="settings-grid">
              <label className="slider-field" htmlFor="auction-slots">
                <div className="slider-field__top">
                  <span className="field-label">╨Ъ╨╛╨╗╨╕╤З╨╡╤Б╤В╨▓╨╛ ╨╗╨╛╤В╨╛╨▓</span>
                  <span className="slider-field__value">{settingsSlots}</span>
                </div>
                <div className="slider-field__control">
                  <div className="slider-field__rail">
                    <div
                      className="slider-field__progress"
                      style={{ width: `${slotsProgress}%` }}
                    />
                  </div>
                  <input
                    id="auction-slots"
                    className="slider-field__input"
                    type="range"
                    min={MIN_SLOTS}
                    max={MAX_SLOTS}
                    step={1}
                    value={settingsSlots}
                    onChange={(e) =>
                      handleSlotsChange(Number(e.target.value) || MIN_SLOTS)
                    }
                    style={{ ["--progress" as string]: `${slotsProgress}%` }}
                  />
                </div>
                <div className="slider-field__footer">
                  <span>{MIN_SLOTS}</span>
                  <span>{MAX_SLOTS}</span>
                </div>
              </label>

              <label className="slider-field" htmlFor="auction-budget">
                <div className="slider-field__top">
                  <span className="field-label">╨С╤О╨┤╨╢╨╡╤В ╨╕╨│╤А╨╛╨║╨░</span>
                  <span className="slider-field__value">
                    {moneyFormatter.format(settingsBudget)}$
                  </span>
                </div>
                <div className="slider-field__control">
                  <div className="slider-field__rail">
                    <div
                      className="slider-field__progress"
                      style={{ width: `${budgetProgress}%` }}
                    />
                  </div>
                  <input
                    id="auction-budget"
                    className="slider-field__input"
                    type="range"
                    min={MIN_BUDGET}
                    max={MAX_BUDGET}
                    step={BUDGET_STEP}
                    value={settingsBudget}
                    onChange={(e) =>
                      handleBudgetChange(Number(e.target.value) || MIN_BUDGET)
                    }
                    style={{ ["--progress" as string]: `${budgetProgress}%` }}
                  />
                </div>
                <div className="slider-field__footer">
                  <span>{moneyFormatter.format(MIN_BUDGET)}$</span>
                  <span>{moneyFormatter.format(MAX_BUDGET)}$</span>
                </div>
              </label>
            </div>
          </div>
          <div className="modal__actions">
            <button
              type="button"
              className="btn btn--ghost btn--compact"
              onClick={closeSettings}
              disabled={savingSettings}
            >
              ╨Ю╤В╨╝╨╡╨╜╨░
            </button>
            <button
              type="button"
              className="btn btn--primary btn--compact"
              onClick={saveSettings}
              disabled={savingSettings}
            >
              {savingSettings ? "╨б╨╛╤Е╤А╨░╨╜╤П╨╡╨╝..." : "╨б╨╛╤Е╤А╨░╨╜╨╕╤В╤М"}
            </button>
          </div>
        </div>
      </div>
    );
  };

  const renderToastStack = () => {
    if (!toastStack.length) return null;
    return (
      <div className="toast-stack" role="status" aria-live="polite">
        <AnimatePresence initial={false}>
          {toastStack.map((item) => (
            <motion.div
              key={item.id}
              className={[
                "toast",
                item.type === "error" ? "toast--error" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              initial={{ opacity: 0, y: -8, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -8, scale: 0.96 }}
              transition={{ duration: 0.18 }}
            >
              <span className="toast__text">{item.text}</span>
              <button
                type="button"
                className="toast__close"
                onClick={() => dismissToast(item.id)}
                aria-label="╨Ч╨░╨║╤А╤Л╤В╤М ╤Г╨▓╨╡╨┤╨╛╨╝╨╗╨╡╨╜╨╕╨╡"
              >
                ├Ч
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
    `auction-app--phase-${phase}`,
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
      {renderBasketModal()}
      {renderSettingsModal()}
      {renderToastStack()}
    </div>
  );
}













