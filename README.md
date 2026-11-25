# KAELION Digital Art — Sitio Web Oficial (`kaelion.art`)

Landing page oficial de **KAELION Digital Art**, agencia mexicana especializada en artes digitales, diseño gráfico, fotografía, producción audiovisual y diseño web, dirigida por **Cesar Braher**.

## Identidad Visual Aplicada

Construida fielmente sobre el **Manual de Identidad Oficial**:
- **Paleta cromática:** Obsidiana (`#111012`), Carbón (`#211F23`), Grafito (`#3C3A40`), Ceniza (`#D4D1D2`), Granate (`#682831`) y Carmín mate (`#B85B64`).
- **Tipografías:** `Source Serif 4` y `Source Sans 3`.
- **Aplicaciones de logotipo y emblema:**
  - `assets/brand/logo-oscuro.png` — Ceniza sobre obsidiana (portafolio web y piezas audiovisuales).
  - `assets/brand/logo-claro.png` — Obsidiana sobre ceniza (sección editorial del Manifiesto).
  - `assets/brand/emblema.png` — Favicon, navegación, divisores y sellos de proyectos.

## Estructura del Proyecto

- `index.html` — Landing page completa (Manifiesto, Servicios y Procesos de 5 Fases, Portafolio de Clientes, Galería Multimedia, Proyectos Activos, Redes Sociales y Contacto WhatsApp).
- `css/styles.css` — Sistema de diseño en Vanilla CSS totalmente responsivo.
- `js/app.js` — Navegación, pestañas de procesos de 5 fases, cotizador y widget flotante de WhatsApp Business (`+52 464 109 3886`).
- `js/gallery.js` — Portafolio de clientes y galería filtrable (**Imágenes** con Lightbox, **Videos** con reproductor de reels, **Webs** con vista Escritorio/Móvil).
- `js/github-projects.js` — Motor de sincronización en vivo de **Proyectos Activos** desde cualquier cuenta de GitHub + panel de configuración integrado.
- `data/portfolio.json` — Catálogo editable de clientes, casos y trabajos de la galería.
- `data/active-projects.json` — Configuración de cuentas/repositorios de GitHub y proyectos activos.
- `scripts/sync-github-projects.mjs` — Script opcional en Node.js para actualizar `data/active-projects.json` estáticamente desde línea de comandos.
- `CNAME` — Configuración de dominio personalizado para `kaelion.art`.

## Cómo actualizar "Proyectos Activos" desde otra cuenta de GitHub

Tienes **3 formas sencillas** cuando quieras conectar la otra cuenta de GitHub:

1. **Editando `data/active-projects.json` (recomendado):**
   Agrega el nombre de usuario en `"githubAccounts"` o repositorios específicos en `"featuredRepos"`:
   ```json
   "github": {
     "enabled": true,
     "githubAccounts": ["tu-otra-cuenta-github"],
     "featuredRepos": ["tu-otra-cuenta-github/proyecto-1"],
     "maxRepos": 6
   }
   ```
2. **Directamente en el sitio (`Conectar GitHub`):**
   Haz clic en el botón **Conectar GitHub** en la sección *Proyectos Activos*, escribe el usuario o repositorios, previsualiza en vivo y descarga el archivo `active-projects.json` actualizado.
3. **Con el script Node.js (sin depender de límites de API del navegador):**
   ```bash
   node scripts/sync-github-projects.mjs tu-otra-cuenta-github
   ```
