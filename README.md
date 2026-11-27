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

## Idiomas y aplicación instalable

La portada en español está en `/` y la versión editorial en inglés en `/en/`. Ambas se enlazan desde el encabezado. La galería completa y los proyectos activos se consultan en las secciones de la portada en español.

Con HTTPS, el navegador puede instalar KAELION Digital Art desde su menú. Tras cargar la aplicación por primera vez, el service worker permite abrir ambas portadas sin conexión. Las rutas del portal, administración, API, pagos y descargas privadas quedan fuera de la caché.

## Verificar servicios desde el entorno de pruebas

Con Node.js 20.6 o posterior, ejecuta `npm install` dentro de `ops/`. Proporciona las variables de `ops/.env.example` en el entorno del servidor o en un archivo local `ops/.env` ignorado por Git.

Desde `ops/`, ejecuta `npm run check` si el servidor ya inyecta las variables. Con un archivo local, usa `node --env-file=.env check-services.mjs`. Agrega `mysql`, `smtp` o `stripe` al final para comprobar un solo servicio.

- MySQL ejecuta `SELECT 1` en la base indicada.
- SMTP comprueba TLS y autenticación mediante una conexión de prueba, sin enviar mensajes.
- Stripe consulta el precio en sandbox. Comprueba que siga activo y sea de **250.00 MXN** en un solo pago.

## Portal de clientes, panel del taller y backend (`server/`)

El repositorio incluye el backend Node.js (`server/`), el portal de clientes (`portal/`), el panel privado del taller (`admin/`) y el aviso de privacidad (`privacidad.html`) para la promoción **Diseño inteligente de logotipos ($250 MXN)**.

### Arranque en staging o producción (MySQL + Stripe + SMTP)

```powershell
Set-Location server
Copy-Item .env.example .env
# Completa server/.env (DB_DRIVER=mysql, MYSQL_*, STRIPE_*, SMTP_*, SESSION_SECRET, APP_ORIGIN)
npm install
npm run migrate
npm run seed:admin
npm start
```

### Prueba local rápida sin MySQL (solo desarrollo)

```powershell
Set-Location server
$env:DB_DRIVER = "memory"
npm test
```

- **Portal de clientes:** `/portal/`
- **Panel del taller:** `/admin/`
- **Aviso de privacidad:** `/privacidad.html`
- **Webhook de Stripe:** `POST /api/stripe/webhook`
