package dev.crunchysync.app;

import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * Baixa o APK da atualização (com progresso) e abre o instalador do Android.
 * O sistema sempre pede a confirmação final do usuário; nenhum app pode instalar em silêncio.
 */
@CapacitorPlugin(name = "AppUpdater")
public class AppUpdatePlugin extends Plugin {
    private volatile boolean busy = false;

    @PluginMethod
    public void install(PluginCall call) {
        final String url = call.getString("url");
        if (url == null || !url.startsWith("https://")) {
            call.reject("URL inválida", "BAD_URL");
            return;
        }
        final Context ctx = getContext();

        // Android 8+: o usuário precisa liberar "instalar apps desconhecidos" para este app.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !ctx.getPackageManager().canRequestPackageInstalls()) {
            Intent settings = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + ctx.getPackageName()));
            settings.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            ctx.startActivity(settings);
            call.reject("Permita instalar apps deste aplicativo e tente de novo", "NEEDS_PERMISSION");
            return;
        }
        if (busy) {
            call.reject("Já existe um download em andamento", "BUSY");
            return;
        }
        busy = true;
        // Thread própria: o handler de plugins do Capacitor é único e não pode ficar bloqueado.
        new Thread(() -> {
            try {
                File apk = download(url);
                launchInstaller(apk);
                call.resolve();
            } catch (Exception e) {
                call.reject("Falha no download: " + e.getMessage(), "DOWNLOAD");
            } finally {
                busy = false;
            }
        }, "apk-update").start();
    }

    private File download(String urlStr) throws IOException {
        File dir = new File(getContext().getCacheDir(), "updates");
        //noinspection ResultOfMethodCallIgnored
        dir.mkdirs();
        File out = new File(dir, "CrunchySync.apk");

        HttpURLConnection c = (HttpURLConnection) new URL(urlStr).openConnection();
        c.setConnectTimeout(15_000);
        c.setReadTimeout(30_000);
        c.setInstanceFollowRedirects(true); // github.com -> objects.githubusercontent.com (https -> https)
        try {
            int code = c.getResponseCode();
            if (code != 200) throw new IOException("HTTP " + code);
            long total = c.getContentLengthLong();
            try (InputStream in = c.getInputStream(); FileOutputStream os = new FileOutputStream(out)) {
                byte[] buf = new byte[32 * 1024];
                long done = 0;
                int lastPct = -1;
                int n;
                while ((n = in.read(buf)) > 0) {
                    os.write(buf, 0, n);
                    done += n;
                    if (total > 0) {
                        int pct = (int) (done * 100 / total);
                        if (pct != lastPct) {
                            lastPct = pct;
                            JSObject d = new JSObject();
                            d.put("percent", pct);
                            notifyListeners("progress", d);
                        }
                    }
                }
            }
            if (total > 0 && out.length() != total) throw new IOException("arquivo incompleto");
        } finally {
            c.disconnect();
        }
        // Um APK é um ZIP: começa com "PK".
        try (FileInputStream f = new FileInputStream(out)) {
            if (f.read() != 'P' || f.read() != 'K') throw new IOException("o arquivo baixado não é um APK");
        }
        return out;
    }

    private void launchInstaller(File apk) {
        Context ctx = getContext();
        Uri uri = FileProvider.getUriForFile(ctx, ctx.getPackageName() + ".fileprovider", apk);
        Intent i = new Intent(Intent.ACTION_VIEW);
        i.setDataAndType(uri, "application/vnd.android.package-archive");
        i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
        ctx.startActivity(i);
    }
}
