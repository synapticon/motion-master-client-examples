import { program } from 'commander';
import { client } from '../init-client';
import { ConfigFile, mapByProperty, resolveSmmOd } from 'motion-master-client';
import { readFileSync } from 'fs';
import { lastValueFrom } from 'rxjs';

program.parse();

const { deviceRef, requestTimeout, username, password } = program.opts();

const smmConfigurationFilePath = 'src/fp/config.smm.csv';
const smmConfigurationFileContent = readFileSync(smmConfigurationFilePath, 'utf-8');

client.whenReady().then(async () => {
  const configFile = new ConfigFile(smmConfigurationFileContent);
  const values = configFile.parameters.map(p => String(p.value).trim());

  await lastValueFrom(client.request.logoutFromSmm(deviceRef));
  await lastValueFrom(client.request.loginToSmmForParameterDownload(deviceRef, username, password, requestTimeout));

  const parameterStructureVersion = await lastValueFrom(client.request.resolveSmmParameterStructureVersion(deviceRef));
  const smmOd = resolveSmmOd(parameterStructureVersion);
  const smmOdGroupedParametersMap = mapByProperty(smmOd.parameters.safety, 'group');

  const groupedValues = Array.from(smmOdGroupedParametersMap.values()).map(group =>
    group.map(param => {
      const p = configFile.parameters.find(p => p.index === param.index && p.subindex === param.subindex);
      return p ? String(p.value).trim() : '';
    })
  );

  const isTransmitted = await lastValueFrom(client.request.transmitSmmParameters(deviceRef, values, parameterStructureVersion));
  console.log(isTransmitted);

  const loadRes = await lastValueFrom(client.request.loadSmmParametersForVerification(deviceRef));
  console.log(loadRes.values === values ? 'Transmitted and loaded values are equal' : 'Transmitted and loaded values are NOT equal');

  for (let i = 1; i < groupedValues.length; i++) {
    const parsedGroup = groupedValues[i].map(value =>
      value !== '' && Number.isInteger(Number(value)) ? parseInt(value, 10) : value
    );
    const res = await lastValueFrom(client.request.verifySmmParameters(deviceRef, parsedGroup, i));
    console.log(`Group ${i} result: ${res}`);
  }

  await lastValueFrom(client.request.loadSmmValidationFile(deviceRef));

  const report = await lastValueFrom(client.request.getFile(deviceRef, '.safety_parameters_report'));
  if (report) {
    const buffer = new Uint8Array(Array.isArray(report) ? report : report);
    const ok = await lastValueFrom(client.request.validateSmmConfiguration(deviceRef, buffer, new Date(), username, password));
    console.log(ok ? 'Validation completed successfully' : 'Validation failed');
  }
}).finally(() => client.closeSockets());  
