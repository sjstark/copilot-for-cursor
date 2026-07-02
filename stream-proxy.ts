export interface StreamUsageResult {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
}

/** Remove Copilot adaptive-thinking fields that Cursor doesn't understand. */
function sanitizeStreamChunk(rawChunk: string): string {
    if (!rawChunk.includes('reasoning_')) return rawChunk;

    return rawChunk.split('\n').map(line => {
        if (!line.startsWith('data:')) return line;
        const payload = line.slice(5).trim();
        if (!payload || payload === '[DONE]') return line;
        try {
            const parsed = JSON.parse(payload);
            if (parsed?.choices?.length) {
                for (const choice of parsed.choices) {
                    if (choice.delta) {
                        delete choice.delta.reasoning_text;
                        delete choice.delta.reasoning_opaque;
                    }
                }
            }
            return `data: ${JSON.stringify(parsed)}`;
        } catch {
            return line;
        }
    }).join('\n');
}

export const createStreamProxy = (
    responseBody: ReadableStream<Uint8Array>,
    responseHeaders: Headers,
    onComplete?: (usage: StreamUsageResult) => void,
) => {
    let chunkCount = 0;
    let lastChunkData = '';
    let totalBytes = 0;
    let extractedUsage: StreamUsageResult = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
    const reader = responseBody.getReader();
    const decoder = new TextDecoder();
    
    const stream = new ReadableStream({
        async pull(controller) {
            try {
                const { done, value } = await reader.read();
                if (done) {
                    console.log(`✅ Stream complete: ${chunkCount} chunks, ${totalBytes} bytes`);
                    console.log(`✅ Last chunk: ${lastChunkData.slice(-200)}`);
                    if (onComplete) onComplete(extractedUsage);
                    controller.close();
                    return;
                }
                chunkCount++;
                totalBytes += value.length;
                lastChunkData = decoder.decode(value, { stream: true });
                if (chunkCount === 1) {
                    console.log(`📡 Stream started, first chunk: ${lastChunkData.slice(0, 200)}`);
                }
                if (lastChunkData.includes('"error"')) {
                    console.error(`❌ Error in stream chunk ${chunkCount}: ${lastChunkData.slice(0, 500)}`);
                }
                if (lastChunkData.includes('finish_reason')) {
                    const match = lastChunkData.match(/"finish_reason"\s*:\s*"([^"]+)"/);
                    if (match) {
                        console.log(`📡 finish_reason: "${match[1]}" at chunk ${chunkCount}`);
                    }
                }
                // Extract usage from chunks (often in the final chunk)
                if (lastChunkData.includes('"usage"')) {
                    try {
                        const lines = lastChunkData.split('\n');
                        for (const line of lines) {
                            const jsonStr = line.replace(/^data:\s*/, '').trim();
                            if (!jsonStr || jsonStr === '[DONE]') continue;
                            const parsed = JSON.parse(jsonStr);
                            if (parsed.usage) {
                                extractedUsage = {
                                    promptTokens: parsed.usage.prompt_tokens || 0,
                                    completionTokens: parsed.usage.completion_tokens || 0,
                                    totalTokens: parsed.usage.total_tokens || (parsed.usage.prompt_tokens || 0) + (parsed.usage.completion_tokens || 0),
                                };
                            }
                        }
                    } catch { /* ignore parse errors in partial chunks */ }
                }
                const sanitized = sanitizeStreamChunk(lastChunkData);
                controller.enqueue(new TextEncoder().encode(sanitized));
            } catch (err: any) {
                if (err?.code === 'ERR_INVALID_THIS') return;
                console.error(`❌ Stream read error at chunk ${chunkCount}:`, err);
                try { controller.error(err); } catch {}
            }
        },
        cancel() {
            console.log(`⚠️ Stream cancelled by client after ${chunkCount} chunks, ${totalBytes} bytes`);
            if (onComplete) onComplete(extractedUsage);
            try { reader.cancel(); } catch {}
        }
    });

    return new Response(stream, {
        status: 200,
        headers: responseHeaders,
    });
};
