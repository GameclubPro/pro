// quiz.jsx
import { useEffect, useRef, useState } from "react";

export default function Quiz({ goBack, onProgress }) {
  const tg = typeof window !== "undefined" ? window?.Telegram?.WebApp : undefined;

  const [stage, setStage] = useState("menu");      // menu | play | finish
  const [difficulty, setDifficulty] = useState("easy"); // easy | medium | hard
  const [questions, setQuestions] = useState([]);  // { text, options[], correct }
  const [idx, setIdx] = useState(0);
  const [score, setScore] = useState(0);           // правильные ответы (штук)
  const [locked, setLocked] = useState(false);
  const [picked, setPicked] = useState(null);
  const [timeLeft, setTimeLeft] = useState(DURATION_MS);
  const [streak, setStreak] = useState(0);         // серия правильных
  const [points, setPoints] = useState(0);         // очки с бонусами
  const [bestPoints, setBestPoints] = useState(0);
  const [isRecord, setIsRecord] = useState(false);
  const [muted, setMuted] = useState(false);
  const [statusMsg, setStatusMsg] = useState("");  // для aria-live
  const progressSent = useRef(false);

  const total = questions.length;
  const current = questions[idx];

  // применяем тему Telegram → CSS custom properties
  useEffect(() => {
    try {
      const tp = tg?.themeParams;
      if (!tp) return;
      const accent = tp.button_color || "#22c55e";
      const [r, g, b] = hexToRgb(accent);
      document.documentElement.style.setProperty("--accent-rgb", `${r} ${g} ${b}`);
      tp.text_color  && document.documentElement.style.setProperty("--text", tp.text_color);
      tp.bg_color    && document.documentElement.style.setProperty("--surface", tp.bg_color);
      tp.hint_color  && document.documentElement.style.setProperty("--hint", tp.hint_color);
    } catch {}
  }, [tg]);

  // тянем best score при смене сложности
  useEffect(() => {
    if (typeof window === "undefined") return;
    const key = "quiz_best_" + difficulty;
    setBestPoints(Number(localStorage.getItem(key)) || 0);
    setIsRecord(false);
  }, [difficulty]);

  // Сгенерировать раунд
  const startGame = () => {
    const round = prepareRound(difficulty);
    setQuestions(round);
    setIdx(0);
    setScore(0);
    setPoints(0);
    setStreak(0);
    setPicked(null);
    setLocked(false);
    setStage("play");
    setTimeLeft(DURATION_MS);
    setStatusMsg("");
    progressSent.current = false;
    try { tg?.HapticFeedback?.impactOccurred?.("medium"); } catch {}
  };

  // Таймер на вопрос: убывает, при нуле — авто-промах
  useEffect(() => {
    if (stage !== "play") return;
    let raf;
    const t0 = performance.now();
    setTimeLeft(DURATION_MS);

    const tick = (t) => {
      const elapsed = t - t0;
      const left = Math.max(0, DURATION_MS - elapsed);
      setTimeLeft(left);

      const canAnswer = picked == null && !locked;
      if (left > 0 && canAnswer) {
        raf = requestAnimationFrame(tick);
      } else if (left === 0 && picked == null) {
        // время вышло — считаем промах
        setPicked(-1);
        setLocked(true);
        setStatusMsg("Время вышло. Ответ не засчитан.");
        try { tg?.HapticFeedback?.notificationOccurred?.("error"); } catch {}
        playBeep(false, muted);
        setTimeout(() => {
          const next = idx + 1;
          if (next < questions.length) {
            setIdx(next);
            setPicked(null);
            setLocked(false);
            setStatusMsg("");
          } else {
            setStage("finish");
          }
        }, 550);
      }
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, idx]); // новый вопрос — новый таймер

  const pickOption = (i) => {
    if (locked || !current) return;
    setLocked(true);
    setPicked(i);
    const correct = i === current.correct;

    try { tg?.HapticFeedback?.notificationOccurred?.(correct ? "success" : "error"); } catch {}
    playBeep(correct, muted);
    setStatusMsg(correct ? "Правильно!" : "Неверно.");

    if (correct) setScore((s) => s + 1);

    // серия + очки (база 100 + бонус за скорость + мультипликатор серии)
    const nextStreak = correct ? streak + 1 : 0;
    setStreak(nextStreak);
    if (correct) {
      const speedBonus = Math.round((timeLeft / DURATION_MS) * 50); // до +50
      const comboBonus = Math.max(0, (nextStreak - 1) * 15);        // +15/ответ после 1-й в серии
      setPoints((p) => p + 100 + speedBonus + comboBonus);
    }

    // короткая пауза для показа окраски
    setTimeout(() => {
      const next = idx + 1;
      if (next < total) {
        setIdx(next);
        setPicked(null);
        setLocked(false);
        setStatusMsg("");
      } else {
        setStage("finish");
      }
    }, 550);
  };

  // Отправляем прогресс в оболочку один раз по факту завершения
  useEffect(() => {
    if (stage === "finish" && !progressSent.current) {
      progressSent.current = true;
      onProgress?.();
    }
  }, [stage, onProgress]);

  // На финише — сохранить рекорд и запустить конфетти
  useEffect(() => {
    if (stage !== "finish") return;
    if (typeof window !== "undefined") {
      const key = "quiz_best_" + difficulty;
      const prev = Number(localStorage.getItem(key) || 0);
      if (points > prev) {
        localStorage.setItem(key, String(points));
        setBestPoints(points);
        setIsRecord(true);
      } else {
        setBestPoints(prev);
        setIsRecord(false);
      }
    }
    // конфетти (простое, без зависимостей)
    const root = document.querySelector(".quiz");
    if (!root) return;
    const wrap = document.createElement("div");
    wrap.className = "confetti";
    root.appendChild(wrap);
    for (let i = 0; i < 18; i++) {
      const s = document.createElement("span");
      s.className = "confetti-p";
      s.style.setProperty("--i", i.toString());
      wrap.appendChild(s);
    }
    const to = setTimeout(() => wrap.remove(), 1800);
    return () => { clearTimeout(to); wrap.remove(); };
  }, [stage, difficulty, points]);

  const labelByDiff = { easy: "Лёгкая", medium: "Средняя", hard: "Сложная" };
  const timePercent = Math.max(0, Math.round((timeLeft / DURATION_MS) * 100));

  return (
    <div className="quiz">
      <QuizStyles />

      {stage === "menu" && (
        <section className="q-card" aria-label="Блиц-викторина — меню">
          <header className="q-head">
            <h1 className="q-title">❓ Блиц-викторина</h1>
            <p className="q-sub">Выбери сложность и нажми «Начать»</p>
          </header>

          <div className="q-block">
            <div className="q-label">Сложность</div>
            <div className="diff">
              {["easy", "medium", "hard"].map((d) => (
                <button
                  key={d}
                  className={`chip ${difficulty === d ? "active" : ""}`}
                  onClick={() => setDifficulty(d)}
                  aria-pressed={difficulty === d}
                >
                  {labelByDiff[d]}
                </button>
              ))}
            </div>
          </div>

          <footer className="q-actions">
            <button className="btn-primary" onClick={startGame} aria-label="Начать игру">
              ▶︎ Начать
            </button>
            <button className="btn-ghost" onClick={goBack} aria-label="Выйти">
              Выйти
            </button>
          </footer>
        </section>
      )}

      {stage === "play" && current && (
        <section className="q-card" aria-label="Блиц-викторина — вопрос">
          <header className="q-head row">
            <div className="muted">Сложность: <b>{labelByDiff[difficulty]}</b></div>
            <div className="muted">Вопрос {idx + 1} / {total}</div>
            <div className="muted">Баллы: <b>{points}</b></div>
            <div className="muted">Серия: <b>{streak}</b></div>
            <button className="btn-ghost small" onClick={() => setMuted(m => !m)} aria-label="Звук">
              {muted ? "🔇" : "🔊"}
            </button>
          </header>

          {/* Полоска таймера */}
          <div
            className="timer"
            role="progressbar"
            aria-label={`Осталось времени: ${Math.ceil(timeLeft / 1000)} секунд`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={timePercent}
          >
            <div className="bar" style={{ width: `${timePercent}%` }} />
          </div>

          <div className="q-text" role="heading" aria-level={2}>{current.text}</div>

          <div className="options" role="list">
            {current.options.map((opt, i) => {
              const isPicked = picked === i;
              const cls =
                picked == null
                  ? "opt"
                  : i === current.correct
                  ? "opt correct"
                  : isPicked
                  ? "opt wrong"
                  : "opt dim";
              return (
                <button
                  key={opt + i}
                  className={cls}
                  onClick={() => pickOption(i)}
                  disabled={picked != null}
                  role="listitem"
                >
                  {opt}
                </button>
              );
            })}
          </div>

          {/* aria-live для мгновенного фидбэка экранным читателям */}
          <div className="sr-only" aria-live="polite" aria-atomic="true">{statusMsg}</div>

          <footer className="q-actions between">
            <button className="btn-ghost" onClick={goBack} aria-label="Завершить и выйти">Завершить</button>
            <div className="muted">Совет: отвечай быстро — это же блиц 😊</div>
          </footer>
        </section>
      )}

      {stage === "finish" && (
        <section className="q-card" aria-label="Итоги">
          <header className="q-head">
            <h2 className="q-title">🏁 Раунд завершён</h2>
            <p className="q-sub">Сложность: <b>{labelByDiff[difficulty]}</b></p>
          </header>

          <div className="result" aria-live="polite" aria-atomic="true">
            <div className="score">{score} / {total}</div>
            <div className="caption">{feedback(score, total)}</div>
            <div className="muted">Баллы за раунд: <b>{points}</b></div>
            <div className="muted">
              Лучший результат: <b>{bestPoints}</b> {isRecord ? " 🎉 Новый рекорд!" : ""}
            </div>
          </div>

          <footer className="q-actions">
            <button className="btn-primary" onClick={startGame} aria-label="Сыграть ещё">↻ Сыграть ещё</button>
            <button className="btn-ghost" onClick={goBack} aria-label="Выйти">Выйти</button>
          </footer>
        </section>
      )}
    </div>
  );
}

/* ---------------- Константы, вспомогательные функции и данные ---------------- */

const QUESTION_COUNT = 8;
const DURATION_MS = 12000; // 12 секунд на вопрос

function prepareRound(difficulty) {
  const bank = QUIZ_BANK[difficulty] ?? [];
  const shuffled = shuffle(bank.slice());
  const take = shuffled.slice(0, Math.min(QUESTION_COUNT, shuffled.length));

  // Перемешиваем варианты у каждого вопроса, корректируя индекс правильного
  return take.map((q) => {
    const opts = q.options.slice();
    const shuffledOpts = shuffle(opts);
    const correctValue = q.options[q.correct];
    const correctIndex = shuffledOpts.findIndex((o) => o === correctValue);
    return { text: q.text, options: shuffledOpts, correct: correctIndex };
  });
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function feedback(score, total) {
  const r = score / Math.max(1, total);
  if (r === 1) return "Идеально! 🔥";
  if (r >= 0.75) return "Отличный результат! 💪";
  if (r >= 0.5) return "Неплохо! Ещё немного — и будет топ 🙌";
  return "Разогрелись — попробуй ещё раз! 🙂";
}

function hexToRgb(hex) {
  const h = hex.replace("#", "");
  const v = parseInt(h.length === 3 ? h.split("").map(x => x + x).join("") : h, 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

function playBeep(ok = true, muted = false) {
  if (muted || typeof window === "undefined") return;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  const ctx = new AC();
  const o = ctx.createOscillator(); const g = ctx.createGain();
  o.type = "sine"; o.frequency.value = ok ? 1200 : 200;
  g.gain.value = 0.06; // очень тихо
  o.connect(g); g.connect(ctx.destination);
  o.start();
  setTimeout(() => { o.stop(); ctx.close(); }, 90);
}

/* ---------------- Банк вопросов (RU) ---------------- */

const QUIZ_BANK = {
  easy: [
    { text: "Столица России?", options: ["Москва", "Санкт-Петербург", "Казань", "Новосибирск"], correct: 0 },
    { text: "Сколько будет 2 + 2?", options: ["3", "4", "5", "6"], correct: 1 },
    { text: "Какой цвет получается при смешении синего и жёлтого?", options: ["Зелёный", "Оранжевый", "Фиолетовый", "Красный"], correct: 0 },
    { text: "Сколько дней в неделе?", options: ["5", "6", "7", "8"], correct: 2 },
    { text: "Самый большой океан?", options: ["Тихий", "Атлантический", "Индийский", "Северный Ледовитый"], correct: 0 },
    { text: "Какая планета ближе всего к Солнцу?", options: ["Венера", "Меркурий", "Земля", "Марс"], correct: 1 },
    { text: "Сколько будет 10 − 3?", options: ["6", "7", "8", "9"], correct: 1 },
    { text: "Как называется естественный спутник Земли?", options: ["Луна", "Фобос", "Европа", "Титан"], correct: 0 },
  ],
  medium: [
    { text: "Столица Австралии?", options: ["Сидней", "Мельбурн", "Канберра", "Перт"], correct: 2 },
    { text: "Кто автор романа «Война и мир»?", options: ["А. Пушкин", "Ф. Достоевский", "Л. Толстой", "А. Чехов"], correct: 2 },
    { text: "Химический символ золота?", options: ["Ag", "Au", "Fe", "Pb"], correct: 1 },
    { text: "Какой из этих годов был високосным?", options: ["2019", "2020", "2021", "2022"], correct: 1 },
    { text: "В каком океане находится Мадагаскар?", options: ["Атлантическом", "Индийском", "Тихом", "Северном Ледовитом"], correct: 1 },
    { text: "Сколько градусов в прямом угле?", options: ["90", "180", "60", "45"], correct: 0 },
    { text: "Самый большой по площади остров мира?", options: ["Новая Гвинея", "Гренландия", "Борнео", "Мадагаскар"], correct: 1 },
    { text: "Какой газ преобладает в атмосфере Земли?", options: ["Кислород", "Азот", "Углекислый газ", "Аргон"], correct: 1 },
  ],
  hard: [
    { text: "Какая планета имеет самый длинный день (по вращению вокруг оси)?", options: ["Венера", "Меркурий", "Юпитер", "Сатурн"], correct: 0 },
    { text: "В каком году распался СССР?", options: ["1989", "1991", "1993", "1995"], correct: 1 },
    { text: "Самая высокая вершина Европы (с учётом Кавказа)?", options: ["Монблан", "Эльбрус", "Дыхтау", "Шхара"], correct: 1 },
    { text: "Переход вещества из твёрдого состояния сразу в газообразное — это…", options: ["Конденсация", "Возгонка", "Испарение", "Плавление"], correct: 1 },
    { text: "Первый искусственный спутник Земли был запущен в … году.", options: ["1955", "1957", "1961", "1969"], correct: 1 },
    { text: "Главный «энергетический носитель» клетки:", options: ["Глюкоза", "ДНК", "АТФ", "РНК"], correct: 2 },
    { text: "Какой химический элемент имеет атомный номер 6?", options: ["Азот", "Кислород", "Углерод", "Бор"], correct: 2 },
    { text: "Наименьшая единица информации — это…", options: ["Байт", "Бит", "Килобайт", "Гигабайт"], correct: 1 },
  ],
};

/* ---------------- Стили только для этой игры ---------------- */

function QuizStyles() {
  return (
    <style
      dangerouslySetInnerHTML={{
        __html: `
:root{
  --text:#0f172a;
  --surface:#0b1220;
  --hint:#7c8aa5;
  --accent-rgb:34 197 94;
  --btn-text:#fff;
}
.quiz {
  min-height: 100%;
  display: grid;
  place-items: center;
  padding: clamp(12px, 3vh, 20px);
  color: var(--text);
  -webkit-tap-highlight-color: transparent;
  touch-action: manipulation;
  position: relative;
}
.q-card {
  width: 100%;
  max-width: 760px;
  background: color-mix(in srgb, var(--surface) 96%, transparent);
  border: 1px solid color-mix(in srgb, var(--text) 12%, transparent);
  border-radius: 16px;
  box-shadow: 0 10px 30px rgba(0,0,0,.12);
  padding: clamp(14px, 3.4vh, 22px);
}
.q-head { margin-bottom: 8px; }
.q-head.row { display:flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 8px; }
.q-title { margin: 0; font-size: clamp(20px, 3.6vw, 26px); font-weight: 900; letter-spacing: .2px; }
.q-sub { margin: 6px 0 0; color: var(--hint); }

.q-block { margin-top: 14px; }
.q-label { font-size: 13px; color: var(--hint); margin-bottom: 8px; }

.diff { display: flex; gap: 8px; flex-wrap: wrap; }
.chip {
  padding: 8px 12px;
  font-weight: 800;
  border-radius: 999px;
  border: 1px solid color-mix(in srgb, var(--text) 12%, transparent);
  background: color-mix(in srgb, var(--surface) 80%, transparent);
}
.chip.active {
  background: color-mix(in srgb, rgb(var(--accent-rgb)) 22%, transparent);
  border-color: color-mix(in srgb, rgb(var(--accent-rgb)) 40%, transparent);
  box-shadow: 0 8px 22px rgba(0,0,0,.12);
}

.timer {
  position: relative;
  height: 8px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--text) 10%, transparent);
  overflow: hidden;
  margin: 10px 0;
}
.timer .bar {
  height: 100%;
  width: 100%;
  background: color-mix(in srgb, rgb(var(--accent-rgb)) 60%, transparent);
  transition: width .08s linear;
}

.q-text {
  margin: 14px 0 12px;
  font-size: clamp(18px, 3.6vw, 22px);
  font-weight: 800;
  line-height: 1.25;
  animation: fadeSlide .22s ease;
}

.options {
  display: grid;
  gap: 10px;
  margin-top: 8px;
  animation: fadeSlide .22s ease;
}
.opt {
  text-align: left;
  padding: 12px;
  border-radius: 14px;
  border: 1px solid color-mix(in srgb, var(--text) 12%, transparent);
  background: color-mix(in srgb, var(--surface) 88%, transparent);
  transition: transform .12s ease, background .12s ease, border-color .12s ease, box-shadow .12s ease, opacity .12s ease;
  font-weight: 700;
  min-height: 48px;
}
.opt:active { transform: scale(.995); }
.opt.correct {
  background: color-mix(in srgb, #22c55e 18%, var(--surface));
  border-color: color-mix(in srgb, #22c55e 42%, var(--text));
  animation: pop .28s ease;
}
.opt.wrong {
  background: color-mix(in srgb, #ef4444 18%, var(--surface));
  border-color: color-mix(in srgb, #ef4444 42%, var(--text));
  animation: shake .32s ease;
}
.opt.dim { opacity: .65; }

.q-actions {
  display:flex; gap: 10px; margin-top: 16px; flex-wrap: wrap;
}
.q-actions.between { justify-content: space-between; align-items: center; }

.btn-primary, .btn-ghost {
  padding: 12px 14px;
  border-radius: 12px;
  border: 1px solid color-mix(in srgb, var(--text) 12%, transparent);
  font-weight: 900;
}
.btn-primary {
  background: rgb(var(--accent-rgb));
  color: var(--btn-text, #fff);
  box-shadow: 0 10px 24px rgba(0,0,0,.14), 0 16px 50px rgba(var(--accent-rgb), .20);
}
.btn-ghost {
  background: color-mix(in srgb, var(--surface) 88%, transparent);
  color: var(--text);
}
.btn-ghost.small { padding: 8px 10px; font-weight: 800; }

.result { display:grid; place-items:center; gap: 6px; margin: 10px 0; }
.score { font-size: clamp(28px, 6vw, 40px); font-weight: 900; letter-spacing: .4px; }
.caption { color: var(--hint); text-align:center; }

.muted { color: var(--hint); font-size: 13px; }

@media (max-width: 420px) {
  .q-head.row { flex-direction: column; align-items: flex-start; gap: 4px; }
}

/* анимации */
@keyframes pop {
  0% { transform: scale(.98); }
  60% { transform: scale(1.02); }
  100% { transform: scale(1); }
}
@keyframes shake {
  10%, 90% { transform: translateX(-1.5%); }
  30%, 70% { transform: translateX(1.5%); }
  50% { transform: translateX(-1%); }
}
@keyframes fadeSlide {
  from { opacity: 0; transform: translateY(6px); }
  to   { opacity: 1; transform: translateY(0); }
}

/* конфетти */
.confetti {
  pointer-events: none;
  position: absolute;
  inset: 0;
  overflow: hidden;
}
.confetti-p {
  position: absolute;
  top: -10px;
  left: calc(var(--i) * 5%);
  width: 8px; height: 12px;
  background: hsl(calc(var(--i)*20), 90%, 60%);
  border-radius: 2px;
  animation: drop 1.2s ease-in forwards, spin 1.2s linear;
  opacity: .9;
}
@keyframes drop {
  to { transform: translateY(110vh) rotate(0deg); opacity: .0; }
}
@keyframes spin {
  from { transform: rotate(0deg); }
  to   { transform: rotate(360deg); }
}

/* доступность */
.sr-only {
  position: absolute;
  width: 1px; height: 1px;
  padding: 0; margin: -1px;
  overflow: hidden; clip: rect(0,0,0,0);
  white-space: nowrap; border: 0;
}

/* уважение к reduce motion */
@media (prefers-reduced-motion: reduce) {
  * { animation: none !important; transition: none !important; }
}
        `,
      }}
    />
  );
}
