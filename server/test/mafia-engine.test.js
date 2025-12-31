'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { createMafiaEngine } = require('../mafia-engine');

const enums = {
  Phase: { LOBBY: 'LOBBY', NIGHT: 'NIGHT', DAY: 'DAY', VOTE: 'VOTE', ENDED: 'ENDED' },
  Role: {
    DON: 'DON',
    MAFIA: 'MAFIA',
    DOCTOR: 'DOCTOR',
    SHERIFF: 'SHERIFF',
    BODYGUARD: 'BODYGUARD',
    PROSTITUTE: 'PROSTITUTE',
    JOURNALIST: 'JOURNALIST',
    SNIPER: 'SNIPER',
    CIVIL: 'CIVIL',
  },
  VoteType: { LYNCH: 'LYNCH', MAFIA: 'MAFIA' },
};

function makeEngine(prismaOverrides = {}) {
  const io = { to: () => ({ emit: () => {} }) };
  const defaultPrisma = {
    nightAction: {
      findFirst: async () => null,
      count: async () => 0,
      findMany: async () => [],
    },
    room: {
      findUnique: async () => null,
    },
  };
  const prisma = {
    ...defaultPrisma,
    ...prismaOverrides,
    nightAction: {
      ...defaultPrisma.nightAction,
      ...(prismaOverrides.nightAction || {}),
    },
    room: {
      ...defaultPrisma.room,
      ...(prismaOverrides.room || {}),
    },
  };
  const config = { NIGHT_SEC: 1, DAY_SEC: 1, VOTE_SEC: 1 };
  const withRoomLock = async (_roomId, fn) => fn();
  const isLockError = () => false;
  return createMafiaEngine({ prisma, io, enums, config, withRoomLock, isLockError });
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('runPhaseOnce returns promise and suppresses concurrent runs per room', async () => {
  const engine = makeEngine();
  let ran = 0;

  const p1 = engine.runPhaseOnce(1, async () => {
    ran += 1;
    await wait(20);
  });
  const p2 = engine.runPhaseOnce(1, async () => {
    ran += 1;
  });

  await Promise.all([p1, p2]);
  assert.equal(ran, 1, 'second run should be skipped while first is in-flight');
});

test('runPhaseOnce propagates errors to caller', async () => {
  const engine = makeEngine();
  await assert.rejects(
    () => engine.runPhaseOnce(2, async () => { throw new Error('boom'); }),
    /boom/
  );
});

test('toPublicPlayers respects DB ready and falls back to readySet when missing', () => {
  const engine = makeEngine();
  const players = [
    { id: 1, alive: true, user: {}, ready: true },
    { id: 2, alive: true, user: {}, ready: false },
    { id: 3, alive: true, user: {}, ready: undefined },
  ];
  const readySet = new Set([3]);
  const res = engine.toPublicPlayers(players, { readySet });

  assert.equal(res[0].ready, true, 'ready=true from DB');
  assert.equal(res[1].ready, false, 'ready=false from DB');
  assert.equal(res[2].ready, true, 'ready taken from readySet when DB is missing');
});

test('validateNightTarget rejects mafia targeting mafia', async () => {
  const engine = makeEngine();
  const room = { players: [] };
  const match = { id: 1 };
  const actor = { id: 10, alive: true };
  const target = { id: 11, alive: true, role: enums.Role.MAFIA };
  const res = await engine.validateNightTarget({
    room,
    match,
    actor,
    role: enums.Role.MAFIA,
    target,
    nightNumber: 1,
  });
  assert.equal(res.ok, false);
  assert.equal(typeof res.error, 'string');
  assert.ok(res.error.length > 0);
});

test('isNightReady requires sniper action when alive', async () => {
  const room = {
    players: [
      { id: 1, alive: true, role: enums.Role.MAFIA },
      { id: 2, alive: true, role: enums.Role.SNIPER },
      { id: 3, alive: true, role: enums.Role.CIVIL },
    ],
  };
  const actions = [{ actorPlayerId: 1 }];
  const engine = makeEngine({
    room: { findUnique: async () => room },
    nightAction: { findMany: async () => actions },
  });
  const ready = await engine.isNightReady(1, 1, 1);
  assert.equal(ready, false);
});

test('isNightReady passes when sniper acted (even with null target)', async () => {
  const room = {
    players: [
      { id: 1, alive: true, role: enums.Role.MAFIA },
      { id: 2, alive: true, role: enums.Role.SNIPER },
      { id: 3, alive: true, role: enums.Role.CIVIL },
    ],
  };
  const actions = [{ actorPlayerId: 1 }, { actorPlayerId: 2 }];
  const engine = makeEngine({
    room: { findUnique: async () => room },
    nightAction: { findMany: async () => actions },
  });
  const ready = await engine.isNightReady(1, 1, 1);
  assert.equal(ready, true);
});

test('validateNightTarget counts only real sniper shots', async () => {
  let countArgs = null;
  const engine = makeEngine({
    nightAction: {
      count: async (args) => {
        countArgs = args;
        return 0;
      },
    },
  });
  const room = { players: [] };
  const match = { id: 1 };
  const actor = { id: 10, alive: true };
  const target = { id: 11, alive: true };

  const res = await engine.validateNightTarget({
    room,
    match,
    actor,
    role: enums.Role.SNIPER,
    target,
    nightNumber: 2,
  });
  assert.equal(res.ok, true);
  assert.ok(countArgs?.where, 'count should be called for sniper shots');
  assert.deepEqual(countArgs.where.targetPlayerId, { not: null });
});
