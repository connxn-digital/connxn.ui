const root = document.querySelector("#app");
const THEME_STORAGE_KEY = "connxn.theme";
const FAVORITES_STORAGE_KEY = "connxn.favorites";
const SIDEBAR_STORAGE_KEY = "connxn.sidebarOpen";
const UI_PREFS_STORAGE_KEY = "connxn.uiPrefs";
const themeMedia = window.matchMedia("(prefers-color-scheme: dark)");
const THEME_MODE_VALUES = ["system", "light", "dark", "github", "mono-light", "dark-blood", "vampire-masquerade", "blender", "maya", "yorha", "frutiger-aero", "tumblr-aqua"];
const LOADER_MODE_VALUES = ["cellnoise", "blurry-dream"];
const LOADER_ITEMS = [
  ["cellnoise", "Cellnoise", "Procedural tile field"],
  ["blurry-dream", "Blurry dream", "Floating theme gradient"]
];
const LEGACY_THEME_ALIASES = {
  "paper-circuit": "frutiger-aero",
  abyss: "dark",
  nocturno: "dark",
  "mohawe-midnight": "dark",
  "neon-void": "dark",
  "analog-horror": "dark",
  "dos-net": "dark",
  "cassette-night": "dark",
  "polar-studio": "light",
  "terminal-green": "dark"
};
const canvasDirtyProjects = new Map();
const uiPrefs = readUiPrefs();
const LIBRARY_PAGE_SIZE = 72;
const FLOW_PAGE_SIZE = 60;
const CHAT_PAGE_SIZE = 120;
const VALID_VIEWS = ["image", "video", "canvas", "library", "account"];
const MEDIA_CACHE_MAX_ITEMS = 180;
const MEDIA_CACHE_MAX_ITEM_BYTES = 64 * 1024 * 1024;
const MEDIA_CACHE_MAX_TOTAL_BYTES = 320 * 1024 * 1024;
const MEDIA_CACHE_TTL_MS = 45 * 60 * 1000;
const mediaPreviewCache = new Map();

const state = {
  ready: false,
  view: VALID_VIEWS.includes(uiPrefs.view) ? uiPrefs.view : "image",
  profile: { nick: "connxn user", avatarData: "" },
  settings: { liveMode: false, hasKieKey: false, keyStatus: "missing", credits: null, loaderMode: "cellnoise" },
  activeChat: { image: "", video: "", audio: "" },
  chats: { image: [], video: [], audio: [] },
  assets: [],
  canvasProjects: [],
  activeCanvasProject: "",
  canvasMenu: null,
  canvasDrag: null,
  canvasConnect: null,
  canvasZoom: 1,
  canvasPan: null,
  canvasResize: false,
  selectedCanvasNode: "",
  prompts: { image: "", video: "", audio: "" },
  attached: { image: [], video: [], audio: [] },
  sending: { image: false, video: false, audio: false },
  regenerating: new Set(),
  uploading: { image: false, video: false, audio: false },
  dragActive: "",
  mentionMenu: null,
  editingChat: null,
  panelOpen: false,
  sidebarOpen: readSidebarOpen(),
  preview: null,
  upscale: null,
  upscaleModels: [],
  accountDraft: null,
  savingAccount: false,
  checkingKey: false,
  storage: null,
  checkingStorage: false,
  clearingCache: false,
  activeDownloads: new Set(),
  librarySort: uiPrefs.librarySort === "oldest" ? "oldest" : "newest",
  libraryFilter: uiPrefs.libraryFilter || "all",
  libraryLimit: LIBRARY_PAGE_SIZE,
  messageLimits: { image: FLOW_PAGE_SIZE, video: FLOW_PAGE_SIZE, audio: CHAT_PAGE_SIZE },
  toast: null,
  themeMode: readThemeMode(uiPrefs.themeMode),
  favorites: readFavorites(),
  options: {
    image: {
      model: "nano-banana-2",
      aspectRatio: "1:1",
      resolution: "2K",
      quality: "high",
      outputFormat: "png",
      negativePrompt: ""
    },
    video: {
      model: "bytedance/seedance-2-5",
      inputMode: "auto",
      aspectRatio: "16:9",
      resolution: "720p",
      duration: "10",
      quality: "std",
      sound: false,
      fixedLens: false,
      webSearch: false,
      returnLastFrame: false,
      promptExtend: true,
      negativePrompt: "blurry, flicker, low quality, distorted"
    },
    audio: {
      model: "V5",
      customMode: false,
      instrumental: false,
      style: "",
      title: "",
      negativeTags: "",
      vocalGender: "",
      voice: "Rachel",
      stability: 0.5,
      similarityBoost: 0.75,
      speed: 1,
      language: ""
    }
  }
};

const COMMON_RATIOS = [["16:9", "16:9"], ["9:16", "9:16"], ["1:1", "1:1"]];
const WIDE_RATIOS = [...COMMON_RATIOS, ["4:3", "4:3"], ["3:4", "3:4"], ["21:9", "21:9"]];
const IMAGE_RATIOS = [["auto", "Auto"], ["1:1", "1:1"], ["16:9", "16:9"], ["9:16", "9:16"], ["4:3", "4:3"], ["3:4", "3:4"], ["3:2", "3:2"]];
const SEEDREAM5_RATIOS = [["1:1", "1:1"], ["4:3", "4:3"], ["3:4", "3:4"], ["16:9", "16:9"], ["9:16", "9:16"], ["2:3", "2:3"], ["3:2", "3:2"], ["21:9", "21:9"]];
const IMAGE_RESOLUTIONS = [["1K", "1K"], ["2K", "2K"], ["4K", "4K"]];
const IMAGE_QUALITIES = [["low", "Low"], ["medium", "Medium"], ["high", "High"]];
const IMAGE_FORMATS = [["png", "PNG"], ["jpg", "JPG"]];

const imageModelRegistry = [
  { id: "nano-banana-2", label: "Nano Banana 2", family: "Google", refs: true },
  { id: "nano-banana-pro", label: "Nano Banana Pro", family: "Google", refs: true },
  { id: "google/nano-banana", label: "Nano Banana", family: "Google", refs: true },
  { id: "gpt-image-2-text-to-image", label: "GPT Image 2", family: "GPT Image", refs: true },
  { id: "gpt-image/1.5-text-to-image", label: "GPT Image 1.5", family: "GPT Image", refs: true },
  { id: "flux-2/pro-text-to-image", label: "Flux 2 Pro", family: "Flux", refs: true, ratios: [["1:1", "1:1"], ["4:3", "4:3"], ["3:4", "3:4"], ["16:9", "16:9"], ["9:16", "9:16"], ["3:2", "3:2"], ["2:3", "2:3"]], resolutions: [["1K", "1K"], ["2K", "2K"]], noQuality: true, noFormat: true, nsfwChecker: true },
  { id: "flux-2/flex-text-to-image", label: "Flux 2 Flex", family: "Flux", refs: false, ratios: [["1:1", "1:1"], ["4:3", "4:3"], ["3:4", "3:4"], ["16:9", "16:9"], ["9:16", "9:16"], ["3:2", "3:2"], ["2:3", "2:3"]], resolutions: [["1K", "1K"], ["2K", "2K"]], noQuality: true, noFormat: true, nsfwChecker: true },
  { id: "google/imagen4", label: "Imagen 4", family: "Google", refs: false, ratios: [["1:1", "1:1"], ["16:9", "16:9"], ["9:16", "9:16"], ["3:4", "3:4"], ["4:3", "4:3"], ["auto", "Auto"]], noResolution: true, noQuality: true, noFormat: true, negative: true },
  { id: "grok-imagine/text-to-image", label: "Grok Imagine", family: "Grok", refs: true },
  { id: "seedream/5-pro-text-to-image", editModel: "seedream/5-pro-image-to-image", label: "Seedream 5.0 Pro", family: "ByteDance", refs: true, refsLimit: 10, seedream5: true, seed: false, ratios: SEEDREAM5_RATIOS, qualities: [["basic", "Basic · 1K"], ["high", "High · 2K"]], outputFormats: [["png", "PNG"], ["jpeg", "JPEG"]], nsfwChecker: true, defaultQuality: "high" },
  { id: "seedream/5-lite-text-to-image", editModel: "seedream/5-lite-image-to-image", label: "Seedream 5.0 Lite", family: "ByteDance", refs: true, refsLimit: 14, seedream5: true, seed: false, ratios: SEEDREAM5_RATIOS, qualities: [["basic", "Basic · 2K"], ["high", "High · 3K"], ["ultra", "Ultra · 4K"]], outputFormats: [["png", "PNG"], ["jpeg", "JPEG"]], nsfwChecker: true, defaultQuality: "basic" },
  { id: "bytedance/seedream-v4-text-to-image", label: "Seedream 4", family: "ByteDance", refs: true }
];

const videoModelRegistry = [
  { id: "bytedance/seedance-2-5", label: "Seedance 2.5", family: "Seedance", modes: ["auto", "frames", "references"], roles: { image: ["reference", "start", "end"], video: ["reference"], audio: ["reference"] }, ratios: [["adaptive", "Adaptive"], ...WIDE_RATIOS], resolutions: [["480p", "480p"], ["720p", "720p"], ["1080p", "1080p"]], durationRange: { min: 1, max: 30, step: 1, default: 5 }, sound: true, returnLastFrame: true },
  { id: "bytedance/seedance-2", label: "Seedance 2.0", family: "Seedance", modes: ["auto", "frames", "references"], roles: { image: ["reference", "start", "end"], video: ["reference"], audio: ["reference"] }, ratios: WIDE_RATIOS, resolutions: [["480p", "480p"], ["720p", "720p"], ["1080p", "1080p"], ["4k", "4K"]], durationRange: { min: 4, max: 15, step: 1, default: 10 }, sound: true, webSearch: true, returnLastFrame: true },
  { id: "bytedance/seedance-2-fast", label: "Seedance 2.0 Fast", family: "Seedance", modes: ["auto", "frames", "references"], roles: { image: ["reference", "start", "end"], video: ["reference"], audio: ["reference"] }, ratios: WIDE_RATIOS, resolutions: [["720p", "720p"]], durations: [["5", "5s"], ["10", "10s"], ["15", "15s"]], sound: true, webSearch: true, returnLastFrame: true },
  { id: "bytedance/seedance-2-mini", label: "Seedance 2.0 Mini", family: "Seedance", modes: ["auto", "frames", "references"], roles: { image: ["reference", "start", "end"], video: ["reference"], audio: ["reference"] }, ratios: WIDE_RATIOS, resolutions: [["720p", "720p"]], durations: [["5", "5s"], ["10", "10s"], ["15", "15s"]], sound: true, webSearch: true, returnLastFrame: true },
  { id: "bytedance/seedance-1.5-pro", label: "Seedance 1.5 Pro", family: "Seedance", roles: { image: ["reference"] }, ratios: COMMON_RATIOS, resolutions: [["720p", "720p"]], durations: [["8", "8s"]], sound: true, fixedLens: true },
  { id: "kling-3.0/video", label: "Kling 3.0", family: "Kling", modes: ["auto", "frames", "references"], roles: { image: ["reference", "start", "end"], video: ["reference"], audio: ["reference"] }, ratios: COMMON_RATIOS, durationRange: { min: 3, max: 15, step: 1, default: 5 }, qualities: [["std", "Standard"], ["pro", "Pro"], ["4K", "4K"]], sound: true },
  { id: "kling-v3-turbo-auto", label: "Kling 3 Turbo", family: "Kling", roles: { image: ["start"] }, ratios: COMMON_RATIOS, resolutions: [["720p", "720p"]], durations: [["5", "5s"], ["10", "10s"]] },
  { id: "kling-2.6-auto", label: "Kling 2.6", family: "Kling", roles: { image: ["reference"] }, ratios: COMMON_RATIOS, durations: [["5", "5s"], ["10", "10s"]], sound: true },
  { id: "wan-2.7-auto", label: "Wan 2.7 Auto", family: "Wan", roles: { image: ["start", "end"], video: ["continuation"], audio: ["reference"] }, ratios: COMMON_RATIOS.concat([["4:3", "4:3"], ["3:4", "3:4"]]), resolutions: [["720p", "720p"], ["1080p", "1080p"]], durationRange: { min: 2, max: 15, step: 1, default: 5 }, negative: true, promptExtend: true },
  { id: "wan/2-7-text-to-video", label: "Wan 2.7 Text", family: "Wan", roles: { audio: ["reference"] }, ratios: COMMON_RATIOS.concat([["4:3", "4:3"], ["3:4", "3:4"]]), resolutions: [["720p", "720p"], ["1080p", "1080p"]], durationRange: { min: 2, max: 15, step: 1, default: 5 }, negative: true, promptExtend: true },
  { id: "wan/2-7-image-to-video", label: "Wan 2.7 Frames", family: "Wan", roles: { image: ["start", "end"], video: ["continuation"] }, resolutions: [["720p", "720p"], ["1080p", "1080p"]], durationRange: { min: 2, max: 15, step: 1, default: 5 }, negative: true, promptExtend: true },
  { id: "wan/2-7-r2v", label: "Wan 2.7 References", family: "Wan", roles: { image: ["reference", "start"], video: ["reference"], audio: ["reference"] }, ratios: COMMON_RATIOS.concat([["4:3", "4:3"], ["3:4", "3:4"]]), resolutions: [["720p", "720p"], ["1080p", "1080p"]], durationRange: { min: 2, max: 10, step: 1, default: 5 }, negative: true, promptExtend: true },
  { id: "wan/2-7-videoedit", label: "Wan 2.7 Video Edit", family: "Wan", roles: { image: ["reference"], video: ["continuation"] }, ratios: COMMON_RATIOS.concat([["4:3", "4:3"], ["3:4", "3:4"]]), resolutions: [["720p", "720p"], ["1080p", "1080p"]], durationRange: { min: 0, max: 10, step: 1, default: 0 }, negative: true, promptExtend: true },
  { id: "grok-imagine-video-1-5-preview", label: "Grok Video 1.5", family: "Grok", roles: { image: ["reference"] }, ratios: [["auto", "Auto"], ["1:1", "1:1"], ["16:9", "16:9"], ["9:16", "9:16"], ["3:2", "3:2"], ["2:3", "2:3"]], resolutions: [["480p", "480p"], ["720p", "720p"], ["1080p", "1080p"]], durationRange: { min: 1, max: 15, step: 1, default: 8 } },
  { id: "grok-imagine-auto", label: "Grok Imagine", family: "Grok", roles: { image: ["reference"] }, ratios: [["16:9", "16:9"], ["9:16", "9:16"], ["1:1", "1:1"], ["2:3", "2:3"], ["3:2", "3:2"]], resolutions: [["480p", "480p"]], durations: [["6", "6s"]], qualities: [["std", "Normal"]] },
  { id: "gemini-omni-video", label: "Gemini Omni Video", family: "Gemini", roles: { image: ["reference"], video: ["reference"] }, ratios: [["16:9", "16:9"], ["9:16", "9:16"]], resolutions: [["720p", "720p"], ["1080p", "1080p"], ["4k", "4K"]], durations: [["4", "4s"], ["6", "6s"], ["8", "8s"], ["10", "10s"]] },
  { id: "hailuo/2-3-image-to-video-pro", label: "Hailuo 2.3 Pro", family: "Hailuo", roles: { image: ["start"] }, resolutions: [["768P", "768p"], ["1080P", "1080p"]], durations: [["6", "6s"], ["10", "10s"]], nsfwChecker: true },
  { id: "hailuo/2-3-image-to-video-standard", label: "Hailuo 2.3 Standard", family: "Hailuo", roles: { image: ["start"] }, resolutions: [["768P", "768p"], ["1080P", "1080p"]], durations: [["6", "6s"], ["10", "10s"]], nsfwChecker: true },
  { id: "hailuo/02-text-to-video-pro", label: "Hailuo 02 Text Pro", family: "Hailuo", roles: {}, durations: [["6", "6s"]], promptExtend: true, nsfwChecker: true },
  { id: "hailuo/02-text-to-video-standard", label: "Hailuo 02 Text Standard", family: "Hailuo", roles: {}, durations: [["6", "6s"], ["10", "10s"]], promptExtend: true, nsfwChecker: true },
  { id: "bytedance/v1-pro-text-to-video", label: "ByteDance V1 Pro", family: "ByteDance", roles: {}, ratios: [["21:9", "21:9"], ["16:9", "16:9"], ["4:3", "4:3"], ["1:1", "1:1"], ["3:4", "3:4"], ["9:16", "9:16"]], resolutions: [["480p", "480p"], ["720p", "720p"], ["1080p", "1080p"]], durations: [["5", "5s"], ["10", "10s"]], fixedLens: true }
];

const audioModelRegistry = [
  { id: "V5", label: "Suno V5", family: "Suno", kind: "music" },
  { id: "V4_5PLUS", label: "Suno V4.5+", family: "Suno", kind: "music" },
  { id: "V4_5", label: "Suno V4.5", family: "Suno", kind: "music" },
  { id: "V4", label: "Suno V4", family: "Suno", kind: "music" },
  { id: "elevenlabs/text-to-speech-turbo-2-5", label: "ElevenLabs Turbo 2.5", family: "ElevenLabs", kind: "speech" }
];

const KIE_PRICING_SOURCE = "KIE public pricing/docs";
const KIE_PRICING_UPDATED = "2026-08-22";
const KIE_PRICING = {
  "nano-banana-2": { unit: "image", credits: 4, flatParams: ["resolution", "quality", "refs"], note: "KIE public listing: Nano Banana 2 flat per image." },
  "nano-banana-pro": { unit: "image", credits: 9, flatParams: ["resolution", "quality", "refs"], note: "KIE public listing: Nano Banana higher tier flat per image." },
  "google/nano-banana": { unit: "image", credits: 4, flatParams: ["resolution", "quality", "refs"], note: "Estimate uses KIE Nano Banana public per-image listing." },
  "gpt-image-2-text-to-image": {
    unit: "image",
    byResolution: { "1K": 5, "2K": 8 },
    fallbackCredits: 5,
    note: "KIE public listing: GPT Image 2 varies by resolution."
  },
  "gpt-image/1.5-text-to-image": { unit: "image", credits: 4, flatParams: ["aspectRatio", "refs"], note: "KIE model docs expose aspect ratio/ref inputs; no public modifier found." },
  "seedream/5-pro-text-to-image": { unit: "image", byQuality: { basic: 10, high: 20 }, fallbackCredits: 10, note: "Seedream docs expose quality basic/high; local estimate maps higher quality to higher compute tier." },
  "seedream/5-lite-text-to-image": { unit: "image", byQuality: { basic: 8, high: 15, ultra: 25 }, fallbackCredits: 8, note: "Seedream docs expose quality basic/high/ultra; local estimate maps quality tiers to credits." },
  "bytedance/seedream-v4-text-to-image": { unit: "image", credits: 10, flatParams: ["aspectRatio", "refs"], note: "No separate public KIE modifier found for selected parameters." },
  "flux-2/pro-text-to-image": { unit: "image", credits: 20, flatParams: ["aspectRatio", "quality"], note: "No separate public KIE modifier found for selected parameters." },
  "flux-2/flex-text-to-image": { unit: "image", credits: 12, flatParams: ["aspectRatio", "quality"], note: "No separate public KIE modifier found for selected parameters." },
  "google/imagen4": { unit: "image", credits: 12, flatParams: ["aspectRatio", "quality"], note: "No separate public KIE modifier found for selected parameters." },
  "grok-imagine/text-to-image": { unit: "image", credits: 3, flatParams: ["aspectRatio", "refs"], note: "Estimate uses KIE Grok Imagine low-cost public listing family." },
  "bytedance/seedance-2": { unit: "second", creditsPerSecond: 5.7, note: "KIE public listing: Seedance 2 per-second pricing." },
  "bytedance/seedance-2-5": { unit: "second", byResolutionPerSecond: { "480p": 4.2, "720p": 5.7, "1080p": 8.5, "4K": 14 }, fallbackCreditsPerSecond: 5.7, note: "Estimate uses KIE Seedance per-second family pricing with resolution tiers." },
  "bytedance/seedance-2-fast": { unit: "second", creditsPerSecond: 4.2, note: "Estimate uses lower fast-tier Seedance per-second pricing." },
  "bytedance/seedance-2-mini": { unit: "second", creditsPerSecond: 3, note: "Estimate uses lower mini-tier Seedance per-second pricing." },
  "bytedance/seedance-1.5-pro": { unit: "second", creditsPerSecond: 5.7, note: "Estimate uses KIE Seedance per-second family pricing." },
  "kling-3.0/video": { unit: "second", byQualityPerSecond: { std: 4, pro: 7, "4K": 16 }, fallbackCreditsPerSecond: 7, note: "KIE docs expose std/pro/4K modes; estimate varies by quality mode." },
  "kling-v3-turbo-auto": { unit: "second", creditsPerSecond: 4, note: "Estimate uses Kling turbo lower per-second tier." },
  "kling-2.6-auto": { unit: "second", creditsPerSecond: 5, note: "Estimate uses Kling 2.6 per-second family tier." },
  "grok-imagine-video-1-5-preview": { unit: "second", creditsPerSecond: 0.8, note: "KIE public listing: Grok Imagine 480p per-second pricing." },
  "grok-imagine-auto": {
    unit: "second",
    byResolutionPerSecond: { "480p": 0.8, "720p": 1.5 },
    fallbackCreditsPerSecond: 0.8,
    note: "KIE public listing: Grok Imagine varies by resolution."
  },
  "wan-2.7-auto": { unit: "video", credits: 120, note: "Wan docs expose fixed 1080p/5s in this UI; no public per-option modifier found." },
  "wan/2-7-text-to-video": { unit: "video", credits: 120, note: "Wan docs expose fixed 1080p/5s in this UI; no public per-option modifier found." },
  "wan/2-7-image-to-video": { unit: "video", credits: 120, note: "Wan docs expose fixed 1080p/5s in this UI; no public per-option modifier found." },
  "wan/2-7-r2v": { unit: "video", credits: 120, note: "Wan docs expose fixed 1080p/5s in this UI; no public per-option modifier found." },
  "wan/2-7-videoedit": { unit: "video", credits: 120, note: "Wan docs expose fixed 1080p/5s in this UI; no public per-option modifier found." },
  "gemini-omni-video": { unit: "video", credits: 100, note: "Gemini Omni Video is exposed as fixed-duration in this UI; no public per-option modifier found." },
  "hailuo/2-3-image-to-video-pro": { unit: "video", credits: 90, note: "Hailuo Pro exposed as fixed 6s/768p in this UI." },
  "hailuo/2-3-image-to-video-standard": { unit: "video", credits: 45, note: "Hailuo Standard exposed as fixed 6s/768p in this UI." },
  "hailuo/02-text-to-video-pro": { unit: "video", credits: 90, note: "Hailuo Pro exposed as fixed 6s in this UI." },
  "hailuo/02-text-to-video-standard": { unit: "video", credits: 45, note: "Hailuo Standard exposed as fixed 6s in this UI." },
  "bytedance/v1-pro-text-to-video": { unit: "second", creditsPerSecond: 4, note: "Estimate uses ByteDance V1 Pro per-second family tier." }
};

const imageModels = imageModelRegistry.map((model) => [model.id, model.label]);
const videoModels = videoModelRegistry.map((model) => [model.id, model.label]);
const audioModels = audioModelRegistry.map((model) => [model.id, model.label]);
const THEME_ITEMS = [
  ["system", "System", "Follow device"],
  ["dark", "Dark", "Neutral graphite"],
  ["light", "Light", "Bright studio"],
  ["github", "GitHub", "Clean developer"],
  ["mono-light", "Mono Light", "Reduced color"],
  ["dark-blood", "Dark Blood", "Cranberry glass"],
  ["vampire-masquerade", "Vampire Masquerade", "Luxury dark deco"],
  ["blender", "Blender", "Graphite orange"],
  ["maya", "Maya", "Deep teal"],
  ["yorha", "YoRHa", "NieR Automata"],
  ["frutiger-aero", "Frutiger Aero", "Glass aqua retro"],
  ["tumblr-aqua", "Tumblr Aqua", "macOS X social desk"]
];

const pollTimers = new Map();
let asciiTimer = null;
let toastTimer = null;
let creditsTimer = null;
let elapsedTimer = null;

function h(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function readFavorites() {
  try {
    const parsed = JSON.parse(localStorage.getItem(FAVORITES_STORAGE_KEY) || "[]");
    return new Set(Array.isArray(parsed) ? parsed : []);
  } catch {
    return new Set();
  }
}

function saveFavorites() {
  localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify([...state.favorites]));
}

