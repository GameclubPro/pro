'use strict';

const { randomInt } = require('crypto');
const { RoomGame } = require('@prisma/client');

const COUNTDOWN_START_FROM = 3;
const COUNTDOWN_STEP_MS = 4_000;
const LOOTBOX_REVEAL_MS = 6_200;

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
    timePerSlotSec: COUNTDOWN_START_FROM * (COUNTDOWN_STEP_MS / 1000), // full window before auto-close
  });

  const FALLBACK_LOT_ITEMS = [
    {
      name: '🚗 ВАЗ-2107',
      imageUrl: 'https://s3.regru.cloud/box/auction/auto/VAZ2107.png',
      basePrice: 120_000,
      nominalPrice: 180_000,
    },
    '🏠 Вилла у моря',
    '🚗 Спортивный суперкар',
    '💎 Алмазное кольцо',
    '🖼 Картина неизвестного гения',
    '⌚️ Часы премиум-класса',
    '🏰 Небольшой замок',
    '🎸 Гитара рок-звезды',
    '📱 Прототип смартфона будущего',
  ];
  const FALLBACK_LOT_CATALOG = FALLBACK_LOT_ITEMS.map((entry) => {
    const isString = typeof entry === 'string';
    const name = isString ? entry : String(entry?.name || '').trim();
    const basePrice = isString
      ? null
      : Number.isFinite(Number(entry?.basePrice))
        ? Math.max(0, Math.floor(Number(entry.basePrice)))
        : null;
    const nominalPrice = isString
      ? null
      : Number.isFinite(Number(entry?.nominalPrice))
        ? Math.max(0, Math.floor(Number(entry.nominalPrice)))
        : null;
    const imageUrl = isString
      ? null
      : entry?.imageUrl
        ? String(entry.imageUrl).trim()
        : null;
    return {
      id: null,
      name: name || 'Приз',
      basePrice,
      nominalPrice,
      imageUrl,
      categoryId: null,
    };
  });

  const LOOTBOX_RARITIES = [
    { code: 'F', label: 'Обычный' },
    { code: 'E', label: 'Необычный' },
    { code: 'D', label: 'Редкий' },
    { code: 'C', label: 'Эпический' },
    { code: 'B', label: 'Легендарный' },
    { code: 'A', label: 'Мифический' },
    { code: 'S', label: 'Божественный' },
  ];

  const REGULAR_LOOTBOX_RARITY = 'F';
  const REGULAR_LOOTBOX_NAME_HINT = 'Обычный лутбокс';

  const LOOTBOX_PRIZES = Object.freeze({
    money: [
      { emoji: '💰', name: 'Мешок денег' },
      { emoji: '💎', name: 'Алмазная находка' },
      { emoji: '🏦', name: 'Банковский чек' },
      { emoji: '🪙', name: 'Горсть монет' },
      { emoji: '📈', name: 'Инвестиция выстрелила' },
    ],
    penalty: [
      { emoji: '💸', name: 'Налоговый штраф' },
      { emoji: '🕳️', name: 'Чёрная дыра' },
      { emoji: '🧾', name: 'Неожиданный счёт' },
      { emoji: '💣', name: 'Бомба' },
      { emoji: '🧯', name: 'Пожарные расходы' },
    ],
    empty: [
      { emoji: '🕸️', name: 'Паутина' },
      { emoji: '🥲', name: 'Пусто' },
      { emoji: '🫥', name: 'Ничего' },
      { emoji: '📦', name: 'Пустая коробка' },
    ],
  });

  function pickLootboxPrize(kind) {
    const list = LOOTBOX_PRIZES?.[kind] || LOOTBOX_PRIZES.empty;
    const safe = Array.isArray(list) && list.length ? list : LOOTBOX_PRIZES.empty;
    return safe[randomInt(0, safe.length)];
  }

  function normalizeLootboxRarity(value) {
    const code = String(value || '').trim().toUpperCase();
    const found = LOOTBOX_RARITIES.find((r) => r.code === code);
    return found ? found.code : null;
  }

  function lootboxRarityLabel(code) {
    const found = LOOTBOX_RARITIES.find((r) => r.code === code);
    return found ? found.label : 'Обычный';
  }

  function pickLootboxRarity() {
    return LOOTBOX_RARITIES[randomInt(0, LOOTBOX_RARITIES.length)];
  }

  function isRegularLootbox(slot) {
    const rarity = normalizeLootboxRarity(slot?.rarity);
    if (rarity) return rarity === REGULAR_LOOTBOX_RARITY;
    const name = String(slot?.name || '');
    return name.includes(REGULAR_LOOTBOX_NAME_HINT);
  }

  function parseEmojiAndName(label) {
    const raw = String(label || '').trim();
    const match = raw.match(/([\u{1F300}-\u{1FAFF}])/u);
    const emoji = match?.[0] || '🎁';
    const name = raw ? raw.replace(match?.[0] || '', '').trim() : '';
    return {
      emoji,
      name: name || raw || 'Приз',
      fullName: raw || 'Приз',
    };
  }

  function normalizeLotRecord(raw) {
    const name = String(raw?.name || '').trim();
    if (!name) return null;
    const basePrice = Number.isFinite(Number(raw?.basePrice))
      ? Math.max(0, Math.floor(Number(raw.basePrice)))
      : null;
    const nominalPrice = Number.isFinite(Number(raw?.nominalPrice))
      ? Math.max(0, Math.floor(Number(raw.nominalPrice)))
      : null;
    const imageUrlRaw = raw?.imageUrl != null ? String(raw.imageUrl).trim() : '';
    const imageUrl = imageUrlRaw ? imageUrlRaw.slice(0, 500) : null;
    const categoryId = Number.isFinite(Number(raw?.categoryId))
      ? Number(raw.categoryId)
      : null;
    const lotId = Number.isFinite(Number(raw?.id ?? raw?.lotId))
      ? Number(raw.id ?? raw.lotId)
      : null;
    return { id: lotId, name, basePrice, nominalPrice, imageUrl, categoryId };
  }

  function pickRandomLotFromCatalog(lotCatalog) {
    const list = Array.isArray(lotCatalog) ? lotCatalog.filter(Boolean) : [];
    if (!list.length) return null;
    return list[randomInt(0, list.length)];
  }

  async function loadLotCatalog(preset = {}) {
    if (!prisma?.auctionLot?.findMany) return FALLBACK_LOT_CATALOG;

    const rawSlugs = Array.isArray(preset.lotCategorySlugs)
      ? preset.lotCategorySlugs
      : Array.isArray(preset.lotCategories)
        ? preset.lotCategories
        : [];
    const categorySlugs = rawSlugs
      .map((s) => String(s || '').trim().toLowerCase())
      .filter(Boolean)
      .slice(0, 40);

    const rawIds = Array.isArray(preset.lotCategoryIds)
      ? preset.lotCategoryIds
      : [];
    const categoryIds = rawIds
      .map((v) => Number(v))
      .filter((v) => Number.isFinite(v) && v > 0)
      .slice(0, 40);

    const where = { active: true };
    if (categoryIds.length) {
      where.categoryId = { in: categoryIds };
    } else if (categorySlugs.length) {
      where.category = { slug: { in: categorySlugs } };
    }

    try {
      const rows = await prisma.auctionLot.findMany({
        where,
        select: {
          id: true,
          name: true,
          basePrice: true,
          nominalPrice: true,
          imageUrl: true,
          categoryId: true,
        },
      });
      const normalized = rows.map(normalizeLotRecord).filter(Boolean);
      return normalized.length ? normalized : FALLBACK_LOT_CATALOG;
    } catch {
      return FALLBACK_LOT_CATALOG;
    }
  }

  function pickRegularLootboxPrizeLot(state) {
    const sourceSlots = Array.isArray(state?.slots) ? state.slots : [];
    const slotLots = sourceSlots.filter((s) => s && s.type === 'lot' && s.name);
    const pickedSlot = slotLots.length
      ? slotLots[randomInt(0, slotLots.length)]
      : null;
    const picked =
      normalizeLotRecord(pickedSlot) ||
      pickRandomLotFromCatalog(state?.lotCatalog) ||
      pickRandomLotFromCatalog(FALLBACK_LOT_CATALOG);
    const fallbackEntry = FALLBACK_LOT_ITEMS[randomInt(0, FALLBACK_LOT_ITEMS.length)];
    const fallbackName =
      typeof fallbackEntry === 'string'
        ? fallbackEntry
        : String(fallbackEntry?.name || '').trim();
    const safeName = picked?.name || fallbackName || 'Лот';
    const basePrice = Number.isFinite(Number(picked?.basePrice))
      ? Math.max(0, Math.floor(Number(picked.basePrice)))
      : randomInt(80_000, 350_001);

    return {
      ...parseEmojiAndName(safeName),
      basePrice,
      nominalPrice: null,
      imageUrl: picked?.imageUrl || null,
      lotId: picked?.id ?? null,
      categoryId: picked?.categoryId ?? null,
    };
  }

  // roomId -> in-memory state
  const states = new Map();
  // roomId -> timer handle
  const timers = new Map();
  // roomId -> lootbox reveal timer handle
  const revealTimers = new Map();
  // roomId -> preset { rules?, slots? }
  const presets = new Map();

  async function getRoomWithPlayers(code) {
    if (!code) return null;
    return prisma.room.findFirst({
      where: { code, game: RoomGame.AUCTION },
      include: {
        players: {
          include: { user: true },
          orderBy: { joinedAt: 'asc' },
        },
      },
    });
  }

  function createSlots(max = DEFAULT_RULES.maxSlots, lotCatalog = []) {
    const slots = [];
    const safeCatalog =
      Array.isArray(lotCatalog) && lotCatalog.length ? lotCatalog : FALLBACK_LOT_CATALOG;

    for (let i = 0; i < max; i++) {
      const isLoot = Math.random() < 0.3;
      if (isLoot) {
        const rarity = pickLootboxRarity();
        slots.push({
          index: i,
          type: 'lootbox',
          rarity: rarity.code,
          name: `${rarity.label} лутбокс`,
          basePrice: randomInt(50_000, 200_001),
        });
      } else {
        const picked = pickRandomLotFromCatalog(safeCatalog);
        const name = picked?.name || `Лот ${i + 1}`;
        const basePrice = Number.isFinite(Number(picked?.basePrice))
          ? Math.max(0, Math.floor(Number(picked.basePrice)))
          : randomInt(80_000, 350_001);
        const nominalPrice = Number.isFinite(Number(picked?.nominalPrice))
          ? Math.max(0, Math.floor(Number(picked.nominalPrice)))
          : null;

        slots.push({
          index: i,
          type: 'lot',
          name,
          basePrice,
          nominalPrice,
          imageUrl: picked?.imageUrl || null,
          lotId: picked?.id ?? null,
          categoryId: picked?.categoryId ?? null,
        });
      }
    }
    return slots;
  }

  function applyLootboxEffect(state, winnerId, slot) {
    if (isRegularLootbox(slot)) {
      return { kind: 'lot', delta: 0, prize: pickRegularLootboxPrizeLot(state) };
    }

    const roll = Math.random();
    if (roll < 0.4) {
      const bonus = randomInt(50_000, 250_001);
      state.balances[winnerId] = (state.balances[winnerId] || 0) + bonus;
      return { kind: 'money', delta: bonus, prize: pickLootboxPrize('money') };
    }
    if (roll < 0.8) {
      const loss = randomInt(50_000, 200_001);
      const prev = state.balances[winnerId] || 0;
      state.balances[winnerId] = Math.max(0, prev - loss);
      return { kind: 'penalty', delta: -loss, prize: pickLootboxPrize('penalty') };
    }
    return { kind: 'empty', delta: 0, prize: pickLootboxPrize('empty') };
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

  function playerNetWorth(state, playerId) {
    const balance = Number(state.balances?.[playerId] || 0);
    const basket = Number(state.basketTotals?.[playerId] || 0);
    return balance + basket;
  }

  function computeWinners(state) {
    if (!state.activePlayerIds.length) return [];
    let maxWorth = -Infinity;
    const winners = [];
    for (const pid of state.activePlayerIds) {
      const worth = playerNetWorth(state, pid);
      if (worth > maxWorth) {
        maxWorth = worth;
        winners.length = 0;
        winners.push(pid);
      } else if (worth === maxWorth) {
        winners.push(pid);
      }
    }
    return winners;
  }

  function clearTimer(roomId) {
    const t = timers.get(roomId);
    if (t) {
      try { clearTimeout(t); } catch {}
      timers.delete(roomId);
    }
  }

  function clearRevealTimer(roomId) {
    const t = revealTimers.get(roomId);
    if (t) {
      try { clearTimeout(t); } catch {}
      revealTimers.delete(roomId);
    }
  }

  async function advanceAfterReveal(roomId) {
    try {
      await lock(roomId, async () => {
        clearRevealTimer(roomId);
        const state = states.get(roomId);
        if (!state || state.phase !== 'in_progress') return;
        if ((state.slotPhase || 'bidding') !== 'reveal') return;

        state.slotPhase = 'bidding';
        ensureConsistentPhase(state);
        if (state.phase === 'in_progress' && !state.paused) {
          scheduleTimer(state);
        } else {
          clearTimer(state.roomId);
          state.slotDeadlineAtMs = null;
        }

        const room = await prisma.room.findUnique({
          where: { id: roomId },
          include: {
            players: { include: { user: true }, orderBy: { joinedAt: 'asc' } },
          },
        });
        if (!room || room.game !== RoomGame.AUCTION) return;
        const publicState = buildPublicState(state, room);
        if (onState && publicState) onState(publicState);
      });
    } catch (e) {
      if (isLockErr(e)) return;
      throw e;
    }
  }

  function startRevealPhase(state) {
    if (state.phase !== 'in_progress') return;
    state.slotPhase = 'reveal';
    state.slotDeadlineAtMs = null;
    clearTimer(state.roomId);
    clearRevealTimer(state.roomId);

    const roomId = state.roomId;
    const handle = setTimeout(() => {
      advanceAfterReveal(roomId).catch(() => {});
    }, LOOTBOX_REVEAL_MS + 25);
    revealTimers.set(roomId, handle);
  }

  function scheduleTimer(state) {
    clearTimer(state.roomId);
    if (state.phase !== 'in_progress') {
      state.slotDeadlineAtMs = null;
      return;
    }
    if ((state.slotPhase || 'bidding') !== 'bidding') {
      state.slotDeadlineAtMs = null;
      return;
    }
    if (state.paused) {
      state.slotDeadlineAtMs = null;
      return;
    }
    if (!state.activePlayerIds || state.activePlayerIds.length === 0) {
      state.slotDeadlineAtMs = null;
      return;
    }
    const durationMs = COUNTDOWN_START_FROM * COUNTDOWN_STEP_MS;
    state.slotDeadlineAtMs = Date.now() + durationMs;
    const handle = setTimeout(() => {
      // безопасно завершаем слот по таймеру
      finalizeByTimer(state.roomId).catch(() => {});
    }, durationMs + 25);
    timers.set(state.roomId, handle);
  }

  function scheduleAfterResolve(state) {
    if (state.phase !== 'in_progress') {
      clearTimer(state.roomId);
      clearRevealTimer(state.roomId);
      return;
    }
    if ((state.slotPhase || 'bidding') === 'reveal') {
      return;
    }
    clearRevealTimer(state.roomId);
    if (!state.paused) {
      scheduleTimer(state);
    } else {
      state.slotDeadlineAtMs = null;
      clearTimer(state.roomId);
    }
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
        if (!room || room.game !== RoomGame.AUCTION) return;
        // финалим слот на основании имеющихся ставок (кто не поставил — считается пас)
        resolveSlotNow(state, room);
        scheduleAfterResolve(state);
        const publicState = buildPublicState(state, room);
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
    const nowMs = Date.now();

    const roomPlayers = roomPlayersList(room);
    const netWorths = {};
    for (const pid of new Set([
      ...roomPlayers.map((p) => p.id),
      ...Object.keys(state.balances || {}).map((k) => Number(k)),
      ...Object.keys(state.basketTotals || {}).map((k) => Number(k)),
    ])) {
      if (!Number.isFinite(pid)) continue;
      netWorths[pid] = playerNetWorth(state, pid);
    }

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
        netWorth: netWorths[p.id] ?? null,
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
        rarity: s.rarity || null,
        basePrice: s.basePrice,
        nominalPrice: s.nominalPrice ?? null,
        imageUrl: s.imageUrl || null,
        lotId: s.lotId ?? null,
        categoryId: s.categoryId ?? null,
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
        nominalPrice: it.nominalPrice ?? null,
        imageUrl: it.imageUrl || null,
        lotId: it.lotId ?? null,
        categoryId: it.categoryId ?? null,
        paid: it.paid,
        value: it.value,
        effect: it.effect || null,
      }));
    }

    return {
      code: state.code,
      phase: state.phase,
      paused: !!state.paused,
      slotPhase: state.slotPhase || 'bidding',
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
      netWorths,
      slotsPlayed: state.slotsPlayed,
      maxSlots: state.slots.length,
      currentSlotIndex: currentSlot ? currentSlot.index : null,
      currentSlot,
      history: state.history.map((h) => ({
        index: h.index,
        type: h.type,
        name: h.name,
        rarity: h.rarity || null,
        nominalPrice: h.nominalPrice ?? null,
        imageUrl: h.imageUrl || null,
        lotId: h.lotId ?? null,
        categoryId: h.categoryId ?? null,
        winnerPlayerId: h.winnerPlayerId,
        winBid: h.winBid,
        effect: h.effect || null,
      })),
      winners: state.winners || [],
      timeLeftMs: state.paused
        ? state.pauseLeftMs ?? null
        : state.slotDeadlineAtMs != null
          ? Math.max(0, state.slotDeadlineAtMs - nowMs)
          : null,
      slotDeadlineAtMs: state.paused ? null : state.slotDeadlineAtMs || null,
      serverNowMs: nowMs,
      countdownStartFrom: COUNTDOWN_START_FROM,
      countdownStepMs: COUNTDOWN_STEP_MS,
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
    // основной сценарий: слот закрывается по таймеру, поэтому ждём тика таймера
    return null;
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
        effect = applyLootboxEffect(state, winnerId, slot);
      }

      // обновляем корзину победителя
      const base = Number(slot.basePrice) || 0;
      let value = base;
      let basketItemType = slot.type;
      let basketItemName = slot.name;
      let basketItemBasePrice = base;
      let basketItemNominalPrice = slot.nominalPrice ?? null;
      let basketItemImageUrl = slot.imageUrl || null;
      let basketItemLotId = slot.lotId ?? null;
      let basketItemCategoryId = slot.categoryId ?? null;

      // для лутбокса учитываем рандомный эффект (может быть штрафом)
      if (slot.type === 'lootbox') {
        if (effect && effect.kind === 'lot' && effect.prize) {
          const prizeBase = Number(effect.prize.basePrice);
          const prizeName = String(effect.prize.fullName || effect.prize.name || '').trim();
          const prizeImageUrl = effect.prize.imageUrl || null;
          const prizeLotId = effect.prize.lotId ?? null;
          const prizeCategoryId = effect.prize.categoryId ?? null;
          basketItemType = 'lot';
          basketItemName = prizeName || slot.name;
          basketItemBasePrice = Number.isFinite(prizeBase) ? prizeBase : base;
          basketItemNominalPrice = null;
          basketItemImageUrl = prizeImageUrl;
          basketItemLotId = prizeLotId;
          basketItemCategoryId = prizeCategoryId;
          value = basketItemBasePrice;
        } else {
          const delta = (effect && typeof effect.delta === 'number')
            ? effect.delta
            : 0;
          value = Math.max(0, base + delta);
        }
      }

      if (!state.baskets[winnerId]) state.baskets[winnerId] = [];
      state.baskets[winnerId].push({
        index: slotIndex,
        type: basketItemType,
        name: basketItemName,
        basePrice: basketItemBasePrice,
        nominalPrice: basketItemNominalPrice,
        imageUrl: basketItemImageUrl,
        lotId: basketItemLotId,
        categoryId: basketItemCategoryId,
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
      rarity: slot.rarity || null,
      nominalPrice: slot.nominalPrice ?? null,
      imageUrl: slot.imageUrl || null,
      lotId: slot.lotId ?? null,
      categoryId: slot.categoryId ?? null,
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

    const canContinue = !(everyoneBroke || finishedBySlots);
    if (!canContinue) {
      state.phase = 'finished';
      state.winners = computeWinners(state);
      state.slotPhase = 'bidding';
      clearRevealTimer(state.roomId);
    } else if (slot.type === 'lootbox' && effect) {
      startRevealPhase(state);
    } else {
      state.slotPhase = 'bidding';
      clearRevealTimer(state.roomId);
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

      const existing = states.get(room.id);
      if (existing && existing.phase === 'in_progress') {
        return { ok: false, error: 'already_started' };
      }

      // участники — все «готовые» + владелец
      const participants = roomPlayers.filter(
        (p) => p.ready || p.userId === room.ownerId
      );
      const required = Math.min(2, Math.max(1, roomPlayers.length));
      if (participants.length < required) {
        return { ok: false, error: 'need_ready_players' };
      }

      const preset = presets.get(room.id) || {};
      const rules = {
        ...DEFAULT_RULES,
        ...(preset.rules || {}),
      };
      const lotCatalog = await loadLotCatalog(preset);

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
          ? preset.slots.map((s, i) => {
              const type = s.type === 'lootbox' ? 'lootbox' : 'lot';
              const rawName = String(s.name || '').trim();
              const rarity = type === 'lootbox' ? normalizeLootboxRarity(s.rarity) : null;
              const name =
                rawName ||
                (type === 'lootbox'
                  ? `${lootboxRarityLabel(rarity || REGULAR_LOOTBOX_RARITY)} лутбокс`
                  : `Лот ${i + 1}`);
              const imageUrl =
                type === 'lot' && s.imageUrl != null
                  ? String(s.imageUrl).trim().slice(0, 500)
                  : null;
              const nominalPrice =
                type === 'lot' && Number.isFinite(Number(s.nominalPrice))
                  ? Math.max(0, Math.floor(Number(s.nominalPrice)))
                  : null;
              const lotId =
                type === 'lot' && Number.isFinite(Number(s.lotId))
                  ? Number(s.lotId)
                  : null;
              const categoryId =
                type === 'lot' && Number.isFinite(Number(s.categoryId))
                  ? Number(s.categoryId)
                  : null;
              return {
                index: i,
                type,
                name,
                rarity,
                basePrice: Number.isFinite(Number(s.basePrice))
                  ? Math.max(0, Math.floor(Number(s.basePrice)))
                  : randomInt(80_000, 350_001),
                nominalPrice,
                imageUrl,
                lotId,
                categoryId,
              };
            })
          : createSlots(rules.maxSlots || DEFAULT_RULES.maxSlots, lotCatalog),
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
        slotPhase: 'bidding',
        lotCatalog,
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
      if ((state.slotPhase || 'bidding') !== 'bidding') {
        return { ok: false, error: 'reveal' };
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

      let maxBid = 0;
      for (const pid of state.activePlayerIds || []) {
        const bid = Number(state.currentBids[pid] ?? 0);
        if (Number.isFinite(bid) && bid > maxBid) {
          maxBid = bid;
        }
      }
      const minBid = Math.max(slot?.basePrice || 0, maxBid);
      if (minBid > 0 && clean < minBid) {
        return { ok: false, error: 'bid_below_current' };
      }

      // сохраняем ставку
      state.currentBids[pid] = clean;
      if (!Array.isArray(state.bidFeed)) state.bidFeed = [];
      state.bidFeed.push({ id: `${pid}-${Date.now()}`, playerId: pid, amount: clean });
      if (state.bidFeed.length > 16) {
        state.bidFeed = state.bidFeed.slice(-16);
      }

      if (state.phase === 'in_progress') {
        scheduleTimer(state);
      } else {
        clearTimer(state.roomId);
      }

      const publicState = buildPublicState(state, room);
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
    if (state) return buildPublicState(state, room);

    // Lobby-only snapshot so players see current presets before the game starts
    const preset = presets.get(room.id) || {};
    const rules = {
      ...DEFAULT_RULES,
      ...(preset.rules || {}),
    };
    const slotCount = Array.isArray(preset.slots) && preset.slots.length
      ? preset.slots.length
      : rules.maxSlots || DEFAULT_RULES.maxSlots;
    const slots = Array.isArray(preset.slots) && preset.slots.length
      ? preset.slots.map((s, i) => ({
          index: i,
          type: s.type === 'lootbox' ? 'lootbox' : 'lot',
          name: String(s.name || `Lot ${i + 1}`),
          rarity: s.rarity || null,
          basePrice: Number.isFinite(Number(s.basePrice))
            ? Math.max(0, Math.floor(Number(s.basePrice)))
            : undefined,
          nominalPrice: Number.isFinite(Number(s.nominalPrice))
            ? Math.max(0, Math.floor(Number(s.nominalPrice)))
            : null,
          imageUrl: s.imageUrl || null,
          lotId: s.lotId ?? null,
          categoryId: s.categoryId ?? null,
        }))
      : Array.from({ length: slotCount }, (_v, i) => ({
          index: i,
          type: 'lot',
          name: `Lot ${i + 1}`,
          basePrice: undefined,
          nominalPrice: null,
          imageUrl: null,
          lotId: null,
          categoryId: null,
        }));

    return {
      code: room.code,
      phase: 'lobby',
      rules,
      slots,
      totalSlots: slotCount,
      maxSlots: slotCount,
      balances: {},
      currentBids: {},
      activePlayerIds: [],
      history: [],
      basketTotals: {},
    };
  }

  function clearRoomStateById(roomId) {
    states.delete(roomId);
    clearTimer(roomId);
    clearRevealTimer(roomId);
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
      clearRevealTimer(roomId);
    } else {
      ensureConsistentPhase(state);
      if (state.phase !== 'in_progress') {
        clearTimer(roomId);
        clearRevealTimer(roomId);
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
      const v = Math.max(3, Math.min(120, Number(r.timePerSlotSec) || 3));
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
          .map((s) => {
            const type = s.type === 'lootbox' ? 'lootbox' : 'lot';
            const rawName = String(s.name || '').slice(0, 120).trim();
            const rarity = type === 'lootbox' ? normalizeLootboxRarity(s.rarity) : null;
            const name =
              rawName ||
              (type === 'lootbox'
                ? `${lootboxRarityLabel(rarity || REGULAR_LOOTBOX_RARITY)} лутбокс`
                : 'Лот');
            const imageUrl =
              type === 'lot' && s.imageUrl != null
                ? String(s.imageUrl).trim().slice(0, 500)
                : null;
            const nominalPrice =
              type === 'lot' && Number.isFinite(Number(s.nominalPrice))
                ? Math.max(0, Math.floor(Number(s.nominalPrice)))
                : null;
            const lotId =
              type === 'lot' && Number.isFinite(Number(s.lotId))
                ? Number(s.lotId)
                : null;
            const categoryId =
              type === 'lot' && Number.isFinite(Number(s.categoryId))
                ? Number(s.categoryId)
                : null;
            return {
              type,
              name,
              rarity,
              basePrice: Number.isFinite(Number(s.basePrice))
                ? Math.max(0, Math.floor(Number(s.basePrice)))
                : undefined,
              nominalPrice,
              imageUrl,
              lotId,
              categoryId,
            };
          })
      : [];

    const rawCategorySlugs = Array.isArray(payload.lotCategories)
      ? payload.lotCategories
      : Array.isArray(payload.lotCategorySlugs)
        ? payload.lotCategorySlugs
        : [];
    const lotCategorySlugs = rawCategorySlugs
      .map((value) => String(value || '').trim().toLowerCase())
      .filter(Boolean)
      .slice(0, 40);

    const rawCategoryIds = Array.isArray(payload.lotCategoryIds)
      ? payload.lotCategoryIds
      : [];
    const lotCategoryIds = rawCategoryIds
      .map((value) => Number(value))
      .filter((value) => Number.isFinite(value) && value > 0)
      .slice(0, 40);

    presets.set(room.id, {
      rules: safeRules,
      slots: safeSlots,
      lotCategorySlugs,
      lotCategoryIds,
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
      if ((state.slotPhase || 'bidding') !== 'bidding') {
        state.pauseLeftMs = null;
        state.slotDeadlineAtMs = null;
        const pub = buildPublicState(state, room);
        if (onState) onState(pub);
        return { ok: true, state: pub };
      }
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
      if ((state.slotPhase || 'bidding') !== 'bidding') {
        return { ok: false, error: 'reveal' };
      }

      resolveSlotNow(state, room);
      scheduleAfterResolve(state);

      const publicState = buildPublicState(state, room);
      if (onState) onState(publicState);
      return { ok: true, state: publicState };
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
