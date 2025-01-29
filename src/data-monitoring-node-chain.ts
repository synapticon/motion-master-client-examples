import { program } from 'commander';
import { client } from './init-client';
import { DataMonitoring } from 'motion-master-client';
import { writeFileSync } from 'fs';

let dataMonitoring: DataMonitoring;

process.on('SIGINT', function () {
  // When the program stops (Ctrl-C), output the collected data to a CSV file.
  dataMonitoring.stop();
  writeFileSync('data.csv', dataMonitoring.csv);

  console.log("\nGracefully shutting down from SIGINT (Ctrl-C).\nStopping monitoring and closing sockets.");
  client.closeSockets();
  process.exit(0);
});

program.parse();

const { deviceRef } = program.opts();

client.whenReady().then(async () => {
  dataMonitoring = client.createDataMonitoring([
    [deviceRef, 0x20F0, 0], // Timestamp
    [deviceRef, 0x6079, 0], // DC link circuit voltage
    [deviceRef, 0x2030, 1], // Core temperature: Measured temperature
    [deviceRef, 0x2031, 1], // Drive temperature: Measured temperature
  ], 5000000);

  // To receive and collect data, you must subscribe to the returned observable.
  dataMonitoring.start().subscribe({
    next: (data) => {
      console.log(new Date(), data);
    },
    error: (error) => {
      console.error(error);
    },
    complete: () => {
      console.log('Data monitoring stopped');
    },
  });
});
