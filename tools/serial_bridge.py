"""USB-serial → HTTP bridge for the dashboard (Windows, standard library only).

The server reads the board's COM port itself and streams every line to the dashboard as
Server-Sent Events, so the dashboard works in any browser and never depends on Web Serial.
The port is opened only while at least one dashboard is listening, which leaves it free for the
Arduino IDE (uploading, Serial Monitor) whenever no dashboard is open.
"""
import ctypes
import ctypes.wintypes as wt
import os
import queue
import threading
import time
import winreg

# USB-serial chips on Arduino / ESP32 boards: CP210x, CH340/CH9102, FTDI, Espressif, Arduino.
BOARD_VIDS = ('10C4', '1A86', '0403', '303A', '2341', '2A03')

GENERIC_READ = 0x80000000
GENERIC_WRITE = 0x40000000
OPEN_EXISTING = 3
INVALID_HANDLE = ctypes.c_void_p(-1).value
MAXDWORD = 0xFFFFFFFF
PURGE_RXCLEAR = 0x0008

k32 = ctypes.WinDLL('kernel32', use_last_error=True)
k32.CreateFileW.restype = wt.HANDLE
k32.CreateFileW.argtypes = [wt.LPCWSTR, wt.DWORD, wt.DWORD, ctypes.c_void_p, wt.DWORD, wt.DWORD, wt.HANDLE]


class DCB(ctypes.Structure):
    _fields_ = [
        ('DCBlength', wt.DWORD), ('BaudRate', wt.DWORD), ('fBits', wt.DWORD), ('wReserved', wt.WORD),
        ('XonLim', wt.WORD), ('XoffLim', wt.WORD), ('ByteSize', wt.BYTE), ('Parity', wt.BYTE),
        ('StopBits', wt.BYTE), ('XonChar', ctypes.c_char), ('XoffChar', ctypes.c_char),
        ('ErrorChar', ctypes.c_char), ('EofChar', ctypes.c_char), ('EvtChar', ctypes.c_char),
        ('wReserved1', wt.WORD),
    ]


class COMMTIMEOUTS(ctypes.Structure):
    _fields_ = [(n, wt.DWORD) for n in (
        'ReadIntervalTimeout', 'ReadTotalTimeoutMultiplier', 'ReadTotalTimeoutConstant',
        'WriteTotalTimeoutMultiplier', 'WriteTotalTimeoutConstant')]


def find_board_port():
    """COM name of the first plugged-in USB-serial board, or None."""
    present = set()
    try:
        with winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, r'HARDWARE\DEVICEMAP\SERIALCOMM') as k:
            i = 0
            while True:
                try:
                    present.add(winreg.EnumValue(k, i)[1])
                    i += 1
                except OSError:
                    break
    except OSError:
        return None
    try:
        usb = winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, r'SYSTEM\CurrentControlSet\Enum\USB')
    except OSError:
        return None
    with usb:
        i = 0
        while True:
            try:
                dev = winreg.EnumKey(usb, i)
            except OSError:
                break
            i += 1
            if not any(f'VID_{v}' in dev.upper() for v in BOARD_VIDS):
                continue
            with winreg.OpenKey(usb, dev) as dk:
                j = 0
                while True:
                    try:
                        inst = winreg.EnumKey(dk, j)
                    except OSError:
                        break
                    j += 1
                    try:
                        with winreg.OpenKey(dk, inst + r'\Device Parameters') as pk:
                            name = winreg.QueryValueEx(pk, 'PortName')[0]
                    except OSError:
                        continue
                    if name in present:
                        return name
    return None


