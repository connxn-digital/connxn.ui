import http from "node:http";
import { createReadStream, existsSync } from "node:fs";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
import { Readable } from "node:stream";
import { spawn, execFile } from "node:child_process";
import os from "node:os";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, "public");
const DEFAULT_DATA_DIR = path.join(__dirname, ".connxn");
const DAY_DB_NAME = "workspace.json";
const ENV_FILE = path.join(__dirname, ".env.local");
const HOST = process.env.HOST || "127.0.0.1";
const PORT = Number(process.env.PORT || 4173);

const MAX_JSON_BYTES = 160 * 1024 * 1024;
const FFMPEG_BIN = process.env.FFMPEG_BIN || (process.platform === "darwin" ? "/opt/homebrew/bin/ffmpeg" : "ffmpeg");
const KIE_ASSET_URL_MAX_AGE_MS = 20 * 60 * 1000;

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav"
};

let dbCache = null;
let DATA_DIR = DEFAULT_DATA_DIR;
let UPLOAD_DIR = "";
let DB_FILE = "";
let LOG_DIR = "";

configureDataDir(process.env.CONNXN_DATA_DIR || DEFAULT_DATA_DIR);

function now() {
  return new Date().toISOString();
}

function uid(prefix = "id") {
  return `${prefix}_${crypto.randomBytes(6).toString("hex")}`;
}

function defaultDb() {
  const imageChat = createChat("image", "Image generator");
  const videoChat = createChat("video", "Video generator");
  const audioChat = createChat("audio", "Audio generator");
  return {
    version: 1,
    profile: {
      nick: "connxn user",
      avatarData: ""
    },
    settings: {
      liveMode: true,
      keyStatus: "missing",
      credits: null,
      loaderMode: "cellnoise",
      themeMode: "system",
      lastView: "image"
    },
    activeChat: {
      image: imageChat.id,
      video: videoChat.id,
      audio: audioChat.id
    },
    chats: {
      image: [imageChat],
      video: [videoChat],
      audio: [audioChat]
    },
    assets: []
  };
}

function createChat(type, title = "New chat") {
  return {
    id: uid(type),
    type,
    title,
    pinned: false,
    createdAt: now(),
    updatedAt: now(),
    messages: []
  };
}

async function ensureStorage() {
  await loadLocalEnv();
  configureDataDir(process.env.CONNXN_DATA_DIR || DEFAULT_DATA_DIR);
  await fs.mkdir(PUBLIC_DIR, { recursive: true });
  await fs.mkdir(UPLOAD_DIR, { recursive: true });
  await fs.mkdir(LOG_DIR, { recursive: true });
}

function configureDataDir(dirPath) {
  DATA_DIR = path.resolve(String(dirPath || DEFAULT_DATA_DIR));
  UPLOAD_DIR = path.join(DATA_DIR, "uploads");
  DB_FILE = path.join(DATA_DIR, "db.json");
  LOG_DIR = path.join(DATA_DIR, "logs");
}

function defaultDownloadDir() {
  return path.join(os.homedir(), "Downloads", "connxn");
}

function normalizeLoaderMode(value) {
  return value === "blurry-dream" ? "blurry-dream" : "cellnoise";
}

function normalizeThemeMode(value) {
  const themes = new Set(["system", "light", "dark", "github", "mono-light", "dark-blood", "vampire-masquerade", "blender", "maya", "yorha", "frutiger-aero", "tumblr-aqua"]);
  return themes.has(value) ? value : "system";
}

function normalizeView(value) {
  return ["image", "video", "canvas", "library", "account"].includes(value) ? value : "image";
}

function runExecFile(command, args) {
  return new Promise((resolve, reject) => {
    execFile(command, args, { timeout: 120000 }, (error, stdout, stderr) => {
      if (error) {
        error.stderr = stderr;
        reject(error);
        return;
      }
      resolve(String(stdout || "").trim());
    });
  });
}

async function chooseFolder(defaultPath = "", title = "Choose folder") {
  const startPath = await nearestExistingDir(path.resolve(String(defaultPath || os.homedir())));
  if (process.platform === "darwin") {
    const script = [
      `set startFolder to POSIX file ${JSON.stringify(startPath)}`,
      `POSIX path of (choose folder with prompt ${JSON.stringify(title)} default location startFolder)`
    ].join("\n");
    return validateLocalDirPath(await runExecFile("osascript", ["-e", script]), "Selected folder");
  }
  if (process.platform === "win32") {
    const script = [
      "Add-Type -AssemblyName System.Windows.Forms",
      "$dialog = New-Object System.Windows.Forms.FolderBrowserDialog",
      `$dialog.Description = ${JSON.stringify(title)}`,
      `$dialog.SelectedPath = ${JSON.stringify(startPath)}`,
      "if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { $dialog.SelectedPath }"
    ].join("; ");
    return validateLocalDirPath(await runExecFile("powershell.exe", ["-NoProfile", "-Command", script]), "Selected folder");
  }
  try {
    return validateLocalDirPath(await runExecFile("zenity", ["--file-selection", "--directory", "--title", title, "--filename", `${startPath}${path.sep}`]), "Selected folder");
  } catch {
    return validateLocalDirPath(await runExecFile("kdialog", ["--getexistingdirectory", startPath, "--title", title]), "Selected folder");
  }
}

async function nearestExistingDir(dirPath) {
  let current = path.resolve(String(dirPath || os.homedir()));
  for (;;) {
    try {
      const stat = await fs.stat(current);
      if (stat.isDirectory()) return current;
    } catch {}
    const parent = path.dirname(current);
    if (!parent || parent === current) return os.homedir();
    current = parent;
  }
}

