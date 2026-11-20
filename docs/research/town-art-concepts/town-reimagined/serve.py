#!/usr/bin/env python3
"""Static server for the Town concept gallery.

127.0.0.1:8811 already belongs to another preview (town-next), so this binds
the Tailscale and LAN addresses on 8811 only: same port, different addresses,
no conflict with that service.
"""
import functools, http.server, os, socketserver, sys, threading

ROOT = os.path.dirname(os.path.abspath(__file__))
PORT = 8811
ADDRS = sys.argv[1:] or ["127.0.0.1"]


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map, ".js": "text/javascript"}

    def end_headers(self):
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def log_message(self, *a):
        pass


class Server(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True


servers = []
for a in ADDRS:
    try:
        servers.append(Server((a, PORT), functools.partial(Handler, directory=ROOT)))
        print(f"serving http://{a}:{PORT}/", flush=True)
    except OSError as e:
        print(f"skip {a}: {e}", flush=True)
if not servers:
    sys.exit(1)
for s in servers[1:]:
    threading.Thread(target=s.serve_forever, daemon=True).start()
servers[0].serve_forever()
