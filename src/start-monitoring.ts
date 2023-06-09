import { makeParameterId } from 'motion-master-client';
import { client } from './init-client';
import { mergeMap, Subscription } from 'rxjs';

let subscription: Subscription;

process.on('SIGINT', function () {
  console.log("\nGracefully shutting down from SIGINT (Ctrl-C).\nStopping monitoring and closing sockets.");
  subscription?.unsubscribe();
  client.closeSockets();
  process.exit(0);
});

const ids: [number, number, number][] = [
  [0, 0x20F0, 0], // Timestamp
  [0, 0x6040, 0], // Controlword
  [0, 0x6041, 0], // Statusword
  [0, 0x6060, 0], // Modes of operation
  [0, 0x6061, 0], // Modes of operation display
  [0, 0x6064, 0], // Position actual value
  [0, 0x606C, 0], // Velocity actual value
  [0, 0x6077, 0], // Torque actual value
  [0, 0x60FC, 0], // Position demand internal value
  [0, 0x606B, 0], // Velocity demand value
  [0, 0x6074, 0], // Torque demand
];

const names = ids.map(([, index, subindex]) => makeParameterId(index, subindex));
console.log(names.join(','));

subscription = client.onceReady$.pipe(
  mergeMap(() => client.startMonitoring(ids, 100000)),
).subscribe((values) => {
  console.log(values);
});
