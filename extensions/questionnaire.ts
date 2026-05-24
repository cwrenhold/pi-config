import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Editor, type EditorTheme, Key, matchesKey, Text, truncateToWidth } from "@earendil-works/pi-tui";
import { Type } from "typebox";

interface QuestionnaireOption {
	value: string;
	label: string;
	description?: string;
}

type RenderOption = QuestionnaireOption & { isCustom?: boolean };

interface QuestionnaireQuestion {
	id: string;
	label: string;
	prompt: string;
	options: QuestionnaireOption[];
	allowCustom: boolean;
}

interface QuestionnaireAnswer {
	id: string;
	value: string;
	label: string;
	wasCustom: boolean;
	index?: number;
}

interface QuestionnaireResult {
	questions: QuestionnaireQuestion[];
	answers: QuestionnaireAnswer[];
	answerMap: Record<string, Omit<QuestionnaireAnswer, "id">>;
	cancelled: boolean;
}

const QuestionnaireOptionSchema = Type.Object({
	value: Type.String({ description: "Machine-friendly value returned when this option is selected" }),
	label: Type.String({ description: "Human-friendly label displayed to the user" }),
	description: Type.Optional(Type.String({ description: "Optional description shown under this option" })),
});

const QuestionnaireQuestionSchema = Type.Object({
	id: Type.String({ description: "Stable unique identifier used to link this question to its answer" }),
	label: Type.Optional(Type.String({ description: "Short label for tab/status display, e.g. 'Scope' or 'Priority'" })),
	prompt: Type.String({ description: "The full question text to show the user" }),
	options: Type.Optional(Type.Array(QuestionnaireOptionSchema, { description: "Choices for the user to pick from" })),
	allowCustom: Type.Optional(Type.Boolean({ description: "Allow the user to type a custom answer. Defaults to true." })),
});

const QuestionnaireParams = Type.Object({
	questions: Type.Array(QuestionnaireQuestionSchema, {
		description: "One or more linked questions to ask in a single questionnaire flow",
	}),
});

function buildAnswerMap(answers: QuestionnaireAnswer[]): QuestionnaireResult["answerMap"] {
	return Object.fromEntries(
		answers.map(({ id, ...answer }) => [id, answer]),
	) as QuestionnaireResult["answerMap"];
}

function errorResult(message: string, questions: QuestionnaireQuestion[] = []): {
	content: { type: "text"; text: string }[];
	details: QuestionnaireResult;
} {
	return {
		content: [{ type: "text", text: message }],
		details: { questions, answers: [], answerMap: {}, cancelled: true },
	};
}

