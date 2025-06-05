import { program } from "commander";
import { client } from "../init-client";
import { lastValueFrom } from "rxjs";
import { readFileSync } from "fs";

program.parse();

const { deviceRef } = program.opts();

client
  .whenReady()
  .then(async () => {
    try {
      let value = await client.request.upload(deviceRef, 0x2003, 4);
      console.log("Current value:", value);

      console.log("Loading configuration...");
      const content = readFileSync("src/request/config.csv", "utf-8");
      await lastValueFrom(client.request.loadConfig(deviceRef, content, { count: 10, delay: 500 }));
      console.log("done.");

      value = await client.request.upload(deviceRef, 0x2003, 4);
      console.log("New value:", value);
    } catch (err: unknown) {
      if (err instanceof Error) {
        console.error(`ERROR: ${err.message}`);
      }
    }
  })
  .finally(() => client.closeSockets());
