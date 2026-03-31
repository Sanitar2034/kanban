import * as RadixCheckbox from "@radix-ui/react-checkbox";
import { Check, Loader2 } from "lucide-react";
import { type FormEvent, type ReactElement, useEffect, useId, useState } from "react";
import { ClineIcon } from "@/components/ui/cline-icon";
import { cn } from "@/components/ui/cn";
import { Spinner } from "@/components/ui/spinner";

// ── Types ──────────────────────────────────────────────────────────────────

interface LoginConfig {
	authMode: "workos" | "password" | "both";
	hasClineToken: boolean;
	vapidPublicKey: string | null;
}

interface LoginPageProps {
	onSuccess: () => void;
}

// ── Reusable input component ───────────────────────────────────────────────

function LoginInput({
	id,
	type,
	value,
	onChange,
	placeholder,
	disabled,
	autoComplete,
}: {
	id: string;
	type: "text" | "password" | "email";
	value: string;
	onChange: (v: string) => void;
	placeholder: string;
	disabled?: boolean;
	autoComplete?: string;
}): ReactElement {
	return (
		<input
			id={id}
			type={type}
			value={value}
			onChange={(e) => onChange(e.target.value)}
			placeholder={placeholder}
			disabled={disabled}
			autoComplete={autoComplete}
			className={cn(
				"w-full rounded-md border border-border bg-surface-2 px-3 py-2",
				"text-[13px] text-text-primary placeholder:text-text-tertiary",
				"focus:border-border-focus focus:outline-none",
				"disabled:cursor-not-allowed disabled:opacity-50",
				"transition-colors",
			)}
		/>
	);
}

// ── Main component ─────────────────────────────────────────────────────────

