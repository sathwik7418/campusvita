"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Eye,
  EyeOff,
  KeyRound,
} from "lucide-react";

import { VENDOR_ACTIVATED_FLAG } from "@/app/lib/auth/session";

const API_URL =
  process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000";

const GENERIC_VERIFY_ERROR =
  "Invalid or expired activation credentials.";

type InvitationPreview = {
  valid: boolean;
  vendor_id: string;
  business_name: string;
  owner_name: string;
  email: string;
};

function extractError(data: unknown, fallback: string): string {
  const detail = (data as { detail?: unknown } | null)?.detail;

  if (typeof detail === "string" && detail.trim()) {
    return detail;
  }

  // FastAPI 422 responses carry an array of field errors.
  if (Array.isArray(detail)) {
    const message = detail.find(
      (item) =>
        item &&
        typeof item === "object" &&
        typeof (item as { msg?: unknown }).msg === "string"
    );

    if (message) {
      return (message as { msg: string }).msg;
    }
  }

  return fallback;
}

export default function VendorActivatePage() {
  const router = useRouter();

  const [step, setStep] = useState<1 | 2>(1);

  const [vendorId, setVendorId] = useState("");
  const [activationCode, setActivationCode] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [verifyError, setVerifyError] = useState("");

  const [invitation, setInvitation] =
    useState<InvitationPreview | null>(null);

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [activating, setActivating] = useState(false);
  const [activateError, setActivateError] = useState("");

  // ============================================================
  // STEP 1 - verify Vendor ID + activation code
  // ============================================================

  async function handleVerify(event: FormEvent) {
    event.preventDefault();

    const trimmedVendorId = vendorId.trim();
    const trimmedCode = activationCode.trim();

    if (!trimmedVendorId || !trimmedCode) {
      setVerifyError(
        "Please enter both the Vendor ID and the activation code."
      );
      return;
    }

    try {
      setVerifying(true);
      setVerifyError("");

      const response = await fetch(
        `${API_URL}/vendor/activate/verify`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            vendor_id: trimmedVendorId,
            activation_code: trimmedCode,
          }),
        }
      );

      const data = await response.json().catch(() => null);

      if (!response.ok) {
        setVerifyError(
          extractError(data, GENERIC_VERIFY_ERROR)
        );
        return;
      }

      setInvitation(data as InvitationPreview);
      setPassword("");
      setConfirmPassword("");
      setActivateError("");
      setStep(2);
    } catch {
      setVerifyError(
        "Something went wrong. Please try again."
      );
    } finally {
      setVerifying(false);
    }
  }

  // ============================================================
  // STEP 2 - choose a password and activate
  //
  // The invited email is server-returned and not editable. The
  // activation code remains in component state only and is cleared
  // after success; it is never copied to browser storage or a URL.
  // ============================================================

  async function handleActivate(event: FormEvent) {
    event.preventDefault();

    if (!invitation) return;

    if (password !== confirmPassword) {
      setActivateError("Passwords do not match.");
      return;
    }

    try {
      setActivating(true);
      setActivateError("");

      const response = await fetch(
        `${API_URL}/vendor/activate`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            vendor_id: invitation.vendor_id,
            activation_code: activationCode.trim(),
            password,
          }),
        }
      );

      const data = await response.json().catch(() => null);

      if (!response.ok) {
        setActivateError(
          extractError(
            data,
            "Activation failed. Please try again."
          )
        );
        return;
      }

      // Clear credentials from component state after success.
      setPassword("");
      setConfirmPassword("");
      setActivationCode("");
      setVendorId("");
      setInvitation(null);
      setStep(1);

      try {
        window.sessionStorage.setItem(
          VENDOR_ACTIVATED_FLAG,
          "1"
        );
      } catch {
        // Storage unavailable - redirect still happens.
      }

      router.replace("/login");
    } catch {
      setActivateError(
        "Something went wrong. Please try again."
      );
    } finally {
      setActivating(false);
    }
  }

  function handleBackToStepOne() {
    setPassword("");
    setConfirmPassword("");
    setActivateError("");
    setStep(1);
  }

  return (
    <main className="flex min-h-screen min-h-[100dvh] w-full flex-col items-center justify-center bg-[var(--background)] px-6 py-12">
      <div className="w-full max-w-md rounded-3xl border border-zinc-800 bg-[var(--surface)] p-7 shadow-[0_24px_60px_rgba(0,0,0,0.45)]">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-brand to-brand-hover">
            <KeyRound className="h-5 w-5 text-white" />
          </div>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-brand">
              Step {step} of 2
            </p>
            <h1 className="text-[22px] font-bold tracking-tight text-white">
              Vendor Account Activation
            </h1>

            <p className="mt-3 text-sm leading-relaxed text-text-secondary sm:text-[15px]">
              {step === 1
                ? "Enter the Vendor ID and activation code provided by your CampusVita administrator to get started."
                : "Your invitation is verified. Confirm your details and create a secure password to finish setting up your vendor account."}
            </p>
          </div>

          </div>

          {/* Step indicator */}
          <div className="mb-7">
            <div
              className="flex items-center gap-2"
              aria-label={`Step ${step} of 2`}
            >
              <span
                className={`h-1.5 flex-1 rounded-full transition-colors ${
                  step >= 1 ? "bg-brand" : "bg-input-border"
                }`}
              />
              <span
                className={`h-1.5 flex-1 rounded-full transition-colors ${
                  step >= 2 ? "bg-brand" : "bg-input-border"
                }`}
              />
              <span className="ml-2 whitespace-nowrap text-[11px] font-semibold uppercase tracking-[0.12em] text-text-secondary">
                Step {step} of 2
              </span>
            </div>
          </div>

        {step === 1 ? (
          <form
            onSubmit={handleVerify}
            className="mt-6 space-y-4"
          >
            <div>
              <label
                htmlFor="vendor-id"
                className="mb-1.5 block text-sm font-medium text-[var(--text-primary)]"
              >
                Vendor ID
              </label>
              <input
                id="vendor-id"
                type="text"
                value={vendorId}
                onChange={(e) =>
                  setVendorId(e.target.value)
                }
                placeholder="e.g. VEN-7KQ9M2"
                autoComplete="off"
                spellCheck={false}
                autoCapitalize="characters"
                className="w-full rounded-xl border border-input-border bg-input px-4 py-3 text-sm text-[var(--text-primary)] placeholder-white/30 outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/30"
              />
            </div>

            <div>
              <label
                htmlFor="activation-code"
                className="mb-1.5 block text-sm font-medium text-[var(--text-primary)]"
              >
                Activation Code
              </label>
              <input
                id="activation-code"
                type="text"
                value={activationCode}
                onChange={(e) =>
                  setActivationCode(e.target.value)
                }
                placeholder="6-character code"
                autoComplete="off"
                spellCheck={false}
                autoCapitalize="characters"
                className="w-full rounded-xl border border-input-border bg-input px-4 py-3 text-sm uppercase tracking-[0.3em] text-[var(--text-primary)] placeholder-white/30 placeholder:normal-case placeholder:tracking-normal outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/30"
              />
            </div>

            {verifyError && (
              <p
                role="alert"
                className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300"
              >
                {verifyError}
              </p>
            )}

            <button
              type="submit"
              disabled={verifying}
              className="flex h-13 w-full items-center justify-center rounded-2xl bg-gradient-to-r from-brand to-brand-hover text-base font-semibold text-white shadow-[0_12px_30px_rgba(104,110,232,0.35)] transition-all hover:scale-[1.01] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {verifying ? "Checking..." : "Continue"}
            </button>
          </form>
        ) : (
          <form
            onSubmit={handleActivate}
            className="mt-6 space-y-4"
          >
            <div className="space-y-3 rounded-2xl border border-zinc-800 bg-[var(--surface-tertiary)] p-4">
              <div className="flex items-start justify-between gap-4">
                <span className="text-xs font-medium uppercase tracking-wider text-[var(--text-subtle)]">
                  Business
                </span>
                <span className="text-right text-sm font-medium text-white">
                  {invitation?.business_name}
                </span>
              </div>
              <div className="flex items-start justify-between gap-4">
                <span className="text-xs font-medium uppercase tracking-wider text-[var(--text-subtle)]">
                  Owner
                </span>
                <span className="text-right text-sm font-medium text-white">
                  {invitation?.owner_name}
                </span>
              </div>
              <div className="flex items-start justify-between gap-4">
                <span className="text-xs font-medium uppercase tracking-wider text-[var(--text-subtle)]">
                  Email
                </span>
                <span className="break-all text-right text-sm font-medium text-white">
                  {invitation?.email}
                </span>
              </div>
              <div className="flex items-start justify-between gap-4">
                <span className="text-xs font-medium uppercase tracking-wider text-[var(--text-subtle)]">
                  Vendor ID
                </span>
                <span className="text-right text-sm font-medium text-white">
                  {invitation?.vendor_id}
                </span>
              </div>
            </div>

            <div>
              <label
                htmlFor="password"
                className="mb-1.5 block text-sm font-medium text-[var(--text-primary)]"
              >
                Password
              </label>
              <div className="relative">
                <input
                  id="password"
                  type={
                    showPassword ? "text" : "password"
                  }
                  value={password}
                  onChange={(e) =>
                    setPassword(e.target.value)
                  }
                  placeholder="Create a password"
                  autoComplete="new-password"
                  className="w-full rounded-xl border border-input-border bg-input px-4 py-3 pr-12 text-sm text-[var(--text-primary)] placeholder-white/30 outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/30"
                />
                <button
                  type="button"
                  onClick={() =>
                    setShowPassword((v) => !v)
                  }
                  aria-label={
                    showPassword
                      ? "Hide password"
                      : "Show password"
                  }
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--text-subtle)] transition hover:text-[var(--text-secondary)]"
                >
                  {showPassword ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              </div>
            </div>

            <div>
              <label
                htmlFor="confirm-password"
                className="mb-1.5 block text-sm font-medium text-[var(--text-primary)]"
              >
                Confirm Password
              </label>
              <input
                id="confirm-password"
                type={showPassword ? "text" : "password"}
                value={confirmPassword}
                onChange={(e) =>
                  setConfirmPassword(e.target.value)
                }
                placeholder="Re-enter your password"
                autoComplete="new-password"
                className="w-full rounded-xl border border-input-border bg-input px-4 py-3 text-sm text-[var(--text-primary)] placeholder-white/30 outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/30"
              />
            </div>

              <div className="rounded-xl bg-surface px-4 py-3">
                <p className="text-xs font-semibold text-text-primary">
                  Password requirements
                </p>

                <p className="mt-1.5 text-xs leading-relaxed text-text-secondary">
                  At least 8 characters, including an uppercase letter, a lowercase letter, a number, and a special character.
                </p>
              </div>

            {activateError && (
              <p
                role="alert"
                className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300"
              >
                {activateError}
              </p>
            )}

            <button
              type="submit"
              disabled={activating}
              className="flex h-13 w-full items-center justify-center rounded-2xl bg-gradient-to-r from-brand to-brand-hover text-base font-semibold text-white shadow-[0_12px_30px_rgba(104,110,232,0.35)] transition-all hover:scale-[1.01] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {activating
                ? "Activating..."
                : "Activate Account"}
            </button>

              <button
                type="button"
                onClick={handleBackToStepOne}
                className="flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-input-border text-sm font-semibold text-text-secondary transition hover:border-brand/40 hover:text-brand"
              >
                <ArrowLeft className="h-4 w-4" />
                Back to credentials
              </button>
            </form>
          )}

        <div className="mt-6 border-t border-zinc-800 pt-5 text-center">
          <Link
            href="/login"
            className="text-sm font-medium text-[var(--text-secondary)] transition hover:text-brand"
          >
            Back to Login
          </Link>
        </div>
      </div>
    </main>
  );
}
