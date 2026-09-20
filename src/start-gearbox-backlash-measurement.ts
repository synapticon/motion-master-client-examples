/**
 * ============================================================================
 *  Gearbox backlash measurement
 * ============================================================================
 *
 * WHAT THIS SCRIPT DOES
 * ---------------------
 * It measures the mechanical backlash ("play") of a gearbox by driving the
 * motor through a slow, triangular (zig-zag) position profile and watching two
 * encoders at the same time:
 *
 *   - the INTERNAL encoder, mounted on the MOTOR shaft   (object 0x230A,
 *     "Secondary position value")
 *   - the EXTERNAL encoder, mounted on the OUTPUT shaft   (object 0x6064,
 *     "Position actual value")
 *
 * Backlash only shows up when the direction REVERSES: when the motor turns
 * back the other way, the teeth first have to travel across the gap before
 * they re-engage on the opposite flank, so the motor moves a little while the
 * output shaft stays still. That lost motion is the backlash.
 *
 * The core relationship (exactly the one requested) is, at every reversal:
 *
 *      backlash = d_motor_pos / GR  -  d_output_shaft_pos
 *
 * where GR is the effective gear ratio (motor counts per output count). We do
 * not trust a nameplate number for GR; we COMPUTE it from the data itself, from
 * the stretches where the gear is firmly engaged (see "How GR is computed"
 * below). Computing GR this way also cancels out the fact that the two encoders
 * usually have different resolutions - a very convenient side effect.
 *
 * COVERING THE WHOLE REVOLUTION
 * -----------------------------
 * Backlash is not necessarily the same all the way around the output shaft
 * (gear eccentricity, tooth-to-tooth variation, a bent shaft...). So instead of
 * reversing at a single spot, the profile advances around the FULL 360 deg of
 * the output shaft and reverses every `SWEEP_STEP_DEG` degrees. The motion is a
 * "two steps forward, one step back" zig-zag: it nets forward progress while
 * producing a clean reversal at every grid angle, from BOTH engagement
 * directions. You end up with a backlash-vs-angle map across the whole circle.
 *
 * MULTITURN / WRAP-AROUND
 * -----------------------
 * The target positions are commanded as absolute 32-bit (multiturn) values, so
 * there is no wrap-around on the command side even when we cover a full turn.
 * On the READ side, some encoders are single-turn and their reported position
 * jumps from (one revolution - 1) back to 0. The analysis phase-unwraps both
 * streams, so a single-turn encoder is corrected and a true multiturn encoder
 * is left untouched (the unwrap becomes a no-op). Either way the maths is right.
 *
 * HOW GR IS COMPUTED
 * ------------------
 * While the gear is engaged and moving, the motor and output move in strict
 * proportion, so d_motor / d_output is constant and equals the effective gear
 * ratio (in encoder counts). We take the robust median of that ratio over all
 * strongly-moving samples. Around a reversal the output briefly stops while the
 * motor crosses the backlash gap; those samples are excluded from the GR fit
 * (they are exactly the samples we later use to MEASURE the backlash).
 *
 * HOW BACKLASH IS COMPUTED (per reversal)
 * ---------------------------------------
 * Define the "engagement offset"   e = motor / GR - output   (in output
 * counts). While engaged, `e` sits on a flat plateau. When contact flips to the
 * other tooth flank at a reversal, `e` steps by exactly the backlash and settles
 * on a new plateau. So the backlash at each reversal is the difference between
 * the plateau of `e` just before and just after the reversal - which is exactly
 * the integral of (d_motor/GR - d_output) across the dead-band.
 *
 *
 * !!  SAFETY  !!  This script ENABLES the drive and MOVES the motor. Before
 * running: make sure the actuator can rotate freely through the whole range you
 * configured, nobody is near moving parts, and you can reach an E-stop. Start
 * with a small SWEEP_TOTAL_DEG and low SWEEP_VELOCITY_DEG_S. Ctrl-C performs a
 * quick stop.
 *
 * HOW TO RUN
 *   npx ts-node ./src/start-gearbox-backlash-measurement.ts --device-ref=0
 * (see GEARBOX_BACKLASH_MEASUREMENT.md for the full physical setup guide)
 * ============================================================================
 */

import { writeFileSync } from "fs";
import { program } from "commander";
import { Subscription } from "rxjs";
import { Cia402State, makeParameterId, resolveAfter } from "motion-master-client";
import { client } from "./init-client";
import { AnalysisResult, BacklashAnalysisConfig, analyze, median } from "./gearbox-backlash-analysis";

