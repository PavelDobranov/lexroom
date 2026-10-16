# Lexroom

Lexroom is a shared law-firm workspace for AI-assisted contract reviews.

## Local development

Install dependencies, explicitly initialize the local database, and start the app:

```bash
npm install
npm run db:setup
npm run dev
```

Database setup applies the checked-in Drizzle migrations and reconciles the supplied public sample data. It is safe to run repeatedly: matching and unrelated rows are preserved, missing sample rows are inserted, and conflicting sample IDs fail without overwriting or partially loading fixture data.

The default SQLite file is `data/lexroom.db`, which is ignored by Git. Set `DATABASE_URL` to use another file:

```bash
DATABASE_URL=/tmp/lexroom.sqlite npm run db:setup
DATABASE_URL=/tmp/lexroom.sqlite npm run dev
```

Starting the application does not create, migrate, seed, or reset a database. Run setup explicitly before using a new database file.

## Validation

```bash
npm test
npm run lint
npm run build
```
