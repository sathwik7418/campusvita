"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { io } from "socket.io-client";
import {
  Check,
  Clock3,
  Package,
  RefreshCw,
  ShoppingBag,
  Sparkles,
  Store,
  UtensilsCrossed,
  XCircle,
} from "lucide-react";
import toast from "react-hot-toast";

import Navbar from "@/components/layout/Navbar";
import { getImageUrl } from "@/app/lib/getImageUrl";
import {
  getAccessToken,
  getSessionUser,
} from "@/app/lib/auth/session";

const API_URL =
  process.env.NEXT_PUBLIC_API_URL ||
  "http://127.0.0.1:8000";

/* ============================================================
   TYPES
   ============================================================ */

type OrderItem = {
  name: string;
  price: number;
  quantity: number;
  image?: string | null;
  stall_id?: string | null;

  cancelled?: boolean;

  cancelledAt?: string | null;
  cancellationReason?: string | null;

  // Backend compatibility
  cancelled_at?: string | null;
  cancellation_reason?: string | null;
};

type StallState = {
  stall_id: string;
  status: string;
  estimatedPreparationMinutes: number;

  cookingStartedAt?: string | null;
  readyAt?: string | null;

  cancelled?: boolean;

  cancelledAt?: string | null;
  cancellationReason?: string | null;

  // Backend compatibility
  cancelled_at?: string | null;
  cancellation_reason?: string | null;

  stall_name?: string | null;
};

type Order = {
  _id?: string;
  order_id?: string;
  token: number;

  status?: string;

  date?: string;
  created_at?: string;

  email?: string;
  user_email?: string;

  total?: number;
  pickup_code?: string;

  items: OrderItem[];

  stall_orders?: StallState[];

  cancelled?: boolean;

  cancelledAt?: string | null;
  cancellationReason?: string | null;

  // Backend compatibility
  cancelled_at?: string | null;
  cancellation_reason?: string | null;
};

type Stall = {
  _id?: string;
  id?: string;
  name: string;
  image?: string;
};

/* ============================================================
   STATUS
   ============================================================ */

const STATUS_ORDER = [
  "Pending",
  "Accepted",
  "Placed",
  "Cooking",
  "Ready For Pickup",
];

const statusRank = (status: string) => {
  const index = STATUS_ORDER.indexOf(status);

  return index === -1 ? 0 : index;
};

