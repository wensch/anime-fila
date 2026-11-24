package dev.crunchysync.app;

import android.app.job.JobInfo;
import android.app.job.JobParameters;
import android.app.job.JobScheduler;
import android.app.job.JobService;
import android.content.ComponentName;
import android.content.Context;

/**
 * Atualização periódica dos widgets feita pelo sistema (a cada ~30 min, com rede), mesmo sem o
 * app aberto. O sistema espaça os trabalhos de apps pouco usados; por isso os widgets também
 * disparam a mesma atualização quando o Android os redesenha, e há o botão de atualizar.
 */
public class RefreshJobService extends JobService {
    private static final int JOB_ID = 4242;
    private static final long PERIOD_MS = 30 * 60_000L;
    private static final long JOB_TIMEOUT_MS = 100_000L;

    /** Agenda (ou mantém) a atualização periódica; só se há o que atualizar (o app já mandou a configuração ou os widgets já têm lista). */
    static void ensureScheduled(Context ctx) {
        JobScheduler js = (JobScheduler) ctx.getSystemService(Context.JOB_SCHEDULER_SERVICE);
        if (js == null || !SyncStore.isActive(ctx)) return;
        if (js.getPendingJob(JOB_ID) != null) return;
        ComponentName cn = new ComponentName(ctx, RefreshJobService.class);
        try {
            js.schedule(new JobInfo.Builder(JOB_ID, cn)
                    .setPeriodic(PERIOD_MS)
                    .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
                    .setPersisted(true)
                    .build());
        } catch (RuntimeException e) {
            // Sem permissão para persistir após reiniciar: agenda sem isso.
            js.schedule(new JobInfo.Builder(JOB_ID, cn)
                    .setPeriodic(PERIOD_MS)
                    .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
                    .build());
        }
    }

    static void cancel(Context ctx) {
        JobScheduler js = (JobScheduler) ctx.getSystemService(Context.JOB_SCHEDULER_SERVICE);
        if (js != null) js.cancel(JOB_ID);
    }

    @Override
    public boolean onStartJob(final JobParameters params) {
        BackgroundSync.start(this, false, JOB_TIMEOUT_MS, () -> jobFinished(params, false));
        return true; // continua em segundo plano até chamar jobFinished
    }

    @Override
    public boolean onStopJob(JobParameters params) {
        return true; // o sistema interrompeu: tenta de novo depois
    }
}
