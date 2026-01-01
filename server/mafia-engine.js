'use strict';

const { createHash } = require('crypto');

/**
 * Mafia Engine (чистая игровая логика)
 * ------------------------------------
 * Экспорт: createMafiaEngine({ prisma, io, enums: { Phase, Role, VoteType }, config, withRoomLock, isLockError })
 * Возвращает методы движка:
 * - publicRoomState, privateSelfState
 * - startGame, resolveNight, startVote, resolveVote
 * - validateNightTarget, isNightReady
 * - voteProgress, leadersOfRound1, currentVoteRound, allAliveVoted
 * - emitMafiaTargets, emitMafiaTeam, rebuildMafiaRoom
 * - emitRoomStateDebounced, emitRoomStateNow
 * - schedulePhase, cancelTimer, cancelAllTimers
 * - recoverTimersOnBoot, startDueRoomsScheduler
 * - runPhaseOnce, toPublicPlayers, MAFIA_ROLES
 * - (Lobby READY) setReady, clearReady, clearReadyForPlayer, everyoneReadyExceptOwner, getReadySet
 *
 * Обновления:
 * - publicRoomState: добавлены lastEventId и etag для инкрементальной синхронизации и быстрой проверки изменений.
 * - toPublicPlayers: ready берётся из БД (true/false) при наличии; при null/undefined — фолбэк на in-memory readySet.
 */

