# 💬 Chat Papá & Hija

Chat privado 1‑a‑1 en tiempo real. Página estática (GitHub Pages) + Firebase (Auth + Firestore).
Solo las dos cuentas autorizadas pueden entrar, leer o escribir. Fotos comprimidas y guardadas en base64 (sin Storage, sin tarjeta).

## Configuración (una sola vez)

1. **Crear proyecto** en https://console.firebase.google.com (plan gratis Spark).
2. **Authentication → Método de acceso →** habilitar *Correo electrónico/contraseña*.
3. **Authentication → Usuarios → Agregar usuario:** crear las 2 cuentas: `papa@chat-familia.local` y `hija@chat-familia.local` (no son correos reales, solo nombres de usuario) con sus claves.
4. **Authentication → Configuración → Acciones del usuario →** desmarcar *Habilitar creación (registro)*. Así nadie más puede crearse cuenta.
5. **Authentication → Configuración → Dominios autorizados →** agregar `odeado.github.io`.
6. **Firestore Database → Crear base de datos** (modo producción, región `southamerica-east1` o la más cercana).
7. **Firestore → Reglas:** pegar el contenido de `firestore.rules` (con los 2 correos) y **Publicar**.
8. **Configuración del proyecto → Tus apps → Web (</>)** → copiar la config y pegarla en `js/config.js`, junto con los 2 correos.
9. Subir a GitHub y activar **Settings → Pages → Deploy from branch → main / (root)**.

URL: `https://odeado.github.io/mensajero/`

## Uso
- Se toca **Papá** o **Hija**, se escribe la clave y listo; la sesión queda guardada en el teléfono.
- Si alguien olvida su clave: Consola Firebase → Authentication → Usuarios → ⋮ → Restablecer contraseña (o borrar y crear de nuevo).
- Para cambiar de usuario: botón ⎋ arriba a la derecha (cerrar sesión).
- En el teléfono: menú del navegador → *Agregar a pantalla de inicio* para usarlo como app.

## Funciones
- 🔗 Los enlaces se vuelven clicables solos (`https://…`, `www.…` o `youtube.com/…`); en el APK se abren en el navegador sin salir del chat.
- 😊 Selector de emojis · emojis solos se ven grandes (stickers).
- ❤️ Reacciones: mantener apretado (o doble clic) un mensaje.
- 🦄 Avatar: tocar tu nombre arriba a la derecha.
- 🎮 Juegos en tiempo real: Gato, 4 en línea, Damas, Cachipún y Jenga (botón 🎮 junto a la cámara).
- 📷 Fotos: el botón de cámara permite **Tomar foto** o **Elegir de la galería** (en el APK).
- 🔔 Notificaciones: tocar la campana. Llegan mientras la app está abierta o en segundo plano.
  En iPhone solo funcionan si la app se agregó a la pantalla de inicio.
- 📲 Instalable como app (ícono propio).

## Avisos con sonido en el APK
- El APK usa el canal de notificación **Mensajes** con sonido y vibración del sistema.
- Para que lleguen y suenen con la app minimizada o la pantalla apagada:
  mantener presionada la barra verde superior → **Permitir avisos con pantalla apagada**.
- En Xiaomi/Redmi además hay que activar **Autostart**, poner **Sin restricciones** en el ahorro de batería
  y bloquear la app en la lista de recientes.
- Para comprobar el sonido: mantener presionada la barra superior → **Probar sonido del aviso**.
- Si no suena, revisar que el teléfono no esté en silencio/No molestar y que
  Ajustes → Apps → Mensajero → Notificaciones → **Mensajes** tenga sonido activado.


## Seguridad
- La `apiKey` de Firebase es pública por diseño; la protección real está en `firestore.rules`.
- Nadie puede crear mensajes a nombre del otro ni borrar mensajes.
- Los mensajes se muestran con nodos de texto y enlaces creados con el DOM (sin `innerHTML` con datos del usuario), así que no hay riesgo de inyección de código.
