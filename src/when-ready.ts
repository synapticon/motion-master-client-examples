import { createMotionMasterClient, MotionMasterConnectionConfig } from "motion-master-client";
Object.assign(globalThis, { WebSocket: require("ws") });

const invalidConnectionConfig: MotionMasterConnectionConfig = {
  clientId: "invalid-client",
  hostname: "localhost", // Invalid IP
  pingSystemInterval: 5000,
  pubSubPort: 12345,
  reqResPort: 54321,
  systemAliveTimeout: 5000,
  clientAliveTimeout: 5000,
  remember: false,
  secure: false,
};

(async () => {
  const invalidClient = createMotionMasterClient(invalidConnectionConfig);

  invalidClient
    .whenReady()
    .then(() => {
      console.log("Invalid client is ready");
    })
    .catch((error) => {
      console.error("Failed to connect invalid client:", error.message);
    });
})();
