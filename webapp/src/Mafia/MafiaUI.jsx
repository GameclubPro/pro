// MafiaUI.jsx — Horror-light UI (презентационные компоненты, без бизнес-логики)
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import RoomMenu from "../shared/RoomMenu.jsx";
import { HUD, Chip, TimerHUD, GameStage, FinalBanner } from "../shared/RoomHud.jsx";

export { HUD, Chip, TimerHUD, GameStage, FinalBanner };
import bgLobby from "../assets/mafia/bg-lobby.png";
import bgNight from "../assets/mafia/bg-night.png";
import bgDay from "../assets/mafia/bg-day.png";
import bgVote from "../assets/mafia/bg-vote.png";

// === NEW: изображения для аватарок ===
import avaUnknown from "../assets/mafia/unknown.png";
import roleCardBack from "../assets/mafia/card-back.png"; // ваша спец. «рубашка» для RoleCard

// Ролевые аватарки
import roleMafia from "../assets/mafia/mafia.png";
import roleDon from "../assets/mafia/don.png";
import roleDoctor from "../assets/mafia/doctor.png";
import roleSheriff from "../assets/mafia/sheriff.png";
import roleBodyguard from "../assets/mafia/bodyguard.png";
import roleProstitute from "../assets/mafia/prostitute.png";
import roleJournalist from "../assets/mafia/journalist.png";
import roleSniper from "../assets/mafia/sniper.png";
import rolePeaceful from "../assets/mafia/peaceful.png";

/* =============================================================================
   === Централизованные утилиты правил UI (без бизнес-логики) ==================
   Эти утилиты должны совпадать с контейнером. При изменении правил — желательно
   вынести в общий модуль и переиспользовать и тут, и в контейнере.
   ========================================================================== */

// Маппинг «роль → файл аватарки»
const ROLE_AVATAR = {
  MAFIA: roleMafia,
  DON: roleDon,
  DOCTOR: roleDoctor,
  SHERIFF: roleSheriff,
  BODYGUARD: roleBodyguard,
  PROSTITUTE: roleProstitute,
  JOURNALIST: roleJournalist,
  SNIPER: roleSniper,
  CIVIL: rolePeaceful,
};

function roleAvatarOf(role) {
  return ROLE_AVATAR?.[role] || null;
}

// ✅ DON считается мафией и в UI
function isMafia(r) {
  return r === "MAFIA" || r === "DON";
}

// ✅ Локальная гарантия: метки мафии показываются ТОЛЬКО ночью и ТОЛЬКО мафии
function shouldShowMafiaMarks(phase, myRole) {
  return String(phase).toUpperCase() === "NIGHT" && isMafia(myRole);
}

// ✅ Централизованное вычисление рассчёта «метки мафии» для цели
// Возвращает {count, mine} | null
function calcMafiaMarkForTarget({ phase, myRole, mafiaMarks, targetId }) {
  if (!shouldShowMafiaMarks(phase, myRole)) return null;
  const list = mafiaMarks?.byTarget?.[targetId] || [];
  const mine = mafiaMarks?.myTargetId === targetId;
  if (list.length) return { count: list.length, mine: !!mine };
  return mine ? { count: 1, mine: true } : null;
}

// ✅ Централизованное вычисление «какую роль показывать на плитке игрока»
// Если внешний проп revealRole проброшен — он имеет приоритет (совместимость),
// иначе считаем локально по единым правилам.
function resolveRevealRoleForTile({
  player,
  phase,
  revealedRoles,
  mafiaTeam,
  myId,
  myRole,
  fallbackToSelf = true, // в ENDED можно подсветить свою роль
  externalRevealRole, // совместимость с существующим API
}) {
  if (externalRevealRole) return externalRevealRole;

  const p = player;
  if (!p) return null;

  const isEnded = String(phase).toUpperCase() === "ENDED";
  const isLobby = String(phase).toUpperCase() === "LOBBY";

  if (isEnded) {
    return (
      revealedRoles?.[p.id] ||
      mafiaTeam?.[p.id] ||
      (fallbackToSelf && p.id === myId ? myRole : null)
    );
  }

  // В процессе игры:
  if (!p.alive) {
    return revealedRoles?.[p.id] || null;
  }
  if (!isLobby && isMafia(myRole)) {
    // «свой» для мафии — показываем MAFIA / DON, если есть
    return mafiaTeam?.[p.id] || null;
  }
  return null;
}

/* =============================================================================
   === PHASE BACKDROP ==========================================================
   Двухслойный бэкграунд под фазу (A/B) с кросс-фейдом.
   ========================================================================== */

const DEFAULT_PHASE_BACKGROUNDS = {
  LOBBY: bgLobby,
  NIGHT: bgNight,
  DAY: bgDay,
  VOTE: bgVote,
  // ENDED отдельным файлом нет — аккуратно падаем на дневной фон
  ENDED: bgDay,
};

function resolvePhase(phase) {
  const p = String(phase || "LOBBY").toUpperCase();
  return p === "NIGHT" ||
    p === "DAY" ||
    p === "VOTE" ||
    p === "LOBBY" ||
    p === "ENDED"
    ? p
    : "LOBBY";
}

/** winner-aware фон для финала — ночь для мафии, день для города (мемоизировано) */
function PhaseBackdrop({ phase, phaseBackgrounds, winner }) {
  const curPhase = resolvePhase(phase);

  // Базовые карты + переопределения пользователя (мемоизировано)
  const maps = useMemo(() => {
    const base = { ...DEFAULT_PHASE_BACKGROUNDS, ...(phaseBackgrounds || {}) };
    if (resolvePhase(phase) === "ENDED" && winner) {
      const w = String(winner || "").toUpperCase();
      const mafiaWon = /МАФИЯ|MAFIA/.test(w);
      return { ...base, ENDED: mafiaWon ? bgNight : bgDay };
    }
    return base;
  }, [phaseBackgrounds, phase, winner]);

  const urlFor = useCallback(
    (ph) => {
      const u = maps[resolvePhase(ph)];
      return typeof u === "string" ? u : "";
    },
    [maps]
  );

  // два слоя: передний/задний — переключаем их с пре-загрузкой
  const [frontUrl, setFrontUrl] = useState(() => urlFor(curPhase));
  const [backUrl, setBackUrl] = useState(() => urlFor(curPhase));
  const [showFront, setShowFront] = useState(true);

  useEffect(() => {
    const nextUrl = urlFor(curPhase);
    const visible = showFront ? frontUrl : backUrl;
    if (!nextUrl || nextUrl === visible) return;

    let canceled = false;

    const img = new Image();
    img.decoding = "async";
    img.referrerPolicy = "no-referrer";
    img.src = nextUrl;

    const swap = () => {
      if (canceled) return;
      if (showFront) {
        setBackUrl(nextUrl);
      } else {
        setFrontUrl(nextUrl);
      }
      requestAnimationFrame(() => {
        if (!canceled) setShowFront((v) => !v);
      });
    };

    if (img.complete) {
      swap();
    } else {
      img.onload = swap;
      img.onerror = swap; // даже если не загрузилось — лучше не зависать
    }

    return () => {
      canceled = true;
      img.onload = null;
      img.onerror = null;
    };
  }, [curPhase, urlFor, showFront, frontUrl, backUrl]);

  return (
    <>
      <div
        className={`mf-tex mf-tex-phasebg ${showFront ? "is-active" : ""}`}
        aria-hidden="true"
        style={{
          backgroundImage: frontUrl ? `url("${frontUrl}")` : "none",
        }}
      />
      <div
        className={`mf-tex mf-tex-phasebg ${!showFront ? "is-active" : ""}`}
        aria-hidden="true"
        style={{
          backgroundImage: backUrl ? `url("${backUrl}")` : "none",
        }}
      />
    </>
  );
}

/* =============================================================================
   === SCENE / SHELL ===========================================================
   Обновляет body-класс под фазу и держит корректный --mf-vh.
   ========================================================================== */

