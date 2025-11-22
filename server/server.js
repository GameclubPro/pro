// Node.js 18+ — Express + Telegraf + Prisma (MySQL) + Socket.IO + Redis (optional)
// Публичные REST-роуты и имена socket-событий НЕ МЕНЯЛ — совместимость сохранена.

'use strict';

require('dotenv').config();
require('express-async-errors');

const http = require('http');
const express = require('express');
const compression = require('compression');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const { Server: SocketIOServer } = require('socket.io');
const { Telegraf } = require('telegraf');
const { PrismaClient, Phase, Role, VoteType, RoomGame } = require('@prisma/client');
const { verifyInitData, parseUser, parseInitData } = require('./verifyInitData');
const { Readable } = require('stream');
const { randomInt, randomUUID } = require('crypto');
const jwt = require('jsonwebtoken');

const prisma = new PrismaClient();
const { createMafiaEngine } = require('./mafia-engine');
const { createAuctionEngine } = require('./auction-engine');

/* ============================ ENV ============================ */
const {
  PORT = 3000,
  BOT_TOKEN,
  BOT_USERNAME,
  PUBLIC_API_URL,
  PUBLIC_APP_URL,
  WEBAPP_ORIGIN,
  WEBHOOK_SECRET_PATH,
  WEBHOOK_SECRET_TOKEN,
  NODE_ENV = 'production',

  ROOM_IDLE_MIN = '40',
  ROOM_MAX_PLAYERS = '12',

  MAFIA_NIGHT_SEC = '70',
  MAFIA_DAY_SEC   = '60',
  MAFIA_VOTE_SEC  = '60',

  CORS_ALLOW_HTTP = '0',
  CORS_EXTRA_ORIGINS = '',

  REDIS_URL = '',
  REDIS_PREFIX = 'mafia',

  INITDATA_MAX_AGE_SEC = '86400',
  // Грейс для авто-кика по разрыву сокета — 5 минут по умолчанию
  AUTO_LEAVE_GRACE_MS  = '300000',
  // NEW: порог авто-удаления комнат, если нет ни одного активного сокета (минуты)
  NO_SOCKET_IDLE_MIN   = '5',
} = process.env;

// JWT: поддержка двух секретов (основной + совместимость с RN)
const {
  JWT_SECRET = '',
  SESSION_TTL_SEC = '2592000',
  APP_JWT_SECRET = '',
  APP_JWT_TTL_DAYS = '',
} = process.env;

function ensure(name, value, example) {
  if (!value) {
    console.error(`❌ ${name} не задан. Пример: ${example}`);
    process.exit(1);
  }
}
ensure('BOT_TOKEN', BOT_TOKEN, '123456:ABC...');
ensure('BOT_USERNAME', BOT_USERNAME, 'PlayTeamBot');
ensure('PUBLIC_API_URL', PUBLIC_API_URL, 'https://api.play-team.ru');
ensure('PUBLIC_APP_URL', PUBLIC_APP_URL, 'https://app.play-team.ru');
ensure('WEBAPP_ORIGIN', WEBAPP_ORIGIN, 'https://app.play-team.ru');
ensure('WEBHOOK_SECRET_PATH', WEBHOOK_SECRET_PATH, 'tgwh-<random>');

const MAX_PLAYERS = Math.max(4, parseInt(ROOM_MAX_PLAYERS, 10) || 12);
const NIGHT_SEC = Math.max(20, parseInt(MAFIA_NIGHT_SEC, 10) || 70);
const DAY_SEC   = Math.max(20, parseInt(MAFIA_DAY_SEC, 10) || 60);
const VOTE_SEC  = Math.max(20, parseInt(MAFIA_VOTE_SEC, 10) || 60);
const ALLOW_HTTP = CORS_ALLOW_HTTP === '1';
const USE_REDIS = !!REDIS_URL;
const INITDATA_MAX_AGE = Math.max(60, parseInt(INITDATA_MAX_AGE_SEC, 10) || 86400);
const DEFAULT_GAME = RoomGame.MAFIA;

function normalizeGame(raw, fallback = DEFAULT_GAME) {
  const v = String(raw || '').trim().toUpperCase();
  if (v === 'AUCTION') return RoomGame.AUCTION;
  if (v === 'MAFIA') return RoomGame.MAFIA;
  return fallback;
}
function gameFromReq(req, fallback = null) {
  const raw = req?.query?.game ?? req?.body?.game;
  if (raw == null || raw === '') return fallback;
  return normalizeGame(raw, fallback || DEFAULT_GAME);
}

// JSON BigInt safe
const jsonSafe = (x) =>
  JSON.parse(JSON.stringify(x, (_, v) => (typeof v === 'bigint' ? v.toString() : v)));

// Сеттер для JWT — используем доступный секрет (основной или приложенческий)
function selectJwtSecretForSign() {
  return JWT_SECRET || APP_JWT_SECRET || '';
}
function selectJwtTtlSeconds() {
  const ttlSecFromEnv = parseInt(SESSION_TTL_SEC, 10);
  if (Number.isFinite(ttlSecFromEnv) && ttlSecFromEnv > 0) return ttlSecFromEnv;
  const ttlDays = parseInt(APP_JWT_TTL_DAYS, 10);
  if (Number.isFinite(ttlDays) && ttlDays > 0) return ttlDays * 86400;
  return 2592000; // 30 days
}

/* ============================ JWT helpers (UPDATED) ============================ */
const JWT_VERIFY_OPTS = { algorithms: ['HS256'], audience: 'pt-app', issuer: 'pt-api' };

function signSession(user) {
  const secret = selectJwtSecretForSign();
  if (!secret) return null;
  const ttl = Math.max(3600, selectJwtTtlSeconds());
  const payload = { uid: Number(user.id) };
  if (user.tgUserId) payload.tid = String(user.tgUserId);
  else if (user.nativeId) payload.tid = `n:${user.nativeId}`;

  const signOpts = {
    algorithm: 'HS256',
    expiresIn: ttl,
    audience: 'pt-app',
    issuer: 'pt-api',
    jwtid: (typeof randomUUID === 'function' ? randomUUID() : String(Date.now())),
    ...(process.env.JWT_KID ? { keyid: process.env.JWT_KID } : {}),
  };
  return jwt.sign(payload, secret, signOpts);
}

// verifyAny: пробуем оба секрета — для совместимости клиентов
function verifyAny(token) {
  const secrets = [JWT_SECRET, APP_JWT_SECRET].filter(Boolean);
  let lastErr;
  for (const s of secrets) {
    try { return jwt.verify(token, s, JWT_VERIFY_OPTS); } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('JWT verify failed');
}
function readBearer(req) {
  const h = String(req.headers.authorization || '');
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? m[1] : null;
}
/** Авторизация: сначала пытаемся по JWT, иначе — по Telegram initData */
async function authEither(req, { allowStale = false } = {}) {
  // 1) Bearer JWT
  const token = readBearer(req);
  if (token && (JWT_SECRET || APP_JWT_SECRET)) {
    try {
      const payload = verifyAny(token);
      const user = await prisma.user.findUnique({ where: { id: Number(payload.uid) } });
      if (user) return { ok: true, user };
    } catch { /* падаем на Telegram-ветку ниже */ }
  }

  // 2) Telegram initData
  const initData = getInitData(req);
  if (!initData) return { ok: false, http: 400, error: 'initData_required' };
  if (!verifyInitData(initData, BOT_TOKEN)) return { ok: false, http: 401, error: 'bad_signature' };
  if (!allowStale && !isInitDataFresh(initData)) return { ok: false, http: 401, error: 'stale_init_data' };

  const tg = parseUser(initData);
  if (!tg?.id) return { ok: false, http: 400, error: 'bad_user' };

  const user = await upsertTgUser(tg);
  return { ok: true, user };
}

/* ============================ Redis (optional) ============================ */
let redis = null;
let redlock = null;
let redisRateStore = null;
let socketRedisAdapter = null;
let socketIoPubClient = null;
let socketIoSubClient = null;
// unified sendCommand для rate-limit-redis
let rateLimiterSendCommand = null;

// конструктора ошибок redlock
let LockErrorCtor = null;
let ExecutionErrorCtor = null;
function isLockError(e) {
  if (!e) return false;
  const msg = String(e.message || '').toLowerCase();
  return (
    (LockErrorCtor && e instanceof LockErrorCtor) ||
    (ExecutionErrorCtor && e instanceof ExecutionErrorCtor) ||
    e.name === 'LockError' ||
    e.name === 'ExecutionError' ||
    msg.includes('quorum') ||
    msg.includes('the operation was applied to: 0 of the 1 requested resources') ||
    msg.includes('resource locked') ||
    msg.includes('unable to acquire lock')
  );
}

/* ===== Опциональная дедупликация клиентских действий (opId) =====
   Redis (SET NX PX) при наличии, иначе — in-memory с TTL. */
const OP_TTL_MS = 10 * 60 * 1000; // 10 минут
const opMem = new Map(); // key -> expiresAt
function opMemRemember(key, ttlMs = OP_TTL_MS) {
  const now = Date.now();
  const hit = opMem.get(key);
  if (hit && hit > now) return false; // уже было
  opMem.set(key, now + ttlMs);
  return true;
}
function opMemGC() {
  const now = Date.now();
  for (const [k, exp] of opMem) if (exp <= now) opMem.delete(k);
}
setInterval(opMemGC, 30_000).unref?.();
async function opRemember(key, ttlMs = OP_TTL_MS) {
  if (redis) {
    try {
      // ioredis: set key value 'PX' ttl 'NX' -> 'OK' | null
      const r = await redis.set(`${REDIS_PREFIX}:op:${key}`, '1', 'PX', ttlMs, 'NX');
      if (r === 'OK') return true;
      if (r === null) return false;
    } catch { /* fall back */ }
  }
  return opMemRemember(key, ttlMs);
}

if (USE_REDIS) {
  try {
    const IORedis = require('ioredis');
    redis = new IORedis(REDIS_URL, {
      lazyConnect: true,
      maxRetriesPerRequest: 2,
      retryStrategy: (times) => Math.min(2000 * times, 8000),
      enableAutoPipelining: true,
    });
    redis.on('error', (e) => console.error('Redis error:', e?.message || e));

    try {
      const { default: Redlock, LockError, ExecutionError } = require('redlock');
      LockErrorCtor = LockError || LockErrorCtor;
      ExecutionErrorCtor = ExecutionError || ExecutionErrorCtor;

      redlock = new Redlock([redis], {
        retryCount: 1,
        retryDelay: 150,
        retryJitter: 50,
        driftFactor: 0.01,
        automaticExtensionThreshold: 1500,
      });

      redlock.on('error', (e) => {
        if (isLockError(e)) return;
        console.warn('Redlock client error:', e?.message || e);
      });
    } catch (e) {
      console.warn('Redlock unavailable, continue without distributed locks:', e?.message || e);
    }

    // Rate-limit store (общий для всех инстансов)
    try {
      const { RedisStore } = require('rate-limit-redis');
      redisRateStore = RedisStore;
    } catch (e1) {
      try {
        redisRateStore = require('rate-limit-redis');
      } catch (e2) {
        console.warn('rate-limit-redis not found — using in-memory limiter');
      }
    }

    // Унифицированная обёртка sendCommand для rate-limit-redis
    try {
      const makeSendCommand = (client) => {
        if (!client) return null;
        // ioredis v5+: есть .call(...)
        if (typeof client.call === 'function') {
          return (...args) => client.call(...args);
        }
        // ioredis v4/v5: через Command
        if (typeof client.sendCommand === 'function' && IORedis?.Command) {
          return (cmd, ...args) => client.sendCommand(new IORedis.Command(cmd, args));
        }
        return null;
      };
      rateLimiterSendCommand = makeSendCommand(redis);
    } catch {}

    // Socket.IO Redis adapter
    try {
      const { createAdapter } = require('@socket.io/redis-adapter');
      socketRedisAdapter = async (io) => {
        const pubClient = new IORedis(REDIS_URL, { maxRetriesPerRequest: 2 });
        const subClient = pubClient.duplicate();
        // Явно дожидаемся подключения, где это поддерживается
        try {
          await Promise.all([
            pubClient.connect?.(),
            subClient.connect?.(),
          ].filter(Boolean));
        } catch {}
        socketIoPubClient = pubClient;
        socketIoSubClient = subClient;
        io.adapter(createAdapter(pubClient, subClient));
      };
    } catch (e) {
      console.warn('Socket.IO Redis adapter not available, using in-memory adapter');
    }
  } catch (e) {
    console.error('Failed to init Redis:', e?.message || e);
  }
}

// распределенная блокировка комнаты
async function withRoomLock(roomId, fn) {
  if (!redlock) return fn();
  const resource = `${REDIS_PREFIX}:lock:room:${roomId}`;
  // Redlock v6+: using(resources, ttl, settings?, handler)
  if (typeof redlock.using === 'function') {
    return redlock.using([resource], 8000, {}, async () => fn());
  }
  // v5 fallback
  const lock = await redlock.lock(resource, 8000);
  try { return await fn(); } finally { try { await lock.unlock(); } catch {} }
}

/* ============================ App & HTTP ============================ */
const app = express();
app.set('trust proxy', true);
app.disable('x-powered-by');

/* ============================ Helmet + CSP ============================ */
function buildCspConnect() {
  const list = new Set(["'self'"]);

  const pushOrigin = (s) => {
    try {
      const u = new URL(s);
      list.add(`${u.protocol}//${u.host}`);
      list.add(`wss://${u.host}`);
      if (ALLOW_HTTP || u.protocol === 'http:') list.add(`ws://${u.host}`);
    } catch {}
  };

  if (PUBLIC_API_URL) pushOrigin(PUBLIC_API_URL);
  if (WEBAPP_ORIGIN) pushOrigin(WEBAPP_ORIGIN);
  if (PUBLIC_APP_URL) pushOrigin(PUBLIC_APP_URL);

  list.add('wss:');
  if (NODE_ENV !== 'production' || ALLOW_HTTP) list.add('ws:');

  return Array.from(list);
}
const cspConnect = buildCspConnect();

app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      "default-src": ["'self'"],
      "img-src": ["'self'", "data:", "https:", "https://api.telegram.org"],
      "connect-src": cspConnect,
      "script-src": ["'self'"],
      "style-src": ["'self'", "'unsafe-inline'"],
      "frame-ancestors": ["'self'", "https://web.telegram.org", "https://*.telegram.org"],
      "base-uri": ["'self'"],
    },
  },
  crossOriginOpenerPolicy: { policy: 'same-origin' },
  crossOriginResourcePolicy: { policy: 'same-origin' },
  referrerPolicy: { policy: 'no-referrer' },
  // HSTS включаем только в production, чтобы не «запирать» дев-домены в HTTPS
  hsts: NODE_ENV === 'production' ? { maxAge: 31536000, includeSubDomains: true } : false,
}));
app.use(compression());
// Request-ID для корреляции (принимаем входящий или генерируем)
app.use((req, res, next) => {
  const rid = req.headers['x-request-id']
    ? String(req.headers['x-request-id'])
    : ((typeof randomUUID === 'function' && randomUUID()) || `${Date.now()}-${Math.random().toString(16).slice(2)}`);
  res.set('X-Request-ID', rid);
  req.requestId = rid;
  next();
});
// Логи (пропускаем health-checkи)
app.use(morgan(NODE_ENV === 'production' ? 'combined' : 'dev', {
  skip: (req) => req.path === '/health' || req.path === '/db-health',
}));
app.use(express.json({ limit: '1mb' }));

