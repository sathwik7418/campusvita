"use client";

import {
  startTransition,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type ReactNode,
} from "react";

import {
  ArrowLeft,
  Camera,
  CheckCircle2,
  Eye,
  EyeOff,
  KeyRound,
  LoaderCircle,
  LogOut,
  Moon,
  ShieldCheck,
  Sun,
  UserRound,
  X,
} from "lucide-react";

import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";

import { TelegramHeader } from "@/components/ui/telegram-profile-header";

import {
  clearSession,
  getSession,
  SESSION_KEYS,
  type SessionUser,
} from "@/app/lib/auth/session";

type ApiError = {
  detail?: string | Array<{ msg?: string }>;
  message?: string;
};

type UploadResponse = {
  success?: boolean;
  message?: string;
  profile_image?: string;
  image_url?: string;
  detail?: string | Array<{ msg?: string }>;
};

export default function VendorProfilePage() {
  const router = useRouter();

  const [vendor, setVendor] = useState<SessionUser | null>(null);

  // Profile image
  const [profileImage, setProfileImage] = useState("");
  const [uploadingImage, setUploadingImage] = useState(false);
  const [imageMessage, setImageMessage] = useState("");
  const [imageError, setImageError] = useState("");

  const profileImageInputRef = useRef<HTMLInputElement>(null);

  // Account-specific theme from the shared theme provider.
  const { resolvedTheme, setTheme } = useTheme();

  // Change password dialog
  const [passwordDialogOpen, setPasswordDialogOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const [passwordLoading, setPasswordLoading] = useState(false);
  const [passwordMessage, setPasswordMessage] = useState("");
  const [passwordError, setPasswordError] = useState("");

  const isDark = resolvedTheme === "dark";

  const apiUrl =
    process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000";

  // ============================================================
  // AUTHENTICATION AND INITIALIZATION
  // ============================================================

  useEffect(() => {
    const session = getSession("VENDOR");

    if (!session || session.user.role !== "VENDOR") {
      clearSession("VENDOR");
      router.replace("/login");
      return;
    }

    startTransition(() => {
      setVendor(session.user);
      setProfileImage(session.user.profile_image || "");
    });

    const savedTheme = localStorage.getItem("theme");

    if (savedTheme === "light" || savedTheme === "dark") {
      startTransition(() => setTheme(savedTheme));
    } else {
      const initialTheme =
        document.documentElement.classList.contains("dark")
          ? "dark"
          : "light";
      startTransition(() => setTheme(initialTheme));
    }
  }, [router]);

  // ============================================================
  // PROFILE IMAGE URL
  // ============================================================

  const getProfileImageUrl = useCallback(
    (imagePath: string) => {
      if (!imagePath) {
        return "";
      }

      // Support absolute URLs, including Firebase profile images.
      if (/^https?:\/\//i.test(imagePath)) {
        return imagePath;
      }

      // Convert a FastAPI relative path into an absolute URL.
      return `${apiUrl.replace(/\/+$/, "")}/${imagePath.replace(
        /^\/+/,
        "",
      )}`;
    },
    [apiUrl],
  );

  // ============================================================
  // UPLOAD PROFILE IMAGE
  // Existing endpoint: POST /profile/upload-image
  // ============================================================

  const handleProfileImageChange = async (
    event: ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.target.files?.[0];

    // Allow selecting the same image again later.
    event.target.value = "";

    if (!file) {
      return;
    }

    setImageMessage("");
    setImageError("");

    const allowedTypes = [
      "image/jpeg",
      "image/png",
      "image/webp",
    ];

    if (!allowedTypes.includes(file.type)) {
      setImageError("Choose a JPG, PNG, or WEBP image.");
      return;
    }

    const maxFileSize = 5 * 1024 * 1024;

    if (file.size > maxFileSize) {
      setImageError("The profile image must be smaller than 5 MB.");
      return;
    }

    const session = getSession("VENDOR");

    if (!session?.accessToken) {
      setImageError(
        "Your session has expired. Please log in again.",
      );
      return;
    }

    setUploadingImage(true);

    try {
      const formData = new FormData();

      formData.append("file", file);

      const response = await fetch(
        `${apiUrl.replace(/\/+$/, "")}/profile/upload-image`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${session.accessToken}`,
          },
          body: formData,
        },
      );

      const data: UploadResponse = await response
        .json()
        .catch(() => ({}));

      if (!response.ok) {
        let message = "Unable to upload your profile image.";

        if (typeof data.detail === "string") {
          message = data.detail;
        } else if (Array.isArray(data.detail)) {
          message = data.detail
            .map((item) => item.msg)
            .filter(Boolean)
            .join(" ");
        }

        setImageError(message);
        return;
      }

      const savedImage = data.profile_image || data.image_url;

      if (!savedImage) {
        setImageError(
          "The server did not return the saved profile image URL.",
        );
        return;
      }

      // Update the visible profile immediately.
      setProfileImage(savedImage);

      const updatedVendor: SessionUser = {
        ...session.user,
        profile_image: savedImage,
      };

      setVendor(updatedVendor);

      // Synchronize the official vendor session.
      // Preserve all existing tokens and session properties.
      const currentSession = getSession("VENDOR");

      if (currentSession) {
        const updatedSession = {
          ...currentSession,
          user: {
            ...currentSession.user,
            profile_image: savedImage,
          },
        };

        window.sessionStorage.setItem(
          SESSION_KEYS.VENDOR,
          JSON.stringify(updatedSession),
        );
      }

      setImageMessage(
        data.message || "Profile image uploaded successfully.",
      );
    } catch {
      setImageError(
        "Could not connect to the server. Check that the backend is running.",
      );
    } finally {
      setUploadingImage(false);
    }
  };

  // ============================================================
  // THEME TOGGLE
  // ============================================================

  const handleThemeToggle = () => {
    setTheme(isDark ? "light" : "dark");
  };

  // ============================================================
  // LOGOUT
  // ============================================================

  const handleLogout = () => {
    clearSession("VENDOR");
    router.replace("/login");
  };

  // ============================================================
  // PASSWORD DIALOG HELPERS
  // ============================================================

  const resetPasswordForm = () => {
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");

    setShowCurrentPassword(false);
    setShowNewPassword(false);
    setShowConfirmPassword(false);

    setPasswordMessage("");
    setPasswordError("");
  };

  const openPasswordDialog = () => {
    resetPasswordForm();
    setPasswordDialogOpen(true);
  };

  const closePasswordDialog = () => {
    if (passwordLoading) {
      return;
    }

    setPasswordDialogOpen(false);
    resetPasswordForm();
  };

  // ============================================================
  // CHANGE PASSWORD
  // Existing endpoint: POST /change-password
  // ============================================================

  const handleChangePassword = async (
    event: FormEvent<HTMLFormElement>,
  ) => {
    event.preventDefault();

    setPasswordMessage("");
    setPasswordError("");

    if (!currentPassword) {
      setPasswordError("Please enter your current password.");
      return;
    }

    if (newPassword.length < 8) {
      setPasswordError(
        "Your new password must contain at least 8 characters.",
      );
      return;
    }

    if (newPassword !== confirmPassword) {
      setPasswordError("Your new passwords do not match.");
      return;
    }

    const passwordIsStrong =
      /[A-Z]/.test(newPassword) &&
      /[a-z]/.test(newPassword) &&
      /[0-9]/.test(newPassword) &&
      /[^A-Za-z0-9]/.test(newPassword);

    if (!passwordIsStrong) {
      setPasswordError(
        "Use at least one uppercase letter, one lowercase letter, one number, and one special character.",
      );
      return;
    }

    setPasswordLoading(true);

    try {
      const session = getSession("VENDOR");

      if (!session?.accessToken) {
        setPasswordError(
          "Your session has expired. Please log in again.",
        );
        return;
      }

      const response = await fetch(
        `${apiUrl.replace(/\/+$/, "")}/change-password`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${session.accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            current_password: currentPassword,
            new_password: newPassword,
          }),
        },
      );

      const data: ApiError = await response
        .json()
        .catch(() => ({}));

      if (!response.ok) {
        let message =
          "Unable to change your password. Please try again.";

        if (typeof data.detail === "string") {
          message = data.detail;
        } else if (Array.isArray(data.detail)) {
          message = data.detail
            .map((item) => item.msg)
            .filter(Boolean)
            .join(" ");
        }

        setPasswordError(message);
        return;
      }

      setPasswordMessage(
        data.message || "Password changed successfully.",
      );

      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");

      setShowCurrentPassword(false);
      setShowNewPassword(false);
      setShowConfirmPassword(false);
    } catch {
      setPasswordError(
        "Unable to connect to the server. Please try again.",
      );
    } finally {
      setPasswordLoading(false);
    }
  };

  // ============================================================
  // LOADING STATE
  // ============================================================

  if (!vendor) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-foreground">
        <LoaderCircle className="h-8 w-8 animate-spin text-violet-500" />
      </div>
    );
  }

  const vendorName = vendor.name || "Vendor";
  const vendorPhone = vendor.phone || "Phone not available";
  const vendorEmail = vendor.email || "Email not available";

  const cardClass = isDark
    ? "border-white/10 bg-[#111111]"
    : "border-slate-200 bg-white";

  const mutedTextClass = isDark
    ? "text-zinc-400"
    : "text-slate-500";

  const resolvedProfileImage = getProfileImageUrl(profileImage);

  // ============================================================
  // PAGE
  // ============================================================

  return (
    <main
      className={`min-h-screen transition-colors duration-300 ${
        isDark
          ? "bg-[#090909] text-white"
          : "bg-slate-50 text-slate-900"
      }`}
    >
      <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 lg:px-8">
        {/* Back to dashboard */}
        <button
          type="button"
          onClick={() => router.push("/vendor/dashboard")}
          className="mb-6 inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors hover:bg-black/5 dark:hover:bg-white/5"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Dashboard
        </button>

        {/* Profile header */}
        <section
          className={`overflow-hidden rounded-3xl border ${cardClass}`}
        >
          <div className="relative">
            <TelegramHeader
              avatar={resolvedProfileImage}
              name={vendorName}
              phone={vendorPhone}
              username={vendorEmail}
              actionButton={{
                text: "Profile",
                onClick: () => {
                  profileImageInputRef.current?.click();
                },
                backgroundColor: "#8b5cf6",
              }}
            />

            {/* Profile image upload button */}
            <button
              type="button"
              onClick={() => profileImageInputRef.current?.click()}
              disabled={uploadingImage}
              className="mx-auto mb-5 flex items-center gap-2 rounded-xl bg-violet-500 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-violet-600 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {uploadingImage ? (
                <LoaderCircle className="h-4 w-4 animate-spin" />
              ) : (
                <Camera className="h-4 w-4" />
              )}

              {uploadingImage
                ? "Uploading image..."
                : profileImage
                  ? "Change Profile Photo"
                  : "Upload Profile Photo"}
            </button>

            <input
              ref={profileImageInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={handleProfileImageChange}
              disabled={uploadingImage}
              aria-label="Choose profile photo"
            />
          </div>

          {/* Image feedback */}
          {(imageMessage || imageError) && (
            <div className="px-5 pb-5">
              {imageMessage && (
                <p
                  role="status"
                  className="flex items-center gap-2 rounded-xl border border-green-500/20 bg-green-500/10 px-4 py-3 text-sm text-green-600 dark:text-green-400"
                >
                  <CheckCircle2 className="h-4 w-4 shrink-0" />
                  {imageMessage}
                </p>
              )}

              {imageError && (
                <p
                  role="alert"
                  className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-600 dark:text-red-400"
                >
                  {imageError}
                </p>
              )}
            </div>
          )}
        </section>

        {/* Business information */}
        <section className="mt-6">
          <div className="mb-3">
            <h2 className="text-lg font-semibold">
              Business Information
            </h2>

            <p className={`mt-1 text-sm ${mutedTextClass}`}>
              Your CampusVita vendor account information.
            </p>
          </div>

          <div
            className={`overflow-hidden rounded-2xl border ${cardClass}`}
          >
            <ProfileRow
              icon={<UserRound className="h-5 w-5" />}
              label="Vendor Name"
              value={vendorName}
              dark={isDark}
            />

            <ProfileRow
              icon={<UserRound className="h-5 w-5" />}
              label="Email"
              value={vendorEmail}
              dark={isDark}
            />

            <ProfileRow
              icon={<UserRound className="h-5 w-5" />}
              label="Phone"
              value={vendorPhone}
              dark={isDark}
            />

            <ProfileRow
              icon={<ShieldCheck className="h-5 w-5" />}
              label="Role"
              value={vendor.role}
              dark={isDark}
              last
            />
          </div>
        </section>

        {/* Preferences */}
        <section className="mt-6">
          <h2 className="mb-3 text-lg font-semibold">Preferences</h2>

          <div
            className={`flex items-center justify-between rounded-2xl border p-5 ${cardClass}`}
          >
            <div>
              <p className="font-medium">Appearance</p>

              <p className={`mt-1 text-sm ${mutedTextClass}`}>
                Choose your preferred theme.
              </p>
            </div>

            <button
              type="button"
              onClick={handleThemeToggle}
              className={`relative flex h-10 items-center gap-2 rounded-full border px-1 transition-colors ${
                isDark
                  ? "border-white/10 bg-[#090909]"
                  : "border-slate-200 bg-slate-100"
              }`}
              aria-label="Toggle theme"
              aria-pressed={isDark}
            >
              <span
                className={`flex h-8 w-8 items-center justify-center rounded-full transition-all ${
                  !isDark
                    ? "bg-white text-violet-500 shadow-sm"
                    : "text-zinc-400"
                }`}
              >
                <Sun className="h-4 w-4" />
              </span>

              <span
                className={`flex h-8 w-8 items-center justify-center rounded-full transition-all ${
                  isDark
                    ? "bg-zinc-800 text-violet-400"
                    : "text-slate-400"
                }`}
              >
                <Moon className="h-4 w-4" />
              </span>
            </button>
          </div>
        </section>

        {/* Security */}
        <section className="mt-6">
          <h2 className="mb-3 text-lg font-semibold">Security</h2>

          <button
            type="button"
            onClick={openPasswordDialog}
            className={`flex w-full items-center justify-between rounded-2xl border p-5 text-left transition-colors ${
              isDark
                ? "border-white/10 bg-[#111111] hover:bg-[#171717]"
                : "border-slate-200 bg-white hover:bg-slate-50"
            }`}
          >
            <div className="flex items-center gap-3">
              <div className="rounded-xl bg-violet-500/10 p-2.5 text-violet-500">
                <KeyRound className="h-5 w-5" />
              </div>

              <div>
                <p className="font-medium">Change Password</p>

                <p className={`mt-1 text-sm ${mutedTextClass}`}>
                  Update your account password.
                </p>
              </div>
            </div>

            <span className="text-sm text-violet-500" aria-hidden="true">
              →
            </span>
          </button>
        </section>

        {/* Session */}
        <section className="mt-6">
          <h2 className="mb-3 text-lg font-semibold">Session</h2>

          <button
            type="button"
            onClick={handleLogout}
            className="flex w-full items-center gap-3 rounded-2xl border border-red-500/20 bg-red-500/5 p-5 text-left text-red-500 transition-colors hover:bg-red-500/10"
          >
            <LogOut className="h-5 w-5" />

            <div>
              <p className="font-medium">Logout</p>

              <p className="mt-1 text-sm opacity-70">
                Sign out of your vendor account.
              </p>
            </div>
          </button>
        </section>

        {/* About */}
        <section className="pb-8 pt-8 text-center">
          <p className="text-sm font-medium">CampusVita</p>

          <p
            className={`mt-1 text-xs ${
              isDark ? "text-zinc-500" : "text-slate-400"
            }`}
          >
            Vendor Portal · Version 1.0.0
          </p>
        </section>
      </div>

      {/* Change password dialog */}
      {passwordDialogOpen && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center overflow-y-auto bg-black/60 p-4 backdrop-blur-sm"
          onMouseDown={(event) => {
            if (
              event.target === event.currentTarget &&
              !passwordLoading
            ) {
              closePasswordDialog();
            }
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="change-password-title"
            className={`my-auto w-full max-w-md rounded-3xl border p-6 shadow-2xl ${
              isDark
                ? "border-white/10 bg-[#111111] text-white"
                : "border-slate-200 bg-white text-slate-900"
            }`}
          >
            <div className="mb-6 flex items-start justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="rounded-xl bg-violet-500/10 p-3 text-violet-500">
                  <KeyRound className="h-6 w-6" />
                </div>

                <div>
                  <h2
                    id="change-password-title"
                    className="text-xl font-semibold"
                  >
                    Change Password
                  </h2>

                  <p className={`mt-1 text-sm ${mutedTextClass}`}>
                    Secure your vendor account.
                  </p>
                </div>
              </div>

              <button
                type="button"
                disabled={passwordLoading}
                onClick={closePasswordDialog}
                className={`rounded-lg p-2 transition-colors disabled:opacity-50 ${
                  isDark
                    ? "text-zinc-400 hover:bg-white/10"
                    : "text-slate-500 hover:bg-slate-100"
                }`}
                aria-label="Close password dialog"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleChangePassword} className="space-y-5">
              <PasswordField
                id="current-password"
                label="Current password"
                value={currentPassword}
                onChange={setCurrentPassword}
                visible={showCurrentPassword}
                onToggleVisibility={() =>
                  setShowCurrentPassword((value) => !value)
                }
                theme={isDark ? "dark" : "light"}
                autoComplete="current-password"
              />

              <PasswordField
                id="new-password"
                label="New password"
                value={newPassword}
                onChange={setNewPassword}
                visible={showNewPassword}
                onToggleVisibility={() =>
                  setShowNewPassword((value) => !value)
                }
                theme={isDark ? "dark" : "light"}
                autoComplete="new-password"
                minLength={8}
              />

              <PasswordField
                id="confirm-password"
                label="Confirm new password"
                value={confirmPassword}
                onChange={setConfirmPassword}
                visible={showConfirmPassword}
                onToggleVisibility={() =>
                  setShowConfirmPassword((value) => !value)
                }
                theme={isDark ? "dark" : "light"}
                autoComplete="new-password"
                minLength={8}
              />

              <p className={`text-xs leading-5 ${mutedTextClass}`}>
                Use at least 8 characters, including uppercase and
                lowercase letters, a number, and a special character.
              </p>

              {passwordMessage && (
                <div
                  role="status"
                  className="rounded-xl border border-green-500/20 bg-green-500/10 px-4 py-3 text-sm text-green-600 dark:text-green-400"
                >
                  {passwordMessage}
                </div>
              )}

              {passwordError && (
                <div
                  role="alert"
                  className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-600 dark:text-red-400"
                >
                  {passwordError}
                </div>
              )}

              <div className="flex flex-col-reverse gap-3 pt-1 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  disabled={passwordLoading}
                  onClick={closePasswordDialog}
                  className={`rounded-xl border px-5 py-3 text-sm font-medium transition-colors disabled:opacity-50 ${
                    isDark
                      ? "border-white/10 hover:bg-white/5"
                      : "border-slate-200 hover:bg-slate-50"
                  }`}
                >
                  Cancel
                </button>

                <button
                  type="submit"
                  disabled={passwordLoading}
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-violet-500 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-violet-600 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {passwordLoading && (
                    <LoaderCircle className="h-4 w-4 animate-spin" />
                  )}

                  {passwordLoading
                    ? "Updating..."
                    : "Update Password"}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
    </main>
  );
}

// ============================================================
// REUSABLE PROFILE ROW
// ============================================================

function ProfileRow({
  icon,
  label,
  value,
  dark,
  last = false,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  dark: boolean;
  last?: boolean;
}) {
  return (
    <div
      className={`flex items-center gap-4 px-5 py-4 ${
        !last
          ? dark
            ? "border-b border-white/10"
            : "border-b border-slate-100"
          : ""
      }`}
    >
      <div
        className={`rounded-xl p-2 ${
          dark
            ? "bg-white/5 text-zinc-300"
            : "bg-slate-100 text-slate-600"
        }`}
      >
        {icon}
      </div>

      <div className="min-w-0">
        <p
          className={`text-xs ${
            dark ? "text-zinc-500" : "text-slate-400"
          }`}
        >
          {label}
        </p>

        <p className="mt-0.5 truncate text-sm font-medium">{value}</p>
      </div>
    </div>
  );
}

// ============================================================
// REUSABLE PASSWORD FIELD
// ============================================================

function PasswordField({
  id,
  label,
  value,
  onChange,
  visible,
  onToggleVisibility,
  theme,
  autoComplete,
  minLength,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  visible: boolean;
  onToggleVisibility: () => void;
  theme: "light" | "dark";
  autoComplete: string;
  minLength?: number;
}) {
  const dark = theme === "dark";

  return (
    <div>
      <label
        htmlFor={id}
        className={`mb-2 block text-sm font-medium ${
          dark ? "text-zinc-200" : "text-slate-700"
        }`}
      >
        {label}
      </label>

      <div className="relative">
        <input
          id={id}
          type={visible ? "text" : "password"}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          autoComplete={autoComplete}
          minLength={minLength}
          required
          className={`w-full rounded-xl border px-4 py-3 pr-12 text-sm outline-none transition-colors focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20 ${
            dark
              ? "border-white/10 bg-[#090909] text-white placeholder:text-zinc-600"
              : "border-slate-200 bg-white text-slate-900 placeholder:text-slate-400"
          }`}
          placeholder={`Enter ${label.toLowerCase()}`}
        />

        <button
          type="button"
          onClick={onToggleVisibility}
          className={`absolute inset-y-0 right-0 flex items-center px-4 transition-colors ${
            dark
              ? "text-zinc-400 hover:text-white"
              : "text-slate-500 hover:text-slate-900"
          }`}
          aria-label={visible ? `Hide ${label}` : `Show ${label}`}
          aria-pressed={visible}
        >
          {visible ? (
            <EyeOff className="h-4 w-4" />
          ) : (
            <Eye className="h-4 w-4" />
          )}
        </button>
      </div>
    </div>
  );
}
