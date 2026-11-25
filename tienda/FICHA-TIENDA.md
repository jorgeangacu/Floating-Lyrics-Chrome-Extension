# Ficha para la Chrome Web Store — Letras Flotantes

Copia y pega cada bloque en el campo indicado del Developer Dashboard.

---

## Pestaña "Package" (Paquete)
Sube: `letras-flotantes-1.0.0.zip`

## Pestaña "Store listing" (Ficha de Play Store)

**Nombre** (viene del manifest): Letras Flotantes

**Resumen** (viene del manifest, máx. 132 caracteres):
Muestra la letra sincronizada de lo que suena en Chrome (música o video), flotando encima de cualquier pestaña.

**Descripción:**
```
Letras Flotantes muestra la letra sincronizada de la canción que estás escuchando en Chrome, en una tarjeta flotante elegante que se queda encima de cualquier pestaña.

♪ Funciona con lo que suene en el navegador: YouTube, YouTube Music, Spotify Web, SoundCloud, Deezer y la mayoría de reproductores web.
♪ Letra en tiempo real: la línea actual se ilumina palabra por palabra y la siguiente aparece debajo, con transiciones suaves y desenfoque progresivo.
♪ Pausas instrumentales con puntos animados.
♪ Fondo con los colores de la carátula del álbum.
♪ Siempre visible: aparece en todas tus pestañas (incluso sobre videos en pantalla completa) hasta que la ocultes.
♪ Haz clic en cualquier línea para saltar a esa parte de la canción.
♪ Ajusta la sincronía (±0.5 s, se guarda por canción), cambia el tamaño del texto y mueve la tarjeta donde quieras.
♪ Modo transparente: el fondo de la tarjeta queda al 40 % con bordes difuminados para ver la página detrás, y la letra sigue legible; al pasar el mouse vuelve suavemente a la normalidad.
♪ Tamaño constante: el zoom de la página no agranda ni achica la tarjeta.
♪ Ventana flotante (⧉): pasa la letra a una ventana siempre visible, incluso con Chrome minimizado o mientras usas otras aplicaciones.

CÓMO USARLA
1. Reproduce una canción o un video musical.
2. Haz clic en el ícono de Letras Flotantes o pulsa Alt+Shift+L.
3. Para ocultarla, vuelve a hacer clic en el ícono o pulsa Alt+Shift+L otra vez.

Las letras provienen de servicios públicos (LRCLIB y NetEase Cloud Music). Solo se envía el título, el artista y la duración de la canción, y solo mientras la tarjeta está activada. Sin publicidad, sin rastreo y sin cuentas.

Nota: Chrome no permite que las extensiones se muestren en páginas internas como chrome:// o la página de Nueva pestaña.
```

**Categoría:** Entretenimiento (Entertainment)
**Idioma:** Español

**Recursos gráficos:**
- Ícono de la tienda 128×128: `letras-flotantes/icons/icon128.png`
- Capturas de pantalla 1280×800, en este orden:
  1. `tienda/captura-1.png`: la tarjeta con la letra sincronizada
  2. `tienda/captura-2.png`: la tarjeta en la esquina con sus controles (sincronía, tamaño, transparencia, ventana flotante)
  3. `tienda/captura-3.png`: modo transparente sobre una página con texto
- Mosaico promocional pequeño 440×280: `tienda/mosaico-440x280.png`

---

## Pestaña "Privacy" (Prácticas de privacidad)

**Propósito único (Single purpose):**
```
Mostrar la letra sincronizada de la canción o el video musical que se reproduce en el navegador, en una tarjeta flotante sobre las pestañas.
```

**Justificación — permiso `storage`:**
```
Guarda las preferencias del usuario en su navegador: si la tarjeta está visible, su posición, el tamaño del texto y el ajuste de sincronía de cada canción.
```

**Justificación — permiso `scripting`:**
```
Al instalar o actualizar la extensión, activa sus scripts en las pestañas que ya estaban abiertas, para que la letra funcione sin tener que recargarlas.
```

**Justificación — permisos de host (`<all_urls>`):**
```
La música y los videos pueden sonar en cualquier sitio (YouTube, Spotify Web, SoundCloud, Deezer, reproductores incrustados, etc.). La extensión necesita acceso a todos los sitios para (1) leer qué se está reproduciendo mediante la Media Session API y los elementos de audio/video, (2) mostrar la tarjeta de letras encima de la pestaña que el usuario esté viendo y (3) consultar las letras en lrclib.net y music.163.com. No lee ni recopila ningún otro contenido de las páginas.
```

**¿Usas código remoto?** No.
```
Todo el código JavaScript está incluido en el paquete. Solo se descargan datos (letras en formato JSON/LRC), nunca código.
```

**Uso de datos — marca solo:**
- [x] **Contenido del sitio web** (título/artista de la canción que suena)
- Ninguna otra categoría (sin información personal, de salud, financiera, de autenticación, comunicaciones personales, ubicación, historial web ni actividad del usuario).

**Certificaciones — marca las tres:**
- [x] No vendo ni transfiero datos de usuarios a terceros, salvo para los casos de uso aprobados.
- [x] No uso ni transfiero datos de usuarios para fines ajenos al propósito único del elemento.
- [x] No uso ni transfiero datos de usuarios para determinar su solvencia ni para préstamos.

**URL de la política de privacidad:** la de GitHub Pages, por ejemplo
`https://TU-USUARIO.github.io/letras-flotantes/` (publica la carpeta `docs/` del repositorio).

---

## Pestaña "Distribution" (Distribución)
- Visibilidad: **Pública** (o "No listada" si primero quieres probarla con un enlace).
- Regiones: todas.
