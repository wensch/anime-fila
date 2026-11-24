package dev.crunchysync.app;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

/** Última lista "Continuar assistindo" guardada pelo app, que os widgets da tela inicial exibem. */
final class WidgetData {
    private static final String PREFS = "crunchysync_widget";
    private static final String KEY_ITEMS = "items";

    private WidgetData() {}

    static final class Item {
        String seriesId;
        /** Episódio que o toque abre na Crunchyroll. */
        String episodeId = "";
        String title;
        /** "Ep. 9" ou vazio. */
        String episode = "";
        /** Lançamento (ou, sem ele, a data em que foi assistido), em ms; 0 = desconhecido. */
        long releasedAt;
        boolean hasRelease;
        /** 0..1; negativo = desconhecido. */
        float progress = -1f;
        /** Nome do arquivo da miniatura em files/widget, ou null. */
        String image;
    }

    static List<Item> load(Context ctx) {
        List<Item> out = new ArrayList<>();
        try {
            SharedPreferences p = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
            JSONArray arr = new JSONArray(p.getString(KEY_ITEMS, "[]"));
            for (int i = 0; i < arr.length(); i++) {
                JSONObject o = arr.getJSONObject(i);
                Item it = new Item();
                it.seriesId = o.optString("seriesId", "");
                it.episodeId = o.optString("episodeId", "");
                it.title = o.optString("title", "");
                it.episode = o.optString("episode", "");
                it.releasedAt = o.optLong("releasedAt", 0L);
                it.hasRelease = o.optBoolean("hasRelease", false);
                it.progress = (float) o.optDouble("progress", -1.0);
                it.image = o.isNull("image") ? null : o.optString("image", null);
                out.add(it);
            }
        } catch (Exception e) {
            out.clear();
        }
        return out;
    }

    static void save(Context ctx, List<Item> items) throws Exception {
        JSONArray arr = new JSONArray();
        for (Item it : items) {
            JSONObject o = new JSONObject();
            o.put("seriesId", it.seriesId);
            o.put("episodeId", it.episodeId);
            o.put("title", it.title);
            o.put("episode", it.episode);
            o.put("releasedAt", it.releasedAt);
            o.put("hasRelease", it.hasRelease);
            o.put("progress", it.progress);
            o.put("image", it.image == null ? JSONObject.NULL : it.image);
            arr.put(o);
        }
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
                .putString(KEY_ITEMS, arr.toString())
                .putLong("savedAt", System.currentTimeMillis())
                .apply();
    }

    /** Quando a lista dos widgets foi atualizada pela última vez (ms); 0 = nunca. */
    static long savedAt(Context ctx) {
        return ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getLong("savedAt", 0L);
    }

    static void clear(Context ctx) {
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().remove(KEY_ITEMS).remove("savedAt").apply();
    }

    /** Mesma regra do app: "agora", "há 5 min", "há 3 h", "ontem", "há 4 dias", "há 2 semanas"... */
    static String relative(long ts, long now) {
        if (ts <= 0) return "";
        long min = Math.max(0L, now - ts) / 60_000L;
        if (min < 1) return "agora";
        if (min < 60) return "há " + min + " min";
        long hours = min / 60;
        if (hours < 24) return "há " + hours + " h";
        long days = hours / 24;
        if (days == 1) return "ontem";
        if (days < 7) return "há " + days + " dias";
        if (days < 30) {
            long wk = days / 7;
            return "há " + wk + (wk == 1 ? " semana" : " semanas");
        }
        if (days < 365) {
            long mo = Math.min(11L, days / 30);
            return "há " + mo + (mo == 1 ? " mês" : " meses");
        }
        long y = days / 365;
        return "há " + y + (y == 1 ? " ano" : " anos");
    }
}
