# Notificaciones Web Push (PWA)

Aplicacion web responsive y PWA para registrar navegadores/dispositivos y enviar notificaciones Web Push personalizadas usando el estandar Web Push, Service Workers y VAPID.

## Funciones

- Responsive: escritorio, movil y tablet.
- PWA instalable.
- Service Worker para recibir Push aunque la pagina no este abierta.
- Web Push estandar con VAPID, sin Firebase obligatorio ni dependencias npm externas.
- Registro y desregistro de dispositivos.
- Alias personalizado por dispositivo.
- Panel de administrador protegido por token.
- Envio a un dispositivo especifico o a todos.
- Titulo, mensaje, URL al tocar, etiqueta y `requireInteraction` cuando el navegador/SO lo soporte.
- Limpieza automatica de suscripciones expiradas (HTTP 404/410).
- Indicaciones especificas para iPhone/iPad.

## Requisitos

- Node.js 20+.
- HTTPS en produccion. `localhost` es un contexto seguro permitido para desarrollo.

## Arranque local

```bash
npm run setup
npm start
```

Abre `http://localhost:3000`.

`npm run setup` crea `.env` con claves VAPID y un `ADMIN_TOKEN`. Usa ese token en el panel de administrador de la propia web.

## iPhone / iPad

En iOS/iPadOS, agrega la web a la pantalla de inicio y abre la PWA desde su icono. Luego pulsa **Activar notificaciones**. El permiso debe originarse en una accion directa del usuario.

## Produccion

Despliega el proyecto en un hosting Node con HTTPS (por ejemplo: Azure App Service, AWS, Render, Railway, Fly.io o un VPS con proxy HTTPS).

Configura:

```env
PORT=3000
VAPID_SUBJECT=mailto:tu-correo@dominio.com
VAPID_PUBLIC_KEY=...
VAPID_PRIVATE_KEY=...
ADMIN_TOKEN=un-token-largo-y-seguro
```

No publiques `VAPID_PRIVATE_KEY` ni `ADMIN_TOKEN` en el frontend.

### Persistencia

Este demo guarda las suscripciones en `data/subscriptions.json`. Para produccion real con multiples instancias o despliegues efimeros, sustituye esa capa por PostgreSQL, MySQL, Redis, SQLite persistente u otra base de datos.

## Prueba de extremo a extremo

1. Abre la app.
2. Escribe un nombre de dispositivo.
3. Pulsa **Activar notificaciones** y concede permiso.
4. Ingresa el `ADMIN_TOKEN` generado por `npm run setup`.
5. Pulsa **Cargar**.
6. Selecciona el dispositivo.
7. Personaliza titulo/mensaje y pulsa **Enviar ahora**.
8. Para probar segundo plano de verdad, minimiza/cierra la PWA y envia desde otro navegador o dispositivo que tenga acceso al panel.

## Compatibilidad y limites

- Chrome, Edge, Firefox, Opera y navegadores Chromium modernos soportan Push API en plataformas compatibles.
- Safari moderno soporta Web Push.
- En iOS/iPadOS, Web Push se ofrece a apps web agregadas a la pantalla de inicio.
- La apariencia y ciertas opciones (`requireInteraction`, acciones, imagenes, etc.) dependen del navegador y del sistema operativo.
- El usuario controla el permiso y puede bloquear/revocar notificaciones.
- En produccion la web debe servirse por HTTPS.

## Despliegue 100% gratuito para pruebas: GitHub + Render + Supabase

La version incluida puede usar Supabase como almacenamiento persistente. En local, si no defines `SUPABASE_URL` y `SUPABASE_SECRET_KEY`, sigue usando `data/subscriptions.json`.

### 1. Supabase

1. Crea un proyecto gratuito.
2. Abre **SQL Editor** y ejecuta el archivo `supabase.sql`.
3. Copia **Project URL** y la **Secret Key** desde la configuracion/API del proyecto.
4. Nunca expongas la Secret Key en el frontend ni la subas a GitHub.

### 2. GitHub

Sube el proyecto a un repositorio. No subas `.env`; ya esta excluido en `.gitignore`.

### 3. Render

Crea un **Web Service** gratuito conectado al repositorio de GitHub. Configura:

- Runtime: Node
- Build Command: `npm install`
- Start Command: `npm start`
- Health Check Path: `/health`

Agrega estas variables de entorno en Render:

- `VAPID_SUBJECT`
- `VAPID_PUBLIC_KEY`
- `VAPID_PRIVATE_KEY`
- `ADMIN_TOKEN`
- `SUPABASE_URL`
- `SUPABASE_SECRET_KEY`

No es necesario definir `PORT`: Render lo inyecta automaticamente y la app ya lo respeta.

Cuando Render termine, abre la URL HTTPS `https://<tu-servicio>.onrender.com`, registra un dispositivo y envia una notificacion desde el panel administrador.

### Nota sobre planes gratuitos

Render Free puede dormir el servidor cuando no recibe trafico. Al volver a abrir la web, Render lo reactiva. Gracias a Supabase, las suscripciones no se pierden aunque el proceso de Render se reinicie o duerma.
