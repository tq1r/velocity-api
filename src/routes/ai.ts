import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

const API_KEY_MAP: Record<string, string> = {
  openai: 'OPENAI_API_KEY',
  deepseek: 'DEEPSEEK_API_KEY',
  groq: 'GROQ_API_KEY',
  xai: 'XAI_API_KEY',
  together: 'TOGETHER_API_KEY',
  mistral: 'MISTRAL_API_KEY',
  qwen: 'QWEN_API_KEY',
  minimax: 'MINIMAX_API_KEY',
};

router.post('/chat', requireAuth, async (req, res) => {
  try {
    const { provider, messages, model, temperature, max_tokens, stream } = req.body as {
      provider?: string;
      messages?: any[];
      model?: string;
      temperature?: number;
      max_tokens?: number;
      stream?: boolean;
    };

    if (!messages || !model) {
      res.status(400).json({ error: 'messages and model are required' });
      return;
    }

    const providerName = provider || 'openai';
    const envKey = API_KEY_MAP[providerName];
    const apiKey = process.env[envKey || ''] || process.env.OPENAI_API_KEY;

    if (!apiKey) {
      res.status(500).json({ error: `No API key configured for provider: ${providerName}` });
      return;
    }

    let apiBase = req.body.api_base as string | undefined;
    if (!apiBase) {
      const baseMap: Record<string, string> = {
        openai: 'https://api.openai.com/v1',
        deepseek: 'https://api.deepseek.com/v1',
        groq: 'https://api.groq.com/openai/v1',
        xai: 'https://api.x.ai/v1',
        together: 'https://api.together.xyz/v1',
        mistral: 'https://api.mistral.ai/v1',
        qwen: 'https://api.qwen.ai/v1',
        minimax: 'https://api.minimax.ai/v1',
      };
      apiBase = baseMap[providerName] || 'https://api.openai.com/v1';
    }

    const url = `${apiBase.replace(/\/+$/, '')}/chat/completions`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: temperature ?? 0.2,
        max_tokens: max_tokens ?? 4096,
        stream: stream ?? false,
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      res.status(response.status).json({ error: `AI API error (${response.status}): ${body}` });
      return;
    }

    if (stream) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      const reader = response.body?.getReader();
      if (!reader) {
        res.status(500).json({ error: 'No response body' });
        return;
      }
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const text = decoder.decode(value, { stream: true });
        res.write(text);
      }
      res.end();
    } else {
      const data = await response.json();
      res.json(data);
    }
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

export default router;
