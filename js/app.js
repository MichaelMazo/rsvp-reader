/**
 * Main App module - navigation and initialization
 */
const App = {
    libraryScreen: null,
    readerScreen: null,
    settingsModal: null,
    currentMode: 'normal', // 'normal' or 'rsvp'
    cachedParseResult: null,
    currentBookId: null,

    /**
     * Initialize the application
     */
    async init() {
        // Get screen elements
        this.libraryScreen = document.getElementById('library-screen');
        this.readerScreen = document.getElementById('reader-screen');
        this.settingsModal = document.getElementById('settings-modal');

        // Initialize storage first
        await Storage.init();

        // Initialize modules
        Library.init();
        Reader.init();
        NormalReader.init();
        FirebaseSync.init();

        // Setup settings modal
        this.initSettings();

        // Setup Firebase auth UI
        this.initAuth();

        // Setup mode toggle
        this.initModeToggle();

        // Setup bookmarks
        this.initBookmarks();

        // Setup search
        this.initSearch();

        // Register service worker for PWA
        this.registerServiceWorker();

        console.log('RSVP Reader initialized');
    },

    /**
     * Initialize Firebase auth UI
     */
    initAuth() {
        const signInBtn = document.getElementById('sign-in-btn');
        const userInfo = document.getElementById('user-info');
        const signOutBtn = document.getElementById('sign-out-btn');
        const syncNowBtn = document.getElementById('sync-now-btn');
        const syncSection = document.getElementById('sync-section');

        signInBtn.addEventListener('click', () => {
            FirebaseSync.signIn();
        });

        userInfo.addEventListener('click', () => {
            this.settingsModal.classList.add('active');
        });

        signOutBtn.addEventListener('click', () => {
            FirebaseSync.signOut();
            this.settingsModal.classList.remove('active');
        });

        syncNowBtn.addEventListener('click', async () => {
            syncNowBtn.textContent = 'Синхронизация...';
            syncNowBtn.disabled = true;
            await FirebaseSync.syncAllToCloud();
            await FirebaseSync.syncFromCloud();
            syncNowBtn.textContent = 'Синхронизировать';
            syncNowBtn.disabled = false;
        });

        auth.onAuthStateChanged(user => {
            if (user) {
                syncSection.style.display = 'flex';
            } else {
                syncSection.style.display = 'none';
            }
        });
    },

    /**
     * Initialize settings modal
     */
    initSettings() {
        const fontSizeSlider = document.getElementById('font-size-slider');
        const fontSizeValue = document.getElementById('font-size-value');
        const speedSlider = document.getElementById('default-speed-slider');
        const speedValue = document.getElementById('default-speed-value');
        const thresholdSlider = document.getElementById('long-word-threshold-slider');
        const thresholdValue = document.getElementById('long-word-threshold-value');
        const extraTimeSlider = document.getElementById('long-word-extra-slider');
        const extraTimeValue = document.getElementById('long-word-extra-value');
        const closeBtn = document.getElementById('close-settings-btn');

        // Normal mode settings
        const normalFontSizeSlider = document.getElementById('normal-font-size-slider');
        const normalFontSizeValue = document.getElementById('normal-font-size-value');
        const fontSansBtn = document.getElementById('font-sans-btn');
        const fontSerifBtn = document.getElementById('font-serif-btn');

        // Load current settings
        const settings = Storage.getSettings();
        fontSizeSlider.value = settings.fontSize;
        fontSizeValue.textContent = `${settings.fontSize}px`;
        speedSlider.value = settings.wpm;
        speedValue.textContent = `${settings.wpm} WPM`;
        thresholdSlider.value = settings.longWordThreshold;
        thresholdValue.textContent = `${settings.longWordThreshold} букв`;
        extraTimeSlider.value = settings.longWordExtraTime;
        extraTimeValue.textContent = `+${settings.longWordExtraTime}%`;

        // Normal mode settings
        const normalFontSize = settings.normalFontSize || 18;
        normalFontSizeSlider.value = normalFontSize;
        normalFontSizeValue.textContent = `${normalFontSize}px`;

        const fontFamily = settings.fontFamily || 'sans-serif';
        if (fontFamily === 'serif') {
            fontSerifBtn.classList.add('active');
            fontSansBtn.classList.remove('active');
        }

        // RSVP font size change
        fontSizeSlider.addEventListener('input', () => {
            const size = parseInt(fontSizeSlider.value);
            fontSizeValue.textContent = `${size}px`;
            Storage.saveFontSize(size);
            Reader.updateFontSize();
        });

        // Speed change
        speedSlider.addEventListener('input', () => {
            const wpm = parseInt(speedSlider.value);
            speedValue.textContent = `${wpm} WPM`;
            Storage.saveWPM(wpm);
            Reader.wpm = wpm;
            Reader.updateSpeedDisplay();
        });

        // Long word threshold change
        thresholdSlider.addEventListener('input', () => {
            const threshold = parseInt(thresholdSlider.value);
            thresholdValue.textContent = `${threshold} букв`;
            Reader.updateLongWordSettings(threshold, Reader.longWordExtraTime);
        });

        // Long word extra time change
        extraTimeSlider.addEventListener('input', () => {
            const extraTime = parseInt(extraTimeSlider.value);
            extraTimeValue.textContent = `+${extraTime}%`;
            Reader.updateLongWordSettings(Reader.longWordThreshold, extraTime);
        });

        // Normal mode font size
        normalFontSizeSlider.addEventListener('input', () => {
            const size = parseInt(normalFontSizeSlider.value);
            normalFontSizeValue.textContent = `${size}px`;
            Storage.saveSettings({ normalFontSize: size });
            NormalReader.recalculate();
        });

        // Font family toggle
        fontSansBtn.addEventListener('click', () => {
            fontSansBtn.classList.add('active');
            fontSerifBtn.classList.remove('active');
            Storage.saveSettings({ fontFamily: 'sans-serif' });
            NormalReader.recalculate();
        });

        fontSerifBtn.addEventListener('click', () => {
            fontSerifBtn.classList.add('active');
            fontSansBtn.classList.remove('active');
            Storage.saveSettings({ fontFamily: 'serif' });
            NormalReader.recalculate();
        });

        // Open settings
        document.getElementById('settings-btn').addEventListener('click', () => {
            this.settingsModal.classList.add('active');
        });
        document.getElementById('reader-settings-btn').addEventListener('click', () => {
            this.settingsModal.classList.add('active');
        });

        // Close settings
        closeBtn.addEventListener('click', () => {
            this.settingsModal.classList.remove('active');
        });

        // Close on backdrop click
        this.settingsModal.addEventListener('click', (e) => {
            if (e.target === this.settingsModal) {
                this.settingsModal.classList.remove('active');
            }
        });
    },

    /**
     * Initialize mode toggle button
     */
    initModeToggle() {
        document.getElementById('mode-toggle-btn').addEventListener('click', () => {
            if (this.currentMode === 'normal') {
                const wordIndex = NormalReader.getVisibleWordIndex();
                this.switchMode('rsvp', wordIndex);
            } else {
                this.switchMode('normal', Reader.currentIndex);
            }
        });
    },

    /**
     * Switch between normal and RSVP modes
     */
    switchMode(mode, wordIndex) {
        if (mode === this.currentMode) return;

        const rsvpContent = document.getElementById('rsvp-content');
        const rsvpControls = document.getElementById('rsvp-controls');
        const modeIconBook = document.getElementById('mode-icon-book');
        const modeIconRsvp = document.getElementById('mode-icon-rsvp');

        if (mode === 'rsvp') {
            Reader.pause();
            NormalReader.hide();
            rsvpContent.style.display = 'flex';
            rsvpControls.style.display = 'block';
            modeIconBook.style.display = 'block';
            modeIconRsvp.style.display = 'none';

            // Set RSVP position
            if (wordIndex !== undefined) {
                Reader.currentIndex = wordIndex;
                Reader.displayCurrentWord();
                Reader.updateProgress();
            }
        } else {
            Reader.pause();
            rsvpContent.style.display = 'none';
            rsvpControls.style.display = 'none';
            NormalReader.show();
            modeIconBook.style.display = 'none';
            modeIconRsvp.style.display = 'block';

            // Navigate to word position and highlight it
            if (wordIndex !== undefined) {
                setTimeout(() => {
                    NormalReader.goToWordIndex(wordIndex);
                    NormalReader.highlightWord(wordIndex);
                });
            }
        }

        this.currentMode = mode;
    },

    /**
     * Initialize bookmarks
     */
    initBookmarks() {
        const bookmarkBtn = document.getElementById('bookmark-btn');
        const bookmarksModal = document.getElementById('bookmarks-modal');
        const closeBtn = document.getElementById('close-bookmarks-btn');

        // Short press: add bookmark
        // Long press: show bookmarks list
        let pressTimer = null;
        let isLongPress = false;

        bookmarkBtn.addEventListener('mousedown', () => {
            isLongPress = false;
            pressTimer = setTimeout(() => {
                isLongPress = true;
                this.showBookmarks();
            }, 500);
        });

        bookmarkBtn.addEventListener('mouseup', () => {
            clearTimeout(pressTimer);
            if (!isLongPress) {
                this.addBookmark();
            }
        });

        bookmarkBtn.addEventListener('mouseleave', () => {
            clearTimeout(pressTimer);
        });

        // Touch equivalents
        bookmarkBtn.addEventListener('touchstart', (e) => {
            isLongPress = false;
            pressTimer = setTimeout(() => {
                isLongPress = true;
                this.showBookmarks();
            }, 500);
        });

        bookmarkBtn.addEventListener('touchend', (e) => {
            clearTimeout(pressTimer);
            if (!isLongPress) {
                e.preventDefault();
                this.addBookmark();
            }
        });

        closeBtn.addEventListener('click', () => {
            bookmarksModal.classList.remove('active');
        });

        bookmarksModal.addEventListener('click', (e) => {
            if (e.target === bookmarksModal) {
                bookmarksModal.classList.remove('active');
            }
        });
    },

    addBookmark() {
        if (!this.currentBookId) return;

        let wordIndex;
        if (this.currentMode === 'rsvp') {
            wordIndex = Reader.currentIndex;
        } else {
            wordIndex = NormalReader.getVisibleWordIndex();
        }

        // Get chapter title
        const chapters = this.cachedParseResult?.chapters || [];
        let chapterTitle = '';
        for (let i = chapters.length - 1; i >= 0; i--) {
            if (wordIndex >= chapters[i].wordIndex) {
                chapterTitle = chapters[i].title;
                break;
            }
        }

        // Get preview text (surrounding words)
        const words = this.cachedParseResult?.words || [];
        const start = Math.max(0, wordIndex);
        const end = Math.min(words.length, wordIndex + 10);
        const preview = words.slice(start, end).join(' ');

        Storage.addBookmark(this.currentBookId, {
            id: Storage.generateId(),
            wordIndex,
            preview,
            chapterTitle,
            createdAt: Date.now()
        });

        // Brief visual feedback
        const btn = document.getElementById('bookmark-btn');
        btn.style.color = 'var(--accent)';
        setTimeout(() => { btn.style.color = ''; }, 500);
    },

    showBookmarks() {
        if (!this.currentBookId) return;
        const bookmarks = Storage.getBookmarks(this.currentBookId);
        const list = document.getElementById('bookmarks-list');
        const modal = document.getElementById('bookmarks-modal');

        if (bookmarks.length === 0) {
            list.innerHTML = '<div class="bookmarks-empty">Нет закладок</div>';
        } else {
            list.innerHTML = bookmarks.map(b => `
                <div class="bookmark-item" data-word-index="${b.wordIndex}">
                    <div class="bookmark-info">
                        ${b.chapterTitle ? `<div class="bookmark-chapter">${b.chapterTitle}</div>` : ''}
                        <div class="bookmark-preview">${b.preview}</div>
                    </div>
                    <button class="bookmark-delete" data-id="${b.id}" aria-label="Удалить">
                        <svg viewBox="0 0 24 24" width="18" height="18">
                            <path fill="currentColor" d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
                        </svg>
                    </button>
                </div>
            `).join('');

            // Navigate on click
            list.querySelectorAll('.bookmark-item').forEach(item => {
                item.addEventListener('click', (e) => {
                    if (e.target.closest('.bookmark-delete')) return;
                    const wordIndex = parseInt(item.dataset.wordIndex);
                    this.navigateToWord(wordIndex);
                    modal.classList.remove('active');
                });
            });

            // Delete bookmark
            list.querySelectorAll('.bookmark-delete').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    Storage.removeBookmark(this.currentBookId, btn.dataset.id);
                    this.showBookmarks(); // Refresh list
                });
            });
        }

        modal.classList.add('active');
    },

    /**
     * Initialize search
     */
    initSearch() {
        const searchBtn = document.getElementById('search-btn');
        const searchModal = document.getElementById('search-modal');
        const closeBtn = document.getElementById('close-search-btn');
        const searchInput = document.getElementById('search-input');

        searchBtn.addEventListener('click', () => {
            searchModal.classList.add('active');
            searchInput.value = '';
            document.getElementById('search-results').innerHTML = '';
            setTimeout(() => searchInput.focus(), 100);
        });

        closeBtn.addEventListener('click', () => {
            searchModal.classList.remove('active');
        });

        searchModal.addEventListener('click', (e) => {
            if (e.target === searchModal) {
                searchModal.classList.remove('active');
            }
        });

        let searchTimeout;
        searchInput.addEventListener('input', () => {
            clearTimeout(searchTimeout);
            searchTimeout = setTimeout(() => {
                this.performSearch(searchInput.value);
            }, 300);
        });
    },

    performSearch(query) {
        const resultsEl = document.getElementById('search-results');
        if (!query || query.length < 2 || !this.cachedParseResult) {
            resultsEl.innerHTML = '';
            return;
        }

        const results = Search.search(query, this.cachedParseResult.words, this.cachedParseResult.chapters);

        if (results.length === 0) {
            resultsEl.innerHTML = '<div class="search-empty">Ничего не найдено</div>';
            return;
        }

        resultsEl.innerHTML = results.map(r => `
            <div class="search-result-item" data-word-index="${r.wordIndex}">
                ${r.chapterTitle ? `<div class="search-result-chapter">${r.chapterTitle}</div>` : ''}
                <div class="search-result-context">${r.contextHTML}</div>
            </div>
        `).join('');

        resultsEl.querySelectorAll('.search-result-item').forEach(item => {
            item.addEventListener('click', () => {
                const wordIndex = parseInt(item.dataset.wordIndex);
                this.navigateToWord(wordIndex);
                document.getElementById('search-modal').classList.remove('active');
            });
        });
    },

    /**
     * Navigate to a word index in the current mode
     */
    navigateToWord(wordIndex) {
        if (this.currentMode === 'rsvp') {
            Reader.currentIndex = wordIndex;
            Reader.displayCurrentWord();
            Reader.updateProgress();
            Reader.savePosition();
        } else {
            NormalReader.goToWordIndex(wordIndex);
        }
    },

    /**
     * Show library screen
     */
    showLibrary() {
        Reader.pause();
        // Save position
        if (this.currentBookId) {
            let wordIndex;
            if (this.currentMode === 'rsvp') {
                wordIndex = Reader.currentIndex;
            } else {
                wordIndex = NormalReader.getVisibleWordIndex();
            }
            Storage.saveReadingPosition(this.currentBookId, wordIndex);
            if (FirebaseSync.currentUser) {
                FirebaseSync.updateBookPosition(this.currentBookId, wordIndex);
            }
        }
        this.readerScreen.classList.remove('active');
        this.libraryScreen.classList.add('active');
        Library.renderBooks();
    },

    /**
     * Open a book for reading
     */
    async openBook(bookId) {
        this.currentBookId = bookId;

        const book = await Storage.getBook(bookId);
        if (!book) {
            alert('Book not found');
            return;
        }

        // Show reader screen
        this.libraryScreen.classList.remove('active');
        this.readerScreen.classList.add('active');

        // Parse the book once
        try {
            const result = await EpubParser.extractWordsWithChapters(book.fileData);
            this.cachedParseResult = result;

            if (result.words.length === 0) {
                throw new Error('No text found in book');
            }

            // Update word count if needed
            if (book.totalWords !== result.words.length) {
                await Storage.updateBookWordCount(bookId, result.words.length);
            }

            // Set book title
            document.getElementById('book-title').textContent = book.title;

            // Load data into both readers
            Reader.loadBookData(book, result.words, result.chapters);
            NormalReader.loadBookData(book, result.words, result.chapters, result.chaptersHTML);

            // Open in default mode (normal)
            this.currentMode = 'normal';
            this.switchMode('normal', Storage.getReadingPosition(bookId));

        } catch (error) {
            console.error('Failed to load book:', error);
            alert('Failed to load book: ' + error.message);
            this.showLibrary();
        }
    },

    /**
     * Register service worker
     */
    registerServiceWorker() {
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' })
                .then(reg => console.log('Service Worker registered'))
                .catch(err => console.log('Service Worker registration failed:', err));
        }
    }
};

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => App.init());
