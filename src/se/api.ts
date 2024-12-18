/***********************************************************************************************************
 * NOTE: This code was copied from the synapticon/oblac repository and may not reflect the latest updates. *
 ***********************************************************************************************************/

import debug from 'debug';
import express, { Application, NextFunction, Request, Response } from 'express';
import cors from 'cors'
import { lastValueFrom } from 'rxjs';
import {
  MotionMasterClient,
  DeviceRef,
  DeviceParameterIds,
  createMotionMasterClient,
  ensureDeviceRef,
  makeDeviceRefObj,
  ModesOfOperation,
  Cia402State,
  MotionMasterMessage,
  makeParameterId,
  IntegroEncoderCalibration,
  MotionComposerRunner,
  MotionComposer,
} from 'motion-master-client';

Object.assign(globalThis, { WebSocket: require('ws') });

const log = debug('mmapi');

const app: Application = express();
const port = process.env['PORT'] ?? 63526;

let client: MotionMasterClient | undefined;

function errmsg(err: unknown) {
  return err instanceof Error ? err.message : 'Unknown error';
}

function asBoolean(value: string | undefined) {
  if (!value) {
    return false;
  }
  return value.toLowerCase() === 'true' || value === '1';
}

function createDefaultDataMonitoringParameterIds(deviceRef: DeviceRef): DeviceParameterIds {
  return [
    // 0x1600: RxPDO Mapping 1
    [deviceRef, 0x6040, 0x00], // Controlword
    [deviceRef, 0x6060, 0x00], // Modes of operation
    [deviceRef, 0x6071, 0x00], // Target Torque
    [deviceRef, 0x607a, 0x00], // Target position
    [deviceRef, 0x60ff, 0x00], // Target velocity
    [deviceRef, 0x60b2, 0x00], // Torque offset
    [deviceRef, 0x2701, 0x00], // Tuning command
    // 0x1601: RxPDO Mapping 2
    [deviceRef, 0x60fe, 0x01], // Physical outputs
    [deviceRef, 0x60fe, 0x02], // Bit mask
    // 0x1602: RxPDO Mapping 3
    [deviceRef, 0x2703, 0x00], // User MOSI
    [deviceRef, 0x60b1, 0x00], // Velocity offset
    // 0x1A00: TxPDO Mapping 1
    [deviceRef, 0x6041, 0x00], // Statusword
    [deviceRef, 0x6061, 0x00], // Modes of operation display
    [deviceRef, 0x6064, 0x00], // Position actual value
    [deviceRef, 0x606c, 0x00], // Velocity actual value
    [deviceRef, 0x6077, 0x00], // Torque actual value
    [deviceRef, 0x60f4, 0x00],
    // 0x1A01: TxPDO Mapping 2
    [deviceRef, 0x2401, 0x00], // Analog input 1
    [deviceRef, 0x2402, 0x00], // Analog input 2
    [deviceRef, 0x2403, 0x00], // Analog input 3
    [deviceRef, 0x2404, 0x00], // Analog input 4
    [deviceRef, 0x2702, 0x00], // Tuning status
    // 0x1A02: TxPDO Mapping 3
    [deviceRef, 0x60fd, 0x00], // Digital inputs
    // 0x1A03: TxPDO Mapping 4
    [deviceRef, 0x2704, 0x00], // User MISO
    [deviceRef, 0x20f0, 0x00], // Timestamp
    [deviceRef, 0x60fc, 0x00], // Position demand internal value
    [deviceRef, 0x606b, 0x00], // Velocity demand value
    [deviceRef, 0x6074, 0x00], // Torque demand
  ];
}

// Enable CORS for all routes and all origins
app.use(cors());

// Middleware to parse JSON body
app.use(express.json({ limit: '10mb' }));

// Middleware to parse raw binary data
app.use(express.raw({ type: 'application/octet-stream', limit: '10mb' }));

