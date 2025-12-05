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
        [deviceRef, 0x6077, 0],
      ],
      1000
    );

    dataMonitoring.start();

    try {
      await client.runTorqueProfile(deviceRef, {
        target: 500,
        holdingDuration: 50,
        skipQuickStop: false,
        targetReachTimeout: 5000,
        slope: 50,
        window: 20,
        windowTime: 5,
      });
      console.log(dataMonitoring.csv);
    } finally {
      dataMonitoring.stop();
    }
  })
  .finally(() => client.closeSockets());
