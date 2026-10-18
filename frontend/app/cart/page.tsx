"use client";

import Script from "next/script";
import toast from "react-hot-toast";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";

import {
  ArrowLeft,
  ArrowRight,
  ChefHat,
  ChevronRight,
  CreditCard,
  Loader2,
  LockKeyhole,
  Minus,
  Plus,
  ShoppingCart,
  Store,
  Trash2,
  UtensilsCrossed,
  Wallet,
  X,
} from "lucide-react";

import { getAccessToken } from "@/app/lib/auth/session";
import { getImageUrl } from "@/app/lib/getImageUrl";
import { useCart } from "@/context/CartContext";

const API_URL =
  process.env.NEXT_PUBLIC_API_URL ||
  "http://127.0.0.1:8000";

declare global {
  interface Window {
    Razorpay: any;
  }
}

type PaymentMethod = "ONLINE" | "WALLET";

type Profile = {
  name: string;
  email: string;
  phone: string;
  department: string;
  year: string;
  profile_image: string;
  notifications: boolean;
  theme: string;
  favorite_foods: string[];
  wallet: number;
};

type BillSummary = {
  subtotal: number;
  delivery_fee: number;
  tax_amount: number;
  discount: number;
  total: number;
};

type Stall = {
  _id: string;
  name: string;
  image: string;
  description: string;
  is_open: boolean;
  active: boolean;
  rating: number | null;
  opening_time: string | null;
  closing_time: string | null;
  preparation_time: string | null;
};

type CartItem = {
  name: string;
  price: number;
  image: string;
  quantity: number;
  stall_id: string;
};

type StallGroup = {
  stallId: string;
  items: CartItem[];
};

