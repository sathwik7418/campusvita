"""Isolated Sprint 01/02 authorization and order-integrity regression tests."""

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch
from copy import deepcopy
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier, Lock, RLock
from contextlib import contextmanager

import jwt
import pytest
from fastapi import HTTPException


def run_immediate(coroutine):
    """Drive coroutines whose dependencies are immediate mocks."""
    try:
        coroutine.send(None)
    except StopIteration as completed:
        return completed.value
    raise AssertionError("Coroutine unexpectedly blocked in an isolated test")


class MemoryWalletUsers:
    def __init__(self, wallet, email="student@example.com"):
        self.user = {"email": email, "wallet": wallet, "wallet_history": []}

    def find_one(self, query):
        return deepcopy(self.user) if query.get("email") == self.user["email"] else None

    def update_one(self, query, update):
        if query.get("email") != self.user["email"]:
            return SimpleNamespace(matched_count=0, modified_count=0)
        key = query.get("wallet_history.idempotency_key", {}).get("$ne")
        if key and any(row.get("idempotency_key") == key for row in self.user["wallet_history"]):
            return SimpleNamespace(matched_count=0, modified_count=0)
        minimum = query.get("wallet", {}).get("$gte")
        if minimum is not None and self.user["wallet"] < minimum:
            return SimpleNamespace(matched_count=0, modified_count=0)
        for field, amount in update.get("$inc", {}).items():
            self.user[field] = self.user.get(field, 0) + amount
        self.user.setdefault("wallet_history", []).extend(
            [deepcopy(update["$push"]["wallet_history"])]
            if "$push" in update else []
        )
        return SimpleNamespace(matched_count=1, modified_count=1)


class ConcurrentMemoryWalletUsers(MemoryWalletUsers):
    """Model Mongo's atomic conditional user-document update for race tests."""

    def __init__(self, wallet):
        super().__init__(wallet)
        self.lock = Lock()

    def find_one(self, query):
        with self.lock:
            return super().find_one(query)

    def update_one(self, query, update):
        with self.lock:
            return super().update_one(query, update)


class MemoryOrders:
    def __init__(self):
        self.rows = []
        self.next_id = 0

    def find_one(self, query):
        for row in self.rows:
            if all(row.get(key) == value for key, value in query.items()):
                return deepcopy(row)
        return None

    def insert_one(self, document):
        self.next_id += 1
        row = deepcopy(document)
        row["_id"] = f"order-{self.next_id}"
        self.rows.append(row)
        return SimpleNamespace(inserted_id=row["_id"])

    def update_one(self, query, update):
        row = self.find_one({"_id": query.get("_id")})
        if not row:
            return SimpleNamespace(matched_count=0, modified_count=0)
        target = next((item for item in self.rows if item["_id"] == row["_id"]), None)
        for field, value in update.get("$set", {}).items():
            target[field] = deepcopy(value)
        return SimpleNamespace(matched_count=1, modified_count=1)


class ConcurrentMemoryOrders(MemoryOrders):
    """Enforce the production idempotency unique index and synchronize reads."""

    def __init__(self):
        super().__init__()
        self.lock = RLock()
        self.first_idempotency_reads = Barrier(2)
        self.idempotency_read_count = 0

    def find_one(self, query):
        if "idempotency_key" in query:
            with self.lock:
                self.idempotency_read_count += 1
                wait_for_competitor = self.idempotency_read_count <= 2
            if wait_for_competitor:
                self.first_idempotency_reads.wait(timeout=5)
        with self.lock:
            return super().find_one(query)

    def insert_one(self, document):
        from pymongo.errors import DuplicateKeyError

        with self.lock:
            key = (document.get("email"), document.get("idempotency_key"))
            if any(
                (row.get("email"), row.get("idempotency_key")) == key
                for row in self.rows
                if isinstance(row.get("idempotency_key"), str)
            ):
                raise DuplicateKeyError("duplicate checkout idempotency key")
            self.next_id += 1
            row = deepcopy(document)
            row["_id"] = f"order-{self.next_id}"
            self.rows.append(row)
            return SimpleNamespace(inserted_id=row["_id"])

    def update_one(self, query, update):
        with self.lock:
            return super().update_one(query, update)


class MemoryPayments:
    def __init__(self, fail_first=False):
        self.rows = []
        self.fail_first = fail_first
        self.lock = RLock()

    def find_one(self, query):
        with self.lock:
            return next(
                (deepcopy(row) for row in self.rows if all(row.get(k) == v for k, v in query.items())),
                None,
            )

    def insert_one(self, document):
        with self.lock:
            if self.fail_first:
                self.fail_first = False
                raise RuntimeError("simulated payment ledger outage")
            if self.find_one({"payment_id": document["payment_id"]}):
                from pymongo.errors import DuplicateKeyError
                raise DuplicateKeyError("duplicate payment")
            self.rows.append(deepcopy(document))

    def update_one(self, query, update):
        with self.lock:
            for row in self.rows:
                if all(row.get(key) == value for key, value in query.items()):
                    row.update(deepcopy(update.get("$set", {})))
                    return SimpleNamespace(matched_count=1, modified_count=1)
            return SimpleNamespace(matched_count=0, modified_count=0)


class MemoryPickupOrders:
    def __init__(self, order):
        self.order = deepcopy(order)
        self.update_calls = 0

    def find_one(self, query):
        if query.get("_id") == self.order.get("_id") or query.get("token") == self.order.get("token"):
            return deepcopy(self.order)
        return None

    def update_one(self, query, update):
        self.update_calls += 1
        values = update.get("$set", {})
        elem_match = query.get("stall_orders", {}).get("$elemMatch")
        if elem_match:
            for row in self.order["stall_orders"]:
                if all(
                    row.get(key) == value
                    or (isinstance(value, dict) and value == {"$ne": True} and row.get(key) is not True)
                    for key, value in elem_match.items()
                ):
                    for field, value in values.items():
                        if field.startswith("stall_orders.$."):
                            row[field.split("$.", 1)[1]] = value
                    return SimpleNamespace(matched_count=1, modified_count=1)
            return SimpleNamespace(matched_count=0, modified_count=0)
        if "status" in values:
            if "$not" not in query.get("stall_orders", {}) or all(
                row.get("cancelled") or row.get("picked_up")
                for row in self.order["stall_orders"]
            ):
                self.order["status"] = values["status"]
                return SimpleNamespace(matched_count=1, modified_count=1)
        return SimpleNamespace(matched_count=0, modified_count=0)


class MemoryTopupUsers:
    def __init__(self, fail_first=False):
        self.user = {"email": "student@example.com", "wallet": 0.0, "wallet_history": []}
        self.fail_first = fail_first

    def update_one(self, query, update):
        payment_id = query["wallet_history.payment_id"]["$ne"]
        if any(row.get("payment_id") == payment_id for row in self.user["wallet_history"]):
            return SimpleNamespace(matched_count=0, modified_count=0)
        if self.fail_first:
            self.fail_first = False
            return SimpleNamespace(matched_count=0, modified_count=0)
        self.user["wallet"] += update["$inc"]["wallet"]
        self.user["wallet_history"].append(deepcopy(update["$push"]["wallet_history"]))
        return SimpleNamespace(matched_count=1, modified_count=1)

    def find_one(self, query):
        return deepcopy(self.user)


