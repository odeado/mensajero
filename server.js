const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const sqlite3 = require('sqlite3').verbose();

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  maxHttpBufferSize: 1e8 // 100 MB max payload for Socket.io
});

const PORT = process.env.PORT || 3000;

// Ensure uploads folder exists
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(uploadsDir));
app.use(express.json());

// Initialize SQLite Database
const dbPath = path.join(__dirname, 'database.sqlite');
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Error al conectar con SQLite:', err.message);
  } else {
    console.log('Conectado a la base de datos SQLite.');
  }
});

// Create tables if not exist
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sender TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'text',
      content TEXT NOT NULL,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      read INTEGER DEFAULT 0
    )
  `);
});

// Configure Multer for File Uploads (Photos and Audio)
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname) || (file.mimetype.includes('audio') ? '.webm' : '.jpg');
    cb(null, `${uniqueSuffix}${ext}`);
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 25 * 1024 * 1024 } // 25MB max file size
});

// Endpoint for uploading files (images/audios)
app.post('/api/upload', upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No se subió ningún archivo' });
  }

  const fileType = req.file.mimetype.startsWith('image/')
    ? 'image'
    : req.file.mimetype.startsWith('audio/')
    ? 'audio'
    : 'file';

  const fileUrl = `/uploads/${req.file.filename}`;
  res.json({ fileUrl, type: fileType, originalName: req.file.originalname });
});

// Track Online Users
const onlineUsers = new Map(); // socket.id -> username

io.on('connection', (socket) => {
  console.log('Nuevo cliente conectado:', socket.id);

  // User joins room with their name ("Papá" or "Hija")
  socket.on('user_connected', (username) => {
    onlineUsers.set(socket.id, username);

    // Notify everyone of online users list
    const activeUsernames = Array.from(onlineUsers.values());
    io.emit('online_users', activeUsernames);

    // Load message history from DB
    db.all(`SELECT * FROM messages ORDER BY id ASC`, [], (err, rows) => {
      if (err) {
        console.error('Error al obtener mensajes:', err.message);
        return;
      }
      // Convertir timestamp de SQLite a formato ISO 8601 para compatibilidad con el browser
      const fixedRows = rows.map(row => ({
        ...row,
        timestamp: row.timestamp ? row.timestamp.replace(' ', 'T') + 'Z' : new Date().toISOString()
      }));
      socket.emit('message_history', fixedRows);
    });
  });

  // Handle incoming message (text, image, audio)
  socket.on('send_message', (data) => {
    const { sender, type, content } = data;
    if (!sender || !content) return;

    const query = `INSERT INTO messages (sender, type, content, read) VALUES (?, ?, ?, 0)`;
    db.run(query, [sender, type || 'text', content], function (err) {
      if (err) {
        console.error('Error al guardar mensaje:', err.message);
        return;
      }

      const newMsg = {
        id: this.lastID,
        sender,
        type: type || 'text',
        content,
        timestamp: new Date().toISOString(),
        read: 0
      };

      // Broadcast message to all clients
      io.emit('receive_message', newMsg);
    });
  });

  // Handle typing status
  socket.on('typing', (data) => {
    socket.broadcast.emit('user_typing', data);
  });

  // Handle mark messages as read
  socket.on('mark_read', (data) => {
    const { reader } = data; // the user reading the messages
    db.run(`UPDATE messages SET read = 1 WHERE sender != ? AND read = 0`, [reader], (err) => {
      if (!err) {
        io.emit('messages_read', { reader });
      }
    });
  });

  // Handle disconnect
  socket.on('disconnect', () => {
    onlineUsers.delete(socket.id);
    const activeUsernames = Array.from(onlineUsers.values());
    io.emit('online_users', activeUsernames);
    console.log('Cliente desconectado:', socket.id);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`=================================`);
  console.log(`💬 Chat Papá & Hija en línea en: http://localhost:${PORT}`);
  console.log(`=================================`);
});
