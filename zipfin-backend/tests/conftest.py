"""Shared test doubles for the seller domain — an in-memory Firestore fake."""

from __future__ import annotations

from datetime import datetime, timezone

import pytest


def _resolve_sentinels(data: dict) -> dict:
    from firebase_admin import firestore as firebase_firestore

    return {
        key: datetime.now(timezone.utc) if value is firebase_firestore.SERVER_TIMESTAMP else value
        for key, value in data.items()
    }


class _FakeSnapshot:
    def __init__(self, data: dict | None, key: str | None = None) -> None:
        self._data = data
        self.id = key

    @property
    def exists(self) -> bool:
        return self._data is not None

    def to_dict(self) -> dict | None:
        return dict(self._data) if self._data is not None else None


class _FakeDocument:
    def __init__(self, store: dict[str, dict], key: str) -> None:
        self._store = store
        self._key = key

    @property
    def id(self) -> str:
        return self._key

    def get(self) -> _FakeSnapshot:
        return _FakeSnapshot(self._store.get(self._key), self._key)

    def create(self, data: dict) -> None:
        from google.api_core.exceptions import AlreadyExists

        if self._key in self._store:
            raise AlreadyExists(f"Document {self._key} already exists.")
        self._store[self._key] = _resolve_sentinels(data)

    def set(self, data: dict, merge: bool = False) -> None:
        resolved = _resolve_sentinels(data)
        if merge and self._key in self._store:
            self._store[self._key] = {**self._store[self._key], **resolved}
        else:
            self._store[self._key] = resolved

    def delete(self) -> None:
        self._store.pop(self._key, None)


class _FakeQuery:
    def __init__(self, store: dict[str, dict], filters: list | None = None) -> None:
        self._store = store
        self._filters = filters or []

    def where(self, field_path: str, op_string: str, value: any) -> _FakeQuery:
        return _FakeQuery(self._store, self._filters + [(field_path, op_string, value)])

    def get(self) -> list[_FakeSnapshot]:
        results = []
        for key, doc_data in self._store.items():
            match = True
            for field, op, val in self._filters:
                if op == "==":
                    if doc_data.get(field) != val:
                        match = False
                        break
            if match:
                results.append(_FakeSnapshot(doc_data, key))
        return results


class _FakeCollection:
    def __init__(self, store: dict[str, dict]) -> None:
        self._store = store

    def document(self, key: str | None = None) -> _FakeDocument:
        if key is None:
            import uuid
            key = f"mock_doc_{uuid.uuid4().hex[:8]}"
        return _FakeDocument(self._store, key)

    def get(self) -> list[_FakeSnapshot]:
        return _FakeQuery(self._store).get()

    def where(self, field_path: str, op_string: str, value: any) -> _FakeQuery:
        return _FakeQuery(self._store).where(field_path, op_string, value)



class FakeFirestore:
    """Minimal Firestore stand-in: collection/document/get/create/set(merge)."""

    def __init__(self) -> None:
        self.collections: dict[str, dict[str, dict]] = {}

    def collection(self, name: str) -> _FakeCollection:
        return _FakeCollection(self.collections.setdefault(name, {}))

    def seed(self, collection: str, key: str, data: dict) -> None:
        self.collections.setdefault(collection, {})[key] = _resolve_sentinels(data)


@pytest.fixture
def fake_client() -> FakeFirestore:
    return FakeFirestore()
