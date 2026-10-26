using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;

namespace AeroDesk.Native
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

        public static void Main(string[] args)
        {
            Console.OutputEncoding = Encoding.UTF8;
            Console.WriteLine("{\"status\":\"ready\",\"message\":\"AeroDesk Native Input Injector Ready\"}");

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
                if (double.TryParse(xStr, System.Globalization.NumberStyles.Any, System.Globalization.CultureInfo.InvariantCulture, out x) &&
                    double.TryParse(yStr, System.Globalization.NumberStyles.Any, System.Globalization.CultureInfo.InvariantCulture, out y))
                {
                    // Map to 0..65535
                    int normX = (int)Math.Round((x * 65535.0) / Math.Max(1, screenW - 1));
                    int normY = (int)Math.Round((y * 65535.0) / Math.Max(1, screenH - 1));

                    INPUT[] inputs = new INPUT[1];
                    inputs[0].type = INPUT_MOUSE;
                    inputs[0].u.mi.dx = normX;
                    inputs[0].u.mi.dy = normY;
                    inputs[0].u.mi.dwFlags = MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE;

                    SendInput(1, inputs, Marshal.SizeOf(typeof(INPUT)));
                    Console.WriteLine("{\"status\":\"ok\",\"action\":\"mouse_move\"}");
                }
                return;
            }

            if (action == "mouse_down" || action == "mouse_up" || action == "mouse_click")
            {
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
                    if (action == "key_down")
                    {
                        INPUT[] inputs = new INPUT[1];
                        inputs[0].type = INPUT_KEYBOARD;
                        inputs[0].u.ki.wVk = vk;
                        SendInput(1, inputs, Marshal.SizeOf(typeof(INPUT)));
                    }
                    else if (action == "key_up")
                    {
                        INPUT[] inputs = new INPUT[1];
                        inputs[0].type = INPUT_KEYBOARD;
                        inputs[0].u.ki.wVk = vk;
                        inputs[0].u.ki.dwFlags = KEYEVENTF_KEYUP;
                        SendInput(1, inputs, Marshal.SizeOf(typeof(INPUT)));
                    }
                    else if (action == "key_press")
                    {
                        INPUT[] inputs = new INPUT[2];
                        inputs[0].type = INPUT_KEYBOARD;
                        inputs[0].u.ki.wVk = vk;
                        inputs[1].type = INPUT_KEYBOARD;
                        inputs[1].u.ki.wVk = vk;
                        inputs[1].u.ki.dwFlags = KEYEVENTF_KEYUP;
                        SendInput(2, inputs, Marshal.SizeOf(typeof(INPUT)));
                    }
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