/* ============================ CORS ============================ */
function parseExtraOrigins(str) {
  if (!str) return [];
  return String(str)
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
}
function buildAllowedOrigins() {
  const seeds = [WEBAPP_ORIGIN, PUBLIC_APP_URL, ...parseExtraOrigins(CORS_EXTRA_ORIGINS)].filter(Boolean);
  const set = new Set();
  for (const s of seeds) {
    try {
      const u = new URL(s);
      if (u.protocol === 'https:') set.add(`https://${u.host}`);
      if (u.protocol === 'http:') {
        if (NODE_ENV !== 'production' || ALLOW_HTTP) set.add(`http://${u.host}`);
      }
    } catch {}
  }
  return set;
}
const ALLOWED_ORIGINS = buildAllowedOrigins();
const isAllowedOrigin = (origin) => {
  try {
    const u = new URL(origin);
    const key = `${u.protocol}//${u.host}`;
    return ALLOWED_ORIGINS.has(key);
  } catch {
    return false;
  }
};
const corsOptions = {
  origin: (origin, cb) => {
    if (!origin) return cb(null, true);
    return cb(null, isAllowedOrigin(origin));
  },
  methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'],
  credentials: false,
  maxAge: 86400,
};
app.use(cors(corsOptions));

/* ============================ Rate limits (Redis-aware) ============================ */
function makeLimiter({ windowMs, max }) {
  const base = {
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
  };
  if (USE_REDIS && redisRateStore && typeof rateLimiterSendCommand === 'function') {
    return rateLimit({
      ...base,
      store: new redisRateStore({
        sendCommand: rateLimiterSendCommand,
        prefix: `${REDIS_PREFIX}:ratelimit:`,
      }),
    });
  }
  return rateLimit(base);
}
const createLimiter   = makeLimiter({ windowMs: 10_000, max: 5 });
const joinLimiter     = makeLimiter({ windowMs: 10_000, max: 20 });
const avatarLimiter   = makeLimiter({ windowMs: 60_000, max: 60 });
const webhookLimiter  = makeLimiter({ windowMs: 60_000, max: 120 });

/* ============================ Helpers: initData ============================ */
function getInitData(req) {
  const fromHeader = req.headers['x-telegram-init-data'];
  const fromBody = req.body?.initData;
  return String(fromHeader || fromBody || '');
}
function isInitDataFresh(initData) {
  try {
    const parsed = parseInitData(initData);
    const authDate = Number(parsed?.auth_date || 0);
    if (!Number.isFinite(authDate) || authDate <= 0) return false;
    const ageSec = Math.floor(Date.now() / 1000) - authDate;
    return ageSec >= 0 && ageSec <= INITDATA_MAX_AGE;
  } catch {
    return false;
  }
}

/* ============================ Health & Meta ============================ */
app.get('/health', (_req, res) => res.status(200).send('OK'));
app.get('/db-health', async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ ok: true });
  } catch (e) {
    console.error('db-health error:', e);
    res.status(500).json({ ok: false });
  }
});
app.get('/version', (_req, res) =>
  res.json({ name: 'play-team-api', env: NODE_ENV, time: new Date().toISOString() }));

/* ============================ Telegram Bot ============================ */
const bot = new Telegraf(BOT_TOKEN);

function openKeyboard(payload = 'home') {
  const code = payload.startsWith('join-') ? payload.slice(5) : '';
  const u = new URL(PUBLIC_APP_URL);
  if (code) u.searchParams.set('join', code);
  return {
    inline_keyboard: [[{ text: '🎮 Открыть комнату', web_app: { url: u.toString() } }]],
  };
}

bot.use(async (ctx, next) => {
  try { await next(); } catch (e) { console.error('Bot middleware error:', e); }
});

// joinRoomByCodeViaBot использует ниже объявленный движок (переменная mafia будет присвоена позже)
let mafia; // будет установлен после инициализации Socket.IO
async function joinRoomByCodeViaBot(codeRaw, tgUser) {
  const code = sanitizeProvidedCode(codeRaw);
  if (!code) return { ok: false, error: 'bad_code' };
  if (!tgUser?.id) return { ok: false, error: 'bad_user' };

  const user = await upsertTgUser({
    id: tgUser.id,
    first_name: tgUser.first_name,
    username: tgUser.username,
    photo_url: null,
  });

  const result = await prisma.$transaction(async (tx) => {
    const room = await tx.room.findUnique({
      where: { code },
      include: { players: { include: { user: true }, orderBy: { joinedAt: 'asc' } } },
    });
    if (!room) return { ok: false, error: 'room_not_found' };
    if (room.players.length >= MAX_PLAYERS) return { ok: false, error: 'room_full' };

    const already = await tx.roomPlayer.findFirst({
      where: { roomId: room.id, userId: user.id },
    });
    if (room.status !== Phase.LOBBY && !already) {
      return { ok: false, error: 'game_in_progress' };
    }

    // (бот): оставляем как было — без явного сброса ready
    await tx.roomPlayer.upsert({
      where: { roomId_userId: { roomId: room.id, userId: user.id } },
      update: { alive: true },
      create: { roomId: room.id, userId: user.id, alive: true },
    });

    const countAfter = await tx.roomPlayer.count({ where: { roomId: room.id } });
    if (countAfter > MAX_PLAYERS && !already) {
      await tx.roomPlayer.delete({ where: { roomId_userId: { roomId: room.id, userId: user.id } } });
      return { ok: false, error: 'room_full' };
    }

    await touchRoom(tx, room.id);
    return { ok: true, code, roomId: room.id };
  });

  if (result.ok) mafia?.emitRoomStateDebounced(result.code);
  return result;
}

bot.start(async (ctx) => {
  try {
    const payload = String(ctx.startPayload || '').trim();
    const m = payload.match(/^join-([A-Z0-9]{4,8})$/i);
    if (m) {
      const code = m[1].toUpperCase();
      const r = await joinRoomByCodeViaBot(code, ctx.from);
      if (r.ok) {
        await ctx.reply(
          `✅ Ты добавлен в комнату ${code}. Нажми кнопку ниже, чтобы открыть комнату:`,
          { reply_markup: openKeyboard(`join-${code}`) }
        );
      } else {
        const map = {
          room_not_found: 'Комната не найдена',
          room_full: 'Комната заполнена',
          game_in_progress: 'Игра уже идёт',
          bad_code: 'Код некорректен',
        };
        await ctx.reply(`⚠️ Не удалось войти: ${map[r.error] || r.error}`);
      }
      return;
    }

    await ctx.reply('👋 Привет! Жми, чтобы открыть игру в Telegram:', {
      reply_markup: openKeyboard('home'),
    });
  } catch (e) {
    console.error('start handler error:', e);
  }
});

