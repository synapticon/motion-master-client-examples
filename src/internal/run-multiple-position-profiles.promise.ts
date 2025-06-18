import { program } from 'commander';
import { client } from '../init-client';
import { writeFileSync } from 'fs';

program
  .requiredOption('--devices <devices>', 'Comma-separated list of device references');

program.parse();
const { devices } = program.opts();
const deviceRefs: (string | number)[] = devices
  .split(' ')
  .map((s: string) => s.trim())
  .map((value: string) => {
    return /^\d+$/.test(value) ? Number(value) : value;
  });

client.whenReady().then(async () => {
  const results = await Promise.all([
    (async () => {
      const deviceRef = deviceRefs[0]; // Device 1
      const dataMonitoring = client.createDataMonitoring(
        [
          [deviceRef, 0x20F0, 0],
          [deviceRef, 0x6064, 0],
          [deviceRef, 0x60FC, 0],
        ],
        1
      );

      dataMonitoring.start().subscribe();

      try {
        await client.runPositionProfile(deviceRef, {
          acceleration: 1,
          deceleration: 1000,
          velocity: 100,
          target: 1000,
          holdingDuration: 3000,
          skipQuickStop: false,
          targetReachTimeout: 5000,
          relative: false,
          window: 10,
          windowTime: 5,
        });

        await client.runPositionProfile(deviceRef, {
          acceleration: 1000,
          deceleration: 1,
          velocity: 100,
          target: 1000,
          holdingDuration: 3000,
          skipQuickStop: false,
          targetReachTimeout: 5000,
          relative: false,
          window: 10,
          windowTime: 5,
        });

        return { deviceRef, csv: dataMonitoring.csv };
      } finally {
        dataMonitoring.stop();
      }
    })(),
    (async () => {
      const deviceRef = deviceRefs[1]; // Device 2
      const dataMonitoring = client.createDataMonitoring(
        [
          [deviceRef, 0x20F0, 0],
          [deviceRef, 0x6064, 0],
          [deviceRef, 0x60FC, 0],
        ],
        1
      );

      dataMonitoring.start().subscribe();

      try {
        await client.runPositionProfile(deviceRef, {
          acceleration: 100,
          deceleration: 1000,
          velocity: 100,
          target: 1000,
          holdingDuration: 3000,
          skipQuickStop: false,
          targetReachTimeout: 5000,
          relative: false,
          window: 10,
          windowTime: 5,
        });

        await client.runPositionProfile(deviceRef, {
          acceleration: 1000,
          deceleration: 100,
          velocity: 100,
          target: 1000,
          holdingDuration: 3000,
          skipQuickStop: false,
          targetReachTimeout: 5000,
          relative: false,
          window: 10,
          windowTime: 5,
        });

        return { deviceRef, csv: dataMonitoring.csv };
      } finally {
        dataMonitoring.stop();
      }
    })(),
  ]);

  results.forEach(({ deviceRef, csv }) => {
    writeFileSync(`Position Profile Drive ${deviceRef}.csv`, csv);
  });

}).finally(() => client.closeSockets());
