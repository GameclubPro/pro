'use strict';

const { randomInt } = require('crypto');

/**
 * createAuctionEngine
 * @param {object} deps
 * @param prisma
 * @param withRoomLock (roomId, fn) => any
 * @param isLockError (err) => boolean
 * @param onState (publicState) => void  // опционально: удобно для пуш-нотификаций в сокетах
 */
function createAuctionEngine({ prisma, withRoomLock, isLockError, onState } = {}) {
  if (!prisma) {
    throw new Error('createAuctionEngine: prisma is required');
  }

  // Аналог withRoomLock из mafia-engine, но опционально.
  const lock = typeof withRoomLock === 'function'
    ? withRoomLock
    : async (_roomId, fn) => fn();

  const isLockErr = typeof isLockError === 'function'
    ? isLockError
    : () => false;

  const DEFAULT_RULES = Object.freeze({
    initialBalance: 1_000_000,
    maxSlots: 30,
    timePerSlotSec: 9, // по умолчанию: счёт 3–2–1, каждые ~3 секунды
  });

  const LOT_ITEMS = [
    '🏠 Вилла у моря',
    '🚗 Спортивный суперкар',
    '💎 Алмазное кольцо',
    '🖼 Картина неизвестного гения',
    '⌚️ Часы премиум-класса',
    '🏰 Небольшой замок',
    '🎸 Гитара рок-звезды',
    '📱 Прототип смартфона будущего',
  ];

  const LOOTBOX_ITEMS = [
    '🎁 Малый лутбокс',
    '🎁 Средний лутбокс',
    '🎁 Большой лутбокс',
    '🎁 Мистический лутбокс',
  ];

  // roomId -> in-memory state
  const states = new Map();
  // roomId -> timer handle
  const timers = new Map();
  // roomId -> preset { rules?, slots? }
  const presets = new Map();

  async function getRoomWithPlayers(code) {
    if (!code) return null;
    return prisma.room.findUnique({
      where: { code },
      include: {
        players: {
          include: { user: true },
          orderBy: { joinedAt: 'asc' },
        },
      },
    });
  }

  function createSlots(max = DEFAULT_RULES.maxSlots) {
    const slots = [];
    for (let i = 0; i < max; i++) {
      const isLoot = Math.random() < 0.3;
      if (isLoot) {
        slots.push({
          index: i,
          type: 'lootbox',
          name: LOOTBOX_ITEMS[randomInt(0, LOOTBOX_ITEMS.length)],
          basePrice: randomInt(50_000, 200_001),
        });
      } else {
        slots.push({
          index: i,
          type: 'lot',
          name: LOT_ITEMS[randomInt(0, LOT_ITEMS.length)],
          basePrice: randomInt(80_000, 350_001),
        });
      }
    }
    return slots;
  }

  function applyLootboxEffect(state, winnerId) {
    const roll = Math.random();
    if (roll < 0.4) {
      const bonus = randomInt(50_000, 250_001);
      state.balances[winnerId] = (state.balances[winnerId] || 0) + bonus;
      return { kind: 'money', delta: bonus };
    }
    if (roll < 0.8) {
      const loss = randomInt(50_000, 200_001);
      const prev = state.balances[winnerId] || 0;
      state.balances[winnerId] = Math.max(0, prev - loss);
      return { kind: 'penalty', delta: -loss };
    }
    return { kind: 'empty', delta: 0 };
  }

  function roomPlayersList(room) {
    if (!room || !Array.isArray(room.players)) return [];
    return room.players.filter((p) => p && p.id != null);
  }

  function normalizeParticipants(state, room) {
    const roomPlayers = roomPlayersList(room);
    const roomPlayerIds = new Set(roomPlayers.map((p) => p.id));

    // ленивое создание структур корзин (на случай старого состояния)
    if (!state.baskets) state.baskets = {};
    if (!state.basketTotals) state.basketTotals = {};

    // фильтруем активных по реально существующим игрокам
    state.activePlayerIds = state.activePlayerIds.filter((pid) =>
      roomPlayerIds.has(pid)
    );

    // чистим балансы и ставки от уже несуществующих игроков
    for (const key of Object.keys(state.balances)) {
      const pid = Number(key);
      if (!roomPlayerIds.has(pid)) {
        delete state.balances[pid];
        delete state.currentBids[pid];
      }
    }

    // чистим корзины и суммы от уже несуществующих игроков
    for (const key of Object.keys(state.baskets)) {
      const pid = Number(key);
      if (!roomPlayerIds.has(pid)) {
        delete state.baskets[pid];
      }
    }
    for (const key of Object.keys(state.basketTotals)) {
      const pid = Number(key);
      if (!roomPlayerIds.has(pid)) {
        delete state.basketTotals[pid];
      }
    }

    // если после чистки активных не осталось, но есть балансы — восстановим их из балансов
    if (!state.activePlayerIds.length) {
      const fromBalances = Object.keys(state.balances)
        .map((k) => Number(k))
        .filter((pid) => roomPlayerIds.has(pid));
      if (fromBalances.length) {
        state.activePlayerIds = fromBalances;
      }
    }
  }

  function computeWinners(state) {
    if (!state.activePlayerIds.length) return [];
    const balancesList = state.activePlayerIds.map(
      (pid) => state.balances[pid] || 0
    );
    const maxBalance = balancesList.length
      ? Math.max(...balancesList)
      : 0;
    return state.activePlayerIds.filter(
      (pid) => (state.balances[pid] || 0) === maxBalance
    );
  }

  function clearTimer(roomId) {
    const t = timers.get(roomId);
    if (t) {
      try { clearTimeout(t); } catch {}
      timers.delete(roomId);
    }
  }

  function scheduleTimer(state) {
    clearTimer(state.roomId);
    if (state.phase !== 'in_progress') {
      state.slotDeadlineAtMs = null;
      return;
    }
    if (!state.activePlayerIds || state.activePlayerIds.length === 0) {
      state.slotDeadlineAtMs = null;
      return;
    }
    const sec = Number(state.rules?.timePerSlotSec || 0);
    if (!Number.isFinite(sec) || sec <= 0) {
      state.slotDeadlineAtMs = null;
      return;
    }
    state.slotDeadlineAtMs = Date.now() + sec * 1000;
    const handle = setTimeout(() => {
      // безопасно завершаем слот по таймеру
      finalizeByTimer(state.roomId).catch(() => {});
    }, sec * 1000 + 25);
    timers.set(state.roomId, handle);
  }

  async function finalizeByTimer(roomId) {
    try {
      await lock(roomId, async () => {
        const state = states.get(roomId);
        if (!state || state.phase !== 'in_progress') return;
        const room = await prisma.room.findUnique({
          where: { id: roomId },
          include: {
            players: { include: { user: true }, orderBy: { joinedAt: 'asc' } },
          },
        });
        if (!room) return;
        // финалим слот на основании имеющихся ставок (кто не поставил — считается пас)
        const publicState = resolveSlotNow(state, room);
        if (state.phase === 'in_progress') {
          scheduleTimer(state);
        } else {
          clearTimer(state.roomId);
        }
        if (onState && publicState) onState(publicState);
      });
    } catch (e) {
      if (isLockErr(e)) return;
      throw e;
    }
  }

  function ensureConsistentPhase(state) {
    if (state.phase !== 'in_progress') return;

    if (!state.activePlayerIds.length) {
      state.phase = 'finished';
      state.winners = [];
      state.slotDeadlineAtMs = null;
      state.pauseLeftMs = null;
      return;
    }

    const noMoneyLeft =
      state.activePlayerIds.length > 0 &&
      state.activePlayerIds.every((pid) => (state.balances[pid] || 0) <= 0);

    const outOfSlots =
      state.slotsPlayed >= state.slots.length ||
      state.currentIndex < 0 ||
      state.currentIndex >= state.slots.length;

    if (noMoneyLeft || outOfSlots) {
      state.phase = 'finished';
      state.winners = computeWinners(state);
    }
  }

  function buildPublicState(state, room) {
    // подчищаем связь с комнатой и фазу перед отдачей наружу
    normalizeParticipants(state, room);
    ensureConsistentPhase(state);

    const roomPlayers = roomPlayersList(room);
    const players = roomPlayers.map((p) => {
      const name =
        p.user?.firstName ||
        p.user?.username ||
        `Игрок ${p.id}`;
      return {
        id: p.id,
        userId: p.userId,
        name,
        active: state.activePlayerIds.includes(p.id),
        balance: state.balances[p.id] ?? null,
      };
    });

    let currentSlot = null;
    if (
      state.phase === 'in_progress' &&
      state.currentIndex >= 0 &&
      state.currentIndex < state.slots.length
    ) {
      const s = state.slots[state.currentIndex];
      currentSlot = {
        index: s.index,
        type: s.type,
        name: s.name,
        basePrice: s.basePrice,
      };
    }

    // публичные корзины игроков
    const baskets = {};
    for (const [pidStr, items] of Object.entries(state.baskets || {})) {
      baskets[pidStr] = (items || []).map((it) => ({
        index: it.index,
        type: it.type,
        name: it.name,
        basePrice: it.basePrice,
        paid: it.paid,
        value: it.value,
        effect: it.effect || null,
      }));
    }

    return {
      code: state.code,
      phase: state.phase,
      paused: !!state.paused,
      rules: {
        timePerSlotSec: state.rules?.timePerSlotSec || DEFAULT_RULES.timePerSlotSec,
        maxSlots: state.rules?.maxSlots || state.slots.length || DEFAULT_RULES.maxSlots,
        initialBalance: state.rules?.initialBalance || DEFAULT_RULES.initialBalance,
      },
      players,
      balances: { ...state.balances },
      currentBids: { ...state.currentBids },
      baskets,
      basketTotals: { ...(state.basketTotals || {}) },
      slotsPlayed: state.slotsPlayed,
      maxSlots: state.slots.length,
      currentSlotIndex: currentSlot ? currentSlot.index : null,
      currentSlot,
      history: state.history.map((h) => ({
        index: h.index,
        type: h.type,
        name: h.name,
        winnerPlayerId: h.winnerPlayerId,
        winBid: h.winBid,
        effect: h.effect || null,
      })),
      winners: state.winners || [],
      timeLeftMs: state.paused
        ? state.pauseLeftMs ?? null
        : state.slotDeadlineAtMs != null
          ? Math.max(0, state.slotDeadlineAtMs - Date.now())
          : null,
      bidFeed: Array.isArray(state.bidFeed) ? state.bidFeed.slice(-8) : [],
    };
  }

  function resolveSlotIfReady(state, room) {
    if (state.phase !== 'in_progress') return null;

    normalizeParticipants(state, room);

    // если активных нет — аккуратно завершаем игру
    if (!state.activePlayerIds.length) {
      state.phase = 'finished';
      state.winners = [];
      return buildPublicState(state, room);
    }

    if (
      state.currentIndex < 0 ||
      state.currentIndex >= state.slots.length
    ) {
      ensureConsistentPhase(state);
      return buildPublicState(state, room);
    }

    const activeAlive = state.activePlayerIds.filter(
      (pid) => (state.balances[pid] || 0) > 0
    );
    const needFrom = activeAlive.length ? activeAlive : state.activePlayerIds;

    const allHaveBids = needFrom.every((pid) =>
      Object.prototype.hasOwnProperty.call(state.currentBids, pid)
    );
    if (!allHaveBids) return null;

    return resolveSlotNow(state, room);
  }

  function resolveSlotNow(state, room) {
    if (state.phase !== 'in_progress') return buildPublicState(state, room);
    if (state.currentIndex < 0 || state.currentIndex >= state.slots.length) {
      ensureConsistentPhase(state);
      return buildPublicState(state, room);
    }

    const slotIndex = state.currentIndex;
    const slot = state.slots[slotIndex];

    // на всякий случай
    if (!state.baskets) state.baskets = {};
    if (!state.basketTotals) state.basketTotals = {};

    let winnerId = null;
    let maxBid = 0;

    for (const pid of state.activePlayerIds) {
      const bid = Number(state.currentBids[pid] ?? 0);
      if (bid > maxBid) {
        maxBid = bid;
        winnerId = pid;
      }
    }

    let effect = null;
    if (winnerId && maxBid > 0) {
      const balance = state.balances[winnerId] || 0;
      state.balances[winnerId] = Math.max(0, balance - maxBid);
      if (slot.type === 'lootbox') {
        effect = applyLootboxEffect(state, winnerId);
      }

      // обновляем корзину победителя
      const base = Number(slot.basePrice) || 0;
      let value = base;

      // для лутбокса учитываем рандомный эффект (может быть штрафом)
      if (slot.type === 'lootbox') {
        const delta = (effect && typeof effect.delta === 'number')
          ? effect.delta
          : 0;
        value = Math.max(0, base + delta);
      }

      if (!state.baskets[winnerId]) state.baskets[winnerId] = [];
      state.baskets[winnerId].push({
        index: slotIndex,
        type: slot.type,
        name: slot.name,
        basePrice: base,
        paid: maxBid,
        value,
        effect: effect || null,
      });
      state.basketTotals[winnerId] =
        (state.basketTotals[winnerId] || 0) + value;
    }

    state.history.push({
      index: slotIndex,
      type: slot.type,
      name: slot.name,
      winnerPlayerId: winnerId || null,
      winBid: maxBid,
      effect,
    });

    state.slotsPlayed += 1;
    state.currentIndex += 1;
    state.currentBids = {};
    state.slotDeadlineAtMs = null;
    state.bidFeed = [];

    const everyoneBroke = state.activePlayerIds.every(
      (pid) => (state.balances[pid] || 0) <= 0
    );
    const finishedBySlots = state.slotsPlayed >= state.slots.length;

    if (everyoneBroke || finishedBySlots) {
      state.phase = 'finished';
      state.winners = computeWinners(state);
    }

    return buildPublicState(state, room);
  }

  async function start(code, starterUserId) {
    const room = await getRoomWithPlayers(code);
    if (!room) return { ok: false, error: 'room_not_found' };

    const exec = async () => {
      if (room.ownerId !== starterUserId) {
        return { ok: false, error: 'forbidden_not_owner' };
      }

      const roomPlayers = roomPlayersList(room);
      if (roomPlayers.length < 2) {
        return { ok: false, error: 'need_at_least_2_players' };
      }

      const existing = states.get(room.id);
      if (existing && existing.phase === 'in_progress') {
        return { ok: false, error: 'already_started' };
      }

      // участники — все «готовые» + владелец
      const participants = roomPlayers.filter(
        (p) => p.ready || p.userId === room.ownerId
      );
      if (participants.length < 2) {
        return { ok: false, error: 'need_ready_players' };
      }

      const preset = presets.get(room.id) || {};
      const rules = {
        ...DEFAULT_RULES,
        ...(preset.rules || {}),
      };

      const balances = {};
      const activeIds = [];
      for (const p of participants) {
        balances[p.id] = rules.initialBalance ?? DEFAULT_RULES.initialBalance;
        activeIds.push(p.id);
      }

      const state = {
        roomId: room.id,
        code: room.code,
        phase: 'in_progress',
        rules,
        slots: Array.isArray(preset.slots) && preset.slots.length
          ? preset.slots.map((s, i) => ({
              index: i,
              type: s.type === 'lootbox' ? 'lootbox' : 'lot',
              name: String(s.name || `Лот ${i + 1}`),
              basePrice: Number.isFinite(Number(s.basePrice))
                ? Math.max(0, Math.floor(Number(s.basePrice)))
                : randomInt(80_000, 350_001),
            }))
          : createSlots(rules.maxSlots || DEFAULT_RULES.maxSlots),
        currentIndex: 0,
        slotsPlayed: 0,
        balances,
        activePlayerIds: activeIds,
        currentBids: {},
        history: [],
        baskets: {},
        basketTotals: {},
        winners: [],
        paused: false,
        pauseLeftMs: null,
        slotDeadlineAtMs: null,
        bidFeed: [],
      };

      states.set(room.id, state);

      // таймер на первый слот (если включён)
      scheduleTimer(state);

      const pub = buildPublicState(state, room);
      if (onState) onState(pub);
      return {
        ok: true,
        state: pub,
      };
    };

    try {
      return await lock(room.id, exec);
    } catch (e) {
      if (isLockErr(e)) {
        return { ok: false, error: 'concurrent_operation' };
      }
      throw e;
    }
  }

  async function bid(code, userId, amount) {
    const room = await getRoomWithPlayers(code);
    if (!room) return { ok: false, error: 'room_not_found' };

    const exec = async () => {
      const state = states.get(room.id);
      if (!state || state.phase !== 'in_progress') {
        return { ok: false, error: 'not_running' };
      }
      if (state.paused) {
        return { ok: false, error: 'paused' };
      }

      const player = roomPlayersList(room).find((p) => p.userId === userId);
      if (!player) return { ok: false, error: 'not_player' };

      const pid = player.id;
      if (!Object.prototype.hasOwnProperty.call(state.balances, pid)) {
        return { ok: false, error: 'not_participant' };
      }

      let clean = Number(amount);
      if (!Number.isFinite(clean) || clean < 0) {
        return { ok: false, error: 'bad_amount' };
      }
      clean = Math.floor(clean);

      const balance = state.balances[pid] || 0;
      if (clean > balance) {
        return { ok: false, error: 'not_enough_money' };
      }

      const slot = state.slots[state.currentIndex];
      if (slot && slot.basePrice > 0 && clean > 0 && clean < slot.basePrice) {
        return { ok: false, error: 'bid_below_base' };
      }

      // сохраняем ставку
      state.currentBids[pid] = clean;
      if (!Array.isArray(state.bidFeed)) state.bidFeed = [];
      state.bidFeed.push({ id: `${pid}-${Date.now()}`, playerId: pid, amount: clean });
      if (state.bidFeed.length > 16) {
        state.bidFeed = state.bidFeed.slice(-16);
      }

      const publicState =
        resolveSlotIfReady(state, room) ||
        buildPublicState(state, room);

      // если слот закрылся — запланируем таймер следующего слота
      if (state.phase === 'in_progress') {
        // если развязка наступила раньше таймера — перезапускаем под новый слот
        scheduleTimer(state);
      } else {
        clearTimer(state.roomId);
      }

      if (onState && publicState) onState(publicState);
      return { ok: true, state: publicState };
    };

    try {
      return await lock(room.id, exec);
    } catch (e) {
      if (isLockErr(e)) {
        return { ok: false, error: 'concurrent_operation' };
      }
      throw e;
    }
  }

  async function getState(code) {
    const room = await getRoomWithPlayers(code);
    if (!room) return null;
    const state = states.get(room.id);
    if (!state) return null;
    return buildPublicState(state, room);
  }

  function clearRoomStateById(roomId) {
    states.delete(roomId);
    clearTimer(roomId);
  }

  /**
   * Доп. хелпер: вызывать при выходе игрока из комнаты,
   * чтобы он не блокировал раунд ставками.
   */
  function removePlayerFromAuction(roomId, roomPlayerId) {
    const state = states.get(roomId);
    if (!state) return;
    const pid = Number(roomPlayerId);
    state.activePlayerIds = state.activePlayerIds.filter((id) => id !== pid);
    delete state.balances[pid];
    delete state.currentBids[pid];
    if (state.baskets) {
      delete state.baskets[pid];
    }
    if (state.basketTotals) {
      delete state.basketTotals[pid];
    }
    if (!state.activePlayerIds.length) {
      state.phase = 'finished';
      state.winners = [];
      state.slotDeadlineAtMs = null;
      clearTimer(roomId);
    } else {
      ensureConsistentPhase(state);
      if (state.phase !== 'in_progress') {
        clearTimer(roomId);
      }
    }
  }

  async function configure(code, userId, payload = {}) {
    const room = await getRoomWithPlayers(code);
    if (!room) return { ok: false, error: 'room_not_found' };
    if (room.ownerId !== userId) return { ok: false, error: 'forbidden_not_owner' };
    // запрещаем менять настройки «на лету»
    if (states.get(room.id)?.phase === 'in_progress') {
      return { ok: false, error: 'forbidden_running' };
    }

    const safeRules = {};
    const r = payload.rules || {};
    if (r.timePerSlotSec != null) {
      const v = Math.max(5, Math.min(120, Number(r.timePerSlotSec) || 25));
      safeRules.timePerSlotSec = v;
    }
    if (r.maxSlots != null) {
      const v = Math.max(1, Math.min(60, Number(r.maxSlots) || 30));
      safeRules.maxSlots = v;
    }
    if (r.initialBalance != null) {
      const v = Math.max(1_000, Math.min(10_000_000, Number(r.initialBalance) || DEFAULT_RULES.initialBalance));
      safeRules.initialBalance = v;
    }

    const safeSlots = Array.isArray(payload.slots)
      ? payload.slots
          .slice(0, 60)
          .map((s) => ({
            type: s.type === 'lootbox' ? 'lootbox' : 'lot',
            name: String(s.name || '').slice(0, 120) || 'Лот',
            basePrice: Number.isFinite(Number(s.basePrice))
              ? Math.max(0, Math.floor(Number(s.basePrice)))
              : undefined,
          }))
      : [];

    presets.set(room.id, {
      rules: safeRules,
      slots: safeSlots,
    });

    return { ok: true };
  }

  async function pause(code, userId) {
    const room = await getRoomWithPlayers(code);
    if (!room) return { ok: false, error: 'room_not_found' };
    if (room.ownerId !== userId) return { ok: false, error: 'forbidden_not_owner' };

    return lock(room.id, async () => {
      const state = states.get(room.id);
      if (!state || state.phase !== 'in_progress') {
        return { ok: false, error: 'not_running' };
      }
      if (state.paused) {
        return { ok: true, state: buildPublicState(state, room) };
      }

      state.paused = true;
      state.pauseLeftMs = state.slotDeadlineAtMs != null
        ? Math.max(0, state.slotDeadlineAtMs - Date.now())
        : null;
      clearTimer(state.roomId);

      const pub = buildPublicState(state, room);
      if (onState) onState(pub);
      return { ok: true, state: pub };
    });
  }

  async function resume(code, userId) {
    const room = await getRoomWithPlayers(code);
    if (!room) return { ok: false, error: 'room_not_found' };
    if (room.ownerId !== userId) return { ok: false, error: 'forbidden_not_owner' };

    return lock(room.id, async () => {
      const state = states.get(room.id);
      if (!state || state.phase !== 'in_progress') {
        return { ok: false, error: 'not_running' };
      }
      if (!state.paused) {
        return { ok: true, state: buildPublicState(state, room) };
      }

      state.paused = false;
      if (state.pauseLeftMs != null) {
        const left = Math.max(1000, state.pauseLeftMs);
        state.slotDeadlineAtMs = Date.now() + left;
        clearTimer(state.roomId);
        const handle = setTimeout(() => {
          finalizeByTimer(state.roomId).catch(() => {});
        }, left + 25);
        timers.set(state.roomId, handle);
      } else {
        scheduleTimer(state);
      }

      const pub = buildPublicState(state, room);
      if (onState) onState(pub);
      return { ok: true, state: pub };
    });
  }

  async function next(code, userId) {
    const room = await getRoomWithPlayers(code);
    if (!room) return { ok: false, error: 'room_not_found' };
    if (room.ownerId !== userId) return { ok: false, error: 'forbidden_not_owner' };

    return lock(room.id, async () => {
      const state = states.get(room.id);
      if (!state || state.phase !== 'in_progress') {
        return { ok: false, error: 'not_running' };
      }

      const pub = resolveSlotNow(state, room);

      if (state.phase === 'in_progress') {
        scheduleTimer(state);
      } else {
        clearTimer(state.roomId);
      }

      if (onState) onState(pub);
      return { ok: true, state: pub };
    });
  }

  return {
    start,
    bid,
    getState,
    clearRoomStateById,
    removePlayerFromAuction,
    configure,
    pause,
    resume,
    next,
  };
}

module.exports = { createAuctionEngine };

