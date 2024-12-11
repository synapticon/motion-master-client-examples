import { client } from '../init-client';
import { lastValueFrom } from 'rxjs';
import { makeDeviceRefObj } from 'motion-master-client';

client.whenReady().then(async () => {
  const devices = await lastValueFrom(client.request.getDevices());
  const promises = devices.map(async (device) => {
    const status = await lastValueFrom(client.request.getDeviceParameters({ ...makeDeviceRefObj(devices[0].id), loadFromCache: false, sendProgress: false }));
    return { ...device, parameters: status.parameters };
  });
  const data = await Promise.all(promises);
  console.log(data);
}).finally(() => client.closeSockets());
