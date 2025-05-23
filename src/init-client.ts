require('dotenv').config();
import { program, Option } from 'commander';
Object.assign(globalThis, { WebSocket: require('ws') });

import { createMotionMasterClient } from "motion-master-client";
import { v4 } from 'uuid';

if (!process.env.MOTION_MASTER_HOSTNAME) {
  console.error('Error: MOTION_MASTER_HOSTNAME environment variable is not defined.');
  process.exit(1);
}

export const client = createMotionMasterClient({
  clientId: v4(),
  hostname: process.env.MOTION_MASTER_HOSTNAME ?? 'localhost',
  pingSystemInterval: 500,
  pubSubPort: 63525,
  reqResPort: 63524,
  clientAliveTimeout: 3000,
  systemAliveTimeout: 2000,
});
client.request.setSystemClientTimeout({ timeoutMs: 3000000 }).subscribe();

export function logStatus(status: {
  deviceAddress?: number | null,
  success?: { message?: string | null, code?: number | null } | null,
  error?: { message?: string | null, code?: number | null } | null,
  warning?: { message?: string | null, code?: number | null } | null,
  progress?: { message?: string | null, code?: number | null, percentage?: number | null } | null,
}): void {
  if (status.success) {
    console.info(`Request succeeded for device ${status.deviceAddress}: (${status.success.code}) ${status.success.message}`);
  } else if (status.warning) {
    console.warn(`Request warning for device ${status.deviceAddress}: (${status.warning.code}) ${status.warning.message}`);
  } else if (status.error) {
    console.error(`Request failed for device ${status.deviceAddress}: (${status.error.code}) ${status.error.message}`);
  } else if (status.progress) {
    console.info(`Progress for device ${status.deviceAddress}: (${status.progress.code}) ${status.progress.message ?? ''} ${status.progress.percentage}%`);
  }
}

export function logStringified(status: any) {
  console.log(JSON.stringify(status, null, 2));
}

program
  .addOption(
    new Option('-d, --device-ref <value>', 'position, address, or serial number')
      .default(0, '0 position represents the first device in a network chain')
      .argParser((value: string) => {
        const n = Number(value);
        return isNaN(n) ? value : n;
      }),
  )
  .addOption(
    new Option('-t, --request-timeout <value>', 'after sending a request, how long will the client wait for Motion Master to send the status message back')
      .argParser((value: string) => {
        const n = Number(value);
        if (!Number.isInteger(n)) {
          throw new Error(`The request timeout option must be an integer. The provided value is: ${value}`);
        }
        return n;
      }),
  )
  .addOption(
    new Option('-m, --message-id <value>', 'the message ID, which uniquely identifies the request, will be generated by the client library if not specified')
  )
  ;

export function parseDeviceRefArg(value: string) {
  const n = Number(value);
  return isNaN(n) ? value : n;
}
