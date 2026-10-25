package cl.odeado.mensajero;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** Reinicia los avisos al encender el teléfono o al actualizar la app. */
public class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        if (ChatApi.hasSession(context) && ChatMonitorService.isEnabled(context)) {
            ChatMonitorService.start(context);
        }
    }
}
