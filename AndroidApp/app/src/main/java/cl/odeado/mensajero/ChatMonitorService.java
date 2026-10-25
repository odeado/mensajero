package cl.odeado.mensajero;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ServiceInfo;
import android.graphics.Color;
import android.os.Build;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;

import androidx.core.app.NotificationCompat;
import androidx.core.app.Person;
import androidx.core.app.RemoteInput;
import androidx.core.content.ContextCompat;

import org.json.JSONArray;
import org.json.JSONObject;

import java.text.SimpleDateFormat;
import java.util.Calendar;
import java.util.Date;
import java.util.List;
import java.util.Locale;

/**
 * Servicio en primer plano: cada 20 s revisa si la hija escribió y su estado
 * (en línea / escribiendo / última vez). Notificación fija con el estado y aviso
 * tipo chat por cada mensaje, con respuesta rápida desde la notificación.
 */
public class ChatMonitorService extends Service {

    public static final String ACTION_REFRESH = "cl.odeado.mensajero.REFRESH";

    static final long POLL_MS = 20_000;
    static final long ONLINE_WINDOW_MS = 75_000; // igual que la web

    static final String CH_STATUS = "chat_estado";
    static final String CH_MSG = "chat_mensajes";
    static final int NOTIF_STATUS_ID = 1, NOTIF_MSG_ID = 2;
    static final String KEY_REPLY = "respuesta";
    static final String PREFS = "chat_monitor";

    static final int C_PINK = Color.rgb(236, 72, 153), C_OK = Color.rgb(34, 197, 94), C_GRAY = Color.rgb(100, 116, 139);

    /** true mientras la app está en pantalla: ahí no hace falta avisar (ya se ve el chat). */
    public static volatile boolean appVisible = false;

    public interface Listener { void onUpdate(String text, int color); }
    private static volatile Listener listener;
    private static volatile String lastText = "Conectando con el chat...";
    private static volatile int lastColor = 0xFF1E293B;

    public static void setListener(Listener l) {
        listener = l;
        if (l != null) l.onUpdate(lastText, lastColor);
    }

    private HandlerThread thread;
    private Handler worker, main;
    private PowerManager.WakeLock wakeLock;
    private volatile Notification lastNotif;

    private final Runnable pollTask = new Runnable() {
        @Override public void run() {
            poll();
            worker.removeCallbacks(this);
            worker.postDelayed(this, POLL_MS);
        }
    };

    // ---------- API estática ----------
    public static void start(Context c) {
        prefs(c).edit().putBoolean("activo", true).apply();
        ContextCompat.startForegroundService(c, new Intent(c, ChatMonitorService.class));
    }

    public static void refresh(Context c) {
        ContextCompat.startForegroundService(c, new Intent(c, ChatMonitorService.class).setAction(ACTION_REFRESH));
    }

    public static void stop(Context c) {
        prefs(c).edit().putBoolean("activo", false).apply();
        c.stopService(new Intent(c, ChatMonitorService.class));
    }

    public static boolean isEnabled(Context c) {
        return prefs(c).getBoolean("activo", true);
    }

    static SharedPreferences prefs(Context c) {
        return c.getSharedPreferences(PREFS, MODE_PRIVATE);
    }

    /** Al abrir la app o responder: se borran los mensajes pendientes de la notificación. */
    public static void clearPending(Context c) {
        prefs(c).edit().putString("pendientes", "[]").apply();
        ((NotificationManager) c.getSystemService(NOTIFICATION_SERVICE)).cancel(NOTIF_MSG_ID);
    }

