package dev.crunchysync.app;

import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Abre um episódio no aplicativo da Crunchyroll. Usa o link https do próprio site (o app da
 * Crunchyroll o reconhece); sem o app instalado, cai no navegador.
 */
@CapacitorPlugin(name = "ExternalLink")
public class ExternalLinkPlugin extends Plugin {
    static final String CRUNCHYROLL_PACKAGE = "com.crunchyroll.crunchyroid";

    /** Só ids simples (letras, números, - e _): nada que mude o endereço. */
    static boolean validEpisodeId(String id) {
        return id != null && id.matches("[A-Za-z0-9_-]{3,64}");
    }

    static Uri episodeUri(String id) {
        return Uri.parse("https://www.crunchyroll.com/watch/" + id);
    }

    @PluginMethod
    public void openEpisode(PluginCall call) {
        String id = call.getString("episodeId");
        if (!validEpisodeId(id)) {
            call.reject("episodeId inválido");
            return;
        }
        Context ctx = getContext();
        Uri uri = episodeUri(id);
        try {
            Intent app = new Intent(Intent.ACTION_VIEW, uri);
            app.setPackage(CRUNCHYROLL_PACKAGE);
            app.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            ctx.startActivity(app);
            JSObject ok = new JSObject();
            ok.put("app", true);
            call.resolve(ok);
            return;
        } catch (ActivityNotFoundException e) {
            // Sem o app da Crunchyroll: abre no navegador.
        }
        try {
            Intent browser = new Intent(Intent.ACTION_VIEW, uri);
            browser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            ctx.startActivity(browser);
            JSObject ok = new JSObject();
            ok.put("app", false);
            call.resolve(ok);
        } catch (Exception e) {
            call.reject("Não foi possível abrir o episódio: " + e.getMessage());
        }
    }
}
