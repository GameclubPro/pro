// Простая демо-версия «Княжий суд» — Express + статика
const path = require("path");
const express = require("express");
const compression = require("compression");

const app = express();
const PORT = process.env.PORT || 4000;

app.use(compression());
app.use(express.json());

// ----- Модель данных -----
const cases = [
  {
    id: 1,
    accused: { name: "Мирослав", status: "крестьянин" },
    title: "Кража хлеба из княжеского амбара",
    summary:
      "Стража поймала Мирослава у амбара ночью. В мешках недосчитались зерна, купец обвиняет его в краже.",
    dialog: {
      rounds: [
        {
          questions: [
            { id: "r1_q1", text: "Почему ты оказался у амбара ночью?", answer: "Корова потерялась, искал её. Увидел сторожа — он и поднял крик." },
            { id: "r1_q2", text: "Были ли у тебя сообщники?", answer: "Один я. Жена да дети дома, им и хлеб нужен." },
            { id: "r1_q3", text: "Ты признаёшь свою вину?", answer: "Не крал. Но знаю, что мешок пропал — сам видел недостачу." },
            { id: "r1_q4", text: "Что скажут соседи о тебе?", answer: "Работящий скажут. Но и завистники найдутся — язык у всех разный." }
          ]
        },
        {
          questions: [
            { id: "r2_q1", text: "Где ты был за час до пропажи?", answer: "На току зерно проверял, староста видел." },
            { id: "r2_q2", text: "Кто имеет ключ от амбара?", answer: "Сторож и купец Иван. У них всегда при себе." },
            { id: "r2_q3", text: "Почему сторож уверен, что это был ты?", answer: "Сказал, что видел мою рубаху. Но половина деревни в таких." },
            { id: "r2_q4", text: "Куда бы ты дел украденное?", answer: "Домой не понёс бы — меня бы первым проверили." }
          ]
        },
        {
          questions: [
            { id: "r3_q1", text: "Кто желает зла купцу?", answer: "Должников у него много. Каждый мог подставить." },
            { id: "r3_q2", text: "Если я тебя отпущу — что будет?", answer: "Домой пойду, работать стану усерднее. Благодарить буду." },
            { id: "r3_q3", text: "А если казню — что скажет деревня?", answer: "Скажут, что князь строг. Но шёпот пойдёт: не виновного казнили." },
            { id: "r3_q4", text: "Почему мне стоит тебе верить?", answer: "Клянусь перед богом — замка не трогал. Душа чиста." }
          ]
        }
      ]
    },
    decisions: [
      { id: "execute", text: "Казнить Мирослава", effects: { fear: +10, respect: -5, treasury: 0 }, resultText: "Толпа в страхе, но шепчет о жестокости князя." },
      { id: "pardon", text: "Помиловать и отпустить", effects: { fear: -5, respect: +10, treasury: 0 }, resultText: "Народ видит милость, стража ворчит." },
      { id: "work", text: "Отработать ущерб зерном", effects: { fear: +3, respect: +5, treasury: +5 }, resultText: "Община считает решение справедливым." }
    ]
  },
  {
    id: 2,
    accused: { name: "Ратибор", status: "гонец дружины" },
    title: "Утечка маршрута обозa",
    summary:
      "Печенеги устроили засаду на тайной тропе. Говорят, Ратибор слил маршрут. У ворот нашли чужую бирку.",
    dialog: {
      rounds: [
        {
          questions: [
            { id: "r1_q1", text: "Где был в ночь перед засадой?", answer: "Чинил мосток через ручей, задержался с людьми." },
            { id: "r1_q2", text: "Почему у тебя чужая бирка?", answer: "Поднял на дороге, хотел отдать дьяку, да забыл." },
            { id: "r1_q3", text: "Кто видел тебя на рассвете?", answer: "Сторож Влас и корчмарь Гремик — за овсом заходил." },
            { id: "r1_q4", text: "Зачем переобул коня ночью?", answer: "Копыта разбил в броде, иначе не добежал бы." }
          ]
        },
        {
          questions: [
            { id: "r2_q1", text: "Кому писал донесения?", answer: "Купцам из Смоленска о бурях. Никаких тайн." },
            { id: "r2_q2", text: "Готов ли к очной ставке с дружиной?", answer: "Да, пусть спрашивают — хочу знать, кто шепчет." },
            { id: "r2_q3", text: "Кто поручится за тебя?", answer: "Ветеран Секунт, служил при отце твоём." },
            { id: "r2_q4", text: "Сколько серебра получил?", answer: "Нисколько. Серебра у меня нет, обыщи хоть сейчас." }
          ]
        },
        {
          questions: [
            { id: "r3_q1", text: "Пойдёшь завтра в передовой сотне?", answer: "Да хоть сейчас, лишь дай коня." },
            { id: "r3_q2", text: "Что скажешь роду, если казню?", answer: "Примут волю, но дорога лишится гонца." },
            { id: "r3_q3", text: "Согласен на клеймо и изгнание?", answer: "Лишь оставь руку — буду метить копья." },
            { id: "r3_q4", text: "Кого подозреваешь сам?", answer: "У купцов глаза бегали. Могли они шепнуть врагу." }
          ]
        }
      ]
    },
    decisions: [
      { id: "execute", text: "Казнить за предательство", effects: { fear: +12, respect: -8, treasury: 0 }, resultText: "Страх растёт, но дружина сомневается в справедливости." },
      { id: "pardon", text: "Оправдать и вернуть в строй", effects: { fear: -4, respect: +8, treasury: 0 }, resultText: "Гонец возвращается, народ видит веру в своих." },
      { id: "work", text: "Сослать на пограничную заставу", effects: { fear: +2, respect: +4, treasury: 0 }, resultText: "Ратибор остаётся жив, но теряет честь и свободу." }
    ]
  },
  {
    id: 3,
    accused: { name: "Малуша", status: "травница" },
    title: "Смерть от отвара",
    summary:
      "Рыбак обвиняет Малушу: её отвар убил его сына. Травы собраны на болоте, от зелья пахло гнилью.",
    dialog: {
      rounds: [
        {
          questions: [
            { id: "r1_q1", text: "Где брала травы?", answer: "На болоте после грозы — там корень сочный." },
            { id: "r1_q2", text: "Кто видел сбор?", answer: "Внучка Акулина да пастух Прохор." },
            { id: "r1_q3", text: "Почему отдала зелье бесплатно?", answer: "Мальцу худо было. Серебро брать постыдилась." },
            { id: "r1_q4", text: "Почему скрыла рецепт?", answer: "Бабка велела — чтобы не попало злым." }
          ]
        },
        {
          questions: [
            { id: "r2_q1", text: "Были ли ещё пострадавшие?", answer: "Нет. Дружинников лечила — стоят на ногах." },
            { id: "r2_q2", text: "Почему не позвала монастырского лекаря?", answer: "Он берёт серебром, а время шло." },
            { id: "r2_q3", text: "Сваришь то же при свидетелях?", answer: "Пусть смотрят хоть весь день — сварю при тебе." },
            { id: "r2_q4", text: "Смешивала травы ночью?", answer: "Да, росу ловила — отвар крепче, хоть и темнее." }
          ]
        },
        {
          questions: [
            { id: "r3_q1", text: "Отдашь записи рецептов?", answer: "Протягивает дощечку с метками, дрожит." },
            { id: "r3_q2", text: "Кого винить в смерти мальца?", answer: "Говорит: вина её, просит суд Божий." },
            { id: "r3_q3", text: "Готова к испытанию водой?", answer: "Если утону — воля твоя. Если всплыву — лечить продолжу." },
            { id: "r3_q4", text: "Откажешься от ремесла?", answer: "Без меня село без лекаря. Бросить не могу." }
          ]
        }
      ]
    },
    decisions: [
      { id: "execute", text: "Сжечь как ведьму", effects: { fear: +15, respect: -10, treasury: 0 }, resultText: "Страх растёт, но люди шепчут о жестокости." },
      { id: "pardon", text: "Оправдать под клятву", effects: { fear: -3, respect: +9, treasury: 0 }, resultText: "Деревня видит милость и оставляет лекаря." },
      { id: "work", text: "Сослать в монастырь", effects: { fear: +4, respect: +4, treasury: 0 }, resultText: "Малуша жива, но в ссылке. Народ считает решение умеренным." }
    ]
  }
];

