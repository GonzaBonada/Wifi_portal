# Portal WiFi ADEN — frontend en Vercel

Portal cautivo para la red de invitados de ADEN. La cara (formulario de dos
pantallas, colores de ADEN) corre en Vercel; la autorización contra el
controlador UniFi y el guardado en Google Sheets los hace n8n, que está dentro
de la red.

## Arquitectura

```
Cliente WiFi ─▶ UniFi (portal externo) ─▶ página en Vercel
      │                                        │  POST /api/connect
      │                                        ▼
      │                               función serverless (Vercel)
      │                                        │  POST (x-portal-secret)
      │                                        ▼
      │                        webhook n8n (público vía Cloudflare Tunnel)
      │                                        │
      │                         Login UniFi ─▶ authorize-guest ─▶ Google Sheets
      ▼                                        │
  redirección al sitio original ◀── respuesta { ok, redirect }
```

n8n sigue siendo necesario porque el controlador UniFi (192.168.250.251) es una
IP privada de la LAN y Vercel, al estar en la nube, no puede alcanzarlo.

## Archivos

- `index.html` — formulario de dos pantallas, autocontenido (sin fuentes ni JS
  externos, para no tener que habilitar más dominios en el walled garden).
- `api/connect.js` — función serverless que reenvía los datos al webhook de n8n.
- `vercel.json` — evita el cacheo de la página.
- `portal-wifi-aden-webhook.n8n.json` — workflow de n8n con nodo Webhook
  (reemplaza al que usaba Form Trigger).

## 1. Desplegar en Vercel

Opción simple (sin instalar nada): subí esta carpeta a un repo de GitHub e
importalo desde vercel.com. O con la CLI:

```bash
npm i -g vercel
cd vercel
vercel        # deploy de prueba
vercel --prod # deploy productivo
```

No hace falta framework ni `package.json`: Vercel sirve `index.html` como
estática y toma `api/connect.js` como función (Node 18+, usa fetch nativo).

### Variables de entorno (Vercel → Settings → Environment Variables)

| Variable          | Ejemplo                                            | Qué es |
|-------------------|----------------------------------------------------|--------|
| `N8N_WEBHOOK_URL` | `https://portal-hook.aden.org/webhook/wifi-portal` | URL pública del webhook de n8n (ver paso 3). |
| `WEBHOOK_SECRET`  | una cadena larga al azar                           | Token compartido; va igual en n8n. |
| `FALLBACK_URL`    | `https://www.aden.org`                             | A dónde redirigir si UniFi no mandó `url`. |

## 2. Importar el workflow en n8n

1. Importá `portal-wifi-aden-webhook.n8n.json` y desactivá/borrá el anterior.
2. Nodo **Guardar en Sheet**: volvé a elegir tu credencial de Google.
3. Nodo **Config**: completá
   - `unifiPass` → contraseña del usuario `portal-wifi`.
   - `codigoEntregado` → la clave que entregás a los invitados.
   - `secretEsperado` → el mismo valor que `WEBHOOK_SECRET` de Vercel.
4. Publicá el workflow. La ruta del webhook de producción es `/webhook/wifi-portal`.

## 3. Exponer el webhook de n8n (Cloudflare Tunnel)

n8n es interno, así que hay que publicar **solo** la ruta del webhook:

- En Cloudflare Zero Trust creá un hostname público (ej. `portal-hook.aden.org`)
  apuntando al servicio interno de n8n.
- Esa URL + `/webhook/wifi-portal` es la que va en `N8N_WEBHOOK_URL`.
- El token `x-portal-secret` evita que cualquiera que descubra la URL dispare
  autorizaciones.

## 4. Configurar UniFi

- Hotspot → **External Portal Server**, apuntando al dominio de Vercel.
- **Pre-Authorization Allowances (walled garden):** agregá el dominio de Vercel
  (y el de Cloudflare del webhook si el navegador lo necesitara). Vercel usa una
  CDN con IPs variables: permití por **nombre de dominio**, no por IP.

## 5. Probar

Con el deploy productivo (ej. `https://wifi-aden.vercel.app`):

```
https://wifi-aden.vercel.app/?id=aa:bb:cc:dd:ee:ff&url=https://google.com
```

Completá el formulario. Debería aparecer una fila en el Sheet. Con esa MAC
inventada, "Autorizado" dará ERROR (la MAC no existe en el controlador); eso
confirma que el form, el webhook y el guardado funcionan. Después, prueba real
con un celular conectado al SSID.

## Nota sobre la validación de la clave

La comparación actual asume **una sola clave** para todos (`codigoEntregado`).
Si cada persona recibe una clave distinta, hay que reemplazar esa comparación
por una búsqueda contra una tabla email → clave asignada.