bot.command('open', async (ctx) => {
  try {
    await ctx.reply('Открываем игру:', { reply_markup: openKeyboard('home') });
  } catch (e) {
    console.error('open handler error:', e);
  }
});
bot.command('invite', async (ctx) => {
  try {
    const url = `https://t.me/${BOT_USERNAME}?startapp=home`;
    await ctx.reply(`Приглашай друзей: ${url}`, { disable_web_page_preview: true });
  } catch (e) {
    console.error('invite handler error:', e);
  }
});
bot.on('web_app_data', async (ctx) => {
  try {
    const data = ctx.webAppData?.data || '';
    await ctx.reply(`📩 WebApp: ${data}`);
  } catch (e) {
    console.error('web_app_data handler error:', e);
  }
});
bot.catch((err, ctx) => console.error(`Bot error for update ${ctx?.update?.update_id}:`, err));

const webhookPath = `/${WEBHOOK_SECRET_PATH}`;
app.get(webhookPath, (_req, res) => res.json({ ok: true, hint: 'Use POST from Telegram' }));
const tgSecretCheck = (req, res, next) => {
  if (!WEBHOOK_SECRET_TOKEN) return next();
  const hdr = req.headers['x-telegram-bot-api-secret-token'];
  if (hdr !== WEBHOOK_SECRET_TOKEN) return res.status(401).end();
  next();
};
app.post(
  webhookPath,
  tgSecretCheck,
  // точечный rate-limit для вебхука
  webhookLimiter,
  bot.webhookCallback(webhookPath, WEBHOOK_SECRET_TOKEN ? { secretToken: WEBHOOK_SECRET_TOKEN } : undefined)
);

/* ============================ Helpers (DB + shaping) ============================ */
async function upsertTgUser(tgUser) {
  if (!tgUser?.id) throw new Error('tgUser.id required');
  const data = {
    firstName: tgUser.first_name ?? null,
    username: tgUser.username ?? null,
    photoUrl: tgUser.photo_url ?? null,
  };
  const user = await prisma.user.upsert({
    where: { tgUserId: BigInt(tgUser.id) },
    update: data,
    create: { tgUserId: BigInt(tgUser.id), ...data },
  });
  return user;
}
async function readRoomWithPlayersByCode(code, { game } = {}) {
  const where = { code, ...(game ? { game } : {}) };
  return prisma.room.findFirst({
    where,
    include: {
      players: { include: { user: true }, orderBy: { joinedAt: 'asc' } },
      matches: { orderBy: { id: 'desc' }, take: 1 },
    },
  });
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
// Локальный «паблик» почти не используется (ready не добавляем)
function toPublicPlayersLocal(players) {
  return players.map((p) => ({
    id: p.id,
    alive: p.alive,
    user: toPublicUser(p.user),
    role: null,
  }));
}
async function touchRoom(tx, roomId) {
  try {
    await tx.room.update({ where: { id: roomId }, data: { updatedAt: new Date() } });
  } catch {
    try {
      const r = await tx.room.findUnique({ where: { id: roomId }, select: { status: true } });
      if (r) await tx.room.update({ where: { id: roomId }, data: { status: r.status } });
    } catch {}
  }
}
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
function genCode(len = 5) {
  let s = '';
  for (let i = 0; i < len; i++) s += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return s;
}
function sanitizeProvidedCode(raw) {
  const code = String(raw || '').trim().toUpperCase();
  if (!/^[A-Z0-9]{4,8}$/.test(code)) return null;
  return code;
}

/* ============================ NEW: Гигиена членства ============================ */
// Удаляем пользователя из всех комнат со статусом из onlyStatuses (по умолчанию ENDED/LOBBY),
// кроме, опционально, keepRoomId. Пустые комнаты удаляем. Владелец — перевыставляется.
async function leaveOtherRooms({ userId, keepRoomId = null, onlyStatuses = [Phase.ENDED, Phase.LOBBY] }) {
  try {
    const rows = await prisma.roomPlayer.findMany({
      where: { userId, ...(keepRoomId ? { roomId: { not: keepRoomId } } : {}) },
      include: { room: true },
    });
    const targets = rows.filter(rp => !onlyStatuses || onlyStatuses.includes(rp.room.status));
    if (!targets.length) return;

    const affectedCodes = new Set();
    const newOwnerPairs = [];

    await prisma.$transaction(async (tx) => {
      for (const rp of targets) {
        await tx.roomPlayer.delete({ where: { id: rp.id } });

        const restCount = await tx.roomPlayer.count({ where: { roomId: rp.roomId } });
        if (restCount === 0) {
          mafia.cancelTimer(rp.roomId);
          await tx.room.delete({ where: { id: rp.roomId } });
        } else {
          // если уходил владелец — назначим самого раннего
          if (rp.room.ownerId === rp.userId) {
            const rest = await tx.roomPlayer.findMany({ where: { roomId: rp.roomId }, orderBy: { joinedAt: 'asc' } });
            if (rest?.[0]) {
              await tx.room.update({ where: { id: rp.roomId }, data: { ownerId: rest[0].userId } });
              newOwnerPairs.push({ roomId: rp.roomId, newOwnerPlayerId: rest[0].id });
            }
          }
          await touchRoom(tx, rp.roomId);
        }
        affectedCodes.add(rp.room.code);
      }
    });

    // помечаем новых владельцев «готовыми» в движке
    for (const p of newOwnerPairs) {
      try { await mafia.setReady(p.roomId, p.newOwnerPlayerId, true); } catch {}
    }

    // актуализируем стейт для затронутых комнат
    for (const code of affectedCodes) {
      try { mafia.emitRoomStateDebounced(code); } catch {}
    }
  } catch (e) {
    console.warn('leaveOtherRooms failed:', e?.message || e);
  }
}

// Локальная чистка завершённых комнат пользователя (из ЛОББИ больше не выгружаем)
async function cleanupUserEndedRooms(userId) {
  try { await leaveOtherRooms({ userId, keepRoomId: null, onlyStatuses: [Phase.ENDED] }); }
  catch (e) { console.warn('cleanupUserEndedRooms failed:', e?.message || e); }
}

/* ============================ Auth REST ============================ */
app.post('/auth/verify', async (req, res) => {
  const initData = getInitData(req);
  if (!initData) return res.status(400).json({ ok: false, error: 'initData_required' });
  if (!verifyInitData(initData, BOT_TOKEN)) return res.status(401).json({ ok: false, error: 'bad_signature' });
  if (!isInitDataFresh(initData)) return res.status(401).json({ ok: false, error: 'stale_init_data' });

  const tg = parseUser(initData);
  const userRow = await upsertTgUser({
    id: tg.id, first_name: tg.first_name, username: tg.username, photo_url: tg.photo_url
  });

  const token = signSession(userRow);
  return res.json({ ok: true, user: tg, ...(token ? { token } : {}) });
});

// Нативный "гость" для RN-клиента — возвращает {ok, user, token}
app.post('/auth/native/guest', async (req, res) => {
  try {
    const { deviceId, name, photoUrl } = req.body || {};
    if (!deviceId || typeof deviceId !== 'string') {
      return res.status(400).json({ ok: false, error: 'deviceId_required' });
    }
    const user = await prisma.user.upsert({
      where: { nativeId: deviceId },
      update: { firstName: name ?? null, photoUrl: photoUrl ?? null },
      create: { nativeId: deviceId, firstName: name ?? null, photoUrl: photoUrl ?? null },
    });
    const token = signSession(user);
    return res.json({ ok: true, user: {
      id: user.id,
      tgId: user.tgUserId?.toString?.() ?? null,
      nativeId: user.nativeId ?? null,
      first_name: user.firstName ?? null,
      username: user.username ?? null,
      photo_url: user.photoUrl ?? null,
    }, token });
  } catch (e) {
    console.error('POST /auth/native/guest', e);
    res.status(500).json({ ok: false, error: 'failed' });
  }
});

/* ============================ Avatar proxy (rate-limited) ============================ */
app.get('/avatar/:tgId', avatarLimiter, async (req, res) => {
  try {
    const tgId = String(req.params.tgId || '');
    if (!/^\d+$/.test(tgId)) return res.status(400).end();

    res.set('Cross-Origin-Resource-Policy', 'cross-origin');
    res.set('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800');
    res.set('Timing-Allow-Origin', '*');

    let photos;
    try {
      photos = await bot.telegram.getUserProfilePhotos(tgId, 0, 1);
    } catch (e) {
      const msg = e?.response?.description || '';
      if (String(msg).toLowerCase().includes('user not found')) return res.status(404).end();
      throw e;
    }
    if (!photos?.total_count) return res.status(404).end();

    const sizes = photos.photos[0];
    const best = sizes[sizes.length - 1];
    const file = await bot.telegram.getFile(best.file_id);
    const url = `https://api.telegram.org/file/bot${BOT_TOKEN}/${file.file_path}`;

    const etag = `W/"tgava-${file.file_path}"`;
    if (req.headers['if-none-match'] === etag) {
      res.status(304).end();
      return;
    }
    res.set('ETag', etag);

    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 8000);
    const r = await fetch(url, { signal: ac.signal });
    clearTimeout(t);

    if (!r.ok) return res.status(502).end();

    const contentType = r.headers.get('content-type') || 'image/jpeg';
    res.set('Content-Type', contentType);

    if (r.body && typeof r.body.getReader === 'function') {
      Readable.fromWeb(r.body).pipe(res);
    } else {
      const buf = Buffer.from(await r.arrayBuffer());
      res.end(buf);
    }
  } catch (e) {
    console.error('avatar proxy error:', e?.response?.description || e);
    return res.status(500).end();
  }
});

// Универсальный аватар по userId
app.get('/avatar/user/:userId', avatarLimiter, async (req, res) => {
  const uid = Number(req.params.userId);
  if (!Number.isFinite(uid) || uid <= 0) return res.status(400).end();
  try {
    const u = await prisma.user.findUnique({ where: { id: uid } });
    if (!u) return res.status(404).end();
    if (u.tgUserId) return res.redirect(302, `${PUBLIC_API_URL}/avatar/${String(u.tgUserId)}`);
    if (u.photoUrl) return res.redirect(302, u.photoUrl);
    return res.status(404).end();
  } catch (e) {
    console.error('avatar by userId error:', e?.message || e);
    return res.status(500).end();
  }
});

