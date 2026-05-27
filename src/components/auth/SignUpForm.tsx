import React, { useEffect, useState } from "react";
import { Mail, Lock, UserPlus, AtSign, Check, LoaderCircle } from "lucide-react";
import { FormField } from "@/components/auth/FormField";
import { PasswordToggle } from "@/components/auth/PasswordToggle";
import { SubmitButton } from "@/components/auth/SubmitButton";
import { ServerError } from "@/components/auth/ServerError";
import { USERNAME_PATTERN, normalizeUsername } from "@/lib/username";

const MIN_PASSWORD_LENGTH = 6;

interface Props {
  serverError?: string | null;
}

export default function SignUpForm({ serverError }: Props) {
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  // Result keyed by the exact username it was fetched for; availability is derived
  // during render by comparing against the current input (avoids stale state and
  // synchronous setState in the effect).
  const [checkResult, setCheckResult] = useState<{ username: string; available: boolean } | null>(null);
  const [errors, setErrors] = useState<{
    username?: string;
    email?: string;
    password?: string;
    confirmPassword?: string;
  }>({});

  // Users may type capitals; everything downstream works on the lowercase form.
  const normalizedUsername = normalizeUsername(username);
  const usernameValid = USERNAME_PATTERN.test(normalizedUsername);
  const availability: "idle" | "checking" | "available" | "taken" = !usernameValid
    ? "idle"
    : checkResult?.username === normalizedUsername
      ? checkResult.available
        ? "available"
        : "taken"
      : "checking";

  useEffect(() => {
    if (!USERNAME_PATTERN.test(normalizedUsername)) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      fetch(`/api/auth/username-available?u=${encodeURIComponent(normalizedUsername)}`, { signal: controller.signal })
        .then((res) => res.json() as Promise<{ available: boolean }>)
        .then((body) => {
          setCheckResult({ username: normalizedUsername, available: body.available });
        })
        .catch(() => {
          // network/abort — leave the form usable; the server re-checks on submit
        });
    }, 400);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [normalizedUsername]);

  function validate() {
    const next: typeof errors = {};

    if (!normalizedUsername) {
      next.username = "Username is required";
    } else if (!USERNAME_PATTERN.test(normalizedUsername)) {
      next.username = "3–30 chars: letters, numbers, underscore";
    } else if (availability === "taken") {
      next.username = "This username is already taken";
    }

    if (!email.trim()) {
      next.email = "Email address is required";
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      next.email = "Please enter a valid email address";
    }

    if (!password) {
      next.password = "Password is required";
    } else if (password.length < MIN_PASSWORD_LENGTH) {
      next.password = `Password must be at least ${MIN_PASSWORD_LENGTH} characters`;
    }

    if (!confirmPassword) {
      next.confirmPassword = "Please confirm your password";
    } else if (password !== confirmPassword) {
      next.confirmPassword = "Passwords do not match";
    }

    setErrors(next);
    return Object.keys(next).length === 0;
  }

  function clearError(field: keyof typeof errors) {
    if (errors[field]) setErrors((prev) => ({ ...prev, [field]: undefined }));
  }

  function handleSubmit(e: React.SubmitEvent<HTMLFormElement>) {
    if (!validate()) {
      e.preventDefault();
    }
  }

  const passwordHint =
    !errors.password && password.length > 0 && password.length < MIN_PASSWORD_LENGTH ? (
      <p className="text-muted-foreground mt-1 text-xs">
        {MIN_PASSWORD_LENGTH - password.length} more{" "}
        {MIN_PASSWORD_LENGTH - password.length === 1 ? "character" : "characters"} needed
      </p>
    ) : undefined;

  return (
    <form method="POST" action="/api/auth/signup" className="space-y-4" onSubmit={handleSubmit} noValidate>
      <FormField
        id="username"
        label="Username"
        value={username}
        onChange={(v) => {
          setUsername(v);
          clearError("username");
        }}
        placeholder="your_nick"
        error={errors.username ?? (availability === "taken" ? "This username is already taken" : undefined)}
        icon={<AtSign className="size-4" />}
        endContent={
          availability === "checking" ? (
            <span className="text-muted-foreground absolute top-1/2 right-3 -translate-y-1/2">
              <LoaderCircle className="size-4 animate-spin" />
            </span>
          ) : availability === "available" ? (
            <span className="absolute top-1/2 right-3 -translate-y-1/2 text-green-400">
              <Check className="size-4" />
            </span>
          ) : undefined
        }
      />

      <FormField
        id="email"
        type="email"
        label="Email address"
        value={email}
        onChange={(v) => {
          setEmail(v);
          clearError("email");
        }}
        placeholder="name@example.com"
        error={errors.email}
        icon={<Mail className="size-4" />}
      />

      <FormField
        id="password"
        label="Password"
        type={showPassword ? "text" : "password"}
        value={password}
        onChange={(v) => {
          setPassword(v);
          clearError("password");
        }}
        placeholder="Min. 6 characters"
        error={errors.password}
        hint={passwordHint}
        icon={<Lock className="size-4" />}
        endContent={
          <PasswordToggle
            visible={showPassword}
            onToggle={() => {
              setShowPassword(!showPassword);
            }}
          />
        }
      />

      <FormField
        id="confirmPassword"
        name="confirmPassword"
        label="Confirm password"
        type={showConfirmPassword ? "text" : "password"}
        value={confirmPassword}
        onChange={(v) => {
          setConfirmPassword(v);
          clearError("confirmPassword");
        }}
        placeholder="Repeat your password"
        error={errors.confirmPassword}
        icon={<Lock className="size-4" />}
        endContent={
          <PasswordToggle
            visible={showConfirmPassword}
            onToggle={() => {
              setShowConfirmPassword(!showConfirmPassword);
            }}
          />
        }
      />

      <ServerError message={serverError} />

      <SubmitButton pendingText="Creating account..." icon={<UserPlus className="size-4" />}>
        Create account
      </SubmitButton>
    </form>
  );
}
