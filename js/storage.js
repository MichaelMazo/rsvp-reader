/**
 * Storage module - IndexedDB for books, localStorage for settings
 */
const Storage = {
    DB_NAME: 'rsvp-reader-db',
    DB_VERSION: 1,
    STORE_BOOKS: 'books',
    db: null,

    /**
     * Initialize IndexedDB
     */
    async init() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.DB_NAME, this.DB_VERSION);

            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
                this.db = request.result;
                resolve();
            };

            request.onupgradeneeded = (event) => {
                const db = event.target.result;

                // Books store
                if (!db.objectStoreNames.contains(this.STORE_BOOKS)) {
                    const store = db.createObjectStore(this.STORE_BOOKS, { keyPath: 'id' });
                    store.createIndex('title', 'title', { unique: false });
                    store.createIndex('addedAt', 'addedAt', { unique: false });
                }
            };
        });
    },

    /**
     * Generate unique ID
     */
    generateId() {
        return Date.now().toString(36) + Math.random().toString(36).substr(2);
    },

    // ==================== BOOKS ====================

    /**
     * Save a book to IndexedDB
     */
    async saveBook(bookData) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([this.STORE_BOOKS], 'readwrite');
            const store = transaction.objectStore(this.STORE_BOOKS);

            const book = {
                id: bookData.id || this.generateId(),
                title: bookData.title,
                author: bookData.author || 'Unknown',
                cover: bookData.cover || null,
                fileData: bookData.fileData, // ArrayBuffer of epub
                totalWords: bookData.totalWords || 0,
                addedAt: bookData.addedAt || Date.now()
            };

            const request = store.put(book);
            request.onsuccess = () => resolve(book);
            request.onerror = () => reject(request.error);
        });
    },

    /**
     * Get all books (metadata only, without file data)
     */
    async getAllBooks() {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([this.STORE_BOOKS], 'readonly');
            const store = transaction.objectStore(this.STORE_BOOKS);
            const request = store.getAll();

            request.onsuccess = () => {
                // Return books without fileData for performance
                const books = request.result.map(book => ({
                    id: book.id,
                    title: book.title,
                    author: book.author,
                    cover: book.cover,
                    totalWords: book.totalWords,
                    addedAt: book.addedAt
                }));
                // Sort by addedAt descending
                books.sort((a, b) => b.addedAt - a.addedAt);
                resolve(books);
            };
            request.onerror = () => reject(request.error);
        });
    },

    /**
     * Get a single book with file data
     */
    async getBook(id) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([this.STORE_BOOKS], 'readonly');
            const store = transaction.objectStore(this.STORE_BOOKS);
            const request = store.get(id);

            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    },

    /**
     * Delete a book
     */
    async deleteBook(id) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([this.STORE_BOOKS], 'readwrite');
            const store = transaction.objectStore(this.STORE_BOOKS);
            const request = store.delete(id);

            request.onsuccess = () => {
                // Also remove reading position
                this.removeReadingPosition(id);
                resolve();
            };
            request.onerror = () => reject(request.error);
        });
    },

    /**
     * Update book's total words count
     */
    async updateBookWordCount(id, totalWords) {
        const book = await this.getBook(id);
        if (book) {
            book.totalWords = totalWords;
            await this.saveBook(book);
        }
    },

    // ==================== READING POSITION ====================

    /**
     * Save reading position for a book
     */
    saveReadingPosition(bookId, wordIndex) {
        const positions = this.getReadingPositions();
        positions[bookId] = {
            wordIndex,
            updatedAt: Date.now()
        };
        localStorage.setItem('reading-positions', JSON.stringify(positions));
    },

    /**
     * Get reading position for a book
     */
    getReadingPosition(bookId) {
        const positions = this.getReadingPositions();
        return positions[bookId]?.wordIndex || 0;
    },

    /**
     * Get all reading positions
     */
    getReadingPositions() {
        try {
            return JSON.parse(localStorage.getItem('reading-positions')) || {};
        } catch {
            return {};
        }
    },

    /**
     * Remove reading position
     */
    removeReadingPosition(bookId) {
        const positions = this.getReadingPositions();
        delete positions[bookId];
        localStorage.setItem('reading-positions', JSON.stringify(positions));
    },

    // ==================== SETTINGS ====================

    /**
     * Get settings
     */
    getSettings() {
        const defaults = {
            wpm: 250,
            fontSize: 48,
            longWordThreshold: 8,    // Words >= this length get extra time
            longWordExtraTime: 30    // Extra time percentage for long words
        };
        try {
            const stored = JSON.parse(localStorage.getItem('settings'));
            return { ...defaults, ...stored };
        } catch {
            return defaults;
        }
    },

    /**
     * Save settings
     */
    saveSettings(settings) {
        const current = this.getSettings();
        localStorage.setItem('settings', JSON.stringify({ ...current, ...settings }));
    },

    /**
     * Get WPM setting
     */
    getWPM() {
        return this.getSettings().wpm;
    },

    /**
     * Save WPM setting
     */
    saveWPM(wpm) {
        this.saveSettings({ wpm });
    },

    /**
     * Get font size setting
     */
    getFontSize() {
        return this.getSettings().fontSize;
    },

    /**
     * Save font size setting
     */
    saveFontSize(fontSize) {
        this.saveSettings({ fontSize });
    },

    /**
     * Get long word threshold setting
     */
    getLongWordThreshold() {
        return this.getSettings().longWordThreshold;
    },

    /**
     * Save long word threshold setting
     */
    saveLongWordThreshold(threshold) {
        this.saveSettings({ longWordThreshold: threshold });
    },

    /**
     * Get long word extra time setting (percentage)
     */
    getLongWordExtraTime() {
        return this.getSettings().longWordExtraTime;
    },

    /**
     * Save long word extra time setting
     */
    saveLongWordExtraTime(percent) {
        this.saveSettings({ longWordExtraTime: percent });
    }
};
