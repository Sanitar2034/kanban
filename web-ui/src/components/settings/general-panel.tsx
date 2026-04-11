import * as RadixSelect from "@radix-ui/react-select";
import * as RadixSwitch from "@radix-ui/react-switch";
import { Check, ChevronDown, ExternalLink } from "lucide-react";
import type { ReactElement } from "react";

import { SettingRow } from "@/components/settings/setting-row";
import { SettingSection } from "@/components/settings/setting-section";
import { Button } from "@/components/ui/button";
import { previewThemeId, THEME_GROUPS, THEMES, type ThemeId } from "@/hooks/use-theme";
import type { RuntimeConfigResponse } from "@/runtime/types";
import type { BrowserNotificationPermission } from "@/utils/notification-permission";
import { formatPathForDisplay } from "@/utils/path-display";

function formatNotificationPermissionStatus(permission: BrowserNotificationPermission): string {
	if (permission === "default") {
		return "not requested yet";
	}
	return permission;
}

function ThemeSwatch({ themeId }: { themeId: ThemeId }): ReactElement {
	const theme = THEMES.find((t) => t.id === themeId);
	return (
		<span className="flex shrink-0 h-5 w-10 rounded overflow-hidden border border-border">
			<span className="flex-1" style={{ background: theme?.surface ?? "#1F2428" }} />
			<span className="flex-1" style={{ background: theme?.accent ?? "#0084FF" }} />
			<span className="flex-1" style={{ background: theme?.accent2 ?? "#7C5CFF" }} />
		</span>
	);
}

