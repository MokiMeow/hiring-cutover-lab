import { randomUUID } from 'node:crypto';
import { AuthStore, AppError, text, hash } from './auth.mjs';
import { reconcile, digest, boundedJSON } from './engine.mjs';
export { AppError } from './auth.mjs';
export class Store extends AuthStore {
  constructor(path, options = {}) {
    super(path, options);
    this.db
      .exec(`CREATE TABLE IF NOT EXISTS runs(id TEXT PRIMARY KEY,label TEXT NOT NULL,created INTEGER NOT NULL,actor TEXT NOT NULL,bundle TEXT NOT NULL,bundle_hash TEXT NOT NULL,report TEXT NOT NULL,report_hash TEXT NOT NULL,verdict TEXT NOT NULL) STRICT;
 CREATE TABLE IF NOT EXISTS requests(key TEXT PRIMARY KEY,fingerprint TEXT NOT NULL,run_id TEXT NOT NULL REFERENCES runs(id)) STRICT;
 CREATE TABLE IF NOT EXISTS reviews(run_id TEXT PRIMARY KEY REFERENCES runs(id),at INTEGER NOT NULL,actor TEXT NOT NULL,reason TEXT NOT NULL,report_hash TEXT NOT NULL) STRICT;
 PRAGMA user_version=1;`);
  }
  createRun(input, key, actor) {
    const label = text(input.label, 'label', 100);
    boundedJSON(input.bundle);
    const requestKey = hash(text(key, 'idempotency key', 200)),
      fingerprint = digest({ label, bundle: input.bundle });
    const prior = this.db.prepare('SELECT * FROM requests WHERE key=?').get(requestKey);
    if (prior) {
      if (prior.fingerprint !== fingerprint)
        throw new AppError(409, 'Idempotency key already used for different input');
      return { created: false, run: this.run(prior.run_id) };
    }
    const report = reconcile(input.bundle),
      reportHash = digest(report),
      id = randomUUID();
    return this.transaction(() => {
      this.db
        .prepare('INSERT INTO runs VALUES(?,?,?,?,?,?,?,?,?)')
        .run(
          id,
          label,
          this.clock(),
          actor,
          JSON.stringify(input.bundle),
          report.evidence.bundleHash,
          JSON.stringify(report),
          reportHash,
          report.verdict,
        );
      this.db.prepare('INSERT INTO requests VALUES(?,?,?)').run(requestKey, fingerprint, id);
      this.audit(actor, 'rehearsal_created', id, { verdict: report.verdict, reportHash });
      return { created: true, run: this.run(id) };
    });
  }
  run(id) {
    const row = this.db.prepare('SELECT * FROM runs WHERE id=?').get(id);
    if (!row) throw new AppError(404, 'Rehearsal not found');
    const report = JSON.parse(row.report),
      bundle = JSON.parse(row.bundle);
    if (
      digest(report) !== row.report_hash ||
      digest(bundle) !== row.bundle_hash ||
      report.evidence?.bundleHash !== row.bundle_hash
    )
      throw new AppError(409, 'Stored evidence integrity check failed');
    const review =
      this.db
        .prepare('SELECT at,actor,reason,report_hash AS reportHash FROM reviews WHERE run_id=?')
        .get(id) ?? null;
    if (review && review.reportHash !== row.report_hash)
      throw new AppError(409, 'Review integrity check failed');
    return {
      id: row.id,
      label: row.label,
      created: row.created,
      actor: row.actor,
      reportHash: row.report_hash,
      report,
      bundle,
      review,
    };
  }
  listRuns() {
    return this.db
      .prepare(
        'SELECT r.id,r.label,r.created,r.actor,r.verdict,r.report_hash AS reportHash,v.at AS reviewedAt,(v.run_id IS NOT NULL) AS approved FROM runs r LEFT JOIN reviews v ON v.run_id=r.id ORDER BY r.created DESC,r.rowid DESC LIMIT 500',
      )
      .all();
  }
  summary() {
    return {
      ...this.db
        .prepare(
          "SELECT count(*) AS total,coalesce(sum(r.verdict='ready' AND v.run_id IS NULL),0) AS ready,coalesce(sum(r.verdict='blocked'),0) AS blocked,coalesce(sum(v.run_id IS NOT NULL),0) AS approved FROM runs r LEFT JOIN reviews v ON v.run_id=r.id",
        )
        .get(),
    };
  }
  approve(id, expectedHash, reason, actor) {
    reason = text(reason, 'review reason', 500);
    return this.transaction(() => {
      const run = this.run(id);
      if (run.reportHash !== expectedHash)
        throw new AppError(409, 'Report changed; reload before review');
      if (run.report.verdict !== 'ready')
        throw new AppError(409, 'A blocked rehearsal cannot be approved');
      if (run.review) throw new AppError(409, 'Rehearsal already reviewed');
      this.db
        .prepare('INSERT INTO reviews VALUES(?,?,?,?,?)')
        .run(id, this.clock(), actor, reason, run.reportHash);
      this.audit(actor, 'rehearsal_approved', id, { reason, reportHash: run.reportHash });
      return this.run(id);
    });
  }
}
