export const PACKS = {
  easy: [
    "зебра",
    "пицца",
    "чемодан",
    "лимон",
    "пальто",
    "робот",
    "звезда",
    "поезд",
    "жук",
    "торт",
    "самокат",
    "лампа",
    "пират",
    "гитара",
    "динозавр",
    "арбуз",
    "компас",
    "фея",
    "сова",
    "радуга",
    "футбол",
    "морковь",
    "скейт",
    "панда",
    "комета",
    "космонавт",
    "салат",
    "йога",
    "жонглёр",
    "плед",
  ],
  medium: [
    "телескоп",
    "камчатка",
    "практикант",
    "молния",
    "вулкан",
    "квиток",
    "дирижёр",
    "горнолыжник",
    "интерфейс",
    "коллекционер",
    "балкон",
    "экспонат",
    "город-сад",
    "звукозапись",
    "архивариус",
    "танкер",
    "альбатрос",
    "перископ",
    "батут",
    "органайзер",
    "лаборатория",
    "будильник",
    "фехтовальщик",
    "сковорода",
    "океанариум",
    "снегоход",
    "калейдоскоп",
    "инкогнито",
    "фотокарточка",
    "квест-комната",
  ],
  hard: [
    "детокс",
    "марципан",
    "киберпанк",
    "голограмма",
    "капсула времени",
    "нетворкинг",
    "ретрит",
    "экзоскелет",
    "терминатор",
    "неодимовый магнит",
    "микродозинг",
    "палеонтолог",
    "суперпозиция",
    "антигравитация",
    "ретранслятор",
    "навигация",
    "гидропонка",
    "песочные часы",
    "синхрофазотрон",
    "купол дрона",
    "невесомость",
    "логист",
    "интроспекция",
    "криптография",
    "аэроэкспресс",
    "эклектика",
    "панорама",
    "энергетик",
    "гиперкроссфит",
    "монолит",
  ],
};

const dedupeWords = (words) => {
  const seen = new Set();
  return words.filter((word) => {
    const key = word.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

export const parseWords = (text) =>
  dedupeWords(
    (text || "")
      .split(/\r?\n/)
      .map((w) => w.trim())
      .filter(Boolean)
  );

const splitWordInput = (text) =>
  (text || "")
    .split(/[\n,]/)
    .map((w) => w.trim())
    .filter(Boolean);

export const appendCustomWords = (currentText, incoming) => {
  const additions = splitWordInput(incoming);
  if (!additions.length) return currentText || "";
  const merged = dedupeWords([...parseWords(currentText), ...additions]);
  return merged.join("\n");
};

export const removeCustomWordAt = (currentText, index) => {
  const list = parseWords(currentText);
  if (index < 0 || index >= list.length) return currentText || "";
  list.splice(index, 1);
  return list.join("\n");
};

export const normalizePacks = (value, hasCustom = false) => {
  const base = ["easy", "medium", "hard"];
  if (Array.isArray(value)) {
    const uniq = Array.from(new Set(value.filter(Boolean)));
    return uniq.length ? uniq : base;
  }
  const key = String(value || "").trim();
  if (["easy", "medium", "hard", "custom"].includes(key)) return [key];
  return hasCustom ? [...base, "custom"] : base;
};

export const buildWordPool = (settings, customWords, packs = PACKS) => {
  const normalizeEntry = (entry) => {
    if (typeof entry === "string") return { word: entry, imageUrl: null, id: null };
    if (!entry) return null;
    const word = String(entry.word || "").trim();
    if (!word) return null;
    return {
      word,
      imageUrl: entry.imageUrl ? String(entry.imageUrl) : null,
      id: entry.id != null ? String(entry.id) : null,
    };
  };
  const withLabel = (entries, level) =>
    entries
      .map((entry) => {
        const normalized = normalizeEntry(entry);
        if (!normalized) return null;
        const id = normalized.id ? `db-${normalized.id}` : `${level}-${normalized.word}`;
        return { id, word: normalized.word, level, imageUrl: normalized.imageUrl };
      })
      .filter(Boolean);
  const pool = [];
  const selected = normalizePacks(settings.difficulty, customWords.length > 0);
  const customUnique = dedupeWords(customWords);
  selected.forEach((key) => {
    if (key === "easy") pool.push(...withLabel(packs.easy || [], "easy"));
    else if (key === "medium") pool.push(...withLabel(packs.medium || [], "medium"));
    else if (key === "hard") pool.push(...withLabel(packs.hard || [], "hard"));
    else if (key === "custom") pool.push(...withLabel(customUnique, "custom"));
  });
  return pool.length
    ? pool
    : [{ id: "fallback-лампа", word: "лампа", level: "easy" }];
};
