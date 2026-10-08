import type { Agent, ChatResult, Message } from '../types';

export function demoResponse(agent: Agent, prompt: string): string {
  const task = prompt.replace(/[<>]/g, '').slice(0, 180).split('\n')[0];
  if (agent === 'claude') return `### A good world starts with a plan.\n\n> ${task}\n\nHere's a sample build plan to explore this workspace:\n\n1. **Find the first block.** Define the smallest useful result and who it helps.\n2. **Sketch the shape.** Pick your inputs, outputs, and the happy path.\n3. **Build one complete slice.** Connect the interface, state, and real behavior.\n4. **Try to break it.** Check empty input, interrupted requests, and saved data.\n5. **Make it yours.** Polish the details once the core works.\n\nHand this plan to Codex through **Workflows**, or save it to your vault.\n\n*This is a prepared demo response. Connect Claude in Settings for an answer to your actual task.*`;
  return `### Let's place the first block.\n\n> ${task}\n\nHere's a small example of turning a plan into something you can use:\n\n\`\`\`typescript\ntype Quest = { title: string; complete: boolean };\n\nexport function nextQuest(quests: Quest[]): Quest | null {\n  return quests.find(quest => !quest.complete) ?? null;\n}\n\n// Start with the next unfinished task.\nconst next = nextQuest([\n  { title: "Craft your first idea", complete: false }\n]);\n\`\`\`\n\nKeep the function focused, check the empty-list case, and build outward one block at a time.\n\n*This is a prepared demo response. Connect OpenAI in Settings for an implementation of your actual task.*`;
}
export async function runDemo(agent: Agent, messages: Pick<Message, 'role' | 'content'>[], onDelta: (chunk: string) => void, signal?: AbortSignal): Promise<ChatResult> {
  const text = demoResponse(agent, messages.filter(m => m.role === 'user').at(-1)?.content || 'Start a new quest');
  for (let offset = 0; offset < text.length; offset += 45) {
    if (signal?.aborted) throw new DOMException('Stopped', 'AbortError');
    onDelta(text.slice(offset, offset + 45));
    await new Promise(resolve => setTimeout(resolve, 12));
  }
  return { text, demo: true, usage: { input: 0, output: 0 } };
}
