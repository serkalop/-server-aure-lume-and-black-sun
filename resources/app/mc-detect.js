// Запуск Minecraft напрямую через установленный Java-рантайм (оффлайновый запуск).
// Версия 2: автоопределение каталога .minecraft и Java на любой машине.
const { spawn, execFile } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");

const DEFAULT_RAM = "2G";

// ---------- Поиск каталога Minecraft (.minecraft) ----------
// Игра берётся ТОЛЬКО из папки приложения (minecraft рядом с EXE).
// Внешние каталоги и сторонние лаунчеры не сканируются.
function candidateGamesDirs() {
  const dirs = [];

  // 1) Явная настройка пользователя (если указана)
  if (process.env.LORD_MC_DIR) dirs.push(process.env.LORD_MC_DIR);

  // 2) Каталог игры в папке приложения (основной источник)
  try {
    const appDir = path.dirname(process.execPath);
    if (appDir) dirs.push(path.join(appDir, "minecraft"));
  } catch (e) { /* ignore */ }

  // 3) Фолбэк: каталог лаунчера (если папка приложения читается неверно)
  try {
    dirs.push(launcherGamesDir());
  } catch (e) { /* ignore */ }

  return dirs;
}

function listAvailableVersions(gamesDir) {
  const versionsDir = path.join(gamesDir, "versions");
  if (!fs.existsSync(versionsDir)) return [];
  let items = [];
  try {
    items = fs.readdirSync(versionsDir, { withFileTypes: true });
  } catch (e) {
    return [];
  }
  return items
    .filter((i) => i.isDirectory())
    .map((i) => i.name)
    .filter((name) => {
      // у версии должен быть .json и .jar
      return (
        fs.existsSync(path.join(versionsDir, name, name + ".json")) &&
        fs.existsSync(path.join(versionsDir, name, name + ".jar"))
      );
    })
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

// Ищет каталог игры с версиями. Вернёт { dir, versions } или null.
function detectMinecraft() {
  const dirs = candidateGamesDirs();
  const seen = new Set();
  for (const dir of dirs) {
    const resolved = path.resolve(dir);
    if (seen.has(resolved)) continue;
    seen.add(resolved);
    if (!dir || !fs.existsSync(dir)) continue;
    if (!fs.existsSync(path.join(dir, "versions"))) continue;
    const versions = listAvailableVersions(dir);
    if (versions.length) {
      return { dir, versions };
    }
  }
  return null;
}

// ---------- Поиск java.exe ----------
function candidateJavaPaths(requiredComp) {
  const list = [];

  const pf = process.env["ProgramFiles"] || "C:\\Program Files";
  const pf86 = process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";
  const local = process.env.LOCALAPPDATA || "";

  // 1) Дистрибутивы по известным путям
  const patterns = [
    path.join(pf, "Java"),
    path.join(pf, "Eclipse Adoptium"),
    path.join(pf, "Microsoft"),
    path.join(pf, "Zulu"),
    path.join(pf86, "Java"),
    path.join(pf86, "Microsoft"),
    local ? path.join(local, "Programs") : null
  ];
  for (const base of patterns) {
    if (!base || !fs.existsSync(base)) continue;
    let sub = [];
    try {
      sub = fs.readdirSync(base);
    } catch (e) { /* ignore */ }
    for (const name of sub) {
      const jp = path.join(base, name, "bin", "javaw.exe");
      if (fs.existsSync(jp)) list.push(jp);
    }
  }

  // 2) Внутри самой папки игры (runtime)
  // (передаётся отдельно через opts, но добавим на случай)

  // 3) Из PATH/where
  // -> добавлено в detectJava через 'where'

  // Сортируем: стараемся выбрать версию 21 (лучше для новых версий), потом 17, потом 8
  const score = (jp) => {
    const m = jp.toLowerCase().match(/jdk[-_.]?(\d+)/) || jp.match(/java[-\s]?(\d+)/);
    const v = m ? parseInt(m[1], 10) : 0;
    if (v === 21) return 3;
    if (v === 17) return 2;
    if (v === 8 || v === 16) return 1;
    return 0;
  };
  list.sort((a, b) => score(b) - score(a));
  return list;
}

// Проверяет реальную версию java через 'java -version'
function getJavaVersion(javaExe) {
  return new Promise((resolve) => {
    execFile(javaExe, ["-version"], { timeout: 8000 }, (err, stdout, stderr) => {
      const text = (stdout || "") + (stderr || "");
      const m = text.match(/(\d+)(?:\.(\d+))?/);
      resolve(m ? parseInt(m[1], 10) : null);
    });
  });
}

// Находит рабочий java.exe. Приоритет: переданный через opts -> системный -> PATH.
async function detectJava(opts) {
  const required = (opts && opts.requiredJavaMajor) || null;

  // Из настроек
  if (opts && opts.javaPath) {
    if (fs.existsSync(opts.javaPath)) return { path: opts.javaPath, from: "settings" };
  }

  // кандидаты
  const candidates = candidateJavaPaths();

  // Проверяем каждый, есть ли подходящая версия
  for (const jp of candidates) {
    const ver = await getJavaVersion(path.join(path.dirname(jp), "java.exe"));
    if (required && ver !== null && ver < required) continue;
    // 8 не подойдёт для новых версий, но ок для старых
    return { path: jp, from: "system", version: ver };
  }

  return null;
}

module.exports = {
  detectMinecraft,
  listAvailableVersions,
  detectJava,
  launcherGamesDir,
  allowRules: null
};

// Каталог лаунчера, куда приложение ставит Minecraft по умолчанию.
// Основной каталог — корневая папка приложения (там, где лежит EXE), подпапка "minecraft":
// именно туда при первом входе раскладывается версия/сборка из корня приложения.
// Если папка приложения недоступна для записи (например установка в Program Files),
// используем %APPDATA%\Roaming\Lord of the games\minecraft.
function launcherGamesDir() {
  let appDir = "";
  try { appDir = path.dirname(process.execPath); } catch (e) { appDir = ""; }

  const inApp = appDir ? path.join(appDir, "minecraft") : "";
  if (inApp) {
    try {
      // проверка на запись в каталог приложения
      const test = path.join(inApp, ".wtest-" + Date.now());
      fs.mkdirSync(inApp, { recursive: true });
      fs.writeFileSync(test, "x");
      fs.unlinkSync(test);
      return inApp;
    } catch (e) {
      // нет прав — падаем на APPDATA
    }
  }

  const base = process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
  return path.join(base, "Lord of the games", "minecraft");
}