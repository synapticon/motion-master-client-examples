import { program } from 'commander';
import { client } from '../init-client';
import { lastValueFrom } from 'rxjs';
import { readFileSync } from 'fs';
import { makeDeviceRefObj, resolveAfter } from 'motion-master-client';

program.parse();

const { deviceRef } = program.opts();

client.whenReady().then(async () => {
  try {
    const configContentBuffer = readFileSync('src/internal/config.csv');
    const configContent = new Uint8Array(configContentBuffer);

    const hardwareDescriptionContentBuffer = readFileSync('src/internal/.hardware_description');
    const hardwareDescriptionContent = new Uint8Array(hardwareDescriptionContentBuffer);

    const esiFileContentBuffer = readFileSync('src/internal/SOMANET_CiA_402.xml');
    const esiFileContent = new Uint8Array(esiFileContentBuffer);

    const requests = [
      () => lastValueFrom(client.request.getFiles(deviceRef)),
      () => lastValueFrom(client.request.setFile(deviceRef, 'config.csv', configContent)),
      () => lastValueFrom(client.request.getDecodedFile(deviceRef, 'config.csv')),
      () => lastValueFrom(client.request.setFile(deviceRef, 'config.csv', configContent)),
      () => lastValueFrom(client.request.getFiles(deviceRef)),
      () => lastValueFrom(client.request.getDecodedFile(deviceRef, 'config.csv')),
      () => lastValueFrom(client.request.loadConfig(deviceRef, configContent, undefined, { count: 10, delay: 500 })),
      () => lastValueFrom(client.request.getFiles(deviceRef)),
      () => lastValueFrom(client.request.getDecodedFile(deviceRef, 'config.csv')),
      () => lastValueFrom(client.request.deleteFile(deviceRef, 'config.csv')),
      () => lastValueFrom(client.request.getFiles(deviceRef)),
      () => lastValueFrom(client.request.getDecodedFile(deviceRef, '.hardware_description')),
      () => lastValueFrom(client.request.unlockProtectedFiles(deviceRef)),
      () => lastValueFrom(client.request.deleteFile(deviceRef, '.hardware_description')),
      () => lastValueFrom(client.request.setFile(deviceRef, '.hardware_description', hardwareDescriptionContent)),
      () => lastValueFrom(client.request.getDecodedFile(deviceRef, '.hardware_description')),
      () => lastValueFrom(client.request.deleteFile(deviceRef, '.hardware_description')),
      () => lastValueFrom(client.request.getDecodedFile(deviceRef, '.hardware_description')),
      () => lastValueFrom(client.request.getFiles(deviceRef)),
      () => lastValueFrom(client.request.setFile(deviceRef, 'SOMANET_CiA_402.xml', esiFileContent, true, 30000)),
      () => lastValueFrom(client.request.getDecodedFile(deviceRef, 'SOMANET_CiA_402.xml', 30000)),
      () => lastValueFrom(client.request.deleteFile(deviceRef, 'SOMANET_CiA_402.xml')),
      () => lastValueFrom(client.request.setFile(deviceRef, 'SOMANET_CiA_402.xml', esiFileContent, true, 30000)),
      () => lastValueFrom(client.request.getFiles(deviceRef)),
    ];

    for (let i = 0; i < 1; i++) {
      for (const request of requests) {
        const result = await request();
        console.log(result);
        await resolveAfter(1000);
      }
      console.log('-------------------------------------------------------\n')
    }
  } catch (err: unknown) {
    if (err instanceof Error) {
      console.error(`ERROR: ${err.message}`);
    }
  }
}).finally(() => client.closeSockets());
