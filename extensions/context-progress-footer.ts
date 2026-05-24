import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

function formatTokens(count: number): string {
	if (count < 1000) return count.toString();
	if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
	if (count < 1000000) return `${Math.round(count / 1000)}k`;
	if (count < 10000000) return `${(count / 1000000).toFixed(1)}M`;
	return `${Math.round(count / 1000000)}M`;
}

function sanitizeStatusText(text: string): string {
	return text
		.replace(/[\r\n\t]/g, " ")
		.replace(/ +/g, " ")
		.trim();
}

function progressBar(percent: number | null, width: number): string {
	const safeWidth = Math.max(4, width);
	if (percent === null) return "?".repeat(safeWidth);

	const clamped = Math.max(0, Math.min(100, percent));
	const filled = Math.round((clamped / 100) * safeWidth);
	return "█".repeat(filled) + "░".repeat(safeWidth - filled);
}

function contextColor(percent: number | null): "dim" | "warning" | "error" {
	if (percent === null) return "dim";
	if (percent > 90) return "error";
	if (percent > 70) return "warning";
	return "dim";
}

export default function contextProgressFooterExtension(pi: ExtensionAPI) {
	pi.on("session_start", (_event, ctx) => {
		if (!ctx.hasUI) return;

		ctx.ui.setFooter((tui, theme, footerData) => {
			const unsubscribe = footerData.onBranchChange(() => tui.requestRender());

			return {
				dispose: unsubscribe,
				invalidate() {},

				render(width: number): string[] {
					let input = 0;
					let output = 0;
					let cacheRead = 0;
					let cacheWrite = 0;
					let cost = 0;

					for (const entry of ctx.sessionManager.getEntries()) {
						if (entry.type === "message" && entry.message.role === "assistant") {
							const usage = entry.message.usage;
							input += usage.input;
							output += usage.output;
							cacheRead += usage.cacheRead;
							cacheWrite += usage.cacheWrite;
							cost += usage.cost.total;
						}
					}

					let cwd = ctx.sessionManager.getCwd();
					const home = process.env.HOME || process.env.USERPROFILE;
					if (home && cwd.startsWith(home)) {
						cwd = `~${cwd.slice(home.length)}`;
					}

					const branch = footerData.getGitBranch();
					if (branch) cwd = `${cwd} (${branch})`;

					const sessionName = ctx.sessionManager.getSessionName();
					if (sessionName) cwd = `${cwd} • ${sessionName}`;

					const usage = ctx.getContextUsage();
					const contextWindow = usage?.contextWindow ?? ctx.model?.contextWindow ?? 0;
					const tokens = usage?.tokens ?? null;
					const percent = usage?.percent ?? null;
					const percentLabel = percent === null ? "?" : `${percent.toFixed(1)}%`;
					const tokenLabel = tokens === null ? "?" : formatTokens(tokens);
					const contextLabel = `${percentLabel}/${formatTokens(contextWindow)}`;

					const barWidth = width >= 100 ? 24 : width >= 80 ? 18 : 10;
					const color = contextColor(percent);
					const bar = theme.fg(color, `[${progressBar(percent, barWidth)}]`);
					const contextPart = `${theme.fg("dim", "ctx ")}${bar} ${theme.fg(color, contextLabel)} ${theme.fg("dim", `(${tokenLabel})`)}`;

					const statsParts: string[] = [];
					if (input) statsParts.push(`↑${formatTokens(input)}`);
					if (output) statsParts.push(`↓${formatTokens(output)}`);
					if (cacheRead) statsParts.push(`R${formatTokens(cacheRead)}`);
					if (cacheWrite) statsParts.push(`W${formatTokens(cacheWrite)}`);

					const usingSubscription = ctx.model ? ctx.modelRegistry.isUsingOAuth(ctx.model) : false;
					if (cost || usingSubscription) {
						statsParts.push(`$${cost.toFixed(3)}${usingSubscription ? " (sub)" : ""}`);
					}

					const statsLeft = [contextPart, theme.fg("dim", statsParts.join(" "))].filter(Boolean).join(theme.fg("dim", "  "));

					const modelName = ctx.model?.id || "no-model";
					let rightSide = modelName;
					if (ctx.model?.reasoning) {
						const thinkingLevel = pi.getThinkingLevel?.() || "off";
						rightSide = thinkingLevel === "off" ? `${modelName} • thinking off` : `${modelName} • ${thinkingLevel}`;
					}
					if (footerData.getAvailableProviderCount() > 1 && ctx.model) {
						const withProvider = `(${ctx.model.provider}) ${rightSide}`;
						if (visibleWidth(statsLeft) + 2 + visibleWidth(withProvider) <= width) {
							rightSide = withProvider;
						}
					}

					let statsLine: string;
					const statsWidth = visibleWidth(statsLeft);
					const rightWidth = visibleWidth(rightSide);
					if (statsWidth + 2 + rightWidth <= width) {
						statsLine = statsLeft + " ".repeat(width - statsWidth - rightWidth) + theme.fg("dim", rightSide);
					} else {
						const availableForRight = width - statsWidth - 2;
						statsLine =
							availableForRight > 0
								? statsLeft + "  " + theme.fg("dim", truncateToWidth(rightSide, availableForRight, ""))
								: truncateToWidth(statsLeft, width, "...");
					}

					const lines = [truncateToWidth(theme.fg("dim", cwd), width, theme.fg("dim", "...")), truncateToWidth(statsLine, width)];

					const statuses = Array.from(footerData.getExtensionStatuses().entries())
						.sort(([a], [b]) => a.localeCompare(b))
						.map(([, text]) => sanitizeStatusText(text));
					if (statuses.length > 0) {
						lines.push(truncateToWidth(statuses.join(" "), width, theme.fg("dim", "...")));
					}

					return lines;
				},
			};
		});
	});
}
