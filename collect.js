const puppeteer = require('puppeteer');
const fs = require('fs');

const STABILIZER_URL = process.env.STABILIZER_URL || 'http://46.44.56.179:8080';
const USERNAME = process.env.STABILIZER_USER || 'user';
const PASSWORD = process.env.STABILIZER_PASSWORD || 'password';

async function collectData() {
  let browser;

  try {
    console.log('Launching browser...');

    browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu'
      ]
    });

    const page = await browser.newPage();

    await page.authenticate({ username: USERNAME, password: PASSWORD });
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    );

    console.log('Navigating to home.stm...');
    await page.goto(STABILIZER_URL + '/home.stm', {
      waitUntil: 'networkidle0',
      timeout: 30000
    });

    await page.screenshot({ path: 'home-page.png' });
    console.log('Screenshot saved');

    // Ждём появления элемента с напряжением (до 10 сек)
    try {
      await page.waitForSelector('#input-voltage', { timeout: 10000 });
    } catch {
      console.warn('Element #input-voltage not found by selector, will try body text');
    }

    const voltageData = await page.evaluate(() => {
      const voltageElement = document.getElementById('input-voltage');
      const text = voltageElement
        ? voltageElement.textContent.trim()
        : document.body.innerText;

      const match = text.match(/(\d+\.?\d*)\s*\/\s*(\d+\.?\d*)\s*\/\s*(\d+\.?\d*)/);
      if (!match) return null;

      const values = [parseFloat(match[1]), parseFloat(match[2]), parseFloat(match[3])];
      if (!values.every(v => v >= 180 && v <= 280)) return null;

      return { phaseA: values[0], phaseB: values[1], phaseC: values[2] };
    });

    if (!voltageData) {
      await page.screenshot({ path: 'debug-screenshot.png' });
      const html = await page.content();
      console.log('Page HTML preview:', html.substring(0, 1000));
      throw new Error('Could not find voltage data on page');
    }

    voltageData.timestamp = new Date().toISOString();
    console.log('Voltage data extracted:', voltageData);

    saveData(voltageData);
    console.log('Data collection completed successfully!');

  } catch (error) {
    console.error('Error during data collection:', error);
    process.exit(1);
  } finally {
    if (browser) await browser.close();
  }
}

function saveData(voltageData) {
  if (!fs.existsSync('data')) fs.mkdirSync('data');

  fs.writeFileSync('data/latest.json', JSON.stringify(voltageData, null, 2));

  let history = [];
  if (fs.existsSync('data/voltage-history.json')) {
    history = JSON.parse(fs.readFileSync('data/voltage-history.json', 'utf8'));
  }

  history.push(voltageData);

  // Храним последние 7 дней: 288 записей/день × 7 = 2016 (при интервале 5 мин)
  const maxRecords = 2016;
  if (history.length > maxRecords) history = history.slice(-maxRecords);

  fs.writeFileSync('data/voltage-history.json', JSON.stringify(history, null, 2));
  console.log('Data saved. Total records:', history.length);
}

collectData();
