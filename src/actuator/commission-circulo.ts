/**
 * Commissions an actuator with a SOMANET Circulo drive in one go:
 *
 *   1. Loads a configuration file (config.csv) onto the drive.
 *   2. Runs offset detection: open phase detection, phase resistance and inductance, pole pairs,
 *      motor phase order and commutation offset.
 *   3. Calibrates a Circulo integrated encoder.
 *   4. Measures the commutation offset again. Motion Master does that itself after calibrating the encoder used
 *      for commutation, but only when the software position limits leave enough room, and otherwise only warns.
 *   5. Saves the configuration on the drive, so it is used after a power cycle.
 *
 * Steps 3 and 4 run for every encoder given with --encoders, in that order.
 *
 * The configuration file is usually exported with OBLAC Drives from an actuator of the same build that was
 * commissioned by hand. Encoder calibration turns the motor in velocity mode, so the file has to contain tuned
 * velocity controller gains (OBLAC Drives asks for a bandwidth below 30 Hz).
 *
 * The motor turns during offset detection and calibration: run this on a bench where the actuator can move freely.
 * Ctrl-C stops the drive and keeps it stopped for 3 s, which ends a calibration or offset detection, even one that
 * has only just started, then exits with code 1. It says so if it could not confirm that the drive is stopped.
 *
 * Usage:
 *   npx ts-node src/actuator/commission-circulo.ts --device-ref=1 --encoders=1 path/to/config.csv
 *   npx ts-node src/actuator/commission-circulo.ts --device-ref=1 --encoders=1,2 path/to/config.csv
 */
import { Argument, InvalidArgumentError, Option, program } from "commander";
import { readFileSync } from "fs";
import { lastValueFrom, tap } from "rxjs";
import {
  Cia402State,
  CirculoEncoderNarrowAngleCalibrationProcedureStatus,
  computeCirculoEncoderCalibrationProgressResult,
  DeviceRef,
  makeDeviceRefObj,
  OffsetDetectionStepId,
  OffsetDetectionSteps,
  resolveAfter,
} from "motion-master-client";

import { client } from "../init-client";

const ordinals = (value: string) => {
  const ordinals = value.split(",").map((ordinal) => Number(ordinal));
  if (ordinals.some((ordinal) => !Number.isInteger(ordinal) || ordinal < 1)) {
    throw new InvalidArgumentError("Expected ordinals separated by commas, for example 1,2.");
  }
  return ordinals;
};

program
  .addArgument(new Argument("<configFile>", "configuration file to load, for example a config.csv exported with OBLAC Drives"))
  .addOption(
    new Option("--encoders <ordinals>", "comma-separated ordinals of the integrated encoders to calibrate, in that order")
      .argParser(ordinals)
      .makeOptionMandatory()
  )
  .addOption(new Option("--merge", "merge the file into the configuration on the drive instead of replacing it"));

program.parse();

// Motion Master reports the calibration every iteration. A slow calibration of the output-side encoder of a
// geared actuator can take minutes between two reports, hence the long default request timeout.
const { deviceRef, encoders, merge, requestTimeout = 600000, messageId } = program.opts();
const [configFile] = program.processedArgs as [string];

// Ctrl-C stops the drive, as Stop does in OBLAC Drives. Motion Master ends a calibration, and offset detection stops
// before its next step, once the drive leaves Operation Enabled. Without the stop, both would go on after the
// script has exited. No new step starts after Ctrl-C.
let interrupted = false;
process.on("SIGINT", async () => {
  if (interrupted) {
    return;
  }
  interrupted = true;
  console.log("\nStopping the drive and watching it for 3 s...");
  const stopped = await stopDrive(deviceRef);
  console.error(
    stopped
      ? "FAILED: commissioning stopped with Ctrl-C."
      : "FAILED: commissioning stopped with Ctrl-C. Could not confirm that the drive is stopped: check it in OBLAC Drives."
  );
  client.closeSockets();
  process.exit(1);
});

