package dev.crunchysync.app;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
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
    /** Layout do estilo. */
    protected abstract int layoutId();

    /** Quantos itens cabem em largura x altura (dp). */
    protected abstract int visibleSlots(int widthDp, int heightDp);

    /** Quantos itens o layout tem no total. */
    protected abstract int maxSlots();

    /** Hook para o estilo ajustar cliques extras depois do desenho padrão. */
    protected void afterBind(Context ctx, RemoteViews v, List<WidgetData.Item> items, int visible) {}

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
            if (slot != 0) v.setOnClickPendingIntent(slot, link(ctx, it.seriesId));
        }
        afterBind(ctx, v, items, visible);
        mgr.updateAppWidget(id, v);
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