/* ============================ Self → активная комната пользователя ============================ */
app.get('/api/self/active-room', async (req, res) => {
  try {
    const auth = await authEither(req, { allowStale: true });
    if (!auth.ok) return res.status(auth.http || 401).json({ error: auth.error });

    const requestedGame = gameFromReq(req, null);
    const me = await prisma.user.findUnique({
      where: { id: auth.user.id },
      select: { id: true },
    });
    if (!me) return res.json({ code: null });

    const room = await prisma.room.findFirst({
      where: {
        players: { some: { userId: me.id } },
        ...(requestedGame ? { game: requestedGame } : {}),
      },
      orderBy: { updatedAt: 'desc' },
      select: { code: true, status: true, game: true },
    });

    return res.json(room ? { code: room.code, status: room.status, game: room.game } : { code: null });
  } catch (e) {
    console.error('GET /api/self/active-room', e);
    return res.status(500).json({ error: 'failed' });
  }
});

/* ============================ HTTP server + Socket.IO ============================ */
const server = http.createServer(app);

server.keepAliveTimeout = 120_000;
server.headersTimeout   = 125_000;

const io = new SocketIOServer(server, {
  pingInterval: 25_000,
  pingTimeout: 60_000,
  perMessageDeflate: false,
  // Доп. фильтр по Origin для WebSocket-рукопожатия
  allowRequest: (req, callback) => {
    const origin = req.headers.origin;
    if (!origin) return callback(null, true);
    const ok = isAllowedOrigin(origin);
    return callback(ok ? null : 'forbidden origin', ok);
  },
  cors: {
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);
      return cb(null, isAllowedOrigin(origin));
    },
    methods: ['GET', 'POST'],
    credentials: false,
  },
});
if (USE_REDIS && socketRedisAdapter) {
  // FIX: _WARN → console.warn
  socketRedisAdapter(io).catch((e) => console.warn('Socket adapter init failed:', e?.message || e));
}

/* ============================ Подключаем движок Мафии ============================ */
mafia = createMafiaEngine({
  prisma,
  io,
  enums: { Phase, Role, VoteType },
  config: { NIGHT_SEC, DAY_SEC, VOTE_SEC },
  withRoomLock,
  isLockError,
  redis,                         // ← пробрасываем Redis в движок
  redisPrefix: REDIS_PREFIX,     // ← и префикс ключей
});

/* ============================ Подключаем движок Аукциона ============================ */
const auction = createAuctionEngine({
  prisma,
  withRoomLock,   // тот же лок, что у мафии
  isLockError,    // та же проверка lock-ошибок
  // любое изменение состояния аукциона (в том числе по таймеру)
  // пушим всем игрокам комнаты
  onState: (publicState) => {
    try {
      if (!publicState || !publicState.code) return;
      io.to(`room:${publicState.code}`).emit('auction:state', publicState);
    } catch (e) {
      console.warn('auction onState emit error:', e?.message || e);
    }
  },
});


function auctionRoomPayload(room, players) {
  if (!room || room.game !== RoomGame.AUCTION) return null;
  const readySet = mafia.getReadySet(room.id);
  return {
    room: jsonSafe({
      id: room.id,
      code: room.code,
      status: room.status,
      ownerId: room.ownerId,
      dayNumber: room.dayNumber,
      phaseEndsAt: room.phaseEndsAt,
      game: room.game,
    }),
    players: jsonSafe(mafia.toPublicPlayers(players || room.players || [], { readySet })),
  };
}

function emitAuctionRoomState(room, players) {
  try {
    const payload = auctionRoomPayload(room, players);
    if (!payload) return;
    io.to(`room:${room.code}`).emit('room:state', payload);
  } catch (e) {
    console.warn('emitAuctionRoomState failed:', e?.message || e);
  }
}

async function emitAuctionRoomStateByCode(code) {
  try {
    const room = await readRoomWithPlayersByCode(code, { game: RoomGame.AUCTION });
    if (room) emitAuctionRoomState(room, room.players);
  } catch (e) {
    console.warn('emitAuctionRoomStateByCode failed:', e?.message || e);
  }
}
/* ============================ Room REST (после инициализации движка) ============================ */
// create
app.post('/api/rooms', createLimiter, async (req, res) => {
  try {
    const auth = await authEither(req);
    if (!auth.ok) return res.status(auth.http || 401).json({ error: auth.error });
    const owner = auth.user;

    const game = gameFromReq(req, DEFAULT_GAME);
    let code = sanitizeProvidedCode(req.body?.code);
    const tryCreate = async (codeForTry) =>
      prisma.$transaction(async (tx) => {
        const room = await tx.room.create({
          data: { code: codeForTry, ownerId: owner.id, status: Phase.LOBBY, dayNumber: 0, phaseEndsAt: null, game },
        });
        const ownerPlayer = await tx.roomPlayer.create({ data: { roomId: room.id, userId: owner.id, alive: true } });
        return { room, ownerPlayerId: ownerPlayer.id };
      });

    let created;
    if (code) {
      const exists = await prisma.room.findUnique({ where: { code } });
      if (exists) return res.status(409).json({ error: 'code_already_in_use' });
      created = await tryCreate(code);
    } else {
      const ATTEMPTS = 6;
      for (let i = 0; i < ATTEMPTS; i++) {
        const generated = genCode(5);
        try {
          created = await tryCreate(generated);
          code = generated;
          break;
        } catch (e) {
          if (e?.code === 'P2002') continue;
          throw e;
        }
      }
      if (!created) return res.status(500).json({ error: 'code_generation_failed' });
    }

    const full = await readRoomWithPlayersByCode(code, { game });

    // Владелец «готов» в движке
    if (game === RoomGame.MAFIA) {
      try { await mafia.setReady(full.id, created.ownerPlayerId, true); } catch {}
    }

    const readySet = mafia.getReadySet(full.id);
    const payload = {
      room: jsonSafe({
        id: full.id,
        code: full.code,
        status: full.status,
        ownerId: full.ownerId,
        dayNumber: full.dayNumber,
        phaseEndsAt: full.phaseEndsAt,
        game: full.game,
      }),
      // owner попадёт в readySet
      players: jsonSafe(mafia.toPublicPlayers(full.players, { readySet })),
      viewerIsOwner: true,
    };

    // ⚠️ Больше не чистим автоматически другие комнаты пользователя.
    return res.json(payload);
  } catch (e) {
    console.error('POST /api/rooms error:', e);
    return res.status(500).json({ error: 'failed' });
  }
});

// view room
app.get('/api/rooms/:code', async (req, res) => {
  try {
    const { code } = req.params;
    const auth = await authEither(req, { allowStale: true });
    let viewerIsOwner = false;
    let isMember = false;

    const expectedGame = gameFromReq(req, DEFAULT_GAME);
    const room = await readRoomWithPlayersByCode(code, { game: expectedGame || undefined });
    if (!room) return res.status(404).json({ error: 'room_not_found' });

    if (auth.ok) {
      viewerIsOwner = room.ownerId === auth.user.id;
      isMember = !!(await prisma.roomPlayer.findFirst({
        where: { roomId: room.id, userId: auth.user.id }
      }));
    }

    let playersPublic = [];
    if (isMember) {
      const readySet = mafia.getReadySet(room.id);
      playersPublic = jsonSafe(mafia.toPublicPlayers(room.players, { readySet }));
    }

    res.json({
      room: jsonSafe({
        id: room.id,
        code: room.code,
        status: room.status,
        ownerId: room.ownerId,
        dayNumber: room.dayNumber,
        phaseEndsAt: room.phaseEndsAt,
        game: room.game,
      }),
      players: playersPublic,
      playersCount: room.players.length,
      viewerIsOwner,
    });
  } catch (e) {
    console.error('GET /api/rooms/:code', e);
    res.status(500).json({ error: 'failed' });
  }
});

// room events (требует членства)
app.get('/api/rooms/:code/events', async (req, res) => {
  try {
    const auth = await authEither(req);
    if (!auth.ok) return res.status(auth.http || 401).json({ error: auth.error });

    const { code } = req.params;
    const expectedGame = gameFromReq(req, DEFAULT_GAME);
    const limit = Math.min(50, Math.max(1, parseInt(String(req.query.limit || '25'), 10) || 25));
    const room = await prisma.room.findUnique({
      where: { code },
      include: { matches: { orderBy: { id: 'desc' }, take: 1 } },
    });
    if (!room) return res.status(404).json({ error: 'room_not_found' });
    if (expectedGame && room.game !== expectedGame) return res.status(404).json({ error: 'room_not_found' });
    if (!room.matches.length) return res.json({ items: [] });

    const me = await prisma.roomPlayer.findFirst({
      where: { matchId: room.matches[0].id, roomId: room.id, userId: auth.user.id },
    }).catch(async () => {
      // совместимость со старыми БД (если нет matchId у roomPlayer)
      return prisma.roomPlayer.findFirst({ where: { roomId: room.id, userId: auth.user.id } });
    });
    if (!me) return res.status(403).json({ error: 'forbidden_not_member' });

    const rows = await prisma.event.findMany({
      where: { matchId: room.matches[0].id },
      orderBy: { id: 'desc' },
      take: limit,
    });
    res.json({ items: jsonSafe(rows.reverse()) });
  } catch (e) {
    console.error('GET /api/rooms/:code/events', e);
    res.status(500).json({ error: 'failed' });
  }
});

// join
app.post('/api/rooms/:code/join', joinLimiter, async (req, res) => {
  try {
    const { code } = req.params;

    const auth = await authEither(req);
    if (!auth.ok) return res.status(auth.http || 401).json({ error: auth.error });
    const user = auth.user;
    const expectedGame = gameFromReq(req, DEFAULT_GAME);

    const result = await prisma.$transaction(async (tx) => {
      const room = await tx.room.findUnique({
        where: { code },
        include: { players: { include: { user: true }, orderBy: { joinedAt: 'asc' } } },
      });
      if (!room) return { error: 'room_not_found' };
      if (expectedGame && room.game !== expectedGame) return { error: 'wrong_game' };
      if (room.players.length >= MAX_PLAYERS) return { error: 'room_full' };

      const already = await tx.roomPlayer.findFirst({ where: { roomId: room.id, userId: user.id } });
      if (room.status !== Phase.LOBBY && !already) {
        return { error: 'game_in_progress' };
      }

      // БОЛЬШЕ НЕ СБРАСЫВАЕМ готовность при повторном входе — сохраняем ready как есть
      await tx.roomPlayer.upsert({
        where: { roomId_userId: { roomId: room.id, userId: user.id } },
        update: { alive: true },
        create: { roomId: room.id, userId: user.id, alive: true, ready: false },
      });

      const countAfter = await tx.roomPlayer.count({ where: { roomId: room.id } });
      if (countAfter > MAX_PLAYERS && !already) {
        await tx.roomPlayer.delete({ where: { roomId_userId: { roomId: room.id, userId: user.id } } });
        return { error: 'room_full' };
      }

      await touchRoom(tx, room.id);

      const full = await tx.room.findUnique({
        where: { id: room.id },
        include: { players: { include: { user: true }, orderBy: { joinedAt: 'asc' } } },
      });

      const viewerIsOwner = full.ownerId === user.id;

      return {
        room: { id: full.id, code: full.code, status: full.status, ownerId: full.ownerId, dayNumber: full.dayNumber, phaseEndsAt: full.phaseEndsAt, game: full.game },
        players: full.players,
        viewerIsOwner,
      };
    });

    if (result?.error) {
      const status = (result.error === 'room_not_found' || result.error === 'wrong_game') ? 404 : 409;
      return res.status(status).json({ error: result.error });
    }

    if (result.room.game === RoomGame.AUCTION) {
      emitAuctionRoomState(result.room, result.players);
    } else {
      mafia.emitRoomStateDebounced(result.room.code);
    }
    const readySet = mafia.getReadySet(result.room.id);
    res.json({
      room: jsonSafe(result.room),
      players: jsonSafe(mafia.toPublicPlayers(result.players, { readySet })),
      viewerIsOwner: result.viewerIsOwner
    });

    // ⚠️ Больше не выполняем никаких авто-чисток по join.
  } catch (e) {
    console.error('POST /api/rooms/:code/join', e);
    res.status(500).json({ error: 'failed' });
  }
});