export function RoomShell({ children, phase, phaseBackgrounds, winner }) {
  const shellRef = useRef(null);
  const rafRef = useRef(0); // rAF-троттлинг для spot-света

  // Динамический 1% вьюпорта под мобильные браузеры (fallback к 1dvh в CSS)
  useEffect(() => {
    const setVh = () => {
      const vh =
        (window.visualViewport?.height ?? window.innerHeight) * 0.01;
      document.documentElement.style.setProperty("--mf-vh", `${vh}px`);
    };
    setVh();
    window.addEventListener("resize", setVh, { passive: true });
    window.addEventListener("orientationchange", setVh, { passive: true });
    window.visualViewport?.addEventListener("resize", setVh, { passive: true });
    return () => {
      window.removeEventListener("resize", setVh);
      window.removeEventListener("orientationchange", setVh);
      window.visualViewport?.removeEventListener("resize", setVh);
    };
  }, []);

  // Эвристика low-end (опционально): класс на body
  // считаем low-end только:
  // - явные 1–2 ядра
  // - или когда deviceMemory есть и <= 2 ГБ
  useEffect(() => {
    const cores = Number(navigator?.hardwareConcurrency || 0);
    const mem = Number(navigator?.deviceMemory || 0);

    const isLow =
      (cores && cores <= 2) ||
      (mem && mem > 0 && mem <= 2);

    document.body.classList.toggle("mf-lowend", !!isLow);
  }, []);

  // Класс фазы на body (для акцентов фона); опционально
  useEffect(() => {
    if (!phase) return;
    const cls = `mf-phase-${String(phase).toLowerCase()}`;
    document.body.classList.add(cls);
    return () => document.body.classList.remove(cls);
  }, [phase]);

  // Поддержка prefers-reduced-motion (CSS может таргетить .mf-reduced-motion)
  useEffect(() => {
    const mq = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!mq) return;
    const apply = () => {
      document.body.classList.toggle("mf-reduced-motion", !!mq.matches);
    };
    apply();
    mq.addEventListener?.("change", apply);
    return () => mq.removeEventListener?.("change", apply);
  }, []);

  // Лёгкий интерактив спот-лайта: rAF-троттлинг + уважение reduced-motion
  const handlePointerMove = useCallback((e) => {
    const el = shellRef.current;
    if (!el) return;
    // уважение к reduced-motion: отключаем дорогой интерактив
    if (document.body.classList.contains("mf-reduced-motion")) return;
    const r = el.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    const y = Math.max(0, Math.min(1, (e.clientY - r.top) / r.height));
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      el.style.setProperty("--mx", String(x));
      el.style.setProperty("--my", String(y));
    });
  }, []);

  useEffect(
    () => () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    },
    []
  );

  return (
    <div
      className="mf-room-shell"
      ref={shellRef}
      onPointerMove={handlePointerMove}
      onPointerDown={handlePointerMove}
    >
      {/* фазовые фоны (картинки) */}
      <PhaseBackdrop
        phase={phase}
        phaseBackgrounds={phaseBackgrounds}
        winner={winner}
      />

      {/* декоративные FX поверх фото */}
      <SceneFX />

      <div className="mf-room">{children}</div>
    </div>
  );
}

/** Декоративные фоновые слои поверх фотобэкграунда */
function SceneFX() {
  return (
    <>
      {/* Объёмные «стальные решётки» для лобби */}
      <div className="mf-tex mf-tex-grate" aria-hidden="true" />

      {/* Фазовые FX: день/ночь/голос */}
      <div className="mf-tex mf-tex-dayfx" aria-hidden="true" />
      <div className="mf-tex mf-tex-nightfx" aria-hidden="true" />
      <div className="mf-tex mf-tex-votefx" aria-hidden="true" />

      {/* Базовые слои сцены (виньетка выключена в CSS) */}
      <div className="mf-tex mf-tex-vignette" aria-hidden="true" />
      <div className="mf-tex mf-tex-noise" aria-hidden="true" />
      <div className="mf-tex mf-tex-spot" aria-hidden="true" />
    </>
  );
}

/* =============================================================================
   === HUD (shared in ../shared/RoomHud.jsx) ===================================
   ========================================================================== */

/* HUD, Chip, TimerHUD, GameStage, FinalBanner are imported from ../shared/RoomHud.jsx */

/* =============================================================================
   === GRID / PLAYERS ==========================================================/* =============================================================================
   === GRID / PLAYERS ==========================================================
   ========================================================================== */
export const PlayerGrid = memo(function PlayerGrid({
  players,
  myId,
  myRole,
  ownerId,
  isOwner,
  phase,
  // readiness indicator (только для лобби)
  showReady = false,
  // — NEW: готовность и переключатель для текущего игрока
  iAmReady,
  onToggleReady,
  // 👇 карта «меток мафии» (прокидывается из контейнера)
  mafiaMarks,
  // 👇 публичные раскрытия ролей и «кто свой» для мафии
  revealedRoles,
  mafiaTeam,
  onTapPlayer,
  onToggleEvents,
  eventsOpen,
  eventsCount,
  eventItems,
  canStart,
  onStart,
  voteState,
  hasUnread,
  avatarBase,
}) {
  if (!players?.length) {
    return (
      <div className="mf-empty">
        Пока пусто. Поделись кодом комнаты с друзьями.
      </div>
    );
  }
  const left = [];
  const right = [];
  const centerTop = []; // позиции 11/12 — между 3 и 5
  const centerBottom = []; // позиции 9/10 — между 7 и 8

  players.forEach((p, idx) => {
    const pos = idx + 1;
    if (pos === 9 || pos === 10) {
      centerBottom.push(p);
    } else if (pos === 11 || pos === 12) {
      centerTop.push(p);
    } else if (pos % 2 === 1) {
      left.push(p);
    } else {
      right.push(p);
    }
  });

  const startReason = (() => {
    if (phase !== "LOBBY" || canStart) return "";
    if ((players?.length || 0) < 4) return "Нужно минимум 4 игрока";
    return "Только владелец может начать";
  })();

  const mafiaMarksEnabled = shouldShowMafiaMarks(phase, myRole);

  const markFor = useCallback(
    (pId) =>
      calcMafiaMarkForTarget({
        phase,
        myRole,
        mafiaMarks,
        targetId: pId,
      }),
    [phase, myRole, mafiaMarks]
  );

  const revealFor = useCallback(
    (p) =>
      resolveRevealRoleForTile({
        player: p,
        phase,
        revealedRoles,
        mafiaTeam,
        myId,
        myRole,
      }),
    [phase, revealedRoles, mafiaTeam, myId, myRole]
  );

  const renderPlayer = (p) =>
    p ? (
      <PlayerCard
        key={p.id}
        p={p}
        myId={myId}
        myRole={myRole}
        ownerId={ownerId}
        phase={phase}
        voteState={voteState}
        mafiaMark={mafiaMarksEnabled ? markFor(p.id) : null}
        onTap={onTapPlayer}
        avatarBase={avatarBase}
        revealRole={revealFor(p)}
        showReady={!!showReady}
      />
    ) : null;

  const renderRow = (left, center, right, key) => {
    if (!left && !right && !center) return null;
    const leftNode = renderPlayer(left) || <div className="mf-slot empty" aria-hidden="true" />;
    const rightNode = renderPlayer(right) || <div className="mf-slot empty" aria-hidden="true" />;
    const centerNode = center || <div className="mf-slot empty" aria-hidden="true" />;
    return (
      <div className="mf-row" key={key}>
        <div className="mf-slot left">{leftNode}</div>
        <div className="mf-slot center">{centerNode}</div>
        <div className="mf-slot right">{rightNode}</div>
      </div>
    );
  };

  const renderInline = (list) => {
    const nodes = list.filter(Boolean);
    if (!nodes.length) return null;
    return <div className="mf-inline-pair">{nodes.map(renderPlayer)}</div>;
  };

  return (
    <>
      <section className="mf-grid" aria-label="Игроки">
        {renderRow(
          players[0],
          <div className={`mf-center-cta ${phase === "LOBBY" ? "lobby-pinned" : ""}`}>
            {phase === "LOBBY" ? (
              (() => {
                const me = players.find((x) => x.id === myId);
                const myUserId = me?.user?.id ?? null;
                const iAmOwner =
                  isOwner ||
                  (ownerId != null &&
                    myUserId != null &&
                    String(ownerId) === String(myUserId));
                if (iAmOwner) {
                  return (
                    <>
                      <button
                        className={`mf-events-toggle mf-start-toggle ${canStart ? "" : "disabled"}`}
                        disabled={!canStart}
                        onClick={onStart}
                        type="button"
                        aria-label="Начать игру"
                        title={startReason || undefined}
                      >
                        Начать игру
                      </button>
                      <div className="mf-hint center">min4</div>
                    </>
                  );
                }
                return (
                  <button
                    className={`mf-events-toggle mf-ready-toggle ${iAmReady ? "ok" : ""}`}
                    onClick={onToggleReady}
                    type="button"
                    aria-pressed={!!iAmReady}
                    aria-label={
                      iAmReady ? "Отметиться «не готов»" : "Отметиться «готов»"
                    }
                    title={
                      iAmReady ? "Вы отмечены как «готов»" : "Нажмите, чтобы отметиться «готов»"
                    }
                  >
                    {iAmReady ? "Я готов" : "Готов"}
                  </button>
                );
              })()
            ) : (
              <button
                className={`mf-events-toggle mf-appear-after-start ${
                  eventsOpen ? "open" : ""
                } ${hasUnread ? "has-unread" : ""}`}
                onClick={onToggleEvents}
                aria-expanded={!!eventsOpen}
                aria-haspopup="dialog"
                type="button"
                aria-label="Открыть события"
                title="Открыть события"
              >
                ✨ События {eventsCount ? `(${eventsCount})` : ""}
              </button>
            )}
          </div>,
          players[1],
          "row-top"
        )}

        {renderRow(players[2], null, players[3], "row-2")}

        {renderRow(
          players[4],
          renderInline([players[10], players[11]]),
          players[5],
          "row-3"
        )}

        {renderRow(
          players[6],
          renderInline([players[8], players[9]]),
          players[7],
          "row-4"
        )}
      </section>

      {phase !== "LOBBY" && (
        <EventsModal
          open={!!eventsOpen}
          onClose={onToggleEvents}
          players={players}
          items={eventItems || []}
        />
      )}
    </>
  );
});

