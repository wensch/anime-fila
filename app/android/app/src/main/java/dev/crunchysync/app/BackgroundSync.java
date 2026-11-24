package dev.crunchysync.app;

import android.content.Context;
import android.os.Handler;
import android.os.Looper;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Atualiza a fila dos widgets sem o app aberto. Abre um WebView escondido com o site da
 * Crunchyroll (a sessão e o cookie do Cloudflare são os mesmos do app), injeta o arquivo
 * assets/bg-sync.js (o mesmo código TypeScript do app: histórico, próximo episódio, fila) e
 * recebe a lista pronta, que vira o conteúdo dos widgets.
 */
final class BackgroundSync {
    private static final AtomicBoolean RUNNING = new AtomicBoolean(false);
    /** Só repete uma atualização automática depois disso (a manual ignora). */
    private static final long MIN_INTERVAL_MS = 10 * 60_000L;

    private final Context ctx;
    private final boolean force;
    private final long timeoutMs;
    private final Runnable onFinish;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final Runnable timeout = () -> finish(false);

    private WebView web;
    private String cfgJson;
    private boolean done = false;
    private boolean started = false;
    private boolean showedBusy = false;

    private BackgroundSync(Context ctx, boolean force, long timeoutMs, Runnable onFinish) {
        this.ctx = ctx.getApplicationContext();
        this.force = force;
        this.timeoutMs = timeoutMs;
        this.onFinish = onFinish;
    }

    /**
     * Inicia uma atualização (em qualquer thread). `force` ignora o intervalo mínimo.
     * `onFinish` roda no fim, mesmo quando nada foi feito.
     */
    static void start(Context ctx, boolean force, long timeoutMs, Runnable onFinish) {
        final BackgroundSync job = new BackgroundSync(ctx, force, timeoutMs, onFinish);
        new Handler(Looper.getMainLooper()).post(job::begin);
    }

    private void begin() {
        if (!RUNNING.compareAndSet(false, true)) {
            onFinish.run(); // já há uma em andamento
            return;
        }
        cfgJson = SyncStore.config(ctx);
        long age = System.currentTimeMillis() - SyncStore.lastOk(ctx);
        if (cfgJson == null || (!force && age < MIN_INTERVAL_MS)) {
            finish(false);
            return;
        }
        try {
            JSONObject cfg = new JSONObject(cfgJson);
            String base = cfg.optString("baseUrl", "");
            String host = android.net.Uri.parse(base).getHost();
            if (host == null || !(host.equals("crunchyroll.com") || host.endsWith(".crunchyroll.com"))) {
                finish(false);
                return;
            }
            if (force) {
                showedBusy = true;
                BaseContinueProvider.setBusy(ctx);
            }
            main.postDelayed(timeout, timeoutMs);
            web = new WebView(ctx);
            WebSettings s = web.getSettings();
            s.setJavaScriptEnabled(true);
            s.setDomStorageEnabled(true);
            CookieManager.getInstance().setAcceptCookie(true);
            web.addJavascriptInterface(new Bridge(), "CSNative");
            web.setWebViewClient(new WebViewClient() {
                @Override
                public void onPageFinished(WebView view, String url) {
                    checkReady();
                }

                @Override
                public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                    if (request.isForMainFrame()) finish(false); // sem conexão
                }

                @Override
                public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                    String h = request.getUrl().getHost();
                    return !(h != null && (h.equals("crunchyroll.com") || h.endsWith(".crunchyroll.com")));
                }
            });
            web.loadUrl(base + "/");
        } catch (Throwable t) {
            finish(false);
        }
    }

    /** Pronto quando a página carregou e não é a tela de verificação do Cloudflare. */
    private void checkReady() {
        if (done || started || web == null) return;
        web.evaluateJavascript("document.title", value -> {
            if (done || started) return;
            String title = value == null ? "" : value.toLowerCase();
            if (title.contains("just a moment") || title.contains("um momento")) {
                main.postDelayed(this::checkReady, 1500);
                return;
            }
            started = true;
            inject();
        });
    }

    private void inject() {
        try {
            JSONObject cfg = new JSONObject(cfgJson);
            cfg.put("next", new JSONObject(SyncStore.next(ctx)));
            // Dá folga para o tempo limite: o JS para de iniciar buscas antes dele.
            cfg.put("budgetMs", Math.max(8_000L, Math.min(45_000L, timeoutMs - 25_000L)));
            String js = readAsset("bg-sync.js")
                    + "\n;CSBG.run(" + cfg + ").then(function(r){CSNative.done(JSON.stringify(r));},"
                    + "function(e){CSNative.fail(String(e&&e.message?e.message:e));});";
            web.evaluateJavascript(js, null);
        } catch (Exception e) {
            finish(false);
        }
    }

    private String readAsset(String name) throws Exception {
        try (InputStream in = ctx.getAssets().open(name)) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[16 * 1024];
            int n;
            while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
            return out.toString("UTF-8");
        }
    }

    /** Sempre na thread principal. */
    private void finish(boolean ok) {
        if (done) return;
        done = true;
        main.removeCallbacks(timeout);
        try {
            if (web != null) {
                web.stopLoading();
                web.destroy();
                web = null;
            }
        } catch (Throwable ignored) {
            // WebView já liberado
        }
        if (showedBusy) BaseContinueProvider.renderAll(ctx); // tira o "Atualizando…"
        RUNNING.set(false);
        onFinish.run();
    }

    private void applyResult(String json) {
        try {
            JSONObject r = new JSONObject(json);
            JSONArray items = r.getJSONArray("items");
            SyncStore.saveNext(ctx, r.getJSONObject("next").toString());
            String acc = r.optString("accountId", "");
            if (!acc.isEmpty() && cfgJson != null) {
                JSONObject cfg = new JSONObject(cfgJson);
                cfg.put("accountId", acc);
                SyncStore.saveConfig(ctx, cfg.toString());
            }
            SyncStore.setLastOk(ctx, System.currentTimeMillis());
            SyncStore.setStatus(ctx, "ok");
            HomeWidgetPlugin.apply(ctx, items); // baixa as miniaturas, guarda e redesenha os widgets
            main.post(() -> finish(true));
        } catch (Exception e) {
            main.post(() -> finish(false));
        }
    }

    private void applyFailure(String message) {
        if (message != null && message.startsWith("SESSION")) {
            SyncStore.setStatus(ctx, "session"); // o widget avisa para entrar de novo no app
            BaseContinueProvider.renderAll(ctx);
        }
        main.post(() -> finish(false));
    }

    /** Ponte chamada pelo JavaScript injetado (em outra thread). */
    public final class Bridge {
        @JavascriptInterface
        public void done(final String json) {
            new Thread(() -> applyResult(json), "bg-sync-apply").start();
        }

        @JavascriptInterface
        public void fail(final String message) {
            applyFailure(message);
        }
    }
}
