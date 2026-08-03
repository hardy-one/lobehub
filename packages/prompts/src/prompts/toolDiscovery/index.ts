export interface AvailableToolItem {
  description: string;
  identifier: string;
  name: string;
}

/** Max description length in lean mode — the list is a decision input for
 *  activateTools, so a one-line gist is enough; full description is provided
 *  by the tool's own schema after activation. */
const LEAN_MAX_DESC = 80;

const truncate = (text: string, lean?: boolean): string => {
  if (!lean || text.length <= LEAN_MAX_DESC) return text;
  return `${text.slice(0, LEAN_MAX_DESC)}…`;
};

export const availableToolPrompt = (tool: AvailableToolItem, lean?: boolean) =>
  `  <tool identifier="${tool.identifier}" name="${tool.name}">${truncate(tool.description, lean)}</tool>`;

export const availableToolsPrompts = (tools: AvailableToolItem[], lean?: boolean) => {
  if (tools.length === 0) return '';

  const toolTags = tools.map((tool) => availableToolPrompt(tool, lean)).join('\n');

  return `<available_tools description="These tools are installed but not yet enabled. Use activateTools to enable them when needed.">\n${toolTags}\n</available_tools>`;
};
