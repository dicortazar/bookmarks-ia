# Bookmarks IA

Funciona en dos partes:

1. **Desde el móvil** compartes un enlace con la app. El enlace queda en `Bookmarks IA/Pendientes` de tu Google Drive.
2. **Cada noche a las 02:55** una tarea programada de Claude procesa los pendientes. Lee cada página y redacta título, resumen, puntos clave y etiquetas. Después crea una ficha PDF y escribe un resumen de todo lo nuevo. Funciona aunque tengas el móvil apagado.

En la app ves:
- **Lo último**: la síntesis de lo procesado en la última noche.
- **Pendientes**: lo que aún no se ha procesado. Los que fallaron aparecen con ⚠.
- **Documentos**: todos los procesados, con buscador, filtro por etiquetas y detalle de cada uno (resumen, puntos clave, abrir página, ver PDF).

No necesita API key de Claude: usa tu suscripción.

## Estructura en Drive
```
Bookmarks IA/
  Pendientes/   ← la app (un .json por enlace)
  Fichas/       ← la tarea (PDF + JSON por documento)
  Resúmenes/    ← la tarea (un JSON por noche)
```

## Puesta en marcha (una sola vez)

### 1. Publicar la app en GitHub Pages
1. Crea un repo (p. ej. `bookmarks-ia`) y sube el contenido de esta carpeta.
2. Settings → Pages → Deploy from branch → `main` / root.
3. URL: `https://<usuario>.github.io/bookmarks-ia/`.

### 2. Client ID de Google
1. En https://console.cloud.google.com crea un proyecto.
2. APIs & Services → Library → activa **Google Drive API**.
3. OAuth consent screen → External. Déjala en modo *Testing* y añade tu cuenta como **test user**.
4. Credentials → Create credentials → OAuth client ID → **Web application**.
   - Authorized JavaScript origins: `https://<usuario>.github.io`
5. Copia el Client ID.

La app pide dos permisos:
- `drive.file`, para crear sus carpetas y los pendientes.
- `drive.readonly`, para leer las fichas que crea la tarea nocturna.

Al conectar, Google mostrará el aviso de "app no verificada". Es normal en una app personal en modo Testing: pulsa *Continuar*.

### 3. En el móvil
1. Abre la URL en Chrome → ⚙ → pega el Client ID → **Conectar Google Drive**. Esto crea las carpetas.
2. Menú de Chrome → **Instalar app**.
3. Desde cualquier app: **Compartir → Bookmarks**.

## Notas
- La ficha PDF contiene título, enlace, fechas, etiquetas, resumen y puntos clave. No es una copia de la página. Si quieres la página completa, desde Chrome puedes usar *Compartir → Imprimir → Guardar como PDF* en la carpeta `Fichas`.
- Las páginas que solo se ven con JavaScript o tras login pueden fallar. Quedan marcadas con ⚠ en Pendientes y puedes quitarlas.
- También puedes preguntar a Claude directamente, por ejemplo: "¿qué guardé esta semana sobre OSPOs?".
- `make_ficha.py` es el script que usa la tarea para generar las fichas. Se incluye solo como referencia.
