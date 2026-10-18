import {
  getAccessToken,
  handleExpiredSession,
  SESSION_EXPIRED_MESSAGE,
  type UserRole,
} from "@/app/lib/auth/session";

const API_URL =
  process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000";

// ============================================================
// CENTRAL AUTHENTICATED FETCH
//
// Every authenticated request in this module goes through
// authFetch(). When the backend answers HTTP 401 (expired or
// invalid JWT), or when no token exists at all:
//
//   1. Clear ONLY that role's stale session
//      (existing per-role session utilities).
//   2. Redirect the user to /login.
//   3. Throw the friendly SESSION_EXPIRED_MESSAGE.
//
// Backend JWT error strings such as "Signature has expired"
// are never surfaced to the user, and backend JWT validation
// is unchanged.
// ============================================================

export async function authFetch(
  path: string,
  init: RequestInit = {},
  options?: {
    role?: UserRole;
    token?: string | null;
  }
): Promise<Response> {
  const role = options?.role ?? "ADMIN";
  const token =
    options?.token || getAccessToken(role);

  if (!token) {
    // No usable session - same treatment as an expired one.
    handleExpiredSession(role);
    throw new Error(SESSION_EXPIRED_MESSAGE);
  }

  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      ...init.headers,
      Authorization: `Bearer ${token}`,
    },
  });

  if (res.status === 401) {
    handleExpiredSession(role);
    throw new Error(SESSION_EXPIRED_MESSAGE);
  }

  return res;
}

export async function getDashboard() {
  const res = await authFetch("/admin/dashboard", {
    cache: "no-store",
  });

  if (!res.ok) {
    throw new Error("Failed to fetch dashboard");
  }

  return res.json();
}

export async function getTopSelling() {
  const res = await authFetch("/admin/top-selling");

  return res.json();
}

export async function getLiveQueue() {
  const res = await authFetch("/admin/live-queue");

  return res.json();
}

export async function getOrders() {
  const res = await authFetch("/admin/orders");

  if (!res.ok) {
    throw new Error("Failed to fetch orders");
  }

  return res.json();
}

export async function getTopSellingFoods(
  month: string
) {
  const res = await authFetch(
    `/admin/top-selling-foods?month=${encodeURIComponent(month)}`
  );

  if (!res.ok) {
    throw new Error(
      "Failed to fetch top selling foods"
    );
  }

  return res.json();
}

export async function getSalesDistribution(month: string) {
  const response = await authFetch(
    `/admin/sales-distribution?month=${encodeURIComponent(month)}`,
    {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
    }
  );

  if (!response.ok) {
    const errorText = await response.text();

    console.error(
      "Sales distribution API error:",
      response.status,
      errorText
    );

    throw new Error(
      `Sales distribution API failed: ${response.status}`
    );
  }

  return response.json();
}

export async function getOrderChartData() {
  const res = await authFetch(
    "/admin/order-chart-data"
  );

  if (!res.ok) {
    throw new Error(
      "Failed to fetch order chart data"
    );
  }

  return res.json();
}

export async function getRevenueChartData(year?: number) {
  const params = year
    ? `?year=${year}`
    : "";

  const res = await authFetch(
    `/admin/revenue-chart-data${params}`
  );

  if (!res.ok) {
    throw new Error(
      "Failed to fetch revenue chart data"
    );
  }

  return res.json();
}

export async function updateOrderStatus(
  orderToken: number,
  status: string
) {
  const res = await authFetch(
    `/admin/orders/${orderToken}`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ status }),
    }
  );

  if (!res.ok) {
    throw new Error("Failed to update order status");
  }

  return res.json();
}

