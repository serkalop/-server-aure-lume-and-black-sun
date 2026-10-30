// Запуск Minecraft напрямую через Java-рантайм (оффлайновый).
// Версия 3: настраиваемые пути (dir/version/java/ram) + автоопределение.
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");
const detect = require("./mc-detect");

function allowRules(rules, osName, arch) {
  if (!rules) return true;
  let result = false;
  for (const rule of rules) {
    let ok = true;
    if (rule.os) {
      if (rule.os.name && rule.os.name !== osName) ok = false;
      if (rule.os.arch) {
        const want = rule.os.arch;
        if (want === "x86" && arch !== "x86") ok = false;
        if ((want === "x64" || want === "x86_64") && arch !== "x64") ok = false;
      }
    }
    if (ok) result = rule.action === "allow";
  }
  return result;
}

function buildClasspath(gamesDir, versionJson) {
  const libBase = path.join(gamesDir, "libraries");
  const osName = "windows";
  const arch = process.arch === "x64" ? "x64" : "x86";
  const parts = [];
  const natives = [];

  for (const lib of versionJson.libraries || []) {
    if (!allowRules(lib.rules, osName, arch)) continue;
    const dl = lib.downloads || {};
    if (dl.artifact) {
      const p = path.join(libBase, dl.artifact.path);
      if (fs.existsSync(p)) parts.push(p);
    }
    const classifiers = dl.classifiers || {};
    if (Object.keys(classifiers).length) {
      let chosen =
        classifiers["natives-windows"] ||
        classifiers["natives-windows-64"] ||
        classifiers["natives-windows-x86"] ||
        null;
      const winKey = Object.keys(classifiers).find(
        (k) => k.indexOf("natives-windows") !== -1
      );
      if (winKey) chosen = classifiers[winKey];
      if (chosen) {
        const p = path.join(libBase, chosen.path);
        if (fs.existsSync(p)) natives.push(p);
      }
    }
  }

  return { parts, natives };
}

// Строит команду запуска. opts: { gamesDir, version, javaPath, ram, nick }
function buildLaunchCommand(opts) {
  const gamesDir = opts.gamesDir;
  const version = opts.version;
  const versionDir = path.join(gamesDir, "versions", version);
  const manifestPath = path.join(versionDir, version + ".json");
  const jarPath = path.join(versionDir, version + ".jar");

  if (!fs.existsSync(manifestPath)) {
    return { error: "Не найден манифест версии: " + manifestPath };
  }
  if (!fs.existsSync(jarPath)) {
    return { error: "Не найден jar версии: " + jarPath };
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const mainClass = manifest.mainClass || "net.minecraft.client.main.Main";

  const javaPath = opts.javaPath;
  if (!javaPath || !fs.existsSync(javaPath)) {
    return { error: "Не найден Java-рантайм. Установите Java или укажите путь." };
  }

  const { parts, natives } = buildClasspath(gamesDir, manifest);
  parts.push(jarPath);
  const classpath = parts.join(";");

  const nativesDir = path.join(versionDir, "natives");
  if (!fs.existsSync(nativesDir)) fs.mkdirSync(nativesDir, { recursive: true });

  const assetsRoot = path.join(gamesDir, "assets");
  const assetIndex = (manifest.assetIndex && manifest.assetIndex.id) || "17";

  const args = [
    "-Xmx" + (opts.ram || "2G"),
    "-XX:+UnlockExperimentalVMOptions",
    "-XX:+UseG1GC",
    "-Djava.library.path=" + nativesDir,
    "-Djna.tmpdir=" + nativesDir,
    "-Dorg.lwjgl.system.SharedLibraryExtractPath=" + nativesDir,
    "-Dio.netty.native.workdir=" + nativesDir,
    "-Dminecraft.launcher.brand=lord-of-the-games",
    "-Dminecraft.launcher.version=1.0.0",
    "-cp", classpath,
    mainClass,
    "--username", opts.nick || "Steve",
    "--version", version,
    "--gameDir", gamesDir,
    "--assetsDir", assetsRoot,
    "--assetIndex", assetIndex,
    "--uuid", opts.uuid,
    "--accessToken", opts.accessToken,
    "--clientId", "lord-of-the-games",
    "--xuid", "",
    "--userType", "legacy",
    "--versionType", "release"
  ];

  // Автоподключение к серверу при старте (параметры legacy)
  if (opts.server) {
    args.push("--server", String(opts.server));
  }
  if (opts.port) {
    args.push("--port", String(opts.port));
  }

  return { javaPath, args, natives, nativesDir };
}

function offlineUuid(nick) {
  const input = "OfflinePlayer:" + nick;
  let h1 = 0, h2 = 0, h3 = 0, h4 = 0;
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i);
    h1 = (h1 + c * 0x1f000) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 * 31 + c) >>> 0;
    h4 = (h4 ^ (c << 5)) >>> 0;
  }
  const hex = (n) => (n >>> 0).toString(16).padStart(8, "0");
  const a = hex(h1), b = hex(h2), c = hex(h3), d = hex(h4);
  return a + "-" + b.slice(0, 4) + "-" + c.slice(0, 4) + "-" + d.slice(0, 4) + "-" +
    (d.slice(4) + c.slice(4) + b.slice(4) + a.slice(4)).slice(0, 12);
}

