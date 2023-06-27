//Command 1: iC-MU calibration mode
//This command is used to be able to set a particular BiSS mode when using an iC-MU encoder, which is mostly used for iC-MU calibration.

import { Argument, program } from 'commander';
import { resolveAfter } from 'motion-master-client';
import { client } from '../init-client';

program
  .addArgument(new Argument('<ordinal>', 'Encoder ordinal 1 or 2').argParser(Number))
  .addArgument(new Argument('<mode>', 'Set a BiSS encoder mode (0 - Configuration, 1 - Raw, 2 - Standard)').argParser(Number))
  .addArgument(new Argument('<register>', 'Encoder register to be written on').argParser(Number))
program.parse();

const [ordinal, mode, register] = program.processedArgs;

const { deviceRef } = program.opts();

client.whenReady().then(async () => {
  try {
    //Configuration mode on encoder ordinal selected
    const freezeCommand = [1, ordinal, 0, 0, 0, 0, 0, 0];
    await client.request.download(deviceRef, 0x1023, 1, freezeCommand);

    while (true) {
      await resolveAfter(1000);
      const response = await client.request.upload<number[]>(deviceRef, 0x1023, 3);

      if (response[0] === 255) { // In progress
        process.stdout.write('.');
      } else if (response[0] === 0) { // Completed, no errors, has no response data
        console.log('Enabled Configuration mode to freeze the current absolute position');
        break;
      } else {
        throw new Error(`Unexpected response: ${response}`);
      }
    }

    // OS command 0 to configure Encoder 1 to output raw mode 
    const OS0command = [0, ordinal, 1, register, mode, 0, 0, 0];
    await client.request.download(deviceRef, 0x1023, 1, OS0command);

    // Poll for the response while in progress
    while (true) {
      await resolveAfter(1000);
      const response = await client.request.upload<number[]>(deviceRef, 0x1023, 3);

      if (response[0] === 255) { // In progress
        process.stdout.write('.');
      } else if (response[0] === 1) { // Completed, no errors, has response data
        console.log(`Configured Encoder 1 to output mode: ${response[2]}`);
        break;
      } else if (response[0] === 3) { // Completed, errors with response data
        console.log(`Error code ${response[2]} `);
        break;
      } else {
        throw new Error(`Unexpected response: ${response}`);
      }
    }

    //Changing mode:
    const ordinalMode: number = (mode * 8) + ordinal;
    const command = [1, ordinalMode, 0, 0, 0, 0, 0, 0];
    await client.request.download(deviceRef, 0x1023, 1, command);

    while (true) {
      await resolveAfter(1000);
      const response = await client.request.upload<number[]>(deviceRef, 0x1023, 3);

      if (response[0] === 255) { // In progress
        process.stdout.write('.');
      } else if (response[0] === 0) { // Completed, no errors, has response data
        console.log('Switched the mode.');
        break;
      } else if (response[0] === 2) { // Completed with errors, has no response data
        console.log('Error without response.');
        break;
      } else if (response[0] === 3) { // Completed with errors with response data
        console.log(`Error with response code: ${response[3]}.`);
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
