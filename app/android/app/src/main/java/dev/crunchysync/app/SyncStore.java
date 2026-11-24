package dev.crunchysync.app;

import android.content.Context;
import android.content.SharedPreferences;

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

    static void clear(Context ctx) {
        prefs(ctx).edit().clear().apply();
    }
}
