#!/usr/bin/env python3
"""Serve the Bose Web Bluetooth page over HTTPS on the LAN."""

from __future__ import annotations

import ipaddress
import os
import socket
import ssl
import subprocess
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent
WEB = ROOT / "web"
CERT_DIR = ROOT / ".certs"
CRT = CERT_DIR / "lan.crt"
KEY = CERT_DIR / "lan.key"
PORT = int(os.environ.get("PORT", "8443"))


def lan_ip() -> str:
    for name in ("en0", "en1", "eth0", "wlan0"):
        try:
            out = subprocess.check_output(["ipconfig", "getifaddr", name], text=True).strip()
        except (OSError, subprocess.CalledProcessError):
            continue
        try:
            addr = ipaddress.ip_address(out)
        except ValueError:
            continue
        if addr.is_private and not addr.is_loopback:
            return out
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        sock.connect(("1.1.1.1", 80))
        candidate = sock.getsockname()[0]
    except OSError:
        candidate = "127.0.0.1"
    finally:
        sock.close()
    addr = ipaddress.ip_address(candidate)
    if addr in ipaddress.ip_network("198.18.0.0/15"):
        return "127.0.0.1"
    return candidate


def ensure_cert(ip: str) -> None:
    CERT_DIR.mkdir(exist_ok=True)
    if CRT.exists() and KEY.exists():
        return
    san = f"IP:{ip},IP:127.0.0.1,DNS:localhost"
    subprocess.check_call(
        [
            "openssl",
            "req",
            "-x509",
            "-newkey",
            "rsa:2048",
            "-sha256",
            "-days",
            "825",
            "-nodes",
            "-subj",
            "/CN=Bose Local Control",
            "-addext",
            f"subjectAltName={san}",
            "-keyout",
            str(KEY),
            "-out",
            str(CRT),
        ],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(WEB), **kwargs)

    def log_message(self, fmt: str, *args) -> None:
        print("%s - %s" % (self.address_string(), fmt % args))


def main() -> None:
    ip = lan_ip()
    ensure_cert(ip)
    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    ctx.load_cert_chain(str(CRT), str(KEY))
    httpd = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    httpd.socket = ctx.wrap_socket(httpd.socket, server_side=True)
    print("Bose local control")
    print(f"  phone:  https://{ip}:{PORT}/")
    print(f"  this machine: https://127.0.0.1:{PORT}/")
    print("Android Chrome: open the phone URL, accept the cert warning, then tap 连接 Bose.")
    if ipaddress.ip_address(ip).is_private:
        print("Phone and computer must be on the same Wi-Fi.")
    httpd.serve_forever()


if __name__ == "__main__":
    main()
