import { program } from "commander";
import { makeDeviceRefObj } from "motion-master-client";
import { client, logStringified } from "../init-client";
import { mergeMap } from "rxjs";

program.parse();

const { deviceRef, requestTimeout = 60000, messageId } = program.opts();
const deviceRefObj = makeDeviceRefObj(deviceRef);

client.onceReady$
  .pipe(
    mergeMap(() => client.request.stopDevice(deviceRefObj, requestTimeout, messageId)),
    mergeMap(() =>
      client.request.startCirculoEncoderNarrowAngleCalibrationProcedure(
        { ...deviceRefObj, encoderOrdinal: 1 },
        requestTimeout,
        messageId
      )
    ),
    mergeMap(() => client.request.startOffsetDetection(deviceRefObj, requestTimeout, messageId))
  )
  .subscribe({
    next: logStringified,
    error: (error) => {
      console.error(`Error: ${error.message}`);
      client.closeSockets();
    },
    complete: () => client.closeSockets(),
  });
