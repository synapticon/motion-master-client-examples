import { program } from 'commander';
import { makeDeviceRefObj } from 'motion-master-client';
import { client, logStringified } from '../init-client';
import { firstValueFrom } from 'rxjs';

program.parse();

const { deviceRef, requestTimeout = 3000, messageId } = program.opts();
const deviceRefObj = makeDeviceRefObj(deviceRef);

client.whenReady().then(async () => {
  const status = await firstValueFrom(client.request.getDeviceCia402State(deviceRefObj, requestTimeout, messageId));
  logStringified(status);
}).finally(() => client.closeSockets());