// Middleware to handle a non-existing instance of a client
app.use((req: Request, res: Response, next: NextFunction): void => {
  if (req.path.startsWith('/api/connect') || req.path === '/api/disconnect' || req.path === '/api/version') {
    return next();
  }

  if (!client) {
    res.status(400).send({ message: 'Client has not been created. Please connect using GET /api/connect/:hostname? before making requests to Motion Master.' });
    return;
  }

  next();
});

// Middleware to handle errors
app.use((err: Error, _req: Request, res: Response, _next: NextFunction): void => {
  log(`Error in handler: ${err.message}`);
  res.status(500).send({ message: errmsg(err) });
});

type AsyncHandlerFunction = (req: Request, res: Response, next: NextFunction) => Promise<void>;

// Async error handling middleware
const asyncHandler = (fn: AsyncHandlerFunction) => async (req: Request, res: Response, next: NextFunction) => {
  try {
    await fn(req, res, next);
  } catch (err: unknown) {
    if (err instanceof Error) {
      log(`Error in async handler: ${err.message}`);
    }
    res.status(500).send({ message: errmsg(err) });
  }
};

// app.get('/api/version', (_req: Request, res: Response) => {
//   res.send({ version: packageJson.version });
// });

app.get('/api/connect/:hostname?', async (req: Request, res: Response) => {
  if (client) {
    res.status(409).send({ message: 'Client has already been created. Please disconnect (GET /api/disconnect) before creating a new client.' });
    return;
  }

  const hostname = req.params['hostname'] ?? '127.0.0.1';
  log(`Creating an instance of Motion Master client and connecting to ${hostname}.`);
  client = createMotionMasterClient(hostname);
  try {
    await client.whenReady(10000);
    res.send({ reqResUrl: client.reqResSocket.url, pubSubUrl: client.pubSubSocket.url });
  } catch (err) {
    client = undefined;
    res.status(500).send({ message: errmsg(err) });
  }
});

app.get('/api/disconnect', (_req: Request, res: Response) => {
  log(`Client is disconnecting.`);
  client?.closeSockets();
  client = undefined;
  res.status(204).send();
});

app.get('/api/system-version', asyncHandler(async (_req: Request, res: Response) => {
  const status = await lastValueFrom(client!.request.getSystemVersion(5000));

  res.send({ version: status.version });
}));

app.get('/api/devices', asyncHandler(async (_req: Request, res: Response) => {
  const devices = await lastValueFrom(client!.request.getDevices(10000));

  res.send(devices);
}));

app.get('/api/devices/:deviceRef/parameter-info', asyncHandler(async (req: Request, res: Response) => {
  const deviceRef = ensureDeviceRef(req.params['deviceRef']);
  const deviceRefObj = makeDeviceRefObj(deviceRef);

  const status = await lastValueFrom(client!.request.getDeviceParameterInfo(deviceRefObj, 5000));

  res.send(status?.parameters);
}));

app.get('/api/devices/:deviceRef/upload/:index/:subindex', asyncHandler(async (req: Request, res: Response) => {
  const deviceRef = ensureDeviceRef(req.params['deviceRef']);
  const index = parseInt(req.params['index'], 16);
  const subindex = parseInt(req.params['subindex'], 16);

  const value = await client!.request.upload(deviceRef, index, subindex);

  res.send({ value });
}));

app.get('/api/devices/:deviceRef/download/:index/:subindex/:value', asyncHandler(async (req: Request, res: Response) => {
  const deviceRef = ensureDeviceRef(req.params['deviceRef']);
  const index = parseInt(req.params['index'], 16);
  const subindex = parseInt(req.params['subindex'], 16);
  const value = req.params['value'];

  await client!.request.download(deviceRef, index, subindex, value);

  res.status(204).send();
}));

app.get('/api/devices/:deviceRef/files', asyncHandler(async (req: Request, res: Response) => {
  const deviceRef = ensureDeviceRef(req.params['deviceRef']);

  const value = await lastValueFrom(client!.request.getFiles(deviceRef));

  res.send(value);
}));

