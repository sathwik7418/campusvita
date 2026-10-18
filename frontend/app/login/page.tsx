"use client";

import toast from "react-hot-toast";
import Link from "next/link";
import { useState, useEffect, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import {
  MotionConfig,
  motion,
} from "framer-motion";

import {
  ArrowRight,
  Eye,
  EyeOff,
} from "lucide-react";

import {
  saveSession,
  consumeSessionExpiredFlag,
  SESSION_EXPIRED_MESSAGE,
  consumeVendorActivatedFlag,
  VENDOR_ACTIVATED_MESSAGE,
} from "@/app/lib/auth/session";

import {
  getFCMToken,
  auth,
  googleProvider,
} from "@/app/firebase";

import { signInWithPopup } from "firebase/auth";

import LoginHero from "@/components/auth/LoginHero";

const API_URL =
  process.env.NEXT_PUBLIC_API_URL ||
  "http://127.0.0.1:8000";

type AuthApiResponse = {
  message?: string;
  detail?: string;
  access_token?: string;
  refresh_token?: string;
  token_type?: string;
  expires_in?: number;
  user?: {
    name?: string;
    email?: string;
    role?: string;
    phone?: string;
    department?: string;
    year?: string;
    profile_image?: string;
  };
};

export default function LoginPage() {
  const router = useRouter();

  // ============================================================
  // SESSION EXPIRED NOTICE
  //
  // The API layer clears a stale session and redirects here
  // with a one-shot flag. Consume it once and show a friendly
  // message (backend JWT errors are never shown).
  // ============================================================

  useEffect(() => {
    if (consumeSessionExpiredFlag()) {
      toast.error(SESSION_EXPIRED_MESSAGE);
    }

    // One-shot flag set by /vendor/activate on success, so
    // the login page makes it obvious the account is ready.
    if (consumeVendorActivatedFlag()) {
      toast.success(VENDOR_ACTIVATED_MESSAGE);
    }
  }, []);

  // ============================================================
  // STATE
  // ============================================================

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loginMode, setLoginMode] =
  useState<"USER" | "ADMIN" | "VENDOR">("USER");

  const [showPassword, setShowPassword] =
    useState(false);

  const [loading, setLoading] =
    useState(false);

  const [rememberMe, setRememberMe] =
    useState(false);

  // ============================================================
  // NORMAL EMAIL LOGIN
  // ============================================================

  const handleLogin = async (
    e: FormEvent<HTMLFormElement>
  ) => {
    e.preventDefault();

    if (!email.trim() || !password) {
      toast.error("Please Fill All Fields");
      return;
    }

    try {
      setLoading(true);

      const response = await fetch(
        `${API_URL}/login`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            email: email.trim(),
            password,
            login_mode: loginMode,
          }),
        }
      );

      let data: AuthApiResponse;

      try {
        data = (await response.json()) as AuthApiResponse;
      } catch (error) {
        console.error(
          "Login response JSON error:",
          error
        );

        toast.error(
          "Server returned an unexpected response"
        );

        return;
      }

      // ========================================================
      // LOGIN FAILED
      // ========================================================

      if (!response.ok) {
        toast.error(
          data?.message ||
            data?.detail ||
            "Login failed. Please try again."
        );

        return;
      }

      // ========================================================
      // GET ROLE
      // ========================================================

      const role = data?.user?.role;

      console.log(
        "✅ NORMAL LOGIN USER:",
        data?.user?.email
      );

      console.log(
        "✅ NORMAL LOGIN ROLE:",
        role
      );

      // ========================================================
      // VALIDATE ROLE
      // ========================================================

      if (
        role !== "ADMIN" &&
        role !== "USER" &&
        role !== "VENDOR"
      ) {
        console.error(
          "Invalid role returned by backend:",
          role
        );

        toast.error(
          "Invalid user role returned by server"
        );

        return;
      }

      // ========================================================
      // VALIDATE ACCESS TOKEN
      // ========================================================

      if (!data?.access_token) {
        console.error(
          "Login response does not contain access_token"
        );

        toast.error(
          "Login failed: access token missing"
        );

        return;
      }

      // ========================================================
      // VALIDATE USER
      // ========================================================

      if (!data?.user?.email) {
        console.error(
          "Login response does not contain user email"
        );

        toast.error(
          "Login failed: user information missing"
        );

        return;
      }

      // ========================================================
      // SAVE SESSION
      //
      // ADMIN  -> localStorage
      // USER   -> localStorage
      // VENDOR -> sessionStorage
      //
      // This behavior is controlled by saveSession()
      // ========================================================

      saveSession({
        accessToken:
          data.access_token,

        refreshToken:
          data.refresh_token || "",

        tokenType:
          data.token_type || "bearer",

        expiresIn:
          Number(data.expires_in || 0),

        user: {
          name:
            data.user.name || "",

          email:
            data.user.email || "",

          role,

          phone:
            data.user.phone || "",

          department:
            data.user.department || "",

          year:
            data.user.year || "",

          profile_image:
            data.user.profile_image || "",
        },
      });

      // ========================================================
      // FCM TOKEN
      // ========================================================

      try {
        const fcmToken =
          await getFCMToken();

        if (fcmToken) {
          await fetch(
            `${API_URL}/save-fcm-token`,
            {
              method: "POST",

              headers: {
                "Content-Type":
                  "application/json",
                Authorization:
                  `Bearer ${data.access_token}`,
              },

              body: JSON.stringify({
                fcm_token:
                  fcmToken,
              }),
            }
          );

          console.log(
            "✅ FCM token sent to backend"
          );
        }
      } catch (error) {
        console.error(
          "FCM setup error:",
          error
        );

        // FCM failure should not prevent login.
      }

      // ========================================================
      // SUCCESS MESSAGE
      // ========================================================

      toast.success(
        data.message ||
          "Login Successful 🚀"
      );

      // ========================================================
      // REDIRECT BY ROLE
      // ========================================================

      if (role === "ADMIN") {
        router.replace(
          "/admin/dashboard"
        );
      } else if (role === "VENDOR") {
        router.replace(
          "/vendor/dashboard"
        );
      } else {
        router.replace("/");
      }

    } catch (error) {
      console.error(
        "Login error:",
        error
      );

      toast.error(
        "Backend Server Not Running"
      );

    } finally {
      setLoading(false);
    }
  };

  // ============================================================
  // GOOGLE LOGIN
  // ============================================================

  const handleGoogleLogin = async () => {
    try {
      setLoading(true);

      // ========================================================
      // OPEN GOOGLE LOGIN POPUP
      // ========================================================

      const result =
        await signInWithPopup(
          auth,
          googleProvider
        );

      // ========================================================
      // GET FIREBASE ID TOKEN
      // ========================================================

      const idToken =
        await result.user.getIdToken();

      // ========================================================
      // SEND FIREBASE TOKEN TO BACKEND
      // ========================================================

      const response = await fetch(
        `${API_URL}/auth/google`,
        {
          method: "POST",

          headers: {
            "Content-Type":
              "application/json",
          },

          body: JSON.stringify({
            id_token: idToken,
            login_mode: loginMode,
          }),
        }
      );

      let data: AuthApiResponse;

      try {
        data = (await response.json()) as AuthApiResponse;
      } catch (error) {
        console.error(
          "Google login response JSON error:",
          error
        );

        toast.error(
          "Server returned an unexpected response"
        );

        return;
      }

      // ========================================================
      // GOOGLE LOGIN FAILED
      // ========================================================

      if (!response.ok) {
        toast.error(
          data?.message ||
            data?.detail ||
            "Google login failed. Please try again."
        );

        return;
      }

      // ========================================================
      // GET ROLE
      // ========================================================

      const role =
        data?.user?.role;

      // ========================================================
      // VALIDATE ROLE
      // ========================================================

      if (
        role !== "ADMIN" &&
        role !== "USER" &&
        role !== "VENDOR"
      ) {
        console.error(
          "Invalid role returned by backend:",
          role
        );

        toast.error(
          "Invalid user role returned by server"
        );

        return;
      }

      // ========================================================
      // VALIDATE ACCESS TOKEN
      // ========================================================

      if (!data?.access_token) {
        console.error(
          "Google login response does not contain access_token"
        );

        toast.error(
          "Google login failed: access token missing"
        );

        return;
      }

      // ========================================================
      // VALIDATE USER
      // ========================================================

      if (!data?.user?.email) {
        console.error(
          "Google login response does not contain user email"
        );

        toast.error(
          "Google login failed: user information missing"
        );

        return;
      }

      // ========================================================
      // SAVE GOOGLE SESSION
      //
      // Vendor sessions are automatically stored in
      // sessionStorage by saveSession().
      // ========================================================

      saveSession({
        accessToken:
          data.access_token,

        refreshToken:
          data.refresh_token || "",

        tokenType:
          data.token_type || "bearer",

        expiresIn:
          Number(
            data.expires_in || 0
          ),

        user: {
          name:
            data.user.name || "",

          email:
            data.user.email || "",

          role,

          phone:
            data.user.phone || "",

          department:
            data.user.department || "",

          year:
            data.user.year || "",

          profile_image:
            data.user.profile_image || "",
        },
      });

      console.log(
        "✅ GOOGLE LOGIN USER:",
        data.user.email
      );

      console.log(
        "✅ GOOGLE LOGIN ROLE:",
        role
      );

      // ========================================================
      // FCM TOKEN
      // ========================================================

      try {
        const fcmToken =
          await getFCMToken();

        if (fcmToken) {
          await fetch(
            `${API_URL}/save-fcm-token`,
            {
              method: "POST",

              headers: {
                "Content-Type":
                  "application/json",
                Authorization:
                  `Bearer ${data.access_token}`,
              },

              body: JSON.stringify({
                fcm_token:
                  fcmToken,
              }),
            }
          );

          console.log(
            "✅ FCM token sent to backend"
          );
        }
      } catch (error) {
        console.error(
          "FCM setup error:",
          error
        );

        // FCM failure should not prevent login.
      }

      // ========================================================
      // SUCCESS MESSAGE
      // ========================================================

      toast.success(
        data.message ||
          "Google Login Successful 🚀"
      );

      // ========================================================
      // REDIRECT BY ROLE
      // ========================================================

      if (role === "ADMIN") {
        router.replace(
          "/admin/dashboard"
        );
      } else if (role === "VENDOR") {
        router.replace(
          "/vendor/dashboard"
        );
      } else {
        router.replace("/");
      }

    } catch (error: unknown) {
      console.error(
        "Google login error:",
        error
      );

      const errorCode =
        typeof error === "object" && error !== null && "code" in error &&
        typeof error.code === "string"
          ? error.code
          : undefined;

      // ========================================================
      // USER CLOSED POPUP
      // ========================================================

      if (
        errorCode === "auth/popup-closed-by-user"
      ) {
        toast.error(
          "Google login was cancelled"
        );

        return;
      }

      // ========================================================
      // POPUP BLOCKED
      // ========================================================

      if (
        errorCode === "auth/popup-blocked"
      ) {
        toast.error(
          "Google popup was blocked by your browser"
        );

        return;
      }

      toast.error(
        "Google login failed. Please try again."
      );

    } finally {
      setLoading(false);
    }
  };

  return (
    <MotionConfig reducedMotion="user">
      <main className="relative isolate flex h-[100dvh] w-full flex-col overflow-x-clip bg-background md:grid md:grid-cols-2 md:grid-rows-1 lg:grid-cols-[1.12fr_1fr]">

        {/* ======================================================
            HERO — desktop left panel / mobile header
        ====================================================== */}

        <LoginHero />

        {/* ======================================================
            LOGIN PANEL
        ====================================================== */}

        <section className="cv-glass-elevated relative z-10 -mt-6 flex min-h-0 w-full flex-1 flex-col overflow-y-auto rounded-3xl px-5 pb-[max(2.5rem,env(safe-area-inset-bottom))] pt-8 sm:px-8 md:mt-0 md:px-10 md:py-12 lg:px-16">

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{
              duration: 0.5,
              delay: 0.1,
              ease: [0.22, 1, 0.36, 1],
            }}
            className="mx-auto my-auto w-[min(100%,27rem)]"
          >

            {/* HEADING */}

            <p className="text-sm font-semibold tracking-[0.04em] text-[var(--accent-text)]! sm:text-[15px]">
              From Classrooms to Cravings.
            </p>

            <h1 className="mt-2.5 text-[28px] font-bold tracking-[-0.03em] sm:text-[34px]">
              Welcome{" "}
              <span className="text-[var(--accent-text)]!">
                Back!
              </span>
            </h1>

            {/* LOGIN FORM */}

            <form
              onSubmit={handleLogin}
              className="mt-8 space-y-5"
            >
            <div>
  <label
    htmlFor="login-mode"
    className="mb-2 block text-sm font-medium text-text-primary"
  >
    Login as
  </label>

  <select
    id="login-mode"
    value={loginMode}
    onChange={(e) =>
      setLoginMode(
        e.target.value as "USER" | "ADMIN" | "VENDOR"
      )
    }
    disabled={loading}
    className="h-12 w-full rounded-xl border border-[var(--input-border)] bg-[var(--input)] px-4 outline-none transition focus:border-[var(--primary)] focus:ring-4 focus:ring-[var(--primary-soft-strong)]"
  >
    <option value="USER">Student / User</option>
    <option value="ADMIN">Admin</option>
    <option value="VENDOR">Vendor</option>
  </select>