// leave
app.post('/api/rooms/:code/leave', async (req, res) => {
  try {
    const auth = await authEither(req);
    if (!auth.ok) return res.status(auth.http || 401).json({ error: auth.error });

    const { code } = req.params;
    const game = normalizeGame(req.body?.game ?? req.query?.game, DEFAULT_GAME);

    const result = await prisma.$transaction(async (tx) => {
      const room = await tx.room.findUnique({
        where: { code },
        include: { players: { include: { user: true }, orderBy: { joinedAt: 'asc' } }, matches: { take: 1, orderBy: { id: 'desc' } } },
      });
      if (!room) return { ok: false, error: 'room_not_found' };
      if (room.game !== game) return { ok: false, error: 'room_wrong_game' };

      const me = room.players.find((p) => p.userId === auth.user.id);
      if (!me) return { ok: true, deletedRoom: false, leftPlayerId: null, newOwnerPlayerId: null };

      const leftPlayerId = me.id;

      await tx.roomPlayer.delete({ where: { id: me.id } });

      const restCount = await tx.roomPlayer.count({ where: { roomId: room.id } });
      if (restCount === 0) {
        if (room.game === RoomGame.MAFIA) {
          mafia.cancelTimer(room.id);
        }
        await tx.room.delete({ where: { id: room.id } });
        return { ok: true, deletedRoom: true, leftPlayerId, newOwnerPlayerId: null };
      }

      let newOwnerPlayerId = null;
      const wasOwner = room.ownerId === me.userId;
      if (wasOwner) {
        const rest = await tx.roomPlayer.findMany({ where: { roomId: room.id }, orderBy: { joinedAt: 'asc' } });
        if (rest?.[0]) {
          await tx.room.update({ where: { id: room.id }, data: { ownerId: rest[0].userId } });
          newOwnerPlayerId = rest[0].id;
        }
      }

      await touchRoom(tx, room.id);
      return { ok: true, deletedRoom: false, leftPlayerId, newOwnerPlayerId };
    });

    if (!result.ok) return res.status(404).json({ error: result.error || 'failed' });

    // пост-обработка после REST leave
    try {
      const roomRow = await prisma.room.findUnique({ where: { code }, select: { id: true, game: true } });
      if (roomRow?.id) {
        if (roomRow.game === RoomGame.MAFIA) {
          await mafia.rebuildMafiaRoom(roomRow.id);
          try { await mafia.clearReadyForPlayer(roomRow.id, result.leftPlayerId || undefined); } catch {}
          if (result.newOwnerPlayerId) {
            try { await mafia.setReady(roomRow.id, result.newOwnerPlayerId, true); } catch {}
          }
          await mafia.emitMafiaTargets(roomRow.id);
          await mafia.emitMafiaTeam(roomRow.id);
        }

        if (roomRow.game === RoomGame.AUCTION) {
          try {
            if (result.deletedRoom) {
              auction.clearRoomStateById(roomRow.id);
            } else if (result.leftPlayerId) {
              auction.removePlayerFromAuction(roomRow.id, result.leftPlayerId);
            }

            const st = await auction.getState(code);
            if (st) {
              io.to(`room:${code}`).emit('auction:state', st);
            }
          } catch (e) {
            console.warn('auction update after REST leave failed:', e?.message || e);
          }
        }
      }
    } catch (e) { console.warn('post-leave rebuild failed:', e?.message || e); }

    if (game === RoomGame.AUCTION) {
      if (!result.deletedRoom) {
        await emitAuctionRoomStateByCode(code);
      }
    } else {
      mafia.emitRoomStateDebounced(code);
    }
    res.json({ ok: result.ok, deletedRoom: result.deletedRoom });
  } catch (e) {
    console.error('POST /api/rooms/:code/leave', e);
    res.status(500).json({ error: 'failed' });
  }
});
// to-lobby (reset)
app.post('/api/rooms/:code/to-lobby', async (req, res) => {
  try {
    const auth = await authEither(req);
    if (!auth.ok) return res.status(auth.http || 401).json({ ok: false, error: auth.error });

  const { code } = req.params;

  const room = await prisma.room.findUnique({
    where: { code },
    include: { players: true, matches: { orderBy: { id: 'desc' }, take: 1 } }
  });
  if (!room) return res.status(404).json({ ok: false, error: 'room_not_found' });
  if (room.game !== RoomGame.MAFIA) return res.status(400).json({ ok: false, error: 'wrong_game' });

    // ✅ Любой игрок может вернуть комнату в лобби, если матч завершён
    if (room.status !== Phase.ENDED && room.ownerId !== auth.user.id) {
      return res.status(403).json({ ok: false, error: 'forbidden_not_owner' });
    }

    await mafia.runPhaseOnce(room.id, async () => {
      await withRoomLock(room.id, async () => {
        mafia.cancelTimer(room.id);

        await prisma.$transaction(async (tx) => {
          await tx.vote.deleteMany({ where: { roomId: room.id, type: VoteType.LYNCH } });
          if (room.matches?.[0]) {
            await tx.nightAction.deleteMany({ where: { matchId: room.matches[0].id } });
          }

          await tx.roomPlayer.updateMany({
            where: { roomId: room.id },
            data: { alive: true, role: null, ready: false } // ← явный сброс ready
          });

          await tx.room.update({
            where: { id: room.id },
            data: { status: Phase.LOBBY, dayNumber: 0, phaseEndsAt: null },
          });
        });
      });
    });

    // Сбрасываем «готовность» для нового круга в движке (память/Redis)
    try { await mafia.clearReady(room.id); } catch {}

    // послать приватные self role:null
    const fresh = await prisma.room.findUnique({
      where: { code },
      include: { players: true }
    });
    if (fresh?.players?.length) {
      for (const p of fresh.players) {
        try {
          io.to(`player:${p.id}`).emit('private:self', {
            roomPlayerId: p.id,
            userId: p.userId,
            role: null,
            alive: true,
            roomCode: code,
          });
        } catch (e) {
          console.warn('private:self emit after to-lobby failed for player', p.id, e?.message || e);
        }
      }
    }

    mafia.emitRoomStateDebounced(code);
    await mafia.rebuildMafiaRoom(room.id);
    await mafia.emitMafiaTargets(room.id);
    await mafia.emitMafiaTeam(room.id);
    return res.json({ ok: true });
  } catch (e) {
    console.error('POST /api/rooms/:code/to-lobby', e);
    return res.status(500).json({ ok: false, error: 'failed' });
  }
});

/* ============================ Mafia START (REST) ============================ */
app.post('/api/mafia/:code/start', async (req, res) => {
  try {
    const auth = await authEither(req);
    if (!auth.ok) return res.status(auth.http || 401).json({ error: auth.error });

    const { code } = req.params;

    const room = await prisma.room.findUnique({
      where: { code },
      include: { players: { include: { user: true } } },
    });
    if (!room) return res.status(404).json({ error: 'room_not_found' });

    if (room.ownerId !== auth.user.id) return res.status(403).json({ error: 'forbidden_not_owner' });

    if (room.status !== Phase.LOBBY) return res.status(400).json({ error: 'already_started' });
    if (room.players.length < 4) return res.status(400).json({ error: 'need_at_least_4_players' });
    if (room.players.length > MAX_PLAYERS) return res.status(400).json({ error: 'room_full' });

    // ✅ Требуем «все готовы (кроме владельца)» — ТЕПЕРЬ по данным БД
    const notReady = room.players.filter(p => p.userId !== room.ownerId && !p.ready);
    if (notReady.length) {
      return res.status(400).json({
        error: 'need_all_ready',
        notReady: notReady.map(p => ({
          playerId: p.id,
          userId: p.userId,
          name: p.user?.firstName ?? p.user?.username ?? `#${p.id}`,
        })),
      });
    }

    await mafia.startGame(room.id);

    res.json({ ok: true, status: Phase.NIGHT });
  } catch (e) {
    console.error('POST /api/mafia/:code/start', e);
    res.status(500).json({ error: 'failed' });
  }
});

/* ============================ READY REST ============================ */
app.post('/api/rooms/:code/ready', async (req, res) => {
  try {
    // ����蠥� ���ॢ訩 initData ��� �⮩ ����樨 (JWT ��� ࠢ�� �ਮ��⭥�)
    const auth = await authEither(req, { allowStale: true });
    if (!auth.ok) return res.status(auth.http || 401).json({ ok: false, error: auth.error });
    const { code } = req.params;
    const { ready } = req.body || {};

    const expectedGame = gameFromReq(req, DEFAULT_GAME);
    const room = await readRoomWithPlayersByCode(code, { game: expectedGame || undefined });
    if (!room) return res.status(404).json({ ok: false, error: 'room_not_found' });
    if (expectedGame && room.game !== expectedGame) return res.status(404).json({ ok: false, error: 'wrong_game' });
    if (room.status !== Phase.LOBBY) return res.status(400).json({ ok: false, error: 'not_in_lobby' });
    const me = await prisma.roomPlayer.findFirst({ where: { roomId: room.id, userId: auth.user.id } });
    if (!me) return res.status(403).json({ ok: false, error: 'forbidden_not_member' });

    if (room.ownerId === auth.user.id) {
      // �������� �� ��४��砥� <��⮢>
      if (room.game === RoomGame.AUCTION) {
        emitAuctionRoomState(room, room.players);
      } else {
        mafia.emitRoomStateDebounced(code);
      }
      return res.json({ ok: true, ready: false });
    }

    // ? ᨭ�஭����㥬 � ��, � in-memory ���
    await prisma.roomPlayer.update({ where: { id: me.id }, data: { ready: !!ready } });
    await mafia.setReady(room.id, me.id, !!ready);
    if (room.game === RoomGame.AUCTION) {
      const players = (room.players || []).map((p) =>
        p.id === me.id ? { ...p, ready: !!ready } : p
      );
      emitAuctionRoomState(room, players);
    } else {
      mafia.emitRoomStateDebounced(code);
    }
    return res.json({ ok: true, ready: !!ready });
  } catch (e) {
    console.error('POST /api/rooms/:code/ready', e);
    return res.status(500).json({ ok: false, error: 'failed' });
  }
});
/* ============================ Socket.IO Auth ============================ */
io.use(async (socket, next) => {
  try {
    // 1) Bearer в headers или auth.token
    let token = '';
    const authHdr = String(socket.handshake.headers?.authorization || '');
    const m = authHdr.match(/^Bearer\s+(.+)$/i);
    if (m) token = m[1];
    if (!token && socket.handshake.auth?.token) token = String(socket.handshake.auth.token || '');

    if (token && (JWT_SECRET || APP_JWT_SECRET)) {
      try {
        const payload = verifyAny(token);
        const user = await prisma.user.findUnique({ where: { id: Number(payload.uid) } });
        if (user) { socket.data.user = user; return next(); }
      } catch { /* пробуем initData ниже */ }
    }

    // 2) Telegram initData
    const initData = String(socket.handshake.auth?.initData || '');
    if (!initData) return next(new Error('initData_required'));
    if (!verifyInitData(initData, BOT_TOKEN)) return next(new Error('bad_signature'));
    if (!isInitDataFresh(initData)) return next(new Error('stale_init_data'));

    const tg = parseUser(initData);
    if (!tg?.id) return next(new Error('bad_user'));
    socket.data.user = await upsertTgUser(tg);
    next();
  } catch (e) {
    next(e);
  }
});

