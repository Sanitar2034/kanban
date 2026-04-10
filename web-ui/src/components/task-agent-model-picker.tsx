import { getRuntimeLaunchSupportedAgentCatalog } from "@runtime-agent-catalog";
import { ChevronDown } from "lucide-react";
import type { ReactElement } from "react";
import { useEffect, useMemo, useState } from "react";

import { SearchSelectDropdown } from "@/components/search-select-dropdown";
import { fetchClineProviderCatalog, fetchClineProviderModels } from "@/runtime/runtime-config-query";
import type { RuntimeAgentId, RuntimeClineProviderCatalogItem, RuntimeClineProviderModel } from "@/runtime/types";

// ---------------------------------------------------------------------------
// Hook: manages fetch state for Cline provider catalog + model lists
// ---------------------------------------------------------------------------

export interface UseTaskAgentModelPickerInput {
	active: boolean;
	workspaceId: string | null;
	agentId: RuntimeAgentId | undefined;
	clineProviderId: string | undefined;
	/** The default agent ID from runtimeConfig.selectedAgentId — used to build the first option label */
	defaultAgentId?: RuntimeAgentId | null;
	/** The default Cline provider ID from runtimeConfig.clineProviderSettings.providerId */
	defaultProviderId?: string | null;
	/** The default Cline model ID from runtimeConfig.clineProviderSettings.modelId */
	defaultModelId?: string | null;
}

export interface UseTaskAgentModelPickerResult {
	agentOptions: Array<{ value: string; label: string }>;
	clineProviderOptions: Array<{ value: string; label: string }>;
	clineModelOptions: Array<{ value: string; label: string }>;
	isLoadingProviders: boolean;
	isLoadingModels: boolean;
	/** Map of provider ID → its default model ID (from the provider catalog). */
	providerDefaultModels: Record<string, string>;
}

