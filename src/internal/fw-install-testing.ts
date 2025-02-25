import { program } from 'commander';
import { client } from '../init-client';
import { lastValueFrom } from 'rxjs';
import { readFileSync, writeFileSync } from 'fs';
import { makeDeviceRefObj, resolveAfter } from 'motion-master-client';

program.parse();

const { deviceRef } = program.opts();

client
  .whenReady()
  .then(async () => {
    try {
      // Please note that these firmware packages are meant to be used for a Circulo 8602-01 device.
      // If You want to run this test, please use the correct firmware packages for Your device.
      const firmwarePackages = [
        { name: 'v5.1.5', path: 'src/internal/v5.1.5.zip' },
        { name: 'v5.4.0-rc.1', path: 'src/internal/v5.4.0-rc.1.zip' },
        { name: 'v5.4.0-rc.4', path: 'src/internal/v5.4.0-rc.4.zip' },
      ];

      const deviceRefObj = makeDeviceRefObj(deviceRef);

      const stats: Record<string, { success: number; failure: number }> = {
        'v5.1.5': { success: 0, failure: 0 },
        'v5.4.0-rc.1': { success: 0, failure: 0 },
        'v5.4.0-rc.4': { success: 0, failure: 0 },
      };

      const installFirmware = async (
        firmwareName: string,
        firmwareContent: Uint8Array
      ): Promise<void> => {
        let attempts = 0;
        let success = false;
        while (!success) {
          attempts++;
          try {
            console.log(`Attempt ${attempts}: Installing ${firmwareName}...`);
            const result = await lastValueFrom(
              client.request.startDeviceFirmwareInstallation(
                {
                  ...deviceRefObj,
                  skipSiiInstallation: true,
                  firmwarePackageContent: firmwareContent,
                },
                120000
              )
            );
            if(result.success) {
              success = true;
              stats[firmwareName].success++;
              console.log(`${firmwareName} installed successfully after ${attempts} attempt(s).`);
            } else {
              stats[firmwareName].failure++;
              console.error(`Failed to install ${firmwareName} on attempt ${attempts}. Retrying...`);
              await resolveAfter(30000);
            }
          } catch (err) {
            stats[firmwareName].failure++;
            console.error(`Failed to install ${firmwareName} on attempt ${attempts}. Retrying...`);
            await resolveAfter(30000);
          }
        }
      };

      for (let i = 0; i < 30; i++) {
        console.log(`\nCycle ${i + 1} of 30`);
        for (const { name, path } of firmwarePackages) {
          const buffer = readFileSync(path);
          const content = new Uint8Array(buffer);

          await installFirmware(name, content);
          console.log('Waiting for the device to boot up...')
          await resolveAfter(30000);
        }
        console.log('-------------------------------------------------------\n');
      }

      console.log('\nFirmware Installation Summary:');
      let summaryOutput = '';
      for (const [firmware, { success, failure }] of Object.entries(stats)) {
        const line = `${firmware}: ${success} successful attempt(s), ${failure} failure(s).`;
        console.log(line);
        summaryOutput += `${line}\n`;
      }

      writeFileSync('fw_installation_summary.txt', summaryOutput);
      console.log('Summary exported to fw_installation_summary.txt');
    } catch (err) {
      if (err instanceof Error) {
        console.error(`ERROR: ${err.message}`);
      }
    }
  })
  .finally(() => client.closeSockets());
