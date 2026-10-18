"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Home,
  ShoppingBag,
  Store,
} from "lucide-react";
import toast from "react-hot-toast";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { DownloadButton } from "@/components/ui/download-animation";
import { getImageUrl } from "@/app/lib/getImageUrl";

const API_URL =
  process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000";

/* ============================================================
   TYPES
============================================================ */

interface OrderItem {
  name: string;
  price: number;
  quantity: number;
  image?: string;
  stall_id?: string;
}

interface InvoiceOrder {
  token?: number | string;
  payment_id?: string;
  razorpay_order_id?: string;
  payment_method?: string;
  payment_status?: string;
  date?: string;
  estimated_time?: string;
  pickup_code?: number | string;
  total?: number;
  email?: string;
  name?: string;
  phone?: string;
  location?: string;
  items?: OrderItem[];
}

interface Stall {
  _id?: string;
  id?: string;
  name?: string;
  image?: string;
  is_open?: boolean;
}

interface StallGroup {
  stallId: string;
  stallName: string;
  stallImage?: string;
  items: OrderItem[];
  subtotal: number;
}

/* ============================================================
   HELPERS
============================================================ */

function formatOrderDate(rawDate?: string): string {
  if (!rawDate) return "Not Available";

  const parsed = new Date(rawDate);

  if (Number.isNaN(parsed.getTime())) {
    return rawDate;
  }

  return parsed.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
}

function formatCurrency(amount: number): string {
  return `₹${Number(amount || 0).toFixed(2)}`;
}

function getPaymentLabel(method?: string): string {
  if (!method) return "Paid Online";

  const normalized = method.trim().toLowerCase();

  if (
    normalized === "online" ||
    normalized === "razorpay" ||
    normalized === "razorpay online"
  ) {
    return "Paid Online";
  }

  return method;
}

/* ============================================================
   INVOICE PDF
   Existing invoice functionality preserved.
============================================================ */

