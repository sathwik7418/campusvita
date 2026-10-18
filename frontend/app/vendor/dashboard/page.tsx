"use client";

import { startTransition, useEffect, useMemo, useState } from "react";
import { useTheme } from "next-themes";
import {
  AlertTriangle,
  Check,
  ChevronRight,
  Clock3,
  CookingPot,
  LogOut,
  Moon,
  PackageCheck,
  RefreshCw,
  Store,
  Sun,
  TimerReset,
  UserRound,
  XCircle,
} from "lucide-react";
import VendorSidebar from "@/components/vendor/vendor-sidebar";

import {
  clearSession,
  getAccessToken,
} from "@/app/lib/auth/session";

const API_URL =
  process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000";

type VendorItem = {
  name: string;
  price: number;
  quantity: number;
  image?: string;
  stall_id?: string;
  cancelled?: boolean;
  cancellationReason?: string | null;
};

type StallOrder = {
  stall_id: string;
  status: string;
  estimatedPreparationMinutes: number;
  cookingStartedAt?: string | null;
  readyAt?: string | null;
  cancelledAt?: string | null;
  cancellationReason?: string | null;
};

type VendorOrder = {
  order_id: string;
  token?: number;
  name?: string;
  total: number;
  status: string;
  created_at?: string;
  cancelled?: boolean;
  cancelledAt?: string | null;
  cancellationReason?: string | null;
  items: VendorItem[];
  stall_orders: StallOrder[];
};

type VendorOrdersResponse = {
  success: boolean;
  orders: VendorOrder[];
  today_revenue?: number;
};

type Action = {
  label: string;
  next: string;
};

const STATUS_ORDER = [
  "Pending",
  "Accepted",
  "Placed",
  "Cooking",
  "Ready For Pickup",
];

function formatMoney(value: number) {
  return `₹${Number(value || 0).toFixed(2)}`;
}

function getImageUrl(image?: string) {
  if (!image) return "";

  if (
    image.startsWith("http://") ||
    image.startsWith("https://") ||
    image.startsWith("data:")
  ) {
    return image;
  }

  return `${API_URL}${image.startsWith("/") ? image : `/${image}`}`;
}

function getNextAction(status: string): Action | null {
  switch (status) {
    case "Pending":
      return { label: "Accept Order", next: "Accepted" };

    case "Accepted":
      return { label: "Place Order", next: "Placed" };

    case "Placed":
      return { label: "Start Cooking", next: "Cooking" };

    case "Cooking":
      return { label: "Mark Ready", next: "Ready For Pickup" };

    default:
      return null;
  }
}

function getStatusLabel(status: string) {
  switch (status) {
    case "Pending":
      return "New Order";
    case "Accepted":
      return "Accepted";
    case "Placed":
      return "Placed";
    case "Cooking":
      return "Preparing";
    case "Ready For Pickup":
      return "Ready";
    case "Cancelled":
      return "Cancelled";
    default:
      return status;
  }
}

function getStatusIcon(status: string) {
  switch (status) {
    case "Pending":
      return Clock3;
    case "Accepted":
      return Check;
    case "Placed":
      return PackageCheck;
    case "Cooking":
      return CookingPot;
    case "Ready For Pickup":
      return Check;
    case "Cancelled":
      return XCircle;
    default:
      return Clock3;
  }
}

function getStatusStyles(status: string) {
  switch (status) {
    case "Pending":
      return {
        badge:
          "border-[color-mix(in_srgb,var(--warning)_30%,transparent)] bg-[var(--warning-soft)] text-[var(--warning)]",
        badgeDark:
          "dark:border-[color-mix(in_srgb,var(--warning)_40%,transparent)]",
        dot:
          "bg-[var(--warning)]",
        dotDark:
          "dark:bg-[var(--warning)]",
      };

    case "Accepted":
      return {
        badge:
          "border-[color-mix(in_srgb,var(--info)_30%,transparent)] bg-[var(--info-soft)] text-[var(--info)]",
        badgeDark:
          "dark:border-[color-mix(in_srgb,var(--info)_40%,transparent)]",
        dot:
          "bg-[var(--info)]",
        dotDark:
          "dark:bg-[var(--info)]",
      };

    case "Placed":
      return {
        badge:
          "border-[var(--border)] bg-[var(--surface-secondary)] text-[var(--text-secondary)]",
        badgeDark:
          "dark:border-[var(--border)]",
        dot:
          "bg-[var(--text-secondary)]",
        dotDark:
          "dark:bg-[var(--text-secondary)]",
      };

    case "Cooking":
      return {
        badge:
          "border-[color-mix(in_srgb,var(--info)_30%,transparent)] bg-[var(--info-soft)] text-[var(--info)]",
        badgeDark:
          "dark:border-[color-mix(in_srgb,var(--info)_40%,transparent)]",
        dot:
          "bg-[var(--info)]",
        dotDark:
          "dark:bg-[var(--info)]",
      };

    case "Ready For Pickup":
      return {
        badge:
          "border-[color-mix(in_srgb,var(--success)_30%,transparent)] bg-[var(--success-soft)] text-[var(--success)]",
        badgeDark:
          "dark:border-[color-mix(in_srgb,var(--success)_40%,transparent)]",
        dot:
          "bg-[var(--success)]",
        dotDark:
          "dark:bg-[var(--success)]",
      };

    case "Cancelled":
      return {
        badge:
          "border-[color-mix(in_srgb,var(--danger)_30%,transparent)] bg-[var(--danger-soft)] text-[var(--danger)]",
        badgeDark:
          "dark:border-[color-mix(in_srgb,var(--danger)_40%,transparent)]",
        dot:
          "bg-[var(--danger)]",
        dotDark:
          "dark:bg-[var(--danger)]",
      };

    default:
      return {
        badge:
          "border-[var(--border)] bg-[var(--surface-secondary)] text-[var(--text-muted)]",
        badgeDark:
          "dark:border-[var(--border)]",
        dot:
          "bg-[var(--text-muted)]",
        dotDark:
          "dark:bg-[var(--text-muted)]",
      };
  }
}

