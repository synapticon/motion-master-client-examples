# Gearbox backlash measurement — setup & run guide

This guide explains what you need **physically** and **in software** to run
`src/start-gearbox-backlash-measurement.ts`, and how to read its output.

The script drives the motor through a slow triangular (zig-zag) position profile
that walks all the way around the output shaft, reversing direction every ~30°.
At each reversal it measures the gearbox backlash from the two encoders using:

```
backlash = d_motor_position / GR − d_output_shaft_position
```

where `GR` (the effective gear ratio in encoder counts) is **computed from the
data**, not taken from a nameplate. You get a backlash-vs-angle map across the
full revolution.

> ⚠️ **Safety first.** This script *enables the drive and spins the motor*.
> Before you run it: make sure the actuator can rotate freely through the whole
> range, nobody is near moving parts, and an emergency stop is within reach.
> Start with a small range and low speed. `Ctrl-C` triggers a quick stop.

---

## 1. What you need physically

| Item | Notes |
|------|-------|
| A SOMANET servo drive | e.g. SOMANET Node, or a Circulo with an integrated encoder. Firmware/software **5.x**. |
| A motor **with a gearbox** | The thing whose backlash you want to measure. |
| **Two encoders spanning the gearbox** | **Internal** encoder on the **motor** shaft, **external** encoder on the **output** shaft. This is mandatory — backlash is the difference between the two, so you cannot measure it with one encoder. This matches your setup (internal = motor position, external = shaft position). |
| EtherCAT wiring | Drive connected to the PC that runs Motion Master over EtherCAT. |
| A safe mechanical range | The output shaft must be free to turn through the full `SWEEP_TOTAL_DEG` (360° by default). Remove end stops / loads that would block a full turn, or reduce the range. |
| Power supply + E-stop | Standard drive bring-up. |

## 2. What you need in software

