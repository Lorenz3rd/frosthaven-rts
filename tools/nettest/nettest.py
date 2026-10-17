"""Network multiplayer test harness: runs several separate headless Chrome browsers against the game.

Each browser opens index.html with ?nt=<scenario>&role=...; the server slips tools/nettest/driver.js into
the page, the driver plays its part (host, join, drop the connection...) and reports back here.

  python tools/nettest/nettest.py            # every scenario
  python tools/nettest/nettest.py basic lan  # just these
  python tools/nettest/nettest.py --list

Chrome switches:
  --use-fake-ui-for-media-stream            microphone allowed (the "Same network" option)
Networks are simulated inside the page (see simulateNetwork in driver.js): nohost=1 hides local addresses
(same Wi-Fi with no local path), relayonly=1 leaves no usable address (a network that blocks UDP).
"""
import http.server
import json
import os
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import urllib.parse
import urllib.request
import re

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
PORT = 8140
CHROME_PATHS = [
    r'C:\Program Files\Google\Chrome\Application\chrome.exe',
    r'C:\Program Files (x86)\Google\Chrome\Application\chrome.exe',
    r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe',
    '/usr/bin/google-chrome', '/usr/bin/chromium',
]

LIBS = {   # served locally so a slow CDN can't stall a test browser (fetched once per run)
    'three.min.js': 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js',
    'peerjs.min.js': 'https://cdnjs.cloudflare.com/ajax/libs/peerjs/1.5.4/peerjs.min.js',
}
lib_cache = {}
events = []            # every report from every browser: {run, who, t, ev, ...}
events_lock = threading.Lock()


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=ROOT, **k)

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def do_GET(self):
        u = urllib.parse.urlparse(self.path)
        if u.path in ('/', '/index.html') and 'nt' in urllib.parse.parse_qs(u.query):
            with open(os.path.join(ROOT, 'index.html'), encoding='utf-8') as f:
                html = f.read()
            html = html.replace('</body>', '<script src="tools/nettest/driver.js"></script>\n</body>')
            body = html.encode('utf-8')
            self.send_response(200)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        if u.path.startswith('/__nt/lib/'):
            body = lib_cache.get(u.path.rsplit('/', 1)[1])
            if body is None:
                self.send_error(404)
                return
            self.send_response(200)
            self.send_header('Content-Type', 'text/javascript')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        super().do_GET()

    def do_POST(self):
        if not self.path.startswith('/__nt/log'):
            self.send_error(404)
            return
        n = int(self.headers.get('Content-Length') or 0)
        try:
            ev = json.loads(self.rfile.read(n) or b'{}')
        except ValueError:
            ev = {'ev': 'bad-json'}
        ev['at'] = time.time()
        with events_lock:
            events.append(ev)
        if os.environ.get('NT_VERBOSE'):
            print('   ', ev.get('who'), ev.get('ev'), json.dumps({k: v for k, v in ev.items() if k not in ('who', 'ev', 'run', 'at')})[:300])
        self.send_response(204)
        self.end_headers()

    def log_message(self, fmt, *a):
        if os.environ.get('NT_VERBOSE') == '2':
            print('    http %.1f' % (time.time() % 1000), self.client_address[1], fmt % a, flush=True)


def fetch_libs():
    for name, url in LIBS.items():
        with urllib.request.urlopen(url, timeout=30) as r:
            lib_cache[name] = r.read()


class Server(http.server.ThreadingHTTPServer):
    request_queue_size = 256   # a page load opens many connections at once; the default 5 drops some
    daemon_threads = True


