# =====================================
# IMPORTS
# =====================================
from websocket_manager import manager
import os
import re
import time
import random
import asyncio
import threading
import logging
import hmac
import hashlib
import bcrypt
import jwt
import firebase_admin
from fastapi.encoders import jsonable_encoder
from pathlib import Path
from datetime import datetime, timezone, timedelta
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from typing import List, Optional, Dict, Any, Literal
from contextlib import asynccontextmanager
import logging
import socketio
import cloudinary
import cloudinary.uploader
import razorpay
import csv
import io
import json
import uuid
import shutil
from fastapi.responses import StreamingResponse
from typing import Dict, Any
from bson import ObjectId
from bson.errors import InvalidId
from pymongo.errors import DuplicateKeyError
from pydantic import BaseModel, EmailStr, Field, validator
from dotenv import load_dotenv
from pymongo import ASCENDING, DESCENDING
from fastapi import (
    FastAPI,
    UploadFile,
    File,
    Form,
    HTTPException,
    status,
    Depends,
    Header,
    Request,
    Query,
    WebSocket, WebSocketDisconnect
)
from utils.file_upload import (
    save_food_image,
    save_category_image,
)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
import smtplib
import ssl
import secrets
import firebase_admin
from firebase_admin import credentials, messaging, auth as firebase_auth
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware
import firebase_config
from models.stall_model import StallData
from database import (
    users_collection,
    orders_collection,
    ratings_collection,
    foods_collection,
    payments_collection,
    refunds_collection,
    counters_collection,
    categories_collection,
    stalls_collection,
    vendor_invitations_collection,
)

load_dotenv()
# ============================================================
# EMAIL / SMTP CONFIGURATION
# ============================================================

SMTP_EMAIL = os.getenv("SMTP_EMAIL")
SMTP_PASSWORD = os.getenv("SMTP_PASSWORD")

SMTP_HOST = "smtp.gmail.com"
SMTP_PORT = 465

print("SMTP Email:", os.getenv("SMTP_EMAIL"))
print(
    "SMTP Password Loaded:",
    bool(os.getenv("SMTP_PASSWORD"))
)
# =====================================
# LOGGING CONFIGURATION
# =====================================
logging.basicConfig(level=logging.INFO)

logger = logging.getLogger(__name__)

# =====================================
# FIREBASE ADMIN INITIALIZATION
# =====================================

if not firebase_admin._apps:
    cred = credentials.Certificate(
        "firebase-service-account.json"
    )

    firebase_admin.initialize_app(cred)

logger.info("🔥 Firebase Admin initialized successfully")

# =====================================
# SEND PUSH NOTIFICATION
# =====================================

def send_push_notification(
    token: str,
    title: str,
    body: str,
):
    try:
        if not token or not token.strip():
            logger.error(
                "❌ FCM notification failed: empty token"
            )
            return False

        token = token.strip()

        message = messaging.Message(
            notification=messaging.Notification(
                title=title,
                body=body,
            ),
            token=token,
        )

        response = messaging.send(message)

        logger.info(
            f"🔔 Notification sent successfully: {response}"
        )

        return True

    except Exception as e:
        logger.error(
            "❌ FCM notification failed | "
            f"type={type(e).__name__} | "
            f"error={e!r}"
        )

        return False
# =====================================
# SEND ORDER STATUS PUSH NOTIFICATION
# =====================================

def send_order_status_push_notification(
    order: Dict[str, Any],
    stall_id: str,
    status_value: str,
) -> None:
    """
    Send a push notification to the customer when
    a vendor changes the status of their stall order.
    """

    try:
        # --------------------------------------------------
        # FIND CUSTOMER EMAIL
        # --------------------------------------------------

        user_email = (
            order.get("email")
            or order.get("user_email")
            or order.get("customer_email")
        )

        if not user_email:
            logger.warning(
                "⚠️ Order notification skipped: "
                "customer email missing."
            )
            return

        normalized_email = normalize_email(
            str(user_email)
        )

        # --------------------------------------------------
        # FIND CUSTOMER
        # --------------------------------------------------

        order_user = users_collection.find_one(
            {
                "email": normalized_email
            }
        )

        if not order_user:
            logger.warning(
                "⚠️ Order notification skipped: "
                f"user not found: {normalized_email}"
            )
            return

        # --------------------------------------------------
        # CHECK NOTIFICATION SETTING
        # --------------------------------------------------

        if order_user.get(
            "notifications",
            True,
        ) is False:
            logger.info(
                f"🔕 Notifications disabled for "
                f"{normalized_email}"
            )
            return

        # --------------------------------------------------
        # GET FCM TOKEN
        # --------------------------------------------------

        fcm_token = str(
            order_user.get("fcm_token")
            or ""
        ).strip()

        if not fcm_token:
            logger.warning(
                f"⚠️ No FCM token for "
                f"{normalized_email}"
            )
            return

        # --------------------------------------------------
        # ORDER NUMBER
        # --------------------------------------------------

        order_token = order.get(
            "token",
            "",
        )

        # --------------------------------------------------
        # STATUS MESSAGE
        # --------------------------------------------------

        status_messages = {
            StallOrderStatus.ACCEPTED:
                f"Your order #{order_token} has been accepted by the vendor.",

            StallOrderStatus.PLACED:
                f"Your order #{order_token} has been placed by the vendor.",

            StallOrderStatus.COOKING:
                f"Your order #{order_token} is now being prepared.",

            StallOrderStatus.READY:
                f"Your order #{order_token} is ready for pickup.",
        }

        body = status_messages.get(
            status_value
        )

        if not body:
            logger.warning(
                f"⚠️ No notification message configured "
                f"for status: {status_value}"
            )
            return

        # --------------------------------------------------
        # SEND FCM
        # --------------------------------------------------

        sent = send_push_notification(
            fcm_token,
            "CampusVita Order Update",
            body,
        )

        if sent:
            logger.info(
                "📲 Order status push sent successfully | "
                f"token={order_token} | "
                f"status={status_value} | "
                f"user={normalized_email}"
            )
        else:
            logger.error(
                "❌ Order status push was NOT sent | "
                f"token={order_token} | "
                f"status={status_value} | "
                f"user={normalized_email}"
            )

    except Exception as e:
        logger.exception(
            "❌ Order status notification exception | "
            f"type={type(e).__name__} | "
            f"error={e!r}"
        )
# =====================================
# LOGGING CONFIGURATION
# =====================================

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)

# =====================================
# ENVIRONMENT VARIABLES VALIDATION
# =====================================

def get_env_or_raise(key: str) -> str:
    value = os.getenv(key)
    if not value:
        raise ValueError(f"Missing required environment variable: {key}")
    return value


RAZORPAY_KEY_ID = get_env_or_raise("RAZORPAY_KEY_ID")
RAZORPAY_KEY_SECRET = get_env_or_raise("RAZORPAY_KEY_SECRET")
RAZORPAY_WEBHOOK_SECRET = get_env_or_raise("RAZORPAY_WEBHOOK_SECRET")
CLOUDINARY_CLOUD_NAME = get_env_or_raise("CLOUDINARY_CLOUD_NAME")
CLOUDINARY_API_KEY = get_env_or_raise("CLOUDINARY_API_KEY")
CLOUDINARY_API_SECRET = get_env_or_raise("CLOUDINARY_API_SECRET")
ALLOWED_ORIGINS = [
    origin.strip()
    for origin in os.getenv(
        "ALLOWED_ORIGINS",
        "http://localhost:3000,http://localhost:3001,http://127.0.0.1:3000,http://127.0.0.1:3001"
    ).split(",")
    if origin.strip()
]
JWT_SECRET = get_env_or_raise("JWT_SECRET")
JWT_ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", 60))
REFRESH_TOKEN_EXPIRE_DAYS = int(os.getenv("REFRESH_TOKEN_EXPIRE_DAYS", 7))
ORDER_INTENT_EXPIRE_MINUTES = int(os.getenv("ORDER_INTENT_EXPIRE_MINUTES", 30))
FCM_TOKEN = os.getenv("FCM_TOKEN", "")
ADMIN_EMAILS = [e.strip().lower() for e in os.getenv("ADMIN_EMAILS", "admin@campusvita.com").split(",")]

# =====================================
# CONSTANTS
# =====================================

class OrderStatus:
    PREPARING = "Preparing"
    COOKING = "Cooking"
    READY_FOR_PICKUP = "Ready For Pickup"
    COMPLETED = "Completed"

    @classmethod
    def all_statuses(cls):
        return [cls.PREPARING, cls.COOKING, cls.READY_FOR_PICKUP, cls.COMPLETED]
class StallOrderStatus:
    PENDING = "Pending"
    ACCEPTED = "Accepted"
    PLACED = "Placed"
    COOKING = "Cooking"
    READY = "Ready For Pickup"
    CANCELLED = "Cancelled"

    @classmethod
    def all_statuses(cls):
        return [
            cls.PENDING,
            cls.ACCEPTED,
            cls.PLACED,
            cls.COOKING,
            cls.READY,
            cls.CANCELLED,
        ]

class PaymentStatus:
    PENDING = "Pending"
    PAID = "Paid"
    FAILED = "Failed"


class RefundStatus:
    """
    Authoritative refund lifecycle.

    PENDING:
        Refund request has been accepted and recorded but has not yet
        been sent to the payment provider / wallet ledger.

    INITIATED:
        The backend has claimed the refund request and started processing it.

    PROCESSING:
        The external payment provider or internal wallet credit is being
        reconciled.

    PROCESSED:
        The refund has been successfully completed.

    FAILED:
        Processing failed and the refund remains available for safe retry
        or reconciliation.
    """

    PENDING = "PENDING"
    INITIATED = "INITIATED"
    PROCESSING = "PROCESSING"
    PROCESSED = "PROCESSED"
    FAILED = "FAILED"

    @classmethod
    def all_statuses(cls):
        return [
            cls.PENDING,
            cls.INITIATED,
            cls.PROCESSING,
            cls.PROCESSED,
            cls.FAILED,
        ]


class UserRole:
    ADMIN = "ADMIN"
    USER = "USER"
    VENDOR = "VENDOR"


ALLOWED_IMAGE_TYPES = [
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/jpg",
    "image/gif",
]

ALLOWED_IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp", ".gif"]
MAX_FILE_SIZE = 5 * 1024 * 1024  # 5MB

# =====================================
# RAZORPAY CONFIG
# =====================================

razorpay_client = razorpay.Client(
    auth=(RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET)
)

# =====================================
# CLOUDINARY CONFIG
# =====================================

cloudinary.config(
    cloud_name=CLOUDINARY_CLOUD_NAME,
    api_key=CLOUDINARY_API_KEY,
    api_secret=CLOUDINARY_API_SECRET,
    secure=True
)

# =====================================
# SOCKET SERVER
# Aligned with the FastAPI CORS policy below instead of a hard-coded "*".
# =====================================

sio = socketio.AsyncServer(
    async_mode="asgi",
    cors_allowed_origins=ALLOWED_ORIGINS
)

@sio.event
async def connect(sid, environ, auth):
    """
    Authenticate Socket.IO clients and join their private customer room.
    The room identity comes from the verified database user,
    never from an email supplied by the client.
    """
    try:
        if not isinstance(auth, dict):
            raise ConnectionRefusedError("Authentication required")

        token = auth.get("token")

        if not isinstance(token, str) or not token.strip():
            raise ConnectionRefusedError("Authentication required")

        payload = verify_token(token.strip())

        if payload.get("type") != "access":
            raise ConnectionRefusedError("Invalid token type")

        email = normalize_email(str(payload.get("email") or ""))

        if not email:
            raise ConnectionRefusedError("Invalid identity")

        user = users_collection.find_one({"email": email})

        if not user or not user.get("is_active", True):
            raise ConnectionRefusedError("Invalid or inactive account")

        database_email = normalize_email(str(user.get("email") or ""))

        if not database_email:
            raise ConnectionRefusedError("Invalid identity")

        await sio.enter_room(sid, f"customer_{database_email}")

        logger.info("Authenticated Socket.IO connection established")

    except Exception:
        logger.warning("Rejected unauthenticated Socket.IO connection")
        raise ConnectionRefusedError("Authentication failed")


# =====================================
# FASTAPI APP
# =====================================

@asynccontextmanager
async def lifespan(app: FastAPI):
    await create_indexes()
    yield


fastapi_app = FastAPI(lifespan=lifespan)

# ============================================================
# PROFILE IMAGE STORAGE
# ============================================================

# Always resolve the upload directory relative to main.py.
# This prevents files from being saved into a different
# "uploads" directory depending on where Uvicorn is started.

BASE_DIR = Path(__file__).resolve().parent

PROFILE_UPLOAD_DIR = (
    BASE_DIR / "uploads" / "profile"
)

PROFILE_UPLOAD_DIR.mkdir(
    parents=True,
    exist_ok=True
)

logger.info(
    f"📁 Profile image directory: {PROFILE_UPLOAD_DIR}"
)

# =====================================
# CORS
# =====================================

fastapi_app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# =====================================
# RATE LIMITING
# Applied a sane global default, plus stricter per-route limits on the
# endpoints that are cheapest to abuse: login/signup (credential stuffing,
# account enumeration) and payment-order creation (hitting Razorpay's API).
# =====================================

limiter = Limiter(key_func=get_remote_address, default_limits=["200/minute"])
fastapi_app.state.limiter = limiter
fastapi_app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
fastapi_app.add_middleware(SlowAPIMiddleware)

# =====================================
# SECURITY
# =====================================

# Required auth (raises 401/403 automatically if header missing/invalid)
security = HTTPBearer()

# Optional auth (auto_error=False) — a separate instance is required so
# get_current_user_optional actually runs when no Authorization header is
# sent. Reusing `security` (auto_error=True) would make FastAPI raise the
# 403 itself before the function body ever executes.
optional_security = HTTPBearer(auto_error=False)


# =====================================
# JWT HELPER FUNCTIONS
# =====================================

def create_access_token(data: Dict[str, Any], expires_delta: Optional[timedelta] = None) -> str:
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({"exp": expire, "type": "access"})
    encoded_jwt = jwt.encode(to_encode, JWT_SECRET, algorithm=JWT_ALGORITHM)
    return encoded_jwt


def create_refresh_token(data: Dict[str, Any]) -> str:
    to_encode = data.copy()
    expire = datetime.utcnow() + timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS)
    to_encode.update({"exp": expire, "type": "refresh"})
    encoded_jwt = jwt.encode(to_encode, JWT_SECRET, algorithm=JWT_ALGORITHM)
    return encoded_jwt


def verify_token(token: str):
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        return payload

    except Exception as e:
        logger.warning("Token verification failed: %s", type(e).__name__)
        raise HTTPException(
            status_code=401,
            detail="Invalid or expired token",
        )
def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security),
):
    try:
        token = credentials.credentials

        # ============================================================
        # 1. VERIFY ACCESS TOKEN
        # ============================================================

        payload = verify_token(token)

        if payload.get("type") != "access":
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid token type",
            )

        # ============================================================
        # 2. GET EMAIL FROM TOKEN
        # ============================================================

        email = normalize_email(
            payload.get("email", "")
        )

        if not email:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid token: email missing",
            )

        # ============================================================
        # 3. FIND CURRENT USER IN DATABASE
        # ============================================================

        user = users_collection.find_one(
            {"email": email}
        )

        if not user:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="User not found",
            )

        # ============================================================
        # 4. CHECK ACCOUNT STATUS
        # ============================================================

        if not user.get("is_active", True):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Account is deactivated",
            )

        # ============================================================
        # 5. RETURN CURRENT DATABASE USER
        # ============================================================

        current_user = {
            "id": str(user.get("_id")),
            "email": user.get("email"),
            "name": user.get("name", ""),
            "role": user.get(
                "role",
                UserRole.USER
            ),
            "phone": user.get("phone", ""),
            
            "profile_image": user.get(
                "profile_image",
                ""
            ),
            "is_active": user.get(
                "is_active",
                True
            ),
        }

        return current_user

    except HTTPException:
        raise

    except Exception as e:
        logger.error(
            f"Authentication error: {e}"
        )

        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication failed",
        )

def get_current_user_optional(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(optional_security),
) -> Optional[Dict[str, Any]]:
    if credentials is None:
        return None
    try:
        return get_current_user(credentials)
    except HTTPException:
        return None


def require_role(required_role: str):
    def role_checker(
        current_user: Dict[str, Any] = Depends(
            get_current_user
        )
    ):
        current_role = str(
            current_user.get("role", "")
        ).upper()

        if current_role != required_role.upper():
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=(
                    f"Access denied. "
                    f"{required_role} role required."
                ),
            )

        return current_user

    return role_checker


def get_vendor_stall_ids(current_user: Dict[str, Any]) -> List[str]:
    """Return active stall IDs owned by the authenticated vendor."""
    if str(current_user.get("role", "")).upper() != UserRole.VENDOR:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="VENDOR role required.",
        )

    email = normalize_email(str(current_user.get("email", "")))

    if not email:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Vendor email is missing.",
        )

    stalls = stalls_collection.find(
        {
            "owner_email": email,
            "active": True,
        },
        {"_id": 1},
    )

    return [str(stall["_id"]) for stall in stalls]

def money_to_paise(value: Any) -> int:
    """
    Convert a trusted monetary value to integer paise using Decimal.

    Refund calculations must use integer paise to avoid floating-point
    rounding errors. Values are rounded to the nearest paise using
    standard half-up rounding.
    """
    try:
        if isinstance(value, bool):
            raise InvalidOperation

        amount = Decimal(str(value)).quantize(
            Decimal("0.01"),
            rounding=ROUND_HALF_UP,
        )
    except (InvalidOperation, ValueError, TypeError):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid monetary amount.",
        )

    if amount <= 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Monetary amount must be greater than zero.",
        )

    paise = int(amount * 100)

    if paise <= 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Monetary amount is invalid.",
        )

    return paise


def validate_refund_idempotency_key(value: str) -> str:
    """
    Validate and normalize a client-supplied refund idempotency key.

    The key is used only for deduplicating the same refund request.
    It must be deterministic, bounded, and safe to use as a MongoDB
    identifier and Razorpay idempotency header value.
    """
    key = str(value or "").strip()

    if not 10 <= len(key) <= 128:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid refund idempotency key.",
        )

    if not re.fullmatch(r"[A-Za-z0-9_-]+", key):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid refund idempotency key.",
        )

    return key



def _refund_payment_for_order(order: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """
    Return the authoritative food-order payment record.

    The caller never supplies a payment ID. The payment is resolved from
    the trusted order identifier stored in MongoDB.
    """
    order_id = order.get("_id")
    if not order_id:
        return None

    payment = payments_collection.find_one({
        "order_id": str(order_id),
        "purpose": "food_order",
        "status": PaymentStatus.PAID,
    })

    if payment:
        return payment

    # Legacy-compatible fallback for records where purpose was not stored.
    payment = payments_collection.find_one({
        "order_id": str(order_id),
        "status": PaymentStatus.PAID,
    })

    return payment


def _refund_payment_method(order: Dict[str, Any],
                            payment: Dict[str, Any]) -> str:
    """
    Resolve the payment method from trusted persisted state.
    """
    method = str(
        payment.get("payment_method")
        or order.get("payment_method")
        or ""
    ).strip().upper()

    if method not in {"ONLINE", "WALLET"}:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This order does not use a supported refundable payment method.",
        )

    return method


def _order_total_paise(order: Dict[str, Any],
                       payment: Dict[str, Any]) -> int:
    """
    Resolve the original charged amount from the persisted payment record.

    Payment amount is preferred because it represents the amount actually
    recorded as paid. The order snapshot is used only as a compatibility
    fallback for older records.
    """
    payment_amount = payment.get("amount")

    if payment_amount is not None:
        return money_to_paise(payment_amount)

    order_amount = order.get("payment_amount", order.get("total"))

    if order_amount is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Refund cannot be calculated because the original payment amount is unavailable.",
        )

    return money_to_paise(order_amount)


def _refund_item_paise(item: Dict[str, Any]) -> int:
    """
    Calculate one item's refundable line amount from the immutable order
    item snapshot, never from the current food catalogue price.
    """
    if not isinstance(item, dict):
        return 0

    price = item.get("price")
    quantity = item.get("quantity")

    if price is None or quantity is None:
        return 0

    try:
        quantity = int(quantity)
    except (TypeError, ValueError):
        return 0

    if quantity <= 0:
        return 0

    return money_to_paise(price) * quantity


def _existing_refund_paise(order_id: str) -> int:
    """
    Sum all refund amounts already reserved for the order.

    FAILED refunds are excluded because their funds were not completed.
    All other refund lifecycle states reserve the corresponding amount
    against the order to prevent concurrent over-refunding.
    """
    pipeline = [
        {
            "$match": {
                "order_id": str(order_id),
                "status": {
                    "$in": [
                        RefundStatus.PENDING,
                        RefundStatus.INITIATED,
                        RefundStatus.PROCESSING,
                        RefundStatus.PROCESSED,
                    ]
                },
            }
        },
        {
            "$group": {
                "_id": None,
                "total": {"$sum": "$amount_paise"},
            }
        },
    ]

    result = list(refunds_collection.aggregate(pipeline))

    if not result:
        return 0

    return int(result[0].get("total") or 0)


def _existing_refunded_item_indexes(order_id: str) -> set[int]:
    """
    Return item indexes already reserved by non-failed partial refunds.

    This prevents the same cancelled line item from being refunded twice
    through different idempotency keys.
    """
    cursor = refunds_collection.find(
        {
            "order_id": str(order_id),
            "status": {
                "$in": [
                    RefundStatus.PENDING,
                    RefundStatus.INITIATED,
                    RefundStatus.PROCESSING,
                    RefundStatus.PROCESSED,
                ]
            },
            "refund_scope": {
                "$in": ["ITEM", "STALL"],
            },
            "item_indexes": {
                "$exists": True,
                "$ne": [],
            },
        },
        {
            "item_indexes": 1,
        },
    )

    indexes: set[int] = set()

    for refund in cursor:
        for value in refund.get("item_indexes", []):
            try:
                indexes.add(int(value))
            except (TypeError, ValueError):
                continue

    return indexes


def _cancelled_refund_items(order: Dict[str, Any]) -> List[Dict[str, Any]]:
    """
    Return cancelled item snapshots that have not already been assigned
    to a completed/reserved refund.
    """
    items = []

    for index, item in enumerate(order.get("items", [])):
        if not isinstance(item, dict):
            continue

        if not bool(item.get("cancelled")):
            continue

        items.append({
            "index": index,
            "name": item.get("name", ""),
            "quantity": int(item.get("quantity", 0) or 0),
            "price": item.get("price"),
            "stall_id": str(item.get("stall_id") or "").strip(),
            "amount_paise": _refund_item_paise(item),
        })

    return items


def _refund_target_items(order: Dict[str, Any],
                         stall_id: Optional[str] = None,
                         item_index: Optional[int] = None
                         ) -> List[Dict[str, Any]]:
    """
    Determine the exact cancelled item scope.

    A customer can request a whole order or a cancelled stall subset.
    A vendor can request only its authenticated stall.

    No client-supplied monetary value participates in this calculation.
    """
    cancelled = _cancelled_refund_items(order)

    if item_index is not None:
        return [
            item for item in cancelled
            if item["index"] == item_index
            and (
                not stall_id
                or item["stall_id"] == str(stall_id).strip()
            )
        ]

    if stall_id:
        requested_stall_id = str(stall_id).strip()
        return [
            item for item in cancelled
            if item["stall_id"] == requested_stall_id
        ]

    return cancelled


def calculate_refund_amount_paise(
    order: Dict[str, Any],
    payment: Dict[str, Any],
    *,
    stall_id: Optional[str] = None,
    item_index: Optional[int] = None,
    full_order: bool = False,
) -> Dict[str, Any]:
    """
    Calculate an authoritative refund from persisted order/payment data.

    Full-order cancellation refunds the original charged amount.

    Partial refunds refund only the cancelled item line totals. Shared
    delivery fees are intentionally not refunded for partial cancellation
    because the current billing schema does not contain a deterministic
    per-stall fee allocation.

    Existing reserved refunds are always subtracted before a new refund
    can be accepted.
    """
    order_id = str(order.get("_id") or "").strip()

    if not order_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid order.",
        )

    original_paise = _order_total_paise(order, payment)
    already_refunded_paise = _existing_refund_paise(order_id)

    if already_refunded_paise > original_paise:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Refund ledger exceeds the original payment amount.",
        )

    if full_order:
        # A full-order refund means refund the remaining refundable
        # balance, not the original amount a second time.
        requested_paise = original_paise - already_refunded_paise
        refund_scope = "FULL_ORDER"
        target_items = []
    else:
        target_items = _refund_target_items(
            order,
            stall_id=stall_id,
            item_index=item_index,
        )

        already_refunded_indexes = _existing_refunded_item_indexes(
            order_id
        )

        target_items = [
            item for item in target_items
            if item["index"] not in already_refunded_indexes
        ]

        if not target_items:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="No eligible cancelled items are available for refund.",
            )

        requested_paise = sum(
            int(item["amount_paise"])
            for item in target_items
        )
        refund_scope = "ITEM" if item_index is not None else "STALL"

    if requested_paise <= 0:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="No refundable amount is available.",
        )

    remaining_paise = original_paise - already_refunded_paise

    if requested_paise > remaining_paise:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Requested refund exceeds the remaining refundable amount.",
        )

    return {
        "order_id": order_id,
        "payment_id": payment.get("payment_id"),
        "payment_method": _refund_payment_method(order, payment),
        "original_amount_paise": original_paise,
        "already_refunded_paise": already_refunded_paise,
        "amount_paise": requested_paise,
        "refund_scope": refund_scope,
        "stall_id": str(stall_id).strip() if stall_id else None,
        "item_index": item_index,
        "item_indexes": [
            int(item["index"])
            for item in target_items
        ],
        "items": target_items,
    }


def ensure_refund_eligible_order(
    order: Dict[str, Any],
    payment: Dict[str, Any],
) -> None:
    """
    Validate the minimum trusted conditions required before a refund.

    The cancellation state itself is checked from persisted order data.
    """
    if not order:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Order not found.",
        )

    if not payment:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="No successful payment was found for this order.",
        )

    if payment.get("status") != PaymentStatus.PAID:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Only successfully paid orders can be refunded.",
        )

    if str(payment.get("purpose", "food_order")) != "food_order":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This payment is not a food order payment.",
        )


def get_stall_preparation_minutes(stall_id: str) -> int:
    """Get preparation time configured for a stall."""
    try:
        stall = stalls_collection.find_one(
            {"_id": ObjectId(stall_id)},
            {"preparation_time": 1},
        )
    except Exception:
        return 15

    if not stall:
        return 15

    try:
        minutes = int(stall.get("preparation_time") or 15)
        return max(1, minutes)
    except (TypeError, ValueError):
        return 15


def get_order_stall_ids(order: Dict[str, Any]) -> List[str]:
    """Return unique stall IDs represented by the order items."""
    stall_ids = []

    for item in order.get("items", []):
        stall_id = str(item.get("stall_id") or "").strip()
        if stall_id and stall_id not in stall_ids:
            stall_ids.append(stall_id)

    return stall_ids


def build_stall_orders(order: Dict[str, Any]) -> List[Dict[str, Any]]:
    """
    Build independent stall-level order state for an order.

    Existing orders without stall-level state are represented safely
    without modifying the database.
    """
    existing = {
        str(entry.get("stall_id")): entry
        for entry in order.get("stall_orders", [])
        if entry.get("stall_id")
    }

    stall_orders = []

    for stall_id in get_order_stall_ids(order):
        previous = existing.get(stall_id, {})

        stall_orders.append({
    "stall_id": stall_id,
    "status": previous.get(
        "status",
        StallOrderStatus.PENDING,
    ),
    "estimatedPreparationMinutes": int(
        previous.get(
            "estimatedPreparationMinutes",
            get_stall_preparation_minutes(stall_id),
        )
    ),
    "cookingStartedAt": previous.get("cookingStartedAt"),
    "readyAt": previous.get("readyAt"),
    "cancelled": bool(previous.get("cancelled", False)),
    "cancelledAt": previous.get("cancelledAt"),
    "cancellationReason": previous.get("cancellationReason"),
})

    return stall_orders
# =====================================
# SIGNED "ORDER INTENT" HELPERS
# Used to carry server-computed prices/amounts from order-creation time to
# payment-verification time without trusting whatever the client resends.
# Kept separate from access/refresh JWTs (different purpose, shorter TTL,
# 400s instead of 401s since a bad intent isn't an auth failure).
# =====================================

def create_signed_intent(intent_type: str, payload: Dict[str, Any], expires_minutes: int = ORDER_INTENT_EXPIRE_MINUTES) -> str:
    to_encode = payload.copy()
    to_encode["type"] = intent_type
    to_encode["exp"] = datetime.utcnow() + timedelta(minutes=expires_minutes)
    return jwt.encode(to_encode, JWT_SECRET, algorithm=JWT_ALGORITHM)


def decode_signed_intent(token: str, expected_type: str) -> Dict[str, Any]:
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except jwt.ExpiredSignatureError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This order has expired, please try again",
        )
    except jwt.InvalidTokenError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid order reference",
        )

    if payload.get("type") != expected_type:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid order reference type",
        )

    return payload


# =====================================
# DATABASE INDEXES
# =====================================
LEGACY_PAYMENT_DATE_FORMAT = "%d %b %Y, %I:%M %p"


def parse_legacy_payment_date(value):
    if isinstance(value, datetime):
        return value

    if not isinstance(value, str):
        return None

    try:
        return datetime.strptime(
            value.strip(),
            LEGACY_PAYMENT_DATE_FORMAT
        )
    except (ValueError, TypeError):
        return None


def migrate_payment_schema():
    """
    Converts existing payment date strings into MongoDB datetime values.

    This migration NEVER invents a date.
    If a legacy date cannot be parsed, it is left untouched and logged.
    """
    migrated = 0
    skipped = 0

    cursor = payments_collection.find({})

    for payment in cursor:
        updates = {}

        # -----------------------------------------
        # DATE MIGRATION
        # -----------------------------------------
        if not isinstance(payment.get("payment_date"), datetime):
            parsed_date = parse_legacy_payment_date(
                payment.get("date")
            )

            if parsed_date:
                updates["payment_date"] = parsed_date
            elif payment.get("date") is not None:
                logger.warning(
                    "Could not parse payment date for payment_id=%s",
                    payment.get("payment_id")
                )
                skipped += 1

        # -----------------------------------------
        # USER EMAIL NORMALIZATION
        # -----------------------------------------
        email = payment.get("user_email") or payment.get("email")

        if email:
            normalized = normalize_email(email)

            if payment.get("email") != normalized:
                updates["email"] = normalized

            if payment.get("user_email") != normalized:
                updates["user_email"] = normalized

        # -----------------------------------------
        # EXISTING WALLET TOP-UP RECORDS
        # -----------------------------------------
        if payment.get("purpose") == "wallet_topup":
            if not payment.get("payment_method"):
                updates["payment_method"] = "WALLET"

        if updates:
            payments_collection.update_one(
                {"_id": payment["_id"]},
                {"$set": updates}
            )

            migrated += 1

    logger.info(
        "Payment schema migration completed: migrated=%s skipped=%s",
        migrated,
        skipped
    )