/* ============================ Socket.IO events ============================ */
const ackSend = (cb, payload) => { if (typeof cb === 'function') { try { cb(payload); } catch {} } };
const ackOk   = (cb, extra = {}) => ackSend(cb, { ok: true, ...extra });
const ackErr  = (cb, error, extra = {}) => ackSend(cb, { ok: false, error, ...extra });

io.on('connection', (socket) => {
  const user = socket.data.user;
  const userRooms = new Set();
  socket.data.playerIds = socket.data.playerIds || new Set();

  // ⚠️ Больше НЕ выполняем авто-чистку комнат/игроков на коннекте — по требованиям продукта.

  socket.on('room:subscribe', async ({ code, game }) => {
    try {
      if (!code) return socket.emit('toast', { type: 'error', text: '��� ������� ����' });

      const expectedGame = game ? normalizeGame(game, null) : DEFAULT_GAME;
      const room = await readRoomWithPlayersByCode(code, { game: expectedGame || undefined });
      if (!room) return socket.emit('toast', { type: 'error', text: '������ �� �������' });
      if (expectedGame && room.game !== expectedGame) return socket.emit('toast', { type: 'error', text: '������ ��㣮�� ०���' });

      const me = await prisma.roomPlayer.findFirst({ where: { roomId: room.id, userId: user.id } });
      if (!me) return socket.emit('toast', { type: 'error', text: '���砫� ���㯨� � �������' });

      socket.join(`room:${code}`);
      socket.join(`player:${me.id}`);
      userRooms.add(`room:${code}`);
      socket.data.playerIds.add(me.id);

      if (room.game === RoomGame.MAFIA && mafia.MAFIA_ROLES.has(me.role)) {
        socket.join(`maf:${room.id}`);
      }

      // ������ �������: ������� �ਢ��� ����� ��ப�, ��⥬ �㡫�筮� ���ﭨ� �������.
      try {
        socket.emit('private:self', await mafia.privateSelfState(me.id));
      } catch (e) {
        console.warn('private:self emit on subscribe failed:', e?.message || e);
      }

      if (room.game === RoomGame.MAFIA) {
        try {
          await mafia.emitRoomStateNow(code);
        } catch {}

        const rt = mafiaTimerFor(room.id);
        if (rt?.endsAt) {
          socket.emit('timer:update', {
            phase: rt.phase || room.status,
            endsAt: rt.endsAt,
            serverTime: Date.now(),
            dayNumber: room.dayNumber,
            round: rt.round || 1
          });
        }

        await mafia.emitMafiaTargets(room.id);
        await mafia.emitMafiaTeam(room.id);
      } else if (room.game === RoomGame.AUCTION) {
        const readySet = mafia.getReadySet(room.id);
        socket.emit('room:state', {
          room: jsonSafe({
            id: room.id,
            code: room.code,
            status: room.status,
            ownerId: room.ownerId,
            dayNumber: room.dayNumber,
            phaseEndsAt: room.phaseEndsAt,
            game: room.game,
          }),
          players: jsonSafe(mafia.toPublicPlayers(room.players, { readySet })),
          viewerIsOwner: room.ownerId === user.id,
        });
        try {
          const st = await auction.getState(code);
          if (st) socket.emit('auction:state', st);
        } catch (e) {
          console.warn('auction:state on subscribe failed:', e?.message || e);
        }
      }
    } catch (e) {
      console.error('room:subscribe error', e);
      socket.emit('toast', { type: 'error', text: '�� 㤠���� ���������� �� �������' });
    }
  });
  // === NEW: Обратносуместимое резюмирование с ETag/дельтой событий ===
  socket.on('room:resume', async ({ code, etag, lastEventId, game }, cb) => {
    try {
      if (!code) return ackErr(cb, 'room_not_found');
      const expectedGame = game ? normalizeGame(game, null) : DEFAULT_GAME;
      const room = await readRoomWithPlayersByCode(code, { game: expectedGame || undefined });
      if (!room) return ackErr(cb, 'room_not_found');
      if (expectedGame && room.game !== expectedGame) return ackErr(cb, 'wrong_game');

      const me = await prisma.roomPlayer.findFirst({ where: { roomId: room.id, userId: user.id } });
      if (!me) return ackErr(cb, 'forbidden_not_member');
      if (room.game !== RoomGame.MAFIA) return ackErr(cb, 'wrong_game');

      const state = await mafia.publicRoomState(code);

      // Если клиент актуален — только обновим таймер и вернём дельту событий
      if (state?.etag && etag && state.etag === etag) {
        if (state?.timer) {
          socket.emit('timer:update', { ...state.timer, serverTime: Date.now() });
        }
        let delta = [];
        if (room.matches?.[0] && Number.isFinite(Number(lastEventId))) {
          delta = await prisma.event.findMany({
            where: { matchId: room.matches[0].id, id: { gt: Number(lastEventId) } },
            orderBy: { id: 'asc' },
            take: 50,
          });
        }
        return ackOk(cb, { notModified: true, etag: state.etag, lastEventId: state.lastEventId, deltaEvents: jsonSafe(delta) });
      }

      // Иначе — полноценный ресинк (приватное состояние, паблик, таймеры и маф-сигналы)
      try { socket.join(`player:${me.id}`); } catch {}
      try { socket.join(`room:${code}`); } catch {}
      if (room.game === RoomGame.MAFIA && mafia.MAFIA_ROLES.has(me.role)) {
        try { socket.join(`maf:${room.id}`); } catch {}
      }

      try { socket.emit('private:self', await mafia.privateSelfState(me.id)); } catch {}
      try { await mafia.emitRoomStateNow(code); } catch {}
      if (room.game === RoomGame.MAFIA) {
        const rt = mafiaTimerFor(room.id);
        if (rt?.endsAt) {
          socket.emit('timer:update', {
            phase: rt.phase || room.status,
            endsAt: rt.endsAt,
            serverTime: Date.now(),
            dayNumber: room.dayNumber,
            round: rt.round || 1
          });
        }
        await mafia.emitMafiaTargets(room.id);
        await mafia.emitMafiaTeam(room.id);
      }

      let delta = [];
      if (room.matches?.[0] && Number.isFinite(Number(lastEventId))) {
        delta = await prisma.event.findMany({
          where: { matchId: room.matches[0].id, id: { gt: Number(lastEventId) } },
          orderBy: { id: 'asc' },
          take: 50,
        });
      }
      return ackOk(cb, { sentFull: true, etag: state?.etag || null, lastEventId: state?.lastEventId || null, deltaEvents: jsonSafe(delta) });
    } catch (e) {
      console.error('room:resume error', e);
      return ackErr(cb, 'failed');
    }
  });

  // ==== UPDATED: game:start с ACK и проверкой готовности по БД ====
  socket.on('game:start', async ({ code }, cb) => {
    try {
      if (!code) return;
      const room = await readRoomWithPlayersByCode(code, { game: RoomGame.MAFIA });
      if (!room) { socket.emit('toast', { type: 'error', text: 'Комната не найдена' }); return ackErr(cb, 'room_not_found'); }
      if (room.game !== RoomGame.MAFIA) { socket.emit('toast', { type: 'error', text: 'Другой режим комнаты' }); return ackErr(cb, 'wrong_game'); }
      if (room.ownerId !== user.id) { socket.emit('toast', { type: 'error', text: 'Только владелец может начать игру' }); return ackErr(cb, 'forbidden_not_owner'); }
      if (room.status !== Phase.LOBBY) { socket.emit('toast', { type: 'error', text: 'Игра уже начата' }); return ackErr(cb, 'already_started'); }
      if (room.players.length < 4) { socket.emit('toast', { type: 'error', text: 'Минимум 4 игрока' }); return ackErr(cb, 'need_at_least_4_players'); }

      // требуем готовность всех, кроме владельца — по БД
      const notReady = room.players.filter(p => p.userId !== room.ownerId && !p.ready);
      if (notReady.length) {
        const names = notReady.map(p => p.user?.firstName ?? p.user?.username ?? `#${p.id}`).join(', ');
        socket.emit('toast', { type: 'error', text: `Не все готовы: ${names}` });
        return ackErr(cb, 'need_all_ready', { notReady: notReady.map(p => ({ playerId: p.id, userId: p.userId })) });
      }

      await mafia.startGame(room.id);
      ackOk(cb);
    } catch (e) {
      console.error('game:start error', e);
      socket.emit('toast', { type: 'error', text: 'Не удалось начать игру' });
      ackErr(cb, 'failed');
    }
  });

  // ====== NIGHT ACTION (ACK) ======
  socket.on('night:act', async ({ code, targetPlayerId, opId }, cb) => {
    try {
      const room = await readRoomWithPlayersByCode(code, { game: RoomGame.MAFIA });
      if (!room || room.game !== RoomGame.MAFIA) return ackErr(cb, 'wrong_game');
      if (room.status !== Phase.NIGHT) return ackErr(cb, 'Сейчас не ночь');

      const alivePlayers = room.players.filter(p => p.alive);
      const me = alivePlayers.find(p => p.userId === user.id);
      if (!me) return ackErr(cb, 'Вы не можете действовать');

      const match = await prisma.match.findFirst({ where: { roomId: room.id }, orderBy: { id: 'desc' } });
      if (!match) return ackErr(cb, 'Матч не найден');

      const nightNumber = room.dayNumber + 1;
      const role = me.role;
      if (!role) return ackErr(cb, 'Роль не назначена');

      // Идемпотентность: если пришёл повторный opId — просто подтверждаем
      if (opId) {
        const key = `n:${room.id}:${match.id}:${nightNumber}:${me.id}:${String(opId).slice(0,64)}`;
        const fresh = await opRemember(key);
        if (!fresh) {
          mafia.emitRoomStateDebounced(room.code);
          await mafia.emitMafiaTargets(room.id);
          return ackOk(cb);
        }
      }

      let target = null;
      if (targetPlayerId) {
        target = await prisma.roomPlayer.findUnique({ where: { id: Number(targetPlayerId) } });
        if (!target || target.roomId !== room.id) return ackErr(cb, 'Неверная цель');
      }

      // Снайпер может пропустить ход без записи
      if (role === Role.SNIPER && !target) {
        mafia.emitRoomStateDebounced(room.code);
        await mafia.emitMafiaTargets(room.id);
        const ready = await mafia.isNightReady(room.id, match.id, nightNumber);
        if (ready) await mafia.resolveNight(room.id);
        return ackOk(cb);
      }

      const existing = await prisma.nightAction.findUnique({
        where: { matchId_nightNumber_actorPlayerId: { matchId: match.id, nightNumber, actorPlayerId: me.id } },
      });
      const allowRetarget = mafia.MAFIA_ROLES.has(role);
      if (existing && !allowRetarget) return ackErr(cb, 'Ход на эту ночь уже сделан');

      const validation = await mafia.validateNightTarget({ room, match, actor: me, role, target, nightNumber });
      if (!validation.ok) return ackErr(cb, validation.error || 'Цель невалидна');

      if (existing && allowRetarget) {
        await prisma.nightAction.update({
          where: { id: existing.id },
          data: { targetPlayerId: target?.id || null, role },
        });
      } else {
        await prisma.nightAction.create({
          data: { matchId: match.id, nightNumber, actorPlayerId: me.id, role, targetPlayerId: target?.id || null },
        });
      }

      mafia.emitRoomStateDebounced(room.code);
      await mafia.emitMafiaTargets(room.id);

      const ready = await mafia.isNightReady(room.id, match.id, nightNumber);
      if (ready) await mafia.resolveNight(room.id);

      return ackOk(cb);
    } catch (e) {
      console.error('night:act error', e);
      return ackErr(cb, 'Ошибка ночного действия');
    }
  });

  // ====== VOTE CAST (ACK) ======
  socket.on('vote:cast', async ({ code, targetPlayerId, opId }, cb) => {
    try {
      const room = await readRoomWithPlayersByCode(code, { game: RoomGame.MAFIA });
      if (!room || room.game !== RoomGame.MAFIA) return ackErr(cb, 'wrong_game');
      if (room.status !== Phase.VOTE) return ackErr(cb, 'Сейчас не голосование');

      const alivePlayers = room.players.filter(p => p.alive);
      const me = alivePlayers.find(p => p.userId === user.id);
      if (!me) return ackErr(cb, 'Мёртвые не голосуют');

      const round = await mafia.currentVoteRound(room.id, room.dayNumber);

      if (opId) {
        const key = `v:${room.id}:${room.dayNumber}:${round}:${user.id}:${String(opId).slice(0,64)}`;
        const fresh = await opRemember(key);
        if (!fresh) {
          io.to(`room:${room.code}`).emit('vote:progress', await mafia.voteProgress(room.id, room.dayNumber, round));
          mafia.emitRoomStateDebounced(room.code);
          return ackOk(cb);
        }
      }

      let target = null;
      if (targetPlayerId) {
        target = await prisma.roomPlayer.findUnique({ where: { id: Number(targetPlayerId) } });
        if (!target || target.roomId !== room.id || !target.alive) {
          return ackErr(cb, 'Цель невалидна');
        }
      }

      if (round === 2) {
        const leaders = await mafia.leadersOfRound1(room.id, room.dayNumber);
        if (leaders.length > 0) {
          const allowed = new Set(leaders);
          if (!target || !allowed.has(target.id)) {
            return ackErr(cb, 'Голосуйте среди лидеров переголосования');
          }
        }
      }

      await prisma.vote.upsert({
        where: { roomId_voterId_type_dayNumber_round: { roomId: room.id, voterId: user.id, type: VoteType.LYNCH, dayNumber: room.dayNumber, round } },
        update: { targetPlayerId: target?.id || null },
        create: { roomId: room.id, voterId: user.id, type: VoteType.LYNCH, dayNumber: room.dayNumber, round, targetPlayerId: target?.id || null },
      });

      io.to(`room:${room.code}`).emit('vote:progress', await mafia.voteProgress(room.id, room.dayNumber, round));
      mafia.emitRoomStateDebounced(room.code);

      const allVoted = await mafia.allAliveVoted(room.id, room.dayNumber, round);
      if (allVoted) await mafia.resolveVote(room.id);

      return ackOk(cb);
    } catch (e) {
      console.error('vote:cast error', e);
      return ackErr(cb, 'Ошибка голосования');
    }
  });

    // ====== READY (ACK) ======
  socket.on('ready:set', async ({ code, ready, game }, cb) => {
    try {
      if (!code) return ackErr(cb, 'room_not_found');
      const expectedGame = game ? normalizeGame(game, null) : DEFAULT_GAME;
      const room = await readRoomWithPlayersByCode(code, { game: expectedGame || undefined });
      if (!room) return ackErr(cb, 'room_not_found');
      if (expectedGame && room.game !== expectedGame) return ackErr(cb, 'wrong_game');
      if (room.status !== Phase.LOBBY) return ackErr(cb, 'not_in_lobby');

      const me = await prisma.roomPlayer.findFirst({ where: { roomId: room.id, userId: user.id } });
      if (!me) return ackErr(cb, 'forbidden_not_member');
      if (room.ownerId === user.id) {
        // �������� �� �⬥砥� "��⮢"
        if (room.game === RoomGame.AUCTION) {
          emitAuctionRoomState(room, room.players);
        } else {
          mafia.emitRoomStateDebounced(code);
        }
        return ackOk(cb, { ready: false });
      }
      // ? ᨭ�஭����� � �� + ���
      await prisma.roomPlayer.update({ where: { id: me.id }, data: { ready: !!ready } });
      await mafia.setReady(room.id, me.id, !!ready);
      if (room.game === RoomGame.AUCTION) {
        const players = (room.players || []).map((p) =>
          p.id === me.id ? { ...p, ready: !!ready } : p
        );
        emitAuctionRoomState(room, players);
      } else {
        mafia.emitRoomStateDebounced(code);
      }
      return ackOk(cb, { ready: !!ready });
    } catch (e) {
      console.error('ready:set error', e);
      return ackErr(cb, 'failed');
    }
  });
// ====== ROOM LEAVE (ACK) ======
  socket.on('room:leave', async ({ code, game }, cb) => {
    try {
      if (!code) return ackErr(cb, 'room_not_found');
      const expectedGame = game ? normalizeGame(game, null) : null;
      const room = await readRoomWithPlayersByCode(code, { game: expectedGame || undefined });
      if (!room) return ackErr(cb, 'room_not_found');
      if (expectedGame && room.game !== expectedGame) return ackErr(cb, 'wrong_game');

      let newOwnerPlayerId = null;
      let leftPlayerId = null;
      let deletedRoom = false;

      await withRoomLock(room.id, async () => {
        await prisma.$transaction(async (tx) => {
          const me = await tx.roomPlayer.findFirst({ where: { roomId: room.id, userId: user.id } });
          if (!me) return;

          leftPlayerId = me.id;

          await tx.roomPlayer.delete({ where: { id: me.id } });

          const restCount = await tx.roomPlayer.count({ where: { roomId: room.id } });
          if (restCount === 0) {
            if (room.game === RoomGame.MAFIA) mafia.cancelTimer(room.id);
            await tx.room.delete({ where: { id: room.id } });
            deletedRoom = true;
            return;
          }

          if (me.userId === room.ownerId) {
            const rest = await tx.roomPlayer.findMany({ where: { roomId: room.id }, orderBy: { joinedAt: 'asc' } });
            if (rest?.[0]) {
              await tx.room.update({ where: { id: room.id }, data: { ownerId: rest[0].userId } });
              newOwnerPlayerId = rest[0].id;
            }
          }

          await touchRoom(tx, room.id);
        });
      });

      // ⚙️ Сразу отписываем текущее соединение от комнат
      try { socket.leave(`room:${code}`); } catch {}
      try {
        const pids = socket.data.playerIds || [];
        for (const pid of pids) {
          try { socket.leave(`player:${pid}`); } catch {}
        }
      } catch {}
      try { socket.leave(`maf:${room.id}`); } catch {}

      // 🔥 PATCH: обновляем аукцион после выхода игрока по сокету
      if (room.game === RoomGame.AUCTION) {
        try {
          if (deletedRoom) {
            auction.clearRoomStateById(room.id);
          } else if (leftPlayerId != null) {
            auction.removePlayerFromAuction(room.id, leftPlayerId);
            const st = await auction.getState(code);
            if (st) {
              io.to(`room:${code}`).emit('auction:state', st);
            }
          }
        } catch (e) {
          console.warn('auction update on room:leave failed:', e?.message || e);
        }
      }

      ackOk(cb);

      if (room.game === RoomGame.AUCTION) {
        if (!deletedRoom) {
          await emitAuctionRoomStateByCode(code);
        }
      } else {
        mafia.emitRoomStateDebounced(code);
        await mafia.rebuildMafiaRoom(room.id);
        if (newOwnerPlayerId) {
          try { await mafia.setReady(room.id, newOwnerPlayerId, true); } catch {}
        }
        await mafia.emitMafiaTargets(room.id);
        await mafia.emitMafiaTeam(room.id);
      }
    } catch (e) {
      console.error('room:leave error', e);
      return ackErr(cb, 'failed');
    }
  });

  // ====== AUCTION EVENTS ======

  // Старт аукциона (только владелец, все кроме него должны быть "готовы")
  socket.on('auction:start', async ({ code }, cb) => {
    try {
      if (!code) return ackErr(cb, 'room_not_found');
      const res = await auction.start(code, user.id);
      if (!res.ok) {
        const map = {
          room_not_found: 'Комната не найдена',
          forbidden_not_owner: 'Только владелец может начать аукцион',
          need_at_least_2_players: 'Нужно минимум 2 игрока',
          need_ready_players: 'Нужно, чтобы все (кроме владельца) нажали «Готов»',
          already_started: 'Аукцион уже запущен',
        };
        const text = map[res.error] || 'Не удалось запустить аукцион';
        socket.emit('toast', { type: 'error', text });
        return ackErr(cb, res.error || 'failed');
      }
      io.to(`room:${code}`).emit('auction:state', res.state);
      return ackOk(cb);
    } catch (e) {
      console.error('auction:start error', e);
      socket.emit('toast', { type: 'error', text: 'Ошибка запуска аукциона' });
      return ackErr(cb, 'failed');
    }
  });

  // Ставка игрока
  socket.on('auction:bid', async ({ code, amount }, cb) => {
    try {
      if (!code) return ackErr(cb, 'room_not_found');
      const res = await auction.bid(code, user.id, amount);
      if (!res.ok) {
        const map = {
          room_not_found: 'Комната не найдена',
          not_running: 'Аукцион ещё не запущен',
          not_player: 'Вы не в этой комнате',
          not_participant: 'Вы не участвуете в аукционе',
          bad_amount: 'Неверная сумма ставки',
          not_enough_money: 'Недостаточно денег',
          
          bid_below_base: '�?�?��? ������� ���',
        };
        const text = map[res.error] || 'Не удалось принять ставку';
        socket.emit('toast', { type: 'error', text });
        return ackErr(cb, res.error || 'failed');
      }
      io.to(`room:${code}`).emit('auction:state', res.state);
      return ackOk(cb);
    } catch (e) {
      console.error('auction:bid error', e);
      socket.emit('toast', { type: 'error', text: 'Ошибка при ставке' });
      return ackErr(cb, 'failed');
    }
  });

  // Явная синхронизация состояния (на всякий случай)
  socket.on('auction:sync', async ({ code }, cb) => {
    try {
      if (!code) return ackErr(cb, 'room_not_found');
      const st = await auction.getState(code);
      if (st) socket.emit('auction:state', st);
      return ackOk(cb, { hasState: !!st });
    } catch (e) {
      console.error('auction:sync error', e);
      return ackErr(cb, 'failed');
    }
  });

  // Настройки аукциона (только владелец, только в лобби)
  socket.on('auction:configure', async ({ code, rules, slots }, cb) => {
    try {
      if (!code) return ackErr(cb, 'room_not_found', { errorText: 'Комната не найдена' });
      const res = await auction.configure(code, user.id, { rules, slots });
      if (!res.ok) {
        const map = {
          room_not_found: 'Комната не найдена',
          forbidden_not_owner: 'Только владелец может менять настройки',
          forbidden_running: 'Нельзя менять настройки во время аукциона',
        };
        const text = map[res.error] || 'Не удалось применить настройки';
        socket.emit('toast', { type: 'error', text });
        return ackErr(cb, res.error || 'failed', { errorText: text });
      }
      // если аукцион уже запущен — отдадим свежее состояние
      const st = await auction.getState(code);
      if (st) {
        io.to(`room:${code}`).emit('auction:state', st);
      }
      return ackOk(cb);
    } catch (e) {
      console.error('auction:configure error', e);
      socket.emit('toast', { type: 'error', text: 'Ошибка применения настроек' });
      return ackErr(cb, 'failed');
    }
  });

  // Пауза (только владелец)
  socket.on('auction:pause', async ({ code }, cb) => {
    try {
      if (!code) return ackErr(cb, 'room_not_found');
      const res = await auction.pause(code, user.id);
      if (!res.ok) {
        const map = {
          room_not_found: 'Комната не найдена',
          forbidden_not_owner: 'Только владелец может поставить на паузу',
          not_running: 'Аукцион ещё не запущен',
        };
        const text = map[res.error] || 'Не удалось поставить на паузу';
        socket.emit('toast', { type: 'error', text });
        return ackErr(cb, res.error || 'failed');
      }
      if (res.state) {
        io.to(`room:${code}`).emit('auction:state', res.state);
      }
      return ackOk(cb);
    } catch (e) {
      console.error('auction:pause error', e);
      socket.emit('toast', { type: 'error', text: 'Ошибка паузы аукциона' });
      return ackErr(cb, 'failed');
    }
  });

  // Снятие с паузы (только владелец)
  socket.on('auction:resume', async ({ code }, cb) => {
    try {
      if (!code) return ackErr(cb, 'room_not_found');
      const res = await auction.resume(code, user.id);
      if (!res.ok) {
        const map = {
          room_not_found: 'Комната не найдена',
          forbidden_not_owner: 'Только владелец может продолжить аукцион',
          not_running: 'Аукцион ещё не запущен',
        };
        const text = map[res.error] || 'Не удалось продолжить аукцион';
        socket.emit('toast', { type: 'error', text });
        return ackErr(cb, res.error || 'failed');
      }
      if (res.state) {
        io.to(`room:${code}`).emit('auction:state', res.state);
      }
      return ackOk(cb);
    } catch (e) {
      console.error('auction:resume error', e);
      socket.emit('toast', { type: 'error', text: 'Ошибка продолжения аукциона' });
      return ackErr(cb, 'failed');
    }
  });

  // Принудительно завершить текущий слот и перейти к следующему (только владелец)
  socket.on('auction:next', async ({ code }, cb) => {
    try {
      if (!code) return ackErr(cb, 'room_not_found');
      const res = await auction.next(code, user.id);
      if (!res.ok) {
        const map = {
          room_not_found: 'Комната не найдена',
          forbidden_not_owner: 'Только владелец может переключать лоты',
          not_running: 'Аукцион ещё не запущен',
        };
        const text = map[res.error] || 'Не удалось перейти к следующему лоту';
        socket.emit('toast', { type: 'error', text });
        return ackErr(cb, res.error || 'failed');
      }
      if (res.state) {
        io.to(`room:${code}`).emit('auction:state', res.state);
      }
      return ackOk(cb);
    } catch (e) {
      console.error('auction:next error', e);
      socket.emit('toast', { type: 'error', text: 'Ошибка переключения лота' });
      return ackErr(cb, 'failed');
    }
  });

  socket.on('disconnect', (reason) => {
    try { console.log('disconnect:', reason, socket?.conn?.transport?.name); } catch {}
    userRooms.forEach((r) => socket.leave(r));
    // ⚠️ Убрали авто-leave по разрыву дисконнекта. Никаких scheduleAutoLeaveOnDisconnect.
  });
});