// ---------------------------------------------------------------------------
//  CONFIGURATION  -  review every value here before running on real hardware.
// ---------------------------------------------------------------------------

program.parse();
/** Which device on the EtherCAT chain. 0 = first device. Override with -d. */
const deviceRef: number = program.opts().deviceRef ?? 0;

/**
 * Object-dictionary entries for the two encoders (SOMANET software 5.x).
 *
 *   MOTOR (internal)  -> 0x230A:00  "Secondary position value"
 *   OUTPUT (external) -> 0x6064:00  "Position actual value"
 *
 * This assumes the standard dual-loop assignment where the OUTPUT-shaft encoder
 * is the position-control sensor (0x6064) and the MOTOR encoder is the secondary
 * sensor (0x230A). If your drive is wired the other way round, swap these two -
 * the diagnostics printed at start-up (travel of each encoder, computed GR)
 * make it obvious if they are reversed: the MOTOR encoder always travels far
 * more than the output encoder in a reduction gearbox.
 */
const MOTOR_POSITION_OBJECT = { index: 0x230a, subindex: 0x00 };
const OUTPUT_POSITION_OBJECT = { index: 0x6064, subindex: 0x00 };

/**
 * Encoder resolutions, in counts per ONE revolution of that encoder's own
 * shaft. 2^19 = 524288 is the common SOMANET single-turn resolution.
 *
 * OUTPUT_COUNTS_PER_REV is the important one: it converts commanded/measured
 * output angle <-> counts and unwraps the output stream. VERIFY it for your
 * drive (the script prints 0x2110:03 / 0x2112:03 to help). MOTOR_COUNTS_PER_REV
 * is only used to unwrap the motor stream, so its exact value matters only if
 * the motor encoder is single-turn.
 */
const OUTPUT_COUNTS_PER_REV = 524288; // 2^19  -- VERIFY for your output encoder
const MOTOR_COUNTS_PER_REV = 524288; // 2^19  -- VERIFY for your motor encoder

/** Total output-shaft angle to sweep across, in degrees (360 = one full turn). */
const SWEEP_TOTAL_DEG = 360;
/** Reversal spacing: backlash is measured every this many output degrees. */
const SWEEP_STEP_DEG = 30;
/** Output-shaft speed during the ramps, deg/s. Low = cleaner backlash reading. */
const SWEEP_VELOCITY_DEG_S = 20;
/** Output-shaft acceleration/deceleration, deg/s^2. Crisp but not violent. */
const SWEEP_ACCEL_DEG_S2 = 200;
/** Pause at every reversal, ms. A short dwell makes the plateau clear to detect. */
const REVERSAL_DWELL_MS = 250;

/** Data-monitoring sampling period, in MICROSECONDS. 5000 us = 5 ms = 200 Hz. */
const MONITORING_INTERVAL_US = 5000;

/** Position window for "target reached", in output counts (~0.05 deg here). */
const POSITION_WINDOW_COUNTS = Math.max(1, Math.round((0.05 / 360) * OUTPUT_COUNTS_PER_REV));

// --- analysis tuning (usually fine as-is) ---------------------------------
/** A sample counts as "engaged/moving" when |d_output| exceeds this fraction
 *  of the typical moving speed. Keeps reversals out of the GR fit. */
const ENGAGED_SPEED_FRACTION = 0.3;
/** Minimum number of samples in an engaged run for its plateau to be trusted. */
const MIN_RUN_SAMPLES = 6;
/** Fraction of each engaged run trimmed off both ends before taking its plateau
 *  (avoids the transition regions right next to a reversal). */
const RUN_EDGE_TRIM = 0.15;

// --- object dictionary indices used below ---------------------------------
const OD = {
  TIMESTAMP: 0x20f0,
  MODES_OF_OPERATION: 0x6060,
  POSITION_WINDOW: 0x6067,
  TARGET_POSITION: 0x607a,
  PROFILE_VELOCITY: 0x6081,
  PROFILE_ACCELERATION: 0x6083,
  PROFILE_DECELERATION: 0x6084,
  GEAR_RATIO: 0x6091, // :1 motor revolutions, :2 shaft revolutions
  ENCODER1_CONFIG: 0x2110, // :3 resolution
  ENCODER2_CONFIG: 0x2112, // :3 resolution
};
const MODE_PROFILE_POSITION = 1;

