import "./index.css";
import "../css/animate.min.css";
import "./canvas.js";
import {
  addQipao,
  setPrizes,
  showPrizeList,
  setPrizeData,
  resetPrize
} from "./prizeList";
import { NUMBER_MATRIX } from "./config.js";
import { initGestureStopper, allowImmediateSpin } from "./gesture.js";

// === API base for Render backend ===
const API_URL = "https://tmobile-lottery-api.onrender.com";
console.log("✅ API_URL =", API_URL);

// Переопределяем глобальный AJAX — всегда использует абсолютный URL
window.AJAX = function (param) {
  const opt = Object.assign(
    {
      type: "POST",
      async: true,
      isJSON: true,
      data: {},
      headers: { "Content-Type": "application/json;charset=utf-8" },
    },
    param || {}
  );

  // Собираем абсолютный путь (даже если opt.url начинается со слэша)
  const url =
    API_URL + (opt.url.startsWith("/") ? "" : "/") + opt.url.replace(/^\/+/, "");

  const xhr = new XMLHttpRequest();
  xhr.onreadystatechange = function () {
    if (xhr.readyState === 4) {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const resText = xhr.responseText || "";
          const res = opt.isJSON ? (resText ? JSON.parse(resText) : {}) : resText;
          opt.success && opt.success(res);
        } catch (e) {
          console.error("Ошибка парсинга ответа:", e);
        }
      } else {
        console.error("❌ Ошибка запроса:", xhr.status, url);
        opt.error && opt.error(xhr);
      }
    }
  };

  xhr.open(opt.type, url, opt.async);
  for (const [k, v] of Object.entries(opt.headers || {})) {
    xhr.setRequestHeader(k, v);
  }
  xhr.send(opt.isJSON ? JSON.stringify(opt.data || {}) : opt.data || null);

  // 👇 Добавляем лог для наглядности
  console.log("➡️ AJAX", opt.type, url, opt.data || {});
};




const ROTATE_TIME = 3000;
const ROTATE_LOOP = 1000;
const MIN_SPIN_MS = 1000; // минимум 1s до допуска жеста стоп
const SPIN_SPEED = 0.124; // ~на 30% медленнее, чем было (0.176 * 0.7)
const BASE_HEIGHT = 1080;
const BASE_WIDTH = 1920;
const MIN_RESOLUTION = 0.65;
const MAX_RESOLUTION = 1.25;
const RESOLUTION_EPSILON = 0.03;
const DISPLAY_YEAR = 2026;
const MIN_AUTO_SPINS = 3;
const CARD_BACKGROUNDS = [
  "linear-gradient(135deg, rgba(40, 150, 255, 0.9), rgba(70, 90, 255, 0.82))",
  "linear-gradient(135deg, rgba(50, 195, 155, 0.88), rgba(18, 128, 144, 0.78))",
  "linear-gradient(135deg, rgba(120, 70, 245, 0.86), rgba(70, 35, 190, 0.78))",
  "linear-gradient(135deg, rgba(32, 112, 240, 0.9), rgba(20, 210, 255, 0.78))",
  "linear-gradient(135deg, rgba(18, 168, 255, 0.88), rgba(12, 118, 255, 0.8))"
];
const HIGHLIGHT_BACKGROUND = "rgb(255, 120, 0)";
const YEAR_TEXT = "2026";

const CARD_LABEL_OVERRIDES = {
  1: "Красивый номер",
  2: "Дополнительные гигабайты",
  3: "Дополнительные минуты",
  4: "Мегабайты в роуминге",
  5: "Уникальный аватар с фирменным стилем T-Mobile",
  6: "Эксклюзивный номер, который совпадает с датой твоего дня рождения",
  7: "Фирменный T-Mobile облик для аватара в метавселенной"
};

let TOTAL_CARDS,
  btns = {
    enter: document.querySelector("#enter"),
    lotteryBar: document.querySelector("#lotteryBar"),
    lottery: document.querySelector("#lottery")
  },
  brandLogo = document.querySelector(".brand-logo"),
  qrPrompt = document.querySelector("#qrPrompt"),
  qrPlaceholderEl = qrPrompt ? qrPrompt.querySelector(".qr-placeholder") : null,
  qrLabelEl = qrPrompt ? qrPrompt.querySelector(".qr-label") : null,
  prizes,
  ROW_COUNT = 7,
  COLUMN_COUNT = 17,
  HIGHLIGHT_CELL = [],
  // Текущий коэффициент масштабирования
  Resolution = 1,
  prizeIndexMap = new Map(),
  availablePrizePool = [],
  cardPrizeLayout = [],
  defaultPrizeType = null,
  gesturesReady = false,
  DEFAULT_QR_ACCENT = {
    borderColor: qrPlaceholderEl ? window.getComputedStyle(qrPlaceholderEl).borderColor : "",
    labelColor: qrLabelEl ? window.getComputedStyle(qrLabelEl).color : "",
    labelShadow: qrLabelEl ? window.getComputedStyle(qrLabelEl).textShadow : ""
  };

const LAYOUT_CLASSES = {
  compact: "layout-compact",
  portrait: "layout-portrait"
};

const MODE_CLASSES = {
  table: "mode-table",
  lottery: "mode-lottery"
};

const PRIZE_DISPLAY_CLASSES = {
  compact: "prize-compact",
  expanded: "prize-expanded"
};

