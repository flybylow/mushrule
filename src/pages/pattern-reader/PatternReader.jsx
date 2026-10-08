import { useCallback, useEffect, useRef, useState } from "react";
import tabletUrl from "./assets/tablet.jpg";
import { extractRegionFromCanvas } from "./useExtraction.js";
import { initialSensors, useSensors } from "./useSensors.js";
import { useStrudel } from "./useStrudel.js";
import { activePattern, composeSong, generateBaseParts, pickRandomSample, pitchDirOf, PITCHED_BANKS, RHYTHM_BANKS, SYNTH_OSCS, tempoCpm } from "./pattern.js";
import { formatStamp, loadPresets, nextPresetName, persistPresets, PRESET_KEY, snapshotPreset } from "./presets.js";

const COLORS = ["#9a7a4a", "#4a7a9a", "#7a9a4a", "#9a4a7a", "#4a9a8a", "#9a5a4a"];
const STEP_CHOICES = [8, 16, 32, 64];
const STEPS_MIN = 1;
const STEPS_MAX = 64;
const THRESH_MIN = 0;
const THRESH_MAX = 255;

function clampSteps(n) {
  const v = Math.round(Number(n));
  if (!Number.isFinite(v)) return 16;
  return Math.max(STEPS_MIN, Math.min(STEPS_MAX, v));
}

function clampThresh(n) {
  const v = Math.round(Number(n));
  if (!Number.isFinite(v)) return 100;
  return Math.max(THRESH_MIN, Math.min(THRESH_MAX, v));
}

function scanOf(region, settings) {
  const steps = region?.steps != null ? clampSteps(region.steps) : clampSteps(settings.steps);
  const thresh = clampThresh(Number.isFinite(region?.thresh) ? region.thresh : settings.thresh);
  return { steps, thresh };
}

function resizePattern(region, steps) {
  const n = clampSteps(steps);
  const prevSeq = region.sequence || [];
  const prevVals = region.vals || [];
  const keep = Math.max(prevSeq.length, prevVals.length, n);
  if (region.steps === n && prevSeq.length === keep && prevVals.length === keep) return region;
  return {
    ...region,
    steps: n,
    sequence: Array.from({ length: keep }, (_, i) => (prevSeq[i] ? 1 : 0)),
    vals: Array.from({ length: keep }, (_, i) => (Number.isFinite(prevVals[i]) ? prevVals[i] : 0)),
  };
}

function rememberExtract(region, extracted) {
  if (!extracted) return region;
  const extSeq = extracted.sequence || [];
  const extVals = extracted.vals || [];
  const n = extSeq.length;
  const prevSeq = region.sequence || [];
  const prevVals = region.vals || [];
  const keep = Math.max(prevSeq.length, prevVals.length, n);
  return {
    ...region,
    ...extracted,
    sequence: Array.from({ length: keep }, (_, i) => (i < n ? (extSeq[i] ? 1 : 0) : prevSeq[i] ? 1 : 0)),
    vals: Array.from({ length: keep }, (_, i) => (i < n ? extVals[i] : Number.isFinite(prevVals[i]) ? prevVals[i] : 0)),
  };
}

const DEFAULT_SETTINGS = {
  steps: 16,
  thresh: 100,
  axis: "x",
  channel: "edge",
  scaleKey: "penta",
  rootNote: "d3",
  pitchDir: "up",
  bpm: 40,
};

function SpeakerIcon({ muted }) {
  return (
    <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
      <path d="M2.5 6.2h2.2L8 3.5v9L4.7 9.8H2.5z" fill="currentColor" />
      {muted ? (
        <path
          d="M10.2 5.2l4.2 5.6M14.4 5.2l-4.2 5.6"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinecap="square"
        />
      ) : (
        <path
          d="M10.4 6.1c.9.8.9 3 0 3.8M12.6 4.4c1.8 1.6 1.8 5.6 0 7.2"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.2"
          strokeLinecap="square"
        />
      )}
    </svg>
  );
}

function SlidersIcon() {
  return (
    <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
      <path d="M3 2v12M8 2v12M13 2v12" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <rect x="1.5" y="5" width="3" height="2" fill="currentColor" />
      <rect x="6.5" y="9" width="3" height="2" fill="currentColor" />
      <rect x="11.5" y="4" width="3" height="2" fill="currentColor" />
    </svg>
  );
}

function StepsControl({ value, onChange, name }) {
  const options = STEP_CHOICES.includes(value) ? STEP_CHOICES : [...STEP_CHOICES, value].sort((a, b) => a - b);
  return (
    <span className="pr-stepper">
      <button
        type="button"
        className="pr-step-btn"
        aria-label={`Fewer ${name || "track"} steps`}
        disabled={value <= STEPS_MIN}
        onClick={(event) => {
          event.stopPropagation();
          onChange(clampSteps(value - 1));
        }}
      >
        −
      </button>
      <select
        className="pr-steps"
        value={value}
        aria-label={`${name || "Track"} steps`}
        onClick={(event) => event.stopPropagation()}
        onChange={(event) => {
          event.stopPropagation();
          onChange(clampSteps(event.target.value));
        }}
      >
        {options.map((n) => (
          <option key={n} value={n}>
            {n}
          </option>
        ))}
      </select>
      <button
        type="button"
        className="pr-step-btn"
        aria-label={`More ${name || "track"} steps`}
        disabled={value >= STEPS_MAX}
        onClick={(event) => {
          event.stopPropagation();
          onChange(clampSteps(value + 1));
        }}
      >
        +
      </button>
    </span>
  );
}

