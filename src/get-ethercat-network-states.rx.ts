import { client, logStatus } from './init-client';
import { first, forkJoin, mergeMap } from 'rxjs';
import { MotionMasterMessage } from 'motion-master-client';

client.socketsOpened$.pipe(
  first(Boolean),
  mergeMap(() => client.request.getDevices(3000)),
  mergeMap((devices) => forkJoin(devices.map(({ deviceAddress }) => client.request.getEthercatNetworkState({ deviceAddress }, 3000)))),
).subscribe({
  next: (statuses) => {
    statuses.forEach((status) => {
      logStatus(status);
      const value = MotionMasterMessage.Status.EthercatNetworkState.State[Number(status.state)];
      console.log(`${status.deviceAddress}: ${value}`);
    });
  },
  complete: () => client.closeSockets(),
});
