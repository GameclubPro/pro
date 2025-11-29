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

function makeEngine() {
  const io = { to: () => ({ emit: () => {} }) };
  const prisma = {};
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
