/**
 * This script configures the SMM (Safety Motion Module).
 *
 * The SMM parameter configuration is loaded from a local CSV file:
 *   src/fp/smm.config.csv
 *
 * It reads the configuration from a CSV file, logs into the SMM device,
 * transmits parameters, and verifies them in groups.
 * Finally, it reads the generated report file and validates the configuration.
 *
 * Usage:
 *   npx ts-node src/fp/configure-smm.ts --device-ref=1 --username=Test --password=SomanetSMM
 *
 * ---
 *
 * ⚠️ **WARNING: SAFETY-CRITICAL APPLICATION & MANDATORY COMPLIANCE**
 *
 * 1. **Scope of Automation**
 *    This script is designed to automate the parameterization of Safe Motion Module.
 *    Use of this script is strictly limited to configurations where a known, valid configuration (.csv) is already available.
 *
 * 2. **Mandatory Checklist Adherence**
 *    Execution of this script does **NOT** bypass the requirements outlined in the
 *    “Commissioning of Joints with Known Safety Configuration” checklist.
 *    The user must ensure all physical prerequisites are met, including:
 *      - Correct mechanical mounting per IEC 61800-5-2:2016.
 *      - Proper encoder calibration.
 *      - Verification that the FSoE Watchdog is correctly configured on the FSoE Master.
 *
 * 3. **Validation of Limits and Reactions**
 *    As per standard operating procedure,
 *    the safety configuration must be manually checked by
 *    intentionally violating limits to trigger and verify the expected reaction.
 *    If safe torque values are used, they must be validated by applying specific torque and verifying the reported data.
 *
 * 4. **System-Level Functional Testing**
 *    Automation of individual drive parameters does not validate the safety of the machine.
 *    The user is legally required to validate the safety functions of the entire system by
 *    triggering every implemented safety function, including establishing a process for repeated testing of STO/SBC functions.
 *
 * 5. **Liability and Archiving**
 *    The developer is not liable for configurations that produce violations during regular operation;
 *    safety margins must be manually adjusted.
 *    Upon completion, the user **MUST** export and archive the safety parameter report along with the commissioning checklists.
 *
 * **BY EXECUTING THIS SCRIPT,
 *  YOU ACKNOWLEDGE THAT YOU HAVE COMPLETED ALL PRE-COMMISSIONING STEPS
 *  AND WILL PERFORM ALL POST-COMMISSIONING VALIDATION TESTS LISTED IN THE PROJECT CHECKLIST.**
 */

import { Option, program } from "commander";
import { readFileSync } from "fs";
import { resolveAfter } from "motion-master-client";
import { lastValueFrom } from "rxjs";

import { client } from "../init-client";

program.addOption(new Option("-u, --username <value>").default("Test"));
program.addOption(new Option("-p, --password <value>").default("SomanetSMM"));

program.parse();

const { deviceRef, username, password } = program.opts();

const smmConfigFilePath = "src/fp/smm.config.csv";
const smmConfigFileContent = readFileSync(smmConfigFilePath, "utf-8");

client
  .whenReady()
  .then(async () => {
    try {
      const report = await lastValueFrom(
        client.request.configureSmmFromFile(
          deviceRef,
          username,
          password,
          smmConfigFileContent,
        ),
      );

      console.log(report);
      console.log("\n=== SMM CONFIGURATION FINISHED SUCCESSFULLY ===\n");
      await resolveAfter(1000);
    } catch (error: any) {
      console.error(error?.message ?? error);
      console.error("\n=== SMM CONFIGURATION FAILED ===\n");
      await resolveAfter(1000);
    }
  })
  .finally(() => client.closeSockets());
