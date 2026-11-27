# Política de firma de código / Code signing policy

Free code signing provided by [SignPath.io](https://about.signpath.io/), certificate by [SignPath Foundation](https://signpath.org/).

## Qué se firma

Solo `FloatingLyrics.exe`, la app de Windows de este repositorio. Se compila automáticamente con
GitHub Actions ([`.github/workflows/release.yml`](.github/workflows/release.yml)) a partir del código
público de este repositorio, en máquinas alojadas por GitHub, y se firma a través de SignPath.
Ningún binario compilado fuera de ese proceso se firma.

## Roles

| Rol | Personas |
|---|---|
| Autores (committers) | [Jorge Angulo](https://github.com/jorgeangacu) |
| Revisores | [Jorge Angulo](https://github.com/jorgeangacu) |
| Aprobadores de firma | [Jorge Angulo](https://github.com/jorgeangacu) |

Todos los miembros usan autenticación multifactor en GitHub y en SignPath. Cada solicitud de firma de
una versión pública es aprobada manualmente.

## Privacidad

Este programa no envía información a ningún sistema en red salvo que el usuario lo active: mientras la
tarjeta de letras está visible, envía el **título, el artista y la duración** de la canción que suena a
los servicios públicos de letras LRCLIB (lrclib.net) y NetEase Cloud Music (music.163.com) para buscar
la letra. No recopila datos personales ni historial, y no usa analíticas ni publicidad.

Política de privacidad completa: <https://jorgeangacu.github.io/Floating-Lyrics-Chrome-Extension/>

---

**English summary.** Free code signing provided by SignPath.io, certificate by SignPath Foundation.
Only `FloatingLyrics.exe` is signed; it is built by GitHub Actions on GitHub-hosted runners from the
public source in this repository. Committer, reviewer and approver: Jorge Angulo (MFA enabled). The app
only sends the current song's title, artist and duration to LRCLIB and NetEase to look up lyrics while
the lyrics card is shown; it collects no personal data and has no analytics or ads.
