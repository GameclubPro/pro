// src/Auction.jsx
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import io from "socket.io-client";
import "./Auction.css";

const INITIAL_MONEY = 1_000_000;

// такой же алфавит для кода комнаты, как в мафии (без 0/1/O/I)
const CODE_ALPHABET_RE = /[^A-HJKMNPQRSTUVWXYZ23456789]/g;

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

  const [room, setRoom] = useState(null); // { code, ownerId, ... }
  const [players, setPlayers] = useState([]); // из room:state
  const [selfInfo, setSelfInfo] = useState(null); // private:self { roomPlayerId, userId, ... }
  const [auctionState, setAuctionState] = useState(null); // из auction:state

  // локальный дедлайн активного слота (по серверному timeLeftMs), чтобы анимировать таймер без частого трафика
  const deadlineAtRef = useRef(null);
  const [nowTick, setNowTick] = useState(0);

  const [creating, setCreating] = useState(false);
  const [joining, setJoining] = useState(false);
  const [codeInput, setCodeInput] = useState("");
  const [error, setError] = useState("");
  const [busyBid, setBusyBid] = useState(false);
  const [myBid, setMyBid] = useState("");

  const [selectedPlayerId, setSelectedPlayerId] = useState(null);
  const [toast, setToast] = useState(null);
  const lastToastRef = useRef(null);
  const progressSentRef = useRef(false);

  // конфиг (хост, лобби)
  const [cfgOpen, setCfgOpen] = useState(false);
  const [cfgRules, setCfgRules] = useState({
    timePerSlotSec: 9,
    maxSlots: 30,
  });
  const [cfgSlotsText, setCfgSlotsText] = useState("");

  // --------- derived ---------
  const currentPlayer = useMemo(
    () => players.find((p) => p.id === selfInfo?.roomPlayerId) || null,
    [players, selfInfo]
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

  const moneyFormatter = useMemo(() => new Intl.NumberFormat("ru-RU"), []);

  const balancesByPlayerId = auctionState?.balances || {};
  const myBalance =
    selfInfo && balancesByPlayerId
      ? balancesByPlayerId[selfInfo.roomPlayerId] ?? null
      : null;

  const phase = auctionState?.phase || "lobby";
  const currentSlot = auctionState?.currentSlot || null;

  // мои данные по текущему раунду
  const myRoundBid = useMemo(() => {
    if (!selfInfo) return null;
    const v = auctionState?.currentBids?.[selfInfo.roomPlayerId];
    return typeof v === "number" ? v : null;
  }, [auctionState, selfInfo]);

  // тиканье таймера (локально), сервер присылает timeLeftMs
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
    const t = setInterval(
      () => setNowTick((x) => (x + 1) % 1_000_000),
      250
    );
    return () => clearInterval(t);
  }, [auctionState?.phase, auctionState?.timeLeftMs]);

  const secsLeft = useMemo(() => {
    if (!deadlineAtRef.current) return null;
    const diff = Math.ceil((deadlineAtRef.current - Date.now()) / 1000);
    return Math.max(0, diff);
  }, [nowTick]);

  const timePerSlot =
    auctionState?.rules?.timePerSlotSec || cfgRules.timePerSlotSec;
  const progressPct = useMemo(() => {
    if (secsLeft == null || !timePerSlot) return null;
    const spent = Math.max(0, timePerSlot - secsLeft);
    return Math.min(100, Math.round((spent / timePerSlot) * 100));
  }, [secsLeft, timePerSlot]);

  // крупный счёт 3-2-1 по ~треть таймера
  const countdownStep = useMemo(() => {
    if (secsLeft == null || !timePerSlot) return null;
    const slice = Math.max(1, Math.round(timePerSlot / 3));
    if (secsLeft > 2 * slice) return 3;
    if (secsLeft > slice) return 2;
    if (secsLeft >= 0) return 1;
    return null;
  }, [secsLeft, timePerSlot]);

  const playerNameById = useMemo(() => {
    const map = new Map();
    players.forEach((p) => {
      const name = p.user?.first_name || p.user?.username || `Игрок ${p.id}`;
      map.set(p.id, name);
    });
    if (auctionState?.players) {
      auctionState.players.forEach((p) => {
        if (!map.has(p.id)) map.set(p.id, p.name);
      });
    }
    return map;
  }, [players, auctionState]);

  // Мини-стата по победам
  const winsCountByPlayerId = useMemo(() => {
    const map = new Map();
    if (!auctionState?.history) return map;
    for (const h of auctionState.history) {
      if (h.winnerPlayerId == null) continue;
      map.set(h.winnerPlayerId, (map.get(h.winnerPlayerId) || 0) + 1);
    }
    return map;
  }, [auctionState]);

  // корзины игроков (отдаёт сервер)
  const basketByPlayerId = auctionState?.baskets || {};
  const basketTotals = auctionState?.basketTotals || {};

  // кого показываем в панели корзины: выбранного или себя
  const selectedPlayerIdEffective = useMemo(() => {
    if (selectedPlayerId != null) return selectedPlayerId;
    return selfInfo?.roomPlayerId ?? null;
  }, [selectedPlayerId, selfInfo]);

  const selectedPlayer = useMemo(
    () =>
      players.find((p) => p.id === selectedPlayerIdEffective) || null,
    [players, selectedPlayerIdEffective]
  );

  const selectedBasket = useMemo(() => {
    if (!selectedPlayerIdEffective) return [];
    const raw =
      basketByPlayerId[selectedPlayerIdEffective] ||
      basketByPlayerId[String(selectedPlayerIdEffective)] ||
      [];
    return Array.isArray(raw) ? raw : [];
  }, [basketByPlayerId, selectedPlayerIdEffective]);

  const selectedBasketTotal =
    selectedPlayerIdEffective != null
      ? basketTotals[selectedPlayerIdEffective] ??
        basketTotals[String(selectedPlayerIdEffective)] ??
        0
      : 0;

  // --------- socket init ---------
  useEffect(() => {
    if (!apiBase) return;
    const s = io(apiBase, {
      transports: ["websocket"],
      auth: { initData: initData || "" },
    });

    setSocket(s);

    s.on("connect", () => {
      setConnecting(false);
    });

    s.on("connect_error", (err) => {
      setConnecting(false);
      setError(`Не удалось подключиться: ${err.message}`);
    });

    s.on("toast", (payload) => {
      if (!payload?.text) return;
      lastToastRef.current = payload;
      setToast(payload);
      // если явная ошибка — покажем ещё и в error
      if (payload.type === "error") {
        setError(payload.text);
      }
    });

    s.on("room:state", (state) => {
      if (!state) return;
      setRoom(state.room || null);
      setPlayers(state.players || []);
    });

    s.on("private:self", (payload) => {
      if (!payload) return;
      setSelfInfo(payload);
    });

    s.on("auction:state", (st) => {
      if (!st) return;
      setAuctionState(st);
      setError("");
    });

    return () => {
      try {
        s.off("toast");
        s.off("room:state");
        s.off("private:self");
        s.off("auction:state");
        s.disconnect();
      } catch {
        // ignore
      }
    };
  }, [apiBase, initData]);

  // авто-скрытие тоста
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => {
      if (lastToastRef.current === toast) {
        setToast(null);
      }
    }, 2500);
    return () => clearTimeout(t);
  }, [toast]);

  // --------- BackButton из Telegram ---------
  useEffect(() => {
    if (!setBackHandler) return;
    const handler = () => {
      handleExit();
    };
    setBackHandler(handler);
    return () => setBackHandler(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setBackHandler, room, socket, initData]);

  // --------- авто-join по инвайт-коду ---------
  useEffect(() => {
    if (!socket) return;
    if (!autoJoinCode) return;
    joinRoom(autoJoinCode, { fromInvite: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socket]);

  // --------- начисление прогресса при завершении ---------
  useEffect(() => {
    if (!auctionState || auctionState.phase !== "finished") return;
    if (progressSentRef.current) return;
    progressSentRef.current = true;
    try {
      onProgress?.();
    } catch {
      // ignore
    }
  }, [auctionState, onProgress]);

  // ===================== API helpers =====================

  async function createRoom() {
    if (!initData) {
      setError("Нет initData от Telegram");
      return;
    }
    setError("");
    setCreating(true);
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
        const msg =
          code === "code_already_in_use"
            ? "Код комнаты уже занят"
            : "Не удалось создать комнату";
        setError(msg);
        return;
      }
      setRoom(data.room || null);
      setPlayers(data.players || []);
      if (socket && data.room?.code) {
        socket.emit("room:subscribe", { code: data.room.code });
        socket.emit("auction:sync", { code: data.room.code });
      }
      setCodeInput(data.room?.code || "");
    } catch (e) {
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
    const code = String(rawCode || "").trim().toUpperCase();
    if (!code) {
      setError("Введите код комнаты");
      return;
    }
    setError("");
    setJoining(true);
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
        const msgMap = {
          room_not_found: "Комната не найдена",
          room_full: "Комната заполнена",
          game_in_progress: "Игра уже началась",
        };
        setError(msgMap[codeErr] || "Не удалось войти в комнату");
        return;
      }

      setRoom(data.room || null);
      setPlayers(data.players || []);
      setCodeInput(code);

      if (socket) {
        socket.emit("room:subscribe", { code });
        socket.emit("auction:sync", { code });
      }

      if (options.fromInvite && onInviteConsumed) {
        try {
          onInviteConsumed(code);
        } catch {
          // ignore
        }
      }
    } catch (e) {
      setError("Ошибка сети при входе в комнату");
    } finally {
      setJoining(false);
    }
  }

  function toggleReady() {
    if (!socket || !room || !selfInfo) return;
    if (isOwner) return; // владелец не отмечает «Готов»
    const isReady = !!currentPlayer?.ready;
    socket.emit(
      "ready:set",
      { code: room.code, ready: !isReady },
      (resp) => {
        if (!resp || !resp.ok) {
          setError("Не удалось изменить статус «Готов»");
        }
      }
    );
  }

  function handleStartAuction() {
    if (!socket || !room) return;
    if (!isOwner) return;
    socket.emit(
      "auction:start",
      { code: room.code },
      (resp) => {
        if (!resp || !resp.ok) {
          const code = resp?.error || "failed";
          const map = {
            room_not_found: "Комната не найдена",
            forbidden_not_owner: "Только владелец может начать аукцион",
            need_at_least_2_players: "Нужно минимум 2 игрока",
            need_ready_players:
              "Нужно, чтобы все (кроме владельца) нажали «Готов»",
            already_started: "Аукцион уже запущен",
          };
          setError(map[code] || "Не удалось запустить аукцион");
        }
      }
    );
  }

  function parseSlotsFromText(text) {
    // Формат: каждая строка — "Название | цена | тип"
    // тип: lot | lootbox; если не указан — lot
    // цена опциональна (если нет — возьмём базовую генерацию сервера)
    return String(text || "")
      .split(/\r?\n/g)
      .map((raw) => raw.trim())
      .filter(Boolean)
      .map((line) => {
        const parts = line.split("|").map((s) => s.trim());
        const name = parts[0];
        const basePrice = Number(parts[1]);
        const type =
          (parts[2] || "lot").toLowerCase() === "lootbox"
            ? "lootbox"
            : "lot";
        const obj = { name, type };
        if (Number.isFinite(basePrice) && basePrice > 0)
          obj.basePrice = Math.floor(basePrice);
        return obj;
      });
  }

  function configureAuction() {
    if (!socket || !room || !isOwner) return;
    const slots = parseSlotsFromText(cfgSlotsText);
    socket.emit(
      "auction:configure",
      {
        code: room.code,
        rules: {
          timePerSlotSec: Math.max(
            5,
            Math.min(120, Number(cfgRules.timePerSlotSec) || 25)
          ),
          maxSlots: Math.max(
            1,
            Math.min(60, Number(cfgRules.maxSlots) || 30)
          ),
        },
        slots,
      },
      (resp) => {
        if (!resp || !resp.ok) {
          setError(resp?.errorText || "Не удалось применить настройки");
        } else {
          setError("");
          lastToastRef.current = {
            type: "info",
            text: "Настройки применены",
          };
          setToast(lastToastRef.current);
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

  function setBidRelative(delta) {
    setMyBid((prev) =>
      String(
        Math.max(
          0,
          Math.min(
            myBalance ?? 0,
            (Number(String(prev).replace(/\s/g, "")) || 0) + delta
          )
        )
      )
    );
  }

  function sendPass() {
    setMyBid("0");
    // для совместимости используем тот же канал bid с amount: 0
    sendBid(0);
  }

  function sendBid(forcedAmount) {
    if (!socket || !room || !selfInfo) return;
    if (!auctionState || auctionState.phase !== "in_progress") return;

    const raw =
      forcedAmount != null
        ? String(forcedAmount)
        : String(myBid || "").replace(/\s/g, "");
    const n = raw === "" ? 0 : Number(raw);
    if (!Number.isFinite(n) || n < 0) {
      setError("Введите неотрицательное число");
      return;
    }
    if (myBalance != null && n > myBalance) {
      setError("Ставка больше, чем ваши деньги");
      return;
    }

    setBusyBid(true);
    socket.emit(
      "auction:bid",
      { code: room.code, amount: n },
      (resp) => {
        setBusyBid(false);
        if (!resp || !resp.ok) {
          const code = resp?.error || "failed";
          const map = {
            room_not_found: "Комната не найдена",
            not_running: "Аукцион ещё не запущен",
            not_player: "Вы не в этой комнате",
            not_participant: "Вы не участвуете в аукционе",
            bad_amount: "Неверная сумма ставки",
            not_enough_money: "Недостаточно денег",
            paused: "Аукцион на паузе",
          };
          setError(map[code] || "Не удалось принять ставку");
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
    setAuctionState(null);
    setSelfInfo(null);
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
      if (
        typeof navigator !== "undefined" &&
        navigator.clipboard?.writeText
      ) {
        await navigator.clipboard.writeText(room.code);
      }
      const payload = { type: "info", text: "Код комнаты скопирован" };
      lastToastRef.current = payload;
      setToast(payload);
    } catch {
      const payload = { type: "error", text: "Не удалось скопировать код" };
      lastToastRef.current = payload;
      setToast(payload);
    }
  }

  // ===================== RENDER =====================

  const showLobby = !auctionState || auctionState.phase === "lobby";
  const showGame = auctionState && auctionState.phase === "in_progress";
  const showResult = auctionState && auctionState.phase === "finished";

  return (
    <div className="auction-root">
      {/* TOP BAR */}
      {room && (
        <div
          className="auction-header"
          role="region"
          aria-label="Панель комнаты"
        >
          <div className="auction-room-info">
            <div className="auction-title">AUCTION</div>
            <div className="auction-room-code">
              Код:{" "}
              <span className="auction-room-code-value">{room.code}</span>
              <button
                type="button"
                className="auction-btn small ghost"
                onClick={copyRoomCode}
                aria-label="Скопировать код комнаты"
              >
                📋 Копировать
              </button>
            </div>
          </div>

          {myBalance != null && (
            <div className="auction-header-balance" aria-live="polite">
              Баланс:{" "}
              <strong>{moneyFormatter.format(myBalance)}$</strong>
            </div>
          )}

          <button
            className="auction-btn back"
            type="button"
            onClick={handleExit}
            aria-label="Выйти в меню"
          >
            Выйти
          </button>
        </div>
      )}

      {connecting && !room && (
        <div className="auction-panel">
          <div className="auction-hint">Подключаемся к серверу…</div>
        </div>
      )}

      {!room && !connecting && (
        <section
          className="mf-menu v2 auction-menu"
          aria-label="Главное меню аукциона"
        >
          {/* hero — reuse mafia-hero, но с текстом про аукцион */}
          <header className="mf-menu-hero" role="banner">
            <button
              type="button"
              className="mf-icon-button mf-menu-close"
              onClick={handleExit}
              aria-label="Закрыть игру"
            >
              ✕
            </button>

            <div className="mf-menu-logo">AUCTION</div>
            <p className="mf-menu-tagline">
              Раздай игроков по командам через честный аукцион
            </p>
          </header>

          {/* действия: войти по коду / создать комнату */}
          <div
            className="mf-menu-actions"
            role="group"
            aria-label="Создание или вход в комнату"
          >
            {/* inline join */}
            <div className="mf-join-inline">
              <label htmlFor="auction-join-code" className="sr-only">
                Код комнаты
              </label>
              <input
                id="auction-join-code"
                className="mf-input big"
                placeholder="Код комнаты"
                inputMode="text"
                maxLength={8}
                // такой же pattern, как в мафии
                pattern="[A-HJKMNPQRSTUVWXYZ23456789]{4,8}"
                title="4–8 символов: A-H J K M N P Q R S T U V W X Y Z 2–9"
                aria-invalid={error ? "true" : "false"}
                value={(codeInput || "")
                  .toUpperCase()
                  .replace(CODE_ALPHABET_RE, "")
                  .slice(0, 8)}
                onChange={(e) => setCodeInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    const normalized = (codeInput || "")
                      .toUpperCase()
                      .replace(CODE_ALPHABET_RE, "")
                      .slice(0, 8);
                    joinRoom(normalized);
                  }
                }}
                disabled={creating || joining}
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck={false}
              />
              <button
                className="mf-btn primary big"
                type="button"
                onClick={() => {
                  const normalized = (codeInput || "")
                    .toUpperCase()
                    .replace(CODE_ALPHABET_RE, "")
                    .slice(0, 8);
                  joinRoom(normalized);
                }}
                disabled={creating || joining}
                aria-label="Войти по коду"
              >
                🔑 Вступить
              </button>
            </div>

            {error && (
              <div className="mf-form-hint danger" role="alert">
                {error}
              </div>
            )}

            {/* create */}
            <button
              className="mf-btn primary xl mf-create-cta"
              type="button"
              onClick={createRoom}
              disabled={creating || joining}
              aria-label="Создать комнату"
              title="Создать новую комнату"
            >
              📦 Создать комнату
            </button>
          </div>

          {/* маленький «гайд», как в мафии, но под аукцион */}
          <section
            className="mf-menu-cards"
            aria-label="Как работает аукцион"
          >
            <article className="mf-menu-card">
              <div className="ico" aria-hidden="true">
                🎯
              </div>
              <div className="title">Выбираем игроков</div>
              <p className="text">
                Создатель комнаты заранее подготавливает список игроков
                или слотов, которые разыграем.
              </p>
            </article>
            <article className="mf-menu-card">
              <div className="ico" aria-hidden="true">
                💰
              </div>
              <div className="title">Делаем ставки</div>
              <p className="text">
                На каждый лот у всех одинаковый капитал. Побеждает
                максимальная ставка, деньги списываются с баланса.
              </p>
            </article>
            <article className="mf-menu-card">
              <div className="ico" aria-hidden="true">
                🧩
              </div>
              <div className="title">Собираем команды</div>
              <p className="text">
                По итогам аукциона получаем прозрачные, живые и
                сбалансированные составы.
              </p>
            </article>
          </section>
        </section>
      )}

      {room && (
        <div className="auction-main">
          {/* Список игроков + деньги */}
          <section className="auction-section">
            <div className="auction-section-title">Игроки</div>
            <div className="auction-hint">
              Нажми на карточку игрока, чтобы увидеть его корзину и
              общую ценность собранных лотов.
            </div>
            <div className="auction-players">
              {players.map((p) => {
                const balance =
                  auctionState?.balances?.[p.id] ?? null;
                const isMe = p.id === selfInfo?.roomPlayerId;
                const isHost = p.user?.id === room?.ownerId;
                const name =
                  p.user?.first_name ||
                  p.user?.username ||
                  `Игрок ${p.id}`;
                const avatarUrl =
                  p.user?.photo_url || p.user?.avatar || null;
                const wins = winsCountByPlayerId.get(p.id) || 0;
                const basketValue = basketTotals[p.id] || 0;

                return (
                  <div
                    key={p.id}
                    className={
                      "auction-player-card" +
                      (isMe ? " me" : "") +
                      (p.ready ? " ready" : "") +
                      (selectedPlayerIdEffective === p.id
                        ? " selected"
                        : "")
                    }
                    role="button"
                    tabIndex={0}
                    onClick={() => setSelectedPlayerId(p.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setSelectedPlayerId(p.id);
                      }
                    }}
                  >
                    <div className="auction-player-left">
                      <div className="auction-player-avatar">
                        {avatarUrl ? (
                          <img src={avatarUrl} alt={name} />
                        ) : (
                          <div className="auction-player-avatar-fallback">
                            {name?.[0]?.toUpperCase()}
                          </div>
                        )}
                      </div>
                      <div className="auction-player-text">
                        <div className="auction-player-name">
                          {name}
                          {isMe && " (вы)"}
                        </div>
                        <div className="auction-player-meta">
                          {balance != null ? (
                            <>💵 {moneyFormatter.format(balance)}$</>
                          ) : (
                            "ещё не в аукционе"
                          )}
                        </div>
                        {basketValue > 0 && (
                          <div className="auction-player-meta small">
                            Корзина:{" "}
                            {moneyFormatter.format(basketValue)}$
                          </div>
                        )}
                        {wins > 0 && (
                          <div className="auction-player-meta small">
                            Побед: {wins}
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="auction-player-tags">
                      {isHost && (
                        <div className="auction-chip owner">
                          хост
                        </div>
                      )}
                      {p.ready ? (
                        <div className="auction-chip">готов</div>
                      ) : (
                        <div className="auction-chip gray">
                          не готов
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          {/* Панель корзины выбранного игрока */}
          {selectedPlayer && auctionState?.history?.length > 0 && (
            <section className="auction-section">
              <div className="auction-section-title">
                Корзина игрока{" "}
                {selectedPlayer.user?.first_name ||
                  selectedPlayer.user?.username ||
                  `Игрок ${selectedPlayer.id}`}
              </div>
              <div className="auction-hint">
                Всего предметов: {selectedBasket.length} · Ценность
                корзины:{" "}
                {moneyFormatter.format(selectedBasketTotal || 0)}$
              </div>
              {selectedBasket.length === 0 ? (
                <div className="auction-hint">
                  Этот игрок пока ничего не выиграл.
                </div>
              ) : (
                <div className="auction-history">
                  {selectedBasket.map((item) => (
                    <div
                      key={item.index}
                      className="auction-history-item"
                    >
                      <div className="auction-history-title">
                        #{(item.index ?? 0) + 1} ·{" "}
                        {item.type === "lootbox"
                          ? "🎁 Скрытый лот"
                          : "📦 Лот"}{" "}
                        — {item.name}
                      </div>
                      <div className="auction-history-meta">
                        Заплатил:{" "}
                        {moneyFormatter.format(item.paid || 0)}$ ·
                        Ценность:{" "}
                        {moneyFormatter.format(item.value || 0)}$
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}

          {/* Лобби (готовность + старт) */}
          {showLobby && (
            <section className="auction-section">
              <div className="auction-section-title">Лобби</div>
              <div className="auction-row">
                {!isOwner && (
                  <button
                    className="auction-btn primary"
                    onClick={toggleReady}
                    disabled={!currentPlayer}
                  >
                    {currentPlayer?.ready
                      ? "Я не готов"
                      : "Я готов"}
                  </button>
                )}
                {isOwner && (
                  <button
                    className="auction-btn primary"
                    onClick={handleStartAuction}
                    disabled={!everyoneReadyExceptOwner}
                  >
                    {everyoneReadyExceptOwner
                      ? "Начать аукцион"
                      : "Ждём остальных…"}
                  </button>
                )}
              </div>

              {isOwner && (
                <div className="auction-config">
                  <div className="auction-config-header">
                    <button
                      className="auction-btn small"
                      type="button"
                      onClick={() => setCfgOpen((v) => !v)}
                      aria-expanded={cfgOpen ? "true" : "false"}
                      aria-controls="auction-config-panel"
                    >
                      ⚙️ Настройки
                    </button>
                    <span className="auction-hint">
                      Хост может задать время на лот и список слотов
                      (каждая строка: «Название | цена | тип», тип ={" "}
                      <code>lot</code> или <code>lootbox</code>)
                    </span>
                  </div>
                  {cfgOpen && (
                    <div
                      id="auction-config-panel"
                      className="auction-config-panel"
                    >
                      <div className="auction-row">
                        <label
                          className="sr-only"
                          htmlFor="cfg-time"
                        >
                          Время на лот, сек
                        </label>
                        <input
                          id="cfg-time"
                          className="auction-input"
                          inputMode="numeric"
                          pattern="[0-9]*"
                          placeholder="Время на лот, сек (5–120)"
                          value={cfgRules.timePerSlotSec}
                          onChange={(e) =>
                            setCfgRules((r) => ({
                              ...r,
                              timePerSlotSec:
                                e.target.value.replace(/[^\d]/g, ""),
                            }))
                          }
                        />
                        <label
                          className="sr-only"
                          htmlFor="cfg-max"
                        >
                          Максимум слотов
                        </label>
                        <input
                          id="cfg-max"
                          className="auction-input"
                          inputMode="numeric"
                          pattern="[0-9]*"
                          placeholder="Максимум слотов (1–60)"
                          value={cfgRules.maxSlots}
                          onChange={(e) =>
                            setCfgRules((r) => ({
                              ...r,
                              maxSlots:
                                e.target.value.replace(/[^\d]/g, ""),
                            }))
                          }
                        />
                        <button
                          className="auction-btn"
                          type="button"
                          onClick={configureAuction}
                        >
                          Применить
                        </button>
                      </div>
                      <textarea
                        className="auction-textarea"
                        placeholder={`Слоты (по одному на строку), пример:\nИван Иванов | 120000 | lot\nМистический лутбокс | 90000 | lootbox`}
                        value={cfgSlotsText}
                        onChange={(e) =>
                          setCfgSlotsText(e.target.value)
                        }
                        rows={6}
                      />
                    </div>
                  )}
                </div>
              )}

              <div className="auction-hint">
                Каждый игрок начинает с{" "}
                {moneyFormatter.format(INITIAL_MONEY)}$. За раунд
                разыгрывается один слот — обычный лот или скрытый
                лутбокс. На каждый лот даётся счёт 3-2-1 (примерно по 3
                секунды на цифру). Игра идёт до{" "}
                {auctionState?.maxSlots ?? cfgRules.maxSlots ?? 30}{" "}
                слотов или пока у всех не кончатся деньги.
              </div>
              {error && <div className="auction-error">{error}</div>}
            </section>
          )}

          {/* Основная игра */}
          {showGame && (
            <section className="auction-section">
              <div className="auction-section-title">
                Текущий лот
              </div>
              {currentSlot ? (
                <div className="auction-lot-card">
                  <div className="auction-lot-type">
                    {currentSlot.type === "lootbox"
                      ? "🎁 Скрытый лот"
                      : "📦 Лот"}
                  </div>
                  <div className="auction-lot-name">
                    {currentSlot.name}
                  </div>
                  <div className="auction-lot-meta">
                    Базовая стоимость:{" "}
                    {moneyFormatter.format(
                      currentSlot.basePrice
                    )}
                    $
                  </div>
                  <div className="auction-lot-meta">
                    Слот {(auctionState.slotsPlayed ?? 0) + 1} из{" "}
                    {auctionState.maxSlots}
                  </div>

                  <div
                    className="auction-timer"
                    role="timer"
                    aria-live="polite"
                  >
                    ⏳ Счёт:{" "}
                    <strong style={{ fontSize: "1.2em" }}>
                      {countdownStep != null
                        ? countdownStep
                        : "—"}
                    </strong>
                    {secsLeft != null && (
                      <span className="auction-timer-secondary">
                        {" "}
                        ({secsLeft}s)
                      </span>
                    )}
                    {progressPct != null && (
                      <div className="auction-timer-bar">
                        <div
                          className="fill"
                          style={{ width: `${progressPct}%` }}
                        />
                      </div>
                    )}
                    {auctionState?.paused && (
                      <span
                        className="auction-chip gray"
                        style={{ marginLeft: 8 }}
                      >
                        пауза
                      </span>
                    )}
                  </div>

                  <div className="auction-bid-block">
                    <div className="auction-bid-label">
                      Ваша ставка (0 — пас)
                    </div>
                    <div className="auction-row">
                      <input
                        className="auction-input"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        value={myBid}
                        onChange={(e) =>
                          setMyBid(
                            e.target.value.replace(/[^\d]/g, "")
                          )
                        }
                        placeholder="Сумма"
                      />
                      <button
                        className="auction-btn primary"
                        onClick={() => sendBid()}
                        disabled={
                          busyBid ||
                          myBalance == null ||
                          myBalance <= 0
                        }
                      >
                        {busyBid ? "Отправка…" : "Сделать ставку"}
                      </button>
                    </div>
                    <div className="auction-row">
                      <button
                        className="auction-btn small"
                        onClick={() => setBidRelative(1_000)}
                        disabled={
                          myBalance == null || myBalance <= 0
                        }
                      >
                        +1k
                      </button>
                      <button
                        className="auction-btn small"
                        onClick={() => setBidRelative(5_000)}
                        disabled={
                          myBalance == null || myBalance <= 0
                        }
                      >
                        +5k
                      </button>
                      <button
                        className="auction-btn small"
                        onClick={() => setBidRelative(10_000)}
                        disabled={
                          myBalance == null || myBalance <= 0
                        }
                      >
                        +10k
                      </button>
                      <button
                        className="auction-btn small"
                        onClick={() => sendBid(myBalance || 0)}
                        disabled={
                          myBalance == null || myBalance <= 0
                        }
                      >
                        All-in
                      </button>
                      <button
                        className="auction-btn small ghost"
                        onClick={sendPass}
                      >
                        Пас
                      </button>
                    </div>
                    <div className="auction-hint">
                      Ваш баланс:{" "}
                      {myBalance != null
                        ? `${moneyFormatter.format(
                            myBalance
                          )}$`
                        : "ещё не участвуете"}
                      {" · "}
                      {typeof myRoundBid === "number"
                        ? `Ваша текущая ставка: ${moneyFormatter.format(
                            myRoundBid
                          )}$`
                        : "ставка не отправлена"}
                    </div>
                  </div>

                  {isOwner && (
                    <div
                      className="auction-row"
                      style={{ marginTop: 10 }}
                    >
                      {!auctionState?.paused ? (
                        <button
                          className="auction-btn"
                          onClick={pauseAuction}
                        >
                          ⏸ Пауза
                        </button>
                      ) : (
                        <button
                          className="auction-btn"
                          onClick={resumeAuction}
                        >
                          ▶ Продолжить
                        </button>
                      )}
                      <button
                        className="auction-btn ghost"
                        onClick={forceNext}
                      >
                        ⏭ Следующий лот
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                <div className="auction-hint">
                  Ожидаем следующий слот…
                </div>
              )}

              {error && <div className="auction-error">{error}</div>}
            </section>
          )}

          {/* Результаты */}
          {showResult && (
            <section className="auction-section">
              <div className="auction-section-title">
                Результаты аукциона
              </div>
              <div className="auction-hint">
                Игра завершена. Побеждает игрок(и) с максимальной
                суммой денег.
              </div>
              <div className="auction-players">
                {players
                  .slice()
                  .sort((a, b) => {
                    const av =
                      auctionState?.balances?.[a.id] ?? 0;
                    const bv =
                      auctionState?.balances?.[b.id] ?? 0;
                    return bv - av;
                  })
                  .map((p) => {
                    const balance =
                      auctionState?.balances?.[p.id] ?? 0;
                    const basketValue = basketTotals[p.id] || 0;
                    const isWinner =
                      auctionState?.winners?.includes(p.id);
                    const name =
                      p.user?.first_name ||
                      p.user?.username ||
                      `Игрок ${p.id}`;
                    const wins =
                      winsCountByPlayerId.get(p.id) || 0;
                    const avatarUrl =
                      p.user?.photo_url || p.user?.avatar || null;

                    return (
                      <div
                        key={p.id}
                        className={
                          "auction-player-card result" +
                          (isWinner ? " winner" : "")
                        }
                      >
                        <div className="auction-player-left">
                          <div className="auction-player-avatar">
                            {avatarUrl ? (
                              <img src={avatarUrl} alt={name} />
                            ) : (
                              <div className="auction-player-avatar-fallback">
                                {name?.[0]?.toUpperCase()}
                              </div>
                            )}
                          </div>
                          <div className="auction-player-text">
                            <div className="auction-player-name">
                              {name}
                              {isWinner && " 🏆"}
                            </div>
                            <div className="auction-player-meta">
                              Итог:{" "}
                              {moneyFormatter.format(
                                balance
                              )}
                              $
                            </div>
                            <div className="auction-player-meta small">
                              Корзина:{" "}
                              {moneyFormatter.format(
                                basketValue
                              )}
                              $
                            </div>
                            {wins > 0 && (
                              <div className="auction-player-meta small">
                                Побед: {wins}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
              </div>
              <div className="auction-row">
                {isOwner && (
                  <button
                    className="auction-btn primary"
                    onClick={handleStartAuction}
                  >
                    Сыграть ещё раз с теми же игроками
                  </button>
                )}
                <button
                  className="auction-btn"
                  onClick={handleExit}
                >
                  Выйти в меню
                </button>
              </div>
            </section>
          )}

          {/* История слотов */}
          {auctionState?.history?.length > 0 && (
            <section className="auction-section">
              <div className="auction-section-title">
                История слотов
              </div>
              <div className="auction-history">
                {auctionState.history.map((h) => {
                  const winnerName =
                    h.winnerPlayerId != null
                      ? playerNameById.get(h.winnerPlayerId)
                      : null;
                  let effectText = "";
                  if (h.effect) {
                    const d = h.effect.delta || 0;
                    if (h.effect.kind === "money" && d > 0) {
                      effectText = ` +${moneyFormatter.format(
                        d
                      )}$`;
                    } else if (
                      h.effect.kind === "penalty" &&
                      d < 0
                    ) {
                      effectText = ` ${moneyFormatter.format(
                        d
                      )}$`;
                    }
                  }
                  return (
                    <div
                      key={h.index}
                      className="auction-history-item"
                    >
                      <div className="auction-history-title">
                        #{h.index + 1} ·{" "}
                        {h.type === "lootbox"
                          ? "🎁 Скрытый лот"
                          : "📦 Лот"}{" "}
                        — {h.name}
                      </div>
                      {winnerName ? (
                        <div className="auction-history-meta">
                          Победил: {winnerName} за{" "}
                          {moneyFormatter.format(
                            h.winBid || 0
                          )}
                          $
                          {effectText && (
                            <span> ({effectText})</span>
                          )}
                        </div>
                      ) : (
                        <div className="auction-history-meta">
                          Никто не купил (все пас)
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {error && !showGame && !showLobby && (
            <div className="auction-error sticky">
              {error}
            </div>
          )}
        </div>
      )}

      {/* Тосты поверх всего */}
      {toast && (
        <div
          className={`auction-toast ${toast.type || "info"}`}
          role="status"
          aria-live="polite"
        >
          {toast.text}
        </div>
      )}
    </div>
  );
}