export function useTaskAgentModelPicker({
	active,
	workspaceId,
	agentId,
	clineProviderId,
	defaultAgentId,
	defaultProviderId,
	defaultModelId,
}: UseTaskAgentModelPickerInput): UseTaskAgentModelPickerResult {
	const [providerCatalog, setProviderCatalog] = useState<RuntimeClineProviderCatalogItem[]>([]);
	const [providerModels, setProviderModels] = useState<RuntimeClineProviderModel[]>([]);
	const [isLoadingProviders, setIsLoadingProviders] = useState(false);
	const [isLoadingModels, setIsLoadingModels] = useState(false);

	// Derive the effective agent: explicit override takes precedence, then the global default
	const effectiveAgentId = agentId ?? defaultAgentId ?? null;

	useEffect(() => {
		if (!active || effectiveAgentId !== "cline") {
			return;
		}
		let cancelled = false;
		setIsLoadingProviders(true);
		void fetchClineProviderCatalog(workspaceId)
			.then((catalog) => {
				if (!cancelled) {
					setProviderCatalog(catalog);
				}
			})
			.catch(() => {
				if (!cancelled) {
					setProviderCatalog([]);
				}
			})
			.finally(() => {
				if (!cancelled) {
					setIsLoadingProviders(false);
				}
			});
		return () => {
			cancelled = true;
		};
	}, [active, effectiveAgentId, workspaceId]);

	// Derive the effective provider: explicit override takes precedence, then the global default
	const effectiveProviderId = (clineProviderId ?? defaultProviderId ?? "").trim() || null;

	useEffect(() => {
		if (!active || effectiveAgentId !== "cline" || !effectiveProviderId) {
			setProviderModels([]);
			return;
		}
		let cancelled = false;
		setIsLoadingModels(true);
		void fetchClineProviderModels(workspaceId, effectiveProviderId)
			.then((models) => {
				if (!cancelled) {
					setProviderModels(models);
				}
			})
			.catch(() => {
				if (!cancelled) {
					setProviderModels([]);
				}
			})
			.finally(() => {
				if (!cancelled) {
					setIsLoadingModels(false);
				}
			});
		return () => {
			cancelled = true;
		};
	}, [active, effectiveAgentId, effectiveProviderId, workspaceId]);

	const agentOptions = useMemo(() => {
		const catalog = getRuntimeLaunchSupportedAgentCatalog();
		let firstLabel = "Default";
		if (defaultAgentId) {
			const defaultAgent = catalog.find((a) => a.id === defaultAgentId);
			if (defaultAgent) {
				firstLabel = defaultAgent.label;
			}
		}
		return [
			{ value: "", label: firstLabel },
			// Exclude the default agent from the explicit list — it's already represented by the first option
			...catalog
				.filter((agent) => agent.id !== defaultAgentId)
				.map((agent) => ({ value: agent.id, label: agent.label })),
		];
	}, [defaultAgentId]);

	const clineProviderOptions = useMemo(() => {
		let firstLabel = "Default";
		if (defaultProviderId) {
			const defaultProvider = providerCatalog.find((p) => p.id === defaultProviderId);
			firstLabel = defaultProvider ? defaultProvider.name : defaultProviderId;
		}
		return [
			{ value: "", label: firstLabel },
			// Exclude the default provider from the explicit list — it's already represented by the first option
			...providerCatalog.filter((p) => p.id !== defaultProviderId).map((p) => ({ value: p.id, label: p.name })),
		];
	}, [providerCatalog, defaultProviderId]);

	// Map of provider ID → its catalog default model ID. Used by the component to
	// auto-select the right model when the user switches providers.
	const providerDefaultModels = useMemo(() => {
		const map: Record<string, string> = {};
		for (const p of providerCatalog) {
			if (p.defaultModelId) {
				map[p.id] = p.defaultModelId;
			}
		}
		return map;
	}, [providerCatalog]);

	// When an explicit provider override is selected, the "Default" model label should
	// reflect that provider's default model — not the global settings model.
	const effectiveDefaultModelId = useMemo(() => {
		if (clineProviderId) {
			const provider = providerCatalog.find((p) => p.id === clineProviderId);
			return provider?.defaultModelId ?? defaultModelId ?? null;
		}
		return defaultModelId ?? null;
	}, [clineProviderId, providerCatalog, defaultModelId]);

	const clineModelOptions = useMemo(() => {
		let defaultLabel = "Default";
		if (effectiveDefaultModelId) {
			const defaultModel = providerModels.find((m) => m.id === effectiveDefaultModelId);
			defaultLabel = defaultModel ? defaultModel.name : effectiveDefaultModelId;
		}
		return [
			{ value: "", label: defaultLabel },
			// Exclude the default model from the explicit list — it's already represented by the first option
			...providerModels.filter((m) => m.id !== effectiveDefaultModelId).map((m) => ({ value: m.id, label: m.name })),
		];
	}, [providerModels, effectiveDefaultModelId]);

	return {
		agentOptions,
		clineProviderOptions,
		clineModelOptions,
		isLoadingProviders,
		isLoadingModels,
		providerDefaultModels,
	};
}

// ---------------------------------------------------------------------------
// Component: renders Agent, Cline provider, and Cline model pickers
// ---------------------------------------------------------------------------

