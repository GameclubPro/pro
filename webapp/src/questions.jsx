// questions.jsx
import { useEffect, useMemo, useRef, useState } from "react";

export default function Questions({ goBack, onProgress }) {
  const tg = typeof window !== "undefined" ? window?.Telegram?.WebApp : undefined;

  const total = QUESTIONS.length;
  const [stage, setStage] = useState("intro"); // intro | playing | done
  const [idx, setIdx] = useState(0);
  const [progressSaved, setProgressSaved] = useState(() => {
    try {
      const raw = localStorage.getItem("pt_36q_state");
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed.idx === "number" && parsed.idx >= 0 && parsed.idx < total) {
        return parsed;
      }
    } catch {}
    return null;
  });

  useEffect(() => {
    // Подсветка заголовка в Telegram (необязательно)
    return () => {
      try { tg?.setHeaderColor?.("secondary_bg_color"); } catch {}
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (stage === "playing") {
      try {
        localStorage.setItem("pt_36q_state", JSON.stringify({ idx }));
      } catch {}
    }
  }, [idx, stage]);

  const setNumber = useMemo(() => (idx < 12 ? 1 : idx < 24 ? 2 : 3), [idx]);
  const percent = useMemo(() => Math.round(((idx + 1) / total) * 100), [idx, total]);

  const start = (resume = false) => {
    try { tg?.HapticFeedback?.impactOccurred?.("medium"); } catch {}
    if (resume && progressSaved) {
      setIdx(progressSaved.idx);
    } else {
      setIdx(0);
    }
    setStage("playing");
  };

  const next = () => {
    try { tg?.HapticFeedback?.selectionChanged?.(); } catch {}
    setIdx((i) => {
      if (i < total - 1) return i + 1;
      // завершение
      setStage("done");
      try { localStorage.removeItem("pt_36q_state"); } catch {}
      try { onProgress?.(); } catch {}
      return i;
    });
  };

  const prev = () => {
    try { tg?.HapticFeedback?.selectionChanged?.(); } catch {}
    setIdx((i) => (i > 0 ? i - 1 : 0));
  };

  const restart = () => {
    try { tg?.HapticFeedback?.impactOccurred?.("light"); } catch {}
    setIdx(0);
    setStage("playing");
  };

  return (
    <div className="q36 root" role="application" aria-label="36 вопросов">
      <Styles />
      {stage === "intro" && (
        <div className="intro">
          <h1 className="title">💬 36 вопросов</h1>
          <p className="lead">Игра для двоих, которая помогает стать ближе. Отвечайте по очереди — честно и без спешки.</p>
          <ul className="howto">
            <li>3 набора по 12 вопросов: <b>I</b>, <b>II</b>, <b>III</b> — от лёгких к глубоким.</li>
            <li>Говорите по очереди. Можно брать паузу и задавать уточняющие вопросы.</li>
            <li>На каждый вопрос — столько времени, сколько хочется. Главное — внимание и уважение.</li>
          </ul>
          <div className="cta">
            {progressSaved ? (
              <>
                <button className="btn primary" onClick={() => start(true)}>▶️ Продолжить</button>
                <button className="btn" onClick={() => start(false)}>🔁 Начать заново</button>
              </>
            ) : (
              <button className="btn primary" onClick={() => start(false)}>🚀 Начать</button>
            )}
            <button className="btn ghost" onClick={goBack}>← К разделам</button>
          </div>
        </div>
      )}

      {stage === "playing" && (
        <div className="playing">
          <header className="bar">
            <div className="set">Набор <b>{setNumber}</b> / 3</div>
            <div className="progress" aria-label={`Прогресс ${percent}%`} role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
              <div className="line" style={{ width: `${percent}%` }} />
            </div>
            <div className="counter">{idx + 1} / {total}</div>
          </header>

          <main className="card" role="group" aria-labelledby="q-title">
            <div className="badge">Вопрос {idx + 1}</div>
            <h2 id="q-title" className="q">{QUESTIONS[idx]}</h2>
          </main>

          <nav className="nav">
            <button className="btn" onClick={prev} disabled={idx === 0} aria-disabled={idx === 0}>← Назад</button>
            {idx < total - 1 ? (
              <button className="btn primary" onClick={next}>Дальше →</button>
            ) : (
              <button className="btn primary" onClick={next}>Завершить 🎉</button>
            )}
          </nav>
        </div>
      )}

      {stage === "done" && (
        <div className="finish">
          <h2>🎉 Вы прошли все 36 вопросов!</h2>
          <p className="lead">Можно обсудить, что оказалось самым неожиданным или важным. Хотите сыграть ещё раз?</p>
          <div className="cta">
            <button className="btn primary" onClick={restart}>🔁 Пройти ещё раз</button>
            <button className="btn ghost" onClick={goBack}>← К разделам</button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ===================== Вопросы ===================== */

const QUESTIONS = [
  // Set I (1–12)
  "Если бы вы могли пригласить любого человека на ужин, кого бы выбрали и почему?",
  "Хотели бы вы быть знаменитым? Если да — в какой сфере?",
  "Перед звонком кому‑то вы репетируете, что скажете? Зачем?",
  "Как для вас выглядит «идеальный день» от утра до вечера?",
  "Когда вы в последний раз пели себе? А кому‑то другому?",
  "Если бы вы могли прожить до 90 лет, что бы вы сохранили на последние 60 лет: тело 30‑летнего или ум 30‑летнего?",
  "Есть ли у вас предчувствие, как вы умрёте?",
  "Назовите три вещи, которые, как вам кажется, у нас общие.",
  "За что в жизни вы больше всего благодарны?",
  "Если бы вы могли изменить что‑то в своём воспитании, что бы это было?",
  "За четыре минуты расскажите историю своей жизни как можно подробнее.",
  "Если бы завтра вы проснулись с новым качеством или способностью, что бы это было и почему?",

  // Set II (13–24)
  "Если бы «хрустальный шар» мог рассказать правду о вашей жизни, вас самих или будущем — что бы вы хотели узнать?",
  "О чём вы давно мечтаете, но всё откладываете? Почему?",
  "Какое достижение вы считаете самым большим в своей жизни?",
  "Что вы больше всего цените в дружбе?",
  "Какое ваше самое тёплое воспоминание?",
  "Какое ваше самое неприятное воспоминание?",
  "Если бы вы знали, что через год внезапно умрёте, изменили бы что‑то в своей жизни? Почему?",
  "Что для вас значит дружба?",
  "Какую роль играют любовь и привязанность в вашей жизни?",
  "По очереди назовите друг другу по пять ваших сильных качеств.",
  "Насколько близкой была ваша семья? Было ли ваше детство счастливее, чем у большинства?",
  "Как вы описали бы ваши отношения с матерью?",

  // Set III (25–36)
  "Сделайте три правдивых утверждения, начинающихся с «Мы оба…». Например: «Мы оба сейчас…».",
  "Закончите фразу: «Мне хотелось бы иметь человека, с которым можно разделить…».",
  "Если мы станем близкими друзьями, что важно знать о вас заранее?",
  "Скажите партнёру, что вам в нём нравится; будьте честны — скажите то, что обычно оставляете при себе.",
  "Поделитесь неловким моментом из своей жизни.",
  "Когда вы в последний раз плакали при ком‑то? А в одиночестве?",
  "Скажите партнёру, что уже успели в нём оценить.",
  "Есть ли тема, над которой, по‑вашему, шутить слишком серьёзно?",
  "Если бы вы умерли сегодня вечером, не успев никому ничего сказать, о чём больше всего пожалели бы? Почему до сих пор это не сказали?",
  "Ваш дом загорелся. Спасая близких и животных, вы можете вернуться только за одной вещью. Что это и почему?",
  "Чья смерть в вашей семье поразила бы вас сильнее всего? Почему?",
  "Поделитесь личной проблемой и попросите совет у партнёра, как он бы поступил. Пусть он также скажет, как, по его мнению, вы сами относитесь к этой проблеме."
];

/* ===================== Стили игры ===================== */

function Styles() {
  return (
    <style>{`
.q36.root {
  min-height: 100%;
  display: grid;
  grid-template-rows: 1fr;
  padding: clamp(12px, 3.6vw, 16px);
  color: var(--text);
  background: var(--bg);
}

/* Intro / Finish */
.q36 .intro, .q36 .finish {
  max-width: 720px;
  margin: 0 auto;
  text-align: left;
  display: grid;
  gap: 14px;
  padding: clamp(10px, 2.6vw, 14px);
}
.q36 .title { margin: 6px 0; font-size: clamp(22px, 5.6vw, 28px); font-weight: 900; }
.q36 .lead { margin: 0; color: var(--hint); }
.q36 .howto { margin: 0; padding-left: 18px; color: var(--hint); display: grid; gap: 6px; }
.q36 .cta { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 6px; }

/* Buttons */
.q36 .btn {
  padding: 10px 14px;
  border-radius: 12px;
  border: 1px solid color-mix(in srgb, var(--text) 12%, transparent);
  background: color-mix(in srgb, var(--surface) 92%, transparent);
  color: var(--text);
  font-weight: 800;
  letter-spacing: .2px;
  box-shadow: 0 6px 16px rgba(0,0,0,.14);
}
.q36 .btn.primary {
  background: var(--btn);
  color: var(--btn-text);
  border-color: color-mix(in srgb, var(--btn-text) 10%, transparent);
}
.q36 .btn.ghost {
  background: transparent;
}

/* Playing */
.q36 .playing {
  max-width: 820px;
  margin: 0 auto;
  display: grid;
  grid-template-rows: auto 1fr auto;
  gap: 12px;
  height: 100%;
}

.q36 .bar {
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border-radius: 14px;
  background: color-mix(in srgb, var(--surface) 95%, transparent);
  border: 1px solid color-mix(in srgb, var(--text) 10%, transparent);
  box-shadow: 0 6px 16px rgba(0,0,0,.10);
}
.q36 .set { font-size: 13px; color: var(--hint); }
.q36 .counter { font-size: 13px; color: var(--hint); }
.q36 .progress { height: 6px; border-radius: 999px; background: color-mix(in srgb, var(--surface) 60%, transparent); overflow: hidden; }
.q36 .progress .line { height: 100%; background: linear-gradient(90deg, rgba(var(--accent-rgb), .95), rgba(var(--accent-rgb), .4)); }

.q36 .card {
  display: grid;
  align-content: start;
  gap: 10px;
  padding: clamp(14px, 3.2vw, 18px);
  border-radius: 18px;
  background: color-mix(in srgb, var(--surface) 100%, transparent);
  border: 1px solid color-mix(in srgb, var(--text) 10%, transparent);
  box-shadow: 0 10px 28px rgba(0,0,0,.14);
}
.q36 .badge {
  display: inline-block;
  font-size: 12px;
  padding: 4px 8px;
  border-radius: 999px;
  color: var(--text);
  background: color-mix(in srgb, var(--surface) 70%, transparent);
  border: 1px solid color-mix(in srgb, var(--text) 10%, transparent);
  width: fit-content;
}
.q36 .q {
  margin: 0;
  font-size: clamp(18px, 4.8vw, 22px);
  line-height: 1.3;
  font-weight: 800;
}

.q36 .nav {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}
.q36 .btn[disabled] {
  opacity: .5;
  pointer-events: none;
}

/* Small screens */
@media (max-width: 360px) {
  .q36 .q { font-size: 18px; }
}
    `}</style>
  );
}
