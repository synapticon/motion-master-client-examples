/**
 * ============================================================================
 *  Gearbox backlash analysis (pure maths, no Motion Master dependency)
 * ============================================================================
 *
 * This module contains only number-crunching, so it can be unit-tested with
 * synthetic data without any hardware or a running Motion Master. The live
 * data-capture lives in `start-gearbox-backlash-measurement.ts`, which imports
 * `analyze()` from here.
 *
 * See the header of `start-gearbox-backlash-measurement.ts` for the full theory.
 * In short:
 *   - GR (effective, in encoder counts) = robust median of d_motor / d_output
 *     over the samples where the gear is firmly engaged and moving.
 *   - engagement offset  e = motor / GR - output   sits on a flat plateau while
 *     engaged and steps by exactly the backlash at each direction reversal.
 *   - backlash at a reversal = |plateau(e) after - plateau(e) before|, which is
 *     the integral of (d_motor/GR - d_output) across the dead-band.
 * ============================================================================
 */

export interface BacklashAnalysisConfig {
  /** Counts per revolution of the OUTPUT (external) encoder. */
  outputCountsPerRev: number;
  /** Counts per revolution of the MOTOR (internal) encoder. */
  motorCountsPerRev: number;
  /** Column index of the output-encoder value in each sample row. */
  outIndex: number;
  /** Column index of the motor-encoder value in each sample row. */
  motIndex: number;
  /** A sample is "engaged/moving" when |d_output| exceeds this fraction of the
   *  75th-percentile output speed. */
  engagedSpeedFraction: number;
  /** Minimum samples in an engaged run for its plateau to be trusted. */
  minRunSamples: number;
  /** Fraction trimmed off each end of a run before taking its plateau. */
  runEdgeTrim: number;
}

export interface Reversal {
  /** Output angle at the reversal, wrapped into [0, 360). */
  angleDeg: number;
  /** Direction of travel BEFORE the reversal. */
  fromDirection: "positive" | "negative";
  /** Backlash in output-encoder counts. */
  backlashCounts: number;
  backlashDeg: number;
  backlashArcmin: number;
}

export interface AnalysisResult {
  /** Effective gear ratio: motor counts per output count. */
  grEffectiveCountsRatio: number;
  sampleCount: number;
  outputWraps: number;
  motorWraps: number;
  reversals: Reversal[];
}

export function median(values: number[]): number {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function percentile(values: number[], p: number): number {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))));
  return sorted[idx];
}

/**
 * Phase-unwrap a stream of raw encoder counts that wraps at `modulus`. Whenever
 * two consecutive samples jump by more than half a revolution we assume a wrap
 * and compensate. On a true multiturn encoder no such jumps occur and the output
 * equals the input (the unwrap is a no-op).
 */
export function unwrap(raw: number[], modulus: number): { values: number[]; wraps: number } {
  const out: number[] = [];
  let offset = 0;
  let wraps = 0;
  for (let i = 0; i < raw.length; i++) {
    if (i > 0) {
      const diff = raw[i] - raw[i - 1];
      if (diff > modulus / 2) {
        offset -= modulus;
        wraps++;
      } else if (diff < -modulus / 2) {
        offset += modulus;
        wraps++;
      }
    }
    out.push(raw[i] + offset);
  }
  return { values: out, wraps };
}