app.get('/api/devices/:deviceRef/files/unlock', asyncHandler(async (req: Request, res: Response) => {
  const deviceRef = ensureDeviceRef(req.params['deviceRef']);

  await lastValueFrom(client!.request.unlockProtectedFiles(deviceRef));

  res.send();
}));

app.get('/api/devices/:deviceRef/files/:filename', asyncHandler(async (req: Request, res: Response) => {
  const deviceRef = ensureDeviceRef(req.params['deviceRef']);
  const filename = req.params['filename'];

  const value = await lastValueFrom(client!.request.getDecodedFile(deviceRef, filename, 30000));

  res.send(value);
}));

app.put('/api/devices/:deviceRef/files/:filename', asyncHandler(async (req: Request, res: Response) => {
  const deviceRef = ensureDeviceRef(req.params['deviceRef']);
  const filename = req.params['filename'];
  const buffer: Buffer = req.body as Buffer;
  const content = new Uint8Array(buffer);

  await lastValueFrom(client!.request.setFile(deviceRef, filename, content, true, 30000));

  res.send();
}));

app.delete('/api/devices/:deviceRef/files/:filename', asyncHandler(async (req: Request, res: Response) => {
  const deviceRef = ensureDeviceRef(req.params['deviceRef']);
  const filename = req.params['filename'];

  await lastValueFrom(client!.request.deleteFile(deviceRef, filename));

  res.send();
}));

app.get('/api/devices/:deviceRef/quick-stop', asyncHandler(async (req: Request, res: Response) => {
  const deviceRef = ensureDeviceRef(req.params['deviceRef']);

  await client!.request.quickStop(deviceRef);

  res.send();
}));

app.get('/api/devices/:deviceRef/reset-fault', asyncHandler(async (req: Request, res: Response) => {
  const deviceRef = ensureDeviceRef(req.params['deviceRef']);

  await client!.request.resetFault(deviceRef);

  res.send();
}));

app.post('/api/devices/:deviceRef/start-firmware-installation', asyncHandler(async (req: Request, res: Response) => {
  const deviceRef = ensureDeviceRef(req.params['deviceRef']);
  const deviceRefObj = makeDeviceRefObj(deviceRef);
  const buffer: Buffer = req.body as Buffer;
  const firmwarePackageContent = new Uint8Array(buffer);
  const skipSiiInstallation = asBoolean(req.query['skip-sii-installation'] as string);

  const startDeviceFirmwareInstalationRequest = {
    ...deviceRefObj,
    firmwarePackageContent,
    skipSiiInstallation,
  };

  const status = await lastValueFrom(client!.request.startDeviceFirmwareInstallation(startDeviceFirmwareInstalationRequest, 120000));

  if (status.request === 'succeeded') {
    res.send();
  } else {
    res.status(500).send(status.error);
  }
}));

app.get('/api/devices/:deviceRef/log', asyncHandler(async (req: Request, res: Response) => {
  const deviceRef = ensureDeviceRef(req.params['deviceRef']);
  const deviceRefObj = makeDeviceRefObj(deviceRef);

  const status = await lastValueFrom(client!.request.getDeviceLog(deviceRefObj, 10000));

  res.send(status.content);
}));

app.get('/api/devices/:deviceRef/start-cogging-torque-recording', asyncHandler(async (req: Request, res: Response) => {
  const deviceRef = ensureDeviceRef(req.params['deviceRef']);
  const deviceRefObj = makeDeviceRefObj(deviceRef)
  const skipAutoTuning = asBoolean(req.query['skip-auto-tuning'] as string);

  const status = await lastValueFrom(client!.request.startCoggingTorqueRecording({ ...deviceRefObj, skipAutoTuning }, 180000));

  if (status.request === 'succeeded') {
    const value = await lastValueFrom(client!.request.getCoggingTorqueData(deviceRefObj, 10000));
    res.send(value.table?.data ?? []);
  } else {
    res.status(500).send(status.error);
  }
}));

