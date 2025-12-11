import { useEffect, useMemo, useRef, useState } from "react";
import "./knyaz-court.css";

const INITIAL_STATS = { fear: 46, respect: 54, treasury: 48 };
const COUNCIL = [
  { name: "Бояре", value: 50 },
  { name: "Дружина", value: 50 },
  { name: "Духовенство", value: 50 },
];

const CASES = [
  {
    id: "salt-levy",
    name: "Гридя Сурожанин",
    status: "купец из Новгорода",
    title: "Обошёл пошлину на соляном обозе",
    description:
      "Стража говорит, что Гридя провёл обоз ночью и записал половину бочек как милостыню монастырю, чтобы не платить пошлину.",
    portrait: "merchant",
    rounds: [
      [
        { text: "Почему обоз шёл ночью?", answer: "Соль в жару «плачет». Ждал прохлады, чтоб товар не отсырел." },
        {
          text: "Кто поднял шлагбаум на заставе?",
          answer: "Старший Путята. Он знает меня по ярмаркам, не думал, что это грех.",
        },
        { text: "Где грамота из мытной избы?", answer: "Писарь уронил её в реку, чернила смыло. Самому стыдно." },
        {
          text: "Кому предназначались бочки «на милостыню»?",
          answer: "Варяжскому монастырю. Пошли гонца, подтвердят, что ждали соль.",
        },
      ],
      [
        {
          text: "Сколько бочек в обозе на самом деле?",
          answer: "Двадцать восемь. На переправе одну смыло, но в записях держу двадцать семь.",
        },
        { text: "Куда делся писарь?", answer: "Пошёл вперёд с копиями — занять место на торгу. Вернётся к вечеру." },
        {
          text: "Кто сопровождал обоз?",
          answer: "Только мои подмастерья. Дружинников не было — экономил на охране.",
        },
        {
          text: "Давал ли ты стражникам мёд?",
          answer: "Кружку поставил, чтобы не мёрзли. Взяткой не считал, клянусь честью купца.",
        },
      ],
      [
        { text: "Готов ли заплатить двойную пошлину сейчас?", answer: "Заплачу и в убыток уйду, лишь бы товар не пропал." },
        { text: "Кому продашь соль в городе?", answer: "Купцу Твердяге и в казну воеводе — у них договор со мной." },
        { text: "Почему другие купцы жалуются?", answer: "Завидуют, что соль моя чище и я успеваю раньше них." },
        { text: "Как возместишь обиду заставе?", answer: "Две бочки отдам на княжескую кухню и починю мостки." },
      ],
    ],
    verdicts: [
      {
        key: "execute",
        icon: "🪓",
        label: "Казнить",
        effects: { fear: 10, respect: -2, treasury: 3 },
        outcome: "Стража проводит показательное наказание. Купцы молчат, но шёпот про жестокость растёт.",
      },
      {
        key: "pardon",
        icon: "🕊️",
        label: "Помиловать",
        effects: { fear: -5, respect: 6, treasury: -3 },
        outcome: "Рядовые люди радуются мягкости, но казначей напоминает про недополученную пошлину.",
      },
      {
        key: "compensate",
        icon: "📜",
        label: "Двойная пошлина",
        effects: { fear: 2, respect: 4, treasury: 8 },
        outcome: "Гридя платит втрое. Казна довольна, купцы вздыхают, но признают решение справедливым.",
      },
    ],
  },
  {
    id: "tribute",
    name: "Всеслав Молодой",
    status: "младший дружинник",
    title: "Выбивал дань с избытком",
    description:
      "Деревни жалуются: Всеслав взял двойную дань и выбил ворота амбара. Один старик умер после допроса.",
    portrait: "guard",
    rounds: [
      [
        { text: "По чьему приказу шёл за данью?", answer: "По слову сотника Бранислава. Сам не смел бы." },
        { text: "Почему брал вдвое больше?", answer: "Слух был о запасах серебра. Хотел опередить разбойников." },
        { text: "Кто шёл с тобой?", answer: "Пятеро молодых дружинников. Горячие, спорить трудно." },
        { text: "Зачем выбили ворота амбара?", answer: "Ворота заклинило, а дождь шёл. Решили выбить — погорячились." },
      ],
      [
        { text: "Бил ли ты старика Корнилу?", answer: "Оттолкнул, он сам упал. Сердце у него слабое, я жалею." },
        { text: "Почему нет свидетелей?", answer: "Свидетели в полях. Могу привести, я не прячусь." },
        { text: "Куда дел лишнюю дань?", answer: "Половину отправил с гонцом. Остальное держу на нужды отряда." },
        { text: "Зачем забрал двух юношей?", answer: "Видел в них силу. Хотел научить службе, не рабству." },
      ],
      [
        { text: "Готов вернуть излишки?", answer: "Верну меру зерна и серебро, если велишь." },
        { text: "Признаёшь вину за смерть старика?", answer: "Сожалею. Не хотел смерти, но вина моя есть." },
        { text: "Пойдёшь на караул в глуши?", answer: "Стану на пограничной заставе хоть завтра." },
        { text: "Что скажут твои люди?", answer: "Скажут, что я строг, но не вор. Пусть их тоже спросите." },
      ],
    ],
    verdicts: [
      {
        key: "execute",
        icon: "⚔️",
        label: "Казнить",
        effects: { fear: 9, respect: 1, treasury: 0 },
        outcome: "Дружина шепчется, но принимает урок. Деревни благодарят, хотя страх в них растёт.",
      },
      {
        key: "pardon",
        icon: "🌿",
        label: "Помиловать",
        effects: { fear: -4, respect: -6, treasury: -1 },
        outcome: "Слух идёт, что дружинникам всё дозволено. Люди ропщут, уважение тает.",
      },
      {
        key: "exile",
        icon: "🛡️",
        label: "Пограничная служба",
        effects: { fear: 2, respect: 6, treasury: 0 },
        outcome: "Всеслав отправлен на дальний караул. Люди видят твёрдость без крови, дружина вздыхает с облегчением.",
      },
    ],
  },
  {
    id: "refuge",
    name: "Милослава Твердовна",
    status: "боярыня из Приозёрья",
    title: "Укрыла беглого смерда",
    description:
      "Говорят, Милослава спрятала беглого кузнеца, чтобы оставить его у себя. Господин требует холопа назад с платой.",
    portrait: "noble",
    rounds: [
      [
        { text: "Зачем приютила беглеца?", answer: "Коваль был ранен. Без помощи умер бы под воротами." },
        { text: "Знала, что он чей-то холоп?", answer: "Он не скрывал. Сказал, что бежит от побоев." },
        { text: "Предлагала ли выкуп?", answer: "Отправила гонца. Ответа нет, господин молчит." },
        { text: "Почему спрятала в лавке?", answer: "Боялась, что его убьют по дороге. Хотела дождаться суда." },
      ],
      [
        { text: "Кто видел, как его укрыли?", answer: "Дворовые девушки и священник. Они могут подтвердить." },
        { text: "Давала ли ему оружие?", answer: "Только молот, чтобы руки не забыли ремесло." },
        { text: "Сколько дней держала у себя?", answer: "Пять дней. Пока раны не затянулись и не смог встать." },
        { text: "Готова заплатить господину?", answer: "Дам серебро и мастера взамен, если прикажешь." },
      ],
      [
        { text: "Что скажут соседи-бояре?", answer: "Скажут, что вмешалась, но ремесло спасла. Не хотела войны." },
        { text: "Пойдёт ли он обратно?", answer: "Пойдёт, если велишь. Просит лишь не бить его." },
        { text: "Готова принять его на плату?", answer: "Не хочу красть. Готова договориться и платить за труд." },
        { text: "Считает ли тебя спасительницей?", answer: "Сказал, что обязан жизнью. Сам придёт, если велишь." },
      ],
    ],
    verdicts: [
      {
        key: "execute",
        icon: "⛓️",
        label: "Казнить",
        effects: { fear: 7, respect: -4, treasury: 1 },
        outcome: "Двор содрогается: князь рубит даже боярынь. Простые люди боятся, но шепчут о холоде сердца.",
      },
      {
        key: "pardon",
        icon: "🤝",
        label: "Помиловать",
        effects: { fear: -4, respect: 7, treasury: -2 },
        outcome: "Люди видят милость к раненому. Господин ворчит, но соглашается на серебро.",
      },
      {
        key: "compromise",
        icon: "📯",
        label: "Выкуп и служба",
        effects: { fear: 1, respect: 5, treasury: 4 },
        outcome: "Назначен выкуп и работа кузнеца на княжескую кузню. Все стороны получают часть желаемого.",
      },
    ],
  },
  {
    id: "smith",
    name: "Лютко Кузнец",
    status: "городской мастер",
    title: "Ковал оружие для разбойников",
    description:
      "Стража нашла клинки с меткой волка — знак разбойничьей шайки. Лютко говорит, что думал, будто работает на дружину.",
    portrait: "smith",
    rounds: [
      [
        { text: "Кто заказал клинки?", answer: "Незнакомец в сером. Назвался посланником воеводы." },
        { text: "Зачем метка волка на рукоятях?", answer: "Просили украсить. Думал, что это знак дружины." },
        { text: "Сколько серебра получил?", answer: "Три гривны вперёд. Остальное не успели отдать." },
        { text: "Почему прятал клинки в погребе?", answer: "Чтобы не отсырели и не украли ученики." },
      ],
      [
        { text: "Видел ли их раньше?", answer: "Один торговал кожей на ярмарке. Рыжий, со шрамом." },
        { text: "Сообщил ли в заставу?", answer: "Не успел. Работа срочная, стыжусь, что не сказал." },
        { text: "Готов описать их приметы?", answer: "Высокий, шрам на щеке. Второй рыжий, глаз прищурен." },
        { text: "Почему нет княжьего клейма?", answer: "Не просили. Думал, лишнее — торопили." },
      ],
      [
        { text: "Пойдёшь ли с дружиной по их следу?", answer: "Пойду, покажу, где встречались." },
        { text: "Согласен ковать только для казны?", answer: "Под присягой. Пусть смотрят, что делаю." },
        { text: "Готов вернуть серебро?", answer: "Верну и добавлю из своей кладовой, лишь не лишайте ремесла." },
        { text: "Скрываешь ли кого-то из них?", answer: "Нет. Хата моя чиста, обыщите хоть сейчас." },
      ],
    ],
    verdicts: [
      {
        key: "execute",
        icon: "🔥",
        label: "Казнить",
        effects: { fear: 12, respect: -3, treasury: 2 },
        outcome: "Город в страхе: мастеров казнят за ошибки. Разбойники прячутся, но ремесленники боятся слова.",
      },
      {
        key: "pardon",
        icon: "🌾",
        label: "Помиловать",
        effects: { fear: -6, respect: -4, treasury: -2 },
        outcome: "Люди говорят о слабости князя. Разбойники наглеют, казна недосчитывается железа.",
      },
      {
        key: "press",
        icon: "🏹",
        label: "В облаву и в кузню",
        effects: { fear: 4, respect: 6, treasury: 3 },
        outcome: "Лютко кует только для дружины и идёт в облаву. Город видит твёрдость, мастера — шанс исправиться.",
      },
    ],
  },
];