function createMafiaEngine({ prisma, io, enums, config, withRoomLock, isLockError }) {
  if (!prisma || !io || !enums || !config || !withRoomLock) {
    throw new Error('createMafiaEngine: missing required dependencies');
  }

  const { Phase, Role, VoteType } = enums;
  const {
    NIGHT_SEC = 70,
    DAY_SEC   = 60,
    VOTE_SEC  = 60,
    DON_WAIT_SEC = 20,
  } = config;
  const DON_WAIT_MS = Math.max(0, Number(DON_WAIT_SEC) || 20) * 1000;

  // ===== Pre-game READY (Lobby) =============================================
  // roomId -> Set<roomPlayerId> «готовых» игроков (владелец не обязан быть в set)
  const readyByRoom = new Map();
  const getReadySet = (roomId) => {
    let s = readyByRoom.get(roomId);
    if (!s) { s = new Set(); readyByRoom.set(roomId, s); }
    return s;
  };

  // ===== Constants & helpers =====
  const MAFIA_ROLES = new Set([Role.MAFIA, Role.DON]);

  // 🕵️ Логика, кого шериф видит как «мафию».
  // — при 5 игроках по договорённости Дон считается «невидимым» для шерифа
  // — во всех остальных раскладках Дон тоже считается мафией
  function isSheriffDetectsMafia(role, playerCount) {
    if (playerCount === 5) {
      return role === Role.MAFIA;
    }
    return role === Role.MAFIA || role === Role.DON;
  }

  function toPublicUser(u) {
    return {
      id: u.id,
      tgId: u.tgUserId?.toString?.() ?? null,
      nativeId: u.nativeId ?? null,
      first_name: u.firstName ?? null,
      username: u.username ?? null,
      photo_url: u.photoUrl ?? null,
    };
  }

  // Теперь поддерживает опциональный readySet и ownerId:
  // ✅ единый источник правды — БД, плюс совместимость с legacy readySet
  // ✅ владелец всегда "готов"
  function toPublicPlayers(players, { readySet = null, ownerId = null } = {}) {
    return players.map((p) => ({
      id: p.id,
      alive: p.alive,
      user: toPublicUser(p.user),
      role: null, // роли скрыты
      // Если в БД есть явное значение (true/false) — уважаем его.
      // Иначе (null/undefined) — фолбэк на in-memory readySet (совместимость).
      ready: (() => {
        const readyRaw = p.ready != null ? !!p.ready : !!(readySet && readySet.has(p.id));
        const ownerMatch =
          ownerId != null &&
          String(p.userId ?? p.user?.id) === String(ownerId);
        return ownerMatch ? true : readyRaw;
      })(),
    }));
  }

  async function readRoomWithPlayersByCode(code) {
    return prisma.room.findUnique({
      where: { code },
      include: {
        players: { include: { user: true }, orderBy: { joinedAt: 'asc' } },
        matches: { orderBy: { id: 'desc' }, take: 1 },
      },
    });
  }

  // ===== Debounce & timers =====
  const roomTimers = new Map();       // roomId -> { timeout, endsAt, phase, round }
  const roomStateDebounce = new Map();// code   -> timeoutId
  const phaseInFlight = new Set();    // roomId -> protects double resolve

  /**
   * Публичный безопасный доступ к текущему таймеру комнаты.
   * Нужен серверу для первичного "timer:update" при подписке без обращения к приватным структурам.
   */
  function getTimer(roomId) {
    const rt = roomTimers.get(roomId);
    if (!rt) return null;
    return {
      phase: rt.phase,
      endsAt: rt.endsAt,
      round: rt.round || 1,
      dayNumber: rt.dayNumber ?? null,
    };
  }

  function isBot(player) {
    return !!player?.user?.nativeId && player.user.nativeId.startsWith('bot1234-');
  }

  async function randomTarget(room, excludeIds = []) {
    const pool = room.players.filter(p => p.alive && !excludeIds.includes(p.id));
    if (!pool.length) return null;
    const rnd = Math.floor(Math.random() * pool.length);
    return pool[rnd];
  }

  function getNightStartMs(room) {
    const rawEnd = room?.phaseEndsAt;
    if (!rawEnd) return null;
    const endsAt = rawEnd instanceof Date ? rawEnd.getTime() : new Date(rawEnd).getTime();
    if (!Number.isFinite(endsAt)) return null;
    const start = endsAt - NIGHT_SEC * 1000;
    return Number.isFinite(start) ? start : null;
  }

  async function autoBotNightActions(room, match, nightNumber, { onlyIfMissing = false } = {}) {
    try {
      const existing = await prisma.nightAction.findMany({ where: { matchId: match.id, nightNumber } });
      const hasAction = new Set(existing.map(a => a.actorPlayerId));
      const donPlayer = room.players.find(p => p.alive && p.role === Role.DON);
      const donAct = donPlayer ? existing.find(a => a.actorPlayerId === donPlayer.id && a.role === Role.DON) : null;
      const nightStartMs = getNightStartMs(room);
      const donWaitElapsed = nightStartMs != null ? (Date.now() - nightStartMs) : (DON_WAIT_MS + 1);
      let donGateOpen = !donPlayer || !!donAct || donWaitElapsed >= DON_WAIT_MS;

      const botPlayers = room.players
        .filter(p => p.alive && isBot(p))
        .sort((a, b) => (a.role === Role.DON ? -1 : b.role === Role.DON ? 1 : 0));

      for (const p of botPlayers) {
        if (hasAction.has(p.id) && (!MAFIA_ROLES.has(p.role) || onlyIfMissing)) continue; // при onlyIfMissing не трогаем уже сходивших

        const actorId = p.id;
        const role = p.role;
        if (role === Role.MAFIA && !donGateOpen) continue;
        let targetId = null;
        let targetPlayer = null;

        switch (role) {
          case Role.MAFIA:
          case Role.DON: {
            const excludeIds = room.players
              .filter((pl) => MAFIA_ROLES.has(pl.role))
              .map((pl) => pl.id);
            const t = await randomTarget(room, excludeIds);
            targetId = t?.id || null;
            targetPlayer = t || null;
            break;
          }
          case Role.DOCTOR: {
            const t = await randomTarget(room, []); // может лечить себя
            targetId = t?.id || null;
            targetPlayer = t || null;
            break;
          }
          case Role.SHERIFF:
          case Role.JOURNALIST: {
            const t = await randomTarget(room, [actorId]);
            targetId = t?.id || null;
            targetPlayer = t || null;
            break;
          }
          case Role.BODYGUARD:
          case Role.PROSTITUTE: {
            const t = await randomTarget(room, [actorId]);
            targetId = t?.id || null;
            targetPlayer = t || null;
            break;
          }
          case Role.SNIPER: {
            // 50% шанс пропустить, иначе стреляем в другого
            if (Math.random() < 0.5) targetId = null;
            else {
              const t = await randomTarget(room, [actorId]);
              targetId = t?.id || null;
              targetPlayer = t || null;
            }
            break;
          }
          default:
            break;
        }

        // Убедимся, что боты не нарушают ограничения validateNightTarget
        if (role && (targetId !== null || role === Role.SNIPER || role === Role.DOCTOR || role === Role.PROSTITUTE || role === Role.BODYGUARD || role === Role.SHERIFF || role === Role.JOURNALIST)) {
          try {
            const validation = await validateNightTarget({
              room,
              match,
              actor: p,
              role,
              target: targetPlayer,
              nightNumber,
            });
            if (!validation.ok) {
              // Для ролей, где пропуск допустим, fallback в пропуск; иначе просто не пишем действие
              if (role === Role.DOCTOR || role === Role.SHERIFF || role === Role.BODYGUARD || role === Role.PROSTITUTE || role === Role.JOURNALIST || role === Role.SNIPER) {
                targetId = null;
                targetPlayer = null;
              } else {
                continue;
              }
            }
          } catch (e) {
            if (!isLockError?.(e)) console.warn('autoBotNightActions validate failed:', e?.message || e);
          }
        }

        if (targetId !== null || role === Role.SNIPER || role === Role.DOCTOR || role === Role.PROSTITUTE || role === Role.BODYGUARD || role === Role.SHERIFF || role === Role.JOURNALIST) {
          try {
            const existingAction = await prisma.nightAction.findUnique({
              where: { matchId_nightNumber_actorPlayerId: { matchId: match.id, nightNumber, actorPlayerId: actorId } },
            });
            if (existingAction) {
              if (onlyIfMissing) continue;
              await prisma.nightAction.update({
                where: { id: existingAction.id },
                data: { targetPlayerId: targetId, role },
              });
            } else {
              await prisma.nightAction.create({
                data: { matchId: match.id, nightNumber, actorPlayerId: actorId, role, targetPlayerId: targetId },
              });
            }
            hasAction.add(actorId);
            if (role === Role.DON) donGateOpen = true;
          } catch (e) {
            if (!isLockError?.(e)) console.warn('autoBotNightActions failed:', e?.message || e);
          }
        }
      }
    } catch (e) {
      console.warn('autoBotNightActions outer failed:', e?.message || e);
    }
  }

  async function autoBotVotes(room, round) {
    try {
      const dayNumber = room.dayNumber;
      const leaders = round === 2 ? await leadersOfRound1(room.id, dayNumber) : [];
      const allowed = round === 2 && leaders.length ? new Set(leaders) : null;
      const allowSkip = allowed ? allowed.has(0) : false;
      const existingVotes = await prisma.vote.findMany({
        where: { roomId: room.id, type: VoteType.LYNCH, dayNumber, round },
        select: { voterId: true },
      });
      const voted = new Set(existingVotes.map(v => v.voterId));
      const alive = room.players.filter(p => p.alive);
      const aliveIds = alive.map(p => p.userId);

      for (const p of room.players) {
        if (!p.alive || !isBot(p)) continue;
        if (voted.has(p.userId)) continue;

        let targetId = null;
        const candidates = allowed
          ? alive.filter(pl => allowed.has(pl.id))
          : alive;
        const options = [...candidates];
        if (allowSkip) options.push(null);
        if (options.length) {
          const rnd = Math.floor(Math.random() * options.length);
          const picked = options[rnd];
          targetId = picked ? picked.id : null;
        } else {
          targetId = null; // пропуск
        }

        try {
          await prisma.vote.upsert({
            where: { roomId_voterId_type_dayNumber_round: { roomId: room.id, voterId: p.userId, type: VoteType.LYNCH, dayNumber, round } },
            update: { targetPlayerId: targetId },
            create: { roomId: room.id, voterId: p.userId, type: VoteType.LYNCH, dayNumber, round, targetPlayerId: targetId },
          });
        } catch (e) {
          if (!isLockError?.(e)) console.warn('autoBotVotes failed:', e?.message || e);
        }
      }
    } catch (e) {
      console.warn('autoBotVotes outer failed:', e?.message || e);
    }
  }

  async function emitRoomStateNow(code) {
    try {
      io.to(`room:${code}`).emit('room:state', await publicRoomState(code));
    } catch (e) {
      console.error('emitRoomStateNow error:', e);
    }
  }

  function emitRoomStateDebounced(code, delay = 75) {
    try {
      if (roomStateDebounce.has(code)) clearTimeout(roomStateDebounce.get(code));
      const id = setTimeout(() => {
        roomStateDebounce.delete(code);
        emitRoomStateNow(code);
      }, delay);
      if (id?.unref) { try { id.unref(); } catch {} }
      roomStateDebounce.set(code, id);
    } catch {}
  }

  function runPhaseOnce(roomId, fn) {
    if (phaseInFlight.has(roomId)) return Promise.resolve();
    phaseInFlight.add(roomId);
    const p = Promise.resolve()
      .then(fn)
      .catch((e) => {
        if (!isLockError?.(e)) console.error('runPhaseOnce error:', e);
        throw e;
      })
      .finally(() => phaseInFlight.delete(roomId));
    return p;
  }

  // ===== Rendering public/private room state =====
  async function privateSelfState(roomPlayerId) {
    const me = await prisma.roomPlayer.findUnique({
      where: { id: Number(roomPlayerId) },
      include: { room: true, room: { include: { matches: { orderBy: { id: 'desc' }, take: 1 } } } },
    });
    if (!me) return null;
    const res = { roomPlayerId: me.id, userId: me.userId, role: me.role, alive: me.alive, roomCode: me.room.code };
    if (MAFIA_ROLES.has(me.role)) {
      try {
        const room = await prisma.room.findUnique({ where: { id: me.roomId }, include: { players: true, matches: { orderBy: { id: 'desc' }, take: 1 } } });
        if (room?.players?.length) {
          res.mafiaTeam = room.players
            .filter((p) => p.alive && MAFIA_ROLES.has(p.role))
            .map((p) => ({ playerId: p.id, role: p.role }));
          // Добавим актуальные цели мафии текущей ночи, чтобы метки появлялись сразу даже без отдельного события
          if (room.status === Phase.NIGHT && room.matches?.[0]) {
            const nightNumber = room.dayNumber + 1;
            const acts = await prisma.nightAction.findMany({
              where: {
                matchId: room.matches[0].id,
                nightNumber,
                role: { in: [Role.MAFIA, Role.DON] },
                targetPlayerId: { not: null },
              },
            });
            res.mafiaTargets = {
              night: nightNumber,
              items: acts.map((a) => ({ actorId: a.actorPlayerId, targetPlayerId: a.targetPlayerId })).filter((x) => x.targetPlayerId != null),
            };
          }
        }
      } catch (e) {
        console.warn('privateSelfState mafiaTeam fetch failed', e?.message || e);
      }
    }
    return res;
  }

  async function currentVoteRound(roomId, dayNumber) {
    const rt = roomTimers.get(roomId);
    if (rt?.phase === Phase.VOTE) return rt.round || 1;
    const last = await prisma.event.findFirst({
      where: { match: { roomId }, phase: Phase.VOTE, payload: { path: '$.dayNumber', equals: dayNumber } },
      orderBy: { id: 'desc' },
    });
    return last?.payload?.round || 1;
  }

  async function leadersOfRound1(roomId, dayNumber) {
    const tie = await prisma.event.findFirst({
      where: {
        match: { roomId },
        phase: Phase.VOTE,
        AND: [
          { payload: { path: '$.dayNumber', equals: dayNumber } },
          { payload: { path: '$.round', equals: 1 } },
          { payload: { path: '$.tie', equals: true } },
        ],
      },
      orderBy: { id: 'desc' },
    });
    return Array.isArray(tie?.payload?.leaders) ? tie.payload.leaders : [];
  }

  async function voteProgress(roomId, dayNumber, round) {
    const votes = await prisma.vote.findMany({ where: { roomId, type: VoteType.LYNCH, dayNumber, round } });
    const tally = {};
    for (const v of votes) {
      const k = v.targetPlayerId || 0;
      tally[k] = (tally[k] || 0) + 1;
    }
    const room = await prisma.room.findUnique({ where: { id: roomId }, include: { players: true } });
    const aliveCount = room.players.filter(p => p.alive).length;
    return { dayNumber, round, tally, alive: aliveCount };
  }

  async function allAliveVoted(roomId, dayNumber, round) {
    const room = await prisma.room.findUnique({ where: { id: roomId }, include: { players: true } });
    const aliveCount = room.players.filter(p => p.alive).length;
    const votesCount = await prisma.vote.count({ where: { roomId, type: VoteType.LYNCH, dayNumber, round } });
    return votesCount >= aliveCount && aliveCount > 0;
  }

  async function publicRoomState(code) {
    const room = await readRoomWithPlayersByCode(code);
    if (!room) return { error: 'room_not_found' };

    const players = toPublicPlayers(room.players, {
      readySet: getReadySet(room.id),
      ownerId: room.ownerId,
    });

    const rt = roomTimers.get(room.id);
    let endsAt = rt?.endsAt;
    if (!endsAt && room.phaseEndsAt) endsAt = new Date(room.phaseEndsAt).getTime();
    let round = rt?.round || 1;
    if (!rt && room.status === Phase.VOTE) {
      round = await currentVoteRound(room.id, room.dayNumber);
    }

    let vote;
    if (room.status === Phase.VOTE) {
      vote = await voteProgress(room.id, room.dayNumber, round);
      vote.leaders = await leadersOfRound1(room.id, room.dayNumber);
      vote.round = round;
    }

    // Определим последний id события текущего матча (для инкрементальной синхронизации)
    let lastEventId = null;
    if (room.matches?.[0]) {
      const last = await prisma.event.findFirst({
        where: { matchId: room.matches[0].id },
        orderBy: { id: 'desc' },
        select: { id: true },
      });
      lastEventId = last?.id ?? null;
    }

    // NEW: таймер-пейлоад всегда присутствует, и если статус ENDED — содержит winner.
    let timerPayload = null;
    if (room.status === Phase.ENDED) {
      timerPayload = {
        phase: room.status,
        endsAt: null,
        serverTime: Date.now(),
        round: 1,
        dayNumber: room.dayNumber,
        winner: room.matches?.[0]?.winner || null,
      };
    } else if (endsAt) {
      // если endsAt пришёл только из БД — всё равно отдадим serverTime,
      // чтобы фронт мог корректно синхронизировать локальный таймер
      timerPayload = { phase: room.status, endsAt, serverTime: Date.now(), round, dayNumber: room.dayNumber };
    }

    // Считаем ETag состояния (без персональных данных) — быстрый признак изменений
    const etagBase = {
      status: room.status,
      ownerId: room.ownerId,
      dayNumber: room.dayNumber,
      endsAt: timerPayload?.endsAt || null,
      players: players.map((p) => [p.id, p.alive, !!p.ready]),
      vote: room.status === Phase.VOTE ? { round, tally: vote?.tally || {} } : null,
      lastEventId,
    };
    let etag = null;
    try {
      etag = createHash('sha1').update(JSON.stringify(etagBase)).digest('base64url');
    } catch {
      etag = String(Date.now());
    }

    return {
      room: { code: room.code, status: room.status, ownerId: room.ownerId, dayNumber: room.dayNumber, phaseEndsAt: room.phaseEndsAt, game: room.game },
      players,
      timer: timerPayload,
      etag,
      lastEventId,
      ...(vote ? { vote } : {}),
    };
  }

  // ===== READY helpers ======================================================
  async function everyoneReadyExceptOwner(roomId) {
    const room = await prisma.room.findUnique({ where: { id: roomId }, include: { players: true } });
    if (!room) return false;
    const set = getReadySet(room.id);
    return room.players
      .filter(p => p.userId !== room.ownerId) // «все, кроме владельца»
      .every(p => set.has(p.id));
  }
  function setReady(roomId, playerId, ready) {
    const s = getReadySet(roomId);
    if (ready) s.add(Number(playerId));
    else s.delete(Number(playerId));
  }
  function clearReady(roomId) {
    readyByRoom.delete(roomId);
  }
  function clearReadyForPlayer(roomId, playerId) {
    const s = readyByRoom.get(roomId);
    if (s) s.delete(Number(playerId));
  }

  // ===== Roles & composition =====
  function composeRolesFor(n) {
    const R = Role;
    const packs = {
      6:  [R.DON, R.MAFIA, R.SHERIFF, R.DOCTOR, R.CIVIL, R.CIVIL],
      7:  [R.DON, R.MAFIA, R.SHERIFF, R.DOCTOR, R.BODYGUARD, R.PROSTITUTE, R.CIVIL],
      8:  [R.DON, R.MAFIA, R.SHERIFF, R.DOCTOR, R.BODYGUARD, R.PROSTITUTE, R.JOURNALIST, R.CIVIL],
      9:  [R.DON, R.MAFIA, R.MAFIA, R.SHERIFF, R.DOCTOR, R.BODYGUARD, R.PROSTITUTE, R.JOURNALIST, R.CIVIL],
      10: [R.DON, R.MAFIA, R.MAFIA, R.SHERIFF, R.DOCTOR, R.BODYGUARD, R.PROSTITUTE, R.JOURNALIST, R.CIVIL, R.CIVIL],
      11: [R.DON, R.MAFIA, R.MAFIA, R.SHERIFF, R.DOCTOR, R.BODYGUARD, R.PROSTITUTE, R.JOURNALIST, R.SNIPER, R.CIVIL, R.CIVIL],
      12: [R.DON, R.MAFIA, R.MAFIA, R.SHERIFF, R.DOCTOR, R.BODYGUARD, R.PROSTITUTE, R.JOURNALIST, R.SNIPER, R.CIVIL, R.CIVIL, R.CIVIL],
    };
    if (packs[n]) return [...packs[n]];
    if (n === 4) return [Role.MAFIA, Role.CIVIL, Role.CIVIL, Role.CIVIL];
    if (n === 5) return [Role.DON, Role.MAFIA, Role.SHERIFF, Role.DOCTOR, Role.CIVIL];
    if (n > 12) {
      const base = packs[12].slice();
      while (base.length < n) base.push(Role.CIVIL);
      return base;
    }
    return [];
  }

  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  // ===== Start game =====
  async function startGame(roomId) {
    return runPhaseOnce(roomId, async () =>
      withRoomLock(roomId, async () => {
        const room = await prisma.room.findUnique({
          where: { id: roomId },
          include: { players: true, matches: { orderBy: { id: 'desc' }, take: 1 } }
        });
        if (!room || room.status !== Phase.LOBBY) return;

        // подчистим хвосты
        try { await prisma.vote.deleteMany({ where: { roomId: room.id, type: VoteType.LYNCH } }); } catch {}
        if (room.matches?.[0]) {
          try { await prisma.nightAction.deleteMany({ where: { matchId: room.matches[0].id } }); } catch {}
        }

        const n = room.players.length;
        const composition = composeRolesFor(n);
        if (composition.length !== n) {
          throw new Error(`Нет раскладки для ${n} игроков`);
        }

        const ids = shuffle(room.players.map(p => p.id));
        const roles = shuffle(composition);

        await prisma.$transaction(async (tx) => {
          for (let i = 0; i < ids.length; i++) {
            await tx.roomPlayer.update({ where: { id: ids[i] }, data: { role: roles[i], alive: true } });
          }
          const match = await tx.match.create({ data: { roomId: room.id } });
          await tx.room.update({
            where: { id: room.id },
            data: { status: Phase.NIGHT, dayNumber: 0, phaseEndsAt: new Date(Date.now() + NIGHT_SEC * 1000) },
          });
          await tx.event.create({ data: { matchId: match.id, phase: Phase.NIGHT, payload: { started: true } } });
        });

        const updated = await prisma.room.findUnique({
          where: { id: room.id },
          include: { players: { include: { user: true } }, matches: { orderBy: { id: 'desc' }, take: 1 } }
        });

        // Боты сразу делают выбор до рассылки приватных self, чтобы метки мафии пришли в первом пакете
        try {
          const match = updated.matches?.[0];
          if (match) await autoBotNightActions(updated, match, updated.dayNumber + 1, { onlyIfMissing: true });
        } catch (e) {
          if (!isLockError?.(e)) console.warn('autoBotNightActions at start failed:', e?.message || e);
        }

        await rebuildMafiaRoom(updated.id);

        // приватные слепки ролей (уже включают mafiaTargets, если они есть)
        await Promise.all(updated.players.map(async (p) => {
          const self = await privateSelfState(p.id);
          io.to(`player:${p.id}`).emit('private:self', self);
        }));

        schedulePhase(updated.id, Phase.NIGHT, NIGHT_SEC, { round: 1, dayNumber: updated.dayNumber });
        emitRoomStateDebounced(updated.code);

        // После старта игра вышла из лобби — очищаем готовность, чтобы на «следующий круг» начинать с нуля
        clearReady(updated.id);

        io.to(`room:${updated.code}`).emit('toast', { type: 'info', text: 'Игра началась! Фаза: Ночь' });

        await emitMafiaTargets(updated.id);
        await emitMafiaTeam(updated.id);
      })
    );
  }

  // ===== Night readiness & validation =====
  async function isNightReady(roomId, matchId, nightNumber) {
    const room = await prisma.room.findUnique({ where: { id: roomId }, include: { players: true } });
    const actions = await prisma.nightAction.findMany({ where: { matchId, nightNumber } });

    const prostitute = room.players.find(p => p.alive && p.role === Role.PROSTITUTE);
    const prAct = prostitute && actions.find(a => a.actorPlayerId === prostitute.id && a.role === Role.PROSTITUTE);
    const blockedActors = new Set(prAct?.targetPlayerId ? [prAct.targetPlayerId] : []);

    const mafiaAlive = room.players.filter(p => p.alive && MAFIA_ROLES.has(p.role));
    const mafiaDone = mafiaAlive.length
      ? mafiaAlive.every(m => blockedActors.has(m.id) || actions.find(a => a.actorPlayerId === m.id))
      : true;

    const done = (role) => {
      const pl = room.players.find(p => p.alive && p.role === role);
      if (!pl) return true;
      if (blockedActors.has(pl.id)) return true;
      return !!actions.find(a => a.actorPlayerId === pl.id);
    };

    const docDone   = done(Role.DOCTOR);
    const sherDone  = done(Role.SHERIFF);
    const protDone  = done(Role.PROSTITUTE);
    const bodyDone  = done(Role.BODYGUARD);
    const journDone = done(Role.JOURNALIST);
    const snipDone  = done(Role.SNIPER);

    return !!(mafiaDone && docDone && sherDone && protDone && bodyDone && journDone && snipDone);
  }

  function journalistCategory(role) {
    if (MAFIA_ROLES.has(role)) return 'mafia';
    if (role === Role.CIVIL) return 'civil';
    return 'power';
  }

  async function validateNightTarget({ room, match, actor, role, target, nightNumber }) {
    if (!actor?.alive) return { ok: false, error: 'Вы не можете действовать' };
    if (target && !target.alive) return { ok: false, error: 'Цель уже выбыла' };

    const self = actor.id;
    const prevOf = async (r) => prisma.nightAction.findFirst({
      where: { matchId: match.id, actorPlayerId: actor.id, role: r, nightNumber: nightNumber - 1 },
      orderBy: { id: 'desc' },
    });

    switch (role) {
      case Role.MAFIA:
      case Role.DON: {
        if (!target || self === target.id) return { ok: false, error: 'Выберите живую цель' };
        if (MAFIA_ROLES.has(target.role)) return { ok: false, error: 'Нельзя атаковать союзника' };
        return { ok: true };
      }
      case Role.DOCTOR: {
        if (!target) return { ok: true }; // пропуск
        const prev = await prevOf(Role.DOCTOR);
        if (prev?.targetPlayerId && prev.targetPlayerId === target.id) {
          return { ok: false, error: 'Нельзя лечить одну и ту же цель две ночи подряд' };
        }
        if (target.id === self) {
          const selfHeals = await prisma.nightAction.count({
            where: { matchId: match.id, actorPlayerId: actor.id, role: Role.DOCTOR, targetPlayerId: actor.id },
          });
          if (selfHeals >= 1) return { ok: false, error: 'Самолечение доступно только один раз за игру' };
        }
        return { ok: true };
      }
      case Role.SHERIFF: {
        if (!target) return { ok: true };
        if (target.id === self) return { ok: false, error: 'Нельзя проверять себя' };
        const prev = await prevOf(Role.SHERIFF);
        if (prev?.targetPlayerId && prev.targetPlayerId === target.id) {
          return { ok: false, error: 'Нельзя проверять одного и того же игрока подряд' };
        }
        return { ok: true };
      }
      case Role.BODYGUARD: {
        if (!target) return { ok: true };
        if (target.id === self) return { ok: false, error: 'Нельзя охранять себя' };
        return { ok: true };
      }
      case Role.PROSTITUTE: {
        if (!target) return { ok: true };
        if (target.id === self) return { ok: false, error: 'Нельзя блокировать себя' };
        const prev = await prevOf(Role.PROSTITUTE);
        if (prev?.targetPlayerId && prev.targetPlayerId === target.id) {
          return { ok: false, error: 'Нельзя блокировать одного и того же игрока подряд' };
        }
        return { ok: true };
      }
      case Role.JOURNALIST: {
        if (!target) return { ok: true };
        if (target.id === self) return { ok: false, error: 'Нельзя брать себя' }; // ← фикс текста
        const prev = await prevOf(Role.JOURNALIST);
        if (prev?.targetPlayerId && prev.targetPlayerId === target.id) {
          return { ok: false, error: 'Нельзя брать одного и того же игрока подряд' };
        }
        return { ok: true };
      }
      case Role.SNIPER: {
        if (!target) return { ok: true }; // пропуск допустим (без траты патрона)
        if (target.id === self) return { ok: false, error: 'Нельзя стрелять в себя' };
        const shots = await prisma.nightAction.count({
          where: {
            matchId: match.id,
            actorPlayerId: actor.id,
            role: Role.SNIPER,
            targetPlayerId: { not: null },
          },
        });
        if (shots >= 1) return { ok: false, error: 'Патрон уже израсходован' };
        return { ok: true };
      }
      default:
        return { ok: true };
    }
  }

  // ===== Mafia private room management =====
  async function rebuildMafiaRoom(roomId) {
    try {
      const room = await prisma.room.findUnique({ where: { id: roomId }, include: { players: true } });
      if (!room) return;

      const mafRoom = `maf:${room.id}`;
      const currentSockets = await io.in(mafRoom).fetchSockets();
      const currentById = new Map(currentSockets.map(s => [s.id, s]));

      // NEW: собираем желаемые сокеты параллельно — быстрее и устойчивее на больших комнатах
      const desired = new Map();
      const mafiaPlayers = room.players.filter(p => p.alive && MAFIA_ROLES.has(p.role));
      const sockGroups = await Promise.all(
        mafiaPlayers.map(p => io.in(`player:${p.id}`).fetchSockets())
      );
      for (const group of sockGroups) {
        for (const s of group) desired.set(s.id, s);
      }

      for (const [sid, s] of desired.entries()) {
        if (!currentById.has(sid)) {
          try { await s.join(mafRoom); } catch {}
        }
      }
      for (const [sid, s] of currentById.entries()) {
        if (!desired.has(sid)) {
          try { await s.leave(mafRoom); } catch {}
        }
      }
    } catch (e) {
      console.error('maf room (re)build error:', e);
    }
  }

  async function emitMafiaTeam(roomId) {
    const room = await prisma.room.findUnique({ where: { id: roomId }, include: { players: true } });
    if (!room) return;
    const items = room.players
      .filter(p => p.alive && MAFIA_ROLES.has(p.role))
      .map(p => ({ playerId: p.id, role: p.role }));
    io.to(`maf:${room.id}`).emit('mafia:team', { items });
    // Дублируем состав в личные комнаты мафии — на случай, если сокет ещё не в maf:<roomId>
    for (const p of room.players) {
      if (!p.alive || !MAFIA_ROLES.has(p.role)) continue;
      try { io.to(`player:${p.id}`).emit('mafia:team', { items }); } catch {}
    }
  }

  async function emitMafiaTargets(roomId) {
    try {
    const room = await prisma.room.findUnique({
      where: { id: roomId },
      include: {
        players: { include: { user: true } },
        matches: { orderBy: { id: 'desc' }, take: 1 },
      }
    });
      if (!room) return;

      if (!room.matches?.length || room.status !== Phase.NIGHT) {
        io.to(`maf:${room.id}`).emit('mafia:targets', { night: null, items: [] });
        return;
      }

      const match = room.matches[0];
      const nightNumber = room.dayNumber + 1;

      let actions = await prisma.nightAction.findMany({
        where: { matchId: match.id, nightNumber, role: { in: [Role.MAFIA, Role.DON] } }
      });

      // Если мафия-боты ещё не сделали выбор (например, из-за гоночных условий) — подстрахуем и повторим emit
      const mafiaAlive = room.players.filter((p) => p.alive && MAFIA_ROLES.has(p.role));
      const missingActors = new Set(mafiaAlive.map((p) => p.id));
      actions.forEach((a) => missingActors.delete(a.actorPlayerId));
      if (!actions.length || missingActors.size) {
        try {
          await autoBotNightActions(room, match, nightNumber, { onlyIfMissing: true });
          actions = await prisma.nightAction.findMany({
            where: { matchId: match.id, nightNumber, role: { in: [Role.MAFIA, Role.DON] } }
          });
        } catch (e) {
          if (!isLockError?.(e)) console.warn('emitMafiaTargets autobot fallback failed:', e?.message || e);
        }
      }

      const items = actions
        .map(a => ({ actorId: a.actorPlayerId, targetPlayerId: a.targetPlayerId }))
        .filter(x => x.targetPlayerId != null);

      io.to(`maf:${room.id}`).emit('mafia:targets', { night: nightNumber, items });
      // Отправим дублирующие таргеты напрямую мафии — чтобы они появились даже без комнаты maf:<roomId>
      for (const p of room.players) {
        if (!p.alive || !MAFIA_ROLES.has(p.role)) continue;
        try { io.to(`player:${p.id}`).emit('mafia:targets', { night: nightNumber, items }); } catch {}
      }
    } catch (e) {
      console.error('emitMafiaTargets error:', e);
    }
  }

  // ===== Night resolve =====
  async function detectWinner(tx, roomId) {
    const players = await tx.roomPlayer.findMany({ where: { roomId } });
    const mafiaAlive = players.filter(p => p.alive && MAFIA_ROLES.has(p.role)).length;
    const civAlive = players.filter(p => p.alive && !MAFIA_ROLES.has(p.role)).length;
    if (mafiaAlive <= 0) return 'CIVIL';
    if (mafiaAlive >= civAlive) return 'MAFIA';
    return null;
  }

  function schedulePhase(roomId, phase, seconds, { round = 1, dayNumber = null } = {}) {
    cancelTimer(roomId);
    const endsAt = Date.now() + seconds * 1000;
    const dayNum = dayNumber != null ? dayNumber : null;
    const timeout = setTimeout(() => onPhaseTimeout(roomId, phase, round), seconds * 1000);
    if (timeout?.unref) { try { timeout.unref(); } catch {} }
    roomTimers.set(roomId, { timeout, endsAt, phase, round, dayNumber: dayNum });
    prisma.room.update({ where: { id: roomId }, data: { phaseEndsAt: new Date(endsAt) } }).catch(() => {});
    (async () => {
      try {
        const r = await prisma.room.findUnique({ where: { id: roomId } });
        if (r) {
          const dn = dayNum != null ? dayNum : r.dayNumber;
          io.to(`room:${r.code}`).emit('timer:update', { phase, endsAt, serverTime: Date.now(), round, dayNumber: dn });
        }
      } catch {}
    })();
  }

  function cancelTimer(roomId) {
    const rt = roomTimers.get(roomId);
    if (rt?.timeout) clearTimeout(rt.timeout);
    roomTimers.delete(roomId);
  }
  function cancelAllTimers() {
    for (const [roomId] of roomTimers) cancelTimer(roomId);
  }

  async function onPhaseTimeout(roomId, phase, _round) {
    try {
      const room = await prisma.room.findUnique({ where: { id: roomId } });
      if (!room) { cancelTimer(roomId); return; }
      if (phase !== room.status) { cancelTimer(roomId); return; }

      switch (phase) {
        case Phase.NIGHT: await resolveNight(roomId); break;
        case Phase.DAY:   await startVote(roomId);    break;
        case Phase.VOTE:  await resolveVote(roomId);  break;
        default: break;
      }
    } catch (e) {
      if (isLockError?.(e)) return;
      cancelTimer(roomId);
      console.error('onPhaseTimeout error:', e);
    }
  }

  async function resolveNight(roomId) {
    return runPhaseOnce(roomId, () =>
      withRoomLock(roomId, async () => {
        const room = await prisma.room.findUnique({
          where: { id: roomId },
          include: {
            players: { include: { user: true } },
            matches: { orderBy: { id: 'desc' }, take: 1 },
          }
        });
        if (!room) return;
        if (room.status !== Phase.NIGHT) return;

        const match = room.matches[0];
        const nightNumber = room.dayNumber + 1;

        // Авто-действия для ботов (если они есть и не сходили)
        await autoBotNightActions(room, match, nightNumber);

        const actions = await prisma.nightAction.findMany({ where: { matchId: match.id, nightNumber } });

        // Простьютка блокирует
        const prostitute = room.players.find(p => p.alive && p.role === Role.PROSTITUTE);
        let blockedActors = new Set();
        if (prostitute) {
          const prAct = actions.find(a => a.actorPlayerId === prostitute.id && a.role === Role.PROSTITUTE);
          if (prAct?.targetPlayerId) blockedActors.add(prAct.targetPlayerId);
        }

        try {
          const blockedMafia = room.players
            .filter(p => blockedActors.has(p.id) && MAFIA_ROLES.has(p.role))
            .map(p => p.id);
          if (blockedMafia.length) {
            io.to(`maf:${room.id}`).emit('mafia:blocked', { playerIds: blockedMafia, nightNumber });
          }
        } catch (e) {
          console.warn('emit mafia:blocked failed:', e?.message || e);
        }

        // Инсайты Шерифа/Журналиста (если не заблокированы)
        const sheriff = room.players.find(p => p.alive && p.role === Role.SHERIFF);
        const shAction = sheriff && actions.find(a => a.actorPlayerId === sheriff.id && a.role === Role.SHERIFF);
        const sheriffIsBlocked = !!(sheriff && blockedActors.has(sheriff.id));
        if (shAction?.targetPlayerId && !sheriffIsBlocked) {
          const target = room.players.find(p => p.id === shAction.targetPlayerId);
          const isMafia = target
            ? isSheriffDetectsMafia(target.role, room.players.length)
            : false;
          io.to(`player:${sheriff.id}`).emit('sheriff:result', { playerId: target?.id ?? null, isMafia });
        }

        const journalist = room.players.find(p => p.alive && p.role === Role.JOURNALIST);
        const jAction = journalist && actions.find(a => a.actorPlayerId === journalist.id && a.role === Role.JOURNALIST);
        const journalistIsBlocked = !!(journalist && blockedActors.has(journalist.id));
        if (jAction?.targetPlayerId && !journalistIsBlocked) {
          const target = room.players.find(p => p.id === jAction.targetPlayerId);
          const category = journalistCategory(target?.role);
          io.to(`player:${journalist.id}`).emit('journalist:result', { playerId: target?.id ?? null, category });
        }

        // Доктор
        const doctor = room.players.find(p => p.alive && p.role === Role.DOCTOR);
        const docAction = doctor && actions.find(a => a.actorPlayerId === doctor.id && a.role === Role.DOCTOR);
        const docIsBlocked = !!(doctor && blockedActors.has(doctor.id));
        const savedId = (!docIsBlocked && docAction?.targetPlayerId) ? docAction.targetPlayerId : null;

        // Телохранитель
        const body = room.players.find(p => p.alive && p.role === Role.BODYGUARD);
        const bodyAction = body && actions.find(a => a.actorPlayerId === body.id && a.role === Role.BODYGUARD);
        const bodyIsBlocked = !!(body && blockedActors.has(body.id));
        const guardedId = (!bodyIsBlocked && bodyAction?.targetPlayerId) ? bodyAction.targetPlayerId : null;

        // Голоса мафии (не заблокированных)
        const mafiaActors = room.players.filter(p => p.alive && MAFIA_ROLES.has(p.role) && !blockedActors.has(p.id));
        const mafiaVotes = mafiaActors
          .map(m => actions.find(a => a.actorPlayerId === m.id && MAFIA_ROLES.has(a.role) && a.targetPlayerId))
          .filter(Boolean);

        const tally = new Map();
        for (const v of mafiaVotes) {
          tally.set(v.targetPlayerId, (tally.get(v.targetPlayerId) || 0) + 1);
        }
        const minVotesToKill = Math.floor(mafiaActors.length / 2) + 1; // большинство голосов мафии (включая Дона)
        let mafiaTargetId = null; let max = 0; let leaders = [];
        for (const [t, c] of tally.entries()) {
          if (c > max) { max = c; leaders = [t]; }
          else if (c === max) { leaders.push(t); }
        }
        if (max >= minVotesToKill) {
          if (leaders.length === 1) mafiaTargetId = leaders[0];
          if (leaders.length > 1 && leaders.length > 0) {
            mafiaTargetId = leaders[Math.floor(Math.random() * leaders.length)];
          }
        } else {
          mafiaTargetId = null; // все выбрали разные цели — выстрела нет
        }

        // Снайпер
        const sniper = room.players.find(p => p.alive && p.role === Role.SNIPER);
        const snAction = sniper && actions.find(a => a.actorPlayerId === sniper.id && a.role === Role.SNIPER);
        const sniperIsBlocked = !!(sniper && blockedActors.has(sniper.id));
        const sniperTargetId = (!sniperIsBlocked && snAction?.targetPlayerId) ? snAction.targetPlayerId : null;

        // Применение защиты/блоков
        const candidateTargets = [];
        if (mafiaTargetId) candidateTargets.push({ src: 'mafia', targetId: mafiaTargetId });
        if (sniperTargetId) candidateTargets.push({ src: 'sniper', targetId: sniperTargetId });

        const killedSet = new Set();

        for (const c of candidateTargets) {
          let victimId = c.targetId;

          if (guardedId && guardedId === victimId && body && body.alive && !bodyIsBlocked) {
            victimId = body.id;
          }

          if (savedId && savedId === victimId) continue;

          const victimPlayer = room.players.find(p => p.id === victimId);
          if (!victimPlayer || !victimPlayer.alive) continue;

          killedSet.add(victimId);
        }

        const killedIds = Array.from(killedSet);
        const rolesById = {};

        await prisma.$transaction(async (tx) => {
          let killedRoles = [];
          if (killedIds.length) {
            for (const kid of killedIds) {
              const victim = await tx.roomPlayer.update({ where: { id: kid }, data: { alive: false } });
              killedRoles.push({ id: kid, role: victim.role });
              rolesById[victim.id] = victim.role;
            }
          }

          await tx.event.create({
            data: {
              matchId: match.id,
              phase: Phase.NIGHT,
              payload: {
                nightNumber,
                mafiaTargetId: mafiaTargetId || null,
                sniperTargetId: sniperTargetId || null,
                savedId: savedId || null,
                guardedId: guardedId || null,
                blockedActors: Array.from(blockedActors),
                killedIds,
                killedRoles,
              },
            },
          });

          const winner = await detectWinner(tx, room.id);
          if (winner) {
            await tx.match.update({ where: { id: match.id }, data: { endedAt: new Date(), winner } });
            await tx.room.update({ where: { id: room.id }, data: { status: Phase.ENDED, phaseEndsAt: null } });
            return;
          }

          await tx.room.update({
            where: { id: room.id },
            data: {
              status: Phase.DAY,
              dayNumber: room.dayNumber + 1,
              phaseEndsAt: new Date(Date.now() + DAY_SEC * 1000),
            },
          });
          await tx.event.create({ data: { matchId: match.id, phase: Phase.DAY, payload: { dayNumber: room.dayNumber + 1 } } });
        });

        const code = room.code;

        await rebuildMafiaRoom(room.id);
        await emitMafiaTeam(room.id);

        const after = await prisma.room.findUnique({
          where: { id: room.id },
          include: {
            players: true,
            matches: { orderBy: { id: 'desc' }, take: 1 }
          }
        });

        const rolesByIdAll = Object.fromEntries(after.players.map(p => [p.id, p.role]));

        // Личные сигналы
        try {
          if (blockedActors && blockedActors.size) {
            for (const pid of blockedActors) {
              io.to(`player:${pid}`).emit('you:blocked', { nightNumber });
            }
          }
          if (savedId) io.to(`player:${savedId}`).emit('you:healed', { nightNumber });
          if (guardedId) io.to(`player:${guardedId}`).emit('you:guarded', { nightNumber });
        } catch (e) {
          console.warn('personal night signals failed:', e?.message || e);
        }

        io.to(`room:${code}`).emit('night:result', {
          killedIds,
          savedId: savedId || null,
          guardedId: guardedId || null,
          rolesById,
        });
        emitRoomStateDebounced(code);

        if (after.status === Phase.ENDED) {
          await emitMafiaTargets(room.id);
          io.to(`room:${code}`).emit('reveal:all', { rolesById: rolesByIdAll });
          io.to(`room:${code}`).emit('match:ended', {
            winner: after.matches[0]?.winner || 'unknown',
            rolesById: rolesByIdAll,
            reason: 'after_night',
          });
          cancelTimer(room.id);
          return;
        }

        schedulePhase(room.id, Phase.DAY, DAY_SEC, { round: 1, dayNumber: room.dayNumber + 1 });
        await emitMafiaTargets(room.id);
      })
    );
  }

  // ===== Vote start/resolve =====
  async function startVote(roomId) {
    return runPhaseOnce(roomId, () =>
      withRoomLock(roomId, async () => {
        const room = await prisma.room.findUnique({
          where: { id: roomId },
          include: {
            players: { include: { user: true } },
            matches: { orderBy: { id: 'desc' }, take: 1 }
          }
        });
        if (!room || room.status !== Phase.DAY) return;

        await prisma.$transaction(async (tx) => {
          await tx.room.update({ where: { id: room.id }, data: { status: Phase.VOTE, phaseEndsAt: new Date(Date.now() + VOTE_SEC * 1000) } });
          await tx.event.create({ data: { matchId: room.matches[0].id, phase: Phase.VOTE, payload: { dayNumber: room.dayNumber, round: 1 } } });
        });

        const code = (await prisma.room.findUnique({ where: { id: room.id } })).code;

        schedulePhase(room.id, Phase.VOTE, VOTE_SEC, { round: 1, dayNumber: room.dayNumber });

        // Боты голосуют сразу, чтобы было видно прогресс (но финальный подсчёт останется в resolveVote)
        try {
          await autoBotVotes(room, 1);
          io.to(`room:${code}`).emit('vote:progress', await voteProgress(room.id, room.dayNumber, 1));
        } catch (e) {
          if (!isLockError?.(e)) console.warn('autoBotVotes round1 failed:', e?.message || e);
        }
        emitRoomStateDebounced(code);
      })
    );
  }

  async function resolveVote(roomId) {
    return runPhaseOnce(roomId, () =>
      withRoomLock(roomId, async () => {
        const room = await prisma.room.findUnique({
          where: { id: roomId },
          include: {
            players: { include: { user: true } },
            matches: { orderBy: { id: 'desc' }, take: 1 },
          }
        });
        if (!room || room.status !== Phase.VOTE) return;
        const match = room.matches[0];

        const round = await currentVoteRound(room.id, room.dayNumber);
        await autoBotVotes(room, round);
        const votes = await prisma.vote.findMany({ where: { roomId: room.id, type: VoteType.LYNCH, dayNumber: room.dayNumber, round } });
        const aliveIds = new Set(room.players.filter(p => p.alive).map(p => p.id));

        const tally = new Map();
        for (const v of votes) {
          const key = v.targetPlayerId || 0;
          tally.set(key, (tally.get(key) || 0) + 1);
        }

        let topCount = 0; let leaders = [];
        tally.forEach((count, target) => {
          if (count > topCount) { topCount = count; leaders = [target]; }
          else if (count === topCount) { leaders.push(target); }
        });

        if (leaders.length > 1 && round === 1) {
          const leadersClean = Array.from(new Set(leaders)); // сохраняем и "пропуск" (0), и явных лидеров
          await prisma.$transaction(async (tx) => {
            await tx.event.create({ data: { matchId: match.id, phase: Phase.VOTE, payload: { dayNumber: room.dayNumber, tie: true, round: 1, leaders: leadersClean } } });
            await tx.event.create({ data: { matchId: match.id, phase: Phase.VOTE, payload: { dayNumber: room.dayNumber, round: 2, runoff: true, leaders: leadersClean } } });
            await tx.room.update({ where: { id: room.id }, data: { phaseEndsAt: new Date(Date.now() + VOTE_SEC * 1000) } });
          });
          schedulePhase(room.id, Phase.VOTE, VOTE_SEC, { round: 2 });
          const code = room.code;
          io.to(`room:${code}`).emit('vote:runoff', { leaders: leadersClean, round: 2 });
          // Боты сразу голосуют во втором раунде, чтобы пользователь видел процесс
          try {
            await autoBotVotes(room, 2);
            io.to(`room:${code}`).emit('vote:progress', await voteProgress(room.id, room.dayNumber, 2));
          } catch (e) {
            if (!isLockError?.(e)) console.warn('autoBotVotes round2 failed:', e?.message || e);
          }
          emitRoomStateDebounced(code);
          return;
        }

        let lynchedId = null;
        if (leaders.length === 1) {
          lynchedId = leaders[0] || null; // 0 → пропуск
        }

        let lynchedRole = null;

        await prisma.$transaction(async (tx) => {
          if (lynchedId && aliveIds.has(lynchedId)) {
            const victim = await tx.roomPlayer.update({ where: { id: lynchedId }, data: { alive: false } });
            lynchedRole = victim.role;
          }
          await tx.event.create({ data: { matchId: match.id, phase: Phase.VOTE, payload: { dayNumber: room.dayNumber, round, lynchedId, lynchedRole } } });

          const winner = await detectWinner(tx, room.id);
          if (winner) {
            await tx.match.update({ where: { id: match.id }, data: { endedAt: new Date(), winner } });
            await tx.room.update({ where: { id: room.id }, data: { status: Phase.ENDED, phaseEndsAt: null } });
            return;
          }

          await tx.room.update({
            where: { id: room.id },
            data: { status: Phase.NIGHT, phaseEndsAt: new Date(Date.now() + NIGHT_SEC * 1000) },
          });
          await tx.event.create({ data: { matchId: match.id, phase: Phase.NIGHT, payload: { started: true } } });
        });

        const code = room.code;

        await rebuildMafiaRoom(room.id);
        await emitMafiaTeam(room.id);

        const after = await prisma.room.findUnique({
          where: { id: room.id },
          include: {
            players: { include: { user: true } },
            matches: { orderBy: { id: 'desc' }, take: 1 }
          }
        });
        const rolesByIdAll = Object.fromEntries(after.players.map(p => [p.id, p.role]));

        io.to(`room:${code}`).emit('vote:result', {
          lynchedId: lynchedId || null,
          lynchedRole: lynchedRole || null,
        });
        emitRoomStateDebounced(code);

        if (after.status === Phase.ENDED) {
          await emitMafiaTargets(room.id);
          io.to(`room:${code}`).emit('reveal:all', { rolesById: rolesByIdAll });
          io.to(`room:${code}`).emit('match:ended', {
            winner: after.matches[0]?.winner || 'unknown',
            rolesById: rolesByIdAll,
            reason: 'after_vote',
          });
          cancelTimer(room.id);
          return;
        }

        // Боты сразу делают выбор на новую ночь, чтобы метки были видны
        try {
          const match = after.matches?.[0];
          if (match) await autoBotNightActions(after, match, after.dayNumber + 1, { onlyIfMissing: true });
        } catch (e) {
          if (!isLockError?.(e)) console.warn('autoBotNightActions at night start failed:', e?.message || e);
        }

        schedulePhase(room.id, Phase.NIGHT, NIGHT_SEC, { round: 1, dayNumber: room.dayNumber });
        await emitMafiaTargets(room.id);
        await emitMafiaTeam(room.id);
      })
    );
  }

  // ===== Recovery & Scheduler =====
  async function recoverTimersOnBoot() {
    try {
      const rooms = await prisma.room.findMany({
        where: { status: { in: [Phase.NIGHT, Phase.DAY, Phase.VOTE] } },
        include: { matches: { orderBy: { id: 'desc' }, take: 1 } },
      });
      for (const r of rooms) {
        const now = Date.now();
        const end = r.phaseEndsAt ? new Date(r.phaseEndsAt).getTime() : 0;
        let ms = end ? end - now : 0;
        if (ms <= 0) ms = 1000;
        let round = 1;
        if (r.status === Phase.VOTE && r.matches[0]) {
          const lastVoteEvt = await prisma.event.findFirst({
            where: { matchId: r.matches[0].id, phase: Phase.VOTE, payload: { path: '$.dayNumber', equals: r.dayNumber } },
            orderBy: { id: 'desc' },
          });
          round = lastVoteEvt?.payload?.round || 1;
        }
        schedulePhase(r.id, r.status, Math.ceil(ms / 1000), { round, dayNumber: r.dayNumber });
      }

      for (const r of rooms) {
        await rebuildMafiaRoom(r.id);
        await emitMafiaTargets(r.id);
        await emitMafiaTeam(r.id);
      }
    } catch (e) {
      console.error('recoverTimersOnBoot error:', e);
    }
  }

  function startDueRoomsScheduler() {
    const tickDelayMs = 1000;
    const tick = async () => {
      try {
        const now = new Date();
        const due = await prisma.room.findMany({
          where: {
            status: { in: [Phase.NIGHT, Phase.DAY, Phase.VOTE] },
            phaseEndsAt: { lte: now },
          },
          select: { id: true, status: true },
          take: 100,
        });
        for (const r of due) {
          try {
            const fresh = await prisma.room.findUnique({ where: { id: r.id }, select: { id: true, status: true } });
            if (!fresh) continue;
            switch (fresh.status) {
              case Phase.NIGHT: await resolveNight(fresh.id); break;
              case Phase.DAY:   await startVote(fresh.id);    break;
              case Phase.VOTE:  await resolveVote(fresh.id);  break;
              default: break;
            }
          } catch (e) {
            if (!isLockError?.(e)) console.warn('scheduler tick error:', e?.message || e);
          }
        }
      } catch (e) {
        console.warn('scheduler tick error:', e?.message || e);
      } finally {
        setTimeout(tick, tickDelayMs).unref?.();
      }
    };
    setTimeout(tick, tickDelayMs).unref?.();
  }

  return {
    // осторожный доступ к таймерам:
    getTimer,
    // обратная совместимость (только чтение в коде сервера):
    __roomTimers: roomTimers,

    // public helpers & constants
    MAFIA_ROLES,
    toPublicPlayers,

    // state
    publicRoomState,
    privateSelfState,

    // phases
    startGame,
    resolveNight,
    startVote,
    resolveVote,

    // night actions helpers
    validateNightTarget,
    isNightReady,

    // vote helpers
    voteProgress,
    leadersOfRound1,
    currentVoteRound,
    allAliveVoted,

    // mafia rooms & signals
    emitMafiaTargets,
    emitMafiaTeam,
    rebuildMafiaRoom,

    // timers & emits
    emitRoomStateDebounced,
    emitRoomStateNow,
    schedulePhase,
    cancelTimer,
    cancelAllTimers,

    // recovery & scheduler
    recoverTimersOnBoot,
    startDueRoomsScheduler,

    // concurrency helper
    runPhaseOnce,

    // ready/lobby helpers
    setReady,
    clearReady,
    clearReadyForPlayer,
    everyoneReadyExceptOwner,
    getReadySet: (roomId) => new Set(getReadySet(roomId)), // read-only копия
    // toPublicPlayers уже умеет принимать readySet и ownerId
  };
}

module.exports = { createMafiaEngine };
