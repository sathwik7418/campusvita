"use client";

import toast from "react-hot-toast";
import { useCallback, useEffect, useState } from "react";

import {
  Trash2,
  Share2,
  X,
  Star,
  PackageCheck,
  RefreshCw,
  ChevronDown,
} from "lucide-react";

import { io } from "socket.io-client";
import { getAccessToken } from "@/app/lib/auth/session";
import { getImageUrl } from "@/app/lib/getImageUrl";
import HomeNavbar from "@/components/layout/HomeNavbar";

import { useCart } from "../../context/CartContext";

// ============================================================
// TYPES
// ============================================================

type OrderItem = {
  name: string;
  quantity: number;
  price: number;
  image?: string;
  stall_id: string;
};

type Order = {
  order_id: string;
  items: OrderItem[];
  total: number;
  status: string;
  date: string;
  token: number;
  pickup_code: number;
  estimated_time: string;
  payment_method?: string;
  payment_status?: string;
  refund_eligible?: boolean;
  refund_status?: string | null;
  refund_amount_paise?: number;
  refund_scope?: string | null;
  refund_updated_at?: string | null;
  refund_processed_at?: string | null;
};

// ============================================================
// API
// ============================================================

const API_URL =
  process.env.NEXT_PUBLIC_API_URL ||
  "http://127.0.0.1:8000";

// ============================================================
// PAGE
// ============================================================