const formatDate = (value?: string) => {
  if (!value) {
    return "Just now";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};

const getStallStatusLabel = (status?: string) => {
  switch (status) {
    case "Pending":
      return "Waiting";

    case "Accepted":
      return "Accepted";

    case "Placed":
      return "Placed";

    case "Cooking":
      return "Cooking";

    case "Ready For Pickup":
      return "Ready";

    case "Cancelled":
      return "Cancelled";

    default:
      return "Preparing";
  }
};

/* ============================================================
   CANCELLATION HELPERS
   ============================================================ */

const isCancelledItem = (item?: OrderItem | null) => {
  return item?.cancelled === true;
};

const isCancelledStall = (stall?: StallState | null) => {
  return (
    stall?.cancelled === true ||
    stall?.status === "Cancelled"
  );
};

const getItemCancellationReason = (
  item?: OrderItem | null
) => {
  return (
    item?.cancellationReason ||
    item?.cancellation_reason ||
    null
  );
};

const getStallCancellationReason = (
  stall?: StallState | null
) => {
  return (
    stall?.cancellationReason ||
    stall?.cancellation_reason ||
    null
  );
};

const getOrderCancellationReason = (
  order?: Order | null
) => {
  return (
    order?.cancellationReason ||
    order?.cancellation_reason ||
    null
  );
};

/*
 * Stable item identity for comparing the previous
 * realtime order with the new realtime order.
 */
const getItemKey = (
  item: OrderItem,
  index: number
) => {
  return [
    String(item.stall_id || ""),
    String(item.name || ""),
    String(index),
  ].join("::");
};

/* ============================================================
   OVERALL STATUS
   ============================================================ */

const getOverallStatus = (
  order?: Order | null
) => {
  if (!order) {
    return "Pending";
  }

  /*
   * A complete cancellation always takes priority.
   */
  if (order.cancelled) {
    return "Cancelled";
  }

  const states = order.stall_orders || [];

  /*
   * If every item has been cancelled,
   * the entire order is effectively cancelled.
   */
  const items = order.items || [];

  if (
    items.length > 0 &&
    items.every(
      (item) => item.cancelled === true
    )
  ) {
    return "Cancelled";
  }

  if (!states.length) {
    return order.status || "Pending";
  }

  /*
   * Ignore cancelled stalls when deriving
   * active overall preparation status.
   */
  const activeStates = states.filter(
    (state) =>
      !isCancelledStall(state)
  );

  /*
   * If every stall is cancelled,
   * the order is cancelled.
   */
  if (
    states.length > 0 &&
    activeStates.length === 0 &&
    states.every((state) =>
      isCancelledStall(state)
    )
  ) {
    return "Cancelled";
  }

  if (!activeStates.length) {
    return order.status || "Pending";
  }

  const statuses = activeStates.map(
    (state) => state.status
  );

  if (
    statuses.length > 0 &&
    statuses.every(
      (status) =>
        status === "Ready For Pickup"
    )
  ) {
    return "Ready For Pickup";
  }

  if (
    statuses.some(
      (status) => status === "Cooking"
    ) &&
    statuses.some(
      (status) =>
        status === "Ready For Pickup"
    )
  ) {
    return "Partially Ready";
  }

  if (
    statuses.some(
      (status) => status === "Cooking"
    )
  ) {
    return "Cooking";
  }

  if (
    statuses.some(
      (status) => status === "Placed"
    )
  ) {
    return "Placed";
  }

  if (
    statuses.some(
      (status) => status === "Accepted"
    )
  ) {
    return "Accepted";
  }

  return "Pending";
};

/* ============================================================
   FALLBACK STALL STATES
   ============================================================ */

const buildFallbackStallStates = (
  order: Order
): StallState[] => {
  /*
   * If backend already supplied stall_orders,
   * preserve them exactly, including cancellation
   * fields.
   */
  if (
    Array.isArray(order.stall_orders) &&
    order.stall_orders.length > 0
  ) {
    return order.stall_orders;
  }

  /*
   * Identify real stalls from real order items.
   */
  const ids = Array.from(
    new Set(
      order.items
        .map((item) =>
          String(
            item.stall_id || ""
          ).trim()
        )
        .filter(Boolean)
    )
  );

  return ids.map((stall_id) => ({
    stall_id,
    status: "Pending",
    estimatedPreparationMinutes: 0,

    cookingStartedAt: null,
    readyAt: null,

    cancelled: false,
    cancelledAt: null,
    cancellationReason: null,
  }));
};

/* ============================================================
   STALL NAME HELPER
   ============================================================ */

const findStallName = (
  stalls: Stall[],
  stallId: string
) => {
  const stall = stalls.find(
    (item) =>
      String(
        item._id || item.id
      ) === String(stallId)
  );

  return (
    stall?.name ||
    "CampusVita Stall"
  );
};

/* ============================================================
   COUNTDOWN
   ============================================================ */

const getRemainingSeconds = (
  stall: StallState,
  now: number
) => {
  if (
    isCancelledStall(stall) ||
    stall.status !== "Cooking" ||
    !stall.cookingStartedAt ||
    !stall.estimatedPreparationMinutes
  ) {
    return null;
  }

  const started = new Date(
    stall.cookingStartedAt
  ).getTime();

  if (Number.isNaN(started)) {
    return null;
  }

  const end =
    started +
    stall.estimatedPreparationMinutes *
      60 *
      1000;

  return Math.max(
    0,
    Math.floor(
      (end - now) / 1000
    )
  );
};

const formatCountdown = (
  seconds: number
) => {
  const minutes = Math.floor(
    seconds / 60
  );

  const remainingSeconds =
    seconds % 60;

  return `${String(minutes).padStart(
    2,
    "0"
  )}:${String(
    remainingSeconds
  ).padStart(2, "0")}`;
};

/* ============================================================
   OVERALL STATUS DESCRIPTION
   ============================================================ */

const getOverallStatusDescription = (
  status: string
) => {
  switch (status) {
    case "Cancelled":
      return "This order has been cancelled.";

    case "Partially Ready":
      return "Some items are ready while others are being prepared.";

    case "Ready For Pickup":
      return "Your order is ready for pickup.";

    case "Cooking":
      return "Your food is being prepared right now.";

    case "Placed":
      return "Your order has been placed with the stalls.";

    case "Accepted":
      return "Your order has been accepted by the vendors.";

    default:
      return "Your order is waiting for vendor confirmation.";
  }
};

/* ============================================================
   PAGE
   ============================================================ */

export default function TrackOrderPage() {
  const [order, setOrder] =
    useState<Order | null>(null);

  const [stalls, setStalls] =
    useState<Stall[]>([]);

  const [loading, setLoading] =
    useState(true);

  const [refreshing, setRefreshing] =
    useState(false);

  const [now, setNow] =
    useState(Date.now());

  const user =
    getSessionUser("USER");

  const accessToken =
    getAccessToken("USER");

  /*
   * Keep the latest order in a ref so the Socket.IO
   * callback can compare old vs new cancellation state.
   */
  const orderRef =
    useRef<Order | null>(null);

  /*
   * Prevent duplicate cancellation notifications
   * if Socket.IO delivers the same event more than once.
   */
  const notifiedCancellationKeys =
    useRef<Set<string>>(new Set());

  /* ============================================================
     LOAD ORDER
     ============================================================ */

  const loadOrder = useCallback(
    async (showRefresh = false) => {
      if (!accessToken) {
        setLoading(false);
        return;
      }

      if (showRefresh) {
        setRefreshing(true);
      }

      try {
        const [
          ordersResponse,
          stallsResponse,
        ] = await Promise.all([
          fetch(`${API_URL}/orders`, {
            headers: {
              Authorization: `Bearer ${accessToken}`,
            },
            cache: "no-store",
          }),

          fetch(`${API_URL}/stalls`, {
            headers: {
              Authorization: `Bearer ${accessToken}`,
            },
            cache: "no-store",
          }),
        ]);

        if (!ordersResponse.ok) {
          throw new Error(
            "Unable to load orders"
          );
        }

        const ordersData =
          await ordersResponse.json();

        const stallsData =
          stallsResponse.ok
            ? await stallsResponse.json()
            : [];

        const orders: Order[] =
          Array.isArray(ordersData)
            ? ordersData
            : ordersData.orders || [];

        const stallList: Stall[] =
          Array.isArray(stallsData)
            ? stallsData
            : stallsData.stalls || [];

        setStalls(stallList);

        if (!orders.length) {
          orderRef.current = null;
          setOrder(null);
          return;
        }

        /*
         * Always use newest real order from backend.
         */
        const sortedOrders =
          [...orders].sort(
            (a, b) => {
              const aTime =
                new Date(
                  a.created_at ||
                    a.date ||
                    0
                ).getTime();

              const bTime =
                new Date(
                  b.created_at ||
                    b.date ||
                    0
                ).getTime();

              return bTime - aTime;
            }
          );

        const latestOrder =
          sortedOrders[0];

        const normalizedOrder: Order = {
          ...latestOrder,
          stall_orders:
            buildFallbackStallStates(
              latestOrder
            ),
        };

        /*
         * Backend remains the source of truth.
         */
        orderRef.current =
          normalizedOrder;

        setOrder(
          normalizedOrder
        );

        localStorage.setItem(
          "campusvita_latest_order",
          JSON.stringify(
            normalizedOrder
          )
        );
      } catch (error) {
        console.error(
          "Track order load error:",
          error
        );

        toast.error(
          "Unable to load your order"
        );
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [accessToken]
  );

  /* ============================================================
     INITIAL LOAD
     ============================================================ */

  useEffect(() => {
    loadOrder();
  }, [loadOrder]);
/* ============================================================
   DATABASE STATUS POLLING FALLBACK
   ------------------------------------------------------------
   Socket.IO provides realtime updates when available.
   This polling keeps the database as a reliable fallback.
   ============================================================ */

   useEffect(() => {
    if (!accessToken) {
      return;
    }
  
    const interval = window.setInterval(() => {
      loadOrder(false);
    }, 5000);
  
    return () => {
      window.clearInterval(interval);
    };
  }, [accessToken, loadOrder]);
  /* ============================================================
     COUNTDOWN DISPLAY ONLY
     ============================================================ */

  useEffect(() => {
    const interval =
      window.setInterval(() => {
        setNow(Date.now());
      }, 1000);

    return () => {
      window.clearInterval(interval);
    };
  }, []);

  /* ============================================================
     SOCKET.IO REALTIME
     ============================================================ */

  useEffect(() => {
    if (
      !accessToken ||
      !user?.email
    ) {
      return;
    }

const socket = io(API_URL, {
  auth: {
    token: accessToken,
  },
      transports: [
        "polling",
        "websocket",
      ],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
    });

    socket.on("connect", () => {
      console.log(
        "CampusVita tracking socket connected"
      );
    });

    socket.on(
      "order_update",
      (updatedOrder: Order) => {
        const eventEmail =
          updatedOrder.email ||
          updatedOrder.user_email;

        /*
         * Never display another customer's order.
         */
        if (
          eventEmail &&
          eventEmail.toLowerCase() !==
            user.email.toLowerCase()
        ) {
          return;
        }

        /*
         * Make sure this is the same order.
         */
        const currentOrder =
          orderRef.current;

        if (
          currentOrder?.token &&
          updatedOrder.token &&
          currentOrder.token !==
            updatedOrder.token
        ) {
          return;
        }

        const normalizedUpdatedOrder:
          Order = {
          ...updatedOrder,
          stall_orders:
            buildFallbackStallStates(
              updatedOrder
            ),
        };

        /* ======================================================
           FIND NEWLY CANCELLED STALLS
           ====================================================== */

        const previousStalls =
          currentOrder?.stall_orders ||
          [];

        const updatedStalls =
          normalizedUpdatedOrder.stall_orders ||
          [];

        const newlyCancelledStalls =
          updatedStalls.filter(
            (updatedStall) => {
              if (
                !isCancelledStall(
                  updatedStall
                )
              ) {
                return false;
              }

              const previousStall =
                previousStalls.find(
                  (stall) =>
                    String(
                      stall.stall_id
                    ) ===
                    String(
                      updatedStall.stall_id
                    )
                );

              return (
                !previousStall ||
                !isCancelledStall(
                  previousStall
                )
              );
            }
          );

        const newlyCancelledStallIds =
          new Set(
            newlyCancelledStalls.map(
              (stall) =>
                String(
                  stall.stall_id
                )
            )
          );

        /* ======================================================
           FIND NEWLY CANCELLED ITEMS
           ====================================================== */

        const previousItems =
          currentOrder?.items || [];

        const updatedItems =
          normalizedUpdatedOrder.items ||
          [];

        const newlyCancelledItems =
          updatedItems.filter(
            (updatedItem, index) => {
              if (
                !isCancelledItem(
                  updatedItem
                )
              ) {
                return false;
              }

              /*
               * If the whole stall was cancelled,
               * do NOT show individual item popups.
               *
               * We show one clean stall-level notification
               * instead.
               */
              const itemStallId =
                String(
                  updatedItem.stall_id ||
                    ""
                );

              if (
                newlyCancelledStallIds.has(
                  itemStallId
                )
              ) {
                return false;
              }

              const previousItem =
                previousItems[index];

              /*
               * Only notify when the item changes
               * from active -> cancelled.
               */
              if (
                previousItem &&
                isCancelledItem(
                  previousItem
                )
              ) {
                return false;
              }

              return true;
            }
          );

        /* ======================================================
           UPDATE ORDER STATE
           ====================================================== */

        orderRef.current =
          normalizedUpdatedOrder;

        setOrder(
          normalizedUpdatedOrder
        );

        /* ======================================================
           STALL CANCELLATION NOTIFICATION
           ====================================================== */

        newlyCancelledStalls.forEach(
          (cancelledStall) => {
            const stallId =
              String(
                cancelledStall.stall_id
              );

            const notificationKey =
              `stall-cancelled-${normalizedUpdatedOrder.token}-${stallId}`;

            if (
              notifiedCancellationKeys.current.has(
                notificationKey
              )
            ) {
              return;
            }

            notifiedCancellationKeys.current.add(
              notificationKey
            );

            const stallName =
              cancelledStall.stall_name ||
              findStallName(
                stalls,
                stallId
              );

            const reason =
              getStallCancellationReason(
                cancelledStall
              );

            toast.error(
              reason
                ? `${stallName} order was cancelled: ${reason}`
                : `${stallName} order was cancelled by the vendor.`
            );
          }
        );

        /* ======================================================
           ITEM CANCELLATION NOTIFICATION
           ====================================================== */

        newlyCancelledItems.forEach(
          (cancelledItem, index) => {
            const itemName =
              cancelledItem.name ||
              "Food item";

            const stallId =
              String(
                cancelledItem.stall_id ||
                  ""
              );

            const itemKey =
              getItemKey(
                cancelledItem,
                index
              );

            const notificationKey =
              `item-cancelled-${normalizedUpdatedOrder.token}-${itemKey}`;

            if (
              notifiedCancellationKeys.current.has(
                notificationKey
              )
            ) {
              return;
            }

            notifiedCancellationKeys.current.add(
              notificationKey
            );

            const reason =
              getItemCancellationReason(
                cancelledItem
              );

            toast.error(
              reason
                ? `"${itemName}" was cancelled: ${reason}`
                : `"${itemName}" was cancelled by the vendor.`
            );
          }
        );

        /* ======================================================
           COMPLETE ORDER CANCELLATION
           ====================================================== */

        if (
          normalizedUpdatedOrder.cancelled &&
          !currentOrder?.cancelled
        ) {
          const notificationKey =
            `order-cancelled-${normalizedUpdatedOrder.token}`;

          if (
            !notifiedCancellationKeys.current.has(
              notificationKey
            )
          ) {
            notifiedCancellationKeys.current.add(
              notificationKey
            );

            const reason =
              getOrderCancellationReason(
                normalizedUpdatedOrder
              );

            toast.error(
              reason
                ? `Your order was cancelled: ${reason}`
                : "Your entire order was cancelled by the vendor."
            );
          }

          return;
        }

        /*
         * IMPORTANT:
         *
         * Do not show "Order status updated"
         * when this Socket.IO event was caused by
         * a cancellation.
         *
         * Cancellation already has its own
         * specific notification above.
         */
        const hadCancellation =
          newlyCancelledStalls.length >
            0 ||
          newlyCancelledItems.length >
            0;

        if (!hadCancellation) {
          toast.success(
            "Order status updated"
          );
        }
      }
    );

    socket.on(
      "connect_error",
      (error) => {
        console.warn(
          "Tracking socket connection error:",
          error.message
        );
      }
    );

    return () => {
      socket.disconnect();
    };
  }, [
    accessToken,
    user?.email,
    stalls,
  ]);

  /* ============================================================
     MEMOS
     ============================================================ */

  const stallStates = useMemo(
    () =>
      order?.stall_orders || [],
    [order]
  );

  /*
   * A stall disappears from active tracking when
   * the entire stall order has been cancelled.
   *
   * This does NOT remove a stall merely because one
   * individual item was cancelled.
   */
  const visibleStallStates =
    useMemo(() => {
      return stallStates.filter(
        (stallState) => {
          if (
            isCancelledStall(
              stallState
            )
          ) {
            return false;
          }

          const stallItems =
            order?.items.filter(
              (item) =>
                String(
                  item.stall_id || ""
                ) ===
                String(
                  stallState.stall_id
                )
            ) || [];

          /*
           * If every item belonging to this stall
           * is cancelled, hide the stall from active
           * tracking even if the backend stall state
           * has not yet marked it cancelled.
           */
          if (
            stallItems.length > 0 &&
            stallItems.every(
              (item) =>
                item.cancelled === true
            )
          ) {
            return false;
          }

          return true;
        }
      );
    }, [
      stallStates,
      order?.items,
    ]);

  const overallStatus = useMemo(
    () =>
      getOverallStatus(order),
    [order]
  );

  const getStallName =
    useCallback(
      (stallId: string) => {
        return findStallName(
          stalls,
          stallId
        );
      },
      [stalls]
    );

  const getStallImage =
    useCallback(
      (stallId: string) => {
        const stall =
          stalls.find(
            (item) =>
              String(
                item._id || item.id
              ) ===
              String(stallId)
          );

        return stall?.image
          ? getImageUrl(
              stall.image
            )
          : null;
      },
      [stalls]
    );

  const itemsForStall =
    useCallback(
      (stallId: string) => {
        return (
          order?.items.filter(
            (item) =>
              String(
                item.stall_id || ""
              ) ===
              String(stallId)
          ) || []
        );
      },
      [order]
    );

  const readyStalls =
    visibleStallStates.filter(
      (stall) =>
        stall.status ===
        "Ready For Pickup"
    ).length;

  const activeStalls =
    visibleStallStates.length;

  const cancelledItemCount =
    order?.items.filter(
      (item) => item.cancelled
    ).length || 0;

  /* ============================================================
     LOADING
     ============================================================ */

  if (loading) {
    return (
      <>
        <Navbar />

        <main className="min-h-screen bg-[var(--background)] px-4 pb-28 pt-24 text-white">
          <div className="mx-auto max-w-6xl animate-pulse">
            <div className="h-8 w-40 rounded-lg bg-[var(--surface-secondary)]" />

            <div className="mt-3 h-4 w-72 rounded bg-[var(--surface-secondary)]" />

            <div className="mt-8 h-44 rounded-3xl bg-[var(--surface-secondary)]" />

            <div className="mt-6 h-32 rounded-3xl bg-[var(--surface-secondary)]" />

            <div className="mt-6 h-96 rounded-3xl bg-[var(--surface-secondary)]" />
          </div>
        </main>
      </>
    );
  }

  /* ============================================================
     NO ORDER
     ============================================================ */

  if (!order) {
    return (
      <>
        <Navbar />

        <main className="min-h-screen bg-[var(--background)] px-4 pb-28 pt-24 text-white">
          <div className="mx-auto flex min-h-[70vh] max-w-xl items-center justify-center">
            <div className="w-full rounded-[28px] border border-[var(--border)] bg-[var(--surface)] p-8 text-center shadow-2xl">
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-brand/10">
                <Package className="h-8 w-8 text-brand" />
              </div>

              <h1 className="mt-6 text-2xl font-bold">
                No order found
              </h1>

              <p className="mt-2 text-sm leading-6 text-[var(--text-secondary)]">
                Your latest order will appear
                here once it is available.
              </p>

              <button
                onClick={() =>
                  loadOrder(true)
                }
                disabled={refreshing}
                className="mt-6 inline-flex items-center gap-2 rounded-xl bg-brand px-5 py-3 text-sm font-bold text-[var(--on-primary)] transition hover:bg-brand disabled:opacity-50"
              >
                <RefreshCw
                  className={`h-4 w-4 ${
                    refreshing
                      ? "animate-spin"
                      : ""
                  }`}
                />

                Refresh
              </button>
            </div>
          </div>
        </main>
      </>
    );
  }

  /* ============================================================
     MAIN PAGE
     ============================================================ */

  return (
    <>
      <Navbar />

      <main className="min-h-screen bg-[var(--background)] px-3 pb-28 pt-20 text-white sm:px-5 sm:pt-24">
        <div className="mx-auto max-w-6xl">

          {/* =====================================================
              PAGE HEADER
          ===================================================== */}

          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.18em] text-[var(--text-secondary)]">
                <UtensilsCrossed className="h-4 w-4 text-brand" />
                CampusVita
              </div>

              <h1 className="mt-2 text-2xl font-bold tracking-tight sm:text-4xl">
                Track Order
              </h1>

              <p className="mt-1 text-xs text-[var(--text-secondary)] sm:text-sm">
                Follow every stall preparing
                your order in real time.
              </p>
            </div>

            <button
              onClick={() =>
                loadOrder(true)
              }
              disabled={refreshing}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[var(--border)] bg-[var(--surface)] transition hover:border-brand/30 hover:bg-[var(--surface-secondary)] disabled:opacity-50 sm:h-11 sm:w-11"
              aria-label="Refresh order"
            >
              <RefreshCw
                className={`h-4 w-4 sm:h-5 sm:w-5 ${
                  refreshing
                    ? "animate-spin"
                    : ""
                }`}
              />
            </button>
          </div>

          {/* PREMIUM ORDER SUMMARY BANNER */}
          <section
            className={`relative mt-6 overflow-hidden rounded-[28px] border border-[var(--border)] bg-[var(--surface)] shadow-[0_16px_45px_rgba(54,43,120,0.10)] transition-colors duration-300 ${
              order.cancelled
                ? "border-[var(--border)]"
                : "border-violet-200/70 dark:border-[var(--border)]"
            }`}
          >
            {!order.cancelled && (
              <div className="relative isolate overflow-hidden bg-[#5145CD] text-white">
                <img
                  src="/images/order-tracking-banner.png"
                  alt="CampusVita order tracking banner"
                  className="relative z-0 block h-auto max-h-[180px] min-h-[72px] w-full object-contain object-center sm:absolute sm:inset-0 sm:h-full sm:max-h-none sm:object-cover sm:object-left"
                />

                <div className="pointer-events-none absolute inset-0 hidden bg-gradient-to-r from-[#30258F]/65 via-[#30258F]/45 to-[#30258F]/75 sm:block" />

                <div className="relative z-10 grid min-h-[190px] grid-cols-2 items-center gap-x-3 gap-y-3 bg-[#5145CD] px-4 py-4 sm:min-h-[236px] sm:grid-cols-3 sm:gap-6 sm:bg-transparent sm:px-8 sm:py-8">
                  {/* Order ID and date */}
                  <div className="min-w-0 rounded-xl border border-white/15 bg-[#30258F]/65 p-3 backdrop-blur-sm sm:border-0 sm:bg-transparent sm:p-0 sm:backdrop-blur-0">
                    <div className="text-[10px] font-bold uppercase tracking-[0.13em] text-white/80 sm:text-xs sm:tracking-[0.15em]">
                      Order ID
                    </div>

                    <div className="mt-1 break-words text-base font-black tracking-tight text-white sm:text-xl">
                      #CV{String(order.token).padStart(5, "0")}
                    </div>

                    <div className="mt-2 text-[11px] font-medium leading-4 text-white/90 sm:text-sm">
                      {formatDate(order.created_at || order.date)}
                    </div>
                  </div>

                  {/* Actual order total */}
                  <div className="col-span-2 min-w-0 rounded-xl border border-transparent bg-transparent p-3 sm:col-span-1 sm:translate-x-28 sm:border-0 sm:bg-transparent sm:p-0 sm:text-center">
                    <div className="text-[10px] font-bold uppercase tracking-[0.13em] text-white/80 sm:text-xs sm:tracking-[0.15em]">
                      Total Amount
                    </div>

                    <div className="mt-1 break-words text-2xl font-black tracking-tight !text-white sm:text-3xl">
                      ₹{Number(order.total || 0).toFixed(2)}
                    </div>
                  </div>

                  {/* Live overall status and stall readiness */}
                  <div className="col-span-2 min-w-0 rounded-xl border border-white/15 bg-[#30258F]/65 p-3 backdrop-blur-sm sm:col-span-1 sm:justify-self-end sm:border-0 sm:bg-transparent sm:p-0 sm:text-right sm:backdrop-blur-0">
                    <div className="text-[10px] font-bold uppercase tracking-[0.13em] text-white/80 sm:text-xs sm:tracking-[0.15em]">
                      Order Status
                    </div>

                    <div className="mt-1 break-words text-lg font-black text-white sm:text-xl">
                      {overallStatus}
                    </div>

                    <div className="mt-1 text-xs font-semibold text-white/90 sm:text-sm">
                      Stalls {readyStalls} of {activeStalls} Ready
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Preserve the existing cancellation message */}
            {order.cancelled && (
              <div className="p-5 sm:p-7">
                <div className="flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50 p-4">
                  <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-500" />

                  <div>
                    <div className="text-sm font-bold text-red-700">
                      Order Cancelled
                    </div>

                    <p className="mt-1 text-xs leading-5 text-red-600">
                      {getOrderCancellationReason(order) ||
                        "This order was cancelled by the vendor."}
                    </p>
                  </div>
                </div>
              </div>
            )}
          </section>

          {/* =====================================================
              OVERALL STATUS
          ===================================================== */}

          <section
            className="mt-5 rounded-[26px] border border-[var(--border)] bg-[var(--surface)] p-5 transition-colors duration-300 hover:border-brand/30 sm:p-7"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-base font-bold sm:text-lg">
                  Overall Order Status
                </h2>

                <p className="mt-1 text-xs leading-5 text-[var(--text-secondary)] sm:text-sm">
                  {getOverallStatusDescription(
                    overallStatus
                  )}
                </p>
              </div>

              <div
                className={`shrink-0 rounded-full border px-3 py-1.5 text-[10px] font-bold sm:text-xs ${
                  order.cancelled
                    ? "border-[var(--border)] bg-[var(--surface-secondary)] text-[var(--text-secondary)]"
                    : "border-brand/20 bg-brand/10 text-brand"
                }`}
              >
                {order.cancelled
                  ? "Cancelled"
                  : `${readyStalls}/${activeStalls} Ready`}
              </div>
            </div>

            {/* =================================================
                COMPLETE CANCELLATION STATE
            ================================================= */}

            {order.cancelled ? (
              <div className="mt-7 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 text-center">
                <XCircle className="mx-auto h-9 w-9 text-[var(--text-secondary)]" />

<div className="mt-3 text-sm font-black text-[var(--text-secondary)]">
                  Order Cancelled
                </div>

                <p className="mt-1 text-xs text-[var(--text-secondary)]">
                  No further preparation is taking place.
                </p>
              </div>
            ) : (
              <>
                {/* Overall timeline */}
                <div className="mt-7 hidden sm:block">
                  <div className="relative">
                    <div className="absolute left-[8%] right-[8%] top-5 h-[2px] bg-[var(--border)]" />

                    <div
                      className="absolute left-[8%] top-5 h-[2px] bg-brand transition-all duration-500"
                      style={{
                        width:
                          overallStatus ===
                          "Ready For Pickup"
                            ? "84%"
                            : overallStatus ===
                                "Partially Ready"
                              ? "58%"
                              : overallStatus ===
                                  "Cooking"
                                ? "45%"
                                : overallStatus ===
                                    "Placed"
                                  ? "25%"
                                  : "5%",
                      }}
                    />

                    <div className="relative grid grid-cols-3">
                      {[
                        {
                          label: "Placed",
                          active:
                            statusRank(
                              overallStatus
                            ) >=
                            statusRank(
                              "Placed"
                            ),
                        },
                        {
                          label: "Cooking",
                          active:
                            overallStatus ===
                              "Cooking" ||
                            overallStatus ===
                              "Partially Ready" ||
                            overallStatus ===
                              "Ready For Pickup",
                        },
                        {
                          label: "Ready",
                          active:
                            overallStatus ===
                            "Ready For Pickup",
                        },
                      ].map(
                        (step) => (
                          <div
                            key={
                              step.label
                            }
                            className="flex flex-col items-center"
                          >
                            <div
                              className={`flex h-10 w-10 items-center justify-center rounded-full border ${
                                step.active
                                  ? "border-brand bg-brand text-white shadow-[0_4px_12px_rgba(98,84,217,0.25)]"
                                  : "border-[var(--border)] bg-[var(--surface-secondary)] text-[var(--text-secondary)]"
                              }`}
                            >
                              {step.active ? (
                                <Check className="h-4 w-4" />
                              ) : (
                                <span className="text-xs font-bold">
                                  •
                                </span>
                              )}
                            </div>

                            <span
                              className={`mt-2 text-xs font-semibold ${
                                step.active
                                  ? "text-[var(--text-primary)]"
                                  : "text-[var(--text-secondary)]"
                              }`}
                            >
                              {
                                step.label
                              }
                            </span>
                          </div>
                        )
                      )}
                    </div>
                  </div>
                </div>

                {/* Mobile overall status */}
                <div className="mt-5 grid grid-cols-3 gap-2 sm:hidden">
                  {[
                    "Placed",
                    "Cooking",
                    "Ready",
                  ].map(
                    (label) => {
                      const active =
                        label ===
                          "Placed"
                          ? statusRank(
                              overallStatus
                            ) >=
                            statusRank(
                              "Placed"
                            )
                          : label ===
                              "Cooking"
                            ? [
                                "Cooking",
                                "Partially Ready",
                                "Ready For Pickup",
                              ].includes(
                                overallStatus
                              )
                            : overallStatus ===
                              "Ready For Pickup";

                      return (
                        <div
                          key={label}
                          className={`rounded-2xl border px-2 py-3 text-center transition-colors duration-300 ${
                            active
                              ? "border-brand/40 bg-brand/10 text-brand"
                              : "border-[var(--border)] bg-[var(--surface-secondary)] text-[var(--text-secondary)]"
                          }`}
                        >
                          <div className="text-[10px] font-bold">
                            {label}
                          </div>
                        </div>
                      );
                    }
                  )}
                </div>
              </>
            )}
          </section>

          {/* =====================================================
              STALL-WISE TRACKING
          ===================================================== */}

          <section className="mt-6">
            <div className="mb-4 flex items-end justify-between">
              <div>
                <h2 className="text-lg font-bold sm:text-xl">
                  Stall Wise Tracking
                </h2>

                <p className="mt-1 text-xs text-[var(--text-secondary)] sm:text-sm">
                  Each stall updates independently.
                </p>
              </div>
            </div>

            {visibleStallStates.length ===
              0 ? (
              <div className="rounded-[26px] border border-[var(--border)] bg-[var(--surface)] p-8 text-center">
                <XCircle className="mx-auto h-8 w-8 text-[var(--text-secondary)]" />

                <div className="mt-3 text-sm font-bold text-[var(--text-secondary)]">
                  No active stall orders
                </div>

                <p className="mt-1 text-xs text-[var(--text-secondary)]">
                  All stall orders have been cancelled.
                </p>
              </div>
            ) : (
              <div className="grid gap-5 lg:grid-cols-2">
                {visibleStallStates.map(
                  (stallState) => {
                    const stallItems =
                      itemsForStall(
                        stallState.stall_id
                      );

                    const remaining =
                      getRemainingSeconds(
                        stallState,
                        now
                      );

                    const isCancelled =
                      isCancelledStall(
                        stallState
                      );

                    const isCooking =
                      !isCancelled &&
                      stallState.status ===
                        "Cooking";

                    const isReady =
                      !isCancelled &&
                      stallState.status ===
                        "Ready For Pickup";

                    const isOverdue =
                      isCooking &&
                      remaining !== null &&
                      remaining <= 0;

                    const currentRank =
                      statusRank(
                        stallState.status
                      );

                    const stallImage =
                      getStallImage(
                        stallState.stall_id
                      );

                    return (
                      <article
                        key={
                          stallState.stall_id
                        }
                        className="overflow-hidden rounded-[26px] border border-[var(--border)] bg-[var(--surface)] shadow-[0_12px_36px_rgba(48,40,94,0.08)]"
                      >

                        {/* =================================================
                            STALL HEADER
                        ================================================= */}

                        <div className="p-4 sm:p-5">
                          <div className="flex items-start gap-3">
                            <div className="h-14 w-14 shrink-0 overflow-hidden rounded-2xl bg-[var(--surface-secondary)]">
                              {stallImage ? (
                                <img
                                  src={
                                    stallImage
                                  }
                                  alt={getStallName(
                                    stallState.stall_id
                                  )}
                                  className="h-full w-full object-cover"
                                />
                              ) : (
                                <div className="flex h-full w-full items-center justify-center">
                                  <Store className="h-6 w-6 text-brand" />
                                </div>
                              )}
                            </div>

                            <div className="min-w-0 flex-1">
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <h3 className="truncate text-base font-bold sm:text-lg">
                                    {getStallName(
                                      stallState.stall_id
                                    )}
                                  </h3>

                                  <p className="mt-1 text-[11px] text-[var(--text-secondary)] sm:text-xs">
                                    {
                                      stallItems.length
                                    }{" "}
                                    item
                                    {stallItems.length !==
                                    1
                                      ? "s"
                                      : ""}
                                  </p>
                                </div>

                                <div
                                  className={`flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[10px] font-bold sm:text-xs ${
                                    isReady
                                      ? "bg-emerald-100/70 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300"
                                      : isCooking
                                        ? "bg-brand/10 text-brand"
                                        : "bg-[var(--surface-secondary)] text-[var(--text-secondary)]"
                                  }`}
                                >
                                  {getStallStatusLabel(
                                    stallState.status
                                  )}
                                </div>
                              </div>
                            </div>
                          </div>

                          {/* =================================================
                              TIMER
                          ================================================= */}

                          {isCooking && (
                            <div
                              className={`mt-4 rounded-2xl border p-4 ${
                                isOverdue
                                  ? "border-red-300 bg-red-50 dark:border-red-800 dark:bg-red-950/40"
                                  : "border-[var(--border)] bg-[var(--surface-secondary)]"
                              }`}
                            >
                              <div className="flex items-center justify-between gap-4">
                                <div className="flex min-w-0 items-center gap-3">
                                  <div
                                    className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
                                      isOverdue
                                        ? "bg-red-100 dark:bg-red-900/40"
                                        : "bg-brand/10"
                                    }`}
                                  >
                                    <Clock3
                                      className={`h-5 w-5 ${
                                        isOverdue
                                          ? "text-red-600 dark:text-red-400"
                                          : "text-brand"
                                      }`}
                                    />
                                  </div>

                                  <div className="min-w-0">
                                    <div
                                      className={`text-xs font-bold sm:text-sm ${
                                        isOverdue
                                          ? "text-red-700 dark:text-red-300"
                                          : "text-[var(--text-primary)]"
                                      }`}
                                    >
                                      {isOverdue
                                        ? "Taking longer than expected"
                                        : "Estimated preparation time"}
                                    </div>

                                    <div className="mt-1 text-[10px] text-[var(--text-secondary)] sm:text-xs">
                                      {isOverdue
                                        ? "The vendor is still preparing your food."
                                        : stallState.estimatedPreparationMinutes >
                                            0
                                          ? `${stallState.estimatedPreparationMinutes} min preparation`
                                          : "Preparation time unavailable"}
                                    </div>
                                  </div>
                                </div>

                                {!isOverdue &&
                                  remaining !==
                                    null && (
                                    <div className="shrink-0 font-mono text-xl font-black tracking-tight text-brand sm:text-2xl">
                                      {formatCountdown(
                                        remaining
                                      )}
                                    </div>
                                  )}
                              </div>
                            </div>
                          )}
                        </div>

                        {/* =================================================
                            STALL TIMELINE
                        ================================================= */}

                        <div className="border-t border-[var(--border)] px-4 py-5 sm:px-5">
                          <div className="relative">
                            <div className="absolute left-5 right-5 top-4 h-[2px] bg-[var(--border)]" />

                            <div
                              className="absolute left-5 top-4 h-[2px] bg-brand transition-all duration-500"
                              style={{
                                width: `${Math.min(
                                  100,
                                  Math.max(
                                    0,
                                    currentRank /
                                      (STATUS_ORDER.length -
                                        1) *
                                      100
                                  )
                                )}%`,
                              }}
                            />

                            <div className="relative grid grid-cols-5 gap-1">
                              {STATUS_ORDER.map(
                                (
                                  status,
                                  index
                                ) => {
                                  const completed =
                                    currentRank >
                                    index;

                                  const active =
                                    currentRank ===
                                    index;

                                  return (
                                    <div
                                      key={
                                        status
                                      }
                                      className="flex min-w-0 flex-col items-center"
                                    >
                                      <div
                                        className={`flex h-8 w-8 items-center justify-center rounded-full border ${
                                          completed ||
                                          isReady
                                            ? "border-[#6254D9] bg-[#6254D9] text-white shadow-[0_4px_12px_rgba(98,84,217,0.25)]"
                                            : active
                                              ? "border-brand bg-brand/10 text-brand"
                                              : "border-[var(--border)] bg-[var(--surface-secondary)] text-[var(--text-secondary)]"
                                        }`}
                                      >
                                        {completed ||
                                        isReady ? (
                                          <Check className="h-3.5 w-3.5" />
                                        ) : (
                                          <span className="text-[9px] font-bold">
                                            {index +
                                              1}
                                          </span>
                                        )}
                                      </div>

                                      <span
                                        className={`mt-2 text-center text-[8px] font-medium leading-tight sm:text-[9px] ${
                                          active ||
                                          completed ||
                                          isReady
                                            ? "text-brand"
                                            : "text-[var(--text-secondary)]"
                                        }`}
                                      >
                                        {status ===
                                        "Ready For Pickup"
                                          ? "Ready"
                                          : status}
                                      </span>
                                    </div>
                                  );
                                }
                              )}
                            </div>
                          </div>

                          {/* =================================================
                              STALL ITEMS
                          ================================================= */}

                          <div className="mt-5 space-y-2">
                            {stallItems.map(
                              (
                                item,
                                index
                              ) => {
                                const itemCancelled =
                                  isCancelledItem(
                                    item
                                  );

                                return (
                                  <div
                                    key={`${item.name}-${index}`}
                                    className={`flex items-center gap-3 rounded-2xl border p-3 transition-all duration-200 ${
                                      itemCancelled
                                        ? "border-[var(--border)] bg-[var(--surface-secondary)] opacity-75"
                                        : "border-[var(--border)] bg-[var(--surface)] hover:border-brand/40"
                                    }`}
                                  >
                                    {/* Item image */}
                                    <div
                                      className={`h-12 w-12 shrink-0 overflow-hidden rounded-xl bg-[var(--surface-secondary)] ${
                                        itemCancelled
                                          ? "grayscale brightness-[0.25]"
                                          : ""
                                      }`}
                                    >
                                      {item.image ? (
                                        <img
                                          src={getImageUrl(
                                            item.image
                                          )}
                                          alt={
                                            item.name
                                          }
                                          className="h-full w-full object-cover"
                                        />
                                      ) : (
                                        <div className="flex h-full w-full items-center justify-center">
                                          <UtensilsCrossed
                                            className={`h-5 w-5 ${
                                              itemCancelled
                                                ? "text-[var(--text-secondary)]"
                                                : "text-[var(--text-secondary)]"
                                            }`}
                                          />
                                        </div>
                                      )}
                                    </div>

                                    {/* Item information */}
                                    <div className="min-w-0 flex-1">
                                      <div
                                        className={`truncate text-xs font-bold sm:text-sm ${
                                          itemCancelled
                                            ? "text-[var(--text-secondary)] line-through"
                                            : "text-[var(--text-primary)]"
                                        }`}
                                      >
                                        {
                                          item.name
                                        }
                                      </div>

                                      <div
                                        className={`mt-1 text-[10px] sm:text-xs ${
                                          itemCancelled
                                            ? "text-[var(--text-secondary)]"
                                            : "text-[var(--text-secondary)]"
                                        }`}
                                      >
                                        Qty{" "}
                                        {
                                          item.quantity
                                        }
                                      </div>

                                      {itemCancelled && (
                                        <div className="mt-1 flex items-center gap-1 text-[9px] font-bold uppercase tracking-wide text-red-600 sm:text-[10px]">
                                          <XCircle className="h-3 w-3" />
                                          Cancelled
                                        </div>
                                      )}

                                      {itemCancelled &&
                                        getItemCancellationReason(
                                          item
                                        ) && (
                                          <div className="mt-1 truncate text-[9px] text-[var(--text-secondary)]">
                                            {
                                              getItemCancellationReason(
                                                item
                                              )
                                            }
                                          </div>
                                        )}
                                    </div>

                                    {/* Price / cancellation */}
                                    <div className="shrink-0 text-right">
                                      <div
                                        className={`text-xs font-bold sm:text-sm ${
                                          itemCancelled
                                            ? "text-[var(--text-secondary)] line-through"
                                            : "text-brand"
                                        }`}
                                      >
                                        ₹
                                        {(
                                          Number(
                                            item.price ||
                                              0
                                          ) *
                                          Number(
                                            item.quantity ||
                                              0
                                          )
                                        ).toFixed(
                                          0
                                        )}
                                      </div>

                                      {itemCancelled && (
                                        <div className="mt-1 text-[9px] font-bold text-red-600">
                                          Cancelled
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                );
                              }
                            )}
                          </div>
                        </div>
                      </article>
                    );
                  }
                )}
              </div>
            )}
          </section>

          {/* =====================================================
              CANCELLED ITEMS SUMMARY
          ===================================================== */}

          {cancelledItemCount > 0 &&
            !order.cancelled && (
              <div className="mt-6 rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-center">
                <div className="text-xs font-bold text-[var(--text-secondary)]">
                  {cancelledItemCount} item
                  {cancelledItemCount !==
                  1
                    ? "s"
                    : ""}{" "}
                  cancelled
                </div>

                <div className="mt-1 text-[10px] text-[var(--text-secondary)]">
                  Other active items continue to be prepared normally.
                </div>
              </div>
            )}

          {/* =====================================================
              LIVE STATUS
          ===================================================== */}

          <div className="mt-6 flex items-center justify-center gap-2 pb-2 text-[10px] text-[var(--text-secondary)] sm:text-xs">
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                order.cancelled
                  ? "bg-[var(--text-secondary)]"
                  : "animate-pulse bg-emerald-500"
              }`}
            />

            {order.cancelled
              ? "Order cancelled"
              : cancelledItemCount >
                  0
                ? `${cancelledItemCount} item${
                    cancelledItemCount !==
                    1
                      ? "s"
                      : ""
                  } cancelled`
                : "Live order updates enabled"}
          </div>
        </div>
      </main>
    </>
  );
}