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
    [deviceRef, 0x6074, 0], // Torque demand
    [deviceRef, 0x6077, 0], // Torque actual value
  ], 1000);

  // To receive and collect data, you must subscribe to the returned observable.
  dataMonitoring.start().subscribe(console.log);
});