async def create_indexes():
    try:
        # Create the required vendor invitation uniqueness index
        # independently so a failure in another collection's indexes
        # cannot prevent vendor IDs from being protected against duplicates.
        try:
            vendor_invitations_collection.create_index(
                "vendor_id",
                unique=True,
            )
            vendor_invitations_collection.create_index("email")
        except Exception as e:
            logger.warning("Vendor invitation index warning: %s", e)

        # ============================================================
        # USERS
        # ============================================================

        users_collection.create_index(
            "email",
            unique=True
        )

        users_collection.create_index(
            "phone",
            unique=True
        )
        logger.info(
            "✅ Users collection indexes created"
        )

        # ============================================================
        # ORDERS
        # ============================================================

        orders_collection.create_index(
            "token",
            unique=True
        )
        # A Razorpay order can result in at most one CampusVita order.
        # Sparse keeps wallet and legacy orders (which have no value)
        # outside the uniqueness constraint.
        orders_collection.create_index(
            "razorpay_order_id",
            unique=True,
            sparse=True,
        )

        logger.info(
            "✅ Orders collection index created"
        )

        # ============================================================
        # PAYMENTS
        # ============================================================

        payments_collection.create_index(
            "payment_id",
            unique=True
        )
        payments_collection.create_index(
            "razorpay_order_id",
            unique=True,
            sparse=True,
        )
        payments_collection.create_index("order_id")
        payments_collection.create_index("user_email")
        payments_collection.create_index("status")
        payments_collection.create_index("payment_method")
        payments_collection.create_index("date")
        logger.info(
            "✅ Payments collection index created"
        )

        # ============================================================
        # REFUNDS
        # ============================================================

        refunds_collection.create_index(
            "idempotency_key",
            unique=True
        )
        refunds_collection.create_index("order_id")
        refunds_collection.create_index("payment_id")
        refunds_collection.create_index("razorpay_refund_id", sparse=True)
        refunds_collection.create_index("user_email")
        refunds_collection.create_index("status")

        logger.info(
            "✅ Refunds collection indexes created"
        )

        # ============================================================
        # COUNTERS
        # ============================================================

        counters_collection.create_index(
            "_id",
            unique=True
        )

        logger.info(
            "✅ Counters collection index created"
        )

    except Exception as e:
        logger.warning(
            f"⚠️ Index creation warning: {e}"
        )


# =====================================
# COUNTER HELPER
# =====================================

def get_next_token() -> int:
    result = counters_collection.find_one_and_update(
        {"_id": "order_token"},
        {"$inc": {"value": 1}},
        upsert=True,
        return_document=True
    )
    return result["value"]


# =====================================
# OBJECT ID HELPER
# =====================================

def parse_object_id(order_id: str) -> ObjectId:
    """Raises a clean 400 instead of letting InvalidId fall through to a 500."""
    try:
        return ObjectId(order_id)
    except (InvalidId, TypeError):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid order id",
        )


# =====================================
# PASSWORD HELPER FUNCTIONS
# =====================================

def hash_password(password: str) -> str:
    salt = bcrypt.gensalt(rounds=int(os.getenv("BCRYPT_ROUNDS", 12)))
    return bcrypt.hashpw(password.encode("utf-8"), salt).decode("utf-8")


def is_password_hashed(password: str) -> bool:
    return password.startswith(("$2a$", "$2b$", "$2y$"))


def verify_password(plain_password: str, hashed_password: str) -> bool:
    return bcrypt.checkpw(
        plain_password.encode("utf-8"),
        hashed_password.encode("utf-8")
    )


def validate_password_strength(password: str) -> bool:
    if len(password) < 8:
        return False
    if not re.search(r"[A-Z]", password):
        return False
    if not re.search(r"[a-z]", password):
        return False
    if not re.search(r"\d", password):
        return False
    if not re.search(r"[!@#$%^&*(),.?\":{}|<>]", password):
        return False
    return True


def normalize_email(email: str) -> str:
    """Emails are case-insensitive; without this, Test@x.com and test@x.com
    could end up as effectively-duplicate accounts depending on insert order."""
    return email.strip().lower()

# ============================================================
# PASSWORD RESET OTP CONFIGURATION
# ============================================================

RESET_OTP_EXPIRE_MINUTES = 10


# ============================================================
# GENERATE SECURE OTP
# ============================================================

def generate_reset_otp() -> str:
    """
    Generate a cryptographically secure 6-digit OTP.
    """

    return f"{secrets.randbelow(900000) + 100000}"


# ============================================================
# HASH OTP
# ============================================================

def hash_reset_otp(otp: str) -> str:
    """
    Hash the OTP before storing it in MongoDB.

    Never store the raw OTP in the database.
    """

    return hashlib.sha256(
        otp.encode("utf-8")
    ).hexdigest()


# ============================================================
# SEND PASSWORD RESET OTP EMAIL
# ============================================================

def send_password_reset_email(
    recipient_email: str,
    otp: str,
) -> None:

    if not SMTP_EMAIL or not SMTP_PASSWORD:
        raise RuntimeError(
            "SMTP_EMAIL or SMTP_PASSWORD is not configured"
        )

    # --------------------------------------------------------
    # EMAIL MESSAGE
    # --------------------------------------------------------

    message = MIMEMultipart("alternative")

    message["Subject"] = (
        "CampusVita Password Reset OTP"
    )

    message["From"] = SMTP_EMAIL
    message["To"] = recipient_email

    # --------------------------------------------------------
    # EMAIL HTML
    # --------------------------------------------------------

    html_content = f"""
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="UTF-8">
    </head>

    <body style="
        margin: 0;
        padding: 0;
        background-color: #f5f5f5;
        font-family: Arial, sans-serif;
    ">

        <div style="
            max-width: 600px;
            margin: 40px auto;
            background: #ffffff;
            border-radius: 20px;
            overflow: hidden;
            box-shadow: 0 10px 30px rgba(0,0,0,0.1);
        ">

            <!-- HEADER -->

            <div style="
                background: linear-gradient(
                    135deg,
                    #ea580c,
                    #dc2626
                );
                padding: 35px;
                text-align: center;
            ">

                <h1 style="
                    margin: 0;
                    color: white;
                    font-size: 32px;
                ">
                    Campus<span style="color:#fed7aa">Vita</span>
                </h1>

                <p style="
                    color: white;
                    margin-top: 10px;
                    opacity: 0.9;
                ">
                    Password Reset Request
                </p>

            </div>


            <!-- CONTENT -->

            <div style="
                padding: 40px;
                text-align: center;
            ">

                <h2 style="
                    color: #18181b;
                ">
                    Reset Your Password
                </h2>

                <p style="
                    color: #52525b;
                    font-size: 16px;
                    line-height: 1.6;
                ">
                    We received a request to reset your
                    CampusVita password.
                </p>

                <p style="
                    color: #52525b;
                ">
                    Use the OTP below to continue:
                </p>


                <!-- OTP -->

                <div style="
                    margin: 30px auto;
                    padding: 20px;
                    max-width: 300px;
                    background: #fff7ed;
                    border: 2px dashed #ea580c;
                    border-radius: 16px;
                ">

                    <div style="
                        color: #ea580c;
                        font-size: 36px;
                        font-weight: bold;
                        letter-spacing: 8px;
                    ">
                        {otp}
                    </div>

                </div>


                <p style="
                    color: #71717a;
                    font-size: 14px;
                ">
                    This OTP will expire in
                    <strong>{RESET_OTP_EXPIRE_MINUTES} minutes</strong>.
                </p>

                <p style="
                    color: #71717a;
                    font-size: 14px;
                ">
                    If you did not request a password reset,
                    you can safely ignore this email.
                </p>

            </div>


            <!-- FOOTER -->

            <div style="
                padding: 20px;
                background: #fafafa;
                text-align: center;
                color: #a1a1aa;
                font-size: 12px;
            ">

                © CampusVita

            </div>

        </div>

    </body>
    </html>
    """

    # --------------------------------------------------------
    # ATTACH HTML
    # --------------------------------------------------------

    message.attach(
        MIMEText(
            html_content,
            "html",
        )
    )

    # --------------------------------------------------------
    # SEND EMAIL USING GMAIL SMTP
    # --------------------------------------------------------

    context = ssl.create_default_context()

    with smtplib.SMTP_SSL(
        SMTP_HOST,
        SMTP_PORT,
        context=context,
    ) as server:

        server.login(
            SMTP_EMAIL,
            SMTP_PASSWORD,
        )

        server.sendmail(
            SMTP_EMAIL,
            recipient_email,
            message.as_string(),
        )

    logger.info(
        f"📧 Password reset OTP sent to: {recipient_email}"
    )
# =====================================
# REFRESH TOKEN HASHING
# Refresh tokens are stored hashed (never in plaintext), same principle as
# passwords. bcrypt is intentionally NOT used here: bcrypt truncates its
# input at 72 bytes, and a JWT's only variable content (the timestamp) sits
# in the middle of the string — so two different valid tokens for the same
# user can share an identical first-72-byte prefix and hash the same way,
# which would let an old, already-rotated-out token still verify. Refresh
# tokens are long, high-entropy values (unlike passwords), so a fast,
# deterministic hash compared in constant time is the correct tool.
# =====================================

def hash_refresh_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def refresh_token_matches(token: str, token_hash: Optional[str]) -> bool:
    if not token_hash:
        return False
    return hmac.compare_digest(hash_refresh_token(token), token_hash)


# =====================================
# SOCKET HELPER
# =====================================

def make_json_safe(value):
    if isinstance(value, ObjectId):
        return str(value)

    if isinstance(value, datetime):
        return value.isoformat()

    if isinstance(value, dict):
        return {
            key: make_json_safe(item)
            for key, item in value.items()
        }

    if isinstance(value, list):
        return [
            make_json_safe(item)
            for item in value
        ]

    return value



async def safe_emit_order_update(order_data):
    """Send a minimal order update to the owning customer only."""
    customer_email = normalize_email(
        str(
            order_data.get("email")
            or order_data.get("user_email")
            or ""
        )
    )

    if not customer_email:
        logger.warning(
            "Skipping order socket update: missing customer email"
        )
        return

    safe_order = make_json_safe({
        "token": order_data.get("token"),
        "status": order_data.get("status"),
        "stall_orders": [
            {
                "stall_id": entry.get("stall_id"),
                "status": entry.get("status"),
                "picked_up": entry.get("picked_up", False),
            }
            for entry in order_data.get("stall_orders", [])
        ],
        "updated_at": datetime.now(timezone.utc).isoformat(),
    })

    await sio.emit(
        "order_update",
        safe_order,
        room=f"customer_{customer_email}",
    )


def emit_order_update_sync(order_data):
    """
    Legacy synchronous order-flow callback.

    Do not broadcast order data globally. Real-time delivery
    from this synchronous context needs a dedicated event-loop
    bridge or message queue.
    """
    logger.debug(
        "Skipped legacy synchronous socket emission; "
        "clients should use authenticated polling fallback."
    )



# =====================================
# MODELS
# =====================================

class SignupData(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    email: EmailStr
    password: str = Field(min_length=8)
    phone: str = Field(min_length=10, max_length=10)

    @validator("phone")
    def validate_phone(cls, v):
        v = v.strip()

        if not v:
            raise ValueError(
                "Phone number is required"
            )

        if not v.isdigit():
            raise ValueError(
                "Phone number must contain only digits"
            )

        if len(v) != 10:
            raise ValueError(
                "Phone number must be exactly 10 digits"
            )

        if v[0] not in "6789":
            raise ValueError(
                "Please enter a valid Indian mobile number"
            )

        return v

    @validator("password")
    def validate_password(cls, v):
        if not validate_password_strength(v):
            raise ValueError(
                "Password must contain at least 8 characters, "
                "one uppercase, one lowercase, one number, and one special character"
            )
        return v
# ============================================================
# FORGOT PASSWORD MODELS
# ============================================================

class ForgotPasswordData(BaseModel):
    email: str


class VerifyResetOTPData(BaseModel):
    email: str
    otp: str


class ResetPasswordData(BaseModel):
    email: EmailStr
    new_password: str

class LoginData(BaseModel):
    email: EmailStr
    password: str
    login_mode: Literal["USER", "ADMIN", "VENDOR"]

class ForgotPasswordData(BaseModel):
    email: str

class RefreshTokenData(BaseModel):
    refresh_token: str

class FCMTokenData(BaseModel):
    # The authenticated user determines ownership.  Never accept an
    # account identifier from the browser for device-token registration.
    fcm_token: str = Field(min_length=1, max_length=4096)


class VendorInvitationData(BaseModel):
    business_name: str = Field(min_length=1, max_length=150)
    owner_name: str = Field(min_length=1, max_length=100)
    email: EmailStr
    phone: str = Field(min_length=10, max_length=10)
    stall_ids: List[str] = []

    @validator("business_name", "owner_name")
    def vendor_invitation_name(cls, value):
        value = value.strip()
        if not value:
            raise ValueError("This field is required")
        return value

    @validator("phone")
    def vendor_invitation_phone(cls, value):
        value = value.strip()
        if not value.isdigit() or len(value) != 10 or value[0] not in "6789":
            raise ValueError("Please enter a valid Indian mobile number")
        return value

    @validator("stall_ids")
    def vendor_invitation_stalls(cls, values):
        cleaned = []
        for stall_id in values:
            stall_id = str(stall_id).strip()
            if not ObjectId.is_valid(stall_id):
                raise ValueError("Invalid stall id")
            if stall_id not in cleaned:
                cleaned.append(stall_id)
        return cleaned


class VendorActivateVerifyData(BaseModel):
    vendor_id: str = Field(min_length=1, max_length=64)
    activation_code: str = Field(min_length=1, max_length=64)


class VendorActivateData(VendorActivateVerifyData):
    password: str = Field(min_length=8)

    @validator("password")
    def vendor_activation_password(cls, value):
        if not validate_password_strength(value):
            raise ValueError(
                "Password must contain at least 8 characters, one uppercase, "
                "one lowercase, one number, and one special character"
            )
        return value

class ChangePasswordData(BaseModel):
    current_password: str
    new_password: str = Field(min_length=8)

    @validator("new_password")
    def validate_new_password(cls, v):
        if not validate_password_strength(v):
            raise ValueError(
                "Password must contain at least 8 characters, "
                "one uppercase, one lowercase, one number, and one special character"
            )
        return v


class OrderItemRequest(BaseModel):
    """Client identifies the food and its stall.
    Price is never accepted from the client."""
    name: str = Field(min_length=1)
    quantity: int = Field(gt=0)
    stall_id: str = Field(min_length=1)

class OrderData(BaseModel):
    items: List[OrderItemRequest] = Field(min_length=1)


class CreateFoodOrderData(BaseModel):
    items: List[OrderItemRequest] = Field(min_length=1)
    name: str
    phone: str


class VerifyPaymentData(BaseModel):
    razorpay_payment_id: str
    razorpay_order_id: str
    razorpay_signature: str
    order_intent: str

class RefundRequestData(BaseModel):
    """
    Customer refund request.

    The client may provide only the reason.
    The backend determines the order, payment, eligibility, stall,
    affected items, and refund amount from trusted database state.
    """

    reason: str = Field(
        default="Customer requested cancellation",
        min_length=1,
        max_length=500,
    )



class VendorRefundRequestData(BaseModel):
    """
    Vendor cancellation/refund request.

    The vendor supplies only the reason and idempotency key.
    Stall ownership and the refundable amount are derived entirely
    from authenticated vendor identity and database order data.
    """

    reason: str = Field(
        default="Cancelled by vendor",
        min_length=1,
        max_length=500,
    )

    idempotency_key: str = Field(
        min_length=10,
        max_length=128,
    )

class RatingData(BaseModel):
    food_name: str
    rating: int = Field(ge=1, le=5)
    feedback: str = Field(max_length=500)

class StallRatingData(BaseModel):
    stall_id: str = Field(min_length=1, max_length=100)
    rating: int = Field(ge=1, le=5)
    feedback: str = Field(default="", max_length=500)

class FoodData(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    description: str = Field(default="")
    price: float = Field(gt=0)
    category: str = Field(min_length=1)
    category_id: str = Field(min_length=1)
    stall_id: str = Field(min_length=1)
    image: str
    available: bool = True
    is_veg: bool | None = None


class ProfileData(BaseModel):
    name: str
    phone: str
    profile_image: str

    notifications: bool
    theme: str

    favorite_foods: list = []

    total_orders: int = 0
    total_spent: float = 0
    wallet: float = 0

    # New persistent pickup/delivery location.
    # Optional so existing profile requests do not break.
    location: Optional[str] = None


class WalletTopupData(BaseModel):
    amount: float = Field(gt=0)


class VerifyWalletTopupData(BaseModel):
    razorpay_payment_id: str
    razorpay_order_id: str
    razorpay_signature: str
    order_intent: str


class AdminWalletAdjustData(BaseModel):
    """Manual wallet credit/debit by an admin only (e.g. refunds, goodwill
    credits). Regular users can only move money via a verified Razorpay
    payment (wallet top-up) or by spending on an order."""
    email: EmailStr
    amount: float = Field(gt=0)
    type: str
    reason: str = Field(min_length=1)

    @validator("type")
    def validate_type(cls, v):
        if v not in ("credit", "debit"):
            raise ValueError("type must be 'credit' or 'debit'")
        return v


class SavePaymentData(BaseModel):
    order_id: str
    payment_id: str
    amount: float = Field(gt=0)
    status: str


class StatusUpdate(BaseModel):
    status: str

    @validator("status")
    def validate_status(cls, v):
        if v not in OrderStatus.all_statuses():
            raise ValueError(f"Invalid status. Must be one of: {OrderStatus.all_statuses()}")
        return v
    
class VendorCancellationRequest(BaseModel):
    reason: str = "Cancelled by vendor"


class VendorStallStatusUpdate(BaseModel):
    status: str

    @validator("status")
    def validate_status(cls, value):
        if value not in StallOrderStatus.all_statuses():
            raise ValueError(
                f"Invalid stall order status. "
                f"Must be one of: {StallOrderStatus.all_statuses()}"
            )
        return value

@fastapi_app.post("/vendor/orders/{token}/cancel")
async def cancel_vendor_complete_order(
    token: str,
    stall_id: str = Query(...),
    current_user: dict = Depends(get_current_user),
):
    """
    Cancel only the selected stall's portion of a multi-stall order.

    Important:
    - Items belonging to other stalls are NOT cancelled.
    - The selected stall order is marked CANCELLED.
    - The global order is cancelled only when no active items remain.
    - A WebSocket update is emitted after the change.
    """

    # ---------------------------------------------------------
    # 1. Verify vendor/admin authentication
    # ---------------------------------------------------------
    role = str(current_user.get("role", "")).upper()

    if role not in {"VENDOR", "ADMIN"}:
        raise HTTPException(
            status_code=403,
            detail="Vendor access required",
        )

    # ---------------------------------------------------------
    # 2. Convert token to the same type used in MongoDB
    # ---------------------------------------------------------
    try:
        token_value = int(token)
    except (TypeError, ValueError):
        raise HTTPException(
            status_code=400,
            detail="Invalid order token",
        )

    # ---------------------------------------------------------
    # 3. Find the order
    # ---------------------------------------------------------
    order = orders_collection.find_one(
        {"token": token_value}
    )

    if not order:
        raise HTTPException(
            status_code=404,
            detail="Order not found",
        )

    items = order.get("items", [])

    if not items:
        raise HTTPException(
            status_code=400,
            detail="Order has no items",
        )

    # ---------------------------------------------------------
    # 4. Get vendor's allowed stalls
    # ---------------------------------------------------------
    # Administrators can moderate any stall.  Calling the vendor-only
    # ownership helper for an admin would incorrectly reject this path.
    vendor_stall_ids = (
        get_vendor_stall_ids(current_user)
        if role != UserRole.ADMIN
        else []
    )

    vendor_stall_ids = {
        str(value)
        for value in (vendor_stall_ids or [])
        if value is not None
    }

    requested_stall_id = str(stall_id)

    # ---------------------------------------------------------
    # 5. Verify vendor owns the requested stall
    # ---------------------------------------------------------
    if role != "ADMIN" and requested_stall_id not in vendor_stall_ids:
        raise HTTPException(
            status_code=403,
            detail="You do not have access to this stall",
        )

    # ---------------------------------------------------------
    # 6. Find items belonging ONLY to this stall
    # ---------------------------------------------------------
    target_items = []

    for index, item in enumerate(items):
        item_stall_id = str(item.get("stall_id", ""))

        if item_stall_id == requested_stall_id:
            target_items.append((index, item))

    if not target_items:
        raise HTTPException(
            status_code=404,
            detail="No items found for this stall in the order",
        )

    # ---------------------------------------------------------
    # 7. Cancel ONLY this stall's items
    # ---------------------------------------------------------
    cancelled_count = 0
    cancellation_time = datetime.utcnow()

    for index, item in target_items:
        if str(item.get("stall_id", "")) != requested_stall_id:
            continue

        if item.get("cancelled") is True:
            continue

        item["cancelled"] = True
        item["cancelled_at"] = cancellation_time.isoformat()
        item["cancellation_reason"] = "Cancelled by vendor"
        item["status"] = "Cancelled"

        cancelled_count += 1

    if cancelled_count == 0:
        raise HTTPException(
            status_code=400,
            detail="All items for this stall are already cancelled",
        )

    # ---------------------------------------------------------
    # 8. Update ONLY the matching stall order
    # ---------------------------------------------------------
    stall_orders = build_stall_orders(order)

    target_stall_found = False

    for stall_order in stall_orders:
        current_stall_id = str(
            stall_order.get("stall_id", "")
        )

        if current_stall_id != requested_stall_id:
            continue

        target_stall_found = True

        stall_order["status"] = StallOrderStatus.CANCELLED
        stall_order["cancelledAt"] = (
            cancellation_time.isoformat()
        )
        stall_order["cancellationReason"] = (
            "Cancelled by vendor"
        )

    if not target_stall_found:
        raise HTTPException(
            status_code=404,
            detail="Stall order not found",
        )

    # ---------------------------------------------------------
    # 9. Save updated stall orders
    # ---------------------------------------------------------
    order["stall_orders"] = stall_orders

    # ---------------------------------------------------------
    # 10. Determine global order status
    # ---------------------------------------------------------
    remaining_active_items = [
        item
        for item in items
        if item.get("cancelled") is not True
    ]

    if not remaining_active_items:
        # All items from all stalls are cancelled.
        order["status"] = "Cancelled"
        order["cancelled"] = True
        order["cancelled_at"] = (
            cancellation_time.isoformat()
        )
        order["cancellation_reason"] = (
            "All stall orders cancelled"
        )
    else:
        # Other stall(s) still have active items.
        order["cancelled"] = False

        if str(order.get("status", "")).lower() in {
            "cancelled",
            "canceled",
        }:
            order["status"] = "Confirmed"

    # ---------------------------------------------------------
    # 11. Persist updated order
    # ---------------------------------------------------------
    orders_collection.update_one(
        {"_id": order["_id"]},
        {
            "$set": {
                "items": items,
                "stall_orders": order["stall_orders"],
                "status": order.get("status"),
                "cancelled": order.get("cancelled", False),
                "cancelled_at": order.get("cancelled_at"),
                "cancellation_reason": order.get(
                    "cancellation_reason"
                ),
            }
        },
    )

    # ---------------------------------------------------------
    # 12. Create the automatic refund request for this stall
    # ---------------------------------------------------------
    payment = _refund_payment_for_order(order)

    ensure_refund_eligible_order(order, payment)

    refund_calculation = calculate_refund_amount_paise(
        order,
        payment,
        stall_id=requested_stall_id,
    )

    if refund_calculation["amount_paise"] > 0:
        refund_idempotency_key = (
            f"vendor-stall-{order['_id']}-{requested_stall_id}"
        )

        refund_document = {
            "idempotency_key": refund_idempotency_key,
            "order_id": refund_calculation["order_id"],
            "payment_id": refund_calculation["payment_id"],
            "razorpay_refund_id": None,
            "user_email": (
                order.get("email")
                or order.get("user_email")
            ),
            "vendor_email": current_user.get("email"),
            "payment_method": refund_calculation["payment_method"],
            "amount_paise": refund_calculation["amount_paise"],
            "currency": "INR",
            "refund_scope": refund_calculation["refund_scope"],
            "stall_id": requested_stall_id,
            "item_index": None,
            "item_indexes": refund_calculation["item_indexes"],
            "items": refund_calculation["items"],
            "reason": "Cancelled by vendor",
            "status": RefundStatus.PENDING,
            "created_at": cancellation_time,
            "updated_at": cancellation_time,
        }

        try:
            refund_result = refunds_collection.insert_one(
                refund_document
            )
            refund_id = refund_result.inserted_id
        except DuplicateKeyError:
            existing_refund = refunds_collection.find_one(
                {
                    "idempotency_key": refund_idempotency_key,
                }
            )
            refund_id = (
                existing_refund["_id"]
                if existing_refund
                else None
            )

        if refund_id:
            try:
                process_refund_record(refund_id)
            except HTTPException:
                # Cancellation remains successful; the refund record
                # remains persisted for safe retry/reconciliation.
                pass

    # ---------------------------------------------------------
    # 13. Re-fetch latest order
    # ---------------------------------------------------------
    updated_order = orders_collection.find_one(
        {"_id": order["_id"]}
    )

    if updated_order:
        updated_order["_id"] = str(
            updated_order["_id"]
        )

        # -----------------------------------------------------
        # 14. Send real-time WebSocket update
        # -----------------------------------------------------
        await safe_emit_order_update(updated_order)

        # -----------------------------------------------------
        # 15. Send push notification to order owner
        # -----------------------------------------------------
        user_email = (
            order.get("email")
            or order.get("user_email")
        )

        if user_email:
            normalized_email = normalize_email(
                str(user_email)
            )

            order_user = users_collection.find_one(
                {"email": normalized_email}
            )

            if order_user:
                fcm_token = order_user.get("fcm_token")

                if fcm_token:
                    send_push_notification(
                        fcm_token,
                        "CampusVita 🍔",
                        "Your order from this stall was cancelled by the vendor.",
                    )

    # ---------------------------------------------------------
    # 15. Return stall-specific result
    # ---------------------------------------------------------
    return {
        "success": True,
        "message": "Stall order cancelled successfully",
        "token": token,
        "stall_id": requested_stall_id,
        "cancelled_items": cancelled_count,
        "global_order_cancelled": (
            len(remaining_active_items) == 0
        ),
        "stall_orders": order.get(
            "stall_orders",
            [],
        ),
        "items": order.get(
            "items",
            [],
        ),
    }


@fastapi_app.get("/vendor/orders")
async def get_vendor_orders(
    current_user: Dict[str, Any] = Depends(require_role(UserRole.VENDOR)),
):
    """Return orders containing items from the authenticated vendor's stalls."""

    vendor_stall_ids = set(get_vendor_stall_ids(current_user))

    if not vendor_stall_ids:
        return {
            "success": True,
            "orders": [],
            "today_revenue": 0.0,
        }

    # ============================================================
    # TODAY'S DATE RANGE
    # Uses the same local-time approach as the admin dashboard
    # ============================================================

    now = datetime.now()
    today_start = now.replace(
        hour=0,
        minute=0,
        second=0,
        microsecond=0,
    )
    tomorrow_start = today_start + timedelta(days=1)

    # ============================================================
    # GET VENDOR ORDERS
    # ============================================================

    orders = list(
        orders_collection.find(
            {"items.stall_id": {"$in": list(vendor_stall_ids)}}
        ).sort("created_at", -1)
    )

    result = []
    today_revenue = 0.0

    for order in orders:

        # --------------------------------------------------------
        # ONLY ITEMS BELONGING TO THIS VENDOR
        # --------------------------------------------------------

        vendor_items = [
            item
            for item in order.get("items", [])
            if str(item.get("stall_id") or "") in vendor_stall_ids
        ]

        if not vendor_items:
            continue

        # --------------------------------------------------------
        # TODAY'S REVENUE
        #
        # Only PAID orders count.
        # Cancelled items are excluded.
        # Only this vendor's stall items are included.
        # --------------------------------------------------------

        payment_status = order.get("payment_status")

        created_at = order.get("created_at")

        is_today = False

        if isinstance(created_at, datetime):
            # Handle both timezone-aware and naive datetimes safely
            created_at_compare = created_at

            if created_at_compare.tzinfo is not None:
                created_at_compare = created_at_compare.replace(tzinfo=None)

            is_today = (
                today_start <= created_at_compare < tomorrow_start
            )

        if payment_status == PaymentStatus.PAID and is_today:

            for item in vendor_items:

                # Do not count cancelled items
                if item.get("cancelled") is True:
                    continue

                quantity = int(item.get("quantity", 0) or 0)
                price = float(item.get("price", 0) or 0)

                today_revenue += price * quantity

        # --------------------------------------------------------
        # BUILD STALL ORDERS
        # --------------------------------------------------------

        stall_orders = build_stall_orders(order)

        vendor_stall_orders = [
            stall_order
            for stall_order in stall_orders
            if stall_order["stall_id"] in vendor_stall_ids
        ]

        # --------------------------------------------------------
        # SERIALIZATION
        # --------------------------------------------------------

        order["_id"] = str(order["_id"])

        if isinstance(order.get("created_at"), datetime):
            order["created_at"] = order["created_at"].isoformat()

        if isinstance(order.get("payment_date"), datetime):
            order["payment_date"] = order["payment_date"].isoformat()

        # --------------------------------------------------------
        # VENDOR TOTAL
        # --------------------------------------------------------

        vendor_total = sum(
            float(item.get("price", 0) or 0)
            * int(item.get("quantity", 0) or 0)
            for item in vendor_items
            if not item.get("cancelled")
        )

        result.append({
            "order_id": order["_id"],
            "token": order.get("token"),
            "name": order.get("name"),
            "email": order.get("email") or order.get("user_email"),
            "phone": order.get("phone"),
            "items": vendor_items,
            "stall_orders": vendor_stall_orders,
            "status": order.get(
                "status",
                OrderStatus.PREPARING
            ),
            "total": vendor_total,
            "created_at": order.get("created_at"),
            "date": order.get("date"),
        })

    # ============================================================
    # RESPONSE
    # ============================================================

    return {
        "success": True,
        "orders": result,
        "today_revenue": round(today_revenue, 2),
    }

@fastapi_app.post("/vendor/orders/{token}/items/cancel")
async def cancel_vendor_order_item(
    token: int,
    stall_id: str,
    item_index: int,
    data: VendorCancellationRequest,
    current_user: Dict[str, Any] = Depends(
        require_role(UserRole.VENDOR)
    ),
):
    """Cancel one vendor-owned order item."""

    vendor_stall_ids = set(get_vendor_stall_ids(current_user))

    if stall_id not in vendor_stall_ids:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not own this stall.",
        )

    order = orders_collection.find_one({"token": token})

    if not order:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Order not found.",
        )

    items = order.get("items", [])

    if item_index < 0 or item_index >= len(items):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Order item not found.",
        )

    item = items[item_index]

    if str(item.get("stall_id") or "") != stall_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not own this order item.",
        )

    refund_idempotency_key = (
        f"vendor-item-{order['_id']}-{item_index}"
    )

    if item.get("cancelled"):
        existing_refund = refunds_collection.find_one(
            {
                "idempotency_key": refund_idempotency_key,
            }
        )

        if existing_refund:
            return {
                "success": True,
                "duplicate": True,
                "message": "This item was already cancelled and its refund request already exists.",
                "refund": serialize_refund_response(existing_refund),
            }

        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This item is already cancelled.",
        )

    if order.get("cancelled"):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="The complete order is already cancelled.",
        )

    reason = (
        (data.reason or "Cancelled by vendor").strip()
        or "Cancelled by vendor"
    )

    now = datetime.now().isoformat()

    # -----------------------------------------------------
    # Cancel only this specific item
    # -----------------------------------------------------
    item["cancelled"] = True
    item["cancelledAt"] = now
    item["cancellationReason"] = reason

    # -----------------------------------------------------
    # Rebuild stall-specific order states
    # -----------------------------------------------------
    stall_orders = build_stall_orders(order)

    stall_has_active_items = any(
        str(order_item.get("stall_id") or "") == stall_id
        and not order_item.get("cancelled")
        for order_item in items
    )

    for stall_order in stall_orders:
        if stall_order["stall_id"] != stall_id:
            continue

        if not stall_has_active_items:
            stall_order["status"] = StallOrderStatus.CANCELLED
            stall_order["cancelled"] = True
            stall_order["cancelledAt"] = now
            stall_order["cancellationReason"] = reason

        break

    # -----------------------------------------------------
    # Check whether every item in the complete order
    # has been cancelled
    # -----------------------------------------------------
    all_items_cancelled = all(
        order_item.get("cancelled") is True
        for order_item in items
    )

    update_fields = {
        "items": items,
        "stall_orders": stall_orders,
    }

    # Only mark the complete order cancelled when
    # every item from every stall has been cancelled.
    if all_items_cancelled:
        update_fields.update({
            "cancelled": True,
            "cancelledAt": now,
            "cancellationReason": reason,
            "status": "Cancelled",
        })

    orders_collection.update_one(
        {"_id": order["_id"]},
        {"$set": update_fields},
    )

    # -----------------------------------------------------
    # Automatic partial refund for this cancelled item
    # -----------------------------------------------------
    payment = _refund_payment_for_order(order)

    ensure_refund_eligible_order(order, payment)

    refund_calculation = calculate_refund_amount_paise(
        order,
        payment,
        stall_id=stall_id,
        item_index=item_index,
    )

    if refund_calculation["amount_paise"] > 0:
        refund_document = {
            "idempotency_key": refund_idempotency_key,
            "order_id": refund_calculation["order_id"],
            "payment_id": refund_calculation["payment_id"],
            "razorpay_refund_id": None,
            "user_email": (
                order.get("email")
                or order.get("user_email")
            ),
            "vendor_email": current_user.get("email"),
            "payment_method": refund_calculation["payment_method"],
            "amount_paise": refund_calculation["amount_paise"],
            "currency": "INR",
            "refund_scope": "ITEM",
            "stall_id": stall_id,
            "item_index": item_index,
            "item_indexes": refund_calculation["item_indexes"],
            "items": refund_calculation["items"],
            "reason": reason,
            "status": RefundStatus.PENDING,
            "created_at": datetime.now(timezone.utc),
            "updated_at": datetime.now(timezone.utc),
        }

        try:
            refund_result = refunds_collection.insert_one(
                refund_document
            )
            refund_id = refund_result.inserted_id
        except DuplicateKeyError:
            existing_refund = refunds_collection.find_one(
                {
                    "idempotency_key": refund_idempotency_key,
                }
            )
            refund_id = (
                existing_refund["_id"]
                if existing_refund
                else None
            )

        if refund_id:
            try:
                process_refund_record(refund_id)
            except HTTPException:
                # Cancellation remains successful. The refund record
                # remains persisted for safe retry/reconciliation.
                pass

    # -----------------------------------------------------
    # Reload updated order
    # -----------------------------------------------------
    updated_order = orders_collection.find_one(
        {"_id": order["_id"]}
    )

    if not updated_order:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Updated order could not be loaded.",
        )

    # -----------------------------------------------------
    # Send realtime WebSocket update
    # -----------------------------------------------------
    await safe_emit_order_update(updated_order)

    # -----------------------------------------------------
    # Send FCM push notification to the order owner
    # -----------------------------------------------------
    user_email = order.get("email") or order.get("user_email")

    if user_email:
        normalized_email = normalize_email(str(user_email))

        order_user = users_collection.find_one(
            {"email": normalized_email}
        )

        if order_user:
            fcm_token = order_user.get("fcm_token")

            if fcm_token:
                item_name = str(
                    item.get("name")
                    or item.get("food_name")
                    or item.get("title")
                    or "an item"
                )

                send_push_notification(
                    fcm_token,
                    "CampusVita 🍔",
                    f"Your item '{item_name}' was cancelled by the vendor.",
                )

    # -----------------------------------------------------
    # Return success response
    # -----------------------------------------------------
    return {
        "success": True,
        "message": "Order item cancelled successfully.",
        "order": make_json_safe(updated_order),
    }

