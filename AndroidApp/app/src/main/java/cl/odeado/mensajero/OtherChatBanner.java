package cl.odeado.mensajero;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** Aviso dentro de la app: solo mensajes de otras conversaciones conocidas. */
final class OtherChatBanner {
    static String text(String visibleChat, List<String> pendingChats, Map<String, String> names) {
        if (visibleChat == null || visibleChat.isEmpty()) return "";
        Map<String, Integer> counts = new LinkedHashMap<>();
        int total = 0;
        for (String chat : pendingChats) {
            if (visibleChat.equals(chat) || !names.containsKey(chat)) continue;
            counts.put(chat, counts.getOrDefault(chat, 0) + 1);
            total++;
        }
        if (total == 0) return "";
        if (counts.size() == 1) {
            String name = names.get(counts.keySet().iterator().next());
            return "💬 " + name + " · " + total + (total == 1 ? " mensaje nuevo" : " mensajes nuevos");
        }
        return "💬 " + total + " mensajes nuevos en otros chats";
    }
}
