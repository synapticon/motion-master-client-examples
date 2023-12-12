import { program } from 'commander';
import { client, logStringifiedStatus } from '../init-client';
import { mergeMap } from 'rxjs';

program.parse();

const { requestTimeout = 30000, messageId } = program.opts();

client.onceReady$.pipe(
  mergeMap(() => client.request.getSystemLog(requestTimeout, messageId)),
).subscribe({
  next: logStringifiedStatus,
  complete: () => client.closeSockets(),
});
