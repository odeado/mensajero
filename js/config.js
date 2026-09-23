// ==========================================================
//  CONFIGURACIÓN — edita SOLO este archivo
// ==========================================================

// 1) Pega aquí la config de tu proyecto Firebase
//    (Consola Firebase → Configuración del proyecto → Tus apps → Web)
export const firebaseConfig = {
  apiKey: "AIzaSyDdjpQBmzHzPH-8_GZk699E_VKh6gcMhzM",
  authDomain: "familia-a9fb6.firebaseapp.com",
  projectId: "familia-a9fb6",
  storageBucket: "familia-a9fb6.firebasestorage.app",
  messagingSenderId: "1024161963947",
  appId: "1:1024161963947:web:5b01e8038dabe090defcee",
  measurementId: "G-WJMHD7799X"
};

// 2) Los DOS "usuarios". No necesitan ser correos reales:
//    solo son el nombre de usuario en Firebase (nadie los ve ni reciben nada).
//    Deben ser los mismos que pongas en firestore.rules
export const FAMILY = {
  "papa@chat-familia.local": { name: "Papá", avatar: "👨" },
  "hija@chat-familia.local": { name: "Hija", avatar: "👧" }
};
