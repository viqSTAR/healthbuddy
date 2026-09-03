# Migrations

Schema changes reach a database through this directory and nowhere else.

## Why not `db push`

`prisma db push` makes the database match the schema by whatever means are
necessary, and it will drop a column — with the data in it — to do so. That is
the right tool for a scratch database you are iterating on and the wrong one for
any database somebody depends on, because:

- there is no record of what changed or when,
- there is no rollback, and
- there is nothing to review before it runs.

A migration is a file. It can be read in a pull request, applied identically to
staging and production, and pointed at afterwards when a query starts behaving
differently.

## Day to day

```bash
# after editing schema.prisma — writes a new migration and applies it locally
npm run prisma:migrate

# in production / CI — applies pending migrations, never generates one
npm run prisma:deploy

# what is applied and what is pending
npm run prisma:status
```

`prisma:deploy` is the only one that should ever run against production. It
refuses to generate, reset or drop anything; if the database has drifted from
the migration history it stops and says so rather than reconciling silently.

## The baseline

`00000000000000_baseline` is the whole schema as it stood when migrations were
introduced, generated with `migrate diff` from an empty database. It has been
verified to build a database identical to `schema.prisma` from scratch.

**An existing database that already has these tables must be told the baseline
is already applied**, or `migrate deploy` will try to create tables that are
there and fail:

```bash
npx prisma migrate resolve --applied 00000000000000_baseline
```

Run that once, per existing database. A brand-new database needs nothing — the
baseline applies like any other migration.

## Writing one that is safe to deploy

The application is deployed while the old version is still serving traffic, so
for a window both versions are talking to the same schema. That rules out a
whole class of migration:

- **Adding** a nullable column, or one with a default, is safe.
- **Adding** a `NOT NULL` column with no default is not — the old code does not
  write it. Add it nullable, backfill, then tighten in a later migration.
- **Renaming or dropping** a column is not safe in one step. Add the new one,
  write to both, migrate the readers, then drop the old one in a separate
  release.
- **An index on a large table** locks it. Prisma does not emit
  `CREATE INDEX CONCURRENTLY`; for a table with real volume, edit the generated
  SQL to use it and remove the migration's transaction wrapper, since
  `CONCURRENTLY` cannot run inside one.

Migration files are checked in, and they are not edited after they have been
applied anywhere. If one is wrong, the fix is another migration.
