import { program } from 'commander';
import { client } from '../init-client';
import { lastValueFrom } from 'rxjs';
import { resolveAfter } from 'motion-master-client';

program.parse();

/**
 * This test is used to demonstrate the behavior of the OS Command when the command is executed and the response is not read.
 * The name of the error the firmware throws is 'OsCmdCol'.
 */

const { deviceRef } = program.opts();

client.whenReady().then(async () => {
  const command = new Uint8Array([0]);
  try {
    const requests = [
      /**
      *  Initially get the value of the OS Command, to ensure that a command is not running
      */
      () => lastValueFrom(client.request.getParameterValue(deviceRef, 0x1023, 3)),
      /**
      *  Write a OS Command to the device
      */
      () => lastValueFrom(client.request.setParameterValue(deviceRef, 0x1023, 1, command)),
      /**
      *  Get a response from the OS Command
      */
      () => lastValueFrom(client.request.getParameterValue(deviceRef, 0x1023, 3)),
      /**
      *  If the timeout is not changed, it will be 1000ms.
      *  If the timeout between the command and the response is too short, this will cause the error in the next command,
      *  as the command still has the 'executing' status.
      *  Otherwise, it should return the OS Command response. This is why resolveAfter value is set to 5000ms.
      */
      () => lastValueFrom(client.request.setParameterValue(deviceRef, 0x1023, 1, command)),
      /**
      *  As the previous command has finished, but the response hasn't been read by reading the value of 0x1023:3,
      *  an error 'Failed to set parameter value (NOT_CHANGED)' will be thrown.
      */
      () => lastValueFrom(client.request.setParameterValue(deviceRef, 0x1023, 1, command)),
    ];

    for (let i = 0; i < 1; i++) {
      for (const request of requests) {
        const result = await request();
        console.log(result);
        await resolveAfter(5000);
      }
      console.log('-------------------------------------------------------\n')
    }
  } catch (err: unknown) {
    if (err instanceof Error) {
      console.error(`ERROR: ${err.message}`);
    }
  }
}).finally(() => client.closeSockets());