function normalizeWinnerKey(label) {
  if (!label) {
    return "";
  }
  return label
    .toString()
    .replace(/[«»"“”„]+/g, "")
    .replace(/\s+/g, " ")
    .replace(/[:：]+$/, "")
    .trim()
    .toLowerCase();
}

const CUSTOM_WINNER_LINE_CONFIG = [
  {
    keys: [
      "Эксклюзивный номер, который совпадает с датой твоего дня рождения",
      "Эксклюзивный номер который совпадает с датой твоего дня рождения"
    ],
    lines: [
      "Эксклюзивный номер",
      "который совпадает с датой",
      "твоего дня рождения"
    ]
  },
  {
    keys: [
      "Фирменный T-Mobile облик для аватара в метавселенной",
      "Фирменные T-Mobile облики для аватара в метавселенной"
    ],
    lines: ["Фирменный", "Т-мобайл облик", "для аватара", "в метавселенной"]
  }
];

const CUSTOM_WINNER_LINES = new Map();
CUSTOM_WINNER_LINE_CONFIG.forEach(({ keys, lines }) => {
  keys.forEach(key => {
    CUSTOM_WINNER_LINES.set(normalizeWinnerKey(key), lines);
  });
});

const SPHERE_OFFSET_X = -295; // translate entire scene left while keeping rotation centered
const WINNER_CARD_CENTER_OFFSET = -80; // fine-tune world-space offset so winner card aligns visually
const SPHERE_OFFSET_Y = 0;

function getSceneOffsetX() {
  return SPHERE_OFFSET_X * Resolution;
}

function getSceneOffsetY() {
  return SPHERE_OFFSET_Y * Resolution;
}

function getWinnerCardOffsetX(multiplier = 1) {
  return WINNER_CARD_CENTER_OFFSET * multiplier * Resolution;
}

let camera,
  scene,
  renderer,
  controls,
  threeDCards = [],
  targets = {
    table: [],
    sphere: []
  };

let requestSmoothStop;
let rotateScene = false;
let spinStartedAt = 0;
let spinBaseAngle = 0;

let selectedCardIndex = [],
  rotate = false,
  basicData = {
    prizes: [], // Информация о призах
    users: [], // Все участники
    luckyUsers: {}, // Победители
    leftUsers: [], // Не выигравшие (сохраняем для совместимости)
    awardedCounts: {}
  },
  interval,
  currentPrize,
  // Идёт розыгрыш
  isLotting = false,
  currentLuckys = [];

initAll();

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function toggleLayoutClass(element, className, enabled) {
  if (!element) {
    return;
  }
  if (enabled) {
    element.classList.add(className);
  } else {
    element.classList.remove(className);
  }
}

function setModeClass(mode) {
  const body = document.body;
  if (!body) {
    return;
  }
  Object.values(MODE_CLASSES).forEach(cls => body.classList.remove(cls));
  if (mode && MODE_CLASSES[mode]) {
    body.classList.add(MODE_CLASSES[mode]);
  }
}

function setPrizeDisplayMode(mode) {
  const body = document.body;
  if (!body) {
    return;
  }
  Object.values(PRIZE_DISPLAY_CLASSES).forEach(cls =>
    body.classList.remove(cls)
  );
  if (mode && PRIZE_DISPLAY_CLASSES[mode]) {
    body.classList.add(PRIZE_DISPLAY_CLASSES[mode]);
  }
}

function computeResolutionScale() {
  const widthRatio = window.innerWidth / BASE_WIDTH;
  const heightRatio = window.innerHeight / BASE_HEIGHT;
  const nextScale = clamp(Math.min(widthRatio, heightRatio), MIN_RESOLUTION, MAX_RESOLUTION);
  return nextScale;
}

function updateSphereTargets() {
  if (!targets.sphere.length || typeof THREE === "undefined") {
    return;
  }
  const total = targets.sphere.length;
  const vector = new THREE.Vector3();
  for (let i = 0; i < total; i++) {
    const phi = Math.acos(-1 + (2 * i) / total);
    const theta = Math.sqrt(total * Math.PI) * phi;
    const target = targets.sphere[i];
    if (!target) {
      continue;
    }
    target.position.setFromSphericalCoords(800 * Resolution, phi, theta);
    vector.copy(target.position).multiplyScalar(2);
    target.lookAt(vector);
  }

  if (scene) {
    scene.position.set(getSceneOffsetX(), getSceneOffsetY(), scene.position.z);
  }
}

function computeWinnerPositions() {
  const width = 140;
  const locates = [];
  let tag = -(currentLuckys.length - 1) / 2;

  if (currentLuckys.length > 5) {
    const yPosition = [-87, 87];
    const total = selectedCardIndex.length;
    const mid = Math.ceil(total / 2);
    let localTag = -(mid - 1) / 2;
    for (let i = 0; i < mid; i++) {
      locates.push({
        x: localTag * width * Resolution,
        y: yPosition[0] * Resolution
      });
      localTag++;
    }

    localTag = -(total - mid - 1) / 2;
    for (let i = mid; i < total; i++) {
      locates.push({
        x: localTag * width * Resolution,
        y: yPosition[1] * Resolution
      });
      localTag++;
    }
  } else {
    for (let i = selectedCardIndex.length; i > 0; i--) {
      locates.push({
        x: tag * width * Resolution,
        y: 0 * Resolution
      });
      tag++;
    }
  }

  return locates;
}

function repositionWinnerCards() {
  if (!renderer || !threeDCards.length) {
    return;
  }

  if (!currentLuckys.length || !selectedCardIndex.length) {
    return;
  }
  const locates = computeWinnerPositions();
  const sceneOffsetX = getSceneOffsetX();
  const centerBias = selectedCardIndex.length === 1 ? getWinnerCardOffsetX() : 0;

  selectedCardIndex.forEach((cardIndex, index) => {
    const object = threeDCards[cardIndex];
    const targetPosition = locates[index];
    if (!object || !targetPosition) {
      return;
    }
    object.position.x = targetPosition.x - sceneOffsetX + centerBias;
    object.position.y = targetPosition.y * Resolution;
    object.position.z = 2200;
  });
  render();
}

function updateLayoutState() {
  const body = document.body;
  if (!body) {
    return;
  }

  const aspectRatio = window.innerWidth / window.innerHeight;
  const isPortrait = aspectRatio < 0.85 || window.innerWidth < 900;
  const isCompact = !isPortrait && window.innerWidth < 1400;

  toggleLayoutClass(body, LAYOUT_CLASSES.portrait, isPortrait);
  toggleLayoutClass(body, LAYOUT_CLASSES.compact, isCompact);
}

function updateResolution(force = false) {
  const newResolution = computeResolutionScale();
  if (!force && Math.abs(newResolution - Resolution) < RESOLUTION_EPSILON) {
    return;
  }

  Resolution = newResolution;
  updateSphereTargets();
  repositionWinnerCards();
}

function updateResponsiveLayout(force = false) {
  updateLayoutState();
  updateResolution(force);
}
function shuffleArray(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

function getRandomCardBackground() {
  return CARD_BACKGROUNDS[Math.floor(Math.random() * CARD_BACKGROUNDS.length)];
}

function assignBaseOpacity(element, force = false) {
  if (!element) return;
  let base = Number(element.dataset.baseOpacity);
  if (!Number.isFinite(base) || force) {
    base = 0.35 + Math.random() * 0.45; // 0.35..0.8
    element.dataset.baseOpacity = base;
  }
  if (!element.classList.contains("card-solid")) {
    element.style.opacity = base;
  }
}

function setCardSolidState(element, isSolid) {
  if (!element) return;
  if (isSolid) {
    element.classList.add("card-solid");
    element.style.opacity = 1;
  } else {
    element.classList.remove("card-solid");
    assignBaseOpacity(element);
  }
}

function setQrVisibility(visible = false) {
  if (!qrPrompt) return;
  if (visible) {
    qrPrompt.classList.add("visible");
  } else {
    qrPrompt.classList.remove("visible");
    resetQrAccent();
  }
}

function resetQrAccent() {
  if (qrPlaceholderEl && DEFAULT_QR_ACCENT.borderColor) {
    qrPlaceholderEl.style.borderColor = DEFAULT_QR_ACCENT.borderColor;
  }
  if (qrLabelEl) {
    if (DEFAULT_QR_ACCENT.labelColor) {
      qrLabelEl.style.color = DEFAULT_QR_ACCENT.labelColor;
    }
    if (DEFAULT_QR_ACCENT.labelShadow) {
      qrLabelEl.style.textShadow = DEFAULT_QR_ACCENT.labelShadow;
    }
  }
}

function ensureNameElement(element) {
  if (!element) {
    return null;
  }
  let nameEl = element.querySelector(".name");
  if (!nameEl) {
    nameEl = document.createElement("div");
    nameEl.className = "name";
    element.appendChild(nameEl);
  }
  try {
    nameEl.setAttribute("lang", "ru");
  } catch (e) {}
  return nameEl;
}

function applyNameSizing(nameEl, text) {
  if (!nameEl) {
    return;
  }
  nameEl.classList.remove("name--sm", "name--xs", "name--xxs", "name--micro");
  const length = text ? text.length : 0;
  const longestToken = text
    ? text
        .split(/\s+/)
        .reduce((max, token) => Math.max(max, token.length), 0)
    : 0;
  let clamp = 4;

  if (longestToken > 18 || length > 64) {
    nameEl.classList.add("name--micro");
    clamp = 7;
  } else if (longestToken > 15 || length > 54) {
    nameEl.classList.add("name--xxs");
    clamp = 7;
  } else if (longestToken > 12 || length > 44) {
    nameEl.classList.add("name--xs");
    clamp = 6;
  } else if (longestToken > 10 || length > 32) {
    nameEl.classList.add("name--sm");
    clamp = 5;
  }

  nameEl.dataset.lineClamp = String(clamp);

  requestAnimationFrame(() => {
    const prizeElement = nameEl.closest(".prize");
    if (prizeElement) {
      fitPrizeCardSize(prizeElement);
    }
  });
}

function fitPrizeCardSize(element) {
  if (!element) {
    return;
  }
  const nameEl = element.querySelector(".name");
  if (!nameEl) {
    return;
  }

  element.style.removeProperty("width");
  element.style.removeProperty("height");
  const styles = window.getComputedStyle(element);
  const paddingLeft = parseFloat(styles.paddingLeft) || 0;
  const paddingRight = parseFloat(styles.paddingRight) || 0;
  const minWidth = parseFloat(styles.minWidth) || 0;
  const maxWidthValue = parseFloat(styles.maxWidth);
  const hasMaxWidth = Number.isFinite(maxWidthValue) && maxWidthValue > 0;
  const contentWidth = nameEl.scrollWidth + paddingLeft + paddingRight;
  let targetWidth = Math.max(contentWidth, minWidth);
  if (hasMaxWidth) {
    targetWidth = Math.min(targetWidth, maxWidthValue);
  }
  if (!Number.isFinite(targetWidth) || targetWidth <= 0) {
    element.style.removeProperty("width");
    element.style.removeProperty("height");
    return;
  }
  element.style.width = `${Math.ceil(targetWidth)}px`;
  element.style.height = `${Math.ceil(targetWidth)}px`;
}

function clearPrizeCardSize(element) {
  if (!element) {
    return;
  }
  element.style.removeProperty("width");
  element.style.removeProperty("height");
}

function renderWinnerLabel(nameEl, label) {
  nameEl.textContent = "";
  const customLines = getCustomWinnerLines(label);
  if (customLines && customLines.length) {
    customLines.forEach(line => {
      const span = document.createElement("span");
      span.className = "name-word";
      span.textContent = line;
      nameEl.appendChild(span);
    });
    return;
  }
  const words = (label || "")
    .split(/\s+/)
    .map(word => word.trim())
    .filter(Boolean);
  if (words.length === 0) {
    return;
  }
  const fragment = document.createDocumentFragment();
  words.forEach(word => {
    const span = document.createElement("span");
    span.className = "name-word";
    span.textContent = word;
    fragment.appendChild(span);
  });
  nameEl.appendChild(fragment);
}

function getCustomWinnerLines(label) {
  if (!label) {
    return null;
  }
  const normalized = normalizeWinnerKey(label);
  const mapped = CUSTOM_WINNER_LINES.get(normalized);
  if (mapped) {
    return mapped;
  }
  if (
    normalized.includes("t-mobile") &&
    normalized.includes("облик") &&
    normalized.includes("аватар")
  ) {
    return ["Фирменный", "Т-мобайл облик", "для аватара", "в метавселенной"];
  }
  if (
    normalized.includes("номер") &&
    normalized.includes("дат") &&
    normalized.includes("рождения")
  ) {
    return [
      "Эксклюзивный номер",
      "который совпадает с датой",
      "твоего дня рождения"
    ];
  }
  return null;
}

function setCardLabel(element, label, options = {}) {
  const nameEl = ensureNameElement(element);
  if (!nameEl) {
    return;
  }
  const safeLabel = label || "";
  const isWinner = !!options.isWinner;
  if (isWinner) {
    renderWinnerLabel(nameEl, safeLabel);
  } else {
    nameEl.textContent = safeLabel;
  }
  element.title = safeLabel;
  applyNameSizing(nameEl, safeLabel);
  if (safeLabel) {
    element.classList.remove("card-empty");
  } else {
    element.classList.add("card-empty");
  }
}

function getPrizeLabel(prize) {
  if (!prize) {
    return "";
  }
  if (prize.title && prize.title.trim()) {
    return prize.title.trim();
  }
  const sanitized = String(prize.text || "")
    .replace(/\s+/g, " ")
    .trim();
  const noNumbers = sanitized.replace(/\d[\d\s]*/g, "").replace(/\s+/g, " ").trim();
  return noNumbers || sanitized;
}

function normalizeLuckyData(raw) {
  const normalized = {};
  if (!raw || typeof raw !== "object") {
    return normalized;
  }
  Object.keys(raw).forEach(key => {
    const entries = Array.isArray(raw[key]) ? raw[key] : [];
    normalized[key] = entries.map(entry => {
      if (entry && typeof entry === "object" && !Array.isArray(entry)) {
        return entry;
      }
      if (Array.isArray(entry)) {
        return {
          type: Number(key),
          label: entry[1] || entry[0] || "",
          source: entry
        };
      }
      return {
        type: Number(key),
        label: String(entry || "")
      };
    });
  });
  return normalized;
}

function initialisePrizeState(luckyData) {
  prizeIndexMap = new Map();
  availablePrizePool = [];
  basicData.awardedCounts = {};
  basicData.luckyUsers = normalizeLuckyData(luckyData);

  prizes.forEach((prize, index) => {
    const labelOverride = CARD_LABEL_OVERRIDES.hasOwnProperty(prize.type)
      ? CARD_LABEL_OVERRIDES[prize.type]
      : null;
    const label = labelOverride || getPrizeLabel(prize);
    prize.displayLabel = label;
    if (index === 0) {
      defaultPrizeType = prize.type;
    }
    prizeIndexMap.set(prize.type, { prize, index });
    if (prize.type === defaultPrizeType) {
      return;
    }
    const typeKey = String(prize.type);
    const awarded = (basicData.luckyUsers[typeKey] || []).length;
    basicData.awardedCounts[prize.type] = awarded;
    const remaining = Math.max((Number(prize.count) || 0) - awarded, 0);
    for (let i = 0; i < remaining; i++) {
      availablePrizePool.push(prize.type);
    }
  });

  shuffleArray(availablePrizePool);
}

function buildCardEntries() {
  const entries = [];
  const displayTypes = [];
  prizeIndexMap.forEach((info, type) => {
    if (info && info.prize.type !== defaultPrizeType) {
      displayTypes.push(type);
    }
  });

  if (displayTypes.length === 0) {
    for (let i = 0; i < TOTAL_CARDS; i++) {
      entries.push({ type: null, label: "" });
    }
    return entries;
  }

  let bag = [];
  for (let i = 0; i < TOTAL_CARDS; i++) {
    if (bag.length === 0) {
      bag = displayTypes.slice();
      shuffleArray(bag);
    }
    const type = bag.pop();
    const info = prizeIndexMap.get(type);
    entries.push({
      type,
      label: (info && info.prize && info.prize.displayLabel) || ""
    });
  }

  return entries;
}

function drawPrizeFromPool() {
  if (availablePrizePool.length === 0) {
    return null;
  }
  const index = Math.floor(Math.random() * availablePrizePool.length);
  const [type] = availablePrizePool.splice(index, 1);
  const info = prizeIndexMap.get(type);
  if (!info) {
    return null;
  }

  return {
    type,
    label: info.prize.displayLabel,
    text: info.prize.text,
    index: info.index,
    timestamp: Date.now()
  };
}

function markPrizeAwarded(record, options = {}) {
  if (!record || typeof record.type === "undefined") {
    return;
  }
  const type = record.type;
  basicData.awardedCounts[type] = (basicData.awardedCounts[type] || 0) + 1;
  const info = prizeIndexMap.get(type);
  if (info) {
    setPrizeData(info.index, basicData.awardedCounts[type], {
      highlight: !!options.highlight
    });
  }
}

function undoPrizeAward(record) {
  if (!record || typeof record.type === "undefined") {
    return;
  }
  const type = record.type;
  const current = basicData.awardedCounts[type] || 0;
  basicData.awardedCounts[type] = current > 0 ? current - 1 : 0;
  availablePrizePool.push(type);
  shuffleArray(availablePrizePool);
  const info = prizeIndexMap.get(type);
  if (info) {
    setPrizeData(info.index, basicData.awardedCounts[type], {
      clearHighlight: true
    });
  }
}

function updateAllPrizeDisplays(highlightType) {
  prizes.forEach((prize, index) => {
    if (prize.type === defaultPrizeType) {
      return;
    }
    const awarded = basicData.awardedCounts[prize.type] || 0;
    setPrizeData(index, awarded, {
      highlight: prize.type === highlightType
    });
  });
}

function refreshCardLayout() {
  cardPrizeLayout = buildCardEntries();
  for (let i = 0; i < threeDCards.length; i++) {
    changeCard(i, cardPrizeLayout[i] || {});
  }
}

function ensureGestureControl() {
  if (gesturesReady) {
    return;
  }
  gesturesReady = true;
  initGestureStopper({
    onStop: () => {
      if (isLotting && Date.now() - spinStartedAt > MIN_SPIN_MS) {
        requestSmoothStop && requestSmoothStop();
        btns.lottery.innerHTML = "Начать розыгрыш";
      }
    },
    onSpin: () => {
      startLotteryFlow("gesture");
    }
  });
}

function startLotteryFlow(source = "button") {
  if (isLotting) {
    if (source === "gesture") {
      addQipao("Розыгрыш уже идёт, жест запуска пропущен.");
    }
    return;
  }

  const message =
    source === "gesture"
      ? "Жест распознан! Запускаем розыгрыш, удачи!"
      : "Запускаем случайный розыгрыш, удачи!";

  setQrVisibility(false);

  Promise.resolve(saveData()).then(() => {
    if (availablePrizePool.length === 0) {
      addQipao("Все призы уже разыграны!");
      setLotteryStatus(false);
      btns.lottery.innerHTML = "Начать розыгрыш";
      return;
    }

    if (btns.lotteryBar.classList.contains("none")) {
      removeHighlight();
      rotate = true;
      switchScreen("lottery");
    }

    setLotteryStatus(true);
    resetCard().then(() => {
      rotateScene = true;
      spinStartedAt = Date.now();
      lottery();
    });
    addQipao(message);
  });
}

/**
 * Инициализация DOM
 */
function initAll() {
  updateResponsiveLayout(true);
  window.AJAX({
    url: `${API_URL}/getTempData`,
    success(data) {
      // Получение базовых данных
      prizes = data.cfgData.prizes;
      HIGHLIGHT_CELL = createHighlight();
      basicData.prizes = prizes;
      setPrizes(prizes);

      TOTAL_CARDS = ROW_COUNT * COLUMN_COUNT;

      // Загрузка сохранённых результатов
      basicData.leftUsers = data.leftUsers || [];

      initialisePrizeState(data.luckyData || {});
      showPrizeList();
      updateAllPrizeDisplays();
      currentPrize = null;
      setQrVisibility(false);
    }
  });

  window.AJAX({
    url: `${API_URL}/getUsers`,
    success(data) {
      basicData.users = data;

      initCards();
      // startMaoPao();
      animate();
      shineCard();
    }
  });
}

function initCards() {
  cardPrizeLayout = buildCardEntries();

  let isBold = false,
    index = 0,
    position = {
      x: (140 * COLUMN_COUNT - 20) / 2,
      y: (180 * ROW_COUNT - 20) / 2
    };

  camera = new THREE.PerspectiveCamera(
    40,
    window.innerWidth / window.innerHeight,
    1,
    10000
  );
  camera.position.z = 3000;

  scene = new THREE.Scene();

  for (let i = 0; i < ROW_COUNT; i++) {
    for (let j = 0; j < COLUMN_COUNT; j++) {
      isBold = HIGHLIGHT_CELL.includes(j + "-" + i);
      var element = createCard(cardPrizeLayout[index] || {}, isBold, index);

      var object = new THREE.CSS3DObject(element);
      object.position.x = Math.random() * 4000 - 2000;
      object.position.y = Math.random() * 4000 - 2000;
      object.position.z = Math.random() * 4000 - 2000;
      scene.add(object);
      threeDCards.push(object);
      //

      var object = new THREE.Object3D();
      object.position.x = j * 140 - position.x;
      object.position.y = -(i * 180) + position.y;
      targets.table.push(object);
      index++;
    }
  }

  // sphere

  var vector = new THREE.Vector3();

  for (var i = 0, l = threeDCards.length; i < l; i++) {
    var phi = Math.acos(-1 + (2 * i) / l);
    var theta = Math.sqrt(l * Math.PI) * phi;
    var object = new THREE.Object3D();
    var positionVector = new THREE.Vector3();
    positionVector.setFromSphericalCoords(800 * Resolution, phi, theta);
    object.position.copy(positionVector);
    vector.copy(positionVector).multiplyScalar(2);
    object.lookAt(vector);
    targets.sphere.push(object);
  }

  updateSphereTargets();

  renderer = new THREE.CSS3DRenderer();
  renderer.setSize(window.innerWidth, window.innerHeight);
  document.getElementById("container").appendChild(renderer.domElement);

  //

  controls = new THREE.TrackballControls(camera, renderer.domElement);
  controls.rotateSpeed = 0.5;
  controls.minDistance = 500;
  controls.maxDistance = 6000;
  controls.addEventListener("change", render);

  bindEvent();
  ensureGestureControl();

  updateResponsiveLayout(true);

  switchScreen("enter");
}

function setLotteryStatus(status = false) {
  isLotting = status;
}

/**
 * Привязка событий
 */
function bindEvent() {
  document.querySelector("#menu").addEventListener("click", function (e) {
    e.stopPropagation();
    // Во время розыгрыша действия запрещены
    if (isLotting) {
      if (e.target.id === "lottery") {
        requestSmoothStop && requestSmoothStop();
        btns.lottery.innerHTML = "Начать розыгрыш";
      } else {
        addQipao("Идёт розыгрыш, подождите немного…");
      }
      return false;
    }

    let target = e.target.id;
    switch (target) {
      // Показать цифровую стену
      case "welcome":
        switchScreen("enter");
        rotate = false;
        break;
      // Перейти к розыгрышу
      case "enter":
        removeHighlight();
        addQipao("Скоро приступим к случайному розыгрышу, оставайтесь с нами.");
        // rotate = !rotate;
        rotate = true;
        switchScreen("lottery");
        setQrVisibility(false);
        break;
      // Сброс
      case "reset":
        let doREset = window.confirm(
          "Вы уверены, что хотите сбросить данные? Все текущие результаты будут очищены?"
        );
        if (!doREset) {
          return;
        }
        addQipao("Данные сброшены, начинаем заново");
        addHighlight();
        const resetAnimation = resetCard();
        // Сбросить все данные
        currentLuckys = [];
        selectedCardIndex = [];
        basicData.leftUsers = Object.assign([], basicData.users);
        basicData.luckyUsers = {};
        basicData.awardedCounts = {};
        initialisePrizeState({});
        Promise.resolve(resetAnimation).then(() => {
          refreshCardLayout();
        });
        currentPrize = null;

        resetPrize();
        updateAllPrizeDisplays();
        reset();
        setQrVisibility(false);
        switchScreen("enter");
        break;
      // Розыгрыш
      case "lottery":
        startLotteryFlow("button");
        break;
      // Переразыграть
      case "reLottery":
        if (currentLuckys.length === 0) {
          addQipao(`Ещё не было розыгрыша, переразыграть нельзя.`);
          return;
        }
        const lastRecord = currentLuckys[0];
        addQipao("Переразыгрываем приз, приготовьтесь");
        setLotteryStatus(true);
        resetCard().then(() => {
          if (lastRecord) {
            undoPrizeAward(lastRecord);
          }
          currentLuckys = [];
          selectedCardIndex = [];
          rotateScene = true;
          spinStartedAt = Date.now();
          lottery();
        });
        break;
      // Экспорт результатов
      case "save":
        saveData().then(res => {
          resetCard().then(res => {
            // Очистить предыдущие записи
            currentLuckys = [];
          });
          exportData();
          addQipao(`Данные сохранены в Excel.`);
        });
        break;
    }
  });

  window.addEventListener("resize", onWindowResize, false);
}

function switchScreen(type) {
  switch (type) {
    case "enter":
      setModeClass("table");
      setPrizeDisplayMode("compact");
      btns.enter.classList.remove("none");
      btns.lotteryBar.classList.add("none");
      addHighlight();
      transform(targets.table, 2000);
      updateLogoAlignment();
      break;
    default:
      removeHighlight();
      setModeClass("lottery");
      setPrizeDisplayMode("expanded");
      btns.enter.classList.add("none");
      btns.lotteryBar.classList.remove("none");
      transform(targets.sphere, 2000);
      updateLogoAlignment();
      break;
  }
}

/**
 * Создание элемента
 */
function createElement(css, text) {
  let dom = document.createElement("div");
  dom.className = css || "";
  dom.innerHTML = text || "";
  return dom;
}

/**
 * Создание карточки
 */
function createCard(entry, isBold, id) {
  var element = createElement();
  element.id = "card-" + id;

  const baseBackground = isBold ? HIGHLIGHT_BACKGROUND : getRandomCardBackground();
  element.dataset.baseBackground = baseBackground;
  element.style.background = baseBackground;

  if (isBold) {
    element.className = "element lightitem";
  } else {
    element.className = "element";
  }

  const label = entry && entry.label ? entry.label : "";
  setCardLabel(element, label);
  assignBaseOpacity(element, true);

  return element;
}

function removeHighlight() {
  document.querySelectorAll(".highlight").forEach(node => {
    node.classList.remove("highlight");
    const baseBackground = node.dataset.baseBackground;
    if (baseBackground) {
      node.style.background = baseBackground;
    } else {
      node.style.removeProperty("background");
    }
    node.style.removeProperty("borderColor");
    const baseOpacity = node.dataset.baseOpacity;
    if (Number.isFinite(Number(baseOpacity))) {
      node.style.opacity = baseOpacity;
    } else {
      node.style.removeProperty("opacity");
    }
    const nameEl = node.querySelector(".name");
    if (nameEl) {
      nameEl.style.removeProperty("color");
      nameEl.style.removeProperty("textShadow");
    }
    node
      .querySelectorAll(".company, .details")
      .forEach(el => el.style.removeProperty("color"));
    setCardSolidState(node, false);
  });
}

function addHighlight() {
  document.querySelectorAll(".lightitem").forEach(node => {
    node.classList.add("highlight");
    node.dataset.baseBackground = HIGHLIGHT_BACKGROUND;
    node.style.background = HIGHLIGHT_BACKGROUND;
    node.style.borderColor = "rgba(255, 128, 0, 0.75)";
    node.dataset.baseOpacity = "1";
    node.style.opacity = "1";
    const nameEl = node.querySelector(".name");
    if (nameEl) {
      nameEl.style.removeProperty("color");
      nameEl.style.removeProperty("textShadow");
    }
    node
      .querySelectorAll(".company, .details")
      .forEach(el => el.style.removeProperty("color"));
    setCardSolidState(node, true);
  });
}

function applyYear2026Class(root = document) {
  if (!root || typeof root.querySelectorAll !== "function") {
    return;
  }
  const elements = root.querySelectorAll("*:not(script):not(style)");
  elements.forEach(el => {
    if (!el || typeof el.textContent !== "string") {
      return;
    }
    const text = el.textContent.trim();
    if (text === YEAR_TEXT) {
      el.classList.add("year-2026");
    }
  });
}

function initYear2026Observer() {
  applyYear2026Class();
  const observer = new MutationObserver(mutations => {
    mutations.forEach(mutation => {
      if (mutation.type === "childList") {
        mutation.addedNodes.forEach(node => {
          if (node.nodeType === Node.ELEMENT_NODE) {
            applyYear2026Class(node);
          }
        });
      } else if (mutation.type === "characterData" && mutation.target.parentElement) {
        applyYear2026Class(mutation.target.parentElement);
      }
    });
  });
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true
  });
}

function getAlignmentTarget() {
  if (btns.enter && getComputedStyle(btns.enter).display !== "none") {
    return btns.enter;
  }
  if (btns.lottery && getComputedStyle(btns.lottery).display !== "none") {
    return btns.lottery;
  }
  const fallback = document.querySelector("#menu button:not(.none)");
  return fallback || btns.enter || btns.lottery;
}

function updateLogoAlignment() {
  if (!brandLogo) {
    brandLogo = document.querySelector(".brand-logo");
  }
  const target = getAlignmentTarget();
  if (!brandLogo || !target) {
    return;
  }
  const rect = target.getBoundingClientRect();
  if (!rect || !rect.width) {
    return;
  }
  const centerX = rect.left + rect.width / 2;
  window.requestAnimationFrame(() => {
    brandLogo.style.left = `${centerX}px`;
  });
}

/**
 * Рендер шара и прочего
 */
function transform(targets, duration) {
  // TWEEN.removeAll();
  for (var i = 0; i < threeDCards.length; i++) {
    var object = threeDCards[i];
    var target = targets[i];

    new TWEEN.Tween(object.position)
      .to(
        {
          x: target.position.x,
          y: target.position.y,
          z: target.position.z
        },
        Math.random() * duration + duration
      )
      .easing(TWEEN.Easing.Exponential.InOut)
      .start();

    new TWEEN.Tween(object.rotation)
      .to(
        {
          x: target.rotation.x,
          y: target.rotation.y,
          z: target.rotation.z
        },
        Math.random() * duration + duration
      )
      .easing(TWEEN.Easing.Exponential.InOut)
      .start();
  }

  new TWEEN.Tween(this)
    .to({}, duration * 2)
    .onUpdate(render)
    .start();
}

// function rotateBall() {
//   return new Promise((resolve, reject) => {
//     scene.rotation.y = 0;
//     new TWEEN.Tween(scene.rotation)
//       .to(
//         {
//           y: Math.PI * 8
//         },
//         ROTATE_TIME
//       )
//       .onUpdate(render)
//       .easing(TWEEN.Easing.Exponential.InOut)
//       .start()
//       .onComplete(() => {
//         resolve();
//       });
//   });
// }

function rotateBall() {
  return new Promise(resolve => {
    // Простое стабильное вращение за счёт рендера
    rotateScene = true;
    let stopped = false;
    spinBaseAngle = scene.rotation.y;

    // Плавная остановка к ближайшему полному обороту
    requestSmoothStop = () => {
      if (stopped) return;
      stopped = true;
      const twoPi = Math.PI * 2;
      const currentY = scene.rotation.y;
      const minDesired = spinBaseAngle + twoPi * MIN_AUTO_SPINS;
      const targetBase = Math.max(currentY, minDesired);
      const target = Math.ceil(targetBase / twoPi) * twoPi;
      rotateScene = false; // перестаём подкручивать сцену в animate()
      new TWEEN.Tween(scene.rotation)
        .to({ y: target }, 1000)
        .easing(TWEEN.Easing.Quadratic.Out)
        .onUpdate(render)
        .onComplete(() => {
          scene.rotation.y = target;
          resolve();
        })
        .start();
    };
  });
}

function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  updateResponsiveLayout();
  updateLogoAlignment();
  render();
}

