//Command 3: HRD streaming
//This command is used for streaming data into files. The data written to these files is in binary format.

import { Argument, program } from 'commander';
import { resolveAfter } from 'motion-master-client';
import { client } from '../init-client';

program
  .addArgument(new Argument('<ordinal>', 'Encoder ordinal 1 or 2').argParser(Number))
  .addArgument(new Argument('<register>', 'Encoder register to be written on').argParser(Number))
  .addArgument(new Argument('<duration>', 'Streaming duration time (in milli-seconds; maximum duration is 10000ms)').argParser(Number))
program.parse();

const [ordinal, register, duration] = program.processedArgs;

const { deviceRef } = program.opts();

client.whenReady().then(async () => {
  try {
    //Configurion mode on encoder ordinal
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
    const OS0command = [0, ordinal, 1, register, 1, 0, 0, 0];
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

    //OS Command 1 - changing mode to output Raw data:
    const ordinalMode: number = 8 + ordinal;
    const os1Command = [1, ordinalMode, 0, 0, 0, 0, 0, 0];
    await client.request.download(deviceRef, 0x1023, 1, os1Command);

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

    //Configure the streaming

    let hexadecimalValue = duration.toString(16);

    if (hexadecimalValue.length < 4) {       //padding so we always have 2 bytes, regardless of the number
      hexadecimalValue = hexadecimalValue.padStart(4, '0');
    }

    const bytes: Array<number> = [];

    for (let i = 0; i < hexadecimalValue.length; i += 2) {
      const byte = parseInt(hexadecimalValue.substr(i, 2), 16);
      bytes.push(byte);
    }

    const configureStreamingCommand = [3, 0, 0, bytes[0], bytes[1], 0, 0, 0];
    await client.request.download(deviceRef, 0x1023, 1, configureStreamingCommand);

    // Poll for the response while in progress
    while (true) {
      await resolveAfter(1000);
      const response = await client.request.upload<number[]>(deviceRef, 0x1023, 3);

      if (response[0] === 255) { // In progress
        process.stdout.write('.');
      } else if (response[0] === 0) { // Completed, no errors, has no response data
        console.log(` Completed!`);
        break;
      } else if (response[0] === 3) { // Completed, errors with response data
        console.log(`Error repsonse code: ${response[2]} `);
        break;
      } else {
        throw new Error(`Unexpected response: ${response}`);
      }
    }

    const os3Command = [3, 1, 0, 0, 0, 0, 0, 0];
    await client.request.download(deviceRef, 0x1023, 1, os3Command);

    while (true) {
      await resolveAfter(1000);
      const response = await client.request.upload<number[]>(deviceRef, 0x1023, 3);

      if (response[0] >= 100 && response[0] <= 200) { // In progress with percentage
        console.log(response[0]-100, '%');
      } else if (response[0] === 255) { // In progress
        process.stdout.write('.');
      } else if (response[0] === 0) { // Completed, no errors, has no response data
        console.log(`Completed!`);
        break;
      } else if (response[0] === 3) { // Completed, errors with response data
        console.log(`Error repsonse code: ${response[2]} `);
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
