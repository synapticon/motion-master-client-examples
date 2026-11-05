/**
 * This script changes the SMM (Safety Motion Module) password.
 *
 * Usage:
 *   npx ts-node src/fp/change-smm-password.ts --device-ref=1 --username=<your name> --old-password=SomanetSMM --new-password=<new>
 *
 * The username is mandatory and must be the name of the person who runs the script. The SMM writes the username of
 * each login into its safety parameters report, which records who configured the SMM.
 *
 * The sequence, one step at a time, each step only after the previous one has completed:
 *
 *   1. logout, then login for parameter download with the old password (`reloginToSmmForParameterDownload`)
 *   2. change password (`changeSmmPassword`): only if the SMM accepted the change, the client logs in with the username
 *      and the new password until the SMM accepts it. The SMM acknowledges the change before it writes the password to its EEPROM
 *      and refuses logins until the write is done, so the accepted login proves the new password is stored. The SMM is
 *      not restarted: a restart during the write makes it reject both the new and the old password. After the call the
 *      session of that login is open, so further SMM commands can follow without a new login.
 *   3. logout: closes the session, after a successful change and after a rejected one alike
 *
 * What must be isolated:
 *
 * - The drive has a single OS command slot (0x1023) and a single fs-buffer. While this script runs, nothing else may
 *   send OS commands to the same drive: no second script, no Motion Master Console on the OS Commands or SMM page,
 *   no OBLAC Drives, no monitoring tool that reads SMM parameters.
 * - Do not chain SMM calls without waiting for each one to finish, and do not lower the command timeouts. A timeout
 *   on the client does not stop the command on the drive; the next command would then land on a busy SMM.
 * - Do not restart the SMM after the change. The new password works without a restart. Requires motion-master-client
 *   0.0.424 or later; earlier versions restart the SMM right after the change, which can interrupt the write.
 *
 * The username and the new password are 4 to 24 printable ASCII characters. The client rejects anything else before
 * it sends anything, instead of truncating it.
 *
 * If the change fails with "the SMM rejected the request (status 2)", nothing was changed: check the old password.
 * If it fails with "did not accept a login with the new password", the stored password is unknown. Do not change the
 * password again; try to log in with the new password, then with the old one, and if neither works contact Synapticon
 * support with the device serial number.
 */

import { Option, program } from "commander";
import { lastValueFrom } from "rxjs";

import { client } from "../init-client";

program.addOption(new Option("-u, --username <value>").makeOptionMandatory());
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
        client.request.changeSmmPassword(deviceRef, username, oldPassword, newPassword),
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
