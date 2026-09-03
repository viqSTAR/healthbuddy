# Scheduled jobs

The platform has work that must happen on a timer. Nothing here runs itself —
these are the configurations to install, and they are written out because "run
the retention job nightly" is an instruction that gets lost and a file that does
not.

| Job | Command | When | Why |
| --- | --- | --- | --- |
| Retention sweep | `npm run retention -- --apply` | Nightly, off-peak | Enforces DATA-POLICY.md §2. Without it the real retention period for everything is "forever" |
| Stale offer expiry | `POST /api/v1/fulfilment/expire-stale` (admin) | Hourly | A prescription basket nobody consented to holds reserved stock |
| Restore drill | `npm run restore:drill -- --dump <nightly>` | Weekly | An untested backup is a hope. Test the backup you actually keep |
| Preflight | `npm run preflight` | On every deploy | Proves the external services a release depends on are reachable |

`--apply` is required for the retention sweep to delete anything; without it the
job reports and exits. That is deliberate — see `services/retentionService.ts`.

---

## cron

```cron
# Health Buddy scheduled jobs
# Times are the SERVER's local time. Set TZ=Asia/Kolkata on the host, or these
# run at the wrong hour and the "off-peak" sweep lands during evening orders.
TZ=Asia/Kolkata
MAILTO=ops@example.test

# Retention sweep — nightly at 03:15
15 3 * * *  cd /srv/healthbuddy && /usr/bin/npm run retention -- --apply >> /var/log/healthbuddy/retention.log 2>&1

# Restore drill — Sundays at 04:00, against last night's dump
0 4 * * 0   cd /srv/healthbuddy && /usr/bin/npm run restore:drill -- --dump /var/backups/healthbuddy/latest.sql >> /var/log/healthbuddy/restore-drill.log 2>&1
```

Both exit non-zero on failure, so `MAILTO` turns a failed sweep or a failed
restore into an email rather than a line nobody reads.

---

## systemd

Preferred over cron where available: it logs to the journal, will not overlap
runs, and `OnFailure` can page someone.

`/etc/systemd/system/healthbuddy-retention.service`

```ini
[Unit]
Description=Health Buddy retention sweep
After=network-online.target

[Service]
Type=oneshot
User=healthbuddy
WorkingDirectory=/srv/healthbuddy
Environment=NODE_ENV=production
Environment=TZ=Asia/Kolkata
EnvironmentFile=/etc/healthbuddy/env
ExecStart=/usr/bin/npm run retention -- --apply

# The sweep is idempotent and short. If it is still running after ten minutes
# something is wrong with the database, not with the job.
TimeoutStartSec=600
```

`/etc/systemd/system/healthbuddy-retention.timer`

```ini
[Unit]
Description=Nightly Health Buddy retention sweep

[Timer]
OnCalendar=*-*-* 03:15:00
# Survives the host being asleep or rebooted through the window.
Persistent=true
RandomizedDelaySec=300

[Install]
WantedBy=timers.target
```

```bash
systemctl enable --now healthbuddy-retention.timer
systemctl list-timers healthbuddy-retention   # confirm the next run
journalctl -u healthbuddy-retention -n 50     # read the last one
```

---

## Docker / Kubernetes

A `CronJob` running the same image as the API, with the same secrets:

```yaml
apiVersion: batch/v1
kind: CronJob
metadata:
  name: healthbuddy-retention
spec:
  schedule: "15 3 * * *"
  timeZone: "Asia/Kolkata"
  # If a run is still going, do not start another on top of it.
  concurrencyPolicy: Forbid
  successfulJobsHistoryLimit: 3
  failedJobsHistoryLimit: 7
  jobTemplate:
    spec:
      # A failing sweep is worth two retries and then an alert — not an endless
      # loop hammering the database.
      backoffLimit: 2
      template:
        spec:
          restartPolicy: Never
          containers:
            - name: retention
              image: healthbuddy-backend:latest
              command: ["npm", "run", "retention", "--", "--apply"]
              envFrom:
                - secretRef:
                    name: healthbuddy-env
```

---

## Managed platforms

- **Render** — Cron Job service, same environment group as the web service,
  command `npm run retention -- --apply`.
- **Railway** — a cron service on the shared project variables.
- **Fly.io** — `fly machine run --schedule daily <image> npm run retention -- --apply`.
- **Vercel / Netlify** — neither is a good host for this backend (it is a
  long-lived Express process with a Redis dependency), but if the API lives
  elsewhere their schedulers can hit an authenticated admin endpoint instead:
  `POST /api/v1/admin/retention/run` with `{"apply": true}`.

---

## A note on PATH

The restore drill shells out to `pg_dump` and `psql`. On the development machine
this repo was verified on, PostgreSQL is installed at
`D:/PostgreSQL/PostgreInstall/bin` and that directory is **not** on PATH — so
the drill fails until it is added. It says so clearly when that happens, but it
is worth knowing before the first run:

```bash
export PATH="/d/PostgreSQL/PostgreInstall/bin:$PATH"   # Git Bash
```

On a server, install `postgresql-client` and it is on PATH already. The client
version must be >= the server version.

## After installing any of these

Confirm it actually runs — a scheduled job nobody has seen succeed is not
scheduled, it is hoped for.

```bash
npm run retention          # dry run, immediately, by hand
# then, after the first scheduled window:
#   journalctl -u healthbuddy-retention   (systemd)
#   kubectl get jobs                       (kubernetes)
#   tail /var/log/healthbuddy/retention.log (cron)
```

And check the audit log: every applied sweep writes a `retention.swept` entry
with what it removed. If that entry is not appearing nightly, the job is not
running, whatever the scheduler claims.