function generateInvoicePDF(order: InvoiceOrder) {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const marginX = 40;

  const invoiceNo = `INV-${new Date()
    .toISOString()
    .slice(0, 10)
    .replace(/-/g, "")}-${order.token ?? "N/A"}`;

  // HEADER
  doc.setFont("helvetica", "bold");
  doc.setFontSize(20);
  doc.setTextColor(101, 66, 207);
  doc.text("CampusVita", marginX, 50);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(100);
  doc.text("Smart Campus Food Ordering", marginX, 66);
  doc.text("Email: support@campusvita.com", marginX, 80);
  doc.text(`Phone: ${order.phone || "N/A"}`, marginX, 94);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.setTextColor(20);
  doc.text("INVOICE", pageWidth - marginX, 50, {
    align: "right",
  });

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(100);

  doc.text(`Invoice No: ${invoiceNo}`, pageWidth - marginX, 66, {
    align: "right",
  });

  doc.text(
    `Order Token: #${order.token ?? "N/A"}`,
    pageWidth - marginX,
    80,
    { align: "right" }
  );

  doc.text(
    `Date: ${formatOrderDate(order.date)}`,
    pageWidth - marginX,
    94,
    { align: "right" }
  );

  doc.setDrawColor(230);
  doc.line(marginX, 110, pageWidth - marginX, 110);

  // CUSTOMER AND PAYMENT DETAILS
  let y = 134;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(20);
  doc.text("Billed To", marginX, y);
  doc.text("Payment Details", marginX + 280, y);

  y += 16;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(80);

  const billedToLines = [
    order.name || "N/A",
    order.phone || "N/A",
    order.location || "N/A",
    order.email || "N/A",
  ];

  const paymentLines = [
    `Payment ID: ${order.payment_id ?? "Not Available"}`,
    `Razorpay Order ID: ${order.razorpay_order_id ?? "Not Available"}`,
    `Method: ${order.payment_method ?? "ONLINE"}`,
    `Status: ${order.payment_status ?? "Paid"}`,
  ];

  const lineHeight = 14;

  billedToLines.forEach((line, index) => {
    doc.text(line, marginX, y + index * lineHeight);
  });

  paymentLines.forEach((line, index) => {
    doc.text(line, marginX + 280, y + index * lineHeight);
  });

  y += billedToLines.length * lineHeight + 20;

  // ITEMS TABLE
  const rows =
    order.items && order.items.length > 0
      ? order.items.map((item) => {
          const price = Number(item.price) || 0;
          const quantity = Number(item.quantity) || 0;

          return [
            item.name,
            String(quantity),
            `Rs. ${price.toFixed(2)}`,
            `Rs. ${(price * quantity).toFixed(2)}`,
          ];
        })
      : [["No items found", "-", "-", "-"]];

  autoTable(doc, {
    startY: y,
    head: [["Item", "Qty", "Unit Price", "Amount"]],
    body: rows,
    theme: "grid",
    headStyles: {
      fillColor: [101, 66, 207],
      textColor: 255,
      fontStyle: "bold",
    },
    styles: {
      fontSize: 10,
      cellPadding: 6,
    },
    columnStyles: {
      1: { halign: "center" },
      2: { halign: "right" },
      3: { halign: "right" },
    },
    margin: {
      left: marginX,
      right: marginX,
    },
  });

  // TOTAL
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const finalY = (doc as any).lastAutoTable.finalY + 20;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.setTextColor(20);

  doc.text(
    `Total Paid: Rs. ${Number(order.total ?? 0).toFixed(2)}`,
    pageWidth - marginX,
    finalY,
    { align: "right" }
  );

  // PICKUP INFORMATION
  const pickupY = finalY + 34;

  doc.setDrawColor(101, 66, 207);
  doc.setFillColor(248, 243, 255);

  doc.roundedRect(
    marginX,
    pickupY - 16,
    pageWidth - marginX * 2,
    46,
    6,
    6,
    "FD"
  );

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(75, 48, 125);

  doc.text(
    `Pickup Code: ${order.pickup_code || "Generating..."}`,
    marginX + 14,
    pickupY + 6
  );

  doc.text(
    `Estimated Time: ${order.estimated_time ?? "Not Available"}`,
    marginX + 14,
    pickupY + 22
  );

  // FOOTER
  const footerY = pickupY + 70;

  doc.setFont("helvetica", "italic");
  doc.setFontSize(9);
  doc.setTextColor(140);

  doc.text(
    "Thank you for ordering with CampusVita!",
    pageWidth / 2,
    footerY,
    { align: "center" }
  );

  const today = new Date().toISOString().slice(0, 10);

  doc.save(
    `CampusVita-Invoice-${today}-${order.token ?? "order"}.pdf`
  );
}

/* ============================================================
   HEADER
============================================================ */

interface PaymentSuccessHeaderProps {
  onDownload: () => void;
  downloading: boolean;
}

function PaymentSuccessHeader({
  onDownload,
  downloading,
}: PaymentSuccessHeaderProps) {
  return (
    <header className="sticky top-0 z-40 border-b border-[var(--border)] bg-[var(--surface)]/95 backdrop-blur-xl">
      <div className="mx-auto flex h-[66px] w-full max-w-[1320px] items-center justify-between px-4 sm:px-7 lg:px-10">
        <a
          href="/"
          aria-label="CampusVita home"
          className="flex items-center gap-2.5"
        >
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--primary)] text-white shadow-sm">
            <ShoppingBag size={21} strokeWidth={2.2} />
          </span>

          <span className="text-[20px] font-extrabold tracking-[-0.8px] text-[var(--text-primary)] sm:text-[23px]">
            CampusVita
          </span>
        </a>

        <DownloadButton
  onDownload={onDownload}
  downloading={downloading}
/>
      </div>
    </header>
  );
}

/* ============================================================
   PAGE
============================================================ */

