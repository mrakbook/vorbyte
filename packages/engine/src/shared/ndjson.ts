/**
 * Parse a ReadableStream as NDJSON (one JSON object per line).
 */
export async function* readNdjson(stream: ReadableStream<Uint8Array>): AsyncGenerator<any> {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let buf = ''

  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })

    let idx: number
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx).trim()
      buf = buf.slice(idx + 1)
      if (!line) continue
      try {
        yield JSON.parse(line)
      } catch {
        // ignore parse errors for malformed lines
      }
    }
  }

  const tail = buf.trim()
  if (tail) {
    try {
      yield JSON.parse(tail)
    } catch {
      // ignore
    }
  }
}