// Единая точка запуска.
// opts: { nick, gamesDir?, version?, javaPath?, ram? }
// если gamesDir/version/javaPath не переданы — автопоиск.
async function launchMinecraft(opts) {
  opts = opts || {};
  const nick = opts.nick || "Steve";

  // 1) определить каталог игры
  let gamesDir = opts.gamesDir;
  if (!gamesDir) {
    const found = detect.detectMinecraft();
    if (!found) return { ok: false, error: "Каталог Minecraft не найден. Откройте приложение для указания пути." };
    gamesDir = found.dir;
  }
  if (!fs.existsSync(path.join(gamesDir, "versions"))) {
    return { ok: false, error: "Не найден каталог versions в " + gamesDir };
  }

  // 2) выбрать версию
  let version = opts.version;
  if (!version) {
    const cfg = require("./game-config");
    const versions = detect.listAvailableVersions(gamesDir);
    // предпочтение версии из конфига установщика
    version = versions.indexOf(cfg.MINECRAFT_VERSION) !== -1 ? cfg.MINECRAFT_VERSION : versions[0];
  }
  if (!version) return { ok: false, error: "В каталоге нет установленных версий Minecraft." };

  // 3) Java: если указана — взять, иначе автопоиск (включая runtime внутри игры)
  let javaPath = opts.javaPath;
  if (!javaPath || !fs.existsSync(javaPath)) {
    // поиск внутри каталога игры
    const manifestFile = path.join(gamesDir, "versions", version, version + ".json");
    let requiredMajor = null;
    try {
      const m = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
      if (m.javaVersion && m.javaVersion.majorVersion) requiredMajor = m.javaVersion.majorVersion;
      const comp = m.javaVersion && m.javaVersion.component;
      const cand = [
        path.join(gamesDir, "runtime", comp || "", "windows", comp || "", "bin", "javaw.exe"),
        path.join(gamesDir, "runtime", "java-runtime-delta", "windows", "java-runtime-delta", "bin", "javaw.exe"),
        path.join(gamesDir, "runtime", "java-runtime-gamma", "windows", "java-runtime-gamma", "bin", "javaw.exe")
      ];
      for (const c of cand) if (fs.existsSync(c)) { javaPath = c; break; }
    } catch (e) { /* ignore */ }
  }
  if (!javaPath) {
    const sys = await detect.detectJava({ requiredJavaMajor: requiredMajor });
    if (sys) javaPath = sys.path;
  }
  if (!javaPath) {
    return { ok: false, error: "Java не найдена. Установите Java 21 или укажите путь к java.exe." };
  }

  // natives
  const cmd = buildLaunchCommand({
    gamesDir, version, javaPath,
    ram: opts.ram || "2G", nick,
    uuid: offlineUuid(nick),
    server: opts.server,
    port: opts.port,
    accessToken: "offline-" + Buffer.from(nick + Date.now()).toString("hex")
  });
  if (cmd.error) return cmd;

  // запуск через временный .bat (обход политики на прямой spawn)
  let bat = null;
  try {
    bat = fs.mkdtempSync(path.join(os.tmpdir(), "lotg-"));
    bat = path.join(bat, "run.bat");
  } catch (e) {
    return { ok: false, error: "Не удалось создать временную папку." };
  }
  const quote = (s) => '"' + String(s).replace(/"/g, '""') + '"';
  const argsLine = cmd.args.map((a) => quote(String(a))).join(" ");
  const clientLog = path.join(gamesDir, "client-launch.log");
  const batBody =
    "@echo off\r\n" +
    "cd /d " + quote(gamesDir) + "\r\n" +
    quote(cmd.javaPath) + " " + argsLine + " > " + quote(clientLog) + " 2>&1\r\n";
  try {
    fs.writeFileSync(bat, batBody, "utf8");
  } catch (e) {
    return { ok: false, error: "Не удалось записать bat: " + e.message };
  }

  let proc;
  try {
    proc = spawn("cmd.exe", ["/c", bat], {
      cwd: gamesDir, detached: true, stdio: "ignore", windowsHide: true
    });
  } catch (e) {
    return { ok: false, error: "Не удалось запустить: " + e.message };
  }
  proc.unref();
  return { ok: true, javaPath, gamesDir, version, pid: proc.pid, log: clientLog };
}

module.exports = { launchMinecraft, buildLaunchCommand, offlineUuid };