const { chromium } = require("playwright");
const logger = require("./logger");
const fs = require("fs");
const path = require("path");
const os = require("os");

/**
 * Upload a document to 21online.app/assets/{assetExternalId}?tab=documents
 * by simulating human interaction via Playwright.
 * Uses "Carregar vários documentos" button (no document type selection required).
 * File is renamed to "CATEGORY - REFERENCE.ext" format.
 */
async function playwrightUploadDocument({
  email, password, assetExternalId, documentLabel, fileName, fileBuffer, fileType, assetReference,
}) {
  let browser = null;
  let tmpFilePath = null;
  const debugDir = "/tmp/pw-debug";

  try {
    if (!fs.existsSync(debugDir)) fs.mkdirSync(debugDir, { recursive: true });

    // Build the final file name: "CATEGORY - REFERENCE.ext"
    const ext = path.extname(fileName) || ".pdf";
    const categoryLabel = documentLabel || "OUTRO";
    const ref = assetReference || assetExternalId;
    const finalFileName = categoryLabel.toUpperCase() + " - " + ref + ext;

    tmpFilePath = path.join(os.tmpdir(), finalFileName);
    fs.writeFileSync(tmpFilePath, fileBuffer);

    logger.info("[pw-upload] Starting", { assetExternalId, finalFileName, documentLabel, assetReference });

    browser = await chromium.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
    });

    const context = await browser.newContext({
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36",
      viewport: { width: 1920, height: 1080 },
    });

    const page = await context.newPage();

    const networkLog = [];
    page.on("response", (res) => {
      const url = res.url();
      if (url.includes("storage") || url.includes("document") || url.includes("asset")) {
        networkLog.push({ status: res.status(), url: url.substring(0, 200) });
      }
    });

    // Step 1: Login
    for (let attempt = 1; attempt <= 3; attempt++) {
      logger.info("[pw-upload] Login attempt " + attempt);
      await page.goto("https://21online.app/login", { waitUntil: "networkidle", timeout: 30000 });

      const bodyText = await page.evaluate(() => document.body.innerText.substring(0, 200));
      if (bodyText.includes("Security Checkpoint") || bodyText.includes("Vercel")) {
        logger.info("[pw-upload] Vercel WAF detected, waiting...");
        await page.waitForTimeout(5000);
        continue;
      }

      const emailInput = page.locator('input[type="email"], input[name="email"], input[placeholder*="mail"]').first();
      const passInput = page.locator('input[type="password"], input[name="password"]').first();

      try {
        await emailInput.waitFor({ state: "visible", timeout: 10000 });
        await emailInput.fill(email);
        await passInput.fill(password);
        await page.locator('button[type="submit"], button:has-text("Submeter")').first().click();
        await page.waitForURL((url) => !url.toString().includes("/login"), { timeout: 30000 });
        logger.info("[pw-upload] Logged in", { url: page.url() });
        break;
      } catch (e) {
        if (attempt === 3) throw new Error("Login failed after 3 attempts: " + e.message);
        await page.waitForTimeout(3000);
      }
    }

    // Step 2: Navigate to asset documents tab
    const targetUrl = "https://21online.app/assets/" + assetExternalId + "?tab=documents";
    logger.info("[pw-upload] Navigating to " + targetUrl);
    await page.goto(targetUrl, { waitUntil: "networkidle", timeout: 30000 });
    await page.waitForTimeout(3000);
    await page.screenshot({ path: debugDir + "/01-asset-docs.png", fullPage: true });

    // Step 3: Click "Carregar vários documentos" button (multi-upload, no type selection needed)
    const multiUploadBtn = page.locator('button:has-text("Carregar vários documentos"), button:has-text("Upload multiple documents")').first();
    try {
      await multiUploadBtn.waitFor({ state: "visible", timeout: 10000 });
      await multiUploadBtn.click();
      logger.info("[pw-upload] Clicked 'Carregar vários documentos' button");
      await page.waitForTimeout(2000);
    } catch (e) {
      // Fallback: try any upload button
      logger.warn("[pw-upload] Multi-upload button not found, trying any upload button");
      const anyUploadBtn = page.locator('button:has-text("Carregar"), button:has-text("Upload")').first();
      try {
        await anyUploadBtn.waitFor({ state: "visible", timeout: 5000 });
        await anyUploadBtn.click();
        logger.info("[pw-upload] Clicked fallback upload button");
        await page.waitForTimeout(2000);
      } catch (e2) {
        logger.warn("[pw-upload] No upload button found, looking for file input directly");
      }
    }

    await page.screenshot({ path: debugDir + "/02-after-click.png", fullPage: true });

    // Step 4: Upload file via file input (no document type selection needed with multi-upload)
    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.waitFor({ state: "attached", timeout: 10000 });
    await fileInput.setInputFiles(tmpFilePath);
    logger.info("[pw-upload] File attached: " + finalFileName);

    // Wait for upload to complete
    await page.waitForTimeout(15000);
    await page.screenshot({ path: debugDir + "/03-after-upload.png", fullPage: true });

    // Step 5: Check for a submit/save button and click it if present
    try {
      const submitBtn = page.locator('button:has-text("Guardar"), button:has-text("Submeter"), button:has-text("Save"), button[type="submit"]').first();
      const submitVisible = await submitBtn.isVisible().catch(() => false);
      if (submitVisible) {
        await submitBtn.click();
        logger.info("[pw-upload] Clicked submit button");
        await page.waitForTimeout(5000);
      }
    } catch (e) {
      logger.info("[pw-upload] No submit button found (auto-upload?)");
    }

    await page.screenshot({ path: debugDir + "/04-final.png", fullPage: true });

    const storageUploads = networkLog.filter(n => n.url.includes("storage") && (n.status === 200 || n.status === 201));
    logger.info("[pw-upload] Complete", {
      storageUploads: storageUploads.length,
      totalNetwork: networkLog.length,
      finalFileName,
    });

    await browser.close();
    browser = null;
    if (tmpFilePath && fs.existsSync(tmpFilePath)) fs.unlinkSync(tmpFilePath);

    const ok = storageUploads.length > 0;
    return {
      success: ok,
      message: ok
        ? "Uploaded via Playwright (" + storageUploads.length + " storage uploads)"
        : "Upload may have failed - no storage uploads detected",
      finalFileName,
      network: networkLog,
    };
  } catch (err) {
    logger.error("[pw-upload] Error", { error: err.message, stack: err.stack?.substring(0, 500) });
    if (browser) try { await browser.close(); } catch (_) {}
    if (tmpFilePath && fs.existsSync(tmpFilePath)) try { fs.unlinkSync(tmpFilePath); } catch (_) {}
    return { success: false, error: err.message };
  }
}

module.exports = { playwrightUploadDocument };
