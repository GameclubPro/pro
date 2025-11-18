// verifyInitData.js
// Верификация initData по документации Telegram Web Apps + безопасный парсинг user
// Экспортирует: verifyInitData, parseUser, parseInitData, isInitDataFresh

const crypto = require('crypto');

/** Парсит querystring initData в плоский объект { key: value } (все значения — строки) */
function parseQuery(str) {
  const params = new URLSearchParams(String(str || ''));
  const obj = {};
  for (const [k, v] of params.entries()) obj[k] = v;
  return obj;
}

/** Собирает data-check-string (все поля, кроме hash), сортировка по ключу, "k=v" через \n */
function buildDataCheckString(dataObj) {
  return Object.keys(dataObj)
    .filter((k) => k !== 'hash')
    .sort()
    .map((k) => `${k}=${dataObj[k]}`)
    .join('\n');
}

/** Верификация подписи initData согласно Telegram Web Apps */
function verifyInitData(initData, botToken) {
  try {
    if (!initData || !botToken) return false;

    const data = parseQuery(initData);
    const receivedHash = data.hash;
    if (!receivedHash) return false;

    const dataCheckString = buildDataCheckString(data);

    // secret key = HMAC_SHA256("WebAppData", botToken)
    const secret = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();

    // calc = HMAC_SHA256(secret, data_check_string) в hex
    const calc = crypto.createHmac('sha256', secret).update(dataCheckString).digest('hex');

    // сравнение в постоянном времени
    return crypto.timingSafeEqual(Buffer.from(calc, 'hex'), Buffer.from(receivedHash, 'hex'));
  } catch {
    return false;
  }
}

/** Безопасный парсинг user (JSON внутри initData) */
function parseUser(initData) {
  const data = parseQuery(initData);
  if (!data.user) return null;
  try {
    const u = JSON.parse(data.user);
    return {
      id: u.id,
      first_name: u.first_name,
      last_name: u.last_name,
      username: u.username,
      photo_url: u.photo_url,
      language_code: u.language_code,
      is_premium: u.is_premium,
    };
  } catch {
    return null;
  }
}

/**
 * parseInitData — достаёт ключевые поля из initData.
 * Возвращает минимум { auth_date: number } для проверки «свежести».
 * Плюсом возвращает query_id, chat_type, chat_instance, raw_user (строка), а также разобранный user (object | null).
 */
function parseInitData(initData) {
  const data = parseQuery(initData);

  const authDateNum = Number(data.auth_date || 0);
  const out = {
    auth_date: Number.isFinite(authDateNum) ? authDateNum : 0,
    query_id: data.query_id || null,
    chat_type: data.chat_type || null,
    chat_instance: data.chat_instance || null,
    raw_user: data.user || null,
    user: null,
  };

  if (data.user) {
    try {
      out.user = JSON.parse(data.user);
    } catch {
      out.user = null;
    }
  }

  return out;
}

/** Быстрая проверка «свежести» initData по auth_date */
function isInitDataFresh(initData, maxAgeSec = 900) {
  try {
    const { auth_date } = parseInitData(initData);
    const ts = Number(auth_date || 0);
    if (!Number.isFinite(ts) || ts <= 0) return false;
    const age = Math.floor(Date.now() / 1000) - ts;
    return age >= 0 && age <= Math.max(60, Number(maxAgeSec) || 900);
  } catch {
    return false;
  }
}

module.exports = { verifyInitData, parseUser, parseInitData, isInitDataFresh };