class MemoryCancellationOrders:
    def __init__(self, order, *, barrier=None, before_update=None, force_miss=False):
        self.order = deepcopy(order)
        self.barrier = barrier
        self.initial_reads = 0
        self.lock = RLock()
        self.before_update = before_update
        self.force_miss = force_miss
        self.update_count = 0

    def find_one(self, query):
        snapshot = None
        if "token" in query and self.barrier is not None:
            with self.lock:
                self.initial_reads += 1
                wait_for_other = self.initial_reads <= 2
                if query.get("token") == self.order.get("token"):
                    snapshot = deepcopy(self.order)
            if wait_for_other:
                self.barrier.wait(timeout=5)
        if snapshot is not None:
            return snapshot
        with self.lock:
            if query.get("_id") == self.order.get("_id") or query.get("token") == self.order.get("token"):
                return deepcopy(self.order)
            return None

    def update_one(self, query, update):
        with self.lock:
            self.update_count += 1
            if self.before_update:
                self.before_update(self.order)
            if self.force_miss or not all(
                self.order.get(key) == value
                for key, value in query.items()
                if not (isinstance(value, dict) and value == {"$exists": False})
            ):
                return SimpleNamespace(matched_count=0, modified_count=0)
            if query.get("stall_orders") == {"$exists": False} and "stall_orders" in self.order:
                return SimpleNamespace(matched_count=0, modified_count=0)
            for key, value in update.get("$set", {}).items():
                self.order[key] = deepcopy(value)
            return SimpleNamespace(matched_count=1, modified_count=1)


class MemoryRefunds:
    def __init__(self, *, fail_first_insert=False):
        self.rows = []
        self.next_id = 0
        self.lock = RLock()
        self.fail_first_insert = fail_first_insert
        self.fail_updates = None

    def find_one(self, query):
        with self.lock:
            return next(
                (deepcopy(row) for row in self.rows if all(row.get(key) == value for key, value in query.items())),
                None,
            )

    def insert_one(self, document):
        from pymongo.errors import DuplicateKeyError

        with self.lock:
            if self.fail_first_insert:
                self.fail_first_insert = False
                raise RuntimeError("simulated refund intent persistence failure")
            if self.find_one({"idempotency_key": document["idempotency_key"]}):
                raise DuplicateKeyError("duplicate refund idempotency key")
            self.next_id += 1
            row = deepcopy(document)
            row["_id"] = f"refund-{self.next_id}"
            self.rows.append(row)
            return SimpleNamespace(inserted_id=row["_id"])

    def aggregate(self, _pipeline):
        order_id = _pipeline[0].get("$match", {}).get("order_id")
        with self.lock:
            return [{"total": sum(
                int(row.get("amount_paise", 0))
                for row in self.rows
                if row.get("order_id") == order_id
                if row.get("status") in {"PENDING", "INITIATED", "PROCESSING", "PROCESSED"}
            )}] if self.rows else []

    def find(self, query, _projection=None):
        with self.lock:
            return [
                deepcopy(row)
                for row in self.rows
                if row.get("status") in query.get("status", {}).get("$in", [])
                and row.get("refund_scope") in query.get("refund_scope", {}).get("$in", [])
                and isinstance(row.get("item_indexes"), list)
                and row.get("item_indexes")
            ]

    def update_one(self, query, update):
        with self.lock:
            for row in self.rows:
                if not all(
                    row.get(key) in value["$in"]
                    if isinstance(value, dict) and "$in" in value
                    else row.get(key) == value
                    for key, value in query.items()
                ):
                    continue
                updates = update.get("$set", {})
                if self.fail_updates and self.fail_updates(updates):
                    return SimpleNamespace(matched_count=0, modified_count=0)
                row.update(deepcopy(updates))
                return SimpleNamespace(matched_count=1, modified_count=1)
            return SimpleNamespace(matched_count=0, modified_count=0)

    def find_one_and_update(self, query, update):
        with self.lock:
            for row in self.rows:
                if row.get("_id") != query.get("_id"):
                    continue
                status = row.get("status")
                eligible = status in {"PENDING", "FAILED"}
                if status in {"INITIATED", "PROCESSING"}:
                    cutoff = query.get("$or", [{}])[1].get("$or", [{}])[0].get("updated_at", {}).get("$lt")
                    eligible = bool(row.get("updated_at") and cutoff and row["updated_at"] < cutoff)
                if not eligible:
                    return None
                previous = deepcopy(row)
                row.update(deepcopy(update.get("$set", {})))
                return previous
            return None


def cancellation_order(*, two_stalls=False):
    items = [{"name": "Rice", "stall_id": "stall-a", "quantity": 1, "price": 50.0}]
    if two_stalls:
        items.append({"name": "Noodles", "stall_id": "stall-b", "quantity": 1, "price": 50.0})
    stalls = []
    for stall_id in dict.fromkeys(item["stall_id"] for item in items):
        stalls.append({
            "stall_id": stall_id,
            "status": "Pending",
            "picked_up": False,
            "cancelled": False,
        })
    return {
        "_id": "cancel-order-1",
        "token": 8080,
        "email": "student@example.com",
        "payment_status": "Paid",
        "payment_method": "WALLET",
        "status": "Preparing",
        "total": 100.0 if two_stalls else 50.0,
        "payment_amount": 100.0 if two_stalls else 50.0,
        "items": items,
        "stall_orders": stalls,
    }


@contextmanager
def patched_vendor_cancellation(backend_module, orders, refunds, safe_emit=None):
    payment = {
        "payment_id": "wallet-payment-1",
        "payment_method": "WALLET",
        "purpose": "food_order",
        "status": "Paid",
        "amount": 100.0 if len(orders.order["items"]) > 1 else 50.0,
    }
    with (
        patch.object(backend_module, "orders_collection", orders),
        patch.object(backend_module, "refunds_collection", refunds),
        patch.object(backend_module, "_refund_payment_for_order", return_value=payment),
        patch.object(backend_module, "get_vendor_stall_ids", return_value=["stall-a", "stall-b"]),
        patch.object(backend_module, "process_refund_record", side_effect=lambda refund_id: {"_id": refund_id, "status": "PROCESSED"}) as process,
        patch.object(backend_module, "users_collection", MagicMock()),
        patch.object(backend_module, "send_push_notification") as push,
        patch.object(backend_module, "safe_emit_order_update", new_callable=AsyncMock) as emit,
    ):
        yield process, push, emit


def test_expired_access_token_is_rejected(backend_module):
    token = jwt.encode(
        {
            "email": "student@example.com",
            "type": "access",
            "exp": datetime.now(timezone.utc) - timedelta(minutes=1),
        },
        backend_module.JWT_SECRET,
        algorithm=backend_module.JWT_ALGORITHM,
    )

    with pytest.raises(HTTPException) as error:
        backend_module.verify_token(token)

    assert error.value.status_code == 401
    assert error.value.detail == "Invalid or expired token"


def test_admin_role_cannot_be_bypassed(backend_module):
    checker = backend_module.require_role(backend_module.UserRole.ADMIN)

    with pytest.raises(HTTPException) as error:
        checker({"email": "student@example.com", "role": "USER"})

    assert error.value.status_code == 403


def test_legacy_global_status_route_requires_admin(backend_module):
    route = next(
        route
        for route in backend_module.fastapi_app.routes
        if getattr(route, "path", None) == "/update-order-status/{order_id}"
    )
    dependency = route.dependant.dependencies[0]
    checker = dependency.call

    with pytest.raises(HTTPException) as error:
        checker({"email": "student@example.com", "role": "USER"})

    assert error.value.status_code == 403


def test_fcm_token_uses_authenticated_email_only(backend_module):
    users = MagicMock()
    users.update_one.return_value = SimpleNamespace(matched_count=1)
    payload = backend_module.FCMTokenData(fcm_token="device-token")

    with patch.object(backend_module, "users_collection", users):
        result = backend_module.save_fcm_token(
            payload,
            {"email": "student@example.com", "role": "USER"},
        )

    assert result["message"] == "FCM token saved successfully"
    users.update_one.assert_called_once_with(
        {"email": "student@example.com"},
        {"$set": {"fcm_token": "device-token"}},
    )


