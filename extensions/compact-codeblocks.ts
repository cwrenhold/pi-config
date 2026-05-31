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
	getFgAnsi?: (color: string) => string;
	getBgAnsi?: (color: string) => string;
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
const INDICATOR_COLOR = "mdCodeBlockBorder";
const BG_RESET = "\x1b[49m";
const LINE_PREFIX = "  ";
const LINE_PREFIX_WIDTH = visibleWidth(LINE_PREFIX);

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

function readAnsiCode(text: string, pos: number): string | undefined {
	if (text[pos] !== "\x1b") return undefined;

	const next = text[pos + 1];
	if (next === "[") {
		let end = pos + 2;
		while (end < text.length && !/[\x40-\x7e]/.test(text[end])) end++;
		return end < text.length ? text.slice(pos, end + 1) : text.slice(pos);
	}

	if (next === "]" || next === "_" || next === "P") {
		let end = pos + 2;
		while (end < text.length) {
			if (text[end] === "\x07") return text.slice(pos, end + 1);
			if (text[end] === "\x1b" && text[end + 1] === "\\") return text.slice(pos, end + 2);
			end++;
		}
		return text.slice(pos);
	}

	return text.slice(pos, Math.min(text.length, pos + 2));
}

function fgAnsiToBgAnsi(ansi: string): string | undefined {
	const extended = /^\x1b\[38((?:;\d+)+)m$/.exec(ansi);
	if (extended) return `\x1b[48${extended[1]}m`;

	const basic = /^\x1b\[(3\d|9\d)m$/.exec(ansi);
	if (!basic) return undefined;

	const code = Number(basic[1]);
	return `\x1b[${code + 10}m`;
}

function applyFirstCellBackground(line: string, backgroundAnsi: string, restoreBackgroundAnsi: string): string {
	let pos = 0;
	while (pos < line.length) {
		const ansi = readAnsiCode(line, pos);
		if (ansi) {
			pos += ansi.length;
			continue;
		}

		const char = Array.from(line.slice(pos))[0] ?? line[pos];
		return `${line.slice(0, pos)}${backgroundAnsi}${char}${restoreBackgroundAnsi}${line.slice(pos + char.length)}`;
	}

	return line;
}

function styleBlockLine(line: string, width: number, activeTheme?: ThemeLike): string {
	const padded = padToWidth(`${LINE_PREFIX}${line}`, width);
	if (!activeTheme) return padded;

	const blockBgAnsi = activeTheme.getBgAnsi?.(BLOCK_BG);
	const indicatorBgAnsi = activeTheme.getFgAnsi ? fgAnsiToBgAnsi(activeTheme.getFgAnsi(INDICATOR_COLOR)) : undefined;
	if (!blockBgAnsi || !indicatorBgAnsi) return activeTheme.bg(BLOCK_BG, padded);

	return `${blockBgAnsi}${applyFirstCellBackground(padded, indicatorBgAnsi, blockBgAnsi)}${BG_RESET}`;
}

function renderCompactCodeBlock(instance: MarkdownInstance, token: { text?: string; lang?: string }, width: number): string[] {
	const state = getState();
	const mdTheme = instance.theme;
	const codeWidth = Math.max(1, width - LINE_PREFIX_WIDTH);

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
			lines.push(styleBlockLine(displayLine, width, state.activeTheme));
		}
	}

	return lines;
}

function installCompactCodeblockRenderer() {
	const state = getState();

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
