package dev.crunchysync.app;

/** Widget "Lista": até 5 linhas; quantas cabem depende da altura. */
public class ListWidgetProvider extends BaseContinueProvider {
    @Override
    protected int layoutId() {
        return R.layout.widget_list;
    }

    @Override
    protected int maxSlots() {
        return 5;
    }

    @Override
    protected int visibleSlots(int widthDp, int heightDp) {
        return Math.max(1, Math.min(5, (heightDp - 36) / 58));
    }
}