def test_cart_summary_passes_stall_identity_to_authoritative_pricer(
    backend_module,
):
    bill = {
        "items": [{"name": "Rice", "stall_id": "stall-a", "price": 80}],
        "subtotal": 80.0,
        "delivery_fee": 20.0,
        "tax_amount": 0.0,
        "discount": 0.0,
        "total": 100.0,
    }
    request = backend_module.CartSummaryRequest(
        items=[
            backend_module.CartSummaryItem(
                name="Rice",
                quantity=1,
                stall_id="stall-a",
            )
        ]
    )

    with patch.object(
        backend_module,
        "calculate_food_order_bill",
        return_value=bill,
    ) as calculate:
        result = backend_module.get_cart_summary(request)

    assert result["total"] == 100.0
    passed_items = calculate.call_args.args[0]
    assert passed_items[0].stall_id == "stall-a"
    assert passed_items[0].quantity == 1


def test_wallet_checkout_uses_same_authoritative_total_as_cart(
    backend_module,
):
    order_id = "order-wallet-test"
    bill = {
        "items": [
            {
                "name": "Rice",
                "stall_id": "stall-a",
                "price": 100.0,
                "quantity": 1,
            }
        ],
        "subtotal": 100.0,
        "delivery_fee": 15.0,
        "tax_amount": 10.0,
        "discount": 0.0,
        "total": 125.0,
    }
    users = MagicMock()
    users.find_one.return_value = {"wallet": 500.0}
    users.update_one.return_value = SimpleNamespace(modified_count=1)
    orders = MagicMock()
    orders.insert_one.return_value = SimpleNamespace(inserted_id=order_id)
    orders.find_one.return_value = None
    orders.update_one.return_value = SimpleNamespace(matched_count=1)
    payments = MagicMock()

    request = backend_module.CreateFoodOrderData(
        items=[
            backend_module.OrderItemRequest(
                name="Rice",
                quantity=1,
                stall_id="stall-a",
            )
        ],
        name="Student",
        phone="9876543210",
        idempotency_key="checkout-key-0000000",
    )

    with (
        patch.object(
            backend_module,
            "calculate_food_order_bill",
            return_value=bill,
        ) as calculate,
        patch.object(backend_module, "users_collection", users),
        patch.object(backend_module, "orders_collection", orders),
        patch.object(backend_module, "payments_collection", payments),
        patch.object(backend_module, "get_next_token", return_value=123),
        patch.object(backend_module, "safe_emit_order_update", new_callable=AsyncMock),
    ):
        result = run_immediate(
            backend_module.pay_order_with_wallet(
                request,
                {"email": "student@example.com", "role": "USER"},
            )
        )

    assert result["amount_paid"] == bill["total"]
    assert result["order"]["total"] == bill["total"]
    assert calculate.call_count == 1
    saved_order = orders.insert_one.call_args.args[0]
    assert saved_order["stall_orders"][0]["stall_id"] == "stall-a"
    assert (
        saved_order["stall_orders"][0]["status"]
        == backend_module.StallOrderStatus.PENDING
    )
    wallet_query, wallet_update = users.update_one.call_args.args
    assert wallet_query["wallet"]["$gte"] == bill["total"]
    assert wallet_update["$inc"]["wallet"] == -bill["total"]
    assert saved_order["billing"] == {
        key: bill[key]
        for key in (
            "subtotal",
            "delivery_fee",
            "tax_amount",
            "discount",
            "total",
        )
    }


def test_duplicate_wallet_checkout_debits_once(backend_module):
    users = MemoryWalletUsers(500.0)
    orders = MemoryOrders()
    payments = MemoryPayments()
    bill = {
        "items": [{"name": "Rice", "stall_id": "stall-a", "price": 100.0, "quantity": 1}],
        "subtotal": 100.0,
        "delivery_fee": 20.0,
        "tax_amount": 0.0,
        "discount": 0.0,
        "total": 120.0,
    }
    request = backend_module.CreateFoodOrderData(
        items=[backend_module.OrderItemRequest(name="Rice", quantity=1, stall_id="stall-a")],
        name="Student",
        phone="9876543210",
        idempotency_key="checkout-key-0000001",
    )
    with (
        patch.object(backend_module, "calculate_food_order_bill", return_value=bill),
        patch.object(backend_module, "users_collection", users),
        patch.object(backend_module, "orders_collection", orders),
        patch.object(backend_module, "payments_collection", payments),
        patch.object(backend_module, "get_next_token", return_value=123),
        patch.object(backend_module, "safe_emit_order_update", new_callable=AsyncMock),
    ):
        first = run_immediate(backend_module.pay_order_with_wallet(
            request, {"email": "student@example.com", "role": "USER"}
        ))
        second = run_immediate(backend_module.pay_order_with_wallet(
            request, {"email": "student@example.com", "role": "USER"}
        ))

    assert first["order"]["token"] == second["order"]["token"]
    assert users.user["wallet"] == 380.0
    assert users.user["total_orders"] == 1
    assert len(orders.rows) == 1
    assert len(payments.rows) == 1


@pytest.mark.parametrize(
    ("changed_bill", "changed_item"),
    [
        (None, {"name": "Noodles", "stall_id": "stall-b", "price": 100.0, "quantity": 1}),
        (
            {
                "items": [{"name": "Rice", "stall_id": "stall-a", "price": 100.0, "quantity": 1}],
                "subtotal": 100.0,
                "delivery_fee": 35.0,
                "discount": 15.0,
                "tax_amount": 0.0,
                "total": 120.0,
            },
            None,
        ),
    ],
)
def test_wallet_idempotency_key_rejects_changed_cart_or_delivery_fee(
    backend_module, changed_bill, changed_item
):
    users = MemoryWalletUsers(500.0)
    orders = MemoryOrders()
    payments = MemoryPayments()
    original_bill = {
        "items": [{"name": "Rice", "stall_id": "stall-a", "price": 100.0, "quantity": 1}],
        "subtotal": 100.0,
        "delivery_fee": 20.0,
        "tax_amount": 0.0,
        "discount": 0.0,
        "total": 120.0,
    }
    second_bill = changed_bill or {
        **original_bill,
        "items": [changed_item],
    }
    request = backend_module.CreateFoodOrderData(
        items=[backend_module.OrderItemRequest(name="Rice", quantity=1, stall_id="stall-a")],
        name="Student",
        phone="9876543210",
        idempotency_key="checkout-key-changed-0001",
    )
    with (
        patch.object(backend_module, "calculate_food_order_bill", side_effect=[original_bill, second_bill]),
        patch.object(backend_module, "users_collection", users),
        patch.object(backend_module, "orders_collection", orders),
        patch.object(backend_module, "payments_collection", payments),
        patch.object(backend_module, "get_next_token", return_value=123),
        patch.object(backend_module, "safe_emit_order_update", new_callable=AsyncMock),
    ):
        run_immediate(backend_module.pay_order_with_wallet(
            request, {"email": "student@example.com", "role": "USER"}
        ))
        with pytest.raises(HTTPException) as error:
            run_immediate(backend_module.pay_order_with_wallet(
                request, {"email": "student@example.com", "role": "USER"}
            ))

    assert error.value.status_code == 409
    assert users.user["wallet"] == 380.0
    assert users.user["total_orders"] == 1
    assert len(orders.rows) == 1
    assert len(payments.rows) == 1