@fastapi_app.put("/vendor/orders/{token}/status")
async def update_vendor_stall_order_status(
    token: int,
    stall_id: str,
    data: VendorStallStatusUpdate,
    current_user: Dict[str, Any] = Depends(
        require_role(UserRole.VENDOR)
    ),
):
    """Update one vendor-owned stall within an order."""

    vendor_stall_ids = set(
        get_vendor_stall_ids(current_user)
    )

    if stall_id not in vendor_stall_ids:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not own this stall.",
        )

    order = orders_collection.find_one(
        {"token": token}
    )

    if not order:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Order not found.",
        )

    if stall_id not in set(
        get_order_stall_ids(order)
    ):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="This stall is not part of the order.",
        )

    stall_orders = build_stall_orders(order)

    target = next(
        (
            stall_order
            for stall_order in stall_orders
            if stall_order["stall_id"] == stall_id
        ),
        None,
    )

    if target is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Stall order state not found.",
        )

    current_status = target["status"]
    requested_status = data.status

    allowed_transitions = {
        StallOrderStatus.PENDING: {
            StallOrderStatus.ACCEPTED,
        },
        StallOrderStatus.ACCEPTED: {
            StallOrderStatus.PLACED,
        },
        StallOrderStatus.PLACED: {
            StallOrderStatus.COOKING,
        },
        StallOrderStatus.COOKING: {
            StallOrderStatus.READY,
        },
        StallOrderStatus.READY: set(),
    }

    if requested_status not in allowed_transitions.get(
        current_status,
        set(),
    ):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                f"Invalid status transition: "
                f"{current_status} -> {requested_status}"
            ),
        )

    now = datetime.now()

    for stall_order in stall_orders:

        if stall_order["stall_id"] != stall_id:
            continue

        stall_order["status"] = requested_status

        if requested_status == StallOrderStatus.COOKING:
            stall_order["cookingStartedAt"] = (
                now.isoformat()
            )

        elif requested_status == StallOrderStatus.READY:
            stall_order["readyAt"] = (
                now.isoformat()
            )

        break

    # ============================================================
    # SAVE UPDATED STALL STATUS
    # ============================================================


    # Update only the targeted stall and require its previous
    # status to match, preventing concurrent lost updates.
    target_stall = next(
        entry
        for entry in stall_orders
        if entry["stall_id"] == stall_id
    )

    stall_fields = {
        f"stall_orders.$.{key}": value
        for key, value in target_stall.items()
    }

    result = orders_collection.update_one(
        {
            "_id": order["_id"],
            "stall_orders": {
                "$elemMatch": {
                    "stall_id": stall_id,
                    "status": current_status,
                }
            },
        },
        {
            "$set": stall_fields,
        },
    )

    if result.matched_count == 0:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Concurrent update detected; retry.",
        )


    # ============================================================
    # LOAD UPDATED ORDER
    # ============================================================

    updated_order = orders_collection.find_one(
        {"_id": order["_id"]}
    )

    if not updated_order:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Updated order could not be loaded.",
        )

    # ============================================================
    # SEND PUSH NOTIFICATION TO CUSTOMER
    # ============================================================

    send_order_status_push_notification(
        updated_order,
        stall_id,
        requested_status,
    )

    # ============================================================
    # SEND REALTIME WEBSOCKET UPDATE
    # ============================================================

    await safe_emit_order_update(
        updated_order
    )

    # ============================================================
    # BUILD JSON-SAFE RESPONSE
    # ============================================================

    response_order = make_json_safe(
        updated_order
    )

    return {
        "success": True,
        "message": (
            "Stall order status updated successfully."
        ),
        "order": response_order,
    }


@fastapi_app.post("/vendor/orders/{token}/pickup-confirm")
async def confirm_pickup(
    token: int,
    stall_id: str,
    pickup_code: str,
    current_user: Dict[str, Any] = Depends(
        require_role(UserRole.VENDOR)
    ),
):
    # Verify that this vendor owns the requested stall.
    owned_stalls = set(get_vendor_stall_ids(current_user))

    if stall_id not in owned_stalls:
        raise HTTPException(
            status_code=403,
            detail="Stall ownership required.",
        )

    order = orders_collection.find_one({"token": token})

    if not order:
        raise HTTPException(
            status_code=404,
            detail="Order not found.",
        )

    stall_state = next(
        (
            entry
            for entry in order.get("stall_orders", [])
            if entry.get("stall_id") == stall_id
        ),
        None,
    )

    if stall_state is None:
        raise HTTPException(
            status_code=404,
            detail="Stall not in order.",
        )

    if stall_state.get("status") != StallOrderStatus.READY:
        raise HTTPException(
            status_code=409,
            detail="Stall not ready for pickup.",
        )

    # Validate the pickup code before returning duplicate success.
    expected_code = str(order.get("pickup_code", "")).strip()
    supplied_code = pickup_code.strip()

    if not expected_code or not secrets.compare_digest(
        expected_code,
        supplied_code,
    ):
        raise HTTPException(
            status_code=403,
            detail="Invalid pickup code.",
        )

    if stall_state.get("picked_up"):
        return {
            "success": True,
            "message": "Pickup already confirmed.",
            "duplicate": True,
        }

    # Match the SAME stall's identity, readiness and pickup state.
    result = orders_collection.update_one(
        {
            "_id": order["_id"],
            "token": token,
            "stall_orders": {
                "$elemMatch": {
                    "stall_id": stall_id,
                    "status": StallOrderStatus.READY,
                    "picked_up": {"$ne": True},
                }
            },
        },
        {
            "$set": {
                "stall_orders.$.picked_up": True,
                "stall_orders.$.picked_up_at": datetime.now(
                    timezone.utc
                ).isoformat(),
            }
        },
    )

    if result.matched_count == 0:
        raise HTTPException(
            status_code=409,
            detail="Concurrent update; retry.",
        )

    updated_order = orders_collection.find_one(
        {"_id": order["_id"]}
    )

    if updated_order:
        await safe_emit_order_update(updated_order)

    return {
        "success": True,
        "message": "Pickup confirmed.",
        "stall_id": stall_id,
    }

class GoogleLoginData(BaseModel):
    id_token: str

class GoogleAuthData(BaseModel):
    id_token: str
    login_mode: Literal["USER", "ADMIN", "VENDOR"]
# =====================================
# HOME ROUTE
# =====================================

@fastapi_app.get("/")
def home():
    return {"message": "CampusVita Backend Running 🚀"}


# =====================================
# AUTH ROUTES
# =====================================

@fastapi_app.post("/signup")
@limiter.limit("5/minute")
def signup(
    request: Request,
    user: SignupData
):
    try:
        # ============================================================
        # NORMALIZE USER DATA
        # ============================================================

        name = user.name.strip()
        email = normalize_email(user.email)
        phone = user.phone.strip()

        # ============================================================
        # VALIDATE NAME
        # ============================================================

        if not name:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Name is required"
            )

        # ============================================================
        # VALIDATE PHONE
        # ============================================================

        if not phone:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Phone number is required"
            )

        if not re.fullmatch(
            r"[6789]\d{9}",
            phone
        ):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Enter a valid 10-digit Indian mobile number"
            )

        # ============================================================
        # CHECK DUPLICATE EMAIL
        # ============================================================

        existing_user = users_collection.find_one(
            {
                "email": email
            }
        )

        if existing_user:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="This email address is already registered"
            )

        # ============================================================
        # CHECK DUPLICATE PHONE
        # ============================================================

        existing_phone = users_collection.find_one(
            {
                "phone": phone
            }
        )

        if existing_phone:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="This phone number is already registered"
            )

        # ============================================================
        # HASH PASSWORD
        # ============================================================

        hashed_password = hash_password(
            user.password
        )

        # ============================================================
        # DETERMINE USER ROLE
        # ============================================================

        role = (
            UserRole.ADMIN
            if email in ADMIN_EMAILS
            else UserRole.USER
        )

        # ============================================================
        # CREATE NEW USER
        #
        # IMPORTANT:
        # department and year DO NOT EXIST HERE.
        # ============================================================

        new_user = {
            "name": name,
            "email": email,
            "password": hashed_password,
            "phone": phone,

            "profile_image": "",

            "wallet": 0,
            "wallet_history": [],

            "favorite_foods": [],

            "notifications": True,

            "fcm_token": "",

            "theme": "dark",

            "total_orders": 0,
            "total_spent": 0,

            "role": role,

            "auth_provider": "password",

            "created_at": datetime.utcnow().isoformat(),

            "is_active": True,
        }

        # ============================================================
        # SAVE USER
        # ============================================================

        result = users_collection.insert_one(
            new_user
        )

        logger.info(
            f"✅ New user signed up: "
            f"{email} (role: {role})"
        )

        # ============================================================
        # SUCCESS RESPONSE
        # ============================================================

        return {
            "success": True,

            "message":
                "Signup Successful 🚀",

            "user": {
                "id": str(result.inserted_id),
                "name": name,
                "email": email,
                "phone": phone,
                "role": role,
            }
        }

    except HTTPException:
        raise

    except Exception as e:

        logger.error(
            f"Signup error: {e}"
        )

        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Internal Server Error"
        )
# =====================================
# SAVE FCM TOKEN
# =====================================

@fastapi_app.post("/save-fcm-token")
def save_fcm_token(
    data: FCMTokenData,
    current_user: Dict[str, Any] = Depends(get_current_user),
):
    try:
        email = normalize_email(str(current_user.get("email") or ""))

        if not email:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Authenticated user email not found",
            )

        result = users_collection.update_one(
            {"email": email},
            {
                "$set": {
                    "fcm_token": data.fcm_token
                }
            }
        )

        if result.matched_count == 0:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="User not found"
            )

        logger.info(f"🔔 FCM token saved for: {email}")

        return {
            "message": "FCM token saved successfully"
        }

    except HTTPException:
        raise

    except Exception as e:
        logger.error(f"FCM token save error: {e}")

        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to save FCM token"
        )
@fastapi_app.post("/login")
@limiter.limit("5/minute")
def login(
    request: Request,
    user: LoginData
):
    try:
        email = normalize_email(user.email)

        existing_user = users_collection.find_one(
            {
                "email": email
            }
        )

        # ============================================================
        # USER EXISTS?
        # ============================================================

        if not existing_user:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid email or password"
            )

        # ============================================================
        # ACCOUNT ACTIVE?
        # ============================================================

        if not existing_user.get(
            "is_active",
            True
        ):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Account is deactivated"
            )

        # ============================================================
        # VERIFY PASSWORD
        # ============================================================

        stored_password = existing_user.get(
            "password"
        )

        if not stored_password:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail=(
                    "This account uses Google sign-in. "
                    "Please continue with Google."
                )
            )

        if is_password_hashed(stored_password):

            if not verify_password(
                user.password,
                stored_password
            ):
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="Invalid email or password"
                )

        else:
            # ========================================================
            # TEMPORARY PASSWORD MIGRATION
            # ========================================================

            if user.password != stored_password:
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="Invalid email or password"
                )

            hashed_password = hash_password(
                user.password
            )

            users_collection.update_one(
                {
                    "_id":
                    existing_user["_id"]
                },
                {
                    "$set": {
                        "password":
                        hashed_password
                    }
                }
            )

        # ============================================================
        # USER ROLE
        # ============================================================

        role = existing_user.get(
            "role",
            UserRole.USER
        )

        # ============================================================
        # LOGIN MODE AUTHORIZATION
        #
        # The frontend selection never grants a role.
        # The stored database role is the source of truth.
        # ============================================================

        if user.login_mode != role:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=(
                    f"This account is registered as {role}. "
                    f"Please select {role} login."
                )
            )

        # ============================================================
        # CREATE TOKEN DATA
        # ============================================================

        token_data = {
            "email":
                existing_user["email"],

            "role":
                role,

            "name":
                existing_user.get(
                    "name",
                    ""
                ),
        }

        access_token = create_access_token(
            token_data
        )

        refresh_token = create_refresh_token(
            token_data
        )

        # ============================================================
        # STORE HASHED REFRESH TOKEN
        # ============================================================

        users_collection.update_one(
            {
                "_id":
                existing_user["_id"]
            },
            {
                "$set": {
                    "refresh_token_hash":
                    hash_refresh_token(
                        refresh_token
                    )
                }
            }
        )

        logger.info(
            f"✅ User logged in: {email}"
        )

        # ============================================================
        # SUCCESS RESPONSE
        #
        # NO department
        # NO year
        # ============================================================

        return {
            "message":
                "Login Successful 🚀",

            "access_token":
                access_token,

            "refresh_token":
                refresh_token,

            "token_type":
                "bearer",

            "expires_in":
                ACCESS_TOKEN_EXPIRE_MINUTES * 60,

            "user": {
                "name":
                    existing_user.get(
                        "name",
                        ""
                    ),

                "email":
                    existing_user.get(
                        "email",
                        ""
                    ),

                "phone":
                    existing_user.get(
                        "phone",
                        ""
                    ),

                "wallet":
                    existing_user.get(
                        "wallet",
                        0
                    ),

                "role":
                    role,

                "profile_image":
                    existing_user.get(
                        "profile_image",
                        ""
                    ),
            }
        }

    except HTTPException:
        raise

    except Exception as e:

        logger.error(
            f"Login error: {e}"
        )

        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Internal Server Error"
        )
    
# ============================================================
# GOOGLE LOGIN
# ============================================================

@fastapi_app.post("/google-login")
@limiter.limit("5/minute")
def google_login(
    request: Request,
    data: GoogleLoginData
):
    try:

        # ========================================================
        # VERIFY FIREBASE ID TOKEN
        # ========================================================

        decoded_token = firebase_auth.verify_id_token(
            data.id_token
        )

        # ========================================================
        # GET GOOGLE USER INFORMATION
        # ========================================================

        email = normalize_email(
            decoded_token.get("email", "")
        )

        name = (
            decoded_token.get("name")
            or email.split("@")[0]
        )

        profile_image = (
            decoded_token.get("picture", "")
        )

        # ========================================================
        # VALIDATE EMAIL
        # ========================================================

        if not email:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Google account does not have an email address"
            )

        # ========================================================
        # FIND USER
        # ========================================================

        existing_user = users_collection.find_one(
            {"email": email}
        )

        # ========================================================
        # CREATE USER IF NOT EXISTS
        # ========================================================

        if not existing_user:

            new_user = {
                "name": name,
                "email": email,
                "phone": "",
                "wallet": 0,
                "role": UserRole.USER,
                "profile_image": profile_image,
                "is_active": True,

                # Mark authentication provider
                "auth_provider": "google",
            }

            users_collection.insert_one(
                new_user
            )

            existing_user = users_collection.find_one(
                {"email": email}
            )

            logger.info(
                f"✅ New Google user created: {email}"
            )

        # ========================================================
        # CHECK ACCOUNT STATUS
        # ========================================================

        if not existing_user.get(
            "is_active",
            True
        ):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Account is deactivated"
            )

        # ========================================================
        # UPDATE GOOGLE PROFILE IMAGE
        # ========================================================

        if profile_image:

            users_collection.update_one(
                {"email": email},
                {
                    "$set": {
                        "profile_image": profile_image
                    }
                }
            )

        # ========================================================
        # PREPARE TOKEN DATA
        # ========================================================

        role = existing_user.get(
            "role",
            UserRole.USER
        )

        token_data = {
            "email": email,
            "role": role,
            "name": existing_user.get(
                "name",
                name
            ),
        }

        # ========================================================
        # CREATE JWT TOKENS
        # ========================================================

        access_token = create_access_token(
            token_data
        )

        refresh_token = create_refresh_token(
            token_data
        )

        # ========================================================
        # SAVE REFRESH TOKEN HASH
        # ========================================================

        users_collection.update_one(
            {"email": email},
            {
                "$set": {
                    "refresh_token_hash":
                        hash_refresh_token(
                            refresh_token
                        )
                }
            }
        )

        logger.info(
            f"🔥 Google login successful: {email}"
        )

        # ========================================================
        # SUCCESS RESPONSE
        # ========================================================

        return {
            "message":
                "Google Login Successful 🚀",

            "access_token":
                access_token,

            "refresh_token":
                refresh_token,

            "token_type":
                "bearer",

            "expires_in":
                ACCESS_TOKEN_EXPIRE_MINUTES * 60,

            "user": {
                "name":
                    existing_user.get(
                        "name",
                        name
                    ),

                "email":
                    email,

                "phone":
                    existing_user.get(
                        "phone",
                        ""
                    ),

                "wallet":
                    existing_user.get(
                        "wallet",
                        0
                    ),

                "role":
                    role,

                "profile_image":
                    profile_image
                    or existing_user.get(
                        "profile_image",
                        ""
                    ),
            }
        }

    except HTTPException:
        raise

    except Exception as e:

        logger.error(
            f"Google login error: {str(e)}"
        )

        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Google authentication failed"
        )
    
# ============================================================
# GOOGLE AUTHENTICATION
# ============================================================

# ============================================================
# GOOGLE AUTHENTICATION
# ============================================================

@fastapi_app.post("/auth/google")
@limiter.limit("10/minute")
def google_authentication(
    request: Request,
    data: GoogleAuthData
):
    try:

        # ============================================================
        # VERIFY FIREBASE ID TOKEN
        # ============================================================

        decoded_token = firebase_auth.verify_id_token(
            data.id_token
        )

        firebase_uid = decoded_token.get("uid")

        email = normalize_email(
            decoded_token.get("email", "")
        )

        full_name = (
            decoded_token.get("name")
            or "CampusVita User"
        )

        if not email:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Google account does not contain an email address"
            )

        # ============================================================
        # FIND EXISTING USER
        # ============================================================

        user = users_collection.find_one(
            {"email": email}
        )

        # ============================================================
        # NEW GOOGLE USER
        # ============================================================

        if not user:

            role = (
                UserRole.ADMIN
                if email in ADMIN_EMAILS
                else UserRole.USER
            )

            # ========================================================
            # LOGIN MODE AUTHORIZATION
            #
            # The selected login mode never grants a role.
            # The actual role is determined by trusted backend rules.
            # ========================================================

            if data.login_mode != role:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail=(
                        f"This Google account is registered as {role}. "
                        f"Please select {role} login."
                    )
                )

            new_user = {
                "name": full_name,
                "email": email,

                "password": None,

                "phone": "",

                "profile_image": "",

                "wallet": 0,
                "wallet_history": [],
                "favorite_foods": [],
                "notifications": True,

                "fcm_token": "",
                "theme": "dark",

                "total_orders": 0,
                "total_spent": 0,

                # Authentication
                "firebase_uid": firebase_uid,
                "auth_provider": "google",

                # Role
                "role": role,

                "created_at": datetime.utcnow().isoformat(),
                "is_active": True,
            }

            result = users_collection.insert_one(
                new_user
            )

            user_id = str(result.inserted_id)

            logger.info(
                f"✅ New Google user created: "
                f"{email} (role: {role})"
            )

        # ============================================================
        # EXISTING USER
        # ============================================================

        else:

            user_id = str(user["_id"])

            # Keep existing role
            role = user.get(
                "role",
                UserRole.USER
            )

            # ========================================================
            # LOGIN MODE AUTHORIZATION
            #
            # Existing user's stored role is the source of truth.
            # ========================================================

            if data.login_mode != role:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail=(
                        f"This account is registered as {role}. "
                        f"Please select {role} login."
                    )
                )

            users_collection.update_one(
                {"_id": user["_id"]},
                {
                    "$set": {
                        "firebase_uid": firebase_uid,
                        "auth_provider": "google",
                        "is_active": True,
                    }
                }
            )

            logger.info(
                f"✅ Existing Google user logged in: "
                f"{email} (role: {role})"
            )

        # ============================================================
        # CREATE CAMPUSVITA JWT
        # ============================================================

        access_token = create_access_token(
            {
                "sub": user_id,
                "email": email,
                "role": role,
            }
        )

        # ============================================================
        # SUCCESS RESPONSE
        # ============================================================

        return {
            "success": True,
            "message": "Google authentication successful",

            "access_token": access_token,
            "token_type": "bearer",

            "role": role,

            "user": {
                "id": user_id,
                "email": email,
                "name": full_name,
                "role": role,
            }
        }

    # ============================================================
    # FIREBASE TOKEN EXPIRED
    # ============================================================

    except firebase_auth.ExpiredIdTokenError:

        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Google authentication token has expired"
        )

    # ============================================================
    # INVALID FIREBASE TOKEN
    # ============================================================

    except firebase_auth.InvalidIdTokenError:

        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid Google authentication token"
        )

    except HTTPException:
        raise

    except Exception as e:

        logger.error(
            f"❌ Google authentication error: {e}",
            exc_info=True
        )

        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Google authentication failed"
        )
@fastapi_app.post("/refresh-token")
def refresh_token_route(data: RefreshTokenData):
    try:
        payload = verify_token(data.refresh_token)

        if payload.get("type") != "refresh":
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid token type"
            )

        user = users_collection.find_one({"email": payload.get("email")})
        if not user:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="User not found"
            )

        if not user.get("is_active", True):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Account is deactivated"
            )

        if not refresh_token_matches(data.refresh_token, user.get("refresh_token_hash")):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid refresh token"
            )

        token_data = {
            "email": user["email"],
            "role": user.get("role", UserRole.USER),
            "name": user["name"],
        }

        new_access_token = create_access_token(token_data)

        # Rotate the refresh token: a leaked-but-unused old token becomes
        # useless the moment the legitimate client refreshes.
        new_refresh_token = create_refresh_token(token_data)
        users_collection.update_one(
            {"email": user["email"]},
            {"$set": {"refresh_token_hash": hash_refresh_token(new_refresh_token)}}
        )

        logger.info(f"🔄 Token refreshed for: {user['email']}")

        return {
            "access_token": new_access_token,
            "refresh_token": new_refresh_token,
            "token_type": "bearer",
            "expires_in": ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Refresh token error: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Internal Server Error"
        )


@fastapi_app.post("/logout")
def logout(current_user: Dict[str, Any] = Depends(get_current_user)):
    try:
        users_collection.update_one(
            {"email": current_user["email"]},
            {"$unset": {"refresh_token_hash": ""}}
        )

        logger.info(f"👋 User logged out: {current_user['email']}")

        return {"message": "Logged out successfully"}

    except Exception as e:
        logger.error(f"Logout error: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Internal Server Error"
        )


@fastapi_app.post("/change-password")
def change_password(data: ChangePasswordData, current_user: Dict[str, Any] = Depends(get_current_user)):
    try:
        user = users_collection.find_one({"email": current_user["email"]})

        if not verify_password(data.current_password, user["password"]):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Current password is incorrect"
            )

        hashed_password = hash_password(data.new_password)

        users_collection.update_one(
            {"email": current_user["email"]},
            {"$set": {"password": hashed_password}}
        )

        logger.info(f"🔑 Password changed for: {current_user['email']}")

        return {"message": "Password changed successfully"}

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Change password error: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Internal Server Error"
        )
    
@fastapi_app.post("/forgot-password")
@limiter.limit("3/minute")
def forgot_password(
    request: Request,
    data: ForgotPasswordData
):
    try:
        email = normalize_email(data.email)

        # ============================================================
        # CHECK USER
        # ============================================================

        user = users_collection.find_one(
            {"email": email}
        )

        if not user:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="No account found with this email address"
            )

        # ============================================================
        # GENERATE OTP
        # ============================================================

        otp = str(
            secrets.randbelow(900000) + 100000
        )

        # OTP EXPIRY: 10 MINUTES

        otp_expiry = (
            datetime.utcnow() +
            timedelta(minutes=10)
        ).isoformat()

        # ============================================================
        # SAVE OTP
        # ============================================================

        users_collection.update_one(
            {"email": email},
            {
                "$set": {
                    "reset_otp": otp,
                    "reset_otp_expiry": otp_expiry
                }
            }
        )

        # ============================================================
        # EMAIL CONTENT
        # ============================================================

        subject = "CampusVita Password Reset OTP"

        body = f"""
Hello {user.get("name", "User")},

You requested to reset your CampusVita password.

Your OTP is:

{otp}

This OTP will expire in 10 minutes.

Do not share this OTP with anyone.

Regards,
CampusVita Team
"""

        message = MIMEText(body)

        message["Subject"] = subject
        message["From"] = SMTP_EMAIL
        message["To"] = email

        # ============================================================
        # SEND EMAIL
        # ============================================================

        with smtplib.SMTP_SSL(
            "smtp.gmail.com",
            465
        ) as server:

            server.login(
                SMTP_EMAIL,
                SMTP_PASSWORD
            )

            server.sendmail(
                SMTP_EMAIL,
                email,
                message.as_string()
            )

        logger.info(
            f"📧 Password reset OTP sent to: {email}"
        )

        return {
            "message":
                "Password reset OTP sent successfully"
        }

    except HTTPException:
        raise

    except Exception as e:
        logger.error(
            f"Forgot password error: {e}"
        )

        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to send password reset OTP"
        )
    
@fastapi_app.post("/verify-reset-otp")
@limiter.limit("5/minute")
def verify_reset_otp(
    request: Request,
    data: VerifyResetOTPData
):
    try:
        email = normalize_email(data.email)

        # ============================================================
        # FIND USER
        # ============================================================

        user = users_collection.find_one(
            {"email": email}
        )

        if not user:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="No account found with this email address"
            )

        # ============================================================
        # CHECK OTP EXISTS
        # ============================================================

        stored_otp = user.get("reset_otp")
        otp_expiry = user.get("reset_otp_expiry")

        if not stored_otp or not otp_expiry:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="No password reset request found"
            )

        # ============================================================
        # CHECK OTP
        # ============================================================

        if data.otp.strip() != stored_otp:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid OTP"
            )

        # ============================================================
        # CHECK EXPIRY
        # ============================================================

        expiry_time = datetime.fromisoformat(
            otp_expiry
        )

        if datetime.utcnow() > expiry_time:

            # Remove expired OTP

            users_collection.update_one(
                {"email": email},
                {
                    "$unset": {
                        "reset_otp": "",
                        "reset_otp_expiry": ""
                    }
                }
            )

            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="OTP has expired. Please request a new one."
            )

        # ============================================================
        # OTP VERIFIED
        # ============================================================

        users_collection.update_one(
            {"email": email},
            {
                "$set": {
                    "reset_otp_verified": True
                }
            }
        )

        logger.info(
            f"✅ Password reset OTP verified for: {email}"
        )

        return {
            "message": "OTP verified successfully"
        }

    except HTTPException:
        raise

    except Exception as e:

        logger.error(
            f"OTP verification error: {e}"
        )

        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to verify OTP"
        )

