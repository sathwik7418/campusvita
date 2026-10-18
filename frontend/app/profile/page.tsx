"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import { toast } from "react-hot-toast";

import {
  Camera,
  CheckCircle2,
  ChevronRight,
  Heart,
  HelpCircle,
  Home,
  IndianRupee,
  LogOut,
  Mail,
  Pencil,
  Phone,
  Receipt,
  RefreshCw,
  Settings,
  Share2,
  ShoppingBag,
  User,
  X,
} from "lucide-react";

import { TelegramHeader } from "@/components/ui/telegram-profile-header";
import { getImageUrl } from "@/app/lib/getImageUrl";
import {
  getAccessToken,
  clearSession,
} from "@/app/lib/auth/session";

const API_URL =
  process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000";

/* ============================================================
   PROFILE TYPE
============================================================ */

type Profile = {
  name: string;
  email: string;
  phone: string;
  profile_image: string;
  total_orders: number;
  total_spent: number;
  is_verified: boolean;
  notifications: boolean;
  theme: string;
};

/* ============================================================
   EMPTY PROFILE
============================================================ */

const EMPTY: Profile = {
  name: "",
  email: "",
  phone: "",
  profile_image: "",
  total_orders: 0,
  total_spent: 0,
  is_verified: false,
  notifications: true,
  theme: "dark",
};

/* ============================================================
   API ERROR HELPER
============================================================ */

function apiError(value: unknown, fallback: string) {
  if (typeof value === "string" && value) {
    return value;
  }

  if (Array.isArray(value)) {
    return (
      value
        .map((x) => {
          if (typeof x === "string") return x;

          if (x && typeof x === "object") {
            const o = x as Record<string, unknown>;

            return String(
              o.msg ||
                o.message ||
                o.detail ||
                ""
            );
          }

          return "";
        })
        .filter(Boolean)
        .join(", ") || fallback
    );
  }

  if (value && typeof value === "object") {
    const o = value as Record<string, unknown>;

    return String(
      o.detail ||
        o.message ||
        o.error ||
        fallback
    );
  }

  return fallback;
}

/* ============================================================
   SKELETON
============================================================ */

function Skeleton({
  className,
}: {
  className: string;
}) {
  return (
    <div
      className={`
        animate-pulse rounded-2xl
        bg-[var(--surface-secondary)]
        ${className}
      `}
    />
  );
}

/* ============================================================
   PROFILE PAGE
============================================================ */

