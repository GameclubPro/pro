// server.v2.js
// Node.js 18+ — Express + Telegraf + Prisma (MySQL) + Socket.IO (Realtime Mafia Engine) + Redis* (optional)
// Публичные REST-роуты и имена socket-событий сохранены. Добавлены:
//   - GET/HEAD /api/rooms/:code/probe   (публичный probe комнаты)
//   - GET /healthz                      (короткий health 204)

require('dotenv').config();
require('express-async-errors'); // ловим async-ошибки в middleware

const http = require('http');
const express = require('express');
const compression = require('compression');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');

const { Server: SocketIOServer } = require('socket.io');
const { Telegraf } = require('telegraf');
const { PrismaClient, Phase, Role, VoteType } = require('@prisma/client');
const { verifyInitData, parseUser, parseInitData } = require('./verifyInitData');
const { Readable } = require('stream');
const { randomInt } = require('crypto');

const prisma = new PrismaClient();

/* ============================ ENV ============================ */
const {
  PORT = 3000,
  BOT_TOKEN,
  BOT_USERNAME,
  PUBLIC_API_URL,
  PUBLIC_APP_URL,
  WEBAPP_ORIGIN,
  WEBHOOK_SECRET_PATH,
  WEBHOOK_SECRET_TOKEN, // ← опционально: X-Telegram-Bot-Api-Secret-Token
  NODE_ENV = 'production',

  ROOM_IDLE_MIN = '40',
  ROOM_MAX_PLAYERS = '12',

  // Длительности фаз в секундах
  MAFIA_NIGHT_SEC = '70',
  MAFIA_DAY_SEC   = '60',
  MAFIA_VOTE_SEC  = '60',

  // CORS
  CORS_ALLOW_HTTP = '0',
  CORS_EXTRA_ORIGINS = '',

  // Redis (опционально)
  REDIS_URL = '',
  REDIS_PREFIX = 'mafia',

  // Свежеcть initData (сек): мин. 60, по умолчанию 900 (15 мин)
  INITDATA_MAX_AGE_SEC = '900',

  // Грейс перед авто-очисткой «офлайновых» участников (мс)
  AUTO_LEAVE_GRACE_MS = '120000',
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
// WEBHOOK_SECRET_TOKEN — опционально, если хотите доп. защиту вебхука

const MAX_PLAYERS = Math.max(4, parseInt(ROOM_MAX_PLAYERS, 10) || 12);
// 🛠️ Фикс фатального бага: "the NIGHT_SEC" → const NIGHT_SEC
const NIGHT_SEC = Math.max(20, parseInt(MAFIA_NIGHT_SEC, 10) || 70);
const DAY_SEC   = Math.max(20, parseInt(MAFIA_DAY_SEC, 10) || 60);
const VOTE_SEC  = Math.max(20, parseInt(MAFIA_VOTE_SEC, 10) || 60);
const ALLOW_HTTP = CORS_ALLOW_HTTP === '1';
const USE_REDIS = !!REDIS_URL;
const INITDATA_MAX_AGE = Math.max(60, parseInt(INITDATA_MAX_AGE_SEC, 10) || 900);

// JSON BigInt safe
const jsonSafe = (x) =>
  JSON.parse(JSON.stringify(x, (_, v) => (typeof v === 'bigint' ? v.toString() : v)));

const MAFIA_ROLES = new Set([Role.MAFIA, Role.DON]);

// 🕵️ Шериф НЕ должен определять Дона как мафию (по вашим правилам для 5 игроков)
const isSheriffDetectsMafia = (role) => role === Role.MAFIA;

/* ============================ Redis (optional) ============================ */
let redis = null;
let redlock = null;
let redisRateStore = null;
let socketRedisAdapter = null;

// Делаем ctor'ы ошибок доступными снаружи блока и добавляем общий хелпер
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

    try {
      const { createAdapter } = require('@socket.io/redis-adapter');
      socketRedisAdapter = async (io) => {
        const pubClient = new IORedis(REDIS_URL, { maxRetriesPerRequest: 2 });
        const subClient = pubClient.duplicate();
        io.adapter(createAdapter(pubClient, subClient));
      };
    } catch (e) {
      console.warn('Socket.IO Redis adapter not available, using in-memory adapter');
    }
  } catch (e) {
    console.error('Failed to init Redis:', e?.message || e);
  }
}

// small helper: distributed lock by room
async function withRoomLock(roomId, fn) {
  if (!redlock) {
    return await fn();
  }
  const resource = `${REDIS_PREFIX}:lock:room:${roomId}`;
  if (redlock.using) {
    return redlock.using([resource], 8000, fn);
  }
  const lock = await redlock.lock(resource, 8000);
  try {
    return await fn();
  } finally {
    try { await lock.unlock(); } catch {}
  }
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
    },
  },
  crossOriginOpenerPolicy: { policy: 'same-origin' },
  crossOriginResourcePolicy: { policy: 'same-origin' },
  referrerPolicy: { policy: 'no-referrer' },
  hsts: { maxAge: 31536000, includeSubDomains: true },
}));
app.use(compression());
app.use(morgan(NODE_ENV === 'production' ? 'combined' : 'dev'));
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
    if (!origin) return cb(null, true); // запросы без Origin — пускаем без CORS (RN)
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
  if (USE_REDIS && redisRateStore) {
    return rateLimit({
      ...base,
      store: new redisRateStore({
        sendCommand: (...args) => redis.call(...args),
        prefix: `${REDIS_PREFIX}:ratelimit:`,
      }),
    });
  }
  return rateLimit(base); // in-memory fallback
}
const createLimiter = makeLimiter({ windowMs: 10_000, max: 5 });
const joinLimiter   = makeLimiter({ windowMs: 10_000, max: 20 });
const avatarLimiter = makeLimiter({ windowMs: 60_000, max: 60 });

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

// Лаконичный health для LB/пингов (204 No Content)
app.get('/healthz', (_req, res) => res.status(204).end());

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
  const webAppUrl = code ? `${PUBLIC_APP_URL}/?join=${encodeURIComponent(code)}` : PUBLIC_APP_URL;

  return {
    inline_keyboard: [
      [{ text: '🎮 Открыть комнату', web_app: { url: webAppUrl } }],
    ],
  };
}

bot.use(async (ctx, next) => {
  try { await next(); } catch (e) { console.error('Bot middleware error:', e); }
});

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

// 🔐 Опциональная проверка X-Telegram-Bot-Api-Secret-Token
const tgSecretCheck = (req, res, next) => {
  if (!WEBHOOK_SECRET_TOKEN) return next();
  const hdr = req.headers['x-telegram-bot-api-secret-token'];
  if (hdr !== WEBHOOK_SECRET_TOKEN) return res.status(401).end();
  next();
};

