// src/Auction.jsx
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import io from "socket.io-client";
import "./Auction.css";

const INITIAL_MONEY = 1_000_000;

// ╤В╨░╨║╨╛╨╣ ╨╢╨╡ ╨░╨╗╤Д╨░╨▓╨╕╤В ╨┤╨╗╤П ╨║╨╛╨┤╨░ ╨║╨╛╨╝╨╜╨░╤В╤Л, ╨║╨░╨║ ╨▓ ╨╝╨░╤Д╨╕╨╕ (╨▒╨╡╨╖ 0/1/O/I)
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
  const [players, setPlayers] = useState([]); // ╨╕╨╖ room:state
  const [selfInfo, setSelfInfo] = useState(null); // private:self { roomPlayerId, userId, ... }
  const [auctionState, setAuctionState] = useState(null); // ╨╕╨╖ auction:state

  // ╨╗╨╛╨║╨░╨╗╤М╨╜╤Л╨╣ ╨┤╨╡╨┤╨╗╨░╨╣╨╜ ╨░╨║╤В╨╕╨▓╨╜╨╛╨│╨╛ ╤Б╨╗╨╛╤В╨░ (╨┐╨╛ ╤Б╨╡╤А╨▓╨╡╤А╨╜╨╛╨╝╤Г timeLeftMs), ╤З╤В╨╛╨▒╤Л ╨░╨╜╨╕╨╝╨╕╤А╨╛╨▓╨░╤В╤М ╤В╨░╨╣╨╝╨╡╤А ╨▒╨╡╨╖ ╤З╨░╤Б╤В╨╛╨│╨╛ ╤В╤А╨░╤Д╨╕╨║╨░
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
  const lastSubscribedCodeRef = useRef(null);
  const lastSubscriptionSocketIdRef = useRef(null);

  // ╨║╨╛╨╜╤Д╨╕╨│ (╤Е╨╛╤Б╤В, ╨╗╨╛╨▒╨▒╨╕)
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

  // ╨╝╨╛╨╕ ╨┤╨░╨╜╨╜╤Л╨╡ ╨┐╨╛ ╤В╨╡╨║╤Г╤Й╨╡╨╝╤Г ╤А╨░╤Г╨╜╨┤╤Г
  const myRoundBid = useMemo(() => {
    if (!selfInfo) return null;
    const v = auctionState?.currentBids?.[selfInfo.roomPlayerId];
    return typeof v === "number" ? v : null;
  }, [auctionState, selfInfo]);

  // ╤В╨╕╨║╨░╨╜╤М╨╡ ╤В╨░╨╣╨╝╨╡╤А╨░ (╨╗╨╛╨║╨░╨╗╤М╨╜╨╛), ╤Б╨╡╤А╨▓╨╡╤А ╨┐╤А╨╕╤Б╤Л╨╗╨░╨╡╤В timeLeftMs
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

  // ╨║╤А╤Г╨┐╨╜╤Л╨╣ ╤Б╤З╤С╤В 3-2-1 ╨┐╨╛ ~╤В╤А╨╡╤В╤М ╤В╨░╨╣╨╝╨╡╤А╨░
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
      const name = p.user?.first_name || p.user?.username || `╨Ш╨│╤А╨╛╨║ ${p.id}`;
      map.set(p.id, name);
    });
    if (auctionState?.players) {
      auctionState.players.forEach((p) => {
        if (!map.has(p.id)) map.set(p.id, p.name);
      });
    }
    return map;
  }, [players, auctionState]);

  // ╨Ь╨╕╨╜╨╕-╤Б╤В╨░╤В╨░ ╨┐╨╛ ╨┐╨╛╨▒╨╡╨┤╨░╨╝
  const winsCountByPlayerId = useMemo(() => {
    const map = new Map();
    if (!auctionState?.history) return map;
    for (const h of auctionState.history) {
      if (h.winnerPlayerId == null) continue;
      map.set(h.winnerPlayerId, (map.get(h.winnerPlayerId) || 0) + 1);
    }
    return map;
  }, [auctionState]);

  // ╨║╨╛╤А╨╖╨╕╨╜╤Л ╨╕╨│╤А╨╛╨║╨╛╨▓ (╨╛╤В╨┤╨░╤С╤В ╤Б╨╡╤А╨▓╨╡╤А)
  const basketByPlayerId = auctionState?.baskets || {};
  const basketTotals = auctionState?.basketTotals || {};

  // ╨║╨╛╨│╨╛ ╨┐╨╛╨║╨░╨╖╤Л╨▓╨░╨╡╨╝ ╨▓ ╨┐╨░╨╜╨╡╨╗╨╕ ╨║╨╛╤А╨╖╨╕╨╜╤Л: ╨▓╤Л╨▒╤А╨░╨╜╨╜╨╛╨│╨╛ ╨╕╨╗╨╕ ╤Б╨╡╨▒╤П
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

  const subscribeToRoom = useCallback(
    (code, options = {}) => {
      if (!code) return;
      const force = options.force ?? false;
      const currentSocketId = socket?.id ?? null;
      const alreadySame =
        lastSubscribedCodeRef.current === code &&
        lastSubscriptionSocketIdRef.current === currentSocketId &&
        currentSocketId != null;
      lastSubscribedCodeRef.current = code;
      if (!socket) return;
      if (!force && alreadySame) return;
      socket.emit("room:subscribe", { code });
      socket.emit("auction:sync", { code });
      if (currentSocketId != null) {
        lastSubscriptionSocketIdRef.current = currentSocketId;
      }
    },
    [socket]
  );

  useEffect(() => {
    if (!room?.code) {
      lastSubscribedCodeRef.current = null;
      lastSubscriptionSocketIdRef.current = null;
      return;
    }
    subscribeToRoom(room.code);
  }, [room?.code, subscribeToRoom]);

  // --------- socket init ---------
  useEffect(() => {
    if (!apiBase) return;
    const s = io(apiBase, {
      transports: ["websocket"],
      auth: { initData: initData || "" },
    });

    setSocket(s);

    s.on("connect_error", (err) => {
      setConnecting(false);
      setError(`╨Э╨╡ ╤Г╨┤╨░╨╗╨╛╤Б╤М ╨┐╨╛╨┤╨║╨╗╤О╤З╨╕╤В╤М╤Б╤П: ${err.message}`);
    });

    s.on("toast", (payload) => {
      if (!payload?.text) return;
      lastToastRef.current = payload;
      setToast(payload);
      // ╨╡╤Б╨╗╨╕ ╤П╨▓╨╜╨░╤П ╨╛╤И╨╕╨▒╨║╨░ тАФ ╨┐╨╛╨║╨░╨╢╨╡╨╝ ╨╡╤Й╤С ╨╕ ╨▓ error
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

  useEffect(() => {
    if (!socket) return;
    const handleConnect = () => {
      setConnecting(false);
      if (lastSubscribedCodeRef.current) {
        subscribeToRoom(lastSubscribedCodeRef.current, { force: true });
      }
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

  // ╨░╨▓╤В╨╛-╤Б╨║╤А╤Л╤В╨╕╨╡ ╤В╨╛╤Б╤В╨░
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => {
      if (lastToastRef.current === toast) {
        setToast(null);
      }
    }, 2500);
    return () => clearTimeout(t);
  }, [toast]);

  // --------- BackButton ╨╕╨╖ Telegram ---------
  useEffect(() => {
    if (!setBackHandler) return;
    const handler = () => {
      handleExit();
    };
    setBackHandler(handler);
    return () => setBackHandler(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setBackHandler, room, socket, initData]);

  // --------- ╨░╨▓╤В╨╛-join ╨┐╨╛ ╨╕╨╜╨▓╨░╨╣╤В-╨║╨╛╨┤╤Г ---------
  useEffect(() => {
    if (!socket) return;
    if (!autoJoinCode) return;
    joinRoom(autoJoinCode, { fromInvite: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socket]);

  // --------- ╨╜╨░╤З╨╕╤Б╨╗╨╡╨╜╨╕╨╡ ╨┐╤А╨╛╨│╤А╨╡╤Б╤Б╨░ ╨┐╤А╨╕ ╨╖╨░╨▓╨╡╤А╤И╨╡╨╜╨╕╨╕ ---------
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

  useEffect(() => {
    if (!auctionState || auctionState.phase === "finished") return;
    progressSentRef.current = false;
  }, [auctionState?.phase, room?.code]);

  // ===================== API helpers =====================

  async function createRoom() {
    if (!initData) {
      setError("╨Э╨╡╤В initData ╨╛╤В Telegram");
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
            ? "╨Ъ╨╛╨┤ ╨║╨╛╨╝╨╜╨░╤В╤Л ╤Г╨╢╨╡ ╨╖╨░╨╜╤П╤В"
            : "╨Э╨╡ ╤Г╨┤╨░╨╗╨╛╤Б╤М ╤Б╨╛╨╖╨┤╨░╤В╤М ╨║╨╛╨╝╨╜╨░╤В╤Г";
        setError(msg);
        return;
      }
      setRoom(data.room || null);
      setPlayers(data.players || []);
      if (data.room?.code) {
        subscribeToRoom(data.room.code, { force: true });
      }
      setCodeInput(data.room?.code || "");
    } catch (e) {
      setError("╨Ю╤И╨╕╨▒╨║╨░ ╤Б╨╡╤В╨╕ ╨┐╤А╨╕ ╤Б╨╛╨╖╨┤╨░╨╜╨╕╨╕ ╨║╨╛╨╝╨╜╨░╤В╤Л");
    } finally {
      setCreating(false);
    }
  }

  async function joinRoom(rawCode, options = {}) {
    if (!initData) {
      setError("╨Э╨╡╤В initData ╨╛╤В Telegram");
      return;
    }
    const code = String(rawCode || "").trim().toUpperCase();
    if (!code) {
      setError("╨Т╨▓╨╡╨┤╨╕╤В╨╡ ╨║╨╛╨┤ ╨║╨╛╨╝╨╜╨░╤В╤Л");
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
          room_not_found: "╨Ъ╨╛╨╝╨╜╨░╤В╨░ ╨╜╨╡ ╨╜╨░╨╣╨┤╨╡╨╜╨░",
          room_full: "╨Ъ╨╛╨╝╨╜╨░╤В╨░ ╨╖╨░╨┐╨╛╨╗╨╜╨╡╨╜╨░",
          game_in_progress: "╨Ш╨│╤А╨░ ╤Г╨╢╨╡ ╨╜╨░╤З╨░╨╗╨░╤Б╤М",
        };
        setError(msgMap[codeErr] || "╨Э╨╡ ╤Г╨┤╨░╨╗╨╛╤Б╤М ╨▓╨╛╨╣╤В╨╕ ╨▓ ╨║╨╛╨╝╨╜╨░╤В╤Г");
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
    } catch (e) {
      setError("╨Ю╤И╨╕╨▒╨║╨░ ╤Б╨╡╤В╨╕ ╨┐╤А╨╕ ╨▓╤Е╨╛╨┤╨╡ ╨▓ ╨║╨╛╨╝╨╜╨░╤В╤Г");
    } finally {
      setJoining(false);
    }
  }

  function toggleReady() {
    if (!socket || !room || !selfInfo) return;
    if (isOwner) return; // ╨▓╨╗╨░╨┤╨╡╨╗╨╡╤Ж ╨╜╨╡ ╨╛╤В╨╝╨╡╤З╨░╨╡╤В ┬л╨У╨╛╤В╨╛╨▓┬╗
    const isReady = !!currentPlayer?.ready;
    socket.emit(
      "ready:set",
      { code: room.code, ready: !isReady },
      (resp) => {
        if (!resp || !resp.ok) {
          setError("╨Э╨╡ ╤Г╨┤╨░╨╗╨╛╤Б╤М ╨╕╨╖╨╝╨╡╨╜╨╕╤В╤М ╤Б╤В╨░╤В╤Г╤Б ┬л╨У╨╛╤В╨╛╨▓┬╗");
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
            room_not_found: "╨Ъ╨╛╨╝╨╜╨░╤В╨░ ╨╜╨╡ ╨╜╨░╨╣╨┤╨╡╨╜╨░",
            forbidden_not_owner: "╨в╨╛╨╗╤М╨║╨╛ ╨▓╨╗╨░╨┤╨╡╨╗╨╡╤Ж ╨╝╨╛╨╢╨╡╤В ╨╜╨░╤З╨░╤В╤М ╨░╤Г╨║╤Ж╨╕╨╛╨╜",
            need_at_least_2_players: "╨Э╤Г╨╢╨╜╨╛ ╨╝╨╕╨╜╨╕╨╝╤Г╨╝ 2 ╨╕╨│╤А╨╛╨║╨░",
            need_ready_players:
              "╨Э╤Г╨╢╨╜╨╛, ╤З╤В╨╛╨▒╤Л ╨▓╤Б╨╡ (╨║╤А╨╛╨╝╨╡ ╨▓╨╗╨░╨┤╨╡╨╗╤М╤Ж╨░) ╨╜╨░╨╢╨░╨╗╨╕ ┬л╨У╨╛╤В╨╛╨▓┬╗",
            already_started: "╨Р╤Г╨║╤Ж╨╕╨╛╨╜ ╤Г╨╢╨╡ ╨╖╨░╨┐╤Г╤Й╨╡╨╜",
          };
          setError(map[code] || "╨Э╨╡ ╤Г╨┤╨░╨╗╨╛╤Б╤М ╨╖╨░╨┐╤Г╤Б╤В╨╕╤В╤М ╨░╤Г╨║╤Ж╨╕╨╛╨╜");
        }
      }
    );
  }

  function parseSlotsFromText(text) {
    // ╨д╨╛╤А╨╝╨░╤В: ╨║╨░╨╢╨┤╨░╤П ╤Б╤В╤А╨╛╨║╨░ тАФ "╨Э╨░╨╖╨▓╨░╨╜╨╕╨╡ | ╤Ж╨╡╨╜╨░ | ╤В╨╕╨┐"
    // ╤В╨╕╨┐: lot | lootbox; ╨╡╤Б╨╗╨╕ ╨╜╨╡ ╤Г╨║╨░╨╖╨░╨╜ тАФ lot
    // ╤Ж╨╡╨╜╨░ ╨╛╨┐╤Ж╨╕╨╛╨╜╨░╨╗╤М╨╜╨░ (╨╡╤Б╨╗╨╕ ╨╜╨╡╤В тАФ ╨▓╨╛╨╖╤М╨╝╤С╨╝ ╨▒╨░╨╖╨╛╨▓╤Г╤О ╨│╨╡╨╜╨╡╤А╨░╤Ж╨╕╤О ╤Б╨╡╤А╨▓╨╡╤А╨░)
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
          setError(resp?.errorText || "╨Э╨╡ ╤Г╨┤╨░╨╗╨╛╤Б╤М ╨┐╤А╨╕╨╝╨╡╨╜╨╕╤В╤М ╨╜╨░╤Б╤В╤А╨╛╨╣╨║╨╕");
        } else {
          setError("");
          lastToastRef.current = {
            type: "info",
            text: "╨Э╨░╤Б╤В╤А╨╛╨╣╨║╨╕ ╨┐╤А╨╕╨╝╨╡╨╜╨╡╨╜╤Л",
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
    // ╨┤╨╗╤П ╤Б╨╛╨▓╨╝╨╡╤Б╤В╨╕╨╝╨╛╤Б╤В╨╕ ╨╕╤Б╨┐╨╛╨╗╤М╨╖╤Г╨╡╨╝ ╤В╨╛╤В ╨╢╨╡ ╨║╨░╨╜╨░╨╗ bid ╤Б amount: 0
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
      setError("╨Т╨▓╨╡╨┤╨╕╤В╨╡ ╨╜╨╡╨╛╤В╤А╨╕╤Ж╨░╤В╨╡╨╗╤М╨╜╨╛╨╡ ╤З╨╕╤Б╨╗╨╛");
      return;
    }
    if (myBalance != null && n > myBalance) {
      setError("╨б╤В╨░╨▓╨║╨░ ╨▒╨╛╨╗╤М╤И╨╡, ╤З╨╡╨╝ ╨▓╨░╤И╨╕ ╨┤╨╡╨╜╤М╨│╨╕");
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
            room_not_found: "╨Ъ╨╛╨╝╨╜╨░╤В╨░ ╨╜╨╡ ╨╜╨░╨╣╨┤╨╡╨╜╨░",
            not_running: "╨Р╤Г╨║╤Ж╨╕╨╛╨╜ ╨╡╤Й╤С ╨╜╨╡ ╨╖╨░╨┐╤Г╤Й╨╡╨╜",
            not_player: "╨Т╤Л ╨╜╨╡ ╨▓ ╤Н╤В╨╛╨╣ ╨║╨╛╨╝╨╜╨░╤В╨╡",
            not_participant: "╨Т╤Л ╨╜╨╡ ╤Г╤З╨░╤Б╤В╨▓╤Г╨╡╤В╨╡ ╨▓ ╨░╤Г╨║╤Ж╨╕╨╛╨╜╨╡",
            bad_amount: "╨Э╨╡╨▓╨╡╤А╨╜╨░╤П ╤Б╤Г╨╝╨╝╨░ ╤Б╤В╨░╨▓╨║╨╕",
            not_enough_money: "╨Э╨╡╨┤╨╛╤Б╤В╨░╤В╨╛╤З╨╜╨╛ ╨┤╨╡╨╜╨╡╨│",
            paused: "╨Р╤Г╨║╤Ж╨╕╨╛╨╜ ╨╜╨░ ╨┐╨░╤Г╨╖╨╡",
          };
          setError(map[code] || "╨Э╨╡ ╤Г╨┤╨░╨╗╨╛╤Б╤М ╨┐╤А╨╕╨╜╤П╤В╤М ╤Б╤В╨░╨▓╨║╤Г");
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
      if (
        typeof navigator !== "undefined" &&
        navigator.clipboard?.writeText
      ) {
        await navigator.clipboard.writeText(room.code);
      }
      const payload = { type: "info", text: "╨Ъ╨╛╨┤ ╨║╨╛╨╝╨╜╨░╤В╤Л ╤Б╨║╨╛╨┐╨╕╤А╨╛╨▓╨░╨╜" };
      lastToastRef.current = payload;
      setToast(payload);
    } catch {
      const payload = { type: "error", text: "╨Э╨╡ ╤Г╨┤╨░╨╗╨╛╤Б╤М ╤Б╨║╨╛╨┐╨╕╤А╨╛╨▓╨░╤В╤М ╨║╨╛╨┤" };
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
          aria-label="╨Я╨░╨╜╨╡╨╗╤М ╨║╨╛╨╝╨╜╨░╤В╤Л"
        >
          <div className="auction-room-info">
            <div className="auction-title">AUCTION</div>
            <div className="auction-room-code">
              ╨Ъ╨╛╨┤:{" "}
              <span className="auction-room-code-value">{room.code}</span>
              <button
                type="button"
                className="auction-btn small ghost"
                onClick={copyRoomCode}
                aria-label="╨б╨║╨╛╨┐╨╕╤А╨╛╨▓╨░╤В╤М ╨║╨╛╨┤ ╨║╨╛╨╝╨╜╨░╤В╤Л"
              >
                ЁЯУЛ ╨Ъ╨╛╨┐╨╕╤А╨╛╨▓╨░╤В╤М
              </button>
            </div>
          </div>

          {myBalance != null && (
            <div className="auction-header-balance" aria-live="polite">
              ╨С╨░╨╗╨░╨╜╤Б:{" "}
              <strong>{moneyFormatter.format(myBalance)}$</strong>
            </div>
          )}

          <button
            className="auction-btn back"
            type="button"
            onClick={handleExit}
            aria-label="╨Т╤Л╨╣╤В╨╕ ╨▓ ╨╝╨╡╨╜╤О"
          >
            ╨Т╤Л╨╣╤В╨╕
          </button>
        </div>
      )}

      {connecting && !room && (
        <div className="auction-panel">
          <div className="auction-hint">╨Я╨╛╨┤╨║╨╗╤О╤З╨░╨╡╨╝╤Б╤П ╨║ ╤Б╨╡╤А╨▓╨╡╤А╤ГтАж</div>
        </div>
      )}

      {!room && !connecting && (
        <section
          className="mf-menu v2 auction-menu"
          aria-label="╨У╨╗╨░╨▓╨╜╨╛╨╡ ╨╝╨╡╨╜╤О ╨░╤Г╨║╤Ж╨╕╨╛╨╜╨░"
        >
          {/* hero тАФ reuse mafia-hero, ╨╜╨╛ ╤Б ╤В╨╡╨║╤Б╤В╨╛╨╝ ╨┐╤А╨╛ ╨░╤Г╨║╤Ж╨╕╨╛╨╜ */}
          <header className="mf-menu-hero" role="banner">
            <button
              type="button"
              className="mf-icon-button mf-menu-close"
              onClick={handleExit}
              aria-label="╨Ч╨░╨║╤А╤Л╤В╤М ╨╕╨│╤А╤Г"
            >
              тЬХ
            </button>

            <div className="mf-menu-logo">AUCTION</div>
            <p className="mf-menu-tagline">
              ╨а╨░╨╖╨┤╨░╨╣ ╨╕╨│╤А╨╛╨║╨╛╨▓ ╨┐╨╛ ╨║╨╛╨╝╨░╨╜╨┤╨░╨╝ ╤З╨╡╤А╨╡╨╖ ╤З╨╡╤Б╤В╨╜╤Л╨╣ ╨░╤Г╨║╤Ж╨╕╨╛╨╜
            </p>
          </header>

          {/* ╨┤╨╡╨╣╤Б╤В╨▓╨╕╤П: ╨▓╨╛╨╣╤В╨╕ ╨┐╨╛ ╨║╨╛╨┤╤Г / ╤Б╨╛╨╖╨┤╨░╤В╤М ╨║╨╛╨╝╨╜╨░╤В╤Г */}
          <div
            className="mf-menu-actions"
            role="group"
            aria-label="╨б╨╛╨╖╨┤╨░╨╜╨╕╨╡ ╨╕╨╗╨╕ ╨▓╤Е╨╛╨┤ ╨▓ ╨║╨╛╨╝╨╜╨░╤В╤Г"
          >
            {/* inline join */}
            <div className="mf-join-inline">
              <label htmlFor="auction-join-code" className="sr-only">
                ╨Ъ╨╛╨┤ ╨║╨╛╨╝╨╜╨░╤В╤Л
              </label>
              <input
                id="auction-join-code"
                className="mf-input big"
                placeholder="╨Ъ╨╛╨┤ ╨║╨╛╨╝╨╜╨░╤В╤Л"
                inputMode="text"
                maxLength={8}
                // ╤В╨░╨║╨╛╨╣ ╨╢╨╡ pattern, ╨║╨░╨║ ╨▓ ╨╝╨░╤Д╨╕╨╕
                pattern="[A-HJKMNPQRSTUVWXYZ23456789]{4,8}"
                title="4тАУ8 ╤Б╨╕╨╝╨▓╨╛╨╗╨╛╨▓: A-H J K M N P Q R S T U V W X Y Z 2тАУ9"
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
                aria-label="╨Т╨╛╨╣╤В╨╕ ╨┐╨╛ ╨║╨╛╨┤╤Г"
              >
                ЁЯФС ╨Т╤Б╤В╤Г╨┐╨╕╤В╤М
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
              aria-label="╨б╨╛╨╖╨┤╨░╤В╤М ╨║╨╛╨╝╨╜╨░╤В╤Г"
              title="╨б╨╛╨╖╨┤╨░╤В╤М ╨╜╨╛╨▓╤Г╤О ╨║╨╛╨╝╨╜╨░╤В╤Г"
            >
              ЁЯУж ╨б╨╛╨╖╨┤╨░╤В╤М ╨║╨╛╨╝╨╜╨░╤В╤Г
            </button>
          </div>

          {/* ╨╝╨░╨╗╨╡╨╜╤М╨║╨╕╨╣ ┬л╨│╨░╨╣╨┤┬╗, ╨║╨░╨║ ╨▓ ╨╝╨░╤Д╨╕╨╕, ╨╜╨╛ ╨┐╨╛╨┤ ╨░╤Г╨║╤Ж╨╕╨╛╨╜ */}
          <section
            className="mf-menu-cards"
            aria-label="╨Ъ╨░╨║ ╤А╨░╨▒╨╛╤В╨░╨╡╤В ╨░╤Г╨║╤Ж╨╕╨╛╨╜"
          >
            <article className="mf-menu-card">
              <div className="ico" aria-hidden="true">
                ЁЯОп
              </div>
              <div className="title">╨Т╤Л╨▒╨╕╤А╨░╨╡╨╝ ╨╕╨│╤А╨╛╨║╨╛╨▓</div>
              <p className="text">
                ╨б╨╛╨╖╨┤╨░╤В╨╡╨╗╤М ╨║╨╛╨╝╨╜╨░╤В╤Л ╨╖╨░╤А╨░╨╜╨╡╨╡ ╨┐╨╛╨┤╨│╨╛╤В╨░╨▓╨╗╨╕╨▓╨░╨╡╤В ╤Б╨┐╨╕╤Б╨╛╨║ ╨╕╨│╤А╨╛╨║╨╛╨▓
                ╨╕╨╗╨╕ ╤Б╨╗╨╛╤В╨╛╨▓, ╨║╨╛╤В╨╛╤А╤Л╨╡ ╤А╨░╨╖╤Л╨│╤А╨░╨╡╨╝.
              </p>
            </article>
            <article className="mf-menu-card">
              <div className="ico" aria-hidden="true">
                ЁЯТ░
              </div>
              <div className="title">╨Ф╨╡╨╗╨░╨╡╨╝ ╤Б╤В╨░╨▓╨║╨╕</div>
              <p className="text">
                ╨Э╨░ ╨║╨░╨╢╨┤╤Л╨╣ ╨╗╨╛╤В ╤Г ╨▓╤Б╨╡╤Е ╨╛╨┤╨╕╨╜╨░╨║╨╛╨▓╤Л╨╣ ╨║╨░╨┐╨╕╤В╨░╨╗. ╨Я╨╛╨▒╨╡╨╢╨┤╨░╨╡╤В
                ╨╝╨░╨║╤Б╨╕╨╝╨░╨╗╤М╨╜╨░╤П ╤Б╤В╨░╨▓╨║╨░, ╨┤╨╡╨╜╤М╨│╨╕ ╤Б╨┐╨╕╤Б╤Л╨▓╨░╤О╤В╤Б╤П ╤Б ╨▒╨░╨╗╨░╨╜╤Б╨░.
              </p>
            </article>
            <article className="mf-menu-card">
              <div className="ico" aria-hidden="true">
                ЁЯзй
              </div>
              <div className="title">╨б╨╛╨▒╨╕╤А╨░╨╡╨╝ ╨║╨╛╨╝╨░╨╜╨┤╤Л</div>
              <p className="text">
                ╨Я╨╛ ╨╕╤В╨╛╨│╨░╨╝ ╨░╤Г╨║╤Ж╨╕╨╛╨╜╨░ ╨┐╨╛╨╗╤Г╤З╨░╨╡╨╝ ╨┐╤А╨╛╨╖╤А╨░╤З╨╜╤Л╨╡, ╨╢╨╕╨▓╤Л╨╡ ╨╕
                ╤Б╨▒╨░╨╗╨░╨╜╤Б╨╕╤А╨╛╨▓╨░╨╜╨╜╤Л╨╡ ╤Б╨╛╤Б╤В╨░╨▓╤Л.
              </p>
            </article>
          </section>
        </section>
      )}

      {room && (
        <div className="auction-main">
          {/* ╨б╨┐╨╕╤Б╨╛╨║ ╨╕╨│╤А╨╛╨║╨╛╨▓ + ╨┤╨╡╨╜╤М╨│╨╕ */}
          <section className="auction-section">
            <div className="auction-section-title">╨Ш╨│╤А╨╛╨║╨╕</div>
            <div className="auction-hint">
              ╨Э╨░╨╢╨╝╨╕ ╨╜╨░ ╨║╨░╤А╤В╨╛╤З╨║╤Г ╨╕╨│╤А╨╛╨║╨░, ╤З╤В╨╛╨▒╤Л ╤Г╨▓╨╕╨┤╨╡╤В╤М ╨╡╨│╨╛ ╨║╨╛╤А╨╖╨╕╨╜╤Г ╨╕
              ╨╛╨▒╤Й╤Г╤О ╤Ж╨╡╨╜╨╜╨╛╤Б╤В╤М ╤Б╨╛╨▒╤А╨░╨╜╨╜╤Л╤Е ╨╗╨╛╤В╨╛╨▓.
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
                  `╨Ш╨│╤А╨╛╨║ ${p.id}`;
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
                          {isMe && " (╨▓╤Л)"}
                        </div>
                        <div className="auction-player-meta">
                          {balance != null ? (
                            <>ЁЯТ╡ {moneyFormatter.format(balance)}$</>
                          ) : (
                            "╨╡╤Й╤С ╨╜╨╡ ╨▓ ╨░╤Г╨║╤Ж╨╕╨╛╨╜╨╡"
                          )}
                        </div>
                        {basketValue > 0 && (
                          <div className="auction-player-meta small">
                            ╨Ъ╨╛╤А╨╖╨╕╨╜╨░:{" "}
                            {moneyFormatter.format(basketValue)}$
                          </div>
                        )}
                        {wins > 0 && (
                          <div className="auction-player-meta small">
                            ╨Я╨╛╨▒╨╡╨┤: {wins}
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="auction-player-tags">
                      {isHost && (
                        <div className="auction-chip owner">
                          ╤Е╨╛╤Б╤В
                        </div>
                      )}
                      {p.ready ? (
                        <div className="auction-chip">╨│╨╛╤В╨╛╨▓</div>
                      ) : (
                        <div className="auction-chip gray">
                          ╨╜╨╡ ╨│╨╛╤В╨╛╨▓
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          {/* ╨Я╨░╨╜╨╡╨╗╤М ╨║╨╛╤А╨╖╨╕╨╜╤Л ╨▓╤Л╨▒╤А╨░╨╜╨╜╨╛╨│╨╛ ╨╕╨│╤А╨╛╨║╨░ */}
          {selectedPlayer && auctionState?.history?.length > 0 && (
            <section className="auction-section">
              <div className="auction-section-title">
                ╨Ъ╨╛╤А╨╖╨╕╨╜╨░ ╨╕╨│╤А╨╛╨║╨░{" "}
                {selectedPlayer.user?.first_name ||
                  selectedPlayer.user?.username ||
                  `╨Ш╨│╤А╨╛╨║ ${selectedPlayer.id}`}
              </div>
              <div className="auction-hint">
                ╨Т╤Б╨╡╨│╨╛ ╨┐╤А╨╡╨┤╨╝╨╡╤В╨╛╨▓: {selectedBasket.length} ┬╖ ╨ж╨╡╨╜╨╜╨╛╤Б╤В╤М
                ╨║╨╛╤А╨╖╨╕╨╜╤Л:{" "}
                {moneyFormatter.format(selectedBasketTotal || 0)}$
              </div>
              {selectedBasket.length === 0 ? (
                <div className="auction-hint">
                  ╨н╤В╨╛╤В ╨╕╨│╤А╨╛╨║ ╨┐╨╛╨║╨░ ╨╜╨╕╤З╨╡╨│╨╛ ╨╜╨╡ ╨▓╤Л╨╕╨│╤А╨░╨╗.
                </div>
              ) : (
                <div className="auction-history">
                  {selectedBasket.map((item) => (
                    <div
                      key={item.index}
                      className="auction-history-item"
                    >
                      <div className="auction-history-title">
                        #{(item.index ?? 0) + 1} ┬╖{" "}
                        {item.type === "lootbox"
                          ? "ЁЯОБ ╨б╨║╤А╤Л╤В╤Л╨╣ ╨╗╨╛╤В"
                          : "ЁЯУж ╨Ы╨╛╤В"}{" "}
                        тАФ {item.name}
                      </div>
                      <div className="auction-history-meta">
                        ╨Ч╨░╨┐╨╗╨░╤В╨╕╨╗:{" "}
                        {moneyFormatter.format(item.paid || 0)}$ ┬╖
                        ╨ж╨╡╨╜╨╜╨╛╤Б╤В╤М:{" "}
                        {moneyFormatter.format(item.value || 0)}$
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}

          {/* ╨Ы╨╛╨▒╨▒╨╕ (╨│╨╛╤В╨╛╨▓╨╜╨╛╤Б╤В╤М + ╤Б╤В╨░╤А╤В) */}
          {showLobby && (
            <section className="auction-section">
              <div className="auction-section-title">╨Ы╨╛╨▒╨▒╨╕</div>
              <div className="auction-row">
                {!isOwner && (
                  <button
                    className="auction-btn primary"
                    onClick={toggleReady}
                    disabled={!currentPlayer}
                  >
                    {currentPlayer?.ready
                      ? "╨п ╨╜╨╡ ╨│╨╛╤В╨╛╨▓"
                      : "╨п ╨│╨╛╤В╨╛╨▓"}
                  </button>
                )}
                {isOwner && (
                  <button
                    className="auction-btn primary"
                    onClick={handleStartAuction}
                    disabled={!everyoneReadyExceptOwner}
                  >
                    {everyoneReadyExceptOwner
                      ? "╨Э╨░╤З╨░╤В╤М ╨░╤Г╨║╤Ж╨╕╨╛╨╜"
                      : "╨Ц╨┤╤С╨╝ ╨╛╤Б╤В╨░╨╗╤М╨╜╤Л╤ЕтАж"}
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
                      тЪЩя╕П ╨Э╨░╤Б╤В╤А╨╛╨╣╨║╨╕
                    </button>
                    <span className="auction-hint">
                      ╨е╨╛╤Б╤В ╨╝╨╛╨╢╨╡╤В ╨╖╨░╨┤╨░╤В╤М ╨▓╤А╨╡╨╝╤П ╨╜╨░ ╨╗╨╛╤В ╨╕ ╤Б╨┐╨╕╤Б╨╛╨║ ╤Б╨╗╨╛╤В╨╛╨▓
                      (╨║╨░╨╢╨┤╨░╤П ╤Б╤В╤А╨╛╨║╨░: ┬л╨Э╨░╨╖╨▓╨░╨╜╨╕╨╡ | ╤Ж╨╡╨╜╨░ | ╤В╨╕╨┐┬╗, ╤В╨╕╨┐ ={" "}
                      <code>lot</code> ╨╕╨╗╨╕ <code>lootbox</code>)
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
                          ╨Т╤А╨╡╨╝╤П ╨╜╨░ ╨╗╨╛╤В, ╤Б╨╡╨║
                        </label>
                        <input
                          id="cfg-time"
                          className="auction-input"
                          inputMode="numeric"
                          pattern="[0-9]*"
                          placeholder="╨Т╤А╨╡╨╝╤П ╨╜╨░ ╨╗╨╛╤В, ╤Б╨╡╨║ (5тАУ120)"
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
                          ╨Ь╨░╨║╤Б╨╕╨╝╤Г╨╝ ╤Б╨╗╨╛╤В╨╛╨▓
                        </label>
                        <input
                          id="cfg-max"
                          className="auction-input"
                          inputMode="numeric"
                          pattern="[0-9]*"
                          placeholder="╨Ь╨░╨║╤Б╨╕╨╝╤Г╨╝ ╤Б╨╗╨╛╤В╨╛╨▓ (1тАУ60)"
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
                          ╨Я╤А╨╕╨╝╨╡╨╜╨╕╤В╤М
                        </button>
                      </div>
                      <textarea
                        className="auction-textarea"
                        placeholder={`╨б╨╗╨╛╤В╤Л (╨┐╨╛ ╨╛╨┤╨╜╨╛╨╝╤Г ╨╜╨░ ╤Б╤В╤А╨╛╨║╤Г), ╨┐╤А╨╕╨╝╨╡╤А:\n╨Ш╨▓╨░╨╜ ╨Ш╨▓╨░╨╜╨╛╨▓ | 120000 | lot\n╨Ь╨╕╤Б╤В╨╕╤З╨╡╤Б╨║╨╕╨╣ ╨╗╤Г╤В╨▒╨╛╨║╤Б | 90000 | lootbox`}
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
                ╨Ъ╨░╨╢╨┤╤Л╨╣ ╨╕╨│╤А╨╛╨║ ╨╜╨░╤З╨╕╨╜╨░╨╡╤В ╤Б{" "}
                {moneyFormatter.format(INITIAL_MONEY)}$. ╨Ч╨░ ╤А╨░╤Г╨╜╨┤
                ╤А╨░╨╖╤Л╨│╤А╤Л╨▓╨░╨╡╤В╤Б╤П ╨╛╨┤╨╕╨╜ ╤Б╨╗╨╛╤В тАФ ╨╛╨▒╤Л╤З╨╜╤Л╨╣ ╨╗╨╛╤В ╨╕╨╗╨╕ ╤Б╨║╤А╤Л╤В╤Л╨╣
                ╨╗╤Г╤В╨▒╨╛╨║╤Б. ╨Э╨░ ╨║╨░╨╢╨┤╤Л╨╣ ╨╗╨╛╤В ╨┤╨░╤С╤В╤Б╤П ╤Б╤З╤С╤В 3-2-1 (╨┐╤А╨╕╨╝╨╡╤А╨╜╨╛ ╨┐╨╛ 3
                ╤Б╨╡╨║╤Г╨╜╨┤╤Л ╨╜╨░ ╤Ж╨╕╤Д╤А╤Г). ╨Ш╨│╤А╨░ ╨╕╨┤╤С╤В ╨┤╨╛{" "}
                {auctionState?.maxSlots ?? cfgRules.maxSlots ?? 30}{" "}
                ╤Б╨╗╨╛╤В╨╛╨▓ ╨╕╨╗╨╕ ╨┐╨╛╨║╨░ ╤Г ╨▓╤Б╨╡╤Е ╨╜╨╡ ╨║╨╛╨╜╤З╨░╤В╤Б╤П ╨┤╨╡╨╜╤М╨│╨╕.
              </div>
              {error && <div className="auction-error">{error}</div>}
            </section>
          )}

          {/* ╨Ю╤Б╨╜╨╛╨▓╨╜╨░╤П ╨╕╨│╤А╨░ */}
          {showGame && (
            <section className="auction-section">
              <div className="auction-section-title">
                ╨в╨╡╨║╤Г╤Й╨╕╨╣ ╨╗╨╛╤В
              </div>
              {currentSlot ? (
                <div className="auction-lot-card">
                  <div className="auction-lot-type">
                    {currentSlot.type === "lootbox"
                      ? "ЁЯОБ ╨б╨║╤А╤Л╤В╤Л╨╣ ╨╗╨╛╤В"
                      : "ЁЯУж ╨Ы╨╛╤В"}
                  </div>
                  <div className="auction-lot-name">
                    {currentSlot.name}
                  </div>
                  <div className="auction-lot-meta">
                    ╨С╨░╨╖╨╛╨▓╨░╤П ╤Б╤В╨╛╨╕╨╝╨╛╤Б╤В╤М:{" "}
                    {moneyFormatter.format(
                      currentSlot.basePrice
                    )}
                    $
                  </div>
                  <div className="auction-lot-meta">
                    ╨б╨╗╨╛╤В {(auctionState.slotsPlayed ?? 0) + 1} ╨╕╨╖{" "}
                    {auctionState.maxSlots}
                  </div>

                  <div
                    className="auction-timer"
                    role="timer"
                    aria-live="polite"
                  >
                    тП│ ╨б╤З╤С╤В:{" "}
                    <strong style={{ fontSize: "1.2em" }}>
                      {countdownStep != null
                        ? countdownStep
                        : "тАФ"}
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
                        ╨┐╨░╤Г╨╖╨░
                      </span>
                    )}
                  </div>

                  <div className="auction-bid-block">
                    <div className="auction-bid-label">
                      ╨Т╨░╤И╨░ ╤Б╤В╨░╨▓╨║╨░ (0 тАФ ╨┐╨░╤Б)
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
                        placeholder="╨б╤Г╨╝╨╝╨░"
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
                        {busyBid ? "╨Ю╤В╨┐╤А╨░╨▓╨║╨░тАж" : "╨б╨┤╨╡╨╗╨░╤В╤М ╤Б╤В╨░╨▓╨║╤Г"}
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
                        ╨Я╨░╤Б
                      </button>
                    </div>
                    <div className="auction-hint">
                      ╨Т╨░╤И ╨▒╨░╨╗╨░╨╜╤Б:{" "}
                      {myBalance != null
                        ? `${moneyFormatter.format(
                            myBalance
                          )}$`
                        : "╨╡╤Й╤С ╨╜╨╡ ╤Г╤З╨░╤Б╤В╨▓╤Г╨╡╤В╨╡"}
                      {" ┬╖ "}
                      {typeof myRoundBid === "number"
                        ? `╨Т╨░╤И╨░ ╤В╨╡╨║╤Г╤Й╨░╤П ╤Б╤В╨░╨▓╨║╨░: ${moneyFormatter.format(
                            myRoundBid
                          )}$`
                        : "╤Б╤В╨░╨▓╨║╨░ ╨╜╨╡ ╨╛╤В╨┐╤А╨░╨▓╨╗╨╡╨╜╨░"}
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
                          тП╕ ╨Я╨░╤Г╨╖╨░
                        </button>
                      ) : (
                        <button
                          className="auction-btn"
                          onClick={resumeAuction}
                        >
                          тЦ╢ ╨Я╤А╨╛╨┤╨╛╨╗╨╢╨╕╤В╤М
                        </button>
                      )}
                      <button
                        className="auction-btn ghost"
                        onClick={forceNext}
                      >
                        тПн ╨б╨╗╨╡╨┤╤Г╤О╤Й╨╕╨╣ ╨╗╨╛╤В
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                <div className="auction-hint">
                  ╨Ю╨╢╨╕╨┤╨░╨╡╨╝ ╤Б╨╗╨╡╨┤╤Г╤О╤Й╨╕╨╣ ╤Б╨╗╨╛╤ВтАж
                </div>
              )}

              {error && <div className="auction-error">{error}</div>}
            </section>
          )}

          {/* ╨а╨╡╨╖╤Г╨╗╤М╤В╨░╤В╤Л */}
          {showResult && (
            <section className="auction-section">
              <div className="auction-section-title">
                ╨а╨╡╨╖╤Г╨╗╤М╤В╨░╤В╤Л ╨░╤Г╨║╤Ж╨╕╨╛╨╜╨░
              </div>
              <div className="auction-hint">
                ╨Ш╨│╤А╨░ ╨╖╨░╨▓╨╡╤А╤И╨╡╨╜╨░. ╨Я╨╛╨▒╨╡╨╢╨┤╨░╨╡╤В ╨╕╨│╤А╨╛╨║(╨╕) ╤Б ╨╝╨░╨║╤Б╨╕╨╝╨░╨╗╤М╨╜╨╛╨╣
                ╤Б╤Г╨╝╨╝╨╛╨╣ ╨┤╨╡╨╜╨╡╨│.
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
                      `╨Ш╨│╤А╨╛╨║ ${p.id}`;
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
                              {isWinner && " ЁЯПЖ"}
                            </div>
                            <div className="auction-player-meta">
                              ╨Ш╤В╨╛╨│:{" "}
                              {moneyFormatter.format(
                                balance
                              )}
                              $
                            </div>
                            <div className="auction-player-meta small">
                              ╨Ъ╨╛╤А╨╖╨╕╨╜╨░:{" "}
                              {moneyFormatter.format(
                                basketValue
                              )}
                              $
                            </div>
                            {wins > 0 && (
                              <div className="auction-player-meta small">
                                ╨Я╨╛╨▒╨╡╨┤: {wins}
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
                    ╨б╤Л╨│╤А╨░╤В╤М ╨╡╤Й╤С ╤А╨░╨╖ ╤Б ╤В╨╡╨╝╨╕ ╨╢╨╡ ╨╕╨│╤А╨╛╨║╨░╨╝╨╕
                  </button>
                )}
                <button
                  className="auction-btn"
                  onClick={handleExit}
                >
                  ╨Т╤Л╨╣╤В╨╕ ╨▓ ╨╝╨╡╨╜╤О
                </button>
              </div>
            </section>
          )}

          {/* ╨Ш╤Б╤В╨╛╤А╨╕╤П ╤Б╨╗╨╛╤В╨╛╨▓ */}
          {auctionState?.history?.length > 0 && (
            <section className="auction-section">
              <div className="auction-section-title">
                ╨Ш╤Б╤В╨╛╤А╨╕╤П ╤Б╨╗╨╛╤В╨╛╨▓
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
                        #{h.index + 1} ┬╖{" "}
                        {h.type === "lootbox"
                          ? "ЁЯОБ ╨б╨║╤А╤Л╤В╤Л╨╣ ╨╗╨╛╤В"
                          : "ЁЯУж ╨Ы╨╛╤В"}{" "}
                        тАФ {h.name}
                      </div>
                      {winnerName ? (
                        <div className="auction-history-meta">
                          ╨Я╨╛╨▒╨╡╨┤╨╕╨╗: {winnerName} ╨╖╨░{" "}
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
                          ╨Э╨╕╨║╤В╨╛ ╨╜╨╡ ╨║╤Г╨┐╨╕╨╗ (╨▓╤Б╨╡ ╨┐╨░╤Б)
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

      {/* ╨в╨╛╤Б╤В╤Л ╨┐╨╛╨▓╨╡╤А╤Е ╨▓╤Б╨╡╨│╨╛ */}
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

