import { program } from "commander";
import { client } from "./init-client";

program.parse();

const { deviceRef } = program.opts();

client
  .whenReady()
  .then(async () => {
    const dataMonitoring = client.createDataMonitoring(
      [
        [deviceRef, 0x20f0, 0], // Timestamp
        [deviceRef, 0x606b, 0], // Velocity demand value
        [deviceRef, 0x606c, 0], // Velocity actual value
        [deviceRef, 0x60ff, 0], // Target velocity
      ],
      1
    );

    dataMonitoring.start();

    try {
      await client.runVelocityProfile(deviceRef, {
        acceleration: 2000,
        target: 1000,
        deceleration: 2000,
        holdingDuration: 1000,
        skipQuickStop: false,
        targetReachTimeout: 5000,
        window: 10,
        windowTime: 5,
      });
      console.log(dataMonitoring.csv);
    } finally {
      dataMonitoring.stop();
    }
  })
  .finally(() => client.closeSockets());
