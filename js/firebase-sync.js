/**
 * Firebase Sync Module - handles cloud sync for books and reading progress
 */
const FirebaseSync = {
    currentUser: null,
    isOnline: navigator.onLine,

    /**
     * Initialize sync module
     */
    init() {
        // Listen for auth state changes
        auth.onAuthStateChanged(user => {
            this.currentUser = user;
            this.updateAuthUI();
            if (user) {
                this.syncFromCloud();
            }
        });

        // Listen for online/offline status
        window.addEventListener('online', () => {
            this.isOnline = true;
            if (this.currentUser) {
                this.syncFromCloud();
            }
        });
        window.addEventListener('offline', () => {
            this.isOnline = false;
        });
    },

    /**
     * Sign in with Google
     */
    async signIn() {
        try {
            await auth.signInWithPopup(googleProvider);
        } catch (error) {
            console.error('Sign in error:', error);
            alert('Failed to sign in: ' + error.message);
        }
    },

    /**
     * Sign out
     */
    async signOut() {
        try {
            await auth.signOut();
        } catch (error) {
            console.error('Sign out error:', error);
        }
    },

    /**
     * Update UI based on auth state
     */
    updateAuthUI() {
        const signInBtn = document.getElementById('sign-in-btn');
        const userInfo = document.getElementById('user-info');
        const userName = document.getElementById('user-name');
        const userAvatar = document.getElementById('user-avatar');

        if (this.currentUser) {
            signInBtn.style.display = 'none';
            userInfo.style.display = 'flex';
            userName.textContent = this.currentUser.displayName || 'User';
            if (this.currentUser.photoURL) {
                userAvatar.src = this.currentUser.photoURL;
                userAvatar.style.display = 'block';
            }
        } else {
            signInBtn.style.display = 'flex';
            userInfo.style.display = 'none';
        }
    },

    /**
     * Get user's books collection reference
     */
    getBooksRef() {
        if (!this.currentUser) return null;
        return db.collection('users').doc(this.currentUser.uid).collection('books');
    },

    /**
     * Sync books from cloud to local
     */
    async syncFromCloud() {
        if (!this.currentUser || !this.isOnline) return;

        try {
            const booksRef = this.getBooksRef();
            const snapshot = await booksRef.get();

            for (const doc of snapshot.docs) {
                const cloudBook = doc.data();
                const localBook = await Storage.getBook(doc.id);

                // If book doesn't exist locally, download it
                if (!localBook) {
                    await this.downloadBook(doc.id, cloudBook);
                } else {
                    // Sync reading position (use most recent)
                    const cloudPosition = cloudBook.currentPosition || 0;
                    const localPosition = Storage.getReadingPosition(doc.id);
                    const cloudUpdated = cloudBook.updatedAt?.toMillis() || 0;
                    const localUpdated = localBook.updatedAt || 0;

                    if (cloudUpdated > localUpdated && cloudPosition !== localPosition) {
                        Storage.saveReadingPosition(doc.id, cloudPosition);
                    } else if (localUpdated > cloudUpdated) {
                        await this.updateBookPosition(doc.id, localPosition);
                    }
                }
            }

            // Refresh library UI
            if (typeof Library !== 'undefined') {
                Library.renderBooks();
            }
        } catch (error) {
            console.error('Sync from cloud error:', error);
        }
    },

    /**
     * Download a book from cloud storage
     */
    async downloadBook(bookId, metadata) {
        try {
            const storageRef = storage.ref(`users/${this.currentUser.uid}/books/${bookId}.epub`);
            const url = await storageRef.getDownloadURL();

            const response = await fetch(url);
            const blob = await response.blob();
            const arrayBuffer = await blob.arrayBuffer();

            // Save to local storage
            await Storage.saveBook({
                id: bookId,
                title: metadata.title,
                author: metadata.author,
                cover: metadata.cover,
                fileData: arrayBuffer,
                totalWords: metadata.totalWords || 0,
                addedAt: metadata.addedAt?.toMillis() || Date.now(),
                updatedAt: metadata.updatedAt?.toMillis() || Date.now()
            });

            // Restore position
            if (metadata.currentPosition) {
                Storage.saveReadingPosition(bookId, metadata.currentPosition);
            }
        } catch (error) {
            console.error('Download book error:', error);
        }
    },

    /**
     * Upload a book to cloud
     */
    async uploadBook(book) {
        if (!this.currentUser || !this.isOnline) return;

        try {
            // Upload epub file to Storage
            const storageRef = storage.ref(`users/${this.currentUser.uid}/books/${book.id}.epub`);
            const blob = new Blob([book.fileData], { type: 'application/epub+zip' });
            await storageRef.put(blob);

            // Save metadata to Firestore
            const booksRef = this.getBooksRef();
            await booksRef.doc(book.id).set({
                title: book.title,
                author: book.author,
                cover: book.cover || null,
                totalWords: book.totalWords || 0,
                currentPosition: Storage.getReadingPosition(book.id) || 0,
                addedAt: firebase.firestore.Timestamp.fromMillis(book.addedAt || Date.now()),
                updatedAt: firebase.firestore.Timestamp.now()
            });

            console.log('Book uploaded:', book.title);
        } catch (error) {
            console.error('Upload book error:', error);
        }
    },

    /**
     * Update book position in cloud
     */
    async updateBookPosition(bookId, position) {
        if (!this.currentUser || !this.isOnline) return;

        try {
            const booksRef = this.getBooksRef();
            await booksRef.doc(bookId).update({
                currentPosition: position,
                updatedAt: firebase.firestore.Timestamp.now()
            });
        } catch (error) {
            console.error('Update position error:', error);
        }
    },

    /**
     * Delete book from cloud
     */
    async deleteBook(bookId) {
        if (!this.currentUser || !this.isOnline) return;

        try {
            // Delete from Storage
            const storageRef = storage.ref(`users/${this.currentUser.uid}/books/${bookId}.epub`);
            await storageRef.delete().catch(() => {}); // Ignore if doesn't exist

            // Delete from Firestore
            const booksRef = this.getBooksRef();
            await booksRef.doc(bookId).delete();
        } catch (error) {
            console.error('Delete book error:', error);
        }
    },

    /**
     * Sync all local books to cloud
     */
    async syncAllToCloud() {
        if (!this.currentUser || !this.isOnline) return;

        try {
            const books = await Storage.getAllBooks();
            for (const book of books) {
                // Check if already in cloud
                const booksRef = this.getBooksRef();
                const doc = await booksRef.doc(book.id).get();

                if (!doc.exists) {
                    await this.uploadBook(book);
                }
            }
        } catch (error) {
            console.error('Sync all to cloud error:', error);
        }
    }
};
