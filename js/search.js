/**
 * Search module - search through book text
 */
const Search = {
    /**
     * Search for a query in words array
     * Returns array of { wordIndex, chapterTitle, contextHTML }
     */
    search(query, words, chapters, maxResults = 100) {
        if (!query || !words || words.length === 0) return [];

        const lowerQuery = query.toLowerCase();
        const results = [];

        for (let i = 0; i < words.length && results.length < maxResults; i++) {
            if (words[i].toLowerCase().includes(lowerQuery)) {
                // Get chapter title
                let chapterTitle = '';
                for (let c = chapters.length - 1; c >= 0; c--) {
                    if (i >= chapters[c].wordIndex) {
                        chapterTitle = chapters[c].title;
                        break;
                    }
                }

                // Get context (±5 words)
                const start = Math.max(0, i - 5);
                const end = Math.min(words.length, i + 6);
                const contextWords = words.slice(start, end);

                // Highlight the matched word
                const matchPos = i - start;
                const contextHTML = contextWords.map((w, idx) => {
                    if (idx === matchPos) {
                        return `<mark>${this.escapeHTML(w)}</mark>`;
                    }
                    return this.escapeHTML(w);
                }).join(' ');

                results.push({
                    wordIndex: i,
                    chapterTitle,
                    contextHTML
                });
            }
        }

        return results;
    },

    escapeHTML(str) {
        return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }
};
