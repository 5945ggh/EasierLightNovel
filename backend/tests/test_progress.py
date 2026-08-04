import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from fastapi import HTTPException

from app.models import Book, Chapter, ChapterProgress, UserProgress, Base
from app.database import get_db
from app.routers.books import router as books_router
from app.schemas import ChapterProgressUpdate, UserProgressUpdate
from app.services.progress_service import ProgressService


@pytest.fixture
def progress_db(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'progress.db'}", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    session = Session(engine)
    book = Book(id="progress-book", title="Progress")
    book.chapters = [
        Chapter(index=0, title="First", content_json=[]),
        Chapter(index=1, title="Second", content_json=[]),
        Chapter(index=2, title="Third", content_json=[]),
    ]
    session.add(book)
    session.commit()
    yield session
    session.close()


def test_get_progress_returns_default_without_persisting(progress_db):
    progress = ProgressService(progress_db).get_progress("progress-book")

    assert progress.book_id == "progress-book"
    assert progress.current_chapter_index == 0
    assert progress.progress_percentage == 0.0
    assert progress_db.query(UserProgress).count() == 0


def test_chapter_checkpoint_upsert_is_unique_and_ordered(progress_db):
    service = ProgressService(progress_db)
    second = service.update_chapter_progress(
        "progress-book",
        1,
        ChapterProgressUpdate(current_segment_index=8, progress_percentage=40.0),
    )
    first = service.update_chapter_progress(
        "progress-book",
        0,
        ChapterProgressUpdate(current_segment_index=2, progress_percentage=10.0),
    )
    first_id = first.id
    first_timestamp = first.updated_at
    updated_first = service.update_chapter_progress(
        "progress-book",
        0,
        ChapterProgressUpdate(current_segment_index=5, progress_percentage=25.0),
    )

    rows = service.get_chapter_progress("progress-book")
    assert [row.chapter_index for row in rows] == [0, 1]
    assert updated_first.id == first_id
    assert updated_first.current_segment_index == 5
    assert updated_first.updated_at is not None
    assert first_timestamp is not None
    assert updated_first.updated_at > first_timestamp
    assert second.chapter_index == 1
    assert progress_db.query(ChapterProgress).count() == 2


@pytest.mark.parametrize(
    ("column", "value"),
    [
        ("current_segment_index", -1),
        ("progress_percentage", -0.1),
        ("progress_percentage", 100.1),
    ],
)
def test_chapter_checkpoint_range_constraints(progress_db, column, value):
    chapter = progress_db.query(Chapter).filter(Chapter.index == 0).one()
    values = {
        "book_id": "progress-book",
        "chapter_id": chapter.id,
        "chapter_index": 0,
        "current_segment_index": 0,
        "progress_percentage": 0.0,
        "state": "in_progress",
    }
    values[column] = value
    with pytest.raises(IntegrityError):
        progress_db.execute(
            text(
                "INSERT INTO chapter_progress "
                "(book_id, chapter_id, chapter_index, current_segment_index, progress_percentage, state) "
                "VALUES (:book_id, :chapter_id, :chapter_index, :current_segment_index, :progress_percentage, :state)"
            ),
            values,
        )
        progress_db.commit()
    progress_db.rollback()


def test_chapter_checkpoint_state_constraint(progress_db):
    chapter = progress_db.query(Chapter).filter(Chapter.index == 0).one()
    with pytest.raises(IntegrityError):
        progress_db.execute(
            text(
                "INSERT INTO chapter_progress "
                "(book_id, chapter_id, chapter_index, current_segment_index, progress_percentage, state) "
                "VALUES ('progress-book', :chapter_id, 0, 0, 0, 'invalid')"
            ),
            {"chapter_id": chapter.id},
        )
        progress_db.commit()
    progress_db.rollback()


def test_delete_book_cascades_chapter_checkpoints(progress_db):
    service = ProgressService(progress_db)
    service.update_chapter_progress(
        "progress-book",
        0,
        ChapterProgressUpdate(current_segment_index=1, progress_percentage=5.0),
    )
    book = progress_db.get(Book, "progress-book")
    progress_db.delete(book)
    progress_db.commit()

    assert progress_db.query(ChapterProgress).count() == 0


def test_chapter_only_write_does_not_move_book_resume(progress_db):
    service = ProgressService(progress_db)
    service.update_progress(
        "progress-book",
        UserProgressUpdate(
            current_chapter_index=0,
            current_segment_index=3,
            progress_percentage=15.0,
        ),
    )
    before = service.get_progress("progress-book")

    service.update_chapter_progress(
        "progress-book",
        1,
        ChapterProgressUpdate(current_segment_index=9, progress_percentage=80.0),
    )
    after = service.get_progress("progress-book")

    assert (after.current_chapter_index, after.current_segment_index, after.progress_percentage) == (
        before.current_chapter_index,
        before.current_segment_index,
        before.progress_percentage,
    )


def test_confirmed_reading_updates_both_layers_in_one_operation(progress_db):
    service = ProgressService(progress_db)
    progress = service.update_progress(
        "progress-book",
        UserProgressUpdate(
            current_chapter_index=2,
            current_segment_index=12,
            progress_percentage=66.5,
        ),
    )

    checkpoint = progress_db.query(ChapterProgress).filter(
        ChapterProgress.book_id == "progress-book",
        ChapterProgress.chapter_index == 2,
    ).one()
    assert (progress.current_chapter_index, progress.current_segment_index, progress.progress_percentage) == (2, 12, 66.5)
    assert (checkpoint.current_segment_index, checkpoint.progress_percentage, checkpoint.state) == (12, 66.5, "in_progress")
    assert progress.updated_at is not None
    assert checkpoint.updated_at == progress.updated_at


def test_progress_service_rejects_missing_chapter(progress_db):
    with pytest.raises(HTTPException) as exc_info:
        ProgressService(progress_db).update_chapter_progress(
            "progress-book",
            99,
            ChapterProgressUpdate(),
        )

    assert getattr(exc_info.value, "status_code", None) == 404


def test_progress_api_keeps_legacy_book_shape_and_exposes_chapter_routes(progress_db):
    app = FastAPI()
    app.include_router(books_router)
    app.dependency_overrides[get_db] = lambda: progress_db
    client = TestClient(app)

    initial = client.get("/api/books/progress-book/progress")
    assert initial.status_code == 200
    assert initial.json() == {
        "current_chapter_index": 0,
        "current_segment_index": 0,
        "progress_percentage": 0.0,
        "book_id": "progress-book",
        "updated_at": None,
    }
    assert progress_db.query(UserProgress).count() == 0

    legacy_update = client.put(
        "/api/books/progress-book/progress",
        json={
            "current_chapter_index": 0,
            "current_segment_index": 2,
            "progress_percentage": 20.0,
        },
    )
    assert legacy_update.status_code == 200
    assert set(legacy_update.json()) == {
        "current_chapter_index",
        "current_segment_index",
        "progress_percentage",
        "book_id",
        "updated_at",
    }

    chapter_update = client.put(
        "/api/books/progress-book/progress/chapters/1",
        json={
            "current_segment_index": 7,
            "progress_percentage": 70.0,
            "state": "completed",
        },
    )
    assert chapter_update.status_code == 200
    assert chapter_update.json()["state"] == "completed"
    assert client.get("/api/books/progress-book/progress").json()["current_chapter_index"] == 0

    app.dependency_overrides.clear()
