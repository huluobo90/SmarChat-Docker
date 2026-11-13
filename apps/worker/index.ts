import { transcribe } from "./transcribe";
import { cleanupDeletedBlobs } from "../../packages/domain/cleanup";
import { Queue, Worker } from "bullmq";
import { pool, tx, service } from "../../packages/database/db";
import { executeAI } from "./ai";
import { extract } from "./extract";
import { reconcile, drainOutbox, stopSockets } from "./whatsapp";
const connection = { host: process.env.REDIS_HOST || "redis", port: 6379 },
  queue = new Queue("smarchat-jobs", { connection });
const worker = new Worker(
  "smarchat-jobs",
  async (task) => {
    const job = await tx(service, async (db) => {
      if (
        (await db.query("SELECT active FROM maintenance WHERE id=1")).rows[0]
          .active
      )
        return null;
      return (
        await db.query(
          "UPDATE jobs SET status='running',updated_at=now(),progress=5 WHERE id=$1 AND status='queued' RETURNING *",
          [task.data.id],
        )
      ).rows[0];
    });
    if (!job) return;
    const controller = new AbortController(),
      timer = setInterval(async () => {
        try {
          const current = await pool.query(
            "SELECT status FROM jobs WHERE id=$1",
            [job.id],
          );
          if (current.rows[0]?.status !== "running") controller.abort();
        } catch {
          controller.abort();
        }
      }, 1000);
    try {
      const signal = AbortSignal.any([
        controller.signal,
        AbortSignal.timeout(
          job.kind === "summary"
            ? 600000
            : job.kind === "transcribe"
              ? 120000
              : 60000,
        ),
      ]);
      const result =
        job.kind === "extract"
          ? await extract(job)
          : job.kind === "transcribe"
            ? await transcribe(job, signal)
            : await executeAI(job, signal);
      await tx(service, async (db) => {
        await db.query(
          "UPDATE jobs SET status='done',result=$2,progress=100,updated_at=now() WHERE id=$1 AND status='running'",
          [job.id, JSON.stringify(result || {})],
        );
      });
    } catch (e) {
      await tx(service, async (db) => {
        await db.query(
          "UPDATE jobs SET status='failed',error=$2,updated_at=now() WHERE id=$1 AND status='running'",
          [job.id, e instanceof Error ? e.message.slice(0, 200) : "任务失败"],
        );
      });
    } finally {
      clearInterval(timer);
    }
  },
  { connection, concurrency: 3 },
);
worker.on("error", () => console.error("Queue connection unavailable"));
let dispatching = false;
const dispatch = async () => {
  if (dispatching) return;
  dispatching = true;
  try {
    await tx(service, async (db) => {
      await db.query(
        "UPDATE outbox SET status='unknown',error='发送进程中断，需人工核对',updated_at=now() WHERE status='sending' AND updated_at<now()-interval '2 minutes'",
      );
      await db.query(
        "UPDATE jobs SET status='queued',updated_at=now() WHERE status='running' AND updated_at<now()-interval '12 minutes'",
      );
    });
    const jobs = await pool.query(
      "SELECT id FROM jobs WHERE status='queued' ORDER BY created_at LIMIT 100",
    );
    for (const j of jobs.rows)
      await queue.add(
        "execute",
        { id: j.id },
        { jobId: j.id, removeOnComplete: true, removeOnFail: 1000 },
      );
  } catch {
    console.error("Worker database/queue unavailable");
  } finally {
    dispatching = false;
  }
};
const timers = [
  setInterval(() => void cleanupDeletedBlobs().catch(() => {}), 5000),
  setInterval(() => void dispatch(), 1500),
  setInterval(() => void reconcile().catch(() => {}), 5000),
  setInterval(() => void drainOutbox().catch(() => {}), 1000),
];
await dispatch();
await reconcile();
console.log("SmarChat native worker ready");
for (const sig of ["SIGTERM", "SIGINT"])
  process.on(sig, async () => {
    timers.forEach(clearInterval);
    await stopSockets();
    await worker.close();
    await queue.close();
    await pool.end();
    process.exit(0);
  });
