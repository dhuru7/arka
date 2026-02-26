const puppeteer = require('puppeteer');

(async () => {
    try {
        const browser = await puppeteer.launch({ executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' });
        const page = await browser.newPage();

        page.on('console', msg => console.log('PAGE LOG:', msg.text()));
        page.on('pageerror', err => console.log('PAGE ERROR:', err.toString()));

        await page.goto('http://127.0.0.1:5000/', { waitUntil: 'networkidle0' });

        console.log("Setting prompt text...");
        await page.type('#prompt-input', 'A simple login flow');

        console.log("Clicking generate...");
        await page.click('#generate-btn');

        // Wait up to 5s for the flowchart-canvas to become visible
        await page.waitForFunction(() => {
            const canvas = document.querySelector('#flowchart-canvas');
            return canvas && window.getComputedStyle(canvas).display !== 'none';
        }, { timeout: 5000 }).catch(e => console.log('Timeout waiting for canvas to be visible'));

        const isCanvasVisible = await page.evaluate(() => {
            const canvas = document.querySelector('#flowchart-canvas');
            return canvas && window.getComputedStyle(canvas).display !== 'none';
        });

        console.log('Is canvas visible after generation?', isCanvasVisible);

        await browser.close();
    } catch (err) {
        console.error("Puppeteer script error:", err);
    }
})();