async function loadLocalEnv() {
  try {
    const text = await fs.readFile(ENV_FILE, "utf8");
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (!process.env[key]) process.env[key] = value;
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

async function writeKieKeyToEnv(apiKey) {
  await writeLocalEnvValues({ KIE_API_KEY: apiKey || null });
  if (apiKey) {
    process.env.KIE_API_KEY = apiKey;
  } else {
    delete process.env.KIE_API_KEY;
  }
}

async function writeLocalEnvValues(values) {
  let lines = [];
  try {
    lines = (await fs.readFile(ENV_FILE, "utf8")).split(/\r?\n/);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  const keys = new Set(Object.keys(values));
  const filtered = lines.filter((line) => {
    const trimmed = line.trim();
    return ![...keys].some((key) => trimmed.startsWith(`${key}=`));
  });
  const cleaned = filtered.join("\n").trimEnd();
  const additions = Object.entries(values)
    .filter(([, value]) => value !== null && value !== undefined && String(value).trim())
    .map(([key, value]) => `${key}=${JSON.stringify(String(value))}`)
    .join("\n");
  const next = `${cleaned}${cleaned && additions ? "\n" : ""}${additions}${cleaned || additions ? "\n" : ""}`;

  await fs.writeFile(ENV_FILE, next, "utf8");
}

async function loadDb() {
  if (dbCache) return dbCache;
  dbCache = await loadLatestValidDb();

  dbCache.profile ||= { nick: "connxn user", avatarData: "" };
  dbCache.settings ||= { liveMode: true, keyStatus: "missing", credits: null };
  dbCache.settings.liveMode = true;
  dbCache.settings.keyStatus ||= process.env.KIE_API_KEY ? "saved" : "missing";
  dbCache.settings.downloadDir ||= process.env.CONNXN_DOWNLOAD_DIR || defaultDownloadDir();
  dbCache.settings.userDataDir = DATA_DIR;
  dbCache.settings.loaderMode = normalizeLoaderMode(dbCache.settings.loaderMode);
  dbCache.settings.themeMode = normalizeThemeMode(dbCache.settings.themeMode);
  dbCache.settings.lastView = normalizeView(dbCache.settings.lastView);
  dbCache.chats ||= { image: [], video: [], audio: [] };
  dbCache.chats.audio ||= [];
  dbCache.chats.audio ||= [];
  dbCache.assets ||= [];
  dbCache.canvasProjects ||= [{ id: uid("canvas"), name: "Untitled flow", createdAt: now(), updatedAt: now(), nodes: [], edges: [] }];
  dbCache.activeChat ||= {};

  if (dbCache.chats.image.length === 0) {
    const chat = createChat("image", "Image generator");
    dbCache.chats.image.push(chat);
    dbCache.activeChat.image = chat.id;
  }
  if (dbCache.chats.video.length === 0) {
    const chat = createChat("video", "Video generator");
    dbCache.chats.video.push(chat);
    dbCache.activeChat.video = chat.id;
  }

  if (dbCache.chats.audio.length === 0) {
    const chat = createChat("audio", "Audio generator");
    dbCache.chats.audio.push(chat);
    dbCache.activeChat.audio = chat.id;
  }

  return dbCache;
}

async function saveDb() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await writeJsonAtomic(currentDailyDbFile(), dbCache);
}

function dayKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function dailyDbDir(day = dayKey()) {
  return path.join(LOG_DIR, day);
}

function currentDailyDbFile() {
  return path.join(dailyDbDir(), DAY_DB_NAME);
}

async function readJsonFile(filePath) {
  const text = await fs.readFile(filePath, "utf8");
  return JSON.parse(text);
}

async function writeJsonAtomic(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const payload = `${JSON.stringify(value, null, 2)}\n`;
  const tmpPath = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`);
  await fs.writeFile(tmpPath, payload, "utf8");
  JSON.parse(await fs.readFile(tmpPath, "utf8"));
  await fs.rename(tmpPath, filePath);
}

async function listDailyDbFiles() {
  try {
    const entries = await fs.readdir(LOG_DIR, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(entry.name))
      .map((entry) => path.join(LOG_DIR, entry.name, DAY_DB_NAME))
      .sort()
      .reverse();
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

async function loadLatestValidDb() {
  const candidates = [currentDailyDbFile(), ...(await listDailyDbFiles()), DB_FILE];
  const seen = new Set();
  for (const filePath of candidates) {
    if (seen.has(filePath)) continue;
    seen.add(filePath);
    try {
      const db = await readJsonFile(filePath);
      if (db && typeof db === "object") {
        if (filePath !== currentDailyDbFile()) {
          await writeJsonAtomic(currentDailyDbFile(), db);
        }
        return db;
      }
    } catch (error) {
      if (error.code === "ENOENT") continue;
      console.warn(`[storage] skipped unreadable workspace log ${filePath}: ${error.message}`);
    }
  }
  const db = defaultDb();
  await writeJsonAtomic(currentDailyDbFile(), db);
  return db;
}

async function dirSize(dir) {
  let total = 0;
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const target = path.join(dir, entry.name);
      if (entry.isDirectory()) total += await dirSize(target);
      else if (entry.isFile()) total += (await fs.stat(target)).size;
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  return total;
}

async function storageStats(db) {
  const dbBytes = await fs.stat(currentDailyDbFile()).then((stat) => stat.size).catch(() => 0);
  const logBytes = await dirSize(LOG_DIR);
  const uploadBytes = await dirSize(UPLOAD_DIR);
  return {
    totalBytes: logBytes + uploadBytes,
    dbBytes,
    logBytes,
    uploadBytes,
    downloadDir: db.settings.downloadDir || process.env.CONNXN_DOWNLOAD_DIR || defaultDownloadDir(),
    userDataDir: DATA_DIR,
    assets: db.assets.length,
    canvasProjects: db.canvasProjects.length,
    canvasNodes: db.canvasProjects.reduce((sum, project) => sum + (project.nodes?.length || 0), 0),
    canvasEdges: db.canvasProjects.reduce((sum, project) => sum + (project.edges?.length || 0), 0)
  };
}

function publicState(db) {
  return {
    profile: db.profile,
    settings: {
      liveMode: Boolean(process.env.KIE_API_KEY),
      hasKieKey: Boolean(process.env.KIE_API_KEY),
      keyStatus: process.env.KIE_API_KEY ? db.settings.keyStatus || "saved" : "missing",
      credits: Number.isFinite(db.settings.credits) ? db.settings.credits : null,
      downloadDir: db.settings.downloadDir || process.env.CONNXN_DOWNLOAD_DIR || defaultDownloadDir(),
      userDataDir: DATA_DIR,
      loaderMode: normalizeLoaderMode(db.settings.loaderMode),
      themeMode: normalizeThemeMode(db.settings.themeMode),
      lastView: normalizeView(db.settings.lastView)
    },
    activeChat: db.activeChat,
    chats: db.chats,
    assets: db.assets.map(safeAsset),
    canvasProjects: db.canvasProjects,
    upscaleModels: UPSCALE_MODEL_CATALOG
  };
}

function safeAsset(asset) {
  const { localPath, kieUrl, ...rest } = asset;
  return rest;
}

function sendJson(res, status, data) {
  const payload = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload)
  });
  res.end(payload);
}

function sendText(res, status, text, type = "text/plain; charset=utf-8") {
  res.writeHead(status, {
    "Content-Type": type,
    "Content-Length": Buffer.byteLength(text)
  });
  res.end(text);
}

async function readJson(req) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > MAX_JSON_BYTES) {
      const error = new Error("Payload is too large for the local MVP upload path.");
      error.status = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

function findChat(db, type, chatId) {
  const list = db.chats[type] || [];
  return list.find((chat) => chat.id === chatId) || list[0];
}

function findMessageRecord(db, messageId) {
  for (const type of ["image", "video", "audio"]) {
    for (const chat of db.chats[type] || []) {
      const message = chat.messages.find((item) => item.id === messageId);
      if (message) return { type, chat, message };
    }
  }
  return null;
}

function downloadFileStem(record) {
  const model = String(record?.message?.options?.model || record?.type || "model")
    .split("/").at(-1)
    .replace(/[^a-z0-9_-]+/gi, "-")
    .replace(/^-+|-+$/g, "") || "model";
  const index = record?.chat?.messages?.findIndex((message) => message.id === record.message.id) ?? -1;
  const prompt = record?.chat?.messages
    ?.slice(0, index)
    .filter((message) => message.role === "user")
    .at(-1)?.text || "generated";
  const words = prompt.trim().split(/\s+/).filter(Boolean).slice(0, 2)
    .map((word) => word.replace(/[\\/:*?"<>|]+/g, "").replace(/[^\p{L}\p{N}_-]+/gu, ""))
    .filter(Boolean);
  return `connxn_${model}_${words.join("_") || "generated"}`;
}

function extensionForContentType(contentType, fallbackExtension) {
  const type = String(contentType || "").split(";")[0].trim().toLowerCase();
  if (type === "video/mp4") return ".mp4";
  if (type === "video/webm") return ".webm";
  if (type === "video/quicktime") return ".mov";
  if (type === "image/png") return ".png";
  if (type === "image/jpeg") return ".jpg";
  if (type === "image/webp") return ".webp";
  if (type === "image/gif") return ".gif";
  if (type === "audio/mpeg") return ".mp3";
  if (type === "audio/wav" || type === "audio/x-wav") return ".wav";
  return fallbackExtension;
}

function contentTypeForPath(filePath, fallbackType = "application/octet-stream") {
  return MIME_TYPES[path.extname(String(filePath || "")).toLowerCase()] || fallbackType;
}

function safeDownloadName(stem, extension) {
  const cleanStem = String(stem || "connxn_media")
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/[^a-z0-9_\-\p{L}\p{N}]+/giu, "-")
    .replace(/^-+|-+$/g, "") || "connxn_media";
  return `${cleanStem}${extension}`;
}

function contentDispositionAttachment(filename) {
  const fallback = String(filename || "connxn_media")
    .normalize("NFKD")
    .replace(/[^\x20-\x7E]+/g, "")
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/^-+|-+$/g, "") || "connxn_media";
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

function validateLocalDirPath(value, label) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (!path.isAbsolute(raw)) {
    const error = new Error(`${label} must be an absolute folder path.`);
    error.status = 400;
    throw error;
  }
  return path.resolve(raw);
}

async function applyStoragePaths(body) {
  const db = await loadDb();
  const nextDownloadDir = validateLocalDirPath(body.downloadDir, "Download folder") || db.settings.downloadDir || defaultDownloadDir();
  const nextDataDir = validateLocalDirPath(body.userDataDir, "User data folder") || DATA_DIR;
  const oldDataDir = DATA_DIR;
  const dataChanged = path.resolve(nextDataDir) !== path.resolve(DATA_DIR);

  await fs.mkdir(nextDownloadDir, { recursive: true });
  if (dataChanged) {
    await fs.mkdir(nextDataDir, { recursive: true });
    await fs.cp(oldDataDir, nextDataDir, { recursive: true, force: true }).catch((error) => {
      if (error.code !== "ENOENT") throw error;
    });
    configureDataDir(nextDataDir);
    await fs.mkdir(UPLOAD_DIR, { recursive: true });
    await fs.mkdir(LOG_DIR, { recursive: true });
  }

  db.settings.downloadDir = nextDownloadDir;
  db.settings.userDataDir = DATA_DIR;
  dbCache = db;
  await writeLocalEnvValues({
    CONNXN_DOWNLOAD_DIR: nextDownloadDir,
    CONNXN_DATA_DIR: DATA_DIR === DEFAULT_DATA_DIR ? null : DATA_DIR
  });
  process.env.CONNXN_DOWNLOAD_DIR = nextDownloadDir;
  if (DATA_DIR === DEFAULT_DATA_DIR) delete process.env.CONNXN_DATA_DIR;
  else process.env.CONNXN_DATA_DIR = DATA_DIR;
  await saveDb();
  return { state: publicState(db), storage: await storageStats(db), migrated: dataChanged };
}

async function saveDownloadSource(sourceUrl, { stem = "connxn_media", fallbackExtension = ".png", fallbackType = "application/octet-stream" } = {}) {
  const db = await loadDb();
  const downloadDir = validateLocalDirPath(db.settings.downloadDir || process.env.CONNXN_DOWNLOAD_DIR || defaultDownloadDir(), "Download folder");
  await fs.mkdir(downloadDir, { recursive: true });

  const localPath = resolveUploadPath(sourceUrl);
  if (localPath) {
    const stat = await fs.stat(localPath).catch(() => null);
    if (!stat?.isFile()) {
      const error = new Error("Generated media file was not found.");
      error.status = 404;
      throw error;
    }
    const contentType = contentTypeForPath(localPath, fallbackType);
    const extension = path.extname(localPath) || extensionForContentType(contentType, fallbackExtension);
    const target = await uniqueDownloadPath(downloadDir, safeDownloadName(stem, extension));
    await fs.copyFile(localPath, target);
    return { savedPath: target };
  }

  if (!/^https?:\/\//i.test(String(sourceUrl || ""))) {
    const error = new Error("Generated media was not found.");
    error.status = 404;
    throw error;
  }

  let response = await fetch(sourceUrl);
  if (!response.ok || !response.body) {
    const error = new Error(`Media download failed with HTTP ${response.status}.`);
    error.status = 502;
    throw error;
  }
  const initialContentType = response.headers.get("content-type") || "";
  if (/application\/json/i.test(initialContentType)) {
    const json = await response.json().catch(() => null);
    const nestedUrl = collectUrls(json).find((item) => item !== sourceUrl);
    if (nestedUrl) response = await fetch(nestedUrl);
    if (!nestedUrl || !response.ok || !response.body) {
      const error = new Error("Media download URL returned JSON instead of a file.");
      error.status = 502;
      throw error;
    }
  }

  const contentType = response.headers.get("content-type") || fallbackType;
  const extension = extensionForContentType(contentType, fallbackExtension);
  const target = await uniqueDownloadPath(downloadDir, safeDownloadName(stem, extension));
  const buffer = Buffer.from(await response.arrayBuffer());
  await fs.writeFile(target, buffer);
  return { savedPath: target };
}

async function uniqueDownloadPath(dir, filename) {
  const extension = path.extname(filename);
  const stem = path.basename(filename, extension);
  let candidate = path.join(dir, filename);
  let index = 2;
  while (existsSync(candidate)) {
    candidate = path.join(dir, `${stem}-${index++}${extension}`);
  }
  return candidate;
}

async function streamDownloadSource(res, sourceUrl, { stem = "connxn_media", fallbackExtension = ".png", fallbackType = "application/octet-stream" } = {}) {
  if (!sourceUrl) {
    sendJson(res, 404, { error: "Generated media was not found." });
    return;
  }

  const localPath = resolveUploadPath(sourceUrl);
  if (localPath) {
    const stat = await fs.stat(localPath).catch(() => null);
    if (!stat?.isFile()) {
      sendJson(res, 404, { error: "Generated media file was not found." });
      return;
    }
    const contentType = contentTypeForPath(localPath, fallbackType);
    const extension = path.extname(localPath) || extensionForContentType(contentType, fallbackExtension);
    res.writeHead(200, {
      "Content-Type": contentType,
      "Content-Length": stat.size,
      "Content-Disposition": contentDispositionAttachment(safeDownloadName(stem, extension))
    });
    createReadStream(localPath).pipe(res);
    return;
  }

  if (!/^https?:\/\//i.test(String(sourceUrl))) {
    sendJson(res, 404, { error: "Generated media was not found." });
    return;
  }
  let response = await fetch(sourceUrl);
  if (!response.ok || !response.body) {
    sendJson(res, 502, { error: `Media download failed with HTTP ${response.status}.` });
    return;
  }
  const initialContentType = response.headers.get("content-type") || "";
  if (/application\/json/i.test(initialContentType)) {
    const json = await response.json().catch(() => null);
    const nestedUrl = collectUrls(json).find((item) => item !== sourceUrl);
    if (nestedUrl) response = await fetch(nestedUrl);
    if (!nestedUrl || !response.ok || !response.body) {
      sendJson(res, 502, { error: "Media download URL returned JSON instead of a file." });
      return;
    }
  }

  const contentType = response.headers.get("content-type") || "";
  const extension = extensionForContentType(contentType, fallbackExtension);
  const headers = {
    "Content-Type": contentType || "application/octet-stream",
    "Content-Disposition": contentDispositionAttachment(safeDownloadName(stem, extension))
  };
  const contentLength = response.headers.get("content-length");
  if (contentLength) headers["Content-Length"] = contentLength;
  res.writeHead(200, headers);
  Readable.fromWeb(response.body).pipe(res);
}

async function streamMessageDownload(res, record) {
  const sourceUrl = record?.message?.result?.url || record?.message?.result?.urls?.[0];
  const fallbackExtension = record.message.kind === "video" ? ".mp4" : record.message.kind === "audio" ? ".mp3" : ".png";
  const fallbackType = record.message.kind === "video" ? "video/mp4" : record.message.kind === "audio" ? "audio/mpeg" : "image/png";
  await streamDownloadSource(res, sourceUrl, { stem: downloadFileStem(record), fallbackExtension, fallbackType });
}

function updateChatTitle(chat, prompt) {
  if (!chat || !prompt) return;
  const untitled = ["New chat", "Image generator", "Video generator", "Audio generator"].includes(chat.title);
  if (!untitled || chat.messages.filter((message) => message.role === "user").length > 1) return;
  chat.title = prompt.trim().replace(/\s+/g, " ").slice(0, 44) || chat.title;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function slugify(value) {
  const base = String(value || "asset")
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
  return base || "asset";
}

function cleanFileName(value) {
  return String(value || "upload")
    .replace(/[/\\?%*:|"<>]/g, "-")
    .replace(/\s+/g, "-")
    .slice(0, 90);
}

function extensionFromMime(mimeType, fileName) {
  const byName = path.extname(fileName || "").toLowerCase();
  if (byName) return byName;
  if (mimeType.includes("png")) return ".png";
  if (mimeType.includes("jpeg") || mimeType.includes("jpg")) return ".jpg";
  if (mimeType.includes("webp")) return ".webp";
  if (mimeType.includes("gif")) return ".gif";
  if (mimeType.includes("mp4")) return ".mp4";
  if (mimeType.includes("quicktime")) return ".mov";
  if (mimeType.includes("webm")) return ".webm";
  if (mimeType.includes("mpeg")) return ".mp3";
  if (mimeType.includes("wav")) return ".wav";
  return ".bin";
}

function mimeFromPath(filePath) {
  return MIME_TYPES[path.extname(filePath || "").toLowerCase()] || "application/octet-stream";
}

function parseDataUrl(dataUrl) {
  const match = /^data:([^;]+);base64,(.*)$/s.exec(dataUrl || "");
  if (!match) throw new Error("Expected a base64 data URL.");
  return {
    mimeType: match[1],
    buffer: Buffer.from(match[2], "base64")
  };
}

async function createAsset(body) {
  const parsed = parseDataUrl(body.dataUrl);
  const mimeType = body.mimeType || parsed.mimeType || "application/octet-stream";
  const originalName = cleanFileName(body.fileName || "upload");
  const ext = extensionFromMime(mimeType, originalName);
  const stem = cleanFileName(originalName.replace(/\.[a-z0-9]+$/i, "")) || "upload";
  const fileName = `${Date.now()}-${crypto.randomBytes(3).toString("hex")}-${stem}${ext}`;
  const localPath = path.join(UPLOAD_DIR, fileName);
  await fs.writeFile(localPath, parsed.buffer);

  const slugBase = slugify(body.label || stem);
  const db = await loadDb();
  let slug = slugBase;
  let index = 2;
  const existing = new Set(db.assets.map((asset) => asset.slug));
  while (existing.has(slug)) {
    slug = `${slugBase}-${index++}`;
  }

  const asset = {
    id: uid("asset"),
    slug,
    label: body.label || stem,
    fileName,
    originalName,
    mimeType,
    size: parsed.buffer.length,
    url: `/uploads/${fileName}`,
    localPath,
    role: body.role || "reference",
    createdAt: now()
  };
  db.assets.unshift(asset);
  await saveDb();
  return safeAsset(asset);
}

async function createAssetFromFile({ sourcePath, fileName, label, mimeType, role = "generated" }) {
  const ext = extensionFromMime(mimeType || mimeFromPath(sourcePath), fileName || sourcePath);
  const originalName = cleanFileName(fileName || `${label || "utility-result"}${ext}`);
  const stem = cleanFileName(originalName.replace(/\.[a-z0-9]+$/i, "")) || "utility-result";
  const finalName = `${Date.now()}-${crypto.randomBytes(3).toString("hex")}-${stem}${ext}`;
  const localPath = path.join(UPLOAD_DIR, finalName);
  await fs.copyFile(sourcePath, localPath);
  const stat = await fs.stat(localPath);

  const slugBase = slugify(label || stem);
  const db = await loadDb();
  let slug = slugBase;
  let index = 2;
  const existing = new Set(db.assets.map((asset) => asset.slug));
  while (existing.has(slug)) slug = `${slugBase}-${index++}`;

  const asset = {
    id: uid("asset"),
    slug,
    label: label || stem,
    fileName: finalName,
    originalName,
    mimeType: mimeType || mimeFromPath(localPath),
    size: stat.size,
    url: `/uploads/${finalName}`,
    localPath,
    role,
    createdAt: now()
  };
  db.assets.unshift(asset);
  await saveDb();
  return safeAsset(asset);
}

async function ensureCanvasGeneratedAsset({ taskId, type, result }) {
  const url = result?.url || result?.urls?.[0] || "";
  if (!url) return null;
  const db = await loadDb();
  const existing = db.assets.find((asset) => asset.canvasTaskId === taskId || asset.url === url);
  if (existing) {
    if (!assetLocalPath(existing) && /^https?:\/\//i.test(existing.url || "")) {
      await materializeRemoteAsset(existing, existing.url, type).catch(() => {});
    }
    return safeAsset(existing);
  }

  let pathName = "";
  try {
    pathName = new URL(url, "https://connxn.local").pathname;
  } catch {
    pathName = "";
  }
  const fallbackMime = type === "video" ? "video/mp4" : type === "audio" ? "audio/mpeg" : "image/png";
  const originalName = cleanFileName(path.basename(pathName) || `canvas-${type}`);
  const slugBase = slugify(`canvas-${type}-${taskId}`);
  let slug = slugBase;
  let index = 2;
  const existingSlugs = new Set(db.assets.map((asset) => asset.slug));
  while (existingSlugs.has(slug)) slug = `${slugBase}-${index++}`;

  const asset = {
    id: uid("asset"),
    slug,
    label: `Canvas ${type}`,
    fileName: originalName,
    originalName,
    mimeType: fallbackMime,
    size: 0,
    url,
    role: "generated",
    source: "canvas",
    canvasTaskId: taskId,
    createdAt: now()
  };
  await materializeRemoteAsset(asset, url, type).catch(() => {});
  db.assets.unshift(asset);
  await saveDb();
  return safeAsset(asset);
}

async function materializeRemoteAsset(asset, sourceUrl, type = "image") {
  if (!asset || !/^https?:\/\//i.test(String(sourceUrl || ""))) return null;
  const response = await fetch(sourceUrl);
  if (!response.ok) throw new Error(`Could not save generated media locally (${response.status}).`);
  const contentType = response.headers.get("content-type") || asset.mimeType || (type === "video" ? "video/mp4" : type === "audio" ? "audio/mpeg" : "image/png");
  const urlPath = new URL(sourceUrl).pathname;
  const originalName = cleanFileName(asset.originalName || path.basename(urlPath) || `canvas-${type}`);
  const ext = extensionFromMime(contentType, originalName);
  const stem = cleanFileName(originalName.replace(/\.[a-z0-9]+$/i, "")) || `canvas-${type}`;
  const fileName = `${Date.now()}-${crypto.randomBytes(3).toString("hex")}-${stem}${ext}`;
  const localPath = path.join(UPLOAD_DIR, fileName);
  const buffer = Buffer.from(await response.arrayBuffer());
  await fs.writeFile(localPath, buffer);

  asset.fileName = fileName;
  asset.originalName = originalName;
  asset.mimeType = contentType;
  asset.size = buffer.length;
  asset.sourceUrl ||= sourceUrl;
  asset.url = `/uploads/${fileName}`;
  asset.localPath = localPath;
  delete asset.kieUrl;
  delete asset.kieUploadedAt;
  return asset;
}

function resolveUploadPath(sourceUrl) {
  if (!sourceUrl || !String(sourceUrl).startsWith("/uploads/")) return "";
  const relative = decodeURIComponent(String(sourceUrl).replace(/^\/uploads\//, ""));
  const target = path.resolve(UPLOAD_DIR, relative);
  if (!target.startsWith(path.resolve(UPLOAD_DIR) + path.sep)) {
    const error = new Error("Forbidden upload path.");
    error.status = 403;
    throw error;
  }
  return target;
}

// db.json stores an absolute localPath from whichever machine wrote it, so a
// project folder copied between machines (or between macOS and Windows) points
// at paths that no longer exist. Re-anchor onto this checkout's upload dir.
// Generated assets that only live on a remote URL have no local file at all.
function assetLocalPath(asset) {
  if (!asset) return "";
  try {
    const resolved = resolveUploadPath(asset.url);
    if (resolved && existsSync(resolved)) return resolved;
  } catch {}
  if (!asset.localPath) return "";
  if (existsSync(asset.localPath)) return asset.localPath;
  if (asset.fileName) {
    const local = path.join(UPLOAD_DIR, asset.fileName);
    if (existsSync(local)) return local;
  }
  return "";
}

async function prepareUtilitySource(sourceUrl) {
  const local = resolveUploadPath(sourceUrl);
  if (local) return { path: local, cleanup: async () => {}, originalName: path.basename(local) };
  if (!/^https?:\/\//i.test(String(sourceUrl || ""))) {
    const error = new Error("Utility source media is missing.");
    error.status = 400;
    throw error;
  }

  const response = await fetch(sourceUrl);
  if (!response.ok) {
    const error = new Error(`Could not fetch utility source (${response.status}).`);
    error.status = 502;
    throw error;
  }
  const tmpDir = path.join(DATA_DIR, "tmp");
  await fs.mkdir(tmpDir, { recursive: true });
  const urlPath = new URL(sourceUrl).pathname;
  const ext = path.extname(urlPath).slice(0, 8) || extensionFromMime(response.headers.get("content-type") || "", "");
  const tmpPath = path.join(tmpDir, `${uid("source")}${ext || ".bin"}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  await fs.writeFile(tmpPath, buffer);
  return { path: tmpPath, cleanup: async () => fs.unlink(tmpPath).catch(() => {}), originalName: path.basename(urlPath) || path.basename(tmpPath) };
}

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(FFMPEG_BIN, ["-hide_banner", "-y", ...args], { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr.trim().split("\n").slice(-4).join("\n") || `ffmpeg exited with ${code}`));
    });
  });
}

