import { tempoCpm } from "./pattern.js";

const KEY = "pattern-reader.presets.v1";

export function loadPresets() {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function persistPresets(list) {
  localStorage.setItem(KEY, JSON.stringify(list));
}

function serializeRegion(region) {
  return {
    id: region.id,
    name: region.name,
    bank: region.bank || "auto",
    muted: Boolean(region.muted),
    steps: region.steps,
    thresh: region.thresh,
    u: region.u,
    v: region.v,
    uw: region.uw,
    vh: region.vh,
    sequence: region.sequence || [],
    vals: region.vals || [],
    timbre: region.timbre || null,
    meta: region.meta || null,
  };
}

export function snapshotPreset({ id, name, createdAt, settings, regions, userBase, userOverlay }) {
  const now = new Date().toISOString();
  return {
    id: id || crypto.randomUUID(),
    name: (name || "").trim() || "Untitled",
    createdAt: createdAt || now,
    updatedAt: now,
    bpm: settings.bpm,
    cpm: tempoCpm(settings),
    settings: { ...settings },
    regions: (regions || []).map(serializeRegion),
    userBase: userBase || "",
    userOverlay: userOverlay || "",
  };
}

export function nextPresetName(list) {
  const n = (list?.length || 0) + 1;
  return `Preset ${n}`;
}

export function formatStamp(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