    // ---------- Ciclo de vida ----------
    @Override
    public void onCreate() {
        super.onCreate();
        createChannels(this);
        goForeground(buildStatus("Mensajero", "Conectando...", C_GRAY));
        main = new Handler(Looper.getMainLooper());
        thread = new HandlerThread("chat-poll");
        thread.start();
        worker = new Handler(thread.getLooper());
        PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
        wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "Mensajero:poll");
        wakeLock.setReferenceCounted(false);
        worker.post(pollTask);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (lastNotif != null) goForeground(lastNotif);
        String action = intent != null ? intent.getAction() : null;
        if (ACTION_REFRESH.equals(action) && worker != null) {
            worker.removeCallbacks(pollTask);
            worker.post(pollTask);
        }
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        if (worker != null) worker.removeCallbacksAndMessages(null);
        if (thread != null) thread.quitSafely();
        if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) { return null; }

    // ---------- Consulta ----------
    private void poll() {
        if (!ChatApi.hasSession(this)) {
            publish("🔒 Inicia sesión en la app", "Abre Mensajero e ingresa tu clave una vez para recibir avisos", C_GRAY);
            return;
        }
        wakeLock.acquire(30_000);
        SharedPreferences p = prefs(this);
        try {
            // 1) Mensajes nuevos
            String since = p.getString("ultimoTs", "");
            if (since.isEmpty()) {
                since = ChatApi.nowIso();               // primera vez: no avisar el historial
                p.edit().putString("ultimoTs", since).apply();
            }
            List<ChatApi.Message> nuevos = ChatApi.messagesSince(this, since);
            String me = ChatApi.myUid(this);
            JSONArray pend = new JSONArray(p.getString("pendientes", "[]"));
            boolean hayNuevos = false;
            for (ChatApi.Message m : nuevos) {
                since = m.createdAt;
                if (m.senderUid.equals(me)) continue;
                if (appVisible) continue;           // la está viendo en pantalla
                pend.put(new JSONObject().put("id", m.id).put("text", m.preview())
                        .put("ts", ChatApi.parseTs(m.createdAt)));
                hayNuevos = true;
            }
            while (pend.length() > 25) pend.remove(0);
            p.edit().putString("ultimoTs", since).putString("pendientes", pend.toString()).apply();
            if (hayNuevos) showMessages(this, pend, false);

            // 2) Estado de la hija
            ChatApi.Status st = ChatApi.partnerStatus(this);
            String avatar = st != null && !st.avatar.isEmpty() ? st.avatar : ChatApi.PARTNER_AVATAR;
            String titulo;
            int color;
            boolean online = st != null && st.online && System.currentTimeMillis() - st.lastSeenMs < ONLINE_WINDOW_MS;
            if (online && st.typing) {
                titulo = avatar + " " + ChatApi.PARTNER_NAME + " · ✍️ está escribiendo...";
                color = C_PINK;
            } else if (online) {
                titulo = avatar + " " + ChatApi.PARTNER_NAME + " · 🟢 En línea";
                color = C_OK;
            } else {
                titulo = avatar + " " + ChatApi.PARTNER_NAME + " · últ. vez " + lastSeen(st == null ? 0 : st.lastSeenMs);
                color = C_GRAY;
            }
            String texto;
            if (pend.length() > 0) {
                JSONObject last = pend.getJSONObject(pend.length() - 1);
                texto = "💬 " + pend.length() + (pend.length() == 1 ? " mensaje sin leer" : " mensajes sin leer")
                        + " · " + last.optString("text");
            } else {
                texto = "Sin mensajes nuevos";
            }
            publish(titulo, texto, color);
        } catch (ChatApi.AuthException e) {
            ChatApi.signOut(this);
            publish("🔒 La sesión expiró", "Abre Mensajero e ingresa tu clave de nuevo", C_GRAY);
        } catch (Exception e) {
            publish("📶 Sin conexión · reintentando", "No se pudo revisar el chat", C_GRAY);
        } finally {
            if (wakeLock.isHeld()) wakeLock.release();
        }
    }

    static String lastSeen(long ms) {
        if (ms <= 0) return "—";
        Calendar now = Calendar.getInstance();
        Calendar c = Calendar.getInstance();
        c.setTimeInMillis(ms);
        boolean hoy = now.get(Calendar.YEAR) == c.get(Calendar.YEAR) && now.get(Calendar.DAY_OF_YEAR) == c.get(Calendar.DAY_OF_YEAR);
        now.add(Calendar.DAY_OF_YEAR, -1);
        boolean ayer = now.get(Calendar.YEAR) == c.get(Calendar.YEAR) && now.get(Calendar.DAY_OF_YEAR) == c.get(Calendar.DAY_OF_YEAR);
        String hora = new SimpleDateFormat("HH:mm", Locale.getDefault()).format(new Date(ms));
        if (hoy) return "hoy " + hora;
        if (ayer) return "ayer " + hora;
        return new SimpleDateFormat("dd/MM HH:mm", Locale.getDefault()).format(new Date(ms));
    }

    // ---------- Notificación de mensajes (estilo chat + respuesta rápida) ----------
    static void showMessages(Context c, JSONArray pend, boolean silent) throws Exception {
        if (pend.length() == 0) return;
        Person yo = new Person.Builder().setName("Tú").build();
        Person hija = new Person.Builder().setName(ChatApi.PARTNER_AVATAR + " " + ChatApi.PARTNER_NAME).setKey("hija").build();
        NotificationCompat.MessagingStyle style = new NotificationCompat.MessagingStyle(yo);
        for (int i = 0; i < pend.length(); i++) {
            JSONObject o = pend.getJSONObject(i);
            style.addMessage(o.optString("text"), o.optLong("ts", System.currentTimeMillis()), hija);
        }

        RemoteInput ri = new RemoteInput.Builder(KEY_REPLY).setLabel("Responder a " + ChatApi.PARTNER_NAME).build();
        int mutable = Build.VERSION.SDK_INT >= Build.VERSION_CODES.S ? PendingIntent.FLAG_MUTABLE : 0;
        PendingIntent replyPi = PendingIntent.getBroadcast(c, 10,
                new Intent(c, ReplyReceiver.class).setAction(ReplyReceiver.ACTION_REPLY),
                PendingIntent.FLAG_UPDATE_CURRENT | mutable);
        NotificationCompat.Action reply = new NotificationCompat.Action.Builder(0, "Responder", replyPi)
                .addRemoteInput(ri)
                .setAllowGeneratedReplies(true)
                .setSemanticAction(NotificationCompat.Action.SEMANTIC_ACTION_REPLY)
                .build();
        PendingIntent readPi = PendingIntent.getBroadcast(c, 11,
                new Intent(c, ReplyReceiver.class).setAction(ReplyReceiver.ACTION_READ),
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        Notification n = new NotificationCompat.Builder(c, CH_MSG)
                .setSmallIcon(R.drawable.ic_stat_chat)
                .setStyle(style)
                .setColor(C_PINK)
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setCategory(NotificationCompat.CATEGORY_MESSAGE)
                .setContentIntent(openAppIntent(c))
                .setAutoCancel(true)
                .setOnlyAlertOnce(silent)
                .setSilent(silent)
                .addAction(reply)
                .addAction(0, "Marcar leído", readPi)
                .build();
        ((NotificationManager) c.getSystemService(NOTIFICATION_SERVICE)).notify(NOTIF_MSG_ID, n);
    }

    static void createChannels(Context c) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm = c.getSystemService(NotificationManager.class);
        NotificationChannel st = new NotificationChannel(CH_STATUS, "Estado de " + ChatApi.PARTNER_NAME, NotificationManager.IMPORTANCE_LOW);
        st.setDescription("Notificación fija: en línea, escribiendo o última vez");
        st.setShowBadge(false);
        nm.createNotificationChannel(st);

        NotificationChannel msg = new NotificationChannel(CH_MSG, "Mensajes", NotificationManager.IMPORTANCE_HIGH);
        msg.setDescription("Aviso por cada mensaje nuevo, con respuesta rápida");
        msg.enableVibration(true);
        msg.setVibrationPattern(new long[]{0, 120, 60, 120});
        msg.enableLights(true);
        msg.setLightColor(C_PINK);
        nm.createNotificationChannel(msg);
    }

    static PendingIntent openAppIntent(Context c) {
        Intent i = new Intent(c, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        return PendingIntent.getActivity(c, 0, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private Notification buildStatus(String title, String text, int color) {
        PendingIntent refresh = PendingIntent.getService(this, 1,
                new Intent(this, ChatMonitorService.class).setAction(ACTION_REFRESH),
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        NotificationCompat.Builder b = new NotificationCompat.Builder(this, CH_STATUS)
                .setSmallIcon(R.drawable.ic_stat_chat)
                .setContentTitle(title)
                .setContentText(text)
                .setColor(color)
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setShowWhen(false)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .setCategory(NotificationCompat.CATEGORY_STATUS)
                .setContentIntent(openAppIntent(this))
                .addAction(0, "Actualizar", refresh);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            b.setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE);
        }
        return b.build();
    }

    private void goForeground(Notification n) {
        lastNotif = n;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIF_STATUS_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC);
        } else {
            startForeground(NOTIF_STATUS_ID, n);
        }
    }

    private void publish(String title, String text, int color) {
        NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        lastNotif = buildStatus(title, text, color);
        nm.notify(NOTIF_STATUS_ID, lastNotif);
        lastText = title + "\n" + text;
        lastColor = Color.rgb(Color.red(color) * 2 / 5, Color.green(color) * 2 / 5, Color.blue(color) * 2 / 5);
        final Listener l = listener;
        final String t = lastText;
        final int col = lastColor;
        if (l != null) main.post(() -> l.onUpdate(t, col));
    }
}
