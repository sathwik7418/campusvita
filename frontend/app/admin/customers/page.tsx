"use client";

import { startTransition, useEffect, useState } from "react";
import {
  Search,
  Users,
  UserCheck,
  UserPlus,
  ShoppingBag,
  MoreVertical,
  ChevronLeft,
  ChevronRight,
  Download,
  Mail,
  Phone,
  CalendarDays,
  X,
  Copy,
  Check,
  AlertTriangle,
} from "lucide-react";

import {
  getCustomers,
  updateUserRole,
  createVendorInvitation,
  getPublicStalls,
  type VendorInvitationResult,
} from "@/app/lib/api";

type RecentOrder = {
  order_id: string;
  token?: string;
  amount: number;
  status: string;
  date?: string;
};

type Customer = {
  id: string;
  name: string;
  email: string;
  phone: string;
  profile_image?: string;
  department?: string;
  year?: string;
  total_orders: number;
  completed_orders: number;
  pending_orders: number;
  total_spent: number;
  total_payments: number;
  status: string;
  joined_at?: string;
  recent_orders?: RecentOrder[];
  role?: "ADMIN" | "USER" | "VENDOR";
};

type Statistics = {
  total_customers: number;
  active_customers: number;
  new_customers: number;
  customers_with_orders: number;
  total_orders: number;
  total_spent: number;
  total_payments: number;
};

type CustomersResponse = {
  customers?: Customer[];
  statistics?: Statistics;
  pages?: number;
  page?: number;
  limit?: number;
  total?: number;
};

const emptyStats: Statistics = {
  total_customers: 0,
  active_customers: 0,
  new_customers: 0,
  customers_with_orders: 0,
  total_orders: 0,
  total_spent: 0,
  total_payments: 0,
};

