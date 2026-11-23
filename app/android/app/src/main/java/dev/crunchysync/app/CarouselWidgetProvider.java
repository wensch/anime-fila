package dev.crunchysync.app;

/** Widget "Carrossel": até 4 cartões lado a lado; quantos cabem depende da largura. */
public class CarouselWidgetProvider extends BaseContinueProvider {
    @Override
    protected int layoutId() {
        return R.layout.widget_carousel;
    }

    @Override
    protected int maxSlots() {
        return 4;
    }

    @Override
    protected int visibleSlots(int widthDp, int heightDp) {
        return Math.max(1, Math.min(4, (widthDp - 20) / 78));
    }
}
