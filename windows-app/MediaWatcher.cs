using Windows.Media.Control;
using Windows.Storage.Streams;

namespace FloatingLyrics;

/// <summary>Lo que suena ahora, según Windows (el mismo dato que los controles multimedia del sistema).</summary>
public sealed record MediaState(
    string Title, string Artist, string Album,
    bool Playing, double Position, double Duration, long At, double Rate, string App);

/// <summary>
/// Lee de Windows (System Media Transport Controls) qué se reproduce en cualquier aplicación:
/// Chrome, Edge, Spotify, el reproductor de Windows, etc. Avisa en cada cambio de canción,
/// de estado o de posición, y repasa el estado cada 2 s por si alguna aplicación no avisa.
/// </summary>
public sealed class MediaWatcher : IDisposable
{
    private GlobalSystemMediaTransportControlsSessionManager? _mgr;
    private GlobalSystemMediaTransportControlsSession? _current;
    private readonly HashSet<GlobalSystemMediaTransportControlsSession> _hooked = new();
    private readonly System.Threading.Timer _timer;
    private readonly SemaphoreSlim _gate = new(1, 1);
    private volatile bool _pending;
    private string _artKey = "";
    private string _artData = "";
    // Chrome publica primero su logo como imagen provisional y luego la portada real:
    // la carátula se vuelve a leer cuando la aplicación avisa un cambio y durante los
    // primeros segundos de cada canción.
    private volatile bool _artDirty = true;
    private DateTime _artCheckUntil = DateTime.MinValue;
    private DateTime _artLastRead = DateTime.MinValue;

    /// <summary>Estado actual (null si no suena nada).</summary>
    public event Action<MediaState?>? Changed;

    /// <summary>Carátula de la canción actual (data URL), cuando está disponible.</summary>
    public event Action<string, string, string>? ArtworkChanged; // título, artista, data URL

    public MediaWatcher()
    {
        _timer = new System.Threading.Timer(_ => _ = RefreshAsync(), null, Timeout.Infinite, Timeout.Infinite);
    }

    public async Task StartAsync()
    {
        _mgr = await GlobalSystemMediaTransportControlsSessionManager.RequestAsync();
        _mgr.SessionsChanged += (_, _) => { HookSessions(); _ = RefreshAsync(); };
        _mgr.CurrentSessionChanged += (_, _) => _ = RefreshAsync();
        HookSessions();
        await RefreshAsync();
        _timer.Change(2000, 2000);
    }

    private void HookSessions()
    {
        if (_mgr == null) return;
        foreach (var s in _mgr.GetSessions())
        {
            if (!_hooked.Add(s)) continue;
            s.PlaybackInfoChanged += (_, _) => _ = RefreshAsync();
            s.MediaPropertiesChanged += (_, _) => { _artDirty = true; _ = RefreshAsync(); };
            s.TimelinePropertiesChanged += (_, _) => _ = RefreshAsync();
        }
    }

    private static bool IsPlaying(GlobalSystemMediaTransportControlsSession s)
    {
        try { return s.GetPlaybackInfo()?.PlaybackStatus == GlobalSystemMediaTransportControlsSessionPlaybackStatus.Playing; }
        catch { return false; }
    }

    /// <summary>Elige la sesión a seguir: la que está sonando (prefiriendo la que Windows marca como actual).</summary>
    private GlobalSystemMediaTransportControlsSession? Pick()
    {
        if (_mgr == null) return null;
        var sessions = _mgr.GetSessions().ToList();
        if (sessions.Count == 0) return null;
        var sys = _mgr.GetCurrentSession();
        if (sys != null && IsPlaying(sys)) return sys;
        if (_current != null && sessions.Contains(_current) && IsPlaying(_current)) return _current;
        var playing = sessions.FirstOrDefault(IsPlaying);
        if (playing != null) return playing;
        if (_current != null && sessions.Contains(_current)) return _current;
        return sys ?? sessions[0];
    }

    public async Task RefreshAsync()
    {
        if (_mgr == null) return;
        if (!await _gate.WaitAsync(0)) { _pending = true; return; }
        try
        {
            do
            {
                _pending = false;
                await RefreshCoreAsync();
            } while (_pending);
        }
        catch { /* una aplicación que se cierra a mitad de lectura: se reintenta en el siguiente repaso */ }
        finally { _gate.Release(); }
    }

    private async Task RefreshCoreAsync()
    {
        var s = Pick();
        _current = s;
        if (s == null) { Changed?.Invoke(null); return; }

        var props = await s.TryGetMediaPropertiesAsync();
        var tl = s.GetTimelineProperties();
        var pb = s.GetPlaybackInfo();

        string title = props?.Title ?? "";
        string artist = string.IsNullOrWhiteSpace(props?.Artist) ? (props?.AlbumArtist ?? "") : props!.Artist;
        string album = props?.AlbumTitle ?? "";
        double duration = Math.Max(0, (tl.EndTime - tl.StartTime).TotalSeconds);
        double position = Math.Max(0, (tl.Position - tl.StartTime).TotalSeconds);
        long at = tl.LastUpdatedTime.ToUnixTimeMilliseconds();
        bool playing = pb?.PlaybackStatus == GlobalSystemMediaTransportControlsSessionPlaybackStatus.Playing;
        double rate = pb?.PlaybackRate ?? 1.0;
        if (rate <= 0) rate = 1.0;

        Changed?.Invoke(new MediaState(title, artist, album, playing, position, duration, at, rate, s.SourceAppUserModelId ?? ""));

        // Carátula: se lee al cambiar de canción, cada vez que la aplicación avisa un cambio,
        // y cada 3 s durante los primeros 15 s de la canción (por si cambia sin avisar).
        var now = DateTime.UtcNow;
        string key = title + "\u0001" + artist;
        if (key != _artKey)
        {
            _artKey = key;
            _artData = "";
            _artDirty = true;
            _artCheckUntil = now.AddSeconds(15);
        }
        bool due = _artDirty || (now < _artCheckUntil && now - _artLastRead > TimeSpan.FromSeconds(3));
        if (due && props?.Thumbnail != null)
        {
            _artDirty = false;
            _artLastRead = now;
            string data = await ReadThumbnailAsync(props.Thumbnail);
            if (data.Length > 0 && data != _artData)
            {
                _artData = data;
                ArtworkChanged?.Invoke(title, artist, data);
            }
        }
    }

    private static async Task<string> ReadThumbnailAsync(IRandomAccessStreamReference reference)
    {
        try
        {
            using var stream = await reference.OpenReadAsync();
            using var input = stream.AsStreamForRead();
            using var ms = new MemoryStream();
            await input.CopyToAsync(ms);
            if (ms.Length == 0) return "";
            string type = string.IsNullOrEmpty(stream.ContentType) ? "image/png" : stream.ContentType;
            return $"data:{type};base64,{Convert.ToBase64String(ms.ToArray())}";
        }
        catch { return ""; }
    }

    /// <summary>Salta a un segundo de la canción actual (si la aplicación lo permite).</summary>
    public async Task SeekAsync(double seconds)
    {
        var s = _current;
        if (s == null) return;
        try
        {
            var start = s.GetTimelineProperties().StartTime;
            await s.TryChangePlaybackPositionAsync((start + TimeSpan.FromSeconds(Math.Max(0, seconds))).Ticks);
        }
        catch { }
    }

    public void Dispose()
    {
        _timer.Dispose();
        _gate.Dispose();
    }
}
