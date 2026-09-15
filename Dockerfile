# Client-side examples for talking to a Motion Master over WebSockets.
#
# Nothing EtherCAT happens in here: this image is only the client. Motion Master
# itself runs on a host that owns the NIC, and the container reaches it over the
# network, so MOTION_MASTER_HOSTNAME must point at that host and never at
# "localhost" — inside a container that is the container itself. From Docker
# Desktop or OrbStack on macOS, use host.docker.internal to reach a master
# running on the Mac.
#
# Build:
#   docker build -t mmce .
#
# Run a script (compiled JavaScript):
#   docker run --rm -e MOTION_MASTER_HOSTNAME=host.docker.internal mmce \
#     node dist/request/get-devices.promise.js
#
# Run a script straight from TypeScript:
#   docker run --rm -e MOTION_MASTER_HOSTNAME=host.docker.internal mmce \
#     npx ts-node src/request/get-devices.promise.ts
#
# Iterate on the sources without rebuilding, keeping the container's own
# node_modules (an anonymous volume shadows the bind mount at that path):
#   docker run --rm -it -v "$PWD":/usr/src/app -v /usr/src/app/node_modules \
#     -e MOTION_MASTER_HOSTNAME=host.docker.internal mmce sh

FROM node:iron-alpine

WORKDIR /usr/src/app

# Dependencies first, so a source-only change does not reinstall them.
COPY package*.json ./
RUN npm install

# Sources have to be present before the TypeScript build: tsconfig.json sets
# rootDir to ./src, and running the build with only package.json copied fails
# with "no inputs were found in config file".
COPY . .
RUN npm run build

# No CMD on purpose: every example is its own entry point, so the script to run
# is given on the command line. Land in a shell if none is.
CMD ["sh"]
