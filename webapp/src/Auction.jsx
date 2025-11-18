// src/Auction.jsx
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  const [playersDrawerOpen, setPlayersDrawerOpen] = useState(true);
  const [toast, setToast] = useState(null);
  const lastToastRef = useRef(null);
  const progressSentRef = useRef(false);
  const lastSubscribedCodeRef = useRef(null);
  const lastSubscriptionSocketIdRef = useRef(null);
  const togglePlayersDrawer = useCallback(
    () => setPlayersDrawerOpen((open) => !open),
    []
  );

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

  return (
    <div className="auction-root">
      <div className="auction-aurora" aria-hidden="true" />
      <div className="auction-aurora second" aria-hidden="true" />
      {room ? (
        <>
          <div className="auction-shell">
            <div className="auction-stage">
              <header className="auction-toolbar">
                <div className="auction-toolbar-left">
                  <button
                    type="button"
                    className="auction-icon-button"
                    onClick={handleExit}
                    aria-label="????? ? ????"
                  >
                    Back
                  </button>
                  <div className="auction-room-info">
                    <div className="auction-title">AUCTION</div>
                    <div className="auction-room-code">
                      ???
                      <span className="auction-room-code-value">{room.code}</span>
                    </div>
                  </div>
                </div>
                <div className="auction-toolbar-actions">
                  <button
                    type="button"
                    className="auction-icon-button ghost"
                    onClick={copyRoomCode}
                    aria-label="??????????? ???"
                  >
                    Share
                  </button>
                  {showPlayersDrawer && (
                    <button
                      type="button"
                      className="auction-icon-button ghost"
                      onClick={togglePlayersDrawer}
                      aria-pressed={playersDrawerOpen ? "true" : "false"}
                      aria-label="????????/?????? ???????"
                    >
                      Squad
                    </button>
                  )}
                </div>
              </header>

              <section className="auction-hero" role="banner">
                <div className="auction-hero-copy">
                  <p className="auction-phase-label">{heroPhaseLabel}</p>
                  <h1 className="auction-hero-title">
                    {currentSlot?.name || (phase === "finished" ? "?????" : "??????? ??????")}
                  </h1>
                  <p className="auction-phase-hint">{heroPhaseHint}</p>
                  <div className="auction-hero-tags">
                    <span className="auction-chip">
                      {phase === "in_progress" ? "LIVE" : phase === "finished" ? "GG" : "LOBBY"}
                    </span>
                    <span className="auction-chip ghost">
                      ???????: {players.length}
                    </span>
                    {auctionState?.paused && (
                      <span className="auction-chip gray">?????</span>
                    )}
                  </div>
                  {heroHistoryPreview.length > 0 && (
                    <ul className="auction-hero-timeline">
                      {heroHistoryPreview.map((h) => (
                        <li key={h.index}>
                          <span className="timeline-title">
                            #{h.index + 1} ? {h.type === "lootbox" ? "???-????" : "???"}
                          </span>
                          <span className="timeline-meta">
                            {moneyFormatter.format(h.winBid || 0)}$
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div className="auction-hero-ring" role="timer" aria-live="polite">
                  <span className="hero-ring-value">
                    {secsLeft != null ? secsLeft : countdownStep ?? "--"}
                  </span>
                  <span className="hero-ring-sub">
                    {showGame ? "???." : "??????"}
                  </span>
                  <div className="hero-ring-progress">
                    <span style={{ height: `${progressPct ?? 0}%` }} />
                  </div>
                </div>
              </section>

              <section className="auction-dashboard" aria-label="???????? ??????????">
                <article className="auction-stat-card">
                  <p className="label">??????</p>
                  <strong>
                    {myBalance != null ? `${moneyFormatter.format(myBalance)}$` : "?"}
                  </strong>
                  <span className="stat-meta">??????: {myWinsCount}</span>
                </article>
                <article className="auction-stat-card">
                  <p className="label">?????</p>
                  <strong>{slotCounterLabel}</strong>
                  <span className="stat-meta">
                    ????? ?????: {auctionState?.maxSlots || cfgRules.maxSlots}
                  </span>
                </article>
                <article className="auction-stat-card">
                  <p className="label">??????????</p>
                  <strong>
                    {readyCount}/{players.length || 0}
                  </strong>
                  <span className="stat-meta">
                    ? ????????: {waitingCount}
                  </span>
                </article>
                <article className="auction-stat-card">
                  <p className="label">???????</p>
                  <strong>{selectedBasketValue}$</strong>
                  <span className="stat-meta">
                    {selectedPlayerName ? `? ${selectedPlayerName}` : "???????? ??????"}
                  </span>
                </article>
              </section>

              <div className="auction-actions-row">
                <div className="auction-status-actions">
                  {!isOwner && (
                    <button
                      className="auction-btn primary"
                      onClick={toggleReady}
                      disabled={!currentPlayer}
                    >
                      {currentPlayer?.ready ? "?????" : "? ?????"}
                    </button>
                  )}
                  {isOwner && (
                    <button
                      className="auction-btn primary"
                      onClick={handleStartAuction}
                      disabled={!everyoneReadyExceptOwner}
                    >
                      {everyoneReadyExceptOwner ? "?????????" : "??? ???????"}
                    </button>
                  )}
                </div>
                {isOwner && (
                  <div className={`auction-config modern${cfgOpen ? " open" : ""}`}>
                    <button
                      className="auction-btn small ghost"
                      type="button"
                      onClick={() => setCfgOpen((v) => !v)}
                      aria-expanded={cfgOpen ? "true" : "false"}
                      aria-controls="auction-config-panel"
                    >
                      {cfgOpen ? "???????? ?????" : "????????? ?????"}
                    </button>
                    {cfgOpen && (
                      <div className="auction-config-panel" id="auction-config-panel">
                        <div className="auction-row compact">
                          <label className="auction-label">
                            ????? ?? ???
                            <input
                              className="auction-input"
                              type="number"
                              min="5"
                              max="60"
                              value={cfgRules.timePerSlotSec}
                              onChange={(e) =>
                                setCfgRules((r) => ({
                                  ...r,
                                  timePerSlotSec: e.target.value.replace(/[^\d]/g, ""),
                                }))
                              }
                            />
                          </label>
                          <label className="auction-label">
                            ???-?? ?????
                            <input
                              className="auction-input"
                              type="number"
                              min="1"
                              max="60"
                              value={cfgRules.maxSlots}
                              onChange={(e) =>
                                setCfgRules((r) => ({
                                  ...r,
                                  maxSlots: e.target.value.replace(/[^\d]/g, ""),
                                }))
                              }
                            />
                          </label>
                          <button
                            className="auction-btn"
                            type="button"
                            onClick={configureAuction}
                          >
                            ?????????
                          </button>
                        </div>
                        <textarea
                          className="auction-textarea"
                          placeholder={`??????? | 120000 | lot`}
                          value={cfgSlotsText}
                          onChange={(e) => setCfgSlotsText(e.target.value)}
                          rows={4}
                        />
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="auction-stage-scroll">
                {showGame && (
                  <section className="auction-live-card">
                    {currentSlot ? (
                      <Fragment>
                        <div className="auction-lot-core">
                          <div className="auction-lot-type">
                            {currentSlot.type === "lootbox" ? "???-????" : "???"}
                          </div>
                          <div className="auction-lot-name">
                            {currentSlot.name || "???? ????????"}
                          </div>
                          <div className="auction-lot-meta">
                            ?????????: {moneyFormatter.format(currentSlot.basePrice || 0)}$
                          </div>
                          <div className="auction-lot-meta">
                            ??? {(auctionState?.slotsPlayed ?? 0) + 1} ?? {auctionState?.maxSlots}
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
                            placeholder="??????? ??????"
                          />
                          <button
                            className="auction-btn primary"
                            onClick={() => sendBid()}
                            disabled={busyBid || myBalance == null || myBalance <= 0}
                          >
                            {busyBid ? "??????????..." : "??????? ??????"}
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
                              ???
                            </button>
                          </div>
                          <div className="auction-hint">
                            ??????: {myBalance != null ? `${moneyFormatter.format(myBalance)}$` : "?"}
                            {" ? "}
                            {typeof myRoundBid === "number"
                              ? `???? ??????: ${moneyFormatter.format(myRoundBid)}$`
                              : "?? ??? ?? ???????"}
                          </div>
                        </div>
                        {isOwner && (
                          <div className="auction-live-owner">
                            {!auctionState?.paused ? (
                              <button className="auction-btn" onClick={pauseAuction}>
                                ?????
                              </button>
                            ) : (
                              <button className="auction-btn" onClick={resumeAuction}>
                                ??????????
                              </button>
                            )}
                            <button className="auction-btn ghost" onClick={forceNext}>
                              ?????????? ???
                            </button>
                          </div>
                        )}
                      </Fragment>
                    ) : (
                      <div className="auction-hint">??? ???????? ????? ???????</div>
                    )}
                    {error && showGame && <div className="auction-error">{error}</div>}
                  </section>
                )}

                {!showGame && showLobby && (
                  <section className="auction-card muted floating-hint">
                    ???????? ???????, ???????? ?????????? ? ????????? ???, ????? ??? ????????????????.
                  </section>
                )}

                {showResult && (
                  <section className="auction-result-card">
                    <div className="auction-card-title">?????</div>
                    <div className="auction-hint">
                      ???????? ??????? ??? ?????????? MVP ? ????????? ????-?????????.
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
                            `????? ${p.id}`;
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
                                    {isWinner && " ?"}
                                  </div>
                                  <div className="auction-player-meta">
                                    ??????: {moneyFormatter.format(balance)}$
                                  </div>
                                  <div className="auction-player-meta small">
                                    ???????: {moneyFormatter.format(basketValue)}$
                                  </div>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                    </div>
                    <div className="auction-row">
                      <button className="auction-btn" onClick={handleRestart}>
                        ??????????
                      </button>
                      <button className="auction-btn" onClick={handleExit}>
                        ????? ? ????
                      </button>
                    </div>
                  </section>
                )}

                {auctionState?.history?.length > 0 && (
                  <section className="auction-history-card">
                    <div className="auction-card-title">?????????? ?????</div>
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
                              #{h.index + 1} ? {h.type === "lootbox" ? "???-????" : "???"} ? {h.name}
                            </div>
                            {winnerName ? (
                              <div className="auction-history-meta">
                                ??????????: {winnerName} ?? {moneyFormatter.format(h.winBid || 0)}$
                                {effectText && <span> ({effectText})</span>}
                              </div>
                            ) : (
                              <div className="auction-history-meta">?????? ?? ?????????</div>
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
                      ??????? {selectedPlayerName}
                    </div>
                    <div className="auction-hint">
                      ??????? ?????????: {selectedBasket.length} ?? ????? {moneyFormatter.format(selectedBasketTotal || 0)}$
                    </div>
                    {selectedBasket.length === 0 ? (
                      <div className="auction-hint">???? ??? ?????</div>
                    ) : (
                      <div className="auction-history">
                        {selectedBasket.map((item) => (
                          <div key={item.index} className="auction-history-item">
                            <div className="auction-history-title">
                              #{(item.index ?? 0) + 1} ? {item.type === "lootbox" ? "???-????" : "???"} ? {item.name}
                            </div>
                            <div className="auction-history-meta">
                              ??????? ?? {moneyFormatter.format(item.paid || 0)}$ ? ???????? {moneyFormatter.format(item.value || 0)}$
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
            </div>

            {showPlayersDrawer && (
              <aside
                className={`auction-players-drawer${playersDrawerOpen ? " open" : ""}`}
                aria-label="?????? ???????"
              >
                <div className="auction-drawer-head">
                  <div>
                    <div className="auction-card-title">??????</div>
                    <p className="auction-hint">
                      ???????, ????? ???????? ? ?????????? ???????
                    </p>
                  </div>
                  <button
                    type="button"
                    className="auction-btn small ghost"
                    onClick={togglePlayersDrawer}
                    aria-expanded={playersDrawerOpen ? "true" : "false"}
                  >
                    {playersDrawerOpen ? "??????" : "????????"}
                  </button>
                </div>
                <div className="auction-players-grid" role="list">
                  {players.map((p) => {
                    const isMe = p.id === selfInfo?.roomPlayerId;
                    const isHost = p.user?.id === room?.ownerId;
                    const isSelected = selectedPlayerIdEffective === p.id;
                    const name =
                      p.user?.first_name ||
                      p.user?.username ||
                      `Player ${p.id}`;
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
                        <span className="chip-info">
                          <span className="chip-name">{name}</span>
                          <span className="chip-role">
                            {isHost ? "????" : p.ready ? "?????" : "????"}
                          </span>
                        </span>
                        <span className="chip-meta">
                          {balance != null ? `${moneyFormatter.format(balance)}$` : "--"}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </aside>
            )}
          </div>

          <footer className="auction-mobile-nav" aria-label="??????? ????????">
            <button
              type="button"
              className="nav-btn"
              onClick={togglePlayersDrawer}
              disabled={!showPlayersDrawer}
              aria-expanded={playersDrawerOpen ? "true" : "false"}
            >
              <span>??????</span>
              <strong>{players.length}</strong>
            </button>
            <button
              type="button"
              className="nav-btn"
              onClick={() => setCfgOpen(true)}
              disabled={!isOwner}
            >
              <span>?????????</span>
            </button>
            <button
              type="button"
              className="nav-btn"
              onClick={copyRoomCode}
            >
              <span>???</span>
            </button>
          </footer>
        </>
      ) : connecting ? (
        <section className="auction-card muted floating-hint">
          <div className="auction-hint">???????????? ? ???????...</div>
        </section>
      ) : (
        <section
          className="mf-menu v2 auction-menu"
          aria-label="???? ????????????? ? ????????"
        >
          <header className="mf-menu-hero" role="banner">
            <button
              type="button"
              className="mf-icon-button mf-menu-close"
              onClick={handleExit}
              aria-label="????? ?? ????"
            >
              ?
            </button>

            <div className="mf-menu-logo">AUCTION</div>
            <p className="mf-menu-tagline">
              ???????????? ???? ??????? ?????? ? ????????? ??????????? ?????????
            </p>
          </header>

          <div
            className="mf-menu-actions"
            role="group"
            aria-label="??????? ???????? ? ????????"
          >
            <div className="mf-join-inline">
              <label htmlFor="auction-join-code" className="sr-only">
                ??? ???????
              </label>
              <input
                id="auction-join-code"
                className="mf-input big"
                placeholder="??? ???????"
                inputMode="text"
                maxLength={8}
                pattern="[A-HJKMNPQRSTUVWXYZ23456789]{4,8}"
                title="4?8 ????????: A-H J K M N P Q R S T U V W X Y Z 2?9"
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
                aria-label="????? ? ???????"
              >
                ????? ?????????
              </button>
            </div>

            {error && (
              <div className="mf-form-hint danger" role="alert">
                {error}
              </div>
            )}

            <button
              className="mf-btn primary xl mf-create-cta"
              type="button"
              onClick={createRoom}
              disabled={creating || joining}
              aria-label="??????? ????? ???????"
              title="??????? ????????? ???????"
            >
              ??????? ???????
            </button>
          </div>

          <section
            className="mf-menu-cards"
            aria-label="???????????? ????????"
          >
            <article className="mf-menu-card">
              <div className="ico" aria-hidden="true">
                ??
              </div>
              <div className="title">?????????? ?????</div>
              <p className="text">
                ????????? ??????? ?????? ??? ?????????. ???? ?????? ????????? ???????,
                ? ??????? ????? ???????????? ??? ??????????.
              </p>
            </article>
            <article className="mf-menu-card">
              <div className="ico" aria-hidden="true">
                ??
              </div>
              <div className="title">????????? ????????????</div>
              <p className="text">
                ??????? ???????????? ? ?????????? ?? ???, ??? ?????? ???????
                ? ???????? ???? ? ????????? ??????.
              </p>
            </article>
            <article className="mf-menu-card">
              <div className="ico" aria-hidden="true">
                ??
              </div>
              <div className="title">??? ??????????</div>
              <p className="text">
                ????????? ????????????? ??? ????? ? ???????????? ?????? ? ??????? ??? ??????.
              </p>
            </article>
          </section>
        </section>
      )}

      <section className="auction-section">
        {toast && (
          <div
            className={`auction-toast ${toast.type || "info"}`}
            role="status"
            aria-live="polite"
          >
            {toast.text}
          </div>
        )}
      </section>
    </div>
  );
}
