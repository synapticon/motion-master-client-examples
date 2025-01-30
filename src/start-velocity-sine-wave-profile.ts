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
      // velocitySineWave: {
      //   amplitude: 500,
      //   frequency: 1,
      //   repeat: true,
      // },
      velocityRamp: {
        target: 1000,
        profileAcceleration: 1000,
        profileDeceleration: 1000,
        sustainTime: 2000,
      }
    }, 2000),
  );

  client.request.startSignalGenerator({ ...deviceRefObj }, 5000).subscribe(console.log);

  await resolveAfter(10000);

  // await lastValueFrom(
  //   client.request.startSignalGenerator({ ...deviceRefObj }, 50000),
  // );
}).finally(() => client.closeSockets());
