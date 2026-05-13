const STORAGE_KEY = "tcm-review-pwa-state-v1";
const DEFAULT_VOCAB_STEPS = [
  { amount: 5, unit: "minute" },
  { amount: 30, unit: "minute" },
  { amount: 12, unit: "hour" },
  { amount: 1, unit: "day" },
  { amount: 2, unit: "day" },
  { amount: 4, unit: "day" },
  { amount: 7, unit: "day" },
  { amount: 15, unit: "day" },
  { amount: 1, unit: "month" },
  { amount: 3, unit: "month" },
  { amount: 6, unit: "month" },
];
const UNIT_LABELS = {
  minute: "分鐘",
  hour: "小時",
  day: "天",
  month: "個月",
};

const defaults = {
  settings: {
    profiles: {
      general: {
        label: "一般科目",
        firstGap: 2,
        redGap: 1,
        amberGap: 3,
        greenGap: 7,
      },
      vocab: {
        label: "英文單字",
        steps: DEFAULT_VOCAB_STEPS,
      },
    },
  },
  lessons: [],
};

const resultText = {
  red: "紅燈",
  amber: "橘燈",
  green: "綠燈",
};

let state = loadState();
let activeView = "today";
let activeFilter = "all";
let deferredInstallPrompt = null;

const elements = {
  lessonForm: document.querySelector("#lessonForm"),
  titleInput: document.querySelector("#titleInput"),
  profileInput: document.querySelector("#profileInput"),
  completedInput: document.querySelector("#completedInput"),
  lessonList: document.querySelector("#lessonList"),
  emptyState: document.querySelector("#emptyState"),
  dueCount: document.querySelector("#dueCount"),
  todayLabel: document.querySelector("#todayLabel"),
  viewEyebrow: document.querySelector("#viewEyebrow"),
  viewTitle: document.querySelector("#viewTitle"),
  settingsPanel: document.querySelector("#settingsPanel"),
  installButton: document.querySelector("#installButton"),
  gapInputs: document.querySelectorAll("[data-profile][data-gap]"),
  vocabScheduleSettings: document.querySelector("#vocabScheduleSettings"),
  generalPreview: document.querySelector("#generalPreview"),
  vocabPreview: document.querySelector("#vocabPreview"),
  lessonTemplate: document.querySelector("#lessonTemplate"),
};

init();

function init() {
  elements.todayLabel.textContent = formatDate(todayISO(), "zh-TW");
  elements.completedInput.value = todayISO();
  recalculateOpenFirstReviews();
  syncSettingsInputs();
  renderVocabSettings();
  bindEvents();
  render();
  registerServiceWorker();
}

function bindEvents() {
  elements.lessonForm.addEventListener("submit", (event) => {
    event.preventDefault();
    addLesson();
  });

  document.querySelectorAll(".tab-button").forEach((button) => {
    button.addEventListener("click", () => {
      activeView = button.dataset.view;
      document.querySelectorAll(".tab-button").forEach((item) => item.classList.toggle("is-active", item === button));
      render();
    });
  });

  document.querySelectorAll(".filter-button").forEach((button) => {
    button.addEventListener("click", () => {
      activeFilter = button.dataset.filter;
      document.querySelectorAll(".filter-button").forEach((item) => item.classList.toggle("is-active", item === button));
      render();
    });
  });

  elements.gapInputs.forEach((input) => {
    input.addEventListener("input", () => {
      const profile = input.dataset.profile;
      const key = input.dataset.gap;
      if (!state.settings.profiles[profile]) return;
      state.settings.profiles[profile][key] = Number(input.value || defaults.settings.profiles[profile][key]);
      recalculateOpenFirstReviews();
      saveState();
      render();
    });
  });

  elements.vocabScheduleSettings.addEventListener("input", (event) => {
    const input = event.target.closest("[data-vocab-step]");
    if (!input) return;
    updateVocabStep(input);
  });

  elements.vocabScheduleSettings.addEventListener("change", (event) => {
    const input = event.target.closest("[data-vocab-step]");
    if (!input) return;
    updateVocabStep(input);
  });

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;
    elements.installButton.hidden = false;
  });

  elements.installButton.addEventListener("click", async () => {
    if (!deferredInstallPrompt) return;
    deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
    elements.installButton.hidden = true;
  });
}

