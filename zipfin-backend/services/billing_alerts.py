"""Cloud billing and budget threshold monitoring service for ZipRIGHT.

Monitors compute, AI inference token usage, and database operations against
configured safety budgets. Triggers urgent alerts upon anomalous spending spikes
indicative of Denial-of-Wallet (DoW) or resource depletion attacks.
"""

from __future__ import annotations

from datetime import datetime, timezone
import logging
import os
from typing import Any
from fastapi import APIRouter, HTTPException, Request, status
from pydantic import BaseModel, Field

from core.security_logger import log_security_event

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/billing", tags=["billing"])

# Safety thresholds (INR or USD equivalents)
MONTHLY_SAFETY_BUDGET_RUPEES = float(os.getenv("MONTHLY_SAFETY_BUDGET_RUPEES", "50000.0"))
ALERT_THRESHOLDS = (0.50, 0.80, 1.00, 1.20)  # 50%, 80%, 100%, 120%

_CURRENT_MONTH_SPEND: float = 0.0
_TRIGGERED_THRESHOLDS: set[float] = set()


class BillingAlertPayload(BaseModel):
    cost_amount: float = Field(..., ge=0.0, description="Current cumulative cost")
    budget_amount: float = Field(default=MONTHLY_SAFETY_BUDGET_RUPEES, ge=0.0)
    currency: str = Field(default="INR")
    alert_name: str = Field(default="Cloud Resource Budget Alert")
    timestamp: str | None = None


def check_and_trigger_billing_alerts(
    current_cost: float,
    budget_limit: float = MONTHLY_SAFETY_BUDGET_RUPEES,
    ip_address: str = "internal",
) -> list[str]:
    """Evaluate current consumption against safety thresholds and emit security alerts."""
    global _CURRENT_MONTH_SPEND
    _CURRENT_MONTH_SPEND = current_cost
    triggered = []

    ratio = current_cost / budget_limit if budget_limit > 0 else 0.0

    for threshold in ALERT_THRESHOLDS:
        if ratio >= threshold and threshold not in _TRIGGERED_THRESHOLDS:
            _TRIGGERED_THRESHOLDS.add(threshold)
            percent = int(threshold * 100)
            severity = "CRITICAL" if threshold >= 1.00 else "WARNING"
            message = (
                f"BUDGET THRESHOLD REACHED: Cloud spend has crossed {percent}% "
                f"({current_cost:,.2f} / {budget_limit:,.2f}). Possible resource exhaustion attack."
            )
            triggered.append(message)
            log_security_event(
                event_type="SECURITY_BILLING_ALERT_TRIGGERED",
                severity=severity,
                ip_address=ip_address,
                details={
                    "current_cost": current_cost,
                    "budget_limit": budget_limit,
                    "ratio": round(ratio, 3),
                    "threshold_percent": percent,
                },
            )
            logger.warning(message)

    return triggered


@router.post(
    "/alerts",
    status_code=status.HTTP_200_OK,
)
async def receive_cloud_billing_webhook(
    request: Request,
    payload: BillingAlertPayload,
) -> dict[str, Any]:
    """Ingest Google Cloud Billing or AWS Budget pub/sub webhook notifications."""
    client_ip = request.client.host if request.client else "unknown"

    # Verify authorization header if configured
    billing_secret = os.getenv("BILLING_WEBHOOK_SECRET")
    if billing_secret:
        auth = request.headers.get("X-Billing-Secret", "")
        if auth != billing_secret:
            log_security_event(
                event_type="SECURITY_BILLING_WEBHOOK_UNAUTHORIZED",
                severity="CRITICAL",
                ip_address=client_ip,
            )
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Unauthorized billing webhook.")

    triggered = check_and_trigger_billing_alerts(
        current_cost=payload.cost_amount,
        budget_limit=payload.budget_amount or MONTHLY_SAFETY_BUDGET_RUPEES,
        ip_address=client_ip,
    )

    return {
        "status": "processed",
        "alerts_triggered": triggered,
        "recorded_cost": payload.cost_amount,
        "recorded_at": datetime.now(timezone.utc).isoformat(),
    }
