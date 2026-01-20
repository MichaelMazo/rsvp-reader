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
                words.push(...chapterWords);
            } catch (e) {
                console.warn('Failed to load chapter:', item.href, e);
            }
        }

        return { words, chapters };
    },

    /**
     * Extract all text from epub and split into words (legacy, returns only words)
     */
    async extractWords(arrayBuffer) {
        const result = await this.extractWordsWithChapters(arrayBuffer);
        return result.words;
    },

    /**
     * Extract text content from HTML document
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

        // Get text content
        return body.textContent || body.innerText || '';
    },

    /**
     * Split text into words, preserving punctuation attached to words
     */
    splitIntoWords(text) {
        // Normalize whitespace and split
        const words = text
            .replace(/\s+/g, ' ')
            .trim()
            .split(' ')
            .filter(word => word.length > 0);

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
