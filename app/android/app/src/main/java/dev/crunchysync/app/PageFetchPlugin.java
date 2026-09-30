package dev.crunchysync.app;

import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Faz as chamadas HTTP de dentro de um WebView real com a página da Crunchyroll aberta.
 * O Cloudflare deixa passar um navegador de verdade (mesma origem, cookies, TLS de Chrome)
 * e barra clientes HTTP comuns. O mesmo WebView é mostrado em tela cheia para o login
 * e depois fica invisível (1x1 px) só executando as chamadas.
 */
@CapacitorPlugin(name = "PageFetch")
public class PageFetchPlugin extends Plugin {
    private static final long READY_TIMEOUT_MS = 30_000;
    private static final long FETCH_TIMEOUT_MS = 45_000;

    private final Handler main = new Handler(Looper.getMainLooper());
    private final Map<String, PluginCall> pending = new ConcurrentHashMap<>();
    private final List<PluginCall> readyWaiters = new ArrayList<>();

    private LinearLayout root;
    private WebView web;
    private boolean ready = false;
    private boolean loadStarted = false;
    private boolean visible = false;
    /** A última carga da página falhou (sem rede): a tela de erro não pode contar como "pronta". */
    private boolean loadFailed = false;

    @Override
    public void load() {
        getActivity().runOnUiThread(this::createViews);
    }

    // ------------------------------------------------------------------ views

