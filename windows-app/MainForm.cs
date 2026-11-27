using System.Net;
using System.Text.Json;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;
using Microsoft.Win32;

namespace FloatingLyrics;

/// <summary>
/// Ventana sin bordes, transparente y siempre encima que muestra la tarjeta de letras.
/// La tarjeta se dibuja con HTML/CSS/JS (igual que en la extensión) dentro de WebView2.
/// </summary>
public sealed class MainForm : Form
{
    private const int HotkeyId = 1;
    private const string RunKey = @"Software\Microsoft\Windows\CurrentVersion\Run";
    private const string RunValue = "LetrasFlotantes";
    private static readonly HashSet<string> AllowedHosts = new(StringComparer.OrdinalIgnoreCase) { "lrclib.net", "music.163.com" };
    private static readonly JsonSerializerOptions Json = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };

    private readonly WebView2 _web = new() { Dock = DockStyle.Fill, DefaultBackgroundColor = Color.Transparent };
    private readonly NotifyIcon _tray = new();
    private readonly MediaWatcher _media = new();
    private readonly HttpClient _http;
    private readonly AppSettings _settings = AppSettings.Load();
    private CoreWebView2Environment? _env;
    private ToolStripMenuItem _miShow = null!, _miGhost = null!, _miStartup = null!;
    private bool _pageReady;
    private MediaState? _lastMedia;
    private object? _lastArt;
    private bool _exiting;

    public MainForm()
    {
        Text = "Letras Flotantes";
        FormBorderStyle = FormBorderStyle.None;
        ShowInTaskbar = false;
        TopMost = true;
        StartPosition = FormStartPosition.Manual;
        BackColor = Color.Black; // con el marco extendido de DWM, el negro se vuelve transparente
        Icon = LoadAppIcon();
        Size = new Size(Px(418), Px(170));
        Controls.Add(_web);

        // Sin cookies (como la extensión): con las cookies que NetEase envía en la primera respuesta,
        // las búsquedas siguientes devuelven listas recortadas y no se encuentran las letras.
        _http = new HttpClient(new HttpClientHandler { AutomaticDecompression = DecompressionMethods.All, UseCookies = false })
        {
            Timeout = TimeSpan.FromSeconds(15),
        };
        _http.DefaultRequestHeaders.UserAgent.ParseAdd("LetrasFlotantes/1.0 (Windows app)");

        BuildTray();
        PlaceWindow();
    }

    // Oculta la ventana de la barra de tareas y de Alt+Tab (se maneja desde la bandeja del sistema).
    protected override CreateParams CreateParams
    {
        get
        {
            var cp = base.CreateParams;
            cp.ExStyle |= Native.WS_EX_TOOLWINDOW;
            return cp;
        }
    }

    private int Px(double cssPx) => (int)Math.Ceiling(cssPx * DeviceDpi / 96.0);

    protected override void OnHandleCreated(EventArgs e)
    {
        base.OnHandleCreated(e);
        // Ventana con transparencia real: sin borde ni esquinas del sistema y con el marco de DWM
        // extendido a todo el área, para que lo transparente de la página deje ver el escritorio.
        Native.SetDwm(Handle, Native.DWMWA_USE_IMMERSIVE_DARK_MODE, 1);
        Native.SetDwm(Handle, Native.DWMWA_WINDOW_CORNER_PREFERENCE, 1);
        Native.SetDwm(Handle, Native.DWMWA_BORDER_COLOR, unchecked((int)0xFFFFFFFE));
        Native.SetDwm(Handle, Native.DWMWA_SYSTEMBACKDROP_TYPE, 1);
        var margins = new Native.MARGINS { Left = -1, Right = -1, Top = -1, Bottom = -1 };
        Native.DwmExtendFrameIntoClientArea(Handle, ref margins);

        Native.RegisterHotKey(Handle, HotkeyId, Native.MOD_CONTROL | Native.MOD_ALT | Native.MOD_NOREPEAT, (uint)Keys.L);
    }

    protected override async void OnLoad(EventArgs e)
    {
        base.OnLoad(e);
        if (_settings.Hidden) BeginInvoke(new Action(() => SetShown(false)));
        try
        {
            await InitWebAsync();
        }
        catch (Exception ex)
        {
            MessageBox.Show("No se pudo iniciar el componente WebView2 de Microsoft Edge.\n\n" + ex.Message,
                "Letras Flotantes", MessageBoxButtons.OK, MessageBoxIcon.Error);
            ExitApp();
            return;
        }

        _media.Changed += state => RunOnUi(() => { _lastMedia = state; PostMedia(); });
        _media.ArtworkChanged += (title, artist, data) => RunOnUi(() =>
        {
            Log($"carátula: «{title}» ({data.Length / 1024} KB)");
            _lastArt = new { type = "art", title, artist, data };
            if (_pageReady) Post(_lastArt);
        });
        try { await _media.StartAsync(); }
        catch (Exception ex)
        {
            MessageBox.Show("No se pudo leer la música de Windows.\n\n" + ex.Message, "Letras Flotantes",
                MessageBoxButtons.OK, MessageBoxIcon.Warning);
        }
    }

    private void RunOnUi(Action a)
    {
        if (IsDisposed || !IsHandleCreated) return;
        try { BeginInvoke(a); } catch (InvalidOperationException) { }
    }

    // ---------------- WebView2 ----------------

    private async Task InitWebAsync()
    {
        string dataDir = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "FloatingLyrics", "WebView2");
        _env = await CoreWebView2Environment.CreateAsync(null, dataDir);
        await _web.EnsureCoreWebView2Async(_env);
        var core = _web.CoreWebView2;
        core.Settings.AreDefaultContextMenusEnabled = false;
        core.Settings.IsStatusBarEnabled = false;
        core.Settings.IsZoomControlEnabled = false;
        core.Settings.AreBrowserAcceleratorKeysEnabled = false;