function animate() {
  // Вращение сцены по оси X/Y
  if (rotateScene) {
    // fallback rotation to ensure visible motion even if tween is interrupted
    scene.rotation.y += SPIN_SPEED;
  }

  requestAnimationFrame(animate);
  TWEEN.update();
  controls.update();

  // Цикл рендеринга
  render();
}

function render() {
  renderer.render(scene, camera);
}

function selectCard(duration = 600, options = {}) {
  const { silent = false } = options;
  rotate = false;
  const locates = computeWinnerPositions();

  if (currentLuckys.length === 0) {
    setLotteryStatus();
    btns.lottery.innerHTML = "Начать розыгрыш";
    return;
  }

  const labels = currentLuckys.map(item => {
    if (!item) {
      return "";
    }
    if (item.label) {
      return item.label;
    }
    const info = prizeIndexMap.get(item.type);
    return (info && info.prize && info.prize.displayLabel) || "";
  });
  const shouldShowQr = labels.length > 0;
  if (shouldShowQr) {
    if (!silent) {
      addQipao(`Приз "${labels[0]}" нашёл своего победителя!`);
    }
    setQrVisibility(true);
  }

  let accentApplied = false;
  const sceneOffsetX = getSceneOffsetX();
  const centerBias = selectedCardIndex.length === 1 ? getWinnerCardOffsetX() : 0;
  selectedCardIndex.forEach((cardIndex, index) => {
    changeCard(cardIndex, currentLuckys[index], { isWinner: true });
    var object = threeDCards[cardIndex];
    if (object && object.element) {
      const accentColor = object.element.dataset.solidBackground;
      if (accentColor) {
        object.element.style.background = accentColor;
      }
    }
    const targetPosition = locates[index] || { x: 0, y: 0 };
    new TWEEN.Tween(object.position)
      .to(
        {
          x: targetPosition.x - sceneOffsetX + centerBias,
          y: targetPosition.y * Resolution,
          z: 2200
        },
        Math.random() * duration + duration
      )
      .easing(TWEEN.Easing.Exponential.InOut)
      .start();

    new TWEEN.Tween(object.rotation)
      .to(
        {
          x: 0,
          y: 0,
          z: 0
        },
        Math.random() * duration + duration
      )
      .easing(TWEEN.Easing.Exponential.InOut)
      .start();

    object.element.classList.add("prize");

    if (!accentApplied) {
      const accentColor = getCardAccentColor(object.element);
      if (accentColor) {
        applyQrAccent(accentColor);
        accentApplied = true;
      }
    }
  });

  new TWEEN.Tween(this)
    .to({}, duration * 2)
    .onUpdate(render)
    .start()
    .onComplete(() => {
      // После окончания анимации можно управлять
      setLotteryStatus();
      btns.lottery.innerHTML = "Начать розыгрыш";
      allowImmediateSpin();
    });
}

