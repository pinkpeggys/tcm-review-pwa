const STORAGE_KEY = "tcm-review-pwa-state-v1";
const DEFAULT_GENERAL_STEPS = [1, 3, 7, 14, 21, 28, 35];
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
        steps: DEFAULT_GENERAL_STEPS,
      },
      vocab: {
        label: "英文單字",
        steps: DEFAULT_VOCAB_STEPS,
      },
    },
  },
  lessons: [],
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
  generalScheduleSettings: document.querySelector("#generalScheduleSettings"),
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
  renderGeneralSettings();
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

  elements.generalScheduleSettings.addEventListener("input", (event) => {
    const input = event.target.closest("[data-general-step]");
    if (!input) return;
    updateGeneralStep(input);
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
    generalStep: 0,
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

function advanceGeneralReview(id) {
  const lesson = state.lessons.find((item) => item.id === id);
  if (!lesson) return;

  const nextStep = (lesson.generalStep ?? 0) + 1;
  lesson.reviewCount = Math.max(lesson.reviewCount + 1, 1);

  if (nextStep >= getGeneralSteps().length) {
    markLessonMastered(id, false);
    return;
  }

  lesson.generalStep = nextStep;
  lesson.firstReviewDate = getGeneralReviewDate(lesson.completedDate, nextStep);
  lesson.secondReviewDate = "";
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
    markLessonMastered(id, false);
    return;
  }

  lesson.vocabStep = nextStep;
  lesson.firstReviewDate = getVocabReviewDateFromNow(nextStep);
  lesson.secondReviewDate = "";
  saveState();
  render();
}

function markLessonMastered(id, countReview = true) {
  const lesson = state.lessons.find((item) => item.id === id);
  if (!lesson) return;

  lesson.mastered = true;
  lesson.firstReviewResult = "mastered";
  lesson.firstReviewDate = "";
  lesson.secondReviewDate = "";
  if (countReview) lesson.reviewCount = Math.max(lesson.reviewCount + 1, 1);
  saveState();
  render();
}

function deleteLesson(id) {
  state.lessons = state.lessons.filter((lesson) => lesson.id !== id);
  saveState();
  render();
}

function render() {
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
  else dates.append(renderGeneralSchedule(lesson));
  completeButton.hidden = Boolean(lesson.completedDate);

  reviewActions.classList.add("two-action-review");
  statusButtons[0].textContent = "已完成複習";
  statusButtons[1].textContent = "已成為長久記憶";
  statusButtons[0].addEventListener("click", () => {
    if (lesson.profile === "vocab") advanceVocabReview(lesson.id);
    else advanceGeneralReview(lesson.id);
  });
  statusButtons[1].addEventListener("click", () => markLessonMastered(lesson.id));
  if (lesson.mastered) reviewActions.hidden = true;

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
    lesson.mastered ? ["狀態", "長久記憶"] : ["下次", lesson.firstReviewDate],
    lesson.mastered ? null : ["階段", `第 ${(lesson.generalStep ?? 0) + 1}/7 次・${getGeneralSteps()[lesson.generalStep ?? 0]}天`],
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

function renderGeneralSchedule(lesson) {
  const schedule = document.createElement("div");
  schedule.className = "vocab-schedule";
  schedule.setAttribute("aria-label", "一般科目七次複習頻率");

  getGeneralSteps().forEach((days, index) => {
    const item = document.createElement("span");
    item.textContent = `${days}天`;
    if (lesson.mastered || index < (lesson.generalStep ?? 0)) item.classList.add("is-done");
    else if (index === (lesson.generalStep ?? 0)) item.classList.add("is-current");
    schedule.append(item);
  });

  return schedule;
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
    if (lesson.mastered) return "英文單字：已成為長久記憶，不再排程";
    return `英文單字固定複習：${formatVocabStep(getVocabSteps()[lesson.vocabStep ?? 0]) || "下一階段"}`;
  }
  if (lesson.mastered) return "一般科目：已成為長久記憶，不再排程";
  if (lesson.firstReviewDate) return `一般科目固定複習：第 ${(lesson.generalStep ?? 0) + 1}/7 次`;
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
  return Boolean(next && next >= startOfToday().getTime() && next <= endOfToday().getTime());
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
    if (lesson.completedDate && lesson.profile !== "vocab" && !lesson.mastered && (lesson.reviewCount ?? 0) === 0) {
      lesson.generalStep = 0;
      lesson.firstReviewDate = getGeneralReviewDate(lesson.completedDate, 0);
      lesson.secondReviewDate = "";
      lesson.firstReviewResult = "";
    }
    if (lesson.completedDate && lesson.profile === "vocab" && !lesson.mastered && (lesson.reviewCount ?? 0) === 0) {
      lesson.firstReviewDate = getFirstReviewDate("vocab", lesson.completedDate);
    }
  });
  saveState();
}

