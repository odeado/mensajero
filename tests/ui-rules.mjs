import { readFile } from 'node:fs/promises';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8080') throw new Error('Solo se permite el emulador local.');
let rules = await readFile('firestore.rules', 'utf8');
if (process.argv.includes('--deny-send')) rules = rules.replace('allow create: if inChat(request.resource.data.chatId)', 'allow create: if false');
const env = await initializeTestEnvironment({ projectId: 'familia-a9fb6', firestore: { rules } });
await env.cleanup();
console.log(process.argv.includes('--deny-send') ? 'Envíos rechazados para probar reintentos.' : 'Reglas locales restauradas.');
