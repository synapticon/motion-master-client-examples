import { program } from 'commander';
import { client } from './init-client';
import { writeFile } from 'fs/promises';

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
  const results = await Promise.all(
    deviceRefs.map(async (deviceRef) => {
      const dataMonitoring = client.createDataMonitoring([
        [deviceRef, 0x20F0, 0], // Timestamp
        [deviceRef, 0x6064, 0], // Position actual value
        [deviceRef, 0x60FC, 0], // Position demand internal value
      ], 1);

      dataMonitoring.start().subscribe();

      try {
        await client.runPositionProfile(deviceRef, {
          acceleration: 1000,
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

        return { ref: deviceRef, csv: dataMonitoring.csv };
      } finally {
        dataMonitoring.stop();
      }
    })
  );

  await Promise.all(
    results.map(({ ref, csv }) =>
      writeFile(`Position Profile Drive ${ref}.csv`, csv)
    )
  );
}).finally(() => client.closeSockets());
