import { program } from "commander";
import { client } from "./init-client";

program.parse();

const { deviceRef } = program.opts();

client
  .whenReady()
  .then(async () => {
    const dataMonitoring = client.createDataMonitoring(
      [
        [deviceRef, 0x20f0, 0],
        [deviceRef, 0x6064, 0],
      ],
      1
    );

    dataMonitoring.start().subscribe();

    try {
      await client.runPositionProfile(deviceRef, {
        acceleration: 10000,
        deceleration: 10000,
        target: 10000,
        velocity: 1000,
        holdingDuration: 5000,
        relative: true,
        skipQuickStop: false,
        targetReachTimeout: 10000,
        window: 50,
        windowTime: 5,
      });
      console.log(dataMonitoring.csv);
    } finally {
      dataMonitoring.stop();
    }
  })
  .finally(() => client.closeSockets());
