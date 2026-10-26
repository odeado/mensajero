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
import android.provider.MediaStore;
import android.provider.Settings;
import android.text.InputType;
import android.webkit.JavascriptInterface;
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
import androidx.core.content.FileProvider;
import androidx.swiperefreshlayout.widget.SwipeRefreshLayout;

import java.io.File;

public class MainActivity extends AppCompatActivity {

    private static final int REQ_NOTIF = 101;
    private static final int REQ_FILE = 102;
    private static final int REQ_GALLERY = 103;
    private static final int REQ_CAMERA = 104;

    private WebView webView;
    private SwipeRefreshLayout swipeRefresh;
    private TextView statusBar;
    private ValueCallback<Uri[]> fileCallback;
    private Uri cameraOutputUri;
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

        mostrarVersionUnaVez();

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
        // La web avisa aquí qué chat está viendo para que la notificación fija muestre
        // el nombre y el estado correctos (Hija o Amor).
        webView.addJavascriptInterface(new NativeBridge(), "MensajeroNative");
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
            // Fotos: elegir entre cámara y galería. Otros archivos (.msncard) usan el selector normal.
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = callback;

                if (wantsImage(params)) {
                    new AlertDialog.Builder(MainActivity.this)
                            .setTitle("Enviar foto")
                            .setItems(new String[]{"📷 Tomar foto", "🖼️ Elegir de la galería"}, (d, which) -> {
                                if (which == 0) launchCamera();
                                else launchGallery();
                            })
                            .setNegativeButton("Cancelar", (d, w) -> cancelFileChooser())
                            .setOnCancelListener(d -> cancelFileChooser())
                            .show();
                    return true;
                }