// маленький помощник, чтобы показать endsAt при подписке
function mafiaTimerFor(roomId) {
  try {
    return mafia?.getTimer?.(roomId) || null;
  } catch { return null; }
}

/* ============================ Cleanup helpers ============================ */
// NEW: Полное удаление комнаты со всеми зависимостями (матч, ивенты, действия, голоса, игроки)
async function hardDeleteRoom(tx, roomId) {
  const matches = await tx.match.findMany({ where: { roomId }, select: { id: true } });
  const matchIds = matches.map(m => m.id);
  try { await tx.vote.deleteMany({ where: { roomId } }); } catch {}
  if (matchIds.length) {
    try { await tx.nightAction.deleteMany({ where: { matchId: { in: matchIds } } }); } catch {}
    try { await tx.event.deleteMany({ where: { matchId: { in: matchIds } } }); } catch {}
    try { await tx.match.deleteMany({ where: { id: { in: matchIds } } }); } catch {}
  }
  try { await tx.roomPlayer.deleteMany({ where: { roomId } }); } catch {}
  await tx.room.delete({ where: { id: roomId } });
}

/* ============================ Cleanup & Server ============================ */
async function cleanupRooms() {
  const idleMinutes = Math.max(10, parseInt(ROOM_IDLE_MIN, 10) || 40); // не используется сейчас, оставлен для консистентности логов
  const noSocketMinutes = Math.max(1, parseInt(NO_SOCKET_IDLE_MIN, 10) || 5);
  const threshold = new Date(Date.now() - idleMinutes * 60 * 1000); // не используется
  const noSocketThreshold = new Date(Date.now() - noSocketMinutes * 60 * 1000);

  try {
    // ⚠️ Больше НИКАКОЙ чистки, кроме случая «нет сокетов > N минут».

    // NEW: Жёстко удаляем ЛЮБЫЕ комнаты (любой статус), если нет ни одного активного сокета > noSocketMinutes.
    const candidates = await prisma.room.findMany({
      where: { updatedAt: { lt: noSocketThreshold } },
      select: { id: true, code: true, status: true },
    });
    for (const r of candidates) {
      try {
        const sids = await io.in(`room:${r.code}`).allSockets();
        if (sids?.size > 0) continue; // есть активные коннекты — не трогаем
        mafia.cancelTimer(r.id);
        await prisma.$transaction(async (tx) => {
          await hardDeleteRoom(tx, r.id);
        });
        try { auction.clearRoomStateById?.(r.id); } catch {}
        console.log(`🧹 cleanupRooms: удалена комната ${r.code} (нет сокетов > ${noSocketMinutes}м, status=${r.status})`);
      } catch (e) {
        console.warn('cleanupRooms: hard delete failed:', e?.message || e);
      }
    }
  } catch (e) {
    console.error('cleanupRooms error:', e);
  }
}
const cleanupId = setInterval(cleanupRooms, 60 * 1000);
cleanupId?.unref?.();
cleanupRooms();

