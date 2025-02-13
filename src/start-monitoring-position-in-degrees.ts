import { program } from 'commander';
import { makeParameterId } from 'motion-master-client';
import { client } from './init-client';
import { mergeMap, Subscription } from 'rxjs';

program.parse();

const { deviceRef } = program.opts();

let subscription: Subscription;

process.on('SIGINT', function () {
  console.log("\nGracefully shutting down from SIGINT (Ctrl-C).\nStopping monitoring and closing sockets.");
  subscription?.unsubscribe();
  client.closeSockets();
  process.exit(0);
});

const ids: [number, number, number][] = [
  [deviceRef, 0x20F0, 0], // Timestamp
  [deviceRef, 0x6064, 0], // Position actual value
];

const names = ids.map(([, index, subindex]) => makeParameterId(index, subindex));
console.log(names.join(','));

subscription = client.onceReady$.pipe(
  mergeMap(() => client.startMonitoring(ids, 100000, {
    topic: 'position-in-degrees',
    unitFormatters: [
      null,
      { converterId: 'position', unit: 'deg', data: { resolution: 524288 } },
    ]
  })),
).subscribe((values) => {
  console.log(values);
});