export function analyze(samples: number[][], cfg: BacklashAnalysisConfig): AnalysisResult | null {
  const outCountsToDeg = (counts: number) => (counts / cfg.outputCountsPerRev) * 360;

  // Pull out the raw numeric columns, dropping any malformed rows.
  const rawOut: number[] = [];
  const rawMot: number[] = [];
  for (const row of samples) {
    const o = Number(row[cfg.outIndex]);
    const m = Number(row[cfg.motIndex]);
    if (Number.isFinite(o) && Number.isFinite(m)) {
      rawOut.push(o);
      rawMot.push(m);
    }
  }
  if (rawOut.length < cfg.minRunSamples * 3) return null;

  // 1) Unwrap both streams so wrap-arounds don't corrupt the deltas.
  const { values: out, wraps: outputWraps } = unwrap(rawOut, cfg.outputCountsPerRev);
  const { values: mot, wraps: motorWraps } = unwrap(rawMot, cfg.motorCountsPerRev);

  // 2) Per-sample deltas.
  const dOut: number[] = [0];
  const dMot: number[] = [0];
  for (let i = 1; i < out.length; i++) {
    dOut.push(out[i] - out[i - 1]);
    dMot.push(mot[i] - mot[i - 1]);
  }

  // 3) "Engaged & moving" threshold from the 75th-percentile output speed.
  const speedRef = percentile(dOut.map(Math.abs), 0.75);
  const engagedThreshold = cfg.engagedSpeedFraction * speedRef;
  if (!(engagedThreshold > 0)) return null;

  // 4) Effective gear ratio = robust median of d_motor / d_output over the
  //    strongly-engaged samples (reversal dead-bands are naturally excluded).
  const ratios: number[] = [];
  for (let i = 1; i < out.length; i++) {
    if (Math.abs(dOut[i]) > engagedThreshold) ratios.push(dMot[i] / dOut[i]);
  }
  const grEffective = median(ratios);
  if (!Number.isFinite(grEffective) || grEffective === 0) return null;

  // 5) Engagement offset  e = motor / GR - output  (in output counts).
  const e: number[] = out.map((o, i) => mot[i] / grEffective - o);

  // 6) Split the timeline into engaged runs of consistent direction. A sign
  //    change between two runs is a reversal; the step in the plateau of `e`
  //    across it is the backlash.
  interface Run {
    start: number;
    end: number; // inclusive
    sign: number; // +1 or -1
  }
  const runs: Run[] = [];
  let current: Run | null = null;
  for (let i = 1; i < out.length; i++) {
    const moving = Math.abs(dOut[i]) > engagedThreshold;
    const sign = Math.sign(dOut[i]);
    if (moving && sign !== 0) {
      if (current && current.sign === sign) {
        current.end = i;
      } else {
        if (current) runs.push(current);
        current = { start: i, end: i, sign };
      }
    } else if (current) {
      runs.push(current);
      current = null;
    }
  }
  if (current) runs.push(current);

  // Plateau of `e` over a run, trimming the transition regions at each end.
  const plateau = (run: Run): number => {
    const len = run.end - run.start + 1;
    const trim = Math.floor(len * cfg.runEdgeTrim);
    const slice: number[] = [];
    for (let i = run.start + trim; i <= run.end - trim; i++) slice.push(e[i]);
    return median(slice.length ? slice : e.slice(run.start, run.end + 1));
  };

  const reversals: Reversal[] = [];
  for (let k = 0; k + 1 < runs.length; k++) {
    const a = runs[k];
    const b = runs[k + 1];
    const aLong = a.end - a.start + 1 >= cfg.minRunSamples;
    const bLong = b.end - b.start + 1 >= cfg.minRunSamples;
    if (a.sign === b.sign || !aLong || !bLong) continue; // not a clean reversal

    const backlashCounts = Math.abs(plateau(b) - plateau(a));
    // The reversal angle is where the output turned around (the vertex).
    const vertexCounts = (out[a.end] + out[b.start]) / 2;
    let angleDeg = outCountsToDeg(vertexCounts) % 360;
    if (angleDeg < 0) angleDeg += 360;

    const backlashDeg = outCountsToDeg(backlashCounts);
    reversals.push({
      angleDeg,
      fromDirection: a.sign > 0 ? "positive" : "negative",
      backlashCounts,
      backlashDeg,
      backlashArcmin: backlashDeg * 60,
    });
  }

  return { grEffectiveCountsRatio: grEffective, sampleCount: out.length, outputWraps, motorWraps, reversals };
}
