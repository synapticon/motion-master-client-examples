import { Argument, program } from "commander";
import { last, switchMap, take, tap } from "rxjs";
import { computeCirculoEncoderCalibrationResult, makeDeviceRefObj } from "motion-master-client";

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
    // Stop the device before starting calibration
    switchMap(() => client.request.stopDevice(deviceRefObj, requestTimeout, messageId)),
    // Start the calibration procedure after the device is stopped
    switchMap(() =>
      client.request
        .startCirculoEncoderNarrowAngleCalibrationProcedure(
          { ...deviceRefObj, encoderOrdinal },
          requestTimeout,
          messageId
        )
        .pipe(
          tap((status) => {
            if (status.progress) {
              console.log(
                `Calibration iteration ${status.progress.iteration} completed. Number of data points: ${
                  status.progress.position?.length ?? 0
                }`
              );

              // Compute and log the calibration result
              const result = computeCirculoEncoderCalibrationResult(
                status.progress?.position ?? undefined,
                status.progress?.phaseError ?? undefined
              );

              if (result) {
                console.log(`${result.meaning} (${result.value}%)`);
              }
            }
          }),
          last() // Wait for the calibration procedure to complete
        )
    ),
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
