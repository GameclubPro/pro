// parseToastMessage — единая разметка тостов (иконка, теги, тон, заголовок, подпись)
// Коротко, в повелительном наклонении; поддержаны типовые игровые события.
// Использование: import parseToastMessage from "../utils/parseToastMessage";
export default function parseToastMessage(text = "", tone = "info") {
  const raw = String(text || "");
  const t = tone || "info";

  // нормализуем пробелы
  const normalized = raw.replace(/\s+/g, " ").trim();

  // дефолты
  let icon = "✨";
  let title = normalized;
  let sub = "";
  let tag = null;         // «МАФИЯ» / «мирный»
  let variant = "info";   // ok|warn|danger|info|success

  const set = (i, ti, s = "", g = null, v = t) => {
    icon = i; title = ti; sub = s; tag = g; variant = v;
  };

  // — Доктор спас
  if (/доктор спас/i.test(normalized)) {
    set("🩹", "Доктор спас жертву", "Ночь прошла без жертв", null, "success");
  }
  // — Тихая ночь
  else if (/тихая ночь/i.test(normalized)) {
    set("🌙", "Тихая ночь", "Никто не погиб", null, "info");
  }
  // — Ночью был(и) убит(ы) …
  else if (/убит/i.test(normalized) && /ноч(ью|и)/i.test(normalized)) {
    set("💀", "Ночью убит игрок", normalized.replace(/^.*убит/i, "").trim(), null, "danger");
  }
  // — Проверка шерифа: «🔎 Проверка: Ник — МАФИЯ|мирный»
  else if (/проверка:/i.test(normalized)) {
    const m = normalized.match(/проверка:\s*(.+?)\s*[—-]\s*(МАФИЯ|мирный)/i);
    const name = m?.[1]?.trim();
    const verdict = (m?.[2] || "").toUpperCase();
    const isMafia = verdict === "МАФИЯ";
    set("🔎", `Проверка: ${name || "игрок"}`, isMafia ? "Найден мафиози" : "Мирный",
        isMafia ? "МАФИЯ" : "мирный", isMafia ? "danger" : "ok");
  }
  // — Казнён / казни не было
  else if (/казнён/i.test(normalized)) {
    set("⚔️", "Казнён игрок", "День завершён", null, "warn");
  } else if (/казни не было/i.test(normalized)) {
    set("🤝", "Казни не было", "Город пощадил подозреваемого", null, "info");
  }
  // — Финал
  else if (/мафия победила/i.test(normalized)) {
    set("🕶️", "Мафия победила", "Город пал", null, "danger");
  } else if (/город победил/i.test(normalized)) {
    set("🏙️", "Город победил", "Мафия раскрыта", null, "success");
  }
  // — Иначе: пытаемся вытащить лид-эмодзи; тон — по tone
  else {
    const leadEmojiRe = (() => {
      try { return new RegExp("^([\\p{Emoji}\\p{Extended_Pictographic}]{1,2})","u"); }
      catch { return /^([\u231A-\u2764\u2B00-\u2BFF\uFE0F\u1F000-\u1FAFF]{1,2})/; }
    })();
    const m = leadEmojiRe.exec(normalized);
    const leadEmoji = m ? m[1] : null;
    if (leadEmoji) {
      icon = leadEmoji;
      title = normalized.replace(leadEmoji, "").trim();
    } else {
      icon = t === "danger" || t === "error" ? "⚠️"
           : t === "warn" ? "⚠️"
           : t === "success" || t === "ok" ? "✅"
           : "✨";
    }
    variant = t;
  }

  // краткость — сестра таланта
  title = title.replace(/\.*\s*$/, ""); // убираем хвостовые точки
  return { icon, title, sub, tag, variant };
}
