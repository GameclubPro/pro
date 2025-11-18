// compatibility.jsx
import { useEffect, useMemo, useState } from "react";

/**
 * Игра «Совместимость»
 * Поддержка:
 *  - Экран настройки: имена, выбор наборов мини‑квестов, количество раундов
 *  - Экран игры: карточки заданий, кнопки «Совпало/Не совпало/Пропуск»
 *  - Итоги: процент, вердикт, кнопки «Сыграть ещё», «Выбор квестов», «Назад»
 *
 * Пропсы:
 *  - goBack: () => void
 *  - onProgress: () => void   // вызывается один раз по завершению игры
 */

export default function Compatibility({ goBack, onProgress }) {
  const tg = typeof window !== "undefined" ? window?.Telegram?.WebApp : undefined;

  // ---- Настройки (setup) ----
  const [phase, setPhase] = useState("setup"); // setup | play | result

  const defaultNames = useMemo(() => {
    const first = tg?.initDataUnsafe?.user?.first_name || "Партнёр 1";
    return [first, "Партнёр 2"];
  }, [tg?.initDataUnsafe?.user?.first_name]);

  const [names, setNames] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("pt_compat_names") || "null");
      if (saved && Array.isArray(saved) && saved.length === 2) return saved;
    } catch {}
    return defaultNames;
  });

  const [selectedPacks, setSelectedPacks] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("pt_compat_packs") || "null");
      if (saved) return saved;
    } catch {}
    // По умолчанию включим 3 безопасных набора
    return { intimacy: true, fun: true, everyday: true, future: false, spicy: false };
  });

  const [rounds, setRounds] = useState(() => {
    const saved = Number(localStorage.getItem("pt_compat_rounds") || 10);
    return clamp(Number.isFinite(saved) ? saved : 10, 5, 20);
  });

  useEffect(() => localStorage.setItem("pt_compat_names", JSON.stringify(names)), [names]);
  useEffect(() => localStorage.setItem("pt_compat_packs", JSON.stringify(selectedPacks)), [selectedPacks]);
  useEffect(() => localStorage.setItem("pt_compat_rounds", String(rounds)), [rounds]);

  // ---- Колода и ход игры ----
  const poolSelected = useMemo(() => {
    const activeKeys = Object.keys(selectedPacks).filter((k) => selectedPacks[k]);
    const activeItems = activeKeys.flatMap((k) => PACKS.find((p) => p.key === k)?.items || []);
    return activeItems.length ? activeItems : PACKS.flatMap((p) => p.items); // если пусто — возьмём всё
  }, [selectedPacks]);

  const [deck, setDeck] = useState([]);
  const [idx, setIdx] = useState(0);
  const [wins, setWins] = useState(0);
  const [history, setHistory] = useState([]); // [{id, text, packKey, outcome:'match'|'no'|'skip'}]

  // ---- Запуск игры ----
  const startGame = () => {
    const chosen = shuffle(poolSelected).slice(0, rounds);
    setDeck(chosen);
    setIdx(0);
    setWins(0);
    setHistory([]);
    setPhase("play");
    try { tg?.HapticFeedback?.impactOccurred?.("medium"); } catch {}
  };

  // ---- Кнопки исхода ----
  const answer = (type) => {
    const cur = deck[idx];
    const entry = { ...cur, outcome: type };
    setHistory((h) => [...h, entry]);
    if (type === "match") setWins((w) => w + 1);

    const next = idx + 1;
    if (next >= deck.length) {
      setPhase("result");
      try { tg?.HapticFeedback?.notificationOccurred?.("success"); } catch {}
      onProgress?.();
    } else {
      setIdx(next);
      try { tg?.HapticFeedback?.selectionChanged?.(); } catch {}
    }
  };

  const percent = phase === "result" && deck.length > 0 ? Math.round((wins / deck.length) * 100) : 0;
  const verdict = getVerdict(percent);

  // ---- UI ----
  return (
    <div className="compat">
      {phase === "setup" && (
        <section className="screen">
          <header className="hdr">
            <div className="emoji" aria-hidden>🧩</div>
            <h1>Совместимость</h1>
            <p className="hint">Мини‑квесты на совпадения. Выберите темы и нажмите «Начать».</p>
          </header>

          <div className="panel">
            <label className="lbl">Имена</label>
            <div className="names">
              <input
                className="in"
                type="text"
                value={names[0]}
                onChange={(e) => setNames([e.target.value, names[1]])}
                placeholder="Партнёр 1"
                maxLength={24}
              />
              <span className="amp">&</span>
              <input
                className="in"
                type="text"
                value={names[1]}
                onChange={(e) => setNames([names[0], e.target.value])}
                placeholder="Партнёр 2"
                maxLength={24}
              />
            </div>
          </div>

          <div className="panel">
            <label className="lbl">Наборы мини‑квестов</label>
            <div className="packs">
              {PACKS.map((p) => {
                const active = !!selectedPacks[p.key];
                return (
                  <button
                    key={p.key}
                    className={`pack ${active ? "on" : ""}`}
                    onClick={() => setSelectedPacks((s) => ({ ...s, [p.key]: !s[p.key] }))}
                    aria-pressed={active}
                    title={`${p.title} • ${p.items.length} заданий`}
                  >
                    <span className="pkEmoji" aria-hidden>{p.emoji}</span>
                    <span className="pkTitle">{p.title}</span>
                    <span className="pkCount">{p.items.length}</span>
                  </button>
                );
              })}
            </div>
            <div className="packActions">
              <button
                className="btn ghost"
                onClick={() => setSelectedPacks(Object.fromEntries(PACKS.map((p) => [p.key, true])))}
              >
                Выбрать все
              </button>
              <button
                className="btn ghost"
                onClick={() => setSelectedPacks(Object.fromEntries(PACKS.map((p) => [p.key, false])))}
              >
                Снять все
              </button>
            </div>
          </div>

          <div className="panel">
            <label className="lbl">Количество раундов: <b>{rounds}</b></label>
            <input
              type="range"
              min={5}
              max={20}
              value={rounds}
              onChange={(e) => setRounds(clamp(Number(e.target.value), 5, 20))}
              className="range"
            />
            <small className="hint">Рекомендуем 8–12 для лёгкой, 15–20 для глубокой сессии.</small>
          </div>

          <div className="ctaRow">
            <button className="btn cta" onClick={startGame} aria-label="Начать игру">
              Начать
            </button>
            <button className="btn back" onClick={goBack} aria-label="Закрыть">
              Назад
            </button>
          </div>
        </section>
      )}

      {phase === "play" && (
        <section className="screen play">
          <header className="playHdr">
            <div className="crumbs">
              <span className="chip">{idx + 1}/{deck.length}</span>
              <span className="chip">Совпадений: {wins}</span>
            </div>
            <Progress value={idx + 1} total={deck.length} />
          </header>

          <article className="card">
            <div className="meta">
              <span className="badge">{packTitle(deck[idx]?.packKey)}</span>
            </div>
            <div className="text">{deck[idx]?.text}</div>
          </article>

          <div className="actions">
            <button className="btn match" onClick={() => answer("match")} aria-label="Совпало">
              👍 Совпало
            </button>
            <button className="btn no" onClick={() => answer("no")} aria-label="Не совпало">
              👎 Не совпало
            </button>
            <button className="btn ghost" onClick={() => answer("skip")} aria-label="Пропустить">
              ⏭ Пропуск
            </button>
          </div>
        </section>
      )}

      {phase === "result" && (
        <section className="screen result">
          <header className="hdr">
            <div className="emoji" aria-hidden>✨</div>
            <h1>{names[0]} & {names[1]}</h1>
            <p className="hint">Ваша совместимость по выбранным темам</p>
          </header>

          <div className="scoreBox">
            <div className="score">{percent}<span className="pct">%</span></div>
            <div className="verdict">{verdict.title}</div>
            <p className="sub">{verdict.sub}</p>
          </div>

          <details className="details">
            <summary>Показать разбор ({wins} совпадений из {deck.length})</summary>
            <ul className="history">
              {history.map((h, i) => (
                <li key={h.id || i} className={`hItem ${h.outcome}`}>
                  <span className="hBadge">{packTitle(h.packKey)}</span>
                  <span className="hText">{h.text}</span>
                  <span className="hOutcome">
                    {h.outcome === "match" ? "👍" : h.outcome === "no" ? "👎" : "⏭"}
                  </span>
                </li>
              ))}
            </ul>
          </details>

          <div className="ctaRow">
            <button className="btn cta" onClick={startGame}>Сыграть ещё</button>
            <button className="btn ghost" onClick={() => setPhase("setup")}>Выбор квестов</button>
            <button className="btn back" onClick={goBack}>Закрыть</button>
          </div>
        </section>
      )}

      <Styles />
    </div>
  );
}

