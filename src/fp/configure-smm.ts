import { program } from 'commander';
import { client } from '../init-client';
import { ConfigFile } from 'motion-master-client';
import { readFileSync } from 'fs';
import { lastValueFrom } from 'rxjs';

program.parse();

const { deviceRef, requestTimeout, username, password } = program.opts();

const smmConfigurationFilePath = 'src/fp/config.smm.csv';
const smmConfigurationFileContent = readFileSync(smmConfigurationFilePath, 'utf-8');

client.whenReady().then(async () => {
  const configFile = new ConfigFile(smmConfigurationFileContent);
  const values: any[] = [];
  configFile.parameters.forEach((parameter) => {
    values.push(parameter.value);
  });
  console.log(values);
  await lastValueFrom(client.request.logoutFromSmm(deviceRef));
  await lastValueFrom(client.request.loginToSmmForParameterDownload(deviceRef, username, password, requestTimeout));
  const parameterStructureVersion = await lastValueFrom(client.request.resolveSmmParameterStructureVersion(deviceRef));
  console.log(parameterStructureVersion);
  await lastValueFrom(client.request.transmitSmmParameters(deviceRef, values, parameterStructureVersion));
  const smmParameters = await lastValueFrom(client.request.getSmmOdGroupedParameters(deviceRef, parameterStructureVersion));
  console.log(smmParameters);
  const smmParameterValues = await lastValueFrom(client.request.loadSmmParametersForVerification(deviceRef));
  // await lastValueFrom(client.request.verifySmmParameters(deviceRef, smmParameterValues, ));

}).finally(() => client.closeSockets());  
