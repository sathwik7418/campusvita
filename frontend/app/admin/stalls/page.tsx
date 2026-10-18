"use client";

import { useEffect, useState } from "react";
import {
  Plus,
  Search,
  Pencil,
  Trash2,
  Store,
  Power,
  DoorOpen,
  X,
} from "lucide-react";
import toast from "react-hot-toast";
import { getImageUrl } from "@/app/lib/getImageUrl";

type Stall = {
  _id: string;
  name: string;
  image: string;
  description: string;
  is_open: boolean;
  active: boolean;
  owner_email?: string | null;
  preparation_time?: string | null;
};

type StallForm = {
  name: string;
  image: string;
  description: string;
  is_open: boolean;
  active: boolean;
  owner_email: string;
  preparation_time: string;
};

type Vendor = {
  email: string;
  name: string;
};

const API_URL =
  process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000";

const emptyForm: StallForm = {
  name: "",
  image: "",
  description: "",
  is_open: true,
  active: true,
  owner_email: "",
  preparation_time: "15",
};

export default function StallsPage() {
  const [stalls, setStalls] = useState<Stall[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);

  const [showModal, setShowModal] = useState(false);
  const [editingStall, setEditingStall] = useState<Stall | null>(null);

  const [form, setForm] = useState<StallForm>(emptyForm);

  const getToken = () => {
    try {
      const session = JSON.parse(
        localStorage.getItem("campusvita_admin_session") || "null"
      );

      return session?.accessToken || null;
    } catch {
      return null;
    }
  };

  const getHeaders = () => {
    const token = getToken();

    return {
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
  };

  const uploadStallImage = async (file: File) => {
    if (!file.type.startsWith("image/")) {
      toast.error("Please select a valid image file.");
      return;
    }

    try {
      setUploadingImage(true);

      const formData = new FormData();
      formData.append("file", file);

      const token = getToken();
      const headers: Record<string, string> = {
        Accept: "application/json",
      };

      if (token) {
        headers.Authorization = `Bearer ${token}`;
      }

      const response = await fetch(`${API_URL}/upload-image`, {
        method: "POST",
        headers,
        body: formData,
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data?.detail || "Failed to upload stall image."
        );
      }

      if (!data?.image_url) {
        throw new Error("The server did not return an image URL.");
      }

      setForm((current) => ({
        ...current,
        image: data.image_url,
      }));

      toast.success("Stall image uploaded successfully.");
    } catch (error) {
      console.error("Stall image upload error:", error);

      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to upload stall image."
      );
    } finally {
      setUploadingImage(false);
    }
  };

  const loadStalls = async () => {
    try {
      setLoading(true);

      const params = new URLSearchParams();

      if (search.trim()) {
        params.set("search", search.trim());
      }

      params.set("status_filter", statusFilter);

      const response = await fetch(
        `${API_URL}/admin/stalls?${params.toString()}`,
        {
          method: "GET",
          headers: getHeaders(),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.detail || "Failed to load stalls");
      }

      setStalls(data?.stalls || []);
    } catch (error) {
      console.error("Load stalls error:", error);

      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to load stalls"
      );
    } finally {
      setLoading(false);
    }
  };

  const loadVendors = async () => {
    try {
      const response = await fetch(`${API_URL}/admin/users`, {
        method: "GET",
        headers: getHeaders(),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.detail || "Failed to load vendors");
      }

      const vendorUsers: Vendor[] = (data?.users || [])
        .filter(
          (user: { role?: string }) => user.role === "VENDOR"
        )
        .map(
          (user: {
            email: string;
            name?: string;
          }) => ({
            email: user.email,
            name: user.name || user.email,
          })
        );

      setVendors(vendorUsers);
    } catch (error) {
      console.error("Load vendors error:", error);

      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to load vendors"
      );
    }
  };

  useEffect(() => {
    loadStalls();
    loadVendors();
  }, [statusFilter]);

  const openCreateModal = () => {
    setEditingStall(null);
    setForm({ ...emptyForm });
    setShowModal(true);
  };

  const openEditModal = (stall: Stall) => {
    setEditingStall(stall);

    setForm({
      name: stall.name || "",
      image: stall.image || "",
      description: stall.description || "",
      is_open: stall.is_open,
      active: stall.active,
      owner_email: stall.owner_email || "",
      preparation_time: stall.preparation_time || "",
    });

    setShowModal(true);
  };

  const closeModal = () => {
    if (saving) return;

    setShowModal(false);
    setEditingStall(null);
    setForm({ ...emptyForm });
  };

  const saveStall = async () => {
    if (!form.name.trim()) {
      toast.error("Stall name is required");
      return;
    }

    try {
      setSaving(true);

      const url = editingStall
        ? `${API_URL}/admin/stalls/${editingStall._id}`
        : `${API_URL}/admin/stalls`;

      const response = await fetch(url, {
        method: editingStall ? "PUT" : "POST",
        headers: getHeaders(),
        body: JSON.stringify({
          name: form.name.trim(),
          image: form.image.trim(),
          description: form.description.trim(),
          is_open: form.is_open,
          active: form.active,
          owner_email: form.owner_email.trim() || null,
          preparation_time: form.preparation_time.trim() || null,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data?.detail ||
            (editingStall
              ? "Failed to update stall"
              : "Failed to create stall")
        );
      }

      toast.success(
        editingStall
          ? "Stall updated successfully"
          : "Stall created successfully"
      );

      setShowModal(false);
      setEditingStall(null);
      setForm({ ...emptyForm });

      await loadStalls();
    } catch (error) {
      console.error("Save stall error:", error);

      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to save stall"
      );
    } finally {
      setSaving(false);
    }
  };

  const deleteStall = async (stall: Stall) => {
    const confirmed = window.confirm(
      `Are you sure you want to delete "${stall.name}"?`
    );

    if (!confirmed) return;

    try {
      const response = await fetch(
        `${API_URL}/admin/stalls/${stall._id}`,
        {
          method: "DELETE",
          headers: getHeaders(),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data?.detail || "Failed to delete stall"
        );
      }

      toast.success("Stall deleted successfully");

      await loadStalls();
    } catch (error) {
      console.error("Delete stall error:", error);

      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to delete stall"
      );
    }
  };

  const toggleOpen = async (stall: Stall) => {
    try {
      const response = await fetch(
        `${API_URL}/admin/stalls/${stall._id}`,
        {
          method: "PUT",
          headers: getHeaders(),
          body: JSON.stringify({
            name: stall.name,
            image: stall.image || "",
            description: stall.description || "",
            is_open: !stall.is_open,
            active: stall.active,
            owner_email: stall.owner_email || null,
          }),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data?.detail || "Failed to update stall"
        );
      }

      toast.success(
        stall.is_open
          ? `${stall.name} closed`
          : `${stall.name} opened`
      );

      await loadStalls();
    } catch (error) {
      console.error("Toggle stall error:", error);

      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to update stall"
      );
    }
  };

  const filteredStalls = stalls;

  return (
    <div className="min-h-full bg-[var(--background)] p-6 text-white lg:p-8">
      {/* Header */}
      <div className="mb-8 flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand/15">
            <Store
              className="text-brand"
              size={25}
            />
          </div>

          <div>
            <h1 className="text-3xl font-bold">
              Stall Management
            </h1>

            <p className="mt-1 text-sm text-zinc-500">
              Manage campus food stalls and their availability
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={openCreateModal}
          className="flex items-center justify-center gap-2 rounded-2xl bg-brand px-5 py-3 font-semibold text-white transition hover:bg-brand-hover"
        >
          <Plus size={20} />
          Add Stall
        </button>
      </div>

      {/* Controls */}
      <div className="mb-6 rounded-3xl border border-zinc-800 bg-[var(--surface)] p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="relative w-full lg:max-w-md">
            <Search
              size={19}
              className="absolute left-3 top-3 text-zinc-500"
            />

            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  loadStalls();
                }
              }}
              placeholder="Search stalls..."
              className="w-full rounded-xl border border-zinc-700 bg-zinc-900 py-2.5 pl-10 pr-4 text-white outline-none placeholder:text-zinc-600 focus:border-brand"
            />
          </div>

          <div className="flex flex-wrap gap-2">
            {["ALL", "ACTIVE", "INACTIVE"].map((filter) => (
              <button
                key={filter}
                type="button"
                onClick={() => setStatusFilter(filter)}
                className={`rounded-xl px-4 py-2 text-sm font-medium transition ${
                  statusFilter === filter
                    ? "bg-brand text-white"
                    : "bg-zinc-900 text-zinc-400 hover:bg-zinc-800 hover:text-white"
                }`}
              >
                {filter === "ALL"
                  ? "All"
                  : filter === "ACTIVE"
                    ? "Active"
                    : "Inactive"}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-3xl border border-zinc-800 bg-[var(--surface)] p-5">
          <p className="text-sm text-zinc-500">
            Total Stalls
          </p>

          <p className="mt-2 text-3xl font-bold">
            {stalls.length}
          </p>
        </div>

        <div className="rounded-3xl border border-zinc-800 bg-[var(--surface)] p-5">
          <p className="text-sm text-zinc-500">
            Active Stalls
          </p>

          <p className="mt-2 text-3xl font-bold text-green-400">
            {
              stalls.filter(
                (stall) => stall.active
              ).length
            }
          </p>
        </div>

        <div className="rounded-3xl border border-zinc-800 bg-[var(--surface)] p-5">
          <p className="text-sm text-zinc-500">
            Currently Open
          </p>

          <p className="mt-2 text-3xl font-bold text-brand">
            {
              stalls.filter(
                (stall) =>
                  stall.active && stall.is_open
              ).length
            }
          </p>
        </div>
      </div>

      {/* Stall Grid */}
      {loading ? (
        <div className="flex min-h-[300px] items-center justify-center rounded-3xl border border-zinc-800 bg-[var(--surface)]">
          <p className="text-zinc-500">
            Loading stalls...
          </p>
        </div>
      ) : filteredStalls.length === 0 ? (
        <div className="flex min-h-[350px] flex-col items-center justify-center rounded-3xl border border-dashed border-zinc-700 bg-[var(--surface)] text-center">
          <Store
            size={50}
            className="mb-4 text-zinc-700"
          />

          <h2 className="text-xl font-semibold">
            No stalls found
          </h2>

          <p className="mt-2 max-w-md text-sm text-zinc-500">
            Create your first campus food stall to
            start managing stall availability.
          </p>

          <button
            type="button"
            onClick={openCreateModal}
            className="mt-5 rounded-xl bg-brand px-5 py-2.5 font-medium hover:bg-brand-hover"
          >
            Add First Stall
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
          {filteredStalls.map((stall) => (
            <div
              key={stall._id}
              className="overflow-hidden rounded-3xl border border-zinc-800 bg-[var(--surface)]"
            >
              <div className="relative h-48 bg-zinc-900">
                {stall.image ? (
                  <img
                    src={getImageUrl(stall.image)}
                    alt={stall.name}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full items-center justify-center">
                    <Store
                      size={55}
                      className="text-zinc-700"
                    />
                  </div>
                )}

                <div className="absolute right-4 top-4">
                  <span
                    className={`rounded-full px-3 py-1.5 text-xs font-semibold ${
                      stall.active
                        ? "bg-green-500/20 text-green-400"
                        : "bg-red-500/20 text-red-400"
                    }`}
                  >
                    {stall.active
                      ? "Active"
                      : "Inactive"}
                  </span>
                </div>
              </div>

              <div className="p-5">
                <h3 className="text-xl font-semibold">
                  {stall.name}
                </h3>

                <p className="mt-2 min-h-[40px] text-sm text-zinc-500">
                  {stall.description ||
                    "No description available"}
                </p>

                {stall.owner_email && (
                  <div className="mt-3 rounded-xl bg-zinc-900 px-3 py-2">
                    <p className="text-xs text-zinc-500">
                      Vendor
                    </p>

                    <p className="mt-1 truncate text-sm text-zinc-300">
                      {stall.owner_email}
                    </p>
                  </div>
                )}

                <div className="mt-5 flex items-center justify-between rounded-2xl bg-zinc-900 p-3">
                  <div className="flex items-center gap-2">
                    <DoorOpen
                      size={18}
                      className={
                        stall.is_open
                          ? "text-green-400"
                          : "text-red-400"
                      }
                    />

                    <span className="text-sm text-zinc-400">
                      Status
                    </span>
                  </div>

                  <span
                    className={`text-sm font-semibold ${
                      stall.is_open
                        ? "text-green-400"
                        : "text-red-400"
                    }`}
                  >
                    {stall.is_open
                      ? "Open"
                      : "Closed"}
                  </span>
                </div>

                <div className="mt-4 grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => toggleOpen(stall)}
                    className="flex items-center justify-center gap-2 rounded-xl bg-zinc-900 px-3 py-2.5 text-sm text-zinc-300 transition hover:bg-zinc-800 hover:text-white"
                  >
                    <Power size={16} />

                    {stall.is_open
                      ? "Close"
                      : "Open"}
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      openEditModal(stall)
                    }
                    className="flex items-center justify-center gap-2 rounded-xl bg-blue-500/10 px-3 py-2.5 text-sm text-blue-400 transition hover:bg-blue-500/20"
                  >
                    <Pencil size={16} />
                    Edit
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      deleteStall(stall)
                    }
                    className="flex items-center justify-center gap-2 rounded-xl bg-red-500/10 px-3 py-2.5 text-sm text-red-400 transition hover:bg-red-500/20"
                  >
                    <Trash2 size={16} />
                    Delete
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-4 backdrop-blur-sm sm:items-center">
          <div className="flex w-full max-w-xl flex-col rounded-3xl border border-zinc-800 bg-[var(--surface)] shadow-2xl sm:max-h-[calc(100vh-2rem)]">
            {/* Modal Header */}
            <div className="flex shrink-0 items-center justify-between border-b border-zinc-800 p-6">
              <div>
                <h2 className="text-xl font-bold">
                  {editingStall
                    ? "Edit Stall"
                    : "Add Stall"}
                </h2>

                <p className="mt-1 text-sm text-zinc-500">
                  {editingStall
                    ? "Update stall information"
                    : "Create a new campus food stall"}
                </p>
              </div>

              <button
                type="button"
                onClick={closeModal}
                className="rounded-xl p-2 text-zinc-500 hover:bg-zinc-800 hover:text-white"
              >
                <X size={20} />
              </button>
            </div>

            {/* Modal Body */}
            <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-6">
              {/* Stall Name */}
              <div>
                <label className="mb-2 block text-sm font-medium text-zinc-300">
                  Stall Name
                </label>

                <input
                  value={form.name}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      name: e.target.value,
                    })
                  }
                  placeholder="Example: Main Canteen"
                  className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-3 text-white outline-none placeholder:text-zinc-600 focus:border-brand"
                />
              </div>

              {/* Stall Vendor */}
              <div>
                <label className="mb-2 block text-sm font-medium text-zinc-300">
                  Stall Vendor
                </label>

                <select
                  value={form.owner_email}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      owner_email: e.target.value,
                    })
                  }
                  className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-3 text-white outline-none focus:border-brand"
                >
                  <option value="">
                    Select a vendor
                  </option>

                  {vendors.map((vendor) => (
                    <option
                      key={vendor.email}
                      value={vendor.email}
                    >
                      {vendor.name} — {vendor.email}
                    </option>
                  ))}
                </select>

                {vendors.length === 0 && (
                  <p className="mt-2 text-xs text-zinc-500">
                    No VENDOR users available. Create
                    or assign a vendor account first.
                  </p>
                )}
              </div>
              {/* Preparation Time */}