export default function ProfilePage() {
  const router = useRouter();

  const fileRef =
    useRef<HTMLInputElement>(null);

  const [profile, setProfile] =
    useState<Profile>(EMPTY);

  const [draft, setDraft] =
    useState<Profile>(EMPTY);

  const [loading, setLoading] =
    useState(true);

  const [error, setError] =
    useState("");

  const [saving, setSaving] =
    useState(false);

  const [uploading, setUploading] =
    useState(false);

  const [editOpen, setEditOpen] =
    useState(false);

  const [editField, setEditField] =
    useState<
      keyof Pick<
        Profile,
        "name" | "email" | "phone"
      > | null
    >(null);

  const [logoutOpen, setLogoutOpen] =
    useState(false);

  const [version, setVersion] =
    useState<any>(null);

  const [versionError, setVersionError] =
    useState("");

  const [shareBusy, setShareBusy] =
    useState(false);

  /* ============================================================
     CLEAR USER AUTH
  ============================================================ */

  const clearAuth = useCallback(() => {
    clearSession("USER");
  }, []);

  /* ============================================================
     LOAD REAL USER PROFILE
  ============================================================ */

  const loadProfile = useCallback(async () => {
    const token =
      getAccessToken("USER");

    if (!token) {
      router.replace("/login");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const res = await fetch(
        `${API_URL}/profile`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
          cache: "no-store",
        }
      );

      const data =
        await res.json().catch(() => null);

      if (res.status === 401) {
        clearAuth();
        router.replace("/login");
        return;
      }

      if (!res.ok) {
        throw new Error(
          apiError(
            data,
            "Unable to load profile"
          )
        );
      }

      const s =
        data?.profile &&
        typeof data.profile === "object"
          ? data.profile
          : data;

      const next: Profile = {
        name: String(s?.name ?? ""),
        email: String(s?.email ?? ""),
        phone: String(s?.phone ?? ""),
        profile_image: String(
          s?.profile_image ?? ""
        ),
        total_orders: Number(
          s?.total_orders ?? 0
        ),
        total_spent: Number(
          s?.total_spent ?? 0
        ),
        is_verified: Boolean(
          s?.is_verified ??
            s?.verified ??
            false
        ),
        notifications:
          s?.notifications !== false,
        theme: String(
          s?.theme ?? "dark"
        ),
      };

      setProfile(next);
      setDraft(next);
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Unable to load profile"
      );
    } finally {
      setLoading(false);
    }
  }, [clearAuth, router]);

  useEffect(() => {
    void loadProfile();
  }, [loadProfile]);

  /* ============================================================
     APP VERSION
  ============================================================ */

  useEffect(() => {
    fetch("/api/app-version", {
      cache: "no-store",
    })
      .then(async (r) => {
        const d =
          await r.json().catch(() => null);

        if (!r.ok) {
          throw new Error(
            apiError(
              d,
              "Unable to check for updates"
            )
          );
        }

        setVersion(d);
      })
      .catch((e) => {
        setVersionError(
          e instanceof Error
            ? e.message
            : "Unable to check for updates"
        );
      });
  }, []);

  /* ============================================================
     PROFILE INITIALS
  ============================================================ */

  const initials = useMemo(() => {
    const parts = profile.name
      .trim()
      .split(/\s+/)
      .filter(Boolean);

    return (
      parts
        .slice(0, 2)
        .map((x) => x[0])
        .join("") || "CV"
    ).toUpperCase();
  }, [profile.name]);

  /* ============================================================
     OPEN EDIT
  ============================================================ */

  const openEdit = (
    field?: typeof editField
  ) => {
    setDraft(profile);
    setEditField(field ?? null);
    setEditOpen(true);
  };

  /* ============================================================
     SAVE PROFILE
  ============================================================ */

  const saveProfile = async () => {
    const token =
      getAccessToken("USER");

    if (!token) {
      router.replace("/login");
      return;
    }

    if (!draft.name.trim()) {
      toast.error("Name is required.");
      return;
    }

    if (
      draft.phone &&
      !/^[6789]\d{9}$/.test(
        draft.phone.trim()
      )
    ) {
      toast.error(
        "Enter a valid 10-digit Indian mobile number."
      );
      return;
    }

    setSaving(true);

    try {
      const res = await fetch(
        `${API_URL}/profile`,
        {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type":
              "application/json",
          },
          body: JSON.stringify({
            name: draft.name.trim(),
            phone: draft.phone.trim(),
            profile_image:
              profile.profile_image,
            notifications:
              profile.notifications,
            theme: profile.theme,
          }),
        }
      );

      const data =
        await res.json().catch(() => null);

      if (res.status === 401) {
        clearAuth();
        router.replace("/login");
        return;
      }

      if (!res.ok) {
        throw new Error(
          apiError(
            data,
            "Failed to update profile"
          )
        );
      }

      const s =
        data?.profile &&
        typeof data.profile === "object"
          ? data.profile
          : data;

      const next: Profile = {
        ...profile,
        name: String(
          s?.name ?? draft.name
        ),
        email: String(
          s?.email ?? profile.email
        ),
        phone: String(
          s?.phone ?? draft.phone
        ),
        profile_image: String(
          s?.profile_image ??
            profile.profile_image
        ),
        notifications:
          s?.notifications ??
          profile.notifications,
        theme: String(
          s?.theme ??
            profile.theme
        ),
      };

      setProfile(next);
      setDraft(next);

      setEditOpen(false);
      setEditField(null);

      toast.success(
        "Profile updated successfully"
      );
    } catch (e) {
      toast.error(
        e instanceof Error
          ? e.message
          : "Failed to update profile"
      );
    } finally {
      setSaving(false);
    }
  };

  /* ============================================================
     PROFILE IMAGE UPLOAD
  ============================================================ */

  const uploadImage = async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];

    e.target.value = "";

    if (!file) return;

    if (
      !file.type.startsWith("image/")
    ) {
      toast.error(
        "Please choose an image."
      );
      return;
    }

    if (
      file.size >
      5 * 1024 * 1024
    ) {
      toast.error(
        "Image must be smaller than 5 MB."
      );
      return;
    }

    const token =
      getAccessToken("USER");

    if (!token) {
      router.replace("/login");
      return;
    }

    setUploading(true);

    try {
      const fd = new FormData();

      fd.append("file", file);

      const res = await fetch(
        `${API_URL}/profile/upload-image`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
          },
          body: fd,
        }
      );

      const data =
        await res.json().catch(() => null);

      if (res.status === 401) {
        clearAuth();
        router.replace("/login");
        return;
      }

      if (!res.ok) {
        throw new Error(
          apiError(
            data,
            "Failed to upload profile image"
          )
        );
      }

      const url = String(
        data?.image_url ??
          data?.profile_image ??
          data?.url ??
          ""
      );

      if (!url) {
        throw new Error(
          "The server did not return an image URL."
        );
      }

      setProfile((p) => ({
        ...p,
        profile_image: url,
      }));

      setDraft((p) => ({
        ...p,
        profile_image: url,
      }));

      toast.success(
        "Profile photo updated"
      );
    } catch (e) {
      toast.error(
        e instanceof Error
          ? e.message
          : "Upload failed"
      );
    } finally {
      setUploading(false);
    }
  };

  /* ============================================================
     SHARE APP
  ============================================================ */

  const shareApp = async () => {
    if (shareBusy) return;

    setShareBusy(true);

    try {
      const shareData = {
        title: "CampusVita",
        text: "Smart Campus Food Ordering App",
        url: window.location.origin,
      };

      if (navigator.share) {
        await navigator.share(
          shareData
        );
      } else {
        await navigator.clipboard.writeText(
          shareData.url
        );

        toast.success(
          "CampusVita link copied"
        );
      }
    } catch (e) {
      if (
        !(
          e instanceof DOMException &&
          e.name === "AbortError"
        )
      ) {
        toast.error(
          "Unable to share the app"
        );
      }
    } finally {
      setShareBusy(false);
    }
  };

  /* ============================================================
     LOGOUT
  ============================================================ */

  const logout = () => {
    clearSession("USER");

    setLogoutOpen(false);

    router.replace("/login");
  };

  /* ============================================================
     LOADING SCREEN
  ============================================================ */

  if (loading) {
    return (
      <main className="min-h-screen bg-[var(--background)] px-4 pb-10 pt-6 text-[var(--text-primary)] sm:px-5">
        <div className="mx-auto max-w-3xl space-y-5">

          <div className="flex items-center justify-between">
            <Skeleton className="h-9 w-36" />
            <Skeleton className="h-10 w-10 rounded-xl" />
          </div>

          <Skeleton className="h-48 rounded-3xl" />

          <Skeleton className="h-6 w-40" />

          <div className="grid grid-cols-2 gap-4">
            <Skeleton className="h-32 rounded-3xl" />
            <Skeleton className="h-32 rounded-3xl" />
          </div>

          <Skeleton className="h-20 rounded-3xl" />
          <Skeleton className="h-56 rounded-3xl" />
          <Skeleton className="h-64 rounded-3xl" />
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[var(--background)] px-3 pb-[96px] pt-5 text-[var(--text-primary)] transition-colors duration-200 sm:px-5 sm:pt-8 md:pb-10">

      <div className="mx-auto max-w-3xl">

        {/* ======================================================
            HEADER
        ====================================================== */}

        <header className="mb-6 flex items-center justify-between">

          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--brand)]">
              Account
            </p>

            <h1 className="mt-1 text-2xl font-extrabold tracking-tight sm:text-3xl">
              Profile
            </h1>

            <p className="mt-1 text-sm text-[var(--text-secondary)]">
              Manage your CampusVita account.
            </p>
          </div>

          <button
            type="button"
            onClick={() =>
              router.push("/settings")
            }
            aria-label="Open settings"
            className="
              flex h-11 w-11 items-center justify-center
              rounded-xl
              border border-[var(--border)]
              bg-[var(--surface)]
              text-[var(--text-secondary)]
              shadow-sm
              transition
              hover:border-[var(--brand)]
              hover:bg-[var(--brand-soft)]
              hover:text-[var(--brand)]
              active:scale-95
              focus:outline-none
              focus:ring-2
              focus:ring-[var(--brand)]
            "
          >
            <Settings size={21} />
          </button>

        </header>

        {/* ======================================================
            ERROR
        ====================================================== */}

        {error && (
          <div
            className="
              mb-5 rounded-3xl
              border border-red-500/25
              bg-red-500/10
              p-5
            "
          >
            <div className="flex items-start gap-3">

              <div className="mt-0.5 text-red-500">
                <RefreshCw size={19} />
              </div>

              <div className="min-w-0 flex-1">

                <p className="font-semibold">
                  Unable to load profile
                </p>

                <p className="mt-1 text-sm text-[var(--text-secondary)]">
                  {error}
                </p>

                <button
                  type="button"
                  onClick={() =>
                    void loadProfile()
                  }
                  className="
                    mt-4 inline-flex items-center gap-2
                    rounded-xl
                    border border-[var(--brand)]
                    px-4 py-2
                    text-sm font-semibold
                    text-[var(--brand)]
                    transition
                    hover:bg-[var(--brand-soft)]
                    active:scale-95
                  "
                >
                  <RefreshCw size={15} />
                  Retry
                </button>

              </div>
            </div>
          </div>
        )}

        {/* ======================================================
            PROFILE HERO — ANIMATED TELEGRAM-STYLE HEADER
        ====================================================== */}

        <section
          className="
            relative overflow-hidden rounded-[28px]
            border border-[var(--border)]
            bg-[var(--surface)]
            shadow-[var(--shadow-card)]
          "
        >
          <div className="relative">
            <TelegramHeader
              avatar={
                profile.profile_image
                  ? getImageUrl(profile.profile_image)
                  : ""
              }
              name={profile.name || "Not added"}
              phone={profile.phone || "Phone number not added"}
              username={profile.email || "Email not available"}
              actionButton={{
                text: "Edit",
                onClick: () => openEdit(),
                backgroundColor: "var(--brand)",
              }}
            />

            {/* Existing profile verification status */}
            {profile.is_verified && (
              <div className="flex justify-center px-4 pb-3">
                <span
                  className="
                    inline-flex items-center gap-1.5
                    rounded-full
                    bg-[var(--brand-soft)]
                    px-3 py-1.5
                    text-xs font-bold
                    text-[var(--brand)]
                  "
                >
                  <CheckCircle2 size={14} />
                  Verified account
                </span>
              </div>
            )}

            {/* Existing profile photo upload — retained */}
            <div className="flex flex-wrap items-center justify-center gap-3 border-t border-[var(--border)] px-4 py-4 sm:px-6">
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                capture="environment"
                onChange={uploadImage}
                className="hidden"
              />

              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
                aria-label="Change profile photo"
                className="
                  inline-flex min-h-10 items-center justify-center gap-2
                  rounded-xl border border-[var(--border)]
                  bg-[var(--surface-secondary)]
                  px-4 py-2.5
                  text-sm font-semibold text-[var(--text-primary)]
                  transition hover:border-[var(--brand)]
                  hover:bg-[var(--brand-soft)]
                  hover:text-[var(--brand)]
                  active:scale-[0.98]
                  disabled:cursor-not-allowed disabled:opacity-60
                  focus:outline-none focus:ring-2
                  focus:ring-[var(--brand)]
                "
              >
                {uploading ? (
                  <RefreshCw size={16} className="animate-spin" />
                ) : (
                  <Camera size={16} />
                )}
                {uploading ? "Uploading photo…" : "Change profile photo"}
              </button>

              <button
                type="button"
                onClick={() => openEdit()}
                className="
                  inline-flex min-h-10 items-center justify-center gap-2
                  rounded-xl bg-[var(--brand)]
                  px-4 py-2.5 text-sm font-semibold text-white
                  transition hover:brightness-95 active:scale-[0.98]
                  focus:outline-none focus:ring-2
                  focus:ring-[var(--brand)]
                  focus:ring-offset-2
                  focus:ring-offset-[var(--surface)]
                "
              >
                <Pencil size={15} />
                Edit profile details
              </button>
            </div>
          </div>
        </section>

        {/* ======================================================
            ACTIVITY
        ====================================================== */}

        <section className="mt-7">

          <div className="mb-3 flex items-end justify-between px-1">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--brand)]">
                Overview
              </p>

              <h2 className="mt-1 text-xl font-extrabold">
                Your Activity
              </h2>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:gap-4">

            <StatCard
              icon={<ShoppingBag size={22} />}
              value={String(
                profile.total_orders || 0
              )}
              label="Total Orders"
            />

            <StatCard
              icon={<IndianRupee size={22} />}
              value={`₹${Number(
                profile.total_spent || 0
              ).toLocaleString("en-IN")}`}
              label="Total Spent"
            />

          </div>
        </section>

        {/* ======================================================
            APP VERSION
        ====================================================== */}

        <button
          type="button"
          onClick={() =>
            version?.updateAvailable &&
            version.updateUrl
              ? window.open(
                  version.updateUrl,
                  "_blank",
                  "noopener,noreferrer"
                )
              : undefined
          }
          disabled={!version?.updateAvailable}
          className="
            mt-5 flex w-full items-center gap-4
            rounded-[24px]
            border border-[var(--border)]
            bg-[var(--surface)]
            p-4 text-left
            shadow-[var(--shadow-card)]
            transition
            hover:border-[var(--brand)]
            hover:bg-[var(--surface-secondary)]
            disabled:cursor-default
          "
        >

          <div
            className="
              flex h-12 w-12 shrink-0 items-center justify-center
              rounded-2xl
              bg-[var(--brand-soft)]
              text-[var(--brand)]
            "
          >
            <RefreshCw
              size={21}
              className={
                version?.updateAvailable
                  ? "animate-pulse"
                  : ""
              }
            />
          </div>

          <div className="min-w-0 flex-1">

            <p className="text-sm font-bold">
              {version?.updateAvailable
                ? "App update available"
                : versionError
                  ? "Update check unavailable"
                  : "You're up to date"}
            </p>

            <p className="mt-1 truncate text-xs text-[var(--text-secondary)]">
              {versionError ||
                (version?.updateAvailable
                  ? `A newer version ${version.latestVersion} is available`
                  : `Current version ${
                      version?.currentVersion ??
                      "Not available"
                    }`)}
            </p>

          </div>

          <ChevronRight
            size={20}
            className="shrink-0 text-[var(--text-muted)]"
          />

        </button>

        {/* ======================================================
            ABOUT YOU
        ====================================================== */}

        <section className="mt-7">

          <SectionHeading
            eyebrow="Personal"
            title="About You"
          />

          <div
            className="
              overflow-hidden rounded-[24px]
              border border-[var(--border)]
              bg-[var(--surface)]
              shadow-[var(--shadow-card)]
            "
          >

            <InfoRow
              icon={<User size={20} />}
              label="Full Name"
              value={profile.name}
              onClick={() =>
                openEdit("name")
              }
            />

            <InfoRow
              icon={<Mail size={20} />}
              label="Email"
              value={profile.email}
              onClick={() =>
                openEdit("email")
              }
            />

            <InfoRow
              icon={<Phone size={20} />}
              label="Phone Number"
              value={profile.phone}
              onClick={() =>
                openEdit("phone")
              }
              last
            />

          </div>
        </section>

        {/* ======================================================
            ACCOUNT
        ====================================================== */}

        <section className="mt-7">

          <SectionHeading
            eyebrow="More"
            title="Account"
          />

          <div
            className="
              overflow-hidden rounded-[24px]
              border border-[var(--border)]
              bg-[var(--surface)]
              shadow-[var(--shadow-card)]
            "
          >

            <AccountRow
              icon={<Heart size={21} />}
              title="Favorites"
              subtitle="Your saved food items"
              href="/favorites"
            />

            <AccountRow
              icon={<Receipt size={21} />}
              title="Payment History"
              subtitle="View your transactions"
              href="/wallet/transactions"
            />

            <AccountRow
              icon={<HelpCircle size={21} />}
              title="About Us"
              subtitle="Learn more about CampusVita"
              href="/about"
            />

            <button
              type="button"
              onClick={shareApp}
              disabled={shareBusy}
              className="
                flex w-full items-center gap-3
                border-t border-[var(--border)]
                px-4 py-4 text-left
                transition
                hover:bg-[var(--surface-secondary)]
                disabled:opacity-60
              "
            >

              <span className="text-[var(--brand)]">
                {shareBusy ? (
                  <RefreshCw
                    size={21}
                    className="animate-spin"
                  />
                ) : (
                  <Share2 size={21} />
                )}
              </span>

              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold">
                  Share the App
                </span>

                <span className="mt-0.5 block text-xs text-[var(--text-secondary)]">
                  Invite your friends to CampusVita
                </span>
              </span>

              <ChevronRight
                size={20}
                className="text-[var(--text-muted)]"
              />

            </button>

          </div>
        </section>

        {/* ======================================================
            LOGOUT
        ====================================================== */}

        <button
          type="button"
          onClick={() =>
            setLogoutOpen(true)
          }
          className="
            mt-5 flex w-full items-center justify-center gap-2
            rounded-[20px]
            border border-red-500/20
            bg-[var(--surface)]
            py-3.5
            font-semibold
            text-red-500
            shadow-sm
            transition
            hover:border-red-500/40
            hover:bg-red-500/5
            active:scale-[0.99]
          "
        >
          <LogOut size={20} />
          Logout
        </button>

        {/* ======================================================
            MOBILE BOTTOM NAVIGATION
        ====================================================== */}

        <nav
          className="
            fixed bottom-0 left-0 right-0 z-40
            border-t border-[var(--border)]
            bg-[var(--surface)]/95
            pb-[env(safe-area-inset-bottom)]
            backdrop-blur-xl
            md:hidden
          "
        >
          <div className="mx-auto grid h-[68px] max-w-md grid-cols-3">

            <Bottom
              href="/"
              icon={<Home size={22} />}
              label="Home"
            />

            <Bottom
              href="/orders"
              icon={<ShoppingBag size={22} />}
              label="Orders"
            />

            <Bottom
              href="/profile"
              icon={<User size={22} />}
              label="Profile"
              active
            />

          </div>
        </nav>

        {/* ======================================================
            EDIT PROFILE MODAL
        ====================================================== */}

        {editOpen && (
          <Modal
            onClose={() =>
              !saving &&
              setEditOpen(false)
            }
          >

            <div
              className="
                flex items-center justify-between
                border-b border-[var(--border)]
                px-5 py-5
              "
            >
              <div>
                <h2 className="text-lg font-bold">
                  Edit Profile
                </h2>

                <p className="mt-1 text-xs text-[var(--text-secondary)]">
                  Changes are saved to your authenticated account.
                </p>
              </div>

              <button
                type="button"
                onClick={() =>
                  setEditOpen(false)
                }
                aria-label="Close"
                disabled={saving}
                className="
                  rounded-xl p-2
                  text-[var(--text-secondary)]
                  transition
                  hover:bg-[var(--surface-secondary)]
                  hover:text-[var(--text-primary)]
                  disabled:opacity-50
                "
              >
                <X size={20} />
              </button>
            </div>

            <div className="space-y-4 p-5">

              <Field
                label="Full Name"
                value={draft.name}
                onChange={(v) =>
                  setDraft({
                    ...draft,
                    name: v,
                  })
                }
                show={
                  editField === null ||
                  editField === "name"
                }
              />

              <Field
                label="Email"
                value={draft.email}
                disabled
                show={
                  editField === null ||
                  editField === "email"
                }
                hint="Email is controlled by the authenticated account."
              />

              <Field
                label="Phone Number"
                value={draft.phone}
                onChange={(v) =>
                  setDraft({
                    ...draft,
                    phone: v
                      .replace(/\D/g, "")
                      .slice(0, 10),
                  })
                }
                show={
                  editField === null ||
                  editField === "phone"
                }
              />

              <div className="flex gap-3 pt-2">

                <button
                  type="button"
                  onClick={() =>
                    setEditOpen(false)
                  }
                  disabled={saving}
                  className="
                    flex-1 rounded-xl
                    border border-[var(--border)]
                    bg-[var(--surface-secondary)]
                    py-3
                    text-sm font-semibold
                    transition
                    hover:bg-[var(--surface)]
                    disabled:opacity-50
                  "
                >
                  Cancel
                </button>

                <button
                  type="button"
                  onClick={() =>
                    void saveProfile()
                  }
                  disabled={
                    saving ||
                    editField === "email"
                  }
                  className="
                    flex-1 rounded-xl
                    bg-[var(--brand)]
                    py-3
                    text-sm font-bold
                    text-white
                    transition
                    hover:brightness-95
                    disabled:opacity-60
                  "
                >
                  {saving
                    ? "Saving..."
                    : editField === "email"
                      ? "Email cannot be changed"
                      : "Save changes"}
                </button>

              </div>
            </div>
          </Modal>
        )}

        {/* ======================================================
            LOGOUT MODAL
        ====================================================== */}

        {logoutOpen && (
          <Modal
            onClose={() =>
              setLogoutOpen(false)
            }
          >
            <div className="p-6 text-center">

              <div
                className="
                  mx-auto flex h-12 w-12 items-center justify-center
                  rounded-2xl
                  bg-red-500/10
                  text-red-500
                "
              >
                <LogOut size={23} />
              </div>

              <h2 className="mt-4 text-lg font-bold">
                Sign out of CampusVita?
              </h2>

              <p className="mt-2 text-sm leading-6 text-[var(--text-secondary)]">
                You will need to sign in again to access your account.
              </p>

              <div className="mt-6 flex gap-3">

                <button
                  type="button"
                  onClick={() =>
                    setLogoutOpen(false)
                  }
                  className="
                    flex-1 rounded-xl
                    border border-[var(--border)]
                    bg-[var(--surface-secondary)]
                    py-3
                    text-sm font-semibold
                    transition
                    hover:bg-[var(--surface)]
                  "
                >
                  Cancel
                </button>

                <button
                  type="button"
                  onClick={logout}
                  className="
                    flex-1 rounded-xl
                    bg-red-500
                    py-3
                    text-sm font-bold
                    text-white
                    transition
                    hover:brightness-95
                  "
                >
                  Logout
                </button>

              </div>
            </div>
          </Modal>
        )}

      </div>
    </main>
  );
}

