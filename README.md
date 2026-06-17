# Boiler

Minimal Express + TypeScript starter.

## Setup

1. Install dependencies.
2. Copy `.env.example` to `.env`.
3. Start the app.

```bash
pnpm install
cp .env.example .env
pnpm build
pnpm start
```

For local development:

```bash
pnpm dev
```

## Environment

- `PORT`: server port. Defaults to `3000` if not set.

## Notes

- Runtime logs are written to `logs/` and ignored by git.