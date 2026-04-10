import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { UseTaskAgentModelPickerResult } from "@/components/task-agent-model-picker";
import type { RuntimeAgentId, RuntimeClineProviderCatalogItem } from "@/runtime/types";

const fetchClineProviderCatalogMock = vi.hoisted(() => vi.fn());
const fetchClineProviderModelsMock = vi.hoisted(() => vi.fn());

vi.mock("@runtime-agent-catalog", () => ({
	getRuntimeLaunchSupportedAgentCatalog: vi.fn(() => [
		{ id: "cline", label: "Cline", binary: "cline" },
		{ id: "claude", label: "Claude Code", binary: "claude" },
	]),
}));

vi.mock("@/runtime/runtime-config-query", () => ({
	fetchClineProviderCatalog: fetchClineProviderCatalogMock,
	fetchClineProviderModels: fetchClineProviderModelsMock,
}));

function createProvider(
	id: string,
	name: string,
	enabled: boolean,
	defaultModelId: string | null = null,
): RuntimeClineProviderCatalogItem {
	return { id, name, oauthSupported: false, enabled, defaultModelId, baseUrl: null, supportsBaseUrl: false };
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
});

afterEach(() => {
	act(() => root.unmount());
	container.remove();
	vi.restoreAllMocks();
});

describe("useTaskAgentModelPicker – clineProviderOptions", () => {
	it("shows all providers except the default, regardless of enabled flag", async () => {
		const catalog: RuntimeClineProviderCatalogItem[] = [
			createProvider("cline", "Cline", true),
			createProvider("openrouter", "OpenRouter", false),
			createProvider("anthropic", "Anthropic", false),
		];
		fetchClineProviderCatalogMock.mockResolvedValue(catalog);
		fetchClineProviderModelsMock.mockResolvedValue([]);

		let snapshot: UseTaskAgentModelPickerResult | null = null;
		const { useTaskAgentModelPicker } = await import("@/components/task-agent-model-picker");

		function Harness() {
			const result = useTaskAgentModelPicker({
				active: true,
				workspaceId: null,
				agentId: "cline",
				clineProviderId: undefined,
				defaultAgentId: "cline",
				defaultProviderId: "cline",
				defaultModelId: null,
			});
			useEffect(() => {
				snapshot = result;
			});
			return null;
		}

		await act(async () => root.render(<Harness />));
		await act(async () => {
			await new Promise((r) => setTimeout(r, 0));
		});

		expect(snapshot).not.toBeNull();
		const options = snapshot!.clineProviderOptions;
		expect(options[0]).toEqual({ value: "", label: "Cline" });
		const nonDefault = options.slice(1);
		expect(nonDefault).toEqual([
			{ value: "openrouter", label: "OpenRouter" },
			{ value: "anthropic", label: "Anthropic" },
		]);
	});
	it("excludes the default provider from the explicit list", async () => {
		const catalog: RuntimeClineProviderCatalogItem[] = [
			createProvider("cline", "Cline", true),
			createProvider("anthropic", "Anthropic", true),
		];
		fetchClineProviderCatalogMock.mockResolvedValue(catalog);
		fetchClineProviderModelsMock.mockResolvedValue([]);

		let snapshot: UseTaskAgentModelPickerResult | null = null;
		const { useTaskAgentModelPicker } = await import("@/components/task-agent-model-picker");

		function Harness() {
			const result = useTaskAgentModelPicker({
				active: true,
				workspaceId: null,
				agentId: "cline",
				clineProviderId: undefined,
				defaultAgentId: "cline",
				defaultProviderId: "anthropic",
				defaultModelId: null,
			});
			useEffect(() => {
				snapshot = result;
			});
			return null;
		}

		await act(async () => root.render(<Harness />));
		await act(async () => {
			await new Promise((r) => setTimeout(r, 0));
		});

		expect(snapshot).not.toBeNull();
		const options = snapshot!.clineProviderOptions;
		expect(options[0]).toEqual({ value: "", label: "Anthropic" });
		const values = options.slice(1).map((o) => o.value);
		expect(values).toContain("cline");
		expect(values).not.toContain("anthropic");
	});

	it("returns only the default option when catalog is empty", async () => {
		fetchClineProviderCatalogMock.mockResolvedValue([]);
		fetchClineProviderModelsMock.mockResolvedValue([]);

		let snapshot: UseTaskAgentModelPickerResult | null = null;
		const { useTaskAgentModelPicker } = await import("@/components/task-agent-model-picker");

		function Harness() {
			const result = useTaskAgentModelPicker({
				active: true,
				workspaceId: null,
				agentId: "cline",
				clineProviderId: undefined,
				defaultAgentId: "cline",
				defaultProviderId: "cline",
				defaultModelId: null,
			});
			useEffect(() => {
				snapshot = result;
			});
			return null;
		}

		await act(async () => root.render(<Harness />));
		await act(async () => {
			await new Promise((r) => setTimeout(r, 0));
		});

		expect(snapshot).not.toBeNull();
		expect(snapshot!.clineProviderOptions).toEqual([{ value: "", label: "cline" }]);
	});
});