export default function PaymentSuccessPage() {
  const router = useRouter();

  const [order, setOrder] = useState<InvoiceOrder | null>(null);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const [stalls, setStalls] = useState<Stall[]>([]);

  const [expandedStalls, setExpandedStalls] = useState<
    Record<string, boolean>
  >({});

  const [showAllDetails, setShowAllDetails] = useState(true);

  /* ----------------------------------------------------------
     LOAD ORDER
  ---------------------------------------------------------- */

  useEffect(() => {
    let redirectTimer: ReturnType<typeof setTimeout> | undefined;

    const loadOrder = () => {
      const orderData = window.localStorage.getItem("latestOrder");

      if (!orderData) {
        toast.error("No order found");

        redirectTimer = setTimeout(() => {
          router.push("/");
        }, 1500);

        setLoading(false);
        return;
      }

      try {
        const parsedOrder = JSON.parse(orderData) as InvoiceOrder;
        setOrder(parsedOrder);
      } catch (error) {
        console.error("Error parsing order:", error);
        toast.error("Failed to load order details");
      }

      setLoading(false);
    };

    const loadTimer = setTimeout(loadOrder, 0);

    return () => {
      clearTimeout(loadTimer);

      if (redirectTimer) {
        clearTimeout(redirectTimer);
      }
    };
  }, [router]);

  /* ----------------------------------------------------------
     LOAD REAL STALL DATA
  ---------------------------------------------------------- */

  useEffect(() => {
    if (!order?.items?.length) {
      return;
    }

    let cancelled = false;

    const loadStalls = async () => {
      try {
        const response = await fetch(`${API_URL}/stalls`);

        if (!response.ok) {
          return;
        }

        const data: unknown = await response.json();

        const stallList =
          Array.isArray(data)
            ? data
            : typeof data === "object" &&
                data !== null &&
                "stalls" in data
              ? (data as { stalls?: unknown }).stalls
              : undefined;

        if (!cancelled && Array.isArray(stallList)) {
          setStalls(stallList as Stall[]);
        }
      } catch (error) {
        if (!cancelled) {
          console.error("Failed to load stalls:", error);
        }
      }
    };

    void loadStalls();

    return () => {
      cancelled = true;
    };
  }, [order]);

  /* ----------------------------------------------------------
     GROUP ITEMS BY STALL
  ---------------------------------------------------------- */

  const stallGroups = useMemo<StallGroup[]>(() => {
    if (!order?.items?.length) {
      return [];
    }

    const groups = new Map<string, StallGroup>();

    order.items.forEach((item) => {
      const stallId = String(item.stall_id || "unknown");

      const stall = stalls.find(
        (currentStall) =>
          String(currentStall._id || currentStall.id || "") === stallId
      );

      const existing = groups.get(stallId);

      const itemSubtotal =
        Number(item.price || 0) * Number(item.quantity || 0);

      if (existing) {
        existing.items.push(item);
        existing.subtotal += itemSubtotal;
        return;
      }

      groups.set(stallId, {
        stallId,
        stallName: stall?.name || `Stall ${stallId}`,
        stallImage: stall?.image,
        items: [item],
        subtotal: itemSubtotal,
      });
    });

    return Array.from(groups.values());
  }, [order, stalls]);

  /* ----------------------------------------------------------
     ACTIONS
  ---------------------------------------------------------- */

  const handleDownloadInvoice = () => {
    if (!order) {
      toast.error("No order found");
      return;
    }

    setDownloading(true);

    try {
      generateInvoicePDF(order);
      toast.success("Invoice downloaded successfully!");
    } catch (error) {
      console.error("Invoice generation error:", error);
      toast.error("Failed to generate invoice");
    } finally {
      setDownloading(false);
    }
  };

  const handleTrackOrder = () => {
    router.push("/track-order");
  };

  const handleBackToHome = () => {
    router.push("/");
  };

  const toggleStall = (stallId: string) => {
    setExpandedStalls((previous) => ({
      ...previous,
      [stallId]: !(previous[stallId] ?? true),
    }));
  };

  /* ----------------------------------------------------------
     LOADING STATE
  ---------------------------------------------------------- */

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[var(--background)] px-5 text-[var(--text-primary)]">
        <div className="text-center">
          <div className="mx-auto flex h-16 w-16 animate-[float_2s_ease-in-out_infinite] items-center justify-center rounded-2xl bg-[var(--primary)] text-white shadow-lg shadow-[#6542cf]/20">
            <ShoppingBag size={31} />
          </div>

          <div className="mx-auto mt-5 h-7 w-7 animate-spin rounded-full border-2 border-[var(--border-strong)] border-t-[#6542cf]" />

          <p className="mt-3 text-sm text-[var(--text-muted)]">
            Loading order confirmation...
          </p>
        </div>

        <style jsx global>{`
          @keyframes float {
            0%,
            100% {
              transform: translateY(0);
            }
            50% {
              transform: translateY(-8px);
            }
          }
        `}</style>
      </main>
    );
  }

  /* ----------------------------------------------------------
     NO ORDER STATE
  ---------------------------------------------------------- */

  if (!order) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[var(--background)] px-6 text-[var(--text-primary)]">
        <div className="w-full max-w-sm rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-8 text-center shadow-lg">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-[var(--primary-soft)] text-[var(--primary)]">
            <ShoppingBag size={30} />
          </div>

          <h1 className="mt-5 text-xl font-extrabold">
            No order found
          </h1>

          <p className="mt-2 text-sm leading-6 text-[var(--text-muted)]">
            We couldn&apos;t find your recent order details.
          </p>

          <button
            type="button"
            onClick={handleBackToHome}
            className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--primary)] px-5 py-3 text-sm font-bold text-white transition hover:bg-[var(--primary-hover)]"
          >
            <Home size={17} />
            Go to Home
          </button>
        </div>
      </main>
    );
  }

  /* ----------------------------------------------------------
     ORDER TOTALS
  ---------------------------------------------------------- */

  const total = Number(order.total ?? 0);

  const totalItems =
    order.items?.reduce(
      (sum, item) => sum + Number(item.quantity || 0),
      0
    ) ?? 0;

  const itemTotal =
    order.items?.reduce(
      (sum, item) =>
        sum +
        Number(item.price || 0) * Number(item.quantity || 0),
      0
    ) ?? 0;

  const paymentStatus =
    order.payment_status?.toLowerCase() === "failed"
      ? "Failed"
      : "Paid";

  /* ----------------------------------------------------------
     MAIN UI
  ---------------------------------------------------------- */

  return (
    <>
      <PaymentSuccessHeader
        onDownload={handleDownloadInvoice}
        downloading={downloading}
      />

      <main className="min-h-screen overflow-hidden bg-[var(--background)] px-3 pb-8 pt-4 text-[var(--text-primary)] sm:px-5 sm:pt-6 lg:px-8">
        <div className="mx-auto w-full max-w-[1320px]">
          <section className="overflow-hidden rounded-[24px] border border-[var(--border)] bg-[var(--surface)] shadow-[0_10px_35px_rgba(56,39,20,0.06)] sm:rounded-[30px]">
            {/* SUCCESS HERO */}
            <div className="grid items-center gap-3 border-b border-[var(--border)] px-4 py-6 sm:px-7 sm:py-8 lg:grid-cols-[0.9fr_1.1fr] lg:gap-5 lg:px-10 lg:py-8">
              {/* Animated shopping bag illustration */}
              <div className="relative mx-auto flex h-[205px] w-full max-w-[320px] items-center justify-center sm:h-[245px] lg:h-[270px]">
                <div className="absolute bottom-[20px] h-7 w-[78%] rounded-[50%] bg-[#e7d8bf]/60 blur-md" />

                <div className="absolute left-[10%] top-[18%] h-3 w-3 rotate-45 animate-bounce rounded-[3px] bg-[#ffb83f]" />

                <div className="absolute right-[17%] top-[12%] h-3 w-3 rotate-45 animate-pulse rounded-[3px] bg-[#6ecb8d]" />

                <div className="absolute left-[19%] top-[45%] h-2.5 w-2.5 rotate-45 animate-pulse rounded-[2px] bg-[#8d7bd5]" />

                <div className="absolute right-[11%] top-[56%] h-2 w-2 rotate-45 animate-bounce rounded-[2px] bg-[#f6b54b]" />

                {/* Bag */}
                <div className="relative z-10 flex h-[155px] w-[148px] animate-[float_3s_ease-in-out_infinite] items-center justify-center rounded-[28px_28px_36px_36px] bg-gradient-to-br from-[#8559f4] via-[#6439d0] to-[#40219a] shadow-[0_18px_25px_rgba(82,45,167,0.28)] sm:h-[180px] sm:w-[170px]">
                  {/* Bag handle */}
                  <div className="absolute -top-[31px] left-1/2 h-[48px] w-[64px] -translate-x-1/2 rounded-t-[35px] border-[7px] border-b-0 border-[#c99a6b]" />

                  <div className="absolute inset-x-3 top-0 h-3 rounded-full bg-[var(--surface)]/10" />

                  <div className="flex flex-col items-center text-white">
                    <ShoppingBag
                      size={43}
                      strokeWidth={1.7}
                      className="mb-2 drop-shadow-sm"
                    />

                    <span className="text-[15px] font-extrabold tracking-[-0.5px]">
                      CampusVita
                    </span>
                  </div>

                  <div className="absolute bottom-0 left-0 h-[80%] w-[12px] rounded-bl-[30px] bg-black/10" />
                </div>

                {/* Green success badge */}
                <div className="absolute right-[7%] top-[28%] z-20 flex h-[68px] w-[68px] animate-[success-pop_500ms_cubic-bezier(.17,.67,.35,1.4)_both] items-center justify-center rounded-full border-[5px] border-[var(--surface)] bg-[#16b967] text-white shadow-[0_7px_20px_rgba(22,185,103,0.25)] sm:right-[9%] sm:h-[80px] sm:w-[80px]">
                  <Check size={45} strokeWidth={4} />
                </div>
              </div>

              {/* Confirmation text and details */}
              <div className="min-w-0 py-1 lg:pl-2">
                <div className="mb-2 inline-flex items-center gap-2 rounded-full bg-[var(--success-soft)] px-3 py-1 text-[11px] font-bold uppercase tracking-[1.3px] text-[var(--success)]">
                  <span className="h-2 w-2 animate-pulse rounded-full bg-[var(--success)]" />
                  Payment successful
                </div>

                <h1 className="text-[27px] font-extrabold leading-tight tracking-[-1.1px] text-[var(--text-primary)] sm:text-[34px] lg:text-[36px]">
                  Order Placed Successfully!
                </h1>

                <p className="mt-3 text-[13px] leading-6 text-[var(--text-secondary)] sm:text-[14px]">
                  Yay! Your food is getting ready.
                  <br />
                  You&apos;ll receive updates shortly on your order status.
                </p>

                <div className="mt-5 grid grid-cols-1 gap-2 sm:grid-cols-3">
                  {/* Order ID */}
                  <div className="min-w-0 rounded-xl border border-[var(--border)] bg-[var(--card)] p-3">
                    <p className="text-[10px] font-medium text-[var(--text-muted)] sm:text-[11px]">
                      Order ID
                    </p>

                    <p className="mt-1 break-words text-[12px] font-extrabold text-[var(--text-primary)]">
                      #{order.token ?? "N/A"}
                    </p>
                  </div>

                  {/* Date and time */}
                  <div className="min-w-0 rounded-xl border border-[var(--border)] bg-[var(--card)] p-3">
                    <p className="text-[10px] font-medium text-[var(--text-muted)] sm:text-[11px]">
                      Date &amp; Time
                    </p>

                    <p className="mt-1 text-[11px] font-bold leading-4 text-[var(--text-primary)] sm:text-[12px]">
                      {formatOrderDate(order.date)}
                    </p>
                  </div>

                  {/* Payment status */}
                  <div className="min-w-0 rounded-xl border border-[var(--border)] bg-[var(--card)] p-3">
                    <p className="text-[10px] font-medium text-[var(--text-muted)] sm:text-[11px]">
                      Payment
                    </p>

                    <div className="mt-1 flex flex-wrap items-center justify-between gap-1">
                      <span className="text-[11px] font-bold text-[var(--text-primary)]">
                        {getPaymentLabel(order.payment_method)}
                      </span>

                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                          paymentStatus === "Paid"
                            ? "bg-[var(--success-soft)] text-[var(--success)]"
                            : "bg-[var(--danger-soft)] text-[var(--danger)]"
                        }`}
                      >
                        {paymentStatus}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* ORDER SUMMARY AND BILL */}
            <section className="px-3 py-4 sm:px-6 sm:py-6 lg:px-8">
              <div className="rounded-[18px] border border-[var(--border)] bg-[var(--surface)] p-3 sm:p-5">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <div>
                    <h2 className="text-[16px] font-extrabold tracking-[-0.3px] text-[var(--text-primary)] sm:text-[18px]">
                      Order Summary
                    </h2>

                    <p className="mt-1 text-[11px] text-[var(--text-muted)] sm:text-xs">
                      {totalItems} {totalItems === 1 ? "item" : "items"} from{" "}
                      {stallGroups.length}{" "}
                      {stallGroups.length === 1 ? "stall" : "stalls"}
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={() => setShowAllDetails((value) => !value)}
                    className="shrink-0 rounded-lg px-2 py-2 text-[11px] font-bold text-[var(--primary)] transition hover:bg-[var(--primary-soft)] sm:text-xs"
                  >
                    {showAllDetails ? "Hide Details" : "View Details"}
                  </button>
                </div>

                <div className="space-y-2.5">
                  {stallGroups.length > 0 ? (
                    stallGroups.map((group) => {
                      const groupItemCount = group.items.reduce(
                        (sum, item) =>
                          sum + Number(item.quantity || 0),
                        0
                      );

                      const isExpanded =
                        expandedStalls[group.stallId] ?? true;

                      return (
                        <div
                          key={group.stallId}
                          className="overflow-hidden rounded-[14px] border border-[var(--border)] bg-[var(--surface)]"
                        >
                          <button
                            type="button"
                            onClick={() => toggleStall(group.stallId)}
                            aria-expanded={isExpanded}
                            className="flex w-full items-center justify-between gap-3 px-3 py-3 text-left transition hover:bg-[var(--card-hover)] sm:px-4"
                          >
                            <div className="flex min-w-0 items-center gap-3">
                              <div className="flex h-[38px] w-[38px] shrink-0 items-center justify-center overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface-secondary)]">
                                {group.stallImage ? (
                                  <Image
                                    src={getImageUrl(group.stallImage)}
                                    alt={group.stallName}
                                    width={38}
                                    height={38}
                                    unoptimized
                                    className="h-full w-full object-cover"
                                  />
                                ) : (
                                  <Store
                                    size={19}
                                    className="text-[var(--primary)]"
                                  />
                                )}
                              </div>

                              <div className="min-w-0">
                                <p className="truncate text-[12px] font-extrabold text-[var(--text-primary)] sm:text-[13px]">
                                  {group.stallName}
                                </p>

                                <p className="mt-0.5 text-[10px] text-[var(--text-muted)] sm:text-[11px]">
                                  {groupItemCount}{" "}
                                  {groupItemCount === 1 ? "item" : "items"}
                                </p>
                              </div>
                            </div>

                            <div className="flex shrink-0 items-center gap-2">
                              <span className="text-[12px] font-extrabold text-[var(--text-primary)] sm:text-[13px]">
                                {formatCurrency(group.subtotal)}
                              </span>

                              {isExpanded ? (
                                <ChevronUp
                                  size={16}
                                  className="text-[var(--text-muted)]"
                                />
                              ) : (
                                <ChevronDown
                                  size={16}
                                  className="text-[var(--text-muted)]"
                                />
                              )}
                            </div>
                          </button>

                          {showAllDetails && isExpanded && (
                            <div className="border-t border-[var(--border)] px-3 py-1 sm:px-4">
                              {group.items.map((item, index) => (
                                <div
                                  key={`${group.stallId}-${item.name}-${index}`}
                                  className="flex items-center gap-3 border-b border-[var(--border)] py-3 last:border-b-0"
                                >
                                  <div className="h-[48px] w-[48px] shrink-0 overflow-hidden rounded-[10px] bg-[var(--surface-secondary)] sm:h-[54px] sm:w-[54px]">
                                    {item.image ? (
                                      <Image
                                        src={getImageUrl(item.image)}
                                        alt={item.name}
                                        width={54}
                                        height={54}
                                        unoptimized
                                        className="h-full w-full object-cover"
                                      />
                                    ) : (
                                      <div className="flex h-full w-full items-center justify-center text-[var(--text-muted)]">
                                        <ShoppingBag size={19} />
                                      </div>
                                    )}
                                  </div>

                                  <div className="min-w-0 flex-1">
                                    <p className="line-clamp-2 text-[12px] font-bold leading-5 text-[var(--text-primary)] sm:text-[13px]">
                                      {item.name}
                                    </p>

                                    <p className="mt-0.5 text-[10px] text-[var(--text-muted)] sm:text-[11px]">
                                      {formatCurrency(
                                        Number(item.price || 0)
                                      )}{" "}
                                      × {Number(item.quantity || 0)}
                                    </p>
                                  </div>

                                  <p className="shrink-0 text-[12px] font-bold text-[var(--text-primary)] sm:text-[13px]">
                                    {formatCurrency(
                                      Number(item.price || 0) *
                                        Number(item.quantity || 0)
                                    )}
                                  </p>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })
                  ) : (
                    <div className="py-8 text-center text-sm text-[var(--text-muted)]">
                      No order items found.
                    </div>
                  )}
                </div>
              </div>

              {/* BILL DETAILS */}
              <div className="mt-3 rounded-[18px] border border-[var(--border)] bg-[var(--card)] p-4 sm:p-5">
                <h3 className="mb-3 text-[13px] font-extrabold text-[var(--text-primary)]">
                  Bill Details
                </h3>

                <div className="flex items-center justify-between gap-3 py-1 text-[11px] sm:text-xs">
                  <span className="text-[var(--text-secondary)]">Item Total</span>

                  <span className="font-semibold text-[var(--text-primary)]">
                    {formatCurrency(itemTotal)}
                  </span>
                </div>

                {total !== itemTotal && (
                  <div className="flex items-center justify-between gap-3 py-1 text-[11px] sm:text-xs">
                    <span className="text-[var(--text-secondary)]">
                      Other adjustments
                    </span>

                    <span className="font-semibold text-[var(--text-primary)]">
                      {formatCurrency(total - itemTotal)}
                    </span>
                  </div>
                )}

                <div className="mt-3 flex items-center justify-between gap-3 border-t border-[var(--border)] pt-3">
                  <span className="text-[12px] font-extrabold text-[var(--primary)] sm:text-[13px]">
                    Total Paid
                  </span>

                  <span className="text-[20px] font-extrabold tracking-[-0.5px] text-[var(--primary)] sm:text-[23px]">
                    {formatCurrency(total)}
                  </span>
                </div>
              </div>

              {/* ACTION BUTTONS */}
              <div className="mt-4 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={handleTrackOrder}
                  className="group flex min-h-[48px] items-center justify-center gap-2 rounded-xl bg-[var(--primary)] px-4 py-3 text-[13px] font-bold text-white shadow-[0_5px_12px_rgba(101,66,207,0.17)] transition hover:bg-[var(--primary-hover)] active:scale-[0.99] sm:text-sm"
                >
                  <ShoppingBag size={17} />
                  Track Your Order

                  <ArrowRight
                    size={16}
                    className="transition-transform group-hover:translate-x-1"
                  />
                </button>

                <button
                  type="button"
                  onClick={handleBackToHome}
                  className="flex min-h-[48px] items-center justify-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-[13px] font-bold text-[var(--text-primary)] transition hover:bg-[var(--card-hover)] active:scale-[0.99] sm:text-sm"
                >
                  <Home size={17} />
                  Back to Home
                </button>
              </div>
            </section>
          </section>

          <p className="mt-4 text-center text-[11px] text-[var(--text-muted)]">
            Thank you for choosing CampusVita.
          </p>
        </div>
      </main>

      {/* ANIMATIONS */}
      <style jsx global>{`
        @keyframes float {
          0%,
          100% {
            transform: translateY(0) rotate(-1deg);
          }

          50% {
            transform: translateY(-8px) rotate(1deg);
          }
        }

        @keyframes success-pop {
          0% {
            opacity: 0;
            transform: scale(0.3) rotate(-20deg);
          }

          70% {
            opacity: 1;
            transform: scale(1.12) rotate(5deg);
          }

          100% {
            opacity: 1;
            transform: scale(1) rotate(0);
          }
        }

        @media (prefers-reduced-motion: reduce) {
          *,
          *::before,
          *::after {
            animation-duration: 0.01ms !important;
            animation-iteration-count: 1 !important;
            scroll-behavior: auto !important;
          }
        }
      `}</style>
    </>
  );
}