def test_concurrent_wallet_checkout_same_key_debits_and_orders_once(backend_module):
    users = ConcurrentMemoryWalletUsers(500.0)
    orders = ConcurrentMemoryOrders()
    payments = MemoryPayments()
    bill = {
        "items": [{"name": "Rice", "stall_id": "stall-a", "price": 100.0, "quantity": 1}],
        "subtotal": 100.0,
        "delivery_fee": 20.0,
        "tax_amount": 0.0,
        "discount": 0.0,
        "total": 120.0,
    }
    request = backend_module.CreateFoodOrderData(
        items=[backend_module.OrderItemRequest(name="Rice", quantity=1, stall_id="stall-a")],
        name="Student",
        phone="9876543210",
        idempotency_key="checkout-key-concurrent-01",
    )

    with (
        patch.object(backend_module, "calculate_food_order_bill", return_value=bill),
        patch.object(backend_module, "users_collection", users),
        patch.object(backend_module, "orders_collection", orders),
        patch.object(backend_module, "payments_collection", payments),
        patch.object(backend_module, "get_next_token", return_value=123),
        patch.object(backend_module, "safe_emit_order_update", new_callable=AsyncMock),
    ):
        def checkout():
            return run_immediate(backend_module.pay_order_with_wallet(
                request, {"email": "student@example.com", "role": "USER"}
            ))

        with ThreadPoolExecutor(max_workers=2) as executor:
            results = list(executor.map(lambda _index: checkout(), range(2)))

    assert results[0]["order"]["token"] == results[1]["order"]["token"]
    assert users.user["wallet"] == 380.0
    assert users.user["total_orders"] == 1
    assert len(users.user["wallet_history"]) == 1
    assert len(orders.rows) == 1
    assert len(payments.rows) == 1


def test_wallet_idempotency_key_is_scoped_to_authenticated_customer(backend_module):
    orders = MemoryOrders()
    payments = MemoryPayments()
    bill = {
        "items": [{"name": "Rice", "stall_id": "stall-a", "price": 100.0, "quantity": 1}],
        "subtotal": 100.0,
        "delivery_fee": 20.0,
        "tax_amount": 0.0,
        "discount": 0.0,
        "total": 120.0,
    }
    request = backend_module.CreateFoodOrderData(
        items=[backend_module.OrderItemRequest(name="Rice", quantity=1, stall_id="stall-a")],
        name="Student",
        phone="9876543210",
        idempotency_key="checkout-key-shared-users-01",
    )
    first_user = MemoryWalletUsers(500.0, "first@example.com")
    second_user = MemoryWalletUsers(500.0, "second@example.com")

    with (
        patch.object(backend_module, "calculate_food_order_bill", return_value=bill),
        patch.object(backend_module, "orders_collection", orders),
        patch.object(backend_module, "payments_collection", payments),
        patch.object(backend_module, "get_next_token", return_value=123),
        patch.object(backend_module, "safe_emit_order_update", new_callable=AsyncMock),
    ):
        with patch.object(backend_module, "users_collection", first_user):
            first = run_immediate(backend_module.pay_order_with_wallet(
                request, {"email": "first@example.com", "role": "USER"}
            ))
        with patch.object(backend_module, "users_collection", second_user):
            second = run_immediate(backend_module.pay_order_with_wallet(
                request, {"email": "second@example.com", "role": "USER"}
            ))

    assert first["order"]["email"] == "first@example.com"
    assert second["order"]["email"] == "second@example.com"
    assert first_user.user["wallet"] == 380.0
    assert second_user.user["wallet"] == 380.0
    assert len(orders.rows) == 2
    assert len(payments.rows) == 2


def test_wallet_checkout_retry_repairs_interrupted_payment_record(backend_module):
    users = MemoryWalletUsers(500.0)
    orders = MemoryOrders()
    payments = MemoryPayments(fail_first=True)
    bill = {
        "items": [{"name": "Rice", "stall_id": "stall-a", "price": 100.0, "quantity": 1}],
        "subtotal": 100.0,
        "delivery_fee": 20.0,
        "tax_amount": 0.0,
        "discount": 0.0,
        "total": 120.0,
    }
    request = backend_module.CreateFoodOrderData(
        items=[backend_module.OrderItemRequest(name="Rice", quantity=1, stall_id="stall-a")],
        name="Student",
        phone="9876543210",
        idempotency_key="checkout-key-0000002",
    )
    with (
        patch.object(backend_module, "calculate_food_order_bill", return_value=bill),
        patch.object(backend_module, "users_collection", users),
        patch.object(backend_module, "orders_collection", orders),
        patch.object(backend_module, "payments_collection", payments),
        patch.object(backend_module, "get_next_token", return_value=124),
        patch.object(backend_module, "safe_emit_order_update", new_callable=AsyncMock),
    ):
        with pytest.raises(HTTPException) as first_error:
            run_immediate(backend_module.pay_order_with_wallet(
                request, {"email": "student@example.com", "role": "USER"}
            ))
        retry = run_immediate(backend_module.pay_order_with_wallet(
            request, {"email": "student@example.com", "role": "USER"}
        ))

    assert first_error.value.status_code == 500
    assert retry["success"] is True
    assert users.user["wallet"] == 380.0
    assert len(orders.rows) == 1
    assert orders.rows[0]["payment_status"] == backend_module.PaymentStatus.PAID
    assert len(payments.rows) == 1


def test_online_payment_order_persists_per_stall_state(backend_module):
    order_id = "order-online-test"
    intent = {
        "email": "student@example.com",
        "razorpay_order_id": "razorpay-order-1",
        "items": [
            {
                "name": "Rice",
                "price": 100.0,
                "quantity": 1,
                "stall_id": "stall-a",
            }
        ],
        "total": 125.0,
        "billing": {
            "subtotal": 100.0,
            "delivery_fee": 15.0,
            "tax_amount": 10.0,
            "discount": 0.0,
            "total": 125.0,
        },
        "name": "Student",
        "phone": "9876543210",
    }
    orders = MagicMock()
    orders.insert_one.return_value = SimpleNamespace(inserted_id=order_id)
    orders.find_one.return_value = {
        "order_id": order_id,
        "token": 123,
        "total": 125.0,
    }
    payments = MagicMock()
    payments.find_one.return_value = None
    payments.update_one.return_value = SimpleNamespace(matched_count=1, modified_count=1)
    orders.find_one.return_value = None
    orders.update_one.return_value = SimpleNamespace(matched_count=1)
    request = backend_module.VerifyPaymentData(
        razorpay_payment_id="payment-1",
        razorpay_order_id="razorpay-order-1",
        razorpay_signature="signature",
        order_intent="signed-intent",
    )

    with (
        patch.object(backend_module, "decode_signed_intent", return_value=intent),
        patch.object(backend_module, "orders_collection", orders),
        patch.object(backend_module, "payments_collection", payments),
        patch.object(backend_module, "users_collection", MagicMock()),
        patch.object(backend_module, "get_next_token", return_value=123),
        patch.object(backend_module, "safe_emit_order_update", new_callable=AsyncMock),
        patch.object(
            backend_module.razorpay_client.utility,
            "verify_payment_signature",
        ),
        patch.object(
            backend_module.razorpay_client.payment,
            "fetch",
            return_value={
                "order_id": "razorpay-order-1",
                "amount": 12500,
                "currency": "INR",
                "status": "captured",
            },
        ),
    ):
        result = run_immediate(
            backend_module.verify_payment(
                request,
                {"email": "student@example.com", "role": "USER"},
            )
        )

    saved_order = orders.insert_one.call_args.args[0]
    assert result["success"] is True
    assert saved_order["stall_orders"][0]["stall_id"] == "stall-a"
    assert (
        saved_order["stall_orders"][0]["status"]
        == backend_module.StallOrderStatus.PENDING
    )