export default function CartPage() {
  const router = useRouter();

  const {
    cartItems,
    increaseQuantity,
    decreaseQuantity,
    removeItem,
    clearCart,
  } = useCart();

  const [profile, setProfile] =
    useState<Profile | null>(null);

  const [profileLoading, setProfileLoading] =
    useState(true);

  const [bill, setBill] =
    useState<BillSummary | null>(null);

  const [billLoading, setBillLoading] =
    useState(false);

  const [paymentMethod, setPaymentMethod] =
    useState<PaymentMethod>("ONLINE");

  const [paymentSheetOpen, setPaymentSheetOpen] =
    useState(false);

  const [loading, setLoading] =
    useState(false);

  const [stallMap, setStallMap] =
    useState<Record<string, Stall>>({});

  const [stallLoading, setStallLoading] =
    useState(false);

  const actionLock =
    useRef(false);

  const items =
    cartItems as CartItem[];

  /*
   * ============================================================
   * CART COUNTS
   * ============================================================
   */

  const totalQuantity = useMemo(() => {
    return items.reduce(
      (sum, item) =>
        sum + Number(item.quantity || 0),
      0
    );
  }, [items]);

  /*
   * ============================================================
   * GROUP CART BY STALL
   * ============================================================
   */

  const stallGroups = useMemo(() => {
    const map =
      new Map<string, CartItem[]>();

    for (const item of items) {
      const stallId =
        String(item.stall_id || "").trim();

      if (!stallId) continue;

      const existing =
        map.get(stallId) || [];

      existing.push(item);

      map.set(stallId, existing);
    }

    return Array.from(
      map.entries()
    ).map(
      ([stallId, groupItems]) => ({
        stallId,
        items: groupItems,
      })
    );
  }, [items]);

  /*
   * ============================================================
   * LOAD STALL METADATA
   * ============================================================
   */

  useEffect(() => {
    const stallIds =
      Array.from(
        new Set(
          stallGroups
            .map(
              (group) =>
                group.stallId
            )
            .filter(Boolean)
        )
      );

    if (stallIds.length === 0) {
      return;
    }

    const missingIds =
      stallIds.filter(
        (id) => !stallMap[id]
      );

    if (missingIds.length === 0) {
      return;
    }

    let cancelled = false;

    async function loadStalls() {
      try {
        setStallLoading(true);

        const results =
          await Promise.all(
            missingIds.map(
              async (stallId) => {
                try {
                  const response =
                    await fetch(
                      `${API_URL}/stalls/${encodeURIComponent(
                        stallId
                      )}/foods`,
                      {
                        method: "GET",
                        headers: {
                          Accept:
                            "application/json",
                        },
                        cache:
                          "no-store",
                      }
                    );

                  if (!response.ok) {
                    throw new Error(
                      `Failed to load stall ${stallId}`
                    );
                  }

                  const data =
                    await response.json();

                  if (
                    !data?.success ||
                    !data?.stall
                  ) {
                    throw new Error(
                      "Invalid stall response"
                    );
                  }

                  return {
                    id: stallId,
                    stall:
                      data.stall as Stall,
                  };
                } catch (error) {
                  console.error(
                    "Stall metadata error:",
                    error
                  );

                  return {
                    id: stallId,
                    stall: null,
                  };
                }
              }
            )
          );

        if (cancelled) return;

        setStallMap(
          (current) => {
            const next = {
              ...current,
            };

            for (const result of results) {
              if (result.stall) {
                next[result.id] =
                  result.stall;
              }
            }

            return next;
          }
        );
      } finally {
        if (!cancelled) {
          setStallLoading(false);
        }
      }
    }

    void loadStalls();

    return () => {
      cancelled = true;
    };
  }, [stallGroups, stallMap]);

  /*
   * ============================================================
   * LOAD PROFILE
   * ============================================================
   */

  useEffect(() => {
    let cancelled = false;

    async function loadProfile() {
      const token =
        getAccessToken("USER");

      if (!token) {
        router.replace("/login");
        return;
      }

      try {
        setProfileLoading(true);

        const response =
          await fetch(
            `${API_URL}/profile`,
            {
              method: "GET",
              headers: {
                Authorization:
                  `Bearer ${token}`,
              },
              cache:
                "no-store",
            }
          );

        if (
          response.status === 401
        ) {
          router.replace("/login");
          return;
        }

        if (!response.ok) {
          const errorData =
            await response
              .json()
              .catch(() => null);

          throw new Error(
            errorData?.detail ||
              "Failed to load profile"
          );
        }

        const data =
          await response.json();

        if (cancelled) return;

        setProfile({
          name:
            data.name ?? "",
          email:
            data.email ?? "",
          phone:
            data.phone ?? "",
          department:
            data.department ?? "",
          year:
            data.year ?? "",
          profile_image:
            data.profile_image ?? "",
          notifications:
            data.notifications ??
            true,
          theme:
            data.theme ??
            "dark",
          favorite_foods:
            Array.isArray(
              data.favorite_foods
            )
              ? data.favorite_foods
              : [],
          wallet:
            Number(
              data.wallet ?? 0
            ),
        });
      } catch (error) {
        console.error(
          "Profile error:",
          error
        );

        if (!cancelled) {
          toast.error(
            error instanceof Error
              ? error.message
              : "Unable to load profile"
          );
        }
      } finally {
        if (!cancelled) {
          setProfileLoading(false);
        }
      }
    }

    void loadProfile();

    return () => {
      cancelled = true;
    };
  }, [router]);

  /*
   * ============================================================
   * LOAD BACKEND BILL
   * ============================================================
   */

  useEffect(() => {
    let cancelled = false;

    async function loadBill() {
      if (items.length === 0) {
        setBill(null);
        setBillLoading(false);
        return;
      }

      const token =
        getAccessToken("USER");

      if (!token) {
        router.replace("/login");
        return;
      }

      try {
        setBillLoading(true);

        const response =
          await fetch(
            `${API_URL}/cart/summary`,
            {
              method: "POST",
              headers: {
                "Content-Type":
                  "application/json",
                Authorization:
                  `Bearer ${token}`,
              },
              body: JSON.stringify({
                items: items.map(item => ({
                  name: item.name,
                  quantity: Number(item.quantity),
                  stall_id: item.stall_id,
                })),
              }),
              cache:
                "no-store",
            }
          );

        if (!response.ok) {
          const error =
            await response
              .json()
              .catch(() => null);

          throw new Error(
            error?.detail ||
              "Failed to calculate cart total"
          );
        }

        const data =
          await response.json();

        if (cancelled) return;

        setBill({
          subtotal:
            Number(
              data.subtotal ?? 0
            ),
          delivery_fee:
            Number(
              data.delivery_fee ?? 0
            ),
          tax_amount:
            Number(
              data.tax_amount ?? 0
            ),
          discount:
            Number(
              data.discount ?? 0
            ),
          total:
            Number(
              data.total ?? 0
            ),
        });
      } catch (error) {
        console.error(
          "Cart summary error:",
          error
        );

        if (!cancelled) {
          setBill(null);

          toast.error(
            error instanceof Error
              ? error.message
              : "Failed to calculate total"
          );
        }
      } finally {
        if (!cancelled) {
          setBillLoading(false);
        }
      }
    }

    void loadBill();

    return () => {
      cancelled = true;
    };
  }, [items, router]);

  /*
   * ============================================================
   * BILL HELPERS
   * ============================================================
   */

  const walletBalance =
    Number(
      profile?.wallet ?? 0
    );

  const total =
    Number(
      bill?.total ?? 0
    );

  const walletCanPay =
    walletBalance >= total;

  const paymentLabel =
    paymentMethod === "WALLET"
      ? "App Wallet"
      : "Online Payment";

  const getStallSubtotal = (
    group: StallGroup
  ) => {
    return group.items.reduce(
      (sum, item) =>
        sum +
        Number(item.price || 0) *
          Number(
            item.quantity || 0
          ),
      0
    );
  };

  /*
   * ============================================================
   * ACTION LOCK
   * ============================================================
   */

  const acquireLock = () => {
    if (actionLock.current) {
      return false;
    }

    actionLock.current = true;
    setLoading(true);

    return true;
  };

  const releaseLock = () => {
    actionLock.current = false;
    setLoading(false);
  };

  /*
   * ============================================================
   * RAZORPAY
   * ============================================================
   */

  const waitForRazorpay =
    async (): Promise<boolean> => {
      if (window.Razorpay) {
        return true;
      }

      return new Promise(
        (resolve) => {
          const started =
            Date.now();

          const timer =
            window.setInterval(
              () => {
                if (
                  window.Razorpay
                ) {
                  window.clearInterval(
                    timer
                  );

                  resolve(true);
                  return;
                }

                if (
                  Date.now() -
                    started >
                  10000
                ) {
                  window.clearInterval(
                    timer
                  );

                  resolve(false);
                }
              },
              100
            );
        }
      );
    };

  /*
   * ============================================================
   * VERIFY PAYMENT
   * ============================================================
   */

  const verifyPayment =
    async (
      paymentResponse: any,
      orderIntent: string
    ) => {
      try {
        const token =
          getAccessToken("USER");

        if (!token) {
          toast.error(
            "Please login again"
          );

          router.replace("/login");
          return;
        }

        const response =
          await fetch(
            `${API_URL}/verify-payment`,
            {
              method: "POST",
              headers: {
                "Content-Type":
                  "application/json",
                Authorization:
                  `Bearer ${token}`,
              },
              body: JSON.stringify({
                razorpay_payment_id:
                  paymentResponse.razorpay_payment_id,

                razorpay_order_id:
                  paymentResponse.razorpay_order_id,

                razorpay_signature:
                  paymentResponse.razorpay_signature,

                order_intent:
                  orderIntent,
              }),
            }
          );

        const data =
          await response.json();

        if (!response.ok) {
          throw new Error(
            data?.detail ||
              "Payment verification failed"
          );
        }

        if (!data.success) {
          throw new Error(
            data?.message ||
              "Payment verification failed"
          );
        }

        localStorage.setItem(
          "latestOrder",
          JSON.stringify(
            data.order
          )
        );

        localStorage.setItem(
          "latestPayment",
          JSON.stringify({
            paymentId:
              data.payment_id,

            orderId:
              data.order?._id ||
              data.order?.order_id ||
              paymentResponse.razorpay_order_id,

            amount:
              data.order?.total ??
              bill?.total ??
              0,

            method:
              "ONLINE",
          })
        );

        clearCart();

        setPaymentSheetOpen(
          false
        );

        toast.success(
          "Payment verified successfully"
        );

        router.push(
          "/payment-success"
        );
      } catch (error) {
        console.error(
          "Payment verification error:",
          error
        );

        toast.error(
          error instanceof Error
            ? error.message
            : "Payment verification failed. Your cart is safe."
        );
      } finally {
        releaseLock();
      }
    };

  /*
   * ============================================================
   * ONLINE PAYMENT
   * ============================================================
   */

  const handleOnlinePayment =
    async () => {
      if (!profile) {
        toast.error(
          "Loading profile details..."
        );
        return;
      }

      if (!bill) {
        toast.error(
          "Calculating final amount..."
        );
        return;
      }

      if (bill.total <= 0) {
        toast.error(
          "Invalid order amount"
        );
        return;
      }

      if (!acquireLock()) return;

      try {
        const token =
          getAccessToken("USER");

        if (!token) {
          router.replace("/login");
          releaseLock();
          return;
        }

        const response =
          await fetch(
            `${API_URL}/create-razorpay-order`,
            {
              method: "POST",
              headers: {
                "Content-Type":
                  "application/json",
                Authorization:
                  `Bearer ${token}`,
              },
              body: JSON.stringify({
                items: items.map(item => ({
                  name: item.name,
                  quantity: Number(item.quantity),
                  stall_id: item.stall_id,
                })),
                name: profile.name,
                phone: profile.phone,
              }),
            }
          );

        const data =
          await response.json();

        if (!response.ok) {
          throw new Error(
            data?.detail ||
              "Failed to create payment"
          );
        }

        if (!data.success) {
          throw new Error(
            data?.message ||
              "Failed to create payment"
          );
        }

        const razorpayReady =
          await waitForRazorpay();

        if (!razorpayReady) {
          throw new Error(
            "Payment gateway is unavailable. Please try again."
          );
        }

        const options = {
          key: data.key,

          amount:
            data.amount,

          currency:
            data.currency ||
            "INR",

          name:
            "CampusVita",

          description:
            "CampusVita Food Order",

          order_id:
            data.order_id,

          prefill: {
            name:
              profile.name,

            email:
              profile.email,

            contact:
              profile.phone,
          },

          theme: {
            color:
              "#686ee8",
          },

          handler:
            async (
              paymentResponse: any
            ) => {
              await verifyPayment(
                paymentResponse,
                data.order_intent
              );
            },

          modal: {
            ondismiss:
              () => {
                toast(
                  "Payment cancelled. Your cart is safe."
                );

                releaseLock();
              },
          },
        };

        const razor =
          new window.Razorpay(
            options
          );

        razor.on(
          "payment.failed",
          (
            response: any
          ) => {
            console.error(
              "Razorpay payment failed:",
              response?.error
            );

            toast.error(
              response?.error
                ?.description ||
                "Payment failed. Your cart is safe."
            );

            releaseLock();
          }
        );

        razor.open();
      } catch (error) {
        console.error(
          "Online payment error:",
          error
        );

        toast.error(
          error instanceof Error
            ? error.message
            : "Unable to start payment"
        );

        releaseLock();
      }
    };

  /*
   * ============================================================
   * WALLET PAYMENT
   * ============================================================
   */

  const handleWalletPayment =
    async () => {
      if (!profile) {
        toast.error(
          "Loading wallet details..."
        );
        return;
      }

      if (!bill) {
        toast.error(
          "Calculating final amount..."
        );
        return;
      }

      if (
        walletBalance <
        bill.total
      ) {
        toast.error(
          `Insufficient wallet balance. Need ₹${bill.total.toFixed(
            0
          )} but only ₹${walletBalance.toFixed(
            0
          )} is available.`
        );

        return;
      }

      if (!acquireLock()) return;

      try {
        const token =
          getAccessToken("USER");

        if (!token) {
          router.replace("/login");
          releaseLock();
          return;
        }

        const checkoutPayload = {
          items: items.map(item => ({
            name: item.name,
            quantity: Number(item.quantity),
            stall_id: item.stall_id,
          })),
          name: profile.name,
          phone: profile.phone,
        };
        const checkoutFingerprint = JSON.stringify(checkoutPayload);
        const savedCheckout = localStorage.getItem(
          "campusvita-wallet-checkout"
        );
        let idempotencyKey: string;
        try {
          const parsed = savedCheckout
            ? JSON.parse(savedCheckout)
            : null;
          idempotencyKey =
            parsed?.fingerprint === checkoutFingerprint &&
            typeof parsed?.key === "string"
              ? parsed.key
              : crypto.randomUUID();
        } catch {
          idempotencyKey = crypto.randomUUID();
        }
        localStorage.setItem(
          "campusvita-wallet-checkout",
          JSON.stringify({
            fingerprint: checkoutFingerprint,
            key: idempotencyKey,
          })
        );

        const response =
          await fetch(
            `${API_URL}/wallet/pay-order`,
            {
              method: "POST",
              headers: {
                "Content-Type":
                  "application/json",
                Authorization:
                  `Bearer ${token}`,
              },
              body: JSON.stringify({
                ...checkoutPayload,
                idempotency_key: idempotencyKey,
              }),
            }
          );

        const data =
          await response.json();

        if (!response.ok) {
          throw new Error(
            data?.detail ||
              "Wallet payment failed"
          );
        }

        if (!data.success) {
          throw new Error(
            data?.message ||
              "Wallet payment failed"
          );
        }

        localStorage.setItem(
          "latestOrder",
          JSON.stringify(
            data.order
          )
        );

        localStorage.setItem(
          "latestPayment",
          JSON.stringify({
            paymentId:
              data.payment_id ||
              null,

            orderId:
              data.order?.order_id ||
              data.order?._id ||
              null,

            amount:
              data.amount_paid ??
              bill.total,

            method:
              "WALLET",
          })
        );

        clearCart();
        localStorage.removeItem(
          "campusvita-wallet-checkout"
        );

        setPaymentSheetOpen(
          false
        );

        toast.success(
          "Order placed using CampusVita Wallet"
        );

        router.push(
          "/payment-success"
        );
      } catch (error) {
        console.error(
          "Wallet payment error:",
          error
        );

        toast.error(
          error instanceof Error
            ? error.message
            : "Wallet payment failed"
        );
      } finally {
        releaseLock();
      }
    };

  /*
   * ============================================================
   * PLACE ORDER
   * ============================================================
   */

  const handlePlaceOrder =
    async () => {
      if (!bill) {
        toast.error(
          "Please wait for the final amount"
        );

        return;
      }

      if (
        paymentMethod ===
        "WALLET"
      ) {
        await handleWalletPayment();
        return;
      }

      await handleOnlinePayment();
    };

  /*
   * ============================================================
   * PAYMENT METHOD
   * ============================================================
   */

  const selectPaymentMethod = (
    method: PaymentMethod
  ) => {
    if (
      method === "WALLET" &&
      !walletCanPay
    ) {
      toast.error(
        `Insufficient wallet balance. Need ₹${total.toFixed(
          0
        )} • Available ₹${walletBalance.toFixed(
          0
        )}`
      );

      return;
    }

    setPaymentMethod(method);
  };

  /*
   * ============================================================
   * EMPTY CART
   * ============================================================
   */

  if (items.length === 0) {
    return (
      <>
        <main className="min-h-screen bg-[var(--background)] px-4 pb-24 text-[var(--text-primary)]">
          <header className="sticky top-0 z-40 -mx-4 border-b border-[var(--border)] bg-[var(--navbar)]/95 px-4 backdrop-blur-xl">
            <div className="mx-auto flex h-[68px] max-w-5xl items-center justify-between">
              <button
                type="button"
                onClick={() =>
                  router.back()
                }
                aria-label="Go back"
                className="flex h-10 w-10 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--surface)] text-[var(--text-secondary)] transition hover:bg-[var(--surface-secondary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]"
              >
                <ArrowLeft
                  size={21}
                />
              </button>

              <div className="flex items-center gap-2">
                <ChefHat
                  size={23}
                  className="text-[var(--brand)]"
                />

                <span className="text-xl font-bold tracking-tight text-[var(--brand)]">
                  CampusVita
                </span>
              </div>

              <div className="h-10 w-10" />
            </div>
          </header>

          <div className="mx-auto flex min-h-[75vh] max-w-md flex-col items-center justify-center text-center">
            <div className="flex h-20 w-20 items-center justify-center rounded-3xl border border-[var(--brand)]/20 bg-[var(--brand-soft)]">
              <ShoppingCart
                size={35}
                className="text-[var(--brand)]"
              />
            </div>

            <h1 className="mt-6 text-2xl font-bold tracking-tight">
              Your Cart Is Empty
            </h1>

            <p className="mt-2 max-w-xs text-sm leading-6 text-[var(--text-muted)]">
              Add food from any CampusVita
              stall to start your order.
            </p>

            <button
              type="button"
              onClick={() =>
                router.push("/")
              }
              className="cv-press mt-7 flex items-center gap-2 rounded-2xl bg-[var(--accent)] px-6 py-3.5 text-sm font-bold text-[var(--on-accent)] shadow-[var(--accent-shadow)] transition hover:bg-[var(--accent-hover)] active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--background)]"
            >
              Explore Food
              <ArrowRight
                size={17}
              />
            </button>
          </div>
        </main>

        <MobileBottomNav />
      </>
    );
  }

  /*
   * ============================================================
   * MAIN CART
   * ============================================================
   */

  return (
    <>
      <Script
        src="https://checkout.razorpay.com/v1/checkout.js"
        strategy="afterInteractive"
      />

      <main className="min-h-screen bg-[var(--background)] pb-[190px] text-[var(--text-primary)]">
        {/* HEADER */}

        <header className="sticky top-0 z-40 border-b border-[var(--border)] bg-[var(--navbar)]/95 px-4 backdrop-blur-xl">
          <div className="mx-auto flex h-[68px] max-w-6xl items-center justify-between">
            <button
              type="button"
              onClick={() =>
                router.back()
              }
              aria-label="Go back"
              className="flex h-10 w-10 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--surface)] text-[var(--text-secondary)] transition hover:bg-[var(--surface-secondary)] active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]"
            >
              <ArrowLeft
                size={21}
              />
            </button>

            <div className="flex items-center gap-2">
              <ChefHat
                size={23}
                className="text-[var(--brand)]"
              />

              <span className="text-xl font-bold tracking-tight text-[var(--brand)]">
                CampusVita
              </span>
            </div>

            <div className="relative flex h-10 w-10 items-center justify-center">
              <ShoppingCart
                size={22}
                className="text-[var(--text-primary)]"
              />

              <span className="absolute -right-0.5 -top-1 flex h-[19px] min-w-[19px] items-center justify-center rounded-full bg-[var(--brand)] px-1 text-[10px] font-bold text-white ring-2 ring-[var(--navbar)]">
                {totalQuantity}
              </span>
            </div>
          </div>
        </header>

        <div className="mx-auto max-w-6xl px-4 pt-7 sm:px-6 lg:px-8">
          {/* TITLE */}

          <div className="mb-7">
            <div className="flex items-end justify-between gap-4">
              <div>
                <p className="mb-1 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--brand)]">
                  Checkout
                </p>

                <h1 className="text-[30px] font-bold tracking-tight sm:text-4xl">
                  Your Cart
                </h1>

                <p className="mt-1.5 text-sm text-[var(--text-muted)]">
                  Review your items before placing the order.
                </p>
              </div>

              <div className="hidden shrink-0 rounded-full border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-xs font-semibold text-[var(--text-secondary)] sm:block">
                {totalQuantity}{" "}
                {totalQuantity === 1
                  ? "item"
                  : "items"}
              </div>
            </div>
          </div>

          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_370px]">
            {/* LEFT */}

            <section className="min-w-0">
              <div className="space-y-4">
                {stallGroups.map(
                  (
                    group,
                    groupIndex
                  ) => {
                    const stall =
                      stallMap[
                        group.stallId
                      ];

                    const subtotal =
                      getStallSubtotal(
                        group
                      );

                    const isPrimary =
                      groupIndex %
                        2 ===
                      0;

                    return (
                      <article
                        key={
                          group.stallId
                        }
                        className="cv-glass-card cv-glass-edge overflow-hidden rounded-[24px] border border-[var(--glass-border)]"
                      >
                        {/* STALL HEADER */}

                        <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] px-4 py-4 sm:px-5">
                          <div className="flex min-w-0 items-center gap-3">
                            <div
                              className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
                                isPrimary
                                  ? "bg-[var(--brand-soft)]"
                                  : "bg-emerald-500/10"
                              }`}
                            >
                              <UtensilsCrossed
                                size={20}
                                className={
                                  isPrimary
                                    ? "text-[var(--brand)]"
                                    : "text-emerald-500"
                                }
                              />
                            </div>

                            <div className="min-w-0">
                              {stall ? (
                                <>
                                  <h2 className="truncate text-base font-bold sm:text-lg">
                                    {
                                      stall.name
                                    }
                                  </h2>

                                  <div className="mt-1 flex items-center gap-2">
                                    <span
                                      className={`h-1.5 w-1.5 rounded-full ${
                                        stall.is_open
                                          ? "bg-emerald-500"
                                          : "bg-red-500"
                                      }`}
                                    />

                                    <span className="text-[11px] font-medium text-[var(--text-muted)]">
                                      {stall.is_open
                                        ? "Open"
                                        : "Closed"}
                                    </span>
                                  </div>
                                </>
                              ) : (
                                <>
                                  <h2 className="text-base font-semibold text-[var(--text-secondary)]">
                                    {stallLoading
                                      ? "Loading stall..."
                                      : "Stall details unavailable"}
                                  </h2>

                                  <p className="mt-1 text-[10px] text-[var(--text-muted)]">
                                    {group.stallId}
                                  </p>
                                </>
                              )}
                            </div>
                          </div>

                          {stall && (
                            <span className="hidden shrink-0 rounded-lg bg-[var(--surface-secondary)] px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)] sm:block">
                              Stall
                            </span>
                          )}
                        </div>

                        {/* ITEMS */}

                        <div className="px-4 sm:px-5">
                          {group.items.map(
                            (
                              item,
                              itemIndex
                            ) => {
                              const itemTotal =
                                Number(
                                  item.price
                                ) *
                                Number(
                                  item.quantity
                                );

                              return (
                                <div
                                  key={`${group.stallId}-${item.name}`}
                                  className={`py-5 ${
                                    itemIndex !==
                                    group.items
                                      .length -
                                      1
                                      ? "border-b border-dashed border-[var(--border)]"
                                      : ""
                                  }`}
                                >
                                  <div className="flex gap-3.5 sm:gap-4">
                                    {/* IMAGE */}

                                    <div className="h-[82px] w-[82px] shrink-0 overflow-hidden rounded-2xl bg-[var(--surface-secondary)] sm:h-[92px] sm:w-[92px]">
                                      {item.image ? (
                                        <img
                                          src={getImageUrl(
                                            item.image
                                          )}
                                          alt={
                                            item.name
                                          }
                                          loading="lazy"
                                          className="h-full w-full object-cover"
                                        />
                                      ) : (
                                        <div className="flex h-full w-full items-center justify-center">
                                          <Store
                                            size={25}
                                            className="text-[var(--text-muted)]"
                                          />
                                        </div>
                                      )}
                                    </div>

                                    {/* INFO */}

                                    <div className="min-w-0 flex-1">
                                      <div className="flex items-start justify-between gap-2">
                                        <h3 className="line-clamp-2 text-sm font-bold leading-5 sm:text-base">
                                          {
                                            item.name
                                          }
                                        </h3>

                                        <button
                                          type="button"
                                          aria-label={`Remove ${item.name}`}
                                          onClick={() => {
                                            removeItem(
                                              item.name,
                                              item.stall_id
                                            );

                                            toast.success(
                                              `${item.name} removed`
                                            );
                                          }}
                                          className="shrink-0 rounded-lg p-1.5 text-[var(--text-muted)] transition hover:bg-red-500/10 hover:text-red-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
                                        >
                                          <Trash2
                                            size={
                                              17
                                            }
                                          />
                                        </button>
                                      </div>

                                      <p className="mt-1 text-xs text-[var(--text-muted)]">
                                        ₹
                                        {Number(
                                          item.price
                                        ).toFixed(
                                          0
                                        )}{" "}
                                        each
                                      </p>

                                      <div className="mt-1 flex items-center justify-between gap-3">
                                        <p
                                          className={`text-base font-bold ${
                                            isPrimary
                                              ? "text-[var(--brand)]"
                                              : "text-emerald-500"
                                          }`}
                                        >
                                          ₹
                                          {itemTotal.toFixed(
                                            0
                                          )}
                                        </p>

                                        {/* QUANTITY */}

                                        <div className="flex h-9 items-center overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface-secondary)]">
                                          <button
                                            type="button"
                                            aria-label={`Decrease ${item.name}`}
                                            onClick={() =>
                                              decreaseQuantity(
                                                item.name,
                                                item.stall_id
                                              )
                                            }
                                            className="flex h-full w-9 items-center justify-center text-[var(--text-secondary)] transition hover:bg-[var(--surface)] active:scale-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]"
                                          >
                                            <Minus
                                              size={
                                                15
                                              }
                                            />
                                          </button>

                                          <span className="flex h-full min-w-8 items-center justify-center border-x border-[var(--border)] text-sm font-semibold">
                                            {
                                              item.quantity
                                            }
                                          </span>

                                          <button
                                            type="button"
                                            aria-label={`Increase ${item.name}`}
                                            onClick={() =>
                                              increaseQuantity(
                                                item.name,
                                                item.stall_id
                                              )
                                            }
                                            className="flex h-full w-9 items-center justify-center bg-[var(--brand)] text-white transition hover:brightness-95 active:scale-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]"
                                          >
                                            <Plus
                                              size={
                                                16
                                              }
                                            />
                                          </button>
                                        </div>
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              );
                            }
                          )}
                        </div>

                        {/* STALL SUBTOTAL */}

                        <div className="border-t border-[var(--border)] bg-[var(--surface-secondary)] px-4 py-4 sm:px-5">
                          <div className="flex items-center justify-between">
                            <span className="text-sm font-semibold text-[var(--text-secondary)]">
                              Stall subtotal
                            </span>

                            <span
                              className={`text-lg font-bold ${
                                isPrimary
                                  ? "text-[var(--brand)]"
                                  : "text-emerald-500"
                              }`}
                            >
                              ₹
                              {subtotal.toFixed(
                                0
                              )}
                            </span>
                          </div>
                        </div>
                      </article>
                    );
                  }
                )}
              </div>

              {/* ADD MORE */}

              <button
                type="button"
                onClick={() =>
                  router.push("/")
                }
                className="group mt-4 flex w-full items-center justify-between rounded-2xl border border-dashed border-[var(--border)] bg-[var(--surface)] px-4 py-4 text-left transition hover:border-[var(--brand)]/50 hover:bg-[var(--surface-secondary)] active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]"
              >
                <div>
                  <p className="text-sm font-semibold">
                    Add more items
                  </p>

                  <p className="mt-1 text-xs text-[var(--text-muted)]">
                    Explore more food from CampusVita
                  </p>
                </div>

                <ChevronRight
                  size={19}
                  className="text-[var(--brand)] transition-transform group-hover:translate-x-0.5"
                />
              </button>
            </section>

            {/* ORDER SUMMARY */}

            <aside className="h-fit lg:sticky lg:top-24">
              <div className="cv-glass-card cv-glass-edge rounded-[24px] border border-[var(--glass-border)] p-5">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--brand)]">
                      Summary
                    </p>

                    <h2 className="mt-1 text-lg font-bold">
                      Order Summary
                    </h2>

                    <p className="mt-1 text-xs text-[var(--text-muted)]">
                      {totalQuantity}{" "}
                      {totalQuantity === 1
                        ? "item"
                        : "items"}
                    </p>
                  </div>

                  <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[var(--brand-soft)]">
                    <ShoppingCart
                      size={19}
                      className="text-[var(--brand)]"
                    />
                  </div>
                </div>

                <div className="mt-6 space-y-3">
                  {billLoading ? (
                    <div className="flex justify-center py-8">
                      <Loader2
                        size={23}
                        className="animate-spin text-[var(--brand)]"
                      />
                    </div>
                  ) : bill ? (
                    <>
                      <SummaryRow
                        label="Item Total"
                        value={
                          bill.subtotal
                        }
                      />

                      <SummaryRow
                        label="Delivery Fee"
                        value={
                          bill.delivery_fee
                        }
                      />

                      {bill.tax_amount >
                        0 && (
                        <SummaryRow
                          label="Taxes & Charges"
                          value={
                            bill.tax_amount
                          }
                        />
                      )}

                      {bill.discount >
                        0 && (
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-[var(--text-muted)]">
                            Discount
                          </span>

                          <span className="font-semibold text-emerald-500">
                            -₹
                            {bill.discount.toFixed(
                              0
                            )}
                          </span>
                        </div>
                      )}

                      <div className="my-4 border-t border-dashed border-[var(--border)]" />

                      <div className="flex items-center justify-between">
                        <span className="text-base font-bold">
                          Total Amount
                        </span>

                        <span className="text-2xl font-bold text-[var(--brand)]">
                          ₹
                          {bill.total.toFixed(
                            0
                          )}
                        </span>
                      </div>

                      <div className="mt-4 flex items-center justify-center gap-2 rounded-xl bg-[var(--surface-secondary)] px-3 py-2.5">
                        <LockKeyhole
                          size={12}
                          className="text-[var(--text-muted)]"
                        />

                        <span className="text-[10px] font-medium text-[var(--text-muted)]">
                          Secure CampusVita checkout
                        </span>
                      </div>
                    </>
                  ) : (
                    <div className="rounded-xl border border-red-500/20 bg-red-500/5 px-4 py-4 text-center text-xs text-red-500">
                      Unable to calculate order total.
                    </div>
                  )}
                </div>
              </div>

              {/* DESKTOP PAYMENT METHOD */}

              <button
                type="button"
                onClick={() =>
                  setPaymentSheetOpen(
                    true
                  )
                }
                disabled={
                  loading ||
                  billLoading ||
                  !bill
                }
                className="mt-4 hidden w-full items-center justify-between rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-5 py-4 text-left transition hover:border-[var(--brand)]/40 hover:bg-[var(--surface-secondary)] disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)] lg:flex"
              >
                <div>
                  <p className="text-[10px] font-bold tracking-widest text-[var(--text-muted)]">
                    PAYMENT METHOD
                  </p>

                  <div className="mt-1 flex items-center gap-2">
                    {paymentMethod ===
                    "WALLET" ? (
                      <Wallet
                        size={16}
                        className="text-[var(--brand)]"
                      />
                    ) : (
                      <CreditCard
                        size={16}
                        className="text-[var(--brand)]"
                      />
                    )}

                    <span className="text-sm font-semibold">
                      {paymentLabel}
                    </span>
                  </div>
                </div>

                <ChevronRight
                  size={18}
                  className="text-[var(--text-muted)]"
                />
              </button>

              <button
                type="button"
                onClick={
                  handlePlaceOrder
                }
                disabled={
                  loading ||
                  billLoading ||
                  !bill ||
                  profileLoading ||
                  (paymentMethod ===
                    "WALLET" &&
                    !walletCanPay)
                }
                className="mt-3 hidden min-h-14 w-full items-center justify-center gap-2 rounded-2xl bg-[var(--accent)] px-5 text-sm font-bold text-[var(--on-accent)] shadow-[var(--accent-shadow)] transition hover:bg-[var(--accent-hover)] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--background)] lg:flex"
              >
                {loading ? (
                  <>
                    <Loader2
                      size={17}
                      className="animate-spin"
                    />
                    Processing...
                  </>
                ) : (
                  <>
                    Place Order ₹
                    {total.toFixed(
                      0
                    )}
                    <ArrowRight
                      size={17}
                    />
                  </>
                )}
              </button>
            </aside>
          </div>
        </div>
      </main>

      {/* MOBILE CHECKOUT BAR */}

      <div className="fixed inset-x-0 bottom-16 z-[60] border-t border-[var(--border)] bg-[var(--navbar)]/95 px-3 py-2.5 backdrop-blur-xl lg:hidden">
        <div className="mx-auto flex max-w-6xl items-center gap-3">
          <button
            type="button"
            onClick={() =>
              setPaymentSheetOpen(
                true
              )
            }
            disabled={
              loading ||
              billLoading ||
              !bill
            }
            className="min-w-0 flex-1 text-left disabled:opacity-50 focus-visible:outline-none"
          >
            <p className="text-[9px] font-bold tracking-widest text-[var(--text-muted)]">
              CHANGE METHOD
              <span className="ml-1 text-[var(--brand)]">
                →
              </span>
            </p>

            <div className="mt-1 flex items-center gap-1.5">
              {paymentMethod ===
              "WALLET" ? (
                <Wallet
                  size={15}
                  className="text-[var(--brand)]"
                />
              ) : (
                <CreditCard
                  size={15}
                  className="text-[var(--brand)]"
                />
              )}

              <span className="truncate text-xs font-semibold">
                {paymentLabel}
              </span>
            </div>
          </button>

          <button
            type="button"
            onClick={
              handlePlaceOrder
            }
            disabled={
              loading ||
              billLoading ||
              !bill ||
              profileLoading ||
              (paymentMethod ===
                "WALLET" &&
                !walletCanPay)
            }
            className="flex min-h-12 flex-[1.45] items-center justify-center gap-1.5 rounded-xl bg-[var(--accent)] px-3 text-xs font-bold text-[var(--on-accent)] shadow-[var(--accent-shadow)] transition hover:bg-[var(--accent-hover)] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--background)] sm:text-sm"
          >
            {loading ? (
              <>
                <Loader2
                  size={15}
                  className="animate-spin"
                />
                Processing...
              </>
            ) : (
              <>
                Place Order ₹
                {total.toFixed(
                  0
                )}
                <ArrowRight
                  size={16}
                />
              </>
            )}
          </button>
        </div>
      </div>

      {/* PAYMENT SHEET */}

      {paymentSheetOpen && (
        <div
          className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-sm"
          onClick={() =>
            setPaymentSheetOpen(
              false
            )
          }
        >
          <div
            className="cv-glass-modal cv-glass-edge absolute inset-x-0 bottom-0 max-h-[90vh] overflow-y-auto rounded-t-[28px] border border-[var(--glass-border)] p-5 sm:mx-auto sm:bottom-4 sm:max-w-xl sm:rounded-[28px]"
            style={{
              paddingBottom:
                "calc(1.25rem + env(safe-area-inset-bottom))",
            }}
            onClick={(event) =>
              event.stopPropagation()
            }
          >
            <div className="mx-auto mb-5 h-1 w-11 rounded-full bg-[var(--border)]" />

            <div className="flex items-center justify-between">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--brand)]">
                  Secure checkout
                </p>

                <h2 className="mt-1 text-xl font-bold">
                  Choose Payment Method
                </h2>

                <p className="mt-1 text-xs text-[var(--text-muted)]">
                  Select how you want to pay.
                </p>
              </div>

              <button
                type="button"
                onClick={() =>
                  setPaymentSheetOpen(
                    false
                  )
                }
                aria-label="Close payment method"
                className="flex h-10 w-10 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--surface-secondary)] text-[var(--text-secondary)] transition hover:bg-[var(--surface)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]"
              >
                <X
                  size={18}
                />
              </button>
            </div>

            {/* WALLET */}

            <button
              type="button"
              onClick={() =>
                selectPaymentMethod(
                  "WALLET"
                )
              }
              disabled={
                !walletCanPay ||
                loading ||
                billLoading
              }
              className={`mt-6 flex w-full items-center gap-3 rounded-2xl border p-4 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)] ${
                paymentMethod ===
                "WALLET"
                  ? "border-[var(--brand)] bg-[var(--brand-soft)]"
                  : "border-[var(--border)] bg-[var(--surface-secondary)] hover:bg-[var(--surface)]"
              } ${
                !walletCanPay
                  ? "cursor-not-allowed opacity-60"
                  : ""
              }`}
            >
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[var(--brand-soft)]">
                <Wallet
                  size={21}
                  className="text-[var(--brand)]"
                />
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-semibold">
                    CampusVita Wallet
                  </p>

                  {walletCanPay && (
                    <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[9px] font-semibold text-emerald-500">
                      Available
                    </span>
                  )}
                </div>

                <p className="mt-1 text-xs text-[var(--text-muted)]">
                  Available Balance: ₹
                  {walletBalance.toFixed(
                    2
                  )}
                </p>

                {!walletCanPay && (
                  <p className="mt-1 text-[10px] text-red-500">
                    Need ₹
                    {total.toFixed(
                      0
                    )}{" "}
                    • Available ₹
                    {walletBalance.toFixed(
                      0
                    )}
                  </p>
                )}
              </div>

              <Radio
                active={
                  paymentMethod ===
                  "WALLET"
                }
              />
            </button>

            {/* ONLINE */}

            <button
              type="button"
              onClick={() =>
                selectPaymentMethod(
                  "ONLINE"
                )
              }
              disabled={
                loading ||
                billLoading
              }
              className={`mt-3 flex w-full items-center gap-3 rounded-2xl border p-4 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)] ${
                paymentMethod ===
                "ONLINE"
                  ? "border-[var(--brand)] bg-[var(--brand-soft)]"
                  : "border-[var(--border)] bg-[var(--surface-secondary)] hover:bg-[var(--surface)]"
              }`}
            >
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[var(--brand-soft)]">
                <CreditCard
                  size={21}
                  className="text-[var(--brand)]"
                />
              </div>

              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">
                  Online Payment
                </p>

                <p className="mt-1 text-xs text-[var(--text-muted)]">
                  UPI, Cards, Net Banking & more
                </p>

                <p className="mt-1 text-[10px] text-[var(--text-muted)]">
                  Secure checkout powered by Razorpay
                </p>
              </div>

              <Radio
                active={
                  paymentMethod ===
                  "ONLINE"
                }
              />
            </button>

            {/* PAYABLE */}

            <div className="mt-5 rounded-2xl border border-[var(--border)] bg-[var(--surface-secondary)] p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                    Payable Amount
                  </p>

                  <p className="mt-1 text-sm font-semibold">
                    {paymentLabel}
                  </p>
                </div>

                <p className="text-2xl font-bold text-[var(--brand)]">
                  ₹
                  {total.toFixed(
                    0
                  )}
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={() =>
                setPaymentSheetOpen(
                  false
                )
              }
              disabled={
                loading ||
                billLoading ||
                !bill ||
                (paymentMethod ===
                  "WALLET" &&
                  !walletCanPay)
              }
              className="mt-4 flex min-h-13 w-full items-center justify-center gap-2 rounded-2xl bg-[var(--accent)] px-4 text-sm font-bold text-[var(--on-accent)] shadow-[var(--accent-shadow)] transition hover:bg-[var(--accent-hover)] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface)]"
            >
              Continue with{" "}
              {paymentMethod ===
              "WALLET"
                ? "Wallet"
                : "Online Payment"}

              <ArrowRight
                size={17}
              />
            </button>

            <div className="mt-3 flex items-center justify-center gap-1.5">
              <LockKeyhole
                size={12}
                className="text-[var(--text-muted)]"
              />

              <span className="text-[10px] text-[var(--text-muted)]">
                Secure payment • CampusVita
              </span>
            </div>
          </div>
        </div>
      )}

      <MobileBottomNav />
    </>
  );
}

/*
 * ============================================================
 * SUMMARY ROW
 * ============================================================
 */

function SummaryRow({
  label,
  value,
}: {
  label: string;
  value: number;
}) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-[var(--text-muted)]">
        {label}
      </span>

      <span className="font-semibold text-[var(--text-secondary)]">
        ₹
        {Number(value).toFixed(
          0
        )}
      </span>
    </div>
  );
}

/*
 * ============================================================
 * PAYMENT RADIO
 * ============================================================
 */

function Radio({
  active,
}: {
  active: boolean;
}) {
  return (
    <div
      aria-hidden="true"
      className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 ${
        active
          ? "border-[var(--brand)]"
          : "border-[var(--text-muted)]"
      }`}
    >
      {active && (
        <div className="h-2.5 w-2.5 rounded-full bg-[var(--brand)]" />
      )}
    </div>
  );
}

