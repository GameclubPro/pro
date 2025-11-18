// choice.jsx
import { useEffect, useMemo, useState } from "react";

/**
 * Игра «Выбор»
 * Экран делится на две половины. Игрок(и) выбирают одну из двух опций.
 * Теперь: по клику сразу авто-переход к следующей паре (без кнопки «Дальше»).
 *
 * Props:
 *  - goBack(): функция закрытия (передаётся из оболочки)
 *  - onProgress(): вызывается при переходе к следующей паре (для прокачки уровня)
 */

const RAW_PAIRS = [
  { left: "Пить всю жизнь только Coca-Cola", right: "Пить всю жизнь только пиво" },
  { left: "Жить без интернета", right: "Жить без кондиционера/отопления" },
  { left: "Всегда вставать в 5:00", right: "Всегда ложиться в 02:00" },
  { left: "Уметь летать", right: "Стать невидимым" },
  { left: "Никогда не есть сладкое", right: "Никогда не есть солёное" },
  { left: "Работать 4 дня по 10 часов", right: "Работать 6 дней по 6 часов" },
  { left: "Жить в большом городе", right: "Жить у моря в посёлке" },
  { left: "Только кофе всю жизнь", right: "Только чай всю жизнь" },
  { left: "10 минут в прошлом", right: "10 минут в будущем" },
  { left: "Всегда говорить правду", right: "Всегда молчать, если сомневаешься" },
  { left: "Никогда больше не смотреть кино", right: "Никогда больше не слушать музыку" },
  { left: "Каждый день новый город", right: "Всю жизнь один идеальный город" },
  { left: "Дом без соседа сверху", right: "Сосед сверху, но идеальный двор" },
  { left: "Супер память", right: "Супер концентрация" },
  { left: "Только зима 12 месяцев", right: "Только лето 12 месяцев" },
  { left: "Всегда быстрое метро", right: "Всегда свободные парковки" },
  { left: "Только текстовые сообщения", right: "Только звонки" },
  { left: "Любимая еда без калорий", right: "Сон на 2 часа короче" },
  { left: "Работать удалённо", right: "Работать из крутого офиса" },
  { left: "Каждый день новая активность", right: "Одна, но любимая рутина" },
  { left: "Никогда не опаздывать", right: "Всегда находить нужные слова" },
  { left: "Быть на 10% умнее", right: "Быть на 10% привлекательнее" },
  { left: "Дождь по ночам", right: "Снег по праздникам" },
  { left: "Всегда идеальный Wi-Fi", right: "Всегда полная батарея" },
  { left: "Раз в год долгий отпуск", right: "Каждый квартал мини-отпуск" },
  { left: "Наставник мечты", right: "Команда мечты" },
  { left: "Учить 1 новый навык в год", right: "Освоить 12 маленьких навыков в год" },
  { left: "Всегда честный фидбек", right: "Всегда мягкий фидбек" },
  { left: "Хобби приносит деньги", right: "Работа приносит вдохновение" },
  { left: "Всегда тёплая погода", right: "Всегда прохладная погода" },
  { left: "Получать подарки", right: "Дарить подарки" },
  { left: "Только пешком", right: "Только самокатом" },
  { left: "Без соцсетей месяц", right: "Без сладкого месяц" },
  { left: "Суперудача 1 день", right: "Небольшая удача каждый день" },
  { left: "Карьера мечты за 5 лет", right: "Баланс и спокойствие все 5 лет" },
  { left: "Всегда говорить тост", right: "Всегда организовывать сбор" },
  { left: "Лучший друг рядом", right: "Любимый коллега рядом" },
  { left: "Работа мечты в другом городе", right: "Хорошая работа рядом с домом" },
  { left: "Всегда идеальный сон", right: "Всегда идеальный аппетит" },
  { left: "Учиться у лучших онлайн", right: "Учиться в среднем офлайне" },
  { left: "Никогда не уставать", right: "Никогда не нервничать" },
  { left: "Обед в любимом месте", right: "Кофе с любимым человеком" },
  { left: "Только книги", right: "Только подкасты" },
  { left: "Суперскорость чтения", right: "Суперскорость набора текста" },
  { left: "Всегда свободное окно врача", right: "Всегда пустая касса в магазине" },
  { left: "Больше денег", right: "Больше времени" },
  { left: "Каждый день спорт 15 минут", right: "3 раза в неделю по часу" },
  { left: "Всегда вовремя", right: "Всегда с идеей" },
  { left: "Оставаться дома", right: "Идти на вечеринку" },
  { left: "Небольшая слава сейчас", right: "Большой успех через 10 лет" },
  { left: "Переехать в страну мечты", right: "Остаться, но с идеальной работой" },
  { left: "Навыки — ширина", right: "Навыки — глубина" },
  { left: "Жить у леса", right: "Жить у воды" },
  { left: "Случайные добрые дела", right: "Планомерная помощь одному делу" },
  { left: "Ранние подъёмы", right: "Поздние ночи" },
  { left: "Бесконечный плейлист", right: "Бесконечный список фильмов" },
  { left: "Домашний питомец", right: "Комнатные растения-джунгли" },
  { left: "Путешествовать автостопом", right: "Путешествовать по туру" },
  { left: "Вести дневник", right: "Каждую неделю ретроспектива" },
  { left: "Всегда идеальная погода в отпуске", right: "Всегда короткая дорога домой" },
  { left: "Делиться всем", right: "Хранить секреты" },
  { left: "Коллективные решения", right: "Единоличные решения" },
];

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export default function Choice({ goBack, onProgress }) {
  const tg = typeof window !== "undefined" ? window?.Telegram?.WebApp : undefined;

  const deck = useMemo(() => shuffle(RAW_PAIRS), []);
  const [idx, setIdx] = useState(0);
  const [selected, setSelected] = useState(null); // "left" | "right" | null
  const [rounds, setRounds] = useState(0);
  const current = deck[idx];

  // клавиатура: ←/→ для выбора (авто-переход), Enter/Space больше не нужны
  useEffect(() => {
    const onKey = (e) => {
      if (!current || selected) return;
      if (e.key === "ArrowLeft") pick("left");
      if (e.key === "ArrowRight") pick("right");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, current]);

  const haptic = (type = "light") => {
    try { tg?.HapticFeedback?.impactOccurred?.(type); } catch {}
  };

  const next = () => {
    if (!current) return;
    onProgress?.();
    setRounds((r) => r + 1);
    setSelected(null);
    setIdx((i) => Math.min(i + 1, deck.length)); // выход на экран завершения
    haptic("light");
  };

  // выбор + авто-переход через короткую задержку
  const pick = (side) => {
    if (!current || selected) return;
    haptic("medium");
    setSelected(side);
    // небольшая пауза, чтобы показать подсветку выбора
    setTimeout(next, 600);
  };

  const skip = () => {
    if (selected) return; // во время анимации пропуск не нужен
    setIdx((i) => Math.min(i + 1, deck.length));
    haptic("light");
  };

  const restart = () => {
    setIdx(0);
    setSelected(null);
    setRounds(0);
    haptic("heavy");
  };

  // конец колоды
  if (idx >= deck.length) {
    return (
      <div className="choice">
        <div className="c-head">
          <button className="c-back" onClick={goBack} aria-label="Назад">←</button>
          <div className="c-title">Выбор</div>
          <div className="c-spacer" />
        </div>
        <div className="c-end">
          <div className="c-emoji" aria-hidden>🎉</div>
          <h2>Партия завершена</h2>
          <p className="c-hint">Сделано выборов: <b>{rounds}</b></p>
          <div className="c-actions">
            <button className="c-btn primary" onClick={restart}>Играть ещё</button>
            <button className="c-btn" onClick={goBack}>Выйти</button>
          </div>
        </div>
        <ChoiceStyles />
      </div>
    );
  }

  return (
    <div className="choice" role="application" aria-label="Выбор — игра">
      {/* Верхняя панель */}
      <div className="c-head">
        <button className="c-back" onClick={goBack} aria-label="Назад">←</button>
        <div className="c-title">Выбор</div>
        <div className="c-chip" title="Раунд">
          {idx + 1} / {deck.length}
        </div>
      </div>

      {/* Поле с двумя половинами */}
      <div className="c-stage" role="group" aria-label="Два варианта">
        <button
          className={`half left ${selected === "left" ? "picked" : ""}`}
          onClick={() => pick("left")}
          aria-pressed={selected === "left"}
          aria-label={current.left}
        >
          <div className="half-inner">
            <span className="half-text">{current.left}</span>
          </div>
          <span className="pulse" aria-hidden />
          {selected === "left" && <span className="mark" aria-hidden>✓</span>}
        </button>

        <div className="divider" aria-hidden>
          <span>или</span>
        </div>

        <button
          className={`half right ${selected === "right" ? "picked" : ""}`}
          onClick={() => pick("right")}
          aria-pressed={selected === "right"}
          aria-label={current.right}
        >
          <div className="half-inner">
            <span className="half-text">{current.right}</span>
          </div>
          <span className="pulse" aria-hidden />
          {selected === "right" && <span className="mark" aria-hidden>✓</span>}
        </button>
      </div>

      {/* Нижняя панель действий — только «Пропустить» */}
      <div className="c-controls single" role="toolbar" aria-label="Действия">
        <button className="c-btn ghost" onClick={skip} aria-label="Пропустить">Пропустить</button>
      </div>

      <ChoiceStyles />
    </div>
  );
}

function ChoiceStyles() {
  return (
    <style
      dangerouslySetInnerHTML={{
        __html: `
/* ===== Игра «Выбор» ===== */
.choice {
  position: relative;
  min-height: 100dvh;
  display: grid;
  grid-template-rows: auto 1fr auto;
  color: var(--text);
  background: var(--bg);
}

/* Верхняя панель */
.choice .c-head {
  display: grid;
  grid-template-columns: 48px 1fr auto;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
}
.choice .c-back {
  height: 36px; width: 36px; border-radius: 10px;
  background: color-mix(in srgb, var(--surface) 92%, transparent);
  border: 1px solid color-mix(in srgb, var(--text) 12%, transparent);
  color: var(--text);
}
.choice .c-title {
  text-align: center; font-weight: 900; letter-spacing:.2px;
}
.choice .c-chip {
  font-size: 12px; padding: 6px 10px; border-radius: 999px;
  background: color-mix(in srgb, var(--surface) 85%, transparent);
  border: 1px solid color-mix(in srgb, var(--text) 12%, transparent);
}

/* Сцена с двумя половинами */
.choice .c-stage {
  position: relative; isolation: isolate;
  display: grid; grid-template-columns: 1fr 1fr;
  min-height: 0; /* важно для Safari */
}
.choice .half {
  position: relative;
  display: grid; place-items: center;
  padding: clamp(16px, 4vh, 24px);
  border: 0;
  transition: transform .15s ease;
  overflow: hidden;
}
.choice .half:active { transform: scale(.995); }

.choice .half.left {
  background:
    linear-gradient(180deg, color-mix(in srgb, var(--surface) 96%, transparent), transparent 40%),
    linear-gradient(135deg, rgba(var(--accent-rgb), .10), rgba(34,197,94,.18));
  border-right: 1px solid color-mix(in srgb, var(--text) 12%, transparent);
}
.choice .half.right {
  background:
    linear-gradient(180deg, color-mix(in srgb, var(--surface) 96%, transparent), transparent 40%),
    linear-gradient(225deg, rgba(var(--accent-rgb), .10), rgba(99,102,241,.18));
  border-left: 1px solid color-mix(in srgb, var(--text) 12%, transparent);
}

.choice .half-inner { 
  max-width: 520px; text-align: center; display:grid; gap: 10px;
}
.choice .half-text {
  font-weight: 900; line-height: 1.15;
  font-size: clamp(18px, 3.8vw, 28px);
  text-wrap: balance;
}

/* Индикатор выбора */
.choice .half .mark {
  position: absolute; inset: 10px; border-radius: 16px;
  border: 2px solid color-mix(in srgb, var(--btn) 80%, #fff);
  box-shadow: 0 6px 24px rgba(0,0,0,.18) inset, 0 8px 32px rgba(0,0,0,.16);
  display: grid; place-items: center;
  font-weight: 900; font-size: clamp(20px, 6vw, 36px);
  color: var(--btn-text);
  background: color-mix(in srgb, var(--btn) 22%, transparent);
}

.choice .half.picked .half-text { transform: translateY(-1px); }

/* Декоративный пульс */
.choice .pulse {
  position: absolute; width: 120vmax; height: 120vmax; border-radius: 50%;
  left: 50%; top: 50%; transform: translate(-50%,-50%);
  background: radial-gradient(circle at 50% 50%, color-mix(in srgb, var(--btn) 12%, transparent), transparent 40%);
  opacity: 0; pointer-events:none;
  transition: opacity .2s ease;
}
.choice .half.picked .pulse { opacity: .6; }

/* Центральный разделитель */
.choice .divider {
  position: absolute; left: 50%; top: 0; bottom: 0; width: 0; z-index: 1; pointer-events: none;
}
.choice .divider::before {
  content: ""; position: absolute; left: -1px; top: 0; bottom: 0; width: 2px;
  background: color-mix(in srgb, var(--text) 12%, transparent);
}
.choice .divider span {
  position: absolute; top: 50%; left: 50%; transform: translate(-50%,-50%);
  background: color-mix(in srgb, var(--surface) 95%, transparent);
  border: 1px solid color-mix(in srgb, var(--text) 12%, transparent);
  border-radius: 999px; padding: 4px 10px; font-size: 12px; opacity: .9;
}

/* Контролы снизу — одна кнопка по центру */
.choice .c-controls.single {
  display: grid; grid-template-columns: 1fr; gap: 10px;
  padding: 12px; position: sticky; bottom: 0;
  background: linear-gradient(180deg, transparent, color-mix(in srgb, var(--bg) 92%, transparent) 40%, var(--bg));
  backdrop-filter: blur(4px);
  max-width: 420px; margin: 0 auto; width: 100%;
}
.choice .c-btn {
  height: clamp(44px, 6.6vh, 52px);
  border-radius: 12px;
  border: 1px solid color-mix(in srgb, var(--text) 12%, transparent);
  background: color-mix(in srgb, var(--surface) 92%, transparent);
  color: var(--text);
  font-weight: 800;
}
.choice .c-btn.ghost { background: color-mix(in srgb, var(--surface) 85%, transparent); }

/* Экран окончания */
.choice .c-end {
  min-height: 60vh; display:grid; place-items:center; gap: 10px; text-align:center; padding: 20px;
}
.choice .c-end .c-emoji { font-size: clamp(40px, 8vw, 64px); }
.choice .c-end .c-hint { color: var(--hint); }
.choice .c-actions { display:flex; gap:10px; justify-content:center; }

      `,
      }}
    />
  );
}