/* ============================================================
   SECTION HEADING
============================================================ */

function SectionHeading({
  eyebrow,
  title,
}: {
  eyebrow: string;
  title: string;
}) {
  return (
    <div className="mb-3 px-1">
      <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--brand)]">
        {eyebrow}
      </p>

      <h2 className="mt-1 text-xl font-extrabold">
        {title}
      </h2>
    </div>
  );
}

/* ============================================================
   STAT CARD
============================================================ */

function StatCard({
  icon,
  value,
  label,
}: {
  icon: React.ReactNode;
  value: string;
  label: string;
}) {
  return (
    <div
      className="
        rounded-[24px]
        border border-[var(--border)]
        bg-[var(--surface)]
        p-5
        shadow-[var(--shadow-card)]
      "
    >
      <div
        className="
          flex h-10 w-10 items-center justify-center
          rounded-xl
          bg-[var(--brand-soft)]
          text-[var(--brand)]
        "
      >
        {icon}
      </div>

      <p className="mt-4 truncate text-2xl font-extrabold tracking-tight sm:text-3xl">
        {value}
      </p>

      <p className="mt-1 text-sm text-[var(--text-secondary)]">
        {label}
      </p>
    </div>
  );
}

/* ============================================================
   INFO ROW
============================================================ */

function InfoRow({
  icon,
  label,
  value,
  onClick,
  last = false,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  onClick: () => void;
  last?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`
        flex w-full items-center gap-3
        px-4 py-4 text-left
        transition
        hover:bg-[var(--surface-secondary)]
        ${
          last
            ? ""
            : "border-b border-[var(--border)]"
        }
      `}
    >
      <span
        className="
          flex h-9 w-9 shrink-0 items-center justify-center
          rounded-xl
          bg-[var(--surface-secondary)]
          text-[var(--text-secondary)]
        "
      >
        {icon}
      </span>

      <span className="min-w-0 flex-1">

        <span className="block text-sm font-semibold">
          {label}
        </span>

        <span
          className={`
            mt-0.5 block truncate text-sm
            ${
              value
                ? "text-[var(--text-secondary)]"
                : "text-[var(--text-muted)]"
            }
          `}
        >
          {value || "Not added"}
        </span>

      </span>

      <ChevronRight
        size={19}
        className="shrink-0 text-[var(--text-muted)]"
      />
    </button>
  );
}

