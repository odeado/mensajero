// Captura el destino antes de cualquier permiso, lectura o compresión asíncrona.
export function captureDestination(user, chatId) {
  if (!user?.uid || !chatId) throw new Error('Inicia sesión para enviar.');
  return Object.freeze({ uid: user.uid, chatId });
}

export function unreadInChat(docs, uid, chatId) {
  return docs.filter((doc) => {
    const message = doc.data();
    return message.chatId === chatId && message.senderUid !== uid && !message.read;
  });
}
