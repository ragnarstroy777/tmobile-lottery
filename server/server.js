const express = require("express");
const opn = require("opn");
const bodyParser = require("body-parser");
const path = require("path");
const chokidar = require("chokidar");
const cfg = require("./config");

const {
  loadXML,
  loadTempData,
  writeXML,
  saveDataFile,
  shuffle,
  saveErrorDataFile
} = require("./help");

process.on("uncaughtException", err => {
  console.error("❌ Uncaught Exception:", err);
});

process.on("unhandledRejection", err => {
  console.error("❌ Unhandled Promise Rejection:", err);
});

let app = express(),
  router = express.Router(),
  cwd = process.cwd(),
  dataBath = __dirname,
  port = 8090,
  curData = {},
  luckyData = {},
  errorData = [],
  defaultType = cfg.prizes[0]["type"],
  defaultPage = `default data`;

// Используем формат JSON для параметров
app.use(
  bodyParser.json({
    limit: "1mb"
  })
);

app.use(
  bodyParser.urlencoded({
    extended: true
  })
);

if (process.argv.length > 2) {
  port = process.argv[2];
}

app.use(express.static(cwd));

// Пустой путь: перенаправление на index.html
app.get("/", (req, res) => {
  res.redirect(301, "index.html");
});

// Разрешаем CORS
app.use((req, res, next) => {
  console.log(`Запрос: ${req.path}`);
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS, PUT, DELETE");
  res.header("X-Powered-By", "3.2.1");
  res.header("Content-Type", "application/json;charset=utf-8");
  next();
});



app.post(/.*/, (req, res, next) => {
  console.log(`Запрос: ${req.path}`);
  next();
});


// Получить ранее сохранённые данные
router.post("/getTempData", (req, res, next) => {
  getLeftUsers();
  res.json({
    cfgData: cfg,
    leftUsers: curData.leftUsers,
    luckyData: luckyData
  });
});

// Сбросить данные
router.post("/reset", (req, res, next) => {
  luckyData = {};
  errorData = [];
  log(`Сброс данных выполнен`);
  saveErrorDataFile(errorData);
  return saveDataFile(luckyData).then(data => {
    res.json({
      type: "success"
    });
  });
});

// Получить всех пользователей
router.post("/getUsers", (req, res, next) => {
  res.json(curData.users);
  log(`Отправлены данные пользователей для розыгрыша`);
});

// Получить информацию о призах
router.post("/getPrizes", (req, res, next) => {
  // res.json(curData.prize);
  log(`Отправлены данные о призах`);
});

// Сохранить данные розыгрыша
router.post("/saveData", (req, res, next) => {
  let data = req.body;
  setLucky(data.type, data.data)
    .then(t => {
      res.json({
        type: "success"
      });
      log(`Данные о призах сохранены`);
    })
    .catch(data => {
      res.json({
        type: "error"
      });
      log(`Не удалось сохранить данные о призах`);
    });
});

// Сохранить данные об отсутствующих участниках
router.post("/errorData", (req, res, next) => {
  let data = req.body;
  setErrorData(data.data)
    .then(t => {
      res.json({
        type: "success"
      });
      log(`Список отсутствующих участников сохранён`);
    })
    .catch(data => {
      res.json({
        type: "error"
      });
      log(`Не удалось сохранить список отсутствующих участников`);
    });
});

// Экспорт данных в Excel
router.post("/export", (req, res, next) => {
  let outData = [["Приз", "Описание", "Дата"]];
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
        const ts = record.timestamp
          ? new Date(record.timestamp).toLocaleString()
          : "";
        outData.push([prizeName, label, ts]);
      } else {
        outData.push([prizeName, String(record || ""), ""]);
      }
    });
  });

  writeXML(outData, "/results.xlsx")
    .then(dt => {
      // res.download('/results.xlsx');
      res.status(200).json({
        type: "success",
        url: "results.xlsx"
      });
      log(`Экспорт данных выполнен успешно`);
    })
    .catch(err => {
      res.json({
        type: "error",
        error: err.error
      });
      log(`Ошибка экспорта данных`);
    });
});

// Для непопадающих под маршруты запросов возвращаем дефолтную страницу
// Разные ответы для GET/POST
router.all(/.*/, (req, res) => {
  if (req.method.toLowerCase() === "get") {
    if (/\.(html|htm)/.test(req.originalUrl)) {
      res.set("Content-Type", "text/html");
      res.send(defaultPage);
    } else {
      res.status(404).end();
    }
  } else if (req.method.toLowerCase() === "post") {
    let postBackData = {
      error: "empty"
    };
    res.send(JSON.stringify(postBackData));
  }
});


function log(text) {
  global.console.log(text);
  global.console.log("-----------------------------------------------");
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
  let cfgData = {};

try {
  curData.users = loadXML(path.join(__dirname, "data", "users.xlsx"));
  shuffle(curData.users);
  console.log("✅ Users loaded from Excel");
} catch (e) {
  curData.users = [];
  console.error("❌ Ошибка загрузки users.xlsx:", e.message);
}


  // Загрузить ранее разыгранные результаты
  loadTempData()
    .then(data => {
      luckyData = data[0];
      errorData = data[1];
    })
    .catch(data => {
      curData.leftUsers = Object.assign([], curData.users);
    });
}

function getLeftUsers() {
  // Отметить уже разыгранных пользователей
  let lotteredUser = {};
  for (let key in luckyData) {
    let luckys = luckyData[key];
    luckys.forEach(item => {
      if (Array.isArray(item)) {
        lotteredUser[item[0]] = true;
      }
    });
  }
  // Отметить отсутствующих пользователей
  errorData.forEach(item => {
    if (Array.isArray(item)) {
      lotteredUser[item[0]] = true;
    }
  });

  let leftUsers = Object.assign([], curData.users);
  leftUsers = leftUsers.filter(user => {
    return !lotteredUser[user[0]];
  });
  curData.leftUsers = leftUsers;
}

loadData();

app.get('/ping', (req, res) => {
  res.json({ status: 'ok', message: 'pong 🏓' });
});

module.exports = {
  run: function(devPort, noOpen) {
    let openBrowser = true;
    if (process.argv.length > 3) {
      if (process.argv[3] && (process.argv[3] + "").toLowerCase() === "n") {
        openBrowser = false;
      }
    }

    if (noOpen) {
      openBrowser = noOpen !== "n";
    }

    if (devPort) {
      port = devPort;
    }

    let server = app.listen(port, () => {
      let host = server.address().address;
      let port = server.address().port;
      global.console.log(`lottery server listenig at http://${host}:${port}`);
      openBrowser && opn(`http://127.0.0.1:${port}`);
    });
  }
};

// --- keep server alive for Render ---
const PORT = process.env.PORT || 8888;
app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});
