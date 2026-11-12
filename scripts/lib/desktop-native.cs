// Native Windows desktop control for the fxmind desktop tools.
// Ported from the Portspace Agent (internal/ops/vision_windows.go,
// vision_actions_windows.go, uia_windows.go). Compiled at runtime by
// scripts/lib/desktop-host.ps1 with Windows PowerShell 5.1 (Add-Type), so the
// tools need no npm package, no download and no extra binary.
//
// Validation of tool arguments lives in scripts/desktop-agent.js; this file
// only executes and keeps the native safety checks (screen bounds, key release,
// held-button release, UIA ambiguity).
using System;
using System.Collections;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Windows.Automation;

namespace FxmindDesktop
{
    public static class Native
    {
        [StructLayout(LayoutKind.Sequential)]
        public struct RECT { public int Left, Top, Right, Bottom; }

        [StructLayout(LayoutKind.Sequential)]
        struct MOUSEINPUT { public int dx, dy; public uint mouseData, dwFlags, time; public IntPtr dwExtraInfo; }

        [StructLayout(LayoutKind.Sequential)]
        struct KEYBDINPUT { public ushort wVk, wScan; public uint dwFlags, time; public IntPtr dwExtraInfo; }

        [StructLayout(LayoutKind.Explicit)]
        struct InputUnion { [FieldOffset(0)] public MOUSEINPUT mi; [FieldOffset(0)] public KEYBDINPUT ki; }

        [StructLayout(LayoutKind.Sequential)]
        struct INPUT { public uint type; public InputUnion u; }

        delegate bool EnumProc(IntPtr hwnd, IntPtr lParam);

