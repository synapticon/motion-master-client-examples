// Command 0: Encoder register communication
// This command is used for reading or writing registers from a BiSS encoder.

import { Argument, program } from 'commander';
import { resolveAfter } from 'motion-master-client';
import { client } from '../init-client';

program
  .addArgument(new Argument('<ordinal>', 'encoder ordinal 1 or 2').argParser(Number))
  .addArgument(new Argument('<readWrite>', 'read: 0 or write: 1').argParser(Number))
  .addArgument(new Argument('<registerAddress>', 'register to be read/written').argParser(Number))
  .addArgument(new Argument('<registerWriteValue>', 'value to write to the register').argParser(Number))

program.parse();

const { deviceRef } = program.opts();
const [ordinal, readWrite, registerAddress, registerWriteValue] = program.processedArgs;

client.whenReady().then(async () => {
  try {
    // Run the OS command
    const command = [0, ordinal, readWrite, registerAddress, registerWriteValue, 0, 0, 0];
    await client.request.download(deviceRef, 0x1023, 1, command);

    // Poll for the response while in progress
    while (true) {
      await resolveAfter(1000);
      const response = await client.request.upload<number[]>(deviceRef, 0x1023, 3);

      if (response[0] === 255) { // In progress
        process.stdout.write('.');
      } else if (response[0] === 1) { // Completed, no errors, has response data
        console.log(` Completed with response ${response[2]}`);
        break;
      } else if (response[0] === 3) { // Completed, errors with response data
        //To start the error, just set the read/write value to a number that is not 0 or 1.
        console.log(` Error code ${response[2]} `);
        break;
      } else {
        throw new Error(`Unexpected response: ${response}`);
      }
    }
  } catch (err) {
    if (err instanceof Error) {
      console.error(err);
    }
  }
}).finally(() => client.closeSockets());