    private void createViews() {
        web = new WebView(getContext());
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        CookieManager cm = CookieManager.getInstance();
        cm.setAcceptCookie(true);
        cm.setAcceptThirdPartyCookies(web, true);
        web.addJavascriptInterface(new Bridge(), "CSBridge");
        web.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageFinished(WebView view, String url) {
                JSObject data = new JSObject();
                data.put("url", url);
                notifyListeners("pageFinished", data);
                if (!loadFailed) checkReady();
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (!request.isForMainFrame()) return;
                // Sem conexão (ou site fora do ar): libera quem espera e permite tentar de novo.
                loadFailed = true;
                loadStarted = false;
                ready = false;
                failWaiters("NETWORK", "Sem conexão com a Crunchyroll");
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                // Só navegação dentro da Crunchyroll; qualquer outro destino é bloqueado.
                String host = request.getUrl().getHost();
                boolean ok = host != null && (host.equals("crunchyroll.com") || host.endsWith(".crunchyroll.com"));
                return !ok;
            }
        });

        Button close = new Button(getContext());
        close.setText("Fechar");
        close.setOnClickListener(v -> {
            hideViews();
            notifyListeners("closed", new JSObject());
        });

        root = new LinearLayout(getContext());
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(0xFF09090B);
        root.addView(close, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        root.addView(web, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));
        hideViews();
        FrameLayout.LayoutParams lp = new FrameLayout.LayoutParams(1, 1, Gravity.TOP | Gravity.START);
        getActivity().addContentView(root, lp);
    }

    private void showViews() {
        root.setLayoutParams(new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        root.setAlpha(1f);
        root.setVisibility(View.VISIBLE);
        root.bringToFront();
        visible = true;
    }

    private void hideViews() {
        root.setLayoutParams(new FrameLayout.LayoutParams(1, 1, Gravity.TOP | Gravity.START));
        root.setAlpha(0f);
        visible = false;
    }

    // ---------------------------------------------------------------- methods

    /** Mostra o WebView em tela cheia (login). Carrega `url` se ainda não há página. */
    @PluginMethod
    public void show(PluginCall call) {
        String url = call.getString("url");
        getActivity().runOnUiThread(() -> {
            showViews();
            if (url != null) startLoad(url);
            call.resolve();
        });
    }

    /** Botão Voltar do Android: se o WebView está em tela cheia, fecha-o em vez de sair do app. */
    public boolean handleBack() {
        if (root == null || !visible) return false;
        hideViews();
        notifyListeners("closed", new JSObject());
        return true;
    }

    /** Sair da conta de verdade: apaga cookies e dados do site da Crunchyroll no WebView. */
    @PluginMethod
    public void clearSession(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            // Só o localStorage/sessionStorage da página da Crunchyroll (o do app fica intacto).
            web.evaluateJavascript("try{localStorage.clear();sessionStorage.clear();}catch(e){}", null);
            CookieManager cm = CookieManager.getInstance();
            cm.removeAllCookies(ok -> cm.flush());
            web.clearCache(true);
            web.clearHistory();
            ready = false;
            loadStarted = false;
            loadFailed = false;
            web.loadUrl("about:blank");
            call.resolve();
        });
    }

    @PluginMethod
    public void hide(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            hideViews();
            call.resolve();
        });
    }

    /** Garante uma página da Crunchyroll carregada e livre do desafio do Cloudflare. */
    @PluginMethod
    public void ensureLoaded(PluginCall call) {
        String url = call.getString("url");
        getActivity().runOnUiThread(() -> {
            if (ready) {
                call.resolve();
                return;
            }
            synchronized (readyWaiters) {
                readyWaiters.add(call);
            }
            if (!loadStarted && url != null) {
                startLoad(url);
            } else {
                checkReady();
            }
            // Um prazo por chamada: não derruba quem entrou na fila depois.
            main.postDelayed(
                    () -> failWaiter(call, "CHALLENGE", "Verificação do Cloudflare não concluída"),
                    READY_TIMEOUT_MS);
        });
    }

    /** Executa fetch() dentro da página. Devolve {status, body} ou {error}. */
    @PluginMethod
    public void fetch(PluginCall call) {
        final String id = UUID.randomUUID().toString();
        JSObject req = new JSObject();
        req.put("url", call.getString("url"));
        req.put("method", call.getString("method", "GET"));
        req.put("body", call.getString("body"));
        JSObject headers = call.getObject("headers", new JSObject());
        req.put("headers", headers);

        final String js = "(function(id,req){var r=JSON.parse(req);"
                + "var init={method:r.method,headers:r.headers||{},credentials:'include'};"
                + "if(r.body!=null)init.body=r.body;"
                + "fetch(r.url,init).then(function(res){return res.text().then(function(t){"
                + "CSBridge.onResult(id,JSON.stringify({status:res.status,body:t}));});})"
                + ".catch(function(e){CSBridge.onResult(id,JSON.stringify({error:String(e)}));});"
                + "})(" + JSONObject.quote(id) + "," + JSONObject.quote(req.toString()) + ")";

        pending.put(id, call);
        getActivity().runOnUiThread(() -> web.evaluateJavascript(js, null));
        main.postDelayed(() -> {
            PluginCall c = pending.remove(id);
            if (c != null) {
                JSObject r = new JSObject();
                r.put("error", "timeout");
                c.resolve(r);
            }
        }, FETCH_TIMEOUT_MS);
    }

    // --------------------------------------------------------------- internals

    /** Considera pronto quando a página carregou e o título não é o do desafio. */
    private void checkReady() {
        if (web == null || ready) return;
        String current = web.getUrl();
        if (current == null || !current.contains("crunchyroll.com")) return; // ainda sem página
        web.evaluateJavascript("document.title", value -> {
            String title = value == null ? "" : value.toLowerCase();
            boolean challenge = title.contains("just a moment") || title.contains("um momento");
            if (!challenge) {
                ready = true;
                List<PluginCall> waiters;
                synchronized (readyWaiters) {
                    waiters = new ArrayList<>(readyWaiters);
                    readyWaiters.clear();
                }
                for (PluginCall c : waiters) c.resolve();
            } else {
                main.postDelayed(this::checkReady, 1500);
            }
        });
    }

    private void startLoad(String url) {
        loadFailed = false;
        loadStarted = true;
        ready = false;
        web.loadUrl(url);
    }

    private void failWaiter(PluginCall call, String code, String message) {
        boolean removed;
        synchronized (readyWaiters) {
            removed = readyWaiters.remove(call);
        }
        if (removed) call.reject(message, code);
    }

    private void failWaiters(String code, String message) {
        List<PluginCall> waiters;
        synchronized (readyWaiters) {
            waiters = new ArrayList<>(readyWaiters);
            readyWaiters.clear();
        }
        for (PluginCall c : waiters) c.reject(message, code);
    }

    public class Bridge {
        @JavascriptInterface
        public void onResult(String id, String json) {
            PluginCall c = pending.remove(id);
            if (c == null) return;
            try {
                c.resolve(new JSObject(json));
            } catch (JSONException e) {
                c.reject("Resposta inválida da página");
            }
        }
    }
}
