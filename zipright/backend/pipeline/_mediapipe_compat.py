from __future__ import annotations

from google.protobuf import message_factory, symbol_database


def ensure_protobuf_compatibility() -> None:
    """Bridge MediaPipe onto newer protobuf releases that removed GetPrototype."""

    if hasattr(symbol_database.SymbolDatabase, "GetPrototype") and hasattr(message_factory.MessageFactory, "GetPrototype"):
        return

    def _get_prototype(_, descriptor):
        return message_factory.GetMessageClass(descriptor)

    if not hasattr(symbol_database.SymbolDatabase, "GetPrototype"):
        symbol_database.SymbolDatabase.GetPrototype = _get_prototype
    if not hasattr(message_factory.MessageFactory, "GetPrototype"):
        message_factory.MessageFactory.GetPrototype = _get_prototype
