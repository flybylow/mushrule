import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { evalScope, silence } from "@strudel/core";
import { flash, highlightMiniLocations, initEditor, StrudelMirror, updateMiniLocations } from "@strudel/codemirror";
import { miniAllStrings } from "@strudel/mini";
import { transpiler } from "@strudel/transpiler";
import { getAudioContext, getSampleBuffer, initAudioOnFirstClick, registerSynthSounds, samples, webaudioOutput } from "@strudel/webaudio";
import { composeSong, PITCHED_BANKS, RHYTHM_BANKS, stripTempo } from "./pattern.js";

miniAllStrings();

const WARM_NOTES = ["c3", "d3", "e3", "g3", "a3", "c4", "d4", "g4", "a4"];

async function warmupDirt() {
  const jobs = [
    ...RHYTHM_BANKS.map((s) => getSampleBuffer({ s, n: 0 })),
    ...PITCHED_BANKS.flatMap((s) => WARM_NOTES.map((note) => getSampleBuffer({ s, note }))),
  ];
  await Promise.all(jobs.map((job) => job.catch(() => null)));
}

async function patternReaderPrebake() {
  await evalScope(import("@strudel/core"), import("@strudel/mini"), import("@strudel/tonal"), import("@strudel/webaudio"));
  await registerSynthSounds();
  try {
    await samples("github:tidalcycles/dirt-samples");
    await warmupDirt();
  } catch {
    /* synths still play if Dirt is unreachable */
  }
}

async function resumeAudio() {
  try {
    const ctx = getAudioContext();
    if (ctx.state === "suspended") await ctx.resume();
  } catch {
    /* evaluate still unlocks audio */
  }
}

function setEditorCode(view, code) {
  if (!view) return;
  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: code || "" },
  });
}

function leadingPad(raw, stripped) {
  if (!stripped) return 0;
  const idx = (raw || "").indexOf(stripped);
  return idx < 0 ? 0 : idx;
}

function shiftPairs(locations, offset, len, pad) {
  return (locations || [])
    .map(([from, to]) => [from - offset + pad, to - offset + pad])
    .filter(([from, to]) => from >= 0 && to > from && from < len + pad);
}

function shiftHaps(haps, offset, len, pad) {
  return haps
    .map((hap) => {
      const locations = (hap.context?.locations || [])
        .map(({ start, end }) => ({ start: start - offset + pad, end: end - offset + pad }))
        .filter(({ start, end }) => start >= 0 && end > start && start < len + pad);
      if (!locations.length) return null;
      const value = hap.value && typeof hap.value === "object" ? { ...hap.value } : hap.value;
      if (value && typeof value === "object" && !value.color && !value.markcss) {
        value.color = "var(--acc, #c8a96e)";
      }
      return { ...hap, value, context: { ...(hap.context || {}), locations } };
    })
    .filter(Boolean);
}

function paintEditors(leftView, rightView, haps, time, map) {
  if (leftView) {
    highlightMiniLocations(leftView, time, shiftHaps(haps, map.leftOffset, map.leftLen, map.leftPad));
  }
  if (rightView) {
    highlightMiniLocations(rightView, time, shiftHaps(haps, map.rightOffset, map.rightLen, map.rightPad));
  }
}

