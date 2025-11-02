// server/server.js
const express = require("express");
const bodyParser = require("body-parser");
const path = require("path");
const cors = require("cors");
const mime = require("mime"); // npm i mime
const cfg = require("./config");

const {
  loadXML,
  loadTempData,
  writeXML,
  saveDataFile,
  shuffle,
  saveErrorDataFile
} = require("./help");

// ---- Safety logs ----
process.on("uncaughtException", err => console.error("❌ Uncaught Exception:", err));
process.on("unhandledRejection", err => console.error("❌ Unhandled Promise Rejection:", err));

// ---- Express setup ----
const app = express();
const router = express.Router();
let curData = {};
let luckyData = {};
let errorData = [];
const defaultType = cfg.prizes[0]["type"];
const defaultPage = "default data";

// ---- CORS ----
app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST", "OPTIONS", "PUT", "DELETE"],
    allowedHeaders: ["Origin", "X-Requested-With", "Content-Type", "Accept"]
  })
);

// ---- Body parsers ----
app.use(bodyParser.json({ limit: "2mb" }));
app.use(bodyParser.urlencoded({ extended: true }));

// ---- Simple logger for POST ----
app.post(/.*/, (req, res, next) => {
  console.log(`📩 POST ${req.path}`);
  next();
});

// ==== API ====

// вернуть ранее сохранённые данные
router.post("/getTempData", (req, res) => {
  getLeftUsers();
  res.json({
    cfgData: cfg,
    leftUsers: curData.leftUsers,
    luckyData: luckyData
  });
});

// сброс
router.post("/reset", (req, res) => {
  luckyData = {};
  errorData = [];
  saveErrorDataFile(errorData);
  saveDataFile(luckyData).then(() => {
    res.json({ type: "success" });
  });
});

// пользователи
router.post("/getUsers", (req, res) => {
  res.json(curData.users);
});

// призы
router.post("/getPrizes", (req, res) => {
  res.json({ ok: true });
});

// сохранить результаты розыгрыша
router.post("/saveData", (req, res) => {
  const data = req.body;
  setLucky(data.type, data.data)
    .then(() => res.json({ type: "success" }))
    .catch(() => res.json({ type: "error" }));
});

// сохранить отсутствующих
router.post("/errorData", (req, res) => {
  const data = req.body;
  setErrorData(data.data)
    .then(() => res.json({ type: "success" }))
    .catch(() => res.json({ type: "error" }));
});

// экспорт в Excel
router.post("/export", (req, res) => {
  const outData = [["Приз", "Описание", "Дата"]];
  cfg.prizes.forEach(item => {
    const prizeName = item.text || "";
    outData.push([prizeName, "", ""]);
    const records = luckyData[item.type] || [];
    records.forEach(record => {
      if (Array.isArray(record)) {
        const [, name, extra] = record;
        outData.push([prizeName, name || record[0] || "", extra || ""]);
      } else if (record && typeof record === "object") {
        const label = record.label || "";
        const ts = record.timestamp ? new Date(record.timestamp).toLocaleString() : "";
        outData.push([prizeName, label, ts]);
      } else {
        outData.push([prizeName, String(record || ""), ""]);
      }
    });
  });

  writeXML(outData, "/results.xlsx")
    .then(() => res.status(200).json({ type: "success", url: "results.xlsx" }))
    .catch(err => res.status(500).json({ type: "error", error: err.message || err }));
});

// fallback для прочих путей API
router.all(/.*/, (req, res) => {
  if (req.method.toLowerCase() === "post") res.json({ error: "empty" });
  else res.status(404).end();
});

app.use(router);

// ==== Helpers ====
function setLucky(type, data) {
  if (luckyData[type]) luckyData[type] = luckyData[type].concat(data);
  else luckyData[type] = Array.isArray(data) ? data : [data];
  return saveDataFile(luckyData);
}

function setErrorData(data) {
  errorData = errorData.concat(data);
  return saveErrorDataFile(errorData);
}

function loadData() {
  console.log("📘 Загрузка файла данных Excel...");
  try {
    curData.users = loadXML(path.join(__dirname, "data", "users.xlsx"));
    shuffle(curData.users);
    console.log("✅ Users loaded from Excel");
  } catch (e) {
    curData.users = [];
    console.error("❌ Ошибка загрузки users.xlsx:", e.message);
  }

  loadTempData()
    .then(data => {
      luckyData = data[0];
      errorData = data[1];
    })
    .catch(() => {
      curData.leftUsers = Object.assign([], curData.users);
    });
}

function getLeftUsers() {
  const lotteredUser = {};
  for (const key in luckyData) {
    (luckyData[key] || []).forEach(item => {
      if (Array.isArray(item)) lotteredUser[item[0]] = true;
    });
  }
  errorData.forEach(item => {
    if (Array.isArray(item)) lotteredUser[item[0]] = true;
  });

  let leftUsers = Object.assign([], curData.users);
  leftUsers = leftUsers.filter(user => !lotteredUser[user[0]]);
  curData.leftUsers = leftUsers;
}

// ---- Load data ----
loadData();

// ---- Ping ----
app.get("/ping", (req, res) => res.json({ status: "ok", message: "pong 🏓" }));

// ---- Static frontend ----
const staticPath = path.join(__dirname, "../product/src");
app.use(
  express.static(staticPath, {
    setHeaders: (res, filePath) => {
      const type = mime.getType(filePath);
      if (type) res.setHeader("Content-Type", type);
    }
  })
);

// ---- Главная страница ----
app.get("/", (req, res) => {
  res.sendFile(path.join(staticPath, "index.html"));
});

// ---- Catch-all для любых путей фронта ----
app.get("*", (req, res) => {
  res.sendFile(path.join(staticPath, "index.html"));
});

// ---- Запуск на Render ----
const PORT = process.env.PORT || 10000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ Server running on port ${PORT}`);
});
