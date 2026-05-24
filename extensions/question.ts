import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";

interface QuestionDetails {
	question: string;
	answer: string | null;
	wasCustom?: boolean;
	cancelled?: boolean;
}

const QuestionParams = Type.Object({
	question: Type.String({ description: "The question to ask the user" }),
	options: Type.Optional(
		Type.Array(Type.String(), {
			description: "Optional choices for the user to pick from. Omit for free-form text input.",
		}),
	),
	allowCustom: Type.Optional(
		Type.Boolean({ description: "When options are provided, allow the user to type a custom answer. Defaults to true." }),
	),
});

export default function questionExtension(pi: ExtensionAPI) {
	let registered = false;

	pi.on("session_start", (_event, ctx) => {
		// Only expose this tool when pi has an interactive UI. In print/json mode,
		// ctx.hasUI is false, so the model will not see or call this tool.
		if (!ctx.hasUI || registered) return;
		registered = true;

		pi.registerTool({
			name: "question",
			label: "Question",
			description:
				"Ask the user a question interactively. Use when you need clarification, a decision, or missing information before continuing.",
			promptSnippet: "Ask the user an interactive question with optional choices",
			promptGuidelines: [
				"Use question when you need one quick clarification, decision, or missing piece of information from the user before continuing.",
				"Do not use question for rhetorical questions or information you can determine from files or tools.",
				"Do not use question for several related questions; use questionnaire instead so answers are linked by question id.",
			],
			parameters: QuestionParams,

			async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
				if (!ctx.hasUI) {
					return {
						content: [{ type: "text", text: "Question tool unavailable: pi has no interactive UI in this mode." }],
						details: { question: params.question, answer: null, cancelled: true } as QuestionDetails,
					};
				}

				const options = params.options ?? [];
				const allowCustom = params.allowCustom !== false;

				let answer: string | undefined;
				let wasCustom = false;

				if (options.length > 0) {
					const customChoice = "Type a custom answer...";
					const choices = allowCustom ? [...options, customChoice] : options;
					const choice = await ctx.ui.select(params.question, choices);

					if (choice === undefined) {
						return {
							content: [{ type: "text", text: "User cancelled the question." }],
							details: { question: params.question, answer: null, cancelled: true } as QuestionDetails,
						};
					}

					if (choice === customChoice) {
						wasCustom = true;
						answer = await ctx.ui.input(params.question, "Type your answer...");
					} else {
						answer = choice;
					}
				} else {
					wasCustom = true;
					answer = await ctx.ui.input(params.question, "Type your answer...");
				}

				const trimmed = answer?.trim();
				if (!trimmed) {
					return {
						content: [{ type: "text", text: "User cancelled or provided no answer." }],
						details: { question: params.question, answer: null, cancelled: true } as QuestionDetails,
					};
				}

				return {
					content: [{ type: "text", text: `User answered: ${trimmed}` }],
					details: { question: params.question, answer: trimmed, wasCustom } as QuestionDetails,
				};
			},

			renderCall(args, theme) {
				return new Text(theme.fg("toolTitle", theme.bold("question ")) + theme.fg("muted", args.question), 0, 0);
			},

			renderResult(result, _options, theme) {
				const details = result.details as QuestionDetails | undefined;
				if (!details || details.answer === null) {
					return new Text(theme.fg("warning", "No answer"), 0, 0);
				}

				const prefix = details.wasCustom ? "✓ wrote " : "✓ selected ";
				return new Text(theme.fg("success", prefix) + theme.fg("accent", details.answer), 0, 0);
			},
		});
	});
}
