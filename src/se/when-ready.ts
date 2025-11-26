import { createMotionMasterClient, MotionMasterConnectionConfig } from "motion-master-client";

const invalidConnectionConfig: MotionMasterConnectionConfig = {
  clientAliveTimeout: 5000,
  clientId: "invalid-connection-config",
  hostname: "localhost",
  pingSystemInterval: 2000,
  pubSubPort: 54321,
  remember: false,
  reqResPort: 12345,
  secure: false,
  systemAliveTimeout: 5000,
};

const validConnectionConfig: MotionMasterConnectionConfig = {
  clientAliveTimeout: 5000,
  clientId: "valid-connection-config",
  hostname: "localhost",
  pingSystemInterval: 2000,
  pubSubPort: 63525,
  remember: false,
  reqResPort: 63524,
  secure: false,
  systemAliveTimeout: 5000,
};

(async () => {
  const clientInvalid = createMotionMasterClient(invalidConnectionConfig);

  try {
    await clientInvalid.whenReady();
  } catch (err) {
    if (err instanceof Error) {
      console.error("Error while waiting for client to be ready:", err.message);
    }
  } finally {
    clientInvalid.closeSockets();
  }

  const validClient = createMotionMasterClient(validConnectionConfig);
  try {
    await validClient.whenReady();
    console.log("Client is ready!");
  } catch (err) {
    if (err instanceof Error) {
      console.error("Error while waiting for client to be ready:", err.message);
    }
  } finally {
    validClient.closeSockets();
  }
})();