function clampSecond(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

async function handleCanvasUtility(body) {
  const type = String(body.nodeType || body.type || "");
  const settings = body.settings || {};
  const source = body.source || {};
  if (type === "reference") {
    return { result: source, asset: source.assetId ? (await loadDb()).assets.map(safeAsset).find((asset) => asset.id === source.assetId) : null };
  }
  if (!["extractFrame", "resize", "trim"].includes(type)) {
    const error = new Error("Unsupported utility node.");
    error.status = 400;
    throw error;
  }

  const prepared = await prepareUtilitySource(source.url);
  const tmpDir = path.join(DATA_DIR, "tmp");
  await fs.mkdir(tmpDir, { recursive: true });
  const sourceType = source.type || (String(source.mimeType || "").startsWith("video/") ? "video" : "image");
  const outputIsVideo = type === "trim" || (sourceType === "video" && type === "resize");
  const ext = type === "extractFrame" || !outputIsVideo ? ".png" : ".mp4";
  const outPath = path.join(tmpDir, `${uid("utility")}${ext}`);

  try {
    if (type === "extractFrame") {
      const seekArgs = settings.frame === "last" ? ["-sseof", "-0.08"] : ["-ss", "0"];
      await runFfmpeg([...seekArgs, "-i", prepared.path, "-frames:v", "1", "-an", outPath]);
    } else if (type === "resize") {
      const width = Math.max(16, Math.min(8192, Math.round(Number(settings.width) || 1024)));
      const heightRaw = Math.round(Number(settings.height) || 0);
      const height = heightRaw > 0 ? Math.max(16, Math.min(8192, heightRaw)) : -2;
      const fit = settings.fit === "stretch" ? `scale=${width}:${height > 0 ? height : -2}`
        : settings.fit === "cover" && height > 0 ? `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height}`
        : height > 0 ? `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2`
        : `scale=${width}:-2`;
      if (outputIsVideo) await runFfmpeg(["-i", prepared.path, "-vf", fit, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-movflags", "+faststart", outPath]);
      else await runFfmpeg(["-i", prepared.path, "-vf", fit, "-frames:v", "1", outPath]);
    } else if (type === "trim") {
      const start = clampSecond(settings.start, 0);
      const end = clampSecond(settings.end, start + 5);
      const duration = Math.max(0.1, end - start);
      await runFfmpeg(["-ss", String(start), "-i", prepared.path, "-t", String(duration), "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-movflags", "+faststart", outPath]);
    }

    const mimeType = outputIsVideo ? "video/mp4" : "image/png";
    const asset = await createAssetFromFile({
      sourcePath: outPath,
      fileName: `${type}-${prepared.originalName || "media"}${ext}`,
      label: `${type.replace(/[A-Z]/g, (m) => ` ${m.toLowerCase()}`)} result`,
      mimeType,
      role: "generated"
    });
    return {
      asset,
      result: {
        url: asset.url,
        type: outputIsVideo ? "video" : "image",
        assetId: asset.id,
        mimeType: asset.mimeType,
        label: asset.label,
        sourceUrl: source.url,
        materialized: true,
        transform: { type, settings: { ...settings } }
      }
    };
  } finally {
    await prepared.cleanup();
    await fs.unlink(outPath).catch(() => {});
  }
}

async function handleGenerate(body) {
  const db = await loadDb();
  const type = body.type === "video" ? "video" : body.type === "audio" ? "audio" : "image";
  const chat = findChat(db, type, body.chatId);
  if (!chat) {
    const error = new Error("Chat not found.");
    error.status = 404;
    throw error;
  }

  const prompt = String(body.prompt || "").trim();
  if (!prompt) {
    const error = new Error("Prompt is empty.");
    error.status = 400;
    throw error;
  }

  const refs = normalizeRefs(db, body.refs || []);
  const options = body.options || {};
  const requestedContextImageUrl = /^https?:\/\//i.test(String(body.contextImageUrl || "")) ? String(body.contextImageUrl) : "";
  const contextImageUrl = type === "image" && body.editContext && refs.length === 0
    ? requestedContextImageUrl || latestImageResultUrl(chat)
    : "";
  const userMessage = {
    id: uid("msg"),
    role: "user",
    text: prompt,
    refs,
    editContext: Boolean(contextImageUrl),
    contextImageUrl,
    options,
    createdAt: now()
  };
  const assistantMessage = {
    id: uid("msg"),
    role: "assistant",
    kind: type,
    status: "generating",
    text: type === "image" ? "Generating image" : type === "audio" ? "Generating audio" : "Generating video",
    refs,
    editContext: Boolean(contextImageUrl),
    options,
    promptId: userMessage.id,
    createdAt: now()
  };

  chat.messages.push(userMessage, assistantMessage);
  chat.updatedAt = now();
  updateChatTitle(chat, prompt);

  if (!process.env.KIE_API_KEY) {
    assistantMessage.status = "error";
    assistantMessage.text = "KIE key required";
    assistantMessage.error = "Add your KIE API key in Account before generating.";
    chat.updatedAt = now();
    await saveDb();
    return { chat, message: assistantMessage, mode: "error" };
  }

  try {
    const task = await createKieTask(type, prompt, options, refs, db, contextImageUrl ? [contextImageUrl] : []);
    assistantMessage.status = "queued";
    assistantMessage.taskId = task.taskId;
    assistantMessage.raw = task.raw;
    assistantMessage.text = "KIE task queued";
    chat.updatedAt = now();
    await saveDb();
    return { chat, message: assistantMessage, mode: "kie" };
  } catch (error) {
    assistantMessage.status = "error";
    assistantMessage.text = "KIE task failed to start";
    assistantMessage.error = error.message;
    chat.updatedAt = now();
    await saveDb();
    return { chat, message: assistantMessage, mode: "error" };
  }
}

async function handleCanvasGenerate(body) {
  const db = await loadDb();
  const type = body.type === "video" ? "video" : body.type === "audio" ? "audio" : "image";
  const prompt = String(body.prompt || "").trim();
  if (!prompt) {
    const error = new Error("Prompt is empty.");
    error.status = 400;
    throw error;
  }

  const refs = normalizeRefs(db, body.refs || []);
  const options = body.options || {};
  const message = {
    id: uid("canvasmsg"),
    kind: type,
    status: "generating",
    text: type === "image" ? "Generating image" : type === "audio" ? "Generating audio" : "Generating video",
    refs,
    options,
    createdAt: now()
  };

  if (!process.env.KIE_API_KEY) {
    message.status = "error";
    message.error = "Add your KIE API key in Account before generating.";
    return { message, mode: "error" };
  }

  try {
    const task = await createKieTask(type, prompt, options, refs, db);
    message.status = "queued";
    message.taskId = task.taskId;
    message.raw = task.raw;
    message.text = "KIE task queued";
    return { message, mode: "kie" };
  } catch (error) {
    message.status = "error";
    message.text = "KIE task failed to start";
    message.error = error.message;
    return { message, mode: "error" };
  }
}

async function handleRegenerate(chatId, messageId) {
  const db = await loadDb();
  const type = db.chats.video.some((chat) => chat.id === chatId) ? "video"
    : db.chats.audio.some((chat) => chat.id === chatId) ? "audio"
      : "image";
  const chat = findChat(db, type, chatId);
  if (!chat) {
    const error = new Error("Chat not found.");
    error.status = 404;
    throw error;
  }

  const sourceIndex = chat.messages.findIndex((message) => message.id === messageId && message.role === "assistant");
  if (sourceIndex === -1) {
    const error = new Error("Generation result not found.");
    error.status = 404;
    throw error;
  }

  const upscaleSource = chat.messages[sourceIndex];
  if (upscaleSource.upscaleOf) {
    return handleUpscale(chatId, upscaleSource.upscaleOf, upscaleSource.options || {});
  }

  let promptMessage = null;
  for (let index = sourceIndex - 1; index >= 0; index -= 1) {
    if (chat.messages[index].role === "user") {
      promptMessage = chat.messages[index];
      break;
    }
  }
  if (!promptMessage) {
    const error = new Error("Original prompt not found.");
    error.status = 400;
    throw error;
  }

  const sourceMessage = chat.messages[sourceIndex];
  const prompt = String(promptMessage.text || "").trim();
  const refs = normalizeRefs(db, sourceMessage.refs || promptMessage.refs || []);
  const options = sourceMessage.options || promptMessage.options || {};
  const contextImageUrl = type === "image" ? String(promptMessage.contextImageUrl || "") : "";
  const assistantMessage = {
    id: uid("msg"),
    role: "assistant",
    kind: type,
    status: "generating",
    text: type === "image" ? "Regenerating image" : "Regenerating video",
    refs,
    editContext: Boolean(contextImageUrl),
    options,
    promptId: promptMessage.id,
    regeneratedFrom: sourceMessage.id,
    createdAt: now()
  };

  chat.messages.push(assistantMessage);
  chat.updatedAt = now();

  if (!process.env.KIE_API_KEY) {
    assistantMessage.status = "error";
    assistantMessage.error = "Add your KIE API key in Account before generating.";
    await saveDb();
    return { chat, message: assistantMessage, mode: "error" };
  }

  try {
    const task = await createKieTask(type, prompt, options, refs, db, contextImageUrl ? [contextImageUrl] : []);
    assistantMessage.status = "queued";
    assistantMessage.taskId = task.taskId;
    assistantMessage.raw = task.raw;
    assistantMessage.text = "KIE task queued";
    await saveDb();
    return { chat, message: assistantMessage, mode: "kie" };
  } catch (error) {
    assistantMessage.status = "error";
    assistantMessage.text = "KIE task failed to start";
    assistantMessage.error = error.message;
    await saveDb();
    return { chat, message: assistantMessage, mode: "error" };
  }
}

function normalizeRefs(db, refs) {
  const byId = new Map(db.assets.map((asset) => [asset.id, asset]));
  const bySlug = new Map(db.assets.map((asset) => [asset.slug, asset]));
  return refs
    .map((ref) => {
      const asset = byId.get(ref.id) || bySlug.get(ref.slug);
      if (!asset && !ref.url) return null;
      return {
        id: asset?.id || ref.id || `remote_${Date.now()}`,
        slug: asset?.slug || ref.slug || "pipeline-output",
        label: asset?.label || ref.label || "Pipeline output",
        url: asset?.url || ref.url,
        mimeType: asset?.mimeType || ref.mimeType || "image/png",
        role: ref.role || asset?.role || "reference"
      };
    })
    .filter(Boolean);
}

function latestImageResultUrl(chat) {
  for (let index = (chat?.messages?.length || 0) - 1; index >= 0; index -= 1) {
    const message = chat.messages[index];
    if (message.role !== "assistant" || message.status !== "success" || message.result?.mock) continue;
    if ((message.result?.type || message.kind) !== "image") continue;
    const url = message.result?.url || message.result?.urls?.[0];
    if (url) return url;
  }
  return "";
}

async function createKieTask(type, prompt, options, refs, db, contextImageUrls = []) {
  const payload = type === "image"
    ? await buildKieImagePayload(prompt, options, refs, db, contextImageUrls)
    : type === "audio"
      ? buildKieAudioPayload(prompt, options)
      : await buildKieVideoPayload(prompt, options, refs, db);

  const response = await fetch("https://api.kie.ai/api/v1/jobs/createTask", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.KIE_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  const json = await response.json().catch(() => ({}));
  if (!response.ok || !json?.data?.taskId) {
    throw new Error(json?.msg || `KIE createTask failed with HTTP ${response.status}`);
  }
  return { taskId: json.data.taskId, raw: json };
}

function buildKieAudioPayload(prompt, options) {
  if (String(options.model || "").startsWith("elevenlabs/")) {
    return {
      model: options.model,
      input: {
        voice: options.voice || "Rachel",
        text: prompt,
        stability: Number(options.stability ?? 0.5),
        similarity_boost: Number(options.similarityBoost ?? 0.75),
        speed: Number(options.speed ?? 1)
      }
    };
  }
  return {
    model: "suno",
    input: {
      customMode: Boolean(options.customMode),
      instrumental: Boolean(options.instrumental),
      model: options.model || "V5",
      prompt,
      ...(options.style ? { style: options.style } : {}),
      ...(options.title ? { title: options.title } : {})
    }
  };
}

const SEEDREAM5_IMAGE_MODELS = {
  "seedream/5-pro-text-to-image": {
    editModel: "seedream/5-pro-image-to-image",
    maxRefs: 10,
    qualities: ["basic", "high"],
    defaultQuality: "high",
    outputFormats: ["png", "jpeg"]
  },
  "seedream/5-lite-text-to-image": {
    editModel: "seedream/5-lite-image-to-image",
    maxRefs: 14,
    qualities: ["basic", "high", "ultra"],
    defaultQuality: "basic",
    outputFormats: ["png", "jpeg"]
  }
};
const SEEDREAM5_RATIOS = new Set(["1:1", "4:3", "3:4", "16:9", "9:16", "2:3", "3:2", "21:9"]);

async function buildKieImagePayload(prompt, options, refs, db, contextImageUrls = []) {
  let model = options.model || "nano-banana-2";
  const aspect = options.aspectRatio || "1:1";
  const input = { prompt };
  const imageUrls = contextImageUrls.filter((url) => /^https?:\/\//i.test(url));

  for (const ref of refs) {
    const asset = db.assets.find((item) => item.id === ref.id);
    if (!asset?.mimeType?.startsWith("image/") && !ref.url) continue;
    imageUrls.push(asset ? await ensureKieAssetUrl(asset) : ref.url);
  }
  if (imageUrls.length) await saveDb();

  if (imageUrls.length && [
    "flux-2/flex-text-to-image",
    "google/imagen4"
  ].includes(model)) {
    model = "nano-banana-2";
  }

  if (model === "google/nano-banana") {
    input.aspect_ratio = aspect;
    input.output_format = options.outputFormat || "png";
    if (imageUrls.length) {
      model = "google/nano-banana-edit";
      input.image_urls = imageUrls.slice(0, 4);
    }
  } else if (model === "nano-banana-2" || model === "nano-banana-pro") {
    input.aspect_ratio = aspect;
    input.resolution = options.resolution || "1K";
    input.output_format = options.outputFormat || "png";
    input.image_input = imageUrls.slice(0, 8);
  } else if (model.includes("flux-2")) {
    if (imageUrls.length && model === "flux-2/pro-text-to-image") {
      model = "flux-2/pro-image-to-image";
      input.input_urls = imageUrls.slice(0, 8);
    }
    input.aspect_ratio = aspect;
    input.resolution = options.resolution || "1K";
    input.nsfw_checker = false;
  } else if (SEEDREAM5_IMAGE_MODELS[model]) {
    const spec = SEEDREAM5_IMAGE_MODELS[model];
    if (imageUrls.length) {
      model = spec.editModel;
      input.image_urls = imageUrls.slice(0, spec.maxRefs);
    }
    const format = options.outputFormat === "jpg" ? "jpeg" : (options.outputFormat || "png");
    input.aspect_ratio = SEEDREAM5_RATIOS.has(aspect) ? aspect : "1:1";
    input.quality = spec.qualities.includes(options.quality) ? options.quality : spec.defaultQuality;
    if (spec.outputFormats.includes(format)) input.output_format = format;
    input.nsfw_checker = options.nsfwChecker === undefined ? false : Boolean(options.nsfwChecker);
  } else if (model.includes("seedream")) {
    if (imageUrls.length) {
      model = "bytedance/seedream-v4-edit";
      input.image_urls = imageUrls.slice(0, 8);
    }
    input.image_size = aspect === "1:1" ? "square_hd" : aspect;
    input.image_resolution = options.resolution || "1K";
    input.max_images = 1;
    input.nsfw_checker = true;
  } else if (model.includes("imagen")) {
    input.aspect_ratio = aspect;
    input.negative_prompt = options.negativePrompt || "";
    input.seed = options.seed || "";
  } else if (model.includes("grok-imagine")) {
    if (imageUrls.length) {
      model = "grok-imagine/image-to-image";
      input.image_urls = imageUrls.slice(0, 4);
    } else {
      input.aspect_ratio = aspect;
    }
  } else {
    if (imageUrls.length && model === "gpt-image-2-text-to-image") {
      model = "gpt-image-2-image-to-image";
      input.input_urls = imageUrls.slice(0, 5);
    }
    if (imageUrls.length && model === "gpt-image/1.5-text-to-image") {
      model = "gpt-image/1.5-image-to-image";
      input.input_urls = imageUrls.slice(0, 5);
    }
    input.aspect_ratio = aspect;
    if (options.quality) input.quality = options.quality;
  }

  return { model, input };
}

/* KIE upscale catalog. Model ids and input fields follow the KIE market docs:
   topaz/image-upscale, recraft/crisp-upscale, topaz/video-upscale, grok-imagine/upscale. */
const KIE_UPSCALE_MODELS = {
  "topaz/image-upscale": {
    label: "Topaz Image Upscale",
    family: "Topaz",
    kind: "image",
    source: "url",
    note: "Sharp detail recovery up to 4x. Source must be JPEG, PNG or WebP under 10MB.",
    factors: [["1", "1x"], ["2", "2x"], ["4", "4x"]],
    defaultFactor: "2"
  },
  "recraft/crisp-upscale": {
    label: "Recraft Crisp Upscale",
    family: "Recraft",
    kind: "image",
    source: "url",
    note: "Single-pass crisp upscale with noise cleanup. No extra settings."
  },
  "topaz/video-upscale": {
    label: "Topaz Video Upscale",
    family: "Topaz",
    kind: "video",
    source: "url",
    note: "Frame-by-frame video upscale up to 4x. Source must be MP4, MOV or MKV under 50MB.",
    factors: [["1", "1x"], ["2", "2x"], ["4", "4x"]],
    defaultFactor: "2"
  },
  "grok-imagine/upscale": {
    label: "Grok Imagine Upscale",
    family: "Grok",
    kind: "video",
    source: "taskId",
    note: "Re-renders the original KIE video task at a higher resolution. Only works on videos generated here.",
    resolutions: [["720p", "720p"], ["1080p", "1080p"]],
    defaultResolution: "1080p"
  }
};

const UPSCALE_MODEL_CATALOG = Object.entries(KIE_UPSCALE_MODELS).map(([id, spec]) => ({ id, ...spec }));

function upscaleModelsForKind(kind) {
  return UPSCALE_MODEL_CATALOG.filter((model) => model.kind === kind);
}

function defaultUpscaleModel(kind) {
  return upscaleModelsForKind(kind)[0]?.id || "";
}

function buildKieUpscalePayload(modelId, spec, source, options) {
  const input = {};

  if (spec.source === "taskId") {
    if (!source.taskId) {
      throw new Error(`${spec.label} needs the original KIE task id, which this result does not carry.`);
    }
    input.task_id = source.taskId;
  } else {
    if (!/^https?:\/\//i.test(source.url || "")) {
      throw new Error("Upscale needs a public media URL. Re-run the generation and try again.");
    }
    if (spec.kind === "video") input.video_url = source.url;
    else if (modelId === "recraft/crisp-upscale") input.image = source.url;
    else input.image_url = source.url;
  }

  if (spec.factors) {
    const allowed = spec.factors.map(([value]) => value);
    const requested = String(options.upscaleFactor ?? spec.defaultFactor);
    input.upscale_factor = allowed.includes(requested) ? requested : spec.defaultFactor;
  }
  if (spec.resolutions) {
    const allowed = spec.resolutions.map(([value]) => value);
    const requested = String(options.upscaleResolution ?? spec.defaultResolution);
    input.resolution = allowed.includes(requested) ? requested : spec.defaultResolution;
  }

  return { model: modelId, input };
}

async function createKieUpscaleTask(modelId, spec, source, options) {
  const payload = buildKieUpscalePayload(modelId, spec, source, options);

  const response = await fetch("https://api.kie.ai/api/v1/jobs/createTask", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.KIE_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  const json = await response.json().catch(() => ({}));
  if (!response.ok || !json?.data?.taskId) {
    throw new Error(json?.msg || `KIE createTask failed with HTTP ${response.status}`);
  }
  return { taskId: json.data.taskId, raw: json };
}

async function handleUpscale(chatId, messageId, body = {}) {
  const db = await loadDb();
  const type = (db.chats.video || []).some((chat) => chat.id === chatId) ? "video" : "image";
  const chat = findChat(db, type, chatId);
  if (!chat) {
    const error = new Error("Chat not found.");
    error.status = 404;
    throw error;
  }

  const sourceMessage = chat.messages.find((item) => item.id === messageId && item.role === "assistant");
  if (!sourceMessage) {
    const error = new Error("Generation result not found.");
    error.status = 404;
    throw error;
  }

  const sourceUrl = sourceMessage.result?.url || sourceMessage.result?.urls?.[0] || "";
  if (!sourceUrl) {
    const error = new Error("This generation has no media to upscale yet.");
    error.status = 400;
    throw error;
  }

  const kind = sourceMessage.kind === "video" ? "video" : "image";
  const modelId = String(body.model || defaultUpscaleModel(kind));
  const spec = KIE_UPSCALE_MODELS[modelId];
  if (!spec) {
    const error = new Error("Unknown upscale model.");
    error.status = 400;
    throw error;
  }
  if (spec.kind !== kind) {
    const error = new Error(`${spec.label} only accepts ${spec.kind} input.`);
    error.status = 400;
    throw error;
  }

  const options = {
    ...(sourceMessage.options || {}),
    model: modelId,
    upscale: true,
    upscaleFactor: body.upscaleFactor ?? spec.defaultFactor ?? "",
    upscaleResolution: body.upscaleResolution ?? spec.defaultResolution ?? "",
    sourceModel: sourceMessage.options?.model || ""
  };

  const assistantMessage = {
    id: uid("msg"),
    role: "assistant",
    kind,
    status: "generating",
    text: `Upscaling with ${spec.label}`,
    refs: [],
    options,
    upscaleOf: sourceMessage.id,
    promptId: sourceMessage.promptId || "",
    createdAt: now()
  };

  chat.messages.push(assistantMessage);
  chat.updatedAt = now();

  if (!process.env.KIE_API_KEY) {
    assistantMessage.status = "error";
    assistantMessage.text = "Upscale failed to start";
    assistantMessage.error = "Add your KIE API key in Account before upscaling.";
    await saveDb();
    return { chat, message: assistantMessage, mode: "error" };
  }

  try {
    const task = await createKieUpscaleTask(modelId, spec, {
      url: sourceUrl,
      taskId: sourceMessage.result?.taskId || sourceMessage.taskId || ""
    }, options);
    assistantMessage.status = "queued";
    assistantMessage.taskId = task.taskId;
    assistantMessage.raw = task.raw;
    assistantMessage.text = "KIE upscale queued";
    await saveDb();
    return { chat, message: assistantMessage, mode: "kie" };
  } catch (error) {
    assistantMessage.status = "error";
    assistantMessage.text = "Upscale failed to start";
    assistantMessage.error = error.message;
    await saveDb();
    return { chat, message: assistantMessage, mode: "error" };
  }
}

async function validateKieKey() {
  if (!process.env.KIE_API_KEY) {
    return { ok: false, status: "missing", credits: null, message: "No KIE key stored." };
  }

  try {
    const response = await fetch("https://api.kie.ai/api/v1/chat/credit", {
      headers: { Authorization: `Bearer ${process.env.KIE_API_KEY}` }
    });
    const json = await response.json().catch(() => ({}));
    if (!response.ok || json?.code !== 200) {
      return {
        ok: false,
        status: "invalid",
        credits: null,
        message: json?.msg || `KIE returned HTTP ${response.status}`
      };
    }
    return { ok: true, status: "verified", credits: Number(json.data), message: "KIE connected." };
  } catch (error) {
    return { ok: false, status: "offline", credits: null, message: error.message };
  }
}

async function buildKieVideoPayload(prompt, options, refs, db) {
  const uploadedRefs = [];
  for (const ref of refs) {
    const asset = db.assets.find((item) => item.id === ref.id);
    if (!asset && !ref.url) continue;
    uploadedRefs.push({
      ...ref,
      kieUrl: asset ? await ensureKieAssetUrl(asset) : ref.url
    });
  }
  await saveDb();

  const requestedModel = options.model || "wan-2.7-auto";
  const aspect = options.aspectRatio || "16:9";
  const duration = String(options.duration || "5");
  const resolution = options.resolution || "1080p";
  const negative = options.negativePrompt || "blurry, flicker, low quality, distorted";
  const explicitStart = uploadedRefs.find((ref) => ref.role === "start");
  const end = uploadedRefs.find((ref) => ref.role === "end");
  const continuation = uploadedRefs.find((ref) => ref.role === "continuation");
  const imageRefs = uploadedRefs.filter((ref) => ref.mimeType?.startsWith("image/"));
  const referenceImages = imageRefs.filter((ref) => ref.role === "reference");
  const referenceVideos = uploadedRefs.filter((ref) => ref.mimeType?.startsWith("video/") && ref.role !== "continuation");
  const audioRefs = uploadedRefs.filter((ref) => ref.mimeType?.startsWith("audio/"));
  const start = explicitStart || (requestedModel.startsWith("wan") ? referenceImages[0] : null);

  if ([
    "bytedance/seedance-2-5",
    "bytedance/seedance-2",
    "bytedance/seedance-2-fast",
    "bytedance/seedance-2-mini"
  ].includes(requestedModel)) {
    const frameMode = Boolean(explicitStart || end);
    const referenceMode = Boolean(referenceImages.length || referenceVideos.length || audioRefs.length);
    if (frameMode && referenceMode) {
      throw new Error("Seedance frame mode cannot be mixed with multimodal references. Use Start/End or Reference inputs, not both.");
    }
    if (end && !explicitStart) throw new Error("Seedance requires a Start frame when an End frame is attached.");

    const durationNumber = Number(duration);
    if (requestedModel === "bytedance/seedance-2-5") {
      if (!Number.isInteger(durationNumber) || durationNumber < 1 || durationNumber > 30) {
        throw new Error("Seedance 2.5 duration must be an integer from 1 to 30 seconds.");
      }
      if (!["480p", "720p", "1080p"].includes(resolution)) {
        throw new Error("KIE currently exposes 480p, 720p and 1080p for Seedance 2.5.");
      }
    }
    if (requestedModel === "bytedance/seedance-2") {
      if (!Number.isInteger(durationNumber) || durationNumber < 4 || durationNumber > 15) {
        throw new Error("Seedance 2.0 duration must be an integer from 4 to 15 seconds.");
      }
      if (!["480p", "720p", "1080p", "4k"].includes(resolution)) {
        throw new Error("Unsupported Seedance 2.0 resolution.");
      }
    }

    const input = {
      prompt,
      return_last_frame: Boolean(options.returnLastFrame),
      generate_audio: Boolean(options.sound),
      resolution,
      aspect_ratio: aspect,
      duration: Number(duration)
    };
    if (requestedModel !== "bytedance/seedance-2-5") input.web_search = Boolean(options.webSearch);
    if (frameMode) {
      if (explicitStart) input.first_frame_url = explicitStart.kieUrl;
      if (end) input.last_frame_url = end.kieUrl;
    } else if (referenceMode) {
      input.reference_image_urls = referenceImages.slice(0, requestedModel === "bytedance/seedance-2-5" ? 30 : 9).map((ref) => ref.kieUrl);
      input.reference_video_urls = referenceVideos.slice(0, requestedModel === "bytedance/seedance-2-5" ? 10 : 3).map((ref) => ref.kieUrl);
      input.reference_audio_urls = audioRefs.slice(0, requestedModel === "bytedance/seedance-2-5" ? 10 : 3).map((ref) => ref.kieUrl);
    }
    return { model: requestedModel, input };
  }

  if (requestedModel === "bytedance/seedance-1.5-pro") {
    const input = {
      prompt,
      input_urls: [explicitStart, end, ...referenceImages].filter(Boolean).slice(0, 2).map((ref) => ref.kieUrl),
      aspect_ratio: aspect,
      resolution: resolution === "4K" ? "1080p" : resolution,
      duration: Number(duration),
      fixed_lens: Boolean(options.fixedLens),
      generate_audio: Boolean(options.sound),
      nsfw_checker: false
    };
    return { model: requestedModel, input };
  }

  if (requestedModel === "kling-v3-turbo-auto") {
    const sourceImage = explicitStart || referenceImages[0];
    return {
      model: sourceImage ? "kling/v3-turbo-image-to-video" : "kling/v3-turbo-text-to-video",
      input: {
        prompt,
        ...(sourceImage ? { image_urls: [sourceImage.kieUrl] } : { aspect_ratio: aspect }),
        duration,
        resolution
      }
    };
  }

  if (requestedModel === "bytedance/v1-pro-text-to-video") {
    return {
      model: requestedModel,
      input: {
        prompt,
        aspect_ratio: aspect,
        resolution: ["480p", "720p", "1080p"].includes(resolution) ? resolution : "720p",
        duration,
        camera_fixed: Boolean(options.fixedLens),
        seed: Number(options.seed ?? -1),
        enable_safety_checker: true,
        nsfw_checker: false
      }
    };
  }

  if (requestedModel === "wan/2-7-r2v") {
    const input = {
      prompt,
      negative_prompt: negative,
      reference_image: referenceImages.slice(0, 4).map((ref) => ref.kieUrl),
      reference_video: uploadedRefs.filter((ref) => ref.mimeType?.startsWith("video/")).slice(0, 2).map((ref) => ref.kieUrl),
      resolution,
      aspect_ratio: aspect,
      duration: Number(duration),
      prompt_extend: true,
      watermark: false,
      seed: Number(options.seed || 0)
    };
    if (explicitStart) input.first_frame = explicitStart.kieUrl;
    if (audioRefs[0]) input.reference_voice = audioRefs[0].kieUrl;
    return { model: requestedModel, input };
  }

  if (requestedModel === "wan/2-7-videoedit") {
    const sourceVideo = uploadedRefs.find((ref) => ref.mimeType?.startsWith("video/"));
    if (!sourceVideo) throw new Error("Wan Video Edit requires a video attachment.");
    const input = {
      prompt,
      negative_prompt: negative,
      video_url: sourceVideo.kieUrl,
      resolution,
      aspect_ratio: aspect,
      duration: Number(duration),
      audio_setting: options.sound ? "on" : "auto",
      prompt_extend: true,
      watermark: false,
      seed: Number(options.seed || 0)
    };
    if (referenceImages[0]) input.reference_image = referenceImages[0].kieUrl;
    return { model: requestedModel, input };
  }

  if (requestedModel === "grok-imagine-video-1-5-preview") {
    return {
      model: requestedModel,
      input: {
        prompt,
        image_urls: [explicitStart, end, ...referenceImages].filter(Boolean).slice(0, 7).map((ref) => ref.kieUrl),
        aspect_ratio: aspect,
        resolution: ["480p", "720p", "1080p"].includes(resolution) ? resolution : "480p",
        duration: Number(duration)
      }
    };
  }

  if (["hailuo/2-3-image-to-video-pro", "hailuo/2-3-image-to-video-standard"].includes(requestedModel)) {
    const sourceImage = explicitStart || referenceImages[0];
    if (!sourceImage) throw new Error("Hailuo 2.3 requires a start or reference image.");
    return {
      model: requestedModel,
      input: {
        prompt,
        image_url: sourceImage.kieUrl,
        duration: duration === "10" ? "10" : "6",
        resolution: resolution === "1080P" ? "1080P" : "768P",
        nsfw_checker: options.nsfwChecker === undefined ? false : Boolean(options.nsfwChecker)
      }
    };
  }

  if (requestedModel === "gemini-omni-video") {
    const sourceVideo = uploadedRefs.find((ref) => ref.mimeType?.startsWith("video/"));
    const input = {
      prompt,
      image_urls: imageRefs.slice(0, 5).map((ref) => ref.kieUrl),
      duration,
      aspect_ratio: ["16:9", "9:16"].includes(aspect) ? aspect : "16:9",
      resolution: ["720p", "1080p", "4k"].includes(resolution) ? resolution : "720p"
    };
    if (sourceVideo) input.video_list = [{ url: sourceVideo.kieUrl, start: 0, ends: Number(duration) }];
    return { model: requestedModel, input };
  }

  if (["hailuo/02-text-to-video-pro", "hailuo/02-text-to-video-standard"].includes(requestedModel)) {
    return {
      model: requestedModel,
      input: {
        prompt,
        duration: duration === "10" ? "10" : "6",
        prompt_optimizer: options.promptExtend !== false,
        nsfw_checker: options.nsfwChecker === undefined ? false : Boolean(options.nsfwChecker)
      }
    };
  }

  if (requestedModel === "grok-imagine-auto") {
    const sourceImage = explicitStart || referenceImages[0];
    return {
      model: sourceImage ? "grok-imagine/image-to-video" : "grok-imagine/text-to-video",
      input: {
        prompt,
        ...(sourceImage ? { image_urls: [sourceImage.kieUrl], aspect_ratio: aspect } : { aspect_ratio: aspect }),
        mode: "normal",
        duration,
        resolution
      }
    };
  }

  if (requestedModel === "kling-2.6-auto") {
    const model = imageRefs.length ? "kling-2.6/image-to-video" : "kling-2.6/text-to-video";
    const input = {
      prompt,
      sound: Boolean(options.sound),
      aspect_ratio: aspect,
      duration
    };
    if (imageRefs.length) input.image_urls = imageRefs.slice(0, 2).map((ref) => ref.kieUrl);
    return { model, input };
  }

  if (requestedModel === "kling-3.0/video") {
    const elementSources = uploadedRefs
      .filter((ref) => ref.role === "reference" && !ref.mimeType?.startsWith("audio/"))
      .slice(0, 3);
    const elementRefs = elementSources.map((ref, index) => ({
      ref,
      audio: audioRefs[index],
      name: `element_${ref.slug.replace(/[^a-z0-9_]+/gi, "_")}`
    }));
    let resolvedPrompt = prompt;
    for (const element of elementRefs) {
      resolvedPrompt = resolvedPrompt.split(`@${element.ref.slug}`).join(`@${element.name}`);
    }
    const input = {
      prompt: resolvedPrompt,
      aspect_ratio: aspect,
      duration,
      mode: options.quality === "4K" ? "4K" : options.quality === "pro" ? "pro" : "std",
      multi_shots: false,
      sound: Boolean(options.sound)
    };
    const durationNumber = Number(duration);
    if (!Number.isInteger(durationNumber) || durationNumber < 3 || durationNumber > 15) {
      throw new Error("Kling 3.0 duration must be an integer from 3 to 15 seconds.");
    }
    const frameUrls = [explicitStart, end].filter(Boolean).map((ref) => ref.kieUrl);
    if (frameUrls.length) input.image_urls = frameUrls;
    if (elementRefs.length) {
      input.kling_elements = elementRefs.map(({ ref, audio, name }) => {
        const urls = ref.mimeType?.startsWith("image/") ? [ref.kieUrl, ref.kieUrl] : [ref.kieUrl];
        return {
          name,
          description: ref.label || ref.slug,
          element_input_urls: urls,
          ...(audio ? { element_input_audio_urls: [audio.kieUrl] } : {})
        };
      });
    }
    return { model: "kling-3.0/video", input };
  }

  if (requestedModel === "wan/2-7-text-to-video") {
    const input = {
      prompt,
      negative_prompt: negative,
      resolution,
      ratio: aspect,
      duration: Number(duration),
      prompt_extend: options.promptExtend !== false,
      watermark: false,
      seed: Number(options.seed || 0)
    };
    if (audioRefs[0]) input.audio_url = audioRefs[0].kieUrl;
    return {
      model: "wan/2-7-text-to-video",
      input
    };
  }

  if (requestedModel === "wan/2-7-image-to-video") {
    if (!explicitStart && !end && !continuation) throw new Error("Wan Image to Video requires a Start frame or Source video.");
    const input = {
      prompt,
      negative_prompt: negative,
      resolution,
      duration: Number(duration),
      prompt_extend: options.promptExtend !== false,
      watermark: false,
      seed: Number(options.seed || 0)
    };
    if (explicitStart) input.first_frame_url = explicitStart.kieUrl;
    if (end) input.last_frame_url = end.kieUrl;
    if (continuation) input.first_clip_url = continuation.kieUrl;
    return { model: requestedModel, input };
  }

  const model = start || end || continuation ? "wan/2-7-image-to-video" : "wan/2-7-text-to-video";
  const input = {
    prompt,
    negative_prompt: negative,
    resolution,
    duration: Number(duration),
    prompt_extend: true,
    watermark: false,
    seed: Number(options.seed || 0)
  };

  if (model === "wan/2-7-text-to-video") {
    input.ratio = aspect;
  } else {
    if (start) input.first_frame_url = start.kieUrl;
    if (end) input.last_frame_url = end.kieUrl;
    if (continuation) input.first_clip_url = continuation.kieUrl;
  }

  return { model, input };
}

async function ensureKieAssetUrl(asset) {
  const localPath = assetLocalPath(asset);
  const uploadedAt = Date.parse(asset.kieUploadedAt || "");
  const freshKieUrl = asset.kieUrl && uploadedAt && Date.now() - uploadedAt < KIE_ASSET_URL_MAX_AGE_MS;
  if (freshKieUrl) return asset.kieUrl;
  if (!localPath && asset.url && /^https?:\/\//i.test(asset.url)) return asset.url;
  if (!localPath) {
    if (asset.kieUrl) return asset.kieUrl;
    throw new Error(`Asset "${asset.label || asset.slug || asset.id}" has no local file to upload.`);
  }
  const buffer = await fs.readFile(localPath);
  const boundary = `----connxn-${crypto.randomBytes(12).toString("hex")}`;
  const fields = [
    multipartField(boundary, "uploadPath", "connxn-ui"),
    multipartField(boundary, "fileName", asset.fileName),
    multipartFile(boundary, "file", asset.fileName, asset.mimeType, buffer),
    Buffer.from(`--${boundary}--\r\n`)
  ];

  const response = await fetch("https://kieai.redpandaai.co/api/file-stream-upload", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.KIE_API_KEY}`,
      "Content-Type": `multipart/form-data; boundary=${boundary}`
    },
    body: Buffer.concat(fields)
  });

  const json = await response.json().catch(() => ({}));
  const url = json?.data?.downloadUrl || json?.data?.fileUrl;
  if (!response.ok || !url) {
    throw new Error(json?.msg || `KIE file upload failed with HTTP ${response.status}`);
  }
  asset.kieUrl = url;
  asset.kieUploadedAt = now();
  return url;
}

function multipartField(boundary, name, value) {
  return Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`
  );
}

function multipartFile(boundary, name, fileName, mimeType, buffer) {
  return Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="${name}"; filename="${fileName}"\r\nContent-Type: ${mimeType || "application/octet-stream"}\r\n\r\n`
    ),
    buffer,
    Buffer.from("\r\n")
  ]);
}

async function pollKieTask(taskId, chatId, messageId) {
  const db = await loadDb();
  const chat = [...db.chats.image, ...db.chats.video, ...db.chats.audio].find((item) => item.id === chatId);
  const message = chat?.messages.find((item) => item.id === messageId);
  if (!chat || !message) {
    return { raw: null, message: null };
  }
  if (message.status === "cancelled") {
    return { raw: null, message };
  }

  const response = await fetch(
    `https://api.kie.ai/api/v1/jobs/recordInfo?taskId=${encodeURIComponent(taskId)}`,
    {
      headers: {
        Authorization: `Bearer ${process.env.KIE_API_KEY}`
      }
    }
  );
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(json?.msg || `KIE recordInfo failed with HTTP ${response.status}`);
  }

  const data = json.data || {};

  message.progress = data.progress ?? message.progress ?? 0;
  message.rawStatus = data;

  if (["waiting", "queuing", "generating"].includes(data.state)) {
    message.status = data.state === "generating" ? "generating" : "queued";
    message.text = `KIE ${data.state}`;
  } else if (data.state === "success") {
    const resultJson = parseMaybeJson(data.resultJson);
    const urls = collectUrls(resultJson);
    message.status = "success";
    message.text = message.kind === "audio" ? "Suno result ready" : "KIE result ready";
    message.result = {
      type: message.kind,
      urls,
      url: urls[0] || "",
      raw: resultJson,
      taskId
    };
  } else if (data.state === "fail") {
    message.status = "error";
    message.text = "KIE generation failed";
    message.error = data.failMsg || "KIE task failed.";
  }

  chat.updatedAt = now();
  await saveDb();
  return { raw: json, message };
}

async function pollCanvasKieTask(taskId, type = "image") {
  const response = await fetch(
    `https://api.kie.ai/api/v1/jobs/recordInfo?taskId=${encodeURIComponent(taskId)}`,
    {
      headers: {
        Authorization: `Bearer ${process.env.KIE_API_KEY}`
      }
    }
  );
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(json?.msg || `KIE recordInfo failed with HTTP ${response.status}`);
  }

  const data = json.data || {};
  const message = { id: `canvas_${taskId}`, kind: type, taskId, progress: data.progress ?? 0, rawStatus: data };
  const state = String(data.state || "").toLowerCase();
  if (["waiting", "queued", "queuing", "pending", "running", "processing", "generating"].includes(state)) {
    message.status = ["running", "processing", "generating"].includes(state) ? "generating" : "queued";
    message.text = `KIE ${data.state}`;
  } else if (["success", "succeeded", "completed", "complete", "done"].includes(state)) {
    const resultJson = parseMaybeJson(data.resultJson);
    const urls = collectUrls(resultJson);
    if (urls.length) {
      message.status = "success";
      message.text = type === "audio" ? "Suno result ready" : "KIE result ready";
      message.result = { type, urls, url: urls[0], raw: resultJson, taskId };
      const asset = await ensureCanvasGeneratedAsset({ taskId, type, result: message.result });
      if (asset) message.result.assetId = asset.id;
    } else {
      message.status = "error";
      message.text = "KIE generation finished without media";
      message.error = "KIE marked the task complete but did not return a media URL.";
    }
  } else if (["fail", "failed", "error", "cancelled", "canceled", "timeout"].includes(state)) {
    message.status = "error";
    message.text = "KIE generation failed";
    message.error = data.failMsg || data.error || `KIE task ${data.state || "failed"}.`;
  } else {
    message.status = "queued";
    message.text = `KIE ${data.state || "queued"}`;
  }
  return { raw: json, message };
}

function parseMaybeJson(value) {
  if (!value) return {};
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return { value };
  }
}

function collectUrls(value, output = []) {
  if (!value) return output;
  if (typeof value === "string") {
    if (/^https?:\/\//i.test(value)) output.push(value);
    return output;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectUrls(item, output);
    return output;
  }
  if (typeof value === "object") {
    for (const item of Object.values(value)) collectUrls(item, output);
  }
  return [...new Set(output)];
}

async function routeApi(req, res, url) {
  const db = await loadDb();

  if (req.method === "GET" && url.pathname === "/api/canvas/projects") {
    sendJson(res, 200, { projects: db.canvasProjects });
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/canvas/projects") {
    const body = await readJson(req);
    const project = {
      id: uid("canvas"),
      name: String(body.name || "Untitled flow").slice(0, 80),
      pinned: false,
      createdAt: now(),
      updatedAt: now(),
      nodes: Array.isArray(body.nodes) ? body.nodes : [],
      edges: Array.isArray(body.edges) ? body.edges : [],
      viewport: body.viewport && typeof body.viewport === "object"
        ? { x: Number(body.viewport.x) || 0, y: Number(body.viewport.y) || 0, zoom: Math.max(0.08, Math.min(3.2, Number(body.viewport.zoom) || 1)) }
        : { x: 0, y: 0, zoom: 1 }
    };
    db.canvasProjects.unshift(project);
    await saveDb();
    sendJson(res, 200, { project, state: publicState(db) });
    return true;
  }

  const canvasMatch = /^\/api\/canvas\/projects\/([^/]+)$/.exec(url.pathname);
  if (canvasMatch && req.method === "PUT") {
    const project = db.canvasProjects.find((item) => item.id === canvasMatch[1]);
    if (!project) { sendJson(res, 404, { error: "Canvas project not found." }); return true; }
    const body = await readJson(req);
    if (body.name) project.name = String(body.name).slice(0, 80);
    if (typeof body.pinned === "boolean") project.pinned = body.pinned;
    if (Array.isArray(body.nodes)) project.nodes = body.nodes;
    if (Array.isArray(body.edges)) project.edges = body.edges;
    if (body.viewport && typeof body.viewport === "object") project.viewport = { x: Number(body.viewport.x) || 0, y: Number(body.viewport.y) || 0, zoom: Math.max(0.08, Math.min(3.2, Number(body.viewport.zoom) || 1)) };
    project.updatedAt = now();
    await saveDb();
    sendJson(res, 200, { project, state: publicState(db) });
    return true;
  }

  if (canvasMatch && req.method === "DELETE") {
    db.canvasProjects = db.canvasProjects.filter((item) => item.id !== canvasMatch[1]);
    if (db.canvasProjects.length === 0) {
      db.canvasProjects.push({ id: uid("canvas"), name: "Untitled flow", pinned: false, createdAt: now(), updatedAt: now(), nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } });
    }
    await saveDb();
    sendJson(res, 200, { state: publicState(db) });
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/bootstrap") {
    sendJson(res, 200, publicState(db));
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/storage") {
    sendJson(res, 200, { storage: await storageStats(db) });
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/storage-paths") {
    const body = await readJson(req);
    const result = await applyStoragePaths(body);
    sendJson(res, 200, result);
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/select-folder") {
    const body = await readJson(req);
    const field = body.field === "data" ? "data" : "download";
    const initialPath = validateLocalDirPath(body.currentPath, "Current folder") || (field === "data" ? DATA_DIR : db.settings.downloadDir || defaultDownloadDir());
    let selected = "";
    try {
      selected = await chooseFolder(initialPath, field === "data" ? "Choose user data folder" : "Choose download folder");
    } catch {
      sendJson(res, 200, { cancelled: true });
      return true;
    }
    sendJson(res, 200, { path: selected });
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/open-folder") {
    const body = await readJson(req);
    const folderPath = validateLocalDirPath(body.path, "Folder");
    await fs.mkdir(folderPath, { recursive: true });
    const opener = process.platform === "darwin" ? "open" : process.platform === "win32" ? "explorer.exe" : "xdg-open";
    spawn(opener, [folderPath], { detached: true, stdio: "ignore" }).unref();
    sendJson(res, 200, { opened: folderPath });
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/export-workspace") {
    const exportedAssets = await Promise.all(db.assets.map(async (asset) => {
      const safe = safeAsset(asset);
      try {
        const assetPath = assetLocalPath(asset);
        if (assetPath) {
          const buffer = await fs.readFile(assetPath);
          safe.dataUrl = `data:${asset.mimeType || "application/octet-stream"};base64,${buffer.toString("base64")}`;
        }
      } catch {}
      return safe;
    }));
    const exportData = {
      exportedAt: now(),
      version: db.version,
      profile: db.profile,
      settings: {
        liveMode: db.settings.liveMode,
        keyStatus: db.settings.keyStatus,
        credits: db.settings.credits,
        loaderMode: normalizeLoaderMode(db.settings.loaderMode),
        themeMode: normalizeThemeMode(db.settings.themeMode),
        lastView: normalizeView(db.settings.lastView)
      },
      activeChat: db.activeChat,
      chats: db.chats,
      assets: exportedAssets,
      canvasProjects: db.canvasProjects
    };
    const payload = JSON.stringify(exportData, null, 2);
    const name = `connxn-workspace-${new Date().toISOString().slice(0, 10)}.json`;
    res.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Content-Length": Buffer.byteLength(payload)
    });
    res.end(payload);
    return true;
  }

  if (req.method === "DELETE" && url.pathname === "/api/cache") {
    db.assets = [];
    db.canvasProjects = [{ id: uid("canvas"), name: "Untitled flow", createdAt: now(), updatedAt: now(), nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } }];
    await fs.rm(UPLOAD_DIR, { recursive: true, force: true });
    await fs.mkdir(UPLOAD_DIR, { recursive: true });
    await saveDb();
    sendJson(res, 200, { state: publicState(db), storage: await storageStats(db) });
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/settings") {
    const body = await readJson(req);
    db.profile.nick = String(body.nick || db.profile.nick || "connxn user").slice(0, 40);
    if (typeof body.avatarData === "string") db.profile.avatarData = body.avatarData;
    db.settings.liveMode = true;
    db.settings.loaderMode = normalizeLoaderMode(body.loaderMode ?? db.settings.loaderMode);
    db.settings.themeMode = normalizeThemeMode(body.themeMode ?? db.settings.themeMode);
    db.settings.lastView = normalizeView(body.lastView ?? db.settings.lastView);
    if (typeof body.kieApiKey === "string" && body.kieApiKey.trim()) {
      await writeKieKeyToEnv(body.kieApiKey.trim());
      db.settings.keyStatus = "saved";
      db.settings.credits = null;
    }

    let connection = null;
    if (process.env.KIE_API_KEY && body.verifyKey !== false) {
      connection = await validateKieKey();
      db.settings.keyStatus = connection.status;
      db.settings.credits = connection.ok ? connection.credits : null;
    }
    await saveDb();
    sendJson(res, 200, { ...publicState(db), connection });
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/key-status") {
    const connection = await validateKieKey();
    db.settings.keyStatus = connection.status;
    db.settings.credits = connection.ok ? connection.credits : null;
    await saveDb();
    sendJson(res, 200, { ...publicState(db), connection });
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/chats") {
    const body = await readJson(req);
    const type = body.type === "video" ? "video" : body.type === "audio" ? "audio" : "image";
    const chat = createChat(type, body.title || "New chat");
    db.chats[type].unshift(chat);
    db.activeChat[type] = chat.id;
    await saveDb();
    sendJson(res, 200, { chat, state: publicState(db) });
    return true;
  }

  const regenerateMatch = /^\/api\/chats\/([^/]+)\/messages\/([^/]+)\/regenerate$/.exec(url.pathname);
  if (regenerateMatch && req.method === "POST") {
    const result = await handleRegenerate(regenerateMatch[1], regenerateMatch[2]);
    sendJson(res, 200, { ...result, state: publicState(dbCache) });
    return true;
  }

  const messageMatch = /^\/api\/chats\/([^/]+)\/messages\/([^/]+)$/.exec(url.pathname);
  if (messageMatch && req.method === "DELETE") {
    const chat = [...db.chats.image, ...db.chats.video, ...db.chats.audio].find((item) => item.id === messageMatch[1]);
    if (!chat) {
      sendJson(res, 404, { error: "Chat not found." });
      return true;
    }
    const index = chat.messages.findIndex((message) => message.id === messageMatch[2]);
    if (index === -1) {
      sendJson(res, 404, { error: "Message not found." });
      return true;
    }
    chat.messages.splice(index, 1);
    chat.updatedAt = now();
    await saveDb();
    sendJson(res, 200, publicState(db));
    return true;
  }

  const cancelMessageMatch = /^\/api\/chats\/([^/]+)\/messages\/([^/]+)\/cancel$/.exec(url.pathname);
  if (cancelMessageMatch && req.method === "POST") {
    const chat = [...db.chats.image, ...db.chats.video, ...db.chats.audio].find((item) => item.id === cancelMessageMatch[1]);
    const message = chat?.messages.find((item) => item.id === cancelMessageMatch[2]);
    if (!chat || !message) {
      sendJson(res, 404, { error: "Message not found." });
      return true;
    }
    if (["queued", "generating", "waiting", "queuing"].includes(message.status)) {
      message.status = "cancelled";
      message.text = "Generation cancelled";
      message.error = "";
      chat.updatedAt = now();
      await saveDb();
    }
    sendJson(res, 200, { message, state: publicState(db) });
    return true;
  }

  const downloadMatch = /^\/api\/messages\/([^/]+)\/download$/.exec(url.pathname);
  if (downloadMatch && req.method === "GET") {
    const record = findMessageRecord(db, downloadMatch[1]);
    if (!record) {
      sendJson(res, 404, { error: "Message not found." });
      return true;
    }
    await streamMessageDownload(res, record);
    return true;
  }

  if (url.pathname === "/api/media/download" && req.method === "GET") {
    const sourceUrl = url.searchParams.get("url") || "";
    const kind = url.searchParams.get("kind") || "";
    const stem = url.searchParams.get("name") || "connxn_media";
    const fallbackExtension = kind === "video" ? ".mp4" : kind === "audio" ? ".mp3" : ".png";
    const fallbackType = kind === "video" ? "video/mp4" : kind === "audio" ? "audio/mpeg" : "image/png";
    await streamDownloadSource(res, sourceUrl, { stem, fallbackExtension, fallbackType });
    return true;
  }

  if (url.pathname === "/api/media/save" && req.method === "POST") {
    const body = await readJson(req);
    const sourceUrl = body.url || "";
    const kind = body.kind || "";
    const stem = body.name || "connxn_media";
    const fallbackExtension = kind === "video" ? ".mp4" : kind === "audio" ? ".mp3" : ".png";
    const fallbackType = kind === "video" ? "video/mp4" : kind === "audio" ? "audio/mpeg" : "image/png";
    const result = await saveDownloadSource(sourceUrl, { stem, fallbackExtension, fallbackType });
    sendJson(res, 200, result);
    return true;
  }

  const chatMatch = /^\/api\/chats\/([^/]+)$/.exec(url.pathname);
  if (chatMatch && req.method === "PATCH") {
    const body = await readJson(req);
    const chat = [...db.chats.image, ...db.chats.video, ...db.chats.audio].find((item) => item.id === chatMatch[1]);
    if (!chat) {
      sendJson(res, 404, { error: "Chat not found." });
      return true;
    }
    if (body.title) chat.title = String(body.title).slice(0, 60);
    if (typeof body.pinned === "boolean") chat.pinned = body.pinned;
    chat.updatedAt = now();
    await saveDb();
    sendJson(res, 200, { chat, state: publicState(db) });
    return true;
  }

  if (chatMatch && req.method === "DELETE") {
    for (const type of ["image", "video", "audio"]) {
      const list = db.chats[type];
      const index = list.findIndex((chat) => chat.id === chatMatch[1]);
      if (index !== -1 && list.length > 1) {
        list.splice(index, 1);
        db.activeChat[type] = list[0].id;
        await saveDb();
        sendJson(res, 200, publicState(db));
        return true;
      }
    }
    sendJson(res, 400, { error: "Cannot delete the last chat." });
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/active-chat") {
    const body = await readJson(req);
    const type = body.type === "video" ? "video" : body.type === "audio" ? "audio" : "image";
    if (findChat(db, type, body.chatId)) {
      db.activeChat[type] = body.chatId;
      await saveDb();
    }
    sendJson(res, 200, publicState(db));
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/assets") {
    const body = await readJson(req);
    const asset = await createAsset(body);
    sendJson(res, 200, { asset, state: publicState(await loadDb()) });
    return true;
  }

  const assetMatch = /^\/api\/assets\/([^/]+)$/.exec(url.pathname);
  if (assetMatch && req.method === "PATCH") {
    const body = await readJson(req);
    const asset = db.assets.find((item) => item.id === assetMatch[1]);
    if (!asset) {
      sendJson(res, 404, { error: "Asset not found." });
      return true;
    }
    if (body.role) asset.role = body.role;
    if (body.label) asset.label = String(body.label).slice(0, 60);
    await saveDb();
    sendJson(res, 200, publicState(db));
    return true;
  }

  if (assetMatch && req.method === "DELETE") {
    const index = db.assets.findIndex((item) => item.id === assetMatch[1]);
    if (index !== -1) {
      const [asset] = db.assets.splice(index, 1);
      await fs.unlink(assetLocalPath(asset)).catch(() => {});
      await saveDb();
    }
    sendJson(res, 200, publicState(db));
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/generate") {
    const body = await readJson(req);
    const result = await handleGenerate(body);
    sendJson(res, 200, { ...result, state: publicState(dbCache) });
    return true;
  }

  const upscaleMatch = /^\/api\/chats\/([^/]+)\/messages\/([^/]+)\/upscale$/.exec(url.pathname);
  if (upscaleMatch && req.method === "POST") {
    const body = await readJson(req);
    const result = await handleUpscale(upscaleMatch[1], upscaleMatch[2], body);
    sendJson(res, 200, { ...result, state: publicState(dbCache) });
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/canvas/generate") {
    const body = await readJson(req);
    const result = await handleCanvasGenerate(body);
    sendJson(res, 200, { ...result, state: publicState(dbCache) });
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/canvas/utility") {
    const body = await readJson(req);
    const result = await handleCanvasUtility(body);
    sendJson(res, 200, result);
    return true;
  }

  const taskMatch = /^\/api\/tasks\/([^/]+)$/.exec(url.pathname);
  if (taskMatch && req.method === "GET") {
    if (!process.env.KIE_API_KEY) {
      sendJson(res, 400, { error: "No KIE key stored." });
      return true;
    }
    const taskId = taskMatch[1];
    const chatId = url.searchParams.get("chatId");
    const messageId = url.searchParams.get("messageId");
    const result = await pollKieTask(taskId, chatId, messageId);
    sendJson(res, 200, { ...result, state: publicState(await loadDb()) });
    return true;
  }

  const canvasTaskMatch = /^\/api\/canvas\/tasks\/([^/]+)$/.exec(url.pathname);
  if (canvasTaskMatch && req.method === "GET") {
    if (!process.env.KIE_API_KEY) {
      sendJson(res, 400, { error: "No KIE key stored." });
      return true;
    }
    const result = await pollCanvasKieTask(canvasTaskMatch[1], url.searchParams.get("type") || "image");
    sendJson(res, 200, { ...result, state: publicState(await loadDb()) });
    return true;
  }

  return false;
}