# ============================================================
# RESET PASSWORD
# ============================================================

@fastapi_app.post("/reset-password")
@limiter.limit("5/minute")
def reset_password(
    request: Request,
    data: ResetPasswordData
):
    try:

        # ============================================================
        # NORMALIZE EMAIL
        # ============================================================

        email = normalize_email(data.email)

        # ============================================================
        # CLEAN PASSWORD
        # ============================================================

        new_password = data.new_password.strip()

        # ============================================================
        # VALIDATE PASSWORD
        # ============================================================

        if len(new_password) < 6:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Password must contain at least 6 characters"
            )

        # ============================================================
        # FIND USER
        # ============================================================

        user = users_collection.find_one(
            {"email": email}
        )

        if not user:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="No account found with this email address"
            )

        # ============================================================
        # CHECK OTP WAS VERIFIED
        # ============================================================

        if not user.get("reset_otp_verified"):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Please verify your OTP first"
            )

        # ============================================================
        # HASH NEW PASSWORD
        # ============================================================

        hashed_password = hash_password(
            new_password
        )

        # ============================================================
        # UPDATE PASSWORD AND REMOVE RESET DATA
        # ============================================================

        result = users_collection.update_one(
            {"email": email},
            {
                "$set": {
                    "password": hashed_password
                },

                "$unset": {
                    "reset_otp": "",
                    "reset_otp_expiry": "",
                    "reset_otp_verified": ""
                }
            }
        )

        # ============================================================
        # CHECK DATABASE UPDATE
        # ============================================================

        if result.matched_count == 0:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="User not found"
            )

        # ============================================================
        # SUCCESS
        # ============================================================

        logger.info(
            f"✅ Password reset successfully for: {email}"
        )

        return {
            "message": "Password reset successfully"
        }

    except HTTPException:
        raise

    except Exception as e:

        logger.error(
            f"❌ Password reset error: {e}"
        )

        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to reset password"
        )
# ============================================================
# GET CURRENT USER PROFILE
# ============================================================

@fastapi_app.get("/profile")
def get_profile(
    current_user: Dict[str, Any] = Depends(
        get_current_user
    )
):
    try:

        # ============================================================
        # GET ONLY AUTHENTICATED USER
        # ============================================================

        user = users_collection.find_one(
            {
                "email":
                current_user["email"]
            },
            {
                "password": 0,
                "refresh_token_hash": 0,
            }
        )

        if not user:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="User not found"
            )

        # ============================================================
        # RETURN REAL DATABASE DATA
        #
        # NO department
        # NO year
        # ============================================================

        return {
            "id":
                str(user.get("_id")),

            "email":
                user.get(
                    "email",
                    ""
                ),

            "name":
                user.get(
                    "name",
                    ""
                ),

            "phone":
                user.get(
                    "phone",
                    ""
                ),

            "profile_image":
                user.get(
                    "profile_image",
                    ""
                ),

            "notifications":
                user.get(
                    "notifications",
                    True
                ),

            "theme":
                user.get(
                    "theme",
                    "dark"
                ),

            "wallet":
                user.get(
                    "wallet",
                    0
                ),

            "total_orders":
                user.get(
                    "total_orders",
                    0
                ),

            "total_spent":
                user.get(
                    "total_spent",
                    0
                ),

            "is_verified":
                user.get(
                    "is_verified",
                    False
                ),
        }

    except HTTPException:
        raise

    except Exception as e:

        logger.error(
            f"Get profile error: {e}"
        )

        raise HTTPException(
            status_code=
                status.HTTP_500_INTERNAL_SERVER_ERROR,

            detail=
                "Failed to load profile"
        )
# ============================================================
# UPDATE CURRENT USER PROFILE
# ============================================================

@fastapi_app.put("/profile")
def update_profile(
    profile: ProfileData,
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    try:

        # --------------------------------------------------------
        # IMPORTANT:
        # Update ONLY the authenticated user's record.
        # --------------------------------------------------------

        result = users_collection.update_one(
            {
                "email": current_user["email"]
            },
            {
                "$set": {
                    "name": profile.name,
                    "phone": profile.phone,

                    # IMPORTANT:
                    # This must contain the permanent backend
                    # image path, never a blob URL.
                    "profile_image": profile.profile_image,

                    "notifications": profile.notifications,
                    "theme": profile.theme,
                }
            }
        )

        if result.matched_count == 0:

            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="User not found"
            )

        # --------------------------------------------------------
        # Read the saved profile back from MongoDB
        # --------------------------------------------------------

        updated_user = users_collection.find_one(
            {
                "email": current_user["email"]
            },
            {
                "_id": 0,
                "password": 0,
                "refresh_token_hash": 0,
            }
        )

        if not updated_user:

            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="User not found"
            )

        saved_profile_image = (
            updated_user.get(
                "profile_image",
                ""
            ) or ""
        )

        logger.info(
            f"✅ Profile updated: "
            f"{current_user['email']}"
        )

        logger.info(
            f"🖼️ Saved profile image: "
            f"{saved_profile_image}"
        )

        return {
            "success": True,

            "message":
                "Profile Updated Successfully 🚀",

            "name":
                updated_user.get(
                    "name",
                    ""
                ),

            "email":
                updated_user.get(
                    "email",
                    ""
                ),

            "phone":
                updated_user.get(
                    "phone",
                    ""
                ),

            "profile_image":
                saved_profile_image,

            "notifications":
                updated_user.get(
                    "notifications",
                    True
                ),

            "theme":
                updated_user.get(
                    "theme",
                    "dark"
                ),
        }

    except HTTPException:
        raise

    except Exception as e:

        logger.error(
            f"Update profile error: {e}"
        )

        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Internal Server Error"
        )

# ============================================================
# UPLOAD PROFILE IMAGE
# ============================================================

@fastapi_app.post("/profile/upload-image")
async def upload_profile_image(
    file: UploadFile = File(...),
    current_user: Dict[str, Any] = Depends(get_current_user),
):
    try:
        # ------------------------------------------------------
        # Validate file type
        # ------------------------------------------------------

        allowed_types = {
            "image/jpeg": ".jpg",
            "image/png": ".png",
            "image/webp": ".webp",
        }

        if file.content_type not in allowed_types:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Only JPG, PNG and WEBP images are allowed",
            )

        # ------------------------------------------------------
        # Read file
        # ------------------------------------------------------

        file_content = await file.read()

        if not file_content:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Uploaded image is empty",
            )

        # ------------------------------------------------------
        # Validate size
        # ------------------------------------------------------

        MAX_FILE_SIZE = 5 * 1024 * 1024

        if len(file_content) > MAX_FILE_SIZE:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Profile image must be smaller than 5 MB",
            )

        # ------------------------------------------------------
        # Create unique filename
        # ------------------------------------------------------

        extension = allowed_types[file.content_type]

        filename = f"{uuid.uuid4().hex}{extension}"

        file_path = PROFILE_UPLOAD_DIR / filename

        # ------------------------------------------------------
        # Save image permanently
        # ------------------------------------------------------

        with open(file_path, "wb") as buffer:
            buffer.write(file_content)

        # ------------------------------------------------------
        # IMPORTANT:
        #
        # This is the permanent URL stored in MongoDB.
        # ------------------------------------------------------

        image_url = f"/uploads/profile/{filename}"

        # ------------------------------------------------------
        # Update authenticated user's record
        # ------------------------------------------------------

        result = users_collection.update_one(
            {
                "email": current_user["email"]
            },
            {
                "$set": {
                    "profile_image": image_url
                }
            }
        )

        if result.matched_count == 0:

            # Remove file if user doesn't exist
            if file_path.exists():
                file_path.unlink()

            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="User not found",
            )

        logger.info(
            f"✅ Profile image saved permanently: "
            f"{current_user['email']} -> {image_url}"
        )

        # ------------------------------------------------------
        # Return permanent URL
        # ------------------------------------------------------

        return {
            "success": True,
            "message": "Profile image uploaded successfully",
            "profile_image": image_url,
            "image_url": image_url,
        }

    except HTTPException:
        raise

    except Exception as e:

        logger.error(
            f"Profile image upload error: {e}"
        )

        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to upload profile image",
        )

@fastapi_app.get("/wallet/balance")
def get_wallet_balance(current_user: Dict[str, Any] = Depends(get_current_user)):
    try:
        user = users_collection.find_one(
            {"email": current_user["email"]},
            {"wallet": 1, "wallet_history": 1, "_id": 0}
        )

        return {
            "balance": user.get("wallet", 0),
            "history": user.get("wallet_history", [])
        }

    except Exception as e:
        logger.error(f"Get wallet balance error: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Internal Server Error"
        )


# =====================================
# WALLET TOP-UP (Razorpay-verified — never trust a client-set balance)
# Flow: create-topup-order (server issues a signed intent tying the amount
# to a specific Razorpay order) -> user pays -> verify-topup (server checks
# the signature AND that the intent matches this exact payment) -> credit.
# =====================================

@fastapi_app.post("/wallet/create-topup-order")
@limiter.limit("10/minute")
def create_wallet_topup_order(
    request: Request,
    data: WalletTopupData,
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    try:
        logger.info(
            f"💰 Wallet top-up request from {current_user['email']}: "
            f"amount={data.amount}"
        )

        # ============================================================
        # 1. VALIDATE AMOUNT
        # ============================================================

        amount = round(float(data.amount), 2)

        if amount <= 0:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Wallet amount must be greater than ₹0"
            )

        # Optional safety limit
        if amount > 50000:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Maximum wallet top-up amount is ₹50,000"
            )

        amount_paise = int(round(amount * 100))

        logger.info(
            f"💰 Creating Razorpay wallet order: "
            f"₹{amount} = {amount_paise} paise"
        )

        # ============================================================
        # 2. CREATE RAZORPAY ORDER
        # ============================================================

        razorpay_order = razorpay_client.order.create({
            "amount": amount_paise,
            "currency": "INR",
            "payment_capture": 1
        })

        logger.info(
            f"✅ Razorpay wallet order created: "
            f"{razorpay_order['id']}"
        )

        # ============================================================
        # 3. CREATE SIGNED INTENT
        # ============================================================

        order_intent = create_signed_intent(
            "wallet_topup",
            {
                "email": current_user["email"],
                "amount": amount,
                "razorpay_order_id": razorpay_order["id"],
            },
        )

        # ============================================================
        # 4. RETURN DATA TO FRONTEND
        # ============================================================

        return {
            "success": True,
            "order_id": razorpay_order["id"],
            "amount": razorpay_order["amount"],
            "currency": razorpay_order["currency"],
            "key": RAZORPAY_KEY_ID,
            "order_intent": order_intent,
        }

    except HTTPException:
        raise

    except Exception as e:
        logger.exception(
            f"❌ Create wallet topup order error: {repr(e)}"
        )

        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to create wallet top-up order"
        )


@fastapi_app.post("/wallet/verify-topup")
def verify_wallet_topup(data: VerifyWalletTopupData, current_user: Dict[str, Any] = Depends(get_current_user)):
    try:
        intent = decode_signed_intent(data.order_intent, "wallet_topup")

        if intent.get("razorpay_order_id") != data.razorpay_order_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Order reference does not match this payment"
            )

        if intent.get("email") != current_user["email"]:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="This order reference belongs to a different account"
            )

        # Idempotency: a payment_id can only ever be applied once. Checked
        # here, and enforced again by the unique index + DuplicateKeyError
        # catch below in case of a concurrent double-submit race.
        if payments_collection.find_one({"payment_id": data.razorpay_payment_id}):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Payment already processed"
            )

        razorpay_client.utility.verify_payment_signature({
            "razorpay_order_id": data.razorpay_order_id,
            "razorpay_payment_id": data.razorpay_payment_id,
            "razorpay_signature": data.razorpay_signature,
        })

        amount = intent["amount"]

        payment = {
    "payment_id": data.razorpay_payment_id,

    # Wallet top-up is not a food order
    "order_id": None,

    # Real Razorpay order ID
    "razorpay_order_id": data.razorpay_order_id,

    "email": current_user["email"],
    "user_email": current_user["email"],

    "amount": float(amount),
    "currency": "INR",

    "status": PaymentStatus.PAID,
    "payment_method": "ONLINE",
    "purpose": "wallet_topup",

    "payment_date": datetime.now(timezone.utc),

    "refund_status": None,
    "refund_amount": 0.0,
    "refund_date": None,
    "refund_payment_id": None,
}

        try:
            payments_collection.insert_one(payment)
        except DuplicateKeyError:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Payment already processed"
            )

        users_collection.update_one(
            {"email": current_user["email"]},
            {
                "$inc": {"wallet": amount},
                "$push": {
                    "wallet_history": {
                        "type": "credit",
                        "amount": amount,
                        "reason": "Wallet top-up via Razorpay",
                        "payment_id": data.razorpay_payment_id,
                        "date": datetime.now().strftime("%d %b %Y, %I:%M %p"),
                    }
                },
            },
        )

        logger.info(f"✅ Wallet topped up for {current_user['email']}: +₹{amount}")

        return {
            "success": True,
            "message": "Wallet Topped Up Successfully 🚀",
            "amount_added": amount,
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Verify wallet topup error: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Internal Server Error"
        )

@fastapi_app.post("/wallet/pay-order")
async def pay_order_with_wallet(
    data: CreateFoodOrderData,
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    try:
        # ============================================================
        # 1. CALCULATE REAL FOOD PRICES FROM DATABASE
        # ============================================================

        bill = calculate_food_order_bill(data.items)
        order_items = bill["items"]
        subtotal = float(bill["subtotal"])
        delivery_fee = float(bill["delivery_fee"])
        tax_amount = float(bill["tax_amount"])
        total = float(bill["total"])

        if total <= 0:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid order amount"
            )

        # ============================================================
        # 2. FIND USER
        # ============================================================

        user = users_collection.find_one(
            {"email": current_user["email"]}
        )

        if not user:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="User not found"
            )

        wallet_balance = float(
            user.get("wallet", 0)
        )

        # ============================================================
        # 3. CHECK WALLET BALANCE
        # ============================================================

        if wallet_balance < total:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    f"Insufficient wallet balance. "
                    f"Available: ₹{wallet_balance:.2f}, "
                    f"Required: ₹{total:.2f}"
                )
            )

        # ============================================================
        # 4. CREATE ORDER
        # ============================================================

        now = datetime.now()

        pickup_code = random.randint(
            1000,
            9999
        )

        token = get_next_token()

        order = {
            "items": order_items,

            "total": total,

# Immutable billing snapshot used for future refund calculations.
"billing": {
    "subtotal": subtotal,
    "delivery_fee": delivery_fee,
    "tax_amount": tax_amount,
    "discount": float(bill["discount"]),
    "total": total,
},

"email": current_user["email"],

            "name": data.name,

            "phone": data.phone,

            "payment_method": "WALLET",

            "payment_status": PaymentStatus.PAID,

            "payment_id": None,

            "razorpay_order_id": None,

            "razorpay_signature": None,

            "payment_date": now.strftime(
                "%d %b %Y, %I:%M %p"
            ),

            "payment_amount": total,

            "status": OrderStatus.PREPARING,

            "created_at": now,

            "date": now.strftime(
                "%d %b %Y, %I:%M %p"
            ),

            "estimated_time": "15-20 mins",

            "pickup_code": pickup_code,

            "token": token,

            "user_email": current_user["email"],
        }
        order["stall_orders"] = build_stall_orders(order)

        # ============================================================
        # 5. DEDUCT WALLET BALANCE
        # ============================================================

        wallet_update = users_collection.update_one(
            {
                "email": current_user["email"],

                # Important:
                # Only update if the balance is still enough.
                "wallet": {
                    "$gte": total
                }
            },
            {
                "$inc": {
                    "wallet": -total,
                    "total_orders": 1,
                    "total_spent": total
                },

                "$push": {
                    "wallet_history": {
                        "type": "debit",

                        "amount": total,

                        "reason": "Food order payment",

                        "date": now.strftime(
                            "%d %b %Y, %I:%M %p"
                        ),

                        "order_token": token,
                    }
                }
            }
        )

        if wallet_update.modified_count != 1:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Insufficient wallet balance"
            )

        # ============================================================
        # 6. INSERT ORDER
        # ============================================================

        try:

            result = orders_collection.insert_one(
                order
            )

        except Exception as e:

            # If order insertion fails, refund the wallet
            users_collection.update_one(
                {
                    "email": current_user["email"]
                },
                {
                    "$inc": {
                        "wallet": total,
                        "total_orders": -1,
                        "total_spent": -total
                    },

                    "$pull": {
                        "wallet_history": {
                            "order_token": token
                        }
                    }
                }
            )

            raise e

        # ============================================================
        # 7. GET SAVED ORDER
        # ============================================================

        saved_order = orders_collection.find_one(
            {
                "_id": result.inserted_id
            },
            {
                "_id": 0
            }
        )

        # ============================================================
        # 8. CREATE PAYMENT RECORD
        # ============================================================

        payment = {
            "payment_id": f"WALLET-{token}",

            "order_id": str(
                result.inserted_id
            ),

            "razorpay_order_id": None,

            "email": current_user["email"],

            "user_email": current_user["email"],

            "amount": total,

            "currency": "INR",

            "status": PaymentStatus.PAID,

            "payment_method": "WALLET",

            "purpose": "food_order",

            "payment_date": datetime.now(
                timezone.utc
            ),

            "refund_status": None,

            "refund_amount": 0.0,

            "refund_date": None,

            "refund_payment_id": None,
        }

        try:
            payments_collection.insert_one(
                payment
            )

        except DuplicateKeyError:
            # The wallet debit and order already exist, but the
            # payment ledger says this payment identifier was used.
            # Roll back both so the customer is never charged
            # without one consistent payment record.
            orders_collection.delete_one(
                {"_id": result.inserted_id}
            )

            users_collection.update_one(
                {"email": current_user["email"]},
                {
                    "$inc": {
                        "wallet": total,
                        "total_orders": -1,
                        "total_spent": -total,
                    },
                    "$pull": {
                        "wallet_history": {
                            "order_token": token
                        }
                    },
                },
            )

            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Payment already processed",
            )

        except Exception:
            # Payment record creation failed after the wallet was
            # debited and the order was inserted. Restore both.
            orders_collection.delete_one(
                {"_id": result.inserted_id}
            )

            users_collection.update_one(
                {"email": current_user["email"]},
                {
                    "$inc": {
                        "wallet": total,
                        "total_orders": -1,
                        "total_spent": -total,
                    },
                    "$pull": {
                        "wallet_history": {
                            "order_token": token
                        }
                    },
                },
            )

            logger.exception(
                "Wallet payment record insertion failed; "
                "order and wallet debit rolled back."
            )

            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Unable to complete wallet payment.",
            )

        # ============================================================
        # 9. SEND ORDER UPDATE
        # ============================================================

        try:
            await safe_emit_order_update(
                saved_order
            )
        except Exception as e:
            logger.warning(
                f"Order update emit failed: {e}"
            )

        # ============================================================
        # 10. START ORDER FLOW
        # ============================================================

        threading.Thread(
            target=update_order_flow,
            args=(result.inserted_id,),
            daemon=True
        ).start()

        logger.info(
            f"✅ Wallet order created for "
            f"{current_user['email']}: ₹{total}"
        )

        # ============================================================
        # 11. RESPONSE
        # ============================================================

        return {
            "success": True,

            "message": "Order placed using wallet successfully",

            "order": saved_order,

            "payment_id": payment[
                "payment_id"
            ],

            "amount_paid": total,

            "wallet_balance": wallet_balance - total,
        }

    except HTTPException:
        raise

    except Exception as e:

        logger.error(
            f"Wallet order error: {e}"
        )

        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Internal Server Error"
        )

# =====================================
# ORDER ROUTES
# =====================================

def serialize_refund_response(
    refund: Optional[Dict[str, Any]],
) -> Optional[Dict[str, Any]]:
    """
    Return only customer/vendor-safe refund fields.

    Provider responses and internal failure details are never exposed
    through customer/vendor refund APIs.
    """
    if not refund:
        return None

    safe_fields = {
        "_id",
        "order_id",
        "payment_id",
        "razorpay_refund_id",
        "user_email",
        "payment_method",
        "amount_paise",
        "currency",
        "refund_scope",
        "stall_id",
        "item_index",
        "item_indexes",
        "items",
        "reason",
        "status",
        "created_at",
        "updated_at",
        "processed_at",
    }

    return {
        key: value
        for key, value in refund.items()
        if key in safe_fields
    }

def process_refund_record(refund_id: ObjectId) -> Dict[str, Any]:
    """
    Process one persisted refund exactly once.

    ONLINE refunds are sent to Razorpay with the same idempotency key stored
    in MongoDB. WALLET refunds are applied atomically to the customer's
    wallet and recorded in wallet_history.
    """
    refund = refunds_collection.find_one({"_id": refund_id})

    if not refund:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Refund request not found.",
        )

    if refund.get("status") == RefundStatus.PROCESSED:
        return refund

    if refund.get("status") not in {
        RefundStatus.PENDING,
        RefundStatus.FAILED,
    }:
        return refund

    order_id = str(refund.get("order_id") or "").strip()
    amount_paise = int(refund.get("amount_paise") or 0)
    payment_method = str(
        refund.get("payment_method") or ""
    ).strip().upper()

    if not order_id or amount_paise <= 0:
        refunds_collection.update_one(
            {"_id": refund_id},
            {
                "$set": {
                    "status": RefundStatus.FAILED,
                    "failure_reason": "Invalid persisted refund data.",
                    "updated_at": datetime.now(timezone.utc),
                }
            },
        )
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Refund data is invalid.",
        )

    claim_time = datetime.now(timezone.utc)

    claimed = refunds_collection.find_one_and_update(
        {
            "_id": refund_id,
            "status": {
                "$in": [
                    RefundStatus.PENDING,
                    RefundStatus.FAILED,
                ]
            },
        },
        {
            "$set": {
                "status": RefundStatus.INITIATED,
                "updated_at": claim_time,
            }
        },
    )

    if not claimed:
        latest = refunds_collection.find_one({"_id": refund_id})

        if latest and latest.get("status") == RefundStatus.PROCESSED:
            return latest

        if latest:
            return latest

        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Refund is already being processed.",
        )

    try:
        refunds_collection.update_one(
            {
                "_id": refund_id,
                "status": RefundStatus.INITIATED,
            },
            {
                "$set": {
                    "status": RefundStatus.PROCESSING,
                    "updated_at": datetime.now(timezone.utc),
                }
            },
        )

        if payment_method == "ONLINE":
            payment_id = str(
                refund.get("payment_id") or ""
            ).strip()

            if not payment_id:
                raise RuntimeError(
                    "Online refund is missing its payment reference."
                )

            idempotency_key = validate_refund_idempotency_key(
                refund.get("idempotency_key", "")
            )

            razorpay_response = razorpay_client.payment.refund(
                payment_id,
                {
                    "amount": amount_paise,
                    "speed": "normal",
                },
                headers={
                    "X-Refund-Idempotency": idempotency_key,
                },
            )

            razorpay_refund_id = str(
                razorpay_response.get("id") or ""
            ).strip()

            if not razorpay_refund_id:
                raise RuntimeError(
                    "Razorpay did not return a refund ID."
                )

            refunds_collection.update_one(
                {
                    "_id": refund_id,
                    "status": RefundStatus.PROCESSING,
                },
                {
                    "$set": {
                        "razorpay_refund_id": razorpay_refund_id,
                        "provider_response": razorpay_response,
                        "updated_at": datetime.now(timezone.utc),
                    }
                },
            )

            # Razorpay's refund API response confirms that the refund
            # request was accepted. Final PROCESSED state is set by the
            # verified refund webhook.

        elif payment_method == "WALLET":
            user_email = str(
                refund.get("user_email") or ""
            ).strip().lower()

            if not user_email:
                raise RuntimeError(
                    "Wallet refund is missing the customer account."
                )

            amount = Decimal(amount_paise) / Decimal("100")

            wallet_result = users_collection.find_one_and_update(
                {
                    "email": user_email,
                    "is_active": True,
                    "wallet_history": {
                        "$not": {
                            "$elemMatch": {
                                "refund_id": str(refund_id),
                            }
                        }
                    },
                },
                {
                    "$inc": {
                        "wallet": float(amount),
                    },
                    "$push": {
                        "wallet_history": {
                            "type": "credit",
                            "amount": float(amount),
                            "reason": "Automatic food order refund",
                            "refund_id": str(refund_id),
                            "order_id": order_id,
                            "date": datetime.now().strftime(
                                "%d %b %Y, %I:%M %p"
                            ),
                        }
                    },
                },
            )

            if not wallet_result:
                existing_wallet_entry = users_collection.find_one(
                    {
                        "email": user_email,
                        "wallet_history": {
                            "$elemMatch": {
                                "refund_id": str(refund_id),
                            }
                        },
                    },
                    {"_id": 1},
                )

                if not existing_wallet_entry:
                    raise RuntimeError(
                        "Customer wallet account was not found."
                    )

            refunds_collection.update_one(
                {
                    "_id": refund_id,
                    "status": RefundStatus.PROCESSING,
                },
                {
                    "$set": {
                        "status": RefundStatus.PROCESSED,
                        "processed_at": datetime.now(timezone.utc),
                        "updated_at": datetime.now(timezone.utc),
                    }
                },
            )

        else:
            raise RuntimeError(
                "Unsupported refund payment method."
            )

    except Exception as exc:
        refunds_collection.update_one(
            {
                "_id": refund_id,
                "status": {
                    "$in": [
                        RefundStatus.INITIATED,
                        RefundStatus.PROCESSING,
                    ]
                },
            },
            {
                "$set": {
                    "status": RefundStatus.FAILED,
                    "failure_reason": str(exc)[:500],
                    "updated_at": datetime.now(timezone.utc),
                }
            },
        )
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Refund processing failed. The refund remains safely recorded for retry.",
        )

    return refunds_collection.find_one({"_id": refund_id})


@fastapi_app.post("/orders/{token}/refund")
async def request_customer_refund(
    token: int,
    data: RefundRequestData,
    current_user: Dict[str, Any] = Depends(
        require_role(UserRole.USER)
    ),
):
    """
    Secure customer cancellation + refund.

    The customer supplies only a reason.

    The backend:
    - verifies ownership
    - verifies the real paid food-order payment
    - verifies every active stall is still Pending
    - cancels all remaining eligible items
    - calculates the refundable amount from persisted order/payment data
    - creates one deterministic refund record
    - processes the refund through the existing refund engine
    """

    customer_email = current_user["email"]

    # ============================================================
    # 1. FIND THE CUSTOMER'S OWN ORDER
    # ============================================================

    order = orders_collection.find_one({
        "token": token,
        "email": customer_email,
    })

    if not order:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Order not found.",
        )

    order_id = str(order["_id"])

    # ============================================================
    # 2. PREVENT A SECOND CUSTOMER FULL REFUND
    # ============================================================

    existing_full_refund = refunds_collection.find_one({
        "order_id": order_id,
        "refund_scope": "FULL_ORDER",
        "status": {
            "$in": [
                RefundStatus.PENDING,
                RefundStatus.INITIATED,
                RefundStatus.PROCESSING,
                RefundStatus.PROCESSED,
            ]
        },
    })

    if existing_full_refund:
        return {
            "success": True,
            "duplicate": True,
            "refund": serialize_refund_response(existing_full_refund),
        }

    # ============================================================
    # 4. VERIFY THE REAL PAYMENT
    # ============================================================

    payment = _refund_payment_for_order(order)

    ensure_refund_eligible_order(
        order,
        payment,
    )

    # ============================================================
    # 5. VERIFY CUSTOMER CANCELLATION ELIGIBILITY
    # ============================================================
    #
    # Only active stalls that are still Pending may be cancelled
    # by the customer.
    #
    # Cancelled items are ignored because they may already have been
    # cancelled/refunded by a vendor.
    # ============================================================

    items = order.get("items", [])

    active_item_indexes = [
        index
        for index, item in enumerate(items)
        if isinstance(item, dict)
        and not bool(item.get("cancelled"))
    ]

    if not active_item_indexes:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This order has no active items available for customer cancellation.",
        )

    stall_orders = build_stall_orders(order)

    active_stall_ids = {
        str(items[index].get("stall_id") or "").strip()
        for index in active_item_indexes
        if str(items[index].get("stall_id") or "").strip()
    }

    stall_order_by_id = {
        str(stall_order.get("stall_id")): stall_order
        for stall_order in stall_orders
        if stall_order.get("stall_id")
    }

    for stall_id in active_stall_ids:
        stall_order = stall_order_by_id.get(stall_id)

        if stall_order is None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="This order cannot be cancelled safely because stall state is unavailable.",
            )

        if stall_order.get("status") != StallOrderStatus.PENDING:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="This order can no longer be cancelled because preparation has already started.",
            )

        if bool(stall_order.get("cancelled")):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="This order contains an unavailable active stall.",
            )

    # ============================================================
    # 6. ATOMIC CANCELLATION
    # ============================================================
    #
    # The MongoDB condition is re-checked at update time.
    #
    # This prevents a customer cancellation from succeeding after
    # another request has already changed the order from Pending.
    # ============================================================

    cancellation_time = datetime.now(timezone.utc)
    cancellation_reason = data.reason.strip()

    updated_items = []

    for index, item in enumerate(items):
        item_copy = dict(item)

        if index in active_item_indexes:
            item_copy["cancelled"] = True
            item_copy["cancelledAt"] = cancellation_time
            item_copy["cancellationReason"] = cancellation_reason

        updated_items.append(item_copy)

    updated_stall_orders = []

    for stall_order in stall_orders:
        stall_copy = dict(stall_order)

        stall_id = str(
            stall_copy.get("stall_id") or ""
        ).strip()

        if stall_id in active_stall_ids:
            stall_copy["cancelled"] = True
            stall_copy["status"] = StallOrderStatus.CANCELLED
            stall_copy["cancelledAt"] = cancellation_time
            stall_copy["cancellationReason"] = cancellation_reason

        updated_stall_orders.append(stall_copy)

    cancellation_update = orders_collection.update_one(
        {
            "_id": order["_id"],
            "email": customer_email,
            "cancelled": {"$ne": True},

            # At least one item must still be active when MongoDB
            # performs the update. This prevents a race with another
            # cancellation request.
            "items": {
                "$elemMatch": {
                    "cancelled": {
                        "$ne": True
                    }
                }
            },

            # Every non-cancelled stall must still be Pending.
            # Already-cancelled stalls are ignored.
            "stall_orders": {
                "$not": {
                    "$elemMatch": {
                        "cancelled": {
                            "$ne": True
                        },
                        "status": {
                            "$nin": [
                                StallOrderStatus.PENDING
                            ]
                        },
                    }
                }
            },
        },
        {
            "$set": {
                "items": updated_items,
                "stall_orders": updated_stall_orders,
                "cancelled": True,
                "cancelledAt": cancellation_time,
                "cancellationReason": cancellation_reason,
            }
        },
    )

    if cancellation_update.modified_count != 1:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="The order changed while cancellation was being processed. Please refresh and try again.",
        )

    # ============================================================
    # 7. RELOAD THE AUTHORITATIVE ORDER
    # ============================================================

    order = orders_collection.find_one({
        "_id": order["_id"],
        "email": customer_email,
    })

    if not order:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Order could not be reloaded after cancellation.",
        )

    # ============================================================
    # 8. RE-VERIFY PAYMENT + CALCULATE SERVER-SIDE REFUND
    # ============================================================

    payment = _refund_payment_for_order(order)

    ensure_refund_eligible_order(
        order,
        payment,
    )

    calculation = calculate_refund_amount_paise(
        order,
        payment,
        full_order=True,
    )

    if calculation["amount_paise"] <= 0:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="No refundable amount remains for this order.",
        )

    # ============================================================
    # 9. CREATE DETERMINISTIC REFUND RECORD
    # ============================================================
    #
    # The key is based on the real MongoDB order ID.
    #
    # Retrying the same customer cancellation therefore cannot
    # create another refund.
    # ============================================================

    refund_idempotency_key = (
        f"customer-order-{order['_id']}"
    )

    existing_customer_refund = refunds_collection.find_one({
        "idempotency_key": refund_idempotency_key,
    })

    if existing_customer_refund:
        return {
            "success": True,
            "duplicate": True,
            "refund": serialize_refund_response(existing_customer_refund),
        }

    refund_document = {
        "idempotency_key": refund_idempotency_key,
        "order_id": calculation["order_id"],
        "payment_id": calculation["payment_id"],
        "razorpay_refund_id": None,
        "user_email": customer_email,
        "payment_method": calculation["payment_method"],
        "amount_paise": calculation["amount_paise"],
        "currency": "INR",
        "refund_scope": "FULL_ORDER",
        "stall_id": None,
        "item_index": None,
        "item_indexes": calculation["item_indexes"],
        "items": calculation["items"],
        "reason": cancellation_reason,
        "status": RefundStatus.PENDING,
        "created_at": datetime.now(timezone.utc),
        "updated_at": datetime.now(timezone.utc),
    }

    try:
        result = refunds_collection.insert_one(
            refund_document
        )

    except DuplicateKeyError:
        existing_customer_refund = refunds_collection.find_one({
            "idempotency_key": refund_idempotency_key,
        })

        if not existing_customer_refund:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Refund request is already being processed.",
            )

        return {
            "success": True,
            "duplicate": True,
            "refund": serialize_refund_response(existing_customer_refund),
        }

    # ============================================================
    # 10. PROCESS THROUGH EXISTING REFUND ENGINE
    # ============================================================

    try:
        saved_refund = process_refund_record(
            result.inserted_id
        )

    except HTTPException:
        # The cancellation is already persisted.
        # The refund record remains safely available for retry.
        raise

    # ============================================================
    # 11. NOTIFY ORDER CLIENTS
    # ============================================================

    updated_order = orders_collection.find_one({
        "_id": order["_id"]
    })

    if updated_order:
        await safe_emit_order_update(
            updated_order
        )

    return {
        "success": True,
        "duplicate": False,
        "message": "Order cancelled and refund requested successfully.",
        "refund": serialize_refund_response(saved_refund),
    }