class SerialPort:
    def __init__(self, name, baud):
        self.handle = k32.CreateFileW('\\\\.\\' + name, GENERIC_READ | GENERIC_WRITE, 0, None, OPEN_EXISTING, 0, None)
        if self.handle == INVALID_HANDLE or self.handle is None:
            err = ctypes.get_last_error()
            reason = {2: 'port not found (board unplugged?)',
                      5: 'access denied: another program is using it (close the Arduino Serial Monitor, '
                         'or click Disconnect in any dashboard tab that used "Connect USB")'}.get(err, f'error {err}')
            raise OSError(f'{name}: {reason}')
        dcb = DCB()
        dcb.DCBlength = ctypes.sizeof(DCB)
        k32.GetCommState(self.handle, ctypes.byref(dcb))
        dcb.BaudRate = baud
        dcb.ByteSize = 8
        dcb.Parity = 0
        dcb.StopBits = 0
        # fBinary only: DTR and RTS stay de-asserted, so the ESP32 auto-reset circuit never fires.
        dcb.fBits = 0x1
        if not k32.SetCommState(self.handle, ctypes.byref(dcb)):
            self.close()
            raise OSError(f'{name}: could not set {baud} baud (error {ctypes.get_last_error()})')
        # Return as soon as any byte arrives, or after 200 ms with nothing.
        t = COMMTIMEOUTS(MAXDWORD, MAXDWORD, 200, 0, 0)
        k32.SetCommTimeouts(self.handle, ctypes.byref(t))
        k32.PurgeComm(self.handle, PURGE_RXCLEAR)

    def read(self):
        buf = ctypes.create_string_buffer(4096)
        n = wt.DWORD(0)
        if not k32.ReadFile(self.handle, buf, 4096, ctypes.byref(n), None):
            raise OSError(f'read failed (error {ctypes.get_last_error()}): board unplugged?')
        return buf.raw[:n.value]

    def close(self):
        if self.handle:
            k32.CloseHandle(self.handle)
            self.handle = None


class Bridge:
    """One reader thread; any number of dashboards subscribe to its lines."""

    def __init__(self, port=None, baud=115200):
        self.fixed_port = port
        self.baud = int(os.environ.get('MINE_SENTINEL_BAUD', baud))
        self.clients = set()
        self.lock = threading.Lock()
        self.status = {'state': 'idle', 'port': None, 'detail': 'waiting for a dashboard', 'baud': self.baud}
        self.thread = None

    def subscribe(self):
        q = queue.Queue(maxsize=500)
        with self.lock:
            self.clients.add(q)
            if not self.thread or not self.thread.is_alive():
                self.thread = threading.Thread(target=self.run, daemon=True)
                self.thread.start()
        return q

    def unsubscribe(self, q):
        with self.lock:
            self.clients.discard(q)

    def publish(self, kind, text):
        with self.lock:
            for q in list(self.clients):
                try:
                    q.put_nowait((kind, text))
                except queue.Full:
                    pass

    def set_status(self, state, port, detail):
        self.status = {'state': state, 'port': port, 'detail': detail, 'baud': self.baud}
        self.publish('status', f'{state}|{port or ""}|{detail}')

    def run(self):
        last_error = None
        while True:
            with self.lock:
                if not self.clients:
                    self.set_status('idle', None, 'waiting for a dashboard')
                    return
            name = self.fixed_port or find_board_port()
            if not name:
                if last_error != 'noboard':
                    self.set_status('searching', None, 'no USB board found: plug in the ESP32 with a data cable')
                    last_error = 'noboard'
                time.sleep(1)
                continue
            try:
                port = SerialPort(name, self.baud)
            except OSError as e:
                if last_error != str(e):
                    self.set_status('error', name, str(e))
                    last_error = str(e)
                time.sleep(2)
                continue
            last_error = None
            self.set_status('open', name, f'reading {name} at {self.baud} baud')
            buffer = b''
            try:
                while True:
                    with self.lock:
                        if not self.clients:
                            break
                    buffer += port.read()
                    *lines, buffer = buffer.split(b'\n')
                    if len(buffer) > 8192:
                        buffer = b''
                    for raw in lines:
                        line = raw.decode('utf-8', errors='replace').strip('\r')
                        if line.strip():
                            self.publish('line', line)
            except OSError as e:
                self.set_status('error', name, str(e))
            finally:
                port.close()