const clamp = (value) => Math.max(0, Math.min(100, value));

export default function KnyazCourt({ goBack, onProgress, setBackHandler }) {
  const [caseIndex, setCaseIndex] = useState(0);
  const [phase, setPhase] = useState("summary"); // summary | dialog | verdict | result
  const [roundIndex, setRoundIndex] = useState(0);
  const [answers, setAnswers] = useState([]);
  const [decision, setDecision] = useState(null);
  const [stats, setStats] = useState(INITIAL_STATS);
  const [pulse, setPulse] = useState(0);
  const [showCouncil, setShowCouncil] = useState(false);
  const [typedText, setTypedText] = useState("");
  const progressGiven = useRef(false);

  const asked = answers.filter(Boolean);
  const currentRound = activeCase?.rounds?.[roundIndex] || [];
  const currentAnswer = answers[roundIndex];
  const showQuestions = phase === "dialog";
  const showVerdicts = phase === "verdict" || phase === "result";
  const displayText = phase === "dialog" ? typedText : typedText || activeCase?.description;

  const finished = caseIndex >= CASES.length;
  const activeCase = useMemo(() => (finished ? null : CASES[caseIndex]), [finished, caseIndex]);

  useEffect(() => {
    if (!setBackHandler) return undefined;
    setBackHandler(() => {
      if (finished) {
        goBack?.();
        return;
      }
      if (phase === "dialog" || phase === "verdict" || phase === "result") {
        setPhase("summary");
        setRoundIndex(0);
        setAnswers([]);
        setDecision(null);
        return;
      }
      goBack?.();
    });
    return () => setBackHandler(null);
  }, [setBackHandler, phase, finished, goBack]);

  useEffect(() => {
    if (!progressGiven.current && decision) {
      progressGiven.current = true;
      onProgress?.();
    }
  }, [decision, onProgress]);

  useEffect(() => {
    if (caseIndex >= CASES.length) return;
    setPhase("summary");
    setRoundIndex(0);
    setAnswers([]);
    setDecision(null);
  }, [caseIndex]);

  const startDialog = () => {
    setPhase("dialog");
    setRoundIndex(0);
    setAnswers([]);
    setDecision(null);
  };

  const goToVerdict = () => {
    setPhase("verdict");
  };

  const selectQuestion = (question) => {
    if (!activeCase) return;
    setAnswers((prev) => {
      if (prev[roundIndex]) return prev;
      const next = [...prev];
      next[roundIndex] = { ...question, round: roundIndex };
      return next;
    });
  };

  const nextRound = () => {
    if (!activeCase) return;
    if (roundIndex >= activeCase.rounds.length - 1) {
      setPhase("verdict");
      return;
    }
    setRoundIndex((idx) => Math.min(idx + 1, activeCase.rounds.length - 1));
  };

  const chooseVerdict = (option) => {
    if (!activeCase || decision) return;
    const effects = option.effects || {};
    setDecision(option);
    setPhase("result");
    setPulse((v) => v + 1);
    setStats((prev) => ({
      fear: clamp(prev.fear + (effects.fear || 0)),
      respect: clamp(prev.respect + (effects.respect || 0)),
      treasury: clamp(prev.treasury + (effects.treasury || 0)),
    }));
  };

  const moveNextCase = () => {
    setCaseIndex((idx) => Math.min(idx + 1, CASES.length));
  };

  const restartDay = () => {
    setCaseIndex(0);
    setStats(INITIAL_STATS);
    setPhase("summary");
    setRoundIndex(0);
    setAnswers([]);
    setDecision(null);
  };

  useEffect(() => {
    let target = activeCase?.description || "";
    if (phase === "dialog" && currentAnswer?.answer) {
      target = currentAnswer.answer;
    }
    setTypedText("");
    if (!target) return;
    let i = 0;
    const id = setInterval(() => {
      i += 1;
      setTypedText(target.slice(0, i));
      if (i >= target.length) clearInterval(id);
    }, 18);
    return () => clearInterval(id);
  }, [phase, currentAnswer?.answer, activeCase?.description]);

  const councilControls = (
    <>
      <button
        className="kc-council-pill"
        type="button"
        onClick={() => setShowCouncil((v) => !v)}
        aria-expanded={showCouncil}
        aria-label="Влияние элит"
      >
        <span className="kc-icon" aria-hidden>👑</span>
      </button>
      <CouncilOverlay open={showCouncil} onClose={() => setShowCouncil(false)} data={COUNCIL} />
    </>
  );

  if (finished) {
    return (
      <div className="kc-root">
        <Background />
        <div className="kc-shell">
          {councilControls}
          <header className="kc-header">
            <div>
              <p className="kc-eyebrow">Княжий суд</p>
            </div>
            <div className="kc-meter-row kc-final">
              <StatMeter icon="🛡️" color="var(--accent-amber)" label="Страх" value={stats.fear} pulse={pulse} />
              <StatMeter icon="⚖️" color="var(--accent-green)" label="Уважение" value={stats.respect} pulse={pulse} />
              <StatMeter icon="💰" color="var(--accent-gold)" label="Казна" value={stats.treasury} pulse={pulse} />
            </div>
          </header>
          <section className="kc-card kc-final-panel">
            <ul className="kc-summary">
              <li>Люди помнят каждое слово и каждый жест твоего суда.</li>
              <li>Дружина сравнивает строгость с милостью и готовится к новым приказам.</li>
              <li>Казначей складывает записи — казна ждёт следующего дня.</li>
            </ul>
            <div className="kc-final-actions">
              <button className="kc-ghost" onClick={goBack}>Вернуться к играм</button>
              <button className="kc-cta" onClick={restartDay}>Начать заново</button>
            </div>
          </section>
        </div>
      </div>
    );
  }

  return (
    <div className="kc-root">
      <Background />
      <div className="kc-shell">
        {councilControls}
        <header className="kc-header">
          <div>
            <p className="kc-eyebrow">Княжий суд</p>
          </div>
          <div className="kc-meter-row">
            <StatMeter icon="🛡️" color="var(--accent-amber)" label="Страх" value={stats.fear} pulse={pulse} />
            <StatMeter icon="⚖️" color="var(--accent-green)" label="Уважение" value={stats.respect} pulse={pulse} />
            <StatMeter icon="💰" color="var(--accent-gold)" label="Казна" value={stats.treasury} pulse={pulse} />
          </div>
        </header>

        <div className="kc-grid">
          <section className="kc-card kc-suspect-panel">
            <div className="kc-suspect-head">
              <div className="kc-badge" aria-hidden>
                {activeCase?.portrait === "guard" && "🛡️"}
                {activeCase?.portrait === "merchant" && "📜"}
                {activeCase?.portrait === "noble" && "👑"}
                {activeCase?.portrait === "smith" && "⚒️"}
                {!activeCase?.portrait && "🧭"}
              </div>
              <div>
                <div className="kc-eyebrow">{activeCase?.status}</div>
                <div className="kc-suspect-name">{activeCase?.name}</div>
              </div>
            </div>
            <div className="kc-case-text">
              <h3>{activeCase?.title}</h3>
              <p>{displayText}</p>
            </div>
            {asked.length > 0 && (
              <div className="kc-mini-log" aria-live="polite">
                <div className="kc-mini-log-title">Что уже сказано</div>
                {asked.map((item, idx) => (
                  <div key={`${item.text}-${idx}`} className="kc-mini-log-line">
                    <span className="kc-pill">Раунд {item.round + 1}</span>
                    <span className="kc-q">{item.text}</span>
                    <span className="kc-a">{item.answer}</span>
                  </div>
                ))}
              </div>
            )}
            {!showQuestions && !showVerdicts && (
              <div className="kc-action-row">
                <button className="kc-cta" onClick={goToVerdict}>Принять решение</button>
                <button className="kc-ghost" onClick={startDialog}>Выслушать</button>
              </div>
            )}
            {showQuestions && (
              <>
                <div className="kc-questions">
                  {currentRound.map((q, idx) => {
                    const answered = !!currentAnswer;
                    const isChosen = currentAnswer?.text === q.text;
                    return (
                      <button
                        key={q.text}
                        className={`kc-question ${isChosen ? "kc-chosen" : ""}`}
                        disabled={answered && !isChosen}
                        onClick={() => selectQuestion(q)}
                      >
                        <span className="kc-pill">Вопрос {idx + 1}</span>
                        <span>{q.text}</span>
                      </button>
                    );
                  })}
                </div>
                {currentAnswer && (
                  <div className="kc-answer">
                    <div className="kc-eyebrow">Ответ</div>
                    <p>{currentAnswer.answer}</p>
                  </div>
                )}
                {currentAnswer && (
                  <div className="kc-next-row">
                    {roundIndex >= (activeCase?.rounds?.length || 0) - 1 ? (
                      <button className="kc-cta" onClick={goToVerdict}>Перейти к приговору</button>
                    ) : (
                      <button className="kc-cta" onClick={nextRound}>Следующий раунд</button>
                    )}
                  </div>
                )}
              </>
            )}
            {showVerdicts && (
              <div className="kc-verdict-block">
                <div className="kc-verdict-options">
                  {activeCase?.verdicts?.map((option) => {
                    const isPicked = decision?.key === option.key;
                    const preview =
                      option.outcome.length > 86 ? `${option.outcome.slice(0, 86)}…` : option.outcome;
                    return (
                      <button
                        key={option.key}
                        className={`kc-verdict ${isPicked ? "kc-chosen" : ""}`}
                        onClick={() => chooseVerdict(option)}
                        disabled={!!decision}
                      >
                        <span className="kc-icon">{option.icon}</span>
                        <div className="kc-verdict-meta">
                          <div className="kc-label">{option.label}</div>
                          <p>{preview}</p>
                        </div>
                        <div className="kc-effects">
                          <Effect label="Страх" value={option.effects?.fear} />
                          <Effect label="Уважение" value={option.effects?.respect} />
                          <Effect label="Казна" value={option.effects?.treasury} />
                        </div>
                      </button>
                    );
                  })}
                </div>
                {decision && (
                  <div className="kc-result">
                    <div className="kc-eyebrow">Последствия</div>
                    <p>{decision.outcome}</p>
                    <div className="kc-next-row">
                      <button className="kc-ghost" onClick={goBack}>Завершить игру</button>
                      <button className="kc-cta" onClick={moveNextCase}>
                        {caseIndex >= CASES.length - 1 ? "Итоги дня" : "Следующее дело"}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

function StatMeter({ icon, label, value, color, pulse }) {
  const safeValue = clamp(value || 0);
  return (
    <div className="kc-meter" data-pulse={pulse}>
      <div className="kc-meter-top">
        <span className="kc-icon">{icon}</span>
        <div className="kc-meter-body">
          <div className="kc-label">{label}</div>
          <div className="kc-bar">
            <span className="kc-fill" style={{ width: `${safeValue}%`, background: color }} />
          </div>
          <div className="kc-value">{safeValue}</div>
        </div>
      </div>
    </div>
  );
}

function CouncilOverlay({ open, onClose, data }) {
  return (
    <div className={`kc-council-overlay ${open ? "kc-open" : ""}`} aria-hidden={!open}>
      <div className="kc-council-panel" role="dialog" aria-label="Влияние элит">
        <div className="kc-council-header">
          <div className="kc-title">
            <span className="kc-icon" aria-hidden>👑</span>
            <span>Влияние элит</span>
          </div>
          <button className="kc-close" type="button" onClick={onClose} aria-label="Закрыть">
            ✕
          </button>
        </div>
        <div className="kc-council-body">
          {data.map((group) => (
            <div key={group.name} className="kc-council-row">
              <span className="kc-name">{group.name}:</span>
              <div className="kc-council-meter">
                <div className="kc-council-meter-fill" style={{ width: `${clamp(group.value)}%` }} />
              </div>
              <span className="kc-score">{clamp(group.value)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
function Effect({ label, value }) {
  if (value === undefined || value === null) return null;
  const tone = value > 0 ? "kc-up" : value < 0 ? "kc-down" : "kc-neutral";
  const sign = value > 0 ? "+" : "";
  return (
    <span className={`kc-effect ${tone}`}>
      {label} {sign}
      {value}
    </span>
  );
}

function Background() {
  return <div className="kc-bg" aria-hidden />;
}
