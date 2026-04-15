const logger = require("./logger");
const { login21online } = require("./auth21online");
const { getSession } = require("./sessionManager");
const { buildWorkspaceCookie, mergeWorkspaceCookie } = require("./workspaceManager");
const { v4: uuidv4 } = require("uuid");

const CRM_SUPABASE_URL = "https://brumjtydtlxhooqrrsch.supabase.co";
const CRM_SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJydW1qdHlkdGx4aG9vcXJyc2NoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDE0NDc3NzAsImV4cCI6MjA1NzAyMzc3MH0.9JJAd_xe603iCf9peMW55hmK8J0BW0oGyks0RZN1Uis";
const NEXT_ACTION_ID = "0f357568d5c74f879bced62adabb3f075bb5d10d";

/**
 * Extract the Supabase access token from 21online session cookies.
 * Cookie value is base64-encoded JSON: either { access_token, ... } or [access_token, refresh_token, ...]
 */
function extractSupabaseToken(cookieString) {
  if (!cookieString) return null;

  const pairs = cookieString.split(";").map(s => s.trim());
  const tokenName = "sb-brumjtydtlxhooqrrsch-auth-token";

  // Single cookie
  for (const pair of pairs) {
    if (pair.startsWith(tokenName + "=")) {
      const val = pair.split("=").slice(1).join("=");
      return decodeTokenValue(val);
    }
  }

  // Chunked cookies
  const chunks = [];
  let i = 0;
  while (true) {
    const chunkName = tokenName + "." + i;
    const found = pairs.find(p => p.startsWith(chunkName + "="));
    if (!found) break;
    const val = found.split("=").slice(1).join("=");
    chunks.push(val.replace(/^base64-/, ""));
    i++;
  }

  if (chunks.length > 0) {
    try {
      const combined = Buffer.from(chunks.join(""), "base64").toString("utf-8");
      return extractFromParsed(JSON.parse(combined));
    } catch (e) {
      logger.error("[doc-upload] Failed to parse chunked token", { error: e.message });
      return null;
    }
  }

  return null;
}

function extractFromParsed(parsed) {
  if (!parsed) return null;
  // Object format: { access_token: "...", ... }
  if (parsed.access_token) return parsed.access_token;
  // Array format: [access_token, refresh_token, ...]
  if (Array.isArray(parsed) && parsed[0]) return parsed[0];
  return null;
}

function decodeTokenValue(val) {
  try {
    const raw = val.replace(/^base64-/, "");
    const decoded = Buffer.from(raw, "base64").toString("utf-8");
    return extractFromParsed(JSON.parse(decoded));
  } catch {
    return null;
  }
}

/**
 * Upload file to CRM Supabase storage using the access token.
 */
async function uploadToStorage(accessToken, documentId, fileName, fileBuffer, contentType) {
  const objectPath = documentId + "/" + fileName;
  const uploadUrl = CRM_SUPABASE_URL + "/storage/v1/object/documents/" + objectPath;

  logger.info("[doc-upload] Uploading to storage", { objectPath, size: fileBuffer.length });

  const res = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      "Authorization": "Bearer " + accessToken,
      "apikey": CRM_SUPABASE_ANON_KEY,
      "Content-Type": contentType,
      "x-upsert": "true",
    },
    body: fileBuffer,
  });

  const text = await res.text();

  if (!res.ok) {
    logger.error("[doc-upload] Storage upload failed", { status: res.status, body: text.substring(0, 300) });
    throw new Error("Storage upload failed (" + res.status + "): " + text.substring(0, 200));
  }

  const publicUrl = CRM_SUPABASE_URL + "/storage/v1/object/public/documents/" + objectPath;
  logger.info("[doc-upload] Storage upload success", { publicUrl });
  return publicUrl;
}

/**
 * Register the document via Next.js Server Action POST.
 */
async function registerDocument(sessionCookies, ownerRefId, doc, workspaceId) {
  const documents = [{
    public_id: doc.public_id,
    file_name: doc.file_name,
    file_type: doc.file_type,
    file_size: doc.file_size,
    label: doc.label,
    topic: doc.topic,
    topic_type: doc.topic_type,
    url: doc.url,
    asset_id: doc.asset_id || "$undefined",
    contact_id: "$undefined",
    link_watermark: "$undefined",
  }];

  const postUrl = "https://21online.app/owners/" + ownerRefId + "?tab=documents";
  const actionPayload = JSON.stringify(documents);

  let cookies = sessionCookies;
  if (workspaceId) {
    const wsCookie = buildWorkspaceCookie(workspaceId);
    cookies = mergeWorkspaceCookie(cookies, wsCookie);
  }

  logger.info("[doc-upload] POST Next-Action to 21online", { postUrl, label: doc.label });

  const res = await fetch(postUrl, {
    method: "POST",
    headers: {
      "Content-Type": "text/plain;charset=UTF-8",
      "Accept": "text/x-component",
      "Next-Action": NEXT_ACTION_ID,
      "Next-Router-State-Tree": encodeURIComponent(JSON.stringify([""])),
      "Origin": "https://21online.app",
      "Referer": "https://21online.app/owners/" + ownerRefId + "?tab=documents",
      "Cookie": cookies,
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36",
    },
    redirect: "manual",
    body: actionPayload,
  });

  const responseText = await res.text();
  logger.info("[doc-upload] 21online response", {
    status: res.status,
    body_preview: responseText.substring(0, 300),
  });

  if (res.status === 307 || res.status >= 400) {
    throw new Error("Document register failed (" + res.status + "): " + responseText.substring(0, 300));
  }

  return { success: true, status: res.status, body: responseText.substring(0, 200) };
}

/**
 * Full upload flow: login -> storage upload -> register document.
 */
async function uploadDocumentFull({
  email, password, ownerRefId, fileName, fileBase64, fileType, fileSize, documentLabel,
  topic, topicType, workspaceId,
}) {
  // Step 1: Login (or reuse session)
  const session = await login21online(email, password);
  if (!session || !session.cookies) {
    throw new Error("Login failed - no session cookies");
  }

  // Step 2: Extract Supabase token from session cookies
  const accessToken = extractSupabaseToken(session.cookies);
  if (!accessToken) {
    throw new Error("Could not extract Supabase access token from session cookies");
  }

  logger.info("[doc-upload] Token extracted", { token_prefix: accessToken.substring(0, 20) + "..." });

  // Step 3: Upload file to storage
  const fileBuffer = Buffer.from(fileBase64, "base64");
  const publicId = uuidv4();
  const storageUrl = await uploadToStorage(accessToken, publicId, fileName, fileBuffer, fileType || "application/pdf");

  // Step 4: Register document via Next-Action
  const doc = {
    public_id: publicId,
    file_name: fileName,
    file_type: fileType || "application/pdf",
    file_size: fileSize || fileBuffer.length,
    label: documentLabel,
    topic: topic || ownerRefId,
    topic_type: topicType || "owners",
    url: storageUrl,
    asset_id: topicType === "assets" ? topic : "$undefined",
  };

  let cookies = session.cookies;
  if (workspaceId) {
    const wsCookie = buildWorkspaceCookie(workspaceId);
    cookies = mergeWorkspaceCookie(cookies, wsCookie);
  }

  const result = await registerDocument(cookies, ownerRefId, doc, null);

  return {
    success: true,
    public_id: publicId,
    storage_url: storageUrl,
    register_result: result,
  };
}

module.exports = { uploadDocumentFull, extractSupabaseToken };
