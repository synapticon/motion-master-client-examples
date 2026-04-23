/**
 * Starts a velocity sine wave profile on multiple devices simultaneously.
 *
 * Connects to Motion Master, configures a repeating velocity sine wave on each
 * device listed in `positions` in parallel, then starts the generator on all of them.
 * The program keeps running for 5 hours to let the profile execute.
 *
 * Press Ctrl-C to abort: all devices will receive a quick stop before the
 * process exits. Quick stop errors are ignored so one unresponsive device
 * cannot block the shutdown of the others.
 */

import { client } from "./init-client";
import { resolveAfter } from "motion-master-client";
import { lastValueFrom } from "rxjs";

// EtherCAT positions of the target devices.
const positions = [1, 2, 3, 4];

process.on("SIGINT", async () => {
  console.log("\nGracefully shutting down from SIGINT (Ctrl-C).\nStopping all devices and closing sockets.");
  await Promise.allSettled(positions.map((position) => client.request.quickStop(position)));
  client.closeSockets();
  process.exit(0);
});

client
  .whenReady()
  .then(async () => {
    await Promise.all(
      positions.map((position) =>
        lastValueFrom(
          client.request.setSignalGeneratorParameters(
            {
              devicePosition: position,
              velocitySineWave: {
                amplitude: 1000,
                frequency: 1,
                repeat: true,
              },
            },
            5000,
          ),
        ),
      ),
    );

    for (const position of positions) {
      client.request.startSignalGenerator({ devicePosition: position }, 5000).subscribe({
        error: (err) => console.error(`startSignalGenerator error on position ${position}:`, err),
      });
    }

    // keep the program running for 5 hours to let the profile execute
    await resolveAfter(5 * 60 * 60 * 1000);
  })
  .finally(async () => {
    await Promise.allSettled(positions.map((position) => client.request.quickStop(position)));
    client.closeSockets();
  });
