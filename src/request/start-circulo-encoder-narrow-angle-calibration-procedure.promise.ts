import { Argument, program } from "commander";
import { makeDeviceRefObj } from "motion-master-client";
import { client, logStringified } from "../init-client";
import { lastValueFrom } from "rxjs";

program.addArgument(
  new Argument("<encoderOrdinal>", "Encoder ordinal (1-based)").argParser((value) => parseInt(value, 10))
);

program.parse();

const { deviceRef, requestTimeout = 60000, messageId } = program.opts();
const deviceRefObj = makeDeviceRefObj(deviceRef);
const [encoderOrdinal] = program.processedArgs as [number];

client
  .whenReady()
  .then(async () => {
    const status = await lastValueFrom(
      client.request.startCirculoEncoderNarrowAngleCalibrationProcedure(
        { ...deviceRefObj, encoderOrdinal },
        requestTimeout,
        messageId
      )
    );
    logStringified(status);
  })
  .finally(() => client.closeSockets());
