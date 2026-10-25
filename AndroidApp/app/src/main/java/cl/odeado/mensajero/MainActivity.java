package cl.odeado.mensajero;

import android.Manifest;
import android.annotation.SuppressLint;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import android.provider.Settings;
import android.text.InputType;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.TextView;
import android.widget.Toast;

import androidx.annotation.NonNull;
import androidx.appcompat.app.AlertDialog;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import androidx.swiperefreshlayout.widget.SwipeRefreshLayout;

public class MainActivity extends AppCompatActivity {

    private static final int REQ_NOTIF = 101;
    private static final int REQ_FILE = 102;

    private WebView webView;
    private SwipeRefreshLayout swipeRefresh;
    private TextView statusBar;
    private ValueCallback<Uri[]> fileCallback;
    private long pausedAt = 0;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);

        statusBar = findViewById(R.id.statusBar);
        swipeRefresh = findViewById(R.id.swipeRefresh);
        webView = findViewById(R.id.webView);

        ChatMonitorService.createChannels(this);
        setupWebView();
        // El chat tiene su propio scroll: deslizar para recargar molestaría al leer mensajes
        swipeRefresh.setEnabled(false);

        statusBar.setOnClickListener(v -> {
            if (!ChatApi.hasSession(this)) { askPassword(null); return; }
            if (ChatMonitorService.isEnabled(this)) ChatMonitorService.refresh(this);
        });
        statusBar.setOnLongClickListener(v -> { showOptions(); return true; });

        if (savedInstanceState == null) webView.loadUrl(ChatApi.WEB_URL);

        if (needsNotificationPermission()) {
            ActivityCompat.requestPermissions(this, new String[]{Manifest.permission.POST_NOTIFICATIONS}, REQ_NOTIF);
        } else {
            afterPermissions();
        }
    }

    private void afterPermissions() {
        if (!ChatApi.hasSession(this)) askPassword(null);
        else startMonitoringIfEnabled();
    }

    @Override
    protected void onResume() {
        super.onResume();
        ChatMonitorService.appVisible = true;
        ChatMonitorService.clearPending(this);
        ChatMonitorService.setListener((text, color) -> {
            statusBar.setText(text);
            statusBar.setBackgroundColor(color);
        });
        if (!ChatMonitorService.isEnabled(this)) showDisabled();
        if (pausedAt > 0 && System.currentTimeMillis() - pausedAt > 5 * 60_000) webView.reload();
    }

    @Override
    protected void onPause() {
        super.onPause();
        ChatMonitorService.appVisible = false;
        ChatMonitorService.setListener(null);
        pausedAt = System.currentTimeMillis();
    }

    private void showDisabled() {
        statusBar.setText("⏸ Avisos desactivados — mantén presionado aquí para activarlos");
        statusBar.setBackgroundColor(0xFF1E293B);
    }

    @SuppressLint("SetJavaScriptEnabled")
    private void setupWebView() {
        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setSupportZoom(false);
        webView.setBackgroundColor(0xFF0A0E1A);
        webView.setWebViewClient(new WebViewClient() {
            @Override public void onPageFinished(WebView view, String url) { swipeRefresh.setRefreshing(false); }

            // Los enlaces del chat se abren en el navegador, no dentro del chat.
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return openExternally(request.getUrl());
            }

            @SuppressWarnings("deprecation")
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                return openExternally(Uri.parse(url));
            }
        });
        webView.setWebChromeClient(new WebChromeClient() {
            // Para poder enviar fotos desde el chat (botón 📷 de la web)
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = callback;
                try {
                    startActivityForResult(params.createIntent(), REQ_FILE);
                } catch (Exception e) {
                    fileCallback = null;
                    Toast.makeText(MainActivity.this, "No se pudo abrir la galería", Toast.LENGTH_SHORT).show();
                    return false;
                }
                return true;
            }
        });
    }

    // Abre el enlace fuera de la app (navegador, correo, teléfono) para no salir del chat.
    private boolean openExternally(Uri uri) {
        if (uri == null) return false;
        String scheme = uri.getScheme();
        if (scheme == null) return false;
        scheme = scheme.toLowerCase();
        if (!"http".equals(scheme) && !"https".equals(scheme)
                && !"mailto".equals(scheme) && !"tel".equals(scheme)) {
            return false;
        }
        // La propia página del chat se queda dentro de la app (y no intercepta redirecciones al abrir).
        String appHost = Uri.parse(ChatApi.WEB_URL).getHost();
        if (uri.getHost() != null && uri.getHost().equalsIgnoreCase(appHost)) return false;
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, uri));
        } catch (Exception e) {
            Toast.makeText(this, "No hay una app para abrir ese enlace", Toast.LENGTH_SHORT).show();
        }
        return true;
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == REQ_FILE && fileCallback != null) {
            fileCallback.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode, data));
            fileCallback = null;
        }
    }

    // ---------- Sesión para los avisos ----------
    private void askPassword(String error) {
        final EditText input = new EditText(this);
        input.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD);
        input.setHint("Clave de Papá");
        FrameLayout box = new FrameLayout(this);
        int pad = (int) (20 * getResources().getDisplayMetrics().density);
        box.setPadding(pad, pad / 2, pad, 0);
        box.addView(input);
        new AlertDialog.Builder(this)
                .setTitle("🔔 Activar avisos")
                .setMessage((error != null ? "⚠️ " + error + "\n\n" : "")
                        + "Para avisarte cuando escriba " + ChatApi.PARTNER_NAME
                        + " aunque la app esté cerrada, ingresa tu clave del chat una vez. Solo se guarda la sesión (cifrada), no la clave.")
                .setView(box)
                .setCancelable(false)
                .setPositiveButton("Activar", (d, w) -> signIn(input.getText().toString()))
                .setNegativeButton("Ahora no", (d, w) ->
                        statusBar.setText("🔒 Avisos sin activar — toca aquí para ingresar tu clave"))
                .show();
    }

    private void signIn(String password) {
        if (password.isEmpty()) { askPassword("Escribe la clave"); return; }
        statusBar.setText("Iniciando sesión...");
        final Handler ui = new Handler(Looper.getMainLooper());
        new Thread(() -> {
            String err = null;
            try {
                ChatApi.signIn(this, password);
            } catch (ChatApi.AuthException e) {
                err = "Clave incorrecta";
            } catch (Exception e) {
                err = "Sin conexión, intenta de nuevo";
            }
            final String error = err;
            ui.post(() -> {
                if (error != null) { askPassword(error); return; }
                Toast.makeText(this, "🔔 Avisos activados", Toast.LENGTH_SHORT).show();
                ChatMonitorService.prefs(this).edit().remove("ultimoTs").putString("pendientes", "[]").apply();
                ChatMonitorService.start(this);
                askBatteryOptimizationOnce();
            });
        }).start();
    }

    private void showOptions() {
        boolean on = ChatMonitorService.isEnabled(this);
        String[] items = {on ? "Desactivar avisos" : "Activar avisos", "Cerrar sesión de los avisos"};
        new AlertDialog.Builder(this)
                .setTitle("Avisos del chat")
                .setItems(items, (d, which) -> {
                    if (which == 0) {
                        if (on) { ChatMonitorService.stop(this); showDisabled(); }
                        else {
                            ChatMonitorService.start(this);
                            ChatMonitorService.setListener((text, color) -> {
                                statusBar.setText(text);
                                statusBar.setBackgroundColor(color);
                            });
                        }
                    } else {
                        ChatMonitorService.stop(this);
                        ChatApi.signOut(this);
                        ChatMonitorService.prefs(this).edit().putBoolean("activo", true).apply();
                        statusBar.setText("🔒 Avisos sin activar — toca aquí para ingresar tu clave");
                        statusBar.setBackgroundColor(0xFF1E293B);
                    }
                })
                .show();
    }

    private void startMonitoringIfEnabled() {
        if (ChatApi.hasSession(this) && ChatMonitorService.isEnabled(this)) {
            ChatMonitorService.start(this);
            askBatteryOptimizationOnce();
        }
    }

    private boolean needsNotificationPermission() {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
                && ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
                != PackageManager.PERMISSION_GRANTED;
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, @NonNull String[] permissions, @NonNull int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == REQ_NOTIF) {
            if (grantResults.length == 0 || grantResults[0] != PackageManager.PERMISSION_GRANTED) {
                Toast.makeText(this, "Sin permiso de notificaciones no recibirás los mensajes", Toast.LENGTH_LONG).show();
            }
            afterPermissions();
        }
    }

    @SuppressLint("BatteryLife")
    private void askBatteryOptimizationOnce() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return;
        SharedPreferences p = ChatMonitorService.prefs(this);
        if (p.getBoolean("pidioBateria", false)) return;
        PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
        if (pm.isIgnoringBatteryOptimizations(getPackageName())) return;
        p.edit().putBoolean("pidioBateria", true).apply();
        new AlertDialog.Builder(this)
                .setTitle("Mantener los avisos activos")
                .setMessage("Para que los mensajes lleguen aunque el teléfono esté en reposo, permite que Mensajero funcione sin restricción de batería.")
                .setPositiveButton("Permitir", (d, w) -> {
                    try {
                        startActivity(new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
                                Uri.parse("package:" + getPackageName())));
                    } catch (Exception e) {
                        startActivity(new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS));
                    }
                })
                .setNegativeButton("Ahora no", null)
                .show();
    }

    @Override
    public void onBackPressed() {
        if (webView.canGoBack()) webView.goBack();
        else super.onBackPressed();
    }
}