function getCardAccentColor(element) {
  if (!element) {
    return null;
  }
  const inlineBackground = element.style.background || element.style.backgroundImage;
  const computed = window.getComputedStyle(element);
  const backgroundSource = inlineBackground && inlineBackground !== "none"
    ? inlineBackground
    : computed.backgroundImage && computed.backgroundImage !== "none"
      ? computed.backgroundImage
      : computed.backgroundColor;
  return extractFirstColor(backgroundSource);
}

function extractFirstColor(source) {
  if (!source) {
    return null;
  }
  const colorMatch = source.match(/rgba?\([^()]+\)/i);
  if (colorMatch) {
    return colorMatch[0];
  }
  const hexMatch = source.match(/#(?:[0-9a-f]{3,8})/i);
  if (hexMatch) {
    return hexMatch[0];
  }
  return null;
}

function applyQrAccent(color) {
  if (!qrPlaceholderEl || !qrLabelEl || !color) {
    return;
  }
  qrPlaceholderEl.style.borderColor = color;
  qrLabelEl.style.color = color;
  const neon = buildNeonShadow(color);
  if (neon) {
    qrLabelEl.style.textShadow = neon;
  }
}

function buildNeonShadow(color) {
  const rgb = parseColor(color);
  if (!rgb) {
    return null;
  }
  const { r, g, b } = rgb;
  return `0 0 12px rgba(${r}, ${g}, ${b}, 0.78), 0 0 24px rgba(${r}, ${g}, ${b}, 0.55), 0 0 40px rgba(${r}, ${g}, ${b}, 0.45)`;
}

function parseColor(color) {
  if (!color) {
    return null;
  }
  const rgbaMatch = color.match(/rgba?\(([^)]+)\)/i);
  if (rgbaMatch) {
    const parts = rgbaMatch[1].split(",").map(part => part.trim());
    const r = parseFloat(parts[0]);
    const g = parseFloat(parts[1]);
    const b = parseFloat(parts[2]);
    return Number.isFinite(r) && Number.isFinite(g) && Number.isFinite(b)
      ? { r, g, b }
      : null;
  }
  if (color.startsWith("#")) {
    let hex = color.slice(1);
    if (hex.length === 3) {
      hex = hex.split("").map(char => char + char).join("");
    }
    if (hex.length !== 6) {
      return null;
    }
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    if ([r, g, b].some(value => Number.isNaN(value))) {
      return null;
    }
    return { r, g, b };
  }
  return null;
}

