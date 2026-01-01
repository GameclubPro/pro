/* eslint-disable */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { io } from "socket.io-client";
import "./mafia.css";
import {
  MenuView,
  RoomShell,
  TimerHUD,
  PlayerGrid,
  ActionSheet,
  VotePopup,
  RoleCard,
  ToastStack,
  ActionToastStack, // NEW
  EndedBar,
  ConfirmLeave,
  NetBanner,
} from "./MafiaUI.jsx";

// Простой boundary, чтобы UI не «чернел» при любой неожиданной ошибке
class UIErrorBoundary extends React.Component {
  constructor(props){ super(props); this.state = { err: null }; }
  static getDerivedStateFromError(err){ return { err }; }
  componentDidCatch(err, info){
    try { console.error("UI error boundary:", err, info); } catch { /* noop */ }
  }
  render(){
    if (this.state.err) {
      return (
        <div className="mf-fatal" role="alert">
          <div className="mf-fatal-card">
            <div className="mf-fatal-title">Произошла ошибка интерфейса</div>
            <button
              className="mf-btn primary"
              onClick={() => {
                try {
                  window?.location?.reload();
                } catch { /* noop */ }
              }}
              type="button"
            >
              Перезагрузить
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

/**
 * @typedef {{id:number, alive:boolean, ready?:boolean, user:{id:number, firstName?:string, username?:string, photoUrl?:string}}} RoomPlayer
 * @typedef {"LOBBY"|"NIGHT"|"DAY"|"VOTE"|"ENDED"} Phase
 */

/** Основной модуль */
export default function Mafia({ apiBase = "", initData, goBack, onProgress, setBackHandler, autoJoinCode, onInviteConsumed }) {
  const tg = typeof window !== "undefined" ? window?.Telegram?.WebApp : undefined;

  // ============================== CFG / helpers ==============================
  // Гварды от setState после размонтирования / выхода
  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

  // Актуальное представление и ref для защиты от поздних апдейтов
  const [view, setView] = useState("menu"); // menu | room
  const viewRef = useRef("menu");
  useEffect(() => { viewRef.current = view; }, [view]);

  const API_BASE = useMemo(() => normalizeApiBase(apiBase), [apiBase]);
  const toastTimersRef = useRef(new Map());

  const haptic = useCallback(
    (kind = "light") => {
      try {
        tg?.HapticFeedback?.impactOccurred?.(kind); // "light" | "medium" | "heavy"
      } catch {}
    },
    [tg]
  );

  // ===== TOKEN STORAGE (простое локальное хранилище с безопасными try/catch) =====
  const TOKEN_KEY = "pt:session";
  const getToken = () => { try { return localStorage.getItem(TOKEN_KEY) || ""; } catch { return ""; } };
  const setToken = (t) => { try { if (t) localStorage.setItem(TOKEN_KEY, t); } catch {} };
  const clearToken = () => { try { localStorage.removeItem(TOKEN_KEY); } catch {} };

  // Мини-тост (без нативных алёртов)
  const [toasts, setToasts] = useState([]);
  const toast = useCallback(
    (text, tone = "info") => {
      const id = `${Date.now()}-${Math.random()}`;
      setToasts((t) => {
        const dropCount = Math.max(0, t.length - 2);
        if (dropCount > 0) {
          t.slice(0, dropCount).forEach((old) => {
            const timerId = toastTimersRef.current.get(old.id);
            if (timerId) clearTimeout(timerId);
            toastTimersRef.current.delete(old.id);
          });
        }
        return [...t.slice(-2), { id, text, tone }];
      });
      const timer = setTimeout(() => {
        setToasts((t) => t.filter((toastItem) => toastItem.id !== id));
        toastTimersRef.current.delete(id);
      }, 2800);
      toastTimersRef.current.set(id, timer);
    },
    []
  );

  const getInitData = () => (initData || tg?.initData || "");

  // === «Ночные» персональные уведомления, которые должны показаться только днём ===
  const nightInboxRef = useRef([]); // копим ночью
  const [actionToasts, setActionToasts] = useState([]); // показываем днём (ActionToastStack)
  const enqueueNightNotice = useCallback((text, tone = "info") => {
    nightInboxRef.current.push({ text, tone });
  }, []);
  const flushNightInbox = useCallback(() => {
    if (!nightInboxRef.current.length) return;
    const batch = nightInboxRef.current.splice(0).map(({ text, tone }) => {
      const id = `notice-${Date.now()}-${Math.random()}`;
      return {
        id,
        text,
        tone,
        onOk: () => setActionToasts((items) => items.filter((x) => x.id !== id)),
      };
    });
    setActionToasts((items) => [...items, ...batch]);
  }, []);

  // Единый fetch с таймаутом/диагностикой
  async function fetchJSON(
    path,
    { method = "GET", body, headers = {}, includeInitHeader = false, timeoutMs = 12000 } = {}
  ) {
    if (!API_BASE) throw new Error("api_base_empty");
    const url = `${API_BASE}${path}`;
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), timeoutMs);

    const finalHeaders = { Accept: "application/json, text/plain, */*", ...headers };
    if (body !== undefined) finalHeaders["Content-Type"] = "application/json";
    // Добавляем Bearer, если токен есть
    const token = getToken();
    if (token) finalHeaders["Authorization"] = `Bearer ${token}`;
    // И (по необходимости) свежие Telegram initData — в спец. заголовке
    if (includeInitHeader) {
      const id = getInitData();
      if (id) finalHeaders["X-Telegram-Init-Data"] = id;
    }

    let resp;
    try {
      resp = await fetch(url, {
        method,
        mode: "cors",
        credentials: "omit",
        cache: "no-store",
        redirect: "follow",
        referrerPolicy: "no-referrer",
        headers: finalHeaders,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
    } catch (e) {
      const name = e?.name || "";
      the:
      {
        const msg = (e && (e.message || e.toString())) || "failed_to_fetch";
        if (name === "AbortError") { throw new Error("network_timeout"); }
        const lowered = String(msg).toLowerCase();
        if (lowered.includes("failed to fetch") || lowered.includes("networkerror") || lowered.includes("load failed")) {
          throw new Error("network_failed_to_fetch");
        }
        throw new Error(msg);
      }
    } finally {
      clearTimeout(t);
    }

    // Улучшенная обработка ошибок: пробуем распарсить JSON и мапить {error}
    if (!resp.ok) {
      const ctErr = resp.headers.get("content-type") || "";
      if (ctErr.includes("application/json")) {
        try {
          const j = await resp.json();
          if (j && typeof j.error === "string" && j.error) {
            const e = new Error(j.error);
            e.httpStatus = resp.status;
            e.serverPayload = j;
            throw e;
          }
          if (j && typeof j.message === "string" && j.message) {
            const e = new Error(j.message);
            e.httpStatus = resp.status;
            e.serverPayload = j;
            throw e;
          }
        } catch {
          // упадём ниже в текстовый режим
        }
      }
      let detail = "";
      try { detail = await resp.text(); } catch {}
      const code = `${resp.status} ${resp.statusText}`.trim();
      const compact = (detail || "").slice(0, 300);
      const err = compact ? `${code}: ${compact}` : code;
      const e = new Error("http_" + err);
      e.httpStatus = resp.status;
      throw e;
    }

    const ct = resp.headers.get("content-type") || "";
    if (ct.includes("application/json")) return resp.json();
    if (ct.includes("text/")) return resp.text();
    return resp.arrayBuffer();
  }

  // =================== Верификация и получение токена при монтировании (один раз) ===================
  useEffect(() => {
    (async () => {
      const id = getInitData();
      if (!id) return; // открыли не из Telegram — токен не получить
      try {
        const r = await fetchJSON(`/auth/verify`, { method: "POST", includeInitHeader: true });
        if (r?.token) setToken(r.token); // сохраним токен на будущее
      } catch {
        // игнорируем: если initData уже протух — будем жить на старом токене
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ============================== REST API (Сигнатуры сохраняем) ==============================
  // Примечание: initData теперь передаётся ТОЛЬКО в заголовке X-Telegram-Init-Data
  const apiCreateRoom = async () => {
    return fetchJSON(`/api/rooms`, { method: "POST", includeInitHeader: true });
  };
  const apiJoinRoom = async (code) => {
    return fetchJSON(`/api/rooms/${encodeURIComponent(code)}/join`, {
      method: "POST",
      includeInitHeader: true,
    });
  };
  const apiSetReady = async (code, ready) =>
    fetchJSON(`/api/rooms/${encodeURIComponent(code)}/ready`, {
      method: "POST",
      includeInitHeader: true,
      body: { ready: !!ready },
    });
  const apiGetRoom = async (code) => {
    return fetchJSON(`/api/rooms/${encodeURIComponent(code)}`, { includeInitHeader: true });
  };
  const apiLeaveRoom = async (code) => {
    return fetchJSON(`/api/rooms/${encodeURIComponent(code)}/leave`, {
      method: "POST",
      includeInitHeader: true,
    });
  };
  const apiStartMafia = async (code) => {
    return fetchJSON(`/api/mafia/${encodeURIComponent(code)}/start`, {
      method: "POST",
      includeInitHeader: true,
    });
  };
  const apiEvents = async (code) => {
    return fetchJSON(`/api/rooms/${encodeURIComponent(code)}/events?limit=40`, { includeInitHeader: true });
  };
  const apiEventsRef = useRef(apiEvents);
  useEffect(() => { apiEventsRef.current = apiEvents; }, [apiEvents]);
  const apiRoomToLobby = async (code) => {
    return fetchJSON(`/api/rooms/${encodeURIComponent(code)}/to-lobby`, {
      method: "POST",
      includeInitHeader: true,
    });
  };

  // ============================== UI State ==============================
  const [busy, setBusy] = useState(false);
  // победитель финала хранится отдельно от таймера (чтобы не затирался room:state'ом)
  const [finalWinner, setFinalWinner] = useState(null);

  // ============================== Room State ==============================
  const [roomCode, setRoomCode] = useState("");
  const roomCodeRef = useRef(roomCode);
  useEffect(() => { roomCodeRef.current = roomCode; }, [roomCode]);

  // Авто-джоин должен срабатывать ТОЛЬКО если явно пришёл инвайт (?join=…).
  // Держим это условие в ref, чтобы использовать его внутри сокет-хендлеров без лишних deps.
  const autoJoinCodeRef = useRef(autoJoinCode);
  useEffect(() => { autoJoinCodeRef.current = autoJoinCode; }, [autoJoinCode]);

  const [roomPlayers, setRoomPlayers] = useState(/** @type {RoomPlayer[]} */ ([]));
  // ref для актуального массива игроков (для сокет-обработчиков вне React цикла)
  const roomPlayersRef = useRef(roomPlayers);
  useEffect(() => { roomPlayersRef.current = roomPlayers; }, [roomPlayers]);

  const [phase, setPhase] = useState(/** @type {Phase} */ ("LOBBY"));
  const phaseRef = useRef(phase);
  useEffect(() => { phaseRef.current = phase; }, [phase]);

  const [dayNumber, setDayNumber] = useState(0);
  const [isOwner, setIsOwner] = useState(false);
  const [ownerId, setOwnerId] = useState(null);
  // ref для актуального ownerId — нужно для корректного вычисления isOwner в момент прихода private:self
  const ownerIdRef = useRef(ownerId);
  useEffect(() => { ownerIdRef.current = ownerId; }, [ownerId]);

  // Таймер: сырые данные с сервера — расчёт/анимация внутри TimerHUD (UI-изолировано)
  const [timer, setTimer] = useState(null); // {phase, endsAt, serverTime, round?, winner?}

  // Голосование
  const [voteState, setVoteState] = useState({ round: 1, tally: {}, alive: 0, leaders: [], myTargetId: null });
  const [voteOpen, setVoteOpen] = useState(false);

  // Private (self)
  const [me, setMe] = useState({ roomPlayerId: null, userId: null, role: null, alive: true });
  const meRef = useRef(me);

  // === UI-штрих: пересчитываем isOwner при любых изменениях ownerId или me.userId ===
  useEffect(() => {
    if (ownerId != null && me?.userId != null) {
      setIsOwner(ownerId === me.userId);
    }
  }, [ownerId, me?.userId]);

  // Храним ещё и myId, зафиксированный на момент выдачи роли — чтобы полёт точно попал в мою плитку
  const [roleIntro, setRoleIntro] = useState({ show: false, role: null, myId: null });
  // Флажок «интро этой ночью уже показывали/пытались показать» — чтобы не зациклиться
  const roleIntroSeenRef = useRef(false);

  // Латченный self: роль/roomPlayerId дополняем из roleIntro, чтобы не зависеть от гоночных обнулений
  const latchedRole = me?.role || roleIntro.role || null;
  const latchedPlayerId = me?.roomPlayerId || roleIntro.myId || null;
  const meWithRole = useMemo(() => {
    if (!latchedRole && !latchedPlayerId) return me;
    return {
      ...me,
      ...(latchedRole ? { role: latchedRole } : {}),
      ...(latchedPlayerId ? { roomPlayerId: latchedPlayerId } : {}),
    };
  }, [me, latchedRole, latchedPlayerId]);
  useEffect(() => { meRef.current = meWithRole; }, [meWithRole]);

  // 🌑 Метки мафии: { myTargetId, byTarget: { [playerId]: number[]<actorIds> } }
  const [mafiaMarks, setMafiaMarks] = useState({ myTargetId: null, byTarget: {} });
  // ✅ публичные раскрытия и приватная команда мафии
  const [revealedRoles, setRevealedRoles] = useState({});
  const revealedRolesRef = useRef(revealedRoles);
  useEffect(() => { revealedRolesRef.current = revealedRoles; }, [revealedRoles]);
  const [mafiaTeam, setMafiaTeam] = useState({});
  const [activeRolesSummary, setActiveRolesSummary] = useState(null);

  // Всегда держим количество живых в актуальном виде (по публичным данным)
  useEffect(() => {
    const aliveCount = (roomPlayers || []).filter((p) => p.alive).length;
    setActiveRolesSummary((prev) => {
      if (prev && prev.totalAlive === aliveCount) return prev;
      return prev ? { ...prev, totalAlive: aliveCount } : { totalAlive: aliveCount };
    });
  }, [roomPlayers]);
  useEffect(() => {
    const alive = activeRolesSummary?.totalAlive;
    if (typeof alive !== "number") return;
    setVoteState((prev) => {
      if (!prev || prev.alive === alive) return prev;
      return { ...prev, alive };
    });
  }, [activeRolesSummary?.totalAlive]);

  // ============================== Events feed (обновлено) ==============================
  const [events, setEvents] = useState([]);
  // реф на текущее значение событий (для дельт по socket:resume)
  const eventsRef = useRef(events);
  useEffect(() => { eventsRef.current = events; }, [events]);

  // Хранение ETag и lastEventId для резюмирования синхронизации
  const stateEtagRef = useRef(null);
  const lastEventIdRef = useRef(null);

  const eventsRefreshAtRef = useRef(0);
  const eventsRefreshInFlightRef = useRef(false);

  const refreshEvents = useCallback(async () => {
    if (!mountedRef.current) return;
    if (viewRef.current !== "room") return;
    const code = roomCodeRef.current;
    if (!code) return;

    const now = Date.now();
    if (eventsRefreshInFlightRef.current) return;
    if (now - eventsRefreshAtRef.current < 800) return;

    eventsRefreshInFlightRef.current = true;
    eventsRefreshAtRef.current = now;
    try {
      const api = apiEventsRef.current;
      const ev = await api(code);
      if (!mountedRef.current) return;
      const next = Array.isArray(ev?.items) ? ev.items : [];
      setEvents((prev) => {
        const prevLast = prev?.length ? prev[prev.length - 1]?.id : null;
        const nextLast = next?.length ? next[next.length - 1]?.id : null;
        return prevLast === nextLast && prev.length === next.length ? prev : next;
      });
      if (next?.length) {
        const nextLast = next[next.length - 1]?.id;
        if (Number.isFinite(Number(nextLast))) lastEventIdRef.current = Number(nextLast);
      }
    } catch {
      // ignore
    } finally {
      eventsRefreshInFlightRef.current = false;
    }
  }, []);

  // Очередь офлайн-операций
  const pendingOpsRef = useRef([]); // [{event, payload, addedAt, attempts}]

  const [eventsOpen, setEventsOpen] = useState(false); // <— раскрытие «Событий» по центральной кнопке

  // ← Храним «последний прочитанный id» в state
  const [lastSeenEventId, setLastSeenEventId] = useState(null);
  const lastId = events?.[events.length - 1]?.id ?? null;

  // есть ли непрочитанные — просто сравнение последнего id с последним прочитанным
  const hasUnread = !!(lastId && lastId !== lastSeenEventId);

  // Пока модалка открыта — всё, что приходит, считаем прочитанным
  useEffect(() => {
    if (eventsOpen && lastId) setLastSeenEventId(lastId);
  }, [eventsOpen, lastId]);

  useEffect(() => {
    if (!eventsOpen) return;
    refreshEvents();
  }, [eventsOpen, refreshEvents]);

  // Тоггл событий: открыть/закрыть; при открытии — сброс непрочитанного бейджа
  const toggleEvents = useCallback(() => {
    setEventsOpen((open) => {
      const next = !open;
      if (next && lastId) setLastSeenEventId(lastId);
      return next;
    });
  }, [lastId]);

  // (опционально) показывать число именно непрочитанных
  const unreadCount = useMemo(() => {
    if (!events?.length) return 0;
    if (!lastSeenEventId) return events.length; // ни разу не открывали — всё «непрочитанное»
    const idx = events.findIndex((e) => e.id === lastSeenEventId);
    return idx === -1 ? events.length : Math.max(0, events.length - idx - 1);
  }, [events, lastSeenEventId]);

  // helper: получить последний id события из локальной ленты
  const getLastEventId = useCallback(() => {
    const list = eventsRef.current || [];
    return list.length ? (list[list.length - 1]?.id ?? null) : null;
  }, []);

  // ActionSheet target
  const [sheetTarget, setSheetTarget] = useState(null);

  // Socket
  const socketRef = useRef(null);
  const reconnectTimerRef = useRef(null);
  const [net, setNet] = useState({ online: true, reconnecting: false, lastError: "" });

  // Client-side assist for role restrictions (soft validation only)
  const roleLocksRef = useRef({
    doctorLastTarget: null,
    doctorSelfUsed: 0,
    sheriffPrevTarget: null,
  });

  // Leave confirm
  const [confirmLeaveOpen, setConfirmLeaveOpen] = useState(false);

  // =================== NEW: локальная блокировка повторного хода за ночь ===================
  const [actedThisNight, setActedThisNight] = useState(false);
  useEffect(() => {
    if (phase === "NIGHT") setActedThisNight(false); // сбрасываем при наступлении новой ночи
    // вне ночи — метки не показываем
    if (phase !== "NIGHT") setMafiaMarks({ myTargetId: null, byTarget: {} });
  }, [phase]);

  // =================== Делегируем BackButton в игру (FIX 6) ==============================
  useEffect(() => {
    if (!setBackHandler) return;
    setBackHandler(() => {
      // приоритет: закрыть открытые слои UI
      if (sheetTarget) { setSheetTarget(null); return; }
      if (eventsOpen)  { setEventsOpen(false); return; }
      if (view === "room") { setConfirmLeaveOpen(true); return; }
      goBack?.();
    });
    return () => setBackHandler(null);
  }, [setBackHandler, view, goBack, sheetTarget, eventsOpen]);

  // ============== Health-check / CORS guard ==============
  useEffect(() => {
    let cancelled = false;
    if (!API_BASE) {
      toast("Не задан API URL. Проверь конфиг (apiBase).", "error");
      return;
    }
    if (isHttpsPage() && isHttpUrl(API_BASE) && !isLocalhost(API_BASE)) {
      toast("Страница по HTTPS, а API по HTTP — браузер заблокирует смешанный контент.", "error");
      return;
    }
    (async () => {
      try {
        const ok = await fetchJSON(`/health`, { method: "GET", timeoutMs: 6000 });
        if (!cancelled && ok !== "OK") {
          toast("API /health отвечает необычно — проверь конфиг сервера.", "warn");
        }
      } catch (e) {
        if (!cancelled) toast(mapNetOrServerError(e), "error");
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [API_BASE]);

  // ============================== FSM: единая точка переходов (ПОДНЯТО ВЫШЕ) ==============================
  const applyRoomStateFromServer = useCallback(
    (s) => {
      // игнорируем поздние апдейты, если размонтированы или не в комнате
      if (!mountedRef.current || viewRef.current !== "room") return;

      const srv = s?.room;
      if (!srv) return;

      const prevPhase = phaseRef.current;

      setPhase((prev) => (prev === srv.status ? prev : srv.status));

      // NEW: если сервер уже знает победителя (ENDED → timer.winner), зафиксируем его локально.
      try {
        const winner = s?.timer?.winner;
        if (srv.status === "ENDED" && winner) {
          setFinalWinner((prev) => prev || winner);
        }
      } catch {}

      setDayNumber((prev) => (prev === (srv.dayNumber || 0) ? prev : (srv.dayNumber || 0)));
      if (srv.ownerId != null) setOwnerId(srv.ownerId);

      // NEW: Зафиксировать ETag и lastEventId для будущего resume
      try {
        if (s?.etag) stateEtagRef.current = String(s.etag);
        if (Number.isFinite(Number(s?.lastEventId))) {
          const nextId = Number(s.lastEventId);
          const prevId = Number(lastEventIdRef.current);
          lastEventIdRef.current = nextId;
          if (!Number.isFinite(prevId) || nextId > prevId) {
            refreshEvents();
          }
        }
      } catch {}

      setRoomPlayers((prev) => {
        // сервер может вернуть игроков и на верхнем уровне, и внутри room
        const nextRaw = s.players ?? s?.room?.players ?? [];
        const next = normalizePlayers(nextRaw);
        const sig = (arr) =>
          JSON.stringify((arr || []).map((p) => [p.id, p.alive, p.ready, p.user?.firstName, p.user?.username, p.user?.photoUrl]));
        const nextSig = sig(next);
        const prevSig = sig(prev || []);
        return nextSig === prevSig ? prev : next;
      });

      // NEW: подтягиваем уже раскрытые роли из публичного состояния комнаты
      try {
        const raw = s.players ?? s?.room?.players;
        if (Array.isArray(raw) && raw.length) {
          const list = normalizePlayers(raw);
          const add = {};
          for (const p of list) {
            if (p && p.id != null && p.role) {
              // если сервер уже считает роль публичной — зафиксируем её локально
              add[p.id] = p.role;
            }
          }
          if (Object.keys(add).length) {
            setRevealedRoles((prev) => ({ ...prev, ...add }));
          }
        }
      } catch {}

      if (typeof s.viewerIsOwner === "boolean") {
        setIsOwner((prev) => {
          if (prev !== s.viewerIsOwner) {
            if (s.viewerIsOwner) toast("👑 Вы стали владельцем комнаты.", "info");
            return s.viewerIsOwner;
          }
          return prev;
        });
      } else {
        const uid = meRef.current?.userId;
        if (uid != null && srv.ownerId != null) {
          setIsOwner(srv.ownerId === uid);
        }
      }

      // Таймер: если поле присутствует — применяем, иначе при изменении статуса — сбрасываем
      if (Object.prototype.hasOwnProperty.call(s, "timer")) {
        setTimer((prev) => {
          const t = s.timer; // может быть null
          if (t == null) return null;
          const same =
            prev &&
            prev.endsAt === t.endsAt &&
            prev.phase === t.phase &&
            (prev.round || 1) === (t.round || 1);
          return same ? prev : t;
        });
      } else if (prevPhase !== srv.status) {
        setTimer(null);
      }

      // NEW: поддержка лидеров раунда 2 из publicRoomState
      if (srv.status === "VOTE" && s.vote && typeof s.vote === "object") {
        setVoteState((prev) => {
          const next = {
            round: typeof s.vote.round === "number" ? s.vote.round : (prev.round || 1),
            tally: (s.vote.tally && typeof s.vote.tally === "object") ? s.vote.tally : (prev.tally || {}),
            alive: typeof s.vote.alive === "number" ? s.vote.alive : (prev.alive || 0),
            leaders: Array.isArray(s.vote.leaders) ? s.vote.leaders : (prev.leaders || []),
            // ✅ не затираем локальную цель голоса
            myTargetId: prev.myTargetId ?? null,
          };
          if (!next.leaders?.length && (next.round || 0) <= 1) next.leaders = [];
          return JSON.stringify(prev) === JSON.stringify(next) ? prev : next;
        });
      }

      // ⏰ Ровно в момент перехода Ночь → День показываем накопленные «ночные» уведомления
      if (prevPhase === "NIGHT" && srv.status === "DAY") {
        flushNightInbox();
      }
    },
    [toast, flushNightInbox, refreshEvents]
  );

  // ============================== Offline queue: отправка накопленных операций ==============================
  const flushPendingOps = useCallback(async () => {
    const sock = socketRef.current;
    if (!sock || !sock.connected) return;
    const q = pendingOpsRef.current;
    if (!q.length) return;
    // Порционно, чтобы не забить ACK-таймауты
    const copy = q.splice(0);
    for (const item of copy.slice(0, 20)) {
      // по одной с коротким таймаутом ожидания ACK
      // eslint-disable-next-line no-await-in-loop
      await new Promise((resolve) => {
        let done = false;
        const t = setTimeout(() => { if (!done) resolve(null); }, 2000);
        try {
          sock.emit(item.event, item.payload, (ack) => {
            done = true;
            clearTimeout(t);
            if (!ack || ack.ok !== true) {
              item.attempts = (item.attempts || 0) + 1;
              if (item.attempts < 2) pendingOpsRef.current.push(item);
            }
            resolve(ack);
          });
        } catch {
          clearTimeout(t);
          item.attempts = (item.attempts || 0) + 1;
          if (item.attempts < 2) pendingOpsRef.current.push(item);
          resolve(null);
        }
      });
    }
  }, []);

  // ============================== Socket ==============================
  const lastSockErrAtRef = useRef(0);
  // Throttle для пересоздания сокета (FIX 3)
  const recreateThrottleRef = useRef(0);

  const ensureSocket = useCallback(() => {
    if (socketRef.current) return socketRef.current;
    const initDataStr = getInitData();
    const sock = io(API_BASE, {
      path: "/socket.io",
      transports: ["websocket", "polling"],
      auth: { initData: initDataStr, token: getToken() }, // ← добавили token
      withCredentials: false,
      forceNew: true,
      reconnection: true,
      reconnectionAttempts: 20,
      reconnectionDelay: 700,
      reconnectionDelayMax: 3500,
      timeout: 8000,
    });

    const clearReconnectTimer = () => {
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
    };

    const autoSubscribe = () => {
      if (!mountedRef.current) return;
      setNet({ online: true, reconnecting: false, lastError: "" });
      clearReconnectTimer();
      const code = roomCodeRef.current;
      if (code) {
        try { sock.emit("room:subscribe", { code }); } catch {}
        // NEW: пробуем резюмирование по ETag + дельта событий
        try {
          sock.emit(
            "room:resume",
            {
              code,
              etag: stateEtagRef.current || null,
              lastEventId: getLastEventId() ?? lastEventIdRef.current ?? null,
            },
            (ack) => {
              try {
          const items = Array.isArray(ack?.deltaEvents) ? ack.deltaEvents : [];
          if (items.length) {
            setEvents((prev) => {
              if (!prev?.length) return items;
              const last = prev[prev.length - 1]?.id ?? 0;
              const add = items.filter((e) => (e?.id ?? 0) > last);
              return add.length ? [...prev, ...add] : prev;
            });
          }
          if (ack?.etag) stateEtagRef.current = String(ack.etag);
          if (Number.isFinite(Number(ack?.lastEventId))) lastEventIdRef.current = Number(ack.lastEventId);
          if (ack?.activeRoles && typeof ack.activeRoles === "object") {
            setActiveRolesSummary(ack.activeRoles);
            if (typeof ack.activeRoles.totalAlive === "number") {
              setVoteState((prev) => {
                if (!prev || prev.alive === ack.activeRoles.totalAlive) return prev;
                return { ...prev, alive: ack.activeRoles.totalAlive };
              });
            }
          }
        } catch {}
      }
    );
        } catch {}
        // Попробуем выгрузить отложенные офлайн-операции
        flushPendingOps();
      }
    };

    sock.on("connect", autoSubscribe);
    sock.on("reconnect", autoSubscribe);

    // (2) Отличать «намеренный» disconnect — не включаем реконнект при reason === "io client disconnect"
    sock.on("disconnect", (reason) => {
      const intentional = reason === "io client disconnect";
      if (mountedRef.current) {
        setNet({
          online: intentional ? true : false,
          reconnecting: intentional ? false : true,
          lastError: String(reason || "")
        });
      }
      // FIX 4: чистим «осиротевший» таймер реконнекта
      clearReconnectTimer();
    });

    try {
      sock.io.on("reconnect_attempt", () => { if (mountedRef.current) setNet((n) => ({ ...n, online: false, reconnecting: true })); });
      sock.io.on("reconnect_error", (e) => {
        if (mountedRef.current) {
          setNet({ online: false, reconnecting: true, lastError: e?.message || "reconnect_error" });
        }
        // троттлинг тостов
        const now = Date.now();
        if (now - lastSockErrAtRef.current > 8000) {
          lastSockErrAtRef.current = now;
          toast("Socket: ошибка переподключения", "error");
        }
        // FIX 3: пересоздание сокета при auth-ошибках на реконнекте
        const msg = e?.message || String(e) || "";
        if (/stale_init_data|bad_signature|initData_required/i.test(msg)) {
          const t = Date.now();
          if (t - (recreateThrottleRef.current || 0) > 3000) {
            recreateThrottleRef.current = t;
            try { sock.disconnect(); } catch {}
            if (socketRef.current === sock) socketRef.current = null;
            setTimeout(() => { try { ensureSocket(); } catch {} }, 0);
          }
        }
      });
      sock.io.on("reconnect_failed", () => {
        if (mountedRef.current) setNet({ online: false, reconnecting: false, lastError: "reconnect_failed" });
        // Автоматическая повторная попытка через N секунд (без forceNew)
        clearReconnectTimer();
        reconnectTimerRef.current = setTimeout(() => {
          reconnectTimerRef.current = null;
          if (socketRef.current === sock && !sock.connected) {
            try { sock.connect(); } catch {}
          }
        }, 8000);
        const now = Date.now();
        if (now - lastSockErrAtRef.current > 8000) {
          lastSockErrAtRef.current = now;
          toast("Socket: переподключение не удалось", "error");
        }
      });
    } catch {}

    sock.on("connect_error", (e) => {
      if (mountedRef.current) {
        setNet({ online: false, reconnecting: true, lastError: e?.message || "connect_error" });
      }
      const msg = e?.message || String(e) || "unknown";
      const now = Date.now();
      if (now - lastSockErrAtRef.current > 8000) {
        lastSockErrAtRef.current = now;
        if (/cors|origin|handshake|invalid sid/i.test(msg)) toast("Socket CORS/handshake: " + msg, "error");
        else if (/xhr poll error/i.test(msg)) toast("Socket transport blocked (polling). Проверь CORS/прокси.", "error");
        else toast("Socket error: " + msg, "error");
      }
      // FIX 3: распознаём auth-ошибки и пересоздаём сокет со свежим initData
      if (/stale_init_data|bad_signature|initData_required/i.test(msg)) {
        const t = Date.now();
        if (t - (recreateThrottleRef.current || 0) > 3000) {
          recreateThrottleRef.current = t;
          try { sock.disconnect(); } catch {}
          if (socketRef.current === sock) socketRef.current = null;
          setTimeout(() => { try { ensureSocket(); } catch {} }, 0);
        }
      }
    });

    sock.on("toast", (p) => p?.text && toast(String(p.text), p?.type || "info"));

    // ---- Основные каналы ----
    sock.on("room:state", (s) => {
      if (!s?.room) return;
      applyRoomStateFromServer(s);
    });

    // сохраняем userId, чтобы устойчиво вычислять isOwner
    sock.on("private:self", (self) => {
      if (!self) return;

      // Не перетираем отсутствующие поля (важно, если сервер пришлёт self без userId)
      setMe((prev) => ({
        roomPlayerId: self.roomPlayerId ?? prev.roomPlayerId,
        userId:       self.userId       ?? prev.userId,
        role:         self.role         ?? prev.role,
        alive: typeof self.alive === "boolean" ? self.alive : prev.alive,
      }));
      try {
        const map = {};
        const team = self.mafiaTeam;
        if (Array.isArray(team)) {
          team.forEach((item) => {
            if (item == null) return;
            if (typeof item === "number") map[item] = "MAFIA";
            else if (item.playerId && item.role) map[item.playerId] = item.role;
          });
        } else if (team && typeof team === "object") {
          Object.entries(team).forEach(([pid, role]) => {
            if (role) map[pid] = role;
          });
        }
        const selfId = self.roomPlayerId;
        const selfRole = self.role;
        if (selfId && (selfRole === "MAFIA" || selfRole === "DON")) {
          map[selfId] = selfRole;
        }
        if (Object.keys(map).length) {
          setMafiaTeam((prev) => ({ ...prev, ...map }));
        }
        // Если сервер дал последние цели мафии в приватном self — сразу отрисуем метки
        if (self?.mafiaTargets && typeof self.mafiaTargets === "object") {
          const items = Array.isArray(self.mafiaTargets.items) ? self.mafiaTargets.items : [];
          const byTarget = {};
          let myTargetId = null;
          items.forEach(({ actorId, targetPlayerId }) => {
            if (targetPlayerId == null) return;
            byTarget[targetPlayerId] = byTarget[targetPlayerId] || [];
            byTarget[targetPlayerId].push(actorId);
            if (actorId === selfId) myTargetId = targetPlayerId;
          });
          setMafiaMarks({ myTargetId, byTarget });
        }
      } catch {}

      // ✅ МГНОВЕННО определяем владельца, не дожидаясь следующего room:state.
      // Это устраняет кейс, когда кнопка "Начать" неактивна до перезагрузки.
      try {
        const uid = self?.userId;
        const oid = ownerIdRef.current;
        if (uid != null && oid != null) setIsOwner(oid === uid);
      } catch {}

      // ⛔️ Больше НЕ авто-прыгаем в комнату, если приложение открыто «без инвайта».
      // Разрешаем авто-резьюм ТОЛЬКО когда явно пришёл autoJoinCode (/?join=XXXX),
      // чтобы «Открыть игру» без инвайта всегда вела на главную.
      if (self.roomCode) {
        const code = self.roomCode;
        if (!roomCodeRef.current && autoJoinCodeRef.current) {
          setRoomCode(code);
          setView("room");
          (async () => {
            try {
              const info = await apiGetRoom(code);
              if (info?.room) applyRoomStateFromServer(info);
            } catch {}
          })();
          try { sock.emit("room:subscribe", { code }); } catch {}
        }
      }

      // Покажем интро один раз, привязав конкретный myId из self (чтобы анимация летела в правильную плитку)
      setRoleIntro((prev) => {
        const changed = !!self.role && self.role !== prev.role;
        return changed ? { show: true, role: self.role, myId: self.roomPlayerId } : prev;
      });
    });

    sock.on("timer:update", (t) => {
      if (!t?.endsAt || !t?.serverTime) return;
      setTimer((prev) => {
        const same =
          prev &&
          prev.endsAt === t.endsAt &&
          prev.phase === t.phase &&
          (prev.round || 1) === (t.round || 1);
        return same ? prev : t;
      });
    });

    // ===================== night:result теперь с rolesById =====================
    sock.on("night:result", ({ killedIds = [], savedId, guardedId, rolesById }) => {
      const killed = Array.isArray(killedIds) ? killedIds : (killedIds ? [killedIds] : []);
      if (killed.length && savedId && killed.includes(savedId)) {
        toast("🩹 Доктор спас жертву этой ночью!", "success");
      } else if (killed.length) {
        toast(`💀 Ночью был${killed.length > 1 ? "и" : ""} убит${killed.length > 1 ? "ы" : ""} игрок${killed.length > 1 ? "и" : ""}…`, "warn");
      } else {
        toast("🌙 Тихая ночь. Никто не погиб.", "info");
      }
      if (rolesById && typeof rolesById === "object") {
        setRevealedRoles((prev) => ({ ...prev, ...rolesById }));
      }
    });

    // 🔎 Результат проверки шерифа — показываем фидбек (обновлено: danger для мафии, success для мирного)
    sock.on("sheriff:result", ({ playerId, isMafia }) => {
      const list = roomPlayersRef.current || [];
      const p = list.find((x) => x.id === playerId);
      const nick = p ? nickOf(p) : "Игрок";
      const verdict = isMafia ? "МАФИЯ" : "мирный";
      const msg = `🔎 Проверка: ${nick} — ${verdict}`;
      const tone = isMafia ? "danger" : "success";
      // показываем только днём через ActionToastStack
      if (phaseRef.current === "DAY") {
        setActionToasts((items) => {
          const id = `sheriff-${Date.now()}-${Math.random()}`;
          return [
            ...items,
            {
              id,
              text: msg,
              tone,
              onOk: () => setActionToasts((cur) => cur.filter((x) => x.id !== id)),
            },
          ];
        });
      } else {
        enqueueNightNotice(msg, tone);
      }
    });

    // 📰 Результат журналиста (обновлено: danger|warn|success)
    sock.on("journalist:result", ({ playerId, category }) => {
      const list = roomPlayersRef.current || [];
      const p = list.find((x) => x.id === playerId);
      const nick = p ? nickOf(p) : "Игрок";
      const text =
        category === "mafia" ? "МАФИЯ" :
        category === "power" ? "силовая роль" : "мирный";
      // Более выразительные тона
      const tone = category === "mafia" ? "danger" : (category === "power" ? "warn" : "success");
      toast(`📰 Расследование: ${nick} — ${text}`, tone);
    });

    // 👇 Ночные персональные эффекты теперь не «пищат» сразу — они попадут в дневной инбокс c кнопкой «ОК»
    sock.on("you:blocked", () => enqueueNightNotice("🚫 Ваш ход этой ночью был заблокирован.", "warn"));
    sock.on("you:healed",  () => enqueueNightNotice("🩹 Вы пережили ночь — вас вылечили.", "success"));
    sock.on("you:guarded", () => enqueueNightNotice("🛡️ Этой ночью вы были под охраной.", "info"));

    sock.on("vote:progress", (p = {}) => {
      setVoteState((prev) => {
        const next = {
          round: p.round ?? prev.round ?? 1,
          tally: p.tally ?? prev.tally ?? {},
          alive: p.alive ?? prev.alive ?? 0,
          leaders: p.leaders ?? prev.leaders ?? [],
          // ✅ сохраняем локальную цель собственного голоса при любых входящих апдейтах
          myTargetId: prev.myTargetId ?? null,
        };
        if (!p.leaders && (next.round || 1) <= 1) next.leaders = [];
        return JSON.stringify(prev) === JSON.stringify(next) ? prev : next;
      });
    });
    sock.on("vote:runoff", (p) => {
      setVoteState((prev) => {
        const next = { ...prev, round: 2, leaders: p?.leaders || [] };
        return JSON.stringify(prev) === JSON.stringify(next) ? prev : next;
      });
      toast("⚖️ Ничья! Переголосование среди лидеров.", "warn");
    });
    sock.on("vote:result", (p) => {
      if (p?.lynchedId) toast("⚔️ Казнён игрок. День завершён.", "warn");
      else toast("🤝 Казни не было.", "info");
      if (p?.lynchedId && p?.lynchedRole) {
        setRevealedRoles((prev) => ({ ...prev, [p.lynchedId]: p.lynchedRole }));
      }
    });

    sock.on("reveal:role", ({ playerId, role }) => {
      if (playerId && role) setRevealedRoles((prev) => ({ ...prev, [playerId]: role }));
    });

    sock.on("reveal:all", ({ rolesById }) => {
      if (rolesById && typeof rolesById === "object") {
        setRevealedRoles((prev) => ({ ...prev, ...rolesById }));
      }
      setPhase("ENDED");
      // winner не приходит — finalWinner остаётся null → EndedBar покажет «Игра завершена»
    });

    // ====== FIXED: сохраняем победителя отдельно и пробрасываем баннер ======
    sock.on("match:ended", ({ winner, rolesById }) => {
      // Красивый тост и крупный баннер
      const banner = winner === "MAFIA" ? "МАФИЯ ПОБЕДИЛА" : "ГОРОД ПОБЕДИЛ";

      // фикс: сохраняем победителя вне таймера (он может обнулиться room:state'ом)
      setFinalWinner(banner);

      toast(winner === "MAFIA" ? "🕶️ Мафия победила!" : "🏙️ Город победил!", "success");

      // Можно оставить winner в таймере как «бонус», но на нём не завязываемся
      setTimer((prev) => (prev ? { ...prev, winner: banner } : prev));

      if (rolesById && typeof rolesById === "object") {
        setRevealedRoles((prev) => ({ ...prev, ...rolesById }));
      }
      setPhase("ENDED");
      persistLastMatch();
    });

    // ⇢ Приватное событие только для мафии — карта «меток»
    sock.on("mafia:targets", ({ night, items } = {}) => {
      const myId = meRef.current?.roomPlayerId;
      const byTarget = {};
      let myTargetId = null;
      (items || []).forEach(({ actorId, targetPlayerId }) => {
        if (targetPlayerId == null) return;
        byTarget[targetPlayerId] = byTarget[targetPlayerId] || [];
        byTarget[targetPlayerId].push(actorId);
        if (actorId === myId) myTargetId = targetPlayerId;
      });
      setMafiaMarks({ myTargetId, byTarget });

      const ids = new Set((items || []).map(x => x.actorId).filter(Boolean));
      const selfRole = meRef.current?.role;
      if (myId && (selfRole === "MAFIA" || selfRole === "DON")) ids.add(myId);
      if (ids.size || (myId && (selfRole === "MAFIA" || selfRole === "DON"))) {
        setMafiaTeam((prev) => {
          const next = { ...prev };
          ids.forEach((id) => {
            if (next[id]) return;
            if (id === myId && (selfRole === "MAFIA" || selfRole === "DON")) {
              next[id] = selfRole;
            } else {
              next[id] = "MAFIA";
            }
          });
          if (myId && (selfRole === "MAFIA" || selfRole === "DON")) {
            next[myId] = selfRole;
          }
          return next;
        });
      }
    });

    // точный состав мафии (включая Дона)
    sock.on("mafia:team", ({ items } = {}) => {
      if (!Array.isArray(items)) return;
      const map = {};
      items.forEach(({ playerId, role }) => {
        if (playerId && (role === "MAFIA" || role === "DON")) map[playerId] = role;
      });
      const selfId = meRef.current?.roomPlayerId;
      const selfRole = meRef.current?.role;
      if (selfId && (selfRole === "MAFIA" || selfRole === "DON")) {
        map[selfId] = selfRole;
      }
      setMafiaTeam(map);
    });

    // NEW: мафия видит, кого проституция заблокировала
    sock.on("mafia:blocked", ({ playerIds } = {}) => {
      const mine = meRef.current?.roomPlayerId;
      const arr = Array.isArray(playerIds) ? playerIds : [];
      if (arr.includes(mine)) {
        enqueueNightNotice("🔒 Вы были заблокированы этой ночью — ваш голос мафии не учтётся", "warn");
      } else if (arr.length) {
        enqueueNightNotice("🔒 Кто-то из мафии был заблокирован — голос мафии мог не пройти", "warn");
      }
    });

    socketRef.current = sock;
    return sock;
  // добавлены зависимости: flushPendingOps, getLastEventId
  }, [API_BASE, toast, enqueueNightNotice, applyRoomStateFromServer, flushPendingOps, getLastEventId]);

  // Подстраховка: если в начале ночи у мафии нет меток целей (пустые mafia:targets),
  // дергаем принудительный room:resume, чтобы сервер заново выслал mafia:targets (включая ботов).
  const mafiaMarksSyncKeyRef = useRef(null);
  useEffect(() => {
    const role = meWithRole?.role;
    const myId = meWithRole?.roomPlayerId;
    const isMafiaRole = role === "MAFIA" || role === "DON";
    const emptyMarks = !mafiaMarks || !mafiaMarks.byTarget || Object.keys(mafiaMarks.byTarget).length === 0;
    if (phase !== "NIGHT" || !roomCode || !isMafiaRole || !emptyMarks) {
      mafiaMarksSyncKeyRef.current = null;
      return;
    }
    const key = `${roomCode}:${phase}:${dayNumber || 0}:${myId || "x"}`;
    if (mafiaMarksSyncKeyRef.current === key) return;
    mafiaMarksSyncKeyRef.current = key;

    try {
      const sock = ensureSocket();
      sock.emit(
        "room:resume",
        { code: roomCode, etag: null, lastEventId: getLastEventId() ?? lastEventIdRef.current ?? null },
        (ack) => {
          try {
            if (ack?.etag) stateEtagRef.current = String(ack.etag);
            if (Number.isFinite(Number(ack?.lastEventId))) {
              lastEventIdRef.current = Number(ack.lastEventId);
            }
          } catch {}
        }
      );
    } catch {}
  }, [phase, roomCode, mafiaMarks, meWithRole?.role, meWithRole?.roomPlayerId, dayNumber, ensureSocket, getLastEventId]);

  useEffect(() => {
    return () => {
      if (socketRef.current) {
        try { socketRef.current.disconnect(); } catch {}
        socketRef.current = null;
      }
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      toastTimersRef.current.forEach((timer) => clearTimeout(timer));
      toastTimersRef.current.clear();
    };
  }, []);

  const subscribeRoom = useCallback(
    (code) => {
      const sock = ensureSocket();
      try { sock.emit("room:subscribe", { code }); } catch {}
    },
    [ensureSocket]
  );

  // Если roomCode появился (например, из private:self), а мы всё ещё в меню — войдём в комнату
  useEffect(() => {
    if (roomCode && view === "menu") {
      setView("room");
      subscribeRoom(roomCode);
      refreshRoom();
    }
  }, [roomCode, view, subscribeRoom]);

  // NEW: Если открыли приложение в меню, но у нас есть завершённая активная комната — 
  // сразу покажем её итоги (чтобы был виден победитель).
  useEffect(() => {
    if (view !== "menu") return;
    let cancelled = false;
    (async () => {
      try {
        const r = await fetchJSON(`/api/self/active-room`, { includeInitHeader: true, timeoutMs: 6000 });
        if (cancelled) return;
        if (r?.code && r.status === "ENDED") {
          setRoomCode(r.code);
          setView("room");
          subscribeRoom(r.code);
          refreshRoom();
        }
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [view, subscribeRoom]);

  // ⚠️ Полностью убрали авто-выход при закрытии/сворачивании приложения (требование продукта).

  // ============================== Low-end авто-детект (7) ==============================
  useEffect(() => {
    try {
      const cores = navigator?.hardwareConcurrency || 4;
      const mem = navigator?.deviceMemory || 4;
      if (cores <= 2 || mem <= 2) document.body.classList.add("mf-lowend");
    } catch {}
  }, []);

  // ============================== Actions ==============================
  const createRoom = async () => {
    try {
      setBusy(true);
      const created = await apiCreateRoom();
      if (created?.error) throw new Error(created.error);
      if (!created?.room?.code) throw new Error("failed");
      if (!mountedRef.current) return;
      setRoomCode(created.room.code);
      // поддерживаем обе формы ответа API
      setRoomPlayers(normalizePlayers(created.players || created?.room?.players || []));
      setPhase(created.room.status || "LOBBY");
      setIsOwner(!!created.viewerIsOwner);
      setOwnerId(created.room.ownerId ?? null);
      setView("room");
      subscribeRoom(created.room.code);
      onProgress?.();
      haptic("medium");
    } catch (e) {
      toast(mapNetOrServerError(e), "error");
    } finally {
      if (mountedRef.current) setBusy(false);
    }
  };

  const joinByCode = async (code) => {
    if (!code) return;
    try {
      setBusy(true);
      const resp = await apiJoinRoom(code);
      if (resp?.error) throw new Error(resp.error);
      if (!resp?.room) throw new Error("room_not_found");
      if (!mountedRef.current) return;
      setRoomCode(code);
      // поддерживаем обе формы ответа API
      setRoomPlayers(normalizePlayers(resp.players || resp?.room?.players || []));
      setPhase(resp.room.status || "LOBBY");
      setIsOwner(!!resp.viewerIsOwner);
      setOwnerId(resp.room.ownerId ?? null);
      setView("room");
      subscribeRoom(code);
      onProgress?.();
      haptic("medium");
      // Инвайт успешно отработал — поглощаем (одноразовость)
      onInviteConsumed?.(code);
    } catch (e) {
      const msg = String(e?.message || "");

      // ==== Безопасный ретрай, если стрельнили до initData / подпись устарела ====
      if (["initData_required", "bad_signature", "stale_init_data"].includes(msg)) {
        let tries = 0;
        const id = setInterval(async () => {
          tries++;
          if (getInitData()) {
            clearInterval(id);
            try {
              const r = await apiJoinRoom(code);
              if (!r?.room) throw new Error("room_not_found");
              if (!mountedRef.current) return;
              setRoomCode(code);
              // поддерживаем обе формы
              setRoomPlayers(normalizePlayers(r.players || r?.room?.players || []));
              setPhase(r.room.status || "LOBBY");
              setIsOwner(!!r.viewerIsOwner);
              setOwnerId(r.room.ownerId ?? null);
              setView("room");
              subscribeRoom(code);
              onProgress?.();
              haptic("medium");
              // Инвайт успешно отработал — поглощаем (одноразовость)
              onInviteConsumed?.(code);
              return;
            } catch (retryErr) {
              // Если и повторно не получилось — сообщим пользователю
              toast(mapNetOrServerError(retryErr), "error");
            }
          }
          if (tries > 40) clearInterval(id); // ~4s
        }, 100);
        return; // не показываем исходную ошибку; ждём ретрай/таймаут
      }

      // Если уже в комнате — просто подтянем её состояние и продолжим
      const already =
        msg === "already_in_room" ||
        msg === "already_joined" ||
        msg === "already_member" ||
        msg === "already-in-room";
      if (already) {
        try {
          const info = await apiGetRoom(code);
          if (!mountedRef.current) return;
          if (info?.room) {
            setRoomCode(code);
            // поддерживаем обе формы
            setRoomPlayers(normalizePlayers(info.players || info?.room?.players || []));
            setPhase(info.room.status || "LOBBY");
            setIsOwner(!!info.viewerIsOwner);
            setOwnerId(info.room.ownerId ?? null);
            setView("room");
            subscribeRoom(code);
            onProgress?.();
            haptic("medium");
            // Инвайт успешно отработал — поглощаем (одноразовость)
            onInviteConsumed?.(code);
            return; // успех, не показываем ошибку
          }
        } catch {}
      }
      toast(mapNetOrServerError(e), "error");
    } finally {
      if (mountedRef.current) setBusy(false);
    }
  };

  // === NEW: Авто-вступление по коду один раз (только в меню) ===
  const triedAutoJoinRef = useRef(false);
  useEffect(() => {
    if (triedAutoJoinRef.current) return;
    if (!autoJoinCode || view !== "menu") return;

    const hasInit = !!getInitData();
    if (!hasInit) return; // подождём следующий тик, когда initData появится

    triedAutoJoinRef.current = true;
    joinByCode(autoJoinCode); // встроенная функция уже всё делает: сетит room, подписывает сокет и т.п.
  }, [autoJoinCode, view, initData]); // eslint-disable-line react-hooks/exhaustive-deps

  // FIX 2: авто-выход в меню, если комната исчезла или мы больше не член
  const refreshRoom = async () => {
    if (!roomCode) return;
    try {
      const resp = await apiGetRoom(roomCode);
      if (!resp?.room) return;
      if (!mountedRef.current) return;
      applyRoomStateFromServer(resp);

      // Если сервер скрывает игроков — значит мы НЕ член комнаты (учитываем обе формы ответа)
      if (!mountedRef.current) return;
      const playersArr = Array.isArray(resp?.players)
        ? resp.players
        : (Array.isArray(resp?.room?.players) ? resp.room.players : []);
      if (viewRef.current === "room" && Array.isArray(playersArr) && playersArr.length === 0) {
        toast("Вы больше не в комнате.", "info");
        resetAll();
        // доп.безопасность: принудительно гасим сокет
        try { socketRef.current?.disconnect(); } catch {}
      }
    } catch (e) {
      const code = e?.httpStatus || 0;
      const msg  = String(e?.message || "");
      if (code === 404 || /room_not_found/i.test(msg)) {
        toast("Комната удалена или недоступна.", "warn");
        resetAll();
      }
      // прочие ошибки — молча/тостом выше
    }
  };

  // 🔄 ОБНОВЛЕНО: старт через socket ACK с фолбэком на REST + улучшенные подсказки «кто не готов»
  const startMafia = async () => {
    if (!roomCode) return;
    try {
      setBusy(true);
      // Подтянем самое свежее состояние (READY/ownerId) перед стартом
      await refreshRoom();

      // 1) Пытаемся стартануть через сокет на текущем инстансе (ACK)
      let started = false;
      try {
        const sock = ensureSocket();
        const ack = await new Promise((resolve) => {
          let done = false;
          const t = setTimeout(() => { if (!done) resolve(null); }, 1800);
          sock.emit("game:start", { code: roomCode }, (a) => { if (!done) { done = true; clearTimeout(t); resolve(a); } });
        });
        if (ack?.ok) started = true;
        if (ack?.error === "need_all_ready" && Array.isArray(ack?.notReady) && ack.notReady.length) {
          const ids = new Set(ack.notReady.map(x => x.playerId));
          const names = (roomPlayers || [])
            .filter(p => ids.has(p.id))
            .map(p => p?.user?.firstName || p?.user?.username || `#${p.id}`);
          if (names.length) toast(`Не все готовы: ${names.join(", ")}`, "warn");
        }
        if (ack && !ack.ok && ack.error && ack.error !== "need_all_ready") {
          toast(mapServerError(ack.error), "error");
        }
      } catch {}

      // 2) Если сокет не помог — фолбэк на REST
      if (!started) {
        const resp = await apiStartMafia(roomCode);
        if (!resp?.ok) throw new Error(resp?.error || "failed");
      }
      if (!mountedRef.current) return;

      // Сброс клиентских «мягких» ограничений ролей между матчами
      roleLocksRef.current = { doctorLastTarget: null, doctorSelfUsed: 0, sheriffPrevTarget: null };

      // --- FIX: очистить клиентские следы прошлой партии до прихода private:self ---
      setRevealedRoles({});
      setMafiaTeam({});
      setActedThisNight(false);
      setMafiaMarks({ myTargetId: null, byTarget: {} });
      roleIntroSeenRef.current = false; // новая ночь — новое интро
      // Начинаем с чистой ленты событий, чтобы «следы» прошлой партии не мигали:
      setEvents([]);
      setLastSeenEventId(null);
      // Обнулить роль до прихода приватного апдейта, чтобы не было окна гонки
      setMe((m) => ({ ...m, role: null, alive: m.alive }));
      // Чистим инбокс и дневные уведомления на старте новой партии
      nightInboxRef.current = [];
      setActionToasts([]);

      // По UX — сразу считаем, что началась ночь (сервер пошлёт timer/state следом)
      setPhase("NIGHT");
      toast("🎬 Игра началась! Фаза: Ночь", "info");
      onProgress?.();
      haptic("heavy");
    } catch (e) {
      toast(mapNetOrServerError(e), "error");
    } finally {
      if (mountedRef.current) setBusy(false);
    }
  };

  // FIX 1: фоновая отправка leave (sendBeacon/keepalive-fetch)
  function sendLeaveInBg(code) {
    if (!API_BASE || !code) return;
    const id = getInitData();
    const token = getToken();
    // 1) Пытаемся через sendBeacon (самый надёжный путь в вебвью/мобиле)
    try {
      if (navigator.sendBeacon) {
        const blob = new Blob([JSON.stringify({ initData: id || "", token: token || "" })], { type: "application/json" });
        navigator.sendBeacon(`${API_BASE}/api/rooms/${encodeURIComponent(code)}/leave`, blob);
        return;
      }
    } catch {}
    // 2) Фолбэк: keepalive-fetch (больше шансов доехать при закрытии)
    try {
      fetch(`${API_BASE}/api/rooms/${encodeURIComponent(code)}/leave`, {
        method: "POST",
        mode: "cors",
        credentials: "omit",
        cache: "no-store",
        redirect: "follow",
        referrerPolicy: "no-referrer",
        keepalive: true,
        headers: {
          "Accept": "application/json, text/plain, */*",
          "Content-Type": "application/json",
          // заголовок дублируем — сервер понимает и header и body
          ...(id ? { "X-Telegram-Init-Data": id } : {}),
          ...(token ? { "Authorization": `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ initData: id || "", token: token || "" }),
      }).catch(() => {});
    } catch {}
  }

  // === NEW: надёжный выход через socket ACK с фолбэком на REST ===
  async function leaveRoomViaSocketAck(timeoutMs = 2500) {
    const code = roomCodeRef.current;
    if (!code) return false;

    try {
      const sock = ensureSocket();

      // Если сокет не соединён — короткая попытка дождаться коннекта
      if (!sock.connected) {
        await new Promise((res, rej) => {
          const t = setTimeout(() => rej(new Error('sock_connect_timeout')), 800);
          sock.once('connect', () => { clearTimeout(t); res(); });
          try { sock.connect(); } catch {}
        }).catch(() => {});
      }

      if (!sock.connected) return false;

      // Отправляем room:leave и ждём ACK ограниченное время
      return await new Promise((resolve) => {
        let done = false;
        const t = setTimeout(() => { if (!done) resolve(false); }, timeoutMs);
        try {
          sock.emit('room:leave', { code }, (ack) => {
            if (done) return;
            done = true;
            clearTimeout(t);
            resolve(!!ack?.ok);
          });
        } catch {
          clearTimeout(t);
          resolve(false);
        }
      });
    } catch {
      return false;
    }
  }

  // FIX: сначала пытаемся корректно выйти на сервере через socket ACK,
  // потом локально чистимся; если не получилось — REST-фолбэк в фоне
  const leaveRoom = async () => {
    const code = roomCodeRef.current;

    // 1) Попробуем корректный ACK по сокету (без разрыва соединения)
    let acked = false;
    try { acked = await leaveRoomViaSocketAck(2500); } catch {}

    // 2) В любом случае — локально выходим, закрываем сокет
    try { socketRef.current?.disconnect(); } catch {}
    socketRef.current = null;
    resetAll();
    haptic("light");

    // Инвайт помечаем «поглощённым» (идемпотентно)
    if (code) onInviteConsumed?.(code);

    // 3) Если через сокет не получилось — дубль в фоне REST-ом (sendBeacon/keepalive)
    if (!acked && code) sendLeaveInBg(code);
  };

  const askLeave = () => setConfirmLeaveOpen(true);
  const cancelLeave = () => setConfirmLeaveOpen(false);
  const confirmLeave = () => {
    setConfirmLeaveOpen(false);
    leaveRoom();
  };

  const returnToLobby = async () => {
    if (!roomCode) return;
    try {
      setBusy(true);
      const resp = await apiRoomToLobby(roomCode);
      if (!resp?.ok) throw new Error(resp?.error || "failed");
      toast("Комната возвращена в лобби", "success");

      // Сбросить мягкие клиентские ограничения ролей при возврате в лобби
      roleLocksRef.current = { doctorLastTarget: null, doctorSelfUsed: 0, sheriffPrevTarget: null };

      setVoteState({ round: 1, tally: {}, alive: 0, leaders: [], myTargetId: null });
      setEvents([]);
      setLastSeenEventId(null); // ← FIX: обнуляем «последнее прочитанное»
    } catch (e) {
      toast(mapNetOrServerError(e), "error");
    } finally {
      if (mountedRef.current) setBusy(false);
    }
  };

  function getPublicAppUrl() {
    try {
      if (typeof window !== "undefined") {
        const g = window;
        if (g.__PUBLIC_APP_URL__) return String(g.__PUBLIC_APP_URL__);
        if (g.PUBLIC_APP_URL) return String(g.PUBLIC_APP_URL);
        const meta = document.querySelector('meta[name="public-app-url"]');
        if (meta?.content) return String(meta.content);
      }
      if (typeof import.meta !== "undefined" && import.meta?.env?.VITE_PUBLIC_APP_URL) return String(import.meta.env.VITE_PUBLIC_APP_URL);
      if (typeof process !== "undefined" && process?.env?.PUBLIC_APP_URL) return String(process.env.PUBLIC_APP_URL);
    } catch {}
    return "";
  }

  // NEW: получение username бота для deep-link
  function getBotUsername() {
    try {
      if (typeof window !== "undefined") {
        const g = window;
        if (g.__BOT_USERNAME__) return String(g.__BOT_USERNAME__);
        if (g.BOT_USERNAME) return String(g.BOT_USERNAME);
        const meta = document.querySelector('meta[name="bot-username"]');
        if (meta?.content) return String(meta.content);
      }
      if (typeof import.meta !== "undefined" && import.meta?.env?.VITE_BOT_USERNAME) return String(import.meta.env.VITE_BOT_USERNAME);
      if (typeof process !== "undefined" && process?.env?.BOT_USERNAME) return String(process.env.BOT_USERNAME);
    } catch {}
    return "";
  }

  const shareRoom = () => {
    if (!roomCode) return;

    const inviteText = `Подключайся к комнате: ${roomCode}`;

    // Современный deep-link для Mini App (startapp → авто-вход по коду)
    const BOT_USERNAME = getBotUsername();
    if (BOT_USERNAME) {
      const startPayload = `join-${roomCode}`;
      const startappLink = `https://t.me/${BOT_USERNAME}?startapp=${encodeURIComponent(startPayload)}`;
      const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(startappLink)}&text=${encodeURIComponent(inviteText)}`;
      try {
        if (tg?.openTelegramLink) tg.openTelegramLink(shareUrl);
        else window.open(shareUrl, "_blank", "noopener,noreferrer");
        haptic("light");
        return;
      } catch {}
    }

    // Фолбэк: обычная ссылка с ?join=<code> + t.me/share/url
    const base = getPublicAppUrl() || (typeof location !== "undefined" ? location.origin : "");
    const appUrl = base ? `${base.replace(/\/+$/, "")}/?join=${encodeURIComponent(roomCode)}` : "";
    const text = encodeURIComponent(inviteText);
    const urlParam = encodeURIComponent(appUrl || (typeof location !== "undefined" ? location.origin : ""));
    const shareUrl = `https://t.me/share/url?url=${urlParam}&text=${text}`;
    try {
      if (tg?.openTelegramLink) tg.openTelegramLink(shareUrl);
      else window.open(shareUrl, "_blank", "noopener,noreferrer");
      haptic("light");
    } catch {
      window.open(shareUrl, "_blank", "noopener,noreferrer");
    }
  };

  const copyCode = async () => {
    if (!roomCode) return;
    try {
      await navigator.clipboard.writeText(roomCode);
      toast("Код скопирован", "success");
      haptic("light");
    } catch {
      toast("Не удалось скопировать", "error");
    }
  };

  // Ночные действия (ACK + офлайн-очередь)
  const actNight = (targetPlayerId) => {
    if (!roomCode) return;
    const sock = ensureSocket();
    const opId = (globalThis?.crypto?.randomUUID && crypto.randomUUID())
      || `op-${Date.now()}-${Math.random().toString(36).slice(2,10)}`;
    const roleNow = meRef.current?.role;
    if (isMafia(roleNow) && targetPlayerId != null) {
      const target = (roomPlayersRef.current || []).find((p) => p.id === targetPlayerId);
      const hint =
        mafiaTeam?.[targetPlayerId] ||
        revealedRolesRef.current?.[targetPlayerId] ||
        target?.role ||
        null;
      if (["MAFIA", "DON"].includes(String(hint || "").toUpperCase())) {
        toast("Союзников мафии бить нельзя", "warn");
        haptic("light");
        closeSheet();
        return;
      }
    }

    if (!sock.connected) {
      // офлайн — кладём в очередь и закроем шторку
      pendingOpsRef.current.push({
        event: "night:act",
        payload: { code: roomCode, targetPlayerId, opId },
        addedAt: Date.now(),
        attempts: 0
      });
      toast("Сеть недоступна: действие поставлено в очередь", "warn");
      haptic("light");
      closeSheet();
      return;
    }

    sock.emit("night:act", { code: roomCode, targetPlayerId, opId }, (ack) => {
      if (ack?.ok) {
        const roleNowAck = meRef.current?.role;
        if (!isMafia(roleNowAck)) {
          setActedThisNight(true);
        }
        if (isMafia(roleNowAck)) {
          setMafiaMarks((m) => ({ ...m, myTargetId: targetPlayerId || null }));
        }
        if (roleNowAck === "DOCTOR") {
          const meId = meRef.current?.roomPlayerId;
          if (targetPlayerId === meId) roleLocksRef.current.doctorSelfUsed = 1;
          roleLocksRef.current.doctorLastTarget = targetPlayerId || null;
        }
        if (roleNowAck === "SHERIFF") {
          roleLocksRef.current.sheriffPrevTarget = targetPlayerId || null;
        }
        haptic("light");
        closeSheet(); // закрываем только при успехе
      } else if (ack?.error) {
        toast(mapServerError(ack.error, ack?.retryMs), "error");
        haptic("light");
        // не закрываем — позволяем выбрать другую цель
      }
    });
  };

  // Голос (ACK + офлайн-очередь; закрываем шторку только при успехе)
  const castVote = (targetPlayerId) => {
    if (!roomCode) return;
    const sock = ensureSocket();
    const opId = (globalThis?.crypto?.randomUUID && crypto.randomUUID())
      || `op-${Date.now()}-${Math.random().toString(36).slice(2,10)}`;

    if (!sock.connected) {
      pendingOpsRef.current.push({
        event: "vote:cast",
        payload: { code: roomCode, targetPlayerId, opId },
        addedAt: Date.now(),
        attempts: 0
      });
      toast("Сеть недоступна: голос поставлен в очередь", "warn");
      haptic("light");
      closeSheet();
      return;
    }

    sock.emit("vote:cast", { code: roomCode, targetPlayerId, opId }, (ack) => {
      if (!ack?.ok && ack?.error) {
        toast(mapServerError(ack.error, ack?.retryMs), "error");
      } else {
        // ✅ Локально запомним «за кого проголосовал», чтобы подсветка работала сразу
        setVoteState((prev) => {
          const next = {
            ...prev,
            myTargetId: targetPlayerId == null ? null : Number(targetPlayerId),
          };
          return JSON.stringify(prev) === JSON.stringify(next) ? prev : next;
        });
        closeSheet();
      }
      haptic("light");
    });
  };

  const closeSheet = () => setSheetTarget(null);

  function buildActions({
    phase,
    me,
    voteState,
    target,
    actNight,
    castVote,
    mafiaTeam,
    revealedRoles,
    actedThisNight,
  }) {
    if (!target) return [];
    const isMe = me?.roomPlayerId === target.id;
    const alive = !!target?.alive;
    const targetRoleHint =
      mafiaTeam?.[target.id] ||
      revealedRoles?.[target.id] ||
      null;
    const targetIsMafia = ["MAFIA", "DON"].includes(
      String(targetRoleHint || "").toUpperCase()
    );
    a:
    {
      const round2 = voteState?.round === 2;
      const leadersSet = new Set(voteState?.leaders || []);
      const actions = [];

      if (phase === "NIGHT" && me?.alive && !isMafia(me.role) && actedThisNight) {
        return [btn("done", "Ход сделан", "ghost", () => closeSheet(), true)];
      }

      if (phase === "NIGHT" && me?.alive) {
        if (isMafia(me.role) && alive && !isMe) {
          if (!targetIsMafia) {
            actions.push(btn("kill", `Убить ${nickOf(target)}`, "danger", () => actNight(target.id)));
          } else {
            actions.push(btn("ally", "Союзник мафии", "ghost", () => {}, true));
          }
        }
        if (me.role === "DOCTOR" && alive) {
          const locks = roleLocksRef.current;
          const sameTargetBlocked = locks.doctorLastTarget && locks.doctorLastTarget === target.id;
          const selfBlocked = isMe && locks.doctorSelfUsed >= 1;
          const note = isMe
            ? (selfBlocked ? " (самолечение исчерпано)" : " (самолечение)")
            : (sameTargetBlocked ? " (нельзя лечить подряд)" : "");
          actions.push(
            btn("heal", `Лечить ${isMe ? "себя" : nickOf(target)}${note}`, "ok", () => actNight(target.id), sameTargetBlocked || selfBlocked)
          );
          actions.push(btn("skipDoc", "Пропустить", "ghost", () => actNight(null)));
        }
        if (me.role === "SHERIFF" && alive && !isMe) {
          const locks = roleLocksRef.current;
          const repeatBlocked = locks.sheriffPrevTarget && locks.sheriffPrevTarget === target.id;
          actions.push(
            btn("inspect", `Проверить ${nickOf(target)}${repeatBlocked ? " (нельзя подряд)" : ""}`, "warn", () => actNight(target.id), repeatBlocked)
          );
          actions.push(btn("skipSher", "Пропустить", "ghost", () => actNight(null)));
        }
        if (me.role === "BODYGUARD" && alive && !isMe) {
          actions.push(btn("guard", `Охранять ${nickOf(target)}`, "ok", () => actNight(target.id)));
          actions.push(btn("skipBody", "Пропустить", "ghost", () => actNight(null)));
        }
        if (me.role === "PROSTITUTE" && alive && !isMe) {
          actions.push(btn("block", `Заблокировать ${nickOf(target)}`, "warn", () => actNight(target.id)));
          actions.push(btn("skipPro", "Пропустить", "ghost", () => actNight(null)));
        }
        if (me.role === "JOURNALIST" && alive && !isMe) {
          actions.push(btn("investigate", `Расследовать ${nickOf(target)}`, "warn", () => actNight(target.id)));
          actions.push(btn("skipJour", "Пропустить", "ghost", () => actNight(null)));
        }
        if (me.role === "SNIPER" && alive && !isMe) {
          actions.push(btn("snipe", `Выстрелить в ${nickOf(target)}`, "danger", () => actNight(target.id)));
          actions.push(btn("skipSnipe", "Пропустить", "ghost", () => actNight(null)));
        }
      }

      if (phase === "VOTE" && me?.alive) {
        const allowedByRound = !round2 || leadersSet.has(target.id);
        const skipAllowed = !round2 || leadersSet.has(0);
        if (!isMe && alive && allowedByRound) {
          actions.push(btn("vote", `Голосовать за ${nickOf(target)}`, "primary", () => castVote(target.id)));
        }
        if (skipAllowed) actions.push(btn("skipVote", "Пропустить голос", "ghost", () => castVote(null)));
      }

      return actions;
    }
  }

  const openSheetFor = useCallback((p) => {
    if (!p) return;

    if (phase === "LOBBY") {
      toast("Ждём начала игры", "info");
      haptic("light");
      return;
    }
    if (phase === "DAY") {
      toast("Днём обсуждаем — без действий", "info");
      haptic("light");
      return;
    }
    if (phase === "ENDED") {
      toast("Игра завершена", "info");
      haptic("light");
      return;
    }
    // --- FIX: защита от окна гонки — ждём выдачи роли ---
    if (phase === "NIGHT" && !meWithRole?.role) {
      toast("Ждём выдачу роли…", "info");
      haptic("light");
      return;
    }

    const acts = buildActions({
      phase,
      me: meWithRole,
      voteState,
      target: p,
      actNight,
      castVote,
      mafiaTeam,
      revealedRoles,
      actedThisNight,
    });

    const hasActionable = acts.some(a => !a.disabled && a.tone !== "ghost");

    if (!hasActionable) {
      if (phase === "NIGHT") toast("Ночью у вас нет действий", "info");
      else if (phase === "VOTE") toast("Выберите доступную цель для голосования", "info");
      // на всякий случай гасим целевую плитку, чтобы не оставлять «полу-открытое» состояние
      setSheetTarget(null);
      return;
    }

    haptic("light");
    setSheetTarget(p);
  }, [phase, meWithRole, voteState, toast, haptic, actNight, castVote, mafiaTeam, revealedRoles, actedThisNight]);

  const actionsForTarget = useMemo(() => {
    if (!sheetTarget) return [];
    return buildActions({
      phase,
      me: meWithRole,
      voteState,
      target: sheetTarget,
      actNight,
      castVote,
      mafiaTeam,
      revealedRoles,
      actedThisNight,
    });
  }, [sheetTarget, phase, meWithRole, voteState, actedThisNight, mafiaTeam, revealedRoles, actNight, castVote]);

  useEffect(() => {
    if (!sheetTarget) return;
    const updated = roomPlayers.find((p) => p.id === sheetTarget.id);
    if (!updated) { setSheetTarget(null); return; }
    if (updated !== sheetTarget) setSheetTarget(updated);
  }, [roomPlayers, sheetTarget]);

  // ============================== Auto refresh / events feed (обновлено с гардом) ==============================
  useEffect(() => {
    if (view !== "room" || !roomCode) return;
    let alive = true;

    const update = async () => {
      if (!alive || !mountedRef.current) return;
      await refreshRoom();
      if (!alive || !mountedRef.current) return;
      await refreshEvents();
    };

    const id = setInterval(update, 20000);
    update(); // первый прогон
    const onVis = () => { if (document.visibilityState === "visible") update(); };

    // ⤵️ Новый обработчик фокуса: обновить состояние и подписаться на комнату
    const onFocus = () => { update(); subscribeRoom(roomCodeRef.current); };

    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVis);

    return () => {
      alive = false;
      clearInterval(id);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVis);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, roomCode, subscribeRoom]); // Внимание: не менять названия публичных REST-функций и событий сокета.

  useEffect(() => {
    if (phase === "VOTE") return;
    setVoteState((prev) => {
      const emptyTally = !Object.keys(prev.tally || {}).length;
      if (prev.round === 1 && emptyTally && !prev.leaders?.length && !prev.alive) return prev;
      return { round: 1, tally: {}, alive: 0, leaders: [], myTargetId: null };
    });
  }, [phase]);

  // ============================== READY (клиент) ==============================
  const myId = meWithRole.roomPlayerId;
  const myRole = meWithRole.role;
  const myPlayer = useMemo(() => roomPlayers.find(p => p.id === myId) || null, [roomPlayers, myId]);
  // владелец всегда считается «готов» (в UI и при canStart)
  const iAmReady = isOwner ? true : !!myPlayer?.ready;

  // NEW: улучшенный toggleReady с оптимистичным UI, REST → socket ACK фолбэком и форс-синком
  const toggleReady = useCallback(async () => {
    if (!roomCode || isOwner) return;
    const next = !iAmReady;
    // 1) Пробуем REST (быстро/дёшево) и сразу отражаем результат локально
    try {
      const r = await apiSetReady(roomCode, next); // { ok, ready }
      const val = (r && typeof r.ready === "boolean") ? r.ready : next;
      setRoomPlayers((prev) => prev.map((p) =>
        p.id === myId ? { ...p, ready: val } : p
      ));
      haptic("light");
      return;
    } catch (e) {
      // 2) Фолбэк на сокет ACK (полезно, если initData протухла)
      try {
        const ok = await new Promise((resolve) => {
          const sock = ensureSocket();
          sock.emit("ready:set", { code: roomCode, ready: next }, (ack) => resolve(!!ack?.ok));
        });
        if (ok) {
          setRoomPlayers((prev) => prev.map((p) =>
            p.id === myId ? { ...p, ready: next } : p
          ));
          haptic("light");
          return;
        }
      } catch {}
      // 3) Если оба пути не сработали — показываем ошибку и принудительно синхронизируемся
      toast(mapNetOrServerError(e), "error");
      refreshRoom();
    }
  }, [roomCode, iAmReady, isOwner, myId, ensureSocket]);

  // ============================== Хаптик при входе в критзону таймера (2) ==============================
  const criticalFiredKeyRef = useRef(null);
  useEffect(() => {
    const endsAt = timer?.endsAt ? toMs(timer.endsAt) : 0;
    if (!endsAt) return;
    const key = endsAt;
    const tick = () => {
      const msLeft = endsAt - Date.now();
      if (msLeft <= 5000 && msLeft > 0 && criticalFiredKeyRef.current !== key) {
        criticalFiredKeyRef.current = key;
        try { haptic("light"); } catch {}
      }
    };
    const id = setInterval(tick, 500);
    tick();
    return () => clearInterval(id);
  }, [timer?.endsAt, haptic]);

  // ============================== Persist last match summary ==============================
  function persistLastMatch() {
    try {
      const data = { code: roomCode, at: Date.now(), events };
      localStorage.setItem("mafia:lastMatch", JSON.stringify(data));
    } catch {}
  }

  // ============================== Utils & resets ==============================
  function resetAll() {
    setRoomCode("");
    setRoomPlayers([]);
    setPhase("LOBBY");
    setIsOwner(false);
    setOwnerId(null);
    setView("menu");
    setVoteState({ round: 1, tally: {}, alive: 0, leaders: [], myTargetId: null });
    setTimer(null);
    setMe({ roomPlayerId: null, userId: null, role: null, alive: true });
    setSheetTarget(null);
    setEvents([]);
    setRoleIntro({ show: false, role: null, myId: null });
    setEventsOpen(false);
    setBusy(false);
    setLastSeenEventId(null); // ← сбрасываем state вместо ref
    roleLocksRef.current = { doctorLastTarget: null, doctorSelfUsed: 0, sheriffPrevTarget: null };
    setActedThisNight(false);
    setMafiaMarks({ myTargetId: null, byTarget: {} });
    setRevealedRoles({});
    setMafiaTeam({});
    setActiveRolesSummary(null);
    setFinalWinner(null); // +++ сброс победителя при полном ресете
    // NEW: чистим ночной инбокс и дневные уведомления
    nightInboxRef.current = [];
    setActionToasts([]);
    // (3) Сброс сети при выходе/сбросе
    setNet({ online: true, reconnecting: false, lastError: "" });
    roleIntroSeenRef.current = false;
    // NEW: сброс ETag/lastEventId/очереди офлайн-операций
    stateEtagRef.current = null;
    lastEventIdRef.current = null;
    pendingOpsRef.current = [];
    // При полном ресете можем по желанию чистить токен:
    // clearToken(); // ← если нужно «жёстко» дропать сессию на фронте
  }

  // --- FIX: универсальный сброс «следов прошлой партии» при входе в LOBBY ---
  useEffect(() => {
    if (phase === "LOBBY") {
      setMe((m) => ({ ...m, role: null, alive: true }));
      setRoleIntro({ show: false, role: null, myId: null });
      roleIntroSeenRef.current = false; // обнуляем флаг при возврате в лобби
      setRevealedRoles({});
      setMafiaTeam({});
      setActedThisNight(false);
      setMafiaMarks({ myTargetId: null, byTarget: {} });
      // Новая игра должна начинаться «с чистого листа»
      roleLocksRef.current = { doctorLastTarget: null, doctorSelfUsed: 0, sheriffPrevTarget: null };
      // по желанию: чтобы баннер победы не «мигал» в лобби
      setFinalWinner(null);
      // опционально: сброс бейджа событий
      setLastSeenEventId(null);
    }
  }, [phase]);

  // Fail-safe: если мы уже в Ночи и роль известна, а интро ещё не показали — покажем (устойчиво и без зацикливания)
  useEffect(() => {
    if (phase === "NIGHT" && me.role && !roleIntro.show) {
      // Больше не переоткрываем интро, если уже показывали/закрывали в эту ночь
      // и учитываем роль из roleIntro.role, если me.role ещё не успела обновиться
      if (!roleIntroSeenRef.current) {
        setRoleIntro({
          show: true,
          role: me.role || roleIntro.role,
          myId: me.roomPlayerId || roleIntro.myId,
        });
      }
    }
  }, [phase, me.role, me.roomPlayerId, roleIntro.show, roleIntro.role, roleIntro.myId]);

  // Как только интро показали — считаем его показанным, чтобы не открывать вновь
  useEffect(() => {
    if (roleIntro.show) roleIntroSeenRef.current = true;
  }, [roleIntro.show]);

  // На входе в Ночь — гасим возможные «дневные» уведомления и чистим ночной инбокс
  useEffect(() => {
    if (phase === "NIGHT") {
      nightInboxRef.current = [];
      setActionToasts([]);
    }
  }, [phase]);

  // Обновление заголовка страницы
  useEffect(() => {
    const phaseLabel = translatePhase(phase);
    const name = roomCode ? `MAFIA • ${phaseLabel} • ${roomCode}` : "MAFIA • Lobby";
    try { document.title = name; } catch {}
  }, [phase, roomCode]);

  useEffect(() => {
    const onErr = (e) => {
      console.error("UI error:", e?.error || e);
      setSheetTarget(null);
      try { toast("Ошибка интерфейса. Попробуйте ещё раз.", "error"); } catch {}
    };
    window.addEventListener("error", onErr);
    // + ловим необработанные промисы — в тост, а не в «тишину»
    const onRej = (ev) => {
      try { console.error("Unhandled promise rejection:", ev?.reason || ev); } catch {}
      try { toast(mapNetOrServerError(ev?.reason || ev), "error"); } catch {}
    };
    window.addEventListener("unhandledrejection", onRej);
    return () => {
      window.removeEventListener("error", onErr);
      window.removeEventListener("unhandledrejection", onRej);
    };
  }, [toast]);

  // ✅ Больше НЕ выходим из комнаты при сворачивании/переключении.

  // ============================== Render ==============================
  const isVotePhase = phase === "VOTE";
  const readyTarget = roomPlayers?.length || 0;
  const readyCount = (roomPlayers || []).reduce((acc, p) => {
    const isOwnerUser =
      ownerId != null && String(p?.user?.id) === String(ownerId);
    return acc + (p?.ready || isOwnerUser ? 1 : 0);
  }, 0);
  const allReady = readyTarget > 0 && readyCount >= readyTarget;
  const canStartLobby =
    isOwner && phase === "LOBBY" && readyTarget >= 4 && allReady;
  const startReason = (() => {
    if (phase !== "LOBBY" || canStartLobby) return "";
    if (readyTarget < 4) return "Нужно минимум 4 игрока";
    if (!isOwner) return "Только владелец может начать";
    if (!allReady) return "Не все готовы";
    return "Нельзя начать";
  })();
  const voteRowsPresent = useMemo(
    () => Object.keys(voteState?.tally || {}).length > 0,
    [voteState?.tally]
  );
  const showVoteBoard = isVotePhase && voteRowsPresent;
  useEffect(() => {
    if (!isVotePhase) setVoteOpen(false);
  }, [isVotePhase, phase]);
  const toggleVotePopup = useCallback(() => {
    if (!isVotePhase) return;
    setVoteOpen((v) => !v);
  }, [isVotePhase]);

  return (
    <UIErrorBoundary>
      <section className="mf-app" aria-label="Игра Мафия">
        {/* (1) Баннер сети только в режиме комнаты */}
        {view === "room" && (
          <NetBanner online={net.online} reconnecting={net.reconnecting} />
        )}

        {view === "menu" && (
          <MenuView busy={busy} onCreate={createRoom} onJoin={joinByCode} />
        )}

        {view === "room" && (
          <RoomShell
            phase={phase}
            winner={finalWinner || timer?.winner}
            code={roomCode}
            onCopy={copyCode}
          >
            {phase !== "LOBBY" && phase !== "ENDED" && (
              <div className="mf-timer-floating">
                {timer ? (
                  <TimerHUD timer={timer} className="mf-gs-timer-card" />
                ) : (
                  <div className="mf-timer mf-gs-timer-card skeleton" aria-hidden="true">
                    <span className="mf-timer-icon">⏳</span>
                    <span className="mf-timer-text">—</span>
                    <div className="mf-timer-bar">
                      <i />
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Player grid */}
            <div className="mf-stage">
              <PlayerGrid
                players={roomPlayers}
                phase={phase}
                myId={myId}
                myRole={myRole}
                ownerId={ownerId}
                isOwner={isOwner}
                showReady={phase === "LOBBY"}
                iAmReady={iAmReady}
                onToggleReady={!isOwner && phase === "LOBBY" ? toggleReady : undefined}
                onInvite={shareRoom}
                mafiaMarks={mafiaMarks}
                revealedRoles={revealedRoles}
                mafiaTeam={mafiaTeam}
              onTapPlayer={openSheetFor}
              onToggleEvents={toggleEvents}
              eventsOpen={eventsOpen}
              eventsCount={unreadCount}
                eventItems={events}
              canStart={canStartLobby}
              startReason={startReason}
              onStart={startMafia}
              voteState={voteState}
              leaders={voteState?.leaders || []}
              voteOpen={voteOpen}
              onToggleVote={toggleVotePopup}
              canShowVote={isVotePhase}
              hasUnread={hasUnread}
              avatarBase={API_BASE}
            />
          </div>

            {showVoteBoard && (
              <VotePopup
                open={voteOpen}
                onClose={toggleVotePopup}
                players={roomPlayers}
                voteState={voteState}
                hasRows={voteRowsPresent}
              />
            )}

            {/* Action sheet (не открываем шторку, если нет доступных действий) */}
            <ActionSheet
              open={!!sheetTarget && actionsForTarget.length > 0}
              player={sheetTarget}
              phase={phase}
              actions={actionsForTarget}
              onClose={closeSheet}
              avatarBase={API_BASE}
            />

            {/* Карточка роли в Ночь */}
            {roleIntro.show && (roleIntro.role || me.role) && (
              <>
                {/* Берём роль из roleIntro (latched), чтобы поздние null не сбивали карточку */}
                <RoleCard
                  role={roleIntro.role ?? me.role}
                  myId={roleIntro.myId ?? me.roomPlayerId}
                  onClose={() => {
                    roleIntroSeenRef.current = true;
                    setRoleIntro({
                      show: false,
                      role: roleIntro.role ?? me.role,
                      myId: roleIntro.myId,
                    });
                  }}
                />
              </>
            )}

            {phase === "ENDED" && (
              <>
                {/* Нижняя плашка результатов (доступно всем) */}
                <EndedBar
                  onReturn={returnToLobby}
                  onLeave={askLeave}
                  label={finalWinner || timer?.winner}
                />
              </>
            )}
          </RoomShell>
        )}

        {/* Дневные уведомления за ночные события с кнопкой «ОК» (показываем только днём) */}
        {phase === "DAY" && <ActionToastStack items={actionToasts} />}

        <ToastStack items={toasts} />

        <ConfirmLeave open={confirmLeaveOpen} onCancel={cancelLeave} onConfirm={confirmLeave} />
      </section>
    </UIErrorBoundary>
  );
}

// =================================== UI helpers ===================================

function btn(key, label, tone, onClick, disabled = false) {
  return { key, label, tone, onClick, disabled };
}

/** Унификация пользователя (snake_case -> camelCase) */
function normalizeUser(u = {}) {
  return {
    id: u.id,
    tgId: u.tgId ?? u.tg_id ?? null,
    firstName: u.firstName ?? u.first_name ?? null,
    username: u.username ?? null,
    photoUrl: u.photoUrl ?? u.photo_url ?? null,
  };
}

/** Нормализация игроков */
function normalizePlayers(list = []) {
  return list.map((p) => ({
    ...p,
    user: normalizeUser(p.user || {}),
    ready: !!p.ready,
  }));
}

/** @param {RoomPlayer} p */
function nickOf(p) {
  const u = p?.user || {};
  const name = u.firstName ?? u.first_name;
  return name || (u.username ? `@${u.username}` : `Игрок #${p?.id ?? u.id ?? "?"}`);
}

function translatePhase(p) {
  switch (p) {
    case "LOBBY": return "Лобби";
    case "NIGHT": return "Ночь";
    case "DAY":   return "День";
    case "VOTE":  return "Голос";
    case "ENDED": return "Завершена";
    default: return p || "";
  }
}

function mapServerError(code, retryMs) {
  switch (String(code || "")) {
    case "initData_required": return "Нужны WebApp-данные. Открой игру из Telegram ещё раз.";
    case "bad_signature": return "Проверка подписи не прошла. Открой игру из Telegram ещё раз.";
    case "code_already_in_use": return "Такой код уже занят. Попробуй снова.";
    case "code_generation_failed": return "Не удалось сгенерировать код. Повтори попытку.";
    case "room_not_found": return "Комната не найдена или была удалена.";
    case "room_full": return "Комната заполнена.";
    case "already_started": return "Игра уже запущена.";
    case "need_at_least_4_players": return "Нужно минимум 4 игрока, чтобы начать.";
    case "forbidden_not_owner": return "Только владелец комнаты может начать игру.";
    case "game_in_progress": return "Игра уже идёт. Войти можно только тем, кто был в комнате раньше.";
    case "stale_init_data": return "Сессия Telegram устарела. Открой игру из Telegram ещё раз.";
    case "too_fast": return "Слишком часто. Подожди секунду и попробуй снова.";
    case "retarget_too_fast": {
      const sec = retryMs ? Math.ceil(Number(retryMs) / 1000) : 2;
      return `Смена цели заблокирована. Подожди ${sec} c.`;
    }
    case "wait_for_don": {
      const sec = retryMs ? Math.ceil(Number(retryMs) / 1000) : 20;
      return `Дон выбирает первым. Подожди ${sec} c.`;
    }
    default: return typeof code === "string" && code ? code : "Произошла ошибка. Попробуй позже.";
  }
}
function mapNetOrServerError(e) {
  const msg = String(e?.message || e || "");
  if (msg === "api_base_empty") return "Не задан API URL на фронте. Проверь конфиг.";
  if (msg === "network_timeout") return "Таймаут запроса. Проверь сеть/доступность домена.";
  if (msg === "network_failed_to_fetch") return "Браузер заблокировал запрос (CORS/SSL/ДНС). Проверь HTTPS и CORS.";
  if (msg.startsWith("http_")) {
    if (/403/i.test(msg) && /cors/i.test(msg)) return "Запрос отклонён CORS. Проверь белый список Origins.";
    return "Сервер: " + msg.replace(/^http_/, "");
  }
  return mapServerError(msg);
}

function isHttpsPage() {
  if (typeof window === "undefined") return false;
  return window.location.protocol === "https:";
}
function isHttpUrl(u) {
  try { return new URL(u).protocol === "http:"; } catch { return false; }
}
function isLocalhost(u) {
  try { const h = new URL(u).hostname; return h === "localhost" || h === "127.0.0.1"; } catch { return false; }
}
function normalizeApiBase(input) {
  try {
    let s = String(input || "").trim();
    if (!s) return "";
    if (!/^https?:\/\//i.test(s)) {
      const base = (typeof window !== "undefined" ? window.location.origin : "").replace(/\/$/, "");
      s = s.startsWith("/") ? `${base}${s}` : `${base}/${s}`;
    }
    if (s.endsWith("/")) s = s.slice(0, -1);
    return s;
  } catch {
    return String(input || "");
  }
}

function toMs(v){ return typeof v === "number" ? v : (v ? new Date(v).getTime() : 0); }

// ===================== FIX 1: helper isMafia (MAFIA || DON) =====================
function isMafia(role) {
  return role === "MAFIA" || role === "DON";
}
