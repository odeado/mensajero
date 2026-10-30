// Solo conserva envíos rechazados; Firestore mantiene su propia cola sin conexión.
function database() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('mensajero-reintentos', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('messages', { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function access(mode, action) {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction('messages', mode);
      const request = action(tx.objectStore('messages'));
      tx.oncomplete = () => resolve(request.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally { db.close(); }
}
export const loadFailed = () => access('readonly', (store) => store.getAll());
export const saveFailed = (id, item) => access('readwrite', (store) => store.put({ id, fields: item.fields, target: item.target }));
export const removeFailed = (id) => access('readwrite', (store) => store.delete(id));
