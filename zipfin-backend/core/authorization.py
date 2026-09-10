"""ZipRIGHT Centralized Server-Authoritative Authorization Foundation (Phase 1A).

Enforces server-authoritative role and permission decisions based on verified
Firebase identities and server-managed Firestore records (admins/{uid} and sellers/{uid}).

SECURITY & PRIVACY PRINCIPLES:
1. Default deny: all actions require explicit role or permission grant.
2. Least privilege: roles only receive permissions for verified capabilities.
3. Biometric & fit privacy: internal admin/staff roles do NOT receive cross-tenant
   access to customer body measurements, SmartFit scans, or private fit data.
4. Client trust elimination: localStorage, query params, or client-supplied role
   values are strictly ignored for authorization.
5. Privacy-safe auditing: denials are recorded via core.security_logger without
   leaking tokens, passwords, raw photos, or biometric data.
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from enum import Enum
import logging
from typing import Any, Callable

from fastapi import Depends, HTTPException, Request, status

from core.security_logger import log_security_event
from services.admin_auth import AdminGate, get_admin_gate
from services.firebase_auth import AuthenticatedUser, get_current_user
from services.seller_repository import SellerRepository, get_seller_repository

logger = logging.getLogger(__name__)


# ── Role Definitions ──────────────────────────────────────────────────────────

class Role(str, Enum):
    # Implemented / Active Roles
    CUSTOMER = "customer"
    SELLER = "seller"
    ADMIN = "admin"

    # Foundation-Only Role (Future Expansion)
    SUPER_ADMIN = "super_admin"

    # Future Enterprise Roles (Not Yet Implemented — No Permissions in Phase 1A)
    SUPPORT_AGENT = "support_agent"
    OPERATIONS = "operations"
    REFUND_MANAGER = "refund_manager"
    SELLER_MANAGER = "seller_manager"
    MODERATOR = "moderator"
    FINANCE = "finance"
    SECURITY = "security"
    ANALYST = "analyst"


# ── Permission Definitions ────────────────────────────────────────────────────

class Permission(str, Enum):
    # Current Customer Capabilities
    PROFILE_READ_OWN = "profile:read_own"
    PROFILE_WRITE_OWN = "profile:write_own"
    FIT_READ_OWN = "fit:read_own"
    FIT_WRITE_OWN = "fit:write_own"
    TRYON_USE = "tryon:use"

    # Current Seller Capabilities
    SELLER_MANAGE_STORE = "seller:manage_own_store"
    SELLER_MANAGE_PRODUCTS = "seller:manage_own_products"
    SELLER_VIEW_ANALYTICS = "seller:view_analytics"

    # Current Admin Capabilities
    ADMIN_MANAGE_SELLERS = "admin:manage_sellers"
    ADMIN_MANAGE_TRYON_GARMENTS = "admin:manage_tryon_garments"
    ADMIN_MANAGE_SYSTEM = "admin:manage_system"

    # Future Placeholders — [NOT YET IMPLEMENTED]
    REFUNDS_PROCESS = "refunds:process"
    FINANCE_VIEW_REPORTS = "finance:view_reports"
    MODERATION_MODERATE_CONTENT = "moderation:moderate_content"
    SECURITY_VIEW_AUDIT_LOGS = "security:view_audit_logs"


# ── Role-to-Permissions Mapping ───────────────────────────────────────────────

_CUSTOMER_PERMISSIONS: frozenset[Permission] = frozenset({
    Permission.PROFILE_READ_OWN,
    Permission.PROFILE_WRITE_OWN,
    Permission.FIT_READ_OWN,
    Permission.FIT_WRITE_OWN,
    Permission.TRYON_USE,
})

_SELLER_PERMISSIONS: frozenset[Permission] = _CUSTOMER_PERMISSIONS | frozenset({
    Permission.SELLER_MANAGE_STORE,
    Permission.SELLER_MANAGE_PRODUCTS,
    Permission.SELLER_VIEW_ANALYTICS,
})

# Admin capabilities do NOT include cross-tenant biometric/fit access.
# Private fit data remains owner-only under the Phase 1A privacy boundary.
_ADMIN_PERMISSIONS: frozenset[Permission] = _CUSTOMER_PERMISSIONS | frozenset({
    Permission.ADMIN_MANAGE_SELLERS,
    Permission.ADMIN_MANAGE_TRYON_GARMENTS,
    Permission.ADMIN_MANAGE_SYSTEM,
})

ROLE_PERMISSIONS: dict[Role, frozenset[Permission]] = {
    Role.CUSTOMER: _CUSTOMER_PERMISSIONS,
    Role.SELLER: _SELLER_PERMISSIONS,
    Role.ADMIN: _ADMIN_PERMISSIONS,
    # SUPER_ADMIN is foundation only — NOT an active privileged role in Phase 1A
    Role.SUPER_ADMIN: frozenset(),

    # Future roles intentionally have empty permission sets in Phase 1A
    Role.SUPPORT_AGENT: frozenset(),
    Role.OPERATIONS: frozenset(),
    Role.REFUND_MANAGER: frozenset(),
    Role.SELLER_MANAGER: frozenset(),
    Role.MODERATOR: frozenset(),
    Role.FINANCE: frozenset(),
    Role.SECURITY: frozenset(),
    Role.ANALYST: frozenset(),
}


# ── Authorization Context ─────────────────────────────────────────────────────

@dataclass
class UserAuthorizationContext:
    """Server-authoritative authorization context resolved from verified identity."""

    user: AuthenticatedUser
    primary_role: Role
    roles: set[Role] = field(default_factory=set)
    permissions: set[Permission] = field(default_factory=set)
    seller_profile: dict[str, Any] | None = None

    @property
    def uid(self) -> str:
        return self.user.uid

    @property
    def email(self) -> str | None:
        return self.user.email

    @property
    def is_admin(self) -> bool:
        return Role.ADMIN in self.roles

    @property
    def is_seller(self) -> bool:
        return Role.SELLER in self.roles

    def has_role(self, *roles: Role) -> bool:
        return any(r in self.roles for r in roles)

    def has_permission(self, permission: Permission) -> bool:
        return permission in self.permissions


# ── Server-Side Role Resolution ───────────────────────────────────────────────

async def resolve_authorization_context(
    current_user: AuthenticatedUser,
    admin_gate: AdminGate,
    seller_repository: SellerRepository,
) -> UserAuthorizationContext:
    """Resolve authoritative roles and permissions strictly from server storage."""
    is_admin, seller_record = await asyncio.gather(
        asyncio.to_thread(admin_gate.is_admin, current_user.uid),
        asyncio.to_thread(seller_repository.get_seller, current_user.uid),
    )

    roles: set[Role] = {Role.CUSTOMER}
    primary_role = Role.CUSTOMER

    if is_admin:
        roles.add(Role.ADMIN)
        primary_role = Role.ADMIN

    is_active_seller = bool(seller_record and seller_record.get("status") == "active")
    if is_active_seller:
        roles.add(Role.SELLER)
        if primary_role == Role.CUSTOMER:
            primary_role = Role.SELLER

    # Aggregate permissions across all active assigned roles
    effective_permissions: set[Permission] = set()
    for role in roles:
        effective_permissions.update(ROLE_PERMISSIONS.get(role, frozenset()))

    return UserAuthorizationContext(
        user=current_user,
        primary_role=primary_role,
        roles=roles,
        permissions=effective_permissions,
        seller_profile=seller_record if is_active_seller else None,
    )


# ── FastAPI Dependencies ──────────────────────────────────────────────────────

async def get_authorization_context(
    request: Request,
    current_user: AuthenticatedUser = Depends(get_current_user),
    admin_gate: AdminGate = Depends(get_admin_gate),
    seller_repository: SellerRepository = Depends(get_seller_repository),
) -> UserAuthorizationContext:
    """FastAPI Dependency: resolves server-authoritative roles and permissions."""
    context = await resolve_authorization_context(
        current_user=current_user,
        admin_gate=admin_gate,
        seller_repository=seller_repository,
    )
    request.state.auth_context = context
    return context


def require_role(*allowed_roles: Role) -> Callable[..., Any]:
    """Dependency factory: enforces caller has at least one of the specified roles."""
    async def _role_guard(
        request: Request,
        context: UserAuthorizationContext = Depends(get_authorization_context),
    ) -> UserAuthorizationContext:
        if not context.has_role(*allowed_roles):
            client_ip = request.client.host if request.client else "unknown"
            endpoint = request.url.path
            log_security_event(
                event_type="SECURITY_AUTHORIZATION_DENIED",
                severity="WARNING",
                ip_address=client_ip,
                user_id=context.uid,
                email=context.email,
                endpoint=endpoint,
                details={
                    "reason": "insufficient_role",
                    "required_roles": [r.value for r in allowed_roles],
                    "assigned_roles": [r.value for r in context.roles],
                },
            )
            # Differentiate admin denial code for legacy frontend compatibility
            if Role.ADMIN in allowed_roles and not context.is_admin:
                detail_code = "not_an_admin"
                message = "Administrator access required."
            elif Role.SELLER in allowed_roles and not context.is_seller:
                detail_code = "not_a_seller"
                message = "Seller access required."
            else:
                detail_code = "forbidden_role"
                message = "You do not have the required role to access this resource."

            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail={
                    "message": message,
                    "details": {"code": detail_code},
                },
            )
        return context

    return _role_guard


def require_permission(permission: Permission) -> Callable[..., Any]:
    """Dependency factory: enforces caller has the specific capability permission."""
    async def _permission_guard(
        request: Request,
        context: UserAuthorizationContext = Depends(get_authorization_context),
    ) -> UserAuthorizationContext:
        if not context.has_permission(permission):
            client_ip = request.client.host if request.client else "unknown"
            endpoint = request.url.path
            log_security_event(
                event_type="SECURITY_AUTHORIZATION_DENIED",
                severity="WARNING",
                ip_address=client_ip,
                user_id=context.uid,
                email=context.email,
                endpoint=endpoint,
                details={
                    "reason": "missing_permission",
                    "required_permission": permission.value,
                    "assigned_roles": [r.value for r in context.roles],
                },
            )
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail={
                    "message": f"Missing required permission: '{permission.value}'.",
                    "details": {"code": "insufficient_permission"},
                },
            )
        return context

    return _permission_guard
