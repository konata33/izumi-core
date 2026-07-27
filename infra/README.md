# Local Infrastructure

Start the local PostgreSQL and Redis services with `docker compose up -d`.

The default host ports are deliberately nonstandard (`54329` and `6389`) so
they are less likely to collide with unrelated local services. A single Core
integration workspace should own this Compose stack at a time. Override ports
with `POSTGRES_PORT` and `REDIS_PORT` when needed.
