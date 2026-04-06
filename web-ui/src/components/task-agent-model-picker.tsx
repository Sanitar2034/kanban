import { getRuntimeLaunchSupportedAgentCatalog } from "@runtime-agent-catalog";
import { ChevronDown } from "lucide-react";
import type { ReactElement } from "react";
import { useEffect, useMemo, useState } from "react";

import { SearchSelectDropdown } from "@/components/search-select-dropdown";
import { fetchClineProviderCatalog, fetchClineProviderModels } from "@/runtime/runtime-config-query";
import type { RuntimeAgentId, RuntimeClineProviderCatalogItem, RuntimeClineProviderModel } from "@/runtime/types";

const AGENT_OPTIONS: Array<{ value: string; label: string }> = [
	{ value: "", label: "Default (from settings)" },
	...getRuntimeLaunchSupportedAgentCatalog().map((agent) => ({
		value: agent.id,
		label: agent.label,
	})),
];

// ---------------------------------------------------------------------------
// Hook: manages fetch state for Cline provider catalog + model lists
// ---------------------------------------------------------------------------

export interface UseTaskAgentModelPickerInput {
	active: boolean;
	workspaceId: string | null;
	agentId: RuntimeAgentId | undefined;
	clineProviderId: string | undefined;
}

export interface UseTaskAgentModelPickerResult {
	clineProviderOptions: Array<{ value: string; label: string }>;
	clineModelOptions: Array<{ value: string; label: string }>;
	isLoadingProviders: boolean;
	isLoadingModels: boolean;
}

export function useTaskAgentModelPicker({
	active,
	workspaceId,
	agentId,
	clineProviderId,
}: UseTaskAgentModelPickerInput): UseTaskAgentModelPickerResult {
	const [providerCatalog, setProviderCatalog] = useState<RuntimeClineProviderCatalogItem[]>([]);
	const [providerModels, setProviderModels] = useState<RuntimeClineProviderModel[]>([]);
	const [isLoadingProviders, setIsLoadingProviders] = useState(false);
	const [isLoadingModels, setIsLoadingModels] = useState(false);

	useEffect(() => {
		if (!active || agentId !== "cline") {
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
	}, [active, agentId, workspaceId]);

	useEffect(() => {
		const trimmedProvider = clineProviderId?.trim();
		if (!active || agentId !== "cline" || !trimmedProvider) {
			setProviderModels([]);
			return;
		}
		let cancelled = false;
		setIsLoadingModels(true);
		void fetchClineProviderModels(workspaceId, trimmedProvider)
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
	}, [active, agentId, clineProviderId, workspaceId]);

	const clineProviderOptions = useMemo(
		() => [
			{ value: "", label: "Default (from settings)" },
			...providerCatalog.filter((p) => p.enabled).map((p) => ({ value: p.id, label: p.name })),
		],
		[providerCatalog],
	);

	const clineModelOptions = useMemo(
		() => [
			{ value: "", label: "Default (from settings)" },
			...providerModels.map((m) => ({ value: m.id, label: m.name })),
		],
		[providerModels],
	);

	return { clineProviderOptions, clineModelOptions, isLoadingProviders, isLoadingModels };
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
	clineProviderOptions,
	clineModelOptions,
	isLoadingProviders,
	isLoadingModels,
	onPopoverOpenChange,
}: {
	agentId: RuntimeAgentId | undefined;
	onAgentIdChange: (value: RuntimeAgentId | undefined) => void;
	clineProviderId: string | undefined;
	onClineProviderIdChange: (value: string | undefined) => void;
	clineModelId: string | undefined;
	onClineModelIdChange: (value: string | undefined) => void;
	clineProviderOptions: Array<{ value: string; label: string }>;
	clineModelOptions: Array<{ value: string; label: string }>;
	isLoadingProviders: boolean;
	isLoadingModels: boolean;
	onPopoverOpenChange?: (open: boolean) => void;
}): ReactElement {
	const showClineModelPicker = agentId === "cline";

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
						{AGENT_OPTIONS.map((option) => (
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
				<>
					<div>
						<span className="text-[11px] text-text-secondary block mb-1">
							Cline provider{isLoadingProviders ? " (loading\u2026)" : ""}
						</span>
						<div className="relative inline-flex w-full">
							<select
								value={clineProviderId ?? ""}
								onChange={(e) => {
									onClineProviderIdChange(e.currentTarget.value || undefined);
									onClineModelIdChange(undefined);
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
				</>
			) : null}
		</div>
	);
}