/* ============================================================
   ACCOUNT ROW
============================================================ */

function AccountRow({
  icon,
  title,
  subtitle,
  href,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  href: string;
}) {
  return (
    <button
      type="button"
      onClick={() =>
        window.location.assign(href)
      }
      className="
        flex w-full items-center gap-3
        border-b border-[var(--border)]
        px-4 py-4 text-left
        transition
        hover:bg-[var(--surface-secondary)]
      "
    >
      <span
        className="
          flex h-10 w-10 shrink-0 items-center justify-center
          rounded-xl
          bg-[var(--brand-soft)]
          text-[var(--brand)]
        "
      >
        {icon}
      </span>

      <span className="min-w-0 flex-1">

        <span className="block text-sm font-semibold">
          {title}
        </span>

        <span className="mt-1 block text-xs text-[var(--text-secondary)]">
          {subtitle}
        </span>

      </span>

      <ChevronRight
        size={20}
        className="shrink-0 text-[var(--text-muted)]"
      />
    </button>
  );
}

/* ============================================================
   BOTTOM NAVIGATION
============================================================ */

function Bottom({
  href,
  icon,
  label,
  active = false,
}: {
  href: string;
  icon: React.ReactNode;
  label: string;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={() =>
        window.location.assign(href)
      }
      className={`
        flex flex-col items-center justify-center gap-1
        text-xs
        transition
        active:scale-95
        ${
          active
            ? "font-semibold text-[var(--brand)]"
            : "text-[var(--text-muted)]"
        }
      `}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

/* ============================================================
   FORM FIELD
============================================================ */

function Field({
  label,
  value,
  onChange,
  disabled = false,
  hint,
  show,
}: {
  label: string;
  value: string;
  onChange?: (v: string) => void;
  disabled?: boolean;
  hint?: string;
  show: boolean;
}) {
  if (!show) return null;

  return (
    <label className="block">

      <span className="mb-1.5 block text-xs font-semibold text-[var(--text-secondary)]">
        {label}
      </span>

      <input
        value={value}
        disabled={disabled}
        onChange={(e) =>
          onChange?.(e.target.value)
        }
        className="
          w-full rounded-xl
          border border-[var(--border)]
          bg-[var(--surface-secondary)]
          px-3.5 py-3
          text-sm
          text-[var(--text-primary)]
          placeholder:text-[var(--text-muted)]
          outline-none
          transition
          focus:border-[var(--brand)]
          focus:bg-[var(--surface)]
          focus:ring-2
          focus:ring-[var(--brand-soft)]
          disabled:cursor-not-allowed
          disabled:text-[var(--text-muted)]
        "
      />

      {hint && (
        <span className="mt-1.5 block text-[11px] leading-5 text-[var(--text-muted)]">
          {hint}
        </span>
      )}

    </label>
  );
}

/* ============================================================
   MODAL
============================================================ */

function Modal({
  children,
  onClose,
}: {
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div
      className="
        fixed inset-0 z-[100]
        flex items-end justify-center
        bg-black/60 p-3
        backdrop-blur-sm
        sm:items-center
      "
    >
      <button
        type="button"
        aria-label="Close dialog"
        onClick={onClose}
        className="absolute inset-0"
      />

      <div
        className="
          relative z-10 w-full max-w-md
          overflow-hidden rounded-[28px]
          border border-[var(--border)]
          bg-[var(--surface)]
          text-[var(--text-primary)]
          shadow-2xl
        "
      >
        {children}
      </div>
    </div>
  );
}