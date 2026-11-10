/**
 * Commissions an actuator with a SOMANET Circulo drive in one go:
 *
 *   1. Loads a configuration file (config.csv) onto the drive.
 *   2. Runs offset detection: open phase detection, phase resistance and inductance, pole pairs,
 *      motor phase order and commutation offset.
 *   3. Calibrates the Circulo integrated encoders, one after another.
 *   4. Measures the commutation offset again, because the calibration changes the position the encoder reports.
 *   5. Saves the configuration on the drive, so it is used after a power cycle.
 *
 * The configuration file is usually exported with OBLAC Drives from an actuator of the same build that was
 * commissioned by hand. Encoder calibration turns the motor in velocity mode, so the file has to contain tuned
 * velocity controller gains (OBLAC Drives asks for a bandwidth below 30 Hz).
 *
 * The motor turns during offset detection and calibration: run this on a bench where the actuator can move freely.
 *
 * Usage:
 *   npx ts-node src/actuator/commission-circulo.ts --device-ref=0 path/to/config.csv
 *   npx ts-node src/actuator/commission-circulo.ts --device-ref=0 --encoders=1,2 path/to/config.csv
 */
import { Argument, Option, program } from "commander";
import { readFileSync } from "fs";
import { lastValueFrom, tap } from "rxjs";
import {
  CirculoEncoderNarrowAngleCalibrationProcedureStatus,
  computeCirculoEncoderCalibrationProgressResult,
  DeviceRef,
  makeDeviceRefObj,
  OffsetDetectionStepId,
  OffsetDetectionSteps,
} from "motion-master-client";

import { client } from "../init-client";

program
  .addArgument(new Argument("<configFile>", "configuration file to load, for example a config.csv exported with OBLAC Drives"))
  .addOption(
    new Option("--encoders <ordinals>", "comma-separated ordinals of the integrated encoders to calibrate, in that order")
      .default("1")
  )
  .addOption(new Option("--merge", "merge the file into the configuration on the drive instead of replacing it"));

program.parse();

const { deviceRef, encoders, merge } = program.opts();
const [configFile] = program.processedArgs as [string];
const encoderOrdinals = String(encoders)
  .split(",")
  .map((value) => parseInt(value.trim(), 10));

// Motion Master reports the calibration every iteration. A slow calibration of the output-side encoder of a
// geared actuator can take minutes between two reports.
const calibrationTimeout = 600000;

client
  .whenReady()
  .then(async () => {
    console.log(`1. Loading ${configFile}...`);
    const content = readFileSync(configFile, "utf-8");
    await lastValueFrom(client.request.loadConfig(deviceRef, content, merge ? "merge" : "replace", { count: 20, delay: 500 }));

    console.log("2. Running offset detection...");
    await runOffsetDetection(deviceRef, []);

    for (const encoderOrdinal of encoderOrdinals) {
      console.log(`3. Calibrating integrated encoder ${encoderOrdinal}...`);
      await calibrateEncoder(deviceRef, encoderOrdinal);
    }

    // Motion Master already measures the commutation offset at the end of the calibration of the encoder used
    // for commutation, but only when the software position limits leave enough room, and only warns otherwise.
    // Measuring it here as well makes the result the same in both cases. It moves the motor no more than step 2.
    console.log("4. Measuring the commutation offset again...");
    await runOffsetDetection(deviceRef, ["commutationOffsetMeasurement"]);

    console.log("5. Saving the configuration...");
    await lastValueFrom(client.request.saveConfig(deviceRef));

    console.log("Done.");
  })
  .catch((err: unknown) => {
    console.error(`FAILED: ${err instanceof Error ? err.message : err}`);
    process.exitCode = 1;
  })
  .finally(() => client.closeSockets());

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

  // Open phase detection succeeds when it could measure, and its value says whether a phase is open.
  const openPhase = steps.find((step) => step.id === "openPhaseDetection");
  if (openPhase?.status === "succeeded" && openPhase.value === true) {
    failed.push("Open Phase Detection (a motor phase is open)");
  }

  if (failed.length > 0) {
    throw new Error(`Offset detection failed: ${failed.join(", ")}`);
  }
}

/**
 * Calibrates one Circulo integrated encoder, prints the result of every iteration and every warning from
 * Motion Master, and throws unless the calibration succeeded.
 */
async function calibrateEncoder(deviceRef: DeviceRef, encoderOrdinal: number): Promise<void> {
  const deviceRefObj = makeDeviceRefObj(deviceRef);

  // The calibration starts from a stopped drive.
  await lastValueFrom(client.request.stopDevice(deviceRefObj, 10000));

  const status: CirculoEncoderNarrowAngleCalibrationProcedureStatus = await lastValueFrom(
    client.request.startCirculoEncoderNarrowAngleCalibrationProcedure({ ...deviceRefObj, encoderOrdinal }, calibrationTimeout).pipe(
      tap((status) => {
        const result = computeCirculoEncoderCalibrationProgressResult(status.progress);
        if (result) {
          // Only the final iteration rates the finished calibration.
          const final = status.progress?.final ? " [final]" : "";
          console.log(`   Iteration ${status.progress?.iteration}: ${result.meaning} (${result.value}%)${final}`);
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