// Column layout of each monitored sample (order must match `ids` below).
const TS_I = 0;
const OUT_I = 1;
const MOT_I = 2;
const ids: [number, number, number][] = [
  [deviceRef, OD.TIMESTAMP, 0x00],
  [deviceRef, OUTPUT_POSITION_OBJECT.index, OUTPUT_POSITION_OBJECT.subindex],
  [deviceRef, MOTOR_POSITION_OBJECT.index, MOTOR_POSITION_OBJECT.subindex],
];

// ---------------------------------------------------------------------------
//  Small numeric helpers
// ---------------------------------------------------------------------------

const degToOutCounts = (deg: number) => Math.round((deg / 360) * OUTPUT_COUNTS_PER_REV);
const outCountsToDeg = (counts: number) => (counts / OUTPUT_COUNTS_PER_REV) * 360;

/** Analysis parameters handed to the pure `analyze()` in gearbox-backlash-analysis.ts. */
const analysisConfig: BacklashAnalysisConfig = {
  outputCountsPerRev: OUTPUT_COUNTS_PER_REV,
  motorCountsPerRev: MOTOR_COUNTS_PER_REV,
  outIndex: OUT_I,
  motIndex: MOT_I,
  engagedSpeedFraction: ENGAGED_SPEED_FRACTION,
  minRunSamples: MIN_RUN_SAMPLES,
  runEdgeTrim: RUN_EDGE_TRIM,
};

