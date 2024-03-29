import { Argument, program } from 'commander';
import { makeDeviceRefObj } from 'motion-master-client';
import { readFileSync } from 'fs';
import { mergeMap } from 'rxjs';
import { client, logStringified } from '../init-client';

program
  .addArgument(new Argument('<name>', 'file name, e.g. config.csv'))
  .addArgument(new Argument('<path>', 'Path to a file to write onto the device\'s flash'))
  .addArgument(new Argument('[overwrite]', 'overwrite the existing file with the same name')
    .argOptional()
    .default(false)
    .choices(['true', 'false'])
    .argParser((value) => value.toLowerCase() === 'true'));

program.parse();

const { deviceRef, requestTimeout = 5000, messageId } = program.opts();
const deviceRefObj = makeDeviceRefObj(deviceRef);
const [name, path, overwrite] = program.processedArgs as [string, string, boolean];

const content = Buffer.from(readFileSync(path, { encoding: 'utf-8' }), 'utf-8');

client.onceReady$.pipe(
  mergeMap(() => client.request.setDeviceFile({ ...deviceRefObj, name, content, overwrite }, requestTimeout, messageId)),
).subscribe({
  next: logStringified,
  complete: () => client.closeSockets(),
});