#if DEBUG
        core.Settings.AreDevToolsEnabled = true;
#else
        core.Settings.AreDevToolsEnabled = false;
#endif
        core.AddWebResourceRequestedFilter("https://app.local/*", CoreWebView2WebResourceContext.All);
        core.WebResourceRequested += OnWebResource;
        core.WebMessageReceived += OnWebMessage;
        core.NavigationCompleted += (_, e) => Log($"navegación: ok={e.IsSuccess} estado={e.WebErrorStatus} http={e.HttpStatusCode}");
        Log("WebView2 listo, versión " + _env.BrowserVersionString);
        core.Navigate("https://app.local/index.html");
    }

    // Registro de diagnóstico en %LOCALAPPDATA%\FloatingLyrics\log.txt
    internal static void Log(string text)
    {
        try
        {
            string dir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "FloatingLyrics");
            Directory.CreateDirectory(dir);
            File.AppendAllText(Path.Combine(dir, "log.txt"), $"{DateTime.Now:HH:mm:ss} {text}{Environment.NewLine}");
        }
        catch { }
    }

    // Sirve la interfaz desde los recursos incrustados en el .exe.
    private void OnWebResource(object? sender, CoreWebView2WebResourceRequestedEventArgs e)
    {
        string name = new Uri(e.Request.Uri).AbsolutePath.TrimStart('/');
        if (name.Length == 0) name = "index.html";
        var stream = typeof(MainForm).Assembly.GetManifestResourceStream("web." + name);
        if (stream == null)
        {
            e.Response = _env!.CreateWebResourceResponse(null, 404, "Not Found", "");
            return;
        }
        string type = Path.GetExtension(name).ToLowerInvariant() switch
        {
            ".html" => "text/html; charset=utf-8",
            ".js" => "text/javascript; charset=utf-8",
            ".css" => "text/css; charset=utf-8",
            ".png" => "image/png",
            _ => "application/octet-stream",
        };
        e.Response = _env!.CreateWebResourceResponse(stream, 200, "OK", $"Content-Type: {type}\r\nCache-Control: no-store");
    }

    private void Post(object message)
    {
        try { _web.CoreWebView2?.PostWebMessageAsJson(JsonSerializer.Serialize(message, Json)); } catch { }
    }

    private void PostMedia()
    {
        if (!_pageReady) return;
        Post(new { type = "media", state = _lastMedia });
    }

    private void OnWebMessage(object? sender, CoreWebView2WebMessageReceivedEventArgs e)
    {
        JsonElement msg;
        try { msg = JsonDocument.Parse(e.WebMessageAsJson).RootElement; } catch { return; }
        string type = msg.TryGetProperty("type", out var t) ? t.GetString() ?? "" : "";
        switch (type)
        {
            case "ready":
                _pageReady = true;
                PostMedia();
                if (_lastArt != null) Post(_lastArt);
                break;
            case "fetch":
                _ = FetchForPageAsync(msg);
                break;
            case "size":
                ApplySize(msg.GetProperty("w").GetDouble(), msg.GetProperty("h").GetDouble());
                break;
            case "drag":
                // Arrastrar la ventana desde la cabecera de la tarjeta.
                Native.ReleaseCapture();
                Native.SendMessage(Handle, Native.WM_NCLBUTTONDOWN, (IntPtr)Native.HTCAPTION, IntPtr.Zero);
                KeepOnScreen();
                SavePosition();
                break;
            case "seek":
                _ = _media.SeekAsync(msg.GetProperty("time").GetDouble());
                break;
            case "ghost":
                _miGhost.Checked = msg.GetProperty("on").GetBoolean();
                break;
            case "log":
                Log("página: " + (msg.TryGetProperty("text", out var lt) ? lt.GetString() : ""));
                break;
        }
    }

    // La página pide las letras a través de la app (evita las restricciones CORS del navegador).
    private async Task FetchForPageAsync(JsonElement msg)
    {
        int id = msg.GetProperty("id").GetInt32();
        string url = msg.GetProperty("url").GetString() ?? "";
        try
        {
            var uri = new Uri(url);
            if (uri.Scheme != Uri.UriSchemeHttps || !AllowedHosts.Contains(uri.Host))
                throw new InvalidOperationException("Dirección no permitida");
            using var req = new HttpRequestMessage(HttpMethod.Get, uri);
            if (msg.TryGetProperty("headers", out var headers) && headers.ValueKind == JsonValueKind.Object)
                foreach (var h in headers.EnumerateObject())
                    req.Headers.TryAddWithoutValidation(h.Name, h.Value.GetString());
            using var res = await _http.SendAsync(req);
            string body = await res.Content.ReadAsStringAsync();
            if (uri.Host.EndsWith("163.com", StringComparison.OrdinalIgnoreCase) && uri.AbsolutePath.Contains("lyric"))
            {
                var code = System.Text.RegularExpressions.Regex.Match(body, "\"code\"\\s*:\\s*(-?\\d+)").Groups[1].Value;
                bool hasLrc = body.Contains("\"lrc\"") && body.Contains("[00:");
                Log($"NetEase letra {uri.Query}: HTTP {(int)res.StatusCode}, código {code}, {(hasLrc ? "con letra" : "SIN letra")}, {body.Length} bytes");
            }
            if (uri.Host.EndsWith("163.com", StringComparison.OrdinalIgnoreCase) && uri.AbsolutePath.Contains("search"))
            {
                var code = System.Text.RegularExpressions.Regex.Match(body, "\"code\"\\s*:\\s*(-?\\d+)").Groups[1].Value;
                Log($"NetEase búsqueda {Uri.UnescapeDataString(uri.Query)}: HTTP {(int)res.StatusCode}, código {code}, {body.Length} bytes");
            }
            RunOnUi(() => Post(new { type = "fetchResult", id, ok = res.IsSuccessStatusCode, status = (int)res.StatusCode, body }));
        }
        catch (Exception ex)
        {
            Log($"petición fallida {url}: {ex.GetType().Name}: {ex.InnerException?.Message ?? ex.Message}");
            // Mensajes claros: en redes con firewall (p. ej. de una universidad) la conexión a un
            // servicio de letras puede cortarse o recibir un certificado falso.
            string error = ex switch
            {
                TaskCanceledException => "sin respuesta (tiempo agotado)",
                HttpRequestException { InnerException: System.Security.Authentication.AuthenticationException } => "bloqueado por la red (certificado no válido)",
                HttpRequestException { InnerException: IOException } => "bloqueado por la red (conexión cortada)",
                HttpRequestException { InnerException: System.Net.Sockets.SocketException } => "sin conexión",
                _ => ex.InnerException?.Message ?? ex.Message,
            };
            RunOnUi(() => Post(new { type = "fetchResult", id, ok = false, status = 0, body = "", error }));
        }
    }

    // ---------------- Tamaño y posición ----------------

    // La ventana toma el tamaño de la tarjeta (más un margen para su sombra).
    private void ApplySize(double cssW, double cssH)
    {
        var size = new Size(Px(cssW), Px(cssH));
        if (size == Size) return;
        int right = Right;
        bool anchorRight = _settings.X == null; // posición inicial: pegada a la derecha
        Size = size;
        if (anchorRight) Left = right - Width;
        KeepOnScreen();
    }

    private void PlaceWindow()
    {
        var area = Screen.PrimaryScreen?.WorkingArea ?? new Rectangle(0, 0, 1280, 720);
        if (_settings.X is int x && _settings.Y is int y)
            Location = new Point(x, y);
        else
            Location = new Point(area.Right - Width - Px(12), area.Top + Px(12));
        KeepOnScreen();
    }

    private void KeepOnScreen()
    {
        var area = Screen.FromRectangle(Bounds).WorkingArea;
        int x = Math.Clamp(Left, area.Left - Width / 2, area.Right - Width / 2);
        int y = Math.Clamp(Top, area.Top, Math.Max(area.Top, area.Bottom - Px(60)));
        if (x != Left || y != Top) Location = new Point(x, y);
    }

    private void SavePosition()
    {
        _settings.X = Left;
        _settings.Y = Top;
        _settings.Save();
    }

    // ---------------- Bandeja del sistema y atajo ----------------

    private void BuildTray()
    {
        var menu = new ContextMenuStrip();
        _miShow = new ToolStripMenuItem("Ocultar letras", null, (_, _) => SetShown(!Visible)) { ShortcutKeyDisplayString = "Ctrl+Alt+L" };
        _miGhost = new ToolStripMenuItem("Modo transparente", null, (_, _) => Post(new { type = "toggleGhost" }));
        _miStartup = new ToolStripMenuItem("Iniciar con Windows", null, (_, _) => ToggleStartup()) { Checked = IsStartupEnabled() };
        menu.Items.Add(_miShow);
        menu.Items.Add(_miGhost);
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add(_miStartup);
        menu.Items.Add(new ToolStripMenuItem("Volver a la posición inicial", null, (_, _) =>
        {
            _settings.X = null; _settings.Y = null; _settings.Save();
            var area = Screen.PrimaryScreen?.WorkingArea ?? new Rectangle(0, 0, 1280, 720);
            Location = new Point(area.Right - Width - Px(12), area.Top + Px(12));
            SetShown(true);
        }));
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add(new ToolStripMenuItem("Salir", null, (_, _) => ExitApp()));

        _tray.Icon = Icon;
        _tray.Text = "Letras Flotantes (Ctrl+Alt+L)";
        _tray.ContextMenuStrip = menu;
        _tray.Visible = true;
        _tray.MouseClick += (_, e) => { if (e.Button == MouseButtons.Left) SetShown(!Visible); };
    }

    private void SetShown(bool show)
    {
        if (show) { Show(); TopMost = true; KeepOnScreen(); }
        else Hide();
        _miShow.Text = show ? "Ocultar letras" : "Mostrar letras";
        _settings.Hidden = !show;
        _settings.Save();
    }

    protected override void WndProc(ref Message m)
    {
        if (m.Msg == Native.WM_HOTKEY && m.WParam.ToInt32() == HotkeyId)
            SetShown(!Visible);
        base.WndProc(ref m);
    }

    private static bool IsStartupEnabled()
    {
        using var key = Registry.CurrentUser.OpenSubKey(RunKey);
        return key?.GetValue(RunValue) is string s && s.Contains(Application.ExecutablePath, StringComparison.OrdinalIgnoreCase);
    }

    private void ToggleStartup()
    {
        using var key = Registry.CurrentUser.CreateSubKey(RunKey);
        if (IsStartupEnabled()) key.DeleteValue(RunValue, false);
        else key.SetValue(RunValue, $"\"{Application.ExecutablePath}\"");
        _miStartup.Checked = IsStartupEnabled();
    }

    private static Icon LoadAppIcon()
    {
        using var s = typeof(MainForm).Assembly.GetManifestResourceStream("app.ico");
        return s != null ? new Icon(s) : SystemIcons.Application;
    }

    private void ExitApp()
    {
        _exiting = true;
        Close();
    }

    protected override void OnFormClosing(FormClosingEventArgs e)
    {
        // Cerrar la ventana (p. ej. con Alt+F4) solo la oculta; para salir, usar "Salir" en la bandeja.
        if (!_exiting && e.CloseReason == CloseReason.UserClosing)
        {
            e.Cancel = true;
            SetShown(false);
            return;
        }
        Native.UnregisterHotKey(Handle, HotkeyId);
        _tray.Visible = false;
        _tray.Dispose();
        _media.Dispose();
        base.OnFormClosing(e);
    }
}
