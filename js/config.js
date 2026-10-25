// ==========================================================
//  CONFIGURACIÓN
// ==========================================================

export const firebaseConfig = {
  apiKey: "AIzaSyDdjpQBmzHzPH-8_GZk699E_VKh6gcMhzM",
  authDomain: "familia-a9fb6.firebaseapp.com",
  projectId: "familia-a9fb6",
  storageBucket: "familia-a9fb6.firebasestorage.app",
  messagingSenderId: "1024161963947",
  appId: "1:1024161963947:web:5b01e8038dabe090defcee",
  measurementId: "G-WJMHD7799X"
};

// Los 3 usuarios del sistema:
// Papá habla con Hija y con Amor de forma 1-a-1 totalmente aislada.
export const FAMILY = {
  "papa@chat-familia.local": { name: "Papá", avatar: "👨" },
  "hija@chat-familia.local": { name: "Hija", avatar: "👧" },
  "amor@chat-familia.local": { name: "Amor", avatar: "❤️" }
};

// Define los canales 1-a-1 permitidos y quiénes participan
export const CHATS = {
  "papa_hija": {
    participants: ["papa@chat-familia.local", "hija@chat-familia.local"],
    name: "Chat con Hija"
  },
  "papa_amor": {
    participants: ["papa@chat-familia.local", "amor@chat-familia.local"],
    name: "Chat con Amor"
  }
};
