import { SseParser } from '../sse';

describe('SseParser', () => {
  it('parses messages split across arbitrary chunks', () => {
    const parser = new SseParser();
    const stream = ': hi\n\nid: 1:0\ndata: [{"a":1}]\n\nid: 2:0\r\ndata: line1\r\ndata: line2\r\n\r\n';
    const out = [];
    for (let i = 0; i < stream.length; i += 7) out.push(...parser.push(stream.slice(i, i + 7)));
    expect(out).toEqual([
      { id: '1:0', event: undefined, data: '[{"a":1}]' },
      { id: '2:0', event: undefined, data: 'line1\nline2' },
    ]);
  });

  it('holds incomplete messages until terminated', () => {
    const parser = new SseParser();
    expect(parser.push('data: x')).toEqual([]);
    expect(parser.push('\n\n')).toEqual([{ id: undefined, event: undefined, data: 'x' }]);
  });
});