export function GeneralPanel({
	config,
	draftThemeId,
	onThemeChange,
	onResetLayout,
	readyForReviewNotificationsEnabled,
	onReadyForReviewNotificationsChange,
	notificationPermission,
	onRequestPermission,
	onOpenFilePath,
	controlsDisabled,
}: {
	config: RuntimeConfigResponse | null;
	draftThemeId: ThemeId;
	onThemeChange: (themeId: ThemeId) => void;
	onResetLayout: () => void;
	readyForReviewNotificationsEnabled: boolean;
	onReadyForReviewNotificationsChange: (enabled: boolean) => void;
	notificationPermission: BrowserNotificationPermission;
	onRequestPermission: () => void;
	onOpenFilePath: (filePath: string) => void;
	controlsDisabled: boolean;
}): ReactElement {
	return (
		<div>
			<div className="sticky top-[-20px] -mx-5 px-5 -mt-5 pt-5 pb-3 mb-4 bg-surface-1 z-10">
				<h2 className="text-base font-semibold text-text-primary m-0 mb-1">General</h2>
				<p className="text-[12px] text-text-secondary m-0">Appearance, notifications, and configuration files.</p>
			</div>

			<SettingSection title="Appearance">
				<SettingRow label="Theme" description="Choose a color theme for the interface.">
					<RadixSelect.Root
						value={draftThemeId}
						onValueChange={(value) => {
							onThemeChange(value as ThemeId);
							previewThemeId(value as ThemeId);
						}}
						onOpenChange={(open) => {
							if (!open) {
								previewThemeId(draftThemeId);
							}
						}}
					>
						<RadixSelect.Trigger
							className="flex h-9 w-full items-center justify-between rounded-md border border-border bg-surface-2 px-3 text-[13px] text-text-primary outline-none transition-colors hover:bg-surface-3 focus:border-border-focus"
							aria-label="Theme"
						>
							<span className="flex items-center gap-2.5">
								<ThemeSwatch themeId={draftThemeId} />
								<RadixSelect.Value />
							</span>
							<RadixSelect.Icon>
								<ChevronDown size={14} className="text-text-tertiary" />
							</RadixSelect.Icon>
						</RadixSelect.Trigger>
						<RadixSelect.Portal>
							<RadixSelect.Content
								className="z-50 max-h-72 w-(--radix-select-trigger-width) overflow-auto rounded-lg border border-border bg-surface-1 p-1 shadow-xl"
								position="popper"
								sideOffset={4}
								align="start"
							>
								<RadixSelect.Viewport>
									{THEME_GROUPS.map((group) => {
										const groupThemes = THEMES.filter((t) => t.group === group.key);
										if (groupThemes.length === 0) return null;
										return (
											<RadixSelect.Group key={group.key}>
												<RadixSelect.Label className="px-2 pt-2 pb-1 text-[11px] font-medium uppercase tracking-wider text-text-tertiary">
													{group.label}
												</RadixSelect.Label>
												{groupThemes.map((theme) => (
													<RadixSelect.Item
														key={theme.id}
														value={theme.id}
														className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-[13px] text-text-secondary outline-none data-highlighted:bg-surface-3 data-highlighted:text-text-primary data-[state=checked]:text-text-primary"
														onMouseEnter={() => previewThemeId(theme.id)}
														onFocus={() => previewThemeId(theme.id)}
													>
														<ThemeSwatch themeId={theme.id} />
														<RadixSelect.ItemText>{theme.label}</RadixSelect.ItemText>
														<RadixSelect.ItemIndicator className="ml-auto">
															<Check size={14} className="text-accent-2" />
														</RadixSelect.ItemIndicator>
													</RadixSelect.Item>
												))}
											</RadixSelect.Group>
										);
									})}
								</RadixSelect.Viewport>
							</RadixSelect.Content>
						</RadixSelect.Portal>
					</RadixSelect.Root>
				</SettingRow>

				<SettingRow
					label="Layout"
					description="Reset sidebar, split pane, and terminal resize customizations."
					control={
						<Button size="sm" onClick={onResetLayout} disabled={controlsDisabled}>
							Reset layout
						</Button>
					}
				/>
			</SettingSection>

			<SettingSection title="Notifications">
				<SettingRow
					label="Notify when task is ready for review"
					description="Send a browser notification when a task moves to the review column."
					control={
						<RadixSwitch.Root
							checked={readyForReviewNotificationsEnabled}
							disabled={controlsDisabled}
							onCheckedChange={onReadyForReviewNotificationsChange}
							className="relative h-5 w-9 rounded-full bg-surface-4 data-[state=checked]:bg-accent cursor-pointer disabled:opacity-40"
						>
							<RadixSwitch.Thumb className="block h-4 w-4 rounded-full bg-white shadow-sm transition-transform translate-x-0.5 data-[state=checked]:translate-x-[18px]" />
						</RadixSwitch.Root>
					}
				/>
				<SettingRow
					label="Browser permission"
					description={formatNotificationPermissionStatus(notificationPermission)}
					noBorder
					control={
						notificationPermission !== "granted" && notificationPermission !== "unsupported" ? (
							<Button size="sm" onClick={onRequestPermission} disabled={controlsDisabled}>
								Request
							</Button>
						) : null
					}
				/>
			</SettingSection>

			<SettingSection title="Configuration files">
				<SettingRow
					label="Global config"
					noBorder={!config?.projectConfigPath}
					description={
						<span
							className="font-mono text-[11px] break-all cursor-pointer hover:text-text-primary transition-colors"
							onClick={() => {
								if (config?.globalConfigPath) {
									onOpenFilePath(config.globalConfigPath);
								}
							}}
						>
							{config?.globalConfigPath
								? formatPathForDisplay(config.globalConfigPath)
								: "~/.cline/kanban/config.json"}
							{config?.globalConfigPath ? <ExternalLink size={10} className="inline ml-1 align-middle" /> : null}
						</span>
					}
				/>
				{config?.projectConfigPath ? (
					<SettingRow
						label="Project config"
						noBorder
						description={
							<span
								className="font-mono text-[11px] break-all cursor-pointer hover:text-text-primary transition-colors"
								onClick={() => {
									if (config.projectConfigPath) {
										onOpenFilePath(config.projectConfigPath);
									}
								}}
							>
								{formatPathForDisplay(config.projectConfigPath)}
								<ExternalLink size={10} className="inline ml-1 align-middle" />
							</span>
						}
					/>
				) : null}
			</SettingSection>
		</div>
	);
}
