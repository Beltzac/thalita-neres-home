// Gemma 4 vision analysis via OpenRouter.
// Uses the vision-capable google/gemma-4-26b-a4b-it model.
//
// The OpenRouter key is read from OPENROUTER_API_KEY env, falling back to the
// Windows user registry Environment (where it lives on this workstation).

import { execSync } from 'node:child_process';

export const DEFAULT_MODEL = 'google/gemma-4-26b-a4b-it';

function readRegistryKey(name) {
  try {
    const cmd = `powershell -NoProfile -Command "(Get-ItemProperty HKCU:\\Environment).${name}"`;
    const out = execSync(cmd, { encoding: 'utf8', windowsHide: true }).trim();
    return out || null;
  } catch {
    return null;
  }
}

export function getOpenRouterKey() {
  return process.env.OPENROUTER_API_KEY || readRegistryKey('OPENROUTER_API_KEY');
}

// Build a base64 data URL for an image file, re-encoding to PNG via sharp so
// we control the MIME type regardless of source format (webp/png/jpg).
export async function imageToDataUrl(sharp, filePath) {
  const png = await sharp(filePath).png().toBuffer();
  return 'data:image/png;base64,' + png.toString('base64');
}

// Send one image + text to Gemma and return the text answer.
export async function askGemma({ imageDataUrls, prompt, model = DEFAULT_MODEL, maxTokens = 1200 }) {
  const key = getOpenRouterKey();
  if (!key) throw new Error('OPENROUTER_API_KEY not found (env or HKCU registry)');

  const content = [{ type: 'text', text: prompt }];
  for (const url of imageDataUrls) {
    content.push({ type: 'image_url', image_url: { url } });
  }

  const resp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + key,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content }],
      max_tokens: maxTokens,
    }),
  });

  const json = await resp.json();
  if (json.error) {
    throw new Error('OpenRouter error: ' + JSON.stringify(json.error));
  }
  const text = json.choices?.[0]?.message?.content;
  if (!text) throw new Error('Gemma returned no content: ' + JSON.stringify(json).slice(0, 300));
  return text.trim();
}