/* ============================ Start ============================ */
server.listen(PORT, async () => {
  console.log(`✅ API listening on ${PORT} (${NODE_ENV})`);
  console.log(`➡️  Health: ${PUBLIC_API_URL}/health`);
  console.log(`➡️  Version: ${PUBLIC_API_URL}/version`);

  if (USE_REDIS) {
    try { await redis.connect?.(); } catch {}
  }

  try {
    const hookUrl = `${PUBLIC_API_URL}${webhookPath}`;
    await bot.telegram.setWebhook(hookUrl, WEBHOOK_SECRET_TOKEN ? { secret_token: WEBHOOK_SECRET_TOKEN } : undefined);
    const maskedHook = NODE_ENV === 'production'
      ? `${PUBLIC_API_URL}/${WEBHOOK_SECRET_PATH.slice(0, 3)}***`
      : hookUrl;
    console.log(`🔗 Webhook set: ${maskedHook}${WEBHOOK_SECRET_TOKEN ? ' (with secret_token)' : ''}`);
  } catch (e) {
    console.error('setWebhook error:', e?.response?.description || e);
  }

  try {
    await bot.telegram.setChatMenuButton({
      menu_button: { type: 'web_app', text: '🎮 Play Team', web_app: { url: PUBLIC_APP_URL } },
    });
    await bot.telegram.setMyCommands([
      { command: 'open', description: 'Открыть игру' },
      { command: 'invite', description: 'Пригласить друзей' },
    ]);
    console.log('✅ Chat Menu Button & commands set');
  } catch (e) {
    console.error('setChatMenuButton/MyCommands error:', e?.response?.description || e);
  }

  await mafia.recoverTimersOnBoot();
  mafia.startDueRoomsScheduler();
});

// аккуратное выключение
function shutdown() {
  console.log('Graceful shutdown...');
  mafia.cancelAllTimers();
  io.close(() => {
    server.close(() => {
      const closeRedis = async () => {
        try { await redis?.quit?.(); } catch {}
        try { await socketIoPubClient?.quit?.(); } catch {}
        try { await socketIoSubClient?.quit?.(); } catch {}
      };
      Promise.resolve(closeRedis())
        .then(() => prisma.$disconnect())
        .finally(() => process.exit(0));
    });
  });
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
process.on('unhandledRejection', (r) => console.error('unhandledRejection:', r));
process.on('uncaughtException', (e) => { console.error('uncaughtException:', e); process.exitCode = 1; });