def test_duplicate_online_payment_is_verified_before_idempotent_replay(
    backend_module,
):
    request = backend_module.VerifyPaymentData(
        razorpay_payment_id="pay_duplicate",
        razorpay_order_id="order_duplicate",
        razorpay_signature="signature",
        order_intent="intent",
    )
    intent = {
        "email": "student@example.com",
        "razorpay_order_id": "order_duplicate",
        "items": [{"name": "Rice", "stall_id": "stall-a", "quantity": 1, "price": 100.0}],
        "total": 100.0,
        "name": "Student",
        "phone": "9876543210",
    }
    payments = MagicMock()
    payments.find_one.return_value = {
        "payment_id": "pay_duplicate",
        "razorpay_order_id": "order_duplicate",
        "email": "student@example.com",
        "amount": 100.0,
        "order_id": "saved-order-id",
        "purpose": "food_order",
    }
    orders = MagicMock()
    orders.find_one.side_effect = [
        {
            "_id": "saved-order-id",
            "email": "student@example.com",
            "total": 100.0,
            "payment_status": backend_module.PaymentStatus.PAID,
        },
        {
            "_id": "saved-order-id",
            "email": "student@example.com",
            "total": 100.0,
            "payment_status": backend_module.PaymentStatus.PAID,
        },
        {
            "_id": "saved-order-id",
            "email": "student@example.com",
            "total": 100.0,
            "payment_status": backend_module.PaymentStatus.PAID,
        },
    ]

    with (
        patch.object(backend_module, "decode_signed_intent", return_value=intent),
        patch.object(backend_module, "payments_collection", payments),
        patch.object(backend_module.razorpay_client.utility, "verify_payment_signature") as verify,
        patch.object(backend_module.razorpay_client.payment, "fetch", return_value={
            "order_id": "order_duplicate",
            "amount": 10000,
            "currency": "INR",
            "status": "captured",
        }),
        patch.object(backend_module, "orders_collection", orders),
        patch.object(backend_module, "users_collection", MagicMock()),
        patch.object(backend_module, "safe_emit_order_update", new_callable=AsyncMock),
    ):
        result = run_immediate(
            backend_module.verify_payment(
                request,
                {"email": "student@example.com", "role": "USER"},
            )
        )

    assert result["success"] is True
    verify.assert_called_once()
    orders.insert_one.assert_not_called()


def test_online_retry_cannot_replace_payment_attempt_bound_to_pending_order(
    backend_module,
):
    order = {
        "_id": "pending-order-id",
        "email": "student@example.com",
        "razorpay_order_id": "razorpay-order-reused",
        "payment_id": "first-payment-attempt",
        "payment_status": backend_module.PaymentStatus.PENDING,
        "total": 100.0,
    }
    orders = MemoryOrders()
    orders.rows.append(deepcopy(order))
    payments = MemoryPayments()
    intent = {
        "email": "student@example.com",
        "razorpay_order_id": "razorpay-order-reused",
        "items": [{"name": "Rice", "stall_id": "stall-a", "quantity": 1, "price": 100.0}],
        "total": 100.0,
        "name": "Student",
        "phone": "9876543210",
    }

    with (
        patch.object(backend_module, "orders_collection", orders),
        patch.object(backend_module, "payments_collection", payments),
        patch.object(backend_module, "users_collection", MagicMock()),
        patch.object(backend_module, "safe_emit_order_update", new_callable=AsyncMock),
    ):
        with pytest.raises(HTTPException) as error:
            run_immediate(backend_module.finalize_verified_online_payment(
                intent=intent,
                payment_id="second-payment-attempt",
                razorpay_order_id="razorpay-order-reused",
                razorpay_signature="verified-signature",
                current_user={"email": "student@example.com", "role": "USER"},
            ))

    assert error.value.status_code == 409
    assert len(orders.rows) == 1
    assert orders.rows[0]["payment_id"] == "first-payment-attempt"
    assert payments.rows == []


def test_online_payment_rejects_cross_account_intent_before_provider_access(backend_module):
    request = backend_module.VerifyPaymentData(
        razorpay_payment_id="payment-other-user",
        razorpay_order_id="order-other-user",
        razorpay_signature="signature",
        order_intent="signed-intent",
    )
    intent = {
        "email": "owner@example.com",
        "razorpay_order_id": "order-other-user",
    }
    with (
        patch.object(backend_module, "decode_signed_intent", return_value=intent),
        patch.object(backend_module.razorpay_client.utility, "verify_payment_signature") as verify,
        patch.object(backend_module.razorpay_client.payment, "fetch") as fetch,
    ):
        with pytest.raises(HTTPException) as error:
            run_immediate(backend_module.verify_payment(
                request,
                {"email": "other@example.com", "role": "USER"},
            ))
    assert error.value.status_code == 403
    verify.assert_not_called()
    fetch.assert_not_called()


def test_provider_payment_amount_and_capture_are_authoritatively_checked(backend_module):
    with patch.object(backend_module.razorpay_client.payment, "fetch", return_value={
        "order_id": "provider-order",
        "amount": 999,
        "currency": "INR",
        "status": "authorized",
    }):
        with pytest.raises(HTTPException) as error:
            backend_module.verify_razorpay_payment_details(
                "provider-order", "provider-payment", 10.0
            )
    assert error.value.status_code == 409


def test_online_finalization_retry_repairs_order_payment_link(backend_module):
    orders = MemoryOrders()
    payments = MemoryPayments(fail_first=True)
    users = MagicMock()
    users.update_one.return_value = SimpleNamespace(matched_count=1, modified_count=1)
    intent = {
        "email": "student@example.com",
        "razorpay_order_id": "razorpay-interrupted-1",
        "items": [{"name": "Rice", "price": 100.0, "quantity": 1, "stall_id": "stall-a"}],
        "total": 100.0,
        "name": "Student",
        "phone": "9876543210",
    }
    user = {"email": "student@example.com", "role": "USER"}
    args = {
        "intent": intent,
        "payment_id": "payment-interrupted-1",
        "razorpay_order_id": "razorpay-interrupted-1",
        "razorpay_signature": "verified-signature",
        "current_user": user,
    }
    with (
        patch.object(backend_module, "orders_collection", orders),
        patch.object(backend_module, "payments_collection", payments),
        patch.object(backend_module, "users_collection", users),
        patch.object(backend_module, "get_next_token", return_value=129),
        patch.object(backend_module, "safe_emit_order_update", new_callable=AsyncMock),
    ):
        with pytest.raises(RuntimeError):
            run_immediate(backend_module.finalize_verified_online_payment(**args))
        assert len(orders.rows) == 1
        assert orders.rows[0]["payment_status"] == backend_module.PaymentStatus.PENDING
        result = run_immediate(backend_module.finalize_verified_online_payment(**args))

    assert result["success"] is True
    assert len(orders.rows) == 1
    assert len(payments.rows) == 1
    assert orders.rows[0]["payment_status"] == backend_module.PaymentStatus.PAID


def test_wallet_topup_retry_credits_after_interrupted_wallet_write(backend_module):
    users = MemoryTopupUsers(fail_first=True)
    payments = MemoryPayments()
    args = {
        "intent": {"amount": 250.0},
        "payment_id": "topup-payment-1",
        "razorpay_order_id": "topup-order-1",
        "current_user": {"email": "student@example.com", "role": "USER"},
    }
    with (
        patch.object(backend_module, "users_collection", users),
        patch.object(backend_module, "payments_collection", payments),
    ):
        with pytest.raises(RuntimeError):
            backend_module.finalize_wallet_topup(**args)
        result = backend_module.finalize_wallet_topup(**args)
        duplicate = backend_module.finalize_wallet_topup(**args)

    assert result["success"] is True
    assert duplicate["amount_added"] == 250.0
    assert users.user["wallet"] == 250.0
    assert len(users.user["wallet_history"]) == 1
    assert len(payments.rows) == 1


def test_vendor_cannot_access_other_vendor_stall(backend_module):
    stalls = MagicMock()
    stalls.find.return_value = [{"_id": "stall-a"}]

    with patch.object(backend_module, "stalls_collection", stalls):
        allowed = backend_module.get_vendor_stall_ids(
            {"email": "vendor-a@example.com", "role": "VENDOR"}
        )

    assert allowed == ["stall-a"]


def test_wrong_role_cannot_resolve_vendor_stalls(backend_module):
    with pytest.raises(HTTPException) as error:
        backend_module.get_vendor_stall_ids(
            {"email": "student@example.com", "role": "USER"}
        )

    assert error.value.status_code == 403