export default function questionnaireExtension(pi: ExtensionAPI) {
	let registered = false;

	pi.on("session_start", (_event, ctx) => {
		// Only expose this tool when pi has an interactive UI. In print/json mode,
		// ctx.hasUI is false, so the model will not see or call this tool.
		if (!ctx.hasUI || registered) return;
		registered = true;

		pi.registerTool({
			name: "questionnaire",
			label: "Questionnaire",
			description:
				"Ask the user one or more linked questions in a structured interactive flow. Use when several answers should be collected together and associated by question id.",
			promptSnippet: "Ask one or more linked interactive questions and return answers keyed by question id",
			promptGuidelines: [
				"Use questionnaire when you need several related answers from the user before continuing.",
				"Use questionnaire question ids that clearly describe each answer, because results are linked back to questions by id.",
				"Do not use questionnaire for a single quick clarification; use question instead.",
			],
			parameters: QuestionnaireParams,

			async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
				if (!ctx.hasUI) {
					return errorResult("Questionnaire tool unavailable: pi has no interactive UI in this mode.");
				}
				if (params.questions.length === 0) {
					return errorResult("Error: No questions provided.");
				}

				const questions: QuestionnaireQuestion[] = params.questions.map((q, i) => ({
					id: q.id,
					label: q.label || `Q${i + 1}`,
					prompt: q.prompt,
					options: q.options ?? [],
					allowCustom: q.allowCustom !== false,
				}));

				const duplicateId = questions.find((q, index) => questions.findIndex((other) => other.id === q.id) !== index)?.id;
				if (duplicateId) {
					return errorResult(`Error: Duplicate question id: ${duplicateId}`, questions);
				}

				const impossibleQuestion = questions.find((q) => q.options.length === 0 && !q.allowCustom);
				if (impossibleQuestion) {
					return errorResult(
						`Error: Question '${impossibleQuestion.id}' has no options and does not allow a custom answer.`,
						questions,
					);
				}

				const isMulti = questions.length > 1;
				const totalTabs = questions.length + 1; // questions + Submit tab

				const result = await ctx.ui.custom<QuestionnaireResult>((tui, theme, _keybindings, done) => {
					let currentTab = 0;
					let optionIndex = 0;
					let inputMode = false;
					let inputQuestionId: string | null = null;
					let cachedLines: string[] | undefined;
					const answers = new Map<string, QuestionnaireAnswer>();

					const editorTheme: EditorTheme = {
						borderColor: (s) => theme.fg("accent", s),
						selectList: {
							selectedPrefix: (t) => theme.fg("accent", t),
							selectedText: (t) => theme.fg("accent", t),
							description: (t) => theme.fg("muted", t),
							scrollInfo: (t) => theme.fg("dim", t),
							noMatch: (t) => theme.fg("warning", t),
						},
					};
					const editor = new Editor(tui, editorTheme);

					function refresh() {
						cachedLines = undefined;
						tui.requestRender();
					}

					function currentQuestion(): QuestionnaireQuestion | undefined {
						return questions[currentTab];
					}

					function currentOptions(): RenderOption[] {
						const q = currentQuestion();
						if (!q) return [];

						const opts: RenderOption[] = [...q.options];
						if (q.allowCustom) {
							opts.push({ value: "__custom__", label: "Type a custom answer...", isCustom: true });
						}
						return opts;
					}

					function allAnswered(): boolean {
						return questions.every((q) => answers.has(q.id));
					}

					function buildResult(cancelled: boolean): QuestionnaireResult {
						const answerList = Array.from(answers.values());
						return {
							questions,
							answers: answerList,
							answerMap: buildAnswerMap(answerList),
							cancelled,
						};
					}

					function submit(cancelled: boolean) {
						done(buildResult(cancelled));
					}

					function saveAnswer(questionId: string, value: string, label: string, wasCustom: boolean, index?: number) {
						answers.set(questionId, { id: questionId, value, label, wasCustom, index });
					}

					function advanceAfterAnswer() {
						if (!isMulti) {
							submit(false);
							return;
						}
						if (currentTab < questions.length - 1) {
							currentTab++;
						} else {
							currentTab = questions.length;
						}
						optionIndex = 0;
						refresh();
					}

					editor.onSubmit = (value) => {
						if (!inputQuestionId) return;
						const trimmed = value.trim();
						if (!trimmed) {
							inputMode = false;
							inputQuestionId = null;
							editor.setText("");
							refresh();
							return;
						}

						saveAnswer(inputQuestionId, trimmed, trimmed, true);
						inputMode = false;
						inputQuestionId = null;
						editor.setText("");
						advanceAfterAnswer();
					};

					function handleInput(data: string) {
						if (inputMode) {
							if (matchesKey(data, Key.escape)) {
								inputMode = false;
								inputQuestionId = null;
								editor.setText("");
								refresh();
								return;
							}
							editor.handleInput(data);
							refresh();
							return;
						}

						const q = currentQuestion();
						const opts = currentOptions();

						if (isMulti) {
							if (matchesKey(data, Key.tab) || matchesKey(data, Key.right)) {
								currentTab = (currentTab + 1) % totalTabs;
								optionIndex = 0;
								refresh();
								return;
							}
							if (matchesKey(data, Key.shift("tab")) || matchesKey(data, Key.left)) {
								currentTab = (currentTab - 1 + totalTabs) % totalTabs;
								optionIndex = 0;
								refresh();
								return;
							}
						}

						if (currentTab === questions.length) {
							if (matchesKey(data, Key.enter) && allAnswered()) {
								submit(false);
							} else if (matchesKey(data, Key.escape)) {
								submit(true);
							}
							return;
						}

						if (matchesKey(data, Key.up)) {
							optionIndex = Math.max(0, optionIndex - 1);
							refresh();
							return;
						}
						if (matchesKey(data, Key.down)) {
							optionIndex = Math.min(opts.length - 1, optionIndex + 1);
							refresh();
							return;
						}

						if (matchesKey(data, Key.enter) && q) {
							const opt = opts[optionIndex];
							if (!opt) return;

							if (opt.isCustom) {
								inputMode = true;
								inputQuestionId = q.id;
								editor.setText("");
								refresh();
								return;
							}

							saveAnswer(q.id, opt.value, opt.label, false, optionIndex + 1);
							advanceAfterAnswer();
							return;
						}

						if (matchesKey(data, Key.escape)) {
							submit(true);
						}
					}

					function render(width: number): string[] {
						if (cachedLines) return cachedLines;

						const lines: string[] = [];
						const q = currentQuestion();
						const opts = currentOptions();
						const add = (s: string) => lines.push(truncateToWidth(s, width));

						add(theme.fg("accent", "─".repeat(width)));

						if (isMulti) {
							const tabs: string[] = ["← "];
							for (let i = 0; i < questions.length; i++) {
								const active = i === currentTab;
								const answered = answers.has(questions[i].id);
								const marker = answered ? "■" : "□";
								const text = ` ${marker} ${questions[i].label} `;
								tabs.push(active ? theme.bg("selectedBg", theme.fg("text", text)) : theme.fg(answered ? "success" : "muted", text));
							}

							const canSubmit = allAnswered();
							const submitText = " ✓ Submit ";
							tabs.push(
								currentTab === questions.length
									? theme.bg("selectedBg", theme.fg("text", submitText))
									: theme.fg(canSubmit ? "success" : "dim", submitText),
							);
							tabs.push(" →");
							add(` ${tabs.join(" ")}`);
							lines.push("");
						}

						function renderOptions() {
							for (let i = 0; i < opts.length; i++) {
								const opt = opts[i];
								const selected = i === optionIndex;
								const prefix = selected ? theme.fg("accent", "> ") : "  ";
								const color = selected ? "accent" : "text";
								const editMark = opt.isCustom && inputMode ? " ✎" : "";
								add(prefix + theme.fg(color, `${i + 1}. ${opt.label}${editMark}`));
								if (opt.description) {
									add(`     ${theme.fg("muted", opt.description)}`);
								}
							}
						}

						if (inputMode && q) {
							add(theme.fg("text", ` ${q.prompt}`));
							lines.push("");
							renderOptions();
							lines.push("");
							add(theme.fg("muted", " Your answer:"));
							for (const line of editor.render(width - 2)) {
								add(` ${line}`);
							}
							lines.push("");
							add(theme.fg("dim", " Enter to submit • Esc to go back"));
						} else if (currentTab === questions.length) {
							add(theme.fg("accent", theme.bold(" Ready to submit")));
							lines.push("");
							for (const question of questions) {
								const answer = answers.get(question.id);
								if (answer) {
									const prefix = answer.wasCustom ? "(wrote) " : "";
									add(`${theme.fg("muted", ` ${question.label}: `)}${theme.fg("text", prefix + answer.label)}`);
								}
							}
							lines.push("");
							if (allAnswered()) {
								add(theme.fg("success", " Press Enter to submit"));
							} else {
								const missing = questions
									.filter((question) => !answers.has(question.id))
									.map((question) => question.label)
									.join(", ");
								add(theme.fg("warning", ` Unanswered: ${missing}`));
							}
						} else if (q) {
							add(theme.fg("text", ` ${q.prompt}`));
							lines.push("");
							renderOptions();
						}

						lines.push("");
						if (!inputMode) {
							add(
								theme.fg(
									"dim",
									isMulti
										? " Tab/←→ navigate • ↑↓ select • Enter confirm • Esc cancel"
										: " ↑↓ navigate • Enter select • Esc cancel",
								),
							);
						}
						add(theme.fg("accent", "─".repeat(width)));

						cachedLines = lines;
						return lines;
					}

					return {
						render,
						invalidate: () => {
							cachedLines = undefined;
						},
						handleInput,
					};
				});

				if (result.cancelled) {
					return {
						content: [{ type: "text", text: "User cancelled the questionnaire." }],
						details: result,
					};
				}

				const answerLines = result.answers.map((answer) => {
					const qLabel = questions.find((question) => question.id === answer.id)?.label || answer.id;
					if (answer.wasCustom) {
						return `${qLabel} (${answer.id}): user wrote: ${answer.label}`;
					}
					return `${qLabel} (${answer.id}): user selected: ${answer.index}. ${answer.label} [${answer.value}]`;
				});

				return {
					content: [{ type: "text", text: answerLines.join("\n") }],
					details: result,
				};
			},

			renderCall(args, theme) {
				const questions = (args.questions as Array<{ id?: string; label?: string }> | undefined) ?? [];
				const labels = questions.map((question, i) => question.label || question.id || `Q${i + 1}`).join(", ");
				let text = theme.fg("toolTitle", theme.bold("questionnaire "));
				text += theme.fg("muted", `${questions.length} question${questions.length === 1 ? "" : "s"}`);
				if (labels) {
					text += theme.fg("dim", ` (${truncateToWidth(labels, 40)})`);
				}
				return new Text(text, 0, 0);
			},

			renderResult(result, _options, theme) {
				const details = result.details as QuestionnaireResult | undefined;
				if (!details) {
					const text = result.content[0];
					return new Text(text?.type === "text" ? text.text : "", 0, 0);
				}

				if (details.cancelled) {
					return new Text(theme.fg("warning", "Cancelled"), 0, 0);
				}

				const lines = details.answers.map((answer) => {
					if (answer.wasCustom) {
						return `${theme.fg("success", "✓ ")}${theme.fg("accent", answer.id)}: ${theme.fg("muted", "(wrote) ")}${answer.label}`;
					}
					const display = answer.index ? `${answer.index}. ${answer.label}` : answer.label;
					return `${theme.fg("success", "✓ ")}${theme.fg("accent", answer.id)}: ${display}`;
				});

				return new Text(lines.join("\n"), 0, 0);
			},
		});
	});
}