/* ===================== Компоненты ===================== */

function Progress({ value, total }) {
  const pct = Math.max(0, Math.min(100, Math.round((value / Math.max(1, total)) * 100)));
  return (
    <div className="progress" aria-label="Прогресс">
      <div className="bar" style={{ width: `${pct}%` }} />
    </div>
  );
}

/* ===================== Утилиты и данные ===================== */

function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }
function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function packTitle(key) {
  return PACKS.find(p => p.key === key)?.title || "Случайно";
}
function getVerdict(percent) {
  if (percent >= 90) return { title: "Космос! 💫", sub: "Вы чувствуете друг друга с полуслова." };
  if (percent >= 75) return { title: "Очень близко 💖", sub: "Крепкая связь и отличная синхронизация." };
  if (percent >= 60) return { title: "Тёплая волна 😊", sub: "Много общего, остальное — дело практики." };
  if (percent >= 45) return { title: "Есть искра 🔎", sub: "Пара разговоров — и будете на одной волне." };
  return { title: "Простор для роста 🌱", sub: "Отличный повод узнать друг друга глубже." };
}

/**
 * Наборы мини‑квестов
 * Каждый элемент: { id, packKey, text }
 * Постарался сделать задания безопасными и камерными
 */
const PACKS = [
  {
    key: "intimacy",
    emoji: "💞",
    title: "Сближение",
    items: [
      t("intimacy-1", "intimacy", "Назовите любимый десерт партнёра."),
      t("intimacy-2", "intimacy", "Опишите идеальное свидание для вас двоих в трёх словах."),
      t("intimacy-3", "intimacy", "Выберите песню, которая ассоциируется с вами как с парой."),
      t("intimacy-4", "intimacy", "Какая мелочь делает вас счастливее всего в отношениях?"),
      t("intimacy-5", "intimacy", "В чём вы одинаково проявляете заботу?"),
      t("intimacy-6", "intimacy", "Назовите привычку партнёра, которую вы особенно цените."),
      t("intimacy-7", "intimacy", "Опишите друг друга одним комплиментом без банальностей."),
    ],
  },
  {
    key: "everyday",
    emoji: "🏠",
    title: "Быт",
    items: [
      t("everyday-1", "everyday", "Во сколько вы обычно ложитесь спать в выходные?"),
      t("everyday-2", "everyday", "Кто чаще инициирует совместные прогулки?"),
      t("everyday-3", "everyday", "Любимый совместный завтрак?"),
      t("everyday-4", "everyday", "Кто первым пишет утром «доброе»?"),
      t("everyday-5", "everyday", "Какую домработу вы любите/терпите одинаково?"),
      t("everyday-6", "everyday", "Идеальная температура в комнате для вас двоих?"),
      t("everyday-7", "everyday", "Куда вы чаще всего выбираетесь спонтанно?"),
    ],
  },
  {
    key: "fun",
    emoji: "🎲",
    title: "Хобби и фан",
    items: [
      t("fun-1", "fun", "Какой фильм или сериал вы бы пересмотрели вместе?"),
      t("fun-2", "fun", "Лучшая настолка/игра для вас двоих?"),
      t("fun-3", "fun", "Куда вы бы сорвались на выходных без подготовки?"),
      t("fun-4", "fun", "Что смешит вас одинаково? Пример."),
      t("fun-5", "fun", "Общая любимая кухня (страна/блюдо)?"),
      t("fun-6", "fun", "Какой мини‑ритуал сделает ваши вечера лучше?"),
      t("fun-7", "fun", "Выберите эмодзи, описывающий ваши свидания."),
    ],
  },
  {
    key: "future",
    emoji: "🔮",
    title: "Будущее",
    items: [
      t("future-1", "future", "Какая общая цель на ближайшие 3 месяца?"),
      t("future-2", "future", "Город, в котором вы хотели бы пожить вместе?"),
      t("future-3", "future", "Какой навык вы хотите освоить вдвоём?"),
      t("future-4", "future", "Идеальный формат совместного отпуска?"),
      t("future-5", "future", "Что бы вы хотели делать по пятницам через год?"),
      t("future-6", "future", "Какую традицию вы заведёте в этом месяце?"),
      t("future-7", "future", "Что для вас «успешные выходные» через 6 месяцев?"),
    ],
  },
  {
    key: "spicy",
    emoji: "🔥",
    title: "Искра",
    items: [
      t("spicy-1", "spicy", "Какой тип свиданий для вас двоих самый «вау»?"),
      t("spicy-2", "spicy", "Что из романтики вам нравится одинаково?"),
      t("spicy-3", "spicy", "Лучшее место для поцелуя — где?"),
      t("spicy-4", "spicy", "Какая мелочь мгновенно поднимает вам настроение?"),
      t("spicy-5", "spicy", "Какой сюрприз вы бы хотели получить/сделать?"),
      t("spicy-6", "spicy", "Ваш «идеальный вечер вдвоём» одним предложением."),
      t("spicy-7", "spicy", "Назовите фильм/песню с «искоркой», которая нравится вам обоим."),
    ],
  },
];

