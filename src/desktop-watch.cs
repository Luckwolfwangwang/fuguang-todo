using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

/// <summary>
/// Tiny foreground-window watcher for 浮光待办.
///
/// Prints "1" when the Windows desktop is the foreground window and "0" when
/// any other application is in front. The todo panel uses this to avoid opening
/// when the user accidentally brushes the left screen edge while working.
///
/// The app passes its own PID as the first argument so this helper exits within
/// a couple of seconds if the main process disappears without killing us.
/// </summary>
internal static class DesktopWatch
{
    [DllImport("user32.dll")]
    private static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetClassName(IntPtr hWnd, StringBuilder lpClassName, int nMaxCount);

    [DllImport("user32.dll")]
    private static extern IntPtr GetShellWindow();

    private static bool IsDesktop(IntPtr hWnd, IntPtr shellWindow)
    {
        if (hWnd == IntPtr.Zero) return false;
        if (hWnd == shellWindow) return true;

        var buffer = new StringBuilder(256);
        if (GetClassName(hWnd, buffer, buffer.Capacity) == 0) return false;
        string name = buffer.ToString();
        return name == "Progman" || name == "WorkerW" || name == "SHELLDLL_DefView";
    }

    private static void Main(string[] args)
    {
        int parentPid = 0;
        if (args.Length > 0)
        {
            int.TryParse(args[0], out parentPid);
        }

        IntPtr shellWindow = GetShellWindow();
        string last = null;
        DateTime lastParentCheck = DateTime.UtcNow;

        while (true)
        {
            if (parentPid != 0 && (DateTime.UtcNow - lastParentCheck).TotalSeconds >= 2)
            {
                lastParentCheck = DateTime.UtcNow;
                try
                {
                    using (Process.GetProcessById(parentPid))
                    {
                    }
                }
                catch
                {
                    return;
                }
            }

            string state = IsDesktop(GetForegroundWindow(), shellWindow) ? "1" : "0";
            if (state != last)
            {
                try
                {
                    Console.Out.WriteLine(state);
                    Console.Out.Flush();
                    last = state;
                }
                catch
                {
                    return;
                }
            }

            Thread.Sleep(250);
        }
    }
}
