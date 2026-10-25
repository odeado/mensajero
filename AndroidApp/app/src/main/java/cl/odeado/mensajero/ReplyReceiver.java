package cl.odeado.mensajero;

import android.app.Notification;
import android.app.NotificationManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Bundle;

import androidx.core.app.NotificationCompat;
import androidx.core.app.RemoteInput;

import org.json.JSONArray;

/** Respuesta rápida y "Marcar leído" desde la notificación, sin abrir la app. */
public class ReplyReceiver extends BroadcastReceiver {

    static final String ACTION_REPLY = "cl.odeado.mensajero.REPLY";
    static final String ACTION_READ = "cl.odeado.mensajero.READ";

    @Override
    public void onReceive(Context context, Intent intent) {
        final Context c = context.getApplicationContext();
        final String action = intent.getAction();
        String text = null;
        Bundle results = RemoteInput.getResultsFromIntent(intent);
        if (results != null) {
            CharSequence cs = results.getCharSequence(ChatMonitorService.KEY_REPLY);
            if (cs != null) text = cs.toString().trim();
        }
        final String reply = text;
        final PendingResult pr = goAsync();
        new Thread(() -> {
            SharedPreferences p = ChatMonitorService.prefs(c);
            try {
                JSONArray pend = new JSONArray(p.getString("pendientes", "[]"));
                if (ACTION_REPLY.equals(action) && reply != null && !reply.isEmpty()) {
                    ChatApi.sendText(c, reply);
                }
                for (int i = 0; i < pend.length(); i++) {
                    try { ChatApi.markRead(c, pend.getJSONObject(i).getString("id")); } catch (Exception ignored) {}
                }
                ChatMonitorService.clearPending(c);
            } catch (Exception e) {
                // Avisar que no se pudo enviar, sin perder los mensajes pendientes
                Notification n = new NotificationCompat.Builder(c, ChatMonitorService.CH_MSG)
                        .setSmallIcon(R.drawable.ic_stat_chat)
                        .setContentTitle("⚠️ No se pudo enviar")
                        .setContentText(reply != null ? "“" + reply + "” — ábrelo en la app" : "Revisa la conexión")
                        .setColor(ChatMonitorService.C_PINK)
                        .setContentIntent(ChatMonitorService.openAppIntent(c))
                        .setAutoCancel(true)
                        .build();
                ((NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE))
                        .notify(ChatMonitorService.NOTIF_MSG_ID, n);
            } finally {
                pr.finish();
            }
        }).start();
    }
}
