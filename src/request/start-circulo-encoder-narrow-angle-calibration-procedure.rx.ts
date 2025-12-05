import { Argument, program } from "commander";
import { makeDeviceRefObj } from "motion-master-client";
import { client, logStringified } from "../init-client";
import { mergeMap } from "rxjs";

program.addArgument(
  new Argument("<encoderOrdinal>", "Encoder ordinal (1-based)").argParser((value) => parseInt(value, 10))
);

program.parse();

const { deviceRef, requestTimeout = 60000, messageId } = program.opts();
const deviceRefObj = makeDeviceRefObj(deviceRef);
const [encoderOrdinal] = program.processedArgs as [number];

client.onceReady$
  .pipe(
    mergeMap(() =>
      client.request.startCirculoEncoderNarrowAngleCalibrationProcedure(
        { ...deviceRefObj, encoderOrdinal },
        requestTimeout,
        messageId
      )
    )
  )
  .subscribe({
    next: logStringified,
    complete: () => client.closeSockets(),
  });
