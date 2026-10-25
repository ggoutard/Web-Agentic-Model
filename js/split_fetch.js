// GitHub refuse les fichiers de plus de 100 Mo : le modèle est découpé en morceaux.
// Ce fetch présente les morceaux au moteur comme un seul fichier (HEAD + requêtes Range),
// disponible à l'URL renvoyée.

export async function createSplitFetch(manifestUrl) {
    const manifestResponse = await fetch(manifestUrl);
    if (!manifestResponse.ok) throw new Error(`Manifeste introuvable : ${manifestUrl}`);
    const manifest = await manifestResponse.json();

    const baseUrl = new URL(".", new URL(manifestUrl, location.href)).href;
    const virtualUrl = new URL(manifest.file, baseUrl).href;
    const parts = [];
    let offset = 0;
    for (const part of manifest.parts) {
        parts.push({ url: new URL(part.name, baseUrl).href, start: offset, end: offset + part.size });
        offset += part.size;
    }
    if (offset !== manifest.size) throw new Error("Manifeste incohérent : la somme des morceaux ne correspond pas à la taille.");

    const baseHeaders = {
        "accept-ranges": "bytes",
        "content-type": "application/octet-stream",
        "etag": `"${manifest.sha256}"`,
    };

    // Lit [start, end) en enchaînant les morceaux concernés.
    const streamRange = (start, end, signal) => new ReadableStream({
        async start(controller) {
            try {
                for (const part of parts) {
                    if (part.end <= start || part.start >= end) continue;
                    const from = Math.max(start, part.start) - part.start;
                    const to = Math.min(end, part.end) - part.start;
                    const response = await fetch(part.url, { headers: { Range: `bytes=${from}-${to - 1}` }, signal });
                    if (response.status === 206) {
                        const reader = response.body.getReader();
                        for (;;) {
                            const { done, value } = await reader.read();
                            if (done) break;
                            controller.enqueue(value);
                        }
                    } else if (response.ok) {
                        // Serveur sans support des Range : on découpe nous-mêmes.
                        controller.enqueue(new Uint8Array(await response.arrayBuffer()).subarray(from, to));
                    } else {
                        throw new Error(`${part.url} : HTTP ${response.status}`);
                    }
                }
                controller.close();
            } catch (error) {
                controller.error(error);
            }
        },
    });

    const splitFetch = async (input, init = {}) => {
        const url = typeof input === "string" ? input : input.url;
        if (url !== virtualUrl) return fetch(input, init);

        if ((init.method ?? "GET").toUpperCase() === "HEAD") {
            return new Response(null, { status: 200, headers: { ...baseHeaders, "content-length": String(manifest.size) } });
        }

        const rangeHeader = new Headers(init.headers).get("Range");
        const match = rangeHeader && /^bytes=(\d+)-(\d*)$/.exec(rangeHeader);
        if (!match) {
            return new Response(streamRange(0, manifest.size, init.signal), {
                status: 200,
                headers: { ...baseHeaders, "content-length": String(manifest.size) },
            });
        }

        const start = Number(match[1]);
        const end = Math.min(match[2] === "" ? manifest.size : Number(match[2]) + 1, manifest.size);
        if (start >= end) {
            return new Response(null, { status: 416, headers: { "content-range": `bytes */${manifest.size}` } });
        }
        return new Response(streamRange(start, end, init.signal), {
            status: 206,
            headers: {
                ...baseHeaders,
                "content-length": String(end - start),
                "content-range": `bytes ${start}-${end - 1}/${manifest.size}`,
            },
        });
    };

    return { url: virtualUrl, fetch: splitFetch };
}
