/**
 * EPUB Parser - wrapper around epub.js for extracting text
 */
const EpubParser = {
    /**
     * Parse epub file and extract metadata
     */
    async parseMetadata(arrayBuffer) {
        const book = ePub(arrayBuffer);
        await book.ready;

        const metadata = await book.loaded.metadata;
        let cover = null;

        try {
            const coverUrl = await book.coverUrl();
            if (coverUrl) {
                cover = coverUrl;
            }
        } catch (e) {
            console.log('No cover found');
        }

        return {
            title: metadata.title || 'Untitled',
            author: metadata.creator || 'Unknown',
            cover: cover
        };
    },

    /**
     * Extract all text from epub and split into words
     * Returns { words: [], chapters: [{ title, wordIndex, href }] }
     */
    async extractWordsWithChapters(arrayBuffer) {
        const book = ePub(arrayBuffer);
        await book.ready;
        await book.loaded.spine;

        // Navigation may not exist in some epubs
        try {
            await book.loaded.navigation;
        } catch (e) {
            console.log('No navigation in epub');
        }

        const words = [];
        const chapters = [];
        const chaptersHTML = [];
        const spine = book.spine;

        // Build href to TOC title mapping
        const tocMap = {};
        if (book.navigation && book.navigation.toc) {
            const flattenToc = (items, depth = 0) => {
                for (const item of items) {
                    // Normalize href (remove anchors for matching)
                    const baseHref = item.href.split('#')[0];
                    tocMap[baseHref] = {
                        title: item.label.trim(),
                        href: item.href,
                        depth: depth
                    };
                    if (item.subitems && item.subitems.length > 0) {
                        flattenToc(item.subitems, depth + 1);
                    }
                }
            };
            flattenToc(book.navigation.toc);
        }

        // Iterate through all spine items (chapters)
        for (let i = 0; i < spine.items.length; i++) {
            const item = spine.items[i];
            const baseHref = item.href.split('#')[0];

            // Record chapter start position
            const tocEntry = tocMap[baseHref];
            if (tocEntry) {
                chapters.push({
                    title: tocEntry.title,
                    wordIndex: words.length,
                    href: item.href,
                    depth: tocEntry.depth
                });
            }

            try {
                const doc = await book.load(item.href);
                const text = this.extractTextFromDocument(doc);
                const chapterWords = this.splitIntoWords(text);

                // Extract annotated HTML for normal reading mode
                const startWordIndex = words.length;
                const doc2 = await book.load(item.href);
                const htmlResult = this.extractHTMLWithWordIndices(doc2, startWordIndex);

                words.push(...chapterWords);

                chaptersHTML.push({
                    title: tocEntry ? tocEntry.title : null,
                    href: item.href,
                    html: htmlResult.html,
                    startWordIndex: startWordIndex,
                    endWordIndex: words.length - 1
                });

                // Verify word count consistency
                if (htmlResult.wordCount !== chapterWords.length) {
                    console.warn(`Word count mismatch in ${item.href}: splitIntoWords=${chapterWords.length}, HTML=${htmlResult.wordCount}`);
                }
            } catch (e) {
                console.warn('Failed to load chapter:', item.href, e);
            }
        }

        return { words, chapters, chaptersHTML };
    },

    /**
     * Extract all text from epub and split into words (legacy, returns only words)
     */
    async extractWords(arrayBuffer) {
        const result = await this.extractWordsWithChapters(arrayBuffer);
        return result.words;
    },

    /**
     * Extract text content from HTML document.
     * Walks the DOM to add spaces between block elements,
     * preventing word concatenation across element boundaries.
     */
    extractTextFromDocument(doc) {
        // If doc is already a string, return it
        if (typeof doc === 'string') {
            const parser = new DOMParser();
            doc = parser.parseFromString(doc, 'text/html');
        }

        // Get body content
        const body = doc.body || doc.documentElement;
        if (!body) return '';

        // Remove script and style elements
        const scripts = body.querySelectorAll('script, style');
        scripts.forEach(el => el.remove());

        // Walk DOM and add spaces between elements to prevent word concatenation
        const BLOCK_TAGS = new Set([
            'P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
            'LI', 'BR', 'HR', 'BLOCKQUOTE', 'PRE', 'TR', 'TD', 'TH',
            'SECTION', 'ARTICLE', 'HEADER', 'FOOTER', 'FIGURE', 'FIGCAPTION'
        ]);

        const parts = [];
        const walk = (node) => {
            if (node.nodeType === Node.TEXT_NODE) {
                parts.push(node.textContent);
            } else if (node.nodeType === Node.ELEMENT_NODE) {
                if (BLOCK_TAGS.has(node.tagName)) {
                    parts.push(' ');
                }
                for (const child of node.childNodes) {
                    walk(child);
                }
                if (BLOCK_TAGS.has(node.tagName)) {
                    parts.push(' ');
                }
            }
        };
        walk(body);
        return parts.join('');
    },

    /**
     * Split text into words, separating by punctuation where words are glued
     */
    splitIntoWords(text) {
        // Normalize whitespace
        let normalized = text.replace(/\s+/g, ' ').trim();

        // Split "word.Word" or "word,Word" patterns - punctuation followed by letter
        normalized = normalized.replace(/([.,:;!?])(?=[\p{L}])/gu, '$1 ');

        // Split em-dash and en-dash followed by letters
        normalized = normalized.replace(/([—–])(?=[\p{L}])/gu, '$1 ');

        // Split by spaces and filter
        const words = normalized
            .split(' ')
            .filter(word => {
                if (word.length === 0) return false;
                // Remove strings that are only punctuation
                if (/^[.,:;!?—–…]+$/.test(word)) return false;
                return true;
            });

        return words;
    },

    /**
     * Calculate ORP (Optimal Recognition Point) for a word
     * Returns the index of the focus character
     */
    getORP(word) {
        // Remove punctuation for length calculation
        const cleanWord = word.replace(/[^\p{L}\p{N}]/gu, '');
        const len = cleanWord.length;

        if (len === 0) return 0;
        if (len <= 1) return 0;
        if (len <= 3) return 1;
        if (len <= 5) return 1;
        if (len <= 9) return 2;
        if (len <= 13) return 3;
        return Math.floor(len * 0.3);
    },

    /**
     * Extract HTML from document with data-word-index annotations on each word.
     * Uses the same word-splitting logic as splitIntoWords for consistency.
     * Returns { html: string, wordCount: number }
     */
    extractHTMLWithWordIndices(doc, startIndex) {
        if (typeof doc === 'string') {
            const parser = new DOMParser();
            doc = parser.parseFromString(doc, 'text/html');
        }

        const body = doc.body || doc.documentElement;
        if (!body) return { html: '', wordCount: 0 };

        // Remove script and style elements
        body.querySelectorAll('script, style').forEach(el => el.remove());

        // Allowed tags — everything else gets unwrapped (keep text, remove tag)
        const ALLOWED_TAGS = new Set([
            'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
            'P', 'DIV', 'SPAN', 'BR', 'HR',
            'STRONG', 'B', 'EM', 'I', 'U', 'S', 'SUB', 'SUP',
            'UL', 'OL', 'LI',
            'BLOCKQUOTE', 'PRE', 'CODE',
            'A', 'IMG', 'FIGURE', 'FIGCAPTION',
            'TABLE', 'THEAD', 'TBODY', 'TR', 'TH', 'TD',
            'SECTION', 'ARTICLE', 'HEADER', 'FOOTER', 'NAV', 'ASIDE'
        ]);

        let wordIndex = startIndex;

        // Process a text node: split into words using same logic as splitIntoWords,
        // wrap each word in <span data-word-index="N">
        const processTextNode = (textNode) => {
            const text = textNode.textContent;
            if (!text || !text.trim()) return;

            // We need to split this text into words the same way splitIntoWords does,
            // but preserve whitespace structure for HTML rendering
            let normalized = text.replace(/\s+/g, ' ');

            // Apply same transformations as splitIntoWords
            normalized = normalized.replace(/([.,:;!?])(?=[\p{L}])/gu, '$1 ');
            normalized = normalized.replace(/([—–])(?=[\p{L}])/gu, '$1 ');

            // Split into tokens (words and spaces)
            const parts = normalized.split(/( )/);
            const fragment = textNode.ownerDocument.createDocumentFragment();

            for (const part of parts) {
                if (part === ' ') {
                    fragment.appendChild(textNode.ownerDocument.createTextNode(' '));
                    continue;
                }
                if (part.length === 0) continue;

                // Check if this is a "word" by the same filter as splitIntoWords
                const isWord = part.length > 0 && !/^[.,:;!?—–…]+$/.test(part);

                if (isWord) {
                    const span = textNode.ownerDocument.createElement('span');
                    span.setAttribute('data-word-index', wordIndex);
                    span.textContent = part;
                    fragment.appendChild(span);
                    wordIndex++;
                } else {
                    fragment.appendChild(textNode.ownerDocument.createTextNode(part));
                }
            }

            textNode.parentNode.replaceChild(fragment, textNode);
        };

        // Walk the DOM and annotate text nodes
        // We need to collect text nodes first, then process them
        // (processing modifies the tree, so we can't walk and modify simultaneously)
        const collectTextNodes = (root) => {
            const textNodes = [];
            const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT, null, false);
            let node;
            while (node = walker.nextNode()) {
                if (node.textContent.trim()) {
                    textNodes.push(node);
                }
            }
            return textNodes;
        };

        // Strip disallowed tags (unwrap them, keeping children)
        const stripDisallowed = (root) => {
            const elements = Array.from(root.querySelectorAll('*'));
            for (const el of elements) {
                if (!ALLOWED_TAGS.has(el.tagName)) {
                    // Unwrap: replace element with its children
                    const parent = el.parentNode;
                    if (parent) {
                        while (el.firstChild) {
                            parent.insertBefore(el.firstChild, el);
                        }
                        parent.removeChild(el);
                    }
                }
            }
        };

        stripDisallowed(body);

        // Handle images: ensure they have max-width styling
        body.querySelectorAll('img').forEach(img => {
            // Keep src as-is (epub.js resolves URLs)
            img.removeAttribute('width');
            img.removeAttribute('height');
        });

        const textNodes = collectTextNodes(body);
        for (const textNode of textNodes) {
            processTextNode(textNode);
        }

        return {
            html: body.innerHTML,
            wordCount: wordIndex - startIndex
        };
    },

    /**
     * Split word into parts for ORP display
     * Returns { left, focus, right }
     */
    splitWordForORP(word) {
        if (!word || word.length === 0) {
            return { left: '', focus: '', right: '' };
        }

        // Find the position of actual letters in the original word
        const letterPositions = [];
        for (let i = 0; i < word.length; i++) {
            if (/[\p{L}\p{N}]/u.test(word[i])) {
                letterPositions.push(i);
            }
        }

        if (letterPositions.length === 0) {
            // Word has no letters, just return it as focus
            return { left: '', focus: word, right: '' };
        }

        // Get ORP index in the clean word
        const orpIndex = this.getORP(word);

        // Map to position in original word
        const focusPos = letterPositions[Math.min(orpIndex, letterPositions.length - 1)];

        return {
            left: word.substring(0, focusPos),
            focus: word[focusPos],
            right: word.substring(focusPos + 1)
        };
    }
};