@fastapi_app.post("/vendor/orders/{token}/refund")
async def request_vendor_refund(
    token: int,
    stall_id: str = Query(..., min_length=1),
    data: VendorRefundRequestData = None,
    current_user: Dict[str, Any] = Depends(
        require_role(UserRole.VENDOR)
    ),
):
    """
    Vendor stall refund request.

    The vendor can refund only items belonging to a stall they own.
    The refund amount is calculated exclusively from persisted order data.
    """
    if data is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Refund request data is required.",
        )

    idempotency_key = validate_refund_idempotency_key(
        data.idempotency_key
    )

    requested_stall_id = str(stall_id).strip()

    vendor_stall_ids = get_vendor_stall_ids(current_user)

    if requested_stall_id not in vendor_stall_ids:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You are not authorized to refund this stall.",
        )

    order = orders_collection.find_one({
        "token": token,
    })

    if not order:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Order not found.",
        )

    payment = _refund_payment_for_order(order)

    ensure_refund_eligible_order(order, payment)

    calculation = calculate_refund_amount_paise(
        order,
        payment,
        stall_id=requested_stall_id,
    )

    existing = refunds_collection.find_one({
        "idempotency_key": idempotency_key,
    })

    if existing:
        if (
            existing.get("order_id") != calculation["order_id"]
            or existing.get("stall_id") != requested_stall_id
        ):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Idempotency key is already associated with another refund.",
            )

        return {
            "success": True,
            "duplicate": True,
            "refund": serialize_refund_response(existing),
        }

    refund_document = {
        "idempotency_key": idempotency_key,
        "order_id": calculation["order_id"],
        "payment_id": calculation["payment_id"],
        "razorpay_refund_id": None,
        "user_email": order.get("email"),
        "vendor_email": current_user["email"],
        "payment_method": calculation["payment_method"],
        "amount_paise": calculation["amount_paise"],
        "currency": "INR",
        "refund_scope": calculation["refund_scope"],
        "stall_id": requested_stall_id,
        "item_index": None,
        "item_indexes": calculation["item_indexes"],
        "items": calculation["items"],
        "reason": data.reason.strip(),
        "status": RefundStatus.PENDING,
        "created_at": datetime.now(timezone.utc),
        "updated_at": datetime.now(timezone.utc),
    }

    try:
        result = refunds_collection.insert_one(refund_document)
    except DuplicateKeyError:
        existing = refunds_collection.find_one({
            "idempotency_key": idempotency_key,
        })

        if not existing:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Refund request is already being processed.",
            )

        return {
            "success": True,
            "duplicate": True,
            "refund": serialize_refund_response(existing),
        }

    saved_refund = process_refund_record(result.inserted_id)

    return {
        "success": True,
        "duplicate": False,
        "message": "Refund processed successfully.",
        "refund": serialize_refund_response(saved_refund),
    }


@fastapi_app.get("/orders")
def get_orders(current_user: Dict[str, Any] = Depends(get_current_user)):
    try:
        orders = list(
            orders_collection.find({
                "email": current_user["email"]
            })
        )

        for order in orders:
            payment = _refund_payment_for_order(order)

            refund_eligible = False

            try:
                if (
                    payment
                    and payment.get("status") == PaymentStatus.PAID
                    and str(
                        payment.get(
                            "purpose",
                            "food_order"
                        )
                    ) == "food_order"
                    and not bool(order.get("cancelled"))
                ):
                    items = order.get("items", [])

                    active_items = [
                        item
                        for item in items
                        if isinstance(item, dict)
                        and not bool(item.get("cancelled"))
                    ]

                    if active_items:
                        stored_stall_orders = order.get("stall_orders")

                        # Fail closed for legacy orders that do not have
                        # persisted stall-level state. Never assume Pending
                        # when the real top-level order may already be Cooking
                        # or further along.
                        if not isinstance(stored_stall_orders, list):
                            refund_eligible = (
                                str(order.get("status") or "").strip().lower()
                                == "pending"
                            )
                        else:
                            stall_orders = build_stall_orders(order)

                            active_stall_ids = {
                                str(
                                    item.get("stall_id") or ""
                                ).strip()
                                for item in active_items
                                if str(
                                    item.get("stall_id") or ""
                                ).strip()
                            }

                            stall_order_by_id = {
                            str(
                                stall_order.get("stall_id")
                            ): stall_order
                            for stall_order in stall_orders
                            if stall_order.get("stall_id")
                        }

                            refund_eligible = bool(
                                active_stall_ids
                            ) and all(
                                stall_order_by_id.get(
                                    stall_id
                                )
                                and stall_order_by_id[
                                    stall_id
                                ].get("status")
                                == StallOrderStatus.PENDING
                                and not bool(
                                    stall_order_by_id[
                                        stall_id
                                    ].get("cancelled")
                                )
                                for stall_id in active_stall_ids
                            )

            except Exception:
                logger.exception(
                    "Failed to calculate refund eligibility "
                    "for order %s",
                    order.get("_id"),
                )
                refund_eligible = False

            latest_refund = refunds_collection.find_one(
                {
                    "order_id": str(order["_id"]),
                    "user_email": current_user["email"],
                    "status": {
                        "$in": RefundStatus.all_statuses()
                    },
                },
                {
                    "status": 1,
                    "amount_paise": 1,
                    "refund_scope": 1,
                    "updated_at": 1,
                    "processed_at": 1,
                },
                sort=[
                    ("created_at", -1),
                ],
            )

            order["refund_eligible"] = refund_eligible
            order["refund_status"] = (
                latest_refund.get("status")
                if latest_refund
                else None
            )
            order["refund_amount_paise"] = (
                int(latest_refund.get("amount_paise", 0) or 0)
                if latest_refund
                else 0
            )
            order["refund_scope"] = (
                latest_refund.get("refund_scope")
                if latest_refund
                else None
            )
            order["refund_updated_at"] = (
                latest_refund.get("updated_at")
                if latest_refund
                else None
            )
            order["refund_processed_at"] = (
                latest_refund.get("processed_at")
                if latest_refund
                else None
            )

            order["order_id"] = str(order["_id"])
            del order["_id"]

        return {"orders": orders}

    except Exception as e:
        logger.error(f"Get orders error: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Internal Server Error"
        )


@fastapi_app.get("/orders/{token}/refund-status")
def get_customer_refund_status(
    token: int,
    current_user: Dict[str, Any] = Depends(
        require_role(UserRole.USER)
    ),
):
    """
    Return the authenticated customer's refund status for their own order.

    Ownership is determined exclusively from the authenticated user's
    email and the order token. Client-supplied user/payment/refund
    identifiers are never trusted.
    """

    customer_email = current_user["email"]

    order = orders_collection.find_one({
        "token": token,
        "email": customer_email,
    })

    if not order:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Order not found.",
        )

    order_id = str(order["_id"])

    refund = refunds_collection.find_one(
        {
            "order_id": order_id,
            "user_email": customer_email,
            "status": {
                "$in": RefundStatus.all_statuses()
            },
        },
        sort=[
            ("created_at", -1),
        ],
    )

    return {
        "success": True,
        "refund": serialize_refund_response(refund),
    }


@fastapi_app.post("/admin/refunds/{refund_id}/retry")
def retry_refund(
    refund_id: str,
    current_user: Dict[str, Any] = Depends(
        require_role(UserRole.ADMIN)
    ),
):
    """
    Retry a persisted refund using the existing refund processor.

    Only the refund record ID is accepted from the client. The refund
    amount, payment reference, customer, payment method, and idempotency
    key are loaded from trusted database state.
    """

    refund_id = str(refund_id or "").strip()

    if not ObjectId.is_valid(refund_id):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid refund ID.",
        )

    refund = refunds_collection.find_one({
        "_id": ObjectId(refund_id),
    })

    if not refund:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Refund request not found.",
        )

    if refund.get("status") == RefundStatus.PROCESSED:
        return {
            "success": True,
            "message": "Refund is already processed.",
            "refund": serialize_refund_response(refund),
        }

    if refund.get("status") not in {
        RefundStatus.PENDING,
        RefundStatus.FAILED,
    }:
        return {
            "success": True,
            "message": "Refund is currently being processed.",
            "refund": serialize_refund_response(refund),
        }

    try:
        processed_refund = process_refund_record(
            ObjectId(refund_id)
        )

        return {
            "success": True,
            "message": "Refund retry submitted.",
            "refund": serialize_refund_response(
                processed_refund
            ),
        }

    except HTTPException:
        latest_refund = refunds_collection.find_one({
            "_id": ObjectId(refund_id),
        })

        return {
            "success": False,
            "message": "Refund retry could not be completed. The refund remains recorded for recovery.",
            "refund": serialize_refund_response(
                latest_refund
            ),
        }

    except Exception:
        logger.exception(
            "Admin refund retry failed for refund %s by %s",
            refund_id,
            current_user["email"],
        )

        latest_refund = refunds_collection.find_one({
            "_id": ObjectId(refund_id),
        })

        return {
            "success": False,
            "message": "Refund retry could not be completed. The refund remains recorded for recovery.",
            "refund": serialize_refund_response(
                latest_refund
            ),
        }



@fastapi_app.get("/track-order/{token}")
def get_order_by_token(
    token: int,
    current_user: Dict[str, Any] = Depends(get_current_user),
):
    try:
        order = orders_collection.find_one({"token": token})

        if not order:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Order not found",
            )

        user_role = str(current_user.get("role", "")).upper()

        if user_role != str(UserRole.ADMIN).upper():
            order_email = normalize_email(
                str(order.get("email") or "")
            )
            user_email = normalize_email(
                str(current_user.get("email") or "")
            )

            if not order_email or order_email != user_email:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Access denied",
                )

        order["order_id"] = str(order["_id"])
        del order["_id"]

        return order

    except HTTPException:
        raise

    except Exception as e:
        logger.error(f"Get order by token error: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Internal Server Error",
        )


def _price_items_from_db(items: List[OrderItemRequest]) -> tuple[list, float]:
    """Looks up authoritative food price/image from MongoDB.

    Food identity is determined by both name and stall_id.
    Price is never accepted from the frontend.
    """

    priced_items = []
    total = 0.0

    for item in items:
        food = foods_collection.find_one({
            "name": item.name,
            "stall_id": item.stall_id,
        })

        if not food:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    f"Food item '{item.name}' does not exist "
                    f"in the selected stall"
                ),
            )

        price = float(food["price"])

        priced_items.append({
            "name": item.name,
            "price": price,
            "quantity": item.quantity,
            "image": food.get("image", ""),
            "stall_id": str(food.get("stall_id", "")),
        })

        total += price * item.quantity

    return priced_items, round(total, 2)

# ============================================================
# AUTHORITATIVE FOOD ORDER BILL
# ============================================================

FOOD_DELIVERY_FEE = float(
    os.getenv("FOOD_DELIVERY_FEE", "20")
)

FOOD_TAX_RATE = float(
    os.getenv("FOOD_TAX_RATE", "0")
)


def calculate_food_order_bill(
    items: List[OrderItemRequest],
):
    """
    Server-authoritative order calculation.

    NEVER trust price/total values sent by the frontend.
    Food prices come directly from MongoDB.
    """

    order_items, subtotal = _price_items_from_db(
        items
    )

    subtotal = round(
        float(subtotal),
        2
    )

    delivery_fee = (
        FOOD_DELIVERY_FEE
        if subtotal > 0
        else 0
    )

    tax_amount = round(
        subtotal *
        (FOOD_TAX_RATE / 100),
        2
    )

    # Keep 0 until a real coupon/discount
    # system exists in the backend.
    discount = 0.0

    total = round(
        subtotal
        + delivery_fee
        + tax_amount
        - discount,
        2,
    )

    if total <= 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid order amount",
        )

    return {
        "items": order_items,
        "subtotal": subtotal,
        "delivery_fee": delivery_fee,
        "tax_amount": tax_amount,
        "discount": discount,
        "total": total,
    }

@fastapi_app.post("/place-order")
async def place_order(
    order: OrderData,
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """Pay with Wallet order path.

    Prices are taken from the database and the wallet balance is
    checked/debited atomically.
    """
    try:
        # ============================================================
        # 1. GET AUTHORITATIVE FOOD DATA + TOTAL
        # ============================================================
        order_items, total = _price_items_from_db(order.items)

        # ============================================================
        # 2. ATOMICALLY DEBIT WALLET
        # ============================================================
        updated_user = users_collection.find_one_and_update(
            {
                "email": current_user["email"],
                "wallet": {"$gte": total},
            },
            {
                "$inc": {
                    "wallet": -total
                },
                "$push": {
                    "wallet_history": {
                        "type": "debit",
                        "amount": total,
                        "reason": "Order payment",
                        "date": datetime.now().strftime(
                            "%d %b %Y, %I:%M %p"
                        ),
                    }
                },
            },
        )

        if updated_user is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Insufficient wallet balance"
            )

        # ============================================================
        # 3. CREATE ORDER
        # ============================================================
        order_dict = {
            "items": order_items,
            "total": total,
            "email": current_user["email"],
            "user_email": current_user["email"],
            "token": get_next_token(),
            "status": OrderStatus.PREPARING,
            "payment_method": "WALLET",
            "payment_status": PaymentStatus.PAID,
            "date": datetime.now().strftime(
                "%d %b %Y, %I:%M %p"
            ),
            "estimated_time": "15-20 mins",
            "pickup_code": random.randint(1000, 9999),
        }
        order_dict["stall_orders"] = build_stall_orders(order_dict)

        result = orders_collection.insert_one(order_dict)

        saved_order = orders_collection.find_one(
            {"_id": result.inserted_id},
            {"_id": 0}
        )

        # ============================================================
        # 4. CREATE REAL PAYMENT RECORD
        # ============================================================
        #
        # This ID is deterministic:
        #
        # WALLET-<real MongoDB order ID>
        #
        # It is NOT randomly generated.
        # It uniquely connects this payment to this order.
        # ============================================================

        wallet_payment_id = f"WALLET-{result.inserted_id}"

        payment = {
            "payment_id": wallet_payment_id,

            # Real CampusVita MongoDB order ID
            "order_id": str(result.inserted_id),

            # Wallet payment does not use Razorpay
            "razorpay_order_id": None,

            "email": current_user["email"],
            "user_email": current_user["email"],

            "amount": float(total),
            "currency": "INR",

            "status": PaymentStatus.PAID,
            "payment_method": "WALLET",
            "purpose": "food_order",

            # Proper database datetime
            "payment_date": datetime.now(timezone.utc),

            # No refund exists at the moment
            "refund_status": None,
            "refund_amount": 0.0,
            "refund_date": None,
            "refund_payment_id": None,
        }

        # ============================================================
        # 5. SAVE PAYMENT RECORD
        # ============================================================
        try:
            payments_collection.insert_one(payment)

        except DuplicateKeyError:
            logger.error(
                "Duplicate wallet payment for order %s",
                result.inserted_id
            )

            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Payment already recorded for this order"
            )

        # ============================================================
        # 6. UPDATE USER ORDER STATISTICS
        # ============================================================
        users_collection.update_one(
            {"email": current_user["email"]},
            {
                "$inc": {
                    "total_orders": 1,
                    "total_spent": total,
                }
            },
        )

        # ============================================================
        # 7. NOTIFY ADMIN / ORDER WEBSOCKET
        # ============================================================
        await safe_emit_order_update(saved_order)

        # ============================================================
        # 8. START ORDER STATUS FLOW
        # ============================================================
        threading.Thread(
            target=update_order_flow,
            args=(result.inserted_id,),
            daemon=True
        ).start()

        logger.info(
            "✅ New wallet order placed: #%s by %s",
            saved_order["token"],
            current_user["email"]
        )

        return {
            "success": True,
            "message": "Order Placed Successfully 🚀",
            "order": saved_order,
        }

    except HTTPException:
        raise

    except Exception as e:
        logger.error(
            "Place order error: %s",
            e
        )

        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Internal Server Error"
        )

@fastapi_app.put("/update-order-status/{order_id}")
async def update_order_status(
    order_id: str,
    data: StatusUpdate,
    _: Dict[str, Any] = Depends(require_role(UserRole.ADMIN)),
):
    # The body is bound to `data: StatusUpdate` (not a bare `status: str`
    # parameter) specifically so this function's local scope never shadows
    # the imported `fastapi.status` module used below.
    try:
        order = orders_collection.find_one({"_id": parse_object_id(order_id)})
        if not order:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Order not found"
            )

        orders_collection.update_one(
            {"_id": order["_id"]},
            {"$set": {"status": data.status}}
        )

        updated_order = orders_collection.find_one({"_id": order["_id"]})
        updated_order["order_id"] = str(updated_order["_id"])
        del updated_order["_id"]

        await safe_emit_order_update(updated_order)

        logger.info(f"✅ Order {order_id} status updated to {data.status}")

        return {
            "success": True,
            "message": f"Order status updated to {data.status} 🚀",
            "order": updated_order
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Update order status error: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Internal Server Error"
        )


@fastapi_app.delete("/delete-order/{order_id}")
def delete_order(order_id: str, current_user: Dict[str, Any] = Depends(get_current_user)):
    try:
        order = orders_collection.find_one({"_id": parse_object_id(order_id)})
        if not order:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Order not found"
            )

        if current_user.get("role") != UserRole.ADMIN:
            if order.get("email") != current_user["email"]:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="You can only delete your own orders"
                )

        orders_collection.delete_one({"_id": order["_id"]})

        logger.info(f"🗑️ Order deleted: {order_id} by {current_user['email']}")

        return {"message": "Order Deleted Successfully 🗑️"}

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Delete order error: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Internal Server Error"
        )


# =====================================
# ORDER STATUS FLOW (Background Thread)
# =====================================

def update_order_flow(order_id):
    flow_statuses = [
        OrderStatus.COOKING,
        OrderStatus.READY_FOR_PICKUP,
        OrderStatus.COMPLETED,
    ]

    for next_status in flow_statuses:
        time.sleep(10)

        orders_collection.update_one(
            {"_id": order_id},
            {
                "$set": {
                    "status": next_status,
                }
            },
        )

        updated_order = orders_collection.find_one(
            {"_id": order_id},
            {"_id": 0},
        )

        if not updated_order:
            logger.warning(
                f"⚠️ Order no longer exists: {order_id}"
            )
            continue

        # Realtime update, if supported.
        emit_order_update_sync(
            updated_order
        )

        # --------------------------------------------------
        # SEND PUSH NOTIFICATION
        # --------------------------------------------------

        user_email = (
            updated_order.get("email")
            or updated_order.get("user_email")
        )

        if not user_email:
            logger.warning(
                f"⚠️ No customer email for order "
                f"{order_id}"
            )
            continue

        normalized_email = normalize_email(
            str(user_email)
        )

        order_user = users_collection.find_one(
            {
                "email": normalized_email
            }
        )

        if not order_user:
            logger.warning(
                f"⚠️ User not found for order "
                f"{order_id}: {normalized_email}"
            )
            continue

        fcm_token = str(
            order_user.get("fcm_token")
            or ""
        ).strip()

        if not fcm_token:
            logger.warning(
                f"⚠️ No FCM token for "
                f"{normalized_email}"
            )
            continue

        send_push_notification(
            fcm_token,
            "CampusVita Order Update",
            f"Your order status is now: {next_status}",
        )
# =====================================
# RATING ROUTES
# =====================================

@fastapi_app.post("/rate-order")
def rate_order(rating: RatingData, current_user: Dict[str, Any] = Depends(get_current_user)):
    try:
        rating_data = rating.model_dump()
        rating_data["user_email"] = current_user["email"]
        rating_data["date"] = datetime.now().strftime("%d %b %Y, %I:%M %p")

        ratings_collection.insert_one(rating_data)
        logger.info(f"⭐ Rating saved for {rating.food_name} by {current_user['email']}")

        return {"message": "Rating Saved ⭐"}

    except Exception as e:
        logger.error(f"Rate order error: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Internal Server Error"
        )

@fastapi_app.post("/rate-stall")
def rate_stall(
    rating: StallRatingData,
    current_user: Dict[str, Any] = Depends(get_current_user),
):
    try:
        stall_id = rating.stall_id.strip()

        # Validate the stall ID before querying MongoDB.
        if not ObjectId.is_valid(stall_id):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid stall ID",
            )

        # Verify that the requested stall exists and is active.
        stall = stalls_collection.find_one({
            "_id": ObjectId(stall_id),
            "active": True,
        })

        if not stall:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Stall not found or inactive",
            )

        user_email = str(current_user["email"]).strip().lower()

        rating_document = {
            "stall_id": stall_id,
            "rating": rating.rating,
            "feedback": rating.feedback.strip(),
            "user_email": user_email,
            "date": datetime.now().strftime("%d %b %Y, %I:%M %p"),
        }

        # Allow each user to update their rating for a stall.
        ratings_collection.update_one(
            {
                "stall_id": stall_id,
                "user_email": user_email,
            },
            {"$set": rating_document},
            upsert=True,
        )

        logger.info(
            "Stall rating saved for %s by %s",
            stall.get("name", stall_id),
            user_email,
        )

        return {
            "success": True,
            "message": "Stall rating saved successfully",
        }

    except HTTPException:
        raise

    except Exception:
        logger.exception("Rate stall error")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to save stall rating",
        )

# =====================================
# FOOD ROUTES (Admin Only)
# =====================================

@fastapi_app.post("/add-food")
async def add_food(
    name: str = Form(...),
    price: float = Form(...),
    category: str = Form(...),
    category_id: str = Form(...),
    stall_id: str = Form(...),
    description: str = Form(...),
    available: bool = Form(...),
    is_veg: str = Form("unknown"),
    image: UploadFile = File(...),
    _: Dict[str, Any] = Depends(
        require_role(UserRole.ADMIN)
    )
):
    try:
        from bson import ObjectId

        # --------------------------------
        # Validate stall ID
        # --------------------------------

        try:
            stall_object_id = ObjectId(stall_id)
        except Exception:
            raise HTTPException(
                status_code=400,
                detail="Invalid stall ID"
            )

        stall_doc = stalls_collection.find_one({
            "_id": stall_object_id,
            "active": True
        })

        if not stall_doc:
            raise HTTPException(
                status_code=400,
                detail="Stall not found or inactive"
            )
        # --------------------------------
        # Validate category ID
        # --------------------------------

        try:
            category_object_id = ObjectId(category_id)
        except Exception:
            raise HTTPException(
                status_code=400,
                detail="Invalid category ID"
            )

        # --------------------------------
        # Get real active category
        # --------------------------------

        category_doc = categories_collection.find_one({
            "_id": category_object_id,
            "active": True
        })

        if not category_doc:
            raise HTTPException(
                status_code=400,
                detail="Category not found or inactive"
            )

        # --------------------------------
        # Clean values
        # --------------------------------

        name = name.strip()
        description = description.strip()

        # Always use category name from database
        category = category_doc["name"].strip()

        # --------------------------------
        # Normalize VEG / NON-VEG
        # --------------------------------

        is_veg_value = is_veg.strip().lower()
        if is_veg_value == "veg":
            is_veg_bool = True
        elif is_veg_value in ["non-veg", "nonveg"]:
            is_veg_bool = False
        else:
            is_veg_bool = None

        # --------------------------------
        # Check duplicate food
        # --------------------------------

        existing = foods_collection.find_one({
            "name": name
        })

        if existing:
            raise HTTPException(
                status_code=400,
                detail="Food already exists"
            )

        # --------------------------------
        # Save image
        # --------------------------------

        image_path = await save_food_image(image)

        # --------------------------------
        # Create food
        # --------------------------------

        food = {
            "name": name,
            "price": price,
            "category": category,
            "category_id": category_id,
            "stall_id": stall_id,
            "description": description,
            "available": available,
            "is_veg": is_veg_bool,
            "image": image_path,
        }

        # --------------------------------
        # Save to MongoDB
        # --------------------------------

        result = foods_collection.insert_one(food)

        food["_id"] = str(result.inserted_id)

        logger.info(
            f"🍔 Food added: {name} | Category: {category}"
        )

        return {
            "message": "Food Added Successfully 🍔",
            "food": food
        }

    except HTTPException:
        raise

    except Exception as e:
        logger.error(
            f"Add food error: {e}"
        )

        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Internal Server Error"
        )


@fastapi_app.get("/foods")
def get_foods():
    try:
        foods = list(foods_collection.find({}, {"_id": 0}))
        return {"foods": foods}

    except Exception as e:
        logger.error(f"Get foods error: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Internal Server Error"
        )


@fastapi_app.put("/update-food/{food_name}")
def update_food(food_name: str, food: FoodData, _: Dict[str, Any] = Depends(require_role(UserRole.ADMIN))):
    try:
        foods_collection.update_one(
            {"name": food_name},
            {"$set": food.model_dump()}
        )
        logger.info(f"✏️ Food updated: {food_name}")
        return {"message": "Food Updated Successfully ✏️"}

    except Exception as e:
        logger.error(f"Update food error: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Internal Server Error"
        )


@fastapi_app.delete("/delete-food/{food_name}")
def delete_food(
    food_name: str,
    _: Dict[str, Any] = Depends(require_role(UserRole.ADMIN))
):
    try:
        print("Food received:", food_name)

        print("Foods in DB:")
        for item in foods_collection.find():
            print(repr(item["name"]))

            result = foods_collection.delete_one({
         "name": {
        "$regex": f"^{re.escape(food_name.strip())}\\s*$",
        "$options": "i"
          }
})

        print("Deleted Count:", result.deleted_count)

        if result.deleted_count == 0:
            return {
                "success": False,
                "message": "Food not found"
            }

        logger.info(f"🗑️ Food deleted: {food_name}")

        return {
            "success": True,
            "message": "Food Deleted Successfully 🗑️"
        }

    except Exception as e:
        logger.error(f"Delete food error: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Internal Server Error"
        )
def sync_categories_from_foods():
    """
    Create missing category records from the category
    values that already exist in foods_collection.

    This does NOT create food records.
    It does NOT create duplicate categories.
    """

    try:
        food_categories = foods_collection.distinct("category")

        created_count = 0

        for category_name in food_categories:

            if category_name is None:
                continue

            category_name = str(category_name).strip()

            if not category_name:
                continue

            existing = categories_collection.find_one({
                "name": {
                    "$regex": f"^{re.escape(category_name)}$",
                    "$options": "i"
                }
            })

            if existing:
                continue

            categories_collection.insert_one({
                "name": category_name,
                "description": "",
                "image": "",
                "active": True,
                "created_at": datetime.utcnow(),
            })

            created_count += 1

        logger.info(
            f"Category sync completed. Created {created_count} categories."
        )

        return created_count

    except Exception as e:
        logger.exception(
            f"Category sync error: {e}"
        )
        raise

# ============================================================
# ADMIN STALL MANAGEMENT
# ============================================================

@fastapi_app.post("/admin/stalls")
def create_stall(
    stall: StallData,
    _: Dict[str, Any] = Depends(require_role(UserRole.ADMIN)),
):
    try:
        name = stall.name.strip()

        if not name:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Stall name is required",
            )

        # Prevent duplicate stall names
        existing = stalls_collection.find_one(
            {
                "name": {
                    "$regex": f"^{re.escape(name)}$",
                    "$options": "i",
                }
            }
        )

        if existing:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="A stall with this name already exists",
            )

        stall_data = {
            "name": name,
            "image": stall.image.strip(),
            "description": stall.description.strip(),
            "is_open": stall.is_open,
            "active": stall.active,
            "owner_email": stall.owner_email,
            "preparation_time": stall.preparation_time,
            "created_at": datetime.utcnow(),
            "updated_at": datetime.utcnow(),
        }

        result = stalls_collection.insert_one(stall_data)

        created_stall = stalls_collection.find_one(
            {"_id": result.inserted_id}
        )

        created_stall["_id"] = str(created_stall["_id"])

        return {
            "success": True,
            "message": "Stall created successfully",
            "stall": created_stall,
        }

    except HTTPException:
        raise

    except Exception as e:
        logger.exception(f"Create stall error: {e}")

        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to create stall",
        )


