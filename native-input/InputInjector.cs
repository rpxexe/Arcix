using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

namespace Arcix.Native
{
    public class InputInjector
    {
        [StructLayout(LayoutKind.Sequential)]
        struct INPUT
        {
            public uint type;
            public InputUnion u;
        }

        [StructLayout(LayoutKind.Explicit)]
        struct InputUnion
        {
            [FieldOffset(0)]
            public MOUSEINPUT mi;
            [FieldOffset(0)]
            public KEYBDINPUT ki;
            [FieldOffset(0)]
            public HARDWAREINPUT hi;
        }

        [StructLayout(LayoutKind.Sequential)]
        struct MOUSEINPUT
        {
            public int dx;
            public int dy;
            public uint mouseData;
            public uint dwFlags;
            public uint time;
            public IntPtr dwExtraInfo;
        }

        [StructLayout(LayoutKind.Sequential)]
        struct KEYBDINPUT
        {
            public ushort wVk;
            public ushort wScan;
            public uint dwFlags;
            public uint time;
            public IntPtr dwExtraInfo;
        }

        [StructLayout(LayoutKind.Sequential)]
        struct HARDWAREINPUT
        {
            public uint uMsg;
            public ushort wParamL;
            public ushort wParamH;
        }

        const uint INPUT_MOUSE = 0;
        const uint INPUT_KEYBOARD = 1;

        const uint MOUSEEVENTF_MOVE = 0x0001;
        const uint MOUSEEVENTF_LEFTDOWN = 0x0002;
        const uint MOUSEEVENTF_LEFTUP = 0x0004;
        const uint MOUSEEVENTF_RIGHTDOWN = 0x0008;
        const uint MOUSEEVENTF_RIGHTUP = 0x0010;
        const uint MOUSEEVENTF_MIDDLEDOWN = 0x0020;
        const uint MOUSEEVENTF_MIDDLEUP = 0x0040;
        const uint MOUSEEVENTF_WHEEL = 0x0800;
        const uint MOUSEEVENTF_ABSOLUTE = 0x8000;

        const uint KEYEVENTF_EXTENDEDKEY = 0x0001;
        const uint KEYEVENTF_KEYUP = 0x0002;
        const uint KEYEVENTF_UNICODE = 0x0004;
        const uint KEYEVENTF_SCANCODE = 0x0008;

        [DllImport("user32.dll", SetLastError = true)]
        static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);

        [DllImport("user32.dll")]
        static extern int GetSystemMetrics(int nIndex);

        const int SM_CXSCREEN = 0;
        const int SM_CYSCREEN = 1;

        [DllImport("user32.dll")]
        static extern uint MapVirtualKey(uint uCode, uint uMapType);

        [DllImport("user32.dll", SetLastError = true)]
        static extern bool SetSystemCursor(IntPtr hcur, uint id);

        [DllImport("user32.dll", SetLastError = true)]
        static extern IntPtr CreateCursor(IntPtr hInst, int xHotSpot, int yHotSpot, int nWidth, int nHeight, byte[] pvANDPlane, byte[] pvXORPlane);

        [DllImport("user32.dll", SetLastError = true)]
        static extern bool SystemParametersInfo(uint uiAction, uint uiParam, IntPtr pvParam, uint fWinIni);

        const uint SPI_SETCURSORS = 0x0057;
        // Standard system cursors (arrow, I-beam, wait, cross, up, sizing, no, hand, app-starting, help)
        static readonly uint[] SystemCursorIds = { 32512, 32513, 32514, 32515, 32516, 32642, 32643, 32644, 32645, 32646, 32648, 32649, 32650, 32651 };

        // Low-level keyboard hook (viewer side): captures keys Windows handles before any app sees them
        delegate IntPtr LowLevelKeyboardProc(int nCode, IntPtr wParam, IntPtr lParam);