function formatMoney(value: number | undefined) {
  return `₹${Number(value ?? 0).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatDate(value?: string) {
  if (!value) return "—";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return date.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function getInitials(name?: string) {
  if (!name?.trim()) return "CU";

  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

export default function CustomerManagementPage() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [statistics, setStatistics] =
    useState<Statistics>(emptyStats);

  const [selectedCustomer, setSelectedCustomer] =
    useState<Customer | null>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("ALL");
  const [sort, setSort] = useState("LATEST");

  const [page, setPage] = useState(1);
  const limit = 6;

  const [totalPages, setTotalPages] = useState(0);
  const [openMenu, setOpenMenu] = useState<string | null>(null);

  // ------------------------------------------------------------
  // CREATE VENDOR (invitation) modal
  // ------------------------------------------------------------

  const [showVendorModal, setShowVendorModal] =
    useState(false);

  const [vendorForm, setVendorForm] = useState({
    business_name: "",
    owner_name: "",
    email: "",
    phone: "",
  });

  const [stallOptions, setStallOptions] = useState<
    { _id: string; name: string }[]
  >([]);

  const [selectedStallIds, setSelectedStallIds] =
    useState<string[]>([]);

  const [creatingVendor, setCreatingVendor] =
    useState(false);

  const [vendorError, setVendorError] = useState("");

  const [createdInvitation, setCreatedInvitation] =
    useState<VendorInvitationResult | null>(null);

  const [copiedField, setCopiedField] = useState("");

  async function loadCustomers() {
    try {
      setLoading(true);
      setError("");

      const data = (await getCustomers(
        page,
        limit,
        search,
        status,
        sort
      )) as CustomersResponse;

      console.log("Customers API response:", data);

      setCustomers(data?.customers ?? []);

      setStatistics(
        data?.statistics ?? emptyStats
      );

      setTotalPages(
        Number(data?.pages ?? 0)
      );

      if (selectedCustomer) {
        const updatedCustomer =
          data?.customers?.find(
            (customer) =>
              customer.id === selectedCustomer.id
          );

        if (updatedCustomer) {
          setSelectedCustomer(updatedCustomer);
        }
      }
    } catch (err) {
      console.error(
        "Customer Management error:",
        err
      );

      setError(
        err instanceof Error
          ? err.message
          : "Failed to load customers"
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    startTransition(() => {
      void loadCustomers();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, search, status, sort]);

  function handleSearch(value: string) {
    setSearch(value);
    setPage(1);
  }

  function handleStatus(value: string) {
    setStatus(value);
    setPage(1);
  }

  function handleSort(value: string) {
    setSort(value);
    setPage(1);
  }

  function handleCustomerClick(customer: Customer) {
    setSelectedCustomer(customer);
    setOpenMenu(null);
  }

  function exportCustomers() {
    if (!customers.length) return;

    const headers = [
      "Name",
      "Email",
      "Phone",
      "Orders",
      "Total Spent",
      "Status",
      "Joined Date",
    ];

    const rows = customers.map((customer) => [
      customer.name,
      customer.email,
      customer.phone,
      customer.total_orders,
      customer.total_spent,
      customer.status,
      formatDate(customer.joined_at),
    ]);

    const csv = [headers, ...rows]
      .map((row) =>
        row
          .map(
            (value) =>
              `"${String(value ?? "").replace(
                /"/g,
                '""'
              )}"`
          )
          .join(",")
      )
      .join("\n");

    const blob = new Blob([csv], {
      type: "text/csv;charset=utf-8;",
    });

    const url = URL.createObjectURL(blob);

    const link = document.createElement("a");

    link.href = url;
    link.download = "campusvita-customers.csv";

    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    URL.revokeObjectURL(url);
  }

  // ------------------------------------------------------------
  // CREATE VENDOR (invitation)
  // ------------------------------------------------------------

  async function openVendorModal() {
    setVendorForm({
      business_name: "",
      owner_name: "",
      email: "",
      phone: "",
    });
    setSelectedStallIds([]);
    setVendorError("");
    setCreatedInvitation(null);
    setShowVendorModal(true);

    if (stallOptions.length === 0) {
      try {
        const data = await getPublicStalls();
        setStallOptions(data?.stalls ?? []);
      } catch (err) {
        console.error("Failed to load stalls:", err);
      }
    }
  }

  function closeVendorModal() {
    setShowVendorModal(false);
    setCreatedInvitation(null);
    setVendorError("");
  }

  function toggleStall(stallId: string) {
    setSelectedStallIds((current) =>
      current.includes(stallId)
        ? current.filter((id) => id !== stallId)
        : [...current, stallId]
    );
  }

  async function handleCreateVendor() {
    const businessName =
      vendorForm.business_name.trim();
    const ownerName = vendorForm.owner_name.trim();
    const email = vendorForm.email.trim();
    const phone = vendorForm.phone.trim();

    if (!businessName || !ownerName || !email || !phone) {
      setVendorError("Please fill all required fields.");
      return;
    }

    try {
      setCreatingVendor(true);
      setVendorError("");

      const result = await createVendorInvitation({
        business_name: businessName,
        owner_name: ownerName,
        email,
        phone,
        stall_ids: selectedStallIds,
      });

      setCreatedInvitation(result);
    } catch (err) {
      console.error("Create vendor invitation error:", err);
      setVendorError(
        err instanceof Error
          ? err.message
          : "Failed to create vendor invitation"
      );
    } finally {
      setCreatingVendor(false);
    }
  }

  async function copyCredential(
    field: string,
    value: string
  ) {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedField(field);
      setTimeout(() => setCopiedField(""), 1500);
    } catch (err) {
      console.error("Copy failed:", err);
    }
  }

  function formatDateTime(value?: string) {
    if (!value) return "—";

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
      return String(value);
    }

    return date.toLocaleString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  return (
    <div className="min-h-full space-y-6">
      {/* HEADER */}

      <div className="flex flex-col gap-5 xl:flex-row xl:items-center xl:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-text-primary">
            Customer Management
          </h1>

          <div className="mt-2 flex items-center gap-2 text-sm">
            <span className="text-text-muted">
              Dashboard
            </span>

            <span className="text-border-strong">
              /
            </span>

            <span className="text-brand">
              Customer Management
            </span>
          </div>
        </div>

        <div className="relative w-full xl:w-80">
          <Search
            size={18}
            className="absolute left-4 top-1/2 -translate-y-1/2 text-text-muted"
          />

          <input
            value={search}
            onChange={(e) =>
              handleSearch(e.target.value)
            }
            placeholder="Search customers..."
            className="h-12 w-full rounded-2xl border border-input-border bg-input pl-11 pr-4 text-sm text-text-primary outline-none transition placeholder:text-text-muted focus:border-brand/60"
          />
        </div>
      </div>

      {/* ERROR */}

      {error && (
        <div className="rounded-2xl border border-danger/20 bg-danger-soft p-4 text-sm text-danger">
          {error}
        </div>
      )}

      {/* STATISTICS */}

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          title="Total Customers"
          value={statistics.total_customers}
          icon={Users}
          iconClass="bg-purple-500/10 text-purple-500"
        />

        <StatCard
          title="Active Customers"
          value={statistics.active_customers}
          icon={UserCheck}
          iconClass="bg-emerald-500/10 text-emerald-500"
        />

        <StatCard
          title="New Customers"
          value={statistics.new_customers}
          icon={UserPlus}
          iconClass="bg-blue-500/10 text-blue-500"
        />

        <StatCard
          title="Customers With Orders"
          value={statistics.customers_with_orders}
          icon={ShoppingBag}
          iconClass="bg-brand/10 text-brand"
        />
      </div>

      {/* MAIN CONTENT */}

      <div
        className={`grid gap-5 ${
          selectedCustomer
            ? "xl:grid-cols-[minmax(0,1fr)_390px]"
            : "grid-cols-1"
        }`}
      >
        {/* CUSTOMER TABLE */}

        <section className="min-w-0 overflow-hidden rounded-2xl border border-border bg-card shadow-[var(--shadow-card)] transition-colors duration-200">
          <div className="border-b border-border p-5">
            <div className="mb-5 flex items-center justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold text-text-primary">
                  All Customers
                </h2>

                <p className="mt-1 text-xs text-text-muted">
                  Real customer accounts from CampusVita
                </p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={openVendorModal}
                  className="flex items-center gap-2 rounded-xl bg-brand px-4 py-2.5 text-sm font-semibold text-white transition hover:brightness-95"
                >
                  <UserPlus size={16} />
                  Create Vendor
                </button>

                <button
                  type="button"
                  onClick={exportCustomers}
                  className="flex items-center gap-2 rounded-xl bg-brand px-4 py-2.5 text-sm font-semibold text-white transition hover:brightness-95"
                >
                  <Download size={16} />
                  Export
                </button>
              </div>
            </div>

            {/* FILTERS */}

            <div className="flex flex-col gap-3 lg:flex-row">
              <div className="relative flex-1">
                <Search
                  size={17}
                  className="absolute left-4 top-1/2 -translate-y-1/2 text-text-muted"
                />

                <input
                  value={search}
                  onChange={(e) =>
                    handleSearch(e.target.value)
                  }
                  placeholder="Search by name, email or phone..."
                  className="h-11 w-full rounded-xl border border-input-border bg-input pl-11 pr-4 text-sm text-text-primary outline-none placeholder:text-text-muted focus:border-brand/50"
                />
              </div>

              <select
                value={status}
                onChange={(e) =>
                  handleStatus(e.target.value)
                }
                className="h-11 rounded-xl border border-input-border bg-input px-4 text-sm text-text-primary outline-none focus:border-brand/50"
              >
                <option value="ALL">All Status</option>
                <option value="ACTIVE">Active</option>
                <option value="INACTIVE">Inactive</option>
              </select>

              <select
                value={sort}
                onChange={(e) =>
                  handleSort(e.target.value)
                }
                className="h-11 rounded-xl border border-input-border bg-input px-4 text-sm text-text-primary outline-none focus:border-brand/50"
              >
                <option value="LATEST">Newest</option>
                <option value="NAME_ASC">Name A-Z</option>
                <option value="NAME_DESC">Name Z-A</option>
                <option value="SPENDING_HIGH">
                  Spending High
                </option>
                <option value="SPENDING_LOW">
                  Spending Low
                </option>
                <option value="ORDERS_HIGH">
                  Orders High
                </option>
              </select>
            </div>
          </div>

          {/* TABLE */}

          <div className="overflow-x-auto">
            <table className="w-full min-w-[850px]">
              <thead>
                <tr className="border-b border-border bg-surface text-left text-xs uppercase tracking-wide text-text-muted">
                  <th className="px-5 py-4">
                    Customer
                  </th>

                  <th className="px-4 py-4">
                    Email
                  </th>

                  <th className="px-4 py-4">
                    Phone
                  </th>

                  <th className="px-4 py-4">
                    Orders
                  </th>

                  <th className="px-4 py-4">
                    Total Spent
                  </th>

                  <th className="px-4 py-4">
                    Status
                  </th>

                  <th className="px-4 py-4">
                    Joined Date
                  </th>

                  <th className="px-4 py-4 text-right">
                    Action
                  </th>
                </tr>
              </thead>

              <tbody>
                {loading ? (
                  <tr>
                    <td
                      colSpan={8}
                      className="px-5 py-16 text-center text-text-muted"
                    >
                      Loading customers...
                    </td>
                  </tr>
                ) : customers.length === 0 ? (
                  <tr>
                    <td
                      colSpan={8}
                      className="px-5 py-16 text-center text-text-muted"
                    >
                      No customers found.
                    </td>
                  </tr>
                ) : (
                  customers.map((customer) => (
                    <tr
                      key={customer.id}
                      onClick={() =>
                        handleCustomerClick(customer)
                      }
                      className="cursor-pointer border-b border-border/70 transition hover:bg-card-hover"
                    >
                      {/* CUSTOMER */}

                      <td className="px-5 py-4">
                        <div className="flex items-center gap-3">
                          {customer.profile_image ? (
                            <img
                              src={customer.profile_image}
                              alt={
                                customer.name ||
                                "Customer"
                              }
                              className="h-10 w-10 rounded-full object-cover"
                            />
                          ) : (
                            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-brand/10 text-sm font-semibold text-brand">
                              {getInitials(
                                customer.name
                              )}
                            </div>
                          )}

                          <div className="min-w-0">
                            <p className="truncate font-medium text-text-primary">
                              {customer.name ||
                                "Unnamed Customer"}
                            </p>

                            <p className="text-xs text-text-muted">
                              Customer
                            </p>
                          </div>
                        </div>
                      </td>

                      {/* EMAIL */}

                      <td className="px-4 py-4 text-sm text-text-secondary">
                        {customer.email || "—"}
                      </td>

                      {/* PHONE */}

                      <td className="px-4 py-4 text-sm text-text-secondary">
                        {customer.phone || "—"}
                      </td>

                      {/* ORDERS */}

                      <td className="px-4 py-4 text-sm font-medium text-text-primary">
                        {customer.total_orders ?? 0}
                      </td>

                      {/* SPENT */}

                      <td className="px-4 py-4 text-sm font-medium text-text-primary">
                        {formatMoney(
                          customer.total_spent
                        )}
                      </td>

                      {/* STATUS */}

                      <td className="px-4 py-4">
                        <span
                          className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${
                            customer.status?.toUpperCase() ===
                            "ACTIVE"
                              ? "bg-emerald-500/10 text-emerald-600"
                              : "bg-red-500/10 text-red-600"
                          }`}
                        >
                          {customer.status ||
                            "UNKNOWN"}
                        </span>
                      </td>

                      {/* DATE */}

                      <td className="px-4 py-4 text-sm text-text-secondary">
                        {formatDate(
                          customer.joined_at
                        )}
                      </td>

                      {/* ACTION */}

                      <td
                        className="relative px-4 py-4 text-right"
                        onClick={(e) =>
                          e.stopPropagation()
                        }
                      >
                        <button
                          type="button"
                          onClick={() =>
                            setOpenMenu(
                              openMenu ===
                                customer.id
                                ? null
                                : customer.id
                            )
                          }
                          className="rounded-lg p-2 text-text-muted transition hover:bg-card-hover hover:text-text-primary"
                        >
                          <MoreVertical size={18} />
                        </button>

                        {openMenu === customer.id && (
                          <div className="absolute right-4 top-12 z-20 w-44 rounded-xl border border-border bg-card p-1 shadow-2xl">
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedCustomer(
                                  customer
                                );
                                setOpenMenu(null);
                              }}
                              className="w-full rounded-lg px-3 py-2 text-left text-sm text-text-secondary hover:bg-card-hover hover:text-text-primary"
                            >
                              View Details
                            </button>

                            {customer.role !== "VENDOR" && (
                              <button
                                type="button"
                                onClick={async () => {
                                  try {
                                    await updateUserRole(
                                      customer.email,
                                      "VENDOR"
                                    );
                                    setOpenMenu(null);
                                    await loadCustomers();
                                  } catch (error) {
                                    console.error(
                                      "Failed to make vendor:",
                                      error
                                    );
                                  }
                                }}
                                className="w-full rounded-lg px-3 py-2 text-left text-sm text-brand hover:bg-card-hover"
                              >
                                Make Vendor
                              </button>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* PAGINATION */}

          <div className="flex flex-col gap-4 border-t border-border p-5 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-text-muted">
              Showing{" "}
              <span className="text-text-primary">
                {customers.length}
              </span>{" "}
              of{" "}
              <span className="text-text-primary">
                {statistics.total_customers}
              </span>{" "}
              customers
            </p>

            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={page <= 1}
                onClick={() =>
                  setPage((current) =>
                    Math.max(1, current - 1)
                  )
                }
                className="rounded-lg border border-border p-2 text-text-secondary transition hover:bg-card-hover hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-30"
              >
                <ChevronLeft size={17} />
              </button>

              <span className="rounded-lg bg-brand px-3 py-2 text-sm font-semibold text-white">
                {page}
              </span>

              <span className="px-1 text-sm text-text-muted">
                of
              </span>

              <span className="text-sm text-text-secondary">
                {totalPages || 1}
              </span>

              <button
                type="button"
                disabled={
                  totalPages === 0 ||
                  page >= totalPages
                }
                onClick={() =>
                  setPage((current) =>
                    Math.min(
                      totalPages,
                      current + 1
                    )
                  )
                }
                className="rounded-lg border border-border p-2 text-text-secondary transition hover:bg-card-hover hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-30"
              >
                <ChevronRight size={17} />
              </button>
            </div>
          </div>
        </section>

        {/* CUSTOMER DETAILS */}

        {selectedCustomer && (
          <aside className="h-fit overflow-hidden rounded-2xl border border-border bg-card shadow-[var(--shadow-card)]">
            <div className="flex items-center justify-between border-b border-border p-5">
              <h2 className="text-lg font-semibold text-text-primary">
                Customer Details
              </h2>

              <button
                type="button"
                onClick={() =>
                  setSelectedCustomer(null)
                }
                className="rounded-lg p-2 text-text-muted hover:bg-card-hover hover:text-text-primary"
              >
                <X size={18} />
              </button>
            </div>

            <div className="p-5">
              {/* PROFILE */}

              <div className="flex items-center gap-4">
                {selectedCustomer.profile_image ? (
                  <img
                    src={
                      selectedCustomer.profile_image
                    }
                    alt={
                      selectedCustomer.name ||
                      "Customer"
                    }
                    className="h-20 w-20 rounded-2xl object-cover"
                  />
                ) : (
                  <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-brand/10 text-2xl font-bold text-brand">
                    {getInitials(
                      selectedCustomer.name
                    )}
                  </div>
                )}

                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="truncate text-lg font-semibold text-text-primary">
                      {selectedCustomer.name ||
                        "Unnamed Customer"}
                    </h3>

                    <span
                      className={`rounded-full px-2 py-1 text-[10px] font-medium ${
                        selectedCustomer.status?.toUpperCase() ===
                        "ACTIVE"
                          ? "bg-emerald-500/10 text-emerald-600"
                          : "bg-red-500/10 text-red-600"
                      }`}
                    >
                      {selectedCustomer.status ||
                        "UNKNOWN"}
                    </span>
                  </div>

                  <div className="mt-3 space-y-2 text-xs text-text-secondary">
                    <div className="flex items-center gap-2">
                      <Mail size={14} />

                      <span className="truncate">
                        {selectedCustomer.email ||
                          "—"}
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      <Phone size={14} />

                      <span>
                        {selectedCustomer.phone ||
                          "—"}
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      <CalendarDays size={14} />

                      <span>
                        Joined{" "}
                        {formatDate(
                          selectedCustomer.joined_at
                        )}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* STATS */}

              <div className="mt-6 grid grid-cols-3 divide-x divide-border rounded-xl border border-border bg-surface">
                <MiniStat
                  label="Orders"
                  value={
                    selectedCustomer.total_orders ??
                    0
                  }
                />

                <MiniStat
                  label="Spent"
                  value={formatMoney(
                    selectedCustomer.total_spent
                  )}
                />

                <MiniStat
                  label="Payments"
                  value={
                    selectedCustomer.total_payments ??
                    0
                  }
                />
              </div>

              {/* RECENT ORDERS */}

              <div className="mt-6">
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="font-semibold text-text-primary">
                    Recent Orders
                  </h3>

                  <span className="text-xs text-text-muted">
                    Latest 5
                  </span>
                </div>

                <div className="space-y-2">
                  {selectedCustomer.recent_orders
                    ?.length ? (
                    selectedCustomer.recent_orders.map(
                      (order, index) => (
                        <div
                          key={`${order.order_id}-${index}`}
                          className="rounded-xl border border-border bg-surface p-3"
                        >
                          <div className="flex items-center justify-between gap-3">
                            <div>
                              <p className="text-sm font-medium text-text-primary">
                                #
                                {order.order_id ||
                                  order.token ||
                                  "Order"}
                              </p>

                              <p className="mt-1 text-xs text-text-muted">
                                {formatDate(
                                  order.date
                                )}
                              </p>
                            </div>

                            <div className="text-right">
                              <p className="text-sm font-medium text-text-primary">
                                {formatMoney(
                                  order.amount
                                )}
                              </p>

                              <span
                                className={`mt-1 inline-block text-[10px] ${
                                  order.status
                                    ?.toLowerCase()
                                    .includes("complete") ||
                                  order.status
                                    ?.toLowerCase()
                                    .includes("deliver")
                                    ? "text-emerald-500"
                                    : "text-brand"
                                }`}
                              >
                                {order.status || "—"}
                              </span>
                            </div>
                          </div>
                        </div>
                      )
                    )
                  ) : (
                    <div className="rounded-xl border border-border bg-surface p-6 text-center text-sm text-text-muted">
                      No orders found.
                    </div>
                  )}
                </div>
              </div>

              {/* FULL PROFILE */}

              <button
                type="button"
                className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-brand py-3 text-sm font-semibold text-white transition hover:brightness-95"
              >
                <Users size={17} />
                View Full Profile
              </button>
            </div>
          </aside>
        )}
      </div>

      {/* ======================================================
          CREATE VENDOR MODAL
      ====================================================== */}

      {showVendorModal && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-4 backdrop-blur-sm sm:items-center">
          <div className="flex w-full max-w-xl flex-col rounded-3xl border border-zinc-800 bg-[var(--surface)] shadow-2xl sm:max-h-[calc(100vh-2rem)]">
            {/* MODAL HEADER */}

            <div className="flex shrink-0 items-center justify-between border-b border-zinc-800 p-6">
              <div>
                <h2 className="text-xl font-bold text-white">
                  {createdInvitation
                    ? "Vendor Credentials"
                    : "Create Vendor"}
                </h2>

                <p className="mt-1 text-sm text-zinc-500">
                  {createdInvitation
                    ? "Hand these one-time credentials to the vendor"
                    : "Generate a Vendor ID and one-time activation code"}
                </p>
              </div>

              <button
                type="button"
                onClick={closeVendorModal}
                className="rounded-xl p-2 text-zinc-500 hover:bg-zinc-800 hover:text-white"
              >
                <X size={20} />
              </button>
            </div>

            {createdInvitation ? (
              <>
                {/* CREDENTIALS (creation response only - never re-fetched) */}

                <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-6">
                  <div className="flex items-start gap-3 rounded-2xl border border-warning/30 bg-warning/10 p-4 text-sm text-warning">
                    <AlertTriangle
                      size={18}
                      className="mt-0.5 shrink-0"
                    />

                    <p>
                      Save these credentials now. The
                      activation code will only be shown
                      once.
                    </p>
                  </div>

                  <div className="rounded-xl border border-zinc-800 bg-[var(--surface-secondary)] p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-xs uppercase tracking-wide text-zinc-500">
                          Vendor ID
                        </p>

                        <p className="mt-1 font-mono text-lg font-semibold text-white">
                          {createdInvitation.vendor_id}
                        </p>
                      </div>

                      <button
                        type="button"
                        onClick={() =>
                          copyCredential(
                            "vendor_id",
                            createdInvitation.vendor_id
                          )
                        }
                        className="flex shrink-0 items-center gap-1.5 rounded-lg border border-zinc-700 px-3 py-2 text-xs font-medium text-zinc-300 transition hover:bg-zinc-800 hover:text-white"
                      >
                        {copiedField === "vendor_id" ? (
                          <Check
                            size={14}
                            className="text-emerald-400"
                          />
                        ) : (
                          <Copy size={14} />
                        )}

                        {copiedField === "vendor_id"
                          ? "Copied"
                          : "Copy"}
                      </button>
                    </div>
                  </div>

                  <div className="rounded-xl border border-zinc-800 bg-[var(--surface-secondary)] p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-xs uppercase tracking-wide text-zinc-500">
                          Activation Code
                        </p>

                        <p className="mt-1 font-mono text-lg font-semibold text-white">
                          {createdInvitation.activation_code}
                        </p>
                      </div>

                      <button
                        type="button"
                        onClick={() =>
                          copyCredential(
                            "activation_code",
                            createdInvitation.activation_code
                          )
                        }
                        className="flex shrink-0 items-center gap-1.5 rounded-lg border border-zinc-700 px-3 py-2 text-xs font-medium text-zinc-300 transition hover:bg-zinc-800 hover:text-white"
                      >
                        {copiedField === "activation_code" ? (
                          <Check
                            size={14}
                            className="text-emerald-400"
                          />
                        ) : (
                          <Copy size={14} />
                        )}

                        {copiedField === "activation_code"
                          ? "Copied"
                          : "Copy"}
                      </button>
                    </div>
                  </div>

                  <div className="rounded-xl border border-zinc-800 bg-[var(--surface-secondary)] p-4">
                    <p className="text-xs uppercase tracking-wide text-zinc-500">
                      Expires
                    </p>

                    <p className="mt-1 text-sm font-medium text-white">
                      {formatDateTime(
                        createdInvitation.expires_at
                      )}
                    </p>
                  </div>

                  <p className="text-xs text-zinc-500">
                    Give these to{" "}
                    <span className="text-zinc-300">
                      {createdInvitation.owner_name}
                    </span>{" "}
                    (
                    <span className="text-zinc-300">
                      {createdInvitation.email}
                    </span>
                    ). The vendor will enter them at
                    /vendor/activate to set a password and
                    activate the account.
                  </p>
                </div>

                <div className="flex shrink-0 justify-end gap-3 border-t border-zinc-800 p-6">
                  <button
                    type="button"
                    onClick={closeVendorModal}
                    className="rounded-xl bg-brand px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-hover"
                  >
                    Done
                  </button>
                </div>
              </>
            ) : (
              <>
                {/* FORM */}

                <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-6">
                  {vendorError && (
                    <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-300">
                      {vendorError}
                    </div>
                  )}

                  <div>
                    <label className="mb-2 block text-sm font-medium text-zinc-300">
                      Business Name
                    </label>

                    <input
                      value={vendorForm.business_name}
                      onChange={(e) =>
                        setVendorForm({
                          ...vendorForm,
                          business_name: e.target.value,
                        })
                      }
                      placeholder="Example: Spice Garden Foods"
                      className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-3 text-white outline-none placeholder:text-zinc-600 focus:border-brand"
                    />
                  </div>

                  <div>
                    <label className="mb-2 block text-sm font-medium text-zinc-300">
                      Owner Name
                    </label>

                    <input
                      value={vendorForm.owner_name}
                      onChange={(e) =>
                        setVendorForm({
                          ...vendorForm,
                          owner_name: e.target.value,
                        })
                      }
                      placeholder="Full name of the vendor owner"
                      className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-3 text-white outline-none placeholder:text-zinc-600 focus:border-brand"
                    />
                  </div>

                  <div className="grid gap-5 sm:grid-cols-2">
                    <div>
                      <label className="mb-2 block text-sm font-medium text-zinc-300">
                        Email
                      </label>

                      <input
                        type="email"
                        value={vendorForm.email}
                        onChange={(e) =>
                          setVendorForm({
                            ...vendorForm,
                            email: e.target.value,
                          })
                        }
                        placeholder="vendor@example.com"
                        className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-3 text-white outline-none placeholder:text-zinc-600 focus:border-brand"
                      />
                    </div>

                    <div>
                      <label className="mb-2 block text-sm font-medium text-zinc-300">
                        Phone
                      </label>

                      <input
                        inputMode="numeric"
                        maxLength={10}
                        value={vendorForm.phone}
                        onChange={(e) =>
                          setVendorForm({
                            ...vendorForm,
                            phone: e.target.value.replace(
                              /\D/g,
                              ""
                            ),
                          })
                        }
                        placeholder="10-digit mobile number"
                        className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-3 text-white outline-none placeholder:text-zinc-600 focus:border-brand"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="mb-2 block text-sm font-medium text-zinc-300">
                      Stall Assignment{" "}
                      <span className="text-zinc-500">
                        (optional)
                      </span>
                    </label>

                    {stallOptions.length > 0 ? (
                      <div className="max-h-40 space-y-2 overflow-y-auto rounded-xl border border-zinc-700 bg-zinc-900 p-3">
                        {stallOptions.map((stall) => (
                          <label
                            key={stall._id}
                            className="flex cursor-pointer items-center gap-3"
                          >
                            <input
                              type="checkbox"
                              checked={selectedStallIds.includes(
                                stall._id
                              )}
                              onChange={() =>
                                toggleStall(stall._id)
                              }
                              className="h-4 w-4 accent-brand"
                            />

                            <span className="text-sm text-zinc-300">
                              {stall.name || "Unnamed Stall"}
                            </span>
                          </label>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-zinc-500">
                        No stalls available yet. You can
                        assign stalls later from Stall
                        Management.
                      </p>
                    )}
                  </div>
                </div>

                {/* MODAL FOOTER */}

                <div className="flex shrink-0 justify-end gap-3 border-t border-zinc-800 p-6">
                  <button
                    type="button"
                    onClick={closeVendorModal}
                    disabled={creatingVendor}
                    className="rounded-xl bg-zinc-800 px-5 py-2.5 text-sm font-medium text-zinc-300 hover:bg-zinc-700 disabled:opacity-50"
                  >
                    Cancel
                  </button>

                  <button
                    type="button"
                    onClick={handleCreateVendor}
                    disabled={creatingVendor}
                    className="rounded-xl bg-brand px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {creatingVendor
                      ? "Creating..."
                      : "Create Vendor"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ============================================================
   STAT CARD
============================================================ */

function StatCard({
  title,
  value,
  icon: Icon,
  iconClass,
}: {
  title: string;
  value: number;
  icon: React.ComponentType<{ size?: number }>;
  iconClass: string;
}) {
  return (
    <div className="rounded-2xl border border-border bg-card p-5 shadow-[var(--shadow-soft)] transition-all duration-200 hover:border-brand/20 hover:shadow-[var(--shadow-card)]">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-text-muted">
            {title}
          </p>

          <p className="mt-2 text-3xl font-bold text-text-primary">
            {Number(value ?? 0).toLocaleString(
              "en-IN"
            )}
          </p>
        </div>

        <div
          className={`flex h-12 w-12 items-center justify-center rounded-xl ${iconClass}`}
        >
          <Icon size={24} />
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   MINI STAT
============================================================ */

function MiniStat({
  label,
  value,
}: {
  label: string;
  value: string | number;
}) {
  return (
    <div className="p-3 text-center">
      <p className="text-sm font-semibold text-text-primary">
        {value}
      </p>

      <p className="mt-1 text-[10px] text-text-muted">
        {label}
      </p>
    </div>
  );
}