/** Игрок — минимальная плитка */
export const PlayerCard = memo(
  function PlayerCard({
    p,
    myId,
    myRole,
    ownerId,
    phase,
    voteState,
    // 👇 агрегат по текущей цели (может прийти из контейнера)
    mafiaMark,
    onTap,
    avatarBase,
    // 👇 раскрытая роль для отображения на плитке (может прийти из контейнера)
    revealRole,
    // 👇 индикатор готовности в лобби
    showReady = false,
  }) {
    const isMe = myId === p.id;
    const displayName =
      p?.user?.firstName ||
      (p?.user?.username ? `@${p.user.username}` : `Игрок #${p?.user?.id}`);
    const letter = (
      p?.user?.firstName ||
      p?.user?.username ||
      "?"
    )
      .slice(0, 1)
      .toUpperCase();

    // Оригинальные кандидаты (телеграм-аватар и пр.) — нужны для шита и для лобби
    const candidates = useMemo(
      () => avatarCandidates(p?.user, avatarBase),
      [p?.user, avatarBase]
    );
    const [imgIndex, setImgIndex] = useState(0);
    const src = candidates[imgIndex] || "";
    useEffect(() => {
      setImgIndex(0);
    }, [candidates?.[0]]);

    // === Маска для сетки после старта игры ===
    const maskedPhase = phase !== "LOBBY";
    const myRoleAvatar = roleAvatarOf(myRole) || roleAvatarOf("CIVIL");
    const isEnded = String(phase).toUpperCase() === "ENDED";

    // Централизованно вычисляем финальную роль для отображения (с учётом внешнего пропа)
    const computedRevealRole = useMemo(
      () =>
        resolveRevealRoleForTile({
          player: p,
          phase,
          revealedRoles: undefined, // не передаём — на этой глубине доверяем пропу сверху
          mafiaTeam: undefined,
          myId,
          myRole,
          externalRevealRole: revealRole,
        }),
      [p, phase, myId, myRole, revealRole]
    );

    const roleAvatar = roleAvatarOf(computedRevealRole) || null;

    // === ENDED fix:
    // В ENDED, если revealRole отсутствует (например, из-за потери события),
    // НЕ показываем старое фото. Для «я» — иконка моей роли; для остальных — нейтральная CIVIL.
    const displaySrc = maskedPhase
      ? roleAvatar ||
        (isEnded
          ? isMe
            ? myRoleAvatar || avaUnknown
            : roleAvatarOf("CIVIL") || avaUnknown
          : isMe
          ? myRoleAvatar || src
          : avaUnknown)
      : src;

    // 👇 лёгкий «переворот» в момент первого раскрытия
    const [flipped, setFlipped] = useState(false);
    const wasRevealedRef = useRef(!!computedRevealRole);
    useEffect(() => {
      if (!wasRevealedRef.current && computedRevealRole) {
        setFlipped(true);
        const t = setTimeout(() => setFlipped(false), 700);
        wasRevealedRef.current = true;
        return () => clearTimeout(t);
      }
    }, [computedRevealRole]);

    // ✅ глобальный флип у всех при завершении игры
    useEffect(() => {
      if (isEnded) {
        setFlipped(true);
        const t = setTimeout(() => setFlipped(false), 700);
        return () => clearTimeout(t);
      }
    }, [isEnded]);

    // === Голосование: доступность/подсветка
    const isVoting = String(phase).toUpperCase() === "VOTE";
    const isMyVoteTarget =
      isVoting && Number(voteState?.myTargetId) === Number(p.id);

    // Раунд 2: голосовать можно только среди лидеров. Сделаем это явно видно.
    const isRound2 = isVoting && (voteState?.round || 1) === 2;
    const leadersArr = Array.isArray(voteState?.leaders)
      ? voteState.leaders
      : [];
    // нормализуем идентификаторы к числам, чтобы не промахнуться по типам
    const leaderIds = new Set(leadersArr.map((id) => Number(id)));
    const voteLocked =
      isRound2 && leaderIds.size > 0 && !leaderIds.has(Number(p.id));

    const isActionDisabled = (phase !== "LOBBY" && !p.alive) || voteLocked;

    const handleTap = useCallback(() => {
      if (isActionDisabled) return; // доступность: действие гасим логикой, а не disabled
      onTap?.(p);
    }, [onTap, p, isActionDisabled]);

    const isOwnerUser =
      ownerId != null ? String(p?.user?.id) === String(ownerId) : !!p?.isOwner;

    const totalAlive = voteState?.alive || 0;
    const votesFor = Number(voteState?.tally?.[p.id] || 0);
    const progress = totalAlive ? Math.min(1, votesFor / totalAlive) : 0;

    const mafiaMarksEnabled = shouldShowMafiaMarks(phase, myRole);

    // Классы для статуса точки: в лобби показываем «готов/не готов»
    const readyEffective =
      phase === "LOBBY" && showReady
        ? p.ready ||
          (ownerId != null && String(p?.user?.id) === String(ownerId))
        : false;
    const dotClass =
      phase === "LOBBY" && showReady
        ? `mf-dot ok ${readyEffective ? "ready" : "not-ready"}`
        : null;

    return (
      <button
        className={`mf-player ${isMe ? "me" : ""} ${
          p.alive ? "alive" : "dead"
        } ${phase !== "LOBBY" && !p.alive ? "ghosted" : ""} ${
          isOwnerUser ? "owner" : ""
        } ${computedRevealRole ? "revealed" : ""} ${
          flipped ? "flip" : ""
        } ${voteLocked ? "vote-locked" : ""}`}
        onClick={handleTap}
        aria-label={`Игрок ${displayName}${!p.alive ? " — выбыл" : ""}`}
        title={voteLocked ? "Недоступен в переголосовании" : displayName}
        aria-disabled={isActionDisabled || undefined}
        aria-pressed={isVoting ? !!isMyVoteTarget : undefined}
        type="button"
        data-pid={p.id} // +++ адресуемая цель: pid на корневой кнопке
      >
        <div
          className="mf-avatar-wrap mf-ava-bronze"
          data-pid={p.id} // +++ pid на обёртке
          // ✨ Передаём прогресс голосов внутрь рамки (неон-заливка)
          style={{ ["--voteRatio"]: String(progress) }}
          data-voted={votesFor > 0 ? "true" : undefined}
        >
          {/* 🎯 Метка мафии (видна только мафии и только ночью) — локальная защита */}
          {mafiaMarksEnabled && mafiaMark && p.alive && (
            <span
              className={`mf-mafia-mark ${mafiaMark.mine ? "mine" : ""}`}
              aria-hidden="true"
              title={mafiaMark.mine ? "Ваша цель" : "Цель мафии"}
            >
              {mafiaMark.mine ? "🎯" : "🔪"}
              {mafiaMark.count > 1 && (
                <b className="cnt">{mafiaMark.count}</b>
              )}
            </span>
          )}

          {/* Убрали старое кольцо прогресса — теперь рамка сама «заполняется» неоном */}

          {isOwnerUser && (
            <>
              <span className="mf-owner-crown" aria-hidden="true">
                👑
              </span>
              <span className="sr-only">Владелец комнаты</span>
            </>
          )}

          {displaySrc ? (
            <img
              className="mf-avatar"
              src={displaySrc}
              alt=""
              loading="lazy"
              decoding="async"
              referrerPolicy="no-referrer"
              // Фолбэки листаем только для оригинального src (в лобби).
              onError={
                displaySrc === src
                  ? () =>
                      setImgIndex((i) =>
                        Math.min(i + 1, Math.max(0, candidates.length - 1))
                      )
                  : undefined
              }
            />
          ) : (
            <div className="mf-avatar placeholder" aria-hidden="true">
              {letter}
            </div>
          )}

          {!p.alive && (
            <span className="mf-dead-onava" aria-hidden="true">
              ВЫБЫЛ
            </span>
          )}

          {dotClass && <span className={dotClass} aria-hidden="true" />}

          {/* Бейдж роли: показываем всем в ENDED; в процессе — по старым правилам */}
          {(() => {
            const badgeRole = isEnded
              ? computedRevealRole || (isMe ? myRole : null)
              : p.alive
              ? isMe && phase !== "LOBBY" && myRole
              : computedRevealRole || (isMe ? myRole : null);
            return badgeRole ? (
              <span
                className={`mf-role-badge role-${badgeRole}`}
                aria-hidden="true"
              >
                {translateRole(badgeRole)}
              </span>
            ) : null;
          })()}
        </div>

        <div className="mf-nick" dir="auto">
          {displayName}
        </div>
        <span className="sr-only">{!p.alive ? "Игрок выбыл" : ""}</span>
      </button>
    );
  },
  (prev, next) => {
    return (
      prev.p.id === next.p.id &&
      prev.p.alive === next.p.alive &&
      prev.p.user?.firstName === next.p.user?.firstName &&
      prev.p.user?.username === next.p.user?.username &&
      prev.myId === next.myId &&
      prev.myRole === next.myRole &&
      prev.ownerId === next.ownerId &&
      prev.phase === next.phase &&
      prev.voteState?.alive === next.voteState?.alive &&
      prev.voteState?.tally?.[prev.p.id] ===
        next.voteState?.tally?.[next.p.id] &&
      (prev.mafiaMark?.count || 0) === (next.mafiaMark?.count || 0) &&
      !!prev.mafiaMark?.mine === !!next.mafiaMark?.mine &&
      prev.avatarBase === next.avatarBase &&
      prev.revealRole === next.revealRole &&
      prev.showReady === next.showReady &&
      !!prev.p.ready === !!next.p.ready
    );
  }
);

