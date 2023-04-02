import { client, logStatus } from './init-client';
import { firstValueFrom, forkJoin } from 'rxjs';
import { MotionMasterMessage } from 'motion-master-client';

const state = MotionMasterMessage.Request.SetEthercatNetworkState.State.OP;

(async function () {
  await client.whenReady();

  const devices = await firstValueFrom(client.request.getDevices(3000));

  const requests$ = devices.map(({ deviceAddress }) => client.request.setEthercatNetworkState({ deviceAddress, state }, 3000));
  const statuses = await firstValueFrom(forkJoin(requests$));

  statuses.forEach(logStatus);

  client.closeSockets();
})();
