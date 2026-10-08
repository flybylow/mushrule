export const CHANNELS = ["edge", "luma", "r", "g", "b"];
export const AXES = ["x", "y", "diag"];

function pixelValue(data, x, y, w, h, channel) {
  const i = (y * w + x) * 4;
  if (channel === "luma") return 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  if (channel === "r") return data[i];
  if (channel === "g") return data[i + 1];
  if (channel === "b") return data[i + 2];
  const nx = Math.min(x + 1, w - 1);
  const ny = Math.min(y + 1, h - 1);
  return Math.min(
    255,
    Math.abs(data[i] - data[(y * w + nx) * 4]) * 2.2 +
      Math.abs(data[i] - data[(ny * w + x) * 4]) * 2.2,
  );
}

export function extractSequence(imageData, { steps, thresh, axis, channel }) {
  const { data, width: sw, height: sh } = imageData;
  const sequence = [];
  const vals = [];
  for (let s = 0; s < steps; s += 1) {
    let sum = 0;
    let count = 0;
    if (axis === "x") {
      const x = Math.min(sw - 1, Math.floor((s / steps) * sw));
      for (let y = 0; y < sh; y += 1) {
        sum += pixelValue(data, x, y, sw, sh, channel);
        count += 1;
      }
    } else if (axis === "y") {
      const y = Math.min(sh - 1, Math.floor((s / steps) * sh));
      for (let x = 0; x < sw; x += 1) {
        sum += pixelValue(data, x, y, sw, sh, channel);
        count += 1;
      }
    } else {
      const t = s / steps;
      sum = pixelValue(
        data,
        Math.min(sw - 1, Math.floor(t * sw)),
        Math.min(sh - 1, Math.floor(t * sh)),
        sw,
        sh,
        channel,
      );
      count = 1;
    }
    const avg = count ? sum / count : 0;
    vals.push(avg);
    sequence.push(avg > thresh ? 1 : 0);
  }
  return { sequence, vals };
}

export function autoTimbre(sequence, vals) {
  const hits = sequence.filter(Boolean).length;
  const density = hits / sequence.length;
  const brightness = vals.reduce((a, b) => a + b, 0) / vals.length / 255;
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  const variance = Math.sqrt(vals.reduce((s, v) => s + (v - mean) ** 2, 0) / vals.length) / 128;

  if (density < 0.2) {
    return {
      synth: "gong",
      decay: 3.0,
      label: "gong",
      why: `sparse pattern (${Math.round(density * 100)}% density) — long resonance between strikes`,
    };
  }
  if (density > 0.7) {
    if (brightness > 0.6) {
      return {
        synth: "sine",
        decay: 0.4,
        label: "sine",
        why: `dense + bright (${Math.round(brightness * 100)}% luma) — pure tone prevents mud`,
      };
    }
    return {
      synth: "triangle",
      decay: 0.5,
      label: "triangle",
      why: "dense + dark — soft triangle prevents harshness",
    };
  }
  if (variance > 0.6) {
    return {
      synth: "metal",
      decay: 0.8,
      label: "metal",
      why: `high edge contrast (var=${variance.toFixed(2)}) — metallic timbre matches sharp marks`,
    };
  }
  if (brightness < 0.3) {
    return {
      synth: "gong",
      decay: 2.0,
      label: "gong (deep)",
      why: `dark region (${Math.round(brightness * 100)}% luma) — deep resonance`,
    };
  }
  return {
    synth: "triangle",
    decay: 1.2,
    label: "triangle",
    why: "mid density + brightness — general ceramic resonance",
  };
}

export function extractRegionFromCanvas(ctx, bounds, settings) {
  const sx = Math.max(0, Math.round(bounds.x));
  const sy = Math.max(0, Math.round(bounds.y));
  const sw = Math.max(1, Math.round(bounds.w));
  const sh = Math.max(1, Math.round(bounds.h));
  let imageData;
  try {
    imageData = ctx.getImageData(sx, sy, sw, sh);
  } catch {
    return null;
  }
  const { sequence, vals } = extractSequence(imageData, settings);
  return {
    sequence,
    vals,
    timbre: autoTimbre(sequence, vals),
    meta: { ...settings, at: new Date().toISOString() },
  };
}