/** Read one object, returning null instead of throwing if it is unavailable. */
async function tryUpload(index: number, subindex: number): Promise<number | null> {
  try {
    return await client.request.upload<number>(deviceRef, index, subindex);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
//  Motion profile: the "two forward, one back" zig-zag target list
// ---------------------------------------------------------------------------

/**
 * Build the list of absolute output-shaft target angles (deg, relative to the
 * start position). Each entry is a vertex where the motion reverses. Going up by
 * 2*step then down by 1*step nets +step per cycle, so it walks all the way
 * around `SWEEP_TOTAL_DEG` while planting a reversal on every `step` grid line -
 * once as a peak (was moving +) and once as a trough (was moving -).
 */
function buildZigZagTargetsDeg(): number[] {
  const step = SWEEP_STEP_DEG;
  const cycles = Math.max(1, Math.round(SWEEP_TOTAL_DEG / step));
  const targets: number[] = [];
  let pos = 0;
  for (let c = 0; c < cycles; c++) {
    pos += 2 * step; // up to a peak
    targets.push(pos);
    pos -= step; // back down to a trough
    targets.push(pos);
  }
  return targets;
}

// ---------------------------------------------------------------------------
//  Reporting
// ---------------------------------------------------------------------------

function report(result: AnalysisResult, mechanicalGr: number | null): string[] {
  const lines: string[] = [];
  const add = (s = "") => {
    console.log(s);
    lines.push(s);
  };

  add();
  add("================ BACKLASH MEASUREMENT RESULTS ================");
  add(`Samples collected            : ${result.sampleCount}`);
  add(`Output-stream wraps corrected: ${result.outputWraps}`);
  add(`Motor-stream wraps corrected : ${result.motorWraps}`);
  add(`Effective gear ratio (counts): ${result.grEffectiveCountsRatio.toFixed(4)} motor-counts / output-count`);
  const grMechFromCounts = (result.grEffectiveCountsRatio * OUTPUT_COUNTS_PER_REV) / MOTOR_COUNTS_PER_REV;
  add(`Implied mechanical gear ratio: ${grMechFromCounts.toFixed(4)} : 1  (motor turns per output turn)`);
  if (mechanicalGr !== null) {
    add(`Gear ratio from 0x6091       : ${mechanicalGr.toFixed(4)} : 1  (cross-check)`);
  }
  add();

  if (result.reversals.length === 0) {
    add("No clean reversals were detected. Try a larger SWEEP_STEP_DEG, a slower");
    add("SWEEP_VELOCITY_DEG_S, a longer REVERSAL_DWELL_MS, or a faster");
    add("MONITORING_INTERVAL_US, and confirm the two encoder objects are correct.");
    return lines;
  }

  const backlashes = result.reversals.map((r) => r.backlashDeg);
  add(`Reversals measured           : ${result.reversals.length}`);
  add(
    `Backlash  min / mean / max   : ${Math.min(...backlashes).toFixed(4)} / ` +
      `${(backlashes.reduce((s, v) => s + v, 0) / backlashes.length).toFixed(4)} / ` +
      `${Math.max(...backlashes).toFixed(4)} deg  ` +
      `(${(median(backlashes) * 60).toFixed(2)} arcmin median)`,
  );
  add();

  add("Per-reversal (sorted by output angle):");
  add("  angle[deg]  from-dir   backlash[deg]  backlash[arcmin]  backlash[counts]");
  for (const r of [...result.reversals].sort((a, b) => a.angleDeg - b.angleDeg)) {
    add(
      `  ${r.angleDeg.toFixed(1).padStart(8)}  ${r.fromDirection.padEnd(9)} ` +
        `${r.backlashDeg.toFixed(4).padStart(12)}  ${r.backlashArcmin.toFixed(2).padStart(15)}  ` +
        `${r.backlashCounts.toFixed(0).padStart(15)}`,
    );
  }
  add();

  // Aggregate into angular bins so you can see backlash across the whole circle.
  add(`Binned across the revolution (${SWEEP_STEP_DEG} deg bins):`);
  add("  bin[deg]        n   mean[deg]   min[deg]   max[deg]");
  const bins = new Map<number, number[]>();
  for (const r of result.reversals) {
    const bin = Math.floor(r.angleDeg / SWEEP_STEP_DEG) * SWEEP_STEP_DEG;
    (bins.get(bin) ?? bins.set(bin, []).get(bin)!).push(r.backlashDeg);
  }
  for (const bin of [...bins.keys()].sort((a, b) => a - b)) {
    const vals = bins.get(bin)!;
    const mean = vals.reduce((s, v) => s + v, 0) / vals.length;
    add(
      `  ${`${bin}-${bin + SWEEP_STEP_DEG}`.padEnd(12)} ${String(vals.length).padStart(3)}   ` +
        `${mean.toFixed(4).padStart(8)}   ${Math.min(...vals).toFixed(4).padStart(8)}   ` +
        `${Math.max(...vals).toFixed(4).padStart(8)}`,
    );
  }
  add("=============================================================");
  return lines;
}

// ---------------------------------------------------------------------------
//  Main sequence
// ---------------------------------------------------------------------------

let monitoring: Subscription | undefined;
let stopMonitoring: (() => void) | undefined;
let finished = false;

async function safeStop(): Promise<void> {
  stopMonitoring?.();
  monitoring?.unsubscribe();
  try {
    await client.request.quickStop(deviceRef);
  } catch {
    /* ignore - we are shutting down */
  }
}

process.on("SIGINT", async () => {
  console.log("\nSIGINT (Ctrl-C): quick-stopping the drive and closing sockets.");
  await safeStop();
  client.closeSockets();
  process.exit(0);
});

client
  .whenReady()
  .then(async () => {
    // --- Diagnostics: read gear ratio and encoder resolutions for confirmation.
    const gearMotorRev = await tryUpload(OD.GEAR_RATIO, 0x01);
    const gearShaftRev = await tryUpload(OD.GEAR_RATIO, 0x02);
    const enc1Res = await tryUpload(OD.ENCODER1_CONFIG, 0x03);
    const enc2Res = await tryUpload(OD.ENCODER2_CONFIG, 0x03);
    const startOut = await client.request.upload<number>(deviceRef, OUTPUT_POSITION_OBJECT.index, OUTPUT_POSITION_OBJECT.subindex);
    const mechanicalGr =
      gearMotorRev && gearShaftRev && gearShaftRev !== 0 ? gearMotorRev / gearShaftRev : null;

    console.log("--- Device diagnostics (verify these look right) ---------------");
    console.log(`Device ref                    : ${deviceRef}`);
    console.log(`Motor  encoder object         : ${makeParameterId(MOTOR_POSITION_OBJECT.index, MOTOR_POSITION_OBJECT.subindex)} (internal / motor shaft)`);
    console.log(`Output encoder object         : ${makeParameterId(OUTPUT_POSITION_OBJECT.index, OUTPUT_POSITION_OBJECT.subindex)} (external / output shaft)`);
    console.log(`Gear ratio 0x6091 (1:2)       : ${gearMotorRev ?? "n/a"} : ${gearShaftRev ?? "n/a"}` + (mechanicalGr ? `  = ${mechanicalGr.toFixed(4)} : 1` : ""));
    console.log(`Encoder resolutions 0x2110/12 : ${enc1Res ?? "n/a"} / ${enc2Res ?? "n/a"} counts/rev`);
    console.log(`Configured OUTPUT_COUNTS_PER_REV: ${OUTPUT_COUNTS_PER_REV}   MOTOR_COUNTS_PER_REV: ${MOTOR_COUNTS_PER_REV}`);
    console.log(`Start output position         : ${startOut} counts (${outCountsToDeg(startOut).toFixed(2)} deg)`);
    console.log("----------------------------------------------------------------");

    // --- Configure Profile Position Mode and the motion profile.
    await client.request.resetTargets(deviceRef);
    await client.request.downloadMany([
      [deviceRef, OD.MODES_OF_OPERATION, 0x00, MODE_PROFILE_POSITION],
      [deviceRef, OD.POSITION_WINDOW, 0x00, POSITION_WINDOW_COUNTS],
      [deviceRef, OD.PROFILE_VELOCITY, 0x00, degToOutCounts(SWEEP_VELOCITY_DEG_S)],
      [deviceRef, OD.PROFILE_ACCELERATION, 0x00, degToOutCounts(SWEEP_ACCEL_DEG_S2)],
      [deviceRef, OD.PROFILE_DECELERATION, 0x00, degToOutCounts(SWEEP_ACCEL_DEG_S2)],
    ]);

    // --- Start recording BOTH encoders (plus the device timestamp) together.
    const dataMonitoring = client.createDataMonitoring(ids, MONITORING_INTERVAL_US);
    dataMonitoring.collect = true;
    monitoring = dataMonitoring.start(true).subscribe();
    stopMonitoring = () => dataMonitoring.stop();

    // --- Enable the drive and run the zig-zag sweep.
    await client.request.transitionToCia402State(deviceRef, Cia402State.OPERATION_ENABLED);
    await resolveAfter(REVERSAL_DWELL_MS); // settle so the first plateau is clean

    const targetsDeg = buildZigZagTargetsDeg();
    console.log(`Running ${targetsDeg.length} moves covering ~${SWEEP_TOTAL_DEG} deg, reversing every ${SWEEP_STEP_DEG} deg...`);
    for (let i = 0; i < targetsDeg.length; i++) {
      const absoluteTargetCounts = startOut + degToOutCounts(targetsDeg[i]);
      await client.request.downloadMany([[deviceRef, OD.TARGET_POSITION, 0x00, absoluteTargetCounts]]);
      await client.request.applySetPoint(deviceRef);
      await client.whenTargetReached(deviceRef);
      await resolveAfter(REVERSAL_DWELL_MS); // dwell at the reversal
      process.stdout.write(`\r  move ${i + 1}/${targetsDeg.length} -> ${targetsDeg[i].toFixed(0)} deg   `);
    }
    process.stdout.write("\n");

    // --- Stop recording and analyse.
    stopMonitoring();
    monitoring.unsubscribe();
    await resolveAfter(200); // let the last samples land

    const samples = dataMonitoring.data.map((row) => row.map((v) => Number(v)));
    const result = analyze(samples, analysisConfig);

    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const rawPath = `backlash-samples-${stamp}.csv`;
    writeFileSync(rawPath, dataMonitoring.csv);
    console.log(`\nRaw samples saved to: ${rawPath}`);

    if (!result) {
      console.log("Not enough usable data to analyse. Check the diagnostics above,");
      console.log("the encoder objects, and that the motor actually moved.");
      return;
    }

    const reportLines = report(result, mechanicalGr);

    // Results CSV: one row per reversal, easy to plot backlash vs angle.
    const resultsPath = `backlash-results-${stamp}.csv`;
    const header = "angle_deg,from_direction,backlash_deg,backlash_arcmin,backlash_counts";
    const rows = [...result.reversals]
      .sort((a, b) => a.angleDeg - b.angleDeg)
      .map((r) => `${r.angleDeg.toFixed(3)},${r.fromDirection},${r.backlashDeg.toFixed(6)},${r.backlashArcmin.toFixed(4)},${r.backlashCounts.toFixed(1)}`);
    writeFileSync(resultsPath, [`# ${reportLines.filter((l) => l.includes("gear ratio")).join(" | ")}`, header, ...rows].join("\n") + "\n");
    console.log(`Per-reversal results saved to: ${resultsPath}`);

    finished = true;
  })
  .catch((err) => {
    console.error("\nMeasurement failed:", err);
  })
  .finally(async () => {
    if (!finished) await safeStop();
    else {
      stopMonitoring?.();
      monitoring?.unsubscribe();
      try {
        await client.request.quickStop(deviceRef);
      } catch {
        /* ignore */
      }
    }
    client.closeSockets();
  });
