// Node 18+; no external dependencies required
import fs from 'fs';
import { Device } from 'motion-master-client';

// This example demonstrates how to install firmware on two devices in parallel using the HTTP API of Motion Master Client.
// Make sure Motion Master Client is running with HTTP API enabled before executing this script.
// This script uses the firmware packages of the devices currently connected to the setup, so enumerate the devices, and make sure to use the correct firmware package files for each device, and make sure the device position is correct.

// Adjust the API base URL if needed - most likely, the host name will be same, but the port might differ (63526 is the default)
const API_BASE = 'http://localhost:63526/api';

// Map devices to firmware paths, these are used just as an example
const firmwareMap: Record<string | number, string> = {
  1: 'src/internal/package_SOMANET-Node_9501-01_motion-drive_v5.6.2.zip',
  2: 'src/internal/package_SOMANET-Circulo-7_8504-03_motion-drive_v5.6.2.zip',
};

async function main() {
  try {
    // 0. Connect to the API
    console.log('Connecting to the API...');
    const connectRes = await fetch(`${API_BASE}/connect`);
    if (connectRes.status === 409) {
      console.log('Already connected (409), continuing...');
    } else if (!connectRes.ok) {
      const text = await connectRes.text();
      throw new Error(`Connect failed: ${connectRes.status} - ${text}`);
    } else {
      console.log('Connected successfully');
    }

    // 1. Fetch all devices
    const devicesRes = await fetch(`${API_BASE}/devices`);
    const devices = await devicesRes.json();
    console.log(`Found ${devices.length} devices`);

    // 2. Start firmware installation in parallel
    const requests = devices.map(async (device: Device) => {
      const firmwarePath = firmwareMap[device.position ?? 0];
      if (!firmwarePath) {
        return { device: device, status: 'skipped', message: 'No firmware mapped' };
      }

      const firmwareBuffer = fs.readFileSync(firmwarePath);

      // Tweak the URL parameters as needed.
      // In this example, we skip the SII installation, and are skipping the writing of the stack image and the ESI file.
      const url = `${API_BASE}/devices/${device.position}/start-firmware-installation?skip-sii-installation=true&skip-files=SOMANET_CiA_402.xml.zip&skip-files=stack_image.svg.zip&request-timeout=120000`;
      try {
        const res = await fetch(url, {
          method: 'POST',
          body: new Uint8Array(firmwareBuffer),
          headers: { 'Content-Type': 'application/octet-stream' },
        });

        if (!res.ok) {
          const text = await res.text();
          throw new Error(`${res.status} - ${text}`);
        }

        return { device: device.position, status: 'ok' };
      } catch (err) {
        return { device: device.position, status: 'error', message: err instanceof Error ? err.message : String(err) };
      }
    });

    // 3. Wait for all results
    const results = await Promise.all(requests);

    results.forEach(r => {
      if (r.status === 'ok') console.log(`${r.device}: ${r.status}`);
      else console.error(`${r.device}: ${r.status} - ${r.message}`);
    });

  } catch (err) {
    if (err instanceof Error) {
      console.error('Fatal error:', err.message);
    }
  }
}

main();