client
  .whenReady()
  .then(async () => {
    step(`1. Loading ${configFile}...`);
    const content = readFileSync(configFile, "utf-8");
    await lastValueFrom(client.request.loadConfig(deviceRef, content, merge ? "merge" : "replace", { count: 20, delay: 500 }));

    step("2. Running offset detection...");
    await runOffsetDetection(deviceRef, []);

    for (const [i, encoderOrdinal] of (encoders as number[]).entries()) {
      step(`3. Calibrating integrated encoder ${encoderOrdinal}...`);
      // A message ID names one request, so -m goes with the first calibration only.
      await calibrateEncoder(deviceRef, encoderOrdinal, i === 0 ? messageId : undefined);

      // Motion Master measures the commutation offset again itself at the end of the calibration of the encoder
      // used for commutation, but only when the software position limits leave enough room. Otherwise it only
      // warns. Measuring it after every calibration makes the result the same in every case. It moves the motor
      // no more than step 2.
      step("4. Measuring the commutation offset again...");
      await runOffsetDetection(deviceRef, ["commutationOffsetMeasurement"]);
    }

    step("5. Saving the configuration...");
    await lastValueFrom(client.request.saveConfig(deviceRef));

    step("Done.");
  })
  .catch((err: unknown) => {
    // After Ctrl-C the SIGINT handler says how the run ended.
    if (!interrupted) {
      console.error(`FAILED: ${err instanceof Error ? err.message : err}`);
    }
    process.exitCode = 1;
  })
  .finally(() => {
    // After Ctrl-C the SIGINT handler closes the sockets, once the drive is stopped.
    if (!interrupted) {
      client.closeSockets();
    }
  });

/** Prints the step that starts, or throws after Ctrl-C, so that no new step starts. */
function step(text: string) {
  if (interrupted) {
    throw new Error("Stopped with Ctrl-C.");
  }
  console.log(text);
}

/**
 * Stops the drive, then watches it for 3 s and stops it again whenever it is enabled: a calibration or offset
 * detection that has only just started enables the drive a moment later, after the first stop. Resolves to whether
 * the drive is stopped at the end.
 */
async function stopDrive(deviceRef: DeviceRef): Promise<boolean> {
  const stop = () => lastValueFrom(client.request.stopDevice(makeDeviceRefObj(deviceRef), 10000)).catch(() => undefined);
  const state = () => lastValueFrom(client.request.getCia402State(deviceRef, 1000)).catch(() => undefined);

  await stop();
  const end = Date.now() + 3000;
  while (Date.now() < end) {
    await resolveAfter(100);
    if ((await state()) === Cia402State.OPERATION_ENABLED) {
      await stop();
    }
  }

  const last = await state();
  return last !== undefined && last !== Cia402State.OPERATION_ENABLED;
}

/**
 * Runs the given offset detection steps (all of them when the list is empty), prints every step once it finishes,
 * and throws if a step failed. A failed step does not end the procedure: the next steps still run.
 */
async function runOffsetDetection(deviceRef: DeviceRef, stepIds: OffsetDetectionStepId[]): Promise<void> {
  const printed = new Set<string>();

  const steps: OffsetDetectionSteps = await lastValueFrom(
    client.request.runOffsetDetection(deviceRef, stepIds).pipe(
      tap((steps) =>
        steps
          .filter((step) => (step.status === "succeeded" || step.status === "failed") && !printed.has(step.id))
          .forEach((step) => {
            printed.add(step.id);
            const result = step.status === "succeeded" ? `value ${step.value}` : `FAILED ${step.error ?? ""}`;
            console.log(`   ${step.label}: ${result}`);
          })
      )
    )
  );

  const failed = steps.filter((step) => step.status === "failed").map((step) => step.label);
  if (failed.length > 0) {
    throw new Error(`Offset detection failed: ${failed.join(", ")}`);
  }
}

/**
 * Calibrates one Circulo integrated encoder, prints the result of every iteration and every warning from
 * Motion Master, and throws unless the calibration succeeded.
 */
async function calibrateEncoder(deviceRef: DeviceRef, encoderOrdinal: number, messageId?: string): Promise<void> {
  const deviceRefObj = makeDeviceRefObj(deviceRef);

  const status: CirculoEncoderNarrowAngleCalibrationProcedureStatus = await lastValueFrom(
    client.request.startCirculoEncoderNarrowAngleCalibrationProcedure({ ...deviceRefObj, encoderOrdinal }, requestTimeout, messageId).pipe(
      tap((status) => {
        const result = computeCirculoEncoderCalibrationProgressResult(status.progress);
        if (result) {
          // Only the final iteration rates the finished calibration. The earlier ones measure an encoder that is
          // still being calibrated.
          const iteration = status.progress?.iteration != null ? ` ${status.progress.iteration}` : "";
          const meaning = status.progress?.final ? ` [final] ${result.meaning}` : "";
          console.log(`   Iteration${iteration}: ${result.value}%${meaning}`);
        }

        // For example: the absolute position changed, so homing and the software position limits have to be checked.
        if (status.warning) {
          console.warn(`   WARNING: ${status.warning.message}`);
        }
      })
    )
  );

  if (status.request !== "succeeded") {
    const message = status.error?.message ?? status.success?.message ?? "no message";
    throw new Error(`Calibration of encoder ${encoderOrdinal} did not succeed: ${message}`);
  }
}
