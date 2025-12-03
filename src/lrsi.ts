import { program, Option } from "commander";
import { client } from "./init-client";
import {
  LimitedRangeSystemIdentification,
  ModesOfOperation,
  SystemIdentificationOsCommandSignalType,
  SystemIdentificationOsCommandStartProcedure,
} from "motion-master-client";

program.addOption(new Option("-i, --iterations <value>", "specify the number of iterations").default("5"));

program.parse();

const { deviceRef, iterations } = program.opts();
const iterationsNumber = parseInt(iterations, 10);

client
  .whenReady()
  .then(async () => {
    for (let i = 0; i < iterationsNumber; i++) {
      console.log(`Starting LRSI iteration ${i + 1}/${iterationsNumber}...`);
      const start = performance.now();
      const lrsi = new LimitedRangeSystemIdentification(client, deviceRef, {
        rangeLimitMin: 1000,
        rangeLimitEff: 1000000,
        modesOfOperation: ModesOfOperation.CYCLIC_SYNC_POSITION_MODE,
        targetAmplitude: 100,
        startFrequency: 1000,
        targetFrequency: 100000,
        transitionTime: 3000,
        hrdStreamingDuration: 3200,
        signalType: SystemIdentificationOsCommandSignalType.LINEAR_WITH_CONSTANT_AMPLITUDE,
        startProcedure: SystemIdentificationOsCommandStartProcedure.WAIT_FOR_HRD_STREAMING_TO_START,
      });
      await lrsi.start();
      const duration = performance.now() - start;
      console.log(`LRSI iteration ${i + 1} completed in ${duration.toFixed(2)} ms.`);
    }
  })
  .finally(() => client.closeSockets());
