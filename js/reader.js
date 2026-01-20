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
    intervalId: null,
    resumeTimeoutId: null,
    wpm: 250,

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
     * Start playing
     */
    play() {
        if (this.currentIndex >= this.words.length) {
            this.currentIndex = 0;
        }

        this.isPlaying = true;
        this.playIconEl.style.display = 'none';
        this.pauseIconEl.style.display = 'block';

        const interval = Math.round(60000 / this.wpm);
        this.intervalId = setInterval(() => this.nextWord(), interval);
    },

    /**
     * Pause playing
     */
    pause() {
        this.isPlaying = false;
        this.wasPlayingBeforeSeek = false;
        this.playIconEl.style.display = 'block';
        this.pauseIconEl.style.display = 'none';

        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
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
            clearInterval(this.intervalId);
            this.intervalId = null;
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
                const interval = Math.round(60000 / this.wpm);
                this.intervalId = setInterval(() => this.nextWord(), interval);
            }
            this.resumeTimeoutId = null;
        }, 500);
    },

    /**
     * Get speed step based on current WPM
     */
    getSpeedStep() {
        return this.wpm <= 100 ? 10 : 50;
    },

    /**
     * Decrease speed
     */
    slower() {
        const step = this.wpm <= 100 ? 10 : (this.wpm === 150 ? 50 : 50);
        let newWpm = this.wpm - step;
        // Snap to 100 when going down from 150
        if (this.wpm > 100 && newWpm < 100) newWpm = 100;
        this.wpm = Math.max(10, newWpm);
        this.updateSpeed();
    },

    /**
     * Increase speed
     */
    faster() {
        const step = this.wpm < 100 ? 10 : 50;
        let newWpm = this.wpm + step;
        // Snap to 150 when going up from 100
        if (this.wpm === 100) newWpm = 150;
        this.wpm = Math.min(1000, newWpm);
        this.updateSpeed();
    },

    /**
     * Update speed and restart if playing
     */
    updateSpeed() {
        this.updateSpeedDisplay();
        Storage.saveWPM(this.wpm);

        if (this.isPlaying) {
            clearInterval(this.intervalId);
            const interval = Math.round(60000 / this.wpm);
            this.intervalId = setInterval(() => this.nextWord(), interval);
        }
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
     * Save current position
     */
    savePosition() {
        if (this.currentBook) {
            Storage.saveReadingPosition(this.currentBook.id, this.currentIndex);
        }
    },

    /**
     * Go back to library
     */
    goBack() {
        this.pause();
        this.savePosition();
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
