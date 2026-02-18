/**
 * This script configures the SMM (Safety Motion Module).
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
import { client } from "../init-client";
import {
  ConfigFile,
  convertGroupedSmmParametersToTransmitData,
  mapByProperty,
  ParameterValueType,
  resolveSmmOd,
} from "motion-master-client";
import { readFileSync } from "fs";
import { lastValueFrom } from "rxjs";
import { log } from "console";

program.addOption(new Option("-u, --username <value>").default("Test"));
program.addOption(new Option("-p, --password <value>").default("SomanetSMM"));

program.parse();

const { deviceRef, username, password } = program.opts();

const smmConfigFilePath = "src/fp/smm.config.csv";
const smmConfigFileContent = readFileSync(smmConfigFilePath, "utf-8");

client
  .whenReady()
  .then(async () => {
    // Parse the CSV file content to get the values.
    const configFile = new ConfigFile(smmConfigFileContent);

    // The Parameter Structure Version is retrieved from the SMM device.
    // The loaded CSV file must match the parameter structure version of the SMM.
    const parameterStructureVersion = await lastValueFrom(
      client.request.resolveSmmParameterStructureVersion(deviceRef)
    );

    // The SMM Object Dictionary (SMM OD) is resolved based on the parameter structure version.
    // There are two versions currently supported: LW1 and LW2 (Launch Wave 1 and 2).
    // Parameter structure version less than 2.3 (0x0203) is LW1, and greater than or equal to 2.3 is LW2.
    const smmOd = resolveSmmOd(parameterStructureVersion);

    // Initialize an object to hold parameter values grouped by safety group.
    const groupedValues: Record<string, ParameterValueType[]> = {};

    // Iterate through each safety group and its associated parameters.
    for (const [group, smmOdParameters] of mapByProperty(smmOd.parameters.safety, "group")) {
      // Map each parameter to its value from the config file, defaulting to 0 if not found.
      const values = smmOdParameters.map(
        ({ index, subindex }) =>
          configFile.parameters.find((p) => p.index === index && p.subindex === subindex)?.value ?? 0
      );
      // Assign the resolved values to the corresponding group.
      groupedValues[group] = values;
    }

    // Add the parameter structure version under the "None" group.
    groupedValues["None"] = [parameterStructureVersion];

    // Convert the grouped map of SMM parameter values into a flat array suitable for transmission.
    // This step is crucial to ensure parameters are ordered correctly.
    // For example, SLS[1-4] parameter values must be transposed to match the order expected by the SMM.
    const values = convertGroupedSmmParametersToTransmitData(groupedValues);

    // Check if the number of parameters in the configuration file matches the number of parameters in the SMM.
    // The parameter structure version is not included in the configuration file.
    if (values.length - 1 !== configFile.parameters.length) {
      console.error(
        `The number of parameters in the configuration file (${
          configFile.parameters.length
        }) does not match the number of parameters in the SMM (${values.length - 1}).`
      );
    }

    // Log out of the SMM in case a previous session is still active,
    // since attempting to log in again without logging out first will result in an error.
    console.log("Logging out of SMM in a case a previous session is still active...");
    let success = await lastValueFrom(client.request.logoutFromSmm(deviceRef));

    if (!success) {
      console.error("Failed to log out from SMM.");
      return;
    } else {
      log("Logged out successfully.");
    }

    // Log in to the SMM for parameter download.
    console.log(`Logging in to SMM for parameter download with username "${username}" and password "${password}"...`);
    success = await lastValueFrom(client.request.loginToSmmForParameterDownload(deviceRef, username, password));

    if (!success) {
      console.error("Failed to log in to SMM. Check username and password.");
      return;
    } else {
      log("Logged in successfully.");
    }

    // Transmit the values to the SMM.
    console.log("Transmitting values to SMM...");
    console.log(values.join(","));
    success = await lastValueFrom(client.request.transmitSmmParameters(deviceRef, values, parameterStructureVersion));

    if (!success) {
      console.error("Failed to transmit values to SMM.");
      return;
    } else {
      log("Values transmitted successfully.");
    }

    // Load the previously transmitted values from the SMM for verification.
    console.log("Loading SMM parameters for verification...");
    let status = await lastValueFrom(client.request.loadSmmParametersForVerification(deviceRef));

    if (status.request === "failed") {
      console.error("Failed to load SMM parameters for verification.");
      return;
    } else {
      log("Loaded SMM parameters for verification successfully.");
    }

    // Check if the loaded values match the transmitted values.
    if (status.values.join(",") !== values.join(",")) {
      console.error("Loaded values do not match transmitted values.");
      console.error(status.values.join(","));
      return;
    }

    // Sequentially verify each group of transmitted values.
    // Skip the first group ("None"), which contains the parameter structure version.
    for (let i = 1; i < Object.keys(groupedValues).length; i++) {
      const [group, values] = Object.entries(groupedValues)[i];

      console.log(`Verifying group "${group}" at index ${i}...`);

      const success = await lastValueFrom(
        client.request.verifySmmParameters(deviceRef, values, i, parameterStructureVersion)
      );

      if (!success) {
        console.error(`Failed to verify group "${group}".`);
        return;
      } else {
        log(`Group "${group}" verified successfully.`);
      }
    }

    // Load the SMM validation file and read the safety parameters report file.
    console.log("Loading SMM validation file and reading safety parameters report file...");
    const validationFile = await lastValueFrom(
      client.request.loadSmmValidationFileAndReadSafetyParametersReportFile(deviceRef)
    );

    if (!validationFile) {
      console.error("Failed to load SMM validation file.");
      return;
    } else {
      console.log(validationFile);
    }

    // Validate the SMM configuration using the loaded report file.
    console.log("Validating SMM configuration...");
    const report = new TextEncoder().encode(validationFile);
    success = await lastValueFrom(
      client.request.validateSmmConfiguration(deviceRef, report, new Date(), username, password)
    );

    if (!success) {
      console.error("Failed to validate SMM configuration.");
      return;
    } else {
      log("SMM configuration validated successfully.");
    }

    // Log out of the SMM.
    console.log("Logging out of SMM...");
    success = await lastValueFrom(client.request.logoutFromSmm(deviceRef));

    if (!success) {
      console.error("Failed to log out from SMM.");
      return;
    } else {
      log("Logged out successfully.");
    }

    log("SMM configuration completed successfully.");
  })
  .finally(() => client.closeSockets());
