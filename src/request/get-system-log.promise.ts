import { program } from 'commander';
import { client, logStringified } from '../init-client';
import { firstValueFrom } from 'rxjs';

program.parse();

const { requestTimeout = 30000, messageId } = program.opts();

client.whenReady().then(async () => {
  const status = await firstValueFrom(client.request.getSystemLog(requestTimeout, messageId));
  logStringified(status);
}).finally(() => client.closeSockets());
