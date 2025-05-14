import { program } from "commander";
import { makeDeviceRefObj } from "motion-master-client";
import { client } from "../init-client";
import { lastValueFrom } from "rxjs";

program.parse();

const { deviceRef, requestTimeout = 60000, messageId } = program.opts();
const deviceRefObj = makeDeviceRefObj(deviceRef);

client
  .whenReady()
  .then(async () => {
    await client.request.quickStop(deviceRef);

    console.log("Running Circulo Encoder Calibration...");

    const calibrationStatus = await lastValueFrom(
      client.request.startCirculoEncoderNarrowAngleCalibrationProcedure(
        { ...deviceRefObj, encoderOrdinal: 1 },
        requestTimeout,
        messageId
      )
    );

    if (calibrationStatus.request === "failed") {
      console.error(`Error during Circulo Encoder Calibration: ${calibrationStatus.error?.message}`);
      return;
    } else {
      console.log("Circulo Encoder Calibration completed.");
    }

    console.log("Running Offset Detection...");

    const offsetDetectionStatus = await lastValueFrom(
      client.request.startOffsetDetection({ ...deviceRefObj }, requestTimeout, messageId)
    );

    if (offsetDetectionStatus.request === "failed") {
      console.error(`Error during Offset Detection: ${offsetDetectionStatus.error?.message}`);
      return;
    } else {
      console.log("Offset Detection completed.");
    }
  })
  .finally(() => client.closeSockets());