function formatDate(value?: string) {
  if (!value) return "";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return date.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getRemainingSeconds(
  cookingStartedAt?: string | null,
  preparationMinutes?: number
) {
  if (!cookingStartedAt || !preparationMinutes) {
    return null;
  }

  const started = new Date(cookingStartedAt).getTime();

  if (Number.isNaN(started)) {
    return null;
  }

  const totalSeconds = Number(preparationMinutes) * 60;

  const elapsedSeconds = Math.floor(
    (Date.now() - started) / 1000
  );

  return Math.max(0, totalSeconds - elapsedSeconds);
}

function formatCountdown(seconds: number | null) {
  if (seconds === null) {
    return "--:--";
  }

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;

  return `${String(minutes).padStart(2, "0")}:${String(
    remainingSeconds
  ).padStart(2, "0")}`;
}

function getProgress(status: string) {
  const index = STATUS_ORDER.indexOf(status);

  if (index === -1) {
    return 0;
  }

  return ((index + 1) / STATUS_ORDER.length) * 100;
}

export default function VendorDashboardPage() {
  const [orders, setOrders] = useState<VendorOrder[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [todayRevenue, setTodayRevenue] = useState(0);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  const [updatingKey, setUpdatingKey] = useState<string | null>(null);
  const [cancellingKey, setCancellingKey] = useState<string | null>(null);

  const [, setTimerTick] = useState(0);

  // ============================================================
  // THEME
  // ============================================================

  const { resolvedTheme, setTheme } = useTheme();
  const isDark = resolvedTheme === "dark";

  const toggleTheme = () => {
    setTheme(isDark ? "light" : "dark");
  };

  // ============================================================
  // LOGOUT
  // ============================================================

  const handleLogout = () => {
    clearSession("VENDOR");
    window.location.href = "/login";
  };

  // ============================================================
  // LOAD ORDERS
  // ============================================================

  const loadOrders = async (showRefreshing = false) => {
    try {
      if (showRefreshing) {
        setRefreshing(true);
      }

      const token = getAccessToken("VENDOR");

      if (!token) {
        // Defer the error state update until after this async task yields.
        await Promise.resolve();
        throw new Error(
          "Vendor session expired. Please log in again."
        );
      }

      const response = await fetch(
        `${API_URL}/vendor/orders`,
        {
          method: "GET",
          headers: {
            Authorization: `Bearer ${token}`,
          },
          cache: "no-store",
        }
      );

      const data: VendorOrdersResponse =
        await response.json();

      setError("");

      if (!response.ok) {
        throw new Error(
          (data as unknown as { detail?: string }).detail ||
            "Failed to load vendor orders."
        );
      }

      setOrders(
        Array.isArray(data.orders)
          ? data.orders
          : []
      );

      setTodayRevenue(
        Number(data.today_revenue || 0)
      );
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Failed to load vendor orders."
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  // ============================================================
  // INITIAL LOAD + LIVE POLLING
  // ============================================================

  useEffect(() => {
    startTransition(() => {
      void loadOrders();
    });

    const interval = setInterval(() => {
      loadOrders();
    }, 5000);

    return () => clearInterval(interval);
  }, []);

  // ============================================================
  // TIMER
  // ============================================================

  useEffect(() => {
    const timer = setInterval(() => {
      setTimerTick((value) => value + 1);
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  // ============================================================
  // STATISTICS
  // ============================================================

  const statistics = useMemo(() => {
    let pending = 0;
    let cooking = 0;
    let ready = 0;
    let cancelled = 0;

    orders.forEach((order) => {
      if (
        order.cancelled ||
        order.status === "Cancelled"
      ) {
        cancelled += 1;
        return;
      }

      order.stall_orders.forEach((stallOrder) => {
        if (stallOrder.status === "Pending") {
          pending += 1;
        }

        if (stallOrder.status === "Cooking") {
          cooking += 1;
        }

        if (
          stallOrder.status ===
          "Ready For Pickup"
        ) {
          ready += 1;
        }
      });
    });

    return {
      total: orders.length,
      pending,
      cooking,
      ready,
      cancelled,
    };
  }, [orders]);

  // ============================================================
  // UPDATE STATUS
  // ============================================================

  const updateStatus = async (
    order: VendorOrder,
    stallOrder: StallOrder,
    nextStatus: string
  ) => {
    const updateKey = `${order.order_id}-${stallOrder.stall_id}`;

    try {
      setUpdatingKey(updateKey);
      setError("");

      const token = getAccessToken("VENDOR");

      if (!token) {
        throw new Error("Vendor session expired.");
      }

      const response = await fetch(
        `${API_URL}/vendor/orders/${order.token}/status?stall_id=${encodeURIComponent(
          stallOrder.stall_id
        )}`,
        {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            status: nextStatus,
          }),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.detail ||
            "Unable to update order status."
        );
      }

      await loadOrders();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Unable to update order status."
      );
    } finally {
      setUpdatingKey(null);
    }
  };

  // ============================================================
  // CANCEL STALL ORDER
  // ============================================================

  const cancelCompleteOrder = async (
    order: VendorOrder,
    stallOrder: StallOrder
  ) => {
    const orderNumber =
      order.token ?? order.order_id;

    const confirmed = window.confirm(
      `Cancel this stall order from Order #${orderNumber}?\n\nOnly this stall's items will be cancelled. Items from other stalls will remain active.`
    );

    if (!confirmed) {
      return;
    }

    const key = `order-${order.order_id}-${stallOrder.stall_id}`;

    try {
      setCancellingKey(key);
      setError("");

      const token = getAccessToken("VENDOR");

      if (!token) {
        throw new Error("Vendor session expired.");
      }

      const response = await fetch(
        `${API_URL}/vendor/orders/${order.token}/cancel?stall_id=${encodeURIComponent(
          stallOrder.stall_id
        )}`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            reason:
              "Stall order cancelled by vendor",
          }),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.detail ||
            "Unable to cancel stall order."
        );
      }

      await loadOrders();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Unable to cancel stall order."
      );
    } finally {
      setCancellingKey(null);
    }
  };

  // ============================================================
  // CANCEL ITEM
  // ============================================================

  const cancelItem = async (
    order: VendorOrder,
    stallOrder: StallOrder,
    itemIndex: number,
    item: VendorItem
  ) => {
    const confirmed = window.confirm(
      `Cancel "${item.name}" from Order #${
        order.token ?? order.order_id
      }?\n\nOnly this item will be cancelled.`
    );

    if (!confirmed) {
      return;
    }

    const key = `item-${order.order_id}-${stallOrder.stall_id}-${itemIndex}`;

    try {
      setCancellingKey(key);
      setError("");

      const token = getAccessToken("VENDOR");

      if (!token) {
        throw new Error("Vendor session expired.");
      }

      const response = await fetch(
        `${API_URL}/vendor/orders/${order.token}/items/cancel?stall_id=${encodeURIComponent(
          stallOrder.stall_id
        )}&item_index=${itemIndex}`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            reason:
              "Item cancelled by vendor",
          }),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.detail ||
            "Unable to cancel item."
        );
      }

      await loadOrders();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Unable to cancel item."
      );
    } finally {
      setCancellingKey(null);
    }
  };

  // ============================================================
  // LOADING
  // ============================================================

  if (loading) {
    return (
      <div className="flex min-h-screen bg-[var(--background)] text-[var(--foreground)]">
        <VendorSidebar
          open={sidebarOpen}
          setOpen={setSidebarOpen}
          onLogout={handleLogout}
        />
        <main
          className={`min-w-0 min-h-screen flex-1 transition-colors duration-300 ${
            isDark
              ? "bg-[var(--background)] text-white"
              : "bg-[var(--background)] text-[var(--text-primary)]"
          }`}
        >
        <div className="mx-auto max-w-[1500px] px-4 py-6 sm:px-6 lg:px-8">
          <div className="animate-pulse">
            <div className="h-8 w-40 rounded-lg bg-[var(--surface-secondary)]" />

            <div className="mt-3 h-4 w-64 rounded bg-[var(--surface-tertiary)]" />

            <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {[1, 2, 3, 4].map((item) => (
                <div
                  key={item}
                  className="h-28 rounded-2xl border border-[var(--border)] bg-[var(--surface)]"
                />
              ))}
            </div>

            <div className="mt-8 h-72 rounded-3xl border border-[var(--border)] bg-[var(--surface)]" />
          </div>
        </div>
        </main>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-[var(--background)] text-[var(--foreground)]">
      <VendorSidebar
        open={sidebarOpen}
        setOpen={setSidebarOpen}
        onLogout={handleLogout}
      />
      <main
        className={`min-w-0 min-h-screen flex-1 transition-colors duration-300 ${
          isDark
            ? "bg-[var(--background)] text-white"
            : "bg-[var(--background)] text-[var(--text-primary)]"
        }`}
      >
      {/* HEADER */}

      <header className="cv-glass-elevated sticky top-0 z-40 transition-colors duration-300">
        <div className="mx-auto flex h-[72px] max-w-[1500px] items-center justify-between px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--primary)] shadow-[var(--shadow-soft)]">
              <Store className="h-5 w-5 text-[var(--on-primary)]" />
            </div>

            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[var(--text-muted)]">
                CampusVita
              </p>

              <h1 className="text-base font-bold tracking-tight">
                Vendor Portal
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={toggleTheme}
              aria-label={
                isDark
                  ? "Switch to light theme"
                  : "Switch to dark theme"
              }
              title={
                isDark
                  ? "Switch to light theme"
                  : "Switch to dark theme"
              }
              className="group flex h-10 w-10 items-center justify-center rounded-xl border border-[var(--border)] bg-[var(--surface)] text-[var(--text-secondary)] transition hover:border-[var(--border-strong)] hover:bg-[var(--surface-secondary)] hover:text-[var(--text-primary)]"
            >
              {isDark ? (
                <Sun className="h-4 w-4 transition-transform duration-300 group-hover:rotate-12" />
              ) : (
                <Moon className="h-4 w-4 transition-transform duration-300 group-hover:-rotate-12" />
              )}
            </button>

            <button
              type="button"
              onClick={() => loadOrders(true)}
              disabled={refreshing}
              aria-label="Refresh orders"
              title="Refresh orders"
              className="group flex h-10 w-10 items-center justify-center rounded-xl border border-[var(--border)] bg-[var(--surface)] text-[var(--text-secondary)] transition hover:border-[var(--border-strong)] hover:bg-[var(--surface-secondary)] hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <RefreshCw
                className={`h-4 w-4 ${
                  refreshing ? "animate-spin" : ""
                }`}
              />
            </button>

            <button
              type="button"
              onClick={handleLogout}
              aria-label="Log out"
              title="Log out"
              className="flex h-10 w-10 items-center justify-center rounded-xl border border-[var(--border)] bg-[var(--surface)] text-[var(--text-secondary)] transition hover:border-[color-mix(in_srgb,var(--danger)_35%,transparent)] hover:bg-[var(--danger-soft)] hover:text-[var(--danger)]"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-[1500px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
        {/* HERO */}

        <section className="relative overflow-hidden rounded-[28px] border border-[var(--border-strong)] bg-[var(--surface-secondary)] p-5 shadow-[var(--shadow-soft)] transition-colors duration-300 sm:p-7 lg:p-8">
          <div className="absolute -right-20 -top-32 h-72 w-72 rounded-full bg-[var(--primary)]/[0.04] blur-3xl" />

          <div className="absolute -bottom-40 left-1/3 h-72 w-72 rounded-full bg-[var(--primary)]/[0.03] blur-3xl" />

          <div className="relative flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-xs font-semibold text-[var(--text-secondary)]">
                <span className="h-1.5 w-1.5 rounded-full bg-[var(--success)] shadow-none" />
                LIVE VENDOR DASHBOARD
              </div>

              <h2 className="text-3xl font-bold tracking-tight text-[var(--text-primary)] sm:text-4xl lg:text-5xl">
                My Stall
              </h2>

              <p className="mt-3 max-w-xl text-sm leading-6 text-[var(--text-secondary)] sm:text-base">
                Manage incoming orders, prepare food, and keep
                customers updated in real time.
              </p>
            </div>

            <div className="cv-glass-subtle cv-glass-edge flex items-center gap-3 rounded-2xl border border-[var(--glass-border)] px-4 py-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--surface-tertiary)]">
                <Store className="h-5 w-5 text-[var(--text-secondary)]" />
              </div>

              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--text-muted)]">
                  Today&apos;s Revenue
                </p>

                <p className="cv-tnum mt-0.5 text-xl font-bold text-[var(--text-primary)]">
                  {formatMoney(todayRevenue)}
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* ERROR */}

        {error && (
          <div className="mt-5 flex items-start gap-3 rounded-2xl border border-[color-mix(in_srgb,var(--danger)_25%,transparent)] bg-[var(--danger-soft)] px-4 py-3 text-sm text-[var(--danger)] dark:text-red-300">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <p>{error}</p>
          </div>
        )}

        {/* STATISTICS */}

        <section className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-5">
          {[
            {
              label: "Orders",
              value: statistics.total,
              description: "Active order groups",
              valueClass:
                "text-[var(--text-primary)]",
            },
            {
              label: "Pending",
              value: statistics.pending,
              description: "Need attention",
              valueClass:
                "text-[var(--warning)]",
            },
            {
              label: "Cooking",
              value: statistics.cooking,
              description: "Currently preparing",
              valueClass:
                "text-[var(--info)]",
            },
            {
              label: "Ready",
              value: statistics.ready,
              description: "Waiting for pickup",
              valueClass:
                "text-[var(--success)]",
            },
            {
              label: "Cancelled",
              value: statistics.cancelled,
              description: "Cancelled orders",
              valueClass:
                "text-[var(--danger)]",
            },
          ].map((stat) => (
            <div
              key={stat.label}
              className="cv-glass-card rounded-2xl p-4 transition-colors duration-300 sm:p-5"
            >
              <p className="text-xs font-medium text-[var(--text-muted)]">
                {stat.label}
              </p>

              <p
                className={`cv-tnum mt-4 text-2xl font-bold ${stat.valueClass}`}
              >
                {stat.value}
              </p>

              <p className="mt-1 text-[11px] text-[var(--text-muted)]">
                {stat.description}
              </p>
            </div>
          ))}
        </section>

        {/* ORDERS HEADER */}

        <div className="mb-4 mt-8 flex items-end justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--text-muted)]">
              Order Management
            </p>

            <h3 className="mt-1 text-xl font-bold tracking-tight sm:text-2xl">
              Incoming Orders
            </h3>
          </div>

          <p className="hidden text-xs text-[var(--text-muted)] sm:block">
            Live updates every few seconds
          </p>
        </div>

        {/* EMPTY */}

        {orders.length === 0 ? (
          <section className="cv-glass-card cv-glass-edge rounded-[28px] border border-[var(--glass-border)] px-6 py-16 text-center transition-colors duration-300">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-[var(--surface-tertiary)]">
              <PackageCheck className="h-7 w-7 text-[var(--text-muted)]" />
            </div>

            <h3 className="mt-5 text-xl font-bold">
              No orders yet
            </h3>

            <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[var(--text-secondary)]">
              Orders containing items from your assigned stall
              will appear here automatically.
            </p>
          </section>
        ) : (
          <section className="space-y-5">
            {orders.map((order) =>
              order.stall_orders.map((stallOrder) => {
                const orderCancelled =
                  order.cancelled ||
                  order.status === "Cancelled";

                const stallCancelled =
                  stallOrder.status === "Cancelled" ||
                  Boolean(stallOrder.cancelledAt);

                const action =
                  orderCancelled || stallCancelled
                    ? null
                    : getNextAction(stallOrder.status);

                const statusForDisplay =
                  orderCancelled || stallCancelled
                    ? "Cancelled"
                    : stallOrder.status;

                const statusStyles =
                  getStatusStyles(statusForDisplay);

                const StatusIcon =
                  getStatusIcon(statusForDisplay);

                const stallItems = order.items
                  .map((item, originalIndex) => ({
                    item,
                    originalIndex,
                  }))
                  .filter(
                    ({ item }) =>
                      String(item.stall_id) ===
                      String(stallOrder.stall_id)
                  );

                const updateKey = `${order.order_id}-${stallOrder.stall_id}`;

                const isUpdating =
                  updatingKey === updateKey;

                const remainingSeconds =
                  getRemainingSeconds(
                    stallOrder.cookingStartedAt,
                    stallOrder.estimatedPreparationMinutes
                  );

                const isTakingLonger =
                  stallOrder.status === "Cooking" &&
                  remainingSeconds === 0;

                const progress =
                  orderCancelled || stallCancelled
                    ? 100
                    : getProgress(stallOrder.status);

                const vendorTotal =
                  stallItems.reduce(
                    (sum, { item }) => {
                      if (item.cancelled) {
                        return sum;
                      }

                      return (
                        sum +
                        Number(item.price || 0) *
                          Number(item.quantity || 0)
                      );
                    },
                    0
                  );

                const cancelOrderKey =
                  `order-${order.order_id}-${stallOrder.stall_id}`;

                const cancellingStallOrder =
                  cancellingKey === cancelOrderKey;

                return (
                  <article
                    key={updateKey}
                    className={`cv-glass-card cv-glass-edge overflow-hidden rounded-[28px] border border-[var(--glass-border)] transition-colors duration-300 ${
                      orderCancelled || stallCancelled
                        ? "border-[color-mix(in_srgb,var(--danger)_25%,transparent)]"
                        : "border-[var(--border)]"
                    }`}
                  >
                    {/* ORDER HEADER */}

                    <div className="border-b border-[var(--border)] p-4 transition-colors duration-300 sm:p-5 lg:p-6">
                      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                        <div className="flex items-center gap-3">
                          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[var(--surface-tertiary)]">
                            <UserRound className="h-5 w-5 text-[var(--text-secondary)]" />
                          </div>

                          <div>
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="cv-tnum font-bold">
                                Order #
                                {order.token ??
                                  order.order_id}
                              </p>

                              <span className="h-1 w-1 rounded-full bg-[var(--border-strong)]" />

                              <span className="cv-tnum text-xs text-[var(--text-muted)]">
                                {formatDate(
                                  order.created_at
                                )}
                              </span>
                            </div>

                            <p className="mt-1 text-sm text-[var(--text-secondary)]">
                              {order.name || "Customer"}
                            </p>
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center gap-3 lg:justify-end">
                          <div>
                            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--text-muted)]">
                              Your Total
                            </p>

                            <p className="cv-tnum mt-1 text-xl font-bold text-[var(--text-primary)]">
                              {formatMoney(vendorTotal)}
                            </p>
                          </div>

                          <div
                            className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold ${statusStyles.badge} ${statusStyles.badgeDark}`}
                          >
                            <span
                              className={`h-1.5 w-1.5 rounded-full ${statusStyles.dot} ${statusStyles.dotDark}`}
                            />

                            {getStatusLabel(
                              statusForDisplay
                            )}
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* BODY */}

                    <div className="p-4 sm:p-5 lg:p-6">
                      <div className="grid gap-6 lg:grid-cols-[1fr_280px]">
                        {/* ITEMS */}

                        <div>
                          <div className="mb-4 flex items-center justify-between">
                            <div>
                              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--text-muted)]">
                                Order Items
                              </p>

                              <p className="mt-1 text-sm font-semibold text-[var(--text-secondary)]">
                                {stallItems.length}{" "}
                                {stallItems.length === 1
                                  ? "item"
                                  : "items"}
                              </p>
                            </div>

                            <div className="hidden items-center gap-2 text-xs text-[var(--text-muted)] sm:flex">
                              <Store className="h-3.5 w-3.5" />
                              Your Stall
                            </div>
                          </div>

                          <div className="space-y-3">
                            {stallItems.map(
                              ({
                                item,
                                originalIndex,
                              }) => {
                                const imageUrl =
                                  getImageUrl(item.image);

                                const lineTotal =
                                  Number(item.price || 0) *
                                  Number(item.quantity || 0);

                                const itemCancelled =
                                  Boolean(item.cancelled);

                                const itemCancelKey =
                                  `item-${order.order_id}-${stallOrder.stall_id}-${originalIndex}`;

                                const cancellingItem =
                                  cancellingKey ===
                                  itemCancelKey;

                                return (
                                  <div
                                    key={`${item.name}-${originalIndex}`}
                                    className={`rounded-2xl border p-3 transition sm:p-4 ${
                                      itemCancelled
                                        ? "border-[color-mix(in_srgb,var(--danger)_20%,transparent)] bg-[var(--danger-soft)]"
                                        : "border-[var(--border)] bg-[var(--surface-secondary)]"
                                    }`}
                                  >
                                    <div className="flex items-center gap-3 sm:gap-4">
                                      <div className="relative h-[72px] w-[72px] shrink-0 overflow-hidden rounded-xl bg-[var(--surface-tertiary)] sm:h-[84px] sm:w-[84px]">
                                        {imageUrl ? (
                                          <img
                                            src={imageUrl}
                                            alt={item.name}
                                            className={`h-full w-full object-cover ${
                                              itemCancelled
                                                ? "opacity-30 grayscale"
                                                : ""
                                            }`}
                                          />
                                        ) : (
                                          <div className="flex h-full w-full items-center justify-center">
                                            <CookingPot className="h-6 w-6 text-[var(--text-muted)]" />
                                          </div>
                                        )}

                                        {itemCancelled && (
                                          <div className="absolute inset-0 flex items-center justify-center">
                                            <XCircle className="h-7 w-7 text-[var(--danger)]" />
                                          </div>
                                        )}
                                      </div>

                                      <div className="min-w-0 flex-1">
                                        <h4
                                          className={`truncate text-sm font-bold sm:text-base ${
                                            itemCancelled
                                              ? "text-[var(--text-muted)] line-through"
                                              : "text-[var(--text-primary)]"
                                          }`}
                                        >
                                          {item.name}
                                        </h4>

                                        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--text-muted)]">
                                          <span>
                                            Qty:{" "}
                                            <span className="cv-tnum font-semibold text-[var(--text-secondary)]">
                                              {item.quantity}
                                            </span>
                                          </span>

                                          <span className="h-1 w-1 rounded-full bg-[var(--border-strong)]" />

                                          <span className="cv-tnum">
                                            {formatMoney(
                                              Number(item.price)
                                            )}{" "}
                                            each
                                          </span>
                                        </div>

                                        {itemCancelled && (
                                          <p className="mt-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--danger)] dark:text-red-400">
                                            Item Cancelled
                                          </p>
                                        )}
                                      </div>

                                      <div className="shrink-0 text-right">
                                        <p
                                          className={`cv-tnum text-sm font-bold sm:text-base ${
                                            itemCancelled
                                              ? "text-[var(--text-muted)] line-through"
                                              : "text-[var(--text-primary)]"
                                          }`}
                                        >
                                          {formatMoney(lineTotal)}
                                        </p>
                                      </div>
                                    </div>

                                    {!itemCancelled &&
                                      !orderCancelled &&
                                      !stallCancelled && (
                                        <button
                                          type="button"
                                          disabled={
                                            cancellingItem ||
                                            Boolean(cancellingKey)
                                          }
                                          onClick={() =>
                                            cancelItem(
                                              order,
                                              stallOrder,
                                              originalIndex,
                                              item
                                            )
                                          }
                                          className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-[color-mix(in_srgb,var(--danger)_20%,transparent)] bg-[var(--danger-soft)] px-3 py-2 text-xs font-semibold text-[var(--danger)] transition hover:border-[color-mix(in_srgb,var(--danger)_40%,transparent)] hover:bg-[color-mix(in_srgb,var(--danger)_12%,transparent)] disabled:cursor-not-allowed disabled:opacity-40 dark:text-red-300 dark:hover:text-red-200 sm:ml-auto sm:w-auto"
                                        >
                                          {cancellingItem ? (
                                            <>
                                              <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                                              Cancelling...
                                            </>
                                          ) : (
                                            <>
                                              <XCircle className="h-3.5 w-3.5" />
                                              Cancel Item
                                            </>
                                          )}
                                        </button>
                                      )}
                                  </div>
                                );
                              }
                            )}
                          </div>
                        </div>

                        {/* STATUS */}

                        <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-secondary)] p-4 transition-colors duration-300">
                          <div className="flex items-center justify-between">
                            <div>
                              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--text-muted)]">
                                Order Status
                              </p>

                              <p className="mt-1 text-sm font-bold">
                                {getStatusLabel(
                                  statusForDisplay
                                )}
                              </p>
                            </div>

                            <div
                              className={`flex h-9 w-9 items-center justify-center rounded-xl ${statusStyles.badge} ${statusStyles.badgeDark}`}
                            >
                              <StatusIcon className="h-4 w-4" />
                            </div>
                          </div>

                          {!orderCancelled &&
                            !stallCancelled && (
                              <div className="mt-5">
                                <div className="h-1.5 overflow-hidden rounded-full bg-[var(--surface-tertiary)]">
                                  <div
                                    className="h-full rounded-full bg-[var(--primary)] transition-all duration-500"
                                    style={{
                                      width: `${progress}%`,
                                    }}
                                  />
                                </div>

                                <div className="mt-2 flex justify-between text-[9px] font-medium uppercase tracking-wider text-[var(--text-muted)]">
                                  <span>New</span>
                                  <span>Cooking</span>
                                  <span>Ready</span>
                                </div>
                              </div>
                            )}

                          {stallOrder.status ===
                            "Cooking" &&
                            !orderCancelled &&
                            !stallCancelled && (
                              <div
                                className={`mt-5 rounded-xl border p-3 ${
                                  isTakingLonger
                                    ? "border-[color-mix(in_srgb,var(--warning)_30%,transparent)] bg-[var(--warning-soft)]"
                                    : "border-[var(--border)] bg-[var(--surface)]"
                                }`}
                              >
                                <div className="flex items-center justify-between">
                                  <div className="flex items-center gap-2">
                                    <TimerReset
                                      className={`h-4 w-4 ${
                                        isTakingLonger
                                          ? "text-[var(--warning)]"
                                          : "text-[var(--text-secondary)]"
                                      }`}
                                    />

                                    <span
                                      className={`text-xs font-semibold ${
                                        isTakingLonger
                                          ? "text-[var(--warning)]"
                                          : "text-[var(--text-secondary)]"
                                      }`}
                                    >
                                      Preparation
                                    </span>
                                  </div>

                                  <span
                                    className={`cv-tnum font-mono text-sm font-bold ${
                                      isTakingLonger
                                        ? "text-[var(--warning)]"
                                        : "text-[var(--text-primary)]"
                                    }`}
                                  >
                                    {formatCountdown(
                                      remainingSeconds
                                    )}
                                  </span>
                                </div>

                                {isTakingLonger ? (
                                  <p className="mt-2 text-[11px] leading-4 text-[var(--warning)]">
                                    Taking longer than expected.
                                    Mark the order ready when it
                                    is actually prepared.
                                  </p>
                                ) : (
                                  <p className="mt-2 text-[11px] text-[var(--text-muted)]">
                                    Estimated preparation:{" "}
                                    {
                                      stallOrder.estimatedPreparationMinutes
                                    }{" "}
                                    min
                                  </p>
                                )}
                              </div>
                            )}

                          {stallOrder.status ===
                            "Ready For Pickup" &&
                            !orderCancelled &&
                            !stallCancelled && (
                              <div className="mt-5 rounded-xl border border-[color-mix(in_srgb,var(--success)_30%,transparent)] bg-[var(--success-soft)] p-3">
                                <div className="flex items-center gap-2">
                                  <div className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--success-soft)]">
                                    <Check className="h-3.5 w-3.5 text-[var(--success)] dark:text-emerald-400" />
                                  </div>

                                  <div>
                                    <p className="text-xs font-bold text-[var(--success)] dark:text-emerald-300">
                                      Ready for pickup
                                    </p>

                                    <p className="mt-0.5 text-[10px] text-[var(--text-muted)]">
                                      Customer can collect the
                                      order
                                    </p>
                                  </div>
                                </div>
                              </div>
                            )}

                          {(orderCancelled ||
                            stallCancelled) && (
                            <div className="mt-5 rounded-xl border border-[color-mix(in_srgb,var(--danger)_30%,transparent)] bg-[var(--danger-soft)] p-3">
                              <div className="flex items-center gap-2">
                                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--danger-soft)]">
                                  <XCircle className="h-4 w-4 text-[var(--danger)] dark:text-red-400" />
                                </div>

                                <div>
                                  <p className="text-xs font-bold text-[var(--danger)] dark:text-red-300">
                                    {orderCancelled
                                      ? "Order cancelled"
                                      : "Stall order cancelled"}
                                  </p>

                                  <p className="mt-0.5 text-[10px] text-[var(--text-muted)]">
                                    {orderCancelled
                                      ? "This order is no longer being prepared."
                                      : "This stall is no longer preparing its items."}
                                  </p>
                                </div>
                              </div>
                            </div>
                          )}

                          {action && (
                            <button
                              type="button"
                              disabled={isUpdating}
                              onClick={() =>
                                updateStatus(
                                  order,
                                  stallOrder,
                                  action.next
                                )
                              }
                              className={`mt-5 flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-bold transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 ${
                                action.next === "Accepted"
                                  ? "bg-[var(--accent)] text-[var(--on-accent)] shadow-[var(--accent-shadow)] hover:bg-[var(--accent-hover)]"
                                  : "bg-[var(--primary)] text-[var(--on-primary)] shadow-[var(--shadow-soft)] hover:bg-[var(--primary-hover)]"
                              }`}
                            >
                              {isUpdating ? (
                                <>
                                  <RefreshCw className="h-4 w-4 animate-spin" />
                                  Updating...
                                </>
                              ) : (
                                <>
                                  {action.label}
                                  <ChevronRight className="h-4 w-4" />
                                </>
                              )}
                            </button>
                          )}

                          {!orderCancelled &&
                            !stallCancelled && (
                              <button
                                type="button"
                                disabled={
                                  Boolean(cancellingKey) ||
                                  Boolean(updatingKey)
                                }
                                onClick={() =>
                                  cancelCompleteOrder(
                                    order,
                                    stallOrder
                                  )
                                }
                                className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-[color-mix(in_srgb,var(--danger)_25%,transparent)] bg-[var(--danger-soft)] px-4 py-3 text-sm font-semibold text-[var(--danger)] transition hover:border-[color-mix(in_srgb,var(--danger)_45%,transparent)] hover:bg-[color-mix(in_srgb,var(--danger)_12%,transparent)] disabled:cursor-not-allowed disabled:opacity-40 dark:text-red-300 dark:hover:text-red-200"
                              >
                                {cancellingStallOrder ? (
                                  <>
                                    <RefreshCw className="h-4 w-4 animate-spin" />
                                    Cancelling Stall...
                                  </>
                                ) : (
                                  <>
                                    <XCircle className="h-4 w-4" />
                                    Cancel Stall Order
                                  </>
                                )}
                              </button>
                            )}

                          {stallCancelled &&
                            !orderCancelled && (
                              <div className="mt-5 rounded-xl border border-[color-mix(in_srgb,var(--danger)_30%,transparent)] bg-[var(--danger-soft)] p-3 text-center">
                                <p className="text-xs font-semibold text-[var(--danger)] dark:text-red-300">
                                  This stall order is cancelled
                                </p>
                              </div>
                            )}
                        </div>
                      </div>
                    </div>
                  </article>
                );
              })
            )}
          </section>
        )}
      </div>
      </main>
    </div>
  );
}
