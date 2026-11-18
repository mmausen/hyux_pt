// Real speech-to-text and LLM calls. The API key stays on the server.
// Interface (shared with mock.js):
//   transcribe({ buffer, mimetype, filename, signal }) -> { text }
//   respond({ messages, onDelta, signal }) -> { text, usage }
//   health({ signal }) -> { ok, model }
import OpenAI, { toFile } from 'openai';

export function createOpenAiService({ config, env }) {
  const client = env.hasApiKey ? new OpenAI({ apiKey: env.apiKey, maxRetries: 1 }) : null;
  const need = () => {
    if (!client) throw Object.assign(new Error('OPENAI_API_KEY is not set'), { code: 'no_api_key' });
    return client;
  };

  function requestParams(input, { stream, maxOutputTokens = config.ai.maxOutputTokens } = {}) {
    const p = {
      model: config.ai.model,
      instructions: config.ai.systemPrompt,
      input,
      max_output_tokens: maxOutputTokens,
      store: false,
      stream,
    };
    if (config.ai.temperature !== null) p.temperature = config.ai.temperature;
    if (config.ai.reasoningEffort !== null) p.reasoning = { effort: config.ai.reasoningEffort };
    return p;
  }

  return {
    async transcribe({ buffer, mimetype, filename, signal }) {
      const file = await toFile(buffer, filename, { type: mimetype });
      const params = { file, model: config.stt.model, languages: config.stt.languages };
      if (config.stt.prompt) params.prompt = config.stt.prompt;
      const res = await need().audio.transcriptions.create(params, { signal });
      return { text: (res.text ?? '').trim() };
    },

    // messages: [{ role: 'user' | 'assistant', content: string }]
    async respond({ messages, onDelta, signal }) {
      const stream = Boolean(config.ai.stream && onDelta);
      const res = await need().responses.create(requestParams(messages, { stream }), { signal });
      if (!stream) return { text: res.output_text ?? '', usage: res.usage ?? null };
      let text = '';
      let usage = null;
      for await (const ev of res) {
        if (ev.type === 'response.output_text.delta') { text += ev.delta; onDelta(ev.delta); }
        else if (ev.type === 'response.completed') usage = ev.response?.usage ?? null;
        else if (ev.type === 'error' || ev.type === 'response.failed') {
          throw new Error(ev.message ?? ev.response?.error?.message ?? 'The model returned an error');
        }
      }
      return { text, usage };
    },

    async health({ signal }) {
      const res = await need().responses.create(
        requestParams([{ role: 'user', content: 'Reply with the word OK.' }], { stream: false, maxOutputTokens: 256 }),
        { signal },
      );
      return { ok: Boolean(res.id) && res.status !== 'failed', model: res.model };
    },
  };
}