/**
 * Сброс содержимого карточек
 */
function resetCard(duration = 500) {
  const revertIndices =
    selectedCardIndex.length > 0
      ? Array.from(selectedCardIndex)
      : threeDCards.map((_, idx) => idx);

  if (currentLuckys.length > 0) {
    selectedCardIndex.forEach(index => {
      let object = threeDCards[index],
        target = targets.sphere[index];

      new TWEEN.Tween(object.position)
        .to(
          {
            x: target.position.x,
            y: target.position.y,
            z: target.position.z
          },
          Math.random() * duration + duration
        )
        .easing(TWEEN.Easing.Exponential.InOut)
        .start();

      new TWEEN.Tween(object.rotation)
        .to(
          {
            x: target.rotation.x,
            y: target.rotation.y,
            z: target.rotation.z
          },
          Math.random() * duration + duration
        )
        .easing(TWEEN.Easing.Exponential.InOut)
        .start();
    });
  }

  if (currentLuckys.length === 0) {
    duration = 0;
  }

  return new Promise((resolve, reject) => {
    new TWEEN.Tween(this)
      .to({}, duration * 2)
      .onUpdate(render)
      .start()
      .onComplete(() => {
        revertIndices.forEach(index => {
          const object = threeDCards[index];
          clearPrizeCardSize(object.element);
          object.element.classList.remove("prize", "prize-note", "card-solid");
          changeCard(index, cardPrizeLayout[index] || {});
        });
        selectedCardIndex = [];
        setQrVisibility(false);
        resolve();
      });
  });
}

