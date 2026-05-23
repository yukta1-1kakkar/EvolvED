from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker
from sqlalchemy.orm import declarative_base
from sqlalchemy import text
import os
from typing import AsyncGenerator

Base = declarative_base()

DATABASE_URL = (
    f"postgresql+asyncpg://{os.getenv('POSTGRES_USER','edu')}:{os.getenv('POSTGRES_PASSWORD','edu_pass')}@{os.getenv('POSTGRES_HOST','postgres')}:{os.getenv('POSTGRES_PORT','5432')}/{os.getenv('POSTGRES_DB','evolved_db')}"
)

engine = create_async_engine(DATABASE_URL, echo=False, future=True)
AsyncSessionLocal = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async with AsyncSessionLocal() as session:
        yield session


async def init_db():
    # Connect to DB to ensure configuration; migrations managed by Alembic.
    async with AsyncSessionLocal() as session:
        await session.execute(text("SELECT 1"))
        await session.commit()