app.get('/api/devices/:deviceRef/cogging-torque-data', asyncHandler(async (req: Request, res: Response) => {
  const deviceRef = ensureDeviceRef(req.params['deviceRef']);
  const deviceRefObj = makeDeviceRefObj(deviceRef)

  const status = await lastValueFrom(client!.request.getCoggingTorqueData(deviceRefObj, 10000));

  res.send(status.table?.data ?? []);
}));

app.get('/api/devices/:deviceRef/start-offset-detection', asyncHandler(async (req: Request, res: Response) => {
  const deviceRef = ensureDeviceRef(req.params['deviceRef']);
  const deviceRefObj = makeDeviceRefObj(deviceRef)

  const status = await lastValueFrom(client!.request.startOffsetDetection(deviceRefObj, 120000));

  if (status.request === 'succeeded') {
    const commutationAngleOffset = await client!.request.upload(deviceRef, 0x2001, 0);
    res.send({ commutationAngleOffset });
  } else {
    res.status(500).send(status.error);
  }
}));

app.get('/api/devices/:deviceRef/start-system-identification', asyncHandler(async (req: Request, res: Response) => {
  const deviceRef = ensureDeviceRef(req.params['deviceRef']);
  const deviceRefObj = makeDeviceRefObj(deviceRef);
  const durationSeconds = parseFloat((req.query['duration-seconds'] ?? '3.0') as string);
  const torqueAmplitude = parseInt((req.query['torque-amplitude'] ?? '300') as string);
  const startFrequency = parseInt((req.query['start-frequency'] ?? '2') as string);
  const endFrequency = parseInt((req.query['end-frequency'] ?? '60') as string);
  const nextGenSysId = asBoolean(req.query['next-gen-sys-id'] as string);

  const props = {
    ...deviceRefObj,
    durationSeconds,
    torqueAmplitude,
    startFrequency,
    endFrequency,
    nextGenSysId,
  };

  const status = await lastValueFrom(client!.request.startSystemIdentification(props, 30000));

  if (status.request === 'succeeded') {
    const plantModelFileContent = await lastValueFrom(client!.request.getDecodedFile(deviceRef, 'plant_model.csv'));
    res.send(plantModelFileContent);
  } else {
    res.status(500).send(status.error);
  }
}));

app.get('/api/devices/:deviceRef/set-modes-of-operation/:modesOfOperation', asyncHandler(async (req: Request, res: Response) => {
  const deviceRef = ensureDeviceRef(req.params['deviceRef']);
  const modesOfOperation = parseInt(req.params['modesOfOperation'] ?? '0') as ModesOfOperation;

  await lastValueFrom(client!.request.setModesOfOperation(deviceRef, modesOfOperation));

  res.send();
}));

app.get('/api/devices/:deviceRef/transition-to-cia402-state/:state', asyncHandler(async (req: Request, res: Response) => {
  const deviceRef = ensureDeviceRef(req.params['deviceRef']);
  const state = req.params['state'] as Cia402State;

  await client!.request.transitionToCia402State(deviceRef, state);

  res.send();
}));

app.get('/api/devices/:deviceRef/cia402-state', asyncHandler(async (req: Request, res: Response) => {
  const deviceRef = ensureDeviceRef(req.params['deviceRef']);

  const state = await lastValueFrom(client!.request.getCia402State(deviceRef));

  res.send({ state });
}));

app.get('/api/devices/:deviceRef/save-config', asyncHandler(async (req: Request, res: Response) => {
  const deviceRef = ensureDeviceRef(req.params['deviceRef']);

  await lastValueFrom(client!.request.saveConfig(deviceRef));

  res.send();
}));

