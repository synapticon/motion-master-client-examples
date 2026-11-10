#!/usr/bin/env python3
# Python 3.10+; no external dependencies required
"""
Commissions an actuator with a SOMANET Circulo drive through the Motion Master HTTP API:

  1. Loads a configuration file (config.csv) onto the drive.
  2. Runs offset detection: open phase detection, phase resistance and inductance, pole pairs,
     motor phase order and commutation offset.
  3. Calibrates the Circulo integrated encoders, one after another.
  4. Measures the commutation offset again, because the calibration changes the position the encoder reports.
  5. Saves the configuration on the drive, so it is used after a power cycle.

The configuration file is usually exported with OBLAC Drives from an actuator of the same build that was
commissioned by hand. Encoder calibration turns the motor in velocity mode, so the file has to contain tuned
velocity controller gains (OBLAC Drives asks for a bandwidth below 30 Hz).

The motor turns during offset detection and calibration: run this on a bench where the actuator can move freely.

The HTTP API has to be running (OBLAC Drives starts it on port 63526) and Motion Master has to be started.

Usage:
  python3 src/actuator/commission-circulo.py --device-ref 0 path/to/config.csv
  python3 src/actuator/commission-circulo.py --device-ref 0 --encoders 1,2 path/to/config.csv
"""
import argparse
import json
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path


class ApiError(Exception):
    def __init__(self, message: str, status: int | None = None):
        super().__init__(message)
        self.status = status


class Api:
    def __init__(self, base_url: str):
        self.base_url = base_url.rstrip("/")

    def request(self, method: str, path: str, params: dict | None = None, body: bytes | None = None,
                timeout: float = 60):
        url = f"{self.base_url}{path}"
        if params:
            url += "?" + urllib.parse.urlencode(params)
        req = urllib.request.Request(url, data=body, method=method)
        if body is not None:
            req.add_header("Content-Type", "application/octet-stream")
        try:
            with urllib.request.urlopen(req, timeout=timeout) as res:
                text = res.read().decode("utf-8")
        except urllib.error.HTTPError as e:
            detail = e.read().decode("utf-8", errors="replace")
            raise ApiError(f"{method} {path} returned {e.code}: {detail}", e.code) from None
        if res.headers.get_content_type() == "application/json" and text:
            return json.loads(text)
        return text

    def connect(self, motion_master_host: str):
        try:
            self.request("GET", f"/connect/{motion_master_host}", timeout=15)
        except ApiError as e:
            # 409: the API is already connected to Motion Master, which is fine.
            if e.status != 409:
                raise


def run_offset_detection(api: Api, device_ref: str, step_names: list[str]):
    params = {"stepNames": ",".join(step_names)} if step_names else None
    steps = api.request("GET", f"/devices/{device_ref}/run-offset-detection", params, timeout=600)

    failed = []
    for step in steps:
        if step["status"] == "idle":
            continue  # not part of this run
        if step["status"] == "succeeded":
            print(f"   {step['label']}: value {step.get('value')}")
        else:
            print(f"   {step['label']}: FAILED {step.get('error', '')}")
            failed.append(step["label"])
        # Open phase detection succeeds when it could measure, and its value says whether a phase is open.
        if step["id"] == "openPhaseDetection" and step["status"] == "succeeded" and step.get("value") is True:
            failed.append("Open Phase Detection (a motor phase is open)")

    if failed:
        raise ApiError(f"Offset detection failed: {', '.join(failed)}")


def calibrate_encoder(api: Api, device_ref: str, encoder_ordinal: int):
    # Motion Master reports the calibration every iteration. A slow calibration of the output-side encoder of a
    # geared actuator can take minutes between two reports. A failed calibration comes back as an HTTP 500.
    iterations = api.request(
        "GET",
        f"/devices/{device_ref}/start-circulo-encoder-narrow-angle-calibration",
        {"encoder-ordinal": encoder_ordinal, "request-timeout": 600000},
        timeout=3600,
    )
    for i, iteration in enumerate(iterations, start=1):
        result = iteration["result"]
        # Only the final iteration rates the finished calibration.
        final = " [final]" if iteration.get("final") else ""
        print(f"   Iteration {iteration.get('iteration', i)}: {result['meaning']} ({result['value']}%){final}")


def main():
    parser = argparse.ArgumentParser(description="Commission a SOMANET Circulo actuator through the HTTP API.")
    parser.add_argument("config_file", type=Path, help="configuration file to load, for example a config.csv exported with OBLAC Drives")
    parser.add_argument("--device-ref", default="0", help="position, address or serial number of the drive (default: 0, the first drive)")
    parser.add_argument("--encoders", default="1", help="comma-separated ordinals of the integrated encoders to calibrate (default: 1)")
    parser.add_argument("--merge", action="store_true", help="merge the file into the configuration on the drive instead of replacing it")
    parser.add_argument("--api", default="http://localhost:63526/api", help="HTTP API base URL")
    parser.add_argument("--motion-master", default="127.0.0.1", help="host Motion Master runs on, as seen from the HTTP API")
    args = parser.parse_args()

    api = Api(args.api)
    device = urllib.parse.quote(str(args.device_ref))

    try:
        api.connect(args.motion_master)

        print(f"1. Loading {args.config_file}...")
        api.request(
            "PUT",
            f"/devices/{device}/load-config",
            {"strategy": "merge" if args.merge else "replace", "refresh": "true"},
            body=args.config_file.read_bytes(),
            timeout=120,
        )

        print("2. Running offset detection...")
        run_offset_detection(api, device, [])

        for encoder_ordinal in [int(e) for e in args.encoders.split(",")]:
            print(f"3. Calibrating integrated encoder {encoder_ordinal}...")
            calibrate_encoder(api, device, encoder_ordinal)

        # Motion Master already measures the commutation offset at the end of the calibration of the encoder used
        # for commutation, but only when the software position limits leave enough room, and the HTTP API does not
        # pass on the warning it sends otherwise. Measuring it here makes the result the same in both cases. It
        # moves the motor no more than step 2.
        print("4. Measuring the commutation offset again...")
        run_offset_detection(api, device, ["commutationOffsetMeasurement"])

        print("5. Saving the configuration...")
        api.request("GET", f"/devices/{device}/save-config", timeout=60)

        print("Done.")
    except (ApiError, OSError) as e:
        print(f"FAILED: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
