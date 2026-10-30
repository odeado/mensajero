# Actualización del flujo de chat

## Cambios

- Un botón + reúne las siete funciones del compositor. Escape, cerrar y pulsar fuera cierran el panel; se conserva la navegación con teclado.
- El mismo panel incluye avisos y cierre de sesión; el encabezado conserva cambiar de chat, buscar y perfil.
- Mensajes e imágenes se consultan por chat antes de limitar resultados. El álbum pagina las fotos de esa conversación y la búsqueda permite cargar más historial.
- El destinatario queda capturado antes de comprimir fotos, preparar audio, crear partidas o leer tarjetas. Un envío rechazado conserva el contenido para reintentar, incluso tras recargar si IndexedDB está disponible.
- Solo se marcan como leídos mensajes del chat visible. Android conserva los avisos del otro chat.
- La partida debe crearse antes de enviar su invitación. Las reglas restringen mensajes y partidas a los miembros de su conversación.

## Actualizar una instalación existente

Las reglas locales y los cambios web no actualizan automáticamente Firebase ni GitHub Pages. Antes de publicar, cerrar clientes antiguos y respaldar Firestore con el procedimiento habitual del proyecto.

1. Instalar las dependencias con `npm ci` y ejecutar las pruebas (`npm test`, `npm run test:rules`).
2. Usar credenciales administrativas locales mediante `GOOGLE_APPLICATION_CREDENTIALS` y definir `GCLOUD_PROJECT=familia-a9fb6`. No guardar claves de servicio en este repositorio.
3. Ejecutar `npm run migrate:chats` para ver el plan sin escribir. Los mensajes sin `chatId` pertenecen históricamente a `papa_hija`. Las partidas heredan el chat de su invitación. Las partidas huérfanas sin invitación se reportan y quedan inaccesibles; no se asigna una conversación por conjetura.
4. Revisar los conteos y ejecutar `npm run migrate:chats -- --apply`. El proceso es repetible, agrega `chatId` a documentos existentes y no elimina datos.
5. Publicar índices con `npx firebase deploy --only firestore:indexes --project familia-a9fb6` y esperar a que estén listos en la consola. Publicar reglas con `npx firebase deploy --only firestore:rules --project familia-a9fb6`.
6. Publicar la web actualizada y distribuir el APK actualizado. Los clientes antiguos que consulten toda la colección recibirán un error de permisos con las nuevas reglas. Evitar dejar esos clientes abiertos durante el cambio.
7. Verificar con las tres cuentas: Hija no lee Amor y viceversa, Papá conserva ambos historiales, los leídos solo afectan el chat abierto, y Android notifica el otro chat.

## Componente de funciones

El compositor usa los colores existentes, controles de 46 px, radio de 24 px y foco visible. El panel tiene una cuadrícula de cuatro columnas (tres en pantallas menores a 360 px), botones con texto y una etiqueta accesible. El botón + anuncia su estado con `aria-expanded`. Durante la grabación siguen disponibles cancelar y enviar en la barra de voz.

Las pruebas de reglas y la migración usan las dependencias de desarrollo; la web publicada sigue siendo estática y no requiere Node.

## Validación de esta actualización

- Siete pruebas automatizadas aprobadas: dos de destino/leídos, cuatro de reglas y una de migración (incluye simulación sin escritura y repetición segura).
- Navegador conectado a emuladores: acceso, historial independiente, borradores por chat, envío, rechazo, persistencia al recargar, reintento y creación de partida comprobados.
- Interfaz revisada a 320 y 360 píxeles de ancho. Capturas en `preview/` (solo locales).
- APK debug 1.5.0 compilado con el SDK local. Sonido y recepción con pantalla apagada requieren comprobación en un teléfono real.
- Las herramientas de desarrollo instaladas reportan diez avisos transitivos de `npm audit` (cinco altos y cinco moderados). No se incluyen en la web estática ni en el APK. No se aplicaron degradaciones automáticas ni cambios mayores forzados a esas herramientas.
