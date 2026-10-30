// Загрузчик модовой сборки с Яндекс.Диска (публичная ссылка).
// Качает файлы сборки (моды/шейдеры/ресурспаки/конфиги) и раскладывает
// в targetDir, сохраняя относительные пути внутри папки-сборки.
//
// Сборка на диске — распакованный корень .minecraft (mods/, config/,
// resourcepacks/, shaderpacks/, версия клиента привязана к MINECRAFT_VERSION из game-config.js, БЕЗ библиотек и ассетов
// (их берём стандартно с Mojang).
const https = require("https");
const fs = require("fs");
const path = require("path");

const API = "https://cloud-api.yandex.net/v1/disk/public/resources";

// Яндекс.Диск блокирует большие файлы без браузерного UA, отдавая HTTP 500.
const BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

function getJson(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { "User-Agent": BROWSER_UA, "Accept": "*/*" } }, (res) => {
      if (res.statusCode >= 200 && res.statusCode < 300) {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
          catch (e) { reject(new Error("Bad JSON from " + url)); }
        });
      } else {
        reject(new Error("HTTP " + res.statusCode + " for " + url));
      }
    });
    req.on("error", reject);
  });
}

// рекурсивно собираем файлы в папке (её саму не включаем в пути)
async function listFiles(publicKey, folderPath, out) {
  const q = API + "?public_key=" + encodeURIComponent(publicKey) +
            "&limit=1000" + (folderPath ? "&path=" + encodeURIComponent(folderPath) : "");
  const j = await getJson(q);
  const items = (j._embedded && j._embedded.items) || [];
  for (const it of items) {
    if (it.type === "dir") {
      await listFiles(publicKey, it.path, out);
    } else {
      out.push({ path: it.path, size: it.size || 0 });
    }
  }
}

// получаем прямой download href для файла
function getDownloadHref(publicKey, filePath) {
  return getJson(API + "/download?public_key=" + encodeURIComponent(publicKey) +
                 "&path=" + encodeURIComponent(filePath))
    .then((j) => (j && j.href) || null);
}

function downloadTo(url, dest) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const doGet = (u, depth) => {
      if (depth > 8) return reject(new Error("Too many redirects: " + u));
      const req = https.get(u, { headers: { "User-Agent": BROWSER_UA, "Accept": "*/*" } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          return doGet(res.headers.location, depth + 1);
        }
        if (res.statusCode >= 200 && res.statusCode < 300) {
          const ws = fs.createWriteStream(dest);
          res.pipe(ws);
          ws.on("finish", () => { ws.close(); resolve({ ok: true }); });
          ws.on("error", reject);
        } else {
          res.resume();
          reject(new Error("HTTP " + res.statusCode + " for " + u));
        }
      });
      req.on("error", reject);
    };
    doGet(url, 0);
  });
}

// скачивание с retry (CDN Яндекс/дропбокса временами отдаёт 5xx)
async function downloadToRetry(url, dest, retries, delayMs) {
  retries = retries == null ? 4 : retries;
  delayMs = delayMs == null ? 1500 : delayMs;
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    try {
      await downloadTo(url, dest);
      return;
    } catch (e) {
      lastErr = e;
      if (i < retries) {
        await new Promise((r) => setTimeout(r, delayMs * (i + 1)));
      }
    }
  }
  throw lastErr;
}

// maps a дисковый путь типа /mods/OptiFine.jar в целевой путь внутри targetDir
function mapPath(diskPath, targetDir) {
  // путь всегда начинается с '/' или с имени файла
  const rel = diskPath.replace(/^\/+/, "");
  return path.join(targetDir, ...rel.split("/"));
}

// опциональные файлы-исключения (не тащим логи/мирки/настройки)
const SKIP_SUFFIXES = [
  "/logs/", "/saves/", "/downloads/",
  ".x", "/server-resource-packs/",
  "options.txt", "optionsshaders.txt"
];

function isSkipped(filePath) {
  return SKIP_SUFFIXES.some((s) => filePath.toLowerCase().indexOf(s.toLowerCase()) !== -1);
}

// Основной вход. publicUrl - публичная ссылка (disk.yandex.ru/d/<токен>), targetDir.
async function applyModpack(publicUrl, targetDir, onProgress) {
  // API Яндекс.Диска принимает public_key как полный URL до папки (например
  // https://disk.yandex.ru/d/Hte7sXScuPtqpA). Короткий токен /d/XXXX отдельно не идёт.
  const publicKey = publicUrl;

  onProgress && onProgress("modpack", "Читаю список файлов сборки…", 0);
  const files = [];
  await listFiles(publicKey, "", files);
  // фильтруем ненужное
  const keep = files.filter((f) => !isSkipped(f.path));
  const total = keep.length;
  if (!total) return { ok: true, applied: 0 };

  // качаем последовательно, с прогрессом по числу файлов.
  // Сбой отдельного файла (CDN Яндекс.Диска отдаёт 500 на нек-рых узлах) не
  // должен останавливать всю установку — пропускаем и продолжаем.
  let done = 0, failed = 0;
  for (const f of keep) {
    try {
      const href = await getDownloadHref(publicKey, f.path);
      if (!href) { failed++; continue; }
      const dest = mapPath(f.path, targetDir);
      await downloadToRetry(href, dest);
      done++;
    } catch (e) {
      failed++;
    }
    if (onProgress) {
      onProgress("modpack", "Сборка: " + (done + failed) + "/" + total + " файлов…", 0.5 + ((done + failed) / total) * 0.49);
    }
  }
  return { ok: true, applied: done, failedLast: failed, failed };
}

module.exports = { applyModpack, listFiles };

// // == самопроверка (node mc-modpack.js <targetDir>) ==
// if (require.main === module) {
//   const target = process.argv[2] || path.join(require("os").tmpdir(), "mt_test");
//   applyModpack("https://disk.yandex.ru/d/Hte7sXScuPtqpA", target, (s, msg, fr) =>
//     require("fs").appendFileSync(path.join(require("os").tmpdir(), "mp.log"), msg + "\n"))
//     .then((r) => { console.log("OK", r); })
//     .catch((e) => { console.error("ERR", e); process.exit(1); });
// }