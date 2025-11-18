
// src/Auction.jsx
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import io from "socket.io-client";
import "./Auction.css";

const INITIAL_BANK = 1_000_000;
const CODE_ALPHABET_RE = /[^A-HJKMNPQRSTUVWXYZ23456789]/g;
const BID_PRESETS = [1_000, 5_000, 10_000, 25_000, 50_000];

const LANDING_CARDS = [
  {
    icon: "🚀",
    title: "Мгновенный старт",
    text: "Создай комнату и поделись кодом — друзья подключатся за секунды.",
  },
  {
    icon: "💰",
    title: "Честный аукцион",
    text: "У всех один банк. Важны стратегия, координация и скорость реакции.",
  },
  {
    icon: "🎯",
    title: "Балансированные составы",
    text: "Проверяй корзины игроков и собирай идеальные команды на вечер.",
  },
];

const PHASE_LABEL = {
  lobby: "Лобби",
  in_progress: "Идёт игра",
  finished: "Итоги",
};

const PHASE_DESC = {
  lobby: "Ждём, пока все отметятся и хост нажмёт «Старт».",
  in_progress: "Таймер тикает: делай ставку или пасуй.",
  finished: "Сверь корзины, выбери победителей и запускай реванш.",
};

function normalizeCode(value = "") {
  return value.toUpperCase().replace(CODE_ALPHABET_RE, "").slice(0, 6);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
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

function plural(value, one, few, many) {
  const v = Math.abs(value) % 100;
  const last = v % 10;
  if (v > 10 && v < 20) return many;
  if (last > 1 && last < 5) return few;
  if (last === 1) return one;
  return many;
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
  const [toast, setToast] = useState(null);

  const [busyBid, setBusyBid] = useState(false);
  const [myBid, setMyBid] = useState("");

  const [cfgOpen, setCfgOpen] = useState(false);
  const [cfgRules, setCfgRules] = useState({ timePerSlotSec: 9, maxSlots: 30 });
  const [cfgSlotsText, setCfgSlotsText] = useState("");

  const [selectedPlayerId, setSelectedPlayerId] = useState(null);
  const [playersPanelOpen, setPlayersPanelOpen] = useState(true);

  const deadlineAtRef = useRef(null);
  const [nowTick, setNowTick] = useState(0);
  const lastToastRef = useRef(null);
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
  const myRoundBid = useMemo(() => {
    if (myPlayerId == null) return null;
    const value = auctionState?.currentBids?.[myPlayerId];
    return typeof value === "number" ? value : null;
  }, [auctionState, myPlayerId]);

  const currentPlayer = useMemo(
    () => players.find((p) => p.id === myPlayerId) || null,
    [players, myPlayerId]
  );

  const isOwner = useMemo(() => {
    if (!room || !selfInfo) return false;
    return room.ownerId === selfInfo.userId;
  }, [room, selfInfo]);

  const everyoneReadyExceptOwner = useMemo(() => {
    if (!room || !players.length) return false;
    return players
      .filter((p) => p.user?.id !== room.ownerId)
      .every((p) => p.ready);
  }, [room, players]);

  const playerNameById = useMemo(() => {
    const map = new Map();
    players.forEach((p) => map.set(p.id, playerDisplayName(p)));
    (auctionState?.players || []).forEach((p) => {
      if (!map.has(p.id)) {
        map.set(p.id, p.name);
      }
    });
    return map;
  }, [players, auctionState]);

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
    return players[0]?.id ?? null;
  }, [selectedPlayerId, myPlayerId, players]);

  const selectedPlayer = useMemo(
    () => players.find((p) => p.id === selectedPlayerIdEffective) || null,
    [players, selectedPlayerIdEffective]
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
  useEffect(() => {
    if (!auctionState?.timeLeftMs) {
      deadlineAtRef.current = null;
      return;
    }
    deadlineAtRef.current = Date.now() + Math.max(0, auctionState.timeLeftMs);
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
      const currentSocketId = socket.id ?? null;
      const alreadySame =
        lastSubscribedCodeRef.current === code &&
        lastSubscriptionSocketIdRef.current === currentSocketId &&
        currentSocketId != null;
      if (!force && alreadySame) return;
      lastSubscribedCodeRef.current = code;
      socket.emit("room:subscribe", { code });
      socket.emit("auction:sync", { code });
      if (currentSocketId) {
        lastSubscriptionSocketIdRef.current = currentSocketId;
      }
    },
    [socket]
  );
  useEffect(() => {
    const code = room?.code;
    if (!code) return;
    subscribeToRoom(code);
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
      setError(`Не удалось подключиться: ${err.message}`);
    });

    instance.on("toast", (payload) => {
      if (!payload?.text) return;
      lastToastRef.current = payload;
      setToast(payload);
      if (payload.type === "error") {
        setError(payload.text);
      }
    });

    instance.on("room:state", (payload) => {
      if (!payload) return;
      setRoom(payload.room || null);
      setPlayers(payload.players || []);
      setError("");
    });

    instance.on("private:self", (payload) => {
      if (!payload) return;
      setSelfInfo(payload);
    });

    instance.on("auction:state", (state) => {
      if (!state) return;
      setAuctionState(state);
      setError("");
    });

    return () => {
      try {
        instance.off("toast");
        instance.off("room:state");
        instance.off("private:self");
        instance.off("auction:state");
        instance.disconnect();
      } catch {
        // ignore
      }
    };
  }, [apiBase, initData]);

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
    if (!toast) return;
    const timeout = setTimeout(() => {
      if (lastToastRef.current === toast) {
        setToast(null);
      }
    }, 2600);
    return () => clearTimeout(timeout);
  }, [toast]);
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

  useEffect(() => {
    if (!players.length) {
      setSelectedPlayerId(null);
      return;
    }
    if (
      selectedPlayerId == null ||
      !players.some((p) => p.id === selectedPlayerId)
    ) {
      setSelectedPlayerId(selfInfo?.roomPlayerId ?? players[0].id);
    }
  }, [players, selectedPlayerId, selfInfo?.roomPlayerId]);

  useEffect(() => {
    if (!room) return;
    setPlayersPanelOpen(true);
  }, [room?.code]);

  useEffect(() => {
    if (!sanitizedAutoCode) return;
    if (!room && !codeInput) {
      setCodeInput(sanitizedAutoCode);
    }
  }, [sanitizedAutoCode, room, codeInput]);
  async function createRoom() {
    if (!initData) {
      setError("Нет initData от Telegram");
      return;
    }
    setCreating(true);
    setError("");
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
        const message =
          code === "code_already_in_use"
            ? "Код комнаты уже занят"
            : "Не удалось создать комнату";
        setError(message);
        return;
      }
      setRoom(data.room || null);
      setPlayers(data.players || []);
      if (data.room?.code) {
        setCodeInput(data.room.code);
        subscribeToRoom(data.room.code, { force: true });
      }
    } catch {
      setError("Ошибка сети при создании комнаты");
    } finally {
      setCreating(false);
    }
  }

  async function joinRoom(rawCode, options = {}) {
    if (!initData) {
      setError("Нет initData от Telegram");
      return;
    }
    const code = normalizeCode(rawCode || codeInput);
    if (!code) {
      setError("Введите код комнаты");
      return;
    }
    setJoining(true);
    setError("");
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
        setError(map[codeErr] || "Не удалось войти");
        return;
      }
      setRoom(data.room || null);
      setPlayers(data.players || []);
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
      setError("Ошибка сети при входе в комнату");
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
          setError("Не удалось изменить статус «Готов»");
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
            forbidden_not_owner: "Только владелец может стартовать",
            need_at_least_2_players: "Нужно минимум два игрока",
            need_ready_players: "Попроси всех нажать «Готов»",
            already_started: "Аукцион уже запущен",
          };
          setError(map[resp?.error] || "Не удалось начать аукцион");
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
          setError(resp?.errorText || "Не удалось сохранить настройки");
          return;
        }
        const payload = { type: "info", text: "Настройки обновлены" };
        lastToastRef.current = payload;
        setToast(payload);
        setError("");
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

  function setBidRelative(delta) {
    setMyBid((prev) => {
      const current = Number(String(prev).replace(/\s/g, "")) || 0;
      const max = myBalance ?? INITIAL_BANK;
      return String(clamp(current + delta, 0, max));
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
      setError("Введите корректную сумму");
      return;
    }
    if (myBalance != null && amount > myBalance) {
      setError("Ставка превышает ваш баланс");
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
          setError(map[resp?.error] || "Не удалось принять ставку");
          return;
        }
        setMyBid("");
        setError("");
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
    } catch {
      // ignore
    }
    try {
      socket?.emit("room:leave", { code });
    } catch {
      // ignore
    }
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
      const payload = { type: "info", text: "Код скопирован" };
      lastToastRef.current = payload;
      setToast(payload);
    } catch {
      const payload = { type: "error", text: "Не удалось скопировать" };
      lastToastRef.current = payload;
      setToast(payload);
    }
  }

  const readyCount = useMemo(() => {
    if (!players.length || !room) return 0;
    return players.filter((p) => p.ready && p.user?.id !== room.ownerId).length;
  }, [players, room]);

  const playedSlots = auctionState?.slotsPlayed ?? 0;
  const maxSlots = auctionState?.maxSlots ?? Number(cfgRules.maxSlots) || 30;

  const showLobby = phase === "lobby";
  const showGame = phase === "in_progress";
  const showResult = phase === "finished";

  const primaryActionLabel = isOwner
    ? showLobby
      ? "Старт"
      : showGame
      ? "Следующий"
      : "Реванш"
    : currentPlayer?.ready
    ? "Я не готов"
    : "Я готов";

  const primaryActionDisabled = isOwner
    ? showLobby && !everyoneReadyExceptOwner
    : !currentPlayer;

  const primaryActionHandler = isOwner
    ? showLobby || showResult
      ? handleStartAuction
      : forceNext
    : toggleReady;
  function renderLanding() {
    return (
      <div className="auction-screen">
        <section className="auction-card hero-card">
          <div className="badge-row">
            <span className="badge">AUCTION</span>
            <span className="badge ghost">{connecting ? "подключаемся…" : "онлайн"}</span>
          </div>
          <h1>Собери идеальную команду</h1>
          <p className="muted">
            Прозрачные ставки, быстрый темп и красивый интерфейс для вечеринок и турниров.
          </p>
          <div className="hero-actions">
            <button
              type="button"
              className="accent-btn xl"
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
        </section>
        <section className="auction-card landing-grid">
          {LANDING_CARDS.map((card) => (
            <article key={card.title} className="landing-card">
              <div className="landing-icon" aria-hidden="true">
                {card.icon}
              </div>
              <h3>{card.title}</h3>
              <p>{card.text}</p>
            </article>
          ))}
        </section>
        {error && <div className="auction-error prominent">{error}</div>}
      </div>
    );
  }

  function renderHero() {
    if (!room) return null;
    return (
      <section className="auction-card dashboard">
        <header className="dashboard-top">
          <div>
            <span className="badge">Комната</span>
            <div className="room-code">
              <strong>{room.code}</strong>
              <button type="button" className="chip ghost" onClick={copyRoomCode}>
                Скопировать
              </button>
            </div>
          </div>
          <button type="button" className="chip ghost danger" onClick={handleExit}>
            Выйти
          </button>
        </header>
        <div className="phase">
          <div>
            <span className="badge ghost">{PHASE_LABEL[phase] || "Аукцион"}</span>
            <h2>{PHASE_DESC[phase] || ""}</h2>
          </div>
          {myBalance != null && (
            <div className="my-balance">
              <span>Баланс</span>
              <strong>{moneyFormatter.format(myBalance)}$</strong>
            </div>
          )}
        </div>
        <div className="stats-grid">
          <div>
            <span className="label">Игроки</span>
            <strong>{players.length}</strong>
            <p className="muted">
              Готовы: {readyCount}/{Math.max(players.length - 1, 0)}
            </p>
          </div>
          <div>
            <span className="label">Слоты</span>
            <strong>
              {playedSlots}/{maxSlots}
            </strong>
            <p className="muted">Банк: {moneyFormatter.format(INITIAL_BANK)}$</p>
          </div>
          <div>
            <span className="label">Код</span>
            <strong>{room.code}</strong>
            <p className="muted">Поделись с друзьями</p>
          </div>
        </div>
      </section>
    );
  }
  function renderPlayers() {
    if (!room) return null;
    return (
      <section className="auction-card roster-card">
        <header className="section-head">
          <div>
            <span className="label">Состав</span>
            <h3>Экипаж комнаты</h3>
          </div>
          <button
            type="button"
            className="chip ghost"
            onClick={() => setPlayersPanelOpen((open) => !open)}
          >
            {playersPanelOpen ? "Скрыть" : "Показать"}
          </button>
        </header>
        <div className={`roster ${playersPanelOpen ? "open" : "collapsed"}`}>
          {players.map((p) => {
            const name = playerDisplayName(p);
            const balance = balances[p.id] ?? null;
            const wins = winsByPlayerId.get(p.id) || 0;
            const avatarUrl = p.user?.photo_url || p.user?.avatar || null;
            const isSelected = selectedPlayerIdEffective === p.id;
            const isHost = p.user?.id === room.ownerId;
            return (
              <button
                key={p.id}
                type="button"
                className={
                  "player-chip" +
                  (p.ready ? " ready" : "") +
                  (isHost ? " host" : "") +
                  (isSelected ? " selected" : "")
                }
                onClick={() => setSelectedPlayerId(p.id)}
              >
                <div className="chip-avatar">
                  {avatarUrl ? (
                    <img src={avatarUrl} alt={name} />
                  ) : (
                    name.slice(0, 1).toUpperCase()
                  )}
                </div>
                <div className="chip-body">
                  <strong>{name}</strong>
                  <span className="muted">
                    {balance != null ? `${moneyFormatter.format(balance)}$` : "ожидаем…"}
                  </span>
                  <div className="chip-tags">
                    {isHost && <span className="badge ghost">хост</span>}
                    {p.ready ? (
                      <span className="badge success">готов</span>
                    ) : (
                      <span className="badge ghost">не готов</span>
                    )}
                    {wins > 0 && <span className="badge ghost">🏆 {wins}</span>}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </section>
    );
  }
  function renderLobby() {
    if (!showLobby || !room) return null;
    return (
      <section className="auction-card">
        <header className="section-head">
          <div>
            <span className="label">Лобби</span>
            <h3>Подготовка к аукциону</h3>
          </div>
        </header>
        {!isOwner && (
          <button
            type="button"
            className="accent-btn"
            onClick={toggleReady}
            disabled={!currentPlayer}
          >
            {currentPlayer?.ready ? "Я не готов" : "Я готов"}
          </button>
        )}
        {isOwner && (
          <>
            <button
              type="button"
              className="accent-btn"
              onClick={handleStartAuction}
              disabled={!everyoneReadyExceptOwner}
            >
              {everyoneReadyExceptOwner ? "Запустить аукцион" : "Ждём остальных…"}
            </button>
            <button
              type="button"
              className="ghost-btn compact"
              onClick={() => setCfgOpen((v) => !v)}
            >
              ⚙️ Настроить игру
            </button>
            {cfgOpen && (
              <div className="host-config">
                <label className="field">
                  <span>Время на лот (сек)</span>
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
                  <span>Количество слотов</span>
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
                <label className="field">
                  <span>Свои слоты (по одному на строку)</span>
                  <textarea
                    className="text-input"
                    rows={4}
                    placeholder="Игрок | 90000 | lot"
                    value={cfgSlotsText}
                    onChange={(e) => setCfgSlotsText(e.target.value)}
                  />
                </label>
                <button type="button" className="accent-btn" onClick={configureAuction}>
                  Применить
                </button>
              </div>
            )}
          </>
        )}
        <p className="muted">
          Каждый получает {moneyFormatter.format(INITIAL_BANK)}$. Побеждает игрок с максимальным
          остатком после {maxSlots} {plural(maxSlots, "слота", "слотов", "слотов")} или раньше,
          если закончится банк.
        </p>
      </section>
    );
  }
  function renderLive() {
    if (!showGame) return null;
    return (
      <section className="auction-card live-card">
        <header className="section-head">
          <div>
            <span className="label">Текущий лот</span>
            <h3>{currentSlot?.name || "Ожидание следующего слота"}</h3>
          </div>
          {auctionState?.paused && <span className="badge ghost">пауза</span>}
        </header>
        {currentSlot ? (
          <>
            <div className="lot-type">
              {currentSlot.type === "lootbox" ? "🎁 Скрытый лот" : "📦 Обычный лот"}
            </div>
            <p className="muted">
              База: {moneyFormatter.format(currentSlot.basePrice || 0)}$ · Слот {(
                auctionState.slotsPlayed ?? 0
              ) + 1} из {auctionState.maxSlots}
            </p>
            <div className="timer">
              <div className="timer-value">
                ⏳ {countdownStep != null ? countdownStep : "—"}
                {secsLeft != null && <span className="muted"> ({secsLeft} c)</span>}
              </div>
              {progressPct != null && (
                <div className="timer-bar" aria-hidden="true">
                  <div style={{ width: `${progressPct}%` }} />
                </div>
              )}
            </div>
            <div className="bid-panel">
              <label className="field">
                <span>Ваша ставка</span>
                <input
                  className="text-input"
                  inputMode="numeric"
                  placeholder="Сумма"
                  value={myBid}
                  onChange={(e) => setMyBid(e.target.value.replace(/[^\d]/g, ""))}
                />
              </label>
              <div className="quick-bids">
                {BID_PRESETS.map((step) => (
                  <button
                    key={step}
                    type="button"
                    className="chip ghost"
                    onClick={() => setBidRelative(step)}
                    disabled={myBalance == null || myBalance <= 0}
                  >
                    +{moneyFormatter.format(step)}
                  </button>
                ))}
                <button
                  type="button"
                  className="chip ghost"
                  onClick={() => sendBid(myBalance || 0)}
                  disabled={myBalance == null || myBalance <= 0}
                >
                  All-in
                </button>
                <button type="button" className="chip ghost" onClick={sendPass}>
                  Пас
                </button>
              </div>
              <button
                type="button"
                className="accent-btn"
                onClick={() => sendBid()}
                disabled={busyBid || myBalance == null}
              >
                {busyBid ? "Отправляем…" : "Сделать ставку"}
              </button>
            </div>
            <p className="muted">
              Баланс: {myBalance != null ? `${moneyFormatter.format(myBalance)}$` : "—"} · Текущая
              ставка: {typeof myRoundBid === "number" ? `${moneyFormatter.format(myRoundBid)}$` : "—"}
            </p>
            {isOwner && (
              <div className="owner-actions">
                {auctionState?.paused ? (
                  <button type="button" className="ghost-btn" onClick={resumeAuction}>
                    ▶ Продолжить
                  </button>
                ) : (
                  <button type="button" className="ghost-btn" onClick={pauseAuction}>
                    ⏸ Пауза
                  </button>
                )}
                <button type="button" className="ghost-btn" onClick={forceNext}>
                  ⏭ Следующий
                </button>
              </div>
            )}
          </>
        ) : (
          <p className="muted">Ожидаем следующий слот…</p>
        )}
      </section>
    );
  }
  function renderResults() {
    if (!showResult) return null;
    return (
      <section className="auction-card">
        <header className="section-head">
          <div>
            <span className="label">Финиш</span>
            <h3>Итоги аукциона</h3>
          </div>
        </header>
        <div className="results">
          {players
            .slice()
            .sort((a, b) => {
              const av = balances[a.id] ?? 0;
              const bv = balances[b.id] ?? 0;
              return bv - av;
            })
            .map((p) => {
              const balance = balances[p.id] ?? 0;
              const basketTotal = basketTotals[p.id] || 0;
              const name = playerDisplayName(p);
              const avatarUrl = p.user?.photo_url || p.user?.avatar || null;
              const isWinner = auctionState?.winners?.includes(p.id);
              return (
                <div key={p.id} className={"result-card" + (isWinner ? " winner" : "")}>
                  <div className="result-avatar">
                    {avatarUrl ? <img src={avatarUrl} alt={name} /> : name.slice(0, 1)}
                  </div>
                  <div className="result-body">
                    <strong>
                      {name} {isWinner && "🏆"}
                    </strong>
                    <span className="muted">
                      Баланс: {moneyFormatter.format(balance)}$ · Корзина: {moneyFormatter.format(basketTotal)}$
                    </span>
                  </div>
                </div>
              );
            })}
        </div>
        <div className="owner-actions">
          {isOwner && (
            <button type="button" className="accent-btn" onClick={handleStartAuction}>
              Сыграть снова с теми же
            </button>
          )}
          <button type="button" className="ghost-btn" onClick={handleExit}>
            Выйти в меню
          </button>
        </div>
      </section>
    );
  }

  function renderBasket() {
    if (!selectedPlayer) return null;
    return (
      <section className="auction-card">
        <header className="section-head">
          <div>
            <span className="label">Корзина</span>
            <h3>{playerDisplayName(selectedPlayer)}</h3>
          </div>
          <div className="badge ghost">
            {moneyFormatter.format(selectedBasketTotal || 0)}$
          </div>
        </header>
        {selectedBasket.length === 0 ? (
          <p className="muted">Этот игрок пока ничего не выиграл.</p>
        ) : (
          <div className="history">
            {selectedBasket.map((item) => (
              <div key={`${item.index}-${item.name}`} className="history-row">
                <strong>
                  #{(item.index ?? 0) + 1} · {item.type === "lootbox" ? "🎁 Скрытый лот" : "📦 Лот"}
                </strong>
                <span className="muted">{item.name}</span>
                <span className="muted">
                  Ставка: {moneyFormatter.format(item.paid || 0)}$ · Ценность: {moneyFormatter.format(item.value || 0)}$
                </span>
              </div>
            ))}
          </div>
        )}
      </section>
    );
  }
  function renderHistory() {
    if (!auctionState?.history?.length) return null;
    return (
      <section className="auction-card">
        <header className="section-head">
          <div>
            <span className="label">История</span>
            <h3>Все сыгранные слоты</h3>
          </div>
        </header>
        <div className="history">
          {auctionState.history.map((slot) => {
            const winner = slot.winnerPlayerId != null ? playerNameById.get(slot.winnerPlayerId) : null;
            let effectSuffix = "";
            if (slot.effect) {
              const delta = slot.effect.delta || 0;
              if (slot.effect.kind === "money" && delta > 0) {
                effectSuffix = ` +${moneyFormatter.format(delta)}$`;
              } else if (slot.effect.kind === "penalty" && delta < 0) {
                effectSuffix = ` ${moneyFormatter.format(delta)}$`;
              }
            }
            return (
              <div key={slot.index} className="history-row">
                <strong>
                  #{slot.index + 1} · {slot.type === "lootbox" ? "🎁 Скрытый лот" : "📦 Лот"}
                </strong>
                <span>{slot.name}</span>
                {winner ? (
                  <span className="muted">
                    Победил {winner} за {moneyFormatter.format(slot.winBid || 0)}$
                    {effectSuffix && <em>{effectSuffix}</em>}
                  </span>
                ) : (
                  <span className="muted">Все пасовали</span>
                )}
              </div>
            );
          })}
        </div>
      </section>
    );
  }
  return (
    <div className="auction-app">
      <div className="auction-bg" aria-hidden="true" />
      {!room ? (
        renderLanding()
      ) : (
        <div className="auction-screen">
          {renderHero()}
          {renderPlayers()}
          {renderLobby()}
          {renderLive()}
          {renderResults()}
          {renderBasket()}
          {renderHistory()}
          {error && <div className="auction-error">{error}</div>}
          <nav className="mobile-dock" aria-label="Быстрые действия">
            <button
              type="button"
              className="dock-btn"
              onClick={() => setPlayersPanelOpen((open) => !open)}
            >
              👥
              <span>{playersPanelOpen ? "Скрыть" : "Игроки"}</span>
            </button>
            <button
              type="button"
              className="dock-btn primary"
              onClick={primaryActionHandler}
              disabled={primaryActionDisabled}
            >
              ⚡️
              <span>{primaryActionLabel}</span>
            </button>
            <button type="button" className="dock-btn" onClick={handleExit}>
              ↩️
              <span>Меню</span>
            </button>
          </nav>
        </div>
      )}
      {toast && (
        <div className={`auction-toast ${toast.type || "info"}`} role="status" aria-live="polite">
          {toast.text}
        </div>
      )}
    </div>
  );
}
