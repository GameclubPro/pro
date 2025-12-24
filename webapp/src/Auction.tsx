import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Confetti from "react-canvas-confetti";
import { ensureAuctionSocket } from "./auction-socket";
import { getSessionToken, setSessionToken } from "./session-token";
import lootboxFImageUrl from "./assets/auction/F1.png";
import lootboxEImageUrl from "./assets/auction/E1.png";
import lootboxDImageUrl from "./assets/auction/D1.png";
import lootboxCImageUrl from "./assets/auction/C1.png";
import lootboxBImageUrl from "./assets/auction/B1.png";
import lootboxAImageUrl from "./assets/auction/A1.png";
import lootboxSImageUrl from "./assets/auction/S1.png";
import moneyCoinUrl from "./assets/auction/coin.png";
import moneyBagUrl from "./assets/auction/bag.png";
import "./Auction.css";

const INITIAL_BANK = 1_000_000;
const CODE_ALPHABET_RE = /[^A-HJKMNPQRSTUVWXYZ23456789]/g;
const BID_PRESETS = [1_000, 10_000, 100_000];
const AUCTION_GAME = "AUCTION";
const MIN_SLOTS = 10;
const MAX_SLOTS = 50;
const MIN_BUDGET = 100_000;
const MAX_BUDGET = 5_000_000;
const BUDGET_STEP = 50_000;
const COUNTDOWN_STEP_MS = 4_000;
const COUNTDOWN_START_FROM = 3;
const LOOTBOX_FALLBACK_IMAGE_URL = "/lootbox.svg";
const LOOTBOX_SHATTER_SIZE = 240;
const LOOTBOX_SHATTER_MIN_PIECES = 32;
const LOOTBOX_SHATTER_MAX_PIECES = 52;
const LOOTBOX_REVEAL_TOTAL_MS = 6_200;
type LootboxRarityKey = "F" | "E" | "D" | "C" | "B" | "A" | "S";

const LOOTBOX_RARITY_META: Record<LootboxRarityKey, { label: string; image: string }> = {
  F: { label: "Обычный", image: lootboxFImageUrl },
  E: { label: "Необычный", image: lootboxEImageUrl },
  D: { label: "Редкий", image: lootboxDImageUrl },
  C: { label: "Эпический", image: lootboxCImageUrl },
  B: { label: "Легендарный", image: lootboxBImageUrl },
  A: { label: "Мифический", image: lootboxAImageUrl },
  S: { label: "Божественный", image: lootboxSImageUrl },
};

const LOOTBOX_RARITY_LABELS = (
  Object.entries(LOOTBOX_RARITY_META) as [
    LootboxRarityKey,
    { label: string; image: string },
  ][]
)
  .map(([key, value]) => ({ key, label: value.label.toLowerCase() }))
  .sort((a, b) => b.label.length - a.label.length);

const LANDING_MONEY_ICONS = [moneyCoinUrl] as const;

const LANDING_COINS = [
  { left: "4%", size: 34, duration: "9.8s", delay: "-1.2s", drift: "18px", opacity: 0.95 },
  { left: "11%", size: 26, duration: "7.4s", delay: "-3.1s", drift: "-12px", opacity: 0.78 },
  { left: "19%", size: 24, duration: "8.2s", delay: "-5.4s", drift: "14px", opacity: 0.7 },
  { left: "28%", size: 32, duration: "10.1s", delay: "-2.8s", drift: "-20px", opacity: 0.9 },
  { left: "36%", size: 30, duration: "7.2s", delay: "-4.6s", drift: "10px", opacity: 0.82 },
  { left: "45%", size: 36, duration: "10.8s", delay: "-7.9s", drift: "-22px", opacity: 0.96 },
  { left: "54%", size: 25, duration: "7.6s", delay: "-1.6s", drift: "12px", opacity: 0.72 },
  { left: "62%", size: 31, duration: "9.1s", delay: "-6.2s", drift: "-14px", opacity: 0.86 },
  { left: "70%", size: 28, duration: "8.4s", delay: "-3.5s", drift: "8px", opacity: 0.77 },
  { left: "78%", size: 23, duration: "6.8s", delay: "-2.3s", drift: "-10px", opacity: 0.66 },
  { left: "86%", size: 33, duration: "9.4s", delay: "-8.1s", drift: "20px", opacity: 0.9 },
  { left: "94%", size: 26, duration: "8.8s", delay: "-5.6s", drift: "-6px", opacity: 0.74 },
  { left: "24%", size: 35, duration: "8.6s", delay: "-9.2s", drift: "16px", opacity: 0.88 },
  { left: "66%", size: 30, duration: "9.3s", delay: "-5.2s", drift: "6px", opacity: 0.82 },
] as const;