/**
 * Розыгрыш
 */
function lottery() {
  btns.lottery.innerHTML = "Закончить розыгрыш";
  rotateBall().then(() => {
    currentLuckys = [];
    selectedCardIndex = [];

    const prizeRecord = drawPrizeFromPool();
    if (!prizeRecord) {
      addQipao("Все призы уже разыграны!");
      setLotteryStatus(false);
      btns.lottery.innerHTML = "Начать розыгрыш";
      setQrVisibility(false);
      return;
    }

    const prizeInfo = prizeIndexMap.get(prizeRecord.type);
    currentPrize = prizeInfo ? prizeInfo.prize : null;

    markPrizeAwarded(prizeRecord, { highlight: true });

    let cardIndex = random(TOTAL_CARDS);
    while (selectedCardIndex.includes(cardIndex)) {
      cardIndex = random(TOTAL_CARDS);
    }
    selectedCardIndex.push(cardIndex);

    currentLuckys = [
      Object.assign({}, prizeRecord, {
        cardIndex
      })
    ];

    selectCard();
  });
}

/**
 * Сохранить предыдущий результат
 */
function saveData() {
  if (!currentLuckys.length) {
    return Promise.resolve();
  }

  const record = currentLuckys[0];
  if (!record || typeof record.type === "undefined") {
    return Promise.resolve();
  }

  const type = record.type;
  const key = String(type);
  const curLucky = basicData.luckyUsers[key] || [];
  basicData.luckyUsers[key] = curLucky.concat(record);

  return setData(type, [record]);
}