/*
 * ============================================================
 * MOBILE BOTTOM NAVIGATION
 * ============================================================
 */

function MobileBottomNav() {
  const router =
    useRouter();

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-[70] border-t border-[var(--border)] bg-[var(--navbar)]/95 backdrop-blur-xl lg:hidden">
      <div
        className="mx-auto grid h-[68px] max-w-md grid-cols-4"
        style={{
          paddingBottom:
            "env(safe-area-inset-bottom)",
        }}
      >
        <BottomNavItem
          label="Home"
          icon={
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              className="h-5 w-5"
            >
              <path d="m3 10 9-7 9 7" />
              <path d="M5 9v11h14V9" />
              <path d="M9 20v-6h6v6" />
            </svg>
          }
          onClick={() =>
            router.push("/")
          }
        />

        <BottomNavItem
          label="Orders"
          icon={
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              className="h-5 w-5"
            >
              <rect
                x="5"
                y="3"
                width="14"
                height="18"
                rx="2"
              />
              <path d="M8 7h8M8 11h8M8 15h5" />
            </svg>
          }
          onClick={() =>
            router.push(
              "/orders"
            )
          }
        />

        <BottomNavItem
          label="Cart"
          active
          icon={
            <ShoppingCart
              size={21}
              strokeWidth={2}
            />
          }
          onClick={() => {}}
        />

        <BottomNavItem
          label="Profile"
          icon={
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              className="h-5 w-5"
            >
              <circle
                cx="12"
                cy="8"
                r="3.5"
              />
              <path d="M5 21c.8-4 3.1-6 7-6s6.2 2 7 6" />
            </svg>
          }
          onClick={() =>
            router.push(
              "/profile"
            )
          }
        />
      </div>
    </nav>
  );
}

/*
 * ============================================================
 * BOTTOM NAV ITEM
 * ============================================================
 */

function BottomNavItem({
  label,
  icon,
  active = false,
  onClick,
}: {
  label: string;
  icon: React.ReactNode;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex flex-col items-center justify-center gap-1 text-[11px] transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--brand)] ${
        active
          ? "text-[var(--brand)]"
          : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
      }`}
    >
      {icon}

      <span
        className={
          active
            ? "font-semibold"
            : ""
        }
      >
        {label}
      </span>
    </button>
  );
}
