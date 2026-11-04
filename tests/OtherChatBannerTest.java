package cl.odeado.mensajero;

import java.util.Arrays;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;

public class OtherChatBannerTest {
    private static void expect(String expected, String actual) {
        if (!expected.equals(actual)) throw new AssertionError("Esperado: " + expected + " / Recibido: " + actual);
    }
    public static void main(String[] args) {
        Map<String, String> names = new LinkedHashMap<>();
        names.put("papa_amor", "Amor");
        names.put("papa_hija", "Hija");
        expect("", OtherChatBanner.text("papa_amor", Collections.emptyList(), names));
        expect("", OtherChatBanner.text("papa_amor", Arrays.asList("papa_amor", "papa_amor"), names));
        expect("💬 Hija · 1 mensaje nuevo", OtherChatBanner.text("papa_amor", Arrays.asList("papa_amor", "papa_hija"), names));
        expect("💬 Hija · 2 mensajes nuevos", OtherChatBanner.text("papa_amor", Arrays.asList("papa_hija", "papa_hija"), names));
        // Al abrir Hija, el aviso de Hija desaparece inmediatamente.
        expect("", OtherChatBanner.text("papa_hija", Arrays.asList("papa_hija"), names));
        expect("💬 Amor · 1 mensaje nuevo", OtherChatBanner.text("papa_hija", Arrays.asList("papa_amor", "papa_hija"), names));
        expect("", OtherChatBanner.text(null, Arrays.asList("papa_hija"), names));
        expect("", OtherChatBanner.text("papa_amor", Arrays.asList("desconocido"), names));
        System.out.println("8 casos de avisos por conversación aprobados.");
    }
}
