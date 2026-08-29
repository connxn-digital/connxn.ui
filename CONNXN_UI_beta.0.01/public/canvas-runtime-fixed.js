/* Stable Canvas runtime. Structural renders are explicit; typing, preview, drag and marquee stay local. */
(() => {
  const state = () => window.__connxnCanvasState;
  const root = () => window.__connxnCanvasRoot;
  const registry = {
    prompt: { name: "Text / Prompt", category: "Input", icon: "Aa", color: "violet", outputs: [{ id: "text", name: "Prompt", type: "text" }] },
    imageInput: { name: "Image Input", category: "Input", icon: "IMG", color: "cyan", outputs: [{ id: "image", name: "Image", type: "image" }] },
    videoInput: { name: "Video Input", category: "Input", icon: "VID", color: "orange", outputs: [{ id: "video", name: "Video", type: "video" }] },
    audioInput: { name: "Audio Input", category: "Input", icon: "AUD", color: "green", outputs: [{ id: "audio", name: "Audio", type: "audio" }] },
    promptCombine: { name: "Prompt Combine", category: "Utility", icon: "+", color: "violet", inputs: [{ id: "a", name: "Prompt A", type: "text" }, { id: "b", name: "Prompt B", type: "text" }], outputs: [{ id: "text", name: "Combined", type: "text" }] },
    imageGenerator: { name: "Image Generator", category: "Generation", icon: "IMG", color: "blue", modelKind: "image", inputs: [{ id: "prompt", name: "Prompt", type: "text" }, { id: "reference", name: "Reference", type: "image", multiple: true }], outputs: [{ id: "image", name: "Image", type: "image" }] },
    videoGenerator: { name: "Video Generator", category: "Generation", icon: "VID", color: "orange", modelKind: "video", inputs: [{ id: "prompt", name: "Prompt", type: "text" }, { id: "start", name: "Start frame", type: "image" }, { id: "end", name: "End frame", type: "image" }, { id: "reference", name: "Image refs", type: "image", multiple: true }, { id: "video", name: "Video refs", type: "video", multiple: true }, { id: "audio", name: "Audio", type: "audio", multiple: true }], outputs: [{ id: "video", name: "Video", type: "video" }] },
    imageEdit: { name: "Image Edit", category: "Generation", icon: "EDIT", color: "blue", modelKind: "image", inputs: [{ id: "prompt", name: "Prompt", type: "text" }, { id: "image", name: "Image", type: "image" }, { id: "reference", name: "References", type: "image", multiple: true }], outputs: [{ id: "image", name: "Image", type: "image" }] },
    resize: { name: "Resize", category: "Utility", icon: "↔", color: "gray", defaults: { width: "1024", height: "", fit: "contain" }, inputs: [{ id: "media", name: "Media", type: "generic" }], outputs: [{ id: "media", name: "Media", type: "generic" }] },
    trim: { name: "Trim", category: "Utility", icon: "≋", color: "orange", defaults: { start: "0", end: "5" }, inputs: [{ id: "video", name: "Video", type: "video" }], outputs: [{ id: "video", name: "Trimmed", type: "video" }] },
    extractFrame: { name: "Extract Frame", category: "Utility", icon: "▣", color: "cyan", defaults: { frame: "first" }, inputs: [{ id: "video", name: "Video", type: "video" }], outputs: [{ id: "image", name: "Frame", type: "image" }] },
    reference: { name: "Reference", category: "Utility", icon: "REF", color: "cyan", inputs: [{ id: "media", name: "Media", type: "generic" }], outputs: [{ id: "media", name: "Media", type: "generic" }] }
  };
  const aliases = { Prompt: "prompt", Asset: "imageInput", Crop: "reference", Rotate: "reference", Flip: "reference", Trim: "trim", Compare: "reference" };
  const portColors = { text: "var(--port-text)", image: "var(--port-image)", video: "var(--port-video)", audio: "var(--port-audio)", generic: "var(--port-generic)" };
  let mode = "idle", operation = null, saveTimer = 0, renderQueued = false, bound = false, addOffset = 0, spaceDown = false, lastCanvasTap = null, lastPointerWorld = null, rafPending = false, edgeUpdateIds = null, lastMenuOpen = 0, utilityPreviewRaf = 0, reactiveHydrateQueued = false, canvasClipboard = null, edgeMenuHideTimer = 0;
  const activeRuns = new Set();
  const activeWorkflows = new Set();
  const recoveryRuns = new Set();
  let history = [], future = [];

  const esc = (v) => String(v ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
  const canonicalSearch = (value) => String(value || "").toLowerCase().normalize("NFKD").replace(/[._/+-]+/g, " ").replace(/[^a-z0-9\s]+/g, " ").replace(/\s+/g, " ").trim();
  const searchHaystack = (value) => {
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
  };
  const searchNeedles = (value) => {
    const base = canonicalSearch(value);
    if (!base) return [""];
    return [...new Set([
      base,
      canonicalSearch(base.replace(/\bgp\b/g, "gpt image").replace(/\bgpi\b/g, "gpt image")),
      canonicalSearch(base.replace(/\bsee\b/g, "seedance").replace(/\bsd\b/g, "seedance").replace(/\bseed\b/g, "seedance"))
    ].filter(Boolean))];
  };
  const smartSearchMatch = (query, value) => {
    const q = canonicalSearch(query);
    if (!q) return true;
    const haystack = searchHaystack(value);
    return searchNeedles(q).some((needle) => haystack.includes(needle) || needle.split(" ").every((token) => haystack.includes(token)));
  };
  const project = () => { const s = state(); return (s.canvasProjects || []).find((p) => p.id === s.activeCanvasProject) || s.canvasProjects?.[0]; };
  const def = (n) => registry[n.type] || registry.reference;
  const kind = (n) => n?.result?.type || def(n).modelKind || (n.type === "videoInput" || n.type === "trim" ? "video" : n.type === "audioInput" ? "audio" : n.type === "imageInput" || n.type === "extractFrame" ? "image" : "generic");
  const models = (k) => k === "video" ? window.__canvasVideoModels || [] : window.__canvasImageModels || [];
  const model = (n) => def(n).modelKind ? models(kind(n)).find((m) => m.id === n.modelId) || models(kind(n))[0] : null;
  const modelGlyph = (m, type = "") => {
    const key = `${m?.family || ""} ${m?.label || ""} ${m?.id || ""}`.toLowerCase();
    if (key.includes("banana")) return "◐";
    if (key.includes("gpt") || key.includes("openai")) return "✦";
    if (key.includes("flux")) return "◆";
    if (key.includes("seed")) return "✺";
    if (key.includes("kling")) return "⌁";
    if (key.includes("wan")) return "◈";
    if (key.includes("grok")) return "×";
    if (key.includes("gemini") || key.includes("imagen")) return "◇";
    if (key.includes("hailuo")) return "◎";
    return type === "video" ? "▷" : "✧";
  };
  const abstractKey = (type = "") => type === "video" || type === "videoInput" || type === "videoGenerator" || type === "trim" ? "video" : type === "audio" || type === "audioInput" ? "audio" : type === "image" || type === "imageInput" || type === "imageGenerator" || type === "imageEdit" || type === "crop" || type === "extractFrame" ? "spark" : type === "prompt" || type === "text" ? "copy" : "canvas";
  const abstractIcon = (key) => {
    const asset = ({ prompt: "copy", text: "copy", image: "spark", generator: "spark" })[key] || key;
    return `<span class="c-abstract-icon" style="--abstract-icon:url('/abstract-logo/${esc(asset)}.png')"></span>`;
  };
  const modelIconHtml = (m, k, size = 24) => window.__modelIcon?.(m, k, size) || abstractIcon(abstractKey(k));
  const ratioValue = (value) => {
    const match = String(value || "").match(/^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/);
    return match ? `${match[1]} / ${match[2]}` : "16 / 9";
  };
  const swappedRatio = (ratio) => {
    const match = String(ratio || "").match(/^\s*(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)\s*$/);
    return match ? `${match[2]} / ${match[1]}` : ratio;
  };
  const nodeRatio = (n, asset = null) => {
    let ratio = asset?.width && asset?.height ? `${asset.width} / ${asset.height}`
      : n.settings?.aspectRatio && n.settings.aspectRatio !== "auto" ? ratioValue(n.settings.aspectRatio)
      : kind(n) === "video" ? "16 / 9"
      : "1 / 1";
    return ratio;
  };
  const nodeSubtitle = (n, d, m) => d.modelKind ? m?.label || d.category : d.category;
  const nodeIcon = (n, d, m) => {
    const type = d.modelKind || kind(n);
    return `<div class="c-node-icon c-node-icon-${esc(type)}" title="${esc(d.name)}"><i></i>${d.modelKind && m ? modelIconHtml(m, d.modelKind, 30) : abstractIcon(abstractKey(type || n.type))}</div>`;
  };
  const option = (value, label, selected) => `<option value="${esc(value)}" ${String(value) === String(selected) ? "selected" : ""}>${esc(label ?? value)}</option>`;
  const fieldClass = (key, extra = "") => `c-field c-field-${String(key || "").replace(/[^a-z0-9_-]+/gi, "-")} ${extra}`.trim();
  const selectField = (key, label, items, value) => `<label class="${fieldClass(key)}"><span>${esc(label)}</span><select data-c-setting="${esc(key)}">${items.map((item) => Array.isArray(item) ? option(item[0], item[1], value) : option(item, item, value)).join("")}</select></label>`;
  const durationRangeItems = (range = {}) => {
    const min = Number.isFinite(Number(range.min)) ? Number(range.min) : 1;
    const max = Number.isFinite(Number(range.max)) ? Number(range.max) : min;
    const step = Math.max(1, Number(range.step || 1));
    const items = [];
    for (let value = min; value <= max; value += step) items.push([String(value), `${value}s`]);
    return items;
  };
  const rangeField = (key, label, items, value) => {
    const list = (items || []).map((item) => Array.isArray(item) ? [String(item[0]), String(item[1] ?? item[0])] : [String(item), String(item)]);
    if (!list.length) return "";
    const index = Math.max(0, list.findIndex(([itemValue]) => String(itemValue) === String(value)));
    const selected = list[index] || list[0];
    return `<label class="${fieldClass(key, "c-range-field")}"><span>${esc(label)} <b data-c-range-output="${esc(key)}">${esc(selected[1])}</b></span><input type="range" min="0" max="${Math.max(0, list.length - 1)}" step="1" value="${index}" data-c-setting="${esc(key)}" data-c-range-values="${esc(JSON.stringify(list))}" style="--range-progress:${list.length > 1 ? (index / (list.length - 1)) * 100 : 0}%"/><small><i>${esc(list[0][1])}</i><i>${esc(list[list.length - 1][1])}</i></small></label>`;
  };
  const toggleField = (key, label, checked) => `<label class="${fieldClass(key, "c-field-toggle")}"><span>${esc(label)}</span><input type="checkbox" data-c-setting="${esc(key)}" ${checked ? "checked" : ""}/></label>`;
  const textField = (key, label, value, rows = 3) => `<label class="${fieldClass(key)}"><span>${esc(label)}</span><textarea data-c-setting="${esc(key)}" rows="${rows}">${esc(value || "")}</textarea></label>`;
  const numberField = (key, label, value, min = "", max = "") => `<label class="${fieldClass(key)}"><span>${esc(label)}</span><input type="number" ${min !== "" ? `min="${esc(min)}"` : ""} ${max !== "" ? `max="${esc(max)}"` : ""} data-c-setting="${esc(key)}" value="${esc(value ?? "")}"/></label>`;
  const imageRatios = (m) => m?.ratios || [["auto", "Auto"], ["1:1", "1:1"], ["16:9", "16:9"], ["9:16", "9:16"], ["4:3", "4:3"], ["3:4", "3:4"]];
  const imageResolutions = (m) => m?.noResolution ? [] : (m?.resolutions || (m?.seedream5 ? [] : [["1K", "1K"], ["2K", "2K"], ["4K", "4K"]]));
  const imageQualities = (m) => m?.noQuality ? [] : (m?.qualities || [["low", "Low"], ["medium", "Medium"], ["high", "High"]]);
  const imageFormats = (m) => m?.noFormat ? [] : (m?.outputFormats || [["png", "PNG"], ["jpg", "JPG"]]);
  function utilitySettings(n, d, s) {
    if (n.type === "resize") return [numberField("width", "Width px", s.width ?? 1024, 16, 8192), numberField("height", "Height px", s.height ?? "", 16, 8192), selectField("fit", "Fit", [["contain", "Contain"], ["cover", "Cover"], ["stretch", "Stretch"]], s.fit || "contain")].join("");
    if (n.type === "trim") return [numberField("start", "Start second", s.start ?? 0, 0), numberField("end", "End second", s.end ?? 5, 0)].join("");
    if (n.type === "extractFrame") return selectField("frame", "Frame", [["first", "First frame"], ["last", "Last frame"]], s.frame || "first");
    return `<div class="c-info-block">${(d.inputs || []).map((x) => `<div>${esc(x.name)} <i>${esc(x.type)}</i></div>`).join("") || `<div>${esc(d.name)}</div>`}</div>`;
  }
  function normalize(n, i) {
    const rawType = String(n.type || "");
    const type = rawType === "crop" || rawType === "rotate" || rawType === "flip" ? "reference" : registry[n.type] ? n.type : aliases[n.type] || (n.modelId ? (String(n.group).toLowerCase().includes("video") ? "videoGenerator" : "imageGenerator") : "reference");
    const d = registry[type];
    const minWidth = type === "videoGenerator" ? 440 : d.modelKind ? 380 : type.endsWith("Input") ? 360 : 320;
    n.type = type; n.x = Number(n.x ?? 160 + i * 40); n.y = Number(n.y ?? 160 + i * 30); n.width = Math.max(Number(n.width || minWidth), minWidth); n.settings = { ...(d.defaults || {}), ...(n.settings || {}), ...(n.options || {}) }; n.refs ||= []; n.status ||= "idle";
    if (rawType === "crop" || rawType === "rotate" || rawType === "flip") {
      n.result = null;
      n.settings = { ...(d.defaults || {}) };
      n.status = "idle";
      n.dirty = false;
      n.error = "";
    }
    return n;
  }
  function normalizeProject(p) {
    if (!p) return p;
    p.nodes = (p.nodes || []).map(normalize);
    p.edges = (p.edges || []).map((e, i) => {
      const sourceNodeId = e.sourceNodeId || e.source;
      const targetNodeId = e.targetNodeId || e.target;
      const sourcePortId = e.sourcePortId || e.sourceHandle || "text";
      const targetPortId = e.targetPortId || e.targetHandle || "media";
      const sourceType = e.sourceType || e.dataType || "generic";
      const targetType = e.targetType || e.dataType || "generic";
      return { id: e.id || `edge_${i}`, sourceNodeId, sourcePortId, sourceType, targetNodeId, targetPortId, targetType, dataType: sourceType || e.dataType || "generic" };
    });
    p.viewport ||= { x: 0, y: 0, zoom: 1 };
    return p;
  }
  function snapshot(p) { return JSON.stringify({ nodes: p.nodes, edges: p.edges, viewport: p.viewport }); }
  function commit(p, fn) { history.push(snapshot(p)); if (history.length > 40) history.shift(); future = []; fn(); persist(p); }
  function restoreSnapshot(raw) { const p = project(); if (!p || !raw) return false; const next = JSON.parse(raw); p.nodes = next.nodes || []; p.edges = next.edges || []; p.viewport = next.viewport || { x: 0, y: 0, zoom: 1 }; state().selectedNodeIds = []; state().selectedCanvasNode = ""; persist(p); structural(); return true; }
  function undo() { const p = project(); if (!p || !history.length) return; future.push(snapshot(p)); restoreSnapshot(history.pop()); }
  function redo() { const p = project(); if (!p || !future.length) return; history.push(snapshot(p)); restoreSnapshot(future.pop()); }
  function finishMutation(before) { const p = project(); if (!p || !before || before === snapshot(p)) return false; history.push(before); if (history.length > 40) history.shift(); future = []; persist(p); return true; }
  function persist(p) { clearTimeout(saveTimer); const touched = Date.now(); window.__markCanvasProjectDirty?.(p?.id, touched); state().canvasSaveState = "saving"; saveTimer = setTimeout(async () => { try { await window.__canvasApi(`/api/canvas/projects/${encodeURIComponent(p.id)}`, { method: "PUT", body: JSON.stringify({ nodes: p.nodes, edges: p.edges, viewport: p.viewport }) }); state().canvasSaveState = "saved"; window.__markCanvasProjectClean?.(p.id, touched); } catch { state().canvasSaveState = "error"; } }, 180); }
  function structural() { if (renderQueued) return; renderQueued = true; queueMicrotask(() => { renderQueued = false; window.render(); }); }
  function selectedIds() { const s = state(); s.selectedNodeIds ||= s.selectedCanvasNode ? [s.selectedCanvasNode] : []; return s.selectedNodeIds; }
  function select(id, additive = false) { const s = state(), ids = selectedIds(); s.selectedNodeIds = additive ? [...new Set([...ids, id])] : [id]; s.selectedCanvasNode = s.selectedNodeIds[0] || ""; root().querySelectorAll(".c-node[data-c-node-id]").forEach((el) => el.classList.toggle("selected", s.selectedNodeIds.includes(el.dataset.cNodeId))); const p = project(), panel = root().querySelector(".c-inspector"), bar = root().querySelector("[data-c-action-bar]"); if (panel && p) panel.outerHTML = inspector(p); if (bar && p) { const next = actionBar(p); if (next) bar.outerHTML = next; else bar.remove(); } else if (p) structural(); }
  function selectedPayload(p, ids = selectedIds()) {
    const keep = new Set(ids);
    const nodes = (p?.nodes || []).filter((n) => keep.has(n.id)).map((n) => JSON.parse(JSON.stringify(n)));
    const edges = (p?.edges || []).filter((e) => keep.has(e.sourceNodeId) && keep.has(e.targetNodeId)).map((e) => JSON.parse(JSON.stringify(e)));
    return nodes.length ? { type: "connxn.canvas.nodes", version: 1, nodes, edges } : null;
  }
  function pastePoint(offset = { x: 36, y: 36 }) {
    const p = project(), stage = root().querySelector("[data-c-stage]");
    if (lastPointerWorld) return { x: lastPointerWorld.x + offset.x, y: lastPointerWorld.y + offset.y };
    if (!stage || !p?.viewport) return { x: 180 + offset.x, y: 140 + offset.y };
    const r = stage.getBoundingClientRect();
    return { x: (r.width / 2 - p.viewport.x) / p.viewport.zoom + offset.x, y: (r.height / 2 - p.viewport.y) / p.viewport.zoom + offset.y };
  }
  function pasteNodes(payload, pos = pastePoint()) {
    const p = project();
    if (!p || !payload?.nodes?.length) return [];
    const minX = Math.min(...payload.nodes.map((n) => Number(n.x || 0)));
    const minY = Math.min(...payload.nodes.map((n) => Number(n.y || 0)));
    const idMap = new Map();
    const clones = payload.nodes.map((node) => {
      const clone = JSON.parse(JSON.stringify(node));
      const id = `node_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      idMap.set(node.id, id);
      clone.id = id;
      clone.x = Math.round(pos.x + Number(node.x || 0) - minX);
      clone.y = Math.round(pos.y + Number(node.y || 0) - minY);
      clone.taskId = "";
      clone.messageId = "";
      clone.dirty = Boolean(def(clone).modelKind && clone.result?.url);
      return normalize(clone, (p.nodes || []).length);
    });
    const edges = (payload.edges || []).filter((edge) => idMap.has(edge.sourceNodeId) && idMap.has(edge.targetNodeId)).map((edge) => ({ ...JSON.parse(JSON.stringify(edge)), id: `edge_${Date.now()}_${Math.random().toString(36).slice(2)}`, sourceNodeId: idMap.get(edge.sourceNodeId), targetNodeId: idMap.get(edge.targetNodeId) }));
    commit(p, () => { p.nodes.push(...clones); p.edges.push(...edges); });
    state().selectedNodeIds = clones.map((n) => n.id);
    state().selectedCanvasNode = state().selectedNodeIds[0] || "";
    structural();
    return state().selectedNodeIds;
  }
  function copySelection() {
    const payload = selectedPayload(project());
    if (!payload) return false;
    canvasClipboard = payload;
    navigator.clipboard?.writeText?.(`connxn-canvas:${JSON.stringify(payload)}`).catch(() => {});
    window.__canvasToast?.("Copied nodes", "success");
    return true;
  }
  function duplicateSelection(offset = { x: 36, y: 36 }) {
    const payload = selectedPayload(project());
    if (!payload) return [];
    const minX = Math.min(...payload.nodes.map((n) => Number(n.x || 0)));
    const minY = Math.min(...payload.nodes.map((n) => Number(n.y || 0)));
    return pasteNodes(payload, { x: minX + offset.x, y: minY + offset.y });
  }
  function fileToDataUrl(file) {
    return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(reader.error); reader.readAsDataURL(file); });
  }
  async function createAssetNodeFromFile(file, pos = pastePoint({ x: 0, y: 0 })) {
    if (!file?.type?.startsWith("image/")) return null;
    const label = file.name || `clipboard-image-${Date.now()}.png`;
    const asset = await window.__canvasApi("/api/assets", { method: "POST", body: JSON.stringify({ dataUrl: await fileToDataUrl(file), fileName: label, mimeType: file.type || "image/png", label, role: "reference" }) });
    state().assets = asset.state?.assets || state().assets;
    return add("imageInput", pos, { exact: true, assetId: asset.asset.id });
  }
  function tryParseClipboardPayload(text) {
    const raw = String(text || "").trim();
    if (!raw.startsWith("connxn-canvas:")) return null;
    try {
      const payload = JSON.parse(raw.slice("connxn-canvas:".length));
      return payload?.type === "connxn.canvas.nodes" ? payload : null;
    } catch {
      return null;
    }
  }
  async function pasteCanvasEvent(e) {
    if (state().view !== "canvas") return;
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName) || document.activeElement?.isContentEditable;
    if (typing) return;
    const files = [...(e.clipboardData?.files || [])].filter((file) => file.type.startsWith("image/"));
    if (files.length) {
      e.preventDefault();
      const base = pastePoint({ x: 0, y: 0 });
      for (const [index, file] of files.entries()) await createAssetNodeFromFile(file, { x: base.x + index * 36, y: base.y + index * 36 });
      window.__canvasToast?.("Pasted image asset", "success");
      return;
    }
    const text = e.clipboardData?.getData("text/plain") || "";
    const payload = tryParseClipboardPayload(text) || (!text.trim() ? canvasClipboard : null);
    if (payload?.nodes?.length) {
      e.preventDefault();
      pasteNodes(payload);
      return;
    }
    if (text.trim()) {
      e.preventDefault();
      add("prompt", pastePoint({ x: 0, y: 0 }), { exact: true, settings: { prompt: text.trim() } });
      window.__canvasToast?.("Pasted prompt", "success");
    }
  }
  function effectivePortType(n, p, direction) {
    if (p.type !== "generic") return p.type;
    const resultType = outputResult(n)?.type || kind(n);
    return direction === "output" && ["image", "video", "text"].includes(resultType) ? resultType : "generic";
  }
  function portMeta(nodeId, portId, direction, type) { return { nodeId, portId, direction, dataType: type }; }
  function port(n, p, direction) { const dataType = effectivePortType(n, p, direction); if (p.type === "audio" || p.id === "audio" || dataType === "audio") return ""; return `<button class="c-port c-port-${direction} port-${esc(dataType)}" data-c-port-direction="${direction}" data-c-node-id="${esc(n.id)}" data-c-port-id="${esc(p.id)}" data-c-data-type="${esc(dataType)}" aria-label="${esc(p.name)} · ${esc(dataType)}"><i></i><span><b>${esc(p.name)}</b><small>${esc(dataType)}</small></span></button>`; }
  function downloadStem(n) {
    const clean = (value, fallback = "generated") => String(value || fallback).trim().replace(/[\\/:*?"<>|]+/g, "-").replace(/[^a-z0-9_\-\p{L}\p{N}]+/giu, "-").replace(/^-+|-+$/g, "") || fallback;
    const words = String(nodeText(n) || n?.settings?.prompt || "generated").trim().split(/\s+/).filter(Boolean).slice(0, 2).map((word) => clean(word, "")).filter(Boolean).join("_") || "generated";
    return `connxn_${clean(n?.modelId || kind(n) || "model", "model")}_${words}`;
  }
  function mediaTools(url, nodeId = "") { return `<div class="c-media-tools"><button type="button" data-c-open-media="${esc(url)}" title="Open media">⛶</button><button type="button" data-c-download-media="${esc(url)}" data-c-download-node="${esc(nodeId)}" title="Download media"><i class="download-spinner" aria-hidden="true"></i><span>↓</span></button></div>`; }
  function loaderMode() {
    const fromApp = window.__connxnLoaderMode?.();
    if (fromApp === "blurry-dream" || fromApp === "cellnoise") return fromApp;
    try {
      const prefs = JSON.parse(localStorage.getItem("connxn.uiPrefs") || "{}");
      if (prefs.loaderMode === "blurry-dream") return "blurry-dream";
    } catch {}
    return "cellnoise";
  }
  function cellNoise() { return `<canvas class="cell-noise" data-cell-noise aria-hidden="true"></canvas>`; }
  function loadingVisual() { return window.__connxnLoadingVisual?.() || (loaderMode() === "blurry-dream" ? `<div class="blurry-dream-loader" aria-hidden="true"><i></i><i></i><i></i></div>` : cellNoise()); }
  function loaderClass() { return window.__connxnLoaderClass?.() || `loader-${loaderMode()}`; }
  function transformStyle(n) {
    const ops = n.result?.operations || (n.result?.transform ? [n.result.transform] : []);
    const parts = [];
    if (parts.length) return parts.join("");
    return "";
  }
  function cropResultStyle(n) {
    const ops = n.result?.operations || (n.result?.transform ? [n.result.transform] : []);
    const crop = [...ops].reverse().find((op) => op.type === "crop");
    if (!crop || n.type === "crop") return "";
    const s = crop.settings || {};
    return `--crop-x:${Number(s.x || 0)};--crop-y:${Number(s.y || 0)};--crop-w:${Math.max(5, Number(s.width || 100))};--crop-h:${Math.max(5, Number(s.height || 100))};`;
  }
  function transformOverlay(n) {
    const t = n.result?.transform, s = t?.settings || {};
    if (!t) return "";
    if (t.type === "trim") return `<b class="c-media-badge">Trim ${esc(s.start || 0)}s → ${esc(s.end || 5)}s</b>`;
    if (t.type === "extractFrame") return `<b class="c-media-badge">${s.frame === "last" ? "Last frame" : "First frame"}</b>`;
    return "";
  }
  function mediaFrame(n) { const frame = n.result?.transform?.settings?.frame === "last" ? "last" : "first"; return `<video src="${esc(n.result.url)}" muted playsinline preload="metadata" data-c-frame-video="${frame}" aria-label="Extracted ${frame} frame"></video>`; }
  function displayResult(n) {
    if (n?.type !== "crop" && n?.result?.renderedUrl) return { ...n.result, url: n.result.renderedUrl, type: n.result.renderedType || "image", transform: null, operations: [] };
    return n?.result || null;
  }
  function previewResult(n) {
    const shown = displayResult(n);
    if (shown?.url || shown?.text) return shown;
    return isUtility(n) ? transformedResult(project(), n) : shown;
  }
  function iterations(n) {
    const list = Array.isArray(n.iterations) ? n.iterations : [];
    if (!list.length && n.result?.url) return [{ id: "current", result: n.result, createdAt: n.updatedAt || n.createdAt || Date.now() }];
    return list;
  }
  function selectedIteration(n) {
    const list = iterations(n);
    if (!list.length) return null;
    return list.find((item) => item.id === n.selectedIterationId) || list.at(-1);
  }
  function rememberIteration(n, result) {
    if (!result?.url && !result?.text) return;
    n.iterations = iterations(n).filter((item) => item.id !== "current" && item.result?.url !== result.url);
    const item = { id: `iter_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, result: { ...result }, createdAt: Date.now() };
    n.iterations.push(item);
    if (n.iterations.length > 60) n.iterations = n.iterations.slice(-60);
    n.selectedIterationId = item.id;
    n.result = item.result;
  }
  function preserveCurrentIteration(n) {
    if (!n?.result?.url && !n?.result?.text) return;
    if ((Array.isArray(n.iterations) ? n.iterations : []).some((item) => item.result?.url === n.result.url || item.result?.text === n.result.text)) return;
    rememberIteration(n, n.result);
  }
  function iterationSwitcher(n) {
    const list = iterations(n);
    if (list.length <= 1) return "";
    const selected = selectedIteration(n);
    const index = Math.max(0, list.findIndex((item) => item.id === selected?.id));
    return `<div class="c-iterations" title="Iteration ${index + 1} of ${list.length}"><button type="button" data-c-iteration-step="${esc(n.id)}" data-c-step="-1" title="Previous iteration">‹</button><b>${index + 1}<span>/</span>${list.length}</b><button type="button" data-c-iteration-step="${esc(n.id)}" data-c-step="1" title="Next iteration">›</button></div>`;
  }
  function media(n) { const running = ["queued", "running", "generating"].includes(n.status); const usedRendered = n.type !== "crop" && Boolean(n.result?.renderedUrl); const shown = previewResult(n); if (!shown?.url) return `<div class="canvas-media-empty ${running ? `is-generating ${loaderClass()}` : ""}"><span>${running ? "Generating" : n.status === "error" ? esc(n.error || "Generation failed") : "No output yet"}</span>${running ? loadingVisual() : ""}</div>`; const mediaNode = { ...n, result: shown }; const materialized = Boolean(shown.materialized || (shown.assetId && shown.sourceUrl && shown.sourceUrl !== shown.url)); const original = n.result || shown; const t = original?.transform?.type || ""; const frameLike = !materialized && shown?.type === "image" && shown?.sourceType === "video"; const raw = frameLike ? mediaFrame(mediaNode) : window.__canvasMedia(shown.url, shown.type || kind(n), n.id); const cropStyle = !materialized && !usedRendered && n.type !== "crop" ? cropResultStyle(mediaNode) : ""; const rendered = cropStyle ? `<div class="c-crop-result" style="${cropStyle}">${raw}</div>` : raw; return `<div class="c-media ${t ? `c-util-preview c-util-${esc(t)}` : ""}" data-c-fit-media style="--media-ratio:${nodeRatio(n)};${materialized || usedRendered ? "" : transformStyle(mediaNode)}">${rendered}${transformOverlay(mediaNode)}${iterationSwitcher(n)}${mediaTools(shown.url, n.id)}</div>`; }
  function assetMedia(n) { const asset = (state().assets || []).find((a) => a.id === n.assetId); const direct = n.result?.url ? { url: n.result.url, label: n.result.label || n.settings?.label || "Imported generation", mimeType: `${kind(n)}/generated` } : null; const item = asset || direct; return item ? `<div class="c-media c-asset-preview" data-c-fit-media style="--media-ratio:${nodeRatio(n, asset)}">${asset && window.__canvasAssetMedia ? window.__canvasAssetMedia(asset) : window.__canvasMedia(item.url, kind(n), n.id)}${mediaTools(item.url, n.id)}</div><small class="c-asset-name">${esc(item.label || item.slug || "Asset")}</small>` : `<div class="c-drop-copy">Drop media on canvas</div>`; }
  function combinedPromptPreview(n) {
    const text = nodeText(n);
    return `<div class="c-node-copy c-combine-preview"><b>${text ? "Combined prompt" : "No prompt connected"}</b><pre>${esc(text || "Connect Text / Prompt nodes to Prompt A and Prompt B.")}</pre></div>`;
  }
  function card(n) {
    const d = def(n), m = model(n), selected = selectedIds().includes(n.id), inputs = (d.inputs || []).map((p) => port(n, p, "input")).join(""), outputs = (d.outputs || []).map((p) => port(n, p, "output")).join("");
    const running = ["queued", "running", "generating"].includes(n.status);
    const inputDrop = ["imageInput", "videoInput"].includes(n.type);
    const modelChooser = d.modelKind ? `<label class="c-model-chip"><i>${m ? modelIconHtml(m, d.modelKind, 16) : abstractIcon(abstractKey(d.modelKind))}</i><span>Model</span><select data-c-card-model="${esc(n.id)}">${models(d.modelKind).map((item) => option(item.id, item.label, n.modelId)).join("")}</select></label>` : "";
    const body = n.type === "prompt" ? `<textarea data-c-local-prompt="${esc(n.id)}" placeholder="Describe the scene...">${esc(n.settings.prompt || n.prompt || "")}</textarea><small class="c-counter">${String(n.settings.prompt || n.prompt || "").length} / 2000</small>` : n.type === "promptCombine" ? combinedPromptPreview(n) : d.modelKind ? `${media(n)}${modelChooser}` : inputDrop ? assetMedia(n) : isUtility(n) ? media(n) : n.result?.url ? media(n) : `<div class="c-node-copy">${esc(d.name)}<small>${(d.inputs || []).length} inputs · ${(d.outputs || []).length} outputs</small></div>`;
    const runIcon = n.result?.url || n.result?.text ? "↻" : "▶";
    const runLabel = n.result?.url || n.result?.text ? "Regenerate" : "Run";
    const runMenu = d.modelKind ? `<div class="c-node-run-menu"><button class="c-node-run-main" type="button" data-c-run-only="${esc(n.id)}" aria-label="${esc(runLabel)}"><span>${runIcon}</span></button><div class="c-node-popover c-pricing-menu"><button type="button" data-c-run-only="${esc(n.id)}"><span>${runIcon}</span><b>${n.result?.url || n.result?.text ? "Regenerate node" : "Run node"}</b></button><button type="button" data-c-run-from="${esc(n.id)}"><span>▶▶</span><b>${n.result?.url || n.result?.text ? "Regenerate chain" : "Run chain"}</b></button></div></div>` : "";
    const defaultPreviewHeight = n.type === "prompt" ? 250 : (d.modelKind || inputDrop ? Math.max(178, Math.round((Number(n.width || 320) - 34) * 9 / 16)) : 150);
    const storedPreviewHeight = Number(n.previewHeight || 0);
    const previewHeight = storedPreviewHeight >= 150 ? `--preview-h:${storedPreviewHeight}px;` : "";
    return `<article class="c-node ${esc(d.color)} ${selected ? "selected" : ""} ${running ? "is-generating" : ""} ${n.dirty ? "dirty" : ""}" data-c-node-id="${esc(n.id)}" style="--x:${n.x}px;--y:${n.y}px;--node-w:${n.width}px;--content-scale:${Number(n.viewScale || 1)};--preview-default-h:${defaultPreviewHeight}px;${previewHeight}"><div class="c-node-ports c-ports-in">${inputs}</div><div class="c-node-ports c-ports-out">${outputs}</div><header class="c-node-head" data-c-drag-handle>${nodeIcon(n, d, m)}<div class="c-node-heading"><b>${esc(d.name)}</b><small>${esc(nodeSubtitle(n, d, m))}</small></div><span class="c-status"><i></i>${esc(n.status || "idle")}</span><button class="c-more" type="button" data-c-show-actions="${esc(n.id)}">•••</button></header><div class="c-node-body">${body}</div><footer class="c-node-foot"><span>${n.result?.url ? "Live preview" : d.category}</span>${runMenu}</footer><button class="c-resize-handle" type="button" data-c-resize-node="${esc(n.id)}" title="Resize node preview" aria-label="Resize node preview"></button></article>`;
  }
  function actionBar(p) {
    const n = p?.nodes.find((node) => node.id === state().selectedCanvasNode);
    if (!n) return "";
    const d = def(n), v = p.viewport || { x: 0, y: 0, zoom: 1 };
    const left = Math.round(v.x + (n.x + Number(n.width || 276) / 2) * v.zoom);
    const top = Math.round(v.y + n.y * v.zoom - 46);
    const hasRun = Boolean(d.modelKind);
    return `<div class="c-action-bar" style="left:${left}px;top:${top}px" data-c-action-bar="${esc(n.id)}">${hasRun ? `<div class="c-action-group"><button type="button" data-c-run-only="${esc(n.id)}" title="Run this node">▶</button><button type="button" data-c-run-from="${esc(n.id)}" title="Run from this node">▶▶</button></div>` : ""}<button type="button" data-c-duplicate-node="${esc(n.id)}" title="Duplicate">⧉</button><button type="button" data-c-delete-node="${esc(n.id)}" title="Delete">⌫</button></div>`;
  }
  function edgeGradient(e, nodes) { const a = nodeById({ nodes }, e.sourceNodeId), b = nodeById({ nodes }, e.targetNodeId); if (!a || !b) return ""; const start = portPoint(a, e.sourcePortId || e.sourceHandle, "output"), end = portPoint(b, e.targetPortId || e.targetHandle, "input"), id = `grad_${esc(e.id)}`, c1 = portColors[e.sourceType || e.dataType] || portColors.generic, c2 = portColors[e.targetType || e.dataType] || portColors.generic; return `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${start.x}" y1="${start.y}" x2="${end.x}" y2="${end.y}" data-c-edge-gradient="${esc(e.id)}"><stop offset="0%" stop-color="${c1}"/><stop offset="100%" stop-color="${c2}"/></linearGradient>`; }
  function edgePath(e, nodes) { const d = edgeD(e, nodes); return d ? `<path class="c-edge-path edge-${esc(e.dataType)}" d="${d}" stroke="url(#grad_${esc(e.id)})" data-c-edge-id="${esc(e.id)}"/>` : ""; }
  function library() { const groups = ["Input", "Generation", "Utility"]; return `<aside class="c-library"><div class="c-library-title"><div><span>WORKFLOW</span><b>Node library</b></div></div><input class="c-search" placeholder="Search nodes" data-c-search />${groups.map((g) => `<section class="c-library-group"><small>${g.toUpperCase()}</small>${Object.entries(registry).filter(([id, d]) => id !== "audioInput" && d.category === g).map(([id, d]) => `<button class="c-library-item" type="button" data-c-add="${id}" data-c-search-value="${esc(searchHaystack(`${g} ${id} ${d.name} ${d.category}`))}"><i class="c-lib-icon ${d.color}">${abstractIcon(abstractKey(id))}</i><span><b>${esc(d.name)}</b></span><em>+</em></button>`).join("")}</section>`).join("")}</aside>`; }
  function inspector(p) {
    const n = p?.nodes.find((x) => x.id === state().selectedCanvasNode);
    if (!n) return "";
    const d = def(n), k = d.modelKind, s = n.settings || {}, m = model(n);
    const aspectOptions = k === "video" ? (m?.ratios || [["16:9", "16:9"], ["9:16", "9:16"], ["1:1", "1:1"]]) : imageRatios(m);
    const resolutionOptions = k === "video" ? (m?.resolutions || [["720p", "720p"], ["1080p", "1080p"]]) : imageResolutions(m);
    const modelSettings = k ? [
      selectField("modelId", "Model", models(k).map((item) => [item.id, item.label]), n.modelId),
      textField("prompt", "Prompt", s.prompt || n.prompt || "", 4),
      k === "video" ? selectField("inputMode", "Input mode", (m?.modes || ["auto", "frames", "references"]).map((x) => [x, x === "frames" ? "Start / end frames" : x === "references" ? "References" : "Auto"]), s.inputMode || "auto") : "",
      selectField("aspectRatio", "Aspect", aspectOptions, s.aspectRatio || (k === "video" ? "16:9" : "1:1")),
      resolutionOptions.length ? selectField("resolution", "Resolution", resolutionOptions, s.resolution || (k === "video" ? "720p" : "2K")) : "",
      k === "image" && imageQualities(m).length ? selectField("quality", "Quality", imageQualities(m), s.quality || m?.defaultQuality || "high") : "",
      k === "image" && imageFormats(m).length ? selectField("outputFormat", "Format", imageFormats(m), s.outputFormat || "png") : "",
      k === "video" ? rangeField("duration", "Duration", m?.durations?.length ? m.durations : durationRangeItems(m?.durationRange), s.duration || m?.durationRange?.default || m?.durations?.[0]?.[0] || "5") : "",
      k !== "image" || m?.negative ? textField("negativePrompt", "Negative", s.negativePrompt || "", 2) : "",
      k !== "image" || m?.seed !== false ? `<label class="c-field c-field-seed"><span>Seed</span><input data-c-setting="seed" value="${esc(s.seed || "")}" placeholder="Random seed"/></label>` : "",
      k === "image" && m?.nsfwChecker ? toggleField("nsfwChecker", "NSFW checker", s.nsfwChecker) : "",
      k === "video" && m?.sound ? toggleField("sound", "Generate audio", s.sound) : "",
      k === "video" && m?.nsfwChecker ? toggleField("nsfwChecker", "NSFW checker", s.nsfwChecker) : "",
      k === "video" && m?.returnLastFrame ? toggleField("returnLastFrame", "Return last frame", s.returnLastFrame) : "",
      k === "video" && m?.promptExtend !== false ? toggleField("promptExtend", "Prompt extend", s.promptExtend !== false) : ""
    ].join("") : n.type === "prompt" ? textField("prompt", "Prompt", s.prompt || n.prompt || "", 7) : utilitySettings(n, d, s);
    const footer = k ? `<button class="c-icon-run c-expand-run" type="button" data-c-run-only="${esc(n.id)}" title="Run this node"><span>▶</span><b>Run this node</b></button><button class="c-primary c-expand-run" type="button" data-c-run-from="${esc(n.id)}" title="Run from here"><span>↘</span><b>Run from here</b></button>` : `<div class="c-live-foot"><i></i><span>Live preview updates instantly</span></div>`;
    return `<aside class="c-inspector"><header><div><span>NODE</span><b>${esc(d.name)}</b><small>${esc(nodeSubtitle(n, d, m))}</small></div><button type="button" data-c-clear-selection title="Close">×</button></header><div class="c-inspector-scroll"><label class="c-field c-field-label"><span>Name</span><input data-c-setting="label" value="${esc(n.label || d.name)}"/></label>${modelSettings}<div class="c-execution"><span>EXECUTION</span><div><i></i>${esc(n.status || "idle")}${n.error ? ` · ${esc(n.error)}` : ""}</div></div></div><footer class="c-inspector-foot">${footer}</footer></aside>`;
  }
  function hydrateReactiveOnce(p) {
    if (reactiveHydrateQueued) return;
    reactiveHydrateQueued = true;
    requestAnimationFrame(() => {
      reactiveHydrateQueued = false;
      const current = project();
      if (!current || current.id !== p.id) return;
      updateEdgePaths();
    });
  }
  function render() { const p = normalizeProject(project()); if (!p) return `<div class="c-empty-project">Create a flow to begin.</div>`; const v = p.viewport, nodes = p.nodes || []; hydrateReactiveOnce(p); recoverRunningNodes(p); return `<section class="c-workspace"><div class="c-canvas-top"><div class="c-flow-name"><b>${esc(p.name || "Untitled flow")}</b><small>${nodes.length} nodes · ${state().canvasSaveState === "saving" ? "Saving..." : "Saved"}</small></div><div class="c-top-actions"><button class="c-toolbar-icon" type="button" data-c-fit title="Fit canvas" aria-label="Fit canvas"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M16 21h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/></svg><span>Fit</span></button><label class="c-toolbar-icon c-import-flow" title="Import flow" aria-label="Import flow"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m17 8-5-5-5 5M12 3v12"/></svg><span>Import flow</span><input type="file" accept="application/json" data-import-canvas /></label></div></div><div class="c-editor"><div class="c-stage" data-c-stage><div class="c-surface" data-c-surface style="--vx:${v.x}px;--vy:${v.y}px;--zoom:${v.zoom}"><svg class="c-edges" data-c-edges><defs>${p.edges.map((e) => edgeGradient(e, nodes)).join("")}</defs>${p.edges.map((e) => edgePath(e, nodes)).join("")}</svg>${nodes.map(card).join("")}</div>${actionBar(p)}${!nodes.length && !state().canvasOnboardingDismissed ? `<div class="c-onboarding" data-c-onboarding><div class="c-onboarding-mark">${abstractIcon("canvas")}</div><h1>Build your visual workflow</h1><p>Drop media, paste from clipboard, double-click to add a node, or click once for empty space.</p><div><button type="button" data-c-quick="prompt">${abstractIcon("prompt")}<span>Prompt</span></button><button type="button" data-c-quick="imageGenerator">${abstractIcon("image")}<span>Image model</span></button></div></div>` : ""}<div class="c-marquee" data-c-marquee hidden></div><div class="c-edge-menu" data-c-edge-menu hidden><button type="button" data-c-edge-menu-toggle>•••</button><div><button type="button" data-c-edge-cut-action>✂ Cut connection</button><button type="button" data-c-edge-insert-action>＋ Insert node</button></div></div><div class="c-connect-menu" data-c-connect-menu hidden></div>${inspector(p)}</div></div></section>`; }
  function createNode(type, pos, extra = {}) { const p = project(), d = registry[type]; if (!p || !d) return null; const m = d.modelKind ? models(d.modelKind)[0] : null; const index = p.nodes.length; const proposed = pos ? { x: pos.x + (extra.exact ? 0 : (addOffset % 3) * 320), y: pos.y + (extra.exact ? 0 : Math.floor((addOffset % 6) / 3) * 230) } : { x: 180 + (index % 4) * 340, y: 140 + Math.floor(index / 4) * 230 }; const base = { ...proposed }; while (!extra.exact && p.nodes.some((n) => Math.abs(n.x - base.x) < 290 && Math.abs(n.y - base.y) < 210)) { base.x += 320; if (base.x > 1800) { base.x = 180; base.y += 230; } } addOffset += 1; const asset = extra.assetId ? (state().assets || []).find((a) => a.id === extra.assetId) : null; return { id: `node_${Date.now()}_${Math.random().toString(36).slice(2)}`, type, x: Math.round(base.x), y: Math.round(base.y), width: 276, status: asset ? "success" : "idle", modelId: extra.modelId || m?.id || "", settings: { ...(d.defaults || {}), ...(extra.settings || {}) }, refs: extra.refs || [], assetId: extra.assetId || "", result: asset ? { url: asset.url, type: type === "videoInput" ? "video" : type === "audioInput" ? "audio" : "image", assetId: asset.id } : extra.result || null }; }
  function add(type, pos, extra = {}) { const p = project(), node = createNode(type, pos, extra); if (!p || !node) return null; commit(p, () => p.nodes.push(node)); state().selectedNodeIds = [node.id]; state().selectedCanvasNode = node.id; structural(); return node; }
  function world(e, stage) { const r = stage.getBoundingClientRect(), v = project().viewport; return { x: (e.clientX - r.left - v.x) / v.zoom, y: (e.clientY - r.top - v.y) / v.zoom }; }
  function worldFromClient(clientX, clientY) { const stage = root().querySelector("[data-c-stage]"); return stage ? world({ clientX, clientY }, stage) : { x: 0, y: 0 }; }
  function compatible(a, b) { return a === b || a === "generic" || b === "generic"; }
  function connectTargetFromPort(portEl) {
    return portEl ? { nodeId: portEl.dataset.cNodeId, portId: portEl.dataset.cPortId, direction: portEl.dataset.cPortDirection, dataType: portEl.dataset.cDataType, element: portEl } : null;
  }
  function isAvailableTarget(target) {
    const p = project(), c = operation?.connection;
    if (!p || !c || !target || c.nodeId === target.nodeId) return false;
    const source = c.direction === "output" ? c : target;
    const sink = c.direction === "input" ? c : target;
    if (source.direction !== "output" || sink.direction !== "input" || !compatible(source.dataType, sink.dataType)) return false;
    const sinkNode = p.nodes.find((n) => n.id === sink.nodeId);
    const sinkPort = (def(sinkNode).inputs || []).find((port) => port.id === sink.portId);
    const exists = (p.edges || []).some((e) => e.sourceNodeId === source.nodeId && (e.sourcePortId || e.sourceHandle) === source.portId && e.targetNodeId === sink.nodeId && (e.targetPortId || e.targetHandle) === sink.portId);
    const occupied = !sinkPort?.multiple && (p.edges || []).some((e) => e.targetNodeId === sink.nodeId && (e.targetPortId || e.targetHandle) === sink.portId);
    return !exists && !occupied;
  }
  function compatibleTargetsForNode(nodeEl) {
    const p = project(), c = operation?.connection;
    if (!nodeEl || !p || !c || nodeEl.dataset.cNodeId === c.nodeId) return [];
    const node = p.nodes.find((n) => n.id === nodeEl.dataset.cNodeId);
    const ports = c.direction === "output" ? def(node).inputs || [] : def(node).outputs || [];
    const direction = c.direction === "output" ? "input" : "output";
    return ports
      .filter((port) => port.type !== "audio" && port.id !== "audio")
      .map((port) => ({ nodeId: node.id, portId: port.id, direction, dataType: effectivePortType(node, port, direction), name: port.name, multiple: port.multiple }))
      .filter(isAvailableTarget);
  }
  function connect(target) {
    const p = project(); if (!operation?.connection || !target || operation.connection.nodeId === target.nodeId) return;
    const c = operation.connection;
    const source = c.direction === "output" ? c : target;
    const sink = c.direction === "input" ? c : target;
    if (source.direction !== "output" || sink.direction !== "input") return;
    if (!compatible(source.dataType, sink.dataType)) { target.element?.classList.add("invalid"); setTimeout(() => target.element?.classList.remove("invalid"), 350); return; }
    const sinkDef = def(p.nodes.find((n) => n.id === sink.nodeId));
    const sinkPort = (sinkDef.inputs || []).find((port) => port.id === sink.portId);
    const exists = p.edges.some((e) => e.sourceNodeId === source.nodeId && (e.sourcePortId || e.sourceHandle) === source.portId && e.targetNodeId === sink.nodeId && (e.targetPortId || e.targetHandle) === sink.portId);
    const occupied = !sinkPort?.multiple && p.edges.some((e) => e.targetNodeId === sink.nodeId && (e.targetPortId || e.targetHandle) === sink.portId);
    if (exists || occupied) return;
    commit(p, () => p.edges.push({ id: `edge_${Date.now()}`, sourceNodeId: source.nodeId, sourcePortId: source.portId, sourceType: source.dataType, targetNodeId: sink.nodeId, targetPortId: sink.portId, targetType: sink.dataType, dataType: source.dataType }));
    refreshReactive(sink.nodeId);
    structural();
  }
  function portPoint(n, portId, side) {
    const nodeEl = root().querySelector(`[data-c-node-id="${CSS.escape(n.id)}"]`);
    const el = nodeEl?.querySelector(`[data-c-port-id="${CSS.escape(portId || "")}"][data-c-port-direction="${side}"]`);
    if (el) {
      const r = el.getBoundingClientRect();
      return worldFromClient(r.left + r.width / 2, r.top + r.height / 2);
    }
    const ports = side === "output" ? def(n).outputs || [] : def(n).inputs || [];
    const index = Math.max(0, ports.findIndex((p) => p.id === portId));
    return { x: n.x + (side === "output" ? n.width - 0.5 : 0.5), y: n.y + 56.5 + index * 26 };
  }
  function curve(a, b) {
    const dx = Math.max(80, Math.abs(b.x - a.x) * 0.45);
    return `M${a.x} ${a.y} C${a.x + dx} ${a.y},${b.x - dx} ${b.y},${b.x} ${b.y}`;
  }
  function edgeD(e, nodes) {
    const a = nodes.find((n) => n.id === e.sourceNodeId), b = nodes.find((n) => n.id === e.targetNodeId);
    return a && b ? curve(portPoint(a, e.sourcePortId || e.sourceHandle, "output"), portPoint(b, e.targetPortId || e.targetHandle, "input")) : "";
  }
  function preview(e) { const svg = root().querySelector("[data-c-edges]"), stage = root().querySelector("[data-c-stage]"), p = project(); if (!svg || !operation?.connection || !stage) return; const a = p.nodes.find((n) => n.id === operation.connection.nodeId); if (!a) return; const start = portPoint(a, operation.connection.portId, operation.connection.direction), end = world(e, stage), d = operation.connection.direction === "output" ? curve(start, end) : curve(end, start); let line = svg.querySelector(".c-edge-preview"); if (!line) { line = document.createElementNS("http://www.w3.org/2000/svg", "path"); line.classList.add("c-edge-preview"); svg.append(line); } line.setAttribute("d", d); line.setAttribute("stroke", portColors[operation.connection.dataType] || portColors.generic); }
  function updateEdgePaths(ids = null) {
    const p = project(), nodes = p?.nodes || [];
    if (!p) return;
    const touched = ids?.size ? ids : null;
    const edges = touched ? (p.edges || []).filter((e) => touched.has(e.sourceNodeId) || touched.has(e.targetNodeId)) : (p.edges || []);
    const byId = new Map(edges.map((e) => [e.id, e]));
    const selector = touched ? edges.map((e) => `[data-c-edge-id="${CSS.escape(e.id)}"]`).join(",") : "[data-c-edge-id]";
    if (selector) root().querySelectorAll(selector).forEach((path) => {
      const e = byId.get(path.dataset.cEdgeId);
      if (e) path.setAttribute("d", edgeD(e, nodes));
    });
    const gradientSelector = touched ? edges.map((e) => `[data-c-edge-gradient="${CSS.escape(e.id)}"]`).join(",") : "[data-c-edge-gradient]";
    if (gradientSelector) root().querySelectorAll(gradientSelector).forEach((grad) => {
      const e = byId.get(grad.dataset.cEdgeGradient), a = e && nodeById(p, e.sourceNodeId), b = e && nodeById(p, e.targetNodeId);
      if (!e || !a || !b) return;
      const start = portPoint(a, e.sourcePortId, "output"), end = portPoint(b, e.targetPortId, "input");
      grad.setAttribute("x1", start.x); grad.setAttribute("y1", start.y); grad.setAttribute("x2", end.x); grad.setAttribute("y2", end.y);
    });
  }
  function scheduleEdgeUpdate(ids = null) {
    if (ids?.size) edgeUpdateIds = edgeUpdateIds ? new Set([...edgeUpdateIds, ...ids]) : new Set(ids);
    else edgeUpdateIds = null;
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(() => { rafPending = false; const idsToUpdate = edgeUpdateIds; edgeUpdateIds = null; updateEdgePaths(idsToUpdate); });
  }
  function updateNodePositions(ids = null) {
    const s = root(), p = project(), touched = ids?.size ? ids : null;
    for (const n of p.nodes) {
      if (touched && !touched.has(n.id)) continue;
      const el = s.querySelector(`[data-c-node-id="${CSS.escape(n.id)}"]`);
      if (el) { el.style.setProperty("--x", `${n.x}px`); el.style.setProperty("--y", `${n.y}px`); }
    }
    updateActionBarPosition();
    scheduleEdgeUpdate(touched);
  }
  function clearTransient() {
    root().querySelector(".c-edge-preview")?.remove();
    root().querySelectorAll(".c-port.target,.c-port.invalid").forEach((x) => x.classList.remove("target", "invalid"));
    root().querySelectorAll(".c-node.connect-target").forEach((x) => x.classList.remove("connect-target"));
  }
  function hideConnectMenu() { const menu = root().querySelector("[data-c-connect-menu]"); if (menu) { menu.hidden = true; menu.innerHTML = ""; } }
  function showConnectMenu(e, sourceConnection = null) {
    const now = performance.now();
    if (!sourceConnection && now - lastMenuOpen < 160) return;
    lastMenuOpen = now;
    clearTransient();
    const menu = root().querySelector("[data-c-connect-menu]"), p = project(), c = operation?.connection, insertEdge = operation?.insertEdge, source = c && nodeById(p, c.nodeId);
    if (!menu) return;
    const q = world(e, root().querySelector("[data-c-stage]"));
    const active = sourceConnection || c;
    const entries = Object.entries(registry).filter(([id, d]) => id !== "audioInput" && (insertEdge ? (d.inputs || []).filter((port) => port.type !== "audio").some((port) => compatible(insertEdge.dataType, port.type)) && (d.outputs || []).filter((port) => port.type !== "audio").some((port) => compatible(port.type, insertEdge.dataType)) : !active ? true : active.direction === "output" ? (d.inputs || []).filter((port) => port.type !== "audio").some((port) => compatible(active.dataType, port.type)) : (d.outputs || []).filter((port) => port.type !== "audio").some((port) => compatible(port.type, active.dataType))));
    const grouped = ["Input", "Generation", "Utility"].map((cat) => ({ cat, items: entries.filter(([, d]) => d.category === cat) })).filter((g) => g.items.length);
    menu.style.left = `${Math.min(e.clientX + 8, window.innerWidth - 286)}px`; menu.style.top = `${Math.min(e.clientY + 8, window.innerHeight - 360)}px`;
    menu.dataset.worldX = String(q.x + 24); menu.dataset.worldY = String(q.y + 24);
    menu.innerHTML = `<div class="c-connect-menu-head"><b>${insertEdge ? "Insert node" : active ? "Add connected node" : "Add node"}</b><input data-c-connect-search placeholder="Search nodes or models" /></div><div class="c-connect-menu-list">${grouped.map((group) => `<section><small>${esc(group.cat)}</small>${group.items.flatMap(([type, d]) => d.modelKind ? models(d.modelKind).map((m) => `<button type="button" data-c-connect-add="${esc(type)}" data-c-connect-model="${esc(m.id)}" data-c-connect-search-value="${esc(searchHaystack(`${group.cat} ${type} ${d.name} ${m.label} ${m.family || ""} ${m.id || ""}`))}"><i>${modelIconHtml(m, d.modelKind, 22)}</i><span>${esc(m.label)}</span><small>${esc(d.name)}</small></button>`) : [`<button type="button" data-c-connect-add="${esc(type)}" data-c-connect-model="" data-c-connect-search-value="${esc(searchHaystack(`${group.cat} ${type} ${d.name} ${d.category}`))}"><i>${abstractIcon(abstractKey(type))}</i><span>${esc(d.name)}</span><small>${esc(d.category)}</small></button>`]).join("")}</section>`).join("")}<div class="c-empty-search" hidden>No matching nodes</div></div>`;
    menu.hidden = false;
    const search = menu.querySelector("[data-c-connect-search]");
    const runSearch = (event) => requestAnimationFrame(() => filterSearchMenu(event.currentTarget || search));
    ["beforeinput", "input", "keyup", "change", "search"].forEach((eventName) => search?.addEventListener(eventName, runSearch));
    requestAnimationFrame(() => search?.focus({ preventScroll: true }));
  }
  function showPortChoiceMenu(e, targets) {
    clearTransient();
    const menu = root().querySelector("[data-c-connect-menu]");
    if (!menu || !targets?.length) return;
    menu.style.left = `${Math.min(e.clientX + 8, window.innerWidth - 274)}px`;
    menu.style.top = `${Math.min(e.clientY + 8, window.innerHeight - 260)}px`;
    menu.innerHTML = `<div class="c-connect-menu-head"><b>Connect to</b></div><div class="c-connect-menu-list c-port-choice-list">${targets.map((target) => `<button type="button" data-c-connect-port-choice="${esc(target.portId)}" data-c-node-id="${esc(target.nodeId)}" data-c-port-direction="${esc(target.direction)}" data-c-data-type="${esc(target.dataType)}"><i>${abstractIcon(abstractKey(target.dataType))}</i><span>${esc(target.name)}</span><small>${esc(target.dataType)}${target.multiple ? " · multiple" : ""}</small></button>`).join("")}</div>`;
    menu.hidden = false;
  }
  function filterSearchMenu(search) {
    const q = search.value.trim().toLowerCase();
    const scope = search.closest("[data-c-connect-menu],.c-library,[data-node-picker]") || root();
    const entries = [...scope.querySelectorAll("[data-c-connect-search-value],[data-c-search-value],[data-search-value]")];
    entries.forEach((button) => {
      const value = `${button.dataset.cConnectSearchValue || ""} ${button.dataset.cSearchValue || ""} ${button.dataset.searchValue || ""} ${button.textContent || ""}`;
      const match = smartSearchMatch(q, value);
      button.hidden = !match;
      button.style.display = match ? "" : "none";
    });
    scope.querySelectorAll("section,.c-library-group").forEach((section) => {
      const items = [...section.querySelectorAll("[data-c-connect-search-value],[data-c-search-value],[data-search-value]")];
      const match = !q || items.length === 0 || items.some((item) => !item.hidden);
      section.hidden = !match;
      section.style.display = match ? "" : "none";
    });
    const empty = scope.querySelector(".c-empty-search");
    if (empty) {
      const visible = entries.some((item) => !item.hidden);
      empty.hidden = !q || visible;
      empty.style.display = !q || visible ? "none" : "block";
    }
  }
  function updateViewport() { const p = project(), surface = root().querySelector("[data-c-surface]"); if (!p || !surface) return; surface.style.setProperty("--vx", `${p.viewport.x}px`); surface.style.setProperty("--vy", `${p.viewport.y}px`); surface.style.setProperty("--zoom", p.viewport.zoom); const label = root().querySelector(".c-top-actions output"); if (label) label.textContent = `${Math.round(p.viewport.zoom * 100)}%`; updateActionBarPosition(); }
  function updateActionBarPosition() { const p = project(), bar = root().querySelector("[data-c-action-bar]"), stage = root().querySelector("[data-c-stage]"); if (!p || !bar) return; const n = p.nodes.find((node) => node.id === bar.dataset.cActionBar); if (!n) return; const nodeEl = root().querySelector(`[data-c-node-id="${CSS.escape(n.id)}"]`); if (nodeEl && stage) { const nr = nodeEl.getBoundingClientRect(), sr = stage.getBoundingClientRect(); bar.style.left = `${Math.round(nr.left - sr.left + nr.width / 2)}px`; bar.style.top = `${Math.round(nr.top - sr.top - 48)}px`; return; } const v = p.viewport || { x: 0, y: 0, zoom: 1 }; bar.style.left = `${Math.round(v.x + (n.x + Number(n.width || 276) / 2) * v.zoom)}px`; bar.style.top = `${Math.round(v.y + n.y * v.zoom - 46)}px`; }
  function fitMediaRatios() {
    root().querySelectorAll("[data-c-fit-media]").forEach((box) => {
      const media = box.querySelector("img,video");
      const apply = () => {
        const w = media?.naturalWidth || media?.videoWidth;
        const h = media?.naturalHeight || media?.videoHeight;
        if (w && h) { box.style.setProperty("--media-ratio", `${w} / ${h}`); scheduleEdgeUpdate(); }
      };
      apply();
      if (media) {
        media.addEventListener("load", apply, { once: true });
        media.addEventListener("loadedmetadata", () => {
          if (media.dataset.cFrameVideo === "last" && Number.isFinite(media.duration)) media.currentTime = Math.max(0, media.duration - 0.04);
          else if (media.dataset.cFrameVideo) media.currentTime = 0;
          apply();
        }, { once: true });
      }
    });
  }
  function clampNum(v, min, max, fallback = min) { v = Number(v); return Number.isFinite(v) ? Math.max(min, Math.min(max, v)) : fallback; }
  function zoomBy(delta, origin) { const p = project(), stage = root().querySelector("[data-c-stage]"); if (!p || !stage) return; p.viewport ||= { x: 0, y: 0, zoom: 1 }; p.viewport.zoom = clampNum(p.viewport.zoom, 0.08, 3.2, 1); const before = origin ? world(origin, stage) : null, next = clampNum(p.viewport.zoom + delta, 0.08, 3.2, 1); if (Math.abs(next - p.viewport.zoom) < 0.001) return; p.viewport.zoom = next; if (before && origin) { const r = stage.getBoundingClientRect(); p.viewport.x = origin.clientX - r.left - before.x * next; p.viewport.y = origin.clientY - r.top - before.y * next; } p.viewport.x = clampNum(p.viewport.x, -120000, 120000, 0); p.viewport.y = clampNum(p.viewport.y, -120000, 120000, 0); updateViewport(); persist(p); }
  function downstreamNodes(p, id, seen = new Set()) {
    const result = [];
    outgoingEdges(p, id).forEach((edge) => {
      if (seen.has(edge.targetNodeId)) return;
      seen.add(edge.targetNodeId);
      const node = nodeById(p, edge.targetNodeId);
      if (!node) return;
      result.push(node);
      result.push(...downstreamNodes(p, node.id, seen));
    });
    return result;
  }
  function syncMediaElementForNode(n) {
    const shown = previewResult(n);
    if (!shown?.url) return;
    const el = root().querySelector(`[data-c-node-id="${CSS.escape(n.id)}"] .c-media`);
    if (!el) return;
    const crop = el.querySelector(".c-crop-result");
    const style = cropResultStyle({ ...n, result: shown });
    if (crop && style) {
      crop.setAttribute("style", style);
      return;
    }
    el.outerHTML = media(n);
    queueMicrotask(fitMediaRatios);
  }
  function scheduleUtilityPreviewUpdate(id) {
    if (utilityPreviewRaf) cancelAnimationFrame(utilityPreviewRaf);
    utilityPreviewRaf = requestAnimationFrame(() => {
      utilityPreviewRaf = 0;
      const p = project();
      if (!p) return;
      downstreamNodes(p, id).forEach(syncMediaElementForNode);
      updateEdgePaths();
    });
  }
  function loadImageForCanvas(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("Could not render transformed image."));
      img.src = url;
    });
  }
  function loadVideoFrameForCanvas(url, frame = "first") {
    return new Promise((resolve, reject) => {
      const video = document.createElement("video");
      video.crossOrigin = "anonymous";
      video.muted = true;
      video.playsInline = true;
      video.preload = "metadata";
      video.onloadedmetadata = () => {
        video.currentTime = frame === "last" && Number.isFinite(video.duration) ? Math.max(0, video.duration - 0.04) : 0;
      };
      video.onseeked = () => resolve(video);
      video.onerror = () => reject(new Error("Could not extract a frame from this video."));
      video.src = url;
    });
  }
  async function renderNodeImageDataUrl(n) {
    const result = previewResult(n);
    if (!result?.url) return "";
    if (result.type === "video" && result.transform && !n?.result?.url) {
      throw new Error("Run this utility node before downloading a transformed video.");
    }
    const ops = result.operations || (result.transform ? [result.transform] : []);
    if (!ops.length && result.type !== "image") return "";
    const frameOp = [...ops].reverse().find((op) => op.type === "extractFrame");
    const source = result.sourceType === "video" || result.type === "video"
      ? await loadVideoFrameForCanvas(result.url, frameOp?.settings?.frame || "first")
      : await loadImageForCanvas(result.url);
    let canvas = document.createElement("canvas");
    canvas.width = source.naturalWidth || source.videoWidth || 1;
    canvas.height = source.naturalHeight || source.videoHeight || 1;
    canvas.getContext("2d").drawImage(source, 0, 0, canvas.width, canvas.height);
    for (const op of ops) {
      if (op.type === "crop") {
        const s = op.settings || {}, x = Math.round(canvas.width * Number(s.x || 0) / 100), y = Math.round(canvas.height * Number(s.y || 0) / 100), w = Math.max(1, Math.round(canvas.width * Number(s.width || 100) / 100)), h = Math.max(1, Math.round(canvas.height * Number(s.height || 100) / 100));
        const next = document.createElement("canvas");
        next.width = w; next.height = h;
        next.getContext("2d").drawImage(canvas, x, y, w, h, 0, 0, w, h);
        canvas = next;
      } else if (op.type === "rotate") {
        const deg = ((Number(op.settings?.degrees || 0) % 360) + 360) % 360;
        if (deg) {
          const swap = deg === 90 || deg === 270, next = document.createElement("canvas");
          next.width = swap ? canvas.height : canvas.width; next.height = swap ? canvas.width : canvas.height;
          const ctx = next.getContext("2d");
          ctx.translate(next.width / 2, next.height / 2);
          ctx.rotate(deg * Math.PI / 180);
          ctx.drawImage(canvas, -canvas.width / 2, -canvas.height / 2);
          canvas = next;
        }
      } else if (op.type === "resize") {
        const s = op.settings || {};
        const targetW = clampNum(s.width, 16, 8192, canvas.width);
        const targetH = s.height ? clampNum(s.height, 16, 8192, Math.round(targetW * canvas.height / canvas.width)) : Math.max(16, Math.round(targetW * canvas.height / canvas.width));
        const next = document.createElement("canvas");
        next.width = targetW;
        next.height = targetH;
        const ctx = next.getContext("2d");
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
        if (s.fit === "stretch") {
          ctx.drawImage(canvas, 0, 0, targetW, targetH);
        } else {
          const scale = s.fit === "cover" ? Math.max(targetW / canvas.width, targetH / canvas.height) : Math.min(targetW / canvas.width, targetH / canvas.height);
          const w = canvas.width * scale;
          const h = canvas.height * scale;
          ctx.drawImage(canvas, (targetW - w) / 2, (targetH - h) / 2, w, h);
        }
        canvas = next;
      }
    }
    return canvas.toDataURL("image/png");
  }
  async function downloadNodeMedia(nodeId, fallbackUrl, button = null) {
    const n = nodeById(project(), nodeId);
    button?.classList.add("is-downloading");
    if (button) button.disabled = true;
    window.__canvasToast?.("Preparing download...", "saving");
    try {
      const dataUrl = await renderNodeImageDataUrl(n);
      if (dataUrl && n?.result) {
        n.result.renderedUrl = dataUrl;
        n.result.renderedType = "image";
        persist(project());
      }
      const href = dataUrl || window.__mediaDownloadHref?.(fallbackUrl, previewResult(n)?.type || kind(n), downloadStem(n)) || fallbackUrl;
      const a = document.createElement("a");
      a.href = href;
      a.download = `${downloadStem(n)}.${dataUrl ? "png" : (fallbackUrl.split(".").pop() || "media")}`;
      document.body.append(a); a.click(); a.remove();
      window.__canvasToast?.("Download started", "success");
    } catch (err) {
      window.__canvasToast?.(err.message || "Could not render transformed result. Downloading original.", "error");
      const a = document.createElement("a");
      a.href = window.__mediaDownloadHref?.(fallbackUrl, previewResult(n)?.type || kind(n), downloadStem(n)) || fallbackUrl; a.download = `${downloadStem(n)}.${fallbackUrl.split(".").pop() || "media"}`;
      document.body.append(a); a.click(); a.remove();
    } finally {
      button?.classList.remove("is-downloading");
      if (button) button.disabled = false;
    }
  }
  function cropSettingsFromDrag(start, dx, dy) { const min = 5, sx = start.settings; let left = Number(sx.x || 0), top = Number(sx.y || 0), right = left + Number(sx.width || 100), bottom = top + Number(sx.height || 100); if (start.handle === "move") { const w = right - left, h = bottom - top; left = clampNum(left + dx, 0, 100 - w, 0); top = clampNum(top + dy, 0, 100 - h, 0); right = left + w; bottom = top + h; } else { if (start.handle.includes("w")) left = clampNum(left + dx, 0, right - min, 0); if (start.handle.includes("e")) right = clampNum(right + dx, left + min, 100, 100); if (start.handle.includes("n")) top = clampNum(top + dy, 0, bottom - min, 0); if (start.handle.includes("s")) bottom = clampNum(bottom + dy, top + min, 100, 100); } return { x: String(Math.round(left)), y: String(Math.round(top)), width: String(Math.round(right - left)), height: String(Math.round(bottom - top)) }; }
  function bind() { if (bound) return; bound = true;
    function removeEdge(id) { const p = project(); if (!p || !id) return; commit(p, () => { p.edges = (p.edges || []).filter((edge) => edge.id !== id); }); const cutter = root().querySelector("[data-c-edge-cut]"); if (cutter) cutter.hidden = true; structural(); }
    function hideEdgeMenu() { const menu = root().querySelector("[data-c-edge-menu]"); if (menu) menu.hidden = true; }
    function deleteNode(id) { const p = project(); if (!p || !id) return; commit(p, () => { p.nodes = p.nodes.filter((n) => n.id !== id); p.edges = (p.edges || []).filter((e) => e.sourceNodeId !== id && e.targetNodeId !== id); }); state().selectedNodeIds = selectedIds().filter((nodeId) => nodeId !== id); if (state().selectedCanvasNode === id) state().selectedCanvasNode = state().selectedNodeIds[0] || ""; structural(); }
    function settingValue(f) { if (f.dataset.cRangeValues) { const items = JSON.parse(f.dataset.cRangeValues || "[]"); const index = Math.max(0, Math.min(items.length - 1, Number(f.value || 0))); const item = items[index] || items[0] || ["", ""]; f.style.setProperty("--range-progress", `${items.length > 1 ? (index / (items.length - 1)) * 100 : 0}%`); const output = f.closest(".c-range-field")?.querySelector(`[data-c-range-output="${CSS.escape(f.dataset.cSetting || "")}"]`); if (output) output.textContent = item[1] || item[0] || ""; return item[0] || ""; } return f.type === "checkbox" ? f.checked : f.value; }
    function directConnect(p, source, sink, type) { if (!source?.nodeId || !sink?.nodeId) return; const sinkNode = nodeById(p, sink.nodeId), sinkPort = (def(sinkNode).inputs || []).find((port) => port.id === sink.portId); if (!sinkPort?.multiple) p.edges = (p.edges || []).filter((e) => !(e.targetNodeId === sink.nodeId && (e.targetPortId || e.targetHandle) === sink.portId)); p.edges.push({ id: `edge_${Date.now()}_${Math.random().toString(36).slice(2)}`, sourceNodeId: source.nodeId, sourcePortId: source.portId, sourceType: type, targetNodeId: sink.nodeId, targetPortId: sink.portId, targetType: type, dataType: type }); }
    function beginInsertNodeIntoEdge(e, edgeId) { const p = project(), edge = p?.edges.find((item) => item.id === edgeId); if (!p || !edge) return; operation = { insertEdge: { ...edge } }; mode = "insert-node"; hideEdgeMenu(); showConnectMenu(e); }
    function spliceNodeIntoEdge(type, modelId, pos) { const p = project(), edge = operation?.insertEdge; if (!p || !edge) return null; const node = createNode(type, pos, { exact: true, modelId }); if (!node) return null; const d = def(node), input = (d.inputs || []).find((port) => compatible(edge.dataType, port.type)), output = (d.outputs || []).find((port) => compatible(port.type, edge.dataType)); if (!input || !output) return null; commit(p, () => { p.nodes.push(node); p.edges = (p.edges || []).filter((item) => item.id !== edge.id); directConnect(p, { nodeId: edge.sourceNodeId, portId: edge.sourcePortId || edge.sourceHandle }, { nodeId: node.id, portId: input.id }, edge.dataType); directConnect(p, { nodeId: node.id, portId: output.id }, { nodeId: edge.targetNodeId, portId: edge.targetPortId || edge.targetHandle }, edge.dataType); }); state().selectedNodeIds = [node.id]; state().selectedCanvasNode = node.id; structural(); return node; }
    document.addEventListener("click", (e) => { if (e.detail === 2 && e.target.closest("[data-c-stage]") && !e.target.closest(".c-node,[data-c-connect-menu],.c-library,.c-inspector")) { e.preventDefault(); mode = "menu"; operation = null; showConnectMenu(e); return; } const iterationStep = e.target.closest("[data-c-iteration-step]"); if (iterationStep) { e.preventDefault(); e.stopPropagation(); const p = project(), n = p?.nodes.find((x) => x.id === iterationStep.dataset.cIterationStep), list = n ? iterations(n) : []; const current = Math.max(0, list.findIndex((entry) => entry.id === selectedIteration(n)?.id)); const item = list[(current + Number(iterationStep.dataset.cStep || 0) + list.length) % list.length]; if (n && item) { n.selectedIterationId = item.id; n.result = item.result; outgoingEdges(p, n.id).forEach((edge) => refreshReactive(edge.targetNodeId, new Set(), { save: false })); persist(p); structural(); } return; } const iterationButton = e.target.closest("[data-c-select-iteration]"); if (iterationButton) { e.preventDefault(); e.stopPropagation(); const p = project(), n = p?.nodes.find((x) => x.id === iterationButton.dataset.cSelectIteration); const item = n ? iterations(n).find((entry) => entry.id === iterationButton.dataset.cIterationId) : null; if (n && item) { n.selectedIterationId = item.id; n.result = item.result; outgoingEdges(p, n.id).forEach((edge) => refreshReactive(edge.targetNodeId, new Set(), { save: false })); persist(p); structural(); } return; } const edgeMenu = root().querySelector("[data-c-edge-menu]"); if (e.target.closest("[data-c-edge-cut-action]")) { e.preventDefault(); e.stopPropagation(); removeEdge(edgeMenu?.dataset.edgeId); hideEdgeMenu(); return; } if (e.target.closest("[data-c-edge-insert-action]")) { e.preventDefault(); e.stopPropagation(); beginInsertNodeIntoEdge(e, edgeMenu?.dataset.edgeId); return; } if (e.target.closest("[data-c-edge-menu-toggle]")) { e.preventDefault(); e.stopPropagation(); return; } const deleteButton = e.target.closest("[data-c-delete-node]"); if (deleteButton) { e.preventDefault(); e.stopPropagation(); deleteNode(deleteButton.dataset.cDeleteNode); return; } const duplicateButton = e.target.closest("[data-c-duplicate-node]"); if (duplicateButton) { e.preventDefault(); e.stopPropagation(); state().selectedNodeIds = [duplicateButton.dataset.cDuplicateNode]; duplicateSelection({ x: 36, y: 36 }); return; } const openMedia = e.target.closest("[data-c-open-media]"); if (openMedia) { e.preventDefault(); e.stopPropagation(); const p = project(), n = p?.nodes.find((x) => x.id === openMedia.closest("[data-c-node-id]")?.dataset.cNodeId); const url = openMedia.dataset.cOpenMedia; if (window.__openMediaPreview) window.__openMediaPreview(url, previewResult(n)?.type || kind(n), def(n)?.name || "Canvas preview", n?.id || ""); else window.open(url, "_blank", "noopener"); return; } const downloadMedia = e.target.closest("[data-c-download-media]"); if (downloadMedia) { e.preventDefault(); e.stopPropagation(); downloadNodeMedia(downloadMedia.dataset.cDownloadNode, downloadMedia.dataset.cDownloadMedia, downloadMedia); return; } const scaleButton = e.target.closest("[data-c-scale-node]"); if (scaleButton) { e.preventDefault(); e.stopPropagation(); const p = project(), n = p?.nodes.find((x) => x.id === scaleButton.dataset.cScaleNode); if (!n) return; const before = snapshot(p); n.viewScale = Math.max(0.75, Math.min(1.9, Number(n.viewScale || 1) + Number(scaleButton.dataset.cScaleDelta || 0))); finishMutation(before); const el = root().querySelector(`[data-c-node-id="${CSS.escape(n.id)}"]`); el?.style.setProperty("--content-scale", n.viewScale); updateEdgePaths(); return; } const portChoice = e.target.closest("[data-c-connect-port-choice]"); if (portChoice) { e.preventDefault(); e.stopPropagation(); connect({ nodeId: portChoice.dataset.cNodeId, portId: portChoice.dataset.cConnectPortChoice, direction: portChoice.dataset.cPortDirection, dataType: portChoice.dataset.cDataType }); clearTransient(); hideConnectMenu(); mode = "idle"; operation = null; return; } const menuAdd = e.target.closest("[data-c-connect-add]"); if (menuAdd) { e.preventDefault(); e.stopPropagation(); const menu = root().querySelector("[data-c-connect-menu]"); if (operation?.insertEdge) spliceNodeIntoEdge(menuAdd.dataset.cConnectAdd, menuAdd.dataset.cConnectModel || "", { x: Number(menu.dataset.worldX), y: Number(menu.dataset.worldY) }); else { const c = operation?.connection, node = add(menuAdd.dataset.cConnectAdd, { x: Number(menu.dataset.worldX), y: Number(menu.dataset.worldY) }, { exact: true, modelId: menuAdd.dataset.cConnectModel || "" }); if (node && c) { const ports = c.direction === "output" ? def(node).inputs || [] : def(node).outputs || []; const port = ports.find((x) => compatible(c.direction === "output" ? c.dataType : x.type, c.direction === "output" ? x.type : c.dataType)); if (port) connect({ nodeId: node.id, portId: port.id, direction: c.direction === "output" ? "input" : "output", dataType: port.type }); } } clearTransient(); hideConnectMenu(); mode = "idle"; operation = null; return; } const addButton = e.target.closest("[data-c-add],[data-c-quick]"); if (addButton) { const stage = root().querySelector("[data-c-stage]"); const r = stage.getBoundingClientRect(); add(addButton.dataset.cAdd || addButton.dataset.cQuick, { x: (r.width / 2 - project().viewport.x) / project().viewport.zoom, y: (r.height / 2 - project().viewport.y) / project().viewport.zoom }); return; } const runOnly = e.target.closest("[data-c-run-only]"); if (runOnly) { runNode(runOnly.dataset.cRunOnly).catch((err) => window.__canvasToast?.(err.message, "error")); return; } const runFrom = e.target.closest("[data-c-run-from]"); if (runFrom) { runWorkflow(runFrom.dataset.cRunFrom); return; } const run = e.target.closest("[data-c-run],[data-c-run-workflow]"); if (run) { run.dataset.cRun ? runWorkflow(run.dataset.cRun) : runWorkflow(); return; } const zoom = e.target.closest("[data-c-zoom-in],[data-c-zoom-out]"); if (zoom) { zoomBy(zoom.matches("[data-c-zoom-in]") ? 0.12 : -0.12); return; } const fit = e.target.closest("[data-c-fit]"); if (fit) { const p = project(); p.viewport = { x: 32, y: 32, zoom: 1 }; updateViewport(); persist(p); return; } const cardEl = e.target.closest(".c-node[data-c-node-id]"); if (cardEl && !e.target.closest("textarea,input,select,button")) select(cardEl.dataset.cNodeId, e.shiftKey || e.metaKey || e.ctrlKey); const clear = e.target.closest("[data-c-clear-selection]"); if (clear) { state().selectedNodeIds = []; state().selectedCanvasNode = ""; structural(); } if (!operation?.connection && !operation?.insertEdge && !e.target.closest("[data-c-connect-menu],[data-c-edge-menu]")) { hideConnectMenu(); hideEdgeMenu(); } });
    document.addEventListener("input", (e) => { const search = e.target.closest("[data-c-connect-search],[data-c-search],[data-node-search]"); if (search) { filterSearchMenu(search); return; } const f = e.target.closest("[data-c-local-prompt],[data-c-setting]"); if (!f) return; const p = project(), id = f.dataset.cLocalPrompt || state().selectedCanvasNode, n = p.nodes.find((x) => x.id === id); if (!n) return; n.settings ||= {}; const key = f.dataset.cSetting || "prompt"; n.settings[key] = settingValue(f); if (key === "prompt") n.prompt = f.value; const count = f.parentElement.querySelector(".c-counter"); if (count) count.textContent = `${f.value.length} / 2000`; if (isUtility(n)) { n.dirty = Boolean(n.result?.url); if (n.status === "success") n.status = "idle"; persist(p); structural(); } else persist(p); });
    document.addEventListener("change", (e) => { const cardModel = e.target.closest("[data-c-card-model]"); if (cardModel) { const n = project().nodes.find((x) => x.id === cardModel.dataset.cCardModel); if (!n) return; n.modelId = cardModel.value; state().selectedCanvasNode = n.id; persist(project()); structural(); return; } const f = e.target.closest("[data-c-setting]"); if (!f) return; const n = project().nodes.find((x) => x.id === state().selectedCanvasNode); if (!n) return; n.settings ||= {}; if (f.dataset.cSetting === "modelId") n.modelId = f.value; else n.settings[f.dataset.cSetting] = settingValue(f); if (isUtility(n)) { n.dirty = Boolean(n.result?.url); if (n.status === "success") n.status = "idle"; } persist(project()); structural(); });
    document.addEventListener("pointermove", (e) => { const stage = e.target.closest?.("[data-c-stage]") || root().querySelector("[data-c-stage]"); if (stage) lastPointerWorld = world(e, stage); });
    document.addEventListener("pointerdown", (e) => { const cut = e.target.closest("[data-c-edge-cut]"); if (cut?.dataset.edgeId) { e.preventDefault(); e.stopPropagation(); removeEdge(cut.dataset.edgeId); return; } if (e.target.closest("[data-c-connect-menu],[data-c-add],[data-c-quick]")) return; const stage = e.target.closest("[data-c-stage]"); if (!stage) return; const emptyStage = !e.target.closest(".c-node,[data-c-connect-menu],.c-library,.c-inspector"); if (e.button === 0 && emptyStage) { if (!(project()?.nodes || []).length && !state().canvasOnboardingDismissed) { e.preventDefault(); state().canvasOnboardingDismissed = true; structural(); return; } const now = performance.now(), tap = lastCanvasTap, doubleTap = tap && now - tap.t < 360 && Math.hypot(e.clientX - tap.x, e.clientY - tap.y) < 10; lastCanvasTap = { t: now, x: e.clientX, y: e.clientY }; if (doubleTap) { e.preventDefault(); mode = "menu"; operation = null; showConnectMenu(e); return; } } const handle = e.target.closest("[data-c-port-direction]"); if (handle) { e.preventDefault(); e.stopPropagation(); hideConnectMenu(); mode = "connecting"; operation = { connection: portMeta(handle.dataset.cNodeId, handle.dataset.cPortId, handle.dataset.cPortDirection, handle.dataset.cDataType) }; handle.setPointerCapture?.(e.pointerId); return; } const nodeEl = e.target.closest(".c-node[data-c-node-id]"); const resize = e.target.closest("[data-c-resize-node]"); if (resize && nodeEl) { e.preventDefault(); e.stopPropagation(); const p = project(), n = p.nodes.find((x) => x.id === resize.dataset.cResizeNode); const preview = nodeEl.querySelector(".c-media,.canvas-media-empty,.c-asset-preview,textarea"); select(n.id); mode = "resizing-node"; operation = { id: n.id, before: snapshot(p), startX: e.clientX, startY: e.clientY, width: Number(n.width || nodeEl.getBoundingClientRect().width / (p.viewport?.zoom || 1)), previewHeight: Number(n.previewHeight || 0) || (preview ? preview.getBoundingClientRect().height / (p.viewport?.zoom || 1) : 170), scale: Number(n.viewScale || 1) }; resize.setPointerCapture?.(e.pointerId); nodeEl.classList.add("resizing"); return; } const interactive = e.target.closest("input,textarea,select,button,video,audio,[contenteditable]"); if (interactive) { if (nodeEl) select(nodeEl.dataset.cNodeId, e.shiftKey || e.metaKey || e.ctrlKey); return; } if (nodeEl && e.target.closest("[data-c-drag-handle]")) { e.preventDefault(); const id = nodeEl.dataset.cNodeId; if (!selectedIds().includes(id) || e.shiftKey || e.metaKey || e.ctrlKey) select(id, e.shiftKey || e.metaKey || e.ctrlKey); if (e.altKey) duplicateSelection({ x: 0, y: 0 }); root().querySelectorAll(".c-node.selected").forEach((el) => el.classList.add("dragging")); const p = project(), n = p.nodes.find((x) => selectedIds().includes(x.id)), q = world(e, stage); mode = "dragging-node"; operation = { node: n, before: snapshot(p), start: q, nodes: selectedIds().map((nodeId) => { const x = p.nodes.find((z) => z.id === nodeId); return x ? { id: nodeId, x: x.x, y: x.y } : null; }).filter(Boolean) }; return; } if (e.button === 1 || (e.button === 0 && spaceDown)) { e.preventDefault(); mode = "panning"; operation = { x: e.clientX, y: e.clientY, viewport: { ...project().viewport } }; stage.classList.add("is-panning"); return; } if (e.button === 0) { e.preventDefault(); mode = "dragging-selection"; operation = { start: { x: e.clientX, y: e.clientY }, current: { x: e.clientX, y: e.clientY }, additive: e.shiftKey || e.metaKey || e.ctrlKey }; const box = root().querySelector("[data-c-marquee]"); box.hidden = false; box.style.left = `${e.clientX - stage.getBoundingClientRect().left}px`; box.style.top = `${e.clientY - stage.getBoundingClientRect().top}px`; } });
    document.addEventListener("pointermove", (e) => { const stage = root().querySelector("[data-c-stage]"); if (!stage || !operation) return; if (mode === "connecting") { preview(e); const opposite = operation.connection.direction === "output" ? "input" : "output"; const hit = document.elementFromPoint(e.clientX, e.clientY); const over = hit?.closest(`[data-c-port-direction='${opposite}']`); const overNode = hit?.closest(".c-node[data-c-node-id]"); root().querySelectorAll(".c-port.invalid,.c-port.target").forEach((x) => x.classList.remove("invalid", "target")); root().querySelectorAll(".c-node.connect-target").forEach((x) => x.classList.remove("connect-target")); if (over) over.classList.add("target"); else if (compatibleTargetsForNode(overNode).length) overNode.classList.add("connect-target"); return; } if (mode === "resizing-node") { const p = project(), n = p.nodes.find((x) => x.id === operation.id), el = root().querySelector(`[data-c-node-id="${CSS.escape(operation.id)}"]`); if (!n || !el) return; const zoom = p.viewport?.zoom || 1, dx = (e.clientX - operation.startX) / zoom, dy = (e.clientY - operation.startY) / zoom, d = def(n); const minW = d.modelKind ? 260 : 220, maxW = 1080, minH = n.type === "prompt" ? 110 : 120, maxH = 720; n.width = Math.round(Math.max(minW, Math.min(maxW, Number(operation.width || n.width || minW) + dx))); n.previewHeight = Math.round(Math.max(minH, Math.min(maxH, Number(operation.previewHeight || 170) + dy))); el.style.setProperty("--node-w", `${n.width}px`); el.style.setProperty("--preview-h", `${n.previewHeight}px`); updateActionBarPosition(); scheduleEdgeUpdate(new Set([n.id])); return; } if (mode === "dragging-node") { const p = project(), q = world(e, stage), dx = q.x - operation.start.x, dy = q.y - operation.start.y, moved = new Set(); for (const item of operation.nodes) { const n = p.nodes.find((x) => x.id === item.id); n.x = Math.round(item.x + dx); n.y = Math.round(item.y + dy); moved.add(n.id); } updateNodePositions(moved); return; } if (mode === "panning") { const p = project(); p.viewport.x = operation.viewport.x + e.clientX - operation.x; p.viewport.y = operation.viewport.y + e.clientY - operation.y; updateViewport(); return; } if (mode === "dragging-selection") { const r = stage.getBoundingClientRect(), x = Math.min(operation.start.x, e.clientX) - r.left, y = Math.min(operation.start.y, e.clientY) - r.top, w = Math.abs(e.clientX - operation.start.x), h = Math.abs(e.clientY - operation.start.y), box = root().querySelector("[data-c-marquee]"); box.style.left = `${x}px`; box.style.top = `${y}px`; box.style.width = `${w}px`; box.style.height = `${h}px`; operation.current = { x: e.clientX, y: e.clientY }; } });
    document.addEventListener("pointerup", (e) => { const current = operation; if (!current || e.target.closest("[data-c-connect-menu]")) return; const stage = root().querySelector("[data-c-stage]"); root().querySelectorAll(".c-node.dragging,.c-node.resizing").forEach((node) => node.classList.remove("dragging", "resizing")); stage?.classList.remove("is-panning"); if (mode === "connecting") { const opposite = current.connection.direction === "output" ? "input" : "output"; const hit = document.elementFromPoint(e.clientX, e.clientY); const over = hit?.closest(`[data-c-port-direction='${opposite}']`); if (over) { connect(connectTargetFromPort(over)); clearTransient(); hideConnectMenu(); mode = "idle"; operation = null; } else { const targets = compatibleTargetsForNode(hit?.closest(".c-node[data-c-node-id]")); if (targets.length === 1) { connect(targets[0]); clearTransient(); hideConnectMenu(); mode = "idle"; operation = null; } else if (targets.length > 1) { clearTransient(); operation = current; mode = "port-choice"; showPortChoiceMenu(e, targets); } else { clearTransient(); operation = current; mode = "menu"; showConnectMenu(e, current.connection); } } return; } else if (mode === "dragging-node" || mode === "resizing-node") { finishMutation(current.before); } else if (mode === "panning") { persist(project()); } else if (mode === "dragging-selection") { const a = world({ clientX: Math.min(current.start.x, current.current.x), clientY: Math.min(current.start.y, current.current.y) }, stage), b = world({ clientX: Math.max(current.start.x, current.current.x), clientY: Math.max(current.start.y, current.current.y) }, stage), ids = project().nodes.filter((n) => n.x < b.x && n.x + n.width > a.x && n.y < b.y + 160 && n.y + 160 > a.y).map((n) => n.id); state().selectedNodeIds = current.additive ? [...new Set([...selectedIds(), ...ids])] : ids; state().selectedCanvasNode = ids[0] || ""; root().querySelector("[data-c-marquee]").hidden = true; structural(); } mode = "idle"; operation = null; });
    document.addEventListener("mousemove", (e) => { const path = e.target.closest?.("[data-c-edge-id]"), menu = root().querySelector("[data-c-edge-menu]"); if (!menu) return; if (path) { clearTimeout(edgeMenuHideTimer); if (menu.hidden || menu.dataset.edgeId !== path.dataset.cEdgeId) { menu.dataset.edgeId = path.dataset.cEdgeId; menu.style.left = `${e.clientX}px`; menu.style.top = `${e.clientY}px`; } menu.hidden = false; } else if (!e.target.closest?.("[data-c-edge-menu]")) { clearTimeout(edgeMenuHideTimer); edgeMenuHideTimer = setTimeout(() => { if (!root().querySelector("[data-c-edge-menu]:hover")) menu.hidden = true; }, 90); } });
    document.addEventListener("wheel", (e) => { const stage = e.target.closest?.("[data-c-stage]"); if (!stage) return; if (e.target.closest?.("[data-c-connect-menu],.c-inspector")) return; const pinching = e.ctrlKey || e.metaKey || e.altKey; if (!pinching && e.target.closest?.("input,textarea,select,video,audio")) return; e.preventDefault(); const p = project(); p.viewport ||= { x: 0, y: 0, zoom: 1 }; if (pinching) { zoomBy(Math.max(-0.09, Math.min(0.09, -e.deltaY * 0.0025)), e); } else { const dx = Math.max(-120, Math.min(120, e.deltaX)); const dy = Math.max(-120, Math.min(120, e.deltaY)); p.viewport.x = clampNum(p.viewport.x - dx, -120000, 120000, 0); p.viewport.y = clampNum(p.viewport.y - dy, -120000, 120000, 0); updateViewport(); persist(p); } }, { passive: false });
    document.addEventListener("gesturestart", (e) => { if (!e.target.closest?.("[data-c-stage]") || e.target.closest?.(".c-inspector,[data-c-connect-menu]")) return; e.preventDefault(); }, { passive: false });
    document.addEventListener("gesturechange", (e) => { if (!e.target.closest?.("[data-c-stage]") || e.target.closest?.(".c-inspector,[data-c-connect-menu]")) return; e.preventDefault(); const scale = Number(e.scale || 1); if (Math.abs(scale - 1) > 0.01) zoomBy(Math.max(-0.08, Math.min(0.08, (scale - 1) * 0.08)), e); }, { passive: false });
    document.addEventListener("dblclick", (e) => { const stage = e.target.closest("[data-c-stage]"); if (!stage || e.target.closest(".c-node,[data-c-connect-menu],.c-library,.c-inspector")) return; e.preventDefault(); mode = "menu"; operation = null; showConnectMenu(e); });
    document.addEventListener("dragover", (e) => { const stage = e.target.closest("[data-c-stage]"); if (!stage || !e.dataTransfer?.types?.includes("Files")) return; e.preventDefault(); stage.classList.add("is-file-over"); });
    document.addEventListener("dragleave", (e) => { e.target.closest("[data-c-stage]")?.classList.remove("is-file-over"); });
    document.addEventListener("drop", async (e) => {
      const stage = e.target.closest("[data-c-stage]");
      if (!stage || !e.dataTransfer?.files?.length) return;
      e.preventDefault();
      stage.classList.remove("is-file-over");
      for (const file of [...e.dataTransfer.files]) {
        const isJson = file.type === "application/json" || /\.json$/i.test(file.name || "");
        if (isJson) {
          try {
            await window.__importCanvasWorkflowFile?.(file);
          } catch (err) {
            window.__canvasToast?.(err.message || "Could not import workflow JSON", "error");
          }
          continue;
        }
        if (file.type.startsWith("audio/")) {
          window.__canvasToast?.("Audio is hidden for now", "error");
          continue;
        }
        const dataUrl = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(file);
        });
        const asset = await window.__canvasApi("/api/assets", { method: "POST", body: JSON.stringify({ dataUrl, fileName: file.name, mimeType: file.type, label: file.name, role: "reference" }) });
        state().assets = asset.state?.assets || state().assets;
        const type = file.type.startsWith("video/") ? "videoInput" : "imageInput";
        add(type, world(e, stage), { exact: true, assetId: asset.asset.id });
      }
    });
    document.addEventListener("paste", (e) => { pasteCanvasEvent(e).catch((err) => window.__canvasToast?.(err.message || "Paste failed", "error")); });
    document.addEventListener("keydown", (e) => { if (state().view !== "canvas") return; if (e.code === "Space") spaceDown = true; const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName) || document.activeElement?.isContentEditable; const menuSearch = root().querySelector("[data-c-connect-menu]:not([hidden]) [data-c-connect-search]"); if (!typing && menuSearch && e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) { e.preventDefault(); menuSearch.focus({ preventScroll: true }); menuSearch.value += e.key; filterSearchMenu(menuSearch); return; } if (e.key === "Escape") { mode = "idle"; operation = null; hideConnectMenu(); clearTransient(); const box = root().querySelector("[data-c-marquee]"); if (box) box.hidden = true; return; } const key = e.key.toLowerCase(); if (!typing && (e.metaKey || e.ctrlKey) && key === "z") { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; } if (!typing && (e.metaKey || e.ctrlKey) && key === "y") { e.preventDefault(); redo(); return; } if (typing) return; if ((e.metaKey || e.ctrlKey) && key === "c" && selectedIds().length) { e.preventDefault(); copySelection(); return; } if ((e.metaKey || e.ctrlKey) && key === "d" && selectedIds().length) { e.preventDefault(); duplicateSelection(); return; } if ((e.key === "Delete" || e.key === "Backspace") && selectedIds().length) { const p = project(), ids = new Set(selectedIds()); commit(p, () => { p.nodes = p.nodes.filter((n) => !ids.has(n.id)); p.edges = p.edges.filter((x) => !ids.has(x.sourceNodeId) && !ids.has(x.targetNodeId)); }); state().selectedNodeIds = []; state().selectedCanvasNode = ""; structural(); } if ((e.metaKey || e.ctrlKey) && e.key === "Enter") runWorkflow(state().selectedCanvasNode); });
    document.addEventListener("keyup", (e) => { if (e.code === "Space") spaceDown = false; });
  }
  function incomingEdges(p, id, portId = "") { return (p.edges || []).filter((e) => e.targetNodeId === id && (!portId || (e.targetPortId || e.targetHandle) === portId)); }
  function outgoingEdges(p, id) { return (p.edges || []).filter((e) => e.sourceNodeId === id); }
  function nodeById(p, id) { return (p.nodes || []).find((n) => n.id === id); }
  function nodeText(n, p = project(), seen = new Set()) {
    if (!n) return "";
    if (n.type === "promptCombine") {
      if (seen.has(n.id)) return "";
      seen.add(n.id);
      const combined = sourceNodes(p, n.id)
        .map((source) => nodeText(source, p, seen))
        .filter((value) => String(value || "").trim())
        .join("\n\n");
      seen.delete(n.id);
      return combined || String(n.result?.text || "").trim();
    }
    return [n?.settings?.prompt, n?.prompt, n?.result?.text].find((value) => String(value || "").trim()) || "";
  }
  function sourceNodes(p, id, portId = "") { return incomingEdges(p, id, portId).map((e) => nodeById(p, e.sourceNodeId)).filter(Boolean); }
  function refsFor(p, id) {
    return incomingEdges(p, id).map((e) => {
      const n = nodeById(p, e.sourceNodeId);
      const result = outputResult(n);
      if (!result?.url) return null;
      const target = e.targetPortId || e.targetHandle || "reference";
      const role = target === "start" ? "start" : target === "end" ? "end" : target === "video" ? "reference" : target === "audio" ? "reference" : "reference";
      const asset = (state().assets || []).find((item) => item.id === result.assetId || item.id === n.assetId || item.url === result.url || item.sourceUrl === result.url || item.sourceMessageId === result.messageId);
      const stableUrl = asset?.url?.startsWith("/uploads/") ? asset.url : (result.renderedUrl || result.url);
      return {
        id: asset?.id || result.assetId || n.assetId || "",
        slug: asset?.slug || "",
        label: asset?.label || n.label || "",
        url: stableUrl,
        mimeType: asset?.mimeType || result.mimeType || `${result.renderedType || result.type || kind(n)}/generated`,
        role
      };
    }).filter(Boolean);
  }
  function assertInputsReady(p, n) {
    for (const edge of incomingEdges(p, n.id)) {
      if ((edge.targetPortId || edge.targetHandle) === "prompt") continue;
      const source = nodeById(p, edge.sourceNodeId);
      if (!source) continue;
      if (source.status === "cancelled") throw new Error(`Upstream node "${def(source).name}" was cancelled.`);
      const output = outputResult(source);
      if (source.status === "error" && !output?.url && !output?.text) throw new Error(`Upstream node "${def(source).name}" failed.`);
      if (!output?.url && !output?.text) throw new Error(`Upstream node "${def(source).name}" has no output.`);
    }
  }
  function transformedResult(p, n) {
    const source = sourceNodes(p, n.id)[0];
    const sourceResult = outputResult(source);
    if (!sourceResult?.url) return sourceResult || null;
    const outputType = n.type === "extractFrame" ? "image" : n.type === "trim" ? "video" : sourceResult.type || kind(source);
    const currentTransform = { type: n.type, settings: { ...(n.settings || {}) }, sourceNodeId: source.id };
    const operations = [...(sourceResult.operations || (sourceResult.transform ? [sourceResult.transform] : [])), currentTransform];
    return {
      ...sourceResult,
      type: outputType,
      sourceType: sourceResult.sourceType || sourceResult.type || kind(source),
      transform: currentTransform,
      operations
    };
  }
  function utilitySignature(p, n, sourceResult = null) {
    const source = sourceResult || outputResult(sourceNodes(p, n.id)[0]);
    return JSON.stringify({ type: n?.type || "", sourceUrl: source?.url || source?.text || "", sourceType: source?.type || "", settings: n?.settings || {} });
  }
  function outputResult(n) {
    if (!n) return null;
    const selected = selectedIteration(n);
    if (selected?.result?.url || selected?.result?.text) return selected.result;
    if (n.result?.url || n.result?.text) {
      if (n.result.renderedUrl) {
        const type = n.result.renderedType || n.result.type || kind(n);
        return { ...n.result, url: n.result.renderedUrl, type, sourceType: type, transform: null, operations: [] };
      }
      return n.result;
    }
    if (["imageInput", "videoInput", "audioInput"].includes(n.type)) {
      const asset = (state().assets || []).find((a) => a.id === n.assetId);
      if (asset) return { url: asset.url, type: kind(n), assetId: asset.id };
    }
    if (n.type === "promptCombine") {
      const text = nodeText(n);
      if (text) return { text, type: "text" };
    }
    return null;
  }
  function isUtility(n) { return ["trim", "extractFrame", "resize", "reference"].includes(n?.type); }
  function renderSignature(n) {
    return JSON.stringify({ url: n?.result?.url || "", ops: n?.result?.operations || [], settings: n?.settings || {} });
  }
  function refreshReactive(id, seen = new Set(), options = { save: true }) {
    const p = project(), n = p?.nodes.find((x) => x.id === id);
    if (!p || !n || seen.has(id)) return false;
    seen.add(id);
    let changed = false;
    if (isUtility(n)) {
      const nextSignature = utilitySignature(p, n);
      if (n.inputSignature && n.inputSignature !== nextSignature) {
        n.dirty = true;
        if (n.status === "success") n.status = "idle";
        changed = true;
      }
    }
    outgoingEdges(p, id).forEach((edge) => { changed = refreshReactive(edge.targetNodeId, seen, options) || changed; });
    if (changed && options.save !== false) persist(p);
    return changed;
  }
  async function materializeUtility(p, n) {
    const sourceResult = outputResult(sourceNodes(p, n.id)[0]);
    if (!sourceResult?.url && !sourceResult?.text) return null;
    if (n.type === "reference") return sourceResult;
    if (!sourceResult?.url) throw new Error("Connect media before running this utility.");
    n.status = "running";
    n.error = "";
    structural();
    const response = await window.__canvasApi("/api/canvas/utility", {
      method: "POST",
      body: JSON.stringify({ nodeType: n.type, settings: n.settings || {}, source: sourceResult })
    });
    if (response.state) {
      state().profile = response.state.profile || state().profile;
      state().settings = response.state.settings || state().settings;
      state().activeChat = response.state.activeChat || state().activeChat;
      state().chats = response.state.chats || state().chats;
      state().assets = response.state.assets || state().assets;
      state().canvasProjects = response.state.canvasProjects || state().canvasProjects;
    } else if (response.asset) {
      state().assets = [response.asset, ...(state().assets || []).filter((asset) => asset.id !== response.asset.id)];
    }
    return response.result || null;
  }
  async function waitForTask(type, taskId) {
    if (!taskId) return null;
    for (let i = 0; i < 90; i += 1) {
      const result = await window.__canvasApi(`/api/canvas/tasks/${encodeURIComponent(taskId)}?type=${encodeURIComponent(type)}`);
      if (result.state) {
        state().profile = result.state.profile || state().profile;
        state().settings = result.state.settings || state().settings;
        state().activeChat = result.state.activeChat || state().activeChat;
        state().chats = result.state.chats || state().chats;
        state().assets = result.state.assets || state().assets;
      }
      const message = result.message;
      if (message?.status === "success" || message?.status === "error") return message;
      await new Promise((resolve) => setTimeout(resolve, 2500));
    }
    throw new Error("Generation timed out.");
  }
  function recoverRunningNodes(p) {
    if (!p?.nodes?.length) return;
    for (const n of p.nodes) {
      if (!["queued", "running", "generating"].includes(n.status)) continue;
      if (activeRuns.has(n.id)) continue;
      if (!n.taskId) {
        n.status = "error";
        n.error = "Generation lost its KIE task id. Run this node again.";
        n.dirty = false;
        persist(p);
        continue;
      }
      const key = `${p.id}:${n.id}:${n.taskId}`;
      if (recoveryRuns.has(key)) continue;
      recoveryRuns.add(key);
      waitForTask(kind(n), n.taskId).then((message) => {
        const currentProject = project();
        const currentNode = currentProject?.nodes.find((x) => x.id === n.id);
        if (!currentNode || currentNode.taskId !== n.taskId) return;
        if (message?.result?.url) {
          rememberIteration(currentNode, message.result);
          currentNode.status = "success";
        } else if (message?.error) {
          throw new Error(message.error);
        } else if (message?.status === "success") {
          throw new Error("Generation finished without a media URL.");
        } else {
          currentNode.status = message?.status || currentNode.status;
        }
        currentNode.error = "";
        currentNode.dirty = false;
        outgoingEdges(currentProject, currentNode.id).forEach((edge) => refreshReactive(edge.targetNodeId, new Set(), { save: false }));
        persist(currentProject);
        structural();
        if (currentNode.status === "success" && !activeWorkflows.size && outgoingEdges(currentProject, currentNode.id).length) runDownstream(currentNode.id);
      }).catch((err) => {
        const currentProject = project();
        const currentNode = currentProject?.nodes.find((x) => x.id === n.id);
        if (currentNode && currentNode.taskId === n.taskId) {
          currentNode.status = "error";
          currentNode.error = err.message || "Generation failed";
          currentNode.dirty = false;
          persist(currentProject);
          structural();
        }
      }).finally(() => recoveryRuns.delete(key));
    }
  }
  async function runNode(id) {
    const initialProject = project(), initialNode = initialProject?.nodes.find((x) => x.id === id);
    if (!initialNode) return;
    if (initialNode.status === "cancelled") throw new Error("Node was cancelled.");
    activeRuns.add(id);
    initialNode.error = "";
    try {
      if (!def(initialNode).modelKind) {
        if (initialNode.type === "prompt") initialNode.result = { text: nodeText(initialNode), type: "text" };
        else if (initialNode.type === "promptCombine") initialNode.result = { text: nodeText(initialNode, initialProject), type: "text" };
        else if ((initialNode.type === "imageInput" || initialNode.type === "videoInput" || initialNode.type === "audioInput") && initialNode.result?.url) {
          initialNode.result = { ...initialNode.result, type: initialNode.result.type || kind(initialNode) };
        } else if (initialNode.type === "imageInput" || initialNode.type === "videoInput" || initialNode.type === "audioInput") {
          const asset = (state().assets || []).find((a) => a.id === initialNode.assetId);
          if (asset) initialNode.result = { url: asset.url, type: kind(initialNode), assetId: asset.id };
        } else if (["trim", "extractFrame", "resize", "reference"].includes(initialNode.type)) {
          const result = await materializeUtility(initialProject, initialNode);
          if (result) initialNode.result = result;
        } else {
          const source = sourceNodes(initialProject, initialNode.id)[0];
          if (source?.result) initialNode.result = source.result;
        }
        initialNode.status = initialNode.result?.url || initialNode.result?.text ? "success" : "idle";
        initialNode.dirty = false;
        if (isUtility(initialNode)) initialNode.inputSignature = utilitySignature(initialProject, initialNode);
        outgoingEdges(initialProject, initialNode.id).forEach((edge) => refreshReactive(edge.targetNodeId, new Set(), { save: false }));
        persist(initialProject);
        structural();
        return;
      }
      if (!initialNode.modelId) throw new Error("Choose a model first.");
      assertInputsReady(initialProject, initialNode);
      const k = kind(initialNode);
      const promptInputs = sourceNodes(initialProject, initialNode.id, "prompt").map((source) => nodeText(source, initialProject)).filter(Boolean);
      const prompt = [initialNode.settings?.prompt || initialNode.prompt, ...promptInputs].filter(Boolean).join("\n\n") || `Generate ${def(initialNode).name}`;
      preserveCurrentIteration(initialNode);
      initialNode.status = "generating"; initialNode.result = null; initialNode.dirty = false; initialNode.taskId = ""; structural();
      const result = await window.__canvasApi("/api/canvas/generate", { method: "POST", body: JSON.stringify({ type: k, prompt, options: { ...(state().options[k] || {}), ...(initialNode.settings || {}), model: initialNode.modelId }, refs: [...(initialNode.refs || []), ...refsFor(initialProject, initialNode.id)] }) });
      const taskId = result.message?.taskId;
      const messageId = result.message?.id;
      if (result.message?.error) throw new Error(result.message.error);
      if (!taskId && result.mode === "kie") throw new Error("KIE did not return a task id.");
      initialNode.taskId = taskId || "";
      initialNode.messageId = messageId || "";
      persist(initialProject); structural();
      const message = taskId ? await waitForTask(k, taskId) : result.message || null;
      const currentProject = project();
      const currentNode = currentProject?.nodes.find((x) => x.id === id);
      if (!currentNode) return;
      currentNode.taskId = taskId;
      currentNode.messageId = messageId;
      if (message?.result?.url) {
        rememberIteration(currentNode, message.result);
        currentNode.status = "success";
      } else if (message?.error) {
        throw new Error(message.error);
      } else if (message?.status === "success") {
        throw new Error("Generation finished without a media URL.");
      } else {
        currentNode.status = message?.status || currentNode.status;
      }
      currentNode.dirty = false;
      outgoingEdges(currentProject, currentNode.id).forEach((edge) => refreshReactive(edge.targetNodeId, new Set(), { save: false }));
      persist(currentProject); structural();
      if (currentNode.status === "success" && !activeWorkflows.size && outgoingEdges(currentProject, currentNode.id).length) runDownstream(currentNode.id);
    } catch (err) {
      const currentProject = project();
      const currentNode = currentProject?.nodes.find((x) => x.id === id) || initialNode;
      if (currentNode) { currentNode.status = "error"; currentNode.error = err.message || "Node failed"; }
      persist(currentProject || initialProject); structural(); throw err;
    } finally {
      activeRuns.delete(id);
    }
  }
  function executionOrder(p, startId = "") {
    const selected = new Set();
    if (startId) {
      const queue = [startId];
      while (queue.length) {
        const id = queue.shift();
        if (selected.has(id)) continue;
        selected.add(id);
        outgoingEdges(p, id).forEach((e) => queue.push(e.targetNodeId));
      }
      function includeAncestors(id) {
        incomingEdges(p, id).forEach((e) => {
          if (!selected.has(e.sourceNodeId)) selected.add(e.sourceNodeId);
          includeAncestors(e.sourceNodeId);
        });
      }
      [...selected].forEach(includeAncestors);
    } else p.nodes.forEach((n) => selected.add(n.id));
    const order = [], visited = new Set(), visiting = new Set();
    function visit(id) {
      if (!selected.has(id) || visited.has(id)) return;
      if (visiting.has(id)) throw new Error("Cycle detected. Remove a connection before running.");
      visiting.add(id);
      incomingEdges(p, id).forEach((e) => visit(e.sourceNodeId));
      visiting.delete(id); visited.add(id); order.push(id);
    }
    p.nodes.forEach((n) => visit(n.id));
    return order;
  }
  function workflowScope(p, startId = "") {
    const order = executionOrder(p, startId);
    if (!startId) return new Set(order);
    const downstream = new Set();
    const queue = [startId];
    while (queue.length) {
      const id = queue.shift();
      if (downstream.has(id)) continue;
      downstream.add(id);
      outgoingEdges(p, id).forEach((edge) => queue.push(edge.targetNodeId));
    }
    const ancestors = new Set();
    function includeAncestors(id) {
      incomingEdges(p, id).forEach((edge) => {
        if (ancestors.has(edge.sourceNodeId)) return;
        ancestors.add(edge.sourceNodeId);
        includeAncestors(edge.sourceNodeId);
      });
    }
    downstream.forEach(includeAncestors);
    return new Set([...ancestors, ...downstream].filter((id) => order.includes(id)));
  }
  function nodeReadyForWorkflow(p, id, pending) {
    const n = nodeById(p, id);
    if (!n || activeRuns.has(id)) return false;
    return incomingEdges(p, id).every((edge) => {
      const source = nodeById(p, edge.sourceNodeId);
      if (!source) return true;
      if (pending.has(source.id)) return false;
      if ((edge.targetPortId || edge.targetHandle) === "prompt") return true;
      const result = outputResult(source);
      if ((source.status === "error" || source.status === "cancelled") && !result?.url && !result?.text) return false;
      return Boolean(result?.url || result?.text);
    });
  }
  function shouldRunInWorkflow(p, id, startId, scope) {
    const n = nodeById(p, id);
    if (!n) return false;
    if (!startId || id === startId) return true;
    const isDownstream = (() => {
      const seen = new Set(), queue = [startId];
      while (queue.length) {
        const next = queue.shift();
        if (next === id) return true;
        if (seen.has(next)) continue;
        seen.add(next);
        outgoingEdges(p, next).forEach((edge) => queue.push(edge.targetNodeId));
      }
      return false;
    })();
    if (isDownstream) return true;
    const result = outputResult(n);
    if (result?.url || result?.text) return false;
    return scope.has(id);
  }
  function downstreamScope(p, startId) {
    const found = new Set();
    const queue = outgoingEdges(p, startId).map((edge) => edge.targetNodeId);
    while (queue.length) {
      const id = queue.shift();
      if (found.has(id)) continue;
      found.add(id);
      outgoingEdges(p, id).forEach((edge) => queue.push(edge.targetNodeId));
    }
    return found;
  }
  async function drainWorkflowQueue(p, pending) {
    while (pending.size) {
      const current = project() || p;
      const ready = [...pending].filter((id) => nodeReadyForWorkflow(current, id, pending));
      if (!ready.length) throw new Error("Workflow is waiting for an upstream result that is missing or failed.");
      const settled = await Promise.allSettled(ready.map((id) => runNode(id).then(() => id)));
      for (const item of settled) {
        if (item.status === "fulfilled") pending.delete(item.value);
        else throw item.reason || new Error("Workflow failed");
      }
    }
  }
  async function runDownstream(startId) {
    const p = project(); if (!p || !startId) return;
    const workflowKey = `${p.id}:downstream:${startId}`;
    if (activeWorkflows.has(workflowKey)) return;
    activeWorkflows.add(workflowKey);
    try {
      const scope = downstreamScope(p, startId);
      const pending = new Set([...scope].filter((id) => shouldRunInWorkflow(p, id, "", scope)));
      await drainWorkflowQueue(p, pending);
    } catch (err) {
      window.__canvasToast?.(err.message || "Workflow failed", "error");
    } finally {
      activeWorkflows.delete(workflowKey);
    }
  }
  async function runWorkflow(startId = "") {
    const p = project(); if (!p) return;
    const workflowKey = `${p.id}:${startId || "all"}`;
    if (activeWorkflows.has(workflowKey)) return;
    activeWorkflows.add(workflowKey);
    try {
      const order = executionOrder(p, startId);
      const scope = workflowScope(p, startId);
      const pending = new Set(order.filter((id) => scope.has(id) && shouldRunInWorkflow(p, id, startId, scope)));
      await drainWorkflowQueue(p, pending);
      window.__canvasToast?.("Workflow finished", "success");
    } catch (err) {
      window.__canvasToast?.(err.message || "Workflow failed", "error");
    } finally {
      activeWorkflows.delete(workflowKey);
    }
  }
  window.__canvasRegistry = registry; window.__renderCanvasV2 = () => { bind(); queueMicrotask(fitMediaRatios); requestAnimationFrame(() => { fitMediaRatios(); updateEdgePaths(); requestAnimationFrame(updateEdgePaths); }); return render(); };
})();
