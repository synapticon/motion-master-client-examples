#!/usr/bin/env python3
# Python 3.10+; no external dependencies required
import json
import urllib.request
import urllib.error
from pathlib import Path

# This example demonstrates how to install firmware on two devices in parallel using the HTTP API of Motion Master Client.
# Make sure Motion Master Client is running with HTTP API enabled before executing this script.
# This script uses the firmware packages of the devices currently connected to the setup, so enumerate the devices,
# and make sure to use the correct firmware package files for each device, and make sure the device position is correct.

# Adjust the API base URL if needed - most likely, the host name will be same, but the port might differ (63526 is the default)
API_BASE = "http://localhost:63526/api"

# Map devices to firmware paths, these are used just as an example
firmware_map: dict[int | str, str] = {
    1: "src/internal/package_SOMANET-Node_9501-01_motion-drive_v5.6.2.zip",
    2: "src/internal/package_SOMANET-Circulo-7_8504-03_motion-drive_v5.6.2.zip",
}


def fetch_json(url: str):
    """Helper to GET JSON from the given URL."""
    with urllib.request.urlopen(url) as res:
        return json.load(res)


def post_binary(url: str, data: bytes) -> tuple[int, str]:
    """Helper to POST binary data and return (status_code, response_text)."""
    req = urllib.request.Request(url, data=data, method="POST")
    req.add_header("Content-Type", "application/octet-stream")

    try:
        with urllib.request.urlopen(req) as res:
            return res.status, res.read().decode("utf-8", errors="ignore")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", errors="ignore")


def main():
    try:
        # 0. Connect to the API
        print("Connecting to the API...")
        try:
            with urllib.request.urlopen(f"{API_BASE}/connect") as res:
                status = res.status
        except urllib.error.HTTPError as e:
            status = e.code

        if status == 409:
            print("Already connected (409), continuing...")
        elif status != 200:
            raise RuntimeError(f"Connect failed: {status}")
        else:
            print("Connected successfully")

        # 1. Fetch all devices
        devices = fetch_json(f"{API_BASE}/devices")
        print(f"Found {len(devices)} devices")

        # 2. Start firmware installation in parallel
        from concurrent.futures import ThreadPoolExecutor, as_completed

        def install_firmware(device):
            position = device.get("position")
            firmware_path = firmware_map.get(position or 0)
            if not firmware_path:
                return {"device": position, "status": "skipped", "message": "No firmware mapped"}

            firmware_buffer = Path(firmware_path).read_bytes()

            # Tweak the URL parameters as needed.
            # In this example, we skip the SII installation, and are skipping the writing of the stack image and the ESI file.
            url = (
                f"{API_BASE}/devices/{position}/start-firmware-installation"
                "?skip-sii-installation=true"
                "&skip-files=SOMANET_CiA_402.xml.zip"
                "&skip-files=stack_image.svg.zip"
                "&request-timeout=120000"
            )

            status, text = post_binary(url, firmware_buffer)
            if status == 200:
                return {"device": position, "status": "ok"}
            else:
                return {"device": position, "status": "error", "message": f"{status} - {text}"}

        results = []
        with ThreadPoolExecutor() as executor:
            futures = [executor.submit(install_firmware, d) for d in devices]
            for future in as_completed(futures):
                results.append(future.result())

        # 3. Print all results
        for r in results:
            if r["status"] == "ok":
                print(f"{r['device']}: {r['status']}")
            else:
                print(f"{r['device']}: {r['status']} - {r.get('message', '')}")

    except Exception as e:
        print(f"Fatal error: {e}")


if __name__ == "__main__":
    main()
