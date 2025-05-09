import { program } from 'commander';
import { client } from '../init-client';
import { integroVariantOptions, parseIntegroVariantBuffer } from 'motion-master-client';
import { readFileSync } from 'fs';
import { lastValueFrom } from 'rxjs';

program.parse();

const { deviceRef, requestTimeout } = program.opts();

const integroVariantPath = 'src/se/integro-variant';
const integroVariantFileContent = readFileSync(integroVariantPath);

client.whenReady().then(async () => {
  await lastValueFrom(client.request.unlockProtectedFiles(deviceRef, requestTimeout));
  await lastValueFrom(client.request.setFile(deviceRef, '.variant', integroVariantFileContent, true));
  const res = await lastValueFrom(client.request.getFile(deviceRef, '.variant', requestTimeout));
  if (res) {
    const parsedVariant = parseIntegroVariantBuffer(Buffer.from(res));
    for (const [_key, value] of Object.entries(parsedVariant.selectedOptionId)) {
      const option = integroVariantOptions.find(option => option.id === value);

      if (option) {
        console.log(`Option ID: ${value}`);
        console.log(`Category: ${option.category}`);
        console.log(`Name: ${option.meaning}`);
        console.log('------------');
      } else {
        console.warn(`Option with ID ${value} not found in integroVariantOptions`);
      }
    }
  }

}).finally(() => client.closeSockets());  
