import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./knyaz.css";

const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

const CASES = [
  {
    id: "smith",
    name: "Добрыня Коваль",
    title: "кузнец дружины",
    accusation: "Разбавил сталь в княжеских мечах, из-за чего клинки треснули на учении.",
    brief: "Гордится ремеслом, но казна пуста и тысяцкий требовал экономить. В долгах за уголь.",
    baseSuspicion: 60,
    location: "Кузница у северной башни",
    evidence: ["На учении сломались два клинка", "Кузница горела ночью без приказа", "В расходной книге недостача угля"],
    rounds: [
      {
        title: "Про металл",
        options: [
          { text: "Кто привёз тебе руду для партии мечей?", answer: "Варяги с пристани. Цена была сладкая, сплав — не мой.", impact: 8 },
          { text: "Почему кузница работала ночью без приказа?", answer: "Переплавлял бракованные заготовки, хотел успеть к сбору дружины.", impact: 3 },
          { text: "Были свидетели, как закаливал сталь?", answer: "Ученики Лад и Тверд стояли рядом, могут подтвердить каждый удар.", impact: -6 },
          { text: "Зачем взял долг за уголь?", answer: "Купил сухой уголь у кривичей, чтобы клинок звенел как звонница.", impact: -2 },
        ],
      },
      {
        title: "Про мотив",
        options: [
          { text: "Кто требовал экономить на стали?", answer: "Тысяцкий шепнул: «казна тонка, делай гибче, не трать лишнее».", impact: 10 },
          { text: "Продавал ли клинки на сторону?", answer: "Записи продаж чисты, на торгу мечей не выдавал, только подковы.", impact: -4 },
          { text: "Почему клинки оказались мягкими?", answer: "Рискнул сделать гибкими, чтобы не ломались в бою. Ошибся с долей.", impact: 4 },
          { text: "Дашь образец стали дружине прямо сейчас?", answer: "Приносит заготовку, предлагает закалить при сотне свидетелей.", impact: -8 },
        ],
      },
      {
        title: "Последнее слово",
        options: [
          { text: "Клятва на молоте кузнеца?", answer: "Бьёт по наковальне и клянётся, что не крал и не трусил.", impact: -5 },
          { text: "Кто поручится за тебя?", answer: "Староста кузни Глеб и старый оружейник Снедь.", impact: -3 },
          { text: "Сколько серебра взял сверх?", answer: "Отводит взгляд, считает в голове и молчит слишком долго.", impact: 9 },
          { text: "Возместишь дружине ущерб?", answer: "Готов выковать три меча за свой счёт, но просит срок до ярмарки.", impact: -2 },
        ],
      },
    ],
  },
  {
    id: "herbalist",
    name: "Малуша Травница",
    title: "лекарка из прибрежного села",
    accusation: "Её отвар убил сына рыбака, сосед клянётся, что в зелье была гниль.",
    brief: "Лечит людей травами бабки, ходит за сборами в полночь и не доверяет монастырским лекарям.",
    baseSuspicion: 55,
    location: "Избушка у реки",
    evidence: ["Рыбак говорил о тухлом запахе зелья", "Травы собирала на болоте после грозы", "Раньше помогала дружинникам от ран"],
    rounds: [
      {
        title: "Сбор трав",
        options: [
          { text: "Где брала травы для зелья?", answer: "На болоте после грозы — там корень сочный, хоть и тянет глиной.", impact: 6 },
          { text: "Кто видел, как ты собирала?", answer: "Внучка Акулина была рядом, да ещё пастух Прохор гонял стадо.", impact: -4 },
          { text: "Почему отдала зелье бесплатно?", answer: "Видела, что мальцу худо, серебро брать постыдилась.", impact: -2 },
          { text: "Почему скрыла рецепт от старосты?", answer: "Бабка завещала молчать, чтоб варево не попало к злым рукам.", impact: 4 },
        ],
      },
      {
        title: "Проверка ремесла",
        options: [
          { text: "Были ли ещё пострадавшие?", answer: "Нет, лечила дружинников и ратников — все стоят на ногах.", impact: -5 },
          { text: "Почему не позвала монастырского лекаря?", answer: "Он берёт серебром, а время шло. Я была ближе всех.", impact: 2 },
          { text: "Смешивала травы ночью?", answer: "Да, росу ловила к рассвету — так отвар крепче, хоть и темнее.", impact: 3 },
          { text: "Сваришь то же при свидетелях?", answer: "Пусть стоят хоть весь день — сварю при тебе, княже.", impact: -6 },
        ],
      },
      {
        title: "Последнее слово",
        options: [
          { text: "Отдашь записи рецептов?", answer: "Протягивает дощечку с метками, дрожит, но отдаёт.", impact: -4 },
          { text: "Кого винить в смерти мальца?", answer: "Клянётся на иконе — вина её, просит суд Божий.", impact: 1 },
          { text: "Готова на испытание водой?", answer: "Говорит: «Если утону — воля Твоя, если всплыву — лечить продолжу».", impact: -5 },
          { text: "Откажешься от ремесла, если велю?", answer: "Без меня село останется без лекаря, бросить не могу.", impact: 5 },
        ],
      },
    ],
  },
  {
    id: "tax",
    name: "Станимир",
    title: "сборщик дани",
    accusation: "Часть зерна исчезла по дороге, а у Станимира вдруг выросла новая изба.",
    brief: "Считает себя незаменимым, любит считать мешки сам. Ночами виделись две телеги без стражи.",
    baseSuspicion: 65,
    location: "Амбар на валу",
    evidence: ["В описи пропало три меры зерна", "У него новая изба с коваными петлями", "Слышали телеги уходящие до рассвета"],
    rounds: [
      {
        title: "Учёт дани",
        options: [
          { text: "Где сейчас лежит собранная дань?", answer: "В амбаре на валу, ключ у тысяцкого, замок цел.", impact: -2 },
          { text: "Почему у тебя новая изба?", answer: "Жена принесла приданое, тесть помог брёвнами — всё честно.", impact: 5 },
          { text: "Кто считал мешки вместе с тобой?", answer: "Старосты ставили зарубки, зови Кондрата и Милка — подтвердят.", impact: -4 },
          { text: "Почему две телеги уходили ночью?", answer: "Гнал зерно в крепость до дождя, чтобы не отсырело.", impact: 6 },
        ],
      },
      {
        title: "Мотив",
        options: [
          { text: "Сколько недостачи по списку?", answer: "Три меры, но половина сгнила — я предупредил, не слушали.", impact: 3 },
          { text: "Поклянешься серебром?", answer: "Кладёт гривну на стол: «Если лгу — возьми».", impact: -5 },
          { text: "Кого бы ты казнил за шёпот?", answer: "Показывает на соперника из соседнего рода, явно готов отвести стрелы.", impact: 7 },
          { text: "Кто сопровождал телеги?", answer: "Двое молодых дружинников, позвать могу сейчас.", impact: -3 },
        ],
      },
      {
        title: "Последнее слово",
        options: [
          { text: "Возместишь недостачу из личного?", answer: "Готов вернуть одну меру, остальное не потяну.", impact: -2 },
          { text: "Скрывал ли прежде?", answer: "Отводит глаза, молчит, кулаки белеют.", impact: 8 },
          { text: "Община проверит амбар — согласен?", answer: "Да, пусть смотрят и считают прямо сейчас.", impact: -4 },
          { text: "Зачем купил кованый пояс?", answer: "Подарок теще на имяны, хоть и не к месту сейчас.", impact: 4 },
        ],
      },
    ],
  },
  {
    id: "messenger",
    name: "Ратибор",
    title: "гонец дружины",
    accusation: "Печенеги заранее знали тропу княжьего обозa — шепчут, что Ратибор слил маршрут.",
    brief: "Быстрый, но держит связи с купцами. На воротах нашли чужую бирку, коня менял ночью.",
    baseSuspicion: 62,
    location: "Конюшня у ворот",
    evidence: ["У ворот нашли чужую бирку", "Печенеги устроили засаду на тайной тропе", "Коня Ратибор переобувал ночью"],
    rounds: [
      {
        title: "Перед дорогой",
        options: [
          { text: "Где был, когда случилась засада?", answer: "Чинил мосток через ручей, задержался с людьми", impact: 5 },
          { text: "Кто видел тебя на рассвете?", answer: "Сторож Влас и корчмарь Гремик — я за овсом заходил.", impact: -3 },
          { text: "Почему у тебя чужая бирка?", answer: "Поднял на дороге, хотел показать дьяку, да забыл отдать.", impact: 6 },
          { text: "Зачем переобул коня ночью?", answer: "Копыта разбил в броде, иначе утром не добежал бы.", impact: 2 },
        ],
      },
      {
        title: "Связи",
        options: [
          { text: "Кому писал донесение?", answer: "Купцам из Смоленска, просили вести о бурях — ничего тайного.", impact: 7 },
          { text: "Покажешь свитки?", answer: "Достаёт сухой свиток с маршрутами, отпечатки сухие, без масла.", impact: 4 },
          { text: "Готов на допрос дружины?", answer: "Да, пусть спрашивают, сам хочу знать, кто шепчет на меня.", impact: -4 },
          { text: "Кто поручится за тебя?", answer: "Ветеран Секунт, что служил при отце твоём.", impact: -5 },
        ],
      },
      {
        title: "Последнее слово",
        options: [
          { text: "Пойдёшь ли завтра в передовой сотне?", answer: "Да хоть сейчас, лишь дай коня и путь.", impact: -3 },
          { text: "Сколько серебра получил за вести?", answer: "Отрицает, но голос дрожит — лоб вспотел.", impact: 8 },
          { text: "Что скажешь роду, если казню?", answer: "Примут волю, но дорога к Киеву лишится гонца.", impact: -1 },
          { text: "Согласен ли на клеймо и изгнание вместо топора?", answer: "Просит оставить руку: «Буду метить копья, лишь живи оставь».", impact: 6 },
        ],
      },
    ],
  },
];

