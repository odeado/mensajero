package cl.odeado.mensajero;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.security.SecureRandom;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.Locale;
import java.util.TimeZone;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/**
 * Acceso al chat (mismo proyecto Firebase que la web) por la API REST:
 * inicio de sesión, mensajes nuevos, estado en línea y respuesta rápida.
 * Solo se guarda el token de sesión (cifrado), nunca la clave.
 */
public class ChatApi {

    static final String API_KEY = "AIzaSyDdjpQBmzHzPH-8_GZk699E_VKh6gcMhzM";
    static final String PROJECT = "familia-a9fb6";
    static final String DOCS = "projects/" + PROJECT + "/databases/(default)/documents";
    static final String BASE = "https://firestore.googleapis.com/v1/" + DOCS;
    static final String MY_EMAIL = "papa@chat-familia.local";
    static final String DEFAULT_CHAT = "papa_hija";
    static final String WEB_URL = "https://odeado.github.io/mensajero/";

    public static class AuthException extends IOException {
        public AuthException(String m) { super(m); }
    }

    public static class Message {
        public String id = "", senderUid = "", type = "", text = "", game = "", createdAt = "", chatId = "";

        public String preview() {
            if ("image".equals(type)) return "📷 Foto";
            if ("game".equals(type)) return "🎮 Te invitó a jugar " + gameName(game);
            return text;
        }
    }

    public static class Status {
        public boolean online, typing;
        public long lastSeenMs;
        public String avatar = "";
    }

    /** Un chat 1-a-1: la web envía esta información para que los avisos muestren al partner correcto. */
    public static class ChatInfo {
        public final String id, partnerName, partnerAvatar, partnerEmail;

        ChatInfo(String id, String partnerName, String partnerAvatar, String partnerEmail) {
            this.id = id;
            this.partnerName = partnerName;
            this.partnerAvatar = partnerAvatar;
            this.partnerEmail = partnerEmail;
        }
    }

    static String gameName(String g) {
        if (g == null) return "";
        switch (g) {
            case "gato": return "Gato";
            case "cuatro": return "4 en línea";
            case "damas": return "Damas";
            case "cachipun": return "Cachipún";
            case "jenga": return "Jenga";
            default: return g;
        }
    }

    // ------------------------------------------------------------------ sesión
    private static final String PREFS = "chat_sesion";
    private static final String KEY_ALIAS = "mensajero_sesion";
    private static String idToken;
    private static long idTokenExpiry;

