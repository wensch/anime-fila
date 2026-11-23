package dev.crunchysync.app;

import android.content.Context;
import android.widget.RemoteViews;

import java.util.List;

/** Widget "Destaque": o lançamento mais novo da fila, grande, com título e progresso. */
public class HeroWidgetProvider extends BaseContinueProvider {
    @Override
    protected int layoutId() {
        return R.layout.widget_hero;
    }

    @Override
    protected int maxSlots() {
        return 1;
    }

    @Override
    protected int visibleSlots(int widthDp, int heightDp) {
        return 1;
    }

    @Override
    protected void afterBind(Context ctx, RemoteViews v, List<WidgetData.Item> items, int visible) {
        // O widget inteiro é o item: toque abre o episódio na Crunchyroll.
        if (!items.isEmpty()) v.setOnClickPendingIntent(android.R.id.background, episodeLink(ctx, items.get(0).episodeId));
    }
}
