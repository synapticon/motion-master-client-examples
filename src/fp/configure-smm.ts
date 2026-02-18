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
 */

import { Option, program } from "commander";
import { client } from "../init-client";
import { readFileSync } from "fs";
import { lastValueFrom } from "rxjs";

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
      const report = await lastValueFrom(client.request.configureSmmFromFile(
        deviceRef,
        username,
        password,
        smmConfigFileContent,
      ));

      console.log("\n=== SMM CONFIGURATION SUCCESS ===\n");
      console.log(report);
    } catch (error: any) {
      console.error("\n=== SMM CONFIGURATION FAILED ===\n");
      console.error(error?.message ?? error);
    }
  })
  .finally(() => client.closeSockets());