</div>

            

              {/* EMAIL */}

              <div>
                <label
                  htmlFor="login-email"
                  className="mb-2 block text-sm font-medium text-text-primary"
                >
                  Email
                </label>

                <input
                  id="login-email"
                  type="email"
                  placeholder="Email Address"
                  value={email}
                  onChange={(e) =>
                    setEmail(e.target.value)
                  }
                  disabled={loading}
                  autoComplete="email"
                  aria-label="Email"
                  className="h-12 w-full rounded-xl border border-[var(--input-border)] bg-[var(--input)] px-4 outline-none transition focus:border-[var(--primary)] focus:ring-4 focus:ring-[var(--primary-soft-strong)] disabled:cursor-not-allowed disabled:opacity-60"
                />
              </div>

              {/* PASSWORD */}

              <div>
                <div className="mb-2 flex items-center justify-between gap-3">
                  <label
                    htmlFor="login-password"
                    className="text-sm font-medium text-text-primary"
                  >
                    Password
                  </label>

                  <button
                    type="button"
                    onClick={() =>
                      setShowPassword(
                        (previous) => !previous
                      )
                    }
                    aria-label={
                      showPassword
                        ? "Hide password"
                        : "Show password"
                    }
                    className="-m-1.5 rounded-lg p-1.5 text-text-muted! transition hover:text-brand!"
                  >
                    {showPassword ? (
                      <EyeOff size={18} />
                    ) : (
                      <Eye size={18} />
                    )}
                  </button>
                </div>

                <input
                  id="login-password"
                  type={
                    showPassword
                      ? "text"
                      : "password"
                  }
                  placeholder="Password"
                  value={password}
                  onChange={(e) =>
                    setPassword(e.target.value)
                  }
                  disabled={loading}
                  autoComplete="current-password"
                  aria-label="Password"
                  className="h-12 w-full rounded-xl border border-[var(--input-border)] bg-[var(--input)] px-4 outline-none transition focus:border-[var(--primary)] focus:ring-4 focus:ring-[var(--primary-soft-strong)] disabled:cursor-not-allowed disabled:opacity-60"
                />
              </div>

              {/* REMEMBER / FORGOT */}

              <div className="flex items-center justify-between gap-3 pt-1">
                <label className="flex cursor-pointer items-center gap-2.5 text-sm text-text-secondary">
                  <input
                    type="checkbox"
                    checked={rememberMe}
                    onChange={(e) =>
                      setRememberMe(e.target.checked)
                    }
                    disabled={loading}
                    className="h-4 w-4 cursor-pointer rounded border-input-border accent-brand-hover"
                  />

                  <span>
                    Remember me
                  </span>
                </label>

                <Link
                  href="/forgot-password"
                  className="shrink-0 text-sm font-medium text-brand! transition-colors hover:text-brand-hover!"
                >
                  Forgot Password?
                </Link>
              </div>

              {/* LOGIN BUTTON */}

              <button
                type="submit"
                disabled={loading}
                className="cv-press group flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[var(--accent)] font-semibold! text-[var(--on-accent)] shadow-[var(--accent-shadow)] transition-all hover:bg-[var(--accent-hover)] active:bg-[var(--accent-active)] active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-60"
              >

                {loading ? (
                  "Logging In..."
                ) : (
                  <>
                    <span>
                      Log In
                    </span>

                    <ArrowRight
                      size={18}
                      className="transition-transform group-hover:translate-x-0.5"
                    />
                  </>
                )}

              </button>

            </form>

            {/* DIVIDER */}

            <div className="my-6 flex items-center gap-4">
              <div className="h-px flex-1 bg-border" />

              <span className="whitespace-nowrap text-xs font-medium uppercase tracking-wide text-text-muted">
                or continue with
              </span>

              <div className="h-px flex-1 bg-border" />
            </div>

            {/* GOOGLE LOGIN */}

            <button
              type="button"
              disabled={loading}
              onClick={handleGoogleLogin}
              className="cv-press flex h-12 w-full items-center justify-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] font-semibold! text-text-primary! shadow-[var(--shadow-card)] transition hover:bg-[var(--surface-secondary)] active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] disabled:cursor-not-allowed disabled:opacity-50"
            >

              <GoogleIcon />

              <span>
                Continue with Google
              </span>

            </button>

            {/* SIGNUP */}

            <p className="mt-7 text-center text-sm">
              Don&apos;t have an account?{" "}

              <Link
                href="/signup"
                className="font-semibold text-brand! transition-colors hover:text-brand-hover!"
              >
                Sign up
              </Link>
            </p>

            {/* VENDOR ACTIVATION ENTRY POINT */}

            <p className="mt-3 text-center text-sm">
              Are you a vendor?{" "}

              <Link
                href="/vendor/activate"
                className="font-semibold text-brand! transition-colors hover:text-brand-hover!"
              >
                Activate your account
              </Link>
            </p>

          </motion.div>

        </section>

      </main>
    </MotionConfig>
  );
}

