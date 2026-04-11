/**
 * AI Provider Abstraction Layer
 * Provides unified interface for Anthropic (Claude), Google (Gemini), and Groq (Llama).
 * Only providers with valid API keys are activated at startup.
 */

import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';
import Groq from 'groq-sdk';
import { env } from '../config/env';
import { logger } from '../utils/logger';
import { Socket } from 'socket.io';

// ── Model constants ────────────────────────────────────────────────────────────
export const MODELS = {
  claude: {
    fast:    'claude-haiku-4-5-20251001',
    smart:   'claude-opus-4-5',
    vision:  'claude-opus-4-5',
  },
  gemini: {
    fast:    'gemini-2.5-flash',
    smart:   'gemini-2.5-pro',
    vision:  'gemini-2.5-flash',
  },
  groq: {
    fast:    'llama-3.1-8b-instant',
    smart:   'llama-3.3-70b-versatile',
    vision:  'llama-3.3-70b-versatile',
  },
} as const;

export type TaskType = 'chat' | 'summarize' | 'ghost' | 'code' | 'diagram' | 'annotation' | 'agent' | 'explain' | 'suggest_next';
export type ModelProvider = 'claude' | 'gemini' | 'groq';

// ── Available providers (lazily initialized) ───────────────────────────────────
let _anthropic: Anthropic | null = null;
let _gemini: GoogleGenerativeAI | null = null;
let _groq: Groq | null = null;

function getAnthropic(): Anthropic | null {
  if (!env.ANTHROPIC_API_KEY) return null;
  if (!_anthropic) _anthropic = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  return _anthropic;
}

function getGemini(): GoogleGenerativeAI | null {
  if (!env.GEMINI_API_KEY) return null;
  if (!_gemini) _gemini = new GoogleGenerativeAI(env.GEMINI_API_KEY);
  return _gemini;
}

function getGroq(): Groq | null {
  if (!env.GROQ_API_KEY) return null;
  if (!_groq) _groq = new Groq({ apiKey: env.GROQ_API_KEY });
  return _groq;
}

/** Returns list of currently available providers based on env keys */
export function getAvailableProviders(): ModelProvider[] {
  const available: ModelProvider[] = [];
  if (env.ANTHROPIC_API_KEY) available.push('claude');
  if (env.GEMINI_API_KEY) available.push('gemini');
  if (env.GROQ_API_KEY) available.push('groq');
  return available;
}

// ── Smart Auto Router ──────────────────────────────────────────────────────────
/**
 * Routes each task to the optimal available provider.
 * Preference: Groq (cheapest/fastest) → Gemini (balanced) → Claude (highest quality).
 * For complex structured tasks, Claude is preferred if available.
 */
export function pickProvider(task: TaskType, requested: string = 'auto'): ModelProvider {
  const available = getAvailableProviders();

  if (available.length === 0) {
    throw new Error('No AI providers configured. Add at least one of: ANTHROPIC_API_KEY, GEMINI_API_KEY, GROQ_API_KEY');
  }

  // If user explicitly requested a specific provider
  if (requested !== 'auto' && available.includes(requested as ModelProvider)) {
    return requested as ModelProvider;
  }

  // Auto routing by task type
  switch (task) {
    case 'chat':
      // Prefer Groq (fastest/cheapest for conversational), fallback chain
      return available.includes('groq') ? 'groq'
           : available.includes('gemini') ? 'gemini'
           : 'claude';

    case 'summarize':
      // Gemini excels at large-context summarization
      return available.includes('gemini') ? 'gemini'
           : available.includes('claude') ? 'claude'
           : 'groq';

    case 'ghost':
    case 'code':
    case 'diagram':
      // Claude best for structured JSON output and code reasoning
      return available.includes('claude') ? 'claude'
           : available.includes('gemini') ? 'gemini'
           : 'groq';

    case 'agent':
    case 'explain':
    case 'suggest_next':
      // Agent tasks need highest-quality model: Claude > Gemini > Groq
      return available.includes('claude') ? 'claude'
           : available.includes('gemini') ? 'gemini'
           : 'groq';

    case 'annotation':
      // Fast annotations are fine with Groq
      return available.includes('groq') ? 'groq'
           : available.includes('claude') ? 'claude'
           : 'gemini';

    default:
      return available[0];
  }
}

