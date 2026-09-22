# 💬 Chat Papá & Hija (Mensajería Privada 1-a-1)

Aplicación web de mensajería instantánea, ultra rápida, segura y privada en tiempo real para usar exclusivamente entre **Papá e Hija**.

![Status](https://img.shields.io/badge/Estado-Listo_para_usar-brightgreen)
![NodeJS](https://img.shields.io/badge/Node.js-v22-green)
![Socket.io](https://img.shields.io/badge/Socket.io-v4-black)
![SQLite](https://img.shields.io/badge/Database-SQLite3-blue)

---

## ✨ Características

- ⚡ **Mensajería Instantánea 1-a-1**: Conexión por WebSockets sin demoras ni intermediarios.
- 📸 **Envío de Fotos e Imágenes**: Sube y comparte fotos con vista previa a pantalla completa y botón de descarga.
- 🎙️ **Notas de Voz**: Graba mensajes de voz directamente desde el micrófono de tu celular o computadora.
- 🟢 **Estado En Línea / Desconectado**: Indicador en tiempo real de cuándo la otra persona está en la app.
- ✍️ **Indicador "Escribiendo..."**: Muestra cuando la otra persona redacta un mensaje.
- 🔐 **Historial Persistente**: Base de datos local SQLite para que no pierdas ningún recuerdo ni conversación.
-📱 **Diseño Responsive Móvil & PC**: Interfaz moderna basada en el tema oscuro de WhatsApp.

---

## 🚀 Inicio Rápido Local

### 1. Requisitos
- Node.js (v18 o superior) instalado.

### 2. Instalación de dependencias
```bash
npm install
```

### 3. Iniciar el servidor
```bash
npm start
```

Abre tu navegador en: [http://localhost:3000](http://localhost:3000)

---

## 📱 Acceso desde el Teléfono Móvil en la misma red Wi-Fi

1. En tu computadora, averigua tu IP local ejecutando en la consola:
   - **Windows**: `ipconfig` (busca `Dirección IPv4`, por ejemplo `192.168.1.50`).
2. Desde el celular conectado al mismo Wi-Fi, abre el navegador e ingresa:
   `http://192.168.1.50:3000`

---

## 🌐 Publicar en Internet (Para usar desde cualquier lugar)

Si quieren chatear cuando estén fuera de casa:

### Opción A: Con Cloudflare Tunnel (Gratis y Seguro)
1. Descarga `cloudflared`.
2. Ejecuta:
   ```bash
   cloudflared tunnel --url http://localhost:3000
   ```
3. Cloudflare te dará un enlace seguro `https://xxxx.trycloudflare.com` que ambos pueden abrir desde sus teléfonos desde cualquier lugar.

### Opción B: Desplegar en Render / Railway / Vercel
Puedes subir este repositorio a GitHub y conectarlo a **Render.com** o **Railway.app** como un servicio Web de Node.js totalmente gratis.

---

## 📤 Subir a tu Repositorio de GitHub

Ejecuta los siguientes comandos en la consola dentro de la carpeta del proyecto (`c:\Scripts\MSN`):

```bash
git init
git add .
git commit -m "Inicializar Chat Papá & Hija v1.0"
git branch -M main
git remote add origin TU_URL_DE_GITHUB.git
git push -u origin main
```

---

## 📄 Licencia
Este proyecto es de uso privado y libre bajo la licencia MIT.
