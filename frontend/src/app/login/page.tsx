"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { ArrowRight, Eye, EyeOff, Landmark, Lock, ShieldCheck, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { BrandMark } from "@/components/shared/brand-mark";
import { useAuth } from "@/hooks/use-auth";
import { toast } from "sonner";
import { api, errorMessage } from "@/lib/api";
import type { Loan } from "@/lib/types";

export default function LoginPage() {
  const router = useRouter();
  const { signIn, user, ready } = useAuth();
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [showPassword, setShowPassword] = React.useState(false);
  const [remember, setRemember] = React.useState(true);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (ready && user) router.replace("/dashboard");
  }, [ready, user, router]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    if (!email.includes("@")) {
      setError("Enter a valid work email address.");
      return;
    }
    if (!password) {
      setError("Enter your password.");
      return;
    }

    setSubmitting(true);
    try {
      // The role is whatever the server says it is. The demo let the client
      // pick its own role from a dropdown; that field is gone.
      await signIn(email.trim(), password);
      toast.success("Signed in");
      router.push("/dashboard");
    } catch (err) {
      setError(errorMessage(err, "Could not sign in. Check your details and try again."));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="grid min-h-screen lg:grid-cols-[1.1fr_1fr]">
      <section className="relative hidden flex-col justify-between overflow-hidden bg-[var(--navy)] p-10 text-white lg:flex">
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.16]"
          style={{
            backgroundImage:
              "linear-gradient(rgba(255,255,255,0.14) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.14) 1px, transparent 1px)",
            backgroundSize: "48px 48px",
          }}
        />
        <div className="pointer-events-none absolute -top-24 -right-24 size-[380px] rounded-full bg-[var(--primary)] opacity-30 blur-3xl" />

        <BrandMark className="relative" />

        <div className="relative max-w-lg space-y-6">
          <p className="eyebrow text-white/50">Loan tracking &amp; management</p>
          <h1 className="text-4xl leading-[1.1] font-semibold tracking-tight">
            Every file, every bank, one pipeline.
          </h1>
          <p className="text-sm leading-relaxed text-white/60">
            Track applications from login to disbursal across all partner lenders, reconcile
            commission settlements, and export straight to Tally, Excel, or PDF.
          </p>

          <div className="flex flex-wrap gap-4 pt-4 text-[11px] text-white/45">
            <span className="inline-flex items-center gap-1.5">
              <ShieldCheck className="size-3.5" /> Role based access control
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Landmark className="size-3.5" /> Multi-lender pipeline
            </span>
            <span className="inline-flex items-center gap-1.5">
              <TrendingUp className="size-3.5" /> Commission reconciliation
            </span>
          </div>
        </div>

        <p className="relative text-[11px] text-white/35">
          © 2024 Rise Next Banking Services. All rights reserved.
        </p>
      </section>

      <section className="flex items-center justify-center bg-[var(--background)] px-5 py-10">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="w-full max-w-sm"
        >
          <div className="mb-6 lg:hidden">
            <BrandMark tone="dark" />
          </div>

          <div className="space-y-1.5">
            <p className="eyebrow text-[var(--primary)]">Secure login</p>
            <h2 className="text-2xl font-semibold tracking-tight">Sign in to your workspace</h2>
            <p className="text-sm text-[var(--muted-foreground)]">
              Sign in with your work account. Your role and bank access are applied automatically.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="mt-7 space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@risenext.com"
                autoFocus
                autoComplete="email"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="password">Password</Label>
              <div className="relative">
                <Lock className="absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-[var(--muted-foreground)]" />
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  className="px-9"
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((prev) => !prev)}
                  className="absolute top-1/2 right-3 -translate-y-1/2 text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)]"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
            </div>

            <div className="flex items-center justify-between">
              <label className="flex items-center gap-2 text-xs text-[var(--muted-foreground)]">
                <Checkbox
                  checked={remember}
                  onCheckedChange={(value) => setRemember(Boolean(value))}
                />
                Remember me
              </label>
              <button
                type="button"
                onClick={() =>
                  toast.info("Password reset", {
                    description: "Contact your administrator to have your password reset.",
                  })
                }
                className="text-xs font-medium text-[var(--primary)] hover:underline"
              >
                Forgot password?
              </button>
            </div>

            {error && (
              <p className="rounded-md bg-[var(--danger-soft)] px-3 py-2 text-xs text-[var(--danger)]">
                {error}
              </p>
            )}

            <Button type="submit" className="h-10 w-full" disabled={submitting}>
              {submitting ? "Signing in…" : "Sign in"}
              {!submitting && <ArrowRight className="size-4" />}
            </Button>
          </form>

          <p className="mt-6 text-center text-[11px] text-[var(--muted-foreground)]">
            © 2024 Rise Next Banking Services. All rights reserved.
          </p>
        </motion.div>
      </section>
    </div>
  );
}
