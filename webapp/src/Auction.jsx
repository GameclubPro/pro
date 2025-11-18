// src/Auction.jsx
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import io from "socket.io-client";
import "./Auction.css";

const INITIAL_MONEY = 1_000_000;

// С‚Р°РєРѕР№ Р¶Рµ Р°Р»С„Р°РІРёС‚ РґР»СЏ РєРѕРґР° РєРѕРјРЅР°С‚С‹, РєР°Рє РІ РјР°С„РёРё (Р±РµР· 0/1/O/I)
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
  const [players, setPlayers] = useState([]); // РёР· room:state
  const [selfInfo, setSelfInfo] = useState(null); // private:self { roomPlayerId, userId, ... }
  const [auctionState, setAuctionState] = useState(null); // РёР· auction:state

  // Р»РѕРєР°Р»СЊРЅС‹Р№ РґРµРґР»Р°Р№РЅ Р°РєС‚РёРІРЅРѕРіРѕ СЃР»РѕС‚Р° (РїРѕ СЃРµСЂРІРµСЂРЅРѕРјСѓ timeLeftMs), С‡С‚РѕР±С‹ Р°РЅРёРјРёСЂРѕРІР°С‚СЊ С‚Р°Р№РјРµСЂ Р±РµР· С‡Р°СЃС‚РѕРіРѕ С‚СЂР°С„РёРєР°
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

  // РєРѕРЅС„РёРі (С…РѕСЃС‚, Р»РѕР±Р±Рё)
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

  // РјРѕРё РґР°РЅРЅС‹Рµ РїРѕ С‚РµРєСѓС‰РµРјСѓ СЂР°СѓРЅРґСѓ
  const myRoundBid = useMemo(() => {
    if (!selfInfo) return null;
    const v = auctionState?.currentBids?.[selfInfo.roomPlayerId];
    return typeof v === "number" ? v : null;
  }, [auctionState, selfInfo]);

  // С‚РёРєР°РЅСЊРµ С‚Р°Р№РјРµСЂР° (Р»РѕРєР°Р»СЊРЅРѕ), СЃРµСЂРІРµСЂ РїСЂРёСЃС‹Р»Р°РµС‚ timeLeftMs
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

  // РєСЂСѓРїРЅС‹Р№ СЃС‡С‘С‚ 3-2-1 РїРѕ ~С‚СЂРµС‚СЊ С‚Р°Р№РјРµСЂР°
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
      const name = p.user?.first_name || p.user?.username || `РРіСЂРѕРє ${p.id}`;
      map.set(p.id, name);
    });
    if (auctionState?.players) {
      auctionState.players.forEach((p) => {
        if (!map.has(p.id)) map.set(p.id, p.name);
      });
    }
    return map;
  }, [players, auctionState]);

  // РњРёРЅРё-СЃС‚Р°С‚Р° РїРѕ РїРѕР±РµРґР°Рј
  const winsCountByPlayerId = useMemo(() => {
    const map = new Map();
    if (!auctionState?.history) return map;
    for (const h of auctionState.history) {
      if (h.winnerPlayerId == null) continue;
      map.set(h.winnerPlayerId, (map.get(h.winnerPlayerId) || 0) + 1);
    }
    return map;
  }, [auctionState]);

  // РєРѕСЂР·РёРЅС‹ РёРіСЂРѕРєРѕРІ (РѕС‚РґР°С‘С‚ СЃРµСЂРІРµСЂ)
  const basketByPlayerId = auctionState?.baskets || {};
  const basketTotals = auctionState?.basketTotals || {};

  // РєРѕРіРѕ РїРѕРєР°Р·С‹РІР°РµРј РІ РїР°РЅРµР»Рё РєРѕСЂР·РёРЅС‹: РІС‹Р±СЂР°РЅРЅРѕРіРѕ РёР»Рё СЃРµР±СЏ
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
      setError(`РќРµ СѓРґР°Р»РѕСЃСЊ РїРѕРґРєР»СЋС‡РёС‚СЊСЃСЏ: ${err.message}`);
    });

    s.on("toast", (payload) => {
      if (!payload?.text) return;
      lastToastRef.current = payload;
      setToast(payload);
      // РµСЃР»Рё СЏРІРЅР°СЏ РѕС€РёР±РєР° вЂ” РїРѕРєР°Р¶РµРј РµС‰С‘ Рё РІ error
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

  // Р°РІС‚Рѕ-СЃРєСЂС‹С‚РёРµ С‚РѕСЃС‚Р°
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => {
      if (lastToastRef.current === toast) {
        setToast(null);
      }
    }, 2500);
    return () => clearTimeout(t);
  }, [toast]);

  // --------- BackButton РёР· Telegram ---------
  useEffect(() => {
    if (!setBackHandler) return;
    const handler = () => {
      handleExit();
    };
    setBackHandler(handler);
    return () => setBackHandler(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setBackHandler, room, socket, initData]);

  // --------- Р°РІС‚Рѕ-join РїРѕ РёРЅРІР°Р№С‚-РєРѕРґСѓ ---------
  useEffect(() => {
    if (!socket) return;
    if (!autoJoinCode) return;
    joinRoom(autoJoinCode, { fromInvite: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socket]);

  // --------- РЅР°С‡РёСЃР»РµРЅРёРµ РїСЂРѕРіСЂРµСЃСЃР° РїСЂРё Р·Р°РІРµСЂС€РµРЅРёРё ---------
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
      setError("РќРµС‚ initData РѕС‚ Telegram");
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
            ? "РљРѕРґ РєРѕРјРЅР°С‚С‹ СѓР¶Рµ Р·Р°РЅСЏС‚"
            : "РќРµ СѓРґР°Р»РѕСЃСЊ СЃРѕР·РґР°С‚СЊ РєРѕРјРЅР°С‚Сѓ";
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
      setError("РћС€РёР±РєР° СЃРµС‚Рё РїСЂРё СЃРѕР·РґР°РЅРёРё РєРѕРјРЅР°С‚С‹");
    } finally {
      setCreating(false);
    }
  }

  async function joinRoom(rawCode, options = {}) {
    if (!initData) {
      setError("РќРµС‚ initData РѕС‚ Telegram");
      return;
    }
    const code = String(rawCode || "").trim().toUpperCase();
    if (!code) {
      setError("Р’РІРµРґРёС‚Рµ РєРѕРґ РєРѕРјРЅР°С‚С‹");
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
          room_not_found: "РљРѕРјРЅР°С‚Р° РЅРµ РЅР°Р№РґРµРЅР°",
          room_full: "РљРѕРјРЅР°С‚Р° Р·Р°РїРѕР»РЅРµРЅР°",
          game_in_progress: "РРіСЂР° СѓР¶Рµ РЅР°С‡Р°Р»Р°СЃСЊ",
        };
        setError(msgMap[codeErr] || "РќРµ СѓРґР°Р»РѕСЃСЊ РІРѕР№С‚Рё РІ РєРѕРјРЅР°С‚Сѓ");
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
      setError("РћС€РёР±РєР° СЃРµС‚Рё РїСЂРё РІС…РѕРґРµ РІ РєРѕРјРЅР°С‚Сѓ");
    } finally {
      setJoining(false);
    }
  }

  function toggleReady() {
    if (!socket || !room || !selfInfo) return;
    if (isOwner) return; // РІР»Р°РґРµР»РµС† РЅРµ РѕС‚РјРµС‡Р°РµС‚ В«Р“РѕС‚РѕРІВ»
    const isReady = !!currentPlayer?.ready;
    socket.emit(
      "ready:set",
      { code: room.code, ready: !isReady },
      (resp) => {
        if (!resp || !resp.ok) {
          setError("РќРµ СѓРґР°Р»РѕСЃСЊ РёР·РјРµРЅРёС‚СЊ СЃС‚Р°С‚СѓСЃ В«Р“РѕС‚РѕРІВ»");
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
            room_not_found: "РљРѕРјРЅР°С‚Р° РЅРµ РЅР°Р№РґРµРЅР°",
            forbidden_not_owner: "РўРѕР»СЊРєРѕ РІР»Р°РґРµР»РµС† РјРѕР¶РµС‚ РЅР°С‡Р°С‚СЊ Р°СѓРєС†РёРѕРЅ",
            need_at_least_2_players: "РќСѓР¶РЅРѕ РјРёРЅРёРјСѓРј 2 РёРіСЂРѕРєР°",
            need_ready_players:
              "РќСѓР¶РЅРѕ, С‡С‚РѕР±С‹ РІСЃРµ (РєСЂРѕРјРµ РІР»Р°РґРµР»СЊС†Р°) РЅР°Р¶Р°Р»Рё В«Р“РѕС‚РѕРІВ»",
            already_started: "РђСѓРєС†РёРѕРЅ СѓР¶Рµ Р·Р°РїСѓС‰РµРЅ",
          };
          setError(map[code] || "РќРµ СѓРґР°Р»РѕСЃСЊ Р·Р°РїСѓСЃС‚РёС‚СЊ Р°СѓРєС†РёРѕРЅ");
        }
      }
    );
  }

  function parseSlotsFromText(text) {
    // Р¤РѕСЂРјР°С‚: РєР°Р¶РґР°СЏ СЃС‚СЂРѕРєР° вЂ” "РќР°Р·РІР°РЅРёРµ | С†РµРЅР° | С‚РёРї"
    // С‚РёРї: lot | lootbox; РµСЃР»Рё РЅРµ СѓРєР°Р·Р°РЅ вЂ” lot
    // С†РµРЅР° РѕРїС†РёРѕРЅР°Р»СЊРЅР° (РµСЃР»Рё РЅРµС‚ вЂ” РІРѕР·СЊРјС‘Рј Р±Р°Р·РѕРІСѓСЋ РіРµРЅРµСЂР°С†РёСЋ СЃРµСЂРІРµСЂР°)
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
          setError(resp?.errorText || "РќРµ СѓРґР°Р»РѕСЃСЊ РїСЂРёРјРµРЅРёС‚СЊ РЅР°СЃС‚СЂРѕР№РєРё");
        } else {
          setError("");
          lastToastRef.current = {
            type: "info",
            text: "РќР°СЃС‚СЂРѕР№РєРё РїСЂРёРјРµРЅРµРЅС‹",
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
    // РґР»СЏ СЃРѕРІРјРµСЃС‚РёРјРѕСЃС‚Рё РёСЃРїРѕР»СЊР·СѓРµРј С‚РѕС‚ Р¶Рµ РєР°РЅР°Р» bid СЃ amount: 0
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
      setError("Р’РІРµРґРёС‚Рµ РЅРµРѕС‚СЂРёС†Р°С‚РµР»СЊРЅРѕРµ С‡РёСЃР»Рѕ");
      return;
    }
    if (myBalance != null && n > myBalance) {
      setError("РЎС‚Р°РІРєР° Р±РѕР»СЊС€Рµ, С‡РµРј РІР°С€Рё РґРµРЅСЊРіРё");
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
            room_not_found: "РљРѕРјРЅР°С‚Р° РЅРµ РЅР°Р№РґРµРЅР°",
            not_running: "РђСѓРєС†РёРѕРЅ РµС‰С‘ РЅРµ Р·Р°РїСѓС‰РµРЅ",
            not_player: "Р’С‹ РЅРµ РІ СЌС‚РѕР№ РєРѕРјРЅР°С‚Рµ",
            not_participant: "Р’С‹ РЅРµ СѓС‡Р°СЃС‚РІСѓРµС‚Рµ РІ Р°СѓРєС†РёРѕРЅРµ",
            bad_amount: "РќРµРІРµСЂРЅР°СЏ СЃСѓРјРјР° СЃС‚Р°РІРєРё",
            not_enough_money: "РќРµРґРѕСЃС‚Р°С‚РѕС‡РЅРѕ РґРµРЅРµРі",
            paused: "РђСѓРєС†РёРѕРЅ РЅР° РїР°СѓР·Рµ",
          };
          setError(map[code] || "РќРµ СѓРґР°Р»РѕСЃСЊ РїСЂРёРЅСЏС‚СЊ СЃС‚Р°РІРєСѓ");
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
      const payload = { type: "info", text: "РљРѕРґ РєРѕРјРЅР°С‚С‹ СЃРєРѕРїРёСЂРѕРІР°РЅ" };
      lastToastRef.current = payload;
      setToast(payload);
    } catch {
      const payload = { type: "error", text: "РќРµ СѓРґР°Р»РѕСЃСЊ СЃРєРѕРїРёСЂРѕРІР°С‚СЊ РєРѕРґ" };
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
        <div className="auction-main">
          <header className="auction-header">
            <button
              type="button"
              className="auction-icon-button"
              onClick={handleExit}
              aria-label="Leave room"
            >
              Back
            </button>
            <div className="auction-room-info">
              <div className="auction-title">AUCTION</div>
              <div className="auction-room-code">
                Code
                <span className="auction-room-code-value">{room.code}</span>
              </div>
            </div>
            <button
              type="button"
              className="auction-icon-button ghost"
              onClick={copyRoomCode}
              aria-label="Copy code"
            >
              Copy
            </button>
          </header>
          <section className="auction-status-card">
            <div className="auction-status-grid">
              <div className="auction-stat">
                <span>Р‘Р°Р»Р°РЅСЃ</span>
                <strong>
                  {myBalance != null
                    ? `${moneyFormatter.format(myBalance)}$`
                    : "вЂ”"}
                </strong>
              </div>
              <div className="auction-stat">
                <span>РЎР»РѕС‚С‹</span>
                <strong>
                  {auctionState?.currentSlotIndex != null
                    ? `${(auctionState.currentSlotIndex || 0) + 1}/${
                        auctionState?.maxSlots || cfgRules.maxSlots || 0
                      }`
                    : `${auctionState?.maxSlots || cfgRules.maxSlots || 0}`}
                </strong>
              </div>
            </div>
            <div className="auction-top-meta">
              {showGame ? (
                <div className="auction-timer" role="timer" aria-live="polite">
                  <span className="auction-timer-label">Р”Рѕ Р·Р°РІРµСЂС€РµРЅРёСЏ</span>
                  <strong>{countdownStep != null ? countdownStep : "в€ћ"}</strong>
                  {secsLeft != null && (
                    <span className="auction-timer-secondary">({secsLeft}s)</span>
                  )}
                  {progressPct != null && (
                    <div className="auction-timer-bar">
                      <div className="fill" style={{ width: `${progressPct}%` }} />
                    </div>
                  )}
                  {auctionState?.paused && (
                    <span className="auction-chip gray">РџР°СѓР·Р°</span>
                  )}
                </div>
              ) : (
                <div className="auction-hint">
                  {showLobby
                    ? "Р–РґС‘Рј РІСЃРµС… РёРіСЂРѕРєРѕРІ. РќР°Р¶РјРёС‚Рµ В«Р“РѕС‚РѕРІВ», РєРѕРіРґР° Р±СѓРґРµС‚Рµ РЅР° СЃРІСЏР·Рё."
                    : "Р Р°СѓРЅРґ Р·Р°РІРµСЂС€С‘РЅ. РЎРјРѕС‚СЂРёС‚Рµ СЂРµР·СѓР»СЊС‚Р°С‚С‹ РЅРёР¶Рµ."}
                </div>
              )}
            </div>
            <div className="auction-status-actions">
              {!isOwner && (
                <button
                  className="auction-btn primary"
                  onClick={toggleReady}
                  disabled={!currentPlayer}
                >
                  {currentPlayer?.ready ? "Р“РѕС‚РѕРІ" : "РЇ РіРѕС‚РѕРІ"}
                </button>
              )}
              {isOwner && (
                <button
                  className="auction-btn primary"
                  onClick={handleStartAuction}
                  disabled={!everyoneReadyExceptOwner}
                >
                  {everyoneReadyExceptOwner ? "Р—Р°РїСѓСЃС‚РёС‚СЊ" : "Р–РґС‘Рј РіРѕС‚РѕРІРЅРѕСЃС‚СЊ"}
                </button>
              )}
            </div>
            {isOwner && (
              <div className="auction-config modern">
                <button
                  className="auction-btn small ghost"
                  type="button"
                  onClick={() => setCfgOpen((v) => !v)}
                  aria-expanded={cfgOpen ? "true" : "false"}
                  aria-controls="auction-config-panel"
                >
                  {cfgOpen ? "РЎРєСЂС‹С‚СЊ РЅР°СЃС‚СЂРѕР№РєРё" : "РќР°СЃС‚СЂРѕРёС‚СЊ СЃР»РѕС‚С‹"}
                </button>
                {cfgOpen && (
                  <div id="auction-config-panel" className="auction-config-panel">
                    <div className="auction-row">
                      <input
                        className="auction-input"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        aria-label="Р’СЂРµРјСЏ РЅР° СЃР»РѕС‚, СЃРµРєСѓРЅРґС‹"
                        placeholder="Р’СЂРµРјСЏ РЅР° СЃР»РѕС‚ (5-120)"
                        value={cfgRules.timePerSlotSec}
                        onChange={(e) =>
                          setCfgRules((r) => ({
                            ...r,
                            timePerSlotSec: e.target.value.replace(/[^\d]/g, ""),
                          }))
                        }
                      />
                      <input
                        className="auction-input"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        aria-label="РљРѕР»РёС‡РµСЃС‚РІРѕ СЃР»РѕС‚РѕРІ"
                        placeholder="РЎР»РѕС‚РѕРІ (1-60)"
                        value={cfgRules.maxSlots}
                        onChange={(e) =>
                          setCfgRules((r) => ({
                            ...r,
                            maxSlots: e.target.value.replace(/[^\d]/g, ""),
                          }))
                        }
                      />
                      <button
                        className="auction-btn"
                        type="button"
                        onClick={configureAuction}
                      >
                        РџСЂРёРјРµРЅРёС‚СЊ
                      </button>
                    </div>
                    <textarea
                      className="auction-textarea"
                      placeholder={`РќР°Р·РІР°РЅРёРµ | 120000 | lot`}
                      value={cfgSlotsText}
                      onChange={(e) => setCfgSlotsText(e.target.value)}
                      rows={4}
                    />
                  </div>
                )}
              </div>
            )}
          {error && showLobby && <div className="auction-error">{error}</div>}
        </section>

        <div className="auction-stage">
          <div className="auction-stage-scroll">
          {showGame && (
            <section className="auction-live-card">
              {currentSlot ? (
                <>
                  <div className="auction-lot-core">
                    <div className="auction-lot-type">
                      {currentSlot.type === "lootbox" ? "Р›СѓС‚Р±РѕРєСЃ" : "Р›РѕС‚"}
                    </div>
                    <div className="auction-lot-name">
                      {currentSlot.name || "Р‘РµР· РЅР°Р·РІР°РЅРёСЏ"}
                    </div>
                    <div className="auction-lot-meta">
                      Р‘Р°Р·Р°: {moneyFormatter.format(currentSlot.basePrice || 0)}$
                    </div>
                    <div className="auction-lot-meta">
                      РЎР»РѕС‚ {(auctionState?.slotsPlayed ?? 0) + 1} РёР· {auctionState?.maxSlots}
                    </div>
                  </div>
                  <div className="auction-bid-panel">
                    <input
                      className="auction-input"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      value={myBid}
                      onChange={(e) =>
                        setMyBid(e.target.value.replace(/[^\d]/g, ""))
                      }
                      placeholder="Р’РІРµРґРёС‚Рµ СЃС‚Р°РІРєСѓ"
                    />
                    <button
                      className="auction-btn primary"
                      onClick={() => sendBid()}
                      disabled={busyBid || myBalance == null || myBalance <= 0}
                    >
                      {busyBid ? "РЎС‚Р°РІРёРј..." : "РЎРґРµР»Р°С‚СЊ СЃС‚Р°РІРєСѓ"}
                    </button>
                    <div className="auction-quick-row">
                      <button
                        className="auction-btn small"
                        onClick={() => setBidRelative(1_000)}
                        disabled={myBalance == null || myBalance <= 0}
                      >
                        +1k
                      </button>
                      <button
                        className="auction-btn small"
                        onClick={() => setBidRelative(5_000)}
                        disabled={myBalance == null || myBalance <= 0}
                      >
                        +5k
                      </button>
                      <button
                        className="auction-btn small"
                        onClick={() => setBidRelative(10_000)}
                        disabled={myBalance == null || myBalance <= 0}
                      >
                        +10k
                      </button>
                      <button
                        className="auction-btn small"
                        onClick={() => sendBid(myBalance || 0)}
                        disabled={myBalance == null || myBalance <= 0}
                      >
                        All-in
                      </button>
                      <button className="auction-btn small ghost" onClick={sendPass}>
                        РџР°СЃ
                      </button>
                    </div>
                    <div className="auction-hint">
                      Р‘Р°Р»Р°РЅСЃ: {myBalance != null ? `${moneyFormatter.format(myBalance)}$` : "вЂ”"}
                      {" В· "}
                      {typeof myRoundBid === "number"
                        ? `РўРµРєСѓС‰Р°СЏ СЃС‚Р°РІРєР°: ${moneyFormatter.format(myRoundBid)}$`
                        : "РЎС‚Р°РІРєР° РµС‰С‘ РЅРµ СЃРґРµР»Р°РЅР°"}
                    </div>
                  </div>
                  {isOwner && (
                    <div className="auction-live-owner">
                      {!auctionState?.paused ? (
                        <button className="auction-btn" onClick={pauseAuction}>
                          РџР°СѓР·Р°
                        </button>
                      ) : (
                        <button className="auction-btn" onClick={resumeAuction}>
                          РџСЂРѕРґРѕР»Р¶РёС‚СЊ
                        </button>
                      )}
                      <button className="auction-btn ghost" onClick={forceNext}>
                        РЎР»РµРґСѓСЋС‰РёР№ Р»РѕС‚
                      </button>
                    </div>
                  )}
                </>
              ) : (
                <div className="auction-hint">Р›РѕС‚ РїРѕСЏРІРёС‚СЃСЏ С‡РµСЂРµР· РјРіРЅРѕРІРµРЅРёРµвЂ¦</div>
              )}
              {error && showGame && <div className="auction-error">{error}</div>}
            </section>
          )}

          {!showGame && showLobby && (
            <section className="auction-card muted floating-hint">
              Rally the squad, tap ready, and launch the show when everyone is synced.
            </section>
          )}

          {showResult && (
            <section className="auction-result-card">
              <div className="auction-card-title">Р¤РёРЅРёС€</div>
              <div className="auction-hint">
                РџРѕР±РµРґРёС‚РµР»Рё РїРѕ Р±Р°Р»Р°РЅСЃСѓ РїРѕРєР°Р·Р°РЅС‹ РЅРёР¶Рµ. РњРѕР¶РЅРѕ РЅР°С‡Р°С‚СЊ РЅРѕРІС‹Р№ СЂР°СѓРЅРґ.
              </div>
              <div className="auction-result-grid">
                {players
                  .slice()
                  .sort((a, b) => {
                    const av = auctionState?.balances?.[a.id] ?? 0;
                    const bv = auctionState?.balances?.[b.id] ?? 0;
                    return bv - av;
                  })
                  .map((p) => {
                    const balance = auctionState?.balances?.[p.id] ?? 0;
                    const basketValue = basketTotals[p.id] || 0;
                    const isWinner = auctionState?.winners?.includes(p.id);
                    const name =
                      p.user?.first_name ||
                      p.user?.username ||
                      `РРіСЂРѕРє ${p.id}`;
                    const avatarUrl = p.user?.photo_url || p.user?.avatar || null;
                    return (
                      <div
                        key={p.id}
                        className={`auction-player-card result${isWinner ? " winner" : ""}`}
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
                              {isWinner && " рџ‘‘"}
                            </div>
                            <div className="auction-player-meta">
                              Р‘Р°Р»Р°РЅСЃ: {moneyFormatter.format(balance)}$
                            </div>
                            <div className="auction-player-meta small">
                              РљРѕР»Р»РµРєС†РёСЏ: {moneyFormatter.format(basketValue)}$
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
              </div>
              <div className="auction-row">
                {isOwner && (
                  <button className="auction-btn primary" onClick={handleStartAuction}>
                    РќРѕРІС‹Р№ СЂР°СѓРЅРґ
                  </button>
                )}
                <button className="auction-btn" onClick={handleExit}>
                  Р’С‹Р№С‚Рё РІ РјРµРЅСЋ
                </button>
              </div>
            </section>
          )}

          {auctionState?.history?.length > 0 && (
            <section className="auction-history-card">
              <div className="auction-card-title">РҐСЂРѕРЅРѕР»РѕРіРёСЏ Р»РѕС‚РѕРІ</div>
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
                      effectText = ` +${moneyFormatter.format(d)}$`;
                    } else if (h.effect.kind === "penalty" && d < 0) {
                      effectText = ` ${moneyFormatter.format(d)}$`;
                    }
                  }
                  return (
                    <div key={h.index} className="auction-history-item">
                      <div className="auction-history-title">
                        #{h.index + 1} В· {h.type === "lootbox" ? "Р›СѓС‚Р±РѕРєСЃ" : "Р›РѕС‚"} вЂ” {h.name}
                      </div>
                      {winnerName ? (
                        <div className="auction-history-meta">
                          РџРѕР±РµРґРёС‚РµР»СЊ: {winnerName} Р·Р° {moneyFormatter.format(h.winBid || 0)}$
                          {effectText && <span> ({effectText})</span>}
                        </div>
                      ) : (
                        <div className="auction-history-meta">РЎС‚Р°РІРѕРє РЅРµ Р±С‹Р»Рѕ</div>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {selectedPlayer && (
            <section className="auction-basket-card">
              <div className="auction-card-title">
                РљРѕР»Р»РµРєС†РёСЏ {selectedPlayer.user?.first_name ||
                  selectedPlayer.user?.username ||
                  `РРіСЂРѕРє ${selectedPlayer.id}`}
              </div>
              <div className="auction-hint">
                Р’СЃРµРіРѕ РїСЂРµРґРјРµС‚РѕРІ: {selectedBasket.length} В· Р¦РµРЅРЅРѕСЃС‚СЊ {moneyFormatter.format(selectedBasketTotal || 0)}$
              </div>
              {selectedBasket.length === 0 ? (
                <div className="auction-hint">РџРѕРєР° РїСѓСЃС‚Рѕ вЂ” РІС‹РёРіСЂС‹РІР°Р№С‚Рµ Р»РѕС‚С‹!</div>
              ) : (
                <div className="auction-history">
                  {selectedBasket.map((item) => (
                    <div key={item.index} className="auction-history-item">
                      <div className="auction-history-title">
                        #{(item.index ?? 0) + 1} В· {item.type === "lootbox" ? "Р›СѓС‚Р±РѕРєСЃ" : "Р›РѕС‚"} вЂ” {item.name}
                      </div>
                      <div className="auction-history-meta">
                        РљСѓРїР»РµРЅРѕ Р·Р° {moneyFormatter.format(item.paid || 0)}$ В· РЎС‚РѕРёРјРѕСЃС‚СЊ {moneyFormatter.format(item.value || 0)}$
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}

          {error && !showGame && !showLobby && (

            <div className="auction-error sticky">{error}</div>

          )}

        </div>

        <section className="auction-players-section dock">
          <div className="auction-card-title">пїЅ?пїЅ?пїЅ?пїЅ?пїЅпїЅпїЅ</div>
          <div className="auction-players-grid">
            {players.map((p) => {
              const isMe = p.id === selfInfo?.roomPlayerId;
              const isHost = p.user?.id === room?.ownerId;
              const isSelected = selectedPlayerIdEffective === p.id;
              const name =
                p.user?.first_name ||
                p.user?.username ||
                `пїЅ?пїЅ?пїЅ?пїЅ?пїЅпїЅ ${p.id}`;
              const avatarUrl = p.user?.photo_url || p.user?.avatar || null;
              const balance = auctionState?.balances?.[p.id] ?? null;
              return (
                <button
                  key={p.id}
                  type="button"
                  className={`auction-player-chip${isSelected ? " selected" : ""}${p.ready ? " ready" : ""}${isMe ? " me" : ""}`}
                  onClick={() => setSelectedPlayerId(p.id)}
                >
                  <span className="chip-avatar">
                    {avatarUrl ? (
                      <img src={avatarUrl} alt={name} />
                    ) : (
                      name?.[0]?.toUpperCase()
                    )}
                  </span>
                  <span className="chip-name">
                    {name}
                    {isHost && " пїЅ?:"}
                  </span>
                  <span className="chip-meta">
                    {balance != null ? `${moneyFormatter.format(balance)}$` : "пїЅ?""}
                  </span>
                </button>
              );
            })}
          </div>
        </section>

      </div>

      )}



      {connecting && !room && (

        <div className="auction-card muted">

          <div className="auction-hint">РџРѕРґРєР»СЋС‡Р°РµРјСЃСЏ Рє СЃРµСЂРІРµСЂСѓвЂ¦</div>
        </div>

      )}



      {!room && !connecting && (

        <section

          className="mf-menu v2 auction-menu"

          aria-label="РњРµРЅСЋ РїРѕРґРєР»СЋС‡РµРЅРёСЏ Рє РєРѕРјРЅР°С‚Р°Рј"

        >

          {/* hero пїЅ?" reuse mafia-hero, пїЅ?пїЅ? пїЅ? пїЅ'пїЅпїЅпїЅ?пїЅ'пїЅ?пїЅ? пїЅпїЅпїЅ?пїЅ? пїЅпїЅпїЅ?пїЅпїЅЕђпїЅ?пїЅ? */}

          <header className="mf-menu-hero" role="banner">
            <button
              type="button"
              className="mf-icon-button mf-menu-close"
              onClick={handleExit}
              aria-label="Р—Р°РєСЂС‹С‚СЊ РёРіСЂСѓ"
            >
              вњ•
            </button>

            <div className="mf-menu-logo">AUCTION</div>
            <p className="mf-menu-tagline">
              Р Р°Р·РґР°Р№ РёРіСЂРѕРєРѕРІ РїРѕ РєРѕРјР°РЅРґР°Рј С‡РµСЂРµР· С‡РµСЃС‚РЅС‹Р№ Р°СѓРєС†РёРѕРЅ
            </p>
          </header>

          {/* РґРµР№СЃС‚РІРёСЏ: РІРѕР№С‚Рё РїРѕ РєРѕРґСѓ / СЃРѕР·РґР°С‚СЊ РєРѕРјРЅР°С‚Сѓ */}
          <div
            className="mf-menu-actions"
            role="group"
            aria-label="РЎРѕР·РґР°РЅРёРµ РёР»Рё РІС…РѕРґ РІ РєРѕРјРЅР°С‚Сѓ"
          >
            {/* inline join */}
            <div className="mf-join-inline">
              <label htmlFor="auction-join-code" className="sr-only">
                РљРѕРґ РєРѕРјРЅР°С‚С‹
              </label>
              <input
                id="auction-join-code"
                className="mf-input big"
                placeholder="РљРѕРґ РєРѕРјРЅР°С‚С‹"
                inputMode="text"
                maxLength={8}
                // С‚Р°РєРѕР№ Р¶Рµ pattern, РєР°Рє РІ РјР°С„РёРё
                pattern="[A-HJKMNPQRSTUVWXYZ23456789]{4,8}"
                title="4вЂ“8 СЃРёРјРІРѕР»РѕРІ: A-H J K M N P Q R S T U V W X Y Z 2вЂ“9"
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
                aria-label="Р’РѕР№С‚Рё РїРѕ РєРѕРґСѓ"
              >
                рџ”‘ Р’СЃС‚СѓРїРёС‚СЊ
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
              aria-label="РЎРѕР·РґР°С‚СЊ РєРѕРјРЅР°С‚Сѓ"
              title="РЎРѕР·РґР°С‚СЊ РЅРѕРІСѓСЋ РєРѕРјРЅР°С‚Сѓ"
            >
              рџ“¦ РЎРѕР·РґР°С‚СЊ РєРѕРјРЅР°С‚Сѓ
            </button>
          </div>

          {/* РјР°Р»РµРЅСЊРєРёР№ В«РіР°Р№РґВ», РєР°Рє РІ РјР°С„РёРё, РЅРѕ РїРѕРґ Р°СѓРєС†РёРѕРЅ */}
          <section
            className="mf-menu-cards"
            aria-label="РљР°Рє СЂР°Р±РѕС‚Р°РµС‚ Р°СѓРєС†РёРѕРЅ"
          >
            <article className="mf-menu-card">
              <div className="ico" aria-hidden="true">
                рџЋЇ
              </div>
              <div className="title">Р’С‹Р±РёСЂР°РµРј РёРіСЂРѕРєРѕРІ</div>
              <p className="text">
                РЎРѕР·РґР°С‚РµР»СЊ РєРѕРјРЅР°С‚С‹ Р·Р°СЂР°РЅРµРµ РїРѕРґРіРѕС‚Р°РІР»РёРІР°РµС‚ СЃРїРёСЃРѕРє РёРіСЂРѕРєРѕРІ
                РёР»Рё СЃР»РѕС‚РѕРІ, РєРѕС‚РѕСЂС‹Рµ СЂР°Р·С‹РіСЂР°РµРј.
              </p>
            </article>
            <article className="mf-menu-card">
              <div className="ico" aria-hidden="true">
                рџ’°
              </div>
              <div className="title">Р”РµР»Р°РµРј СЃС‚Р°РІРєРё</div>
              <p className="text">
                РќР° РєР°Р¶РґС‹Р№ Р»РѕС‚ Сѓ РІСЃРµС… РѕРґРёРЅР°РєРѕРІС‹Р№ РєР°РїРёС‚Р°Р». РџРѕР±РµР¶РґР°РµС‚
                РјР°РєСЃРёРјР°Р»СЊРЅР°СЏ СЃС‚Р°РІРєР°, РґРµРЅСЊРіРё СЃРїРёСЃС‹РІР°СЋС‚СЃСЏ СЃ Р±Р°Р»Р°РЅСЃР°.
              </p>
            </article>
            <article className="mf-menu-card">
              <div className="ico" aria-hidden="true">
                рџ§©
              </div>
              <div className="title">РЎРѕР±РёСЂР°РµРј РєРѕРјР°РЅРґС‹</div>
              <p className="text">
                РџРѕ РёС‚РѕРіР°Рј Р°СѓРєС†РёРѕРЅР° РїРѕР»СѓС‡Р°РµРј РїСЂРѕР·СЂР°С‡РЅС‹Рµ, Р¶РёРІС‹Рµ Рё
                СЃР±Р°Р»Р°РЅСЃРёСЂРѕРІР°РЅРЅС‹Рµ СЃРѕСЃС‚Р°РІС‹.
              </p>
            </article>
          </section>
        </section>
      )}

      {/* РЎРїРёСЃРѕРє РёРіСЂРѕРєРѕРІ + РґРµРЅСЊРіРё */}
          <section className="auction-section">{toast && (
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

