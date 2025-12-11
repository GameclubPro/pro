const fearEl = document.getElementById("fearValue");
const respectEl = document.getElementById("respectValue");
const treasuryEl = document.getElementById("treasuryValue");
const caseIndexEl = document.getElementById("caseIndex");
const caseStatusEl = document.getElementById("caseStatus");
const caseNameEl = document.getElementById("caseName");
const caseTitleEl = document.getElementById("caseTitle");
const caseSummaryEl = document.getElementById("caseSummary");
const dialogBlock = document.getElementById("dialogBlock");
const decisionBlock = document.getElementById("decisionBlock");
const resultBlock = document.getElementById("resultBlock");
const endBlock = document.getElementById("endBlock");
const answerBox = document.getElementById("answerBox");
const questionsWrap = document.getElementById("questions");
const roundLabel = document.getElementById("roundLabel");
const nextRoundBtn = document.getElementById("nextRoundBtn");
const decisionFromDialog = document.getElementById("decisionFromDialog");
const decisionBtn = document.getElementById("decisionBtn");
const dialogBtn = document.getElementById("dialogBtn");
const decisionList = document.getElementById("decisionList");
const resultTextEl = document.getElementById("resultText");
const nextCaseBtn = document.getElementById("nextCaseBtn");
const resetBtn = document.getElementById("resetBtn");

const state = { fear: 50, respect: 50, treasury: 0, currentCaseIndex: 0, currentRound: 0 };
let cases = [];
let hasMore = true;
let view = "overview"; // overview | dialogue | decision | result | end
let selectedQuestionId = null;

const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

async function fetchData() {
  const [casesResp, stateResp] = await Promise.all([
    fetch("/api/cases").then((r) => r.json()),
    fetch("/api/state").then((r) => r.json())
  ]);
  cases = casesResp.cases || [];
  Object.assign(state, stateResp.state || {});
  hasMore = stateResp.hasMore ?? true;
  render();
}

function renderStats() {
  fearEl.textContent = state.fear;
  respectEl.textContent = state.respect;
  treasuryEl.textContent = state.treasury;
}

function currentCase() {
  return cases[state.currentCaseIndex];
}

function renderCase() {
  const c = currentCase();
  if (!c) return;
  caseIndexEl.textContent = `Дело ${state.currentCaseIndex + 1} / ${cases.length}`;
  caseStatusEl.textContent = c.accused.status;
  caseNameEl.textContent = c.accused.name;
  caseTitleEl.textContent = c.title;
  caseSummaryEl.textContent = c.summary;
}

function setView(next) {
  view = next;
  dialogBlock.classList.toggle("hidden", view !== "dialogue");
  decisionBlock.classList.toggle("hidden", view !== "decision");
  resultBlock.classList.toggle("hidden", view !== "result");
  endBlock.classList.toggle("hidden", view !== "end");
  document.getElementById("mainActions").classList.toggle("hidden", view !== "overview");
}

function renderQuestions() {
  const c = currentCase();
  if (!c) return;
  const round = c.dialog.rounds[state.currentRound];
  roundLabel.textContent = `Раунд ${state.currentRound + 1} / 3`;
  questionsWrap.innerHTML = "";
  selectedQuestionId = null;
  answerBox.textContent = "";
  round.questions.forEach((q) => {
    const btn = document.createElement("button");
    btn.className = "question-btn";
    btn.textContent = q.text;
    btn.onclick = () => selectQuestion(q);
    questionsWrap.appendChild(btn);
  });
  nextRoundBtn.disabled = true;
}

function selectQuestion(q) {
  if (selectedQuestionId) return;
  selectedQuestionId = q.id;
  answerBox.textContent = q.answer;
  Array.from(questionsWrap.children).forEach((child) => {
    const disabled = child.textContent !== q.text;
    child.disabled = disabled;
    if (!disabled) child.classList.add("active");
  });
  nextRoundBtn.disabled = false;
}

function nextRound() {
  if (!selectedQuestionId) return;
  if (state.currentRound >= 2) {
    goDecision();
    return;
  }
  state.currentRound += 1;
  renderQuestions();
}

function goDialogue() {
  state.currentRound = 0;
  setView("dialogue");
  renderQuestions();
}

function goDecision() {
  setView("decision");
  renderDecisionButtons();
}

function renderDecisionButtons() {
  const c = currentCase();
  if (!c) return;
  decisionList.innerHTML = "";
  c.decisions.forEach((d) => {
    const card = document.createElement("button");
    card.className = "decision-card";
    card.innerHTML = `
      <div class="title">${d.text}</div>
      <div class="effects">Страх ${signed(d.effects.fear)}, Уважение ${signed(d.effects.respect)}, Казна ${signed(d.effects.treasury)}</div>
    `;
    card.onclick = () => chooseDecision(d);
    decisionList.appendChild(card);
  });
}

function signed(n) {
  if (n > 0) return `+${n}`;
  return `${n}`;
}

async function chooseDecision(decision) {
  applyEffects(decision.effects || {});
  resultTextEl.textContent = decision.resultText;
  setView("result");

  try {
    const resp = await fetch("/api/decision", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decisionId: decision.id })
    });
    if (resp.ok) {
      const data = await resp.json();
      Object.assign(state, data.state || {});
      hasMore = data.hasMore ?? hasMore;
      renderStats();
    }
  } catch {
    /* ignore network errors in demo */
  }
}

function applyEffects(eff) {
  state.fear = clamp(state.fear + (eff.fear || 0), 0, 100);
  state.respect = clamp(state.respect + (eff.respect || 0), 0, 100);
  state.treasury = state.treasury + (eff.treasury || 0);
  renderStats();
}

function nextCase() {
  state.currentCaseIndex += 1;
  state.currentRound = 0;
  selectedQuestionId = null;
  answerBox.textContent = "";
  if (state.currentCaseIndex >= cases.length) {
    setView("end");
    return;
  }
  setView("overview");
  renderCase();
}

async function resetGame() {
  try {
    const resp = await fetch("/api/reset", { method: "POST" });
    if (resp.ok) {
      const data = await resp.json();
      Object.assign(state, data.state || {});
      hasMore = data.hasMore ?? true;
    }
  } catch {
    Object.assign(state, { fear: 50, respect: 50, treasury: 0, currentCaseIndex: 0, currentRound: 0 });
  }
  setView("overview");
  renderCase();
  renderStats();
}

// ----- events -----
dialogBtn.addEventListener("click", goDialogue);
decisionBtn.addEventListener("click", goDecision);
decisionFromDialog.addEventListener("click", goDecision);
nextRoundBtn.addEventListener("click", nextRound);
nextCaseBtn.addEventListener("click", nextCase);
resetBtn.addEventListener("click", resetGame);

function render() {
  renderStats();
  renderCase();
  setView("overview");
}

fetchData().catch(() => {
  // fallback без API
  cases = [];
});