async function serveStatic(req, res, url) {
  let target;
  if (url.pathname.startsWith("/uploads/")) {
    const relative = decodeURIComponent(url.pathname.replace(/^\/uploads\//, ""));
    target = path.resolve(UPLOAD_DIR, relative);
    if (!target.startsWith(path.resolve(UPLOAD_DIR) + path.sep)) {
      sendJson(res, 403, { error: "Forbidden" });
      return;
    }
  } else {
    const pathname = url.pathname === "/" ? "/index.html" : url.pathname;
    target = path.join(PUBLIC_DIR, decodeURIComponent(pathname));
    if (!target.startsWith(PUBLIC_DIR)) {
      sendJson(res, 403, { error: "Forbidden" });
      return;
    }
  }

  try {
    const stat = await fs.stat(target);
    if (!stat.isFile()) throw new Error("Not a file");
    const ext = path.extname(target).toLowerCase();
    if (url.pathname.startsWith("/uploads/")) {
      const type = MIME_TYPES[ext] || "application/octet-stream";
      const range = req.headers.range;
      if (range && /^bytes=\d*-\d*$/.test(range)) {
        const [rawStart, rawEnd] = range.replace("bytes=", "").split("-");
        const start = rawStart ? Number(rawStart) : 0;
        const end = rawEnd ? Number(rawEnd) : stat.size - 1;
        if (Number.isFinite(start) && Number.isFinite(end) && start <= end && start < stat.size) {
          const finalEnd = Math.min(end, stat.size - 1);
          res.writeHead(206, {
            "Content-Type": type,
            "Content-Length": finalEnd - start + 1,
            "Content-Range": `bytes ${start}-${finalEnd}/${stat.size}`,
            "Accept-Ranges": "bytes",
            "Cache-Control": "no-store"
          });
          createReadStream(target, { start, end: finalEnd }).pipe(res);
          return;
        }
      }
      res.writeHead(200, {
        "Content-Type": type,
        "Content-Length": stat.size,
        "Accept-Ranges": "bytes",
        "Cache-Control": "no-store"
      });
      createReadStream(target).pipe(res);
      return;
    }
    const data = await fs.readFile(target);
    res.writeHead(200, {
      "Content-Type": MIME_TYPES[ext] || "application/octet-stream",
      "Content-Length": data.length,
      "Cache-Control": url.pathname.startsWith("/uploads/") ? "no-store" : "no-cache"
    });
    res.end(data);
  } catch {
    if (!url.pathname.startsWith("/api/") && !url.pathname.includes(".")) {
      const index = await fs.readFile(path.join(PUBLIC_DIR, "index.html"), "utf8");
      sendText(res, 200, index, MIME_TYPES[".html"]);
      return;
    }
    sendText(res, 404, "Not found");
  }
}

async function handleRequest(req, res) {
  try {
    const url = new URL(req.url, `http://${req.headers.host || `${HOST}:${PORT}`}`);
    if (url.pathname.startsWith("/api/")) {
      const handled = await routeApi(req, res, url);
      if (!handled) sendJson(res, 404, { error: "Unknown API route." });
      return;
    }
    await serveStatic(req, res, url);
  } catch (error) {
    sendJson(res, error.status || 500, {
      error: error.message || "Internal error"
    });
  }
}

await ensureStorage();
await loadDb();

const server = http.createServer(handleRequest);
server.listen(PORT, HOST, () => {
  console.log(`connxn.ui is running at http://${HOST}:${PORT}`);
});
