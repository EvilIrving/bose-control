#!/usr/bin/env python3
"""Serve the Bose Web Bluetooth page over HTTPS on the LAN."""

from __future__ import annotations

import base64
import hashlib
import ipaddress
import json
import os
import socket
import ssl
import struct
import subprocess
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent
WEB = ROOT / "web"
BRIDGE = ROOT / "tools" / "bt-bridge"
WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
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




def bridge_binary() -> Path | None:
    if BRIDGE.exists():
        return BRIDGE
    source = BRIDGE.with_suffix(".swift")
    if not source.exists():
        return None
    try:
        subprocess.check_call(["swiftc", "-O", str(source), "-o", str(BRIDGE)])
    except (OSError, subprocess.CalledProcessError):
        return None
    return BRIDGE


def paired_devices() -> list:
    binary = bridge_binary()
    if binary is None:
        return []
    try:
        out = subprocess.check_output([str(binary), "list"], text=True, timeout=10)
        return json.loads(out)
    except (OSError, subprocess.CalledProcessError, ValueError):
        return []


def recv_exact(stream, size: int) -> bytes:
    data = b""
    while len(data) < size:
        chunk = stream.read(size - len(data))
        if not chunk:
            return b""
        data += chunk
    return data


def recv_frame(stream):
    head = recv_exact(stream, 2)
    if len(head) < 2:
        return None
    opcode = head[0] & 0x0F
    masked = head[1] & 0x80
    length = head[1] & 0x7F
    if length == 126:
        length = struct.unpack(">H", recv_exact(stream, 2))[0]
    elif length == 127:
        length = struct.unpack(">Q", recv_exact(stream, 8))[0]
    mask = recv_exact(stream, 4) if masked else b""
    payload = recv_exact(stream, length)
    if masked:
        payload = bytes(byte ^ mask[index % 4] for index, byte in enumerate(payload))
    if opcode == 0x8:
        return None
    if opcode not in (0x1, 0x2):
        return b""
    return payload


def ws_frame(text: str) -> bytes:
    payload = text.encode("utf-8")
    head = bytearray([0x81])
    size = len(payload)
    if size < 126:
        head.append(size)
    elif size < 65536:
        head.append(126)
        head += struct.pack(">H", size)
    else:
        head.append(127)
        head += struct.pack(">Q", size)
    return bytes(head) + payload


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(WEB), **kwargs)


    def do_GET(self) -> None:
        path = self.path.split("?")[0]
        if path == "/api/devices":
            body = json.dumps(paired_devices()).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        if path == "/bt" and "websocket" in self.headers.get("Upgrade", "").lower():
            self.serve_bridge()
            return
        super().do_GET()

    # 浏览器开不了蓝牙串口，这里把 WS 上的命令透给 bt-bridge 子进程
    def serve_bridge(self) -> None:
        key = self.headers.get("Sec-WebSocket-Key", "")
        accept = base64.b64encode(hashlib.sha1((key + WS_GUID).encode()).digest()).decode()
        self.send_response(101, "Switching Protocols")
        self.send_header("Upgrade", "websocket")
        self.send_header("Connection", "Upgrade")
        self.send_header("Sec-WebSocket-Accept", accept)
        self.end_headers()
        self.wfile.flush()

        proc: subprocess.Popen | None = None
        lock = threading.Lock()

        def send(payload: dict) -> None:
            with lock:
                try:
                    self.wfile.write(ws_frame(json.dumps(payload)))
                    self.wfile.flush()
                except OSError:
                    pass

        def pump(child: subprocess.Popen) -> None:
            for line in child.stdout:
                line = line.strip()
                if not line:
                    continue
                if line.startswith("D "):
                    send({"t": "data", "hex": line[2:]})
                elif line.startswith("C "):
                    send({"t": "ok", "link": line[2:]})
                elif line.startswith("E "):
                    send({"t": "error", "code": line[2:]})

        try:
            while True:
                frame = recv_frame(self.rfile)
                if frame is None:
                    break
                if not frame:
                    continue
                try:
                    cmd = json.loads(frame.decode("utf-8"))
                except ValueError:
                    continue
                kind = cmd.get("t")
                if kind == "list":
                    send({"t": "devices", "list": paired_devices()})
                elif kind == "open":
                    if proc is not None:
                        proc.kill()
                    binary = bridge_binary()
                    if binary is None:
                        send({"t": "error", "code": "nobridge"})
                        continue
                    channels = ",".join(str(int(c)) for c in cmd.get("channels") or [1, 2, 3])
                    services = ",".join(str(s) for s in cmd.get("services") or [])
                    proc = subprocess.Popen(
                        [str(binary), "open", str(cmd.get("address", "")), channels, services],
                        stdin=subprocess.PIPE,
                        stdout=subprocess.PIPE,
                        text=True,
                        bufsize=1,
                    )
                    threading.Thread(target=pump, args=(proc,), daemon=True).start()
                elif kind == "send":
                    if proc is not None and proc.stdin:
                        try:
                            proc.stdin.write("T %s\n" % cmd.get("hex", ""))
                            proc.stdin.flush()
                        except OSError:
                            pass
                elif kind == "close":
                    break
        finally:
            if proc is not None:
                proc.kill()
            self.close_connection = True

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
