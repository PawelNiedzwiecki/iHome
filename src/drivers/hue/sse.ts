export type SseMessage = { id?: string; event?: string; data: string };

/**
 * Incremental Server-Sent Events parser. Feed it text chunks as they arrive
 * (they can split anywhere) and it returns the complete messages.
 */
export class SseParser {
  private buffer = '';

  push(chunk: string): SseMessage[] {
    this.buffer += chunk.replace(/\r\n?/g, '\n');
    const messages: SseMessage[] = [];
    let end: number;
    while ((end = this.buffer.indexOf('\n\n')) !== -1) {
      const block = this.buffer.slice(0, end);
      this.buffer = this.buffer.slice(end + 2);
      const message = parseBlock(block);
      if (message) messages.push(message);
    }
    return messages;
  }

  reset() {
    this.buffer = '';
  }
}

function parseBlock(block: string): SseMessage | null {
  const data: string[] = [];
  let id: string | undefined;
  let event: string | undefined;
  for (const line of block.split('\n')) {
    if (line === '' || line.startsWith(':')) continue; // comment / keep-alive
    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'data') data.push(value);
    else if (field === 'id') id = value;
    else if (field === 'event') event = value;
  }
  if (data.length === 0) return null;
  return { id, event, data: data.join('\n') };
}
