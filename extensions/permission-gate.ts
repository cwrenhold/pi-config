import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Key, matchesKey, truncateToWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";

interface GateDecision {
	reason: string;
	details?: string;
}

interface BashRule {
	name: string;
	pattern: RegExp;
	reason: string;
}

const dangerousBashRules: BashRule[] = [
	{
		name: "recursive-rm",
		pattern: /(^|[;&|\s])rm\s+(?:-[^\s]*r[^\s]*|--recursive)\b/i,
		reason: "recursive file deletion",
	},
	{
		name: "sudo",
		pattern: /(^|[;&|\s])sudo\b/i,
		reason: "privileged command via sudo",
	},
	{
		name: "chmod-chown",
		pattern: /(^|[;&|\s])(chmod|chown)\b/i,
		reason: "permission or ownership change",
	},
	{
		name: "download-pipe-shell",
		pattern: /\b(curl|wget)\b[\s\S]*\|[\s\S]*\b(sh|bash|zsh|fish)\b/i,
		reason: "downloaded script piped into a shell",
	},
	{
		name: "disk-write",
		pattern: /(^|[;&|\s])(dd|mkfs(?:\.[a-z0-9]+)?|fdisk|parted)\b/i,
		reason: "low-level disk operation",
	},
	{
		name: "power-control",
		pattern: /(^|[;&|\s])(shutdown|reboot|poweroff|halt)\b/i,
		reason: "system power/session control",
	},
	{
		name: "git-reset-hard",
		pattern: /\bgit\s+reset\s+--hard\b/i,
		reason: "destructive git reset",
	},
	{
		name: "git-clean-force",
		pattern: /\bgit\s+clean\s+-[^\s]*f/i,
		reason: "forced git clean can delete untracked files",
	},
];