// ── Unified streaming chat ─────────────────────────────────────────────────────
export async function streamChat(
  socket: Socket,
  requestId: string,
  canvasId: string,
  provider: ModelProvider,
  systemPrompt: string,
  history: Array<{ role: 'user' | 'assistant'; content: string }>,
  userMessage: string,
): Promise<void> {
  const emit = (chunk: string, done: boolean, modelUsed?: string) =>
    socket.emit('ai:stream', { requestId, canvasId, chunk, done, modelUsed });

  try {
    if (provider === 'claude') {
      const client = getAnthropic()!;
      const stream = client.messages.stream({
        model: MODELS.claude.smart,
        max_tokens: 2048,
        system: systemPrompt,
        messages: [...history, { role: 'user', content: userMessage }],
      });
      for await (const chunk of stream) {
        if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
          emit(chunk.delta.text, false, 'claude');
        }
      }
      emit('', true, 'claude');

    } else if (provider === 'gemini') {
      const client = getGemini()!;
      const model = client.getGenerativeModel({ model: MODELS.gemini.fast });
      const formattedHistory = history.map(h => ({
        role: h.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: h.content }],
      }));
      const chat = model.startChat({
        history: formattedHistory,
        systemInstruction: systemPrompt,
      });
      const result = await chat.sendMessageStream(userMessage);
      for await (const chunk of result.stream) {
        const text = chunk.text();
        if (text) emit(text, false, 'gemini');
      }
      emit('', true, 'gemini');

    } else if (provider === 'groq') {
      const client = getGroq()!;
      const messages: Groq.Chat.ChatCompletionMessageParam[] = [
        { role: 'system', content: systemPrompt },
        ...history.map(h => ({ role: h.role as 'user' | 'assistant', content: h.content })),
        { role: 'user', content: userMessage },
      ];
      const stream = await client.chat.completions.create({
        model: MODELS.groq.smart,
        messages,
        max_tokens: 2048,
        stream: true,
      });
      for await (const chunk of stream) {
        const text = chunk.choices[0]?.delta?.content;
        if (text) emit(text, false, 'groq');
      }
      emit('', true, 'groq');
    }
  } catch (err) {
    logger.error(`AI stream error [${provider}]`, { error: (err as Error).message });
    socket.emit('ai:error', { requestId, error: (err as Error).message });
  }
}

// ── Single-shot completion (for summarize, ghost, etc.) ────────────────────────
export async function complete(
  provider: ModelProvider,
  prompt: string,
  maxTokens = 2048,
): Promise<string> {
  if (provider === 'claude') {
    const client = getAnthropic()!;
    const res = await client.messages.create({
      model: MODELS.claude.smart,
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt }],
    });
    return res.content.find(c => c.type === 'text')?.text ?? '';
  }

  if (provider === 'gemini') {
    const client = getGemini()!;
    const model = client.getGenerativeModel({ model: MODELS.gemini.fast });
    const res = await model.generateContent(prompt);
    return res.response.text();
  }

  if (provider === 'groq') {
    const client = getGroq()!;
    const res = await client.chat.completions.create({
      model: MODELS.groq.smart,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: maxTokens,
    });
    return res.choices[0]?.message?.content ?? '';
  }

  throw new Error(`Unknown provider: ${provider}`);
}

// ── Log available providers at startup ────────────────────────────────────────
export function logProviderStatus(): void {
  const available = getAvailableProviders();
  logger.info('AI Providers', {
    available,
    claude: !!env.ANTHROPIC_API_KEY,
    gemini: !!env.GEMINI_API_KEY,
    groq:   !!env.GROQ_API_KEY,
    default: env.AI_DEFAULT_MODEL,
  });
}

// ── structured JSON completion with auto-retry ────────────────────────────────
/**
 * Calls complete() and parses the result as JSON.
 * Retries up to `maxRetries` times with a repair prompt if parsing fails.
 */
export async function completeJSON<T>(
  provider: ModelProvider,
  prompt: string,
  maxTokens = 4096,
  maxRetries = 2,
): Promise<T> {
  let lastRaw = '';
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const repairNote = attempt > 0
      ? `\n\nPrevious output was invalid JSON. Raw output was:\n${lastRaw}\n\nPlease return ONLY a valid JSON object, no markdown fences, no commentary.`
      : '';
    lastRaw = await complete(provider, prompt + repairNote, maxTokens);
    const cleaned = lastRaw.trim()
      .replace(/^```(?:json)?\n?/, '')
      .replace(/\n?```$/, '')
      .trim();
    try {
      return JSON.parse(cleaned) as T;
    } catch {
      logger.warn(`completeJSON parse failed attempt ${attempt + 1}`, { provider, preview: cleaned.slice(0, 200) });
    }
  }
  throw new Error('AI returned invalid JSON after retries');
}