app.put('/api/devices/:deviceRef/load-config', asyncHandler(async (req: Request, res: Response) => {
  const deviceRef = ensureDeviceRef(req.params['deviceRef']);
  const buffer: Buffer = req.body as Buffer;
  const content = new Uint8Array(buffer);

  await lastValueFrom(client!.request.loadConfig(deviceRef, content, { count: 20, delay: 500 }));

  res.send();
}));

app.get('/api/devices/:deviceRef/start-full-auto-tuning/velocity', asyncHandler(async (req: Request, res: Response) => {
  const deviceRef = ensureDeviceRef(req.params['deviceRef']);
  const deviceRefObj = makeDeviceRefObj(deviceRef);
  const type = MotionMasterMessage.Request.StartFullAutoTuning.Type.VELOCITY;

  const props = {
    ...deviceRefObj,
    type,
  };

  const status = await lastValueFrom(client!.request.startFullAutoTuning(props, 60000));

  if (status.request === 'succeeded') {
    const dampingRatio = status.dampingRatio ?? 0;
    const settlingTime = status.settlingTime ?? 0;
    const bandwidth = status.bandwidth ?? 0;

    const pidObj: { [key: string]: number } = {};

    for (let subidx = 1; subidx < 5; subidx++) {
      pidObj[makeParameterId(0x2011, subidx)] = await client!.request.upload(deviceRef, 0x2011, subidx);
    }

    const response = {
      dampingRatio,
      settlingTime,
      bandwidth,
      ...pidObj,
    };

    res.send(response);
  } else {
    res.status(500).send(status.error);
  }
}));

app.get('/api/devices/:deviceRef/start-full-auto-tuning/position/:controllerType', asyncHandler(async (req: Request, res: Response) => {
  const deviceRef = ensureDeviceRef(req.params['deviceRef']);
  const deviceRefObj = makeDeviceRefObj(deviceRef);
  const type = MotionMasterMessage.Request.StartFullAutoTuning.Type.POSITION;

  let controllerType: number;
  if (req.params['controllerType'] === 'PI_P') {
    controllerType = MotionMasterMessage.Request.StartFullAutoTuning.ControllerType.PI_P;
  } else if (req.params['controllerType'] === 'P_PI') {
    controllerType = MotionMasterMessage.Request.StartFullAutoTuning.ControllerType.P_PI;
  } else {
    controllerType = MotionMasterMessage.Request.StartFullAutoTuning.ControllerType.UNSPECIFIED;
  }

  const props = {
    ...deviceRefObj,
    type,
    controllerType,
  };

  const status = await lastValueFrom(client!.request.startFullAutoTuning(props, 60000));

  if (status.request === 'succeeded') {
    const dampingRatio = status.dampingRatio ?? 0;
    const settlingTime = status.settlingTime ?? 0;
    const bandwidth = status.bandwidth ?? 0;

    const pidObj: { [key: string]: number } = {};

    for (let subidx = 1; subidx < 9; subidx++) {
      pidObj[makeParameterId(0x2012, subidx)] = await client!.request.upload(deviceRef, 0x2012, subidx);
    }

    const response = {
      dampingRatio,
      settlingTime,
      bandwidth,
      ...pidObj,
    };

    res.send(response);
  } else {
    res.status(500).send(status.error);
  }
}));

app.get('/api/devices/:deviceRef/stop-full-auto-tuning', asyncHandler(async (req: Request, res: Response) => {
  const deviceRef = ensureDeviceRef(req.params['deviceRef']);
  const deviceRefObj = makeDeviceRefObj(deviceRef);

  const status = await lastValueFrom(client!.request.stopFullAutoTuning(deviceRefObj, 10000));

  if (status.request == 'succeeded') {
    res.send();
  } else {
    res.status(500).send(status.error);
  }
}));

app.get('/api/devices/:deviceRef/set-halt-bit/:value', asyncHandler(async (req: Request, res: Response) => {
  const deviceRef = ensureDeviceRef(req.params['deviceRef']);
  const value = asBoolean(req.params['value']);

  await client!.request.setHaltBit(deviceRef, value);

  res.send();
}));