export default function OrdersPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [refundingToken, setRefundingToken] =
    useState<number | null>(null);

  const [selectedOrder, setSelectedOrder] =
    useState<number | null>(null);

  const [expandedOrder, setExpandedOrder] =
    useState<number | null>(null);

  // Rating modal state
  const [showRatingModal, setShowRatingModal] =
    useState(false);

  const [selectedRating, setSelectedRating] =
    useState(0);

  const [feedback, setFeedback] = useState("");

  const [selectedStallId, setSelectedStallId] =
    useState("");

  const [isSubmittingRating, setIsSubmittingRating] =
    useState(false);

  const { addToCart } = useCart();

  // ============================================================
  // AUTH
  // ============================================================

  const getToken = () => {
    if (typeof window === "undefined") {
      return null;
    }

    return getAccessToken("USER");
  };

  // ============================================================
  // FETCH ORDERS
  // ============================================================

  const fetchOrders = useCallback(
    async (showRefreshLoader = false) => {
      try {
        if (showRefreshLoader) {
          setRefreshing(true);
        }

        const token = getToken();

        if (!token) {
          setOrders([]);
          return;
        }

        const response = await fetch(`${API_URL}/orders`, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          cache: "no-store",
        });

        if (response.status === 401) {
          toast.error(
            "Your session has expired. Please login again."
          );

          setOrders([]);
          return;
        }

        if (!response.ok) {
          let errorMessage = "Failed to load orders";

          try {
            const errorData = await response.json();

            errorMessage =
              errorData.detail ||
              errorData.message ||
              errorMessage;
          } catch {
            // Ignore invalid JSON responses.
          }

          throw new Error(errorMessage);
        }

        const data = await response.json();

        if (Array.isArray(data.orders)) {
          const normalizedOrders = [...data.orders]
            .filter(Boolean)
            .reverse();

          setOrders(normalizedOrders);

          console.log(
            `Loaded ${normalizedOrders.length} orders`
          );
        } else {
          console.warn(
            "Orders API returned no orders array:",
            data
          );

          setOrders([]);
        }
      } catch (error) {
        console.error("Fetch orders error:", error);

        toast.error(
          error instanceof Error
            ? error.message
            : "Failed to load orders"
        );

        setOrders([]);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    []
  );

  // ============================================================
  // INITIAL LOAD
  // ============================================================

  useEffect(() => {
    void fetchOrders();
  }, [fetchOrders]);

  // ============================================================
  // LIVE ORDER UPDATES
  // ============================================================


useEffect(() => {
  const token = getToken();

  if (!token) {
    return;
  }

  const socket = io(API_URL, {
    auth: {
      token,
    },
    transports: ["websocket", "polling"],
  });


    socket.on("connect", () => {
      console.log("Orders socket connected");
    });

    socket.on("order_update", (updatedOrder) => {
      console.log("Order update received:", updatedOrder);

      void fetchOrders();
    });

    socket.on("disconnect", () => {
      console.log("Orders socket disconnected");
    });

    socket.on("connect_error", (error) => {
      console.warn("Orders socket error:", error);
    });

    return () => {
      socket.disconnect();
    };
  }, [fetchOrders]);

  // ============================================================
  // REFUND STATUS POLLING
  // ============================================================

  useEffect(() => {
    const hasProcessingRefund = orders.some((order) =>
      ["PENDING", "INITIATED", "PROCESSING"].includes(
        (order.refund_status || "").trim().toUpperCase()
      )
    );

    if (!hasProcessingRefund) {
      return;
    }

    const interval = window.setInterval(() => {
      void fetchOrders();
    }, 5000);

    return () => {
      window.clearInterval(interval);
    };
  }, [orders, fetchOrders]);

  // ============================================================
  // REORDER
  // ============================================================

  const handleReorder = (items: OrderItem[]) => {
    if (!items || items.length === 0) {
      toast.error("No items available for reorder");
      return;
    }

    items.forEach((item) => {
      addToCart({
        name: item.name,
        price: item.price,
        image: item.image || "",
        stall_id: item.stall_id,
      });
    });

    toast.success("Items added to cart 🚀");
  };

  // ============================================================
  // CUSTOMER REFUND
  // ============================================================

  const handleRequestRefund = async (order: Order) => {
    if (!order?.token) {
      toast.error("Invalid order.");
      return;
    }

    if (order.refund_eligible !== true) {
      toast.error(
        "This order is no longer eligible for cancellation."
      );
      return;
    }

    if (refundingToken !== null) {
      return;
    }

    const confirmed = window.confirm(
      "Cancel this order and request a refund? This action cannot be undone."
    );

    if (!confirmed) {
      return;
    }

    try {
      const token = getToken();

      if (!token) {
        toast.error("Please login again");
        return;
      }

      setRefundingToken(order.token);

      const response = await fetch(
        `${API_URL}/orders/${order.token}/refund`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            reason: "Customer requested cancellation",
          }),
        }
      );

      const data = await response.json().catch(() => ({}));

      if (response.status === 401) {
        toast.error("Your session has expired");
        return;
      }

      if (!response.ok) {
        toast.error(
          data.detail ||
            data.message ||
            "Unable to cancel order"
        );
        return;
      }

      toast.success(
        data.message ||
          "Order cancelled. Refund requested successfully."
      );

      setSelectedOrder(null);
      setExpandedOrder(null);

      await fetchOrders();
    } catch (error) {
      console.error("Customer refund request error:", error);

      toast.error(
        "Unable to process the refund request. Please try again."
      );
    } finally {
      setRefundingToken(null);
    }
  };

  // ============================================================
  // DELETE ORDER
  // ============================================================

  const handleDeleteOrder = async (orderId: string) => {
    try {
      const token = getToken();

      if (!token) {
        toast.error("Please login again");
        return;
      }

      if (!orderId) {
        toast.error("Invalid order ID");
        return;
      }

      const response = await fetch(
        `${API_URL}/delete-order/${orderId}`,
        {
          method: "DELETE",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
        }
      );

      const data = await response.json().catch(() => ({}));

      if (response.status === 401) {
        toast.error("Your session has expired");
        return;
      }

      if (!response.ok) {
        toast.error(
          data.detail ||
            data.message ||
            "Failed to delete order"
        );

        return;
      }

      toast.success(
        data.message || "Order deleted successfully"
      );

      setSelectedOrder(null);
      setExpandedOrder(null);

      await fetchOrders();
    } catch (error) {
      console.error("Delete order error:", error);

      toast.error("Failed to delete order");
    }
  };

  // ============================================================
  // SHARE ORDER
  // ============================================================

  const handleShareOrder = async (order: Order) => {
    const text = `
CampusVita Order 🚀

Token: #${order.token}

Items:
${(order.items || [])
  .map((item) => `${item.name} x ${item.quantity}`)
  .join("\n")}

Total: ₹${order.total}
`;

    try {
      if (
        typeof navigator !== "undefined" &&
        navigator.share
      ) {
        await navigator.share({
          title: "CampusVita Order",
          text,
        });
      } else {
        await navigator.clipboard.writeText(text);

        toast.success("Order copied to clipboard");
      }
    } catch (error) {
      console.log("Share cancelled:", error);
    }
  };

  // ============================================================
  // OPEN RATING
  // ============================================================

  const openRating = (order: Order) => {
    const firstItem = order.items?.[0];

    if (!firstItem) {
      toast.error("No food item available to rate");
      return;
    }

    const stallId = firstItem.stall_id?.trim();

    if (!stallId) {
      console.error(
        "Cannot open rating modal: missing stall_id",
        {
          orderId: order.order_id,
          token: order.token,
          firstItem,
        }
      );

      toast.error(
        "Unable to identify the stall for this order."
      );

      return;
    }

    setSelectedStallId(stallId);
    setSelectedRating(0);
    setFeedback("");
    setShowRatingModal(true);
  };

  // ============================================================
  // SUBMIT STALL RATING
  // ============================================================

  const handleRateOrder = async () => {
    if (isSubmittingRating) {
      return;
    }

    if (selectedRating < 1 || selectedRating > 5) {
      toast.error("Please select a rating ⭐");
      return;
    }

    if (!selectedStallId.trim()) {
      toast.error(
        "Unable to identify the stall. Please try again."
      );
      return;
    }

    if (feedback.length > 500) {
      toast.error("Feedback cannot exceed 500 characters.");
      return;
    }

    try {
      const token = getToken();

      if (!token) {
        toast.error("Please login again");
        return;
      }

      setIsSubmittingRating(true);

      const response = await fetch(`${API_URL}/rate-stall`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          stall_id: selectedStallId,
          rating: selectedRating,
          feedback: feedback.trim(),
        }),
      });

      const data = await response.json().catch(() => ({}));

      if (response.status === 401) {
        toast.error(
          "Your session has expired. Please login again."
        );
        return;
      }

      if (!response.ok) {
        toast.error(
          data.detail ||
            data.message ||
            "Failed to submit rating"
        );
        return;
      }

      if (data.success === false) {
        toast.error(
          data.message || "Failed to save rating"
        );
        return;
      }

      toast.success(
        data.message || "Rating saved successfully ⭐"
      );

      setShowRatingModal(false);
      setSelectedRating(0);
      setFeedback("");
      setSelectedStallId("");

      await fetchOrders();
    } catch (error) {
      console.error("Rating submission error:", error);

      toast.error(
        "Unable to submit rating. Please try again."
      );
    } finally {
      setIsSubmittingRating(false);
    }
  };

  // ============================================================
  // CLOSE RATING MODAL
  // ============================================================

  const closeRatingModal = () => {
    if (isSubmittingRating) {
      return;
    }

    setShowRatingModal(false);
    setSelectedRating(0);
    setFeedback("");
    setSelectedStallId("");
  };

  // ============================================================
  // STATUS STYLE
  // ============================================================

  const getStatusStyle = (status: string) => {
    const normalizedStatus = (status || "")
      .trim()
      .toLowerCase();

    if (
      normalizedStatus === "completed" ||
      normalizedStatus === "delivered"
    ) {
      return {
        dot: "bg-emerald-500",
        badge:
          "bg-emerald-500/10 border-emerald-500/20",
        text:
          "text-emerald-700 dark:text-emerald-400",
        label: "Delivered",
      };
    }

    if (
      normalizedStatus === "cancelled" ||
      normalizedStatus === "canceled"
    ) {
      return {
        dot: "bg-red-500",
        badge: "bg-red-500/10 border-red-500/20",
        text: "text-red-700 dark:text-red-400",
        label: "Cancelled",
      };
    }

    if (
      normalizedStatus === "preparing" ||
      normalizedStatus === "cooking"
    ) {
      return {
        dot: "bg-warning",
        badge: "bg-warning/10 border-warning/20",
        text: "text-warning",
        label: status || "Preparing",
      };
    }

    if (normalizedStatus === "ready for pickup") {
      return {
        dot: "bg-blue-500",
        badge: "bg-blue-500/10 border-blue-500/20",
        text: "text-blue-700 dark:text-blue-400",
        label: status || "Ready",
      };
    }

    return {
      dot: "bg-zinc-400",
      badge: "bg-zinc-500/10 border-zinc-500/20",
      text: "text-[var(--text-secondary)]",
      label: status || "Unknown",
    };
  };

  // ============================================================
  // REFUND STATUS STYLE
  // ============================================================

  const getRefundStatusStyle = (
    refundStatus?: string | null
  ) => {
    const normalizedStatus = (refundStatus || "")
      .trim()
      .toUpperCase();

    if (normalizedStatus === "PROCESSED") {
      return {
        dot: "bg-emerald-500",
        text: "text-emerald-700 dark:text-emerald-400",
        label: "Refund Completed",
      };
    }

    if (
      normalizedStatus === "PENDING" ||
      normalizedStatus === "INITIATED" ||
      normalizedStatus === "PROCESSING"
    ) {
      return {
        dot: "bg-warning",
        text: "text-warning",
        label: "Refund Processing",
      };
    }

    if (normalizedStatus === "FAILED") {
      return {
        dot: "bg-red-500",
        text: "text-red-700 dark:text-red-400",
        label: "Refund Failed",
      };
    }

    return {
      dot: "bg-zinc-400",
      text: "text-[var(--text-secondary)]",
      label: "Refund Status Unknown",
    };
  };

  // ============================================================
  // THUMBNAILS
  // ============================================================

  const getVisibleItems = (items: OrderItem[]) => {
    return (items || []).filter(Boolean).slice(0, 3);
  };

  const getRemainingItemCount = (items: OrderItem[]) => {
    return Math.max((items || []).length - 3, 0);
  };

  // ============================================================
  // REFRESH
  // ============================================================

  const handleRefresh = () => {
    void fetchOrders(true);
  };

  // ============================================================
  // UI
  // ============================================================

  return (
    <>
      <HomeNavbar />

      <main className="min-h-screen bg-[var(--background)] px-4 pb-28 pt-5 text-[var(--text-primary)] transition-colors duration-300 sm:px-6 sm:pt-8 md:px-10 md:pb-10">
        <div className="mx-auto w-full max-w-4xl">
          {/* HEADER */}

          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2.5">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--brand-soft)] text-[var(--brand)]">
                  <PackageCheck size={21} />
                </div>

                <div className="min-w-0">
                  <h1 className="truncate text-2xl font-bold tracking-tight text-[var(--text-primary)] sm:text-3xl">
                    Order History
                  </h1>

                  <p className="mt-1 text-sm text-[var(--text-secondary)]">
                    Your recent CampusVita orders
                  </p>
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={handleRefresh}
              disabled={refreshing}
              aria-label="Refresh orders"
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-[var(--border)] bg-[var(--surface)] text-[var(--text-secondary)] shadow-sm transition-all hover:border-[var(--brand)] hover:bg-[var(--brand-soft)] hover:text-[var(--brand)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <RefreshCw
                size={18}
                className={refreshing ? "animate-spin" : ""}
              />
            </button>
          </div>

          {/* LOADING / EMPTY / ORDER LIST */}

          {loading ? (
<div className="cv-glass-card cv-glass-edge mt-6 overflow-hidden rounded-2xl border border-[var(--glass-border)] p-8 text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--brand-soft)]">
                <RefreshCw
                  size={25}
                  className="animate-spin text-[var(--brand)]"
                />
              </div>

              <p className="mt-4 text-sm font-medium text-[var(--text-secondary)]">
                Loading your orders...
              </p>

              <div className="mx-auto mt-5 h-1.5 w-32 overflow-hidden rounded-full bg-[var(--surface-secondary)]">
                <div className="h-full w-1/2 animate-pulse rounded-full bg-[var(--brand)]" />
              </div>
            </div>
          ) : orders.length === 0 ? (
<div className="cv-glass-card cv-glass-edge mt-6 rounded-2xl border border-[var(--glass-border)] p-8 text-center sm:p-12">
              <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-3xl bg-[var(--surface-secondary)] text-[var(--text-muted)]">
                <PackageCheck size={42} />
              </div>

              <h2 className="mt-5 text-xl font-bold tracking-tight text-[var(--text-primary)]">
                No Orders Yet
              </h2>

              <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-[var(--text-secondary)]">
                Your completed and current orders will appear here.
              </p>

              <button
                type="button"
                onClick={handleRefresh}
                disabled={refreshing}
                className="mt-6 rounded-xl bg-[var(--brand)] px-5 py-3 text-sm font-bold text-white shadow-sm transition-all hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--background)] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {refreshing ? "Refreshing..." : "Refresh Orders"}
              </button>
            </div>
          ) : (
            <div className="mt-5 flex flex-col gap-3 sm:mt-7 sm:gap-4">
              {orders.map((order, index) => {
                const statusStyle = getStatusStyle(order.status);
                const items = Array.isArray(order.items)
                  ? order.items
                  : [];
                const visibleItems = getVisibleItems(items);
                const remainingItems =
                  getRemainingItemCount(items);
                const isExpanded = expandedOrder === index;

                const isCompleted = [
                  "completed",
                  "delivered",
                ].includes(
                  (order.status || "").trim().toLowerCase()
                );

                return (
                  <article
                    key={
                      order.order_id ||
                      `${order.token}-${index}`
                    }
                    className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-[var(--shadow-card)] transition-all duration-200 hover:-translate-y-[1px] hover:border-[var(--brand)]/30"
                  >
                    {/* COMPACT SUMMARY */}

                    <button
                      type="button"
                      onClick={() =>
                        setExpandedOrder(
                          isExpanded ? null : index
                        )
                      }
                      className="cv-glass-card cv-glass-edge w-full overflow-hidden rounded-2xl border border-[var(--glass-border)] text-left transition-all duration-200 hover:-translate-y-[1px] hover:border-[var(--brand)]/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--brand)]"
                      aria-expanded={isExpanded}
                    >
                      <div className="p-4 sm:p-5">
                        <div className="flex items-start justify-between gap-4">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span
                                className={`h-2 w-2 shrink-0 rounded-full ${statusStyle.dot}`}
                              />

                              <span
                                className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-bold ${statusStyle.badge} ${statusStyle.text}`}
                              >
                                {statusStyle.label}
                              </span>
                            </div>

                            <p className="mt-2 truncate text-xs text-[var(--text-muted)]">
                              {order.date || "Date unavailable"}
                            </p>

                            <p className="mt-1 text-xs font-semibold text-[var(--text-secondary)]">
                              {order.token
                                ? `Token #${order.token}`
                                : `Order #${order.order_id}`}
                            </p>
                          </div>

                          <div className="shrink-0 text-right">
                            <p className="text-lg font-bold tracking-tight text-[var(--text-primary)] sm:text-xl">
                              ₹
                              {Number(
                                order.total || 0
                              ).toFixed(2)}
                            </p>

                            <p className="mt-1 text-[11px] text-[var(--text-muted)]">
                              {items.length}{" "}
                              {items.length === 1 ? "item" : "items"}
                            </p>
                          </div>
                        </div>

                        {visibleItems.length > 0 && (
                          <div className="mt-4 flex items-center gap-2">
                            {visibleItems.map(
                              (item, itemIndex) => (
                                <div
                                  key={`${order.order_id}-${item.name}-${itemIndex}`}
                                  className="h-12 w-12 shrink-0 overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface-secondary)] shadow-sm sm:h-14 sm:w-14"
                                >
                                  {item.image ? (
                                    <img
                                      src={getImageUrl(item.image)}
                                      alt={item.name || ""}
                                      loading="lazy"
                                      className="h-full w-full object-cover"
                                    />
                                  ) : (
                                    <div className="flex h-full w-full items-center justify-center text-base">
                                      🍽️
                                    </div>
                                  )}
                                </div>
                              )
                            )}

                            {remainingItems > 0 && (
                              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-[var(--border)] bg-[var(--surface-secondary)] text-xs font-bold text-[var(--text-secondary)] sm:h-14 sm:w-14">
                                +{remainingItems}
                              </div>
                            )}
                          </div>
                        )}

                        <div className="mt-4 flex items-center justify-between">
                          <span className="text-xs font-medium text-[var(--text-muted)]">
                            {isExpanded
                              ? "Hide details"
                              : "View order details"}
                          </span>

                          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--brand-soft)]">
                            <ChevronDown
                              size={17}
                              className={`text-[var(--brand)] transition-transform duration-200 ${
                                isExpanded ? "rotate-180" : ""
                              }`}
                            />
                          </span>
                        </div>
                      </div>
                    </button>

                    {/* EXPANDED DETAILS */}

                    {isExpanded && (
                      <div className="border-t border-[var(--border)] bg-[var(--surface-secondary)]/60 px-4 pb-4 pt-4 sm:px-5">
                        {/* ITEMS */}

                        <div>
                          <p className="mb-3 text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--text-muted)]">
                            Ordered Items
                          </p>

                          <div className="flex flex-col gap-2">
                            {items.map((item, itemIndex) => (
                              <div
                                key={`${item.name}-${itemIndex}`}
                                className="flex items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3"
                              >
                                <div className="h-11 w-11 shrink-0 overflow-hidden rounded-lg bg-[var(--surface-secondary)]">
                                  {item.image ? (
                                    <img
                                      src={getImageUrl(item.image)}
                                      alt={item.name}
                                      loading="lazy"
                                      className="h-full w-full object-cover"
                                    />
                                  ) : (
                                    <div className="flex h-full w-full items-center justify-center">
                                      🍽️
                                    </div>
                                  )}
                                </div>

                                <div className="min-w-0 flex-1">
                                  <p className="truncate text-sm font-semibold text-[var(--text-primary)]">
                                    {item.name}
                                  </p>

                                  <p className="mt-0.5 text-xs text-[var(--text-muted)]">
                                    Qty {item.quantity} • ₹
                                    {item.price} each
                                  </p>
                                </div>

                                <p className="shrink-0 text-sm font-bold text-[var(--text-primary)]">
                                  ₹
                                  {(
                                    Number(item.price) *
                                    Number(item.quantity)
                                  ).toFixed(2)}
                                </p>
                              </div>
                            ))}
                          </div>
                        </div>

                        {/* ORDER INFORMATION */}

                        <div className="mt-5 grid grid-cols-2 gap-2">
                          <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3">
                            <p className="text-[11px] font-medium text-[var(--text-muted)]">
                              Token
                            </p>

                            <p className="mt-1 text-sm font-bold text-[var(--text-primary)]">
                              #{order.token}
                            </p>
                          </div>

                          <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3">
                            <p className="text-[11px] font-medium text-[var(--text-muted)]">
                              Pickup Code
                            </p>

                            <p className="mt-1 text-sm font-bold text-[var(--text-primary)]">
                              {order.pickup_code ?? "N/A"}
                            </p>
                          </div>

                          {order.payment_method && (
                            <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3">
                              <p className="text-[11px] font-medium text-[var(--text-muted)]">
                                Payment
                              </p>

                              <p className="mt-1 truncate text-sm font-bold text-[var(--text-primary)]">
                                {order.payment_method}
                              </p>
                            </div>
                          )}

                          <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3">
                            <p className="text-[11px] font-medium text-[var(--text-muted)]">
                              Status
                            </p>

                            <p
                              className={`mt-1 truncate text-sm font-bold ${statusStyle.text}`}
                            >
                              {statusStyle.label}
                            </p>
                          </div>

                          {order.refund_status && (
                            <div className="col-span-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3">
                              <p className="text-[11px] font-medium text-[var(--text-muted)]">
                                Refund
                              </p>

                              <div className="mt-1 flex items-center gap-2">
                                <span
                                  className={`h-2 w-2 shrink-0 rounded-full ${
                                    getRefundStatusStyle(
                                      order.refund_status
                                    ).dot
                                  }`}
                                />

                                <p
                                  className={`truncate text-sm font-bold ${
                                    getRefundStatusStyle(
                                      order.refund_status
                                    ).text
                                  }`}
                                >
                                  {
                                    getRefundStatusStyle(
                                      order.refund_status
                                    ).label
                                  }
                                </p>
                              </div>

                              {order.refund_amount_paise &&
                                order.refund_amount_paise > 0 && (
                                  <p className="mt-1 text-xs text-[var(--text-muted)]">
                                    Amount: ₹
                                    {(
                                      order.refund_amount_paise /
                                      100
                                    ).toFixed(2)}
                                  </p>
                                )}
                            </div>
                          )}
                        </div>

                        {/* ACTIONS */}

                        <div className="mt-5 grid grid-cols-2 gap-2">
                          {order.refund_eligible === true && (
                            <button
                              type="button"
                              disabled={
                                refundingToken === order.token
                              }
                              onClick={() =>
                                void handleRequestRefund(order)
                              }
                              className="col-span-2 rounded-xl border border-red-500/25 bg-red-500/10 px-3 py-3 text-sm font-bold text-red-700 transition-all hover:border-red-500/40 hover:bg-red-500/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 disabled:cursor-not-allowed disabled:opacity-50 dark:text-red-400"
                            >
                              {refundingToken === order.token
                                ? "Processing Refund..."
                                : "Cancel & Request Refund"}
                            </button>
                          )}

                          <button
                            type="button"
                            onClick={() => handleReorder(items)}
                            className="rounded-xl bg-[var(--brand)] px-3 py-3 text-sm font-bold text-white shadow-sm transition-all hover:brightness-95 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]"
                          >
                            Reorder
                          </button>

                          {isCompleted && (
                            <button
                              type="button"
                              onClick={() => openRating(order)}
                              className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-3 text-sm font-bold text-[var(--text-primary)] transition-all hover:border-[var(--brand)] hover:bg-[var(--brand-soft)] hover:text-[var(--brand)] active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]"
                            >
                              Rate Order
                            </button>
                          )}

                          {!isCompleted && (
                            <button
                              type="button"
                              onClick={() =>
                                void handleShareOrder(order)
                              }
                              className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-3 text-sm font-bold text-[var(--text-primary)] transition-all hover:border-[var(--brand)] hover:bg-[var(--brand-soft)] hover:text-[var(--brand)] active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]"
                            >
                              Share
                            </button>
                          )}
                        </div>

                        {/* MORE OPTIONS */}

                        <button
                          type="button"
                          onClick={() => setSelectedOrder(index)}
                          className="mt-3 w-full rounded-xl border border-[var(--border)] py-2.5 text-xs font-semibold text-[var(--text-muted)] transition-colors hover:border-[var(--brand)]/40 hover:bg-[var(--brand-soft)] hover:text-[var(--brand)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]"
                        >
                          More Order Options
                        </button>
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </div>
      </main>

      {/* ====================================================== */}
      {/* ORDER OPTIONS MODAL */}
      {/* ====================================================== */}

      {selectedOrder !== null && orders[selectedOrder] && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setSelectedOrder(null);
            }
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="order-options-title"
            className="cv-glass-modal cv-glass-edge w-full max-w-md rounded-2xl border border-[var(--glass-border)] p-6 text-[var(--text-primary)] sm:rounded-3xl sm:p-8"
          >
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.14em] text-[var(--brand)]">
                  Order
                </p>

                <h2
                  id="order-options-title"
                  className="mt-1 text-xl font-bold tracking-tight sm:text-2xl"
                >
                  Order Options
                </h2>
              </div>

              <button
                type="button"
                onClick={() => setSelectedOrder(null)}
                aria-label="Close order options"
                className="rounded-xl border border-transparent p-2 text-[var(--text-secondary)] transition-colors hover:border-[var(--border)] hover:bg-[var(--surface-secondary)] hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]"
              >
                <X size={20} />
              </button>
            </div>

            <div className="mt-6 flex flex-col gap-2">
              <button
                type="button"
                onClick={() =>
                  void handleDeleteOrder(
                    orders[selectedOrder].order_id
                  )
                }
                className="flex items-center gap-3 rounded-xl border border-transparent px-3 py-3 text-left text-red-700 transition-colors hover:border-red-500/20 hover:bg-red-500/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 dark:text-red-400"
              >
                <Trash2 size={20} />
                <span className="font-semibold">
                  Delete Order
                </span>
              </button>

              <button
                type="button"
                onClick={() =>
                  void handleShareOrder(orders[selectedOrder])
                }
                className="flex items-center gap-3 rounded-xl border border-transparent px-3 py-3 text-left text-emerald-700 transition-colors hover:border-emerald-500/20 hover:bg-emerald-500/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 dark:text-emerald-400"
              >
                <Share2 size={20} />
                <span className="font-semibold">
                  Share Order
                </span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ====================================================== */}
      {/* RATING MODAL */}
      {/* ====================================================== */}

      {showRatingModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
          onMouseDown={(event) => {
            if (
              event.target === event.currentTarget &&
              !isSubmittingRating
            ) {
              closeRatingModal();
            }
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="rating-modal-title"
            className="cv-glass-modal cv-glass-edge w-full max-w-md rounded-2xl border border-[var(--glass-border)] p-6 text-[var(--text-primary)] sm:rounded-3xl sm:p-8"
          >
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.14em] text-[var(--brand)]">
                  Feedback
                </p>

                <h2
                  id="rating-modal-title"
                  className="mt-1 text-xl font-bold tracking-tight sm:text-2xl"
                >
                  Rate Your Experience
                </h2>
              </div>

              <button
                type="button"
                onClick={closeRatingModal}
                disabled={isSubmittingRating}
                aria-label="Close rating modal"
                className="rounded-xl border border-transparent p-2 text-[var(--text-secondary)] transition-colors hover:border-[var(--border)] hover:bg-[var(--surface-secondary)] hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)] disabled:cursor-not-allowed disabled:opacity-50"
              >
                <X size={20} />
              </button>
            </div>

            {/* STARS */}

            <div
              className="mt-7 flex justify-center gap-2"
              role="group"
              aria-label="Choose a rating"
            >
              {[1, 2, 3, 4, 5].map((star) => (
                <button
                  key={star}
                  type="button"
                  onClick={() => setSelectedRating(star)}
                  disabled={isSubmittingRating}
                  className="rounded-lg p-1 transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-400 disabled:cursor-not-allowed disabled:opacity-60"
                  aria-label={`Rate ${star} stars`}
                  aria-pressed={selectedRating === star}
                >
                  <Star
                    size={34}
                    className={
                      star <= selectedRating
                        ? "fill-yellow-400 text-yellow-400"
                        : "text-[var(--text-muted)]"
                    }
                  />
                </button>
              ))}
            </div>

            <p className="mt-3 text-center text-xs text-[var(--text-muted)]">
              {selectedRating === 0
                ? "Tap a star to rate your experience"
                : `${selectedRating} out of 5 stars`}
            </p>

            {/* FEEDBACK */}

            <textarea
              placeholder="Write feedback (optional)..."
              value={feedback}
              maxLength={500}
              onChange={(event) =>
                setFeedback(event.target.value)
              }
              disabled={isSubmittingRating}
              aria-label="Rating feedback"
              className="mt-6 w-full resize-none rounded-xl border border-[var(--border)] bg-[var(--input)] p-4 text-sm text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)] transition-colors focus:border-[var(--brand)] focus:ring-2 focus:ring-[var(--brand)]/15 disabled:cursor-not-allowed disabled:opacity-60"
              rows={4}
            />

            <p className="mt-1 text-right text-xs text-[var(--text-muted)]">
              {feedback.length}/500
            </p>

            <button
              type="button"
              onClick={() => void handleRateOrder()}
              disabled={
                isSubmittingRating ||
                selectedRating < 1 ||
                !selectedStallId
              }
              className="mt-4 w-full rounded-xl bg-[var(--brand)] py-3.5 text-sm font-bold text-white shadow-sm transition-all hover:brightness-95 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface)] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSubmittingRating
                ? "Submitting Rating..."
                : "Submit Rating"}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
