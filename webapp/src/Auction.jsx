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
  const baseBid = currentSlot?.basePrice || 0;

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
      if (!map.has(p.id)) map.set(p.id, p.name);
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

  const compactHistory = useMemo(
    () => (auctionState?.history || []).slice(-6).reverse(),
    [auctionState?.history]
  );

  const readyCount = useMemo(() => {
    if (!room) return 0;
    return players.filter(
      (p) => p.ready && p.user?.id !== room.ownerId
    ).length;
  }, [players, room]);

  const nonHostPlayers = useMemo(() => {
    if (!room) return Math.max(players.length - 1, 0);
    return Math.max(players.length - 1, 0);
  }, [players.length, room]);

  const readyPercent = nonHostPlayers
    ? Math.round((readyCount / Math.max(nonHostPlayers, 1)) * 100)
    : 0;
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
      } catch {}
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
    } catch {}
  }, [phase, onProgress]);

  useEffect(() => {
    if (!players.length) {
      setSelectedPlayerId(null);
      return;
    }
    if (!players.some((p) => p.id === selectedPlayerId)) {
      setSelectedPlayerId(selfInfo?.roomPlayerId ?? players[0].id);
    }
  }, [players, selectedPlayerId, selfInfo?.roomPlayerId]);

  useEffect(() => {
    if (!room) return;
    setPlayersPanelOpen(true);
  }, [room?.code]);

  useEffect(() => {
    if (!sanitizedAutoCode || room || codeInput) return;
    setCodeInput(sanitizedAutoCode);
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
        setError(
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
        } catch {}
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
          setError("Не удалось изменить статус");
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
          setError(map[resp?.error] || "Не удалось запустить аукцион");
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
          setError(resp?.errorText || "Не удалось применить настройки");
        } else {
          const payload = { type: "info", text: "Настройки обновлены" };
          lastToastRef.current = payload;
          setToast(payload);
          setError("");
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
      setError("Введите корректную сумму");
      return;
    }
    if (myBalance != null && amount > myBalance) {
      setError("Ставка превышает ваш баланс");
      return;
    }
    if (amount > 0 && baseBid > 0 && amount < baseBid) {
      setError(`Минимальная ставка ${moneyFormatter.format(baseBid)}$`);
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
        } else {
          setMyBid("");
          setError("");
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
      const payload = { type: "info", text: "Код скопирован" };
      lastToastRef.current = payload;
      setToast(payload);
    } catch {
      const payload = { type: "error", text: "Не удалось скопировать" };
      lastToastRef.current = payload;
      setToast(payload);
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
        {error && <div className="auction-error prominent">{error}</div>}
      </div>
    </div>
  );

  const renderTopBar = () => (
    <header className="auction-topbar">
      <button type="button" className="icon-btn" onClick={handleExit}>
        ←
      </button>
      <div className="topbar-center">
        <span className="app-title">auction</span>
        <button type="button" className="pill" onClick={copyRoomCode}>
          {room?.code}
        </button>
      </div>
      <div className="topbar-meta">
        <span>{PHASE_LABEL[phase]}</span>
        {myBalance != null && <strong>{moneyFormatter.format(myBalance)}$</strong>}
      </div>
    </header>
  );

  const renderLotCard = () => {
    if (!showGame) return null;
    const icon = currentSlot?.type === "lootbox" ? "🎁" : "📦";
    return (
      <section className="panel lot-card">
        <div className="panel-head">
          <div>
            <span className="label">Лот</span>
            <h3>{currentSlot?.name || "Ждём слот"}</h3>
          </div>
          {auctionState?.paused && <span className="pill ghost">пауза</span>}
        </div>
        {currentSlot ? (
          <>
            <div className="lot-focus">
              <div className="lot-icon">{icon}</div>
              <div className="lot-meta">
                <strong>{moneyFormatter.format(baseBid)}$</strong>
                <span className="muted">
                  {currentSlot.type === "lootbox" ? "Скрытый" : "Обычный"} · слот {(
                    auctionState?.slotsPlayed ?? 0
                  ) + 1}
                  /{auctionState?.maxSlots}
                </span>
              </div>
            </div>
            <div className="timer">
              <div className="timer-value">{countdownStep != null ? countdownStep : "—"}</div>
              {secsLeft != null && <div className="muted small">{secsLeft} c</div>}
              {progressPct != null && (
                <div className="timer-bar">
                  <div style={{ width: `${progressPct}%` }} />
                </div>
              )}
            </div>
            <div className="bid-form">
              <input
                className="text-input"
                inputMode="numeric"
                placeholder="Ставка"
                value={myBid}
                onChange={(e) => setMyBid(e.target.value.replace(/[^\d]/g, ""))}
              />
              <div className="quick-bids">
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
              <button
                type="button"
                className="accent-btn"
                onClick={() => sendBid()}
                disabled={busyBid || myBalance == null}
              >
                {busyBid ? "Отправляем…" : "Сделать ставку"}
              </button>
            </div>
            <div className="muted tiny">
              Баланс: {myBalance != null ? `${moneyFormatter.format(myBalance)}$` : "—"} · Ставка:{" "}
              {typeof myRoundBid === "number" ? `${moneyFormatter.format(myRoundBid)}$` : "—"}
            </div>
            {isOwner && (
              <div className="owner-row">
                <button
                  type="button"
                  className="pill ghost"
                  onClick={auctionState?.paused ? resumeAuction : pauseAuction}
                >
                  {auctionState?.paused ? "▶" : "⏸"}
                </button>
                <button type="button" className="pill ghost" onClick={forceNext}>
                  ⏭
                </button>
              </div>
            )}
          </>
        ) : (
          <p className="muted">Комната готова к старту.</p>
        )}
      </section>
    );
  };
  const renderLobbyCard = () => {
    if (!showLobby) return null;
    return (
      <section className="panel lobby-card">
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
                : `${players.length} игрок${players.length === 1 ? "" : "ов"}`}
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
                  className="pill ghost"
                  onClick={() => setCfgOpen((v) => !v)}
                >
                  Настройки
                </button>
              </>
            )}
          </div>
        </div>
        {isOwner && cfgOpen && (
          <div className="host-config">
            <label className="field">
              <span>Время, сек</span>
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
              <span>Слотов</span>
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
              <span>Слоты списком</span>
              <textarea
                className="text-input"
                rows={3}
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
      </section>
    );
  };

  const renderResultsCard = () => {
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
          {players
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

  const renderBasketCard = () => {
    if (!selectedPlayer) return null;
    return (
      <section className="panel">
        <div className="panel-head">
          <div>
            <span className="label">Корзина</span>
            <h3>{playerDisplayName(selectedPlayer)}</h3>
          </div>
          <span className="pill ghost">
            {moneyFormatter.format(selectedBasketTotal || 0)}$
          </span>
        </div>
        {selectedBasket.length === 0 ? (
          <p className="muted">Без побед.</p>
        ) : (
          <div className="history">
            {selectedBasket.map((item) => (
              <div key={`${item.index}-${item.name}`} className="history-row">
                <strong>
                  #{(item.index ?? 0) + 1} · {item.type === "lootbox" ? "🎁" : "📦"}
                </strong>
                <span>{item.name}</span>
                <span className="muted">
                  {moneyFormatter.format(item.paid || 0)}$ / {moneyFormatter.format(item.value || 0)}$
                </span>
              </div>
            ))}
          </div>
        )}
      </section>
    );
  };

  const renderHistoryCard = () => {
    if (!compactHistory.length) return null;
    return (
      <section className="panel compact">
        <div className="panel-head">
          <div>
            <span className="label">Последние</span>
            <h3>Лоты</h3>
          </div>
        </div>
        <div className="history">
          {compactHistory.map((slot) => {
            const winner = slot.winnerPlayerId != null ? playerNameById.get(slot.winnerPlayerId) : null;
            return (
              <div key={slot.index} className="history-row">
                <strong>
                  #{slot.index + 1} · {slot.type === "lootbox" ? "🎁" : "📦"}
                </strong>
                <span>{slot.name}</span>
                <span className="muted">
                  {winner ? `${winner} · ${moneyFormatter.format(slot.winBid || 0)}$` : "пас"}
                </span>
              </div>
            );
          })}
        </div>
      </section>
    );
  };

  const renderPlayersPanel = () => (
    <section className="panel players-panel">
      <div className="panel-head">
        <div>
          <span className="label">Игроки</span>
          <h3>{players.length}</h3>
        </div>
        <button
          type="button"
          className="pill ghost"
          onClick={() => setPlayersPanelOpen((open) => !open)}
        >
          {playersPanelOpen ? "Скрыть" : "Показать"}
        </button>
      </div>
      <div className={`players-grid ${playersPanelOpen ? "open" : "collapsed"}`}>
        {players.map((p) => {
          const name = playerDisplayName(p);
          const balance = balances[p.id] ?? null;
          const wins = winsByPlayerId.get(p.id) || 0;
          const avatarUrl = p.user?.photo_url || p.user?.avatar || null;
          const isSelected = selectedPlayerIdEffective === p.id;
          const isHostTile = p.user?.id === room?.ownerId;
          return (
            <button
              key={p.id}
              type="button"
              className={
                "player-tile" +
                (p.ready ? " ready" : "") +
                (isSelected ? " selected" : "")
              }
              onClick={() => setSelectedPlayerId(p.id)}
            >
              <div className="player-thumb">
                {avatarUrl ? <img src={avatarUrl} alt={name} /> : name.slice(0, 1)}
              </div>
              <div className="player-name">
                {name}
                {isHostTile && " ★"}
              </div>
              <div className="player-balance">
                {balance != null ? `${moneyFormatter.format(balance)}$` : "—"}
              </div>
              {wins > 0 && <div className="player-pill">🏆 {wins}</div>}
            </button>
          );
        })}
      </div>
    </section>
  );

  const stackPanels = [
    showLobby ? renderLobbyCard() : null,
    showGame ? renderLotCard() : null,
    showResult ? renderResultsCard() : null,
    !showLobby && !showResult ? renderBasketCard() : null,
    !showLobby ? renderHistoryCard() : null,
    !showLanding && error ? <div className="auction-error">{error}</div> : null,
  ].filter(Boolean);
  return (
    <div className="auction-app">
      <div className="ambient" aria-hidden="true" />
      {showLanding ? (
        renderLanding()
      ) : (
        <>
          {renderTopBar()}
          <div className="app-grid">
            <div className="stack">
              {stackPanels}
            </div>
            {renderPlayersPanel()}
          </div>
          <nav className="auction-dock" aria-label="Actions">
            <button
              type="button"
              className="dock-btn"
              onClick={() => setPlayersPanelOpen((open) => !open)}
            >
              <strong>Игроки</strong>
              <span>{playersPanelOpen ? "Скрыть" : "Показать"}</span>
            </button>
            <button
              type="button"
              className="dock-btn primary"
              onClick={primaryActionHandler}
              disabled={primaryActionDisabled}
            >
              <strong>Действие</strong>
              <span>{primaryActionLabel}</span>
            </button>
            <button type="button" className="dock-btn" onClick={handleExit}>
              <strong>Выход</strong>
              <span>Меню</span>
            </button>
          </nav>
        </>
      )}
      {toast && (
        <div className={`auction-toast ${toast.type || "info"}`} role="status" aria-live="polite">
          {toast.text}
        </div>
      )}
    </div>
  );
}