/**
 * @example curl "http://localhost:63500/api/devices/0/run-torque-profile?target=100&holding-duration=3000&skip-quick-stop=false&target-reach-timeout=5000&slope=50&window=30&window-time=1"
 */
app.get('/api/devices/:deviceRef/run-torque-profile', asyncHandler(async (req: Request, res: Response) => {
  const deviceRef = ensureDeviceRef(req.params['deviceRef']);
  const target = parseInt((req.query['target'] ?? '1000') as string);
  const holdingDuration = parseInt(req.query['holding-duration'] as string) || undefined;
  const skipQuickStop = asBoolean(req.query['skip-quick-stop'] as string);
  const targetReachTimeout = parseInt(req.query['target-reach-timeout'] as string) || undefined;
  const slope = parseInt((req.query['slope'] ?? '50') as string);
  const window = parseInt(req.query['window'] as string) || undefined;
  const windowTime = parseInt(req.query['window-time'] as string) || undefined;

  const dataMonitoring = client!.createDataMonitoring(createDefaultDataMonitoringParameterIds(deviceRef), 1);
  dataMonitoring.start().subscribe();

  try {
    await client!.runTorqueProfile(deviceRef, {
      target,
      holdingDuration,
      skipQuickStop,
      targetReachTimeout,
      slope,
      window,
      windowTime,
    });
    res.send(dataMonitoring.csv);
  } finally {
    dataMonitoring.stop();
  }
}));

/**
 * @example curl "http://localhost:63500/api/devices/0/run-velocity-profile?acceleration=5000&target=1000&deceleration=5000&holding-duration=2000&skip-quick-stop=false&target-reach-timeout=5000&window=10&window-time=1"
 */
app.get('/api/devices/:deviceRef/run-velocity-profile', asyncHandler(async (req: Request, res: Response) => {
  const deviceRef = ensureDeviceRef(req.params['deviceRef']);
  const acceleration = parseInt((req.query['acceleration'] ?? '1000') as string);
  const target = parseInt((req.query['target'] ?? '1000') as string);
  const deceleration = parseInt((req.query['deceleration'] ?? '1000') as string);
  const holdingDuration = parseInt(req.query['holding-duration'] as string) || undefined;
  const skipQuickStop = asBoolean(req.query['skip-quick-stop'] as string);
  const targetReachTimeout = parseInt(req.query['target-reach-timeout'] as string) || undefined;
  const window = parseInt(req.query['window'] as string) || undefined;
  const windowTime = parseInt(req.query['window-time'] as string) || undefined;

  const dataMonitoring = client!.createDataMonitoring(createDefaultDataMonitoringParameterIds(deviceRef), 1);
  dataMonitoring.start().subscribe({ error: () => { } }); // ignore error

  try {
    await client!.runVelocityProfile(deviceRef, {
      acceleration,
      target,
      deceleration,
      holdingDuration,
      skipQuickStop,
      targetReachTimeout,
      window,
      windowTime,
    });
    res.send(dataMonitoring.csv);
  } finally {
    dataMonitoring.stop();
  }
}));

/**
 * @example curl "http://localhost:63500/api/devices/0/run-position-profile?acceleration=5000&target=10000&deceleration=5000&holding-duration=2000&relative=true&skip-quick-stop=false&target-reach-timeout=5000&velocity=2000&window=10&window-time=1"
 */