function syncSettingsPreview() {
  elements.generalPreview.textContent = `一般科目：${getGeneralSteps().map((days) => `${days}天`).join(" → ")}，完成七次或提早成為長久記憶`;
  elements.vocabPreview.textContent = `英文單字：${getVocabSteps().map(formatVocabStep).join(" → ")}，也可提早成為長久記憶`;
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
    normalized.settings.profiles.general = { ...defaults.settings.profiles.general };
  }

  normalized.lessons = (stored.lessons || [])
    .filter((lesson) => !isSampleLesson(lesson))
    .map((lesson) => {
      const profile = lesson.profile || "general";
      const mastered = Boolean(lesson.mastered);
      const generalStep = lesson.generalStep ?? Math.min(lesson.reviewCount ?? 0, DEFAULT_GENERAL_STEPS.length - 1);
      return {
        ...lesson,
        profile,
        generalStep,
        vocabStep: lesson.vocabStep ?? 0,
        mastered,
        firstReviewResult: profile === "general" ? "" : lesson.firstReviewResult,
        secondReviewDate: profile === "general" ? "" : lesson.secondReviewDate,
        firstReviewDate: profile === "general" && lesson.completedDate && !mastered
          ? addDays(lesson.completedDate, normalized.settings.profiles.general.steps[generalStep])
          : lesson.firstReviewDate,
      };
    });

  return normalized;
}

function isSampleLesson(lesson) {
  return ["第二堂-02｜普化 有機基礎 P11-13", "第二堂-03｜普化 有機基礎 P14-18"].includes(lesson.title);
}

function getProfileSettings(profile = "general") {
  return state.settings.profiles[profile] || state.settings.profiles.general;
}

function getGeneralSteps() {
  return state.settings.profiles.general.steps || DEFAULT_GENERAL_STEPS;
}

function getVocabSteps() {
  return state.settings.profiles.vocab.steps || DEFAULT_VOCAB_STEPS;
}

function getFirstReviewDate(profile, completedDate) {
  if (profile === "vocab") return getVocabReviewDateFromCompleted(completedDate, 0);
  return getGeneralReviewDate(completedDate, 0);
}

function getGeneralReviewDate(completedDate, stepIndex) {
  return addDays(completedDate, getGeneralSteps()[stepIndex] ?? getGeneralSteps()[0]);
}

function isDueChip(label, value) {
  return ["第一次", "第二次", "下次"].includes(label) && parseReviewDate(value).getTime() <= Date.now();
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

function renderGeneralSettings() {
  elements.generalScheduleSettings.innerHTML = "";
  getGeneralSteps().forEach((days, index) => {
    const row = document.createElement("label");
    row.className = "general-setting-row";
    row.innerHTML = `
      <span>第 ${index + 1} 次</span>
      <input data-general-step="${index}" type="text" inputmode="numeric" pattern="[0-9]*" value="${days}" />
      <span>天</span>
    `;
    elements.generalScheduleSettings.append(row);
  });
}

function updateGeneralStep(input) {
  const index = Number(input.dataset.generalStep);
  const steps = [...getGeneralSteps()];
  steps[index] = Math.max(1, Number(input.value || 1));
  state.settings.profiles.general.steps = steps;

  state.lessons.forEach((lesson) => {
    if (lesson.profile === "general" && !lesson.mastered && (lesson.reviewCount ?? 0) === 0 && index === 0) {
      lesson.firstReviewDate = getGeneralReviewDate(lesson.completedDate, 0);
    }
  });

  saveState();
  render();
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
