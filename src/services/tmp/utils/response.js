/**
 * Helper to create JSON responses with consistent headers
 */
export function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

/**
 * Check if a value is an AsyncIterator
 */
export function isAsyncIterator(value) {
  return value !== null
    && typeof value === 'object'
    && Symbol.asyncIterator in value;
}

/**
 * Helper to create a Server-Sent Events (SSE) response from an AsyncIterator
 * This allows streaming data to the client as it becomes available
 */
export async function sseResponse(iterator, status = 200) {
  const encoder = new TextEncoder();

  // Create a stream using ReadableStream
  const stream = new ReadableStream({
    async start(controller) {
      try {
        // Send initial connection established event
        controller.enqueue(encoder.encode('event: open\ndata: connection established\n\n'));

        // Stream each value from the iterator
        let result = await iterator.next();
        while (!result.done) {
          // Format the data as an SSE event
          const data = JSON.stringify(result.value);
          controller.enqueue(encoder.encode(`event: message\ndata: ${data}\n\n`));

          // Get the next value
          result = await iterator.next();
        }

        // Send a done event when the iterator completes
        controller.enqueue(encoder.encode('event: done\ndata: complete\n\n'));
        controller.close();
      }
      catch (error) {
        // Send error event if something goes wrong
        const errorMessage = error instanceof Error ? error.message : String(error);
        controller.enqueue(encoder.encode(`event: error\ndata: ${JSON.stringify({ error: errorMessage })}\n\n`));
        controller.close();
      }
    },
  });

  // Return the response with appropriate headers
  return new Response(stream, {
    status,
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    },
  });
} 