export async function addFood(
  food: any,
  image: File,
  token: string
) {
  const formData = new FormData();

  formData.append("name", food.name);
  formData.append("description", food.description);
  formData.append("category", food.category);
  formData.append("category_id", food.category_id);
  formData.append("stall_id", food.stall_id);
  formData.append("price", String(food.price));
  formData.append("available",String(food.available));
  formData.append("is_veg",food.is_veg ?? "unknown");
  formData.append("image", image);

  const res = await authFetch(
    "/add-food",
    {
      method: "POST",
      body: formData,
    },
    { token }
  );

  const data = await res.json().catch(
    () => null
  );

  if (!res.ok) {
    throw new Error(
      data?.detail ||
        "Failed to add food"
    );
  }

  return data;
}

export async function updateFood(
  foodName: string,
  food: any,
  token: string
) {
  const res = await authFetch(
    `/update-food/${foodName}`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(food),
    },
    { token }
  );

  if (!res.ok) {
    throw new Error("Failed to update food");
  }

  return res.json();
}

export async function deleteFood(
  foodName: string,
  token: string
) {
  const res = await authFetch(
    `/delete-food/${foodName}`,
    {
      method: "DELETE",
    },
    { token }
  );

  if (!res.ok) {
    throw new Error("Failed to delete food");
  }

  return res.json();
}

export async function getRecentOrders(
  page = 1,
  limit = 5,
  status = "All",
  search = "",
  sortBy = "token",
  sortOrder = "desc"
) {
  const params = new URLSearchParams({
    page: String(page),
    limit: String(limit),
    status,
    search,
    sortBy,
    sortOrder,
  });

  const res = await authFetch(
    `/admin/recent-orders?${params}`
  );

  if (!res.ok) {
    throw new Error("Failed to fetch recent orders");
  }

  return res.json();
}

// ============================================================
// CUSTOMER MANAGEMENT
// ============================================================

export async function getCustomers(
  page = 1,
  limit = 10,
  search = "",
  status = "ALL",
  sort = "LATEST"
) {
  const params = new URLSearchParams({
    page: String(page),
    limit: String(limit),
    search,
    status_filter: status,
    sort,
  });

  const res = await authFetch(
    `/admin/customers?${params.toString()}`,
    {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
    }
  );

  if (!res.ok) {
    const errorText = await res.text();

    console.error(
      "Customers API error:",
      res.status,
      errorText
    );

    throw new Error(
      `Failed to fetch customers: ${res.status}`
    );
  }

  return res.json();
}

export async function updateUserRole(
  email: string,
  role: "ADMIN" | "USER" | "VENDOR"
) {
  const params = new URLSearchParams({
    role,
  });

  const res = await authFetch(
    `/admin/users/${encodeURIComponent(email)}/role?${params.toString()}`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
    }
  );

  const data = await res.json();

  if (!res.ok) {
    throw new Error(
      data?.detail || "Failed to update user role"
    );
  }

  return data;
}

// ============================================================
// VENDOR INVITATIONS (admin)
// ============================================================

export type VendorInvitationPayload = {
  business_name: string;
  owner_name: string;
  email: string;
  phone: string;
  stall_ids: string[];
};

export type VendorInvitationResult = {
  success: boolean;
  vendor_id: string;
  activation_code: string;
  expires_at: string;
  business_name: string;
  owner_name: string;
  email: string;
};

export async function createVendorInvitation(
  payload: VendorInvitationPayload
) {
  const res = await authFetch(
    "/admin/vendors/invitations",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    }
  );

  const data = await res.json().catch(() => null);

  if (!res.ok) {
    const detail = data?.detail;

    if (Array.isArray(detail)) {
      const message = detail
        .map((entry: any) => entry?.msg)
        .filter(Boolean)
        .join(", ");

      throw new Error(
        message || "Failed to create vendor invitation"
      );
    }

    throw new Error(
      typeof detail === "string"
        ? detail
        : "Failed to create vendor invitation"
    );
  }

  return data as VendorInvitationResult;
}

export async function getPublicStalls() {
  const res = await fetch(`${API_URL}/stalls`, {
    cache: "no-store",
  });

  if (!res.ok) {
    throw new Error("Failed to fetch stalls");
  }

  return res.json();
}
