const { google } = require("googleapis");
const fs = require("fs");
require("dotenv").config();

// ── OAuth2 user authentication ────────────────────────────────────────────────
// Uploads as the real Google account owner — uses your Drive storage quota.
// Service accounts cannot upload to personal Drive (no storage quota).
const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  "http://localhost:4001/oauth2callback"
);

oauth2Client.setCredentials({
  refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
});

const drive = google.drive({ version: "v3", auth: oauth2Client });

async function createDriveFolder(folderName, parentFolderId) {
  const folder = await drive.files.create({
    resource: {
      name: folderName,
      mimeType: "application/vnd.google-apps.folder",
      parents: [parentFolderId],
    },
    fields: "id, name, webViewLink",
  });
  return folder.data;
}

async function uploadFileToDrive(filePath, fileName, mimeType, folderId) {
  const response = await drive.files.create({
    requestBody: {
      name: fileName,
      parents: [folderId],
    },
    media: {
      mimeType,
      body: fs.createReadStream(filePath),
    },
    fields: "id, name, webViewLink",
  });
  return response.data;
}

async function listFilesInFolder(folderId) {
  const response = await drive.files.list({
    q: `'${folderId}' in parents and trashed = false`,
    fields: "files(id, name, mimeType, webViewLink, createdTime, modifiedTime)",
    orderBy: "modifiedTime desc",
  });
  return response.data.files;
}

async function listFoldersInFolder(folderId) {
  const allFolders = [];
  let pageToken = undefined;
  do {
    const response = await drive.files.list({
      q: `'${folderId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
      fields: "nextPageToken, files(id, name, webViewLink, createdTime, modifiedTime)",
      orderBy: "name",
      pageSize: 1000,
      pageToken,
    });
    allFolders.push(...(response.data.files || []));
    pageToken = response.data.nextPageToken;
  } while (pageToken);
  return allFolders;
}

async function downloadDriveFile(fileId, destinationPath) {
  const response = await drive.files.get(
    { fileId, alt: "media" },
    { responseType: "stream" }
  );
  return new Promise((resolve, reject) => {
    const dest = fs.createWriteStream(destinationPath);
    response.data
      .on("end", () => resolve(destinationPath))
      .on("error", reject)
      .pipe(dest);
  });
}

async function moveDriveFolder(fileId, newParentId) {
  const file = await drive.files.get({ fileId, fields: "parents" });
  const previousParents = file.data.parents ? file.data.parents.join(",") : "";
  const moved = await drive.files.update({
    fileId,
    addParents: newParentId,
    removeParents: previousParents,
    fields: "id, name, parents, webViewLink",
  });
  return moved.data;
}

async function deleteDriveFolder(folderId) {
  await drive.files.delete({ fileId: folderId });
}

async function deleteDriveFile(fileId) {
  try { await drive.files.delete({ fileId }); } catch {}
}

// Upload a buffer (in-memory file) directly to Drive
async function uploadBufferToDrive(buffer, fileName, mimeType, folderId) {
  const { Readable } = require("stream");
  const stream = new Readable();
  stream.push(buffer);
  stream.push(null);
  const response = await drive.files.create({
    requestBody: { name: fileName, parents: [folderId] },
    media: { mimeType, body: stream },
    fields: "id, name, webViewLink",
  });
  return response.data;
}

// Get or create a folder by name inside a parent folder
async function getOrCreateFolder(name, parentId) {
  const res = await drive.files.list({
    q: `name='${name}' and '${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    fields: "files(id, name)",
    pageSize: 1,
  });
  if (res.data.files.length > 0) return res.data.files[0].id;
  const folder = await drive.files.create({
    requestBody: { name, mimeType: "application/vnd.google-apps.folder", parents: [parentId] },
    fields: "id",
  });
  return folder.data.id;
}

module.exports = {
  drive,
  createDriveFolder,
  uploadFileToDrive,
  uploadBufferToDrive,
  getOrCreateFolder,
  listFilesInFolder,
  listFoldersInFolder,
  downloadDriveFile,
  moveDriveFolder,
  deleteDriveFolder,
  deleteDriveFile,
};
