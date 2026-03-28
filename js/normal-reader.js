/**
 * Normal Reader module - paginated reading with formatted text.
 * Uses per-chapter rendering for performance (only current chapter in DOM).
 */
const NormalReader = {
    // State
    currentBook: null,
    chaptersHTML: [],
    words: [],
    chapters: [],

    // Pagination
    currentChapterIndex: 0,
    currentPageInChapter: 0,
    totalPagesInChapter: 1,
    pageWidth: 0,

    // Global page tracking (for display)
    chapterPageOffsets: [],  // cumulative page count per chapter
    totalPages: 1,

    // DOM elements
    contentEl: null,
    pagesEl: null,
    containerEl: null,
    pageIndicatorEl: null,
    floatingRsvpBtn: null,

    // Touch tracking
    touchStartX: 0,
    touchStartY: 0,
    touchStartTime: 0,
    isSwiping: false,

    init() {
        this.contentEl = document.getElementById('normal-reader-content');
        this.containerEl = document.getElementById('normal-reader-container');
        this.pagesEl = document.getElementById('normal-reader-pages');
        this.pageIndicatorEl = document.getElementById('page-indicator');
        this.floatingRsvpBtn = document.getElementById('start-rsvp-btn');

        this.containerEl.addEventListener('touchstart', (e) => this.onTouchStart(e), { passive: true });
        this.containerEl.addEventListener('touchmove', (e) => this.onTouchMove(e), { passive: false });
        this.containerEl.addEventListener('touchend', (e) => this.onTouchEnd(e));
        this.containerEl.addEventListener('click', (e) => this.onContainerClick(e));

        document.addEventListener('selectionchange', () => this.onSelectionChange());
        this.floatingRsvpBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.startRsvpFromSelection();
        });

        document.addEventListener('keydown', (e) => this.handleKeyboard(e));

        window.addEventListener('resize', () => {
            if (this.contentEl.style.display !== 'none' && this.chaptersHTML.length > 0) {
                this.recalculate();
            }
        });

        this.applyFontSettings();
    },

    applyFontSettings() {
        const settings = Storage.getSettings();
        const fontSize = settings.normalFontSize || 18;
        const fontFamily = settings.fontFamily || 'sans-serif';
        document.documentElement.style.setProperty('--normal-font-size', `${fontSize}px`);
        document.documentElement.style.setProperty('--normal-font-family', fontFamily === 'serif'
            ? "'Georgia', 'Times New Roman', serif"
            : "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif");
    },

    loadBookData(book, words, chapters, chaptersHTML) {
        this.currentBook = book;
        this.words = words;
        this.chapters = chapters;
        this.chaptersHTML = chaptersHTML;

        // Estimate page counts per chapter for global page numbers
        this.estimatePageCounts();

        // Restore position
        const wordIndex = Storage.getReadingPosition(book.id);
        const chIdx = this.findChapterByWordIndex(wordIndex);
        this.currentChapterIndex = chIdx;
        this.renderCurrentChapter(() => {
            this.goToWordIndex(wordIndex);
        });
    },

    /**
     * Estimate page counts per chapter based on word count.
     * Recalculated precisely for the current chapter after rendering.
     */
    estimatePageCounts() {
        this.pageWidth = this.containerEl.clientWidth || window.innerWidth;
        // Rough estimate: ~300 words per page at default settings
        const wordsPerPage = 300;
        this.chapterPageOffsets = [];
        let cumulative = 0;
        for (const ch of this.chaptersHTML) {
            this.chapterPageOffsets.push(cumulative);
            const wordCount = ch.endWordIndex - ch.startWordIndex + 1;
            cumulative += Math.max(1, Math.ceil(wordCount / wordsPerPage));
        }
        this.totalPages = cumulative;
    },

    findChapterByWordIndex(wordIndex) {
        for (let i = this.chaptersHTML.length - 1; i >= 0; i--) {
            if (wordIndex >= this.chaptersHTML[i].startWordIndex) {
                return i;
            }
        }
        return 0;
    },

    renderCurrentChapter(callback) {
        const ch = this.chaptersHTML[this.currentChapterIndex];
        if (!ch) return;

        this.pagesEl.style.transform = 'translate3d(0, 0, 0)';
        this.pagesEl.innerHTML = `<div class="chapter-content">${ch.html}</div>`;

        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                this.calculateChapterPages();
                if (callback) callback();
            });
        });
    },

    calculateChapterPages() {
        this.pageWidth = this.containerEl.clientWidth;
        if (this.pageWidth === 0) return;

        this.pagesEl.style.columnWidth = `${this.pageWidth}px`;
        this.pagesEl.style.columnGap = '0px';
        void this.pagesEl.offsetHeight;

        const scrollWidth = this.pagesEl.scrollWidth;
        this.totalPagesInChapter = Math.max(1, Math.round(scrollWidth / this.pageWidth));

        // Update global page count with precise value for current chapter
        this.chapterPageOffsets[this.currentChapterIndex] =
            this.currentChapterIndex > 0
                ? this.chapterPageOffsets[this.currentChapterIndex - 1] + this._prevChapterPages
                : 0;

        // Recalculate total
        let total = this.chapterPageOffsets[this.currentChapterIndex] + this.totalPagesInChapter;
        // Add estimates for remaining chapters
        const wordsPerPage = 300;
        for (let i = this.currentChapterIndex + 1; i < this.chaptersHTML.length; i++) {
            const ch = this.chaptersHTML[i];
            const wordCount = ch.endWordIndex - ch.startWordIndex + 1;
            total += Math.max(1, Math.ceil(wordCount / wordsPerPage));
        }
        this.totalPages = total;
        this._prevChapterPages = this.totalPagesInChapter;
    },

    // Store previous chapter page count for offset tracking
    _prevChapterPages: 0,

    goToPage(pageInChapter) {
        this.currentPageInChapter = Math.max(0, Math.min(pageInChapter, this.totalPagesInChapter - 1));
        this.pagesEl.style.transform = `translate3d(-${this.currentPageInChapter * this.pageWidth}px, 0, 0)`;
        this.updatePageIndicator();
        if (this._saveTimeout) clearTimeout(this._saveTimeout);
        this._saveTimeout = setTimeout(() => this.savePosition(), 500);
    },

    nextPage() {
        if (this.currentPageInChapter < this.totalPagesInChapter - 1) {
            this.goToPage(this.currentPageInChapter + 1);
        } else if (this.currentChapterIndex < this.chaptersHTML.length - 1) {
            // Go to next chapter
            this._prevChapterPages = this.totalPagesInChapter;
            this.currentChapterIndex++;
            this.currentPageInChapter = 0;
            this.renderCurrentChapter(() => {
                this.goToPage(0);
            });
        }
    },

    prevPage() {
        if (this.currentPageInChapter > 0) {
            this.goToPage(this.currentPageInChapter - 1);
        } else if (this.currentChapterIndex > 0) {
            // Go to previous chapter (last page)
            this.currentChapterIndex--;
            this.renderCurrentChapter(() => {
                this.goToPage(this.totalPagesInChapter - 1);
            });
        }
    },

    goToWordIndex(wordIndex) {
        const chIdx = this.findChapterByWordIndex(wordIndex);
        if (chIdx !== this.currentChapterIndex) {
            this.currentChapterIndex = chIdx;
            this.renderCurrentChapter(() => {
                this._goToWordInCurrentChapter(wordIndex);
            });
        } else {
            this._goToWordInCurrentChapter(wordIndex);
        }
    },

    _goToWordInCurrentChapter(wordIndex) {
        const span = this.pagesEl.querySelector(`span[data-word-index="${wordIndex}"]`);
        if (span) {
            const page = Math.floor(span.offsetLeft / this.pageWidth);
            this.goToPage(page);
        } else {
            // Clamp to chapter bounds
            const ch = this.chaptersHTML[this.currentChapterIndex];
            if (ch) {
                const clamped = Math.max(ch.startWordIndex, Math.min(ch.endWordIndex, wordIndex));
                const s = this.pagesEl.querySelector(`span[data-word-index="${clamped}"]`);
                if (s) {
                    this.goToPage(Math.floor(s.offsetLeft / this.pageWidth));
                    return;
                }
            }
            this.goToPage(0);
        }
    },

    getVisibleWordIndex() {
        // Try to find a word span via elementFromPoint
        const containerRect = this.containerEl.getBoundingClientRect();
        const sampleX = containerRect.left + 40;
        for (let y = containerRect.top + 20; y < containerRect.bottom - 20; y += 30) {
            const el = document.elementFromPoint(sampleX, y);
            if (el) {
                const wordSpan = el.closest('span[data-word-index]');
                if (wordSpan) return parseInt(wordSpan.dataset.wordIndex);
            }
        }
        // Fallback: proportional estimate from chapter position
        const ch = this.chaptersHTML[this.currentChapterIndex];
        if (ch) {
            const frac = this.currentPageInChapter / Math.max(1, this.totalPagesInChapter);
            return ch.startWordIndex + Math.floor(frac * (ch.endWordIndex - ch.startWordIndex));
        }
        return 0;
    },

    get currentPage() {
        return (this.chapterPageOffsets[this.currentChapterIndex] || 0) + this.currentPageInChapter;
    },

    updatePageIndicator() {
        this.pageIndicatorEl.textContent = `${this.currentPage + 1} / ${this.totalPages}`;
    },

    savePosition() {
        if (this.currentBook) {
            const wordIndex = this.getVisibleWordIndex();
            Storage.saveReadingPosition(this.currentBook.id, wordIndex);
            if (this._syncTimeout) clearTimeout(this._syncTimeout);
            this._syncTimeout = setTimeout(() => {
                if (FirebaseSync.currentUser) {
                    FirebaseSync.updateBookPosition(this.currentBook.id, wordIndex);
                }
            }, 5000);
        }
    },

    recalculate() {
        if (!this.currentBook) return;
        const wordIndex = this.getVisibleWordIndex();
        this.applyFontSettings();
        requestAnimationFrame(() => {
            this.calculateChapterPages();
            this._goToWordInCurrentChapter(wordIndex);
        });
    },

    // --- Touch handling ---

    onTouchStart(e) {
        if (e.touches.length !== 1) return;
        this.touchStartX = e.touches[0].clientX;
        this.touchStartY = e.touches[0].clientY;
        this.touchStartTime = Date.now();
        this.isSwiping = false;
    },

    onTouchMove(e) {
        if (e.touches.length !== 1) return;
        const dx = e.touches[0].clientX - this.touchStartX;
        const dy = e.touches[0].clientY - this.touchStartY;
        if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 10) {
            this.isSwiping = true;
            e.preventDefault();
        }
    },

    onTouchEnd(e) {
        if (!this.isSwiping) return;
        const dx = e.changedTouches[0].clientX - this.touchStartX;
        const elapsed = Date.now() - this.touchStartTime;
        if (Math.abs(dx) > 50 || (Math.abs(dx) > 20 && elapsed < 300)) {
            if (dx < 0) this.nextPage();
            else this.prevPage();
        }
        this.isSwiping = false;
    },

    onContainerClick(e) {
        // Don't turn pages on click — interferes with text selection.
        // Use keyboard arrows or swipe instead.
    },

    // --- Selection → RSVP ---

    onSelectionChange() {
        if (this.contentEl.style.display === 'none') return;
        const selection = window.getSelection();
        if (!selection || selection.isCollapsed || !selection.toString().trim()) {
            this.floatingRsvpBtn.style.display = 'none';
            return;
        }
        const anchorNode = selection.anchorNode;
        if (!this.pagesEl.contains(anchorNode)) {
            this.floatingRsvpBtn.style.display = 'none';
            return;
        }
        const wordSpan = anchorNode.nodeType === Node.TEXT_NODE
            ? anchorNode.parentElement.closest('span[data-word-index]')
            : anchorNode.closest('span[data-word-index]');
        if (!wordSpan) {
            this.floatingRsvpBtn.style.display = 'none';
            return;
        }
        const range = selection.getRangeAt(0);
        const rect = range.getBoundingClientRect();
        const containerRect = this.contentEl.getBoundingClientRect();
        this.floatingRsvpBtn.style.display = 'flex';
        this.floatingRsvpBtn.style.left = `${rect.left - containerRect.left + rect.width / 2}px`;
        this.floatingRsvpBtn.style.top = `${rect.top - containerRect.top - 40}px`;
        this.floatingRsvpBtn.dataset.wordIndex = wordSpan.dataset.wordIndex;
    },

    startRsvpFromSelection() {
        const wordIndex = parseInt(this.floatingRsvpBtn.dataset.wordIndex);
        this.floatingRsvpBtn.style.display = 'none';
        window.getSelection().removeAllRanges();
        App.switchMode('rsvp', wordIndex);
    },

    // --- Keyboard ---

    handleKeyboard(e) {
        if (this.contentEl.style.display === 'none') return;
        if (!document.getElementById('reader-screen').classList.contains('active')) return;
        if (document.querySelector('.modal.active')) return;

        switch (e.code) {
            case 'ArrowLeft':
                e.preventDefault();
                this.prevPage();
                break;
            case 'ArrowRight':
            case 'Space':
                e.preventDefault();
                this.nextPage();
                break;
            case 'Escape':
                App.showLibrary();
                break;
        }
    },

    show() {
        this.contentEl.style.display = 'flex';
        // Only recalculate layout, don't navigate — caller handles navigation
        if (this.chaptersHTML.length > 0) {
            requestAnimationFrame(() => {
                this.calculateChapterPages();
            });
        }
    },

    hide() {
        this.contentEl.style.display = 'none';
        this.floatingRsvpBtn.style.display = 'none';
    },

    reset() {
        this.currentBook = null;
        this.chaptersHTML = [];
        this.words = [];
        this.chapters = [];
        this.currentChapterIndex = 0;
        this.currentPageInChapter = 0;
        this.totalPagesInChapter = 1;
        this.totalPages = 1;
        this.chapterPageOffsets = [];
        this.pagesEl.innerHTML = '';
        this.floatingRsvpBtn.style.display = 'none';
    }
};