1. **OBLAC Drives** installed and connected to the drive. OBLAC Drives is
   Synapticon's browser-based commissioning tool; it includes/runs the
   **Motion Master** server that this script connects to. Download it from the
   [Synapticon downloads / docs](https://doc.synapticon.com/).
2. **Node.js and npm.** Check with `node -v` and `npm -v`. If missing, install
   Node.js LTS from <https://nodejs.org> (npm ships with it).
3. **This repository**, with dependencies installed:
   ```console
   git clone https://github.com/synapticon/motion-master-client-examples.git
   cd motion-master-client-examples
   npm install
   ```
   The `motion-master-client` library has already been updated to the latest
   version (**0.0.418**) in this repo's `package.json`.
4. **Point the script at your Motion Master.** Create a `.env` file in the repo
   root with the IP of the machine running Motion Master:
   ```sh
   MOTION_MASTER_HOSTNAME=192.168.1.112
   ```

## 3. Prepare the drive (in OBLAC Drives)

Do this once, before running the script:

1. **Commission the motor** normally (motor + both encoders detected, offset
   detection / commutation done, drive can be enabled without a fault).
2. **Configure the two encoders for dual-loop control:**
   - Motor-shaft (internal) encoder → **Commutation** and **Velocity**.
   - Output-shaft (external) encoder → **Position**.
   See Synapticon's guide:
   [Dual Loop Cascaded Position Control](https://doc.synapticon.com/circulo/sw5.0/motion_control/control_loops/dual_loop_cascaded_position_control.html).
3. **Set the gear ratio** in object **`0x6091`** (`:1` motor revolutions, `:2`
   shaft revolutions). The script reads this back as a cross-check.
4. **Confirm it moves:** command a small move in Profile Position Mode from
   OBLAC Drives and check both encoders respond and there is no fault.

## 4. Check the object-dictionary values the script uses

The script assumes the standard SOMANET 5.x dual-loop mapping. Confirm these for
your drive (in OBLAC Drives, or with the `upload.ts` example — e.g.
`npx ts-node ./src/request/upload.ts --device-ref=0 0x6064 0x00`):

| Object | Meaning | Used for |
|--------|---------|----------|
| `0x6064:00` | Position actual value | **Output / external** encoder position |
| `0x230A:00` | Secondary position value | **Motor / internal** encoder position |
| `0x6091:01/02` | Gear ratio (motor rev : shaft rev) | Cross-check only |
| `0x2110:03`, `0x2112:03` | Encoder 1 / 2 resolution (counts/rev) | Set the `*_COUNTS_PER_REV` constants |

If your drive maps the encoders the other way round (motor on `0x6064`, output
on `0x230A`), just swap `MOTOR_POSITION_OBJECT` and `OUTPUT_POSITION_OBJECT` at
the top of the script. The start-up diagnostics make a swap obvious — in a
reduction gearbox the **motor encoder always travels far more** than the output
encoder, and the printed effective gear ratio should be roughly your mechanical
ratio.

## 5. Configure the script

Open `src/start-gearbox-backlash-measurement.ts` and review the `CONFIGURATION`
block near the top:

| Constant | What to set it to |
|----------|-------------------|
| `--device-ref` (CLI) | The EtherCAT position of your drive. `0` = first device. |
| `OUTPUT_COUNTS_PER_REV` | Counts per rev of the **output** encoder (from `0x2110:03`/`0x2112:03`; commonly 524288 = 2¹⁹). **Important** — it sets the commanded range and the degree conversion. |
| `MOTOR_COUNTS_PER_REV` | Counts per rev of the **motor** encoder. Only matters if that encoder is single-turn. |
| `SWEEP_TOTAL_DEG` | Output angle to cover (default 360). **Start smaller (e.g. 90) for the first run.** |
| `SWEEP_STEP_DEG` | Reversal spacing — backlash is measured every this many degrees (default 30). |
| `SWEEP_VELOCITY_DEG_S` | Output speed during the ramps (default 20). Slower = cleaner reading. |
| `SWEEP_ACCEL_DEG_S2` | Accel/decel for crisp reversals (default 200). |
| `REVERSAL_DWELL_MS` | Pause at each reversal (default 250). |
| `MONITORING_INTERVAL_US` | Sampling period in microseconds (default 5000 = 200 Hz). |

## 6. Run it

```console
npx ts-node ./src/start-gearbox-backlash-measurement.ts --device-ref=0
```

What happens:

1. Prints **diagnostics** (gear ratio, encoder resolutions, start position) —
   check these look right before the motor moves.
2. Enables the drive and runs the zig-zag sweep (a progress line shows each move).
3. Records both encoders + the device timestamp the whole time.
4. Stops, analyses, prints a results summary, and writes two CSV files in the
   current directory:
   - `backlash-samples-<timestamp>.csv` — every raw sample (for your own plots).
   - `backlash-results-<timestamp>.csv` — one row per reversal: angle, direction,
     backlash in degrees / arcmin / counts. Easy to chart backlash vs angle.

Press **Ctrl-C** at any time to quick-stop and exit.

## 7. Reading the results

- **Effective gear ratio (counts)** — motor counts per output count.
- **Implied mechanical gear ratio** — the above scaled by the encoder
  resolutions; should match your `0x6091` value (printed alongside as a check).
- **Per-reversal table** — backlash at each angle, from each engagement
  direction (`positive` = was moving forward before the reversal).
- **Binned summary** — mean/min/max backlash per angular bin across the circle,
  so you can see whether backlash varies with position (eccentricity, tooth
  variation).

## 8. Troubleshooting

| Symptom | Likely cause / fix |
|---------|--------------------|
| "No clean reversals were detected" | Increase `REVERSAL_DWELL_MS`, lower `SWEEP_VELOCITY_DEG_S`, increase `SWEEP_STEP_DEG`, or lower `MONITORING_INTERVAL_US` for more samples. Confirm the motor actually moved. |
| Effective gear ratio ≈ 1, or output travels more than motor | The two encoder objects are probably swapped — exchange `MOTOR_POSITION_OBJECT` and `OUTPUT_POSITION_OBJECT`. |
| Backlash values look 360°-ish or jump wildly | Wrong `*_COUNTS_PER_REV`, or a wrap not being unwrapped — set the resolutions from `0x2110:03`/`0x2112:03`. |
| Drive faults on enable | Commission/enable it in OBLAC Drives first; clear faults; confirm it runs in Profile Position Mode there. |
| "MOTION_MASTER_HOSTNAME … is not defined" | Create the `.env` file (section 2, step 4). |

## References

- [Dual Loop Cascaded Position Control — Synapticon](https://doc.synapticon.com/circulo/sw5.0/motion_control/control_loops/dual_loop_cascaded_position_control.html)
- [Dual-loop position control with two encoders explained — Synapticon](https://www.synapticon.com/en/motion-control-academy/dual-loop-positionsregelung)
- [0x6064 Position actual value — Synapticon](https://doc.synapticon.com/node/sw5.4/objects_html/6xxx/6064.html)
- [0x6091 Gear ratio — Synapticon](https://doc.synapticon.com/node/sw5.4/objects_html/6xxx/6091.html)
- [SOMANET Object Dictionary (all objects) — Synapticon](https://doc.synapticon.com/node/sw5.4/object_dict/all_objects.html)
