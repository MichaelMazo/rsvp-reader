/**
 * Library module - handles book list UI
 */
const Library = {
    bookListEl: null,
    emptyStateEl: null,
    fileInputEl: null,
    addBookBtn: null,

    /**
     * Initialize library
     */
    init() {
        this.bookListEl = document.getElementById('book-list');
        this.emptyStateEl = document.getElementById('empty-library');
        this.fileInputEl = document.getElementById('file-input');
        this.addBookBtn = document.getElementById('add-book-btn');

        // Event listeners
        this.addBookBtn.addEventListener('click', () => this.fileInputEl.click());
        this.fileInputEl.addEventListener('change', (e) => this.handleFileSelect(e));

        // Load and render books
        this.renderBooks();
    },

    /**
     * Handle file selection
     */
    async handleFileSelect(event) {
        const file = event.target.files[0];
        if (!file) return;

        // Reset input
        event.target.value = '';

        // Show loading state
        this.addBookBtn.classList.add('loading');

        try {
            const arrayBuffer = await file.arrayBuffer();

            // Parse metadata
            const metadata = await EpubParser.parseMetadata(arrayBuffer);

            // Save book
            const book = await Storage.saveBook({
                title: metadata.title,
                author: metadata.author,
                cover: metadata.cover,
                fileData: arrayBuffer,
                totalWords: 0
            });

            // Upload to cloud if signed in
            if (FirebaseSync.currentUser) {
                await FirebaseSync.uploadBook(book);
            }

            // Re-render
            await this.renderBooks();

        } catch (error) {
            console.error('Failed to load book:', error);
            alert('Failed to load book: ' + error.message);
        } finally {
            this.addBookBtn.classList.remove('loading');
        }
    },

    /**
     * Render all books
     */
    async renderBooks() {
        const books = await Storage.getAllBooks();

        if (books.length === 0) {
            this.bookListEl.style.display = 'none';
            this.emptyStateEl.style.display = 'flex';
            return;
        }

        this.emptyStateEl.style.display = 'none';
        this.bookListEl.style.display = 'grid';

        // Get reading positions for progress
        const positions = Storage.getReadingPositions();

        this.bookListEl.innerHTML = books.map(book => {
            const position = positions[book.id]?.wordIndex || 0;
            const progress = book.totalWords > 0
                ? Math.round((position / book.totalWords) * 100)
                : 0;

            return this.renderBookCard(book, progress);
        }).join('');

        // Add click listeners
        this.bookListEl.querySelectorAll('.book-card').forEach(card => {
            card.addEventListener('click', (e) => {
                if (!e.target.closest('.delete-btn')) {
                    App.openBook(card.dataset.id);
                }
            });
        });

        // Add delete listeners
        this.bookListEl.querySelectorAll('.delete-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.confirmDeleteBook(btn.dataset.id);
            });
        });
    },

    /**
     * Render a single book card
     */
    renderBookCard(book, progress) {
        const coverHtml = book.cover
            ? `<img src="${book.cover}" alt="${book.title}">`
            : `<span>${book.title[0]?.toUpperCase() || '?'}</span>`;

        return `
            <div class="book-card" data-id="${book.id}">
                <button class="delete-btn" data-id="${book.id}" aria-label="Delete">
                    <svg viewBox="0 0 24 24" width="16" height="16">
                        <path fill="currentColor" d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
                    </svg>
                </button>
                <div class="book-cover">${coverHtml}</div>
                <div class="book-info">
                    <div class="book-card-title">${book.title}</div>
                    <div class="book-author">${book.author}</div>
                    <div class="book-progress">
                        <div class="book-progress-fill" style="width: ${progress}%"></div>
                    </div>
                </div>
            </div>
        `;
    },

    /**
     * Confirm and delete a book
     */
    async confirmDeleteBook(bookId) {
        if (confirm('Delete this book?')) {
            await Storage.deleteBook(bookId);
            // Delete from cloud if signed in
            if (FirebaseSync.currentUser) {
                await FirebaseSync.deleteBook(bookId);
            }
            await this.renderBooks();
        }
    }
};
