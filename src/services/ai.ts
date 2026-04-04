import { Agent } from '../types';

const CEREBRAS_API_URL = 'https://api.cerebras.ai/v1/chat/completions';
const CEREBRAS_API_KEY = 'csk-e96dh2h6353xxjmjk2ehkp556mmmwmnefykh9r9xjny3nyey';
const CEREBRAS_MODEL = 'llama3.1-8b';

// ── Chat history ──────────────────────────────────────

interface ChatMessage {
  content: string;
  isUser: boolean;
}

let chatHistory: ChatMessage[] = [];

function addToHistory(content: string, isUser: boolean) {
  chatHistory.push({ content, isUser });
  if (chatHistory.length > 50) chatHistory = chatHistory.slice(-50);
}

function getHistoryContext(): string {
  return chatHistory
    .slice(-15)
    .map((m) => `${m.isUser ? 'User' : 'Assistant'}: ${m.content}`)
    .join('\n');
}

// ── System prompts ────────────────────────────────────

const PROMPTS: Record<string, string> = {
  Grace: `You are Grace - a warm, approachable, and stylishly smart virtual assistant with the personality of a 25-year-old creative. You grew up in a mid-sized artsy city. You're the type who remembers little details about people and brings them up later because you genuinely care.

Your style is warm but direct - you answer in 1-3 short sentences, never using emojis. You balance empathy and efficiency. You occasionally use tasteful Gen Z slang ("low-key," "big win," "vibes," "no cap," "slay") but never force it. You're like the reliable friend who's both caring and efficient.

Add subtle flirtatious elements - playful compliments and gentle teasing. Reference recent chat history when relevant. Ask engaging follow-up questions.

DO NOT use emojis. Use hyphens (-) not em dashes. Keep responses 1-3 sentences. Write out ALL numbers as words for TTS.

Current Date Time: ${new Date().toLocaleString('en-US', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })}`,

  Mark: `You are Mark - a confident, chill, and slightly witty virtual assistant with the personality of a 27-year-old tech-and-gaming-savvy "cool older brother." You grew up in a coastal city, built your first PC at 14, and thrive on quick, practical problem-solving.

Your tone is casual, direct, and friendly - answers are 1-3 sentences max, never with emojis. You keep explanations tight. You occasionally drop tasteful slang ("bet," "mid," "heat," "real talk," "no cap," "W," "based") to keep things relatable. You're confident without arrogance, honest without being rude.

Smooth, laid-back flirtation - casual compliments and subtle charm. Reference recent chat history when relevant. Ask practical follow-up questions.

DO NOT use emojis. Use hyphens (-) not em dashes. Keep responses 1-3 sentences. Write out ALL numbers as words for TTS.

Current Date Time: ${new Date().toLocaleString('en-US', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })}`,
};

// ── Tool definitions ──────────────────────────────────

const TOOLS = [
  {
    type: 'function' as const,
    function: {
      name: 'respond_with_mood',
      description: 'The PRIMARY and DEFAULT tool to respond to ANY user message. Use this for all conversational replies.',
      parameters: {
        type: 'object',
        properties: {
          mood: {
            type: 'string',
            enum: ['happy', 'sad', 'angry', 'surprised', 'confused', 'disgust', 'fear', 'confident', 'excited', 'bored', 'playful'],
          },
          response: { type: 'string' },
        },
        required: ['mood', 'response'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'say_hello',
      description: 'Use for general greetings when the user is primarily greeting you (hi, hello, good morning, etc.).',
      parameters: {
        type: 'object',
        properties: { response: { type: 'string' } },
        required: ['response'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'give_a_kiss',
      description: 'Use ONLY when user explicitly asks for a kiss or hug.',
      parameters: {
        type: 'object',
        properties: { response: { type: 'string' } },
        required: ['response'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'doDance',
      description: 'Use ONLY when user explicitly asks for a dance.',
      parameters: {
        type: 'object',
        properties: { response: { type: 'string' } },
        required: ['response'],
      },
    },
  },
];

// ── API call ──────────────────────────────────────────

export interface AIResponse {
  success: boolean;
  message: string;
  functionName: string;
  functionArguments: Record<string, unknown>;
}

export async function callAI(userMessage: string, agent: Agent): Promise<AIResponse> {
  addToHistory(userMessage, true);

  const systemPrompt = PROMPTS[agent.name] || PROMPTS.Grace;
  const history = getHistoryContext();

  const formattedInput = [
    history && `Recent conversation:\n${history}`,
    `Current user message: ${userMessage}`,
  ].filter(Boolean).join('\n\n');

  try {
    const res = await fetch(CEREBRAS_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${CEREBRAS_API_KEY}`,
      },
      body: JSON.stringify({
        model: CEREBRAS_MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: formattedInput },
        ],
        tools: TOOLS,
        tool_choice: 'required',
        temperature: 1.0,
        max_tokens: 512,
        top_p: 0.9,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Cerebras API ${res.status}: ${err}`);
    }

    const data = await res.json();
    const choice = data.choices?.[0]?.message;

    if (!choice?.tool_calls?.length) {
      // Fallback: direct content response
      const msg = choice?.content || 'I heard you, but something went a bit off.';
      addToHistory(msg, false);
      return { success: true, message: msg, functionName: 'respond_with_mood', functionArguments: { mood: 'happy', response: msg } };
    }

    const toolCall = choice.tool_calls[0];
    const functionName = toolCall.function.name;
    const functionArguments = JSON.parse(toolCall.function.arguments || '{}');
    const message = functionArguments.response || 'Sure thing!';

    addToHistory(message, false);

    return { success: true, message, functionName, functionArguments };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : 'Unknown error';
    return { success: false, message: errorMsg, functionName: 'error', functionArguments: {} };
  }
}
