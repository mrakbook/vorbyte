/**
 * Parse a ReadableStream as Server-Sent Events (SSE).
 * Yields the "data:" payload for each event.
 */
export async function* readSseData(stream: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let buf = ''

  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })

    // SSE events are separated by a blank line
    let sep: number
    while ((sep = buf.indexOf('\n\n')) >= 0) {
      const rawEvent = buf.slice(0, sep)
      buf = buf.slice(sep + 2)

      const lines = rawEvent.split(/\r?\n/)
      for (const line of lines) {
        const m = line.match(/^data:\s?(.*)$/)
        if (m) yield m[1]
      }
    }
  }

  // flush tail
  const rawEvent = buf.trim()
  if (rawEvent) {
    const lines = rawEvent.split(/\r?\n/)
    for (const line of lines) {
      const m = line.match(/^data:\s?(.*)$/)
      if (m) yield m[1]
    }
  }
}
