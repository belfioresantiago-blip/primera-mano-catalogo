# Primera Mano — Plataforma propia

Esto es tu propio "Pency": una sola página web. Cualquiera que entra ve el
catálogo público (sin login). Cuando VOS entrás con tu cuenta de Google,
aparece el botón "Editar catálogo" y podés modificar todo — productos,
colores, logo, portada, descripción — en el momento, sin depender de nadie.

Los cambios se guardan en una base de datos real (Firebase) y se ven al
instante para todos los que tengan el catálogo abierto.

Vas a necesitar crear dos cuentas gratis (no puedo crearlas yo por vos):
**Firebase** (el backend) y **Netlify** (donde vive la página). Los dos
pasos llevan unos 15-20 minutos la primera vez.

---

## Paso 1 — Crear el proyecto en Firebase

1. Entrá a https://console.firebase.google.com con tu cuenta de Google
   (la misma que vas a usar para loguearte como admin: **belfioresantiago@gmail.com**).
2. Click en **"Agregar proyecto"** (o "Add project"). Nombre: `primera-mano` (o el que quieras).
3. Desactivá Google Analytics si te lo pregunta (no hace falta). Creá el proyecto.

### 1a. Activar el login con Google
1. En el menú izquierdo: **Compilación (Build) > Authentication**.
2. Click en **"Comenzar"**.
3. En la pestaña **"Sign-in method"**, elegí **Google**, activalo, elegí un
   email de soporte (el tuyo) y guardá.

### 1b. Activar la base de datos (Firestore)
1. En el menú izquierdo: **Compilación (Build) > Firestore Database**.
2. Click en **"Crear base de datos"**.
3. Elegí **"Iniciar en modo de producción"** (no "modo de prueba").
4. Elegí la ubicación `southamerica-east1` (San Pablo, la más cercana a
   Argentina) o la que te sugiera por defecto. Crear.
5. Andá a la pestaña **"Reglas"** dentro de Firestore, borrá lo que hay y
   pegá el contenido completo del archivo `firestore.rules` que te dejé
   en esta carpeta. Click en **"Publicar"**.

### 1c. Registrar la app web y copiar la configuración
1. En el menú izquierdo, arriba de todo, click en el ícono de tuerca ⚙️ >
   **"Configuración del proyecto"**.
2. Abajo, en "Tus apps", click en el ícono **`</>`** (Web).
3. Ponele un apodo (ej: "catalogo-web") y **NO** marques Firebase Hosting.
   Click en **"Registrar app"**.
4. Te va a mostrar un bloque de código con `apiKey`, `authDomain`,
   `projectId`, etc. Copiá esos valores.
5. Abrí el archivo **`firebase-config.js`** (en esta misma carpeta) y
   pegá cada valor donde dice `"PEGAR_ACA"`. Guardá el archivo.
6. Confirmá que tu email (`belfioresantiago@gmail.com`) está en la lista
   `ADMIN_EMAILS` de ese mismo archivo, y también dentro de
   `firestore.rules` (función `isAdmin`) — así te reconoce como
   administrador tanto la página como la base de datos.

---

## Paso 2 — Subir la página a Netlify

1. Entrá a https://app.netlify.com y creá una cuenta gratis (podés usar
   tu cuenta de Google).
2. En el dashboard, buscá la opción de arrastrar y soltar una carpeta
   ("Want to deploy a new site without connecting to Git? Drag and drop
   your site output folder here").
3. Arrastrá **toda esta carpeta** (`webapp`, con los 6 archivos:
   `index.html`, `app.js`, `styles.css`, `firebase-config.js`,
   `firestore.rules` no hace falta subirlo pero no molesta, y
   `products_seed.json`) a esa zona.
4. En unos segundos Netlify te da un link como
   `https://algo-random-1234.netlify.app` — esa ya es tu página, funcionando.

### Autorizar el dominio en Firebase
Firebase necesita saber desde qué dominio le vas a pedir el login de
Google:
1. Volvé a Firebase Console > Authentication > pestaña **"Settings"** >
   **"Authorized domains"**.
2. Click en **"Add domain"** y agregá el dominio que te dio Netlify
   (ej: `algo-random-1234.netlify.app`).

---

## Paso 3 — Cargar tus 531 productos (una sola vez)

1. Entrá a tu página (el link de Netlify).
2. Iniciá sesión con Google, arriba a la derecha, usando
   **belfioresantiago@gmail.com**.
3. Va a aparecer el botón **"✎ Editar catálogo"** — hacé click.
4. En la pestaña "Productos" vas a ver un aviso de que la base está
   vacía, con un botón **"Importar catálogo inicial (531 productos)"**.
   Hacé click y esperá — tarda un par de minutos.
5. Listo — recargá la página y ya vas a ver los 531 productos, y
   quedan guardados en tu base de datos para siempre.

---

## Paso 4 — Poner tu propio dominio (primeramano.com o el que elijas)

1. Comprá el dominio en cualquier registrador (NIC.ar, Namecheap, etc.)
2. En Netlify: **Site settings > Domain management > Add a domain**,
   escribí tu dominio y seguí las instrucciones (te va a pedir cambiar
   unos registros DNS en el registrador — Netlify te dice exactamente
   cuáles).
3. Una vez conectado, agregá TAMBIÉN ese dominio nuevo en Firebase >
   Authentication > Authorized domains (igual que hiciste con el de
   Netlify), si no el login con Google no va a funcionar ahí.

---

## Cómo usarla de acá en adelante

- **Vos**: entrás al link de siempre, te logueás con Google, click en
  "✎ Editar catálogo", y modificás lo que quieras — productos, colores,
  logo, portada, WhatsApp, descripción. Se guarda solo, al instante, y
  se ve así para todo el mundo sin que nadie tenga que refrescar nada
  raro ni yo tenga que intervenir.
- **Tus clientes**: entran al mismo link (sin login), ven el catálogo,
  arman su pedido y lo mandan por WhatsApp — exactamente como antes.

## Si algo no funciona

- "No se pudo iniciar sesión": revisá que agregaste el dominio actual en
  Firebase > Authentication > Authorized domains.
- No aparece el botón de editar aunque entraste con Google: revisá que
  tu email esté EXACTO (sin errores de tipeo) en `firebase-config.js`
  (`ADMIN_EMAILS`) y en `firestore.rules` (`isAdmin`), y que hayas
  publicado las reglas de Firestore después de editarlas.
- Los productos no cargan: abrí la consola del navegador (F12) y fijate
  si hay un error de Firestore — usualmente es que las reglas no se
  publicaron o el `firebase-config.js` tiene un dato mal copiado.
