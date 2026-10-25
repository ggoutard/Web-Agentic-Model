// Extraction du texte d'un PDF dans le navigateur, avec pdf.js (Mozilla, Apache 2.0) embarqué.
// La bibliothèque (~1,7 Mo) n'est chargée qu'au premier PDF déposé.

const MAX_PAGES = 150;

let pdfjs = null;

export async function loadPdfjs() {
    if (!pdfjs) {
        pdfjs = await import("./vendor/pdfjs/pdf.min.mjs");
        pdfjs.GlobalWorkerOptions.workerSrc = new URL("./vendor/pdfjs/pdf.worker.min.mjs", import.meta.url).href;
    }
    return pdfjs;
}

// Renvoie le texte, page par page ; une chaîne vide si le PDF ne contient que des images (scan).
export async function extractPdfText(file) {
    const { getDocument } = await loadPdfjs();
    const pdf = await getDocument({ data: await file.arrayBuffer(), isEvalSupported: false }).promise;
    try {
        const pages = [];
        for (let number = 1; number <= Math.min(pdf.numPages, MAX_PAGES); number++) {
            const page = await pdf.getPage(number);
            const { items } = await page.getTextContent();
            pages.push(items.map((item) => item.str + (item.hasEOL ? "\n" : "")).join("").replace(/[ \t]+/g, " ").trim());
            page.cleanup();
        }
        return pages.filter(Boolean).join("\n\n");
    } finally {
        await pdf.destroy();
    }
}

// Ouvre un PDF conservé (Blob) ; l'appelant le referme avec `pdf.destroy()`.
export async function openPdf(blob) {
    const { getDocument } = await loadPdfjs();
    return getDocument({ data: await blob.arrayBuffer(), isEvalSupported: false }).promise;
}

// Texte de chaque page, pour retrouver où se trouve un passage.
export async function pageTexts(pdf) {
    const pages = [];
    for (let number = 1; number <= Math.min(pdf.numPages, MAX_PAGES); number++) {
        const page = await pdf.getPage(number);
        const { items } = await page.getTextContent();
        pages.push(items.map((item) => item.str + (item.hasEOL ? "\n" : " ")).join(""));
        page.cleanup();
    }
    return pages;
}
