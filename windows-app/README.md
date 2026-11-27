# Letras Flotantes para Windows

Aplicación de escritorio que muestra la letra sincronizada de lo que suena en **cualquier aplicación**
de Windows (Chrome, Edge, Spotify, el reproductor de Windows…), en una tarjeta transparente que queda
siempre encima, aunque Chrome esté minimizado o cerrado.

Lee la canción y el tiempo desde los controles multimedia de Windows (System Media Transport
Controls) y busca la letra con el mismo código que la extensión (LRCLIB, con NetEase de respaldo).

## Uso

- Abre `FloatingLyrics.exe`. Aparece la tarjeta y un icono en la bandeja del sistema (junto al reloj).
- **Mostrar u ocultar:** `Ctrl+Alt+L`, o clic en el icono de la bandeja.
- **Mover:** arrastra la tarjeta desde la cabecera (la posición se recuerda).
- **Controles** (al pasar el mouse): `−` / `+` sincronía, `Aa` tamaño del texto, `◐` modo transparente.
- **Clic en una línea:** salta a ese momento (si la aplicación que suena lo permite).
- **Menú de la bandeja:** mostrar/ocultar, modo transparente, iniciar con Windows, volver a la posición
  inicial y salir.

## Compilar

Requiere el SDK de .NET 10 y el runtime de WebView2 (incluido en Windows 11).

```powershell
dotnet build
```

Ejecutable único (no necesita .NET instalado):

```powershell
dotnet publish -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true -p:EnableCompressionInSingleFile=true -p:DebugType=none -o ..\dist
```

Los archivos de compilación van a `%LOCALAPPDATA%\FloatingLyricsDev\build` (ver `Directory.Build.props`).

## Estructura

| Archivo | Qué hace |
|---|---|
| `MediaWatcher.cs` | Lee de Windows qué suena, en qué segundo va y la carátula. |
| `MainForm.cs` | Ventana transparente siempre encima, bandeja del sistema, atajo global y puente con la página. |
| `web/app.js`, `web/app.css` | La tarjeta y sus animaciones (las mismas de la extensión). |
| `web/lyrics.js` | Búsqueda de letras (copiada de `letras-flotantes/src/background.js`). |
