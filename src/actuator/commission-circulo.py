#!/usr/bin/env python3
# Python 3.10+; no external dependencies required
"""
Commissions an actuator with a SOMANET Circulo drive through the Motion Master HTTP API:

  1. Loads a configuration file (config.csv) onto the drive.
  2. Runs offset detection: open phase detection, phase resistance and inductance, pole pairs,
     motor phase order and commutation offset.
  3. Calibrates a Circulo integrated encoder.
  4. Measures the commutation offset again. Motion Master does that itself after calibrating the encoder used
     for commutation, but only when the software position limits leave enough room, and otherwise only warns,
     which the HTTP API does not pass on.
  5. Saves the configuration on the drive, so it is used after a power cycle.

Steps 3 and 4 run for every encoder given with --encoders, in that order.

The configuration file is usually exported with OBLAC Drives from an actuator of the same build that was
commissioned by hand. Encoder calibration turns the motor in velocity mode, so the file has to contain tuned
velocity controller gains (OBLAC Drives asks for a bandwidth below 30 Hz).

The motor turns during offset detection and calibration: run this on a bench where the actuator can move freely.
Ctrl-C quick stops the drive and keeps it stopped for 3 s, which ends a calibration or offset detection, even one
that has only just started, then exits with code 1. It says so if it could not confirm that the drive is stopped.

The HTTP API has to be running (OBLAC Drives starts it on port 63526) and Motion Master has to be started.

Usage:
  python3 src/actuator/commission-circulo.py --device-ref 1 --encoders 1 path/to/config.csv
  python3 src/actuator/commission-circulo.py --device-ref 1 --encoders 1,2 path/to/config.csv
"""
import argparse
import http.client
import json
import signal
import sys
import time
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
                content_type = res.headers.get_content_type()
            if content_type == "application/json" and text:
                return json.loads(text)
            return text
        except urllib.error.HTTPError as e:
            # The body is {"message": ...}. A failed calibration adds the phase errors of every iteration.
            detail = e.read().decode("utf-8", errors="replace")
            try:
                detail = json.loads(detail).get("message") or detail
            except (ValueError, AttributeError):
                pass
            raise ApiError(f"{method} {path} returned {e.code}: {detail}", e.code) from None
        except (http.client.HTTPException, ValueError) as e:
            # The response was cut short, or it is not the JSON or text it says it is.
            raise ApiError(f"{method} {path} gave an unreadable response: {e}") from None

    def get_field(self, path: str, field: str, timeout: float = 60):
        response = self.request("GET", path, timeout=timeout)
        if not isinstance(response, dict) or field not in response:
            raise ApiError(f"GET {path} gave no {field}: {response}")
        return response[field]

    def connect(self, motion_master_host: str):
        try:
            self.request("GET", f"/connect/{motion_master_host}", timeout=15)
        except ApiError as e:
            # 409: the API is already connected to Motion Master, which is fine.
            if e.status != 409:
                raise


def encoder_ordinals(value: str) -> list[int]:
    try:
        ordinals = [int(ordinal) for ordinal in value.split(",")]
        if all(ordinal >= 1 for ordinal in ordinals):
            return ordinals
    except ValueError:
        pass
    raise argparse.ArgumentTypeError(f"expected ordinals separated by commas, for example 1,2, got {value!r}")


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
    for iteration in iterations:
        result = iteration["result"]
        # The HTTP API sends iteration 0 when Motion Master does not number the iterations.
        number = f" {iteration['iteration']}" if iteration.get("iteration") else ""
        # Only the final iteration rates the finished calibration. The earlier ones measure an encoder that is
        # still being calibrated.
        meaning = f" [final] {result['meaning']}" if iteration.get("final") else ""
        print(f"   Iteration{number}: {result['value']}%{meaning}")


def stop_drive(api: Api, device_ref: str) -> bool:
    """Quick stops the drive whenever it is enabled during the next 3 s, and returns whether it is stopped then.

    The HTTP API goes on with a calibration or offset detection after the script has gone. Motion Master ends a
    calibration, and offset detection stops before its next step, once the drive leaves Operation Enabled. One that
    has only just started enables the drive a moment later, though, and the HTTP API refuses a quick stop until then.
    """
    def state():
        try:
            return api.get_field(f"/devices/{device_ref}/cia402-state", "state", timeout=2)
        except (ApiError, OSError):
            return None

    end = time.monotonic() + 3
    while time.monotonic() < end:
        if state() == "OPERATION_ENABLED":
            try:
                api.request("GET", f"/devices/{device_ref}/quick-stop", timeout=10)
            except (ApiError, OSError):
                pass
        time.sleep(0.1)
    return state() not in (None, "OPERATION_ENABLED")


def main():
    parser = argparse.ArgumentParser(description="Commission a SOMANET Circulo actuator through the HTTP API.",
                                     formatter_class=argparse.ArgumentDefaultsHelpFormatter)
    parser.add_argument("config_file", type=Path, help="configuration file to load, for example a config.csv exported with OBLAC Drives")
    parser.add_argument("--device-ref", default="1", help="position, address or serial number of the drive (1 is the first drive)")
    # argparse.SUPPRESS keeps "(default: None)" out of --help.
    parser.add_argument("--encoders", type=encoder_ordinals, required=True, default=argparse.SUPPRESS, help="comma-separated ordinals of the integrated encoders to calibrate, in that order")
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

        for encoder_ordinal in args.encoders:
            print(f"3. Calibrating integrated encoder {encoder_ordinal}...")
            calibrate_encoder(api, device, encoder_ordinal)

            # Motion Master measures the commutation offset again itself at the end of the calibration of the
            # encoder used for commutation, but only when the software position limits leave enough room.
            # Otherwise it only warns, and the HTTP API does not pass the warning on. Measuring it after every
            # calibration makes the result the same in every case. It moves the motor no more than step 2.
            print("4. Measuring the commutation offset again...")
            run_offset_detection(api, device, ["commutationOffsetMeasurement"])

        print("5. Saving the configuration...")
        api.request("GET", f"/devices/{device}/save-config", timeout=60)

        print("Done.")
    except KeyboardInterrupt:
        # Another Ctrl-C must not cut the stop short.
        signal.signal(signal.SIGINT, signal.SIG_IGN)
        print("\nStopping the drive and watching it for 3 s...", file=sys.stderr)
        if stop_drive(api, device):
            print("FAILED: commissioning stopped with Ctrl-C.", file=sys.stderr)
        else:
            print("FAILED: commissioning stopped with Ctrl-C. Could not confirm that the drive is stopped: "
                  "check it in OBLAC Drives.", file=sys.stderr)
        sys.exit(1)
    except (ApiError, OSError) as e:
        print(f"FAILED: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