    static SharedPreferences prefs(Context c) {
        return c.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    public static boolean hasSession(Context c) {
        return !prefs(c).getString("refresh_enc", "").isEmpty();
    }

    public static String myUid(Context c) {
        return prefs(c).getString("uid", "");
    }

    public static synchronized void signIn(Context c, String password) throws Exception {
        JSONObject body = new JSONObject()
                .put("email", MY_EMAIL).put("password", password).put("returnSecureToken", true);
        JSONObject r = postJson("https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=" + API_KEY,
                body.toString(), null);
        saveSession(c, r.getString("refreshToken"), r.getString("localId"));
        idToken = r.getString("idToken");
        idTokenExpiry = System.currentTimeMillis() + (Long.parseLong(r.optString("expiresIn", "3600")) - 300) * 1000L;
    }

    public static synchronized void signOut(Context c) {
        prefs(c).edit().clear().apply();
        idToken = null;
        idTokenExpiry = 0;
    }

    private static synchronized String token(Context c) throws Exception {
        if (idToken != null && System.currentTimeMillis() < idTokenExpiry) return idToken;
        String refresh = decrypt(prefs(c).getString("refresh_enc", ""));
        if (refresh.isEmpty()) throw new AuthException("Sin sesión");
        String form = "grant_type=refresh_token&refresh_token=" + URLEncoder.encode(refresh, "UTF-8");
        JSONObject r;
        try {
            r = request("POST", "https://securetoken.googleapis.com/v1/token?key=" + API_KEY, form,
                    "application/x-www-form-urlencoded", null);
        } catch (HttpException e) {
            if (e.code == 400 || e.code == 401 || e.code == 403) throw new AuthException("La sesión expiró");
            throw e;
        }
        idToken = r.getString("id_token");
        idTokenExpiry = System.currentTimeMillis() + (Long.parseLong(r.optString("expires_in", "3600")) - 300) * 1000L;
        String newRefresh = r.optString("refresh_token", refresh);
        if (!newRefresh.equals(refresh)) saveSession(c, newRefresh, r.optString("user_id", myUid(c)));
        return idToken;
    }

    private static void saveSession(Context c, String refresh, String uid) throws Exception {
        prefs(c).edit().putString("refresh_enc", encrypt(refresh)).putString("uid", uid).apply();
    }

    // ------------------------------------------------------------------ chats
    private static final String KEY_CHATS = "chats_json";
    private static final String KEY_ACTIVE_CHAT = "chat_activo";

    /** La web envía aquí sus chats (con el nombre/avatar del partner) al abrir o cambiar de chat. */
    public static synchronized void configureChats(Context c, String json) {
        if (json == null || json.trim().isEmpty()) return;
        try { new JSONArray(json); } catch (Exception e) { return; }
        prefs(c).edit().putString(KEY_CHATS, json).apply();
    }

    /** Chat que el usuario está viendo ahora mismo en la app. */
    public static synchronized void setActiveChat(Context c, String chatId) {
        if (chatId == null || chatId.trim().isEmpty()) return;
        if (chat(c, chatId) == null) return;
        prefs(c).edit().putString(KEY_ACTIVE_CHAT, chatId).apply();
    }

    public static String activeChatId(Context c) {
        String id = prefs(c).getString(KEY_ACTIVE_CHAT, DEFAULT_CHAT);
        if (chat(c, id) != null) return id;
        List<ChatInfo> todos = chats(c);
        return todos.isEmpty() ? DEFAULT_CHAT : todos.get(0).id;
    }

    public static ChatInfo activePartner(Context c) {
        ChatInfo ci = chat(c, activeChatId(c));
        if (ci != null) return ci;
        List<ChatInfo> todos = chats(c);
        return todos.isEmpty() ? defaults().get(0) : todos.get(0);
    }

    public static ChatInfo chat(Context c, String chatId) {
        if (chatId == null) return null;
        for (ChatInfo ci : chats(c)) if (ci.id.equals(chatId)) return ci;
        return null;
    }

    public static List<ChatInfo> chats(Context c) {
        List<ChatInfo> out = new ArrayList<>();
        String json = prefs(c).getString(KEY_CHATS, "");
        if (!json.isEmpty()) {
            try {
                JSONArray arr = new JSONArray(json);
                for (int i = 0; i < arr.length(); i++) {
                    JSONObject o = arr.optJSONObject(i);
                    if (o == null) continue;
                    String id = o.optString("id", "");
                    if (id.isEmpty()) continue;
                    out.add(new ChatInfo(id,
                            o.optString("partnerName", ""),
                            o.optString("partnerAvatar", ""),
                            o.optString("partnerEmail", "")));
                }
            } catch (Exception ignored) {}
        }
        return out.isEmpty() ? defaults() : out;
    }

    /** Valores de respaldo mientras la web no ha enviado su configuración. */
    private static List<ChatInfo> defaults() {
        List<ChatInfo> out = new ArrayList<>();
        out.add(new ChatInfo("papa_hija", "Hija", "👧", "hija@chat-familia.local"));
        out.add(new ChatInfo("papa_amor", "Amor", "❤️", "amor@chat-familia.local"));
        return out;
    }

    // ------------------------------------------------------------------ mensajes
    /** Mensajes con createdAt posterior a "sinceIso", del más antiguo al más nuevo (sin las fotos en base64). */
    public static List<Message> messagesSince(Context c, String sinceIso) throws Exception {
        JSONObject q = new JSONObject().put("structuredQuery", new JSONObject()
                .put("select", new JSONObject().put("fields", new JSONArray()
                        .put(field("senderUid")).put(field("type")).put(field("text"))
                        .put(field("game")).put(field("createdAt")).put(field("chatId"))))
                .put("from", new JSONArray().put(new JSONObject().put("collectionId", "messages")))
                .put("where", new JSONObject().put("fieldFilter", new JSONObject()
                        .put("field", field("createdAt"))
                        .put("op", "GREATER_THAN")
                        .put("value", new JSONObject().put("timestampValue", sinceIso))))
                .put("orderBy", new JSONArray().put(new JSONObject()
                        .put("field", field("createdAt")).put("direction", "ASCENDING")))
                .put("limit", 100));
        String raw = requestRaw("POST", BASE + ":runQuery", q.toString(), "application/json", token(c));
        JSONArray arr = new JSONArray(raw);
        List<Message> out = new ArrayList<>();
        for (int i = 0; i < arr.length(); i++) {
            JSONObject d = arr.getJSONObject(i).optJSONObject("document");
            if (d == null) continue;
            JSONObject f = d.optJSONObject("fields");
            if (f == null) continue;
            Message m = new Message();
            String name = d.getString("name");
            m.id = name.substring(name.lastIndexOf('/') + 1);
            m.senderUid = str(f, "senderUid");
            m.type = str(f, "type");
            m.text = str(f, "text");
            m.game = str(f, "game");
            m.createdAt = str(f, "createdAt");
            m.chatId = str(f, "chatId");
            out.add(m);
        }
        return out;
    }

    /** Estado (en línea / escribiendo / última vez) del partner del chat indicado. */
    public static Status partnerStatus(Context c, ChatInfo partner) throws Exception {
        JSONObject r = request("GET", BASE + "/status", null, null, token(c));
        JSONArray docs = r.optJSONArray("documents");
        String me = myUid(c);
        if (docs == null) return null;

        List<JSONObject> candidatos = new ArrayList<>();
        JSONObject elegido = null;
        boolean hayEmails = false;
        for (int i = 0; i < docs.length(); i++) {
            JSONObject d = docs.getJSONObject(i);
            String name = d.getString("name");
            if (name.endsWith("/" + me)) continue;
            JSONObject f = d.optJSONObject("fields");
            if (f == null) continue;
            candidatos.add(f);
            String email = str(f, "email");
            if (!email.isEmpty()) hayEmails = true;
            if (partner != null && !partner.partnerEmail.isEmpty()
                    && partner.partnerEmail.equalsIgnoreCase(email)) {
                elegido = f;
                break;
            }
        }
        // Respaldo para estados antiguos sin email: coincidencia por chat activo o único candidato.
        if (elegido == null && partner != null) {
            for (JSONObject f : candidatos) {
                if (partner.id.equals(str(f, "activeChat"))) { elegido = f; break; }
            }
        }
        if (elegido == null && !hayEmails && candidatos.size() == 1
                && str(candidatos.get(0), "activeChat").isEmpty()) {
            elegido = candidatos.get(0); // estado muy antiguo, sin email ni chat: único candidato
        }
        if (elegido == null) return null; // el partner aún no tiene estado: no mostrar a otra persona

        Status s = new Status();
        s.online = "true".equals(str(elegido, "online"));
        s.typing = "true".equals(str(elegido, "typing"));
        s.avatar = str(elegido, "avatar");
        s.lastSeenMs = parseTs(str(elegido, "lastSeen"));
        return s;
    }

    /** Envía un mensaje de texto (mismas reglas que la web: createdAt = hora del servidor). */
    public static void sendText(Context c, String text, String chatId) throws Exception {
        String id = autoId();
        if (chatId == null || chatId.isEmpty()) chatId = activeChatId(c);
        JSONObject fields = new JSONObject()
                .put("chatId", new JSONObject().put("stringValue", chatId))
                .put("senderUid", new JSONObject().put("stringValue", myUid(c)))
                .put("type", new JSONObject().put("stringValue", "text"))
                .put("text", new JSONObject().put("stringValue", text))
                .put("read", new JSONObject().put("booleanValue", false));
        JSONObject write = new JSONObject()
                .put("update", new JSONObject().put("name", DOCS + "/messages/" + id).put("fields", fields))
                .put("updateTransforms", new JSONArray().put(new JSONObject()
                        .put("fieldPath", "createdAt").put("setToServerValue", "REQUEST_TIME")))
                .put("currentDocument", new JSONObject().put("exists", false));
        request("POST", BASE + ":commit", new JSONObject().put("writes", new JSONArray().put(write)).toString(),
                "application/json", token(c));
    }

    public static void sendText(Context c, String text) throws Exception {
        sendText(c, text, activeChatId(c));
    }

    /** Marca como leído un mensaje recibido (los ✓✓ de la web). */
    public static void markRead(Context c, String messageId) throws Exception {
        JSONObject write = new JSONObject()
                .put("update", new JSONObject().put("name", DOCS + "/messages/" + messageId)
                        .put("fields", new JSONObject().put("read", new JSONObject().put("booleanValue", true))))
                .put("updateMask", new JSONObject().put("fieldPaths", new JSONArray().put("read")))
                .put("currentDocument", new JSONObject().put("exists", true));
        request("POST", BASE + ":commit", new JSONObject().put("writes", new JSONArray().put(write)).toString(),
                "application/json", token(c));
    }

    // ------------------------------------------------------------------ utilidades
    static String nowIso() {
        SimpleDateFormat f = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US);
        f.setTimeZone(TimeZone.getTimeZone("UTC"));
        return f.format(new Date());
    }