function normalizeCode(value = "") {
  return value.toUpperCase().replace(CODE_ALPHABET_RE, "").slice(0, 6);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function splitEmojiLabel(label: string) {
  const raw = String(label || "").trim();
  const match = raw.match(/([\u{1F300}-\u{1FAFF}])/u);
  const emoji = match?.[0] || "";
  const text = emoji ? raw.replace(emoji, "").trim() : raw;
  return { emoji, text, raw };
}

function normalizeLootboxRarity(value?: string | null): LootboxRarityKey | null {
  const code = String(value || "").trim().toUpperCase();
  const key = code as LootboxRarityKey;
  return LOOTBOX_RARITY_META[key] ? key : null;
}

function inferLootboxRarityFromName(name: string): LootboxRarityKey | null {
  const lower = String(name || "").toLowerCase();
  for (const rarity of LOOTBOX_RARITY_LABELS) {
    if (lower.includes(rarity.label)) return rarity.key;
  }
  return null;
}

function getLootboxRarity(slot: any): LootboxRarityKey | null {
  if (!slot || slot.type !== "lootbox") return null;
  return (
    normalizeLootboxRarity(slot.rarity) ||
    inferLootboxRarityFromName(String(slot.name || ""))
  );
}

function getLootboxImageUrl(rarity: LootboxRarityKey | null) {
  if (!rarity) return LOOTBOX_FALLBACK_IMAGE_URL;
  return LOOTBOX_RARITY_META[rarity]?.image || LOOTBOX_FALLBACK_IMAGE_URL;
}

function hashStringToSeed(value = "") {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function mulberry32(seed: number) {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = t;
    r = Math.imul(r ^ (r >>> 15), r | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
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
  initData_required: "Открой игру из Telegram — нет initData.",
  bad_signature: "Подпись Telegram не сошлась. Запусти игру заново из бота.",
  stale_init_data: "Сессия Telegram устарела. Открой игру заново из Telegram.",
  code_already_in_use: "Код комнаты уже используется",
  room_not_found: "Комната не найдена",
  room_full: "Комната заполнена",
  game_in_progress: "Игра уже идёт",
  wrong_game: "Эта ссылка для другой игры",
};
const AUTH_ERROR_RE = /(initData_required|bad_signature|stale_init_data)/i;

function mapServerError(code: string | undefined, status: number, fallback: string) {
  if (status === 429) return "Слишком много попыток. Попробуйте чуть позже.";
  if (status === 401 && (!code || code === "failed")) {
    return SERVER_ERROR_MESSAGES.stale_init_data;
  }
  if (!code) return fallback;
  return SERVER_ERROR_MESSAGES[code] || fallback;
}

function playerDisplayName(player: any) {
  if (!player) return "Игрок";
  return (
    player.user?.first_name ||
    player.user?.username ||
    (player.id != null ? `Игрок ${player.id}` : "Игрок")
  );
}

type LootboxEffect = {
  kind: "money" | "penalty" | "empty" | string;
  delta?: number;
  prize?: {
    emoji?: string;
    name?: string;
    fullName?: string;
    basePrice?: number;
    nominalPrice?: number;
    imageUrl?: string;
  } | null;
};

type LootboxRevealEvent = {
  id: string;
  slotIndex: number;
  slotName: string;
  slotRarity?: LootboxRarityKey | null;
  winnerPlayerId: number;
  winBid: number;
  effect: LootboxEffect;
};

type LootboxShatterPiece = {
  key: string;
  left: number;
  top: number;
  width: number;
  height: number;
  clipPath: string;
  dx: number;
  dy: number;
  rotate: number;
  delay: number;
};

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
  const tokenRefreshRef = useRef<Promise<string | null> | null>(null);
  const authRetryAtRef = useRef(0);
  const lastAuthTokenAttemptRef = useRef("");
  const [connecting, setConnecting] = useState(false);
  const [showConnecting, setShowConnecting] = useState(false);
  const tg = typeof window !== "undefined" ? window?.Telegram?.WebApp : undefined;
  const isMiniApp = Boolean(tg);
  const shatterSize = isMiniApp ? 210 : LOOTBOX_SHATTER_SIZE;
  const shatterDuration = isMiniApp ? 0.95 : 1.2;

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
  const [bidPanelOpen, setBidPanelOpen] = useState(false);
  const [playersTab, setPlayersTab] = useState<"all" | "leaders" | "mine">("all");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSlots, setSettingsSlots] = useState<number>(30);
  const [settingsBudget, setSettingsBudget] = useState<number>(INITIAL_BANK);
  const [savingSettings, setSavingSettings] = useState(false);
  const [settingsDirty, setSettingsDirty] = useState(false);
  const [basketPlayerId, setBasketPlayerId] = useState<number | null>(null);
  const [lootboxReveal, setLootboxReveal] = useState<LootboxRevealEvent | null>(null);
  const [lootboxStage, setLootboxStage] = useState<
    "intro" | "shake" | "explode" | "reveal"
  >("intro");
  const [currentLotImageReady, setCurrentLotImageReady] = useState(false);
  const [landingMode, setLandingMode] = useState<"join" | "create">("join");
  const lastSyncedSettingsRef = useRef({
    slots: settingsSlots,
    budget: settingsBudget,
  });

  const deadlineAtRef = useRef<number | null>(null);
  const pauseLeftRef = useRef<number | null>(null);
  const slotStartLeftMsRef = useRef<number | null>(null);
  const [nowTick, setNowTick] = useState(() => Date.now());
  const toastTimersRef = useRef<Map<string, any>>(new Map());
  const lastSubscribedCodeRef = useRef<string | null>(null);
  const lastSubscriptionSocketIdRef = useRef<string | null>(null);
  const progressSentRef = useRef(false);
  const lastBidAtRef = useRef(0);
  const lastLeadingPlayerRef = useRef<number | null>(null);
  const lootboxHistoryLenRef = useRef<number | null>(null);
  const lootboxConfettiFiredRef = useRef<string | null>(null);
  const confettiRef = useRef<any>(null);
  const lastStateVersionRef = useRef<number | null>(null);
  const connectingTimerRef = useRef<any>(null);
  const preloadedImageUrlsRef = useRef<Set<string>>(new Set());

  const moneyFormatter = useMemo(() => new Intl.NumberFormat("ru-RU"), []);
  const sanitizedAutoCode = useMemo(
    () => normalizeCode(autoJoinCode || ""),
    [autoJoinCode]
  );

  const phase: "lobby" | "in_progress" | "finished" | string =
    auctionState?.phase || "lobby";
  const slotPhase = String(auctionState?.slotPhase || "bidding");
  const isRevealPhase = slotPhase === "reveal";
  const paused = !!auctionState?.paused;
  const isBiddingLocked = paused || phase !== "in_progress" || isRevealPhase;
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
    return currentSlot?.type === "lootbox" ? "🎁" : "🏆";
  }, [currentSlot?.name, currentSlot?.type]);

  const currentSlotRarity = useMemo(
    () => getLootboxRarity(currentSlot),
    [currentSlot?.name, currentSlot?.rarity, currentSlot?.type]
  );

  const currentLootboxImageUrl = useMemo(
    () => getLootboxImageUrl(currentSlotRarity),
    [currentSlotRarity]
  );
  const currentLotImageUrl = useMemo(() => {
    if (currentSlot?.type !== "lot") return null;
    const raw = String(currentSlot?.imageUrl || "").trim();
    return raw || null;
  }, [currentSlot?.imageUrl, currentSlot?.type]);

  useEffect(() => {
    if (phase !== "lobby") return;
    const slots = Array.isArray(auctionState?.slots) ? auctionState.slots : [];
    const firstSlot = slots.find(
      (slot: any) => slot?.type === "lot" && slot?.imageUrl
    );
    const raw = firstSlot?.imageUrl != null ? String(firstSlot.imageUrl).trim() : "";
    if (!raw || preloadedImageUrlsRef.current.has(raw)) return;
    const img = new Image();
    img.onload = () => {
      preloadedImageUrlsRef.current.add(raw);
    };
    img.src = raw;
  }, [auctionState?.slots, phase]);

  useEffect(() => {
    let isActive = true;
    if (!currentLotImageUrl) {
      setCurrentLotImageReady(false);
      return;
    }
    if (preloadedImageUrlsRef.current.has(currentLotImageUrl)) {
      setCurrentLotImageReady(true);
      return;
    }
    setCurrentLotImageReady(false);
    const img = new Image();
    img.onload = () => {
      if (!isActive) return;
      preloadedImageUrlsRef.current.add(currentLotImageUrl);
      setCurrentLotImageReady(true);
    };
    img.onerror = () => {
      if (!isActive) return;
      setCurrentLotImageReady(false);
    };
    img.src = currentLotImageUrl;
    return () => {
      isActive = false;
    };
  }, [currentLotImageUrl]);

  const showLotImage =
    !!currentLotImageUrl &&
    (currentLotImageReady ||
      preloadedImageUrlsRef.current.has(currentLotImageUrl));

  const heroBidText = useMemo(() => {
    if (isRevealPhase) return "Открывается лутбокс";
    if (leadingBid?.amount != null) {
      return leadingPlayerName
        ? `${moneyFormatter.format(leadingBid.amount)}💰 · ${leadingPlayerName}`
        : `${moneyFormatter.format(leadingBid.amount)}💰`;
    }
    return `База ${moneyFormatter.format(baseBid)}💰`;
  }, [baseBid, isRevealPhase, leadingBid?.amount, leadingPlayerName, moneyFormatter]);
  const activeBidFloor = useMemo(
    () => Math.max(baseBid, leadingBid?.amount ?? 0),
    [baseBid, leadingBid?.amount]
  );

  const formatPresetLabel = useCallback(
    (value: number) => {
      if (value >= 1_000_000 && value % 1_000_000 === 0) {
        return `${value / 1_000_000}m`;
      }
      if (value >= 1_000 && value % 1_000 === 0) {
        return `${value / 1_000}k`;
      }
      return moneyFormatter.format(value);
    },
    [moneyFormatter]
  );

  const quickBidButtons = useMemo(
    () =>
      BID_PRESETS.map((step, idx) => ({
        key: `${idx + 1}`,
        label: `+${formatPresetLabel(step)}💰`,
        action: () => setBidRelative(step),
        disabled: isBiddingLocked || busyBid || myBalance == null || myBalance <= 0,
      })),
    [busyBid, formatPresetLabel, isBiddingLocked, myBalance, setBidRelative]
  );

  useEffect(() => {
    setMyBid("");
  }, [currentSlot?.index]);

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
  const timeLeftMs = useMemo(() => {
    if (paused) {
      const ms = pauseLeftRef.current ?? (auctionState?.timeLeftMs ?? null);
      return typeof ms === "number" && Number.isFinite(ms) ? Math.max(0, ms) : null;
    }
    if (deadlineAtRef.current != null) {
      return Math.max(0, deadlineAtRef.current - nowTick);
    }
    const ms = auctionState?.timeLeftMs;
    return typeof ms === "number" && Number.isFinite(ms) ? Math.max(0, ms) : null;
  }, [auctionState?.timeLeftMs, nowTick, paused]);

  const timeLeftLabel = useMemo(() => {
    if (timeLeftMs == null) return "--:--";
    const totalSec = Math.max(0, Math.ceil(timeLeftMs / 1000));
    const minutes = Math.floor(totalSec / 60);
    const seconds = totalSec % 60;
    return `${minutes}:${String(seconds).padStart(2, "0")}`;
  }, [timeLeftMs]);

  useEffect(() => {
    if (phase !== "in_progress" || timeLeftMs == null) {
      slotStartLeftMsRef.current = null;
      return;
    }
    const prev = slotStartLeftMsRef.current;
    if (prev == null || timeLeftMs > prev + 250) {
      slotStartLeftMsRef.current = timeLeftMs;
    }
  }, [phase, timeLeftMs, currentSlot?.index]);

  const slotDurationMs = useMemo(() => {
    const raw = Number(auctionState?.rules?.timePerSlotSec);
    if (Number.isFinite(raw) && raw > 0) return raw * 1000;
    if (countdownStepMs > 0 && countdownStartFrom > 0) {
      return countdownStepMs * countdownStartFrom;
    }
    return null;
  }, [auctionState?.rules?.timePerSlotSec, countdownStepMs, countdownStartFrom]);
  const ringProgress = useMemo(() => {
    if (timeLeftMs == null) return 0;
    const baseline = slotStartLeftMsRef.current || slotDurationMs;
    if (!baseline || baseline <= 0) return 0;
    return clamp(1 - timeLeftMs / baseline, 0, 1);
  }, [slotDurationMs, timeLeftMs]);
  const urgencyWindowMs = countdownStepMs * Math.max(5, countdownStartFrom);
  const criticalWindowMs =
    countdownStepMs * Math.max(1, Math.min(3, countdownStartFrom));
  const isUrgent =
    !paused &&
    timeLeftMs != null &&
    urgencyWindowMs > 0 &&
    timeLeftMs <= urgencyWindowMs;
  const isCritical =
    !paused &&
    timeLeftMs != null &&
    criticalWindowMs > 0 &&
    timeLeftMs <= criticalWindowMs;
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

  const leadersByBids = useMemo(() => {
    const withBids = safePlayers.filter((p) => {
      const bid = currentBids[p.id] ?? 0;
      return typeof bid === "number" && bid > 0;
    });
    return withBids
      .slice()
      .sort((a, b) => (currentBids[b.id] ?? 0) - (currentBids[a.id] ?? 0));
  }, [safePlayers, currentBids]);

  const leadersList = useMemo(() => {
    const base = leadersByBids.length
      ? leadersByBids
      : safePlayers.slice().sort((a, b) => (netWorths[b.id] ?? 0) - (netWorths[a.id] ?? 0));
    return base.slice(0, Math.min(3, base.length));
  }, [leadersByBids, safePlayers, netWorths]);

  const filteredPlayers = useMemo(() => {
    if (playersTab === "leaders") return leadersList;
    if (playersTab === "mine") {
      return myPlayerId != null
        ? safePlayers.filter((p) => p.id === myPlayerId)
        : EMPTY_ARRAY;
    }
    return safePlayers;
  }, [leadersList, myPlayerId, playersTab, safePlayers]);

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

  // ---------- LOOTBOX REVEAL ----------

  const closeLootboxReveal = useCallback(() => setLootboxReveal(null), []);

  const fireLootboxConfetti = useCallback(
    (kind: string) => {
      if (!confettiRef.current) return;
      if (kind !== "money" && kind !== "lot") return;
      confettiRef.current({
        particleCount: isMiniApp ? 140 : 260,
        spread: isMiniApp ? 90 : 110,
        startVelocity: isMiniApp ? 36 : 48,
        decay: isMiniApp ? 0.9 : 0.88,
        scalar: isMiniApp ? 0.95 : 1.05,
        ticks: isMiniApp ? 160 : 220,
        origin: { y: 0.32 },
        colors:
          kind === "lot"
            ? ["#fbbf24", "#38bdf8", "#a855f7", "#f97316", "#fde047"]
            : ["#22c55e", "#38bdf8", "#a855f7", "#fbbf24", "#34d399"],
      });
    },
    [isMiniApp]
  );

  const lootboxShatterPieces = useMemo((): LootboxShatterPiece[] => {
    if (!lootboxReveal?.id) return [];

    const seed = hashStringToSeed(lootboxReveal.id);
    const rnd = mulberry32(seed);

    const size = shatterSize;
    const midX = size / 2;
    const midY = size / 2;

    const clampPct = (value: number) => clamp(value, 0, 100);
    const rand = (min: number, max: number) => min + rnd() * (max - min);

    const randomShardClipPath = () => {
      const p = (x: number, y: number) =>
        `${clampPct(x).toFixed(1)}% ${clampPct(y).toFixed(1)}%`;

      const p1 = [rand(0, 22), rand(0, 10)];
      const p2 = [rand(35, 65), rand(0, 8)];
      const p3 = [rand(78, 100), rand(0, 16)];
      const p4 = [rand(90, 100), rand(22, 42)];
      const p5 = [rand(90, 100), rand(58, 78)];
      const p6 = [rand(78, 100), rand(88, 100)];
      const p7 = [rand(35, 65), rand(92, 100)];
      const p8 = [rand(0, 22), rand(82, 100)];
      const p9 = [rand(0, 10), rand(60, 82)];
      const p10 = [rand(0, 12), rand(22, 42)];

      const base = [p1, p2, p3, p4, p5, p6, p7, p8, p9, p10];
      const pick =
        rnd() < 0.5
          ? [base[0], base[2], base[3], base[4], base[5], base[7], base[8], base[9]]
          : base;

      return `polygon(${pick.map(([x, y]) => p(x, y)).join(", ")})`;
    };

    type Rect = { x: number; y: number; w: number; h: number };

    const minPieces = isMiniApp ? 18 : LOOTBOX_SHATTER_MIN_PIECES;
    const maxPieces = isMiniApp ? 30 : LOOTBOX_SHATTER_MAX_PIECES;
    const targetPieces =
      minPieces + Math.floor(rnd() * (maxPieces - minPieces + 1));

    const minDim = Math.max(
      isMiniApp ? 16 : 12,
      Math.floor(size / (isMiniApp ? 14 : 18))
    );
    const viewW =
      typeof window !== "undefined" && window.innerWidth
        ? window.innerWidth
        : 900;
    const viewH =
      typeof window !== "undefined" && window.innerHeight
        ? window.innerHeight
        : 900;
    const viewDiag = Math.hypot(viewW, viewH);
    const baseDistance = Math.max(viewDiag, size * 4);
    const rects: Rect[] = [{ x: 0, y: 0, w: size, h: size }];

    let guard = 0;
    while (rects.length < targetPieces && guard++ < 1000) {
      const candidates = rects
        .map((r, idx) => ({
          r,
          idx,
          canV: r.w >= minDim * 2,
          canH: r.h >= minDim * 2,
          area: r.w * r.h,
        }))
        .filter((c) => c.canV || c.canH);

      if (!candidates.length) break;

      let totalArea = 0;
      for (const c of candidates) totalArea += c.area;
      let pick = rnd() * totalArea;
      let chosen = candidates[candidates.length - 1];
      for (const c of candidates) {
        pick -= c.area;
        if (pick <= 0) {
          chosen = c;
          break;
        }
      }

      const r = chosen.r;
      const idx = chosen.idx;
      const ratio = r.w / Math.max(1, r.h);

      let vertical: boolean;
      if (chosen.canV && chosen.canH) {
        if (ratio > 1.25) vertical = true;
        else if (ratio < 0.8) vertical = false;
        else vertical = rnd() > 0.5;
      } else {
        vertical = chosen.canV;
      }

      if (vertical && !chosen.canV) vertical = false;
      if (!vertical && !chosen.canH) vertical = true;

      if (vertical && chosen.canV) {
        const cutMin = minDim;
        const cutMax = r.w - minDim;
        if (cutMax <= cutMin) continue;
        const cut = Math.floor(cutMin + rnd() * (cutMax - cutMin));
        rects.splice(
          idx,
          1,
          { x: r.x, y: r.y, w: cut, h: r.h },
          { x: r.x + cut, y: r.y, w: r.w - cut, h: r.h }
        );
      } else if (!vertical && chosen.canH) {
        const cutMin = minDim;
        const cutMax = r.h - minDim;
        if (cutMax <= cutMin) continue;
        const cut = Math.floor(cutMin + rnd() * (cutMax - cutMin));
        rects.splice(
          idx,
          1,
          { x: r.x, y: r.y, w: r.w, h: cut },
          { x: r.x, y: r.y + cut, w: r.w, h: r.h - cut }
        );
      } else {
        break;
      }
    }

    return rects.map((rect, i) => {
      const left = rect.x;
      const top = rect.y;
      const width = rect.w;
      const height = rect.h;
      const centerX = left + width / 2;
      const centerY = top + height / 2;

      const dirX = centerX - midX + (rnd() - 0.5) * 12;
      const dirY = centerY - midY + (rnd() - 0.5) * 12;
      const len = Math.max(1, Math.hypot(dirX, dirY));
      const unitX = dirX / len;
      const unitY = dirY / len;

      const distance =
        baseDistance *
        (isMiniApp ? 0.85 + rnd() * 0.2 : 0.95 + rnd() * 0.25);

      const jitterX = (rnd() - 0.5) * (isMiniApp ? 90 : 140);
      const jitterY = (rnd() - 0.5) * (isMiniApp ? 80 : 120) - (isMiniApp ? 12 : 18);
      const dx = unitX * distance + jitterX;
      const dy = unitY * distance + jitterY;

      const clipPath = isMiniApp ? "" : randomShardClipPath();

      return {
        key: `${i}-${left}-${top}`,
        left,
        top,
        width,
        height,
        clipPath,
        dx,
        dy,
        rotate: (rnd() - 0.5) * (isMiniApp ? 380 : 520),
        delay: rnd() * (isMiniApp ? 0.18 : 0.22),
      };
    });
  }, [isMiniApp, lootboxReveal?.id, shatterSize]);

  useEffect(() => {
    const len = safeHistory.length;
    const prevLen = lootboxHistoryLenRef.current;
    if (prevLen == null) {
      lootboxHistoryLenRef.current = len;
      return;
    }
    if (len <= prevLen) {
      lootboxHistoryLenRef.current = len;
      return;
    }

    const diff = len - prevLen;
    lootboxHistoryLenRef.current = len;
    if (diff !== 1) return;
    if (phase === "lobby") return;

    const latest = safeHistory[len - 1];
    if (!latest || latest.type !== "lootbox") return;
    const slotName = String(latest.name || "");
    const slotRarity = getLootboxRarity(latest);
    const winnerPlayerId = latest.winnerPlayerId;
    const effect = latest.effect;
    if (winnerPlayerId == null || !effect) return;

    setLootboxReveal({
      id: `${latest.index}-${winnerPlayerId}-${Date.now()}`,
      slotIndex: latest.index,
      slotName: slotName || "Лутбокс",
      slotRarity,
      winnerPlayerId,
      winBid: Number(latest.winBid || 0) || 0,
      effect,
    });
  }, [phase, safeHistory]);

  useEffect(() => {
    if (!lootboxReveal) {
      setLootboxStage("intro");
      lootboxConfettiFiredRef.current = null;
      return;
    }

    setLootboxStage("intro");
    lootboxConfettiFiredRef.current = null;

    const shakeTimer = setTimeout(() => setLootboxStage("shake"), 200);
    const explodeTimer = setTimeout(() => setLootboxStage("explode"), 1400);
    const revealTimer = setTimeout(() => setLootboxStage("reveal"), 2700);
    const closeTimer = setTimeout(
      () => setLootboxReveal(null),
      LOOTBOX_REVEAL_TOTAL_MS
    );

    return () => {
      clearTimeout(shakeTimer);
      clearTimeout(explodeTimer);
      clearTimeout(revealTimer);
      clearTimeout(closeTimer);
    };
  }, [lootboxReveal?.id]);

  useEffect(() => {
    if (!lootboxReveal) return;
    if (lootboxStage !== "explode" && lootboxStage !== "reveal") return;
    if (lootboxConfettiFiredRef.current === lootboxReveal.id) return;
    lootboxConfettiFiredRef.current = lootboxReveal.id;
    fireLootboxConfetti(String(lootboxReveal.effect?.kind || ""));
    tg?.HapticFeedback?.notificationOccurred?.("success");
  }, [fireLootboxConfetti, lootboxReveal, lootboxStage, tg]);

  // ---------- TOАSTS ----------

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
      const text = message || "Что-то пошло не так";
      setError(text);
      pushToast({ type: "error", text, duration: 3600 });
    },
    [pushToast]
  );

  const clearError = useCallback(() => setError(""), []);

  const updateSocketAuth = useCallback(
    (token?: string | null) => {
      const sock = socketRef.current;
      if (!sock) return;
      const nextAuth = { ...(sock.auth || {}) };
      if (initData != null) nextAuth.initData = initData || "";
      if (token) nextAuth.token = token;
      sock.auth = nextAuth;
    },
    [initData]
  );

  const refreshSessionToken = useCallback(async () => {
    if (!apiBase || !initData) return null;
    if (tokenRefreshRef.current) return tokenRefreshRef.current;
    const task = (async () => {
      try {
        const resp = await fetch(`${apiBase}/auth/verify`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ initData }),
        });
        if (!resp.ok) return null;
        const data = await resp.json().catch(() => ({}));
        if (data?.token) {
          setSessionToken(data.token);
          updateSocketAuth(data.token);
          return data.token;
        }
      } catch {
        // ignore
      }
      return null;
    })();
    tokenRefreshRef.current = task;
    try {
      return await task;
    } finally {
      tokenRefreshRef.current = null;
    }
  }, [apiBase, initData, updateSocketAuth]);

  const recoverSocketAuth = useCallback(async () => {
    const now = Date.now();
    if (now - authRetryAtRef.current < 2500) return true;
    authRetryAtRef.current = now;

    const sock = socketRef.current;
    if (!sock) return false;

    const storedToken = getSessionToken();
    if (storedToken && lastAuthTokenAttemptRef.current !== storedToken) {
      lastAuthTokenAttemptRef.current = storedToken;
      updateSocketAuth(storedToken);
      try {
        sock.connect();
      } catch {
        // ignore
      }
      return true;
    }

    const refreshed = initData ? await refreshSessionToken() : null;
    if (refreshed) {
      lastAuthTokenAttemptRef.current = refreshed;
      updateSocketAuth(refreshed);
      try {
        sock.connect();
      } catch {
        // ignore
      }
      return true;
    }
    return false;
  }, [initData, refreshSessionToken, updateSocketAuth]);

  const buildAuthHeaders = useCallback(() => {
    const token = getSessionToken();
    return {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(initData ? { "X-Telegram-Init-Data": initData } : {}),
    } as Record<string, string>;
  }, [initData]);

  useEffect(() => {
    if (!apiBase || !initData) return;
    refreshSessionToken();
  }, [apiBase, initData, refreshSessionToken]);

  // ---------- SOCKET SUBSCRIBE ----------

  const applyAuctionState = useCallback((state: any) => {
    if (!state) return;
    const nextVersion = Number(state.stateVersion);
    if (Number.isFinite(nextVersion)) {
      const prevVersion = lastStateVersionRef.current;
      if (prevVersion != null && nextVersion <= prevVersion) return;
      lastStateVersionRef.current = nextVersion;
    }
    setAuctionState(state);
  }, []);

  const resumeAuctionState = useCallback(
    (rawCode: string) => {
      const sock = socketRef.current;
      const code = normalizeCode(rawCode);
      if (!code || !sock) return;
      const lastVersion = lastStateVersionRef.current;
      sock.emit(
        "auction:resume_state",
        { code, lastVersion, game: AUCTION_GAME },
        (resp: any) => {
          if (!resp || !resp.ok) {
            sock.emit("auction:sync", { code, game: AUCTION_GAME });
            return;
          }
          const deltaStates = Array.isArray(resp.deltaStates)
            ? resp.deltaStates
            : [];
          if (deltaStates.length) {
            let latest: any = null;
            let latestVersion = -Infinity;
            deltaStates.forEach((item) => {
              const ver = Number(item?.stateVersion);
              if (Number.isFinite(ver)) {
                if (ver > latestVersion) {
                  latestVersion = ver;
                  latest = item;
                }
              } else if (!latest) {
                latest = item;
              }
            });
            if (latest) applyAuctionState(latest);
            return;
          }
          if (resp.state) applyAuctionState(resp.state);
        }
      );
    },
    [applyAuctionState]
  );

  const subscribeToRoom = useCallback(
    (rawCode: string, options: { force?: boolean; resume?: boolean } = {}) => {
      const sock = socketRef.current;
      const code = normalizeCode(rawCode);
      if (!code || !sock) return;
      const force = options.force ?? false;
      const resume = options.resume ?? true;
      const socketId = sock.id ?? null;
      const alreadySame =
        lastSubscribedCodeRef.current === code &&
        lastSubscriptionSocketIdRef.current === socketId &&
        socketId != null;

      if (!force && alreadySame) return;

      lastSubscribedCodeRef.current = code;
      sock.emit("room:subscribe", { code, game: AUCTION_GAME });
      if (resume) {
        resumeAuctionState(code);
      } else {
        sock.emit("auction:sync", { code, game: AUCTION_GAME });
      }
      if (socketId) {
        lastSubscriptionSocketIdRef.current = socketId;
      }
    },
    [resumeAuctionState]
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
          ...buildAuthHeaders(),
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
    lastStateVersionRef.current = null;
    lastSubscribedCodeRef.current = null;
    lastSubscriptionSocketIdRef.current = null;
    progressSentRef.current = false;
  }, [apiBase, room?.code, socket, buildAuthHeaders]);

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

  useEffect(() => {
    if (phase !== "in_progress") {
      setPlayersTab("all");
      setBidPanelOpen(false);
    }
  }, [phase]);

  useEffect(() => {
    if (basketPlayerId != null && !safePlayers.some((p) => p.id === basketPlayerId)) {
      setBasketPlayerId(null);
    }
  }, [basketPlayerId, safePlayers]);

  useEffect(() => {
    if (connecting) {
      if (connectingTimerRef.current) {
        clearTimeout(connectingTimerRef.current);
      }
      connectingTimerRef.current = setTimeout(() => {
        setShowConnecting(true);
      }, 400);
      return () => {
        if (connectingTimerRef.current) {
          clearTimeout(connectingTimerRef.current);
          connectingTimerRef.current = null;
        }
      };
    }
    if (connectingTimerRef.current) {
      clearTimeout(connectingTimerRef.current);
      connectingTimerRef.current = null;
    }
    setShowConnecting(false);
  }, [connecting]);

  useEffect(() => {
    lastStateVersionRef.current = null;
  }, [room?.code]);

  // ---------- EFFECTS ----------

  // Таймер раунда
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
    const timer = setInterval(tick, 120);
    return () => clearInterval(timer);
  }, [
    auctionState?.phase,
    auctionState?.timeLeftMs,
    auctionState?.slotDeadlineAtMs,
    auctionState?.slotDeadlineAt,
    auctionState?.serverNowMs,
    paused,
  ]);

  useEffect(() => {
    if (phase !== "in_progress") {
      lastLeadingPlayerRef.current = null;
      return;
    }
    const currentLeader = leadingBid?.playerId ?? null;
    const lastLeader = lastLeadingPlayerRef.current;
    if (
      myPlayerId != null &&
      lastLeader === myPlayerId &&
      currentLeader != null &&
      currentLeader !== myPlayerId
    ) {
      const needed =
        leadingBid?.amount != null ? leadingBid.amount + 1 : null;
      const label = needed
        ? `Перебили — нужно ${moneyFormatter.format(needed)}💰`
        : "Перебили";
      pushToast({ type: "error", text: label, duration: 2400 });
      tg?.HapticFeedback?.notificationOccurred?.("warning");
    }
    lastLeadingPlayerRef.current = currentLeader;
  }, [
    leadingBid?.playerId,
    leadingBid?.amount,
    moneyFormatter,
    myPlayerId,
    phase,
    pushToast,
    tg,
  ]);

  // Создание socket.io
  useEffect(() => {
    if (!apiBase) return;
    const instance = ensureAuctionSocket({
      apiBase,
      initData,
      token: getSessionToken(),
    });
    if (!instance) return;

    socketRef.current = instance;
    setSocket(instance);
    setConnecting(!instance.connected);

    const handleConnect = () => {
      setConnecting(false);
      lastAuthTokenAttemptRef.current = "";
      const code = lastSubscribedCodeRef.current;
      if (code) {
        const recovered = Boolean((instance as any).recovered);
        subscribeToRoom(code, { force: true, resume: !recovered });
      }
    };

    const handleDisconnect = () => {
      setConnecting(true);
      lastSubscriptionSocketIdRef.current = null;
    };

    const handleConnectError = (err: any) => {
      setConnecting(false);
      const message = String(err?.message || "");
      const authMatch = message.match(AUTH_ERROR_RE);
      if (authMatch?.[1]) {
        const key = authMatch[1].toLowerCase();
        recoverSocketAuth().then((recovered) => {
          if (recovered) return;
          pushError(
            SERVER_ERROR_MESSAGES[key] ||
              "Сессия Telegram устарела. Открой игру заново из Telegram."
          );
        });
        return;
      }
      pushError(`Не удалось подключиться: ${err?.message || "ошибка соединения"}`);
    };

    const handleToast = (payload: any) => {
      if (!payload?.text) return;
      if (payload.type === "error") {
        pushError(payload.text);
        return;
      }
      pushToast(payload);
    };

    const handleRoomState = (payload: any) => {
      if (!payload) return;
      setRoom(payload.room || null);
      setPlayers(payload.players || []);
      if (typeof payload.viewerIsOwner === "boolean") {
        setViewerIsOwner(payload.viewerIsOwner);
      }
      clearError();
    };

    const handlePrivateSelf = (payload: any) => {
      if (!payload) return;
      setSelfInfo(payload);
    };

    const handleAuctionState = (state: any) => {
      if (!state) return;
      applyAuctionState(state);
      clearError();
    };

    instance.on("connect", handleConnect);
    instance.on("disconnect", handleDisconnect);
    instance.on("connect_error", handleConnectError);
    instance.on("toast", handleToast);
    instance.on("room:state", handleRoomState);
    instance.on("private:self", handlePrivateSelf);
    instance.on("auction:state", handleAuctionState);

    return () => {
      if (socketRef.current === instance) {
        socketRef.current = null;
      }
      try {
        instance.off("connect", handleConnect);
        instance.off("disconnect", handleDisconnect);
        instance.off("connect_error", handleConnectError);
        instance.off("toast", handleToast);
        instance.off("room:state", handleRoomState);
        instance.off("private:self", handlePrivateSelf);
        instance.off("auction:state", handleAuctionState);
      } catch {
        // ignore
      }
    };
  }, [
    apiBase,
    initData,
    pushError,
    pushToast,
    clearError,
    subscribeToRoom,
    applyAuctionState,
    recoverSocketAuth,
  ]);

  // Подписка по коду комнаты
  useEffect(() => {
    if (!room?.code) return;
    subscribeToRoom(room.code);
  }, [room?.code, subscribeToRoom]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const resume = () => {
      const code = room?.code || lastSubscribedCodeRef.current;
      if (!code) return;
      resumeAuctionState(code);
    };
    const handleVisibility = () => {
      if (document.visibilityState !== "visible") return;
      resume();
    };
    const handleFocus = () => resume();
    const handleOnline = () => resume();

    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("focus", handleFocus);
    window.addEventListener("online", handleOnline);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("focus", handleFocus);
      window.removeEventListener("online", handleOnline);
    };
  }, [room?.code, resumeAuctionState]);

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
      toastTimersRef.current.forEach((timeout) => clearTimeout(timeout));
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
          ...buildAuthHeaders(),
        },
        body: JSON.stringify({ game: AUCTION_GAME }),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        const code = (data as any)?.error || (data as any)?.message || "failed";
        pushError(
          mapServerError(code, resp.status, "Не удалось создать комнату")
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
      pushError("Не удалось создать комнату, попробуйте ещё раз");
    } finally {
      setCreating(false);
    }
  }

  async function joinRoom(rawCode?: string, options: { fromInvite?: boolean } = {}) {
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
      const resp = await fetch(`${apiBase}/api/rooms/${code}/join`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...buildAuthHeaders(),
        },
        body: JSON.stringify({ game: AUCTION_GAME }),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        const codeErr =
          (data as any)?.error || (data as any)?.message || "failed";
        pushError(
          mapServerError(codeErr, resp.status, "Не удалось войти в комнату")
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
      (resp: any) => {
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
      (resp: any) => {
        if (!resp || !resp.ok) {
          const map: Record<string, string> = {
            room_not_found: "Комната не найдена",
            forbidden_not_owner: "Только владелец может начать игру",
            need_at_least_2_players: "Нужно минимум 2 игрока",
            need_ready_players: "Нужно, чтобы все отметились «готов»",
            already_started: "Аукцион уже запущен",
            wrong_game: "Это комната другого режима",
          };
          pushError(map[resp?.error] || "Не удалось запустить аукцион");
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
        numericPrev > 0 ? numericPrev : activeBidFloor > 0 ? activeBidFloor : 0;
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
      pushError("Настройки сейчас недоступны.");
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
        text: "Применили локально, ждём ответ сервера.",
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
          pushError("Не удалось сохранить настройки.");
          return;
        }
        pushToast({ text: "Настройки обновлены" });
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

  function sendBid(forcedAmount?: number | null) {
    if (!socket || !room || !selfInfo) return;
    if (!auctionState || auctionState.phase !== "in_progress") return;
    if (paused) {
      pushToast({ type: "info", text: "Аукцион на паузе" });
      return;
    }
    if (isRevealPhase) {
      pushToast({ type: "info", text: "Открывается лутбокс" });
      return;
    }

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
    if (activeBidFloor > 0 && amount < activeBidFloor) {
      pushError(
        `Минимальная ставка ${moneyFormatter.format(activeBidFloor)}💰`
      );
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
            room_not_found: "Комната не найдена",
            not_running: "Аукцион ещё не запущен",
            not_player: "Вы не в комнате",
            not_participant: "Вы не участвуете",
            bad_amount: "Неверная сумма",
            not_enough_money: "Недостаточно денег",
            paused: "Аукцион на паузе",
            reveal: "Открывается лутбокс — ставки скоро продолжатся",
            bid_below_base: "Ставка ниже базовой",
            bid_below_current: "Ставка ниже текущей",
            wrong_game: "Это комната другого режима",
          };
          pushError(map[resp?.error] || "Не удалось принять ставку");
          tg?.HapticFeedback?.notificationOccurred?.("error");
        } else {
          clearError();
          tg?.HapticFeedback?.notificationOccurred?.("success");
          setBidPanelOpen(false);
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
            <span className="landing-logo__primary">АУКЦИОН</span>
            <span className="landing-logo__secondary">ПОЧУВСТВУЙ</span>
          </div>
          <div className="landing-title landing-title--highlight">
            СЕБЯ НЕПРИЛИЧНО БОГАТЫМ
          </div>
        </div>

        <div className="landing-tabs" role="tablist" aria-label="Действия">
          <button
            type="button"
            role="tab"
            aria-selected={landingMode === "join"}
            className={[
              "landing-tab",
              landingMode === "join" ? "is-active" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            onClick={() => setLandingMode("join")}
            disabled={joining || creating}
          >
            Войти
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={landingMode === "create"}
            className={[
              "landing-tab",
              landingMode === "create" ? "is-active" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            onClick={() => setLandingMode("create")}
            disabled={joining || creating}
          >
            Создать
          </button>
        </div>

        <div className="landing-form">
          <label
            className={[
              "field",
              landingMode === "create" ? "field--ghost" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            aria-hidden={landingMode === "create"}
          >
            <span className="field-label">Код комнаты</span>
            <input
              className="text-input text-input--large"
              type="text"
              inputMode="text"
              autoComplete="off"
              maxLength={6}
              value={codeInput}
              onChange={(e) => setCodeInput(normalizeCode(e.target.value))}
              disabled={landingMode === "create"}
              tabIndex={landingMode === "create" ? -1 : 0}
            />
          </label>

          {error && <div className="field-error">{error}</div>}

          <button
            type="button"
            className="btn btn--primary landing-cta"
            onClick={landingMode === "join" ? () => joinRoom() : createRoom}
            disabled={
              landingMode === "join"
                ? joining || !codeInput
                : creating
            }
          >
            {landingMode === "join"
              ? joining
                ? "Входим..."
                : "Войти в комнату"
              : creating
              ? "Создаём..."
              : "Создать аукцион"}
          </button>
        </div>

        {showConnecting && (
          <div className="landing-connect">Подключаемся к серверу...</div>
        )}
      </motion.div>
    </div>
  );

  const renderLandingCoins = () => (
    <div className="landing-coin-field" aria-hidden="true">
      {LANDING_COINS.map((coin, index) => {
        const icon = LANDING_MONEY_ICONS[index % LANDING_MONEY_ICONS.length];
        return (
          <span
            key={`landing-coin-${index}`}
            className="landing-coin"
            style={{
              backgroundImage: `url(${icon})`,
              ["--coin-left" as string]: coin.left,
              ["--coin-size" as string]: `${coin.size}px`,
              ["--coin-duration" as string]: coin.duration,
              ["--coin-delay" as string]: coin.delay,
              ["--coin-drift" as string]: coin.drift,
              ["--coin-opacity" as string]: String(coin.opacity),
            }}
          />
        );
      })}
    </div>
  );

  const renderLandingBag = () => (
    <img
      className="landing-bag"
      src={moneyBagUrl}
      alt=""
      aria-hidden="true"
      decoding="async"
    />
  );

  const renderLobbyContent = () => {
    if (!showLobby) return null;

    const readyTarget = Math.max(totalPlayers || 1, 1);
    const myReady = !!currentPlayer?.ready;
    const canStart = readyCount >= readyTarget;

    const primaryLabel = isOwner
      ? "Начать игру"
      : myReady
      ? "Я не готов"
      : "Я готов";

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

    // порядок игроков больше не зависит от ready — они не прыгают
    const sortedPlayers = safePlayers.slice();
    const slotsDisplay =
      slotMax ??
      (Array.isArray(auctionState?.slots) && auctionState.slots.length > 0
        ? auctionState.slots.length
        : 30);

    return (
      <div className="screen-body lobby-layout">
        <section className="card card--lobby-players">
          <div className="lobby-players-head">
            <h3 className="title-small lobby-players-title">
              <span>Игроки</span>
              <span className="lobby-players-title__count">
                {readyCount}/{readyTarget}
              </span>
            </h3>
            <div className="lobby-header-progress">
              <div className="lobby-header-progress__top">
                <span className="lobby-header-progress__label">
                  Готовность
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
            {isOwner && (
              <button
                type="button"
                className="icon-btn icon-btn--ghost lobby-settings"
                aria-label="Настройки комнаты"
                onClick={openSettings}
              >
                ⚙️
              </button>
            )}
          </div>
          <div className="lobby-stats">
            <div className="lobby-stat">
              <span className="lobby-stat__label">
                <span className="lobby-stat__icon" aria-hidden="true">💰</span>
                Банк на игрока
              </span>
              <span className="lobby-stat__value">
                {moneyFormatter.format(initialBank)}💰
              </span>
            </div>
            <div className="lobby-stat">
              <span className="lobby-stat__label">
                <span className="lobby-stat__icon" aria-hidden="true">📦</span>
                Лотов
              </span>
              <span className="lobby-stat__value">
                {slotsDisplay}
              </span>
            </div>
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
                  </div>
                  {isHost && (
                    <span
                      className="chip chip--host"
                      aria-label="Хост"
                      title="Хост комнаты"
                    >
                      👑
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
    const timeChipLabel = paused
      ? "Пауза"
      : isRevealPhase
      ? "Открытие"
      : timeLeftLabel;
    const leaderChipLabel =
      leadingBid?.amount != null
        ? `${moneyFormatter.format(leadingBid.amount)}💰`
        : "Нет ставок";
    const baseBidLabel = moneyFormatter.format(baseBid);
    const emptyPlayersLabel =
      playersTab === "leaders"
        ? "Ставок пока нет."
        : playersTab === "mine"
        ? "Вы ещё не в комнате."
        : "Никого нет, ждём подключения.";
    const emojiWrapClassName = [
      "lot-hero__emoji-wrap",
      isUrgent ? "lot-hero__emoji-wrap--urgent" : "",
      isCritical ? "lot-hero__emoji-wrap--critical" : "",
    ]
      .filter(Boolean)
      .join(" ");
    const ringStyle = {
      ["--ring-progress" as any]: ringProgress,
    };

    return (
      <div className="screen-body game-layout">
        <section className="lot-hero card card--lot" aria-label="Главный лот">
          <div className="lot-hero__index">
            <div className="lot-index__meta">
              <span className="lot-index__num">
                {slotIndex != null ? `#${slotIndex}` : "-"}
              </span>
              <span className="lot-index__suffix">
                {slotMax ? `из ${slotMax}` : ""}
              </span>
            </div>
            <span className="lot-index__balance" aria-label="Баланс">
              💲 {myBalance != null ? moneyFormatter.format(myBalance) : "-"}
            </span>
          </div>
          <div className="lot-hero__name">
            {currentSlot?.name || "Нет названия"}
          </div>
          <div className="lot-hero__meta">
            <span
              className={[
                "pill",
                "pill--tiny",
                "lot-hero__chip",
                paused ? "lot-hero__chip--paused" : "",
                isUrgent ? "lot-hero__chip--urgent" : "",
              ]
                .filter(Boolean)
                .join(" ")}
            >
              <span className="lot-hero__chip-icon" aria-hidden="true">
                ⏱
              </span>
              {timeChipLabel}
            </span>
            <span
              className="pill pill--tiny lot-hero__chip"
              title={leadingPlayerName ? `Лидер: ${leadingPlayerName}` : undefined}
            >
              <span className="lot-hero__chip-icon" aria-hidden="true">
                🏁
              </span>
              {leaderChipLabel}
            </span>
            <span className="pill pill--tiny lot-hero__chip">
              <span className="lot-hero__chip-icon" aria-hidden="true">
                💵
              </span>
              База {baseBidLabel}💰
            </span>
          </div>
          <div className={emojiWrapClassName}>
            <div
              className={[
                "lot-hero__ring",
                isUrgent ? "lot-hero__ring--active" : "",
                isCritical ? "lot-hero__ring--critical" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              style={ringStyle}
              aria-hidden="true"
            />
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
              {currentSlot?.type === "lootbox" ? (
                <img
                  className="lot-hero__emoji-img"
                  src={currentLootboxImageUrl}
                  alt=""
                  draggable={false}
                />
              ) : showLotImage ? (
                <img
                  className="lot-hero__emoji-img"
                  src={currentLotImageUrl}
                  alt=""
                  draggable={false}
                />
              ) : (
                lotEmoji
              )}
            </div>
          </div>
          <div className="lot-hero__bid">
            {heroBidText}
          </div>
          <div className="bid-cta">
            <button
              type="button"
              className="btn hero-bid-btn"
              onClick={() => setBidPanelOpen((prev) => !prev)}
              aria-expanded={bidPanelOpen}
            >
              <span className="hero-bid-btn__glow" aria-hidden />
              <span className="hero-bid-btn__icon" aria-hidden>
                ⚡
              </span>
              <span className="hero-bid-btn__label">
                {bidPanelOpen ? "Скрыть панель" : "Сделать ставку"}
              </span>
            </button>
          </div>
        </section>

        <section className="card card--players-live">
          <div className="players-tabs" role="tablist" aria-label="Фильтр игроков">
            <button
              type="button"
              role="tab"
              aria-selected={playersTab === "all"}
              className={[
                "players-tab",
                playersTab === "all" ? "is-active" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              onClick={() => setPlayersTab("all")}
            >
              Все
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={playersTab === "leaders"}
              className={[
                "players-tab",
                playersTab === "leaders" ? "is-active" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              onClick={() => setPlayersTab("leaders")}
            >
              Лидеры
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={playersTab === "mine"}
              className={[
                "players-tab",
                playersTab === "mine" ? "is-active" : "",
                myPlayerId == null ? "is-disabled" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              onClick={() => setPlayersTab("mine")}
              disabled={myPlayerId == null}
            >
              Моя корзина
            </button>
          </div>

          <div className="lobby-players-list lobby-players-list--ingame">
            {filteredPlayers.length === 0 && (
              <div className="empty-note">{emptyPlayersLabel}</div>
            )}
            {filteredPlayers.map((p) => {
              const name = playerDisplayName(p);
              const avatar = p.user?.photo_url || p.user?.avatar || "";
              const isHost = ownerPlayer?.id === p.id;
              const isSelf = myPlayerId === p.id;
              const isLeading = leadingBid?.playerId === p.id;

              return (
                <button
                  key={p.id}
                  type="button"
                  className={[
                    "lobby-player",
                    "lobby-player-btn",
                    "lobby-player--ingame",
                    isHost ? "lobby-player--host" : "",
                    isLeading ? "lobby-player--ready" : "",
                    isSelf ? "lobby-player--self" : "",
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
            <span className="label tiny">Прошлый лот</span>
            <div className="lot-last__content">
              <span className="lot-last__name">
                #{(lastFinishedSlot.index ?? 0) + 1} — {lastFinishedSlot.name}
              </span>
              <span className="lot-last__meta">
                {lastFinishedSlot.winnerPlayerId != null
                  ? `${playerDisplayName(
                      safePlayers.find(
                        (p) => p.id === lastFinishedSlot.winnerPlayerId
                      )
                    )} • `
                  : ""}
                {moneyFormatter.format(lastFinishedSlot.winBid || 0)}💰
              </span>
            </div>
          </section>
        )}
      </div>
    );
  };

  const renderBidDock = () => {
    if (!showGame) return null;
    return (
      <div
        className={["bid-dock", bidPanelOpen ? "bid-dock--open" : ""]
          .filter(Boolean)
          .join(" ")}
      >
        {bidPanelOpen && (
          <button
            type="button"
            className="bid-dock__backdrop"
            onClick={() => setBidPanelOpen(false)}
            aria-label="Закрыть панель ставок"
          />
        )}
        <div className="bid-dock__bar">
          <button
            type="button"
            className="btn bid-dock__cta"
            onClick={() => setBidPanelOpen((prev) => !prev)}
            aria-expanded={bidPanelOpen}
          >
            <span className="bid-dock__cta-icon" aria-hidden="true">
              ⚡
            </span>
            {bidPanelOpen ? "Скрыть панель" : "Сделать ставку"}
          </button>
        </div>

        <AnimatePresence initial={false}>
          {bidPanelOpen && (
            <motion.section
              className="bid-dock__panel card card--bid"
              initial={{ opacity: 0, y: 16, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 10, scale: 0.98 }}
              transition={{ duration: 0.24, ease: "easeOut" }}
            >
              <span className="label">Ставки</span>

              {isBiddingLocked && (
                <div className="callout">
                  {paused
                    ? "Аукцион на паузе — ставки временно закрыты."
                    : isRevealPhase
                    ? "Идёт открытие лутбокса — ставки скоро продолжатся."
                    : "Ставки доступны только во время раунда."}
                </div>
              )}

              <div className="bid-input-row">
                <div className="bid-input-field">
                  <input
                    className="text-input text-input--split"
                    inputMode="numeric"
                    placeholder="Введите ставку"
                    value={myBid}
                    onChange={(e) =>
                      setMyBid(e.target.value.replace(/[^\d]/g, ""))
                    }
                  />
                  <span className="text-input__suffix" aria-hidden="true">
                    💰
                  </span>
                </div>
                <div className="quick-bids" aria-label="Быстрые ставки">
                  {quickBidButtons.map((btn) => (
                    <button
                      key={btn.key}
                      type="button"
                      className="quick-bid"
                      onClick={() => btn.action()}
                      disabled={btn.disabled}
                    >
                      <span className="quick-bid__label">{btn.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="bid-actions bid-actions--secondary">
                <button
                  type="button"
                  className="btn bid-action bid-action--allin"
                  onClick={() => sendBid(myBalance || 0)}
                  disabled={
                    isBiddingLocked ||
                    busyBid ||
                    myBalance == null ||
                    myBalance <= 0
                  }
                >
                  Вабанк
                </button>
                <button
                  type="button"
                  className="btn bid-submit-split"
                  onClick={() => sendBid()}
                  disabled={busyBid || myBalance == null || isBiddingLocked}
                >
                  <span className="bid-submit-split__label">
                    {busyBid ? "..." : "Ставка"}
                  </span>
                  <span className="bid-submit-split__glow" aria-hidden />
                </button>
              </div>

              {isOwner && (
                <div className="owner-controls">
                  <button
                    type="button"
                    className="pill pill--ghost"
                    onClick={paused ? resumeAuction : pauseAuction}
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
            </motion.section>
          )}
        </AnimatePresence>
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
              <span className="label">Финиш</span>
              <h2 className="title">Итоги аукциона</h2>
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
                        {moneyFormatter.format(netWorth)}💰
                      </span>
                      <span className="result-row__meta muted">
                        Баланс {moneyFormatter.format(balance)}💰 · Покупки{" "}
                        {moneyFormatter.format(basketValue)}💰
                      </span>
                    </div>
                  </div>
                  {isWinner && (
                    <span className="chip chip--winner">Победитель</span>
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
                <span>Корзина: {moneyFormatter.format(basketValue)}💰</span>
                <span>Баланс: {moneyFormatter.format(balance)}💰</span>
                <span>Состояние: {moneyFormatter.format(worth)}💰</span>
              </div>
            </div>
            <button
              type="button"
              className="icon-btn icon-btn--ghost basket-close"
              aria-label="Закрыть корзину"
              onClick={() => setBasketPlayerId(null)}
            >
              ×
            </button>
          </div>

          <div className="basket-items">
            {basketItems.length === 0 && (
              <div className="basket-empty">Корзина пустая.</div>
            )}
            {basketItems.map((item, idx) => {
              const key = `${item.index ?? idx}-${item.name ?? idx}`;
              const value =
                Number(item.value ?? item.paid ?? item.basePrice ?? 0) || 0;
              const effect = item.effect;
              const effectKind = String(effect?.kind || "");
              const rawImageUrl =
                typeof item.imageUrl === "string" ? item.imageUrl.trim() : "";
              const imageUrl =
                rawImageUrl || (item.type === "lootbox" ? LOOTBOX_FALLBACK_IMAGE_URL : "");
              const fallbackEmoji = item.type === "lootbox" ? "🎁" : "📦";
              const cardTone =
                effectKind === "penalty"
                  ? "basket-item--bad"
                  : effectKind === "money" || effectKind === "lot"
                  ? "basket-item--good"
                  : "";

              return (
                <div className={["basket-item", cardTone].filter(Boolean).join(" ")} key={key}>
                  <div className="basket-item__media">
                    {imageUrl ? (
                      <img src={imageUrl} alt={item.name || "Лот"} loading="lazy" />
                    ) : (
                      <span className="basket-item__fallback" aria-hidden>
                        {fallbackEmoji}
                      </span>
                    )}
                  </div>
                  <div className="basket-item__info">
                    <span className="basket-item__name">
                      {item.name || "Без названия"}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  };

  const renderLootboxRevealModal = () => {
    if (!lootboxReveal) return null;

    const winnerPlayer =
      safePlayers.find((p) => p?.id === lootboxReveal.winnerPlayerId) || null;
    const winnerName = winnerPlayer
      ? playerDisplayName(winnerPlayer)
      : `Игрок ${lootboxReveal.winnerPlayerId}`;

    const effectKind = String(lootboxReveal.effect?.kind || "");
    const deltaAbs = Math.abs(Number(lootboxReveal.effect?.delta || 0));
    const deltaText = moneyFormatter.format(deltaAbs);

    const revealRarity =
      lootboxReveal.slotRarity ?? inferLootboxRarityFromName(lootboxReveal.slotName);
    const lootboxImageUrl = getLootboxImageUrl(revealRarity || null);

    const toneClass =
      effectKind === "money"
        ? "lootbox-panel--good"
        : effectKind === "penalty"
        ? "lootbox-panel--bad"
        : "lootbox-panel--empty";

    const effectLabel =
      effectKind === "money"
        ? "Бонус"
        : effectKind === "penalty"
        ? "Штраф"
        : effectKind === "lot"
        ? "Приз"
        : "Пусто";

    const prizeObj =
      lootboxReveal.effect?.prize && typeof lootboxReveal.effect.prize === "object"
        ? lootboxReveal.effect.prize
        : null;
    const prizeEmojiRaw = prizeObj ? String(prizeObj.emoji || "").trim() : "";
    const prizeNameRaw = prizeObj ? String(prizeObj.name || "").trim() : "";
    const prizeFullNameRaw = prizeObj ? String(prizeObj.fullName || "").trim() : "";
    const prizeParsed = prizeFullNameRaw ? splitEmojiLabel(prizeFullNameRaw) : null;
    const prizeBasePrice = prizeObj?.basePrice;
    const prizeNominalPrice = prizeObj?.nominalPrice;
    const prizeBasePriceText = Number.isFinite(Number(prizeBasePrice))
      ? `${moneyFormatter.format(Number(prizeBasePrice))}💰`
      : "";
    const prizeNominalPriceText = Number.isFinite(Number(prizeNominalPrice))
      ? `${moneyFormatter.format(Number(prizeNominalPrice))}💰`
      : "";
    const prizeImageUrl = prizeObj ? String(prizeObj.imageUrl || "").trim() : "";

    const prizeEmoji =
      prizeEmojiRaw ||
      prizeParsed?.emoji ||
      (effectKind === "money"
        ? "💰"
        : effectKind === "penalty"
        ? "💣"
        : effectKind === "lot"
        ? "🎁"
        : "🕸️");
    const showPrizeImage = effectKind === "lot" && Boolean(prizeImageUrl);
    const prizeName =
      prizeNameRaw ||
      prizeParsed?.text ||
      (effectKind === "money"
        ? "Денежный приз"
        : effectKind === "penalty"
        ? "Неприятность"
        : effectKind === "lot"
        ? "Предмет"
        : "Ничего");

    const prizeValue =
      effectKind === "money"
        ? `+${deltaText}💰`
        : effectKind === "penalty"
        ? `-${deltaText}💰`
        : effectKind === "lot"
        ? prizeNominalPriceText || prizeBasePriceText || "Предмет"
        : "Ничего";
    const shatterExploded = lootboxStage === "explode" || lootboxStage === "reveal";
    const shatterShaking = lootboxStage === "shake";
    const showIntact = lootboxStage === "intro" || lootboxStage === "shake";
    const showPieces = lootboxStage === "explode" || lootboxStage === "reveal";
    const showDrop = lootboxStage === "explode" || lootboxStage === "reveal";

    return (
      <div
        className="lootbox-modal"
        role="dialog"
        aria-modal="true"
        onClick={closeLootboxReveal}
      >
        <motion.div
          className={["lootbox-panel", toneClass].filter(Boolean).join(" ")}
          onClick={(e) => e.stopPropagation()}
          initial={{ opacity: 0, y: 14, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 10, scale: 0.98 }}
          transition={{ duration: 0.22, ease: "easeOut" }}
        >
          <div className="lootbox-panel__head">
            <div>
              <div className="lootbox-panel__label">Лутбокс</div>
              <h3 className="lootbox-panel__title">{lootboxReveal.slotName}</h3>
              <p className="lootbox-panel__subtitle">
                Открывает: {winnerName} · Ставка {moneyFormatter.format(lootboxReveal.winBid)}💰
              </p>
            </div>
            <button
              type="button"
              className="icon-btn icon-btn--ghost lootbox-close"
              aria-label="Закрыть"
              onClick={closeLootboxReveal}
            >
              ×
            </button>
          </div>

          <div className="lootbox-stage">
            <div className="lootbox-shatter-stage" aria-hidden="true">
              <div
                className={[
                  "lootbox-shatter",
                  shatterShaking ? "lootbox-shatter--shaking" : "",
                  isMiniApp ? "lootbox-shatter--lite" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                style={{
                  width: shatterSize,
                  height: shatterSize,
                }}
              >
                <AnimatePresence initial={false}>
                  {showIntact && (
                    <motion.img
                      key="lootbox-intact"
                      className="lootbox-shatter__img"
                      src={lootboxImageUrl}
                      alt=""
                      draggable={false}
                      initial={{ opacity: 0, scale: 0.985 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.985 }}
                      transition={{ duration: 0.22, ease: "easeOut" }}
                    />
                  )}
                </AnimatePresence>

                {showPieces &&
                  lootboxShatterPieces.map((piece) => (
                    <motion.div
                      key={piece.key}
                      className="lootbox-piece"
                      style={{
                        left: piece.left,
                        top: piece.top,
                        width: piece.width,
                        height: piece.height,
                        clipPath: piece.clipPath || undefined,
                        WebkitClipPath: piece.clipPath || undefined,
                        backgroundImage: `url(${lootboxImageUrl})`,
                        backgroundSize: `${shatterSize}px ${shatterSize}px`,
                        backgroundPosition: `${-piece.left}px ${-piece.top}px`,
                      }}
                      initial={{ x: 0, y: 0, rotate: 0, opacity: 1, scale: 1 }}
                      animate={{
                        x: shatterExploded ? piece.dx : 0,
                        y: shatterExploded ? piece.dy : 0,
                        rotate: shatterExploded ? piece.rotate : 0,
                        opacity: 1,
                        scale: shatterExploded ? 1.02 : 1,
                      }}
                      transition={{
                        duration: shatterDuration,
                        delay: piece.delay,
                        ease: "easeOut",
                      }}
                    />
                  ))}
                <AnimatePresence initial={false}>
                  {showDrop && (
                    <motion.div
                      key={lootboxReveal.id}
                      className="lootbox-drop"
                      initial={{ opacity: 0, scale: 0.6, y: 6 }}
                      animate={{ opacity: 1, scale: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.7, y: 6 }}
                      transition={{ duration: 0.32, ease: "easeOut" }}
                    >
                      <motion.div
                        className="lootbox-drop__glow"
                        aria-hidden="true"
                        initial={{ opacity: 0, scale: 0.7 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{ duration: 0.32, ease: "easeOut" }}
                      />
                      <motion.div
                        className="lootbox-drop__name"
                        initial={{ opacity: 0, y: -10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.28, duration: 0.26, ease: "easeOut" }}
                      >
                        {prizeName}
                      </motion.div>
                      <motion.div
                        className="lootbox-drop__emoji"
                        aria-hidden="true"
                        initial={{ opacity: 0, scale: 0.3 }}
                        animate={{ opacity: 1, scale: [0.3, 1.16, 1] }}
                        transition={{ duration: 0.62, ease: "easeOut" }}
                      >
                        {showPrizeImage ? (
                          <img
                            className="lootbox-drop__image"
                            src={prizeImageUrl}
                            alt=""
                            draggable={false}
                          />
                        ) : (
                          prizeEmoji
                        )}
                      </motion.div>
                      <motion.div
                        className="lootbox-drop__price"
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.36, duration: 0.26, ease: "easeOut" }}
                      >
                        {prizeValue}
                      </motion.div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>
            <div className="lootbox-drop__hint muted">
              Тапните по экрану, чтобы закрыть
            </div>
          </div>
        </motion.div>
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
            <h3 className="modal__title">Настройки комнаты</h3>
            <button
              type="button"
              className="icon-btn icon-btn--ghost"
              aria-label="Закрыть"
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
                  <span className="field-label">Количество лотов</span>
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
                  <span className="field-label">Бюджет игрока</span>
                  <span className="slider-field__value">
                    {moneyFormatter.format(settingsBudget)}💰
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
                  <span>{moneyFormatter.format(MIN_BUDGET)}💰</span>
                  <span>{moneyFormatter.format(MAX_BUDGET)}💰</span>
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
              Отмена
            </button>
            <button
              type="button"
              className="btn btn--primary btn--compact"
              onClick={saveSettings}
              disabled={savingSettings}
            >
              {savingSettings ? "Сохраняем..." : "Сохранить"}
            </button>
          </div>
        </div>
      </div>
    );
  };

  const renderToastStack = () => {
    if (!toastStack.length) return null;
    const content = (
      <div className="auction-toast-stack" role="status" aria-live="polite">
        <AnimatePresence initial={false}>
          {toastStack.map((item) => (
            <motion.div
              key={item.id}
              className={[
                "auction-toast",
                item.type === "error" ? "auction-toast--error" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              initial={{ opacity: 0, y: -24 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -16 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
            >
              <span className="auction-toast__text">{item.text}</span>
              <button
                type="button"
                className="auction-toast__close"
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
    const portalTarget =
      typeof document !== "undefined" ? document.body : null;
    return portalTarget ? createPortal(content, portalTarget) : content;
  };

  const appClassName = [
    "auction-app",
    showLanding ? "auction-app--landing" : "",
    `auction-app--phase-${phase}`,
    showGame ? "auction-app--with-bid-dock" : "",
    showGame && bidPanelOpen ? "auction-app--bid-dock-open" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={appClassName}>
      {showLanding ? renderLandingBag() : null}
      {showLanding ? renderLandingCoins() : null}
      <div className="screen-wrapper pt-safe">
        {showLobby && room?.code ? (
          <div className="lobby-code-floating">
            <button
              type="button"
              className="lobby-header-main__code lobby-header-main__code--floating"
              onClick={copyRoomCode}
              title="Скопировать код комнаты"
              aria-label="Скопировать код комнаты"
            >
              <span className="lobby-header-main__code-label">Код</span>
              <span className="lobby-header-main__code-value">
                #{room.code}
              </span>
            </button>
          </div>
        ) : null}
        {showLanding ? (
          renderLanding()
        ) : (
          <>
            <main className="screen-main">
              {renderLobbyContent()}
              {renderGameContent()}
              {renderResultsContent()}
            </main>
          </>
        )}
      </div>
      {renderBidDock()}
      {renderLootboxRevealModal()}
      {renderBasketModal()}
      {renderSettingsModal()}
      {renderToastStack()}
      <Confetti
        refConfetti={(instance) => {
          confettiRef.current = instance;
        }}
        style={{ position: "fixed", inset: 0, zIndex: 1600, pointerEvents: "none" }}
      />
    </div>
  );
}