def test_duplicate_pickup_is_idempotent_and_does_not_write(backend_module):
    order = {
        "_id": "order-1",
        "token": 1001,
        "pickup_code": "1234",
        "payment_status": backend_module.PaymentStatus.PAID,
        "stall_orders": [
            {
                "stall_id": "stall-a",
                "status": backend_module.StallOrderStatus.READY,
                "picked_up": True,
            }
        ],
    }
    stalls = MagicMock()
    stalls.find.return_value = [{"_id": "stall-a"}]
    orders = MagicMock()
    orders.find_one.return_value = order

    with (
        patch.object(backend_module, "stalls_collection", stalls),
        patch.object(backend_module, "orders_collection", orders),
    ):
        result = run_immediate(
            backend_module.confirm_pickup(
                1001,
                "stall-a",
                "1234",
                {"email": "vendor@example.com", "role": "VENDOR"},
            )
        )

    assert result["duplicate"] is True
    orders.update_one.assert_not_called()


def test_invalid_pickup_code_cannot_mutate_order(backend_module):
    orders = MagicMock()
    orders.find_one.return_value = {
        "_id": "order-1",
        "token": 1001,
        "pickup_code": "1234",
        "payment_status": backend_module.PaymentStatus.PAID,
        "stall_orders": [
            {"stall_id": "stall-a", "status": backend_module.StallOrderStatus.READY, "picked_up": False}
        ],
    }
    stalls = MagicMock()
    stalls.find.return_value = [{"_id": "stall-a"}]
    with (
        patch.object(backend_module, "stalls_collection", stalls),
        patch.object(backend_module, "orders_collection", orders),
    ):
        with pytest.raises(HTTPException) as error:
            run_immediate(backend_module.confirm_pickup(
                1001,
                "stall-a",
                "9999",
                {"email": "vendor@example.com", "role": "VENDOR"},
            ))
    assert error.value.status_code == 403
    orders.update_one.assert_not_called()


def test_multistall_order_completes_only_after_all_verified_pickups(backend_module):
    order = {
        "_id": "order-multi",
        "token": 2001,
        "pickup_code": "4321",
        "payment_status": backend_module.PaymentStatus.PAID,
        "status": backend_module.OrderStatus.READY_FOR_PICKUP,
        "items": [
            {"stall_id": "stall-a"},
            {"stall_id": "stall-b"},
        ],
        "stall_orders": [
            {"stall_id": "stall-a", "status": backend_module.StallOrderStatus.READY, "picked_up": False},
            {"stall_id": "stall-b", "status": backend_module.StallOrderStatus.READY, "picked_up": False},
        ],
    }
    orders = MemoryPickupOrders(order)
    stalls = MagicMock()
    stalls.find.return_value = [{"_id": "stall-a"}, {"_id": "stall-b"}]
    user = {"email": "vendor@example.com", "role": "VENDOR"}
    with (
        patch.object(backend_module, "stalls_collection", stalls),
        patch.object(backend_module, "orders_collection", orders),
        patch.object(backend_module, "safe_emit_order_update", new_callable=AsyncMock),
    ):
        first = run_immediate(backend_module.confirm_pickup(2001, "stall-a", "4321", user))
        assert orders.order["status"] != backend_module.OrderStatus.COMPLETED
        second = run_immediate(backend_module.confirm_pickup(2001, "stall-b", "4321", user))
        duplicate = run_immediate(backend_module.confirm_pickup(2001, "stall-b", "4321", user))

    assert first["success"] and second["success"]
    assert duplicate["duplicate"] is True
    assert orders.order["status"] == backend_module.OrderStatus.COMPLETED
    assert all(row["picked_up"] for row in orders.order["stall_orders"])


def test_vendor_cannot_transition_another_vendors_stall(backend_module):
    orders = MagicMock()
    order = {
        "_id": "order-1",
        "token": 1001,
        "items": [{"stall_id": "stall-a"}],
        "stall_orders": [{"stall_id": "stall-a", "status": backend_module.StallOrderStatus.PENDING}],
    }
    orders.find_one.return_value = order
    request = backend_module.VendorStallStatusUpdate(status=backend_module.StallOrderStatus.ACCEPTED)
    with (
        patch.object(backend_module, "get_vendor_stall_ids", return_value=["stall-b"]),
        patch.object(backend_module, "orders_collection", orders),
    ):
        with pytest.raises(HTTPException) as error:
            run_immediate(backend_module.update_vendor_stall_order_status(
                1001, "stall-a", request, {"email": "vendor-b@example.com", "role": "VENDOR"}
            ))
    assert error.value.status_code == 403
    orders.update_one.assert_not_called()


def test_stale_concurrent_vendor_transition_is_rejected(backend_module):
    orders = MagicMock()
    orders.find_one.return_value = {
        "_id": "order-1",
        "token": 1001,
        "items": [{"stall_id": "stall-a"}],
        "stall_orders": [{"stall_id": "stall-a", "status": backend_module.StallOrderStatus.PENDING}],
    }
    orders.update_one.return_value = SimpleNamespace(matched_count=0)
    request = backend_module.VendorStallStatusUpdate(status=backend_module.StallOrderStatus.ACCEPTED)
    with (
        patch.object(backend_module, "get_vendor_stall_ids", return_value=["stall-a"]),
        patch.object(backend_module, "orders_collection", orders),
    ):
        with pytest.raises(HTTPException) as error:
            run_immediate(backend_module.update_vendor_stall_order_status(
                1001, "stall-a", request, {"email": "vendor-a@example.com", "role": "VENDOR"}
            ))
    assert error.value.status_code == 409


def test_aggregate_status_write_uses_compare_and_swap(backend_module):
    latest = {
        "_id": "order-aggregate",
        "status": backend_module.OrderStatus.READY_FOR_PICKUP,
        "items": [{"stall_id": "stall-a"}],
        "stall_orders": [{
            "stall_id": "stall-a",
            "status": backend_module.StallOrderStatus.READY,
            "picked_up": False,
            "cancelled": False,
        }],
    }
    stale_snapshot = deepcopy(latest)
    stale_snapshot["status"] = backend_module.OrderStatus.COOKING
    orders = MagicMock()
    orders.find_one.side_effect = [stale_snapshot, latest]
    orders.update_one.return_value = SimpleNamespace(matched_count=0)

    with patch.object(backend_module, "orders_collection", orders):
        result = backend_module.persist_aggregate_order_status("order-aggregate")

    assert result["status"] == backend_module.OrderStatus.READY_FOR_PICKUP
    assert orders.update_one.call_args.args[0] == {
        "_id": "order-aggregate",
        "status": backend_module.OrderStatus.COOKING,
    }


def test_vendor_authoritative_order_lifecycle(backend_module):
    order = {
        "_id": "order-flow",
        "token": 3001,
        "payment_status": backend_module.PaymentStatus.PAID,
        "status": backend_module.OrderStatus.PREPARING,
        "items": [{"stall_id": "stall-a"}],
        "stall_orders": [
            {"stall_id": "stall-a", "status": backend_module.StallOrderStatus.PENDING, "picked_up": False}
        ],
    }
    orders = MemoryPickupOrders(order)
    user = {"email": "vendor@example.com", "role": "VENDOR"}
    transitions = [
        (backend_module.StallOrderStatus.ACCEPTED, backend_module.OrderStatus.PREPARING),
        (backend_module.StallOrderStatus.PLACED, backend_module.OrderStatus.PREPARING),
        (backend_module.StallOrderStatus.COOKING, backend_module.OrderStatus.COOKING),
        (backend_module.StallOrderStatus.READY, backend_module.OrderStatus.READY_FOR_PICKUP),
    ]
    with (
        patch.object(backend_module, "get_vendor_stall_ids", return_value=["stall-a"]),
        patch.object(backend_module, "orders_collection", orders),
        patch.object(backend_module, "get_stall_preparation_minutes", return_value=15),
        patch.object(backend_module, "send_order_status_push_notification"),
        patch.object(backend_module, "safe_emit_order_update", new_callable=AsyncMock),
    ):
        for next_stall_status, expected_order_status in transitions:
            response = run_immediate(backend_module.update_vendor_stall_order_status(
                3001,
                "stall-a",
                backend_module.VendorStallStatusUpdate(status=next_stall_status),
                user,
            ))
            assert response["order"]["status"] == expected_order_status
            assert orders.order["stall_orders"][0]["status"] == next_stall_status

        with pytest.raises(HTTPException) as error:
            run_immediate(backend_module.update_vendor_stall_order_status(
                3001,
                "stall-a",
                backend_module.VendorStallStatusUpdate(status=backend_module.StallOrderStatus.COOKING),
                user,
            ))

    assert error.value.status_code == 409


