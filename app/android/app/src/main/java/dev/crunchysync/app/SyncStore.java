package dev.crunchysync.app;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONObject;

import java.util.UUID;

/** Configuração e estado da atualização em segundo plano dos widgets. */
final class SyncStore {
    private static final String PREFS = "crunchysync_sync";

    private SyncStore() {}

    private static SharedPreferences prefs(Context ctx) {
        return ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    /** JSON enviado pelo app (endereços da API, id da conta...). null = sem login: nada a atualizar. */
    static String config(Context ctx) {
        return prefs(ctx).getString("config", null);
    }

    /**
     * A configuração enviada pelo app; se o app ainda não rodou depois de instalar, usa os padrões
     * (a sessão da Crunchyroll vem do cookie do WebView, então os padrões bastam).
     */
    static String configOrDefault(Context ctx) {
        String c = config(ctx);
        if (c != null) return c;
        try {
            SharedPreferences p = prefs(ctx);
            String dev = p.getString("deviceId", null);
            if (dev == null) {
                dev = UUID.randomUUID().toString();
                p.edit().putString("deviceId", dev).apply();
            }
            JSONObject o = new JSONObject();
            o.put("baseUrl", "https://www.crunchyroll.com");
            o.put("basicAuth", "bm9haWhkZXZtXzZpeWcwYThsMHE6");
            o.put("historyPath", "/content/v2/{account}/watch-history");
            o.put("watchlistPath", "/content/v2/discover/{account}/watchlist");
            o.put("seasonsPath", "/content/v2/cms/series/{id}/seasons");
            o.put("episodesPath", "/content/v2/cms/seasons/{id}/episodes");
            o.put("locale", "pt-BR");
            o.put("accountId", JSONObject.NULL);
            o.put("deviceId", dev);
            return o.toString();
        } catch (Exception e) {
            return null;
        }
    }

    /** Há o que manter atualizado: o app mandou a configuração ou já existe uma lista nos widgets. */
    static boolean isActive(Context ctx) {
        return config(ctx) != null || !WidgetData.load(ctx).isEmpty();
    }

    static void saveConfig(Context ctx, String json) {
        prefs(ctx).edit().putString("config", json).apply();
    }

    /** Próximo episódio de cada série (resultado da execução anterior), em JSON. */
    static String next(Context ctx) {
        return prefs(ctx).getString("next", "{}");
    }

    static void saveNext(Context ctx, String json) {
        prefs(ctx).edit().putString("next", json).apply();
    }

    static long lastOk(Context ctx) {
        return prefs(ctx).getLong("lastOk", 0L);
    }

    static void setLastOk(Context ctx, long ts) {
        prefs(ctx).edit().putLong("lastOk", ts).apply();
    }

    /** "ok" ou "session" (a Crunchyroll pede para entrar de novo no app). */
    static String status(Context ctx) {
        return prefs(ctx).getString("status", "ok");
    }

    static void setStatus(Context ctx, String status) {
        prefs(ctx).edit().putString("status", status).apply();
    }

    static long lastAttempt(Context ctx) {
        return prefs(ctx).getLong("lastAttempt", 0L);
    }

    static void setAttempt(Context ctx, long ts) {
        prefs(ctx).edit().putLong("lastAttempt", ts).apply();
    }

    /** Motivo da última falha ("" = sem falha). */
    static String lastError(Context ctx) {
        return prefs(ctx).getString("lastError", "");
    }

    static void setError(Context ctx, String error) {
        prefs(ctx).edit().putString("lastError", error == null ? "" : error).apply();
    }

    /** "watchlist" (lista da Crunchyroll) ou "history" (plano B) na última busca que funcionou. */
    static String source(Context ctx) {
        return prefs(ctx).getString("source", "");
    }

    static void setSource(Context ctx, String source) {
        prefs(ctx).edit().putString("source", source == null ? "" : source).apply();
    }

    static void clear(Context ctx) {
        prefs(ctx).edit().clear().apply();
    }
}