/* =============================================================================
   === A11y helpers (фокус-ловушка для модалок, возврат фокуса, ESC, scroll lock)
   ========================================================================== */

// --- focusables: безопасный селектор + фолбэк-фильтрация --------------------
const FOCUSABLE_SELECTOR =
  'a[href],area[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),button:not([disabled]),[tabindex]:not([tabindex="-1"]),[contenteditable="true"]';

// Универсальный выбор фокусируемых в контейнере, с фолбэком для старых движков
function getFocusableWithin(node) {
  if (!node || !node.querySelectorAll) return [];
  let list;
  try {
    list = node.querySelectorAll(FOCUSABLE_SELECTOR);
  } catch {
    // super-safe фолбэк без :not и без сравнения значений
    try {
      list = node.querySelectorAll(
        'a[href],area[href],input,select,textarea,button,[tabindex],[contenteditable="true"]'
      );
    } catch {
      list = node.querySelectorAll(
        "a,area,input,select,textarea,button,[tabindex],[contenteditable=\"true\"]"
      );
    }
  }
  return Array.from(list).filter((el) => {
    // финальная фильтрация «по состоянию»
    const cs = window.getComputedStyle(el);
    if (!cs || cs.display === "none" || cs.visibility === "hidden")
      return false;
    if (
      el.hasAttribute("disabled") ||
      el.getAttribute("aria-disabled") === "true"
    )
      return false;
    const ti = el.getAttribute("tabindex");
    if (ti === "-1") return false;
    if (
      (el.tagName === "A" || el.tagName === "AREA") &&
      !el.getAttribute("href")
    )
      return false;
    return true;
  });
}

function useModalA11y(open, containerRef, onClose) {
  useEffect(() => {
    if (!open) return;

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const prevFocused = document.activeElement;
    const node = containerRef?.current || null;

    // Начальное фокусирование
    if (node) {
      const focusables = getFocusableWithin(node);
      const target = (focusables && focusables[0]) || node;
      target?.focus?.();
    }

    const onKeyDown = (e) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose?.();
        return;
      }
      if (e.key === "Tab") {
        if (!node) return;
        const list = getFocusableWithin(node);
        if (!list || !list.length) {
          e.preventDefault();
          return;
        }
        const first = list[0];
        const last = list[list.length - 1];
        const active = document.activeElement;
        if (e.shiftKey) {
          if (active === first) {
            e.preventDefault();
            last.focus();
          }
        } else {
          if (active === last) {
            e.preventDefault();
            first.focus();
          }
        }
      }
    };

    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.body.style.overflow = prevOverflow;
      document.removeEventListener("keydown", onKeyDown);
      prevFocused?.focus?.();
    };
  }, [open, containerRef, onClose]);
}

/* =============================================================================
   === SHERIFF DOSSIER (стилизованное досье) ===================================
   Презентационный оверлей. Контейнер сам решает, когда показывать.
   ========================================================================== */
export function SheriffDossier({
  open,
  onClose,
  targetName = "Игрок",
  avatarSrc = "",
  verdict = "CIVIL", // "MAFIA" | "CIVIL"
}) {
  const cardRef = useRef(null);
  useModalA11y(!!open, cardRef, onClose);
  if (!open) return null;

  const isMafiaVerdict = /MAFIA|МАФИЯ/i.test(String(verdict));
  const stampText = isMafiaVerdict ? "МАФИЯ" : "МИРНЫЙ";
  const stop = (e) => e.stopPropagation();

  return (
    <div
      className="mf-dossier-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="mf-dossier-title"
      onClick={onClose}
    >
      <article
        className="mf-dossier-card"
        onClick={stop}
        ref={cardRef}
        tabIndex={-1}
      >
        <header className="mf-dossier-head">
          <div className="mf-dossier-kicker">ШЕРИФ — проверка</div>
          <button
            className="mf-iconbtn"
            onClick={onClose}
            aria-label="Закрыть"
            type="button"
          >
            ✕
          </button>
        </header>
        <div className="mf-dossier-body">
          <div className="mf-dossier-ava">
            {avatarSrc ? (
              <img
                src={avatarSrc}
                alt=""
                decoding="async"
                loading="eager"
                referrerPolicy="no-referrer"
              />
            ) : (
              <div className="ph">?</div>
            )}
          </div>
          <div className="mf-dossier-info">
            <h2 className="mf-dossier-title" id="mf-dossier-title">
              {targetName}
            </h2>
            <div
              className={`mf-dossier-stamp ${
                isMafiaVerdict ? "bad" : "good"
              }`}
              aria-live="polite"
            >
              {stampText}
            </div>
          </div>
        </div>
        <footer className="mf-dossier-foot">
          <button className="mf-btn primary" onClick={onClose} type="button">
            ОК
          </button>
        </footer>
      </article>
    </div>
  );
}

/* =============================================================================
   === ACTION SHEET ============================================================ 
   ========================================================================== */
export function ActionSheet({
  open,
  player,
  phase,
  actions = [],
  onClose,
  avatarBase,
}) {
  const cardRef = useRef(null);
  useModalA11y(open, cardRef, onClose);

  const displayName =
    player?.user?.firstName ||
    (player?.user?.username
      ? `@${player.user.username}`
      : player?.user?.id
      ? `Игрок #${player.user.id}`
      : "Игрок");

  const letter = (
    player?.user?.firstName ||
    player?.user?.username ||
    "?"
  )
    .slice(0, 1)
    .toUpperCase();

  const headerNote =
    phase === "NIGHT"
      ? "Ночь: выбери действие"
      : phase === "VOTE"
      ? "Голосование"
      : phase === "DAY"
      ? "День"
      : phase === "LOBBY"
      ? "Лобби"
      : "Игра завершена";

  const candidates = useMemo(
    () => avatarCandidates(player?.user, avatarBase),
    [player?.user, avatarBase]
  );
  const [imgIndex, setImgIndex] = useState(0);
  useEffect(() => {
    setImgIndex(0);
  }, [candidates?.[0]]);
  const src = candidates[imgIndex] || "";

  const stop = (e) => e.stopPropagation();

  if (!open || !player || actions.length === 0) return null;

  return (
    <div
      className={`mf-sheet ${open ? "open" : ""}`}
      role="dialog"
      aria-modal="true"
      aria-labelledby="action-sheet-title"
      onClick={onClose}
    >
      <div
        className="mf-sheet-card mf-sheet-in"
        onClick={stop}
        ref={cardRef}
        tabIndex={-1}
      >
        <div className="mf-sheet-head">
          <div className="mf-sheet-ava">
            {src ? (
              <img
                src={src}
                alt=""
                loading="lazy"
                decoding="async"
                referrerPolicy="no-referrer"
                onError={() =>
                  setImgIndex((i) =>
                    Math.min(i + 1, Math.max(0, candidates.length - 1))
                  )
                }
              />
            ) : (
              <div className="ph">{letter}</div>
            )}
          </div>
          <div className="mf-sheet-title" id="action-sheet-title">
            <div className="nick" dir="auto">
              {displayName}
            </div>
            <div className="sub">{headerNote}</div>
          </div>
          <button
            className="mf-iconbtn"
            onClick={onClose}
            aria-label="Закрыть"
            type="button"
          >
            ✕
          </button>
        </div>

        <div className="mf-sheet-actions">
          {actions.map((a) => (
            <button
              key={a.key}
              className={`mf-btn sheet ${toneClass(a.tone)}`}
              onClick={a.onClick}
              disabled={a.disabled}
              type="button"
              title={a.disabled ? a.label : undefined}
            >
              {a.label}
            </button>
          ))}
        </div>
        <div className="mf-safe" />
      </div>
    </div>
  );
}