function addLesson() {
  const title = elements.titleInput.value.trim();
  if (!title) return;

  const completedDate = elements.completedInput.value;
  const lesson = {
    id: crypto.randomUUID(),
    title,
    profile: elements.profileInput.value,
    completedDate,
    firstReviewDate: completedDate ? getFirstReviewDate(elements.profileInput.value, completedDate) : "",
    firstReviewResult: "",
    secondReviewDate: "",
    vocabStep: 0,
    mastered: false,
    reviewCount: 0,
  };

  state.lessons.unshift(lesson);
  saveState();
  elements.lessonForm.reset();
  elements.profileInput.value = "general";
  elements.completedInput.value = todayISO();
  render();
}

function markClassComplete(id) {
  const lesson = state.lessons.find((item) => item.id === id);
  if (!lesson) return;
  lesson.completedDate = todayISO();
  lesson.firstReviewDate = getFirstReviewDate(lesson.profile, lesson.completedDate);
  saveState();
  render();
}

function completeReview(id, result) {
  const lesson = state.lessons.find((item) => item.id === id);
  if (!lesson) return;

  lesson.firstReviewResult = result;
  lesson.secondReviewDate = addDays(todayISO(), getProfileSettings(lesson.profile)[`${result}Gap`]);
  lesson.reviewCount = Math.max(lesson.reviewCount + 1, 1);
  saveState();
  render();
}

function advanceVocabReview(id) {
  const lesson = state.lessons.find((item) => item.id === id);
  if (!lesson) return;

  const nextStep = (lesson.vocabStep ?? 0) + 1;
  lesson.reviewCount = Math.max(lesson.reviewCount + 1, 1);

  const vocabSteps = getVocabSteps();
  if (nextStep >= vocabSteps.length) {
    markVocabMastered(id);
    return;
  }

  lesson.vocabStep = nextStep;
  lesson.firstReviewDate = getVocabReviewDateFromNow(nextStep);
  lesson.secondReviewDate = "";
  saveState();
  render();
}

function markVocabMastered(id) {
  const lesson = state.lessons.find((item) => item.id === id);
  if (!lesson) return;

  lesson.mastered = true;
  lesson.firstReviewResult = "green";
  lesson.firstReviewDate = "";
  lesson.secondReviewDate = "";
  lesson.reviewCount = Math.max(lesson.reviewCount + 1, 1);
  saveState();
  render();
}

function deleteLesson(id) {
  state.lessons = state.lessons.filter((lesson) => lesson.id !== id);
  saveState();
  render();
}

function render() {
  syncSettingsInputs();
  syncSettingsPreview();
  elements.settingsPanel.hidden = activeView !== "settings";

  const todayLessons = state.lessons.filter(isTodayReview);
  elements.dueCount.textContent = todayLessons.length;

  const visibleLessons = getVisibleLessons();
  elements.lessonList.innerHTML = "";
  visibleLessons.forEach((lesson) => elements.lessonList.append(renderLesson(lesson)));
  elements.emptyState.hidden = visibleLessons.length > 0;

  const isSettings = activeView === "settings";
  elements.lessonList.hidden = isSettings;
  elements.emptyState.hidden = isSettings ? true : visibleLessons.length > 0;
  document.querySelector(".quick-filters").hidden = isSettings;
  setViewTitle();
}

function renderLesson(lesson) {
  const node = elements.lessonTemplate.content.firstElementChild.cloneNode(true);
  const title = node.querySelector("h3");
  const meta = node.querySelector(".lesson-meta");
  const dates = node.querySelector(".lesson-dates");
  const completeButton = node.querySelector(".complete-class");
  const reviewActions = node.querySelector(".review-actions");
  const statusButtons = [...node.querySelectorAll(".status-button")];

  title.textContent = lesson.title;
  meta.textContent = getMetaText(lesson);
  dates.append(...getDateChips(lesson));
  if (lesson.profile === "vocab") dates.append(renderVocabSchedule(lesson));
  completeButton.hidden = Boolean(lesson.completedDate);

  if (lesson.profile === "vocab") {
    reviewActions.classList.add("vocab-review-actions");
    statusButtons[0].textContent = "完成複習";
    statusButtons[0].className = "status-button vocab-next";
    statusButtons[1].hidden = true;
    statusButtons[2].textContent = "綠燈";
    statusButtons[0].addEventListener("click", () => advanceVocabReview(lesson.id));
    statusButtons[2].addEventListener("click", () => markVocabMastered(lesson.id));
    if (lesson.mastered) reviewActions.hidden = true;
  } else {
    statusButtons.forEach((button) => {
      button.addEventListener("click", () => completeReview(lesson.id, button.dataset.result));
    });
  }

  completeButton.addEventListener("click", () => markClassComplete(lesson.id));
  node.querySelector(".delete").addEventListener("click", () => deleteLesson(lesson.id));

  return node;
}

