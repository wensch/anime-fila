package dev.crunchysync.app;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.net.Uri;
import android.os.Bundle;
import android.view.View;
import android.widget.RemoteViews;

import java.io.File;
import java.util.List;

/**
 * Base dos widgets "Continuar assistindo" da tela inicial. Cada estilo (destaque, carrossel,
 * lista) diz quantos itens cabem no tamanho atual; os dados vêm da última lista que o app guardou
 * (os widgets nunca falam com a Crunchyroll). A cada 30 min o sistema chama onUpdate, que só
 * redesenha (atualiza o "Lançado há…").
 */
public abstract class BaseContinueProvider extends AppWidgetProvider {
    /** Toque no botão de atualizar do widget. */
    static final String ACTION_REFRESH = "dev.crunchysync.app.REFRESH_WIDGETS";
    /** Tempo máximo de uma atualização iniciada por broadcast (o sistema dá ~60 s antes de acusar travamento). */
    private static final long RECEIVER_TIMEOUT_MS = 45_000L;

    /** Layout do estilo. */
    protected abstract int layoutId();

    /** Quantos itens cabem em largura x altura (dp). */
    protected abstract int visibleSlots(int widthDp, int heightDp);

    /** Quantos itens o layout tem no total. */
    protected abstract int maxSlots();

    /** Hook para o estilo ajustar cliques extras depois do desenho padrão. */
    protected void afterBind(Context ctx, RemoteViews v, List<WidgetData.Item> items, int visible) {}

    @Override
    public void onReceive(Context ctx, Intent intent) {
        String action = intent == null ? null : intent.getAction();
        if (ACTION_REFRESH.equals(action)) {
            // Botão de atualizar: busca agora, sem o app aberto.
            final PendingResult pr = goAsync();
            BackgroundSync.start(ctx, true, RECEIVER_TIMEOUT_MS, pr::finish);
            return;
        }
        if (AppWidgetManager.ACTION_APPWIDGET_UPDATE.equals(action)) {
            // O Android redesenha os widgets de tempos em tempos: aproveita para buscar dados novos.
            RefreshJobService.ensureScheduled(ctx);
            super.onReceive(ctx, intent);
            final PendingResult pr = goAsync();
            BackgroundSync.start(ctx, false, RECEIVER_TIMEOUT_MS, pr::finish);
            return;
        }
        super.onReceive(ctx, intent);
    }

    @Override
    public void onUpdate(Context ctx, AppWidgetManager mgr, int[] ids) {
        for (int id : ids) render(ctx, mgr, id);
    }

    @Override
    public void onAppWidgetOptionsChanged(Context ctx, AppWidgetManager mgr, int id, Bundle newOptions) {
        render(ctx, mgr, id);
    }

    /** Redesenha todos os widgets do app que estão na tela inicial. */
    static void renderAll(Context ctx) {
        AppWidgetManager mgr = AppWidgetManager.getInstance(ctx);
        BaseContinueProvider[] providers = {
                new HeroWidgetProvider(), new CarouselWidgetProvider(), new ListWidgetProvider()
        };
        for (BaseContinueProvider p : providers) {
            int[] ids = mgr.getAppWidgetIds(new ComponentName(ctx, p.getClass()));
            if (ids != null && ids.length > 0) p.onUpdate(ctx, mgr, ids);
        }
    }