/**
 * Случайный выбор
 */
function random(num) {
  // Равномерное распределение чисел 0..num-1
  return Math.floor(Math.random() * num);
}

/**
 * Смена данных на карточке
 */
function changeCard(cardIndex, entry = {}, options = {}) {
  const cardObj = threeDCards[cardIndex];
  if (!cardObj || !cardObj.element) {
    return;
  }
  const label = entry && entry.label ? entry.label : "";

  setCardLabel(cardObj.element, label, options);

  const isWinner = !!options.isWinner;
  cardObj.element.classList.toggle("prize-note", isWinner);
  setCardSolidState(cardObj.element, isWinner);
}

/**
 * Смена фона карточки
 */
function shine(cardIndex, color) {
  let card = threeDCards[cardIndex].element;
  const nextBackground = color || getRandomCardBackground();
  card.dataset.baseBackground = nextBackground;
  card.style.background = nextBackground;
  setCardSolidState(card, false);
}

/**
 * Случайная смена фона и данных
 */
function shineCard() {
  let maxCard = 10,
    shineCard = 10 + random(maxCard);

  setInterval(() => {
    // Во время розыгрыша останавливаем мигание
    if (isLotting) {
      return;
    }
    for (let i = 0; i < shineCard; i++) {
      let cardIndex = random(TOTAL_CARDS);
      // Не менять случайно уже показанные карточки победителей
      if (selectedCardIndex.includes(cardIndex)) {
        continue;
      }
      const cardObject = threeDCards[cardIndex];
      if (!cardObject || !cardObject.element) {
        continue;
      }
      if (cardObject.element.classList.contains("lightitem")) {
        continue;
      }
      shine(cardIndex);
      changeCard(cardIndex, cardPrizeLayout[cardIndex] || {});
    }
  }, 500);
}

