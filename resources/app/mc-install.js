// Установщик Minecraft из официальных источников Mojang.
// Скачивает: манифест версии, клиентский jar, все библиотеки, ассеты, индекс ассетов.
// Версия по умолчанию берётся из game-config.js (cfg.MINECRAFT_VERSION).
// Java не скачивает (приложение использует системный JDK или автопоиск).
const https = require("https");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const cfg = require("./game-config");

const VERSION_MANIFEST = "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json";
const RESOURCES_BASE = "https://resources.download.minecraft.net";
const LIBRARIES_BASE = "https://libraries.minecraft.net";
const VERSION_META_BASE = "https://piston-meta.mojang.com/v1/packages";

function get(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, (res) => {
      if (res.statusCode >= 200 && res.statusCode < 300) {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => resolve({ status: res.statusCode, body: Buffer.concat(chunks), res }));
      } else {
        reject(new Error("HTTP " + res.statusCode + " for " + url));
      }
    });
    req.on("error", reject);
  });
}

async function getJson(url) {
  const { body } = await get(url);
  return JSON.parse(body.toString("utf8"));
}

// Скачивает файл, проверяя sha1 при необходимости.
async function downloadFile(url, destPath, sha1) {
  const dir = path.dirname(destPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  // проверка существующего
  if (sha1 && fs.existsSync(destPath)) {
    const h = crypto.createHash("sha1").update(fs.readFileSync(destPath)).digest("hex");
    if (h === sha1) return { skipped: true };
  }
  const { body } = await get(url);
  if (sha1) {
    const h = crypto.createHash("sha1").update(body).digest("hex");
    if (h !== sha1) throw new Error("SHA1 mismatch for " + url);
  }
  fs.writeFileSync(destPath, body);
  return { skipped: false, bytes: body.length };
}

// Скачивает версию и библиотеки + ассеты. onProgress(status, message, frac) вызывается для UI.
async function installVersion(opts, onProgress) {
  opts = opts || {};
  const gamesDir = opts.gamesDir;
  const version = opts.version || cfg.MINECRAFT_VERSION;
  const versionsDir = path.join(gamesDir, "versions", version);
  const librariesDir = path.join(gamesDir, "libraries");
  const assetsDir = path.join(gamesDir, "assets");

  onProgress && onProgress("check", "Поиск версии в официальном манифесте…", 0);

  // 1) версионная мета
  const manifest = await getJson(VERSION_MANIFEST);
  const verMeta = (manifest.versions || []).find((v) => v.id === version);
  if (!verMeta) throw new Error("Версия " + version + " не найдена в манифесте Mojang.");

  // 2) конкретный манифест версии
  onProgress && onProgress("version", "Скачиваю манифест версии " + version + "…", 0.02);
  const vjson = await getJson(verMeta.url);
  fs.mkdirSync(versionsDir, { recursive: true });
  fs.writeFileSync(path.join(versionsDir, version + ".json"), JSON.stringify(vjson, null, 2), "utf8");

  // 3) клиентский jar
  const client = vjson.downloads && vjson.downloads.client;
  if (client) {
    onProgress && onProgress("version", "Скачиваю клиент " + version + " (~25 МБ)…", 0.05);
    await downloadFile(client.url, path.join(versionsDir, version + ".jar"), client.sha1);
  }

  // 4) библиотеки
  const libs = (vjson.libraries || []).filter((lib) => lib.downloads && lib.downloads.artifact);
  onProgress && onProgress("libraries", "Скачиваю библиотеки (0/" + libs.length + ")…", 0.08);
  let done = 0;
  const tasks = [];
  for (const lib of libs) {
    const a = lib.downloads.artifact;
    const dest = path.join(librariesDir, a.path);
    // скачиваем параллельными батчами 4
    tasks.push({ url: LIBRARIES_BASE + "/" + a.path, dest, sha1: a.sha1 });
  }
  // батчи по 6
  const batchSize = 6;
  for (let i = 0; i < tasks.length; i += batchSize) {
    const batch = tasks.slice(i, i + batchSize);
    await Promise.all(
      batch.map((t) =>
        downloadFile(t.url, t.dest, t.sha1).then(() => {
          done++;
          if (onProgress) onProgress("libraries", "Скачиваю библиотеки (" + done + "/" + tasks.length + ")…", 0.08 + (done / tasks.length) * 0.2);
        })
      )
    );
  }

  // 5) индексы ассетов
  const assetIndex = vjson.assetIndex;
  if (assetIndex) {
    onProgress && onProgress("assets", "Скачиваю индекс ассетов…", 0.3);
    const idxDest = path.join(assetsDir, "indexes", assetIndex.id + ".json");
    await downloadFile(assetIndex.url, idxDest, assetIndex.sha1);
  }

  // 6) объекты ассетов (все файлы)
  const indexJsonFile = path.join(assetsDir, "indexes", assetIndex.id + ".json");
  if (fs.existsSync(indexJsonFile)) {
    const idx = JSON.parse(fs.readFileSync(indexJsonFile, "utf8"));
    const objects = idx.objects || {};
    const keys = Object.keys(objects);
    onProgress && onProgress("assets", "Проверяю ассеты (0/" + keys.length + ")…", 0.35);
    let aDone = 0;
    const objTasks = keys
      .filter((k) => {
        const o = objects[k];
        return o && o.hash;
      })
      .map((k) => {
        const o = objects[k];
        return {
          url: RESOURCES_BASE + "/" + o.hash.slice(0, 2) + "/" + o.hash,
          dest: path.join(assetsDir, "objects", o.hash.slice(0, 2), o.hash),
          sha1: o.hash
        };
      });
    for (let i = 0; i < objTasks.length; i += batchSize) {
      const batch = objTasks.slice(i, i + batchSize);
      await Promise.all(
        batch.map((t) =>
          downloadFile(t.url, t.dest, t.sha1)
            .catch(() => {}) // пропускаем сбойные объекты
            .then(() => {
              aDone++;
              if (onProgress) onProgress("assets", "Ассеты (" + aDone + "/" + objTasks.length + ")…", 0.35 + (aDone / objTasks.length) * 0.6);
            })
        )
      );
    }
  }

  onProgress && onProgress("assets", "Создаю natives…", 0.97);
  const nativesDir = path.join(versionsDir, "natives");
  if (!fs.existsSync(nativesDir)) fs.mkdirSync(nativesDir, { recursive: true });

  onProgress && onProgress("done", "Установка завершена", 1);
  return { ok: true, gamesDir, version };
}

// Скачивает и распаковывает Java (Adoptium) в каталог игры runtime\java-runtime-custom.
async function downloadJava(gamesDir, major, onProgress) {
  const targetDir = path.join(gamesDir, "runtime", "java-runtime-custom", "windows", "java-runtime-custom");
  const bin = path.join(targetDir, "bin", "javaw.exe");
  if (fs.existsSync(bin)) return { ok: true, javaPath: bin, skipped: true };

  const apiURL =
    "https://api.adoptium.net/v3/binary/latest/" + major + "/ga/windows/x64/jdk/hotspot/normal/eclipse?project=jdk";
  onProgress && onProgress("java", "Скачиваю Java " + major + " (~180 МБ)…", 0.6);

  // качаем в temp
  const tmpZip = path.join(os.tmpdir(), "jdk-" + major + "-" + Date.now() + ".zip");
  await downloadToFile(apiURL, tmpZip);

  onProgress && onProgress("java", "Распаковываю Java…", 0.7);
  // распаковка
  const extractDir = path.join(os.tmpdir(), "jdkx-" + major + "-" + Date.now());
  fs.mkdirSync(extractDir, { recursive: true });
  await extractZip(tmpZip, extractDir);

  // найти bin/javaw.exe внутри
  const found = findFileRecursive(extractDir, "javaw.exe");
  if (!found) throw new Error("Не найден javaw.exe в скачанной Java");
  // Перемещаем содержимое найденной JDK в targetDir
  const jdkRoot = path.dirname(path.dirname(found)); // .../java-version/bin/javaw.exe -> java-version
  fs.mkdirSync(targetDir, { recursive: true });
  copyRecursiveSync(jdkRoot, targetDir);
  fs.rmSync(extractDir, { recursive: true, force: true });
  fs.rmSync(tmpZip, { force: true });
  return { ok: true, javaPath: path.join(targetDir, "bin", "javaw.exe"), skipped: false };
}

// Утилиты для распаковки zip
function extractZip(zipPath, destDir) {
  return new Promise((resolve, reject) => {
    const { execFile } = require("child_process");
    // используем PowerShell Expand-Archive для распаковки
    execFile("powershell.exe", ["-NoProfile", "-Command", "Expand-Archive -LiteralPath '" + zipPath + "' -DestinationPath '" + destDir + "' -Force"], (err) => {
      if (err) reject(err); else resolve();
    });
  });
}

function findFileRecursive(dir, fileName) {
  let result = null;
  try {
    const items = fs.readdirSync(dir, { withFileTypes: true });
    for (const it of items) {
      const full = path.join(dir, it.name);
      if (it.isDirectory()) {
        const r = findFileRecursive(full, fileName);
        if (r) return r;
      } else if (it.name.toLowerCase() === fileName.toLowerCase()) {
        return full;
      }
    }
  } catch (e) { /* ignore */ }
  return result;
}

function copyRecursiveSync(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyRecursiveSync(s, d);
    else fs.copyFileSync(s, d);
  }
}

async function downloadToFile(url, dest) {
  const { body } = await get(url);
  fs.writeFileSync(dest, body);
}

module.exports = { installVersion, getJson, downloadJava };