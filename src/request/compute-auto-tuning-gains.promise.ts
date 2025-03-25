import { Argument, program } from "commander";
import { makeDeviceRefObj } from "motion-master-client";
import { lastValueFrom } from "rxjs";
import { client, logStringified } from "../init-client";

program.addArgument(new Argument("<controllerType>", 'controller type, either "position" or "velocity"'));
program.addArgument(new Argument("<parameters>", "controller parameters"));

program.parse();

const { deviceRef, requestTimeout = 10000, messageId } = program.opts();
const deviceRefObj = makeDeviceRefObj(deviceRef);
const [controllerType, parameters] = program.processedArgs as [string, string];

const input = { [`${controllerType}Parameters`]: JSON.parse(parameters) };
console.log(input);

// npx ts-node .\src\request\compute-auto-tuning-gains.promise.ts --device-ref=1 velocity '{"""velocityLoopBandwidth""": 11.80, """velocityDamping""": 0.80}'
// npx ts-node .\src\request\compute-auto-tuning-gains.promise.ts --device-ref=1 position '{"""controllerType""": 1, """settlingTime""": 76, """positionDamping""": 1.00, """alphaMult""": 1, """order""": 1, """lb""": 1, """ub""": 1}'

client
  .whenReady()
  .then(async () => {
    const status = await lastValueFrom(
      client.request.computeAutoTuningGains({ ...deviceRefObj, ...input }, requestTimeout, messageId)
    );
    logStringified(status);
  })
  .finally(() => client.closeSockets());
