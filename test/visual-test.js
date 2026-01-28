const puppeteer = require('puppeteer');
const { spawn } = require('child_process');
const path = require('path');

const PROJECT_DIR = '/home/misha/rsvp-reading';
const TEST_BOOK = path.join(PROJECT_DIR, 'mkn10f2tw9jy4vzj5eh.epub');

async function runTests(phase) {
    console.log(`\n=== Starting ${phase.toUpperCase()} tests ===\n`);

    // 1. Start local server
    console.log('Starting HTTP server...');
    const server = spawn('python3', ['-m', 'http.server', '8000'], {
        cwd: PROJECT_DIR,
        stdio: 'pipe'
    });

    // Wait for server to be ready
    await new Promise(r => setTimeout(r, 2000));

    // Verify server is running
    const http = require('http');
    await new Promise((resolve, reject) => {
        const req = http.get('http://localhost:8000', (res) => {
            console.log('Server is ready, status:', res.statusCode);
            resolve();
        });
        req.on('error', (err) => {
            console.log('Server check failed, retrying...', err.message);
            setTimeout(resolve, 2000);
        });
        req.setTimeout(5000, () => {
            req.destroy();
            reject(new Error('Server timeout'));
        });
    });

    // 2. Launch browser
    console.log('Launching browser...');
    const browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 720 });

    // Capture console messages
    page.on('console', msg => {
        if (msg.type() === 'error') {
            console.log('Browser error:', msg.text());
        }
    });

    try {
        // 3. Open app
        console.log('Opening app...');
        await page.goto('http://localhost:8000', { waitUntil: 'networkidle0' });
        await page.screenshot({ path: `test/screenshots/${phase}/00-initial.png` });

        // Check if Reader object exists after page load
        const initialCheck = await page.evaluate(() => ({
            hasReader: typeof Reader !== 'undefined',
            hasStorage: typeof window.Storage !== 'undefined',
            hasEpubParser: typeof window.EpubParser !== 'undefined',
            url: window.location.href
        }));
        console.log('Initial globals check:', initialCheck);

        // 4. Upload test book
        console.log('Uploading test book...');
        const fileInput = await page.$('#file-input');
        if (!fileInput) {
            throw new Error('File input not found');
        }
        await fileInput.uploadFile(TEST_BOOK);
        await new Promise(r => setTimeout(r, 3000)); // Wait for parsing
        await page.screenshot({ path: `test/screenshots/${phase}/01-library.png` });

        // 5. Open the book
        console.log('Opening book...');
        const bookCard = await page.$('.book-card');
        if (!bookCard) {
            throw new Error('Book card not found');
        }
        await bookCard.click();
        await new Promise(r => setTimeout(r, 3000)); // Wait longer for parsing
        await page.screenshot({ path: `test/screenshots/${phase}/02-reader.png` });

        // Wait for Reader to be fully initialized with retry
        let readerReady = false;
        for (let i = 0; i < 10; i++) {
            const state = await page.evaluate(() => {
                // Reader is a global var, not window property
                try {
                    return {
                        hasReader: typeof Reader !== 'undefined',
                        wordsCount: typeof Reader !== 'undefined' ? Reader.words?.length || 0 : 0,
                        currentBook: typeof Reader !== 'undefined' ? !!Reader.currentBook : false,
                        currentIndex: typeof Reader !== 'undefined' ? Reader.currentIndex : -1
                    };
                } catch (e) {
                    return { error: e.message };
                }
            });
            console.log(`Reader state (attempt ${i+1}):`, state);
            if (state.wordsCount > 0) {
                readerReady = true;
                break;
            }
            await new Promise(r => setTimeout(r, 1000));
        }
        if (!readerReady) {
            // Take diagnostic screenshot
            await page.screenshot({ path: `test/screenshots/${phase}/ERROR-reader-state.png` });
            throw new Error('Reader did not initialize with words');
        }

        // 6. Get words for analysis
        console.log('\nAnalyzing words...');
        const analysisResult = await page.evaluate(() => {
            if (!Reader || !Reader.words) {
                return { error: 'Reader not initialized' };
            }

            const words = Reader.words;
            const first500 = words.slice(0, 500);

            // Find glued words (bug 2)
            const gluedPattern = /[.,:;!?][\p{L}]/u;
            const gluedWords = [];
            first500.forEach((word, idx) => {
                if (gluedPattern.test(word)) {
                    gluedWords.push({ index: idx, word: word });
                }
            });

            // Find words of different lengths for ORP test (bug 1)
            const shortWords = [];  // 2-4 letters
            const mediumWords = []; // 5-8 letters
            const longWords = [];   // 9+ letters

            first500.forEach((word, idx) => {
                const cleanWord = word.replace(/[^\p{L}\p{N}]/gu, '');
                const len = cleanWord.length;
                if (len >= 2 && len <= 4 && shortWords.length < 5) {
                    shortWords.push({ index: idx, word: word, len: len });
                } else if (len >= 5 && len <= 8 && mediumWords.length < 5) {
                    mediumWords.push({ index: idx, word: word, len: len });
                } else if (len >= 9 && longWords.length < 5) {
                    longWords.push({ index: idx, word: word, len: len });
                }
            });

            return {
                totalWords: words.length,
                gluedWords: gluedWords.slice(0, 10),
                shortWords: shortWords,
                mediumWords: mediumWords,
                longWords: longWords
            };
        });

        if (analysisResult.error) {
            throw new Error(analysisResult.error);
        }

        console.log(`Total words in book: ${analysisResult.totalWords}`);
        console.log(`\nGlued words (Bug 2): ${analysisResult.gluedWords.length}`);
        analysisResult.gluedWords.forEach(w => {
            console.log(`  [${w.index}] "${w.word}"`);
        });

        console.log('\nWords for ORP test (Bug 1):');
        console.log('  Short (2-4 letters):', analysisResult.shortWords.map(w => `[${w.index}]"${w.word}"`).join(', '));
        console.log('  Medium (5-8 letters):', analysisResult.mediumWords.map(w => `[${w.index}]"${w.word}"`).join(', '));
        console.log('  Long (9+ letters):', analysisResult.longWords.map(w => `[${w.index}]"${w.word}"`).join(', '));

        // 7. Take screenshots of different word lengths for ORP test
        const testWords = [
            ...analysisResult.shortWords,
            ...analysisResult.mediumWords,
            ...analysisResult.longWords
        ];

        console.log('\nTaking ORP screenshots...');
        for (const wordInfo of testWords) {
            await page.evaluate((idx) => {
                Reader.currentIndex = idx;
                Reader.displayCurrentWord();
            }, wordInfo.index);
            await new Promise(r => setTimeout(r, 100));
            await page.screenshot({
                path: `test/screenshots/${phase}/orp-${wordInfo.index}-${wordInfo.len}chars.png`
            });
        }

        // 8. Test speed controls
        console.log('\nTesting speed controls...');

        // Set WPM to 200 and test increment
        await page.evaluate(() => {
            Reader.wpm = 200;
            Reader.updateSpeedDisplay();
        });
        const speedBefore = await page.$eval('#speed-display', el => el.textContent);

        await page.click('#faster-btn');
        const speedAfter = await page.$eval('#speed-display', el => el.textContent);

        console.log(`Speed at 200 WPM: ${speedBefore} -> ${speedAfter}`);
        const step = parseInt(speedAfter) - parseInt(speedBefore);
        console.log(`Speed step: ${step} (expected: 10 after fix, 50 before)`);

        await page.screenshot({ path: `test/screenshots/${phase}/03-speed-test.png` });

        // 9. Open settings (for feature 2 check)
        console.log('\nOpening settings...');
        await page.click('#settings-btn');
        await new Promise(r => setTimeout(r, 500));
        await page.screenshot({ path: `test/screenshots/${phase}/04-settings.png` });

        console.log(`\n=== ${phase.toUpperCase()} tests completed ===`);
        console.log(`Screenshots saved to: test/screenshots/${phase}/`);

        // Return summary for comparison
        return {
            gluedWordsCount: analysisResult.gluedWords.length,
            gluedWords: analysisResult.gluedWords,
            speedStep: step,
            testWordIndices: testWords.map(w => w.index)
        };

    } finally {
        await browser.close();
        server.kill();
    }
}

// Main
const phase = process.argv[2] || 'before';
if (!['before', 'after'].includes(phase)) {
    console.error('Usage: node visual-test.js [before|after]');
    process.exit(1);
}

runTests(phase)
    .then(result => {
        console.log('\nTest result summary:');
        console.log(JSON.stringify(result, null, 2));
    })
    .catch(err => {
        console.error('Test failed:', err);
        process.exit(1);
    });
