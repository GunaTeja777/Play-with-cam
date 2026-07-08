const { test } = require('@playwright/test');

test('run training', async ({ page }) => {
  test.setTimeout(180000);
  console.log('Navigating to trainer page...');
  await page.goto('http://localhost:3000/train.html');
  
  console.log('Waiting for complete-marker...');
  await page.waitForSelector('#complete-marker', { timeout: 150000 });
  
  console.log('Training complete!');
  await page.waitForTimeout(3000);
});