    private void render(Context ctx, AppWidgetManager mgr, int id) {
        Bundle opts = mgr.getAppWidgetOptions(id);
        int w = opts.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, 250);
        int h = opts.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT, 110);
        RemoteViews v = new RemoteViews(ctx.getPackageName(), layoutId());
        List<WidgetData.Item> items = WidgetData.load(ctx);
        int visible = Math.max(0, Math.min(Math.min(items.size(), maxSlots()), visibleSlots(w, h)));

        boolean empty = items.isEmpty();
        v.setViewVisibility(R.id.content, empty ? View.GONE : View.VISIBLE);
        v.setViewVisibility(R.id.tv_empty, empty ? View.VISIBLE : View.GONE);
        v.setOnClickPendingIntent(android.R.id.background, link(ctx, null));
        v.setOnClickPendingIntent(R.id.btn_refresh, refreshIntent(ctx));
        v.setTextViewText(R.id.tv_updated, updatedLabel(ctx));

        long now = System.currentTimeMillis();
        for (int i = 0; i < maxSlots(); i++) {
            int slot = idOf(ctx, "slot" + i); // 0 no destaque: o widget inteiro é o item
            if (slot != 0) v.setViewVisibility(slot, i < visible ? View.VISIBLE : View.GONE);
            if (i >= visible) continue;
            WidgetData.Item it = items.get(i);
            v.setTextViewText(idOf(ctx, "slot" + i + "_title"), it.title);
            v.setTextViewText(idOf(ctx, "slot" + i + "_sub"), subtitle(it, now));
            bindImage(ctx, v, idOf(ctx, "slot" + i + "_img"), it.image);
            int prog = idOf(ctx, "slot" + i + "_progress");
            if (it.progress >= 0f) {
                v.setViewVisibility(prog, View.VISIBLE);
                v.setProgressBar(prog, 1000, Math.round(Math.min(1f, it.progress) * 1000f), false);
            } else {
                v.setViewVisibility(prog, View.GONE);
            }
            if (slot != 0) v.setOnClickPendingIntent(slot, episodeLink(ctx, it.episodeId));
        }
        afterBind(ctx, v, items, visible);
        mgr.updateAppWidget(id, v);
    }

    private PendingIntent refreshIntent(Context ctx) {
        Intent i = new Intent(ctx, getClass());
        i.setAction(ACTION_REFRESH);
        return PendingIntent.getBroadcast(ctx, 1, i, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    /** "Atualizado há 3 min", ou o aviso de que é preciso entrar de novo no app. */
    private static String updatedLabel(Context ctx) {
        if ("session".equals(SyncStore.status(ctx))) return "Entre de novo no app";
        String err = SyncStore.lastError(ctx);
        if (!err.isEmpty() && SyncStore.lastAttempt(ctx) > SyncStore.lastOk(ctx)) return "Falhou: " + err;
        long at = WidgetData.savedAt(ctx);
        return at <= 0 ? "" : "Atualizado " + WidgetData.relative(at, System.currentTimeMillis());
    }

    /** Mostra "Atualizando…" em todos os widgets enquanto a busca manual roda. */
    static void setBusy(Context ctx) {
        AppWidgetManager mgr = AppWidgetManager.getInstance(ctx);
        BaseContinueProvider[] providers = {
                new HeroWidgetProvider(), new CarouselWidgetProvider(), new ListWidgetProvider()
        };
        for (BaseContinueProvider p : providers) {
            int[] ids = mgr.getAppWidgetIds(new ComponentName(ctx, p.getClass()));
            if (ids == null || ids.length == 0) continue;
            RemoteViews v = new RemoteViews(ctx.getPackageName(), p.layoutId());
            v.setTextViewText(R.id.tv_updated, "Atualizando…");
            mgr.partiallyUpdateAppWidget(ids, v);
        }
    }

    private static String subtitle(WidgetData.Item it, long now) {
        String when = (it.hasRelease ? "Lançado " : "Visto ") + WidgetData.relative(it.releasedAt, now);
        return it.episode.isEmpty() ? when.trim() : it.episode + " · " + when.trim();
    }

    private static void bindImage(Context ctx, RemoteViews v, int viewId, String file) {
        if (file != null) {
            File f = new File(new File(ctx.getFilesDir(), "widget"), file);
            if (f.exists()) {
                Bitmap bmp = BitmapFactory.decodeFile(f.getAbsolutePath());
                if (bmp != null) {
                    v.setImageViewBitmap(viewId, bmp);
                    return;
                }
            }
        }
        v.setImageViewResource(viewId, R.drawable.thumb_bg);
    }

    private static int idOf(Context ctx, String name) {
        return ctx.getResources().getIdentifier(name, "id", ctx.getPackageName());
    }

    /**
     * Abre o episódio no app da Crunchyroll (se instalado; senão o link https vai para o navegador).
     * Sem um id válido, abre o CrunchySync.
     */
    static PendingIntent episodeLink(Context ctx, String episodeId) {
        if (!ExternalLinkPlugin.validEpisodeId(episodeId)) return link(ctx, null);
        Intent i = new Intent(Intent.ACTION_VIEW, ExternalLinkPlugin.episodeUri(episodeId));
        if (crunchyrollInstalled(ctx)) i.setPackage(ExternalLinkPlugin.CRUNCHYROLL_PACKAGE);
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        return PendingIntent.getActivity(ctx, 0, i, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    private static boolean crunchyrollInstalled(Context ctx) {
        try {
            ctx.getPackageManager().getPackageInfo(ExternalLinkPlugin.CRUNCHYROLL_PACKAGE, 0);
            return true;
        } catch (PackageManager.NameNotFoundException e) {
            return false;
        }
    }

    /** Abre o app; com seriesId, abre direto os episódios da série (crunchysync://series/ID). */
    static PendingIntent link(Context ctx, String seriesId) {
        Intent i = new Intent(Intent.ACTION_VIEW);
        i.setPackage(ctx.getPackageName());
        i.setData(Uri.parse(seriesId == null || seriesId.isEmpty()
                ? "crunchysync://home"
                : "crunchysync://series/" + Uri.encode(seriesId)));
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        return PendingIntent.getActivity(ctx, 0, i, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }
}
