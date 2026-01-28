/**
 * Main App module - navigation and initialization
 */
const App = {
    libraryScreen: null,
    readerScreen: null,
    settingsModal: null,

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
        FirebaseSync.init();

        // Setup settings modal
        this.initSettings();

        // Setup Firebase auth UI
        this.initAuth();

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

        // Sign in
        signInBtn.addEventListener('click', () => {
            FirebaseSync.signIn();
        });

        // Click on user info opens settings
        userInfo.addEventListener('click', () => {
            this.settingsModal.classList.add('active');
        });

        // Sign out
        signOutBtn.addEventListener('click', () => {
            FirebaseSync.signOut();
            this.settingsModal.classList.remove('active');
        });

        // Sync now
        syncNowBtn.addEventListener('click', async () => {
            syncNowBtn.textContent = 'Синхронизация...';
            syncNowBtn.disabled = true;
            await FirebaseSync.syncAllToCloud();
            await FirebaseSync.syncFromCloud();
            syncNowBtn.textContent = 'Синхронизировать';
            syncNowBtn.disabled = false;
        });

        // Show/hide sync section based on auth state
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

        // Font size change
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
     * Show library screen
     */
    showLibrary() {
        this.readerScreen.classList.remove('active');
        this.libraryScreen.classList.add('active');
        Library.renderBooks();
    },

    /**
     * Open a book for reading
     */
    async openBook(bookId) {
        const success = await Reader.loadBook(bookId);
        if (success) {
            this.libraryScreen.classList.remove('active');
            this.readerScreen.classList.add('active');
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
