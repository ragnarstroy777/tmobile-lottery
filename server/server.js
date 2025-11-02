// server/server.js
const express = require("express");
const opn = require("opn");
const bodyParser = require("body-parser");
const path = require("path");
const chokidar = require("chokidar");
const cors = require("cors");
const cfg = require("./config");

const {
  loadXML,
  loadTempData,
  writeXML,
  saveDataFile,
  shuffle,
  saveErrorDataFile
} = require("./help");

// ---- safety logs
process.on("uncaughtException", err => {
  console.error("❌ Uncaught Exception:", err);
});
process.on("unhandledRejection", err => {
  console.error("❌ Unhandled Promise Rejection:", err);
});

// ---- app & state
const app = express();
const router = express.Router();
const cwd = process.cwd();
const dataBath = __dirname; // (не используется, но оставил)
let port = 8090;
let curData = {};
let luckyData = {};
let errorData = [];
const defaultType = cfg.prizes[0]["type"];
const defaultPage = `default data`;

// ---- CORS: обязательно раньше любых роутов
app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST", "OPTIONS", "PUT", "DELETE"],
    allowedHeaders: ["Origin", "X-Requested-With", "Content-Type", "Accept"]
  })
);

// ---- body parsers
app.use(bodyParser.json({ limit: "1mb" }));
app.use(bodyParser.urlencoded({ extended: true }));

// ---- cli port override
if (process.argv.length > 2) {
  port = process.argv[2];
}

// ---- static
app.use(express.static(cwd));

// ---- root -> index.html
app.get("/", (req, res) => {
  res.redirect(301, "index.html");
});

// ---- simple logger for POST
app.post(/.*/, (req, res, next) => {
  console.log(`Запрос: ${req.path}`);
  next();
});

// ===== API =====

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
  log(`Сброс данных выполнен`);
  saveErrorDataFile(errorData);
  saveDataFile(luckyData).then(() => {
    res.json({ type: "success" });
  });
});

// пользователи
router.post("/getUsers", (req, res) => {
  res.json(curData.users);
  log(`Отправлены данные пользователей для розыгрыша`);
});

// призы (сейчас только лог)
router.post("/getPrizes", (req, res) => {
  log(`Отправлены данные о призах`);
  res.json({ ok: true });
});

// сохранить результаты розыгрыша
router.post("/saveData", (req, res) => {
  const data = req.body;
  setLucky(data.type, data.data)
    .then(() => {
      res.json({ type: "success" });
      log(`Данные о призах сохранены`);
    })
    .catch(() => {
      res.json({ type: "error" });
      log(`Не удалось сохранить данные о призах`);
    });
});

// сохранить отсутствующих
router.post("/errorData", (req, res) => {
  const data = req.body;
  setErrorData(data.data)
    .then(() => {
      res.json({ type: "success" });
      log(`Список отсутствующих участников сохранён`);
    })
    .catch(() => {
      res.json({ type: "error" });
      log(`Не удалось сохранить список отсутствующих участников`);
    });
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
    .then(() => {
      res.status(200).json({
        type: "success",
        url: "results.xlsx"
      });
      log(`Экспорт данных выполнен успешно`);
    })
    .catch(err => {
      res.status(500).json({
        type: "error",
        error: err.message || err
      });
      log(`Ошибка экспорта данных: ${err && err.message}`);
    });
});

// Serve frontend
app.use(express.static(path.join(__dirname, "../product/src")));
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "../product/src/index.html"));
});

// fallback для прочих путей
router.all(/.*/, (req, res) => {
  if (req.method.toLowerCase() === "get") {
    if (/\.(html|htm)/.test(req.originalUrl)) {
      res.set("Content-Type", "text/html");
      res.send(defaultPage);
    } else {
      res.status(404).end();
    }
  } else if (req.method.toLowerCase() === "post") {
    res.json({ error: "empty" });
  }
});

// ==== helpers ====
function log(text) {
  console.log(text);
  console.log("-----------------------------------------------");
}

function setLucky(type, data) {
  if (luckyData[type]) {
    luckyData[type] = luckyData[type].concat(data);
  } else {
    luckyData[type] = Array.isArray(data) ? data : [data];
  }
  return saveDataFile(luckyData);
}

function setErrorData(data) {
  errorData = errorData.concat(data);
  return saveErrorDataFile(errorData);
}

app.use(router);

function loadData() {
  console.log("Загрузка файла данных Excel");
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

loadData();

// ping
app.get("/ping", (req, res) => {
  res.json({ status: "ok", message: "pong 🏓" });
});

// ---- serve frontend
app.use(express.static(path.join(__dirname, "../product/src")));
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "../product/src/index.html"));
});

// ==== запуск на Render/проде ====
const PORT = process.env.PORT || 10000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ Server running on port ${PORT}`);
});