function getDateChips(lesson) {
  const chips = lesson.profile === "vocab" ? [
    ["模式", getProfileSettings(lesson.profile).label],
    ["完成", lesson.completedDate],
    lesson.mastered ? ["狀態", "已熟"] : ["下次", lesson.firstReviewDate],
    lesson.mastered ? null : ["階段", formatVocabStep(getVocabSteps()[lesson.vocabStep ?? 0])],
  ] : [
    ["模式", getProfileSettings(lesson.profile).label],
    ["完成", lesson.completedDate],
    ["第一次", lesson.firstReviewDate],
    ["第二次", lesson.secondReviewDate],
  ];

  return chips
    .filter((item) => item?.[1])
    .map(([label, value]) => {
      const chip = document.createElement("span");
      chip.className = `date-chip ${isDueChip(label, value) ? "is-due" : ""}`;
      chip.textContent = ["模式", "階段", "狀態"].includes(label) ? value : `${label} ${formatDateTime(value)}`;
      return chip;
    });
}

function renderVocabSchedule(lesson) {
  const schedule = document.createElement("div");
  schedule.className = "vocab-schedule";
  schedule.setAttribute("aria-label", "英文單字完整複習頻率");

  getVocabSteps().forEach((step, index) => {
    const item = document.createElement("span");
    item.textContent = formatVocabStep(step);
    if (lesson.mastered) {
      item.classList.add("is-done");
    } else if (index < (lesson.vocabStep ?? 0)) {
      item.classList.add("is-done");
    } else if (index === (lesson.vocabStep ?? 0)) {
      item.classList.add("is-current");
    }
    schedule.append(item);
  });

  return schedule;
}

function getMetaText(lesson) {
  if (lesson.profile === "vocab") {
    if (lesson.mastered) return "英文單字：綠燈已熟，不再排程";
    return `英文單字固定複習：${formatVocabStep(getVocabSteps()[lesson.vocabStep ?? 0]) || "下一階段"}`;
  }
  if (lesson.firstReviewResult) {
    return `第一次複習：${resultText[lesson.firstReviewResult]}，第二次已排定`;
  }
  if (lesson.firstReviewDate) return "等待第一次複習評估";
  return "尚未完成上課";
}

function getVisibleLessons() {
  let lessons = [...state.lessons];

  if (activeView === "today" && activeFilter === "all") lessons = lessons.filter(isTodayReview);
  if (activeFilter === "overdue") lessons = lessons.filter((lesson) => isOverdue(lesson));
  if (activeFilter === "upcoming") lessons = lessons.filter((lesson) => isUpcoming(lesson));

  return lessons.sort((a, b) => {
    const nextA = getNextReviewTime(a) || Number.MAX_SAFE_INTEGER;
    const nextB = getNextReviewTime(b) || Number.MAX_SAFE_INTEGER;
    return nextA - nextB;
  });
}

function setViewTitle() {
  if (activeFilter === "upcoming") {
    elements.viewEyebrow.textContent = "未來複習";
    elements.viewTitle.textContent = "等等會再見面的記憶";
    return;
  }

  if (activeFilter === "overdue") {
    elements.viewEyebrow.textContent = "逾期待複習";
    elements.viewTitle.textContent = "先把漏掉的記憶接回來";
    return;
  }

  const copy = {
    today: ["今日待複習", "持續複習成為永久記憶！"],
    all: ["完整清單", "全部課程與複習排程"],
    settings: ["間距設定", "請依照個人學習能力更改複習間距"],
  };
  elements.viewEyebrow.textContent = copy[activeView][0];
  elements.viewTitle.textContent = copy[activeView][1];
}

