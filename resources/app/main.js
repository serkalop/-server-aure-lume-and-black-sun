const { app, BrowserWindow, shell, clipboard, ipcMain, dialog } = require("electron");
const path = require("path");
const fs = require("fs");
const { launchMinecraft } = require("./mc-launcher");
const detect = require("./mc-detect");
const { installVersion, downloadJava } = require("./mc-install");
const { applyModpack } = require("./mc-modpack");
const cfg = require("./game-config");
const http = require("http");
const https = require("https");

let mainWindow = null;

app.disableHardwareAcceleration();

// Публичная ссылка на сборку (моды/шейдеры/ресурспаки/конфиги) с Яндекс.Диска
const MODPACK_URL = "https://disk.yandex.ru/d/Hte7sXScuPtqpA";

// ---------- Auth API сайта (через хостинг, обход CORS) ----------
// webtm.ru не требует HTTP Basic Auth. Токен приложения передаём в теле запроса.
const AUTH_API = "http://playmyrealserver9.webtm.ru/api/auth.php";

function authRequest(action, payload, token) {
  return new Promise((resolve) => {
    const merged = Object.assign({}, payload || {}, token ? { token } : {});
    const body = JSON.stringify(merged);
    const url = AUTH_API + "?action=" + encodeURIComponent(action);
    const transport = url.indexOf("https://") === 0 ? https : http;
    const req = transport.request(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body)
      },
      timeout: 15000
    }, (res) => {
      let data = "";
      res.on("data", (c) => data += c);
      res.on("end", () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch (e) { resolve({ status: res.statusCode, body: { status: "error", message: data.slice(0, 200) } }); }
      });
    });
    req.on("error", (e) => resolve({ status: 0, body: { status: "error", message: e.message } }));
    req.on("timeout", () => { req.destroy(); resolve({ status: 0, body: { status: "error", message: "Таймаут соединения" } }); });
    req.write(body);
    req.end();
  });
}