app.post(
  webhookPath,
  tgSecretCheck,
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

async function readRoomWithPlayersByCode(code) {
  return prisma.room.findUnique({
    where: { code },
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
    first_name: u.firstName ?? null,
    username: u.username ?? null,
    photo_url: u.photoUrl ?? null,
  };
}

function toPublicPlayers(players) {
  return players.map((p) => ({
    id: p.id,
    alive: p.alive,
    user: toPublicUser(p.user),
    role: null,
  })); // роли скрыты
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

/* ============================ Хэлпер: серверное добавление в комнату «через бота» ============================ */
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

  if (result.ok) emitRoomStateDebounced(result.code);
  return result;
}

/* ============================ Auth REST ============================ */
app.post('/auth/verify', (req, res) => {
  const initData = getInitData(req);
  if (!initData) return res.status(400).json({ ok: false, error: 'initData_required' });
  const ok = verifyInitData(initData, BOT_TOKEN);
  if (!ok) return res.status(401).json({ ok: false, error: 'bad_signature' });
  if (!isInitDataFresh(initData)) return res.status(401).json({ ok: false, error: 'stale_init_data' });
  const user = parseUser(initData);
  res.json({ ok: true, user });
});

/* ============================ ⭐ Avatar proxy (rate-limited) ============================ */
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

/* ============================ Self → активная комната пользователя ============================ */
app.get('/api/self/active-room', async (req, res) => {
  try {
    const initData = getInitData(req);
    if (!initData) return res.status(400).json({ error: 'initData_required' });
    if (!verifyInitData(initData, BOT_TOKEN)) return res.status(401).json({ error: 'bad_signature' });
    if (!isInitDataFresh(initData)) return res.status(401).json({ error: 'stale_init_data' });

    const tg = parseUser(initData);
    if (!tg?.id) return res.status(400).json({ error: 'bad_user' });

    const me = await prisma.user.findUnique({
      where: { tgUserId: BigInt(tg.id) },
      select: { id: true },
    });
    if (!me) return res.json({ code: null });

    const room = await prisma.room.findFirst({
      where: { players: { some: { userId: me.id } } },
      orderBy: { updatedAt: 'desc' },
      select: { code: true, status: true },
    });

    if (!room) {
      return res.json({ code: null });
    }
    return res.json({ code: room.code, status: room.status });
  } catch (e) {
    console.error('GET /api/self/active-room', e);
    return res.status(500).json({ error: 'failed' });
  }
});

/* ============================ Room PROBE (public) ============================ */
/**
 * Лёгкая проверка кода комнаты без авторизации Telegram:
 * - 200 + json, если комната существует
 * - 404, если не найдена
 * Ничего приватного не отдаём — только счетчики/статус.
 */
app.get('/api/rooms/:code/probe', async (req, res) => {
  try {
    const code = sanitizeProvidedCode(req.params.code);
    if (!code) return res.status(400).json({ ok: false, error: 'bad_code' });

    const room = await prisma.room.findUnique({
      where: { code },
      select: {
        code: true,
        status: true,
        players: { select: { id: true } },
      },
    });

    if (!room) return res.status(404).json({ ok: false, error: 'room_not_found' });

    return res.json({
      ok: true,
      code: room.code,
      status: room.status,
      playersCount: room.players.length,
      maxPlayers: MAX_PLAYERS,
    });
  } catch (e) {
    console.error('GET /api/rooms/:code/probe', e);
    return res.status(500).json({ ok: false, error: 'failed' });
  }
});

/**
 * HEAD-вариант на случай очень лёгких пингов (без тела ответа).
 * 200 — есть комната, 404 — нет.
 */
app.head('/api/rooms/:code/probe', async (req, res) => {
  try {
    const code = sanitizeProvidedCode(req.params.code);
    if (!code) return res.status(400).end();
    const exists = await prisma.room.findUnique({ where: { code }, select: { id: true } });
    return res.status(exists ? 200 : 404).end();
  } catch {
    return res.status(500).end();
  }
});

/* ============================ Room REST ============================ */
app.post('/api/rooms', createLimiter, async (req, res) => {
  try {
    const initData = getInitData(req);
    const rawCode = req.body?.code;
    if (!initData) return res.status(400).json({ error: 'initData_required' });
    if (!verifyInitData(initData, BOT_TOKEN)) return res.status(401).json({ error: 'bad_signature' });
    if (!isInitDataFresh(initData)) return res.status(401).json({ error: 'stale_init_data' });

    const tgOwner = parseUser(initData);
    const owner = await upsertTgUser(tgOwner);

    let code = sanitizeProvidedCode(rawCode);
    const tryCreate = async (codeForTry) =>
      prisma.$transaction(async (tx) => {
        const room = await tx.room.create({
          data: { code: codeForTry, ownerId: owner.id, status: Phase.LOBBY, dayNumber: 0, phaseEndsAt: null },
        });
        await tx.roomPlayer.create({ data: { roomId: room.id, userId: owner.id, alive: true } });
        return room;
      });

    let room;
    if (code) {
      const exists = await prisma.room.findUnique({ where: { code } });
      if (exists) return res.status(409).json({ error: 'code_already_in_use' });
      room = await tryCreate(code);
    } else {
      const ATTEMPTS = 6;
      let created = null;
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
      room = created;
    }

    const full = await readRoomWithPlayersByCode(code);
    const payload = {
      room: jsonSafe({
        id: full.id,
        code: full.code,
        status: full.status,
        ownerId: full.ownerId,
        dayNumber: full.dayNumber,
        phaseEndsAt: full.phaseEndsAt,
      }),
      players: jsonSafe(toPublicPlayers(full.players)),
      viewerIsOwner: true,
    };
    return res.json(payload);
  } catch (e) {
    console.error('POST /api/rooms error:', e);
    return res.status(500).json({ error: 'failed' });
  }
});

app.get('/api/rooms/:code', async (req, res) => {
  try {
    const { code } = req.params;
    const viewerInit = getInitData(req);
    let viewerIsOwner = false;
    let viewerTgId = null;
    let isMember = false;

    if (viewerInit && verifyInitData(viewerInit, BOT_TOKEN)) {
      const tgViewer = parseUser(viewerInit);
      viewerTgId = String(tgViewer?.id || '');
    }

    const room = await readRoomWithPlayersByCode(code);
    if (!room) return res.status(404).json({ error: 'room_not_found' });

    if (viewerTgId) {
      const owner = await prisma.user.findUnique({ where: { id: room.ownerId } });
      if (owner && String(owner.tgUserId) === viewerTgId) viewerIsOwner = true;

      isMember = !!(await prisma.roomPlayer.findFirst({
        where: { roomId: room.id, user: { tgUserId: BigInt(viewerTgId) } }
      }));
    }

    res.json({
      room: jsonSafe({
        id: room.id,
        code: room.code,
        status: room.status,
        ownerId: room.ownerId,
        dayNumber: room.dayNumber,
        phaseEndsAt: room.phaseEndsAt,
      }),
      players: isMember ? jsonSafe(toPublicPlayers(room.players)) : [],
      playersCount: room.players.length,
      viewerIsOwner,
    });
  } catch (e) {
    console.error('GET /api/rooms/:code', e);
    res.status(500).json({ error: 'failed' });
  }
});

app.get('/api/rooms/:code/events', async (req, res) => {
  try {
    const initData = getInitData(req);
    if (!initData) return res.status(400).json({ error: 'initData_required' });
    if (!verifyInitData(initData, BOT_TOKEN)) return res.status(401).json({ error: 'bad_signature' });
    if (!isInitDataFresh(initData)) return res.status(401).json({ error: 'stale_init_data' });
    const tgUser = parseUser(initData);

    const { code } = req.params;
    const limit = Math.min(50, Math.max(1, parseInt(String(req.query.limit || '25'), 10) || 25));
    const room = await prisma.room.findUnique({
      where: { code },
      include: { matches: { orderBy: { id: 'desc' }, take: 1 } },
    });
    if (!room || !room.matches.length) return res.json({ items: [] });

    const me = await prisma.roomPlayer.findFirst({
      where: { roomId: room.id, user: { tgUserId: BigInt(tgUser.id) } },
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

app.post('/api/rooms/:code/join', joinLimiter, async (req, res) => {
  try {
    const { code } = req.params;
    const initData = getInitData(req);
    if (!initData) return res.status(400).json({ error: 'initData_required' });
    if (!verifyInitData(initData, BOT_TOKEN)) return res.status(401).json({ error: 'bad_signature' });
    if (!isInitDataFresh(initData)) return res.status(401).json({ error: 'stale_init_data' });

    const tgUser = parseUser(initData);
    const user = await upsertTgUser(tgUser);

    const result = await prisma.$transaction(async (tx) => {
      const room = await tx.room.findUnique({
        where: { code },
        include: { players: { include: { user: true }, orderBy: { joinedAt: 'asc' } } },
      });
      if (!room) return { error: 'room_not_found' };
      if (room.players.length >= MAX_PLAYERS) return { error: 'room_full' };

      const already = await tx.roomPlayer.findFirst({ where: { roomId: room.id, userId: user.id } });

      if (room.status !== Phase.LOBBY && !already) {
        return { error: 'game_in_progress' };
      }

      await tx.roomPlayer.upsert({
        where: { roomId_userId: { roomId: room.id, userId: user.id } },
        update: { alive: true },
        create: { roomId: room.id, userId: user.id, alive: true },
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

      const owner = await tx.user.findUnique({ where: { id: full.ownerId } });
      const viewerIsOwner = owner && String(owner.tgUserId) === String(tgUser.id);

      return {
        room: { id: full.id, code: full.code, status: full.status, ownerId: full.ownerId, dayNumber: full.dayNumber, phaseEndsAt: full.phaseEndsAt },
        players: full.players,
        viewerIsOwner,
      };
    });

    if (result?.error) {
      const status = result.error === 'room_not_found' ? 404 : 409;
      return res.status(status).json({ error: result.error });
    }

    emitRoomStateDebounced(result.room.code);
    res.json({
      room: jsonSafe(result.room),
      players: jsonSafe(toPublicPlayers(result.players)),
      viewerIsOwner: result.viewerIsOwner
    });
  } catch (e) {
    console.error('POST /api/rooms/:code/join', e);
    res.status(500).json({ error: 'failed' });
  }
});

app.post('/api/rooms/:code/leave', async (req, res) => {
  const { code } = req.params;
  const initData = getInitData(req);
  if (!initData) return res.status(400).json({ error: 'initData_required' });
  if (!verifyInitData(initData, BOT_TOKEN)) return res.status(401).json({ error: 'bad_signature' });
  if (!isInitDataFresh(initData)) return res.status(401).json({ error: 'stale_init_data' });

  const tgUser = parseUser(initData);

  try {
    const result = await prisma.$transaction(async (tx) => {
      const room = await tx.room.findUnique({
        where: { code },
        include: { players: { include: { user: true }, orderBy: { joinedAt: 'asc' } }, matches: { take: 1, orderBy: { id: 'desc' } } },
      });
      if (!room) return { ok: false, error: 'room_not_found' };

      const me = room.players.find((p) => String(p.user.tgUserId) === String(tgUser.id));
      if (!me) return { ok: true, deletedRoom: false };

      await tx.roomPlayer.delete({ where: { id: me.id } });

      const restCount = await tx.roomPlayer.count({ where: { roomId: room.id } });
      if (restCount === 0) {
        cancelTimer(room.id);
        await tx.room.delete({ where: { id: room.id } });
        return { ok: true, deletedRoom: true };
      }

      const wasOwner = room.ownerId === me.userId;
      if (wasOwner) {
        const rest = await tx.roomPlayer.findMany({ where: { roomId: room.id }, orderBy: { joinedAt: 'asc' } });
        if (rest?.[0]) {
          await tx.room.update({ where: { id: room.id }, data: { ownerId: rest[0].userId } });
        }
      }

      await touchRoom(tx, room.id);
      return { ok: true, deletedRoom: false };
    });

    if (!result.ok) return res.status(404).json({ error: result.error || 'failed' });

    emitRoomStateDebounced(code);
    res.json(result);
  } catch (e) {
    console.error('POST /api/rooms/:code/leave', e);
    res.status(500).json({ error: 'failed' });
  }
});

/* ============================ Room → LOBBY (reset) ============================ */
app.post('/api/rooms/:code/to-lobby', async (req, res) => {
  try {
    const { code } = req.params;
    const initData = getInitData(req);
    if (!initData) return res.status(400).json({ ok: false, error: 'initData_required' });
    if (!verifyInitData(initData, BOT_TOKEN)) return res.status(401).json({ ok: false, error: 'bad_signature' });
    if (!isInitDataFresh(initData)) return res.status(401).json({ ok: false, error: 'stale_init_data' });

    const tgUser = parseUser(initData);
    const room = await prisma.room.findUnique({
      where: { code },
      include: { players: true, matches: { orderBy: { id: 'desc' }, take: 1 } }
    });
    if (!room) return res.status(404).json({ ok: false, error: 'room_not_found' });
    const owner = await prisma.user.findUnique({ where: { id: room.ownerId } });
    if (!owner || String(owner.tgUserId) !== String(tgUser.id)) {
      return res.status(403).json({ ok: false, error: 'forbidden_not_owner' });
    }

    await runPhaseOnce(room.id, async () => {
      await withRoomLock(room.id, async () => {
        cancelTimer(room.id);

        await prisma.$transaction(async (tx) => {
          await tx.vote.deleteMany({ where: { roomId: room.id, type: VoteType.LYNCH } });
          if (room.matches?.[0]) {
            await tx.nightAction.deleteMany({ where: { matchId: room.matches[0].id } });
          }

          await tx.roomPlayer.updateMany({
            where: { roomId: room.id },
            data: { alive: true, role: null }
          });
          await tx.room.update({
            where: { id: room.id },
            data: { status: Phase.LOBBY, dayNumber: 0, phaseEndsAt: null },
          });
        });
      });
    });

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

    emitRoomStateDebounced(code);
    await rebuildMafiaRoom(room.id);
    await emitMafiaTargets(room.id);
    await emitMafiaTeam(room.id);
    return res.json({ ok: true });
  } catch (e) {
    console.error('POST /api/rooms/:code/to-lobby', e);
    return res.status(500).json({ ok: false, error: 'failed' });
  }
});

/* ============================ Mafia START (REST) ============================ */
app.post('/api/mafia/:code/start', async (req, res) => {
  try {
    const { code } = req.params;
    const initData = getInitData(req);
    if (!initData) return res.status(400).json({ error: 'initData_required' });
    if (!verifyInitData(initData, BOT_TOKEN)) return res.status(401).json({ error: 'bad_signature' });
    if (!isInitDataFresh(initData)) return res.status(401).json({ error: 'stale_init_data' });
    const tgUser = parseUser(initData);

    const room = await prisma.room.findUnique({
      where: { code },
      include: { players: { include: { user: true } } },
    });
    if (!room) return res.status(404).json({ error: 'room_not_found' });

    const owner = await prisma.user.findUnique({ where: { id: room.ownerId } });
    if (!owner || String(owner.tgUserId) !== String(tgUser.id)) return res.status(403).json({ error: 'forbidden_not_owner' });

    if (room.status !== Phase.LOBBY) return res.status(400).json({ error: 'already_started' });
    if (room.players.length < 4) return res.status(400).json({ error: 'need_at_least_4_players' });
    if (room.players.length > MAX_PLAYERS) return res.status(400).json({ error: 'room_full' });

    await startGame(room.id);

    res.json({ ok: true, status: Phase.NIGHT });
  } catch (e) {
    console.error('POST /api/mafia/:code/start', e);
    res.status(500).json({ error: 'failed' });
  }
});

/* ============================ Socket.IO ============================ */
const server = http.createServer(app);

server.keepAliveTimeout = 120_000;
server.headersTimeout   = 125_000;

const io = new SocketIOServer(server, {
  pingInterval: 25_000,
  pingTimeout: 60_000,
  perMessageDeflate: false,
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
  socketRedisAdapter(io).catch((e) => console.warn('Socket adapter init failed:', e?.message || e));
}

// 🔐 Аутентификация через handshake.auth.initData
io.use(async (socket, next) => {
  try {
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

const ackSend = (cb, payload) => { if (typeof cb === 'function') { try { cb(payload); } catch {} } };
const ackOk   = (cb, extra = {}) => ackSend(cb, { ok: true, ...extra });
const ackErr  = (cb, error, extra = {}) => ackSend(cb, { ok: false, error, ...extra });

const roomTimers = new Map(); // key: roomId => { timeout, phase, endsAt, round }

/* ===== Debounced room:state emitter ===== */
const roomStateDebounce = new Map(); // code -> timeoutId
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

// ===== Phase mutex per room
const phaseInFlight = new Set();
async function runPhaseOnce(roomId, fn) {
  if (phaseInFlight.has(roomId)) return;
  phaseInFlight.add(roomId);
  try { await fn(); }
  finally { phaseInFlight.delete(roomId); }
}

io.on('connection', (socket) => {
  const user = socket.data.user;
  const userRooms = new Set();
  socket.data.playerIds = socket.data.playerIds || new Set();

  socket.on('room:subscribe', async ({ code }) => {
    try {
      if (!code) return socket.emit('toast', { type: 'error', text: 'Код комнаты пуст' });

      const room = await readRoomWithPlayersByCode(code);
      if (!room) return socket.emit('toast', { type: 'error', text: 'Комната не найдена' });

      const me = await prisma.roomPlayer.findFirst({ where: { roomId: room.id, userId: user.id } });
      if (!me) return socket.emit('toast', { type: 'error', text: 'Сначала вступите в комнату' });

      socket.join(`room:${code}`);
      socket.join(`player:${me.id}`);
      userRooms.add(`room:${code}`);
      socket.data.playerIds.add(me.id);

      if (MAFIA_ROLES.has(me.role)) {
        socket.join(`maf:${room.id}`);
      }

      emitRoomStateDebounced(code);
      socket.emit('private:self', await privateSelfState(me.id));

      const rt = roomTimers.get(room.id);
      if (rt?.endsAt) {
        socket.emit('timer:update', { phase: room.status, endsAt: rt.endsAt, serverTime: Date.now(), dayNumber: room.dayNumber, round: rt.round || 1 });
      }

      await emitMafiaTargets(room.id);
      await emitMafiaTeam(room.id);
    } catch (e) {
      console.error('room:subscribe error', e);
      socket.emit('toast', { type: 'error', text: 'Не удалось подписаться на комнату' });
    }
  });

  socket.on('game:start', async ({ code }) => {
    try {
      if (!code) return;
      const room = await readRoomWithPlayersByCode(code);
      if (!room) return socket.emit('toast', { type: 'error', text: 'Комната не найдена' });
      if (room.ownerId !== user.id) return socket.emit('toast', { type: 'error', text: 'Только владелец может начать игру' });
      if (room.status !== Phase.LOBBY) return socket.emit('toast', { type: 'error', text: 'Игра уже начата' });
      if (room.players.length < 4) return socket.emit('toast', { type: 'error', text: 'Минимум 4 игрока' });

      await startGame(room.id);
    } catch (e) {
      console.error('game:start error', e);
      socket.emit('toast', { type: 'error', text: 'Не удалось начать игру' });
    }
  });

  // NIGHT ACTION (ACK)
  socket.on('night:act', async ({ code, targetPlayerId }, cb) => {
    try {
      const room = await readRoomWithPlayersByCode(code);
      if (!room || room.status !== Phase.NIGHT) return ackErr(cb, 'Сейчас не ночь');

      const me = await prisma.roomPlayer.findFirst({ where: { roomId: room.id, userId: user.id } });
      if (!me || !me.alive) return ackErr(cb, 'Вы не можете действовать');

      const match = await prisma.match.findFirst({ where: { roomId: room.id }, orderBy: { id: 'desc' } });
      if (!match) return ackErr(cb, 'Матч не найден');

      const nightNumber = room.dayNumber + 1;
      const role = me.role;
      if (!role) return ackErr(cb, 'Роль не назначена');

      let target = null;
      if (targetPlayerId) {
        target = await prisma.roomPlayer.findUnique({ where: { id: Number(targetPlayerId) } });
        if (!target || target.roomId !== room.id) return ackErr(cb, 'Неверная цель');
      }

      // Снайпер может пропустить ход без траты патрона
      if (role === Role.SNIPER && !target) {
        emitRoomStateDebounced(room.code);
        await emitMafiaTargets(room.id);
        const ready = await isNightReady(room.id, match.id, nightNumber);
        if (ready) await resolveNight(room.id);
        return ackOk(cb);
      }

      const existing = await prisma.nightAction.findUnique({
        where: { matchId_nightNumber_actorPlayerId: { matchId: match.id, nightNumber, actorPlayerId: me.id } },
      });
      const allowRetarget = MAFIA_ROLES.has(role);
      if (existing && !allowRetarget) return ackErr(cb, 'Ход на эту ночь уже сделан');

      const validation = await validateNightTarget({ room, match, actor: me, role, target, nightNumber });
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

      emitRoomStateDebounced(room.code);
      await emitMafiaTargets(room.id);

      const ready = await isNightReady(room.id, match.id, nightNumber);
      if (ready) await resolveNight(room.id);

      return ackOk(cb);
    } catch (e) {
      console.error('night:act error', e);
      return ackErr(cb, 'Ошибка ночного действия');
    }
  });

  // VOTE CAST (ACK)
  socket.on('vote:cast', async ({ code, targetPlayerId }, cb) => {
    try {
      const room = await readRoomWithPlayersByCode(code);
      if (!room || room.status !== Phase.VOTE) return ackErr(cb, 'Сейчас не голосование');

      const alivePlayers = room.players.filter(p => p.alive);
      const me = alivePlayers.find(p => p.userId === user.id);
      if (!me) return ackErr(cb, 'Мёртвые не голосуют');

      const round = await currentVoteRound(room.id, room.dayNumber);

      let target = null;
      if (targetPlayerId) {
        target = await prisma.roomPlayer.findUnique({ where: { id: Number(targetPlayerId) } });
        if (!target || target.roomId !== room.id || !target.alive) {
          return ackErr(cb, 'Цель невалидна');
        }
      }

      if (round === 2) {
        const leaders = await leadersOfRound1(room.id, room.dayNumber);
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

      io.to(`room:${room.code}`).emit('vote:progress', await voteProgress(room.id, room.dayNumber, round));
      emitRoomStateDebounced(room.code);

      const allVoted = await allAliveVoted(room.id, room.dayNumber, round);
      if (allVoted) await resolveVote(room.id);

      return ackOk(cb);
    } catch (e) {
      console.error('vote:cast error', e);
      return ackErr(cb, 'Ошибка голосования');
    }
  });

  // ROOM LEAVE (ACK)
  socket.on('room:leave', async ({ code }, cb) => {
    try {
      if (!code) return ackErr(cb, 'room_not_found');
      const room = await readRoomWithPlayersByCode(code);
      if (!room) return ackErr(cb, 'room_not_found');

      await withRoomLock(room.id, async () => {
        await prisma.$transaction(async (tx) => {
          const me = await tx.roomPlayer.findFirst({ where: { roomId: room.id, userId: user.id } });
          if (!me) {
            return;
          }

          await tx.roomPlayer.delete({ where: { id: me.id } });

          const restCount = await tx.roomPlayer.count({ where: { roomId: room.id } });
          if (restCount === 0) {
            cancelTimer(room.id);
            await tx.room.delete({ where: { id: room.id } });
            return;
          }

          if (me.userId === room.ownerId) {
            const rest = await tx.roomPlayer.findMany({ where: { roomId: room.id }, orderBy: { joinedAt: 'asc' } });
            if (rest?.[0]) {
              await tx.room.update({ where: { id: room.id }, data: { ownerId: rest[0].userId } });
            }
          }

          await touchRoom(tx, room.id);
        });
      });

      ackOk(cb);

      emitRoomStateDebounced(code);
      await rebuildMafiaRoom(room.id);
      await emitMafiaTargets(room.id);
      await emitMafiaTeam(room.id);
    } catch (e) {
      console.error('room:leave error', e);
      return ackErr(cb, 'failed');
    }
  });

  socket.on('disconnect', (reason) => {
    try { console.log('disconnect:', reason, socket?.conn?.transport?.name); } catch {}
    userRooms.forEach((r) => socket.leave(r));
    try {
      for (const pid of socket.data.playerIds || []) {
        scheduleAutoLeaveOnDisconnect(pid);
      }
    } catch (e) {
      console.warn('scheduleAutoLeaveOnDisconnect failed:', e?.message || e);
    }
  });
});

/* ======= Авто-leave по разрыву сокета (мягкий режим) ======= */
const pendingAutoLeave = new Set();
function scheduleAutoLeaveOnDisconnect(playerId, delayMs = Math.max(0, parseInt(AUTO_LEAVE_GRACE_MS, 10) || 120000)) {
  if (!playerId || pendingAutoLeave.has(playerId)) return;
  pendingAutoLeave.add(playerId);
  const t = setTimeout(async () => {
    pendingAutoLeave.delete(playerId);
    try {
      const sockets = await io.in(`player:${playerId}`).allSockets();
      if (sockets && sockets.size > 0) return;

      const rp = await prisma.roomPlayer.findUnique({
        where: { id: Number(playerId) },
        include: { room: true },
      });
      if (!rp || !rp.room) return;

      const roomId = rp.roomId;
      const code   = rp.room.code;
      const status = rp.room.status;

      if (status !== Phase.LOBBY && status !== Phase.ENDED) {
        return;
      }

      await withRoomLock(roomId, async () => {
        await prisma.$transaction(async (tx) => {
          const recheck = await io.in(`player:${playerId}`).allSockets();
          if (recheck && recheck.size > 0) return;

          await tx.roomPlayer.delete({ where: { id: rp.id } });

          const restCount = await tx.roomPlayer.count({ where: { roomId } });
          if (restCount === 0) {
            cancelTimer(roomId);
            await tx.room.delete({ where: { id: roomId } });
            return;
          }

          if (rp.userId === rp.room.ownerId) {
            const rest = await tx.roomPlayer.findMany({ where: { roomId }, orderBy: { joinedAt: 'asc' } });
            if (rest?.[0]) {
              await tx.room.update({ where: { id: roomId }, data: { ownerId: rest[0].userId } });
            }
          }
          await touchRoom(tx, roomId);
        });
      });

      emitRoomStateDebounced(code);
    } catch (e) {
      if (!isLockError(e)) console.warn('auto-leave on disconnect failed:', e?.message || e);
    }
  }, delayMs);
  t?.unref?.();
}

/* ============================ Engine (FSM + timers + redis-safe) ============================ */

async function publicRoomState(code) {
  const room = await readRoomWithPlayersByCode(code);
  if (!room) return { error: 'room_not_found' };

  const players = toPublicPlayers(room.players);

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

  return {
    room: { code: room.code, status: room.status, ownerId: room.ownerId, dayNumber: room.dayNumber, phaseEndsAt: room.phaseEndsAt },
    players,
    timer: endsAt ? { phase: room.status, endsAt, serverTime: Date.now(), round } : null,
    ...(vote ? { vote } : {}),
  };
}

async function privateSelfState(roomPlayerId) {
  const me = await prisma.roomPlayer.findUnique({ where: { id: Number(roomPlayerId) }, include: { room: true } });
  if (!me) return null;
  return { roomPlayerId: me.id, userId: me.userId, role: me.role, alive: me.alive, roomCode: me.room.code };
}

function composeRolesFor(n) {
  const R = Role;
  const packs = {
    6:  [R.DON, R.MAFIA, R.SHERIFF, R.DOCTOR, R.PROSTITUTE, R.CIVIL],
    7:  [R.DON, R.MAFIA, R.SHERIFF, R.DOCTOR, R.BODYGUARD, R.PROSTITUTE, R.CIVIL],
    8:  [R.DON, R.MAFIA, R.SHERIFF, R.DOCTOR, R.BODYGUARD, R.PROSTITUTE, R.JOURNALIST, R.CIVIL],
    9:  [R.DON, R.MAFIA, R.MAFIA, R.SHERIFF, R.DOCTOR, R.BODYGUARD, R.PROSTITUTE, R.JOURNALIST, R.CIVIL],
    10: [R.DON, R.MAFIA, R.MAFIA, R.SHERIFF, R.DOCTOR, R.BODYGUARD, R.PROSTITUTE, R.JOURNALIST, R.CIVIL, R.CIVIL],
    11: [R.DON, R.MAFIA, R.MAFIA, R.SHERIFF, R.DOCTOR, R.BODYGUARD, R.PROSTITUTE, R.JOURNALIST, R.SNIPER, R.CIVIL, R.CIVIL],
    12: [R.DON, R.MAFIA, R.MAFIA, R.SHERIFF, R.DOCTOR, R.BODYGUARD, R.PROSTITUTE, R.JOURNALIST, R.SNIPER, R.CIVIL, R.CIVIL, R.CIVIL],
  };
  if (packs[n]) return [...packs[n]];
  if (n === 4) return [R.MAFIA, R.CIVIL, R.CIVIL, R.CIVIL];
  if (n === 5) return [R.DON, R.MAFIA, R.SHERIFF, R.DOCTOR, R.CIVIL];
  if (n > 12) {
    const base = packs[12].slice();
    while (base.length < n) base.push(R.CIVIL);
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

async function startGame(roomId) {
  return runPhaseOnce(roomId, async () =>
    withRoomLock(roomId, async () => {
      const room = await prisma.room.findUnique({
        where: { id: roomId },
        include: { players: true, matches: { orderBy: { id: 'desc' }, take: 1 } }
      });
      if (!room || room.status !== Phase.LOBBY) return;

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
        include: { players: true, matches: { orderBy: { id: 'desc' }, take: 1 } }
      });

      await rebuildMafiaRoom(updated.id);

      await Promise.all(updated.players.map(async (p) => {
        const self = await privateSelfState(p.id);
        io.to(`player:${p.id}`).emit('private:self', self);
      }));

      schedulePhase(updated.id, Phase.NIGHT, NIGHT_SEC, { round: 1 });
      emitRoomStateDebounced(updated.code);
      io.to(`room:${updated.code}`).emit('toast', { type: 'info', text: 'Игра началась! Фаза: Ночь' });

      await emitMafiaTargets(updated.id);
      await emitMafiaTeam(updated.id);
    })
  );
}

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

  return !!(mafiaDone && docDone && sherDone && protDone && bodyDone && journDone);
}

function journalistCategory(role) {
  if (MAFIA_ROLES.has(role)) return 'mafia';
  if (role === Role.CIVIL) return 'civil';
  return 'power';
}

/* ========== Maf room (diff-based) ========== */
async function rebuildMafiaRoom(roomId) {
  try {
    const room = await prisma.room.findUnique({
      where: { id: roomId },
      include: { players: true }
    });
    if (!room) return;

    const mafRoom = `maf:${room.id}`;

    const currentSockets = await io.in(mafRoom).fetchSockets();
    const currentById = new Map(currentSockets.map(s => [s.id, s]));

    const desired = new Map();
    for (const p of room.players) {
      if (!(p.alive && MAFIA_ROLES.has(p.role))) continue;
      const sockets = await io.in(`player:${p.id}`).fetchSockets();
      for (const s of sockets) desired.set(s.id, s);
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

/* ============================ 🔄 mafia:team (точный состав) ============================ */
async function emitMafiaTeam(roomId) {
  const room = await prisma.room.findUnique({ where: { id: roomId }, include: { players: true } });
  if (!room) return;
  const items = room.players
    .filter(p => p.alive && MAFIA_ROLES.has(p.role))
    .map(p => ({ playerId: p.id, role: p.role }));
  io.to(`maf:${room.id}`).emit('mafia:team', { items });
}

/* ============================ resolveNight (redis-safe + once) ============================ */
async function resolveNight(roomId) {
  return runPhaseOnce(roomId, () =>
    withRoomLock(roomId, async () => {
      const room = await prisma.room.findUnique({
        where: { id: roomId },
        include: { players: true, matches: { orderBy: { id: 'desc' }, take: 1 } }
      });
      if (!room) return;
      if (room.status !== Phase.NIGHT) return;

      const match = room.matches[0];
      const nightNumber = room.dayNumber + 1;

      const actions = await prisma.nightAction.findMany({ where: { matchId: match.id, nightNumber } });

      const byActor = new Map();
      actions.forEach(a => byActor.set(a.actorPlayerId, a));

      const prostitute = room.players.find(p => p.alive && p.role === Role.PROSTITUTE);
      let blockedActors = new Set();
      if (prostitute) {
        const prAct = actions.find(a => a.actorPlayerId === prostitute.id && a.role === Role.PROSTITUTE);
        if (prAct?.targetPlayerId) {
          blockedActors.add(prAct.targetPlayerId);
        }
      }

      const sheriff = room.players.find(p => p.alive && p.role === Role.SHERIFF);
      const shAction = sheriff && actions.find(a => a.actorPlayerId === sheriff.id && a.role === Role.SHERIFF);
      const sheriffIsBlocked = !!(sheriff && blockedActors.has(sheriff.id));
      if (shAction?.targetPlayerId && !sheriffIsBlocked) {
        const target = room.players.find(p => p.id === shAction.targetPlayerId);
        const isMafia = target ? isSheriffDetectsMafia(target.role) : false;
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

      const doctor = room.players.find(p => p.alive && p.role === Role.DOCTOR);
      const docAction = doctor && actions.find(a => a.actorPlayerId === doctor.id && a.role === Role.DOCTOR);
      const docIsBlocked = !!(doctor && blockedActors.has(doctor.id));
      const savedId = (!docIsBlocked && docAction?.targetPlayerId) ? docAction.targetPlayerId : null;

      const body = room.players.find(p => p.alive && p.role === Role.BODYGUARD);
      const bodyAction = body && actions.find(a => a.actorPlayerId === body.id && a.role === Role.BODYGUARD);
      const bodyIsBlocked = !!(body && blockedActors.has(body.id));
      const guardedId = (!bodyIsBlocked && bodyAction?.targetPlayerId) ? bodyAction.targetPlayerId : null;

      const mafiaActors = room.players.filter(p => p.alive && MAFIA_ROLES.has(p.role) && !blockedActors.has(p.id));
      const mafiaVotes = mafiaActors
        .map(m => actions.find(a => a.actorPlayerId === m.id && MAFIA_ROLES.has(a.role) && a.targetPlayerId))
        .filter(Boolean);

      const tally = new Map();
      for (const v of mafiaVotes) {
        tally.set(v.targetPlayerId, (tally.get(v.targetPlayerId) || 0) + 1);
      }
      let mafiaTargetId = null; let max = 0; let leaders = [];
      for (const [t, c] of tally.entries()) {
        if (c > max) { max = c; leaders = [t]; }
        else if (c === max) { leaders.push(t); }
      }
      if (leaders.length === 1) mafiaTargetId = leaders[0];
      if (leaders.length > 1 && leaders.length > 0) {
        mafiaTargetId = leaders[Math.floor(Math.random() * leaders.length)];
      }

      const sniper = room.players.find(p => p.alive && p.role === Role.SNIPER);
      const snAction = sniper && actions.find(a => a.actorPlayerId === sniper.id && a.role === Role.SNIPER);
      const sniperIsBlocked = !!(sniper && blockedActors.has(sniper.id));
      const sniperTargetId = (!sniperIsBlocked && snAction?.targetPlayerId) ? snAction.targetPlayerId : null;

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

      if (after.status === Phase.ENDED) {
        await emitMafiaTargets(room.id);

        try {
          if (blockedActors && blockedActors.size) {
            for (const pid of blockedActors) {
              io.to(`player:${pid}`).emit('you:blocked', { nightNumber });
            }
          }
          if (savedId) {
            io.to(`player:${savedId}`).emit('you:healed', { nightNumber });
          }
          if (guardedId) {
            io.to(`player:${guardedId}`).emit('you:guarded', { nightNumber });
          }
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

        io.to(`room:${code}`).emit('reveal:all', { rolesById: rolesByIdAll });
        io.to(`room:${code}`).emit('match:ended', {
          winner: after.matches[0]?.winner || 'unknown',
          rolesById: rolesByIdAll,
          reason: 'after_night',
        });

        cancelTimer(room.id);
        return;
      }

      schedulePhase(room.id, Phase.DAY, DAY_SEC, { round: 1 });

      await emitMafiaTargets(room.id);

      try {
        if (blockedActors && blockedActors.size) {
          for (const pid of blockedActors) {
            io.to(`player:${pid}`).emit('you:blocked', { nightNumber });
          }
        }
        if (savedId) {
          io.to(`player:${savedId}`).emit('you:healed', { nightNumber });
        }
        if (guardedId) {
          io.to(`player:${guardedId}`).emit('you:guarded', { nightNumber });
        }
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
    })
  );
}

async function detectWinner(tx, roomId) {
  const players = await tx.roomPlayer.findMany({ where: { roomId } });
  const mafiaAlive = players.filter(p => p.alive && MAFIA_ROLES.has(p.role)).length;
  const civAlive = players.filter(p => p.alive && !MAFIA_ROLES.has(p.role)).length;
  if (mafiaAlive <= 0) return 'CIVIL';
  if (mafiaAlive >= civAlive) return 'MAFIA';
  return null;
}

function schedulePhase(roomId, phase, seconds, { round = 1 } = {}) {
  cancelTimer(roomId);
  const endsAt = Date.now() + seconds * 1000;
  const timeout = setTimeout(() => onPhaseTimeout(roomId, phase, round), seconds * 1000);
  if (timeout?.unref) { try { timeout.unref(); } catch {} }
  roomTimers.set(roomId, {
    timeout,
    phase,
    endsAt,
    round,
  });
  prisma.room.update({ where: { id: roomId }, data: { phaseEndsAt: new Date(endsAt) } }).catch(() => {});
  (async () => {
    try {
      const r = await prisma.room.findUnique({ where: { id: roomId } });
      if (r) io.to(`room:${r.code}`).emit('timer:update', { phase, endsAt, serverTime: Date.now(), round });
    } catch {}
  })();
}

function cancelTimer(roomId) {
  const rt = roomTimers.get(roomId);
  if (rt?.timeout) clearTimeout(rt.timeout);
  roomTimers.delete(roomId);
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
    if (isLockError(e)) return;
    cancelTimer(roomId);
    console.error('onPhaseTimeout error:', e);
  }
}

async function startVote(roomId) {
  return runPhaseOnce(roomId, () =>
    withRoomLock(roomId, async () => {
      const room = await prisma.room.findUnique({ where: { id: roomId }, include: { matches: { orderBy: { id: 'desc' }, take: 1 } } });
      if (!room || room.status !== Phase.DAY) return;

      await prisma.$transaction(async (tx) => {
        await tx.room.update({ where: { id: room.id }, data: { status: Phase.VOTE, phaseEndsAt: new Date(Date.now() + VOTE_SEC * 1000) } });
        await tx.event.create({ data: { matchId: room.matches[0].id, phase: Phase.VOTE, payload: { dayNumber: room.dayNumber, round: 1 } } });
      });

      const code = (await prisma.room.findUnique({ where: { id: room.id } })).code;

      schedulePhase(room.id, Phase.VOTE, VOTE_SEC, { round: 1 });
      emitRoomStateDebounced(code);
    })
  );
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

/* ============================ resolveVote (redis-safe + once) ============================ */
async function resolveVote(roomId) {
  return runPhaseOnce(roomId, () =>
    withRoomLock(roomId, async () => {
      const room = await prisma.room.findUnique({ where: { id: roomId }, include: { players: true, matches: { orderBy: { id: 'desc' }, take: 1 } } });
      if (!room || room.status !== Phase.VOTE) return;
      const match = room.matches[0];

      const round = await currentVoteRound(room.id, room.dayNumber);
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
        const leadersClean = leaders.filter(l => l !== 0);
        await prisma.$transaction(async (tx) => {
          await tx.event.create({ data: { matchId: match.id, phase: Phase.VOTE, payload: { dayNumber: room.dayNumber, tie: true, round: 1, leaders: leadersClean } } });
          await tx.room.update({ where: { id: room.id }, data: { phaseEndsAt: new Date(Date.now() + VOTE_SEC * 1000) } });
        });
        schedulePhase(room.id, Phase.VOTE, VOTE_SEC, { round: 2 });
        const code = room.code;
        io.to(`room:${code}`).emit('vote:runoff', { leaders: leadersClean, round: 2 });
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
          players: true,
          matches: { orderBy: { id: 'desc' }, take: 1 }
        }
      });
      const rolesByIdAll = Object.fromEntries(after.players.map(p => [p.id, p.role]));

      if (after.status === Phase.ENDED) {
        await emitMafiaTargets(room.id);
        io.to(`room:${code}`).emit('vote:result', {
          lynchedId: lynchedId || null,
          lynchedRole: lynchedRole || null,
        });
        emitRoomStateDebounced(code);

        io.to(`room:${code}`).emit('reveal:all', { rolesById: rolesByIdAll });
        io.to(`room:${code}`).emit('match:ended', {
          winner: after.matches[0]?.winner || 'unknown',
          rolesById: rolesByIdAll,
          reason: 'after_vote',
        });

        cancelTimer(room.id);
        return;
      }

      schedulePhase(room.id, Phase.NIGHT, NIGHT_SEC, { round: 1 });
      await emitMafiaTargets(room.id);
      await emitMafiaTeam(room.id);
      io.to(`room:${code}`).emit('vote:result', {
        lynchedId: lynchedId || null,
        lynchedRole: lynchedRole || null,
      });
      emitRoomStateDebounced(code);
    })
  );
}

/* ======= Target validation ======= */
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
      return { ok: true };
    }
    case Role.DOCTOR: {
      if (!target) return { ok: true };
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
      if (target.id === self) return { ok: false, error: 'Нельзя брать одного и того же игрока подряд' };
      const prev = await prevOf(Role.JOURNALIST);
      if (prev?.targetPlayerId && prev.targetPlayerId === target.id) {
        return { ok: false, error: 'Нельзя брать одного и того же игрока подряд' };
      }
      return { ok: true };
    }
    case Role.SNIPER: {
      if (!target) return { ok: true };
      if (target.id === self) return { ok: false, error: 'Нельзя стрелять в себя' };
      const shots = await prisma.nightAction.count({
        where: { matchId: match.id, actorPlayerId: actor.id, role: Role.SNIPER },
      });
      if (shots >= 1) return { ok: false, error: 'Патрон уже израсходован' };
      return { ok: true };
    }
    default:
      return { ok: true };
  }
}

/* ============================ приватная рассылка «меток мафии» ============================ */
async function emitMafiaTargets(roomId) {
  try {
    const room = await prisma.room.findUnique({
      where: { id: roomId },
      include: { matches: { orderBy: { id: 'desc' }, take: 1 } }
    });
    if (!room) return;

    if (!room.matches?.length || room.status !== Phase.NIGHT) {
      io.to(`maf:${room.id}`).emit('mafia:targets', { night: null, items: [] });
      return;
    }

    const match = room.matches[0];
    const nightNumber = room.dayNumber + 1;

    const actions = await prisma.nightAction.findMany({
      where: { matchId: match.id, nightNumber, role: { in: [Role.MAFIA, Role.DON] } }
    });

    const items = actions
      .map(a => ({ actorId: a.actorPlayerId, targetPlayerId: a.targetPlayerId }))
      .filter(x => x.targetPlayerId != null);

    io.to(`maf:${room.id}`).emit('mafia:targets', { night: nightNumber, items });
  } catch (e) {
    console.error('emitMafiaTargets error:', e);
  }
}

/* ============================ Recovery on Boot & Tick Scheduler ============================ */
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
      schedulePhase(r.id, r.status, Math.ceil(ms / 1000), { round });
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
          if (!isLockError(e)) console.warn('scheduler tick error:', e?.message || e);
        }
      }
    } catch (e) {
      console.warn('scheduler tick error:', e?.message || e);
    } finally {
      setTimeout(tick, 1000).unref?.();
    }
  };
  setTimeout(tick, 1000).unref?.();
}

/* ============================ Cleanup & Server ============================ */
async function cleanupRooms() {
  const idleMinutes = Math.max(10, parseInt(ROOM_IDLE_MIN, 10) || 40);
  const threshold = new Date(Date.now() - idleMinutes * 60 * 1000);
  try {
    const emptyRooms = await prisma.room.findMany({
      where: { status: Phase.LOBBY, players: { none: {} } },
      select: { id: true, code: true }
    });
    const emptyIds = emptyRooms.map(r => r.id).filter(id => id != null);
    if (emptyIds.length) {
      await prisma.room.deleteMany({ where: { id: { in: emptyIds } } });
      console.log(`🧹 cleanupRooms: удалены пустые лобби комнаты: ${emptyRooms.map(r => r.code).join(', ')}`);
    }

    const staleRooms = await prisma.room.findMany({
      where: { status: Phase.LOBBY, updatedAt: { lt: threshold } },
      include: { players: true }
    });
    const stale = staleRooms.filter(r => (r.players?.length || 0) <= 1);
    const staleIds = [...new Set(stale.map(r => r.id).filter(Boolean))];
    if (staleIds.length) {
      await prisma.room.deleteMany({ where: { id: { in: staleIds } } });
      console.log(`🧹 cleanupRooms: удалены неактивные лобби (<=1 игрок, idle>${idleMinutes}m): ${stale.map(r => r.code).join(', ')}`);
    }

    const maybeIdle = await prisma.room.findMany({
      where: { status: { in: [Phase.LOBBY, Phase.ENDED] }, updatedAt: { lt: threshold } },
      select: { id: true, code: true, status: true, updatedAt: true }
    });
    const toDrop = [];
    for (const r of maybeIdle) {
      try {
        const roomName = `room:${r.code}`;
        const sids = await io.in(roomName).allSockets();
        const socketsCount = sids?.size || 0;
        if (socketsCount === 0) toDrop.push(r.id);
      } catch {}
    }
    if (toDrop.length) {
      await prisma.room.deleteMany({ where: { id: { in: toDrop } } });
      console.log(`🧹 cleanupRooms: удалены комнаты без активных сокетов (idle>${idleMinutes}m): ${toDrop.length}`);
    }
  } catch (e) {
    console.error('cleanupRooms error:', e);
  }
}
const cleanupId = setInterval(cleanupRooms, 60 * 1000);
cleanupId?.unref?.();
cleanupRooms();

/* ============================ Errors ============================ */
app.use((_req, res) => res.status(404).json({ error: 'Not Found' }));
app.use((err, _req, res, _next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal Server Error' });
});

/* ============================ Start ============================ */
server.listen(PORT, async () => {
  console.log(`✅ API listening on ${PORT} (${NODE_ENV})`);
  console.log(`➡️  Health: ${PUBLIC_API_URL}/health`);
  console.log(`➡️  Version: ${PUBLIC_API_URL}/version`);

  const maskedPath = NODE_ENV === 'production'
    ? `/${WEBHOOK_SECRET_PATH.slice(0, 3)}***`
    : `/${WEBHOOK_SECRET_PATH}`;
  console.log(`➡️  Webhook path: ${PUBLIC_API_URL}${maskedPath}`);

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
      menu_button: {
        type: 'web_app',
        text: '🎮 Play Team',
        web_app: { url: PUBLIC_APP_URL },
      },
    });
    await bot.telegram.setMyCommands([
      { command: 'open', description: 'Открыть игру' },
      { command: 'invite', description: 'Пригласить друзей' },
    ]);
    console.log('✅ Chat Menu Button & commands set');
  } catch (e) {
    console.error('setChatMenuButton/MyCommands error:', e?.response?.description || e);
  }

  await recoverTimersOnBoot();
  startDueRoomsScheduler();
});

// аккуратное выключение
function shutdown() {
  console.log('Graceful shutdown...');
  cancelAllTimers();
  io.close(() => {
    server.close(() => {
      const closeRedis = async () => {
        try { await redis?.quit?.(); } catch {}
      };
      Promise.resolve(closeRedis())
        .then(() => prisma.$disconnect())
        .finally(() => process.exit(0));
    });
  });
}
function cancelAllTimers() {
  for (const [roomId] of roomTimers) cancelTimer(roomId);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
process.on('unhandledRejection', (r) => console.error('unhandledRejection:', r));
process.on('uncaughtException', (e) => { console.error('uncaughtException:', e); process.exitCode = 1; });
