/** Shared by HTTP recovery and browser verification. A vendor name or HTTP
 * status alone is not evidence: ordinary pages and permission errors use the
 * same CDNs. Keep inspection bounded and require an actual interstitial. */
export const CHALLENGE_PREFIX_LIMIT = 128 * 1024;
export function isChallenge(headers: Headers, text = ''): boolean {
  if (headers.get('cf-mitigated')?.toLowerCase() === 'challenge') return true;
  const html = text.slice(0, CHALLENGE_PREFIX_LIMIT);
  if (/(?:\/cdn-cgi\/challenge-platform\/[^\s"'<>]*orchestrate\/|\b_cf_chl_opt\b|<iframe\b[^>]*\bsrc\s*=\s*["']?[^"'\s>]*\/_Incapsula_Resource\b|Incapsula incident ID\s*:)/i.test(html)) return true;
  const title = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1].replace(/\s+/g, ' ').trim() ?? '';
  const vendor = /cloudflare|\bcf-(?:ray|error|browser|challenge)|challenge-platform|incapsula|imperva|distilnetworks/i.test(html);
  // Normal pages ship consent text and translated error messages in scripts.
  // A vendor mention there is not an interstitial. Strip incomplete scripts as
  // well: response inspection can end halfway through a JSON assignment.
  const content = html.replace(/<!--[\s\S]*?(?:-->|$)/g, '')
    .replace(/<(script|style)\b[^>]*>[\s\S]*?(?:<\/\1\s*>|$)/gi, '')
    .replace(/<[^>]*>/g, ' ');
  const blocked = /(?:verify(?:ing)? (?:that )?you (?:are|are not)|checking your browser|security (?:check|verification)|unusual traffic|automated (?:requests|access)|(?:think|thought) you were a bot|enable javascript and cookies|access denied|you have been blocked)/i.test(content);
  if (/^(?:Just a moment|Attention Required|Access Denied|Forbidden|Security (?:Check|Verification)|Request (?:Rejected|Unsuccessful)|You have been blocked)/i.test(title) && vendor) return true;
  if (/^Pardon Our Interruption\b/i.test(title) && (vendor || blocked)) return true;
  // Some sites customize the title while retaining the vendor's block message.
  return /<(?:html|body)\b/i.test(html) && vendor && blocked;
}

export async function isChallengeResponse(response: Response): Promise<boolean> {
  if (isChallenge(response.headers)) return true;
  const reader = response.clone().body?.getReader();
  if (!reader) return false;
  const decoder = new TextDecoder();
  let text = '', bytes = 0;
  try {
    while (bytes < CHALLENGE_PREFIX_LIMIT) {
      const next = await reader.read(); if (next.done) break;
      const part = next.value.subarray(0, CHALLENGE_PREFIX_LIMIT - bytes);
      bytes += part.length;
      text += decoder.decode(part, {stream: true});
      if (isChallenge(response.headers, text)) return true;
      // Sniff the body even with missing/wrong MIME headers. Stop early for
      // binary/JSON data, while allowing HTML declarations split across chunks.
      if (bytes >= 512 && !/^\s*</.test(text)) return false;
    }
    return isChallenge(response.headers, text + decoder.decode());
  } finally {
    // A tee's cancellation waits for its other branch, owned by the caller.
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