<div>
  <label className="mb-2 block text-sm font-medium text-zinc-300">
    Preparation Time (minutes)
  </label>

  <input
    type="number"
    min="1"
    value={form.preparation_time}
    onChange={(e) =>
      setForm({
        ...form,
        preparation_time: e.target.value,
      })
    }
    placeholder="Example: 15"
    className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-3 text-white outline-none placeholder:text-zinc-600 focus:border-brand"
  />

  <p className="mt-2 text-xs text-zinc-500">
    Estimated time this stall needs to prepare an order.
  </p>
</div>

              {/* Stall Image Upload */}
              <div>
                <label className="mb-2 block text-sm font-medium text-zinc-300">
                  Stall Image
                </label>

                <div className="rounded-2xl border border-dashed border-zinc-700 bg-zinc-900/60 p-4">
                  <input
                    type="file"
                    accept="image/*"
                    disabled={uploadingImage}
                    onChange={(e) => {
                      const file = e.currentTarget.files?.[0];

                      if (file) {
                        void uploadStallImage(file);
                      }

                      e.currentTarget.value = "";
                    }}
                    className="block w-full cursor-pointer text-sm text-zinc-400 file:mr-4 file:cursor-pointer file:rounded-xl file:border-0 file:bg-brand file:px-4 file:py-2.5 file:font-semibold file:text-white hover:file:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-50"
                  />

                  <p className="mt-3 text-xs text-zinc-500">
                    Choose an image from your computer. The image will be uploaded securely before you save the stall.
                  </p>

                  {uploadingImage && (
                    <p className="mt-3 text-sm font-medium text-brand">
                      Uploading image...
                    </p>
                  )}

                  {form.image && (
                    <div className="mt-4">
                      <p className="mb-2 text-xs font-medium text-zinc-400">
                        Image Preview
                      </p>

                      <img
                        key={form.image}
                        src={getImageUrl(form.image)}
                        alt="Stall image preview"
                        className="h-40 w-full rounded-xl border border-zinc-700 object-cover"
                        onError={(e) => {
                          e.currentTarget.style.display = "none";
                          toast.error("The image preview could not be loaded.");
                        }}
                      />

                      <p className="mt-2 break-all text-xs text-zinc-500">
                        Image uploaded and ready to save.
                      </p>
                    </div>
                  )}
                </div>
              </div>

              {/* Description */}
              <div>
                <label className="mb-2 block text-sm font-medium text-zinc-300">
                  Description
                </label>

                <textarea
                  value={form.description}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      description: e.target.value,
                    })
                  }
                  rows={4}
                  placeholder="Describe this stall..."
                  className="w-full resize-none rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-3 text-white outline-none placeholder:text-zinc-600 focus:border-brand"
                />
              </div>

              {/* Toggles */}
              <div className="grid grid-cols-2 gap-4">
                <label className="flex cursor-pointer items-center justify-between rounded-2xl bg-zinc-900 p-4">
                  <div>
                    <p className="font-medium">
                      Stall Open
                    </p>

                    <p className="text-xs text-zinc-500">
                      Accept orders
                    </p>
                  </div>

                  <input
                    type="checkbox"
                    checked={form.is_open}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        is_open: e.target.checked,
                      })
                    }
                    className="h-5 w-5 accent-brand"
                  />
                </label>

                <label className="flex cursor-pointer items-center justify-between rounded-2xl bg-zinc-900 p-4">
                  <div>
                    <p className="font-medium">
                      Active
                    </p>

                    <p className="text-xs text-zinc-500">
                      Show in system
                    </p>
                  </div>

                  <input
                    type="checkbox"
                    checked={form.active}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        active: e.target.checked,
                      })
                    }
                    className="h-5 w-5 accent-brand"
                  />
                </label>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="flex shrink-0 justify-end gap-3 border-t border-zinc-800 p-6">
              <button
                type="button"
                onClick={closeModal}
                disabled={saving}
                className="rounded-xl bg-zinc-800 px-5 py-2.5 text-sm font-medium text-zinc-300 hover:bg-zinc-700 disabled:opacity-50"
              >
                Cancel
              </button>

              <button
                type="button"
                onClick={saveStall}
                disabled={saving || uploadingImage}
                className="rounded-xl bg-brand px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-50"
              >
                {uploadingImage
                  ? "Uploading Image..."
                  : saving
                  ? "Saving..."
                  : editingStall
                    ? "Update Stall"
                    : "Create Stall"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}