function ThreshControl({ value, onChange, name }) {
  return (
    <div className="pr-row">
      <label>Threshold</label>
      <input
        type="range"
        min={THRESH_MIN}
        max={THRESH_MAX}
        value={value}
        aria-label={`${name || "Track"} threshold`}
        onChange={(event) => onChange(clampThresh(event.target.value))}
      />
      <span className="pr-stepper">
        <button
          type="button"
          className="pr-step-btn"
          aria-label={`Lower ${name || "track"} threshold`}
          disabled={value <= THRESH_MIN}
          onClick={(event) => {
            event.stopPropagation();
            onChange(clampThresh(value - 1));
          }}
        >
          −
        </button>
        <span className="pr-val">{value}</span>
        <button
          type="button"
          className="pr-step-btn"
          aria-label={`Raise ${name || "track"} threshold`}
          disabled={value >= THRESH_MAX}
          onClick={(event) => {
            event.stopPropagation();
            onChange(clampThresh(value + 1));
          }}
        >
          +
        </button>
      </span>
    </div>
  );
}

function BankSelect({ value, onChange }) {
  return (
    <select
      className="pr-bank"
      value={value || "auto"}
      aria-label="Bank"
      onClick={(event) => event.stopPropagation()}
      onChange={(event) => {
        event.stopPropagation();
        onChange(event.target.value);
      }}
    >
      <option value="auto">auto</option>
      <optgroup label="Synths">
        {SYNTH_OSCS.map((name) => (
          <option key={name} value={name}>
            {name}
          </option>
        ))}
      </optgroup>
      <optgroup label="Pitched">
        {PITCHED_BANKS.map((name) => (
          <option key={name} value={name}>
            {name}
          </option>
        ))}
      </optgroup>
      <optgroup label="Rhythm">
        {RHYTHM_BANKS.map((name) => (
          <option key={name} value={name}>
            {name}
          </option>
        ))}
      </optgroup>
    </select>
  );
}

function fitImage(cw, ch, iw, ih) {
  const sc = Math.min(cw / iw, ch / ih);
  const w = iw * sc;
  const h = ih * sc;
  return { x: (cw - w) / 2, y: (ch - h) / 2, w, h };
}