describe("useTaskAgentModelPicker – providerDefaultModels", () => {
	it("returns a map of provider ID → default model ID", async () => {
		const catalog: RuntimeClineProviderCatalogItem[] = [
			createProvider("anthropic", "Anthropic", true, "claude-opus-4-20250514"),
			createProvider("groq", "Groq", true, "llama-3.3-70b-versatile"),
			createProvider("openrouter", "OpenRouter", true), // no default model
		];
		fetchClineProviderCatalogMock.mockResolvedValue(catalog);
		fetchClineProviderModelsMock.mockResolvedValue([]);

		let snapshot: UseTaskAgentModelPickerResult | null = null;
		const { useTaskAgentModelPicker } = await import("@/components/task-agent-model-picker");

		function Harness() {
			const result = useTaskAgentModelPicker({
				active: true,
				workspaceId: null,
				agentId: "cline",
				clineProviderId: undefined,
				defaultAgentId: "cline",
				defaultProviderId: "anthropic",
				defaultModelId: "claude-opus-4-20250514",
			});
			useEffect(() => {
				snapshot = result;
			});
			return null;
		}

		await act(async () => root.render(<Harness />));
		await act(async () => {
			await new Promise((r) => setTimeout(r, 0));
		});

		expect(snapshot).not.toBeNull();
		expect(snapshot!.providerDefaultModels).toEqual({
			anthropic: "claude-opus-4-20250514",
			groq: "llama-3.3-70b-versatile",
		});
	});
});

describe("useTaskAgentModelPicker – provider-aware model default label", () => {
	it("shows the selected provider's default model name when provider is overridden", async () => {
		const catalog: RuntimeClineProviderCatalogItem[] = [
			createProvider("anthropic", "Anthropic", true, "claude-opus-4-20250514"),
			createProvider("groq", "Groq", true, "llama-3.3-70b-versatile"),
		];
		const groqModels = [
			{ id: "llama-3.3-70b-versatile", name: "Llama 3.3 70B" },
			{ id: "mixtral-8x7b-32768", name: "Mixtral 8x7B" },
		];
		fetchClineProviderCatalogMock.mockResolvedValue(catalog);
		fetchClineProviderModelsMock.mockResolvedValue(groqModels);

		let snapshot: UseTaskAgentModelPickerResult | null = null;
		const { useTaskAgentModelPicker } = await import("@/components/task-agent-model-picker");

		function Harness() {
			const result = useTaskAgentModelPicker({
				active: true,
				workspaceId: null,
				agentId: "cline",
				clineProviderId: "groq", // <-- explicit provider override to groq
				defaultAgentId: "cline",
				defaultProviderId: "anthropic",
				defaultModelId: "claude-opus-4-20250514", // global default is Anthropic's model
			});
			useEffect(() => {
				snapshot = result;
			});
			return null;
		}

		await act(async () => root.render(<Harness />));
		await act(async () => {
			await new Promise((r) => setTimeout(r, 0));
		});

		expect(snapshot).not.toBeNull();
		// The first model option should show groq's default model, not the global Anthropic model
		const defaultOption = snapshot!.clineModelOptions[0]!;
		expect(defaultOption.value).toBe("");
		expect(defaultOption.label).toBe("Llama 3.3 70B");
	});

	it("shows the global default model when no provider override is set", async () => {
		const catalog: RuntimeClineProviderCatalogItem[] = [
			createProvider("anthropic", "Anthropic", true, "claude-opus-4-20250514"),
			createProvider("groq", "Groq", true, "llama-3.3-70b-versatile"),
		];
		const anthropicModels = [
			{ id: "claude-opus-4-20250514", name: "Claude Opus 4" },
			{ id: "claude-sonnet-4-20250514", name: "Claude Sonnet 4" },
		];
		fetchClineProviderCatalogMock.mockResolvedValue(catalog);
		fetchClineProviderModelsMock.mockResolvedValue(anthropicModels);

		let snapshot: UseTaskAgentModelPickerResult | null = null;
		const { useTaskAgentModelPicker } = await import("@/components/task-agent-model-picker");

		function Harness() {
			const result = useTaskAgentModelPicker({
				active: true,
				workspaceId: null,
				agentId: "cline",
				clineProviderId: undefined, // <-- no provider override
				defaultAgentId: "cline",
				defaultProviderId: "anthropic",
				defaultModelId: "claude-opus-4-20250514",
			});
			useEffect(() => {
				snapshot = result;
			});
			return null;
		}

		await act(async () => root.render(<Harness />));
		await act(async () => {
			await new Promise((r) => setTimeout(r, 0));
		});

		expect(snapshot).not.toBeNull();
		const defaultOption = snapshot!.clineModelOptions[0]!;
		expect(defaultOption.value).toBe("");
		expect(defaultOption.label).toBe("Claude Opus 4");
	});
});

