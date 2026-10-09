// A regular chat model (not a decision model) behind bench --endpoint, through Opper's OpenAI-compatible API: each
// question goes to the model as one prompt, and the one-word answer comes back as the choice. No odds: a chat model
// answers with a word, not a probability per option.
// Run: OPPER_API_KEY=… node --import tsx scripts/chat-endpoint.ts <opper model id> [port]   (default 8788)
// Then: npm run bench -- --endpoint http://localhost:8788 --games 2
import { createServer } from 'node:http';

interface Question {
  type: 'choice';
  instructions: string;
  criteria: Record<string, string>;
}

const model = process.argv[2];
const port = Number(process.argv[3] ?? 8788);
const key = process.env.OPPER_API_KEY;
if (!model || !key) {
  console.error('usage: OPPER_API_KEY=… node --import tsx scripts/chat-endpoint.ts <opper model id> [port]');
  process.exit(1);
}

/** One question: the game's state and the question as JSON, and an answer of exactly one option word. */
async function ask(state: unknown, q: Question): Promise<{ choice: string | null; cost: number; tokensIn: number; tokensOut: number }> {
  const options = Object.keys(q.criteria);
  const res = await fetch('https://api.opper.ai/v3/compat/chat/completions', {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model,
      max_tokens: 16,
      messages: [
        { role: 'system', content: `You make one quick decision in a game. Reply with exactly one word, one of: ${options.join(', ')}. No other text.` },
        { role: 'user', content: JSON.stringify({ state, question: q }) },
      ],
    }),
    // The bench gives up after 2 s; don't keep paying for an answer it won't use.
    signal: AbortSignal.timeout(1900),
  });
  if (!res.ok) throw new Error(`Opper answered ${res.status}`);
  const body = (await res.json()) as { choices?: { message?: { content?: string } }[]; usage?: { prompt_tokens?: number; completion_tokens?: number } };
  const word = (body.choices?.[0]?.message?.content ?? '').toLowerCase().replace(/[^a-z]/g, '');
  return {
    choice: options.find((o) => o === word) ?? null,
    cost: Number(res.headers.get('x-opper-cost') ?? 0) || 0,
    tokensIn: body.usage?.prompt_tokens ?? 0,
    tokensOut: body.usage?.completion_tokens ?? 0,
  };
}

createServer((req, res) => {
  let raw = '';
  req.on('data', (chunk: Buffer) => (raw += chunk));
  req.on('end', async () => {
    try {
      const { state, questions } = JSON.parse(raw) as { state: unknown; questions: Record<string, Question> };
      const asked = await Promise.all(Object.entries(questions).map(async ([name, q]) => [name, await ask(state, q)] as const));
      // An answer that isn't one of the options is left out: the bench counts it as a backup move.
      const answers = Object.fromEntries(asked.filter(([, a]) => a.choice).map(([name, a]) => [name, { type: 'choice', choice: a.choice }]));
      const sum = (f: (a: (typeof asked)[number][1]) => number) => asked.reduce((s, [, a]) => s + f(a), 0);
      res.writeHead(200, { 'content-type': 'application/json' }).end(
        JSON.stringify({ answers, usage: { input_tokens: sum((a) => a.tokensIn), output_tokens: sum((a) => a.tokensOut) }, costUsd: sum((a) => a.cost) }),
      );
    } catch (err) {
      res.writeHead(502, { 'content-type': 'application/json' }).end(JSON.stringify({ error: (err as Error).message }));
    }
  });
}).listen(port, () => console.log(`${model} on http://localhost:${port}`));