/* ============================================================
   GOOGLE ICON
============================================================ */

function GoogleIcon() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      aria-hidden="true"
      className="shrink-0"
    >
      <path
        fill="#4285F4"
        d="M21.35 12.27c0-.79-.07-1.55-.2-2.27H12v4.3h5.23a4.47 4.47 0 0 1-1.94 2.93v2.78h3.14c1.84-1.7 2.92-4.2 2.92-7.74Z"
      />

      <path
        fill="#34A853"
        d="M12 21.75c2.62 0 4.82-.87 6.43-2.36l-3.14-2.78c-.87.58-1.98.92-3.29.92-2.53 0-4.67-1.7-5.44-4v2.86H3.32v2.87A9.72 9.72 0 0 0 12 21.75Z"
      />

      <path
        fill="#FBBC05"
        d="M6.56 13.53A5.84 5.84 0 0 1 6.25 12c0-.53.11-1.04.31-1.53V7.61H3.32A9.72 9.72 0 0 0 2.25 12c0 1.57.38 3.05 1.07 4.39l3.24-2.86Z"
      />

      <path
        fill="#EA4335"
        d="M12 6.47c1.43 0 2.71.49 3.72 1.45l2.79-2.79C16.81 3.54 14.62 2.25 12 2.25a9.72 9.72 0 0 0-8.68 5.36l3.24 2.86c.77-2.3 2.91-4 5.44-4Z"
      />
    </svg>
  );
}
