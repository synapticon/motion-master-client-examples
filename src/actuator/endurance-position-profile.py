#!/usr/bin/env python3
# Python 3.10+; no external dependencies required
"""
Runs an actuator back and forth in Profile Position Mode through the Motion Master HTTP API for a given time
(48 hours by default) and logs the following error and the torque of every move.

The actuator moves between its position at the start and that position plus --distance, waiting --dwell
milliseconds at each end. The drive stays in Operation Enabled for the whole run. Both targets are absolute,
so the actuator does not drift away over thousands of moves.

Every move is one call to run-position-profile, which answers with the samples Motion Master recorded during
the move, every millisecond, as CSV. The script writes one line per move to the summary file (largest following
error, largest and RMS torque), and the samples themselves to --samples only when that option is given. That
file grows by about 170 million lines in 48 hours.

Units are the drive's: the following error in position units (increments unless 0x60A8 says otherwise),
the torque in per mille of the rated torque, velocity and acceleration as 0x6081 and 0x6083 take them.

Ctrl-C ends the run. If a move fails, the drive faults or the target is not reached in time, the script quick
stops the drive, prints the error report and exits with code 1.

The HTTP API has to be running (OBLAC Drives starts it on port 63526) and Motion Master has to be started.

Usage:
  python3 src/actuator/endurance-position-profile.py --device-ref 0 --distance 100000 --velocity 1000
  python3 src/actuator/endurance-position-profile.py --device-ref 0 --hours 0.1 --samples samples.csv
"""
import argparse
import csv
import io
import json
import math
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone

FOLLOWING_ERROR = "0x60F4:00"
TORQUE_ACTUAL = "0x6077:00"
POSITION_ACTUAL = "0x6064:00"
TIMESTAMP = "0x20F0:00"


class ApiError(Exception):
    def __init__(self, message: str, status: int | None = None):
        super().__init__(message)
        self.status = status


class Api:
    def __init__(self, base_url: str):
        self.base_url = base_url.rstrip("/")

    def get(self, path: str, params: dict | None = None, timeout: float = 60):
        url = f"{self.base_url}{path}"
        if params:
            url += "?" + urllib.parse.urlencode(params)
        try:
            with urllib.request.urlopen(url, timeout=timeout) as res:
                text = res.read().decode("utf-8")
                content_type = res.headers.get_content_type()
        except urllib.error.HTTPError as e:
            detail = e.read().decode("utf-8", errors="replace")
            raise ApiError(f"GET {path} returned {e.code}: {detail}", e.code) from None
        if content_type == "application/json" and text:
            return json.loads(text)
        return text

    def connect(self, motion_master_host: str):
        try:
            self.get(f"/connect/{motion_master_host}", timeout=15)
        except ApiError as e:
            # 409: the API is already connected to Motion Master, which is fine.
            if e.status != 409:
                raise