function setData(type, data) {
  return new Promise((resolve, reject) => {
    window.AJAX({
      url: `${API_URL}/saveData`,
      data: {
        type,
        data
      },
      success() {
        resolve();
      },
      error() {
        reject();
      }
    });
  });
}

function setErrorData(data) {
  return new Promise((resolve, reject) => {
    window.AJAX({
      url: `${API_URL}/errorData`,
      data: {
        data
      },
      success() {
        resolve();
      },
      error() {
        reject();
      }
    });
  });
}

function exportData() {
  window.AJAX({
    url: `${API_URL}/export`,
    success(data) {
      if (data.type === "success") {
        location.href = data.url;
      }
    }
  });
}

function reset() {
  window.AJAX({
    url: `${API_URL}/reset`,
    success(data) {
      console.log("Сброс выполнен");
    }
  });
}

function createHighlight() {
  let year = String(DISPLAY_YEAR);
  let step = 4,
    xoffset = 1,
    yoffset = 1,
    highlight = [];

  year.split("").forEach(n => {
    highlight = highlight.concat(
      NUMBER_MATRIX[n].map(item => {
        return `${item[0] + xoffset}-${item[1] + yoffset}`;
      })
    );
    xoffset += step;
  });

  return highlight;
}

let onload = window.onload;

window.onload = function () {
  onload && onload();
  initYear2026Observer();
  updateLogoAlignment();

  let music = document.querySelector("#music");

  let rotated = 0,
    stopAnimate = false,
    musicBox = document.querySelector("#musicBox");

  function animate() {
    requestAnimationFrame(function () {
      if (stopAnimate) {
        return;
      }
      rotated = rotated % 360;
      musicBox.style.transform = "rotate(" + rotated + "deg)";
      rotated += 1;
      animate();
    });
  }

  musicBox.addEventListener(
    "click",
    function (e) {
      if (music.paused) {
        music.play().then(
          () => {
            stopAnimate = false;
            animate();
          },
          () => {
            addQipao("Не удалось автоматически запустить музыку. Запустите вручную!");
          }
        );
      } else {
        music.pause();
        stopAnimate = true;
      }
    },
    false
  );

  setTimeout(function () {
    musicBox.click();
  }, 1000);

  console.log("🔥 FRONTEND INDEX.JS LOADED 🔥");

};
