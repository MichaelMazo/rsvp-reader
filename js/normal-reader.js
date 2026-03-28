/**
 * Normal Reader module - paginated reading with formatted text
 */
const NormalReader = {
    // State
    currentBook: null,
    chaptersHTML: [],
    words: [],
    chapters: [],
    currentPage: 0,
    totalPages: 1,
    pageWidth: 0,     // container width = column width (no gap)


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

        // Touch events for swipe
        this.containerEl.addEventListener('touchstart', (e) => this.onTouchStart(e), { passive: true });
        this.containerEl.addEventListener('touchmove', (e) => this.onTouchMove(e), { passive: false });
        this.containerEl.addEventListener('touchend', (e) => this.onTouchEnd(e));

        // Click to turn pages (left/right halves)
        this.containerEl.addEventListener('click', (e) => this.onContainerClick(e));

        // Selection change for RSVP floating button
        document.addEventListener('selectionchange', () => this.onSelectionChange());

        // Floating RSVP button click
        this.floatingRsvpBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.startRsvpFromSelection();
        });

        // Keyboard navigation
        document.addEventListener('keydown', (e) => this.handleKeyboard(e));

        // Recalculate on resize
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

    /**
     * Load parsed book data (called from App, shares parsed data with Reader)
     */
    loadBookData(book, words, chapters, chaptersHTML) {
        this.currentBook = book;
        this.words = words;
        this.chapters = chapters;
        this.chaptersHTML = chaptersHTML;

        this.renderContent();

        // Restore position
        const wordIndex = Storage.getReadingPosition(book.id);
        if (wordIndex > 0) {
            // Defer to allow layout to complete
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    this.goToWordIndex(wordIndex);
                });
            });
        } else {
            this.currentPage = 0;
            this.updatePageIndicator();
        }
    },

    renderContent() {
        // Combine all chapters' HTML
        let html = '';
        for (const ch of this.chaptersHTML) {
            if (ch.title) {
                html += `<div class="chapter-separator" data-chapter-start="${ch.startWordIndex}"></div>`;
            }
            html += `<div class="chapter-content">${ch.html}</div>`;
        }
        this.pagesEl.innerHTML = html;

        // Calculate pagination after render
        requestAnimationFrame(() => {
            this.calculatePages();
            this.updatePageIndicator();
        });
    },

    calculatePages() {
        this.pageWidth = this.containerEl.clientWidth;
        if (this.pageWidth === 0) return;

        // Each column = container width, no gap. Simple 1:1 mapping.
        this.pagesEl.style.columnWidth = `${this.pageWidth}px`;
        this.pagesEl.style.columnGap = '0px';

        // Force reflow
        void this.pagesEl.offsetHeight;

        const scrollWidth = this.pagesEl.scrollWidth;
        this.totalPages = Math.max(1, Math.round(scrollWidth / this.pageWidth));

        // Clamp current page
        if (this.currentPage >= this.totalPages) {
            this.currentPage = this.totalPages - 1;
        }
    },

    goToPage(pageNum) {
        this.currentPage = Math.max(0, Math.min(pageNum, this.totalPages - 1));
        this.pagesEl.style.transform = `translate3d(-${this.currentPage * this.pageWidth}px, 0, 0)`;
        this.updatePageIndicator();
        // Debounce position save to avoid blocking page turns
        if (this._saveTimeout) clearTimeout(this._saveTimeout);
        this._saveTimeout = setTimeout(() => this.savePosition(), 300);
    },

    nextPage() {
        if (this.currentPage < this.totalPages - 1) {
            this.goToPage(this.currentPage + 1);
        }
    },

    prevPage() {
        if (this.currentPage > 0) {
            this.goToPage(this.currentPage - 1);
        }
    },

    goToWordIndex(wordIndex) {
        const span = this.pagesEl.querySelector(`span[data-word-index="${wordIndex}"]`);
        if (!span) {
            // Try to find nearest word
            const allSpans = this.pagesEl.querySelectorAll('span[data-word-index]');
            let closest = null;
            let closestDiff = Infinity;
            for (const s of allSpans) {
                const idx = parseInt(s.dataset.wordIndex);
                const diff = Math.abs(idx - wordIndex);
                if (diff < closestDiff) {
                    closestDiff = diff;
                    closest = s;
                }
                if (diff === 0) break;
            }
            if (closest) {
                const page = Math.floor(closest.offsetLeft / this.pageWidth);
                this.goToPage(page);
            }
            return;
        }

        const page = Math.floor(span.offsetLeft / this.pageWidth);
        this.goToPage(page);
    },

    getVisibleWordIndex() {
        // Use elementFromPoint for O(1) lookup instead of iterating all spans
        const containerRect = this.containerEl.getBoundingClientRect();
        // Sample points in the top-left area of the visible page
        const sampleX = containerRect.left + 30;
        const samplePoints = [
            containerRect.top + 30,
            containerRect.top + 60,
            containerRect.top + 90,
            containerRect.top + 120,
        ];

        for (const y of samplePoints) {
            const el = document.elementFromPoint(sampleX, y);
            if (el) {
                const wordSpan = el.closest('span[data-word-index]');
                if (wordSpan) {
                    return parseInt(wordSpan.dataset.wordIndex);
                }
            }
        }

        // Fallback: estimate from page number and total words
        if (this.words.length > 0 && this.totalPages > 0) {
            return Math.floor((this.currentPage / this.totalPages) * this.words.length);
        }
        return 0;
    },

    updatePageIndicator() {
        this.pageIndicatorEl.textContent = `${this.currentPage + 1} / ${this.totalPages}`;
    },

    savePosition() {
        if (this.currentBook) {
            const wordIndex = this.getVisibleWordIndex();
            Storage.saveReadingPosition(this.currentBook.id, wordIndex);

            // Cloud sync (debounced)
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
            this.calculatePages();
            this.goToWordIndex(wordIndex);
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

        // If horizontal swipe is dominant, prevent scroll
        if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 10) {
            this.isSwiping = true;
            e.preventDefault();
        }
    },

    onTouchEnd(e) {
        if (!this.isSwiping) return;
        const dx = e.changedTouches[0].clientX - this.touchStartX;
        const elapsed = Date.now() - this.touchStartTime;

        // Swipe threshold: 50px or fast flick
        if (Math.abs(dx) > 50 || (Math.abs(dx) > 20 && elapsed < 300)) {
            if (dx < 0) {
                this.nextPage();
            } else {
                this.prevPage();
            }
        }
        this.isSwiping = false;
    },

    onContainerClick(e) {
        // Don't turn page if user is selecting text
        const selection = window.getSelection();
        if (selection && selection.toString().length > 0) return;

        // Don't turn page if clicking on a link
        if (e.target.closest('a')) return;

        const rect = this.containerEl.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const third = rect.width / 3;

        if (x < third) {
            this.prevPage();
        } else if (x > third * 2) {
            this.nextPage();
        }
        // Middle third — do nothing (allow text interaction)
    },

    // --- Selection → RSVP ---

    onSelectionChange() {
        if (this.contentEl.style.display === 'none') return;

        const selection = window.getSelection();
        if (!selection || selection.isCollapsed || !selection.toString().trim()) {
            this.floatingRsvpBtn.style.display = 'none';
            return;
        }

        // Check if selection is within our content
        const anchorNode = selection.anchorNode;
        if (!this.pagesEl.contains(anchorNode)) {
            this.floatingRsvpBtn.style.display = 'none';
            return;
        }

        // Find the word span
        const wordSpan = anchorNode.nodeType === Node.TEXT_NODE
            ? anchorNode.parentElement.closest('span[data-word-index]')
            : anchorNode.closest('span[data-word-index]');

        if (!wordSpan) {
            this.floatingRsvpBtn.style.display = 'none';
            return;
        }

        // Position the floating button near the selection
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
        // Only handle when normal reader is visible
        if (this.contentEl.style.display === 'none') return;
        if (!document.getElementById('reader-screen').classList.contains('active')) return;

        // Don't handle if a modal is open
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
        if (this.pageWidth === 0 && this.chaptersHTML.length > 0) {
            requestAnimationFrame(() => {
                this.calculatePages();
                this.goToPage(this.currentPage);
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
        this.currentPage = 0;
        this.totalPages = 1;
        this.pagesEl.innerHTML = '';
        this.floatingRsvpBtn.style.display = 'none';
    }
};
