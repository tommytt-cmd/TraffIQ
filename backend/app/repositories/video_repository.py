from __future__ import annotations

from uuid import UUID
from datetime import datetime

from sqlalchemy import select, update, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.enums import VideoStatus
from app.models.video import Video


class VideoRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def create(
        self,
        *,
        video_id: str,
        original_filename: str,
        filename: str,
        storage_path: str,
        video_url: str,
        thumbnail_url: str | None,
        location_name: str,
        country: str | None,
        duration_seconds: int,
        filesize: int,
        width: int,
        height: int,
        fps: float,
        vehicle_total: int,
        checksum: str,
        status: VideoStatus = VideoStatus.UPLOADING,
        processed_at: datetime | None = None,
        commit: bool = True,
    ) -> Video:
        video = Video(
            video_id=video_id,
            original_filename=original_filename,
            filename=filename,
            storage_path=storage_path,
            video_url=video_url,
            thumbnail_url=thumbnail_url,
            location_name=location_name,
            country=country,
            duration_seconds=duration_seconds,
            filesize=filesize,
            width=width,
            height=height,
            fps=fps,
            vehicle_total=vehicle_total,
            checksum=checksum,
            status=status.value,
            processed_at=processed_at,
        )
        self.session.add(video)
        if commit:
            await self.session.commit()
        await self.session.flush()
        await self.session.refresh(video)
        return video

    async def exists_by_video_id(self, video_id: str) -> bool:
        result = await self.session.execute(select(Video).where(Video.video_id == video_id))
        return result.scalar_one_or_none() is not None

    async def exists_by_checksum(self, checksum: str) -> bool:
        result = await self.session.execute(select(Video).where(Video.checksum == checksum))
        return result.scalar_one_or_none() is not None

    async def get(self, video_id: str | UUID) -> Video | None:
        if isinstance(video_id, str):
            result = await self.session.execute(select(Video).where(Video.video_id == video_id))
            video = result.scalar_one_or_none()
            if video is not None:
                return video
            try:
                uuid_value = UUID(video_id)
                result = await self.session.execute(select(Video).where(Video.id == uuid_value))
                return result.scalar_one_or_none()
            except ValueError:
                return None
        result = await self.session.execute(select(Video).where(Video.id == video_id))
        return result.scalar_one_or_none()

    async def get_by_id(self, video_id: UUID) -> Video | None:
        result = await self.session.execute(select(Video).where(Video.id == video_id))
        return result.scalar_one_or_none()

    async def get_ready(self) -> Video | None:
        result = await self.session.execute(
            select(Video)
            .where(Video.status == VideoStatus.READY.value)
            .order_by(func.random())
            .limit(1)
        )
        return result.scalar_one_or_none()

    async def list_by_ids(self, video_ids: set[UUID]) -> list[Video]:
        if not video_ids:
            return []
        result = await self.session.execute(select(Video).where(Video.id.in_(video_ids)))
        return list(result.scalars().all())

    async def update_status(self, video: Video, status: VideoStatus) -> Video:
        video.status = status.value
        self.session.add(video)
        await self.session.commit()
        await self.session.refresh(video)
        return video

    async def update_status_for_all(self, status: VideoStatus) -> int:
        """Reset all videos to the given status. Returns count of updated videos."""
        stmt = update(Video).values(status=status.value)
        result = await self.session.execute(stmt)
        await self.session.commit()
        return result.rowcount

    async def list_all(self) -> list[Video]:
        result = await self.session.execute(select(Video).order_by(Video.created_at.desc()))
        return list(result.scalars().all())
