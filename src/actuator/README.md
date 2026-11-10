# Actuator commissioning and endurance run

Two routines for building actuators on SOMANET Circulo drives. Each one is here twice: with the client
library (TypeScript) and with the [HTTP API](https://synapticon.github.io/oblac/motion-master-api/) (Python 3.10+,
no dependencies).

| Routine | Client library | HTTP API |
|---|---|---|
| Commission one actuator | `commission-circulo.ts` | `http/commission_circulo.py` |
| Run it back and forth for 48 hours, logging following error and torque | `endurance-position-profile.ts` | `http/endurance_position_profile.py` |

## Commissioning

1. Load a configuration file (`config.csv`), replacing the one on the drive (`--merge` merges it instead).
2. Run offset detection: open phase detection, phase resistance and inductance, pole pairs, motor phase order,
   commutation offset.
3. Calibrate the integrated encoders given with `--encoders` (default `1`), one after another.
4. Measure the commutation offset again, since the calibration changes the position the encoder reports.
5. Save the configuration on the drive.

Export the configuration file with OBLAC Drives from an actuator of the same build that was commissioned by hand.
The encoder calibration turns the motor in velocity mode, so the file needs tuned velocity controller gains
(OBLAC Drives asks for a bandwidth below 30 Hz). The motor turns in steps 2 to 4: the actuator has to be free to move.

```console
npx ts-node src/actuator/commission-circulo.ts --device-ref=0 --encoders=1,2 config.csv
python3 src/actuator/http/commission_circulo.py --device-ref 0 --encoders 1,2 config.csv
```

## Endurance run

The actuator moves between its start position and the start position plus `--distance`, waits `--dwell` ms at
each end, and stays enabled for `--hours` (default 48). Both targets are absolute, so it does not drift. Every move
adds one line to the summary CSV: the largest following error (0x60F4), the largest and the RMS torque (0x6077).
`--samples` also writes every sample. That file grows by about 170 million lines in 48 hours at 1 ms, so with the
client library raise `--interval` (in microseconds) for it.

Ctrl-C stops the run. When a move fails (a fault, or the target not reached within `--move-timeout`), the script
quick stops the drive, prints the error report (0x203F:01) and exits with code 1.

```console
npx ts-node src/actuator/endurance-position-profile.ts --device-ref=0 --distance=100000 --velocity=1000
python3 src/actuator/http/endurance_position_profile.py --device-ref 0 --distance 100000 --velocity 1000
```

Units are the drive's: positions and the following error in position units, the torque in per mille of the rated
torque, velocity and acceleration as 0x6081 and 0x6083 take them.

## Before you start

- Motion Master runs on the machine connected to the drives. The client library scripts reach it through
  `MOTION_MASTER_HOSTNAME`, see the main README.
- The Python scripts talk to the HTTP API on `http://localhost:63526/api` (change with `--api`). The OBLAC Drives
  native app starts it on that port. Start Motion Master in OBLAC Drives before running a script.
- Run one script per actuator. `--device-ref` takes the position in the chain, the address or the serial number.

## Differences between the two

- The HTTP API does not pass on the warnings Motion Master sends during calibration, for example that the
  absolute position changed and homing and the software position limits have to be checked. The client library
  script prints them.
- Over HTTP, the samples of the endurance run come from the drive's PDO mapping, recorded every millisecond during
  each move. If 0x60F4 or 0x6077 is not mapped, the script stops and says so.