def start_server():
    srv = Server(('127.0.0.1', PORT), Handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv


def chrome():
    for p in CHROME_PATHS:
        if os.path.exists(p):
            return p
    sys.exit('No Chrome / Edge found')


def launch(url, flags):
    d = tempfile.mkdtemp(prefix='nt-chrome-')
    args = [chrome(), '--headless=new', '--user-data-dir=' + d, '--no-first-run', '--no-default-browser-check',
            '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader',
            '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
            '--disable-backgrounding-occluded-windows', '--window-size=480,360', '--mute-audio'] + flags + [url]
    p = subprocess.Popen(args, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    return p, d


def kill(p):
    if os.name == 'nt':
        subprocess.run(['taskkill', '/T', '/F', '/PID', str(p.pid)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    else:
        p.kill()


MIC = ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream']

# name: (description, [(who, role, extra query, chrome flags)], seconds, check(events) -> (ok, note))
SCENARIOS = {}


def scenario(name, desc, browsers, seconds):
    def wrap(fn):
        SCENARIOS[name] = (desc, browsers, seconds, fn)
        return fn
    return wrap


def by(evs, who=None, ev=None):
    return [e for e in evs if (who is None or e.get('who') == who) and (ev is None or e.get('ev') == ev)]


def done(evs, who):
    d = by(evs, who, 'done')
    return d[0] if d else None


def all_ok(evs, whos):
    bad = []
    for w in whos:
        d = done(evs, w)
        if not d:
            bad.append(f'{w}: no result')
        elif not d.get('ok'):
            bad.append(f'{w}: {d.get("why")}')
    return (not bad, '; '.join(bad) or 'ok')


@scenario('probe', 'Which local addresses Chrome offers, with and without microphone access',
          [('nomic', 'probe', '', []), ('mic', 'probe', 'mic=1', MIC)], 25)
def _probe(evs):
    a, b = done(evs, 'nomic'), done(evs, 'mic')
    if not a or not b:
        return False, 'missing result'
    note = f"no mic: {a.get('cands')} | mic: {b.get('cands')}"
    hidden = any('.local' in c for c in a.get('cands', []))
    real = any(c.split(' ')[1][0].isdigit() and 'host' in c for c in b.get('cands', []))
    return hidden and real, note


@scenario('fp', 'Does the build fingerprint change while the page runs?',
          [('a', 'probe', 'fp=10', []), ('b', 'probe', 'fp=10', [])], 60)
def _fp(evs):
    a, b = done(evs, 'a'), done(evs, 'b')
    if not a or not b:
        return False, 'missing result'
    return not a['diff'] and not b['diff'], json.dumps(a['diff'])[:400] + ' | ' + json.dumps(b['diff'])[:400]


@scenario('basic', 'Host + 2 joiners, default settings: lobby, picks, battle, commands reach the host',
          [('host', 'host', 'players=3&start=1&play=12', []), ('j1', 'join', 'start=1&play=12', []), ('j2', 'join', 'start=1&play=12', [])], 150)
def _basic(evs):
    return all_ok(evs, ['host', 'j1', 'j2'])


@scenario('lan', '"Same network" on both (microphone allowed): direct link over the local address',
          [('host', 'host', 'players=2&lan=1', MIC), ('j1', 'join', 'lan=1&route=lan', MIC)], 60)
def _lan(evs):
    return all_ok(evs, ['host', 'j1'])


@scenario('lanhost', '"Same network" only on the host: still direct',
          [('host', 'host', 'players=2&lan=1', MIC), ('j1', 'join', 'lan=0&route=lan', [])], 60)
def _lanhost(evs):
    return all_ok(evs, ['host', 'j1'])


@scenario('nohairpin', 'Only public addresses (same Wi-Fi with no local path, router without hairpin): fails with a clear reason',
          [('host', 'host', 'players=2&expectfail=1&nohost=1', []), ('j1', 'join', 'expect=same-network&nohost=1&showreport=1', [])], 120)
def _nohairpin(evs):
    return all_ok(evs, ['host', 'j1'])


@scenario('mdns', 'Your same-Wi-Fi case without "Same network": hidden local addresses cannot be looked up, no hairpin: fails, says why',
          [('host', 'host', 'players=2&expectfail=1&nomdns=1', []), ('j1', 'join', 'expect=same-network&nomdns=1&showreport=1', [])], 120)
def _mdns(evs):
    return all_ok(evs, ['host', 'j1'])


@scenario('mdnsfix', 'Same case with "Same network" on the host (microphone allowed): connects directly',
          [('host', 'host', 'players=2&lan=1&nomdns=1', MIC), ('j1', 'join', 'nomdns=1&route=lan', [])], 90)
def _mdnsfix(evs):
    return all_ok(evs, ['host', 'j1'])


@scenario('mdnsjoin', 'Same case with "Same network" only on the joiner: connects directly too',
          [('host', 'host', 'players=2&nomdns=1', []), ('j1', 'join', 'lan=1&nomdns=1&route=lan|direct', MIC)], 90)
def _mdnsjoin(evs):
    return all_ok(evs, ['host', 'j1'])


@scenario('askdeny', '"Same network" on but the microphone is refused: the room still opens, with a warning',
          [('host', 'host', 'players=1&lan=1&warn=1', [])], 60)
def _askdeny(evs):
    return all_ok(evs, ['host'])


@scenario('noudp', 'A network that blocks UDP (strict school / work Wi-Fi): fails with a clear reason',
          [('host', 'host', 'players=2&expectfail=1', []), ('j1', 'join', 'expect=no-udp&relayonly=1', [])], 120)
def _noudp(evs):
    return all_ok(evs, ['host', 'j1'])


@scenario('noroom', 'Joining a room nobody created: quick, clear error',
          [('j1', 'join', 'room=nobody-here-zz&expect=no-room', [])], 40)
def _noroom(evs):
    return all_ok(evs, ['j1'])


@scenario('dropgame', 'Mid-battle the link dies (closed): the joiner reconnects by itself and keeps playing',
          [('host', 'host', 'players=2&start=1&play=30', []), ('j1', 'join', 'start=1&play=30&drop=close@6', [])], 120)
def _dropgame(evs):
    return all_ok(evs, ['host', 'j1'])


@scenario('silent', 'Mid-battle the link goes silent (Wi-Fi stops passing data): detected, reconnected',
          [('host', 'host', 'players=2&start=1&play=40', []), ('j1', 'join', 'start=1&play=40&drop=mute@6', [])], 120)
def _silent(evs):
    return all_ok(evs, ['host', 'j1'])


@scenario('hostdrop', 'The host side kills the link: the joiner reconnects',
          [('host', 'host', 'players=2&start=1&play=30&drop=close@6', []), ('j1', 'join', 'start=1&play=30&expectre=1', [])], 120)
def _hostdrop(evs):
    return all_ok(evs, ['host', 'j1'])


@scenario('lobbydrop', 'In the lobby the link dies: the joiner comes back with its team and hero',
          [('host', 'host', 'players=2&start=1&play=5&startdelay=14', []), ('j1', 'join', 'start=1&play=5&pick=1&drop=close@4&where=lobby', [])], 120)
def _lobbydrop(evs):
    return all_ok(evs, ['host', 'j1'])


@scenario('broker', 'The host loses the room finder: it reconnects, and a new player can still join',
          [('host', 'host', 'players=2&broker=2', []), ('j1', 'join', 'delay=9000', [])], 90)
def _broker(evs):
    return all_ok(evs, ['host', 'j1'])


@scenario('hostidle', 'The host tab sits in the background in the lobby (timers slowed): joiners stay connected',
          [('host', 'host', 'players=2&freeze=20', []), ('j1', 'join', 'stay=24', [])], 90)
def _hostidle(evs):
    return all_ok(evs, ['host', 'j1'])


@scenario('closed', 'The host ends the room: the joiner is told, and does not try to reconnect',
          [('host', 'host', 'players=2&start=1&play=4&end=1', []), ('j1', 'join', 'start=1&play=20&expect=closed', [])], 90)
def _closed(evs):
    return all_ok(evs, ['host', 'j1'])


@scenario('version', 'Different game files: clear error, no retries',
          [('host', 'host', 'players=2&expectfail=1', []), ('j1', 'join', 'tamper=1&expect=version', [])], 60)
def _version(evs):
    return all_ok(evs, ['host', 'j1'])


def run(name):
    desc, browsers, seconds, check = SCENARIOS[name]
    run_id = f'{name}-{int(time.time() * 1000) % 10**8}'
    room = 'nt-' + run_id
    procs = []
    t0 = time.time()
    whos = [b[0] for b in browsers]

    def evs_now():
        with events_lock:
            return [e for e in events if e.get('run') == run_id]

    # One browser at a time: started together they trip over each other's page loads. A browser that
    # doesn't get its page going in 20 seconds is started again.
    for who, role, extra, flags in browsers:
        q = f'nt={name}&run={run_id}&who={who}&role={role}&room={room}&name={who}' + ('&' + extra if extra else '')
        for tries in range(4):
            proc = launch(f'http://127.0.0.1:{PORT}/index.html?{q}', flags)
            t1 = time.time()
            while time.time() - t1 < 15 and not by(evs_now(), who):
                time.sleep(0.2)
            if by(evs_now(), who):
                break
            print(f'   ({who} did not start: launching it again)', flush=True)
            kill(proc[0])
            shutil.rmtree(proc[1], ignore_errors=True)
        procs.append(proc)
    t0 = time.time()
    while time.time() - t0 < seconds:
        if all(done(evs_now(), w) for w in whos):
            break
        time.sleep(0.5)
    with events_lock:
        evs = [e for e in events if e.get('run') == run_id]
    for p, d in procs:
        kill(p)
    for p, d in procs:
        try:
            p.wait(5)
        except subprocess.TimeoutExpired:
            pass
        shutil.rmtree(d, ignore_errors=True)
    ok, note = check(evs)
    return ok, note, round(time.time() - t0, 1), evs


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('-')]
    if '--list' in sys.argv:
        for k, v in SCENARIOS.items():
            print(f'{k:10} {v[0]}')
        return
    names = args or [k for k in SCENARIOS if k != 'probe']
    fetch_libs()
    start_server()
    results = []
    for n in names:
        print(f'== {n}: {SCENARIOS[n][0]}', flush=True)
        ok, note, secs, evs = run(n)
        results.append((n, ok, note, secs))
        print(f'   {"PASS" if ok else "FAIL"} in {secs}s  {note}', flush=True)
        for e in evs:
            if e.get('ev') in ('note', 'done', 'error', 'status'):
                print(f'     [{e.get("who")}] {e.get("ev")}: ' + json.dumps({k: v for k, v in e.items() if k not in ('who', 'ev', 'run', 'at', 'report')})[:400], flush=True)
        if not ok or os.environ.get('NT_REPORTS'):
            for e in evs:
                if e.get('report'):
                    print('     report from', e.get('who') + ':\n       ' + e['report'].replace('\n', '\n       '), flush=True)
    print('\nSummary:')
    for n, ok, note, secs in results:
        print(f'  {"PASS" if ok else "FAIL"}  {n:10} {secs:6}s  {note[:150]}')
    sys.exit(0 if all(r[1] for r in results) else 1)


if __name__ == '__main__':
    main()
