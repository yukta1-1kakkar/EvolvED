from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker
from sqlalchemy.orm import declarative_base
from sqlalchemy import text
from typing import AsyncGenerator
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from app.core.config import settings

Base = declarative_base()


def _normalise_database_url(database_url: str | None) -> tuple[str, dict]:
    if not database_url:
        raise RuntimeError("DATABASE_URL must be set to the Neon PostgreSQL connection string.")

    url = database_url.strip()
    if url.startswith("postgresql://"):
        url = "postgresql+asyncpg://" + url.removeprefix("postgresql://")
    elif url.startswith("postgres://"):
        url = "postgresql+asyncpg://" + url.removeprefix("postgres://")

    parts = urlsplit(url)
    query = dict(parse_qsl(parts.query, keep_blank_values=True))
    sslmode = query.pop("sslmode", None)
    query.pop("channel_binding", None)
    normalised = urlunsplit((parts.scheme, parts.netloc, parts.path, urlencode(query), parts.fragment))

    connect_args = {}
    if sslmode and sslmode != "disable":
        connect_args["ssl"] = True

    return normalised, connect_args


DATABASE_URL, CONNECT_ARGS = _normalise_database_url(settings.database_url)

engine = create_async_engine(
    DATABASE_URL,
    echo=False,
    future=True,
    pool_size=settings.database_pool_size,
    max_overflow=settings.database_max_overflow,
    pool_recycle=settings.database_pool_recycle,
    pool_pre_ping=settings.database_pool_pre_ping,
    connect_args=CONNECT_ARGS,
)
AsyncSessionLocal = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async with AsyncSessionLocal() as session:
        yield session


async def init_db():
    # Connect to DB to ensure configuration; migrations managed by Alembic.
    async with AsyncSessionLocal() as session:
        await session.execute(text("SELECT 1"))
        await session.commit()