@fastapi_app.get("/admin/stalls")
def get_stalls(
    search: str = "",
    status_filter: str = "ALL",
    _: Dict[str, Any] = Depends(require_role(UserRole.ADMIN)),
):
    try:
        query = {}

        # Search
        if search.strip():
            query["name"] = {
                "$regex": re.escape(search.strip()),
                "$options": "i",
            }

        # Active/inactive filter
        if status_filter == "ACTIVE":
            query["active"] = True

        elif status_filter == "INACTIVE":
            query["active"] = False

        stalls = []

        for stall in stalls_collection.find(query).sort(
            "created_at",
            DESCENDING,
        ):
            stall["_id"] = str(stall["_id"])

            stalls.append(stall)

        return {
            "success": True,
            "stalls": stalls,
            "total": len(stalls),
        }

    except Exception as e:
        logger.exception(f"Get stalls error: {e}")

        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to fetch stalls",
        )


@fastapi_app.put("/admin/stalls/{stall_id}")
def update_stall(
    stall_id: str,
    stall: StallData,
    _: Dict[str, Any] = Depends(require_role(UserRole.ADMIN)),
):
    try:
        try:
            object_id = ObjectId(stall_id)
        except InvalidId:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid stall ID",
            )

        existing = stalls_collection.find_one(
            {"_id": object_id}
        )

        if not existing:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Stall not found",
            )

        name = stall.name.strip()

        if not name:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Stall name is required",
            )

        # Prevent duplicate names
        duplicate = stalls_collection.find_one(
            {
                "_id": {"$ne": object_id},
                "name": {
                    "$regex": f"^{re.escape(name)}$",
                    "$options": "i",
                },
            }
        )

        if duplicate:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Another stall with this name already exists",
            )

        update_data = {
            "name": name,
            "image": stall.image.strip(),
            "description": stall.description.strip(),
            "is_open": stall.is_open,
            "active": stall.active,
            "owner_email": stall.owner_email,
            "preparation_time": stall.preparation_time,
            "updated_at": datetime.utcnow(),
        }

        stalls_collection.update_one(
            {"_id": object_id},
            {"$set": update_data},
        )

        updated_stall = stalls_collection.find_one(
            {"_id": object_id}
        )

        updated_stall["_id"] = str(updated_stall["_id"])

        return {
            "success": True,
            "message": "Stall updated successfully",
            "stall": updated_stall,
        }

    except HTTPException:
        raise

    except Exception as e:
        logger.exception(f"Update stall error: {e}")

        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to update stall",
        )


@fastapi_app.delete("/admin/stalls/{stall_id}")
def delete_stall(
    stall_id: str,
    _: Dict[str, Any] = Depends(require_role(UserRole.ADMIN)),
):
    try:
        try:
            object_id = ObjectId(stall_id)
        except InvalidId:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid stall ID",
            )

        existing = stalls_collection.find_one(
            {"_id": object_id}
        )

        if not existing:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Stall not found",
            )

        # Don't delete if food items are still linked to this stall
        linked_food = foods_collection.find_one(
            {"stall_id": stall_id}
        )

        if linked_food:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=(
                    "Cannot delete this stall because food items "
                    "are still assigned to it"
                ),
            )

        stalls_collection.delete_one(
            {"_id": object_id}
        )

        return {
            "success": True,
            "message": "Stall deleted successfully",
        }

    except HTTPException:
        raise

    except Exception as e:
        logger.exception(f"Delete stall error: {e}")

        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to delete stall",
        )

# ============================================================
# PUBLIC STALLS FOR USER HOME
# ============================================================

@fastapi_app.get("/stalls")
def get_public_stalls():
    """
    Return active stalls with real ratings calculated from
    the MongoDB ratings collection.

    Only ratings explicitly associated with a stall_id
    are included in the stall average.
    """

    try:
        stalls = []

        cursor = stalls_collection.find(
            {"active": True}
        ).sort(
            "created_at",
            DESCENDING,
        )

        for stall in cursor:
            stall_id = str(stall["_id"])

            # Find ratings explicitly associated with this stall.
            rating_documents = ratings_collection.find(
                {"stall_id": stall_id},
                {"rating": 1},
            )

            rating_values = []

            for rating_document in rating_documents:
                try:
                    value = float(rating_document.get("rating"))

                    if 1 <= value <= 5:
                        rating_values.append(value)

                except (TypeError, ValueError):
                    continue

            rating_count = len(rating_values)

            average_rating = (
                round(sum(rating_values) / rating_count, 1)
                if rating_count > 0
                else None
            )

            stalls.append({
                "_id": stall_id,
                "name": str(
                    stall.get("name", "")
                ).strip(),
                "image": str(
                    stall.get("image", "")
                ).strip(),
                "description": str(
                    stall.get("description", "")
                ).strip(),
                "is_open": bool(
                    stall.get("is_open", False)
                ),
                "active": bool(
                    stall.get("active", False)
                ),
                "rating": average_rating,
                "rating_count": rating_count,
            })

        return {
            "success": True,
            "stalls": stalls,
            "total": len(stalls),
        }

    except Exception:
        logger.exception("Get public stalls error")

        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to fetch stalls",
        )

@fastapi_app.get("/admin/categories")
def get_categories(
    search: str = "",
    status_filter: str = "ALL",
    sort: str = "LATEST",
    page: int = Query(1, ge=1),
    limit: int = Query(10, ge=1, le=100),
    _: Dict[str, Any] = Depends(
        require_role(UserRole.ADMIN)
    ),
):
    try:
        # ============================================================
        # SYNC CATEGORIES FROM REAL FOOD DATA
        # ============================================================

        sync_categories_from_foods()

        # ============================================================
        # SEARCH
        # ============================================================

        query = {}

        if search.strip():
            query["name"] = {
                "$regex": re.escape(search.strip()),
                "$options": "i",
            }

        # ============================================================
        # STATUS FILTER
        # ============================================================

        if status_filter == "ACTIVE":
            query["active"] = True

        elif status_filter == "INACTIVE":
            query["active"] = False

        # ============================================================
        # SORT
        # ============================================================

        sort_map = {
            "NAME_ASC": [
                ("name", ASCENDING)
            ],
            "NAME_DESC": [
                ("name", DESCENDING)
            ],
            "OLDEST": [
                ("created_at", ASCENDING)
            ],
            "LATEST": [
                ("created_at", DESCENDING)
            ],
        }

        sort_value = sort_map.get(
            sort,
            [("created_at", DESCENDING)]
        )

        # ============================================================
        # REAL DATABASE COUNTS
        # ============================================================

        total_categories = categories_collection.count_documents(
            query
        )

        total = categories_collection.count_documents({})

        active = categories_collection.count_documents({
            "active": True
        })

        inactive = categories_collection.count_documents({
            "active": False
        })

        total_foods = foods_collection.count_documents({})

        # ============================================================
        # PAGINATION
        # ============================================================

        skip = (page - 1) * limit

        category_docs = list(
            categories_collection
            .find(query)
            .sort(sort_value)
            .skip(skip)
            .limit(limit)
        )

        # ============================================================
        # CATEGORY RESPONSE
        # ============================================================

        categories = []

        for category in category_docs:

            category_name = category.get(
                "name",
                ""
            ).strip()

            # --------------------------------------------------------
            # Find real foods belonging to this category
            # --------------------------------------------------------

            category_food_query = {
                "category": {
                    "$regex": f"^{re.escape(category_name)}$",
                    "$options": "i",
                }
            }

            food_count = foods_collection.count_documents(
                category_food_query
            )

            # --------------------------------------------------------
            # Get one real food from this category
            # --------------------------------------------------------

            representative_food = foods_collection.find_one(
                category_food_query,
                {
                    "_id": 0,
                    "description": 1,
                    "image": 1,
                }
            )

            # --------------------------------------------------------
            # Start with category's own data
            # --------------------------------------------------------

            description = category.get(
                "description"
            ) or ""

            image = category.get(
                "image"
            ) or ""

            # --------------------------------------------------------
            # Use real food description as fallback
            # --------------------------------------------------------

            if not description and representative_food:
                description = (
                    representative_food.get(
                        "description"
                    ) or ""
                )

            # --------------------------------------------------------
            # Use real food image as fallback
            # --------------------------------------------------------

            if not image and representative_food:
                image = (
                    representative_food.get(
                        "image"
                    ) or ""
                )

            # --------------------------------------------------------
            # Add category to response
            # --------------------------------------------------------

            categories.append({
                "id": str(category["_id"]),

                "name": category_name,

                "description": description,

                "image": image,

                "active": bool(
                    category.get(
                        "active",
                        True
                    )
                ),

                "food_count": food_count,

                "created_at": (
                    category.get(
                        "created_at"
                    ).isoformat()
                    if category.get(
                        "created_at"
                    )
                    else None
                ),
            })

        # ============================================================
        # FINAL RESPONSE
        # ============================================================

        return {
            "success": True,

            "categories": categories,

            "pagination": {
                "page": page,

                "limit": limit,

                "total": total_categories,

                "pages": (
                    (
                        total_categories
                        + limit
                        - 1
                    )
                    // limit
                    if total_categories
                    else 0
                ),
            },

            "stats": {
                "total_categories": total,

                "active_categories": active,

                "inactive_categories": inactive,

                "total_foods": total_foods,
            },
        }

    except HTTPException:
        raise

    except Exception as e:

        logger.exception(
            f"Get categories error: {e}"
        )

        raise HTTPException(
            status_code=500,
            detail="Failed to load categories"
        )
# ============================================================
# PUBLIC FOODS FOR A SPECIFIC STALL
# ============================================================

@fastapi_app.get("/stalls/{stall_id}/foods")
def get_stall_foods(stall_id: str):
    """
    Return real food items belonging only to the requested stall.

    IMPORTANT:
    - Stall must exist and be active.
    - Foods are filtered by the real stall_id stored in MongoDB.
    - No fake/default food data is generated.
    - Empty food lists are returned as empty arrays.
    """

    try:
        # --------------------------------------------------------
        # Validate stall ID
        # --------------------------------------------------------

        try:
            stall_object_id = ObjectId(stall_id)
        except (InvalidId, TypeError):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid stall ID",
            )

        # --------------------------------------------------------
        # Find the real active stall
        # --------------------------------------------------------

        stall = stalls_collection.find_one({
            "_id": stall_object_id,
            "active": True,
        })

        if not stall:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Stall not found",
            )

        # --------------------------------------------------------
        # Find only foods belonging to this stall
        # --------------------------------------------------------

        food_docs = foods_collection.find({
            "stall_id": stall_id,
        })

        foods = []

        for food in food_docs:
            foods.append({
                "_id": str(food["_id"]),
                "name": str(
                    food.get("name", "")
                ).strip(),
                "price": float(
                    food.get("price", 0)
                ),
                "category": str(
                    food.get("category", "")
                ).strip(),
                "category_id": str(
                    food.get("category_id", "")
                ).strip(),
                "stall_id": str(
                    food.get("stall_id", "")
                ).strip(),
                "image": str(
                    food.get("image", "")
                ).strip(),
                "description": str(
                    food.get("description", "")
                ).strip(),
                "available": bool(
                    food.get("available", False)
                ),
                "is_veg": food.get("is_veg"),
            })

        # --------------------------------------------------------
        # Return real stall + real foods
        # --------------------------------------------------------

        return {
            "success": True,
            "stall": {
                "_id": str(stall["_id"]),
                "name": str(
                    stall.get("name", "")
                ).strip(),
                "image": str(
                    stall.get("image", "")
                ).strip(),
                "description": str(
                    stall.get("description", "")
                ).strip(),
                "is_open": bool(
                    stall.get("is_open", False)
                ),
                "active": bool(
                    stall.get("active", False)
                ),
                "rating": stall.get("rating"),
                "opening_time": stall.get(
                    "opening_time"
                ),
                "closing_time": stall.get(
                    "closing_time"
                ),
                "preparation_time": stall.get(
                    "preparation_time"
                ),
            },
            "foods": foods,
            "total": len(foods),
        }

    except HTTPException:
        raise

    except Exception as e:
        logger.exception(
            f"Get stall foods error: {e}"
        )

        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to fetch stall foods",
        )
@fastapi_app.post("/admin/categories/sync")
def sync_categories(
    _: Dict[str, Any] = Depends(require_role(UserRole.ADMIN))
):
    try:
        created = 0

        # Get all existing foods
        foods = foods_collection.find(
            {},
            {"category": 1}
        )

        food_categories = set()

        for food in foods:
            category_name = str(
                food.get("category", "")
            ).strip()

            if category_name:
                food_categories.add(category_name)

        # Create missing categories
        for category_name in food_categories:

            existing = categories_collection.find_one({
                "name": {
                    "$regex": f"^{re.escape(category_name)}$",
                    "$options": "i"
                }
            })

            if existing:
                continue

            categories_collection.insert_one({
                "name": category_name,
                "description": f"{category_name} food items",
                "image": "",
                "active": True,
                "created_at": datetime.utcnow(),
            })

            created += 1

        total = categories_collection.count_documents({})

        return {
            "success": True,
            "message": "Categories synchronized successfully",
            "created": created,
            "total_categories": total
        }

    except Exception as e:
        logger.error(
            f"Category sync error: {e}"
        )

        raise HTTPException(
            status_code=500,
            detail="Failed to synchronize categories"
        )

@fastapi_app.post("/admin/categories")
async def create_category(
    name: str = Form(...),
    description: str = Form(""),
    active: bool = Form(True),
    image: UploadFile | None = File(None),
    _: Dict[str, Any] = Depends(
        require_role(UserRole.ADMIN)
    ),
):
    try:

        name = name.strip()
        description = description.strip()

        if not name:
            raise HTTPException(
                status_code=400,
                detail="Category name is required"
            )

        # -----------------------------
        # DUPLICATE CHECK
        # -----------------------------

        existing = categories_collection.find_one({
            "name": {
                "$regex": f"^{re.escape(name)}$",
                "$options": "i",
            }
        })

        if existing:
            raise HTTPException(
                status_code=409,
                detail="Category already exists"
            )

        image_path = ""

        if image:
            image_path = await save_category_image(
                image
            )

        category = {
            "name": name,
            "description": description,
            "image": image_path,
            "active": active,
            "created_at": datetime.utcnow(),
        }

        result = categories_collection.insert_one(
            category
        )

        category["id"] = str(
            result.inserted_id
        )

        category.pop("_id", None)

        return {
            "success": True,
            "message": "Category created successfully",
            "category": category,
        }

    except HTTPException:
        raise

    except Exception as e:

        logger.error(
            f"Create category error: {e}"
        )

        raise HTTPException(
            status_code=500,
            detail="Failed to create category"
        )

@fastapi_app.put("/admin/categories/{category_id}")
async def update_category(
    category_id: str,
    name: str = Form(...),
    description: str = Form(""),
    active: bool = Form(True),
    image: UploadFile | None = File(None),
    _: Dict[str, Any] = Depends(
        require_role(UserRole.ADMIN)
    ),
):
    try:

        from bson import ObjectId

        try:
            object_id = ObjectId(category_id)
        except Exception:
            raise HTTPException(
                status_code=400,
                detail="Invalid category ID"
            )

        existing = categories_collection.find_one({
            "_id": object_id
        })

        if not existing:
            raise HTTPException(
                status_code=404,
                detail="Category not found"
            )

        old_name = existing["name"]

        name = name.strip()
        description = description.strip()

        if not name:
            raise HTTPException(
                status_code=400,
                detail="Category name is required"
            )

        duplicate = categories_collection.find_one({
            "_id": {"$ne": object_id},
            "name": {
                "$regex": f"^{re.escape(name)}$",
                "$options": "i",
            }
        })

        if duplicate:
            raise HTTPException(
                status_code=409,
                detail="Another category with this name already exists"
            )

        update_data = {
            "name": name,
            "description": description,
            "active": active,
        }

        if image:
            update_data["image"] = (
                await save_category_image(image)
            )

        categories_collection.update_one(
            {"_id": object_id},
            {"$set": update_data}
        )

        # --------------------------------
        # If name changed, update foods too
        # --------------------------------

        if old_name.strip().lower() != name.lower():

            foods_collection.update_many(
                {
                    "category": {
                        "$regex":
                            f"^{re.escape(old_name.strip())}$",
                        "$options": "i",
                    }
                },
                {
                    "$set": {
                        "category": name
                    }
                }
            )

        return {
            "success": True,
            "message": "Category updated successfully"
        }

    except HTTPException:
        raise

    except Exception as e:

        logger.error(
            f"Update category error: {e}"
        )

        raise HTTPException(
            status_code=500,
            detail="Failed to update category"
        )

@fastapi_app.patch(
    "/admin/categories/{category_id}/status"
)
def update_category_status(
    category_id: str,
    active: bool,
    _: Dict[str, Any] = Depends(
        require_role(UserRole.ADMIN)
    ),
):
    try:

        from bson import ObjectId

        result = categories_collection.update_one(
            {
                "_id": ObjectId(category_id)
            },
            {
                "$set": {
                    "active": active
                }
            }
        )

        if result.matched_count == 0:
            raise HTTPException(
                status_code=404,
                detail="Category not found"
            )

        return {
            "success": True,
            "message": (
                "Category activated"
                if active
                else "Category deactivated"
            )
        }

    except HTTPException:
        raise

    except Exception as e:

        logger.error(
            f"Category status error: {e}"
        )

        raise HTTPException(
            status_code=500,
            detail="Failed to update category status"
        )
    
@fastapi_app.delete(
    "/admin/categories/{category_id}"
)
def delete_category(
    category_id: str,
    _: Dict[str, Any] = Depends(
        require_role(UserRole.ADMIN)
    ),
):
    try:
        from bson import ObjectId

        # -----------------------------------------
        # Validate category ID
        # -----------------------------------------
        try:
            object_id = ObjectId(category_id)
        except Exception:
            raise HTTPException(
                status_code=400,
                detail="Invalid category ID"
            )

        # -----------------------------------------
        # Find category
        # -----------------------------------------
        category = categories_collection.find_one({
            "_id": object_id
        })

        if not category:
            raise HTTPException(
                status_code=404,
                detail="Category not found"
            )

        category_name = category.get("name", "")

        # -----------------------------------------
        # Detach foods from this category
        #
        # IMPORTANT:
        # We do NOT delete the food items.
        # We only remove their category relationship.
        # -----------------------------------------

        foods_collection.update_many(
            {
                "$or": [
                    {
                        "category_id": category_id
                    },
                    {
                        "category": {
                            "$regex": f"^{re.escape(category_name)}$",
                            "$options": "i"
                        }
                    }
                ]
            },
            {
                "$set": {
                    "category_id": None,
                    "category": ""
                }
            }
        )

        # -----------------------------------------
        # Delete category
        # -----------------------------------------

        result = categories_collection.delete_one({
            "_id": object_id
        })

        if result.deleted_count == 0:
            raise HTTPException(
                status_code=404,
                detail="Category not found"
            )

        logger.info(
            f"Category deleted successfully: "
            f"{category_name} ({category_id})"
        )

        return {
            "success": True,
            "message": "Category deleted successfully",
            "category_id": category_id,
            "category_name": category_name
        }

    except HTTPException:
        raise

    except Exception as e:
        logger.error(
            f"Delete category error: {e}"
        )

        raise HTTPException(
            status_code=500,
            detail="Failed to delete category"
        )

# =====================================
# IMAGE UPLOAD
# =====================================

@fastapi_app.post("/upload-image")
async def upload_image(
    file: UploadFile = File(...),
    _: Dict[str, Any] = Depends(require_role(UserRole.ADMIN)),
):
    try:
        if file.content_type not in ALLOWED_IMAGE_TYPES:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Only image files are allowed. Supported: {', '.join(ALLOWED_IMAGE_TYPES)}"
            )

        filename = (file.filename or "").lower()
        if not any(filename.endswith(ext) for ext in ALLOWED_IMAGE_EXTENSIONS):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Invalid file extension. Supported: {', '.join(ALLOWED_IMAGE_EXTENSIONS)}"
            )

        file_content = await file.read()
        if not file_content:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Image file is empty",
            )
        if len(file_content) > MAX_FILE_SIZE:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"File size exceeds {MAX_FILE_SIZE // (1024*1024)}MB limit"
            )

        # Content-Type and extensions are client controlled.  Verify a
        # supported image signature before forwarding bytes to Cloudinary.
        image_signatures = {
            "image/jpeg": (b"\xff\xd8\xff",),
            "image/jpg": (b"\xff\xd8\xff",),
            "image/png": (b"\x89PNG\r\n\x1a\n",),
            "image/gif": (b"GIF87a", b"GIF89a"),
            "image/webp": (b"RIFF",),
        }
        signatures = image_signatures.get(file.content_type, ())
        if not any(file_content.startswith(signature) for signature in signatures):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="File contents do not match the declared image type",
            )
        if file.content_type == "image/webp" and file_content[8:12] != b"WEBP":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="File contents do not match the declared image type",
            )

        result = cloudinary.uploader.upload(
            file_content,
            resource_type="image",
        )

        logger.info(f"📷 Image uploaded: {result['secure_url']}")

        return {"image_url": result["secure_url"]}

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Image upload error: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Internal Server Error"
        )


# ============================================================
# VENDOR INVITATION AND ACTIVATION
# ============================================================

VENDOR_INVITATION_TTL_HOURS = 24
VENDOR_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
VENDOR_ACTIVATION_INVALID_MESSAGE = "Invalid or expired activation credentials."


def generate_vendor_id() -> str:
    return "VEN-" + "".join(
        secrets.choice(VENDOR_CODE_ALPHABET) for _ in range(6)
    )


def generate_activation_code() -> str:
    return "".join(
        secrets.choice(VENDOR_CODE_ALPHABET) for _ in range(6)
    )


def verify_activation_credentials(
    vendor_id: str,
    activation_code: str,
) -> Dict[str, Any]:
    def invalid():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=VENDOR_ACTIVATION_INVALID_MESSAGE,
        )

    invitation = vendor_invitations_collection.find_one(
        {"vendor_id": vendor_id.strip().upper()}
    )
    if (
        not invitation
        or invitation.get("used")
        or not isinstance(invitation.get("expires_at"), datetime)
        or invitation["expires_at"] <= datetime.utcnow()
    ):
        invalid()

    try:
        valid_code = verify_password(
            activation_code.strip().upper(),
            invitation.get("activation_code_hash", ""),
        )
    except Exception:
        valid_code = False
    if not valid_code:
        invalid()
    return invitation


@fastapi_app.post("/admin/vendors/invitations")
def create_vendor_invitation(
    data: VendorInvitationData,
    current_user: Dict[str, Any] = Depends(require_role(UserRole.ADMIN)),
):
    now = datetime.utcnow()
    email = normalize_email(str(data.email))
    if vendor_invitations_collection.find_one(
        {"email": email, "used": False, "expires_at": {"$gt": now}}
    ):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="An active vendor invitation already exists for this email.",
        )

    code = generate_activation_code()
    document = {
        "email": email,
        "business_name": data.business_name,
        "owner_name": data.owner_name,
        "phone": data.phone,
        "stall_ids": data.stall_ids,
        "activation_code_hash": hash_password(code),
        "expires_at": now + timedelta(hours=VENDOR_INVITATION_TTL_HOURS),
        "used": False,
        "created_by": current_user.get("email", ""),
        "created_at": now,
    }
    for _ in range(5):
        document["vendor_id"] = generate_vendor_id()
        try:
            vendor_invitations_collection.insert_one(document)
            logger.info(
                "Vendor invitation created: %s by %s",
                document["vendor_id"],
                current_user.get("email", ""),
            )
            # The code is intentionally returned only to the authenticated
            # administrator; there is no automatic email/SMS/WhatsApp send.
            return {
                "success": True,
                "vendor_id": document["vendor_id"],
                "activation_code": code,
                "expires_at": document["expires_at"].isoformat() + "Z",
                "business_name": document["business_name"],
                "owner_name": document["owner_name"],
                "email": email,
            }
        except DuplicateKeyError:
            continue
    raise HTTPException(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        detail="Failed to create a unique vendor invitation",
    )


@fastapi_app.post("/vendor/activate/verify")
@limiter.limit("5/minute")
def verify_vendor_activation(
    request: Request,
    data: VendorActivateVerifyData,
):
    invitation = verify_activation_credentials(
        data.vendor_id, data.activation_code
    )
    return {
        "valid": True,
        "vendor_id": invitation.get("vendor_id", ""),
        "business_name": invitation.get("business_name", ""),
        "owner_name": invitation.get("owner_name", ""),
        "email": invitation.get("email", ""),
    }


@fastapi_app.post("/vendor/activate")
@limiter.limit("5/minute")
def activate_vendor_account(
    request: Request,
    data: VendorActivateData,
):
    invitation = verify_activation_credentials(
        data.vendor_id, data.activation_code
    )
    email = normalize_email(str(invitation.get("email", "")))
    phone = str(invitation.get("phone", "")).strip()
    if users_collection.find_one({"email": email}) or (
        phone and users_collection.find_one({"phone": phone})
    ):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This email or phone is already associated with an account.",
        )

    # Atomic claim: concurrent requests cannot both consume an invitation.
    claim = vendor_invitations_collection.find_one_and_update(
        {
            "_id": invitation["_id"],
            "used": False,
            "expires_at": {"$gt": datetime.utcnow()},
        },
        {"$set": {"used": True, "used_at": datetime.utcnow()}},
    )
    if not claim:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=VENDOR_ACTIVATION_INVALID_MESSAGE,
        )

    vendor = {
        "name": invitation.get("owner_name") or invitation.get("business_name"),
        "email": email,
        "password": hash_password(data.password),
        "phone": phone,
        "vendor_id": invitation.get("vendor_id"),
        "role": UserRole.VENDOR,
        "auth_provider": "password",
        "profile_image": "",
        "wallet": 0,
        "wallet_history": [],
        "favorite_foods": [],
        "notifications": True,
        "fcm_token": "",
        "theme": "dark",
        "total_orders": 0,
        "total_spent": 0,
        "created_at": datetime.utcnow().isoformat(),
        "is_active": True,
    }
    try:
        users_collection.insert_one(vendor)
    except DuplicateKeyError:
        vendor_invitations_collection.update_one(
            {"_id": invitation["_id"], "used": True},
            {"$set": {"used": False, "used_at": None}},
        )
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This email or phone is already associated with an account.",
        )

    for stall_id in invitation.get("stall_ids", []):
        stalls_collection.update_one(
            {
                "_id": ObjectId(stall_id),
                "$or": [
                    {"owner_email": {"$in": ["", None]}},
                    {"owner_email": email},
                ],
            },
            {"$set": {"owner_email": email}},
        )
    logger.info("Vendor account activated: %s", invitation.get("vendor_id"))
    return {"success": True, "message": "Vendor account activated successfully."}


class CartSummaryItem(BaseModel):

    name: str = Field(..., min_length=1)

    quantity: int = Field(..., ge=1)

    stall_id: str = Field(..., min_length=1)

class CartSummaryRequest(BaseModel):

    items: list[CartSummaryItem] = Field(..., min_length=1)

@fastapi_app.post("/cart/summary")
def get_cart_summary(
    data: CartSummaryRequest,
):
    try:
        if not data.items:
            raise HTTPException(
                status_code=400,
                detail="Cart is empty",
            )

        # ---------------------------------------------------------
        # CONVERT CART SUMMARY ITEMS INTO THE SAME
        # ORDER ITEM MODEL USED BY THE AUTHORITATIVE BILL SYSTEM
        # ---------------------------------------------------------

        order_items = [
            OrderItemRequest(
                name=item.name,
                quantity=item.quantity,
                stall_id=item.stall_id,
            )
            for item in data.items
        ]

        print(
            "🛒 Cart summary items:",
            [
                {
                    "name": item.name,
                    "quantity": item.quantity,
                }
                for item in order_items
            ],
        )

        # ---------------------------------------------------------
        # SERVER-AUTHORITATIVE BILL
        # Prices are loaded from MongoDB.
        # Frontend prices are NOT trusted.
        # ---------------------------------------------------------

        bill = calculate_food_order_bill(
            order_items
        )

        print(
            "💰 Cart summary bill:",
            bill,
        )

        return {
            "success": True,
            **bill,
        }

    except HTTPException:
        raise

    except Exception as e:
        print(
            "❌ Cart summary error:",
            repr(e),
        )

        raise HTTPException(
            status_code=500,
            detail=f"Failed to calculate cart summary: {str(e)}",
        )

# ============================================================
# FOOD ORDER PAYMENT ROUTES
# Razorpay verified payment flow
#
# Flow:
# Cart
#   ↓
# Backend calculates authoritative bill
#   ↓
# Create Razorpay order
#   ↓
# Create signed order intent
#   ↓
# Frontend opens Razorpay
#   ↓
# Payment completed
#   ↓
# Backend verifies Razorpay signature + intent
#   ↓
# Create CampusVita order
# ============================================================

@fastapi_app.post("/create-razorpay-order")
@limiter.limit("10/minute")
def create_payment_order(
    request: Request,
    data: CreateFoodOrderData,
    current_user: Dict[str, Any] = Depends(get_current_user),
):
    try:
        # ========================================================
        # 1. AUTHENTICATED USER
        # ========================================================

        user_email = current_user.get("email")

        if not user_email:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Authenticated user email not found",
            )

        # ========================================================
        # 2. BASIC INPUT VALIDATION
        # ========================================================

        if not data.items:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Cart is empty",
            )

        if not data.name or not data.name.strip():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Name is required",
            )

        if not data.phone or not str(data.phone).strip():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Phone number is required",
            )

        # ========================================================
        # 3. CALCULATE BILL FROM BACKEND
        #
        # IMPORTANT:
        # calculate_food_order_bill() must be the authoritative
        # source for product prices, quantities, taxes,
        # delivery fee and final total.
        #
        # DO NOT trust price/total values sent by frontend.
        # ========================================================

        bill = calculate_food_order_bill(data.items)

        if not bill:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Unable to calculate order bill",
            )

        order_items = bill.get("items", [])
        total = bill.get("total", 0)

        if not order_items:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="No valid items found in cart",
            )

        # ========================================================
        # 4. VALIDATE FINAL TOTAL
        # ========================================================

        try:
            total = float(total)
        except (TypeError, ValueError):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid order total",
            )

        if total <= 0:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Order total must be greater than zero",
            )

        # Razorpay accepts amount in paise.
        amount_paise = int(round(total * 100))

        if amount_paise <= 0:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid payment amount",
            )

        # ========================================================
        # 5. CREATE RAZORPAY ORDER
        # ========================================================

        razorpay_order = razorpay_client.order.create(
            {
                "amount": amount_paise,
                "currency": "INR",
                "payment_capture": 1,
            }
        )

        razorpay_order_id = razorpay_order.get("id")

        if not razorpay_order_id:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="Razorpay order creation failed",
            )

        # ========================================================
        # 6. CREATE SIGNED PAYMENT INTENT
        #
        # This binds:
        # - authenticated user
        # - exact backend-priced items
        # - exact total
        # - customer information
        # - Razorpay order ID
        #
        # verify-payment should validate this intent before
        # creating the real CampusVita order.
        # ========================================================

        order_intent = create_signed_intent(
            "food_order",
            {
                "email": user_email,

                # Backend-authoritative items
                "items": order_items,

                # Backend-authoritative final amount
                "total": total,

# Immutable billing snapshot for future refund calculations.
"billing": {
    "subtotal": bill.get("subtotal", 0),
    "delivery_fee": bill.get("delivery_fee", 0),
    "tax_amount": bill.get("tax_amount", 0),
    "discount": bill.get("discount", 0),
    "total": bill.get("total", 0),
},
                # Customer information
                "name": data.name.strip(),
                "phone": str(data.phone).strip(),

                # Bind intent to this exact Razorpay order
                "razorpay_order_id": razorpay_order_id,
            },
        )

        # ========================================================
        # 7. LOG PAYMENT CREATION
        # ========================================================

        logger.info(
            "💰 Razorpay food order created | "
            f"razorpay_order_id={razorpay_order_id} | "
            f"user={user_email} | "
            f"amount={total}"
        )

        # ========================================================
        # 8. RETURN ONLY REQUIRED PAYMENT INFORMATION
        # ========================================================

        return {
            "success": True,

            # Razorpay information
            "order_id": razorpay_order_id,
            "amount": amount_paise,
            "currency": "INR",
            "key": RAZORPAY_KEY_ID,

            # Backend-calculated amount
            "total": total,

            # Signed intent required by verify-payment
            "order_intent": order_intent,
        }

    # ============================================================
    # EXPECTED FASTAPI ERRORS
    # ============================================================

    except HTTPException:
        raise

    # ============================================================
    # RAZORPAY / SERVER ERRORS
    # ============================================================

    except Exception as e:
        logger.exception(
            f"❌ Create Razorpay food order error: {e}"
        )

        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Unable to create payment order",
        )