        [DllImport("user32.dll")] static extern int GetSystemMetrics(int index);
        [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
        [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr hwnd, out RECT rect);
        [DllImport("user32.dll", SetLastError = true)] static extern bool SetCursorPos(int x, int y);
        [DllImport("user32.dll", SetLastError = true)] static extern uint SendInput(uint count, INPUT[] inputs, int size);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowTextW(IntPtr hwnd, StringBuilder text, int max);
        [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
        [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hwnd);
        [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr hwnd);
        [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr hwnd, int cmd);
        [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc callback, IntPtr lParam);
        [DllImport("user32.dll")] static extern IntPtr GetDC(IntPtr hwnd);
        [DllImport("user32.dll")] static extern int ReleaseDC(IntPtr hwnd, IntPtr dc);
        [DllImport("user32.dll")] static extern bool SetProcessDPIAware();
        [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr value);
        [DllImport("gdi32.dll")] static extern IntPtr CreateCompatibleDC(IntPtr dc);
        [DllImport("gdi32.dll")] static extern bool DeleteDC(IntPtr dc);
        [DllImport("gdi32.dll")] static extern IntPtr CreateCompatibleBitmap(IntPtr dc, int width, int height);
        [DllImport("gdi32.dll")] static extern IntPtr SelectObject(IntPtr dc, IntPtr obj);
        [DllImport("gdi32.dll")] static extern bool DeleteObject(IntPtr obj);
        [DllImport("gdi32.dll")] static extern int SetStretchBltMode(IntPtr dc, int mode);
        [DllImport("gdi32.dll")] static extern bool StretchBlt(IntPtr dst, int x, int y, int w, int h, IntPtr src, int sx, int sy, int sw, int sh, uint rop);

        const uint INPUT_MOUSE = 0, INPUT_KEYBOARD = 1;
        const uint MOUSE_LEFT_DOWN = 0x0002, MOUSE_LEFT_UP = 0x0004;
        const uint MOUSE_RIGHT_DOWN = 0x0008, MOUSE_RIGHT_UP = 0x0010, MOUSE_WHEEL = 0x0800;
        const uint KEY_UNICODE = 0x0004, KEY_UP = 0x0002;

        // Coordinates are physical desktop pixels, as in the Portspace Agent.
        public static void Init()
        {
            try { if (SetProcessDpiAwarenessContext(new IntPtr(-4))) return; } catch (EntryPointNotFoundException) { }
            try { SetProcessDPIAware(); } catch (EntryPointNotFoundException) { }
        }

        public static RECT VirtualScreen()
        {
            int x = GetSystemMetrics(76), y = GetSystemMetrics(77);
            return new RECT { Left = x, Top = y, Right = x + GetSystemMetrics(78), Bottom = y + GetSystemMetrics(79) };
        }

        public static Dictionary<string, object> Screen()
        {
            RECT r = VirtualScreen();
            return new Dictionary<string, object> { { "left", r.Left }, { "top", r.Top }, { "right", r.Right }, { "bottom", r.Bottom } };
        }

        static bool ValidPoint(int x, int y)
        {
            RECT r = VirtualScreen();
            return x >= r.Left && x < r.Right && y >= r.Top && y < r.Bottom;
        }

        static RECT ScreenRect(string kind)
        {
            RECT full = VirtualScreen();
            if (kind == "all") return full;
            if (kind != "active") throw new Exception("screen must be all or active");
            IntPtr hwnd = GetForegroundWindow();
            RECT r;
            if (hwnd == IntPtr.Zero || !GetWindowRect(hwnd, out r) || r.Right - r.Left <= 0 || r.Bottom - r.Top <= 0)
                throw new Exception("active window unavailable");
            // Clamp the foreground window to the virtual desktop.
            r.Left = Math.Max(r.Left, full.Left);
            r.Top = Math.Max(r.Top, full.Top);
            r.Right = Math.Min(r.Right, full.Right);
            r.Bottom = Math.Min(r.Bottom, full.Bottom);
            if (r.Right - r.Left <= 0 || r.Bottom - r.Top <= 0) throw new Exception("active window is off screen");
            return r;
        }

        // Scaled GDI grab straight into memory; nothing is written to disk.
        public static Dictionary<string, object> Capture(string screen, int maxWidth, int quality)
        {
            RECT rect = ScreenRect(screen);
            int sw = rect.Right - rect.Left, sh = rect.Bottom - rect.Top;
            if (sw <= 0 || sh <= 0 || sw > 16000 || sh > 16000) throw new Exception("invalid screen resolution");
            int width = Math.Min(maxWidth, sw);
            int height = Math.Max(1, (int)Math.Round((double)sh * width / sw));
            if ((long)width * height > 16000000) throw new Exception("image exceeds the pixel limit");

            IntPtr dc = GetDC(IntPtr.Zero);
            if (dc == IntPtr.Zero) throw new Exception("desktop unavailable; an interactive session is required");
            byte[] jpeg;
            try
            {
                IntPtr mem = CreateCompatibleDC(dc);
                if (mem == IntPtr.Zero) throw new Exception("CreateCompatibleDC failed");
                try
                {
                    IntPtr bitmap = CreateCompatibleBitmap(dc, width, height);
                    if (bitmap == IntPtr.Zero) throw new Exception("CreateCompatibleBitmap failed");
                    try
                    {
                        IntPtr old = SelectObject(mem, bitmap);
                        if (old == IntPtr.Zero) throw new Exception("SelectObject failed");
                        SetStretchBltMode(mem, 4); // HALFTONE
                        bool copied = StretchBlt(mem, 0, 0, width, height, dc, rect.Left, rect.Top, sw, sh, 0x00CC0020); // SRCCOPY
                        SelectObject(mem, old);
                        if (!copied) throw new Exception("StretchBlt failed (screen unavailable)");
                        using (Bitmap image = Image.FromHbitmap(bitmap))
                        using (MemoryStream stream = new MemoryStream())
                        {
                            ImageCodecInfo codec = null;
                            foreach (ImageCodecInfo c in ImageCodecInfo.GetImageEncoders())
                                if (c.MimeType == "image/jpeg") codec = c;
                            EncoderParameters options = new EncoderParameters(1);
                            options.Param[0] = new EncoderParameter(System.Drawing.Imaging.Encoder.Quality, (long)quality);
                            image.Save(stream, codec, options);
                            jpeg = stream.ToArray();
                        }
                    }
                    finally { DeleteObject(bitmap); }
                }
                finally { DeleteDC(mem); }
            }
            finally { ReleaseDC(IntPtr.Zero, dc); }

            if (jpeg.Length > 3750000) throw new Exception("capture exceeded the maximum size");
            return new Dictionary<string, object> {
                { "data", Convert.ToBase64String(jpeg) }, { "mimeType", "image/jpeg" },
                { "width", width }, { "height", height },
                { "originX", rect.Left }, { "originY", rect.Top },
                { "sourceWidth", sw }, { "sourceHeight", sh }, { "screen", screen },
            };
        }

        static INPUT Mouse(uint flags, uint data)
        {
            INPUT input = new INPUT { type = INPUT_MOUSE };
            input.u.mi.dwFlags = flags;
            input.u.mi.mouseData = data;
            return input;
        }

        static INPUT Unicode(ushort unit, uint flags)
        {
            INPUT input = new INPUT { type = INPUT_KEYBOARD };
            input.u.ki.wScan = unit;
            input.u.ki.dwFlags = flags | KEY_UNICODE;
            return input;
        }

        static INPUT VirtualKey(ushort vk, bool up)
        {
            INPUT input = new INPUT { type = INPUT_KEYBOARD };
            input.u.ki.wVk = vk;
            if (up) input.u.ki.dwFlags = KEY_UP;
            return input;
        }

        static void Send(params INPUT[] inputs)
        {
            if (inputs.Length == 0) return;
            uint sent = SendInput((uint)inputs.Length, inputs, Marshal.SizeOf(typeof(INPUT)));
            if (sent != inputs.Length)
                throw new Exception(string.Format("SendInput sent {0}/{1} events (error {2}); the interactive desktop or UAC may block input",
                    sent, inputs.Length, Marshal.GetLastWin32Error()));
        }

        static void MoveCursor(int x, int y)
        {
            if (!ValidPoint(x, y)) throw new Exception("coordinates outside the screen area");
            if (!SetCursorPos(x, y)) throw new Exception("SetCursorPos failed: error " + Marshal.GetLastWin32Error());
        }

        static void Buttons(string button, out uint down, out uint up)
        {
            if (button == "right") { down = MOUSE_RIGHT_DOWN; up = MOUSE_RIGHT_UP; }
            else if (button == "left" || string.IsNullOrEmpty(button)) { down = MOUSE_LEFT_DOWN; up = MOUSE_LEFT_UP; }
            else throw new Exception("button must be left or right");
        }

        public static Dictionary<string, object> Click(int x, int y, string button)
        {
            uint down, up;
            Buttons(button, out down, out up);
            MoveCursor(x, y);
            Send(Mouse(down, 0), Mouse(up, 0));
            return new Dictionary<string, object> { { "clicked", true } };
        }

        public static Dictionary<string, object> TypeText(string text)
        {
            // Small batches cap memory use, as in the Agent.
            for (int i = 0; i < text.Length; i += 64)
            {
                int end = Math.Min(i + 64, text.Length);
                List<INPUT> batch = new List<INPUT>((end - i) * 2);
                for (int j = i; j < end; j++)
                {
                    batch.Add(Unicode(text[j], 0));
                    batch.Add(Unicode(text[j], KEY_UP));
                }
                Send(batch.ToArray());
            }
            return new Dictionary<string, object> { { "typed", true } };
        }

        public static Dictionary<string, object> Scroll(int delta)
        {
            Send(Mouse(MOUSE_WHEEL, unchecked((uint)delta)));
            return new Dictionary<string, object> { { "scrolled", true } };
        }

        // A real held-button movement; the button is always released.
        public static Dictionary<string, object> Drag(int x, int y, int toX, int toY, int durationMs, string button)
        {
            if (!ValidPoint(x, y) || !ValidPoint(toX, toY)) throw new Exception("drag start or end is off screen");
            uint down, up;
            Buttons(button, out down, out up);
            MoveCursor(x, y);
            bool released = false;
            try
            {
                Send(Mouse(down, 0));
                int steps = Math.Max(2, Math.Min(120, durationMs / 25));
                for (int i = 1; i <= steps; i++)
                {
                    Thread.Sleep(durationMs / steps);
                    MoveCursor(x + (toX - x) * i / steps, y + (toY - y) * i / steps);
                }
                Send(Mouse(up, 0));
                released = true;
            }
            finally
            {
                if (!released) Send(Mouse(up, 0));
            }
            return new Dictionary<string, object> {
                { "dispatched", true }, { "verified", false },
                { "from", new int[] { x, y } }, { "to", new int[] { toX, toY } },
            };
        }

        // Presses the keys in order and always releases them in reverse order.
        public static void PressChord(int[] keys)
        {
            List<ushort> held = new List<ushort>();
            Exception failure = null;
            try
            {
                foreach (int vk in keys)
                {
                    held.Add((ushort)vk);
                    Send(VirtualKey((ushort)vk, false));
                }
            }
            catch (Exception error) { failure = error; }
            finally
            {
                for (int i = held.Count - 1; i >= 0; i--)
                {
                    try { Send(VirtualKey(held[i], true)); }
                    catch (Exception error) { if (failure == null) failure = error; }
                }
            }
            if (failure != null) throw failure;
        }

        public static Dictionary<string, object> Hover(int x, int y)
        {
            MoveCursor(x, y);
            return new Dictionary<string, object> { { "dispatched", true }, { "verified", false } };
        }

        public static Dictionary<string, object> DoubleClick(int x, int y)
        {
            MoveCursor(x, y);
            for (int i = 0; i < 2; i++)
            {
                try { Send(Mouse(MOUSE_LEFT_DOWN, 0), Mouse(MOUSE_LEFT_UP, 0)); }
                catch
                {
                    try { Send(Mouse(MOUSE_LEFT_UP, 0)); } catch { }
                    throw;
                }
                if (i == 0) Thread.Sleep(75);
            }
            return new Dictionary<string, object> { { "dispatched", true }, { "verified", false } };
        }

        static Dictionary<string, object> WindowState(IntPtr hwnd)
        {
            StringBuilder title = new StringBuilder(512);
            int n = GetWindowTextW(hwnd, title, title.Capacity);
            uint pid;
            GetWindowThreadProcessId(hwnd, out pid);
            RECT r;
            GetWindowRect(hwnd, out r);
            return new Dictionary<string, object> {
                { "hwnd", (ulong)hwnd.ToInt64() }, { "title", title.ToString(0, Math.Max(0, n)) },
                { "pid", pid }, { "active", GetForegroundWindow() == hwnd },
                { "left", r.Left }, { "top", r.Top },
                { "width", r.Right - r.Left }, { "height", r.Bottom - r.Top },
            };
        }

        static Dictionary<string, object> FindWindowBy(string title, uint pid)
        {
            Dictionary<string, object> match = null;
            string wanted = (title ?? "").Trim().ToLowerInvariant();
            EnumWindows(delegate (IntPtr hwnd, IntPtr unused)
            {
                if (!IsWindowVisible(hwnd)) return true;
                Dictionary<string, object> candidate = WindowState(hwnd);
                string name = (string)candidate["title"];
                if (name == "" || (int)candidate["width"] <= 0 || (int)candidate["height"] <= 0) return true;
                if ((pid != 0 && (uint)candidate["pid"] != pid) || (wanted != "" && !name.ToLowerInvariant().Contains(wanted))) return true;
                match = candidate;
                return false;
            }, IntPtr.Zero);
            return match;
        }

        public static Dictionary<string, object> Foreground()
        {
            IntPtr hwnd = GetForegroundWindow();
            return hwnd == IntPtr.Zero ? null : WindowState(hwnd);
        }

        public static Dictionary<string, object> WindowInfo(string title, uint pid)
        {
            if (string.IsNullOrEmpty(title) && pid == 0)
            {
                Dictionary<string, object> active = Foreground();
                if (active == null) throw new Exception("no active window");
                return active;
            }
            Dictionary<string, object> info = FindWindowBy(title, pid);
            if (info == null) throw new Exception("window not found");
            return info;
        }

        public static Dictionary<string, object> Activate(string title, uint pid, int timeoutMs)
        {
            DateTime deadline = DateTime.UtcNow.AddMilliseconds(timeoutMs);
            while (true)
            {
                Dictionary<string, object> info = FindWindowBy(title, pid);
                if (info != null)
                {
                    IntPtr hwnd = new IntPtr((long)(ulong)info["hwnd"]);
                    ShowWindow(hwnd, 9); // SW_RESTORE
                    SetForegroundWindow(hwnd);
                    if (GetForegroundWindow() == hwnd)
                    {
                        info["active"] = true;
                        return info;
                    }
                }
                if (DateTime.UtcNow > deadline) throw new Exception("window not found or Windows denied focus");
                Thread.Sleep(100);
            }
        }

        // ---- Windows UI Automation: background control, no input, no focus ----

        static Dictionary<string, object> Describe(AutomationElement element)
        {
            string name = "", id = "";
            int type = 0;
            bool enabled = false;
            try { name = element.Current.Name ?? ""; } catch { }
            try { id = element.Current.AutomationId ?? ""; } catch { }
            try { type = element.Current.ControlType.Id; } catch { }
            try { enabled = element.Current.IsEnabled; } catch { }
            Dictionary<string, object> control = new Dictionary<string, object> { { "name", name } };
            if (id != "") control["automationId"] = id;
            control["controlType"] = type;
            control["enabled"] = enabled;
            return control;
        }

        static AutomationElement UiaRoot(string title, uint pid, out Dictionary<string, object> window)
        {
            if (string.IsNullOrWhiteSpace(title) && pid == 0) throw new Exception("windowTitle or pid is required");
            window = FindWindowBy(title, pid);
            if (window == null) throw new Exception("target window not found");
            AutomationElement root = AutomationElement.FromHandle(new IntPtr((long)(ulong)window["hwnd"]));
            if (root == null) throw new Exception("window is not exposed to UI Automation");
            return root;
        }

        // Search is bounded to the target window (depth 5), never the whole desktop.
        // visit returns true to stop the walk.
        static int Walk(AutomationElement root, int limit, Func<AutomationElement, Dictionary<string, object>, bool> visit)
        {
            int count = 0;
            if (visit(root, Describe(root))) return count;
            bool stop = false;
            Action<AutomationElement, int> walk = null;
            walk = delegate (AutomationElement parent, int depth)
            {
                if (stop || depth > 5 || count >= limit) return;
                AutomationElementCollection children = parent.FindAll(TreeScope.Children, Condition.TrueCondition);
                if (children == null) return;
                if (children.Count > 512) throw new Exception("UIA: tree too large; refine the selector");
                for (int i = 0; i < children.Count && count < limit && !stop; i++)
                {
                    AutomationElement child = children[i];
                    if (child == null) continue;
                    Dictionary<string, object> description = Describe(child);
                    count++;
                    if (visit(child, description)) { stop = true; return; }
                    walk(child, depth + 1);
                }
            };
            walk(root, 0);
            return count;
        }

        public static Dictionary<string, object> UiaInspect(string title, uint pid, int limit)
        {
            Dictionary<string, object> window;
            AutomationElement root = UiaRoot(title, pid, out window);
            List<Dictionary<string, object>> controls = new List<Dictionary<string, object>>();
            int count = Walk(root, limit, delegate (AutomationElement element, Dictionary<string, object> control)
            {
                if ((string)control["name"] != "" || control.ContainsKey("automationId")) controls.Add(control);
                return false;
            });
            return new Dictionary<string, object> {
                { "window", window }, { "controls", controls }, { "scanned", count },
                { "limited", count >= limit }, { "backend", "uia" }, { "requiresFocus", false },
            };
        }

        static bool Matches(string name, string automationId, int controlType, Dictionary<string, object> control)
        {
            string id = control.ContainsKey("automationId") ? (string)control["automationId"] : "";
            return (name == "" || string.Equals(name, (string)control["name"], StringComparison.OrdinalIgnoreCase)) &&
                (automationId == "" || automationId == id) &&
                (controlType == 0 || controlType == (int)control["controlType"]);
        }

        // Fails closed when the selector is ambiguous.
        static AutomationElement Locate(AutomationElement root, string name, string automationId, int controlType, out Dictionary<string, object> chosen)
        {
            AutomationElement match = null;
            Dictionary<string, object> found = null;
            int matches = 0;
            Walk(root, 400, delegate (AutomationElement element, Dictionary<string, object> control)
            {
                if (!Matches(name, automationId, controlType, control)) return false;
                matches++;
                if (matches == 1) { match = element; found = control; return false; }
                return true;
            });
            chosen = found;
            if (matches > 1) throw new Exception("ambiguous control: refine automationId/controlType");
            if (match == null) throw new Exception("control not found or not exposed by UIA");
            return match;
        }

        public static Dictionary<string, object> UiaTask(string title, uint pid, string[] ops, string[] names, string[] ids, int[] types, string[] values, int[] timeouts)
        {
            Stopwatch clock = Stopwatch.StartNew();
            Dictionary<string, object> window;
            AutomationElement root = UiaRoot(title, pid, out window);
            int completed = 0, verified = 0;
            for (int i = 0; i < ops.Length; i++)
            {
                string op = ops[i];
                Dictionary<string, object> control;
                if (op == "wait_for")
                {
                    DateTime deadline = DateTime.UtcNow.AddMilliseconds(timeouts[i]);
                    while (true)
                    {
                        try { Locate(root, names[i], ids[i], types[i], out control); break; }
                        catch (Exception error)
                        {
                            if (DateTime.UtcNow > deadline)
                                throw new Exception(string.Format("step {0}: wait_for timed out: {1}", i + 1, error.Message));
                        }
                        Thread.Sleep(100);
                    }
                }
                else
                {
                    AutomationElement element;
                    try { element = Locate(root, names[i], ids[i], types[i], out control); }
                    catch (Exception error) { throw new Exception(string.Format("step {0}: {1} (completed {2})", i + 1, error.Message, completed)); }
                    if (!(bool)control["enabled"] && op != "assert_exists")
                        throw new Exception(string.Format("step {0}: control is disabled", i + 1));
                    try
                    {
                        if (op == "invoke") Invoke(element);
                        else if (op == "set_value") SetValue(element, values[i]);
                    }
                    catch (Exception error) { throw new Exception(string.Format("step {0}: {1} (completed {2})", i + 1, error.Message, completed)); }
                }
                completed++;
                if (op != "invoke") verified++;
            }
            return new Dictionary<string, object> {
                { "window", window }, { "dispatched", completed }, { "checked", verified },
                { "verified", verified == completed }, { "background", true }, { "backend", "uia" },
                { "elapsedMs", clock.ElapsedMilliseconds },
            };
        }

        static void Invoke(AutomationElement element)
        {
            object pattern;
            if (!element.TryGetCurrentPattern(InvokePattern.Pattern, out pattern) || pattern == null)
                throw new Exception("UIA pattern not supported by the control");
            ((InvokePattern)pattern).Invoke();
        }

        static void SetValue(AutomationElement element, string value)
        {
            object pattern;
            if (!element.TryGetCurrentPattern(ValuePattern.Pattern, out pattern) || pattern == null)
                throw new Exception("UIA pattern not supported by the control");
            ValuePattern valuePattern = (ValuePattern)pattern;
            valuePattern.SetValue(value);
            string actual;
            try { actual = valuePattern.Current.Value; }
            catch (Exception error) { throw new Exception("value sent, but confirmation failed: " + error.Message); }
            if (actual != value) throw new Exception("value sent, but the UIA read-back does not match");
        }
    }
}
