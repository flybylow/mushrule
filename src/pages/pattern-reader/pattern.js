export const SCALES = {
  penta: [0, 2, 4, 7, 9, 12, 14, 16, 19, 21],
  minor: [0, 2, 3, 5, 7, 8, 10, 12, 14, 15],
  dorian: [0, 2, 3, 5, 7, 9, 10, 12, 14, 15],
  hirajoshi: [0, 2, 3, 7, 8, 12, 14, 15, 19, 20],
  wholetone: [0, 2, 4, 6, 8, 10, 12, 14, 16, 18],
};

export const SYNTH_OSCS = ["sine", "triangle", "sawtooth", "square"];
export const PITCHED_BANKS = [
  "gong",
  "metal",
  "east",
  "tabla",
  "perc",
  "arpy",
  "pad",
  "casio",
  "bass",
  "piano",
  "flute",
  "wind",
];
export const RHYTHM_BANKS = ["bd", "sd", "hh", "cp"];
export const SAMPLE_BANKS = [...PITCHED_BANKS, ...RHYTHM_BANKS];

export function pickRandomSample(avoid = []) {
  const skip = new Set(avoid.filter(Boolean));
  const pool = SAMPLE_BANKS.filter((name) => !skip.has(name));
  const list = pool.length ? pool : SAMPLE_BANKS;
  return list[Math.floor(Math.random() * list.length)];
}

const NOTE_NAMES = ["c", "db", "d", "eb", "e", "f", "gb", "g", "ab", "a", "bb", "b"];

function isRhythm(bank) {
  return RHYTHM_BANKS.includes(bank);
}

export function activePattern(region) {
  const stored = region?.sequence || [];
  const nRaw = Number(region?.steps);
  const n = Number.isFinite(nRaw) ? Math.max(1, Math.min(64, Math.round(nRaw))) : stored.length;
  const sequence = stored.slice(0, n);
  const storedVals = region?.vals || [];
  const vals = storedVals.length ? storedVals.slice(0, sequence.length) : sequence.map((hit) => hit * 180);
  return { sequence, vals };
}

export function resolveTimbre(region) {
  const bank = region.bank && region.bank !== "auto" ? region.bank : null;
  if (bank) return { synth: bank, decay: 0.8 };
  return {
    synth: region.timbre?.synth || "triangle",
    decay: region.timbre?.decay || 1.0,
  };
}

function valsToGain(vals, sequence) {
  return sequence
    .map((hit, i) => (hit ? Math.max(0.05, Math.min(1, (vals[i] || 128) / 255)).toFixed(2) : "0"))
    .join(" ");
}

export function pitchDirOf(settings) {
  const dir = settings?.pitchDir;
  if (dir === "up" || dir === "flat" || dir === "down") return dir;
  if (settings?.pitchUp === false) return "down";
  return "up";
}

function notePattern(sequence, scaleKey, rootNote, pitchDir = "up") {
  const semis = SCALES[scaleKey] || SCALES.penta;
  const oct = parseInt(rootNote.slice(-1), 10);
  const n = sequence.length;
  return sequence
    .map((hit, i) => {
      if (!hit) return "~";
      const pos = pitchDir === "down" ? n - 1 - i : pitchDir === "flat" ? 0 : i;
      const semi = semis[Math.floor((pos / n) * semis.length) % semis.length];
      return `${NOTE_NAMES[semi % 12]}${oct + Math.floor(semi / 12)}`;
    })
    .join(" ");
}

function regionCode(region, settings) {
  const { sequence, vals } = activePattern(region);
  if (!sequence.length) return "";
  const hits = sequence.filter(Boolean).length;
  if (!hits) return "";
  const { synth, decay } = resolveTimbre(region);
  const gainPat = valsToGain(vals, sequence);

  const label = region.name ? `// ${region.name}\n` : "";
  if (isRhythm(synth)) {
    const hitsPat = sequence.map((hit) => (hit ? synth : "~")).join(" ");
    return `${label}${[`s("${hitsPat}")`, `  .gain("${gainPat}")`].join("\n")}`;
  }

  const notes = notePattern(sequence, settings.scaleKey, settings.rootNote, pitchDirOf(settings));
  return `${label}${[`note("${notes}")`, `  .s("${synth}")`, `  .gain("${gainPat}")`, `  .decay(${decay})`].join("\n")}`;
}

export function tempoCpm(settings) {
  return settings.bpm / 4;
}

function hasPTags(code) {
  return /(?:^|\n)_?\$:/.test(code || "");
}

function tagPattern(code) {
  if (code.startsWith("//")) {
    const nl = code.indexOf("\n");
    if (nl >= 0) return `${code.slice(0, nl + 1)}$: ${code.slice(nl + 1)}`;
  }
  return `$: ${code}`;
}

export function applyMuteTags(code, mutedNames) {
  if (!code) return code;
  const muted = new Set(mutedNames || []);
  return code.replace(/^(\/\/\s*(.+?)\s*\n)(_?)(\$:)/gm, (all, head, name, under) => {
    const mute = muted.has(name.trim());
    if (mute && !under) return `${head}_$:`;
    if (!mute && under) return `${head}$:`;
    return all;
  });
}

export function generateBaseParts(regions, settings) {
  const cpm = tempoCpm(settings).toFixed(2);
  const parts = (regions || []).map((region) => {
    const code = regionCode(region, settings);
    return code ? tagPattern(code) : "";
  }).filter(Boolean);
  return { cpm, body: parts.join("\n\n") };
}

export function stripTempo(code) {
  return (code || "")
    .replace(/^\s*setcpm\s*\([^)]*\)\s*/m, "")
    .replace(/^\s*setcps\s*\([^)]*\)\s*/m, "")
    .trim();
}

export function composeSong(left, right, cpm, mutedNames) {
  const a = applyMuteTags(stripTempo(left), mutedNames);
  const b = stripTempo(right);
  const empty = { leftOffset: 0, leftLen: 0, rightOffset: 0, rightLen: 0 };
  if (!a && !b) return { code: "", map: empty };
  const head = `setcpm(${Number(cpm).toFixed(2)})\n`;
  const leftTag = a && !hasPTags(a) ? "$: " : "";
  const rightTag = b && !hasPTags(b) ? "$: " : "";
  const leftPart = a ? leftTag + a : "";
  const rightPart = b ? rightTag + b : "";
  if (!b) {
    return {
      code: head + leftPart,
      map: { leftOffset: head.length + leftTag.length, leftLen: a.length, rightOffset: 0, rightLen: 0 },
    };
  }
  if (!a) {
    return {
      code: head + rightPart,
      map: { leftOffset: 0, leftLen: 0, rightOffset: head.length + rightTag.length, rightLen: b.length },
    };
  }
  const mid = "\n";
  return {
    code: head + leftPart + mid + rightPart,
    map: {
      leftOffset: head.length + leftTag.length,
      leftLen: a.length,
      rightOffset: head.length + leftPart.length + mid.length + rightTag.length,
      rightLen: b.length,
    },
  };
}

export function generateStrudelCode(regions, settings) {
  const { cpm, body } = generateBaseParts(regions, settings);
  const muted = (regions || []).filter((region) => region.muted).map((region) => region.name);
  return composeSong(body, "", cpm, muted).code;
}

export function composeStrudel(parts, overlay) {
  return composeSong(parts?.body || "", overlay, parts?.cpm || 10).code;
}