app.get('/api/devices/:deviceRef/run-position-profile', asyncHandler(async (req: Request, res: Response) => {
  const deviceRef = ensureDeviceRef(req.params['deviceRef']);
  const acceleration = parseInt((req.query['acceleration'] ?? '1000') as string);
  const target = parseInt((req.query['target'] ?? '1000') as string);
  const deceleration = parseInt((req.query['deceleration'] ?? '1000') as string);
  const holdingDuration = parseInt(req.query['holding-duration'] as string) || undefined;
  const relative = asBoolean(req.query['relative'] as string);
  const skipQuickStop = asBoolean(req.query['skip-quick-stop'] as string);
  const targetReachTimeout = parseInt(req.query['target-reach-timeout'] as string) || undefined;
  const velocity = parseInt((req.query['velocity'] ?? '100') as string);
  const window = parseInt(req.query['window'] as string) || undefined;
  const windowTime = parseInt(req.query['window-time'] as string) || undefined;

  const dataMonitoring = client!.createDataMonitoring(createDefaultDataMonitoringParameterIds(deviceRef), 1);
  dataMonitoring.start().subscribe();

  try {
    await client!.runPositionProfile(deviceRef, {
      acceleration,
      target,
      deceleration,
      holdingDuration,
      relative,
      skipQuickStop,
      targetReachTimeout,
      velocity,
      window,
      windowTime,
    });
    res.send(dataMonitoring.csv);
  } finally {
    dataMonitoring.stop();
  }
}));

app.get('/api/devices/:deviceRef/apply-set-point', asyncHandler(async (req: Request, res: Response) => {
  const deviceRef = ensureDeviceRef(req.params['deviceRef']);

  await client!.request.applySetPoint(deviceRef);

  res.send();
}));

app.get('/api/devices/:deviceRef/start-circulo-encoder-narrow-angle-calibration', asyncHandler(async (req: Request, res: Response) => {
  const deviceRef = ensureDeviceRef(req.params['deviceRef']);
  const deviceRefObj = makeDeviceRefObj(deviceRef);
  const encoderOrdinal = parseInt((req.query['encoder-ordinal'] ?? '1') as string);
  const activateHealthMonitoring = asBoolean(req.query['activate-health-monitoring'] as string);

  const status = await lastValueFrom(client!.request.startCirculoEncoderNarrowAngleCalibrationProcedure({ ...deviceRefObj, encoderOrdinal, activateHealthMonitoring }, 120000));

  if (status.request === 'succeeded') {
    res.send();
  } else {
    res.status(500).send(status.error);
  }
}));

app.get('/api/devices/:deviceRef/start-circulo-encoder-configuration', asyncHandler(async (req: Request, res: Response) => {
  const deviceRef = ensureDeviceRef(req.params['deviceRef']);
  const deviceRefObj = makeDeviceRefObj(deviceRef);
  const encoderOrdinal = parseInt((req.query['encoder-ordinal'] ?? '1') as string);
  const batteryModeMaxAcceleration = parseInt((req.query['battery-mode-max-acceleration'] ?? '0') as string);

  const status = await lastValueFrom(client!.request.startCirculoEncoderConfiguration({ ...deviceRefObj, encoderOrdinal, batteryModeMaxAcceleration }, 30000));

  if (status.request === 'succeeded') {
    res.send();
  } else {
    res.status(500).send(status.error);
  }
}));

app.get('/api/devices/:deviceRef/start-integro-encoder-calibration', asyncHandler(async (req: Request, res: Response) => {
  const deviceRef = ensureDeviceRef(req.params['deviceRef']);

  await new IntegroEncoderCalibration(client!, deviceRef).start();
  res.send();
}));

let motionComposerRunner: MotionComposerRunner | null = null;

app.post('/api/motion-composer/run', asyncHandler(async (req: Request, res: Response) => {
  motionComposerRunner = new MotionComposerRunner(client!);
  const motionComposer = req.body as MotionComposer;
  const finalMotionComposer = await lastValueFrom(motionComposerRunner.run(motionComposer));
  motionComposerRunner = null;
  res.send(finalMotionComposer);
}));

app.get('/api/motion-composer/stop', asyncHandler(async (_req: Request, res: Response) => {
  motionComposerRunner?.stop();
  res.send();
}));

app.listen(port, () => {
  log(`API server is now running on port ${port}.`);
});