def test_admin_cannot_complete_order_before_pickup_confirmation(backend_module):
    orders = MagicMock()
    orders.find_one.return_value = {
        "_id": backend_module.ObjectId("64b000000000000000000001"),
        "payment_status": backend_module.PaymentStatus.PAID,
        "items": [{"stall_id": "stall-a"}],
        "stall_orders": [
            {
                "stall_id": "stall-a",
                "status": backend_module.StallOrderStatus.READY,
                "picked_up": False,
            }
        ],
    }
    with patch.object(backend_module, "orders_collection", orders):
        with pytest.raises(HTTPException) as error:
            run_immediate(backend_module.update_order_status(
                "64b000000000000000000001",
                backend_module.StatusUpdate(status=backend_module.OrderStatus.COMPLETED),
                {"email": "admin@example.com", "role": "ADMIN"},
            ))
    assert error.value.status_code == 409
    orders.update_one.assert_not_called()


def test_customer_cannot_cancel_after_vendor_preparation_started(backend_module):
    order = {
        "_id": "order-cancel-test",
        "token": 4001,
        "email": "student@example.com",
        "payment_status": backend_module.PaymentStatus.PAID,
        "items": [{"name": "Rice", "stall_id": "stall-a", "quantity": 1, "price": 100.0}],
        "stall_orders": [
            {"stall_id": "stall-a", "status": backend_module.StallOrderStatus.COOKING, "picked_up": False}
        ],
    }
    orders = MagicMock()
    orders.find_one.return_value = order
    refunds = MagicMock()
    refunds.find_one.return_value = None
    request = backend_module.RefundRequestData(reason="Changed my mind")
    with (
        patch.object(backend_module, "orders_collection", orders),
        patch.object(backend_module, "refunds_collection", refunds),
        patch.object(backend_module, "_refund_payment_for_order", return_value={"status": backend_module.PaymentStatus.PAID}),
        patch.object(backend_module, "ensure_refund_eligible_order"),
    ):
        with pytest.raises(HTTPException) as error:
            run_immediate(backend_module.request_customer_refund(
                4001,
                request,
                {"email": "student@example.com", "role": "USER"},
            ))
    assert error.value.status_code == 409
    orders.update_one.assert_not_called()


def test_two_simultaneous_cancellations_of_same_stall_commit_once(backend_module):
    orders = MemoryCancellationOrders(cancellation_order(), barrier=Barrier(2))
    refunds = MemoryRefunds()
    request = backend_module.VendorCancellationRequest(reason="Unavailable")
    with patched_vendor_cancellation(backend_module, orders, refunds) as (_, push, emit):
        def cancel():
            try:
                result = run_immediate(backend_module.cancel_vendor_order_item(
                    8080, "stall-a", 0, request,
                    {"email": "vendor-a@example.com", "role": "VENDOR"},
                ))
                return ("ok", result)
            except HTTPException as error:
                return (error.status_code, None)

        with ThreadPoolExecutor(max_workers=2) as executor:
            results = list(executor.map(lambda _index: cancel(), range(2)))

    assert sorted((result[0] for result in results), key=str) == [409, "ok"]
    assert orders.update_count == 2
    assert len(refunds.rows) == 1
    assert emit.call_count == 1
    assert push.call_count == 1


def test_full_stall_cancellation_preserves_other_stall_and_refunds_once(backend_module):
    orders = MemoryCancellationOrders(cancellation_order(two_stalls=True))
    refunds = MemoryRefunds()
    with patched_vendor_cancellation(backend_module, orders, refunds) as (_, _, emit):
        result = run_immediate(backend_module.cancel_vendor_complete_order(
            "8080",
            "stall-a",
            {"email": "vendor-a@example.com", "role": "VENDOR"},
        ))

    assert result["success"] is True
    assert orders.order["items"][0]["cancelled"] is True
    assert "cancelled" not in orders.order["items"][1]
    assert orders.order["stall_orders"][0]["status"] == backend_module.StallOrderStatus.CANCELLED
    assert orders.order["stall_orders"][1]["status"] == backend_module.StallOrderStatus.PENDING
    assert orders.order["status"] == backend_module.OrderStatus.PREPARING
    assert len(refunds.rows) == 1
    assert refunds.rows[0]["idempotency_key"] == "vendor-stall-cancel-order-1-stall-a"
    assert emit.call_count == 1


def test_cancellation_losing_to_fulfillment_does_not_refund_or_notify(backend_module):
    def fulfillment_wins(order):
        order["stall_orders"][0]["status"] = backend_module.StallOrderStatus.ACCEPTED

    orders = MemoryCancellationOrders(
        cancellation_order(),
        before_update=fulfillment_wins,
    )
    refunds = MemoryRefunds()
    with patched_vendor_cancellation(backend_module, orders, refunds) as (process, push, emit):
        with pytest.raises(HTTPException) as error:
            run_immediate(backend_module.cancel_vendor_order_item(
                8080,
                "stall-a",
                0,
                backend_module.VendorCancellationRequest(reason="Unavailable"),
                {"email": "vendor-a@example.com", "role": "VENDOR"},
            ))

    assert error.value.status_code == 409
    assert orders.order["stall_orders"][0]["status"] == backend_module.StallOrderStatus.ACCEPTED
    assert refunds.rows == []
    process.assert_not_called()
    emit.assert_not_called()
    push.assert_not_called()


def test_two_stalls_cancelling_concurrently_preserve_both_after_retry(backend_module):
    orders = MemoryCancellationOrders(cancellation_order(two_stalls=True), barrier=Barrier(2))
    refunds = MemoryRefunds()
    with patched_vendor_cancellation(backend_module, orders, refunds) as (_, _, emit):
        def cancel(stall_id, item_index):
            try:
                return ("ok", run_immediate(backend_module.cancel_vendor_order_item(
                    8080,
                    stall_id,
                    item_index,
                    backend_module.VendorCancellationRequest(reason="Unavailable"),
                    {"email": f"{stall_id}@example.com", "role": "VENDOR"},
                )))
            except HTTPException as error:
                return (error.status_code, stall_id)

        with ThreadPoolExecutor(max_workers=2) as executor:
            initial = list(executor.map(lambda args: cancel(*args), [("stall-a", 0), ("stall-b", 1)]))
        losing_stall = next(value for code, value in initial if code == 409)
        losing_index = 0 if losing_stall == "stall-a" else 1
        retry = cancel(losing_stall, losing_index)

    assert sum(code == "ok" for code, _ in initial) == 1
    assert retry[0] == "ok"
    assert all(item.get("cancelled") is True for item in orders.order["items"])
    assert all(stall.get("status") == backend_module.StallOrderStatus.CANCELLED for stall in orders.order["stall_orders"])
    assert len(refunds.rows) == 2
    assert emit.call_count == 2