def main():
    parser = argparse.ArgumentParser(description="Run an actuator back and forth in Profile Position Mode.")
    parser.add_argument("--device-ref", default="0", help="position, address or serial number of the drive (default: 0, the first drive)")
    parser.add_argument("--hours", type=float, default=48, help="how long to run (default: 48)")
    parser.add_argument("--distance", type=int, default=100000, help="distance of one move, in position units")
    parser.add_argument("--velocity", type=int, default=1000, help="profile velocity (0x6081)")
    parser.add_argument("--acceleration", type=int, default=10000, help="profile acceleration (0x6083)")
    parser.add_argument("--deceleration", type=int, default=10000, help="profile deceleration (0x6084)")
    parser.add_argument("--dwell", type=int, default=500, help="how long to wait at each end, in ms")
    parser.add_argument("--move-timeout", type=int, default=30000, help="how long one move may take, in ms")
    parser.add_argument("--summary", default=f"endurance-{datetime.now():%Y-%m-%dT%H-%M-%S}.csv", help="one line per move")
    parser.add_argument("--samples", help="every recorded sample (large)")
    parser.add_argument("--api", default="http://localhost:63526/api", help="HTTP API base URL")
    parser.add_argument("--motion-master", default="127.0.0.1", help="host Motion Master runs on, as seen from the HTTP API")
    args = parser.parse_args()

    api = Api(args.api)
    device = urllib.parse.quote(str(args.device_ref))

    summary_file = open(args.summary, "w", newline="")
    summary = csv.writer(summary_file)
    summary.writerow(["time", "move", "target", "duration_ms", "samples", "max_abs_following_error", "max_abs_torque", "rms_torque"])

    samples_file = open(args.samples, "w", newline="") if args.samples else None
    samples = csv.writer(samples_file) if samples_file else None
    if samples:
        samples.writerow(["timestamp", "position_actual", "following_error", "torque_actual"])

    try:
        api.connect(args.motion_master)

        start = api.get(f"/devices/{device}/upload/0x6064/0x00")["value"]
        targets = [start + args.distance, start]
        run_start = time.monotonic()
        end = run_start + args.hours * 3600
        run_max_following_error = 0
        run_max_torque = 0

        print(f"Running for {args.hours} h between {targets[1]} and {targets[0]}. Summary: {args.summary}")

        move = 0
        while time.monotonic() < end:
            move += 1
            target = targets[(move - 1) % 2]
            started_at = time.monotonic()

            # skip-quick-stop keeps the drive in Operation Enabled between moves.
            text = api.get(
                f"/devices/{device}/run-position-profile",
                {
                    "target": target,
                    "velocity": args.velocity,
                    "acceleration": args.acceleration,
                    "deceleration": args.deceleration,
                    "holding-duration": args.dwell,
                    "relative": "false",
                    "skip-quick-stop": "true",
                    "target-reach-timeout": args.move_timeout,
                },
                timeout=args.move_timeout / 1000 + args.dwell / 1000 + 60,
            )

            rows = list(csv.DictReader(io.StringIO(text)))
            if rows and (FOLLOWING_ERROR not in rows[0] or TORQUE_ACTUAL not in rows[0]):
                raise ApiError(f"The recorded samples have no {FOLLOWING_ERROR} or {TORQUE_ACTUAL} column. "
                               "They follow the PDO mapping of the drive: map both objects to a TxPDO.")

            following_errors = [abs(int(float(row[FOLLOWING_ERROR]))) for row in rows]
            torques = [int(float(row[TORQUE_ACTUAL])) for row in rows]
            max_following_error = max(following_errors, default=0)
            max_torque = max((abs(t) for t in torques), default=0)
            rms_torque = math.sqrt(sum(t * t for t in torques) / len(torques)) if torques else 0

            summary.writerow([
                datetime.now(timezone.utc).isoformat(timespec="milliseconds"),
                move,
                target,
                round((time.monotonic() - started_at) * 1000),
                len(rows),
                max_following_error,
                max_torque,
                f"{rms_torque:.1f}",
            ])
            summary_file.flush()

            if samples:
                for row in rows:
                    samples.writerow([row.get(TIMESTAMP), row.get(POSITION_ACTUAL), row[FOLLOWING_ERROR], row[TORQUE_ACTUAL]])

            run_max_following_error = max(run_max_following_error, max_following_error)
            run_max_torque = max(run_max_torque, max_torque)
            if move % 100 == 0:
                elapsed = (time.monotonic() - run_start) / 3600
                print(f"Move {move}, {elapsed:.2f} h: largest following error {run_max_following_error}, "
                      f"largest torque {run_max_torque}")

        print(f"Finished. Largest following error {run_max_following_error}, largest torque {run_max_torque}.")
    except KeyboardInterrupt:
        print("\nStopped.")
    except (ApiError, OSError) as e:
        print(f"FAILED: {e}", file=sys.stderr)
        try:
            print(f"Error report (0x203F:01): {api.get(f'/devices/{device}/upload/0x203F/0x01')['value']}", file=sys.stderr)
        except (ApiError, OSError):
            pass
        sys.exit(1)
    finally:
        try:
            api.get(f"/devices/{device}/quick-stop")
        except (ApiError, OSError):
            pass
        summary_file.close()
        if samples_file:
            samples_file.close()


if __name__ == "__main__":
    main()