function t(id, packKey, text) {
  return { id, packKey, text };
}

/* ===================== Стили ===================== */

function Styles() {
  return (
    <style
      dangerouslySetInnerHTML={{
        __html: `
.compat { min-height: 100%; padding: clamp(14px, 3vw, 18px); color: var(--text); }
.compat .screen { max-width: 760px; margin: 0 auto; display: grid; gap: 14px; }

.hdr { text-align: center; margin-top: 8px; }
.hdr .emoji { font-size: 28px; filter: drop-shadow(0 6px 12px rgba(0,0,0,.15)); }
.hdr h1 { margin: 8px 0 4px; font-size: clamp(20px, 4.4vw, 26px); letter-spacing: .2px; }
.hint { color: var(--hint); font-size: 13px; }

.panel {
  background: color-mix(in srgb, var(--surface) 100%, transparent);
  border: 1px solid color-mix(in srgb, var(--text) 10%, transparent);
  border-radius: 16px;
  padding: 12px;
  box-shadow: 0 10px 28px rgba(0,0,0,.10);
}
.lbl { display:block; font-size: 13px; color: var(--hint); margin-bottom: 8px; }

.names { display:grid; grid-template-columns: 1fr auto 1fr; align-items:center; gap: 8px; }
.in {
  width: 100%; padding: 10px 12px; border-radius: 12px;
  border: 1px solid color-mix(in srgb, var(--text) 12%, transparent);
  background: color-mix(in srgb, var(--surface) 85%, transparent);
  color: var(--text);
}
.amp { opacity: .6; font-weight: 900; }

.packs { display:grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 8px; }
.pack {
  display:grid; grid-template-columns: 28px 1fr auto; align-items:center; gap: 8px;
  padding: 10px; border-radius: 12px; text-align:left;
  background: color-mix(in srgb, var(--surface) 85%, transparent);
  border: 1px solid color-mix(in srgb, var(--text) 10%, transparent);
  transition: transform .12s ease, box-shadow .12s ease, background .12s ease;
}
.pack.on {
  background: color-mix(in srgb, var(--surface) 70%, rgba(var(--accent-rgb), .08));
  box-shadow: 0 6px 22px rgba(0,0,0,.10);
  border-color: color-mix(in srgb, var(--text) 16%, transparent);
}
.pkEmoji { font-size: 18px; }
.pkTitle { font-weight: 800; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pkCount {
  font-size: 12px; padding: 2px 6px; border-radius: 999px;
  background: color-mix(in srgb, var(--surface) 60%, transparent);
  border: 1px solid color-mix(in srgb, var(--text) 10%, transparent);
}

.packActions { display:flex; gap: 8px; margin-top: 8px; }

.range { width: 100%; appearance: none; height: 6px; border-radius: 999px;
  background: linear-gradient(90deg, rgba(var(--accent-rgb),.9), rgba(var(--accent-rgb),.35));
  outline: none;
}
.range::-webkit-slider-thumb {
  appearance: none; width: 22px; height: 22px; border-radius: 50%;
  background: var(--btn, #0ea5e9); border: 2px solid color-mix(in srgb, #fff 70%, transparent);
  box-shadow: 0 4px 14px rgba(0,0,0,.18);
}

.ctaRow { display:flex; flex-wrap: wrap; gap: 10px; justify-content: center; margin-top: 2px; }
.btn {
  padding: 12px 14px; border-radius: 12px; font-weight: 900; letter-spacing:.2px;
  border: 1px solid color-mix(in srgb, var(--text) 12%, transparent);
  background: color-mix(in srgb, var(--surface) 85%, transparent);
  color: var(--text);
  transition: transform .12s ease, box-shadow .12s ease, background .12s ease;
}
.btn:hover { transform: translateY(-1px); box-shadow: 0 10px 30px rgba(0,0,0,.10); }
.btn.cta { background: var(--btn, #0ea5e9); color: var(--btn-text, #fff); }
.btn.ghost { background: color-mix(in srgb, var(--surface) 85%, transparent); }
.btn.back { background: color-mix(in srgb, var(--surface) 92%, transparent); }
.btn.match { background: linear-gradient(180deg, rgba(34,197,94,.9), rgba(16,185,129,.9)); color:#fff; }
.btn.no { background: linear-gradient(180deg, rgba(239,68,68,.92), rgba(220,38,38,.92)); color:#fff; }

.play .playHdr { display:grid; gap: 8px; }
.crumbs { display:flex; gap: 8px; align-items:center; }
.chip {
  font-size: 12px; padding: 4px 8px; border-radius: 999px; letter-spacing:.2px;
  background: color-mix(in srgb, var(--surface) 70%, transparent);
  border: 1px solid color-mix(in srgb, var(--text) 10%, transparent);
  color: var(--text);
}

.progress { width: 100%; height: 10px; border-radius: 999px; background: color-mix(in srgb, var(--surface) 85%, transparent);
  border: 1px solid color-mix(in srgb, var(--text) 8%, transparent);
  overflow: hidden;
}
.progress .bar { height: 100%; background: linear-gradient(90deg, rgba(var(--accent-rgb), .9), rgba(var(--accent-rgb), .35)); }

.card {
  background: color-mix(in srgb, var(--surface) 100%, transparent);
  border: 1px solid color-mix(in srgb, var(--text) 12%, transparent);
  border-radius: 16px;
  padding: clamp(12px, 3vw, 16px);
  box-shadow: 0 10px 28px rgba(0,0,0,.10);
}
.card .meta { display:flex; justify-content: space-between; align-items:center; margin-bottom: 6px; }
.badge {
  font-size: 12px; padding: 4px 8px; border-radius: 999px;
  background: rgba(0,0,0,.25); border: 1px solid color-mix(in srgb, var(--text) 10%, transparent);
}
.card .text { font-size: clamp(16px, 4.2vw, 20px); line-height: 1.25; }

.actions { display:grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 10px; }
.actions .btn.ghost { grid-column: 1 / -1; }

.result .scoreBox {
  text-align: center; padding: 12px;
  background: color-mix(in srgb, var(--surface) 100%, transparent);
  border: 1px solid color-mix(in srgb, var(--text) 10%, transparent);
  border-radius: 16px;
}
.score { font-size: clamp(38px, 10vw, 56px); font-weight: 900; letter-spacing: .4px; }
.pct { font-size: .6em; opacity: .8; margin-left: 2px; }
.verdict { margin-top: 6px; font-weight: 900; font-size: clamp(16px, 4.4vw, 18px); }
.sub { color: var(--hint); font-size: 13px; margin-top: 4px; }

.details { margin-top: 6px; }
.details summary { cursor: pointer; list-style: none; }
.details summary::marker, .details summary::-webkit-details-marker { display: none; }
.details summary { padding: 8px 0; color: var(--link); }
.history { list-style: none; margin: 8px 0 0; padding: 0; display: grid; gap: 6px; }
.hItem {
  display:grid; grid-template-columns: auto 1fr auto; gap: 10px; align-items: center;
  padding: 8px 10px; border-radius: 12px;
  background: color-mix(in srgb, var(--surface) 85%, transparent);
  border: 1px solid color-mix(in srgb, var(--text) 12%, transparent);
}
.hItem .hBadge {
  font-size: 12px; padding: 2px 6px; border-radius: 999px;
  background: color-mix(in srgb, var(--surface) 60%, transparent);
  border: 1px solid color-mix(in srgb, var(--text) 10%, transparent);
}
.hItem.match { border-color: rgba(34,197,94,.5); }
.hItem.no { border-color: rgba(239,68,68,.5); }
.hItem.skip { opacity: .75; }
      `,
      }}
    />
  );
}
