# Actuator commissioning and endurance run

Two routines for building actuators on SOMANET Circulo drives. Each one is here twice: with the client
library (TypeScript) and with the [HTTP API](https://synapticon.github.io/oblac/motion-master-api/) (Python 3.10+,
no dependencies).

| Routine | Client library | HTTP API |
|---|---|---|
| Commission one actuator | `commission-circulo.ts` | `commission-circulo.py` |
| Run it back and forth for 48 hours, logging following error and torque | `endurance-position-profile.ts` | `endurance-position-profile.py` |

## Commissioning

1. Load a configuration file (`config.csv`), replacing the one on the drive (`--merge` merges it instead).
2. Run offset detection: open phase detection, phase resistance and inductance, pole pairs, motor phase order,
   commutation offset.
3. Calibrate an integrated encoder.
4. Measure the commutation offset again. Motion Master does that itself only when the software position limits
   leave enough room, and otherwise only warns, which the HTTP API does not pass on.
5. Save the configuration on the drive.

Steps 3 and 4 run for every encoder given with `--encoders`, in that order. The option is required: `1` for one
integrated encoder, `1,2` for two.

Export the configuration file with OBLAC Drives from an actuator of the same build that was commissioned by hand.
The encoder calibration turns the motor in velocity mode, so the file needs tuned velocity controller gains
(OBLAC Drives asks for a bandwidth below 30 Hz). The file also carries the home offset and the software position
limits of the actuator it was exported from. The motor turns in steps 2 to 4: the actuator has to be free to move.

Ctrl-C stops the drive (the Python script with a quick stop), which ends a calibration or offset detection, and the
script exits with code 1.

```console
npx ts-node src/actuator/commission-circulo.ts --device-ref=0 --encoders=1,2 config.csv
python3 src/actuator/commission-circulo.py --device-ref 0 --encoders 1,2 config.csv
```

## Endurance run

The actuator moves between its start position and the start position plus `--distance`, waits `--dwell` ms at
each end, and stays enabled for `--hours` (default 48). Both targets are absolute, so it does not drift.
`--distance`, `--velocity` and `--acceleration` are required, because what a value means depends on how the
actuator is configured.

Every move adds one line to the summary CSV: the largest following error (0x60F4), the largest and the RMS torque
(0x6077), from a sample every millisecond. `duration_ms` and the RMS torque cover the whole move: the parameter
writes before it, the motion and the dwell at its end. Over HTTP, `duration_ms` also includes the read of the
drive's UI configuration that the HTTP API does before every move. `--samples` also writes every sample. That file
grows by about 170 million lines in 48 hours.

Before every move but the first, the script checks that the drive is still in Operation Enabled. If something else
stopped it (Stop in OBLAC Drives, another client, a fault), the run ends instead of enabling the drive again. The
run also ends when a move fails (a fault, or the target not reached within `--move-timeout`) or brings no samples.
The script then quick stops the drive, prints the last error report (0x203F:01) and exits with code 1. Without a
fault, that report can be an older one.

Ctrl-C ends the run after the current move and quick stops the drive. With the client library, Ctrl-C again quick
stops the drive at once and quits. The Python script has no such shortcut: the HTTP API finishes a move it has
started even when the script is gone, and enables the drive for it, so the script waits for the move to end.

```console
npx ts-node src/actuator/endurance-position-profile.ts --device-ref=0 --distance=100000 --velocity=1000 --acceleration=10000
python3 src/actuator/endurance-position-profile.py --device-ref 0 --distance 100000 --velocity 1000 --acceleration 10000
```

Units are the drive's: positions and the following error in position units, the torque in per mille of the rated
torque, velocity and acceleration as 0x6081 and 0x6083 take them.

## Before you start

- Motion Master runs on the machine connected to the drives. The client library scripts reach it through
  `MOTION_MASTER_HOSTNAME`, see the main README.
- The Python scripts talk to the HTTP API on `http://localhost:63526/api` (change with `--api`). The OBLAC Drives
  native app starts it on that port. Start Motion Master in OBLAC Drives before running a script.
- The Python scripts need HTTP API 0.0.418 or newer. `GET /api/version` shows the version, for example
  `curl http://localhost:63526/api/version`.
- Each script drives one drive. Run one per actuator, in parallel if needed. `--device-ref` takes the position in
  the chain, the address or the serial number.

## Differences between the two

- The HTTP API does not pass on the warnings Motion Master sends during calibration, for example that the
  absolute position changed and homing and the software position limits have to be checked. The client library
  script prints them.
- Over HTTP, the samples of the endurance run come from the drive's PDO mapping, recorded every millisecond during
  each move. If 0x60F4 or 0x6077 is not mapped, the script stops and says so.
