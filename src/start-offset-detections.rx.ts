import { client, logStatus } from './init-client';
import { first, forkJoin, mergeMap } from 'rxjs';

client.reqResSocket.opened$.pipe(
  first(Boolean),
  mergeMap(() => client.request.getDevices(3000)),
  mergeMap((devices) => forkJoin(devices.map(({ deviceAddress }) => client.request.startOffsetDetection({ deviceAddress }, 60000)))),
).subscribe({
  next: (statuses) => statuses.forEach(logStatus),
  complete: () => client.closeSockets(),
});