const baseState = { fear: 50, respect: 50, treasury: 0, currentCaseIndex: 0, currentRound: 0 };
let state = { ...baseState };

const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
const nextCaseAvailable = () => state.currentCaseIndex < cases.length;

// ----- API -----
app.get("/api/cases", (_req, res) => {
  res.json({ cases });
});

app.get("/api/state", (_req, res) => {
  res.json({ state, hasMore: nextCaseAvailable(), currentCase: cases[state.currentCaseIndex] || null });
});

app.post("/api/decision", (req, res) => {
  const curCase = cases[state.currentCaseIndex];
  if (!curCase) return res.status(400).json({ error: "no_case" });
  const decisionId = String(req.body?.decisionId || "").trim();
  const decision = curCase.decisions.find((d) => d.id === decisionId);
  if (!decision) return res.status(400).json({ error: "bad_decision" });

  state.fear = clamp(state.fear + (decision.effects?.fear || 0), 0, 100);
  state.respect = clamp(state.respect + (decision.effects?.respect || 0), 0, 100);
  state.treasury = state.treasury + (decision.effects?.treasury || 0);
  state.currentCaseIndex += 1;
  state.currentRound = 0;

  res.json({
    state,
    resultText: decision.resultText,
    hasMore: nextCaseAvailable(),
    nextCase: cases[state.currentCaseIndex] || null
  });
});

app.post("/api/reset", (_req, res) => {
  state = { ...baseState };
  res.json({ state, hasMore: true, currentCase: cases[0] });
});

// ----- Статика -----
const staticDir = path.join(__dirname, "knyaz-public");
app.use(express.static(staticDir));

// Фолбэк на index.html
app.use((_req, res) => {
  res.sendFile(path.join(staticDir, "index.html"));
});

app.listen(PORT, () => {
  console.log(`Knyaz demo server on http://localhost:${PORT}`);
});
