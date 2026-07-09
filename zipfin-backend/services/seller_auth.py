"""Seller authorization for the Seller Dashboard REST API.

Layered on top of the existing Firebase auth: `get_current_user` proves who
the caller is (a real Firebase token — demo-anonymous sessions can never be
sellers), and this module proves the caller is an *active* seller by reading
the server-side sellers/{uid} document. Role never comes from the client.

Status semantics:
  no document -> 403 code "not_a_seller"   (frontend offers onboarding)
  pending     -> 403 code "seller_pending" (frontend shows "under review")
  rejected    -> 403 code "seller_rejected"
  suspended   -> 403 code "seller_suspended"
  active      -> request proceeds with a SellerContext
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from typing import Any

from fastapi import Depends, HTTPException, status

from services.firebase_auth import AuthenticatedUser, get_current_user
from services.seller_repository import SellerRepository, get_seller_repository


@dataclass
class SellerContext:
    """An authenticated user together with their active seller record."""

    user: AuthenticatedUser
    seller: dict[str, Any]

    @property
    def uid(self) -> str:
        return self.user.uid


async def _load_seller_context(
    current_user: AuthenticatedUser,
    repository: SellerRepository,
) -> SellerContext:
    """Load the caller's seller record or 403 when they are not a seller."""
    record = await asyncio.to_thread(repository.get_seller, current_user.uid)
    if record is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "message": "Seller profile required. Complete seller onboarding first.",
                "details": {"code": "not_a_seller"},
            },
        )
    return SellerContext(user=current_user, seller=record)


async def require_seller(
    current_user: AuthenticatedUser = Depends(get_current_user),
    repository: SellerRepository = Depends(get_seller_repository),
) -> SellerContext:
    """Any-status seller. Use for profile view/edit where a pending seller
    still needs access to their own record."""
    return await _load_seller_context(current_user, repository)


async def require_active_seller(
    current_user: AuthenticatedUser = Depends(get_current_user),
    repository: SellerRepository = Depends(get_seller_repository),
) -> SellerContext:
    """Active seller only. Use for real capabilities (products, analytics)."""
    context = await _load_seller_context(current_user, repository)
    seller_status = str(context.seller.get("status", ""))
    if seller_status != "active":
        messages = {
            "pending": "Your seller application is under review.",
            "rejected": "Your seller application was not approved.",
            "suspended": "Your seller account is suspended.",
        }
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "message": messages.get(seller_status, "Seller account is not active."),
                "details": {"code": f"seller_{seller_status or 'inactive'}"},
            },
        )
    return context