    static long parseTs(String v) {
        if (v == null || v.length() < 19) return 0;
        try {
            SimpleDateFormat f = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss", Locale.US);
            f.setTimeZone(TimeZone.getTimeZone("UTC"));
            return f.parse(v.substring(0, 19)).getTime();
        } catch (Exception e) {
            return 0;
        }
    }

    private static String autoId() {
        String chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
        SecureRandom r = new SecureRandom();
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < 20; i++) sb.append(chars.charAt(r.nextInt(chars.length())));
        return sb.toString();
    }

    private static JSONObject field(String path) throws Exception {
        return new JSONObject().put("fieldPath", path);
    }

    private static String str(JSONObject f, String k) {
        JSONObject o = f.optJSONObject(k);
        if (o == null) return "";
        if (o.has("stringValue")) return o.optString("stringValue", "");
        if (o.has("booleanValue")) return o.optString("booleanValue", "");
        if (o.has("timestampValue")) return o.optString("timestampValue", "");
        if (o.has("integerValue")) return o.optString("integerValue", "");
        return "";
    }

    static class HttpException extends IOException {
        final int code;
        HttpException(int code, String msg) { super("HTTP " + code + ": " + msg); this.code = code; }
    }

    private static JSONObject postJson(String url, String body, String bearer) throws Exception {
        try {
            return request("POST", url, body, "application/json", bearer);
        } catch (HttpException e) {
            if (e.code == 400) throw new AuthException("Clave incorrecta");
            throw e;
        }
    }

    private static JSONObject request(String method, String url, String body, String contentType, String bearer) throws Exception {
        String raw = requestRaw(method, url, body, contentType, bearer);
        return raw.isEmpty() ? new JSONObject() : new JSONObject(raw);
    }

    private static String requestRaw(String method, String url, String body, String contentType, String bearer) throws Exception {
        HttpURLConnection con = (HttpURLConnection) new URL(url).openConnection();
        con.setConnectTimeout(15000);
        con.setReadTimeout(15000);
        con.setRequestMethod(method);
        if (bearer != null) con.setRequestProperty("Authorization", "Bearer " + bearer);
        if (body != null) {
            con.setDoOutput(true);
            con.setRequestProperty("Content-Type", contentType + "; charset=utf-8");
            try (OutputStream os = con.getOutputStream()) {
                os.write(body.getBytes(StandardCharsets.UTF_8));
            }
        }
        int code = con.getResponseCode();
        InputStream is = code >= 200 && code < 300 ? con.getInputStream() : con.getErrorStream();
        StringBuilder sb = new StringBuilder();
        if (is != null) {
            try (BufferedReader br = new BufferedReader(new InputStreamReader(is, StandardCharsets.UTF_8))) {
                String line;
                while ((line = br.readLine()) != null) sb.append(line);
            }
        }
        con.disconnect();
        if (code == 401 || code == 403) {
            idToken = null;
            if (code == 403) throw new HttpException(code, "Sin permiso (revisa las reglas de Firestore)");
        }
        if (code < 200 || code >= 300) throw new HttpException(code, sb.length() > 200 ? sb.substring(0, 200) : sb.toString());
        return sb.toString();
    }

    // ------------------------------------------------------------------ cifrado (Android Keystore)
    private static SecretKey key() throws Exception {
        KeyStore ks = KeyStore.getInstance("AndroidKeyStore");
        ks.load(null);
        if (ks.containsAlias(KEY_ALIAS)) {
            return ((KeyStore.SecretKeyEntry) ks.getEntry(KEY_ALIAS, null)).getSecretKey();
        }
        KeyGenerator kg = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        kg.init(new KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .build());
        return kg.generateKey();
    }

    private static String encrypt(String plain) throws Exception {
        Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
        c.init(Cipher.ENCRYPT_MODE, key());
        return Base64.encodeToString(c.getIV(), Base64.NO_WRAP) + ":"
                + Base64.encodeToString(c.doFinal(plain.getBytes(StandardCharsets.UTF_8)), Base64.NO_WRAP);
    }

    private static String decrypt(String stored) {
        try {
            if (stored == null || !stored.contains(":")) return "";
            String[] p = stored.split(":", 2);
            Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
            c.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(128, Base64.decode(p[0], Base64.NO_WRAP)));
            return new String(c.doFinal(Base64.decode(p[1], Base64.NO_WRAP)), StandardCharsets.UTF_8);
        } catch (Exception e) {
            return "";
        }
    }
}