/* =============================================================================
   === VOTE BOARD ==============================================================
   ========================================================================== */
export const VoteBoard = memo(function VoteBoard({ players, voteState }) {
  const idToName = useMemo(() => {
    const map = new Map();
    players.forEach((p) => {
      const name =
        p?.user?.firstName ||
        (p?.user?.username ? `@${p.user.username}` : `Игрок #${p?.user?.id}`);
      map.set(p.id, name);
    });
    map.set(0, "Пропуск");
    return map;
  }, [players]);

  const total = voteState?.alive || 0;
  const rows = Object.entries(voteState?.tally || {})
    .map(([k, v]) => ({
      key: k,
      count: v,
      name: idToName.get(Number(k)) || `#${k}`,
    }))
    .sort((a, b) => b.count - a.count);

  if (!rows.length) return null;

  const leaders = (() => {
    const max = rows.length ? rows[0].count : 0;
    return new Set(rows.filter((r) => r.count === max).map((r) => r.key));
  })();
  const votedCount = rows.reduce((acc, r) => acc + r.count, 0);
  const leftCount = Math.max(0, total - votedCount);
  const title = voteState?.round === 2 ? "Переголосование" : "Голосование";

  const threshold = Math.floor(total / 2) + 1;

  return (
    <section
      className="mf-vote"
      aria-label="Доска голосования"
      aria-live="polite"
      style={{
        ["--vote-threshold"]: String(total ? threshold / total : 0.5),
      }}
    >
      <div className="mf-vote-title">
        {title}
        <span className="mf-vote-left">Осталось: {leftCount}</span>
        <span className="sr-only">Порог: {threshold} голосов</span>
      </div>
      <div className="mf-vote-rows">
        {rows.map((r) => {
          const pct = total ? Math.round((r.count / total) * 100) : 0;
          const isLeader = leaders.has(r.key);
          return (
            <div
              key={r.key}
              className={`mf-vote-row ${isLeader ? "leader" : ""}`}
            >
              <span className="mf-vote-name" dir="auto">
                {r.name}
              </span>
              <span
                className="mf-vote-bar"
                aria-hidden="true"
                style={{ ["--votePct"]: `${pct}%` }}
              >
                <i />
              </span>
              <span className="mf-vote-count" aria-label="Голоса">
                {r.count}
              </span>
              <span className="mf-vote-pct" aria-label="Процент">
                {pct}%
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
});

/* =============================================================================
   === EVENTS ==================================================================
   ========================================================================== */
export function EventFeed({
  players,
  items,
  id = "events-panel",
  compact = false,
}) {
  const idToName = (pid) => {
    const p = players.find((x) => x.id === Number(pid));
    return p
      ? p?.user?.firstName ||
          (p?.user?.username
            ? `@${p?.user?.username}`
            : `Игрок #${p?.user?.id}`)
      : `#${pid}`;
  };
  const textOf = (e) => {
    const p = e.payload || {};
    // ✅ обновлён под killedIds (массив)
    if (e.phase === "NIGHT" && Array.isArray(p.killedIds)) {
      if (p.killedIds.length) {
        const names = p.killedIds.map(idToName).join(", ");
        return `🌙 Ночью убит${
          p.killedIds.length > 1 ? "ы" : ""
        } ${names}`;
      }
      return "🌙 Ночью никто не был убит";
    }
    if (e.phase === "VOTE" && p.lynchedId !== undefined) {
      if (p.lynchedId)
        return `⚔️ Казнён ${idToName(p.lynchedId)} (${
          p.lynchedRole || "?"
        })`;
      return "⚖️ Казни не было";
    }
    if (e.phase === "VOTE" && p.tie)
      return "🟰 Ничья. Переголосование среди лидеров.";
    if (e.phase === "DAY" && p.dayNumber)
      return `☀️ Наступил день ${p.dayNumber}`;
    if (e.phase === "NIGHT" && p.started) return "🌘 Наступила ночь";
    return null;
  };
  const formatted = (items || [])
    .map((x) => ({ ...x, text: textOf(x) }))
    .filter((x) => x.text);
  if (!formatted.length) return null;

  return (
    <section id={id} className={`mf-feed ${compact ? "compact" : ""}`}>
      <div className="mf-feed-title">События</div>
      <ul className="mf-feed-list">
        {formatted.map((e) => (
          <li key={e.id} className="mf-feed-item">
            {e.text}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Модальное окно с событиями */
export function EventsModal({ open, onClose, players, items }) {
  const cardRef = useRef(null);
  useModalA11y(open, cardRef, onClose);

  const [tab, setTab] = useState("ALL"); // ALL | NIGHT | DAY | VOTE

  const filterItems = useCallback(
    (k) => {
      if (k === "ALL") return items || [];
      return (items || []).filter((e) => e.phase === k);
    },
    [items]
  );

  if (!open) return null;

  const stop = (e) => e.stopPropagation();

  const tabs = [
    { key: "ALL", label: "Все" },
    { key: "NIGHT", label: "Ночь" },
    { key: "DAY", label: "День" },
    { key: "VOTE", label: "Голос" },
  ];

  const onKeyTabs = (e) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
    e.preventDefault();
    const idx = tabs.findIndex((t) => t.key === tab);
    if (e.key === "ArrowLeft") {
      setTab(tabs[(idx - 1 + tabs.length) % tabs.length].key);
    } else if (e.key === "ArrowRight") {
      setTab(tabs[(idx + 1) % tabs.length].key);
    } else if (e.key === "Home") {
      setTab(tabs[0].key);
    } else if (e.key === "End") {
      setTab(tabs[tabs.length - 1].key);
    }
  };

  return (
    <div
      className="mf-events-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="events-modal-title"
      onClick={onClose}
    >
      <div
        className="mf-events-card mf-events-in"
        onClick={stop}
        ref={cardRef}
        tabIndex={-1}
      >
        <div className="mf-events-head">
          <div className="mf-events-title" id="events-modal-title">
            ✨ События
          </div>

          <div
            className="mf-events-filters"
            role="tablist"
            aria-label="Фильтр событий"
            onKeyDown={onKeyTabs}
          >
            {tabs.map(({ key, label }) => {
              const selected = tab === key;
              const tabId = `events-tab-${key}`;
              const panelId = `events-tabpanel-${key}`;
              return (
                <button
                  key={key}
                  id={tabId}
                  role="tab"
                  aria-selected={selected}
                  aria-controls={panelId}
                  tabIndex={selected ? 0 : -1}
                  className={`mf-chip ${selected ? "primary" : "ghost"}`}
                  onClick={() => setTab(key)}
                  type="button"
                >
                  {label}
                </button>
              );
            })}
          </div>

          <button
            className="mf-iconbtn mf-events-close"
            onClick={onClose}
            aria-label="Закрыть события"
            type="button"
          >
            ✕
          </button>
        </div>

        <div className="mf-events-body">
          {tabs.map(({ key }) => {
            const tabId = `events-tab-${key}`;
            const panelId = `events-tabpanel-${key}`;
            const hidden = tab !== key;
            return (
              <div
                key={key}
                id={panelId}
                role="tabpanel"
                aria-labelledby={tabId}
                hidden={hidden}
              >
                {!hidden && (
                  <EventFeed
                    players={players}
                    items={filterItems(key)}
                    id={`events-feed-${key.toLowerCase()}`}
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* =============================================================================
   === ROLE / TOAST / CONFIRM ==================================================
   ========================================================================== */
// ⚠️ UPDATED: роль-карта с защитой от повторного запуска и полётом к wrapper’у (WAAPI + надёжный поиск цели по myId)
export function RoleCard({ role, myId, onClose }) {
  const info = roleInfo(role);
  const cardRef = useRef(null); // карточка в модалке (для a11y)
  const ghostRef = useRef(null); // «призрак» для полёта
  const modalRef = useRef(null); // оверлей модалки
  const inFlightRef = useRef(false); // защита от двойного запуска
  const findTriesRef = useRef(0); // попытки поиска цели (для безопасного bail-out)

  // ♻️ Гарантированный клинап даже если что-то пошло не так (предотвращает «чёрный экран».
  useEffect(() => {
    return () => {
      try {
        document.body.classList.remove("mf-animating");
        document.body.classList.remove("mf-role-open");
        const modal = modalRef.current;
        if (modal) {
          modal.classList.remove("flying");
          modal.style.background = "";
          modal.style.pointerEvents = "";
          modal.style.opacity = "";
        }
        // Сметём все «летающие» клоны, если вдруг остались
        document.querySelectorAll(".mf-role-fly").forEach((n) => {
          try {
            n.remove();
          } catch {}
        });
      } catch {}
    };
  }, []);

  // Прячем свой аватар, пока роль не прилетела в плитку
  useLayoutEffect(() => {
    if (!role) return;
    document.body.classList.add("mf-role-open");
    return () => {
      document.body.classList.remove("mf-role-open");
      try {
        document
          .querySelectorAll(".mf-player.me .mf-avatar-wrap")
          .forEach((node) => node.classList.remove("mf-ava-hidden"));
      } catch {}
    };
  }, [role]);

  // ⏱️ через секунду — flip с рубашки на лицо
  const [flipped, setFlipped] = useState(false);
  useEffect(() => {
    if (!role) return;
    const id = setTimeout(() => setFlipped(true), 1000);
    return () => clearTimeout(id);
  }, [role]);

  const srcFront = roleAvatarOf(role) || roleAvatarOf("CIVIL") || avaUnknown;
  // Если по каким-то причинам card-back отсутствует — упадём на unknown:
  const srcBack = roleCardBack || avaUnknown;

  // Новый полёт «карточки-аватара» в мою плитку — ВЕРСИЯ С КЛОНОМ В body:
  const animateBackToMyTile = useCallback(
    (force = false) => {
      const failSafeExit = () => {
        try {
          document.body.classList.remove("mf-animating");
          document.body.classList.remove("mf-role-open");
        } catch {}
        try {
          if (modalRef.current) {
            modalRef.current.classList.remove("flying");
            modalRef.current.style.background = "";
            modalRef.current.style.pointerEvents = "";
            modalRef.current.style.opacity = "";
          }
        } catch {}
        inFlightRef.current = false;
        onClose?.();
      };

      if (inFlightRef.current) return;

      const reduced = document.body.classList.contains("mf-reduced-motion");
      const ghost = ghostRef.current;
      if (!ghost) {
        failSafeExit();
        return;
      }
      if (reduced && !force) {
        failSafeExit();
        return;
      }

      // 0) Немедленно «пронизываем» модалку: фон убираем, клики пропускаем, прячем визуально
      if (modalRef.current) {
        modalRef.current.classList.add("flying");
        modalRef.current.style.background = "transparent";
        modalRef.current.style.pointerEvents = "none";
        modalRef.current.style.opacity = "0";
      }
      document.body.classList.add("mf-animating"); // опционально гасим тяжелые фильтры

      try {
        // 1) Находим целевой wrap (если ещё не появился — повторим на следующем кадре,
        //    но не дольше ~600мс, чтобы не зависнуть)
        let targetWrap =
          document.querySelector(
            `.mf-player[data-pid="${myId}"] .mf-avatar-wrap`
          ) ||
          document.querySelector(".mf-player.me .mf-avatar-wrap") ||
          document.querySelector(".mf-player .mf-avatar-wrap");
        if (!targetWrap) {
          if (
            (findTriesRef.current = (findTriesRef.current || 0) + 1) >
            36
          ) {
            // ~36 кадров ≈ 600мс @60fps — сдаёмся аккуратно
            findTriesRef.current = 0;
            failSafeExit();
            return;
          }
          requestAnimationFrame(() => animateBackToMyTile(force));
          return;
        }
        // нашли цель — сбрасываем счётчик
        findTriesRef.current = 0;

        const target =
          targetWrap.querySelector(".mf-avatar, .mf-avatar.placeholder") ||
          targetWrap;

        inFlightRef.current = true;

        // 3) Делаем клон призрака и выносим его в body
        const r1 = ghost.getBoundingClientRect();
        const flyer = ghost.cloneNode(true);
        flyer.classList.add("mf-role-fly");
        // дублируем актуальный флип на всякий случай
        flyer.setAttribute("data-flipped", flipped ? "true" : "false");
        Object.assign(flyer.style, {
          position: "fixed",
          left: `${r1.left}px`,
          top: `${r1.top}px`,
          width: `${r1.width}px`,
          height: `${r1.height}px`,
          margin: "0",
          zIndex: 2000,
          willChange: "transform",
          transformOrigin: "top left",
          pointerEvents: "none",
        });
        document.body.appendChild(flyer);

        // Прячем оригинальный призрак в карточке и гасим саму карточку
        ghost.style.visibility = "hidden";
        if (cardRef.current) cardRef.current.style.opacity = "0";

        // 4) Геометрия перелёта — измеряем ДО классов, меняющих размер/стиль
        const r2 = targetWrap.getBoundingClientRect();
        // Прячем живой аватар на сетке на время полёта
        targetWrap.classList.add("mf-ava-hidden");

        const dx = r2.left - r1.left;
        const dy = r2.top - r1.top;
        const sx = r2.width / r1.width || 1;
        const sy = r2.height / r1.height || 1;
        const distance = Math.hypot(dx, dy);
        const lift = Math.min(140, Math.max(52, distance * 0.18));
        const arcX = dx * 0.32;
        const arcY = dy * 0.32 - lift;
        const tilt = Math.max(-10, Math.min(10, -dx * 0.04));

        const done = () => {
          try {
            targetWrap.classList.remove("mf-ava-hidden");
            flyer.remove();
            document.body.classList.remove("mf-animating");
            document.body.classList.remove("mf-role-open");
          } finally {
            inFlightRef.current = false;
            onClose?.();
          }
        };

        // 5) Фолбэк без WAAPI — только transform, без filter
        if (!flyer.animate) {
          flyer.style.transition =
            "transform 450ms cubic-bezier(.2,.8,.2,1)";
          requestAnimationFrame(() => {
            flyer.style.transform = `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`;
            const tidy = () => {
              flyer.removeEventListener("transitionend", tidy);
              done();
            };
            flyer.addEventListener("transitionend", tidy, { once: true });
            setTimeout(tidy, 650);
          });
          return;
        }

        // 6) Плавный полёт + мягкий settle-bounce (только transform)
        flyer.classList.add("mf-flight");
        const keyframes = [
          {
            transform: "translate(0px, 0px) scale(1, 1) rotate(0deg)",
            offset: 0,
          },
          {
            transform: `translate(${arcX}px, ${arcY}px) scale(${
              1 + (sx - 1) * 0.22
            }, ${1 + (sy - 1) * 0.22}) rotate(${tilt}deg)`,
            offset: 0.42,
          },
          {
            transform: `translate(${dx}px, ${dy}px) scale(${
              sx * 1.02
            }, ${sy * 1.02}) rotate(0deg)`,
            offset: 0.85,
          },
          {
            transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`,
            offset: 1,
          },
        ];

        const flight = flyer.animate(keyframes, {
          duration: 640,
          easing: "cubic-bezier(.22,.8,.24,1)",
          fill: "forwards",
        });
        const finished =
          flight.finished && typeof flight.finished.then === "function"
            ? flight.finished
            : new Promise((res) =>
                flight.addEventListener("finish", res, { once: true })
              );

        finished
          .then(() =>
            flyer
              .animate(
                [
                  {
                    transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`,
                  },
                  {
                    transform: `translate(${dx}px, ${dy}px) scale(${
                      sx * 0.985
                    }, ${sy * 0.985})`,
                  },
                  {
                    transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`,
                  },
                ],
                {
                  duration: 220,
                  easing: "cubic-bezier(.25,.7,.3,1)",
                  fill: "forwards",
                }
              )
              .finished
          )
          .then(done)
          .catch(done);

        // страховка от залипаний
        setTimeout(() => {
          if (inFlightRef.current) done();
        }, 1500);
      } catch (e) {
        console.error("RoleCard flight error:", e);
        failSafeExit();
      }
    },
    [myId, onClose, flipped]
  );

  // единый «закрываш» для клика по фону/ESC/кнопки
  const closeWithFly = useCallback(() => {
    // Нельзя закрывать/нажимать до flip
    if (!flipped) return;
    animateBackToMyTile(true);
  }, [animateBackToMyTile, flipped]);

  // a11y: ESC закрывает с полётом и возвращает фокус
  useModalA11y(!!role, cardRef, closeWithFly);

  if (!role) return null;

  return (
    <div
      className="mf-role-modal"
      onClick={closeWithFly}
      role="dialog"
      aria-modal="true"
      aria-labelledby="mf-role-title"
      ref={modalRef}
    >
      <div
        className="mf-role-card"
        onClick={(e) => e.stopPropagation()}
        ref={cardRef}
        tabIndex={-1}
        data-flipped={flipped ? "true" : "false"}
        aria-busy={!flipped}
      >
        {/* ↑↑↑ ВЕРХ — карточка роли: рамка как у mf-avatar, flip */}
        <div
          className="mf-avatar-wrap mf-ava-bronze mf-role-ghost"
          ref={ghostRef}
          // ✅ Привязка состояния flip к обёртке с рамкой
          data-flipped={flipped ? "true" : "false"}
        >
          {/* FIX: корректный JSX для класса flip */}
          <div className={`mf-role-flip ${flipped ? "is-flipped" : ""}`}>
            <div className="mf-role-face front" aria-hidden="true">
              <img
                className="mf-avatar"
                src={srcFront}
                alt=""
                decoding="async"
                loading="eager"
                referrerPolicy="no-referrer"
              />
            </div>
            <div className="mf-role-face back" aria-hidden="true">
              <img
                className="mf-avatar"
                src={srcBack}
                alt=""
                decoding="async"
                loading="eager"
                referrerPolicy="no-referrer"
              />
            </div>
          </div>
        </div>

        {/* ↓↓↓ текст и CTA (появляются только после flip) */}
        <div className="mf-role-meta">
          <div className="mf-role-title" id="mf-role-title">
            {info.title}
          </div>
          <div className="mf-role-desc">{info.desc}</div>
          <button
            className="mf-btn primary mf-role-cta"
            onClick={closeWithFly}
            type="button"
            disabled={!flipped}
            aria-disabled={!flipped}
          >
            Погнали!
          </button>
        </div>
      </div>
    </div>
  );
}

export function ConfirmLeave({ open, onCancel, onConfirm }) {
  const cardRef = useRef(null);
  useModalA11y(open, cardRef, onCancel);

  if (!open) return null;
  return (
    <div
      className="mf-confirm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="mf-confirm-title"
      onClick={onCancel}
    >
      <div
        className="mf-confirm-card"
        onClick={(e) => e.stopPropagation()}
        ref={cardRef}
        tabIndex={-1}
      >
        <div className="mf-confirm-title" id="mf-confirm-title">
          Выйти из комнаты?
        </div>
        <div className="mf-confirm-actions">
          <button className="mf-btn" onClick={onCancel} type="button">
            Остаться
          </button>
          <button
            className="mf-btn danger"
            onClick={onConfirm}
            type="button"
          >
            Выйти
          </button>
        </div>
      </div>
    </div>
  );
}

/* =============================================================================
   === Toasts (красивые всплывающие уведомления) ===============================
   Презентационные компоненты. Никакой логики таймеров — контейнер
   уже удаляет элементы из массива `toasts`.
   ========================================================================== */

function parseToastMessage(text = "", tone = "info") {
  const raw = String(text || "");
  const t = tone || "info";

  // нормализуем
  const normalized = raw.replace(/\s+/g, " ").trim();

  // дефолл
  let icon = "✨";
  let title = normalized;
  let sub = "";
  let tag = null; // например «МАФИЯ» / «мирный»
  let variant = "info";

  const set = (i, ti, s = "", g = null, v = t) => {
    icon = i;
    title = ti;
    sub = s;
    tag = g;
    variant = v;
  };

  // — Доктор спас
  if (/доктор спас/i.test(normalized)) {
    set(
      "🩹",
      "Доктор спас жертву",
      "Ночь прошла без жертв",
      null,
      "success"
    );
  }
  // — Тихая ночь
  else if (/тихая ночь/i.test(normalized)) {
    set("🌙", "Тихая ночь", "Никто не погиб", null, "info");
  }
  // — Ночью был убит ...
  else if (/убит/i.test(normalized) && /ноч(ью|и)/i.test(normalized)) {
    set(
      "💀",
      "Ночью был убит игрок",
      normalized.replace(/^.*убит/i, "").trim(),
      null,
      "danger"
    );
  }
  // — Проверка шерифа: «🔎 Проверка: Ник — МАФИЯ|мирный»
  else if (/проверка:/i.test(normalized)) {
    const m = normalized.match(
      /проверка:\s*(.+?)\s*[—-]\s*(МАФИЯ|мирный)/i
    );
    const name = m?.[1]?.trim();
    const verdict = m?.[2]?.toUpperCase() || "";
    const isMafiaVerdict = verdict === "МАФИЯ";
    set(
      "🔎",
      `Проверка: ${name || "игрок"}`,
      isMafiaVerdict ? "Найден мафиози" : "Мирный",
      isMafiaVerdict ? "МАФИЯ" : "мирный",
      isMafiaVerdict ? "danger" : "ok"
    );
  }
  // — Казнён игрок / казни не было
  else if (/казнён/i.test(normalized)) {
    set("⚔️", "Казнён игрок", "День завершён", null, "warn");
  } else if (/казни не было/i.test(normalized)) {
    set(
      "🤝",
      "Казни не было",
      "Город пощадил подозреваемого",
      null,
      "info"
    );
  }
  // — Финал
  else if (/мафия победила/i.test(normalized)) {
    set("🕶️", "Мафия победила", "Город пал", null, "danger");
  } else if (/город победил/i.test(normalized)) {
    set("🏙️", "Город победил", "Мафия раскрыта", null, "success");
  }
  // — Иначе: оставляем текст как есть
  else {
    // 🔒 Безопасно компилируем RegExp с \p{Emoji} на рантайме; фолбэк — грубый диапазон
    const leadEmojiRe = (() => {
      try {
        return new RegExp(
          "^([\\p{Emoji}\\p{Extended_Pictographic}]{1,2})",
          "u"
        );
      } catch {
        return /^([\u231A-\u2764\u2B00-\u2BFF\uFE0F\u1F000-\u1FAFF]{1,2})/;
      }
    })();
    const m = leadEmojiRe.exec(normalized);
    const leadEmoji = m ? m[1] : null;

    if (leadEmoji) {
      icon = leadEmoji;
      title = normalized.replace(leadEmoji, "").trim();
    } else {
      icon =
        t === "danger" || t === "error"
          ? "⚠️"
          : t === "warn"
          ? "⚠️"
          : t === "success" || t === "ok"
          ? "✅"
          : "✨";
    }
    variant = t;
  }

  return { icon, title, sub, tag, variant };
}

/** Единичный красивый тост */
function ToastCard({ text, tone = "info", i = 0 }) {
  const meta = useMemo(() => parseToastMessage(text, tone), [text, tone]);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    // плавное появление
    const id = requestAnimationFrame(() => setInView(true));
    return () => cancelAnimationFrame(id);
  }, []);

  return (
    <div
      className={`mf-toast-card ${meta.variant} ${inView ? "in" : ""}`}
      role="status"
      aria-live="polite"
      style={{ ["--toast-index"]: i }}
    >
      <div className="ico" aria-hidden="true">
        {meta.icon}
      </div>
      <div className="txt">
        <div className="title">
          {meta.title}
          {meta.tag && (
            <span
              className={`tag ${
                /мафия/i.test(meta.tag) ? "bad" : "good"
              }`}
            >
              {meta.tag}
            </span>
          )}
        </div>
        {meta.sub && <div className="sub">{meta.sub}</div>}
      </div>
    </div>
  );
}

/** Стек тостов — аккуратно складываем карточки снизу вверх */
export function ToastStack({ items = [] }) {
  return (
    <div
      className="mf-toasts"
      aria-live="polite"
      aria-relevant="additions text"
    >
      {items.map((t, idx) => (
        <ToastCard key={t.id || idx} text={t.text} tone={t.tone} i={idx} />
      ))}
    </div>
  );
}

/** Совместимость со старым API: можно продолжать рендерить <Toast .../> */
export function Toast({ text, tone = "info" }) {
  return <ToastCard text={text} tone={tone} i={0} />;
}

/* =============================================================================
   === ACTION TOAST (всплывашка с ОК) ==========================================
   Для ночных действий без попапов. Контейнер сам очищает элемент из массива.
   ========================================================================== */
export function ActionToast({ id, text, tone = "info", onOk }) {
  // Переиспользуем разметку тоста, добавив CTA
  const meta = useMemo(() => parseToastMessage(text, tone), [text, tone]);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const raf = requestAnimationFrame(() => setInView(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div
      className={`mf-toast-card ${meta.variant} has-cta ${
        inView ? "in" : ""
      }`}
      role="status"
      aria-live="polite"
      data-id={id}
    >
      <div className="ico" aria-hidden="true">
        {meta.icon}
      </div>
      <div className="txt">
        <div className="title">
          {meta.title}
          {meta.tag && (
            <span
              className={`tag ${
                /мафия/i.test(meta.tag) ? "bad" : "good"
              }`}
            >
              {meta.tag}
            </span>
          )}
        </div>
        {meta.sub && <div className="sub">{meta.sub}</div>}
      </div>
      <div className="mf-toast-cta">
        <button className="mf-toast-btn" type="button" onClick={onOk}>
          ОК
        </button>
      </div>
    </div>
  );
}

export function ActionToastStack({ items = [] }) {
  return (
    <div
      className="mf-toasts"
      aria-live="polite"
      aria-relevant="additions text"
    >
      {items.map((t, idx) => (
        <ActionToast
          key={t.id || idx}
          id={t.id || idx}
          text={t.text}
          tone={t.tone}
          onOk={t.onOk}
        />
      ))}
    </div>
  );
}

/* =============================================================================
   === MENU (главное меню) — НОВАЯ РЕАЛИЗАЦИЯ ==================================
   Один экран, две траектории: «Вступить по коду» (инлайн) и «Создать».
   Поддержка recentRooms, бенто-гайд, высокая доступность.
   ========================================================================== */

// MenuViewV2 — чисто презентационный компонент
// MenuViewV2 ? ????? ????????? (mf-menu v2)
export function MenuViewV2(props) {
  return <RoomMenu {...props} />;
}

/** Диалог «Вступить по коду» (устарел; для обратной совместимости) */
export function JoinDialog({ open, onCancel, onSubmit }) {
  const [val, setVal] = useState("");
  const cardRef = useRef(null);
  const inputRef = useRef(null);

  useModalA11y(open, cardRef, onCancel);

  useEffect(() => {
    if (open) {
      setVal("");
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  if (!open) return null;

  const submit = () => {
    const code = (val || "").trim().toUpperCase();
    if (code) onSubmit?.(code);
  };

  return (
    <div
      className="mf-confirm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="mf-join-title"
      onClick={onCancel}
    >
      <div
        className="mf-confirm-card"
        onClick={(e) => e.stopPropagation()}
        ref={cardRef}
        tabIndex={-1}
      >
        <div className="mf-confirm-title" id="mf-join-title">
          Вступить по коду
        </div>
        <div className="mf-form">
          <input
            ref={inputRef}
            className="mf-input"
            placeholder="Код комнаты"
            value={val}
            onChange={(e) => setVal(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submit();
            }}
            inputMode="text"
            autoCapitalize="characters"
            enterKeyHint="go"
            autoCorrect="off"
            spellCheck={false}
          />
        </div>
        <div className="mf-confirm-actions">
          <button className="mf-btn" onClick={onCancel} type="button">
            Отмена
          </button>
          <button
            className="mf-btn primary"
            onClick={submit}
            type="button"
          >
            Войти
          </button>
        </div>
      </div>
    </div>
  );
}

/** Баннер состояния сети (socket) */
export function NetBanner({ online, reconnecting }) {
  if (online) return null;
  return (
    <div className="mf-net" role="status" aria-live="polite">
      <span className="ico">🔌</span>
      <span className="txt">
        {reconnecting
          ? "Потеряно соединение. Переподключение…"
          : "Нет подключения"}
      </span>
    </div>
  );
}

/** Нижняя плашка после завершения матча — доступно всем */
export function EndedBar({ onReturn, onLeave, label }) {
  return (
    <div className="mf-endedbar" role="region" aria-label="Игра завершена">
      <div className="mf-endedbar-inner">
        <div className="mf-endedbar-title">
          {label || "Игра завершена"}
        </div>
        <div className="mf-endedbar-actions">
          <button
            className="mf-btn primary big mf-endedbar-btn"
            onClick={onReturn}
            type="button"
          >
            🔄 Вернуться в комнату
          </button>
          <button
            className="mf-btn big mf-endedbar-btn"
            onClick={onLeave}
            type="button"
          >
            ⎋ Покинуть комнату
          </button>
        </div>
      </div>
      <div className="mf-safe" />
    </div>
  );
}

/* =============================================================================
   === internal UI helpers =====================================================
   ========================================================================== */
function toneClass(t) {
  switch (t) {
    case "primary":
      return "primary";
    case "ok":
      return "ok";
    case "warn":
      return "warn";
    case "danger":
      return "danger";
    case "ghost":
      return "ghost";
    default:
      return "";
  }
}
function labelByKey(r) {
  switch (r) {
    case "MAFIA":
      return "Мафия";
    case "DON":
      return "Дон";
    case "DOCTOR":
      return "Доктор";
    case "SHERIFF":
      return "Шериф";
    case "BODYGUARD":
      return "Телохранитель";
    case "PROSTITUTE":
      return "Любовница";
    case "JOURNALIST":
      return "Журналист";
    case "SNIPER":
      return "Снайпер";
    case "CIVIL":
      return "Мирный";
    case "NIGHT":
      return "Ночь";
    case "DAY":
      return "День";
    case "VOTE":
      return "Голос";
    case "LOBBY":
      return "Лобби";
    case "ENDED":
      return "Завершена";
    default:
      return "";
  }
}

// ✅ переводим все роли, включая DON и расширенные
function translateRole(r) {
  switch (r) {
    case "MAFIA":
      return "Мафия";
    case "DON":
      return "Дон";
    case "DOCTOR":
      return "Доктор";
    case "SHERIFF":
      return "Шериф";
    case "BODYGUARD":
      return "Телохранитель";
    case "PROSTITUTE":
      return "Любовница";
    case "JOURNALIST":
      return "Журналист";
    case "SNIPER":
      return "Снайпер";
    case "CIVIL":
      return "Мирный";
    default:
      return r || "";
  }
}

// ✅ карточка роли для всех поддержанных
function roleInfo(role) {
  switch (role) {
    case "MAFIA":
      return {
        emoji: "🕶️",
        title: "Ты — Мафия",
        desc: "Ночью выбирай жертву. Днём — притворяйся мирным.",
      };
    case "DON":
      return {
        emoji: "🎩",
        title: "Ты — Дон",
        desc: "Главарь мафии. Ночью координируй выбор жертвы вместе с мафией. Шериф видит тебя мирным.",
      };
    case "DOCTOR":
      return {
        emoji: "🩺",
        title: "Ты — Доктор",
        desc: "Лечи одного игрока за ночь. Самолечение — 1 раз за игру. Одну цель нельзя лечить подряд.",
      };
    case "SHERIFF":
      return {
        emoji: "🕵️",
        title: "Ты — Шериф",
        desc: "Проверяй игроков ночью. Нельзя проверять себя и одну цель дважды подряд.",
      };
    case "BODYGUARD":
      return {
        emoji: "🛡️",
        title: "Ты — Телохранитель",
        desc: "Охраняй игрока ночью. Если по нему придут — погибаешь вместо него.",
      };
    case "PROSTITUTE":
      return {
        emoji: "💋",
        title: "Ты — Любовница",
        desc: "Блокируй цель ночью. Заблокированный игрок не совершит действие.",
      };
    case "JOURNALIST":
      return {
        emoji: "📰",
        title: "Журналист",
        desc: "Ночью расследуй: мафия / силовая роль / мирный.",
      };
    case "SNIPER":
      return {
        emoji: "🎯",
        title: "Ты — Снайпер",
        desc: "Один точный выстрел за игру. Используй с умом.",
      };
    default:
      return {
        emoji: "🧑‍🤝‍🧑",
        title: "Ты — Мирный",
        desc: "Обсуждай, наблюдай и голосуй днём. Ночью спи спокойно.",
      };
  }
}

/** Формирование списка кандидатов для аватарки */
function avatarCandidates(user, avatarBase) {
  const list = [];
  const tgId = user?.tgId || user?.tg_id;
  if (avatarBase && tgId) list.push(`${avatarBase}/avatar/${tgId}`);
  const src = user?.photoUrl || user?.photo_url || user?.photo || "";
  if (src) list.push(src);

  const uname = user?.username || user?.userName || user?.user_name || "";
  if (uname) {
    list.push(`https://t.me/i/userpic/320/${uname}.jpg`);
    list.push(`https://t.me/i/userpic/160/${uname}.jpg`);
  }
  return list;
}

// small utils (синхронизированы с контейнером)
/* =============================================================================
   === Итоговые экспортные алиасы =============================================
   ========================================================================== */

// Хоистящаяся декларация — безопасна при возможных циклах импорта
export function MenuView(props) {
  return <MenuViewV2 {...props} />;
}
export default MenuView;
