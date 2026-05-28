from logging.config import fileConfig
import os
from sqlalchemy.engine import Connection

from alembic import context

# this is the Alembic Config object, which provides
# access to the values within the .ini file in use.
config = context.config

# Interpret the config file for Python logging.
fileConfig(config.config_file_name)

import sys
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))
from app.core.db import engine
from app.db import models as db_models


target_metadata = db_models.Base.metadata


def run_migrations_offline():
    raise RuntimeError("Offline migrations are not supported. Set DATABASE_URL and run online migrations against Neon.")


def do_run_migrations(conn: Connection):
    context.configure(connection=conn, target_metadata=target_metadata)

    with context.begin_transaction():
        context.run_migrations()


async def run_async_migrations():
    async with engine.connect() as connection:
        await connection.run_sync(do_run_migrations)
    await engine.dispose()


if context.is_offline_mode():
    run_migrations_offline()
else:
    import asyncio

    asyncio.run(run_async_migrations())