                try {
                    startActivityForResult(params.createIntent(), REQ_FILE);
                } catch (Exception e) {
                    cancelFileChooser();
                    Toast.makeText(MainActivity.this, "No se pudo abrir el selector de archivos", Toast.LENGTH_SHORT).show();
                    return false;
                }
                return true;
            }
        });
    }

    /** true si el selector que abrió la web es para fotos (y no para .msncard/.json). */
    private boolean wantsImage(WebChromeClient.FileChooserParams params) {
        String[] types = params.getAcceptTypes();
        if (types == null || types.length == 0) return true;
        boolean imagen = false;
        for (String t : types) {
            if (t == null) continue;
            String v = t.trim().toLowerCase();
            if (v.isEmpty()) continue;
            if (v.contains("msncard") || v.contains("json")) return false;
            if (v.startsWith("image/") || v.equals("*/*")) imagen = true;
        }
        return imagen;
    }

    private void launchCamera() {
        try {
            File dir = new File(getCacheDir(), "fotos");
            if (!dir.exists() && !dir.mkdirs()) throw new IllegalStateException("sin carpeta");
            File foto = new File(dir, "foto_" + System.currentTimeMillis() + ".jpg");
            cameraOutputUri = FileProvider.getUriForFile(this, getPackageName() + ".fileprovider", foto);
            Intent i = new Intent(MediaStore.ACTION_IMAGE_CAPTURE);
            i.putExtra(MediaStore.EXTRA_OUTPUT, cameraOutputUri);
            i.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_READ_URI_PERMISSION);
            startActivityForResult(i, REQ_CAMERA);
        } catch (Exception e) {
            cameraOutputUri = null;
            cancelFileChooser();
            Toast.makeText(this, "No se pudo abrir la cámara", Toast.LENGTH_SHORT).show();
        }
    }

    private void launchGallery() {
        try {
            Intent i = new Intent(Intent.ACTION_GET_CONTENT);
            i.addCategory(Intent.CATEGORY_OPENABLE);
            i.setType("image/*");
            startActivityForResult(i, REQ_GALLERY);
        } catch (Exception e) {
            cancelFileChooser();
            Toast.makeText(this, "No se pudo abrir la galería", Toast.LENGTH_SHORT).show();
        }
    }

    private void cancelFileChooser() {
        finishFileChooser(null);
        cameraOutputUri = null;
    }

    private void finishFileChooser(Uri[] result) {
        if (fileCallback != null) {
            fileCallback.onReceiveValue(result);
            fileCallback = null;
        }
    }

    // Puente con la web: mantiene sincronizado el chat activo y los avisos nativos.
    private class NativeBridge {
        @JavascriptInterface
        public void configure(String chatsJson, String activeChatId) {
            ChatApi.configureChats(MainActivity.this, chatsJson);
            if (activeChatId != null && !activeChatId.isEmpty()) {
                ChatApi.setActiveChat(MainActivity.this, activeChatId);
            }
            refreshMonitor();
        }

        @JavascriptInterface
        public void setActiveChat(String chatId) {
            ChatApi.setActiveChat(MainActivity.this, chatId);
            refreshMonitor();
        }
    }

    private void refreshMonitor() {
        if (ChatApi.hasSession(this) && ChatMonitorService.isEnabled(this)) {
            try {
                ChatMonitorService.refresh(this);
            } catch (Exception ignored) {
                // Android 12+ puede bloquear el inicio en segundo plano; se reintenta al abrir la app.
            }
        }
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

        if (requestCode == REQ_CAMERA) {
            Uri[] result = null;
            if (resultCode == RESULT_OK && cameraOutputUri != null) result = new Uri[]{cameraOutputUri};
            finishFileChooser(result);
            cameraOutputUri = null;
            return;
        }

        if (requestCode == REQ_GALLERY) {
            Uri[] result = null;
            if (resultCode == RESULT_OK && data != null) {
                if (data.getClipData() != null) {
                    int n = data.getClipData().getItemCount();
                    result = new Uri[n];
                    for (int i = 0; i < n; i++) result[i] = data.getClipData().getItemAt(i).getUri();
                } else if (data.getData() != null) {
                    result = new Uri[]{data.getData()};
                }
            }
            finishFileChooser(result);
            return;
        }

        if (requestCode == REQ_FILE) {
            finishFileChooser(WebChromeClient.FileChooserParams.parseResult(resultCode, data));
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
                        + "Para avisarte cuando te escriban aunque la app esté cerrada, ingresa tu clave del chat una vez. "
                        + "Solo se guarda la sesión (cifrada), no la clave.")
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
        boolean optimizado = isBatteryOptimized();
        String[] items = {
                on ? "Desactivar avisos" : "Activar avisos",
                "Probar sonido del aviso",
                optimizado ? "Permitir avisos con pantalla apagada" : "Segundo plano: ya está permitido ✓",
                "Cerrar sesión de los avisos"
        };
        new AlertDialog.Builder(this)
                .setTitle("Avisos del chat · v" + appVersion())
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
                    } else if (which == 1) {
                        ChatMonitorService.showTest(this);
                    } else if (which == 2) {
                        if (optimizado) pedirBateria();
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

    /** true si el sistema todavía puede dormir la app y retrasar los avisos. */
    private boolean isBatteryOptimized() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return false;
        PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
        return !pm.isIgnoringBatteryOptimizations(getPackageName());
    }

    private String appVersion() {
        try {
            return getPackageManager().getPackageInfo(getPackageName(), 0).versionName;
        } catch (Exception e) {
            return "?";
        }
    }

    /** Avisa una sola vez, al abrir una versión recién instalada, qué build quedó en el teléfono. */
    private void mostrarVersionUnaVez() {
        SharedPreferences p = ChatMonitorService.prefs(this);
        String v = appVersion();
        if (v.equals(p.getString("versionVista", ""))) return;
        p.edit().putString("versionVista", v).apply();
        Toast.makeText(this, "Mensajero v" + v + " — fotos con cámara y galería 📷", Toast.LENGTH_LONG).show();
    }

    private void pedirBateria() {
        try {
            startActivity(new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
                    Uri.parse("package:" + getPackageName())));
        } catch (Exception e) {
            startActivity(new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS));
        }
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
        if (!isBatteryOptimized()) return;
        SharedPreferences p = ChatMonitorService.prefs(this);
        if (p.getBoolean("pidioBateria", false)) return;
        p.edit().putBoolean("pidioBateria", true).apply();
        new AlertDialog.Builder(this)
                .setTitle("Mantener los avisos activos")
                .setMessage("Para que los mensajes lleguen y suenen aunque la app esté minimizada o la pantalla apagada, "
                        + "permite que Mensajero funcione sin restricción de batería.")
                .setPositiveButton("Permitir", (d, w) -> pedirBateria())
                .setNegativeButton("Ahora no", null)
                .show();
    }

    @Override
    public void onBackPressed() {
        if (webView.canGoBack()) webView.goBack();
        else super.onBackPressed();
    }
}
