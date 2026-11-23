package dev.crunchysync.app;

/** Widget "Carrossel": até 6 cartões lado a lado; quantos cabem depende da largura. */
public class CarouselWidgetProvider extends BaseContinueProvider {
    @Override
    protected int layoutId() {
        return R.layout.widget_carousel;
    }

    @Override
    protected int maxSlots() {
        return 6;
    }

    @Override
    protected int visibleSlots(int widthDp, int heightDp) {
        return Math.max(1, Math.min(6, (widthDp - 20) / 78));
    }
}