export function TaskAgentModelPicker({
	agentId,
	onAgentIdChange,
	clineProviderId,
	onClineProviderIdChange,
	clineModelId,
	onClineModelIdChange,
	agentOptions,
	clineProviderOptions,
	clineModelOptions,
	isLoadingProviders,
	isLoadingModels,
	onPopoverOpenChange,
	defaultAgentId,
	defaultProviderId,
	providerDefaultModels,
}: {
	agentId: RuntimeAgentId | undefined;
	onAgentIdChange: (value: RuntimeAgentId | undefined) => void;
	clineProviderId: string | undefined;
	onClineProviderIdChange: (value: string | undefined) => void;
	clineModelId: string | undefined;
	onClineModelIdChange: (value: string | undefined) => void;
	agentOptions: Array<{ value: string; label: string }>;
	clineProviderOptions: Array<{ value: string; label: string }>;
	clineModelOptions: Array<{ value: string; label: string }>;
	isLoadingProviders: boolean;
	isLoadingModels: boolean;
	onPopoverOpenChange?: (open: boolean) => void;
	/** The default agent ID from runtimeConfig — used to decide if Cline pickers should show by default */
	defaultAgentId?: RuntimeAgentId | null;
	/** The default Cline provider ID from runtimeConfig — used to decide if model picker should show by default */
	defaultProviderId?: string | null;
	/** Map of provider ID → its default model ID (from the provider catalog). */
	providerDefaultModels?: Record<string, string>;
}): ReactElement {
	// Show the Cline provider picker when the effective agent is "cline"
	// (either explicitly overridden to cline, or defaulting to cline)
	const effectiveAgentId = agentId ?? defaultAgentId ?? null;
	const showClineProviderPicker = effectiveAgentId === "cline";

	// Show the Cline model picker when a provider is effectively selected
	// (either explicitly overridden, or the global default provider is set)
	const effectiveProviderId = clineProviderId ?? defaultProviderId ?? null;
	const showClineModelPicker = showClineProviderPicker && Boolean(effectiveProviderId);

	// When models finish loading and the currently selected model isn't in the
	// options list, auto-select the first real model so the button never shows
	// "No models available". Pick the first non-empty option (skipping the
	// "Default" placeholder) so the user immediately sees a concrete model name.
	useEffect(() => {
		if (isLoadingModels || !clineModelId) {
			return;
		}
		const modelExists = clineModelOptions.some((opt) => opt.value === clineModelId);
		if (!modelExists) {
			const firstRealModel = clineModelOptions.find((opt) => opt.value !== "");
			onClineModelIdChange(firstRealModel?.value ?? undefined);
		}
	}, [isLoadingModels, clineModelId, clineModelOptions, onClineModelIdChange]);

	return (
		<div className="flex flex-col gap-2">
			<div>
				<span className="text-[11px] text-text-secondary block mb-1">Agent override</span>
				<div className="relative inline-flex w-full">
					<select
						value={agentId ?? ""}
						onChange={(e) => {
							const value = e.currentTarget.value;
							onAgentIdChange(value ? (value as RuntimeAgentId) : undefined);
							if (value !== "cline") {
								onClineProviderIdChange(undefined);
								onClineModelIdChange(undefined);
							}
						}}
						className="h-7 w-full appearance-none rounded-md border border-border-bright bg-surface-2 pl-2 pr-7 text-[12px] text-text-primary cursor-pointer focus:border-border-focus focus:outline-none"
					>
						{agentOptions.map((option) => (
							<option key={option.value} value={option.value}>
								{option.label}
							</option>
						))}
					</select>
					<ChevronDown
						size={14}
						className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 text-text-secondary"
					/>
				</div>
			</div>
			{showClineProviderPicker ? (
				<>
					<div>
						<span className="text-[11px] text-text-secondary block mb-1">
							Cline provider{isLoadingProviders ? " (loading\u2026)" : ""}
						</span>
						<div className="relative inline-flex w-full">
							<select
								value={clineProviderId ?? ""}
								onChange={(e) => {
									const newProviderId = e.currentTarget.value || undefined;
									onClineProviderIdChange(newProviderId);
									// Auto-select the new provider's default model so the
									// model dropdown shows a model that the provider supports.
									const newDefaultModel =
										newProviderId && providerDefaultModels ? providerDefaultModels[newProviderId] : undefined;
									onClineModelIdChange(newDefaultModel);
								}}
								disabled={isLoadingProviders}
								className="h-7 w-full appearance-none rounded-md border border-border-bright bg-surface-2 pl-2 pr-7 text-[12px] text-text-primary cursor-pointer focus:border-border-focus focus:outline-none disabled:opacity-50 disabled:cursor-default"
							>
								{clineProviderOptions.map((option) => (
									<option key={option.value} value={option.value}>
										{option.label}
									</option>
								))}
							</select>
							<ChevronDown
								size={14}
								className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 text-text-secondary"
							/>
						</div>
					</div>
					{showClineModelPicker ? (
						<div>
							<span className="text-[11px] text-text-secondary block mb-1">
								Cline model{isLoadingModels ? " (loading\u2026)" : ""}
							</span>
							<SearchSelectDropdown
								options={clineModelOptions}
								selectedValue={clineModelId ?? ""}
								onSelect={(value) => onClineModelIdChange(value || undefined)}
								disabled={isLoadingModels}
								fill
								size="sm"
								placeholder="Search models..."
								emptyText="No models available"
								noResultsText="No matching models"
								showSelectedIndicator
								buttonClassName="w-full justify-between rounded-md border-border-bright bg-surface-2 text-text-secondary shadow-none hover:bg-surface-3 hover:text-text-primary"
								onPopoverOpenChange={onPopoverOpenChange}
							/>
						</div>
					) : null}
				</>
			) : null}
		</div>
	);
}
