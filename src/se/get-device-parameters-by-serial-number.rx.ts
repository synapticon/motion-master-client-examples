import { client } from '../init-client';
import { forkJoin, map, mergeMap } from 'rxjs';
import { makeDeviceRefObj } from 'motion-master-client';

client.onceReady$.pipe(
  mergeMap(() => client.request.getDevices()),
  mergeMap((devices) => forkJoin(devices.map((device) => client.request.getDeviceParameters({ ...makeDeviceRefObj(device.id), loadFromCache: false, sendProgress: false }).pipe(
    map((status) => ({ ...device, parameters: status.parameters })),
  ))))).subscribe({
    next: console.log,
    complete: () => client.closeSockets(),
  });
