import logging
from pathlib import Path

from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker
from sqlalchemy.orm import declarative_base
from sqlalchemy import text
from typing import AsyncGenerator
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from app.core.config import settings

Base = declarative_base()
logger = logging.getLogger(__name__)


def _local_sqlite_url() -> str:
    path = Path(__file__).resolve().parents[2] / "data" / "evolved_dev.db"
    path.parent.mkdir(parents=True, exist_ok=True)
    return f"sqlite+aiosqlite:///{path.as_posix()}"


def _normalise_database_url(database_url: str | None) -> tuple[str, dict, bool]:
    if settings.database_use_local_sqlite:
        return _local_sqlite_url(), {}, True

    if not database_url:
        raise RuntimeError("DATABASE_URL must be set to the Neon PostgreSQL connection string.")

    url = database_url.strip()
    if url.startswith("sqlite"):
        return url, {}, True

    if url.startswith("postgresql://"):
        url = "postgresql+asyncpg://" + url.removeprefix("postgresql://")
    elif url.startswith("postgres://"):
        url = "postgresql+asyncpg://" + url.removeprefix("postgres://")

    parts = urlsplit(url)
    query = dict(parse_qsl(parts.query, keep_blank_values=True))
    sslmode = query.pop("sslmode", None)
    query.pop("channel_binding", None)
    normalised = urlunsplit((parts.scheme, parts.netloc, parts.path, urlencode(query), parts.fragment))

    connect_args = {
        "timeout": settings.database_connect_timeout_seconds,
        "command_timeout": settings.database_command_timeout_seconds,
    }
    if sslmode and sslmode != "disable":
        connect_args["ssl"] = True

    return normalised, connect_args, False


DATABASE_URL, CONNECT_ARGS, IS_SQLITE = _normalise_database_url(settings.database_url)

engine_kwargs = {"echo": False, "future": True, "connect_args": CONNECT_ARGS}
if not IS_SQLITE:
    engine_kwargs.update(
        pool_size=settings.database_pool_size,
        max_overflow=settings.database_max_overflow,
        pool_recycle=settings.database_pool_recycle,
        pool_pre_ping=settings.database_pool_pre_ping,
        pool_use_lifo=settings.database_pool_use_lifo,
        pool_timeout=settings.database_pool_timeout_seconds,
    )

engine = create_async_engine(DATABASE_URL, **engine_kwargs)
AsyncSessionLocal = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async with AsyncSessionLocal() as session:
        yield session


async def init_db():
    try:
        if IS_SQLITE:
            logger.info("Database mode: local SQLite (%s)", DATABASE_URL.rsplit("/", 1)[-1])
            from app.db import models as db_models  # noqa: F401 - import registers tables on Base

            async with engine.begin() as connection:
                await connection.run_sync(Base.metadata.create_all)
        else:
            logger.info("Database mode: remote Postgres")
            # Connect to DB to ensure configuration; migrations managed by Alembic.
            async with AsyncSessionLocal() as session:
                await session.execute(text("SELECT 1"))
                await session.commit()
    except Exception as exc:
        logger.warning("Database startup check failed; continuing with degraded local fallback mode: %r", exc)