        [StructLayout(LayoutKind.Sequential)]
        struct KBDLLHOOKSTRUCT
        {
            public uint vkCode;
            public uint scanCode;
            public uint flags;
            public uint time;
            public IntPtr dwExtraInfo;
        }

        [StructLayout(LayoutKind.Sequential)]
        struct MSG
        {
            public IntPtr hwnd;
            public uint message;
            public IntPtr wParam;
            public IntPtr lParam;
            public uint time;
            public int ptX;
            public int ptY;
        }

        [DllImport("user32.dll", SetLastError = true)]
        static extern IntPtr SetWindowsHookEx(int idHook, LowLevelKeyboardProc lpfn, IntPtr hMod, uint dwThreadId);

        [DllImport("user32.dll")]
        static extern IntPtr CallNextHookEx(IntPtr hhk, int nCode, IntPtr wParam, IntPtr lParam);

        [DllImport("user32.dll")]
        static extern int GetMessage(out MSG lpMsg, IntPtr hWnd, uint wMsgFilterMin, uint wMsgFilterMax);

        [DllImport("user32.dll")]
        static extern IntPtr GetForegroundWindow();

        [DllImport("user32.dll")]
        static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);

        [DllImport("user32.dll")]
        static extern short GetAsyncKeyState(int vKey);

        [DllImport("kernel32.dll")]
        static extern IntPtr GetModuleHandle(string lpModuleName);

        const int WH_KEYBOARD_LL = 13;
        const uint LLKHF_INJECTED = 0x10;
        const uint LLKHF_ALTDOWN = 0x20;
        const uint LLKHF_UP = 0x80;

        static LowLevelKeyboardProc hookProc = HookCallback; // field keeps the delegate alive for the hook
        static Thread hookThread;
        static volatile bool captureEnabled;
        static volatile uint capturePid;

        public static void Main(string[] args)
        {
            Console.OutputEncoding = Encoding.UTF8;
            // Undo a hidden cursor left behind if a previous run was killed mid-session
            RestoreCursors();
            Console.WriteLine("{\"status\":\"ready\",\"message\":\"Arcix Native Input Injector Ready\"}");

            string line;
            while ((line = Console.ReadLine()) != null)
            {
                line = line.Trim();
                if (string.IsNullOrEmpty(line)) continue;
                if (line == "exit" || line.Contains("\"action\":\"exit\"")) break;

                try
                {
                    HandleCommand(line);
                }
                catch (Exception ex)
                {
                    Console.WriteLine("{\"status\":\"error\",\"message\":" + JsonEscape(ex.Message) + "}");
                }
            }
            RestoreCursors();
        }

        static void HideCursors()
        {
            byte[] andMask = new byte[32 * 4];
            byte[] xorMask = new byte[32 * 4];
            for (int i = 0; i < andMask.Length; i++) andMask[i] = 0xFF; // fully transparent
            // SetSystemCursor takes ownership of the handle, so each id needs its own cursor
            foreach (uint id in SystemCursorIds)
                SetSystemCursor(CreateCursor(IntPtr.Zero, 0, 0, 32, 32, andMask, xorMask), id);
        }

        static void RestoreCursors()
        {
            SystemParametersInfo(SPI_SETCURSORS, 0, IntPtr.Zero, 0); // reloads the user's cursor scheme
        }

        // Keys whose scan code carries the E0 prefix; without KEYEVENTF_EXTENDEDKEY arrows/Home/End act as numpad keys
        static bool IsExtendedKey(ushort vk)
        {
            switch (vk)
            {
                case 0x21: case 0x22: case 0x23: case 0x24: // PgUp, PgDn, End, Home
                case 0x25: case 0x26: case 0x27: case 0x28: // arrows
                case 0x2C: case 0x2D: case 0x2E:            // PrintScreen, Insert, Delete
                case 0x5B: case 0x5C: case 0x5D:            // LWin, RWin, Apps
                case 0x6F: case 0x90:                       // Numpad divide, NumLock
                case 0xA3: case 0xA5:                       // RCtrl, RAlt
                case 0xAD: case 0xAE: case 0xAF: case 0xB0: case 0xB1: case 0xB2: case 0xB3: // media keys
                    return true;
            }
            return false;
        }

        static INPUT KeyInput(ushort vk, bool up)
        {
            INPUT input = new INPUT();
            input.type = INPUT_KEYBOARD;
            input.u.ki.wVk = vk;
            // Scan code too: games and raw-input apps ignore events that only carry a virtual key
            input.u.ki.wScan = (ushort)MapVirtualKey(vk, 0);
            input.u.ki.dwFlags = (up ? KEYEVENTF_KEYUP : 0) | (IsExtendedKey(vk) ? KEYEVENTF_EXTENDEDKEY : 0);
            return input;
        }

        static void StartKeyboardHook()
        {
            if (hookThread != null) return;
            hookThread = new Thread(() =>
            {
                SetWindowsHookEx(WH_KEYBOARD_LL, hookProc, GetModuleHandle(null), 0);
                MSG msg;
                while (GetMessage(out msg, IntPtr.Zero, 0, 0) > 0) { }
            });
            hookThread.IsBackground = true;
            hookThread.Start();
        }

        // System shortcuts the OS consumes before the app window gets them
        static bool IsSystemShortcut(KBDLLHOOKSTRUCT k)
        {
            if (k.vkCode == 0x5B || k.vkCode == 0x5C || k.vkCode == 0x2C) return true; // Win keys, PrintScreen
            bool alt = (k.flags & LLKHF_ALTDOWN) != 0;
            if (alt && (k.vkCode == 0x09 || k.vkCode == 0x1B || k.vkCode == 0x73)) return true; // Alt+Tab, Alt+Esc, Alt+F4
            return k.vkCode == 0x1B && (GetAsyncKeyState(0x11) & 0x8000) != 0; // Ctrl+Esc
        }

        static IntPtr HookCallback(int nCode, IntPtr wParam, IntPtr lParam)
        {
            if (nCode >= 0 && captureEnabled)
            {
                KBDLLHOOKSTRUCT k = (KBDLLHOOKSTRUCT)Marshal.PtrToStructure(lParam, typeof(KBDLLHOOKSTRUCT));
                uint pid;
                if ((k.flags & LLKHF_INJECTED) == 0 && IsSystemShortcut(k) &&
                    GetWindowThreadProcessId(GetForegroundWindow(), out pid) != 0 && pid == capturePid)
                {
                    bool up = (k.flags & LLKHF_UP) != 0;
                    Console.WriteLine("{\"event\":\"key\",\"vk\":" + k.vkCode + ",\"up\":" + (up ? "true" : "false") + "}");
                    return (IntPtr)1; // swallow locally; the app forwards it to the remote host
                }
            }
            return CallNextHookEx(IntPtr.Zero, nCode, wParam, lParam);
        }

        // Absolute move from a command's x/y/screen_w/screen_h; false if it carries no coordinates
        static bool MoveTo(string line)
        {
            int screenW = GetSystemMetrics(SM_CXSCREEN);
            int screenH = GetSystemMetrics(SM_CYSCREEN);

            string xStr = ExtractJsonValue(line, "x");
            string yStr = ExtractJsonValue(line, "y");
            string swStr = ExtractJsonValue(line, "screen_w");
            string shStr = ExtractJsonValue(line, "screen_h");

            if (!string.IsNullOrEmpty(swStr)) int.TryParse(swStr, out screenW);
            if (!string.IsNullOrEmpty(shStr)) int.TryParse(shStr, out screenH);

            double x = 0;
            double y = 0;
            if (!double.TryParse(xStr, System.Globalization.NumberStyles.Any, System.Globalization.CultureInfo.InvariantCulture, out x) ||
                !double.TryParse(yStr, System.Globalization.NumberStyles.Any, System.Globalization.CultureInfo.InvariantCulture, out y))
                return false;

            // Map to 0..65535
            INPUT[] inputs = new INPUT[1];
            inputs[0].type = INPUT_MOUSE;
            inputs[0].u.mi.dx = (int)Math.Round((x * 65535.0) / Math.Max(1, screenW - 1));
            inputs[0].u.mi.dy = (int)Math.Round((y * 65535.0) / Math.Max(1, screenH - 1));
            inputs[0].u.mi.dwFlags = MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE;
            SendInput(1, inputs, Marshal.SizeOf(typeof(INPUT)));
            return true;
        }

        static void HandleCommand(string line)
        {
            string action = ExtractJsonValue(line, "action");
            if (string.IsNullOrEmpty(action))
            {
                Console.WriteLine("{\"status\":\"error\",\"message\":\"Missing action\"}");
                return;
            }

            if (action == "ping")
            {
                Console.WriteLine("{\"status\":\"pong\"}");
                return;
            }

            if (action == "mouse_move")
            {
                if (MoveTo(line)) Console.WriteLine("{\"status\":\"ok\",\"action\":\"mouse_move\"}");
                return;
            }

            if (action == "cursor_hide" || action == "cursor_show")
            {
                if (action == "cursor_hide") HideCursors(); else RestoreCursors();
                Console.WriteLine("{\"status\":\"ok\",\"action\":\"" + action + "\"}");
                return;
            }

            if (action == "key_capture")
            {
                uint pid = 0;
                captureEnabled = ExtractJsonValue(line, "enabled") == "true" && uint.TryParse(ExtractJsonValue(line, "pid"), out pid) && pid > 0;
                capturePid = pid;
                if (captureEnabled) StartKeyboardHook();
                Console.WriteLine("{\"status\":\"ok\",\"action\":\"key_capture\"}");
                return;
            }

            if (action == "mouse_down" || action == "mouse_up" || action == "mouse_click")
            {
                // Clicks carry their own position so they land where the user clicked even if a move was dropped
                MoveTo(line);
                string button = ExtractJsonValue(line, "button");
                if (string.IsNullOrEmpty(button)) button = "left";

                uint downFlag = MOUSEEVENTF_LEFTDOWN;
                uint upFlag = MOUSEEVENTF_LEFTUP;

                if (button == "right")
                {
                    downFlag = MOUSEEVENTF_RIGHTDOWN;
                    upFlag = MOUSEEVENTF_RIGHTUP;
                }
                else if (button == "middle")
                {
                    downFlag = MOUSEEVENTF_MIDDLEDOWN;
                    upFlag = MOUSEEVENTF_MIDDLEUP;
                }

                if (action == "mouse_down")
                {
                    INPUT[] inputs = new INPUT[1];
                    inputs[0].type = INPUT_MOUSE;
                    inputs[0].u.mi.dwFlags = downFlag;
                    SendInput(1, inputs, Marshal.SizeOf(typeof(INPUT)));
                }
                else if (action == "mouse_up")
                {
                    INPUT[] inputs = new INPUT[1];
                    inputs[0].type = INPUT_MOUSE;
                    inputs[0].u.mi.dwFlags = upFlag;
                    SendInput(1, inputs, Marshal.SizeOf(typeof(INPUT)));
                }
                else if (action == "mouse_click")
                {
                    INPUT[] inputs = new INPUT[2];
                    inputs[0].type = INPUT_MOUSE;
                    inputs[0].u.mi.dwFlags = downFlag;
                    inputs[1].type = INPUT_MOUSE;
                    inputs[1].u.mi.dwFlags = upFlag;
                    SendInput(2, inputs, Marshal.SizeOf(typeof(INPUT)));
                }

                Console.WriteLine("{\"status\":\"ok\",\"action\":\"" + action + "\"}");
                return;
            }

            if (action == "mouse_wheel")
            {
                string deltaStr = ExtractJsonValue(line, "delta_y");
                int delta = 0;
                if (int.TryParse(deltaStr, out delta))
                {
                    INPUT[] inputs = new INPUT[1];
                    inputs[0].type = INPUT_MOUSE;
                    inputs[0].u.mi.dwFlags = MOUSEEVENTF_WHEEL;
                    inputs[0].u.mi.mouseData = (uint)delta;
                    SendInput(1, inputs, Marshal.SizeOf(typeof(INPUT)));
                    Console.WriteLine("{\"status\":\"ok\",\"action\":\"mouse_wheel\"}");
                }
                return;
            }

            if (action == "key_down" || action == "key_up" || action == "key_press")
            {
                string vkStr = ExtractJsonValue(line, "vk");
                ushort vk = 0;
                if (ushort.TryParse(vkStr, out vk))
                {
                    INPUT[] inputs = action == "key_press"
                        ? new INPUT[] { KeyInput(vk, false), KeyInput(vk, true) }
                        : new INPUT[] { KeyInput(vk, action == "key_up") };
                    SendInput((uint)inputs.Length, inputs, Marshal.SizeOf(typeof(INPUT)));
                    Console.WriteLine("{\"status\":\"ok\",\"action\":\"" + action + "\"}");
                    return;
                }
            }

            if (action == "unicode_text")
            {
                string text = ExtractJsonValue(line, "text");
                if (!string.IsNullOrEmpty(text))
                {
                    INPUT[] inputs = new INPUT[text.Length * 2];
                    for (int i = 0; i < text.Length; i++)
                    {
                        char c = text[i];
                        inputs[i * 2].type = INPUT_KEYBOARD;
                        inputs[i * 2].u.ki.wScan = (ushort)c;
                        inputs[i * 2].u.ki.dwFlags = KEYEVENTF_UNICODE;

                        inputs[i * 2 + 1].type = INPUT_KEYBOARD;
                        inputs[i * 2 + 1].u.ki.wScan = (ushort)c;
                        inputs[i * 2 + 1].u.ki.dwFlags = KEYEVENTF_UNICODE | KEYEVENTF_KEYUP;
                    }
                    SendInput((uint)inputs.Length, inputs, Marshal.SizeOf(typeof(INPUT)));
                    Console.WriteLine("{\"status\":\"ok\",\"action\":\"unicode_text\"}");
                    return;
                }
            }

            Console.WriteLine("{\"status\":\"ignored\",\"action\":\"" + action + "\"}");
        }

        static string ExtractJsonValue(string json, string key)
        {
            string pattern = "\"" + key + "\":";
            int idx = json.IndexOf(pattern);
            if (idx == -1) return null;
            int start = idx + pattern.Length;
            while (start < json.Length && (json[start] == ' ' || json[start] == '\t')) start++;
            if (start >= json.Length) return null;

            if (json[start] == '"')
            {
                start++;
                int end = json.IndexOf('"', start);
                if (end == -1) return null;
                return json.Substring(start, end - start);
            }
            else
            {
                int end = start;
                while (end < json.Length && json[end] != ',' && json[end] != '}' && json[end] != ']') end++;
                return json.Substring(start, end - start).Trim();
            }
        }

        static string JsonEscape(string s)
        {
            if (s == null) return "\"\"";
            StringBuilder sb = new StringBuilder();
            sb.Append('"');
            foreach (char c in s)
            {
                if (c == '"') sb.Append("\\\"");
                else if (c == '\\') sb.Append("\\\\");
                else if (c == '\b') sb.Append("\\b");
                else if (c == '\f') sb.Append("\\f");
                else if (c == '\n') sb.Append("\\n");
                else if (c == '\r') sb.Append("\\r");
                else if (c == '\t') sb.Append("\\t");
                else sb.Append(c);
            }
            sb.Append('"');
            return sb.ToString();
        }
    }
}
