document.addEventListener('DOMContentLoaded', () => {
  const socket = io();

  // DOM Elements
  const profileModal = document.getElementById('profile-modal');
  const chatApp = document.getElementById('chat-app');
  const profileBtns = document.querySelectorAll('.profile-btn');
  const headerAvatar = document.getElementById('header-avatar');
  const chatPartnerName = document.getElementById('chat-partner-name');
  const statusDot = document.getElementById('status-dot');
  const statusText = document.getElementById('status-text');
  const switchUserBtn = document.getElementById('switch-user-btn');

  const messagesContainer = document.getElementById('messages-container');
  const messagesList = document.getElementById('messages-list');
  const messageInput = document.getElementById('message-input');
  const btnSend = document.getElementById('btn-send');
  const btnAttach = document.getElementById('btn-attach');
  const fileInput = document.getElementById('file-input');
  const btnMic = document.getElementById('btn-mic');

  // Typing Bar
  const typingIndicator = document.getElementById('typing-indicator');
  const typingText = document.getElementById('typing-text');

  // Audio Recording Bar
  const recordingBar = document.getElementById('recording-bar');
  const recordingTimer = document.getElementById('recording-timer');
  const btnCancelRec = document.getElementById('btn-cancel-rec');
  const btnSendRec = document.getElementById('btn-send-rec');

  // Lightbox Modal
  const lightboxModal = document.getElementById('lightbox-modal');
  const lightboxImg = document.getElementById('lightbox-img');
  const lightboxClose = document.getElementById('lightbox-close');
  const lightboxDownload = document.getElementById('lightbox-download');

  // State Variables
  let currentUser = localStorage.getItem('chat_user') || null;
  let typingTimeout = null;
  let mediaRecorder = null;
  let audioChunks = [];
  let recordingInterval = null;
  let recordingSeconds = 0;

  // Initialize Profile or Load Chat
  if (currentUser) {
    initChat(currentUser);
  } else {
    profileModal.classList.remove('hidden');
  }

  // Profile Button Clicks
  profileBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const user = btn.dataset.user;
      localStorage.setItem('chat_user', user);
      currentUser = user;
      profileModal.classList.add('hidden');
      initChat(user);
    });
  });

  // Switch User Button
  switchUserBtn.addEventListener('click', () => {
    localStorage.removeItem('chat_user');
    location.reload();
  });

  // Initialize Chat Logic
  function initChat(username) {
    chatApp.classList.remove('hidden');

    const partner = username === 'Papá' ? 'Hija' : 'Papá';
    const partnerAvatar = partner === 'Papá' ? '👨' : '👧';

    headerAvatar.textContent = partnerAvatar;
    chatPartnerName.textContent = partner === 'Papá' ? 'Mi Papá' : 'Mi Hija';

    // Notify server of active user
    socket.emit('user_connected', username);
    socket.emit('mark_read', { reader: username });
  }

  // Listen for online users
  socket.on('online_users', (activeUsers) => {
    if (!currentUser) return;
    const partner = currentUser === 'Papá' ? 'Hija' : 'Papá';
    const isPartnerOnline = activeUsers.includes(partner);

    if (isPartnerOnline) {
      statusDot.className = 'status-dot online';
      statusText.textContent = 'En línea';
    } else {
      statusDot.className = 'status-dot offline';
      statusText.textContent = 'Desconectado';
    }
  });

  // Load Message History
  socket.on('message_history', (messages) => {
    messagesList.innerHTML = '';
    messages.forEach(msg => appendMessage(msg));
    scrollToBottom();
  });

  // Receive Single Message
  socket.on('receive_message', (msg) => {
    appendMessage(msg);
    scrollToBottom();

    // Mark read if chat is active
    if (msg.sender !== currentUser) {
      socket.emit('mark_read', { reader: currentUser });
    }
  });

  // Messages Read status update
  socket.on('messages_read', ({ reader }) => {
    if (reader !== currentUser) {
      document.querySelectorAll('.read-ticks').forEach(ticks => {
        ticks.classList.add('read');
        ticks.innerHTML = '✓✓';
      });
    }
  });

  // Handle Typing status
  socket.on('user_typing', ({ sender, isTyping }) => {
    if (sender !== currentUser) {
      if (isTyping) {
        typingText.textContent = `${sender === 'Papá' ? 'Papá' : 'Hija'} está escribiendo...`;
        typingIndicator.classList.remove('hidden');
      } else {
        typingIndicator.classList.add('hidden');
      }
    }
  });

  // Send Text Message
  function sendTextMessage() {
    const text = messageInput.value.trim();
    if (!text || !currentUser) return;

    socket.emit('send_message', {
      sender: currentUser,
      type: 'text',
      content: text
    });

    messageInput.value = '';
    socket.emit('typing', { sender: currentUser, isTyping: false });
  }

  btnSend.addEventListener('click', sendTextMessage);
  messageInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      sendTextMessage();
    }
  });

  // Typing event listener
  messageInput.addEventListener('input', () => {
    if (!currentUser) return;
    socket.emit('typing', { sender: currentUser, isTyping: true });

    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => {
      socket.emit('typing', { sender: currentUser, isTyping: false });
    }, 2000);
  });

  // Handle Photo Attachment
  btnAttach.addEventListener('click', () => {
    fileInput.click();
  });

  fileInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const formData = new FormData();
    formData.append('file', file);

    try {
      const res = await fetch('/api/upload', {
        method: 'POST',
        body: formData
      });
      const data = await res.json();

      if (data.fileUrl) {
        socket.emit('send_message', {
          sender: currentUser,
          type: 'image',
          content: data.fileUrl
        });
      }
    } catch (err) {
      console.error('Error al subir imagen:', err);
    } finally {
      fileInput.value = '';
    }
  });

  // Handle Voice Recording
  btnMic.addEventListener('click', async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaRecorder = new MediaRecorder(stream);
      audioChunks = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          audioChunks.push(e.data);
        }
      };

      mediaRecorder.start();
      startRecordingUI();
    } catch (err) {
      alert('No se pudo acceder al micrófono. Verifica los permisos.');
      console.error('Microphone error:', err);
    }
  });

  function startRecordingUI() {
    recordingBar.classList.remove('hidden');
    recordingSeconds = 0;
    updateRecordingTimer();
    recordingInterval = setInterval(() => {
      recordingSeconds++;
      updateRecordingTimer();
    }, 1000);
  }

  function updateRecordingTimer() {
    const mins = String(Math.floor(recordingSeconds / 60)).padStart(2, '0');
    const secs = String(recordingSeconds % 60).padStart(2, '0');
    recordingTimer.textContent = `${mins}:${secs}`;
  }

  function stopRecordingUI() {
    recordingBar.classList.add('hidden');
    clearInterval(recordingInterval);
    if (mediaRecorder && mediaRecorder.stream) {
      mediaRecorder.stream.getTracks().forEach(track => track.stop());
    }
  }

  btnCancelRec.addEventListener('click', () => {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      mediaRecorder.stop();
    }
    stopRecordingUI();
    audioChunks = [];
  });

  btnSendRec.addEventListener('click', () => {
    if (!mediaRecorder || mediaRecorder.state === 'inactive') return;

    mediaRecorder.onstop = async () => {
      stopRecordingUI();
      const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
      const formData = new FormData();
      formData.append('file', audioBlob, 'voice-note.webm');

      try {
        const res = await fetch('/api/upload', {
          method: 'POST',
          body: formData
        });
        const data = await res.json();

        if (data.fileUrl) {
          socket.emit('send_message', {
            sender: currentUser,
            type: 'audio',
            content: data.fileUrl
          });
        }
      } catch (err) {
        console.error('Error al subir nota de voz:', err);
      }
    };

    mediaRecorder.stop();
  });

  // Append Message to DOM
  function appendMessage(msg) {
    const isSent = msg.sender === currentUser;
    const bubble = document.createElement('div');
    bubble.className = `message-bubble ${isSent ? 'sent' : 'received'}`;

    const formattedTime = new Date(msg.timestamp).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit'
    });

    let bodyHTML = '';

    if (msg.type === 'text') {
      bodyHTML = `<div class="msg-content">${escapeHTML(msg.content)}</div>`;
    } else if (msg.type === 'image') {
      bodyHTML = `
        <div class="img-msg-container" onclick="openLightbox('${msg.content}')">
          <img src="${msg.content}" alt="Foto adjunta" loading="lazy">
        </div>
      `;
    } else if (msg.type === 'audio') {
      const audioId = `audio-${msg.id || Math.random().toString(36).substr(2, 9)}`;
      bodyHTML = `
        <div class="audio-msg-container">
          <button class="audio-play-btn" onclick="toggleAudio('${audioId}')">
            <i class="fa-solid fa-play" id="icon-${audioId}"></i>
          </button>
          <div class="audio-waveform">
            <div class="audio-progress" onclick="seekAudio(event, '${audioId}')">
              <div class="audio-progress-bar" id="bar-${audioId}"></div>
            </div>
            <span class="audio-duration" id="dur-${audioId}">Nota de voz</span>
          </div>
          <audio id="${audioId}" src="${msg.content}" preload="metadata"></audio>
        </div>
      `;
    }

    const senderHTML = !isSent ? `<div class="msg-sender">${msg.sender}</div>` : '';
    const readTicks = isSent ? `<span class="read-ticks ${msg.read ? 'read' : ''}">${msg.read ? '✓✓' : '✓'}</span>` : '';

    bubble.innerHTML = `
      ${senderHTML}
      ${bodyHTML}
      <div class="msg-meta">
        <span>${formattedTime}</span>
        ${readTicks}
      </div>
    `;

    messagesList.appendChild(bubble);

    // Setup audio listener if audio type
    if (msg.type === 'audio') {
      setTimeout(() => setupAudioEvents(`audio-${msg.id}`), 50);
    }
  }

  // Audio Playback Helpers
  window.toggleAudio = (id) => {
    const audio = document.getElementById(id);
    const icon = document.getElementById(`icon-${id}`);
    if (!audio) return;

    if (audio.paused) {
      // Pause any other playing audios
      document.querySelectorAll('audio').forEach(a => {
        if (a !== audio) {
          a.pause();
          a.currentTime = 0;
          const otherIcon = document.getElementById(`icon-${a.id}`);
          if (otherIcon) otherIcon.className = 'fa-solid fa-play';
        }
      });

      audio.play();
      if (icon) icon.className = 'fa-solid fa-pause';
    } else {
      audio.pause();
      if (icon) icon.className = 'fa-solid fa-play';
    }
  };

  function setupAudioEvents(id) {
    const audio = document.getElementById(id);
    if (!audio) return;

    const bar = document.getElementById(`bar-${id}`);
    const icon = document.getElementById(`icon-${id}`);
    const dur = document.getElementById(`dur-${id}`);

    audio.addEventListener('loadedmetadata', () => {
      if (dur && audio.duration) {
        const mins = Math.floor(audio.duration / 60);
        const secs = String(Math.floor(audio.duration % 60)).padStart(2, '0');
        dur.textContent = `${mins}:${secs}`;
      }
    });

    audio.addEventListener('timeupdate', () => {
      if (bar && audio.duration) {
        const pct = (audio.currentTime / audio.duration) * 100;
        bar.style.width = `${pct}%`;
      }
    });

    audio.addEventListener('ended', () => {
      if (icon) icon.className = 'fa-solid fa-play';
      if (bar) bar.style.width = '0%';
    });
  }

  window.seekAudio = (e, id) => {
    const audio = document.getElementById(id);
    if (!audio || !audio.duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const pos = (e.clientX - rect.left) / rect.width;
    audio.currentTime = pos * audio.duration;
  };

  // Lightbox functions
  window.openLightbox = (src) => {
    lightboxImg.src = src;
    lightboxDownload.href = src;
    lightboxModal.classList.remove('hidden');
  };

  lightboxClose.addEventListener('click', () => {
    lightboxModal.classList.add('hidden');
  });

  lightboxModal.addEventListener('click', (e) => {
    if (e.target === lightboxModal) {
      lightboxModal.classList.add('hidden');
    }
  });

  // Helpers
  function scrollToBottom() {
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }

  function escapeHTML(str) {
    return str.replace(/[&<>'"]/g,
      tag => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        "'": '&#39;',
        '"': '&quot;'
      }[tag] || tag)
    );
  }
});
