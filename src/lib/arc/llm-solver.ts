/**
 * ARC Lab — LLM solver adapter (SERVER ONLY).
 *
 * Uses z-ai-web-dev-sdk to generate candidate output grids from the
 * demonstration pairs. Never imports into client code.
 */

import type { Grid, Pair } from './types';

function gridToText(g: Grid): string {
  return g.map((row) => JSON.stringify(row)).join('\n');
}

function pairsToPrompt(train: Pair[], testInput: Grid): string {
  const ex = train
    .map((p, i) => `Example ${i + 1}:\nINPUT:\n${gridToText(p.input)}\nOUTPUT:\n${gridToText(p.output as Grid)}`)
    .join('\n\n');
  return `${ex}\n\nTest INPUT:\n${gridToText(testInput)}\n\nWhat is the Test OUTPUT? Reply with ONLY the output grid as a JSON array of arrays of integers 0-9. No explanations.`;
}

const SYSTEM = `You are an ARC (Abstraction and Reasoning Corpus) solver. You will see example input/output grid pairs that demonstrate a transformation rule. Infer the rule and apply it to a test input.
Rules:
- Grids are rectangular arrays of integers 0-9.
- The output grid may have different dimensions than the input.
- Reply with ONLY a JSON array of arrays. No markdown, no commentary.`;

function parseGrid(text: string): Grid | null {
  if (!text) return null;
  // find the first [[ ... ]] block
  const start = text.indexOf('[[');
  const end = text.lastIndexOf(']]');
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    const parsed = JSON.parse(text.slice(start, end + 2));
    if (!Array.isArray(parsed) || parsed.length === 0) return null;
    const w = Array.isArray(parsed[0]) ? parsed[0].length : -1;
    if (w <= 0) return null;
    for (const row of parsed) {
      if (!Array.isArray(row) || row.length !== w) return null;
      for (const cell of row) {
        if (typeof cell !== 'number' || !Number.isInteger(cell) || cell < 0 || cell > 9) return null;
      }
    }
    return parsed as Grid;
  } catch {
    return null;
  }
}

export interface LlmSolveResult {
  predictions: Grid[];
  note?: string;
}

/** Solve with the LLM; 2 samples for pass@2. Returns at least copy-input fallback if parsing fails. */
export async function solveWithLlm(train: Pair[], testInput: Grid, samples = 2, timeoutMs = 45_000): Promise<LlmSolveResult> {
  const predictions: Grid[] = [];
  let note: string | undefined;
  try {
    const { default: ZAI } = await import('z-ai-web-dev-sdk');
    const zai = await ZAI.create();
    const prompt = pairsToPrompt(train, testInput);
    for (let i = 0; i < samples; i++) {
      try {
        const completion = (await Promise.race([
          zai.chat.completions.create({
            messages: [
              { role: 'assistant', content: SYSTEM },
              { role: 'user', content: prompt },
            ],
            thinking: { type: 'disabled' },
          }),
          new Promise<never>((_, rej) => setTimeout(() => rej(new Error('llm-timeout')), timeoutMs)),
        ])) as { choices?: Array<{ message?: { content?: string } }> };
        const text = completion.choices?.[0]?.message?.content ?? '';
        const grid = parseGrid(text);
        if (grid && !predictions.some((p) => JSON.stringify(p) === JSON.stringify(grid))) {
          predictions.push(grid);
        }
      } catch (err) {
        note = err instanceof Error ? err.message : 'llm-error';
      }
    }
  } catch (err) {
    note = err instanceof Error ? `adapter-unavailable: ${err.message}` : 'adapter-unavailable';
  }
  if (predictions.length === 0) {
    predictions.push(testInput.map((r) => [...r])); // copy-input fallback
    note = note ?? 'llm produced no parsable grid; copy-input fallback';
  }
  return { predictions: predictions.slice(0, 2), note };
}