// Загрузка аватара: отправляет FormData (файл + токен) multipart/form-data на auth.php?action=upload_avatar
async function uploadAvatarFromRenderer(formData) {
  const token = readToken();
  if (!token) return { status: 401, body: { status: "error", message: "Не авторизован" } };
  return new Promise((resolve) => {
    let file = null;
    try { file = formData.get("avatar"); } catch (e) {}
    if (!file) return resolve({ status: 400, body: { status: "error", message: "Файл не выбран" } });
    const boundary = "----multibot" + Date.now();
    const chunks = [];
    const head = Buffer.from(
      "--" + boundary + "\r\n" +
      'Content-Disposition: form-data; name="token"\r\n\r\n' + token + "\r\n" +
      "--" + boundary + "\r\n" +
      'Content-Disposition: form-data; name="avatar"; filename="' + (file.name || "avatar.png").replace(/[\\"]/g, "_") + '"\r\n' +
      "Content-Type: application/octet-stream\r\n\r\n"
    );
    const tail = Buffer.from("\r\n--" + boundary + "--\r\n");
    chunks.push(head);
    chunks.push(Buffer.isBuffer(file.buffer) ? file.buffer : Buffer.from(file.buffer || []));
    chunks.push(tail);
    const body = Buffer.concat(chunks);
    const url = AUTH_API + "?action=upload_avatar";
    const transport = url.indexOf("https://") === 0 ? https : http;
    const req = transport.request(url, {
      method: "POST",
      headers: {
        "Content-Type": "multipart/form-data; boundary=" + boundary,
        "Content-Length": body.length
      },
      timeout: 20000
    }, (res) => {
      let data = "";
      res.on("data", (c) => data += c);
      res.on("end", () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch (e) { resolve({ status: res.statusCode, body: { status: "error", message: data.slice(0, 200) } }); }
      });
    });
    req.on("error", (e) => resolve({ status: 0, body: { status: "error", message: e.message } }));
    req.on("timeout", () => { req.destroy(); resolve({ status: 0, body: { status: "error", message: "Таймаут соединения" } }); });
    req.end(body);
  });
}

// Загрузка скина Minecraft (PNG 64x64) — multipart/form-data на auth.php?action=upload_skin
async function uploadSkinFromRenderer(formData) {
  const token = readToken();
  if (!token) return { status: 401, body: { status: "error", message: "Не авторизован" } };
  return new Promise((resolve) => {
    let file = null;
    try { file = formData.get("skin"); } catch (e) {}
    if (!file) return resolve({ status: 400, body: { status: "error", message: "Файл не выбран" } });
    const boundary = "----multibot" + Date.now();
    const chunks = [];
    const head = Buffer.from(
      "--" + boundary + "\r\n" +
      'Content-Disposition: form-data; name="token"\r\n\r\n' + token + "\r\n" +
      "--" + boundary + "\r\n" +
      'Content-Disposition: form-data; name="skin"; filename="' + (file.name || "skin.png").replace(/[\\"]/g, "_") + '"\r\n' +
      "Content-Type: application/octet-stream\r\n\r\n"
    );
    const tail = Buffer.from("\r\n--" + boundary + "--\r\n");
    chunks.push(head);
    chunks.push(Buffer.isBuffer(file.buffer) ? file.buffer : Buffer.from(file.buffer || []));
    chunks.push(tail);
    const body = Buffer.concat(chunks);
    const url = AUTH_API + "?action=upload_skin";
    const transport = url.indexOf("https://") === 0 ? https : http;
    const req = transport.request(url, {
      method: "POST",
      headers: {
        "Content-Type": "multipart/form-data; boundary=" + boundary,
        "Content-Length": body.length
      },
      timeout: 20000
    }, (res) => {
      let data = "";
      res.on("data", (c) => data += c);
      res.on("end", () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch (e) { resolve({ status: res.statusCode, body: { status: "error", message: data.slice(0, 200) } }); }
      });
    });
    req.on("error", (e) => resolve({ status: 0, body: { status: "error", message: e.message } }));
    req.on("timeout", () => { req.destroy(); resolve({ status: 0, body: { status: "error", message: "Таймаут соединения" } }); });
    req.end(body);
  });
}

// Сохранение/чтение токена авторизации (в настройках приложения)
function readToken() { return readSettings().authToken || ""; }
function writeToken(t) { const s = readSettings(); s.authToken = t || ""; writeSettings(s); }

// ---------- настройки пользователя (путь к игре, версия, java) ----------
function settingsFile() {
  return path.join(app.getPath("userData"), "settings.json");
}

function readSettings() {
  try {
    return JSON.parse(fs.readFileSync(settingsFile(), "utf8")) || {};
  } catch (e) {
    return {};
  }
}

function writeSettings(s) {
  try {
    fs.writeFileSync(settingsFile(), JSON.stringify(s, null, 2), "utf8");
  } catch (e) { /* ignore */ }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 800,
    minWidth: 400,
    minHeight: 600,
    autoHideMenuBar: true,
    backgroundColor: "#080d1b",
    title: "Aure Lume and Black Sun — Minecraft",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, "preload.js")
    }
  });

  mainWindow.loadFile(path.join(__dirname, "app", "index.html"));

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) {
      shell.openExternal(url);
    }
    return { action: "deny" };
  });

  mainWindow.webContents.on("console-message", (event, level, message, line, sourceId) => {
    try {
      fs.appendFileSync(
        path.join(__dirname, "renderer-logs.txt"),
        "[" + level + "] " + message + " (" + sourceId + ":" + line + ")\n"
      );
    } catch (e) { /* ignore */ }
  });

  mainWindow.webContents.on("render-process-gone", (event, details) => {
    try {
      fs.appendFileSync(
        path.join(__dirname, "renderer-logs.txt"),
        "RENDER GONE: " + details.reason + "\n"
      );
    } catch (e) { /* ignore */ }
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  // При первом запуске гарантированно создаём каталог лаунчера и вложенные
  // папки игры (в %APPDATA%\Roaming\Lord of the games\minecraft). Туда же
  // при установке лягут версии, библиотеки, моды и т.д.
  try {
    const lg = detect.launcherGamesDir();
    fs.mkdirSync(path.join(lg, "versions"), { recursive: true });
  } catch (e) { /* каталог создастся позже при установке */ }

  // Состояние: определяем игру/версии/java и подмешиваем сохранённые настройки
  ipcMain.handle("get-launch-state", async () => {
    const settings = readSettings();
    // игра всегда берётся из папки приложения (minecraft рядом с EXE),
    // внешние каталоги/лаунчеры не сканируются.
    const lg = detect.launcherGamesDir();
    const found = detect.detectMinecraft();
    const versions = found ? found.versions : [];

    let gamesDir = lg || (found && found.dir) || "";
    let version = settings.version || "";
    if (version && versions.indexOf(version) === -1) version = "";

    let javaPath = settings.javaPath || "";
    // валидность сохранённой java
    if (javaPath && !fs.existsSync(javaPath)) javaPath = "";

    return {
      gamesDir,
      version,
      versions,
      javaPath,
      autoFound: found ? found.dir : null,
      javaFound: !!javaPath,
      configVersion: cfg.MINECRAFT_VERSION
    };
  });

  ipcMain.handle("save-launch-settings", (event, payload) => {
    let data = {};
    try { data = JSON.parse(payload || "{}"); } catch (e) { return { ok: false }; }
    const s = readSettings();
    if (typeof data.gamesDir === "string") s.gamesDir = data.gamesDir;
    if (typeof data.version === "string") s.version = data.version;
    if (typeof data.javaPath === "string") s.javaPath = data.javaPath;
    if (typeof data.ram === "string") s.ram = data.ram;
    writeSettings(s);
    return { ok: true };
  });

  // ---------- Auth IPC ----------
  ipcMain.handle("auth-login", async (event, payload) => {
    let d = {};
    try { d = JSON.parse(payload || "{}"); } catch (e) {}
    const res = await authRequest("login", { username: d.username, password: d.password, want_token: true });
    if (res.status === 200 && res.body && res.body.token) writeToken(res.body.token);
    return { status: res.status, body: res.body };
  });

  ipcMain.handle("auth-register", async (event, payload) => {
    let d = {};
    try { d = JSON.parse(payload || "{}"); } catch (e) {}
    const res = await authRequest("register", { username: d.username, password: d.password, want_token: true, icon: d.icon });
    if (res.status === 200 && res.body && res.body.token) writeToken(res.body.token);
    return { status: res.status, body: res.body };
  });

  ipcMain.handle("auth-me", async () => {
    const token = readToken();
    if (!token) return { status: 401, body: { status: "error", message: "Не авторизован" } };
    const res = await authRequest("me", {}, token);
    return { status: res.status, body: res.body };
  });

  ipcMain.handle("auth-update", async (event, payload) => {
    const token = readToken();
    let d = {};
    try { d = JSON.parse(payload || "{}"); } catch (e) {}
    if (!token) return { status: 401, body: { status: "error", message: "Не авторизован" } };
    const res = await authRequest("update", { icon: d.icon }, token);
    return { status: res.status, body: res.body };
  });

  // Смена пароля (кабинета и Minecraft)
  ipcMain.handle("auth-change-password", async (event, payload) => {
    const token = readToken();
    let d = {};
    try { d = JSON.parse(payload || "{}"); } catch (e) {}
    if (!token) return { status: 401, body: { status: "error", message: "Не авторизован" } };
    const res = await authRequest("change_password", { old_password: d.old_password, new_password: d.new_password }, token);
    return { status: res.status, body: res.body };
  });

  // Загрузка аватара (картинка профиля) — multipart/form-data на сайт
  ipcMain.handle("auth-upload-avatar", async (event, formData) => {
    return uploadAvatarFromRenderer(formData);
  });

  // Загрузка скина Minecraft (PNG 64x64) — multipart/form-data на сайт
  ipcMain.handle("auth-upload-skin", async (event, formData) => {
    return uploadSkinFromRenderer(formData);
  });

  ipcMain.handle("auth-logout", () => {
    writeToken("");
    return { status: 200, body: { status: "ok", message: "Выход выполнен" } };
  });

  // Вход по коду из Telegram (код из /code_cab)
  ipcMain.handle("auth-tg-login", async (event, payload) => {
    let d = {};
    try { d = JSON.parse(payload || "{}"); } catch (e) {}
    const res = await authRequest("tg_login", { code: d.code, want_token: true });
    if (res.status === 200 && res.body && res.body.token) writeToken(res.body.token);
    return { status: res.status, body: res.body };
  });

  // Привязка Telegram к авторизованному кабинету (код из /code_cab)
  ipcMain.handle("auth-tg-bind", async (event, payload) => {
    const token = readToken();
    let d = {};
    try { d = JSON.parse(payload || "{}"); } catch (e) {}
    if (!token) return { status: 401, body: { status: "error", message: "Не авторизован" } };
    const res = await authRequest("tg_bind", { code: d.code }, token);
    return { status: res.status, body: res.body };
  });

  // Проверить статус 2FA-подтверждения входа
  ipcMain.handle("auth-tg-confirm-status", async (event, payload) => {
    let d = {};
    try { d = JSON.parse(payload || "{}"); } catch (e) {}
    const res = await authRequest("login_confirm_status", { login_token: d.login_token });
    return { status: res.status, body: res.body };
  });

  // Получить токен после подтверждения 2FA
  ipcMain.handle("auth-tg-confirm", async (event, payload) => {
    let d = {};
    try { d = JSON.parse(payload || "{}"); } catch (e) {}
    const res = await authRequest("tg_confirm", { login_token: d.login_token });
    if (res.status === 200 && res.body && res.body.token) writeToken(res.body.token);
    return { status: res.status, body: res.body };
  });

  // Выбор папки игры через системный диалог
  ipcMain.handle("pick-folder", async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "Выбери папку Minecraft",
      properties: ["openDirectory"]
    });
    if (result.canceled || !result.filePaths || !result.filePaths.length) {
      return "";
    }
    return result.filePaths[0];
  });

  // Установка Minecraft с нуля (когда игры нет). Прогресс шлём в renderer через 'install-progress'.
  ipcMain.handle("install-minecraft", async (event, payload) => {
    let data = {};
    try { data = JSON.parse(payload || "{}"); } catch (e) { /* ignore */ }
    const version = data.version || cfg.MINECRAFT_VERSION;
    // установка всегда идёт в папку приложения (minecraft рядом с EXE)
    const gamesDir = detect.launcherGamesDir();

    const sendProgress = (stage, message, frac) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("install-progress", { stage, message, frac: Math.round(frac * 100) });
      }
    };

    try {
      sendProgress("start", "Готовлю установку Minecraft " + version + "…", 0);
      const result = await installVersion({ gamesDir, version }, sendProgress);

      // Сборка модов/шейдеров/ресурспаков с Яндекс.Диска (публичная ссылка).
      // Библиотеки и ассеты уже скачаны с Mojang; диск докладывает моды и конфиги.
      try {
        const mp = await applyModpack(MODPACK_URL, gamesDir, sendProgress);
        sendProgress("modpack", "Сборка: наложено модов/конфигов — " + (mp ? mp.applied : 0), 0.55);
      } catch (me) {
        // сбой сборки не должен ронять установку (основная игра уже готова)
        sendProgress("modpack", "Не удалось применить сборку: " + me.message, 0.55);
      }

      // Java: если на ПК не нашлась подходящая — скачиваем её
      let javaPath = "";
      const needMajor = 21;
      const sysJava = await detect.detectJava({ requiredJavaMajor: needMajor });
      if (sysJava) {
        javaPath = sysJava.path;
      } else {
        sendProgress("java", "Устанавливаю Java " + needMajor + "…", 0.6);
        const jr = await downloadJava(gamesDir, needMajor, sendProgress);
        if (jr.ok) javaPath = jr.javaPath;
      }

      // сохраняем путь установки и java
      const s = readSettings();
      s.gamesDir = gamesDir;
      s.version = version;
      if (javaPath) s.javaPath = javaPath;
      writeSettings(s);
      sendProgress("done", "Установка завершена. Можно запускать игру!", 100);
      return { ok: true, gamesDir, version, javaPath, installed: result };
    } catch (e) {
      sendProgress("error", "Ошибка установки: " + e.message, 100);
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle("launch-minecraft", async (event, payload) => {
    let nick = "Steve";
    let data = {};
    try { data = JSON.parse(payload || "{}"); } catch (e) { /* ignore */ }
    nick = (data.nick || "Steve").trim();
    if (!/^[A-Za-z0-9_]{3,16}$/.test(nick)) nick = "Steve";

    const settings = readSettings();
    const opts = { nick };
    // игра всегда берётся из папки приложения (minecraft рядом с EXE)
    opts.gamesDir = detect.launcherGamesDir();
    opts.version = cfg.MINECRAFT_VERSION;
    if (settings.javaPath && fs.existsSync(settings.javaPath)) opts.javaPath = settings.javaPath;
    if (data.ram) opts.ram = data.ram;
    else if (settings.ram) opts.ram = settings.ram;
    // автоподключение к серверу
    opts.server = data.server || "aurelume7and7blacksun.play.ski";
    if (data.port) opts.port = data.port;

    const result = await launchMinecraft(opts);
    return result;
  });

  createWindow();

  // ---------- Автоматическая установка версии в папку приложения на первом входе ----------
  // При самом первом запуске, если версия из game-config ещё не установлена, ставим её (сборку с модами)
  // в корневую папку приложения автоматически. Флаг firstRunDone предотвращает повтор.
  ensureFirstRunAutoInstall();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// Проверяет, что версия из game-config установлена в каталоге игры. Иначе — автоустановка.
function versionInstalled(gamesDir, version) {
  try {
    return fs.existsSync(path.join(gamesDir, "versions", version, version + ".json")) &&
           fs.existsSync(path.join(gamesDir, "versions", version, version + ".jar"));
  } catch (e) { return false; }
}

function ensureFirstRunAutoInstall() {
  // если уже обрабатывали в этой сессии — не повторяем
  if (global.__firstRunInstallStarted) return;
  global.__firstRunInstallStarted = true;

  const settings = readSettings();
  const version = cfg.MINECRAFT_VERSION;
  const gamesDir = detect.launcherGamesDir();
  if (versionInstalled(gamesDir, version)) return;

  // флаг: автоустановка уже запрошена ранее (чтобы не запускать заново при перезапуске в сломанном состоянии)
  if (settings.firstRunInstallDone) return;

  const sendProgress = (stage, message, frac) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("install-progress", { stage, message, frac: Math.round(frac * 100) });
    }
  };

  sendProgress("start", "Первый ввод: устанавливаю Minecraft " + version + " в папку приложения…", 0);

  installVersion({ gamesDir, version }, sendProgress)
    .then(async () => {
      // накладываем сборку с модами с Яндекс.Диска
      try {
        const mp = await applyModpack(MODPACK_URL, gamesDir, sendProgress);
        sendProgress("modpack", "Сборка: " + (mp ? mp.applied : 0) + " модов/конфигов наложено", 0.55);
      } catch (me) {
        sendProgress("modpack", "Не удалось применить сборку: " + me.message, 0.55);
      }

      // Java при необходимости
      let javaPath = "";
      const sn = readSettings();
      const sysJava = await detect.detectJava({ requiredJavaMajor: cfg.JAVA_MAJOR });
      if (sysJava) {
        javaPath = sysJava.path;
      } else {
        sendProgress("java", "Устанавливаю Java 21…", 0.6);
        try {
          const jr = await downloadJava(gamesDir, cfg.JAVA_MAJOR, sendProgress);
          if (jr.ok) javaPath = jr.javaPath;
        } catch (je) {
          javaPath = "";
        }
      }

      const s = readSettings();
      s.gamesDir = gamesDir;
      s.version = version;
      s.firstRunInstallDone = true;
      if (javaPath) s.javaPath = javaPath;
      writeSettings(s);
      sendProgress("done", "Установка завершена. Можно запускать игру!", 100);
    })
    .catch((e) => {
      const s = readSettings();
      s.gamesDir = gamesDir;
      s.firstRunInstallDone = true; // чтобы не зацикливалось; пользователь запустит кнопкой
      writeSettings(s);
      sendProgress("error", "Не удалось установить автоматически: " + e.message, 100);
    });
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});