describe("TaskAgentModelPicker – auto-reset invalid model selection", () => {
	it("resets clineModelId to the first real model when the selected model is not in the options list", async () => {
		const onClineModelIdChange = vi.fn();
		const modelOptions = [
			{ value: "", label: "Llama 3.3 70B" },
			{ value: "llama-3.3-70b-versatile", label: "Llama 3.3 70B" },
			{ value: "mixtral-8x7b-32768", label: "Mixtral 8x7B" },
		];

		const { TaskAgentModelPicker } = await import("@/components/task-agent-model-picker");

		await act(async () =>
			root.render(
				<TaskAgentModelPicker
					agentId={"cline" as RuntimeAgentId}
					onAgentIdChange={() => {}}
					clineProviderId="groq"
					onClineProviderIdChange={() => {}}
					clineModelId="claude-opus-4-20250514" // <-- not in groq's model list
					onClineModelIdChange={onClineModelIdChange}
					agentOptions={[{ value: "", label: "Cline" }]}
					clineProviderOptions={[{ value: "", label: "Anthropic" }]}
					clineModelOptions={modelOptions}
					isLoadingProviders={false}
					isLoadingModels={false}
					defaultAgentId={"cline" as RuntimeAgentId}
					defaultProviderId="anthropic"
				/>,
			),
		);

		// The effect should have fired and selected the first real model
		expect(onClineModelIdChange).toHaveBeenCalledWith("llama-3.3-70b-versatile");
	});

	it("does not reset when the selected model exists in the options list", async () => {
		const onClineModelIdChange = vi.fn();
		const modelOptions = [
			{ value: "", label: "Llama 3.3 70B" },
			{ value: "llama-3.3-70b-versatile", label: "Llama 3.3 70B" },
			{ value: "mixtral-8x7b-32768", label: "Mixtral 8x7B" },
		];

		const { TaskAgentModelPicker } = await import("@/components/task-agent-model-picker");

		await act(async () =>
			root.render(
				<TaskAgentModelPicker
					agentId={"cline" as RuntimeAgentId}
					onAgentIdChange={() => {}}
					clineProviderId="groq"
					onClineProviderIdChange={() => {}}
					clineModelId="llama-3.3-70b-versatile" // <-- exists in the list
					onClineModelIdChange={onClineModelIdChange}
					agentOptions={[{ value: "", label: "Cline" }]}
					clineProviderOptions={[{ value: "", label: "Groq" }]}
					clineModelOptions={modelOptions}
					isLoadingProviders={false}
					isLoadingModels={false}
					defaultAgentId={"cline" as RuntimeAgentId}
					defaultProviderId="anthropic"
				/>,
			),
		);

		expect(onClineModelIdChange).not.toHaveBeenCalled();
	});

	it("does not reset while models are still loading", async () => {
		const onClineModelIdChange = vi.fn();
		const modelOptions = [{ value: "", label: "Default" }];

		const { TaskAgentModelPicker } = await import("@/components/task-agent-model-picker");

		await act(async () =>
			root.render(
				<TaskAgentModelPicker
					agentId={"cline" as RuntimeAgentId}
					onAgentIdChange={() => {}}
					clineProviderId="groq"
					onClineProviderIdChange={() => {}}
					clineModelId="claude-opus-4-20250514" // not in options
					onClineModelIdChange={onClineModelIdChange}
					agentOptions={[{ value: "", label: "Cline" }]}
					clineProviderOptions={[{ value: "", label: "Anthropic" }]}
					clineModelOptions={modelOptions}
					isLoadingProviders={false}
					isLoadingModels={true} // <-- still loading
					defaultAgentId={"cline" as RuntimeAgentId}
					defaultProviderId="anthropic"
				/>,
			),
		);

		expect(onClineModelIdChange).not.toHaveBeenCalled();
	});
});