const VERDICTS = [
  { id: "execute", label: "Казнить", flavor: "ждёт топор палача", accent: "danger" },
  { id: "pardon", label: "Помиловать", flavor: "вернуть в общину", accent: "soft" },
  { id: "penance", label: "Взять виру / сослать", flavor: "штраф, клеймо или ссылка", accent: "warning" },
];

const impactMood = (impact) => {
  if (impact >= 7) return "усиливает обвинение";
  if (impact >= 3) return "сомнительно";
  if (impact > -2) return "не меняет сути";
  if (impact > -6) return "склоняет к милости";
  return "оправдывает";
};

const crowdReaction = (score) => {
  if (score >= 75) return "Толпа требует крови и ждёт жёсткого приговора.";
  if (score >= 60) return "Люди напряжены, но ещё смотрят на твою милость.";
  if (score >= 45) return "Народ прислушивается к аргументам, ждут твоего жеста.";
  return "Толпа склоняется к милости и ждёт благородства князя.";
};

const useHaptics = (enabled = true) =>
  useCallback(
    (style = "light") => {
      if (!enabled) return;
      try {
        window?.Telegram?.WebApp?.HapticFeedback?.impactOccurred?.(style);
      } catch {
        /* noop */
      }
    },
    [enabled]
  );

export default function KnyazCourt({ goBack, onProgress, setBackHandler }) {
  const [phase, setPhase] = useState("intro"); // intro | case | dialogue | verdict | result
  const [caseIndex, setCaseIndex] = useState(0);
  const [round, setRound] = useState(0);
  const [dialogue, setDialogue] = useState([]);
  const [selected, setSelected] = useState(null);
  const [chosenVerdict, setChosenVerdict] = useState(null);
  const [customPenalty, setCustomPenalty] = useState("");
  const [decision, setDecision] = useState(null);
  const [toast, setToast] = useState("");
  const toastTimer = useRef(null);

  const currentCase = CASES[caseIndex];
  const totalRounds = currentCase.rounds.length;
  const haptic = useHaptics();
  const progress = Math.round(((caseIndex + 1) / CASES.length) * 100);

  const guiltScore = useMemo(() => {
    const delta = dialogue.reduce((sum, entry) => sum + (entry.impact || 0), 0);
    return clamp(currentCase.baseSuspicion + delta, 5, 95);
  }, [currentCase, dialogue]);

  const leanText = useMemo(() => {
    if (guiltScore >= 70) return "Люд шепчет о крови, дружина ждёт показательной кары.";
    if (guiltScore >= 55) return "Слухи накалены, но ещё можно склонить чашу милостью.";
    if (guiltScore >= 40) return "Толпа колеблется — ждут твоего слова и твёрдого жеста.";
    return "Народ видит больше оправданий, чем вины — милость не ослабит тебя.";
  }, [guiltScore]);

  const resetToast = useCallback(() => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = null;
  }, []);

  useEffect(() => {
    if (!toast) return;
    resetToast();
    toastTimer.current = setTimeout(() => setToast(""), 2200);
    return resetToast;
  }, [toast, resetToast]);

  const handleBack = useCallback(() => {
    if (phase === "dialogue" || phase === "verdict") {
      setPhase("case");
      setSelected(null);
      return;
    }
    if (phase === "result") {
      setPhase("case");
      return;
    }
    goBack?.();
  }, [goBack, phase]);

  useEffect(() => {
    if (!setBackHandler) return undefined;
    setBackHandler(handleBack);
    return () => setBackHandler(null);
  }, [handleBack, setBackHandler]);

  const startCase = useCallback(() => {
    setDialogue([]);
    setSelected(null);
    setChosenVerdict(null);
    setCustomPenalty("");
    setDecision(null);
    setRound(0);
    setPhase("case");
  }, []);

  const startInterrogation = () => {
    haptic("medium");
    setDialogue([]);
    setSelected(null);
    setChosenVerdict(null);
    setCustomPenalty("");
    setDecision(null);
    setRound(0);
    setPhase("dialogue");
  };

  const pickQuestion = (option) => {
    if (selected) return;
    haptic("light");
    const payload = { ...option, round };
    setSelected(payload);
    setDialogue((prev) => {
      const withoutCurrent = prev.filter((entry) => entry.round !== round);
      return [...withoutCurrent, payload];
    });
  };

  const resetSelection = () => {
    setSelected(null);
    setDialogue((prev) => prev.filter((entry) => entry.round !== round));
  };

  const nextStep = () => {
    if (!selected && round < totalRounds) {
      setToast("Выбери вопрос, чтобы двигаться дальше.");
      return;
    }
    if (round + 1 >= totalRounds) {
      setPhase("verdict");
      setRound(totalRounds - 1);
      setSelected(null);
      return;
    }
    setRound((r) => r + 1);
    setSelected(null);
  };

  const goVerdictDirect = () => {
    haptic("light");
    setPhase("verdict");
    setSelected(null);
  };

  const finalizeVerdict = () => {
    const note = customPenalty.trim();
    if (!chosenVerdict && !note) {
      setToast("Сначала выбери приговор или впиши свой вариант.");
      return;
    }
    const chosen = chosenVerdict || { id: "custom", label: "Иное наказание", flavor: note ? note : "Своя воля" };
    const result = { ...chosen, note };
    setDecision(result);
    setPhase("result");
    onProgress?.();
    haptic("medium");
  };

  const nextCase = () => {
    const nextIdx = (caseIndex + 1) % CASES.length;
    setCaseIndex(nextIdx);
    setPhase("case");
    setDialogue([]);
    setSelected(null);
    setChosenVerdict(null);
    setCustomPenalty("");
    setDecision(null);
    setRound(0);
  };

  const presentRound = currentCase.rounds[round] || currentCase.rounds[0];
  const reaction = crowdReaction(guiltScore);

  return (
    <div className="knyaz">
      <div className="knyaz-wrap">
        <header className="knyaz-header">
          <div className="knyaz-title">
            <span className="knyaz-emoji" aria-hidden>
              🏰
            </span>
            <div>
              <div className="knyaz-name">Княжий суд</div>
              <div className="knyaz-sub">Древнерусское княжество · дела без суда присяжных</div>
            </div>
          </div>
          <div className="knyaz-actions">
            <button className="knyaz-btn ghost" onClick={goBack}>
              Выйти
            </button>
            <button className="knyaz-btn" onClick={phase === "intro" ? startCase : startInterrogation}>
              {phase === "intro" ? "Начать суд" : "Новый допрос"}
            </button>
          </div>
        </header>

        <div className="knyaz-layout">
          <div className="knyaz-case">
            <div className="case-head">
              <div className="pill">
                Дело {caseIndex + 1}/{CASES.length}
              </div>
              <div className="pill muted">{currentCase.location}</div>
            </div>
            <div className="progress">
              <div className="progress-track">
                <div className="progress-bar" style={{ width: `${progress}%` }} />
              </div>
              <div className="progress-label">Прогресс: {progress}%</div>
            </div>
            <h2 className="case-title">{currentCase.name}</h2>
            <div className="case-role">{currentCase.title}</div>
            <p className="case-accusation">{currentCase.accusation}</p>
            <p className="case-brief">{currentCase.brief}</p>

            <div className="evidence">
              {currentCase.evidence.map((item) => (
                <div key={item} className="evidence-item">
                  <span className="dot" />
                  <span>{item}</span>
                </div>
              ))}
            </div>

            <div className="actions-row">
              <button className="knyaz-btn primary" onClick={startInterrogation}>
                Провести допрос · 3 раунда
              </button>
              <button className="knyaz-btn ghost" onClick={goVerdictDirect}>
                Решить сразу
              </button>
            </div>
          </div>

          <div className="knyaz-panel">
            {phase === "case" && (
              <div className="intro">
                <div className="pill">Подготовка</div>
                <h2>Решай сам или допрашивай</h2>
                <p>
                  У тебя три раунда допроса: в каждом четыре вопроса, но выбрать можно только один. Можно пропустить
                  допрос и сразу вынести решение. После допроса реши — казнить, помиловать или придумать иное наказание.
                </p>
                <div className="actions-row">
                  <button className="knyaz-btn primary" onClick={startInterrogation}>
                    К вопросам
                  </button>
                  <button className="knyaz-btn ghost" onClick={goVerdictDirect}>
                    Сразу к приговору
                  </button>
                </div>
              </div>
            )}
            {phase === "dialogue" && (
              <div className="dialogue">
                <div className="strip">
                  <span className="pill">Раунд {round + 1} / {totalRounds}</span>
                  <span className="pill muted">Выбери один вопрос</span>
                </div>
                <div className="meter">
                  <div className="meter-bar" style={{ width: `${guiltScore}%` }} />
                  <div className="meter-scale">
                    <span>Милость</span>
                    <span>Вина</span>
                  </div>
                  <div className="meter-label">
                    Вина: {guiltScore}% — {leanText}
                  </div>
                  <div className="meter-reaction">{reaction}</div>
                </div>
                <div className="question-grid">
                  {presentRound.options.map((opt) => {
                    const active = selected?.text === opt.text;
                    return (
                      <button
                        key={opt.text}
                        className={`question ${active ? "active" : ""}`}
                        onClick={() => pickQuestion(opt)}
                      >
                        <div className="question-text">{opt.text}</div>
                        {active && <div className="question-answer">{opt.answer}</div>}
                        <div className={`impact ${opt.impact > 0 ? "danger" : opt.impact < 0 ? "soft" : ""}`}>
                          {impactMood(opt.impact)} ({opt.impact > 0 ? "+" : ""}
                          {opt.impact})
                        </div>
                      </button>
                    );
                  })}
                </div>
                <div className="dialogue-footer">
                  {selected && (
                    <button className="knyaz-btn ghost" onClick={resetSelection}>
                      Сбросить выбор
                    </button>
                  )}
                  <button className="knyaz-btn ghost" onClick={goVerdictDirect}>
                    Вынести приговор без оставшихся раундов
                  </button>
                  <button className="knyaz-btn primary" onClick={nextStep}>
                    {round + 1 >= totalRounds ? "К приговору" : "Следующий раунд"}
                  </button>
                </div>
              </div>
            )}

            {phase === "verdict" && (
              <div className="verdict">
                <div className="strip">
                  <span className="pill">Приговор</span>
                  <span className="pill muted">Записи допроса</span>
                </div>
                <div className="meter">
                  <div className="meter-bar" style={{ width: `${guiltScore}%` }} />
                  <div className="meter-scale">
                    <span>Милость</span>
                    <span>Вина</span>
                  </div>
                  <div className="meter-label">
                    Вина: {guiltScore}% — {leanText}
                  </div>
                  <div className="meter-reaction">{reaction}</div>
                </div>
                <div className="log">
                  {dialogue.length === 0 && <div className="log-empty">Без допроса — решение на тебе.</div>}
                  {dialogue
                    .sort((a, b) => a.round - b.round)
                    .map((entry) => (
                      <div key={`${entry.round}-${entry.text}`} className="log-item">
                        <div className="log-round">Раунд {entry.round + 1}</div>
                        <div className="log-q">{entry.text}</div>
                        <div className="log-a">{entry.answer}</div>
                        <div className={`log-impact ${entry.impact > 0 ? "danger" : entry.impact < 0 ? "soft" : ""}`}>
                          {impactMood(entry.impact)} ({entry.impact > 0 ? "+" : ""}
                          {entry.impact})
                        </div>
                      </div>
                    ))}
                </div>

                <div className="verdict-options">
                  {VERDICTS.map((v) => {
                    const active = chosenVerdict?.id === v.id;
                    return (
                      <button
                        key={v.id}
                        className={`verdict-card ${v.accent} ${active ? "active" : ""}`}
                        onClick={() => setChosenVerdict(v)}
                      >
                        <div className="verdict-title">{v.label}</div>
                        <div className="verdict-desc">{v.flavor}</div>
                      </button>
                    );
                  })}
                </div>

                <label className="custom-penalty">
                  <div className="custom-title">Другой вариант наказания</div>
                  <textarea
                    rows={2}
                    placeholder="Например: отработать в кузнице, выслать в монастырь, лишить части дани…"
                    value={customPenalty}
                    onChange={(e) => setCustomPenalty(e.target.value)}
                  />
                </label>

                <div className="dialogue-footer">
                  <button className="knyaz-btn ghost" onClick={() => setPhase("dialogue")}>
                    Вернуться к вопросам
                  </button>
                  <button className="knyaz-btn primary" onClick={finalizeVerdict}>
                    Утвердить решение
                  </button>
                </div>
              </div>
            )}

            {phase === "result" && decision && (
              <div className="result">
                <div className="pill">Дело закрыто</div>
                <h3 className="result-title">{currentCase.name}</h3>
                <div className="result-verdict">
                  <div className={`badge ${decision.id === "execute" ? "danger" : decision.id === "pardon" ? "soft" : "warning"}`}>
                    {decision.label}
                  </div>
                  <div className="result-note">
                    {decision.note || decision.flavor || "Решение принято словом князя."}
                  </div>
                </div>
                <div className="result-reaction">
                  <div className="pill muted">Реакция людей</div>
                  <div className="result-note strong">{reaction}</div>
                </div>
                <div className="result-summary">
                  <div>
                    Вина: <b>{guiltScore}%</b>
                  </div>
                  <div>
                    Лог допроса: <b>{dialogue.length ? `${dialogue.length} из ${totalRounds}` : "пропущен"}</b>
                  </div>
                </div>
                <div className="dialogue-footer">
                  <button className="knyaz-btn ghost" onClick={startCase}>
                    Переиграть дело
                  </button>
                  <button className="knyaz-btn ghost" onClick={goBack}>Завершить суд</button>
                  <button className="knyaz-btn primary" onClick={nextCase}>Следующее дело</button>
                </div>
              </div>
            )}

            {phase === "intro" && (
              <div className="intro">
                <div className="pill">Новый режим</div>
                <h2>Князь решает судьбу</h2>
                <p>
                  Тебе приводят подозреваемых. Можно сразу решить их участь или провести допрос из трёх раундов:
                  в каждом — четыре вопроса, но выбери только один. После диалога реши — казнить, помиловать или
                  придумать иное наказание.
                </p>
                <div className="actions-row">
                  <button className="knyaz-btn primary" onClick={startCase}>
                    Начать первое дело
                  </button>
                  <button className="knyaz-btn ghost" onClick={goBack}>
                    Вернуться к списку игр
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {toast && <div className="knyaz-toast">{toast}</div>}
      </div>
    </div>
  );
}
