/**
 * Reader module - RSVP reading functionality
 */
const Reader = {
    // State
    currentBook: null,
    words: [],
    chapters: [],
    currentIndex: 0,
    isPlaying: false,
    wasPlayingBeforeSeek: false,
    timeoutId: null,
    resumeTimeoutId: null,
    syncTimeoutId: null,
    wpm: 250,
    longWordThreshold: 8,
    longWordExtraTime: 30,

    // DOM elements
    screenEl: null,
    titleEl: null,
    wordLeftEl: null,
    wordFocusEl: null,
    wordRightEl: null,
    progressFillEl: null,
    progressTextEl: null,
    speedDisplayEl: null,
    playBtnEl: null,
    playIconEl: null,
    pauseIconEl: null,

    /**
     * Initialize reader
     */
    init() {
        this.screenEl = document.getElementById('reader-screen');
        this.titleEl = document.getElementById('book-title');
        this.wordLeftEl = this.screenEl.querySelector('.word-left');
        this.wordFocusEl = this.screenEl.querySelector('.word-focus');
        this.wordRightEl = this.screenEl.querySelector('.word-right');
        this.progressFillEl = document.getElementById('progress-fill');
        this.progressTextEl = document.getElementById('progress-text');
        this.speedDisplayEl = document.getElementById('speed-display');
        this.playBtnEl = document.getElementById('play-btn');
        this.playIconEl = this.playBtnEl.querySelector('.play-icon');
        this.pauseIconEl = this.playBtnEl.querySelector('.pause-icon');

        // Load settings
        this.wpm = Storage.getWPM();
        this.longWordThreshold = Storage.getLongWordThreshold();
        this.longWordExtraTime = Storage.getLongWordExtraTime();
        this.updateFontSize();

        // Event listeners
        document.getElementById('back-btn').addEventListener('click', () => this.goBack());
        this.playBtnEl.addEventListener('click', () => this.togglePlay());
        document.getElementById('rewind-btn').addEventListener('click', () => this.rewind());
        document.getElementById('forward-btn').addEventListener('click', () => this.forward());
        document.getElementById('slower-btn').addEventListener('click', () => this.slower());
        document.getElementById('faster-btn').addEventListener('click', () => this.faster());

        // Progress bar click
        document.getElementById('progress-bar').addEventListener('click', (e) => this.seekTo(e));

        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => this.handleKeyboard(e));

        // Tap to pause/play (on mobile)
        document.getElementById('word-display').addEventListener('click', () => this.togglePlay());

        // TOC button
        document.getElementById('toc-btn').addEventListener('click', () => this.showTOC());
        document.getElementById('close-toc-btn').addEventListener('click', () => this.hideTOC());
        document.getElementById('toc-modal').addEventListener('click', (e) => {
            if (e.target.id === 'toc-modal') this.hideTOC();
        });

        this.updateSpeedDisplay();
    },

    /**
     * Load a book for reading
     */
    async loadBook(bookId) {
        const book = await Storage.getBook(bookId);
        if (!book) {
            alert('Book not found');
            return false;
        }

        this.currentBook = book;
        this.titleEl.textContent = book.title;

        // Show loading
        this.displayWord('Loading...');

        try {
            // Extract words and chapters
            const result = await EpubParser.extractWordsWithChapters(book.fileData);
            this.words = result.words;
            this.chapters = result.chapters;

            if (this.words.length === 0) {
                throw new Error('No text found in book');
            }

            // Update word count in storage
            if (book.totalWords !== this.words.length) {
                await Storage.updateBookWordCount(bookId, this.words.length);
            }

            // Restore position
            this.currentIndex = Storage.getReadingPosition(bookId);
            if (this.currentIndex >= this.words.length) {
                this.currentIndex = 0;
            }

            // Display current word
            this.displayCurrentWord();
            this.updateProgress();

            return true;
        } catch (error) {
            console.error('Failed to load book:', error);
            alert('Failed to load book: ' + error.message);
            return false;
        }
    },

    /**
     * Display a word with ORP highlighting
     */
    displayWord(word) {
        const parts = EpubParser.splitWordForORP(word);
        this.wordLeftEl.textContent = parts.left;
        this.wordFocusEl.textContent = parts.focus;
        this.wordRightEl.textContent = parts.right;
    },

    /**
     * Display current word
     */
    displayCurrentWord() {
        if (this.currentIndex < this.words.length) {
            this.displayWord(this.words[this.currentIndex]);
        }
    },

    /**
     * Toggle play/pause
     */
    togglePlay() {
        if (this.isPlaying) {
            this.pause();
        } else {
            this.play();
        }
    },

    /**
     * Calculate display time for a word based on its length
     */
    getWordDisplayTime(word) {
        const baseInterval = Math.round(60000 / this.wpm);

        // Get clean word length (without punctuation)
        const cleanWord = word.replace(/[^\p{L}\p{N}]/gu, '');
        const wordLength = cleanWord.length;

        // If word is longer than threshold, add extra time
        if (wordLength >= this.longWordThreshold) {
            const extraMultiplier = 1 + (this.longWordExtraTime / 100);
            return Math.round(baseInterval * extraMultiplier);
        }

        return baseInterval;
    },

    /**
     * Schedule the next word with appropriate delay
     */
    scheduleNextWord() {
        if (!this.isPlaying || this.currentIndex >= this.words.length) {
            return;
        }

        const currentWord = this.words[this.currentIndex];
        const displayTime = this.getWordDisplayTime(currentWord);

        this.timeoutId = setTimeout(() => this.nextWord(), displayTime);
    },

    /**
     * Start playing
     */
    play() {
        if (this.currentIndex >= this.words.length) {
            this.currentIndex = 0;
        }

        this.isPlaying = true;
        this.playIconEl.style.display = 'none';
        this.pauseIconEl.style.display = 'block';

        // Use setTimeout for dynamic word timing
        this.scheduleNextWord();
    },

    /**
     * Pause playing
     */
    pause() {
        this.isPlaying = false;
        this.wasPlayingBeforeSeek = false;
        this.playIconEl.style.display = 'block';
        this.pauseIconEl.style.display = 'none';

        if (this.timeoutId) {
            clearTimeout(this.timeoutId);
            this.timeoutId = null;
        }

        if (this.resumeTimeoutId) {
            clearTimeout(this.resumeTimeoutId);
            this.resumeTimeoutId = null;
        }

        // Save position
        this.savePosition();
    },

    /**
     * Show next word
     */
    nextWord() {
        this.currentIndex++;

        if (this.currentIndex >= this.words.length) {
            this.pause();
            this.displayWord('End');
            return;
        }

        this.displayCurrentWord();
        this.updateProgress();

        // Schedule next word with dynamic timing
        this.scheduleNextWord();
    },

    /**
     * Rewind (go back 10 words) with pause
     */
    rewind() {
        this.seekWithPause(() => {
            this.currentIndex = Math.max(0, this.currentIndex - 10);
        });
    },

    /**
     * Forward (skip 10 words) with pause
     */
    forward() {
        this.seekWithPause(() => {
            this.currentIndex = Math.min(this.words.length - 1, this.currentIndex + 10);
        });
    },

    /**
     * Seek with temporary pause and debounced resume
     */
    seekWithPause(seekFn) {
        // Remember if was playing
        if (this.isPlaying && !this.wasPlayingBeforeSeek) {
            this.wasPlayingBeforeSeek = true;
        }

        // Pause playback
        if (this.isPlaying) {
            clearTimeout(this.timeoutId);
            this.timeoutId = null;
        }

        // Clear previous resume timeout
        if (this.resumeTimeoutId) {
            clearTimeout(this.resumeTimeoutId);
        }

        // Execute seek
        seekFn();
        this.displayCurrentWord();
        this.updateProgress();
        this.savePosition();

        // Schedule resume after 500ms
        this.resumeTimeoutId = setTimeout(() => {
            if (this.wasPlayingBeforeSeek) {
                this.wasPlayingBeforeSeek = false;
                this.scheduleNextWord();
            }
            this.resumeTimeoutId = null;
        }, 500);
    },

    /**
     * Get speed step (always 10)
     */
    getSpeedStep() {
        return 10;
    },

    /**
     * Decrease speed by 10 WPM
     */
    slower() {
        this.wpm = Math.max(10, this.wpm - 10);
        this.updateSpeed();
    },

    /**
     * Increase speed by 10 WPM
     */
    faster() {
        this.wpm = Math.min(1000, this.wpm + 10);
        this.updateSpeed();
    },

    /**
     * Update speed and restart if playing
     */
    updateSpeed() {
        this.updateSpeedDisplay();
        Storage.saveWPM(this.wpm);

        if (this.isPlaying) {
            clearTimeout(this.timeoutId);
            this.scheduleNextWord();
        }
    },

    /**
     * Update long word settings
     */
    updateLongWordSettings(threshold, extraTime) {
        this.longWordThreshold = threshold;
        this.longWordExtraTime = extraTime;
        Storage.saveLongWordThreshold(threshold);
        Storage.saveLongWordExtraTime(extraTime);
    },

    /**
     * Update speed display
     */
    updateSpeedDisplay() {
        this.speedDisplayEl.textContent = `${this.wpm} WPM`;
    },

    /**
     * Update progress bar
     */
    updateProgress() {
        const progress = (this.currentIndex / this.words.length) * 100;
        this.progressFillEl.style.width = `${progress}%`;
        this.progressTextEl.textContent = `${Math.round(progress)}%`;
    },

    /**
     * Seek to position on progress bar click
     */
    seekTo(event) {
        const rect = event.currentTarget.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const percent = x / rect.width;
        this.currentIndex = Math.floor(percent * this.words.length);
        this.displayCurrentWord();
        this.updateProgress();
        this.savePosition();
    },

    /**
     * Save current position (with debounced cloud sync)
     */
    savePosition() {
        if (this.currentBook) {
            Storage.saveReadingPosition(this.currentBook.id, this.currentIndex);

            // Debounced cloud sync (every 5 seconds max)
            if (this.syncTimeoutId) {
                clearTimeout(this.syncTimeoutId);
            }
            this.syncTimeoutId = setTimeout(() => {
                if (FirebaseSync.currentUser) {
                    FirebaseSync.updateBookPosition(this.currentBook.id, this.currentIndex);
                }
                this.syncTimeoutId = null;
            }, 5000);
        }
    },

    /**
     * Go back to library
     */
    goBack() {
        this.pause();
        // Force immediate cloud sync on exit
        if (this.currentBook && FirebaseSync.currentUser) {
            FirebaseSync.updateBookPosition(this.currentBook.id, this.currentIndex);
        }
        Storage.saveReadingPosition(this.currentBook.id, this.currentIndex);
        App.showLibrary();
    },

    /**
     * Handle keyboard shortcuts
     */
    handleKeyboard(event) {
        if (!this.screenEl.classList.contains('active')) return;

        switch (event.code) {
            case 'Space':
                event.preventDefault();
                this.togglePlay();
                break;
            case 'ArrowLeft':
                this.rewind();
                break;
            case 'ArrowRight':
                this.forward();
                break;
            case 'ArrowUp':
                this.faster();
                break;
            case 'ArrowDown':
                this.slower();
                break;
            case 'Escape':
                this.goBack();
                break;
        }
    },

    /**
     * Update font size from settings
     */
    updateFontSize() {
        const fontSize = Storage.getFontSize();
        document.documentElement.style.setProperty('--font-size-word', `${fontSize}px`);
    },

    /**
     * Show table of contents modal
     */
    showTOC() {
        this.pause();
        const tocList = document.getElementById('toc-list');
        const tocModal = document.getElementById('toc-modal');

        if (this.chapters.length === 0) {
            tocList.innerHTML = '<div class="toc-empty">Оглавление недоступно</div>';
        } else {
            // Find current chapter
            let currentChapterIndex = 0;
            for (let i = this.chapters.length - 1; i >= 0; i--) {
                if (this.currentIndex >= this.chapters[i].wordIndex) {
                    currentChapterIndex = i;
                    break;
                }
            }

            tocList.innerHTML = this.chapters.map((chapter, index) => {
                const isActive = index === currentChapterIndex;
                const depthClass = chapter.depth > 0 ? `depth-${Math.min(chapter.depth, 2)}` : '';
                return `
                    <div class="toc-item ${depthClass} ${isActive ? 'active' : ''}"
                         data-index="${index}">
                        ${chapter.title}
                    </div>
                `;
            }).join('');

            // Add click listeners
            tocList.querySelectorAll('.toc-item').forEach(item => {
                item.addEventListener('click', () => {
                    const chapterIndex = parseInt(item.dataset.index);
                    this.goToChapter(chapterIndex);
                    this.hideTOC();
                });
            });

            // Scroll to active chapter
            const activeItem = tocList.querySelector('.toc-item.active');
            if (activeItem) {
                activeItem.scrollIntoView({ block: 'center' });
            }
        }

        tocModal.classList.add('active');
    },

    /**
     * Hide table of contents modal
     */
    hideTOC() {
        document.getElementById('toc-modal').classList.remove('active');
    },

    /**
     * Go to a specific chapter
     */
    goToChapter(chapterIndex) {
        if (chapterIndex >= 0 && chapterIndex < this.chapters.length) {
            this.currentIndex = this.chapters[chapterIndex].wordIndex;
            this.displayCurrentWord();
            this.updateProgress();
            this.savePosition();
        }
    },

    /**
     * Reset state when leaving reader
     */
    reset() {
        this.pause();
        this.currentBook = null;
        this.words = [];
        this.chapters = [];
        this.currentIndex = 0;
    }
};
