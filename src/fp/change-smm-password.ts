/**
 * This script changes the SMM (Safety Motion Module) password.
 *
 * Usage:
 *   npx ts-node src/fp/change-smm-password.ts --device-ref=1 --username=Test --old-password=SomanetSMM --new-password=<new>
 *
 * The sequence, one step at a time, each step only after the previous one has completed:
 *
 *   1. logout, then login for parameter download with the old password (`reloginToSmmForParameterDownload`)
 *   2. change password (`changeSmmPassword`): the SMM is restarted only if it accepted the change, and the call
 *      completes 3 seconds after the restart, so the next command does not land in the reboot
 *   3. logout, on success and on failure alike
 *
 * What must be isolated:
 *
 * - The drive has a single OS command slot (0x1023) and a single fs-buffer. While this script runs, nothing else may
 *   send OS commands to the same drive: no second script, no Motion Master Console on the OS Commands or SMM page,
 *   no OBLAC Drives, no monitoring tool that reads SMM parameters.
 * - Do not chain SMM calls without waiting for each one to finish, and do not lower the command timeouts. A timeout
 *   on the client does not stop the command on the drive; the next command would then land on a busy SMM.
 * - Do not trigger an SMM restart yourself after the change. The client does that, and only when the SMM accepted it.
 *
 * Passwords are 4 to 24 printable ASCII characters. The client rejects anything else instead of truncating it.
 *
 * If the change fails with "the SMM rejected the request (status 2)", nothing was changed: check the old password.
 * If it fails after "The SMM accepted the password change", do not retry with other passwords; contact Synapticon
 * support with the device serial number.
 */

import { Option, program } from "commander";
import { lastValueFrom } from "rxjs";

import { client } from "../init-client";

program.addOption(new Option("-u, --username <value>").default("Test"));
program.addOption(new Option("--old-password <value>").default("SomanetSMM"));
program.addOption(new Option("--new-password <value>").makeOptionMandatory());

program.parse();

const { deviceRef, username, oldPassword, newPassword } = program.opts();

client
  .whenReady()
  .then(async () => {
    try {
      await lastValueFrom(
        client.request.reloginToSmmForParameterDownload(deviceRef, username, oldPassword),
        { defaultValue: undefined },
      );
      await lastValueFrom(
        client.request.changeSmmPassword(deviceRef, oldPassword, newPassword),
        { defaultValue: undefined },
      );
      console.log("\n=== SMM PASSWORD CHANGED ===\n");
    } catch (error: any) {
      console.error(error?.message ?? error);
      console.error("\n=== SMM PASSWORD CHANGE FAILED ===\n");
      process.exitCode = 1;
    } finally {
      try {
        await lastValueFrom(client.request.logoutFromSmm(deviceRef), { defaultValue: undefined });
      } catch (error: any) {
        console.error(error?.message ?? error);
      }
    }
  })
  .finally(() => client.closeSockets());