function regionCanvasRect(region, layout) {
  return {
    x: layout.x + region.u * layout.w,
    y: layout.y + region.v * layout.h,
    w: region.uw * layout.w,
    h: region.vh * layout.h,
  };
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

export function PatternReader() {
  const wrapRef = useRef(null);
  const imgCanvasRef = useRef(null);
  const ovrCanvasRef = useRef(null);
  const imgRef = useRef(null);
  const fileRef = useRef(null);
  const leftHostRef = useRef(null);
  const editorHostRef = useRef(null);
  const exportCount = useRef(0);
  const dragRef = useRef(null);
  const drawRectRef = useRef(null);

  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [regions, setRegions] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [status, setStatus] = useState("Cuneiform tablet loaded — draw a region");
  const [layoutTick, setLayoutTick] = useState(0);
  const [drawRect, setDrawRect] = useState(null);
  const [panel, setPanel] = useState(null);
  const [copied, setCopied] = useState(false);
  const [presets, setPresets] = useState(() => loadPresets());
  const [presetId, setPresetId] = useState(null);
  const [presetName, setPresetName] = useState("");
  const [openScan, setOpenScan] = useState({});
  const [openFold, setOpenFold] = useState({ scan: false, sensors: false });
  const [editingNameId, setEditingNameId] = useState(null);
  const [nameDraft, setNameDraft] = useState("");
  const skipRenameRef = useRef(false);

  const settingsRef = useRef(settings);
  const regionsRef = useRef(regions);
  const sensorsRef = useRef(initialSensors());
  settingsRef.current = settings;
  regionsRef.current = regions;

  const getCpm = useCallback(() => tempoCpm(settingsRef.current), []);
  const getMuted = useCallback(
    () => regionsRef.current.filter((region) => region.muted).map((region) => region.name).filter(Boolean),
    [],
  );
  const strudel = useStrudel(leftHostRef, editorHostRef, getCpm, getMuted);
  const sensors = useSensors(strudel.playing);
  sensorsRef.current = sensors;

  const active = regions.find((r) => r.id === activeId) || null;
  const footSteps = active?.sequence?.length || settings.steps;
  const playStep = Math.floor(strudel.phase * footSteps) % footSteps;

  const paintImage = useCallback(() => {
    const wrap = wrapRef.current;
    const canvas = imgCanvasRef.current;
    const img = imgRef.current;
    if (!wrap || !canvas || !img) return null;
    const w = wrap.clientWidth;
    const h = wrap.clientHeight;
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    const layout = fitImage(w, h, img.naturalWidth, img.naturalHeight);
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(img, layout.x, layout.y, layout.w, layout.h);
    canvas._layout = layout;
    return layout;
  }, []);

  const paintOverlay = useCallback(
    (liveRegions = regions, liveDraw = drawRect) => {
      const wrap = wrapRef.current;
      const canvas = ovrCanvasRef.current;
      const imgCanvas = imgCanvasRef.current;
      if (!wrap || !canvas) return;
      const w = wrap.clientWidth;
      const h = wrap.clientHeight;
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      ctx.clearRect(0, 0, w, h);
      const layout = imgCanvas?._layout;
      if (!layout) return;
      liveRegions.forEach((region, i) => {
        const rect = regionCanvasRect(region, layout);
        const col = COLORS[i % COLORS.length];
        const isA = region.id === activeId;
        ctx.strokeStyle = col;
        ctx.lineWidth = isA ? 2 : 1;
        ctx.globalAlpha = region.muted ? 0.28 : isA ? 1 : 0.6;
        ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);
        ctx.fillStyle = col;
        ctx.globalAlpha = region.muted ? 0.02 : 0.06;
        ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
        ctx.globalAlpha = 1;
        ctx.fillStyle = col;
        ctx.font = "10px Courier New";
        ctx.fillText(region.name, rect.x + 4, rect.y + 11);
        const live = activePattern(region).sequence;
        if (strudel.playing && !region.muted && live.length) {
          const head = Math.floor(strudel.phase * live.length) % live.length;
          const t = head / live.length;
          ctx.strokeStyle = isA ? "#fff6" : "#fff3";
          ctx.lineWidth = 1;
          ctx.beginPath();
          if (settings.axis === "y") {
            const py = rect.y + t * rect.h;
            ctx.moveTo(rect.x, py);
            ctx.lineTo(rect.x + rect.w, py);
          } else if (settings.axis === "diag") {
            ctx.moveTo(rect.x + t * rect.w, rect.y + t * rect.h - 8);
            ctx.lineTo(rect.x + t * rect.w, rect.y + t * rect.h + 8);
          } else {
            const px = rect.x + t * rect.w;
            ctx.moveTo(px, rect.y);
            ctx.lineTo(px, rect.y + rect.h);
          }
          ctx.stroke();
        }
      });
      if (liveDraw) {
        ctx.strokeStyle = "#fff5";
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 3]);
        ctx.strokeRect(liveDraw.x, liveDraw.y, liveDraw.w, liveDraw.h);
        ctx.setLineDash([]);
      }
    },
    [activeId, drawRect, regions, settings.axis, strudel.phase, strudel.playing],
  );

  const extractAll = useCallback(
    (nextRegions, nextSettings = settingsRef.current) => {
      const ctx = imgCanvasRef.current?.getContext("2d", { willReadFrequently: true });
      const layout = imgCanvasRef.current?._layout;
      if (!ctx || !layout) return nextRegions;
      return nextRegions.map((region) => {
        const extracted = extractRegionFromCanvas(ctx, regionCanvasRect(region, layout), {
          ...nextSettings,
          ...scanOf(region, nextSettings),
        });
        return rememberExtract(region, extracted);
      });
    },
    [],
  );

  const loadImage = useCallback(
    (src, label) => {
      const img = new Image();
      img.onload = () => {
        imgRef.current = img;
        paintImage();
        setRegions((prev) => extractAll(prev));
        setLayoutTick((n) => n + 1);
        setStatus(label);
      };
      img.src = src;
    },
    [extractAll, paintImage],
  );

  useEffect(() => {
    loadImage(tabletUrl, "Cuneiform tablet loaded — draw a region");
  }, [loadImage]);

  useEffect(() => {
    const onStorage = (event) => {
      if (event.key !== PRESET_KEY) return;
      setPresets(loadPresets());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  useEffect(() => {
    const onResize = () => {
      paintImage();
      setRegions((prev) => extractAll(prev));
      setLayoutTick((n) => n + 1);
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [extractAll, paintImage]);

  useEffect(() => {
    paintOverlay();
  }, [paintOverlay, layoutTick]);

  useEffect(() => {
    setRegions((prev) => extractAll(prev, settings));
  }, [extractAll, settings.axis, settings.channel]);

  useEffect(() => {
    const { body } = generateBaseParts(regions, settings);
    if (body !== strudel.getLeft()) strudel.seedLeft(body);
    if (strudel.playing) void strudel.update();
  }, [regions, settings.scaleKey, settings.rootNote, settings.pitchDir, settings.bpm, strudel.seedLeft, strudel.update, strudel.playing]);

  useEffect(() => {
    paintImage();
    setLayoutTick((n) => n + 1);
  }, [panel, paintImage]);

  const setField = (key, value) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
  };

  const pointerPos = (event) => {
    const box = ovrCanvasRef.current.getBoundingClientRect();
    return { x: event.clientX - box.left, y: event.clientY - box.top };
  };

  const onPointerDown = (event) => {
    if (!imgRef.current) return;
    const p = pointerPos(event);
    const layout = imgCanvasRef.current?._layout;
    if (!layout) return;
    const hit = [...regions].reverse().find((region) => {
      const r = regionCanvasRect(region, layout);
      return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
    });
    if (hit && !event.shiftKey) {
      setActiveId(hit.id);
      return;
    }
    const startRect = { x: p.x, y: p.y, w: 0, h: 0 };
    dragRef.current = p;
    drawRectRef.current = startRect;
    setDrawRect(startRect);
  };

  const onPointerMove = (event) => {
    if (!dragRef.current) return;
    const p = pointerPos(event);
    const start = dragRef.current;
    const rect = {
      x: Math.min(start.x, p.x),
      y: Math.min(start.y, p.y),
      w: Math.abs(p.x - start.x),
      h: Math.abs(p.y - start.y),
    };
    drawRectRef.current = rect;
    setDrawRect(rect);
    paintOverlay(regions, rect);
  };

  const onPointerUp = async () => {
    const rect = drawRectRef.current;
    dragRef.current = null;
    drawRectRef.current = null;
    setDrawRect(null);
    const layout = imgCanvasRef.current?._layout;
    if (!rect || !layout || rect.w < 8 || rect.h < 8) {
      paintOverlay(regions, null);
      return;
    }
    const region = {
      id: Date.now(),
      name: `R${regions.length + 1}`,
      bank: pickRandomSample(regions.map((region) => region.bank)),
      muted: false,
      steps: settingsRef.current.steps,
      thresh: settingsRef.current.thresh,
      u: (rect.x - layout.x) / layout.w,
      v: (rect.y - layout.y) / layout.h,
      uw: rect.w / layout.w,
      vh: rect.h / layout.h,
    };
    const next = extractAll([...regions, region]);
    const created = next[next.length - 1];
    regionsRef.current = next;
    setRegions(next);
    setActiveId(created.id);
    setOpenScan((prev) => ({ ...prev, [created.id]: true }));
    setStatus(`Region ${created.name} extracted`);
    const { body } = generateBaseParts(next, settingsRef.current);
    if (body) strudel.seedLeft(body);
    if (!strudel.playing) {
      await strudel.start();
      setStatus("Playing — embedded Strudel");
    }
  };

  const togglePlay = async () => {
    if (strudel.playing) {
      strudel.stop();
      setStatus("Stopped");
      return;
    }
    if (!regions.length) {
      setStatus("Draw a region first");
      return;
    }
    await strudel.start();
    setStatus("Playing — embedded Strudel");
  };

  const togglePlayRef = useRef(togglePlay);
  togglePlayRef.current = togglePlay;

  useEffect(() => {
    const onKey = (event) => {
      if (event.target.closest?.(".cm-editor")) return;
      if (event.code === "Space" && event.target.tagName !== "INPUT" && event.target.tagName !== "SELECT") {
        event.preventDefault();
        togglePlayRef.current();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const onFile = (file) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => loadImage(ev.target.result, "Image loaded");
    reader.readAsDataURL(file);
  };

  const clearRegions = () => {
    setRegions([]);
    setActiveId(null);
    strudel.stop();
    setStatus("Cleared");
  };

  const toggleStep = (id, index) => {
    setActiveId(id);
    setRegions((prev) =>
      prev.map((region) => {
        if (region.id !== id || !region.sequence) return region;
        const sequence = region.sequence.map((v, i) => (i === index ? v ^ 1 : v));
        return { ...region, sequence };
      }),
    );
  };

  const pushRegions = (next) => {
    regionsRef.current = next;
    setRegions(next);
  };

  const setRegionBank = (id, bank) => {
    setActiveId(id);
    pushRegions(regionsRef.current.map((region) => (region.id === id ? { ...region, bank } : region)));
  };

  const setRegionName = (id, name) => {
    const trimmed = (name || "").trim() || "R";
    pushRegions(regionsRef.current.map((region) => (region.id === id ? { ...region, name: trimmed } : region)));
  };

  const setRegionScan = (id, patch) => {
    setActiveId(id);
    const next = regionsRef.current.map((region) => (region.id === id ? { ...region, ...patch } : region));
    pushRegions(extractAll(next, settingsRef.current));
  };

  const setRegionSteps = (id, steps) => {
    setActiveId(id);
    pushRegions(regionsRef.current.map((region) => (region.id === id ? resizePattern(region, steps) : region)));
  };

  const toggleScanOpen = (id) => {
    setActiveId(id);
    setOpenScan((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const beginRename = (region) => {
    skipRenameRef.current = false;
    setActiveId(region.id);
    setNameDraft(region.name);
    setEditingNameId(region.id);
  };

  const commitRename = (id) => {
    if (skipRenameRef.current) {
      skipRenameRef.current = false;
      setEditingNameId(null);
      return;
    }
    if (editingNameId !== id) return;
    setRegionName(id, nameDraft);
    setEditingNameId(null);
  };

  const toggleRegionMute = (id) => {
    setActiveId(id);
    const next = regionsRef.current.map((region) => (region.id === id ? { ...region, muted: !region.muted } : region));
    regionsRef.current = next;
    setRegions(next);
  };

  const deleteRegion = (id) => {
    setRegions((prev) => {
      const next = prev.filter((r) => r.id !== id);
      setActiveId((cur) => (cur === id ? next[next.length - 1]?.id || null : cur));
      return next;
    });
  };

  const exportJson = () => {
    const now = new Date();
    const stamp = `${now.getFullYear()}${pad2(now.getMonth() + 1)}${pad2(now.getDate())}-${pad2(now.getHours())}${pad2(now.getMinutes())}`;
    const fname = `004_pattern-reader_${stamp}_${String(++exportCount.current).padStart(3, "0")}.json`;
    const layout = imgCanvasRef.current?._layout;
    const payload = {
      exportedAt: now.toISOString(),
      settings,
      sensors: Object.fromEntries(
        Object.entries(sensors).map(([k, s]) => [k, { min: s.min, max: s.max, val: Number(s.val.toFixed(2)) }]),
      ),
      userBase: strudel.getLeft(),
      userOverlay: strudel.getRight(),
      strudelCode: composeSong(strudel.getLeft(), strudel.getRight(), tempoCpm(settings), getMuted()).code,
      regions: regions.map((region, i) => {
        const bounds = layout
          ? regionCanvasRect(region, layout)
          : { x: 0, y: 0, w: 0, h: 0 };
        return {
          id: i + 1,
          name: region.name,
          bank: region.bank || "auto",
          muted: Boolean(region.muted),
          steps: region.steps,
          thresh: region.thresh,
          timbre: region.timbre,
          bounds: {
            x: Math.round(bounds.x),
            y: Math.round(bounds.y),
            w: Math.round(bounds.w),
            h: Math.round(bounds.h),
          },
          meta: region.meta,
          sequence: region.sequence || [],
          vals: region.vals || [],
        };
      }),
    };
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }));
    a.download = fname;
    a.click();
    setStatus(`Exported: ${fname}`);
  };

  const baseParts = generateBaseParts(regions, settings);
  const composed = composeSong(strudel.getLeft(), strudel.getRight(), tempoCpm(settings), getMuted()).code;
  const cpm = tempoCpm(settings);

  const copyCode = async () => {
    if (!composed) {
      setStatus("Draw a region first");
      return;
    }
    try {
      await navigator.clipboard.writeText(composed);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
      setStatus("Copied composed Strudel");
    } catch {
      setStatus("Copy failed");
    }
  };

  const updateFromEditor = async () => {
    if (!strudel.getLeft().trim() && !strudel.getRight().trim()) {
      setStatus("Draw a region or type in either pane");
      return;
    }
    await strudel.update(true);
    setStatus("Updated — both panes play as one song");
  };

  const fromImage = async () => {
    strudel.seedLeft(baseParts.body);
    if (strudel.playing || baseParts.body) await strudel.update(true);
    setStatus(baseParts.body ? "Left pane reset from image" : "Draw a region first");
  };

  const selectedPreset = presets.find((p) => p.id === presetId) || null;

  const writePresets = (list) => {
    persistPresets(list);
    setPresets(list);
  };

  const capturePreset = (id, createdAt, name) =>
    snapshotPreset({
      id,
      createdAt,
      name,
      settings,
      regions,
      userBase: strudel.getLeft(),
      userOverlay: strudel.getRight(),
    });

  const savePreset = (overwrite) => {
    if (overwrite && !selectedPreset) {
      setStatus("Select a preset to update");
      return;
    }
    const snap = overwrite
      ? capturePreset(selectedPreset.id, selectedPreset.createdAt, presetName || selectedPreset.name)
      : capturePreset(undefined, undefined, presetName || nextPresetName(presets));
    const list = overwrite
      ? presets.map((p) => (p.id === snap.id ? snap : p))
      : [snap, ...presets];
    writePresets(list);
    setPresetId(snap.id);
    setPresetName(snap.name);
    setStatus(overwrite ? `Updated ${snap.name}` : `Saved ${snap.name}`);
  };

  const loadPreset = async (preset = selectedPreset) => {
    if (!preset) {
      setStatus("Select a preset");
      return;
    }
    const nextSettings = { ...DEFAULT_SETTINGS, ...preset.settings, pitchDir: pitchDirOf({ ...DEFAULT_SETTINGS, ...preset.settings }) };
    const used = [];
    const next = (preset.regions || []).map((region) => {
      const bank = region.bank && region.bank !== "auto" ? region.bank : pickRandomSample(used);
      used.push(bank);
      return { ...region, bank, muted: Boolean(region.muted) };
    });
    settingsRef.current = nextSettings;
    setSettings(nextSettings);
    regionsRef.current = next;
    setRegions(next);
    setActiveId(next[0]?.id || null);
    strudel.seedRight(preset.userOverlay || "");
    if (strudel.playing) await strudel.update(true);
    setPresetName(preset.name);
    setStatus(`Loaded ${preset.name}`);
  };

  const deletePreset = () => {
    if (!selectedPreset) {
      setStatus("Select a preset");
      return;
    }
    const list = presets.filter((p) => p.id !== selectedPreset.id);
    writePresets(list);
    const next = list[0] || null;
    setPresetId(next?.id || null);
    setPresetName(next?.name || "");
    setStatus(`Deleted ${selectedPreset.name}`);
  };

  const openPanel = (name) => {
    setPanel((cur) => (cur === name ? null : name));
  };

  return (
    <div className={`pr${panel ? " panel-open" : ""}`}>
      <header className="pr-header">
        <h1>PATTERN READER</h1>
        <button className="pr-btn" type="button" onClick={() => fileRef.current?.click()}>
          Load image
        </button>
        <button className="pr-btn" type="button" onClick={clearRegions}>
          Clear
        </button>
        <span className={`pr-status${strudel.error ? " err" : ""}`}>
          {strudel.error || status}
        </span>
        <button
          className={`pr-btn${panel === "code" ? " on" : ""}`}
          type="button"
          onClick={() => openPanel("code")}
        >
          Code
        </button>
        <button
          className={`pr-btn${panel === "presets" ? " on" : ""}`}
          type="button"
          onClick={() => openPanel("presets")}
        >
          Presets
        </button>
        <button className="pr-btn" type="button" onClick={copyCode}>
          {copied ? "Copied" : "Copy composed"}
        </button>
        <button className="pr-btn" type="button" onClick={exportJson}>
          Export JSON
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => onFile(e.target.files?.[0])}
        />
      </header>

      <div
        className="pr-canvas"
        ref={wrapRef}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          onFile(e.dataTransfer.files?.[0]);
        }}
      >
        <canvas ref={imgCanvasRef} />
        <canvas
          ref={ovrCanvasRef}
          className="ovr"
          role="img"
          aria-label="Pattern image"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={onPointerUp}
        />
      </div>

      <aside className="pr-side">
        <div className="pr-seq">
          <div className="pr-seq-bar">
            <select
              className="pr-seq-ctl"
              value={settings.scaleKey}
              aria-label="Scale"
              onChange={(e) => setField("scaleKey", e.target.value)}
            >
              <option value="penta">penta</option>
              <option value="minor">minor</option>
              <option value="dorian">dorian</option>
              <option value="hirajoshi">hira</option>
              <option value="wholetone">whole</option>
            </select>
            <select
              className="pr-seq-ctl"
              value={settings.rootNote}
              aria-label="Root"
              onChange={(e) => setField("rootNote", e.target.value)}
            >
              {["c2", "d2", "g2", "c3", "d3", "e3", "g3", "a3"].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
            <span className="pr-stepper" role="group" aria-label="Pitch direction">
              {[
                { dir: "up", mark: "↑", label: "Pitch rises with steps" },
                { dir: "flat", mark: "−", label: "Pitch stays on the root" },
                { dir: "down", mark: "↓", label: "Pitch falls with steps" },
              ].map(({ dir, mark, label }) => (
                <button
                  key={dir}
                  type="button"
                  className={`pr-step-btn${pitchDirOf(settings) === dir ? " on" : ""}`}
                  aria-label={label}
                  aria-pressed={pitchDirOf(settings) === dir}
                  title={label}
                  onClick={() => setField("pitchDir", dir)}
                >
                  {mark}
                </button>
              ))}
            </span>
          </div>
          {regions.length === 0 ? (
            <div className="pr-seq-empty">Draw a region — each one is a row</div>
          ) : (
            regions.map((region, i) => {
              const col = COLORS[i % COLORS.length];
              const isActive = region.id === activeId;
              const scan = scanOf(region, settings);
              const live = activePattern(region).sequence;
              const cols = Math.min(scan.steps, 16);
              const head =
                strudel.playing && !region.muted && live.length
                  ? Math.floor(strudel.phase * live.length) % live.length
                  : -1;
              const scanOpen = Boolean(openScan[region.id]);
              return (
                <div
                  key={region.id}
                  className={`pr-seq-track${isActive ? " active" : ""}${region.muted ? " muted" : ""}`}
                  style={{ "--track": col }}
                  onClick={() => setActiveId(region.id)}
                >
                  <div className="pr-seq-meta">
                    <div className="pr-rdot" style={{ background: col }} />
                    {editingNameId === region.id ? (
                      <input
                        className="pr-rname"
                        value={nameDraft}
                        aria-label="Track name"
                        autoFocus
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => setNameDraft(e.target.value)}
                        onBlur={() => commitRename(region.id)}
                        onKeyDown={(e) => {
                          e.stopPropagation();
                          if (e.key === "Enter") {
                            e.preventDefault();
                            commitRename(region.id);
                          }
                          if (e.key === "Escape") {
                            e.preventDefault();
                            skipRenameRef.current = true;
                            setEditingNameId(null);
                          }
                        }}
                      />
                    ) : (
                      <button
                        type="button"
                        className="pr-rlabel"
                        title="Rename"
                        onClick={(e) => {
                          e.stopPropagation();
                          beginRename(region);
                        }}
                      >
                        {region.name}
                      </button>
                    )}
                    <BankSelect value={region.bank} onChange={(bank) => setRegionBank(region.id, bank)} />
                    <StepsControl
                      name={region.name}
                      value={scan.steps}
                      onChange={(steps) => setRegionSteps(region.id, steps)}
                    />
                    <button
                      type="button"
                      className={`pr-scan-btn${scanOpen ? " on" : ""}`}
                      aria-label={`${scanOpen ? "Hide" : "Show"} ${region.name} scan`}
                      aria-expanded={scanOpen}
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleScanOpen(region.id);
                      }}
                    >
                      <SlidersIcon />
                    </button>
                    <button
                      type="button"
                      className={`pr-mute${region.muted ? " on" : ""}`}
                      aria-label={region.muted ? `Unmute ${region.name}` : `Mute ${region.name}`}
                      aria-pressed={region.muted}
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleRegionMute(region.id);
                      }}
                    >
                      <SpeakerIcon muted={Boolean(region.muted)} />
                    </button>
                    <button
                      type="button"
                      className="pr-rdel"
                      aria-label={`Delete ${region.name}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteRegion(region.id);
                      }}
                    >
                      x
                    </button>
                  </div>
                  <div className="pr-seq-grid" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
                    {live.map((hit, step) => (
                      <button
                        key={step}
                        type="button"
                        className={`pr-cell${hit ? " on" : ""}${step === head ? " head" : ""}`}
                        aria-label={`${region.name} step ${step + 1}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleStep(region.id, step);
                        }}
                      />
                    ))}
                  </div>
                  {scanOpen ? (
                    <div className="pr-track-meta" onClick={(e) => e.stopPropagation()}>
                      <ThreshControl
                        name={region.name}
                        value={scan.thresh}
                        onChange={(thresh) => setRegionScan(region.id, { thresh })}
                      />
                    </div>
                  ) : null}
                </div>
              );
            })
          )}
        </div>

        <div className={`pr-sec${openFold.scan ? "" : " folded"}`}>
          <button
            type="button"
            className="pr-fold"
            aria-expanded={openFold.scan}
            onClick={() => setOpenFold((prev) => ({ ...prev, scan: !prev.scan }))}
          >
            <h2>Scan</h2>
            <span className="pr-fold-mark">{openFold.scan ? "−" : "+"}</span>
          </button>
          {openFold.scan ? (
            <>
              <div className="pr-row">
                <label>Axis</label>
                <select value={settings.axis} onChange={(e) => setField("axis", e.target.value)}>
                  <option value="x">Horizontal</option>
                  <option value="y">Vertical</option>
                  <option value="diag">Diagonal</option>
                </select>
              </div>
              <div className="pr-row">
                <label>Channel</label>
                <select value={settings.channel} onChange={(e) => setField("channel", e.target.value)}>
                  <option value="edge">Edge detect</option>
                  <option value="luma">Luminance</option>
                  <option value="r">Red</option>
                  <option value="g">Green</option>
                  <option value="b">Blue</option>
                </select>
              </div>
            </>
          ) : null}
        </div>

        <div className={`pr-sec${openFold.sensors ? "" : " folded"}`}>
          <button
            type="button"
            className="pr-fold"
            aria-expanded={openFold.sensors}
            onClick={() => setOpenFold((prev) => ({ ...prev, sensors: !prev.sensors }))}
          >
            <h2>Sensor simulation</h2>
            <span className="pr-fold-mark">{openFold.sensors ? "−" : "+"}</span>
          </button>
          {openFold.sensors
            ? Object.entries(sensors).map(([key, sensor]) => {
                const pct = ((sensor.val - sensor.min) / (sensor.max - sensor.min)) * 100;
                return (
                  <div className="pr-srow" key={key}>
                    <span>{key}</span>
                    <div className="pr-sbar">
                      <i style={{ width: `${pct}%` }} />
                    </div>
                    <span className="pr-sval">{sensor.val.toFixed(1)}</span>
                  </div>
                );
              })
            : null}
        </div>
      </aside>

      <section className={`pr-code${panel === "code" ? "" : " parked"}`} aria-label="Strudel code">
        <div className="pr-code-bar">
          <span>Code</span>
          <span className="pr-code-meta">
            {settings.bpm} BPM = {cpm.toFixed(2)} cpm · both panes · Update or Ctrl+Enter
          </span>
          <button className="pr-btn" type="button" onClick={fromImage}>
            From image
          </button>
          <button className="pr-btn" type="button" onClick={updateFromEditor}>
            Update
          </button>
          <button className="pr-btn" type="button" onClick={copyCode}>
            {copied ? "Copied" : "Copy composed"}
          </button>
          <button className="pr-btn" type="button" onClick={() => setPanel(null)}>
            Close
          </button>
        </div>
        <div className="pr-code-split">
          <div className="pr-code-pane">
            <div className="pr-code-label">Generated</div>
            <div ref={leftHostRef} className="pr-repl" />
          </div>
          <div className="pr-code-pane">
            <div className="pr-code-label">Overlay</div>
            <div ref={editorHostRef} className="pr-repl" />
          </div>
        </div>
      </section>

      {panel === "presets" ? (
        <section className="pr-presets" aria-label="Presets">
          <div className="pr-code-bar">
            <span>Presets</span>
            <input
              className="pr-preset-name"
              value={presetName}
              placeholder="Name"
              aria-label="Preset name"
              onChange={(e) => setPresetName(e.target.value)}
            />
            <button className="pr-btn" type="button" onClick={() => savePreset(false)}>
              Save
            </button>
            <button className="pr-btn" type="button" onClick={() => savePreset(true)} disabled={!selectedPreset}>
              Update
            </button>
            <button className="pr-btn" type="button" onClick={() => loadPreset()} disabled={!selectedPreset}>
              Load
            </button>
            <button className="pr-btn" type="button" onClick={deletePreset} disabled={!selectedPreset}>
              Delete
            </button>
            <button className="pr-btn" type="button" onClick={() => setPanel(null)}>
              Close
            </button>
          </div>
          <div className="pr-presets-split">
            <ul className="pr-presets-list">
              {presets.length === 0 ? (
                <li className="pr-presets-empty">Save the current tracks, banks, and overlay</li>
              ) : (
                presets.map((preset) => (
                  <li key={preset.id}>
                    <button
                      type="button"
                      className={`pr-preset-item${preset.id === presetId ? " on" : ""}`}
                      onClick={() => {
                        setPresetId(preset.id);
                        setPresetName(preset.name);
                      }}
                      onDoubleClick={() => {
                        setPresetId(preset.id);
                        setPresetName(preset.name);
                        void loadPreset(preset);
                      }}
                    >
                      <span className="pr-preset-item-name">{preset.name}</span>
                      <span className="pr-preset-item-meta">
                        {preset.bpm} BPM · {Number(preset.cpm).toFixed(1)} cpm
                      </span>
                    </button>
                  </li>
                ))
              )}
            </ul>
            <div className="pr-presets-detail">
              {selectedPreset ? (
                <>
                  <dl className="pr-preset-meta">
                    <div>
                      <dt>Created</dt>
                      <dd>{formatStamp(selectedPreset.createdAt)}</dd>
                    </div>
                    <div>
                      <dt>Saved</dt>
                      <dd>{formatStamp(selectedPreset.updatedAt)}</dd>
                    </div>
                    <div>
                      <dt>Tempo</dt>
                      <dd>
                        {selectedPreset.bpm} BPM · {Number(selectedPreset.cpm).toFixed(2)} cpm
                      </dd>
                    </div>
                    <div>
                      <dt>Scale</dt>
                      <dd>
                        {selectedPreset.settings?.rootNote} {selectedPreset.settings?.scaleKey}
                        {pitchDirOf(selectedPreset.settings) === "down"
                          ? " ↓"
                          : pitchDirOf(selectedPreset.settings) === "flat"
                            ? " −"
                            : " ↑"} ·{" "}
                        {selectedPreset.settings?.steps} steps
                      </dd>
                    </div>
                  </dl>
                  <div className="pr-code-label">Patterns</div>
                  {(selectedPreset.regions || []).length === 0 ? (
                    <p className="pr-presets-empty">No tracks</p>
                  ) : (
                    (selectedPreset.regions || []).map((region, i) => {
                      const col = COLORS[i % COLORS.length];
                      const bank =
                        region.bank && region.bank !== "auto"
                          ? region.bank
                          : region.timbre?.label || region.timbre?.synth || "auto";
                      const live = activePattern(region).sequence;
                      return (
                        <div key={region.id || i} className="pr-preset-track" style={{ "--track": col }}>
                          <div className="pr-seq-meta">
                            <div className="pr-rdot" style={{ background: col }} />
                            <span className="pr-rlabel">{region.name}</span>
                            <span className="pr-preset-bank">{bank}</span>
                            <span className={`pr-mute${region.muted ? " on" : ""}`} aria-hidden="true">
                              <SpeakerIcon muted={Boolean(region.muted)} />
                            </span>
                          </div>
                          <div
                            className="pr-seq-grid"
                            style={{
                              gridTemplateColumns: `repeat(${Math.min(live.length, 16) || 8}, 1fr)`,
                            }}
                          >
                            {live.slice(0, 16).map((hit, step) => (
                              <div key={step} className={`pr-cell${hit ? " on" : ""}`} />
                            ))}
                          </div>
                        </div>
                      );
                    })
                  )}
                  <div className="pr-code-label">Overlay</div>
                  <pre className="pr-preset-overlay">
                    {selectedPreset.userOverlay?.trim() || "— empty —"}
                  </pre>
                </>
              ) : (
                <p className="pr-presets-empty">Select a preset to see patterns, samples, and dates</p>
              )}
            </div>
          </div>
        </section>
      ) : null}

      <footer className="pr-foot">
        <button
          type="button"
          className={`pr-play${strudel.playing ? " on" : ""}`}
          onClick={togglePlay}
          aria-label={strudel.playing ? "Stop" : "Play"}
        >
          {strudel.playing ? "■" : "▶"}
        </button>
        <span className="pr-bpm-lbl">BPM</span>
        <span className="pr-bpm-val">{settings.bpm}</span>
        <input
          className="pr-bpm-sl"
          type="range"
          min="20"
          max="120"
          value={settings.bpm}
          onChange={(e) => setField("bpm", Number(e.target.value))}
        />
        <div className="pr-dots">
          {Array.from({ length: footSteps }, (_, i) => (
            <div key={i} className={`pr-dot${i === playStep ? " now" : ""}`} />
          ))}
        </div>
        <span className="pr-readout">
          {cpm.toFixed(1)} cpm · rpm {sensors.rpm.val.toFixed(1)} · lpf {Math.round(sensors.lpf.val)}{" "}
          · gloss {sensors.gloss.val.toFixed(2)}
        </span>
      </footer>
    </div>
  );
}
