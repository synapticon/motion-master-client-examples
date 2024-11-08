import { program, Option } from 'commander';
import { EthernetDevice, ParameterValueType, resolveAfter } from 'motion-master-client';

program
  .addOption(
    new Option('-b, --base-url <value>', 'specify the base URL (e.g., http://192.168.0.100:8080)')
      .default('http://192.168.0.100:8080', 'the default base URL, representing a single Ethernet device'),
  );

program.parse();

const { baseUrl } = program.opts();

const ethernetDevice = new EthernetDevice(baseUrl);

(async () => {
  const parameters = await ethernetDevice.getParameters();
  console.log(parameters);

  const statusword = await ethernetDevice.upload(0x6041, 0);
  console.log(`statusword=${statusword}`);

  let polePairs: ParameterValueType = 17;
  console.log(`setting polePairs to ${polePairs}`);
  await ethernetDevice.download(0x2003, 1, polePairs);
  await resolveAfter(1000);
  polePairs = await ethernetDevice.upload(0x2003, 1);
  console.log(`polePairs=${polePairs}`);

  const pdoValues = await ethernetDevice.receivePdoValues();
  console.log(`pdoValues=${pdoValues}`);

  const state = await ethernetDevice.getState();
  console.log(`state=${state}`);

  await ethernetDevice.reset();
})();
