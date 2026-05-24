import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Markdown, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";

type MarkdownThemeLike = {
	codeBlock: (text: string) => string;
	codeBlockBorder: (text: string) => string;
	highlightCode?: (code: string, lang?: string) => string[];
	codeBlockIndent?: string;
};

type ThemeLike = {
	fg: (color: string, text: string) => string;
	bg: (color: string, text: string) => string;
};

type MarkdownInstance = {
	theme: MarkdownThemeLike;
};

type CompactCodeblocksState = {
	installed: boolean;
	originalRenderToken: (...args: unknown[]) => string[];
	activeTheme?: ThemeLike;
};

const STATE_KEY = Symbol.for("cwrenhold.pi.compact-codeblocks");
const BLOCK_BG = "customMessageBg";
const BAR_COLOR = "mdCodeBlockBorder";

function getState(): CompactCodeblocksState {
	const globalState = globalThis as typeof globalThis & { [STATE_KEY]?: CompactCodeblocksState };
	const proto = Markdown.prototype as unknown as { renderToken: (...args: unknown[]) => string[] };

	if (!globalState[STATE_KEY]) {
		globalState[STATE_KEY] = {
			installed: false,
			originalRenderToken: proto.renderToken,
		};
	}

	return globalState[STATE_KEY];
}

function padToWidth(line: string, width: number): string {
	const padding = Math.max(0, width - visibleWidth(line));
	return line + " ".repeat(padding);
}

function styleBlockLine(line: string, width: number, activeTheme?: ThemeLike): string {
	const padded = padToWidth(line, width);
	return activeTheme ? activeTheme.bg(BLOCK_BG, padded) : padded;
}

function renderCompactCodeBlock(instance: MarkdownInstance, token: { text?: string; lang?: string }, width: number): string[] {
	const state = getState();
	const mdTheme = instance.theme;
	const prefix = state.activeTheme
		? state.activeTheme.fg(BAR_COLOR, "▌ ")
		: mdTheme.codeBlockBorder("▌ ");
	const prefixWidth = visibleWidth(prefix);
	const codeWidth = Math.max(1, width - prefixWidth);

	let highlightedLines: string[];
	try {
		highlightedLines = mdTheme.highlightCode
			? mdTheme.highlightCode(token.text ?? "", token.lang)
			: (token.text ?? "").split("\n").map((line) => mdTheme.codeBlock(line));
	} catch {
		highlightedLines = (token.text ?? "").split("\n").map((line) => mdTheme.codeBlock(line));
	}

	if (highlightedLines.length === 0) highlightedLines = [""];

	const lines: string[] = [];
	for (const highlightedLine of highlightedLines) {
		const wrapped = wrapTextWithAnsi(highlightedLine || " ", codeWidth);
		const displayLines = wrapped.length > 0 ? wrapped : [""];

		for (const displayLine of displayLines) {
			lines.push(styleBlockLine(prefix + displayLine, width, state.activeTheme));
		}
	}

	return lines;
}

function installCompactCodeblockRenderer() {
	const state = getState();
	if (state.installed) return;

	const proto = Markdown.prototype as unknown as { renderToken: (...args: unknown[]) => string[] };
	proto.renderToken = function compactCodeblockRenderToken(
		this: MarkdownInstance,
		token: { type?: string; text?: string; lang?: string },
		width: number,
		nextTokenType?: string,
		styleContext?: unknown,
	): string[] {
		if (token?.type !== "code") {
			return state.originalRenderToken.call(this, token, width, nextTokenType, styleContext);
		}

		const lines = renderCompactCodeBlock(this, token, width);
		if (nextTokenType && nextTokenType !== "space") {
			lines.push("");
		}
		return lines;
	};

	state.installed = true;
}

export default function compactCodeblocksExtension(pi: ExtensionAPI) {
	installCompactCodeblockRenderer();

	pi.on("session_start", (_event, ctx) => {
		if (!ctx.hasUI) return;
		getState().activeTheme = ctx.ui.theme as unknown as ThemeLike;
	});
}
