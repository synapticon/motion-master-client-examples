/**
 * Runs an actuator back and forth in Profile Position Mode for a given time (48 hours by default) and logs the
 * following error and the torque of every move.
 *
 * The actuator moves between its position at the start and that position plus --distance, waiting --dwell
 * milliseconds at each end. The drive stays in Operation Enabled for the whole run. Both targets are absolute,
 * so the actuator does not drift away over thousands of moves.
 *
 * Motion Master streams the following error (0x60F4), the torque actual value (0x6077) and the position actual
 * value (0x6064) every --interval microseconds. The script keeps no samples in memory: it writes one line per
 * move to the summary file (largest following error, largest and RMS torque), and every sample to --samples
 * only when that option is given. At 1 ms that is about 170 million lines in 48 hours, so raise --interval
 * for a raw log, for example to 10000 (10 ms).
 *
 * Units are the drive's: the following error in position units (increments unless 0x60A8 says otherwise),
 * the torque in per mille of the rated torque, velocity and acceleration as 0x6081 and 0x6083 take them.
 *
 * Ctrl-C ends the run after the current move. If a move fails, the drive faults or the target is not reached
 * in time, the script quick stops the drive, prints the error report and exits with code 1.
 *
 * Usage:
 *   npx ts-node src/actuator/endurance-position-profile.ts --device-ref=0 --distance=100000 --velocity=1000
 *   npx ts-node src/actuator/endurance-position-profile.ts --device-ref=0 --hours=0.1 --samples=samples.csv --interval=10000
 */
import { Option, program } from "commander";
import { createWriteStream, WriteStream } from "fs";
import { Subscription } from "rxjs";
import { DeviceRef } from "motion-master-client";

import { client } from "../init-client";

const number = (value: string) => {
  const n = Number(value);
  if (Number.isNaN(n)) {
    throw new Error(`Not a number: ${value}`);
  }
  return n;
};

program
  .addOption(new Option("--hours <n>", "how long to run").argParser(number).default(48))
  .addOption(new Option("--distance <n>", "distance of one move, in position units").argParser(number).default(100000))
  .addOption(new Option("--velocity <n>", "profile velocity (0x6081)").argParser(number).default(1000))
  .addOption(new Option("--acceleration <n>", "profile acceleration (0x6083)").argParser(number).default(10000))
  .addOption(new Option("--deceleration <n>", "profile deceleration (0x6084)").argParser(number).default(10000))
  .addOption(new Option("--dwell <ms>", "how long to wait at each end").argParser(number).default(500))
  .addOption(new Option("--move-timeout <ms>", "how long one move may take").argParser(number).default(30000))
  .addOption(new Option("--interval <us>", "monitoring interval in microseconds").argParser(number).default(1000))
  .addOption(new Option("--summary <file>", "one line per move").default(`endurance-${timestamp()}.csv`))
  .addOption(new Option("--samples <file>", "every monitored sample (large)"));

program.parse();

const { deviceRef, hours, distance, velocity, acceleration, deceleration, dwell, moveTimeout, interval, summary, samples } =
  program.opts();

/** The largest following error and torque of the move that is running. */
class MoveStats {
  count = 0;
  maxAbsFollowingError = 0;
  maxAbsTorque = 0;
  private sumSquaredTorque = 0;

  add(followingError: number, torque: number) {
    this.count++;
    this.maxAbsFollowingError = Math.max(this.maxAbsFollowingError, Math.abs(followingError));
    this.maxAbsTorque = Math.max(this.maxAbsTorque, Math.abs(torque));
    this.sumSquaredTorque += torque * torque;
  }

  get rmsTorque() {
    return this.count > 0 ? Math.sqrt(this.sumSquaredTorque / this.count) : 0;
  }
}

let stopRequested = false;
process.on("SIGINT", () => {
  if (stopRequested) {
    process.exit(1);
  }
  stopRequested = true;
  console.log("\nStopping after the current move (Ctrl-C again to quit at once)...");
});

client
  .whenReady()
  .then(() => run(deviceRef))
  .catch((err: unknown) => {
    console.error(`FAILED: ${err instanceof Error ? err.message : err}`);
    process.exitCode = 1;
  })
  .finally(() => client.closeSockets());

async function run(deviceRef: DeviceRef) {
  const summaryFile = createWriteStream(summary);
  summaryFile.write("time,move,target,duration_ms,samples,max_abs_following_error,max_abs_torque,rms_torque\n");

  let samplesFile: WriteStream | undefined;
  if (samples) {
    samplesFile = createWriteStream(samples);
    samplesFile.write("timestamp,position_actual,following_error,torque_actual\n");
  }

  let stats = new MoveStats();
  let monitoring: Subscription | undefined;

  try {
    const start = await client.request.upload(deviceRef, 0x6064, 0);
    const targets = [start + distance, start];
    const runStart = Date.now();
    const end = runStart + hours * 3600 * 1000;

    const runMaxima = { followingError: 0, torque: 0 };

    monitoring = client
      .startMonitoring(
        [
          [deviceRef, 0x20f0, 0], // timestamp in microseconds
          [deviceRef, 0x6064, 0], // position actual value
          [deviceRef, 0x60f4, 0], // following error actual value
          [deviceRef, 0x6077, 0], // torque actual value
        ],
        interval
      )
      .subscribe((values) => {
        const [time, position, followingError, torque] = values as number[];
        stats.add(followingError, torque);
        samplesFile?.write(`${time},${position},${followingError},${torque}\n`);
      });

    console.log(`Running for ${hours} h between ${targets[1]} and ${targets[0]}. Summary: ${summary}`);

    for (let move = 1; Date.now() < end && !stopRequested; move++) {
      const target = targets[(move - 1) % 2];
      const startedAt = Date.now();
      stats = new MoveStats();

      await client.runPositionProfile(deviceRef, {
        target,
        velocity,
        acceleration,
        deceleration,
        holdingDuration: dwell,
        relative: false,
        skipQuickStop: true,
        targetReachTimeout: moveTimeout,
      });

      summaryFile.write(
        [
          new Date().toISOString(),
          move,
          target,
          Date.now() - startedAt,
          stats.count,
          stats.maxAbsFollowingError,
          stats.maxAbsTorque,
          stats.rmsTorque.toFixed(1),
        ].join(",") + "\n"
      );

      runMaxima.followingError = Math.max(runMaxima.followingError, stats.maxAbsFollowingError);
      runMaxima.torque = Math.max(runMaxima.torque, stats.maxAbsTorque);

      if (move % 100 === 0) {
        const elapsed = ((Date.now() - runStart) / 3600000).toFixed(2);
        console.log(
          `Move ${move}, ${elapsed} h: largest following error ${runMaxima.followingError}, largest torque ${runMaxima.torque}`
        );
      }
    }

    console.log(`Finished. Largest following error ${runMaxima.followingError}, largest torque ${runMaxima.torque}.`);
  } catch (err) {
    const report = await client.request.upload<string>(deviceRef, 0x203f, 1).catch(() => undefined);
    if (report) {
      console.error(`Error report (0x203F:01): ${report}`);
    }
    throw err;
  } finally {
    monitoring?.unsubscribe();
    await client.request.quickStop(deviceRef).catch(() => undefined);
    summaryFile.end();
    samplesFile?.end();
  }
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
}