function normalizePath(input: string): string {
	return input.replace(/\\/g, "/").replace(/^\.\//, "");
}

function pathSegments(input: string): string[] {
	return normalizePath(input)
		.split("/")
		.filter((segment) => segment.length > 0);
}

function basename(input: string): string {
	const segments = pathSegments(input);
	return segments[segments.length - 1] ?? normalizePath(input);
}

function getBashDecision(command: string): GateDecision | undefined {
	const rule = dangerousBashRules.find((candidate) => candidate.pattern.test(command));
	if (!rule) return undefined;

	return {
		reason: rule.reason,
		details: `Matched rule: ${rule.name}`,
	};
}

function getPathDecision(rawPath: string): GateDecision | undefined {
	const normalized = normalizePath(rawPath);
	const lower = normalized.toLowerCase();
	const segments = pathSegments(lower);
	const base = basename(lower);

	if (segments.includes(".git")) {
		return { reason: "write/edit inside .git metadata" };
	}
	if (segments.includes("node_modules")) {
		return { reason: "write/edit inside node_modules" };
	}
	if (base === ".env" || base.startsWith(".env.")) {
		return { reason: "environment/secrets file" };
	}
	if (segments.includes(".ssh") || /^id_(rsa|dsa|ecdsa|ed25519)(\.pub)?$/.test(base)) {
		return { reason: "SSH key or SSH configuration path" };
	}
	if (lower.endsWith("agent/auth.json") || lower.endsWith(".pi/agent/auth.json")) {
		return { reason: "pi authentication file" };
	}
	if (["package-lock.json", "pnpm-lock.yaml", "yarn.lock", "bun.lock", "bun.lockb"].includes(base)) {
		return { reason: "dependency lockfile" };
	}

	return undefined;
}

function clamp(value: number, min: number, max: number): number {
	return Math.min(Math.max(value, min), max);
}

async function askScrollablePermission(ctx: ExtensionContext, title: string, message: string): Promise<boolean> {
	return ctx.ui.custom<boolean>(
		(tui, theme, _keybindings, done) => {
			let scroll = 0;
			let cachedWidth: number | undefined;
			let cachedBody: string[] | undefined;

			function buildBody(width: number): string[] {
				if (cachedBody && cachedWidth === width) return cachedBody;

				const contentWidth = Math.max(20, width - 4);
				const lines: string[] = [];

				for (const rawLine of message.split("\n")) {
					if (rawLine.trim().length === 0) {
						lines.push("");
						continue;
					}

					const wrapped = wrapTextWithAnsi(rawLine, contentWidth);
					lines.push(...(wrapped.length > 0 ? wrapped : [rawLine]));
				}

				cachedWidth = width;
				cachedBody = lines;
				return lines;
			}

			function styleBodyLine(line: string): string {
				if (line.startsWith("Reason:")) return theme.fg("warning", line);
				if (line.startsWith("Matched rule:")) return theme.fg("dim", line);
				if (line === "Command:" || line === "Path:") return theme.fg("accent", line);
				if (line.startsWith("  ")) return theme.fg("text", line);
				return theme.fg("text", line);
			}

			function visibleBodyLineCount(): number {
				// Keep the permission dialog inside the visible viewport so the user
				// can scroll inside the dialog instead of relying on terminal scrollback.
				return Math.max(4, Math.min(18, tui.terminal.rows - 8));
			}

			function requestScroll(delta: number, width: number) {
				const body = buildBody(width);
				const maxScroll = Math.max(0, body.length - visibleBodyLineCount());
				scroll = clamp(scroll + delta, 0, maxScroll);
				tui.requestRender();
			}

			function render(width: number): string[] {
				const body = buildBody(width);
				const bodyLineCount = visibleBodyLineCount();
				const maxScroll = Math.max(0, body.length - bodyLineCount);
				scroll = clamp(scroll, 0, maxScroll);

				const visibleBody = body.slice(scroll, scroll + bodyLineCount);
				const lines: string[] = [];
				const border = theme.fg("warning", "─".repeat(width));
				const scrollInfo =
					body.length > bodyLineCount
						? `lines ${scroll + 1}-${scroll + visibleBody.length}/${body.length}`
						: `${body.length} lines`;

				lines.push(border);
				lines.push(truncateToWidth(theme.fg("warning", theme.bold(` ${title}`)), width));
				lines.push(truncateToWidth(theme.fg("dim", ` ${scrollInfo}`), width));
				lines.push("");

				for (const line of visibleBody) {
					lines.push(truncateToWidth(`  ${styleBodyLine(line)}`, width));
				}

				lines.push("");
				lines.push(
					truncateToWidth(
						theme.fg("dim", " ↑↓ scroll • PgUp/PgDn page • Home/End jump • y/Enter allow • n/Esc block"),
						width,
					),
				);
				lines.push(border);
				return lines;
			}

			function handleInput(data: string) {
				const width = Math.max(20, tui.terminal.columns || 80);

				if (matchesKey(data, Key.enter) || data.toLowerCase() === "y") {
					done(true);
					return;
				}
				if (matchesKey(data, Key.escape) || data.toLowerCase() === "n") {
					done(false);
					return;
				}
				if (matchesKey(data, Key.up)) {
					requestScroll(-1, width);
					return;
				}
				if (matchesKey(data, Key.down)) {
					requestScroll(1, width);
					return;
				}
				if (matchesKey(data, Key.pageUp)) {
					requestScroll(-visibleBodyLineCount(), width);
					return;
				}
				if (matchesKey(data, Key.pageDown)) {
					requestScroll(visibleBodyLineCount(), width);
					return;
				}
				if (matchesKey(data, Key.home)) {
					const body = buildBody(width);
					scroll = 0;
					void body;
					tui.requestRender();
					return;
				}
				if (matchesKey(data, Key.end)) {
					const body = buildBody(width);
					scroll = Math.max(0, body.length - visibleBodyLineCount());
					tui.requestRender();
				}
			}

			return {
				render,
				invalidate: () => {
					cachedWidth = undefined;
					cachedBody = undefined;
				},
				handleInput,
			};
		},
		{
			overlay: true,
			overlayOptions: {
				width: "90%",
				minWidth: 60,
				maxHeight: "85%",
				anchor: "center",
				margin: 1,
			},
		},
	);
}

async function confirmOrBlock(ctx: ExtensionContext, title: string, message: string, blockReason: string) {
	if (!ctx.hasUI) {
		return { block: true, reason: `${blockReason} blocked: no interactive UI for confirmation` };
	}

	const ok = await askScrollablePermission(ctx, title, message);
	if (!ok) {
		ctx.ui.notify(`${blockReason} blocked`, "warning");
		return { block: true, reason: `${blockReason} blocked by user` };
	}

	ctx.ui.notify(`${blockReason} allowed`, "info");
	return undefined;
}

export default function permissionGateExtension(pi: ExtensionAPI) {
	pi.on("tool_call", async (event, ctx) => {
		if (event.toolName === "bash") {
			const command = typeof event.input.command === "string" ? event.input.command : "";
			const decision = getBashDecision(command);
			if (!decision) return undefined;

			return confirmOrBlock(
				ctx,
				"Permission required: bash",
				[
					"A potentially dangerous bash command was requested.",
					`Reason: ${decision.reason}`,
					decision.details,
					"",
					"Command:",
					`  ${command}`,
					"",
					"Allow this command to run?",
				]
					.filter(Boolean)
					.join("\n"),
				"Dangerous bash command",
			);
		}

		if (event.toolName === "write" || event.toolName === "edit") {
			const targetPath = typeof event.input.path === "string" ? event.input.path : "";
			const decision = getPathDecision(targetPath);
			if (!decision) return undefined;

			return confirmOrBlock(
				ctx,
				`Permission required: ${event.toolName}`,
				[
					"A write/edit to a sensitive path was requested.",
					`Reason: ${decision.reason}`,
					"",
					"Path:",
					`  ${targetPath}`,
					"",
					"Allow this file operation?",
				].join("\n"),
				"Sensitive file operation",
			);
		}

		return undefined;
	});
}
