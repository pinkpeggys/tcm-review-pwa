const STORAGE_KEY = "tcm-review-pwa-state-v1";

const defaults = {
  settings: {
    firstGap: 2,
    redGap: 1,
    amberGap: 3,
    greenGap: 7,
  },
  lessons: [
    {
      id: crypto.randomUUID(),
      title: "第二堂-02｜普化 有機基礎 P11-13",
      completedDate: "2026-05-13",
      firstReviewDate: "2026-05-15",
      firstReviewResult: "",
      secondReviewDate: "",
      reviewCount: 0,
    },
    {
      id: crypto.randomUUID(),
      title: "第二堂-03｜普化 有機基礎 P14-18",
      completedDate: "2026-05-13",
      firstReviewDate: "2026-05-15",
      firstReviewResult: "",
      secondReviewDate: "",
      reviewCount: 0,
    },
  ],
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
  completedInput: document.querySelector("#completedInput"),
  lessonList: document.querySelector("#lessonList"),
  emptyState: document.querySelector("#emptyState"),
  dueCount: document.querySelector("#dueCount"),
  todayLabel: document.querySelector("#todayLabel"),
  viewEyebrow: document.querySelector("#viewEyebrow"),
  viewTitle: document.querySelector("#viewTitle"),
  settingsPanel: document.querySelector("#settingsPanel"),
  installButton: document.querySelector("#installButton"),
  firstGap: document.querySelector("#firstGap"),
  redGap: document.querySelector("#redGap"),
  amberGap: document.querySelector("#amberGap"),
  greenGap: document.querySelector("#greenGap"),
  firstGapPreview: document.querySelector("#firstGapPreview"),
  redGapPreview: document.querySelector("#redGapPreview"),
  amberGapPreview: document.querySelector("#amberGapPreview"),
  greenGapPreview: document.querySelector("#greenGapPreview"),
  lessonTemplate: document.querySelector("#lessonTemplate"),
};

init();

function init() {
  elements.todayLabel.textContent = formatDate(todayISO(), "zh-TW");
  elements.completedInput.value = todayISO();
  syncSettingsInputs();
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

  ["firstGap", "redGap", "amberGap", "greenGap"].forEach((key) => {
    elements[key].addEventListener("input", () => {
      state.settings[key] = Number(elements[key].value || defaults.settings[key]);
      recalculateOpenFirstReviews();
      saveState();
      render();
    });
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
    completedDate,
    firstReviewDate: completedDate ? addDays(completedDate, state.settings.firstGap) : "",
    firstReviewResult: "",
    secondReviewDate: "",
    reviewCount: 0,
  };

  state.lessons.unshift(lesson);
  saveState();
  elements.lessonForm.reset();
  elements.completedInput.value = todayISO();
  render();
}

function markClassComplete(id) {
  const lesson = state.lessons.find((item) => item.id === id);
  if (!lesson) return;
  lesson.completedDate = todayISO();
  lesson.firstReviewDate = addDays(lesson.completedDate, state.settings.firstGap);
  saveState();
  render();
}

function completeReview(id, result) {
  const lesson = state.lessons.find((item) => item.id === id);
  if (!lesson) return;

  lesson.firstReviewResult = result;
  lesson.secondReviewDate = addDays(todayISO(), state.settings[`${result}Gap`]);
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

  const dueLessons = state.lessons.filter(isDue);
  elements.dueCount.textContent = dueLessons.length;

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

  title.textContent = lesson.title;
  meta.textContent = getMetaText(lesson);
  dates.append(...getDateChips(lesson));
  completeButton.hidden = Boolean(lesson.completedDate);

  node.querySelectorAll(".status-button").forEach((button) => {
    button.addEventListener("click", () => completeReview(lesson.id, button.dataset.result));
  });
  completeButton.addEventListener("click", () => markClassComplete(lesson.id));
  node.querySelector(".delete").addEventListener("click", () => deleteLesson(lesson.id));

  return node;
}

function getDateChips(lesson) {
  const chips = [
    ["完成", lesson.completedDate],
    ["第一次", lesson.firstReviewDate],
    ["第二次", lesson.secondReviewDate],
  ];

  return chips
    .filter(([, date]) => date)
    .map(([label, date]) => {
      const chip = document.createElement("span");
      chip.className = `date-chip ${date <= todayISO() && (label === "第一次" || label === "第二次") ? "is-due" : ""}`;
      chip.textContent = `${label} ${formatDate(date)}`;
      return chip;
    });
}

function getMetaText(lesson) {
  if (lesson.firstReviewResult) {
    return `第一次複習：${resultText[lesson.firstReviewResult]}，第二次已排定`;
  }
  if (lesson.firstReviewDate) return "等待第一次複習評估";
  return "尚未完成上課";
}

function getVisibleLessons() {
  let lessons = [...state.lessons];
  if (activeView === "today") lessons = lessons.filter(isDue);

  if (activeFilter === "overdue") lessons = lessons.filter((lesson) => getNextReviewDate(lesson) < todayISO());
  if (activeFilter === "upcoming") lessons = lessons.filter((lesson) => getNextReviewDate(lesson) > todayISO());

  return lessons.sort((a, b) => {
    const nextA = getNextReviewDate(a) || "9999-12-31";
    const nextB = getNextReviewDate(b) || "9999-12-31";
    return nextA.localeCompare(nextB);
  });
}

function setViewTitle() {
  const copy = {
    today: ["今日待複習", "持續複習成為永久記憶！"],
    all: ["完整清單", "全部課程與複習排程"],
    settings: ["間距設定", "調整紅橘綠燈的節奏"],
  };
  elements.viewEyebrow.textContent = copy[activeView][0];
  elements.viewTitle.textContent = copy[activeView][1];
}

function isDue(lesson) {
  const next = getNextReviewDate(lesson);
  return Boolean(next && next <= todayISO());
}

function getNextReviewDate(lesson) {
  if (lesson.secondReviewDate) return lesson.secondReviewDate;
  if (lesson.firstReviewDate) return lesson.firstReviewDate;
  return "";
}

function recalculateOpenFirstReviews() {
  state.lessons.forEach((lesson) => {
    if (lesson.completedDate && !lesson.firstReviewResult) {
      lesson.firstReviewDate = addDays(lesson.completedDate, state.settings.firstGap);
    }
  });
}

function syncSettingsInputs() {
  Object.keys(state.settings).forEach((key) => {
    if (elements[key] && Number(elements[key].value) !== state.settings[key]) {
      elements[key].value = state.settings[key];
    }
  });
}

function syncSettingsPreview() {
  elements.firstGapPreview.textContent = state.settings.firstGap;
  elements.redGapPreview.textContent = state.settings.redGap;
  elements.amberGapPreview.textContent = state.settings.amberGap;
  elements.greenGapPreview.textContent = state.settings.greenGap;
}

function loadState() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (stored?.lessons && stored?.settings) return stored;
  } catch {
    localStorage.removeItem(STORAGE_KEY);
  }
  return structuredClone(defaults);
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

function formatDate(dateString, locale = "zh-TW") {
  if (!dateString) return "";
  return new Intl.DateTimeFormat(locale, { month: "short", day: "numeric" }).format(new Date(`${dateString}T00:00:00`));
}

async function registerServiceWorker() {
  if ("serviceWorker" in navigator) {
    await navigator.serviceWorker.register("./sw.js");
  }
}
