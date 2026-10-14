import { Argument, program } from "commander";
import { last, switchMap, take, tap } from "rxjs";
import {
  computeCirculoEncoderCalibrationResult,
  findSomanetProductById,
  getCirculoEncoderMaxPermissiblePhaseError,
  makeDeviceRefObj,
} from "motion-master-client";

import { client } from "../init-client";

program.addArgument(
  new Argument("<encoderOrdinal>", "Encoder ordinal (1-based)")
    .argParser((value) => parseInt(value, 10))
    .argOptional()
    .default(1)
);

program.parse();

const { deviceRef, requestTimeout = 60000, messageId } = program.opts();
const deviceRefObj = makeDeviceRefObj(deviceRef);
const [encoderOrdinal] = program.processedArgs as [number];

client.onceReady$
  .pipe(
    take(1), // Ensure we only proceed once
    // Read the hardware description to determine whether the device is a Circulo 7 or Circulo 9
    switchMap(() => client.request.getHardwareDescription(deviceRef, requestTimeout, messageId)),
    switchMap((hardwareDescription) => {
      const productGroup = findSomanetProductById(hardwareDescription)?.group ?? "unknown device";
      const maxPermissiblePhaseError = getCirculoEncoderMaxPermissiblePhaseError(hardwareDescription);
      console.log(`Detected ${productGroup} (max permissible phase error: ${maxPermissiblePhaseError})`);

      // Stop the device, then start the calibration procedure
      return client.request.stopDevice(deviceRefObj, requestTimeout, messageId).pipe(
        switchMap(() =>
          client.request.startCirculoEncoderNarrowAngleCalibrationProcedure(
            { ...deviceRefObj, encoderOrdinal },
            requestTimeout,
            messageId
          )
        ),
        tap((status) => {
          if (status.progress) {
            console.log(
              `Calibration iteration ${status.progress.iteration} completed. Number of data points: ${
                status.progress.position?.length ?? 0
              }`
            );

            // Prefer the limit reported by Motion Master; fall back to the one derived from the hardware description
            const limit = status.progress.maxPermissiblePhaseError || maxPermissiblePhaseError;

            // Compute and log the calibration result
            const result = computeCirculoEncoderCalibrationResult(
              status.progress?.position ?? undefined,
              status.progress?.phaseError ?? undefined,
              limit
            );

            if (result) {
              console.log(`${result.meaning} (${result.value}%)`);
            }
          }
        }),
        last() // Wait for the calibration procedure to complete
      );
    }),
    // After calibration, start offset detection
    switchMap(() =>
      client.request.startOffsetDetection(deviceRefObj, requestTimeout, messageId).pipe(
        tap((status) => {
          if (status.request === "running") {
            console.log(`Offset detection progress: ${status.progress?.percentage ?? 0}%`);
          }

          if (status.request === "failed") {
            console.log(status.error?.message ?? "Offset detection failed.");
          }

          if (status.request === "succeeded") {
            console.log(status.success?.message ?? "Offset detection succeeded.");
          }
        })
      )
    )
  )
  .subscribe({
    error: (error) => {
      console.error(`Error: ${error.message}`);
      client.closeSockets();
    },
    complete: () => {
      client.closeSockets();
    },
  });