function isDue(lesson) {
  const next = getNextReviewTime(lesson);
  return Boolean(next && next <= Date.now());
}

function isTodayReview(lesson) {
  const next = getNextReviewTime(lesson);
  return Boolean(next && next <= endOfToday().getTime());
}

function isOverdue(lesson) {
  const next = getNextReviewTime(lesson);
  return Boolean(next && next < startOfToday().getTime());
}

function isUpcoming(lesson) {
  const next = getNextReviewTime(lesson);
  return Boolean(next && next > Date.now());
}

function getNextReviewDate(lesson) {
  if (lesson.mastered) return "";
  if (lesson.secondReviewDate) return lesson.secondReviewDate;
  if (lesson.firstReviewDate) return lesson.firstReviewDate;
  return "";
}

function getNextReviewTime(lesson) {
  const next = getNextReviewDate(lesson);
  if (!next) return 0;
  return parseReviewDate(next).getTime();
}

function recalculateOpenFirstReviews() {
  state.lessons.forEach((lesson) => {
    if (lesson.completedDate && !lesson.firstReviewResult && lesson.profile !== "vocab") {
      lesson.firstReviewDate = getFirstReviewDate(lesson.profile, lesson.completedDate);
    }
    if (lesson.completedDate && lesson.profile === "vocab" && !lesson.mastered && (lesson.reviewCount ?? 0) === 0) {
      lesson.firstReviewDate = getFirstReviewDate("vocab", lesson.completedDate);
    }
  });
  saveState();
}

function syncSettingsInputs() {
  elements.gapInputs.forEach((input) => {
    const profile = input.dataset.profile;
    const key = input.dataset.gap;
    const value = state.settings.profiles[profile][key];
    if (Number(input.value) !== value) {
      input.value = value;
    }
  });
}

function syncSettingsPreview() {
  elements.generalPreview.textContent = getPreviewText("general");
  elements.vocabPreview.textContent = `英文單字：${getVocabSteps().map(formatVocabStep).join(" → ")}，綠燈即畢業`;
}

function loadState() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (stored?.lessons && stored?.settings) return normalizeState(stored);
  } catch {
    localStorage.removeItem(STORAGE_KEY);
  }
  return structuredClone(defaults);
}

function normalizeState(stored) {
  const normalized = structuredClone(defaults);
  const legacySettings = stored.settings || {};

  if (legacySettings.profiles) {
    normalized.settings.profiles = {
      general: { ...defaults.settings.profiles.general, ...legacySettings.profiles.general },
      vocab: { ...defaults.settings.profiles.vocab, ...legacySettings.profiles.vocab },
    };
  } else {
    normalized.settings.profiles.general = {
      ...defaults.settings.profiles.general,
      firstGap: legacySettings.firstGap ?? defaults.settings.profiles.general.firstGap,
      redGap: legacySettings.redGap ?? defaults.settings.profiles.general.redGap,
      amberGap: legacySettings.amberGap ?? defaults.settings.profiles.general.amberGap,
      greenGap: legacySettings.greenGap ?? defaults.settings.profiles.general.greenGap,
    };
  }

  normalized.lessons = (stored.lessons || [])
    .filter((lesson) => !isSampleLesson(lesson))
    .map((lesson) => ({
      ...lesson,
      profile: lesson.profile || "general",
      vocabStep: lesson.vocabStep ?? 0,
      mastered: Boolean(lesson.mastered),
    }));

  return normalized;
}

function isSampleLesson(lesson) {
  return ["第二堂-02｜普化 有機基礎 P11-13", "第二堂-03｜普化 有機基礎 P14-18"].includes(lesson.title);
}

function getProfileSettings(profile = "general") {
  return state.settings.profiles[profile] || state.settings.profiles.general;
}

function getVocabSteps() {
  return state.settings.profiles.vocab.steps || DEFAULT_VOCAB_STEPS;
}

function getFirstReviewDate(profile, completedDate) {
  if (profile === "vocab") return getVocabReviewDateFromCompleted(completedDate, 0);
  return addDays(completedDate, getProfileSettings(profile).firstGap);
}

function isDueChip(label, value) {
  return ["第一次", "第二次", "下次"].includes(label) && parseReviewDate(value).getTime() <= Date.now();
}

