/**
 * @fileoverview
 * This script demonstrates how to use the Motion Master client to generate and control
 * sine wave signals on a connected device.
 *
 * It performs two sequential signal generation tests:
 *
 * 1. **Torque Sine Wave** — configures and runs a torque sine wave signal for 5 seconds.
 * 2. **Position Sine Wave** — configures and runs a position sine wave signal for 5 seconds.
 *
 * The script:
 * - Parses the device reference from command-line options.
 * - Waits for the Motion Master client to be ready.
 * - Sets signal generator parameters for both torque and position sine waves.
 * - Starts and automatically stops each signal after a defined duration.
 * - Closes all client sockets at the end.
 *
 * Example usage:
 * ```bash
 * npx ts-node .\src\se\start-signal-generators.ts --device-ref=1
 * ```
 */

import { program } from "commander";
import { makeDeviceRefObj } from "motion-master-client";
import { lastValueFrom, takeUntil, timer } from "rxjs";

import { client } from "../init-client";

program.parse();

const { deviceRef } = program.opts();
const deviceRefObj = makeDeviceRefObj(deviceRef);

client
  .whenReady()
  .then(async () => {
    //////////////////////
    // Torque Sine Wave //
    //////////////////////

    await lastValueFrom(
      client.request.setSignalGeneratorParameters(
        {
          ...deviceRefObj,
          torqueSineWave: {
            amplitude: 200,
            frequency: 1,
            repeat: true,
          },
        },
        10000
      )
    );

    const stopTorqueSineWave$ = timer(5000);
    await lastValueFrom(
      client.request.startSignalGenerator({ ...deviceRefObj }, 30000).pipe(takeUntil(stopTorqueSineWave$))
    );

    await lastValueFrom(client.request.stopSignalGenerator({ ...deviceRefObj }, 5000));

    ////////////////////////
    // Position Sine Wave //
    ////////////////////////

    await lastValueFrom(
      client.request.setSignalGeneratorParameters(
        {
          ...deviceRefObj,
          positionSineWave: {
            amplitude: 100000,
            frequency: 1,
            repeat: true,
            absoluteTarget: false,
          },
        },
        10000
      )
    );

    const stopPositionSineWave$ = timer(5000);
    await lastValueFrom(
      client.request.startSignalGenerator({ ...deviceRefObj }, 30000).pipe(takeUntil(stopPositionSineWave$))
    );

    await lastValueFrom(client.request.stopSignalGenerator({ ...deviceRefObj }, 5000));
  })
  .finally(() => client.closeSockets());
