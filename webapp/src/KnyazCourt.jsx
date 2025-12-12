import { useEffect, useMemo, useRef, useState } from "react";
import "./knyaz-court.css";
import VseslavPortrait from "./assets/knyaz/Vseslav_young.png";

const INITIAL_STATS = { fear: 46, respect: 54, treasury: 48 };
const COUNCIL = [
  { name: "Бояре", value: 50 },
  { name: "Дружина", value: 50 },
  { name: "Духовенство", value: 50 },
];

const QUESTION_TONES = {
  threat: { icon: "👊", label: "Угрожающий" },
  friendly: { icon: "😊", label: "Дружелюбный" },
  rational: { icon: "🧠", label: "Рациональный" },
  cunning: { icon: "🦊", label: "Хитрый" },
};

const CASES = [
  {
    id: "salt-levy",
    name: "Гридя Сурожанин",
    status: "купец из Новгорода",
    title: "Обошёл пошлину на соляном обозе",
    description:
      "Стража говорит, что Гридя провёл обоз ночью и записал половину бочек как милостыню монастырю, чтобы не платить пошлину.",
    plea: "Княже, вёз соль ночью, чтобы не сгнила. Записал часть на милостыню по глупости, а не ради воровства. Готов оплатить пошлину и починить заставу.",
    portrait: "merchant",
    rounds: [
      [
        {
          tone: "threat",
          text: "Ночью тащил обоз — не скрывал ли ты пошлину?",
          answer: "Соль в жару «плачет». Ждал прохлады, чтоб товар не отсырел.",
        },
        {
          tone: "friendly",
          text: "Кто поднял шлагбаум? Назови, я помогу разобраться.",
          answer: "Старший Путята. Он знает меня по ярмаркам, не думал, что это грех.",
        },
        {
          tone: "rational",
          text: "Где грамота из мытной избы? Покажи доказательство.",
          answer: "Писарь уронил её в реку, чернила смыло. Самому стыдно.",
        },
        {
          tone: "cunning",
          text: "Эти «милостынные» бочки — кому шли на самом деле?",
          answer: "Варяжскому монастырю. Пошли гонца, подтвердят, что ждали соль.",
        },
      ],
      [
        {
          tone: "threat",
          text: "Сколько бочек спрятал от учёта? Говори точно.",
          answer: "Двадцать восемь. На переправе одну смыло, но в записях держу двадцать семь.",
        },
        {
          tone: "friendly",
          text: "Куда делся писарь? Может помочь его слово.",
          answer: "Пошёл вперёд с копиями — занять место на торгу. Вернётся к вечеру.",
        },
        {
          tone: "rational",
          text: "Кто сопровождал обоз? Перечисли по именам.",
          answer: "Только мои подмастерья. Дружинников не было — экономил на охране.",
        },
        {
          tone: "cunning",
          text: "Мёдом поил стражу, чтобы они молчали?",
          answer: "Кружку поставил, чтобы не мёрзли. Взяткой не считал, клянусь честью купца.",
        },
      ],
      [
        {
          tone: "threat",
          text: "Двойную пошлину готов внести сейчас, без разговоров?",
          answer: "Заплачу и в убыток уйду, лишь бы товар не пропал.",
        },
        {
          tone: "friendly",
          text: "Кому в городе продашь соль? Может, кто поручится.",
          answer: "Купцу Твердяге и в казну воеводе — у них договор со мной.",
        },
        {
          tone: "rational",
          text: "Почему другие жалуются? Есть ли разумное объяснение?",
          answer: "Завидуют, что соль моя чище и я успеваю раньше них.",
        },
        {
          tone: "cunning",
          text: "Как загладишь обиду заставе? Предложи ход.",
          answer: "Две бочки отдам на княжескую кухню и починю мостки.",
        },
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
    plea: "Шёл за данью по слову сотника, не ради грабежа. Признаю горячность своих людей. Готов вернуть лишнее и стать на караул, если прикажешь.",
    portrait: "guard",
    rounds: [
      [
        {
          tone: "threat",
          text: "По чьему приказу шёл — не прячешься за чужое имя?",
          answer: "По слову сотника Бранислава. Сам не смел бы.",
        },
        {
          tone: "friendly",
          text: "Почему брал вдвое? Скажи честно, я выслушаю.",
          answer: "Слух был о запасах серебра. Хотел опередить разбойников.",
        },
        { tone: "rational", text: "Кто шёл с тобой? Перечисли людей.", answer: "Пятеро молодых дружинников. Горячие, спорить трудно." },
        {
          tone: "cunning",
          text: "Зачем выбили ворота? Не прикрываешь ли вину?",
          answer: "Ворота заклинило, а дождь шёл. Решили выбить — погорячились.",
        },
      ],
      [
        {
          tone: "threat",
          text: "Бил ли старика Корнилу? Отвечай без уловок.",
          answer: "Оттолкнул, он сам упал. Сердце у него слабое, я жалею.",
        },
        {
          tone: "friendly",
          text: "Почему нет свидетелей? Может, их стоит позвать.",
          answer: "Свидетели в полях. Могу привести, я не прячусь.",
        },
        {
          tone: "rational",
          text: "Куда дел лишнюю дань? Назови суммы.",
          answer: "Половину отправил с гонцом. Остальное держу на нужды отряда.",
        },
        {
          tone: "cunning",
          text: "Зачем забрал двух юношей? Не строишь ли свою дружину?",
          answer: "Видел в них силу. Хотел научить службе, не рабству.",
        },
      ],
      [
        {
          tone: "threat",
          text: "Признаёшь вину за смерть старика? Не уходи от ответа.",
          answer: "Сожалею. Не хотел смерти, но вина моя есть.",
        },
        { tone: "friendly", text: "Готов вернуть излишки? Это сгладит вину.", answer: "Верну меру зерна и серебро, если велишь." },
        { tone: "rational", text: "Пойдёшь на караул в глуши? Это конкретная служба.", answer: "Стану на пограничной заставе хоть завтра." },
        {
          tone: "cunning",
          text: "Что скажут твои люди? Не обернут ли рассказ против тебя?",
          answer: "Скажут, что я строг, но не вор. Пусть их тоже спросите.",
        },
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
    plea: "Приняла раненого холопа, чтобы не умер у ворот. Не прятала его от суда и посылала гонца хозяину. Готова заплатить выкуп и решить дело по закону.",
    portrait: "noble",
    rounds: [
      [
        {
          tone: "threat",
          text: "Знала, что он беглый — зачем укрыла чужого холопа?",
          answer: "Он не скрывал. Сказал, что бежит от побоев.",
        },
        {
          tone: "friendly",
          text: "Он был ранен? Расскажи, как спасала.",
          answer: "Коваль был ранен. Без помощи умер бы под воротами.",
        },
        {
          tone: "rational",
          text: "Предлагала ли выкуп? Есть письма?",
          answer: "Отправила гонца. Ответа нет, господин молчит.",
        },
        {
          tone: "cunning",
          text: "Почему спрятала в лавке? Не скрывала ли иное?",
          answer: "Боялась, что его убьют по дороге. Хотела дождаться суда.",
        },
      ],
      [
        {
          tone: "threat",
          text: "Кто видел, как его укрыли? Не скрывай свидетелей.",
          answer: "Дворовые девушки и священник. Они могут подтвердить.",
        },
        { tone: "friendly", text: "Давала ли ему оружие или только помогала?", answer: "Только молот, чтобы руки не забыли ремесло." },
        { tone: "rational", text: "Сколько дней держала у себя? Назови срок.", answer: "Пять дней. Пока раны не затянулись и не смог встать." },
        { tone: "cunning", text: "Готова заплатить господину? Что предложишь?", answer: "Дам серебро и мастера взамен, если прикажешь." },
      ],
      [
        { tone: "threat", text: "Пойдёт ли он обратно, если велю? Не ослушается?", answer: "Пойдёт, если велишь. Просит лишь не бить его." },
        { tone: "friendly", text: "Готова принять его на плату честно?", answer: "Не хочу красть. Готова договориться и платить за труд." },
        { tone: "rational", text: "Что скажут соседи-бояре? Их слово важно.", answer: "Скажут, что вмешалась, но ремесло спасла. Не хотела войны." },
        { tone: "cunning", text: "Считает ли тебя спасительницей? Используешь ли это?", answer: "Сказал, что обязан жизнью. Сам придёт, если велишь." },
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
    plea: "Ковал по слову посланника воеводы, думал служу дружине. Когда понял про шайку — стыжусь. Готов вернуть серебро, выдать приметы заказчиков и идти в облаву.",
    portrait: "smith",
    rounds: [
      [
        {
          tone: "threat",
          text: "Кто заказал клинки? Не прячь имена.",
          answer: "Незнакомец в сером. Назвался посланником воеводы.",
        },
        {
          tone: "friendly",
          text: "Зачем метка волка? Может, ошибся из доверия?",
          answer: "Просили украсить. Думал, что это знак дружины.",
        },
        { tone: "rational", text: "Сколько серебра получил? Назови точно.", answer: "Три гривны вперёд. Остальное не успели отдать." },
        {
          tone: "cunning",
          text: "Почему прятал клинки в погребе? Ловко скрывал?",
          answer: "Чтобы не отсырели и не украли ученики.",
        },
      ],
      [
        {
          tone: "threat",
          text: "Видел ли их раньше? Не играешь ли в незнание?",
          answer: "Один торговал кожей на ярмарке. Рыжий, со шрамом.",
        },
        {
          tone: "friendly",
          text: "Кто был тот рыжий со шрамом? Вспомни, это поможет.",
          answer: "Торговал кожей на ярмарке, рыжий со шрамом на щеке.",
        },
        {
          tone: "rational",
          text: "Кто привёл гонца? Есть описания?",
          answer: "Серый сказал, что гонец сам найдёт меня через неделю. Пришёл высокий, в сером.",
        },
        {
          tone: "cunning",
          text: "Учеников держал вдалеке? Чтобы не проболтались?",
          answer: "Чтобы не болтали заказчикам о мастерских секретах.",
        },
      ],
      [
        {
          tone: "threat",
          text: "Откуда взялся знак волка? Не шёл ли на сделку с шайкой?",
          answer: "Просили поставить. Не думал, что это шайка, а не дружина.",
        },
        {
          tone: "friendly",
          text: "Готов клясться, что думал о дружине? Скажи искренне.",
          answer: "Клянусь ремеслом. Работал по слову, как привык.",
        },
        {
          tone: "rational",
          text: "Где должен был отдать остаток серебра? Назови место.",
          answer: "Тот же рыжий со шрамом, что приносил шкуру и серебро.",
        },
        {
          tone: "cunning",
          text: "Если был обман, кто его устроил? Как обошёл ты подозрения?",
          answer: "Не знаю. Может, враги воеводы. Я сделал клинки честно.",
        },
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

const formatQuestionText = (question) => {
  if (!question) return "";
  const tone = QUESTION_TONES[question.tone];
  const icon = tone?.icon || "";
  return icon ? `${icon} ${question.text}` : question.text;
};

export default function KnyazCourt({ goBack, onProgress, setBackHandler }) {
  const [caseIndex, setCaseIndex] = useState(0);
  const [phase, setPhase] = useState("summary"); // summary | dialog | verdict | result
  const [roundIndex, setRoundIndex] = useState(0);
  const [answers, setAnswers] = useState([]);
  const [showMiniLog, setShowMiniLog] = useState(false);
  const [decision, setDecision] = useState(null);
  const [stats, setStats] = useState(INITIAL_STATS);
  const [pulse, setPulse] = useState(0);
  const [showCouncil, setShowCouncil] = useState(false);
  const [typedText, setTypedText] = useState("");
  const [dialogLine, setDialogLine] = useState("");
  const [pleaPlayed, setPleaPlayed] = useState(false);
  const [meterPops, setMeterPops] = useState([]);
  const progressGiven = useRef(false);
  const autoAdvanceRef = useRef(null);
  const decisionAdvanceRef = useRef(null);
  const lastPrintedRef = useRef("");

  const finished = caseIndex >= CASES.length;
  const activeCase = useMemo(() => (finished ? null : CASES[caseIndex]), [finished, caseIndex]);
  const asked = answers.filter(Boolean);
  const currentRound = activeCase?.rounds?.[roundIndex] || [];
  const currentAnswer = answers[roundIndex];
  const showQuestions = phase === "dialog";
  const showVerdicts = phase === "verdict" || phase === "result";
  const targetText = useMemo(() => {
    if (phase === "dialog") {
      return currentAnswer?.answer || dialogLine || activeCase?.description || "";
    }
    if (phase === "verdict" || phase === "result") {
      return currentAnswer?.answer || dialogLine || activeCase?.description || "";
    }
    return activeCase?.description || "";
  }, [phase, currentAnswer?.answer, dialogLine, activeCase?.description]);
  const displayText = typedText || "";
  const showCaseTitle = phase !== "dialog";
  const badgeIcon = useMemo(() => {
    if (!activeCase) return "🧭";
    if (activeCase.portrait === "guard") return "🛡️";
    if (activeCase.portrait === "merchant") return "📜";
    if (activeCase.portrait === "noble") return "👑";
    if (activeCase.portrait === "smith") return "⚒️";
    return "🧭";
  }, [activeCase]);
  const headerLabel = activeCase?.status || "Княжий суд";
  const suspectName = useMemo(() => {
    const parts = (activeCase?.name || "").split(" ").filter(Boolean);
    if (parts.length === 2) {
      return (
        <>
          {parts[0]}
          <br />
          {parts[1]}
        </>
      );
    }
    return activeCase?.name || "—";
  }, [activeCase?.name]);

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
        setDialogLine("");
        setTypedText("");
        setPleaPlayed(false);
        lastPrintedRef.current = "";
        clearTimeout(autoAdvanceRef.current);
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
    if (asked.length === 0 && showMiniLog) {
      setShowMiniLog(false);
    }
  }, [asked.length, showMiniLog]);

  useEffect(() => {
    if (caseIndex >= CASES.length) return;
    setPhase("summary");
    setRoundIndex(0);
    setAnswers([]);
    setDecision(null);
    clearTimeout(autoAdvanceRef.current);
    setDialogLine("");
    setTypedText("");
    setPleaPlayed(false);
    setMeterPops([]);
    lastPrintedRef.current = "";
  }, [caseIndex]);

  useEffect(() => () => {
    clearTimeout(autoAdvanceRef.current);
    clearTimeout(decisionAdvanceRef.current);
  }, []);

  const startDialog = () => {
    clearTimeout(autoAdvanceRef.current);
    setPhase("dialog");
    setRoundIndex(0);
    setAnswers([]);
    setDecision(null);
    const nextLine = (!pleaPlayed && activeCase?.plea) ? activeCase.plea : dialogLine || activeCase?.plea || "";
    if (nextLine) {
      setDialogLine(nextLine);
      if (!pleaPlayed) setPleaPlayed(true);
      if (nextLine === lastPrintedRef.current) {
        setTypedText(nextLine);
      } else {
        setTypedText("");
      }
    } else {
      setDialogLine("");
      setTypedText("");
    }
  };

  const goToVerdict = () => {
    clearTimeout(autoAdvanceRef.current);
    setPhase("verdict");
  };

  const selectQuestion = (question) => {
    if (!activeCase) return;
    clearTimeout(autoAdvanceRef.current);
    clearTimeout(decisionAdvanceRef.current);
    const nextLine = question.answer || "";
    if (nextLine === dialogLine || nextLine === typedText) {
      setDialogLine(nextLine);
      setTypedText(nextLine);
    } else {
      setDialogLine(nextLine);
      setTypedText("");
      lastPrintedRef.current = "";
    }
    setAnswers((prev) => {
      if (prev[roundIndex]) return prev;
      const next = [...prev];
      next[roundIndex] = { ...question, round: roundIndex };
      return next;
    });
    setPleaPlayed(true);
    const isLastRound = roundIndex >= (activeCase.rounds?.length || 0) - 1;
    if (isLastRound) {
      setPhase("verdict");
      return;
    }
    const answerLength = (question.answer || "").length;
    const delay = Math.min(Math.max(answerLength * 18 + 600, 1100), 3200);
    autoAdvanceRef.current = setTimeout(() => {
      setRoundIndex((idx) => Math.min(idx + 1, (activeCase.rounds?.length || 1) - 1));
    }, delay);
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
    clearTimeout(autoAdvanceRef.current);
    clearTimeout(decisionAdvanceRef.current);
    const effects = option.effects || {};
    setDecision(option);
    setPhase("result");
    setPulse((v) => v + 1);
    const applied = {
      fear: clamp((stats.fear || 0) + (effects.fear || 0)),
      respect: clamp((stats.respect || 0) + (effects.respect || 0)),
      treasury: clamp((stats.treasury || 0) + (effects.treasury || 0)),
    };
    setStats(applied);
    const pops = [
      effects.fear ? { key: "fear", value: effects.fear } : null,
      effects.respect ? { key: "respect", value: effects.respect } : null,
      effects.treasury ? { key: "treasury", value: effects.treasury } : null,
    ].filter(Boolean);
    setMeterPops(pops);
    decisionAdvanceRef.current = setTimeout(() => {
      setMeterPops([]);
      if (caseIndex < CASES.length - 1) {
        moveNextCase();
      }
    }, 1600);
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
    clearTimeout(autoAdvanceRef.current);
    setDialogLine("");
    setTypedText("");
    setPleaPlayed(false);
    lastPrintedRef.current = "";
  };

  useEffect(() => {
    const target = targetText;
    if (!target) {
      setTypedText("");
      lastPrintedRef.current = "";
      return undefined;
    }
    if (target === lastPrintedRef.current) {
      setTypedText(target);
      return undefined;
    }
    lastPrintedRef.current = target;
    setTypedText("");
    let i = 0;
    const id = setInterval(() => {
      i += 1;
      setTypedText(target.slice(0, i));
      if (i >= target.length) clearInterval(id);
    }, 18);
    return () => clearInterval(id);
  }, [targetText]);

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
            <div className="kc-header-mark">
              <div className="kc-badge" aria-hidden>
                {badgeIcon}
              </div>
              <p className="kc-eyebrow kc-eyebrow-on-dark">{headerLabel}</p>
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
          <div className="kc-header-mark">
            <div className="kc-badge" aria-hidden>
              {badgeIcon}
            </div>
            <p className="kc-eyebrow kc-eyebrow-on-dark">{headerLabel}</p>
          </div>
          <div className="kc-meter-row">
            <StatMeter
              icon="🛡️"
              color="var(--accent-amber)"
              label="Страх"
              value={stats.fear}
              pulse={pulse}
              pop={meterPops.find((p) => p.key === "fear")}
            />
            <StatMeter
              icon="⚖️"
              color="var(--accent-green)"
              label="Уважение"
              value={stats.respect}
              pulse={pulse}
              pop={meterPops.find((p) => p.key === "respect")}
            />
            <StatMeter
              icon="💰"
              color="var(--accent-gold)"
              label="Казна"
              value={stats.treasury}
              pulse={pulse}
              pop={meterPops.find((p) => p.key === "treasury")}
            />
          </div>
        </header>

        <div className="kc-grid">
          <div className="kc-case-stack">
            <div className="kc-suspect-head kc-suspect-topline">
              <div className="kc-suspect-name-block">
                <div className="kc-suspect-name">{suspectName}</div>
              </div>
              {activeCase?.portrait === "guard" && (
                <div className="kc-portrait-wrap kc-portrait-inline">
                  <img
                    src={VseslavPortrait}
                    alt={activeCase?.name || "Портрет подозреваемого"}
                    className="kc-portrait"
                  />
                </div>
              )}
              {asked.length > 0 && (
                <button
                  type="button"
                  className="kc-mini-log-pill"
                  onClick={() => setShowMiniLog((v) => !v)}
                  aria-pressed={showMiniLog}
                  aria-label="Что уже сказано"
                >
                  <span aria-hidden>💬</span>
                  <span className="kc-mini-log-count">{asked.length}</span>
                </button>
              )}
            </div>
            {showMiniLog && asked.length > 0 && (
              <div className="kc-mini-log kc-mini-log-flyout" aria-live="polite">
                <div className="kc-mini-log-title">Что уже сказано</div>
                {asked.map((item, idx) => (
                  <div key={`${item.text}-${idx}`} className="kc-mini-log-line">
                    <span className="kc-q">{formatQuestionText(item)}</span>
                    <span className="kc-a">{item.answer}</span>
                  </div>
                ))}
              </div>
            )}
            <section className="kc-card kc-suspect-panel">
              <div className="kc-case-text">
                {showCaseTitle && <h3>{activeCase?.title}</h3>}
                <p>{displayText}</p>
              </div>
              {!showQuestions && !showVerdicts && (
                <div className="kc-action-row">
                  <button className="kc-cta" onClick={goToVerdict}>Принять решение</button>
                  <button className="kc-ghost" onClick={startDialog}>Выслушать</button>
                </div>
              )}
            </section>
            {showQuestions && (
              <section className="kc-card kc-questions-panel">
                <div className="kc-questions-title">Вопросы</div>
                <div className="kc-questions">
                  {currentRound.map((q) => {
                    const answered = !!currentAnswer;
                    const isChosen = currentAnswer?.text === q.text;
                    return (
                      <button
                        key={q.text}
                        className={`kc-question ${isChosen ? "kc-chosen" : ""}`}
                        disabled={answered && !isChosen}
                        onClick={() => selectQuestion(q)}
                      >
                        <span>{formatQuestionText(q)}</span>
                      </button>
                    );
                  })}
                </div>
              </section>
            )}
            {showVerdicts && (
              <section className="kc-card kc-verdict-panel">
                <div className="kc-questions-title">Приговор</div>
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
                          <div className="kc-verdict-preview">{preview}</div>
                        </div>
                      </button>
                    );
                  })}
                </div>
                {decision && (
                  <div className="kc-result">
                    <div className="kc-eyebrow">Последствия</div>
                    <p>{decision.outcome}</p>
                    {caseIndex >= CASES.length - 1 && (
                      <div className="kc-next-row">
                        <button className="kc-ghost" onClick={goBack}>Завершить игру</button>
                        <button className="kc-cta" onClick={moveNextCase}>
                          Итоги дня
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </section>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function StatMeter({ icon, label, value, color, pulse, pop }) {
  const safeValue = clamp(value || 0);
  return (
    <div className="kc-meter" data-pulse={pulse}>
      <div className="kc-meter-top">
        <span className="kc-icon">{icon}</span>
        <div className="kc-meter-body">
          <div className="kc-label">{label}</div>
          <div className="kc-bar">
            <span className="kc-fill" style={{ width: `${safeValue}%`, background: color }} />
            {pop ? (
              <span
                className={`kc-meter-pop ${pop.value > 0 ? "kc-pop-up" : "kc-pop-down"}`}
                style={{ left: `${Math.min(Math.max(safeValue, 6), 96)}%` }}
                aria-hidden
              >
                {pop.value > 0 ? `+${pop.value}` : pop.value}
              </span>
            ) : null}
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