def test_unpaid_vendor_cancellation_is_rejected_before_mutation(backend_module):
    order = cancellation_order()
    order["payment_status"] = backend_module.PaymentStatus.PENDING
    orders = MemoryCancellationOrders(order)
    refunds = MemoryRefunds()
    with patched_vendor_cancellation(backend_module, orders, refunds) as (process, push, emit):
        with pytest.raises(HTTPException) as error:
            run_immediate(backend_module.cancel_vendor_order_item(
                8080,
                "stall-a",
                0,
                backend_module.VendorCancellationRequest(reason="Unavailable"),
                {"email": "vendor-a@example.com", "role": "VENDOR"},
            ))

    assert error.value.status_code == 409
    assert orders.update_count == 0
    assert refunds.rows == []
    process.assert_not_called()
    emit.assert_not_called()
    push.assert_not_called()


def test_vendor_cannot_cancel_after_stall_acceptance(backend_module):
    order = cancellation_order()
    order["stall_orders"][0]["status"] = backend_module.StallOrderStatus.ACCEPTED
    orders = MemoryCancellationOrders(order)
    refunds = MemoryRefunds()
    with patched_vendor_cancellation(backend_module, orders, refunds) as (process, push, emit):
        with pytest.raises(HTTPException) as error:
            run_immediate(backend_module.cancel_vendor_order_item(
                8080,
                "stall-a",
                0,
                backend_module.VendorCancellationRequest(reason="Unavailable"),
                {"email": "vendor-a@example.com", "role": "VENDOR"},
            ))

    assert error.value.status_code == 409
    assert orders.update_count == 0
    assert refunds.rows == []
    process.assert_not_called()
    emit.assert_not_called()
    push.assert_not_called()


def test_vendor_cancellation_rejects_missing_persisted_stall_state(backend_module):
    order = cancellation_order()
    order.pop("stall_orders")
    orders = MemoryCancellationOrders(order)
    refunds = MemoryRefunds()
    with patched_vendor_cancellation(backend_module, orders, refunds) as (process, push, emit):
        with pytest.raises(HTTPException) as error:
            run_immediate(backend_module.cancel_vendor_order_item(
                8080,
                "stall-a",
                0,
                backend_module.VendorCancellationRequest(reason="Unavailable"),
                {"email": "vendor-a@example.com", "role": "VENDOR"},
            ))

    assert error.value.status_code == 409
    assert orders.update_count == 0
    assert refunds.rows == []
    process.assert_not_called()
    emit.assert_not_called()
    push.assert_not_called()


def test_failed_cancellation_cas_rereads_and_emits_nothing(backend_module):
    orders = MemoryCancellationOrders(cancellation_order(), force_miss=True)
    refunds = MemoryRefunds()
    with patched_vendor_cancellation(backend_module, orders, refunds) as (process, push, emit):
        with pytest.raises(HTTPException) as error:
            run_immediate(backend_module.cancel_vendor_order_item(
                8080,
                "stall-a",
                0,
                backend_module.VendorCancellationRequest(reason="Unavailable"),
                {"email": "vendor-a@example.com", "role": "VENDOR"},
            ))

    assert error.value.status_code == 409
    assert orders.update_count == 1
    assert refunds.rows == []
    process.assert_not_called()
    emit.assert_not_called()
    push.assert_not_called()


def test_duplicate_cancellation_reuses_one_refund_intent(backend_module):
    orders = MemoryCancellationOrders(cancellation_order())
    refunds = MemoryRefunds()
    with patched_vendor_cancellation(backend_module, orders, refunds) as (process, push, emit):
        request = backend_module.VendorCancellationRequest(reason="Unavailable")
        first = run_immediate(backend_module.cancel_vendor_order_item(
            8080, "stall-a", 0, request,
            {"email": "vendor-a@example.com", "role": "VENDOR"},
        ))
        second = run_immediate(backend_module.cancel_vendor_order_item(
            8080, "stall-a", 0, request,
            {"email": "vendor-a@example.com", "role": "VENDOR"},
        ))

    assert first["success"] and second["success"]
    assert orders.update_count == 1
    assert len(refunds.rows) == 1
    assert process.call_count == 2
    assert emit.call_count == 1
    assert push.call_count == 1


def test_cancellation_retry_recovers_interrupted_refund_intent(backend_module):
    orders = MemoryCancellationOrders(cancellation_order())
    refunds = MemoryRefunds(fail_first_insert=True)
    with patched_vendor_cancellation(backend_module, orders, refunds) as (process, push, emit):
        request = backend_module.VendorCancellationRequest(reason="Unavailable")
        with pytest.raises(RuntimeError, match="refund intent persistence failure"):
            run_immediate(backend_module.cancel_vendor_order_item(
                8080, "stall-a", 0, request,
                {"email": "vendor-a@example.com", "role": "VENDOR"},
            ))
        recovered = run_immediate(backend_module.cancel_vendor_order_item(
            8080, "stall-a", 0, request,
            {"email": "vendor-a@example.com", "role": "VENDOR"},
        ))

    assert recovered["success"]
    assert orders.update_count == 1
    assert len(refunds.rows) == 1
    assert process.call_count == 1
    assert emit.call_count == 0
    assert push.call_count == 0


def test_provider_failure_keeps_refund_intent_retryable(backend_module):
    refunds = MemoryRefunds()
    refunds.rows.append({
        "_id": "refund-provider-failure",
        "idempotency_key": "vendor-item-order-1-0",
        "order_id": "order-1",
        "payment_id": "pay-1",
        "payment_method": "ONLINE",
        "amount_paise": 5000,
        "status": backend_module.RefundStatus.PENDING,
        "updated_at": datetime.now(timezone.utc),
    })
    provider = MagicMock()
    provider.payment.refund.side_effect = RuntimeError("provider unavailable")

    with (
        patch.object(backend_module, "refunds_collection", refunds),
        patch.object(backend_module, "razorpay_client", provider),
    ):
        with pytest.raises(HTTPException) as error:
            backend_module.process_refund_record("refund-provider-failure")

    assert error.value.status_code == 502
    assert refunds.rows[0]["status"] == backend_module.RefundStatus.FAILED
    assert refunds.rows[0]["idempotency_key"] == "vendor-item-order-1-0"
    assert "provider unavailable" in refunds.rows[0]["failure_reason"]


def test_provider_success_with_interrupted_persistence_retries_same_refund_key(backend_module):
    refunds = MemoryRefunds()
    refunds.rows.append({
        "_id": "refund-provider-recovery",
        "idempotency_key": "vendor-item-order-2-0",
        "order_id": "order-2",
        "payment_id": "pay-2",
        "payment_method": "ONLINE",
        "amount_paise": 7500,
        "status": backend_module.RefundStatus.PENDING,
        "updated_at": datetime.now(timezone.utc),
    })
    # Simulate Razorpay accepting the refund while Mongo temporarily fails
    # to persist the provider response. Retrying must reuse the same key.
    refunds.fail_updates = lambda fields: "razorpay_refund_id" in fields
    provider = MagicMock()
    provider.payment.refund.return_value = {"id": "rfnd-stable-2"}

    with (
        patch.object(backend_module, "refunds_collection", refunds),
        patch.object(backend_module, "razorpay_client", provider),
    ):
        with pytest.raises(HTTPException) as error:
            backend_module.process_refund_record("refund-provider-recovery")
        assert error.value.status_code == 502
        assert refunds.rows[0]["status"] == backend_module.RefundStatus.FAILED

        refunds.fail_updates = None
        recovered = backend_module.process_refund_record("refund-provider-recovery")

    assert recovered["razorpay_refund_id"] == "rfnd-stable-2"
    assert refunds.rows[0]["status"] == backend_module.RefundStatus.PROCESSING
    assert provider.payment.refund.call_count == 2
    assert [
        call.kwargs["headers"]["X-Refund-Idempotency"]
        for call in provider.payment.refund.call_args_list
    ] == ["vendor-item-order-2-0", "vendor-item-order-2-0"]
