// API string limits use UTF-16 code units. Iterate code points so a generated
// list title never ends with half a surrogate pair. Full instructions are not cut.
export function suggestTaskTitle(instructions: string): string {
  const firstLine =
    instructions
      .trim()
      .split(/\r?\n/)
      .find((line) => line.trim())
      ?.trim() ?? '';
  if (firstLine.length <= 120) return firstLine;
  let title = '';
  for (const point of firstLine) {
    if (title.length + point.length > 119) break;
    title += point;
  }
  return `${title}…`;
}
export function prepareNewWork(input: {
  kind: 'task' | 'goal';
  instructions: string;
  supplemental: string;
  shortTitle?: string | undefined;
}): { title: string; description: string; error: string | null } {
  const instructions = input.instructions.trim();
  const supplemental = input.supplemental.trim();
  const title =
    input.kind === 'goal'
      ? instructions
      : input.shortTitle === undefined
        ? suggestTaskTitle(instructions)
        : input.shortTitle.trim();
  const description =
    input.kind === 'goal'
      ? supplemental
      : [`任务要求：\n${instructions}`, supplemental ? `补充上下文：\n${supplemental}` : '']
          .filter(Boolean)
          .join('\n\n');
  const limit = input.kind === 'goal' ? 20_000 : 100_000;
  const error = !instructions
    ? '请填写工作要求。'
    : !title
      ? '请填写任务短标题，或恢复自动标题。'
      : title.length > 240
        ? `${input.kind === 'goal' ? 'Goal 标题' : '任务短标题'}不能超过 240 个字符。`
        : description.length > limit
          ? `${input.kind === 'goal' ? 'Goal 补充上下文' : '任务说明（含分节标题）'}不能超过 ${limit} 个字符；请精简后提交，原文不会自动截断。`
          : null;
  return { title, description, error };
}