function getPreviewText(profile) {
  const settings = getProfileSettings(profile);
  const first = settings.firstGap === 0 ? "完成當天" : `完成後 ${settings.firstGap} 天`;
  return `${settings.label}：${first}第一次複習，紅 ${settings.redGap} 天、橘 ${settings.amberGap} 天、綠 ${settings.greenGap} 天`;
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function todayISO() {
  return new Date().toLocaleDateString("en-CA");
}

function addDays(dateString, amount) {
  const date = new Date(`${dateString}T00:00:00`);
  date.setDate(date.getDate() + Number(amount));
  return date.toLocaleDateString("en-CA");
}

function addDaysToDate(date, amount) {
  const next = new Date(date);
  next.setDate(next.getDate() + Number(amount));
  return next;
}

function getVocabReviewDateFromNow(stepIndex) {
  const step = getVocabSteps()[stepIndex] || getVocabSteps()[0];
  return addVocabStepToDate(new Date(), step);
}

function getVocabReviewDateFromCompleted(completedDate, stepIndex) {
  const step = getVocabSteps()[stepIndex] || getVocabSteps()[0];
  const base = completedDate === todayISO() ? new Date() : new Date(`${completedDate}T00:00:00`);
  return addVocabStepToDate(base, step);
}

function addVocabStepToDate(baseDate, step) {
  const next = new Date(baseDate);
  if (step.unit === "minute") next.setMinutes(next.getMinutes() + Number(step.amount));
  if (step.unit === "hour") next.setHours(next.getHours() + Number(step.amount));
  if (step.unit === "day") next.setDate(next.getDate() + Number(step.amount));
  if (step.unit === "month") next.setMonth(next.getMonth() + Number(step.amount));
  return next.toISOString();
}

function renderVocabSettings() {
  elements.vocabScheduleSettings.innerHTML = "";
  getVocabSteps().forEach((step, index) => {
    const row = document.createElement("label");
    row.className = "vocab-setting-row";
    row.innerHTML = `
      <span>第 ${index + 1} 階</span>
      <input data-vocab-step="${index}" data-field="amount" type="text" inputmode="numeric" pattern="[0-9]*" value="${step.amount}" />
      <select data-vocab-step="${index}" data-field="unit">
        <option value="minute">分鐘</option>
        <option value="hour">小時</option>
        <option value="day">天</option>
        <option value="month">個月</option>
      </select>
    `;
    row.querySelector("select").value = step.unit;
    elements.vocabScheduleSettings.append(row);
  });
}

function updateVocabStep(input) {
  const index = Number(input.dataset.vocabStep);
  const field = input.dataset.field;
  const steps = getVocabSteps().map((step) => ({ ...step }));
  steps[index][field] = field === "amount" ? Number(input.value || 1) : input.value;
  state.settings.profiles.vocab.steps = steps;
  saveState();
  render();
}

function formatVocabStep(step) {
  if (!step) return "";
  return `${step.amount}${UNIT_LABELS[step.unit]}`;
}

function startOfToday() {
  return new Date(`${todayISO()}T00:00:00`);
}

function endOfToday() {
  const end = startOfToday();
  end.setHours(23, 59, 59, 999);
  return end;
}

function parseReviewDate(value) {
  if (value.includes("T")) return new Date(value);
  return new Date(`${value}T00:00:00`);
}

function formatDate(dateString, locale = "zh-TW") {
  if (!dateString) return "";
  return new Intl.DateTimeFormat(locale, { month: "short", day: "numeric" }).format(new Date(`${dateString}T00:00:00`));
}

function formatDateTime(value) {
  if (!value) return "";
  if (!value.includes("T")) return formatDate(value);

  const date = new Date(value);
  const datePart = date.toLocaleDateString("en-CA") === todayISO() ? "今天" : formatDate(date.toLocaleDateString("en-CA"));
  const timePart = new Intl.DateTimeFormat("zh-TW", { hour: "2-digit", minute: "2-digit", hour12: false }).format(date);
  return `${datePart} ${timePart}`;
}

async function registerServiceWorker() {
  if ("serviceWorker" in navigator) {
    await navigator.serviceWorker.register("./sw.js");
  }
}