@fastapi_app.post("/verify-payment")
async def verify_payment(
    data: VerifyPaymentData,
    current_user: Dict[str, Any] = Depends(get_current_user),
):
    try:
        # ========================================================
        # 1. DECODE SIGNED ORDER INTENT
        # ========================================================

        intent = decode_signed_intent(
            data.order_intent,
            "food_order",
        )

        # ========================================================
        # 2. VERIFY RAZORPAY ORDER ID
        # ========================================================

        if (
            intent.get("razorpay_order_id")
            != data.razorpay_order_id
        ):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Order reference does not match this payment",
            )

        # ========================================================
        # 3. VERIFY USER
        # ========================================================

        if (
            intent.get("email")
            != current_user.get("email")
        ):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="This order reference belongs to a different account",
            )

        # ========================================================
        # 4. PREVENT DUPLICATE PAYMENT
        # ========================================================

        if payments_collection.find_one(
            {
                "payment_id":
                data.razorpay_payment_id
            }
        ):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Payment already processed",
            )

        # ========================================================
        # 5. VERIFY RAZORPAY SIGNATURE
        # ========================================================

        razorpay_client.utility.verify_payment_signature(
            {
                "razorpay_order_id":
                    data.razorpay_order_id,

                "razorpay_payment_id":
                    data.razorpay_payment_id,

                "razorpay_signature":
                    data.razorpay_signature,
            }
        )

        # ========================================================
        # 6. CREATE CAMPUSVITA ORDER
        #
        # NO LOCATION FIELD
        # ========================================================

        order = {
    "items": intent["items"],

    "total": float(
        intent["total"]
    ),

    # Immutable billing snapshot captured when the Razorpay
    # payment intent was created.
    "billing": intent.get(
        "billing",
        {
            "subtotal": float(intent["total"]),
            "delivery_fee": 0.0,
            "tax_amount": 0.0,
            "discount": 0.0,
            "total": float(intent["total"]),
        },
    ),

    "email": intent["email"],

            "name": intent["name"],

            "phone": intent["phone"],

            "payment_method": "ONLINE",

            "payment_status":
                PaymentStatus.PAID,

            "payment_id":
                data.razorpay_payment_id,

            "razorpay_order_id":
                data.razorpay_order_id,

            "razorpay_signature":
                data.razorpay_signature,

            "payment_date":
                datetime.now().strftime(
                    "%d %b %Y, %I:%M %p"
                ),

            "payment_amount":
                float(intent["total"]),

            "status":
                OrderStatus.PREPARING,

            "created_at":
                datetime.now(),

            "date":
                datetime.now().strftime(
                    "%d %b %Y, %I:%M %p"
                ),

            "estimated_time":
                "15-20 mins",

            "pickup_code":
                random.randint(
                    1000,
                    9999,
                ),

            "token":
                get_next_token(),

            "user_email":
                current_user["email"],
        }
        order["stall_orders"] = build_stall_orders(order)

        # ========================================================
        # 7. SAVE ORDER
        # ========================================================

        try:
            result = orders_collection.insert_one(order)
        except DuplicateKeyError:
            # The unique Razorpay-order index is the concurrency boundary
            # for double submits.  Do not create a second order, increment
            # customer statistics, or add a second payment record.
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="This payment is already being processed",
            )

        saved_order = orders_collection.find_one(
            {
                "_id":
                result.inserted_id
            },
            {
                "_id": 0
            },
        )

        # ========================================================
        # 8. UPDATE USER STATISTICS
        # ========================================================

        users_collection.update_one(
            {
                "email":
                intent["email"]
            },
            {
                "$inc": {
                    "total_orders": 1,
                    "total_spent":
                        float(
                            intent["total"]
                        ),
                }
            },
        )

        # ========================================================
        # 9. CREATE PAYMENT RECORD
        # ========================================================

        payment = {
            "payment_id":
                data.razorpay_payment_id,

            # Real CampusVita MongoDB order ID
            "order_id":
                str(result.inserted_id),

            # Real Razorpay order ID
            "razorpay_order_id":
                data.razorpay_order_id,

            "email":
                intent["email"],

            "user_email":
                current_user["email"],

            "amount":
                float(intent["total"]),

            "currency":
                "INR",

            "status":
                PaymentStatus.PAID,

            "payment_method":
                "ONLINE",

            "purpose":
                "food_order",

            "payment_date":
                datetime.now(timezone.utc),

            "refund_status":
                None,

            "refund_amount":
                0.0,

            "refund_date":
                None,

            "refund_payment_id":
                None,

            # Backend auditing
            "razorpay_signature":
                data.razorpay_signature,
        }

        # ========================================================
        # 10. SAVE PAYMENT
        # ========================================================

        try:
            payments_collection.insert_one(payment)

        except DuplicateKeyError:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Payment already processed",
            )

        # ========================================================
        # 11. NOTIFY ADMIN / ORDER SYSTEM
        # ========================================================

        await safe_emit_order_update(
            saved_order
        )

        # ========================================================
        # 12. START ORDER FLOW
        # ========================================================

        threading.Thread(
            target=update_order_flow,
            args=(result.inserted_id,),
            daemon=True,
        ).start()

        logger.info(
            "✅ Payment verified: "
            f"{data.razorpay_payment_id}"
        )

        # ========================================================
        # 13. RESPONSE
        # ========================================================

        return {
            "success": True,

            "message":
                "Payment Verified Successfully",

            "payment_id":
                data.razorpay_payment_id,

            "order":
                saved_order,
        }

    except HTTPException:
        raise

    except Exception as e:
        logger.exception(
            f"❌ Verify payment error: {e}"
        )

        raise HTTPException(
            status_code=
                status.HTTP_500_INTERNAL_SERVER_ERROR,

            detail=
                "Internal Server Error",
        )
# =====================================
# ADMIN ROUTES (Protected)
# =====================================

@fastapi_app.get("/admin/orders")
def get_admin_orders(
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    search: str = "",
    status_filter: str = "ALL",
    payment_status: str = "ALL",
    _: Dict[str, Any] = Depends(require_role(UserRole.ADMIN)),
):
    try:
        query = {}

        # ============================================================
        # ORDER STATUS FILTER
        # ============================================================

        if (
            status_filter
            and status_filter.upper() != "ALL"
        ):
            query["status"] = status_filter

        # ============================================================
        # PAYMENT STATUS FILTER
        # ============================================================

        if (
            payment_status
            and payment_status.upper() != "ALL"
        ):
            query["payment_status"] = payment_status

        # ============================================================
        # SEARCH
        #
        # Searches REAL DATABASE fields:
        # - token
        # - MongoDB order ID
        # - name
        # - email
        # - user_email
        # ============================================================

        if search.strip():

            search_value = search.strip()

            search_conditions = [
                {
                    "name": {
                        "$regex": search_value,
                        "$options": "i",
                    }
                },
                {
                    "email": {
                        "$regex": search_value,
                        "$options": "i",
                    }
                },
                {
                    "user_email": {
                        "$regex": search_value,
                        "$options": "i",
                    }
                },
            ]

            # Search token when the search value is numeric.
            if search_value.isdigit():
                search_conditions.append(
                    {
                        "token": int(search_value)
                    }
                )

            # Search MongoDB ObjectId safely.
            try:
                search_conditions.append(
                    {
                        "_id": parse_object_id(
                            search_value
                        )
                    }
                )
            except Exception:
                pass

            query["$or"] = search_conditions

        # ============================================================
        # COUNT
        # ============================================================

        total = orders_collection.count_documents(
            query
        )

        skip = (page - 1) * limit

        # ============================================================
        # FETCH REAL ORDERS
        # ============================================================

        orders = list(
            orders_collection.find(query)
            .sort(
                [
                    ("token", -1),
                    ("_id", -1),
                ]
            )
            .skip(skip)
            .limit(limit)
        )

        # ============================================================
        # SERIALIZE MONGODB DATA
        # ============================================================

        response_orders = []

        for order in orders:

            order_id = str(
                order.get("_id")
            )

            order.pop("_id", None)

            # Convert datetime values to JSON-safe strings.
            for field in [
                "created_at",
                "payment_date",
            ]:
                value = order.get(field)

                if hasattr(value, "isoformat"):
                    order[field] = value.isoformat()

            order["order_id"] = order_id

            response_orders.append(order)

        # ============================================================
        # PAGINATION
        # ============================================================

        pages = (
            (total + limit - 1) // limit
            if total
            else 0
        )

        return {
            "success": True,
            "orders": response_orders,
            "page": page,
            "limit": limit,
            "total": total,
            "pages": pages,
        }

    except HTTPException:
        raise

    except Exception as e:

        logger.error(
            "Get admin orders error: %s",
            e,
        )

        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Internal Server Error",
        )

@fastapi_app.get("/admin/revenue-chart-data")
def get_revenue_chart_data(
    year: int | None = None,
    _: Dict[str, Any] = Depends(require_role(UserRole.ADMIN)),
):
    try:
        from datetime import datetime

        if year is None:
            year = datetime.now().year

        monthly_revenue = {
            month: 0.0
            for month in range(1, 13)
        }

        orders = orders_collection.find({
            "payment_status": PaymentStatus.PAID,
            "status": OrderStatus.COMPLETED,
        })

        for order in orders:
            order_date = order.get("date")

            if not order_date:
                continue

            parsed_date = None

            # MongoDB datetime
            if isinstance(order_date, datetime):
                parsed_date = order_date

            # String date
            elif isinstance(order_date, str):
                date_formats = [
                    "%d %b %Y, %I:%M %p",
                    "%Y-%m-%dT%H:%M:%S",
                    "%Y-%m-%dT%H:%M:%S.%f",
                    "%Y-%m-%d %H:%M:%S",
                    "%Y-%m-%d %H:%M",
                ]

                for date_format in date_formats:
                    try:
                        parsed_date = datetime.strptime(
                            order_date,
                            date_format,
                        )
                        break
                    except ValueError:
                        continue

                # ISO 8601 fallback
                if parsed_date is None:
                    try:
                        parsed_date = datetime.fromisoformat(
                            order_date.replace("Z", "+00:00")
                        )

                        if parsed_date.tzinfo:
                            parsed_date = parsed_date.replace(
                                tzinfo=None
                            )

                    except (ValueError, TypeError):
                        parsed_date = None

            if parsed_date is None:
                continue

            if parsed_date.year != year:
                continue

            try:
                total = float(order.get("total", 0) or 0)
            except (TypeError, ValueError):
                total = 0.0

            if total <= 0:
                continue

            monthly_revenue[parsed_date.month] += total

        months = [
            "Jan",
            "Feb",
            "Mar",
            "Apr",
            "May",
            "Jun",
            "Jul",
            "Aug",
            "Sep",
            "Oct",
            "Nov",
            "Dec",
        ]

        revenue = [
            {
                "month": months[month - 1],
                "revenue": round(
                    monthly_revenue[month],
                    2,
                ),
            }
            for month in range(1, 13)
        ]

        return {
            "success": True,
            "year": year,
            "revenue": revenue,
        }

    except Exception as e:
        logger.error(
            f"Revenue chart error: {e}"
        )

        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to load revenue chart data",
        )
    
@fastapi_app.get("/admin/top-selling-foods")
def get_top_selling_foods(
    month: str = Query(
        ...,
        pattern=r"^\d{4}-\d{2}$",
    ),
    _: Dict[str, Any] = Depends(
        require_role(UserRole.ADMIN)
    ),
):
    try:
        year, month_number = map(
            int,
            month.split("-"),
        )

        start_date = datetime(
            year,
            month_number,
            1,
        )

        if month_number == 12:
            end_date = datetime(
                year + 1,
                1,
                1,
            )
        else:
            end_date = datetime(
                year,
                month_number + 1,
                1,
            )

        orders = orders_collection.find({
            "status": OrderStatus.COMPLETED,
            "payment_status": PaymentStatus.PAID,
        })

        food_totals = {}

        for order in orders:

            order_date = order.get("date")

            if not order_date:
                continue

            parsed_date = None

            if isinstance(
                order_date,
                datetime,
            ):
                parsed_date = order_date

            elif isinstance(
                order_date,
                str,
            ):

                formats = [
                    "%d %b %Y, %I:%M %p",
                    "%Y-%m-%dT%H:%M:%S",
                    "%Y-%m-%dT%H:%M:%S.%f",
                    "%Y-%m-%d %H:%M:%S",
                    "%Y-%m-%d %H:%M",
                ]

                for date_format in formats:
                    try:
                        parsed_date = datetime.strptime(
                            order_date,
                            date_format,
                        )
                        break
                    except ValueError:
                        continue

                if parsed_date is None:
                    try:
                        parsed_date = datetime.fromisoformat(
                            order_date.replace(
                                "Z",
                                "+00:00",
                            )
                        )

                        if parsed_date.tzinfo:
                            parsed_date = parsed_date.replace(
                                tzinfo=None
                            )

                    except (
                        ValueError,
                        TypeError,
                    ):
                        parsed_date = None

            if parsed_date is None:
                continue

            if not (
                start_date
                <= parsed_date
                < end_date
            ):
                continue

            items = order.get(
                "items",
                [],
            )

            if not isinstance(
                items,
                list,
            ):
                continue

            for item in items:

                if not isinstance(
                    item,
                    dict,
                ):
                    continue

                food_name = item.get("name")

                if not food_name:
                    continue

                try:
                    quantity = int(
                        item.get(
                            "quantity",
                            0,
                        )
                    )
                except (
                    ValueError,
                    TypeError,
                ):
                    continue

                if quantity <= 0:
                    continue

                food_totals[food_name] = (
                    food_totals.get(
                        food_name,
                        0,
                    )
                    + quantity
                )

        if not food_totals:
            return {
                "success": True,
                "month": month,
                "foods": [],
                "total_quantity": 0,
            }

        total_quantity = sum(
            food_totals.values()
        )

        foods = []

        for name, quantity in (
            food_totals.items()
        ):
            percentage = round(
                (
                    quantity
                    / total_quantity
                ) * 100,
                1,
            )

            foods.append({
                "name": name,
                "quantity": quantity,
                "percentage": percentage,
            })

        foods.sort(
            key=lambda food: food["quantity"],
            reverse=True,
        )

        return {
            "success": True,
            "month": month,
            "foods": foods,
            "total_quantity": total_quantity,
        }

    except Exception as e:
        logger.error(
            f"Top selling foods error: {e}"
        )

        raise HTTPException(
            status_code=500,
            detail="Internal Server Error",
        )

@fastapi_app.get("/admin/sales-distribution")
def get_sales_distribution(
    month: str,
    _: Dict[str, Any] = Depends(
        require_role(UserRole.ADMIN)
    ),
):
    try:
        # -----------------------------------------
        # Validate month
        # -----------------------------------------
        try:
            selected_month = datetime.strptime(
                month,
                "%Y-%m",
            )
        except (ValueError, TypeError):
            raise HTTPException(
                status_code=400,
                detail="Invalid month format. Use YYYY-MM",
            )

        # -----------------------------------------
        # Get completed + paid orders
        # -----------------------------------------
        orders = list(
            orders_collection.find({
                "status": OrderStatus.COMPLETED,
                "payment_status": PaymentStatus.PAID,
            })
        )

        category_quantities = {}

        # -----------------------------------------
        # Process orders
        # -----------------------------------------
        for order in orders:

            order_date = order.get("date")

            if not order_date:
                continue

            parsed_date = None

            # Mongo datetime
            if isinstance(order_date, datetime):
                parsed_date = order_date

            # String date
            elif isinstance(order_date, str):

                date_formats = [
                    "%d %b %Y, %I:%M %p",
                    "%Y-%m-%dT%H:%M:%S",
                    "%Y-%m-%dT%H:%M:%S.%f",
                    "%Y-%m-%d %H:%M:%S",
                    "%Y-%m-%d %H:%M",
                ]

                for date_format in date_formats:
                    try:
                        parsed_date = datetime.strptime(
                            order_date,
                            date_format,
                        )
                        break
                    except ValueError:
                        continue

                if parsed_date is None:
                    try:
                        parsed_date = datetime.fromisoformat(
                            order_date.replace(
                                "Z",
                                "+00:00",
                            )
                        )

                        if parsed_date.tzinfo:
                            parsed_date = parsed_date.replace(
                                tzinfo=None
                            )

                    except (ValueError, TypeError):
                        parsed_date = None

            if parsed_date is None:
                continue

            # -------------------------------------
            # Selected month only
            # -------------------------------------
            if (
                parsed_date.year
                != selected_month.year
                or
                parsed_date.month
                != selected_month.month
            ):
                continue

            # -------------------------------------
            # Process items
            # -------------------------------------
            items = order.get("items", [])

            if not isinstance(items, list):
                continue

            for item in items:

                if not isinstance(item, dict):
                    continue

                food_name = item.get("name")

                if not food_name:
                    continue

                try:
                    quantity = int(
                        item.get("quantity", 0)
                    )
                except (TypeError, ValueError):
                    continue

                if quantity <= 0:
                    continue

                category = item.get("category")

                # ---------------------------------
                # If order item already has category
                # use it directly.
                # ---------------------------------
                if category:
                    category = str(category).strip()

                # ---------------------------------
                # Otherwise find food in database.
                # ---------------------------------
                if not category:

                    food = foods_collection.find_one({
                        "name": food_name
                    })

                    # Case-insensitive fallback
                    if not food:
                        food = foods_collection.find_one({
                            "name": {
                                "$regex": f"^{str(food_name).strip()}$",
                                "$options": "i",
                            }
                        })

                    if food:
                        category = food.get("category")

                if not category:
                    continue

                category = str(category).strip()

                if not category:
                    continue

                category_quantities[category] = (
                    category_quantities.get(
                        category,
                        0,
                    )
                    + quantity
                )

        # -----------------------------------------
        # No data
        # -----------------------------------------
        if not category_quantities:
            return {
                "success": True,
                "month": month,
                "total_quantity": 0,
                "categories": [],
            }

        # -----------------------------------------
        # Calculate total
        # -----------------------------------------
        total_quantity = sum(
            category_quantities.values()
        )

        categories = []

        for category, quantity in (
            category_quantities.items()
        ):
            percentage = (
                quantity / total_quantity
            ) * 100

            categories.append({
                "name": category,
                "quantity": quantity,
                "percentage": round(
                    percentage,
                    1,
                ),
            })

        categories.sort(
            key=lambda item: item["quantity"],
            reverse=True,
        )

        return {
            "success": True,
            "month": month,
            "total_quantity": total_quantity,
            "categories": categories,
        }

    except HTTPException:
        raise

    except Exception as e:
        logger.error(
            f"Sales distribution error: {e}"
        )

        raise HTTPException(
            status_code=500,
            detail="Failed to calculate sales distribution",
        )
    
@fastapi_app.get("/admin/order-chart-data")
def get_admin_order_chart_data(
    _: Dict[str, Any] = Depends(
        require_role(UserRole.ADMIN)
    ),
):
    try:
        orders = list(
            orders_collection.find(
                {},
                {
                    "_id": 1,
                    "date": 1,
                    "status": 1,
                },
            )
        )

        result = []

        for order in orders:
            order_date = order.get("date")

            if not order_date:
                continue

            if isinstance(order_date, datetime):
                date_value = order_date.isoformat()

            else:
                date_value = str(order_date)

            result.append({
                "order_id": str(order["_id"]),
                "date": date_value,
                "status": order.get("status"),
            })

        return {
            "success": True,
            "orders": result,
        }

    except Exception as e:
        logger.error(
            f"Order chart data error: {e}"
        )

        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to fetch order chart data",
        )
    
@fastapi_app.get("/admin/orders/{order_id}")
def get_admin_order(order_id: str, _: Dict[str, Any] = Depends(require_role(UserRole.ADMIN))):
    try:
        order = orders_collection.find_one({"_id": parse_object_id(order_id)})

        if not order:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Order not found"
            )

        order["order_id"] = str(order["_id"])
        del order["_id"]

        return order

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Get admin order error: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Internal Server Error"
        )


@fastapi_app.put("/admin/orders/{token}")
async def admin_update_order_status(token: int, data: StatusUpdate, _: Dict[str, Any] = Depends(require_role(UserRole.ADMIN))):
    try:
        existing_order = orders_collection.find_one({"token": token})
        if not existing_order:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Order with token #{token} not found"
            )

        orders_collection.update_one(
            {"token": token},
            {"$set": {"status": data.status}}
        )

        updated_order = orders_collection.find_one({"token": token})
        updated_order["order_id"] = str(updated_order["_id"])
        del updated_order["_id"]

        await safe_emit_order_update(updated_order)

        logger.info(f"✅ Admin updated order #{token} to {data.status}")

        return {
            "success": True,
            "message": f"Order #{token} status updated to {data.status}",
            "order": updated_order
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Admin update order error: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Internal Server Error"
        )

@fastapi_app.get("/admin/recent-orders")
def get_recent_orders(
    page: int = Query(1, ge=1),
    limit: int = Query(5, ge=1),
    search: str = "",
    status: str = "All",
    sortBy: str = "token",
    sortOrder: str = "desc",
    current_user=Depends(require_role("ADMIN"))
):
    query = {}

    if status != "All":
        query["status"] = status

    if search:
        query["name"] = {
            "$regex": search,
            "$options": "i"
        }

    allowed_fields = {
        "token",
        "name",
        "total",
        "status",
        "date",
    }

    if sortBy not in allowed_fields:
        sortBy = "token"

    direction = -1 if sortOrder == "desc" else 1

    total = orders_collection.count_documents(query)

    cursor = (
        orders_collection.find(query)
        .sort(sortBy, direction)
        .skip((page - 1) * limit)
        .limit(limit)
    )

    orders = []

    for order in cursor:
        orders.append({
            "token": order.get("token"),
            "name": order.get("name"),
            "total": order.get("total"),
            "status": order.get("status"),
            "date": order.get("date"),
        })

    return {
        "orders": orders,
        "page": page,
        "limit": limit,
        "total": total,
        "totalPages": (total + limit - 1) // limit,
    }

@fastapi_app.get("/admin/dashboard")
def admin_dashboard(
    _: Dict[str, Any] = Depends(require_role(UserRole.ADMIN))
):
    try:
        total_orders = orders_collection.count_documents({})

        completed_orders = orders_collection.count_documents({
            "status": OrderStatus.COMPLETED
        })

        pending_orders = orders_collection.count_documents({
            "status": {
                "$in": [
                    OrderStatus.PREPARING,
                    OrderStatus.COOKING,
                    OrderStatus.READY_FOR_PICKUP
                ]
            }
        })
                # Calculate the busiest ordering hour from completed orders
        peak_hour_pipeline = [
            {
                "$match": {
                    "status": OrderStatus.COMPLETED,
                    "date": {"$exists": True, "$ne": None}
                }
            },
            {
                "$addFields": {
                    "order_datetime": {
                        "$dateFromString": {
                            "dateString": "$date",
                            "format": "%d %b %Y, %H:%M",
                            "onError": None,
                            "onNull": None
                        }
                    }
                }
            },
            {
                "$match": {
                    "order_datetime": {"$ne": None}
                }
            },
            {
                "$group": {
                    "_id": {
                        "$hour": "$order_datetime"
                    },
                    "count": {"$sum": 1}
                }
            },
            {
                "$sort": {
                    "count": -1,
                    "_id": 1
                }
            },
            {
                "$limit": 1
            }
        ]

        peak_hour_result = list(
            orders_collection.aggregate(peak_hour_pipeline)
        )

        if peak_hour_result:
            peak_hour = peak_hour_result[0]["_id"]

            start_period = "AM" if peak_hour < 12 else "PM"

            display_hour = peak_hour % 12
            if display_hour == 0:
                display_hour = 12

            next_hour = (peak_hour + 1) % 24
            next_display_hour = next_hour % 12

            if next_display_hour == 0:
                next_display_hour = 12

            next_period = "AM" if next_hour < 12 else "PM"

            peak_ordering_hours = (
                f"{display_hour}:00 {start_period} – "
                f"{next_display_hour}:00 {next_period}"
            )
        else:
            peak_ordering_hours = "No data"
        # -----------------------------------------
        # ALL-TIME REVENUE
        # -----------------------------------------
        revenue_pipeline = [
            {
                "$match": {
                    "payment_status": PaymentStatus.PAID
                }
            },
            {
                "$group": {
                    "_id": None,
                    "total": {
                        "$sum": "$total"
                    }
                }
            }
        ]

        revenue_result = list(
            orders_collection.aggregate(revenue_pipeline)
        )

        total_revenue = (
            revenue_result[0]["total"]
            if revenue_result
            else 0
        )

        # -----------------------------------------
        # TODAY'S REVENUE
        # -----------------------------------------
        now = datetime.now()

        start_of_day = now.replace(
            hour=0,
            minute=0,
            second=0,
            microsecond=0
        )

        end_of_day = start_of_day + timedelta(days=1)

        today_revenue_pipeline = [
            {
                "$match": {
                    "payment_status": PaymentStatus.PAID,
                    "created_at": {
                        "$gte": start_of_day,
                        "$lt": end_of_day
                    }
                }
            },
            {
                "$group": {
                    "_id": None,
                    "total": {
                        "$sum": "$total"
                    }
                }
            }
        ]

        today_revenue_result = list(
            orders_collection.aggregate(
                today_revenue_pipeline
            )
        )

        today_revenue = (
            today_revenue_result[0]["total"]
            if today_revenue_result
            else 0
        )

        return {
            "total_orders": total_orders,
            "total_revenue": total_revenue,
            "today_revenue": today_revenue,
            "pending_orders": pending_orders,
            "completed_orders": completed_orders,
            "peak_ordering_hours": peak_ordering_hours,
        }

    except Exception as e:
        logger.error(
            f"Admin dashboard error: {e}"
        )

        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Internal Server Error"
        )
# ============================================================
# ADMIN CUSTOMER MANAGEMENT
# ============================================================