export function LoginPage({ onSuccess }: LoginPageProps): ReactElement {
	const [config, setConfig] = useState<LoginConfig | null>(null);
	const [configError, setConfigError] = useState(false);

	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [persistent, setPersistent] = useState(false);

	const [isSubmitting, setIsSubmitting] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const rememberMeId = useId();
	const emailId = useId();
	const passwordId = useId();

	// Load login config on mount to know which methods to show.
	useEffect(() => {
		fetch("/login/config", { credentials: "include", headers: { Accept: "application/json" } })
			.then(async (res) => {
				if (!res.ok) throw new Error("Config unavailable");
				const body = (await res.json()) as LoginConfig;
				setConfig(body);
			})
			.catch(() => {
				// Fall back to showing both methods if config is unavailable.
				setConfig({ authMode: "both", hasClineToken: false, vapidPublicKey: null });
				setConfigError(true);
			});
	}, []);

	// ── WorkOS sign-in ─────────────────────────────────────────────────────
	// For all users (local and remote), /auth/start handles the OAuth relay.
	// Localhost never reaches this page, so this is always the remote flow.
	const handleWorkosSignIn = () => {
		window.location.href = "/auth/start";
	};

	// ── Password sign-in ───────────────────────────────────────────────────
	const handlePasswordSubmit = async (e: FormEvent) => {
		e.preventDefault();
		if (!password.trim() || isSubmitting) return;
		setIsSubmitting(true);
		setError(null);

		try {
			const res = await fetch("/login/password", {
				method: "POST",
				credentials: "include",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					email: email.trim() || undefined,
					password,
					persistent,
				}),
			});

			if (res.ok) {
				onSuccess();
				return;
			}

			const body = (await res.json().catch(() => ({}))) as { error?: string };
			if (res.status === 401) {
				setError("Invalid email or password.");
			} else if (res.status === 400) {
				setError(body.error ?? "Invalid request.");
			} else if (res.status === 403) {
				setError("Your account is not authorised to access this instance.");
			} else {
				setError(body.error ?? "Sign in failed. Please try again.");
			}
		} catch {
			setError("Could not reach the server. Please try again.");
		} finally {
			setIsSubmitting(false);
		}
	};

	const showWorkos = config?.authMode === "workos" || config?.authMode === "both";
	const showPassword = config?.authMode === "password" || config?.authMode === "both";
	const showDivider = config?.authMode === "both";

	// ── Render ─────────────────────────────────────────────────────────────
	return (
		<div className="flex min-h-screen items-center justify-center bg-surface-0 p-4">
			<div className={cn("w-full max-w-sm rounded-xl border border-border bg-surface-1 p-8 shadow-2xl")}>
				{/* Logo + title */}
				<div className="mb-6 flex flex-col items-center gap-3">
					<ClineIcon size={40} className="text-text-primary" />
					<div className="text-center">
						<h1 className="text-lg font-semibold text-text-primary">Sign in to Kanban</h1>
						<p className="mt-1 text-[13px] text-text-secondary">Enter your credentials to continue</p>
					</div>
				</div>

				{/* Config loading state */}
				{config === null && !configError ? (
					<div className="flex justify-center py-6">
						<Spinner size={20} />
					</div>
				) : (
					<div className="flex flex-col gap-4">
						{/* WorkOS / Cline sign-in */}
						{showWorkos ? (
							<button
								type="button"
								onClick={handleWorkosSignIn}
								className={cn(
									"flex w-full items-center justify-center gap-2 rounded-md",
									"bg-accent px-3 py-2 text-[13px] font-medium text-white",
									"hover:bg-accent-hover active:opacity-90",
									"transition-colors disabled:cursor-not-allowed disabled:opacity-50",
								)}
							>
								<ClineIcon size={14} className="shrink-0" />
								Sign in with Cline
							</button>
						) : null}

						{/* Divider */}
						{showDivider ? (
							<div className="flex items-center gap-2">
								<div className="h-px flex-1 bg-border" />
								<span className="text-xs text-text-tertiary">or</span>
								<div className="h-px flex-1 bg-border" />
							</div>
						) : null}

						{/* Password form */}
						{showPassword ? (
							<form onSubmit={(e) => void handlePasswordSubmit(e)} className="flex flex-col gap-3">
								{/* Email — shown when both methods are available or mode is password */}
								{(showPassword && showWorkos) || config?.authMode === "password" ? (
									<div className="flex flex-col gap-1">
										<label htmlFor={emailId} className="text-xs font-medium text-text-secondary">
											Email
											<span className="ml-1 text-text-tertiary">(optional)</span>
										</label>
										<LoginInput
											id={emailId}
											type="email"
											value={email}
											onChange={setEmail}
											placeholder="you@example.com"
											disabled={isSubmitting}
											autoComplete="email"
										/>
									</div>
								) : null}

								<div className="flex flex-col gap-1">
									<label htmlFor={passwordId} className="text-xs font-medium text-text-secondary">
										Password
									</label>
									<LoginInput
										id={passwordId}
										type="password"
										value={password}
										onChange={setPassword}
										placeholder="••••••••"
										disabled={isSubmitting}
										autoComplete="current-password"
									/>
								</div>

								{/* Remember me */}
								<label
									htmlFor={rememberMeId}
									className="flex cursor-pointer items-center gap-2 text-[13px] text-text-secondary select-none"
								>
									<RadixCheckbox.Root
										id={rememberMeId}
										checked={persistent}
										onCheckedChange={(checked) => setPersistent(checked === true)}
										disabled={isSubmitting}
										className="flex h-3.5 w-3.5 shrink-0 cursor-pointer items-center justify-center rounded-sm border border-border-bright bg-surface-3 data-[state=checked]:border-accent data-[state=checked]:bg-accent disabled:cursor-default disabled:opacity-40"
									>
										<RadixCheckbox.Indicator>
											<Check size={10} className="text-white" />
										</RadixCheckbox.Indicator>
									</RadixCheckbox.Root>
									Remember me for 30 days
								</label>

								{/* Submit */}
								<button
									type="submit"
									disabled={!password.trim() || isSubmitting}
									className={cn(
										"flex w-full items-center justify-center gap-2 rounded-md",
										"bg-accent px-3 py-2 text-[13px] font-medium text-white",
										"hover:bg-accent-hover active:opacity-90",
										"transition-colors disabled:cursor-not-allowed disabled:opacity-50",
									)}
								>
									{isSubmitting ? <Loader2 size={14} className="animate-spin" /> : null}
									Sign in
								</button>
							</form>
						) : null}

						{/* Error message */}
						{error ? <p className="text-center text-[13px] text-status-red">{error}</p> : null}
					</div>
				)}
			</div>
		</div>
	);
}
