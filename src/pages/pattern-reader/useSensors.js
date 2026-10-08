import { useEffect, useState } from "react";

export const SENSOR_SPEC = {
  rpm: { min: 28, max: 45, speed: 0.003 },
  lpf: { min: 300, max: 1800, speed: 0.007 },
  gloss: { min: 0.2, max: 0.9, speed: 0.005 },
  hue_r: { min: 60, max: 200, speed: 0.004 },
  hue_g: { min: 100, max: 230, speed: 0.006 },
  hue_b: { min: 30, max: 180, speed: 0.008 },
};

function snapshot(phase) {
  const out = {};
  for (const [key, spec] of Object.entries(SENSOR_SPEC)) {
    const wave = Math.sin(phase * spec.speed);
    out[key] = {
      ...spec,
      val: spec.min + (spec.max - spec.min) * ((wave + 1) / 2),
    };
  }
  return out;
}

export function initialSensors() {
  return snapshot(0);
}

export function useSensors(active) {
  const [sensors, setSensors] = useState(initialSensors);

  useEffect(() => {
    if (!active) return undefined;
    const started = performance.now();
    let raf = 0;
    const loop = (now) => {
      // Prototype advanced phase by 1 every 16th-note tick (~375ms at 40 BPM).
      setSensors(snapshot((now - started) / 375));
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [active]);

  return sensors;
}
