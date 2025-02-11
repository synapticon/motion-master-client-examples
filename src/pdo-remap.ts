import { program } from 'commander';
import { client } from './init-client';
import { lastValueFrom } from 'rxjs';
import { DeviceParameterAddressValue, EthercatNetworkState, makeDeviceRefObj } from 'motion-master-client';

program.parse();

const { deviceRef } = program.opts();

const rxGroupedValues = [
  [
    0x7,
    0x60400010,
    0x60600008,
    0x60710010,
    0x607a0020,
    0x60ff0020,
    0x60b20010,
    0x27010020,
    0x0,
    0x0,
    0x0
  ],
  [
    0x2,
    0x60fe0120,
    0x60fe0220,
    0x0,
    0x0,
    0x0,
    0x0,
    0x0,
    0x0,
    0x0,
    0x0
  ],
  [
    0x2,
    0x27030020,
    0x60b10020,
    0x0,
    0x0,
    0x0,
    0x0,
    0x0,
    0x0,
    0x0,
    0x0
  ],
  [
    0x0,
    0x0,
    0x0,
    0x0,
    0x0,
    0x0,
    0x0,
    0x0,
    0x0,
    0x0,
    0x0
  ]
];

const txGroupedValues = [
  [
    0x7,
    0x60410010,
    0x60610008,
    0x60640020,
    0x606c0020,
    0x60770010,
    0x60f40020,
    0x21110120,
    0x0,
    0x0,
    0x0
  ],
  [
    0x5,
    0x24010010,
    0x24020010,
    0x24030010,
    0x24040010,
    0x27020020,
    0x0,
    0x0,
    0x0,
    0x0,
    0x0
  ],
  [
    0x1,
    0x60fd0020,
    0x0,
    0x0,
    0x0,
    0x0,
    0x0,
    0x0,
    0x0,
    0x0,
    0x0
  ],
  [
    0x5,
    0x27040020,
    0x20f00020,
    0x60fc0020,
    0x606b0020,
    0x60740010,
    0x0,
    0x0,
    0x0,
    0x0,
    0x0
  ]
];

client.whenReady().then(async () => {
  const deviceRefObj = makeDeviceRefObj(deviceRef);
  try {
    await lastValueFrom(client.request.setEthercatNetworkState({ ...deviceRefObj, state: EthercatNetworkState.PREOP }, 30000));
    await client.request.download(deviceRef, 0x1C12, 0x00, 0x00);
    await client.request.download(deviceRef, 0x1C13, 0x00, 0x00);
    await updatePdoParameterGroupedValues(deviceRef, rxGroupedValues, 0x1600);
    await updatePdoParameterGroupedValues(deviceRef, txGroupedValues, 0x1A00);
    await client.request.download(deviceRef, 0x1C12, 0x00, 0x03);
    await client.request.download(deviceRef, 0x1C13, 0x00, 0x04);
    await lastValueFrom(client.request.setEthercatNetworkState({ ...deviceRefObj, state: EthercatNetworkState.OP }, 30000));
    console.log('PDO Mapping has been successfully applied.');
  } catch (err) {
    if (err instanceof Error) {
      console.error('Failed to apply PDO mapping: ', err.message);
    }
  }
}).finally(() => client.closeSockets());

async function updatePdoParameterGroupedValues(deviceRef: number, pdoGroupedValues: number[][], pdoIndex: 0x1600 | 0x1A00): Promise<void> {
  const promises = pdoGroupedValues.map(async (groupedValues, i) => {
    let values = groupedValues.slice(1)
      .filter((value) => value !== 0)
      .map((value) => typeof value === 'string' ? parseInt(value, 10) : value);
    const n = values.length; // number of new mapped parameters
    values = values.concat(new Array(10 - n).fill(0));

    await lastValueFrom(client.request.setParameterValues([[deviceRef, pdoIndex + i, 0, 0]]));

    const parameterValues = values.reduce((acc, value, j) => {
      acc.push([deviceRef, pdoIndex + i, j + 1, value, 'uintValue']);
      return acc;
    }, [] as DeviceParameterAddressValue[]);

    await lastValueFrom(client.request.setParameterValues(parameterValues));
    await lastValueFrom(client.request.setParameterValues([[deviceRef, pdoIndex + i, 0, n]]));
  });

  for (const promise of promises) {
    await promise;
  }
}
