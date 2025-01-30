import { program } from 'commander';
import { client } from './init-client';
import { makeDeviceRefObj, resolveAfter } from 'motion-master-client';
import { lastValueFrom } from 'rxjs';

program.parse();

const { deviceRef } = program.opts();

client.whenReady().then(async () => {
  const deviceRefObj = makeDeviceRefObj(deviceRef);

  await lastValueFrom(
    client.request.setSignalGeneratorParameters({
      ...deviceRefObj,
      velocitySineWave: {
        amplitude: 5000,
        frequency: 1,
        repeat: true,
      },
    }, 2000),
  );

  client.request.startSignalGenerator({ ...deviceRefObj }, 5000).subscribe(console.log);

  await resolveAfter(3000);
}).finally(() => client.closeSockets());