function readUiPrefs() {
  try {
    const parsed = JSON.parse(localStorage.getItem(UI_PREFS_STORAGE_KEY) || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function saveUiPrefs() {
  const prefs = {
    view: state.view,
    themeMode: state.themeMode,
    loaderMode: normalizeLoaderMode(state.settings.loaderMode),
    librarySort: state.librarySort,
    libraryFilter: state.libraryFilter
  };
  localStorage.setItem(UI_PREFS_STORAGE_KEY, JSON.stringify(prefs));
}

function favoriteKey(type, id, url = "") {
  return `${type}:${id || url}`;
}

function isFavorite(type, id, url = "") {
  return state.favorites.has(favoriteKey(type, id, url));
}

function favoriteButton(type, id, url = "", size = 15) {
  const key = favoriteKey(type, id, url);
  const active = state.favorites.has(key);
  return `<button type="button" class="favorite-button ${active ? "active" : ""}" data-toggle-favorite="${h(key)}" title="${active ? "Remove from favorites" : "Add to favorites"}" aria-label="${active ? "Remove from favorites" : "Add to favorites"}">${icon("heart", size)}</button>`;
}

function paintFavoriteKey(key) {
  const active = state.favorites.has(key);
  root.querySelectorAll(`[data-toggle-favorite="${CSS.escape(key)}"]`).forEach((button) => {
    button.classList.toggle("active", active);
    button.setAttribute("title", active ? "Remove from favorites" : "Add to favorites");
    button.setAttribute("aria-label", active ? "Remove from favorites" : "Add to favorites");
    button.closest("[data-library-favorite]")?.setAttribute("data-library-favorite", active ? "true" : "false");
  });
  if (state.view === "library" && state.libraryFilter === "favorites") {
    render({ preserveScroll: true, scrollToBottom: false });
  }
}

function canonicalSearch(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[._/+-]+/g, " ")
    .replace(/[^a-z0-9\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function searchHaystack(value) {
  const base = canonicalSearch(value);
  const bits = [base];
  if (/\bgpt\s*image\b/.test(base) || /\bopenai\b/.test(base)) bits.push("gp gpi gpt img open ai");
  if (/\bseedance\b/.test(base) || /\bbytedance\b/.test(base)) bits.push("see sd seed dance seedance bytedance");
  for (const n of base.match(/\b\d+(?:\s\d+)?\b/g) || []) {
    const compact = n.replace(/\s+/g, "");
    if (base.includes("gpt image")) bits.push(`gp${compact} gp ${n} gptimage${compact} gpt image ${n}`);
    if (base.includes("seedance")) bits.push(`see${compact} see ${n} sd${compact} sd ${n} seed${compact} seed ${n}`);
  }
  return canonicalSearch(bits.join(" "));
}

function searchNeedles(value) {
  const base = canonicalSearch(value);
  if (!base) return [""];
  return [...new Set([
    base,
    canonicalSearch(base.replace(/\bgp\b/g, "gpt image").replace(/\bgpi\b/g, "gpt image")),
    canonicalSearch(base.replace(/\bsee\b/g, "seedance").replace(/\bsd\b/g, "seedance").replace(/\bseed\b/g, "seedance"))
  ].filter(Boolean))];
}

function smartSearchMatch(query, value) {
  const q = canonicalSearch(query);
  if (!q) return true;
  const haystack = searchHaystack(value);
  return searchNeedles(q).some((needle) => haystack.includes(needle) || needle.split(" ").every((token) => haystack.includes(token)));
}

const ICON_PATHS = {
  plus: '<path d="M5 12h14M12 5v14"/>',
  copy: '<rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
  trash: '<path d="M3 6h18M8 6V4c0-1 .9-2 2-2h4c1.1 0 2 1 2 2v2M19 6l-1 14H6L5 6M10 11v5M14 11v5"/>',
  sparkles: '<path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3L12 3Z"/><path d="M5 3v4M19 17v4M3 5h4M17 19h4"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5M12 15V3"/>',
  heart: '<path d="M19.5 12.6 12 20l-7.5-7.4A5 5 0 0 1 12 6a5 5 0 0 1 7.5 6.6Z"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m17 8-5-5-5 5M12 3v12"/>',
  expand: '<path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/>',
  upscale: '<path d="M12 21V7"/><path d="m6 13 6-6 6 6"/><path d="M4 3h16"/>',
  focus: '<path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M16 21h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
  sidebar: '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M9 3v18"/>',
  close: '<path d="M18 6 6 18M6 6l12 12"/>',
  chevron: '<path d="m6 9 6 6 6-6"/>',
  sliders: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>',
  arrowUp: '<path d="m18 12-6-6-6 6"/><path d="M12 6v13"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.42-1.42M17.66 6.34l1.41-1.41"/>',
  moon: '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z"/>',
  monitor: '<rect width="20" height="14" x="2" y="3" rx="2"/><path d="M8 21h8M12 17v4"/>',
  check: '<path d="m20 6-11 11-5-5"/>',
  user: '<path d="M20 21a8 8 0 0 0-16 0"/><circle cx="12" cy="7" r="4"/>',
  database: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5"/><path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>',
  image: '<rect width="18" height="18" x="3" y="3" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"/>',
  pin: '<path d="M12 17v5"/><path d="M5 17h14l-3-5V5l2-2H6l2 2v7Z"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/>'
};

const ABSTRACT_ICONS = {
  brand: "5",
  image: "1-5",
  video: "2-3",
  audio: "2-4",
  canvas: "2-5",
  prompt: "3-2",
  edit: "3-5",
  banana: "5-5",
  seedance: "5-3",
  openai: "4-2",
  flux: "4-4",
  kling: "3-4",
  wan: "5-2",
  grok: "4-3",
  gemini: "3-1",
  hailuo: "2-2",
  suno: "2-4",
  elevenlabs: "4-5"
};

function icon(name, size = 15) {
  return `<svg class="ui-icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON_PATHS[name] || ""}</svg>`;
}

function abstractIcon(name, size = 15) {
  const key = ABSTRACT_ICONS[name] || name || "spark";
  return `<span class="ui-icon abstract-icon abstract-icon-${h(key)}" style="--icon-size:${size}px;--abstract-icon:url('/abstract-logo/${h(key)}.png')" aria-hidden="true"></span>`;
}

function readThemeMode(preferred = "") {
  const saved = preferred || localStorage.getItem(THEME_STORAGE_KEY);
  const normalized = LEGACY_THEME_ALIASES[saved] || saved;
  if (normalized !== saved && THEME_MODE_VALUES.includes(normalized)) localStorage.setItem(THEME_STORAGE_KEY, normalized);
  return THEME_MODE_VALUES.includes(normalized) ? normalized : "system";
}

function readSidebarOpen() {
  return localStorage.getItem(SIDEBAR_STORAGE_KEY) !== "false";
}

function resolvedTheme(mode = state.themeMode) {
  return mode === "system" ? (themeMedia.matches ? "dark" : "light") : mode;
}

function normalizeLoaderMode(value) {
  return LOADER_MODE_VALUES.includes(value) ? value : "cellnoise";
}

function applyTheme(mode, { persist = true } = {}) {
  const normalized = LEGACY_THEME_ALIASES[mode] || mode;
  state.themeMode = THEME_MODE_VALUES.includes(normalized) ? normalized : "system";
  document.documentElement.dataset.theme = resolvedTheme(state.themeMode);
  document.documentElement.dataset.themeMode = state.themeMode;
  if (persist) {
    localStorage.setItem(THEME_STORAGE_KEY, state.themeMode);
    saveUiPrefs();
  }
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    },
    ...options
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(json.error || `Request failed: ${response.status}`);
  return json;
}

function applyServerState(next) {
  const currentPrefs = readUiPrefs();
  state.profile = next.profile || state.profile;
  state.settings = next.settings || state.settings;
  if (state.accountDraft?.loaderMode) {
    state.settings = { ...state.settings, loaderMode: state.accountDraft.loaderMode };
  }
  state.settings.loaderMode = normalizeLoaderMode(state.accountDraft?.loaderMode || currentPrefs.loaderMode || state.settings.loaderMode);
  if (!currentPrefs.themeMode && next.settings?.themeMode) {
    applyTheme(next.settings.themeMode, { persist: false });
  }
  if (!currentPrefs.view && next.settings?.lastView && VALID_VIEWS.includes(next.settings.lastView)) {
    state.view = next.settings.lastView;
  }
  state.activeChat = next.activeChat || state.activeChat;
  state.chats = next.chats || state.chats;
  state.assets = next.assets || state.assets;
  if (next.upscaleModels) state.upscaleModels = next.upscaleModels;
  if (next.canvasProjects) state.canvasProjects = mergeCanvasProjectsFromServer(next.canvasProjects);
  if (!state.activeCanvasProject && state.canvasProjects[0]) state.activeCanvasProject = state.canvasProjects[0].id;
}

function markCanvasProjectDirty(projectId, touched = Date.now()) {
  if (!projectId) return;
  canvasDirtyProjects.set(projectId, touched);
}

function markCanvasProjectClean(projectId, savedAt = Date.now()) {
  if (!projectId) return;
  const current = canvasDirtyProjects.get(projectId);
  if (!current || current <= savedAt) canvasDirtyProjects.delete(projectId);
}

function mergeCanvasProjectsFromServer(projects) {
  const local = new Map((state.canvasProjects || []).map((project) => [project.id, project]));
  const nowTime = Date.now();
  for (const [id, touched] of [...canvasDirtyProjects]) {
    if (nowTime - touched > 15000) canvasDirtyProjects.delete(id);
  }
  return projects.map((project) => {
    const localProject = local.get(project.id);
    return localProject && canvasDirtyProjects.has(project.id) ? localProject : project;
  });
}

async function init() {
  try {
    applyServerState(await api("/api/bootstrap"));
    normalizeOptionsForModel("image");
    normalizeOptionsForModel("video");
    state.ready = true;
    render();
    startCreditsSync();
  } catch (error) {
    root.innerHTML = `<div class="fatal">${h(error.message)}</div>`;
  }
}

function startCreditsSync() {
  clearInterval(creditsTimer);
  creditsTimer = setInterval(refreshCredits, 6000);
}

async function refreshCredits() {
  if (!state.ready || !state.settings.hasKieKey) return;
  try {
    const next = await api("/api/bootstrap");
    const prevCredits = state.settings.credits;
    applyServerState(next);
    const fresh = await api("/api/key-status");
    applyServerState(fresh);
    if (prevCredits !== state.settings.credits) paintCredits();
  } catch {}
}

function paintCredits() {
  const value = state.settings.credits;
  const text = value !== null && value !== undefined ? `${Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 })} credits` : keyLabel();
  root.querySelectorAll(".profile-copy small").forEach((item) => { item.textContent = text; });
  root.querySelectorAll(".credit-avatar").forEach((item) => {
    item.style.setProperty("--credit-fill", `${Math.min(100, Math.max(5, Number(value || 0) / 100))}%`);
  });
  root.querySelectorAll("[data-live-credits]").forEach((item) => { item.textContent = text; });
}

function formatBytes(bytes = 0) {
  const value = Number(bytes) || 0;
  if (value < 1024) return `${value} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let next = value / 1024;
  let index = 0;
  while (next >= 1024 && index < units.length - 1) {
    next /= 1024;
    index += 1;
  }
  return `${next.toLocaleString(undefined, { maximumFractionDigits: next >= 10 ? 1 : 2 })} ${units[index]}`;
}

function currentKind() {
  return ["image", "video", "audio"].includes(state.view) ? state.view : "image";
}

function currentChat(kind = currentKind()) {
  const list = state.chats[kind] || [];
  return list.find((chat) => chat.id === state.activeChat[kind]) || list[0];
}

function initials() {
  return (state.profile.nick || "cx")
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toLowerCase();
}

function render(options = {}) {
  if (!state.ready) return;
  const composerState = options.preserveComposer ? captureComposerState() : null;
  const scrollState = options.preserveScroll ? captureMessageScroll() : null;
  const mediaState = captureMediaState();
  const emptyChat = isCurrentChatEmpty();
  root.innerHTML = `
    <div class="app-shell ${state.sidebarOpen ? "" : "sidebar-collapsed"} ${emptyChat ? "is-empty-chat" : ""}">
      ${renderSidebar()}
      <main class="main-shell">
        ${renderTopbar()}
        <div class="workspace-area ${["image", "video", "audio"].includes(state.view) ? "with-settings" : ""}">
          ${renderView()}
          ${["image", "video", "audio"].includes(state.view) ? renderSettingsPanel(currentKind()) : ""}
        </div>
      </main>
    </div>
    ${state.toast ? `<div class="toast ${h(state.toast.tone || "")}">${h(state.toast.text)}</div>` : ""}
    ${state.preview ? renderPreviewModal() : ""}
    ${state.upscale ? renderUpscaleModal() : ""}
  `;
  bindEvents();
  refreshPromptHighlights();
  hydrateMediaPreviewCache();
  schedulePendingPolls();
  startAsciiNoise();
  startCellNoise();
  startElapsedTimers();
  requestAnimationFrame(() => {
    restoreMediaState(mediaState);
    if (composerState) restoreComposerState(composerState);
    if (scrollState) restoreMessageScroll(scrollState);
    else if (options.scrollToBottom !== false) scrollMessagesToBottom();
  });
}

function isCurrentChatEmpty() {
  if (!["image", "video", "audio"].includes(state.view)) return false;
  return !visibleMessages(currentChat(currentKind())).length;
}

let cellNoiseTimer = 0;
function startCellNoise() {
  if (cellNoiseTimer) return;
  const paint = (time) => {
    const canvases = Array.from(document.querySelectorAll("canvas[data-cell-noise]"));
    if (!canvases.length) {
      cellNoiseTimer = 0;
      return;
    }
    for (const canvas of canvases) paintCellNoise(canvas, time);
    cellNoiseTimer = requestAnimationFrame(paint);
  };
  cellNoiseTimer = requestAnimationFrame(paint);
}

function paintCellNoise(canvas, time) {
  const rect = canvas.getBoundingClientRect();
  if (rect.width < 2 || rect.height < 2) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const width = Math.max(2, Math.floor(rect.width * dpr));
  const height = Math.max(2, Math.floor(rect.height * dpr));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  const ctx = canvas.getContext("2d", { alpha: false });
  const cell = Math.max(10, Math.round(Math.min(width, height) / 13));
  const cols = Math.ceil(width / cell) + 1;
  const rows = Math.ceil(height / cell) + 1;
  const tick = Math.floor(time / 120);
  const driftX = Math.floor(time / 340) % 97;
  const driftY = Math.floor(time / 460) % 89;
  const style = getComputedStyle(canvas.closest(".c-node") || canvas);
  const accent = parseRgb(style.getPropertyValue("--node-color") || style.getPropertyValue("--accent") || "#5064d8");
  const dark = [12, 14, 19];
  const mid = mixRgb([75, 80, 91], accent, 0.12);
  const light = mixRgb([232, 235, 241], accent, 0.08);
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = rgb(dark);
  ctx.fillRect(0, 0, width, height);
  for (let y = -1; y < rows; y += 1) {
    for (let x = -1; x < cols; x += 1) {
      const a = hashNoise(x + driftX, y, tick);
      const b = hashNoise(Math.floor((x + driftX) / 3), Math.floor((y + driftY) / 2), Math.floor(tick / 2));
      const c = hashNoise(y - driftY, x, tick + 17);
      const value = Math.round((a * 0.62 + b * 0.27 + c * 0.11) * 8) / 8;
      ctx.fillStyle = rgb(mixRgb(dark, mixRgb(mid, light, value), value));
      ctx.fillRect(x * cell, y * cell, cell, cell);
    }
  }
  for (let i = 0; i < 18; i += 1) {
    const hx = hashNoise(i * 13, tick, driftX);
    const hy = hashNoise(tick, i * 17, driftY);
    const x = Math.floor(hx * cols) * cell;
    const y = Math.floor(hy * rows) * cell;
    const w = (1 + Math.floor(hashNoise(i, tick, 5) * 3)) * cell;
    const hgt = (1 + Math.floor(hashNoise(tick, i, 9) * 2)) * cell;
    const value = Math.round(hashNoise(i * 7, tick * 2, 31) * 7) / 7;
    ctx.fillStyle = rgb(mixRgb(dark, light, value));
    ctx.fillRect(x, y, w, hgt);
  }
}

function hashNoise(x, y, z) {
  const n = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453123;
  return n - Math.floor(n);
}

function parseRgb(value) {
  const nums = String(value).match(/\d+(?:\.\d+)?/g)?.slice(0, 3).map(Number);
  return nums?.length === 3 ? nums : [80, 100, 216];
}

function mixRgb(a, b, t) {
  return a.map((v, i) => Math.round(v + (b[i] - v) * t));
}

function rgb(values) {
  return `rgb(${values[0]},${values[1]},${values[2]})`;
}

function startElapsedTimers() {
  if (elapsedTimer) return;
  const tick = () => {
    const timers = Array.from(document.querySelectorAll("[data-generation-elapsed]"));
    if (!timers.length) {
      clearInterval(elapsedTimer);
      elapsedTimer = null;
      return;
    }
    const now = Date.now();
    for (const timer of timers) {
      const startedAt = Number(timer.dataset.generationElapsed);
      if (Number.isFinite(startedAt)) timer.textContent = formatElapsed(now - startedAt);
    }
  };
  tick();
  elapsedTimer = window.setInterval(tick, 1000);
}

function captureMediaState() {
  return Array.from(root.querySelectorAll("video[data-media-key]")).map((video) => ({
    key: video.dataset.mediaKey,
    time: video.currentTime,
    paused: video.paused,
    muted: video.muted,
    volume: video.volume
  }));
}

function restoreMediaState(snapshot) {
  for (const item of snapshot) {
    const video = root.querySelector(`video[data-media-key="${item.key}"]`);
    if (!video) continue;
    const restore = () => {
      video.currentTime = Math.min(item.time || 0, Number.isFinite(video.duration) ? video.duration : item.time || 0);
      video.muted = item.muted;
      video.volume = item.volume;
      if (!item.paused) video.play().catch(() => {});
    };
    if (video.readyState >= 1) restore();
    else video.addEventListener("loadedmetadata", restore, { once: true });
  }
}

function mediaCacheKey(url = "") {
  return String(url || "").trim();
}

function mediaDisplayUrl(url = "") {
  const key = mediaCacheKey(url);
  const entry = mediaPreviewCache.get(key);
  if (!entry?.objectUrl) return url;
  entry.lastUsed = Date.now();
  return entry.objectUrl;
}

function rememberMediaLoaded(url = "") {
  const key = mediaCacheKey(url);
  if (!key) return;
  const entry = mediaPreviewCache.get(key) || {};
  entry.loaded = true;
  entry.lastUsed = Date.now();
  mediaPreviewCache.set(key, entry);
}

function trimMediaPreviewCache() {
  const nowTime = Date.now();
  for (const [key, entry] of [...mediaPreviewCache]) {
    if (nowTime - (entry.lastUsed || 0) <= MEDIA_CACHE_TTL_MS) continue;
    if (entry.objectUrl) URL.revokeObjectURL(entry.objectUrl);
    mediaPreviewCache.delete(key);
  }
  const entries = [...mediaPreviewCache.entries()].sort((a, b) => (a[1].lastUsed || 0) - (b[1].lastUsed || 0));
  let totalBytes = entries.reduce((sum, [, entry]) => sum + Number(entry.bytes || 0), 0);
  while (entries.length > MEDIA_CACHE_MAX_ITEMS || totalBytes > MEDIA_CACHE_MAX_TOTAL_BYTES) {
    const [key, entry] = entries.shift();
    if (entry?.objectUrl) URL.revokeObjectURL(entry.objectUrl);
    totalBytes -= Number(entry?.bytes || 0);
    mediaPreviewCache.delete(key);
  }
}

function shouldFetchPreview(url = "") {
  if (!url || String(url).startsWith("data:") || String(url).startsWith("blob:")) return false;
  try {
    const parsed = new URL(url, window.location.href);
    return parsed.origin === window.location.origin || parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function scheduleMediaPreviewFetch(url = "") {
  const key = mediaCacheKey(url);
  if (!shouldFetchPreview(key)) return;
  const existing = mediaPreviewCache.get(key);
  if (existing?.objectUrl || existing?.pending || existing?.failedAt && Date.now() - existing.failedAt < 30000) return;
  const entry = { ...(existing || {}), pending: true, lastUsed: Date.now() };
  mediaPreviewCache.set(key, entry);
  fetch(key)
    .then((response) => {
      if (!response.ok) throw new Error(`Preview cache failed: ${response.status}`);
      const size = Number(response.headers.get("content-length") || 0);
      if (size > MEDIA_CACHE_MAX_ITEM_BYTES) throw new Error("Preview too large for memory cache.");
      return response.blob();
    })
    .then((blob) => {
      if (blob.size > MEDIA_CACHE_MAX_ITEM_BYTES) throw new Error("Preview too large for memory cache.");
      if (entry.objectUrl) URL.revokeObjectURL(entry.objectUrl);
      entry.objectUrl = URL.createObjectURL(blob);
      entry.bytes = blob.size;
      entry.loaded = true;
      entry.pending = false;
      entry.failedAt = 0;
      entry.lastUsed = Date.now();
      hydrateMediaPreviewCache();
      trimMediaPreviewCache();
    })
    .catch(() => {
      entry.pending = false;
      entry.failedAt = Date.now();
    });
}

function hydrateMediaPreviewCache(scope = root) {
  const nodes = Array.from(scope.querySelectorAll("[data-cache-src]"));
  for (const node of nodes) {
    const original = node.dataset.cacheSrc;
    const cached = mediaDisplayUrl(original);
    if (cached && node.getAttribute("src") !== cached) node.setAttribute("src", cached);
    if (mediaPreviewCache.get(mediaCacheKey(original))?.loaded) node.closest(".result-media,.library-media,.attached-preview,.message-attachment")?.classList.add("is-media-cached");
    scheduleMediaPreviewFetch(original);
    const mark = () => {
      rememberMediaLoaded(original);
      node.closest(".result-media,.library-media,.attached-preview,.message-attachment")?.classList.add("is-media-cached");
    };
    if (node.tagName === "IMG" && node.complete) mark();
    else if (node.readyState >= 2) mark();
    else {
      node.addEventListener("load", mark, { once: true });
      node.addEventListener("loadeddata", mark, { once: true });
      node.addEventListener("canplay", mark, { once: true });
    }
  }
  trimMediaPreviewCache();
}

function captureComposerState() {
  const textarea = document.activeElement?.matches?.("[data-prompt]") ? document.activeElement : null;
  if (!textarea) return null;
  return {
    kind: textarea.dataset.prompt,
    start: textarea.selectionStart,
    end: textarea.selectionEnd,
    scrollTop: textarea.scrollTop
  };
}

function restoreComposerState(snapshot) {
  const textarea = root.querySelector(`[data-prompt="${snapshot.kind}"]`);
  if (!textarea) return;
  textarea.focus({ preventScroll: true });
  const length = textarea.value.length;
  textarea.setSelectionRange(Math.min(snapshot.start, length), Math.min(snapshot.end, length));
  textarea.scrollTop = snapshot.scrollTop;
  autoSizeTextarea(textarea);
}

function captureMessageScroll() {
  const element = root.querySelector("[data-message-list]");
  if (!element) return null;
  return { top: element.scrollTop, height: element.scrollHeight };
}

function restoreMessageScroll(snapshot) {
  const element = root.querySelector("[data-message-list]");
  if (!element) return;
  const heightDelta = Math.max(0, element.scrollHeight - (snapshot.height || element.scrollHeight));
  element.scrollTop = snapshot.top + heightDelta;
}

function renderSidebar() {
  const kind = currentKind();
  const showHistory = ["image", "video", "audio"].includes(state.view);
  const chats = showHistory ? sortedPinned(state.chats[kind] || []) : [];
  return `
    <aside class="sidebar" aria-label="Workspace sidebar">
      <div class="brand"><button type="button" class="brand-orbit logo-sidebar-toggle" data-toggle-sidebar title="${state.sidebarOpen ? "Collapse sidebar" : "Open sidebar"}" aria-label="${state.sidebarOpen ? "Collapse sidebar" : "Open sidebar"}"><span class="brand-logo-mark">${abstractIcon("brand", 42)}</span><span class="brand-open-mark">${icon("sidebar", 18)}</span><span class="brand-tooltip">Open sidebar</span></button><b>connxn<span>.ui</span></b><button type="button" class="sidebar-toggle" data-toggle-sidebar title="${state.sidebarOpen ? "Collapse sidebar" : "Expand sidebar"}" aria-label="${state.sidebarOpen ? "Collapse sidebar" : "Expand sidebar"}">${icon("sidebar", 16)}</button></div>
      ${showHistory ? `
        <button class="new-chat" data-new-chat="${kind}">${icon("plus", 17)}<span>New chat</span></button>
        <div class="history-label">Recent</div>
        <div class="chat-list">
          ${chats.map((chat) => renderChatListItem(chat, kind)).join("")}
        </div>
      ` : state.view === "canvas" ? renderCanvasSidebar() : `<div class="sidebar-space"></div>`}
      <button class="profile-button ${state.view === "account" ? "active" : ""}" data-view="account">
        <span class="credit-avatar" style="--credit-fill:${Math.min(100, Math.max(5, Number(state.settings.credits || 0) / 100))}%">${renderAvatar("small")}</span>
        <span class="profile-copy"><b>${h(state.profile.nick)}</b><small>${state.settings.credits !== null ? `${Number(state.settings.credits).toLocaleString(undefined, { maximumFractionDigits: 2 })} credits` : keyLabel()}</small></span>
        <span class="connection-dot ${h(state.settings.keyStatus || "missing")}"></span>
      </button>
    </aside>
  `;
}

function renderCanvasSidebar() {
  const projects = sortedPinned(state.canvasProjects || []);
  return `<button class="new-chat" data-new-canvas>${icon("plus", 17)}<span>New flow</span></button><div class="history-label">Projects</div><div class="chat-list">${projects.map((item) => {
    const active = item.id === state.activeCanvasProject || (!state.activeCanvasProject && item === projects[0]);
    const editing = state.editingCanvasProject === item.id;
    return `<div class="canvas-project-row">${editing
      ? `<input class="inline-name-input chat-item active" data-canvas-rename-input="${h(item.id)}" value="${h(item.name || "Untitled flow")}" />`
      : `<button class="chat-item ${active ? "active" : ""} ${item.pinned ? "pinned" : ""}" data-canvas-project="${h(item.id)}" data-canvas-rename-start="${h(item.id)}" title="Double-click to rename"><span>${h(item.name)}</span></button>`}<div class="canvas-project-actions"><button type="button" class="chat-pin ${item.pinned ? "active" : ""}" data-pin-canvas="${h(item.id)}" title="${item.pinned ? "Unpin workflow" : "Pin workflow"}" aria-label="${item.pinned ? "Unpin workflow" : "Pin workflow"}">${icon("pin", 13)}</button><button class="canvas-project-export" data-export-canvas="${h(item.id)}" title="Export flow" aria-label="Export flow">${icon("download", 13)}</button><button class="canvas-project-delete" data-delete-canvas="${h(item.id)}" title="Delete flow" aria-label="Delete flow">${icon("trash", 13)}</button></div></div>`;
  }).join("")}</div>`;
}

function renderChatListItem(chat, kind) {
  const active = state.activeChat[kind] === chat.id;
  const editing = state.editingChat?.id === chat.id;
  return `
    <div class="chat-row">
      ${editing
        ? `<input class="inline-name-input chat-item active" data-chat-rename-input="${h(chat.id)}" data-chat-rename-kind="${h(kind)}" value="${h(chat.title || "New chat")}" />`
        : `<button class="chat-item ${active ? "active" : ""} ${chat.pinned ? "pinned" : ""}" data-chat-id="${h(chat.id)}" data-chat-kind="${kind}" data-chat-rename-start="${h(chat.id)}">
        <span>${h(chat.title)}</span>
      </button>`}
      <button type="button" class="chat-pin ${chat.pinned ? "active" : ""}" data-pin-chat="${h(chat.id)}" data-pin-chat-kind="${h(kind)}" title="${chat.pinned ? "Unpin chat" : "Pin chat"}" aria-label="${chat.pinned ? "Unpin chat" : "Pin chat"}">${icon("pin", 13)}</button>
      <button type="button" class="chat-delete" data-delete-chat="${h(chat.id)}" data-delete-chat-kind="${kind}" title="Delete chat" aria-label="Delete chat">${icon("trash", 13)}</button>
    </div>
  `;
}

function sortedPinned(items) {
  return [...items].sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) || String(b.updatedAt || b.createdAt || "").localeCompare(String(a.updatedAt || a.createdAt || "")));
}

function renderAvatar(size = "small", source = state.profile.avatarData) {
  const className = `avatar ${size}`;
  if (source) return `<span class="${className}"><img src="${h(source)}" alt="" /></span>`;
  return `<span class="${className}">${h(initials())}</span>`;
}

function renderTopbar() {
  const showControls = ["image", "video"].includes(state.view);
  return `
    <header class="topbar">
      <nav class="mode-tabs" aria-label="Workspace">
        ${topTab("image", "Image")}
        ${topTab("video", "Video")}
        ${topTab("canvas", "Canvas")}
        ${topTab("library", "Library")}
      </nav>
      <div class="topbar-actions">
        ${showControls ? `<button class="controls-shortcut" data-toggle-panel title="Generation controls">${icon("sliders", 14)}<span>Controls</span></button>` : ""}
        <button class="account-shortcut credits-shortcut" data-view="account" title="Account credits">
          <span class="credits-glyph" aria-hidden="true"></span>
          <span class="credits-copy"><b data-live-credits>${h(state.settings.credits !== null && state.settings.credits !== undefined ? `${Number(state.settings.credits).toLocaleString(undefined, { maximumFractionDigits: 2 })} credits` : keyLabel())}</b></span>
        </button>
      </div>
    </header>
  `;
}

function renderThemeControl() {
  const selected = THEME_ITEMS.find(([mode]) => mode === state.themeMode) || THEME_ITEMS[0];
  const loaderMode = normalizeLoaderMode(state.accountDraft?.loaderMode || state.settings.loaderMode);
  return `
    <section class="account-theme-section account-card">
      <div class="account-card-head">
        <i>${icon("monitor", 17)}</i><div><span>Appearance</span><b>Interface palette and loader</b></div>
      </div>
      <div class="theme-select-wrap">
        <button type="button" class="theme-select-button" data-theme-toggle aria-expanded="false">
          <i class="theme-swatch theme-swatch-${h(selected[0])}"></i>
          <span><b>${h(selected[1])}</b><small>${h(selected[2])}</small></span>
          ${icon("chevron", 15)}
        </button>
        <div class="theme-menu account-theme-menu" data-theme-menu hidden>
        ${THEME_ITEMS.map(([mode, label, detail]) => `
          <button type="button" class="theme-option ${state.themeMode === mode ? "selected" : ""}" data-theme-mode="${mode}">
            <i class="theme-swatch theme-swatch-${h(mode)}"></i><span><b>${label}</b><small>${detail}</small></span>${state.themeMode === mode ? icon("check", 14) : ""}
          </button>
        `).join("")}
        </div>
      </div>
      <div class="loader-field">
        <span>Generation loader</span>
        <div class="loader-segments" role="group" aria-label="Generation loader">
          ${LOADER_ITEMS.map(([mode, label, detail]) => `
            <button type="button" class="${loaderMode === mode ? "active" : ""}" data-loader-mode="${h(mode)}" title="${h(detail)}">
              <b>${h(label)}</b><small>${h(detail)}</small>
            </button>
          `).join("")}
        </div>
      </div>
    </section>
  `;
}

function topTab(view, label) {
  return `<button class="mode-tab ${state.view === view ? "active" : ""}" data-view="${view}">${label}</button>`;
}

function renderView() {
  if (state.view === "audio") state.view = "image";
  if (state.view === "account") return renderAccount();
  if (state.view === "canvas") return window.__renderCanvasV2 ? window.__renderCanvasV2() : renderCanvas();
  if (state.view === "library") return renderLibrary();
  return renderChat(currentKind());
}

function upscaleModelsFor(kind) {
  return (state.upscaleModels || []).filter((model) => model.kind === kind);
}

function upscaleModelById(id) {
  return (state.upscaleModels || []).find((model) => model.id === id) || null;
}

function modelFor(kind, id = state.options[kind].model) {
  const upscaleModel = upscaleModelById(id);
  if (upscaleModel) return upscaleModel;
  const registry = kind === "image" ? imageModelRegistry : kind === "video" ? videoModelRegistry : audioModelRegistry;
  return registry.find((model) => model.id === id) || registry[0];
}

function normalizeResolution(value = "") {
  return String(value || "").trim().toLowerCase().replace("k", "K").replace("p", "p");
}

function normalizePriceKey(value = "") {
  return String(value || "").trim();
}

function optionDuration(options = {}, model = null) {
  const raw = Number(options.duration || model?.durationRange?.default || model?.durations?.[0]?.[0] || 1);
  return Math.max(1, Number.isFinite(raw) ? raw : 1);
}

function estimateKieCredits(kind, options = {}, context = {}) {
  const modelId = options.model || context.modelId || modelFor(kind)?.id || "";
  const model = kind === "image" ? modelFor("image", modelId) : kind === "video" ? modelFor("video", modelId) : modelFor("audio", modelId);
  const pricing = KIE_PRICING[modelId];
  if (!pricing) {
    return { known: false, label: "Pricing unknown", credits: null, details: [`${model?.label || modelId}: no public KIE rate in local table.`], source: KIE_PRICING_SOURCE };
  }
  const resolution = normalizeResolution(options.resolution || "");
  const details = [pricing.note, `Source: ${KIE_PRICING_SOURCE}, checked ${KIE_PRICING_UPDATED}.`];
  let credits = pricing.credits ?? pricing.fallbackCredits ?? 0;
  if (pricing.byResolution) {
    credits = pricing.byResolution[resolution] ?? pricing.byResolution[options.resolution] ?? pricing.fallbackCredits;
    details.push(`Resolution ${options.resolution || "default"}: ${formatCredits(credits)}.`);
  }
  if (pricing.byQuality) {
    const quality = normalizePriceKey(options.quality || model?.defaultQuality || "");
    credits = pricing.byQuality[quality] ?? pricing.fallbackCredits;
    details.push(`Quality ${quality || "default"}: ${formatCredits(credits)}.`);
  }
  if (pricing.unit === "second") {
    const seconds = optionDuration(options, model);
    const quality = normalizePriceKey(options.quality || "std");
    const rate = pricing.byQualityPerSecond?.[quality]
      ?? pricing.byResolutionPerSecond?.[resolution]
      ?? pricing.byResolutionPerSecond?.[options.resolution]
      ?? pricing.creditsPerSecond
      ?? pricing.fallbackCreditsPerSecond;
    credits = rate * seconds;
    details.push(`${formatCredits(rate)} / sec x ${seconds}s${pricing.byQualityPerSecond ? ` / ${quality}` : ""}.`);
  } else if (pricing.unit === "image") {
    details.push(`${formatCredits(credits)} / image.`);
  } else if (pricing.unit === "video") {
    details.push(`${formatCredits(credits)} / video.`);
  }
  if (context.refsCount || pricing.flatParams?.includes("refs")) details.push(`${context.refsCount || 0} refs: no separate public KIE modifier found.`);
  if (pricing.flatParams?.includes("resolution") && options.resolution) details.push(`Resolution ${options.resolution}: public KIE listing is flat for this model.`);
  if (pricing.flatParams?.includes("quality") && options.quality) details.push(`Quality ${options.quality}: public KIE listing is flat for this model.`);
  if (kind === "video" && model?.sound) details.push(`Generate sound ${options.sound ? "on" : "off"}: no separate public KIE modifier found.`);
  const rounded = Math.ceil((Number(credits) || 0) * 10) / 10;
  return { known: true, credits: rounded, label: `~${formatCredits(rounded)}`, details, source: KIE_PRICING_SOURCE };
}

function formatCredits(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "? cr";
  return `${number.toLocaleString(undefined, { maximumFractionDigits: number >= 10 ? 0 : 1 })} cr`;
}

function pricingBubble(estimate, tone = "") {
  return "";
}

function updateComposerPricing(kind) {
  root.querySelector(".composer-pricing-float")?.remove();
}

function modelIcon(model, kind = "image", size = 24) {
  const key = `${model?.family || ""} ${model?.label || ""} ${model?.id || ""}`.toLowerCase();
  const name = key.includes("banana") ? "banana"
    : key.includes("seed") ? "seedance"
    : key.includes("openai") || key.includes("gpt") ? "openai"
    : key.includes("flux") ? "flux"
    : key.includes("kling") ? "kling"
    : key.includes("wan") ? "wan"
    : key.includes("grok") ? "grok"
    : key.includes("gemini") || key.includes("imagen") ? "gemini"
    : key.includes("hailuo") ? "hailuo"
    : key.includes("suno") ? "suno"
    : key.includes("eleven") ? "elevenlabs"
    : kind;
  return abstractIcon(name, size);
}

function renderSettingsPanel(kind) {
  const model = modelFor(kind);
  const registry = kind === "image" ? imageModelRegistry : kind === "video" ? videoModelRegistry : audioModelRegistry;
  return `
    <aside class="settings-panel ${state.panelOpen ? "open" : ""}" data-settings-panel="${kind}">
      <header class="settings-header">
        <div><span>${kind}</span><h2>Controls</h2></div>
        <button type="button" class="panel-close" data-toggle-panel title="Close controls" aria-label="Close controls">${icon("close", 15)}</button>
      </header>
      <section class="settings-section model-section">
        <label class="setting-label">Model</label>
        <button type="button" class="model-picker-button" data-model-picker="${kind}">
          <i class="model-logo">${modelIcon(model, kind, 30)}</i><span><b>${h(model.label)}</b><small>${h(model.family)}</small></span><i>${icon("chevron", 14)}</i>
        </button>
        <div class="model-menu" data-model-menu="${kind}" hidden>
          <input type="search" placeholder="Search models" data-model-search="${kind}" autocomplete="off" />
          <div class="model-options">
            ${registry.map((item) => `
              <button type="button" class="model-option ${item.id === model.id ? "selected" : ""}" data-select-model="${h(item.id)}" data-model-kind="${kind}" data-search-value="${h(searchHaystack(`${item.label} ${item.family} ${item.id}`))}">
                <i class="model-logo">${modelIcon(item, kind, 24)}</i><span><b>${h(item.label)}</b><small>${h(item.family)}</small></span>${item.id === model.id ? "<em>Selected</em>" : ""}
              </button>
            `).join("")}
          </div>
        </div>
        <div class="capability-row">${modelCapabilities(model, kind).map((label) => `<span>${h(label)}</span>`).join("")}</div>
      </section>
      ${kind === "image" ? renderImageSettings() : kind === "audio" ? renderAudioSettings(model) : renderVideoSettings(model)}
    </aside>
  `;
}

function renderAudioSettings(model) {
  return `
    <section class="settings-section"><h3>Audio output</h3>
      ${model.kind === "speech" ? `${panelSelect("audio", "voice", [["Rachel", "Rachel"], ["Adam", "Adam"], ["Antoni", "Antoni"]], "Voice")}${panelSelect("audio", "language", [["", "Auto"], ["en", "English"], ["ru", "Russian"]], "Language")}${panelRange("audio", "speed", "Speed", { min: 0.5, max: 2, step: 0.05, default: 1 })}` : `${panelToggle("audio", "customMode", "Custom mode")}${panelToggle("audio", "instrumental", "Instrumental")}<label class="setting-field"><span>Style</span><textarea rows="3" data-option="style" data-kind="audio">${h(state.options.audio.style)}</textarea></label>`}
    </section>
  `;
}

function renderImageSettings() {
  const model = modelFor("image");
  const ratios = model.ratios || IMAGE_RATIOS;
  const resolutions = model.noResolution ? [] : (model.resolutions || (model.seedream5 ? [] : IMAGE_RESOLUTIONS));
  const qualities = model.noQuality ? [] : (model.qualities || IMAGE_QUALITIES);
  const outputFormats = model.noFormat ? [] : (model.outputFormats || IMAGE_FORMATS);
  return `
    <section class="settings-section">
      <h3>Output</h3>
      ${panelSelect("image", "aspectRatio", "Aspect ratio", ratios)}
      ${resolutions.length ? panelSelect("image", "resolution", "Resolution", resolutions) : ""}
      ${outputFormats.length ? panelSelect("image", "outputFormat", "Format", outputFormats) : ""}
      ${qualities.length ? panelSelect("image", "quality", "Quality", qualities) : ""}
    </section>
    ${model.nsfwChecker || model.negative ? `
      <section class="settings-section">
        <h3>Options</h3>
        ${model.nsfwChecker ? panelToggle("image", "nsfwChecker", "NSFW checker") : ""}
        ${model.negative ? `<label class="setting-field"><span>Negative prompt</span><textarea rows="4" data-option="negativePrompt" data-kind="image">${h(state.options.image.negativePrompt)}</textarea></label>` : ""}
      </section>
    ` : ""}
    ${model.refsLimit ? `
      <section class="settings-section">
        <h3>References</h3>
        <p class="setting-help">Up to ${h(model.refsLimit)} images for edit mode.</p>
      </section>
    ` : ""}
  `;
}

function renderVideoSettings(model) {
  return `
    ${model.modes?.length ? `<section class="settings-section"><h3>Input</h3>${panelSelect("video", "inputMode", "Mode", model.modes.map((mode) => [mode, inputModeLabel(mode)]))}</section>` : ""}
    <section class="settings-section">
      <h3>Output</h3>
      ${model.ratios?.length ? panelSelect("video", "aspectRatio", "Aspect ratio", model.ratios) : ""}
      ${model.resolutions?.length ? panelSelect("video", "resolution", "Resolution", model.resolutions) : ""}
      ${model.durationRange ? panelRange("video", "duration", "Duration", model.durationRange) : model.durations?.length ? panelSelect("video", "duration", "Duration", model.durations) : ""}
      ${model.qualities?.length ? panelSelect("video", "quality", "Quality", model.qualities) : ""}
    </section>
    ${model.sound || model.fixedLens || model.webSearch || model.returnLastFrame || model.promptExtend || model.nsfwChecker ? `
      <section class="settings-section">
        <h3>Options</h3>
        ${model.sound ? panelToggle("video", "sound", "Generate sound") : ""}
        ${model.fixedLens ? panelToggle("video", "fixedLens", "Lock camera") : ""}
        ${model.webSearch ? panelToggle("video", "webSearch", "Web search") : ""}
        ${model.returnLastFrame ? panelToggle("video", "returnLastFrame", "Return last frame") : ""}
        ${model.promptExtend ? panelToggle("video", "promptExtend", "Prompt expansion") : ""}
        ${model.nsfwChecker ? panelToggle("video", "nsfwChecker", "NSFW checker") : ""}
      </section>
    ` : ""}
    ${model.negative ? `
      <section class="settings-section">
        <label class="setting-field"><span>Negative prompt</span><textarea rows="4" data-option="negativePrompt" data-kind="video">${h(state.options.video.negativePrompt)}</textarea></label>
      </section>
    ` : ""}
  `;
}

function panelSelect(kind, key, label, options) {
  const value = state.options[kind][key];
  return `
    <label class="setting-field">
      <span>${h(label)}</span>
      <select data-option="${key}" data-kind="${kind}">
        ${options.map(([optionValue, optionLabel]) => `<option value="${h(optionValue)}" ${String(value) === String(optionValue) ? "selected" : ""}>${h(optionLabel)}</option>`).join("")}
      </select>
    </label>
  `;
}

function panelRange(kind, key, label, range) {
  const value = Number(state.options[kind][key] || range.default || range.min);
  const progress = ((value - range.min) / (range.max - range.min)) * 100;
  return `
    <label class="setting-field range-field">
      <span>${h(label)} <b data-range-output="${key}">${h(value)}s</b></span>
      <input type="range" min="${range.min}" max="${range.max}" step="${range.step || 1}" value="${value}" data-option="${key}" data-kind="${kind}" style="--range-progress:${progress}%" />
      <small><i>${range.min}s</i><i>${range.max}s</i></small>
    </label>
  `;
}

function panelToggle(kind, key, label) {
  return `
    <label class="setting-toggle">
      <span>${h(label)}</span>
      <input type="checkbox" data-option="${key}" data-kind="${kind}" ${state.options[kind][key] ? "checked" : ""} />
      <i aria-hidden="true"></i>
    </label>
  `;
}

function inputModeLabel(mode) {
  if (mode === "frames") return "Start / End frames";
  if (mode === "references") return "Multimodal references";
  return "Auto detect";
}

function modelCapabilities(model, kind) {
  if (kind === "image") return model.refs ? ["Text", "Image edit"] : ["Text"];
  const labels = ["Text"];
  if (model.roles?.image?.some((role) => role === "start" || role === "end")) labels.push("Frames");
  if (model.roles?.image?.includes("reference")) labels.push("Images");
  if (model.roles?.video?.length) labels.push("Video");
  if (model.sound) labels.push("Sound");
  return labels;
}

function renderChat(kind) {
  const chat = currentChat(kind);
  if (kind === "image" || kind === "video") return renderGenerationFlow(chat, kind);
  const messages = visibleMessages(chat);
  const limit = Math.max(CHAT_PAGE_SIZE, state.messageLimits[kind] || CHAT_PAGE_SIZE);
  const visible = messages.slice(Math.max(0, messages.length - limit));
  const hiddenCount = Math.max(0, messages.length - visible.length);
  return `
    <section class="chat-page ${state.dragActive === kind ? "dragging" : ""}" data-drop-zone="${kind}">
      <div class="chat-scroll" data-message-list>
        <div class="message-column">
          ${hiddenCount ? `<button type="button" class="load-more-button load-more-messages" data-load-more-messages="${h(kind)}">Load ${Math.min(CHAT_PAGE_SIZE, hiddenCount)} older</button>` : ""}
          ${messages.length ? visible.map(renderMessage).join("") : renderEmptyChat(kind)}
        </div>
      </div>
      ${renderComposer(kind)}
      <div class="drop-overlay"><div><b>Drop media</b><span>Attach to this message</span></div></div>
    </section>
  `;
}

function generationTiles(chat, kind) {
  const messages = visibleMessages(chat);
  return messages
    .map((message, index) => {
      if (message.role !== "assistant" || message.kind !== kind) return null;
      const promptMessage = promptMessageForRecord({ chat, message }) || [...messages].slice(0, index).reverse().find((item) => item.role === "user");
      const prompt = promptMessage?.text || "";
      return { message, prompt, promptMessage };
    })
    .filter(Boolean);
}

function renderGenerationFlow(chat, kind) {
  const tiles = generationTiles(chat, kind);
  const limit = Math.max(FLOW_PAGE_SIZE, state.messageLimits[kind] || FLOW_PAGE_SIZE);
  const visible = tiles.slice(Math.max(0, tiles.length - limit));
  const hiddenCount = Math.max(0, tiles.length - visible.length);
  return `
    <section class="chat-page video-flow-page generation-flow-page ${kind}-flow-page ${state.dragActive === kind ? "dragging" : ""}" data-drop-zone="${h(kind)}">
      <div class="video-flow-scroll" data-message-list>
        <div class="video-flow-grid">
          ${hiddenCount ? `<button type="button" class="load-more-button load-more-tiles" data-load-more-messages="${h(kind)}">Load ${Math.min(FLOW_PAGE_SIZE, hiddenCount)} older</button>` : ""}
          ${tiles.length ? visible.map((tile) => renderGenerationTile(tile, kind)).join("") : renderEmptyChat(kind)}
        </div>
      </div>
      ${renderComposer(kind)}
      <div class="drop-overlay"><div><b>Drop media</b><span>Attach to this generation</span></div></div>
    </section>
  `;
}

function renderGenerationTile({ message, prompt, promptMessage }, kind = message.kind || "image") {
  const options = generationTileOptions(message, promptMessage, kind);
  const model = modelFor(kind, options.model);
  const result = message.result;
  const url = result?.urls?.[0] || result?.url || "";
  const ratio = generationTileRatio(message, kind, options);
  const ratioClass = generationTileRatioClass(ratio);
  const tileSpan = generationTileSpan(ratio);
  const pending = !url && ["generating", "queued", "waiting", "queuing"].includes(message.status);
  const failed = !url && message.status === "error";
  const mediaBlock = url
    ? `<div class="result-media video-tile-media" data-preview-media="${h(message.id)}" role="button" tabindex="0" aria-label="Preview generated ${h(kind)}">${kind === "video" ? `<div class="video-tile-frame-loading"></div><video src="${h(mediaDisplayUrl(url))}" data-cache-src="${h(url)}" playsinline muted preload="metadata" data-inline-video data-media-key="${h(message.id)}"></video>` : `<img src="${h(mediaDisplayUrl(url))}" data-cache-src="${h(url)}" alt="Generated image" loading="lazy" decoding="async" />`}</div>`
    : pending
      ? `<div class="video-tile-media video-tile-placeholder video-tile-loading ${loaderClass()}" aria-label="Rendering ${h(kind)}" style="--loading-ratio:${h(ratio)}">${loadingVisual()}</div>`
      : failed
        ? `<div class="video-tile-media video-tile-placeholder is-error"><b>Generation failed</b><span>${h(message.error || message.text || "Unknown error")}</span></div>`
        : `<div class="video-tile-media video-tile-placeholder"><span>No media URL returned</span></div>`;
  return `
    <article class="video-tile ${kind}-tile ${ratioClass} ${pending ? "is-generating" : ""}" data-message-id="${h(message.id)}" style="--tile-ratio:${h(ratio)};--tile-span:${tileSpan}">
      ${mediaBlock}
      <div class="video-tile-shade"></div>
      <div class="video-tile-info">
        <div class="tile-mark">${abstractIcon(kind === "video" ? "video" : "spark", 22)}</div>
        <div><b>${h(model.label)}</b><span>${h(optionSummary(options))}${pending ? ` · ${elapsedMarkup(message)}` : ""}</span><small>${h(prompt || message.text || `${kind === "video" ? "Video" : "Image"} generation`)}</small></div>
      </div>
      <div class="video-tile-actions">
        ${pending ? `<button type="button" data-cancel-message="${h(message.id)}" title="Cancel generation" aria-label="Cancel generation">${icon("close")}</button>` : ""}
        <button type="button" data-use-prompt-message="${h(message.id)}" title="Copy with prompt" aria-label="Copy with prompt">${icon("copy")}</button>
        ${!pending ? `<button type="button" data-regenerate-message="${h(message.id)}" title="Regenerate" aria-label="Regenerate">${icon("sparkles")}</button>` : ""}
        ${url ? `<button type="button" data-upscale-message="${h(message.id)}" title="Upscale" aria-label="Upscale">${icon("upscale")}</button>${favoriteButton("message", message.id, url)}<button type="button" data-send-canvas="${h(message.id)}" title="Send to canvas" aria-label="Send to canvas">${icon("focus", 15)}</button><button type="button" data-preview-result="${h(message.id)}" title="Preview" aria-label="Preview">${icon("expand")}</button>${saveMediaButton(url, message.kind, generatedDownloadStem(message, prompt))}` : ""}
        <button type="button" class="danger" data-delete-message="${h(message.id)}" title="Delete" aria-label="Delete">${icon("trash")}</button>
      </div>
    </article>
  `;
}

function visibleMessages(chat) {
  const messages = [];
  for (const message of chat?.messages || []) {
    if (message.role === "assistant" && message.result?.mock) {
      if (messages.at(-1)?.role === "user") messages.pop();
      continue;
    }
    messages.push(message);
  }
  return messages;
}

function renderEmptyChat(kind) {
  const model = optionLabel(kind, "model");
  return `
    <div class="empty-chat">
      <div class="empty-mark">${abstractIcon(kind === "video" ? "video" : kind === "audio" ? "audio" : "spark", 34)}</div>
      <h1>${kind === "image" ? "Create an image" : "Create a video"}</h1>
      <span>${h(model)}</span>
    </div>
  `;
}

function renderMessage(message) {
  if (message.role === "user") {
    return `
      <article class="message user-message" data-message-id="${h(message.id)}">
        <div class="user-content">
          ${renderMessageRefs(message.refs || [])}
          ${message.editContext ? `<div class="context-badge">Editing previous image</div>` : ""}
          <div class="user-bubble">${highlightMessageMentions(message.text)}</div>
          ${renderMessageActions(message)}
        </div>
      </article>
    `;
  }

  const hasResult = Boolean(message.result?.url || message.result?.urls?.[0]);
  const pending = !hasResult && ["generating", "queued", "waiting", "queuing"].includes(message.status);
  const loading = pending && message.kind === "video"
    ? `<div class="video-inline-loading ${loaderClass()}" aria-label="Rendering video" style="--loading-ratio:${h(aspectRatioCss(message.options, "16 / 9"))}">${loadingVisual()}${elapsedMarkup(message)}</div>`
    : renderLoadingCard(message);
  return `
    <article class="message assistant-message" data-message-id="${h(message.id)}">
      <div class="assistant-head"><div class="assistant-label">connxn</div>${renderMessageActions(message)}</div>
      ${hasResult
        ? renderResult(message)
        : pending
          ? loading
          : message.status === "error"
            ? `<div class="error-message"><b>Generation failed</b><span>${h(message.error || message.text || "Unknown error")}</span></div>`
            : renderResult(message)}
    </article>
  `;
}

function renderMessageActions(message) {
  const isPending = ["generating", "queued", "waiting", "queuing"].includes(message.status);
  const copy = message.role === "user"
    ? `<button type="button" data-copy-message="${h(message.id)}" title="Copy prompt" aria-label="Copy prompt">${icon("copy")}</button>`
    : "";
  const regenerate = message.role === "assistant" && !isPending
    ? `<button type="button" class="regenerate-action ${state.regenerating.has(message.id) ? "working" : ""}" data-regenerate-message="${h(message.id)}" title="Regenerate" aria-label="Regenerate" ${state.regenerating.has(message.id) ? "disabled" : ""}>${icon("sparkles")}</button>`
    : "";
  const cancel = message.role === "assistant" && isPending
    ? `<button type="button" data-cancel-message="${h(message.id)}" title="Cancel generation" aria-label="Cancel generation">${icon("close")}</button>`
    : "";
  return `
    <div class="message-actions">
      ${copy}
      ${cancel}
      ${regenerate}
      <button type="button" class="danger" data-delete-message="${h(message.id)}" title="Delete message" aria-label="Delete message">${icon("trash")}</button>
    </div>
  `;
}

function renderMessageRefs(refs) {
  if (!refs.length) return "";
  return `
    <div class="message-attachments">
      ${refs.map((ref) => `
        <figure class="message-attachment">
          ${renderAssetMedia(ref)}
          <figcaption>${h(referenceLabel(ref, refs))} <span>${h(roleLabel(ref.role, ref.mimeType))}</span></figcaption>
        </figure>
      `).join("")}
    </div>
  `;
}

function renderLoadingCard(message) {
  return `
    <div class="loading-block is-generating ${loaderClass()}" style="--loading-ratio:${h(aspectRatioCss(message.options, message.kind === "image" ? "1 / 1" : "16 / 9"))}">
      ${loadingVisual()}
      ${elapsedMarkup(message)}
    </div>
  `;
}

function cellNoise() {
  return `<canvas class="cell-noise" data-cell-noise aria-hidden="true"></canvas>`;
}

function loaderClass() {
  return `loader-${currentLoaderMode()}`;
}

function currentLoaderMode() {
  const prefs = readUiPrefs();
  return normalizeLoaderMode(state.accountDraft?.loaderMode || prefs.loaderMode || state.settings.loaderMode);
}

function loadingVisual() {
  return currentLoaderMode() === "blurry-dream"
    ? `<div class="blurry-dream-loader" aria-hidden="true"><i></i><i></i><i></i></div>`
    : cellNoise();
}

window.__connxnLoadingVisual = loadingVisual;
window.__connxnLoaderClass = loaderClass;
window.__connxnLoaderMode = currentLoaderMode;

function normalizeProgress(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Math.round(number <= 1 ? number * 100 : number);
}

function aspectRatioCss(options = {}, fallback = "16 / 9") {
  const value = String(options.aspectRatio || "").trim().toLowerCase();
  const match = value.match(/^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/);
  if (!match) return fallback;
  const width = Number(match[1]);
  const height = Number(match[2]);
  return width > 0 && height > 0 ? `${width}/${height}` : fallback;
}

function generationTileOptions(message = {}, promptMessage = null, kind = "image") {
  return { ...(state.options[kind] || {}), ...(promptMessage?.options || {}), ...(message.options || {}) };
}

function ratioNumberFromCss(value) {
  const match = String(value || "").match(/^(\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)$/);
  if (!match) return 16 / 9;
  const width = Number(match[1]);
  const height = Number(match[2]);
  return width > 0 && height > 0 ? width / height : 16 / 9;
}

function generationTileRatioClass(ratio) {
  const value = ratioNumberFromCss(ratio);
  if (value <= 0.78) return "is-portrait-ratio";
  if (value <= 1.18) return "is-square-ratio";
  if (value >= 1.7) return "is-wide-ratio";
  return "is-classic-ratio";
}

function generationTileSpan(ratio) {
  const value = ratioNumberFromCss(ratio);
  if (value <= 0.78) return 72;
  if (value <= 1.18) return 58;
  if (value >= 1.7) return 38;
  return 48;
}

function generationTileRatio(message = {}, kind = "image", options = null) {
  const fallback = kind === "image"
    ? aspectRatioCss(state.options.image, "16/9")
    : aspectRatioCss(state.options.video, "16/9");
  return aspectRatioCss(options || message.options, fallback);
}

function generationStartedAt(message = {}) {
  const stamp = Date.parse(message.startedAt || message.createdAt || message.updatedAt || "");
  return Number.isFinite(stamp) ? stamp : Date.now();
}

function formatElapsed(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours) return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function elapsedMarkup(message = {}) {
  const startedAt = generationStartedAt(message);
  return `<time class="generation-elapsed" data-generation-elapsed="${startedAt}" datetime="${h(new Date(startedAt).toISOString())}">${h(formatElapsed(Date.now() - startedAt))}</time>`;
}

function renderResult(message) {
  const result = message.result;
  if (!result?.url) return `<div class="error-message"><span>No media URL returned.</span></div>`;
  const urls = result.urls?.length ? result.urls : [result.url];
  const model = modelFor(message.kind, message.options?.model);
  const sendCanvas = ["image", "video", "audio"].includes(message.kind)
    ? `<button type="button" data-send-canvas="${h(message.id)}" title="Send to canvas" aria-label="Send to canvas">${icon("focus")}</button>`
    : "";
  return `
    <div class="result-block">
      <div class="result-media" data-preview-media="${h(message.id)}" role="button" tabindex="0" aria-label="Preview generated media">${renderMedia(urls[0], result.type || message.kind, message.id)}</div>
      <div class="result-footer">
        <div class="result-meta"><b>${h(model.label)}</b><span>${h(optionSummary(message.options || {}))}</span></div>
        <div class="result-actions">
          ${favoriteButton("message", message.id, result.url)}
          ${sendCanvas}
          <button type="button" data-preview-result="${h(message.id)}" title="Preview" aria-label="Preview">${icon("expand")}</button>
          ${saveMediaButton(result.url, result.type || message.kind, generatedDownloadStem(message))}
        </div>
      </div>
    </div>
  `;
}

function renderMedia(url, kind, mediaKey = "") {
  const displayUrl = mediaDisplayUrl(url);
  if (kind === "video") {
    return `<video src="${h(displayUrl)}" data-cache-src="${h(url)}" controls playsinline preload="metadata" data-media-key="${h(mediaKey)}"></video>`;
  }
  if (kind === "audio") return `<audio src="${h(displayUrl)}" data-cache-src="${h(url)}" controls preload="metadata"></audio>`;
  return `<img src="${h(displayUrl)}" data-cache-src="${h(url)}" alt="Generated ${kind === "video" ? "video preview" : kind === "audio" ? "audio preview" : "image"}" loading="lazy" decoding="async" />`;
}

function renderPreviewModal() {
  if (state.preview && typeof state.preview === "object") {
    const direct = state.preview;
    const url = direct.url;
    if (!url) return "";
    const kind = direct.kind || inferMediaKind(url);
    return `
      <div class="preview-overlay" data-preview-overlay>
        <div class="preview-shell" role="dialog" aria-modal="true" aria-label="Media preview">
          <header class="preview-header">
            <div><b>${h(direct.label || "Canvas preview")}</b><span>${h(kind === "video" ? "Video" : kind === "audio" ? "Audio" : "Image")}</span></div>
            <div class="preview-actions">
              ${saveMediaButton(url, kind, direct.label || "canvas-preview", 15)}
              <button type="button" data-close-preview title="Close preview" aria-label="Close preview">${icon("close")}</button>
            </div>
          </header>
          <div class="preview-stage">${renderMedia(url, kind, `preview-${direct.id || "canvas"}`)}</div>
        </div>
      </div>
    `;
  }
  const record = findMessageRecordClient(state.preview);
  const message = record?.message;
  const url = message?.result?.url || message?.result?.urls?.[0];
  if (!message || !url) return "";
  return `
    <div class="preview-overlay" data-preview-overlay>
      <div class="preview-shell" role="dialog" aria-modal="true" aria-label="Media preview">
        <header class="preview-header">
          <div><b>${h(modelFor(message.kind || record.kind, message.options?.model).label)}</b><span>${h(optionSummary(message.options || {}))}</span></div>
          <div class="preview-actions">
            ${saveMediaButton(url, message.kind || record.kind, generatedDownloadStem(message), 15)}
            <button type="button" data-close-preview title="Close preview" aria-label="Close preview">${icon("close")}</button>
          </div>
        </header>
        <div class="preview-stage">${renderMedia(url, message.kind || record.kind, `preview-${message.id}`)}</div>
      </div>
    </div>
  `;
}

function inferMediaKind(url = "") {
  const clean = String(url).split("?")[0].toLowerCase();
  if (/\.(mp4|webm|mov|m4v)$/.test(clean)) return "video";
  if (/\.(mp3|wav|ogg|m4a)$/.test(clean)) return "audio";
  return "image";
}

function mediaDownloadHref(url, kind = "", name = "connxn_media") {
  if (!url || String(url).startsWith("data:")) return url || "#";
  return `/api/media/download?url=${encodeURIComponent(url)}&kind=${encodeURIComponent(kind || inferMediaKind(url))}&name=${encodeURIComponent(name)}`;
}

function saveMediaButton(url, kind = "", name = "connxn_media", size = 15, label = "") {
  const key = downloadKey(url, kind, name);
  const active = state.activeDownloads.has(key);
  return `<button type="button" class="download-action ${active ? "is-downloading" : ""}" data-save-media-url="${h(url)}" data-save-media-kind="${h(kind || inferMediaKind(url))}" data-save-media-name="${h(name)}" title="${active ? "Saving..." : "Download"}" aria-label="${active ? "Saving..." : "Download"}" ${active ? "disabled" : ""}><i class="download-spinner" aria-hidden="true"></i>${icon("download", size)}${label ? `<span>${h(active ? "Saving" : label)}</span>` : ""}</button>`;
}

function downloadKey(url = "", kind = "", name = "") {
  return `${url}|${kind || inferMediaKind(url)}|${name || "connxn_media"}`;
}

function cleanFileStem(value, fallback = "generated") {
  return String(value || fallback)
    .trim()
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/[^a-z0-9_\-\p{L}\p{N}]+/giu, "-")
    .replace(/^-+|-+$/g, "") || fallback;
}

function firstPromptWords(prompt = "") {
  return String(prompt || "generated")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => cleanFileStem(word, ""))
    .filter(Boolean)
    .join("_") || "generated";
}

function promptBeforeMessage(messageId) {
  const record = findMessageRecordClient(messageId);
  if (!record) return "";
  const index = record.chat.messages.findIndex((message) => message.id === messageId);
  return record.chat.messages
    .slice(0, index)
    .filter((message) => message.role === "user")
    .at(-1)?.text || "";
}

function generatedDownloadStem(message, promptOverride = "") {
  const modelName = cleanFileStem(message?.options?.model || message?.kind || "model", "model");
  const prompt = promptOverride || promptBeforeMessage(message?.id) || message?.text || "";
  return `connxn_${modelName}_${firstPromptWords(prompt)}`;
}

function canvasDownloadStem(node) {
  const modelName = cleanFileStem(node?.modelId || node?.type || "model", "model");
  return `connxn_${modelName}_${firstPromptWords(node?.prompt || "")}`;
}

function findMessageRecordClient(messageId) {
  for (const kind of ["image", "video", "audio"]) {
    for (const chat of state.chats[kind] || []) {
      const message = chat.messages.find((item) => item.id === messageId);
      if (message) return { kind, chat, message };
    }
  }
  return null;
}

function openPreview(messageId) {
  root.querySelectorAll("video").forEach((video) => video.pause());
  state.preview = messageId;
  root.querySelector("[data-preview-overlay]")?.remove();
  root.insertAdjacentHTML("beforeend", renderPreviewModal());
  bindPreviewEvents();
  const previewVideo = root.querySelector("[data-preview-overlay] video");
  if (previewVideo) previewVideo.play().catch(() => {});
}

function openDirectPreview(url, kind = "", label = "Canvas preview", id = "") {
  root.querySelectorAll("video").forEach((video) => video.pause());
  state.preview = { url, kind: kind || inferMediaKind(url), label, id };
  root.querySelector("[data-preview-overlay]")?.remove();
  root.insertAdjacentHTML("beforeend", renderPreviewModal());
  bindPreviewEvents();
  const previewVideo = root.querySelector("[data-preview-overlay] video");
  if (previewVideo) previewVideo.play().catch(() => {});
}

function closePreview() {
  state.preview = null;
  root.querySelector("[data-preview-overlay]")?.remove();
}

function renderComposer(kind) {
  const attached = attachedAssets(kind);
  const accept = kind === "image" ? "image/*" : "image/*,video/*,audio/*";
  const imageContext = null;
  const prompt = state.prompts[kind] || "";
  return `
    <div class="composer-dock ${attached.length ? "refs-drawer" : ""}" data-ref-count="${attached.length}" data-prompt-length="${prompt.length}">
      ${renderMentionMenu(kind)}
      ${attached.length ? `
        <div class="reference-drawer" tabindex="0" aria-label="Attached references">
          <button type="button" class="reference-bubble" title="References">
            <span class="reference-stack">${attached.slice(0, 3).map((asset, index) => `<i style="--i:${index}">${renderAssetMedia(asset)}</i>`).join("")}</span>
            <b>${attached.length}</b>
          </button>
          <div class="attachment-tray" data-attachment-tray="${kind}">
            ${attached.map((asset, index) => renderAttachedAsset(asset, kind, index)).join("")}
          </div>
        </div>
      ` : ""}
      <form class="composer" data-composer="${kind}">
        <div class="prompt-wrap">
          <pre class="prompt-highlight" data-highlight="${kind}">${highlightMentions(prompt)}</pre>
          <textarea data-prompt="${kind}" placeholder="${kind === "image" ? "Describe an image" : kind === "video" ? "Describe a video" : "Describe audio or speech"}" rows="1" spellcheck="true">${h(prompt)}</textarea>
        </div>
        <div class="composer-controls">
          <div class="composer-left">
            <label class="attach-button" title="Attach media">
              <span>${icon("plus", 17)}</span>
              <input type="file" accept="${accept}" multiple data-asset-input="${kind}" />
            </label>
            <span class="composer-model-hint">${h(modelFor(kind).label)}</span>
          </div>
          <button class="send-button" type="submit" title="Generate" ${state.sending[kind] || state.uploading[kind] ? "disabled" : ""}>
            ${state.sending[kind] ? "..." : kind === "audio" ? "Generate audio" : icon("arrowUp", 18)}
          </button>
        </div>
      </form>
      <div class="composer-foot">${state.uploading[kind]
        ? "Uploading media..."
        : imageContext
          ? `Edits the latest image in this chat / ${h(optionSummary(state.options[kind]))}`
          : h(optionSummary(state.options[kind]))}</div>
    </div>
  `;
}

function refreshComposer(kind, { preserveFocus = true } = {}) {
  const current = root.querySelector(`[data-composer="${kind}"]`);
  const dock = current?.closest(".composer-dock");
  if (!dock) return render({ preserveComposer: true, preserveScroll: true, scrollToBottom: false });
  const active = document.activeElement;
  const promptFocused = preserveFocus && active?.matches?.(`[data-prompt="${kind}"]`);
  const selectionStart = promptFocused ? active.selectionStart : null;
  const selectionEnd = promptFocused ? active.selectionEnd : null;
  dock.outerHTML = renderComposer(kind);
  const nextDock = root.querySelector(`[data-composer="${kind}"]`)?.closest(".composer-dock");
  if (!nextDock) return;
  bindComposerControls(nextDock);
  refreshPromptHighlights();
  const textarea = nextDock.querySelector(`[data-prompt="${kind}"]`);
  if (textarea) {
    autoSizeTextarea(textarea);
    if (promptFocused) {
      textarea.focus();
      textarea.setSelectionRange(selectionStart ?? textarea.value.length, selectionEnd ?? textarea.value.length);
    }
  }
}

function bindComposerControls(scope) {
  scope.querySelectorAll("[data-prompt]").forEach((textarea) => {
    textarea.addEventListener("input", () => {
      const kind = textarea.dataset.prompt;
      state.prompts[kind] = textarea.value;
      autoSizeTextarea(textarea);
      updatePromptHighlight(kind);
      updateMentionStates(kind);
      updateMentionMenu(kind, textarea);
    });
    textarea.addEventListener("click", () => updateMentionMenu(textarea.dataset.prompt, textarea));
    textarea.addEventListener("scroll", () => syncPromptScroll(textarea));
    textarea.addEventListener("keydown", (event) => {
      if (handleMentionKeydown(event, textarea, textarea.dataset.prompt)) return;
      if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        submitPrompt(textarea.dataset.prompt);
      }
    });
    textarea.addEventListener("paste", (event) => {
      const files = Array.from(event.clipboardData?.files || []);
      if (files.length) {
        event.preventDefault();
        uploadAssets(files, textarea.dataset.prompt);
      }
    });
    autoSizeTextarea(textarea);
  });

  scope.querySelectorAll("[data-composer]").forEach((form) => {
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      submitPrompt(form.dataset.composer);
    });
  });

  scope.querySelectorAll("[data-asset-input]").forEach((input) => {
    input.addEventListener("change", () => uploadAssets(input.files, input.dataset.assetInput));
  });

  scope.querySelectorAll("[data-detach]").forEach((button) => {
    button.addEventListener("click", () => {
      const kind = button.dataset.detachKind;
      state.attached[kind] = state.attached[kind].filter((id) => id !== button.dataset.detach);
      refreshComposer(kind);
    });
  });

  scope.querySelectorAll("[data-attachment-id]").forEach((item) => bindAttachmentDrag(item));

  scope.querySelectorAll("[data-insert-ref]").forEach((button) => {
    button.addEventListener("click", () => insertRefMention(button.dataset.insertRef, button.dataset.refKind));
  });

  scope.querySelectorAll("[data-set-role]").forEach((button) => {
    button.addEventListener("click", () => {
      const assetId = button.dataset.setRole;
      const role = button.dataset.role;
      const asset = state.assets.find((item) => item.id === assetId);
      if (asset) asset.role = role;
      button.closest(".role-segments")?.querySelectorAll("button").forEach((item) => item.classList.toggle("active", item === button));
      api(`/api/assets/${encodeURIComponent(assetId)}`, {
        method: "PATCH",
        body: JSON.stringify({ role })
      }).catch((error) => showToast(error.message, "error"));
    });
  });

  scope.querySelectorAll("[data-mention-menu]").forEach((menu) => {
    menu.addEventListener("mousedown", (event) => {
      const option = event.target.closest("[data-mention-choice]");
      if (!option) return;
      event.preventDefault();
      applyMentionChoice(option.dataset.mentionChoice, menu.dataset.mentionMenu);
    });
  });
}

function bindAttachmentDrag(item) {
  item.addEventListener("dragstart", (event) => {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("application/x-connxn-attachment", "1");
    event.dataTransfer.setData("text/plain", JSON.stringify({ kind: item.dataset.attachmentKind, id: item.dataset.attachmentId }));
    item.classList.add("dragging");
  });
  item.addEventListener("dragend", () => {
    item.classList.remove("dragging");
    root.querySelectorAll(".attached-item.drop-before,.attached-item.drop-after").forEach((el) => el.classList.remove("drop-before", "drop-after"));
  });
  item.addEventListener("dragover", (event) => {
    event.preventDefault();
    const rect = item.getBoundingClientRect();
    item.classList.toggle("drop-before", event.clientX < rect.left + rect.width / 2);
    item.classList.toggle("drop-after", event.clientX >= rect.left + rect.width / 2);
  });
  item.addEventListener("dragleave", () => item.classList.remove("drop-before", "drop-after"));
  item.addEventListener("drop", (event) => {
    event.preventDefault();
    item.classList.remove("drop-before", "drop-after");
    let payload = null;
    try { payload = JSON.parse(event.dataTransfer.getData("text/plain") || "{}"); } catch {}
    const kind = item.dataset.attachmentKind;
    if (!payload?.id || payload.kind !== kind || payload.id === item.dataset.attachmentId) return;
    reorderAttached(kind, payload.id, item.dataset.attachmentId, event.clientX < item.getBoundingClientRect().left + item.getBoundingClientRect().width / 2);
    refreshComposer(kind);
  });
}

function renderMentionMenu(kind) {
  const menu = state.mentionMenu?.kind === kind ? state.mentionMenu : null;
  return `
    <div class="mention-menu" data-mention-menu="${kind}" ${menu ? "" : "hidden"}>
      ${menu ? renderMentionMenuItems(menu) : ""}
    </div>
  `;
}

function renderMentionMenuItems(menu) {
  const assets = menu.matches.map((id) => state.assets.find((asset) => asset.id === id)).filter(Boolean);
  if (!assets.length) {
    return `<div class="mention-empty">${attachedAssets(menu.kind).length ? "No matching references" : "Attach a reference first"}</div>`;
  }
  return assets.map((asset, index) => `
    <button type="button" class="mention-option ${index === menu.selected ? "selected" : ""}" data-mention-choice="${h(asset.id)}">
      <span class="mention-thumb">${renderAssetMedia(asset)}</span>
      <span class="mention-copy"><b>${h(referenceLabel(asset, attachedAssets(menu.kind)))}</b><small>${h(roleLabel(asset.role, asset.mimeType))}</small></span>
    </button>
  `).join("");
}

function compactSelect(kind, key, options, title) {
  const value = state.options[kind][key];
  return `
    <label class="compact-select" title="${title}">
      <select data-option="${key}" data-kind="${kind}" aria-label="${title}">
        ${options.map(([optionValue, optionLabel]) => `<option value="${h(optionValue)}" ${value === optionValue ? "selected" : ""}>${h(optionLabel)}</option>`).join("")}
      </select>
    </label>
  `;
}

function imageRatios() {
  return [["auto", "Auto"], ["1:1", "1:1"], ["16:9", "16:9"], ["9:16", "9:16"], ["4:3", "4:3"], ["3:4", "3:4"], ["3:2", "3:2"]];
}

function videoRatios() {
  return [["16:9", "16:9"], ["9:16", "9:16"], ["1:1", "1:1"]];
}

function renderAttachedAsset(asset, kind, index = 0) {
  const roles = roleOptionsForAsset(asset, kind);
  const supported = roles.length > 0;
  if (supported && !roles.some(([role]) => role === asset.role)) asset.role = roles[0][0];
  const label = referenceLabel(asset, attachedAssets(kind));
  return `
    <div class="attached-item ${mentionedReferences(kind).has(asset.id) ? "mentioned" : ""} ${supported ? "" : "unsupported"}" data-slug="${h(asset.slug)}" data-attachment-id="${h(asset.id)}" data-attachment-kind="${kind}" draggable="true">
      <span class="attachment-order">${index + 1}</span>
      <div class="attached-preview">${renderAssetMedia(asset)}</div>
      <div class="attached-info">
        <button type="button" class="mention-button" data-insert-ref="${h(asset.id)}" data-ref-kind="${kind}">${h(label)}</button>
        ${roles.length <= 1
          ? `<span class="role-static">${supported ? h(roleLabel(roles[0][0], asset.mimeType)) : "Not supported"}</span>`
          : `<div class="role-segments" aria-label="Reference type">
              ${roles.map(([value, label]) => `<button type="button" class="${asset.role === value ? "active" : ""}" data-set-role="${h(asset.id)}" data-role="${value}">${label}</button>`).join("")}
            </div>`}
      </div>
      <button type="button" class="remove-attachment" data-detach="${h(asset.id)}" data-detach-kind="${kind}" title="Remove attachment">x</button>
    </div>
  `;
}

function renderAssetMedia(asset) {
  const displayUrl = mediaDisplayUrl(asset.url);
  if (asset.mimeType?.startsWith("video/")) {
    return `<video src="${h(displayUrl)}" data-cache-src="${h(asset.url)}" controls playsinline preload="metadata"></video>`;
  }
  if (asset.mimeType?.startsWith("audio/")) {
    return `<span class="audio-asset"><b>${abstractIcon("audio", 24)}</b><i>${h((asset.label || "reference").slice(0, 18))}</i></span>`;
  }
  return `<img src="${h(displayUrl)}" data-cache-src="${h(asset.url)}" alt="${h(asset.label || "Reference")}" loading="lazy" decoding="async" />`;
}

function roleOptionsForAsset(asset, kind) {
  if (kind === "image") return [["reference", "Reference"]];
  const model = modelFor("video");
  const type = asset.mimeType?.startsWith("video/") ? "video" : asset.mimeType?.startsWith("audio/") ? "audio" : "image";
  let roles = [...(model.roles?.[type] || [])];
  if (model.modes?.length && state.options.video.inputMode === "frames") {
    roles = type === "image" ? roles.filter((role) => role === "start" || role === "end") : [];
  }
  if (model.modes?.length && state.options.video.inputMode === "references") {
    roles = roles.filter((role) => role === "reference");
  }
  return roles.map((role) => [role, shortRoleLabel(role)]);
}

function shortRoleLabel(role) {
  if (role === "start") return "Start";
  if (role === "end") return "End";
  if (role === "continuation") return "Source";
  return "Ref";
}

function attachedAssets(kind) {
  const byId = new Map(state.assets.map((asset) => [asset.id, asset]));
  return (state.attached[kind] || []).map((id) => byId.get(id)).filter(Boolean);
}

function renderAccount() {
  const draft = state.accountDraft || {
    nick: state.profile.nick,
    avatarData: state.profile.avatarData,
    kieApiKey: ""
  };
  const status = state.settings.keyStatus || "missing";
  return `
    <section class="account-page">
      <div class="account-wrap">
        <header class="page-heading">
          <h1>Account</h1>
          <p>Local profile and KIE connection</p>
        </header>
        <div class="account-settings-stack">
          <form class="account-form account-card" data-account-form>
            <div class="account-card-head">
              <i>${icon("user", 17)}</i><div><span>Profile</span><b>Identity and connection</b></div>
            </div>
            <div class="avatar-row">
              ${renderAvatar("large", draft.avatarData)}
              <label class="secondary-button file-button">
                ${icon("image", 14)}<span>Change avatar</span>
                <input type="file" accept="image/*" data-avatar-input />
              </label>
            </div>
            <label class="account-field">
              <span>Display name</span>
              <input value="${h(draft.nick)}" data-account-nick maxlength="40" autocomplete="off" />
            </label>
            <label class="account-field">
              <span>KIE API key</span>
              <input type="password" value="" placeholder="${state.settings.hasKieKey ? "Saved locally - paste to replace" : "Paste your KIE key"}" data-account-key autocomplete="off" />
            </label>
            <div class="key-status-row">
              <div class="key-status-copy">
                <span class="connection-dot ${h(status)}"></span>
                <div><b>${h(keyStatusTitle())}</b><small data-live-credits>${h(keyStatusDetail())}</small></div>
              </div>
              ${state.settings.hasKieKey ? `<button type="button" class="secondary-button" data-check-key ${state.checkingKey ? "disabled" : ""}>${icon("sparkles", 14)}<span>${state.checkingKey ? "Checking..." : "Check connection"}</span></button>` : ""}
            </div>
          </form>
          ${renderThemeControl()}
          ${renderStoragePanel()}
          <button class="primary-button account-save-button account-save-context" type="button" data-account-save-all ${state.savingAccount ? "disabled" : ""}>${icon("check", 15)}<span>${state.savingAccount ? "Saving..." : "Save"}</span></button>
        </div>
      </div>
    </section>
  `;
}

function renderStoragePanel() {
  const storage = state.storage;
  return `
    <section class="account-storage-section account-card">
      <div class="account-card-head">
        <i>${icon("database", 17)}</i><div><span>Storage</span><b>Workspace storage</b></div>
      </div>
      <div class="storage-grid">
        <div><small>Total</small><b>${storage ? h(formatBytes(storage.totalBytes)) : "Not analyzed"}</b></div>
        <div><small>Uploads</small><b>${storage ? h(formatBytes(storage.uploadBytes)) : "—"}</b></div>
        <div><small>Flows</small><b>${storage ? h(`${storage.canvasProjects} / ${storage.canvasNodes} nodes`) : "—"}</b></div>
        <div><small>Assets</small><b>${storage ? h(String(storage.assets)) : "—"}</b></div>
      </div>
      <div class="storage-paths">
        <label class="account-field">
          <span>Download folder</span>
          <div class="path-field"><input value="${h(state.settings.downloadDir || storage?.downloadDir || "")}" data-download-dir autocomplete="off" placeholder="/Users/you/Downloads/connxn" /><button type="button" data-select-folder-for="download" title="Choose folder" aria-label="Choose folder">${icon("folder", 15)}</button></div>
        </label>
        <label class="account-field">
          <span>User data folder</span>
          <div class="path-field"><input value="${h(state.settings.userDataDir || storage?.userDataDir || "")}" data-user-data-dir autocomplete="off" placeholder="/Users/you/Documents/connxn-data" /><button type="button" data-select-folder-for="data" title="Choose folder" aria-label="Choose folder">${icon("folder", 15)}</button></div>
        </label>
      </div>
      <div class="storage-actions">
        <button type="button" class="secondary-button" data-storage-analyze ${state.checkingStorage ? "disabled" : ""}>${icon("sliders", 14)}<span>${state.checkingStorage ? "Analyzing..." : "Analyze storage"}</span></button>
        <button type="button" class="secondary-button" data-export-workspace>${icon("download", 14)}<span>Export workspace</span></button>
        <button type="button" class="secondary-button danger" data-clear-cache ${state.clearingCache ? "disabled" : ""}>${icon("trash", 14)}<span>${state.clearingCache ? "Clearing..." : "Clear cache"}</span></button>
      </div>
      <p>Clear cache removes workflows and uploaded/generated canvas assets only. Account, avatar and API key stay intact.</p>
    </section>
  `;
}

function keyStatusTitle() {
  const status = state.settings.keyStatus;
  if (status === "verified") return "Connected to KIE";
  if (status === "invalid") return "Key was rejected";
  if (status === "offline") return "Saved, connection unavailable";
  if (state.settings.hasKieKey) return "Key saved locally";
  return "KIE key not added";
}

function keyStatusDetail() {
  if (state.settings.keyStatus === "verified" && state.settings.credits !== null) {
    return `${state.settings.credits} credits available`;
  }
  if (state.settings.hasKieKey) return "Stored in .env.local on this computer";
  return "Required for image and video generation";
}

function keyLabel() {
  if (state.settings.keyStatus === "verified") return "KIE connected";
  if (state.settings.hasKieKey) return "KIE key saved";
  return "KIE not connected";
}

function canvasProvider(item) {
  const id = String(item.modelId || item.id || item.type || "").toLowerCase();
  const family = String(item.family || "").toLowerCase();
  if (id.includes("seedance") || family.includes("bytedance")) return "BD";
  if (id.includes("kling") || family.includes("kling")) return "K";
  if (id.includes("wan") || family.includes("wan")) return "W";
  if (id.includes("flux") || family.includes("flux")) return "Fx";
  if (id.includes("nano") || id.includes("imagen") || family.includes("google")) return "G";
  if (id.includes("gpt") || family.includes("gpt")) return "GPT";
  if (id.includes("suno") || family.includes("suno")) return "S";
  if (id.includes("eleven") || family.includes("eleven")) return "11";
  if (id.includes("grok") || family.includes("grok")) return "X";
  if (id.includes("hailuo") || family.includes("hailuo")) return "H";
  return "AI";
}

function canvasProviderLogo(item, size = 18) {
  const mark = canvasProvider(item);
  const paths = {
    BD: '<path d="M3 5h7a4 4 0 0 1 0 8H3zM3 13h8a4 4 0 0 1 0 8H3z"/><path d="M14 5h3a4 4 0 0 1 0 8h-3zM14 13h4a3 3 0 0 1 0 6h-4z"/>',
    K: '<path d="M4 4v16M4 12 19 4M4 12l15 8"/>',
    W: '<path d="m2 6 3 12 4-8 3 8 4-12 3 12 3-12"/>',
    G: '<path d="M20 12a8 8 0 1 1-3-6M20 5v7h-7"/>',
    Fx: '<path d="M5 5h14M5 12h9M5 19h5"/><path d="m16 16 3 3m0-3-3 3"/>',
    GPT: '<path d="M12 3a4 4 0 0 1 4 4v1h1a4 4 0 0 1 1 7l-1 .5M12 3 9 5 7 4a4 4 0 0 0-4 7l1 .5M7 4v4l3 2m7-2-3 2v4m-7 0 3 2v3m7-3-3 2"/>',
    S: '<path d="M5 8c2-4 12-4 14 0M5 16c2 4 12 4 14 0M5 8v8M19 8v8"/>',
    11: '<path d="M7 5 4 7V5l3-2M12 3v18M16 3h4M16 21h4M18 3v18"/>',
    X: '<path d="M4 4 20 20M20 4 4 20"/>',
    H: '<path d="M4 4v16M20 4v16M4 12h16"/>'
  };
  return `<svg class="provider-logo" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-label="${h(mark)}">${paths[mark] || '<circle cx="12" cy="12" r="8"/><path d="M8 12h8M12 8v8"/>'}</svg>`;
}
function canvasNodeDefinition(node) {
  const all = [...imageModelRegistry, ...videoModelRegistry, ...audioModelRegistry];
  return all.find((item) => item.id === node.modelId) || { label: node.type, family: node.group || "Utility", refs: true };
}

function canvasNodeKind(node) {
  if (node?.type === "videoGenerator" || node?.registryId === "videoGenerator") return "video";
  if (node?.type === "imageGenerator" || node?.registryId === "imageGenerator") return "image";
  if (String(node.group).toLowerCase().includes("video")) return "video";
  if (String(node.group).toLowerCase().includes("audio")) return "audio";
  return "image";
}

function canvasNodeEstimate(node) {
  if (!node?.modelId) return null;
  const kind = canvasNodeKind(node);
  if (!["image", "video"].includes(kind)) return null;
  return estimateKieCredits(kind, { ...state.options[kind], ...(node.options || {}), ...(node.settings || {}), model: node.modelId }, { refsCount: (node.refs || []).length, modelId: node.modelId });
}

function canvasRunEstimate(project, nodeId, mode = "only") {
  const nodes = project?.nodes || [];
  const start = nodes.find((node) => node.id === nodeId);
  if (!start) return { known: false, credits: 0, label: "Pricing unknown", details: ["Node not found."] };
  const targets = [];
  const seen = new Set();
  const visit = (id) => {
    if (seen.has(id)) return;
    seen.add(id);
    const node = nodes.find((item) => item.id === id);
    if (node?.modelId) targets.push(node);
    if (mode !== "from") return;
    (project.edges || [])
      .filter((edge) => edge.sourceNodeId === id || edge.source === id)
      .forEach((edge) => visit(edge.targetNodeId || edge.target));
  };
  visit(nodeId);
  const parts = targets.map((node) => ({ node, estimate: canvasNodeEstimate(node) })).filter((item) => item.estimate);
  if (!parts.length) return { known: true, credits: 0, label: "0 cr", details: ["No priced KIE generation nodes in this run."] };
  const known = parts.every((item) => item.estimate.known);
  const total = parts.reduce((sum, item) => sum + Number(item.estimate.credits || 0), 0);
  const details = parts.flatMap(({ node, estimate }) => [
    `${node.type || canvasNodeKind(node)}: ${estimate.known ? formatCredits(estimate.credits) : "unknown"}`,
    ...estimate.details.slice(0, 2)
  ]);
  return { known, credits: total, label: known ? `~${formatCredits(total)}` : "Partial estimate", details };
}

function canvasProject() {
  return (state.canvasProjects || []).find((item) => item.id === state.activeCanvasProject) || state.canvasProjects?.[0];
}

async function saveCanvasProject(project) {
  const result = await api(`/api/canvas/projects/${encodeURIComponent(project.id)}`, { method: "PUT", body: JSON.stringify({ nodes: project.nodes || [], edges: project.edges || [] }) });
  applyServerState(result.state);
  return result.project;
}

function normalizeImportedCanvasProjects(payload, fallbackName = "Imported flow") {
  const rawProjects = Array.isArray(payload?.canvasProjects)
    ? payload.canvasProjects
    : [payload?.project || payload];
  return rawProjects
    .filter((item) => item && (Array.isArray(item.nodes) || Array.isArray(item.edges)))
    .map((item, index) => ({
      name: String(item.name || (index ? `${fallbackName} ${index + 1}` : fallbackName)).slice(0, 80),
      nodes: Array.isArray(item.nodes) ? item.nodes : [],
      edges: Array.isArray(item.edges) ? item.edges : [],
      viewport: item.viewport && typeof item.viewport === "object" ? item.viewport : { x: 32, y: 32, zoom: 1 }
    }));
}

async function importCanvasWorkflowPayload(payload, fallbackName = "Imported flow") {
  const projects = normalizeImportedCanvasProjects(payload, fallbackName);
  if (!projects.length) throw new Error("This JSON is not a connxn workflow.");
  let activeProjectId = "";
  for (const project of projects) {
    const result = await api("/api/canvas/projects", { method: "POST", body: JSON.stringify(project) });
    applyServerState(result.state);
    activeProjectId ||= result.project.id;
  }
  state.activeCanvasProject = activeProjectId || state.activeCanvasProject;
  state.view = "canvas";
  saveUiPrefs();
  render();
  showToast(projects.length === 1 ? "Workflow imported" : `${projects.length} workflows imported`, "success");
  return { count: projects.length, activeProjectId };
}

async function importCanvasWorkflowFile(file) {
  const payload = JSON.parse(await file.text());
  const fallbackName = String(file?.name || "Imported flow").replace(/\.json$/i, "") || "Imported flow";
  return importCanvasWorkflowPayload(payload, fallbackName);
}

function canvasNodeById(project, id) { return project?.nodes?.find((node) => node.id === id); }

function canvasExecutionOrder(project, startId = "") {
  const nodes = project?.nodes || [], edges = project?.edges || [];
  const incoming = new Map(nodes.map((node) => [node.id, []]));
  const outgoing = new Map(nodes.map((node) => [node.id, []]));
  for (const edge of edges) { if (incoming.has(edge.target) && outgoing.has(edge.source)) { incoming.get(edge.target).push(edge.source); outgoing.get(edge.source).push(edge.target); } }
  const selected = new Set(startId ? [startId] : nodes.map((node) => node.id));
  if (startId) { const queue = [startId]; while (queue.length) for (const next of outgoing.get(queue.shift()) || []) if (!selected.has(next)) { selected.add(next); queue.push(next); } }
  const order = [], visiting = new Set(), visited = new Set();
  const visit = (id) => { if (!selected.has(id) || visited.has(id)) return; if (visiting.has(id)) throw new Error("Canvas contains a cycle. Remove one connection before running."); visiting.add(id); for (const source of incoming.get(id) || []) visit(source); visiting.delete(id); visited.add(id); order.push(id); };
  for (const node of nodes) visit(node.id);
  return order;
}

async function waitForCanvasTask(chatId, messageId, taskId) {
  if (!taskId) return;
  for (;;) {
    const result = await api(`/api/tasks/${encodeURIComponent(taskId)}?chatId=${encodeURIComponent(chatId)}&messageId=${encodeURIComponent(messageId)}`);
    applyServerState(result.state);
    const message = findMessage(chatId, messageId);
    syncCanvasNode(messageId, message);
    if (!message || ["success", "error"].includes(message.status)) {
      if (message?.status === "error") throw new Error(message.error || "Canvas node generation failed.");
      return message;
    }
    await new Promise((resolve) => window.setTimeout(resolve, 2500));
  }
}

async function runCanvasNode(project, node) {
  const kind = canvasNodeKind(node);
  if (!node.modelId || !["image", "video", "audio"].includes(kind)) return;
  const incoming = (project.edges || []).filter((edge) => edge.target === node.id).map((edge) => canvasNodeById(project, edge.source)).filter(Boolean);
  const promptInputs = incoming.filter((source) => source.type === "Prompt").map((source) => source.prompt).filter(Boolean);
  const assetInputs = incoming.map((source) => source.type === "Asset" ? state.assets.find((asset) => asset.id === source.assetId) : null).filter(Boolean);
  const inherited = [...assetInputs.map((asset) => ({ id: asset.id, url: asset.url, mimeType: asset.mimeType, role: "reference" })), ...incoming.flatMap((source) => source.result?.url ? [{ url: source.result.url, mimeType: `${source.result.type || canvasNodeKind(source)}/generated`, role: "reference" }] : [])];
  node.status = "generating"; node.error = ""; node.result = null; render(); startAsciiNoise();
  try {
    const project = canvasProject();
    let chat = project?.chatIds?.[kind] ? currentChat(kind) : null;
    if (!chat) { const created = await api("/api/chats", { method: "POST", body: JSON.stringify({ type: kind, title: `${project?.name || "Canvas"} ${kind}` }) }); applyServerState(created.state); project.chatIds ||= {}; project.chatIds[kind] = created.chat.id; await saveCanvasProject(project); chat = created.chat; }
    const refs = [...(node.refs || []), ...inherited].filter((ref) => ref.id || ref.url);
    const prompt = [node.prompt, ...promptInputs].filter(Boolean).join("\n\n");
    const result = await api("/api/generate", { method: "POST", body: JSON.stringify({ type: kind, chatId: chat.id, prompt: prompt || `Generate ${node.type}`, options: { ...state.options[kind], ...(node.options || {}), model: node.modelId }, refs }) });
    node.taskId = result.message?.taskId; node.messageId = result.message?.id; node.status = result.message?.status || "queued";
    await saveCanvasProject(project); render(); startAsciiNoise();
    const message = await waitForCanvasTask(chat.id, node.messageId, node.taskId);
    if (message?.result?.url) node.result = message.result;
    node.status = message?.status || node.status;
    await saveCanvasProject(project); render(); startAsciiNoise();
  } catch (error) { node.status = "error"; node.error = error.message; await saveCanvasProject(project); render(); }
}

async function runCanvasFlow(startId = "") {
  const project = canvasProject();
  if (!project) return;
  try { for (const id of canvasExecutionOrder(project, startId)) { const node = canvasNodeById(project, id); if (node) await runCanvasNode(project, node); } }
  catch (error) { showToast(error.message, "error"); }
}

function canvasAllowedRoles(node, asset) {
  const definition = canvasNodeDefinition(node);
  const media = asset.mimeType?.split("/")[0] || "image";
  if (definition.roles) return definition.roles[media] || [];
  if (canvasNodeKind(node) === "image" && definition.refs && media === "image") return ["reference"];
  return [];
}

function renderCanvasNodeInputs(node) {
  if (node.type === "Prompt") return `<details class="node-inputs" open><summary>Prompt <span>${node.prompt ? "set" : "empty"}</span></summary><textarea data-node-prompt="${h(node.id)}" placeholder="Write the prompt passed to connected nodes">${h(node.prompt || "")}</textarea></details>`;
  if (node.type === "Asset") return `<details class="node-inputs" open><summary>Asset input</summary><select data-node-asset="${h(node.id)}"><option value="">Choose a Library asset</option>${state.assets.map((asset) => `<option value="${h(asset.id)}" ${node.assetId === asset.id ? "selected" : ""}>${h(asset.label || asset.slug)}</option>`).join("")}</select></details>`;
  if (!node.modelId) return "";
  const available = state.assets.filter((asset) => canvasAllowedRoles(node, asset).length);
  const selected = new Map((node.refs || []).map((ref) => [ref.id, ref]));
  return `<details class="node-inputs"><summary>Inputs <span>${selected.size}</span></summary><textarea data-node-prompt="${h(node.id)}" placeholder="Describe the result">${h(node.prompt || "")}</textarea><div class="node-assets">${available.map((asset) => { const ref = selected.get(asset.id); const roles = canvasAllowedRoles(node, asset); return `<label><input type="checkbox" data-node-ref="${h(node.id)}" data-asset-id="${h(asset.id)}" ${ref ? "checked" : ""}/><span>${h(asset.label || asset.slug)}</span><select data-node-ref-role="${h(node.id)}" data-asset-id="${h(asset.id)}" ${ref ? "" : "disabled"}>${roles.map((role) => `<option value="${h(role)}" ${ref?.role === role ? "selected" : ""}>${h(roleLabel(role, asset.mimeType))}</option>`).join("")}</select></label>`; }).join("") || `<small>No compatible assets in Library</small>`}</div></details>`;
}

function canvasNodeMedia(node) {
  if (node.type === "Prompt") return `<div class="node-input-preview"><span>${icon("sparkles", 15)}</span><small>${node.prompt ? "Prompt configured" : "Enter prompt below"}</small></div>`;
  if (node.type === "Asset") { const asset = state.assets.find((item) => item.id === node.assetId); return asset ? `<div class="node-result-media">${renderAssetMedia(asset)}</div>` : `<div class="node-input-preview"><span>${icon("download", 15)}</span><small>Select an asset below</small></div>`; }
  if (node.result?.url) return `<div class="node-result-media">${renderMedia(node.result.url, canvasNodeKind(node), `node-${node.id}`)}</div>`;
  if (node.status === "generating" || node.status === "queued") return `<div class="node-noise ${loaderClass()}" style="--loading-ratio:${h(canvasNodeKind(node) === "image" ? "1 / 1" : "16 / 9")}">${loadingVisual()}<span>Generating ${h(canvasNodeKind(node))}</span></div>`;
  if (node.status === "error") return `<div class="node-error">${h(node.error || "Generation failed")}</div>`;
  return `<div class="node-empty"><span>${icon("sparkles", 15)}</span><small>Ready for input</small></div>`;
}

function generatedLibraryItems() {
  const items = [];
  for (const kind of ["image", "video"]) {
    for (const chat of state.chats[kind] || []) {
      for (const message of chat.messages || []) {
        if (message.role === "assistant" && message.result?.url) items.push({ ...message, kind, chatTitle: chat.title, createdAt: message.createdAt });
      }
    }
  }
  return items.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

function libraryCards() {
  const generated = generatedLibraryItems();
  const uploadedAssets = (state.assets || []).filter((asset) => asset.role !== "generated" && !asset.sourceMessageId);
  const assets = uploadedAssets.map((asset) => ({
    id: asset.id,
    kind: asset.mimeType?.startsWith("video/") ? "video" : asset.mimeType?.startsWith("audio/") ? "audio" : "image",
    asset,
    createdAt: asset.createdAt,
    result: { url: asset.url, type: asset.mimeType?.startsWith("video/") ? "video" : asset.mimeType?.startsWith("audio/") ? "audio" : "image" }
  }));
  const cards = [
    ...generated.map((message) => ({ type: "message", id: message.id, kind: message.kind, item: message, url: message.result.url, createdAt: message.createdAt })),
    ...assets.map((item) => ({ type: "asset", id: item.asset.id, kind: item.kind, item, url: item.asset.url, createdAt: item.createdAt }))
  ].sort((a, b) => state.librarySort === "oldest"
    ? String(a.createdAt || "").localeCompare(String(b.createdAt || ""))
    : String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
  return { generated, uploadedAssets, cards };
}

function filterLibraryCards(cards) {
  const filter = state.libraryFilter || "all";
  return cards.filter((card) => filter === "favorites"
    ? isFavorite(card.type, card.id, card.url)
    : filter === "uploaded"
      ? card.type === "asset"
      : filter === "all"
        ? true
        : card.type === "message" && card.kind === filter);
}

function renderLibraryCard(card) {
  const favorite = isFavorite(card.type, card.id, card.url);
  if (card.type === "asset") {
    const asset = card.item.asset;
    return `<article class="library-card" data-library-source="uploaded" data-library-kind="${h(card.kind)}" data-library-favorite="${favorite ? "true" : "false"}">
      <button type="button" class="library-media" data-preview-url="${h(asset.url)}" data-preview-kind="${h(card.kind)}" title="Preview" aria-label="Preview">${renderMedia(asset.url, card.kind, `library-${asset.id}`)}</button>
      <div class="library-info">
        <div><b>${h(asset.label || asset.originalName || "Asset")}</b><span>${h(asset.role || "reference")}</span></div>
        <div class="library-actions">
          ${favoriteButton("asset", asset.id, asset.url, 15)}
          <button type="button" data-send-asset-canvas="${h(asset.id)}" title="Send to canvas" aria-label="Send to canvas">${icon("focus", 15)}</button>
          ${saveMediaButton(asset.url, card.kind, cleanFileStem(asset.label || asset.originalName || "asset", "asset"), 15)}
          <button type="button" class="danger" data-delete-asset="${h(asset.id)}" title="Delete" aria-label="Delete">${icon("trash", 15)}</button>
        </div>
      </div>
    </article>`;
  }
  const message = card.item;
  const model = modelFor(message.kind, message.options?.model);
  return `<article class="library-card" data-library-source="generated" data-library-kind="${message.kind}" data-library-favorite="${favorite ? "true" : "false"}">
    <button type="button" class="library-media" data-preview-media="${h(message.id)}" title="Preview" aria-label="Preview">${renderMedia(message.result.url, message.kind, `library-${message.id}`)}</button>
    <div class="library-info">
      <div><b>${h(model.label)}</b><span>${h(message.chatTitle)}</span></div>
      <div class="library-actions">
        ${favoriteButton("message", message.id, message.result.url, 15)}
        <button type="button" data-preview-result="${h(message.id)}" title="Preview" aria-label="Preview">${icon("expand", 15)}</button>
        ${message.kind === "audio" ? "" : `<button type="button" data-upscale-message="${h(message.id)}" title="Upscale" aria-label="Upscale">${icon("upscale", 15)}</button>`}
        <button type="button" data-send-canvas="${h(message.id)}" title="Send to canvas" aria-label="Send to canvas">${icon("focus", 15)}</button>
        ${saveMediaButton(message.result.url, message.kind, generatedDownloadStem(message), 15)}
        <button type="button" class="danger" data-delete-message="${h(message.id)}" title="Delete" aria-label="Delete">${icon("trash", 15)}</button>
      </div>
    </div>
  </article>`;
}

function renderLibrary() {
  const { generated, uploadedAssets, cards } = libraryCards();
  const filtered = filterLibraryCards(cards);
  const visible = filtered.slice(0, Math.max(LIBRARY_PAGE_SIZE, state.libraryLimit || LIBRARY_PAGE_SIZE));
  const hasMore = visible.length < filtered.length;
  return `
    <section class="library-page">
      <header class="library-head"><div><span>Workspace archive</span><h1>Library</h1><p>${generated.length} generations / ${uploadedAssets.length} uploaded / showing ${visible.length} of ${filtered.length}</p></div></header>
      <div class="library-controls">
        <div class="library-filters">${[["all", "All"], ["image", "Images"], ["video", "Videos"], ["uploaded", "Uploaded"], ["favorites", "Favorites"]].map(([type, label]) => `<button class="${type === state.libraryFilter ? "active" : ""}" data-library-filter="${type}">${label}</button>`).join("")}</div>
        <label class="library-sort"><span>Date</span><select data-library-sort><option value="newest" ${state.librarySort === "newest" ? "selected" : ""}>Newest first</option><option value="oldest" ${state.librarySort === "oldest" ? "selected" : ""}>Oldest first</option></select></label>
      </div>
      <div class="library-grid" data-library-grid>
        ${visible.map(renderLibraryCard).join("") || `<div class="library-empty">Your generations will appear here.</div>`}
      </div>
      ${hasMore ? `<button type="button" class="load-more-button" data-load-more-library>Load ${Math.min(LIBRARY_PAGE_SIZE, filtered.length - visible.length)} more</button>` : ""}
    </section>
  `;
}

function legacyOldRenderCanvas() {
  const projects = state.canvasProjects || [];
  const project = projects.find((item) => item.id === state.activeCanvasProject) || projects[0];
  if (project && !state.activeCanvasProject) state.activeCanvasProject = project.id;
  const nodes = project?.nodes || [];
  return `
    <section class="canvas-page">
      <div class="canvas-workspace">
        <header class="canvas-toolbar"><div><b>${h(project?.name || "Untitled flow")}</b><span>${nodes.length} nodes</span></div><div class="canvas-toolbar-actions"><button data-canvas-zoom-out title="Zoom out">-</button><output data-canvas-zoom>${Math.round(state.canvasZoom * 100)}%</output><button data-canvas-zoom-in title="Zoom in">+</button><button data-canvas-fit title="Fit canvas">Fit</button><button data-export-canvas title="Export flow">${icon("download", 14)}</button><button class="canvas-run" data-run-flow>Run flow</button></div></header>
        <div class="canvas-shell"><div class="canvas-grid" data-canvas-stage style="--canvas-zoom:${state.canvasZoom}"><svg class="canvas-edges" aria-hidden="true">${renderCanvasEdges(project)}</svg>${nodes.map(renderFlowNode).join("")}${!nodes.length ? `<div class="canvas-hint"><b>Double-click anywhere</b><span>Add a model, input or utility node</span></div>` : ""}${state.canvasMenu ? renderNodePicker() : ""}</div>${renderCanvasInspector(project)}</div>
      </div>
    </section>
  `;
}

function renderCanvasInspector(project) {
  const node = (project?.nodes || []).find((item) => item.id === state.selectedCanvasNode);
  if (!node) return `<aside class="canvas-inspector empty"><span>Select a node</span><small>Node settings will appear here</small></aside>`;
  const kind = canvasNodeKind(node);
  const registry = kind === "video" ? videoModelRegistry : kind === "audio" ? audioModelRegistry : imageModelRegistry;
  const options = node.options || {};
  return `<aside class="canvas-inspector"><header><div><span>Node settings</span><b>${h(node.type)}</b></div><button data-close-inspector>${icon("close", 13)}</button></header><label>Model<select data-inspector-option="model">${registry.map((model) => `<option value="${h(model.id)}" ${model.id === node.modelId ? "selected" : ""}>${h(model.label)}</option>`).join("")}</select></label><label>Prompt<textarea data-inspector-option="prompt" placeholder="Describe the output">${h(node.prompt || "")}</textarea></label>${kind === "image" ? `<label>Aspect ratio<select data-inspector-option="aspectRatio">${IMAGE_RATIOS.map(([value, label]) => `<option value="${h(value)}" ${options.aspectRatio === value ? "selected" : ""}>${h(label)}</option>`).join("")}</select></label><label>Resolution<select data-inspector-option="resolution"><option>1K</option><option ${options.resolution === "2K" ? "selected" : ""}>2K</option><option ${options.resolution === "4K" ? "selected" : ""}>4K</option></select></label>` : kind === "video" ? `<label>Duration<input type="number" min="1" max="30" data-inspector-option="duration" value="${h(options.duration || 5)}" /></label><label>Aspect ratio<select data-inspector-option="aspectRatio">${COMMON_RATIOS.map(([value, label]) => `<option value="${h(value)}" ${options.aspectRatio === value ? "selected" : ""}>${h(label)}</option>`).join("")}</select></label><label class="check-row"><input type="checkbox" data-inspector-option="sound" ${options.sound ? "checked" : ""}/>Sound</label>` : `<label>Voice<input data-inspector-option="voice" value="${h(options.voice || "Rachel")}" /></label>`}<button class="inspector-run" data-inspector-run>Run node</button></aside>`;
}

function renderCanvasEdges(project) {
  const nodes = new Map((project?.nodes || []).map((node) => [node.id, node]));
  return (project?.edges || []).map((edge) => { const a = nodes.get(edge.source); const b = nodes.get(edge.target); if (!a || !b) return ""; const x1 = Number(a.x) + (Number(a.width) || 230); const y1 = Number(a.y) + 70; const x2 = Number(b.x); const y2 = Number(b.y) + 70; return `<path d="M ${x1} ${y1} C ${x1 + 90} ${y1}, ${x2 - 90} ${y2}, ${x2} ${y2}" data-edge="${h(edge.id || `${edge.source}-${edge.target}`)}"/>`; }).join("");
}

function renderFlowNode(node) {
  const definition = canvasNodeDefinition(node);
  const kind = canvasNodeKind(node);
  const inputPort = `<i class="node-input" data-node-input="${h(node.id)}" title="Input port"></i>`;
  const outputPort = `<i class="node-output" data-node-output="${h(node.id)}" title="Output port"></i>`;
  return `<article class="flow-node ${h(node.group || "utility").toLowerCase()} ${node.status ? `is-${h(node.status)}` : ""}" data-flow-node="${h(node.id)}" style="left:${Number(node.x) || 80}px;top:${Number(node.y) || 80}px;width:${Number(node.width) || 230}px;height:${Number(node.height) || "auto"};"><div class="port-label port-label-in">IN</div>${inputPort}<header><span class="node-provider">${canvasProviderLogo(definition)}</span><span>${h(node.group || "Utility")}</span><button data-delete-node="${h(node.id)}">${icon("close", 12)}</button></header><div class="node-title"><b>${h(node.type)}</b><small>${h(definition.label || node.modelId || "")}</small></div>${canvasNodeMedia(node)}${renderCanvasNodeInputs(node)}<p class="node-refs">${(node.refs || []).length ? `${node.refs.length} reference${node.refs.length === 1 ? "" : "s"}` : "No references attached"}</p><footer><button data-run-node="${h(node.id)}">Run</button><button data-download-node="${h(node.id)}" ${node.result?.url ? "" : "disabled"}>${icon("download", 12)}</button></footer>${outputPort}<div class="port-label port-label-out">OUT</div><i class="node-resize" title="Resize node"></i></article>`;
}

function canvasNodeCatalog() {
  return [
    { group: "Inputs", items: [{ type: "Prompt", description: "Reusable text prompt" }, { type: "Asset", description: "Image or video input" }] },
    { group: "Image models", items: imageModelRegistry.map((model) => ({ type: model.label, modelId: model.id })) },
    { group: "Video models", items: videoModelRegistry.map((model) => ({ type: model.label, modelId: model.id })) },
    { group: "Utilities", items: ["Crop", "Trim", "Compare"].map((type) => ({ type, description: `${type} media` })) }
  ];
}

function renderNodePicker() {
  return `<div class="node-picker" style="left:${state.canvasMenu.x}px;top:${state.canvasMenu.y}px" data-node-picker><input type="search" placeholder="Search nodes and models" data-node-search autocomplete="off" /><div class="node-catalog">${canvasNodeCatalog().map((section) => `<section><h3>${h(section.group)}</h3>${section.items.map((item) => `<button data-create-node="${h(item.type)}" data-node-model="${h(item.modelId || "")}" data-node-group="${h(section.group)}" data-search-value="${h(searchHaystack(`${section.group} ${item.type} ${item.modelId || ""} ${item.description || ""}`))}"><i class="catalog-mark">${canvasProviderLogo(item, 16)}</i><span><b>${h(item.type)}</b><small>${h(item.modelId || item.description || "")}</small></span></button>`).join("")}</section>`).join("")}</div></div>`;
}

function bindEvents() {
  root.querySelectorAll("[data-view]").forEach((button) => {
    button.addEventListener("click", () => {
      state.view = button.dataset.view;
      state.dragActive = "";
      state.libraryLimit = LIBRARY_PAGE_SIZE;
      saveUiPrefs();
      render();
    });
  });

  root.querySelectorAll("[data-library-filter]").forEach((button) => {
    button.addEventListener("click", () => {
      state.libraryFilter = button.dataset.libraryFilter || "all";
      state.libraryLimit = LIBRARY_PAGE_SIZE;
      saveUiPrefs();
      render({ preserveScroll: true, scrollToBottom: false });
    });
  });
  root.querySelector("[data-library-sort]")?.addEventListener("change", (event) => {
    state.librarySort = event.target.value === "oldest" ? "oldest" : "newest";
    state.libraryLimit = LIBRARY_PAGE_SIZE;
    saveUiPrefs();
    render({ preserveScroll: true, scrollToBottom: false });
  });
  root.querySelector("[data-load-more-library]")?.addEventListener("click", () => {
    state.libraryLimit = (state.libraryLimit || LIBRARY_PAGE_SIZE) + LIBRARY_PAGE_SIZE;
    render({ preserveScroll: true, scrollToBottom: false });
  });
  root.querySelectorAll("[data-load-more-messages]").forEach((button) => {
    button.addEventListener("click", () => {
      const kind = button.dataset.loadMoreMessages;
      const step = kind === "audio" ? CHAT_PAGE_SIZE : FLOW_PAGE_SIZE;
      state.messageLimits[kind] = (state.messageLimits[kind] || step) + step;
      render({ preserveScroll: true, scrollToBottom: false });
    });
  });
  bindProgressiveLoading();

  root.querySelectorAll("[data-toggle-favorite]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const key = button.dataset.toggleFavorite;
      if (state.favorites.has(key)) state.favorites.delete(key);
      else state.favorites.add(key);
      saveFavorites();
      paintFavoriteKey(key);
    });
  });

  root.querySelectorAll("[data-delete-asset]").forEach((button) => {
    button.addEventListener("click", async () => {
      const result = await api(`/api/assets/${encodeURIComponent(button.dataset.deleteAsset)}`, { method: "DELETE" });
      applyServerState(result);
      render();
    });
  });

  root.querySelectorAll("[data-canvas-project]").forEach((button) => {
    button.addEventListener("click", () => {
      state.activeCanvasProject = button.dataset.canvasProject;
      render();
    });
    button.addEventListener("dblclick", (event) => {
      event.preventDefault();
      event.stopPropagation();
      state.editingCanvasProject = button.dataset.canvasProject;
      state.activeCanvasProject = button.dataset.canvasProject;
      render();
      requestAnimationFrame(() => {
        const input = root.querySelector(`[data-canvas-rename-input="${CSS.escape(button.dataset.canvasProject)}"]`);
        input?.focus();
        input?.select();
      });
    });
  });

  root.querySelectorAll("[data-pin-canvas]").forEach((button) => {
    button.addEventListener("click", async (event) => {
      event.stopPropagation();
      const project = (state.canvasProjects || []).find((item) => item.id === button.dataset.pinCanvas);
      if (!project) return;
      project.pinned = !project.pinned;
      try {
        const result = await api(`/api/canvas/projects/${encodeURIComponent(project.id)}`, { method: "PUT", body: JSON.stringify({ pinned: project.pinned }) });
        applyServerState(result.state);
        render();
      } catch (error) {
        showToast(error.message, "error");
      }
    });
  });

  root.querySelectorAll("[data-canvas-rename-input]").forEach((input) => {
    let cancelled = false;
    const commitRename = async () => {
      if (cancelled) return;
      const project = (state.canvasProjects || []).find((item) => item.id === input.dataset.canvasRenameInput);
      const nextName = input.value.trim() || "Untitled flow";
      state.editingCanvasProject = "";
      if (!project || nextName === project.name) { render(); return; }
      const result = await api(`/api/canvas/projects/${encodeURIComponent(project.id)}`, { method: "PUT", body: JSON.stringify({ name: nextName }) });
      applyServerState(result.state);
      state.activeCanvasProject = project.id;
      render();
    };
    input.addEventListener("keydown", (event) => {
      if (event.key === "Escape") { cancelled = true; state.editingCanvasProject = ""; render(); }
      if (event.key === "Enter") { event.preventDefault(); input.blur(); }
    });
    input.addEventListener("blur", commitRename);
  });

  root.querySelectorAll("[data-delete-canvas]").forEach((button) => {
    button.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      const result = await api(`/api/canvas/projects/${encodeURIComponent(button.dataset.deleteCanvas)}`, { method: "DELETE" });
      applyServerState(result.state); state.activeCanvasProject = state.canvasProjects[0]?.id || ""; render();
    });
  });

  root.querySelector("[data-new-canvas]")?.addEventListener("click", async () => {
    const result = await api("/api/canvas/projects", { method: "POST", body: JSON.stringify({ name: "Untitled flow" }) });
    applyServerState(result.state);
    state.activeCanvasProject = result.project.id;
    render();
  });

  root.querySelectorAll("[data-add-node]").forEach((button) => {
    button.addEventListener("click", async () => {
      const project = (state.canvasProjects || []).find((item) => item.id === state.activeCanvasProject) || state.canvasProjects?.[0];
      if (!project) return;
      project.nodes = [...(project.nodes || []), { id: `node_${Date.now()}`, type: button.dataset.addNode, group: button.dataset.addNode === "Compare" ? "Utility" : "Models", x: 120 + project.nodes.length * 24, y: 120 + project.nodes.length * 18 }];
      const result = await api(`/api/canvas/projects/${encodeURIComponent(project.id)}`, { method: "PUT", body: JSON.stringify({ nodes: project.nodes, edges: project.edges || [] }) });
      applyServerState(result.state);
      render();
    });
  });

  root.querySelectorAll("[data-export-canvas]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      const projectId = button.dataset.exportCanvas || state.activeCanvasProject;
      const project = (state.canvasProjects || []).find((item) => item.id === projectId) || state.canvasProjects?.[0];
      if (!project) return;
      const blob = new Blob([JSON.stringify(project, null, 2)], { type: "application/json" });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = `${project.name.replace(/[^a-z0-9_-]+/gi, "-") || "flow"}.json`;
      link.click();
      URL.revokeObjectURL(link.href);
    });
  });

  root.querySelectorAll("[data-import-canvas]").forEach((input) => {
    input.addEventListener("change", async (event) => {
      const file = event.target.files?.[0];
      if (!file) return;
      try {
        await importCanvasWorkflowFile(file);
      } catch (error) {
        showToast(error.message || "Could not import workflow", "error");
      } finally {
        input.value = "";
      }
    });
  });

    root.querySelector("[data-canvas-stage]")?.addEventListener("dblclick", (event) => {
    if (event.target.closest(".flow-node, .node-picker")) return;
    const stage = event.currentTarget.getBoundingClientRect();
    state.canvasMenu = { x: Math.round((event.clientX - stage.left + event.currentTarget.scrollLeft) / state.canvasZoom), y: Math.round((event.clientY - stage.top + event.currentTarget.scrollTop) / state.canvasZoom) };
    render();
    requestAnimationFrame(() => root.querySelector("[data-node-search]")?.focus());
  });

  const search = root.querySelector("[data-node-search]");
  search?.addEventListener("input", (event) => {
    const query = event.target.value.trim().toLowerCase();
    root.querySelectorAll("[data-create-node]").forEach((item) => { item.hidden = Boolean(query) && !smartSearchMatch(query, item.dataset.searchValue); });
    root.querySelectorAll(".node-catalog section").forEach((section) => { section.hidden = !section.querySelector("[data-create-node]:not([hidden])"); });
  });

  root.querySelectorAll("[data-flow-node]").forEach((nodeElement) => {
    nodeElement.addEventListener("click", (event) => { if (event.target.closest("button, textarea, select, input, .node-input, .node-output, .node-resize")) return; state.selectedCanvasNode = nodeElement.dataset.flowNode; render(); });
  });
  root.querySelector("[data-close-inspector]")?.addEventListener("click", () => { state.selectedCanvasNode = ""; render(); });
  root.querySelectorAll("[data-inspector-option]").forEach((field) => {
    const update = () => { const node = canvasProject()?.nodes?.find((item) => item.id === state.selectedCanvasNode); if (!node) return; node.options ||= {}; const key = field.dataset.inspectorOption; if (key === "model") node.modelId = field.value; else if (key === "prompt") node.prompt = field.value; else node.options[key] = field.type === "checkbox" ? field.checked : field.value; };
    field.addEventListener("input", update); field.addEventListener("change", async () => { update(); await saveCanvasProject(canvasProject()); });
  });
  root.querySelector("[data-inspector-run]")?.addEventListener("click", () => { const project = canvasProject(); const node = canvasNodeById(project, state.selectedCanvasNode); if (node) runCanvasNode(project, node); });

  root.querySelectorAll("[data-create-node]").forEach((button) => {
    button.addEventListener("click", async () => {
      const project = (state.canvasProjects || []).find((item) => item.id === state.activeCanvasProject) || state.canvasProjects?.[0];
      if (!project) return;
      const node = { id: `node_${Date.now()}`, type: button.dataset.createNode, modelId: button.dataset.nodeModel, group: button.dataset.nodeGroup, x: Math.round(state.canvasMenu?.x || 100), y: Math.round(state.canvasMenu?.y || 100), status: "idle", refs: [] };
      project.nodes = [...(project.nodes || []), node];
      state.canvasMenu = null;
      const result = await api(`/api/canvas/projects/${encodeURIComponent(project.id)}`, { method: "PUT", body: JSON.stringify({ nodes: project.nodes, edges: project.edges || [] }) });
      applyServerState(result.state);
      render();
    });
  });

  root.querySelectorAll("[data-node-output]").forEach((port) => {
    port.addEventListener("click", (event) => { event.stopPropagation(); state.canvasConnect = { source: port.dataset.nodeOutput }; port.closest("[data-flow-node]")?.classList.add("is-connecting"); });
  });
  root.querySelectorAll("[data-node-input]").forEach((port) => {
    port.addEventListener("click", async (event) => {
      event.stopPropagation(); const project = canvasProject(); const source = state.canvasConnect?.source; const target = port.dataset.nodeInput;
      if (!project || !source || source === target) return;
      if (!project.edges?.some((edge) => edge.source === source && edge.target === target)) project.edges = [...(project.edges || []), { id: `edge_${Date.now()}`, source, target }];
      state.canvasConnect = null; root.querySelectorAll(".is-connecting").forEach((node) => node.classList.remove("is-connecting")); await saveCanvasProject(project); render();
    });
  });

  root.querySelectorAll("[data-flow-node]").forEach((nodeElement) => {
    nodeElement.querySelector(".node-resize")?.addEventListener("pointerdown", (event) => {
      event.stopPropagation(); state.canvasResize = true; const node = canvasProject()?.nodes?.find((item) => item.id === nodeElement.dataset.flowNode); if (!node) return;
      const start = { x: event.clientX, y: event.clientY, width: nodeElement.offsetWidth, height: nodeElement.offsetHeight };
      const move = (moveEvent) => { node.width = Math.max(190, Math.round(start.width + moveEvent.clientX - start.x)); node.height = Math.max(160, Math.round(start.height + moveEvent.clientY - start.y)); nodeElement.style.width = `${node.width}px`; nodeElement.style.height = `${node.height}px`; };
      const up = async () => { state.canvasResize = false; window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); await saveCanvasProject(canvasProject()); };
      window.addEventListener("pointermove", move); window.addEventListener("pointerup", up);
    });
  });

  root.querySelectorAll("[data-node-prompt]").forEach((field) => {
    field.addEventListener("input", () => { const node = canvasProject()?.nodes?.find((item) => item.id === field.dataset.nodePrompt); if (node) node.prompt = field.value; });
    field.addEventListener("change", async () => { const project = canvasProject(); const node = project?.nodes?.find((item) => item.id === field.dataset.nodePrompt); if (!node) return; node.prompt = field.value; await saveCanvasProject(project); });
  });
  root.querySelectorAll("[data-node-ref]").forEach((field) => {
    field.addEventListener("change", async () => {
      const project = (state.canvasProjects || []).find((item) => item.id === state.activeCanvasProject);
      const node = project?.nodes?.find((item) => item.id === field.dataset.nodeRef);
      const asset = state.assets.find((item) => item.id === field.dataset.assetId);
      if (!node || !asset) return;
      const roleField = root.querySelector(`[data-node-ref-role="${CSS.escape(node.id)}"][data-asset-id="${CSS.escape(asset.id)}"]`);
      node.refs = (node.refs || []).filter((ref) => ref.id !== asset.id);
      if (field.checked) node.refs.push({ id: asset.id, slug: asset.slug, label: asset.label, url: asset.url, mimeType: asset.mimeType, role: roleField?.value || canvasAllowedRoles(node, asset)[0] });
      if (roleField) roleField.disabled = !field.checked;
      const result = await api(`/api/canvas/projects/${encodeURIComponent(project.id)}`, { method: "PUT", body: JSON.stringify({ nodes: project.nodes, edges: project.edges || [] }) }); applyServerState(result.state); render();
    });
  });
  root.querySelectorAll("[data-node-ref-role]").forEach((field) => {
    field.addEventListener("change", async () => {
      const project = (state.canvasProjects || []).find((item) => item.id === state.activeCanvasProject);
      const node = project?.nodes?.find((item) => item.id === field.dataset.nodeRefRole);
      const ref = node?.refs?.find((item) => item.id === field.dataset.assetId);
      if (!ref) return; ref.role = field.value;
      const result = await api(`/api/canvas/projects/${encodeURIComponent(project.id)}`, { method: "PUT", body: JSON.stringify({ nodes: project.nodes, edges: project.edges || [] }) }); applyServerState(result.state);
    });
  });

  root.querySelector("[data-run-flow]")?.addEventListener("click", () => runCanvasFlow());

  root.querySelectorAll("[data-run-node]").forEach((button) => {
    button.addEventListener("click", () => runCanvasFlow(button.dataset.runNode));
  });

  root.querySelectorAll("[data-download-node]").forEach((button) => {
    button.addEventListener("click", () => {
      const node = (state.canvasProjects || []).find((item) => item.id === state.activeCanvasProject)?.nodes?.find((item) => item.id === button.closest("[data-flow-node]")?.dataset.flowNode);
      if (!node?.result?.url) return;
      saveMediaToConfiguredFolder(node.result.url, node.result.type || canvasNodeKind(node), canvasDownloadStem(node), button);
    });
  });
  root.querySelectorAll("[data-delete-node]").forEach((button) => {
    button.addEventListener("click", async () => {
      const project = (state.canvasProjects || []).find((item) => item.id === state.activeCanvasProject) || state.canvasProjects?.[0];
      if (!project) return;
      project.nodes = (project.nodes || []).filter((node) => node.id !== button.dataset.deleteNode);
      project.edges = (project.edges || []).filter((edge) => edge.source !== button.dataset.deleteNode && edge.target !== button.dataset.deleteNode);
      const result = await api(`/api/canvas/projects/${encodeURIComponent(project.id)}`, { method: "PUT", body: JSON.stringify({ nodes: project.nodes, edges: project.edges }) });
      applyServerState(result.state);
      render();
    });
  });

  document.onpointerdown = (event) => {
    if (state.canvasMenu && !event.target.closest("[data-node-picker]")) {
      state.canvasMenu = null;
      if (state.view === "canvas") render();
    }
  };

  document.onkeydown = (event) => {
    if (event.key === "Escape" && state.canvasMenu) { state.canvasMenu = null; render(); }
  };

  root.querySelector("[data-canvas-stage]")?.addEventListener("wheel", (event) => {
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    state.canvasZoom = Math.max(.45, Math.min(1.8, state.canvasZoom + (event.deltaY < 0 ? .08 : -.08)));
    const stage = event.currentTarget;
    stage.style.setProperty("--canvas-zoom", state.canvasZoom);
    const label = root.querySelector("[data-canvas-zoom]"); if (label) label.textContent = `${Math.round(state.canvasZoom * 100)}%`;
  }, { passive: false });
  root.querySelector("[data-canvas-stage]")?.addEventListener("pointerdown", (event) => {
    const output = event.target.closest("[data-node-output]");
    if (event.button === 1 || (event.button === 0 && event.altKey)) {
      state.canvasPan = { x: event.clientX, y: event.clientY, scrollLeft: event.currentTarget.scrollLeft, scrollTop: event.currentTarget.scrollTop };
      event.currentTarget.classList.add("is-panning");
      return;
    }
    if (output) { event.stopPropagation(); state.canvasConnect = { source: output.dataset.nodeOutput }; output.closest("[data-flow-node]")?.classList.add("is-connecting"); return; }
      const sourcePort = event.target.closest("[data-node-output]");
      if (sourcePort) { event.stopPropagation(); state.canvasConnect = { source: sourcePort.dataset.nodeOutput }; sourcePort.closest("[data-flow-node]")?.classList.add("is-connecting"); return; }
      if (event.target.closest("[data-flow-node]")) state.selectedCanvasNode = event.target.closest("[data-flow-node]").dataset.flowNode;
      if (event.button !== 0 || event.target.closest("button, .node-picker, .node-input")) return;
    const nodeElement = event.target.closest("[data-flow-node]");
    const project = (state.canvasProjects || []).find((item) => item.id === state.activeCanvasProject);
    const node = project?.nodes?.find((item) => item.id === nodeElement?.dataset.flowNode);
    if (!node) return;
    const stage = event.currentTarget.getBoundingClientRect();
    state.canvasDrag = { node, project, stage, zoom: state.canvasZoom, offsetX: (event.clientX - stage.left) / state.canvasZoom - Number(node.x || 0), offsetY: (event.clientY - stage.top) / state.canvasZoom - Number(node.y || 0) };
  });
  root.querySelector("[data-canvas-stage]")?.addEventListener("pointermove", (event) => {
    const pan = state.canvasPan;
    if (pan) { event.currentTarget.scrollLeft = pan.scrollLeft - (event.clientX - pan.x); event.currentTarget.scrollTop = pan.scrollTop - (event.clientY - pan.y); return; }
    const drag = state.canvasDrag;
    if (!drag) return;
    drag.node.x = Math.max(20, Math.round((event.clientX - drag.stage.left) / drag.zoom - drag.offsetX));
    drag.node.y = Math.max(20, Math.round((event.clientY - drag.stage.top) / drag.zoom - drag.offsetY));
    const element = event.currentTarget.querySelector(`[data-flow-node="${CSS.escape(drag.node.id)}"]`);
    if (element) { element.style.left = `${drag.node.x}px`; element.style.top = `${drag.node.y}px`; }
  });
  root.querySelector("[data-canvas-stage]")?.addEventListener("pointerup", async (event) => {
    if (state.canvasPan) { state.canvasPan = null; event.currentTarget.classList.remove("is-panning"); return; }
    if (state.canvasConnect) {
      const input = event.target.closest("[data-node-input]");
      const project = canvasProject();
      const source = state.canvasConnect.source;
      const target = input?.dataset.nodeInput;
      state.canvasConnect = null;
      root.querySelectorAll(".is-connecting").forEach((node) => node.classList.remove("is-connecting"));
      if (project && target && source !== target && !project.edges?.some((edge) => edge.source === source && edge.target === target)) {
        project.edges = [...(project.edges || []), { id: `edge_${Date.now()}`, source, target }];
        await saveCanvasProject(project); render();
      }
      return;
    }
    const drag = state.canvasDrag;
    if (!drag) return;
    state.canvasDrag = null;
    const result = await api(`/api/canvas/projects/${encodeURIComponent(drag.project.id)}`, { method: "PUT", body: JSON.stringify({ nodes: drag.project.nodes, edges: drag.project.edges || [] }) });
    applyServerState(result.state); render();
  });

  root.querySelector("[data-canvas-stage]")?.addEventListener("pointercancel", () => { state.canvasDrag = null; state.canvasConnect = null; state.canvasPan = null; });

  root.querySelector("[data-canvas-zoom-in]")?.addEventListener("click", () => { state.canvasZoom = Math.min(1.8, state.canvasZoom + .1); const stage = root.querySelector("[data-canvas-stage]"); stage?.style.setProperty("--canvas-zoom", state.canvasZoom); root.querySelector("[data-canvas-zoom]")?.replaceChildren(document.createTextNode(`${Math.round(state.canvasZoom * 100)}%`)); });
  root.querySelector("[data-canvas-zoom-out]")?.addEventListener("click", () => { state.canvasZoom = Math.max(.45, state.canvasZoom - .1); const stage = root.querySelector("[data-canvas-stage]"); stage?.style.setProperty("--canvas-zoom", state.canvasZoom); root.querySelector("[data-canvas-zoom]")?.replaceChildren(document.createTextNode(`${Math.round(state.canvasZoom * 100)}%`)); });
  root.querySelector("[data-canvas-fit]")?.addEventListener("click", () => { state.canvasZoom = 1; render(); });

  root.querySelectorAll("[data-node-asset]").forEach((field) => {
    field.addEventListener("change", async () => { const node = canvasProject()?.nodes?.find((item) => item.id === field.dataset.nodeAsset); if (!node) return; node.assetId = field.value; node.refs = field.value ? [{ id: field.value, role: "reference" }] : []; await saveCanvasProject(canvasProject()); render(); });
  });

  root.querySelector("[data-canvas-stage]")?.addEventListener("pointercancel", () => { state.canvasDrag = null; state.canvasConnect = null; state.canvasPan = null; });

  root.querySelector("[data-canvas-stage]")?.addEventListener("click", (event) => {
    if (!event.target.closest(".node-picker")) { state.canvasMenu = null; }
  });
  root.querySelectorAll("[data-new-chat]").forEach((button) => {
    button.addEventListener("click", async () => {
      try {
        const type = button.dataset.newChat;
        const result = await api("/api/chats", { method: "POST", body: JSON.stringify({ type }) });
        applyServerState(result.state);
        state.attached[type] = [];
        state.prompts[type] = "";
        state.view = type;
        render();
      } catch (error) {
        showToast(error.message, "error");
      }
    });
  });

  root.querySelectorAll("[data-delete-chat]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      deleteChat(button.dataset.deleteChat, button.dataset.deleteChatKind);
    });
  });

  root.querySelectorAll("[data-pin-chat]").forEach((button) => {
    button.addEventListener("click", async (event) => {
      event.stopPropagation();
      const type = button.dataset.pinChatKind;
      const chat = (state.chats[type] || []).find((item) => item.id === button.dataset.pinChat);
      if (!chat) return;
      chat.pinned = !chat.pinned;
      try {
        const result = await api(`/api/chats/${encodeURIComponent(chat.id)}`, { method: "PATCH", body: JSON.stringify({ pinned: chat.pinned }) });
        applyServerState(result.state);
        render();
      } catch (error) {
        showToast(error.message, "error");
      }
    });
  });

  root.querySelectorAll("[data-chat-id]").forEach((button) => {
    button.addEventListener("click", async () => {
      const type = button.dataset.chatKind;
      const chatId = button.dataset.chatId;
      state.activeChat[type] = chatId;
      api("/api/active-chat", { method: "POST", body: JSON.stringify({ type, chatId }) }).catch(() => {});
      render();
    });
    button.addEventListener("dblclick", (event) => {
      event.preventDefault();
      event.stopPropagation();
      state.editingChat = { id: button.dataset.chatId, kind: button.dataset.chatKind };
      render();
      requestAnimationFrame(() => {
        const input = root.querySelector(`[data-chat-rename-input="${CSS.escape(button.dataset.chatId)}"]`);
        input?.focus();
        input?.select();
      });
    });
  });

  root.querySelectorAll("[data-chat-rename-input]").forEach((input) => {
    let cancelled = false;
    const commitRename = async () => {
      if (cancelled) return;
      const kind = input.dataset.chatRenameKind;
      const chat = (state.chats[kind] || []).find((item) => item.id === input.dataset.chatRenameInput);
      const nextTitle = input.value.trim() || "New chat";
      state.editingChat = null;
      if (!chat || nextTitle === chat.title) { render(); return; }
      try {
        const result = await api(`/api/chats/${encodeURIComponent(chat.id)}`, { method: "PATCH", body: JSON.stringify({ title: nextTitle }) });
        applyServerState(result.state);
      } catch (error) {
        showToast(error.message, "error");
      } finally {
        render();
      }
    };
    input.addEventListener("keydown", (event) => {
      if (event.key === "Escape") { cancelled = true; state.editingChat = null; render(); }
      if (event.key === "Enter") { event.preventDefault(); input.blur(); }
    });
    input.addEventListener("blur", commitRename);
  });

  root.querySelectorAll("[data-option]").forEach((field) => {
    const updateOption = () => {
      state.options[field.dataset.kind][field.dataset.option] = field.type === "checkbox" ? field.checked : field.value;
      if (field.type === "range") {
        const min = Number(field.min);
        const max = Number(field.max);
        const progress = ((Number(field.value) - min) / (max - min)) * 100;
        field.style.setProperty("--range-progress", `${progress}%`);
        const output = root.querySelector(`[data-range-output="${field.dataset.option}"]`);
        if (output) output.textContent = `${field.value}s`;
      }
      const foot = root.querySelector(".composer-foot");
      if (foot) foot.textContent = optionSummary(state.options[field.dataset.kind]);
      updateComposerPricing(field.dataset.kind);
      if (field.dataset.option === "inputMode") {
        render({ preserveComposer: true, preserveScroll: true, scrollToBottom: false });
      }
    };
    field.addEventListener("change", updateOption);
    if (field.type === "range") field.addEventListener("input", updateOption);
    if (field.tagName === "TEXTAREA") {
      field.addEventListener("input", () => {
        state.options[field.dataset.kind][field.dataset.option] = field.value;
      });
    }
  });

  root.querySelectorAll("[data-model-picker]").forEach((button) => {
    button.addEventListener("click", () => {
      const menu = root.querySelector(`[data-model-menu="${button.dataset.modelPicker}"]`);
      if (!menu) return;
      menu.hidden = !menu.hidden;
      if (!menu.hidden) menu.querySelector("[data-model-search]")?.focus();
    });
  });

  root.querySelectorAll("[data-model-search]").forEach((input) => {
    input.addEventListener("input", () => {
      const query = input.value.trim().toLowerCase();
      input.closest(".model-menu")?.querySelectorAll("[data-search-value]").forEach((button) => {
        button.hidden = Boolean(query) && !smartSearchMatch(query, button.dataset.searchValue);
      });
    });
  });

  root.querySelectorAll("[data-select-model]").forEach((button) => {
    button.addEventListener("click", () => {
      const kind = button.dataset.modelKind;
      state.options[kind].model = button.dataset.selectModel;
      normalizeOptionsForModel(kind);
      render({ preserveComposer: true, preserveScroll: true, scrollToBottom: false });
    });
  });

  root.querySelectorAll("[data-toggle-panel]").forEach((button) => {
    button.addEventListener("click", () => {
      state.panelOpen = !state.panelOpen;
      root.querySelector("[data-settings-panel]")?.classList.toggle("open", state.panelOpen);
    });
  });

  root.querySelectorAll("[data-toggle-sidebar]").forEach((button) => {
    button.addEventListener("click", () => {
      state.sidebarOpen = !state.sidebarOpen;
      localStorage.setItem(SIDEBAR_STORAGE_KEY, String(state.sidebarOpen));
      render({ preserveComposer: true, preserveScroll: true, scrollToBottom: false });
    });
  });

  const themeToggle = root.querySelector("[data-theme-toggle]");
  const themeMenu = root.querySelector("[data-theme-menu]");
  themeToggle?.addEventListener("click", () => {
    const nextHidden = !themeMenu.hidden;
    themeMenu.hidden = nextHidden;
    themeToggle.setAttribute("aria-expanded", String(!nextHidden));
  });
  root.querySelectorAll("[data-theme-mode]").forEach((button) => {
    button.addEventListener("click", () => {
      applyTheme(button.dataset.themeMode);
      render({ preserveComposer: true, preserveScroll: true, scrollToBottom: false });
    });
  });
  root.querySelectorAll("[data-loader-mode]").forEach((button) => {
    button.addEventListener("click", () => {
      const loaderMode = normalizeLoaderMode(button.dataset.loaderMode);
      state.accountDraft = {
        nick: root.querySelector("[data-account-nick]")?.value || state.profile.nick,
        kieApiKey: root.querySelector("[data-account-key]")?.value || "",
        avatarData: state.accountDraft?.avatarData ?? state.profile.avatarData,
        loaderMode
      };
      state.settings = { ...state.settings, loaderMode };
      saveUiPrefs();
      render();
    });
  });

  root.querySelectorAll("[data-prompt]").forEach((textarea) => {
    textarea.addEventListener("input", () => {
      const kind = textarea.dataset.prompt;
      state.prompts[kind] = textarea.value;
      autoSizeTextarea(textarea);
      updatePromptHighlight(kind);
      updateMentionStates(kind);
      updateMentionMenu(kind, textarea);
    });
    textarea.addEventListener("click", () => updateMentionMenu(textarea.dataset.prompt, textarea));
    textarea.addEventListener("scroll", () => syncPromptScroll(textarea));
    textarea.addEventListener("keydown", (event) => {
      if (handleMentionKeydown(event, textarea, textarea.dataset.prompt)) return;
      if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        submitPrompt(textarea.dataset.prompt);
      }
    });
    textarea.addEventListener("paste", (event) => {
      const files = Array.from(event.clipboardData?.files || []);
      if (files.length) {
        event.preventDefault();
        uploadAssets(files, textarea.dataset.prompt);
      }
    });
    autoSizeTextarea(textarea);
  });

  root.querySelectorAll("[data-composer]").forEach((form) => {
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      submitPrompt(form.dataset.composer);
    });
  });

  root.querySelectorAll("[data-asset-input]").forEach((input) => {
    input.addEventListener("change", () => uploadAssets(input.files, input.dataset.assetInput));
  });

  root.querySelectorAll("[data-detach]").forEach((button) => {
    button.addEventListener("click", () => {
      const kind = button.dataset.detachKind;
      state.attached[kind] = state.attached[kind].filter((id) => id !== button.dataset.detach);
      refreshComposer(kind);
    });
  });

  root.querySelectorAll("[data-attachment-id]").forEach((item) => {
    bindAttachmentDrag(item);
  });

  root.querySelectorAll("[data-insert-ref]").forEach((button) => {
    button.addEventListener("click", () => insertRefMention(button.dataset.insertRef, button.dataset.refKind));
  });

  root.querySelectorAll("[data-set-role]").forEach((button) => {
    button.addEventListener("click", () => {
      const assetId = button.dataset.setRole;
      const role = button.dataset.role;
      const asset = state.assets.find((item) => item.id === assetId);
      if (asset) asset.role = role;
      button.closest(".role-segments")?.querySelectorAll("button").forEach((item) => item.classList.toggle("active", item === button));
      api(`/api/assets/${encodeURIComponent(assetId)}`, {
        method: "PATCH",
        body: JSON.stringify({ role })
      }).catch((error) => showToast(error.message, "error"));
    });
  });

  root.querySelectorAll("[data-mention-menu]").forEach((menu) => {
    menu.addEventListener("mousedown", (event) => {
      const option = event.target.closest("[data-mention-choice]");
      if (!option) return;
      event.preventDefault();
      applyMentionChoice(option.dataset.mentionChoice, menu.dataset.mentionMenu);
    });
  });

  const dropZone = root.querySelector("[data-drop-zone]");
  if (dropZone) bindDropZone(dropZone);

  const accountForm = root.querySelector("[data-account-form]");
  if (accountForm) accountForm.addEventListener("submit", saveAccount);
  const accountSaveAll = root.querySelector("[data-account-save-all]");
  if (accountSaveAll) accountSaveAll.addEventListener("click", saveAccount);

  const avatarInput = root.querySelector("[data-avatar-input]");
  if (avatarInput) avatarInput.addEventListener("change", handleAvatarChange);

  const checkKey = root.querySelector("[data-check-key]");
  if (checkKey) checkKey.addEventListener("click", checkConnection);

  const storageAnalyze = root.querySelector("[data-storage-analyze]");
  if (storageAnalyze) storageAnalyze.addEventListener("click", analyzeStorage);
  root.querySelectorAll("[data-select-folder-for]").forEach((button) => {
    button.addEventListener("click", () => selectConfiguredFolder(button.dataset.selectFolderFor));
  });

  const exportWorkspace = root.querySelector("[data-export-workspace]");
  if (exportWorkspace) exportWorkspace.addEventListener("click", exportWorkspaceArchive);

  const clearCache = root.querySelector("[data-clear-cache]");
  if (clearCache) clearCache.addEventListener("click", clearWorkspaceCache);

  bindMessageEvents(root);
  bindPreviewEvents();
  bindUpscaleEvents();
}

function normalizeOptionsForModel(kind) {
  const model = modelFor(kind);
  const options = state.options[kind];
  const normalize = (key, values, fallback = values?.[0]?.[0]) => {
    if (!values?.length) return;
    if (!values.some(([value]) => String(value) === String(options[key]))) options[key] = fallback;
  };
  if (kind === "image") {
    normalize("aspectRatio", model.ratios || IMAGE_RATIOS, model.seedream5 ? "1:1" : "1:1");
    normalize("resolution", model.noResolution ? [] : (model.resolutions || (model.seedream5 ? [] : IMAGE_RESOLUTIONS)), model.seedream5 ? "" : "2K");
    normalize("quality", model.noQuality ? [] : (model.qualities || IMAGE_QUALITIES), model.defaultQuality || "high");
    normalize("outputFormat", model.noFormat ? [] : (model.outputFormats || IMAGE_FORMATS), "png");
    if (model.nsfwChecker && typeof options.nsfwChecker !== "boolean") options.nsfwChecker = false;
    return;
  }
  if (kind === "audio") return;
  normalize("aspectRatio", model.ratios);
  normalize("resolution", model.resolutions);
  if (model.durationRange) {
    const range = model.durationRange;
    const current = Number(options.duration);
    const next = Number.isFinite(current) ? Math.min(range.max, Math.max(range.min, current)) : range.default || range.min;
    options.duration = String(next);
  } else {
    normalize("duration", model.durations);
  }
  normalize("quality", model.qualities);
  if (model.modes?.length && !model.modes.includes(options.inputMode)) options.inputMode = "auto";
  if (model.nsfwChecker && typeof options.nsfwChecker !== "boolean") options.nsfwChecker = false;
}

function bindMessageEvents(scope) {
  scope.querySelectorAll("[data-copy-message]").forEach((button) => {
    button.addEventListener("click", () => copyMessage(button.dataset.copyMessage));
  });
  scope.querySelectorAll("[data-delete-message]").forEach((button) => {
    button.addEventListener("click", () => deleteMessage(button.dataset.deleteMessage));
  });
  scope.querySelectorAll("[data-cancel-message]").forEach((button) => {
    button.addEventListener("click", () => cancelMessage(button.dataset.cancelMessage));
  });
  scope.querySelectorAll("[data-regenerate-message]").forEach((button) => {
    button.addEventListener("click", () => regenerateMessage(button.dataset.regenerateMessage));
  });
  scope.querySelectorAll("[data-upscale-message]").forEach((button) => {
    button.addEventListener("click", () => openUpscale(button.dataset.upscaleMessage));
  });
  scope.querySelectorAll("[data-use-prompt-message]").forEach((button) => {
    button.addEventListener("click", () => usePromptFromMessage(button.dataset.usePromptMessage));
  });
  scope.querySelectorAll("[data-send-canvas]").forEach((button) => {
    button.addEventListener("click", () => sendMessageToCanvas(button.dataset.sendCanvas));
  });
  scope.querySelectorAll("[data-send-asset-canvas]").forEach((button) => {
    button.addEventListener("click", () => sendAssetToCanvas(button.dataset.sendAssetCanvas));
  });
  scope.querySelectorAll("[data-preview-result]").forEach((button) => {
    button.addEventListener("click", () => openPreview(button.dataset.previewResult));
  });
  scope.querySelectorAll("[data-save-media-url]").forEach((button) => {
    button.addEventListener("click", () => saveMediaToConfiguredFolder(button.dataset.saveMediaUrl, button.dataset.saveMediaKind, button.dataset.saveMediaName, button));
  });
  scope.querySelectorAll("[data-inline-video]").forEach((video) => {
    const markReady = () => video.parentElement?.classList.add("is-ready");
    if (video.readyState >= 2) markReady();
    video.addEventListener("loadeddata", markReady, { once: true });
    video.addEventListener("canplay", markReady, { once: true });
  });
  scope.querySelectorAll("[data-preview-media]").forEach((media) => {
    media.addEventListener("click", (event) => {
      const inlineVideo = event.target.closest("[data-inline-video]");
      if (inlineVideo) {
        event.preventDefault();
        event.stopPropagation();
        root.querySelectorAll("[data-inline-video]").forEach((video) => {
          if (video !== inlineVideo) video.pause();
        });
        if (inlineVideo.paused) inlineVideo.play().catch(() => {});
        else inlineVideo.pause();
        return;
      }
      openPreview(media.dataset.previewMedia);
    });
    media.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      openPreview(media.dataset.previewMedia);
    });
  });
}

function upscaleSourceRecord(messageId) {
  const record = findMessageRecordClient(messageId);
  const message = record?.message;
  const url = message?.result?.url || message?.result?.urls?.[0] || "";
  if (!record || !message || !url) return null;
  return { ...record, url, mediaKind: message.kind === "video" ? "video" : "image" };
}

function renderUpscaleModal() {
  const source = upscaleSourceRecord(state.upscale?.messageId);
  if (!source) return "";
  const models = upscaleModelsFor(source.mediaKind);
  const selected = upscaleModelById(state.upscale.model) || models[0] || null;
  const sourceModel = modelFor(source.mediaKind, source.message.options?.model);
  const running = Boolean(state.upscale.running);
  const modelList = models.length
    ? `<div class="upscale-models">${models.map((model) => `
              <button type="button" class="upscale-model ${model.id === selected?.id ? "active" : ""}" data-upscale-model="${h(model.id)}">
                <b>${h(model.label)}</b>
                <span>${h(model.family || "")}</span>
                <small>${h(model.note || "")}</small>
              </button>`).join("")}</div>`
    : `<p class="upscale-empty">KIE has no upscale model for ${h(source.mediaKind)} right now.</p>`;
  const factorField = selected?.factors?.length
    ? `<label class="upscale-field"><span>Scale</span><select data-upscale-option="upscaleFactor">${selected.factors.map(([value, label]) => `<option value="${h(value)}" ${String(state.upscale.upscaleFactor) === String(value) ? "selected" : ""}>${h(label)}</option>`).join("")}</select></label>`
    : "";
  const resolutionField = selected?.resolutions?.length
    ? `<label class="upscale-field"><span>Resolution</span><select data-upscale-option="upscaleResolution">${selected.resolutions.map(([value, label]) => `<option value="${h(value)}" ${String(state.upscale.upscaleResolution) === String(value) ? "selected" : ""}>${h(label)}</option>`).join("")}</select></label>`
    : "";
  return `
    <div class="preview-overlay upscale-overlay" data-upscale-overlay>
      <div class="preview-shell upscale-shell" role="dialog" aria-modal="true" aria-label="Upscale">
        <header class="preview-header">
          <div><b>Upscale</b><span>${h(sourceModel?.label || source.mediaKind)} · ${h(source.mediaKind === "video" ? "Video" : "Image")}</span></div>
          <div class="preview-actions">
            <button type="button" data-close-upscale title="Close" aria-label="Close">${icon("close")}</button>
          </div>
        </header>
        <div class="upscale-body">
          <div class="upscale-source">${renderMedia(source.url, source.mediaKind, `upscale-${source.message.id}`)}</div>
          <div class="upscale-config">
            <span class="upscale-legend">KIE model</span>
            ${modelList}
            ${factorField}
            ${resolutionField}
          </div>
        </div>
        <footer class="upscale-footer">
          <small>${h(selected?.note || "Pick a model to enlarge this result.")}</small>
          <button type="button" class="upscale-run" data-run-upscale ${!selected || running ? "disabled" : ""}>${running ? "Starting..." : "Run upscale"}</button>
        </footer>
      </div>
    </div>
  `;
}

function openUpscale(messageId) {
  const source = upscaleSourceRecord(messageId);
  if (!source) {
    showToast("Nothing to upscale yet", "error");
    return;
  }
  const models = upscaleModelsFor(source.mediaKind);
  if (!models.length) {
    showToast(`No KIE upscale model for ${source.mediaKind}`, "error");
    return;
  }
  root.querySelectorAll("video").forEach((video) => video.pause());
  const model = models[0];
  state.upscale = {
    messageId,
    model: model.id,
    upscaleFactor: model.defaultFactor || "",
    upscaleResolution: model.defaultResolution || "",
    running: false
  };
  paintUpscaleModal();
}

function selectUpscaleModel(modelId) {
  const model = upscaleModelById(modelId);
  if (!state.upscale || !model || state.upscale.running) return;
  state.upscale.model = model.id;
  state.upscale.upscaleFactor = model.defaultFactor || "";
  state.upscale.upscaleResolution = model.defaultResolution || "";
  paintUpscaleModal();
}

function paintUpscaleModal() {
  root.querySelector("[data-upscale-overlay]")?.remove();
  if (!state.upscale) return;
  root.insertAdjacentHTML("beforeend", renderUpscaleModal());
  bindUpscaleEvents();
}

function closeUpscale() {
  state.upscale = null;
  root.querySelector("[data-upscale-overlay]")?.remove();
}

async function runUpscale() {
  const current = state.upscale;
  if (!current || current.running) return;
  const source = upscaleSourceRecord(current.messageId);
  if (!source) return;
  current.running = true;
  paintUpscaleModal();
  try {
    const result = await api(`/api/chats/${encodeURIComponent(source.chat.id)}/messages/${encodeURIComponent(current.messageId)}/upscale`, {
      method: "POST",
      body: JSON.stringify({
        model: current.model,
        upscaleFactor: current.upscaleFactor,
        upscaleResolution: current.upscaleResolution
      })
    });
    applyServerState(result.state);
    closeUpscale();
    if (result.message?.status === "error") showToast(result.message.error || "Upscale failed to start", "error");
    else showToast("Upscale started", "success");
    if (["image", "video"].includes(source.kind)) state.view = source.kind;
    if (!appendGeneratedMessage({ kind: source.kind, chatId: source.chat.id, message: result.message, sourceMessageId: current.messageId })) {
      render({ preserveComposer: true, preserveScroll: true, scrollToBottom: false });
    }
    refreshComposer(source.kind);
    schedulePendingPolls();
  } catch (error) {
    if (state.upscale) state.upscale.running = false;
    showToast(error.message, "error");
    paintUpscaleModal();
  }
}

function bindUpscaleEvents() {
  const overlay = root.querySelector("[data-upscale-overlay]");
  if (!overlay || overlay.dataset.bound) return;
  overlay.dataset.bound = "true";
  overlay.querySelector("[data-close-upscale]")?.addEventListener("click", closeUpscale);
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) closeUpscale();
  });
  overlay.querySelectorAll("[data-upscale-model]").forEach((button) => {
    button.addEventListener("click", () => selectUpscaleModel(button.dataset.upscaleModel));
  });
  overlay.querySelectorAll("[data-upscale-option]").forEach((select) => {
    select.addEventListener("change", (event) => {
      if (!state.upscale) return;
      state.upscale[select.dataset.upscaleOption] = event.target.value;
    });
  });
  overlay.querySelector("[data-run-upscale]")?.addEventListener("click", runUpscale);
}

function bindPreviewEvents() {
  const overlay = root.querySelector("[data-preview-overlay]");
  if (!overlay || overlay.dataset.bound) return;
  overlay.dataset.bound = "true";
  overlay.querySelector("[data-close-preview]")?.addEventListener("click", closePreview);
  overlay.querySelectorAll("[data-save-media-url]").forEach((button) => {
    button.addEventListener("click", () => saveMediaToConfiguredFolder(button.dataset.saveMediaUrl, button.dataset.saveMediaKind, button.dataset.saveMediaName, button));
  });
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) closePreview();
  });
}

async function copyMessage(messageId) {
  const record = findMessageRecordClient(messageId);
  if (!record) return;
  const text = promptForMessage(record) || record.message.text || "";
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    showToast("Prompt copied", "success");
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    document.body.append(textarea);
    textarea.select();
    document.execCommand("copy");
    textarea.remove();
    showToast("Prompt copied", "success");
  }
}

function promptForMessage(record) {
  if (!record) return "";
  const promptMessage = promptMessageForRecord(record);
  return promptMessage?.text || record.message.text || "";
}

function promptMessageForRecord(record) {
  if (!record) return null;
  if (record.message.role === "user") return record.message;
  if (record.message.promptId) {
    const linked = record.chat.messages.find((message) => message.id === record.message.promptId && message.role === "user");
    if (linked) return linked;
  }
  const index = record.chat.messages.findIndex((message) => message.id === record.message.id);
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    if (record.chat.messages[cursor].role === "user") return record.chat.messages[cursor];
  }
  return null;
}

function resolvePromptAssetRefs(record) {
  const promptMessage = promptMessageForRecord(record);
  const refs = promptMessage?.refs || [];
  return refs
    .map((ref) => {
      const asset = state.assets.find((item) => item.id === ref.id || item.slug === ref.slug || item.url === ref.url);
      return asset ? { ...asset, role: ref.role || asset.role } : ref;
    })
    .filter((asset) => asset?.id && asset?.slug);
}

async function promptAssetsReadyForReuse(assets) {
  const ready = [];
  for (const asset of assets) {
    const reusable = await ensureAssetLocalForReuse(asset);
    if (!reusable || !String(reusable.url || "").startsWith("/uploads/")) continue;
    try {
      const response = await fetch(reusable.url, { method: "HEAD" });
      if (response.ok) ready.push(reusable);
    } catch {}
  }
  return ready;
}

async function ensureAssetLocalForReuse(asset) {
  if (!asset?.url) return null;
  if (String(asset.url).startsWith("/uploads/")) return asset;
  if (!/^https?:\/\//i.test(asset.url)) return null;
  try {
    const response = await fetch(asset.url);
    if (!response.ok) throw new Error("Could not fetch remote media.");
    const blob = await response.blob();
    const kind = blob.type?.startsWith("video/") ? "video" : blob.type?.startsWith("audio/") ? "audio" : "image";
    const dataUrl = await blobToDataUrl(blob);
    const saved = await api("/api/assets", {
      method: "POST",
      body: JSON.stringify({
        dataUrl,
        fileName: asset.originalName || asset.fileName || `${asset.slug || "reference"}.${kind === "video" ? "mp4" : kind === "audio" ? "mp3" : "png"}`,
        mimeType: blob.type || asset.mimeType || (kind === "video" ? "video/mp4" : kind === "audio" ? "audio/mpeg" : "image/png"),
        label: asset.label || asset.slug || "Reference",
        role: asset.role || "reference"
      })
    });
    applyServerState(saved.state);
    return saved.asset;
  } catch {
    return null;
  }
}

function registryForKind(kind) {
  return kind === "image" ? imageModelRegistry : kind === "video" ? videoModelRegistry : audioModelRegistry;
}

function restorePromptOptions(record) {
  if (!record || !state.options[record.kind]) return;
  const promptMessage = promptMessageForRecord(record);
  const nextOptions = { ...(promptMessage?.options || {}), ...(record.message.options || {}) };
  if (!Object.keys(nextOptions).length) return;
  const registry = registryForKind(record.kind);
  if (nextOptions.model && !registry.some((model) => model.id === nextOptions.model)) delete nextOptions.model;
  state.options[record.kind] = { ...state.options[record.kind], ...nextOptions };
  normalizeOptionsForModel(record.kind);
}

function appendAssetMentions(prompt, assets) {
  let next = (prompt || "").trim();
  for (const asset of assets) {
    const label = referenceLabel(asset, assets);
    if (referenceLabelRegex(label).test(next)) continue;
    next = `${next}${next ? " " : ""}${label}`;
  }
  return next;
}

async function usePromptFromMessage(messageId) {
  const record = findMessageRecordClient(messageId);
  const prompt = promptForMessage(record);
  if (!record) return;
  const requestedAssets = resolvePromptAssetRefs(record);
  const promptAssets = await promptAssetsReadyForReuse(requestedAssets);
  promptAssets.forEach((asset) => {
    const stateAsset = state.assets.find((item) => item.id === asset.id);
    if (stateAsset) stateAsset.role = asset.role || stateAsset.role || "reference";
  });
  const nextPrompt = normalizePromptReferenceLabels(prompt, promptAssets);
  state.attached[record.kind] = promptAssets.map((asset) => asset.id);
  state.prompts[record.kind] = nextPrompt;
  restorePromptOptions(record);
  await navigator.clipboard?.writeText?.(nextPrompt).catch(() => {});
  if (state.view === record.kind) refreshComposer(record.kind, { preserveFocus: false });
  else render({ preserveScroll: true, scrollToBottom: false });
  requestAnimationFrame(() => {
    const input = root.querySelector(`[data-prompt="${record.kind}"]`);
    input?.focus();
    input?.setSelectionRange?.(input.value.length, input.value.length);
  });
  const skipped = requestedAssets.length - promptAssets.length;
  showToast(skipped ? `Prompt copied, ${skipped} missing asset${skipped === 1 ? "" : "s"} skipped` : "Prompt copied for editing", skipped ? "warning" : "success");
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

async function ensureMessageAssetAttached(record) {
  const message = record?.message;
  const url = message?.result?.url || message?.result?.urls?.[0];
  if (!record || !url || !["image", "video", "audio"].includes(record.kind)) return null;
  state.attached[record.kind] ||= [];
  const known = state.assets.find((asset) => asset.id === message.result?.assetId || asset.url === url || asset.sourceMessageId === message.id);
  if (known) {
    const reusable = await ensureAssetLocalForReuse(known);
    if (reusable && !state.attached[record.kind].includes(reusable.id)) state.attached[record.kind].push(reusable.id);
    return reusable || known;
  }
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error("Could not fetch generated media.");
    const blob = await response.blob();
    const model = modelFor(record.kind, message.options?.model);
    const dataUrl = await blobToDataUrl(blob);
    const saved = await api("/api/assets", {
      method: "POST",
      body: JSON.stringify({
        dataUrl,
        fileName: `${model.label}.${record.kind === "video" ? "mp4" : record.kind === "audio" ? "mp3" : "png"}`,
        mimeType: blob.type || (record.kind === "video" ? "video/mp4" : record.kind === "audio" ? "audio/mpeg" : "image/png"),
        label: model.label,
        role: "reference"
      })
    });
    applyServerState(saved.state);
    if (!state.attached[record.kind].includes(saved.asset.id)) state.attached[record.kind].push(saved.asset.id);
    return saved.asset;
  } catch {
    return null;
  }
}

async function sendMessageToCanvas(messageId) {
  const record = findMessageRecordClient(messageId);
  const message = record?.message;
  const url = message?.result?.url || message?.result?.urls?.[0];
  const kind = message?.result?.type || message?.kind || record?.kind;
  if (!record || !url || !["image", "video", "audio"].includes(kind)) return;
  try {
    const asset = await ensureMessageAssetAttached(record);
    const nodeUrl = asset?.url || url;
    let project = (state.canvasProjects || []).find((item) => item.id === state.activeCanvasProject) || state.canvasProjects?.[0];
    if (!project) {
      const created = await api("/api/canvas/projects", { method: "POST", body: JSON.stringify({ name: "Imported generations" }) });
      applyServerState(created.state);
      state.activeCanvasProject = created.project.id;
      project = created.project;
    }
    const viewport = project.viewport || { x: 0, y: 0, zoom: 1 };
    const nodes = project.nodes || [];
    const node = {
      id: `node_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      type: kind === "video" ? "videoInput" : kind === "audio" ? "audioInput" : "imageInput",
      x: Math.round((-viewport.x + 160) / (viewport.zoom || 1) + (nodes.length % 4) * 46),
      y: Math.round((-viewport.y + 140) / (viewport.zoom || 1) + (nodes.length % 4) * 38),
      width: kind === "video" ? 440 : 360,
      status: "success",
      assetId: asset?.id || "",
      result: { url: nodeUrl, type: kind, messageId: message.id, assetId: asset?.id || "" },
      sourceMessageId: message.id,
      settings: { label: modelFor(record.kind, message.options?.model).label }
    };
    project.nodes = [...nodes, node];
    project.edges ||= [];
    const saved = await api(`/api/canvas/projects/${encodeURIComponent(project.id)}`, { method: "PUT", body: JSON.stringify({ nodes: project.nodes, edges: project.edges, viewport: project.viewport }) });
    applyServerState(saved.state);
    state.activeCanvasProject = project.id;
    showToast("Sent to canvas", "success");
  } catch (error) {
    showToast(error.message, "error");
  }
}

async function sendAssetToCanvas(assetId) {
  const asset = (state.assets || []).find((item) => item.id === assetId);
  if (!asset?.url) return;
  const kind = asset.mimeType?.startsWith("video/") ? "video" : asset.mimeType?.startsWith("audio/") ? "audio" : "image";
  if (!["image", "video", "audio"].includes(kind)) return;
  try {
    let project = (state.canvasProjects || []).find((item) => item.id === state.activeCanvasProject) || state.canvasProjects?.[0];
    if (!project) {
      const created = await api("/api/canvas/projects", { method: "POST", body: JSON.stringify({ name: "Imported assets" }) });
      applyServerState(created.state);
      state.activeCanvasProject = created.project.id;
      project = created.project;
    }
    const viewport = project.viewport || { x: 0, y: 0, zoom: 1 };
    const nodes = project.nodes || [];
    const node = {
      id: `node_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      type: kind === "video" ? "videoInput" : kind === "audio" ? "audioInput" : "imageInput",
      x: Math.round((-viewport.x + 160) / (viewport.zoom || 1) + (nodes.length % 4) * 46),
      y: Math.round((-viewport.y + 140) / (viewport.zoom || 1) + (nodes.length % 4) * 38),
      width: kind === "video" ? 440 : 360,
      status: "success",
      assetId: asset.id,
      result: { url: asset.url, type: kind, assetId: asset.id },
      settings: { label: asset.label || asset.originalName || "Asset" }
    };
    project.nodes = [...nodes, node];
    project.edges ||= [];
    const saved = await api(`/api/canvas/projects/${encodeURIComponent(project.id)}`, { method: "PUT", body: JSON.stringify({ nodes: project.nodes, edges: project.edges, viewport: project.viewport }) });
    applyServerState(saved.state);
    state.activeCanvasProject = project.id;
    showToast("Sent to canvas", "success");
  } catch (error) {
    showToast(error.message, "error");
  }
}

async function deleteChat(chatId, kind) {
  const list = state.chats[kind] || [];
  if (list.length <= 1) {
    showToast("Cannot delete the last chat", "error");
    return;
  }
  try {
    const next = await api(`/api/chats/${encodeURIComponent(chatId)}`, { method: "DELETE" });
    applyServerState(next);
    state.attached[kind] = [];
    state.prompts[kind] = "";
    state.preview = null;
    render();
  } catch (error) {
    showToast(error.message, "error");
  }
}

async function deleteMessage(messageId) {
  const record = findMessageRecordClient(messageId);
  if (!record) return;
  const wasVisible = state.view === record.kind && state.activeChat[record.kind] === record.chat.id;
  try {
    const next = await api(`/api/chats/${encodeURIComponent(record.chat.id)}/messages/${encodeURIComponent(messageId)}`, { method: "DELETE" });
    applyServerState(next);
    if (state.preview === messageId) closePreview();
    if (wasVisible) {
      root.querySelector(`[data-message-id="${CSS.escape(messageId)}"]`)?.remove();
      const current = currentChat(record.kind);
      if (!visibleMessages(current).length) render({ preserveComposer: true, preserveScroll: true, scrollToBottom: false });
      else {
        hydrateMediaPreviewCache();
        paintCredits();
      }
    } else {
      render({ preserveComposer: true, preserveScroll: true, scrollToBottom: false });
    }
  } catch (error) {
    showToast(error.message, "error");
  }
}

async function cancelMessage(messageId) {
  const record = findMessageRecordClient(messageId);
  if (!record || !["queued", "generating", "waiting", "queuing"].includes(record.message.status)) return;
  record.message.status = "cancelled";
  record.message.text = "Generation cancelled";
  patchVisibleMessage(findMessageLocation(record.chat.id, messageId), messageId);
  try {
    const result = await api(`/api/chats/${encodeURIComponent(record.chat.id)}/messages/${encodeURIComponent(messageId)}/cancel`, { method: "POST" });
    applyServerState(result.state);
    patchVisibleMessage(findMessageLocation(record.chat.id, messageId), messageId);
  } catch (error) {
    showToast(error.message, "error");
    schedulePendingPolls();
  }
}

async function regenerateMessage(messageId) {
  const record = findMessageRecordClient(messageId);
  if (!record || record.message.role !== "assistant" || state.regenerating.has(messageId)) return;
  state.regenerating.add(messageId);
  setRegenerateButtonState(messageId, true);
  try {
    const result = await api(`/api/chats/${encodeURIComponent(record.chat.id)}/messages/${encodeURIComponent(messageId)}/regenerate`, { method: "POST" });
    applyServerState(result.state);
    appendGeneratedMessage({ kind: record.kind, chatId: record.chat.id, message: result.message, sourceMessageId: messageId });
    showToast("Regeneration started", "success");
    schedulePendingPolls();
  } catch (error) {
    showToast(error.message, "error");
  } finally {
    state.regenerating.delete(messageId);
    setRegenerateButtonState(messageId, false);
    refreshComposer(record.kind);
  }
}

function setRegenerateButtonState(messageId, active) {
  const buttons = root.querySelectorAll(`[data-regenerate-message="${CSS.escape(messageId)}"]`);
  buttons.forEach((button) => {
    button.classList.toggle("working", active);
    button.disabled = active;
    button.setAttribute("aria-label", active ? "Regenerating..." : "Regenerate");
    button.setAttribute("title", active ? "Regenerating..." : "Regenerate");
  });
}

function appendGeneratedMessage({ kind, chatId, message, sourceMessageId = "" }) {
  if (!message || state.view !== kind || state.activeChat[kind] !== chatId) return false;
  if (root.querySelector(`[data-message-id="${CSS.escape(message.id)}"]`)) return true;
  if (kind === "image" || kind === "video") {
    const grid = root.querySelector(".video-flow-grid");
    if (!grid) return false;
    const sourceRecord = sourceMessageId ? findMessageRecordClient(sourceMessageId) : null;
    const promptMessage = sourceRecord ? promptMessageForRecord(sourceRecord) : promptMessageForRecord({ chat: currentChat(kind), message });
    grid.insertAdjacentHTML("beforeend", renderGenerationTile({ message, prompt: promptMessage?.text || "", promptMessage }, kind));
    const next = root.querySelector(`[data-message-id="${CSS.escape(message.id)}"]`);
    if (next) bindMessageEvents(next);
    if (next) hydrateMediaPreviewCache(next);
    scrollMessagesToBottom();
    startCellNoise();
    startElapsedTimers();
    return true;
  }
  const stack = root.querySelector(".message-column");
  if (!stack) return false;
  stack.insertAdjacentHTML("beforeend", renderMessage(message));
  const next = root.querySelector(`[data-message-id="${CSS.escape(message.id)}"]`);
  if (next) bindMessageEvents(next);
  if (next) hydrateMediaPreviewCache(next);
  scrollMessagesToBottom();
  startAsciiNoise();
  startElapsedTimers();
  return true;
}

function bindDropZone(element) {
  const kind = element.dataset.dropZone;
  let dragDepth = 0;
  const isExternalFileDrag = (event) => {
    const types = Array.from(event.dataTransfer?.types || []);
    return types.includes("Files") && !types.includes("application/x-connxn-attachment");
  };
  element.addEventListener("dragenter", (event) => {
    if (!isExternalFileDrag(event)) return;
    event.preventDefault();
    dragDepth += 1;
    state.dragActive = kind;
    element.classList.add("dragging");
  });
  element.addEventListener("dragover", (event) => {
    if (!isExternalFileDrag(event)) return;
    event.preventDefault();
  });
  element.addEventListener("dragleave", (event) => {
    if (!isExternalFileDrag(event)) return;
    event.preventDefault();
    dragDepth -= 1;
    if (dragDepth <= 0) {
      state.dragActive = "";
      element.classList.remove("dragging");
    }
  });
  element.addEventListener("drop", (event) => {
    if (!isExternalFileDrag(event)) return;
    event.preventDefault();
    dragDepth = 0;
    state.dragActive = "";
    element.classList.remove("dragging");
    uploadAssets(event.dataTransfer?.files, kind);
  });
}

function bindProgressiveLoading() {
  const libraryButton = root.querySelector("[data-load-more-library]");
  if (libraryButton && "IntersectionObserver" in window) {
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      observer.disconnect();
      state.libraryLimit = (state.libraryLimit || LIBRARY_PAGE_SIZE) + LIBRARY_PAGE_SIZE;
      render({ preserveScroll: true, scrollToBottom: false });
    }, { rootMargin: "360px" });
    observer.observe(libraryButton);
  }
  const list = root.querySelector("[data-message-list]");
  const messageButton = root.querySelector("[data-load-more-messages]");
  if (list && messageButton) {
    let loadingOlder = false;
    list.addEventListener("scroll", () => {
      if (loadingOlder || list.scrollTop > 80) return;
      loadingOlder = true;
      const kind = messageButton.dataset.loadMoreMessages;
      const step = kind === "audio" ? CHAT_PAGE_SIZE : FLOW_PAGE_SIZE;
      state.messageLimits[kind] = (state.messageLimits[kind] || step) + step;
      render({ preserveScroll: true, scrollToBottom: false });
    }, { passive: true });
  }
}

async function saveAccount(event) {
  event?.preventDefault?.();
  if (state.savingAccount) return;
  const nick = root.querySelector("[data-account-nick]")?.value.trim() || state.profile.nick;
  const kieApiKey = root.querySelector("[data-account-key]")?.value.trim() || "";
  const avatarData = state.accountDraft?.avatarData ?? state.profile.avatarData;
  const downloadDir = root.querySelector("[data-download-dir]")?.value.trim() || "";
  const userDataDir = root.querySelector("[data-user-data-dir]")?.value.trim() || "";
  const loaderMode = normalizeLoaderMode(state.accountDraft?.loaderMode || state.settings.loaderMode);
  state.accountDraft = { nick, kieApiKey, avatarData, loaderMode };
  state.savingAccount = true;
  render();
  try {
    const result = await api("/api/settings", {
      method: "POST",
      body: JSON.stringify({ nick, kieApiKey, avatarData, loaderMode, themeMode: state.themeMode, lastView: state.view, verifyKey: Boolean(kieApiKey) })
    });
    applyServerState(result);
    const storageResult = await api("/api/storage-paths", {
      method: "POST",
      body: JSON.stringify({ downloadDir, userDataDir })
    });
    applyServerState(storageResult.state);
    state.storage = storageResult.storage;
    state.accountDraft = null;
    saveUiPrefs();
    showToast(storageResult.migrated ? "Saved and moved workspace" : result.connection?.ok ? "Saved and connected" : "Saved", "success");
  } catch (error) {
    showToast(error.message, "error");
  } finally {
    state.savingAccount = false;
    render();
  }
}

async function selectConfiguredFolder(kind) {
  const folderPath = kind === "data"
    ? root.querySelector("[data-user-data-dir]")?.value.trim()
    : root.querySelector("[data-download-dir]")?.value.trim();
  try {
    const result = await api("/api/select-folder", { method: "POST", body: JSON.stringify({ field: kind, currentPath: folderPath }) });
    if (result.cancelled || !result.path) return;
    const input = kind === "data" ? root.querySelector("[data-user-data-dir]") : root.querySelector("[data-download-dir]");
    if (input) input.value = result.path;
    showToast("Folder selected. Press Save to apply.", "success");
  } catch (error) {
    showToast(error.message || "Could not choose folder", "error");
  }
}

async function checkConnection() {
  if (state.checkingKey) return;
  state.checkingKey = true;
  render();
  try {
    const result = await api("/api/key-status");
    applyServerState(result);
    showToast(result.connection?.ok ? "KIE connection verified" : result.connection?.message || "Connection failed", result.connection?.ok ? "success" : "error");
  } catch (error) {
    showToast(error.message, "error");
  } finally {
    state.checkingKey = false;
    render();
  }
}

async function analyzeStorage() {
  if (state.checkingStorage) return;
  state.checkingStorage = true;
  render();
  try {
    const result = await api("/api/storage");
    state.storage = result.storage;
  } catch (error) {
    showToast(error.message, "error");
  } finally {
    state.checkingStorage = false;
    render();
  }
}

async function saveMediaToConfiguredFolder(url, kind = "", name = "connxn_media", button = null) {
  if (!url || String(url).startsWith("data:")) return;
  const key = downloadKey(url, kind, name);
  if (state.activeDownloads.has(key)) return;
  state.activeDownloads.add(key);
  setDownloadButtonState(button, true);
  showToast("Saving media...", "saving");
  try {
    const result = await api("/api/media/save", {
      method: "POST",
      body: JSON.stringify({ url, kind: kind || inferMediaKind(url), name })
    });
    showToast(`Saved to ${result.savedPath}`, "success");
  } catch (error) {
    showToast(error.message, "error");
  } finally {
    state.activeDownloads.delete(key);
    setDownloadButtonState(button, false);
  }
}

function setDownloadButtonState(button, active) {
  if (!button) return;
  button.classList.toggle("is-downloading", active);
  button.disabled = active;
  button.setAttribute("aria-label", active ? "Saving..." : "Download");
  button.setAttribute("title", active ? "Saving..." : "Download");
  const label = button.querySelector("span");
  if (label) {
    if (active) {
      label.dataset.idleText = label.textContent || "Download";
      label.textContent = "Saving";
    } else if (label.dataset.idleText) {
      label.textContent = label.dataset.idleText;
      delete label.dataset.idleText;
    }
  }
}

async function exportWorkspaceArchive() {
  try {
    const response = await fetch("/api/export-workspace");
    if (!response.ok) throw new Error("Workspace export failed");
    const blob = await response.blob();
    const disposition = response.headers.get("Content-Disposition") || "";
    const match = /filename="([^"]+)"/.exec(disposition);
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = match?.[1] || "connxn-workspace.json";
    link.click();
    URL.revokeObjectURL(link.href);
    showToast("Workspace exported", "success");
  } catch (error) {
    showToast(error.message, "error");
  }
}

async function clearWorkspaceCache() {
  if (state.clearingCache) return;
  const ok = window.confirm("Clear workflow cache? This removes canvas workflows and uploaded/generated canvas assets. Account, avatar and API key stay saved.");
  if (!ok) return;
  state.clearingCache = true;
  render();
  try {
    const result = await api("/api/cache", { method: "DELETE" });
    applyServerState(result.state);
    state.storage = result.storage;
    state.activeCanvasProject = state.canvasProjects?.[0]?.id || "";
    showToast("Workflow cache cleared", "success");
  } catch (error) {
    showToast(error.message, "error");
  } finally {
    state.clearingCache = false;
    render();
  }
}

async function handleAvatarChange(event) {
  const file = event.currentTarget.files?.[0];
  if (!file) return;
  const avatarData = await readFile(file);
  state.accountDraft = state.accountDraft || {
    nick: root.querySelector("[data-account-nick]")?.value || state.profile.nick,
    kieApiKey: root.querySelector("[data-account-key]")?.value || "",
    avatarData: state.profile.avatarData
  };
  state.accountDraft.avatarData = avatarData;
  render();
}

async function submitPrompt(kind) {
  const prompt = state.prompts[kind].trim();
  const chat = currentChat(kind);
  if (!prompt || !chat || state.sending[kind]) return;
  if (!state.settings.hasKieKey) {
    showToast("Add your KIE API key in Account first", "error");
    return;
  }

  const refs = selectedRefs(kind);
  const validationError = validateGeneration(kind, refs);
  if (validationError) {
    showToast(validationError, "error");
    return;
  }
  const latestImage = kind === "image" ? latestSuccessfulImage(chat) : null;
  const explicitNew = /\b(create|new|новую|новое|создай новое|с нуля)\b/i.test(prompt);
  const editContext = false;
  const nowIso = new Date().toISOString();
  const tempUser = { id: `local_${Date.now()}`, role: "user", text: prompt, refs, editContext, options: { ...state.options[kind] }, createdAt: nowIso };
  const tempAssistant = {
    id: `local_${Date.now()}_a`,
    role: "assistant",
    kind,
    status: "generating",
    text: "",
    createdAt: nowIso,
    startedAt: nowIso,
    promptId: tempUser.id,
    refs,
    options: { ...state.options[kind] }
  };
  chat.messages.push(tempUser, tempAssistant);
  if (kind !== "image") state.prompts[kind] = "";
  if (kind !== "image") state.attached[kind] = [];
  state.sending[kind] = true;
  if (!paintSubmittedPromptStart({ kind, chatId: chat.id, tempUser, tempAssistant, prompt })) {
    render({ preserveScroll: true });
  }

  try {
    const result = await api("/api/generate", {
      method: "POST",
      body: JSON.stringify({ type: kind, chatId: chat.id, prompt, editContext, contextImageUrl: editContext ? (latestImage?.result?.url || latestImage?.result?.urls?.[0] || "") : "", options: state.options[kind], refs })
    });
    applyServerState(result.state);
    settleSubmittedPrompt({ kind, chatId: chat.id, tempUserId: tempUser.id, tempAssistantId: tempAssistant.id, result, prompt });
  } catch (error) {
    showToast(error.message, "error");
    const current = currentChat(kind);
    if (current) {
      current.messages = current.messages.filter((message) => !String(message.id).startsWith("local_"));
    }
    render({ preserveComposer: true, preserveScroll: true, scrollToBottom: false });
  } finally {
    state.sending[kind] = false;
    schedulePendingPolls();
    if (state.view === kind && state.activeChat[kind] === chat.id) refreshComposer(kind);
  }
}

function settleSubmittedPrompt({ kind, chatId, tempUserId, tempAssistantId, result, prompt }) {
  if (state.view !== kind || state.activeChat[kind] !== chatId) return;
  const serverMessageId = result?.message?.id || "";
  const serverLocation = serverMessageId ? findMessageLocation(chatId, serverMessageId) : null;
  const serverMessage = serverLocation?.message || result?.message;
  if (!serverMessage) return;
  if (kind === "image" || kind === "video") {
    const article = root.querySelector(`[data-message-id="${CSS.escape(tempAssistantId)}"]`);
    if (!article) return;
    const promptMessage = serverLocation ? promptMessageForRecord({ chat: serverLocation.chat, message: serverMessage }) : null;
    article.outerHTML = renderGenerationTile({ message: serverMessage, prompt: promptMessage?.text || prompt || "", promptMessage }, kind);
    const next = root.querySelector(`[data-message-id="${CSS.escape(serverMessage.id)}"]`);
    if (next) bindMessageEvents(next);
    if (next) hydrateMediaPreviewCache(next);
    startCellNoise();
    startElapsedTimers();
    return;
  }

  const chat = serverLocation?.chat || currentChat(kind);
  const serverUser = chat?.messages?.find((message) => message.id === serverMessage.promptId && message.role === "user");
  const userArticle = root.querySelector(`[data-message-id="${CSS.escape(tempUserId)}"]`);
  const assistantArticle = root.querySelector(`[data-message-id="${CSS.escape(tempAssistantId)}"]`);
  if (userArticle && serverUser) userArticle.outerHTML = renderMessage(serverUser);
  if (assistantArticle) assistantArticle.outerHTML = renderMessage(serverMessage);
  [serverUser?.id, serverMessage.id].filter(Boolean).forEach((id) => {
    const next = root.querySelector(`[data-message-id="${CSS.escape(id)}"]`);
    if (next) bindMessageEvents(next);
    if (next) hydrateMediaPreviewCache(next);
  });
  startAsciiNoise();
  startCellNoise();
  startElapsedTimers();
}

function paintSubmittedPromptStart({ kind, chatId, tempUser, tempAssistant, prompt }) {
  if (state.view !== kind || state.activeChat[kind] !== chatId || root.querySelector(".empty-chat")) return false;
  if (kind === "image" || kind === "video") {
    const grid = root.querySelector(".video-flow-grid");
    if (!grid) return false;
    grid.insertAdjacentHTML("beforeend", renderGenerationTile({ message: tempAssistant, prompt, promptMessage: tempUser }, kind));
    const next = root.querySelector(`[data-message-id="${CSS.escape(tempAssistant.id)}"]`);
    if (next) bindMessageEvents(next);
    if (next) hydrateMediaPreviewCache(next);
    refreshComposer(kind, { preserveFocus: false });
    scrollMessagesToBottom();
    startCellNoise();
    startElapsedTimers();
    return true;
  }

  const stack = root.querySelector(".message-column");
  if (!stack) return false;
  stack.insertAdjacentHTML("beforeend", `${renderMessage(tempUser)}${renderMessage(tempAssistant)}`);
  [tempUser.id, tempAssistant.id].forEach((id) => {
    const next = root.querySelector(`[data-message-id="${CSS.escape(id)}"]`);
    if (next) bindMessageEvents(next);
  });
  refreshComposer(kind, { preserveFocus: false });
  scrollMessagesToBottom();
  startAsciiNoise();
  startCellNoise();
  startElapsedTimers();
  return true;
}

function validateGeneration(kind, refs) {
  if (kind === "image") return "";
  const model = modelFor("video");
  const unsupported = attachedAssets("video").find((asset) => roleOptionsForAsset(asset, "video").length === 0);
  if (unsupported) return `${unsupported.label || unsupported.slug} is not supported by ${model.label}.`;

  const hasFrames = refs.some((ref) => ref.role === "start" || ref.role === "end");
  const hasReferences = refs.some((ref) => ref.role === "reference");
  if (model.id.startsWith("bytedance/seedance-2") && hasFrames && hasReferences) {
    return "Seedance requires either Start/End frames or multimodal references, not both.";
  }
  if (refs.some((ref) => ref.role === "end") && !refs.some((ref) => ref.role === "start")) {
    return "Add a Start frame before using an End frame.";
  }
  if (["hailuo/2-3-image-to-video-pro", "hailuo/2-3-image-to-video-standard"].includes(model.id) && !refs.some((ref) => ref.mimeType?.startsWith("image/"))) {
    return `${model.label} requires an image.`;
  }
  if (model.id === "wan/2-7-image-to-video" && !refs.some((ref) => ref.role === "start" || ref.role === "continuation")) {
    return "Wan Frames requires a Start frame or Source video.";
  }
  if (model.id === "wan/2-7-videoedit" && !refs.some((ref) => ref.mimeType?.startsWith("video/"))) {
    return "Wan Video Edit requires a Source video.";
  }
  return "";
}

async function uploadAssets(fileList, kind) {
  const files = Array.from(fileList || []);
  if (!files.length || state.uploading[kind]) return;
  const accepted = files.filter((file) => {
    if (kind === "image") return file.type.startsWith("image/");
    return file.type.startsWith("image/") || file.type.startsWith("video/") || file.type.startsWith("audio/");
  });
  if (!accepted.length) {
    showToast(kind === "image" ? "Image files only" : "Attach an image, video, or audio file", "error");
    return;
  }

  state.uploading[kind] = true;
  if (state.view === kind) refreshComposer(kind, { preserveFocus: false });
  try {
    for (const file of accepted) {
      const result = await api("/api/assets", {
        method: "POST",
        body: JSON.stringify({
          fileName: file.name,
          mimeType: file.type || "application/octet-stream",
          dataUrl: await readFile(file),
          role: roleOptionsForAsset({ mimeType: file.type }, kind)[0]?.[0] || "reference"
        })
      });
      applyServerState(result.state);
      if (!state.attached[kind].includes(result.asset.id)) state.attached[kind].push(result.asset.id);
      if (state.view === kind) refreshComposer(kind, { preserveFocus: false });
    }
  } catch (error) {
    showToast(error.message, "error");
  } finally {
    state.uploading[kind] = false;
    if (state.view === kind) refreshComposer(kind, { preserveFocus: false });
  }
}

function readFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function insertRefMention(assetId, kind) {
  const textarea = root.querySelector(`[data-prompt="${kind}"]`);
  if (textarea) state.prompts[kind] = textarea.value;
  const asset = attachedAssets(kind).find((item) => item.id === assetId || item.slug === assetId);
  if (!asset) return;
  const token = referenceLabel(asset, attachedAssets(kind));
  const current = state.prompts[kind] || "";
  if (referenceLabelRegex(token).test(current)) {
    textarea?.focus();
    return;
  }
  const start = textarea?.selectionStart ?? current.length;
  const end = textarea?.selectionEnd ?? current.length;
  const before = current.slice(0, start);
  const after = current.slice(end);
  const prefix = before && !/\s$/.test(before) ? " " : "";
  const suffix = after && !/^\s/.test(after) ? " " : "";
  state.prompts[kind] = `${before}${prefix}${token} ${suffix}${after}`;
  if (!textarea) return;
  textarea.value = state.prompts[kind];
  const caret = before.length + prefix.length + token.length + 1;
  textarea.focus();
  textarea.setSelectionRange(caret, caret);
  autoSizeTextarea(textarea);
  updatePromptHighlight(kind);
  updateMentionStates(kind);
  closeMentionMenu(kind);
}

function updateMentionMenu(kind, textarea) {
  const caret = textarea.selectionStart;
  const before = textarea.value.slice(0, caret);
  const at = before.lastIndexOf("@");
  if (at < 0 || (at > 0 && !/\s/.test(before[at - 1])) || /\s/.test(before.slice(at + 1))) {
    closeMentionMenu(kind);
    return;
  }

  const query = before.slice(at + 1).toLowerCase();
  if (!/^[a-z0-9-]*$/i.test(query)) {
    closeMentionMenu(kind);
    return;
  }
  const matches = attachedAssets(kind)
    .filter((asset) => asset.slug.toLowerCase().includes(query) || String(asset.label || "").toLowerCase().includes(query))
    .map((asset) => asset.id);
  state.mentionMenu = { kind, start: at, end: caret, matches, selected: 0 };
  paintMentionMenu(kind);
}

function paintMentionMenu(kind) {
  const element = root.querySelector(`[data-mention-menu="${kind}"]`);
  const menu = state.mentionMenu?.kind === kind ? state.mentionMenu : null;
  if (!element) return;
  element.hidden = !menu;
  element.innerHTML = menu ? renderMentionMenuItems(menu) : "";
  element.closest(".composer-dock")?.classList.toggle("mention-open", Boolean(menu));
}

function closeMentionMenu(kind) {
  if (state.mentionMenu?.kind === kind) state.mentionMenu = null;
  paintMentionMenu(kind);
}

function handleMentionKeydown(event, textarea, kind) {
  const menu = state.mentionMenu?.kind === kind ? state.mentionMenu : null;
  if (!menu) return false;
  if (event.key === "Escape") {
    event.preventDefault();
    closeMentionMenu(kind);
    return true;
  }
  if (!menu.matches.length) return false;
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    const direction = event.key === "ArrowDown" ? 1 : -1;
    menu.selected = (menu.selected + direction + menu.matches.length) % menu.matches.length;
    paintMentionMenu(kind);
    return true;
  }
  if ((event.key === "Enter" || event.key === "Tab") && !event.isComposing) {
    event.preventDefault();
    applyMentionChoice(menu.matches[menu.selected], kind, textarea);
    return true;
  }
  return false;
}

function applyMentionChoice(assetId, kind, textarea = root.querySelector(`[data-prompt="${kind}"]`)) {
  const menu = state.mentionMenu?.kind === kind ? state.mentionMenu : null;
  const asset = state.assets.find((item) => item.id === assetId);
  if (!menu || !asset || !textarea) return;
  const token = referenceLabel(asset, attachedAssets(kind));
  state.prompts[kind] = textarea.value;
  const current = textarea.value;
  const value = `${current.slice(0, menu.start)}${token} ${current.slice(menu.end).replace(/^\s+/, "")}`;
  state.prompts[kind] = value;
  textarea.value = value;
  const caret = menu.start + token.length + 1;
  closeMentionMenu(kind);
  textarea.focus();
  textarea.setSelectionRange(caret, caret);
  autoSizeTextarea(textarea);
  updatePromptHighlight(kind);
  updateMentionStates(kind);
}

function latestSuccessfulImage(chat) {
  for (let index = (chat?.messages || []).length - 1; index >= 0; index -= 1) {
    const message = chat.messages[index];
    if (message.role === "assistant" && message.result?.url && !message.result.mock) return message;
  }
  return null;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function mediaKindForAsset(asset) {
  if (asset?.mimeType?.startsWith("video/")) return "video";
  if (asset?.mimeType?.startsWith("audio/")) return "audio";
  return "image";
}

function mediaKindLabel(kind) {
  return kind === "video" ? "Video" : kind === "audio" ? "Audio" : "Image";
}

function referenceLabel(asset, orderedAssets = state.assets) {
  const targetKind = mediaKindForAsset(asset);
  let index = 0;
  for (const item of orderedAssets || []) {
    if (mediaKindForAsset(item) !== targetKind) continue;
    index += 1;
    if (item.id === asset.id || (asset.slug && item.slug === asset.slug) || (asset.url && item.url === asset.url)) {
      return `${mediaKindLabel(targetKind)} ${index}`;
    }
  }
  return `${mediaKindLabel(targetKind)} 1`;
}

function referenceLabelRegex(label) {
  const match = /^(Image|Video|Audio)\s+(\d+)$/i.exec(String(label || "").trim());
  if (!match) return new RegExp(`(^|\\s)${escapeRegExp(label)}(?=\\s|$)`, "i");
  return new RegExp(`(^|\\s)${match[1]}\\s+${match[2]}(?=\\s|$|[.,;:!?])`, "i");
}

function referenceLabelMap(assets) {
  const map = new Map();
  for (const asset of assets || []) {
    const label = referenceLabel(asset, assets);
    if (asset.id) map.set(asset.id, label);
    if (asset.slug) map.set(asset.slug.toLowerCase(), label);
  }
  return map;
}

function normalizePromptReferenceLabels(prompt, assets) {
  let next = String(prompt || "");
  const labels = referenceLabelMap(assets);
  next = next.replace(/@([a-z0-9-]+)/gi, (full, slug) => labels.get(String(slug).toLowerCase()) || full);
  return next;
}

function mentionedReferences(kind) {
  const mentioned = new Set();
  const prompt = state.prompts[kind] || "";
  const assets = attachedAssets(kind);
  const labels = new Map(assets.map((asset) => [referenceLabel(asset, assets).toLowerCase(), asset.id]));
  for (const match of prompt.matchAll(/\b(Image|Video|Audio)\s+(\d+)\b/gi)) {
    const id = labels.get(`${match[1]} ${match[2]}`.toLowerCase());
    if (id) mentioned.add(id);
  }
  for (const match of prompt.matchAll(/@([a-z0-9-]+)/gi)) {
    const asset = assets.find((item) => item.slug?.toLowerCase() === match[1].toLowerCase());
    if (asset) mentioned.add(asset.id);
  }
  return mentioned;
}

function selectedRefs(kind) {
  const assets = attachedAssets(kind);
  return assets.map((asset) => ({
    id: asset.id,
    slug: asset.slug,
    label: referenceLabel(asset, assets),
    url: asset.url,
    mimeType: asset.mimeType,
    role: asset.role || "reference"
  }));
}

function reorderAttached(kind, draggedId, targetId, beforeTarget) {
  const list = [...(state.attached[kind] || [])].filter((id) => id !== draggedId);
  const targetIndex = list.indexOf(targetId);
  if (targetIndex === -1) return;
  list.splice(beforeTarget ? targetIndex : targetIndex + 1, 0, draggedId);
  state.attached[kind] = list;
}

function highlightMentions(text) {
  return h(text || " ")
    .replace(/\b(Image|Video|Audio)\s+(\d+)\b/g, '<mark class="mention">$1 $2</mark>')
    .replace(/@([a-z0-9-]+)/gi, '<mark class="unknown-mention">@$1</mark>');
}

function highlightMessageMentions(text) {
  return h(text || "")
    .replace(/\b(Image|Video|Audio)\s+(\d+)\b/g, '<span class="message-mention">$1 $2</span>')
    .replace(/@([a-z0-9-]+)/gi, '<span class="message-mention">@$1</span>');
}

function refreshPromptHighlights() {
  updatePromptHighlight("image");
  updatePromptHighlight("audio");
  updateMentionStates(currentKind());
}

function updatePromptHighlight(kind) {
  const pre = root.querySelector(`[data-highlight="${kind}"]`);
  if (pre) pre.innerHTML = highlightMentions(state.prompts[kind]);
}

function updateMentionStates(kind) {
  const refs = mentionedReferences(kind);
  root.querySelectorAll(`[data-attachment-kind="${kind}"]`).forEach((element) => {
    element.classList.toggle("mentioned", refs.has(element.dataset.attachmentId));
  });
}

function autoSizeTextarea(textarea) {
  textarea.style.height = "0px";
  textarea.style.height = `${Math.min(Math.max(textarea.scrollHeight, 44), 180)}px`;
  const highlight = root.querySelector(`[data-highlight="${textarea.dataset.prompt}"]`);
  if (highlight) highlight.style.height = textarea.style.height;
}

function syncPromptScroll(textarea) {
  const pre = root.querySelector(`[data-highlight="${textarea.dataset.prompt}"]`);
  if (pre) {
    pre.scrollTop = textarea.scrollTop;
    pre.scrollLeft = textarea.scrollLeft;
  }
}

function optionLabel(kind, key) {
  const source = kind === "image" ? imageModels : kind === "video" ? videoModels : audioModels;
  return source.find(([value]) => value === state.options[kind][key])?.[1] || state.options[kind][key];
}

function optionSummary(options) {
  if (options.upscale) {
    const detail = options.upscaleFactor ? `${options.upscaleFactor}x` : options.upscaleResolution || "";
    return [detail, "upscale"].filter(Boolean).join(" / ");
  }
  if (options.model && audioModelRegistry.some((model) => model.id === options.model)) {
    return String(options.model).startsWith("elevenlabs/") ? `Speech / ${options.voice || "Rachel"}` : `Music / ${options.model}`;
  }
  const videoModel = videoModelRegistry.find((model) => model.id === options.model);
  if (videoModel) {
    const quality = videoModel.qualities?.find(([value]) => value === options.quality)?.[1] || "";
    const resolution = videoModel.resolutions?.find(([value]) => String(value) === String(options.resolution))?.[1] || options.resolution;
    return [videoModel.ratios?.length ? options.aspectRatio : "", videoModel.resolutions?.length ? resolution : "", videoModel.durations?.length || videoModel.durationRange ? `${options.duration}s` : "", quality].filter(Boolean).join(" / ");
  }
  const imageModel = imageModelRegistry.find((model) => model.id === options.model);
  if (imageModel?.seedream5) {
    const quality = imageModel.qualities?.find(([value]) => value === options.quality)?.[1] || options.quality;
    return [options.aspectRatio, quality, options.outputFormat].filter(Boolean).join(" / ");
  }
  return [options.aspectRatio, options.resolution, options.quality].filter(Boolean).join(" / ");
}

function roleLabel(role, mimeType) {
  if (role === "start") return "Start frame";
  if (role === "end") return "End frame";
  if (mimeType?.startsWith("audio/")) return "Audio reference";
  if (role === "continuation") return "Source video";
  if (mimeType?.startsWith("video/")) return "Video reference";
  return "Reference";
}

function showToast(text, tone = "") {
  state.toast = { text, tone };
  clearTimeout(toastTimer);
  let toast = root.querySelector(".toast");
  if (!toast) {
    root.insertAdjacentHTML("beforeend", `<div class="toast ${h(tone)}">${h(text)}</div>`);
    toast = root.querySelector(".toast");
  } else {
    toast.className = `toast ${tone}`;
    toast.textContent = text;
  }
  toastTimer = window.setTimeout(() => {
    state.toast = null;
    root.querySelector(".toast")?.remove();
  }, 3200);
}

function startAsciiNoise() {
  if (!root.querySelector("[data-ascii-noise]")) {
    if (asciiTimer) {
      cancelAnimationFrame(asciiTimer);
      asciiTimer = null;
    }
    return;
  }
  if (asciiTimer) return;
  let lastPaint = 0;
  const paint = (time) => {
    const fields = root.querySelectorAll("[data-ascii-noise]");
    if (!fields.length) {
      asciiTimer = null;
      return;
    }
    if (time - lastPaint >= 38) {
      fields.forEach((element, index) => {
        const columns = Math.max(52, Math.min(88, Math.floor(element.clientWidth / 8.2)));
        element.textContent = asciiFrame(time * 0.001, index, columns, 16);
      });
      lastPaint = time;
    }
    asciiTimer = requestAnimationFrame(paint);
  };
  asciiTimer = requestAnimationFrame(paint);
}

function asciiFrame(tick, seed, columns, rowCount) {
  const chars = "  ..,:;+=xX#%@";
  const rows = [];
  for (let y = 0; y < rowCount; y += 1) {
    let row = "";
    for (let x = 0; x < columns; x += 1) {
      const nx = ((x / Math.max(1, columns - 1)) - 0.5) * 2.35;
      const ny = ((y / Math.max(1, rowCount - 1)) - 0.5) * 1.65;
      const angle = Math.atan2(ny, nx);
      const radius = Math.hypot(nx, ny);
      const breathe = Math.sin(tick * 0.72 + seed) * 0.025;
      const petals = 0.61 + breathe
        + Math.sin(angle * 5 + tick * 0.34 + seed * 0.8) * 0.13
        + Math.sin(angle * 9 - tick * 0.21) * 0.035;
      const silhouette = (petals - radius) * 5.6;
      const contour = Math.sin(radius * 34 - tick * 2.1 + Math.sin(angle * 3) * 1.8) * 0.2;
      const veins = Math.cos(angle * 10 + radius * 17 + tick * 0.46) * 0.12;
      const drift = Math.sin(nx * 8.4 + ny * 5.2 - tick * 1.15 + seed) * 0.1;
      const halo = Math.max(0, 0.12 - Math.abs(radius - petals)) * 2.4;
      const density = silhouette + contour + veins + drift + halo + 0.18;
      if (density < 0.08 || radius > petals + 0.1) {
        row += " ";
        continue;
      }
      const normalized = Math.max(0, Math.min(0.999, density / 1.8));
      row += chars[Math.floor(normalized * chars.length)];
    }
    rows.push(row);
  }
  return rows.join("\n");
}

function scrollMessagesToBottom() {
  const list = root.querySelector("[data-message-list]");
  if (list) list.scrollTop = list.scrollHeight;
}

function schedulePendingPolls() {
  for (const kind of ["image", "video", "audio"]) {
    for (const chat of state.chats[kind] || []) {
      for (const message of chat.messages || []) {
        if (message.taskId && ["queued", "generating"].includes(message.status)) {
          const key = `${chat.id}:${message.id}:${message.taskId}`;
          if (!pollTimers.has(key)) {
            pollTimers.set(key, window.setInterval(() => pollTask(chat.id, message.id, message.taskId, key), 3500));
            pollTask(chat.id, message.id, message.taskId, key);
          }
        }
      }
    }
  }
}

function syncCanvasNode(messageId, message) {
  if (!messageId || !message) return;
  let changed = false;
  for (const project of state.canvasProjects || []) {
    for (const node of project.nodes || []) {
      if (node.messageId !== messageId) continue;
      if (message.result?.url) {
        node.result = message.result;
        node.outputAssetId = message.result.assetId || node.outputAssetId;
        node.status = "success";
        node.error = "";
      } else {
        node.status = message.status;
        node.error = message.error || "";
      }
      changed = true;
    }
  }
  if (changed && state.view === "canvas" && !root.querySelector("[data-node-prompt]:focus") && !root.querySelector("[data-c-local-prompt]:focus") && !root.querySelector("[data-c-setting]:focus") && !state.canvasResize) { render(); startAsciiNoise(); }
}

async function persistCanvasNodeResult(messageId) {
  for (const project of state.canvasProjects || []) {
    if (!(project.nodes || []).some((node) => node.messageId === messageId)) continue;
    const result = await api(`/api/canvas/projects/${encodeURIComponent(project.id)}`, { method: "PUT", body: JSON.stringify({ nodes: project.nodes, edges: project.edges || [] }) });
    applyServerState(result.state);
  }
}

async function pollTask(chatId, messageId, taskId, key) {
  try {
    const result = await api(`/api/tasks/${encodeURIComponent(taskId)}?chatId=${encodeURIComponent(chatId)}&messageId=${encodeURIComponent(messageId)}`);
    applyServerState(result.state);
    const location = findMessageLocation(chatId, messageId);
    syncCanvasNode(messageId, location?.message);
    if (location?.message?.status === "success" || location?.message?.status === "error") persistCanvasNodeResult(messageId).catch(() => {});
    const message = location?.message;
    if (!message || !["queued", "generating"].includes(message.status)) {
      clearInterval(pollTimers.get(key));
      pollTimers.delete(key);
      patchVisibleMessage(location, messageId);
      return;
    }
  } catch (error) {
    clearInterval(pollTimers.get(key));
    pollTimers.delete(key);
    showToast(error.message, "error");
  }
}

function findMessage(chatId, messageId) {
  return findMessageLocation(chatId, messageId)?.message || null;
}

function findMessageLocation(chatId, messageId) {
  for (const kind of ["image", "video", "audio"]) {
    const chat = state.chats[kind]?.find((item) => item.id === chatId);
    const message = chat?.messages.find((item) => item.id === messageId);
    if (message) return { kind, chat, message };
  }
  return null;
}

function patchVisibleMessage(location, messageId) {
  if (!location || state.view !== location.kind || state.activeChat[location.kind] !== location.chat.id) return;
  if (location.kind === "image" || location.kind === "video") {
    const article = root.querySelector(`[data-message-id="${messageId}"]`);
    if (!article) return;
    const promptMessage = promptMessageForRecord({ chat: location.chat, message: location.message });
    article.outerHTML = renderGenerationTile({ message: location.message, prompt: promptMessage?.text || "", promptMessage }, location.kind);
    const next = root.querySelector(`[data-message-id="${messageId}"]`);
    if (next) bindMessageEvents(next);
    if (next) hydrateMediaPreviewCache(next);
    bindPreviewEvents();
    startCellNoise();
    startElapsedTimers();
    return;
  }
  const article = root.querySelector(`[data-message-id="${messageId}"]`);
  if (!article) return;
  article.outerHTML = renderMessage(location.message);
  const next = root.querySelector(`[data-message-id="${messageId}"]`);
  if (next) bindMessageEvents(next);
  if (next) hydrateMediaPreviewCache(next);
  startAsciiNoise();
}


/* Canvas studio runtime: schema-driven graph surface layered over the legacy chat app. */
const CANVAS_PORTS = {
  text: { label: "Text", color: "#f2b56b" },
  image: { label: "Image", color: "#72d7b5" },
  video: { label: "Video", color: "#a98cff" },
  audio: { label: "Audio", color: "#70a9ff" },
  generic: { label: "Any", color: "#9aa1ad" }
};
const CANVAS_NODE_REGISTRY = {
  prompt: { id: "prompt", type: "Prompt", name: "Prompt", category: "Input", icon: "✦", description: "Direct text instructions", inputs: [], outputs: [{ id: "text", type: "text", label: "Prompt" }], settings: ["prompt", "negativePrompt", "template"] },
  imageInput: { id: "imageInput", type: "Image Input", name: "Image Input", category: "Input", icon: "IMG", description: "Upload or reference an image", inputs: [], outputs: [{ id: "image", type: "image", label: "Image" }] },
  videoInput: { id: "videoInput", type: "Video Input", name: "Video Input", category: "Input", icon: "VID", description: "Use a video asset", inputs: [], outputs: [{ id: "video", type: "video", label: "Video" }] },
  imageGenerator: { id: "imageGenerator", type: "Image Generator", name: "Image Generator", category: "Generation", icon: "IMG", description: "Create images with a model", inputs: [{ id: "prompt", type: "text", label: "Prompt" }, { id: "reference", type: "image", label: "Reference", multiple: true }], outputs: [{ id: "image", type: "image", label: "Generated image" }], settings: ["model", "aspectRatio", "resolution", "batch", "seed", "guidance"] },
  videoGenerator: { id: "videoGenerator", type: "Video Generator", name: "Video Generator", category: "Generation", icon: "VID", description: "Animate a prompt or image", inputs: [{ id: "prompt", type: "text", label: "Prompt" }, { id: "image", type: "image", label: "Start frame" }, { id: "video", type: "video", label: "Reference" }], outputs: [{ id: "video", type: "video", label: "Generated video" }], settings: ["model", "duration", "aspectRatio", "resolution", "sound", "seed"] },
  imageEdit: { id: "imageEdit", type: "Image Edit", name: "Image Edit", category: "Generation", icon: "EDIT", description: "Transform an existing image", inputs: [{ id: "image", type: "image", label: "Image" }, { id: "prompt", type: "text", label: "Instruction" }], outputs: [{ id: "image", type: "image", label: "Edited image" }], settings: ["model", "prompt"] },
  combine: { id: "combine", type: "Prompt Combine", name: "Prompt Combine", category: "Utility", icon: "∑", description: "Merge text inputs", inputs: [{ id: "a", type: "text", label: "Text A" }, { id: "b", type: "text", label: "Text B" }], outputs: [{ id: "text", type: "text", label: "Combined" }] },
  output: { id: "output", type: "Output", name: "Output", category: "Output", icon: "OUT", description: "Preview a final result", inputs: [{ id: "media", type: "generic", label: "Result" }], outputs: [] }
};
const CANVAS_LIBRARY_ORDER = ["prompt", "imageInput", "videoInput", "imageGenerator", "videoGenerator", "imageEdit", "combine", "output"];
const canvasHistory = new Map();
let canvasSaveTimer = null;
let canvasLastSaved = 0;
function canvasDefinition(node) { return CANVAS_NODE_REGISTRY[node?.registryId] || CANVAS_NODE_REGISTRY[Object.values(CANVAS_NODE_REGISTRY).find((item) => item.type === node?.type)?.id] || CANVAS_NODE_REGISTRY.output; }
function canvasNodeDataType(node) { return canvasDefinition(node).outputs[0]?.type || "generic"; }
function canvasCompatible(sourceType, targetType) { return sourceType === targetType || sourceType === "generic" || targetType === "generic"; }
function canvasModelFor(node) { const kind = node?.registryId === "videoGenerator" ? "video" : "image"; const list = kind === "video" ? videoModelRegistry : imageModelRegistry; return list.find((item) => item.id === node.modelId) || list[0]; }
function canvasDefaultNode(registryId, x = 180, y = 160) {
  const def = CANVAS_NODE_REGISTRY[registryId] || CANVAS_NODE_REGISTRY.prompt;
  const model = registryId === "videoGenerator" ? videoModelRegistry[0] : imageModelRegistry[0];
  return { id: `node_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, registryId, type: def.type, group: def.category, x, y, width: registryId === "prompt" ? 270 : 250, status: "idle", executionState: "idle", dirty: false, refs: [], prompt: registryId === "prompt" ? "A cinematic portrait in soft morning light" : "", options: { model: model?.id, aspectRatio: registryId === "videoGenerator" ? "16:9" : "1:1", resolution: registryId === "videoGenerator" ? "720p" : "2K", duration: 5, batch: 1 }, ports: def.inputs.concat(def.outputs) };
}
function canvasSave(project, immediate = false) {
  if (!project?.id) return;
  clearTimeout(canvasSaveTimer);
  const save = async () => { try { await saveCanvasProject(project); canvasLastSaved = Date.now(); if (state.view === "canvas") render(); } catch (error) { showToast("Canvas could not be saved", "error"); } };
  if (immediate) save(); else canvasSaveTimer = setTimeout(save, 450);
}
function canvasPushHistory(project) {
  const key = project?.id; if (!key) return;
  const item = JSON.stringify({ nodes: project.nodes || [], edges: project.edges || [] });
  const history = canvasHistory.get(key) || { past: [], future: [], last: "" };
  if (history.last !== item) { history.past.push(history.last || item); history.past = history.past.slice(-40); history.future = []; history.last = item; canvasHistory.set(key, history); }
}
function canvasUndoRedo(project, direction) {
  const history = canvasHistory.get(project?.id); if (!history) return;
  const from = direction === "undo" ? history.past : history.future; const to = direction === "undo" ? history.future : history.past;
  const snapshot = from.pop(); if (!snapshot) return; to.push(JSON.stringify({ nodes: project.nodes || [], edges: project.edges || [] })); const next = JSON.parse(snapshot); project.nodes = next.nodes; project.edges = next.edges; history.last = snapshot; state.selectedCanvasNode = ""; canvasSave(project, true); render();
}
function canvasPortMarkup(node, port, side) { const meta = CANVAS_PORTS[port.type] || CANVAS_PORTS.generic; return `<button class="canvas-port ${side}" data-port-node="${h(node.id)}" data-port-id="${h(port.id)}" data-port-type="${h(port.type)}" title="${h(`${side === "in" ? "Input" : "Output"}: ${port.label} (${meta.label})`)}" style="--port-color:${meta.color}"><span>${h(port.label)}</span></button>`; }
function renderCanvasNode(node) {
  const def = canvasDefinition(node); const model = canvasModelFor(node); const running = ["queued", "running", "streaming", "generating"].includes(node.status); const media = node.result?.url ? renderMedia(node.result.url, node.result.type || (def.id.includes("video") ? "video" : "image"), `canvas-${node.id}`) : "";
  const body = def.id === "prompt" ? `<textarea data-node-prompt="${h(node.id)}" placeholder="Describe the scene...">${h(node.prompt || "")}</textarea><div class="node-meta"><span>${(node.prompt || "").length}/2000</span><kbd>⌘ ↵</kbd></div>` : def.id === "imageInput" || def.id === "videoInput" ? `<div class="node-dropzone" data-node-upload="${h(node.id)}">${icon("download", 17)}<span>${node.assetId ? "Asset selected" : "Drop media or choose from Library"}</span></div>` : media ? `<div class="canvas-media" data-preview-node="${h(node.id)}">${media}</div>` : def.id === "combine" ? `<div class="node-mini-note">Combine connected text inputs</div>` : `<div class="node-empty-state"><span>${running ? "Working on your generation" : "Ready to generate"}</span></div>`;
  const basic = def.id === "prompt" || def.id === "combine" || def.id === "output" ? "" : `<div class="node-setting-row"><span>${def.id === "videoGenerator" ? "Model" : "Model"}</span><b>${h(model?.label || "Choose model")}</b></div>`;
  return `<article class="flow-node studio-node ${node.selected ? "selected" : ""} ${running ? "is-running" : ""} ${node.dirty ? "is-dirty" : ""} ${node.status === "error" ? "is-error" : ""}" data-flow-node="${h(node.id)}" style="left:${Number(node.x) || 80}px;top:${Number(node.y) || 80}px;width:${Number(node.width) || 250}px"><div class="node-port-stack input-stack">${def.inputs.map((port) => canvasPortMarkup(node, port, "in")).join("")}</div><header class="studio-node-header"><div class="node-kind"><i>${h(def.icon)}</i><span>${h(def.category)}</span></div><span class="node-status">${running ? "RUNNING" : node.dirty ? "OUTDATED" : node.status === "success" ? "READY" : "IDLE"}</span><button class="node-menu" data-node-menu="${h(node.id)}" title="Node menu">•••</button></header><div class="studio-node-title"><b>${h(def.name)}</b><small>${h(model?.label || def.description)}</small></div>${body}${basic}<footer class="studio-node-footer"><button class="node-run-button" data-run-node="${h(node.id)}" ${running ? "disabled" : ""}>${running ? "Running" : def.category === "Input" ? "Configure" : "Run"}</button><span>${node.result ? "Output ready" : def.description}</span></footer><div class="node-port-stack output-stack">${def.outputs.map((port) => canvasPortMarkup(node, port, "out")).join("")}</div></article>`;
}
function renderCanvasEdgesStudio(project) { const nodes = new Map((project?.nodes || []).map((node) => [node.id, node])); return (project?.edges || []).map((edge) => { const a = nodes.get(edge.source), b = nodes.get(edge.target); if (!a || !b) return ""; const x1 = Number(a.x) + Number(a.width || 250), y1 = Number(a.y) + 75, x2 = Number(b.x), y2 = Number(b.y) + 75; const color = CANVAS_PORTS[edge.dataType]?.color || CANVAS_PORTS.generic.color; return `<path class="studio-edge" d="M ${x1} ${y1} C ${x1 + 90} ${y1}, ${x2 - 90} ${y2}, ${x2} ${y2}" stroke="${color}" data-edge="${h(edge.id)}"/><circle cx="${x1}" cy="${y1}" r="3" fill="${color}"/><circle cx="${x2}" cy="${y2}" r="3" fill="${color}"/>`; }).join(""); }
function renderCanvasLibrary() { return `<aside class="canvas-library"><div class="library-kicker">BUILD WORKFLOW</div><div class="canvas-library-search"><span>${icon("sparkles", 14)}</span><input type="search" placeholder="Search nodes" data-node-library-search /></div>${["Input", "Generation", "Utility", "Output"].map((category) => `<section><h4>${category}</h4>${CANVAS_LIBRARY_ORDER.filter((id) => CANVAS_NODE_REGISTRY[id].category === category).map((id) => { const item = CANVAS_NODE_REGISTRY[id]; return `<button class="library-node-item" draggable="true" data-library-node="${id}" data-library-search-value="${h(`${item.name} ${item.description}`.toLowerCase())}"><i>${h(item.icon)}</i><span><b>${h(item.name)}</b><small>${h(item.description)}</small></span><em>+</em></button>`; }).join("")}</section>`).join("")}<div class="library-tip"><b>Fast canvas</b><span>Drag from a handle to connect. Hold Space to pan.</span></div></aside>`; }
function renderCanvasInspectorStudio(project) { const node = (project?.nodes || []).find((item) => item.id === state.selectedCanvasNode); if (!node) return `<aside class="canvas-inspector studio-inspector empty"><span>Select a node</span><small>Settings and execution details appear here</small></aside>`; const def = canvasDefinition(node); const model = canvasModelFor(node); const options = node.options || {}; const models = def.id === "videoGenerator" ? videoModelRegistry : imageModelRegistry; return `<aside class="canvas-inspector studio-inspector"><header><div><span>INSPECTOR</span><b>${h(def.name)}</b></div><button data-close-inspector title="Close inspector">${icon("close", 14)}</button></header><div class="inspector-state"><i class="status-dot ${node.status || "idle"}"></i><span>${node.dirty ? "Needs regeneration" : node.status || "idle"}</span><small>${node.result ? "Output cached" : "No output yet"}</small></div>${def.settings?.includes("model") ? `<label>Model<select data-inspector-option="model">${models.map((item) => `<option value="${h(item.id)}" ${item.id === node.modelId || item.id === options.model ? "selected" : ""}>${h(item.label)}</option>`).join("")}</select></label>` : ""}${def.settings?.includes("prompt") || def.id === "prompt" ? `<label>Prompt<textarea data-inspector-option="prompt">${h(node.prompt || "")}</textarea></label><label>Negative prompt<textarea data-inspector-option="negativePrompt">${h(options.negativePrompt || "")}</textarea></label>` : ""}<div class="inspector-section"><span>BASIC</span>${def.id.includes("Generator") ? `<label>Aspect ratio<select data-inspector-option="aspectRatio">${(def.id === "videoGenerator" ? WIDE_RATIOS : IMAGE_RATIOS).map(([value, label]) => `<option value="${h(value)}" ${options.aspectRatio === value ? "selected" : ""}>${h(label)}</option>`).join("")}</select></label><label>Resolution<select data-inspector-option="resolution"><option>Auto</option><option ${options.resolution === "720p" ? "selected" : ""}>720p</option><option ${options.resolution === "1080p" ? "selected" : ""}>1080p</option><option ${options.resolution === "2K" ? "selected" : ""}>2K</option></select></label>` : ""}</div><details class="inspector-advanced"><summary>ADVANCED <span>⌄</span></summary><label>Seed<input type="number" data-inspector-option="seed" value="${h(options.seed || "")}" placeholder="Random" /></label>${def.id === "videoGenerator" ? `<label>Duration<input type="number" min="1" max="30" data-inspector-option="duration" value="${h(options.duration || 5)}" /></label><label class="check-row"><input type="checkbox" data-inspector-option="sound" ${options.sound ? "checked" : ""}/> Generate audio</label>` : `<label>Guidance<input type="range" min="1" max="20" step="1" data-inspector-option="guidance" value="${h(options.guidance || 7)}" /></label>`}</details><button class="inspector-run" data-inspector-run>${node.status === "error" ? "Retry generation" : "Run node"}</button></aside>`; }
function legacyOldRenderCanvas2() { return `<section class="canvas-page studio-canvas-page"><div class="studio-canvas-layout">${renderCanvasLibrary()}<div class="canvas-workspace studio-workspace"><header class="canvas-toolbar studio-toolbar"><div class="canvas-title"><span class="eyebrow">CREATIVE GRAPH</span><b>${h(project?.name || "Untitled flow")}</b><small>${nodes.length} nodes <i class="save-state">${canvasLastSaved ? "Saved" : "Local changes"}</i></small></div><div class="canvas-toolbar-actions"><button data-add-studio-node="prompt">+ Add node</button><button data-canvas-undo title="Undo">↶</button><button data-canvas-redo title="Redo">↷</button><button data-canvas-fit>Fit</button><button data-canvas-zoom-out>−</button><output data-canvas-zoom>${Math.round(state.canvasZoom * 100)}%</output><button data-canvas-zoom-in>+</button><button class="canvas-run" data-run-flow>Run workflow <span>⌘↵</span></button></div></header><div class="studio-viewport" data-canvas-stage style="--canvas-zoom:${state.canvasZoom}"><div class="studio-world" style="width:3000px;height:2000px"><svg class="canvas-edges studio-edges" aria-hidden="true">${renderCanvasEdgesStudio(project)}</svg>${nodes.map(renderCanvasNode).join("")}${!nodes.length ? `<div class="studio-onboarding"><div class="onboarding-mark">✦</div><h2>Build your first workflow</h2><p>Start with a prompt, then connect a generator.</p><div><button data-add-studio-node="prompt">Add Prompt</button><button data-add-studio-node="imageInput">Add Image</button><button data-add-studio-node="imageGenerator">Add Image Generator</button></div><small>Drag nodes to connect them · Space + drag to pan</small></div>` : ""}${state.canvasMenu ? renderNodePicker() : ""}</div><div class="canvas-zoom-badge">${Math.round(state.canvasZoom * 100)}%</div></div></div>${renderCanvasInspectorStudio(project)}</div></section>`; }
function legacyRenderNodePicker() { return `<div class="node-picker studio-picker" style="left:${state.canvasMenu.x}px;top:${state.canvasMenu.y}px" data-node-picker><div class="picker-head"><b>Add node</b><kbd>esc</kbd></div><input type="search" placeholder="Search nodes" data-node-search autofocus /><div class="node-catalog">${CANVAS_LIBRARY_ORDER.map((id) => { const item = CANVAS_NODE_REGISTRY[id]; return `<button data-create-node="${id}" data-node-model="" data-node-group="${item.category}" data-search-value="${h(`${item.name} ${item.description}`.toLowerCase())}"><i class="catalog-mark">${h(item.icon)}</i><span><b>${h(item.name)}</b><small>${h(item.description)}</small></span><em>+</em></button>`; }).join("")}</div></div>`; }

document.addEventListener("pointerdown", (event) => {
  if (event.target.closest(".theme-control,.account-theme-section")) return;
  const menu = root.querySelector("[data-theme-menu]");
  const toggle = root.querySelector("[data-theme-toggle]");
  if (menu) menu.hidden = true;
  toggle?.setAttribute("aria-expanded", "false");
});

themeMedia.addEventListener("change", () => {
  if (state.themeMode === "system") applyTheme("system", { persist: false });
});

applyTheme(state.themeMode, { persist: false });

window.__connxnCanvasState = state;
window.__connxnCanvasRoot = root;
window.__canvasApi = api;
window.__markCanvasProjectDirty = markCanvasProjectDirty;
window.__markCanvasProjectClean = markCanvasProjectClean;
window.__canvasVideoModels = videoModelRegistry;
window.__canvasImageModels = imageModelRegistry;
window.__modelIcon = modelIcon;
window.__canvasMedia = renderMedia;
window.__canvasAssetMedia = renderAssetMedia;
window.__canvasToast = showToast;
window.__openMediaPreview = openDirectPreview;
window.__mediaDownloadHref = mediaDownloadHref;
window.__importCanvasWorkflowFile = importCanvasWorkflowFile;
window.__estimateKieCredits = estimateKieCredits;
window.__canvasRunEstimate = canvasRunEstimate;
window.__pricingBubble = pricingBubble;
window.__formatCredits = formatCredits;

init();
