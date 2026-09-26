"""Static dev server with caching disabled so edited ES modules always reload.

Also bridges the sensor board's USB serial port to the dashboard (/serial/stream, /serial/status),
so live data doesn't depend on the browser's Web Serial support.
  python tools/serve.py 8001                 # auto-detects the board's COM port
  python tools/serve.py 8001 COM12           # or name it
  set MINE_SENTINEL_BAUD=9600                # if the sketch uses another baud rate
"""
import http.server
import json
import os
import queue
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
SERIAL_PORT = sys.argv[2] if len(sys.argv) > 2 else None

try:
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    from serial_bridge import Bridge
    BRIDGE = Bridge(SERIAL_PORT)
except (ImportError, OSError, AttributeError):
    BRIDGE = None  # non-Windows: the dashboard falls back to Web Serial


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def log_message(self, fmt, *args):
        if not self.path.startswith('/serial/'):
            super().log_message(fmt, *args)

    def do_GET(self):
        if self.path.startswith('/serial/status'):
            return self.send_json(BRIDGE.status if BRIDGE else {'state': 'unavailable'})
        if self.path.startswith('/serial/stream'):
            return self.stream() if BRIDGE else self.send_error(404)
        return super().do_GET()

    def send_json(self, obj):
        body = json.dumps(obj).encode()
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def stream(self):
        self.send_response(200)
        self.send_header('Content-Type', 'text/event-stream')
        self.send_header('Connection', 'keep-alive')
        self.end_headers()
        q = BRIDGE.subscribe()
        try:
            s = BRIDGE.status
            self.wfile.write(f"event: status\ndata: {s['state']}|{s['port'] or ''}|{s['detail']}\n\n".encode())
            self.wfile.flush()
            while True:
                try:
                    kind, text = q.get(timeout=10)
                    msg = f'event: {kind}\ndata: {text}\n\n'
                except queue.Empty:
                    msg = ': keep-alive\n\n'
                self.wfile.write(msg.encode('utf-8'))
                self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError, OSError):
            pass
        finally:
            BRIDGE.unsubscribe(q)


if __name__ == '__main__':
    print(f'Serving {ROOT} on http://localhost:{PORT}/public/')
    if BRIDGE:
        print(f'Serial bridge ready ({SERIAL_PORT or "auto-detect board"}, {BRIDGE.baud} baud) at /serial/stream')
    http.server.ThreadingHTTPServer(('', PORT), NoCacheHandler).serve_forever()
