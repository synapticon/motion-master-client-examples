import { program, Option } from "commander";
import { client } from "./init-client";
import { analyzeTimeDurations } from "motion-master-client";
import { performance } from "perf_hooks";

program.addOption(new Option("-i, --iterations <value>", "specify the number of iterations").default("100"));

program.parse();

const { deviceRef, iterations } = program.opts();
const iterationsNumber = parseInt(iterations, 10);

client
  .whenReady()
  .then(async () => {
    const durations: number[] = [];

    for (let i = 0; i < iterationsNumber; i++) {
      const start = performance.now();
      await client.request.download(deviceRef, 0x2012, 0x01, 0.0025);
      const duration = performance.now() - start;
      durations.push(duration);
    }

    const stats = analyzeTimeDurations(durations);
    console.log(JSON.stringify(stats.filteredStats, null, 2));
  })
  .finally(() => client.closeSockets());