@fastapi_app.get("/admin/customers")
def get_admin_customers(
    page: int = Query(1, ge=1),
    limit: int = Query(10, ge=1, le=100),
    search: str = "",
    status_filter: str = "ALL",
    sort: str = "LATEST",
    _: Dict[str, Any] = Depends(
        require_role(UserRole.ADMIN)
    ),
):
    try:
        # ========================================================
        # 1. GET ONLY CUSTOMER ACCOUNTS
        # ========================================================

        customer_query: Dict[str, Any] = {
            "role": UserRole.USER
        }

        # ========================================================
        # 2. SEARCH
        # ========================================================

        search_value = search.strip()

        if search_value:
            customer_query["$or"] = [
                {
                    "name": {
                        "$regex": search_value,
                        "$options": "i",
                    }
                },
                {
                    "email": {
                        "$regex": search_value,
                        "$options": "i",
                    }
                },
                {
                    "phone": {
                        "$regex": search_value,
                        "$options": "i",
                    }
                },
            ]

        # ========================================================
        # 3. GET USERS
        # ========================================================

        users = list(
            users_collection.find(
                customer_query,
                {
                    "_id": 1,
                    "name": 1,
                    "email": 1,
                    "phone": 1,
                    "profile_image": 1,
                    "role": 1,
                    "created_at": 1,
                },
            )
        )

        customers = []

        # ========================================================
        # 4. BUILD CUSTOMER DATA
        # ========================================================

        for user in users:

            raw_email = user.get("email", "")

            email = normalize_email(raw_email)

            if not email:
                continue

            # ----------------------------------------------------
            # ORDERS BELONGING TO CUSTOMER
            # ----------------------------------------------------

            order_query = {
                "$or": [
                    {
                        "user_email": email
                    },
                    {
                        "email": email
                    },
                ]
            }

            customer_orders = list(
                orders_collection.find(
                    order_query,
                    {
                        "_id": 0,
                        "order_id": 1,
                        "token": 1,
                        "total": 1,
                        "payment_amount": 1,
                        "status": 1,
                        "date": 1,
                        "created_at": 1,
                    },
                )
                .sort(
                    [
                        ("created_at", -1),
                        ("date", -1),
                    ]
                )
                .limit(5)
            )

            # ----------------------------------------------------
            # TOTAL ORDERS
            # ----------------------------------------------------

            total_orders = orders_collection.count_documents(
                order_query
            )

            # ----------------------------------------------------
            # COMPLETED ORDERS
            # ----------------------------------------------------

            completed_orders = orders_collection.count_documents(
                {
                    "$and": [
                        order_query,
                        {
                            "status": {
                                "$regex": "^completed$",
                                "$options": "i",
                            }
                        },
                    ]
                }
            )

            # ----------------------------------------------------
            # PENDING ORDERS
            # ----------------------------------------------------

            pending_orders = orders_collection.count_documents(
                {
                    "$and": [
                        order_query,
                        {
                            "status": {
                                "$regex": "^pending$",
                                "$options": "i",
                            }
                        },
                    ]
                }
            )

            # ----------------------------------------------------
            # TOTAL SPENT
            # ----------------------------------------------------

            spending_pipeline = [
                {
                    "$match": order_query
                },
                {
                    "$group": {
                        "_id": None,
                        "total": {
                            "$sum": {
                                "$convert": {
                                    "input": {
                                        "$ifNull": [
                                            "$payment_amount",
                                            "$total",
                                        ]
                                    },
                                    "to": "double",
                                    "onError": 0,
                                    "onNull": 0,
                                }
                            }
                        },
                    },
                },
            ]

            spending_result = list(
                orders_collection.aggregate(
                    spending_pipeline
                )
            )

            total_spent = (
                spending_result[0]["total"]
                if spending_result
                else 0
            )

            # ----------------------------------------------------
            # PAYMENTS
            # ----------------------------------------------------

            payment_query = {
                "$or": [
                    {
                        "user_email": email
                    },
                    {
                        "email": email
                    },
                ]
            }

            total_payments = payments_collection.count_documents(
                payment_query
            )

            # ----------------------------------------------------
            # CUSTOMER STATUS
            # ----------------------------------------------------
            #
            # Your current users collection does not have a
            # reliable active/inactive field.
            #
            # Therefore we do not invent a database value.
            #
            # Customers with at least one order are displayed
            # as Active. Customers without orders are displayed
            # as Inactive.
            # ----------------------------------------------------

            customer_status = (
                "Active"
                if total_orders > 0
                else "Inactive"
            )

            # ----------------------------------------------------
            # RECENT ORDERS
            # ----------------------------------------------------

            recent_orders = []

            for order in customer_orders:

                order_total = (
                    order.get("payment_amount")
                    if order.get("payment_amount") is not None
                    else order.get("total", 0)
                )

                try:
                    order_total = float(order_total or 0)
                except Exception:
                    order_total = 0

                recent_orders.append(
                    {
                        "order_id": (
                            order.get("order_id")
                            or order.get("token")
                            or ""
                        ),
                        "token": order.get(
                            "token",
                            ""
                        ),
                        "amount": order_total,
                        "status": order.get(
                            "status",
                            ""
                        ),
                        "date": (
                            order.get("date")
                            or order.get("created_at")
                            or ""
                        ),
                    }
                )

            # ----------------------------------------------------
            # CUSTOMER OBJECT
            # ----------------------------------------------------

            customers.append(
                {
                    "id": str(
                        user.get("_id")
                    ),

                    "name": user.get(
                        "name",
                        ""
                    ),

                    "email": email,

                    "phone": user.get(
                        "phone",
                        ""
                    ),

                    "profile_image": user.get(
                        "profile_image",
                        ""
                    ),

                    "total_orders": total_orders,

                    "completed_orders": (
                        completed_orders
                    ),

                    "pending_orders": (
                        pending_orders
                    ),

                    "total_spent": round(
                        float(
                            total_spent or 0
                        ),
                        2,
                    ),

                    "total_payments": (
                        total_payments
                    ),

                    "status": customer_status,

                    "joined_at": user.get(
                        "created_at"
                    ),

                    "recent_orders": recent_orders,
                }
            )

        # ========================================================
        # 5. STATUS FILTER
        # ========================================================

        if status_filter.upper() in [
            "ACTIVE",
            "INACTIVE",
        ]:

            customers = [
                customer
                for customer in customers
                if customer["status"].upper()
                == status_filter.upper()
            ]

        # ========================================================
        # 6. SORT
        # ========================================================

        sort_value = sort.upper()

        if sort_value == "NAME_ASC":

            customers.sort(
                key=lambda customer:
                customer.get(
                    "name",
                    ""
                ).lower()
            )

        elif sort_value == "NAME_DESC":

            customers.sort(
                key=lambda customer:
                customer.get(
                    "name",
                    ""
                ).lower(),
                reverse=True,
            )

        elif sort_value == "SPENDING_HIGH":

            customers.sort(
                key=lambda customer:
                customer.get(
                    "total_spent",
                    0
                ),
                reverse=True,
            )

        elif sort_value == "SPENDING_LOW":

            customers.sort(
                key=lambda customer:
                customer.get(
                    "total_spent",
                    0
                )
            )

        elif sort_value == "ORDERS_HIGH":

            customers.sort(
                key=lambda customer:
                customer.get(
                    "total_orders",
                    0
                ),
                reverse=True,
            )

        else:

            customers.sort(
                key=lambda customer:
                str(
                    customer.get(
                        "joined_at"
                    )
                    or ""
                ),
                reverse=True,
            )

        # ========================================================
        # 7. STATISTICS
        # ========================================================

        # Get all real customer accounts for statistics.
        all_customer_count = users_collection.count_documents(
            {
                "role": UserRole.USER
            }
        )

        # Customers who have at least one order.
        customers_with_orders = sum(
            1
            for customer in customers
            if customer["total_orders"] > 0
        )

        # Active customers are currently defined as customers
        # who have at least one order.
        active_customers = sum(
            1
            for customer in customers
            if customer["status"] == "Active"
        )

        total_orders = sum(
            customer["total_orders"]
            for customer in customers
        )

        total_spent = sum(
            customer["total_spent"]
            for customer in customers
        )

        total_payments = sum(
            customer["total_payments"]
            for customer in customers
        )

        # ========================================================
        # 8. NEW CUSTOMERS
        # ========================================================

        new_customers = 0

        now = datetime.now()

        for customer in customers:

            joined_at = customer.get(
                "joined_at"
            )

            if not joined_at:
                continue

            try:

                if isinstance(
                    joined_at,
                    datetime
                ):

                    if (
                        joined_at.year
                        == now.year
                        and joined_at.month
                        == now.month
                    ):
                        new_customers += 1

                elif isinstance(
                    joined_at,
                    str
                ):

                    parsed_date = None

                    for date_format in [
                        "%Y-%m-%d %H:%M:%S",
                        "%Y-%m-%d",
                        "%d %b %Y, %I:%M %p",
                    ]:

                        try:
                            parsed_date = (
                                datetime.strptime(
                                    joined_at,
                                    date_format
                                )
                            )
                            break

                        except Exception:
                            continue

                    if (
                        parsed_date
                        and parsed_date.year
                        == now.year
                        and parsed_date.month
                        == now.month
                    ):
                        new_customers += 1

            except Exception:
                continue

        # ========================================================
        # 9. PAGINATION
        # ========================================================

        total = len(customers)

        pages = (
            (total + limit - 1) // limit
            if total
            else 0
        )

        skip = (
            (page - 1) * limit
        )

        paginated_customers = customers[
            skip:skip + limit
        ]

        # ========================================================
        # 10. RESPONSE
        # ========================================================

        return {
            "success": True,

            "customers":
                paginated_customers,

            "page":
                page,

            "limit":
                limit,

            "total":
                total,

            "pages":
                pages,

            "statistics": {
                "total_customers":
                    all_customer_count,

                "active_customers":
                    active_customers,

                "new_customers":
                    new_customers,

                "customers_with_orders":
                    customers_with_orders,

                "total_orders":
                    total_orders,

                "total_spent":
                    round(
                        total_spent,
                        2
                    ),

                "total_payments":
                    total_payments,
            },
        }

    except HTTPException:
        raise

    except Exception as e:

        logger.error(
            f"Admin customers error: {e}"
        )

        raise HTTPException(
            status_code=
                status.HTTP_500_INTERNAL_SERVER_ERROR,

            detail=
                "Failed to load customers",
        )

@fastapi_app.get("/admin/users")
def get_admin_users(
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    _: Dict[str, Any] = Depends(require_role(UserRole.ADMIN)),
):
    try:
        total = users_collection.count_documents({})
        skip = (page - 1) * limit

        users = list(
            users_collection.find(
                {},
                {"_id": 0, "password": 0, "refresh_token_hash": 0}
            )
            .sort("created_at", -1)
            .skip(skip)
            .limit(limit)
        )

        pages = (total + limit - 1) // limit if total else 0

        return {
            "success": True,
            "users": users,
            "page": page,
            "limit": limit,
            "total": total,
            "pages": pages,
        }

    except Exception as e:
        logger.error(f"Get admin users error: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Internal Server Error"
        )


@fastapi_app.put("/admin/users/{email}/role")
def update_user_role(email: str, role: str, _: Dict[str, Any] = Depends(require_role(UserRole.ADMIN))):
    try:
        if role not in [UserRole.ADMIN, UserRole.USER, UserRole.VENDOR]:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid role"
            )

        result = users_collection.update_one(
            {"email": normalize_email(email)},
            {"$set": {"role": role}}
        )

        if result.matched_count == 0:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="User not found"
            )

        logger.info(f"👤 User role updated: {email} → {role}")

        return {
            "success": True,
            "message": f"User role updated to {role}"
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Update user role error: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Internal Server Error"
        )


@fastapi_app.post("/admin/wallet/adjust")
def admin_adjust_wallet(data: AdminWalletAdjustData, current_user: Dict[str, Any] = Depends(require_role(UserRole.ADMIN))):
    try:
        email = normalize_email(data.email)
        target_user = users_collection.find_one({"email": email})

        if not target_user:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="User not found"
            )

        if data.type == "debit" and target_user.get("wallet", 0) < data.amount:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Insufficient wallet balance to debit"
            )

        delta = data.amount if data.type == "credit" else -data.amount

        users_collection.update_one(
            {"email": email},
            {
                "$inc": {"wallet": delta},
                "$push": {
                    "wallet_history": {
                        "type": data.type,
                        "amount": data.amount,
                        "reason": f"Admin adjustment: {data.reason}",
                        "adjusted_by": current_user["email"],
                        "date": datetime.now().strftime("%d %b %Y, %I:%M %p"),
                    }
                },
            },
        )

        logger.info(f"🛠️ Admin {current_user['email']} applied {data.type} of ₹{data.amount} to {email}")

        return {
            "success": True,
            "message": f"Wallet {data.type} applied successfully"
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Admin wallet adjust error: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Internal Server Error"
        )


# =====================================
# NOTIFICATION ROUTE
# =====================================

@fastapi_app.get("/send-test-notification")
def send_test_notification(current_user: Dict[str, Any] = Depends(require_role(UserRole.ADMIN))):
    if not FCM_TOKEN:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="FCM token not configured"
        )

    try:
        message = messaging.Message(
            notification=messaging.Notification(
                title="CampusVita",
                body=f"Test notification for {current_user['email']} 🚀",
            ),
            token=FCM_TOKEN,
        )

        response = messaging.send(message)

        logger.info(f"📱 Notification sent: {response}")

        return {"success": True, "response": response}

    except Exception as e:
        logger.error(f"Send notification error: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Internal Server Error"
        )


# =====================================
# STATIC FILES
# =====================================

if not os.path.exists("uploads"):
    os.makedirs("uploads")

# ============================================================
# STATIC FILES
# ============================================================

UPLOADS_DIR = BASE_DIR / "uploads"

UPLOADS_DIR.mkdir(
    parents=True,
    exist_ok=True
)

fastapi_app.mount(

    "/uploads",

    StaticFiles(directory=str(BASE_DIR / "uploads")),

    name="uploads",

)

logger.info(
    f"📂 Static uploads directory: {UPLOADS_DIR}"
)

@fastapi_app.websocket("/ws/admin/orders")
async def admin_orders_socket(websocket: WebSocket):
    # Browsers cannot attach an Authorization header to a native
    # WebSocket handshake.  The access token is therefore carried as the
    # second negotiated subprotocol and is never placed in a URL or log.
    protocol_values = [
        value.strip()
        for value in websocket.headers.get(
            "sec-websocket-protocol", ""
        ).split(",")
        if value.strip()
    ]
    if len(protocol_values) != 2 or protocol_values[0] != "campusvita-v1":
        await websocket.close(code=1008)
        return

    try:
        payload = verify_token(protocol_values[1])
        if payload.get("type") != "access":
            raise HTTPException(status_code=401, detail="Invalid token type")

        email = normalize_email(str(payload.get("email") or ""))
        user = users_collection.find_one({"email": email}) if email else None
        if (
            not user
            or not user.get("is_active", True)
            or str(user.get("role", "")).upper() != UserRole.ADMIN
        ):
            raise HTTPException(status_code=403, detail="Admin access required")
    except HTTPException:
        await websocket.close(code=1008)
        return

    await manager.connect(websocket, subprotocol="campusvita-v1")

    try:

        while True:

            # keep the socket alive

            await asyncio.sleep(30)

            await websocket.send_json({

                "event": "ping"

            })

    except WebSocketDisconnect:

        manager.disconnect(websocket)

    except Exception as e:

        print("WebSocket Error:", e)

        manager.disconnect(websocket)

@fastapi_app.get("/admin/payments")
def get_admin_payments(
    page: int = Query(1, ge=1),
    limit: int = Query(10, ge=1, le=100),
    search: str = "",
    status_filter: str = "ALL",
    payment_method: str = "ALL",
    _: Dict[str, Any] = Depends(
        require_role(UserRole.ADMIN)
    ),
):
    try:
        # ============================================================
        # 1. BUILD DATABASE QUERY
        # ============================================================

        query: Dict[str, Any] = {}

        # ------------------------------------------------------------
        # Payment status filter
        # ------------------------------------------------------------

        if status_filter and status_filter.upper() != "ALL":
            query["status"] = status_filter

        logger.info(
            "PAYMENT STATUS FILTER RECEIVED: %r",
            status_filter,
        )

        # ------------------------------------------------------------
        # Payment method filter
        # ------------------------------------------------------------

        if payment_method and payment_method.upper() != "ALL":
            query["payment_method"] = payment_method

        # ------------------------------------------------------------
        # Search
        #
        # Search by:
        # - payment_id
        # - order_id
        # - customer name
        # - customer email
        # ------------------------------------------------------------

        if search and search.strip():
            search_value = search.strip()

            # --------------------------------------------------------
            # Find users matching name/email
            # --------------------------------------------------------

            matching_users = users_collection.find(
                {
                    "$or": [
                        {
                            "name": {
                                "$regex": search_value,
                                "$options": "i",
                            }
                        },
                        {
                            "email": {
                                "$regex": search_value,
                                "$options": "i",
                            }
                        },
                    ]
                },
                {
                    "email": 1,
                    "_id": 0,
                },
            )

            matching_emails = [
                user["email"]
                for user in matching_users
                if user.get("email")
            ]

            # --------------------------------------------------------
            # Payment search conditions
            # --------------------------------------------------------

            search_conditions = [
                {
                    "payment_id": {
                        "$regex": search_value,
                        "$options": "i",
                    }
                },
                {
                    "order_id": {
                        "$regex": search_value,
                        "$options": "i",
                    }
                },
                {
                    "user_email": {
                        "$regex": search_value,
                        "$options": "i",
                    }
                },
                {
                    "email": {
                        "$regex": search_value,
                        "$options": "i",
                    }
                },
            ]

            # --------------------------------------------------------
            # Add matching customer emails
            # --------------------------------------------------------

            if matching_emails:
                search_conditions.append(
                    {
                        "user_email": {
                            "$in": matching_emails
                        }
                    }
                )

                search_conditions.append(
                    {
                        "email": {
                            "$in": matching_emails
                        }
                    }
                )

            query["$or"] = search_conditions

        # ------------------------------------------------------------
        # Debug logging
        # ------------------------------------------------------------

        logger.info(
            "PAYMENT FILTER DEBUG: status=%r method=%r query=%r",
            status_filter,
            payment_method,
            query,
        )

        # ============================================================
        # 2. COUNT REAL PAYMENTS
        # ============================================================

        total = payments_collection.count_documents(query)

        skip = (page - 1) * limit

        # ============================================================
        # 3. FETCH REAL PAYMENTS
        # ============================================================

        payments = list(
            payments_collection.find(query)
            .sort(
                [
                    ("payment_date", -1),
                    ("_id", -1),
                ]
            )
            .skip(skip)
            .limit(limit)
        )

        # ============================================================
        # 4. REMOVE DUPLICATE PAYMENT IDS
        # ============================================================

        seen_payment_ids = set()
        unique_payments = []

        for payment in payments:

            payment_id = payment.get("payment_id")

            # --------------------------------------------------------
            # Ignore records without payment_id
            # --------------------------------------------------------

            if not payment_id:
                continue

            # --------------------------------------------------------
            # Prevent duplicate payment IDs
            # --------------------------------------------------------

            if payment_id in seen_payment_ids:
                continue

            seen_payment_ids.add(payment_id)

            # ========================================================
            # 5. FIND REAL CUSTOMER
            # ========================================================

            email = (
                payment.get("user_email")
                or payment.get("email")
            )

            customer = None

            if email:
                customer = users_collection.find_one(
                    {"email": email},
                    {
                        "_id": 0,
                        "name": 1,
                        "email": 1,
                        "phone": 1,
                    },
                )

            # ========================================================
            # 6. FIND REAL ORDER
            # ========================================================

            order = None

            order_id = payment.get("order_id")

            if order_id:

                try:
                    order = orders_collection.find_one(
                        {
                            "$or": [
                                {
                                    "order_id": str(order_id)
                                },
                                {
                                    "razorpay_order_id": str(
                                        order_id
                                    )
                                },
                            ]
                        },
                        {
                            "_id": 0,
                            "order_id": 1,
                            "razorpay_order_id": 1,
                            "token": 1,
                            "items": 1,
                            "total": 1,
                            "status": 1,
                            "payment_method": 1,
                            "payment_status": 1,
                            "date": 1,
                        },
                    )

                except Exception as e:
                    logger.error(
                        "Order lookup failed for %s: %s",
                        order_id,
                        e,
                        exc_info=True,
                    )

                    order = None

            # ========================================================
            # 7. BUILD API RESPONSE
            # ========================================================

            unique_payments.append(
                {
                    "database_id": str(
                        payment["_id"]
                    ),

                    "payment_id": payment.get(
                        "payment_id"
                    ),

                    "order_id": payment.get(
                        "order_id"
                    ),

                    "razorpay_order_id": payment.get(
                        "razorpay_order_id"
                    ),

                    "customer": customer,

                    "amount": float(
                        payment.get(
                            "amount",
                            0,
                        )
                        or 0
                    ),

                    "currency": payment.get(
                        "currency",
                        "INR",
                    ),

                    "status": payment.get(
                        "status"
                    ),

                    "payment_method": payment.get(
                        "payment_method"
                    ),

                    "purpose": payment.get(
                        "purpose"
                    ),

                    "payment_date": payment.get(
                        "payment_date"
                    ),

                    "refund_status": payment.get(
                        "refund_status"
                    ),

                    "refund_amount": float(
                        payment.get(
                            "refund_amount",
                            0,
                        )
                        or 0
                    ),

                    "refund_date": payment.get(
                        "refund_date"
                    ),

                    "refund_payment_id": payment.get(
                        "refund_payment_id"
                    ),

                    "order": order,
                }
            )

        # ============================================================
        # 8. PAGINATION
        # ============================================================

        pages = (
            (total + limit - 1) // limit
            if total
            else 0
        )

        # ============================================================
        # 9. RETURN RESPONSE
        # ============================================================

        return {
            "success": True,
            "payments": unique_payments,
            "page": page,
            "limit": limit,
            "total": total,
            "pages": pages,
        }

    # ================================================================
    # HTTP EXCEPTION
    # ================================================================

    except HTTPException:
        raise

    # ================================================================
    # UNEXPECTED ERROR
    # ================================================================

    except Exception as e:
        logger.error(
            "Get admin payments error: %s",
            e,
            exc_info=True,
        )

        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to fetch payment data",
        )
@fastapi_app.get("/admin/payments/export")
def export_admin_payments(
    status_filter: str = "ALL",
    payment_method: str = "ALL",
    _: Dict[str, Any] = Depends(
        require_role(UserRole.ADMIN)
    ),
):
    try:
        # ============================================================
        # 1. BUILD REAL DATABASE QUERY
        # ============================================================
        query = {}

        if status_filter and status_filter.upper() != "ALL":
            query["status"] = status_filter

        if payment_method and payment_method.upper() != "ALL":
            query["payment_method"] = payment_method

        # ============================================================
        # 2. FETCH REAL PAYMENT RECORDS
        # ============================================================
        payments = list(
            payments_collection.find(query).sort(
                [
                    ("payment_date", -1),
                    ("_id", -1),
                ]
            )
        )

        # ============================================================
        # 3. CREATE CSV IN MEMORY
        # ============================================================
        output = io.StringIO()

        writer = csv.writer(output)

        writer.writerow([
            "Payment ID",
            "Order ID",
            "Customer Email",
            "Amount",
            "Currency",
            "Status",
            "Payment Method",
            "Purpose",
            "Payment Date",
            "Refund Status",
            "Refund Amount",
            "Refund Date",
            "Refund Payment ID",
        ])

        # ============================================================
        # 4. WRITE REAL DATABASE DATA
        # ============================================================
        for payment in payments:

            payment_date = payment.get("payment_date")

            if payment_date:
                if hasattr(payment_date, "isoformat"):
                    payment_date = payment_date.isoformat()
                else:
                    payment_date = str(payment_date)
            else:
                payment_date = ""

            refund_date = payment.get("refund_date")

            if refund_date:
                if hasattr(refund_date, "isoformat"):
                    refund_date = refund_date.isoformat()
                else:
                    refund_date = str(refund_date)
            else:
                refund_date = ""

            writer.writerow([
                payment.get("payment_id", ""),
                payment.get("order_id", ""),
                (
                    payment.get("user_email")
                    or payment.get("email", "")
                ),
                payment.get("amount", 0),
                payment.get("currency", "INR"),
                payment.get("status", ""),
                payment.get("payment_method", ""),
                payment.get("purpose", ""),
                payment_date,
                payment.get("refund_status", ""),
                payment.get("refund_amount", 0),
                refund_date,
                payment.get("refund_payment_id", ""),
            ])

        # ============================================================
        # 5. RESET CSV POINTER
        # ============================================================
        output.seek(0)

        # ============================================================
        # 6. RETURN CSV FILE
        # ============================================================
        return StreamingResponse(
            iter([output.getvalue()]),
            media_type="text/csv",
            headers={
                "Content-Disposition": (
                    "attachment; filename=payments.csv"
                )
            },
        )

    except Exception as e:
        logger.error(
            "Export admin payments error: %s",
            e,
        )

        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to export payments",
        )
@fastapi_app.get("/admin/payments/stats")
def get_admin_payment_stats(
    status_filter: str = "ALL",
    payment_method: str = "ALL",
    _: Dict[str, Any] = Depends(
        require_role(UserRole.ADMIN)
    ),
):
    try:
        query = {}

        if status_filter != "ALL":
            query["status"] = status_filter

        if payment_method != "ALL":
            query["payment_method"] = payment_method

        # Only read real payment records.
        payments = payments_collection.find(query)

        total_transactions = 0
        total_amount = 0.0
        paid_transactions = 0
        pending_transactions = 0
        failed_transactions = 0

        for payment in payments:
            total_transactions += 1

            try:
                total_amount += float(
                    payment.get("amount", 0) or 0
                )
            except (TypeError, ValueError):
                pass

            payment_status = payment.get("status")

            if payment_status == PaymentStatus.PAID:
                paid_transactions += 1

            elif payment_status == PaymentStatus.PENDING:
                pending_transactions += 1

            elif payment_status == PaymentStatus.FAILED:
                failed_transactions += 1

        return {
            "success": True,
            "total_transactions": total_transactions,
            "total_amount": round(total_amount, 2),
            "paid_transactions": paid_transactions,
            "pending_transactions": pending_transactions,
            "failed_transactions": failed_transactions,
        }

    except Exception as e:
        logger.error(
            "Admin payment statistics error: %s",
            e
        )

        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to calculate payment statistics"
        )

@fastapi_app.get("/admin/payments/{payment_id}")
def get_admin_payment(
    payment_id: str,
    _: Dict[str, Any] = Depends(
        require_role(UserRole.ADMIN)
    ),
):
    try:
        # ============================================================
        # 1. FIND REAL PAYMENT
        # ============================================================

        payment = payments_collection.find_one(
            {"payment_id": payment_id}
        )

        if not payment:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Payment not found",
            )

        # ============================================================
        # 2. FIND REAL CUSTOMER
        # ============================================================

        email = (
            payment.get("user_email")
            or payment.get("email")
        )

        customer = None

        if email:
            customer = users_collection.find_one(
                {"email": email},
                {
                    "_id": 0,
                    "name": 1,
                    "email": 1,
                    "phone": 1,
                },
            )

        # ============================================================
        # 3. FIND REAL ORDER
        # ============================================================

        order = None

        order_id = payment.get("order_id")

        if order_id:
            try:
                order = orders_collection.find_one(
                    {
                        "$or": [
                            {
                                "order_id": str(order_id)
                            },
                            {
                                "razorpay_order_id": str(
                                    order_id
                                )
                            },
                        ]
                    },
                    {
                        "_id": 0,
                        "order_id": 1,
                        "razorpay_order_id": 1,
                        "token": 1,
                        "items": 1,
                        "total": 1,
                        "status": 1,
                        "payment_method": 1,
                        "payment_status": 1,
                        "date": 1,
                    },
                )

            except Exception as e:
                logger.error(
                    "Order lookup failed for %s: %s",
                    order_id,
                    e,
                    exc_info=True,
                )

                order = None

        # ============================================================
        # 4. BUILD PAYMENT RESPONSE
        # ============================================================

        payment_response = {
            "database_id": str(
                payment["_id"]
            ),

            "payment_id": payment.get(
                "payment_id"
            ),

            "order_id": payment.get(
                "order_id"
            ),

            "razorpay_order_id": payment.get(
                "razorpay_order_id"
            ),

            "customer": customer,

            "amount": float(
                payment.get(
                    "amount",
                    0,
                )
                or 0
            ),

            "currency": payment.get(
                "currency",
                "INR",
            ),

            "status": payment.get(
                "status"
            ),

            "payment_method": payment.get(
                "payment_method"
            ),

            "purpose": payment.get(
                "purpose"
            ),

            "payment_date": payment.get(
                "payment_date"
            ),

            "refund_status": payment.get(
                "refund_status"
            ),

            "refund_amount": float(
                payment.get(
                    "refund_amount",
                    0,
                )
                or 0
            ),

            "refund_date": payment.get(
                "refund_date"
            ),

            "refund_payment_id": payment.get(
                "refund_payment_id"
            ),

            "order": order,
        }

        # ============================================================
        # 5. RETURN RESPONSE
        # ============================================================

        return {
            "success": True,
            "payment": payment_response,
        }

    # ================================================================
    # HTTP EXCEPTION
    # ================================================================

    except HTTPException:
        raise

    # ================================================================
    # UNEXPECTED ERROR
    # ================================================================

    except Exception as e:
        logger.error(
            "Get admin payment error: %s",
            e,
            exc_info=True,
        )

        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to fetch payment details",
        )
# ============================================================
# RAZORPAY WEBHOOK
# ============================================================
# Refund finalization is driven by Razorpay's signed webhook.
# The raw request body MUST be used for signature verification.
# Customer/vendor clients never call this endpoint directly.
# ============================================================

@fastapi_app.post("/webhooks/razorpay")
async def razorpay_webhook(
    request: Request,
    x_razorpay_signature: Optional[str] = Header(
        default=None,
        alias="X-Razorpay-Signature",
    ),
):
    try:
        raw_body = await request.body()

        if not x_razorpay_signature:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Missing webhook signature.",
            )

        expected_signature = hmac.new(
            RAZORPAY_WEBHOOK_SECRET.encode("utf-8"),
            raw_body,
            hashlib.sha256,
        ).hexdigest()

        if not hmac.compare_digest(
            expected_signature,
            x_razorpay_signature.strip(),
        ):
            logger.warning(
                "Rejected Razorpay webhook with invalid signature."
            )
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid webhook signature.",
            )

        try:
            payload = json.loads(raw_body.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid webhook payload.",
            )

        event = str(
            payload.get("event") or ""
        ).strip().lower()

        supported_events = {
            "refund.created",
            "refund.processed",
            "refund.failed",
        }

        if event not in supported_events:
            return {
                "success": True,
                "ignored": True,
            }

        payload_entity = (
            payload.get("payload") or {}
        )

        refund_entity = (
            payload_entity.get("refund") or {}
        ).get("entity") or {}

        razorpay_refund_id = str(
            refund_entity.get("id") or ""
        ).strip()

        if not razorpay_refund_id:
            logger.warning(
                "Razorpay refund webhook missing refund ID."
            )
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Refund ID is missing.",
            )

        refund = refunds_collection.find_one(
            {
                "razorpay_refund_id": razorpay_refund_id,
            }
        )

        if not refund:
            logger.warning(
                "Received Razorpay refund webhook for unknown "
                "refund_id=%s",
                razorpay_refund_id,
            )
            return {
                "success": True,
                "ignored": True,
            }

        current_status = str(
            refund.get("status") or ""
        ).upper()

        if current_status == RefundStatus.PROCESSED:
            return {
                "success": True,
                "already_processed": True,
            }

        now = datetime.now(timezone.utc)

        if event == "refund.processed":
            refund_update = refunds_collection.update_one(
                {
                    "_id": refund["_id"],
                    "status": {
                        "$in": [
                            RefundStatus.PENDING,
                            RefundStatus.INITIATED,
                            RefundStatus.PROCESSING,
                        ]
                    },
                },
                {
                    "$set": {
                        "status": RefundStatus.PROCESSED,
                        "processed_at": now,
                        "updated_at": now,
                    }
                },
            )

            if refund_update.modified_count == 1:
                payment_id = str(
                    refund.get("payment_id") or ""
                ).strip()

                if payment_id:
                    processed_refunds = refunds_collection.find(
                        {
                            "payment_id": payment_id,
                            "status": RefundStatus.PROCESSED,
                        },
                        {
                            "amount_paise": 1,
                            "razorpay_refund_id": 1,
                            "processed_at": 1,
                        },
                    )

                    total_refunded_paise = 0
                    latest_refund = None

                    for processed_refund in processed_refunds:
                        amount_paise = int(
                            processed_refund.get(
                                "amount_paise",
                                0,
                            )
                            or 0
                        )

                        if amount_paise > 0:
                            total_refunded_paise += amount_paise

                        processed_at = processed_refund.get(
                            "processed_at"
                        )

                        if (
                            latest_refund is None
                            or (
                                processed_at
                                and processed_at
                                > latest_refund.get(
                                    "processed_at"
                                )
                            )
                        ):
                            latest_refund = processed_refund

                    latest_refund_id = (
                        str(
                            latest_refund.get(
                                "razorpay_refund_id"
                            )
                            or ""
                        ).strip()
                        if latest_refund
                        else razorpay_refund_id
                    )

                    payments_collection.update_one(
                        {
                            "payment_id": payment_id,
                        },
                        {
                            "$set": {
                                "refund_status": "PROCESSED",
                                "refund_amount": (
                                    total_refunded_paise / 100
                                ),
                                "refund_date": now,
                                "refund_payment_id": latest_refund_id,
                            },
                        },
                    )

        elif event == "refund.failed":
            refunds_collection.update_one(
                {
                    "_id": refund["_id"],
                    "status": {
                        "$in": [
                            RefundStatus.PENDING,
                            RefundStatus.INITIATED,
                            RefundStatus.PROCESSING,
                        ]
                    },
                },
                {
                    "$set": {
                        "status": RefundStatus.FAILED,
                        "updated_at": now,
                        "failure_reason": "Razorpay reported refund failure.",
                    }
                },
            )

        elif event == "refund.created":
            refunds_collection.update_one(
                {
                    "_id": refund["_id"],
                    "status": {
                        "$in": [
                            RefundStatus.INITIATED,
                            RefundStatus.PROCESSING,
                        ]
                    },
                },
                {
                    "$set": {
                        "updated_at": now,
                    }
                },
            )

        return {
            "success": True,
        }

    except HTTPException:
        raise

    except Exception as exc:
        logger.exception(
            "Razorpay refund webhook processing error: %s",
            exc,
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Webhook processing failed.",
        )



# =====================================
# FINAL SOCKET APP
# =====================================

app = socketio.ASGIApp(
    sio,
    fastapi_app
)
