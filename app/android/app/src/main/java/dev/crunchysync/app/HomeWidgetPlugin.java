package dev.crunchysync.app;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/**
 * Recebe do app a lista "Continuar assistindo", baixa as miniaturas para o aparelho e redesenha os
 * widgets da tela inicial. Os widgets só leem esses dados: nunca chamam a Crunchyroll.
 */
@CapacitorPlugin(name = "HomeWidget")
public class HomeWidgetPlugin extends Plugin {
    private static final int MAX_ITEMS = 10;
    private static final int THUMB_W = 400;
    private static final int THUMB_H = 225;
    private static final int MAX_DOWNLOAD_BYTES = 4 * 1024 * 1024;

    @PluginMethod
    public void update(PluginCall call) {
        final JSArray arr = call.getArray("items");
        if (arr == null) {
            call.reject("items ausente");
            return;
        }
        final Context ctx = getContext().getApplicationContext();
        final JSObject config = call.getObject("config");
        final JSObject next = call.getObject("next");
        new Thread(() -> {
            try {
                if (config != null) {
                    // Guarda o necessário para atualizar em segundo plano, sem o app aberto.
                    SyncStore.saveConfig(ctx, config.toString());
                    SyncStore.setStatus(ctx, "ok"); // o app está logado: sai o aviso de sessão expirada
                    if (next != null && SyncStore.lastOk(ctx) == 0L) SyncStore.saveNext(ctx, next.toString());
                    RefreshJobService.ensureScheduled(ctx);
                }
                apply(ctx, arr);
                call.resolve();
            } catch (Exception e) {
                call.reject("Falha ao atualizar os widgets: " + e.getMessage());
            }
        }, "home-widget").start();
    }

    /** Baixa as miniaturas, guarda a lista e redesenha os widgets (usado pelo app e pelo segundo plano). */
    static void apply(Context ctx, org.json.JSONArray arr) throws Exception {
        File dir = new File(ctx.getFilesDir(), "widget");
        //noinspection ResultOfMethodCallIgnored
        dir.mkdirs();
        List<WidgetData.Item> out = new ArrayList<>();
        Set<String> keep = new HashSet<>();
        int n = Math.min(arr.length(), MAX_ITEMS);
        for (int i = 0; i < n; i++) {
            JSONObject o = arr.getJSONObject(i);
            WidgetData.Item it = new WidgetData.Item();
            it.seriesId = o.optString("seriesId", "");
            it.episodeId = o.optString("episodeId", "");
            it.title = o.optString("title", "");
            it.episode = o.optString("episode", "");
            it.releasedAt = o.isNull("releasedAt") ? 0L : o.optLong("releasedAt", 0L);
            it.hasRelease = o.optBoolean("hasRelease", false);
            it.progress = o.isNull("progress") ? -1f : (float) o.optDouble("progress", -1.0);
            it.image = o.isNull("coverUrl") ? null : fetchImage(dir, o.optString("coverUrl", ""));
            if (it.image != null) keep.add(it.image);
            out.add(it);
        }
        File[] old = dir.listFiles();
        if (old != null) {
            for (File f : old) {
                //noinspection ResultOfMethodCallIgnored
                if (!keep.contains(f.getName())) f.delete();
            }
        }
        WidgetData.save(ctx, out);
        BaseContinueProvider.renderAll(ctx);
    }

    /** Esvazia os widgets (ao sair da conta). */
    @PluginMethod
    public void clear(PluginCall call) {
        final Context ctx = getContext().getApplicationContext();
        File dir = new File(ctx.getFilesDir(), "widget");
        File[] files = dir.listFiles();
        if (files != null) {
            for (File f : files) {
                //noinspection ResultOfMethodCallIgnored
                f.delete();
            }
        }
        WidgetData.clear(ctx);
        SyncStore.clear(ctx);
        RefreshJobService.cancel(ctx);
        BaseContinueProvider.renderAll(ctx);
        call.resolve();
    }

    /** Baixa a imagem (só https), recorta em 16:9 e guarda como JPEG; devolve o nome do arquivo. */
    private static String fetchImage(File dir, String url) {
        if (url == null || !url.startsWith("https://")) return null;
        String name = "img_" + Integer.toHexString(url.hashCode()) + ".jpg";
        File dest = new File(dir, name);
        if (dest.exists() && dest.length() > 0) return name;
        HttpURLConnection c = null;
        try {
            c = (HttpURLConnection) new URL(url).openConnection();
            c.setConnectTimeout(10_000);
            c.setReadTimeout(15_000);
            if (c.getResponseCode() != 200) return null;
            ByteArrayOutputStream buf = new ByteArrayOutputStream();
            try (InputStream in = c.getInputStream()) {
                byte[] chunk = new byte[16 * 1024];
                int r;
                while ((r = in.read(chunk)) > 0) {
                    buf.write(chunk, 0, r);
                    if (buf.size() > MAX_DOWNLOAD_BYTES) return null;
                }
            }
            byte[] bytes = buf.toByteArray();

            BitmapFactory.Options bounds = new BitmapFactory.Options();
            bounds.inJustDecodeBounds = true;
            BitmapFactory.decodeByteArray(bytes, 0, bytes.length, bounds);
            if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null;
            int sample = 1;
            while (bounds.outWidth / (sample * 2) >= THUMB_W) sample *= 2;
            BitmapFactory.Options opts = new BitmapFactory.Options();
            opts.inSampleSize = sample;
            Bitmap src = BitmapFactory.decodeByteArray(bytes, 0, bytes.length, opts);
            if (src == null) return null;

            // Recorte central 16:9 e redução para THUMB_W x THUMB_H.
            float scale = Math.max((float) THUMB_W / src.getWidth(), (float) THUMB_H / src.getHeight());
            int cw = Math.min(src.getWidth(), Math.round(THUMB_W / scale));
            int ch = Math.min(src.getHeight(), Math.round(THUMB_H / scale));
            Bitmap crop = Bitmap.createBitmap(src, (src.getWidth() - cw) / 2, (src.getHeight() - ch) / 2, cw, ch);
            Bitmap thumb = Bitmap.createScaledBitmap(crop, THUMB_W, THUMB_H, true);

            File tmp = new File(dir, name + ".tmp");
            try (FileOutputStream os = new FileOutputStream(tmp)) {
                thumb.compress(Bitmap.CompressFormat.JPEG, 85, os);
            }
            if (!tmp.renameTo(dest)) {
                //noinspection ResultOfMethodCallIgnored
                tmp.delete();
                return null;
            }
            return name;
        } catch (Exception e) {
            return null;
        } finally {
            if (c != null) c.disconnect();
        }
    }
}