export function useStrudel(leftHostRef, rightHostRef, getCpm, getMuted) {
  const getCpmRef = useRef(getCpm);
  getCpmRef.current = getCpm;
  const getMutedRef = useRef(getMuted);
  getMutedRef.current = getMuted;

  const leftViewRef = useRef(null);
  const rightViewRef = useRef(null);
  const mirrorRef = useRef(null);
  const mapRef = useRef({
    leftOffset: 0,
    leftLen: 0,
    leftPad: 0,
    rightOffset: 0,
    rightLen: 0,
    rightPad: 0,
  });
  const leftDirtyRef = useRef(false);
  const seedingRef = useRef(false);
  const playingRef = useRef(false);
  const evalLock = useRef(false);
  const pendingRef = useRef(null);
  const debounceRef = useRef(0);

  const [playing, setPlaying] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [phase, setPhase] = useState(0);

  const getLeft = useCallback(() => leftViewRef.current?.state.doc.toString() || "", []);
  const getRight = useCallback(() => rightViewRef.current?.state.doc.toString() || "", []);

  const composeNow = useCallback(() => {
    const left = getLeft();
    const right = getRight();
    const cpm = getCpmRef.current?.() ?? 10;
    const muted = getMutedRef.current?.() ?? [];
    const song = composeSong(left, right, cpm, muted);
    const a = stripTempo(left);
    const b = stripTempo(right);
    mapRef.current = {
      ...song.map,
      leftPad: leadingPad(left, a),
      rightPad: leadingPad(right, b),
    };
    return song.code;
  }, [getLeft, getRight]);

  const pushCode = useCallback(async (autostart = true) => {
    const mirror = mirrorRef.current;
    if (!mirror) return;
    if (evalLock.current) {
      pendingRef.current = autostart;
      return;
    }
    const code = composeNow();
    if (!code) {
      setError("No pattern — draw a region or type in either pane");
      return;
    }
    evalLock.current = true;
    try {
      await resumeAudio();
      await mirror.repl.evaluate(code, autostart);
      setError("");
    } catch (err) {
      setError(err?.message || String(err));
    } finally {
      evalLock.current = false;
      if (pendingRef.current != null) {
        const nextStart = pendingRef.current;
        pendingRef.current = null;
        void pushCode(nextStart);
      }
    }
  }, [composeNow]);

  const update = useCallback(
    (immediate = false) => {
      try {
        flash(leftViewRef.current);
        flash(rightViewRef.current);
      } catch {
        /* flash is optional */
      }
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
      if (immediate) {
        debounceRef.current = 0;
        return pushCode(true);
      }
      debounceRef.current = window.setTimeout(() => {
        debounceRef.current = 0;
        void pushCode(true);
      }, 40);
      return Promise.resolve();
    },
    [pushCode],
  );

  useEffect(() => {
    const leftRoot = leftHostRef.current;
    const rightRoot = rightHostRef.current;
    if (!leftRoot || !rightRoot) return undefined;
    leftRoot.replaceChildren();
    rightRoot.replaceChildren();
    initAudioOnFirstClick();

    const hidden = document.createElement("div");
    hidden.setAttribute("aria-hidden", "true");
    hidden.style.cssText = "position:fixed;left:-9999px;top:0;width:720px;height:240px;overflow:hidden";
    document.body.appendChild(hidden);

    const bindEvaluate = {
      onEvaluate: () => {
        void update();
      },
      onStop: () => {
        try {
          mirrorRef.current?.stop();
        } catch {
          /* not booted */
        }
      },
    };

    const leftView = initEditor({
      root: leftRoot,
      initialCode: "",
      onChange: (v) => {
        if (v.docChanged && !seedingRef.current) leftDirtyRef.current = true;
      },
      ...bindEvaluate,
    });
    const rightView = initEditor({
      root: rightRoot,
      initialCode: "",
      onChange: () => {},
      ...bindEvaluate,
    });
    leftViewRef.current = leftView;
    rightViewRef.current = rightView;

    const mirror = new StrudelMirror({
      defaultOutput: webaudioOutput,
      getTime: () => getAudioContext().currentTime,
      transpiler,
      root: hidden,
      initialCode: "",
      pattern: silence,
      prebake: patternReaderPrebake,
      solo: false,
      onEvalError: (err) => setError(err?.message || String(err)),
      afterEval: (options) => {
        const locs = options.meta?.miniLocations || [];
        const map = mapRef.current;
        updateMiniLocations(leftView, shiftPairs(locs, map.leftOffset, map.leftLen, map.leftPad));
        updateMiniLocations(rightView, shiftPairs(locs, map.rightOffset, map.rightLen, map.rightPad));
      },
      onToggle: (started) => {
        playingRef.current = started;
        setPlaying(started);
        if (!started) {
          setPhase(0);
          updateMiniLocations(leftView, []);
          updateMiniLocations(rightView, []);
        }
      },
    });
    mirror.evaluate = async () => {
      await update();
    };
    mirror.highlight = (haps, time) => {
      paintEditors(leftView, rightView, haps, time, mapRef.current);
    };
    mirrorRef.current = mirror;
    setReady(true);

    return () => {
      if (debounceRef.current) {
        window.clearTimeout(debounceRef.current);
        debounceRef.current = 0;
      }
      pendingRef.current = null;
      try {
        mirror.stop();
        mirror.clear();
        leftView.destroy();
        rightView.destroy();
      } catch {
        /* already torn down */
      }
      hidden.remove();
      leftViewRef.current = null;
      rightViewRef.current = null;
      mirrorRef.current = null;
      leftRoot.replaceChildren();
      rightRoot.replaceChildren();
    };
  }, [leftHostRef, rightHostRef, update]);

  const start = useCallback(async () => {
    await resumeAudio();
    playingRef.current = true;
    setPlaying(true);
    await update(true);
  }, [update]);

  const stop = useCallback(() => {
    playingRef.current = false;
    setPlaying(false);
    setPhase(0);
    if (debounceRef.current) {
      window.clearTimeout(debounceRef.current);
      debounceRef.current = 0;
    }
    pendingRef.current = null;
    try {
      mirrorRef.current?.stop();
    } catch {
      /* not booted */
    }
  }, []);

  const seedLeft = useCallback((code) => {
    seedingRef.current = true;
    setEditorCode(leftViewRef.current, code || "");
    leftDirtyRef.current = false;
    queueMicrotask(() => {
      leftDirtyRef.current = false;
      seedingRef.current = false;
    });
  }, []);

  const seedRight = useCallback((code) => {
    setEditorCode(rightViewRef.current, code || "");
  }, []);

  const isLeftDirty = useCallback(() => leftDirtyRef.current, []);

  useEffect(() => {
    let raf = 0;
    const loop = () => {
      const scheduler = mirrorRef.current?.repl?.scheduler;
      if (scheduler && playingRef.current && typeof scheduler.now === "function") {
        const now = scheduler.now();
        setPhase(now - Math.floor(now));
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  return useMemo(
    () => ({
      playing,
      ready,
      error,
      phase,
      start,
      stop,
      update,
      seedLeft,
      seedRight,
      isLeftDirty,
      getLeft,
      getRight,
      getOverlay: getRight,
    }),
    [playing, ready, error, phase, start, stop, update, seedLeft, seedRight, isLeftDirty, getLeft, getRight],
  );
}
