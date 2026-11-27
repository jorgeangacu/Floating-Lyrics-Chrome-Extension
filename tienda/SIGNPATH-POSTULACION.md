# Postulación a SignPath Foundation (firma de código gratuita)

Sitio: https://signpath.org/ → sección para postular un proyecto (Apply / Get started).
El formulario está en inglés; las respuestas de abajo ya están en inglés para copiar y pegar.

## Antes de enviar

- [ ] Activa la **verificación en dos pasos (2FA)** en tu cuenta de GitHub
      (GitHub → Settings → Password and authentication). SignPath la exige a todo el equipo.
- [ ] Cuando crees tu cuenta en SignPath, activa también allí la verificación en dos pasos.

## Respuestas para el formulario

**Project name**
Letras Flotantes (Floating Lyrics)

**Repository URL**
https://github.com/jorgeangacu/Floating-Lyrics-Chrome-Extension

**Project homepage**
https://github.com/jorgeangacu/Floating-Lyrics-Chrome-Extension

**License**
MIT (OSI-approved, no dual licensing)

**Short description**
A free, open-source Windows desktop app (and Chrome extension) that shows time-synced song lyrics
in an always-on-top floating card for whatever is playing on the PC (Chrome, Edge, Spotify, etc.).
It reads the current track and position from Windows' System Media Transport Controls and looks up
lyrics from the public LRCLIB and NetEase Cloud Music APIs.

**What will be signed**
A single Windows executable, `FloatingLyrics.exe` (self-contained .NET 10 single-file app,
WinForms + WebView2). It is built by GitHub Actions on GitHub-hosted runners from the public source
(`.github/workflows/release.yml`) and attached to GitHub Releases.

**Why do you need code signing?**
Windows 11 Smart App Control blocks the unsigned executable on users' PCs, so they cannot run the app.
Signing lets users install it safely and verify that the binary comes from this repository.

**Build system**
GitHub Actions (GitHub.com), GitHub-hosted runners (`windows-latest`). Unsigned artifact is uploaded
with `actions/upload-artifact` and submitted with `signpath/github-action-submit-signing-request@v3`.

**Third-party components**
.NET runtime (MIT), Microsoft.Web.WebView2 SDK (uses the Microsoft Edge WebView2 Runtime installed in
Windows as a system component). No proprietary components of the project itself.

**Code signing policy**
https://github.com/jorgeangacu/Floating-Lyrics-Chrome-Extension/blob/main/CODE_SIGNING_POLICY.md

**Privacy policy**
https://jorgeangacu.github.io/Floating-Lyrics-Chrome-Extension/

**Team / roles**
Jorge Angulo (GitHub: jorgeangacu) — author, reviewer and signing approver.

## Cuando te aprueben

Avísame y configuro lo que falta en GitHub. De SignPath necesitaré:
1. **Organization ID** (en SignPath, en la configuración de la organización).
2. **Project slug** y **Signing policy slug** (normalmente `release-signing`).
3. Un **API token** de un usuario con permiso para enviar solicitudes de firma.
   El token lo pegas tú directamente en GitHub (Settings → Secrets and variables → Actions →
   New repository secret, nombre `SIGNPATH_API_TOKEN`): no me lo envíes por el chat.

En SignPath, además:
- Vincula el proyecto con el sistema de compilación de confianza **GitHub.com** e instala la app de
  SignPath en GitHub (https://github.com/apps/signpath) para este repositorio.
- Usa como configuración de artefacto el contenido de `.signpath/artifact-configuration.xml`.
